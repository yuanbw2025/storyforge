import { getModelCapacityLimitsV1 } from '../../lib/ai/model-capacity'
import { useState } from 'react'
import { ChevronDown, ChevronUp, RotateCcw, Save, Settings2 } from 'lucide-react'
import { usePromptStore } from '../../stores/prompt'
import { useAIConfigStore } from '../../stores/ai-config'
import type { PromptModuleKey, PromptParameter, PromptTemplate } from '../../lib/types/prompt'
import { useDialog } from './Dialog'
import { useToast } from './Toast'

interface Props {
  /** 当前调用使用的 moduleKey */
  moduleKey: PromptModuleKey
  /** 当前运行时参数值（key → value） */
  parameterValues: Record<string, unknown>
  onParamChange: (next: Record<string, unknown>) => void
  /** 临时覆盖 system prompt（null 表示不覆盖） */
  systemOverride: string | null
  onSystemOverrideChange: (next: string | null) => void
  /** 临时覆盖 user prompt 模板 */
  userOverride: string | null
  onUserOverrideChange: (next: string | null) => void
  /** 折叠状态可由外层控制（默认折叠） */
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Opt-in Work binding. A missing controlled template must never fall back to a global selection. */
  configuration?: {
    template: PromptTemplate | null
    mode: 'follow-default' | 'bound'
    choices: readonly PromptTemplate[]
    loading: boolean
    saving: boolean
    error: string
    onSelect: (template: PromptTemplate) => Promise<void>
    onFollowDefault: () => Promise<void>
    onSaveAs: (name: string) => Promise<void>
    onRetry: () => Promise<void>
    onTemperatureChange: (temperature: number) => Promise<void>
  }
}

/**
 * 创作区"调参浮窗"：显示当前激活模板，让用户调参 + 可选地临时改 prompt 文字。
 * 改动是"运行时覆盖" — 只影响这次 AI 调用，不写回模板。
 *
 * 用法：父组件管理 parameterValues/systemOverride/userOverride 状态，
 * 调 AI 时把它们一起传给 renderPrompt 的 options。
 */
