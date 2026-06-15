import {
  MarkdownView,
  Notice,
  WorkspaceSplit,
  setIcon,
  type App,
  type Editor,
  type WorkspaceContainer,
  type WorkspaceLeaf,
} from "obsidian";
import { ensureTempFile } from "./llm-temp-file";
import type { LlmWindowGeometry } from "./types";

export type LlmResultState =
  | "opening"
  | "streaming"
  | "done"
  | "error"
  | "closed";

export interface LlmResultSink {
  appendDelta(delta: string): void;
  setDone(): void;
  setError(message: string): void;
  close(): void;
}

export interface LlmResultSurfaceOptions {
  document?: Document;
  /**
   * Optional viewport-relative geometry the popover should be born with.
   * When omitted, the popover is centered in the viewport.
   */
  geometry?: LlmWindowGeometry;
  onInsert?: (text: string) => void;
  onReplace?: (text: string) => void;
  onClose?: () => void;
  /** Fired after the user finishes dragging/resizing, with the new geometry. */
  onGeometryChange?: (geometry: LlmWindowGeometry) => void;
}

interface WorkspaceWithFloating {
  rootSplit: WorkspaceContainer;
  floatingSplit?: WorkspaceContainer & { children?: WorkspaceContainer[] };
  setActiveLeaf?: (leaf: WorkspaceLeaf, ...rest: unknown[]) => void;
  createLeafInParent(parent: WorkspaceSplit, index: number): WorkspaceLeaf;
}

interface ResizeEdges {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

const MIN_WIDTH = 420;
const MIN_HEIGHT = 280;
let surfaceLayer = 60;

function createElement<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function viewportSize(doc: Document): { width: number; height: number } {
  const win = doc.defaultView;
  return {
    width: win?.innerWidth ?? doc.documentElement.clientWidth,
    height: win?.innerHeight ?? doc.documentElement.clientHeight,
  };
}

function containerForDocument(app: App, doc: Document): WorkspaceContainer {
  const workspace = app.workspace as unknown as WorkspaceWithFloating;
  if (workspace.rootSplit.doc === doc) return workspace.rootSplit;
  for (const container of workspace.floatingSplit?.children ?? []) {
    if (container.doc === doc) return container;
  }
  return workspace.rootSplit;
}

function rootForDocument(app: App, doc: Document): WorkspaceContainer {
  const workspace = app.workspace as unknown as WorkspaceWithFloating;
  if (workspace.rootSplit.doc === doc) return workspace.rootSplit;
  return workspace.floatingSplit ?? containerForDocument(app, doc);
}

function temporarilySuppressActiveLeaf<T>(app: App, callback: () => T): T {
  const workspace = app.workspace as unknown as WorkspaceWithFloating;
  const hadOwnMethod = Object.prototype.hasOwnProperty.call(
    workspace,
    "setActiveLeaf",
  );
  const original = workspace.setActiveLeaf;
  workspace.setActiveLeaf = () => {};
  try {
    return callback();
  } finally {
    if (hadOwnMethod) {
      workspace.setActiveLeaf = original;
    } else {
      delete workspace.setActiveLeaf;
    }
  }
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  const candidate = target as { closest?: (selector: string) => Element | null };
  return (
    typeof candidate?.closest === "function" &&
    candidate.closest("button, a, input, textarea, select, .clickable-icon") !==
      null
  );
}

/**
 * A single non-modal LLM result window. It first mounts a real Obsidian
 * Markdown leaf and falls back in place to an editable textarea if any
 * semi-internal workspace API fails.
 */
export class LlmResultSurface implements LlmResultSink {
  private readonly doc: Document;
  private state: LlmResultState = "opening";
  private buffer = "";
  private errorMessage = "";
  private fallbackReason = "";
  private rootEl: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private hostEl: HTMLElement | null = null;
  private toolbarEl: HTMLElement | null = null;
  private textarea: HTMLTextAreaElement | null = null;
  private split: WorkspaceSplit | null = null;
  private leaf: WorkspaceLeaf | null = null;
  private editor: Editor | null = null;
  private initializing = false;
  private closeRequested = false;
  private closeNotified = false;
  /**
   * 运行时钉子状态：用户用标题栏左侧的 📌 切换。按下后，点「插入/替换」
   * 不再自动关闭窗口，且再次划词调用会复用同一窗口（而非销毁重建）。
   * 每个新窗口默认未钉。
   */
  private pinned = false;
  private pinEl: HTMLElement | null = null;
  private cleanupFns: Array<() => void> = [];

