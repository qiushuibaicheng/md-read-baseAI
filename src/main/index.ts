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
import * as fsp from 'fs/promises'
import { pathToFileURL } from 'url'
import { registerAi } from './ai'

// ---------------------------------------------------------------------------
// 基础路径
// ---------------------------------------------------------------------------
const isDev = !app.isPackaged
const RES_DIR = isDev ? join(__dirname, '../../resources') : join(process.resourcesPath, 'resources')
const USER_DIR = app.getPath('userData')
const CONFIG_FILE = join(USER_DIR, 'config.json')
const SNIPPET_FILE = join(USER_DIR, 'snippets.json')
const CLIP_FILE = join(USER_DIR, 'clipboard.json')

const DEFAULT_HOTKEY = 'Alt+Space'

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
  themeMode: nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
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
ensureDir(USER_DIR)
ensureDir(config.vaultPath)

function saveConfig() {
  writeJSON(CONFIG_FILE, config)
}

// ---------------------------------------------------------------------------
// 首次启动：欢迎文档
// ---------------------------------------------------------------------------
function seedVault() {
  const welcome = join(config.vaultPath, '欢迎使用 Inkwell.md')
  if (existsSync(welcome)) return
  const content = `# 欢迎使用 Inkwell

> 一个为「问题定位」而生的 Markdown 工作台：**随时召出、随手记录、一键复制**。

## 快捷召出

按下 \`Alt + Space\`（可在设置里修改），窗口立刻出现在光标所在屏幕。
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

async function scanVault(dir = config.vaultPath): Promise<DocMeta[]> {
  const out: DocMeta[] = []
  async function walk(current: string, depth: number) {
    if (depth > 6) return
    let entries: any[] = []
    try {
      entries = await fsp.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || IGNORED.has(entry.name)) continue
      const abs = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(abs, depth + 1)
      } else if (/\.(md|markdown|mdx|txt)$/i.test(entry.name)) {
        try {
          const st = await fsp.stat(abs)
          const raw = await fsp.readFile(abs, 'utf-8')
          const heading = raw.match(/^#\s+(.+)$/m)
          out.push({
            path: relative(config.vaultPath, abs).split('\\').join('/'),
            name: entry.name,
            title: (heading ? heading[1] : entry.name.replace(/\.(md|markdown|mdx|txt)$/i, '')).trim(),
            mtime: st.mtimeMs,
            size: st.size
          })
        } catch {
          /* ignore */
        }
      }
    }
  }
  await walk(dir, 0)
  out.sort((a, b) => b.mtime - a.mtime)
  return out
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
    maximizable: false,
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
    const [w, h] = win.getSize()
    config.windowWidth = w
    config.windowHeight = h
    saveConfig()
  })

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
  tray.setToolTip('Inkwell · Alt+Space 召出')
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
  // Alt+Space 常被系统窗口菜单占用，依次退让到更少冲突的组合
  for (const fallback of ['Ctrl+Alt+Space', 'Alt+M', 'Ctrl+Alt+M']) {
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
    const prevHotkey = config.hotkey
    config = { ...config, ...patch }
    saveConfig()
    if (patch.hotkey && patch.hotkey !== prevHotkey) {
      const active = registerHotkey(patch.hotkey)
      config.hotkey = active || prevHotkey
      if (!active) registerHotkey(prevHotkey)
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

  ipcMain.handle('vault:pick', async () => {
    if (!win) return null
    suppressBlurHide = true
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: '选择笔记目录' })
    suppressBlurHide = false
    if (res.canceled || !res.filePaths[0]) return null
    config.vaultPath = res.filePaths[0]
    config.lastDoc = null
    config.openTabs = []
    ensureDir(config.vaultPath)
    seedVault()
    saveConfig()
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
    return relative(config.vaultPath, abs).split('\\').join('/')
  })

  ipcMain.handle('doc:rename', async (_e, rel: string, nextName: string) => {
    const abs = safePath(rel)
    const clean = nextName.replace(/[\\/:*?"<>|]/g, '').trim() || '未命名'
    const nextAbs = join(dirname(abs), clean.endsWith('.md') ? clean : `${clean}.md`)
    await fsp.rename(abs, nextAbs)
    return relative(config.vaultPath, nextAbs).split('\\').join('/')
  })

  ipcMain.handle('doc:delete', async (_e, rel: string) => {
    const abs = safePath(rel)
    await shell.trashItem(abs)
    return true
  })

  ipcMain.handle('doc:import', async (_e, absPath: string) => {
    const base = basename(absPath).replace(/\.(md|markdown|mdx|txt)$/i, '')
    const name = uniqueName(config.vaultPath, base)
    const dest = join(config.vaultPath, name)
    await fsp.copyFile(absPath, dest)
    return relative(config.vaultPath, dest).split('\\').join('/')
  })

  ipcMain.handle('doc:reveal', async (_e, rel: string) => {
    shell.showItemInFolder(safePath(rel))
  })

  ipcMain.handle('doc:openExternal', async (_e, rel: string) => {
    await shell.openPath(safePath(rel))
  })

  ipcMain.handle('search', async (_e, query: string) => {
    const q = query.trim().toLowerCase()
    if (!q) return []
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
  })

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
}

// ---------------------------------------------------------------------------
// 目录监听
// ---------------------------------------------------------------------------
let watcher: FSWatcher | null = null
let watchTimer: NodeJS.Timeout | null = null
function startVaultWatch() {
  watcher?.close()
  try {
    watcher = watch(config.vaultPath, { recursive: true }, () => {
      if (watchTimer) clearTimeout(watchTimer)
      watchTimer = setTimeout(async () => {
        if (!win) return
        win.webContents.send('vault:changed', await scanVault())
      }, 600)
    })
  } catch {
    /* 某些文件系统不支持 recursive watch */
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
    registerAi(USER_DIR, () => win)
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
  })
}
