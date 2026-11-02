import { useEffect, useState } from 'react'
import { Icon } from './Icons'
import type { AppConfig, BrokenLink, LinkStats, McpStatus, ModelProfile, SkillDef } from '../lib/types'

interface Props {
  open: boolean
  config: AppConfig
  hotkeyActive: string | null
  version: string
  packaged: boolean
  models: ModelProfile[]
  onChange: (patch: Partial<AppConfig>) => void
  onPickVault: () => void
  onOpenVault: () => void
  onManageModels: () => void
  onQuit: () => void
  onClose: () => void
}

const ACCENTS: { id: string; color: string; label: string }[] = [
  { id: 'indigo', color: '#6b8cff', label: '靛蓝' },
  { id: 'violet', color: '#a97bff', label: '紫罗兰' },
  { id: 'emerald', color: '#3fd6a8', label: '翡翠' },
  { id: 'amber', color: '#ffb454', label: '琥珀' },
  { id: 'rose', color: '#ff7a9c', label: '玫瑰' }
]

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`toggle${on ? ' is-on' : ''}`} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <span className="knob" />
    </button>
  )
}

function normalizeKey(key: string): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta', 'CapsLock'].includes(key)) return null
  if (key === ' ') return 'Space'
  if (key === 'Escape') return 'Esc'
  if (key === 'ArrowUp') return 'Up'
  if (key === 'ArrowDown') return 'Down'
  if (key === 'ArrowLeft') return 'Left'
  if (key === 'ArrowRight') return 'Right'
  if (key.length === 1) return key.toUpperCase()
  return key
}

