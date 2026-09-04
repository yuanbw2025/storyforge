import { useCallback, useEffect, useState } from 'react'
import { useAIStream } from '../../hooks/useAIStream'
import { useAIConfigStore } from '../../stores/ai-config'
import { createAISessionKey } from '../../stores/ai-generation-session'
import { adopt } from '../../lib/registry/adopt'
import { db } from '../../lib/db/schema'
import { resolveScopeLike } from '../../lib/workspace/scope'
import { hashCanonicalValue } from '../../lib/agent/run/hash'
import {
  buildDetailSceneGeneratePrompt,
  buildEnhancedDetailPrompt,
} from '../../lib/ai/adapters/detail-scene-adapter'
import {
  buildAgentSkillInputGuidanceV1,
  getAgentSkillV1,
} from '../../lib/agent/skill-registry'
import { projectContextGatewayInputStateV1 } from '../../lib/agent/context-gateway-input'
import {
  buildDetailedOutlineCopilotPatchV1,
  buildDetailedOutlineSceneMergeGuidanceV1,
  createDetailedOutlineCreativeArtifactV1,
  detailedOutlinePostStateMatchesPatchV1,
  revalidateDetailedOutlineCreativeDraftV1,
} from '../../lib/agent/detailed-outline-copilot'
import { updateAgentEventCandidate } from '../../lib/agent/conversations'
import { creativeArtifactCanAdoptV1 } from '../../lib/agent/creative-reliability'
import {
  buildNarrativeBriefV1,
  formatNarrativeBriefForPromptV1,
} from '../../lib/agent/narrative-brief'
import { resolveRequestConfig } from '../../lib/ai/client'
import {
  beginDetailedOutlineGenerationGatewayStepV1,
  commitDetailedOutlineGenerationAdoptionV1,
  createDetailedOutlineGenerationDurableRunV1,
  finalizeDetailedOutlineGenerationGatewayStepV1,
  failDetailedOutlineGenerationStepV1,
  hashDetailedOutlineSourceSummaryV1,
  persistDetailedOutlineGenerationCandidateV1,
  readLatestDetailedOutlineGenerationCandidateV1,
  recordDetailedOutlineGenerationCandidateV1,
  rejectDetailedOutlineGenerationCandidateV1,
  DETAILED_OUTLINE_GENERATION_CANDIDATE_TYPE_V1,
  DETAILED_OUTLINE_GENERATION_STEP_ID_V1,
  type DetailedOutlineGenerationCandidateV1,
  type DetailedOutlineGenerationOperationV1,
} from '../../lib/agent/run/detailed-outline-generation-durable'
import type { DetailedOutline, WorkspaceScope } from '../../lib/types'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import {
  assertWorkspaceContentRevisionFreshV1,
  captureWorkspaceContentRevisionV1,
} from '../../lib/authoring/content-revision'
import { prepareDetailedOutlineGatewayAssemblyV1 } from '../../lib/outline/detail-gateway-context'
import { assertDetailedOutlineTargetsUnwrittenFutureV1 } from '../../lib/outline/future-boundary'

interface PendingDetailedOutlineCandidate {
  candidate: DetailedOutlineGenerationCandidateV1
  eventId: number
}

interface UseDetailedOutlineGenerationControllerInput {
  projectId: number
  outlineNodeId: number | null
  worldGroupId: number | null
  chapterTitle: string
  chapterSummary: string
  currentDetailed?: DetailedOutline
  validCharacterIds: ReadonlySet<number>
  validForeshadowIds: ReadonlySet<number>
  reloadDetailed: () => Promise<void>
  suspendRecovery?: boolean
}

