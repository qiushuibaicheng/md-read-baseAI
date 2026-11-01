import type { AskRequest, PlanStep, SkillDef, ToolCtx, ToolSpec, WriteProposal } from './types'

// ---------------------------------------------------------------------------
// 工具声明
// ---------------------------------------------------------------------------
type Props = Record<string, { type: string; description: string; items?: unknown; enum?: string[] }>

const fn = (name: string, description: string, properties: Props, required: string[] = []): ToolSpec => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } }
})

export const BUILTIN_TOOLS: ToolSpec[] = [
  // ---------------------------------------------------------------- 读
  fn(
    'list_tree',
    '查看笔记库的目录结构（文件夹与文档的层级）。不知道该把内容放哪、或要确认某篇文档在哪个文件夹时先调它。',
    {
      depth: { type: 'number', description: '展开层数，默认 3，最多 6' },
      dir: { type: 'string', description: '只列出某个子目录，留空为根目录' }
    }
  ),
  fn(
    'list_docs',
    '列出笔记库里的文档（相对路径、标题、字符数），可按关键词过滤。',
    { query: { type: 'string', description: '可选关键词，按标题或路径过滤' } }
  ),
  fn(
    'read_doc',
    '读取文档内容。短文档直接读全文；长文档用 start/end 按行读，避免一次灌满上下文。',
    {
      path: { type: 'string', description: '文档相对路径，必须来自清单或 list_docs/list_tree 的返回' },
      start: { type: 'number', description: '可选，起始行（从 1 开始）' },
      end: { type: 'number', description: '可选，结束行（含）' }
    },
    ['path']
  ),
  fn(
    'search_docs',
    '在笔记库全文中检索关键词，返回命中的文档、行号和原文片段。',
    { query: { type: 'string', description: '关键词或报错原文' } },
    ['query']
  ),
  fn(
    'get_outline',
    '拿到文档的标题树（层级、标题、行号）。判断文档结构、决定在哪一节下笔时用，比读全文省上下文。',
    { path: { type: 'string', description: '文档相对路径' } },
    ['path']
  ),
  fn('list_snippets', '列出用户保存的常用片段（可复用的文本块、模板、命令集）。', {}),
  fn(
    'list_clips',
    '查看剪贴板历史（用户最近复制过的内容）。用户说「刚才复制的那段」时用。',
    { limit: { type: 'number', description: '返回条数，默认 10，最多 40' } }
  ),
  fn(
    'fetch_url',
    '抓取一个网页并转成纯文本。用户贴了链接要你读内容时用。只支持 http/https，返回正文摘要。',
    { url: { type: 'string', description: '完整 URL' } },
    ['url']
  ),
  // ---------------------------------------------------------------- 写
  fn(
    'create_doc',
    '新建一篇文档并写入内容（立即生效）。正文自带 Markdown 一级标题，写成能直接用的笔记。',
    {
      title: { type: 'string', description: '文件名（不含 .md），6-24 字' },
      content: { type: 'string', description: '完整 Markdown 正文' },
      dir: { type: 'string', description: '可选，放到哪个子目录（相对路径，不存在会自动创建）' }
    },
    ['title', 'content']
  ),
  fn(
    'edit_doc',
    '修改已有文档。不会直接落盘：生成待确认的修改提案，用户看过 diff 才生效。优先小范围替换，不要整篇重写。',
    {
      path: { type: 'string', description: '文档相对路径' },
      edits: {
        type: 'array',
        description: '替换列表，每处 old 必须在原文里唯一出现',
        items: {
          type: 'object',
          properties: {
            old: { type: 'string', description: '被替换的原文，逐字符复制' },
            new: { type: 'string', description: '替换成什么，留空表示删除' }
          },
          required: ['old', 'new']
        }
      },
      append: { type: 'string', description: '可选，追加到文末' },
      prepend: { type: 'string', description: '可选，插入到文首（标题之后）' }
    },
    ['path']
  ),
  fn(
    'create_folder',
    '新建文件夹（立即生效）。parent 为空表示建在根目录。',
    {
      name: { type: 'string', description: '文件夹名' },
      parent: { type: 'string', description: '可选，父目录相对路径' }
    },
    ['name']
  ),
  fn(
    'move_entry',
    '移动或重命名文档/文件夹（立即生效，可逆）。也可以同时改名：move_entry + new_name。',
    {
      path: { type: 'string', description: '要移动的文档或文件夹相对路径' },
      to_dir: { type: 'string', description: '目标目录相对路径，留空表示根目录' },
      new_name: { type: 'string', description: '可选，移动的同时改名（不含扩展名）' }
    },
    ['path']
  ),
  fn(
    'delete_entry',
    '删除文档或文件夹（进系统回收站）。会生成待确认提案，用户点确认才真删。',
    {
      path: { type: 'string', description: '要删除的相对路径' },
      reason: { type: 'string', description: '一句话说明为什么要删，显示在确认卡片上' }
    },
    ['path']
  ),
  fn(
    'replace_in_docs',
    '在一批文档里批量替换同一段文字，每篇生成一条待确认提案。适合批量改名、统一术语、修同一个错误。',
    {
      paths: { type: 'array', description: '文档相对路径列表，最多 10 篇', items: { type: 'string' } },
      find: { type: 'string', description: '要查找的文字（区分大小写，普通文本匹配）' },
      replace: { type: 'string', description: '替换成什么，留空表示删除' }
    },
    ['paths', 'find', 'replace']
  ),
  fn(
    'save_snippet',
    '把一段可复用的内容存进片段库（命令、模板、检查清单）。',
    {
      title: { type: 'string', description: '片段名，短一些' },
      content: { type: 'string', description: '片段内容' }
    },
    ['title', 'content']
  ),
  // ---------------------------------------------------------------- 编排
  fn(
    'todo_write',
    '为多步任务写一份执行计划，用户在面板上能看到进度。任务超过 3 步时先用它列计划，之后每完成一步就更新状态。',
    {
      steps: {
        type: 'array',
        description: '步骤列表，按顺序',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '这一步做什么，一句话' },
            status: { type: 'string', description: 'pending / doing / done', enum: ['pending', 'doing', 'done'] }
          },
          required: ['text']
        }
      }
    },
    ['steps']
  ),
  fn(
    'ask_user',
    '向用户提一个必须由他决定的问题（选哪篇文档、用哪种方案）。会给出一组选项供点选。只在信息缺失且无法从库里查到的时候用。',
    {
      question: { type: 'string', description: '问题本身，一句话' },
      options: { type: 'array', description: '2-4 个选项', items: { type: 'string' } },
      multiple: { type: 'boolean', description: '是否允许多选，默认 false' }
    },
    ['question', 'options']
  ),
  fn(
    'delegate',
    '把一个独立子任务派给子智能体，它有自己的上下文和工具权限，返回结论摘要。适合「先通读十几篇再汇总」这类吃上下文又不需要你亲自看的活。',
    {
      role: {
        type: 'string',
        description: 'researcher（只读检索）/ writer（写文档）/ reviewer（检查一致性与错误）',
        enum: ['researcher', 'writer', 'reviewer']
      },
      task: { type: 'string', description: '要它做什么，写清楚交付物' },
      paths: { type: 'array', description: '可选，指定它先读哪些文档', items: { type: 'string' } },
      max_rounds: { type: 'number', description: '可选，最多几轮工具调用，默认 4' }
    },
    ['role', 'task']
  ),
  // ---------------------------------------------------------------- 技能
  fn('list_skills', '列出已安装的技能包（操作手册）。', {}),
  fn(
    'load_skill',
    '加载一个技能包的完整操作手册。用户的需求命中某个技能的适用场景时，先加载它再动手。',
    { name: { type: 'string', description: '技能名，来自 list_skills 或系统提示里的技能索引' } },
    ['name']
  ),
  fn(
    'create_skill',
    '把一套刚跑通的流程固化成新技能包，以后一句话就能复用。',
    {
      name: { type: 'string', description: '技能名' },
      description: { type: 'string', description: '一句话说明它做什么' },
      when: { type: 'string', description: '什么情况下该用它' },
      body: { type: 'string', description: '操作手册正文（Markdown）：步骤、约束、输出格式' }
    },
    ['name', 'description', 'when', 'body']
  )
]

