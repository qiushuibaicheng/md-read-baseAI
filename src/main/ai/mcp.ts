import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import type { ToolSpec } from './types'

/**
 * 极简 MCP 客户端（stdio / JSON-RPC 2.0）。
 *
 * 只做三件事：握手、拉工具清单、调工具。不引第三方依赖——官方 SDK 是 ESM，
 * 主进程被打成 CJS 时容易踩坑，而我们要的协议面就这么点。
 */

interface ServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
  disabled?: boolean
  /** 界面备注，不参与协议 */
  note?: string
}

interface McpConfig {
  mcpServers: Record<string, ServerConfig>
}

export interface McpToolInfo {
  server: string
  name: string
  /** 注入给模型的完整工具名 */
  fullName: string
  description: string
  schema: Record<string, unknown>
}

export interface McpStatus {
  name: string
  state: 'idle' | 'starting' | 'ready' | 'error' | 'disabled'
  tools: number
  error?: string
  command: string
  note?: string
}

interface Rpc {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

class Client {
  name: string
  cfg: ServerConfig
  proc: ChildProcessWithoutNullStreams | null = null
  buffer = ''
  seq = 0
  waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
  ready = false
  starting: Promise<void> | null = null
  error = ''
  tools: McpToolInfo[] = []
  onExit: (name: string) => void

  constructor(name: string, cfg: ServerConfig, onExit: (name: string) => void) {
    this.name = name
    this.cfg = cfg
    this.onExit = onExit
  }

  start(): Promise<void> {
    if (this.ready) return Promise.resolve()
    if (this.starting) return this.starting
    this.starting = new Promise<void>((resolve, reject) => {
      const command = this.cfg.command?.trim()
      if (!command) {
        reject(new Error('没有填写启动命令'))
        return
      }
      const args = Array.isArray(this.cfg.args) ? this.cfg.args : []
      const env = { ...process.env, ...(this.cfg.env || {}) }
      let proc: ChildProcessWithoutNullStreams
      try {
        proc = spawn(command, args, {
          env,
          cwd: process.env.HOME || process.cwd(),
          shell: process.platform === 'win32',
          windowsHide: true
        })
      } catch (err) {
        reject(err as Error)
        return
      }
      this.proc = proc
      this.error = ''

      const fail = (msg: string) => {
        this.error = msg
        this.ready = false
        reject(new Error(msg))
      }

      proc.on('error', (err) => fail(`启动失败：${err.message}`))
      proc.on('exit', (code) => {
        this.ready = false
        this.proc = null
        if (code !== 0 && code !== null) this.error = this.error || `进程退出（code ${code}）`
        this.onExit(this.name)
      })
      proc.stdout.setEncoding('utf-8')
      proc.stdout.on('data', (chunk: string) => this.onData(chunk))
      proc.stderr.setEncoding('utf-8')
      proc.stderr.on('data', (chunk: string) => {
        // 服务端日志不打断协议，留最后一行方便排查
        const line = String(chunk).trim().split('\n').pop()
        if (line) this.error = line.slice(0, 200)
      })

      const timer = setTimeout(() => fail('握手超时（20 秒），检查命令是否需要联网安装'), 20000)
      this.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: { roots: { listChanged: false } },
        clientInfo: { name: 'inkwell', version: '1.0.0' }
      })
        .then(() => {
          clearTimeout(timer)
          this.notify('notifications/initialized', {})
          this.ready = true
          resolve()
        })
        .catch((err) => {
          clearTimeout(timer)
          fail((err as Error).message)
        })
    }).finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private onData(chunk: string) {
    this.buffer += chunk
    let idx = this.buffer.indexOf('\n')
    while (idx >= 0) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      idx = this.buffer.indexOf('\n')
      if (!line) continue
      let msg: any
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      if (typeof msg.id === 'number' && this.waiting.has(msg.id)) {
        const slot = this.waiting.get(msg.id)!
        this.waiting.delete(msg.id)
        clearTimeout(slot.timer)
        if (msg.error) slot.reject(new Error(msg.error.message || 'MCP 调用失败'))
        else slot.resolve(msg.result)
      }
      // 服务端主动通知（日志、进度）直接忽略
    }
  }

  private write(obj: Rpc | Record<string, unknown>) {
    if (!this.proc || !this.proc.stdin.writable) throw new Error('MCP 进程未运行')
    this.proc.stdin.write(`${JSON.stringify(obj)}\n`)
  }

  private notify(method: string, params: unknown) {
    try {
      this.write({ jsonrpc: '2.0', method, params })
    } catch {
      /* 进程已死，交给 exit 处理 */
    }
  }

  request(method: string, params: unknown, timeoutMs = 60000): Promise<any> {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        reject(new Error(`${method} 超时（${Math.round(timeoutMs / 1000)} 秒）`))
      }, timeoutMs)
      this.waiting.set(id, { resolve, reject, timer })
      try {
        this.write({ jsonrpc: '2.0', id, method, params })
      } catch (err) {
        clearTimeout(timer)
        this.waiting.delete(id)
        reject(err as Error)
      }
    })
  }

  async loadTools(): Promise<McpToolInfo[]> {
    if (!this.ready) await this.start()
    const res = await this.request('tools/list', {})
    const list: any[] = Array.isArray(res?.tools) ? res.tools : []
    this.tools = list.map((t) => ({
      server: this.name,
      name: String(t.name),
      fullName: toolName(this.name, String(t.name)),
      description: String(t.description || ''),
      schema: (t.inputSchema as Record<string, unknown>) || { type: 'object', properties: {} }
    }))
    return this.tools
  }

  async call(name: string, args: unknown): Promise<string> {
    if (!this.ready) await this.start()
    const res = await this.request('tools/call', { name, arguments: args || {} })
    return flatten(res)
  }

  stop() {
    this.waiting.forEach((slot) => {
      clearTimeout(slot.timer)
      slot.reject(new Error('MCP 服务已停止'))
    })
    this.waiting.clear()
    this.tools = []
    this.ready = false
    try {
      this.proc?.kill()
    } catch {
      /* ignore */
    }
    this.proc = null
  }
}

