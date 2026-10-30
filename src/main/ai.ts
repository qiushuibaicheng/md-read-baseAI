import { BrowserWindow, ipcMain } from 'electron'
import { dirname, join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------
export interface ModelProfile {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
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

function makeEmitter(reqId: string, send: (channel: string, payload: unknown) => void) {
  let text = ''
  let reasoning = ''
  let dirty = false
  let timer: NodeJS.Timeout | null = null

  const flush = () => {
    if (!dirty) return
    dirty = false
    send('ai:stream', { reqId, text, reasoning })
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

async function streamChat(
  profile: ModelProfile,
  payload: ChatRequest,
  controller: AbortController,
  send: (channel: string, payload: unknown) => void
) {
  const messages = [
    ...(payload.system ? [{ role: 'system' as const, content: payload.system }] : []),
    ...payload.messages
  ]

  const buildBody = (withUsage: boolean) => ({
    model: profile.model,
    messages,
    stream: true,
    temperature: payload.temperature ?? profile.temperature ?? 0.3,
    max_tokens: payload.maxTokens ?? profile.maxTokens ?? 4000,
    ...(withUsage ? { stream_options: { include_usage: true } } : {})
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

  let res = await fetch(endpoint(profile.baseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify(buildBody(true)),
    signal: controller.signal
  })

  // 部分兼容实现不认 stream_options，去掉再试一次
  if (!res.ok && res.status === 400) {
    const raw = await res.clone().text().catch(() => '')
    if (/stream_options/i.test(raw)) {
      res = await fetch(endpoint(profile.baseUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify(buildBody(false)),
        signal: controller.signal
      })
    }
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
    const text = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? ''
    if (!text) throw new Error('模型没有返回内容')
    send('ai:stream', { reqId: payload.reqId, text, reasoning: '' })
    send('ai:done', {
      reqId: payload.reqId,
      text,
      reasoning: '',
      usage: data?.usage
        ? { prompt: data.usage.prompt_tokens ?? 0, completion: data.usage.completion_tokens ?? 0 }
        : undefined
    })
    return
  }

  const emitter = makeEmitter(payload.reqId, send)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let usage: { prompt: number; completion: number } | undefined

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
      }
      if (chunk.error) throw new Error(chunk.error.message || '服务端返回错误')
    }
  }

  const final = emitter.finish()
  if (!final.text.trim() && !final.reasoning.trim()) {
    throw new Error('模型没有返回内容')
  }
  send('ai:done', { reqId: payload.reqId, text: final.text, reasoning: final.reasoning, usage })
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
export function registerAi(userDir: string, getWindow: () => BrowserWindow | null) {
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

    streamChat(profile, payload, controller, send)
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

  ipcMain.handle('ai:sessions', () => sessions)

  ipcMain.handle('ai:sessions:save', (_e, list: AiSession[]) => {
    sessions = list.slice(0, 80)
    writeJSON(SESSIONS_FILE, sessions)
    return true
  })
}
