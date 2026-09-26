import { buildPostAdoptionAuthorizationSnapshotV1, invalidateChapterPostAdoptionDerivativesV1, preflightPostAdoptionAutoV1, readWorkPostAdoptionSettingsV1 } from './post-adoption-policy'
import { db } from '../db/schema'
import type { Project, AIConfig, Character, CharacterRelation, Foreshadow, StoryArc, ItemLedgerEntry } from '../types'
import { assertRecordInScope, readOwnedRows, resolveScopeLike } from '../workspace/scope'
import { useAIConfigStore } from '../../stores/ai-config'
import { assembleContext } from '../registry/assemble-context'
import { resolveRequestConfig } from '../ai/client'
import { executeRegisteredAIEntryV1 } from '../agent/formal-ai-entry'
import { runChapterMemoryTask } from '../ai/chapter-memory/run-chapter-memory'
import { hashChapterText } from '../ai/chapter-memory/text-normalization'
import { runChapterOrganization, persistChapterOrganizationCandidate, type ChapterOrganizationRun } from '../agent/chapter-organization'
import { hashChapterOrganizationCandidateV1 } from '../agent/run/chapter-organization-durable'
import { runBackgroundConsistencyAgent, persistConsistencyAgentCandidate, hashConsistencyAgentCandidateV1 } from '../agent/consistency-agent'
import { AgentTeamBudgetTracker } from '../agent/team-budget'
import { createContextManifestFromAssemblyV1 } from '../agent/run/context-manifest'
import { readAgentRunV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { classifyAgentRunFailureV1 } from '../agent/run/failure-policy'
import { buildChapterPostAdoptionResumePlanV1, isChapterPostAdoptionStepRunnableV1 } from '../agent/run/chapter-post-adoption-resume'
import { nextChapterPostAdoptionAttemptV1, beginChapterPostAdoptionStepV1, createChapterPostAdoptionDurableRunV1, failChapterPostAdoptionStepV1, recordChapterPostAdoptionOutputV1, scheduleChapterPostAdoptionStepsV1, succeedChapterPostAdoptionStepV1, verifyChapterPostAdoptionRunV1, CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1, CHAPTER_POST_ADOPTION_STEP_IDS_V1, type ChapterPostAdoptionStepIdV1 } from '../agent/run/chapter-post-adoption-durable'
import { rebuildChapterChunks, ensureChunkEmbeddings, rebuildProjectNarrativeSummaries } from '../retrieval/retrieval'
import { isEmbeddingReady } from '../ai/adapters/embedding-adapter'

export interface ChapterPostAdoptionTaskV1 {
  chapterId: number
  chapterTitle: string
  chapterContent: string
  chapterPlainText: string
  parent?: { runId: number; receiptHash: string; artifactHash: string }
  resumeRunId?: number
}
export interface ChapterPostAdoptionCallbacksV1 {
  onSnapshot?: (snapshot: AgentRunSnapshotV1) => void
  onOrganization?: (run: ChapterOrganizationRun) => void
  onOrganizationPending?: () => void
  onConsistency?: (run: Awaited<ReturnType<typeof persistConsistencyAgentCandidate>>) => void
  onMemoryWritten?: (chapterId: number) => void
  onPhase?: (phase: 'extracting' | 'idle' | 'memory') => void
  onError?: (error: string) => void
}
/** Shared execution chain. Both editor and master Agent keep the same durable evidence and author gates. */
export async function runChapterPostAdoptionV1(input: {
  project: Project
  aiConfig: AIConfig
  task: ChapterPostAdoptionTaskV1
  extraStateIds?: number[]
  signal?: AbortSignal
  callbacks?: ChapterPostAdoptionCallbacksV1
}): Promise<void> {
  const { project, aiConfig, task, signal, extraStateIds = [], callbacks = {} } = input
    const scope = await resolveScopeLike(project.id!)
    const transitionChapter = await db.chapters.get(task.chapterId)
    if (!await assertRecordInScope(scope, 'chapters', transitionChapter, { owner: 'work' })) throw new Error('章后处理目标不属于当前作品。')
    const [characters, itemEntries, foreshadows, storyArcs] = await Promise.all([
      readOwnedRows<Character>(scope, 'characters', { owner: 'world' }),
      readOwnedRows<ItemLedgerEntry>(scope, 'itemLedger', { owner: 'work' }),
      readOwnedRows<Foreshadow>(scope, 'foreshadows', { owner: 'work' }),
      readOwnedRows<StoryArc>(scope, 'storyArcs', { owner: 'work' }),
    ])
    const transitionOutline = transitionChapter?.outlineNodeId != null
      ? await db.outlineNodes.get(transitionChapter.outlineNodeId)
      : null
    const transitionWorldGroupId = transitionOutline?.worldGroupId ?? null
    const expectedSourceTextHash = await hashChapterText(task.chapterContent)
    const organizationRequestConfig = resolveRequestConfig(aiConfig, { category: 'chapter.organize' }).config
    const memoryRequestConfig = resolveRequestConfig(aiConfig, { category: 'chapter.memory' }).config
    let snapshot = task.resumeRunId != null
      ? await readAgentRunV1(scope, task.resumeRunId)
      : await createChapterPostAdoptionDurableRunV1({
          scope,
          worldGroupId: transitionWorldGroupId,
          chapterId: task.chapterId,
          parent: task.parent,
        })
    if (snapshot.contract.scope.chapterIds?.length !== 1 || snapshot.contract.scope.chapterIds[0] !== task.chapterId) {
      throw new Error('章节后处理恢复运行与当前章节不匹配。')
    }
    if (task.resumeRunId != null) {
      const resumePlan = buildChapterPostAdoptionResumePlanV1(snapshot)
      if (resumePlan.terminal) return
      if (!resumePlan.canResume) {
        throw new Error(`章节后处理当前不可自动恢复：${resumePlan.blockedReason ?? '需要检查运行证据'}`)
      }
    }
    callbacks.onSnapshot?.(snapshot)
    snapshot = await scheduleChapterPostAdoptionStepsV1({ scope, snapshot })

    const assembledFor = async (
      sourceKeys: readonly string[],
      requestConfig = aiConfig,
    ) => assembleContext({
      projectId: project.id!,
      scope,
      worldGroupId: transitionWorldGroupId,
      chapterId: task.chapterId,
      outlineNodeId: transitionChapter?.outlineNodeId ?? null,
      provider: requestConfig.provider,
      model: requestConfig.model,
      sourceKeys: [...sourceKeys],
      stateReferenceText: task.chapterPlainText,
      extraStateIds,
      inputBudgetMaxTokens: 24_000,
    })
    const manifestFor = async (
      stepId: ChapterPostAdoptionStepIdV1,
      sourceKeys: readonly string[],
      assembled: Awaited<ReturnType<typeof assembleContext>>,
    ) => createContextManifestFromAssemblyV1({
      runId: snapshot.run.id,
      stepId,
      attempt: nextChapterPostAdoptionAttemptV1(snapshot, stepId),
      projectId: project.id!,
      worldGroupId: transitionWorldGroupId,
      declaredSourceKeys: sourceKeys,
      assembled,
      boundary: { chapterId: task.chapterId, outlineNodeId: transitionChapter?.outlineNodeId ?? undefined },
      readerVersion: 'chapter-post-adoption-context-v1',
    })
    const ensureFresh = async () => {
      const latest = await db.chapters.get(task.chapterId)
      if (signal?.aborted) throw new DOMException('已取消章后处理', 'AbortError')
      if (!latest || await hashChapterText(latest.content ?? '') !== expectedSourceTextHash) {
        throw new Error('正文已变化，章节后处理候选已过期。')
      }
    }
    const updateSnapshot = (next: AgentRunSnapshotV1) => {
      snapshot = next
      callbacks.onSnapshot?.(next)
    }
    const shouldRunStep = (stepId: ChapterPostAdoptionStepIdV1): boolean => {
      return isChapterPostAdoptionStepRunnableV1(
        buildChapterPostAdoptionResumePlanV1(snapshot),
        stepId,
      )
    }
    // 1. 一次综合抽取七域候选；作者确认前业务表零写入。
    if (!shouldRunStep(CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization)) {
      if (snapshot.projection.steps[CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization]?.status === 'awaiting_confirmation') {
        callbacks.onOrganizationPending?.()
      }
    } else {
    callbacks.onPhase?.('extracting')
    try {
      await ensureFresh()
      const organizationAssembly = await assembledFor(
        CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.organization,
        organizationRequestConfig,
      )
      const organizationManifest = await manifestFor(
        CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization,
        CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.organization,
        organizationAssembly,
      )
      updateSnapshot(await beginChapterPostAdoptionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization,
        contextManifest: organizationManifest,
        binding: { chapterId: task.chapterId, sourceTextHash: expectedSourceTextHash },
        modelIdentity: {
          provider: organizationRequestConfig.provider,
          model: organizationRequestConfig.model,
        },
      }))
      const allRelations = await readOwnedRows<CharacterRelation>(scope, 'characterRelations', { owner: 'world' })
      const scopedCharacters = project.enableMultiWorld
        ? characters.filter(character => (
          character.isCrossWorld
          || (character.homeWorldGroupId ?? null) === (transitionWorldGroupId ?? null)
        ))
        : characters
      const scopedCharacterIds = new Set(
        scopedCharacters.flatMap(character => character.id != null ? [character.id] : []),
      )
      const existingRelations = allRelations.filter(relation => (
        scopedCharacterIds.has(relation.fromCharacterId)
        && scopedCharacterIds.has(relation.toCharacterId)
      ))
      const organizationContextSnapshot = organizationAssembly.included.flatMap((sourceKey, index) => (
        sourceKey === 'chapterContent' ? [] : [organizationAssembly.segments[index]?.content ?? '']
      )).filter(Boolean).join('\n\n')
      const budget = new AgentTeamBudgetTracker(useAIConfigStore.getState().agentTeamBudgetProfile)
      const candidate = await runChapterOrganization({
        projectId: project.id!,
        chapterId: task.chapterId,
        chapterTitle: task.chapterTitle,
        worldGroupId: transitionWorldGroupId,
        chapterContent: task.chapterContent,
        stateContext: organizationAssembly.segments.filter((_segment, index) => organizationAssembly.included[index] === 'stateCards').map(segment => segment.content).join('\n'),
        characters: scopedCharacters,
        knownItemNames: itemEntries.map(entry => entry.itemName),
        existingRelations,
        foreshadows: foreshadows,
        storyArcs,
        contextSnapshot: organizationContextSnapshot,
        budget,
        call: messages => executeRegisteredAIEntryV1('prose.chapter.organize', messages, aiConfig, {
          category: 'chapter.organize',
          projectId: project.id!,
          configOverrides: { maxTokens: 8_000 },
          contextOverflowPolicy: 'reject',
        }, signal),
      })
      await ensureFresh()
      const candidateHash = await hashChapterOrganizationCandidateV1(candidate)
      const run = await persistChapterOrganizationCandidate(candidate, {
        durable: {
          runId: snapshot.run.id,
          stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization,
          attempt: snapshot.projection.steps[CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization].attempt,
          contextManifestHash: organizationManifest.manifestHash,
          candidateHash,
        },
      })
      updateSnapshot(await recordChapterPostAdoptionOutputV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization,
        output: run.candidate,
        candidateHash,
        requiresConfirmation: true,
      }))
      callbacks.onOrganization?.(run)
      callbacks.onOrganizationPending?.()
    } catch (error) {
      try {
        updateSnapshot(await readAgentRunV1(scope, snapshot.run.id))
      } catch {
        // Keep the original processing error when a refresh window prevents a re-read.
      }
      const failure = await classifyAgentRunFailureV1(error)
      updateSnapshot(await failChapterPostAdoptionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization,
        ...failure,
      }))
      if (!signal?.aborted) {
        callbacks.onError?.(error instanceof Error ? error.message : '七域交接候选生成失败')
      }
      if (signal?.aborted) return
    } finally {
      callbacks.onPhase?.('idle')
    }
    }

    // 2. summary + handoff 仍只调用一次模型，并由原子 CAS 写回 chapters。
    if (shouldRunStep(CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory)) try {
      callbacks.onPhase?.('memory')
      await ensureFresh()
      const memoryAssembly = await assembledFor(
        CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.memory,
        memoryRequestConfig,
      )
      updateSnapshot(await beginChapterPostAdoptionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory,
        contextManifest: await manifestFor(
          CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory,
          CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.memory,
          memoryAssembly,
        ),
        binding: { chapterId: task.chapterId, sourceTextHash: expectedSourceTextHash },
        modelIdentity: {
          provider: memoryRequestConfig.provider,
          model: memoryRequestConfig.model,
        },
      }))
      const memoryResult = await runChapterMemoryTask({
        signal,
        projectId: project.id!,
        call: messages => executeRegisteredAIEntryV1('prose.chapter.memory', messages, aiConfig, { category: 'chapter.memory', projectId: project.id!, configOverrides: { maxTokens: 8_000 }, contextOverflowPolicy: 'reject' }, signal),
        chapterId: task.chapterId,
        chapterTitle: task.chapterTitle,
        chapterContent: task.chapterContent,
      })
      const result = memoryResult.status
      if (result === 'written') callbacks.onMemoryWritten?.(task.chapterId)
      if (result !== 'written') throw new Error(`章节记忆后处理未写入：${result}`)
      updateSnapshot(await recordChapterPostAdoptionOutputV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory,
        output: { status: result, sourceTextHash: expectedSourceTextHash },
      }))
      updateSnapshot(await succeedChapterPostAdoptionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory,
        output: { status: result, sourceTextHash: expectedSourceTextHash },
      }))
    } catch (error) {
      const failure = await classifyAgentRunFailureV1(error)
      updateSnapshot(await failChapterPostAdoptionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory,
        ...failure,
      }))
      callbacks.onError?.(error instanceof Error ? error.message : '章节记忆后处理失败')
    } finally {
      callbacks.onPhase?.('idle')
    }

    // 3. 记忆写回后再重建检索与层级摘要，避免把刚生成的可信摘要留在 pending 状态。
    if (shouldRunStep(CHAPTER_POST_ADOPTION_STEP_IDS_V1.retrieval)) try {
      await ensureFresh()
      const retrievalAssembly = await assembledFor(CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.retrieval)
      updateSnapshot(await beginChapterPostAdoptionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.retrieval,
        contextManifest: await manifestFor(
          CHAPTER_POST_ADOPTION_STEP_IDS_V1.retrieval,
          CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.retrieval,
          retrievalAssembly,
        ),
        model: false,
      }))
      const chapter = await db.chapters.get(task.chapterId)
      if (!chapter) throw new Error('章节在后处理期间不可见。')
      const chunks = await rebuildChapterChunks({
        projectId: project.id!,
        chapter: { ...chapter, content: task.chapterContent },
        worldGroupId: transitionWorldGroupId,
        knownEntities: characters.map(c => c.name),
        scope,
      })
      const summaries = await rebuildProjectNarrativeSummaries({ projectId: project.id!, scope })
      const embCfg = useAIConfigStore.getState().embedding
      if (isEmbeddingReady(embCfg)) {
        void ensureChunkEmbeddings({ projectId: project.id!, cfg: embCfg, scope })
          .catch(e => console.warn('[ChapterPostAdoption] 语义索引补建失败（关键词检索仍可用）:', e))
      }
      updateSnapshot(await succeedChapterPostAdoptionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.retrieval,
        output: { chunks, summaries, sourceTextHash: expectedSourceTextHash },
      }))
    } catch (error) {
      const failure = await classifyAgentRunFailureV1(error)
      updateSnapshot(await failChapterPostAdoptionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.retrieval,
        ...failure,
      }))
      callbacks.onError?.(error instanceof Error ? error.message : '检索后处理失败')
    }

    // 4. 零 token 确定性一致性守卫。报告进入同一 durable Run；语义深审仍由作者显式触发。
    if (shouldRunStep(CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency)) try {
      await ensureFresh()
      const consistencyAssembly = await assembledFor(CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.consistency)
      const consistencyManifest = await manifestFor(
        CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency,
        CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.consistency,
        consistencyAssembly,
      )
      updateSnapshot(await beginChapterPostAdoptionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency,
        contextManifest: consistencyManifest,
        model: false,
      }))
      const guard = await runBackgroundConsistencyAgent({
        projectId: project.id!,
        chapterId: task.chapterId,
        chapterTitle: task.chapterTitle,
        worldGroupId: transitionWorldGroupId,
        chapterContent: task.chapterContent,
        budget: new AgentTeamBudgetTracker(useAIConfigStore.getState().agentTeamBudgetProfile),
        contextEvidence: {
          included: consistencyAssembly.included,
          omitted: consistencyAssembly.omitted,
          trimmed: consistencyAssembly.trimmed,
          inputTokens: consistencyAssembly.totalInputTokens,
          inputBudget: consistencyAssembly.inputBudget,
        },
      })
      await ensureFresh()
      const candidateHash = await hashConsistencyAgentCandidateV1(guard)
      const durableGuard = {
        ...guard,
        durable: {
          runId: snapshot.run.id,
          stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency,
          attempt: snapshot.projection.steps[CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency].attempt,
          contextManifestHash: consistencyManifest.manifestHash,
          candidateHash,
        },
      }
      const run = await persistConsistencyAgentCandidate(durableGuard)
      updateSnapshot(await recordChapterPostAdoptionOutputV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency,
        output: durableGuard,
        candidateHash,
        requiresConfirmation: false,
        modelResponded: false,
      }))
      updateSnapshot(await succeedChapterPostAdoptionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency,
        output: durableGuard,
      }))
      callbacks.onConsistency?.(run)
    } catch (error) {
      const failure = await classifyAgentRunFailureV1(error)
      updateSnapshot(await failChapterPostAdoptionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency,
        ...failure,
      }))
      callbacks.onError?.(error instanceof Error ? error.message : '正文一致性守卫失败')
    }

    const selectedStepIds = (snapshot.contract.automationAuthorization?.taskTypes
      ?? ['organization', 'memory', 'retrieval', 'consistency']).map(taskType => (
      taskType === 'organization' ? CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization
        : taskType === 'memory' ? CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory
          : taskType === 'retrieval' ? CHAPTER_POST_ADOPTION_STEP_IDS_V1.retrieval
            : CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency
    ))
    if (selectedStepIds.every(stepId => snapshot.projection.steps[stepId]?.status === 'succeeded')) {
      try {
        const verified = await verifyChapterPostAdoptionRunV1({ scope, runId: snapshot.run.id })
        updateSnapshot(verified.snapshot)
      } catch (error) {
        callbacks.onError?.(error instanceof Error ? error.message : '章后终态验证失败')
      }
    }
}

