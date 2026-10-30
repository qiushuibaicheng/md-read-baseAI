import type { RichKind } from './markdown'

interface HydrateOptions {
  theme: 'light' | 'dark'
  onCopy: (text: string, label?: string) => void
  /** 主题切换时强制重绘 */
  force?: boolean
}

const MAX_JSON_LENGTH = 600_000
const MAX_JSON_ITEMS = 300

let mermaidMod: any = null
let mermaidTheme = ''
let mermaidQueue: Promise<unknown> = Promise.resolve()
let markmapCssInjected = false
const markmapInstances = new WeakMap<Element, { destroy: () => void; fit: () => void }>()

// ---------------------------------------------------------------------------
// Mermaid
// ---------------------------------------------------------------------------
async function getMermaid(theme: 'light' | 'dark') {
  if (!mermaidMod) {
    const mod = await import('mermaid')
    mermaidMod = mod.default
  }
  if (mermaidTheme !== theme) {
    const dark = theme === 'dark'
    mermaidMod.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: dark ? 'dark' : 'default',
      fontFamily: '"Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif',
      themeVariables: dark
        ? {
            background: 'transparent',
            primaryColor: '#1b2230',
            primaryTextColor: '#e6eaf4',
            primaryBorderColor: '#3a4763',
            lineColor: '#5a6a8c',
            secondaryColor: '#232a3a',
            tertiaryColor: '#161c28',
            mainBkg: '#1b2230',
            nodeBorder: '#3b4763',
            clusterBkg: 'rgba(255,255,255,0.03)',
            clusterBorder: 'rgba(255,255,255,0.12)',
            titleColor: '#c9d2e6',
            edgeLabelBackground: '#141a25',
            textColor: '#dbe2f0'
          }
        : {
            background: 'transparent',
            primaryColor: '#eef2ff',
            primaryTextColor: '#1a2033',
            primaryBorderColor: '#c3cdf0',
            lineColor: '#8b98b8',
            secondaryColor: '#f4f6fd',
            tertiaryColor: '#fbfcff',
            mainBkg: '#eef2ff',
            nodeBorder: '#c3cdf0',
            clusterBkg: 'rgba(59,108,246,0.04)',
            clusterBorder: 'rgba(59,108,246,0.18)',
            titleColor: '#39415a',
            edgeLabelBackground: '#ffffff',
            textColor: '#1f2536'
          }
    })
    mermaidTheme = theme
  }
  return mermaidMod
}

function mermaidRender(code: string, theme: 'light' | 'dark'): Promise<string> {
  const run = async () => {
    const mermaid = await getMermaid(theme)
    const id = `mmd-${Math.random().toString(36).slice(2, 10)}`
    try {
      const { svg } = await mermaid.render(id, code)
      return svg
    } finally {
      // mermaid 渲染失败时会在 body 上留一个临时节点
      document.getElementById(`d${id}`)?.remove()
      document.getElementById(id)?.remove()
    }
  }
  const next = mermaidQueue.then(run, run)
  mermaidQueue = next.catch(() => undefined)
  return next
}