  constructor(
    private readonly app: App,
    private options: LlmResultSurfaceOptions = {},
  ) {
    this.doc = options.document ?? app.workspace.containerEl.ownerDocument;
  }

  open(): void {
    if (this.rootEl || this.state === "closed") return;
    this.buildWindow();
    this.initializing = true;
    void this.initializeEmbeddedEditor()
      .catch((error) => {
        if (!this.closeRequested) this.renderFallback(error);
      })
      .finally(() => {
        this.initializing = false;
        if (this.closeRequested) this.cleanupEmbeddedLeaf();
      });
  }

  appendDelta(delta: string): void {
    if (!delta || this.state === "closed") return;
    if (this.state === "opening") this.state = "streaming";

    if (this.editor) {
      const editor = this.editor;
      const lastLine = editor.lastLine();
      const end = { line: lastLine, ch: editor.getLine(lastLine).length };
      editor.replaceRange(delta, end);
      this.buffer = editor.getValue();
    } else if (this.textarea) {
      this.appendToTextarea(delta);
    } else {
      this.buffer += delta;
    }
    this.renderStatus();
  }

  /**
   * Reset the surface for a new invocation, reusing the same window (used by
   * the "persistent window" feature). Clears any buffered/streamed text and
   * the error block, and flips the state back to streaming so the next
   * `appendDelta` updates the same editor.
   */
  reset(): void {
    this.buffer = "";
    this.errorMessage = "";
    this.fallbackReason = "";
    this.state = "streaming";
    if (this.editor) {
      this.editor.setValue("");
    }
    if (this.textarea) {
      this.textarea.value = "";
    }
    this.rootEl?.querySelector(".mv-obcc-llm-error")?.remove();
    if (this.rootEl) this.activate(this.rootEl);
    this.renderStatus();
  }

  /**
   * Update the `onInsert`/`onReplace` callbacks and rebuild the toolbar so the
   * "替换选区 / 插入到光标处" buttons bind to the NEW selection's edit target.
   * Required by the persistent-window reuse path: without this, a reused
   * window would keep the edit target from the first invocation.
   */
  updateCallbacks(
    onInsert?: (text: string) => void,
    onReplace?: (text: string) => void,
  ): void {
    this.options = { ...this.options, onInsert, onReplace };
    const oldToolbar = this.toolbarEl;
    if (!oldToolbar || !oldToolbar.parentNode) return;
    const newToolbar = this.buildToolbar();
    oldToolbar.parentNode.insertBefore(newToolbar, oldToolbar);
    oldToolbar.remove();
    this.toolbarEl = newToolbar;
  }

  /** Current viewport-relative geometry, or null when the window is gone. */
  get currentGeometry(): LlmWindowGeometry | null {
    const root = this.rootEl;
    if (!root) return null;
    const rect = root.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }

  setDone(): void {
    if (this.state === "closed") return;
    this.state = "done";
    if (!this.getCurrentText().trim()) {
      this.setCurrentText("(模型返回为空)");
    }
    this.renderStatus();
  }

  setError(message: string): void {
    if (this.state === "closed") return;
    this.state = "error";
    this.errorMessage = message;
    this.renderStatus();
    this.renderError();
  }

