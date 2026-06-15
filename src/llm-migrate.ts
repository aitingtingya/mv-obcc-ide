import { DEFAULT_SETTINGS } from "./constants";
import type {
  LlmFeatureSettings,
  LlmModelEntry,
  LlmPromptTemplate,
  LlmProviderConfig,
  LlmProviderType,
  LlmThinkingMode,
  LlmWindowGeometry,
} from "./types";

/**
 * Settings migration for the LLM feature.
 *
 * History:
 *  - v0.2.7: single provider stored as flat fields
 *    `{ provider, baseUrl, apiKey, model }`.
 *  - v0.2.9: multiple providers stored as `providers: LlmProviderConfig[]`,
 *    and each template carries `{ enabled, providerId, modelId }`.
 *
 * This module lifts old flat config into a migrated provider named "白山"
 * (per product decision) so existing users keep working without re-entering
 * anything, then normalizes every template with the new fields. It is
 * idempotent: a normalized settings object passes through unchanged.
 */

/** Stable, slugified id derived from a model or provider display name. */
export function slugify(raw: string): string {
  const base = raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "item";
}

interface LegacyLlmSettings {
  provider?: LlmProviderType;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

interface RawProvider {
  id?: string;
  name?: string;
  type?: LlmProviderType;
  baseUrl?: string;
  apiKey?: string;
  models?: unknown;
}

interface RawTemplate {
  id?: string;
  label?: string;
  prompt?: string;
  enabled?: boolean;
  providerId?: string | null;
  modelId?: string | null;
  /** Legacy v0.3.0 field: a per-template on/off toggle. */
  thinkingEnabled?: boolean;
  /** Current field: per-template thinking mode. */
  thinkingMode?: LlmThinkingMode;
  thinkingCustom?: string;
}

/** The id used for the single migrated provider from legacy flat config. */
export const MIGRATED_PROVIDER_ID = "migrated-baishan";

/**
 * Normalize an arbitrary `loaded.llm` blob (possibly legacy, possibly new,
 * possibly partial) into a complete, valid `LlmFeatureSettings`.
 */
export function migrateLlm(loaded: unknown): LlmFeatureSettings {
  const source = (loaded ?? {}) as Partial<LlmFeatureSettings> & LegacyLlmSettings;
  const base = DEFAULT_SETTINGS.llm;

  // Determine the providers list.
  //  - If a non-empty `providers` array is present, normalize it.
  //  - Else if any legacy flat field (baseUrl/apiKey/model/provider) is set,
  //    lift those into a single migrated "白山" provider.
  //  - Otherwise (e.g. fresh install / null input) use the bundled defaults.
  let providers: LlmProviderConfig[];
  const rawProviders = source.providers;
  const hasLegacy =
    typeof source.provider === "string" ||
    typeof source.baseUrl === "string" ||
    typeof source.apiKey === "string" ||
    typeof source.model === "string";
  if (Array.isArray(rawProviders) && rawProviders.length > 0) {
    providers = rawProviders.map((p, i) => normalizeProvider(p, `provider-${i}`));
  } else if (hasLegacy) {
    providers = [buildMigratedProvider(source)];
  } else {
    providers = base.providers.map((p) => normalizeProvider(p, p.id));
  }

  // Pre-resolve legacy v0.3.0 thinking config: in that version the model held
  // thinkingMode/thinkingCustom and the template held a thinkingEnabled flag.
  // Lift those onto each template so no thinking config is lost when models
  // are normalized (which strips the thinking fields).
  const legacyThinking = collectLegacyModelThinking(source);
  const legacyEnabledByTplId = collectLegacyTemplateThinkingEnabled(source);

  // Templates: prefer a loaded list, fall back to defaults.
  const rawTemplates = Array.isArray(source.templates)
    ? source.templates
    : base.templates;
  const templates = rawTemplates.map((t, i) =>
    normalizeTemplate(
      t,
      i,
      providers,
      legacyThinking,
      legacyEnabledByTplId,
    ),
  );

  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : base.enabled,
    providers,
    templates,
    webContextMenu:
      typeof source.webContextMenu === "boolean"
        ? source.webContextMenu
        : base.webContextMenu,
    windowGeometry: normalizeWindowGeometry(
      (source as { windowGeometry?: unknown }).windowGeometry,
    ),
    autoTriggerTemplateId: normalizeAutoTriggerTemplateId(source, templates),
  };
}

