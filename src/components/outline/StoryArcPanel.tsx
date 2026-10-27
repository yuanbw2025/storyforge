/**
 * 故事线面板 — Phase B2
 * 展示/编辑全局故事线（主线+支线），支持 AI 生成
 */
import { useState, useEffect, useRef } from 'react'
import { ArrowUpDown, Check, Plus, Sparkles, Loader2, Trash2, GripVertical, X, ChevronDown, ChevronRight, ChevronUp } from 'lucide-react'
import { useStoryArcStore, type StoryStageEditV1 } from '../../stores/story-arc'
import { useMasterCopilot } from '../agent/useMasterCopilot'
import { CInput } from '../shared/CompositionInput'
import { CTextarea } from '../shared/CompositionInput'
import { useDialog } from '../shared/Dialog'
import AcknowledgedTextField from '../shared/AcknowledgedTextField'
import { flushPendingEditsV1, registerPendingDraftFlusherV1 } from '../../lib/authoring/pending-edit-coordinator'
import type { Project, StoryArc, StoryArcType } from '../../lib/types'
import { parseStages, type StoryStage } from '../../lib/types/story-arc'
import { nanoid } from 'nanoid'
import StorylineProgressPanel from './StorylineProgressPanel'
import CreativeArtifactSummary from '../agent/CreativeArtifactSummary'
import { creativeArtifactCanAdoptV1 } from '../../lib/agent/creative-reliability'
import HarnessEvidencePanel from '../agent/HarnessEvidencePanel'
import type { StoryArcOperationV1, StoryArcCopilotSnapshot } from '../../lib/agent/story-arc-copilot'
import {
  INITIAL_RECORD_TARGET_CLASS,
  initialRecordTargetAttributes,
  useInitialRecordTarget,
} from '../shared/initial-record-target'

export interface StoryArcInitialRecordTarget {
  table: 'storyArcs' | 'storylineProgress' | 'storylineCrossings'
  recordId: number
}

interface Props {
  project: Project
  worldGroupId: number | null
  initialRecordTarget?: StoryArcInitialRecordTarget | null
}

