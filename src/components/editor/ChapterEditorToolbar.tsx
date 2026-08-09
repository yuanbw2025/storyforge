import { BookOpenCheck, Check, ClipboardList, Eye, GitBranch, Loader2, RefreshCw, ShieldCheck, StickyNote, X } from 'lucide-react'
import { CInput } from '../shared/CompositionInput'
import type { ImpactPatchCandidateV1 } from '../../lib/agent/run/impact-patch-durable'
import type { ImpactRemediationPlanV1 } from '../../lib/consistency/impact-remediation-plan'

interface ImpactPatchTarget {
  id: number
  title: string
  summary: string
}

interface Props {
  isStreaming: boolean
  hasText: boolean
  organizingChapter: boolean
  hasOrganizationCandidate: boolean
  analyzingImpact: boolean
  impactInfo: string | null
  impactRemediationPlan: ImpactRemediationPlanV1 | null
  impactRemediationBusy: boolean
  impactRemediationReceipt: string | null
  impactRemediationError: string | null
  impactPatchTargets: ImpactPatchTarget[]
  impactPatchTargetId: number | null
  impactPatchSummary: string
  impactPatchReason: string
  impactPatchCandidate: ImpactPatchCandidateV1 | null
  impactPatchBusy: boolean
  impactPatchError: string | null
  hasOutline: boolean
  showOutlinePreview: boolean
  showReviewPanel: boolean
  consistencyAlertCount: number
  showNotePanel: boolean
  customInstruction: string
  perspectiveCharacterId: number | null
  perspectiveCharacters: Array<{ id: number; name: string }>
  onGenerate: () => void
  onContinue: () => void
  onExpand: () => void
  onPolish: () => void
  onDeAI: () => void
  onOrganizeChapter: () => void
  onAnalyzeImpact: () => void
  onDismissImpact: () => void
  onImpactPatchTargetChange: (targetId: number | null) => void
  onImpactPatchSummaryChange: (value: string) => void
  onImpactPatchReasonChange: (value: string) => void
  onCreateImpactPatch: () => void
  onRunImpactRemediation: () => void
  onConfirmImpactPatch: () => void
  onRejectImpactPatch: () => void
  onToggleOutlinePreview: () => void
  onToggleReviewPanel: () => void
  onToggleNotePanel: () => void
  onCustomInstructionChange: (value: string) => void
  onPerspectiveCharacterChange: (characterId: number | null) => void
}

