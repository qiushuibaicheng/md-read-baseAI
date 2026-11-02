import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
  clipboard,
  dialog,
  shell,
  Tray,
  Menu,
  protocol,
  net,
  nativeImage,
  nativeTheme
} from 'electron'
import { join, resolve, relative, extname, basename, dirname } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, watch, FSWatcher } from 'fs'
import type { Dirent } from 'fs'
import * as fsp from 'fs/promises'
import { pathToFileURL } from 'url'
import { registerAi, shutdownAi } from './ai'
import { LinkIndex } from './links'
import type { InboundEdge } from './links'
import { applyRelink } from './relink'

// ---------------------------------------------------------------------------
// 基础路径
// ---------------------------------------------------------------------------
const isDev = !app.isPackaged
const RES_DIR = isDev ? join(__dirname, '../../resources') : join(process.resourcesPath, 'resources')
const USER_DIR = app.getPath('userData')
const CONFIG_FILE = join(USER_DIR, 'config.json')
const SNIPPET_FILE = join(USER_DIR, 'snippets.json')
const CLIP_FILE = join(USER_DIR, 'clipboard.json')

const DEFAULT_HOTKEY = 'Alt+M'

interface Config {
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
  /** 侧栏手动排序：目录相对路径 → 该目录下条目的相对路径顺序（文件夹与文档混排） */
  order: Record<string, string[]>
  /** 默认热键迁移标记，只跑一次，避免用户手动设回旧值后被反复改写 */
  hotkeyMigrated?: boolean
}

const defaultConfig = (): Config => ({
  vaultPath: join(app.getPath('documents'), 'Inkwell'),
  hotkey: DEFAULT_HOTKEY,
  hideOnBlur: true,
  alwaysOnTop: false,
  threeBg: true,
  clipboardWatch: true,
  theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
  editorMode: 'split',
  fontSize: 15,
  sidebarWidth: 248,
  lastDoc: null,
  openTabs: [],
  windowWidth: 1220,
  windowHeight: 800,
  autoLaunch: false,
  aiModelId: null,
  aiAutoTitle: false,
  aiPanelWidth: 396,
  accent: 'indigo',
  themeMode: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
  order: {}
})

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

let config: Config = { ...defaultConfig(), ...readJSON<Partial<Config>>(CONFIG_FILE, {}) }
// 旧版本的默认值是 Alt+Space（易与系统窗口菜单冲突），首次用新版本时把它挪到新默认值
if (!config.hotkeyMigrated) {
  if (config.hotkey === 'Alt+Space') config.hotkey = DEFAULT_HOTKEY
  config.hotkeyMigrated = true
  saveConfig()
}
ensureDir(USER_DIR)
ensureDir(config.vaultPath)

function saveConfig() {
  writeJSON(CONFIG_FILE, config)
}

/** 排版顺序这类改动发生在主进程，得主动推给界面，否则侧栏会拿旧顺序渲染 */
function notifyConfig() {
  win?.webContents.send('config:changed', config)
}

// ---------------------------------------------------------------------------
// 首次启动：欢迎文档
// ---------------------------------------------------------------------------
function seedVault() {
  const welcome = join(config.vaultPath, '欢迎使用 Inkwell.md')
  if (existsSync(welcome)) {
    // 默认热键改过，老文档里那句说明跟着改一下（只动完全匹配的那一行）
    try {
      const old = readFileSync(welcome, 'utf-8')
      if (old.includes('按下 `Alt + Space`（可在设置里修改）')) {
        writeFileSync(welcome, old.split('按下 `Alt + Space`（可在设置里修改）').join('按下 `Alt + M`（可在设置里修改）'), 'utf-8')
      }
    } catch {
      /* 改不了就算了，不影响启动 */
    }
    return
  }
  const content = `# 欢迎使用 Inkwell

> 一个为「问题定位」而生的 Markdown 工作台：**随时召出、随手记录、一键复制**。

## 快捷召出

按下 \`Alt + M\`（可在设置里修改），窗口立刻出现在光标所在屏幕。
失去焦点会自动收起，不打断你正在做的事。

## 你可以这样用

| 场景 | 做法 |
| --- | --- |
| 日志、报错堆栈先存一份 | 左侧新建文档，直接粘贴 |
| 常用命令/配置反复复制 | 存进「片段库」，点一下即复制 |
| 从别处复制的值忘了在哪 | 打开「剪贴板」面板翻历史 |
| 几百篇笔记要找一个词 | \`Ctrl + K\` 全文搜索 |

## 常用快捷键

- \`Ctrl + K\` — 全局搜索（文件名 + 全文）
- \`Ctrl + N\` — 新建文档
- \`Ctrl + S\` — 立即保存（平时会自动保存）
- \`Ctrl + E\` — 在编辑 / 分栏 / 预览之间切换
- \`Ctrl + B\` — 收起或展开侧边栏
- \`Ctrl + Shift + V\` — 把剪贴板内容存为片段
- \`Ctrl + \` \` — 打开片段库
- \`Esc\` — 收起窗口

## 代码块可以直接复制

\`\`\`bash
# 排查线上问题时常用的几行
kubectl get pods -n prod | grep -v Running
journalctl -u my-service --since "10 min ago" | tail -n 200
\`\`\`

## 待办可以直接勾选

- [x] 把工单里那段报错贴进来
- [ ] 给这个问题补一条根因结论
- [ ] 整理成周会可以复用的复盘

---

*这篇文档可以直接删掉。你的笔记都以纯 \`.md\` 文件存在本地目录里，随时可以用其他工具打开。*
`
  writeFileSync(welcome, content, 'utf-8')
}

