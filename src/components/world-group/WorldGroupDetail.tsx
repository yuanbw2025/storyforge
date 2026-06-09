/**
 * 世界组详情面板 — 编辑单个世界的基础信息和穿越规则
 */
import { CTextarea, CInput } from '../shared/CompositionInput'
import { useState, useEffect } from 'react'
import { ArrowLeft, Save, Loader2, Sparkles, Check } from 'lucide-react'
import { useWorldGroupStore } from '../../stores/world-group'
import { useAIStream } from '../../hooks/useAIStream'
import { buildWorldExpandPrompt, parseWorldExpandOutput } from '../../lib/ai/world-group-ai'
import { buildAllWorldsOverview } from '../../lib/ai/world-group-context'
import { db } from '../../lib/db/schema'
import { adopt } from '../../lib/registry/adopt'
import type { WorldGroup, WorldGroupType } from '../../lib/types'
import { WORLD_GROUP_TYPE_LABELS } from '../../lib/types/world-group'

const TYPE_OPTIONS: { value: WorldGroupType; label: string }[] = [
  { value: 'primary', label: '主世界' },
  { value: 'traversal', label: '穿越目标' },
  { value: 'instance', label: '副本世界' },
  { value: 'parallel', label: '平行世界' },
  { value: 'ascension', label: '上界/高维' },
  { value: 'custom', label: '自定义' },
]

const EMOJI_OPTIONS = ['🏠', '🔥', '⭐', '🗡️', '🌊', '🏔️', '🌙', '⚡', '🎭', '🐉', '🌸', '💎', '🌍', '☀️', '🌑', '🏰']

interface Props {
  group: WorldGroup
  onBack: () => void
}

