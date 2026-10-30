# Inkwell

> 一个为「问题定位」而生的 Markdown 工作台：随时召出、随手记录、一键复制。

基于 **Electron 38.8.6 + React + TypeScript + Three.js**。所有笔记都是本地 `.md` 纯文本；除了你主动发起 AI 对话，不联网、不上传。

## 为什么是它

排查线上问题时，信息是碎片的：一段报错、一条命令、一个配置值。它们需要被**快速记下**，更需要**随时找回来复制**。
Inkwell 把这件事压缩成一次按键：召出 → 粘贴/翻找 → 复制 → 自动收起。

## 功能

| 能力 | 说明 |
| --- | --- |
| 全局秒召 | 任意界面按 `Alt+Space`（被占用时自动退让到 `Ctrl+Alt+Space` / `Alt+M`），窗口出现在光标所在屏幕；失焦自动收起 |
| 双栏编辑 | 左写右看，中间可拖拽分栏；`Ctrl+E` 在编辑 / 分栏 / 预览间切换；600ms 自动保存 |
| 多标签 | 同时开多篇文档对照，关闭前自动落盘 |
| 全文搜索 | `Ctrl+K`，同时匹配标题与正文，命中行高亮 |
| 片段库 | 常用命令/模板存一条，点一下复制；`Ctrl+Shift+V` 把剪贴板内容直接存成片段 |
| 剪贴板历史 | 自动记录最近 80 条复制的文本（本地 JSON），随时翻回去再复制 |
| 代码块 | 语法高亮 + 一键复制，长命令横向滚动 |
| 富渲染 | ` ```mermaid ` 流程图/时序图、` ```markmap ` 思维导图、` ```json ` 可折叠树，每个块都能切「源码 / 渲染」 |
| 任务清单 | `- [ ]` 直接点选，改动写回 Markdown 源文件 |
| 大纲 | 右侧提取全文标题，点击跳转 |
| 图片 | 直接粘贴截图，自动存入 `assets/` 并在文中引用 |
| 拖入导入 | 把 `.md` 文件拖进窗口即复制到笔记库 |
| 导出 | 一键导出独立 HTML（图片内联为 base64） |
| AI 助手 | 右侧面板，多模型档案、流式输出（含思维链）、9 个技能卡片、选区浮条、`Ctrl+J` 开关 |
| AI 改稿 | 回答可「插入 / 替换全文 / 新文档」，替换前先看 diff，应用后 20s 内 `Ctrl+Z` 可撤回 |
| 问笔记库 | `Ctrl+K` 搜索后按 `Tab`，把命中的笔记作为上下文直接问 AI |
| 外观 | 深/浅/跟随系统 × 5 套强调色，Three.js 点阵波场背景（可关闭），细节动效 |
| 常驻 | 托盘菜单、窗口置顶、开机自启、单实例 |

## 富渲染

三种块都走同一套「水合」逻辑（`lib/rich.ts`），首屏只输出占位骨架，进入视口后按需加载对应渲染器，所以大文档不会被图表拖慢。

| 语言标记 | 渲染结果 | 交互 |
| --- | --- | --- |
| `mermaid` / `mmd` | 流程图、时序图、甘特图等 | 跟随主题切换配色；失败时显示错误原因而不是白屏 |
| `markmap` / `mindmap` | 可折叠思维导图 | 拖拽平移、滚轮缩放、双击复位；容器尺寸变化自动重新适配 |
| `json` / `jsonc` | 可折叠键值树 | 点 key 复制 JSONPath；「全部展开 / 收起到 1 层 / 复制 JSON」 |

超过 600KB 的 JSON 会退化为源码视图，避免一次性铺开卡住渲染进程。

## AI 助手

面板在右侧，`Ctrl+J` 开关，宽度可拖拽（320–680px）。设计参考了 agent 的「档案 + 指令 + 技能」分层：

- **模型档案**：接口地址、API Key、模型名、温度、最大输出。设置了 6 个预设（DeepSeek / 智谱 GLM / Moonshot / 通义千问 / OpenAI / 本地 Ollama），填 Key 即可用，支持一键测连通性。
- **上下文**：底部两个 chip 控制是否附带「本文」「选区」，注入 system prompt 时截断到约 24k / 8k 字符。
- **流式**：OpenAI 兼容的 `chat/completions` SSE，逐字上屏；兼容 `reasoning_content`（思维链折叠显示）、`stream_options.include_usage`，中途可停止。
- **技能**：读懂这篇、提取待办、润色改写、接着写、解释报错、画个流程图、转成脑图、整理成表、译成英文——都是「当前文档 + 一句话指令」的组合，省去反复打提示词。
- **改稿闭环**：回答里的「替换全文」不会直接生效，先弹 diff 确认，应用后 20 秒内 `Ctrl+Z` 撤回。
- **会话**：按文档维度留存历史，可自动用首轮内容给文档起标题（设置里可关）。

> 不填模型也能用——富渲染、搜索、片段这些本地能力不依赖网络。

## 快捷键

| 快捷键 | 作用 |
| --- | --- |
| `Alt+Space` | 召出 / 收起窗口 |
| `Ctrl+K` | 搜索（标题 + 全文）；输入后按 `Tab` 直接问 AI |
| `Ctrl+J` | 打开 / 收起 AI 面板 |
| `Ctrl+N` | 新建文档 |
| `Ctrl+S` | 立即保存 |
| `Ctrl+E` | 切换 编辑 / 分栏 / 预览 |
| `Ctrl+B` | 收起 / 展开侧栏 |
| `Ctrl+Z` | AI 改稿后 20 秒内撤回 |
| `Ctrl+Shift+V` | 把剪贴板内容存为片段 |
| `Ctrl+,` | 设置 |
| `Esc` | 依次关闭 选区浮条 / 搜索 / 模型 / diff / 设置 / 大纲 / 收起窗口 |

## 数据位置

- 笔记：`%USERPROFILE%\Documents\Inkwell`（可在设置里更换）
- 配置、片段、剪贴板历史：`%APPDATA%\inkwell\`
  - `config.json` / `snippets.json` / `clipboard.json`
  - `models.json` 模型档案（**API Key 明文存放**，仅本地）
  - `sessions.json` AI 会话历史

## 运行与编译

### 环境要求

| 依赖 | 版本 |
| --- | --- |
| Node.js | ≥ 18（推荐 20 LTS） |
| npm | ≥ 9 |
| Electron | 38.8.6（已锁定在 devDependencies，装依赖时自动下载） |
| 系统 | Windows 10/11；macOS / Linux 亦可跑开发模式 |

### 1. 安装依赖

```bash
npm install
```

国内网络建议走镜像，否则 Electron 二进制（约 100MB）容易卡住：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
npm install --registry=https://registry.npmmirror.com
```