// ---------------------------------------------------------------------------
// 文档 / 片段 / 剪贴板
// ---------------------------------------------------------------------------
interface DocMeta {
  path: string
  name: string
  title: string
  mtime: number
  size: number
}

const IGNORED = new Set(['node_modules', '.git', '.obsidian', '.trash', '.DS_Store', 'assets'])

/**
 * 全库索引。文档标题、大小、行数、链接图都在这里，
 * 目录扫描只做 stat，内容只在 mtime/size 变化时重读。
 */
const linkIndex = new LinkIndex()

async function scanVault(): Promise<DocMeta[]> {
  await linkIndex.sync()
  const list = await linkIndex.list()
  return list
    .map((d) => ({ path: d.path, name: d.name, title: d.title, mtime: d.mtime, size: d.size }))
    .sort((a, b) => b.mtime - a.mtime)
}

/** 扫描全部子目录（含空目录），返回相对路径，例如 ["排查", "排查/502"] */
async function scanFolders(root = config.vaultPath): Promise<string[]> {
  const out: string[] = []
  async function walk(current: string, depth: number) {
    if (depth > 6) return
    let entries: any[] = []
    try {
      entries = await fsp.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.') || IGNORED.has(entry.name)) continue
      const abs = join(current, entry.name)
      out.push(relative(root, abs).split('\\').join('/'))
      await walk(abs, depth + 1)
    }
  }
  await walk(root, 0)
  out.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  return out
}

/** 全库关键词检索，供 IPC 与 AI 工具共用 */
async function searchVault(query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return [] as { path: string; title: string; hits: { line: number; text: string }[] }[]
  const docs = await scanVault()
  const results: { path: string; title: string; hits: { line: number; text: string }[] }[] = []
  for (const doc of docs) {
    const nameHit = doc.title.toLowerCase().includes(q) || doc.name.toLowerCase().includes(q)
    let content = ''
    try {
      content = await fsp.readFile(safePath(doc.path), 'utf-8')
    } catch {
      continue
    }
    const lines = content.split(/\r?\n/)
    const hits: { line: number; text: string }[] = []
    for (let i = 0; i < lines.length && hits.length < 3; i++) {
      if (lines[i].toLowerCase().includes(q)) hits.push({ line: i + 1, text: lines[i].trim().slice(0, 160) })
    }
    if (hits.length || nameHit) results.push({ path: doc.path, title: doc.title, hits })
    if (results.length >= 40) break
  }
  return results
}

function safePath(rel: string) {
  const abs = resolve(config.vaultPath, rel)
  const root = resolve(config.vaultPath)
  if (!abs.toLowerCase().startsWith(root.toLowerCase())) throw new Error('非法路径')
  return abs
}

function uniqueName(dir: string, base: string) {
  let name = `${base}.md`
  let i = 2
  while (existsSync(join(dir, name))) {
    name = `${base} ${i}.md`
    i++
  }
  return name
}

// ---------------------------------------------------------------------------
// 侧栏顺序 / 移动
// ---------------------------------------------------------------------------
const relOf = (abs: string) => relative(config.vaultPath, abs).split('\\').join('/')
const dirRelOf = (rel: string) => {
  const cut = rel.lastIndexOf('/')
  return cut >= 0 ? rel.slice(0, cut) : ''
}

/**
 * 某个目录下的条目（子文件夹 + markdown），按 config.order 里登记的先后排；
 * 没登记过的排在后面，按「文件夹优先、再按名称」补位。
 */
async function listDirEntries(relDir: string): Promise<string[]> {
  const abs = relDir ? safePath(relDir) : config.vaultPath
  let entries: Dirent[] = []
  try {
    entries = await fsp.readdir(abs, { withFileTypes: true })
  } catch {
    return []
  }
  const dirSet = new Set<string>()
  const all: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || IGNORED.has(entry.name)) continue
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      dirSet.add(rel)
      all.push(rel)
    } else if (/\.(md|markdown|mdx|txt)$/i.test(entry.name)) {
      all.push(rel)
    }
  }
  const pref = config.order?.[relDir] || []
  const rank = (p: string) => {
    const i = pref.indexOf(p)
    return i < 0 ? Number.MAX_SAFE_INTEGER : i
  }
  all.sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    const da = dirSet.has(a) ? 0 : 1
    const db = dirSet.has(b) ? 0 : 1
    if (da !== db) return da - db
    return a.localeCompare(b, 'zh-Hans-CN')
  })
  return all
}

/** 文件夹整体改名/移动后，把 order 里的键与值一起改写 */
function remapOrder(from: string, to: string) {
  const map = (p: string) => (p === from || p.startsWith(`${from}/`) ? to + p.slice(from.length) : p)
  const next: Record<string, string[]> = {}
  Object.entries(config.order || {}).forEach(([k, v]) => {
    next[map(k)] = v.map(map)
  })
  config.order = next
}

/** 改写 config 里记录的标签与上次文档路径 */
function remapOpenPaths(from: string, to: string) {
  const map = (p: string) => (p === from || p.startsWith(`${from}/`) ? to + p.slice(from.length) : p)
  config.openTabs = (config.openTabs || []).map(map)
  if (config.lastDoc) config.lastDoc = map(config.lastDoc)
}

