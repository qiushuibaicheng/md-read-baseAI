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

export const BASE_INSTRUCTIONS = `你是 Inkwell 内置的写作与排查助手，服务对象是做线上问题定位的工程师。

行为准则：
- 默认用简体中文回答；代码、命令、日志、配置保持原样。
- 回答围绕「能直接拿去用」：给结论、给命令、给下一步，不写客套话。
- 遇到不确定的信息，明确说"文档里没有提到"，不要编造数值、时间或结论。
- 需要结构化时用 Markdown 小标题、列表、表格；涉及链路、时序时优先给 mermaid 代码块。
- 当用户要求"只输出结果"时，严格只输出可插入的内容，不要额外解释。`

export function buildSystemPrompt(opts: {
  docTitle?: string
  docContent?: string
  selection?: string
  extra?: string
}): string {
  const parts = [BASE_INSTRUCTIONS]
  if (opts.docTitle || opts.docContent) {
    const body = (opts.docContent || '').slice(0, 24000)
    parts.push(
      `## 当前打开的文档\n标题：${opts.docTitle || '未命名'}\n\n<document>\n${body}\n</document>`
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
