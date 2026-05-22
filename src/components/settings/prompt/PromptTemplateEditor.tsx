import { useState, useEffect, useMemo } from 'react'
import {
  Save, Trash2, Copy, Download, CheckCircle2, Lock, Plus, X,
} from 'lucide-react'
import { usePromptStore } from '../../../stores/prompt'
import { renderPrompt } from '../../../lib/ai/prompt-engine'
import { PREVIEW_VARS } from '../../../lib/ai/prompt-preview-vars'
import type { PromptTemplate, PromptModuleKey, PromptParameter } from '../../../lib/types/prompt'
import { db } from '../../../lib/db/schema'
import PromptParametersEditor from './PromptParametersEditor'
import PromptExamplesEditor from './PromptExamplesEditor'

const ALL_MODULE_KEYS: { value: PromptModuleKey; label: string }[] = [
  { value: 'worldview.dimension',         label: '世界观 · 维度生成' },
  { value: 'worldview.generate',          label: '世界观 · 完整生成（待启用）' },
  { value: 'character.generate',          label: '角色 · 完整设计' },
  { value: 'character.dimension',         label: '角色 · 维度补全' },
  { value: 'story.generate',              label: '故事 · 整体生成（待启用）' },
  { value: 'rules.generate',              label: '创作规则 · 生成（待启用）' },
  { value: 'outline.volume',              label: '大纲 · 卷级' },
  { value: 'outline.chapter',             label: '大纲 · 章节级' },
  { value: 'detail.scene',                label: '细纲 · 场景（待启用）' },
  { value: 'chapter.content',             label: '章节 · 正文生成' },
  { value: 'chapter.continue',            label: '章节 · 续写' },
  { value: 'chapter.polish',              label: '章节 · 润色' },
  { value: 'chapter.expand',              label: '章节 · 扩写' },
  { value: 'chapter.de-ai',               label: '章节 · 去 AI 味' },
  { value: 'foreshadow.generate',         label: '伏笔 · 建议' },
  { value: 'geography.concept-map',       label: '地理 · 概念地图 SVG' },
  { value: 'geography.image-map-prompt',  label: '地理 · 图像 Prompt' },
  { value: 'import.parse-all',            label: '导入 · 智能统一解析' },
  { value: 'import.parse-character',      label: '导入 · 角色解析（旧版）' },
  { value: 'import.parse-worldview',      label: '导入 · 世界观解析（旧版）' },
  { value: 'import.parse-outline',        label: '导入 · 大纲解析（旧版）' },
]

interface Props {
  template: PromptTemplate | null
  onChanged: () => void
  onDeleted: () => void
}

