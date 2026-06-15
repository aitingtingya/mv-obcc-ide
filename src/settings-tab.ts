import { Menu, Notice, PluginSettingTab, Setting, type App } from "obsidian";
import type MvObccIdePlugin from "../main";
import type {
  LlmModelEntry,
  LlmPromptTemplate,
  LlmProviderConfig,
  LlmProviderType,
  LlmThinkingMode,
  ToolToggles,
} from "./types";

const SOURCE_LABELS = {
  manual: "手动覆盖",
  "vault-local": "当前仓库 .claude/settings.local.json",
  "vault-project": "当前仓库 .claude/settings.json",
  user: "用户 ~/.claude/settings.json",
  environment: "Obsidian 进程环境变量",
  none: "未找到",
} as const;

function addHeading(containerEl: HTMLElement, text: string): void {
  new Setting(containerEl).setName(text).setHeading();
}

export class MvObccIdeSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: MvObccIdePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    addHeading(containerEl, "MV OBCC IDE");

    new Setting(containerEl)
      .setName("桥接状态")
      .setDesc("插件启用后被动运行。建议先启动 Obsidian，再启动 Claude Code。")
      .addText((text) => {
        text
          .setValue(
            this.plugin.port
              ? `已连接：127.0.0.1:${this.plugin.port}`
              : "未连接",
          )
          .setDisabled(true);
        text.inputEl.addClass("mv-obcc-status");
      });

    containerEl.createEl("div", {
      text: "🔌 IDE 桥接",
      cls: "mv-obcc-section-title setting-item-name",
    });
    addHeading(containerEl, "功能与工具");

    addHeading(containerEl, "被动：状态感知");
    new Setting(containerEl)
      .setName("支持所有活动页面")
      .setDesc(
        "默认关闭。开启后追踪任意 Obsidian 标签，并通过 Claude 会话 PID 和终端标题标记精确忽略该会话自己的终端；改变后请重新启动 Claude Code。",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.activityTracking.supportAllActivePages)
          .onChange(async (value) => {
            this.plugin.settings.activityTracking.supportAllActivePages = value;
            await this.plugin.saveAndApplySettings();
            this.display();
          }),
      );

    const pageTypes: Array<{
      key: "trackMarkdown" | "trackPdf" | "trackWebview";
      name: string;
      description: string;
    }> = [
      {
        key: "trackMarkdown",
        name: "追踪 Markdown 页面",
        description: "追踪当前 Markdown 文件、光标和选区。",
      },
      {
        key: "trackPdf",
        name: "追踪 PDF 页面",
        description: "追踪当前 PDF 文件、页码和文本选区。",
      },
      {
        key: "trackWebview",
        name: "追踪 Web Viewer 页面",
        description: "追踪 Obsidian 内置浏览器的标题、URL 和文本选区。",
      },
    ];
    for (const pageType of pageTypes) {
      new Setting(containerEl)
        .setName(pageType.name)
        .setDesc(
          this.plugin.settings.activityTracking.supportAllActivePages
            ? "“支持所有活动页面”已开启，此选项不再单独生效。"
            : pageType.description,
        )
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.activityTracking[pageType.key])
            .setDisabled(
              this.plugin.settings.activityTracking.supportAllActivePages,
            )
            .onChange(async (value) => {
              this.plugin.settings.activityTracking[pageType.key] = value;
              await this.plugin.saveAndApplySettings();
            }),
        );
    }

    addHeading(containerEl, "视觉辅助");
    new Setting(containerEl)
      .setName("切换标签时保留选区高亮")
      .setDesc(
        "默认开启。切换到终端等特殊标签后仍显示 Markdown、PDF 和网页中最后一次划词；回到原页面空点或重新划词时继续遵循 Obsidian 原有行为。此功能不影响发送给 Claude 的选区。",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.preserveSelectionHighlights)
          .onChange(async (value) => {
            await this.plugin.setSelectionHighlightsEnabled(value);
          }),
      );

    addHeading(containerEl, "主动：MCP 工具");
    new Setting(containerEl)
      .setName("启用 MCP 主动工具")
      .setDesc(
        "Claude Code 会过滤普通 IDE 工具，因此主动工具通过标准 MCP 提供。改变后请重新启动 Claude Code。",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.mcpEnabled)
          .onChange(async (value) => {
            this.plugin.settings.mcpEnabled = value;
            await this.plugin.saveAndApplySettings();
            this.display();
          }),
      );

    if (this.plugin.settings.mcpEnabled) {
      const tools: Array<{
        key: keyof ToolToggles;
        name: string;
        description: string;
      }> = [
        {
          key: "getLatestSelection",
          name: "获取最近标签与选区",
          description: "焦点离开 Obsidian 后仍可读取最近一次状态。",
        },
        {
          key: "getOpenEditors",
          name: "获取全部打开标签",
          description: "包括 Markdown、PDF、图片、网页、终端和其他插件页面。",
        },
        {
          key: "openFile",
          name: "在 Obsidian 中打开文件",
          description: "允许 Claude 主动定位仓库内文件和文本范围。",
        },
        {
          key: "readCurrentWebPage",
          name: "读取最近网页为 Markdown",
          description:
            "把最近浏览且仍打开的 Web Viewer 页面转换为 Markdown，不刷新或跳转页面。用于让 Claude 查看网页全貌，而不是只读取选区。",
        },
      ];
      for (const tool of tools) {
        new Setting(containerEl)
          .setName(tool.name)
          .setDesc(tool.description)
          .addToggle((toggle) =>
            toggle
              .setValue(this.plugin.settings.toolToggles[tool.key])
              .onChange(async (value) => {
                this.plugin.settings.toolToggles[tool.key] = value;
                await this.plugin.saveAndApplySettings();
              }),
          );
        if (tool.key === "readCurrentWebPage") {
          new Setting(containerEl)
            .setName("网页工具最大返回字符数")
            .setDesc(
              "留空或填写 0 表示不限，插件会忠实返回当前已加载页面的完整可见内容；填写正整数时才截断。",
            )
            .addText((text) => {
              text.inputEl.type = "number";
              text.inputEl.min = "0";
              text.inputEl.step = "1";
              text
                .setPlaceholder("不限")
                .setValue(
                  this.plugin.settings.toolContextLimits.readCurrentWebPage?.toString() ??
                    "",
                )
                .onChange(async (value) => {
                  const trimmed = value.trim();
                  if (!trimmed) {
                    this.plugin.settings.toolContextLimits.readCurrentWebPage =
                      null;
                  } else {
                    const parsed = Number(trimmed);
                    if (!Number.isFinite(parsed) || parsed < 0) return;
                    this.plugin.settings.toolContextLimits.readCurrentWebPage =
                      parsed === 0 ? null : Math.floor(parsed);
                  }
                  await this.plugin.saveData(this.plugin.settings);
                });
            });
        }
      }

      new Setting(containerEl)
        .setName("MCP 注册状态")
        .setDesc(this.plugin.mcpStatus)
        .addButton((button) =>
          button.setButtonText("重新注册").onClick(async () => {
            await this.plugin.retryMcpRegistration();
            new Notice(this.plugin.mcpStatus);
            this.display();
          }),
        )
        .addButton((button) =>
          button.setButtonText("清理注册").onClick(async () => {
            await this.plugin.cleanMcpRegistration();
            new Notice(this.plugin.mcpStatus);
            this.display();
          }),
        );

      new Setting(containerEl)
        .setName("Claude 可执行文件")
        .setDesc("通常自动检测。Windows 或自定义安装位置可在此填写完整路径。")
        .addText((text) =>
          text
            .setPlaceholder("自动检测")
            .setValue(this.plugin.settings.claudeExecutable)
            .onChange(async (value) => {
              this.plugin.settings.claudeExecutable = value.trim();
              await this.plugin.saveData(this.plugin.settings);
            }),
        );
    }

    containerEl.createEl("div", {
      text: "✍️ 划词助手（选词调用 LLM）",
      cls: "mv-obcc-section-title setting-item-name",
    });
    addHeading(containerEl, "总开关");

    new Setting(containerEl)
      .setName("启用")
      .setDesc(
        "完全独立于 IDE 桥接。开启后，在 Markdown / PDF / Web Viewer 中划词，右键或快捷键即可用预设提示词调用 LLM。",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.llm.enabled)
          .onChange(async (value) => {
            this.plugin.settings.llm.enabled = value;
            await this.plugin.saveData(this.plugin.settings);
            this.plugin.refreshLlmFeature();
            this.display();
          }),
      );

    {
      const tip = containerEl.createEl("p", {
        text: "提示：PDF 视图的右键被 Obsidian / pdf++ 占用，无法注入 LLM 菜单，请用快捷键触发（在「快捷键设置」里给「LLM：xxx」命令绑键）。网页视图（Web Viewer）里，Obsidian 的快捷键因焦点隔离无法直接生效，插件会自动把你已绑定的「LLM：xxx」快捷键同步注入网页，所以网页里用同一个快捷键即可。",
      });
      tip.addClass("mv-obcc-llm-hint");
    }

    if (this.plugin.settings.llm.enabled) {
      // ---- 提供商 ----
      addHeading(containerEl, "API 提供商");
      this.renderProviders(containerEl);

      new Setting(containerEl)
        .setName("网页视图注入右键菜单（实验性）")
        .setDesc(
          "因网页视图跨域隔离，Obsidian 读不到网页内的选区。开启后会向网页注入脚本，在网页内显示我们的右键菜单（会屏蔽网页原生右键，部分站点可能失效）。关闭时网页视图改用快捷键调用。",
        )
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.llm.webContextMenu)
            .onChange(async (value) => {
              this.plugin.settings.llm.webContextMenu = value;
              await this.plugin.saveData(this.plugin.settings);
              new Notice(
                value
                  ? "已开启网页右键菜单，将在网页内注入。"
                  : "已关闭，网页视图请用快捷键调用。",
                4000,
              );
            }),
        );

      // ---- 悬浮窗行为 + 划词自动触发 ----
      addHeading(containerEl, "悬浮窗与自动触发");

      // 自动触发模板：下拉列出所有「已启用」的模板 + 一个「（关闭）」选项。
      // 仅当存在至少一个已启用模板时才显示，否则给一条提示。
      const enabledTemplates = this.plugin.settings.llm.templates.filter(
        (t) => t.enabled,
      );
      if (enabledTemplates.length === 0) {
        new Setting(containerEl)
          .setName("划词自动触发模板")
          .setDesc("当前没有已启用的模板，无法设置自动触发。请先在下方启用至少一个模板。");
      } else {
        new Setting(containerEl)
          .setName("划词自动触发模板")
          .setDesc(
            "选择一个模板后，左侧功能区会出现「划词自动触发」按钮（点亮后才生效，每次启动默认关闭）。点亮后划词会自动用所选模板调用助手；所选模板若被关闭或删除，按钮会自动消失。",
          )
          .addDropdown((dropdown) => {
            dropdown.addOption("", "（关闭）");
            for (const tpl of enabledTemplates) {
              dropdown.addOption(tpl.id, tpl.label);
            }
            dropdown.setValue(
              this.plugin.settings.llm.autoTriggerTemplateId ?? "",
            );
            dropdown.onChange(async (value) => {
              this.plugin.settings.llm.autoTriggerTemplateId = value || null;
              await this.plugin.saveData(this.plugin.settings);
              this.plugin.refreshLlmFeature();
            });
          });
      }

      // ---- 提示词模板 ----
      addHeading(containerEl, "提示词模板");
      const hint = containerEl.createEl("div", {
        text: "提示词中可用 {selection} 占位符表示划词内容；不含占位符时，划词会自动追加到末尾。每个模板可单独开关，并选择用哪个提供商的哪个模型。",
      });
      hint.addClass("mv-obcc-llm-hint");
      this.renderTemplates(containerEl);

      new Setting(containerEl).addButton((btn) =>
        btn
          .setButtonText("新增提示词模板")
          .setCta()
          .onClick(async () => {
            const next: LlmPromptTemplate = {
              id: `tpl-${Date.now()}`,
              label: "新模板",
              prompt: "{selection}",
              enabled: true,
              providerId: null,
              modelId: null,
              thinkingMode: "default",
            };
            this.plugin.settings.llm.templates.push(next);
            await this.plugin.saveData(this.plugin.settings);
            this.display();
          }),
      );
    }

    addHeading(containerEl, "上游兼容");
    new Setting(containerEl)
      .setName("上游模式")
      .setDesc(
        "原生模式不改请求；兼容模式会把 IDE system 上下文移动到对应 user 消息中，不会复制两份。",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("native", "原生")
          .addOption("compatibility", "兼容")
          .setValue(this.plugin.settings.upstreamMode)
          .onChange(async (value) => {
            this.plugin.settings.upstreamMode =
              value === "compatibility" ? "compatibility" : "native";
            await this.plugin.saveAndApplySettings();
            this.display();
          }),
      );

    if (this.plugin.settings.upstreamMode === "compatibility") {
      const resolved = this.plugin.resolvedUpstream();
      new Setting(containerEl)
        .setName("Anthropic 上游地址（可选）")
        .setDesc(
          "留空时自动读取 Claude 配置。只有需要覆盖自动结果时才填写。",
        )
        .addText((text) =>
          text
            .setPlaceholder("留空以自动读取")
            .setValue(this.plugin.settings.upstreamBaseUrl)
            .onChange(async (value) => {
              this.plugin.settings.upstreamBaseUrl = value.trim();
              await this.plugin.saveAndApplySettings();
            }),
        );

      new Setting(containerEl)
        .setName("当前识别的上游")
        .setDesc(`来源：${SOURCE_LABELS[resolved.source]}`)
        .addText((text) =>
          text.setValue(resolved.url || "未找到 ANTHROPIC_BASE_URL").setDisabled(true),
        );

      new Setting(containerEl)
        .setName("自动管理当前仓库的 Claude 设置")
        .setDesc(
          "仅把当前仓库的 ANTHROPIC_BASE_URL 指向本地兼容端点；关闭时恢复插件接管前的值。",
        )
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.autoManageClaudeSettings)
            .onChange(async (value) => {
              this.plugin.settings.autoManageClaudeSettings = value;
              await this.plugin.saveAndApplySettings();
              this.display();
            }),
        );
    }

    addHeading(containerEl, "Diff 与维护");
    new Setting(containerEl)
      .setName("Diff 审核行为")
      .setDesc(
        "完全跟随 Claude Code 权限模式：默认权限会显示审核；acceptEdits 会直接接受编辑，插件不会额外弹窗。",
      );

    new Setting(containerEl)
      .setName("重启桥接")
      .setDesc("重建本地服务和 Claude Code IDE lock 文件。")
      .addButton((button) =>
        button.setButtonText("重启").onClick(async () => {
          await this.plugin.restartBridge();
          new Notice("MV OBCC IDE 桥接已重启。");
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName("恢复插件管理的 Claude 设置")
      .setDesc("只恢复本插件替换过的 ANTHROPIC_BASE_URL，不改其他配置。")
      .addButton((button) =>
        button.setButtonText("恢复").onClick(async () => {
          await this.plugin.restoreClaudeSettings();
          new Notice("已恢复 MV OBCC IDE 管理的 Claude 设置。");
          this.display();
        }),
      );
  }

  // ---- 划词助手：API 提供商编辑 ----

  private renderProviders(containerEl: HTMLElement): void {
    const providers = this.plugin.settings.llm.providers;
    for (let i = 0; i < providers.length; i += 1) {
      const idx = i;
      const provider = providers[idx];
      if (!provider) continue;
      this.renderProvider(containerEl, idx, provider);
    }

    new Setting(containerEl).addButton((btn) =>
      btn
        .setButtonText("新增提供商")
        .onClick(async () => {
          const next: LlmProviderConfig = {
            id: `provider-${Date.now()}`,
            name: "新提供商",
            type: "openai",
            baseUrl: "",
            apiKey: "",
            models: [],
            useProxy: false,
          };
          this.plugin.settings.llm.providers.push(next);
          await this.plugin.saveData(this.plugin.settings);
          this.display();
        }),
    );
  }

  private renderProvider(
    containerEl: HTMLElement,
    idx: number,
    provider: LlmProviderConfig,
  ): void {
    const wrap = containerEl.createDiv({ cls: "mv-obcc-llm-provider" });
    const header = new Setting(wrap)
      .setClass("mv-obcc-llm-provider-header")
      .setHeading();

    // Provider name + type + delete, all in the header's control area.
    header.controlEl.empty();
    header.controlEl.addClass("mv-obcc-llm-provider-head");

    const nameInput = header.controlEl.createEl("input", {
      type: "text",
      attr: { placeholder: "提供商名称（如：白山）", value: provider.name },
    });
    nameInput.addClass("mv-obcc-llm-provider-name");
    nameInput.addEventListener("change", async () => {
      const target = this.plugin.settings.llm.providers[idx];
      if (!target) return;
      target.name = nameInput.value;
      await this.plugin.saveData(this.plugin.settings);
    });

    const typeSelect = header.controlEl.createEl("select");
    for (const opt of ["openai", "anthropic"] as LlmProviderType[]) {
      const o = typeSelect.createEl("option", {
        value: opt,
        text: opt === "anthropic" ? "Anthropic" : "OpenAI 兼容",
      });
      if (provider.type === opt) o.selected = true;
    }
    typeSelect.addEventListener("change", async () => {
      const target = this.plugin.settings.llm.providers[idx];
      if (!target) return;
      target.type = typeSelect.value as LlmProviderType;
      await this.plugin.saveData(this.plugin.settings);
    });

    header.addExtraButton((btn) =>
      btn
        .setIcon("trash")
        .setTooltip("删除该提供商")
        .onClick(async () => {
          // Clear templates that referenced this provider.
          for (const t of this.plugin.settings.llm.templates) {
            if (t.providerId === provider.id) {
              t.providerId = null;
              t.modelId = null;
            }
          }
          this.plugin.settings.llm.providers.splice(idx, 1);
          await this.plugin.saveData(this.plugin.settings);
          this.display();
        }),
    );

    new Setting(wrap)
      .setName("API Base URL")
      .setDesc(
        provider.type === "anthropic"
          ? "如 https://api.anthropic.com，插件自动追加 /v1/messages。"
          : "如 https://api.openai.com/v1，插件自动追加 /chat/completions。",
      )
      .addText((text) =>
        text
          .setPlaceholder("https://...")
          .setValue(provider.baseUrl)
          .onChange(async (value) => {
            const target = this.plugin.settings.llm.providers[idx];
            if (!target) return;
            target.baseUrl = value.trim();
            await this.plugin.saveData(this.plugin.settings);
          }),
      );

    new Setting(wrap)
      .setName("API Key")
      .setDesc("明文保存在插件 data.json。")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("sk-...")
          .setValue(provider.apiKey)
          .onChange(async (value) => {
            const target = this.plugin.settings.llm.providers[idx];
            if (!target) return;
            target.apiKey = value.trim();
            await this.plugin.saveData(this.plugin.settings);
          });
      });

    new Setting(wrap)
      .setName("绕过 CORS(代理模式)")
      .setDesc(
        "默认关闭(流式逐字输出)。开启后改用 Obsidian 内部网络通道,可绕过部分端点对 app:// Origin 的 CORS 拒绝(表现为『Failed to fetch』),但会失去流式、改为一次性返回。iphy 等报 CORS 错的端点请开启。",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(provider.useProxy)
          .onChange(async (value) => {
            const target = this.plugin.settings.llm.providers[idx];
            if (!target) return;
            target.useProxy = value;
            await this.plugin.saveData(this.plugin.settings);
            this.display();
          }),
      );

    // Models list.
    const modelsHeading = wrap.createEl("div", {
      text: "模型",
      cls: "mv-obcc-llm-models-label",
    });
    const modelsList = wrap.createDiv({ cls: "mv-obcc-llm-models" });
    const models = provider.models;
    for (let m = 0; m < models.length; m += 1) {
      const midx = m;
      const model = models[midx];
      if (!model) continue;
      const row = modelsList.createDiv({ cls: "mv-obcc-llm-model-row" });
      const input = row.createEl("input", {
        type: "text",
        attr: {
          placeholder: "模型名（如 GLM-5.1，即发往 API 的值）",
          value: model.name,
        },
      });
      input.addClass("mv-obcc-llm-model-name");
      input.addEventListener("change", async () => {
        const p = this.plugin.settings.llm.providers[idx];
        const target = p?.models[midx];
        if (!target) return;
        target.name = input.value;
        await this.plugin.saveData(this.plugin.settings);
      });

      const delBtn = row.createEl("button", { text: "删除", cls: "mv-obcc-llm-model-del" });
      delBtn.addEventListener("click", async () => {
        const p = this.plugin.settings.llm.providers[idx];
        if (!p) return;
        const removed = p.models[midx];
        p.models.splice(midx, 1);
        // Clear templates pointing at the removed model.
        if (removed) {
          for (const t of this.plugin.settings.llm.templates) {
            if (t.providerId === provider.id && t.modelId === removed.id) {
              t.modelId = null;
            }
          }
        }
        await this.plugin.saveData(this.plugin.settings);
        this.display();
      });
    }
    void modelsHeading; // label rendered above
    const addModelBtn = modelsList.createEl("button", {
      text: "+ 添加模型",
      cls: "mv-obcc-llm-model-add",
    });
    addModelBtn.addEventListener("click", async () => {
      const p = this.plugin.settings.llm.providers[idx];
      if (!p) return;
      const entry: LlmModelEntry = {
        id: `model-${Date.now()}`,
        name: "",
      };
      p.models.push(entry);
      await this.plugin.saveData(this.plugin.settings);
      this.display();
    });
  }

  // ---- 划词助手：提示词模板编辑 ----

  private renderTemplates(containerEl: HTMLElement): void {
    const templates = this.plugin.settings.llm.templates;
    for (let i = 0; i < templates.length; i += 1) {
      const idx = i;
      const tpl = templates[idx];
      if (!tpl) continue;
      this.renderTemplate(containerEl, idx, tpl);
    }
  }

  private renderTemplate(
    containerEl: HTMLElement,
    idx: number,
    tpl: LlmPromptTemplate,
  ): void {
    const setting = new Setting(containerEl).setClass("mv-obcc-llm-tpl");
    setting.infoEl.empty();
    setting.infoEl.addClass("mv-obcc-llm-tpl-info");
    setting.controlEl.empty();
    setting.controlEl.addClass("mv-obcc-llm-tpl-control");

    const labelInput = setting.infoEl.createEl("input", {
      type: "text",
      attr: { placeholder: "菜单显示名（如：翻译）", value: tpl.label },
    });
    labelInput.addClass("mv-obcc-llm-tpl-label");
    labelInput.addEventListener("change", async () => {
      const target = this.plugin.settings.llm.templates[idx];
      if (!target) return;
      target.label = labelInput.value;
      await this.plugin.saveData(this.plugin.settings);
    });

    const promptArea = setting.infoEl.createEl("textarea");
    promptArea.setAttr("rows", "3");
    promptArea.setAttr("placeholder", "提示词，可用 {selection} 占位符");
    promptArea.value = tpl.prompt;
    promptArea.addClass("mv-obcc-llm-tpl-prompt");
    promptArea.addEventListener("change", async () => {
      const target = this.plugin.settings.llm.templates[idx];
      if (!target) return;
      target.prompt = promptArea.value;
      await this.plugin.saveData(this.plugin.settings);
    });

    // Model selection button + current selection summary, plus enable toggle.
    const modelBtn = setting.controlEl.createEl("button", {
      cls: "mv-obcc-llm-tpl-model",
    });
    const refreshModelLabel = () => {
      const p = this.plugin.settings.llm.providers.find((x) => x.id === tpl.providerId);
      const mdl = p?.models.find((x) => x.id === tpl.modelId);
      modelBtn.textContent = mdl && p ? `模型：${p.name} / ${mdl.name}` : "选择模型";
    };
    refreshModelLabel();
    modelBtn.addEventListener("click", (evt) => {
      const menu = new Menu();
      menu.addItem((item) =>
        item.setTitle("（清除选择）").onClick(async () => {
          const target = this.plugin.settings.llm.templates[idx];
          if (!target) return;
          target.providerId = null;
          target.modelId = null;
          await this.plugin.saveData(this.plugin.settings);
          tpl.providerId = null;
          tpl.modelId = null;
          refreshModelLabel();
        }),
      );
      for (const p of this.plugin.settings.llm.providers) {
        if (p.models.length === 0) continue;
        menu.addItem((item) =>
          item.setTitle(`${p.name} ▸`).setDisabled(true),
        );
        for (const m of p.models) {
          menu.addItem((item) =>
            item.setTitle(`  ${m.name || "（未命名模型）"}`).onClick(async () => {
              const target = this.plugin.settings.llm.templates[idx];
              if (!target) return;
              target.providerId = p.id;
              target.modelId = m.id;
              await this.plugin.saveData(this.plugin.settings);
              tpl.providerId = p.id;
              tpl.modelId = m.id;
              refreshModelLabel();
            }),
          );
        }
      }
      menu.showAtMouseEvent(evt as MouseEvent);
    });

    // 思考下拉（默认/开/关/自定义），紧跟「选择模型」之后。选「自定义」展开 JSON 框。
    const thinkingRow = setting.controlEl.createDiv({
      cls: "mv-obcc-llm-tpl-thinking-row",
    });
    const thinkingLabel = thinkingRow.createEl("span", {
      text: "思考",
      cls: "mv-obcc-llm-tpl-thinking-label",
    });
    void thinkingLabel;
    const thinkingSelect = thinkingRow.createEl("select");
    for (const opt of [
      { value: "default", text: "默认" },
      { value: "on", text: "开" },
      { value: "off", text: "关" },
      { value: "custom", text: "自定义" },
    ]) {
      const o = thinkingSelect.createEl("option", { value: opt.value, text: opt.text });
      if ((tpl.thinkingMode ?? "default") === opt.value) o.selected = true;
    }
    const customBox = thinkingRow.createEl("input", { type: "text" });
    customBox.addClass("mv-obcc-llm-tpl-thinking-custom");
    customBox.placeholder = '自定义 JSON，如 {"thinking":{"type":"enabled"}}';
    customBox.value = tpl.thinkingCustom ?? "";
    const refreshCustomVisibility = () => {
      customBox.style.display = thinkingSelect.value === "custom" ? "" : "none";
    };
    refreshCustomVisibility();
    thinkingSelect.addEventListener("change", async () => {
      const target = this.plugin.settings.llm.templates[idx];
      if (!target) return;
      target.thinkingMode = thinkingSelect.value as LlmThinkingMode;
      await this.plugin.saveData(this.plugin.settings);
      refreshCustomVisibility();
    });
    customBox.addEventListener("change", async () => {
      const target = this.plugin.settings.llm.templates[idx];
      if (!target) return;
      target.thinkingCustom = customBox.value;
      await this.plugin.saveData(this.plugin.settings);
    });

    // 到位的小字提示（固定通用）。
    const thinkingHint = setting.infoEl.createEl("div", {
      text:
        "💡 思考下拉决定是否在请求中携带思考参数：" +
        "开 = {\"thinking\":{\"type\":\"enabled\"}}、关 = {\"thinking\":{\"type\":\"disabled\"}}、" +
        "自定义 = 你填的 JSON。默认 = 不发送任何思考参数（安全）。" +
        "是否被模型实际采纳取决于模型与端点，不支持的模型可能报错或忽略。",
      cls: "mv-obcc-llm-tpl-hint-thinking",
    });
    void thinkingHint;

    const enableRow = setting.controlEl.createDiv({
      cls: "mv-obcc-llm-tpl-enable-row",
    });
    const enableToggle = enableRow.createEl("input", { type: "checkbox" });
    enableToggle.checked = tpl.enabled;
    enableToggle.id = `mv-obcc-llm-tpl-enabled-${idx}`;
    const enableLabel = enableRow.createEl("label", { text: "启用" });
    enableLabel.setAttribute("for", enableToggle.id);
    enableToggle.addEventListener("change", async () => {
      const target = this.plugin.settings.llm.templates[idx];
      if (!target) return;
      target.enabled = enableToggle.checked;
      if (
        !target.enabled &&
        this.plugin.settings.llm.autoTriggerTemplateId === target.id
      ) {
        this.plugin.settings.llm.autoTriggerTemplateId = null;
      }
      await this.plugin.saveData(this.plugin.settings);
      this.plugin.refreshLlmFeature();
      new Notice(
        target.enabled ? `已启用：${target.label}` : `已关闭：${target.label}`,
        3000,
      );
    });

    setting.addExtraButton((btn) =>
      btn
        .setIcon("trash")
        .setTooltip("删除该模板")
        .onClick(async () => {
          const [removed] = this.plugin.settings.llm.templates.splice(idx, 1);
          if (
            removed &&
            this.plugin.settings.llm.autoTriggerTemplateId === removed.id
          ) {
            this.plugin.settings.llm.autoTriggerTemplateId = null;
          }
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.refreshLlmFeature();
          this.display();
        }),
    );
  }
}
