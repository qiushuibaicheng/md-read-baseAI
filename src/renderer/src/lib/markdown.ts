import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'

export interface Heading {
  level: number
  text: string
  id: string
  line: number
}

export interface RenderResult {
  html: string
  headings: Heading[]
  words: number
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: false
})

function escapeHtml(str: string) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export type RichKind = 'mermaid' | 'markmap' | 'json'

const RICH_LANGS: Record<string, RichKind> = {
  mermaid: 'mermaid',
  mmd: 'mermaid',
  markmap: 'markmap',
  mindmap: 'markmap',
  'mind-map': 'markmap',
  json: 'json',
  jsonc: 'json'
}

function renderCodeBlock(code: string, lang: string): string {
  const language = lang && hljs.getLanguage(lang) ? lang : ''
  let body: string
  try {
    body = language ? hljs.highlight(code, { language, ignoreIllegals: true }).value : escapeHtml(code)
  } catch {
    body = escapeHtml(code)
  }
  const label = language || 'text'
  return `<div class="code-block"><div class="code-head"><span class="code-lang">${label}</span><button class="code-copy" type="button" data-copy>复制</button></div><pre class="hljs"><code>${body}</code></pre></div>`
}

function renderRichBlock(kind: RichKind, code: string): string {
  const label = kind === 'mermaid' ? 'Mermaid' : kind === 'markmap' ? 'Mindmap' : 'JSON'
  return `<div class="rich-block" data-rich="${kind}">
  <div class="rich-head">
    <span class="rich-tag"><span class="rich-dot"></span>${label}</span>
    <div class="rich-tools">
      <button class="rich-tool" type="button" data-rich-action="toggle-source">源码</button>
      <button class="rich-tool" type="button" data-rich-action="copy">复制</button>
    </div>
  </div>
  <div class="rich-body"><div class="rich-pending"><span class="rich-spinner"></span>渲染中…</div></div>
  <pre class="rich-source" hidden><code>${escapeHtml(code)}</code></pre>
</div>`
}

md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  const lang = (token.info || '').trim().split(/\s+/)[0].toLowerCase()
  const kind = RICH_LANGS[lang]
  if (kind) return `${renderRichBlock(kind, token.content)}\n`
  return `${renderCodeBlock(token.content, lang)}\n`
}

// 标题 id + 任务清单解析
md.core.ruler.push('ink_heads_tasks', (state) => {
  const tokens = state.tokens
  let headingIndex = 0
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.type === 'heading_open') {
      const inline = tokens[i + 1]
      const text = inline?.content || ''
      const id = `h-${headingIndex++}`
      token.attrSet('id', id)
      token.meta = { ...(token.meta || {}), headingText: text, headingId: id }
    }
    if (
      token.type === 'inline' &&
      tokens[i - 1]?.type === 'paragraph_open' &&
      tokens[i - 2]?.type === 'list_item_open'
    ) {
      const match = token.content.match(/^\[([ xX])\]\s+/)
      if (match) {
        const checked = match[1].toLowerCase() === 'x'
        token.content = token.content.slice(match[0].length)
        if (token.children?.[0]?.type === 'text') {
          token.children[0].content = token.children[0].content.replace(/^\[([ xX])\]\s+/, '')
        }
        const li = tokens[i - 2]
        const line = li.map ? li.map[0] : -1
        li.attrJoin('class', 'task-item')
        const box = new state.Token('html_inline', '', 0)
        box.content = `<span class="task-check${checked ? ' is-checked' : ''}" data-task-line="${line}" role="checkbox" aria-checked="${checked}"><svg viewBox="0 0 12 12" width="10" height="10"><path d="M2 6.2 4.8 9 10 3.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`
        token.children?.unshift(box)
      }
    }
  }
})

const defaultLiOpen = md.renderer.rules.list_item_open
md.renderer.rules.list_item_open = (tokens, idx, options, env, self) => {
  if (defaultLiOpen) return defaultLiOpen(tokens, idx, options, env, self)
  return self.renderToken(tokens, idx, options)
}

