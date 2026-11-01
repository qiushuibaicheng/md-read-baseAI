import type { ModelProfile } from './types'
import { once, describeError } from './client'

/** 粗略估算 token：中文按 1 字 ≈ 0.68 token，英文按 3.6 字符 ≈ 1 token */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  return Math.round(cjk * 0.68 + (text.length - cjk) / 3.6)
}

const textOf = (m: any): string => (typeof m?.content === 'string' ? m.content : '')

/**
 * 历史折叠。
 *
 * 长对话不可能一直原样带下去。这里做「按轮次折叠」而不是逐条截断——
 * assistant 的 tool_calls 和随后的 tool 消息必须同生同灭，否则请求会被服务端拒绝。
 * 最近 keepTurns 轮保持完整，更早的压成一行摘要留在 system 里。
 */
export function foldMessages(
  messages: any[],
  budgetTokens: number,
  keepTurns = 3
): { messages: any[]; folded: number; savedTokens: number } {
  if (!messages.length) return { messages, folded: 0, savedTokens: 0 }
  const before = messages.reduce((n, m) => n + estimateTokens(textOf(m)) + 8, 0)
  if (before <= budgetTokens * 0.5) return { messages, folded: 0, savedTokens: 0 }

  // 第一条 system 单独保留
  const head: any[] = []
  let start = 0
  if (messages[0]?.role === 'system') {
    head.push(messages[0])
    start = 1
  }

  const turns: any[][] = []
  for (let i = start; i < messages.length; i++) {
    const m = messages[i]
    if (m.role === 'user' || turns.length === 0) turns.push([m])
    else turns[turns.length - 1].push(m)
  }

  const keepFrom = Math.max(0, turns.length - keepTurns)
  const old = turns.slice(0, keepFrom)
  const recent = turns.slice(keepFrom)
  if (!old.length) return { messages, folded: 0, savedTokens: 0 }

  const lines: string[] = []
  for (const turn of old) {
    const user = turn.find((m) => m.role === 'user')
    const tools = turn.filter((m) => m.role === 'tool').length
    const calls: string[] = []
    for (const m of turn) {
      for (const c of m.tool_calls || []) calls.push(c.function?.name || '工具')
    }
    const answer = [...turn].reverse().find((m) => m.role === 'assistant' && textOf(m).trim())
    const q = clip(textOf(user), 160)
    const a = clip(textOf(answer), 260)
    const meta = calls.length ? `（用了 ${[...new Set(calls)].slice(0, 6).join('、')}${tools > 6 ? ' 等' : ''}）` : ''
    if (!q && !a) continue
    lines.push(`- 问：${q || '（无）'}${meta}\n  答：${a || '（只调用了工具，未给结论）'}`)
  }

  const note = {
    role: 'system',
    content: `以下是本次对话更早的 ${old.length} 轮，已折叠成摘要（原文不再占用上下文；需要细节可以重新读文档）：\n${lines.join('\n')}`
  }
  const next = [...head, note, ...recent.flat()]
  const after = next.reduce((n, m) => n + estimateTokens(textOf(m)) + 8, 0)
  return { messages: next, folded: old.length, savedTokens: Math.max(0, before - after) }
}

function clip(text: string, max: number): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/**
 * 真正的摘要压缩：历史还压不下去时，让模型自己写一段「前面聊了什么」。
 * 失败就退回折叠结果，不因为压缩不了而中断对话。
 */
export async function summarize(
  profile: ModelProfile,
  messages: any[],
  budgetTokens: number
): Promise<{ messages: any[]; note: string }> {
  const head: any[] = []
  let start = 0
  if (messages[0]?.role === 'system') {
    head.push(messages[0])
    start = 1
  }
  const body = messages.slice(start)
  if (body.length < 8) return { messages, note: '' }

  // 留最近 4 条，其余喂给摘要
  const tail = body.slice(-4)
  const source = body.slice(0, -4)
  const raw = source
    .map((m) => {
      const who = m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : `工具(${m.name || ''})`
      return `${who}：${clip(textOf(m) || JSON.stringify(m.tool_calls || ''), 600)}`
    })
    .join('\n')
    .slice(0, 12000)

  try {
    const { text } = await once(
      profile,
      [
        {
          role: 'system',
          content:
            '把下面的对话压缩成要点摘要，供后续对话继续使用。要求：保留用户的目标、已经确认的事实、已经做过的改动（文件名与改动要点）、尚未完成的待办。不要评价，不要客套，300 字以内，用 Markdown 无序列表。'
        },
        { role: 'user', content: raw }
      ],
      600,
      25000,
      true
    )
    if (!text.trim()) return { messages, note: '' }
    const note = { role: 'system', content: `以下是更早对话的摘要（原文已压缩）：\n${text.trim()}` }
    const next = [...head, note, ...tail]
    const after = next.reduce((n, m) => n + estimateTokens(textOf(m)) + 8, 0)
    // 只有真的变小才替换，否则保持原样
    const before = messages.reduce((n, m) => n + estimateTokens(textOf(m)) + 8, 0)
    if (after >= before || after > budgetTokens) return { messages, note: '' }
    return { messages: next, note: text.trim() }
  } catch (err) {
    return { messages, note: describeError(err) }
  }
}
