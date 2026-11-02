import { promises as fsp } from 'fs'
import { join, posix } from 'path'
import type { InboundEdge } from './links'

/**
 * 移动/改名后的链接维护。
 *
 * 严格按路径解析之后，「链接能打开」完全依赖路径写对。文件一挪，路径就错了，
 * 所以移动必须同步改写指向它的链接——这是「不猜」能成立的前提。
 *
 * 只改括号里的路径本身：不动显示文字、不动锚点、不动原文件的换行风格。
 * 靠索引里记的行号 + 行内偏移精确落刀，位置对不上就跳过，绝不模糊替换。
 */

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

export interface RelinkOutcome {
  applied: RelinkChange[]
  skipped: RelinkSkipped[]
  files: number
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/**
 * 算出新的链接写法，没有变化就返回 null。
 * 保留原作者的书写风格：`./` 前缀、`/` 库根写法、有没有 `.md`、有没有 URL 编码。
 */
function relinkRaw(edge: InboundEdge, linkerNew: string, targetNew: string): string | null {
  const oldRaw = edge.raw
  let next: string

  if (oldRaw.startsWith('/')) {
    next = `/${targetNew}`
  } else {
    const rel = posix.relative(dirOf(linkerNew), targetNew)
    // 作者原来写 `./x` 就保持这个风格；但 rel 是往上跳的时候不能拼成 `./../x`
    next = oldRaw.startsWith('./') && !rel.startsWith('..') ? `./${rel}` : rel
  }

  if (!/\.md$/i.test(oldRaw)) next = next.replace(/\.md$/i, '')
  if (/%[0-9a-f]{2}/i.test(oldRaw)) {
    try {
      next = encodeURI(next)
    } catch {
      /* 编码失败就保持明文 */
    }
  }

  return next === oldRaw ? null : next
}

/** 把某一篇文件上的改动批量落盘，返回实际改成功的条目 */
async function applyToFile(
  root: string,
  rel: string,
  list: (RelinkChange & { col: number })[]
): Promise<{ applied: RelinkChange[]; skipped: RelinkSkipped[] }> {
  const applied: RelinkChange[] = []
  const skipped: RelinkSkipped[] = []

  let text: string
  try {
    text = await fsp.readFile(join(root, rel), 'utf8')
  } catch {
    for (const c of list) skipped.push({ path: rel, line: c.line, raw: c.from, why: '读不到这个文件' })
    return { applied, skipped }
  }

  const lines = text.split('\n')
  // 同一行有多处改动时，从右往左替换，前面的偏移量才不会被搅乱
  const ordered = [...list].sort((a, b) => a.line - b.line || b.col - a.col)
  let touched = false

  for (const c of ordered) {
    const idx = c.line - 1
    const line = lines[idx]
    if (line == null) {
      skipped.push({ path: rel, line: c.line, raw: c.from, why: '行号超出文件范围' })
      continue
    }
    if (line.slice(c.col, c.col + c.from.length) === c.from) {
      lines[idx] = line.slice(0, c.col) + c.to + line.slice(c.col + c.from.length)
      applied.push({ path: rel, line: c.line, from: c.from, to: c.to })
      touched = true
      continue
    }
    // 索引之后文件被外部改过，位置漂了。只在整行唯一出现时才敢动
    const at = line.indexOf(c.from)
    if (at >= 0 && line.indexOf(c.from, at + 1) < 0) {
      lines[idx] = line.slice(0, at) + c.to + line.slice(at + c.from.length)
      applied.push({ path: rel, line: c.line, from: c.from, to: c.to })
      touched = true
      continue
    }
    skipped.push({ path: rel, line: c.line, raw: c.from, why: '原文和索引记录对不上' })
  }

  if (touched) await fsp.writeFile(join(root, rel), lines.join('\n'), 'utf8')
  return { applied, skipped }
}

/**
 * snapshot 必须是**移动之前**取的入链快照。
 * moves 是 oldRel → newRel，文件夹移动时把里面每篇都放进来。
 */
export async function applyRelink(
  root: string,
  snapshot: Map<string, InboundEdge[]>,
  moves: Map<string, string>
): Promise<RelinkOutcome> {
  const byFile = new Map<string, (RelinkChange & { col: number })[]>()

  for (const [oldTarget, edges] of snapshot) {
    const targetNew = moves.get(oldTarget)
    if (!targetNew) continue
    for (const e of edges) {
      // 引用方自己可能也在移动集合里（移动整个文件夹时）
      const linkerNew = moves.get(e.path) || e.path
      const to = relinkRaw(e, linkerNew, targetNew)
      if (!to) continue
      const list = byFile.get(linkerNew) || []
      list.push({ path: linkerNew, line: e.line, col: e.col, from: e.raw, to })
      byFile.set(linkerNew, list)
    }
  }

  const applied: RelinkChange[] = []
  const skipped: RelinkSkipped[] = []
  let files = 0

  // 分小批并发，移动一个被上百篇引用的文档时不至于串行卡住
  const entries = [...byFile.entries()]
  for (let i = 0; i < entries.length; i += 12) {
    const batch = entries.slice(i, i + 12)
    const out = await Promise.all(batch.map(([rel, list]) => applyToFile(root, rel, list)))
    for (const r of out) {
      applied.push(...r.applied)
      skipped.push(...r.skipped)
      if (r.applied.length) files++
    }
  }

  return { applied, skipped, files }
}
