/**
 * 世界组详情面板 — 编辑单个世界的基础信息和穿越规则
 */
import { CTextarea, CInput } from '../shared/CompositionInput'
import { useState, useEffect } from 'react'
import { ArrowLeft, Save, Loader2, Sparkles, Check, X } from 'lucide-react'
import { useWorldGroupStore } from '../../stores/world-group'
import { useAIConfigStore } from '../../stores/ai-config'
import {
  abandonWorldviewExpandRunV1,
  adoptWorldviewExpandCandidateV1,
  generateWorldviewExpandCandidateV1,
  readPendingWorldviewExpandCandidateV1,
  readRecoverableWorldviewExpandRunV1,
  rejectWorldviewExpandCandidateV1,
  type WorldviewExpandCandidateV1,
} from '../../lib/agent/run/worldview-expand-durable'
import { resolveScopeLike } from '../../lib/world-engine/scope'
import type { WorkspaceScope, WorldGroup, WorldGroupType } from '../../lib/types'
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
const ADOPTION_RECOVERY_MESSAGE = '上次七字段确认写入尚未完成；请继续原运行完成写入与终验，不会重复调用模型。'

interface Props {
  group: WorldGroup
  onBack: () => void
}

export default function WorldGroupDetail({ group, onBack }: Props) {
  const { updateGroup } = useWorldGroupStore()
  const aiConfig = useAIConfigStore(state => state.config)
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
  const [scope, setScope] = useState<WorkspaceScope | null>(null)
  const [candidate, setCandidate] = useState<WorldviewExpandCandidateV1 | null>(null)
  const [runId, setRunId] = useState<number | null>(null)
  const [unsafeRunId, setUnsafeRunId] = useState<number | null>(null)
  const [resumeAdoption, setResumeAdoption] = useState(false)
  const [expandBusy, setExpandBusy] = useState(false)
  const [expandError, setExpandError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

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

  useEffect(() => {
    if (!group.id || !group.projectId) return
    let cancelled = false
    setCandidate(null)
    setRunId(null)
    setUnsafeRunId(null)
    setResumeAdoption(false)
    setExpandError(null)
    setExpanded(false)
    void (async () => {
      const resolved = await resolveScopeLike(group.projectId)
      if (cancelled) return
      setScope(resolved)
      const pending = await readPendingWorldviewExpandCandidateV1({
        scope: resolved,
        worldGroupId: group.id!,
      })
      if (cancelled) return
      if (pending) {
        setCandidate(pending.candidate)
        setRunId(pending.snapshot.run.id)
        return
      }
      const recoverable = await readRecoverableWorldviewExpandRunV1({
        scope: resolved,
        worldGroupId: group.id!,
      })
      if (!cancelled && recoverable) {
        if (recoverable.safeToResume && recoverable.candidate && recoverable.adoptionPending) {
          setCandidate(recoverable.candidate)
          setRunId(recoverable.snapshot.run.id)
          setResumeAdoption(true)
          setExpandError(ADOPTION_RECOVERY_MESSAGE)
        } else if (!recoverable.safeToResume) {
          setUnsafeRunId(recoverable.snapshot.run.id)
          setExpandError('上次世界扩写停在模型结果不可判定窗口，系统不会自动重试。请放弃后重新生成。')
        }
      }
    })().catch(reason => {
      if (!cancelled) setExpandError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { cancelled = true }
  }, [group.id, group.projectId])

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

  const hasUnsavedDraft = (
    form.name !== group.name
    || form.description !== (group.description || '')
    || form.type !== group.type
  )

  const handleAIExpand = async () => {
    if (!scope || !group.id || expandBusy || candidate || unsafeRunId != null) return
    if (hasUnsavedDraft) {
      setExpandError('世界名称、类型或描述尚未保存；请先保存草稿，再生成可验证候选。')
      return
    }
    setExpandBusy(true)
    setExpandError(null)
    setExpanded(false)
    try {
      const generated = await generateWorldviewExpandCandidateV1({
        scope,
        worldGroupId: group.id,
        aiConfig,
      })
      setCandidate(generated.candidate)
      setRunId(generated.snapshot.run.id)
      setResumeAdoption(false)
    } catch (reason) {
      setExpandError(reason instanceof Error ? reason.message : String(reason))
      const pending = await readPendingWorldviewExpandCandidateV1({
        scope,
        worldGroupId: group.id,
      }).catch(() => null)
      if (pending) {
        setCandidate(pending.candidate)
        setRunId(pending.snapshot.run.id)
        setExpandError(null)
      } else {
        const recoverable = await readRecoverableWorldviewExpandRunV1({
          scope,
          worldGroupId: group.id,
        }).catch(() => null)
        if (recoverable?.safeToResume && recoverable.candidate && recoverable.adoptionPending) {
          setCandidate(recoverable.candidate)
          setRunId(recoverable.snapshot.run.id)
          setResumeAdoption(true)
          setExpandError(ADOPTION_RECOVERY_MESSAGE)
        } else if (recoverable && !recoverable.safeToResume) {
          setUnsafeRunId(recoverable.snapshot.run.id)
        }
      }
    } finally {
      setExpandBusy(false)
    }
  }

  const handleAcceptExpand = async () => {
    if (!scope || !group.id || runId == null || !candidate || expandBusy) return
    setExpandBusy(true)
    setExpandError(null)
    try {
      await adoptWorldviewExpandCandidateV1({ scope, worldGroupId: group.id, runId })
      setCandidate(null)
      setRunId(null)
      setResumeAdoption(false)
      setExpanded(true)
    } catch (reason) {
      setExpandError(reason instanceof Error ? reason.message : String(reason))
      const recoverable = await readRecoverableWorldviewExpandRunV1({
        scope,
        worldGroupId: group.id,
      }).catch(() => null)
      if (recoverable?.safeToResume && recoverable.candidate && recoverable.adoptionPending) {
        setCandidate(recoverable.candidate)
        setRunId(recoverable.snapshot.run.id)
        setResumeAdoption(true)
        setExpandError(ADOPTION_RECOVERY_MESSAGE)
      }
    } finally {
      setExpandBusy(false)
    }
  }

  const handleRejectExpand = async () => {
    if (!scope || !group.id || runId == null || expandBusy) return
    setExpandBusy(true)
    setExpandError(null)
    try {
      await rejectWorldviewExpandCandidateV1({ scope, worldGroupId: group.id, runId })
      setCandidate(null)
      setRunId(null)
      setResumeAdoption(false)
    } catch (reason) {
      setExpandError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setExpandBusy(false)
    }
  }

  const handleAbandonExpand = async () => {
    if (!scope || unsafeRunId == null || expandBusy) return
    setExpandBusy(true)
    try {
      await abandonWorldviewExpandRunV1({ scope, runId: unsafeRunId })
      setUnsafeRunId(null)
      setExpandError(null)
    } catch (reason) {
      setExpandError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setExpandBusy(false)
    }
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
            disabled={expandBusy || !scope || !!candidate || unsafeRunId != null}
            title="根据描述 + 其他世界，AI 生成本世界的完整世界观"
            className="flex items-center gap-1.5 px-3 py-2 bg-bg-elevated text-text-secondary border border-border rounded-lg hover:text-accent hover:border-accent/50 disabled:opacity-50 transition-colors text-sm"
          >
            {expandBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : expanded ? <Check className="w-4 h-4 text-green-400" /> : <Sparkles className="w-4 h-4" />}
            {expandBusy ? '记录可恢复运行...' : expanded ? '已写入世界观' : 'AI 扩写世界观'}
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

      {expandError && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
          {expandError}
          {unsafeRunId != null && (
            <button type="button" onClick={() => { void handleAbandonExpand() }} disabled={expandBusy}
              className="ml-3 rounded px-2 py-1 text-xs text-red-300 hover:bg-red-400/10 disabled:opacity-50">
              放弃未知运行
            </button>
          )}
        </div>
      )}

      {candidate && (
        <div className="rounded-lg border border-accent/20 bg-accent/10 p-3">
          <div className="mb-1 text-xs text-amber-400">
            {resumeAdoption ? '七字段采纳等待恢复终验' : '七字段世界观候选尚未写入'}
          </div>
          <div className="mb-2 text-sm text-text-primary">
            {candidate.values.worldOrigin.slice(0, 120)}{candidate.values.worldOrigin.length > 120 ? '…' : ''}
          </div>
          <div className="mb-2 text-xs text-text-muted">
            {resumeAdoption
              ? '继续同一 durable 运行完成正式写入与终验；不会重复调用模型。'
              : '世界来源、力量体系、地貌、气候、历史、种族和势力共 7 个字段；确认前正式世界观保持原值。'}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { void handleAcceptExpand() }} disabled={expandBusy}
              className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-50">
              <Check className="h-3 w-3" />{resumeAdoption ? '继续写入与终验' : '确认写入七字段'}
            </button>
            {!resumeAdoption && (
              <button type="button" onClick={() => { void handleRejectExpand() }} disabled={expandBusy}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-text-muted hover:bg-bg-hover hover:text-text-primary disabled:opacity-50">
                <X className="h-3 w-3" />放弃候选
              </button>
            )}
          </div>
        </div>
      )}

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