/** 去掉 `.` 与 `..` 段，得到库内相对路径 */
function normalizeRel(p: string): string {
  const parts: string[] = []
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

/**
 * 解析正文里的本地图片：相对**这篇文档所在目录**，`/` 开头算库根。
 * 这是 Typora / Obsidian / VSCode 共同的语义，写成这样就到哪儿都能显示。
 *
 * 老版本把它一律按库根拼（`assets/x.png` 指库根的 assets），历史上存下来的
 * 正文都是那种写法，所以额外带一个「库根」候选，主进程在第一个不存在时再试它。
 */
function assetUrl(vaultPath: string, docPath: string, raw: string): string {
  let clean = raw
  try {
    clean = decodeURI(clean)
  } catch {
    /* 编码不合法就按原文处理 */
  }

  const root = vaultPath.replace(/[\\/]+$/, '')
  const toAbs = (rel: string) => `${root}\\${rel.replace(/\//g, '\\')}`
  const docDir = docPath.includes('/') ? docPath.slice(0, docPath.lastIndexOf('/')) : ''

  const primary = clean.startsWith('/') ? normalizeRel(clean.slice(1)) : normalizeRel(`${docDir}/${clean}`)
  const fallback = normalizeRel(clean)

  const one = toAbs(primary)
  const two = toAbs(fallback)
  const query = one === two ? `p=${encodeURIComponent(one)}` : `p=${encodeURIComponent(one)}&r=${encodeURIComponent(two)}`
  return `ink-asset://local/?${query}`
}

// 本地图片 => ink-asset 协议
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const raw = token.attrGet('src') || ''
  if (!/^(https?:|data:|ink-asset:|blob:)/i.test(raw) && env?.vaultPath) {
    token.attrSet('src', assetUrl(String(env.vaultPath), String(env.docPath || ''), raw))
  }
  token.attrSet('loading', 'lazy')
  return self.renderToken(tokens, idx, options)
}

// 外链走系统浏览器；库内文档链接交给渲染层解析（路径相对谁，只有主进程的索引知道）
const defaultLinkOpen = md.renderer.rules.link_open
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href') || ''
  if (/^https?:/i.test(href)) {
    tokens[idx].attrSet('target', '_blank')
    tokens[idx].attrSet('rel', 'noreferrer noopener')
  } else if (href && !/^(#|mailto:|tel:|javascript:|data:)/i.test(href)) {
    const cut = href.indexOf('#')
    const raw = cut >= 0 ? href.slice(0, cut) : href
    const anchor = cut >= 0 ? href.slice(cut + 1) : ''
    if (raw) {
      tokens[idx].attrSet('data-doc-link', raw)
      if (anchor) tokens[idx].attrSet('data-doc-anchor', anchor)
      // 去掉 href：Electron 里相对路径导航会被 will-navigate 拦下，而且没必要
      const attrs = tokens[idx].attrs
      if (attrs) {
        const at = attrs.findIndex((pair) => pair[0] === 'href')
        if (at >= 0) attrs.splice(at, 1)
      }
    }
  }
  if (defaultLinkOpen) return defaultLinkOpen(tokens, idx, options, env, self)
  return self.renderToken(tokens, idx, options)
}