function toolName(server: string, tool: string): string {
  return `mcp__${server.replace(/[^a-zA-Z0-9]/g, '_')}__${tool.replace(/[^a-zA-Z0-9]/g, '_')}`
}

/** MCP 的 content 数组拼成纯文本 */
function flatten(res: any): string {
  if (!res) return '（无返回内容）'
  if (typeof res === 'string') return res
  const parts: string[] = []
  if (Array.isArray(res.content)) {
    for (const c of res.content) {
      if (c?.type === 'text' && typeof c.text === 'string') parts.push(c.text)
      else if (c?.type === 'resource' && typeof c.resource?.text === 'string') parts.push(c.resource.text)
      else if (c?.type === 'image') parts.push('[图片内容，已省略]')
      else parts.push(`[${c?.type || '未知'}内容]`)
    }
  }
  if (!parts.length && res.structuredContent) parts.push(JSON.stringify(res.structuredContent, null, 2))
  const text = parts.join('\n').trim() || '（无返回内容）'
  const capped = text.length > 12000 ? `${text.slice(0, 12000)}\n…（已截断）` : text
  return res.isError ? `调用失败：${capped}` : capped
}

export class McpManager {
  file: string
  clients = new Map<string, Client>()
  status = new Map<string, McpStatus>()
  toolsCache: McpToolInfo[] | null = null

  constructor(userDir: string) {
    this.file = join(userDir, 'mcp.json')
  }

  config(): McpConfig {
    if (!existsSync(this.file)) return { mcpServers: {} }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf-8'))
      return { mcpServers: parsed?.mcpServers && typeof parsed.mcpServers === 'object' ? parsed.mcpServers : {} }
    } catch {
      return { mcpServers: {} }
    }
  }

  save(cfg: McpConfig) {
    const dir = dirname(this.file)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(this.file, JSON.stringify(cfg, null, 2), 'utf-8')
    this.shutdown()
    this.toolsCache = null
  }

  /** 仅启用（disabled 不为 true）且填了 command 的服务器 */
  private enabled(): [string, ServerConfig][] {
    return Object.entries(this.config().mcpServers).filter(([, c]) => c && !c.disabled && c.command?.trim())
  }

  private client(name: string, cfg: ServerConfig): Client {
    let c = this.clients.get(name)
    if (!c) {
      c = new Client(name, cfg, (n) => {
        const st = this.status.get(n)
        if (st && st.state === 'ready') this.status.set(n, { ...st, state: 'error', tools: 0, error: '进程已退出' })
        this.toolsCache = null
      })
      this.clients.set(name, c)
    }
    return c
  }

  /** 拉取所有启用的服务器工具；失败的服务器跳过并记状态 */
  async allTools(force = false): Promise<McpToolInfo[]> {
    if (this.toolsCache && !force) return this.toolsCache
    const out: McpToolInfo[] = []
    for (const [name, cfg] of this.enabled()) {
      const status: McpStatus = { name, state: 'starting', tools: 0, command: cfg.command, note: cfg.note }
      this.status.set(name, status)
      const c = this.client(name, cfg)
      try {
        const tools = await c.loadTools()
        out.push(...tools)
        this.status.set(name, { ...status, state: 'ready', tools: tools.length, error: c.error || undefined })
      } catch (err) {
        this.status.set(name, {
          ...status,
          state: 'error',
          tools: 0,
          error: (err as Error).message || c.error || '连接失败'
        })
        c.stop()
        this.clients.delete(name)
      }
    }
    // 未启用的也列出来，界面上要能看到「为什么没生效」
    for (const [name, cfg] of Object.entries(this.config().mcpServers)) {
      if (!this.status.has(name)) this.status.set(name, { name, state: 'disabled', tools: 0, command: cfg.command, note: cfg.note })
    }
    this.toolsCache = out
    return out
  }

  specs(tools: McpToolInfo[]): ToolSpec[] {
    return tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.fullName,
        description: `[MCP:${t.server}] ${t.description}`.slice(0, 900),
        parameters: t.schema
      }
    }))
  }

  find(fullName: string): McpToolInfo | null {
    return (this.toolsCache || []).find((t) => t.fullName === fullName) || null
  }

  async call(fullName: string, args: unknown): Promise<string> {
    const info = this.find(fullName)
    if (!info) return `找不到 MCP 工具：${fullName}`
    const c = this.clients.get(info.server)
    if (!c) return `MCP 服务 ${info.server} 未连接`
    try {
      return await c.call(info.name, args)
    } catch (err) {
      return `MCP 调用失败：${(err as Error).message}`
    }
  }

  listStatus(): McpStatus[] {
    for (const [name, cfg] of Object.entries(this.config().mcpServers)) {
      if (!this.status.has(name)) this.status.set(name, { name, state: 'disabled', tools: 0, command: cfg.command, note: cfg.note })
    }
    return [...this.status.values()]
  }

  shutdown() {
    for (const c of this.clients.values()) c.stop()
    this.clients.clear()
    this.status.clear()
    this.toolsCache = null
  }
}
