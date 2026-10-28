import { db } from '../../db/schema'
import type { AgentRunContractV3, AgentRunRecord, ChatMessage, WorkspaceScope } from '../../types'
import type { AIRequestConfigResolution, StreamResult } from '../../ai/client'
import { describeResolvedAIRequestSettingsV1, resolveRequestConfig } from '../../ai/client'
import { useAIConfigStore } from '../../../stores/ai-config'
import { htmlToPlainText, countWords } from '../../utils/html'
import { hashChapterText, sha256Text } from '../../ai/chapter-memory/text-normalization'
import { normalizeRichEditorHTMLV1 } from '../../editor/rich-editor-schema'
import { assertRecordInScope, readOwnedRows } from '../../workspace/scope'
import { captureWorkspaceContentRevisionV1, assertWorkspaceContentRevisionFreshV1 } from '../../authoring/content-revision'
import { prepareProseGatewayAssemblyV1 } from '../../prose/gateway-context'
import { buildQualityRevisionRequestV1, freezeQualityRevisionPlanV1, qualityRevisionProtectionErrorV1, QUALITY_REVISION_PROMPT_VERSION_V1, type QualityRevisionPlanV1 } from '../../prose/quality-revision'
import { previewQualityRevisionHTMLV1 } from '../../prose/quality-revision-html'
import { buildQualityRecheckRequestV1, parseQualityRecheckV1 } from '../../prose/quality-recheck'
import { QUALITY_RECHECK_STEP_V1, type QualityRevisionEvidenceV1 } from '../../prose/quality-revision-evidence'
import type { QualityReviewModeV1 } from '../../prose/quality-review'
import { proseRenderedRequestV1 } from '../../prose/request-evidence'
import { boundedQualityResolutionV1 } from '../../prose/quality-request-budget'
import { getAgentSkillV1, resolveAgentSkillContextSourceKeysV1 } from '../skill-registry'
import { createAgentSkillExecutionBindingV2 } from '../execution-binding'
import { freezeFormalAIEntryBindingV1 } from '../formal-ai-entry'
import { createAgentRunV1, appendAgentRunEventV1, readAgentRunV1, type AgentRunSnapshotV1 } from './event-store'
import { hashCanonicalValue } from './hash'
import { createContextManifestFromAssemblyV1, createContextManifestV2FromV1 } from './context-manifest'
import { recordContextGatewayPreflightEvidenceV1, finalizeContextGatewayAttemptEvidenceV1 } from '../../context-gateway/attempt-evidence'
import { recordAgentRunArtifactV1 } from '../../memory/artifact-store'
import { createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from './checkpoint'
import { AgentTeamBudgetTracker } from '../team-budget'
import { estimateTokens } from '../../ai/context-budget'
import { buildChapterInformationBoundaryV1, validateProseInformationBoundaryV1 } from '../information-boundary'
import { readLatestWholeChapterQualityReviewV1 } from './quality-review-durable'
import { beginProseGenerationGatewayStepV1, buildProseGenerationRunContractV3, persistProseGenerationCandidateV1, recordProseGenerationCandidateV1, hashProseGenerationCandidateV1, readLatestProseGenerationCandidateV1, commitProseGenerationAdoptionV1, rejectProseGenerationCandidateV1, isProseGenerationCandidateCurrentV1, type ProseGenerationCandidateV1 } from './prose-generation-durable'

type Call = (messages: ChatMessage[], resolution: AIRequestConfigResolution, result: StreamResult) => Promise<string>
export interface QualityRevisionDraftV1 { version: 'quality-revision-draft-v1'; plan: QualityRevisionPlanV1; sourceHtml: string; contentHtml: string; outputText: string; rawPatches: string }
export interface QualityRevisionViewV1 { runId: number; state: string; current: boolean; draft: QualityRevisionDraftV1; candidate: ProseGenerationCandidateV1 | null; protectionError?: string }
export interface QualityRevisionRecoveryV1 { runId: number; state: string }

async function append(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, type: Parameters<typeof appendAgentRunEventV1>[0]['type'], payload: any) {
  return appendAgentRunEventV1({ scope, runId: snapshot.run.id, type, payload, expectedLastSequence: snapshot.projection.lastSequence } as any)
}

function completion(result: StreamResult): 'complete' | 'length' | 'unknown' {
  return result.finishReason === 'length' ? 'length' : result.completion === 'complete' && result.finishReason === 'stop' ? 'complete' : 'unknown'
}

/** Author opt-in, exactly one revision and one recheck, then the same governed
 * prose candidate/adoption path. This service never directly writes Canon. */
interface QualityRevisionInputV1 {
  scope: WorkspaceScope; chapterId: number; outlineNodeId: number; worldGroupId: number | null
  mode: QualityReviewModeV1; reportRunId: number; reportHash: string; selectedIssueIds: string[]
  additionalParagraphs?: number[]; protectedQuotes?: string[]
  revise: Call; recheck: Call; signal?: AbortSignal
  configOverride?: import('../../types').AIConfig
  generationOverrides?: { temperature?: number; maxTokens?: number }
  authorRequest?: string
}

export async function runQualityRevisionV1(input: QualityRevisionInputV1): Promise<QualityRevisionViewV1> {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) throw new Error('当前浏览器无法确认跨页面执行占用，请使用支持安全执行的浏览器。')
  return navigator.locks.request(`storyforge:quality-revision:${input.scope.projectId}:${input.scope.workId}:${input.chapterId}`, { ifAvailable: true }, lock => {
    if (!lock) throw new Error('另一页面正在修订本章，请等待该次运行结束。')
    return runQualityRevisionLockedV1(input)
  })
}

