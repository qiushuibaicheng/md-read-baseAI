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

  hide: () => ipcRenderer.invoke('window:hide'),
  pin: (on: boolean) => ipcRenderer.invoke('window:pin', on),
  quit: () => ipcRenderer.invoke('app:quit'),
  version: () => ipcRenderer.invoke('app:version'),
  openVault: () => ipcRenderer.invoke('app:openVault'),
  isPackaged: () => ipcRenderer.invoke('app:isPackaged'),

  onClipboardChanged: (cb: (list: any[]) => void) => on('clipboard:changed', cb),
  onVaultChanged: (cb: (docs: any[]) => void) => on('vault:changed', cb),
  onConfigChanged: (cb: (cfg: any) => void) => on('config:changed', cb),
  onWindowShown: (cb: () => void) => on('window:shown', cb),
  onOpenSettings: (cb: () => void) => on('ui:open-settings', cb),
  onThemeSystem: (cb: (dark: boolean) => void) => on('theme:system', cb),

  aiOnStream: (cb: (data: { reqId: string; text: string; reasoning: string }) => void) => on('ai:stream', cb),
  aiOnDone: (cb: (data: { reqId: string; text: string; reasoning: string; usage?: { prompt: number; completion: number } }) => void) =>
    on('ai:done', cb),
  aiOnError: (cb: (data: { reqId: string; message: string }) => void) => on('ai:error', cb),
  aiOnAborted: (cb: (data: { reqId: string }) => void) => on('ai:aborted', cb)
}

contextBridge.exposeInMainWorld('api', api)
contextBridge.exposeInMainWorld('pathForFile', (file: File) => webUtils.getPathForFile(file))

export type InkAPI = typeof api
