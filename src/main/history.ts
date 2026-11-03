import { shell } from 'electron'
import { promises as fsp } from 'fs'
import { join, resolve, sep } from 'path'

/**
 * 可撤销的操作栈。
 *
 * 只记「用户能感知的一次结构操作」：移动/改名（连带它触发的链接改写）、
 * AI 应用提案、AI 新建文档。不做全库版本快照——那会把磁盘当仓库用，
 * 成本和收益不成比例；这里要的只是「刚刚那一下能不能退回去」。
 *
 * 内存态，重启清空。删除不进栈：trashItem 不告诉我们回收站里的位置，
 * 跨平台没有可靠的还原接口，硬做会引出一堆平台分支。
 */

export interface FilePatch {
  /** 改写后的路径（撤销时先按 moves 逆映射回旧路径） */
  path: string
  before: string
  after: string
}

interface Base {
  id: string
  at: number
  label: string
  /** 归属的 AI 请求；用户自己发起的操作为空 */
  reqId?: string
}

export interface MoveEntry extends Base {
  kind: 'move'
  /** 物理挪动：[旧, 新]，文件夹只有一对（内部文档跟着走） */
  moves: [string, string][]
  /** 被改写的正文 */
  patches: FilePatch[]
}

export interface WriteEntry extends Base {
  kind: 'write'
  path: string
  before: string
  after: string
}

export interface CreateEntry extends Base {
  kind: 'create'
  path: string
}

export type Entry = MoveEntry | WriteEntry | CreateEntry

export interface UndoResult {
  ok: boolean
  /** 撤销了几条事务 */
  count: number
  /** 成功还原的文件数 */
  restored: number
  /** 因为被改动过而跳过的文件数 */
  skipped: number
  /** 给用户看的一句话 */
  label: string
  note?: string
  /** 正文被改回原样的文件（撤销后的路径），界面据此重读，别让编辑器停在旧内容 */
  paths: string[]
}

const MAX = 30
const stack: Entry[] = []

let rootOf = () => ''
let notify: (moves: [string, string][]) => Promise<void> = async () => undefined

export function initHistory(opts: {
  root: () => string
  /** 撤销完成后的收尾：广播新路径、重建索引、刷新界面 */
  onChanged: (moves: [string, string][]) => Promise<void>
}) {
  rootOf = opts.root
  notify = opts.onChanged
}

/** 所有落盘路径都要过这道：撤销栈里的路径来自历史，不能直接信 */
function abs(rel: string): string {
  const root = resolve(rootOf())
  const p = resolve(join(root, rel))
  if (p !== root && !p.startsWith(root + sep)) throw new Error(`路径越界：${rel}`)
  return p
}

let seq = 0
const makeId = () => `h-${Date.now().toString(36)}-${(++seq).toString(36)}`

function push(e: Entry) {
  stack.push(e)
  while (stack.length > MAX) stack.shift()
}

/** 单条快照的体积上限：超过就只记位置，不记正文，免得撤销栈吃掉几百 MB */
const SNAPSHOT_LIMIT = 400_000

export function recordMove(input: { moves: [string, string][]; patches: FilePatch[]; label: string; reqId?: string }) {
  if (!input.moves.length) return
  push({
    kind: 'move',
    id: makeId(),
    at: Date.now(),
    label: input.label,
    reqId: input.reqId,
    moves: input.moves,
    patches: input.patches.filter((p) => p.before.length + p.after.length <= SNAPSHOT_LIMIT)
  })
}

export function recordWrite(input: { path: string; before: string; after: string; label: string; reqId?: string }) {
  push({ kind: 'write', id: makeId(), at: Date.now(), ...input })
}

export function recordCreate(input: { path: string; label: string; reqId?: string }) {
  push({ kind: 'create', id: makeId(), at: Date.now(), ...input })
}

/** 某个 AI 请求改了什么，面板据此决定要不要显示「撤销这次操作」 */
export function infoFor(reqId: string): { count: number; labels: string[] } {
  const list = stack.filter((e) => e.reqId === reqId)
  return { count: list.length, labels: list.map((e) => e.label) }
}

function backPath(p: string, moves: [string, string][]) {
  for (const [from, to] of moves) {
    if (p === to) return from
    if (p.startsWith(`${to}/`)) return from + p.slice(to.length)
  }
  return p
}

async function undoEntry(
  e: Entry
): Promise<{ restored: number; skipped: number; note?: string; touched: string[] }> {
  if (e.kind === 'create') {
    try {
      await shell.trashItem(abs(e.path))
      return { restored: 1, skipped: 0, touched: [] }
    } catch {
      return { restored: 0, skipped: 1, note: '新建的文档已经不在了', touched: [] }
    }
  }

  if (e.kind === 'write') {
    try {
      const cur = await fsp.readFile(abs(e.path), 'utf8')
      // 撤销只回退「自己那一下」，之后又被改过就不动，绝不覆盖
      if (cur !== e.after) {
        return { restored: 0, skipped: 1, note: '文档之后又被改过，没有还原正文', touched: [] }
      }
      await fsp.writeFile(abs(e.path), e.before, 'utf8')
      return { restored: 1, skipped: 0, touched: [e.path] }
    } catch {
      return { restored: 0, skipped: 1, note: '文档已经不在了', touched: [] }
    }
  }

  let restored = 0
  let skipped = 0
  const touched: string[] = []

  // 1. 先把文件挪回原位。原位置若被别的东西占了，就跳过而不是覆盖
  for (const [from, to] of [...e.moves].reverse()) {
    try {
      await fsp.rename(abs(to), abs(from))
      restored++
    } catch {
      skipped++
    }
  }

  // 2. 再把被改写的正文还原。路径要按「挪回去之后」算
  for (const patch of e.patches) {
    const target = backPath(patch.path, e.moves)
    try {
      const cur = await fsp.readFile(abs(target), 'utf8')
      if (cur !== patch.after) {
        skipped++
        continue
      }
      await fsp.writeFile(abs(target), patch.before, 'utf8')
      restored++
      touched.push(target)
    } catch {
      skipped++
    }
  }

  return {
    restored,
    skipped,
    touched,
    note: skipped ? '有部分文件之后被改过，只还原了位置' : undefined
  }
}

/**
 * 撤销。传 reqId 就退掉那一轮 AI 的全部操作，不传就退最后一条。
 * 同一轮的多条事务按时间倒序退，保证「先挪回去、再还原正文」的顺序正确。
 */
export async function undoLast(reqId?: string): Promise<UndoResult> {
  const targets: number[] = []
  if (reqId) {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].reqId === reqId) targets.push(i)
  } else if (stack.length) {
    targets.push(stack.length - 1)
  }
  if (!targets.length) {
    return { ok: false, count: 0, restored: 0, skipped: 0, label: '', paths: [] }
  }

  const entries = targets.map((i) => stack[i])
  const moves: [string, string][] = []
  const touched: string[] = []
  let restored = 0
  let skipped = 0
  let note: string | undefined

  for (const e of entries) {
    const r = await undoEntry(e)
    restored += r.restored
    skipped += r.skipped
    touched.push(...r.touched)
    if (r.note && !note) note = r.note
    if (e.kind === 'move') {
      for (const [from, to] of [...e.moves].reverse()) moves.push([to, from])
    }
  }

  for (const i of [...targets].sort((a, b) => b - a)) stack.splice(i, 1)
  await notify(moves)

  return {
    ok: true,
    count: entries.length,
    restored,
    skipped,
    label: entries[entries.length - 1].label,
    note,
    paths: [...new Set(touched)]
  }
}
