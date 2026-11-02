// ---------------------------------------------------------------------------
// 链接索引：把整个笔记库解析成一张有向图
//
// 设计要点：
// 1. 只读变了的内容 —— 目录扫描只做 stat，mtime+size 没动就不重新解析；
//    上千篇文档的反复调用落在「几十次 stat + 零次读盘」这个量级。
// 2. 解析分两步 —— 先抽出原始链接（与目标无关），等全库标题/文件名表建好
//    之后再统一消歧。否则新增一篇文档会让先解析的那批链接永远指错。
// 3. 消歧宁可说「有歧义」也不赌 —— 给模型一个错的目标，比给它两个候选更糟。
// ---------------------------------------------------------------------------

import { promises as fsp } from 'fs'
import { join, relative, sep } from 'path'

export type LinkReason = 'ok' | 'broken' | 'ambiguous' | 'external' | 'self'

export interface LinkTarget {
  /** 解析成功时的目标相对路径；失败为 null */
  path: string | null
  reason: LinkReason
  /** reason 为 ambiguous 时的候选路径 */
  candidates?: string[]
}

export interface LinkEdge {
  from: string
  /** 原始写法，例如 `./ops/502.md` 或 `归档规则` */
  raw: string
  /** 链接显示文字 */
  text: string
  /** 1 起始的行号 */
  line: number
  anchor?: string
  /** 是否为 [[双链]] 写法 */
  wiki: boolean
  target: LinkTarget
  /** 目标文档的一句话摘要，解析成功时才有 */
  toSummary?: string
}

export interface InboundEdge {
  path: string
  title: string
  line: number
  text: string
  raw: string
  /** 引用方的一句话摘要 */
  summary: string
}

export interface DocLinks {
  path: string
  title: string
  lines: number
  /** 本文引用别人 */
  out: LinkEdge[]
  /** 别人引用本文 */
  inbound: InboundEdge[]
  /** out 里解析失败的 */
  broken: LinkEdge[]
}

export interface BrokenLink {
  from: string
  fromTitle: string
  raw: string
  text: string
  line: number
}

export interface IndexStats {
  docs: number
  edges: number
  broken: number
  ambiguous: number
  /** 上次 sync 的耗时（毫秒） */
  ms: number
}

interface RawEdge {
  raw: string
  text: string
  line: number
  anchor?: string
  /** wiki 语法没有路径，只能按标题找 */
  wiki: boolean
  /** 图片不算文档引用 */
  image: boolean
}

interface DocEntry {
  path: string
  name: string
  title: string
  /** 归一化后的标题，只用于匹配 */
  titleKey: string
  mtime: number
  size: number
  lines: number
  summary: string
  raw: RawEdge[]
  out: LinkEdge[]
}

const MD_RE = /\.(md|markdown|mdx|txt)$/i
const IGNORED = new Set(['node_modules', '.git', '.obsidian', '.trash', '.DS_Store', 'assets'])
const MAX_DEPTH = 6
const SYNC_TTL = 1500
/** 邻域最多返回多少篇，防止全库索引这类枢纽把结果撑爆 */
const MAX_NEIGHBORS = 300