// ---------------------------------------------------------------------------
// Markmap
// ---------------------------------------------------------------------------
async function renderMarkmap(block: HTMLElement, body: HTMLElement, code: string) {
  const [{ Transformer }, view] = await Promise.all([import('markmap-lib'), import('markmap-view')])
  if (!markmapCssInjected && view.globalCSS) {
    const style = document.createElement('style')
    style.dataset.markmap = 'true'
    style.textContent = view.globalCSS
    document.head.appendChild(style)
    markmapCssInjected = true
  }

  const transformer = new Transformer()
  const { root: data } = transformer.transform(code)
  body.innerHTML = ''

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'markmap-svg')
  body.appendChild(svg)

  markmapInstances.get(block)?.destroy()
  const mm = view.Markmap.create(
    svg,
    {
      autoFit: true,
      duration: 320,
      fitRatio: 0.92,
      spacingHorizontal: 64,
      spacingVertical: 8,
      paddingX: 12,
      maxWidth: 220
    },
    data
  )

  // markmap 的 fit() 按内部 bbox 居中，实际可见节点会偏一侧；
  // 且容器宽度变化后不会重新 fit（内容会按旧宽度居中而被右边界裁切）。
  // 这里在 fit 之后按可见节点的真实包围盒做一次平移校正。
  const center = () => {
    const nodes = Array.from(svg.querySelectorAll<SVGGElement>('g.markmap-node'))
    if (!nodes.length) return
    const sb = svg.getBoundingClientRect()
    let left = Infinity
    let right = -Infinity
    let top = Infinity
    let bottom = -Infinity
    for (const node of nodes) {
      const r = node.getBoundingClientRect()
      if (!r.width && !r.height) continue
      left = Math.min(left, r.left)
      right = Math.max(right, r.right)
      top = Math.min(top, r.top)
      bottom = Math.max(bottom, r.bottom)
    }
    if (!Number.isFinite(left) || !Number.isFinite(top)) return
    const g = mm.g?.node?.() as SVGGElement | undefined
    const matched = /translate\(\s*(-?[\d.]+)[,\s]+(-?[\d.]+)\s*\)\s*scale\(\s*(-?[\d.]+)\s*\)/.exec(
      g?.getAttribute('transform') || ''
    )
    if (!g || !matched) return
    const tx = Number(matched[1])
    const ty = Number(matched[2])
    const k = Number(matched[3])
    const dx = (sb.right - right - (left - sb.left)) / 2
    const dy = (sb.bottom - bottom - (top - sb.top)) / 2
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
    g.setAttribute('transform', `translate(${tx + dx},${ty + dy}) scale(${k})`)
    // 同步 d3-zoom 内部状态，避免下一次拖拽跳位
    ;(svg as unknown as { __zoom?: unknown }).__zoom = { x: tx + dx, y: ty + dy, k }
  }

  let lastWidth = 0
  let timer = 0
  const refit = (delay = 60) => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      mm.fit()
        .then(() => window.setTimeout(center, 30))
        .catch(() => center())
    }, delay)
  }
  const observer = new ResizeObserver(() => {
    const width = Math.round(svg.getBoundingClientRect().width)
    if (!width || width === lastWidth) return
    lastWidth = width
    refit(80)
  })
  observer.observe(body)
  refit(120)

  markmapInstances.set(block, {
    destroy: () => {
      observer.disconnect()
      window.clearTimeout(timer)
      mm.destroy()
    },
    fit: () => refit(0)
  })
  svg.addEventListener('dblclick', () => refit(0))
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------
function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function preview(value: unknown): string {
  if (Array.isArray(value)) return `[${value.length}]`
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>)
    return `{${keys.length}}`
  }
  return ''
}

function makeToggleRow(
  key: string | null,
  value: unknown,
  depth: number,
  path: string,
  onCopy: (text: string, label?: string) => void,
  indexLabel?: string
): HTMLElement {
  const kind = typeOf(value)
  const wrap = document.createElement('div')
  wrap.className = 'json-node'

  const row = document.createElement('div')
  row.className = `json-row kind-${kind}`

  const caret = document.createElement('span')
  caret.className = 'json-caret'
  row.appendChild(caret)

  if (indexLabel !== undefined) {
    const idx = document.createElement('span')
    idx.className = 'json-index'
    idx.textContent = indexLabel
    row.appendChild(idx)
  }

  if (key !== null) {
    const keyEl = document.createElement('span')
    keyEl.className = 'json-key'
    keyEl.textContent = Array.isArray(value) || typeof value === 'object' ? key : `"${key}"`
    keyEl.title = `点击复制路径 ${path}`
    keyEl.addEventListener('click', (e) => {
      e.stopPropagation()
      onCopy(path, '路径已复制')
    })
    row.appendChild(keyEl)
    const colon = document.createElement('span')
    colon.className = 'json-colon'
    colon.textContent = ':'
    row.appendChild(colon)
  }

  const open = kind === 'array' || kind === 'object'
  if (open) {
    const summary = document.createElement('span')
    summary.className = 'json-summary'
    summary.textContent = `${kind === 'array' ? '[' : '{'} ${preview(value)}`
    row.appendChild(summary)
  } else {
    const valueEl = document.createElement('span')
    valueEl.className = `json-val j-${kind}`
    valueEl.textContent = kind === 'string' ? `"${String(value)}"` : String(value)
    row.appendChild(valueEl)
  }

  wrap.appendChild(row)

  if (!open) return wrap

  const children = document.createElement('div')
  children.className = 'json-children'
  const entries: [string, unknown][] = Array.isArray(value)
    ? value.slice(0, MAX_JSON_ITEMS).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>)

  for (const [k, v] of entries) {
    const childPath = Array.isArray(value) ? `${path}[${k}]` : path ? `${path}.${k}` : k
    children.appendChild(
      makeToggleRow(Array.isArray(value) ? null : k, v, depth + 1, childPath, onCopy, Array.isArray(value) ? k : undefined)
    )
  }

  const rest = Array.isArray(value) ? value.length - entries.length : 0
  if (rest > 0) {
    const more = document.createElement('div')
    more.className = 'json-more'
    more.textContent = `… 还有 ${rest} 项未展开`
    children.appendChild(more)
  }

  wrap.appendChild(children)
  const collapsed = depth >= 1
  if (collapsed) {
    children.hidden = true
    caret.classList.add('is-collapsed')
  }
  row.addEventListener('click', () => {
    children.hidden = !children.hidden
    caret.classList.toggle('is-collapsed', children.hidden)
  })

  return wrap
}

