import { BrowserWindow, ipcMain } from 'electron'
import { dirname, join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------
export interface ModelProfile {
  id: string
  name: string
  provider?: string
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
  /** 上下文窗口，仅用于界面提示上下文预算上限 */
  maxContext?: number
  /** 额外的请求头，JSON 字符串，例如 {"X-Org":"team"} */
  extraHeaders?: string
  createdAt: number
}

export interface AiSessionMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  time: number
  model?: string
  usage?: { prompt: number; completion: number }
  error?: string
}

export interface AiSession {
  id: string
  title: string
  docPath: string | null
  messages: AiSessionMessage[]
  createdAt: number
  updatedAt: number
}

interface ChatRequest {
  reqId: string
  profileId: string
  system?: string
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  temperature?: number
  maxTokens?: number
  /** 允许模型调用本地笔记库工具（list_docs / read_doc / search_docs） */
  tools?: boolean
}

// ---------------------------------------------------------------------------
// 存储
// ---------------------------------------------------------------------------
let USER_DIR = ''
let MODELS_FILE = ''
let SESSIONS_FILE = ''

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
}

function readJSON<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as T
  } catch {
    return fallback
  }
}

function writeJSON(file: string, data: unknown) {
  ensureDir(dirname(file))
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
}

let models: ModelProfile[] = []
let sessions: AiSession[] = []

function loadAll() {
  models = readJSON<ModelProfile[]>(MODELS_FILE, [])
  sessions = readJSON<AiSession[]>(SESSIONS_FILE, [])
}

// ---------------------------------------------------------------------------
// 请求地址与错误
// ---------------------------------------------------------------------------
function endpoint(baseUrl: string): string {
  const raw = (baseUrl || '').trim().replace(/\/+$/, '')
  if (!raw) throw new Error('还没有填写接口地址')
  if (/\/chat\/completions$/i.test(raw)) return raw
  if (/\/v\d+[a-z]*$/i.test(raw)) return `${raw}/chat/completions`
  return `${raw}/v1/chat/completions`
}

function describeHttpError(status: number, body: string): string {
  let detail = ''
  try {
    const parsed = JSON.parse(body)
    detail = parsed?.error?.message || parsed?.message || ''
  } catch {
    detail = body.replace(/\s+/g, ' ').slice(0, 200)
  }
  const map: Record<number, string> = {
    400: '请求被拒绝（可能是模型名或参数不支持）',
    401: 'API Key 无效或已过期',
    403: '没有访问该模型的权限',
    404: '接口路径或模型名不存在',
    422: '参数不合法',
    429: '请求过于频繁，稍后再试',
    500: '服务端错误',
    502: '网关错误',
    503: '服务暂时不可用',
    504: '服务响应超时'
  }
  const head = map[status] || `请求失败（HTTP ${status}）`
  return detail ? `${head}：${detail}` : head
}

function describeError(err: unknown): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string } }
  if (e?.name === 'AbortError') return '已停止生成'
  const code = e?.cause?.code || ''
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '域名解析失败，检查接口地址或网络'
  if (code === 'ECONNREFUSED') return '连接被拒绝，检查接口地址与端口'
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return '连接超时，检查网络或代理'
  if (code === 'CERT_HAS_EXPIRED' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT') return '证书校验失败，可尝试改用 http 或换网络'
  if (/fetch failed/i.test(e?.message || '')) return '网络请求失败，检查网络 / 代理设置'
  return e?.message || '未知错误'
}

// ---------------------------------------------------------------------------
// 流式对话
// ---------------------------------------------------------------------------
const running = new Map<string, AbortController>()
const FLUSH_MS = 45

function makeEmitter(reqId: string, send: (channel: string, payload: unknown) => void, base = '') {
  let text = ''
  let reasoning = ''
  let dirty = false
  let timer: NodeJS.Timeout | null = null

  const flush = () => {
    if (!dirty) return
    dirty = false
    send('ai:stream', { reqId, text: base + text, reasoning })
  }

  return {
    push(textDelta: string, reasonDelta: string) {
      if (textDelta) {
        text += textDelta
        dirty = true
      }
      if (reasonDelta) {
        reasoning += reasonDelta
        dirty = true
      }
      if (!timer) {
        timer = setInterval(() => {
          flush()
          if (timer) {
            clearInterval(timer)
            timer = null
          }
        }, FLUSH_MS)
      }
    },
    finish() {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      flush()
      return { text, reasoning }
    }
  }
}