  close(): void {
    if (this.state === "closed") return;
    this.state = "closed";
    this.closeRequested = true;
    for (const cleanup of this.cleanupFns.splice(0)) {
      try {
        cleanup();
      } catch {
        // Best-effort DOM cleanup.
      }
    }
    this.rootEl?.remove();
    this.rootEl = null;
    this.titleEl = null;
    this.statusEl = null;
    this.hostEl = null;
    this.toolbarEl = null;
    this.pinEl = null;
    this.textarea = null;
    this.editor = null;
    if (!this.initializing) this.cleanupEmbeddedLeaf();
    if (!this.closeNotified) {
      this.closeNotified = true;
      this.options.onClose?.();
    }
  }

  get currentState(): LlmResultState {
    return this.state;
  }

  get isOpen(): boolean {
    return this.state !== "closed" && this.rootEl?.isConnected === true;
  }

  /** 当前是否被钉住（固定悬浮窗）。供外部复用判断读取。 */
  get isPinned(): boolean {
    return this.pinned;
  }

  get usingFallback(): boolean {
    return this.textarea !== null;
  }

  /** 切换钉子状态，并同步按钮图标/样式。 */
  private togglePinned(): void {
    this.pinned = !this.pinned;
    const el = this.pinEl;
    if (el) {
      this.renderPinIcon(el, this.pinned);
      el.setAttribute("aria-pressed", String(this.pinned));
    }
  }

  /** 根据钉住状态渲染对应图标（pin / pin-off）与激活样式。 */
  private renderPinIcon(el: HTMLElement, pinned: boolean): void {
    setIcon(el, pinned ? "pin" : "pin-off");
    el.classList.toggle("is-pinned", pinned);
    el.title = pinned ? "已固定：点击取消" : "点击固定悬浮窗";
    el.setAttribute("aria-label", pinned ? "取消固定悬浮窗" : "固定悬浮窗");
  }

  private buildWindow(): void {
    const root = createElement(
      this.doc,
      "div",
      "popover hover-popover mv-obcc-llm-popover",
    );
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "LLM 结果");
    const viewport = viewportSize(this.doc);
    const geo = this.options.geometry;
    const width = geo
      ? Math.min(Math.max(MIN_WIDTH, geo.width), viewport.width)
      : Math.min(450, Math.max(MIN_WIDTH, viewport.width - 24));
    const height = geo
      ? Math.min(Math.max(MIN_HEIGHT, geo.height), viewport.height)
      : Math.min(520, Math.max(MIN_HEIGHT, viewport.height - 24));
    root.style.width = `${width}px`;
    root.style.height = `${height}px`;
    if (geo) {
      // Clamp remembered position into the current viewport so a resized
      // window (e.g. after Obsidian restart with different layout) still shows.
      root.style.left = `${Math.max(
        0,
        Math.min(geo.left, viewport.width - width),
      )}px`;
      root.style.top = `${Math.max(0, Math.min(geo.top, viewport.height - height))}px`;
    } else {
      root.style.left = `${Math.max(12, (viewport.width - width) / 2)}px`;
      root.style.top = `${Math.max(12, (viewport.height - height) / 2)}px`;
    }
    this.activate(root);

    const titlebar = createElement(
      this.doc,
      "div",
      "mv-obcc-llm-titlebar",
    );
    const title = createElement(
      this.doc,
      "div",
      "mv-obcc-llm-title",
      "LLM 结果",
    );
    const status = createElement(
      this.doc,
      "span",
      "mv-obcc-llm-status",
    );
    title.appendChild(status);
    // 固定后插入/替换不会关闭窗口，下一次调用会复用当前窗口。
    const pin = createElement(
      this.doc,
      "button",
      "mv-obcc-llm-title-action mv-obcc-llm-pin",
    );
    pin.type = "button";
    pin.setAttribute("aria-pressed", "false");
    this.renderPinIcon(pin, this.pinned);
    pin.addEventListener("click", () => this.togglePinned());
    const close = createElement(
      this.doc,
      "button",
      "mv-obcc-llm-title-action",
      "×",
    );
    close.type = "button";
    close.setAttribute("aria-label", "关闭");
    close.addEventListener("click", () => this.close());
    titlebar.append(pin, title, close);

