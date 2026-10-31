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
}

export interface ModelProfile {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
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
