import { assertCodexProductionPolicyV1, consolidateCodexDraftsV1, readSentCodexProgressNamesV1 } from './codex-extraction-v2-source-units'
import Dexie from 'dexie'
import { db } from '../../db/schema'
import { readOwnedRows } from '../../workspace/scope'
import { adopt, adoptionTransactionTablesV1 } from '../../registry/adopt'
import { agentRunScopeTransactionTablesV1, readVerifiedAgentRunInTransactionV1, withAgentRunMutationLockV1,
  appendPrivilegedAgentRunEventInTransactionV1, appendAgentRunEventWithSettlementInTransactionV1 } from './event-store'
import { parseAgentRunEventV1 } from './event-schema'
import { createVerificationReceiptV1 } from './verification-receipt'
import type { CodexExtractionIntentV2, CodexExtractionReviewV2, CodexExtractionAuthorDraftV2 } from './codex-extraction-v2-contract'
import type { AIConfig } from '../../types'
import type { ExtractedCodexEntry } from '../../ai/adapters/structured-extract-adapter'
import { buildCodexExtractPromptFromRegisteredContextV2, parseCodexEntriesStrictV2, parseCodexAuthorDraftV2, readCodexExtractPromptTemplateSnapshotV1 } from '../../ai/adapters/structured-extract-adapter'
import { captureRegisteredContextSourceV2, assembleCapturedCodexContextV2 } from '../../registry/assemble-context'
import { readCodexExtractionBaselineV1, formatCodexExtractionBaselineV1, type CodexExtractionBaselineV1 } from '../../codex/extraction'
import { getAgentSkillV1 } from '../skill-registry'
import { createAgentSkillExecutionBindingV2 } from '../execution-binding'
import { freezeFormalAIEntryBindingV1, executeFrozenFormalAIEntryV1 } from '../formal-ai-entry'
import { createAgentRunV1 } from './event-store'
import { createContextManifestFromAssemblyV1 } from './context-manifest'
import { prepareCodexExtractionRequestV2 } from './codex-extraction-request'
import { buildCodexExtractionPlanV2, refineIncompleteCodexRangeV2 } from './codex-extraction-v2-plan'
import { bindPreparedRequestObserversV2, readPreparedRequestFrameV2, readPreparedNativeRequestRefV2, PreparedRequestStoppedV2,
  type PreparedAIRequestV2Handle, type PublicAIResponseV2, type ChatResult } from '../../ai/client'
import { estimateTokens } from '../../ai/context-budget'
import { createContextAccessPolicyForExecutionV2 } from '../../context-gateway/skill-policy'
import { createCodexExtractionRootV2, createCodexContextMaterialV2, CodexExtractionAdmissionUnavailableV2, assertCodexExtractionRootV2, assertRegisteredCodexCaptureV2, assertCodexExactObjectV2, assertCodexPublicResponseV2, CODEX_EXTRACTION_ENTRY_V2,
  type RegisteredCodexCaptureV2, type CodexExtractionCandidateV2 } from './codex-extraction-v2-contract'
import type { AgentRunEventTypeV1, AgentRunEventPayloadByTypeV1 } from '../../types/agent-run'
import { createAgentRunCheckpointV1 } from './checkpoint'
import { appendAgentRunEventV1, reviseAgentRunContractV1 } from './event-store'
import type { WorkspaceScope } from '../../types'
import { recordAgentRunArtifactV1, readAgentRunArtifactExactV1 } from '../../memory/artifact-store'
import { acknowledgeBoundCodexReceiptV1, readBoundCodexReceiptV1 } from '../../ai/codex-transport'
import { sha256Text } from '../../ai/chapter-memory/text-normalization'
import { canonicalStringify, hashCanonicalValue } from './hash'
import { readAgentRunV1, type AgentRunSnapshotV1 } from './event-store'
import { assertCodexExtractionPlanV2, CODEX_EXTRACTION_SKILL_V2, CODEX_EXTRACTION_STEP_V2,
  type CodexExactRefV2, type CodexExtractionFrameV2, type CodexExtractionPlanV2,
  type CodexExtractionResponseV2, type CodexExtractionRootV2 } from './codex-extraction-v2-contract'

/** One cursor for each explicit execution/recovery. A write failure seals it;
 * only a new authorized prefix read may begin a later local continuation. */
export class CodexEvidenceCursorStoppedV2 extends Error {
  constructor(readonly lastKnownCommittedSnapshot: AgentRunSnapshotV1, readonly cause: unknown) {
    super('本次证据保存已停止；请保留最后真实提交前缀，显式核对后恢复。')
    this.name = 'CodexEvidenceCursorStoppedV2'
  }
}
export class CodexExtractionEvidenceCursorV2 {
  private current: AgentRunSnapshotV1
  private stopped = false
  private busy = false
  private constructor(readonly scope: Readonly<WorkspaceScope>, snapshot: AgentRunSnapshotV1) { this.current = snapshot }
  static async open(scope: WorkspaceScope, runId: number): Promise<CodexExtractionEvidenceCursorV2> {
    const frozen = Object.freeze({ ...scope })
    const snapshot = await readAgentRunV1(frozen, runId)
    if (snapshot.run.workId !== frozen.workId || snapshot.run.productRuntimeSessionId != null) throw new Error('V2提取仅接受原真实Work所属Run。')
    const bindings = snapshot.contract.executionBindings ?? []
    if (snapshot.contract.version !== 3 || !bindings.some(binding => binding.skillId === CODEX_EXTRACTION_SKILL_V2)) throw new Error('当前Run没有冻结V2提取Skill。')
    return new CodexExtractionEvidenceCursorV2(frozen, snapshot)
  }
  get snapshot(): AgentRunSnapshotV1 { return structuredClone(this.current) }
  get isStopped(): boolean { return this.stopped }
  async record(input: {
    artifactKind: CodexExactRefV2['artifactKind']; content: string; stepId?: string; attempt?: number
  }): Promise<CodexExactRefV2> {
    if (this.stopped || this.busy) throw new CodexEvidenceCursorStoppedV2(this.snapshot, new Error('证据游标已停止或已有写入。'))
    this.busy = true
    try {
      const saved = await recordAgentRunArtifactV1({ ...input, scope: this.scope, runId: this.current.run.id,
        expectedLastSequence: this.current.projection.lastSequence })
      // Advance immediately, before any next write or callback. Never infer +1.
      this.current = saved.snapshot
      return { artifactKind: input.artifactKind, contentHash: saved.artifact.contentHash,
        byteLength: saved.artifact.byteLength,
        ...(input.stepId === undefined ? {} : { stepId: input.stepId, attempt: input.attempt }) }
    } catch (cause) {
      this.stopped = true
      throw new CodexEvidenceCursorStoppedV2(this.snapshot, cause)
    } finally { this.busy = false }
  }
  async write<T>(operation: (snapshot: AgentRunSnapshotV1) => Promise<{ snapshot: AgentRunSnapshotV1; value: T }>): Promise<T> {
    if (this.stopped || this.busy) throw new CodexEvidenceCursorStoppedV2(this.snapshot, new Error('证据游标已停止或已有写入。'))
    this.busy = true
    try {
      const saved = await operation(this.snapshot)
      if (saved.snapshot.run.id !== this.current.run.id || saved.snapshot.projection.lastSequence < this.current.projection.lastSequence) throw new Error('写入返回了不同Run或倒退前缀。')
      this.current = saved.snapshot
      return saved.value
    } catch (cause) {
      this.stopped = true
      throw new CodexEvidenceCursorStoppedV2(this.snapshot, cause)
    } finally { this.busy = false }
  }
  async append<T extends AgentRunEventTypeV1>(type: T, payload: AgentRunEventPayloadByTypeV1[T]): Promise<void> {
    await this.write(async snapshot => ({ value: undefined, snapshot: await appendAgentRunEventV1({ scope: this.scope,
      runId: snapshot.run.id, expectedLastSequence: snapshot.projection.lastSequence, type, payload }) }))
  }
  async checkpoint(resumePayload: unknown): Promise<void> {
    await this.write(async snapshot => {
      const saved = await createAgentRunCheckpointV1({ scope: this.scope, runId: snapshot.run.id,
        expectedLastSequence: snapshot.projection.lastSequence, resumePayload })
      return { snapshot: saved.snapshot, value: undefined }
    })
  }
  async revise(contract: unknown): Promise<void> {
    await this.write(async snapshot => ({ value: undefined, snapshot: await reviseAgentRunContractV1({ scope: this.scope,
      runId: snapshot.run.id, expectedLastSequence: snapshot.projection.lastSequence, contract }) }))
  }
  /** No adoption/terminal caller may silently overwrite this cursor with a
   * newer snapshot; it must reopen and revalidate its actual semantic prefix. */
  assertPrefix(snapshot: AgentRunSnapshotV1): void {
    if (this.stopped || snapshot.run.id !== this.current.run.id
      || snapshot.projection.lastSequence !== this.current.projection.lastSequence
      || snapshot.projection.generation !== this.current.projection.generation
      || snapshot.projection.contractHash !== this.current.projection.contractHash) throw new Error('证据游标或授权前缀已变化。')
  }
}

export interface CodexCallChainRefsV2 {
  root: CodexExactRefV2
  plan: CodexExactRefV2
  frame: CodexExactRefV2
  wire: CodexExactRefV2
  call: CodexExactRefV2
  response: CodexExactRefV2
}
interface CodexCallIdentityV2 {
  version: 'codex-extraction-call-v2'
  runId: number
  generation: number
  contractHash: string
  rootHash: string
  planHash: string
  frameHash: string
  callId: string
  contextManifestHash: string
  nativeRequest: CodexExtractionResponseV2['nativeRequest']
}
async function exactMember(snapshot: AgentRunSnapshotV1, ref: CodexExactRefV2): Promise<string> {
  assertCodexExactObjectV2(ref, ['artifactKind','contentHash','byteLength', ...(ref.stepId === undefined ? [] : ['stepId','attempt'])], 'exactRef')
  if (!Number.isSafeInteger(ref.byteLength) || ref.byteLength < 0
    || ref.stepId !== undefined && (typeof ref.stepId !== 'string' || !Number.isSafeInteger(ref.attempt) || ref.attempt! < 1)) throw new Error('准确工件引用字段无效。')
  const member = snapshot.events.find(event => event.type === 'evidence.artifact.recorded'
    && event.payload.artifactKind === ref.artifactKind && event.payload.contentHash === ref.contentHash
    && event.payload.byteLength === ref.byteLength && event.payload.stepId === ref.stepId && event.payload.attempt === ref.attempt)
  if (!member) throw new Error('准确工件不是同一授权Run的已提交证据。')
  const text = await readAgentRunArtifactExactV1({ projectId: snapshot.run.projectId,
    artifactKind: ref.artifactKind, contentHash: ref.contentHash })
  if (new TextEncoder().encode(text).byteLength !== ref.byteLength || await (Dexie.currentTransaction ? Dexie.waitFor(sha256Text(text)) : sha256Text(text)) !== ref.contentHash) throw new Error('准确工件正文或字节数不一致。')
  return text
}
/** Read-only proof. No ack, pending write, settlement, checkpoint or inference.
 * Hash availability in the workspace store alone is never sufficient. */
