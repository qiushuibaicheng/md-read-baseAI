import { useEffect, useState } from 'react'
import { Icon } from './Icons'
import type { ModelProfile } from '../lib/types'

interface Props {
  open: boolean
  models: ModelProfile[]
  activeId: string | null
  onClose: () => void
  onSave: (profile: ModelProfile) => void
  onRemove: (id: string) => void
  onPick: (id: string) => void
}

interface ProviderPreset {
  id: string
  label: string
  baseUrl: string
  model: string
  keyHint: string
  note: string
  maxContext: number
  maxTokens: number
}

/**
 * 只保留四种「入口」，本质都是 OpenAI Chat Completions 兼容接口。
 * 界面按 iCode 的做法：先选服务商，地址 / 模型 / 上下文窗口跟着套用默认值，
 * 需要时再手动改——不再摆一排预设卡片让人挑。
 */
const PROVIDERS: ProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI 兼容',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyHint: 'sk-...',
    note: '任何兼容 /chat/completions 的服务都选这一项，把地址换成自己的即可（中转、Moonshot、通义、vLLM 都行）。',
    maxContext: 128000,
    maxTokens: 8000
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    keyHint: 'sk-...',
    note: '官方直连，中文和代码都不错，工具调用稳定。',
    maxContext: 128000,
    maxTokens: 8000
  },
  {
    id: 'glm',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-plus',
    keyHint: '填写智谱的 API Key',
    note: '国内直连。',
    maxContext: 128000,
    maxTokens: 4000
  },
  {
    id: 'ollama',
    label: '本地 Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b',
    keyHint: '留空即可',
    note: '完全离线，Key 留空也能用；小模型的工具调用可能不稳定。',
    maxContext: 32000,
    maxTokens: 4000
  }
]

const presetOf = (id: string) => PROVIDERS.find((p) => p.id === id) || PROVIDERS[0]

function detectProvider(p: ModelProfile): string {
  if (p.provider && PROVIDERS.some((x) => x.id === p.provider)) return p.provider
  const hit = PROVIDERS.find((x) => x.baseUrl && p.baseUrl?.trim().startsWith(x.baseUrl))
  return hit?.id || 'openai'
}

const empty = (provider = 'openai'): ModelProfile => {
  const preset = presetOf(provider)
  return {
    id: '',
    name: '',
    provider,
    baseUrl: preset.baseUrl,
    apiKey: '',
    model: preset.model,
    temperature: 0.3,
    maxTokens: preset.maxTokens,
    maxContext: preset.maxContext,
    extraHeaders: '',
    createdAt: 0
  }
}

