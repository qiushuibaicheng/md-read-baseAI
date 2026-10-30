import { useMemo } from 'react'
import { buildDiff, diffStat } from '../lib/ai'
import { Icon } from './Icons'

interface Props {
  open: boolean
  title: string
  before: string
  after: string
  onApply: () => void
  onClose: () => void
}

export default function DiffDialog({ open, title, before, after, onApply, onClose }: Props) {
  const lines = useMemo(() => (open ? buildDiff(before, after) : []), [open, before, after])
  const stat = useMemo(() => diffStat(lines), [lines])
  if (!open) return null

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="diff-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="diff-head">
          <div className="diff-title">
            <Icon name="diff" size={15} />
            <span>应用前确认 · {title || '当前文档'}</span>
          </div>
          <div className="diff-stats">
            <span className="stat-add">+{stat.add}</span>
            <span className="stat-del">−{stat.del}</span>
          </div>
          <button className="icon-btn tiny" onClick={onClose}>
            <Icon name="close" size={13} />
          </button>
        </header>

        <div className="diff-body">
          {lines.length === 0 && <div className="diff-empty">没有差异</div>}
          {lines.map((l, i) =>
            l.type === 'hunk' ? (
              <div key={i} className="diff-hunk">
                {l.text}
              </div>
            ) : (
              <div key={i} className={`diff-line is-${l.type}`}>
                <span className="diff-sign">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ''}</span>
                <span className="diff-text">{l.text || ' '}</span>
              </div>
            )
          )}
        </div>

        <footer className="diff-foot">
          <span className="diff-note">应用后可用 Ctrl+Z 撤回（仅保留最近一次）</span>
          <div className="diff-actions">
            <button className="btn-ghost" onClick={onClose}>
              取消
            </button>
            <button className="btn-primary" onClick={onApply}>
              <Icon name="check" size={13} /> 应用修改
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
