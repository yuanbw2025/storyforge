import { db } from '../../db/schema'
import type { AgentRunContractV3, AgentRunRecord, ChatMessage, WorkspaceScope } from '../../types'
import type { AIRequestConfigResolution, StreamResult } from '../../ai/client'
import { describeResolvedAIRequestSettingsV1, resolveRequestConfig } from '../../ai/client'
import { useAIConfigStore } from '../../../stores/ai-config'
import { htmlToPlainText } from '../../utils/html'
import { assertRecordInScope, readOwnedRows } from '../../workspace/scope'
import { captureWorkspaceContentRevisionV1, assertWorkspaceContentRevisionFreshV1, type WorkspaceContentRevisionVectorV1 } from '../../authoring/content-revision'
import { prepareProseGatewayAssemblyV1 } from '../../prose/gateway-context'
import { buildWholeChapterQualityReviewRequestV1, parseWholeChapterQualityReviewV1, verifyWholeChapterQualityReviewV1, QUALITY_REVIEW_PROMPT_VERSION_V1, type QualityReviewArtifactV1, type QualityReviewModeV1 } from '../../prose/quality-review'
import { proseRenderedRequestV1 } from '../../prose/request-evidence'
import { boundedQualityResolutionV1 } from '../../prose/quality-request-budget'
import { getAgentSkillV1, resolveAgentSkillContextSourceKeysV1 } from '../skill-registry'
import { createAgentSkillExecutionBindingV2 } from '../execution-binding'
import { freezeFormalAIEntryBindingV1 } from '../formal-ai-entry'
import { createAgentRunV1, appendAgentRunEventV1, readAgentRunV1, type AgentRunSnapshotV1 } from './event-store'
import { hashCanonicalValue } from './hash'
import { createContextManifestFromAssemblyV1, createContextManifestV2FromV1 } from './context-manifest'
import { recordContextGatewayPreflightEvidenceV1, finalizeContextGatewayAttemptEvidenceV1, verifyContextGatewayCandidateEvidenceV1, inspectContextGatewayManifestFreshnessV1 } from '../../context-gateway/attempt-evidence'
import { readAgentRunArtifactExactV1, recordAgentRunArtifactV1 } from '../../memory/artifact-store'
import { createVerificationReceiptV1 } from './verification-receipt'
import { AgentTeamBudgetTracker } from '../team-budget'
import { createContextGatewayToolSessionV1 } from '../../context-gateway/tool-session'
import { createContextAccessPolicyForExecutionV1 } from '../../context-gateway/skill-policy'

export const QUALITY_REVIEW_STEP_V1 = 'whole-chapter-review'
const VERIFIER = 'whole-chapter-review-terminal-v1'
const entries = { quality: 'prose.review.quality', style: 'prose.review.anti-ai', readability: 'prose.review.readability' } as const
const categories = { quality: 'review.quality', style: 'review.anti-ai', readability: 'review.readability' } as const

export interface DurableQualityReviewV1 { report: QualityReviewArtifactV1; runId: number; current: boolean; messages: ChatMessage[]; authorRequest?: string }

async function append(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, type: Parameters<typeof appendAgentRunEventV1>[0]['type'], payload: any) {
  return appendAgentRunEventV1({ scope, runId: snapshot.run.id, type, payload, expectedLastSequence: snapshot.projection.lastSequence } as any)
}

/** Read-only report: exact request/response and validation persist in the same
 * governed Run/Artifact lifecycle. No Canon writes and no automatic retry. */
