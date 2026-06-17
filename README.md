# mv-SenceAI

**mv-SenceAI** 是一款专为 Obsidian 打造的 AI 笔记、科研插件。它能够在您的本地代码环境与 Obsidian 知识库之间建立无缝的数据通道。

本插件包含三个相对独立的核心能力：
1. **IDE 桥接 (IDE Bridge)**：为 Claude Code 提供 Obsidian 当前的上下文信息（如当前标签、选区内容），并支持通过标准 MCP 协议调用特定工具以及审核代码差异（Diff）。
2. **划词助手 (LLM Assistant)**：完全独立于 IDE 桥接的内置功能。允许您在 Obsidian 的各种视图（Markdown、PDF、Web Viewer）中选中文本后，通过自定义提示词直接流式调用 OpenAI 或 Anthropic 兼容的语言模型 API。
3. **行内补全 (Inline Completion)**：在 Markdown 编辑器中显示 ghost text 续写建议，可通过左侧功能区按钮按需点亮，并支持接受、取消、拒绝后重新生成。

---

## 安装指南

安装本插件有两种方式：**手动安装（最快最方便，无需编译）** 或 **从源码自行构建**。

### 方法一：插件已经上架obsidian官方插件社区，搜索mv-SenceAI 即可找到并安装
### 方法二：手动从 Release 安装

