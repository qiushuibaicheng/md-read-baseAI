import { BrowserWindow, ipcMain, shell } from 'electron'
import { dirname, join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { describeError, once, streamOnce, streamWithRetry } from './client'
import { foldMessages, summarize } from './compact'
import { SkillStore } from './skills'
import { McpManager } from './mcp'
import { BUILTIN_TOOLS, execTool, pendingWrites } from './tools'
import type {
  AiSession,
  AiSessionMessage,
  AskRequest,
  ChatRequest,
  ModelProfile,
  PlanStep,
  SubAgentReq,
  ToolCall,
  ToolSpec,
  VaultAccess,
  WriteProposal
} from './types'

export type { AiSession, AiSessionMessage, ModelProfile, PlanStep, VaultAccess, WriteProposal }

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
let skills: SkillStore
let mcp: McpManager

const MAX_TOOL_ROUNDS = 12
const MAX_TOOL_CALLS = 40
const CHAT_DEADLINE_MS = 8 * 60 * 1000

const running = new Map<string, AbortController>()
const pendingAsks = new Map<string, { resolve: (v: string) => void; timer: NodeJS.Timeout }>()

// ---------------------------------------------------------------------------
// 子智能体
// ---------------------------------------------------------------------------
const SUB_ROLES: Record<string, { title: string; prompt: string; tools: string[] }> = {
  researcher: {
    title: '研究员',
    prompt: `你是一个只读的研究员。你的任务是在笔记库里找出与问题相关的事实，然后给出结论。
- 先用 list_tree / search_docs 定位，再 read_doc 读关键段落，不要一篇篇全读。
- 只报告材料里真实存在的内容，标出出处（文件名 + 行号）。
- 你没有写权限，不要尝试修改任何东西。
- 输出控制在 400 字内：先结论，再证据清单。`,
    tools: ['list_tree', 'list_docs', 'read_doc', 'search_docs', 'get_outline', 'list_snippets']
  },
  writer: {
    title: '写作者',
    prompt: `你负责把给定材料写成 Markdown 文档。调用方已经把要求说清楚了。
- 先读指定文档确认原文，再动手写。
- 写已有文档用 edit_doc（生成提案），新建用 create_doc。
- 只写材料支持的内容，不编造数值、时间、结论。
- 完成后用一句话说明写了什么、写在哪。`,
    tools: ['list_tree', 'list_docs', 'read_doc', 'search_docs', 'get_outline', 'create_doc', 'edit_doc', 'create_folder', 'move_entry']
  },
  reviewer: {
    title: '审校者',
    prompt: `你负责挑错。检查文档之间是否有矛盾、数字是否前后一致、结论是否有材料支撑。
- 逐条给出「问题 — 依据 — 建议怎么改」，不要泛泛而谈。
- 没有问题就说没有问题，不要为了凑数硬找。
- 你没有写权限，只报告不修改。
- 最多 8 条，按严重程度排序。`,
    tools: ['list_tree', 'list_docs', 'read_doc', 'search_docs', 'get_outline']
  }
}

// ---------------------------------------------------------------------------
// 主对话
// ---------------------------------------------------------------------------
function toolSpecs(mcpTools: ToolSpec[]): ToolSpec[] {
  return [...BUILTIN_TOOLS, ...mcpTools]
}

async function collectMcpTools(): Promise<ToolSpec[]> {
  try {
    const list = await mcp.allTools()
    return list.length ? mcp.specs(list) : []
  } catch {
    return []
  }
}

interface RunCtx {
  profile: ModelProfile
  reqId: string
  controller: AbortController
  send: (channel: string, payload: unknown) => void
  vault: VaultAccess
  budget: number
  plan: PlanStep[]
  toolCalls: number
  deadline: number
}

function makeToolCtx(ctx: RunCtx, depth = 0, allow?: Set<string>): Parameters<typeof execTool>[2] {
  return {
    send: ctx.send,
    reqId: ctx.reqId,
    vault: ctx.vault,
    skills,
    mcp,
    signal: ctx.controller.signal,
    allow,
    plan: (steps) => {
      // 子智能体不该改主计划
      if (depth > 0) return
      ctx.plan = steps
      ctx.send('ai:plan', { reqId: ctx.reqId, steps })
    },
    ask: (req: AskRequest) => (depth > 0 ? Promise.resolve('（子任务里不能询问用户，请自行判断）') : askUser(ctx, req)),
    runSub: (req: SubAgentReq) => runSubAgent(ctx, req, depth)
  }
}

/** 向用户提问：面板弹卡片，等回答或超时 */
function askUser(ctx: RunCtx, req: AskRequest): Promise<string> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingAsks.delete(req.id)
      ctx.send('ai:ask:drop', { id: req.id })
      resolve('（用户 5 分钟没有回答，请基于现有信息继续，不要再重复提问）')
    }, 5 * 60 * 1000)
    pendingAsks.set(req.id, {
      resolve: (v) => {
        clearTimeout(timer)
        pendingAsks.delete(req.id)
        resolve(v || '（用户直接跳过了这个问题）')
      },
      timer
    })
    ctx.send('ai:ask', { reqId: ctx.reqId, ...req })
  })
}

