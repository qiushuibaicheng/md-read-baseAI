import { createTwoFilesPatch } from 'diff'

export interface SkillContext {
  docTitle: string
  docContent: string
  selection: string
}

export interface AiSkill {
  id: string
  label: string
  hint: string
  /** 只输出可插入的内容（不要客套话） */
  insertable?: boolean
  build: (ctx: SkillContext, input: string) => string
}

export const SKILLS: AiSkill[] = [
  {
    id: 'summarize',
    label: '读懂这篇',
    hint: '提炼背景、结论、待办',
    build: (ctx) =>
      `请阅读下面这篇排查/工作记录，输出三个部分（用 Markdown 小标题）：\n1. **一句话结论**\n2. **关键事实**（时间、指标、命令、报错，逐条列出，保留原文中的数值）\n3. **还缺什么**（要定位到根因还缺的信息或下一步动作）\n\n<doc title="${ctx.docTitle}">\n${ctx.docContent}\n</doc>`
  },
  {
    id: 'todos',
    label: '提取待办',
    hint: '输出 - [ ] 清单',
    insertable: true,
    build: (ctx) =>
      `从下面这篇文档中提取所有待办事项，输出严格符合 Markdown 任务清单格式（每行以 "- [ ] " 开头），每条不超过 30 字，按优先级排序。只输出清单本身，不要任何解释。\n\n<doc>\n${ctx.docContent}\n</doc>`
  },
  {
    id: 'polish',
    label: '润色改写',
    hint: '保持原意的更清晰表达',
    insertable: true,
    build: (ctx, input) =>
      `把下面的内容改写得更清晰、更适合工作记录：去掉口语和重复，保留全部事实、数值与专有名词，不要新增信息，不要解释。直接输出改写后的 Markdown。\n\n<text>\n${input || ctx.selection || ctx.docContent}\n</text>`
  },
  {
    id: 'continue',
    label: '接着写',
    hint: '顺着当前上下文续写',
    insertable: true,
    build: (ctx) => {
      const tail = ctx.docContent.slice(-2500)
      return `下面是一篇 Markdown 文档的结尾部分，请顺着它的语气和结构继续写下去，补全尚未写完的内容。只输出需要新增的部分，不要重复已有内容，也不要用代码块包裹整段输出。\n\n<tail>\n${tail}\n</tail>`
    }
  },
  {
    id: 'explain',
    label: '解释报错',
    hint: '看堆栈/日志找根因',
    build: (ctx, input) =>
      `下面是一段报错或日志。请按这个结构回答：\n1. **这条报错在说什么**（翻译成人话，一句话）\n2. **最可能的三个原因**（按概率排序，每条给判断依据）\n3. **下一步验证命令**（可直接复制执行，注明作用）\n\n<text>\n${input || ctx.selection || ctx.docContent}\n</text>`
  },
  {
    id: 'diagram',
    label: '画个流程图',
    hint: '生成 mermaid 代码块',
    insertable: true,
    build: (ctx) =>
      `根据下面文档描述的链路/问题，画一张 Mermaid 流程图，帮助定位瓶颈。要求：\n- 使用 \`\`\`mermaid 围栏 + graph TD 或 sequenceDiagram\n- 节点文字简短（不超过 12 字），关键异常节点用不同样式标出\n- 只输出 mermaid 代码块，不要解释\n\n<doc>\n${ctx.docContent}\n</doc>`
  },
  {
    id: 'outline',
    label: '转成脑图',
    hint: '生成 markmap 代码块',
    insertable: true,
    build: (ctx) =>
      `把下面文档的层级结构整理成思维导图，输出一个 \`\`\`markmap 代码块：第一行是中心主题，下面用 Markdown 列表表示分支，最多四层，每条不超过 16 字。只输出代码块。\n\n<doc>\n${ctx.docContent}\n</doc>`
  },
  {
    id: 'table',
    label: '整理成表',
    hint: '把散落信息变表格',
    insertable: true,
    build: (ctx) =>
      `把下面文档里散落的关键信息整理成一张 Markdown 表格（列名自行判断，例如：时间 / 现象 / 指标 / 动作 / 结论）。没有的信息留空，不要编造。只输出表格。\n\n<doc>\n${ctx.docContent}\n</doc>`
  },
  {
    id: 'translate',
    label: '译成英文',
    hint: '保留代码与专有名词',
    insertable: true,
    build: (ctx, input) =>
      `把下面内容翻译成地道的技术英文：代码、命令、日志、专有名词保持原样，只翻译叙述性文字，保留 Markdown 结构。只输出译文。\n\n<text>\n${input || ctx.selection || ctx.docContent}\n</text>`
  }
]