function normalizeAutoTriggerTemplateId(
  source: LegacyLlmSettings,
  templates: LlmPromptTemplate[],
): string | null {
  const value = (source as { autoTriggerTemplateId?: unknown })
    .autoTriggerTemplateId;
  if (typeof value !== "string" || !value) return null;
  return templates.some((template) => template.id === value && template.enabled)
    ? value
    : null;
}

/** Coerce an arbitrary persisted value into a valid geometry or null. */
function normalizeWindowGeometry(raw: unknown): LlmWindowGeometry | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as {
    left?: unknown;
    top?: unknown;
    width?: unknown;
    height?: unknown;
  };
  const left = Number(g.left);
  const top = Number(g.top);
  const width = Number(g.width);
  const height = Number(g.height);
  if (![left, top, width, height].every(Number.isFinite)) return null;
  if (width < 50 || height < 50) return null; // implausible size; drop it
  return { left, top, width, height };
}

/** Build the single "白山" provider from legacy flat fields. */
function buildMigratedProvider(source: LegacyLlmSettings): LlmProviderConfig {
  const model = typeof source.model === "string" ? source.model.trim() : "";
  const models: LlmModelEntry[] = model
    ? [{ id: slugify(model), name: model }]
    : [];
  return {
    id: MIGRATED_PROVIDER_ID,
    name: "白山",
    type: source.provider ?? "openai",
    baseUrl: source.baseUrl || "https://api.openai.com/v1",
    apiKey: source.apiKey ?? "",
    models,
    useProxy: false,
  };
}

/** Normalize a raw provider object into a valid `LlmProviderConfig`. */
function normalizeProvider(raw: RawProvider | undefined, fallbackId: string): LlmProviderConfig {
  const id = typeof raw?.id === "string" && raw.id ? raw.id : fallbackId;
  const name = typeof raw?.name === "string" && raw.name ? raw.name : "未命名提供商";
  const type: LlmProviderType = raw?.type === "anthropic" ? "anthropic" : "openai";
  const baseUrl = typeof raw?.baseUrl === "string" ? raw.baseUrl : "";
  const apiKey = typeof raw?.apiKey === "string" ? raw.apiKey : "";
  const models = normalizeModels(raw?.models);
  const useProxy = (raw as { useProxy?: unknown })?.useProxy === true;
  return { id, name, type, baseUrl, apiKey, models, useProxy };
}

/** Normalize a raw models value into unique LlmModelEntry[]. */
function normalizeModels(raw: unknown): LlmModelEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: LlmModelEntry[] = [];
  const usedIds = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as { name?: unknown };
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    if (!name) continue;
    const id =
      typeof (item as { id?: unknown }).id === "string"
        ? ((item as { id: string }).id)
        : slugify(name);
    const unique = uniqueId(id, usedIds);
    usedIds.add(unique);
    out.push({ id: unique, name });
  }
  return out;
}

/** Collect legacy v0.3.0 thinking config from raw models, keyed by model id. */
function collectLegacyModelThinking(
  source: unknown,
): Map<string, { mode: LlmThinkingMode; custom?: string }> {
  const out = new Map<string, { mode: LlmThinkingMode; custom?: string }>();
  const providers = (source as { providers?: unknown })?.providers;
  if (!Array.isArray(providers)) return out;
  for (const p of providers) {
    if (!p || typeof p !== "object") continue;
    const models = (p as { models?: unknown }).models;
    if (!Array.isArray(models)) continue;
    for (const m of models) {
      if (!m || typeof m !== "object") continue;
      const obj = m as { id?: unknown; thinkingMode?: unknown; thinkingCustom?: unknown };
      if (typeof obj.id !== "string") continue;
      const mode: LlmThinkingMode =
        obj.thinkingMode === "on" ||
        obj.thinkingMode === "off" ||
        obj.thinkingMode === "custom"
          ? obj.thinkingMode
          : "default";
      if (mode === "default") continue;
      out.set(obj.id, {
        mode,
        custom: typeof obj.thinkingCustom === "string" ? obj.thinkingCustom : undefined,
      });
    }
  }
  return out;
}