export default function StoryArcPanel({ project, worldGroupId, initialRecordTarget }: Props) {
  const dialog = useDialog()
  const {
    arcs,
    activeArcId,
    intentAlignmentByArcId,
    loadAll,
    setActiveArc,
    addArc,
    updateArc,
    deleteArc,
    editStage,
    loading,
    loadError,
    loadedScope,
  } = useStoryArcStore()
  const copilot = useMasterCopilot({ project, worldGroupId })
  const [genType, setGenType] = useState<StoryArcType>('main')
  const [authorBusy, setAuthorBusy] = useState(false)
  const [authorError, setAuthorError] = useState('')
  const runAuthorAction = async (action: () => void | Promise<void>, block = true) => {
    if (block && authorBusy) return
    if (block) setAuthorBusy(true)
    setAuthorError('')
    try { await flushPendingEditsV1(); await action() }
    catch (error) { setAuthorError(error instanceof Error ? error.message : '故事线操作未完成，输入已保留。') }
    finally { if (block) setAuthorBusy(false) }
  }
  const submitTargeted = (...args: Parameters<typeof copilot.submitTargetedRequest>) => runAuthorAction(() => copilot.submitTargetedRequest(...args), false)
  const scopeKey = `${project.id}:${project.activeWorldId}:${project.activeWorkId}`
  const currentScopeKey = useRef(scopeKey)
  currentScopeKey.current = scopeKey
  const panelActive = useRef(true)
  useEffect(() => { panelActive.current = true; return () => { panelActive.current = false } }, [])
  const reloadCurrentArcs = async () => {
    if (!panelActive.current || currentScopeKey.current !== scopeKey) return
    await loadAll(loadedScope ?? { projectId: project.id!, worldId: project.activeWorldId!, workId: project.activeWorkId! })
  }

  useEffect(() => {
    void loadAll({ projectId: project.id!, worldId: project.activeWorldId!, workId: project.activeWorkId! })
  }, [project.id, project.activeWorldId, project.activeWorkId, loadAll])

  const activeArc = arcs.find(a => a.id === activeArcId)
  const activeIntentAlignment = activeArc?.id == null
    ? undefined
    : intentAlignmentByArcId[activeArc.id]
  const activeStages = activeArc ? parseStages(activeArc.stages) : []
  const initialArcId = initialRecordTarget?.table === 'storyArcs'
    ? initialRecordTarget.recordId
    : null

  useEffect(() => {
    if (initialArcId != null && arcs.some(arc => arc.id === initialArcId)) setActiveArc(initialArcId)
  }, [arcs, initialArcId, setActiveArc])
  useInitialRecordTarget(initialArcId, activeArc?.id === initialArcId)

  // 新建空故事线
  const handleAddArc = async (type: StoryArcType) => {
    await runAuthorAction(async () => {
      const name = type === 'main' ? '主线' : `支线${arcs.filter(a => a.type === 'sub').length + 1}`
      const id = await addArc({
        projectId: project.id!,
        name,
        type,
        stages: '[]',
        description: '',
      }, loadedScope ?? undefined)
      if (panelActive.current && currentScopeKey.current === scopeKey) setActiveArc(id)
    })
  }

  const pendingStoryArcCandidates = copilot.pendingCandidates.filter(candidate => (
    candidate.payload.skillId === 'outline.story-arcs'
  ))
  const hasOtherPendingCandidates = copilot.pendingCandidates.some(candidate => (
    candidate.payload.skillId !== 'outline.story-arcs'
  ))

  // 生成请求统一进入主 Agent 的 outline.story-arcs Skill。
  const handleGenerate = async () => {
    const typeLabel = genType === 'main' ? '主线' : '支线'
    await runAuthorAction(() => copilot.submitRequest(`依据当前作品已确认的世界、故事核心、角色和既有规划，生成一条${typeLabel}故事线。`), false)
  }

  const handleTransform = async (operation: Exclude<StoryArcOperationV1, 'create'>) => {
    if (activeArc?.id == null) return
    const operationLabel = operation === 'expand'
      ? '扩写'
      : operation === 'rewrite'
        ? '重写'
        : operation === 'polish'
          ? '润色'
          : '重规划'
    const instruction = `${operationLabel}现有${activeArc.type === 'main' ? '主线' : '支线'}“${activeArc.name}”，保持目标身份并依据当前已确认 Canon 生成可编辑候选。`
    await submitTargeted(instruction, {
      agentId: 'outline',
      skillId: 'outline.story-arcs',
      instruction,
      storyArcMutationRequest: { operation, targetArcId: activeArc.id },
    })
  }

  // PR #60 的阶段事件按钮保留，但执行统一进入已治理的故事线 Skill：
  // 返回候选并由作者采纳，不在组件中直连模型或直接覆盖故事线。
  const generateKeyEvents = async (
    stage: StoryStage,
    allStages: StoryStage[],
    currentKeyEvents: string[]
  ): Promise<void> => {
    if (activeArc?.id == null) return
    const neighborSummary = allStages
      .filter(item => item.id !== stage.id)
      .map(item => item.title)
      .join('、')
    const instruction = [
      `只扩写故事线“${activeArc.name}”中的阶段“${stage.title}”关键事件。`,
      `阶段描述：${stage.description || '未填写'}。`,
      currentKeyEvents.length > 0 ? `必须保留现有事件：${currentKeyEvents.join('、')}。` : '当前还没有关键事件。',
      neighborSummary ? `相邻阶段：${neighborSummary}；不得改写其他阶段。` : '',
      '新增 3—5 个具有因果递进的关键事件，并返回完整故事线候选供作者审查。',
    ].filter(Boolean).join('\n')
    await submitTargeted(instruction, {
      agentId: 'outline',
      skillId: 'outline.story-arcs',
      instruction,
      storyArcMutationRequest: { operation: 'expand', targetArcId: activeArc.id },
    })
  }

  const sortKeyEvents = async (
    stage: StoryStage,
    _allStages: StoryStage[],
    currentKeyEvents: string[]
  ): Promise<void> => {
    if (activeArc?.id == null || currentKeyEvents.length < 2) return
    const instruction = [
      `只重排故事线“${activeArc.name}”阶段“${stage.title}”的关键事件。`,
      `现有事件：${currentKeyEvents.map((event, index) => `${index + 1}. ${event}`).join('；')}`,
      '按时间和因果顺序排列，不得新增、删除、改写事件，也不得改变其他阶段；返回完整故事线候选供作者审查。',
    ].join('\n')
    await submitTargeted(instruction, {
      agentId: 'outline',
      skillId: 'outline.story-arcs',
      instruction,
      storyArcMutationRequest: { operation: 'replan', targetArcId: activeArc.id },
    })
  }

  // 删除故事线
  const handleDeleteArc = async (id: number) => {
    await runAuthorAction(async () => {
    const arc = arcs.find(a => a.id === id)
    if (!arc) return
    const ok = await dialog.confirm({
      title: `删除故事线「${arc.name}」？`,
      message: '此操作不可恢复。',
      confirmText: '删除',
      tone: 'danger',
    })
    if (!ok) return
    await deleteArc(id, loadedScope ?? undefined)
    })
  }

  return (
    <div className="max-w-4xl">
      <h2 className="text-xl font-bold text-text-primary mb-4">🧵 全局故事线</h2>
      {authorError && <p role="alert" className="mb-3 rounded border border-error/30 p-3 text-xs text-error">{authorError}</p>}
      {loading && <p role="status">正在读取故事线…</p>}
      {loadError && <div role="alert" className="mb-3 text-xs text-error">{loadError} <button onClick={() => void runAuthorAction(() => loadAll({ projectId: project.id!, worldId: project.activeWorldId!, workId: project.activeWorkId! }))}>重新读取</button></div>}
      <fieldset className="contents" disabled={authorBusy || loading || Boolean(loadError)}>

      {/* 故事线 Tab 切换 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {arcs.map(arc => (
          <button
            key={arc.id}
            onClick={() => void runAuthorAction(() => setActiveArc(arc.id!))}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
              activeArcId === arc.id
                ? 'bg-accent text-white'
                : 'bg-bg-elevated text-text-secondary hover:text-text-primary'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${arc.type === 'main' ? 'bg-amber-400' : 'bg-blue-400'}`} />
            {arc.name}
            {arc.id != null && intentAlignmentByArcId[arc.id] === 'stale' && (
              <span title="故事核心意图的冻结 hash 已变化，当前故事线不会被自动覆盖">意图已变</span>
            )}
            {arc.id != null && intentAlignmentByArcId[arc.id] === 'source-missing' && (
              <span title="故事线记录的故事核心来源已经缺失或不属于当前 Work">来源缺失</span>
            )}
          </button>
        ))}

        {/* 新增 / AI 生成 */}
        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={() => handleAddArc('main')}
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-text-muted hover:text-accent transition-colors"
            title="新增主线"
          >
            <Plus className="w-3.5 h-3.5" /> 主线
          </button>
          <button
            onClick={() => handleAddArc('sub')}
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-text-muted hover:text-accent transition-colors"
            title="新增支线"
          >
            <Plus className="w-3.5 h-3.5" /> 支线
          </button>
          <div className="w-px h-4 bg-border mx-1" />
          <select
            value={genType}
            onChange={e => setGenType(e.target.value as StoryArcType)}
            className="px-1 py-1 bg-bg-elevated border border-border rounded text-xs text-text-secondary"
          >
            <option value="main">生成主线</option>
            <option value="sub">生成支线</option>
          </select>
          <button
            onClick={handleGenerate}
            disabled={
              copilot.loading
              || copilot.busy
              || copilot.pendingCandidates.length > 0
              || (project.enableMultiWorld === true && worldGroupId == null)
            }
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {copilot.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            AI 生成
          </button>
          {(['expand', 'rewrite', 'polish', 'replan'] as const).map(operation => (
            <button
              key={operation}
              type="button"
              onClick={() => { void handleTransform(operation) }}
              disabled={
                activeArc?.id == null
                || copilot.loading
                || copilot.busy
                || copilot.pendingCandidates.length > 0
                || (project.enableMultiWorld === true && worldGroupId == null)
              }
              className="px-2 py-1.5 text-xs text-text-muted hover:bg-bg-hover hover:text-accent rounded disabled:opacity-40"
            >
              {operation === 'expand' ? '扩写' : operation === 'rewrite' ? '重写' : operation === 'polish' ? '润色' : '重规划'}
            </button>
          ))}
        </div>
      </div>

      {copilot.error && (
        <p className="mb-4 rounded border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {copilot.error}
        </p>
      )}

      {(activeIntentAlignment === 'stale' || activeIntentAlignment === 'source-missing') && activeArc && (
        <div className="mb-4 rounded border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
          <p>
            {activeIntentAlignment === 'stale'
              ? '过期原因：故事核心意图的冻结 hash 已在这条故事线生成后变化。'
              : '过期原因：这条故事线记录的故事核心来源已经缺失或不属于当前 Work。'}
            系统不会静默选择或覆盖任何一边；请检查 provenance 后另行生成并确认重规划候选。
          </p>
          <p className="mt-1 font-mono text-[10px] text-text-muted">
            provenance：storyCore #{activeArc.sourceStoryCoreId ?? '未记录'}
            {' · '}revision {activeArc.sourceStoryCoreRevision ?? '未记录'}
            {' · '}run #{activeArc.producerRunId ?? '未记录'}
            {' · '}candidate {activeArc.producerCandidateHash?.slice(0, 12) ?? '未记录'}
          </p>
        </div>
      )}

      {hasOtherPendingCandidates && (
        <p className="mb-4 rounded border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
          主 Agent 还有其他待确认候选，请先在右侧副驾中处理。
        </p>
      )}

      {pendingStoryArcCandidates.map(candidate => (
        <section
          key={candidate.event.id}
          className="mb-4 border border-accent/30 bg-bg-surface p-4 rounded-lg"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-text-primary">待确认 · {candidate.payload.label}</h3>
            <span className="text-[11px] text-text-muted">
              {candidate.payload.contextEvidence
                ? `约 ${candidate.payload.contextEvidence.estimatedInputTokens.toLocaleString()} tokens`
                : `${candidate.payload.contextSources.length} 个输入来源`}
            </span>
          </div>
          <div className={candidate.payload.storyArcMutationRequest?.operation === 'expand'
            || candidate.payload.storyArcMutationRequest?.operation === 'polish'
            ? 'grid gap-3 md:grid-cols-2'
            : ''}>
            {(candidate.payload.storyArcMutationRequest?.operation === 'expand'
              || candidate.payload.storyArcMutationRequest?.operation === 'polish') && (() => {
              const snapshot = candidate.payload.baseSnapshot as StoryArcCopilotSnapshot
              const original = snapshot.arcs?.find(arc => (
                arc.id === candidate.payload.storyArcMutationRequest?.targetArcId
              ))
              return (
                <label className="grid gap-1 text-[11px] text-text-muted">
                  原版（冻结）
                  <CTextarea
                    aria-label={`${candidate.payload.label}原版内容`}
                    value={original ? JSON.stringify({
                      name: original.name,
                      type: original.type,
                      description: original.description,
                      stages: parseStages(original.stages),
                    }, null, 2) : '目标原版不可用，请拒绝并重新生成。'}
                    readOnly
                    className="min-h-72 w-full resize-y font-mono text-xs leading-5"
                  />
                </label>
              )
            })()}
            <label className="grid gap-1 text-[11px] text-text-muted">
              {candidate.payload.storyArcMutationRequest?.operation === 'expand'
                || candidate.payload.storyArcMutationRequest?.operation === 'polish'
                ? '新版（可编辑）'
                : ''}
              <CTextarea
                aria-label={`${candidate.payload.label}候选内容`}
                value={candidate.event.content}
                disabled={copilot.busy}
                onChange={event => {
                  void copilot.updateCandidate(candidate.event.id!, event.target.value)
                }}
                className="min-h-72 w-full resize-y font-mono text-xs leading-5"
              />
            </label>
          </div>
          {candidate.payload.creativeArtifact && (
            <CreativeArtifactSummary
              artifact={candidate.payload.creativeArtifact}
              narrativeBrief={candidate.payload.narrativeBrief}
            />
          )}
          <HarnessEvidencePanel
            contextEvidence={candidate.payload.contextEvidence}
            lifecycle={candidate.lifecycle}
            promptExecutionEvidence={candidate.payload.promptExecutionEvidence}
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              disabled={copilot.busy}
              onClick={() => { void copilot.rejectCandidate(candidate) }}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-text-muted hover:bg-bg-hover hover:text-text-primary rounded disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              拒绝
            </button>
            <button
              type="button"
              disabled={
                copilot.busy
                || (candidate.payload.creativeArtifact != null
                  && !creativeArtifactCanAdoptV1(candidate.payload.creativeArtifact))
              }
              onClick={() => { void copilot.adoptCandidate(candidate) }}
              className="flex items-center gap-1 bg-accent px-3 py-1.5 text-xs text-white hover:opacity-90 rounded disabled:opacity-50"
            >
              {copilot.busy
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Check className="h-3.5 w-3.5" />}
              {candidate.payload.creativeArtifact?.status === 'usable-with-warnings'
                ? '接受提示并采纳'
                : '采纳'}
            </button>
          </div>
        </section>
      ))}

      {/* 故事线编辑 */}
      {activeArc ? (
        <>
          <StoryArcEditor
            key={activeArc.id}
            arc={activeArc}
            stages={activeStages}
            targeted={activeArc.id === initialArcId}
            onUpdateArc={(data, expected) => updateArc(activeArc.id!, data, loadedScope ?? undefined, expected)}
            onEditStage={edit => editStage(activeArc.id!, edit, loadedScope ?? undefined)}
            onDelete={() => handleDeleteArc(activeArc.id!)}
            onGenerateKeyEvents={generateKeyEvents}
            onSortEvents={sortKeyEvents}
            isGeneratingEvents={copilot.busy}
            isSortingEvents={copilot.busy}
          />
          <StorylineProgressPanel
            projectId={project.id!}
            arcs={arcs}
            copilot={copilot}
            onArcsChanged={reloadCurrentArcs}
            initialRecordTarget={initialRecordTarget?.table === 'storylineProgress'
              || initialRecordTarget?.table === 'storylineCrossings'
              ? initialRecordTarget
              : null}
          />
        </>
      ) : (
        <div className="text-center py-16 text-text-muted">
          <p className="text-sm mb-3">还没有故事线。</p>
          <p className="text-xs">点击上方「AI 生成」或「+ 主线/支线」创建。</p>
        </div>
      )}
      </fieldset>
    </div>
  )
}

// ── 故事线编辑器 ──

function StoryArcEditor({ arc, stages, targeted, onUpdateArc, onEditStage, onDelete, onGenerateKeyEvents, onSortEvents, isGeneratingEvents, isSortingEvents }: {
  arc: NonNullable<ReturnType<typeof useStoryArcStore.getState>['arcs'][0]>
  stages: StoryStage[]
  targeted: boolean
  onUpdateArc: (data: Partial<Pick<StoryArc, 'name' | 'description' | 'type'>>, expected?: Partial<Pick<StoryArc, 'name' | 'description' | 'type'>>) => Promise<void>
  onEditStage: (edit: StoryStageEditV1) => Promise<void>
  onDelete: () => void | Promise<void>
  onGenerateKeyEvents: (stage: StoryStage, allStages: StoryStage[], currentKeyEvents: string[]) => Promise<void>
  onSortEvents: (stage: StoryStage, allStages: StoryStage[], currentKeyEvents: string[]) => Promise<void>
  isGeneratingEvents: boolean
  isSortingEvents: boolean
}) {
  const [commandError, setCommandError] = useState('')
  const [commandBusy, setCommandBusy] = useState(false)
  const command = async (action: () => Promise<void>) => {
    if (commandBusy) return
    setCommandBusy(true); setCommandError('')
    try { await flushPendingEditsV1(); await action() }
    catch (error) { setCommandError(error instanceof Error ? error.message : '阶段操作未保存。') }
    finally { setCommandBusy(false) }
  }

  const handleAddStage = () => {
    const newStage: StoryStage = {
      id: nanoid(8),
      title: `阶段 ${stages.length + 1}`,
      description: '',
      keyEvents: [],
    }
    void command(() => onEditStage({ kind: 'add', stage: newStage }))
  }

  const handleUpdateStage = (idx: number, data: Partial<Omit<StoryStage, 'id'>>, expected?: Partial<Omit<StoryStage, 'id'>>) => {
    return onEditStage({ kind: 'patch', stageId: stages[idx].id, patch: data, expected })
  }

  const handleDeleteStage = (idx: number) => {
    void command(() => onEditStage({ kind: 'remove', stageId: stages[idx].id, expected: stages[idx] }))
  }

  return (
    <div
      {...initialRecordTargetAttributes(targeted, arc.id)}
      className={`space-y-4 rounded-xl ${targeted ? INITIAL_RECORD_TARGET_CLASS : ''}`}
    >
      {/* 故事线基本信息 */}
      <div className="bg-bg-surface border border-border rounded-xl p-4">
        <div className="flex items-center gap-3 mb-3">
          <span className={`w-3 h-3 rounded-full ${arc.type === 'main' ? 'bg-amber-400' : 'bg-blue-400'}`} />
          <AcknowledgedTextField input label="故事线名称" value={arc.name}
            onCommit={(value, expected) => onUpdateArc({ name: value }, { name: expected as string })}
            className="flex-1 text-lg font-bold bg-transparent text-text-primary border-none focus:outline-none"
          />
          <span className="text-xs px-2 py-0.5 bg-bg-elevated text-text-muted rounded">
            {arc.type === 'main' ? '主线' : '支线'}
          </span>
          <button onClick={onDelete} title="删除故事线" className="p-1 text-text-muted hover:text-error transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
        <AcknowledgedTextField label="故事线整体描述" rows={3} value={arc.description}
          onCommit={(value, expected) => onUpdateArc({ description: value }, { description: expected as string })}
          placeholder="故事线整体描述..."
          className="w-full h-16 p-2 bg-bg-base border border-border rounded text-sm text-text-secondary resize-y focus:outline-none focus:border-accent"
        />
      </div>
      {commandError && <p role="alert" className="text-xs text-error">{commandError}</p>}
      <fieldset className="contents" disabled={commandBusy}>

      {/* 时间线可视化 + 阶段列表 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-text-secondary">阶段列表（{stages.length}）</h3>
          <button
            onClick={handleAddStage}
            className="flex items-center gap-1 px-2 py-1 text-xs text-accent hover:bg-accent/10 rounded transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> 添加阶段
          </button>
        </div>

        {/* 进度条可视化 */}
        {stages.length > 0 && (
          <div className="flex gap-1 h-2 rounded-full overflow-hidden bg-bg-elevated">
            {stages.map((s, i) => (
              <div
                key={s.id}
                className="flex-1 rounded-full"
                style={{
                  backgroundColor: `hsl(${30 + i * (300 / stages.length)}, 60%, 50%)`,
                }}
                title={s.title}
              />
            ))}
          </div>
        )}

        {/* 阶段编辑卡片 */}
        {stages.map((stage, idx) => (
          <StageCard
            key={stage.id}
            stage={stage}
            index={idx}
            total={stages.length}
            onUpdate={(data, expected) => handleUpdateStage(idx, data, expected)}
            onDelete={() => handleDeleteStage(idx)}
            onGenerateKeyEvents={onGenerateKeyEvents}
            onSortEvents={onSortEvents}
            isGeneratingEvents={isGeneratingEvents}
            isSortingEvents={isSortingEvents}
            allStages={stages}
          />
        ))}

        {stages.length === 0 && (
          <div className="text-center py-8 text-text-muted text-sm border border-dashed border-border rounded-lg">
            暂无阶段，点击「添加阶段」或用 AI 生成
          </div>
        )}
      </div>
      </fieldset>
    </div>
  )
}

// ── 单个阶段卡片 ──

function StageCard({ stage, index, total, onUpdate, onDelete, onGenerateKeyEvents, onSortEvents, isGeneratingEvents, isSortingEvents, allStages }: {
  stage: StoryStage
  index: number
  total: number
  onUpdate: (data: Partial<Omit<StoryStage, 'id'>>, expected?: Partial<Omit<StoryStage, 'id'>>) => Promise<void>
  onDelete: () => void
  onGenerateKeyEvents: (stage: StoryStage, allStages: StoryStage[], currentKeyEvents: string[]) => Promise<void>
  onSortEvents: (stage: StoryStage, allStages: StoryStage[], currentKeyEvents: string[]) => Promise<void>
  isGeneratingEvents: boolean
  isSortingEvents: boolean
  allStages: StoryStage[]
}) {
  const [expanded, setExpanded] = useState(false)
  const [newEvent, setNewEvent] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSorting, setIsSorting] = useState(false)
  const [eventError, setEventError] = useState('')
  const [eventBusy, setEventBusy] = useState(false)
  const [navigationError, setNavigationError] = useState('')
  const retryEvent = useRef<(() => Promise<void>) | null>(null)
  useEffect(() => registerPendingDraftFlusherV1(() => {
    if (eventError) throw new Error(eventError)
    if (newEvent.trim()) throw new Error('请先添加或清空尚未提交的关键事件。')
  }), [eventError, newEvent])
  const eventAction = async (action: () => Promise<void>, flush = true) => {
    if (eventBusy) return
    setEventBusy(true)
    try {
      if (flush) await flushPendingEditsV1()
      await action(); setEventError(''); retryEvent.current = null
    } catch (error) {
      setEventError(error instanceof Error ? error.message : '关键事件操作未保存，输入已保留。')
      retryEvent.current = action
    } finally { setEventBusy(false) }
  }

  const addEvent = () => {
    if (!newEvent.trim()) return
    const sent = newEvent.trim()
    void eventAction(async () => {
      await onUpdate({ keyEvents: [...stage.keyEvents, sent] }, { keyEvents: stage.keyEvents })
      setNewEvent(current => current.trim() === sent ? '' : current)
    }, false)
  }

  const removeEvent = (i: number) => {
    void eventAction(() => onUpdate({ keyEvents: stage.keyEvents.filter((_, idx) => idx !== i) }, { keyEvents: stage.keyEvents }))
  }

  const handleGenerateEvents = async () => {
    setIsGenerating(true)
    try {
      await onGenerateKeyEvents(stage, allStages, stage.keyEvents)
    } catch (error) {
      console.error('[StageCard] 生成关键事件失败:', error)
    } finally {
      setIsGenerating(false)
    }
  }

  const moveEventUp = (i: number) => {
    if (i === 0) return
    const newEvents = [...stage.keyEvents]
    ;[newEvents[i - 1], newEvents[i]] = [newEvents[i], newEvents[i - 1]]
    void eventAction(() => onUpdate({ keyEvents: newEvents }, { keyEvents: stage.keyEvents }))
  }

  const moveEventDown = (i: number) => {
    if (i === stage.keyEvents.length - 1) return
    const newEvents = [...stage.keyEvents]
    ;[newEvents[i], newEvents[i + 1]] = [newEvents[i + 1], newEvents[i]]
    void eventAction(() => onUpdate({ keyEvents: newEvents }, { keyEvents: stage.keyEvents }))
  }

  const handleSortEvents = async () => {
    if (stage.keyEvents.length < 2) return
    setIsSorting(true)
    try {
      await onSortEvents(stage, allStages, stage.keyEvents)
    } catch (error) {
      console.error('[StageCard] 排序关键事件失败:', error)
    } finally {
      setIsSorting(false)
    }
  }

  const stageColor = `hsl(${30 + index * (300 / total)}, 60%, 50%)`

  return (
    <div className="bg-bg-surface border border-border rounded-xl overflow-hidden">
      {/* 头部 */}
      <button
        onClick={() => {
          void flushPendingEditsV1().then(() => { setExpanded(!expanded); setNavigationError('') })
            .catch(error => setNavigationError(error instanceof Error ? error.message : '输入尚未保存，已保留当前阶段。'))
        }}
        className="w-full flex items-center gap-3 p-3 hover:bg-bg-hover transition-colors"
      >
        <div className="flex items-center gap-2 shrink-0">
          <GripVertical className="w-3.5 h-3.5 text-text-muted/40" />
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
            style={{ backgroundColor: stageColor }}>
            {index + 1}
          </div>
        </div>
        <div className="flex-1 text-left min-w-0">
          <p className="text-sm font-medium text-text-primary truncate">{stage.title}</p>
          {!expanded && stage.description && (
            <p className="text-xs text-text-muted truncate">{stage.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {stage.turningPoint && (
            <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/15 text-amber-400 rounded">转折</span>
          )}
          {stage.keyEvents.length > 0 && (
            <span className="text-[10px] text-text-muted">{stage.keyEvents.length} 事件</span>
          )}
          {expanded ? <ChevronDown className="w-4 h-4 text-text-muted" /> : <ChevronRight className="w-4 h-4 text-text-muted" />}
        </div>
      </button>
      {navigationError && <p role="alert" className="px-3 text-xs text-error">{navigationError}</p>}

      {/* 展开编辑 */}
      {expanded && (
        <div className="p-3 pt-0 space-y-3 border-t border-border">
          {/* 标题 */}
          <AcknowledgedTextField input label="故事阶段标题"
            value={stage.title}
            onCommit={(value, expected) => onUpdate({ title: value }, { title: expected as string })}
            placeholder="阶段标题"
            className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm font-medium text-text-primary focus:outline-none focus:border-accent"
          />

          {/* 描述 */}
          <AcknowledgedTextField label="故事阶段描述" rows={4}
            value={stage.description}
            onCommit={(value, expected) => onUpdate({ description: value }, { description: expected as string })}
            placeholder="这个阶段发生什么..."
            className="w-full h-20 p-2 bg-bg-base border border-border rounded text-sm text-text-secondary resize-y focus:outline-none focus:border-accent"
          />

          {/* 转折点 */}
          <div>
            <label className="text-xs text-text-muted mb-1 block">转折点（可选）</label>
            <AcknowledgedTextField input label="故事阶段转折点"
              value={stage.turningPoint}
              onCommit={(value, expected) => onUpdate({ turningPoint: value || undefined }, { turningPoint: expected as string | undefined })}
              placeholder="这个阶段的关键转折..."
              className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-xs text-text-secondary focus:outline-none focus:border-accent"
            />
          </div>

          {/* 关键事件 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-text-muted block">关键事件（{stage.keyEvents.length}）</label>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleSortEvents}
                  disabled={isSorting || isSortingEvents || stage.keyEvents.length < 2}
                  className="flex items-center gap-1 px-2 py-0.5 text-xs text-accent bg-accent/10 hover:bg-accent/20 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title={stage.keyEvents.length < 2 ? '至少需要2个事件才能排序' : 'AI智能排序'}
                >
                  {isSorting || isSortingEvents ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <ArrowUpDown className="w-3 h-3" />
                  )}
                  {isSorting || isSortingEvents ? '排序中...' : 'AI排序'}
                </button>
                <button
                  onClick={handleGenerateEvents}
                  disabled={isGenerating || isGeneratingEvents || !stage.description?.trim()}
                  className="flex items-center gap-1 px-2 py-0.5 text-xs text-accent bg-accent/10 hover:bg-accent/20 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title={!stage.description?.trim() ? '请先填写阶段描述' : 'AI生成关键事件'}
                >
                  {isGenerating || isGeneratingEvents ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                  {isGenerating || isGeneratingEvents ? '生成中...' : 'AI生成'}
                </button>
              </div>
            </div>
            {!stage.description?.trim() && (
              <p className="text-[10px] text-warning mb-1">提示：AI生成需要先填写阶段描述</p>
            )}
            <div className="space-y-1">
              {stage.keyEvents.map((ev, i) => (
                <div key={i} className="flex items-center gap-1.5 group">
                  <span className="text-[10px] text-text-muted w-4 text-center">{i + 1}</span>
                  <span className="text-xs text-text-secondary flex-1">{ev}</span>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => moveEventUp(i)}
                      disabled={i === 0}
                      className="p-0.5 text-text-muted hover:text-accent disabled:opacity-30 disabled:hover:text-text-muted"
                      title="上移"
                    >
                      <ChevronUp className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => moveEventDown(i)}
                      disabled={i === stage.keyEvents.length - 1}
                      className="p-0.5 text-text-muted hover:text-accent disabled:opacity-30 disabled:hover:text-text-muted"
                      title="下移"
                    >
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => removeEvent(i)}
                      className="p-0.5 text-text-muted hover:text-error"
                      title="删除"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
              <div className="flex gap-1.5">
                <CInput
                  value={newEvent}
                  onChange={e => setNewEvent(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addEvent() } }}
                  placeholder="手动添加关键事件..."
                  className="flex-1 px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
                />
                <button onClick={addEvent} disabled={eventBusy || !newEvent.trim()}
                  className="px-2 py-1 text-xs text-accent hover:bg-accent/10 rounded disabled:opacity-40">
                  添加
                </button>
              </div>
            </div>
            {eventError && <div role="alert" className="space-x-2 text-xs text-error">{eventError}<button disabled={eventBusy} onClick={() => { if (retryEvent.current) void eventAction(retryEvent.current, false) }}>重试操作</button><button onClick={() => { setEventError(''); retryEvent.current = null }}>放弃本次操作</button></div>}
          </div>

          {/* 删除按钮 */}
          <div className="flex justify-end pt-1">
            <button onClick={onDelete} className="flex items-center gap-1 px-2 py-1 text-xs text-error/60 hover:text-error transition-colors">
              <Trash2 className="w-3 h-3" /> 删除此阶段
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
