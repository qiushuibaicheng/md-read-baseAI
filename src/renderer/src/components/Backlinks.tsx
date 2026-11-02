import { useState } from 'react'
import { Icon } from './Icons'
import type { DocLinks } from '../lib/types'

interface Props {
  links: DocLinks
  onOpen: (path: string, line?: number) => void
}

/**
 * 预览区底部的引用关系条。
 * 折叠时只占一行，展开后给出出链、入链与断链 —— 和 AI 用的是同一份索引。
 */
export default function Backlinks({ links, onOpen }: Props) {
  const [open, setOpen] = useState(false)

  const out = links.out.filter((e) => e.target.path)
  const bad = links.out.filter(
    (e) => !e.target.path && (e.target.reason === 'broken' || e.target.reason === 'ambiguous')
  )
  const total = out.length + links.inbound.length + bad.length
  if (!total) return null

  return (
    <div className={`backlinks${open ? ' is-open' : ''}`}>
      <button className="backlinks-head" onClick={() => setOpen((v) => !v)} title="引用关系">
        <Icon name="external" size={12} />
        <span className="backlinks-num">引用 {out.length}</span>
        <span className="backlinks-sep">·</span>
        <span className="backlinks-num">被引 {links.inbound.length}</span>
        {bad.length > 0 && (
          <>
            <span className="backlinks-sep">·</span>
            <span className="backlinks-num is-bad">失效 {bad.length}</span>
          </>
        )}
        <span className="backlinks-caret">{open ? '收起' : '展开'}</span>
      </button>

      {open && (
        <div className="backlinks-body">
          {out.length > 0 && (
            <section className="backlinks-group">
              <div className="backlinks-label">本文引用</div>
              {out.map((e, i) => (
                <button
                  key={`o-${i}`}
                  className="backlink-row"
                  onClick={() => onOpen(e.target.path as string, e.line)}
                  title={e.raw}
                >
                  <span className="backlink-arrow">→</span>
                  <span className="backlink-path">{e.target.path}</span>
                  <span className="backlink-meta">第 {e.line} 行</span>
                </button>
              ))}
            </section>
          )}

          {links.inbound.length > 0 && (
            <section className="backlinks-group">
              <div className="backlinks-label">引用本文</div>
              {links.inbound.map((e, i) => (
                <button
                  key={`i-${i}`}
                  className="backlink-row"
                  onClick={() => onOpen(e.path, e.line)}
                  title={e.raw}
                >
                  <span className="backlink-arrow">←</span>
                  <span className="backlink-path">{e.path}</span>
                  <span className="backlink-meta">第 {e.line} 行</span>
                  <span className="backlink-sum">{e.summary}</span>
                </button>
              ))}
            </section>
          )}

          {bad.length > 0 && (
            <section className="backlinks-group">
              <div className="backlinks-label is-bad">失效链接</div>
              {bad.map((e, i) => (
                <div key={`b-${i}`} className="backlink-row is-bad">
                  <span className="backlink-arrow">!</span>
                  <span className="backlink-path">{e.raw}</span>
                  <span className="backlink-meta">
                    第 {e.line} 行 · {e.target.reason === 'ambiguous' ? '有多个同名目标' : '文件不存在'}
                  </span>
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