/** ![alt](x) 与 [text](x)，允许 <x> 包裹与可选 title */
const MD_LINK = /(!?)\[([^[\]]*)\]\(\s*<?([^()\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g
/** 只匹配普通链接，跳过图片 */
const MD_LINK_PLAIN = /(?<!!)\[([^[\]]*)\]\(\s*<?([^()\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g
/** [[目标]] / [[目标|别名]] / [[目标#小节]] */
const WIKI_LINK = /\[\[([^[\]|#]*)(?:#([^[\]|]+))?(?:\|([^[\]]+))?\]\]/g

const stripInlineCode = (s: string) => s.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length))

const normTitle = (s: string) =>
  s
    .replace(/`[^`]*`/g, '')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

const posix = (p: string) => p.split(sep).join('/')
const dirOf = (p: string) => {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(0, i) : ''
}
const baseNoExt = (p: string) => {
  const name = p.slice(p.lastIndexOf('/') + 1)
  return name.replace(MD_RE, '')
}

/** 去掉 . 与 .. 段，得到库内相对路径 */
function normalizeRel(p: string): string {
  const parts: string[] = []
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

/** 把 markdown 正文抽成「原始链接 + 一句话摘要 + 标题」 */
export function parseDoc(path: string, content: string): { title: string; lines: number; summary: string; raw: RawEdge[] } {
  const text = content.replace(/\r\n/g, '\n')
  const lines = text.split('\n')
  const raw: RawEdge[] = []
  let fence: string | null = null
  let title = ''
  let summary = ''
  let inNested = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // front-matter 只在文件开头
    if (i === 0 && line.trim() === '---') {
      inNested = -1
      continue
    }

    const fm = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fm) {
      if (!fence) fence = fm[1]
      else if (fm[1][0] === fence[0] && fm[1].length >= fence.length) fence = null
      continue
    }
    if (fence) continue

    if (inNested === -1) {
      if (line.trim() === '---' || line.trim() === '...') inNested = 0
      continue
    }

    if (!title) {
      const h = line.match(/^#\s+(.+)$/)
      if (h) title = h[1].trim()
    }

    if (!summary) {
      const plain = line
        .replace(/^\s*>\s?/, '')
        .replace(/^[\s]*[-*+]\s+/, '')
        .replace(/^#+\s+/, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_~`]/g, '')
        .trim()
      if (plain && plain.length > 1) summary = plain.slice(0, 120)
    }

    const cleaned = stripInlineCode(line)
    let m: RegExpExecArray | null

    MD_LINK.lastIndex = 0
    while ((m = MD_LINK.exec(cleaned))) {
      const href = m[3].trim()
      if (!href) continue
      const hash = href.indexOf('#')
      raw.push({
        raw: hash >= 0 ? href.slice(0, hash) : href,
        text: m[2].trim(),
        line: i + 1,
        anchor: hash >= 0 ? href.slice(hash + 1) : undefined,
        wiki: false,
        image: m[1] === '!'
      })
    }

    WIKI_LINK.lastIndex = 0
    while ((m = WIKI_LINK.exec(cleaned))) {
      const target = (m[1] || '').trim()
      if (!target) continue
      raw.push({
        raw: target,
        text: (m[3] || target).trim(),
        line: i + 1,
        anchor: m[2]?.trim(),
        wiki: true,
        image: false
      })
    }
  }

  return {
    title: title || baseNoExt(path),
    lines: lines.length,
    summary: summary || '（无摘要）',
    raw
  }
}

/**
 * 把正文里的链接就地标注成解析结果。
 * 原始 href 保持不动（模型改文档时要能对齐原文），只在后面加一个短的解析标记。
 */
export function annotateLinks(content: string, edges: LinkEdge[]): string {
  const mdEdges = edges.filter((e) => !e.wiki)
  if (!mdEdges.length) return content
  const byLine = new Map<number, LinkEdge[]>()
  for (const e of mdEdges) {
    const list = byLine.get(e.line) || []
    list.push(e)
    byLine.set(e.line, list)
  }
  const lines = content.split('\n')
  for (const [line, list] of byLine) {
    const idx = line - 1
    if (idx < 0 || idx >= lines.length) continue
    let i = 0
    lines[idx] = lines[idx].replace(MD_LINK_PLAIN, (full) => {
      const e = list[i++]
      if (!e) return full
      const t = e.target
      if (t.reason === 'ok') return `${full}〔库内 ${t.path}〕`
      if (t.reason === 'broken') return `${full}〔断链〕`
      if (t.reason === 'ambiguous') return `${full}〔歧义：${(t.candidates || []).join(' / ')}〕`
      return full
    })
  }
  return lines.join('\n')
}

export class LinkIndex {
  private root = ''
  private docs = new Map<string, DocEntry>()
  private lower = new Map<string, string>()
  private byName = new Map<string, string[]>()
  private byTitle = new Map<string, string[]>()
  private inbound = new Map<string, InboundEdge[]>()
  private dirty = true
  private building: Promise<void> | null = null
  private lastSync = 0
  private stats: IndexStats = { docs: 0, edges: 0, broken: 0, ambiguous: 0, ms: 0 }

  get vaultRoot() {
    return this.root
  }

  setRoot(root: string) {
    if (this.root === root) return
    this.root = root
    this.docs.clear()
    this.lower.clear()
    this.byName.clear()
    this.byTitle.clear()
    this.inbound.clear()
    this.dirty = true
  }

  /** 文件系统有变化时调用；path 空表示整个库脏了 */
  invalidate(path?: string) {
    if (path) {
      const key = this.canon(path)
      if (key && this.docs.has(key)) this.docs.delete(key)
    }
    this.dirty = true
  }

  private canon(rel: string) {
    const hit = this.lower.get(rel.toLowerCase())
    return hit || null
  }

  /** 按需同步；并发调用共享同一次构建 */
  async sync(force = false): Promise<void> {
    if (this.building) return this.building
    if (!force && !this.dirty && Date.now() - this.lastSync < SYNC_TTL) return
    this.building = this.build()
      .catch(() => undefined)
      .finally(() => {
        this.building = null
      })
    return this.building
  }

  private async build() {
    if (!this.root) return
    const started = Date.now()
    const seen = new Set<string>()
    const fresh: { path: string; abs: string; name: string; mtime: number; size: number }[] = []

    const walk = async (dir: string, depth: number) => {
      if (depth > MAX_DEPTH) return
      let entries: import('fs').Dirent[] = []
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      const subdirs: string[] = []
      const jobs: Promise<void>[] = []
      for (const entry of entries) {
        if (entry.name.startsWith('.') || IGNORED.has(entry.name)) continue
        const abs = join(dir, entry.name)
        if (entry.isDirectory()) {
          subdirs.push(abs)
        } else if (MD_RE.test(entry.name)) {
          jobs.push(
            fsp.stat(abs).then(
              (st) => {
                const rel = posix(relative(this.root, abs))
                seen.add(rel)
                fresh.push({ path: rel, abs, name: entry.name, mtime: st.mtimeMs, size: st.size })
              },
              () => undefined
            )
          )
        }
      }
      await Promise.all(jobs)
      for (const sub of subdirs) await walk(sub, depth + 1)
    }

    await walk(this.root, 0)

    // 删掉已经不存在的
    for (const p of [...this.docs.keys()]) if (!seen.has(p)) this.docs.delete(p)

    // 只重解析变过的
    const queue = fresh.filter((f) => {
      const hit = this.docs.get(f.path)
      return !hit || hit.mtime !== f.mtime || hit.size !== f.size
    })
    for (let i = 0; i < queue.length; i += 32) {
      await Promise.all(
        queue.slice(i, i + 32).map(async (f) => {
          let content = ''
          try {
            content = await fsp.readFile(f.abs, 'utf-8')
          } catch {
            this.docs.delete(f.path)
            return
          }
          const parsed = parseDoc(f.path, content)
          this.docs.set(f.path, {
            path: f.path,
            name: f.name,
            title: parsed.title,
            titleKey: normTitle(parsed.title),
            mtime: f.mtime,
            size: f.size,
            lines: parsed.lines,
            summary: parsed.summary,
            raw: parsed.raw,
            out: []
          })
        })
      )
    }

    this.rebuildLookups()
    this.rebuildEdges()

    this.stats = {
      docs: this.docs.size,
      edges: 0,
      broken: 0,
      ambiguous: 0,
      ms: Date.now() - started
    }
    for (const doc of this.docs.values()) {
      for (const e of doc.out) {
        if (e.target.reason === 'external' || e.target.reason === 'self') continue
        this.stats.edges++
        if (e.target.reason === 'broken') this.stats.broken++
        if (e.target.reason === 'ambiguous') this.stats.ambiguous++
      }
    }

    this.lastSync = Date.now()
    this.dirty = false
  }

  private rebuildLookups() {
    this.lower.clear()
    this.byName.clear()
    this.byTitle.clear()
    for (const doc of this.docs.values()) {
      this.lower.set(doc.path.toLowerCase(), doc.path)
      const nameKey = baseNoExt(doc.path).toLowerCase()
      const nameList = this.byName.get(nameKey) || []
      nameList.push(doc.path)
      this.byName.set(nameKey, nameList)
      const titleKey = doc.titleKey
      if (titleKey) {
        const titleList = this.byTitle.get(titleKey) || []
        titleList.push(doc.path)
        this.byTitle.set(titleKey, titleList)
      }
    }
  }

  /** 全量重算所有边：依赖完整的文件名/标题表 */
  private rebuildEdges() {
    this.inbound.clear()
    for (const doc of this.docs.values()) {
      doc.out = doc.raw
        .filter((r) => !r.image)
        .map((r) => ({
          from: doc.path,
          raw: r.raw,
          text: r.text,
          line: r.line,
          anchor: r.anchor,
          wiki: r.wiki,
          target: this.resolve(doc.path, r)
        }))
    }
    for (const doc of this.docs.values()) {
      for (const edge of doc.out) {
        const to = edge.target.path
        if (!to) continue
        const list = this.inbound.get(to) || []
        list.push({
          path: doc.path,
          title: doc.title,
          line: edge.line,
          text: edge.text,
          raw: edge.raw,
          summary: doc.summary
        })
        this.inbound.set(to, list)
      }
    }
    for (const list of this.inbound.values()) {
      list.sort((a, b) => a.path.localeCompare(b.path, 'zh-Hans-CN') || a.line - b.line)
    }
  }

  private resolve(from: string, r: RawEdge): LinkTarget {
    const raw = r.raw.trim()
    if (!raw) return { path: null, reason: 'self' }
    if (/^(https?|mailto|tel|data|ink-asset|file):/i.test(raw)) return { path: null, reason: 'external' }
    if (raw.startsWith('#')) return { path: from, reason: 'self' }

    const candidates: string[] = []
    const push = (p: string | null | undefined) => {
      if (p && this.docs.has(p) && !candidates.includes(p)) candidates.push(p)
    }

    if (r.wiki) {
      const key = normTitle(raw)
      const byT = this.byTitle.get(key) || []
      const byN = this.byName.get(key) || []
      for (const p of byT) push(p)
      for (const p of byN) push(p)
    } else {
      let href = raw
      try {
        href = decodeURI(href)
      } catch {
        /* 保留原样 */
      }
      href = href.replace(/^<|>$/g, '').trim()
      if (!href) return { path: null, reason: 'self' }

      const withExt = (p: string) => (MD_RE.test(p) ? p : `${p}.md`)
      const baseDir = dirOf(from)

      // 1. 相对当前文档的目录
      const rel1 = normalizeRel(href.startsWith('/') ? href.slice(1) : `${baseDir}/${href}`)
      push(this.pick(rel1))
      push(this.pick(withExt(rel1)))

      // 2. 当作库根相对
      const rel2 = normalizeRel(href.replace(/^\//, ''))
      push(this.pick(rel2))
      push(this.pick(withExt(rel2)))

      // 3. 只给文件名：唯一时直接用；多个同名且没有精确命中，判歧义
      const nameKey = baseNoExt(href).toLowerCase()
      const nameHits = this.byName.get(nameKey) || []
      if (nameHits.length === 1) push(nameHits[0])
      else if (nameHits.length > 1 && candidates.length === 0) {
        for (const p of nameHits.slice(0, 5)) push(p)
      }

      // 4. 显示文字当标题，规则同上
      const titleKey = normTitle(r.text)
      if (titleKey) {
        const titleHits = this.byTitle.get(titleKey) || []
        if (titleHits.length === 1) push(titleHits[0])
        else if (titleHits.length > 1 && candidates.length === 0) {
          for (const p of titleHits.slice(0, 5)) push(p)
        }
      }
    }

    if (candidates.length === 1) return { path: candidates[0], reason: 'ok' }
    if (candidates.length > 1) {
      return { path: null, reason: 'ambiguous', candidates: candidates.slice(0, 5) }
    }
    return { path: null, reason: 'broken' }
  }

  /** 大小写不敏感地取回真实路径 */
  private pick(rel: string): string | null {
    if (!rel) return null
    return this.lower.get(rel.toLowerCase()) || null
  }

  // ---------------------------------------------------------------- 对外查询

  async doc(path: string): Promise<DocLinks | null> {
    await this.sync()
    const key = this.canon(path)
    if (!key) return null
    const entry = this.docs.get(key)
    if (!entry) return null
    const out = [...entry.out]
      .sort((a, b) => a.line - b.line)
      .map((e) => ({ ...e, toSummary: e.target.path ? this.docs.get(e.target.path)?.summary : undefined }))
    return {
      path: entry.path,
      title: entry.title,
      lines: entry.lines,
      out,
      inbound: this.inbound.get(entry.path) || [],
      broken: out.filter((e) => e.target.reason === 'broken')
    }
  }

  async broken(): Promise<BrokenLink[]> {
    await this.sync()
    const out: BrokenLink[] = []
    for (const doc of this.docs.values()) {
      for (const e of doc.out) {
        if (e.target.reason !== 'broken' && e.target.reason !== 'ambiguous') continue
        out.push({
          from: doc.path,
          fromTitle: doc.title,
          raw: e.raw,
          text: e.text,
          line: e.line
        })
      }
    }
    return out.sort((a, b) => a.from.localeCompare(b.from, 'zh-Hans-CN') || a.line - b.line)
  }

  /** 点击链接时用：把原始 href 解析成库内路径，失败返回 null */
  async resolveHref(from: string, href: string): Promise<{ path: string | null; anchor?: string; reason: LinkReason }> {
    await this.sync()
    const key = this.canon(from) || from
    let raw = href
    let anchor: string | undefined
    const hash = raw.indexOf('#')
    if (hash >= 0) {
      anchor = raw.slice(hash + 1)
      raw = raw.slice(0, hash)
    }
    if (!raw) return { path: key, anchor, reason: 'self' }
    const target = this.resolve(key, { raw, text: '', line: 0, wiki: false, image: false })
    return { path: target.path, anchor, reason: target.reason }
  }

  /** N 跳邻域，只给摘要，不给全文 */
  async neighborhood(path: string, depth = 1): Promise<
    { path: string; title: string; summary: string; hop: number; dir: 'out' | 'in' }[]
  > {
    await this.sync()
    const start = this.canon(path)
    if (!start) return []
    const seen = new Set<string>([start])
    const result: { path: string; title: string; summary: string; hop: number; dir: 'out' | 'in' }[] = []
    let frontier = [start]
    const maxHop = Math.max(1, Math.min(depth, 2))

    for (let hop = 1; hop <= maxHop; hop++) {
      const next: string[] = []
      for (const cur of frontier) {
        const entry = this.docs.get(cur)
        if (!entry) continue
        const neighbours: { p: string; dir: 'out' | 'in' }[] = []
        for (const e of entry.out) if (e.target.path) neighbours.push({ p: e.target.path, dir: 'out' })
        for (const e of this.inbound.get(cur) || []) neighbours.push({ p: e.path, dir: 'in' })
        for (const n of neighbours) {
          if (result.length >= MAX_NEIGHBORS) break
          if (seen.has(n.p)) continue
          seen.add(n.p)
          const doc = this.docs.get(n.p)
          if (!doc) continue
          result.push({ path: doc.path, title: doc.title, summary: doc.summary, hop, dir: n.dir })
          next.push(n.p)
        }
        // 枢纽文档（全库索引之类）会带出上千邻居，超出部分对判断没有帮助
        if (result.length >= MAX_NEIGHBORS) break
      }
      frontier = next
      if (!frontier.length || result.length >= MAX_NEIGHBORS) break
    }
    return result
  }

  /** 两篇文档之间的最短引用路径（无向），用于回答「这两篇什么关系」 */
  async pathBetween(from: string, to: string, maxLen = 5): Promise<string[] | null> {
    await this.sync()
    const a = this.canon(from)
    const b = this.canon(to)
    if (!a || !b) return null
    if (a === b) return [a]

    const prev = new Map<string, string | null>([[a, null]])
    let frontier = [a]
    for (let step = 0; step < maxLen && frontier.length; step++) {
      const next: string[] = []
      for (const cur of frontier) {
        const entry = this.docs.get(cur)
        if (!entry) continue
        const links = new Set<string>()
        for (const e of entry.out) if (e.target.path) links.add(e.target.path)
        for (const e of this.inbound.get(cur) || []) links.add(e.path)
        for (const p of links) {
          if (prev.has(p)) continue
          prev.set(p, cur)
          if (p === b) {
            const chain: string[] = [b]
            let walker: string | null = cur
            while (walker) {
              chain.unshift(walker)
              walker = prev.get(walker) ?? null
            }
            return chain
          }
          next.push(p)
        }
      }
      frontier = next
    }
    return null
  }

  async statsNow(): Promise<IndexStats> {
    await this.sync()
    return { ...this.stats }
  }

  async list(): Promise<
    { path: string; name: string; title: string; size: number; mtime: number; lines: number; summary: string }[]
  > {
    await this.sync()
    return [...this.docs.values()].map((d) => ({
      path: d.path,
      name: d.name,
      title: d.title,
      size: d.size,
      mtime: d.mtime,
      lines: d.lines,
      summary: d.summary
    }))
  }

  /** 内容变化时用：拿到当前 mtime，判断是否真的要失效 */
  mtimeOf(path: string): number | null {
    const key = this.canon(path)
    return key ? this.docs.get(key)?.mtime ?? null : null
  }

  /** 供 searchVault 复用：避免重复读盘 */
  async contentOf(path: string): Promise<string | null> {
    await this.sync()
    const key = this.canon(path)
    if (!key) return null
    try {
      return await fsp.readFile(join(this.root, key.split('/').join(sep)), 'utf-8')
    } catch {
      return null
    }
  }
}