1. 前往 GitHub 仓库的 [Releases](https://github.com/aitingtingya/mv-senceai/releases) 页面，下载最新版本（如 `0.4.0`）的以下三个资产文件：
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. 在您的 Obsidian Vault 插件目录下新建文件夹，路径为：`<vault>/.obsidian/plugins/mv-obcc/`
3. 将下载的这三个文件复制到该文件夹中。
4. 重启或刷新 Obsidian，进入**设置 -> 第三方插件**，找到 `mv-SenceAI` 并启用它。
   *(注意：请确保关闭同 Vault 下的其他 Claude Code IDE 桥接插件以避免冲突)*

### 方法三：从源码构建安装

如果您通过克隆或下载了本仓库的源码，请执行以下命令来构建产物：

1. 在项目根目录下执行编译构建：
   ```bash
   # 安装所需依赖项
   npm ci

   # 编译并构建项目
   npm run build
   ```
2. 在您的 Obsidian Vault 的插件目录下新建文件夹，路径为：`<vault>/.obsidian/plugins/mv-obcc/`
3. 将构建生成的以下三个文件复制到该文件夹中：
   - `dist/main.js` (复制到目标文件夹后，需要确保文件名为 `main.js`)
   - `manifest.json`
   - `styles.css`
4. 重启或刷新 Obsidian，在**第三方插件**中启用它。

### 3. Claude Code 侧配置
1. 确保 Obsidian 已启动且 `mv-SenceAI` 插件处于启用状态。
2. 在与该 Obsidian Vault 对应的本地目录中启动 Claude Code。
3. 验证连接状态：
   - 在 Claude Code 终端输入 `/ide`，应提示已连接到 Obsidian。
   - 输入 `claude mcp list`，应当能看到 `mv-senceai-ide`（或其提供的工具）已连接。

---

## 使用指南

### IDE 桥接功能

- **被动状态感知**：开启后，您可以选择让插件追踪 Markdown、PDF 或是 Web Viewer。插件会将当前的标签页和选区状态被动同步给 Claude Code。
  - *多实例支持*：开启“支持所有活动页面”后，插件会精确绑定 Claude PID 和会话。当同时运行多个 Claude 时，每个会话只会隐藏自己的终端，依然可以读取其他终端的信息。
- **主动工具 (MCP)**：Claude Code 可以通过 HTTP MCP 协议主动调用插件提供的工具，例如：
  - `getLatestSelection`：读取最后一次非空选区。
  - `getOpenEditors`：获取所有已打开的标签列表。
  - `openFile`：在 Obsidian 中定位并打开特定的 Vault 文件。
  - `readCurrentWebPage`：无需刷新或跳转，直接将 Obsidian Web Viewer 中正在浏览的网页读取为 Markdown 格式。
- **差异可视化审核 (Diff)**：当 Claude 提议修改文件时，如果是需要授权的操作，插件会在 Obsidian 侧弹出基于 CodeMirror MergeView 的差异比对界面。您可以在界面内进行编辑和最终确认，确认后的内容会由 Claude 写入硬盘。

### ✍️ 划词助手功能 

划词助手完全独立于 IDE 桥接，不依赖 Claude Code 即可使用。

1. **配置 API**：在插件设置中的“API 提供商”区域添加模型提供商（如 OpenAI 兼容端点或 Anthropic）。API Base URL 和模型名称必填；API Key 仅在服务需要鉴权时必填，Ollama、LM Studio 等本地无鉴权服务可留空。
2. **配置提示词**：您可以配置多个提示词模板。支持 `{selection}` 占位符；若不包含，则划词内容会自动附加在末尾。
3. **触发方式**：
   - **Markdown / Web Viewer 视图**：划词后，可以通过右键菜单选择 `LLM -> {您的模板}`，或者通过 Obsidian 的快捷键系统绑定相应的命令触发。
   - PDF视图：由于 PDF 视图右键菜单被 Obsidian 占用，默认只能使用快捷键触发。
   - **自动触发**：可以在设置中指定一个已启用的提示词模板。指定后左侧功能区会出现“划词自动触发”按钮；每次启动默认关闭，点亮后仅在产生新选区时自动调用。
4. **结果输出**：触发后会立即在窗口上方弹出**悬浮窗**，流式输出回答，并具有以下优化体验：
   - **不干扰操作**：生成回答时，您依然可以自由编辑或浏览原页面。
   - **支持拖拽与缩放**：可以通过拖拽标题栏移动悬浮窗位置，并能拖动边缘自由调整大小；位置和尺寸会被记住。
   - **按需固定**：点击标题栏固定按钮后，后续调用会复用当前悬浮窗，插入或替换内容后也不会自动关闭；取消固定即可恢复默认行为。
   - **Markdown 原生预览与就地编辑**：悬浮窗内嵌了 Obsidian 原生的 Markdown 编辑器（后台使用单例临时文件支撑，该临时文件夹已自动在文件树和全局搜索中隐藏），为您提供原生的排版显示与直接编辑修改能力。
   - **便捷写入**：生成完毕后支持一键在原编辑器中“插入到光标处”或“替换选区”。

### ⌨️ 行内补全功能

行内补全只在 Markdown 编辑器中生效，不依赖 Claude Code。

1. **配置 API 提供商**：在设置中的“API 提供商”区域添加 Base URL、模型和可选 API Key。API Base URL 和模型必填；API Key 仅在服务需要鉴权时必填，本地无鉴权服务可留空。
2. **选择补全模型与思考参数**：在“行内补全”区域开启功能，并选择补全使用的提供商、模型和思考模式。思考模式支持默认、开、关和自定义 JSON。
3. **调整上下文长度**：可分别设置发送给模型的光标前、光标后 Markdown 源文本字符数；留空时使用默认值。插件不会解析 Markdown 或 LaTeX，公式、代码和表格都会作为纯文本忠实发送。
4. **点亮功能区按钮**：开启设置后，左侧功能区会出现“行内补全”按钮。按钮点亮时自动触发补全；未点亮时不会自动触发，但仍可通过“手动请求按键”请求一次。
5. **录制快捷键**：在设置页点击“录制”，直接按下想绑定的快捷键即可；接受和取消可恢复默认，拒绝和手动请求可清空不绑定。
   - 接受按键：插入当前 ghost text。
   - 取消按键：清空当前 ghost text，不请求模型。
   - 拒绝按键：可清空；绑定后，按下会把被拒绝的建议作为“需要避开的候选”发回模型，并请求一版替代补全。
   - 手动请求按键：可清空；绑定后，未点亮左侧按钮时也能按需请求一次补全。
6. **允许模型不补全**：当上下文已经完整或模型没有高置信建议时，插件会让模型返回“无补全”信号，并且不会显示 ghost text。
7. **自定义补全提示词**：设置页可以分别修改补全主体、无需补全指令和拒绝后重生成指令。拒绝后重生成指令支持 `{rejected}` 占位符，用来引用被拒绝的候选文本。

---

## 功能边界与注意事项

> [!WARNING]
> 请务必了解以下插件的限制与工作边界。

- **Web Viewer 读取限制**：
  无论是 MCP 提取网页全文，还是划词助手，只能提取当前已加载渲染为可见 DOM 文本的内容。以下类型的内容**无法保证被提取或划词**：
  - 跨域 iframe (Cross-origin iframes)
  - 封闭的 Shadow DOM
  - 纯 Canvas 渲染的页面
  - 图片内嵌的文字（无 OCR）
  - 尚未触发加载的无限滚动内容或 `display: none` 的隐藏数据。
- **PDF 视图限制**：
  依赖 Obsidian 内置的 PDF.js 文本层。扫描版 PDF 如果没有进行过 OCR 生成底层文本，将无法划词或读取。另外由于 PDF 视图右键菜单被 Obsidian 占用，请使用快捷键触发划词调用。
- **视觉隔离策略**：
  “切换标签时保留选区高亮”功能仅为视觉辅助，在您切换到终端等标签时，原页面的选词高亮依然保留。这不影响内部发送给 Claude 的实际内容。
- **配置的隔离性**：
  划词助手的网络错误、API Key 暴露或调用失败，均只影响划词助手自身，**绝对不会**波及或影响 Claude Code 桥接通道的稳定性。
- **桌面权限说明**：
  插件会读取和更新 Claude Code 的项目配置、会话信息与 IDE lock 文件，以建立和恢复桥接连接。进程识别与 MCP 注册仅通过 Node.js `execFile` 调用明确的可执行文件和参数，不拼接或执行任意 shell 命令。

## 鸣谢

行内补全的 CodeMirror ghost-text 架构设计参考了插件 [obsidian-github-copilot](https://github.com/Pierrad/obsidian-github-copilot)。

---

# mv-SenceAI (English Documentation)

**mv-SenceAI** is a desktop bridge connecting your local vaults to Claude Code. It runs passively in the background to streamline your developer workflow in Obsidian.

This plugin provides three key capabilities:
1. **IDE Bridge**: Feeds contextual information (active tab, selections) from your vault to Claude Code, supports MCP tools, and enables visual diff reviews (via CodeMirror MergeView).
2. **LLM Assistant (Selection Reader)**: A completely independent feature to call OpenAI or Anthropic compatible APIs directly from Obsidian views (Markdown, PDF, Web Viewer) using custom prompt templates, streaming responses into a floating output window.
3. **Inline Completion**: A separate Markdown-only ghost-text completion module with a ribbon toggle and configurable accept, cancel, and reject/regenerate keys.

---

## Installation Guide

You can install this plugin either **manually (simplest, no compilation needed)** or by **building from source**.

### Method 1: Manual Installation (Recommended)

1. Go to the [Releases](https://github.com/aitingtingya/mv-senceai/releases) page of this repository and download the latest release files:
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. Create a new folder named `mv-obcc` under your vault's plugins directory: `<vault>/.obsidian/plugins/mv-obcc/`
3. Copy the three downloaded files into this folder.
4. Restart or reload Obsidian, navigate to **Settings -> Community Plugins**, locate `mv-SenceAI`, and enable it.
   *(Note: Ensure you disable any other Claude Code bridge plugins in the same vault to prevent conflicts).*

### Method 2: Build From Source

If you prefer to clone and compile the source code yourself:

1. Clone this repository to your local machine.
2. In the project root directory, run:
   ```bash
   # Install dependencies
   npm ci
   # Compile and build the plugin
   npm run build
   ```
3. Create a folder named `mv-obcc` in your vault's plugins directory: `<vault>/.obsidian/plugins/mv-obcc/`
4. Copy the compiled files into the new directory:
   - `dist/main.js` (Rename this file to `main.js` in the destination folder)
   - `manifest.json`
   - `styles.css`
5. Enable the plugin in Obsidian settings.

---

## Feature Scope & Notes

> [!WARNING]
> Please review the limitations of the web reader and PDF highlights.
>
> - **Web Reader Limits**: Standard iframe and canvas reading limits apply.
> - **PDF Reading**: Scanned PDF pages without text layers cannot be read.
> - **Config Isolation**: Errors or issues with the LLM selection assistant will not affect the main Claude Code IDE bridge.
> - **Desktop Permissions**: The plugin reads and updates Claude Code project settings, session metadata, and IDE lock files to manage the bridge. Process detection and MCP registration use Node.js `execFile` with explicit executables and arguments; the plugin does not construct or execute arbitrary shell commands.

### LLM Assistant Interaction

- Configure an API Base URL and model name for each provider. An API key is only required when the endpoint uses authentication; it may be left empty for unauthenticated local services such as Ollama or LM Studio.
- Choose an enabled prompt template in settings to expose the **Selection auto-trigger** ribbon button. It starts disabled after every Obsidian launch and only fires when a new selection gesture is completed.
- The floating result window remembers its position and size. Pin it from the title bar to reuse the same window for later requests and keep it open after insert or replace actions.

### Inline Completion

- Enable Inline Completion in settings, choose a provider/model, configure thinking mode, and set separate raw Markdown context lengths before and after the cursor. Leaving either context length empty restores its default.
- Markdown and LaTeX are sent as source text. The plugin does not parse or skip formulas; the model decides the completion content.
- When enabled, the ribbon shows an Inline Completion button. While active, it triggers automatically; while inactive, automatic triggering is off but the manual request key can still request one completion.
- Click Record in settings, press the desired shortcut, and the plugin saves the CodeMirror-compatible binding automatically. Accept inserts the current ghost text, cancel clears it, reject asks for a replacement suggestion while treating the rejected text as a candidate to avoid, and manual request can be left unbound.
- If the surrounding Markdown is already complete or the model has no confident continuation, the plugin asks the model to return a no-completion signal and shows no ghost text.
- Inline prompt settings can customize the main completion prompt, the no-completion instruction, and the reject-regenerate instruction. The reject prompt supports `{rejected}` for the rejected candidate.

## Acknowledgements

The CodeMirror ghost-text architecture for Inline Completion was informed by plugin [obsidian-github-copilot](https://github.com/Pierrad/obsidian-github-copilot). mv-SenceAI does not bundle or depend on that plugin at runtime.