/** Map of template id → legacy thinkingEnabled flag. */
function collectLegacyTemplateThinkingEnabled(source: unknown): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const templates = (source as { templates?: unknown })?.templates;
  if (!Array.isArray(templates)) return out;
  for (const t of templates) {
    if (!t || typeof t !== "object") continue;
    const obj = t as { id?: unknown; thinkingEnabled?: unknown };
    if (typeof obj.id === "string" && obj.thinkingEnabled === true) {
      out.set(obj.id, true);
    }
  }
  return out;
}

/** Normalize a raw template, filling new fields with sensible defaults. */
function normalizeTemplate(
  raw: RawTemplate | undefined,
  index: number,
  providers: LlmProviderConfig[],
  legacyModelThinking: Map<string, { mode: LlmThinkingMode; custom?: string }>,
  legacyEnabledByTplId: Map<string, boolean>,
): LlmPromptTemplate {
  const id = typeof raw?.id === "string" && raw.id ? raw.id : `tpl-${index}`;
  const label = typeof raw?.label === "string" && raw.label ? raw.label : "未命名模板";
  const prompt = typeof raw?.prompt === "string" ? raw.prompt : "{selection}";
  const enabled = raw?.enabled !== false; // default true unless explicitly false

  // providerId / modelId: validate against the providers list. A legacy
  // template has neither set; if exactly one provider exists (the migrated
  // case), auto-assign it + its first model so the user is ready to go.
  const rawModelId = raw?.modelId ?? null;
  let providerId: string | null = raw?.providerId ?? null;
  let modelId: string | null = raw?.modelId ?? null;

  const provider = providerId
    ? providers.find((p) => p.id === providerId) ?? null
    : null;
  if (providerId && !provider) {
    // Stale reference — clear it.
    providerId = null;
    modelId = null;
  } else if (provider && modelId && !provider.models.some((m) => m.id === modelId)) {
    // Stale model reference within a valid provider — clear model only.
    modelId = null;
  }

  // Auto-assign when unselected and there's exactly one provider (the common
  // migrated case). Helps the user avoid a confusing "未选择模型" state.
  if (!providerId && providers.length === 1) {
    providerId = providers[0]?.id ?? null;
  }
  if (providerId && !modelId) {
    const p = providers.find((x) => x.id === providerId);
    modelId = p?.models[0]?.id ?? null;
  }

  // Thinking mode. Resolution order:
  //  1. The template's own thinkingMode (current format) — validated.
  //  2. Legacy v0.3.0: if this template had thinkingEnabled and its referenced
  //     model carried a thinkingMode, lift the model's config onto the template.
  //  3. Otherwise default ("default" = safe: sends nothing).
  let thinkingMode: LlmThinkingMode = "default";
  let thinkingCustom: string | undefined;
  if (
    raw?.thinkingMode === "on" ||
    raw?.thinkingMode === "off" ||
    raw?.thinkingMode === "custom"
  ) {
    thinkingMode = raw.thinkingMode;
    thinkingCustom =
      typeof raw.thinkingCustom === "string" ? raw.thinkingCustom : undefined;
  } else if (legacyEnabledByTplId.get(id) === true && rawModelId) {
    const lifted = legacyModelThinking.get(rawModelId);
    if (lifted) {
      thinkingMode = lifted.mode;
      thinkingCustom = lifted.custom;
    }
  }

  return {
    id,
    label,
    prompt,
    enabled,
    providerId,
    modelId,
    thinkingMode,
    thinkingCustom,
  };
}

/** Guarantee uniqueness of an id within a set, appending a numeric suffix. */
function uniqueId(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