export async function inspectCodexNativeHandoffV2(input: {
  scope: WorkspaceScope; runId: number; refs: CodexCallChainRefsV2
}) {
  const scope = Object.freeze({ ...input.scope })
  const snapshot = await readAgentRunV1(scope, input.runId)
  if (snapshot.run.workId !== scope.workId || snapshot.run.productRuntimeSessionId != null
    || snapshot.contract.version !== 3
    || !snapshot.contract.executionBindings.some(binding => binding.skillId === CODEX_EXTRACTION_SKILL_V2)
    || ['cancelled','failed','completed'].includes(snapshot.projection.state)) throw new Error('当前Run不允许V2原答交接。')
  if (input.refs.root.artifactKind !== 'source-snapshot' || input.refs.plan.artifactKind !== 'tool-result'
    || input.refs.frame.artifactKind !== 'rendered-request' || input.refs.wire.artifactKind !== 'rendered-request' || input.refs.call.artifactKind !== 'tool-result'
    || input.refs.response.artifactKind !== 'raw-response') throw new Error('原答交接工件种类不匹配。')
  const root = { ...JSON.parse(await exactMember(snapshot, input.refs.root)), rootHash: input.refs.root.contentHash } as CodexExtractionRootV2
  const plan = { ...JSON.parse(await exactMember(snapshot, input.refs.plan)), planHash: input.refs.plan.contentHash } as CodexExtractionPlanV2
  const frame = { ...JSON.parse(await exactMember(snapshot, input.refs.frame)), frameHash: input.refs.frame.contentHash } as CodexExtractionFrameV2
  const wire = JSON.parse(await exactMember(snapshot, input.refs.wire)) as { version: string; messages: unknown; options: unknown; wireBody: string; wireBodyHash: string }
  const call = JSON.parse(await exactMember(snapshot, input.refs.call)) as CodexCallIdentityV2
  const response = JSON.parse(await exactMember(snapshot, input.refs.response)) as CodexExtractionResponseV2
  assertCodexPublicResponseV2(response.response)
  const { rootHash, ...rootBody } = root
  const { frameHash, ...frameBody } = frame
  await assertCodexExtractionPlanV2(plan)
  if (root.version !== 'codex-extraction-root-v2' || root.portable !== false || root.lengthPlan !== null
    || canonicalStringify(root.scope) !== canonicalStringify(scope) || await hashCanonicalValue(rootBody) !== rootHash
    || plan.rootHash !== rootHash || frame.rootHash !== rootHash || await hashCanonicalValue(frameBody) !== frameHash
    || !plan.frames.some(item => item.frameHash === frameHash)
    || wire.version !== 'prepared-ai-request-frame-v2' || await hashCanonicalValue(wire) !== frame.wireFrameHash
    || typeof wire.wireBody !== 'string' || await sha256Text(wire.wireBody) !== frame.request.wireBodyHash
    || wire.wireBodyHash !== frame.request.wireBodyHash
    || await hashCanonicalValue(wire.messages) !== frame.request.messagesHash || await hashCanonicalValue(wire.options) !== frame.request.optionsHash
    || call.version !== 'codex-extraction-call-v2' || response.version !== 'codex-extraction-response-v2'
    || !response.nativeRequest || response.runId !== snapshot.run.id || call.runId !== snapshot.run.id
    || response.generation !== snapshot.projection.generation || call.generation !== response.generation
    || response.contractHash !== snapshot.projection.contractHash || call.contractHash !== response.contractHash
    || response.rootHash !== rootHash || call.rootHash !== rootHash || response.planHash !== plan.planHash
    || call.planHash !== plan.planHash || response.frameHash !== frameHash || call.frameHash !== frameHash
    || call.callId !== response.callId || !/^[a-f0-9]{64}$/.test(call.callId)
    || canonicalStringify(call.nativeRequest) !== canonicalStringify(response.nativeRequest)
    || typeof response.response.text !== 'string'
    || !['complete','incomplete'].includes(response.response.completion)
    || await sha256Text(response.response.text) !== response.rawTextHash
    || frame.request.capacity.routeHash !== frame.request.routeHash
    || frame.request.wireBodyHash !== response.nativeRequest.requestHash) throw new Error('已提交V2原答的owner、合同或原call身份无法完整证明。')
  const requested = snapshot.events.filter(event => event.type === 'model.requested' && event.payload.bindingHash === call.callId
    && event.generation === call.generation && event.contractHash === call.contractHash)
  const responded = snapshot.events.filter(event => event.type === 'model.responded' && event.payload.outputHash === input.refs.response.contentHash
    && event.generation === call.generation && event.contractHash === call.contractHash)
  const binding = snapshot.contract.executionBindings.find(item => item.skillId === CODEX_EXTRACTION_SKILL_V2)
  if (requested.length !== 1 || responded.length !== 1 || snapshot.contract.budget.allocation?.planHash !== plan.planHash
    || binding?.taskRequest?.planHash !== plan.planHash || binding.taskRequest.materialAllocationHash !== frame.materialAllocationHash) throw new Error('交接缺少当前计划绑定或真实唯一派发/响应事件。')
  const step = snapshot.projection.steps[CODEX_EXTRACTION_STEP_V2]
  if (!step || input.refs.call.stepId !== CODEX_EXTRACTION_STEP_V2 || input.refs.response.stepId !== CODEX_EXTRACTION_STEP_V2
    || input.refs.call.attempt !== step.attempt || input.refs.response.attempt !== step.attempt) throw new Error('原答不是当前真实调用代次。')
  const nativeReceipt = await readBoundCodexReceiptV1(response.nativeRequest)
  if (nativeReceipt.status !== 'completed' || nativeReceipt.text !== response.response.text) throw new Error('原运输回执与已保存可见原答不一致。')
  const actual = await readAgentRunV1(scope, input.runId)
  if (actual.projection.lastSequence !== snapshot.projection.lastSequence || actual.projection.contractHash !== snapshot.projection.contractHash) throw new Error('只读回执核对期间Run已推进，不能沿旧前缀交接。')
  return { snapshot, root, plan, frame, call, response, nativeReceipt }
}
export class CodexNativeHandoffStoppedV2 extends Error {
  constructor(readonly lastKnownCommittedSnapshot: AgentRunSnapshotV1,
    readonly ackFailure: unknown, readonly pendingFailure: unknown) {
    super('原答已提交；原生回执交接与pending证据保存均失败。保留最后已知提交前缀，显式回读后恢复，不重新生成。')
    this.name = 'CodexNativeHandoffStoppedV2'
  }
}
/** Explicit authorized local continuation only. Native primitive cannot prove
 * owner storage; the product verifies committed exact response membership first. */
export async function handoffCodexNativeResponseV2(input: {
  cursor: CodexExtractionEvidenceCursorV2; refs: CodexCallChainRefsV2
}): Promise<{ acknowledged: boolean; pendingRef?: CodexExactRefV2 }> {
  const proof = await inspectCodexNativeHandoffV2({ scope: input.cursor.scope,
    runId: input.cursor.snapshot.run.id, refs: input.refs })
  input.cursor.assertPrefix(proof.snapshot)
  if (proof.nativeReceipt.ownerAcknowledgedAt !== undefined) return { acknowledged: true }
  // Unknown ack errors do not prove the server remained unacknowledged.
  // The retained exact raw identity and real committed cursor remain available.
  try {
    await acknowledgeBoundCodexReceiptV1({ request: proof.response.nativeRequest!,
      rawResponseHash: proof.response.rawTextHash, confirmation: 'owner-record-saved-v1' })
    return { acknowledged: true }
  } catch (ackFailure) {
    try {
      const pendingRef = await input.cursor.record({ artifactKind: 'tool-result',
        stepId: input.refs.response.stepId, attempt: input.refs.response.attempt,
        content: canonicalStringify({ version: 'codex-native-handoff-pending-v2',
          callId: proof.response.callId, responseRef: input.refs.response,
          nativeRequest: proof.response.nativeRequest, rawTextHash: proof.response.rawTextHash,
          reason: 'owner-ack-not-confirmed' }) })
      return { acknowledged: false, pendingRef }
    } catch (pendingFailure) {
      // No automatic reread, invented cursor+1, duplicate raw/settlement or ack.
      throw new CodexNativeHandoffStoppedV2(input.cursor.snapshot, ackFailure, pendingFailure)
    }
  }
}

/** Pure author review compilation. M remains the projection candidate; D and R
 * are distinct hashes. Producer identity is filled only after R is frozen. */
export async function compileCodexExtractionReviewV2(input: {
  root: CodexExtractionRootV2
  candidate: import('./codex-extraction-v2-contract').CodexExtractionCandidateV2
  candidateRef: CodexExactRefV2
  entries: import('../../ai/adapters/structured-extract-adapter').ExtractedCodexEntry[]
  selectedIndexes: readonly number[]
  sourceText: string
  baseline: import('../../codex/extraction').CodexExtractionBaselineV1
}) {
  const frozen = structuredClone(input)
  const { parseCodexAuthorDraftV2 } = await import('../../ai/adapters/structured-extract-adapter')
  const { candidateHash, ...modelBody } = frozen.candidate
  if (frozen.candidateRef.contentHash !== candidateHash || await hashCanonicalValue(modelBody) !== candidateHash || frozen.candidate.rootHash !== frozen.root.rootHash
    || await hashCanonicalValue(frozen.baseline) !== frozen.root.baselineStateHash
    || frozen.entries.length !== frozen.candidate.entries.length) throw new Error('作者稿与原模型/分类基线不匹配。')
  const entries = parseCodexAuthorDraftV2(JSON.stringify(frozen.entries), frozen.baseline.category.fields,
    { sourceText: frozen.sourceText, supplementTags: frozen.root.supplementTags })
  const indexes = [...new Set(frozen.selectedIndexes)].sort((left, right) => left - right)
  if (indexes.length !== frozen.selectedIndexes.length || (entries.length && !indexes.length)
    || indexes.some(index => !Number.isSafeInteger(index) || index < 0 || index >= entries.length)) throw new Error('作者选择不是准确有效的候选集合。')
  const existing = new Set(frozen.baseline.entries.map(entry => entry.name.trim().toLocaleLowerCase()))
  const selected = new Set<string>()
  for (const index of indexes) {
    const name = entries[index].name.trim().toLocaleLowerCase()
    if (existing.has(name) || selected.has(name)) throw new Error('作者稿与既有词条或所选稿件重名，禁止覆盖已有Canon。')
    selected.add(name)
  }
  const allowed = ['name','icon','summary','description','fields','tags','importance','evidenceQuotes'] as const
  const editPaths: string[] = []
  entries.forEach((entry, index) => {
    for (const key of allowed) if (canonicalStringify(entry[key]) !== canonicalStringify(frozen.candidate.entries[index][key])) editPaths.push(`entries.${index}.${key}`)
  })
  const draftBody = { version: 'codex-extraction-author-draft-v2' as const, runId: frozen.candidate.runId,
    modelCandidateHash: candidateHash, modelCandidateRef: frozen.candidateRef, entries, editPaths }
  const draft = { ...draftBody, draftHash: await hashCanonicalValue(draftBody) }
  const rawSourceHash = await hashCanonicalValue(frozen.sourceText)
  const compiled = indexes.map((index, order) => {
    const entry = entries[index], edited = editPaths.some(path => path.startsWith(`entries.${index}.`))
    return { categoryId: frozen.root.categoryId, name: entry.name, icon: entry.icon || frozen.baseline.category.icon,
      summary: entry.summary, description: entry.description, fields: JSON.stringify(entry.fields), refs: '{}', tags: JSON.stringify(entry.tags),
      importance: entry.importance, order: frozen.baseline.entries.length + order, worldGroupId: frozen.root.worldGroupId,
      origin: edited ? 'manual' : 'verbatim-extraction', sourceEvidenceQuotes: JSON.stringify(entry.evidenceQuotes ?? []),
      sourceContentHash: rawSourceHash, producerRunId: frozen.candidate.runId }
  })
  const reviewBody = { version: 'codex-extraction-reviewed-v2' as const, runId: frozen.candidate.runId,
    modelCandidateHash: candidateHash, modelCandidateRef: frozen.candidateRef, draftHash: draft.draftHash,
    selectedIndexes: indexes, compiledContentHash: await hashCanonicalValue(compiled) }
  const review = { ...reviewBody, confirmedCandidateHash: await hashCanonicalValue(reviewBody) }
  return { draft, review, formalItems: compiled.map(item => ({ ...item, producerCandidateHash: review.confirmedCandidateHash })) }
}

interface RuntimeMaterialsV2 {
  root: CodexExtractionRootV2
  source: RegisteredCodexCaptureV2
  baseline: RegisteredCodexCaptureV2
  baselineState: CodexExtractionBaselineV1
}
interface RuntimeCompletedV2 {
  frame: CodexExtractionFrameV2
  resultRef: CodexExactRefV2
  entries: ExtractedCodexEntry[]
}
interface RuntimeStateV2 {
  version: 'codex-extraction-state-v2'
  rootRef: CodexExactRefV2
  sourceRef: CodexExactRefV2
  baselineRef: CodexExactRefV2
  baselineStateRef: CodexExactRefV2
  materialRef: CodexExactRefV2
  planRef: CodexExactRefV2
  frameRefs: Array<{ frameHash: string; frame: CodexExactRefV2; wire: CodexExactRefV2 }>
  resultRefs: CodexExactRefV2[]
  callRefs: CodexExactRefV2[]
  candidateRef?: CodexExactRefV2
}
async function parseCodexResponseForRootV2(input: {
  snapshot: AgentRunSnapshotV1; materials: RuntimeMaterialsV2
  frame: Pick<CodexExtractionFrameV2, 'startChar' | 'endChar' | 'materialAllocationHash' | 'wireFrameHash' | 'request'>
  raw: string; previous: ReadonlyMap<string, readonly ExtractedCodexEntry[]>
}): Promise<ExtractedCodexEntry[]> {
  const { materials, frame, snapshot } = input
  const verifiedProgressNames = materials.root.productionPolicy ? await readSentCodexProgressNamesV1({
    runId: snapshot.run.id, rootHash: materials.root.rootHash, scope: materials.root.scope, sourceText: materials.source.rawText,
    frame, previous: input.previous,
    read: async (kind, hash) => JSON.parse(await exactMember(snapshot, refFromSnapshotV2(snapshot, kind, hash))) as Record<string, unknown>,
  }) : undefined
  return parseCodexEntriesStrictV2(input.raw, materials.baselineState.category.fields, {
    operation: 'extract', sourceText: materials.source.rawText.slice(frame.startChar, frame.endChar),
    supplementTags: materials.root.supplementTags, ...(verifiedProgressNames ? { verifiedProgressNames } : {}),
  })
}
function projectCodexFragmentsV2(materials: RuntimeMaterialsV2, fragments: readonly ExtractedCodexEntry[]): ExtractedCodexEntry[] {
  return materials.root.productionPolicy ? consolidateCodexDraftsV1(fragments, materials.baselineState.entries.map(entry => entry.name), materials.baselineState.category.fields) : [...fragments]
}