async function runQualityRevisionLockedV1(input: QualityRevisionInputV1): Promise<QualityRevisionViewV1> {
  const chapter = await db.chapters.get(input.chapterId)
  if (!chapter || chapter.outlineNodeId !== input.outlineNodeId || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) throw new Error('修订章节不存在或越过当前作品。')
  const review = await readLatestWholeChapterQualityReviewV1({ scope: input.scope, chapterId: input.chapterId, mode: input.mode })
  if (!review?.current || review.runId !== input.reportRunId || review.report.artifactHash !== input.reportHash) throw new Error('初审报告已变化或过期，请重新选择问题。')
  const ownedRuns = await readOwnedRows<AgentRunRecord>(input.scope, 'agentRuns', { owner: 'work' })
  if (ownedRuns.some(row => { try { const c = JSON.parse(row.contractJson); return c.executionBindings?.some((b: { skillId: string }) => b.skillId === 'prose.quality-revise') && c.runtimeBindingHash && c.objective.includes(`报告 ${input.reportHash}`) } catch { return false } })) throw new Error('本轮修订已执行，不能重复调用；需要新一轮时请重新评审。')
  const sourceHtml = chapter.content ?? ''
  const originalText = htmlToPlainText(sourceHtml)
  const plan = await freezeQualityRevisionPlanV1({ ...input, report: review.report, reviewMessages: review.messages, reviewCurrent: review.current, originalText, previousCalls: 2 })
  if (normalizeRichEditorHTMLV1(sourceHtml) !== sourceHtml) throw new Error('请先保存当前正文，让修订保持原有编辑器格式。')
  const revision = await captureWorkspaceContentRevisionV1({ scope: input.scope, worldGroupId: input.worldGroupId })
  const boundary = await buildChapterInformationBoundaryV1({ scope: input.scope, chapterId: input.chapterId, outlineNodeId: input.outlineNodeId, worldGroupId: input.worldGroupId, perspectiveCharacterId: chapter.perspectiveCharacterId ?? null })
  const writer = getAgentSkillV1('prose.quality-revise', 'prose')
  if (writer.promptVersion !== QUALITY_REVISION_PROMPT_VERSION_V1) throw new Error('范围修订 Skill 与请求版本不一致。')
  const checker = getAgentSkillV1('prose.quality-recheck', 'prose')
  const writerBinding = await createAgentSkillExecutionBindingV2(writer, { optionalContextActivations: [], writeTargets: [{ table: 'chapters', fields: ['content', 'wordCount'], mode: 'author-confirmed' }] })
  const checkerBinding = await createAgentSkillExecutionBindingV2(checker, { optionalContextActivations: [], writeTargets: [] })
  const resolution = boundedQualityResolutionV1(resolveRequestConfig(input.configOverride ?? useAIConfigStore.getState().config, { category: 'review.revise', projectId: input.scope.projectId, configOverrides: input.generationOverrides }))
  const settings = describeResolvedAIRequestSettingsV1(resolution, false, { responseFormat: 'json_object' })
  if (resolution.config.maxTokens > writer.maxOutputTokens) throw new Error('修订输出上限超过本轮预算。')
  const assembly = await prepareProseGatewayAssemblyV1({ ...input, projectId: input.scope.projectId, operation: 'revise', qualityRevision: true, authorRequest: `只处理作者选中的问题，保留保护文字、其它段落和停笔位置。${plan.authorRequest ? `\n${plan.authorRequest}` : ''}`, config: resolution.config, allowOutlineOnlyAgentDraft: true })
  const messages = buildQualityRevisionRequestV1({ plan, report: review.report, originalText, registeredContext: assembly.text })
  const base = await buildProseGenerationRunContractV3({ projectId: input.scope.projectId, worldGroupId: input.worldGroupId, chapterId: input.chapterId, operation: 'quality-revise', generationBinding: writerBinding, formalEntry: await freezeFormalAIEntryBindingV1('prose.chapter.quality-revise') })
  const contract: AgentRunContractV3 = { ...base, objective: `定向修订章节 #${input.chapterId}，报告 ${input.reportHash}，一次修订与一次复核后等待作者`, runtimeBindingHash: plan.planHash,
    executionBindings: [...base.executionBindings, { stepId: QUALITY_RECHECK_STEP_V1, ...checkerBinding, formalEntry: await freezeFormalAIEntryBindingV1('prose.review.recheck') }],
    budget: { ...base.budget, maxModelCalls: 2, maxInputTokens: 96000, maxOutputTokens: 32000, maxAttemptsPerStep: 1, maxProtocolErrors: 0 },
    acceptance: [...base.acceptance, { id: 'quality-revision.scope', kind: 'deterministic-check', required: true }, { id: 'quality-revision.recheck', kind: 'deterministic-check', required: true }],
    verificationPlan: base.verificationPlan.map(item => ({ ...item, criterionIds: [...item.criterionIds, 'quality-revision.scope', 'quality-revision.recheck'] })), failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' } }
  const budget = new AgentTeamBudgetTracker(useAIConfigStore.getState().agentTeamBudgetProfile)
  const first = budget.reserveCall({ label: '作者范围修订', messages, maxOutputTokens: resolution.config.maxTokens || 16000 })
  await assertWorkspaceContentRevisionFreshV1(revision, { scope: input.scope, worldGroupId: input.worldGroupId })
  if (input.signal?.aborted) throw new Error('修订已停止，未发送模型请求。')
  let snapshot = await createAgentRunV1({ scope: input.scope, worldGroupId: input.worldGroupId, contract })
  const begun = await beginProseGenerationGatewayStepV1({ scope: input.scope, snapshot, chapterId: input.chapterId, outlineNodeId: input.outlineNodeId, worldGroupId: input.worldGroupId, assembled: assembly, messages, requestSettings: settings, binding: { operation: 'quality-revise', sourceTextHash: await hashChapterText(sourceHtml), promptHash: await hashCanonicalValue(messages), informationBoundaryHash: boundary.manifestHash }, budgetReservationTokens: first.estimatedInputTokens + first.reservedOutputTokens })
  snapshot = begun.snapshot
  try {
    const received: StreamResult = {}
    const raw = await input.revise(messages, resolution, received)
    const retained = await recordAgentRunArtifactV1({ scope: input.scope, runId: snapshot.run.id, stepId: 'prose-generation', attempt: 1, artifactKind: 'raw-response', content: JSON.stringify({ version: 'quality-revision-received-v1', raw, completion: completion(received) }), expectedLastSequence: snapshot.projection.lastSequence })
    snapshot = retained.snapshot
    budget.settleCall(first, raw)
    if (completion(received) !== 'complete') throw new Error('修订响应未完成，保留收到的内容，未自动重发。')
    const preview = await previewQualityRevisionHTMLV1({ sourceHtml, plan, raw, normalize: normalizeRichEditorHTMLV1 })
    if (!preview.outputText.trim() || preview.contentHtml === sourceHtml) throw new Error('修订未产生有效变化。')
    if (validateProseInformationBoundaryV1(preview.outputText, boundary).length) throw new Error('修订违反已确认的信息边界，不能成为可采纳候选。')
    snapshot = await append(input.scope, snapshot, 'model.responded', { stepId: 'prose-generation', attempt: 1, outputHash: await hashCanonicalValue(raw) })
    snapshot = await append(input.scope, snapshot, 'budget.settled', { stepId: 'prose-generation', modelCalls: 1, toolCalls: 0, tokens: received.usage?.totalTokens ?? first.estimatedInputTokens + estimateTokens(raw) })
    const draft: QualityRevisionDraftV1 = { version: 'quality-revision-draft-v1', plan, sourceHtml, contentHtml: preview.contentHtml, outputText: preview.outputText, rawPatches: raw }
    snapshot = (await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: draft })).snapshot
    const protectionError = qualityRevisionProtectionErrorV1(plan, preview.outputText)
    if (protectionError) throw new Error(protectionError)
    await assertWorkspaceContentRevisionFreshV1(revision, { scope: input.scope, worldGroupId: input.worldGroupId })
    if (input.signal?.aborted) throw new Error('修订已停止，预演结果已保留，未继续复核。')
    const recheckResolution = boundedQualityResolutionV1(resolveRequestConfig(input.configOverride ?? useAIConfigStore.getState().config, { category: 'review.quality', projectId: input.scope.projectId, configOverrides: input.generationOverrides }))
    const recheckSettings = describeResolvedAIRequestSettingsV1(recheckResolution, false, { responseFormat: 'json_object' })
    if (recheckResolution.config.maxTokens > checker.maxOutputTokens) throw new Error('复核输出上限超过本轮预算。')
    const recheckAssembly = await prepareProseGatewayAssemblyV1({ ...input, projectId: input.scope.projectId, operation: 'review', qualityRecheck: true, authorRequest: '只复核一次修订候选，检查所选问题与新问题。', config: recheckResolution.config, allowOutlineOnlyAgentDraft: true })
    const recheckMessages = await buildQualityRecheckRequestV1({ plan, originalReport: review.report, chapterTitle: chapter.title, candidateText: preview.outputText, registeredContext: recheckAssembly.text })
    const second = budget.reserveCall({ label: '范围修订一次复核', messages: recheckMessages, maxOutputTokens: recheckResolution.config.maxTokens || 16000 })
    snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: QUALITY_RECHECK_STEP_V1 })
    snapshot = await append(input.scope, snapshot, 'step.started', { stepId: QUALITY_RECHECK_STEP_V1, attempt: 1 })
    const execution = recheckAssembly.contextGatewayExecution
    const preflight = await recordContextGatewayPreflightEvidenceV1({ scope: input.scope, runId: snapshot.run.id, stepId: QUALITY_RECHECK_STEP_V1, attempt: 1, contextPacket: execution.contextPacket, selector: execution.selector, renderedRequest: proseRenderedRequestV1(recheckMessages, recheckSettings), sourceSnapshots: execution.sourceSnapshots, toolTranscript: execution.toolTranscript, expectedLastSequence: snapshot.projection.lastSequence })
    snapshot = preflight.snapshot
    const manifest = await createContextManifestV2FromV1({ scope: input.scope, manifest: await createContextManifestFromAssemblyV1({ runId: snapshot.run.id, stepId: QUALITY_RECHECK_STEP_V1, attempt: 1, projectId: input.scope.projectId, worldGroupId: input.worldGroupId, declaredSourceKeys: resolveAgentSkillContextSourceKeysV1(checker), assembled: recheckAssembly }) })
    snapshot = await append(input.scope, snapshot, 'budget.reserved', { stepId: QUALITY_RECHECK_STEP_V1, modelCalls: 1, toolCalls: 0, tokens: second.estimatedInputTokens + second.reservedOutputTokens })
    snapshot = await append(input.scope, snapshot, 'model.requested', { stepId: QUALITY_RECHECK_STEP_V1, attempt: 1, bindingHash: plan.planHash })
    const response: StreamResult = {}
    const recheckRaw = await input.recheck(recheckMessages, recheckResolution, response)
    const saved = await recordAgentRunArtifactV1({ scope: input.scope, runId: snapshot.run.id, stepId: QUALITY_RECHECK_STEP_V1, attempt: 1, artifactKind: 'raw-response', content: JSON.stringify({ version: 'quality-recheck-received-v1', raw: recheckRaw, completion: completion(response) }), expectedLastSequence: snapshot.projection.lastSequence })
    snapshot = saved.snapshot
    budget.settleCall(second, recheckRaw)
    snapshot = await append(input.scope, snapshot, 'model.responded', { stepId: QUALITY_RECHECK_STEP_V1, attempt: 1, outputHash: await hashCanonicalValue(recheckRaw) })
    snapshot = await append(input.scope, snapshot, 'budget.settled', { stepId: QUALITY_RECHECK_STEP_V1, modelCalls: 1, toolCalls: 0, tokens: response.usage?.totalTokens ?? second.estimatedInputTokens + estimateTokens(recheckRaw) })
    const recheck = await parseQualityRecheckV1({ raw: recheckRaw, plan, candidateText: preview.outputText, messages: recheckMessages, settings: recheckSettings, completion: completion(response) })
    const rechecked = await finalizeContextGatewayAttemptEvidenceV1({ scope: input.scope, runId: snapshot.run.id, stepId: QUALITY_RECHECK_STEP_V1, attempt: 1, baseManifest: manifest, preflight: preflight.evidence, selector: execution.selector, sufficiency: execution.sufficiency, retrievalTrace: execution.retrievalTrace, gatewayVersionHash: execution.contextPacket.gatewayVersionHash, policyHash: execution.contextPacket.policyHash, rawResponse: { version: 'quality-recheck-response-v1', raw: recheckRaw, recheck }, candidateHash: recheck.artifactHash, expectedLastSequence: snapshot.projection.lastSequence })
    snapshot = rechecked.snapshot
    snapshot = await append(input.scope, snapshot, 'candidate.persisted', { stepId: QUALITY_RECHECK_STEP_V1, attempt: 1, candidateHash: recheck.artifactHash, requiresConfirmation: false })
    snapshot = await append(input.scope, snapshot, 'step.succeeded', { stepId: QUALITY_RECHECK_STEP_V1, attempt: 1, outputHash: recheck.artifactHash })
    await assertWorkspaceContentRevisionFreshV1(revision, { scope: input.scope, worldGroupId: input.worldGroupId })
    const evidence: QualityRevisionEvidenceV1 = { version: 1, plan, sourceHtml, sourceHtmlHash: await sha256Text(sourceHtml), rawPatches: raw, contentHtml: preview.contentHtml, recheck, recheckMessages, recheckManifestHash: rechecked.manifest.manifestHash }
    const body = { version: 1 as const, type: 'prose-generation-candidate' as const, projectId: input.scope.projectId, chapterId: input.chapterId, chapterTitle: chapter.title, worldGroupId: input.worldGroupId, operation: 'quality-revise' as const, sourceTextHash: await hashChapterText(sourceHtml), contentRevision: revision, outputText: preview.outputText, outputTextHash: await hashCanonicalValue(preview.outputText), gatewayEvidenceVersion: 3 as const, expectedContentHash: await hashChapterText(preview.contentHtml), informationBoundaryHash: boundary.manifestHash, perspectiveCharacterId: chapter.perspectiveCharacterId ?? null, perspectiveFromChapter: true, qualityRevision: evidence, createdAt: Date.now() }
    const candidateHash = await hashProseGenerationCandidateV1(body)
    const firstExecution = begun.attempt.execution
    const bound = await finalizeContextGatewayAttemptEvidenceV1({ scope: input.scope, runId: snapshot.run.id, stepId: 'prose-generation', attempt: 1, baseManifest: begun.attempt.baseManifest, preflight: begun.attempt.preflight, selector: firstExecution.selector, sufficiency: firstExecution.sufficiency, retrievalTrace: firstExecution.retrievalTrace, gatewayVersionHash: firstExecution.contextPacket.gatewayVersionHash, policyHash: firstExecution.contextPacket.policyHash, rawResponse: { version: 'quality-revision-response-v1', raw, planHash: plan.planHash, outputText: preview.outputText, qualityRevision: evidence }, candidateHash, expectedLastSequence: snapshot.projection.lastSequence })
    snapshot = bound.snapshot
    const candidate: ProseGenerationCandidateV1 = { ...body, durable: { runId: snapshot.run.id, stepId: 'prose-generation', attempt: 1, contextManifestHash: bound.manifest.manifestHash, candidateHash } }
    await persistProseGenerationCandidateV1({ scope: input.scope, candidate })
    snapshot = await recordProseGenerationCandidateV1({ scope: input.scope, snapshot, candidate })
    return { runId: snapshot.run.id, state: snapshot.projection.state, current: true, draft, candidate }
  } catch (error) {
    snapshot = await readAgentRunV1(input.scope, snapshot.run.id)
    if (!['failed', 'cancelled', 'completed'].includes(snapshot.projection.state)) await append(input.scope, snapshot, input.signal?.aborted ? 'run.cancelled' : 'run.failed', input.signal?.aborted ? { reason: 'author-stopped-quality-revision' } : { code: 'quality-revision-invalid-or-stale', retryable: false })
    throw error
  }
}