PowerShell 里等价写法：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
npm install --registry=https://registry.npmmirror.com
```

装完可自查二进制是否就位：

```bash
ls node_modules/electron/dist/          # 应能看到 electron.exe
node -e "console.log(require('electron/package.json').version)"   # 38.8.6
```

### 2. 开发模式（热更新）

```bash
npm run dev
```

`electron-vite dev` 会同时起渲染层的 Vite Dev Server 和 Electron 主进程，改 `src/renderer` 下的代码即时热更新，改主进程 / preload 自动重启窗口。

### 3. 类型检查（可选）

```bash
npm run typecheck
```

分别用 `tsconfig.web.json`（渲染层）和 `tsconfig.node.json`（主进程 / preload）做 `--noEmit` 检查。Vite 构建本身不做类型校验，改完代码建议跑一次。

### 4. 编译

```bash
npm run build
```

`electron-vite build` 会并行产出三份 bundle 到 `out/`：

```
out/
  main/index.js         主进程（CJS，Node 侧依赖保持 external）
  preload/index.js      预加载脚本（CJS，contextBridge 桥接层）
  renderer/
    index.html          页面入口
    assets/*.css        styles.css 打包结果
    assets/*.js         React + three.js + markdown-it + highlight.js
                        （mermaid / markmap / katex 走按需分包）
```

编译期关键点：

- `electron.vite.config.ts` 里 `main` / `preload` 用了 `externalizeDepsPlugin()`，`electron` 等 Node 侧依赖不打进 bundle，运行时直接从 `node_modules` / Electron 内置模块解析。
- 渲染层是普通 Vite 构建，`@` 别名指向 `src/renderer/src`。
- mermaid（约 1.1MB）、markmap 与 katex 都是动态 `import()`，首次遇到对应代码块才拉分包，因此主 chunk 不含它们；`build.chunkSizeWarningLimit` 已放宽，构建时的体积提示可忽略。
- 主进程启动时若存在 `ELECTRON_RENDERER_URL` 走 Dev Server，否则 `loadFile(out/renderer/index.html)`——所以编译产物是自包含的，不需要起 HTTP 服务。
- `resources/` 目录（应用与托盘图标）在开发/编译运行时按 `__dirname/../../resources` 读取；图标由 `node build/make-icons.js` 生成，仓库里已带成品，一般不用重跑。

### 5. 运行编译产物

```bash
npm start
```

等价于 `electron-vite preview`：以 Electron 直接加载 `out/`，用来在上线前验证生产构建的表现（这一步和 `npm run dev` 的差异主要在热更新与 sourcemap）。

### 常见问题

- **启动后没窗口、进程秒退**：终端里可能带着 `ELECTRON_RUN_AS_NODE=1`（部分 Electron 宿主会注入），Electron 会退化成 Node 模式。先 `unset ELECTRON_RUN_AS_NODE`（PowerShell：`Remove-Item Env:ELECTRON_RUN_AS_NODE`）再启动。
- **`Alt+Space` 没反应**：被输入法或其他启动器占用时会自动退让到 `Ctrl+Alt+Space`、`Alt+M`，实际生效的快捷键在设置面板里能看到。
- **想改成安装包**：本次交付只到"能编译、能运行"。需要分发时自行 `npm i -D electron-builder`，在 `package.json` 加 `build` 字段与 `dist` 脚本即可（`out/**/*` + `resources/**` 为打包内容）。

## 结构

```
src/
  main/index.ts        主进程：窗口、全局热键、文件库、剪贴板监听、托盘、IPC
  main/ai.ts           AI 侧：模型档案、SSE 流式转发、中断、会话存取
  preload/index.ts     contextBridge 暴露的安全 API
  renderer/src/
    App.tsx            状态编排（标签、保存、搜索、快捷键、主题、diff/撤回）
    components/        Sidebar / Preview / SearchPalette / SettingsDialog / ThreeBackground
                       AiPanel / MessageBody / DiffDialog / ModelsDialog / Icons
    lib/markdown.ts    markdown-it 渲染、任务清单、目录提取、导出样式、富块分发
    lib/rich.ts        mermaid / markmap / JSON 水合渲染
    lib/ai.ts          system prompt 拼装、技能定义、token 估算、diff 解析
    styles.css         设计令牌与全部样式（含 明暗 × 5 强调色）
build/make-icons.js    用纯 Node 生成应用 / 托盘 PNG 图标
```

## 已知边界

- 富渲染不做无限下钻：单块超过 600KB 的 JSON、超过 300 项的数组会截断或退化为源码。
- AI 只对接 OpenAI 兼容的 `/v1/chat/completions`，不兼容 Anthropic / Gemini 原生协议（可用其 OpenAI 兼容网关）。
- API Key 明文存在 `models.json`，没有做系统密钥链加密；共享电脑上建议用本地模型。
