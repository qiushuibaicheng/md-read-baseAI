// ---------------------------------------------------------------------------
// AI 内核共享类型
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
  tools?: string[]
  plan?: PlanStep[]
}

export interface AiSession {
  id: string
  title: string
  docPath: string | null
  messages: AiSessionMessage[]
  createdAt: number
  updatedAt: number
}

export interface ChatRequest {
  reqId: string
  profileId: string
  system?: string
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  temperature?: number
  maxTokens?: number
  /** 允许模型调用工具（vault / 技能 / MCP / 子智能体） */
  tools?: boolean
  /** 本轮上下文预算（token），用于折叠历史 */
  budget?: number
}

export interface PlanStep {
  id: string
  text: string
  status: 'pending' | 'doing' | 'done'
}

export interface AskOption {
  label: string
  value: string
}

export interface AskRequest {
  id: string
  question: string
  options: AskOption[]
  multiple: boolean
}

export interface SkillDef {
  name: string
  description: string
  when: string
  /** front-matter 之后的正文 */
  body: string
  file: string
  builtin?: boolean
}

/** 笔记库访问：由主进程 index.ts 注入实现 */
export interface VaultAccess {
  list(): Promise<{ path: string; title: string; size: number }[]>
  read(path: string): Promise<string>
  search(query: string): Promise<{ path: string; title: string; hits: { line: number; text: string }[] }[]>
  /** 覆盖写入（仅用于用户已确认的提案） */
  write(path: string, content: string): Promise<void>
  /** 新建文档，返回相对路径 */
  create(title: string, content: string, dir?: string): Promise<string>
  /** 所有文件夹相对路径 */
  folders(): Promise<string[]>
  /** 新建文件夹，返回相对路径 */
  createFolder(rel: string): Promise<string>
  /** 移动/改名，返回新相对路径 */
  move(from: string, toDir: string, newName?: string): Promise<string>
  /** 移到系统回收站 */
  remove(rel: string): Promise<void>
  /** 文档标题树 */
  outline(rel: string): Promise<{ level: number; text: string; line: number }[]>
  snippets(): { id: string; title: string; content: string }[]
  saveSnippet(title: string, content: string): { id: string; title: string; content: string }
  clips(): { text: string; time: number }[]
}

export interface WriteProposal {
  id: string
  reqId: string
  kind: 'write' | 'delete'
  path: string
  title: string
  before: string
  after: string
  add: number
  del: number
  createdAt: number
}

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ToolSpec {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface SubAgentReq {
  role: string
  task: string
  paths: string[]
  rounds: number
}

/** 技能存储对工具层暴露的最小面（避免 tools ← skills 的直接依赖） */
export interface SkillStoreLike {
  list(): SkillDef[]
  get(name: string): SkillDef | null
  save(input: { name: string; description?: string; when?: string; body: string }): SkillDef
}

export interface McpLike {
  call(name: string, args: unknown): Promise<string>
}

export interface ToolCtx {
  send: (channel: string, payload: unknown) => void
  reqId: string
  vault: VaultAccess
  skills: SkillStoreLike
  mcp: McpLike
  signal: AbortSignal
  /** 子智能体的工具白名单；undefined 表示全部允许 */
  allow?: Set<string>
  /** 向用户提问，返回用户的选择；超时返回说明文字 */
  ask: (req: AskRequest) => Promise<string>
  /** 把计划推给面板 */
  plan: (steps: PlanStep[]) => void
  /** 派子智能体 */
  runSub: (req: SubAgentReq) => Promise<string>
}