async function runSubAgent(ctx: RunCtx, req: SubAgentReq, depth: number): Promise<string> {
  if (depth >= 1) return '子智能体不能再派子智能体，请直接自己做。'
  const role = SUB_ROLES[req.role] || SUB_ROLES.researcher
  const allowed = new Set(role.tools)
  const specs = toolSpecs(await collectMcpTools()).filter((t) => allowed.has(t.function.name))
  const messages: any[] = [
    { role: 'system', content: `${role.prompt}\n\n交付要求：${req.task}` }
  ]
  if (req.paths.length) {
    messages.push({ role: 'user', content: `先看这些文档：${req.paths.join('、')}` })
  }
  messages.push({ role: 'user', content: req.task })

  let acc = ''
  try {
    for (let round = 0; round <= req.rounds; round++) {
      if (ctx.controller.signal.aborted) throw Object.assign(new Error('已停止'), { name: 'AbortError' })
      const r = await streamOnce(
        ctx.profile,
        messages,
        { reqId: ctx.reqId, base: '', tools: round < req.rounds ? specs : [], maxTokens: Math.min(ctx.profile.maxTokens || 4000, 3000) },
        ctx.controller,
        // 子智能体的中间输出不推到主对话，避免串行污染
        () => undefined
      )
      acc = r.text.trim() ? r.text : acc
      if (!r.toolCalls.length) break
      messages.push({
        role: 'assistant',
        content: r.text || null,
        tool_calls: r.toolCalls.map((c) => ({ id: c.id, type: 'function', function: c.function }))
      })
      for (const call of r.toolCalls) {
        // 子智能体的工具调用同样受白名单约束，且事件带 depth 让面板缩进显示
        const out = await execTool(call.function.name, call.function.arguments, makeToolCtx(ctx, depth + 1, allowed))
        messages.push({ role: 'tool', tool_call_id: call.id, content: out.slice(0, 6000) })
        ctx.send('ai:tool', {
          reqId: ctx.reqId,
          name: call.function.name,
          args: call.function.arguments,
          status: 'done',
          depth: depth + 1,
          preview: out.slice(0, 100)
        })
      }
    }
    return acc.trim() || '（子智能体没有产出结论）'
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') throw err
    return `子智能体执行失败：${describeError(err)}`
  }
}

async function runChat(profile: ModelProfile, payload: ChatRequest, controller: AbortController, send: (c: string, p: unknown) => void, vault: VaultAccess | null) {
  const budget = Math.max(4000, Number(payload.budget) || 32000)
  let messages: any[] = [...(payload.system ? [{ role: 'system', content: payload.system }] : []), ...payload.messages]
  const withTools = !!payload.tools && !!vault

  // 历史太长就先折叠，压不下去再摘要
  if (messages.length > 6) {
    const folded = foldMessages(messages, budget)
    if (folded.folded) {
      messages = folded.messages
      send('ai:ctx', { reqId: payload.reqId, folded: folded.folded, saved: folded.savedTokens })
    }
  }
  if (messages.length > 14) {
    const sum = await summarize(profile, messages, budget)
    if (sum.note) {
      messages = sum.messages
      send('ai:ctx', { reqId: payload.reqId, summarized: true })
    }
  }

  const ctx: RunCtx = {
    profile,
    reqId: payload.reqId,
    controller,
    send,
    vault: vault as VaultAccess,
    budget,
    plan: [],
    toolCalls: 0,
    deadline: Date.now() + CHAT_DEADLINE_MS
  }

  const mcpSpecs = withTools ? await collectMcpTools() : []
  const specs = withTools ? toolSpecs(mcpSpecs) : []
  if (mcpSpecs.length) send('ai:mcp', { reqId: payload.reqId, tools: mcpSpecs.length })

  let acc = ''
  let accReason = ''
  let usage: { prompt: number; completion: number } | undefined

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    if (controller.signal.aborted) throw Object.assign(new Error('已停止'), { name: 'AbortError' })
    if (Date.now() > ctx.deadline) {
      acc += '\n\n（这一轮已经跑了 8 分钟，我先停下。要继续就跟我说一声。）'
      break
    }

    const r = await streamWithRetry(
      profile,
      messages,
      {
        reqId: payload.reqId,
        base: acc,
        temperature: payload.temperature,
        maxTokens: payload.maxTokens,
        tools: round < MAX_TOOL_ROUNDS ? specs : [],
        onDowngrade: (why) => {
          if (why === 'tools') send('ai:tool', { reqId: payload.reqId, name: '', status: 'unsupported' })
        }
      },
      controller,
      send
    )
    if (r.usage) usage = r.usage
    if (r.reasoning) accReason = accReason ? `${accReason}\n${r.reasoning}` : r.reasoning
    acc += r.text

    const wantsTools = withTools && r.toolCalls.length > 0 && round < MAX_TOOL_ROUNDS && ctx.toolCalls < MAX_TOOL_CALLS
    if (!wantsTools) {
      if (!acc.trim() && !accReason.trim()) {
        acc = r.toolCalls.length
          ? '模型连续调用工具但没有给出结论。可以换个问法，或减少带入的文档后重试。'
          : ''
        if (!acc) throw new Error('模型没有返回内容')
      }
      send('ai:done', { reqId: payload.reqId, text: acc, reasoning: accReason, usage, plan: ctx.plan })
      return
    }

    messages.push({
      role: 'assistant',
      content: r.text || null,
      tool_calls: r.toolCalls.map((c) => ({ id: c.id, type: 'function', function: c.function }))
    })

    for (const call of r.toolCalls) {
      ctx.toolCalls++
      send('ai:tool', {
        reqId: payload.reqId,
        name: call.function.name,
        args: call.function.arguments,
        status: 'running'
      })
      const out = await execTool(call.function.name, call.function.arguments, makeToolCtx(ctx))
      messages.push({ role: 'tool', tool_call_id: call.id, content: out.slice(0, 14000) })
      send('ai:tool', {
        reqId: payload.reqId,
        name: call.function.name,
        args: call.function.arguments,
        status: 'done',
        preview: out.slice(0, 140)
      })
      if (ctx.controller.signal.aborted) throw Object.assign(new Error('已停止'), { name: 'AbortError' })
    }

    // 每轮结束都重新评估历史长度，避免工具结果把上下文撑爆
    const folded = foldMessages(messages, budget)
    if (folded.folded) {
      messages = folded.messages
      send('ai:ctx', { reqId: payload.reqId, folded: folded.folded, saved: folded.savedTokens })
    }
  }

  // 轮次用尽：让模型基于已有材料收口
  const finalNote = '\n\n（工具调用次数到上限了，基于目前掌握的材料给结论。）'
  messages.push({ role: 'user', content: finalNote })
  const last = await streamWithRetry(profile, messages, { reqId: payload.reqId, base: acc, noTools: true }, controller, send)
  acc += last.text
  send('ai:done', { reqId: payload.reqId, text: acc, reasoning: accReason, usage, plan: ctx.plan })
}