    const host = createElement(this.doc, "div", "mv-obcc-llm-host");
    const toolbar = this.buildToolbar();
    root.append(titlebar, host, toolbar);
    this.createResizeHandles(root);
    this.doc.body.appendChild(root);

    this.rootEl = root;
    this.titleEl = title;
    this.statusEl = status;
    this.hostEl = host;
    this.toolbarEl = toolbar;
    this.pinEl = pin;
    this.cleanupFns.push(this.installDrag(root, titlebar));
    this.cleanupFns.push(this.installActivation(root));
    this.renderStatus();
  }

  private buildToolbar(): HTMLElement {
    const toolbar = createElement(
      this.doc,
      "div",
      "mv-obcc-llm-toolbar",
    );
    toolbar.appendChild(
      this.actionButton("复制", async () => {
        try {
          await this.doc.defaultView?.navigator.clipboard.writeText(
            this.getCurrentText(),
          );
          new Notice("已复制到剪贴板");
        } catch {
          new Notice("复制失败，请手动选中复制");
        }
      }, true),
    );
    if (this.options.onReplace) {
      toolbar.appendChild(
        this.actionButton("替换选区", () => {
          this.options.onReplace?.(this.getCurrentText());
          if (!this.pinned) this.close();
        }),
      );
    }
    if (this.options.onInsert) {
      toolbar.appendChild(
        this.actionButton("插入到光标处", () => {
          this.options.onInsert?.(this.getCurrentText());
          if (!this.pinned) this.close();
        }),
      );
    }
    toolbar.appendChild(
      this.actionButton("关闭", () => this.close()),
    );
    return toolbar;
  }

  private actionButton(
    label: string,
    action: () => void | Promise<void>,
    primary = false,
  ): HTMLButtonElement {
    const button = createElement(
      this.doc,
      "button",
      primary ? "mod-cta" : "",
      label,
    );
    button.type = "button";
    button.addEventListener("click", () => {
      void action();
    });
    return button;
  }

  private async initializeEmbeddedEditor(): Promise<void> {
    const host = this.hostEl;
    if (!host || this.closeRequested) return;

    const SplitCtor = WorkspaceSplit as unknown as new (
      workspace: unknown,
      direction: "vertical" | "horizontal",
    ) => WorkspaceSplit;
    const split = new SplitCtor(this.app.workspace, "vertical");
    this.split = split;
    split.getRoot = () => rootForDocument(this.app, this.doc);
    split.getContainer = () => containerForDocument(this.app, this.doc);

    // Hover Editor's critical ordering: attach the split before creating a leaf.
    split.containerEl.classList.add("mv-obcc-llm-workspace");
    host.replaceChildren(split.containerEl);
    const leaf = temporarilySuppressActiveLeaf(this.app, () =>
      this.app.workspace.createLeafInParent(split, 0),
    );
    this.leaf = leaf;
    if (this.closeRequested) return;

    const tempFile = await ensureTempFile(this.app);
    if (this.closeRequested) return;
    await leaf.openFile(tempFile, {
      active: false,
      state: { mode: "source" },
    });
    if (this.closeRequested) return;
    if (leaf.isDeferred) await leaf.loadIfDeferred();

    const view = leaf.view;
    if (!(view instanceof MarkdownView)) {
      throw new Error("临时文件未以 Markdown 视图打开");
    }
    this.editor = view.editor;
    this.editor.setValue(this.buffer);
    this.textarea = null;
    if (this.state === "opening") this.state = "streaming";
    this.renderStatus();
    leaf.onResize();
  }