function PromptRunPanelContent({
  moduleKey, parameterValues, onParamChange,
  systemOverride, onSystemOverrideChange,
  userOverride, onUserOverrideChange,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  configuration,
}: Props) {
  const dialog = useDialog()
  const toast = useToast()
  const templates = usePromptStore(s => s.templates)
  const cloneTemplate = usePromptStore(s => s.cloneTemplate)
  const saveTemplate = usePromptStore(s => s.saveTemplate)
  const aiConfig = useAIConfigStore(s => s.config)

  // 找当前激活的模板
  const globalTemplate = templates.find(t => t.moduleKey === moduleKey && t.scope === 'user' && t.isActive)
            ?? templates.find(t => t.moduleKey === moduleKey && t.scope === 'system' && t.isActive)
            ?? templates.find(t => t.moduleKey === moduleKey)
  const tpl = configuration ? configuration.template : globalTemplate

  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(next)
    onOpenChange?.(next)
  }

  if (!tpl) {
    return (
      <div className="text-xs text-text-muted px-3 py-2 bg-bg-elevated rounded">
        {configuration ? configuration.error || '正在读取当前作品的模板配置…' : `⚠ 找不到 moduleKey=${moduleKey} 的模板`}
        {configuration && <button onClick={() => { void configuration.onRetry().catch(cause => toast.error(String(cause))) }} className="ml-2 text-accent">重新读取</button>}
      </div>
    )
  }

  const params = tpl.parameters || []
  const dirty = Object.keys(parameterValues).length > 0 || systemOverride != null || userOverride != null
  const perform = (operation: () => Promise<void>) => { void operation().catch(cause => toast.error(cause instanceof Error ? cause.message : String(cause))) }

  /** 把当前覆盖另存为新的"我的"模板 */
  const handleSaveAs = async () => {
    // Capture the owner-bound callback before the name dialog can outlive this view.
    const controlledSave = configuration?.onSaveAs
    const name = await dialog.prompt({
      title: '另存为新模板',
      defaultValue: `${tpl.name}（我的微调）`,
      placeholder: '输入模板名称',
    })
    if (!name) return
    if (controlledSave) {
      try { await controlledSave(name) } catch (cause) { toast.error(cause instanceof Error ? cause.message : String(cause)) }
      return
    }
    const newId = await cloneTemplate(tpl.id!, name)
    // 把当前覆盖写入新模板
    const cloned = usePromptStore.getState().templates.find(t => t.id === newId)
    if (cloned) {
      const merged: PromptTemplate = {
        ...cloned,
        systemPrompt: systemOverride ?? cloned.systemPrompt,
        userPromptTemplate: userOverride ?? cloned.userPromptTemplate,
        parameters: (cloned.parameters || []).map(p => ({
          ...p,
          default: parameterValues[p.key] !== undefined
            ? (parameterValues[p.key] as PromptParameter['default'])
            : p.default,
        })),
      }
      await saveTemplate(merged)
      // 重置当前会话的覆盖
      onParamChange({})
      onSystemOverrideChange(null)
      onUserOverrideChange(null)
      toast.success(`已另存为「${name}」。在「提示词库」里把它设为激活即可使用。`)
    }
  }

  const handleReset = () => {
    onParamChange({})
    onSystemOverrideChange(null)
    onUserOverrideChange(null)
  }

  return (
    <div className="bg-bg-elevated border border-border rounded-lg text-xs">
      {/* 头部 */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-bg-hover transition-colors"
      >
        <div className="flex items-center gap-2">
          <Settings2 className="w-3.5 h-3.5 text-text-secondary" />
          <span className="text-text-secondary">当前模板：</span>
          <span className="text-text-primary font-medium">{tpl.name}</span>
          {configuration && <span className="text-text-muted">{configuration.mode === 'bound' ? '固定版本' : '跟随默认'}</span>}
          {configuration?.saving && <span className="text-text-muted" role="status">保存中…</span>}
          {dirty && (
            <span className="px-1.5 py-0.5 rounded bg-warning/15 text-warning text-[10px]">
              已临时调整
            </span>
          )}
        </div>
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {configuration?.error && <p role="alert" className="px-3 pb-2 text-warning">{configuration.error}
        <button className="ml-2 text-accent" onClick={() => perform(configuration.onRetry)}>重新读取，放弃未保存配置</button>
      </p>}

      {open && (
        <div className="border-t border-border p-3 space-y-3">
          {configuration && <label className="flex items-center gap-2 text-text-secondary">模板版本
            <select aria-label="灵感模板版本" value={configuration.mode === 'bound' ? 'bound-current' : 'follow-default'}
              disabled={configuration.loading || configuration.saving}
              onChange={event => {
                const selected = event.target.value
                if (selected === 'follow-default') perform(configuration.onFollowDefault)
                else if (selected !== 'bound-current') {
                  const template = configuration.choices.find(t => String(t.id) === selected)
                  if (template) perform(() => configuration.onSelect(template))
                }
              }} className="flex-1 bg-bg-base border border-border rounded px-2 py-1">
              <option value="follow-default">跟随最新默认模板</option>
              {configuration.mode === 'bound' && <option value="bound-current">当前保存版本：{tpl.name}</option>}
              {configuration.choices.filter(t => t.id != null && t.moduleKey === moduleKey).map(t => <option key={t.id} value={t.id}>{t.scope === 'user' ? '我的' : '内置'} · {t.name}</option>)}
            </select>
          </label>}
          {configuration && <label className="flex items-center gap-2 text-text-secondary">温度
            <input aria-label="灵感生成温度" type="number" min={0} max={2} step={0.1}
              disabled={configuration.saving} value={tpl.modelOverride?.temperature ?? aiConfig.temperature}
              onChange={event => { if (event.currentTarget.validity.valid && event.target.value !== '') perform(() => configuration.onTemperatureChange(Number(event.target.value))) }}
              className="w-20 bg-bg-base border border-border rounded px-2 py-1" />
          </label>}
          {/* 参数区 */}
          {params.length === 0 ? (
            <p className="text-text-muted">本模板无可调参数。</p>
          ) : (
            <div className="space-y-2">
              {params.map(p => (
                <ParamControl
                  key={p.key}
                  param={p}
                  value={parameterValues[p.key]}
                  onChange={(v) => onParamChange({ ...parameterValues, [p.key]: v })}
                />
              ))}
            </div>
          )}

          {/* 高级：临时改 prompt 文字 */}
          <details className="border-t border-border pt-2" open={showAdvanced} onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}>
            <summary className="cursor-pointer text-text-secondary hover:text-text-primary">
              高级：临时修改 Prompt 文字（不写回模板）
            </summary>
            <div className="mt-2 space-y-2">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-text-muted">System Prompt</span>
                  {systemOverride != null && (
                    <button onClick={() => onSystemOverrideChange(null)} className="text-accent hover:underline">还原</button>
                  )}
                </div>
                <textarea
                  value={systemOverride ?? tpl.systemPrompt}
                  onChange={e => onSystemOverrideChange(e.target.value)}
                  rows={4}
                  className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-text-primary font-mono text-[11px] resize-y focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-text-muted">User Prompt 模板</span>
                  {userOverride != null && (
                    <button onClick={() => onUserOverrideChange(null)} className="text-accent hover:underline">还原</button>
                  )}
                </div>
                <textarea
                  value={userOverride ?? tpl.userPromptTemplate}
                  onChange={e => onUserOverrideChange(e.target.value)}
                  rows={5}
                  className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-text-primary font-mono text-[11px] resize-y focus:outline-none focus:border-accent"
                />
              </div>
            </div>
          </details>

          {/* 操作 */}
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <button
              onClick={() => configuration ? perform(configuration.onFollowDefault) : handleReset()}
              disabled={configuration ? configuration.saving || (!dirty && configuration.mode === 'follow-default') : !dirty}
              className="flex items-center gap-1 text-text-secondary hover:text-text-primary disabled:opacity-40"
            >
              <RotateCcw className="w-3 h-3" /> {configuration ? '恢复跟随默认' : '重置'}
            </button>
            <button
              onClick={handleSaveAs}
              disabled={configuration ? configuration.saving : !dirty}
              className="flex items-center gap-1 px-2 py-1 bg-accent/10 text-accent rounded hover:bg-accent/20 disabled:opacity-40"
            >
              <Save className="w-3 h-3" /> 另存为我的版本
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PromptRunPanel(props: Props) {
  return <PromptRunPanelContent {...props} />
}

// ── 单个参数的 UI 控件 ─────────────────────────────────────────────────

function ParamControl({
  param, value, onChange,
}: {
  param: PromptParameter
  value: unknown
  onChange: (v: unknown) => void
}) {
  const aiConfig = useAIConfigStore(s => s.config)
  // Optional params with defaults are auto-enabled on first load (value === undefined)
  // Empty string '' means explicitly disabled by the user
  const isAutoEnabled = param.optional && value === undefined && param.default !== undefined
  const enabled = !param.optional || isAutoEnabled || (value !== undefined && value !== '')
  // 显示用值（用户值或默认值）
  const shown = value !== undefined && value !== '' ? value : param.default

  // 字数类滑块:上限动态 = 当前模型最大输出换算字数(token×1.5);否则用静态 param.max
  const sliderMax = param.maxFromModelOutput
    ? Math.max(param.min ?? 0, Math.round((getModelCapacityLimitsV1(aiConfig).maxOutput * 1.5) / 100) * 100)
    : param.max

  return (
    <div className="flex items-center gap-2">
      {/* 启用复选框（仅 optional 参数显示） */}
      {param.optional && (
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => onChange(e.target.checked ? param.default : '')}
          className="accent-accent flex-shrink-0"
          title={enabled ? '点击禁用' : '点击启用（使用默认值）'}
        />
      )}
      <label className={`w-20 flex-shrink-0 ${enabled ? 'text-text-secondary' : 'text-text-muted line-through'}`}>
        {param.label}
      </label>
      {param.type === 'select' && (
        <select
          aria-label={param.label}
          value={String(shown)}
          onChange={e => onChange(e.target.value)}
          disabled={!enabled}
          className="flex-1 px-2 py-1 bg-bg-base border border-border rounded text-text-primary disabled:opacity-50 focus:outline-none focus:border-accent"
        >
          {(param.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      )}
      {param.type === 'slider' && (
        <>
          <input
            type="range"
            aria-label={`${param.label}滑块`}
            min={param.min}
            max={sliderMax}
            step={param.step ?? 1}
            value={Math.min(Number(shown), Number(sliderMax))}
            onChange={e => onChange(Number(e.target.value))}
            disabled={!enabled}
            className="flex-1 accent-accent disabled:opacity-50"
          />
          {/* 可编辑数字框：能手填任意值（含超过滑块上限），滑块只作快速拖拽 */}
          <input
            type="number"
          aria-label={param.label}
            min={param.min}
            step={param.step ?? 1}
            value={Number(shown)}
            onChange={e => onChange(Number(e.target.value))}
            disabled={!enabled}
            className={`w-16 px-1 py-0.5 text-right bg-bg-base border border-border rounded disabled:opacity-50 focus:outline-none focus:border-accent ${enabled ? 'text-text-primary' : 'text-text-muted'}`}
          />
        </>
      )}
      {param.type === 'number' && (
        <input
          type="number"
          aria-label={param.label}
          min={param.min}
          max={param.max}
          step={param.step ?? 1}
          value={Number(shown)}
          onChange={e => onChange(Number(e.target.value))}
          disabled={!enabled}
          className="flex-1 px-2 py-1 bg-bg-base border border-border rounded text-text-primary disabled:opacity-50 focus:outline-none focus:border-accent"
        />
      )}
      {param.type === 'text' && (
        <input
          type="text"
          aria-label={param.label}
          value={String(shown)}
          onChange={e => onChange(e.target.value)}
          disabled={!enabled}
          className="flex-1 px-2 py-1 bg-bg-base border border-border rounded text-text-primary disabled:opacity-50 focus:outline-none focus:border-accent"
        />
      )}
      {param.type === 'boolean' && (
        <input
          type="checkbox"
          checked={Boolean(shown)}
          onChange={e => onChange(e.target.checked)}
          disabled={!enabled}
          className="accent-accent disabled:opacity-50"
        />
      )}
      {param.description && (
        <span className="text-text-muted text-[10px] truncate" title={param.description}>
          ⓘ
        </span>
      )}
    </div>
  )
}
