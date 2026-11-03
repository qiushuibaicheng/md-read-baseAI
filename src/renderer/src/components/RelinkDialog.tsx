import { useMemo } from 'react'
import { Icon } from './Icons'

export interface RelinkChange {
  path: string
  line: number
  from: string
  to: string
}

export interface RelinkSkipped {
  path: string
  line: number
  raw: string
  why: string
}

export interface RelinkReport {
  from: string
  count: number
  files: number
  changes: RelinkChange[]
  skippedItems: RelinkSkipped[]
}

interface Props {
  report: RelinkReport | null
  onUndo: () => void
  onClose: () => void
}

/**
 * 移动/改名后到底改了哪些链接。
 *
 * 自动改写本身是「悄悄改多篇文档」，不给清单的话用户既不知道改没改对，
 * 也不知道该去检查哪几行。这里按文件分组，逐行列出「旧 → 新」。
 */
export default function RelinkDialog({ report, onUndo, onClose }: Props) {
  const groups = useMemo(() => {
    const map = new Map<string, RelinkChange[]>()
    for (const c of report?.changes || []) {
      const list = map.get(c.path) || []
      list.push(c)
      map.set(c.path, list)
    }
    return [...map.entries()].map(([path, list]) => ({
      path,
      list: list.sort((a, b) => a.line - b.line)
    }))
  }, [report])

  if (!report) return null

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="relink-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="diff-head">
          <div className="diff-title">
            <Icon name="history" size={15} />
            <span>自动改写的引用</span>
          </div>
          <div className="diff-stats">
            <span className="relink-stat">
              {report.files} 篇 · {report.count} 处
            </span>
          </div>
          <button className="icon-btn tiny" onClick={onClose}>
            <Icon name="close" size={13} />
          </button>
        </header>

        <div className="relink-body">
          {groups.length === 0 && <div className="diff-empty">这次没有改动任何引用</div>}
          {groups.map((g) => (
            <section className="relink-group" key={g.path}>
              <div className="relink-file">
                <Icon name="doc" size={12} />
                <span>{g.path}</span>
                <span className="relink-count">{g.list.length} 处</span>
              </div>
              {g.list.map((c, i) => (
                <div className="relink-row" key={i}>
                  <span className="relink-line">第 {c.line} 行</span>
                  <code className="relink-old">{c.from}</code>
                  <span className="relink-arrow">→</span>
                  <code className="relink-new">{c.to}</code>
                </div>
              ))}
            </section>
          ))}

          {report.skippedItems.length > 0 && (
            <section className="relink-group">
              <div className="relink-file is-warn">
                <Icon name="alert" size={12} />
                <span>没能自动改写</span>
                <span className="relink-count">{report.skippedItems.length} 处</span>
              </div>
              {report.skippedItems.map((s, i) => (
                <div className="relink-row is-warn" key={i}>
                  <span className="relink-line">{s.path}</span>
                  <code className="relink-old">{s.raw}</code>
                  <span className="relink-why">{s.why}</span>
                </div>
              ))}
            </section>
          )}
        </div>

        <footer className="diff-foot">
          <span className="diff-note">改写只动括号里的路径，显示文字和锚点不变</span>
          <div className="diff-actions">
            <button className="btn-ghost" onClick={onClose}>
              关闭
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                onClose()
                onUndo()
              }}
            >
              <Icon name="history" size={13} /> 撤销这次移动
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