/** 新建的条目排到所在目录最前面，符合「刚建完就看得到」的直觉 */
function unshiftOrder(relDir: string, rel: string) {
  const order = { ...(config.order || {}) }
  order[relDir] = [rel, ...(order[relDir] || []).filter((p) => p !== rel)]
  config.order = order
  saveConfig()
  notifyConfig()
}

/** 删除条目后，把它从排序表里摘掉，避免排序表无限膨胀 */
function dropFromOrder(rel: string) {
  const dir = dirRelOf(rel)
  const order = { ...(config.order || {}) }
  if (order[dir]) order[dir] = order[dir].filter((p) => p !== rel)
  Object.keys(order).forEach((k) => {
    if (k === rel || k.startsWith(`${rel}/`)) delete order[k]
  })
  config.order = order
  saveConfig()
  notifyConfig()
}

/**
 * 移动/改名之后改写指向它的链接，并告诉界面改了多少处。
 *
 * snapshot 必须是移动前取的：移动一完成，旧路径就解析不到了，那些边会退化成断链，
 * 再想回头查「谁引用过它」就没有依据了。
 *
 * 改写失败不让移动本身失败——文件已经挪好了，链接问题可以在设置页的失效清单里看到。
 */
async function relinkAfterMove(
  snapshot: Map<string, InboundEdge[]>,
  moves: Map<string, string>,
  from: string
): Promise<void> {
  if (!moves.size) return
  try {
    const out = await applyRelink(config.vaultPath, snapshot, moves)
    if (out.applied.length) {
      win?.webContents.send('vault:relinked', {
        from,
        count: out.applied.length,
        files: out.files,
        skipped: out.skipped.length,
        paths: [...new Set(out.applied.map((c) => c.path))]
      })
    }
  } catch (err) {
    // 文件已经挪好了，改写失败不能让移动回滚；但必须让用户知道，
    // 否则他看到的只是一堆「莫名其妙」的断链。界面据此提示去检查失效清单。
    console.warn('[inkwell] 改写引用失败:', err)
    win?.webContents.send('vault:relinked', {
      from,
      count: 0,
      files: 0,
      skipped: 0,
      paths: [],
      failed: err instanceof Error ? err.message : String(err)
    })
  }
}

async function moveDocTo(rel: string, targetDir: string): Promise<string> {
  const abs = safePath(rel)
  const destDir = targetDir ? safePath(targetDir) : config.vaultPath
  ensureDir(destDir)
  const dest = join(destDir, basename(abs))
  if (resolve(dest) === resolve(abs)) return rel
  if (existsSync(dest)) throw new Error('目标文件夹里已有同名文件')
  const snapshot = await linkIndex.snapshotInbound()
  await fsp.rename(abs, dest)
  const next = relOf(dest)
  await relinkAfterMove(snapshot, new Map([[rel, next]]), rel)
  linkIndex.invalidate()
  return next
}

async function moveFolderTo(rel: string, targetDir: string): Promise<string> {
  const abs = safePath(rel)
  const name = basename(abs)
  if (targetDir === rel || targetDir.startsWith(`${rel}/`)) throw new Error('不能把文件夹移动到它自己里面')
  const destDir = targetDir ? safePath(targetDir) : config.vaultPath
  const dest = join(destDir, name)
  if (resolve(dest) === resolve(abs)) return rel
  if (existsSync(dest)) throw new Error(`目标位置已有同名文件夹「${name}」`)
  // 快照与内部文档清单都得在被挪走之前拿：挪完旧路径就查不到了
  const snapshot = await linkIndex.snapshotInbound()
  const inner = (await linkIndex.list())
    .map((d) => d.path)
    .filter((p) => p.startsWith(`${rel}/`))
  await fsp.rename(abs, dest)
  const next = relOf(dest)
  const moves = new Map<string, string>()
  for (const p of inner) moves.set(p, next + p.slice(rel.length))
  await relinkAfterMove(snapshot, moves, rel)
  linkIndex.invalidate()
  remapOpenPaths(rel, next)
  remapOrder(rel, next)
  notifyConfig()
  return next
}

/** 拖拽落位：必要时先移动，再把条目插到目标目录的第 index 位 */
async function arrangeEntry(kind: 'doc' | 'dir', rel: string, targetDir: string, index: number) {
  const fromDir = dirRelOf(rel)
  const next = fromDir === targetDir ? rel : kind === 'doc' ? await moveDocTo(rel, targetDir) : await moveFolderTo(rel, targetDir)
  const list = (await listDirEntries(targetDir)).filter((p) => p !== next)
  const at = Math.max(0, Math.min(Math.trunc(index) || 0, list.length))
  list.splice(at, 0, next)
  const order = { ...(config.order || {}) }
  order[targetDir] = list
  if (fromDir !== targetDir) order[fromDir] = await listDirEntries(fromDir)
  config.order = order
  saveConfig()
  return next
}

/** Markdown 标题树（跳过代码围栏里的 #） */
function outlineOf(text: string): { level: number; text: string; line: number }[] {
  const out: { level: number; text: string; line: number }[] = []
  let fence = false
  text.split('\n').forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (fence) return
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (m) out.push({ level: m[1].length, text: m[2], line: i + 1 })
  })
  return out
}

/**
 * AI 用的移动/改名：文档和文件夹共用一条路。
 * 与拖拽的区别是它可能同时改名，所以路径改写要一次做完（order 键、标签、上次文档）。
 */