  private renderFallback(error: unknown): void {
    this.fallbackReason =
      error instanceof Error ? error.message : String(error);
    console.warn(
      "[mv-obcc] LLM embedded editor failed; using textarea fallback:",
      this.fallbackReason,
    );
    this.cleanupEmbeddedLeaf();
    const host = this.hostEl;
    if (!host || this.closeRequested) return;

    const area = createElement(
      this.doc,
      "textarea",
      "mv-obcc-llm-result",
    );
    area.value = this.buffer;
    area.spellcheck = false;
    area.setAttribute("aria-label", "LLM 结果文本编辑器");
    area.addEventListener("input", () => {
      this.buffer = area.value;
    });
    host.replaceChildren(area);
    this.textarea = area;
    if (this.state === "opening") this.state = "streaming";
    this.renderStatus();
    this.renderError();
  }

  private appendToTextarea(delta: string): void {
    const area = this.textarea;
    if (!area) return;
    const start = area.selectionStart;
    const end = area.selectionEnd;
    const direction = area.selectionDirection;
    const wasAtEnd = start === area.value.length && end === area.value.length;
    area.value += delta;
    this.buffer = area.value;
    if (this.doc.activeElement === area) {
      if (wasAtEnd) {
        area.setSelectionRange(area.value.length, area.value.length);
        area.scrollTop = area.scrollHeight;
      } else {
        area.setSelectionRange(start, end, direction ?? undefined);
      }
    }
  }

  private getCurrentText(): string {
    return this.editor?.getValue() ?? this.textarea?.value ?? this.buffer;
  }

  private setCurrentText(text: string): void {
    this.buffer = text;
    if (this.editor) this.editor.setValue(text);
    if (this.textarea) this.textarea.value = text;
  }

  private renderStatus(): void {
    const status = this.statusEl;
    if (!status) return;
    status.className = "mv-obcc-llm-status";
    const fallback = this.textarea ? " · 文本兜底" : "";
    if (this.state === "opening") {
      status.textContent = "准备编辑器…";
    } else if (this.state === "streaming") {
      status.textContent = `生成中…${fallback}`;
    } else if (this.state === "done") {
      status.textContent = `可编辑${fallback}`;
      status.classList.add("mv-obcc-llm-status-done");
    } else if (this.state === "error") {
      status.textContent = `调用失败${fallback}`;
      status.classList.add("mv-obcc-llm-status-error");
    }
    if (this.fallbackReason) {
      status.title = this.fallbackReason;
    } else {
      status.removeAttribute("title");
    }
  }

  private renderError(): void {
    const root = this.rootEl;
    if (!root) return;
    root.querySelector(".mv-obcc-llm-error")?.remove();
    if (this.state !== "error" || !this.errorMessage) return;
    const error = createElement(
      this.doc,
      "div",
      "mv-obcc-llm-error",
      this.errorMessage,
    );
    const toolbar = root.querySelector(".mv-obcc-llm-toolbar");
    root.insertBefore(error, toolbar);
  }

  private cleanupEmbeddedLeaf(): void {
    const leaf = this.leaf;
    this.leaf = null;
    this.editor = null;
    if (leaf) {
      try {
        leaf.detach();
      } catch {
        // The leaf may already have been detached by Obsidian.
      }
    }
    this.split?.containerEl.remove();
    this.split = null;
  }

  private installActivation(root: HTMLElement): () => void {
    const activate = () => this.activate(root);
    root.addEventListener("pointerdown", activate, true);
    return () => root.removeEventListener("pointerdown", activate, true);
  }

  private activate(root: HTMLElement): void {
    surfaceLayer += 1;
    root.style.zIndex = String(surfaceLayer);
  }

  private emitGeometry(): void {
    const geo = this.currentGeometry;
    if (geo) this.options.onGeometryChange?.(geo);
  }

  private installDrag(
    root: HTMLElement,
    handle: HTMLElement,
  ): () => void {
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || isInteractiveTarget(event.target)) return;
      const rect = root.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const ownerDoc = root.ownerDocument;
      root.classList.add("is-dragging");
      this.activate(root);

