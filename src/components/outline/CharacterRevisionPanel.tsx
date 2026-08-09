import { useEffect, useMemo, useState } from 'react'
import {
  Anchor,
  FileSearch,
  Loader2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import type { CharacterDrivenPlan, Project, WorkspaceScope } from '../../lib/types'
import { parseCharacterDrivenPlanArcs } from '../../lib/types'
import { useCharacterStore } from '../../stores/character'
import { useOutlineStore } from '../../stores/outline'
import {
  buildCharacterRevisionSnapshot,
  effectiveProtectedThrough,
  type CharacterRevisionChangeType,
  type CharacterRevisionPlan,
  type CharacterRevisionScopeInput,
  type CharacterRevisionSnapshot,
  type CharacterRevisionStrategy,
} from '../../lib/story-planning/character-revision'
import {
  decideCharacterRevisionCandidateV1,
  parseCharacterRevisionCandidateDraftV1,
  serializeCharacterRevisionCandidateV1,
  type CharacterRevisionCandidateV1,
  type CharacterRevisionCopilotSnapshotV1,
} from '../../lib/agent/character-revision-copilot'
import type { MasterCopilotController } from '../agent/useMasterCopilot'
import AutoResizeTextarea from '../shared/AutoResizeTextarea'
import { useDialog } from '../shared/Dialog'
import CharacterRevisionResult from './CharacterRevisionResult'

interface Props {
  project: Project
  plan: CharacterDrivenPlan | null
  copilot: MasterCopilotController
  onSwitchToPlanning: () => void
}

const CHANGE_LABELS: Record<CharacterRevisionChangeType, string> = {
  'add-character': '新增角色',
  'revise-arc': '修改角色弧光',
  'revise-ending': '调整目标/结局',
  'remove-or-demote': '删除或降低戏份',
}

const STRATEGY_LABELS: Record<CharacterRevisionStrategy, string> = {
  light: '只小修',
  balanced: '保留关键节点重排',
  deep: '深度重构未写区',
}

export default function CharacterRevisionPanel({
  project,
  plan,
  copilot,
  onSwitchToPlanning,
}: Props) {
  const characters = useCharacterStore(state => state.characters)
  const loadOutline = useOutlineStore(state => state.loadAll)
  const dialog = useDialog()
  const workspaceScope = useMemo<WorkspaceScope | undefined>(() => (
    project.id != null && project.activeWorldId != null && project.activeWorkId != null
      ? { projectId: project.id, worldId: project.activeWorldId, workId: project.activeWorkId }
      : undefined
  ), [project.activeWorkId, project.activeWorldId, project.id])
  const scopeInput = workspaceScope ?? project.id!

  const [snapshot, setSnapshot] = useState<CharacterRevisionSnapshot | null>(null)
  const [loadingSnapshot, setLoadingSnapshot] = useState(true)
  const [changeType, setChangeType] = useState<CharacterRevisionChangeType>('revise-arc')
  const [characterId, setCharacterId] = useState<number | null>(null)
  const [changeDescription, setChangeDescription] = useState('')
  const [protectedThrough, setProtectedThrough] = useState(0)
  const [transitionCount, setTransitionCount] = useState(10)
  const [strategy, setStrategy] = useState<CharacterRevisionStrategy>('balanced')
  const [anchorNodeIds, setAnchorNodeIds] = useState<Set<number>>(new Set())
  const [extraRequirements, setExtraRequirements] = useState('')
  const [analysis, setAnalysis] = useState<CharacterRevisionPlan | null>(null)
  const [parsedCandidate, setParsedCandidate] = useState<CharacterRevisionCandidateV1 | null>(null)
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null)
  const [selectedPatchIds, setSelectedPatchIds] = useState<Set<number>>(new Set())
  const [localError, setLocalError] = useState<string | null>(null)
  const [resultMessage, setResultMessage] = useState<string | null>(null)
  const pendingRevisionCandidates = copilot.pendingCandidates.filter(candidate => (
    candidate.payload.skillId === 'outline.character-revision'
    && candidate.payload.characterRevisionRequest?.planId === (plan?.id ?? null)
  ))
  const activeCandidate = pendingRevisionCandidates[0] ?? null
  const hasOtherPendingCandidates = copilot.pendingCandidates.some(candidate => candidate !== activeCandidate)

  const refreshSnapshot = async () => {
    setLoadingSnapshot(true)
    try {
      const next = await buildCharacterRevisionSnapshot(scopeInput)
      setSnapshot(next)
      setProtectedThrough(current => Math.max(current, next.lastWrittenOrdinal))
    } finally {
      setLoadingSnapshot(false)
    }
  }

  useEffect(() => {
    setAnalysis(null)
    setParsedCandidate(null)
    setSelectedOptionId(null)
    setSelectedPatchIds(new Set())
    void refreshSnapshot()
  }, [scopeInput]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (characterId != null && characters.some(character => character.id === characterId)) return
    const planArc = parseCharacterDrivenPlanArcs(plan?.arcs).find(arc =>
      arc.characterId != null && characters.some(character => character.id === arc.characterId),
    )
    const fallback = characters.find(character => character.roleWeight === 'main') ?? characters[0]
    setCharacterId(planArc?.characterId ?? fallback?.id ?? null)
  }, [characters, plan?.id, characterId, plan?.arcs])

  const selectedCharacter = characters.find(character => character.id === characterId)
  const effectiveBoundary = snapshot
    ? effectiveProtectedThrough(snapshot, protectedThrough)
    : protectedThrough
  const anchorCandidates = useMemo(
    () => snapshot?.chapters.filter(chapter => chapter.ordinal > effectiveBoundary) ?? [],
    [snapshot, effectiveBoundary],
  )
  const selectedOption = analysis?.options.find(option => option.id === selectedOptionId) ?? null

  useEffect(() => {
    if (!activeCandidate) {
      setAnalysis(null)
      setParsedCandidate(null)
      setSelectedOptionId(null)
      setSelectedPatchIds(new Set())
      return
    }
    try {
      const parsed = parseCharacterRevisionCandidateDraftV1(
        activeCandidate.event.content,
        activeCandidate.payload.baseSnapshot as CharacterRevisionCopilotSnapshotV1,
      )
      setParsedCandidate(parsed)
      setAnalysis(parsed.plan)
      const preferred = parsed.decision
        ? parsed.plan.options.find(option => option.id === parsed.decision!.optionId)
        : parsed.plan.options.find(option => (
            option.intensity === activeCandidate.payload.characterRevisionRequest?.strategy
          )) ?? parsed.plan.options[0]
      setSelectedOptionId(preferred?.id ?? null)
      setSelectedPatchIds(new Set(
        parsed.decision?.outlineNodeIds ?? preferred?.patches.map(patch => patch.outlineNodeId) ?? [],
      ))
      setLocalError(null)
    } catch (error) {
      setAnalysis(null)
      setParsedCandidate(null)
      setLocalError(error instanceof Error ? error.message : '恢复的角色重规划候选已损坏。')
    }
  }, [activeCandidate])

  useEffect(() => {
    if (!selectedOption) return
    setSelectedPatchIds(new Set(selectedOption.patches.map(patch => patch.outlineNodeId)))
  }, [selectedOptionId]) // eslint-disable-line react-hooks/exhaustive-deps

  function currentScope(): CharacterRevisionScopeInput {
    return {
      changeType,
      characterId,
      characterName: selectedCharacter?.name ?? '',
      changeDescription,
      protectedThroughOrdinal: effectiveBoundary,
      transitionChapterCount: transitionCount,
      strategy,
      anchorNodeIds: [...anchorNodeIds],
      extraRequirements,
    }
  }

  const handleAnalyze = async () => {
    if (!snapshot || !changeDescription.trim()) return
    setLocalError(null)
    setResultMessage(null)
    setAnalysis(null)
    setParsedCandidate(null)
    setSelectedOptionId(null)
    setSelectedPatchIds(new Set())
    try {
      const requestedScope = currentScope()
      await copilot.submitTargetedRequest(
        '分析当前角色变更对已写事实、角色状态、故事线和未来大纲的影响，并生成三档可审查方案。',
        {
          agentId: 'outline',
          skillId: 'outline.character-revision',
          instruction: '分析当前角色变更对已写事实、角色状态、故事线和未来大纲的影响，并生成三档可审查方案。',
          characterRevisionRequest: {
            planId: plan?.id ?? null,
            ...requestedScope,
          },
        },
      )
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '影响分析准备失败')
    }
  }

  const handleApply = async () => {
    if (!selectedOption || !parsedCandidate || !activeCandidate) return
    const patches = selectedOption.patches.filter(patch => selectedPatchIds.has(patch.outlineNodeId))
    if (!patches.length) return
    const confirmed = await dialog.confirm({
      title: `应用 ${patches.length} 个未写大纲 patch？`,
      message: '系统会再次检查正文保护区、锚点和分析后的手工改动。不会修改任何章节正文或故事主线。',
      confirmText: '应用到大纲',
    })
    if (!confirmed) return
    setResultMessage(null)
    try {
      const decided = decideCharacterRevisionCandidateV1(
        parsedCandidate,
        selectedOption.id,
        patches.map(patch => patch.outlineNodeId),
      )
      const draft = serializeCharacterRevisionCandidateV1(decided)
      await copilot.updateCandidate(activeCandidate.event.id!, draft)
      const adopted = await copilot.adoptCandidate({
        ...activeCandidate,
        event: { ...activeCandidate.event, content: draft },
        payload: { ...activeCandidate.payload },
      })
      if (!adopted) return
      await loadOutline(scopeInput)
      await refreshSnapshot()
      setResultMessage(`已应用 ${patches.length} 项`)
      setSelectedPatchIds(new Set())
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '角色重规划写入失败')
    }
  }

  const handleCopy = async () => {
    if (!analysis) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(analysis, null, 2))
      setResultMessage('修订计划已复制到剪贴板')
    } catch {
      setResultMessage('浏览器未授予剪贴板权限，请从 AI 输出区手动复制')
    }
  }

  const handleReject = async () => {
    if (!activeCandidate) return
    const rejected = await copilot.rejectCandidate(activeCandidate)
    if (!rejected) return
    setResultMessage('本次角色重规划候选已拒绝，未写入任何正式内容。')
  }

  const toggleAnchor = (nodeId: number) => {
    setAnchorNodeIds(current => {
      const next = new Set(current)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }

  const togglePatch = (nodeId: number) => {
    setSelectedPatchIds(current => {
      const next = new Set(current)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border bg-bg-surface">
        <FileSearch className="w-5 h-5 text-accent" />
        <div>
          <h2 className="text-lg font-semibold text-text-primary">角色变更影响分析</h2>
          <p className="text-[11px] text-text-muted">先保护已写正文，再审查并应用未写大纲 patch</p>
        </div>
        <div className="ml-auto flex rounded-lg border border-border bg-bg-base p-0.5">
          <button onClick={onSwitchToPlanning} className="px-3 py-1.5 text-xs text-text-muted rounded">
            开书规划
          </button>
          <button className="px-3 py-1.5 text-xs bg-accent text-white rounded">
            中途重规划
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded-lg border border-border bg-bg-surface p-4">
            <h3 className="text-sm font-medium text-text-primary">1. 说明角色发生了什么变化</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs text-text-muted">
                变更类型
                <select
                  value={changeType}
                  onChange={event => setChangeType(event.target.value as CharacterRevisionChangeType)}
                  className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-2 text-sm text-text-primary"
                  aria-label="角色变更类型"
                >
                  {Object.entries(CHANGE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-text-muted">
                目标角色
                <select
                  value={characterId ?? ''}
                  onChange={event => setCharacterId(event.target.value ? Number(event.target.value) : null)}
                  className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-2 text-sm text-text-primary"
                  aria-label="重规划目标角色"
                >
                  <option value="">未指定角色</option>
                  {characters.map(character => (
                    <option key={character.id} value={character.id}>{character.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <AutoResizeTextarea
              value={changeDescription}
              onChange={event => setChangeDescription(event.target.value)}
              placeholder="写清新旧弧光差异、关键转折和与主线的关系..."
              className="w-full rounded border border-border bg-bg-base px-3 py-2 text-sm text-text-primary"
              minRows={4}
            />
            <AutoResizeTextarea
              value={extraRequirements}
              onChange={event => setExtraRequirements(event.target.value)}
              placeholder="额外要求：切入方式、戏份、阵营关系、禁止改动..."
              className="w-full rounded border border-border bg-bg-base px-3 py-2 text-sm text-text-primary"
              minRows={2}
            />
            {plan && (
              <p className="text-xs text-text-muted">
                本次对照方案：<span className="text-text-primary">{plan.name} · v{plan.version}</span>
              </p>
            )}
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-bg-surface p-4">
            <h3 className="text-sm font-medium text-text-primary">2. 划定保护和重规划范围</h3>
            {loadingSnapshot ? (
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <Loader2 className="w-4 h-4 animate-spin" />读取真实章序...
              </div>
            ) : snapshot ? (
              <>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded bg-green-500/10 p-2 text-green-700">
                    <strong className="block text-base">{snapshot.writtenChapterCount}</strong>有正文
                  </div>
                  <div className="rounded bg-accent/10 p-2 text-accent">
                    <strong className="block text-base">{snapshot.plannedChapterCount}</strong>有大纲
                  </div>
                  <div className="rounded bg-amber-500/10 p-2 text-amber-700">
                    <strong className="block text-base">{snapshot.lastWrittenOrdinal}</strong>写到章序
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="text-xs text-text-muted">
                    保护到第几章
                    <input
                      type="number"
                      min={snapshot.lastWrittenOrdinal}
                      max={snapshot.plannedChapterCount}
                      value={effectiveBoundary}
                      onChange={event => setProtectedThrough(Number(event.target.value))}
                      className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-2 text-sm text-text-primary"
                      aria-label="正文保护截止章序"
                    />
                  </label>
                  <label className="text-xs text-text-muted">
                    近期过渡章数
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={transitionCount}
                      onChange={event => setTransitionCount(Math.max(0, Number(event.target.value)))}
                      className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-2 text-sm text-text-primary"
                      aria-label="近期过渡章数"
                    />
                  </label>
                </div>
                <label className="block text-xs text-text-muted">
                  后续大纲策略
                  <select
                    value={strategy}
                    onChange={event => setStrategy(event.target.value as CharacterRevisionStrategy)}
                    className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-2 text-sm text-text-primary"
                    aria-label="后续大纲策略"
                  >
                    {Object.entries(STRATEGY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                {!snapshot.writtenChapterCount && (
                  <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700">
                    当前没有正文，只能做大纲级重规划，无法做正文影响分析。
                  </div>
                )}
                {!snapshot.hasChapterMemory && snapshot.writtenChapterCount > 0 && (
                  <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700">
                    已有正文但缺少章节记忆；系统会使用有限证据，结论需重点人工复核。
                  </div>
                )}
              </>
            ) : null}
          </div>
        </section>

        {anchorCandidates.length > 0 && (
          <section className="rounded-lg border border-border bg-bg-surface p-4">
            <div className="mb-3 flex items-center gap-2">
              <Anchor className="w-4 h-4 text-accent" />
              <h3 className="text-sm font-medium text-text-primary">3. 标记必须保留的后续锚点</h3>
              <span className="text-xs text-text-muted">锚点不可改名或反转，只能调整参与者和铺垫</span>
            </div>
            <div className="grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {anchorCandidates.map(chapter => (
                <label key={chapter.outlineNodeId} className="flex items-start gap-2 rounded border border-border p-2 text-xs">
                  <input
                    type="checkbox"
                    checked={anchorNodeIds.has(chapter.outlineNodeId)}
                    onChange={() => toggleAnchor(chapter.outlineNodeId)}
                    className="mt-0.5 accent-accent"
                  />
                  <span>
                    <strong className="text-text-primary">第{chapter.ordinal}章 · {chapter.title}</strong>
                    <span className="mt-0.5 block line-clamp-2 text-text-muted">{chapter.summary || '无摘要'}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleAnalyze}
            disabled={
              !snapshot
              || !changeDescription.trim()
              || copilot.loading
              || copilot.busy
              || copilot.pendingCandidates.length > 0
            }
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {copilot.busy
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Sparkles className="w-4 h-4" />}
            {copilot.busy ? '正在分析影响...' : '分析影响并生成三档方案'}
          </button>
          {copilot.busy && (
            <button
              onClick={copilot.stop}
              className="rounded border border-border px-3 py-2 text-xs text-text-muted"
            >
              停止
            </button>
          )}
          {copilot.recoveryAvailable && !copilot.busy && (
            <button
              onClick={() => { void copilot.resume() }}
              className="rounded border border-border px-3 py-2 text-xs text-text-muted"
            >
              恢复中断任务
            </button>
          )}
          <div className="inline-flex items-center gap-1.5 text-xs text-text-muted">
            <ShieldCheck className="w-4 h-4 text-green-600" />
            分析不会写入正文、大纲或主线
          </div>
        </div>

        {(localError || copilot.error) && (
          <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600">
            {localError || copilot.error}
          </div>
        )}

        {hasOtherPendingCandidates && (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700">
            当前作品还有其它待确认候选；请先回到对应入口处理，避免并行覆盖同一创作基线。
          </div>
        )}

        {analysis && (
          <CharacterRevisionResult
            analysis={analysis}
            selectedOptionId={selectedOptionId}
            selectedPatchIds={selectedPatchIds}
            applying={copilot.busy}
            onSelectOption={setSelectedOptionId}
            onTogglePatch={togglePatch}
            onCopy={handleCopy}
            onApply={handleApply}
            onReject={() => { void handleReject() }}
          />
        )}

        {resultMessage && (
          <div className="rounded border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-700">
            {resultMessage}
          </div>
        )}
      </div>
    </div>
  )
}
