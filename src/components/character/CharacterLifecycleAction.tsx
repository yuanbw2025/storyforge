import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2, RefreshCw, X } from 'lucide-react'
import {
  CHARACTER_NARRATIVE_STATUSES,
  parseCharacterLifecycleCandidateV1,
  serializeCharacterLifecycleCandidateV1,
  type CharacterLifecycleCandidateV1,
} from '../../lib/agent/character-lifecycle-copilot'
import type { Character, CharacterNarrativeStatus, Project } from '../../lib/types'
import { useChapterStore } from '../../stores/chapter'
import { useStoryArcStore } from '../../stores/story-arc'
import { useOutlineStore } from '../../stores/outline'
import { useMasterCopilot } from '../agent/useMasterCopilot'
import HarnessEvidencePanel from '../agent/HarnessEvidencePanel'
import CandidateSaveFeedback from '../agent/CandidateSaveFeedback'
import { CInput, CTextarea } from '../shared/CompositionInput'

const STATUS_LABELS: Record<CharacterNarrativeStatus, string> = {
  planned: '计划登场',
  active: '活跃',
  inactive: '暂离',
  retired: '退场',
  deceased: '死亡',
}

export default function CharacterLifecycleAction({
  character,
  project,
  worldGroupId,
  onDone,
  compact = false,
}: {
  character: Character
  project: Project
  worldGroupId: number | null
  onDone?: () => void
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const current = character.narrativeStatus ?? 'active'
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className={compact
          ? 'p-1 text-text-muted hover:text-accent rounded transition-colors'
          : 'px-2 py-1 text-xs text-text-secondary hover:text-accent border border-border rounded hover:border-accent/50 transition-colors'}
        title={`角色状态：${STATUS_LABELS[current]}；生成带章节/故事线证据的变化候选`}
      >
        {compact ? <RefreshCw className="h-3.5 w-3.5" /> : <>状态 · {STATUS_LABELS[current]}</>}
      </button>
      {open && (
        <LifecycleDialog
          character={character}
          project={project}
          worldGroupId={worldGroupId}
          onClose={() => setOpen(false)}
          onDone={onDone}
        />
      )}
    </div>
  )
}

