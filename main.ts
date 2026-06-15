import { randomUUID } from "node:crypto";
import {
  MarkdownView,
  Notice,
  Plugin,
  type WorkspaceLeaf,
} from "obsidian";
import { EditorView } from "@codemirror/view";
import { isSelectedPageType } from "./src/activity-tracking";
import { BridgeServer } from "./src/bridge-server";
import {
  applyManagedTerminalHooks,
  restoreManagedTerminalHooks,
} from "./src/claude-hooks";
import {
  applyManagedBaseUrl,
  localClaudeSettingsPath,
  restoreManagedBaseUrl,
} from "./src/claude-settings";
import {
  DEFAULT_SETTINGS,
  DIFF_VIEW_TYPE,
  WINDOWS_MCP_REGISTRATION_VERSION,
} from "./src/constants";
import {
  latestSelectionForContext,
  rememberLatestSelection,
} from "./src/context-cache";
import { ObsidianDiffView } from "./src/diff-view";
import {
  cleanStaleObsidianLocks,
  removeLockFile,
  writeLockFile,
} from "./src/lock-file";
import { migrateLlm } from "./src/llm-migrate";
import {
  atMentionedParams,
  currentSelection,
  getVaultRoot,
  selectionChangedParams,
} from "./src/selection";
import { MvObccIdeSettingTab } from "./src/settings-tab";
import {
  ToolRegistry,
} from "./src/tool-registry";
import {
  IDE_TOOL_DEFINITIONS,
  isMcpToolEnabled,
  mcpToolDefinitions,
} from "./src/tool-definitions";
import {
  ensureMcpRegistration,
  removeMcpRegistration,
} from "./src/mcp-registration";
import {
  migrateManualUpstream,
  resolveAnthropicBaseUrl,
} from "./src/upstream-resolver";
import {
  activeWorkspaceLeaf,
  currentWorkspaceContext,
} from "./src/workspace-context";
import { SelectionHighlightController } from "./src/selection-highlights";
import { TerminalSessionTracker } from "./src/terminal-session-tracker";
import { LlmFeature } from "./src/llm-feature";
import type {
  BridgeClientContext,
  BridgeSettings,
  JsonRpcRequest,
  JsonRpcResponse,
  ResolvedUpstream,
  SelectionState,
} from "./src/types";

export default class MvObccIdePlugin extends Plugin {
  settings: BridgeSettings = { ...DEFAULT_SETTINGS };
  port = 0;
  mcpStatus = "尚未检查";
  private server: BridgeServer | null = null;
  private readonly latestSelections = new Map<string, SelectionState>();
  private latestWebLeaf: WorkspaceLeaf | null = null;
  private readonly lastContexts = new Map<string, SelectionState>();
  private readonly previousBroadcasts = new Map<string, string>();
  private broadcastTimer: number | null = null;
  private broadcastGeneration = 0;
  private toolRegistry: ToolRegistry | null = null;
  private terminalTracker: TerminalSessionTracker | null = null;
  private selectionHighlighter: SelectionHighlightController | null = null;
  private llmFeature: LlmFeature | null = null;

