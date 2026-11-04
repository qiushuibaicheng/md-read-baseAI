import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

interface Props {
  /** 编辑器全文 */
  text: string
  /** 被测量的 textarea */
  target: RefObject<HTMLTextAreaElement | null>
}

/**
 * 只把 [from, to) 这几行塞进镜像里排版，读回每行的高度。
 *
 * 不用 offsetTop：它会把小数行高取整（13.5px × 1.82 = 24.57 → 25），
 * 几千行累加下来能偏出几百像素。用 getBoundingClientRect 的相邻差，
 * 拿到的是真实的小数高度，累加回去和 textarea 自己的排版一致。
 */
function measure(mirror: HTMLDivElement, lines: string[], from: number, to: number): number[] {
  const frag = document.createDocumentFragment()
  for (let i = from; i < to; i++) {
    const row = document.createElement('div')
    // 空行没有内容就量不出高度，垫一个零宽字符占位
    row.textContent = lines[i] === '' ? '\u200b' : lines[i]
    frag.appendChild(row)
  }
  mirror.replaceChildren(frag)
  const boxes = Array.from(mirror.children).map((el) => el.getBoundingClientRect())
  const out: number[] = []
  for (let i = 0; i < boxes.length; i++) {
    const bottom = i + 1 < boxes.length ? boxes[i + 1].top : boxes[i].bottom
    out.push(Math.max(bottom - boxes[i].top, 0))
  }
  return out
}

/**
 * 编辑器左侧的行号。
 *
 * 难点是软换行：一个逻辑行可能折成好几行，折行之后下面所有行的位置都会往下推，
 * 所以不能简单地用「行号 × 行高」定位。这里用一个隐藏的镜像元素按 textarea 的
 * 宽度和字体把行重新排版一遍，读回真实高度，再累加成纵坐标。
 *
 * 关键是**只量变动的行**：敲一个字符只需重排 1 行，而不是把几千行全部重来。
 * 改动的范围由新旧文本的公共前后缀算出来，剩下的行沿用上次的高度。
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

  /** 每行的排版高度；软换行后一行可能是好几倍行高 */
  const heights = useRef<number[]>([])
  const prevLines = useRef<string[]>([])
  const prevWidth = useRef(0)

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

    const lines = text.split('\n')
    const old = prevLines.current
    const oldH = heights.current

    // 新旧文本的公共前缀 / 后缀，中间那段才是要重新量的
    let head = 0
    while (head < lines.length && head < old.length && lines[head] === old[head]) head++
    let tailNew = lines.length
    let tailOld = old.length
    while (tailNew > head && tailOld > head && lines[tailNew - 1] === old[tailOld - 1]) {
      tailNew--
      tailOld--
    }

    const changed = tailNew - head
    // 换文档、改窗口宽度、或者改动面积太大时，增量反而不划算
    const rebuild =
      width !== prevWidth.current ||
      oldH.length !== old.length ||
      changed > Math.max(64, lines.length * 0.35)

    let next: number[]
    if (rebuild) {
      next = measure(mirror, lines, 0, lines.length)
    } else if (changed === 0) {
      next = oldH
    } else {
      const fresh = measure(mirror, lines, head, tailNew)
      next = [...oldH.slice(0, head), ...fresh, ...oldH.slice(tailOld)]
    }

    heights.current = next
    prevLines.current = lines
    prevWidth.current = width

    // 累加成每行的纵坐标（几千次加法，比重新排版便宜三个数量级）
    const nextTops = new Array<number>(next.length)
    let y = 0
    for (let i = 0; i < next.length; i++) {
      nextTops[i] = y
      y += next[i]
    }
    setTops(nextTops)
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