export default function PromptTemplateEditor({ template, onChanged, onDeleted }: Props) {
  const saveTemplate = usePromptStore(s => s.saveTemplate)
  const cloneTemplate = usePromptStore(s => s.cloneTemplate)
  const setActive = usePromptStore(s => s.setActive)

  // 本地编辑状态（draft），只在选中模板变化时同步
  const [draft, setDraft] = useState<PromptTemplate | null>(template)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setDraft(template)
    setDirty(false)
  }, [template?.id])

  // 实时预览（draft 即使没保存也能看效果）
  const preview = useMemo(() => {
    if (!draft) return null
    try {
      return renderPrompt(draft, PREVIEW_VARS)
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }, [draft])

  if (!template || !draft) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-sm">
        从左侧选择一个模板查看 / 编辑
      </div>
    )
  }

  const isSystem = draft.scope === 'system'

  /** 字段更新 helper */
  const update = (patch: Partial<PromptTemplate>) => {
    setDraft({ ...draft, ...patch })
    setDirty(true)
  }

  const handleSave = async () => {
    if (!draft.id) return
    await saveTemplate(draft)
    setDirty(false)
    onChanged()
  }

  const handleClone = async () => {
    if (!draft.id) return
    const newId = await cloneTemplate(draft.id)
    onChanged()
    // 提醒用户已克隆 — 但选中保持原状，由用户去左侧点击新模板
    alert(`已克隆为「我的」模板（id=${newId}），请在左侧列表中查看。`)
  }

  const handleSetActive = async () => {
    if (!draft.id) return
    await setActive(draft.id)
    onChanged()
  }

  const handleDelete = async () => {
    if (!draft.id) return
    if (!confirm(`删除模板「${draft.name}」？此操作不可恢复。`)) return
    await db.promptTemplates.delete(draft.id)
    onDeleted()
    onChanged()
  }

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${draft.name.replace(/\s+/g, '_')}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  /** 变量列表的增删 */
  const addVariable = () => {
    const name = prompt('变量名（仅字母数字下划线）：')?.trim()
    if (!name || !/^[a-zA-Z0-9_]+$/.test(name)) return
    if (draft.variables.includes(name)) return
    update({ variables: [...draft.variables, name] })
  }
  const removeVariable = (name: string) => {
    update({ variables: draft.variables.filter(v => v !== name) })
  }

  return (
    <div className="p-5 space-y-4">
      {/* Meta + 操作 */}
      <div className="bg-bg-surface border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            {isSystem ? (
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-text-muted" />
                <h3 className="text-base font-semibold text-text-primary truncate">{draft.name}</h3>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning">系统</span>
                {draft.isDefault && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent">★ 默认</span>
                )}
                {draft.isActive && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/15 text-success">激活</span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={draft.name}
                  onChange={e => update({ name: e.target.value })}
                  className="flex-1 px-2 py-1 bg-bg-base border border-border rounded text-base font-semibold text-text-primary focus:outline-none focus:border-accent"
                />
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-info/15 text-info">我的</span>
                {draft.isActive && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/15 text-success">激活</span>
                )}
              </div>
            )}
            <p className="mt-1 text-xs text-text-secondary">
              {isSystem ? draft.description : (
                <input
                  type="text"
                  value={draft.description}
                  onChange={e => update({ description: e.target.value })}
                  placeholder="模板描述..."
                  className="w-full px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
                />
              )}
            </p>
          </div>
        </div>

        {/* moduleKey 选择 */}
        <div className="flex items-center gap-2 text-xs">
          <label className="text-text-secondary flex-shrink-0">所属模块</label>
          {isSystem ? (
            <span className="text-text-primary">{ALL_MODULE_KEYS.find(o => o.value === draft.moduleKey)?.label || draft.moduleKey}</span>
          ) : (
            <select
              value={draft.moduleKey}
              onChange={e => update({ moduleKey: e.target.value as PromptModuleKey })}
              className="flex-1 px-2 py-1 bg-bg-base border border-border rounded text-text-primary focus:outline-none focus:border-accent"
            >
              {ALL_MODULE_KEYS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex flex-wrap gap-2 pt-1">
          {!isSystem && (
            <button
              onClick={handleSave}
              disabled={!dirty}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-bg-base text-sm rounded hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Save className="w-3.5 h-3.5" /> 保存{dirty && ' *'}
            </button>
          )}
          {!draft.isActive && (
            <button
              onClick={handleSetActive}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-success/10 text-success text-sm rounded hover:bg-success/20"
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> 设为激活
            </button>
          )}
          <button
            onClick={handleClone}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-hover text-text-primary text-sm rounded hover:bg-bg-elevated"
          >
            <Copy className="w-3.5 h-3.5" /> 克隆
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-hover text-text-primary text-sm rounded hover:bg-bg-elevated"
          >
            <Download className="w-3.5 h-3.5" /> 导出
          </button>
          {!isSystem && (
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-error/10 text-error text-sm rounded hover:bg-error/20 ml-auto"
            >
              <Trash2 className="w-3.5 h-3.5" /> 删除
            </button>
          )}
        </div>
      </div>

      {/* System Prompt */}
      <div className="bg-bg-surface border border-border rounded-xl p-4">
        <label className="block text-sm font-medium text-text-primary mb-2">System Prompt</label>
        <textarea
          value={draft.systemPrompt}
          onChange={e => update({ systemPrompt: e.target.value })}
          readOnly={isSystem}
          rows={8}
          className={`w-full px-3 py-2 bg-bg-base border border-border rounded text-sm text-text-primary font-mono focus:outline-none focus:border-accent resize-y ${
            isSystem ? 'opacity-70 cursor-not-allowed' : ''
          }`}
        />
      </div>

      {/* User Prompt Template */}
      <div className="bg-bg-surface border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-text-primary">User Prompt 模板</label>
          <span className="text-xs text-text-muted">
            支持 <code className="px-1 bg-bg-base rounded">{'{{var}}'}</code> 和 <code className="px-1 bg-bg-base rounded">{'{{#if var}}...{{/if}}'}</code>
          </span>
        </div>
        <textarea
          value={draft.userPromptTemplate}
          onChange={e => update({ userPromptTemplate: e.target.value })}
          readOnly={isSystem}
          rows={12}
          className={`w-full px-3 py-2 bg-bg-base border border-border rounded text-sm text-text-primary font-mono focus:outline-none focus:border-accent resize-y ${
            isSystem ? 'opacity-70 cursor-not-allowed' : ''
          }`}
        />
      </div>

      {/* 可调参数 */}
      <PromptParametersEditor
        parameters={draft.parameters || []}
        onChange={(params: PromptParameter[]) => update({ parameters: params })}
        readOnly={isSystem}
      />

      {/* 示例 / 反例 (P15) */}
      <PromptExamplesEditor
        template={draft}
        onChange={(examples) => update({ examples })}
        readOnly={isSystem}
      />

      {/* 变量列表 */}
      <div className="bg-bg-surface border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-text-primary">声明的变量（自描述用，不影响渲染）</label>
          {!isSystem && (
            <button
              onClick={addVariable}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-bg-hover text-text-primary rounded hover:bg-bg-elevated"
            >
              <Plus className="w-3 h-3" /> 添加
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {draft.variables.length === 0 && (
            <span className="text-xs text-text-muted">（暂无）</span>
          )}
          {draft.variables.map(v => (
            <span
              key={v}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-accent/10 text-accent rounded"
            >
              {v}
              {!isSystem && (
                <button onClick={() => removeVariable(v)} className="hover:text-error">
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      </div>

      {/* 实时预览 */}
      <div className="bg-bg-surface border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-text-primary">实时预览（用样例变量字典渲染）</label>
          <span className="text-xs text-text-muted">编辑模板时同步更新</span>
        </div>
        {preview && 'error' in preview ? (
          <div className="text-error text-sm">渲染错误：{preview.error}</div>
        ) : preview ? (
          <div className="space-y-2">
            {preview.messages.map((m, i) => (
              <div key={i} className="border border-border rounded">
                <div className="px-3 py-1 bg-bg-base text-xs text-text-secondary border-b border-border">
                  {m.role === 'system' ? '🛠 SYSTEM' : '💬 USER'}
                </div>
                <pre className="px-3 py-2 text-xs text-text-primary whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">
                  {m.content}
                </pre>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