async function moveEntryAny(from: string, toDir: string, newName?: string): Promise<string> {
  const abs = safePath(from)
  if (!existsSync(abs)) throw new Error(`找不到 ${from}`)
  const stat = await fsp.stat(abs)
  const isDir = stat.isDirectory()
  const cleanDir = (toDir || '').trim().replace(/^\.?\//, '').replace(/\/+$/, '')
  if (isDir && (cleanDir === from || cleanDir.startsWith(`${from}/`))) {
    throw new Error('不能把文件夹移动到它自己或它的子目录里')
  }
  const destDirAbs = cleanDir ? safePath(cleanDir) : config.vaultPath
  ensureDir(destDirAbs)

  let name = (newName || '').replace(/[\\/:*?"<>|]/g, '').trim()
  if (!name) name = basename(abs)
  if (!isDir && !/\.md$/i.test(name)) name += '.md'
  const dest = join(destDirAbs, name)
  if (resolve(dest) === resolve(abs)) return from
  if (existsSync(dest)) throw new Error(`目标位置已有同名${isDir ? '文件夹' : '文档'}「${name}」`)

  // 移动会改变相对链接的基准，而 AI 的 move_entry 也走这里：
  // 入链快照必须在 rename 之前取，挪完旧路径就解析不到，边会退化成断链。
  const snapshot = await linkIndex.snapshotInbound()
  const innerDocs = isDir
    ? (await linkIndex.list())
        .map((d) => d.path)
        .filter((p) => p.startsWith(`${from}/`))
    : []

  await fsp.rename(abs, dest)
  const next = relOf(dest)

  // 文件夹里的每篇文档路径都变了，逐条重算指向它们的链接
  const moved = new Map<string, string>([[from, next]])
  for (const p of innerDocs) moved.set(p, next + p.slice(from.length))
  await relinkAfterMove(snapshot, moved, from)

  const fromDir = dirRelOf(from)

  remapOrder(from, next)
  remapOpenPaths(from, next)
  // 原地改名时 remapOrder 已把条目换成新路径且位置不变；跨目录才需要重排两份列表
  if (fromDir !== cleanDir) {
    const order = { ...(config.order || {}) }
    order[fromDir] = (await listDirEntries(fromDir)).filter((p) => p !== from && p !== next)
    order[cleanDir] = [next, ...(await listDirEntries(cleanDir)).filter((p) => p !== next)]
    config.order = order
  }
  saveConfig()
  notifyConfig()
  // 移动/改名会改变相对链接的基准，整个图都得重算
  linkIndex.invalidate()
  win?.webContents.send('vault:changed', await scanVault())
  return next
}

// ---------------------------------------------------------------------------
// 剪贴板历史
// ---------------------------------------------------------------------------
interface ClipItem {
  id: string
  text: string
  time: number
}
let clipHistory: ClipItem[] = readJSON<ClipItem[]>(CLIP_FILE, [])
let lastClipText = ''

function pushClip(text: string) {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 30000) return
  const existing = clipHistory.find((c) => c.text === trimmed)
  if (existing) {
    existing.time = Date.now()
    clipHistory = [existing, ...clipHistory.filter((c) => c !== existing)]
  } else {
    clipHistory = [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text: trimmed, time: Date.now() }, ...clipHistory]
  }
  clipHistory = clipHistory.slice(0, 80)
  writeJSON(CLIP_FILE, clipHistory)
}

let clipTimer: NodeJS.Timeout | null = null
function startClipWatch() {
  if (clipTimer) return
  lastClipText = clipboard.readText() || ''
  clipTimer = setInterval(() => {
    if (!config.clipboardWatch) return
    const text = clipboard.readText()
    if (!text || text === lastClipText) return
    lastClipText = text
    pushClip(text)
    win?.webContents.send('clipboard:changed', clipHistory)
  }, 800)
}

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------
let win: BrowserWindow | null = null
let tray: Tray | null = null
let suppressBlurHide = false
let isQuitting = false

function toggleWindow() {
  if (!win) return
  if (win.isVisible() && win.isFocused()) {
    win.hide()
    return
  }
  showWindow()
}

function showWindow() {
  if (!win) return
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { x, y, width, height } = display.workArea
  const [w, h] = win.getSize()
  const nx = Math.round(x + (width - w) / 2)
  const ny = Math.round(y + Math.max(24, (height - h) * 0.32))
  win.setPosition(nx, ny)
  win.show()
  win.focus()
  win.webContents.send('window:shown')
}

function createWindow() {
  win = new BrowserWindow({
    width: config.windowWidth,
    height: config.windowHeight,
    minWidth: 760,
    minHeight: 480,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#0c0e14',
    hasShadow: true,
    resizable: true,
    maximizable: true,
    fullscreenable: false,
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: false,
    icon: join(RES_DIR, 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      webviewTag: false
    }
  })

  win.setMenuBarVisibility(false)

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) showWindow()
  })

  win.on('blur', () => {
    if (!config.hideOnBlur || suppressBlurHide || isQuitting) return
    if (win?.webContents.isDevToolsOpened()) return
    win?.hide()
  })

  win.on('resize', () => {
    if (!win) return
    // 最大化/还原过程中也会触发，别把屏宽写进配置
    if (win.isMaximized()) return
    const [w, h] = win.getSize()
    config.windowWidth = w
    config.windowHeight = h
    saveConfig()
  })

  win.on('maximize', () => win?.webContents.send('window:maximized', true))
  win.on('unmaximize', () => win?.webContents.send('window:maximized', false))

  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      win?.hide()
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (e, url) => {
    const current = win?.webContents.getURL() || ''
    if (!url.startsWith(current.split('#')[0].split('?')[0])) {
      e.preventDefault()
      if (/^https?:/i.test(url)) shell.openExternal(url)
    }
  })
}