async function latestQualityRevisionSnapshot(input: { scope: WorkspaceScope; chapterId: number }): Promise<AgentRunSnapshotV1 | null> {
  const chapter = await db.chapters.get(input.chapterId)
  if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) return null
  const runs = (await readOwnedRows<AgentRunRecord>(input.scope, 'agentRuns', { owner: 'work' })).filter(row => { try { const c = JSON.parse(row.contractJson); return c.scope.chapterIds?.[0] === input.chapterId && c.executionBindings.some((b: { skillId: string }) => b.skillId === 'prose.quality-revise') } catch { return false } }).sort((a, b) => b.createdAt - a.createdAt || (b.id ?? 0) - (a.id ?? 0))
  if (!runs[0]?.id) return null
  return readAgentRunV1(input.scope, runs[0].id)
}

/** Read-only recovery marker. No request or fabricated preview is created. */
export async function readLatestUnfinishedQualityRevisionV1(input: { scope: WorkspaceScope; chapterId: number }): Promise<QualityRevisionRecoveryV1 | null> {
  const snapshot = await latestQualityRevisionSnapshot(input)
  if (!snapshot || ['completed', 'cancelled', 'failed', 'recovery_required'].includes(snapshot.projection.state)) return null
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, snapshot.run.id)
  const draft = checkpoint?.resumePayload as QualityRevisionDraftV1 | undefined
  if (draft?.version === 'quality-revision-draft-v1' && draft.plan?.scope?.workId === input.scope.workId
    && draft.plan.chapterId === input.chapterId && snapshot.contract.runtimeBindingHash === draft.plan.planHash) return null
  return { runId: snapshot.run.id, state: snapshot.projection.state }
}