  async onload(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<BridgeSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(loaded ?? {}),
      activityTracking: {
        ...DEFAULT_SETTINGS.activityTracking,
        ...(loaded?.activityTracking ?? {}),
      },
      toolToggles: {
        ...DEFAULT_SETTINGS.toolToggles,
        ...(loaded?.toolToggles ?? {}),
      },
      toolContextLimits: {
        ...DEFAULT_SETTINGS.toolContextLimits,
        ...(loaded?.toolContextLimits ?? {}),
      },
      llm: migrateLlm(loaded?.llm),
    };
    if (
      process.platform === "win32" &&
      this.settings.windowsMcpRegistrationVersion !==
        WINDOWS_MCP_REGISTRATION_VERSION
    ) {
      this.settings.mcpAuthToken = randomUUID();
      this.settings.registeredMcpUrl = null;
      this.settings.windowsMcpRegistrationVersion =
        WINDOWS_MCP_REGISTRATION_VERSION;
    } else if (!this.settings.mcpAuthToken) {
      this.settings.mcpAuthToken = randomUUID();
    }
    this.settings = migrateManualUpstream(getVaultRoot(this.app), this.settings);
    this.registerView(DIFF_VIEW_TYPE, (leaf) => new ObsidianDiffView(leaf));
    this.addSettingTab(new MvObccIdeSettingTab(this.app, this));
    this.terminalTracker = new TerminalSessionTracker(this.app);
    this.selectionHighlighter = new SelectionHighlightController(
      this.app,
      this.settings.preserveSelectionHighlights,
    );
    this.toolRegistry = new ToolRegistry(
      this.app,
      (context) => this.latestSelectionFor(context),
      () => this.latestWebLeaf,
      () => this.settings.toolContextLimits.readCurrentWebPage,
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.terminalTracker?.scan();
        this.selectionHighlighter?.sync(true);
        this.scheduleBroadcast();
      }),
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.terminalTracker?.scan();
        this.selectionHighlighter?.sync();
        this.scheduleBroadcast();
      }),
    );
    this.registerDomEvent(
      this.app.workspace.containerEl.ownerDocument,
      "selectionchange",
      () => this.scheduleBroadcast(),
    );
    this.registerDomEvent(activeWindow, "focus", () => {
      this.previousBroadcasts.clear();
      this.terminalTracker?.scan();
      this.scheduleBroadcast();
    });
    this.registerInterval(
      activeWindow.setInterval(() => {
        this.terminalTracker?.scan();
        this.selectionHighlighter?.sync();
        this.llmFeature?.tick();
        if (
          this.settings.activityTracking.supportAllActivePages ||
          this.app.workspace.activeLeaf?.view.getViewType() === "webviewer"
        ) {
          this.scheduleBroadcast();
        }
      }, 500),
    );
    this.registerEditorExtension(
      this.selectionHighlighter.markdownExtension(),
    );
    this.registerEditorExtension(
      EditorView.updateListener.of((update) => {
        if (update.selectionSet || update.docChanged) this.scheduleBroadcast();
      }),
    );
    this.addCommand({
      id: "send-selection-to-claude-code",
      name: "Send current selection to Claude Code",
      editorCallback: () => {
        const state = currentSelection(this.app);
        if (state) {
          this.server?.broadcast({
            jsonrpc: "2.0",
            method: "at_mentioned",
            params: atMentionedParams(state),
          });
        }
      },
    });

    this.llmFeature = new LlmFeature(this);
    this.llmFeature.registerCommands();
    this.llmFeature.registerMenus();

    await this.startBridge();
    await this.saveData(this.settings);
    this.terminalTracker.scan();
    this.selectionHighlighter.sync(true);
    this.scheduleBroadcast();
  }

  onunload(): void {
    if (this.broadcastTimer !== null) {
      activeWindow.clearTimeout(this.broadcastTimer);
      this.broadcastTimer = null;
    }
    this.selectionHighlighter?.destroy();
    this.selectionHighlighter = null;
    this.llmFeature?.dispose();
    this.llmFeature = null;
    void this.finishUnload();
  }

  async saveAndApplySettings(): Promise<void> {
    await this.applyClaudeSettings();
    await this.syncMcpRegistration();
    await this.saveData(this.settings);
  }

  refreshLlmFeature(): void {
    this.llmFeature?.settingsChanged();
  }

  async setSelectionHighlightsEnabled(enabled: boolean): Promise<void> {
    this.settings.preserveSelectionHighlights = enabled;
    this.selectionHighlighter?.setEnabled(enabled);
    await this.saveData(this.settings);
  }

  async restartBridge(): Promise<void> {
    await this.stopBridge();
    await this.startBridge();
    this.previousBroadcasts.clear();
    this.scheduleBroadcast();
  }

  async restoreClaudeSettings(): Promise<void> {
    const filePath = localClaudeSettingsPath(getVaultRoot(this.app));
    this.settings = restoreManagedBaseUrl(filePath, this.settings);
    restoreManagedTerminalHooks(filePath);
    await this.saveData(this.settings);
  }

  private async finishUnload(): Promise<void> {
    try {
      await this.restoreClaudeSettings();
      await this.closeDiffs();
      await this.stopBridge();
    } catch (error) {
      console.error("[mv-obcc-ide] unload cleanup failed", error);
    }
  }

  resolvedUpstream(): ResolvedUpstream {
    return resolveAnthropicBaseUrl(getVaultRoot(this.app), this.settings);
  }

  async retryMcpRegistration(): Promise<void> {
    await this.syncMcpRegistration(true);
    await this.saveData(this.settings);
  }

  async cleanMcpRegistration(): Promise<void> {
    const result = await removeMcpRegistration(
      this.settings.claudeExecutable,
      getVaultRoot(this.app),
    );
    this.mcpStatus = result.ok ? result.message : `清理失败：${result.message}`;
    if (result.ok) this.settings.registeredMcpUrl = null;
    await this.saveData(this.settings);
  }

  private async startBridge(): Promise<void> {
    cleanStaleObsidianLocks();
    const vaultRoot = getVaultRoot(this.app);
    const authToken = randomUUID();
    this.server = new BridgeServer({
      authToken,
      mcpAuthToken: this.settings.mcpAuthToken,
      vaultRoot,
      settings: () => this.settings,
      upstreamBaseUrl: () => this.resolvedUpstream().url,
      onMessage: (request, context) =>
        this.handleRequest(request, "ide", context),
      onMcpMessage: (request, context) =>
        this.handleRequest(request, "mcp", context),
      onClientContextChanged: () => {
        this.terminalTracker?.scan();
        this.scheduleBroadcast();
      },
      onLog: (message) => console.error("[mv-obcc-ide]", message),
    });
    this.port = await this.server.start();
    writeLockFile(this.port, vaultRoot, authToken);
    await this.applyClaudeSettings();
    await this.syncMcpRegistration();
    await this.saveData(this.settings);
    console.log(`[mv-obcc-ide] listening on 127.0.0.1:${this.port}`);
  }

  private async stopBridge(): Promise<void> {
    const port = this.port;
    this.port = 0;
    await this.server?.stop();
    this.server = null;
    if (port) removeLockFile(port);
  }

  private async applyClaudeSettings(): Promise<void> {
    const filePath = localClaudeSettingsPath(getVaultRoot(this.app));
    if (this.settings.activityTracking.supportAllActivePages) {
      applyManagedTerminalHooks(filePath);
    } else {
      restoreManagedTerminalHooks(filePath);
    }
    if (
      this.settings.upstreamMode === "compatibility" &&
      this.settings.autoManageClaudeSettings &&
      this.resolvedUpstream().url &&
      this.port
    ) {
      this.settings = applyManagedBaseUrl(
        filePath,
        `http://127.0.0.1:${this.port}`,
        this.settings,
      );
    } else {
      this.settings = restoreManagedBaseUrl(filePath, this.settings);
    }
  }

  private async handleRequest(
    request: JsonRpcRequest,
    channel: "ide" | "mcp",
    context?: BridgeClientContext,
  ): Promise<JsonRpcResponse | null> {
    const id = request.id ?? null;
    switch (request.method) {
      case "initialize":
        if (context) this.previousBroadcasts.delete(context.clientId);
        this.scheduleBroadcast();
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion:
              (request.params?.protocolVersion as string | undefined) ?? "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: {
              name: channel === "mcp" ? "mv-obcc-ide-tools" : "mv-obcc-ide",
              version: this.manifest.version,
            },
          },
        };
      case "tools/list":
        if (context) this.previousBroadcasts.delete(context.clientId);
        this.scheduleBroadcast();
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools:
              channel === "mcp"
                ? mcpToolDefinitions(this.settings)
                : IDE_TOOL_DEFINITIONS,
          },
        };
      case "tools/call": {
        const name = String(request.params?.name ?? "");
        if (channel === "mcp" && !isMcpToolEnabled(name, this.settings)) {
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Tool disabled or not found: ${name}` },
          };
        }
        const args =
          request.params?.arguments &&
          typeof request.params.arguments === "object" &&
          !Array.isArray(request.params.arguments)
            ? (request.params.arguments as Record<string, unknown>)
            : {};
        const toolResult = await this.toolRegistry?.call(name, args, context);
        return toolResult
          ? { jsonrpc: "2.0", id, result: toolResult }
          : {
              jsonrpc: "2.0",
              id,
              error: { code: -32601, message: `Tool not found: ${name}` },
            };
      }
      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: "Method not found" },
        };
    }
  }

  private scheduleBroadcast(): void {
    if (this.broadcastTimer !== null) activeWindow.clearTimeout(this.broadcastTimer);
    this.broadcastTimer = activeWindow.setTimeout(() => {
      this.broadcastTimer = null;
      void this.broadcastSelection();
    }, 100);
  }

  private async broadcastSelection(): Promise<void> {
    const generation = ++this.broadcastGeneration;
    const leaf = activeWorkspaceLeaf(this.app);
    const activeState =
      (await currentWorkspaceContext(this.app, leaf)) ??
      currentSelection(this.app);
    if (generation !== this.broadcastGeneration) return;
    this.terminalTracker?.scan();
    if (
      leaf?.view.getViewType() === "webviewer" &&
      activeState?.resourceType === "web"
    ) {
      this.latestWebLeaf = leaf;
    }

    const clients = this.server?.ideClients() ?? [];
    if (clients.length === 0) {
      const state = this.resolveTrackedState(undefined, leaf, activeState);
      if (state) this.rememberState("global", state);
      return;
    }

    for (const client of clients) {
      const state = this.resolveTrackedState(client, leaf, activeState);
      if (!state) continue;
      this.rememberState(this.contextKey(client), state);
      this.sendSelection(client, state);
    }
  }

  private sendSelection(
    client: BridgeClientContext,
    state: SelectionState,
  ): void {
    const signature = JSON.stringify({
      filePath: state.filePath,
      title: state.title,
      viewType: state.viewType,
      url: state.url,
      page: state.page,
      cursor: state.cursor,
      selection: state.selection,
    });
    if (signature === this.previousBroadcasts.get(client.clientId)) return;
    this.previousBroadcasts.set(client.clientId, signature);
    this.server?.sendToClient(client.clientId, {
      jsonrpc: "2.0",
      method: "selection_changed",
      params: selectionChangedParams(state),
    });
  }

  private contextKey(context?: BridgeClientContext): string {
    return context?.sessionId ?? context?.clientId ?? "global";
  }

  private rememberState(key: string, state: SelectionState): void {
    this.lastContexts.set(key, state);
    this.lastContexts.set("global", state);
    rememberLatestSelection(this.latestSelections, key, state);
  }

  private fallbackContext(context?: BridgeClientContext): SelectionState | null {
    const key = this.contextKey(context);
    return (
      this.lastContexts.get(key) ??
      (context ? null : this.lastContexts.get("global") ?? null)
    );
  }

  private latestSelectionFor(context?: BridgeClientContext): SelectionState | null {
    return latestSelectionForContext(this.latestSelections, context);
  }

  private resolveTrackedState(
    context: BridgeClientContext | undefined,
    leaf: WorkspaceLeaf | null,
    activeState: SelectionState | null,
  ): SelectionState | null {
    const tracking = this.settings.activityTracking;
    if (!tracking.supportAllActivePages) {
      return activeState && isSelectedPageType(activeState, tracking)
        ? activeState
        : this.fallbackContext(context);
    }

    if (this.terminalTracker?.isTerminalLeaf(leaf)) {
      const ownLeaf = this.terminalTracker.leafForSession(context?.sessionId);
      if (!ownLeaf || ownLeaf === leaf) return this.fallbackContext(context);
    }
    return activeState ?? this.fallbackContext(context);
  }

  private async closeDiffs(): Promise<void> {
    await this.toolRegistry?.call("closeAllDiffTabs", {});
    this.app.workspace.detachLeavesOfType(DIFF_VIEW_TYPE);
  }

  private async syncMcpRegistration(force = false): Promise<void> {
    if (!this.port) return;
    if (!this.settings.mcpEnabled) {
      if (force || this.settings.registeredMcpUrl) {
        await this.cleanMcpRegistration();
      } else {
        this.mcpStatus = "已关闭";
      }
      return;
    }
    const url = `http://127.0.0.1:${this.port}/mcp`;
    if (
      !force &&
      this.settings.registeredMcpUrl === url &&
      this.mcpStatus.startsWith("MCP 已")
    ) {
      return;
    }
    const result = await ensureMcpRegistration(
      this.settings.claudeExecutable,
      url,
      this.settings.mcpAuthToken,
      getVaultRoot(this.app),
    );
    this.mcpStatus = result.ok ? result.message : `注册失败：${result.message}`;
    if (result.ok) {
      this.settings.registeredMcpUrl = url;
      if (!this.settings.claudeExecutable && result.executable) {
        this.settings.claudeExecutable = result.executable;
      }
    }
  }
}