// ---------------------------------------------------------------------------
// 本地笔记库工具（function calling）
// ---------------------------------------------------------------------------
export interface VaultAccess {
  list(): Promise<{ path: string; title: string; size: number }[]>
  read(path: string): Promise<string>
  search(query: string): Promise<{ path: string; title: string; hits: { line: number; text: string }[] }[]>
  /** 覆盖写入（仅用于用户已确认的提案） */
  write(path: string, content: string): Promise<void>
  /** 新建文档，返回相对路径 */
  create(title: string, content: string, dir?: string): Promise<string>
}

interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

const VAULT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_docs',
      description:
        '列出笔记库里的文档（相对路径、标题、字符数）。需要知道有哪些文档、或确认某个文档的准确路径时调用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '可选关键词，按标题或路径过滤，留空则返回全部' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_doc',
      description:
        '读取指定文档的完整 Markdown 内容。path 必须来自 <library> 清单、用户给出的路径或 list_docs 的返回，不能自己拼。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文档相对路径，例如「排查/502 网关超时.md」' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_docs',
      description: '在笔记库全文中检索关键词，返回命中的文档、行号和原文片段。用于找「哪篇笔记提过这个报错」。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '要检索的关键词或报错原文' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_doc',
      description:
        '新建一篇文档并写入内容（这一步会真的创建文件）。适合把结论、排查记录、方案整理成新笔记。正文请自带 Markdown 标题。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '文件名（不含 .md），6-24 字，能看出主题' },
          content: { type: 'string', description: '完整的 Markdown 正文' },
          dir: { type: 'string', description: '可选，放到笔记库里的哪个子目录（相对路径）' }
        },
        required: ['title', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_doc',
      description:
        '修改已有文档。不会直接落盘：会生成一条待确认的修改提案，由用户看过 diff 后决定是否应用。优先用小范围替换，不要整篇重写。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要修改的文档相对路径，必须来自清单或 list_docs 返回' },
          edits: {
            type: 'array',
            description:
              '替换列表。每处的 old 必须是从原文原样复制的唯一片段（含缩进和标点）；找不到或有多个匹配会被拒绝，需要重新读文档。',
            items: {
              type: 'object',
              properties: {
                old: { type: 'string', description: '要被替换的原文，需唯一匹配' },
                new: { type: 'string', description: '替换成什么，留空表示删除' }
              },
              required: ['old', 'new']
            }
          },
          append: { type: 'string', description: '可选，追加到文档末尾的 Markdown 片段' }
        },
        required: ['path']
      }
    }
  }
]

const MAX_TOOL_ROUNDS = 4
const TOOL_OUTPUT_LIMIT = 14000

/** 待用户确认的写提案：AI 只能提议，落盘要用户点头 */
export interface WriteProposal {
  id: string
  reqId: string
  path: string
  title: string
  before: string
  after: string
  add: number
  del: number
  createdAt: number
}

const pendingWrites = new Map<string, WriteProposal>()