async function captureMaterialsV2(scope: WorkspaceScope, request: {
  categoryId: number; worldGroupId: number | null; sourceText: string; supplementTags: boolean
}): Promise<RuntimeMaterialsV2> {
  const frozenScope = { ...scope }, frozenRequest = structuredClone(request)
  const context = { projectId: frozenScope.projectId, scope: frozenScope, worldGroupId: frozenRequest.worldGroupId,
    codexCategoryId: frozenRequest.categoryId, manualSourceText: frozenRequest.sourceText }
  const source = await captureRegisteredContextSourceV2({ sourceKey: 'manualText', context })
  const baseline = await captureRegisteredContextSourceV2({ sourceKey: 'codexExtractionBaseline', context })
  const baselineState = await readCodexExtractionBaselineV1({ scope: frozenScope, categoryId: frozenRequest.categoryId, worldGroupId: frozenRequest.worldGroupId })
  if (formatCodexExtractionBaselineV1(baselineState) !== baseline.rawText) throw new Error('捕获期间分类基线发生变化。')
  const root = await createCodexExtractionRootV2({ source, baseline,
    baselineStateHash: await hashCanonicalValue(baselineState),
    promptTemplateHash: await hashCanonicalValue({ protocol: 'codex-extract-v5', template: readCodexExtractPromptTemplateSnapshotV1() }),
    supplementTags: frozenRequest.supplementTags, newProductionPolicy: true })
  return { root, source, baseline, baselineState }
}
async function assertFreshMaterialsV2(materials: RuntimeMaterialsV2, requireCurrentTemplate = true): Promise<void> {
  await assertCodexExtractionRootV2(materials.root)
  if (materials.root.productionPolicy) assertCodexProductionPolicyV1(materials.root.productionPolicy, materials.source.rawText)
  const current = await readCodexExtractionBaselineV1({ scope: materials.root.scope,
    categoryId: materials.root.categoryId, worldGroupId: materials.root.worldGroupId })
  if (await hashCanonicalValue(current) !== materials.root.baselineStateHash
    || requireCurrentTemplate && await hashCanonicalValue({ protocol: materials.root.productionPolicy ? 'codex-extract-v5' : 'codex-extract-v4', template: readCodexExtractPromptTemplateSnapshotV1() }) !== materials.root.promptTemplateHash) throw new Error('来源分类或模板已变化；保留已有原答，不继续发送。')
}
async function prepareFrontierV2(input: {
  materials: RuntimeMaterialsV2; config: AIConfig; pending: Array<{ startChar: number; endChar: number }>
  completed: RuntimeCompletedV2[]; previousPlanHash: string | null; predecessorHashes: string[]; runId?: number
}) {
  const { materials } = input
  await assertFreshMaterialsV2(materials)
  const progress = input.completed.length && input.runId ? await captureRegisteredContextSourceV2({ sourceKey: 'codexExtractionProgressV2',
    context: { projectId: materials.root.scope.projectId, scope: materials.root.scope, worldGroupId: materials.root.worldGroupId,
      codexCategoryId: materials.root.categoryId, codexExtractionProgressV2: { runId: input.runId, rootHash: materials.root.rootHash,
        verifiedResultHashes: input.completed.map(row => row.resultRef.contentHash) } } }) : undefined
  const material = await createCodexContextMaterialV2({ ...materials, progress,
    inputTokenForecast: estimateTokens(materials.source.rawText) + estimateTokens(materials.baseline.rawText) + estimateTokens(progress?.rawText ?? '') })
  await createContextAccessPolicyForExecutionV2(getAgentSkillV1(CODEX_EXTRACTION_SKILL_V2), material)
  const request = await prepareCodexExtractionRequestV2({ config: input.config, fields: materials.baselineState.category.fields,
    supplementTags: materials.root.supplementTags, material, explicitConstraints: null })
  const prepared: Array<{ frame: CodexExtractionFrameV2; handle: PreparedAIRequestV2Handle }> = []
  for (const range of input.pending) {
    const local = await buildCodexExtractionPlanV2({ root: materials.root, sourceText: materials.source.rawText.slice(range.startChar, range.endChar), sourceOffset: range.startChar,
      material, assessmentContext: request.assessmentContext, options: request.options,
      render: chunk => buildCodexExtractPromptFromRegisteredContextV2({ sourceText: chunk.text, baselineContext: materials.baseline.rawText,
        categoryBuiltInKey: materials.baselineState.category.builtInKey, supplementTags: materials.root.supplementTags, productionPolicy: !!materials.root.productionPolicy,
        ...(progress ? { progressContext: progress.rawText } : {}) }),
      prepareRange: messages => request.prepare(messages) })
    for (const row of local.prepared) {
      const { frameHash: _oldHash, ...body } = row.frame
      const globalBody = { ...body, startChar: body.startChar + range.startChar, endChar: body.endChar + range.startChar }
      prepared.push({ frame: { ...globalBody, frameHash: await hashCanonicalValue(globalBody) }, handle: row.handle })
    }
  }
  const frames = [...input.completed.map(row => row.frame), ...prepared.map(row => row.frame)].sort((left, right) => left.startChar - right.startChar)
  const body = { version: 'codex-extraction-plan-v2' as const, portable: false as const, rootHash: materials.root.rootHash,
    sourceUTF16Length: materials.source.rawText.length, frames, previousPlanHash: input.previousPlanHash,
    predecessorResultHashes: [...input.predecessorHashes], carriedFrameHashes: input.completed.map(row => row.frame.frameHash),
    forecast: { modelCalls: prepared.length, inputTokens: prepared.reduce((sum, row) => sum + row.frame.request.inputMeasurement.tokens, 0),
      outputTokens: prepared.reduce((sum, row) => sum + row.frame.request.forecastOutputTokens, 0) } }
  const plan = { ...body, planHash: await hashCanonicalValue(body) }
  await assertCodexExtractionPlanV2(plan)
  return { material, progress, request, prepared, plan }
}
async function contractForFrontierV2(materials: RuntimeMaterialsV2, frontier: Pick<RuntimeFrontierV2, 'plan' | 'progress' | 'material'>) {
  const skill = getAgentSkillV1(CODEX_EXTRACTION_SKILL_V2, 'world-origin')
  const binding = await createAgentSkillExecutionBindingV2(skill, {
    taskRequest: { version: 'task-request-binding-v2', planHash: frontier.plan.planHash, materialAllocationHash: frontier.material.allocationHash },
    outputForecastTokens: frontier.plan.forecast.outputTokens,
    optionalContextActivations: frontier.progress ? [{ sourceKey: 'codexExtractionProgressV2', reasonCode: 'explicit-runtime-boundary', boundaryHash: frontier.progress.captureHash }] : [],
    writeTargets: skill.writeTargets.map(target => ({ table: target.table, fields: target.fields, mode: 'author-confirmed' })) })
  return { version: 3 as const, executionBoundary: 'formal' as const,
    objective: `Codex V2 原文提取 category:${materials.root.categoryId}`,
    workflowKind: 'long-running-resumable' as const,
    scope: { projectId: materials.root.scope.projectId, worldGroupId: materials.root.worldGroupId },
    permissions: { contextSourceKeys: binding.contextSourceKeys, writeTargets: binding.writeTargets },
    runtimeBindingHash: await hashCanonicalValue({ rootHash: materials.root.rootHash, planHash: frontier.plan.planHash, materialAllocationHash: frontier.material.allocationHash }),
    executionBindings: [{ stepId: CODEX_EXTRACTION_STEP_V2, ...binding, formalEntry: await freezeFormalAIEntryBindingV1(CODEX_EXTRACTION_ENTRY_V2) }],
    budget: { allocation: { version: 'task-budget-allocation-v2' as const, mode: 'adaptive-plan' as const, planHash: frontier.plan.planHash,
      inputBasis: 'prepared-complete-request-v2', outputBasis: 'source-token-estimate-v1', modelCallsBasis: 'remaining-exact-frontier-v2', hardConstraints: null },
      maxModelCalls: frontier.plan.forecast.modelCalls, maxToolCalls: 0, maxInputTokens: frontier.plan.forecast.inputTokens,
      maxOutputTokens: frontier.plan.forecast.outputTokens, maxAttemptsPerStep: 1, maxProtocolErrors: 0 },
    acceptance: [{ id: 'codex.v2.candidate', kind: 'output-present' as const, required: true },
      { id: 'codex.v2.author', kind: 'author-confirmed' as const, required: true },
      { id: 'codex.v2.post-state', kind: 'post-state-matches' as const, required: true }],
    verificationPlan: [{ id: 'codex.v2.terminal', kind: 'terminal' as const, verifier: 'codex-extraction-terminal-v2',
      criterionIds: ['codex.v2.candidate','codex.v2.author','codex.v2.post-state'] }],
    failurePolicy: { onProtocolError: 'fail' as const, onVerificationFailure: 'fail' as const, onStaleInput: 'pause-for-author' as const } }
}
async function saveFrontierV2(cursor: CodexExtractionEvidenceCursorV2, frontier: RuntimeFrontierV2) {
  const frameRefs: RuntimeStateV2['frameRefs'] = []
  const { allocationHash: _allocation, ...materialBody } = frontier.material
  const materialRef = await cursor.record({ artifactKind: 'tool-result', content: canonicalStringify(materialBody) })
  if (frontier.progress) {
    const { captureHash: _capture, ...progressBody } = frontier.progress
    await cursor.record({ artifactKind: 'source-snapshot', content: canonicalStringify(progressBody) })
  }
  for (const row of frontier.prepared) {
    const { frameHash: _frame, ...frameBody } = row.frame
    const frame = await cursor.record({ artifactKind: 'rendered-request', content: canonicalStringify(frameBody) })
    const wire = await cursor.record({ artifactKind: 'rendered-request', content: canonicalStringify(readPreparedRequestFrameV2(row.handle)) })
    frameRefs.push({ frameHash: row.frame.frameHash, frame, wire })
  }
  const { planHash: _plan, ...planBody } = frontier.plan
  const planRef = await cursor.record({ artifactKind: 'tool-result', content: canonicalStringify(planBody) })
  return { materialRef, planRef, frameRefs }
}

interface CodexExtractionGenerationInputV2 {
  scope: WorkspaceScope
  request: { categoryId: number; worldGroupId: number | null; sourceText: string; supplementTags: boolean }
  aiConfig: AIConfig
  signal?: AbortSignal
}

/** Same-origin tabs must share the target admission, not merely a Panel flag.
 * Admission covers every await through the first durable checkpoint and
 * step.started. The stored active Run then owns dispatch; a hanging model POST
 * must not hold admission after another page explicitly abandons that Run. */
export async function generateCodexExtractionCandidateV2(input: CodexExtractionGenerationInputV2): Promise<{
  snapshot: AgentRunSnapshotV1; candidate: CodexExtractionCandidateV2
}> {
  input.signal?.throwIfAborted()
  if (typeof navigator === 'undefined' || !navigator.locks?.request) throw new CodexExtractionAdmissionUnavailableV2('当前浏览器无法确认跨页面执行占用；输入已保留，不创建提取运行，请使用支持安全执行的浏览器。')
  const frozen = { ...input, scope: { ...input.scope }, request: structuredClone(input.request), aiConfig: structuredClone(input.aiConfig) }
  const scope = frozen.scope, target = frozen.request
  const key = `storyforge:codex-extraction-start-v2:${db.name}:${scope.projectId}:${scope.worldId}:${scope.workId}:${target.categoryId}:${target.worldGroupId ?? 'null'}`
  const admitted = await navigator.locks.request(key, { ifAvailable: true, mode: 'exclusive' }, lock => {
    if (!lock) throw new CodexExtractionAdmissionUnavailableV2('另一页面正在开始同一目标的提取；输入已保留，不重复创建或发送。')
    frozen.signal?.throwIfAborted()
    return admitCodexExtractionV2(frozen)
  })
  return continueCodexExtractionV2(admitted)
}

async function admitCodexExtractionV2(input: CodexExtractionGenerationInputV2): Promise<CodexExtractionContinuationInputV2> {
  const scope = Object.freeze({ ...input.scope }), request = structuredClone(input.request), config = structuredClone(input.aiConfig)
  input.signal?.throwIfAborted()
  await assertCodexExtractionStartTargetUnblockedV2(scope, request)
  const materials = await captureMaterialsV2(scope, request)
  const frontier = await prepareFrontierV2({ materials, config, pending: [{ startChar: 0, endChar: materials.source.rawText.length }],
    completed: [], previousPlanHash: null, predecessorHashes: [] })
  input.signal?.throwIfAborted()
  const contract = await contractForFrontierV2(materials, frontier)
  input.signal?.throwIfAborted()
  const activeProject = await db.projects.get(scope.projectId)
  input.signal?.throwIfAborted()
  if (activeProject?.activeWorldId !== scope.worldId || activeProject.activeWorkId !== scope.workId) throw new Error('原作品已切换；不创建提取运行。')
  const created = await createAgentRunV1({ scope, worldGroupId: request.worldGroupId, contract })
  const cursor = await CodexExtractionEvidenceCursorV2.open(scope, created.run.id)
  const { rootHash: _rootHash, ...rootBody } = materials.root
  const { captureHash: _sourceHash, ...sourceBody } = materials.source
  const { captureHash: _baselineHash, ...baselineBody } = materials.baseline
  const rootRef = await cursor.record({ artifactKind: 'source-snapshot', content: canonicalStringify(rootBody) })
  const sourceRef = await cursor.record({ artifactKind: 'source-snapshot', content: canonicalStringify(sourceBody) })
  const baselineRef = await cursor.record({ artifactKind: 'source-snapshot', content: canonicalStringify(baselineBody) })
  const baselineStateRef = await cursor.record({ artifactKind: 'source-snapshot', content: canonicalStringify(materials.baselineState) })
  const saved = await saveFrontierV2(cursor, frontier)
  const state: RuntimeStateV2 = { version: 'codex-extraction-state-v2', rootRef, sourceRef, baselineRef, baselineStateRef,
    ...saved, resultRefs: [], callRefs: [] }
  await cursor.checkpoint(state)
  await cursor.append('step.scheduled', { stepId: CODEX_EXTRACTION_STEP_V2 })
  await cursor.append('step.started', { stepId: CODEX_EXTRACTION_STEP_V2, attempt: 1 })
  return { cursor, materials, config, state, completed: [], predecessorHashes: [], frontier, signal: input.signal }
}

