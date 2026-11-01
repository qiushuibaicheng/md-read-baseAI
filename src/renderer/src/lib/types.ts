export interface AppConfig {
  vaultPath: string
  hotkey: string
  hideOnBlur: boolean
  alwaysOnTop: boolean
  threeBg: boolean
  clipboardWatch: boolean
  theme: 'light' | 'dark'
  editorMode: 'split' | 'edit' | 'preview'
  fontSize: number
  sidebarWidth: number
  lastDoc: string | null
  openTabs: string[]
  windowWidth: number
  windowHeight: number
  autoLaunch: boolean
  aiModelId: string | null
  aiAutoTitle: boolean
  aiPanelWidth: number
  accent: string
  themeMode: 'dark' | 'light' | 'system'
  /** 侧栏手动排序：目录相对路径 → 条目相对路径顺序 */
  order: Record<string, string[]>
}

export interface ModelProfile {
  id: string
  name: string
  /** 服务商标识（openai-compat / deepseek / glm / moonshot / qwen / ollama），只用于界面提示 */
  provider?: string
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
  /** 模型上下文窗口，决定 AI 面板里上下文预算的上限 */
  maxContext?: number
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
  /** 本次回答期间调用过的工具摘要，例如「读取 排查/502.md」 */
  tools?: string[]
}

export interface AiSession {
  id: string
  title: string
  docPath: string | null
  /** 本会话带入上下文的文档路径（会话级作用域） */
  contextPaths?: string[]
  /** 上下文 token 预算 */
  budget?: number
  messages: AiSessionMessage[]
  createdAt: number
  updatedAt: number
}

/** AI 提交的文档修改提案：确认后才落盘 */
export interface WriteProposal {
  id: string
  reqId: string
  path: string
  title: string
  before: string
  after: string
  /** 增 / 删行数，仅用于显示 */
  add: number
  del: number
  createdAt: number
}

export interface DocMeta {
  path: string
  name: string
  title: string
  mtime: number
  size: number
}

export interface Snippet {
  id: string
  title: string
  content: string
  pinned?: boolean
  createdAt: number
}

export interface ClipItem {
  id: string
  text: string
  time: number
}

export interface SearchResult {
  path: string
  title: string
  hits: { line: number; text: string }[]
}

export interface InitPayload {
  config: AppConfig
  docs: DocMeta[]
  snippets: Snippet[]
  clipboard: ClipItem[]
  hotkeyActive: string | null
  version: string
  platform: string
  systemDark: boolean
}

export type ViewKey = 'notes' | 'snippets' | 'clipboard'
export type EditorMode = 'split' | 'edit' | 'preview'
