import { useCallback, useEffect, useState } from 'react'
import { useAIStream } from '../../hooks/useAIStream'
import { useAIConfigStore } from '../../stores/ai-config'
import { createAISessionKey } from '../../stores/ai-generation-session'
import { assembleContext } from '../../lib/registry/assemble-context'
import { adopt } from '../../lib/registry/adopt'
import { db } from '../../lib/db/schema'
import { resolveScopeLike } from '../../lib/world-engine/scope'
import { hashCanonicalValue } from '../../lib/agent/run/hash'
import {
  buildDetailSceneGeneratePrompt,
  buildEnhancedDetailPrompt,
} from '../../lib/ai/adapters/detail-scene-adapter'
import {
  buildAgentSkillInputGuidanceV1,
  getAgentSkillV1,
  resolveAgentSkillInputStateV1,
} from '../../lib/agent/skill-registry'
import {
  buildDetailedOutlineCopilotPatchV1,
  detailedOutlinePostStateMatchesPatchV1,
  parseDetailedOutlineCopilotDraftV1,
} from '../../lib/agent/detailed-outline-copilot'
import {
  beginDetailedOutlineGenerationStepV1,
  commitDetailedOutlineGenerationAdoptionV1,
  createDetailedOutlineGenerationDurableRunV1,
  detailedOutlineManifestV1,
  failDetailedOutlineGenerationStepV1,
  hashDetailedOutlineGenerationCandidateV1,
  hashDetailedOutlineSourceSummaryV1,
  persistDetailedOutlineGenerationCandidateV1,
  readLatestDetailedOutlineGenerationCandidateV1,
  recordDetailedOutlineGenerationCandidateV1,
  recordDetailedOutlineGenerationModelOutputV1,
  rejectDetailedOutlineGenerationCandidateV1,
  DETAILED_OUTLINE_GENERATION_CANDIDATE_TYPE_V1,
  DETAILED_OUTLINE_GENERATION_SOURCE_KEYS_V1,
  DETAILED_OUTLINE_GENERATION_STEP_ID_V1,
  type DetailedOutlineGenerationCandidateV1,
  type DetailedOutlineGenerationOperationV1,
} from '../../lib/agent/run/detailed-outline-generation-durable'
import type { DetailedOutline, WorkspaceScope } from '../../lib/types'

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
  ) => {
    const assembled = await assembleContext({
      projectId,
      scope,
      worldGroupId: contextWorldGroupId,
      outlineNodeId,
      provider: aiConfig.provider,
      model: aiConfig.model,
      sourceKeys: [...DETAILED_OUTLINE_GENERATION_SOURCE_KEYS_V1],
    })
    const characterIndex = assembled.included.indexOf('characters')
    const foreshadowIndex = assembled.included.indexOf('foreshadows')
    return {
      worldContext: assembled.segments
        .filter((_, index) => index !== characterIndex && index !== foreshadowIndex)
        .map(segment => segment.content)
        .filter(Boolean)
        .join('\n\n'),
      characterContext: characterIndex >= 0 ? assembled.segments[characterIndex]?.content ?? '' : '',
      foreshadowContext: foreshadowIndex >= 0 ? assembled.segments[foreshadowIndex]?.content ?? '' : '',
      assembled,
    }
  }, [aiConfig.model, aiConfig.provider, projectId, worldGroupId])

  const run = useCallback(async (operation: DetailedOutlineGenerationOperationV1) => {
    const outlineNodeId = selectedOutlineNodeId
    if (outlineNodeId == null || isRecovering || pendingCandidate) return
    const scope = await resolveScopeLike(projectId)
    const context = await buildDetailContext(outlineNodeId, scope)
    const skill = getAgentSkillV1('outline.details', 'outline')
    const inputState = resolveAgentSkillInputStateV1(skill, [context.assembled])
    const guidance = buildAgentSkillInputGuidanceV1(skill, inputState)
    const messages = operation === 'scenes'
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
    let snapshot = await createDetailedOutlineGenerationDurableRunV1({
      scope,
      worldGroupId,
      outlineNodeId,
      operation,
    })
    const manifest = await detailedOutlineManifestV1({
      runId: snapshot.run.id,
      scope,
      worldGroupId,
      outlineNodeId,
      assembled: context.assembled,
    })
    snapshot = await beginDetailedOutlineGenerationStepV1({
      scope,
      snapshot,
      contextManifest: manifest,
      binding: {
        operation,
        sourceSummaryHash: await hashDetailedOutlineSourceSummaryV1(chapterSummary),
        promptHash: await hashCanonicalValue(messages),
      },
    })
    const target = operation === 'scenes' ? ai : enhanceAI
    let output = ''
    try {
      output = await target.start(messages, undefined, {
        category: operation === 'scenes' ? 'detail.scene' : 'detail.enhance',
        projectId,
      })
      if (!output.trim()) throw new Error('模型没有返回可用的细纲内容。')
      snapshot = await recordDetailedOutlineGenerationModelOutputV1({ scope, snapshot, output })
      parseDetailedOutlineCopilotDraftV1(output, operation)
    } catch (error) {
      await failDetailedOutlineGenerationStepV1({
        scope,
        snapshot,
        code: output.trim() ? 'invalid_output_contract' : 'empty_or_cancelled_output',
        retryable: true,
      })
      throw error
    }
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
      workspaceScope: scope,
      createdAt: Date.now(),
    }
    const candidateHash = await hashDetailedOutlineGenerationCandidateV1({
      ...baseCandidate,
      durable: {
        runId: snapshot.run.id,
        stepId: DETAILED_OUTLINE_GENERATION_STEP_ID_V1,
        attempt: 1,
        candidateHash: '',
      },
    })
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
    const pending = pendingCandidate
    const outlineNodeId = selectedOutlineNodeId
    if (!pending || pending.candidate.operation !== operation || outlineNodeId == null) return false
    if (pending.candidate.outlineNodeId !== outlineNodeId || pending.candidate.output !== output) {
      throw new Error('细纲候选已变化，请刷新后重新确认。')
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
    await commitDetailedOutlineGenerationAdoptionV1({
      scope,
      runId: pending.candidate.durable.runId,
      candidate: pending.candidate,
      output,
      currentSourceSummaryHash: () => hashDetailedOutlineSourceSummaryV1(chapterSummary),
      currentContextManifestHash: async () => {
        const current = await buildDetailContext(outlineNodeId, scope)
        return (await detailedOutlineManifestV1({
          runId: pending.candidate.durable.runId,
          scope,
          worldGroupId,
          outlineNodeId,
          assembled: current.assembled,
        })).manifestHash
      },
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
    buildDetailContext,
    enhanceAI,
    chapterSummary,
    currentDetailed?.scenes,
    selectedOutlineNodeId,
    projectId,
    validCharacterIds,
    validForeshadowIds,
    worldGroupId,
    pendingCandidate,
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