export default function SettingsDialog({
  open,
  config,
  hotkeyActive,
  version,
  packaged,
  models,
  onChange,
  onPickVault,
  onOpenVault,
  onManageModels,
  onQuit,
  onClose
}: Props) {
  const [recording, setRecording] = useState(false)
  const [draft, setDraft] = useState(config.hotkey)
  const [skills, setSkills] = useState<SkillDef[]>([])
  const [mcpText, setMcpText] = useState('')
  const [mcpStatus, setMcpStatus] = useState<McpStatus[]>([])
  const [mcpErr, setMcpErr] = useState('')
  const [mcpBusy, setMcpBusy] = useState(false)
  const [linkStats, setLinkStats] = useState<LinkStats | null>(null)
  const [brokenList, setBrokenList] = useState<BrokenLink[] | null>(null)
  const [linkBusy, setLinkBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    window.api.linksStats().then(setLinkStats).catch(() => undefined)
  }, [open])

  const reindexLinks = async () => {
    setLinkBusy(true)
    try {
      setLinkStats(await window.api.linksReindex())
      if (brokenList) setBrokenList(await window.api.linksBroken())
    } finally {
      setLinkBusy(false)
    }
  }

  const toggleBroken = async () => {
    if (brokenList) {
      setBrokenList(null)
      return
    }
    setBrokenList(await window.api.linksBroken())
  }

  useEffect(() => {
    if (!open) return
    window.api.extSkills().then(setSkills).catch(() => undefined)
    window.api
      .extMcpConfig()
      .then((cfg) => setMcpText(JSON.stringify(cfg, null, 2)))
      .catch(() => undefined)
    window.api.extMcpStatus().then(setMcpStatus).catch(() => undefined)
  }, [open])

  useEffect(() => setDraft(config.hotkey), [config.hotkey])
  useEffect(() => {
    if (!open) setRecording(false)
  }, [open])

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(false)
        setDraft(config.hotkey)
        return
      }
      const key = normalizeKey(e.key)
      if (!key) return
      const parts: string[] = []
      if (e.ctrlKey) parts.push('Ctrl')
      if (e.altKey) parts.push('Alt')
      if (e.shiftKey) parts.push('Shift')
      if (e.metaKey) parts.push('Super')
      if (parts.length === 0) return
      const accel = [...parts, key].join('+')
      setRecording(false)
      setDraft(accel)
      onChange({ hotkey: accel })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, config.hotkey, onChange])

  if (!open) return null

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="settings" onMouseDown={(e) => e.stopPropagation()}>
        <header className="settings-head">
          <div>
            <h2>偏好设置</h2>
            <p>调整召唤方式与阅读体验</p>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className="settings-body">
          <section>
            <div className="setting-row">
              <div className="setting-label">
                <span>全局快捷键</span>
                <small>在任意应用中召出 Inkwell</small>
              </div>
              <button
                className={`hotkey-input${recording ? ' is-recording' : ''}`}
                onClick={() => setRecording(true)}
                onKeyDown={(e) => e.stopPropagation()}
              >
                {recording ? '按下组合键…' : draft}
              </button>
            </div>
            {hotkeyActive === null && <div className="setting-warn">该快捷键被其他程序占用，请换一个</div>}
          </section>

          <section>
            <div className="setting-row">
              <div className="setting-label">
                <span>主题</span>
                <small>深色适合长时间排查</small>
              </div>
              <div className="segmented inline">
                <button
                  className={`seg-btn${config.themeMode === 'light' ? ' is-active' : ''}`}
                  onClick={() => onChange({ themeMode: 'light' })}
                >
                  <Icon name="sun" size={14} /> 浅色
                </button>
                <button
                  className={`seg-btn${config.themeMode === 'dark' ? ' is-active' : ''}`}
                  onClick={() => onChange({ themeMode: 'dark' })}
                >
                  <Icon name="moon" size={14} /> 深色
                </button>
                <button
                  className={`seg-btn${config.themeMode === 'system' ? ' is-active' : ''}`}
                  onClick={() => onChange({ themeMode: 'system' })}
                >
                  跟随系统
                </button>
              </div>
            </div>

            <div className="setting-row">
              <div className="setting-label">
                <span>强调色</span>
                <small>影响按钮、光标与图表配色</small>
              </div>
              <div className="accent-row">
                {ACCENTS.map((a) => (
                  <button
                    key={a.id}
                    className={`accent-dot${config.accent === a.id ? ' is-active' : ''}`}
                    style={{ background: a.color }}
                    onClick={() => onChange({ accent: a.id })}
                    title={a.label}
                  />
                ))}
              </div>
            </div>

            <div className="setting-row">
              <div className="setting-label">
                <span>动态背景</span>
                <small>three.js 点阵波场，关闭更省电</small>
              </div>
              <Toggle on={config.threeBg} onChange={(v) => onChange({ threeBg: v })} />
            </div>

            <div className="setting-row">
              <div className="setting-label">
                <span>正文字号</span>
                <small>{config.fontSize}px</small>
              </div>
              <input
                className="range"
                type="range"
                min={12}
                max={20}
                step={1}
                value={config.fontSize}
                onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
              />
            </div>
          </section>

          <section>
            <div className="setting-row">
              <div className="setting-label">
                <span>AI 模型</span>
                <small>兼容 OpenAI 协议，可配多个切换</small>
              </div>
              <div className="model-picker">
                {models.length === 0 && <span className="model-empty">还没有模型</span>}
                {models.map((m) => (
                  <button
                    key={m.id}
                    className={`model-pill${config.aiModelId === m.id ? ' is-active' : ''}`}
                    onClick={() => onChange({ aiModelId: m.id })}
                    title={m.model}
                  >
                    {m.name}
                  </button>
                ))}
                <button className="btn-ghost small" onClick={onManageModels}>
                  <Icon name="plus" size={12} /> 管理
                </button>
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-label">
                <span>自动起标题</span>
                <small>新建文档首次保存时，用模型生成标题</small>
              </div>
              <Toggle on={config.aiAutoTitle} onChange={(v) => onChange({ aiAutoTitle: v })} />
            </div>
          </section>

          <section>
            <div className="setting-row">
              <div className="setting-label">
                <span>失去焦点自动收起</span>
                <small>像 uTools 一样，不打断当前工作</small>
              </div>
              <Toggle on={config.hideOnBlur} onChange={(v) => onChange({ hideOnBlur: v })} />
            </div>
            <div className="setting-row">
              <div className="setting-label">
                <span>窗口置顶</span>
                <small>让 Inkwell 一直浮在其他窗口之上</small>
              </div>
              <Toggle on={config.alwaysOnTop} onChange={(v) => onChange({ alwaysOnTop: v })} />
            </div>
            <div className="setting-row">
              <div className="setting-label">
                <span>记录剪贴板</span>
                <small>保留最近 80 条复制的文本，仅在本地</small>
              </div>
              <Toggle on={config.clipboardWatch} onChange={(v) => onChange({ clipboardWatch: v })} />
            </div>
            {packaged && (
              <div className="setting-row">
                <div className="setting-label">
                  <span>开机自动启动</span>
                  <small>后台常驻，随时用快捷键召出</small>
                </div>
                <Toggle on={config.autoLaunch} onChange={(v) => onChange({ autoLaunch: v })} />
              </div>
            )}
          </section>

          <section>
            <div className="setting-row column">
              <div className="setting-label">
                <span>笔记目录</span>
                <small>所有内容以 .md 纯文本保存在这里</small>
              </div>
              <div className="path-box">
                <code>{config.vaultPath}</code>
                <button className="btn-ghost" onClick={onOpenVault}>
                  打开
                </button>
                <button className="btn-ghost" onClick={onPickVault}>
                  更换
                </button>
              </div>
            </div>
          </section>

          <section>
            <div className="setting-row column">
              <div className="setting-label">
                <span>链接索引</span>
                <small>
                  文档里的 []() 与 [[ ]] 会被解析成一张引用图。AI 读文档时直接拿到「它引用了谁、被谁引用」，点击预览里的链接也能直接跳转
                </small>
              </div>
              <div className="link-stats">
                <span>{linkStats ? `${linkStats.docs} 篇` : '统计中…'}</span>
                {linkStats && <span>{linkStats.edges} 条引用</span>}
                {linkStats && linkStats.broken > 0 && (
                  <span className="link-bad">{linkStats.broken} 处断链</span>
                )}
                {linkStats && linkStats.ambiguous > 0 && (
                  <span className="link-warn">{linkStats.ambiguous} 处歧义</span>
                )}
                {linkStats && <span className="link-ms">{linkStats.ms} ms</span>}
                <button className="btn-ghost" onClick={reindexLinks} disabled={linkBusy}>
                  {linkBusy ? '重建中…' : '重建'}
                </button>
                {linkStats && linkStats.broken + linkStats.ambiguous > 0 && (
                  <button className="btn-ghost" onClick={toggleBroken}>
                    {brokenList ? '收起' : '查看'}
                  </button>
                )}
              </div>
              {brokenList && (
                <div className="ext-list">
                  {brokenList.length === 0 && <div className="ext-empty">没有断链</div>}
                  {brokenList.slice(0, 60).map((b, i) => (
                    <div className="ext-row" key={`${b.from}-${b.line}-${i}`}>
                      <div className="ext-main">
                        <span className="ext-name">{b.raw}</span>
                        <span className="ext-sub">
                          {b.fromTitle} · 第 {b.line} 行
                        </span>
                      </div>
                    </div>
                  ))}
                  {brokenList.length > 60 && (
                    <div className="ext-empty">…另有 {brokenList.length - 60} 处</div>
                  )}
                </div>
              )}
            </div>
          </section>

          <section>
            <div className="setting-row column">
              <div className="setting-label">
                <span>技能包</span>
                <small>成套的操作手册，AI 命中场景时自己加载。想新增就让 AI「把这套流程存成技能」</small>
              </div>
              <div className="ext-list">
                {skills.length === 0 && <div className="ext-empty">还没有技能包</div>}
                {skills.map((s) => (
                  <div className="ext-row" key={s.name}>
                    <div className="ext-main">
                      <span className="ext-name">{s.name}</span>
                      <span className="ext-sub">{s.when || s.description || '—'}</span>
                    </div>
                    <button
                      className="btn-ghost ext-del"
                      onClick={() =>
                        window.api.extSkillRemove(s.name).then(() => window.api.extSkills().then(setSkills))
                      }
                      title="删除这个技能文件"
                    >
                      <Icon name="trash" size={11} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="ext-actions">
                <button className="btn-ghost" onClick={() => window.api.extSkillReveal()}>
                  打开技能目录
                </button>
              </div>
            </div>
          </section>

          <section>
            <div className="setting-row column">
              <div className="setting-label">
                <span>MCP 服务</span>
                <small>
                  接入外部工具（文件、数据库、搜索）。保存后会启动子进程并拉取工具清单，下一次对话自动可用
                </small>
              </div>
              <textarea
                className="ext-code"
                value={mcpText}
                spellCheck={false}
                rows={6}
                placeholder={'{\n  "mcpServers": {\n    "files": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:/notes"] }\n  }\n}'}
                onChange={(e) => {
                  setMcpText(e.target.value)
                  setMcpErr('')
                }}
              />
              <div className="ext-actions">
                <button
                  className="btn-primary"
                  disabled={mcpBusy}
                  onClick={async () => {
                    setMcpBusy(true)
                    setMcpErr('')
                    try {
                      const cfg = JSON.parse(mcpText || '{"mcpServers":{}}')
                      await window.api.extMcpSave(cfg)
                      setMcpStatus(await window.api.extMcpStatus(true))
                    } catch (err) {
                      setMcpErr(`配置不是合法 JSON：${(err as Error).message}`)
                    } finally {
                      setMcpBusy(false)
                    }
                  }}
                >
                  {mcpBusy ? '连接中…' : '保存并连接'}
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => window.api.extMcpStatus(true).then(setMcpStatus).catch(() => undefined)}
                >
                  刷新状态
                </button>
              </div>
              {mcpErr && <div className="setting-warn">{mcpErr}</div>}
              <div className="ext-list">
                {mcpStatus.length === 0 && <div className="ext-empty">还没有配置 MCP 服务</div>}
                {mcpStatus.map((s) => (
                  <div className="ext-row" key={s.name}>
                    <span className={`ext-dot is-${s.state}`} />
                    <div className="ext-main">
                      <span className="ext-name">{s.name}</span>
                      <span className="ext-sub">
                        {s.state === 'ready'
                          ? `${s.tools} 个工具可用`
                          : s.state === 'error'
                            ? s.error || '连接失败'
                            : s.state === 'disabled'
                              ? '已停用'
                              : s.state === 'starting'
                                ? '正在连接…'
                                : s.command}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        <footer className="settings-foot">
          <span>Inkwell v{version} · Electron 38.8</span>
          <button className="quit-btn" onClick={onQuit}>
            退出 Inkwell
          </button>
        </footer>
      </div>
    </div>
  )
}
