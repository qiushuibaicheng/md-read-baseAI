import { useEffect, useMemo, useRef } from 'react'
import { renderMarkdown } from '../lib/markdown'
import { hydrateRich } from '../lib/rich'

interface Props {
  text: string
  theme: 'light' | 'dark'
  onCopy: (text: string, label?: string) => void
  className?: string
}

export default function MessageBody({ text, theme, onCopy, className }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const html = useMemo(() => renderMarkdown(text, '').html, [text])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    hydrateRich(el, { theme, onCopy })
  }, [html, theme, onCopy])

  const handleClick = (e: React.MouseEvent) => {
    const btn = (e.target as HTMLElement).closest('[data-copy]') as HTMLElement | null
    if (!btn) return
    const code = btn.closest('.code-block')?.querySelector('code')?.textContent || ''
    onCopy(code, '代码已复制')
    btn.textContent = '已复制'
    setTimeout(() => (btn.textContent = '复制'), 1200)
  }

  return (
    <div
      ref={ref}
      className={`msg-body markdown-body${className ? ` ${className}` : ''}`}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
