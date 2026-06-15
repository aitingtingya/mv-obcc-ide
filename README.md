# MV OBCC

**MV OBCC** 是一款专为 Claude Code 打造的 Obsidian 桌面端桥接插件。它能够在您的本地代码环境与 Obsidian 知识库之间建立无缝的数据通道，并在后台被动运行。

本插件包含两个相对独立的核心能力：
1. **IDE 桥接 (IDE Bridge)**：为 Claude Code 提供 Obsidian 当前的上下文信息（如当前标签、选区内容），并支持通过标准 MCP 协议调用特定工具以及审核代码差异（Diff）。
2. **划词助手 (LLM Assistant)**：完全独立于 IDE 桥接的内置功能。允许您在 Obsidian 的各种视图（Markdown、PDF、Web Viewer）中选中文本后，通过自定义提示词直接流式调用 OpenAI 或 Anthropic 兼容的语言模型 API。

---

## 安装指南

安装本插件有两种方式：**手动安装（最快最方便，无需编译）** 或 **从源码自行构建**。

### 方法一：手动从 Release 安装（推荐，适合非开发者）

1. 前往 GitHub 仓库的 [Releases](https://github.com/aitingtingya/mv-obcc/releases) 页面，下载最新版本（如 `0.3.5`）的以下三个资产文件：
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. 在您的 Obsidian Vault 插件目录下新建文件夹，路径为：`<vault>/.obsidian/plugins/mv-obcc/`
3. 将下载的这三个文件复制到该文件夹中。
4. 重启或刷新 Obsidian，进入**设置 -> 第三方插件**，找到 `MV OBCC` 并启用它。
   *(注意：请确保关闭同 Vault 下的其他 Claude Code IDE 桥接插件以避免冲突)*

### 方法二：从源码构建安装

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
1. 确保 Obsidian 已启动且 `MV OBCC` 插件处于启用状态。
2. 在与该 Obsidian Vault 对应的本地目录中启动 Claude Code。
3. 验证连接状态：
   - 在 Claude Code 终端输入 `/ide`，应提示已连接到 Obsidian。
   - 输入 `claude mcp list`，应当能看到 `mv-obcc`（或其提供的工具）已连接。

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

### ✍️ 划词助手功能 (独立功能)

划词助手完全独立于 IDE 桥接，不依赖 Claude Code 即可使用。

1. **配置 API**：在插件设置中的“划词助手”区域，添加您的模型提供商（如 OpenAI 兼容端点或 Anthropic），并配置 API Base URL、API Key 及模型名称。
2. **配置提示词**：您可以配置多个提示词模板。支持 `{selection}` 占位符；若不包含，则划词内容会自动附加在末尾。
3. **触发方式**：
   - **Markdown / Web Viewer 视图**：划词后，可以通过右键菜单选择 `LLM -> {您的模板}`，或者通过 Obsidian 的快捷键系统绑定相应的命令触发。
   - PDF视图：由于 PDF 视图右键菜单被 Obsidian 占用，默认只能使用快捷键触发。
4. **结果输出**：触发后会立即在窗口上方弹出**悬浮窗**，流式输出回答，并具有以下优化体验：
   - **不干扰操作**：生成回答时，您依然可以自由编辑或浏览原页面。
   - **支持拖拽与缩放**：可以通过拖拽标题栏移动悬浮窗位置，并能拖动边缘自由调整大小。
   - **Markdown 原生预览与就地编辑**：悬浮窗内嵌了 Obsidian 原生的 Markdown 编辑器（后台使用单例临时文件支撑，该临时文件夹已自动在文件树和全局搜索中隐藏），为您提供原生的排版显示与直接编辑修改能力。
   - **便捷写入**：生成完毕后支持一键在原编辑器中“插入到光标处”或“替换选区”。

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