export async function readLatestQualityRevisionV1(input: { scope: WorkspaceScope; chapterId: number }): Promise<QualityRevisionViewV1 | null> {
  const snapshot = await latestQualityRevisionSnapshot(input)
  if (!snapshot) return null
  const chapter = await db.chapters.get(input.chapterId)
  if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) return null
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, snapshot.run.id)
  const draft = checkpoint?.resumePayload as QualityRevisionDraftV1 | undefined
  if (!draft || draft.version !== 'quality-revision-draft-v1' || draft.plan?.scope?.workId !== input.scope.workId || draft.plan.chapterId !== input.chapterId || snapshot.contract.runtimeBindingHash !== draft.plan.planHash) return null
  const rebuilt = await previewQualityRevisionHTMLV1({ sourceHtml: draft.sourceHtml, plan: draft.plan, raw: draft.rawPatches, normalize: normalizeRichEditorHTMLV1 })
  if (rebuilt.contentHtml !== draft.contentHtml || rebuilt.outputText !== draft.outputText) throw new Error('修订预演证据已损坏。')
  const stored = await readLatestProseGenerationCandidateV1({ ...input, operations: ['quality-revise'] })
  const candidate = stored?.durable.runId === snapshot.run.id ? stored : null
  const protectionError = qualityRevisionProtectionErrorV1(draft.plan, draft.outputText)
  const current = !protectionError && (candidate ? await isProseGenerationCandidateCurrentV1(candidate) : chapter.content === draft.sourceHtml)
  return { runId: snapshot.run.id, state: snapshot.projection.state, current, draft, candidate, ...(protectionError ? { protectionError } : {}) }
}

