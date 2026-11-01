import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import MessageBody from './MessageBody'
import { Icon } from './Icons'
import { SKILLS, buildSystemPrompt, estimateTokens, packContextFiles, unwrapFence } from '../lib/ai'
import type { AiSession, AiSessionMessage, DocMeta, ModelProfile, PlanStep, SkillDef, WriteProposal } from '../lib/types'

const BUDGET_STEPS = [8000, 16000, 32000, 64000, 128000]
const fmtK = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
const MAX_HISTORY = 12

function parseArgs(raw?: string): Record<string, any> {
  try {
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

const TOOL_LABEL: Record<string, (a: Record<string, any>) => string> = {
  list_tree: (a) => (a.dir ? `查看目录 ${a.dir}` : '查看目录结构'),
  list_docs: (a) => (a.query ? `找文档「${a.query}」` : '列出文档'),
  read_doc: (a) => `读取 ${a.path || ''}`,
  search_docs: (a) => `检索「${a.query || ''}」`,
  get_outline: (a) => `看大纲 ${a.path || ''}`,
  list_snippets: () => '查看片段库',
  list_clips: () => '查看剪贴板',
  fetch_url: (a) => `读网页 ${String(a.url || '').slice(0, 36)}`,
  create_doc: (a) => `新建《${a.title || ''}》`,
  edit_doc: (a) => `修改 ${a.path || ''}`,
  create_folder: (a) => `新建文件夹 ${a.name || ''}`,
  move_entry: (a) => `移动 ${a.path || ''}`,
  delete_entry: (a) => `删除 ${a.path || ''}`,
  replace_in_docs: (a) => `批量替换 ${Array.isArray(a.paths) ? a.paths.length : 0} 篇`,
  save_snippet: (a) => `存片段 ${a.title || ''}`,
  todo_write: () => '更新执行计划',
  ask_user: () => '向你确认',
  delegate: (a) => `派${a.role === 'writer' ? '写作者' : a.role === 'reviewer' ? '审校者' : '研究员'}`,
  list_skills: () => '查看技能包',
  load_skill: (a) => `加载技能 ${a.name || ''}`,
  create_skill: (a) => `新建技能 ${a.name || ''}`
}

function toolLabel(name: string, rawArgs?: string): string {
  if (name.startsWith('mcp__')) {
    const parts = name.split('__')
    return `MCP · ${parts[1] || ''} / ${parts.slice(2).join('_')}`
  }
  const meta = TOOL_LABEL[name]
  return meta ? meta(parseArgs(rawArgs)) : name
}

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
  onInsertAtCursor: (text: string) => void
  writes: WriteProposal[]
  onApplyWrite: (id: string) => void
  onDiscardWrite: (id: string) => void
  onPreviewWrite: (id: string) => void
  onReplaceDoc: (text: string) => void
  onNewDoc: (title: string, content: string) => void
  onCopy: (text: string, label?: string) => void
  onToast: (msg: string) => void
  /** 读取编辑器当前光标（path 与字符偏移），用于把「光标在哪」告诉模型 */
  readCaret?: () => { path: string | null; start: number }
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
    onInsertAtCursor,
    writes,
    onApplyWrite,
    onDiscardWrite,
    onPreviewWrite,
    onReplaceDoc,
    onNewDoc,
    onCopy,
    onToast,
    readCaret
  } = props

  const [sessions, setSessions] = useState<AiSession[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [attachDoc, setAttachDoc] = useState(true)
  const [attachSelection, setAttachSelection] = useState(true)
  const [selOpen, setSelOpen] = useState(false)
  const [live, setLive] = useState<{ reqId: string; id: string } | null>(null)
  const [menu, setMenu] = useState<'model' | 'history' | 'skills' | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [ctxOpen, setCtxOpen] = useState(false)
  const [ctxQuery, setCtxQuery] = useState('')
  const [docList, setDocList] = useState<DocMeta[]>([])
  const [budget, setBudgetState] = useState(() => {
    const raw = Number(localStorage.getItem('inkwell.ctxBudget'))
    return Number.isFinite(raw) && raw >= 4000 ? raw : 32000
  })
  const setBudget = useCallback((v: number) => {
    setBudgetState(v)
    localStorage.setItem('inkwell.ctxBudget', String(v))
  }, [])
  // 上下文预算不能超过模型自己的窗口，否则打包出来的内容会被服务端截断
  const modelCtx = models.find((m) => m.id === activeModelId)?.maxContext || 128000
  const budgetSteps = useMemo(() => {
    const fit = BUDGET_STEPS.filter((s) => s <= modelCtx)
    return fit.length ? fit : [Math.max(4000, Math.min(modelCtx, 8000))]
  }, [modelCtx])
  const budgetUsed = Math.min(budget, budgetSteps[budgetSteps.length - 1])
  const [toolNote, setToolNote] = useState<string | null>(null)
  const [ask, setAsk] = useState<{ id: string; question: string; options: { label: string; value: string }[]; multiple: boolean } | null>(null)
  const [skills, setSkills] = useState<SkillDef[]>([])
  const [mcpCount, setMcpCount] = useState(0)

  const listRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const pending = useRef<Map<string, { sessionId: string; messageId: string }>>(new Map())
  const contentCache = useRef<Map<string, string>>(new Map())
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
    window.api.extSkills().then(setSkills).catch(() => undefined)
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

  // ---------------------------------------------------------------- 上下文文档
  const contextPaths = session?.contextPaths || []

  const setContextPaths = useCallback(
    (next: string[]) => {
      const target = session || ensureSession()
      mutateSession(target.id, (s) => ({ ...s, contextPaths: next, updatedAt: Date.now() }))
    },
    [session, ensureSession, mutateSession]
  )

  const toggleContextPath = useCallback(
    (path: string) => {
      const now = session?.contextPaths || []
      setContextPaths(now.includes(path) ? now.filter((p) => p !== path) : [...now, path])
    },
    [session, setContextPaths]
  )

  const loadDocList = useCallback(async () => {
    const list = await window.api.listDocs()
    setDocList(list)
    return list
  }, [])

  const openPicker = useCallback(async () => {
    setCtxOpen(true)
    setCtxQuery('')
    if (!docList.length) await loadDocList()
  }, [docList.length, loadDocList])

  /** 读取选中文档的正文（带缓存，避免每轮重复读盘） */
  const readContextFiles = useCallback(async (paths: string[]) => {
    const out: { path: string; title: string; content: string }[] = []
    for (const p of paths) {
      let content = contentCache.current.get(p)
      if (content === undefined) {
        try {
          const res = await window.api.readDoc(p)
          content = res.content
          contentCache.current.set(p, content)
        } catch {
          continue
        }
      }
      const meta = docList.find((d) => d.path === p)
      out.push({ path: p, title: meta?.title || p.split('/').pop() || p, content })
    }
    return out
  }, [docList])

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
          usage: d.usage,
          ...(d.plan && d.plan.length ? { plan: d.plan } : {})
        })
        pending.current.delete(d.reqId)
        setLive(null)
        setToolNote(null)
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
        setToolNote(null)
      }),
      window.api.aiOnTool((d) => {
        if (d.status === 'unsupported') {
          setToolNote('当前模型不支持工具调用，本次只用了已带入的内容')
          return
        }
        if (!d.name) return
        const label = toolLabel(d.name, d.args)
        const prefix = d.depth ? '↳ ' : ''
        if (d.status === 'running') {
          setToolNote(d.sub ? `${label}（${d.sub}）中…` : `${label} 中…`)
          return
        }
        setToolNote(d.status === 'error' ? `${label} 失败` : `${label} 完成`)

        if (d.status === 'done' || d.status === 'error') {
          const target = pending.current.get(d.reqId)
          if (target) {
            mutateSession(target.sessionId, (s) => ({
              ...s,
              messages: s.messages.map((m) =>
                m.id === target.messageId
                  ? { ...m, tools: [...(m.tools || []), d.status === 'error' ? `${label}（失败）` : `${prefix}${label}`] }
                  : m
              )
            }))
          }
        }
      }),
      window.api.aiOnPlan((d) => {
        const target = pending.current.get(d.reqId)
        if (!target) return
        patchMessage(target.sessionId, target.messageId, { plan: d.steps as PlanStep[] })
        scrollToBottom()
      }),
      window.api.aiOnAsk((d) => {
        setAsk({ id: d.id, question: d.question, options: d.options, multiple: d.multiple })
      }),
      window.api.aiOnAskDrop((d) => {
        setAsk((cur) => (cur && cur.id === d.id ? null : cur))
      }),
      window.api.aiOnCtx((d) => {
        setToolNote(d.summarized ? '上下文过长，已把早期对话压缩成摘要' : `已折叠 ${d.folded || 0} 轮早期对话`)
      }),
      window.api.aiOnRetry((d) => {
        setToolNote(`网络中断，正在重试（${d.attempt}/${d.max}）`)
      }),
      window.api.aiOnMcp((d) => {
        setMcpCount(d.tools)
        if (d.tools) setToolNote(`已接入 ${d.tools} 个 MCP 工具`)
      })
    ]
    return () => offs.forEach((off) => off())
  }, [patchMessage, scrollToBottom, mutateSession])

  // ---------------------------------------------------------------- 发送
  const send = useCallback(
    async (text: string, opts: { display?: string; insertable?: boolean } = {}) => {
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

      mutateSession(current.id, (s) => ({
        ...s,
        title: s.messages.length === 0 ? (opts.display || content).replace(/\s+/g, ' ').slice(0, 28) : s.title,
        docPath: docPath || s.docPath,
        updatedAt: now,
        messages: [...s.messages, userMsg, assistantMsg]
      }))

      // 先把气泡挂上去，读盘与请求都在之后，避免界面卡住
      const reqId = uid()
      pending.current.set(reqId, { sessionId: current.id, messageId: assistantId })
      setLive({ reqId, id: assistantId })
      setToolNote(null)
      stickBottom.current = true
      requestAnimationFrame(scrollToBottom)

      const history = current.messages
        .filter((m) => m.content.trim() && !m.error)
        .slice(-MAX_HISTORY)
        .map((m) => ({ role: m.role, content: m.content }))

      try {
        const picked = await readContextFiles(contextPaths)
        if (attachDoc && docContent) {
          const idx = picked.findIndex((f) => f.path === docPath)
          const self = { path: docPath || docTitle || '当前文档', title: docTitle || '当前文档', content: docContent }
          if (idx >= 0) picked[idx] = self
          else picked.unshift(self)
        }
        const packed = packContextFiles(picked, budgetUsed)
        const skillText = skills.length
          ? skills.map((s) => `- ${s.name}${s.when ? ` — 适用：${s.when}` : s.description ? ` — ${s.description}` : ''}`).join('\n')
          : ''
        const caret = readCaret?.()
        const cursorHint =
          caret && docPath && caret.path === docPath && caret.start >= 0
            ? `用户光标在《${docTitle || '当前文档'}》第 ${caret.start + 1} 个字符处。`
            : ''
        const system = buildSystemPrompt({
          selection: attachSelection && selection ? selection : '',
          contextFiles: packed,
          // 工具能自己查目录，全库清单只在用户明确挑过文档时给，省上下文
          library:
            contextPaths.length && docList.length
              ? docList.map((d) => ({ path: d.path, title: d.title, size: d.size }))
              : undefined,
          skills: skillText,
          extra: cursorHint || undefined
        })

        await window.api.aiChat({
          reqId,
          profileId: activeModel.id,
          system,
          messages: [...history, { role: 'user', content }],
          tools: true,
          budget: budgetUsed
        })
      } catch (err) {
        patchMessage(current.id, assistantId, { error: String((err as Error)?.message || err) })
        pending.current.delete(reqId)
        setLive(null)
      }
    },
    [
      activeModel,
      live,
      ensureSession,
      mutateSession,
      docTitle,
      docContent,
      docPath,
      attachDoc,
      attachSelection,
      selection,
      onToast,
      patchMessage,
      contextPaths,
      budgetUsed,
      docList,
      readContextFiles,
      scrollToBottom,
      skills,
      readCaret
    ]
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
  const filteredDocs = useMemo(() => {
    const q = ctxQuery.trim().toLowerCase()
    const list = q
      ? docList.filter((d) => d.title.toLowerCase().includes(q) || d.path.toLowerCase().includes(q))
      : docList
    return list.slice(0, 200)
  }, [docList, ctxQuery])

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
              需要多篇一起看时，点下方「上下文」挑给 AI。
            </p>
            {skills.length > 0 && (
              <p className="ai-empty-skills">
                技能包：{skills.slice(0, 4).map((s) => s.name).join('、')}
                {skills.length > 4 ? ` 等 ${skills.length} 个` : ''}
              </p>
            )}
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

                {m.plan && m.plan.length > 0 && (
                  <div className="ai-plan">
                    <div className="ai-plan-head">
                      <Icon name="check" size={11} />
                      <span>
                        执行计划 {m.plan.filter((s) => s.status === 'done').length}/{m.plan.length}
                      </span>
                    </div>
                    <ol className="ai-plan-list">
                      {m.plan.map((s) => (
                        <li key={s.id} className={`is-${s.status}`}>
                          <span className="ai-plan-mark">
                            {s.status === 'done' ? <Icon name="check" size={9} /> : s.status === 'doing' ? <i /> : null}
                          </span>
                          <span>{s.text}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {m.tools?.length ? (
                  <details className="ai-tools-used">
                    <summary>
                      <Icon name="folder" size={11} />
                      <span>
                        {m.tools.slice(0, 3).join(' · ')}
                        {m.tools.length > 3 ? ` 等 ${m.tools.length} 步` : ''}
                      </span>
                    </summary>
                    <div className="ai-tools-all">
                      {m.tools.map((t, ti) => (
                        <span key={`${t}-${ti}`} className={t.startsWith('↳') ? 'is-sub' : ''}>
                          {t}
                        </span>
                      ))}
                    </div>
                  </details>
                ) : null}

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
                    <button className="is-primary" onClick={() => onInsertAtCursor(unwrapFence(m.content))} title="插入到刚才的光标位置（会保留你选中的文本范围）">
                      <Icon name="insert" size={12} /> 插入到光标处
                    </button>
                    <button onClick={() => onInsert(unwrapFence(m.content))} title="追加到文档末尾">
                      <Icon name="enter" size={12} /> 文末
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
        {ask && (
          <div className="ai-ask">
            <div className="ai-ask-q">{ask.question}</div>
            <div className="ai-ask-opts">
              {ask.options.map((o) => (
                <button
                  key={o.value}
                  onClick={() => {
                    window.api.aiAnswer(ask.id, o.value)
                    setAsk(null)
                  }}
                >
                  {o.label}
                </button>
              ))}
              <button
                className="ai-ask-skip"
                onClick={() => {
                  window.api.aiAnswer(ask.id, '（用户跳过了这个问题，请按你的判断继续）')
                  setAsk(null)
                }}
              >
                跳过
              </button>
            </div>
          </div>
        )}

        {writes.length > 0 && (
          <div className="ai-writes">
            {writes.map((w) => (
              <div className={`ai-write${w.kind === 'delete' ? ' is-delete' : ''}`} key={w.id}>
                <div className="ai-write-main">
                  <Icon name={w.kind === 'delete' ? 'trash' : 'pencil'} size={11} />
                  <span className="ai-write-title" title={w.path}>
                    {w.kind === 'delete' ? `删除《${w.title}》` : `建议修改《${w.title}》`}
                  </span>
                  <span className="ai-write-stat">
                    {w.kind === 'delete' ? <em className="is-del">进回收站</em> : <><em>+{w.add}</em> −{w.del}</>}
                  </span>
                </div>
                <div className="ai-write-actions">
                  {w.kind !== 'delete' && (
                    <button onClick={() => onPreviewWrite(w.id)} title="先看 diff 再决定">
                      看 diff
                    </button>
                  )}
                  <button className={w.kind === 'delete' ? 'is-danger' : 'is-primary'} onClick={() => onApplyWrite(w.id)}>
                    {w.kind === 'delete' ? '确认删除' : '应用'}
                  </button>
                  <button onClick={() => onDiscardWrite(w.id)}>忽略</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {selection && attachSelection && (
          <div className={`ai-sel${selOpen ? ' is-open' : ''}`}>
            <button className="ai-sel-head" onClick={() => setSelOpen((v) => !v)} title="展开 / 收起选中的原文">
              <Icon name="cursor" size={11} />
              <span>
                已带入选区 <b>{selection.length}</b> 字
              </span>
              <Icon name="chevron" size={11} />
            </button>
            <button
              className="ai-sel-drop"
              onClick={() => {
                setAttachSelection(false)
                setSelOpen(false)
              }}
              title="这次不带入选区"
            >
              <Icon name="close" size={10} />
            </button>
            {selOpen && (
              <pre className="ai-sel-body">{selection.length > 1600 ? `${selection.slice(0, 1600)}\n…` : selection}</pre>
            )}
          </div>
        )}

        {ctxOpen && (
          <div className="ctx-pop">
            <div className="ctx-head">
              <span>带入上下文的文档</span>
              <button className="icon-btn tiny" onClick={() => setCtxOpen(false)} title="关闭">
                <Icon name="close" size={11} />
              </button>
            </div>
            <div className="ctx-search">
              <Icon name="search" size={12} />
              <input
                autoFocus
                value={ctxQuery}
                onChange={(e) => setCtxQuery(e.target.value)}
                placeholder="搜索标题或路径"
              />
              {ctxQuery && (
                <button className="icon-btn tiny" onClick={() => setCtxQuery('')}>
                  <Icon name="close" size={10} />
                </button>
              )}
            </div>
            <div className="ctx-list">
              {filteredDocs.length === 0 && <div className="ctx-empty">没有匹配的文档</div>}
              {filteredDocs.map((d) => {
                const on = contextPaths.includes(d.path)
                return (
                  <button
                    key={d.path}
                    className={`ctx-row${on ? ' is-on' : ''}`}
                    onClick={() => toggleContextPath(d.path)}
                    title={d.path}
                  >
                    <span className="ctx-check">{on && <Icon name="check" size={10} />}</span>
                    <span className="ctx-name">
                      {d.title}
                      <small>{d.path}</small>
                    </span>
                    <span className="ctx-size">{d.size > 1000 ? `${Math.round(d.size / 1000)}k` : d.size} 字</span>
                  </button>
                )
              })}
            </div>
            <div className="ctx-foot">
              <div className="ctx-budget">
                <span>预算</span>
                <input
                  type="range"
                  min={0}
                  max={budgetSteps.length - 1}
                  step={1}
                  value={Math.max(0, budgetSteps.indexOf(budgetUsed))}
                  onChange={(e) => setBudget(budgetSteps[Number(e.target.value)])}
                />
                <b>{fmtK(budgetUsed)}</b>
              </div>
              <button
                className="btn-primary"
                onClick={() => {
                  setCtxOpen(false)
                  if (!contextPaths.length) onToast('已清空上下文，只带当前文档')
                }}
              >
                完成
              </button>
            </div>
          </div>
        )}

        <div className="ai-chips">
          <button
            className={`ai-tag${contextPaths.length ? ' is-on' : ''}`}
            onClick={() => (ctxOpen ? setCtxOpen(false) : openPicker())}
            title="选择要一起带给 AI 的文档（本会话有效）"
          >
            <Icon name="folder" size={11} />
            上下文{contextPaths.length ? ` ${contextPaths.length}` : ''}
          </button>
          {contextPaths.slice(0, 1).map((p) => (
            <span key={p} className="ai-file" title={p}>
              <span>{p.split('/').pop()}</span>
              <button onClick={() => toggleContextPath(p)} title="移出上下文">
                <Icon name="close" size={9} />
              </button>
            </span>
          ))}
          {contextPaths.length > 1 && <span className="ai-file more">+{contextPaths.length - 1}</span>}
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

        {toolNote && (
          <div className="ai-tool-note">
            <span className="ai-tool-dot" />
            {toolNote}
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