// ---------------------------------------------------------------------------
// 提案
// ---------------------------------------------------------------------------
export const pendingWrites = new Map<string, WriteProposal>()

const lineCount = (s: string) => (s ? s.split('\n').length : 0)
export const titleOf = (p: string) => (p.split('/').pop() || p).replace(/\.md$/i, '')
const normPath = (v: unknown) => String(v ?? '').trim().replace(/^\.?\//, '')

function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/** 同一篇文档只保留最新一条提案，旧的作废 */
function dropProposalsFor(path: string, ctx: ToolCtx) {
  for (const [id, w] of pendingWrites) {
    if (w.path === path) {
      pendingWrites.delete(id)
      ctx.send('ai:write:drop', { id })
    }
  }
}

function proposeWrite(ctx: ToolCtx, path: string, before: string, after: string, add: number, del: number): WriteProposal {
  dropProposalsFor(path, ctx)
  const h1 = before.match(/^#\s+(.+?)\s*$/m)?.[1]
  const proposal: WriteProposal = {
    id: makeId('w'),
    reqId: ctx.reqId,
    kind: 'write',
    path,
    title: h1 && h1.length <= 30 ? h1 : titleOf(path),
    before,
    after,
    add: Math.max(add, 1),
    del,
    createdAt: Date.now()
  }
  pendingWrites.set(proposal.id, proposal)
  ctx.send('ai:write', proposal)
  return proposal
}

// ---------------------------------------------------------------------------
// 执行
// ---------------------------------------------------------------------------
export async function execTool(name: string, rawArgs: string, ctx: ToolCtx): Promise<string> {
  let args: Record<string, any> = {}
  try {
    args = rawArgs?.trim() ? JSON.parse(rawArgs) : {}
  } catch {
    return '工具参数不是合法 JSON，请重新调用并只传 JSON 对象'
  }
  const { vault } = ctx
  // 白名单必须在执行层校验：schema 只是「建议」，模型完全可能调一个没给它的工具
  if (ctx.allow && !ctx.allow.has(name)) {
    return `没有调用 ${name} 的权限。当前角色只能用：${[...ctx.allow].join('、')}`
  }
  try {
    // ------------------------------------------------------------ 读
    if (name === 'list_tree') {
      const depth = Math.max(1, Math.min(Number(args.depth) || 3, 6))
      const root = normPath(args.dir)
      return await renderTree(ctx, root, depth)
    }
    if (name === 'list_docs') {
      const all = await vault.list()
      const q = String(args.query || '').trim().toLowerCase()
      const list = q ? all.filter((d) => d.title.toLowerCase().includes(q) || d.path.toLowerCase().includes(q)) : all
      if (!list.length) return '没有匹配的文档'
      return `${list.length} 篇：\n${list
        .slice(0, 200)
        .map((d) => `- ${d.path}（${d.size} 字符）`)
        .join('\n')}`
    }
    if (name === 'read_doc') {
      const p = normPath(args.path)
      if (!p) return '缺少 path 参数'
      const text = await vault.read(p)
      const lines = text.split('\n')
      const start = Number(args.start)
      const end = Number(args.end)
      if (Number.isFinite(start) && start > 0) {
        const from = Math.max(1, Math.trunc(start))
        const to = Number.isFinite(end) && end >= from ? Math.min(Math.trunc(end), lines.length) : lines.length
        const body = lines.slice(from - 1, to).join('\n')
        return `（第 ${from}-${to} 行，共 ${lines.length} 行）\n${cap(body, 14000)}`
      }
      if (text.length > 16000) {
        return `${cap(text, 16000)}\n\n…（全文共 ${text.length} 字符 / ${lines.length} 行，已给出开头；需要后面的内容请用 read_doc 带 start/end 按行读）`
      }
      return text
    }
    if (name === 'search_docs') {
      const q = String(args.query || '').trim()
      if (!q) return '缺少 query 参数'
      const hits = await vault.search(q)
      if (!hits.length) return `笔记库里没有找到包含「${q}」的内容`
      return hits
        .slice(0, 10)
        .map((h) => `${h.path}\n${h.hits.slice(0, 6).map((x) => `  第${x.line}行: ${x.text}`).join('\n')}`)
        .join('\n\n')
    }
    if (name === 'get_outline') {
      const p = normPath(args.path)
      if (!p) return '缺少 path 参数'
      const items = await vault.outline(p)
      if (!items.length) return `${p} 里没有 Markdown 标题。`
      return items.map((i) => `${'  '.repeat(Math.max(0, i.level - 1))}- ${i.text}（第 ${i.line} 行）`).join('\n')
    }
    if (name === 'list_snippets') {
      const list = vault.snippets()
      if (!list.length) return '片段库是空的'
      return list
        .slice(0, 40)
        .map((s) => `- ${s.title}（${s.content.length} 字符）\n  ${cap(s.content.replace(/\n/g, ' '), 120)}`)
        .join('\n')
    }
    if (name === 'list_clips') {
      const limit = Math.max(1, Math.min(Number(args.limit) || 10, 40))
      const list = vault.clips().slice(0, limit)
      if (!list.length) return '剪贴板历史是空的'
      return list
        .map((c, i) => `${i + 1}. ${cap(c.text.replace(/\s+/g, ' '), 200)}`)
        .join('\n')
    }
    if (name === 'fetch_url') {
      return await fetchUrl(String(args.url || '').trim())
    }
    // ------------------------------------------------------------ 写
    if (name === 'create_doc') {
      const title = String(args.title || '').trim().slice(0, 60)
      const content = String(args.content ?? '').replace(/\r\n/g, '\n').trim()
      if (!title) return '缺少 title 参数'
      if (!content) return 'content 为空，新建文档至少要给正文'
      if (content.length > 60000) return '内容超过 6 万字符，请拆成多篇'
      const dir = normPath(args.dir)
      const rel = await vault.create(title, content, dir || undefined)
      ctx.send('ai:doc-created', { path: rel, title: titleOf(rel) })
      return `已新建文档：${rel}（${content.length} 字符）。需要继续改可以直接用 edit_doc。`
    }
    if (name === 'edit_doc') {
      const p = normPath(args.path)
      if (!p) return '缺少 path 参数'
      if (!/\.md$/i.test(p)) return 'path 必须是 .md 文档'
      const before = await vault.read(p)
      const edits: any[] = Array.isArray(args.edits) ? args.edits.slice(0, 30) : []
      const append = typeof args.append === 'string' ? args.append.replace(/\r\n/g, '\n').trim() : ''
      const prepend = typeof args.prepend === 'string' ? args.prepend.replace(/\r\n/g, '\n').trim() : ''
      if (!edits.length && !append && !prepend) return '没有传 edits/append/prepend，什么都没改'

      let text = before
      let add = 0
      let del = 0
      for (let i = 0; i < edits.length; i++) {
        const oldText = String(edits[i]?.old ?? '')
        const newText = String(edits[i]?.new ?? '')
        if (!oldText) return `第 ${i + 1} 处修改缺少 old，请重新调用`
        if (oldText === newText) continue
        if (oldText.length > 20000) return `第 ${i + 1} 处 old 太长，请拆成更小的片段`
        const first = text.indexOf(oldText)
        if (first < 0) return `第 ${i + 1} 处的原文没有在文档里找到。请先 read_doc 拿到准确原文，空格标点缩进都要完全一致。`
        if (text.indexOf(oldText, first + 1) >= 0) return `第 ${i + 1} 处的原文出现了多次，请多带一两行上下文让它唯一。`
        text = text.slice(0, first) + newText + text.slice(first + oldText.length)
        add += lineCount(newText)
        del += lineCount(oldText)
      }
      if (prepend) {
        const h1 = text.match(/^#\s+.+\n/)
        if (h1) {
          text = `${h1[0]}\n${prepend}\n${text.slice(h1[0].length)}`
          add += lineCount(prepend) + 1
        } else {
          text = `${prepend}\n\n${text}`
          add += lineCount(prepend) + 1
        }
      }
      if (append) {
        const sep = !text ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n'
        text = `${text}${sep}${append}`
        add += lineCount(append) + 1
      }
      if (text === before) return '和原文完全一致，没有产生修改。'
      const proposal = proposeWrite(ctx, p, before, text, add, del)
      return `已提交修改提案（未落盘，等用户确认）：${p}，+${proposal.add} −${proposal.del} 行。请用一两句话说明改了什么，并提醒点「应用」。`
    }
    if (name === 'create_folder') {
      const folder = String(args.name || '').trim()
      const parent = normPath(args.parent)
      if (!folder) return '缺少 name 参数'
      const rel = await vault.createFolder(parent ? `${parent}/${folder}` : folder)
      return `已新建文件夹：${rel}`
    }
    if (name === 'move_entry') {
      const p = normPath(args.path)
      if (!p) return '缺少 path 参数'
      const toDir = normPath(args.to_dir)
      const next = await vault.move(p, toDir, String(args.new_name || '').trim() || undefined)
      return next === p ? '位置没变（已经在目标目录里，名字也一样）' : `已移动：${p} → ${next}`
    }
    if (name === 'delete_entry') {
      const p = normPath(args.path)
      if (!p) return '缺少 path 参数'
      const isDoc = /\.md$/i.test(p)
      const before = isDoc ? await vault.read(p).catch(() => '') : ''
      const reason = String(args.reason || '').trim()
      dropProposalsFor(p, ctx)
      const proposal: WriteProposal = {
        id: makeId('d'),
        reqId: ctx.reqId,
        kind: 'delete',
        path: p,
        title: isDoc ? titleOf(p) : `${p}（文件夹）`,
        before,
        after: '',
        add: 0,
        del: isDoc ? lineCount(before) : 0,
        createdAt: Date.now()
      }
      pendingWrites.set(proposal.id, proposal)
      ctx.send('ai:write', proposal)
      return `已提交删除提案：${p}${reason ? `（${reason}）` : ''}。用户确认后才会移入回收站。不要声称已经删除。`
    }
    if (name === 'replace_in_docs') {
      const find = String(args.find ?? '')
      const replace = String(args.replace ?? '')
      const paths = (Array.isArray(args.paths) ? args.paths : []).map(normPath).filter(Boolean).slice(0, 10)
      if (!find) return '缺少 find 参数'
      if (!paths.length) return 'paths 为空'
      const done: string[] = []
      const miss: string[] = []
      for (const p of paths) {
        let before = ''
        try {
          before = await vault.read(p)
        } catch {
          miss.push(`${p}（打不开）`)
          continue
        }
        const count = before.split(find).length - 1
        if (!count) {
          miss.push(`${p}（没找到）`)
          continue
        }
        const after = before.split(find).join(replace)
        const proposal = proposeWrite(ctx, p, before, after, lineCount(after), lineCount(before))
        done.push(`${p}（${count} 处，提案 ${proposal.id}）`)
      }
      if (!done.length) return `没有可替换的内容：${miss.join('、')}`
      return `已生成 ${done.length} 条替换提案（都要用户逐条确认）：\n${done.join('\n')}${miss.length ? `\n未命中：${miss.join('、')}` : ''}`
    }
    if (name === 'save_snippet') {
      const title = String(args.title || '').trim().slice(0, 40)
      const content = String(args.content ?? '').trim()
      if (!title || !content) return 'title 与 content 都不能为空'
      const saved = vault.saveSnippet(title, content)
      return `已存进片段库：${saved.title}（${content.length} 字符）`
    }
    // ------------------------------------------------------------ 编排
    if (name === 'todo_write') {
      const raw = Array.isArray(args.steps) ? args.steps : []
      if (!raw.length) return 'steps 为空，没有可执行计划'
      const steps: PlanStep[] = raw.slice(0, 12).map((s: any, i: number) => ({
        id: `s${i + 1}`,
        text: String(s?.text || '').slice(0, 120),
        status: s?.status === 'done' ? 'done' : s?.status === 'doing' ? 'doing' : 'pending'
      }))
      ctx.plan(steps)
      return `计划已同步到面板（${steps.filter((s) => s.status === 'done').length}/${steps.length} 完成）。继续执行下一步，完成一步就再调一次本工具更新状态。`
    }
    if (name === 'ask_user') {
      const question = String(args.question || '').trim()
      const options = (Array.isArray(args.options) ? args.options : []).map((o: any) => String(o).trim()).filter(Boolean).slice(0, 4)
      if (!question) return '缺少 question 参数'
      if (options.length < 2) return '至少给两个选项，否则不如直接提问'
      const answer = await ctx.ask({
        id: makeId('q'),
        question,
        options: options.map((o) => ({ label: o, value: o })),
        multiple: !!args.multiple
      })
      return answer
    }
    if (name === 'delegate') {
      const role = String(args.role || 'researcher')
      const task = String(args.task || '').trim()
      if (!task) return '缺少 task 参数'
      const paths = (Array.isArray(args.paths) ? args.paths : []).map(normPath).filter(Boolean).slice(0, 12)
      const rounds = Math.max(1, Math.min(Number(args.max_rounds) || 4, 8))
      return await ctx.runSub({ role, task, paths, rounds })
    }
    // ------------------------------------------------------------ 技能
    if (name === 'list_skills') {
      const list = ctx.skills.list()
      if (!list.length) return '还没有技能包。可以用 create_skill 把流程固化下来。'
      return list.map((s) => `- ${s.name}${s.when ? ` — 适用：${s.when}` : ''}${s.description ? `（${s.description}）` : ''}`).join('\n')
    }
    if (name === 'load_skill') {
      const hit = ctx.skills.get(String(args.name || ''))
      if (!hit) return `没有名为「${args.name}」的技能。先用 list_skills 看看有哪些。`
      return `# 技能：${hit.name}\n适用：${hit.when || '未说明'}\n\n${cap(hit.body, 12000)}`
    }
    if (name === 'create_skill') {
      const name2 = String(args.name || '').trim()
      const body = String(args.body || '').trim()
      if (!name2 || !body) return 'name 与 body 都不能为空'
      const saved: SkillDef = ctx.skills.save({
        name: name2,
        description: String(args.description || ''),
        when: String(args.when || ''),
        body
      })
      return `已保存技能「${saved.name}」，下次可以直接说需求触发它。`
    }
    // ------------------------------------------------------------ MCP
    if (name.startsWith('mcp__')) {
      return await ctx.mcp.call(name, args)
    }
    return `未知工具：${name}`
  } catch (err) {
    return `操作失败：${(err as Error)?.message || '未知错误'}`
  }
}

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------
const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…（已截断）` : s)

/** 目录树：一次给到层级，省掉模型来回 list 的次数 */
async function renderTree(ctx: ToolCtx, root: string, depth: number): Promise<string> {
  const docs = await ctx.vault.list()
  const folders = await ctx.vault.folders()
  const prefix = root ? `${root}/` : ''
  const under = (p: string) => (root ? p === root || p.startsWith(prefix) : true)
  const rel = (p: string) => (root ? p.slice(prefix.length) : p)
  const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
  const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1)

  const docSize = new Map<string, number>()
  for (const d of docs) if (under(d.path)) docSize.set(rel(d.path), d.size)
  const dirSet = new Set<string>()
  for (const f of folders) if (under(f)) dirSet.add(rel(f))

  const dirsOf = (dir: string) => [...dirSet].filter((f) => parentOf(f) === dir).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  const docsOf = (dir: string) => [...docSize.keys()].filter((d) => parentOf(d) === dir).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  const countUnder = (dir: string) => [...docSize.keys()].filter((d) => d === dir || d.startsWith(`${dir}/`)).length

  const lines: string[] = [root ? `${root}/` : '（根目录）']
  const walk = (dir: string, level: number) => {
    for (const sub of dirsOf(dir)) {
      lines.push(`${'  '.repeat(level)}${baseOf(sub)}/  (${countUnder(sub)} 篇)`)
      if (level < depth) walk(sub, level + 1)
    }
    for (const doc of docsOf(dir)) {
      lines.push(`${'  '.repeat(level)}${baseOf(doc)}  (${docSize.get(doc)} 字符)`)
    }
  }
  walk(root, 1)
  if (lines.length === 1) return `${lines[0]}\n（空）`
  return lines.join('\n')
}

async function fetchUrl(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) return '只支持 http/https 链接'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Inkwell/1.0)', Accept: 'text/html,application/xhtml+xml' }
    })
    if (!res.ok) return `抓取失败：HTTP ${res.status}`
    const type = res.headers.get('content-type') || ''
    const raw = await res.text()
    if (!/html|xml|text/i.test(type)) return `这个地址返回的不是网页（${type}）`
    const text = htmlToText(raw)
    return text.length > 12000 ? `${text.slice(0, 12000)}\n…（已截断）` : text || '（页面没有可读正文）'
  } catch (err) {
    return `抓取失败：${(err as Error).message}`
  } finally {
    clearTimeout(timer)
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n')
    .slice(0, 40000)
}
