import { useEffect, useRef } from 'react'
import { hydrateRich } from '../lib/rich'

interface Props {
  html: string
  fontSize: number
  docKey: string
  theme: 'light' | 'dark'
  onCopy: (text: string, label?: string) => void
  onToggleTask: (line: number) => void
  onSelectText: (text: string, rect: { x: number; y: number }) => void
}

export default function Preview({ html, fontSize, docKey, theme, onCopy, onToggleTask, onSelectText }: Props) {
  const scroller = useRef<HTMLDivElement | null>(null)
  const bar = useRef<HTMLDivElement | null>(null)
  const lastTheme = useRef(theme)

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = 0
  }, [docKey])

  // 富块水合：mermaid / markmap / json
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const force = lastTheme.current !== theme
    lastTheme.current = theme
    hydrateRich(el, { theme, onCopy, force })
  }, [html, theme, onCopy])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight
      const p = max > 0 ? Math.min(1, el.scrollTop / max) : 0
      if (bar.current) bar.current.style.transform = `scaleX(${p})`
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => el.removeEventListener('scroll', onScroll)
  }, [html])

  const handleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement

    const copyBtn = target.closest('[data-copy]') as HTMLElement | null
    if (copyBtn) {
      const block = copyBtn.closest('.code-block')
      const code = block?.querySelector('code')?.innerText || ''
      onCopy(code, '代码已复制')
      copyBtn.classList.add('copied')
      copyBtn.textContent = '已复制'
      setTimeout(() => {
        copyBtn.classList.remove('copied')
        copyBtn.textContent = '复制'
      }, 1400)
      return
    }

    const task = target.closest('[data-task-line]') as HTMLElement | null
    if (task) {
      const line = Number(task.getAttribute('data-task-line'))
      if (line >= 0) onToggleTask(line)
      return
    }

    const anchor = target.closest('a') as HTMLAnchorElement | null
    if (anchor) {
      const href = anchor.getAttribute('href') || ''
      if (href.startsWith('#')) {
        e.preventDefault()
        document.getElementById(href.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } else if (/^https?:/i.test(href)) {
        e.preventDefault()
        window.api.openExternal(href)
      } else {
        e.preventDefault()
      }
    }
  }

  const handleMouseUp = () => {
    const el = scroller.current
    if (!el) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return
    const text = sel.toString().trim()
    if (!text || text.length < 2) return
    const range = sel.getRangeAt(0)
    if (!el.contains(range.commonAncestorContainer)) return
    const rect = range.getBoundingClientRect()
    onSelectText(text.slice(0, 6000), { x: rect.left + rect.width / 2, y: rect.top })
  }

  return (
    <div className="preview-wrap">
      <div className="progress">
        <div className="progress-bar" ref={bar} />
      </div>
      <div
        className="preview markdown-body"
        ref={scroller}
        style={{ fontSize: `${fontSize}px` }}
        onClick={handleClick}
        onMouseUp={handleMouseUp}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