export async function runWholeChapterQualityReviewV1(input: {
  scope: WorkspaceScope; chapterId: number; outlineNodeId: number; worldGroupId: number | null; mode: QualityReviewModeV1
  call: (messages: ChatMessage[], resolution: AIRequestConfigResolution, result: StreamResult) => Promise<string>
  generatorIdentity?: { provider: string; model: string }
  configOverride?: import('../../types').AIConfig
  generationOverrides?: { temperature?: number; maxTokens?: number }
  authorRequest?: string
  signal?: AbortSignal
}): Promise<DurableQualityReviewV1> {
  const chapter = await db.chapters.get(input.chapterId)
  if (!chapter || chapter.outlineNodeId !== input.outlineNodeId || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) throw new Error('评审章节不存在或越过当前作品。')
  const chapterText = htmlToPlainText(chapter.content ?? '')
  if (!chapterText.trim()) throw new Error('正文为空，不能全文评审。')
  const revision = await captureWorkspaceContentRevisionV1({ scope: input.scope, worldGroupId: input.worldGroupId })
  const config = input.configOverride ?? useAIConfigStore.getState().config
  const resolution = boundedQualityResolutionV1(resolveRequestConfig(config, { category: categories[input.mode], projectId: input.scope.projectId, configOverrides: input.generationOverrides }))
  const settings = describeResolvedAIRequestSettingsV1(resolution, false, { responseFormat: 'json_object' })
  const assembled = await prepareProseGatewayAssemblyV1({ projectId: input.scope.projectId, scope: input.scope, worldGroupId: input.worldGroupId, chapterId: input.chapterId, outlineNodeId: input.outlineNodeId, operation: 'review', qualityReview: true, authorRequest: input.authorRequest?.trim() || '评审当前完整章节，保留作者场景任务和停笔要求。', config: resolution.config, allowOutlineOnlyAgentDraft: true })
  const request = await buildWholeChapterQualityReviewRequestV1({ mode: input.mode, chapterTitle: chapter.title, chapterText, registeredContext: assembled.text, authorRequest: input.authorRequest })
  await assertWorkspaceContentRevisionFreshV1(revision, { scope: input.scope, worldGroupId: input.worldGroupId })
  const skill = getAgentSkillV1('prose.quality-review', 'prose')
  if (skill.promptVersion !== QUALITY_REVIEW_PROMPT_VERSION_V1) throw new Error('全文评审 Skill 与请求版本不一致。')
  if (resolution.config.maxTokens > skill.maxOutputTokens) throw new Error('当前评审输出上限超过本轮预算，请先调低输出上限。')
  const binding = await createAgentSkillExecutionBindingV2(skill, { optionalContextActivations: [], writeTargets: [] })
  const formalEntry = await freezeFormalAIEntryBindingV1(entries[input.mode])
  const runtimeBindingHash = await hashCanonicalValue({ targetTextHash: request.targetTextHash, promptVersion: QUALITY_REVIEW_PROMPT_VERSION_V1, settings, mode: input.mode })
  const contract: AgentRunContractV3 = {
    version: 3, executionBoundary: 'formal', objective: `全文阅读评审 ${input.mode} #${input.chapterId}`, workflowKind: 'read-only-audit',
    scope: { projectId: input.scope.projectId, worldGroupId: input.worldGroupId, chapterIds: [input.chapterId], outlineNodeIds: [input.outlineNodeId] },
    permissions: { contextSourceKeys: resolveAgentSkillContextSourceKeysV1(skill), writeTargets: [] },
    executionBindings: [{ stepId: QUALITY_REVIEW_STEP_V1, ...binding, formalEntry }], runtimeBindingHash,
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 48000, maxOutputTokens: 16000, maxAttemptsPerStep: 1, maxProtocolErrors: 0 },
    acceptance: [{ id: 'quality.full-input', kind: 'deterministic-check', required: true }, { id: 'quality.quotes', kind: 'deterministic-check', required: true }, { id: 'quality.freshness', kind: 'deterministic-check', required: true }],
    verificationPlan: [{ id: 'quality.terminal', kind: 'terminal', verifier: VERIFIER, criterionIds: ['quality.full-input', 'quality.quotes', 'quality.freshness'] }],
    failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
  }
  const budget = new AgentTeamBudgetTracker(useAIConfigStore.getState().agentTeamBudgetProfile)
  const reservation = budget.reserveCall({ label: '全文阅读评审', messages: request.messages, maxOutputTokens: resolution.config.maxTokens && resolution.config.maxTokens > 0 ? resolution.config.maxTokens : 16000 })
  let snapshot = await createAgentRunV1({ scope: input.scope, worldGroupId: input.worldGroupId, contract })
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: QUALITY_REVIEW_STEP_V1 })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: QUALITY_REVIEW_STEP_V1, attempt: 1 })
  let staleInput = false
  try {
    const execution = assembled.contextGatewayExecution
    const preflight = await recordContextGatewayPreflightEvidenceV1({ scope: input.scope, runId: snapshot.run.id, stepId: QUALITY_REVIEW_STEP_V1, attempt: 1, contextPacket: execution.contextPacket, selector: execution.selector, renderedRequest: proseRenderedRequestV1(request.messages, settings), sourceSnapshots: execution.sourceSnapshots, toolTranscript: execution.toolTranscript, expectedLastSequence: snapshot.projection.lastSequence })
    snapshot = preflight.snapshot
    const base = await createContextManifestV2FromV1({ scope: input.scope, manifest: await createContextManifestFromAssemblyV1({ runId: snapshot.run.id, stepId: QUALITY_REVIEW_STEP_V1, attempt: 1, projectId: input.scope.projectId, worldGroupId: input.worldGroupId, declaredSourceKeys: resolveAgentSkillContextSourceKeysV1(skill), assembled }) })
    snapshot = await append(input.scope, snapshot, 'model.requested', { stepId: QUALITY_REVIEW_STEP_V1, attempt: 1, bindingHash: runtimeBindingHash })
    const result: StreamResult = {}
    const raw = await input.call(request.messages, resolution, result)
    budget.settleCall(reservation, raw)
    const completion = result.finishReason === 'length' ? 'length'
      : result.completion === 'complete' && (!result.finishReason || result.finishReason === 'stop') ? 'complete' : 'unknown'
    const received = await recordAgentRunArtifactV1({ scope: input.scope, runId: snapshot.run.id, stepId: QUALITY_REVIEW_STEP_V1, attempt: 1, artifactKind: 'raw-response', content: JSON.stringify({ version: 'quality-review-received-v1', raw, completion }), expectedLastSequence: snapshot.projection.lastSequence })
    snapshot = received.snapshot
    const report = await parseWholeChapterQualityReviewV1({ raw, mode: input.mode, chapterText, targetTextHash: request.targetTextHash, messages: request.messages, responseCompletion: completion, settings, generatorIdentity: input.generatorIdentity })
    snapshot = await append(input.scope, snapshot, 'model.responded', { stepId: QUALITY_REVIEW_STEP_V1, attempt: 1, outputHash: report.artifactHash })
    const finalized = await finalizeContextGatewayAttemptEvidenceV1({ scope: input.scope, runId: snapshot.run.id, stepId: QUALITY_REVIEW_STEP_V1, attempt: 1, baseManifest: base, preflight: preflight.evidence, selector: execution.selector, sufficiency: execution.sufficiency, retrievalTrace: execution.retrievalTrace, gatewayVersionHash: execution.contextPacket.gatewayVersionHash, policyHash: execution.contextPacket.policyHash, rawResponse: { version: 'quality-review-response-v1', raw, chapterText, revision, report, authorRequest: input.authorRequest?.trim() ?? '' }, candidateHash: report.artifactHash, expectedLastSequence: snapshot.projection.lastSequence })
    snapshot = finalized.snapshot
    snapshot = await append(input.scope, snapshot, 'candidate.persisted', { stepId: QUALITY_REVIEW_STEP_V1, attempt: 1, candidateHash: report.artifactHash, requiresConfirmation: false })
    try {
      await assertWorkspaceContentRevisionFreshV1(revision, { scope: input.scope, worldGroupId: input.worldGroupId })
    } catch (error) { staleInput = true; throw error }
    await verifyContextGatewayCandidateEvidenceV1({ scope: input.scope, runId: snapshot.run.id, stepId: QUALITY_REVIEW_STEP_V1, attempt: 1, candidateHash: report.artifactHash })
    if (!await verifyWholeChapterQualityReviewV1(report, chapterText, request.messages)) throw new Error('报告引文或覆盖证据验证失败。')
    snapshot = await append(input.scope, snapshot, 'step.succeeded', { stepId: QUALITY_REVIEW_STEP_V1, attempt: 1, outputHash: report.artifactHash })
    snapshot = await append(input.scope, snapshot, 'verification.started', { verifierSetVersion: VERIFIER })
    const receipt = await createVerificationReceiptV1({ version: 1, runId: snapshot.run.id, generation: snapshot.projection.generation, contractHash: snapshot.projection.contractHash, contextManifestHashes: [finalized.manifest.manifestHash], candidateHashes: [report.artifactHash], adoptionEventIds: [], postStateHash: runtimeBindingHash, verifierSetVersion: VERIFIER, criteria: contract.acceptance.map(item => ({ id: item.id, status: 'passed' as const, evidenceRefs: [`report:${report.artifactHash}`, `target:${report.targetTextHash}`] })), acceptedAt: Date.now() })
    snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
    return { report, runId: snapshot.run.id, current: true, messages: request.messages, authorRequest: input.authorRequest?.trim() ?? '' }
  } catch (error) {
    snapshot = await readAgentRunV1(input.scope, snapshot.run.id)
    if (snapshot.projection.steps[QUALITY_REVIEW_STEP_V1]?.status === 'running') snapshot = await append(input.scope, snapshot, 'step.failed', { stepId: QUALITY_REVIEW_STEP_V1, attempt: 1, code: 'quality-review-invalid-or-stale', retryable: false })
    if (!['failed', 'cancelled', 'completed'].includes(snapshot.projection.state)) {
      if (input.signal?.aborted) await append(input.scope, snapshot, 'run.cancelled', { reason: 'author-stopped-quality-review' })
      else if (staleInput) await append(input.scope, snapshot, 'run.paused', { reason: 'author-changed-quality-review-source', recoverable: false })
      else await append(input.scope, snapshot, 'run.failed', { code: 'quality-review-invalid-or-stale', retryable: false })
    }
    throw error
  }
}