const lineCount = (s: string) => (s ? s.split('\n').length : 0)
const titleOf = (p: string) => (p.split('/').pop() || p).replace(/\.md$/i, '')
const normPath = (v: unknown) => String(v ?? '').trim().replace(/^\.?\//, '')

interface ToolCtx {
  send: (channel: string, payload: unknown) => void
  reqId: string
  vault: VaultAccess
}

/**
 * 执行一次工具调用。读类工具直接返回内容；
 * 写类工具里，新建文档立即生效，修改已有文档只登记提案（等用户确认）。
 */
async function execTool(name: string, rawArgs: string, ctx: ToolCtx): Promise<string> {
  let args: Record<string, any> = {}
  try {
    args = rawArgs?.trim() ? JSON.parse(rawArgs) : {}
  } catch {
    return '工具参数不是合法 JSON，请重新调用并只传 JSON 对象'
  }
  const { vault, send, reqId } = ctx
  try {
    if (name === 'list_docs') {
      const all = await vault.list()
      const q = String(args.query || '').trim().toLowerCase()
      const list = q
        ? all.filter((d) => d.title.toLowerCase().includes(q) || d.path.toLowerCase().includes(q))
        : all
      if (!list.length) return '没有匹配的文档'
      return list
        .slice(0, 150)
        .map((d) => `- ${d.path} （${d.title}，${d.size} 字符）`)
        .join('\n')
    }
    if (name === 'read_doc') {
      const p = String(args.path || '').trim().replace(/^\.?\//, '')
      if (!p) return '缺少 path 参数'
      const text = await vault.read(p)
      return text.length > TOOL_OUTPUT_LIMIT
        ? `${text.slice(0, TOOL_OUTPUT_LIMIT)}\n\n…（内容过长已截断，共 ${text.length} 字符）`
        : text
    }
    if (name === 'search_docs') {
      const q = String(args.query || '').trim()
      if (!q) return '缺少 query 参数'
      const hits = await vault.search(q)
      if (!hits.length) return `笔记库里没有找到包含「${q}」的内容`
      return hits
        .slice(0, 8)
        .map((h) => `${h.path}\n${h.hits.map((x) => `  第${x.line}行: ${x.text}`).join('\n')}`)
        .join('\n\n')
    }
    if (name === 'create_doc') {
      const title = String(args.title || '').trim().slice(0, 60)
      const content = String(args.content ?? '').replace(/\r\n/g, '\n').trim()
      if (!title) return '缺少 title 参数'
      if (!content) return 'content 为空，新建文档至少要给正文'
      if (content.length > 40000) return '内容超过 4 万字符，请拆分后再建'
      const dir = typeof args.dir === 'string' ? args.dir.trim().replace(/^\.?\//, '') : undefined
      const rel = await vault.create(title, content, dir)
      send('ai:doc-created', { path: rel, title: titleOf(rel) })
      return `已新建文档：${rel}（${content.length} 字符）。用户在侧栏能看到它；需要再改可以直接用 edit_doc。`
    }
    if (name === 'edit_doc') {
      const p = normPath(args.path)
      if (!p) return '缺少 path 参数'
      if (!/\.md$/i.test(p)) return 'path 必须是 .md 文档'
      const before = await vault.read(p)
      const edits: any[] = Array.isArray(args.edits) ? args.edits.slice(0, 20) : []
      const append = typeof args.append === 'string' ? args.append.replace(/\r\n/g, '\n').trim() : ''
      if (!edits.length && !append) return '没有传 edits 或 append，什么都没改'

      let text = before
      let add = 0
      let del = 0
      for (let i = 0; i < edits.length; i++) {
        const oldText = String(edits[i]?.old ?? '')
        const newText = String(edits[i]?.new ?? '')
        if (!oldText) return `第 ${i + 1} 处修改缺少 old（要替换的原文），请重新调用`
        if (oldText === newText) continue
        if (oldText.length > 20000) return `第 ${i + 1} 处 old 太长，请拆成更小的片段`
        const first = text.indexOf(oldText)
        if (first < 0) {
          return `第 ${i + 1} 处的原文没有在文档里找到。请先 read_doc 拿到准确原文再改，空格、标点、缩进都要和原文完全一致。`
        }
        if (text.indexOf(oldText, first + 1) >= 0) {
          return `第 ${i + 1} 处的原文在文档里出现了多次，请多带一两行上下文，让它唯一。`
        }
        text = text.slice(0, first) + newText + text.slice(first + oldText.length)
        add += lineCount(newText)
        del += lineCount(oldText)
      }
      if (append) {
        const sep = !text ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n'
        text = `${text}${sep}${append}`
        add += lineCount(append) + 1
      }
      if (text === before) return '和原文完全一致，没有产生修改。'

      // 同一篇文档只保留最新一条提案，旧的作废
      for (const [id, w] of pendingWrites) {
        if (w.path === p) {
          pendingWrites.delete(id)
          send('ai:write:drop', { id })
        }
      }
      // 卡片上尽量显示文档标题（首个 H1），没有就用文件名
      const h1 = before.match(/^#\s+(.+?)\s*$/m)?.[1]
      const proposal: WriteProposal = {
        id: `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        reqId,
        path: p,
        title: h1 && h1.length <= 30 ? h1 : titleOf(p),
        before,
        after: text,
        add: Math.max(add, 1),
        del,
        createdAt: Date.now()
      }
      pendingWrites.set(proposal.id, proposal)
      send('ai:write', proposal)
      return `已提交修改提案（尚未写入磁盘，等用户在面板里确认）：${p}，+${proposal.add} −${proposal.del} 行。请用一到两句话说明改了什么，并提醒用户点「应用」生效。`
    }
    return `未知工具：${name}`
  } catch (err) {
    return `操作失败：${(err as Error)?.message || '未知错误'}`
  }
}

interface StreamResult {
  text: string
  reasoning: string
  toolCalls: ToolCall[]
  usage?: { prompt: number; completion: number }
}

async function streamOnce(
  profile: ModelProfile,
  messages: any[],
  opts: { withTools: boolean; reqId: string; base: string; temperature?: number; maxTokens?: number },
  controller: AbortController,
  send: (channel: string, payload: unknown) => void
): Promise<StreamResult> {
  const buildBody = (withUsage: boolean, withTools: boolean) => ({
    model: profile.model,
    messages,
    stream: true,
    temperature: opts.temperature ?? profile.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? profile.maxTokens ?? 4000,
    ...(withUsage ? { stream_options: { include_usage: true } } : {}),
    ...(withTools ? { tools: VAULT_TOOLS, tool_choice: 'auto' } : {})
  })

  let extra: Record<string, string> = {}
  if (profile.extraHeaders?.trim()) {
    try {
      extra = JSON.parse(profile.extraHeaders)
    } catch {
      extra = {}
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    ...extra
  }
  if (profile.apiKey?.trim()) headers.Authorization = `Bearer ${profile.apiKey.trim()}`

  let withUsage = true
  let withTools = opts.withTools
  let res = await fetch(endpoint(profile.baseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify(buildBody(withUsage, withTools)),
    signal: controller.signal
  })

  // 兼容性降级：不认 stream_options 的去掉用量统计；
  // 不支持 tools 的（部分小模型 / 转发层）去掉工具，退化为纯对话。
  let downgrades = 0
  while (!res.ok && res.status === 400 && downgrades < 2) {
    const raw = await res.clone().text().catch(() => '')
    if (withUsage && /stream_options/i.test(raw)) {
      withUsage = false
    } else if (withTools && /tool|function|parallel/i.test(raw)) {
      withTools = false
      send('ai:tool', { reqId: opts.reqId, name: '', status: 'unsupported' })
    } else {
      break
    }
    downgrades++
    res = await fetch(endpoint(profile.baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify(buildBody(withUsage, withTools)),
      signal: controller.signal
    })
  }

  if (!res.ok) {
    const raw = await res.text().catch(() => '')
    throw new Error(describeHttpError(res.status, raw))
  }
  if (!res.body) throw new Error('服务端没有返回流式响应')

  // 有些兼容实现无视 stream:true 直接回一整个 JSON
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const data: any = await res.json().catch(() => null)
    const message = data?.choices?.[0]?.message
    const text: string = message?.content ?? data?.choices?.[0]?.text ?? ''
    const calls: ToolCall[] = Array.isArray(message?.tool_calls)
      ? message.tool_calls.map((c: any, i: number) => ({
          id: c.id || `call_${i}`,
          type: 'function' as const,
          function: { name: c.function?.name || '', arguments: c.function?.arguments || '{}' }
        }))
      : []
    if (!text && !calls.length) throw new Error('模型没有返回内容')
    send('ai:stream', { reqId: opts.reqId, text: opts.base + text, reasoning: '' })
    return {
      text,
      reasoning: '',
      toolCalls: calls,
      usage: data?.usage
        ? { prompt: data.usage.prompt_tokens ?? 0, completion: data.usage.completion_tokens ?? 0 }
        : undefined
    }
  }

  const emitter = makeEmitter(opts.reqId, send, opts.base)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let usage: { prompt: number; completion: number } | undefined
  const calls: ToolCall[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let idx = buffer.indexOf('\n')
    while (idx >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '')
      buffer = buffer.slice(idx + 1)
      idx = buffer.indexOf('\n')

      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue

      let chunk: any
      try {
        chunk = JSON.parse(data)
      } catch {
        continue
      }

      if (chunk.usage) {
        usage = {
          prompt: chunk.usage.prompt_tokens ?? chunk.usage.input_tokens ?? 0,
          completion: chunk.usage.completion_tokens ?? chunk.usage.output_tokens ?? 0
        }
      }
      const delta = chunk.choices?.[0]?.delta
      if (delta) {
        const reason = delta.reasoning_content ?? delta.reasoning ?? ''
        emitter.push(typeof delta.content === 'string' ? delta.content : '', typeof reason === 'string' ? reason : '')
        // 工具调用是增量下发的：按 index 聚合函数名与参数片段
        if (Array.isArray(delta.tool_calls)) {
          for (const part of delta.tool_calls) {
            const i = typeof part.index === 'number' ? part.index : calls.length
            if (!calls[i]) calls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } }
            if (part.id) calls[i].id = part.id
            if (part.function?.name) calls[i].function.name += part.function.name
            if (part.function?.arguments) calls[i].function.arguments += part.function.arguments
          }
        }
      }
      if (chunk.error) throw new Error(chunk.error.message || '服务端返回错误')
    }
  }

  const final = emitter.finish()
  const validCalls = calls.filter((c) => c && c.function?.name)
  validCalls.forEach((c, i) => {
    if (!c.id) c.id = `call_${Date.now().toString(36)}_${i}`
  })
  if (!final.text.trim() && !final.reasoning.trim() && !validCalls.length) {
    throw new Error('模型没有返回内容')
  }
  return { text: final.text, reasoning: final.reasoning, toolCalls: validCalls, usage }
}

// ---------------------------------------------------------------------------
// 多轮：模型可以请求读文档，读完再继续回答
// ---------------------------------------------------------------------------
async function runChat(
  profile: ModelProfile,
  payload: ChatRequest,
  controller: AbortController,
  send: (channel: string, payload: unknown) => void,
  vault: VaultAccess | null
) {
  const messages: any[] = [
    ...(payload.system ? [{ role: 'system', content: payload.system }] : []),
    ...payload.messages
  ]
  const withTools = !!payload.tools && !!vault
  let acc = ''
  let accReason = ''
  let usage: { prompt: number; completion: number } | undefined

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const r = await streamOnce(
      profile,
      messages,
      {
        withTools,
        reqId: payload.reqId,
        base: acc,
        temperature: payload.temperature,
        maxTokens: payload.maxTokens
      },
      controller,
      send
    )
    if (r.usage) usage = r.usage
    if (r.reasoning) accReason = accReason ? `${accReason}\n${r.reasoning}` : r.reasoning
    acc += r.text

    const wantsTools = withTools && r.toolCalls.length > 0 && round < MAX_TOOL_ROUNDS
    if (!wantsTools || !vault) {
      if (!acc.trim() && !accReason.trim()) {
        acc = r.toolCalls.length
          ? '模型连续调用工具但没有给出结论。可以换个问法，或减少上下文文档后重试。'
          : ''
        if (!acc) throw new Error('模型没有返回内容')
      }
      send('ai:done', { reqId: payload.reqId, text: acc, reasoning: accReason, usage })
      return
    }

    messages.push({
      role: 'assistant',
      content: r.text || null,
      tool_calls: r.toolCalls.map((c) => ({ id: c.id, type: 'function', function: c.function }))
    })

    for (const call of r.toolCalls) {
      send('ai:tool', {
        reqId: payload.reqId,
        name: call.function.name,
        args: call.function.arguments,
        status: 'running'
      })
      const out = await execTool(call.function.name, call.function.arguments, {
        vault,
        send,
        reqId: payload.reqId
      })
      messages.push({ role: 'tool', tool_call_id: call.id, content: out })
      send('ai:tool', {
        reqId: payload.reqId,
        name: call.function.name,
        args: call.function.arguments,
        status: 'done',
        preview: out.slice(0, 120)
      })
    }
  }
}

// ---------------------------------------------------------------------------
// 一次性请求（起标题、连通性测试）
// ---------------------------------------------------------------------------
async function once(
  profile: ModelProfile,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  maxTokens: number,
  timeoutMs = 20000
): Promise<{ text: string; latency: number }> {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (profile.apiKey?.trim()) headers.Authorization = `Bearer ${profile.apiKey.trim()}`
    const res = await fetch(endpoint(profile.baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: profile.model,
        messages,
        stream: false,
        temperature: 0.2,
        max_tokens: maxTokens
      }),
      signal: controller.signal
    })
    if (!res.ok) throw new Error(describeHttpError(res.status, await res.text().catch(() => '')))
    const rawText = await res.text()
    let data: any
    try {
      data = JSON.parse(rawText)
    } catch {
      throw new Error('接口返回的不是 JSON，请检查接口地址是否指向 OpenAI 兼容端点')
    }
    const text =
      data?.choices?.[0]?.message?.content ??
      data?.choices?.[0]?.text ??
      data?.output?.[0]?.content?.[0]?.text ??
      ''
    return { text: String(text).trim(), latency: Date.now() - started }
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// 注册 IPC
// ---------------------------------------------------------------------------
export function registerAi(
  userDir: string,
  getWindow: () => BrowserWindow | null,
  getVault?: () => VaultAccess
) {
  USER_DIR = userDir
  MODELS_FILE = join(USER_DIR, 'models.json')
  SESSIONS_FILE = join(USER_DIR, 'sessions.json')
  ensureDir(USER_DIR)
  loadAll()

  const send = (channel: string, payload: unknown) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  ipcMain.handle('ai:models', () => models)

  ipcMain.handle('ai:model:save', (_e, profile: ModelProfile) => {
    const clean: ModelProfile = {
      ...profile,
      id: profile.id || `m-${Date.now().toString(36)}`,
      name: profile.name?.trim() || '未命名模型',
      baseUrl: profile.baseUrl?.trim() || '',
      model: profile.model?.trim() || '',
      temperature: Number.isFinite(profile.temperature) ? profile.temperature : 0.3,
      maxTokens: Number.isFinite(profile.maxTokens) ? profile.maxTokens : 4000,
      maxContext: Number.isFinite(profile.maxContext) ? profile.maxContext : 128000,
      createdAt: profile.createdAt || Date.now()
    }
    const idx = models.findIndex((m) => m.id === clean.id)
    models = idx >= 0 ? models.map((m) => (m.id === clean.id ? clean : m)) : [...models, clean]
    writeJSON(MODELS_FILE, models)
    return models
  })

  ipcMain.handle('ai:model:remove', (_e, id: string) => {
    models = models.filter((m) => m.id !== id)
    writeJSON(MODELS_FILE, models)
    return models
  })

  ipcMain.handle('ai:model:test', async (_e, profile: ModelProfile) => {
    try {
      const { text, latency } = await once(profile, [{ role: 'user', content: '回复 ok' }], 16)
      return { ok: true, latency, message: text.slice(0, 60) || 'ok' }
    } catch (err) {
      return { ok: false, latency: 0, message: describeError(err) }
    }
  })

  ipcMain.handle('ai:chat', async (_e, payload: ChatRequest) => {
    const profile = models.find((m) => m.id === payload.profileId)
    if (!profile) throw new Error('还没有可用的模型，请先在设置里添加')
    if (!profile.model?.trim()) throw new Error('模型名称为空')

    running.get(payload.reqId)?.abort()
    const controller = new AbortController()
    running.set(payload.reqId, controller)

    runChat(profile, payload, controller, send, getVault ? getVault() : null)
      .catch((err) => {
        if ((err as { name?: string })?.name === 'AbortError') {
          send('ai:aborted', { reqId: payload.reqId })
        } else {
          send('ai:error', { reqId: payload.reqId, message: describeError(err) })
        }
      })
      .finally(() => running.delete(payload.reqId))

    return { ok: true }
  })

  ipcMain.handle('ai:abort', (_e, reqId: string) => {
    running.get(reqId)?.abort()
    return true
  })

  ipcMain.handle('ai:title', async (_e, payload: { profileId: string; content: string }) => {
    const profile = models.find((m) => m.id === payload.profileId)
    if (!profile) return null
    try {
      const { text } = await once(
        profile,
        [
          {
            role: 'system',
            content:
              '你是命名助手。根据用户给出的 Markdown 片段，生成一个 6-14 个汉字的中文标题，概括核心问题或主题。只输出标题本身，不要引号、不要标点结尾、不要解释。'
          },
          { role: 'user', content: payload.content.slice(0, 4000) }
        ],
        32,
        15000
      )
      const clean = text.replace(/^#+\s*/, '').replace(/[「」"']/g, '').split('\n')[0].trim()
      return clean.slice(0, 24) || null
    } catch {
      return null
    }
  })

  ipcMain.handle('ai:write:apply', async (_e, id: string) => {
    const w = pendingWrites.get(id)
    if (!w) return { ok: false, message: '这条提案已经失效' }
    const vault = getVault ? getVault() : null
    if (!vault) return { ok: false, message: '没有可写的笔记库' }
    try {
      const current = await vault.read(w.path).catch(() => null)
      if (current === null) return { ok: false, message: '文档已经不在了，提案作废' }
      if (current !== w.before) return { ok: false, message: '文档在这期间被改过，提案已过期，让 AI 重新生成一次' }
      await vault.write(w.path, w.after)
      pendingWrites.delete(id)
      return { ok: true, path: w.path, content: w.after, before: w.before }
    } catch (err) {
      return { ok: false, message: describeError(err) }
    }
  })

  ipcMain.handle('ai:write:discard', (_e, id: string) => {
    pendingWrites.delete(id)
    return true
  })

  ipcMain.handle('ai:sessions', () => sessions)

  ipcMain.handle('ai:sessions:save', (_e, list: AiSession[]) => {
    sessions = list.slice(0, 80)
    writeJSON(SESSIONS_FILE, sessions)
    return true
  })
}