type RuntimeFrontierV2 = Omit<Awaited<ReturnType<typeof prepareFrontierV2>>, 'request'> & {
  request?: Awaited<ReturnType<typeof prepareCodexExtractionRequestV2>>
}
interface CodexExtractionContinuationInputV2 {
  cursor: CodexExtractionEvidenceCursorV2; materials: RuntimeMaterialsV2; config?: AIConfig;
  state: RuntimeStateV2; completed: RuntimeCompletedV2[]; predecessorHashes: string[];
  frontier: RuntimeFrontierV2; signal?: AbortSignal
}
async function continueCodexExtractionV2(input: CodexExtractionContinuationInputV2): Promise<{ snapshot: AgentRunSnapshotV1; candidate: CodexExtractionCandidateV2 }> {
  const { cursor, materials, config, state, completed, predecessorHashes } = input
  const scope = { ...materials.root.scope }, request = { worldGroupId: materials.root.worldGroupId, supplementTags: materials.root.supplementTags }
  let frontier = input.frontier
  while (frontier.prepared.length) {
    if (input.signal?.aborted) { await cursor.append('run.cancelled', { reason: 'author-stopped-codex-extraction-v2' }); input.signal.throwIfAborted() }
    if (!frontier.request) throw new Error('缺少未派发范围的真实准备状态。')
    const frozenRequest = frontier.request
    const selected = frontier.prepared[0], frame = selected.frame
    const stored = state.frameRefs.find(row => row.frameHash === frame.frameHash)
    if (!stored) throw new Error('缺少当前准确frame原件。')
    const callId = await hashCanonicalValue({ rootHash: materials.root.rootHash, frameHash: frame.frameHash })
    const nativeRequest = readPreparedNativeRequestRefV2(selected.handle)
    const wire = readPreparedRequestFrameV2(selected.handle)
    let callRef: CodexExactRefV2 | undefined, responseRef: CodexExactRefV2 | undefined
    let observation: PublicAIResponseV2 | undefined, deltaHead: string | null = null
    const result: ChatResult = { ...(nativeRequest ? { onCodexRequestPrepared: async actual => {
      if (canonicalStringify(actual) !== canonicalStringify(nativeRequest)) throw new Error('原生request ref与冻结frame不一致。')
    } } : {}) }
    const bound = bindPreparedRequestObserversV2(selected.handle, {
      beforeDispatch: async () => {
        await assertFreshMaterialsV2(materials)
        input.signal?.throwIfAborted()
        if (materials.root.productionPolicy) {
          const project = await db.projects.get(scope.projectId)
          if (project?.activeWorldId !== scope.worldId || project.activeWorkId !== scope.workId) throw new Error('原作品已切换；不派发当前提取请求。')
          input.signal?.throwIfAborted()
        }
        frozenRequest.assertCurrent()
        const current = await readAgentRunV1(scope, cursor.snapshot.run.id)
        cursor.assertPrefix(current)
        if (current.projection.state !== 'running') throw new Error('当前Run不在可派发状态。')
        if (frontier.progress) {
          const originalProgress = JSON.parse(frontier.progress.rawText) as Record<string, unknown>
          if (originalProgress.runId !== current.run.id || originalProgress.rootHash !== materials.root.rootHash
            || canonicalStringify(originalProgress.scope) !== canonicalStringify(scope)) throw new Error('后继材料不能跨Run借用相同名称文本。')
          const fresh = await captureRegisteredContextSourceV2({ sourceKey: 'codexExtractionProgressV2', context: {
            projectId: scope.projectId, scope, worldGroupId: request.worldGroupId, codexCategoryId: materials.root.categoryId,
            codexExtractionProgressV2: { runId: current.run.id, rootHash: materials.root.rootHash,
              verifiedResultHashes: completed.map(row => row.resultRef.contentHash) } } })
          const actualProgress = JSON.parse(fresh.rawText) as Record<string, unknown>
          if (canonicalStringify(actualProgress.results) !== canonicalStringify(originalProgress.results)
            || canonicalStringify(actualProgress.names) !== canonicalStringify(originalProgress.names)) throw new Error('原有序草稿引用已变化，未派发。')
        }

        const assembled = await assembleCapturedCodexContextV2({ source: materials.source, baseline: materials.baseline,
          progress: frontier.progress, startChar: frame.startChar, endChar: frame.endChar })
        const manifest = await createContextManifestFromAssemblyV1({ runId: current.run.id, stepId: CODEX_EXTRACTION_STEP_V2,
          attempt: 1, projectId: scope.projectId, worldGroupId: request.worldGroupId,
          declaredSourceKeys: assembled.included, assembled, readerVersion: 'registered-host-full-v2' })
        await cursor.record({ artifactKind: 'context-manifest', content: canonicalStringify(manifest), stepId: CODEX_EXTRACTION_STEP_V2, attempt: 1 })
        await cursor.append('context.assembled', { stepId: CODEX_EXTRACTION_STEP_V2, attempt: 1, manifestHash: manifest.manifestHash })
        const snapshot = cursor.snapshot
        const call: CodexCallIdentityV2 = { version: 'codex-extraction-call-v2', runId: snapshot.run.id,
          generation: snapshot.projection.generation, contractHash: snapshot.projection.contractHash,
          rootHash: materials.root.rootHash, planHash: frontier.plan.planHash, frameHash: frame.frameHash, callId,
          contextManifestHash: manifest.manifestHash, nativeRequest }
        callRef = await cursor.record({ artifactKind: 'tool-result', content: canonicalStringify(call), stepId: CODEX_EXTRACTION_STEP_V2, attempt: 1 })
        state.callRefs.push(callRef)
        await cursor.checkpoint(state)
        await cursor.append('model.requested', { stepId: CODEX_EXTRACTION_STEP_V2, attempt: 1, bindingHash: callId })
        if (materials.root.productionPolicy) {
          // Persistence above yields to author changes. Recheck the existing
          // source, owner and Run gates after that specific await window.
          await assertFreshMaterialsV2(materials)
          const project = await db.projects.get(scope.projectId)
          if (project?.activeWorldId !== scope.worldId || project.activeWorkId !== scope.workId) throw new Error('原作品已切换；不派发当前提取请求。')
          const latest = await readAgentRunV1(scope, cursor.snapshot.run.id)
          cursor.assertPrefix(latest)
          if (latest.projection.state !== 'running') throw new Error('当前Run不在可派发状态。')
          input.signal?.throwIfAborted()
          frozenRequest.assertCurrent()
        }
      },
      onPublicDelta: async delta => {
        const ref = await cursor.record({ artifactKind: 'raw-response', stepId: CODEX_EXTRACTION_STEP_V2, attempt: 1,
          content: canonicalStringify({ version: 'codex-visible-delta-v2', callId, previousDeltaHash: deltaHead, text: delta }) })
        deltaHead = ref.contentHash
      },
      onPublicResponse: async response => {
        if (!callRef || responseRef) throw new Error('同一physical call不能重复保存原答。')
        observation = structuredClone(response)
        const snapshot = cursor.snapshot
        const envelope: CodexExtractionResponseV2 = { version: 'codex-extraction-response-v2', runId: snapshot.run.id,
          generation: snapshot.projection.generation, contractHash: snapshot.projection.contractHash,
          rootHash: materials.root.rootHash, planHash: frontier.plan.planHash, frameHash: frame.frameHash, callId,
          nativeRequest, response, rawTextHash: await sha256Text(response.text) }
        responseRef = await cursor.record({ artifactKind: 'raw-response', content: canonicalStringify(envelope), stepId: CODEX_EXTRACTION_STEP_V2, attempt: 1 })
        // Usage presence is preserved, including measured0; no missing-to0 or
        // repeated settlement after a partial successful evidence write.
        await cursor.record({ artifactKind: 'tool-result', stepId: CODEX_EXTRACTION_STEP_V2, attempt: 1,
          content: canonicalStringify({ version: 'codex-call-usage-v2', callId, responseRef, usage: response.usage, source: 'observed-provider-fields' }) })
        await cursor.append('model.responded', { stepId: CODEX_EXTRACTION_STEP_V2, attempt: 1, outputHash: responseRef.contentHash })
        if (nativeRequest && ['complete','incomplete'].includes(response.completion)) {
          await handoffCodexNativeResponseV2({ cursor, refs: { root: state.rootRef, plan: state.planRef,
            frame: stored.frame, wire: stored.wire, call: callRef, response: responseRef } })
        }
      },
    })
    try {
      const snapshot = cursor.snapshot
      const binding = snapshot.contract.executionBindings?.find(row => row.stepId === CODEX_EXTRACTION_STEP_V2)
      if (!binding?.formalEntry) throw new Error('当前新Skill缺少冻结正式入口。')
      await executeFrozenFormalAIEntryV1('world.codex.extract.v2', binding.formalEntry,
        getAgentSkillV1(CODEX_EXTRACTION_SKILL_V2, 'world-origin'), 'src/lib/agent/run/codex-extraction-v2-runtime.ts',
        wire.messages, frozenRequest.resolution.config, { category: 'codex.extract', projectId: scope.projectId,
          transportRetryPolicy: 'none', contextOverflowPolicy: 'reject' }, input.signal, result,
        { ...wire.options, preparedRequestV2: bound }, frozenRequest.resolution)
    } catch (error) {
      if (cursor.isStopped || error instanceof CodexNativeHandoffStoppedV2
        || error instanceof PreparedRequestStoppedV2 && error.cause instanceof CodexNativeHandoffStoppedV2) throw error
      if (!observation || !responseRef || observation.completion !== 'incomplete') {
        // The exact intent/ref survives. A transport exception never grants a
        // fresh inference POST, and a known stored answer is not called unmade.
        if (!cursor.isStopped) await cursor.record({ artifactKind: 'tool-result', content: canonicalStringify({
          version: 'codex-extraction-stopped-v2', callId, callRef: callRef ?? null, responseRef: responseRef ?? null,
          reason: observation?.completion ?? (result.requestLifecycle?.phase === 'pre-dispatch' ? 'not-dispatched' : 'unknown'), deltaHead }) })
        if (input.signal?.aborted && !cursor.isStopped) await cursor.append('run.cancelled', { reason: 'author-stopped-codex-extraction-v2' })
        throw error
      }
    }
    if (!observation || !responseRef || !callRef) throw new Error('缺少本次可靠响应证据；不会重发。')
    const remaining = frontier.prepared.slice(1).map(row => ({ startChar: row.frame.startChar, endChar: row.frame.endChar }))
    if (observation.completion === 'complete') {
      const entries = await parseCodexResponseForRootV2({ snapshot: cursor.snapshot, materials, frame, raw: observation.text,
        previous: new Map(completed.map(row => [row.resultRef.contentHash, row.entries])) })
      const names = new Set([...materials.baselineState.entries, ...(materials.root.productionPolicy ? [] : completed.flatMap(row => row.entries))].map(entry => entry.name.trim().toLocaleLowerCase()))
      if (entries.some(entry => names.has(entry.name.trim().toLocaleLowerCase()))) throw new Error('原答重复输出已有词条或已完成范围，已留原答并停止。')
      const snapshot = cursor.snapshot
      const resultRef = await cursor.record({ artifactKind: 'tool-result', stepId: CODEX_EXTRACTION_STEP_V2, attempt: 1,
        content: canonicalStringify({ version: 'codex-extraction-verified-result-v2', runId: snapshot.run.id,
          generation: snapshot.projection.generation, contractHash: snapshot.projection.contractHash,
          rootHash: materials.root.rootHash, planHash: frontier.plan.planHash, frameHash: frame.frameHash, callId, responseRef, entries }) })
      completed.push({ frame, resultRef, entries }); state.resultRefs.push(resultRef); predecessorHashes.push(resultRef.contentHash)
      if (materials.root.productionPolicy) projectCodexFragmentsV2(materials, completed.flatMap(row => row.entries))
    } else if (observation.completion === 'incomplete') {
      if (!materials.root.productionPolicy) throw new Error('旧提取策略不能安全继续二分；原答已保留，请显式处理旧运行后开始新请求。')
      const children = refineIncompleteCodexRangeV2({ sourceText: materials.source.rawText,
        startChar: frame.startChar, endChar: frame.endChar, completion: 'incomplete', productionPolicy: materials.root.productionPolicy })
      remaining.unshift(...children.map(({ startChar, endChar }) => ({ startChar, endChar })))
      predecessorHashes.push(responseRef.contentHash)
    } else throw new Error('原答没有可靠完成；保留证据，不重发。')
    await cursor.checkpoint(state)
    if (!remaining.length) break
    const previousPlanHash = frontier.plan.planHash
    if (!config) throw new Error('未派发范围缺少原模型配置，不会自动发送。')
    frontier = await prepareFrontierV2({ materials, config, pending: remaining, completed,
      previousPlanHash, predecessorHashes, runId: cursor.snapshot.run.id })
    const next = await saveFrontierV2(cursor, frontier)
    state.materialRef = next.materialRef; state.planRef = next.planRef; state.frameRefs.push(...next.frameRefs)
    // The new plan exists before the new contract. Crash recovery locates it
    // from the current contract, not from a stale preceding checkpoint.
    await cursor.revise(await contractForFrontierV2(materials, frontier))
    await cursor.checkpoint(state)
    await cursor.append('step.scheduled', { stepId: CODEX_EXTRACTION_STEP_V2 })
    await cursor.append('step.started', { stepId: CODEX_EXTRACTION_STEP_V2, attempt: 1 })
  }
  await assertFreshMaterialsV2(materials, false)
  const body = { version: 'codex-extraction-candidate-v2' as const, portable: false as const, runId: cursor.snapshot.run.id,
    rootHash: materials.root.rootHash, planHash: frontier.plan.planHash, resultRefs: completed.map(row => row.resultRef),
    entries: projectCodexFragmentsV2(materials, completed.flatMap(row => row.entries)) }
  const candidate = { ...body, candidateHash: await hashCanonicalValue(body) }
  state.candidateRef = await cursor.record({ artifactKind: 'tool-result', content: canonicalStringify(body), stepId: CODEX_EXTRACTION_STEP_V2, attempt: 1 })
  await cursor.append('candidate.persisted', { stepId: CODEX_EXTRACTION_STEP_V2, attempt: 1,
    candidateHash: candidate.candidateHash, requiresConfirmation: true })
  await cursor.checkpoint(state)
  return { snapshot: cursor.snapshot, candidate }
}