function renderJson(body: HTMLElement, code: string, onCopy: (text: string, label?: string) => void) {
  if (code.length > MAX_JSON_LENGTH) {
    body.innerHTML = `<div class="rich-error">JSON 太大（${(code.length / 1024).toFixed(0)} KB），已折叠为源码视图</div>`
    return
  }
  let data: unknown
  try {
    data = JSON.parse(code)
  } catch (err) {
    body.innerHTML = `<div class="rich-error">JSON 解析失败：${String((err as Error).message)}</div>`
    return
  }

  body.innerHTML = ''
  const bar = document.createElement('div')
  bar.className = 'json-bar'
  const expand = document.createElement('button')
  expand.className = 'rich-tool'
  expand.textContent = '全部展开'
  const collapse = document.createElement('button')
  collapse.className = 'rich-tool'
  collapse.textContent = '收起到 1 层'
  const copyBtn = document.createElement('button')
  copyBtn.className = 'rich-tool'
  copyBtn.textContent = '复制 JSON'
  bar.append(expand, collapse, copyBtn)

  const tree = document.createElement('div')
  tree.className = 'json-tree'
  tree.appendChild(makeToggleRow(null, data, 0, '$', onCopy))
  body.append(bar, tree)

  expand.addEventListener('click', () => {
    tree.querySelectorAll('.json-children').forEach((el) => ((el as HTMLElement).hidden = false))
    tree.querySelectorAll('.json-caret').forEach((el) => el.classList.remove('is-collapsed'))
  })
  collapse.addEventListener('click', () => {
    const top = tree.querySelector('.json-node > .json-children') as HTMLElement | null
    tree.querySelectorAll('.json-children').forEach((el) => {
      if (el !== top) (el as HTMLElement).hidden = true
    })
    tree.querySelectorAll('.json-caret').forEach((el, i) => {
      if (i > 0) el.classList.add('is-collapsed')
    })
    if (top) top.hidden = false
  })
  copyBtn.addEventListener('click', () => onCopy(code, 'JSON 已复制'))
}

// ---------------------------------------------------------------------------
// 水合入口
// ---------------------------------------------------------------------------
export function hydrateRich(root: HTMLElement, opts: HydrateOptions) {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('[data-rich]'))

  if (opts.force) {
    for (const block of blocks) {
      const inst = markmapInstances.get(block)
      inst?.destroy()
      markmapInstances.delete(block)
      delete block.dataset.hydrated
      const body = block.querySelector<HTMLElement>('.rich-body')
      if (body) body.innerHTML = '<div class="rich-pending"><span class="rich-spinner"></span>渲染中…</div>'
    }
  }

  for (const block of blocks) {
    if (block.dataset.hydrated === '1') continue
    block.dataset.hydrated = '1'

    const kind = (block.dataset.rich || '') as RichKind
    const body = block.querySelector<HTMLElement>('.rich-body')
    const sourceEl = block.querySelector<HTMLElement>('.rich-source')
    const code = sourceEl?.textContent || ''
    if (!body) continue

    const fail = (message: string) => {
      body.innerHTML = `<div class="rich-error"><span class="rich-error-title">渲染失败</span><code>${message
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')}</code></div>`
    }

    if (kind === 'mermaid') {
      mermaidRender(code, opts.theme)
        .then((svg) => {
          body.innerHTML = svg
          body.querySelector('svg')?.setAttribute('preserveAspectRatio', 'xMidYMid meet')
        })
        .catch((err) => fail(String(err?.message || err)))
    } else if (kind === 'markmap') {
      renderMarkmap(block, body, code).catch((err) => fail(String(err?.message || err)))
    } else if (kind === 'json') {
      renderJson(body, code, opts.onCopy)
    }
  }

  // 源码 / 复制
  root.querySelectorAll<HTMLButtonElement>('[data-rich-action]').forEach((btn) => {
    if (btn.dataset.bound === '1') return
    btn.dataset.bound = '1'
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const block = btn.closest<HTMLElement>('[data-rich]')
      if (!block) return
      const action = btn.dataset.richAction
      if (action === 'copy') {
        opts.onCopy(block.querySelector('.rich-source')?.textContent || '', '已复制')
      } else if (action === 'toggle-source') {
        const src = block.querySelector<HTMLElement>('.rich-source')
        const body = block.querySelector<HTMLElement>('.rich-body')
        if (!src || !body) return
        const showSource = src.hidden
        src.hidden = !showSource
        body.hidden = showSource
        btn.classList.toggle('is-on', showSource)
        btn.textContent = showSource ? '渲染' : '源码'
      }
    })
  })
}

export function destroyRich(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[data-rich]').forEach((block) => {
    markmapInstances.get(block)?.destroy()
    markmapInstances.delete(block)
  })
}
