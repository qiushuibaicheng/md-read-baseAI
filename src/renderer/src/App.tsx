import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ThreeBackground from './components/ThreeBackground'
import Sidebar from './components/Sidebar'
import SearchPalette from './components/SearchPalette'
import SettingsDialog from './components/SettingsDialog'
import Preview from './components/Preview'
import AiPanel, { type AiPanelHandle } from './components/AiPanel'
import ModelsDialog from './components/ModelsDialog'
import DiffDialog from './components/DiffDialog'
import { Icon } from './components/Icons'
import { renderMarkdown, exportStyles, relativeTime } from './lib/markdown'
import type { AppConfig, ClipItem, DocMeta, ModelProfile, SearchResult, Snippet, ViewKey } from './lib/types'

const FALLBACK: AppConfig = {
  vaultPath: '',
  hotkey: 'Alt+Space',
  hideOnBlur: true,
  alwaysOnTop: false,
  threeBg: true,
  clipboardWatch: true,
  theme: 'dark',
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
  themeMode: 'dark'
}

function mergeDocs(prev: DocMeta[], next: DocMeta[]): DocMeta[] {
  const map = new Map(next.map((d) => [d.path, d]))
  const seen = new Set<string>()
  const kept = prev
    .filter((d) => {
      if (!map.has(d.path) || seen.has(d.path)) return false
      seen.add(d.path)
      return true
    })
    .map((d) => map.get(d.path)!)
  const added = next.filter((d) => !prev.some((p) => p.path === d.path))
  return [...added, ...kept]
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** 块级内容的开头：标题、列表、引用、表格、代码块、图片、HTML 标签 */
const BLOCK_HEAD = /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|~~~|!\[|<[a-zA-Z]|:::)/

const lineAt = (text: string, index: number) => text.slice(0, Math.max(0, index)).split('\n').length

/**
 * 把 text 插到 [start, end) 位置。
 * 块级内容（多行 / 标题 / 列表…）自动补空行，避免和上下文粘在一起；
 * 行内内容（如 Tab 的两个空格）原样插入，不做任何修饰。
 */
function composeInsert(
  value: string,
  start: number,
  end: number,
  text: string,
  block: boolean
): { text: string; caret: number } {
  if (start !== end) {
    // 有选区：直接替换，尊重用户的选择
    return { text: value.slice(0, start) + text + value.slice(end), caret: start + text.length }
  }
  let lead = ''
  let tail = ''
  if (block) {
    const before = value.slice(0, start)
    const after = value.slice(end)
    if (before && !before.endsWith('\n')) lead = '\n\n'
    else if (before && !before.endsWith('\n\n')) lead = '\n'
    if (after) {
      if (!after.startsWith('\n')) tail = '\n\n'
      else if (!after.startsWith('\n\n')) tail = '\n'
    }
  }
  return {
    text: value.slice(0, start) + lead + text + tail + value.slice(end),
    caret: start + lead.length + text.length
  }
}

export default function App() {
  const [ready, setReady] = useState(false)
  const [config, setConfig] = useState<AppConfig>(FALLBACK)
  const [docs, setDocs] = useState<DocMeta[]>([])
  const [folders, setFolders] = useState<string[]>([])
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [clips, setClips] = useState<ClipItem[]>([])
  const [models, setModels] = useState<ModelProfile[]>([])
  const [hotkeyActive, setHotkeyActive] = useState<string | null>(null)
  const [version, setVersion] = useState('1.0.0')
  const [packaged, setPackaged] = useState(false)
  const [systemDark, setSystemDark] = useState(true)

  const [tabs, setTabs] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [contents, setContents] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)

  const [view, setView] = useState<ViewKey>('notes')
  const [query, setQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [modelsOpen, setModelsOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [toast, setToast] = useState<{ id: number; msg: string } | null>(null)
  const [split, setSplit] = useState(0.5)
  const [dragging, setDragging] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [entering, setEntering] = useState(true)
  const [maximized, setMaximized] = useState(false)
  const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null)
  const [diff, setDiff] = useState<{ before: string; after: string; title: string } | null>(null)
  const [undo, setUndo] = useState<{ path: string; content: string; at: number } | null>(null)

  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const panesRef = useRef<HTMLDivElement | null>(null)
  /** 最后一次已知的插入点：切到 AI 面板后 textarea 失焦，但位置要留住 */
  const caretRef = useRef<{ path: string; start: number; end: number } | null>(null)
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const pending = useRef<Record<string, string>>({})
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevActive = useRef<string | null>(null)
  const aiRef = useRef<AiPanelHandle | null>(null)
  const titledRef = useRef<Set<string>>(new Set())

  const theme: 'light' | 'dark' = config.themeMode === 'system' ? (systemDark ? 'dark' : 'light') : config.themeMode

  useEffect(() => {
    window.api.isMaximized().then(setMaximized)
  }, [])

  // ---------------------------------------------------------------- 初始化
  useEffect(() => {
    window.api.init().then((res) => {
      setConfig(res.config)
      setDocs(res.docs)
      window.api.listFolders().then(setFolders).catch(() => undefined)
      setSnippets(res.snippets)
      setClips(res.clipboard)
      setHotkeyActive(res.hotkeyActive)
      setVersion(res.version)
      setSystemDark(res.systemDark)
      const valid = res.config.openTabs.filter((p) => res.docs.some((d) => d.path === p))
      const last = res.config.lastDoc && res.docs.some((d) => d.path === res.config.lastDoc) ? res.config.lastDoc : null
      const initial = last || valid[0] || res.docs[0]?.path || null
      if (initial) {
        setTabs(valid.length ? valid : [initial])
        setActive(initial)
      }
      setReady(true)
      window.api.isPackaged().then(setPackaged)
      window.api.aiModels().then((list) => {
        setModels(list)
        if (!res.config.aiModelId && list[0]) window.api.setConfig({ aiModelId: list[0].id })
      })
      if (res.hotkeyActive && res.hotkeyActive !== 'Alt+Space') {
        setTimeout(() => showToast(`Alt+Space 被占用，已改用 ${res.hotkeyActive} 召出`), 1200)
      }
    })

    const offs = [
      window.api.onClipboardChanged(setClips),
      window.api.onVaultChanged((list) => setDocs((prev) => mergeDocs(prev, list))),
      window.api.onConfigChanged(setConfig),
      window.api.onThemeSystem(setSystemDark),
      window.api.onWindowShown(() => {
        setSearchOpen(false)
        setSettingsOpen(false)
        setEntering(true)
        setTimeout(() => setEntering(false), 280)
        setTimeout(() => editorRef.current?.focus(), 60)
      }),
      window.api.onOpenSettings(() => setSettingsOpen(true)),
      window.api.onMaximized(setMaximized)
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // ---------------------------------------------------------------- 主题 / 强调色
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.accent = config.accent || 'indigo'
    document.documentElement.style.setProperty('--reading-size', `${config.fontSize}px`)
  }, [theme, config.accent, config.fontSize])

  // ---------------------------------------------------------------- 内容加载
  useEffect(() => {
    if (!active) return
    if (contents[active] !== undefined) return
    let cancelled = false
    window.api.readDoc(active).then((r) => {
      if (!cancelled) setContents((c) => ({ ...c, [active]: r.content }))
    })
    return () => {
      cancelled = true
    }
  }, [active])

  // ---------------------------------------------------------------- 保存
  const flushSave = useCallback(async (path: string) => {
    const text = pending.current[path]
    if (text === undefined) return
    delete pending.current[path]
    setSaving(true)
    try {
      await window.api.writeDoc(path, text)
      setDirty((d) => ({ ...d, [path]: false }))
      setDocs((prev) => prev.map((d) => (d.path === path ? { ...d, mtime: Date.now() } : d)))

      // AI 自动命名：只对仍是默认标题的新文档处理一次
      const profileId = config.aiModelId
      if (config.aiAutoTitle && profileId && !titledRef.current.has(path) && /^#\s*未命名/.test(text.trim())) {
        titledRef.current.add(path)
        const title = await window.api.aiTitle({ profileId, content: text })
        if (title) {
          const rel = await window.api.renameDoc(path, title)
          setTabs((t) => t.map((p) => (p === path ? rel : p)))
          setContents((c) => {
            if (c[path] === undefined) return c
            const next = { ...c }
            next[rel] = next[path]
            delete next[path]
            return next
          })
          setActive((a) => (a === path ? rel : a))
          setDocs(await window.api.listDocs())
          showToast(`已命名为「${title}」`)
        }
      }
    } finally {
      setSaving(false)
    }
  }, [config.aiModelId, config.aiAutoTitle])

  useEffect(() => {
    if (prevActive.current && prevActive.current !== active) flushSave(prevActive.current)
    prevActive.current = active
  }, [active, flushSave])

  useEffect(() => {
    const onBlur = () => Object.keys(pending.current).forEach((p) => flushSave(p))
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [flushSave])

  const handleChange = (text: string) => {
    if (!active) return
    setContents((c) => ({ ...c, [active]: text }))
    setDirty((d) => ({ ...d, [active]: true }))
    pending.current[active] = text
    clearTimeout(saveTimers.current[active])
    saveTimers.current[active] = setTimeout(() => flushSave(active), 600)
  }

  // ---------------------------------------------------------------- 文档操作
  const openDoc = (path: string) => {
    setTabs((t) => (t.includes(path) ? t : [...t, path].slice(-9)))
    setActive(path)
    setView('notes')
    setSelection(null)
  }

  const closeTab = (path: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setTabs((t) => {
      const idx = t.indexOf(path)
      const next = t.filter((p) => p !== path)
      if (active === path) setActive(next[Math.max(0, idx - 1)] || null)
      return next
    })
  }

  const createDoc = async (dirOrEvent?: unknown) => {
    const dir = typeof dirOrEvent === 'string' ? dirOrEvent : undefined
    const rel = await window.api.createDoc(dir ? { dir } : {})
    const list = await window.api.listDocs()
    setDocs(list)
    openDoc(rel)
    setTimeout(() => {
      const ta = editorRef.current
      if (!ta) return
      ta.focus()
      const end = ta.value.indexOf('\n')
      ta.setSelectionRange(2, end > 0 ? end : ta.value.length)
    }, 180)
  }

  const createFolder = async (parent: string | undefined, name: string) => {
    try {
      await window.api.makeFolder({ parent, name })
      setFolders(await window.api.listFolders())
      setDocs(await window.api.listDocs())
      showToast(`已创建文件夹「${name}」`)
      return true
    } catch (err) {
      showToast(String((err as Error)?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      return false
    }
  }

  const deleteDoc = async (path: string) => {
    await window.api.deleteDoc(path)
    setDocs((prev) => prev.filter((d) => d.path !== path))
    setTabs((prev) => {
      const next = prev.filter((p) => p !== path)
      if (active === path) setActive(next[0] || null)
      return next
    })
    showToast('已移到回收站')
  }

  const renameDoc = async (path: string, name: string) => {
    const rel = await window.api.renameDoc(path, name)
    setTabs((t) => t.map((p) => (p === path ? rel : p)))
    setContents((c) => {
      if (c[path] === undefined) return c
      const next = { ...c }
      next[rel] = next[path]
      delete next[path]
      return next
    })
    if (active === path) setActive(rel)
    const list = await window.api.listDocs()
    setDocs(list)
  }

  // ---------------------------------------------------------------- 片段 / 剪贴板
  const showToast = useCallback((msg: string) => {
    setToast({ id: Date.now(), msg })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 1700)
  }, [])

  const copy = useCallback(
    async (text: string, label = '已复制') => {
      await window.api.copyText(text)
      showToast(label)
    },
    [showToast]
  )

  const addSnippet = (content: string) => {
    const firstLine = content.split('\n').find((l) => l.trim()) || '未命名片段'
    const snippet: Snippet = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: firstLine.replace(/^#+\s*/, '').slice(0, 40),
      content,
      createdAt: Date.now()
    }
    const next = [snippet, ...snippets]
    setSnippets(next)
    window.api.saveSnippets(next)
    showToast('片段已保存')
  }

  const updateSnippets = (next: Snippet[]) => {
    setSnippets(next)
    window.api.saveSnippets(next)
  }

  // ---------------------------------------------------------------- 配置
  const patchConfig = (patch: Partial<AppConfig>) => {
    setConfig((c) => ({ ...c, ...patch }))
    window.api.setConfig(patch)
  }

  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => window.api.setConfig({ lastDoc: active, openTabs: tabs }), 900)
    return () => clearTimeout(t)
  }, [active, tabs, ready])

  // ---------------------------------------------------------------- 渲染
  const activeContent = active ? contents[active] ?? '' : ''
  const [preview, setPreview] = useState({ key: '', src: '' })

  useEffect(() => {
    if (!active) return
    const delay = preview.key === active ? 130 : 0
    const timer = setTimeout(() => setPreview({ key: active, src: activeContent }), delay)
    return () => clearTimeout(timer)
  }, [activeContent, active])

  const rendered = useMemo(
    () => (active ? renderMarkdown(preview.key === active ? preview.src : activeContent, config.vaultPath) : null),
    [active, preview, activeContent, config.vaultPath]
  )

  const mode = config.editorMode
  const currentMeta = docs.find((d) => d.path === active)
  const title = currentMeta?.title || active?.replace(/\.md$/i, '') || 'Inkwell'

  // ---------------------------------------------------------------- AI 动作
  const revealAi = (open: boolean) => {
    setAiOpen(open)
    // 窄窗口下先让侧栏让位，把宽度留给正文
    if (open && window.innerWidth < 1180) setSidebarOpen(false)
  }

  const askWithSelection = (skillId: string) => {
    if (!selection) return
    const text = selection.text
    revealAi(true)
    setSelection(null)
    setTimeout(() => aiRef.current?.runSkill(skillId, text), 60)
  }

  const openAi = () => {
    revealAi(true)
    setTimeout(() => aiRef.current?.focus(), 120)
  }

  // 问笔记库：把检索命中的文档拼成上下文，交给 AI 回答
  const askLibrary = async (q: string, results: SearchResult[]) => {
    const top = results.slice(0, 4)
    const chunks: string[] = []
    for (const r of top) {
      let text = contents[r.path]
      if (text === undefined) {
        try {
          text = (await window.api.readDoc(r.path)).content
        } catch {
          continue
        }
      }
      chunks.push(`<doc title="${r.title}" path="${r.path}">\n${text.slice(0, 3500)}\n</doc>`)
    }
    if (!chunks.length) {
      showToast('没有可用的笔记内容')
      return
    }
    const prompt = `我在笔记库里检索「${q}」，命中以下 ${chunks.length} 篇文档。请：\n1. 先用一句话回答我的问题；\n2. 再按文档逐条列出相关依据（注明来自哪一篇）；\n3. 如果笔记里没有答案，直接说明缺少什么信息。\n\n${chunks.join('\n\n')}`
    setSearchOpen(false)
    revealAi(true)
    setTimeout(() => aiRef.current?.ask(prompt, `问笔记库：${q}`), 80)
  }

  const requestReplace = (after: string) => {
    if (!active) {
      showToast('先打开一篇文档')
      return
    }
    setDiff({ before: contents[active] ?? '', after, title })
  }

  const applyDiff = () => {
    if (!diff || !active) return
    setUndo({ path: active, content: diff.before, at: Date.now() })
    handleChange(diff.after)
    setDiff(null)
    showToast('已应用 AI 修改 · Ctrl+Z 撤回')
  }

  /** 追加到文末 */
  const appendText = (raw: string) => {
    if (!active) {
      showToast('先打开一篇文档')
      return
    }
    const text = raw.replace(/\r\n/g, '\n').trim()
    if (!text) return
    const value = contents[active] ?? ''
    const sep = !value ? '' : value.endsWith('\n\n') ? '' : value.endsWith('\n') ? '\n' : '\n\n'
    const next = value + sep + text
    handleChange(next)
    caretRef.current = { path: active, start: next.length, end: next.length }
    showToast('已追加到文末')
  }

  /** 记住光标：点击、拖选、键盘移动都要更新 */
  const rememberCaret = () => {
    const ta = editorRef.current
    if (!ta || !active) return
    caretRef.current = { path: active, start: ta.selectionStart, end: ta.selectionEnd }
  }

  /**
   * 插入到光标处。位置来源优先级：
   * ① 记忆中的插入点（AI 面板抢了焦点也还在）② 当前聚焦的编辑器 ③ 兜底追加到文末
   */
  const insertAtCaret = (raw: string) => {
    if (!active) {
      showToast('先打开一篇文档')
      return
    }
    const text = raw.replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\s+$/, '')
    if (!text) return
    const value = contents[active] ?? ''
    // 多行、块级语法、或者一长段（>80 字）都按块处理，避免和上下文粘成一段
    const block = /\n/.test(text) || BLOCK_HEAD.test(text) || text.length > 80

    const ta = editorRef.current
    const memo = caretRef.current
    let point: { start: number; end: number } | null = null
    if (memo && memo.path === active) {
      const start = Math.min(memo.start, value.length)
      point = { start, end: Math.min(Math.max(memo.end, start), value.length) }
    } else if (ta && document.activeElement === ta) {
      point = { start: ta.selectionStart, end: ta.selectionEnd }
    }

    if (!point) {
      const sep = !value ? '' : value.endsWith('\n\n') ? '' : value.endsWith('\n') ? '\n' : '\n\n'
      handleChange(value + sep + text)
      showToast('已追加到文末 · 在正文点一下可指定插入位置')
      return
    }

    const next = composeInsert(value, point.start, point.end, text, block)
    handleChange(next.text)
    caretRef.current = { path: active, start: next.caret, end: next.caret }
    const line = lineAt(next.text, next.caret)
    requestAnimationFrame(() => {
      const el = editorRef.current
      if (!el) {
        showToast(`已插入到第 ${line} 行`)
        return
      }
      el.focus()
      el.setSelectionRange(next.caret, next.caret)
      // 让插入点滚进视野
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 24
      const y = (el.value.slice(0, next.caret).split('\n').length - 1) * lh
      if (y < el.scrollTop + lh || y > el.scrollTop + el.clientHeight - lh * 2) {
        el.scrollTop = Math.max(0, y - el.clientHeight / 2)
      }
      showToast(`已插入到第 ${line} 行`)
    })
  }

  /** 编辑器内直接插入（Tab 缩进、粘贴图片），光标就在眼前，不做兜底提示 */
  const insertAtCursor = (text: string) => {
    const ta = editorRef.current
    if (!ta || !active) {
      insertAtCaret(text)
      return
    }
    const value = contents[active] ?? ''
    const block = /\n/.test(text) && text.trim().length > 0
    const next = composeInsert(value, ta.selectionStart, ta.selectionEnd, text, block)
    handleChange(next.text)
    caretRef.current = { path: active, start: next.caret, end: next.caret }
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = next.caret
      ta.focus()
    })
  }

  const createFromAi = async (name: string, content: string) => {
    const rel = await window.api.createDoc({ title: name || 'AI 草稿' })
    const body = content.startsWith('#') ? content : `# ${name || 'AI 草稿'}\n\n${content}`
    await window.api.writeDoc(rel, body)
    setContents((c) => ({ ...c, [rel]: body }))
    setDocs(await window.api.listDocs())
    openDoc(rel)
    showToast('已生成新文档')
  }

  const aiTitleForActive = async () => {
    if (!active || !config.aiModelId) {
      showToast('先在设置里配置模型')
      return
    }
    showToast('正在生成标题…')
    const name = await window.api.aiTitle({ profileId: config.aiModelId, content: activeContent })
    if (!name) {
      showToast('标题生成失败')
      return
    }
    await renameDoc(active, name)
    showToast(`已命名为「${name}」`)
  }

  const saveModel = async (profile: ModelProfile) => {
    const list = await window.api.aiSaveModel(profile)
    setModels(list)
    if (!config.aiModelId) patchConfig({ aiModelId: profile.id })
    showToast('模型已保存')
  }

  const removeModel = async (id: string) => {
    const list = await window.api.aiRemoveModel(id)
    setModels(list)
    if (config.aiModelId === id) patchConfig({ aiModelId: list[0]?.id || null })
    showToast('已删除模型')
  }

  // ---------------------------------------------------------------- 快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      if (mod && key === 'k') {
        e.preventDefault()
        setSearchOpen(true)
        return
      }
      if (mod && key === 'j') {
        e.preventDefault()
        setAiOpen((v) => {
          if (!v && window.innerWidth < 1180) setSidebarOpen(false)
          return !v
        })
        return
      }
      if (mod && key === 'n') {
        e.preventDefault()
        createDoc()
        return
      }
      if (mod && key === 's') {
        e.preventDefault()
        if (active) flushSave(active)
        showToast('已保存')
        return
      }
      if (mod && key === 'e') {
        e.preventDefault()
        const order: AppConfig['editorMode'][] = ['split', 'edit', 'preview']
        const next = order[(order.indexOf(mode) + 1) % order.length]
        patchConfig({ editorMode: next })
        return
      }
      if (mod && key === 'b') {
        e.preventDefault()
        setSidebarOpen((v) => !v)
        return
      }
      if (mod && key === ',') {
        e.preventDefault()
        setSettingsOpen(true)
        return
      }
      if (mod && key === 'z' && undo && undo.path === active && Date.now() - undo.at < 20000) {
        const el = document.activeElement as HTMLElement | null
        if (el && el.classList.contains('editor')) return
        e.preventDefault()
        handleChange(undo.content)
        setUndo(null)
        showToast('已撤回 AI 修改')
        return
      }
      if (mod && e.shiftKey && key === 'v') {
        e.preventDefault()
        window.api.readClipboard().then((text) => {
          if (text?.trim()) {
            addSnippet(text.trim())
            setView('snippets')
          }
        })
        return
      }
      if (e.key === 'Escape') {
        if (selection) setSelection(null)
        else if (searchOpen) setSearchOpen(false)
        else if (modelsOpen) setModelsOpen(false)
        else if (diff) setDiff(null)
        else if (settingsOpen) setSettingsOpen(false)
        else if (outlineOpen) setOutlineOpen(false)
        else window.api.hide()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, mode, searchOpen, settingsOpen, outlineOpen, snippets, flushSave, selection, modelsOpen, diff, undo])

  // ---------------------------------------------------------------- 编辑交互
  const onEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      insertAtCursor('  ')
    }
  }

  const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'))
    if (!item) return
    const file = item.getAsFile()
    if (!file) return
    e.preventDefault()
    const dataUrl = await fileToDataUrl(file)
    const rel = await window.api.saveAsset(file.name || 'image.png', dataUrl)
    insertAtCursor(`\n![](${rel})\n`)
    showToast('图片已插入')
  }

  const toggleTask = (line: number) => {
    if (!active) return
    const text = contents[active] ?? ''
    const lines = text.split('\n')
    const target = lines[line]
    if (target === undefined) return
    if (/^(\s*[-*+]\s+)\[ \]/.test(target)) {
      lines[line] = target.replace(/^(\s*[-*+]\s+)\[ \]/, '$1[x]')
    } else if (/^(\s*[-*+]\s+)\[[xX]\]/.test(target)) {
      lines[line] = target.replace(/^(\s*[-*+]\s+)\[[xX]\]/, '$1[ ]')
    } else {
      return
    }
    handleChange(lines.join('\n'))
  }

  const exportHtml = async () => {
    if (!rendered || !active) return
    const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title>
<style>${exportStyles(theme)}</style></head>
<body><div class="doc markdown-body">${rendered.html}</div></body></html>`
    const p = await window.api.exportHTML(active, html)
    if (p) showToast('已导出 HTML')
  }

  // ---------------------------------------------------------------- 分栏拖拽
  const startSplit = (e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    const move = (ev: MouseEvent) => {
      const rect = panesRef.current?.getBoundingClientRect()
      if (!rect) return
      const ratio = (ev.clientX - rect.left) / rect.width
      setSplit(Math.min(0.78, Math.max(0.22, ratio)))
    }
    const up = () => {
      setDragging(false)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // ---------------------------------------------------------------- 拖入文件
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDropping(false)
    const files = Array.from(e.dataTransfer.files)
    for (const f of files) {
      if (!/\.(md|markdown|mdx|txt)$/i.test(f.name)) continue
      const abs = window.pathForFile(f)
      if (!abs) continue
      const rel = await window.api.importDoc(abs)
      const list = await window.api.listDocs()
      setDocs(list)
      openDoc(rel)
      showToast(`已导入 ${f.name}`)
    }
  }

  const hideSelection = () => setSelection(null)

  // ---------------------------------------------------------------- 渲染树
  return (
    <div
      className={`app${entering ? ' is-entering' : ''}${dragging ? ' is-dragging' : ''}${maximized ? ' is-maximized' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDropping(true)
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropping(false)
      }}
      onDrop={onDrop}
      onMouseDown={(e) => {
        const el = e.target as HTMLElement
        if (!el.closest('.sel-bar')) hideSelection()
      }}
    >
      <ThreeBackground theme={theme} enabled={config.threeBg} />

      <header className="titlebar">
        <div className="brand">
          <div className="brand-mark">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
              <path d="M6 4.5h8l4 4v11H6z" fill="rgba(255,255,255,.92)" />
              <path d="M14 4.5v4h4" fill="rgba(255,255,255,.55)" />
              <path d="M9 12.5h6M9 15.5h4" stroke="#5b7cfa" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </div>
          <span className="brand-name">Inkwell</span>
        </div>

        <div className="tabs">
          {tabs.map((path) => {
            const meta = docs.find((d) => d.path === path)
            return (
              <button
                key={path}
                className={`tab${active === path ? ' is-active' : ''}`}
                onClick={() => setActive(path)}
                onAuxClick={(e) => {
                  if (e.button === 1) closeTab(path)
                }}
                title={path}
              >
                {dirty[path] && <span className="tab-dot" />}
                <span className="tab-title">{meta?.title || path.replace(/\.md$/i, '')}</span>
                <span className="tab-close" onClick={(e) => closeTab(path, e)} role="button" title="关闭">
                  <Icon name="close" size={10} />
                </span>
              </button>
            )
          })}
          <button className="tab-add" onClick={createDoc} title="新建文档 (Ctrl+N)">
            <Icon name="plus" size={14} />
          </button>
        </div>

        <div className="window-actions">
          <button className="icon-btn" onClick={() => setSearchOpen(true)} title="搜索 (Ctrl+K)">
            <Icon name="search" size={16} />
          </button>
          <button className={`icon-btn ai-toggle${aiOpen ? ' is-on' : ''}`} onClick={() => revealAi(!aiOpen)} title="AI 助手 (Ctrl+J)">
            <Icon name="sparkle" size={15} />
          </button>
          <button
            className={`icon-btn${config.alwaysOnTop ? ' is-on' : ''}`}
            onClick={() => patchConfig({ alwaysOnTop: !config.alwaysOnTop })}
            title="窗口置顶"
          >
            <Icon name="pin" size={15} />
          </button>
          <button
            className="icon-btn"
            onClick={() => patchConfig({ themeMode: theme === 'dark' ? 'light' : 'dark' })}
            title="切换主题"
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
          </button>
          <button className="icon-btn" onClick={() => setSettingsOpen(true)} title="设置 (Ctrl+,)">
            <Icon name="settings" size={15} />
          </button>
          <div className="win-sep" />
          <button className="win-btn" onClick={() => window.api.hide()} title="收起">
            <Icon name="minus" size={15} />
          </button>
          <button
            className="win-btn"
            onClick={() => window.api.toggleMaximize()}
            title={maximized ? '还原' : '最大化'}
          >
            <Icon name={maximized ? 'restore' : 'maximize'} size={13} />
          </button>
          <button className="win-btn danger" onClick={() => window.api.hide()} title="关闭">
            <Icon name="close" size={15} />
          </button>
        </div>
      </header>

      <div className="workspace">
        {sidebarOpen && (
          <Sidebar
            view={view}
            setView={setView}
            docs={docs}
            active={active}
            query={query}
            setQuery={setQuery}
            onOpen={openDoc}
            onNew={createDoc}
            folders={folders}
            onNewFolder={createFolder}
            onDelete={deleteDoc}
            onRename={renameDoc}
            onReveal={(p) => window.api.revealDoc(p)}
            snippets={snippets}
            onAddSnippet={addSnippet}
            onDeleteSnippet={(id) => updateSnippets(snippets.filter((s) => s.id !== id))}
            onRenameSnippet={(id, name) => updateSnippets(snippets.map((s) => (s.id === id ? { ...s, title: name } : s)))}
            onCopy={copy}
            clips={clips}
            onClearClips={async () => setClips(await window.api.clearClipboard())}
            onRemoveClip={async (id) => setClips(await window.api.removeClipboard(id))}
            vaultPath={config.vaultPath}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}

        <main className="main">
          {!active && (
            <div className="welcome">
              <div className="welcome-mark">
                <Icon name="sparkle" size={22} />
              </div>
              <h1>随时召出，随手记录</h1>
              <p>
                纯 Markdown 存在本地，按 <kbd>{config.hotkey}</kbd> 随时回来。
              </p>
              <div className="welcome-actions">
                <button className="btn-primary" onClick={createDoc}>
                  <Icon name="plus" size={15} /> 新建文档
                </button>
                <button className="btn-ghost" onClick={() => setSearchOpen(true)}>
                  <Icon name="search" size={15} /> 搜索内容
                </button>
                <button className="btn-ghost" onClick={openAi}>
                  <Icon name="sparkle" size={15} /> 问 AI
                </button>
              </div>

              {docs.length > 0 && (
                <div className="welcome-recent">
                  <div className="welcome-recent-label">最近</div>
                  {docs.slice(0, 4).map((d) => (
                    <button key={d.path} className="recent-row" onClick={() => openDoc(d.path)}>
                      <Icon name="doc" size={14} />
                      <span>{d.title}</span>
                      <small>{relativeTime(d.mtime)}</small>
                    </button>
                  ))}
                </div>
              )}

              <div className="welcome-tips">
                <span>
                  <kbd>Ctrl</kbd>+<kbd>K</kbd> 搜索
                </span>
                <span>
                  <kbd>Ctrl</kbd>+<kbd>J</kbd> AI
                </span>
                <span>
                  <kbd>Ctrl</kbd>+<kbd>E</kbd> 切换视图
                </span>
                <span>
                  <kbd>Esc</kbd> 收起
                </span>
              </div>
            </div>
          )}

          {active && (
            <>
              <div className="docbar">
                {!sidebarOpen && (
                  <button className="icon-btn" onClick={() => setSidebarOpen(true)} title="展开侧栏 (Ctrl+B)">
                    <Icon name="sidebar" size={15} />
                  </button>
                )}
                <div className="docbar-title">
                  <span>{title}</span>
                  <span className={`save-state${dirty[active] ? ' is-dirty' : ''}`}>
                    {saving ? '保存中…' : dirty[active] ? '待保存' : '已保存'}
                  </span>
                </div>
                <div className="docbar-meta">
                  {rendered?.words ?? 0} 字
                  <span className="dot-sep" />
                  {relativeTime(currentMeta?.mtime || Date.now())}
                </div>
                <div className="docbar-actions">
                  <div className="segmented compact">
                    <button
                      className={`seg-btn${mode === 'edit' ? ' is-active' : ''}`}
                      onClick={() => patchConfig({ editorMode: 'edit' })}
                      title="仅编辑 (Ctrl+E)"
                    >
                      <Icon name="edit" size={13} />
                    </button>
                    <button
                      className={`seg-btn${mode === 'split' ? ' is-active' : ''}`}
                      onClick={() => patchConfig({ editorMode: 'split' })}
                      title="分栏 (Ctrl+E)"
                    >
                      <Icon name="split" size={13} />
                    </button>
                    <button
                      className={`seg-btn${mode === 'preview' ? ' is-active' : ''}`}
                      onClick={() => patchConfig({ editorMode: 'preview' })}
                      title="仅预览 (Ctrl+E)"
                    >
                      <Icon name="eye" size={13} />
                    </button>
                  </div>
                  <button className="icon-btn" onClick={aiTitleForActive} title="AI 起标题">
                    <Icon name="wand" size={15} />
                  </button>
                  <button
                    className={`icon-btn${outlineOpen ? ' is-on' : ''}`}
                    onClick={() => setOutlineOpen((v) => !v)}
                    title="大纲"
                  >
                    <Icon name="outline" size={15} />
                  </button>
                  <button className="icon-btn" onClick={exportHtml} title="导出 HTML">
                    <Icon name="download" size={15} />
                  </button>
                  <button className="icon-btn" onClick={() => window.api.revealDoc(active)} title="在文件夹中显示">
                    <Icon name="folder" size={15} />
                  </button>
                </div>
              </div>

              <div
                className={`panes mode-${mode}`}
                ref={panesRef}
                style={mode === 'split' ? { gridTemplateColumns: `${split * 100}% 7px 1fr` } : undefined}
              >
                {(mode === 'edit' || mode === 'split') && (
                  <div className="editor-pane">
                    <textarea
                      ref={editorRef}
                      className="editor"
                      value={activeContent}
                      spellCheck={false}
                      onChange={(e) => handleChange(e.target.value)}
                      onKeyDown={onEditorKeyDown}
                      onKeyUp={rememberCaret}
                      onMouseUp={rememberCaret}
                      onSelect={rememberCaret}
                      onFocus={rememberCaret}
                      onPaste={onPaste}
                      placeholder="开始记录…"
                    />
                  </div>
                )}
                {mode === 'split' && <div className="splitter" onMouseDown={startSplit} />}
                {(mode === 'preview' || mode === 'split') && (
                  <Preview
                    html={rendered?.html || ''}
                    fontSize={config.fontSize}
                    docKey={active}
                    theme={theme}
                    onCopy={copy}
                    onToggleTask={toggleTask}
                    onSelectText={(text, rect) => setSelection({ text, ...rect })}
                  />
                )}
              </div>
            </>
          )}
        </main>

        {outlineOpen && rendered && (
          <aside className="outline">
            <div className="outline-head">
              <span>大纲</span>
              <button className="icon-btn tiny" onClick={() => setOutlineOpen(false)}>
                <Icon name="close" size={12} />
              </button>
            </div>
            <div className="outline-list">
              {rendered.headings.length === 0 && <div className="empty-hint">这篇文档还没有标题</div>}
              {rendered.headings.map((h) => (
                <button
                  key={h.id}
                  className="outline-item"
                  style={{ paddingLeft: 10 + (h.level - 1) * 12 }}
                  onClick={() => document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                >
                  <span className={`outline-dot lv${h.level}`} />
                  {h.text || '（空标题）'}
                </button>
              ))}
            </div>
          </aside>
        )}

        <AiPanel
          ref={aiRef}
          open={aiOpen}
          width={config.aiPanelWidth}
          theme={theme}
          models={models}
          activeModelId={config.aiModelId}
          docPath={active}
          docTitle={title}
          docContent={activeContent}
          selection={selection?.text || null}
          onClose={() => setAiOpen(false)}
          onResize={(w) => patchConfig({ aiPanelWidth: w })}
          onPickModel={(id) => patchConfig({ aiModelId: id })}
          onManageModels={() => setModelsOpen(true)}
          onInsert={appendText}
          onInsertAtCursor={insertAtCaret}
          onReplaceDoc={requestReplace}
          onNewDoc={createFromAi}
          onCopy={copy}
          onToast={showToast}
        />
      </div>

      {selection && (
        <div className="sel-bar" style={{ left: selection.x, top: selection.y }}>
          <span className={`sel-count${aiOpen ? ' is-live' : ''}`} title={aiOpen ? '已同步到右侧 AI 面板' : '选中内容'}>
            <b>{selection.text.length}</b> 字{aiOpen ? ' · 已带入 AI' : ''}
          </span>
          <span className="sel-sep" />
          <button onClick={() => askWithSelection('explain')}>
            <Icon name="alert" size={12} /> 解释
          </button>
          <button onClick={() => askWithSelection('polish')}>
            <Icon name="wand" size={12} /> 润色
          </button>
          <button onClick={() => askWithSelection('translate')}>
            <Icon name="external" size={12} /> 翻译
          </button>
          <span className="sel-sep" />
          <button onClick={() => copy(selection.text, '已复制选中内容')}>
            <Icon name="copy" size={12} /> 复制
          </button>
          <button
            onClick={() => {
              addSnippet(selection.text)
              setSelection(null)
            }}
          >
            <Icon name="snippet" size={12} /> 存片段
          </button>
        </div>
      )}

      {dropping && (
        <div className="drop-cover">
          <div className="drop-card">
            <Icon name="download" size={22} />
            <span>松手即可导入 Markdown</span>
          </div>
        </div>
      )}

      <SearchPalette
        open={searchOpen}
        docs={docs}
        onClose={() => setSearchOpen(false)}
        onOpen={openDoc}
        onNew={createDoc}
        onAsk={askLibrary}
      />

      <SettingsDialog
        open={settingsOpen}
        config={config}
        hotkeyActive={hotkeyActive}
        version={version}
        packaged={packaged}
        models={models}
        onChange={patchConfig}
        onManageModels={() => {
          setSettingsOpen(false)
          setModelsOpen(true)
        }}
        onPickVault={async () => {
          const res = await window.api.pickVault()
          if (res) {
            setConfig(res.config)
            setDocs(res.docs)
      window.api.listFolders().then(setFolders).catch(() => undefined)
            setTabs([])
            setActive(null)
            setContents({})
          }
        }}
        onOpenVault={() => window.api.openVault()}
        onQuit={() => window.api.quit()}
        onClose={() => setSettingsOpen(false)}
      />

      <ModelsDialog
        open={modelsOpen}
        models={models}
        activeId={config.aiModelId}
        onClose={() => setModelsOpen(false)}
        onSave={saveModel}
        onRemove={removeModel}
        onPick={(id) => {
          patchConfig({ aiModelId: id })
          showToast('已切换模型')
        }}
      />

      <DiffDialog
        open={!!diff}
        title={diff?.title || ''}
        before={diff?.before || ''}
        after={diff?.after || ''}
        onApply={applyDiff}
        onClose={() => setDiff(null)}
      />

      {toast && (
        <div className="toast" key={toast.id}>
          <Icon name="check" size={13} />
          {toast.msg}
        </div>
      )}
    </div>
  )
}