function refFromSnapshotV2(snapshot: AgentRunSnapshotV1, kind: CodexExactRefV2['artifactKind'], hash: string): CodexExactRefV2 {
  const event = snapshot.events.find(event => event.type === 'evidence.artifact.recorded'
    && event.payload.artifactKind === kind && event.payload.contentHash === hash)
  if (!event || event.type !== 'evidence.artifact.recorded') throw new Error('引用不属于同一Run的已提交工件。')
  return { artifactKind: kind, contentHash: hash, byteLength: event.payload.byteLength,
    ...(event.payload.stepId === undefined ? {} : { stepId: event.payload.stepId, attempt: event.payload.attempt }) }
}
/** A damaged current contract may still have exact historical profile bytes.
 * This is diagnostic selection only: it cannot establish target or execution
 * authority. Parent-scoped events keep foreign Work history out of the scan. */
export async function isCodexExtractionLookupCandidateV2(scopeInput: WorkspaceScope, rowInput: import('../../types/agent-run').AgentRunRecord): Promise<boolean> {
  const scope = Object.freeze({ ...scopeInput }), row = { ...rowInput }
  if (!row.id || row.projectId !== scope.projectId || row.workId !== scope.workId || row.productRuntimeSessionId != null) return false
  const declaresProfile = (value: unknown) => Boolean(value && typeof value === 'object' && 'executionBindings' in value
    && Array.isArray(value.executionBindings) && value.executionBindings.some(binding => binding && typeof binding === 'object'
      && 'skillId' in binding && binding.skillId === CODEX_EXTRACTION_SKILL_V2))
  let current: unknown
  try { current = JSON.parse(row.contractJson) } catch { current = null }
  if (declaresProfile(current)) return true
  try {
    // Row-local JSON/hash agreement is not the Run's authority. A genuinely
    // unrelated current profile must pass the original Work's actual ledger,
    // projection and contract verification before it can be excluded.
    const verified = await readAgentRunV1(scope, row.id)
    if (verified.run.id !== row.id || verified.run.projectId !== scope.projectId
      || verified.run.workId !== scope.workId || verified.run.productRuntimeSessionId != null) throw new Error('unverified original owner')
    return declaresProfile(verified.contract)
  } catch { /* Retain historical V2 diagnosis when the current prefix fails. */ }
  const events = await readOwnedRows<import('../../types/agent-run').AgentRunEventRecord>(scope, 'agentRunEvents', { owner: 'work' })
  for (const event of events) {
    if (event.runId !== row.id || !['contract.accepted','contract.revised'].includes(event.type)) continue
    try {
      const payload = JSON.parse(event.payloadJson) as { contractJson?: unknown }
      if (typeof payload.contractJson === 'string' && await sha256Text(payload.contractJson) === event.contractHash
        && declaresProfile(JSON.parse(payload.contractJson))) return true
    } catch { /* Unverified fragments do not become profile authority. */ }
  }
  return false
}

export interface BlockedCodexExtractionRunV2 {
  readonly version: 'codex-extraction-blocked-v2'
  readonly runId: number
  readonly scope: Readonly<WorkspaceScope>
  readonly target: Readonly<{ categoryId: number; worldGroupId: number | null }> | null
  readonly reason: 'unverified-run-or-target' | 'incomplete-or-corrupt-evidence'
  readonly message: string
  readonly lastSequence: number | null
  readonly contractHash: string | null
  readonly originalRefs: readonly Readonly<CodexExactRefV2>[]
  readonly evidenceRefCount: number
}

/** Metadata-only admission precedes target filtering. A root is authoritative
 * only through this original Work's verified Run and current binding DAG, never
 * its objective/name or a project-wide hash lookup. No transport or mutation. */
export async function inspectCodexExtractionRunForLookupV2(input: { scope: WorkspaceScope; runId: number }): Promise<
  | { kind: 'target'; target: Readonly<{ categoryId: number; worldGroupId: number | null }>; blockedOnReadFailure: BlockedCodexExtractionRunV2 }
  | { kind: 'blocked'; blocked: BlockedCodexExtractionRunV2 }
  | { kind: 'unrelated' }
> {
  const scope = Object.freeze({ ...input.scope }), runId = input.runId
  let snapshot: AgentRunSnapshotV1 | undefined
  let target: Readonly<{ categoryId: number; worldGroupId: number | null }> | null = null
  try {
    snapshot = await readAgentRunV1(scope, runId)
    if (!snapshot.contract.executionBindings?.some(binding => binding.skillId === CODEX_EXTRACTION_SKILL_V2)) return { kind: 'unrelated' }
    if (snapshot.run.workId !== scope.workId || snapshot.run.productRuntimeSessionId != null
      || snapshot.contract.version !== 3 || snapshot.contract.executionBindings.length !== 1) throw new Error('unadmitted V2 owner/profile')
    const binding = snapshot.contract.executionBindings[0], allocation = snapshot.contract.budget.allocation
    if (!binding.taskRequest || allocation?.mode !== 'adaptive-plan' || binding.taskRequest.planHash !== allocation.planHash) throw new Error('missing V2 plan binding')
    // Root is the producer's first run-level source artifact. If absent/corrupt,
    // no category is guessed from objective, UI filter or an unverified plan.
    const rootEvent = snapshot.events.find(event => event.type === 'evidence.artifact.recorded'
      && event.payload.artifactKind === 'source-snapshot' && event.payload.stepId === undefined && event.payload.attempt === undefined)
    if (!rootEvent || rootEvent.type !== 'evidence.artifact.recorded') throw new Error('missing committed root')
    const rootRef = refFromSnapshotV2(snapshot, 'source-snapshot', rootEvent.payload.contentHash)
    const root = { ...JSON.parse(await exactMember(snapshot, rootRef)), rootHash: rootRef.contentHash } as CodexExtractionRootV2
    await assertCodexExtractionRootV2(root)
    if (canonicalStringify(root.scope) !== canonicalStringify(scope) || root.worldGroupId !== snapshot.contract.scope.worldGroupId
      || snapshot.contract.runtimeBindingHash !== await hashCanonicalValue({ rootHash: root.rootHash,
        planHash: allocation.planHash, materialAllocationHash: binding.taskRequest.materialAllocationHash })) throw new Error('unverified target root')
    target = Object.freeze({ categoryId: root.categoryId, worldGroupId: root.worldGroupId })
    const planRef = refFromSnapshotV2(snapshot, 'tool-result', allocation.planHash)
    const plan = { ...JSON.parse(await exactMember(snapshot, planRef)), planHash: planRef.contentHash } as CodexExtractionPlanV2
    await assertCodexExtractionPlanV2(plan)
    if (plan.rootHash !== root.rootHash) throw new Error('plan root mismatch')
    refFromSnapshotV2(snapshot, 'source-snapshot', root.sourceCaptureHash)
    refFromSnapshotV2(snapshot, 'source-snapshot', root.baselineCaptureHash)
    refFromSnapshotV2(snapshot, 'source-snapshot', root.baselineStateHash)
    refFromSnapshotV2(snapshot, 'tool-result', binding.taskRequest.materialAllocationHash)
    return { kind: 'target', target, blockedOnReadFailure: blocked() }
  } catch { return { kind: 'blocked', blocked: blocked() } }
  function blocked(): BlockedCodexExtractionRunV2 {
    // The diagnostic is bounded and contains original references only. It never
    // interprets a partial prefix as an execution/adoption/cancellation grant.
    const refs: CodexExactRefV2[] = snapshot?.events.flatMap(event => event.type === 'evidence.artifact.recorded' ? [{
      artifactKind: event.payload.artifactKind, contentHash: event.payload.contentHash, byteLength: event.payload.byteLength,
      ...(event.payload.stepId === undefined ? {} : { stepId: event.payload.stepId, attempt: event.payload.attempt }),
    }] : []) ?? []
    return Object.freeze({ version: 'codex-extraction-blocked-v2', runId, scope, target,
      reason: target ? 'incomplete-or-corrupt-evidence' : 'unverified-run-or-target',
      message: target ? '原运行的完整证据缺失或损坏；保留原件，当前仅可只读核对。' : '原运行或目标尚无法核验；不能按当前分类重新发送。',
      lastSequence: snapshot?.projection.lastSequence ?? null, contractHash: snapshot?.projection.contractHash ?? null,
      originalRefs: Object.freeze(refs.slice(0, 6).map(ref => Object.freeze(ref))), evidenceRefCount: refs.length })
  }
}

/** Starting a replacement is not a recovery policy. Unknown target metadata
 * cannot authorize any current category; unresolved same-target Runs block new
 * inference. Other authenticated targets remain independent. */
async function assertCodexExtractionStartTargetUnblockedV2(scopeInput: WorkspaceScope, targetInput: { categoryId: number; worldGroupId: number | null }): Promise<void> {
  const scope = Object.freeze({ ...scopeInput }), target = Object.freeze({ ...targetInput })
  const rows = await readOwnedRows<import('../../types/agent-run').AgentRunRecord>(scope, 'agentRuns', { owner: 'work' })
  for (const row of rows) {
    if (!row.id || !['planned','running','paused','awaiting_confirmation','verifying'].includes(row.status)) continue
    if (!await isCodexExtractionLookupCandidateV2(scope, row)) continue
    const lookup = await inspectCodexExtractionRunForLookupV2({ scope, runId: row.id })
    if (lookup.kind === 'unrelated') continue
    const originalTarget = lookup.kind === 'target' ? lookup.target : lookup.blocked.target
    if (!originalTarget || originalTarget.categoryId === target.categoryId && originalTarget.worldGroupId === target.worldGroupId) {
      throw new CodexExtractionAdmissionUnavailableV2(`原提取运行 ${row.id} 尚未处理完毕或目标未核验；本页输入与原件已保留，不重新发送。`)
    }
  }
}

/** Strictly read-only recovery, also used before explicit local continuation.
 * It does not follow an active Work pointer, dispatch, cancel or acknowledge. */
