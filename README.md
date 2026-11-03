# Inkwell

> 一个为「问题定位」而生的 Markdown 工作台：随时召出、随手记录、一键复制。

基于 **Electron 38.8.6 + React + TypeScript + Three.js**。所有笔记都是本地 `.md` 纯文本；除了你主动发起 AI 对话，不联网、不上传。

## 为什么是它

排查线上问题时，信息是碎片的：一段报错、一条命令、一个配置值。它们需要被**快速记下**，更需要**随时找回来复制**。
Inkwell 把这件事压缩成一次按键：召出 → 粘贴/翻找 → 复制 → 自动收起。

## 功能

| 能力 | 说明 |
| --- | --- |
| 全局秒召 | 任意界面按 `Alt+M`（被占用时自动退让到 `Ctrl+Alt+M` / `Ctrl+Shift+M`），窗口出现在光标所在屏幕；失焦自动收起 |
| 双栏编辑 | 左写右看，中间可拖拽分栏；`Ctrl+E` 在编辑 / 分栏 / 预览间切换；600ms 自动保存 |
| 多标签 | 同时开多篇文档对照，关闭前自动落盘 |
| 文件夹 | 侧栏目录树、可折叠；文档**和文件夹都能拖**：拖到文件夹中间即移入，拖到某行上下边缘则插到那个位置（自定义排序，重启后保持），拖到空白处回到根目录末尾；不支持拖进自己或自己的子目录 |
| 新建位置 | 右上角「＋」默认建在**根目录**，当前文档在子文件夹时，菜单里会额外给出「新建到『xxx』」一组 |
| 文件夹操作 | 行内悬停可直接建文档 / 建子文件夹 / 在资源管理器打开；右键可重命名、删除（非空会拒绝，提示先移出文档） |
| 全文搜索 | `Ctrl+K`，同时匹配标题与正文，命中行高亮 |
| 片段库 | 常用命令/模板存一条，点一下复制；`Ctrl+Shift+V` 把剪贴板内容直接存成片段 |
| 剪贴板历史 | 自动记录最近 80 条复制的文本（本地 JSON），随时翻回去再复制 |
| 代码块 | 语法高亮 + 一键复制，长命令横向滚动 |
| 富渲染 | ` ```mermaid ` 流程图/时序图、` ```markmap ` 思维导图、` ```json ` 可折叠树，每个块都能切「源码 / 渲染」 |
| 任务清单 | `- [ ]` 直接点选，改动写回 Markdown 源文件 |
| 大纲 | 右侧提取全文标题，点击跳转：预览滚到标题并闪一下，编辑区光标同步落到标题行 |
| 所在目录 | 标题栏显示当前文件所在目录（如 `排查 / 502`），点一下直接在资源管理器打开 |
| 图片 | 直接粘贴截图，自动存入 `assets/` 并在文中引用 |
| 拖入导入 | 把 `.md` 文件拖进窗口即复制到笔记库 |
| 导出 | 一键导出独立 HTML（图片内联为 base64） |
| AI 助手 | 右侧面板，多模型档案、流式输出（含思维链）、9 个技能卡片、选区浮条、`Ctrl+J` 开关 |
| 选区上下文 | 预览里选中即有浮条（字数 + 是否已带入 AI），AI 面板底部出现可折叠引用卡，能看原文、能一键取消 |
| 多文档上下文 | AI 面板点「上下文」勾选任意多篇笔记带进本轮对话，每篇标字数，总预算 8k–128k 可调，超预算自动压缩并标注 |
| AI 自己找资料 | 24 个内置工具：看目录树、按行读文档、全库检索、取大纲、翻引用关系、翻片段与剪贴板、读网页；最多 12 轮，调用链在回答顶部可展开 |
| 链接图 | 自动解析文档里的 `[文字](./路径.md)`，点预览里的链接直接跳转；底部显示本文引用 / 被引用 / 失效链接；预览里的失效链接标红并虚线，鼠标悬停给出原始路径（索引早就知道哪条解析不到，只是以前没画出来）；移动或改名文档时自动改写指向它的链接，路径不会因为挪位置而失效；AI 读文档时直接拿到这份关系，不用自己试探路径 |
| AI 写文档 | `create_doc` / `create_folder` / `move_entry` 直接生效；`edit_doc` / `delete_entry` / `replace_in_docs` 只生成待确认卡片，点确认才落盘 |
| AI 会规划 | 多步任务自动出执行计划（面板上可看进度），信息不足时弹选项卡让你拍板 |
| 子智能体 | 派研究员 / 写作者 / 审校者各带独立上下文与工具白名单跑子任务，只回结论 |
| 技能包 | `skills/*.md` 操作手册，命中场景自动加载；跑通流程后一句话固化成新技能 |
| MCP | 设置里贴 `mcpServers` 配置即可拉起外部工具，工具名 `mcp__server__tool` |
| AI 改稿 | 回答可「插入到光标处 / 追加到文末 / 替换全文 / 新文档」，替换前先看 diff，应用后 20s 内 `Ctrl+Z` 可撤回 |
| 问笔记库 | `Ctrl+K` 搜索后按 `Tab`，把命中的笔记作为上下文直接问 AI |
| 外观 | 深/浅/跟随系统 × 5 套强调色，Three.js 点阵波场背景（可关闭），细节动效 |
| 常驻 | 托盘菜单、窗口置顶、开机自启、单实例 |
| 窗口 | 无边框自绘标题栏，支持最大化 / 还原（最大化时自动去掉圆角与投影贴合屏幕边缘） |

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

- **模型档案**：照 iCode 的做法只留一个「服务商」下拉——OpenAI 兼容 / DeepSeek / 智谱 GLM / 本地 Ollama，选中后地址、模型 ID、上下文窗口、输出上限自动套默认值，改一下 Key 就能用；其余服务（Moonshot、通义、vLLM、各种中转）都选「OpenAI 兼容」，把地址换成自己的。常用参数只有名称 / 模型 ID / 接口地址 / API Key 四项，温度、上下文窗口、输出上限、额外请求头收在「高级参数」里，支持一键测连通性。上下文窗口会反过来限制 AI 面板里上下文预算滑块的上限。
- **上下文**：底部 chip 控制是否附带「本文」「选区」；点「上下文」可勾选任意多篇笔记一起带进来（会话级作用域，切会话各自独立）。每篇显示字数，总预算用滑块在 8k–128k 之间调，超预算时先均分、再把剩余额度补给需要的篇目，被截断的那篇会在 prompt 里注明「可用 read_doc 读后续」。
- **工具**：带 `tools: true` 的请求会附上 24 个本地函数，分五类——**读**（`list_tree` 目录树、`list_docs`、`read_doc` 支持按行读、`search_docs`、`get_outline` 标题树、`list_snippets`、`list_clips`、`fetch_url`）、**链接**（`get_links` 出入链与失效链接、`expand_doc` 邻域摘要、`find_link_path` 两篇之间的引用链）、**写**（`create_doc`、`edit_doc`、`create_folder`、`move_entry`、`delete_entry`、`replace_in_docs` 批量替换、`save_snippet`）、**编排**（`todo_write`、`ask_user`、`delegate`）、**技能**（`list_skills`、`load_skill`、`create_skill`）。上限 12 轮 / 40 次调用 / 单轮 8 分钟；429、5xx、网络抖动在还没吐内容时自动重试两次。面板实时显示「读取 xxx 中…」，回答顶部可展开完整调用链，子智能体的调用带 ↳ 缩进。模型不支持 tools 时退化成纯对话并提示一次。
- **链接理解**：主进程把整库解析成一张引用图（`src/main/links.ts`），目录扫描只做 stat，内容只在 mtime / 大小变化时重读；1213 篇文档冷启动约 90ms、增量约 30ms。解析只按 Markdown 路径语义：相对当前文档所在目录，`/` 开头算库根，跳过代码块与行内代码。**刻意不做任何回退**——不回退到库根同名文件、不拿链接文字去猜标题。以前那套兜底会让写错的链接被猜中，界面显示正常、实际指向的却是另一篇，等于替作者把错误掩盖了；现在找不到就如实标为失效。配合「移动/改名时自动改写指向它的链接」，路径不会因为挪位置而变错，也就不需要猜。这份图同时喂给三处：`read_doc` 把正文里的链接就地标注成解析结果并在末尾附引用清单；对话开始前把当前文档的出入链（含摘要）注入 system prompt；预览底部渲染成「引用 / 被引 / 失效」面板。设置页能看到篇数、引用数、断链数、歧义数与索引耗时，可手动重建。
- **写文档的边界**：`create_doc`、`create_folder`、`move_entry` 立即生效（都可逆）；`edit_doc`、`delete_entry`、`replace_in_docs` 只登记提案，输入框上方出现卡片，改稿是「建议修改《标题》 +N −M」，删除是红框「删除《标题》 进回收站」，都要点确认才落盘。提案带版本校验：如果你在 AI 提案之后自己改了正文，应用时会提示「文档在这期间被改过，这条提案作废了」，不会覆盖你正在写的内容。落盘后可 `Ctrl+Z` 撤回。
- **撤销这一轮**：一轮对话只要真动过磁盘（移动/改名、连带改写的引用、应用过的提案、新建的文档），回答底部就会出现「这次动了 N 处：移动到「归档」 撤销」。点一下按时间倒序整轮回退——文件挪回原位、被改写的链接恢复原文、AI 新建的文档进回收站。冲突保护是硬条件：某个文件在这之后又被改过，就只还原位置、不动正文，并告诉你跳过了几个。撤销之后界面会重读被还原的文件，编辑器不会停在撤销前那份内容上（否则随手改一个字再自动保存，失效链接又会被写回磁盘）。你自己在侧栏拖拽/改名时，同样的撤销挂在操作后的提示条上。撤销栈是主进程的事务记录（最近 30 步，重启清空），删除不进栈——回收站没有跨平台还原接口。
- **改写看得见**：移动或改名连带改写了别的文档时，提示条会写「已移动到「归档」· 更新了 2 处引用」，点「查看」列出每一处：哪个文件、第几行、`旧路径 → 新路径`。没能自动改写的（原文被别处改过、行号对不上、读不到文件）单独列一段并写明原因——自动改多篇文档这件事，不该只给一个数字。
- **计划可见**：任务超过三步时模型会调 `todo_write`，面板上出现带勾选的执行计划（待办 / 进行中 / 已完成），每推进一步就刷新，不再是一个黑盒转圈。
- **卡住会问你**：信息不足时它调 `ask_user` 弹一张选项卡（2–4 个选项 + 跳过），你点完它继续，不用重新打字描述。5 分钟没答就自己按判断往下走。
- **子智能体**：`delegate` 派出 researcher（只读检索汇总）/ writer（写文档）/ reviewer（挑错）三个角色，各自独立上下文、独立工具白名单，跑完只回一段结论。适合「先把十几篇通读一遍再汇总」这种吃上下文又不需要主对话逐句看的活。白名单在执行层校验——schema 只是建议，越权调用会被直接拒绝。
- **技能包**：`~/.config/inkwell/skills/*.md`，front-matter 写「什么时候用」，正文是操作手册。平时只有名字和适用场景进提示词，命中才 `load_skill` 读正文。自带「排查记录归档」「周报生成」「Mermaid 修复」三个示例；跑通一套流程后可以直接说「把这套流程存成技能」，它用 `create_skill` 写进去。设置页能看、能删、能打开目录。
- **MCP**：设置里贴一份 `mcpServers` 配置（stdio 方式，`command` + `args`），保存后拉起子进程、握手、拉工具清单，下一轮对话就能用，工具名形如 `mcp__server__tool`。状态栏显示每个服务的连接结果与工具数，失败会给出原因（握手超时、命令不存在等）。不需要第三方 SDK，协议层自己实现。
- **上下文压缩**：历史超过预算一半就先按轮次折叠——assistant 的 tool_calls 与随后的 tool 结果同生同灭，避免协议错乱；最近三轮完整保留，更早的压成「问 / 答 / 用了哪些工具」三行摘要。还压不下去就调一次模型做真正的摘要，失败自动退回折叠结果，不会因为压缩不了而中断对话。
- **流式**：OpenAI 兼容的 `chat/completions` SSE，逐字上屏；兼容 `reasoning_content`（思维链折叠显示）、`stream_options.include_usage`，中途可停止。
- **技能**：读懂这篇、提取待办、润色改写、接着写、解释报错、画个流程图、转成脑图、整理成表、译成英文——都是「当前文档 + 一句话指令」的组合，省去反复打提示词。
- **改稿闭环**：回答里的「替换全文」不会直接生效，先弹 diff 确认，应用后 20 秒内 `Ctrl+Z` 撤回。
- **插入到光标处**：在正文点好位置（或选中一段要替换的文字），再去点回答上的「插入到光标处」，内容就落在那个点上，光标跟着落到插入块末尾，提示「已插入到第 N 行」并自动把这段滚进视野。位置是记下来的——切到 AI 面板后编辑器失焦也不会丢；有选区时按选区替换，不额外加空行；块级内容（多行、标题、列表、代码块）会自动和上下文隔一个空行，避免粘在一起。真没有光标（比如刚打开文档就插）会老实追加到文末，并在提示里说明。想直接追加的话用旁边的「文末」。
- **会话**：按文档维度留存历史，可自动用首轮内容给文档起标题（设置里可关）。
- **提示词**：`lib/ai.ts` 里的 `BASE_INSTRUCTIONS` 是参考 iCode 的 AgentProfile 思路写的——instructions 保持短，把「怎么做」交给规则和工具：结论先行、引用标出处、材料里没有的就明说没有、命令原样保留、链路优先 mermaid。上下文用 `<context-files>` / `<library>` / `<selection>` 三段结构化注入，模型分得清「用户给的材料」和「库里的路径清单」。

> 不填模型也能用——富渲染、搜索、片段这些本地能力不依赖网络。

## 快捷键

| 快捷键 | 作用 |
| --- | --- |
| `Alt+M` | 召出 / 收起窗口 |
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
- **`Alt+M` 没反应**：被输入法或其他程序占用时会自动退让到 `Ctrl+Alt+M`、`Ctrl+Shift+M`，实际生效的快捷键在设置面板里能看到。
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
- 多文档上下文按字符预算截断，不做向量检索：几万字的笔记库够用，上千篇且需要语义召回时需要另建索引。
- 模型不支持 function calling 时（部分小模型 / 代理层），读文档能力退化为「只用已带入的内容」，界面会提示一次；写文档同理不可用，只能手动点回答上的「插入到光标处 / 替换全文」。
- 写提案只存在内存里：应用前关掉应用，提案就没了（文档不会被改坏，只是要重新让 AI 提一次）。