export async function adoptQualityRevisionV1(input: { scope: WorkspaceScope; candidate: ProseGenerationCandidateV1 }) {
  if (input.candidate.operation !== 'quality-revise' || !input.candidate.qualityRevision) throw new Error('不是当前范围修订候选。')
  return commitProseGenerationAdoptionV1({ ...input, runId: input.candidate.durable.runId, contentHtml: input.candidate.qualityRevision.contentHtml, wordCount: countWords(input.candidate.outputText) })
}

export async function rejectQualityRevisionV1(input: { scope: WorkspaceScope; candidate: ProseGenerationCandidateV1 }) {
  if (input.candidate.operation !== 'quality-revise' || !input.candidate.qualityRevision) throw new Error('不是当前范围修订候选。')
  let snapshot = await readAgentRunV1(input.scope, input.candidate.durable.runId)
  if (snapshot.projection.steps['prose-generation']?.candidateHash !== input.candidate.durable.candidateHash) throw new Error('修订候选身份已变化，未记录拒绝。')
  if (snapshot.projection.state === 'cancelled') return snapshot
  if (snapshot.projection.state === 'completed') throw new Error('修订已采纳，不能重复拒绝。')
  snapshot = await rejectProseGenerationCandidateV1({ ...input, runId: input.candidate.durable.runId })
  if (snapshot.events.some(event => event.type === 'confirmation.recorded' && event.payload.decision === 'reject' && event.payload.candidateHash === input.candidate.durable.candidateHash) && !['cancelled', 'completed', 'failed'].includes(snapshot.projection.state)) {
    snapshot = await append(input.scope, snapshot, 'run.cancelled', { reason: 'author-rejected-quality-revision' })
  }
  return snapshot
}

/** End a saved interrupted run without dispatching a model or overwriting text. */
export async function abandonQualityRevisionV1(input: { scope: WorkspaceScope; chapterId: number; runId: number }) {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) throw new Error('无法确认另一页面的执行占用，未结束运行。')
  return navigator.locks.request(`storyforge:quality-revision:${input.scope.projectId}:${input.scope.workId}:${input.chapterId}`, { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('另一页面仍在修订本章，不能结束该次运行。')
    const snapshot = await readAgentRunV1(input.scope, input.runId)
    if (snapshot.contract.scope.chapterIds?.[0] !== input.chapterId || !snapshot.contract.executionBindings?.some(binding => binding.skillId === 'prose.quality-revise')) throw new Error('不是当前章节的范围修订运行。')
    if (['completed', 'cancelled', 'failed'].includes(snapshot.projection.state)) return snapshot
    return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-abandoned-unfinished-quality-revision' })
  })
}