export function useDetailedOutlineGenerationController(
  input: UseDetailedOutlineGenerationControllerInput,
) {
  const {
    projectId,
    outlineNodeId: selectedOutlineNodeId,
    worldGroupId,
    chapterTitle,
    chapterSummary,
    currentDetailed,
    validCharacterIds,
    validForeshadowIds,
    reloadDetailed,
    suspendRecovery,
  } = input
  const aiConfig = useAIConfigStore(state => state.config)
  const creativeQualityMode = useAIConfigStore(state => state.creativeQualityMode)
  const ai = useAIStream(createAISessionKey(
    projectId,
    'detail.scene',
    selectedOutlineNodeId ?? 'unselected',
  ))
  const enhanceAI = useAIStream(createAISessionKey(
    projectId,
    'detail.enhance',
    selectedOutlineNodeId ?? 'unselected',
  ))
  const restoreDetail = ai.restore
  const restoreEnhanced = enhanceAI.restore
  const [pendingCandidate, setPendingCandidate] = useState<PendingDetailedOutlineCandidate | null>(null)
  const recoveryTargetKey = !suspendRecovery && selectedOutlineNodeId != null
    ? `${projectId}:${selectedOutlineNodeId}`
    : null
  const [recoveredTargetKey, setRecoveredTargetKey] = useState<string | null>(null)
  const isRecovering = recoveryTargetKey != null && recoveredTargetKey !== recoveryTargetKey

  useEffect(() => {
    let active = true
    if (!recoveryTargetKey || selectedOutlineNodeId == null) {
      setPendingCandidate(null)
      return () => { active = false }
    }
    void (async () => {
      try {
        const scope = await resolveScopeLike(projectId)
        const restored = await readLatestDetailedOutlineGenerationCandidateV1({
          scope,
          outlineNodeId: selectedOutlineNodeId,
        })
        if (!active) return
        if (!restored) {
          setPendingCandidate(null)
          return
        }
        setPendingCandidate({ candidate: restored.candidate, eventId: restored.event.id! })
        const restore = restored.candidate.operation === 'scenes' ? restoreDetail : restoreEnhanced
        restore({
          output: restored.candidate.output,
          operation: `durable:${restored.candidate.operation}:${restored.candidate.durable.runId}`,
        })
      } catch (error) {
        console.error('[DetailedOutline] durable candidate recovery failed', error)
      } finally {
        if (active) setRecoveredTargetKey(recoveryTargetKey)
      }
    })()
    return () => { active = false }
  }, [
    selectedOutlineNodeId,
    projectId,
    recoveryTargetKey,
    restoreDetail,
    restoreEnhanced,
  ])

  const adoptDetailedPatch = useCallback(async (
    outlineNodeId: number,
    patch: Partial<DetailedOutline>,
    scope?: WorkspaceScope,
  ) => {
    const result = await adopt({
      projectId,
      scope,
      target: 'detailedOutlines',
      mode: 'add',
      data: { outlineNodeId, ...patch },
    })
    await reloadDetailed()
    return result
  }, [projectId, reloadDetailed])

  const buildDetailContext = useCallback(async (
    outlineNodeId: number,
    scope?: WorkspaceScope,
    contextWorldGroupId: number | null = worldGroupId,
    operation: DetailedOutlineGenerationOperationV1 = 'enhanced',
  ) => {
    const assembled = await prepareDetailedOutlineGatewayAssemblyV1({
      projectId,
      scope,
      worldGroupId: contextWorldGroupId,
      outlineNodeId,
      operation,
      authorRequest: operation === 'scenes'
        ? `把《${chapterTitle}》拆成可执行场景。`
        : `完善《${chapterTitle}》的场景、冲突、情绪变化和结尾压力。`,
      config: aiConfig,
    })
    return {
      worldContext: assembled.text,
      characterContext: '',
      foreshadowContext: '',
      assembled,
    }
  }, [aiConfig, chapterTitle, projectId, worldGroupId])

  const run = useCallback(async (operation: DetailedOutlineGenerationOperationV1) => {
    const outlineNodeId = selectedOutlineNodeId
    if (outlineNodeId == null || isRecovering || pendingCandidate) return
    await flushPendingEditsV1()
    const scope = await resolveScopeLike(projectId)
    const contentRevision = await captureWorkspaceContentRevisionV1({ scope, worldGroupId })
    const context = await buildDetailContext(outlineNodeId, scope, worldGroupId, operation)
    await assertWorkspaceContentRevisionFreshV1(contentRevision, { scope, worldGroupId })
    const skill = getAgentSkillV1('outline.details', 'outline')
    const inputState = projectContextGatewayInputStateV1(
      skill,
      context.assembled.contextGatewayExecution,
      context.assembled,
    )
    const guidance = [
      buildAgentSkillInputGuidanceV1(skill, inputState),
      buildDetailedOutlineSceneMergeGuidanceV1(currentDetailed?.scenes ?? []),
    ].filter(Boolean).join('\n\n')
    const baseMessages = operation === 'scenes'
      ? buildDetailSceneGeneratePrompt(
          chapterTitle,
          chapterSummary,
          context.worldContext,
          context.characterContext,
          '',
          guidance,
        )
      : buildEnhancedDetailPrompt(
          chapterTitle,
          chapterSummary,
          '',
          '',
          context.worldContext,
          context.characterContext,
          context.foreshadowContext,
          guidance,
        )
    const narrativeBrief = buildNarrativeBriefV1({
      authorRequest: operation === 'scenes'
        ? `把《${chapterTitle}》拆成可执行场景，必须推动章节状态发生变化。`
        : `完善《${chapterTitle}》的场景、冲突、情绪变化和结尾压力。`,
      assembled: context.assembled,
    })
    const messages = [{
      role: 'system' as const,
      content: formatNarrativeBriefForPromptV1(narrativeBrief),
    }, ...baseMessages]
    let snapshot = await createDetailedOutlineGenerationDurableRunV1({
      scope,
      worldGroupId,
      outlineNodeId,
      operation,
    })
    const begun = await beginDetailedOutlineGenerationGatewayStepV1({
      scope,
      snapshot,
      worldGroupId,
      outlineNodeId,
      assembled: context.assembled,
      messages,
      binding: {
        operation,
        sourceSummaryHash: await hashDetailedOutlineSourceSummaryV1(chapterSummary),
        promptHash: await hashCanonicalValue(messages),
      },
    })
    snapshot = begun.snapshot
    const target = operation === 'scenes' ? ai : enhanceAI
    let output = ''
    const startedAt = Date.now()
    try {
      output = operation === 'scenes'
        ? await target.start(messages, undefined, {
          formalEntryId: 'outline.detail.scene', category: 'detail.scene', projectId,
        })
        : await target.start(messages, undefined, {
          formalEntryId: 'outline.detail.enhance', category: 'detail.enhance', projectId,
        })
      if (!output.trim()) throw new Error('模型没有返回可用的细纲内容。')
    } catch (error) {
      await failDetailedOutlineGenerationStepV1({
        scope,
        snapshot,
        code: output.trim() ? 'invalid_output_contract' : 'empty_or_cancelled_output',
        retryable: true,
      })
      throw error
    }
    const finalized = await finalizeDetailedOutlineGenerationGatewayStepV1({
      scope,
      snapshot,
      attempt: begun.attempt,
      output,
    })
    snapshot = finalized.snapshot
    const manifest = finalized.manifest
    const category = operation === 'scenes' ? 'detail.scene' : 'detail.enhance'
    const modelIdentity = resolveRequestConfig(aiConfig, { category }).config
    const creativeArtifact = await createDetailedOutlineCreativeArtifactV1({
      raw: output,
      operation,
      narrativeBrief,
      qualityMode: creativeQualityMode,
      modelIdentity: { provider: modelIdentity.provider, model: modelIdentity.model },
      inputText: messages.map(message => message.content).join('\n'),
      durationMs: Math.max(0, Date.now() - startedAt),
    })
    const baseCandidate: Omit<DetailedOutlineGenerationCandidateV1, 'durable'> = {
      version: 1,
      type: DETAILED_OUTLINE_GENERATION_CANDIDATE_TYPE_V1,
      projectId,
      outlineNodeId,
      worldGroupId,
      operation,
      sourceSummaryHash: await hashDetailedOutlineSourceSummaryV1(chapterSummary),
      output,
      outputHash: await hashCanonicalValue(output),
      contextManifestHash: manifest.manifestHash,
      gatewayEvidenceVersion: 3,
      contentRevision,
      creativeArtifact,
      narrativeBrief,
      workspaceScope: scope,
      createdAt: Date.now(),
    }
    const candidateHash = baseCandidate.outputHash
    const candidate: DetailedOutlineGenerationCandidateV1 = {
      ...baseCandidate,
      durable: {
        runId: snapshot.run.id,
        stepId: DETAILED_OUTLINE_GENERATION_STEP_ID_V1,
        attempt: 1,
        candidateHash,
      },
    }
    const persisted = await persistDetailedOutlineGenerationCandidateV1({ scope, candidate })
    snapshot = await recordDetailedOutlineGenerationCandidateV1({ scope, snapshot, candidate })
    setPendingCandidate({ candidate, eventId: persisted.event.id! })
  }, [
    ai,
    buildDetailContext,
    enhanceAI,
    chapterSummary,
    chapterTitle,
    aiConfig,
    creativeQualityMode,
    currentDetailed?.scenes,
    selectedOutlineNodeId,
    projectId,
    worldGroupId,
    isRecovering,
    pendingCandidate,
  ])

  const acceptCandidate = useCallback(async (
    operation: DetailedOutlineGenerationOperationV1,
    output: string,
  ) => {
    let pending = pendingCandidate
    const outlineNodeId = selectedOutlineNodeId
    if (!pending || pending.candidate.operation !== operation || outlineNodeId == null) return false
    await flushPendingEditsV1()
    if (pending.candidate.outlineNodeId !== outlineNodeId) {
      throw new Error('细纲候选已变化，请刷新后重新确认。')
    }
    if (pending.candidate.creativeArtifact && pending.candidate.narrativeBrief) {
      const creativeArtifact = revalidateDetailedOutlineCreativeDraftV1({
        raw: output,
        operation,
        narrativeBrief: pending.candidate.narrativeBrief,
        previousArtifact: pending.candidate.creativeArtifact,
      })
      if (!creativeArtifactCanAdoptV1(creativeArtifact)) {
        throw new Error('场景细纲仍有结构问题；请编辑 JSON 后再次校验。')
      }
      if (pending.candidate.output !== output) {
        await updateAgentEventCandidate(
          pending.eventId,
          projectId,
          output,
          await resolveScopeLike(projectId),
          {
            creativeArtifact,
            refreshOutputHash: true,
          },
        )
        const restored = await readLatestDetailedOutlineGenerationCandidateV1({
          scope: await resolveScopeLike(projectId),
          outlineNodeId,
        })
        if (!restored) throw new Error('作者修订后的场景细纲未能恢复。')
        pending = { candidate: restored.candidate, eventId: restored.event.id! }
        setPendingCandidate(pending)
        const restore = operation === 'scenes' ? restoreDetail : restoreEnhanced
        restore({
          output,
          operation: `durable:${operation}:${pending.candidate.durable.runId}`,
        })
      }
    } else if (pending.candidate.output !== output) {
      throw new Error('该细纲候选缺少当前修订证据，请关闭后重新生成。')
    }
    const patch = buildDetailedOutlineCopilotPatchV1({
      raw: output,
      operation,
      currentScenes: currentDetailed?.scenes ?? [],
      chapterSummary,
      validCharacterIds,
      validForeshadowIds,
    })
    const scope = await resolveScopeLike(projectId)
    await assertDetailedOutlineTargetsUnwrittenFutureV1({ scope, worldGroupId, outlineNodeId })
    await commitDetailedOutlineGenerationAdoptionV1({
      scope,
      runId: pending.candidate.durable.runId,
      candidate: pending.candidate,
      output,
      currentSourceSummaryHash: () => hashDetailedOutlineSourceSummaryV1(chapterSummary),
      adopt: async () => {
        const result = await adoptDetailedPatch(outlineNodeId, patch, scope)
        if (
          !result.written.length
          || result.unknown.length
          || result.typeErrors.length
          || result.fkErrors.length
          || result.skipped.length
        ) throw new Error('细纲候选未能经正式注册表完整写入。')
      },
      postState: () => db.detailedOutlines.where('outlineNodeId').equals(outlineNodeId).first(),
      postStateMatches: state => detailedOutlinePostStateMatchesPatchV1(state, outlineNodeId, patch),
    })
    setPendingCandidate(null)
    if (operation === 'scenes') ai.reset()
    else enhanceAI.reset()
    return true
  }, [
    adoptDetailedPatch,
    ai,
    enhanceAI,
    chapterSummary,
    currentDetailed?.scenes,
    selectedOutlineNodeId,
    projectId,
    validCharacterIds,
    validForeshadowIds,
    worldGroupId,
    pendingCandidate,
    restoreDetail,
    restoreEnhanced,
  ])

  const dismissCandidate = useCallback(async (operation: DetailedOutlineGenerationOperationV1) => {
    const pending = pendingCandidate
    if (!pending || pending.candidate.operation !== operation) return
    try {
      const scope = await resolveScopeLike(projectId)
      await rejectDetailedOutlineGenerationCandidateV1({
        scope,
        runId: pending.candidate.durable.runId,
        candidate: pending.candidate,
      })
    } finally {
      setPendingCandidate(null)
      if (operation === 'scenes') ai.reset()
      else enhanceAI.reset()
    }
  }, [ai, enhanceAI, projectId, pendingCandidate])

  const clearPendingCandidate = useCallback(() => setPendingCandidate(null), [])

  return {
    ai,
    enhanceAI,
    isRecovering,
    pendingCandidate,
    buildDetailContext,
    adoptDetailedPatch,
    generateScenes: () => run('scenes'),
    generateEnhanced: () => run('enhanced'),
    acceptCandidate,
    dismissCandidate,
    clearPendingCandidate,
    restoreEnhanced,
  }
}
