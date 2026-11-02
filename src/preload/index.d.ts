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
  provider?: string
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
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
  tools?: string[]
  plan?: PlanStep[]
}

export interface PlanStep {
  id: string
  text: string
  status: 'pending' | 'doing' | 'done'
}

export interface SkillDef {
  name: string
  description: string
  when: string
  body: string
  file: string
}

export interface McpStatus {
  name: string
  state: 'idle' | 'starting' | 'ready' | 'error' | 'disabled'
  tools: number
  error?: string
  command: string
  note?: string
}

export interface AiSession {
  id: string
  title: string
  docPath: string | null
  contextPaths?: string[]
  budget?: number
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
  tools?: boolean
  budget?: number
}

export interface WriteProposal {
  id: string
  reqId: string
  kind?: 'write' | 'delete'
  path: string
  title: string
  before: string
  after: string
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

export type LinkReason = 'ok' | 'broken' | 'ambiguous' | 'external' | 'self'

export interface LinkEdge {
  from: string
  raw: string
  text: string
  line: number
  anchor?: string
  target: { path: string | null; reason: LinkReason; candidates?: string[] }
  toSummary?: string
}

export interface InboundEdge {
  path: string
  title: string
  line: number
  text: string
  raw: string
  summary: string
}

export interface DocLinks {
  path: string
  title: string
  lines: number
  out: LinkEdge[]
  inbound: InboundEdge[]
  broken: LinkEdge[]
}

export interface BrokenLink {
  from: string
  fromTitle: string
  raw: string
  text: string
  line: number
}

export interface LinkStats {
  docs: number
  edges: number
  broken: number
  ambiguous: number
  ms: number
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
  listFolders(): Promise<string[]>
  makeFolder(payload: { parent?: string; name: string }): Promise<string>
  revealFolder(rel: string): Promise<void>
  renameFolder(rel: string, name: string): Promise<string>
  deleteFolder(rel: string): Promise<boolean>
  moveDoc(rel: string, targetDir: string): Promise<string>
  arrange(payload: {
    kind: 'doc' | 'dir'
    path: string
    targetDir?: string
    index?: number
  }): Promise<{ rel: string; order: Record<string, string[]>; docs: DocMeta[]; folders: string[] }>
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
  linksOf(rel: string): Promise<DocLinks | null>
  linksBroken(): Promise<BrokenLink[]>
  linksStats(): Promise<LinkStats>
  linksGraph(
    rel: string,
    depth?: number
  ): Promise<{ path: string; title: string; summary: string; hop: number; dir: 'out' | 'in' }[]>
  linksResolve(
    from: string,
    href: string
  ): Promise<{ path: string | null; anchor?: string; reason: LinkReason; candidates?: string[] }>
  linksReindex(): Promise<LinkStats>
  onLinksChanged(cb: () => void): () => void
  /** 移动/改名后自动改写了链接 */
  onVaultRelinked(
    cb: (info: {
      from: string
      count: number
      files: number
      skipped: number
      paths: string[]
      failed?: string
    }) => void
  ): () => void
  /** 移动/改名后路径变了：旧路径 → 新路径 */
  onVaultMoved(cb: (info: { moves: Record<string, string> }) => void): () => void
  historyInfo(reqId: string): Promise<{ count: number; labels: string[] }>
  historyUndo(reqId?: string): Promise<{
    ok: boolean
    count: number
    restored: number
    skipped: number
    label: string
    note?: string
  }>
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
  aiApplyWrite(id: string): Promise<{ ok: boolean; message?: string; path?: string; content?: string; before?: string; deleted?: boolean }>
  aiDiscardWrite(id: string): Promise<boolean>
  aiAnswer(id: string, answer: string): Promise<boolean>
  extSkills(): Promise<SkillDef[]>
  extSkillSave(input: { name: string; description?: string; when?: string; body: string }): Promise<SkillDef>
  extSkillRemove(name: string): Promise<boolean>
  extSkillReveal(): Promise<boolean>
  extMcpConfig(): Promise<{ mcpServers: Record<string, any> }>
  extMcpSave(cfg: { mcpServers: Record<string, any> }): Promise<McpStatus[]>
  extMcpStatus(reload?: boolean): Promise<McpStatus[]>
  extMcpTools(): Promise<{ server: string; name: string; description: string }[]>
  extMcpFile(): Promise<string>
  hide(): Promise<void>
  pin(on: boolean): Promise<boolean>
  toggleMaximize(): Promise<boolean>
  isMaximized(): Promise<boolean>
  quit(): Promise<void>
  version(): Promise<string>
  openVault(): Promise<void>
  isPackaged(): Promise<boolean>
  onClipboardChanged(cb: (list: ClipItem[]) => void): () => void
  onSnippetsChanged(cb: (list: Snippet[]) => void): () => void
  onVaultChanged(cb: (docs: DocMeta[]) => void): () => void
  onConfigChanged(cb: (cfg: AppConfig) => void): () => void
  onWindowShown(cb: () => void): () => void
  onMaximized(cb: (on: boolean) => void): () => void
  onOpenSettings(cb: () => void): () => void
  onThemeSystem(cb: (dark: boolean) => void): () => void
  aiOnStream(cb: (d: { reqId: string; text: string; reasoning: string }) => void): () => void
  aiOnDone(
    cb: (d: { reqId: string; text: string; reasoning: string; usage?: { prompt: number; completion: number }; plan?: PlanStep[] }) => void
  ): () => void
  aiOnError(cb: (d: { reqId: string; message: string }) => void): () => void
  aiOnAborted(cb: (d: { reqId: string }) => void): () => void
  aiOnTool(
    cb: (d: {
      reqId: string
      name: string
      args?: string
      status: 'running' | 'done' | 'error' | 'unsupported'
      preview?: string
      depth?: number
      sub?: string
    }) => void
  ): () => void
  aiOnWrite(cb: (d: WriteProposal) => void): () => void
  aiOnWriteDrop(cb: (d: { id: string }) => void): () => void
  aiOnDocCreated(cb: (d: { path: string; title: string }) => void): () => void
  aiOnPlan(cb: (d: { reqId: string; steps: PlanStep[] }) => void): () => void
  aiOnAsk(
    cb: (d: {
      reqId: string
      id: string
      question: string
      options: { label: string; value: string }[]
      multiple: boolean
    }) => void
  ): () => void
  aiOnAskDrop(cb: (d: { id: string }) => void): () => void
  aiOnCtx(cb: (d: { reqId: string; folded?: number; saved?: number; summarized?: boolean }) => void): () => void
  aiOnRetry(cb: (d: { reqId: string; attempt: number; max: number }) => void): () => void
  aiOnMcp(cb: (d: { reqId: string; tools: number }) => void): () => void
}

declare global {
  interface Window {
    api: InkAPI
    pathForFile: (file: File) => string
  }
}