function LifecycleDialog({
  character,
  project,
  worldGroupId,
  onClose,
  onDone,
}: {
  character: Character
  project: Project
  worldGroupId: number | null
  onClose: () => void
  onDone?: () => void
}) {
  const copilot = useMasterCopilot({ project, worldGroupId })
  const [editError, setEditError] = useState<string | null>(null)
  const chapters = useChapterStore(state => state.chapters)
  const loadChapters = useChapterStore(state => state.loadAll)
  const arcs = useStoryArcStore(state => state.arcs)
  const loadArcs = useStoryArcStore(state => state.loadAll)
  const outlineNodes = useOutlineStore(state => state.nodes)
  const loadOutlineNodes = useOutlineStore(state => state.loadAll)
  const current = character.narrativeStatus ?? 'active'
  const [targetStatus, setTargetStatus] = useState<CharacterNarrativeStatus>(
    current === 'active' ? 'inactive' : 'active',
  )
  const [chapterId, setChapterId] = useState<number | null>(null)
  const [arcId, setArcId] = useState<number | null>(null)
  const [hint, setHint] = useState('')
  const candidate = copilot.pendingCandidates.find(item => (
    item.payload.skillId === 'character.lifecycle'
    && item.payload.characterLifecycleRequest?.characterId === character.id
  ))
  const parsed = useMemo(() => {
    if (!candidate) return null
    try {
      return parseCharacterLifecycleCandidateV1(candidate.event.content, candidate.payload.baseSnapshot as never)
    } catch {
      return null
    }
  }, [candidate])
  useEffect(() => setEditError(null), [candidate?.event.id])
  const visibleOutlineIds = useMemo(() => new Set(outlineNodes
    .filter(node => (node.worldGroupId ?? null) === worldGroupId)
    .map(node => node.id)
    .filter((id): id is number => id != null)), [outlineNodes, worldGroupId])
  const visibleChapters = useMemo(() => chapters.filter(chapter => (
    visibleOutlineIds.has(chapter.outlineNodeId)
  )), [chapters, visibleOutlineIds])
  const visibleArcs = useMemo(() => arcs.filter(arc => (
    (arc.worldGroupId ?? null) === worldGroupId
  )), [arcs, worldGroupId])

  useEffect(() => {
    if (project.id == null) return
    void Promise.all([loadChapters(project.id), loadArcs(project.id), loadOutlineNodes(project.id)])
  }, [loadArcs, loadChapters, loadOutlineNodes, project.id])

  const run = async () => {
    if (character.id == null || (chapterId == null && arcId == null)) return
    await copilot.submitTargetedRequest(
      `为角色“${character.name}”生成从${STATUS_LABELS[current]}到${STATUS_LABELS[targetStatus]}的状态变化候选。`,
      {
        id: `character-lifecycle-${character.id}`,
        agentId: 'character',
        skillId: 'character.lifecycle',
        instruction: hint.trim() || `依据绑定证据说明“${character.name}”为何进入${STATUS_LABELS[targetStatus]}状态。`,
        characterLifecycleRequest: {
          characterId: character.id,
          targetStatus,
          evidenceChapterId: chapterId,
          evidenceStoryArcId: arcId,
        },
      },
    )
  }

  const updateCandidate = async (patch: Partial<CharacterLifecycleCandidateV1>) => {
    if (!candidate || !parsed) return
    const next = { ...parsed, ...patch }
    setEditError(null)
    try {
      await copilot.updateCandidate(
        candidate.event.id!,
        serializeCharacterLifecycleCandidateV1(next, candidate.payload.baseSnapshot as never),
      )
    } catch (cause) {
      setEditError(cause instanceof Error ? cause.message : '候选修改未保存，请修正后重试。')
    }
  }

  const adoptCandidate = async () => {
    if (editError || !candidate || !await copilot.adoptCandidate(candidate)) return
    onDone?.()
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute top-full right-0 mt-1 z-50 w-[min(560px,calc(100vw-2rem))] max-h-[min(720px,calc(100vh-4rem))] overflow-y-auto rounded-lg border border-border bg-bg-surface p-3 shadow-lg">
        <div className="mb-2 flex items-center justify-between">
          <strong className="text-sm text-text-primary">角色状态候选 · {character.name}</strong>
          <button type="button" onClick={onClose} aria-label="关闭角色状态候选"><X className="h-4 w-4" /></button>
        </div>
        {!candidate && (
          <div className="space-y-2">
            <label className="block text-xs text-text-secondary">目标状态
              <select
                aria-label="角色目标状态"
                value={targetStatus}
                onChange={event => setTargetStatus(event.target.value as CharacterNarrativeStatus)}
                className="mt-1 w-full rounded border border-border bg-bg-elevated px-2 py-1.5"
              >
                {CHARACTER_NARRATIVE_STATUSES.filter(value => value !== current).map(value => (
                  <option key={value} value={value}>{STATUS_LABELS[value]}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-text-secondary">触发章节（至少选择一种证据）
              <select
                aria-label="角色状态触发章节"
                value={chapterId ?? ''}
                onChange={event => setChapterId(event.target.value ? Number(event.target.value) : null)}
                className="mt-1 w-full rounded border border-border bg-bg-elevated px-2 py-1.5"
              >
                <option value="">未选择</option>
                {visibleChapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}
              </select>
            </label>
            <label className="block text-xs text-text-secondary">触发故事线
              <select
                aria-label="角色状态触发故事线"
                value={arcId ?? ''}
                onChange={event => setArcId(event.target.value ? Number(event.target.value) : null)}
                className="mt-1 w-full rounded border border-border bg-bg-elevated px-2 py-1.5"
              >
                <option value="">未选择</option>
                {visibleArcs.map(arc => <option key={arc.id} value={arc.id}>{arc.name}</option>)}
              </select>
            </label>
            <CInput value={hint} onChange={event => setHint(event.target.value)} placeholder="补充说明（可选）" />
          </div>
        )}
        {(editError || copilot.error) && <p role="alert" className="mt-2 text-xs text-error">{editError ?? copilot.error}</p>}
        {candidate && parsed && (
          <div className="mt-3 space-y-2">
            <CandidateSaveFeedback event={candidate.event} scope={copilot.candidateLocalSaveScope}
              draftState={copilot.readCandidateLocalDraftState?.(candidate.event.id!)} busy={copilot.busy}
              onRetry={() => copilot.flushCandidateDraft(candidate.event.id!)}>
            <p className="text-xs text-text-secondary">{STATUS_LABELS[parsed.fromStatus]} → {STATUS_LABELS[parsed.targetStatus]}</p>
            <CTextarea aria-label="角色状态变化理由" rows={4} value={parsed.reason} onChange={event => { void updateCandidate({ reason: event.target.value }) }} />
            <CTextarea aria-label="角色退场结局" rows={3} value={parsed.ending} onChange={event => { void updateCandidate({ ending: event.target.value }) }} />
            <CInput aria-label="角色活跃章节范围" value={parsed.activeChapterRange} onChange={event => { void updateCandidate({ activeChapterRange: event.target.value }) }} />
            </CandidateSaveFeedback>
            <HarnessEvidencePanel contextEvidence={candidate.payload.contextEvidence} lifecycle={candidate.lifecycle} />
          </div>
        )}
        <div className="mt-3 flex justify-end gap-2">
          {candidate ? (
            <>
              <button type="button" disabled={copilot.busy} onClick={() => { void copilot.rejectCandidate(candidate) }} className="px-2 py-1 text-xs"><X className="inline h-3 w-3" /> 拒绝</button>
              <button type="button" disabled={copilot.busy || !parsed || !!editError} onClick={() => { void adoptCandidate() }} className="rounded bg-accent px-2.5 py-1.5 text-xs text-white"><Check className="inline h-3 w-3" /> 采纳</button>
            </>
          ) : (
            <button type="button" disabled={copilot.loading || copilot.busy || (chapterId == null && arcId == null)} onClick={() => { void run() }} className="rounded bg-accent px-2.5 py-1.5 text-xs text-white disabled:opacity-50">
              {copilot.loading ? <Loader2 className="inline h-3 w-3 animate-spin" /> : <RefreshCw className="inline h-3 w-3" />} 生成候选
            </button>
          )}
        </div>
      </div>
    </>
  )
}
