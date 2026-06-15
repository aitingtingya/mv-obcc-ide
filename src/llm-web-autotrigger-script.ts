/**
 * Scripts injected into webviewer pages to support "auto-trigger on selection".
 *
 * Mirrors the structure of `llm-web-menu-script.ts` / `llm-web-hotkey-script.ts`
 * (idempotent window key + cleanup) but is driven by `mouseup` rather than
 * `contextmenu` / `keydown`: after the user finishes selecting text inside the
 * page, we stash `{ text, id }` into `window.__mvObccAutoTrigger.pending`. The
 * Obsidian side polls that field (see `LlmFeature.pollWebAutoTrigger`) and
 * dispatches the configured auto-trigger template.
 *
 * The polling side de-dupes by `id` so a single selection only fires once.
 */

export interface LlmWebAutoTriggerPending {
  text: string;
  /** Monotonic id assigned in-page so the poller can de-dupe. */
  id: number;
}

export const WEB_AUTOTRIGGER_STATE_KEY = "__mvObccAutoTrigger";

/**
 * Install script. The state is idempotent: re-injection is a no-op once the
 * listener is attached. We deliberately do NOT depend on any Obsidian-side
 * template list — the page only reports raw selection text and lets the
 * Obsidian side decide whether to act (based on the session toggle).
 */
export function llmWebAutoTriggerInstallScript(): string {
  return `(() => {
    try {
      const key = ${JSON.stringify(WEB_AUTOTRIGGER_STATE_KEY)};
      if (window[key] && window[key].version === 2) {
        // Already installed; just clear any stale pending payload.
        window[key].pending = null;
        return { success: true, installed: false };
      }
      if (window[key] && typeof window[key].cleanup === "function") {
        window[key].cleanup();
      }

      const readSelection = () => {
        try {
          const el = document.activeElement;
          const tag = el && el.tagName ? el.tagName.toUpperCase() : "";
          if (tag === "INPUT" || tag === "TEXTAREA") {
            const node = el;
            if (typeof node.selectionStart === "number" && typeof node.selectionEnd === "number") {
              const start = node.selectionStart;
              const end = node.selectionEnd;
              if (start !== end && typeof node.value === "string") {
                return node.value.slice(start, end);
              }
            }
            return "";
          }
          const sel = window.getSelection ? window.getSelection() : null;
          return sel ? sel.toString() : "";
        } catch {
          return "";
        }
      };

      let selectionRevision = 0;
      let pointerStartRevision = null;
      let timer = null;
      const onSelectionChange = () => {
        selectionRevision += 1;
      };
      const onMouseDown = (event) => {
        pointerStartRevision = event.button === 0 ? selectionRevision : null;
      };
      const onMouseUp = () => {
        try {
          const startRevision = pointerStartRevision;
          pointerStartRevision = null;
          if (startRevision === null) return;
          if (timer) window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            timer = null;
            if (selectionRevision <= startRevision) return;
            const text = readSelection();
            if (!text || !text.trim()) return;
            const current = window[key];
            if (!current) return;
            current.pending = { text: text, id: current.nextId++ };
          }, 150);
        } catch {
          // Never break page mouse handling.
        }
      };

      const cleanup = () => {
        document.removeEventListener("selectionchange", onSelectionChange);
        document.removeEventListener("mousedown", onMouseDown, true);
        document.removeEventListener("mouseup", onMouseUp, true);
        if (timer) window.clearTimeout(timer);
        delete window[key];
      };

      document.addEventListener("selectionchange", onSelectionChange);
      document.addEventListener("mousedown", onMouseDown, true);
      document.addEventListener("mouseup", onMouseUp, true);

      window[key] = {
        version: 2,
        nextId: 1,
        pending: null,
        cleanup: cleanup,
      };
      return { success: true, installed: true };
    } catch (error) {
      return {
        success: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  })()`;
}

/** Polling script: returns and clears the pending payload if any. */
export function llmWebAutoTriggerPollScript(): string {
  return `(() => {
    try {
      const state = window[${JSON.stringify(WEB_AUTOTRIGGER_STATE_KEY)}];
      if (!state || !state.pending) return null;
      const pending = state.pending;
      state.pending = null;
      return pending;
    } catch {
      return null;
    }
  })()`;
}

/** Remove the injected listeners and state from the page. */
export function llmWebAutoTriggerCleanupScript(): string {
  return `(() => {
    try {
      const state = window[${JSON.stringify(WEB_AUTOTRIGGER_STATE_KEY)}];
      if (state && typeof state.cleanup === "function") state.cleanup();
      return true;
    } catch {
      return false;
    }
  })()`;
}
