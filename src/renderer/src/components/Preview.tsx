import { useEffect, useRef } from 'react'
import { hydrateRich } from '../lib/rich'

/** 链接路径可能被百分号编码过（正文 <a> 的 href 就一定是），比对前统一解码 */
function decodeLoose(s: string) {
  try {
    return decodeURI(s)
  } catch {
    return s
  }
}

/** 锚点跳转：先按 id 找，再按标题文字找（中文标题的锚点通常是文字） */
function jumpToAnchor(key: string) {
  if (!key) return
  const box = document.querySelector('.preview.markdown-body')
  if (!box) return
  const byId = box.querySelector(`#${CSS.escape(key)}`) as HTMLElement | null
  const hit =
    byId ||
    ([...box.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(
      (h) => (h.textContent || '').trim() === key
    ) as HTMLElement | undefined)
  hit?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

interface Props {
  html: string
  fontSize: number
  docKey: string
  theme: 'light' | 'dark'
  /** 本文里按路径解析不到的链接（原始 href），会被标红 */
  broken?: Set<string>
  onCopy: (text: string, label?: string) => void
  onToggleTask: (line: number) => void
  onSelectText: (text: string, rect: { x: number; y: number }) => void
  /** 点击库内文档链接 */
  onDocLink?: (raw: string, anchor?: string, text?: string) => void
}

export default function Preview({
  html,
  fontSize,
  docKey,
  theme,
  broken,
  onCopy,
  onToggleTask,
  onSelectText,
  onDocLink
}: Props) {
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

  // 断链标记：索引已经算好了「哪条路径解析不到」，只是没人画出来。
  // 不标的话它和正常链接同色，点下去才知道坏了。
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    el.querySelectorAll<HTMLAnchorElement>('a[data-doc-link]').forEach((a) => {
      const raw = a.getAttribute('data-doc-link') || ''
      const key = decodeLoose(raw)
      const bad = !!key && !!broken?.has(key)
      a.classList.toggle('is-broken', bad)
      if (bad) a.title = `库里没有这个文件：${key}`
      else a.removeAttribute('title')
    })
  }, [html, broken])

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
      const docLink = anchor.getAttribute('data-doc-link')
      if (docLink) {
        e.preventDefault()
        onDocLink?.(
          docLink,
          anchor.getAttribute('data-doc-anchor') || undefined,
          anchor.textContent || undefined
        )
        return
      }
      const href = anchor.getAttribute('href') || ''
      if (href.startsWith('#')) {
        e.preventDefault()
        jumpToAnchor(href.slice(1))
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
