import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icons'
import { relativeTime } from '../lib/markdown'
import type { ClipItem, DocMeta, Snippet, ViewKey } from '../lib/types'

interface Props {
  view: ViewKey
  setView: (v: ViewKey) => void
  docs: DocMeta[]
  active: string | null
  query: string
  setQuery: (q: string) => void
  onOpen: (path: string) => void
  onNew: (dir?: string) => void
  folders: string[]
  /** 手动排序表：目录相对路径 → 条目相对路径顺序 */
  order: Record<string, string[]>
  /** 拖拽落位：kind 区分文档与文件夹，index 是去掉被拖项之后的目标下标 */
  onArrange: (payload: { kind: 'doc' | 'dir'; path: string; targetDir: string; index: number }) => void
  onMove: (path: string, targetDir: string) => void
  onNewFolder: (parent: string | undefined, name: string) => Promise<boolean>
  onRevealFolder: (rel: string) => void
  onRenameFolder: (rel: string, name: string) => void
  onDeleteFolder: (rel: string) => void
  onDelete: (path: string) => void
  onRename: (path: string, name: string) => void
  onReveal: (path: string) => void
  snippets: Snippet[]
  onAddSnippet: (content: string) => void
  onDeleteSnippet: (id: string) => void
  onRenameSnippet: (id: string, title: string) => void
  onCopy: (text: string, label?: string) => void
  clips: ClipItem[]
  onClearClips: () => void
  onRemoveClip: (id: string) => void
  vaultPath: string
  onOpenSettings: () => void
}

const dirOf = (path: string) => {
  const cut = path.lastIndexOf('/')
  return cut >= 0 ? path.slice(0, cut) : ''
}
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const depthOf = (path: string) => path.split('/').length - 1

interface FolderNode {
  path: string
  name: string
  dirs: FolderNode[]
  docs: DocMeta[]
  /** 文件夹与文档混排后的最终顺序 */
  entries: Entry[]
}
type Entry = { kind: 'dir'; path: string; node: FolderNode } | { kind: 'doc'; path: string; doc: DocMeta }
type DropSpot = { mode: 'inside'; dir: string } | { mode: 'line'; dir: string; index: number }

const TABS: { key: ViewKey; label: string; icon: string }[] = [
  { key: 'notes', label: '文档', icon: 'doc' },
  { key: 'snippets', label: '片段', icon: 'snippet' },
  { key: 'clipboard', label: '剪贴板', icon: 'clipboard' }
]

/** 按 order 表排，没登记过的排在后面：文件夹优先，再按名称 */
function sortEntries(node: FolderNode, order: Record<string, string[]>) {
  const pref = order[node.path] || []
  const rank = (p: string) => {
    const i = pref.indexOf(p)
    return i < 0 ? Number.MAX_SAFE_INTEGER : i
  }
  const all: Entry[] = [
    ...node.dirs.map((n) => ({ kind: 'dir' as const, path: n.path, node: n })),
    ...node.docs.map((d) => ({ kind: 'doc' as const, path: d.path, doc: d }))
  ]
  all.sort((a, b) => {
    const ra = rank(a.path)
    const rb = rank(b.path)
    if (ra !== rb) return ra - rb
    const ka = a.kind === 'dir' ? 0 : 1
    const kb = b.kind === 'dir' ? 0 : 1
    if (ka !== kb) return ka - kb
    const na = a.kind === 'dir' ? a.node.name : a.doc.name
    const nb = b.kind === 'dir' ? b.node.name : b.doc.name
    return na.localeCompare(nb, 'zh-Hans-CN')
  })
  node.entries = all
  node.dirs.forEach((n) => sortEntries(n, order))
}

