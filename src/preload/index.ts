import { contextBridge, ipcRenderer, webUtils } from 'electron'

const on = (channel: string, cb: (...args: any[]) => void) => {
  const handler = (_e: unknown, ...args: any[]) => cb(...args)
  ipcRenderer.on(channel, handler as any)
  return () => ipcRenderer.off(channel, handler as any)
}

const api = {
  init: () => ipcRenderer.invoke('app:init'),
  setConfig: (patch: Record<string, unknown>) => ipcRenderer.invoke('config:set', patch),

  listDocs: () => ipcRenderer.invoke('vault:list'),
  listFolders: () => ipcRenderer.invoke('vault:folders'),
  makeFolder: (payload: { parent?: string; name: string }) => ipcRenderer.invoke('vault:mkdir', payload),
  revealFolder: (rel: string) => ipcRenderer.invoke('folder:reveal', rel),
  renameFolder: (rel: string, name: string) => ipcRenderer.invoke('folder:rename', rel, name),
  deleteFolder: (rel: string) => ipcRenderer.invoke('folder:delete', rel),
  moveDoc: (rel: string, targetDir: string) => ipcRenderer.invoke('doc:move', rel, targetDir),
  arrange: (payload: { kind: 'doc' | 'dir'; path: string; targetDir?: string; index?: number }) =>
    ipcRenderer.invoke('vault:arrange', payload),
  pickVault: () => ipcRenderer.invoke('vault:pick'),
  vaultPath: () => ipcRenderer.invoke('vault:path'),
  readDoc: (rel: string) => ipcRenderer.invoke('doc:read', rel),
  writeDoc: (rel: string, content: string) => ipcRenderer.invoke('doc:write', rel, content),
  createDoc: (payload: { dir?: string; title?: string }) => ipcRenderer.invoke('doc:create', payload),
  renameDoc: (rel: string, name: string) => ipcRenderer.invoke('doc:rename', rel, name),
  deleteDoc: (rel: string) => ipcRenderer.invoke('doc:delete', rel),
  importDoc: (abs: string) => ipcRenderer.invoke('doc:import', abs),
  revealDoc: (rel: string) => ipcRenderer.invoke('doc:reveal', rel),
  openDocExternal: (rel: string) => ipcRenderer.invoke('doc:openExternal', rel),

  search: (q: string) => ipcRenderer.invoke('search', q),

  linksOf: (rel: string) => ipcRenderer.invoke('links:of', rel),
  linksBroken: () => ipcRenderer.invoke('links:broken'),
  linksStats: () => ipcRenderer.invoke('links:stats'),
  linksGraph: (rel: string, depth = 1) => ipcRenderer.invoke('links:graph', rel, depth),
  linksResolve: (from: string, href: string) => ipcRenderer.invoke('links:resolve', from, href),
  linksReindex: () => ipcRenderer.invoke('links:index'),
  onLinksChanged: (cb: () => void) => on('links:changed', cb),
  onVaultRelinked: (
    cb: (info: { from: string; count: number; files: number; skipped: number; paths: string[] }) => void
  ) => on('vault:relinked', cb),
  saveSnippets: (list: unknown) => ipcRenderer.invoke('snippets:save', list),

  copyText: (text: string) => ipcRenderer.invoke('clipboard:write', text),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  clipboardHistory: () => ipcRenderer.invoke('clipboard:history'),
  clearClipboard: () => ipcRenderer.invoke('clipboard:clear'),
  removeClipboard: (id: string) => ipcRenderer.invoke('clipboard:remove', id),

  saveAsset: (name: string, dataUrl: string) => ipcRenderer.invoke('asset:save', { name, dataUrl }),
  exportHTML: (name: string, html: string) => ipcRenderer.invoke('export:html', { name, html }),
  openExternal: (url: string) => ipcRenderer.invoke('open:external', url),

  aiModels: () => ipcRenderer.invoke('ai:models'),
  aiSaveModel: (profile: unknown) => ipcRenderer.invoke('ai:model:save', profile),
  aiRemoveModel: (id: string) => ipcRenderer.invoke('ai:model:remove', id),
  aiTestModel: (profile: unknown) => ipcRenderer.invoke('ai:model:test', profile),
  aiChat: (payload: unknown) => ipcRenderer.invoke('ai:chat', payload),
  aiAbort: (reqId: string) => ipcRenderer.invoke('ai:abort', reqId),
  aiTitle: (payload: unknown) => ipcRenderer.invoke('ai:title', payload),
  aiSessions: () => ipcRenderer.invoke('ai:sessions'),
  aiSaveSessions: (list: unknown) => ipcRenderer.invoke('ai:sessions:save', list),
  aiApplyWrite: (id: string) => ipcRenderer.invoke('ai:write:apply', id),
  aiDiscardWrite: (id: string) => ipcRenderer.invoke('ai:write:discard', id),
  aiAnswer: (id: string, answer: string) => ipcRenderer.invoke('ai:ask:answer', { id, answer }),

  extSkills: () => ipcRenderer.invoke('ext:skills'),
  extSkillSave: (input: unknown) => ipcRenderer.invoke('ext:skill:save', input),
  extSkillRemove: (name: string) => ipcRenderer.invoke('ext:skill:remove', name),
  extSkillReveal: () => ipcRenderer.invoke('ext:skill:reveal'),
  extMcpConfig: () => ipcRenderer.invoke('ext:mcp:config'),
  extMcpSave: (cfg: unknown) => ipcRenderer.invoke('ext:mcp:save', cfg),
  extMcpStatus: (reload?: boolean) => ipcRenderer.invoke('ext:mcp:status', reload),
  extMcpTools: () => ipcRenderer.invoke('ext:mcp:tools'),
  extMcpFile: () => ipcRenderer.invoke('ext:mcp:file'),

  hide: () => ipcRenderer.invoke('window:hide'),
  pin: (on: boolean) => ipcRenderer.invoke('window:pin', on),
  toggleMaximize: () => ipcRenderer.invoke('window:maximize'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  quit: () => ipcRenderer.invoke('app:quit'),
  version: () => ipcRenderer.invoke('app:version'),
  openVault: () => ipcRenderer.invoke('app:openVault'),
  isPackaged: () => ipcRenderer.invoke('app:isPackaged'),

  onClipboardChanged: (cb: (list: any[]) => void) => on('clipboard:changed', cb),
  onSnippetsChanged: (cb: (list: any[]) => void) => on('snippets:changed', cb),
  onVaultChanged: (cb: (docs: any[]) => void) => on('vault:changed', cb),
  onConfigChanged: (cb: (cfg: any) => void) => on('config:changed', cb),
  onWindowShown: (cb: () => void) => on('window:shown', cb),
  onMaximized: (cb: (on: boolean) => void) => on('window:maximized', cb),
  onOpenSettings: (cb: () => void) => on('ui:open-settings', cb),
  onThemeSystem: (cb: (dark: boolean) => void) => on('theme:system', cb),

  aiOnStream: (cb: (data: { reqId: string; text: string; reasoning: string }) => void) => on('ai:stream', cb),
  aiOnDone: (cb: (data: { reqId: string; text: string; reasoning: string; usage?: { prompt: number; completion: number } }) => void) =>
    on('ai:done', cb),
  aiOnError: (cb: (data: { reqId: string; message: string }) => void) => on('ai:error', cb),
  aiOnAborted: (cb: (data: { reqId: string }) => void) => on('ai:aborted', cb),
  aiOnTool: (
    cb: (data: {
      reqId: string
      name: string
      args?: string
      status: 'running' | 'done' | 'unsupported'
      preview?: string
    }) => void
  ) => on('ai:tool', cb),
  aiOnWrite: (
    cb: (d: {
      id: string
      reqId: string
      path: string
      title: string
      before: string
      after: string
      add: number
      del: number
      createdAt: number
    }) => void
  ) => on('ai:write', cb),
  aiOnWriteDrop: (cb: (d: { id: string }) => void) => on('ai:write:drop', cb),
  aiOnDocCreated: (cb: (d: { path: string; title: string }) => void) => on('ai:doc-created', cb),
  aiOnPlan: (cb: (d: { reqId: string; steps: { id: string; text: string; status: string }[] }) => void) =>
    on('ai:plan', cb),
  aiOnAsk: (cb: (d: { reqId: string; id: string; question: string; options: { label: string; value: string }[]; multiple: boolean }) => void) =>
    on('ai:ask', cb),
  aiOnAskDrop: (cb: (d: { id: string }) => void) => on('ai:ask:drop', cb),
  aiOnCtx: (cb: (d: { reqId: string; folded?: number; saved?: number; summarized?: boolean }) => void) => on('ai:ctx', cb),
  aiOnRetry: (cb: (d: { reqId: string; attempt: number; max: number }) => void) => on('ai:retry', cb),
  aiOnMcp: (cb: (d: { reqId: string; tools: number }) => void) => on('ai:mcp', cb)
}

contextBridge.exposeInMainWorld('api', api)
contextBridge.exposeInMainWorld('pathForFile', (file: File) => webUtils.getPathForFile(file))

export type InkAPI = typeof api
