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
}

export interface AiSession {
  id: string
  title: string
  docPath: string | null
  messages: AiSessionMessage[]
  createdAt: number
  updatedAt: number
}

export interface AiChatRequest {
  reqId: string
  profileId: string
  system?: string
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  temperature?: number
  maxTokens?: number
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

export interface InkAPI {
  init(): Promise<InitPayload>
  setConfig(patch: Partial<AppConfig>): Promise<AppConfig>
  listDocs(): Promise<DocMeta[]>
  pickVault(): Promise<{ config: AppConfig; docs: DocMeta[] } | null>
  vaultPath(): Promise<string>
  readDoc(rel: string): Promise<{ content: string; mtime: number }>
  writeDoc(rel: string, content: string): Promise<boolean>
  createDoc(payload: { dir?: string; title?: string }): Promise<string>
  renameDoc(rel: string, name: string): Promise<string>
  deleteDoc(rel: string): Promise<boolean>
  importDoc(abs: string): Promise<string>
  revealDoc(rel: string): Promise<void>
  openDocExternal(rel: string): Promise<void>
  search(q: string): Promise<SearchResult[]>
  saveSnippets(list: Snippet[]): Promise<boolean>
  copyText(text: string): Promise<boolean>
  readClipboard(): Promise<string>
  clipboardHistory(): Promise<ClipItem[]>
  clearClipboard(): Promise<ClipItem[]>
  removeClipboard(id: string): Promise<ClipItem[]>
  saveAsset(name: string, dataUrl: string): Promise<string>
  exportHTML(name: string, html: string): Promise<string | null>
  openExternal(url: string): Promise<void>
  aiModels(): Promise<ModelProfile[]>
  aiSaveModel(profile: ModelProfile): Promise<ModelProfile[]>
  aiRemoveModel(id: string): Promise<ModelProfile[]>
  aiTestModel(profile: ModelProfile): Promise<{ ok: boolean; latency: number; message: string }>
  aiChat(payload: AiChatRequest): Promise<{ ok: boolean }>
  aiAbort(reqId: string): Promise<boolean>
  aiTitle(payload: { profileId: string; content: string }): Promise<string | null>
  aiSessions(): Promise<AiSession[]>
  aiSaveSessions(list: AiSession[]): Promise<boolean>
  hide(): Promise<void>
  pin(on: boolean): Promise<boolean>
  quit(): Promise<void>
  version(): Promise<string>
  openVault(): Promise<void>
  isPackaged(): Promise<boolean>
  onClipboardChanged(cb: (list: ClipItem[]) => void): () => void
  onVaultChanged(cb: (docs: DocMeta[]) => void): () => void
  onConfigChanged(cb: (cfg: AppConfig) => void): () => void
  onWindowShown(cb: () => void): () => void
  onOpenSettings(cb: () => void): () => void
  onThemeSystem(cb: (dark: boolean) => void): () => void
  aiOnStream(cb: (d: { reqId: string; text: string; reasoning: string }) => void): () => void
  aiOnDone(cb: (d: { reqId: string; text: string; reasoning: string; usage?: { prompt: number; completion: number } }) => void): () => void
  aiOnError(cb: (d: { reqId: string; message: string }) => void): () => void
  aiOnAborted(cb: (d: { reqId: string }) => void): () => void
}

declare global {
  interface Window {
    api: InkAPI
    pathForFile: (file: File) => string
  }
}
