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

const PRESETS: { name: string; baseUrl: string; model: string; hint: string }[] = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', hint: '性价比高，中文强' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-plus', hint: '国内直连' },
  { name: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', hint: '长文本' },
  { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', hint: '阿里云' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', hint: '需要代理' },
  { name: '本地 Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b', hint: '完全离线' }
]

const empty = (): ModelProfile => ({
  id: '',
  name: '',
  baseUrl: '',
  apiKey: '',
  model: '',
  temperature: 0.3,
  maxTokens: 4000,
  extraHeaders: '',
  createdAt: 0
})

export default function ModelsDialog({ open, models, activeId, onClose, onSave, onRemove, onPick }: Props) {
  const [draft, setDraft] = useState<ModelProfile>(empty())
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; message: string; latency: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const current = models.find((m) => m.id === activeId) || models[0]
    setDraft(current ? { ...current } : empty())
    setTest(null)
  }, [open, activeId, models])

  if (!open) return null

  const patch = (p: Partial<ModelProfile>) => setDraft((d) => ({ ...d, ...p }))

  const runTest = async () => {
    setTesting(true)
    setTest(null)
    const res = await window.api.aiTestModel(draft)
    setTest(res)
    setTesting(false)
  }

  const save = () => {
    if (!draft.baseUrl.trim() || !draft.model.trim()) return
    onSave({
      ...draft,
      name: draft.name.trim() || draft.model.split('/').pop() || '未命名模型',
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
            <em>兼容 OpenAI Chat Completions 协议</em>
          </div>
          <button className="icon-btn tiny" onClick={onClose}>
            <Icon name="close" size={13} />
          </button>
        </header>

        <div className="md-body">
          <aside className="md-list">
            {models.map((m) => (
              <div key={m.id} className={`md-item${draft.id === m.id ? ' is-active' : ''}`}>
                <button
                  className="md-item-main"
                  onClick={() => {
                    setDraft({ ...m })
                    setTest(null)
                  }}
                >
                  <span className="md-item-name">{m.name}</span>
                  <span className="md-item-model">{m.model}</span>
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
            {models.length === 0 && !draft.baseUrl && (
              <div className="md-presets">
                <div className="md-presets-label">从常用服务开始</div>
                <div className="md-preset-grid">
                  {PRESETS.map((p) => (
                    <button
                      key={p.name}
                      className="md-preset"
                      onClick={() => setDraft({ ...empty(), name: p.name, baseUrl: p.baseUrl, model: p.model })}
                    >
                      <span>{p.name}</span>
                      <small>{p.hint}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className="field">
              <span>显示名称</span>
              <input value={draft.name} placeholder="DeepSeek 主力" onChange={(e) => patch({ name: e.target.value })} />
            </label>
            <label className="field">
              <span>接口地址</span>
              <input
                value={draft.baseUrl}
                placeholder="https://api.deepseek.com"
                onChange={(e) => patch({ baseUrl: e.target.value })}
              />
              <small>填到 /v1 即可，会自动补 /chat/completions</small>
            </label>
            <label className="field">
              <span>API Key</span>
              <input
                type="password"
                value={draft.apiKey}
                placeholder="sk-..."
                onChange={(e) => patch({ apiKey: e.target.value })}
              />
              <small>只保存在本机 %APPDATA%\inkwell\models.json</small>
            </label>
            <label className="field">
              <span>模型名称</span>
              <input value={draft.model} placeholder="deepseek-chat" onChange={(e) => patch({ model: e.target.value })} />
            </label>
            <div className="field-row">
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
              </label>
              <label className="field narrow">
                <span>最大输出</span>
                <input
                  type="number"
                  value={draft.maxTokens}
                  onChange={(e) => patch({ maxTokens: Number(e.target.value) || 4000 })}
                />
              </label>
            </div>

            <div className="md-test-row">
              <button className="btn-ghost" onClick={runTest} disabled={testing || !draft.baseUrl}>
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
            <button className="btn-primary" onClick={save} disabled={!draft.baseUrl.trim() || !draft.model.trim()}>
              <Icon name="check" size={13} /> 保存
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
