import { useMemo, useRef, useState } from 'react'
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
  onNew: () => void
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

const TABS: { key: ViewKey; label: string; icon: string }[] = [
  { key: 'notes', label: '文档', icon: 'doc' },
  { key: 'snippets', label: '片段', icon: 'snippet' },
  { key: 'clipboard', label: '剪贴板', icon: 'clipboard' }
]

export default function Sidebar(props: Props) {
  const { view, setView, docs, active, query, setQuery } = props
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [snippetDraft, setSnippetDraft] = useState('')
  const [editingSnippet, setEditingSnippet] = useState<string | null>(null)
  const [snippetTitle, setSnippetTitle] = useState('')
  const snippetRef = useRef<HTMLTextAreaElement | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return docs
    return docs.filter((d) => d.title.toLowerCase().includes(q) || d.name.toLowerCase().includes(q))
  }, [docs, query])

  const startRename = (doc: DocMeta) => {
    setRenaming(doc.path)
    setDraft(doc.name.replace(/\.md$/i, ''))
  }

  const commitRename = (path: string) => {
    if (draft.trim()) props.onRename(path, draft.trim())
    setRenaming(null)
  }

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
            <button className="icon-btn accent" onClick={props.onNew} title="新建文档 (Ctrl+N)">
              <Icon name="plus" size={16} />
            </button>
          </div>

          <div className="list">
            {filtered.length === 0 && <div className="empty-hint">没有匹配的文档</div>}
            {filtered.map((doc) => (
              <div
                key={doc.path}
                className={`doc-item${active === doc.path ? ' is-active' : ''}`}
                onClick={() => props.onOpen(doc.path)}
                onDoubleClick={() => startRename(doc)}
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
            ))}
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
        <button className="vault-btn" onClick={props.onOpenSettings} title={props.vaultPath}>
          <Icon name="folder" size={13} />
          <span>{props.vaultPath.split(/[\\/]/).filter(Boolean).pop() || 'Inkwell'}</span>
        </button>
        <button className="icon-btn" onClick={props.onOpenSettings} title="设置 (Ctrl+,)">
          <Icon name="settings" size={15} />
        </button>
      </div>
    </aside>
  )
}
