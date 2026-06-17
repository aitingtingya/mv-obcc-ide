const PURE_MODIFIER_KEYS = new Set([
  "Alt",
  "Control",
  "Meta",
  "Shift",
  "OS",
]);

const NAMED_KEYS: Record<string, string> = {
  " ": "Space",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  ArrowUp: "ArrowUp",
  Backspace: "Backspace",
  Delete: "Delete",
  End: "End",
  Enter: "Enter",
  Escape: "Escape",
  Home: "Home",
  Insert: "Insert",
  PageDown: "PageDown",
  PageUp: "PageUp",
  Spacebar: "Space",
  Tab: "Tab",
};

export interface ParsedInlineHotkey {
  key: string;
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

function splitHotkey(value: string): string[] {
  return value.trim().split(/-(?!$)/).filter(Boolean);
}

function codeToBaseKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return null;
}

function normalizeBaseKey(key: string): string | null {
  if (!key || PURE_MODIFIER_KEYS.has(key)) return null;
  const named = NAMED_KEYS[key];
  if (named) return named;
  if (/^F\d{1,2}$/i.test(key)) return key.toUpperCase();
  if (key.length === 1) {
    return key.toLowerCase();
  }
  return key;
}

function normalizeEventBaseKey(event: KeyboardEvent): string | null {
  return codeToBaseKey(event.code) ?? normalizeBaseKey(event.key);
}

function normalizeStoredBaseKey(key: string): string | null {
  return normalizeBaseKey(key);
}

function modifierDisplayLabel(modifier: string): string | null {
  if (/^mod$/i.test(modifier)) return "Ctrl/Cmd";
  if (/^a(lt)?$/i.test(modifier) || /^option$/i.test(modifier)) {
    return "Alt/Option";
  }
  if (/^cmd$/i.test(modifier)) return "Cmd";
  if (/^meta$/i.test(modifier)) return "Meta";
  if (/^(c|ctrl|control)$/i.test(modifier)) return "Ctrl";
  if (/^s(hift)?$/i.test(modifier)) return "Shift";
  return null;
}

export function parseInlineHotkey(value: string): ParsedInlineHotkey | null {
  const parts = splitHotkey(value);
  const key = parts.at(-1);
  const normalizedKey = key ? normalizeStoredBaseKey(key) : null;
  if (!normalizedKey) return null;

  const parsed: ParsedInlineHotkey = {
    key: normalizedKey,
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
  };

  for (const modifier of parts.slice(0, -1)) {
    if (/^mod$/i.test(modifier)) parsed.mod = true;
    else if (/^a(lt)?$/i.test(modifier) || /^option$/i.test(modifier)) {
      parsed.alt = true;
    } else if (/^cmd$/i.test(modifier) || /^meta$/i.test(modifier)) {
      parsed.meta = true;
    } else if (/^(c|ctrl|control)$/i.test(modifier)) {
      parsed.ctrl = true;
    } else if (/^s(hift)?$/i.test(modifier)) {
      parsed.shift = true;
    } else {
      return null;
    }
  }

  return parsed;
}

export function eventToCodeMirrorKey(
  event: KeyboardEvent,
  isMacLike: boolean,
): string | null {
  const baseKey = normalizeEventBaseKey(event);
  if (!baseKey) return null;

  const modifiers: string[] = [];
  const hasMod = isMacLike ? event.metaKey : event.ctrlKey;
  if (hasMod) {
    modifiers.push("Mod");
  }
  if (event.altKey) {
    modifiers.push("Alt");
  }
  if (event.shiftKey) {
    modifiers.push("Shift");
  }
  if ((isMacLike && event.ctrlKey) || (!isMacLike && event.metaKey)) {
    modifiers.push(isMacLike ? "Ctrl" : "Meta");
  }

  return [...modifiers, baseKey].join("-");
}

export function formatInlineHotkeyLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "未绑定";

  const parts = splitHotkey(trimmed);
  if (parts.length === 0) return "未绑定";
  const key = parts.at(-1);
  if (!key) return trimmed;

  const labels: string[] = [];
  for (const modifier of parts.slice(0, -1)) {
    labels.push(modifierDisplayLabel(modifier) ?? modifier);
  }
  labels.push(normalizeStoredBaseKey(key) ?? key);
  return labels.join("-");
}

export function matchInlineHotkey(
  value: string,
  event: KeyboardEvent,
  isMacLike: boolean,
): boolean {
  const parsed = parseInlineHotkey(value);
  if (!parsed) return false;

  const eventKey = normalizeEventBaseKey(event);
  if (!eventKey || eventKey !== parsed.key) return false;

  const wantMeta = parsed.meta || (parsed.mod && isMacLike);
  const wantCtrl = parsed.ctrl || (parsed.mod && !isMacLike);
  return (
    event.metaKey === wantMeta &&
    event.ctrlKey === wantCtrl &&
    event.altKey === parsed.alt &&
    event.shiftKey === parsed.shift
  );
}