/** Prepare the existing Work policy before any post-adoption model call. */
export async function prepareChapterPostAdoptionV1(input: {
  project: Project; aiConfig: AIConfig; task: ChapterPostAdoptionTaskV1
}) {
  const { project, aiConfig, task } = input
  const scope = await resolveScopeLike(project.id!)
  const invalidation = await invalidateChapterPostAdoptionDerivativesV1({ scope, chapterId: task.chapterId })
  const settings = await readWorkPostAdoptionSettingsV1(scope)
  if (settings.policy === 'off') return { settings, invalidation, snapshot: null, reason: '当前作品已关闭章后 AI 任务。' }
  const organization = resolveRequestConfig(aiConfig, { category: 'chapter.organize' }).config
  const memory = resolveRequestConfig(aiConfig, { category: 'chapter.memory' }).config
  const authorization = await buildPostAdoptionAuthorizationSnapshotV1({
    scope, chapterId: task.chapterId, sourceTextHash: await hashChapterText(task.chapterContent), settings,
    modelRoutes: [
      { taskType: 'organization', provider: organization.provider, model: organization.model },
      { taskType: 'memory', provider: memory.provider, model: memory.model },
    ],
  })
  const preflight = preflightPostAdoptionAutoV1(authorization)
  if (settings.policy === 'auto-with-budget' && !preflight.allowed) return { settings, invalidation, snapshot: null, reason: preflight.reason }
  const chapter = await db.chapters.get(task.chapterId)
  const outline = chapter?.outlineNodeId == null ? null : await db.outlineNodes.get(chapter.outlineNodeId)
  const snapshot = await createChapterPostAdoptionDurableRunV1({ scope, worldGroupId: outline?.worldGroupId ?? null, chapterId: task.chapterId, parent: task.parent, authorization })
  return { settings, invalidation, snapshot, reason: null }
}