export const BASE_INSTRUCTIONS = `你是 Inkwell 里的排查与写作搭档。使用者是工程师，日常是：线上出问题 → 翻日志和文档 → 定位 → 写记录。你的价值在于把散乱信息变成可以直接行动的结论。

# 回答方式
- 结论先行。第一段就给出答案或判断，不要用"好的""让我来分析一下"这类铺垫。
- 分层展开：**结论** → **依据**（引用原文、数值、行号、报错）→ **下一步**（可复制的命令、要确认的点）。
- 不确定就明说。材料里没有的信息写"现有材料没有提到"，绝不补一个看起来合理的数值、时间或结论。
- 代码、命令、日志、配置、报错保持原样，不改写、不翻译、不美化。
- 默认简体中文；专有名词、错误码、字段名保留英文原文。

# 使用材料
- \`<context-files>\` 是用户这次勾选给你的文档，作为权威证据。引用时在句末用 [[文件名]] 标注出处。
- \`<library>\` 是笔记库路径清单。它只告诉你"有哪些材料"，不是内容本身。
- 你有五个工具：list_docs（列文档）、read_doc（读全文）、search_docs（全库检索）、create_doc（新建文档）、edit_doc（修改文档）。
- 需要看具体内容就调用工具，不要凭文件名猜内容，更不要假装读过没读的文档。
- 一次任务最多读 3 篇；读完必须收敛到结论，不要反复翻文档。
- \`<selection>\` 是用户此刻选中的片段，视为焦点：优先解释、改写或针对它作答，而不是泛泛谈整篇文档。
- 材料之间冲突时，指出冲突本身，并说明哪个更可信及理由。

# 改文档（重要）
- 只在用户明确要求"写进去/改一下/整理成笔记"时才动文档。纯提问、纯分析不要调用 create_doc / edit_doc。
- \`create_doc\` 立即新建文件：正文自带一级标题，写成能直接用的笔记，不要把整段对话内容原样塞进去。
- \`edit_doc\` 不会立即生效：它生成一条待确认提案，用户点"应用"才落盘。所以做完要在回答里用一两句话说清改了哪几处，并提醒他确认。
- 改已有内容前先 \`read_doc\`。\`edits\` 里的 \`old\` 必须逐字符复制原文（空格、标点、缩进都不能改），并且在文档里唯一；宁可多带一行上下文，也不要凭记忆写。
- 最小改动：不整篇重写、不顺手换格式、不删用户没让删的段落。新增内容用 \`append\`。
- 你不能删除文档，也不要声称删了。改完不要重复粘贴整篇新内容，用户点"应用"就能看到。

# 输出结构
- 链路、时序、状态流转：优先 mermaid 代码块（graph TD / sequenceDiagram），节点文字简短。
- 归因、层级、并列项：用列表。指标对比、字段对照：用表格。
- 需要落到文档的内容：直接给完整可粘贴的 Markdown，不要用代码块包裹整段。
- 长度跟问题匹配。一句话能答清的就一句话，不要为了显得完整而注水。`

export interface ContextFile {
  path: string
  title: string
  content: string
}

export interface PackedFile extends ContextFile {
  /** 实际注入的字符数 */
  used: number
  truncated: boolean
}