export async function readCodexExtractionStateV2(input: { scope: WorkspaceScope; runId: number }) {
  const scope = Object.freeze({ ...input.scope })
  const snapshot = await readAgentRunV1(scope, input.runId)
  if (snapshot.run.workId !== scope.workId || snapshot.run.productRuntimeSessionId != null || snapshot.contract.version !== 3
    || !snapshot.contract.executionBindings.some(binding => binding.skillId === CODEX_EXTRACTION_SKILL_V2 && binding.taskRequest)
    || snapshot.contract.budget.allocation?.mode !== 'adaptive-plan') throw new Error('该Run不是原真实Work的V2提取运行。')
  const planRef = refFromSnapshotV2(snapshot, 'tool-result', snapshot.contract.budget.allocation.planHash)
  const plan = { ...JSON.parse(await exactMember(snapshot, planRef)), planHash: planRef.contentHash } as CodexExtractionPlanV2
  await assertCodexExtractionPlanV2(plan)
  const rootRef = refFromSnapshotV2(snapshot, 'source-snapshot', plan.rootHash)
  const root = { ...JSON.parse(await exactMember(snapshot, rootRef)), rootHash: rootRef.contentHash } as CodexExtractionRootV2
  await assertCodexExtractionRootV2(root)
  if (canonicalStringify(root.scope) !== canonicalStringify(scope) || root.worldGroupId !== snapshot.contract.scope.worldGroupId) throw new Error('导入或切换作品后的历史不取得原V2执行权。')
  const sourceRef = refFromSnapshotV2(snapshot, 'source-snapshot', root.sourceCaptureHash)
  const baselineRef = refFromSnapshotV2(snapshot, 'source-snapshot', root.baselineCaptureHash)
  const source = { ...JSON.parse(await exactMember(snapshot, sourceRef)), captureHash: sourceRef.contentHash } as RegisteredCodexCaptureV2
  const baseline = { ...JSON.parse(await exactMember(snapshot, baselineRef)), captureHash: baselineRef.contentHash } as RegisteredCodexCaptureV2
  const baselineStateRef = refFromSnapshotV2(snapshot, 'source-snapshot', root.baselineStateHash)
  const baselineState = JSON.parse(await exactMember(snapshot, baselineStateRef)) as CodexExtractionBaselineV1
  await assertRegisteredCodexCaptureV2(source)
  await assertRegisteredCodexCaptureV2(baseline)
  if (source.sourceKey !== 'manualText' || baseline.sourceKey !== 'codexExtractionBaseline'
    || canonicalStringify(source.scope) !== canonicalStringify(scope) || canonicalStringify(baseline.scope) !== canonicalStringify(scope)
    || await sha256Text(source.rawText) !== source.rawBodyHash || await sha256Text(baseline.rawText) !== baseline.rawBodyHash
    || await hashCanonicalValue(baselineState) !== root.baselineStateHash) throw new Error('冻结完整来源或分类基线无法验证。')
  if (root.productionPolicy) {
    assertCodexProductionPolicyV1(root.productionPolicy, source.rawText)
    const boundaries = [0, ...root.productionPolicy.sourceUnitEnds]
    if (plan.frames.some(frame => !boundaries.includes(frame.startChar) || !boundaries.includes(frame.endChar))) throw new Error('计划割裂了冻结原文单元。')
  }
  const materials = { root, source, baseline, baselineState }
  const binding = snapshot.contract.executionBindings.find(row => row.skillId === CODEX_EXTRACTION_SKILL_V2)!
  const materialRef = refFromSnapshotV2(snapshot, 'tool-result', binding.taskRequest!.materialAllocationHash)
  const material = { ...JSON.parse(await exactMember(snapshot, materialRef)), allocationHash: materialRef.contentHash } as import('../../types/agent-run').ContextMaterialAllocationV2
  const progressHash = material.capturedSourceHashes?.[2]
  const progressRef = progressHash ? refFromSnapshotV2(snapshot, 'source-snapshot', progressHash) : null
  const progress = progressRef ? { ...JSON.parse(await exactMember(snapshot, progressRef)), captureHash: progressRef.contentHash } as RegisteredCodexCaptureV2 : undefined
  const rebuiltMaterial = await createCodexContextMaterialV2({ root, source, baseline, progress, inputTokenForecast: material.inputTokenForecast })
  if (canonicalStringify(rebuiltMaterial) !== canonicalStringify(material)
    || binding.taskRequest!.planHash !== plan.planHash
    || snapshot.contract.runtimeBindingHash !== await hashCanonicalValue({ rootHash: root.rootHash, planHash: plan.planHash, materialAllocationHash: material.allocationHash })
    || snapshot.contract.budget.maxModelCalls !== plan.forecast.modelCalls || snapshot.contract.budget.maxInputTokens !== plan.forecast.inputTokens
    || snapshot.contract.budget.maxOutputTokens !== plan.forecast.outputTokens) throw new Error('当前完整材料、预估或root/plan/contract绑定无法重算。')
  const toolBodies: Array<{ ref: CodexExactRefV2; body: Record<string, unknown> }> = []
  for (const event of snapshot.events) {
    if (event.type !== 'evidence.artifact.recorded' || event.payload.artifactKind !== 'tool-result') continue
    const ref = refFromSnapshotV2(snapshot, 'tool-result', event.payload.contentHash)
    const body = JSON.parse(await exactMember(snapshot, ref)) as Record<string, unknown>
    if (body && typeof body === 'object' && !Array.isArray(body)) toolBodies.push({ ref, body })
  }
  const responses: Array<{ ref: CodexExactRefV2; body: CodexExtractionResponseV2 }> = []
  for (const event of snapshot.events) {
    if (event.type !== 'evidence.artifact.recorded' || event.payload.artifactKind !== 'raw-response') continue
    const ref = refFromSnapshotV2(snapshot, 'raw-response', event.payload.contentHash)
    const body = JSON.parse(await exactMember(snapshot, ref)) as CodexExtractionResponseV2
    if (body.version !== 'codex-extraction-response-v2') continue
    assertCodexExactObjectV2(body, ['version','runId','generation','contractHash','rootHash','planHash','frameHash','callId','nativeRequest','response','rawTextHash'], 'savedResponse')
    assertCodexPublicResponseV2(body.response)
    const call = toolBodies.find(row => row.body.version === 'codex-extraction-call-v2' && row.body.callId === body.callId)?.body
    if (!call || body.runId !== snapshot.run.id || body.rootHash !== root.rootHash
      || body.planHash !== call.planHash || body.frameHash !== call.frameHash || body.generation !== call.generation
      || body.contractHash !== call.contractHash || canonicalStringify(body.nativeRequest) !== canonicalStringify(call.nativeRequest)
      || typeof body.response?.text !== 'string' || await sha256Text(body.response.text) !== body.rawTextHash
      || responses.some(row => row.body.callId === body.callId)
      || snapshot.events.filter(row => row.type === 'model.requested' && row.payload.bindingHash === body.callId
        && row.generation === body.generation && row.contractHash === body.contractHash).length !== 1) throw new Error('保存原答不属于唯一实际派发的同一call。')
    responses.push({ ref, body })
  }
  const modelHash = snapshot.projection.steps[CODEX_EXTRACTION_STEP_V2]?.candidateHash
  const model = modelHash ? toolBodies.find(row => row.ref.contentHash === modelHash && row.body.version === 'codex-extraction-candidate-v2') : undefined
  const candidate = model ? { ...model.body, candidateHash: model.ref.contentHash } as unknown as CodexExtractionCandidateV2 : null
  if (candidate) assertCodexExactObjectV2(candidate, ['version','portable','runId','rootHash','planHash','resultRefs','entries','candidateHash'], 'modelCandidate')
  if (candidate && (candidate.portable !== false || !Array.isArray(candidate.resultRefs) || !Array.isArray(candidate.entries)
    || candidate.rootHash !== root.rootHash || candidate.runId !== snapshot.run.id || candidate.planHash !== plan.planHash)) throw new Error('V2模型候选身份不匹配。')
  if (candidate) {
    const verified: Array<{ start: number; end: number; entries: ExtractedCodexEntry[]; frameHash: string; resultHash: string }> = []
    const seenResults = new Set<string>()
    for (const ref of candidate.resultRefs) {
      if (ref.artifactKind !== 'tool-result' || seenResults.has(ref.contentHash)) throw new Error('模型候选重复或误用结果引用。')
      seenResults.add(ref.contentHash)
      const result = JSON.parse(await exactMember(snapshot, ref)) as Record<string, unknown>
      if (result.version !== 'codex-extraction-verified-result-v2' || result.runId !== snapshot.run.id || result.rootHash !== root.rootHash
        || typeof result.frameHash !== 'string' || !result.responseRef || typeof result.responseRef !== 'object') throw new Error('模型候选的结果链不完整。')
      const frameRef = refFromSnapshotV2(snapshot, 'rendered-request', result.frameHash)
      const frame = JSON.parse(await exactMember(snapshot, frameRef)) as Omit<CodexExtractionFrameV2, 'frameHash'>
      if (frame.rootHash !== root.rootHash || !plan.frames.some(row => row.frameHash === result.frameHash)
        || !Number.isSafeInteger(frame.startChar) || !Number.isSafeInteger(frame.endChar)
        || frame.startChar < 0 || frame.endChar <= frame.startChar || frame.endChar > source.rawText.length) throw new Error('模型候选来源范围或最终覆盖计划不一致。')
      const original = source.rawText.slice(frame.startChar, frame.endChar)
      if (await hashCanonicalValue(original) !== frame.sourceRangeHash) throw new Error('模型候选的原始来源范围已变化。')
      const rawRef = result.responseRef as unknown as CodexExactRefV2
      if (rawRef.artifactKind !== 'raw-response') throw new Error('模型结果没有原答引用。')
      const raw = JSON.parse(await exactMember(snapshot, rawRef)) as CodexExtractionResponseV2
      if (raw.version !== 'codex-extraction-response-v2' || raw.runId !== snapshot.run.id || raw.rootHash !== root.rootHash
        || raw.frameHash !== result.frameHash || raw.planHash !== result.planHash || raw.callId !== result.callId
        || raw.generation !== result.generation || raw.contractHash !== result.contractHash || raw.response.completion !== 'complete'
        || await sha256Text(raw.response.text) !== raw.rawTextHash
        || !snapshot.events.some(event => event.type === 'model.requested' && event.payload.bindingHash === raw.callId
          && event.generation === raw.generation && event.contractHash === raw.contractHash)) throw new Error('模型候选原答不属于实际已派发的原call。')
      const entries = await parseCodexResponseForRootV2({ snapshot, materials, frame, raw: raw.response.text,
        previous: new Map(verified.map(row => [row.resultHash, row.entries])) })
      if (canonicalStringify(entries) !== canonicalStringify(result.entries)) throw new Error('模型候选结果与原始回答不一致。')
      verified.push({ start: frame.startChar, end: frame.endChar, entries, frameHash: result.frameHash, resultHash: ref.contentHash })
    }
    verified.sort((left, right) => left.start - right.start)
    let end = 0
    for (const row of verified) { if (row.start !== end) throw new Error('模型候选没有完整无缝覆盖原文。'); end = row.end }
    if (end !== source.rawText.length || verified.length !== plan.frames.length
      || canonicalStringify(projectCodexFragmentsV2(materials, verified.flatMap(row => row.entries))) !== canonicalStringify(candidate.entries)) throw new Error('模型候选未覆盖最终实际范围。')
  }

  const drafts = model ? toolBodies.filter(row => row.body.version === 'codex-extraction-author-draft-v2'
    && row.body.modelCandidateHash === model.ref.contentHash && row.body.runId === snapshot.run.id) : []
  const draft = drafts[drafts.length - 1]
  const intents = model ? toolBodies.filter(row => row.body.version === 'codex-extraction-adoption-intent-v2'
    && row.body.modelCandidateHash === model.ref.contentHash && row.body.runId === snapshot.run.id) : []
  const intent = intents[intents.length - 1]
  const results = toolBodies.filter(row => row.body.version === 'codex-extraction-verified-result-v2'
    && row.body.rootHash === root.rootHash && row.body.runId === snapshot.run.id)
  const calls = toolBodies.filter(row => row.body.version === 'codex-extraction-call-v2'
    && row.body.rootHash === root.rootHash && row.body.runId === snapshot.run.id)
  if (model && candidate) {
    if (draft) {
      assertCodexExactObjectV2(draft.body, ['version','runId','modelCandidateHash','modelCandidateRef','entries','editPaths'], 'authorDraft')
      const entries = parseCodexAuthorDraftV2(JSON.stringify(draft.body.entries), baselineState.category.fields,
        { sourceText: source.rawText, supplementTags: root.supplementTags })
      if (entries.length !== candidate.entries.length || canonicalStringify(draft.body.modelCandidateRef) !== canonicalStringify(model.ref)) throw new Error('作者独立草稿与M引用不匹配。')
      const editPaths: string[] = []
      entries.forEach((entry, index) => { for (const key of ['name','icon','summary','description','fields','tags','importance','evidenceQuotes'] as const) {
        if (canonicalStringify(entry[key]) !== canonicalStringify(candidate.entries[index][key])) editPaths.push(`entries.${index}.${key}`)
      } })
      if (canonicalStringify(editPaths) !== canonicalStringify(draft.body.editPaths)) throw new Error('作者独立草稿修改路径无法重算。')
    }
    if (intent) {
      const body = intent.body as unknown as Omit<CodexExtractionIntentV2, 'intentHash'>
      assertCodexExactObjectV2(body, ['version','runId','rootHash','modelCandidateHash','draftRef','reviewRef','review','formalItems'], 'adoptionIntent')
      const exactDraft = JSON.parse(await exactMember(snapshot, body.draftRef)) as Omit<CodexExtractionAuthorDraftV2, 'draftHash'>
      const exactReview = JSON.parse(await exactMember(snapshot, body.reviewRef)) as Omit<CodexExtractionReviewV2, 'confirmedCandidateHash'>
      const compiled = await compileCodexExtractionReviewV2({ root, candidate, candidateRef: model.ref,
        entries: exactDraft.entries, selectedIndexes: body.review.selectedIndexes, sourceText: source.rawText, baseline: baselineState })
      if (body.rootHash !== root.rootHash || body.modelCandidateHash !== candidate.candidateHash
        || compiled.draft.draftHash !== body.draftRef.contentHash || compiled.review.confirmedCandidateHash !== body.reviewRef.contentHash
        || canonicalStringify({ ...exactReview, confirmedCandidateHash: body.reviewRef.contentHash }) !== canonicalStringify(compiled.review)
        || canonicalStringify(body.review) !== canonicalStringify(compiled.review)
        || canonicalStringify(body.formalItems) !== canonicalStringify(compiled.formalItems)) throw new Error('冻结作者意图无法从M/D/R及实际采用内容重算。')
    }
  }
  const confirmation = snapshot.projection.steps[CODEX_EXTRACTION_STEP_V2]?.confirmation === 'adopt'
  return { snapshot, materials, material, materialRef, plan, planRef, rootRef, sourceRef, baselineRef, baselineStateRef,
    candidate, candidateRef: model?.ref ?? null,
    draft: draft ? { ...draft.body, draftHash: draft.ref.contentHash } as unknown as import('./codex-extraction-v2-contract').CodexExtractionAuthorDraftV2 : null,
    draftRef: draft?.ref ?? null,
    intent: intent ? { ...intent.body, intentHash: intent.ref.contentHash } as unknown as import('./codex-extraction-v2-contract').CodexExtractionIntentV2 : null,
    intentRef: intent?.ref ?? null, selectionFrozen: Boolean(intent || confirmation), results, calls, responses }
}