function createTray() {
  const iconPath = join(RES_DIR, 'tray.png')
  const image = nativeImage.createFromPath(iconPath)
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 }))
  tray.setToolTip(`Inkwell · ${config.hotkey} 召出`)
  const rebuild = () => {
    const menu = Menu.buildFromTemplate([
      { label: '显示 Inkwell', click: () => showWindow() },
      { type: 'separator' },
      {
        label: '窗口置顶',
        type: 'checkbox',
        checked: config.alwaysOnTop,
        click: (item) => {
          config.alwaysOnTop = item.checked
          saveConfig()
          win?.setAlwaysOnTop(config.alwaysOnTop, 'floating')
          win?.webContents.send('config:changed', config)
        }
      },
      {
        label: '失焦自动收起',
        type: 'checkbox',
        checked: config.hideOnBlur,
        click: (item) => {
          config.hideOnBlur = item.checked
          saveConfig()
          win?.webContents.send('config:changed', config)
        }
      },
      { type: 'separator' },
      { label: '打开笔记目录', click: () => shell.openPath(config.vaultPath) },
      { label: '设置', click: () => { showWindow(); win?.webContents.send('ui:open-settings') } },
      { type: 'separator' },
      { label: '退出', click: () => { isQuitting = true; app.quit() } }
    ])
    tray?.setContextMenu(menu)
  }
  rebuild()
  tray.on('click', () => toggleWindow())
  tray.on('right-click', () => rebuild())
}

function registerHotkey(accel: string): string | null {
  globalShortcut.unregisterAll()
  const tryRegister = (a: string) => {
    try {
      return globalShortcut.register(a, toggleWindow)
    } catch {
      return false
    }
  }
  if (tryRegister(accel)) return accel
  // Alt+M 被占用时依次退让到更少冲突的组合
  for (const fallback of ['Ctrl+Alt+M', 'Ctrl+Shift+M', 'Alt+Space']) {
    if (fallback !== accel && tryRegister(fallback)) return fallback
  }
  return null
}

