import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import MessageBody from './MessageBody'
import { Icon } from './Icons'
import { SKILLS, buildSystemPrompt, estimateTokens, unwrapFence } from '../lib/ai'
import type { AiSession, AiSessionMessage, ModelProfile } from '../lib/types'

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
const MAX_HISTORY = 12

export interface AiPanelHandle {
  runSkill: (id: string, input?: string) => void
  ask: (text: string, display?: string) => void
  focus: () => void
}

interface Props {
  open: boolean
  width: number
  theme: 'light' | 'dark'
  models: ModelProfile[]
  activeModelId: string | null
  docPath: string | null
  docTitle: string
  docContent: string
  selection: string | null
  onClose: () => void
  onResize: (width: number) => void
  onPickModel: (id: string) => void
  onManageModels: () => void
  onInsert: (text: string) => void
  onReplaceDoc: (text: string) => void
  onNewDoc: (title: string, content: string) => void
  onCopy: (text: string, label?: string) => void
  onToast: (msg: string) => void
}

export default forwardRef<AiPanelHandle, Props>(function AiPanel(props, ref) {
  const {
    open,
    width,
    theme,
    models,
    activeModelId,
    docPath,
    docTitle,
    docContent,
    selection,
    onClose,
    onResize,
    onPickModel,
    onManageModels,
    onInsert,
    onReplaceDoc,
    onNewDoc,
    onCopy,
    onToast
  } = props

  const [sessions, setSessions] = useState<AiSession[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [attachDoc, setAttachDoc] = useState(true)
  const [attachSelection, setAttachSelection] = useState(true)
  const [live, setLive] = useState<{ reqId: string; id: string } | null>(null)
  const [menu, setMenu] = useState<'model' | 'history' | 'skills' | null>(null)
  const [loaded, setLoaded] = useState(false)

  const listRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const pending = useRef<Map<string, { sessionId: string; messageId: string }>>(new Map())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stickBottom = useRef(true)

  const activeModel = useMemo(() => models.find((m) => m.id === activeModelId) || null, [models, activeModelId])
  const session = useMemo(() => sessions.find((s) => s.id === sessionId) || null, [sessions, sessionId])
  const messages = session?.messages || []

  // ---------------------------------------------------------------- 会话加载 / 保存
  useEffect(() => {
    if (!open || loaded) return
    setLoaded(true)
    window.api.aiSessions().then((list) => {
      setSessions(list)
      if (list.length) setSessionId(list[0].id)
    })
  }, [open, loaded])

  const persist = useCallback((next: AiSession[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => window.api.aiSaveSessions(next), 500)
  }, [])

  const mutateSession = useCallback(
    (id: string, fn: (s: AiSession) => AiSession) => {
      setSessions((prev) => prev.map((s) => (s.id === id ? fn(s) : s)))
    },
    []
  )

  // 任何会话变化都落盘（节流）
  useEffect(() => {
    if (!loaded) return
    persist(sessions)
  }, [sessions, loaded, persist])

  const patchMessage = useCallback(
    (sid: string, mid: string, patch: Partial<AiSessionMessage>) => {
      mutateSession(sid, (s) => ({
        ...s,
        updatedAt: Date.now(),
        messages: s.messages.map((m) => (m.id === mid ? { ...m, ...patch } : m))
      }))
    },
    [mutateSession]
  )

  const ensureSession = useCallback((): AiSession => {
    if (session) return session
    const fresh: AiSession = {
      id: uid(),
      title: '新对话',
      docPath,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    setSessions((prev) => [fresh, ...prev])
    setSessionId(fresh.id)
    return fresh
  }, [session, docPath])

  // ---------------------------------------------------------------- 流式事件
  const scrollToBottom = useCallback(() => {
    if (!stickBottom.current) return
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  useEffect(() => {
    const offs = [
      window.api.aiOnStream((d) => {
        const target = pending.current.get(d.reqId)
        if (!target) return
        patchMessage(target.sessionId, target.messageId, { content: d.text, reasoning: d.reasoning })
        scrollToBottom()
      }),
      window.api.aiOnDone((d) => {
        const target = pending.current.get(d.reqId)
        if (!target) return
        patchMessage(target.sessionId, target.messageId, {
          content: d.text,
          reasoning: d.reasoning,
          usage: d.usage
        })
        pending.current.delete(d.reqId)
        setLive(null)
        scrollToBottom()
      }),
      window.api.aiOnError((d) => {
        const target = pending.current.get(d.reqId)
        if (!target) return
        patchMessage(target.sessionId, target.messageId, { error: d.message })
        pending.current.delete(d.reqId)
        setLive(null)
      }),
      window.api.aiOnAborted((d) => {
        const target = pending.current.get(d.reqId)
        if (!target) return
        pending.current.delete(d.reqId)
        setLive(null)
      })
    ]
    return () => offs.forEach((off) => off())
  }, [patchMessage, scrollToBottom])

  // ---------------------------------------------------------------- 发送
  const send = useCallback(
    (text: string, opts: { display?: string; insertable?: boolean } = {}) => {
      const content = text.trim()
      if (!content || live) return
      if (!activeModel) {
        onToast('先添加一个模型')
        return
      }

      const current = ensureSession()
      const now = Date.now()
      const userMsg: AiSessionMessage = {
        id: uid(),
        role: 'user',
        content: opts.display || content,
        time: now
      }
      const assistantId = uid()
      const assistantMsg: AiSessionMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        time: now,
        model: activeModel.model
      }

      const history = current.messages
        .filter((m) => m.content.trim() && !m.error)
        .slice(-MAX_HISTORY)
        .map((m) => ({ role: m.role, content: m.content }))

      const system = buildSystemPrompt({
        docTitle,
        docContent: attachDoc ? docContent : '',
        selection: attachSelection && selection ? selection : ''
      })

      mutateSession(current.id, (s) => ({
        ...s,
        title: s.messages.length === 0 ? (opts.display || content).replace(/\s+/g, ' ').slice(0, 28) : s.title,
        docPath: docPath || s.docPath,
        updatedAt: now,
        messages: [...s.messages, userMsg, assistantMsg]
      }))

      const reqId = uid()
      pending.current.set(reqId, { sessionId: current.id, messageId: assistantId })
      setLive({ reqId, id: assistantId })
      stickBottom.current = true

      window.api
        .aiChat({
          reqId,
          profileId: activeModel.id,
          system,
          messages: [...history, { role: 'user', content }]
        })
        .catch((err) => {
          patchMessage(current.id, assistantId, { error: String(err?.message || err) })
          setLive(null)
        })
    },
    [activeModel, live, ensureSession, mutateSession, docTitle, docContent, docPath, attachDoc, attachSelection, selection, onToast, patchMessage]
  )

  useImperativeHandle(
    ref,
    () => ({
      runSkill: (id: string, input?: string) => {
        const skill = SKILLS.find((s) => s.id === id)
        if (!skill) return
        setInput('')
        send(skill.build({ docTitle, docContent, selection: selection || '' }, input ?? ''), {
          display: input?.trim() ? `${skill.label}：${input.trim().slice(0, 40)}` : skill.label
        })
      },
      ask: (text: string, display?: string) => send(text, { display: display || text }),
      focus: () => inputRef.current?.focus()
    }),
    [send, docTitle, docContent, selection]
  )

  const submit = () => {
    if (!input.trim() || live) return
    const text = input.trim()
    setInput('')
    send(text)
  }

  const stop = () => {
    if (live) window.api.aiAbort(live.reqId)
  }

  const newChat = () => {
    const fresh: AiSession = {
      id: uid(),
      title: '新对话',
      docPath,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    setSessions((prev) => [fresh, ...prev])
    setSessionId(fresh.id)
    setMenu(null)
    setTimeout(() => inputRef.current?.focus(), 60)
  }

  const removeSession = (id: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id)
      if (sessionId === id) setSessionId(next[0]?.id || null)
      return next
    })
  }

  // ---------------------------------------------------------------- 拖拽宽度
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    const move = (ev: MouseEvent) => {
      const next = Math.min(680, Math.max(320, startW - (ev.clientX - startX)))
      onResize(next)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // ---------------------------------------------------------------- 渲染
  const contextTokens = useMemo(() => {
    if (!attachDoc) return 0
    return estimateTokens(docContent)
  }, [attachDoc, docContent])

  const applyToDoc = (text: string) => {
    onReplaceDoc(unwrapFence(text))
  }

  return (
    <aside className={`ai-panel${open ? ' is-open' : ''}`} style={{ width: open ? width : 0 }}>
      <div className="ai-resize" onMouseDown={startResize} />
      <header className="ai-head">
        <div className="ai-title">
          <span className="ai-mark">
            <Icon name="sparkle" size={13} />
          </span>
          <span>AI 助手</span>
        </div>
        <div className="ai-head-actions">
          <button
            className={`ai-chip${menu === 'model' ? ' is-open' : ''}`}
            onClick={() => setMenu(menu === 'model' ? null : 'model')}
            title="切换模型"
          >
            <span className={`ai-dot${activeModel ? ' is-on' : ''}`} />
            {activeModel?.name || '未配置模型'}
            <Icon name="chevron" size={11} />
          </button>
          <button
            className={`icon-btn tiny${menu === 'history' ? ' is-on' : ''}`}
            onClick={() => setMenu(menu === 'history' ? null : 'history')}
            title="对话历史"
          >
            <Icon name="history" size={14} />
          </button>
          <button className="icon-btn tiny" onClick={newChat} title="新对话">
            <Icon name="plus" size={14} />
          </button>
          <button className="icon-btn tiny" onClick={onClose} title="收起 (Ctrl+J)">
            <Icon name="close" size={13} />
          </button>
        </div>
      </header>

      {menu === 'model' && (
        <div className="ai-popover model-list">
          {models.length === 0 && <div className="ai-pop-empty">还没有模型</div>}
          {models.map((m) => (
            <button
              key={m.id}
              className={`model-row${m.id === activeModelId ? ' is-active' : ''}`}
              onClick={() => {
                onPickModel(m.id)
                setMenu(null)
              }}
            >
              <span className="model-name">{m.name}</span>
              <span className="model-id">{m.model}</span>
            </button>
          ))}
          <button
            className="model-row manage"
            onClick={() => {
              setMenu(null)
              onManageModels()
            }}
          >
            <Icon name="settings" size={13} /> 管理模型…
          </button>
        </div>
      )}

      {menu === 'history' && (
        <div className="ai-popover history-list">
          {sessions.length === 0 && <div className="ai-pop-empty">还没有对话</div>}
          {sessions.map((s) => (
            <div key={s.id} className={`history-row${s.id === sessionId ? ' is-active' : ''}`}>
              <button
                className="history-main"
                onClick={() => {
                  setSessionId(s.id)
                  setMenu(null)
                }}
              >
                <span className="history-title">{s.title || '未命名对话'}</span>
                <span className="history-sub">
                  {s.messages.filter((m) => m.role === 'user').length} 轮 · {new Date(s.updatedAt).toLocaleDateString('zh-CN')}
                </span>
              </button>
              <button className="history-del" onClick={() => removeSession(s.id)} title="删除">
                <Icon name="trash" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        className="ai-list"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        {messages.length === 0 && (
          <div className="ai-empty">
            <div className="ai-empty-mark">
              <Icon name="sparkle" size={20} />
            </div>
            <h3>让 AI 读懂这篇记录</h3>
            <p>
              {docTitle ? `当前文档：${docTitle}` : '选一篇文档，或直接问我任何问题'}
              <br />
              它会带着全文和你的选区作为上下文回答。
            </p>
            <div className="skill-grid">
              {SKILLS.map((s) => (
                <button key={s.id} className="skill-card" onClick={() => send(s.build({ docTitle, docContent, selection: selection || '' }, ''), { display: s.label })}>
                  <span className="skill-label">{s.label}</span>
                  <span className="skill-hint">{s.hint}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={m.id} className={`ai-msg is-${m.role}`}>
            {m.role === 'user' ? (
              <div className="ai-bubble user">{m.content}</div>
            ) : (
              <div className="ai-answer">
                <div className="ai-answer-head">
                  <span className="ai-avatar">
                    <Icon name="sparkle" size={11} />
                  </span>
                  <span className="ai-answer-model">{m.model || 'AI'}</span>
                  {m.usage && (
                    <span className="ai-usage">
                      {m.usage.prompt + m.usage.completion} tok
                    </span>
                  )}
                </div>

                {m.reasoning ? (
                  <details className="ai-reasoning">
                    <summary>思考过程</summary>
                    <pre>{m.reasoning}</pre>
                  </details>
                ) : null}

                {m.content ? (
                  <MessageBody text={m.content} theme={theme} onCopy={onCopy} />
                ) : m.error ? null : (
                  <div className="ai-thinking">
                    <span />
                    <span />
                    <span />
                    <em>正在生成…</em>
                  </div>
                )}

                {m.error && (
                  <div className="ai-error">
                    <Icon name="alert" size={13} />
                    <span>{m.error}</span>
                  </div>
                )}

                {m.content && !live && (
                  <div className="ai-msg-actions">
                    <button onClick={() => onCopy(m.content, '已复制回答')}>
                      <Icon name="copy" size={12} /> 复制
                    </button>
                    <button onClick={() => onInsert(unwrapFence(m.content))}>
                      <Icon name="insert" size={12} /> 插入
                    </button>
                    <button onClick={() => applyToDoc(m.content)}>
                      <Icon name="diff" size={12} /> 替换全文
                    </button>
                    <button onClick={() => onNewDoc(m.content.split('\n')[0].replace(/^#+\s*/, '').slice(0, 20) || 'AI 草稿', unwrapFence(m.content))}>
                      <Icon name="doc" size={12} /> 新文档
                    </button>
                    {i === messages.length - 1 && (
                      <button
                        onClick={() => {
                          const prevUser = [...messages].reverse().find((x) => x.role === 'user')
                          if (prevUser) send(prevUser.content, { display: prevUser.content })
                        }}
                        title="重新生成"
                      >
                        <Icon name="refresh" size={12} /> 重试
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="ai-composer">
        <div className="ai-chips">
          <button
            className={`ai-tag${attachDoc ? ' is-on' : ''}`}
            onClick={() => setAttachDoc((v) => !v)}
            title="把当前文档全文作为上下文"
          >
            <Icon name="doc" size={11} />
            本文
            {attachDoc && <em>{contextTokens} tok</em>}
          </button>
          {selection && (
            <button
              className={`ai-tag${attachSelection ? ' is-on' : ''}`}
              onClick={() => setAttachSelection((v) => !v)}
              title="把预览里选中的片段作为上下文"
            >
              <Icon name="cursor" size={11} />
              选区 {selection.length} 字
            </button>
          )}
          <button className="ai-tag ghost" onClick={() => setMenu(menu === 'skills' ? null : 'skills')}>
            <Icon name="wand" size={11} /> 动作
          </button>
        </div>

        {menu === 'skills' && (
          <div className="skill-menu">
            {SKILLS.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setMenu(null)
                  send(s.build({ docTitle, docContent, selection: selection || '' }, input), { display: s.label })
                  setInput('')
                }}
              >
                <span>{s.label}</span>
                <small>{s.hint}</small>
              </button>
            ))}
          </div>
        )}

        <div className="ai-input-wrap">
          <textarea
            ref={inputRef}
            className="ai-input"
            value={input}
            rows={1}
            placeholder={activeModel ? '问点什么…  Enter 发送 / Shift+Enter 换行' : '先在设置里添加模型'}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
          />
          {live ? (
            <button className="ai-send is-stop" onClick={stop} title="停止生成">
              <Icon name="stop" size={14} />
            </button>
          ) : (
            <button className="ai-send" onClick={submit} disabled={!input.trim() || !activeModel} title="发送 (Enter)">
              <Icon name="send" size={14} />
            </button>
          )}
        </div>
        <div className="ai-foot">
          <span>{activeModel ? `${activeModel.model} · ${activeModel.temperature}°` : '未配置模型'}</span>
          <button className="ai-foot-link" onClick={onManageModels}>
            模型设置
          </button>
        </div>
      </div>
    </aside>
  )
})
