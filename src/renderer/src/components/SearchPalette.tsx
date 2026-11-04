import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icons'
import { highlightText } from '../lib/markdown'
import type { DocMeta, SearchResult } from '../lib/types'

interface Props {
  open: boolean
  docs: DocMeta[]
  onClose: () => void
  /** line：命中行（1 起），给了就顺带把光标滚到那一行 */
  onOpen: (path: string, line?: number) => void
  onNew: () => void
  onAsk: (query: string, results: SearchResult[]) => void
}

export default function SearchPalette({ open, docs, onClose, onOpen, onNew, onAsk }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [cursor, setCursor] = useState(0)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  /** 请求序号：慢的旧请求回来时不能覆盖新结果 */
  const seq = useRef(0)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults([])
    setCursor(0)
    const t = setTimeout(() => inputRef.current?.focus(), 40)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q) {
      setResults([])
      setBusy(false)
      return
    }
    const mine = ++seq.current
    setBusy(true)
    const timer = setTimeout(async () => {
      const res = await window.api.search(q)
      // 迟到的旧请求：直接丢弃，否则结果会「跳回上一个词」
      if (mine !== seq.current) return
      setResults(res)
      setCursor(0)
      setBusy(false)
    }, 140)
    return () => clearTimeout(timer)
  }, [query, open])

  const recents = useMemo(() => docs.slice(0, 6), [docs])

  const flat = useMemo(() => {
    if (!query.trim()) return recents.map((d) => ({ path: d.path, title: d.title, hits: [] as SearchResult['hits'] }))
    return results
  }, [query, results, recents])

  const choose = (path: string | undefined, line?: number) => {
    if (!path) return
    onOpen(path, line)
    onClose()
  }

  /** 回车打开当前选中项：有命中就落到第一条命中行 */
  const openCursor = () => {
    const item = flat[cursor]
    if (!item) return
    choose(item.path, item.hits?.[0]?.line)
  }

  if (!open) return null

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Icon name="search" size={17} />
          <input
            ref={inputRef}
            value={query}
            placeholder="搜索标题或全文…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor((c) => Math.min(c + 1, Math.max(0, flat.length - 1)))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor((c) => Math.max(0, c - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                openCursor()
              } else if (e.key === 'Tab') {
                e.preventDefault()
                if (query.trim()) onAsk(query.trim(), results)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
              }
            }}
          />
          {busy && <span className="spinner" />}
          <kbd>Esc</kbd>
        </div>

        <div className="palette-body">
          {query.trim() && (
            <button className="palette-ai" onClick={() => onAsk(query.trim(), results)}>
              <span className="palette-ai-mark">
                <Icon name="sparkle" size={13} />
              </span>
              <span className="palette-ai-text">
                用 AI 回答「{query.trim()}」
                <small>检索命中的 {results.length} 篇笔记作为上下文</small>
              </span>
              <kbd>Tab</kbd>
            </button>
          )}
          {!query.trim() && (
            <div className="palette-section">
              <div className="palette-label">最近打开</div>
              {flat.length === 0 && <div className="empty-hint">还没有文档</div>}
              {flat.map((r, i) => (
                <button
                  key={r.path}
                  className={`palette-row${cursor === i ? ' is-active' : ''}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => choose(r.path)}
                >
                  <Icon name="doc" size={15} />
                  <span className="palette-title">{r.title}</span>
                  {r.path.split('/').pop()?.replace(/\.(md|markdown|mdx|txt)$/i, '') !== r.title && (
                    <span className="palette-path">{r.path}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {query.trim() && results.length === 0 && !busy && (
            <div className="empty-hint pad">没有找到包含「{query.trim()}」的内容</div>
          )}

          {query.trim() &&
            results.map((r, i) => (
              <button
                key={r.path}
                className={`palette-row tall${cursor === i ? ' is-active' : ''}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(r.path, r.hits[0]?.line)}
              >
                <Icon name="doc" size={15} />
                <span className="palette-result">
                  <span className="palette-title">{highlightTextJsx(r.title, query.trim())}</span>
                  {r.hits.map((h) => (
                    <span
                      className="palette-hit"
                      key={h.line}
                      role="button"
                      title={`跳到第 ${h.line} 行`}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        // 行本身是按钮，这里要拦下来，否则会走「打开文档开头」
                        e.stopPropagation()
                        e.preventDefault()
                        choose(r.path, h.line)
                      }}
                    >
                      <span className="hit-line">{h.line}</span>
                      <span dangerouslySetInnerHTML={{ __html: highlightText(h.text, query.trim()) }} />
                    </span>
                  ))}
                </span>
              </button>
            ))}
        </div>

        <div className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> 选择
          </span>
          <span>
            <kbd>Enter</kbd> 打开
          </span>
          <span>
            <kbd>Tab</kbd> 问 AI
          </span>
          <button className="link-btn" onClick={onNew}>
            <Icon name="plus" size={12} /> 新建文档
          </button>
        </div>
      </div>
    </div>
  )
}

function highlightTextJsx(text: string, q: string) {
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  )
}