export async function saveCodexExtractionAuthorDraftV2(input: {
  scope: WorkspaceScope; runId: number; expectedLastSequence: number;
  entries: ExtractedCodexEntry[]; selectedIndexes: readonly number[]
}) {
  const entries = structuredClone(input.entries), indexes = [...input.selectedIndexes]
  const read = await readCodexExtractionStateV2({ scope: { ...input.scope }, runId: input.runId })
  if (!read.candidate || !read.candidateRef || read.selectionFrozen || read.snapshot.projection.state !== 'awaiting_confirmation'
    || read.snapshot.projection.lastSequence !== input.expectedLastSequence) throw new Error('作者稿已冻结或前缀已变化。')
  await assertFreshMaterialsV2(read.materials, false)
  const compiled = await compileCodexExtractionReviewV2({ root: read.materials.root, candidate: read.candidate,
    candidateRef: read.candidateRef, entries, selectedIndexes: indexes, sourceText: read.materials.source.rawText, baseline: read.materials.baselineState })
  const cursor = await CodexExtractionEvidenceCursorV2.open(input.scope, input.runId)
  cursor.assertPrefix(read.snapshot)
  const { draftHash: _hash, ...body } = compiled.draft
  const draftRef = await cursor.record({ artifactKind: 'tool-result', content: canonicalStringify(body) })
  return { snapshot: cursor.snapshot, draft: compiled.draft, draftRef }
}

function localEventV2<T extends AgentRunEventTypeV1>(snapshot: AgentRunSnapshotV1, type: T, payload: AgentRunEventPayloadByTypeV1[T]) {
  return parseAgentRunEventV1({ version: 1, runId: snapshot.run.id, projectId: snapshot.run.projectId,
    worldGroupId: snapshot.run.worldGroupId ?? null, generation: snapshot.projection.generation,
    contractHash: snapshot.projection.contractHash, sequence: snapshot.projection.lastSequence + 1,
    type, payload, createdAt: Date.now() })
}
async function hasCommittedIntentV2(snapshot: AgentRunSnapshotV1): Promise<boolean> {
  if (snapshot.projection.steps[CODEX_EXTRACTION_STEP_V2]?.confirmation === 'adopt') return true
  for (const event of snapshot.events) {
    if (event.type !== 'evidence.artifact.recorded' || event.payload.artifactKind !== 'tool-result') continue
    const body = JSON.parse(await exactMember(snapshot, refFromSnapshotV2(snapshot, 'tool-result', event.payload.contentHash))) as Record<string, unknown>
    if (body.version === 'codex-extraction-adoption-intent-v2' && body.runId === snapshot.run.id
      && body.modelCandidateHash === snapshot.projection.steps[CODEX_EXTRACTION_STEP_V2]?.candidateHash) return true
  }
  return false
}
export async function abandonCodexExtractionV2(input: { scope: WorkspaceScope; runId: number }): Promise<AgentRunSnapshotV1> {
  const scope = { ...input.scope }
  return withAgentRunMutationLockV1(input.runId, () => db.transaction('rw',
    agentRunScopeTransactionTablesV1(input.runId, db.agentRuns, db.agentRunEvents, db.agentRunArtifacts, db.worlds, db.works), async () => {
      let snapshot = await readVerifiedAgentRunInTransactionV1(scope, input.runId)
      if (snapshot.contract.version !== 3 || !snapshot.contract.executionBindings.some(binding => binding.skillId === CODEX_EXTRACTION_SKILL_V2)) throw new Error('该运行不是V2提取。')
      if (['completed','cancelled','failed'].includes(snapshot.projection.state)) return snapshot
      if (await hasCommittedIntentV2(snapshot)) throw new Error('作者意图已提交，不能取消或再生成；请沿同一意图恢复写入与终验。')
      const step = snapshot.projection.steps[CODEX_EXTRACTION_STEP_V2]
      if (snapshot.projection.state === 'awaiting_confirmation' && step?.candidateHash) {
        snapshot = await appendPrivilegedAgentRunEventInTransactionV1(snapshot, localEventV2(snapshot, 'confirmation.recorded', {
          stepId: CODEX_EXTRACTION_STEP_V2, candidateHash: step.candidateHash, decision: 'reject' }))
      }
      return appendAgentRunEventWithSettlementInTransactionV1({ snapshot, scope,
        event: localEventV2(snapshot, 'run.cancelled', { reason: 'author-abandoned-codex-extraction-v2' }) })
    }))
}
function matchesFormalV2(item: Record<string, unknown>, row: import('../../codex/extraction').CodexExtractionEntryV1 | undefined): boolean {
  return Boolean(row && Object.entries(item).every(([key, value]) => canonicalStringify((row as unknown as Record<string, unknown>)[key]) === canonicalStringify(value)))
}
/** The sole local atomic writer. Exact immutable references are prepared before
 * one Run lock and one native rw transaction; there is no network in this body. */
async function commitCodexIntentAtomicV2(input: {
  cursor: CodexExtractionEvidenceCursorV2
  read: Awaited<ReturnType<typeof readCodexExtractionStateV2>>
  intent: CodexExtractionIntentV2
  intentRef: CodexExactRefV2
}): Promise<void> {
  const scope = { ...input.cursor.scope }, intent = structuredClone(input.intent), expected = input.cursor.snapshot
  await input.cursor.write(async original => {
    const snapshot = await withAgentRunMutationLockV1(original.run.id, () => db.transaction('rw',
      agentRunScopeTransactionTablesV1(original.run.id,
        ...adoptionTransactionTablesV1('codexEntries', undefined, { callerOwned: true }),
        db.agentRuns, db.agentRunEvents, db.agentRunArtifacts, db.agentRunCheckpoints, db.codexCategories), async () => {
        let current = await readVerifiedAgentRunInTransactionV1(scope, original.run.id)
        const step = current.projection.steps[CODEX_EXTRACTION_STEP_V2]
        if (current.projection.lastSequence !== expected.projection.lastSequence
          || current.projection.generation !== expected.projection.generation || current.projection.contractHash !== expected.projection.contractHash
          || current.run.workId !== scope.workId || current.run.productRuntimeSessionId != null
          || current.contract.version !== 3 || !current.contract.executionBindings.some(binding => binding.skillId === CODEX_EXTRACTION_SKILL_V2)
          || current.projection.state !== 'running' || step?.confirmation !== 'adopt' || step.candidateHash !== intent.modelCandidateHash
          || step.adoptionHash) throw new Error('当前Run、作者意图或原子采用前缀已变化。')
        const exactIntent = await exactMember(current, input.intentRef)
        const { intentHash: _hash, ...intentBody } = intent
        if (exactIntent !== canonicalStringify(intentBody) || input.intentRef.contentHash !== intent.intentHash) throw new Error('当前意图与已提交原件不一致。')
        const review = JSON.parse(await exactMember(current, intent.reviewRef)) as Omit<CodexExtractionReviewV2, 'confirmedCandidateHash'>
        if (canonicalStringify(review) !== canonicalStringify((({ confirmedCandidateHash: _confirmed, ...body }) => body)(intent.review))) throw new Error('确认稿与原件不一致。')
        const draft = JSON.parse(await exactMember(current, intent.draftRef)) as Omit<CodexExtractionAuthorDraftV2, 'draftHash'>
        if (draft.modelCandidateHash !== intent.modelCandidateHash || intent.draftRef.contentHash !== intent.review.draftHash
          || intent.reviewRef.contentHash !== intent.review.confirmedCandidateHash) throw new Error('M/D/R确认链不一致。')
        const baseline = await readCodexExtractionBaselineV1({ scope, categoryId: input.read.materials.root.categoryId,
          worldGroupId: input.read.materials.root.worldGroupId })
        if (await Dexie.waitFor(hashCanonicalValue(baseline)) !== input.read.materials.root.baselineStateHash) throw new Error('分类/schema/既有词条已变化，原子采用CAS拒绝。')
        const names = new Set(baseline.entries.map(entry => entry.name.trim().toLocaleLowerCase()))
        for (const item of intent.formalItems) {
          const name = String(item.name).trim().toLocaleLowerCase()
          if (names.has(name)) throw new Error('目标词条身份冲突，不能借merge覆盖已有Canon。')
          names.add(name)
        }
        const transaction = Dexie.currentTransaction
        if (!transaction?.active || transaction.mode !== 'readwrite') throw new Error('缺少同一原生调用方写事务。')
        const adopted = await Dexie.Promise.resolve(adopt({ projectId: scope.projectId, scope,
          worldGroupId: input.read.materials.root.worldGroupId, target: 'codexEntries', mode: 'add-many', data: intent.formalItems }, { transaction }))
        if (!transaction.active || Dexie.currentTransaction !== transaction) throw new Error('采用后原调用方事务不再有效，禁止分离提交事件。')
        if (adopted.written.length !== intent.formalItems.length || adopted.unknown.length || adopted.typeErrors.length
          || adopted.fkErrors.length || adopted.skipped.length) throw new Error('采用未完整通过原注册表检查，整个事务回滚。')
        const actual = await readCodexExtractionBaselineV1({ scope, categoryId: input.read.materials.root.categoryId,
          worldGroupId: input.read.materials.root.worldGroupId })
        const selectedRows = adopted.written.map(row => actual.entries.find(entry => entry.id === row.id))
        if (selectedRows.some((row, index) => !matchesFormalV2(intent.formalItems[index], row))) throw new Error('采用后真实字段/origin/producer链不一致，整个事务回滚。')
        const adoptionHash = await Dexie.waitFor(hashCanonicalValue({ intentHash: intent.intentHash, formal: selectedRows }))
        return Dexie.Promise.resolve(appendPrivilegedAgentRunEventInTransactionV1(current, localEventV2(current, 'adoption.committed', {
          stepId: CODEX_EXTRACTION_STEP_V2, candidateHash: intent.modelCandidateHash, adoptionHash }))).then(next => {
          current = next
          if (!transaction.active || Dexie.currentTransaction !== transaction) throw new Error('提交事件未与采用留在同一原生事务。')
          return current
        })
      }))
    return { snapshot, value: undefined }
  })
}

export async function adoptCodexExtractionCandidateV2(input: {
  scope: WorkspaceScope; runId: number; selectedIndexes: readonly number[]; entries?: ExtractedCodexEntry[]
}): Promise<{ snapshot: AgentRunSnapshotV1; receiptHash: string; written: number }> {
  const scope = { ...input.scope }, selectedIndexes = [...input.selectedIndexes], suppliedEntries = input.entries && structuredClone(input.entries)
  const read = await readCodexExtractionStateV2({ scope, runId: input.runId })
  if (!read.candidate || !read.candidateRef) throw new Error('缺少当前模型候选原件。')
  const cursor = await CodexExtractionEvidenceCursorV2.open(scope, input.runId)
  cursor.assertPrefix(read.snapshot)
  let intent = read.intent, intentRef = read.intentRef
  if (intent) {
    if (canonicalStringify([...selectedIndexes].sort((a,b) => a-b)) !== canonicalStringify(intent.review.selectedIndexes)) throw new Error('作者选择已冻结，不能修改。')
    if (suppliedEntries) {
      const exactDraft = JSON.parse(await exactMember(read.snapshot, intent.draftRef)) as CodexExtractionAuthorDraftV2
      if (canonicalStringify(suppliedEntries) !== canonicalStringify(exactDraft.entries)) throw new Error('作者稿已冻结，不能修改。')
    }
  } else {
    if (read.snapshot.projection.state !== 'awaiting_confirmation' || read.selectionFrozen) throw new Error('当前不在可确认作者稿边界。')
    await assertFreshMaterialsV2(read.materials, false)
    const compiled = await compileCodexExtractionReviewV2({ root: read.materials.root, candidate: read.candidate,
      candidateRef: read.candidateRef, entries: suppliedEntries ?? read.draft?.entries ?? read.candidate.entries,
      selectedIndexes, sourceText: read.materials.source.rawText, baseline: read.materials.baselineState })
    const { draftHash: _draftHash, ...draftBody } = compiled.draft
    const draftRef = read.draftRef?.contentHash === compiled.draft.draftHash ? read.draftRef
      : await cursor.record({ artifactKind: 'tool-result', content: canonicalStringify(draftBody) })
    const { confirmedCandidateHash: _reviewHash, ...reviewBody } = compiled.review
    const reviewRef = await cursor.record({ artifactKind: 'tool-result', content: canonicalStringify(reviewBody) })
    const body = { version: 'codex-extraction-adoption-intent-v2' as const, runId: input.runId, rootHash: read.materials.root.rootHash,
      modelCandidateHash: read.candidate.candidateHash, draftRef, reviewRef, review: compiled.review, formalItems: compiled.formalItems }
    intent = { ...body, intentHash: await hashCanonicalValue(body) }
    // Successful intent artifact is the durable cancellation barrier even if
    // the next checkpoint or confirmation write fails.
    intentRef = await cursor.record({ artifactKind: 'tool-result', content: canonicalStringify(body) })
    await cursor.checkpoint({ version: 'codex-extraction-intent-ref-v2', rootRef: read.rootRef, candidateRef: read.candidateRef, intentRef })
  }
  if (!intent || !intentRef) throw new Error('缺少冻结作者意图。')
  let step = cursor.snapshot.projection.steps[CODEX_EXTRACTION_STEP_V2]
  if (!step?.adoptionHash) {
    if (step?.confirmation !== 'adopt') {
      await cursor.append('confirmation.recorded', { stepId: CODEX_EXTRACTION_STEP_V2, candidateHash: intent.modelCandidateHash, decision: 'adopt' })
      await cursor.append('adoption.started', { stepId: CODEX_EXTRACTION_STEP_V2, candidateHash: intent.modelCandidateHash, intentHash: intent.intentHash })
    }
    await commitCodexIntentAtomicV2({ cursor, read, intent, intentRef })
  }
  const actual = await readCodexExtractionBaselineV1({ scope, categoryId: read.materials.root.categoryId, worldGroupId: read.materials.root.worldGroupId })
  const selectedRows = intent.formalItems.map(item => actual.entries.find(row => row.producerRunId === input.runId
    && row.producerCandidateHash === intent!.review.confirmedCandidateHash && row.name === item.name))
  const adoptionHash = await hashCanonicalValue({ intentHash: intent.intentHash, formal: selectedRows })
  const snapshot = cursor.snapshot
  const committed = snapshot.events.find(event => event.type === 'adoption.committed'
    && event.payload.stepId === CODEX_EXTRACTION_STEP_V2 && event.payload.candidateHash === intent!.modelCandidateHash && event.payload.adoptionHash === adoptionHash)
  if (!committed || selectedRows.some((row, index) => !matchesFormalV2(intent!.formalItems[index], row))) throw new Error('缺少同一次真实采用提交证明，不能按名字猜测已写入。')
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash) return { snapshot, receiptHash: snapshot.projection.terminalReceiptHash, written: selectedRows.length }
  step = cursor.snapshot.projection.steps[CODEX_EXTRACTION_STEP_V2]
  if (step?.status === 'running') await cursor.append('step.succeeded', { stepId: CODEX_EXTRACTION_STEP_V2, attempt: 1, outputHash: adoptionHash })
  if (cursor.snapshot.projection.state === 'running') await cursor.append('verification.started', { verifierSetVersion: 'codex-extraction-terminal-v2' })
  const current = cursor.snapshot
  const manifestHashes = current.events.filter(event => event.type === 'context.assembled').map(event => event.payload.manifestHash)
  const receipt = await createVerificationReceiptV1({ version: 1, runId: input.runId, generation: current.projection.generation,
    contractHash: current.projection.contractHash, contextManifestHashes: [...new Set(manifestHashes)],
    candidateHashes: [intent.modelCandidateHash], adoptionEventIds: [], postStateHash: await hashCanonicalValue(selectedRows),
    verifierSetVersion: 'codex-extraction-terminal-v2', criteria: [
      { id: 'codex.v2.candidate', status: 'passed', evidenceRefs: [`candidate:${intent.modelCandidateHash}`] },
      { id: 'codex.v2.author', status: 'passed', evidenceRefs: [`review:${intent.review.confirmedCandidateHash}`, `intent:${intent.intentHash}`] },
      { id: 'codex.v2.post-state', status: 'passed', evidenceRefs: [`adoption:${adoptionHash}`] } ], acceptedAt: Date.now() })
  await cursor.append('verification.accepted', { receiptHash: receipt.receiptHash })
  return { snapshot: cursor.snapshot, receiptHash: receipt.receiptHash, written: selectedRows.length }
}

