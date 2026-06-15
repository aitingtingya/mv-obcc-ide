export const DIFF_VIEW_TYPE = "mv-obcc-ide-diff";
export const PLUGIN_ID = "mv-obcc-ide";
export const IDE_NAME = "Obsidian";
export const SERVER_HOST = "127.0.0.1";
export const PORT_BASE = 47000;
export const PORT_SPAN = 1500;
export const MCP_SERVER_NAME = "mv-obcc-ide";
export const TERMINAL_MARKER_PREFIX = "mv-obcc-ide:";
export const MANAGED_HOOK_MARKER = "mv-obcc-ide-terminal-marker-v1";
export const WINDOWS_MCP_REGISTRATION_VERSION = 1;

export const DEFAULT_SETTINGS = {
  upstreamMode: "native" as const,
  upstreamBaseUrl: "",
  autoManageClaudeSettings: true,
  previousLocalBaseUrl: null,
  managedLocalBaseUrl: null,
  activityTracking: {
    supportAllActivePages: false,
    trackMarkdown: true,
    trackPdf: true,
    trackWebview: true,
  },
  preserveSelectionHighlights: true,
  toolToggles: {
    getLatestSelection: true,
    getOpenEditors: true,
    openFile: true,
    readCurrentWebPage: false,
  },
  toolContextLimits: {
    readCurrentWebPage: null,
  },
  llm: {
    enabled: false,
    providers: [
      {
        id: "openai-default",
        name: "OpenAI",
        type: "openai" as const,
        baseUrl: "https://api.openai.com/v1",
        apiKey: "",
        models: [{ id: "gpt-4o-mini", name: "gpt-4o-mini" }],
        useProxy: false,
      },
    ],
    templates: [
      {
        id: "translate",
        label: "翻译成中文",
        prompt: "请把以下内容翻译成中文，只输出译文：\n\n{selection}",
        enabled: true,
        providerId: null,
        modelId: null,
        thinkingMode: "default" as const,
      },
      {
        id: "summarize",
        label: "总结",
        prompt: "请用简洁的中文总结以下内容要点：\n\n{selection}",
        enabled: true,
        providerId: null,
        modelId: null,
        thinkingMode: "default" as const,
      },
      {
        id: "polish",
        label: "润色",
        prompt:
          "请润色以下文字，保持原意，输出更流畅自然的表达，只输出结果：\n\n{selection}",
        enabled: true,
        providerId: null,
        modelId: null,
        thinkingMode: "default" as const,
      },
    ],
    webContextMenu: false,
    windowGeometry: null,
    autoTriggerTemplateId: null,
  },
  mcpEnabled: true,
  mcpAuthToken: "",
  claudeExecutable: "",
  registeredMcpUrl: null,
  windowsMcpRegistrationVersion: 0,
};
