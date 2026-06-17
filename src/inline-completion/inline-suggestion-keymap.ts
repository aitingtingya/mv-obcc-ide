import { Compartment, Prec } from "@codemirror/state";
import { keymap, type KeyBinding } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import type { InlineCompletionKeymap } from "../types";
import {
  acceptSuggestion,
  clearSuggestion,
  hasSuggestion,
  readSuggestion,
} from "./inline-suggestion-state";
import {
  matchInlineHotkey,
  parseInlineHotkey,
} from "./inline-hotkey-format";

/**
 * Per-view keymap for inline completion, registered at the highest precedence
 * so accept (Tab) can override the editor's default indentation, and cancel
 * (Escape) can swallow its default. Bindings with an empty string in settings
 * are simply not registered (e.g. an empty `reject` key disables regenerate).
 *
 * A `Compartment` wraps the keymap so we can reconfigure it in-place on every
 * open editor when the user changes key settings, without reloading the plugin.
 */

export const keymapCompartment = new Compartment();

/** Handles bound to the feature so reject can trigger a regeneration. */
export interface KeymapHandlers {
  /** Called when the reject key is pressed with a suggestion visible. */
  onReject: (view: EditorView, rejectedText: string) => void;
  /** Called when the manual request key is pressed. Return true to consume. */
  onRequest: (view: EditorView) => boolean;
}

/** Normalize a CodeMirror keymap string; return "" for empty/invalid. */
function normalizeKey(raw: string): string {
  return (raw ?? "").trim();
}

function isMacLikePlatform(): boolean {
  const nav =
    typeof activeWindow !== "undefined" ? activeWindow.navigator : navigator;
  return nav.platform.toLowerCase().includes("mac");
}

interface InlineHotkeyAction {
  key: string;
  run: (view: EditorView) => boolean;
}

/**
 * Build the keymap extension from current settings + handlers. Entries with
 * empty bindings are skipped. Every handler first checks that a suggestion is
 * currently visible and returns false otherwise (so the key falls through to
 * its normal behavior — e.g. Escape still closes modals, Tab still indents).
 */
export function buildKeymapExtension(
  bindingsConfig: InlineCompletionKeymap,
  handlers: KeymapHandlers,
  isMacLike = isMacLikePlatform(),
): Extension {
  const bindings: KeyBinding[] = [];
  const actions: InlineHotkeyAction[] = [];

  const accept = normalizeKey(bindingsConfig.accept);
  if (accept && parseInlineHotkey(accept)) {
    actions.push({
      key: accept,
      run: (v) => {
        if (!hasSuggestion(v)) return false;
        acceptSuggestion(v);
        return true;
      },
    });
  }

  const reject = normalizeKey(bindingsConfig.reject);
  if (reject && parseInlineHotkey(reject)) {
    actions.push({
      key: reject,
      run: (v) => {
        if (!hasSuggestion(v)) return false;
        const rejectedText = readSuggestion(v);
        clearSuggestion(v);
        handlers.onReject(v, rejectedText);
        return true;
      },
    });
  }

  const cancel = normalizeKey(bindingsConfig.cancel);
  if (cancel && parseInlineHotkey(cancel)) {
    actions.push({
      key: cancel,
      run: (v) => {
        if (!hasSuggestion(v)) return false;
        clearSuggestion(v);
        return true;
      },
    });
  }

  const request = normalizeKey(bindingsConfig.request);
  if (request && parseInlineHotkey(request)) {
    actions.push({
      key: request,
      run: (v) => handlers.onRequest(v),
    });
  }

  for (const action of actions) {
    bindings.push({
      key: action.key,
      run: action.run,
    });
  }

  if (actions.length > 0) {
    bindings.push({
      any: (view, event) => {
        for (const action of actions) {
          if (matchInlineHotkey(action.key, event, isMacLike)) {
            return action.run(view);
          }
        }
        return false;
      },
    });
  }

  return Prec.highest(keymap.of(bindings));
}
