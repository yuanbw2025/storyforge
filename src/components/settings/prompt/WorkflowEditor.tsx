import { useState } from 'react'
import { Save, Plus, X, Trash2 } from 'lucide-react'
import { useWorkflowStore } from '../../../stores/workflow'
import { usePromptStore } from '../../../stores/prompt'
import type { PromptWorkflow, PromptWorkflowStep } from '../../../lib/types/workflow'
import {
  ALL_MODULE_KEYS_FOR_WORKFLOW,
  SAVE_TARGET_PRESETS,
  saveTargetToValue,
  valueToSaveTarget,
} from './workflow-helpers'
import { useDialog } from '../../shared/Dialog'
import { useToast } from '../../shared/Toast'

/**
 * 工作流编辑器：编辑一个 PromptWorkflow 的元信息与步骤列表。
 * 从 PromptWorkflowsPanel.tsx 抽出，纯 UI，不含 Runner 逻辑。
 */
export default function WorkflowEditor({
  workflow,
  onClose,
}: {
  workflow: PromptWorkflow
  onClose: () => void
}) {
  const dialog = useDialog()
  const toast = useToast()
  const saveWorkflow = useWorkflowStore(s => s.save)
  const removeWorkflow = useWorkflowStore(s => s.remove)
  const templates = usePromptStore(s => s.templates)
  const [draft, setDraft] = useState<PromptWorkflow>(workflow)
  const [dirty, setDirty] = useState(false)

  const update = (patch: Partial<PromptWorkflow>) => {
    setDraft(d => ({ ...d, ...patch }))
    setDirty(true)
  }

  const updateStep = (idx: number, patch: Partial<PromptWorkflowStep>) => {
    setDraft(d => ({
      ...d,
      steps: d.steps.map((s, i) => i === idx ? { ...s, ...patch } : s),
    }))
    setDirty(true)
  }

  const addStep = () => {
    setDraft(d => ({
      ...d,
      steps: [...d.steps, {
        stepId: `s-${Math.random().toString(36).slice(2, 10)}`,
        label: `步骤 ${d.steps.length + 1}`,
        promptModuleKey: 'chapter.content',
        userConfirmRequired: false,
      }],
    }))
    setDirty(true)
  }

  const removeStep = (idx: number) => {
    setDraft(d => ({ ...d, steps: d.steps.filter((_, i) => i !== idx) }))
    setDirty(true)
  }

  const moveStep = (idx: number, dir: -1 | 1) => {
    setDraft(d => {
      const next = [...d.steps]
      const target = idx + dir
      if (target < 0 || target >= next.length) return d
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return { ...d, steps: next }
    })
    setDirty(true)
  }

  const handleSave = async () => {
    await saveWorkflow(draft)
    setDirty(false)
    toast.success('已保存')
  }

  const handleClose = async () => {
    if (dirty) {
      const ok = await dialog.confirm({
        title: '放弃未保存的更改？',
        message: '当前工作流编辑内容尚未保存，返回后会丢失。',
        confirmText: '放弃并返回',
        tone: 'danger',
      })
      if (!ok) return
    }
    onClose()
  }

  const handleDelete = async () => {
    if (!draft.id) return
    const ok = await dialog.confirm({
      title: `删除工作流「${draft.name}」？`,
      message: '此操作不可恢复。',
      confirmText: '删除',
      tone: 'danger',
    })
    if (!ok) return
    removeWorkflow(draft.id)
    onClose()
  }

  return (
    <div className="p-5 space-y-4">
      {/* 顶栏 */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-text-primary">✏️ 编辑工作流</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={!dirty}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm rounded hover:bg-accent-hover disabled:opacity-40"
          >
            <Save className="w-4 h-4" /> 保存{dirty && ' *'}
          </button>
          <button
            onClick={() => { void handleClose() }}
            className="px-3 py-1.5 text-text-secondary text-sm rounded hover:bg-bg-hover"
          >
            返回
          </button>
        </div>
      </div>

      {/* 元信息 */}
      <div className="bg-bg-surface border border-border rounded-xl p-4 space-y-3">
        <div>
          <label className="block text-xs text-text-secondary mb-1">名称</label>
          <input
            value={draft.name}
            onChange={e => update({ name: e.target.value })}
            className="w-full px-3 py-2 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-xs text-text-secondary mb-1">描述</label>
          <textarea
            value={draft.description}
            onChange={e => update({ description: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 bg-bg-base border border-border rounded text-sm text-text-primary resize-y focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* 步骤列表 */}
      <div className="bg-bg-surface border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-text-primary">步骤（{draft.steps.length}）</h3>
          <button
            onClick={addStep}
            className="flex items-center gap-1 px-2 py-1 text-xs text-accent hover:bg-accent/10 rounded"
          >
            <Plus className="w-3 h-3" /> 加一步
          </button>
        </div>
        {draft.steps.length === 0 ? (
          <p className="text-xs text-text-muted py-3 text-center">还没有步骤，点上方「加一步」开始。</p>
        ) : (
          <div className="space-y-3">
            {draft.steps.map((s, idx) => (
              <div key={s.stepId} className="bg-bg-base border border-border rounded p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-text-muted text-xs flex-shrink-0">{idx + 1}.</span>
                  <input
                    value={s.label}
                    onChange={e => updateStep(idx, { label: e.target.value })}
                    placeholder="步骤名"
                    className="flex-1 px-2 py-1 bg-bg-surface border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
                  />
                  <button onClick={() => moveStep(idx, -1)} disabled={idx === 0} className="px-1 text-text-muted hover:text-text-primary disabled:opacity-30">↑</button>
                  <button onClick={() => moveStep(idx, 1)} disabled={idx === draft.steps.length - 1} className="px-1 text-text-muted hover:text-text-primary disabled:opacity-30">↓</button>
                  <button onClick={() => removeStep(idx)} className="px-1 text-text-muted hover:text-error">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-text-muted mb-0.5">提示词模块</label>
                    <select
                      value={s.promptModuleKey}
                      onChange={e => updateStep(idx, { promptModuleKey: e.target.value as PromptWorkflowStep['promptModuleKey'] })}
                      className="w-full px-2 py-1 bg-bg-surface border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
                    >
                      {ALL_MODULE_KEYS_FOR_WORKFLOW.map(k => (
                        <option key={k} value={k}>{k}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-text-muted mb-0.5">自动保存目标</label>
                    <select
                      value={saveTargetToValue(s.saveTarget)}
                      onChange={e => updateStep(idx, { saveTarget: valueToSaveTarget(e.target.value) })}
                      className="w-full px-2 py-1 bg-bg-surface border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
                    >
                      {SAVE_TARGET_PRESETS.map(p => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] text-text-muted mb-0.5">给 AI 的提示（userHint）</label>
                  <textarea
                    value={s.userHint || ''}
                    onChange={e => updateStep(idx, { userHint: e.target.value })}
                    rows={2}
                    placeholder="如：请用一句话讲清楚这部小说要讲什么"
                    className="w-full px-2 py-1 bg-bg-surface border border-border rounded text-xs text-text-primary resize-none focus:outline-none focus:border-accent"
                  />
                </div>
                {(() => {
                  const template = s.templateId != null
                    ? templates.find(t => t.id === s.templateId)
                    : templates.find(t => t.moduleKey === s.promptModuleKey && t.isActive)
                      ?? templates.find(t => t.moduleKey === s.promptModuleKey)
                  const bindings = template?.variableBindings ?? []
                  if (!bindings.length) return null
                  return (
                    <div className="border-t border-border pt-2 space-y-2">
                      <p className="text-[10px] text-text-muted">模板字段：自动读取已登记项目资料；可在此补充或修正</p>
                      {bindings.map(binding => (
                        <div key={binding.variable}>
                          <label className="block text-[10px] text-text-muted mb-0.5">
                            {binding.label}{binding.required ? ' *' : ''}
                          </label>
                          <textarea
                            value={s.inputValues?.[binding.variable] || ''}
                            onChange={e => updateStep(idx, {
                              inputValues: { ...(s.inputValues || {}), [binding.variable]: e.target.value },
                            })}
                            rows={2}
                            placeholder={binding.placeholder || '可留空，使用项目自动资料'}
                            className="w-full px-2 py-1 bg-bg-surface border border-border rounded text-xs text-text-primary resize-y focus:outline-none focus:border-accent"
                          />
                        </div>
                      ))}
                    </div>
                  )
                })()}
                <div className="flex items-center gap-3 text-xs">
                  <label className="flex items-center gap-1 text-text-secondary">
                    <input
                      type="checkbox"
                      checked={s.userConfirmRequired || false}
                      onChange={e => updateStep(idx, { userConfirmRequired: e.target.checked })}
                      className="accent-accent"
                    />
                    本步执行后暂停等用户确认
                  </label>
                  {idx > 0 && (
                    <label className="flex items-center gap-1 text-text-secondary">
                      <input
                        type="checkbox"
                        checked={!!s.inputMapping?.previousOutput}
                        onChange={e => updateStep(idx, {
                          inputMapping: e.target.checked ? { previousOutput: 'previousOutput' } : undefined,
                        })}
                        className="accent-accent"
                      />
                      把上一步输出当作上下文
                    </label>
                  )}
                </div>
                {idx > 0 && s.inputMapping?.previousOutput && (
                  <input
                    value={s.inputMapping.previousOutput}
                    onChange={e => updateStep(idx, { inputMapping: { previousOutput: e.target.value } })}
                    placeholder="变量名（如 worldContext / characters）"
                    className="w-full px-2 py-1 bg-bg-surface border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部删除（仅用户工作流） */}
      {draft.scope === 'user' && draft.id && (
        <button
          onClick={() => { void handleDelete() }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-error text-xs hover:bg-error/10 rounded"
        >
          <Trash2 className="w-3 h-3" /> 删除工作流
        </button>
      )}
    </div>
  )
}