/** Explicit recovery never repeats a paid call. Reliable already-saved raw is
 * reused without another save/settlement; native unknown is one exact GET. */
export async function resumeCodexExtractionCandidateV2(input: {
  scope: WorkspaceScope; runId: number; aiConfig?: AIConfig; signal?: AbortSignal
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: CodexExtractionCandidateV2; receiptHash?: string }> {
  const scope = { ...input.scope }, config = input.aiConfig && structuredClone(input.aiConfig)
  const read = await readCodexExtractionStateV2({ scope, runId: input.runId })
  if (read.intent) {
    const adopted = await adoptCodexExtractionCandidateV2({ scope, runId: input.runId, selectedIndexes: read.intent.review.selectedIndexes })
    return { snapshot: adopted.snapshot, candidate: read.candidate!, receiptHash: adopted.receiptHash }
  }
  if (read.candidate) return { snapshot: read.snapshot, candidate: read.candidate }
  if (!['running','planned'].includes(read.snapshot.projection.state)) throw new Error('当前状态不允许恢复未派发任务。')
  await assertFreshMaterialsV2(read.materials, false)
  const cursor = await CodexExtractionEvidenceCursorV2.open(scope, input.runId)
  cursor.assertPrefix(read.snapshot)
  const state: RuntimeStateV2 = { version: 'codex-extraction-state-v2', rootRef: read.rootRef, sourceRef: read.sourceRef,
    baselineRef: read.baselineRef, baselineStateRef: read.baselineStateRef, planRef: read.planRef, materialRef: read.materialRef,
    resultRefs: read.results.map(row => row.ref), callRefs: read.calls.map(row => row.ref), frameRefs: [] }
  const completed: RuntimeCompletedV2[] = [], pending: Array<{ startChar: number; endChar: number }> = []
  const predecessors = [...read.plan.predecessorResultHashes]
  for (const frame of read.plan.frames) {
    const frameRef = refFromSnapshotV2(read.snapshot, 'rendered-request', frame.frameHash)
    const wireRef = refFromSnapshotV2(read.snapshot, 'rendered-request', frame.wireFrameHash)
    state.frameRefs.push({ frameHash: frame.frameHash, frame: frameRef, wire: wireRef })
    const old = read.results.find(row => row.body.frameHash === frame.frameHash)
    if (old) {
      const rawRef = old.body.responseRef as unknown as CodexExactRefV2
      const response = JSON.parse(await exactMember(read.snapshot, rawRef)) as CodexExtractionResponseV2
      if (rawRef.artifactKind !== 'raw-response' || !read.responses.some(row => row.ref.contentHash === rawRef.contentHash)
        || response.response.completion !== 'complete' || response.rootHash !== read.materials.root.rootHash
        || response.runId !== input.runId || response.callId !== old.body.callId || response.planHash !== old.body.planHash
        || response.generation !== old.body.generation || response.contractHash !== old.body.contractHash
        || response.frameHash !== frame.frameHash || await sha256Text(response.response.text) !== response.rawTextHash
        || await hashCanonicalValue(read.materials.source.rawText.slice(frame.startChar, frame.endChar)) !== frame.sourceRangeHash) throw new Error('已保存完成结果无法验证。')
      const entries = await parseCodexResponseForRootV2({ snapshot: read.snapshot, materials: read.materials, frame, raw: response.response.text,
        previous: new Map(completed.map(row => [row.resultRef.contentHash, row.entries])) })
      if (canonicalStringify(entries) !== canonicalStringify(old.body.entries)) throw new Error('保存的完成结果已变化。')
      completed.push({ frame, resultRef: old.ref, entries }); predecessors.push(old.ref.contentHash)
      continue
    }
    const matchingCalls = read.calls.filter(row => row.body.frameHash === frame.frameHash)
    if (!matchingCalls.length) { pending.push({ startChar: frame.startChar, endChar: frame.endChar }); continue }
    if (matchingCalls.length !== 1) throw new Error('同一frame出现多份调用身份，停止恢复。')
    const call = matchingCalls[0].body as unknown as CodexCallIdentityV2
    if (call.runId !== input.runId || call.rootHash !== read.materials.root.rootHash || call.generation !== read.snapshot.projection.generation
      || call.contractHash !== read.snapshot.projection.contractHash
      || !read.snapshot.events.some(event => event.type === 'model.requested' && event.payload.bindingHash === call.callId
        && event.generation === call.generation && event.contractHash === call.contractHash)) throw new Error('调用意图未完整证明，不能重新发送。')
    let envelope: CodexExtractionResponseV2 | undefined, responseRef: CodexExactRefV2 | undefined
    for (const event of read.snapshot.events) {
      if (event.type !== 'evidence.artifact.recorded' || event.payload.artifactKind !== 'raw-response') continue
      const ref = refFromSnapshotV2(read.snapshot, 'raw-response', event.payload.contentHash)
      const body = JSON.parse(await exactMember(read.snapshot, ref)) as Record<string, unknown>
      if (body.version === 'codex-extraction-response-v2' && body.callId === call.callId) {
        if (envelope) throw new Error('同一call有重复原答证据。')
        envelope = body as unknown as CodexExtractionResponseV2; responseRef = ref
      }
    }
    if (!envelope) {
      if (!call.nativeRequest) throw new Error('原HTTP请求结果未知，不能重发；原输入与意图已保留。')
      const native = await readBoundCodexReceiptV1(call.nativeRequest)
      if (native.status !== 'completed') throw new Error('原本机请求尚无可靠完整结果；此次仅回读原ID，没有再发送。')
      const current = await readAgentRunV1(scope, input.runId)
      cursor.assertPrefix(current)
      const usage: PublicAIResponseV2['usage'] = {}
      for (const key of ['inputTokens','outputTokens','totalTokens'] as const) {
        const value = native.usage?.[key]
        if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) usage[key] = value
      }
      envelope = { version: 'codex-extraction-response-v2', runId: input.runId, generation: call.generation,
        contractHash: call.contractHash, rootHash: call.rootHash, planHash: call.planHash, frameHash: call.frameHash, callId: call.callId,
        nativeRequest: call.nativeRequest, rawTextHash: await sha256Text(native.text),
        response: { text: native.text, usage, finishReason: 'stop', completion: 'complete', responseStatus: 200, wireDigest: null } }
      responseRef = await cursor.record({ artifactKind: 'raw-response', stepId: CODEX_EXTRACTION_STEP_V2, attempt: 1, content: canonicalStringify(envelope) })
    }
    if (!responseRef || envelope.runId !== input.runId || envelope.rootHash !== call.rootHash || envelope.frameHash !== call.frameHash
      || envelope.generation !== call.generation || envelope.contractHash !== call.contractHash
      || await sha256Text(envelope.response.text) !== envelope.rawTextHash) throw new Error('原答与冻结call身份不一致。')
    // Presence of a result does not substitute for exact usage membership.
    let usageSaved = false
    for (const event of cursor.snapshot.events) {
      if (event.type !== 'evidence.artifact.recorded' || event.payload.artifactKind !== 'tool-result') continue
      const body = JSON.parse(await exactMember(cursor.snapshot, refFromSnapshotV2(cursor.snapshot, 'tool-result', event.payload.contentHash))) as Record<string, unknown>
      if (body.version === 'codex-call-usage-v2' && body.callId === call.callId) usageSaved = true
    }
    if (!usageSaved) await cursor.record({ artifactKind: 'tool-result', stepId: CODEX_EXTRACTION_STEP_V2, attempt: 1,
      content: canonicalStringify({ version: 'codex-call-usage-v2', callId: call.callId, responseRef,
        usage: envelope.response.usage, source: 'observed-provider-fields' }) })
    if (!cursor.snapshot.events.some(event => event.type === 'model.responded' && event.payload.outputHash === responseRef!.contentHash)) {
      await cursor.append('model.responded', { stepId: CODEX_EXTRACTION_STEP_V2, attempt: 1, outputHash: responseRef.contentHash })
    }
    // Recovery deliberately does not ack/cancel a transport receipt. It uses
    // the saved reliable outcome for local postprocessing only.
    if (envelope.response.completion === 'incomplete') {
      if (!read.materials.root.productionPolicy) throw new Error('旧提取策略不能安全继续二分；原答已保留，请显式处理旧运行后开始新请求。')
      pending.push(...refineIncompleteCodexRangeV2({ sourceText: read.materials.source.rawText,
        startChar: frame.startChar, endChar: frame.endChar, completion: 'incomplete', productionPolicy: read.materials.root.productionPolicy }))
      predecessors.push(responseRef.contentHash)
      continue
    }
    if (envelope.response.completion !== 'complete') throw new Error('已保存原答未可靠完成，不能重发。')
    const entries = await parseCodexResponseForRootV2({ snapshot: cursor.snapshot, materials: read.materials, frame, raw: envelope.response.text,
      previous: new Map(completed.map(row => [row.resultRef.contentHash, row.entries])) })
    const resultRef = await cursor.record({ artifactKind: 'tool-result', stepId: CODEX_EXTRACTION_STEP_V2, attempt: 1,
      content: canonicalStringify({ version: 'codex-extraction-verified-result-v2', runId: input.runId,
        generation: call.generation, contractHash: call.contractHash, rootHash: call.rootHash, planHash: call.planHash,
        frameHash: frame.frameHash, callId: call.callId, responseRef, entries }) })
    completed.push({ frame, resultRef, entries }); state.resultRefs.push(resultRef); predecessors.push(resultRef.contentHash)
  }
  let frontier: RuntimeFrontierV2 = { material: read.material, progress: undefined, prepared: [], plan: read.plan }
  if (pending.length) {
    if (!read.materials.root.productionPolicy) throw new Error('旧冻结策略的未派发范围需要显式重新开始；原件保留，不按新策略静默发送。')
    if (!config) throw new Error('未派发范围需要原模型配置，当前未新增模型请求。')
    frontier = await prepareFrontierV2({ materials: read.materials, config, pending, completed,
      previousPlanHash: read.plan.planHash, predecessorHashes: [...new Set(predecessors)], runId: input.runId })
    const expected = read.plan.frames.find(frame => pending.some(range => range.startChar <= frame.startChar && range.endChar >= frame.endChar))?.request
    const parameters = (value: Record<string, unknown>) => { const { max_tokens: _output, ...rest } = value; return rest }
    if (expected && frontier.prepared.some(row => row.frame.request.routeHash !== expected.routeHash
      || canonicalStringify(parameters(row.frame.request.sentParameters)) !== canonicalStringify(parameters(expected.sentParameters)))) throw new Error('原实际路由或传输参数已变化，不能自动改绑恢复。')
    const saved = await saveFrontierV2(cursor, frontier)
    state.materialRef = saved.materialRef; state.planRef = saved.planRef; state.frameRefs.push(...saved.frameRefs)
    await cursor.revise(await contractForFrontierV2(read.materials, frontier))
    await cursor.checkpoint(state)
    await cursor.append('step.scheduled', { stepId: CODEX_EXTRACTION_STEP_V2 })
    await cursor.append('step.started', { stepId: CODEX_EXTRACTION_STEP_V2, attempt: 1 })
  }
  return continueCodexExtractionV2({ cursor, materials: read.materials, config, state,
    completed, predecessorHashes: [...new Set(predecessors)], frontier, signal: input.signal })
}
