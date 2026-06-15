export type UpstreamMode = "native" | "compatibility";

export interface ToolToggles {
  getLatestSelection: boolean;
  getOpenEditors: boolean;
  openFile: boolean;
  readCurrentWebPage: boolean;
}

export interface ActivityTrackingSettings {
  supportAllActivePages: boolean;
  trackMarkdown: boolean;
  trackPdf: boolean;
  trackWebview: boolean;
}

export interface ToolContextLimits {
  /** Null means return the complete content without plugin-side truncation. */
  readCurrentWebPage: number | null;
}

export type LlmProviderType = "openai" | "anthropic";

/** How a model wants "thinking" params applied (gated by the template toggle). */
export type LlmThinkingMode = "default" | "on" | "off" | "custom";

/** A model entry within a provider (the `name` is the value sent to the API). */
export interface LlmModelEntry {
  /** Stable id for cross-references from templates. */
  id: string;
  /** Display name AND actual model string sent to the API, e.g. "GLM-5.1". */
  name: string;
}

/** A connectable API provider with its own credentials and model list. */
export interface LlmProviderConfig {
  id: string;
  /** User-visible name, e.g. "白山". */
  name: string;
  type: LlmProviderType;
  baseUrl: string;
  apiKey: string;
  models: LlmModelEntry[];
  /**
   * When true, route requests through Obsidian's requestUrl (Node network
   * stack) to bypass CORS / Origin rejections. Streaming degrades to one-shot.
   */
  useProxy: boolean;
}

export interface LlmPromptTemplate {
  id: string;
  label: string;
  prompt: string;
  /** When false, the template is hidden from menus/commands/hotkeys. */
  enabled: boolean;
  /** Points at LlmProviderConfig.id, or null when unselected. */
  providerId: string | null;
  /** Points at LlmModelEntry.id within the chosen provider, or null. */
  modelId: string | null;
  /** Thinking mode applied per-template. "default" sends nothing (safe). */
  thinkingMode: LlmThinkingMode;
  /** Raw JSON merged into the body when thinkingMode === "custom". */
  thinkingCustom?: string;
}

/**
 * Persisted geometry of the LLM result popover (viewport-relative pixels).
 * Null until the user first drags/resizes the window.
 */
export interface LlmWindowGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LlmFeatureSettings {
  enabled: boolean;
  providers: LlmProviderConfig[];
  templates: LlmPromptTemplate[];
  /**
   * When true, inject a custom right-click menu into webviewer pages (suppressing
   * the page's native context menu). When false, webviewer relies on hotkeys.
   */
  webContextMenu: boolean;
  /** Last known viewport-relative position/size of the popover, or null. */
  windowGeometry: LlmWindowGeometry | null;
  /**
   * Id of an enabled template to auto-trigger on text selection when the
   * session-level ribbon toggle is active. Null = auto-trigger disabled
   * (and the ribbon button is hidden).
   */
  autoTriggerTemplateId: string | null;
}

export interface BridgeSettings {
  upstreamMode: UpstreamMode;
  /** Optional manual override. Empty means resolve from Claude settings. */
  upstreamBaseUrl: string;
  autoManageClaudeSettings: boolean;
  previousLocalBaseUrl: string | null;
  managedLocalBaseUrl: string | null;
  activityTracking: ActivityTrackingSettings;
  preserveSelectionHighlights: boolean;
  toolToggles: ToolToggles;
  toolContextLimits: ToolContextLimits;
  llm: LlmFeatureSettings;
  mcpEnabled: boolean;
  mcpAuthToken: string;
  claudeExecutable: string;
  registeredMcpUrl: string | null;
  windowsMcpRegistrationVersion: number;
}

export interface BridgeClientContext {
  clientId: string;
  channel: "ide" | "mcp";
  processId?: number;
  sessionId?: string;
}

export interface EditorPoint {
  line: number;
  character: number;
}

export interface EditorSelection {
  start: EditorPoint;
  end: EditorPoint;
  isEmpty: boolean;
  text: string;
}

export interface SelectionState {
  filePath: string;
  relativePath: string;
  title?: string;
  viewType?: string;
  resourceType?: "markdown" | "web" | "pdf" | "file" | "view";
  url?: string;
  page?: number;
  cursor: EditorPoint;
  selection: EditorSelection;
}

export interface OpenEditorTab {
  uri: string;
  isActive: boolean;
  label: string;
  viewType: string;
  resourceType: "markdown" | "web" | "pdf" | "file" | "view";
  languageId?: string;
  filePath?: string;
  relativePath?: string;
  url?: string;
}

export interface ResolvedUpstream {
  url: string;
  source:
    | "manual"
    | "vault-local"
    | "vault-project"
    | "user"
    | "environment"
    | "none";
}

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface DiffPayload {
  sessionId: string;
  oldFilePath: string;
  newFilePath: string;
  oldContents: string;
  newContents: string;
  tabName: string;
  onResolve: (decision: "accept" | "reject", contents: string) => Promise<void>;
  validateOriginal: () => Promise<boolean>;
}
