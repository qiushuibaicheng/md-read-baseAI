import type { ModelProfile, ToolCall, ToolSpec } from './types'

// ---------------------------------------------------------------------------
// 请求地址与错误
// ---------------------------------------------------------------------------
export function endpoint(baseUrl: string): string {
  const raw = (baseUrl || '').trim().replace(/\/+$/, '')
  if (!raw) throw new Error('还没有填写接口地址')
  if (/\/chat\/completions$/i.test(raw)) return raw
  if (/\/v\d+[a-z]*$/i.test(raw)) return `${raw}/chat/completions`
  return `${raw}/v1/chat/completions`
}

export function describeHttpError(status: number, body: string): string {
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
    413: '上下文超出模型窗口，减少带入的文档或降低预算',
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

export function describeError(err: unknown): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string } }
  if (e?.name === 'AbortError') return '已停止生成'
  const code = e?.cause?.code || ''
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '域名解析失败，检查接口地址或网络'
  if (code === 'ECONNREFUSED') return '连接被拒绝，检查接口地址与端口'
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return '连接超时，检查网络或代理'
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return '连接被中断，可能是网络抖动'
  if (code === 'CERT_HAS_EXPIRED' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT') return '证书校验失败，可尝试改用 http 或换网络'
  if (/fetch failed/i.test(e?.message || '')) return '网络请求失败，检查网络 / 代理设置'
  return e?.message || '未知错误'
}

/** 值得重试的错误：网络抖动、网关错误、限流 */
export function isRetryable(err: unknown): boolean {
  const e = err as { message?: string; cause?: { code?: string }; status?: number }
  const code = e?.cause?.code || ''
  if (['ECONNRESET', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'EAI_AGAIN'].includes(code)) return true
  if (/fetch failed|network|socket hang up|terminated/i.test(e?.message || '')) return true
  if (e?.status && [429, 500, 502, 503, 504].includes(e.status)) return true
  return false
}

// ---------------------------------------------------------------------------
// 流式拼接
// ---------------------------------------------------------------------------
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

export interface StreamResult {
  text: string
  reasoning: string
  toolCalls: ToolCall[]
  usage?: { prompt: number; completion: number }
  /** 模型是否在流里出现过（用于判断重试是否安全） */
  emitted: boolean
}

export interface StreamOpts {
  reqId: string
  base: string
  temperature?: number
  maxTokens?: number
  tools?: ToolSpec[]
  /** 强制不带工具（子智能体的最终归纳轮） */
  noTools?: boolean
  onDowngrade?: (reason: 'usage' | 'tools') => void
}

function buildHeaders(profile: ModelProfile): Record<string, string> {
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
  return headers
}

export async function streamOnce(
  profile: ModelProfile,
  messages: unknown[],
  opts: StreamOpts,
  controller: AbortController,
  send: (channel: string, payload: unknown) => void
): Promise<StreamResult> {
  const headers = buildHeaders(profile)
  const tools = opts.noTools ? [] : opts.tools || []
  const body = (withUsage: boolean, withTools: boolean) => ({
    model: profile.model,
    messages,
    stream: true,
    temperature: opts.temperature ?? profile.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? profile.maxTokens ?? 4000,
    ...(withUsage ? { stream_options: { include_usage: true } } : {}),
    ...(withTools && tools.length ? { tools, tool_choice: 'auto' } : {})
  })

  let withUsage = true
  let withTools = tools.length > 0
  let res = await fetch(endpoint(profile.baseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify(body(withUsage, withTools)),
    signal: controller.signal
  })

  // 兼容性降级：不认 stream_options 的去掉用量统计；
  // 不支持 tools 的（部分小模型 / 转发层）去掉工具，退化为纯对话。
  let downgrades = 0
  while (!res.ok && res.status === 400 && downgrades < 2) {
    const raw = await res.clone().text().catch(() => '')
    if (withUsage && /stream_options/i.test(raw)) {
      withUsage = false
      opts.onDowngrade?.('usage')
    } else if (withTools && /tool|function|parallel/i.test(raw)) {
      withTools = false
      opts.onDowngrade?.('tools')
    } else {
      break
    }
    downgrades++
    res = await fetch(endpoint(profile.baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify(body(withUsage, withTools)),
      signal: controller.signal
    })
  }

  if (!res.ok) {
    const raw = await res.text().catch(() => '')
    const err = new Error(describeHttpError(res.status, raw)) as Error & { status?: number }
    err.status = res.status
    throw err
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
      emitted: true,
      usage: data?.usage
        ? { prompt: data.usage.prompt_tokens ?? 0, completion: data.usage.completion_tokens ?? 0 }
        : undefined
    }
  }

  const emitter = makeEmitter(opts.reqId, send, opts.base)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let emitted = false
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
        const content = typeof delta.content === 'string' ? delta.content : ''
        if (content || reason) emitted = true
        emitter.push(content, typeof reason === 'string' ? reason : '')
        // 工具调用是增量下发的：按 index 聚合函数名与参数片段
        if (Array.isArray(delta.tool_calls)) {
          emitted = true
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
  return { text: final.text, reasoning: final.reasoning, toolCalls: validCalls, usage, emitted }
}

/** 带重试的流式请求：只在完全没吐出内容时重试，避免重复输出 */
export async function streamWithRetry(
  profile: ModelProfile,
  messages: unknown[],
  opts: StreamOpts,
  controller: AbortController,
  send: (channel: string, payload: unknown) => void,
  maxRetry = 2
): Promise<StreamResult> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    try {
      return await streamOnce(profile, messages, opts, controller, send)
    } catch (err) {
      lastErr = err
      if (controller.signal.aborted) throw err
      if (!isRetryable(err) || attempt === maxRetry) throw err
      send('ai:retry', { reqId: opts.reqId, attempt: attempt + 1, max: maxRetry + 1 })
      await new Promise((r) => setTimeout(r, 700 * Math.pow(2, attempt)))
    }
  }
  throw lastErr
}

// ---------------------------------------------------------------------------
// 一次性请求（起标题、连通性测试、上下文摘要）
// ---------------------------------------------------------------------------
export async function once(
  profile: ModelProfile,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  maxTokens: number,
  timeoutMs = 20000,
  noCache?: boolean
): Promise<{ text: string; latency: number }> {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers = buildHeaders(profile)
    headers.Accept = 'application/json'
    const res = await fetch(endpoint(profile.baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: profile.model,
        messages,
        stream: false,
        temperature: noCache ? 0.1 : 0.2,
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