export function renderMarkdown(source: string, vaultPath: string, docPath = ''): RenderResult {
  const env: Record<string, unknown> = { vaultPath, docPath }
  const tokens = md.parse(source, env)
  const headings: Heading[] = []
  tokens.forEach((t, i) => {
    if (t.type === 'heading_open') {
      headings.push({
        level: Number(t.tag.slice(1)),
        text: t.meta?.headingText || tokens[i + 1]?.content || '',
        id: t.meta?.headingId || '',
        line: t.map ? t.map[0] : 0
      })
    }
  })
  const html = md.renderer.render(tokens, md.options, env)
  const words = (source.match(/[\u4e00-\u9fa5]/g)?.length || 0) + (source.match(/[a-zA-Z0-9_-]+/g)?.length || 0)
  return { html, headings, words }
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function highlightText(text: string, q: string): string {
  if (!q) return escapeHtml(text)
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return escapeHtml(text)
  return (
    escapeHtml(text.slice(0, idx)) +
    '<mark>' +
    escapeHtml(text.slice(idx, idx + q.length)) +
    '</mark>' +
    escapeHtml(text.slice(idx + q.length))
  )
}

export function exportStyles(theme: 'light' | 'dark'): string {
  return `:root{color-scheme:${theme};}
  body{margin:0;padding:56px 24px;background:${theme === 'dark' ? '#12141a' : '#ffffff'};color:${theme === 'dark' ? '#e7eaf3' : '#1b1f28'};font-family:"Segoe UI","Microsoft YaHei UI","PingFang SC",system-ui,sans-serif;line-height:1.78;font-size:15px;}
  .doc{max-width:820px;margin:0 auto;}
  h1,h2,h3,h4{line-height:1.35;margin:1.6em 0 .6em;font-weight:650;}
  h1{font-size:2em;margin-top:0;}
  h2{font-size:1.45em;border-bottom:1px solid ${theme === 'dark' ? '#252a36' : '#eceef3'};padding-bottom:.3em;}
  h3{font-size:1.18em;}
  p{margin:.75em 0;}
  a{color:#5b8cff;text-decoration:none;}
  a:hover{text-decoration:underline;}
  ul,ol{padding-left:1.5em;}
  li{margin:.3em 0;}
  blockquote{margin:1em 0;padding:.4em 1em;border-left:3px solid ${theme === 'dark' ? '#3b4a63' : '#d8deec'};color:${theme === 'dark' ? '#9aa4bb' : '#5c6579'};background:${theme === 'dark' ? 'rgba(255,255,255,.03)' : '#f7f9fc'};border-radius:0 8px 8px 0;}
  code{font-family:"Cascadia Code",Consolas,monospace;font-size:.88em;background:${theme === 'dark' ? 'rgba(255,255,255,.08)' : '#f3f5f9'};padding:.16em .4em;border-radius:5px;}
  .code-block{margin:1em 0;border:1px solid ${theme === 'dark' ? '#252a36' : '#e6e9f0'};border-radius:10px;overflow:hidden;background:${theme === 'dark' ? '#0e1116' : '#fafbfd'};}
  .code-head{display:flex;justify-content:space-between;padding:6px 12px;font-size:12px;color:${theme === 'dark' ? '#7d879c' : '#7c869c'};border-bottom:1px solid ${theme === 'dark' ? '#1c212b' : '#eceff4'};}
  .code-copy{display:none;}
  .code-block pre{margin:0;padding:14px 16px;overflow:auto;}
  .code-block code{background:none;padding:0;font-size:13px;}
  table{border-collapse:collapse;width:100%;margin:1em 0;font-size:.94em;}
  th,td{border:1px solid ${theme === 'dark' ? '#252a36' : '#e6e9f0'};padding:8px 12px;text-align:left;}
  th{background:${theme === 'dark' ? 'rgba(255,255,255,.04)' : '#f7f9fc'};}
  img{max-width:100%;border-radius:10px;}
  hr{border:none;border-top:1px solid ${theme === 'dark' ? '#252a36' : '#eceef3'};margin:2em 0;}
  .task-item{list-style:none;margin-left:-1.3em;}
  .task-check{display:inline-flex;width:15px;height:15px;border-radius:4px;border:1.5px solid #9aa4bb;margin-right:.5em;vertical-align:-2px;align-items:center;justify-content:center;color:transparent;}
  .task-check.is-checked{background:#5b8cff;border-color:#5b8cff;color:#fff;}
  mark{background:rgba(255,196,0,.3);color:inherit;border-radius:3px;}
  .hljs-comment,.hljs-quote{color:#7d879c;font-style:italic}
  .hljs-keyword,.hljs-selector-tag,.hljs-literal{color:#c792ea}
  .hljs-string,.hljs-attr{color:#a5e075}
  .hljs-number,.hljs-symbol{color:#f78c6c}
  .hljs-title,.hljs-section,.hljs-name{color:#82aaff}
  .hljs-built_in,.hljs-type{color:#ffcb6b}
  .hljs-variable,.hljs-template-variable{color:#f07178}`
}