export default function ChapterEditorToolbar({
  isStreaming,
  hasText,
  organizingChapter,
  hasOrganizationCandidate,
  analyzingImpact,
  impactInfo,
  impactRemediationPlan,
  impactRemediationBusy,
  impactRemediationReceipt,
  impactRemediationError,
  impactPatchTargets,
  impactPatchTargetId,
  impactPatchSummary,
  impactPatchReason,
  impactPatchCandidate,
  impactPatchBusy,
  impactPatchError,
  hasOutline,
  showOutlinePreview,
  showReviewPanel,
  consistencyAlertCount,
  showNotePanel,
  customInstruction,
  perspectiveCharacterId,
  perspectiveCharacters,
  onGenerate,
  onContinue,
  onExpand,
  onPolish,
  onDeAI,
  onOrganizeChapter,
  onAnalyzeImpact,
  onDismissImpact,
  onImpactPatchTargetChange,
  onImpactPatchSummaryChange,
  onImpactPatchReasonChange,
  onCreateImpactPatch,
  onRunImpactRemediation,
  onConfirmImpactPatch,
  onRejectImpactPatch,
  onToggleOutlinePreview,
  onToggleReviewPanel,
  onToggleNotePanel,
  onCustomInstructionChange,
  onPerspectiveCharacterChange,
}: Props) {
  return (
    <div className="flex flex-wrap gap-2 border-t border-border/60 bg-bg-surface/35 px-6 py-3">
      <button onClick={onGenerate} disabled={isStreaming}
        className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-50 transition-colors">
        ✨ 生成正文
      </button>
      <button onClick={onContinue} disabled={isStreaming || !hasText}
        className="rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-50 transition-colors">
        📝 续写
      </button>
      <button onClick={onExpand} disabled={isStreaming}
        className="rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-50 transition-colors">
        📖 扩写
      </button>
      <button onClick={onPolish} disabled={isStreaming}
        className="rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-50 transition-colors">
        💎 润色
      </button>
      <button onClick={onDeAI} disabled={isStreaming}
        className="rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-50 transition-colors">
        🔥 去AI味
      </button>
      <button onClick={onOrganizeChapter} disabled={isStreaming || !hasText}
        title="一次分析本章，生成状态、事实、物品、年表、关系和伏笔候选；确认前不会写入项目"
        className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500/10 text-emerald-400 text-xs rounded-md hover:bg-emerald-500/20 disabled:opacity-50 transition-colors">
        {organizingChapter
          ? <Loader2 className="w-3 h-3 animate-spin" />
          : <ClipboardList className="w-3 h-3" />}
        {organizingChapter ? '停止整理' : hasOrganizationCandidate ? '查看整理结果' : '整理本章'}
      </button>
      <button onClick={onAnalyzeImpact} disabled={analyzingImpact || !hasText}
        title="NS-6：改了历史章后，检查源自本章的事实证据是否失效（失效则降级待复核），并列出需复核的后续章节。不会自动改正文。"
        className="flex items-center gap-1 px-3 py-1.5 bg-amber-500/10 text-amber-400 text-xs rounded-md hover:bg-amber-500/20 disabled:opacity-50 transition-colors">
        <ClipboardList className="w-3 h-3" />
        {analyzingImpact ? '分析中...' : '影响分析'}
      </button>
      {impactInfo && (
        <div className="basis-full space-y-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300/90">
          <div className="flex items-start gap-2">
            <span className="flex-1">{impactInfo}</span>
            <button onClick={onDismissImpact} aria-label="关闭影响分析结果" className="text-text-muted hover:text-text-primary"><X className="h-3.5 w-3.5" /><span className="sr-only">×</span></button>
          </div>
          {impactRemediationPlan && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-border/70 bg-bg-elevated/60 px-2 py-1.5 text-[11px] text-text-secondary">
              <span>处理计划 {impactRemediationPlan.counts.total} 项</span>
              <span>系统重建 {impactRemediationPlan.counts.deterministic}</span>
              <span>作者复核 {impactRemediationPlan.counts.authorConfirmed}</span>
              <span className="ml-auto text-text-muted">计划 {impactRemediationPlan.planHash.slice(0, 12)}</span>
              {impactRemediationPlan.counts.deterministic > 0 && (
                <button
                  onClick={onRunImpactRemediation}
                  disabled={impactRemediationBusy}
                  title="只重建受影响的检索块和层级摘要，不改正文、事实或大纲"
                  className="flex items-center gap-1 rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-200 hover:bg-amber-400/20 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3 w-3 ${impactRemediationBusy ? 'animate-spin' : ''}`} />
                  {impactRemediationBusy ? '重建中...' : '执行系统重建'}
                </button>
              )}
            </div>
          )}
          {impactPatchTargets.length > 0 && !impactPatchCandidate && (
            <div className="grid gap-2 md:grid-cols-[minmax(150px,0.7fr)_minmax(200px,1.5fr)_minmax(160px,1fr)_auto]">
              <label className="flex items-center gap-2 rounded border border-border bg-bg-elevated px-2 text-text-secondary">
                <GitBranch className="h-3.5 w-3.5 shrink-0" />
                <span className="sr-only">影响修订目标</span>
                <select
                  aria-label="影响修订目标"
                  value={impactPatchTargetId ?? ''}
                  onChange={event => onImpactPatchTargetChange(event.target.value ? Number(event.target.value) : null)}
                  className="min-w-0 flex-1 bg-transparent py-1.5 text-xs text-text-primary outline-none"
                  disabled={impactPatchBusy}
                >
                  <option value="">选择后续大纲</option>
                  {impactPatchTargets.map(target => (
                    <option key={target.id} value={target.id}>{target.title}</option>
                  ))}
                </select>
              </label>
              <textarea
                aria-label="影响修订摘要"
                value={impactPatchSummary}
                onChange={event => onImpactPatchSummaryChange(event.target.value)}
                placeholder="只修改选定后续大纲的摘要，不改正文或事实"
                className="min-h-9 resize-y rounded border border-border bg-bg-elevated px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
                disabled={impactPatchBusy}
              />
              <CInput
                aria-label="影响修订理由"
                value={impactPatchReason}
                onChange={event => onImpactPatchReasonChange(event.target.value)}
                placeholder="修改理由"
                className="rounded border border-border bg-bg-elevated px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent"
                disabled={impactPatchBusy}
              />
              <button
                onClick={onCreateImpactPatch}
                disabled={impactPatchBusy || !impactPatchTargetId || !impactPatchSummary.trim() || !impactPatchReason.trim()}
                title="创建作者确认式大纲摘要候选"
                className="flex items-center justify-center gap-1 rounded border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-400/20 disabled:opacity-50"
              >
                {impactPatchBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitBranch className="h-3.5 w-3.5" />}
                {impactPatchBusy ? '保存中...' : '生成修订候选'}
              </button>
            </div>
          )}
          {impactPatchCandidate && (
            <div className="space-y-2 rounded border border-accent/20 bg-bg-elevated/70 p-2 text-text-secondary">
              <div className="text-[11px] text-text-muted">候选仅允许写入选定大纲的 `summary`，确认前不会改动正式数据。</div>
              <div className="whitespace-pre-wrap text-xs text-text-primary">{impactPatchCandidate.proposal.fields.summary}</div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={onConfirmImpactPatch}
                  disabled={impactPatchBusy}
                  className="flex items-center gap-1 rounded border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-400/20 disabled:opacity-50"
                >
                  {impactPatchBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  确认修订
                </button>
                <button
                  onClick={onRejectImpactPatch}
                  disabled={impactPatchBusy}
                  className="flex items-center gap-1 rounded border border-border bg-bg-surface px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                  放弃修订
                </button>
                <span className="text-[10px] text-text-muted">证据 {impactPatchCandidate.durable.candidateHash.slice(0, 12)}</span>
              </div>
            </div>
          )}
          {impactPatchError && <div role="alert" className="text-xs text-error">{impactPatchError}</div>}
          {impactRemediationReceipt && <div className="text-[10px] text-success">确定性重建回执 {impactRemediationReceipt.slice(0, 12)}</div>}
          {impactRemediationError && <div role="alert" className="text-xs text-error">{impactRemediationError}</div>}
        </div>
      )}
      {hasOutline && (
        <button onClick={onToggleOutlinePreview}
          title="大纲预览"
          aria-pressed={showOutlinePreview}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
            showOutlinePreview
              ? 'bg-accent/10 text-accent'
              : 'bg-bg-elevated text-text-secondary hover:text-text-primary'
          }`}>
          <BookOpenCheck className="w-3 h-3" />
          大纲预览
        </button>
      )}
      <button onClick={onToggleReviewPanel}
        disabled={!hasText}
        title="质量审校"
        aria-pressed={showReviewPanel}
        className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-md transition-colors disabled:opacity-50 ${
          showReviewPanel
            ? 'bg-success/10 text-success'
            : 'bg-bg-elevated text-text-secondary hover:text-text-primary'
        }`}>
        <ShieldCheck className="w-3 h-3" />
        质量审校
        {consistencyAlertCount > 0 && (
          <span className="min-w-4 rounded-full bg-error/15 px-1 text-center text-[10px] text-error">
            {consistencyAlertCount}
          </span>
        )}
      </button>
      <button onClick={onToggleNotePanel}
        title="便签"
        aria-pressed={showNotePanel}
        className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
          showNotePanel
            ? 'bg-yellow-500/10 text-yellow-600'
            : 'bg-bg-elevated text-text-secondary hover:text-text-primary'
        }`}>
        <StickyNote className="w-3 h-3" />
        便签
      </button>
      <label className="flex min-w-[180px] items-center gap-2 rounded-md border border-border bg-bg-elevated px-2 text-xs text-text-secondary">
        <Eye className="h-3.5 w-3.5 shrink-0" />
        <span className="sr-only">叙事视角角色</span>
        <select
          aria-label="叙事视角角色"
          value={perspectiveCharacterId ?? ''}
          onChange={event => onPerspectiveCharacterChange(
            event.target.value ? Number(event.target.value) : null,
          )}
          className="min-w-0 flex-1 bg-transparent py-1.5 text-xs text-text-primary outline-none"
        >
          <option value="">不指定视角</option>
          {perspectiveCharacters.map(character => (
            <option key={character.id} value={character.id}>{character.name}</option>
          ))}
        </select>
      </label>
      <CInput value={customInstruction} onChange={event => onCustomInstructionChange(event.target.value)}
        placeholder="自定义指令..."
        className="min-w-[220px] flex-1 rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent" />
    </div>
  )
}