/** 按 token 预算把文档内容装进上下文：先均分，再把剩余额度补给被截断的篇目 */
export function packContextFiles(files: ContextFile[], budgetTokens: number): PackedFile[] {
  if (!files.length) return []
  // 中文约 0.68 token/字 → 1 token ≈ 1.45 字；留 20% 给系统提示和回答
  const charBudget = Math.max(2000, Math.floor(budgetTokens * 1.45 * 0.8))
  const fair = Math.max(1200, Math.floor(charBudget / files.length))
  const alloc = files.map((f) => Math.min(f.content.length, fair))
  let spare = charBudget - alloc.reduce((a, b) => a + b, 0)
  for (let i = 0; i < files.length && spare > 0; i++) {
    const need = files[i].content.length - alloc[i]
    if (need > 0) {
      const add = Math.min(need, spare)
      alloc[i] += add
      spare -= add
    }
  }
  return files.map((f, i) => ({
    ...f,
    used: alloc[i],
    truncated: alloc[i] < f.content.length
  }))
}

export function buildSystemPrompt(opts: {
  docTitle?: string
  docContent?: string
  selection?: string
  contextFiles?: PackedFile[]
  library?: { path: string; title: string; size: number }[]
  extra?: string
}): string {
  const parts = [BASE_INSTRUCTIONS]

  if (opts.contextFiles?.length) {
    const blocks = opts.contextFiles.map((f) => {
      const body = f.used > 0 ? f.content.slice(0, f.used) : ''
      const cut = f.truncated ? `\n\n…（此文件较长，仅提供前 ${f.used} 字符；需要后续内容请用 read_doc 读取 ${f.path}）` : ''
      return `<file path="${f.path}" title="${f.title}">\n${body}${cut}\n</file>`
    })
    const dropped = opts.contextFiles.filter((f) => f.used === 0).map((f) => f.path)
    parts.push(
      `## 用户本次提供的文档\n这些是本次对话的依据，回答问题优先使用它们。\n\n<context-files>\n${blocks.join(
        '\n'
      )}\n</context-files>${dropped.length ? `\n\n（受上下文长度限制，以下文件本次未展开：${dropped.join('、')}）` : ''}`
    )
  } else if (opts.docTitle || opts.docContent) {
    const body = (opts.docContent || '').slice(0, 24000)
    parts.push(
      `## 当前打开的文档\n标题：${opts.docTitle || '未命名'}\n\n<document>\n${body}\n</document>`
    )
  }

  if (opts.library?.length) {
    const list = opts.library
      .slice(0, 200)
      .map((d) => `- ${d.path}（${d.title}，${d.size} 字符）`)
      .join('\n')
    parts.push(
      `## 笔记库路径清单（共 ${opts.library.length} 篇）\n以下只是路径与标题，内容需要用 read_doc 读取。\n\n<library>\n${list}\n</library>`
    )
  }

  if (opts.selection) {
    parts.push(`## 用户选中的片段\n<selection>\n${opts.selection.slice(0, 8000)}\n</selection>`)
  }
  if (opts.extra) parts.push(opts.extra)
  return parts.join('\n\n')
}

/** 粗略估算 token：中文按 1 字 ≈ 0.65 token，英文按 4 字符 ≈ 1 token */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const rest = text.length - cjk
  return Math.round(cjk * 0.68 + rest / 3.6)
}

export interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'hunk'
  text: string
}

export function buildDiff(before: string, after: string, name = 'document.md'): DiffLine[] {
  const patch = createTwoFilesPatch(name, name, before, after, '', '', { context: 4 })
  const lines = patch.split('\n')
  const out: DiffLine[] = []
  let started = false
  for (const line of lines) {
    if (line.startsWith('===') || line.startsWith('---') || line.startsWith('+++')) continue
    if (line.startsWith('@@')) {
      started = true
      out.push({ type: 'hunk', text: line })
      continue
    }
    if (!started) continue
    if (line.startsWith('+')) out.push({ type: 'add', text: line.slice(1) })
    else if (line.startsWith('-')) out.push({ type: 'del', text: line.slice(1) })
    else out.push({ type: 'ctx', text: line.startsWith(' ') ? line.slice(1) : line })
  }
  return out
}

export function diffStat(lines: DiffLine[]): { add: number; del: number } {
  return {
    add: lines.filter((l) => l.type === 'add').length,
    del: lines.filter((l) => l.type === 'del').length
  }
}

/** 从模型输出里剥掉整体包裹的 ```markdown 围栏，方便直接落到文档 */
export function unwrapFence(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/)
  return match ? match[1] : trimmed
}
