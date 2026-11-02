import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

interface Props {
  /** 编辑器全文 */
  text: string
  /** 被测量的 textarea */
  target: RefObject<HTMLTextAreaElement | null>
}

/**
 * 编辑器左侧的行号。
 *
 * 难点是软换行：一个逻辑行可能折成好几行，折行之后下面所有行的位置都会往下推，
 * 所以不能简单地用「行号 × 行高」定位。这里用一个隐藏的镜像元素按 textarea 的
 * 宽度和字体把每行重新排版一遍，读回真实的 offsetTop，再据此绝对定位行号。
 *
 * 行号只渲染视口附近的那几十个，长文档也不会堆出几千个节点。
 */
export default function EditorGutter({ text, target }: Props) {
  const mirrorRef = useRef<HTMLDivElement | null>(null)
  const [tops, setTops] = useState<number[]>([])
  const [padTop, setPadTop] = useState(24)
  const [lineH, setLineH] = useState(24)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(0)
  const [width, setWidth] = useState(0)

  // 跟随 textarea 的滚动与尺寸
  useEffect(() => {
    const ta = target.current
    if (!ta) return
    const sync = () => {
      setScrollTop(ta.scrollTop)
      setViewH(ta.clientHeight)
      setWidth(ta.clientWidth)
    }
    sync()
    ta.addEventListener('scroll', sync, { passive: true })
    const ro = new ResizeObserver(sync)
    ro.observe(ta)
    return () => {
      ta.removeEventListener('scroll', sync)
      ro.disconnect()
    }
  }, [target])

  // 按 textarea 的排版参数重建镜像，读回每行的纵坐标
  useLayoutEffect(() => {
    const ta = target.current
    const mirror = mirrorRef.current
    if (!ta || !mirror || !width) return

    const cs = getComputedStyle(ta)
    mirror.style.width = `${ta.clientWidth}px`
    mirror.style.fontFamily = cs.fontFamily
    mirror.style.fontSize = cs.fontSize
    mirror.style.fontWeight = cs.fontWeight
    mirror.style.lineHeight = cs.lineHeight
    mirror.style.letterSpacing = cs.letterSpacing
    mirror.style.paddingLeft = cs.paddingLeft
    mirror.style.paddingRight = cs.paddingRight
    mirror.style.tabSize = cs.tabSize

    const frag = document.createDocumentFragment()
    for (const line of text.split('\n')) {
      const row = document.createElement('div')
      // 空行没有内容就量不出高度，垫一个零宽字符占位
      row.textContent = line === '' ? '\u200b' : line
      frag.appendChild(row)
    }
    mirror.replaceChildren(frag)

    const next: number[] = []
    for (const row of Array.from(mirror.children)) {
      next.push((row as HTMLElement).offsetTop)
    }
    setTops(next)
    setPadTop(parseFloat(cs.paddingTop) || 0)
    setLineH(parseFloat(cs.lineHeight) || 24)
  }, [text, width, target])

  // 只渲染视口附近的行号
  const gutters: { n: number; top: number }[] = []
  const top = scrollTop - lineH * 3
  const bottom = scrollTop + Math.max(viewH, 400) + lineH * 3
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] < top) continue
    if (tops[i] > bottom) break
    gutters.push({ n: i + 1, top: tops[i] + padTop })
  }

  return (
    <div className="editor-gutter" aria-hidden="true">
      <div className="editor-gutter-inner" style={{ transform: `translateY(${-scrollTop}px)` }}>
        {gutters.map((g) => (
          <span key={g.n} className="editor-gutter-n" style={{ top: g.top }}>
            {g.n}
          </span>
        ))}
      </div>
      <div className="editor-mirror" ref={mirrorRef} />
    </div>
  )
}