export default function Sidebar(props: Props) {
  const { view, setView, docs, active, query, setQuery } = props
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [snippetDraft, setSnippetDraft] = useState('')
  const [editingSnippet, setEditingSnippet] = useState<string | null>(null)
  const [snippetTitle, setSnippetTitle] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [newMenu, setNewMenu] = useState(false)
  const [newFolderIn, setNewFolderIn] = useState<string | null>(null)
  const [folderDraft, setFolderDraft] = useState('')
  /** 正在拖的条目（文档或文件夹） */
  const [drag, setDrag] = useState<{ kind: 'doc' | 'dir'; path: string } | null>(null)
  /** 落点：插到某目录的第 index 位，或放进某个文件夹 */
  const [drop, setDrop] = useState<DropSpot | null>(null)
  const [moveMenu, setMoveMenu] = useState<{ path: string; x: number; y: number } | null>(null)
  const [folderMenu, setFolderMenu] = useState<{ path: string; x: number; y: number } | null>(null)
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null)
  const [folderRenameDraft, setFolderRenameDraft] = useState('')
  const snippetRef = useRef<HTMLTextAreaElement | null>(null)

  const activeDir = active ? dirOf(active) : ''

  // 打开文档时把它所在的文件夹展开，否则侧栏里根本看不见当前文件
  useEffect(() => {
    if (!active || !activeDir) return
    const parts = activeDir.split('/')
    const chain: string[] = []
    parts.reduce((acc, p) => {
      const next = acc ? `${acc}/${p}` : p
      chain.push(next)
      return next
    }, '')
    setCollapsed((prev) => {
      if (!chain.some((p) => prev.has(p))) return prev
      const next = new Set(prev)
      chain.forEach((p) => next.delete(p))
      return next
    })
  }, [active, activeDir])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return docs
    return docs.filter((d) => d.title.toLowerCase().includes(q) || d.name.toLowerCase().includes(q))
  }, [docs, query])

  const { root, nodes } = useMemo(() => {
    const map = new Map<string, FolderNode>()
    const base: FolderNode = { path: '', name: '', dirs: [], docs: [], entries: [] }
    map.set('', base)
    const ensure = (path: string): FolderNode => {
      const hit = map.get(path)
      if (hit) return hit
      const cut = path.lastIndexOf('/')
      const parent = ensure(cut >= 0 ? path.slice(0, cut) : '')
      const node: FolderNode = { path, name: cut >= 0 ? path.slice(cut + 1) : path, dirs: [], docs: [], entries: [] }
      parent.dirs.push(node)
      map.set(path, node)
      return node
    }
    props.folders.forEach(ensure)
    const placed = new Set<string>()
    filtered.forEach((d) => {
      if (placed.has(d.path)) return
      placed.add(d.path)
      const cut = d.path.lastIndexOf('/')
      ensure(cut >= 0 ? d.path.slice(0, cut) : '').docs.push(d)
    })
    sortEntries(base, props.order)
    return { root: base, nodes: map }
  }, [props.folders, filtered, props.order])

  const totalDocs = (node: FolderNode): number =>
    node.docs.length + node.dirs.reduce((sum, c) => sum + totalDocs(c), 0)

  const toggleFolder = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const submitFolder = async (parent: string) => {
    const name = folderDraft.trim()
    if (!name) {
      setNewFolderIn(null)
      return
    }
    const ok = await props.onNewFolder(parent || undefined, name)
    if (ok) {
      setNewFolderIn(null)
      setFolderDraft('')
    }
  }

  const startRename = (doc: DocMeta) => {
    setRenaming(doc.path)
    setDraft(doc.name.replace(/\.md$/i, ''))
  }

  const commitRename = (path: string) => {
    if (draft.trim()) props.onRename(path, draft.trim())
    setRenaming(null)
  }

  // ---------------------------------------------------------------- 拖拽
  /** 不能拖进自己，也不能拖进自己的子孙目录 */
  const canDropInto = (targetDir: string) => {
    if (!drag) return false
    if (targetDir === drag.path) return false
    if (drag.kind === 'dir' && targetDir.startsWith(`${drag.path}/`)) return false
    return true
  }

  const beginDrag = (kind: 'doc' | 'dir', path: string, e: React.DragEvent) => {
    setDrag({ kind, path })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', path)
  }

  const endDrag = () => {
    setDrag(null)
    setDrop(null)
  }

  const commitDrop = (spot: DropSpot | null) => {
    const src = drag
    setDrag(null)
    setDrop(null)
    if (!src || !spot) return
    if (spot.mode === 'inside') {
      if (!canDropInto(spot.dir)) return
      props.onArrange({ kind: src.kind, path: src.path, targetDir: spot.dir, index: 0 })
      return
    }
    const node = nodes.get(spot.dir)
    if (!node) return
    // spot.index 是「还包含被拖项」的列表下标，先把它摘出去再定位
    const index =
      dirOf(src.path) === spot.dir
        ? node.entries.slice(0, spot.index).filter((e) => e.path !== src.path).length
        : spot.index
    props.onArrange({ kind: src.kind, path: src.path, targetDir: spot.dir, index })
  }

  /** 文档行：上半插入到它前面，下半插入到它后面 */
  const spotOnDoc = (e: React.DragEvent<HTMLDivElement>, parentDir: string, index: number): DropSpot => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientY - rect.top) / Math.max(1, rect.height)
    return { mode: 'line', dir: parentDir, index: ratio < 0.5 ? index : index + 1 }
  }

  /** 文件夹行：上 28% 插到前面、下 28% 插到后面、中间放进文件夹 */
  const spotOnFolder = (
    e: React.DragEvent<HTMLDivElement>,
    node: FolderNode,
    parentDir: string,
    index: number
  ): DropSpot | null => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientY - rect.top) / Math.max(1, rect.height)
    if (ratio < 0.28) return canDropInto(parentDir) ? { mode: 'line', dir: parentDir, index } : null
    if (ratio > 0.72) return canDropInto(parentDir) ? { mode: 'line', dir: parentDir, index: index + 1 } : null
    return canDropInto(node.path) ? { mode: 'inside', dir: node.path } : null
  }

  const renderLine = (dirPath: string, index: number, depth: number) => {
    if (!drop || drop.mode !== 'line' || drop.dir !== dirPath || drop.index !== index) return null
    return <div className="drop-line" style={{ marginLeft: 10 + depth * 13 }} />
  }

  // ---------------------------------------------------------------- 渲染
  const renderDoc = (doc: DocMeta, parentDir: string, index: number, depth: number) => (
    <div
      key={doc.path}
      className={`doc-item${active === doc.path ? ' is-active' : ''}${drag?.path === doc.path ? ' is-dragging' : ''}`}
      style={depth ? { paddingLeft: 10 + depth * 13 } : undefined}
      onClick={() => props.onOpen(doc.path)}
      onDoubleClick={() => startRename(doc)}
      draggable
      onDragStart={(e) => beginDrag('doc', doc.path, e)}
      onDragEnd={endDrag}
      onDragOver={(e) => {
        if (!drag) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'move'
        setDrop(spotOnDoc(e, parentDir, index))
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        commitDrop(spotOnDoc(e, parentDir, index))
      }}
      title={doc.path}
    >
      <div className="doc-icon">
        <Icon name="doc" size={15} />
      </div>
      <div className="doc-main">
        {renaming === doc.path ? (
          <input
            className="rename-input"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => commitRename(doc.path)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename(doc.path)
              if (e.key === 'Escape') setRenaming(null)
            }}
          />
        ) : (
          <div className="doc-title">{doc.title}</div>
        )}
        <div className="doc-meta">
          {(() => {
            const base = doc.name.replace(/\.(md|markdown|mdx|txt)$/i, '')
            return base === doc.title ? relativeTime(doc.mtime) : `${base} · ${relativeTime(doc.mtime)}`
          })()}
        </div>
      </div>
      <div className="doc-actions">
        <button
          className="icon-btn tiny"
          title="重命名"
          onClick={(e) => {
            e.stopPropagation()
            startRename(doc)
          }}
        >
          <Icon name="pencil" size={12} />
        </button>
        <button
          className="icon-btn tiny"
          title="移动到文件夹"
          onClick={(e) => {
            e.stopPropagation()
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setMoveMenu({
              path: doc.path,
              x: Math.min(rect.left - 150, window.innerWidth - 216),
              y: Math.min(rect.bottom + 4, window.innerHeight - 320)
            })
          }}
        >
          <Icon name="move" size={12} />
        </button>
        <button
          className="icon-btn tiny"
          title="在文件夹中显示"
          onClick={(e) => {
            e.stopPropagation()
            props.onReveal(doc.path)
          }}
        >
          <Icon name="folder" size={12} />
        </button>
        <button
          className="icon-btn tiny danger"
          title="删除（移到回收站）"
          onClick={(e) => {
            e.stopPropagation()
            props.onDelete(doc.path)
          }}
        >
          <Icon name="trash" size={12} />
        </button>
      </div>
    </div>
  )

  const renderFolderInput = (parent: string, depth: number) => (
    <div className="folder-new" style={{ paddingLeft: 12 + depth * 13 }}>
      <Icon name="folder" size={13} />
      <input
        autoFocus
        value={folderDraft}
        placeholder="文件夹名，Enter 确认"
        onChange={(e) => setFolderDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submitFolder(parent)
          if (e.key === 'Escape') {
            setNewFolderIn(null)
            setFolderDraft('')
          }
        }}
        onBlur={() => {
          if (!folderDraft.trim()) setNewFolderIn(null)
        }}
      />
    </div>
  )

  const renderDir = (node: FolderNode, parentDir: string, index: number, depth: number) => {
    const open = !collapsed.has(node.path)
    const isDrop = drop?.mode === 'inside' && drop.dir === node.path
    const holdsActive = activeDir === node.path || activeDir.startsWith(`${node.path}/`)
    return (
      <div className="folder-block">
        <div
          className={`folder-row${open ? ' is-open' : ''}${isDrop ? ' is-drop' : ''}${holdsActive ? ' has-active' : ''}${
            drag?.path === node.path ? ' is-dragging' : ''
          }`}
          style={{ paddingLeft: 8 + depth * 13 }}
          onClick={() => toggleFolder(node.path)}
          draggable
          onDragStart={(e) => beginDrag('dir', node.path, e)}
          onDragEnd={endDrag}
          onDragOver={(e) => {
            if (!drag) return
            const spot = spotOnFolder(e, node, parentDir, index)
            if (!spot) return
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = 'move'
            setDrop(spot)
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            commitDrop(spotOnFolder(e, node, parentDir, index))
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setFolderMenu({
              path: node.path,
              x: Math.min(e.clientX, window.innerWidth - 200),
              y: Math.min(e.clientY, window.innerHeight - 220)
            })
          }}
          title={`${node.path}（拖动可移动/排序）`}
        >
          <span className="folder-caret">
            <Icon name="chevron" size={12} />
          </span>
          <span className="folder-icon">
            <Icon name={open ? 'folder-open' : 'folder'} size={15} />
          </span>
          {renamingFolder === node.path ? (
            <input
              className="rename-input"
              autoFocus
              value={folderRenameDraft}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setFolderRenameDraft(e.target.value)}
              onBlur={() => {
                if (folderRenameDraft.trim()) props.onRenameFolder(node.path, folderRenameDraft.trim())
                setRenamingFolder(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (folderRenameDraft.trim()) props.onRenameFolder(node.path, folderRenameDraft.trim())
                  setRenamingFolder(null)
                }
                if (e.key === 'Escape') setRenamingFolder(null)
              }}
            />
          ) : (
            <span className="folder-name">{node.name}</span>
          )}
          <span className="folder-count">{totalDocs(node) || ''}</span>
          <span className="folder-actions">
            <button
              className="icon-btn tiny"
              title="在此新建文档"
              onClick={(e) => {
                e.stopPropagation()
                setCollapsed((prev) => {
                  const next = new Set(prev)
                  next.delete(node.path)
                  return next
                })
                props.onNew(node.path)
              }}
            >
              <Icon name="plus" size={12} />
            </button>
            <button
              className="icon-btn tiny"
              title="新建子文件夹"
              onClick={(e) => {
                e.stopPropagation()
                setFolderDraft('')
                setNewFolderIn(node.path)
                setCollapsed((prev) => {
                  const next = new Set(prev)
                  next.delete(node.path)
                  return next
                })
              }}
            >
              <Icon name="folder-plus" size={12} />
            </button>
            <button
              className="icon-btn tiny"
              title="在资源管理器中打开"
              onClick={(e) => {
                e.stopPropagation()
                props.onRevealFolder(node.path)
              }}
            >
              <Icon name="external" size={12} />
            </button>
          </span>
        </div>
        {open && (
          <>
            {newFolderIn === node.path && renderFolderInput(node.path, depth + 1)}
            {renderEntries(node, depth + 1)}
          </>
        )}
      </div>
    )
  }

  const renderEntries = (node: FolderNode, depth: number): React.ReactNode => (
    <>
      {node.entries.map((entry, i) => (
        <Fragment key={entry.path}>
          {renderLine(node.path, i, depth)}
          {entry.kind === 'dir'
            ? renderDir(entry.node, node.path, i, depth)
            : renderDoc(entry.doc, node.path, i, depth)}
        </Fragment>
      ))}
      {renderLine(node.path, node.entries.length, depth)}
    </>
  )

  return (
    <aside className="sidebar">
      <div className="segmented">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`seg-btn${view === t.key ? ' is-active' : ''}`}
            onClick={() => setView(t.key)}
            title={t.label}
          >
            <Icon name={t.icon} size={14} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {view === 'notes' && (
        <>
          <div className="sidebar-tools">
            <div className="search-field">
              <Icon name="search" size={14} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="筛选文档" />
              {query && (
                <button className="icon-btn tiny" onClick={() => setQuery('')} title="清空">
                  <Icon name="close" size={12} />
                </button>
              )}
            </div>
            <div className="new-wrap">
              <button
                className={`icon-btn accent${newMenu ? ' is-on' : ''}`}
                onClick={() => setNewMenu((v) => !v)}
                title="新建文档 / 文件夹"
              >
                <Icon name="plus" size={16} />
              </button>
              {newMenu && (
                <>
                  <div className="menu-backdrop" onClick={() => setNewMenu(false)} />
                  <div className="new-menu">
                    <div className="new-menu-head">新建到根目录</div>
                    <button
                      onClick={() => {
                        setNewMenu(false)
                        props.onNew(undefined)
                      }}
                    >
                      <Icon name="doc" size={12} /> 新建文档 <em>根目录</em>
                    </button>
                    <button
                      onClick={() => {
                        setNewMenu(false)
                        setFolderDraft('')
                        setNewFolderIn('')
                      }}
                    >
                      <Icon name="folder-plus" size={12} /> 新建文件夹 <em>根目录</em>
                    </button>
                    {activeDir && (
                      <>
                        <div className="new-menu-sep" />
                        <div className="new-menu-head">新建到「{baseName(activeDir)}」</div>
                        <button
                          onClick={() => {
                            setNewMenu(false)
                            props.onNew(activeDir)
                          }}
                        >
                          <Icon name="doc" size={12} /> 新建文档 <em>{baseName(activeDir)}</em>
                        </button>
                        <button
                          onClick={() => {
                            setNewMenu(false)
                            setFolderDraft('')
                            setNewFolderIn(activeDir)
                          }}
                        >
                          <Icon name="folder-plus" size={12} /> 新建文件夹 <em>{baseName(activeDir)}</em>
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          <div
            className={`list${drag ? ' is-arranging' : ''}`}
            onDragOver={(e) => {
              // 落在空白处 = 排到根目录末尾
              if (!drag || !canDropInto('')) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setDrop({ mode: 'line', dir: '', index: root.entries.length })
            }}
            onDrop={(e) => {
              if (!drag) return
              e.preventDefault()
              // 落在空白处 = 排到根目录末尾
              commitDrop(canDropInto('') ? { mode: 'line', dir: '', index: root.entries.length } : null)
            }}
          >
            {newFolderIn === '' && renderFolderInput('', 0)}
            {filtered.length === 0 && props.folders.length === 0 && <div className="empty-hint">没有匹配的文档</div>}
            {renderEntries(root, 0)}
            {drag && <div className="root-drop-hint">拖到空白处 = 移到根目录末尾</div>}
          </div>
        </>
      )}

      {view === 'snippets' && (
        <>
          <div className="snippet-compose">
            <textarea
              ref={snippetRef}
              value={snippetDraft}
              onChange={(e) => setSnippetDraft(e.target.value)}
              placeholder="粘贴要反复使用的文本…&#10;Ctrl+Enter 保存"
              rows={3}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  if (snippetDraft.trim()) {
                    props.onAddSnippet(snippetDraft.trim())
                    setSnippetDraft('')
                  }
                }
              }}
            />
            <button
              className="btn-primary full"
              disabled={!snippetDraft.trim()}
              onClick={() => {
                props.onAddSnippet(snippetDraft.trim())
                setSnippetDraft('')
                snippetRef.current?.focus()
              }}
            >
              <Icon name="plus" size={14} /> 存为片段
            </button>
          </div>
          <div className="list">
            {props.snippets.length === 0 && <div className="empty-hint">还没有片段，先存一条常用命令试试</div>}
            {props.snippets.map((s) => (
              <div
                key={s.id}
                className="snippet-card"
                onClick={() => props.onCopy(s.content, '片段已复制')}
                title="点击复制"
              >
                {editingSnippet === s.id ? (
                  <input
                    className="rename-input"
                    autoFocus
                    value={snippetTitle}
                    onChange={(e) => setSnippetTitle(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => {
                      props.onRenameSnippet(s.id, snippetTitle.trim() || s.title)
                      setEditingSnippet(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        props.onRenameSnippet(s.id, snippetTitle.trim() || s.title)
                        setEditingSnippet(null)
                      }
                      if (e.key === 'Escape') setEditingSnippet(null)
                    }}
                  />
                ) : (
                  <div className="snippet-title">{s.title}</div>
                )}
                <div className="snippet-body">{s.content}</div>
                <div className="snippet-foot">
                  <span>{relativeTime(s.createdAt)}</span>
                  <div className="doc-actions always">
                    <button
                      className="icon-btn tiny"
                      title="重命名"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingSnippet(s.id)
                        setSnippetTitle(s.title)
                      }}
                    >
                      <Icon name="pencil" size={12} />
                    </button>
                    <button
                      className="icon-btn tiny danger"
                      title="删除"
                      onClick={(e) => {
                        e.stopPropagation()
                        props.onDeleteSnippet(s.id)
                      }}
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {view === 'clipboard' && (
        <>
          <div className="sidebar-tools">
            <div className="clip-hint">自动记录最近复制的文本</div>
            <button className="icon-btn tiny" title="清空历史" onClick={props.onClearClips}>
              <Icon name="trash" size={13} />
            </button>
          </div>
          <div className="list">
            {props.clips.length === 0 && <div className="empty-hint">复制任意文本后，会出现在这里</div>}
            {props.clips.map((c) => (
              <div key={c.id} className="clip-item" onClick={() => props.onCopy(c.text, '已复制')} title="点击复制">
                <div className="clip-text">{c.text}</div>
                <div className="clip-foot">
                  <span>{relativeTime(c.time)}</span>
                  <div className="doc-actions always">
                    <button
                      className="icon-btn tiny danger"
                      title="删除"
                      onClick={(e) => {
                        e.stopPropagation()
                        props.onRemoveClip(c.id)
                      }}
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="sidebar-foot">
        <button className="vault-btn" onClick={props.onOpenSettings} title={`${props.vaultPath}（点击打开设置）`}>
          <Icon name="folder" size={13} />
          <span>{props.vaultPath.split(/[\\/]/).filter(Boolean).pop() || 'Inkwell'}</span>
        </button>
        <button className="icon-btn" onClick={() => props.onRevealFolder('')} title="在资源管理器中打开笔记目录">
          <Icon name="external" size={14} />
        </button>
        <button className="icon-btn" onClick={props.onOpenSettings} title="设置 (Ctrl+,)">
          <Icon name="settings" size={15} />
        </button>
      </div>

      {moveMenu && (
        <>
          <div className="menu-backdrop" onClick={() => setMoveMenu(null)} />
          <div className="side-menu" style={{ left: moveMenu.x, top: moveMenu.y }}>
            <div className="side-menu-title">移动到</div>
            <button
              disabled={dirOf(moveMenu.path) === ''}
              onClick={() => {
                const p = moveMenu.path
                setMoveMenu(null)
                props.onMove(p, '')
              }}
            >
              <Icon name="doc" size={12} /> 根目录
              {dirOf(moveMenu.path) === '' && <em>当前</em>}
            </button>
            {props.folders.map((f) => (
              <button
                key={f}
                disabled={dirOf(moveMenu.path) === f}
                style={{ paddingLeft: 12 + depthOf(f) * 10 }}
                onClick={() => {
                  const p = moveMenu.path
                  setMoveMenu(null)
                  props.onMove(p, f)
                }}
              >
                <Icon name="folder" size={12} /> {baseName(f)}
                {dirOf(moveMenu.path) === f && <em>当前</em>}
              </button>
            ))}
            {props.folders.length === 0 && <div className="side-menu-empty">还没有文件夹，先在右上角 ＋ 里新建</div>}
          </div>
        </>
      )}

      {folderMenu && (
        <>
          <div className="menu-backdrop" onClick={() => setFolderMenu(null)} />
          <div className="side-menu" style={{ left: folderMenu.x, top: folderMenu.y }}>
            <div className="side-menu-title">{baseName(folderMenu.path)}</div>
            <button
              onClick={() => {
                const p = folderMenu.path
                setFolderMenu(null)
                setCollapsed((prev) => {
                  const next = new Set(prev)
                  next.delete(p)
                  return next
                })
                props.onNew(p)
              }}
            >
              <Icon name="plus" size={12} /> 新建文档
            </button>
            <button
              onClick={() => {
                setFolderDraft('')
                setNewFolderIn(folderMenu.path)
                setCollapsed((prev) => {
                  const next = new Set(prev)
                  next.delete(folderMenu!.path)
                  return next
                })
                setFolderMenu(null)
              }}
            >
              <Icon name="folder-plus" size={12} /> 新建子文件夹
            </button>
            <button
              onClick={() => {
                setFolderRenameDraft(baseName(folderMenu.path))
                setRenamingFolder(folderMenu.path)
                setFolderMenu(null)
              }}
            >
              <Icon name="pencil" size={12} /> 重命名
            </button>
            <button
              onClick={() => {
                props.onRevealFolder(folderMenu.path)
                setFolderMenu(null)
              }}
            >
              <Icon name="external" size={12} /> 在资源管理器中打开
            </button>
            <button
              className="danger"
              onClick={() => {
                props.onDeleteFolder(folderMenu.path)
                setFolderMenu(null)
              }}
            >
              <Icon name="trash" size={12} /> 删除文件夹（需为空）
            </button>
          </div>
        </>
      )}
    </aside>
  )
}