// ---------------------------------------------------------------------------
// 注册 IPC
// ---------------------------------------------------------------------------
export function registerAi(userDir: string, getWindow: () => BrowserWindow | null, getVault?: () => VaultAccess) {
  USER_DIR = userDir
  MODELS_FILE = join(USER_DIR, 'models.json')
  SESSIONS_FILE = join(USER_DIR, 'sessions.json')
  ensureDir(USER_DIR)
  models = readJSON<ModelProfile[]>(MODELS_FILE, [])
  sessions = readJSON<AiSession[]>(SESSIONS_FILE, [])
  skills = new SkillStore(USER_DIR)
  skills.seed()
  mcp = new McpManager(USER_DIR)

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
    running.delete(reqId)
    return true
  })

  ipcMain.handle('ai:ask:answer', (_e, payload: { id: string; answer: string }) => {
    pendingAsks.get(payload.id)?.resolve(payload.answer)
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
      if (w.kind === 'delete') {
        try {
          await vault.remove(w.path)
        } catch (err) {
          return { ok: false, message: `删除失败：${(err as Error).message}` }
        }
        pendingWrites.delete(id)
        return { ok: true, path: w.path, deleted: true }
      }
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

  // ------------------------------------------------------------------ 扩展
  ipcMain.handle('ext:skills', () => skills.list())

  ipcMain.handle('ext:skill:save', (_e, input: { name: string; description?: string; when?: string; body: string }) =>
    skills.save(input)
  )

  ipcMain.handle('ext:skill:remove', (_e, name: string) => skills.remove(name))

  ipcMain.handle('ext:skill:reveal', async () => {
    await shell.openPath(skills.dir)
    return true
  })

  ipcMain.handle('ext:mcp:config', () => mcp.config())

  ipcMain.handle('ext:mcp:save', async (_e, cfg: { mcpServers: Record<string, unknown> }) => {
    mcp.save({ mcpServers: (cfg?.mcpServers || {}) as never })
    return mcp.listStatus()
  })

  ipcMain.handle('ext:mcp:status', async (_e, reload?: boolean) => {
    await mcp.allTools(!!reload)
    return mcp.listStatus()
  })

  ipcMain.handle('ext:mcp:tools', async () => {
    const list = await mcp.allTools()
    return list.map((t) => ({ server: t.server, name: t.name, description: t.description }))
  })

  ipcMain.handle('ext:mcp:file', () => mcp.file)
}

/** 应用退出时收掉 MCP 子进程 */
export function shutdownAi() {
  mcp?.shutdown()
  for (const [, slot] of pendingAsks) clearTimeout(slot.timer)
  pendingAsks.clear()
}

export type { ToolCall }