export default function ModelsDialog({ open, models, activeId, onClose, onSave, onRemove, onPick }: Props) {
  const [draft, setDraft] = useState<ModelProfile>(empty())
  const [advanced, setAdvanced] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; message: string; latency: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const current = models.find((m) => m.id === activeId) || models[0]
    setDraft(current ? { ...empty(detectProvider(current)), ...current } : empty())
    setAdvanced(false)
    setTest(null)
  }, [open, activeId, models])

  if (!open) return null

  const providerId = detectProvider(draft)
  const preset = presetOf(providerId)
  const patch = (p: Partial<ModelProfile>) => setDraft((d) => ({ ...d, ...p }))

  const pickProvider = (id: string) => {
    const next = presetOf(id)
    const untouched = !draft.baseUrl.trim() || draft.baseUrl.trim() === preset.baseUrl
    setDraft((d) => ({
      ...d,
      provider: id,
      baseUrl: untouched ? next.baseUrl : d.baseUrl,
      model: !d.model.trim() || d.model === preset.model ? next.model : d.model,
      maxContext: next.maxContext,
      maxTokens: next.maxTokens
    }))
    setTest(null)
  }

  const runTest = async () => {
    setTesting(true)
    setTest(null)
    const res = await window.api.aiTestModel({
      ...draft,
      baseUrl: draft.baseUrl.trim() || preset.baseUrl,
      model: draft.model.trim() || preset.model
    } as ModelProfile)
    setTest(res)
    setTesting(false)
  }

  const canSave = !!(draft.baseUrl.trim() || preset.baseUrl) && !!(draft.model.trim() || preset.model)

  const save = () => {
    if (!canSave) return
    const model = draft.model.trim() || preset.model
    onSave({
      ...draft,
      provider: providerId,
      baseUrl: (draft.baseUrl.trim() || preset.baseUrl).replace(/\/+$/, ''),
      model,
      name: draft.name.trim() || `${preset.label} · ${model}`,
      id: draft.id || `m-${Date.now().toString(36)}`,
      createdAt: draft.createdAt || Date.now()
    })
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="models-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="md-head">
          <div className="md-title">
            <Icon name="brain" size={15} />
            <span>模型配置</span>
            <em>兼容 OpenAI Chat Completions</em>
          </div>
          <button className="icon-btn tiny" onClick={onClose}>
            <Icon name="close" size={13} />
          </button>
        </header>

        <div className="md-body">
          <aside className="md-list">
            {models.length === 0 && (
              <div className="md-list-empty">
                还没有配置模型
                <small>选一个服务商，填 Key 就能用</small>
              </div>
            )}
            {models.map((m) => (
              <div key={m.id} className={`md-item${draft.id === m.id ? ' is-active' : ''}`}>
                <button
                  className="md-item-main"
                  onClick={() => {
                    setDraft({ ...empty(detectProvider(m)), ...m })
                    setTest(null)
                  }}
                >
                  <span className="md-item-name">{m.name}</span>
                  <span className="md-item-model">
                    {presetOf(detectProvider(m)).label} · {m.model}
                  </span>
                </button>
                <button
                  className="md-item-del"
                  title="删除"
                  onClick={() => {
                    onRemove(m.id)
                    if (draft.id === m.id) setDraft(empty())
                  }}
                >
                  <Icon name="trash" size={12} />
                </button>
              </div>
            ))}
            <button className="md-add" onClick={() => setDraft(empty())}>
              <Icon name="plus" size={13} /> 添加模型
            </button>
          </aside>

          <div className="md-form">
            <label className="field">
              <span>服务商</span>
              <select value={providerId} onChange={(e) => pickProvider(e.target.value)}>
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <small>{preset.note}</small>
            </label>

            <div className="field-row">
              <label className="field">
                <span>显示名称</span>
                <input
                  value={draft.name}
                  placeholder={`${preset.label} · ${preset.model || '模型'}`}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </label>
              <label className="field">
                <span>模型 ID</span>
                <input
                  value={draft.model}
                  placeholder={preset.model || 'deepseek-chat'}
                  onChange={(e) => patch({ model: e.target.value })}
                />
              </label>
            </div>

            <label className="field">
              <span>接口地址</span>
              <input
                value={draft.baseUrl}
                placeholder={preset.baseUrl || 'https://api.example.com/v1'}
                onChange={(e) => patch({ baseUrl: e.target.value })}
              />
              <small>填到 /v1 即可，结尾会自动补 /chat/completions</small>
            </label>

            <label className="field">
              <span>API Key</span>
              <input
                type="password"
                value={draft.apiKey}
                placeholder={preset.keyHint}
                onChange={(e) => patch({ apiKey: e.target.value })}
              />
              <small>只保存在本机 %APPDATA%\inkwell\models.json</small>
            </label>

            <button className={`md-adv${advanced ? ' is-open' : ''}`} onClick={() => setAdvanced((v) => !v)}>
              <Icon name="chevron" size={11} />
              高级参数
              <em>
                上下文 {Math.round((draft.maxContext || preset.maxContext) / 1000)}k · 输出{' '}
                {draft.maxTokens || preset.maxTokens} · 温度 {(draft.temperature ?? 0.3).toFixed(2)}
              </em>
            </button>

            {advanced && (
              <div className="md-adv-body">
                <div className="field-row">
                  <label className="field narrow">
                    <span>上下文窗口</span>
                    <input
                      type="number"
                      value={draft.maxContext ?? preset.maxContext}
                      onChange={(e) => patch({ maxContext: Number(e.target.value) || preset.maxContext })}
                    />
                    <small>决定 AI 面板里上下文预算的上限</small>
                  </label>
                  <label className="field narrow">
                    <span>最大输出</span>
                    <input
                      type="number"
                      value={draft.maxTokens}
                      onChange={(e) => patch({ maxTokens: Number(e.target.value) || preset.maxTokens })}
                    />
                    <small>单次回答的 token 上限</small>
                  </label>
                </div>
                <label className="field">
                  <span>温度 {draft.temperature.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1.5}
                    step={0.05}
                    value={draft.temperature}
                    onChange={(e) => patch({ temperature: Number(e.target.value) })}
                  />
                  <small>写代码 / 排查取低值（0.1–0.3），写作用高值</small>
                </label>
                <label className="field">
                  <span>额外请求头（可选）</span>
                  <input
                    value={draft.extraHeaders || ''}
                    placeholder='{"X-Org":"team"}'
                    onChange={(e) => patch({ extraHeaders: e.target.value })}
                  />
                </label>
              </div>
            )}

            <div className="md-test-row">
              <button className="btn-ghost" onClick={runTest} disabled={testing || !canSave}>
                {testing ? '测试中…' : '测试连通性'}
              </button>
              {test && (
                <span className={`md-test-result${test.ok ? ' is-ok' : ' is-bad'}`}>
                  <Icon name={test.ok ? 'check' : 'alert'} size={12} />
                  {test.ok ? `连通 · ${test.latency}ms · ${test.message}` : test.message}
                </span>
              )}
            </div>
          </div>
        </div>

        <footer className="md-foot">
          <div className="md-foot-left">
            {draft.id && draft.id !== activeId && (
              <button className="btn-ghost" onClick={() => onPick(draft.id)}>
                设为当前模型
              </button>
            )}
          </div>
          <div className="md-foot-right">
            <button className="btn-ghost" onClick={onClose}>
              关闭
            </button>
            <button className="btn-primary" onClick={save} disabled={!canSave}>
              <Icon name="check" size={13} /> 保存
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