/** Historical reports may remain readable; they never become adoption authority. */
export async function readLatestWholeChapterQualityReviewV1(input: { scope: WorkspaceScope; chapterId: number; mode: QualityReviewModeV1 }): Promise<DurableQualityReviewV1 | null> {
  const chapter = await db.chapters.get(input.chapterId)
  if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) return null
  const runs = (await readOwnedRows<AgentRunRecord>(input.scope, 'agentRuns', { owner: 'work' })).filter(row => {
    try {
      const contract = JSON.parse(row.contractJson) as AgentRunContractV3
      return contract.scope.chapterIds?.length === 1
        && contract.scope.chapterIds[0] === input.chapterId
        && contract.executionBindings.some(item => item.stepId === QUALITY_REVIEW_STEP_V1 && item.formalEntry?.entryId === entries[input.mode])
        && contract.verificationPlan.some(item => item.verifier === VERIFIER)
    } catch { return false }
  }).sort((a, b) => b.createdAt - a.createdAt)
  for (const row of runs) {
    const snapshot = await readAgentRunV1(input.scope, row.id!)
    if (snapshot.projection.state !== 'completed') continue
    const candidate = snapshot.events.find(event => event.type === 'candidate.persisted')
    if (!candidate || candidate.type !== 'candidate.persisted') continue
    const evidence = await verifyContextGatewayCandidateEvidenceV1({ scope: input.scope, runId: row.id!, stepId: QUALITY_REVIEW_STEP_V1, attempt: 1, candidateHash: candidate.payload.candidateHash })
    const ref = evidence.manifest.artifacts.find(item => item.role === 'raw-response')
    if (!ref) throw new Error('报告原响应证据缺失。')
    const payload = JSON.parse(await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'raw-response', contentHash: ref.contentHash })) as { version: string; chapterText: string; report: QualityReviewArtifactV1; revision: WorkspaceContentRevisionVectorV1; authorRequest?: string }
    const requestRef = evidence.manifest.artifacts.find(item => item.role === 'rendered-request')!
    const request = JSON.parse(await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'rendered-request', contentHash: requestRef.contentHash })) as { messages: ChatMessage[] }
    if (payload.version !== 'quality-review-response-v1' || payload.report.artifactHash !== candidate.payload.candidateHash || !await verifyWholeChapterQualityReviewV1(payload.report, payload.chapterText, request.messages)) throw new Error('报告证据已损坏。')
    let current = payload.report.targetTextHash === await hashCanonicalValue(htmlToPlainText(chapter.content ?? ''))
    try { await assertWorkspaceContentRevisionFreshV1(payload.revision, { scope: input.scope, worldGroupId: snapshot.contract.scope.worldGroupId }) } catch { current = false }
    const session = await createContextGatewayToolSessionV1({ scope: { ...input.scope, worldGroupId: snapshot.contract.scope.worldGroupId ?? null, chapterId: input.chapterId, characterId: chapter.perspectiveCharacterId ?? null }, policy: createContextAccessPolicyForExecutionV1(getAgentSkillV1('prose.quality-review', 'prose')) })
    const freshness = await inspectContextGatewayManifestFreshnessV1({ session, manifest: evidence.manifest })
    current = current && freshness.status === 'fresh'
    return { report: payload.report, runId: row.id!, current, messages: request.messages, authorRequest: payload.authorRequest ?? '' }
  }
  return null
}