      const onMove = (move: PointerEvent) => {
        const viewport = viewportSize(ownerDoc);
        const minLeft = 40 - rect.width;
        const maxLeft = viewport.width - 40;
        const maxTop = viewport.height - 32;
        const left = Math.min(
          Math.max(rect.left + move.clientX - startX, minLeft),
          maxLeft,
        );
        const top = Math.min(
          Math.max(rect.top + move.clientY - startY, 0),
          maxTop,
        );
        root.style.left = `${left}px`;
        root.style.top = `${top}px`;
      };
      const onUp = () => {
        root.classList.remove("is-dragging");
        ownerDoc.removeEventListener("pointermove", onMove);
        ownerDoc.removeEventListener("pointerup", onUp);
        this.leaf?.onResize();
        this.emitGeometry();
      };
      ownerDoc.addEventListener("pointermove", onMove);
      ownerDoc.addEventListener("pointerup", onUp);
      event.preventDefault();
    };
    handle.addEventListener("pointerdown", onPointerDown);
    return () => handle.removeEventListener("pointerdown", onPointerDown);
  }

  private createResizeHandles(root: HTMLElement): void {
    const directions: Array<[string, ResizeEdges]> = [
      ["top", { top: true, right: false, bottom: false, left: false }],
      ["right", { top: false, right: true, bottom: false, left: false }],
      ["bottom", { top: false, right: false, bottom: true, left: false }],
      ["left", { top: false, right: false, bottom: false, left: true }],
      ["top-left", { top: true, right: false, bottom: false, left: true }],
      ["top-right", { top: true, right: true, bottom: false, left: false }],
      ["bottom-left", { top: false, right: false, bottom: true, left: true }],
      ["bottom-right", { top: false, right: true, bottom: true, left: false }],
    ];
    for (const [direction, edges] of directions) {
      const handle = createElement(
        this.doc,
        "div",
        `mv-obcc-llm-resize-handle ${direction}`,
      );
      handle.dataset.direction = direction;
      root.appendChild(handle);
      this.cleanupFns.push(this.installResize(root, handle, edges));
    }
  }

  private installResize(
    root: HTMLElement,
    handle: HTMLElement,
    edges: ResizeEdges,
  ): () => void {
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const rect = root.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const ownerDoc = root.ownerDocument;
      root.classList.add("is-resizing");
      this.activate(root);

      const onMove = (move: PointerEvent) => {
        const viewport = viewportSize(ownerDoc);
        const dx = move.clientX - startX;
        const dy = move.clientY - startY;
        let left = rect.left;
        let top = rect.top;
        let width = rect.width;
        let height = rect.height;

        if (edges.right) width = Math.max(MIN_WIDTH, rect.width + dx);
        if (edges.bottom) height = Math.max(MIN_HEIGHT, rect.height + dy);
        if (edges.left) {
          width = Math.max(MIN_WIDTH, rect.width - dx);
          left = rect.right - width;
        }
        if (edges.top) {
          height = Math.max(MIN_HEIGHT, rect.height - dy);
          top = rect.bottom - height;
        }

        left = Math.max(0, left);
        top = Math.max(0, top);
        width = Math.min(width, viewport.width - left);
        height = Math.min(height, viewport.height - top);
        root.style.left = `${left}px`;
        root.style.top = `${top}px`;
        root.style.width = `${width}px`;
        root.style.height = `${height}px`;
        this.leaf?.onResize();
      };
      const onUp = () => {
        root.classList.remove("is-resizing");
        ownerDoc.removeEventListener("pointermove", onMove);
        ownerDoc.removeEventListener("pointerup", onUp);
        this.leaf?.onResize();
        this.emitGeometry();
      };
      ownerDoc.addEventListener("pointermove", onMove);
      ownerDoc.addEventListener("pointerup", onUp);
      event.preventDefault();
      event.stopPropagation();
    };
    handle.addEventListener("pointerdown", onPointerDown);
    return () => handle.removeEventListener("pointerdown", onPointerDown);
  }
}