// ---------------------------------------------------------------------------
// 协议：本地图片
// ---------------------------------------------------------------------------
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ink-asset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false }
  }
])

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function setupIPC() {
  ipcMain.handle('app:init', async () => {
    const hotkeyActive = registerHotkey(config.hotkey)
    if (hotkeyActive && hotkeyActive !== config.hotkey) {
      config.hotkey = hotkeyActive
      saveConfig()
    }
    return {
      config,
      docs: await scanVault(),
      snippets: readJSON(SNIPPET_FILE, []),
      clipboard: clipHistory,
      hotkeyActive,
      version: app.getVersion(),
      platform: process.platform,
      systemDark: nativeTheme.shouldUseDarkColors
    }
  })

  ipcMain.handle('config:set', (_e, patch: Partial<Config>) => {
    // 库路径只能走 vault:pick：换库要重建索引、换监听目标、清空打开状态，
    // 走这里改会留下一个指向旧目录的索引。
    if (patch && 'vaultPath' in patch) delete (patch as Record<string, unknown>).vaultPath
    const prevHotkey = config.hotkey
    config = { ...config, ...patch }
    saveConfig()
    if (patch.hotkey && patch.hotkey !== prevHotkey) {
      const active = registerHotkey(patch.hotkey)
      config.hotkey = active || prevHotkey
      if (!active) registerHotkey(prevHotkey)
      tray?.setToolTip(`Inkwell · ${config.hotkey} 召出`)
      saveConfig()
    }
    if (patch.alwaysOnTop !== undefined) win?.setAlwaysOnTop(config.alwaysOnTop, 'floating')
    if (patch.autoLaunch !== undefined && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: config.autoLaunch, path: process.execPath, args: ['--hidden'] })
    }
    win?.webContents.send('config:changed', config)
    return config
  })

  ipcMain.handle('vault:list', () => scanVault())

  ipcMain.handle('vault:folders', () => scanFolders())

  ipcMain.handle('vault:mkdir', async (_e, payload: { parent?: string; name: string }) => {
    const raw = (payload?.name || '').replace(/[\\/:*?"<>|]/g, '').trim()
    if (!raw) throw new Error('文件夹名不能为空')
    const parentAbs = payload?.parent ? safePath(payload.parent) : config.vaultPath
    const abs = join(parentAbs, raw)
    if (existsSync(abs)) throw new Error(`「${raw}」已存在`)
    await fsp.mkdir(abs, { recursive: true })
    const rel = relative(config.vaultPath, abs).split('\\').join('/')
    unshiftOrder(payload?.parent || '', rel)
    return rel
  })

  ipcMain.handle('doc:move', async (_e, rel: string, targetDir: string) => moveDocTo(rel, targetDir))

  // 拖拽落位：同一句里完成「跨目录移动 + 手动排序」
  ipcMain.handle(
    'vault:arrange',
    async (_e, payload: { kind: 'doc' | 'dir'; path: string; targetDir?: string; index?: number }) => {
      const rel = await arrangeEntry(payload.kind, payload.path, payload.targetDir || '', Number(payload.index) || 0)
      config.openTabs = config.openTabs || []
      saveConfig()
      return {
        rel,
        order: config.order,
        docs: await scanVault(),
        folders: await scanFolders()
      }
    }
  )

  ipcMain.handle('vault:pick', async () => {
    if (!win) return null
    suppressBlurHide = true
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: '选择笔记目录' })
    suppressBlurHide = false
    if (res.canceled || !res.filePaths[0]) return null
    config.vaultPath = res.filePaths[0]
    config.lastDoc = null
    config.openTabs = []
    config.order = {}
    ensureDir(config.vaultPath)
    seedVault()
    saveConfig()
    linkIndex.setRoot(config.vaultPath)
    startVaultWatch()
    return { config, docs: await scanVault() }
  })

  ipcMain.handle('doc:read', async (_e, rel: string) => {
    const abs = safePath(rel)
    const content = await fsp.readFile(abs, 'utf-8')
    return { content, mtime: (await fsp.stat(abs)).mtimeMs }
  })

  ipcMain.handle('doc:write', async (_e, rel: string, content: string) => {
    const abs = safePath(rel)
    await fsp.mkdir(dirname(abs), { recursive: true })
    await fsp.writeFile(abs, content, 'utf-8')
    // 不等目录监听的 600ms 防抖：保存完立刻问 AI「这篇引用了谁」时，
    // 拿到的应该是刚写下的链接图，而不是上一版。
    linkIndex.invalidate(rel)
    return true
  })

  ipcMain.handle('doc:create', async (_e, payload: { dir?: string; title?: string } = {}) => {
    const dirAbs = payload.dir ? safePath(payload.dir) : config.vaultPath
    ensureDir(dirAbs)
    const stamp = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const base = payload.title?.trim() || `未命名 ${stamp.getMonth() + 1}-${pad(stamp.getDate())} ${pad(stamp.getHours())}${pad(stamp.getMinutes())}`
    const name = uniqueName(dirAbs, base)
    const abs = join(dirAbs, name)
    await fsp.writeFile(abs, `# ${payload.title?.trim() || '未命名文档'}\n\n`, 'utf-8')
    const rel = relative(config.vaultPath, abs).split('\\').join('/')
    unshiftOrder(payload.dir || '', rel)
    linkIndex.invalidate(rel)
    return rel
  })

  ipcMain.handle('doc:rename', async (_e, rel: string, nextName: string) => {
    const abs = safePath(rel)
    const clean = nextName.replace(/[\\/:*?"<>|]/g, '').trim() || '未命名'
    const nextAbs = join(dirname(abs), clean.endsWith('.md') ? clean : `${clean}.md`)
    const snapshot = await linkIndex.snapshotInbound()
    await fsp.rename(abs, nextAbs)
    const next = relative(config.vaultPath, nextAbs).split('\\').join('/')
    await relinkAfterMove(snapshot, new Map([[rel, next]]), rel)
    linkIndex.invalidate()
    remapOrder(rel, next)
    remapOpenPaths(rel, next)
    saveConfig()
    notifyConfig()
    return next
  })

  ipcMain.handle('doc:delete', async (_e, rel: string) => {
    const abs = safePath(rel)
    await shell.trashItem(abs)
    dropFromOrder(rel)
    linkIndex.invalidate(rel)
    win?.webContents.send('links:changed')
    return true
  })

  ipcMain.handle('doc:import', async (_e, absPath: string) => {
    const base = basename(absPath).replace(/\.(md|markdown|mdx|txt)$/i, '')
    const name = uniqueName(config.vaultPath, base)
    const dest = join(config.vaultPath, name)
    await fsp.copyFile(absPath, dest)
    const rel = relative(config.vaultPath, dest).split('\\').join('/')
    linkIndex.invalidate(rel)
    return rel
  })

  ipcMain.handle('doc:reveal', async (_e, rel: string) => {
    shell.showItemInFolder(safePath(rel))
  })

  // 打开某个文件夹本身（空字符串 = 笔记库根目录）
  ipcMain.handle('folder:reveal', async (_e, rel: string) => {
    const abs = rel ? safePath(rel) : config.vaultPath
    if (!existsSync(abs)) throw new Error('文件夹不存在')
    const err = await shell.openPath(abs)
    if (err) throw new Error(err)
  })

  // 侧栏右键：新建/重命名/删除文件夹
  ipcMain.handle('folder:rename', async (_e, rel: string, nextName: string) => {
    const from = rel.replace(/^\.?\//, '').replace(/\/+$/, '')
    const abs = safePath(from)
    const clean = (nextName || '').replace(/[\\/:*?"<>|]/g, '').trim()
    if (!clean) throw new Error('文件夹名不能为空')
    const dest = join(dirname(abs), clean)
    if (resolve(dest) === resolve(abs)) return from
    if (existsSync(dest)) throw new Error(`「${clean}」已存在`)
    // 改名会改变所有内部文档的路径基准：外部指进来的链接必须跟着改写，
    // 否则一改名就静默断链（内部互链的相对关系不变，所以从界面看不出来）。
    const snapshot = await linkIndex.snapshotInbound()
    const inner = (await linkIndex.list())
      .map((d) => d.path)
      .filter((p) => p.startsWith(`${from}/`))
    await fsp.rename(abs, dest)
    const next = relOf(dest)
    const moves = new Map<string, string>()
    for (const p of inner) moves.set(p, next + p.slice(from.length))
    await relinkAfterMove(snapshot, moves, from)
    linkIndex.invalidate()
    remapOpenPaths(from, next)
    remapOrder(from, next)
    saveConfig()
    notifyConfig()
    win?.webContents.send('vault:changed', await scanVault())
    return next
  })

  ipcMain.handle('folder:delete', async (_e, rel: string) => {
    const abs = safePath(rel)
    const inside = await fsp.readdir(abs).catch(() => ['x'])
    if (inside.length > 0) throw new Error('文件夹不是空的，先把文档移出去')
    await shell.trashItem(abs)
    dropFromOrder(rel)
    return true
  })

  ipcMain.handle('doc:openExternal', async (_e, rel: string) => {
    await shell.openPath(safePath(rel))
  })

  ipcMain.handle('search', (_e, query: string) => searchVault(query))

  ipcMain.handle('snippets:save', (_e, list: unknown) => {
    writeJSON(SNIPPET_FILE, list)
    return true
  })

  ipcMain.handle('clipboard:write', (_e, text: string) => {
    clipboard.writeText(text)
    lastClipText = text
    pushClip(text)
    win?.webContents.send('clipboard:changed', clipHistory)
    return true
  })

  ipcMain.handle('clipboard:read', () => clipboard.readText())

  ipcMain.handle('clipboard:clear', () => {
    clipHistory = []
    writeJSON(CLIP_FILE, clipHistory)
    return clipHistory
  })

  ipcMain.handle('clipboard:remove', (_e, id: string) => {
    clipHistory = clipHistory.filter((c) => c.id !== id)
    writeJSON(CLIP_FILE, clipHistory)
    return clipHistory
  })

  ipcMain.handle('clipboard:history', () => clipHistory)

  ipcMain.handle('asset:save', async (_e, payload: { name: string; dataUrl: string }) => {
    const match = payload.dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.*)$/)
    if (!match) throw new Error('不支持的图片格式')
    const ext = match[1].split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg')
    const dir = join(config.vaultPath, 'assets')
    ensureDir(dir)
    const file = `paste-${Date.now()}.${ext}`
    await fsp.writeFile(join(dir, file), Buffer.from(match[2], 'base64'))
    return `assets/${file}`
  })

  ipcMain.handle('export:html', async (_e, payload: { name: string; html: string }) => {
    if (!win) return null
    suppressBlurHide = true
    const res = await dialog.showSaveDialog(win, {
      title: '导出 HTML',
      defaultPath: join(app.getPath('downloads'), payload.name.replace(/\.md$/i, '') + '.html'),
      filters: [{ name: 'HTML', extensions: ['html'] }]
    })
    suppressBlurHide = false
    if (res.canceled || !res.filePath) return null
    let html = payload.html
    // 把本地图片内联成 base64，导出的单文件才能独立打开
    const refs = [...html.matchAll(/ink-asset:\/\/local\/\?p=([^"'\s)]+)/g)]
    for (const ref of refs) {
      try {
        const file = decodeURIComponent(ref[1])
        const buf = await fsp.readFile(file)
        const ext = extname(file).slice(1).toLowerCase()
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext || 'png'
        html = html.split(ref[0]).join(`data:image/${mime};base64,${buf.toString('base64')}`)
      } catch {
        /* 图片缺失时跳过 */
      }
    }
    await fsp.writeFile(res.filePath, html, 'utf-8')
    return res.filePath
  })

  ipcMain.handle('open:external', (_e, url: string) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
  })

  ipcMain.handle('window:hide', () => win?.hide())
  ipcMain.handle('window:maximize', () => {
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  ipcMain.handle('window:isMaximized', () => win?.isMaximized() ?? false)
  ipcMain.handle('window:pin', (_e, on: boolean) => {
    config.alwaysOnTop = on
    saveConfig()
    win?.setAlwaysOnTop(on, 'floating')
    return on
  })
  ipcMain.handle('app:quit', () => {
    isQuitting = true
    app.quit()
  })
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:openVault', () => shell.openPath(config.vaultPath))
  ipcMain.handle('app:isPackaged', () => app.isPackaged)
  ipcMain.handle('vault:path', () => config.vaultPath)

  // ---------------------------------------------------------------- 链接图
  ipcMain.handle('links:of', async (_e, rel: string) => linkIndex.doc(rel))
  ipcMain.handle('links:broken', async () => linkIndex.broken())
  ipcMain.handle('links:stats', async () => linkIndex.statsNow())
  ipcMain.handle('links:graph', async (_e, rel: string, depth = 1) => linkIndex.neighborhood(rel, depth))
  ipcMain.handle('links:resolve', async (_e, from: string, href: string) =>
    linkIndex.resolveHref(from, href)
  )
  ipcMain.handle('links:index', async () => {
    await linkIndex.sync(true)
    return linkIndex.statsNow()
  })
}

// ---------------------------------------------------------------------------
// 目录监听
// ---------------------------------------------------------------------------
let watcher: FSWatcher | null = null
let watchTimer: NodeJS.Timeout | null = null
/** 防抖窗口内攒下的待失效路径；空串表示「有事件但拿不到文件名」 */
let pendingPaths = new Set<string>()

function startVaultWatch() {
  watcher?.close()
  pendingPaths = new Set()
  try {
    watcher = watch(config.vaultPath, { recursive: true }, (_event, name) => {
      // 拿到文件名才能做「单篇失效」：全库标脏会走 mtime/size 增量判断，
      // 而同步盘、FAT 的 2 秒粒度、解压还原都可能让时间戳和大小都不变，
      // 那种情况下内容变了索引却读不到。带路径失效会直接把这个条目踢出缓存。
      pendingPaths.add(name ? String(name).split('\\').join('/').replace(/^\.?\//, '') : '')
      if (watchTimer) clearTimeout(watchTimer)
      watchTimer = setTimeout(async () => {
        const paths = [...pendingPaths]
        pendingPaths.clear()
        if (!paths.length || paths.includes('')) linkIndex.invalidate()
        else for (const p of paths) linkIndex.invalidate(p)
        if (!win) return
        win.webContents.send('vault:changed', await scanVault())
        win.webContents.send('links:changed')
      }, 600)
    })
    watcher.on('error', (err) => {
      console.warn('[inkwell] 目录监听出错，索引改由查询时的 TTL 轮询兜底:', err)
    })
  } catch (err) {
    // 某些文件系统不支持 recursive watch。索引仍会靠 sync() 的 TTL 轮询自愈，
    // 只是精度退化成「下次查询时全量重扫」。
    console.warn('[inkwell] 无法监听目录，索引改由查询时的 TTL 轮询兜底:', err)
  }
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())

  app.whenReady().then(async () => {
    seedVault()
    linkIndex.setRoot(config.vaultPath)
    // 后台先把索引建起来，别等第一次对话才付这份时间
    linkIndex.sync(true).catch(() => undefined)
    protocol.handle('ink-asset', (request) => {
      const url = new URL(request.url)
      const target = url.searchParams.get('p')
      if (!target) return new Response('not found', { status: 404 })
      try {
        return net.fetch(pathToFileURL(target).toString())
      } catch {
        return new Response('not found', { status: 404 })
      }
    })

    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ label: 'Edit', submenu: [{ role: 'copy' }, { role: 'paste' }, { role: 'cut' }, { role: 'selectAll' }, { role: 'undo' }, { role: 'redo' }] }])
    )

    setupIPC()
    registerAi(USER_DIR, () => win, () => ({
      list: async () => (await scanVault()).map((d) => ({ path: d.path, title: d.title, size: d.size })),
      read: (rel: string) => fsp.readFile(safePath(rel), 'utf-8'),
      search: (q: string) => searchVault(q),
      // 仅用于用户已确认的 AI 提案
      write: async (rel: string, content: string) => {
        const abs = safePath(rel)
        await fsp.mkdir(dirname(abs), { recursive: true })
        await fsp.writeFile(abs, content, 'utf-8')
        linkIndex.invalidate(rel)
      },
      create: async (title: string, content: string, dir?: string) => {
        const dirAbs = dir ? safePath(dir) : config.vaultPath
        ensureDir(dirAbs)
        const clean = title.replace(/[\\/:*?"<>|]/g, '').trim() || '未命名'
        const name = uniqueName(dirAbs, clean)
        const abs = join(dirAbs, name)
        await fsp.writeFile(abs, content.endsWith('\n') ? content : `${content}\n`, 'utf-8')
        const rel = relative(config.vaultPath, abs).split('\\').join('/')
        unshiftOrder(dir || '', rel)
        linkIndex.invalidate()
        win?.webContents.send('vault:changed', await scanVault())
        return rel
      },
      folders: () => scanFolders(),
      createFolder: async (rel: string) => {
        const clean = rel.replace(/^\.?\//, '').replace(/\/+$/, '')
        if (!clean) throw new Error('文件夹名不能为空')
        const abs = safePath(clean)
        if (existsSync(abs)) throw new Error(`「${clean}」已存在`)
        ensureDir(abs)
        // 逐级登记排序，避免新建的嵌套目录在父级里找不到
        const parts = clean.split('/')
        for (let i = 1; i <= parts.length; i++) {
          const sub = parts.slice(0, i).join('/')
          unshiftOrder(parts.slice(0, i - 1).join('/'), sub)
        }
        win?.webContents.send('vault:changed', await scanVault())
        return clean
      },
      move: (from: string, toDir: string, newName?: string) => moveEntryAny(from, toDir, newName),
      remove: async (rel: string) => {
        const abs = safePath(rel)
        await shell.trashItem(abs)
        dropFromOrder(rel)
        linkIndex.invalidate()
        win?.webContents.send('vault:changed', await scanVault())
      },
      outline: async (rel: string) => outlineOf(await fsp.readFile(safePath(rel), 'utf-8')),
      snippets: () => readJSON<any[]>(SNIPPET_FILE, []),
      saveSnippet: (title: string, content: string) => {
        const list = readJSON<any[]>(SNIPPET_FILE, [])
        const item = {
          id: `s-${Date.now().toString(36)}`,
          title: title.slice(0, 40),
          content: content.slice(0, 20000),
          createdAt: Date.now()
        }
        const next = [item, ...list.filter((s) => s.title !== item.title)].slice(0, 200)
        writeJSON(SNIPPET_FILE, next)
        win?.webContents.send('snippets:changed', next)
        return item
      },
      clips: () => clipHistory.map((c) => ({ text: c.text, time: c.time })),
      links: (rel: string) => linkIndex.doc(rel),
      neighborhood: (rel: string, depth: number) => linkIndex.neighborhood(rel, depth),
      linkPath: (from: string, to: string) => linkIndex.pathBetween(from, to),
      brokenLinks: () => linkIndex.broken()
    }))
    createWindow()
    createTray()
    startClipWatch()
    startVaultWatch()

    nativeTheme.on('updated', () => {
      win?.webContents.send('theme:system', nativeTheme.shouldUseDarkColors)
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else showWindow()
    })
  })

  app.on('before-quit', () => {
    isQuitting = true
  })

  app.on('window-all-closed', () => {
    // 常驻后台
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    watcher?.close()
    shutdownAi()
  })
}