export default function WorldGroupDetail({ group, onBack }: Props) {
  const { updateGroup } = useWorldGroupStore()
  const [form, setForm] = useState({
    name: '',
    description: '',
    type: 'custom' as WorldGroupType,
    icon: '🌐',
    color: '#6B7280',
    entryCondition: '',
    exitCondition: '',
    plannedChapterCount: 0,
    powerRestriction: '',
    takeawayRules: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setForm({
      name: group.name,
      description: group.description || '',
      type: group.type,
      icon: group.icon || '🌐',
      color: group.color || '#6B7280',
      entryCondition: group.entryCondition || '',
      exitCondition: group.exitCondition || '',
      plannedChapterCount: group.plannedChapterCount || 0,
      powerRestriction: group.powerRestriction || '',
      takeawayRules: group.takeawayRules || '',
    })
  }, [group])

  const handleSave = async () => {
    if (!group.id) return
    setSaving(true)
    await updateGroup(group.id, {
      name: form.name,
      description: form.description,
      type: form.type,
      icon: form.icon,
      color: form.color,
      entryCondition: form.entryCondition || undefined,
      exitCondition: form.exitCondition || undefined,
      plannedChapterCount: form.plannedChapterCount || undefined,
      powerRestriction: form.powerRestriction || undefined,
      takeawayRules: form.takeawayRules || undefined,
    })
    setSaving(false)
  }

  // ── AI 扩写世界观 ──
  const ai = useAIStream()
  const [expanded, setExpanded] = useState(false)

  const handleAIExpand = async () => {
    if (!group.id || !group.projectId) return
    setExpanded(false)
    const otherWorlds = await buildAllWorldsOverview(group.projectId)
    const sc = await db.storyCores.where('projectId').equals(group.projectId).first()
    const messages = buildWorldExpandPrompt({
      worldName: form.name,
      worldType: WORLD_GROUP_TYPE_LABELS[form.type],
      draft: form.description || group.name,
      otherWorlds,
      storyCore: sc?.mainPlot || sc?.theme || '',
    })
    const result = await ai.start(messages)
    if (!result) return
    const parsed = parseWorldExpandOutput(result)
    if (!parsed) return
    await adopt({
      projectId: group.projectId,
      worldGroupId: group.id,
      target: 'worldviews',
      mode: 'replace',
      data: { ...parsed },
    })
    setExpanded(true)
  }

  const isPrimary = group.type === 'primary'

  return (
    <div className="space-y-5">
      {/* 返回 + 标题 */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          返回世界总览
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={handleAIExpand}
            disabled={ai.isStreaming}
            title="根据描述 + 其他世界，AI 生成本世界的完整世界观"
            className="flex items-center gap-1.5 px-3 py-2 bg-bg-elevated text-text-secondary border border-border rounded-lg hover:text-accent hover:border-accent/50 disabled:opacity-50 transition-colors text-sm"
          >
            {ai.isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : expanded ? <Check className="w-4 h-4 text-green-400" /> : <Sparkles className="w-4 h-4" />}
            {ai.isStreaming ? 'AI 扩写中...' : expanded ? '已写入世界观' : 'AI 扩写世界观'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent-hover disabled:opacity-50 transition-colors text-sm font-medium"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      <div className="pb-4 border-b border-border/40">
        <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
          <span className="text-2xl">{form.icon}</span>
          {form.name || '未命名世界'}
        </h2>
        <p className="text-xs text-text-muted mt-0.5">
          {WORLD_GROUP_TYPE_LABELS[form.type]}
          {form.plannedChapterCount ? ` · 预计 ${form.plannedChapterCount} 章` : ''}
        </p>
      </div>

      {/* 基础信息 */}
      <section className="bg-bg-surface border border-border rounded-lg p-4 space-y-4">
        <h3 className="text-sm font-semibold text-text-primary">基础信息</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-text-muted mb-1">世界名称</label>
            <CInput
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">世界类型</label>
            <select
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value as WorldGroupType }))}
              disabled={isPrimary}
              className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent transition-colors disabled:opacity-50"
            >
              {TYPE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs text-text-muted mb-1">世界描述</label>
          <CTextarea
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            rows={3}
            placeholder="这个世界的核心特征、氛围、独特之处..."
            className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent transition-colors resize-none"
          />
        </div>

        <div className="flex items-center gap-4">
          <div>
            <label className="block text-xs text-text-muted mb-1">图标</label>
            <div className="flex flex-wrap gap-1">
              {EMOJI_OPTIONS.map(e => (
                <button
                  key={e}
                  onClick={() => setForm(f => ({ ...f, icon: e }))}
                  className={`w-8 h-8 rounded text-lg flex items-center justify-center transition-colors ${
                    form.icon === e ? 'bg-accent/20 ring-1 ring-accent' : 'hover:bg-bg-hover'
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">预计章节数</label>
            <CInput
              type="number"
              min={0}
              value={form.plannedChapterCount || ''}
              onChange={e => setForm(f => ({ ...f, plannedChapterCount: Number(e.target.value) || 0 }))}
              placeholder="0"
              className="w-24 px-3 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
            />
          </div>
        </div>
      </section>

      {/* 穿越规则（非主世界才显示） */}
      {!isPrimary && (
        <section className="bg-bg-surface border border-border rounded-lg p-4 space-y-4">
          <h3 className="text-sm font-semibold text-text-primary">🚪 穿越规则</h3>

          <div>
            <label className="block text-xs text-text-muted mb-1">进入条件</label>
            <CTextarea
              value={form.entryCondition}
              onChange={e => setForm(f => ({ ...f, entryCondition: e.target.value }))}
              rows={2}
              placeholder="例如：主线触发，主角实力达到斗皇..."
              className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent transition-colors resize-none"
            />
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1">能力限制</label>
            <CTextarea
              value={form.powerRestriction}
              onChange={e => setForm(f => ({ ...f, powerRestriction: e.target.value }))}
              rows={2}
              placeholder="例如：修为压制至斗者，仅保留精神力..."
              className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent transition-colors resize-none"
            />
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1">可带走的能力/物品</label>
            <CTextarea
              value={form.takeawayRules}
              onChange={e => setForm(f => ({ ...f, takeawayRules: e.target.value }))}
              rows={2}
              placeholder="例如：异火（最多一种）、炼药术..."
              className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent transition-colors resize-none"
            />
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1">离开条件</label>
            <CTextarea
              value={form.exitCondition}
              onChange={e => setForm(f => ({ ...f, exitCondition: e.target.value }))}
              rows={2}
              placeholder="例如：完成主线任务后自动返回..."
              className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent transition-colors resize-none"
            />
          </div>
        </section>
      )}
    </div>
  )
}
