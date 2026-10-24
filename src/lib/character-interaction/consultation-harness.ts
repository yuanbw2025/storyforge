import Dexie from 'dexie'
import {db} from '../db/schema'
import {scopeTransactionTables} from '../workspace/scope'
import type {WorkspaceScope, ProductProductionBriefV3, ContextManifestPointerV1} from '../types'
import {executeFrozenFormalAIEntryV1} from '../agent/formal-ai-entry'
import {hashCanonicalValue, canonicalStringify} from '../agent/run/hash'
import {createVerificationReceiptV1} from '../agent/run/verification-receipt'
import {readAgentRunV1, type AgentRunSnapshotV1} from '../agent/run/event-store'
import {createChatSourceRunHarnessV1, type ChatSourceRunPayloadV1} from './source-run-harness'
import {CHAT_CONSULTATION_PROMPT_V2, createChatPlanArtifactV2, parseChatPlanCandidateV2} from './consultation-candidate'
import {readChatConsultationContextV2, validateChatConsultationRequestV2, type ChatConsultationContextV2, type ChatConsultationRequestV2} from './consultation-context'
import {prepareChatPlanWriteV2, commitChatPlanWriteV2} from './consultation-store'
import {parseChatAuthoringSettings, type ChatAuthoringSettings} from './authoring-contract'
import {chatPlanValuesV1, type ChatPlanFieldV1, type ChatPlanChangeV1} from './consultation-plan'

const STEP = 'chat:consult-v2', VERIFIER = 'chat-consult-v2', CRITERION = 'plan.grounded-fields'
const CONFIRMATION = ['plan.confirmed', 'plan.adopted', 'plan.post-state'] as const
const hash = (value: unknown) => Dexie.currentTransaction ? Dexie.waitFor(hashCanonicalValue(value)) : hashCanonicalValue(value)
const harness = createChatSourceRunHarnessV1<ReturnType<typeof createChatPlanArtifactV2>, ChatConsultationRequestV2, ChatConsultationContextV2>({
  step: STEP, skill: 'chat.consult.v2', entry: 'chat.consultation', category: 'authoring.chat-consultation', kind: 'storyforge.chat-consultation-run',
  verifier: VERIFIER, lockKey: 'chat-consultation', prompt: CHAT_CONSULTATION_PROMPT_V2, objective: '根据作者问题与本次选中资料，起草可逐项确认的角色聊天方案；不开始制作、不改世界或知情权限',
  criterion: CRITERION, confirmationCriteria: CONFIRMATION, writeTargets: [{table: 'chatAuthoringDrafts', fields: ['settingsJson'], mode: 'author-confirmed'}],
  source: {key: 'chat.consultation', options: request => ({chatConsultationRequest: request}), read: readChatConsultationContextV2, validateRequest: validateChatConsultationRequestV2},
  createArtifact: createChatPlanArtifactV2, hasCandidate: result => !!result.candidate,
  runModel: ({formalEntry, skill, messages, resolved, scope, signal, result}) => executeFrozenFormalAIEntryV1('chat.consultation', formalEntry, skill,
    'src/lib/character-interaction/consultation-harness.ts', messages, resolved.config,
    {category: 'authoring.chat-consultation', projectId: scope.projectId, contextOverflowPolicy: 'reject'}, signal, result, undefined, resolved),
})
type Payload = ChatSourceRunPayloadV1<ReturnType<typeof createChatPlanArtifactV2>, ChatConsultationRequestV2, ChatConsultationContextV2> & {adoption?: {
  fields: ChatPlanFieldV1[]; originalCandidateHash: string; candidateHash: string; settings: ChatAuthoringSettings; revision: number; postStateHash: string; adoptionHash: string
}}
async function checked(scope: WorkspaceScope, runId: number) {
  const loaded = await harness.load(scope, runId), payload = loaded.payload as Payload, saved = payload.adoption
  const events = loaded.snapshot.events.filter(event => event.type === 'adoption.committed')
  if (!!saved !== !!events.length) throw new Error('方案正文与采纳记录不一致')
  if (saved) {
    parseChatAuthoringSettings(saved.settings)
    const candidate = parseChatPlanCandidateV2(payload.result?.candidate, payload.context)
    if (!saved.fields.length || new Set(saved.fields).size !== saved.fields.length || saved.fields.some(field => !candidate.changes.some(change => change.field === field))) throw new Error('方案采纳字段不属于原候选')
    const values = chatPlanValuesV1(saved.settings)
    if (saved.revision !== payload.context.draftRevision + 1 || saved.fields.some(field => values[field] !== candidate.changes.find(change => change.field === field)!.value)) throw new Error('方案采纳值与作者选择的候选不一致')
    const originalCandidateHash = await hash(payload.result), candidateHash = await hash({originalCandidateHash, fields: saved.fields})
    const postStateHash = await hash({settings: saved.settings, revision: saved.revision}), adoptionHash = await hash({candidateHash, postStateHash})
    if (saved.originalCandidateHash !== originalCandidateHash || saved.candidateHash !== candidateHash || saved.postStateHash !== postStateHash || saved.adoptionHash !== adoptionHash
      || events.length !== 1 || events[0].type !== 'adoption.committed' || events[0].payload.candidateHash !== candidateHash || events[0].payload.adoptionHash !== adoptionHash
      || !loaded.snapshot.events.some(event => event.type === 'candidate.revised' && event.payload.previousCandidateHash === originalCandidateHash && event.payload.candidateHash === candidateHash)
      || !loaded.snapshot.events.some(event => event.type === 'confirmation.recorded' && event.payload.candidateHash === candidateHash && event.payload.decision === 'adopt')) throw new Error('方案选择、确认或采纳证据不一致')
  }
  return {...loaded, payload}
}

export interface ChatConsultationProductionEvidenceV1 {
  runId: number
  pointer: ContextManifestPointerV1
  changes: ChatPlanChangeV1[]
  hasSelectedSources: boolean
}
/** Cheap transaction witness after semantic verification; no crypto or nested run-reader transaction. */
export async function readChatConsultationLineageWitnessV1(scope: WorkspaceScope): Promise<string> {
  const rows = await harness.runs(scope)
  return canonicalStringify(await Promise.all(rows.map(async row => {
    const checkpoints = await db.agentRunCheckpoints.where('runId').equals(row.id!).toArray()
    return {run: row, checkpoints: checkpoints.map(checkpoint => ({id: checkpoint.id, throughSequence: checkpoint.throughSequence,
      checkpointHash: checkpoint.checkpointHash, resumePayloadHash: checkpoint.resumePayloadHash}))}
  })))
}
/** Author-only lineage. Match the actual frozen Brief, never infer adoption from an answer or a pending run. */
export async function readChatConsultationProductionEvidenceV1(scope: WorkspaceScope, brief: ProductProductionBriefV3, pointers?: readonly ContextManifestPointerV1[]): Promise<ChatConsultationProductionEvidenceV1[]> {
  if (brief.intent.productType !== 'character-interaction' || !brief.characterChat) return []
  const settings = brief.characterChat, values = chatPlanValuesV1(settings), claimed = new Set<ChatPlanFieldV1>()
  const evidence: ChatConsultationProductionEvidenceV1[] = []
  for (const row of await harness.runs(scope)) {
    const snapshot = await readAgentRunV1(scope, row.id!)
    if (!snapshot.events.some(event => event.type === 'adoption.committed')) continue
    const {payload} = await checked(scope, row.id!)
    if (!payload.adoption || !payload.manifest || !snapshot.events.some(event => event.type === 'verification.accepted')) continue
    if (pointers && !pointers.some(pointer => pointer.stepId === STEP && pointer.attempt === 1 && pointer.manifestHash === payload.manifestHash)) continue
    const source = payload.context.source
    if (source && (source.worldReleaseHash !== brief.source.worldContentHash || settings.version === 1 || source.projectionHash !== settings.sourceReview?.projectionHash)) continue
    const changes = payload.result!.candidate!.changes.filter(change => payload.adoption!.fields.includes(change.field)
      && !claimed.has(change.field) && values[change.field] === change.value
      && (change.field !== 'openingSituation' || brief.intent.openingSituation === change.value)
      && (change.field !== 'playerRole' || brief.intent.playerRole === change.value)
      && (change.field !== 'experience' || brief.intent.coreExperience.includes(String(change.value)))
      && (change.field !== 'contentBoundaries' || canonicalStringify(brief.intent.contentBoundaries) === canonicalStringify(String(change.value).split('\n').map(line => line.trim()).filter(Boolean)))
      && (change.field !== 'targetPlayMinutes' || brief.scale.targetPlayMinutes === change.value))
    if (!changes.length) continue
    changes.forEach(change => claimed.add(change.field))
    evidence.push({runId: row.id!, pointer: {stepId: STEP, attempt: 1, manifestHash: payload.manifestHash}, changes: structuredClone(changes), hasSelectedSources: source !== null})
  }
  return evidence.sort((a, b) => a.pointer.manifestHash.localeCompare(b.pointer.manifestHash))
}
async function verify(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, payload: Payload) {
  if (snapshot.projection.state === 'completed') return
  const saved = payload.adoption
  if (!saved) throw new Error('方案尚未采纳')
  const committed = snapshot.events.find(event => event.type === 'adoption.committed')!
  const event = (await db.agentRunEvents.where('runId').equals(snapshot.run.id).toArray()).find(event => event.sequence === committed.sequence && event.type === 'adoption.committed')
  if (!event?.id) throw new Error('缺少方案采纳事件身份')
  if (snapshot.projection.state !== 'verifying') snapshot = await harness.append(scope, snapshot, 'verification.started', {verifierSetVersion: VERIFIER})
  const receipt = await Dexie.waitFor(createVerificationReceiptV1({version: 1, runId: snapshot.run.id, generation: snapshot.projection.generation, contractHash: snapshot.run.contractHash,
    contextManifestHashes: [payload.manifestHash], candidateHashes: [saved.candidateHash], adoptionEventIds: [event.id], postStateHash: saved.postStateHash, verifierSetVersion: VERIFIER, acceptedAt: Date.now(),
    criteria: [CRITERION, ...CONFIRMATION].map(id => ({id, status: 'passed', evidenceRefs: [`event:${event.id}`, `post-state:${saved.postStateHash}`]}))}))
  await harness.append(scope, snapshot, 'verification.accepted', {receiptHash: receipt.receiptHash})
}
export async function generateChatConsultationV2(input: Parameters<typeof harness.generate>[0]) {
  const scope = structuredClone(input.scope), view = await harness.generate({...input, scope})
  return readChatConsultationV2(scope, view.runId)
}
export async function readChatConsultationV2(scope: WorkspaceScope, runId: number) {
  const view = await harness.read(scope, runId)
  if (view.context) await checked(scope, runId)
  return {...view, candidateHash: view.result ? await hash(view.result) : null}
}
export async function readLatestChatConsultationV2(scope: WorkspaceScope) {
  const view = await harness.latest(scope)
  return view ? readChatConsultationV2(scope, view.runId) : null
}
export type ChatConsultationViewV2 = Awaited<ReturnType<typeof readChatConsultationV2>>
export async function recoverChatConsultationV2(scope: WorkspaceScope, runId: number) {
  return harness.withLock(scope, true, async () => {
    const {snapshot, payload} = await checked(scope, runId)
    if (payload.adoption) await verify(scope, snapshot, payload)
    else if (!['completed', 'failed', 'cancelled'].includes(snapshot.projection.state)) await harness.finish(scope, snapshot, payload)
    return readChatConsultationV2(scope, runId)
  })
}
export async function cancelChatConsultationV2(scope: WorkspaceScope, runId: number) {
  if ((await readAgentRunV1(scope, runId)).events.some(event => event.type === 'adoption.committed')) throw new Error('方案已采纳，请恢复回执，不能取消已保存修改')
  return harness.cancel(scope, runId)
}
export async function adoptChatConsultationV2(input: {scope: WorkspaceScope; runId: number; expectedCandidateHash: string; fields: readonly ChatPlanFieldV1[];
  onBoundary?: (boundary: 'before-commit' | 'written-in-transaction' | 'committed') => void | Promise<void>}) {
  const scope = structuredClone(input.scope), fields = [...input.fields].sort(), {runId, expectedCandidateHash} = input
  return harness.withLock(scope, true, async () => {
    const loaded = await checked(scope, runId), payload = loaded.payload
    if (await hash(payload.result) !== expectedCandidateHash || !payload.result?.candidate) throw new Error('本次方案候选已变化或不能采纳')
    if (payload.adoption) {
      if (canonicalStringify(fields) !== canonicalStringify(payload.adoption.fields)) throw new Error('本次运行已经采纳其他字段，请在已保存方案中编辑')
      await verify(scope, loaded.snapshot, payload)
      return readChatConsultationV2(scope, runId)
    }
    if (loaded.snapshot.projection.state !== 'awaiting_confirmation') throw new Error('本次方案不在等待作者确认状态')
    const prepared = await prepareChatPlanWriteV2(scope, payload.request, payload.result.candidate, fields)
    if (await hash(prepared.context) !== await hash(payload.context)) throw new Error('方案或来源已变化，请重新讨论')
    const candidateHash = await hash({originalCandidateHash: expectedCandidateHash, fields})
    const postStateHash = await hash({settings: prepared.settings, revision: prepared.expected.revision + 1}), adoptionHash = await hash({candidateHash, postStateHash})
    payload.adoption = {fields, originalCandidateHash: expectedCandidateHash, candidateHash, settings: prepared.settings, revision: prepared.expected.revision + 1, postStateHash, adoptionHash}
    await input.onBoundary?.('before-commit')
    await db.transaction('rw', scopeTransactionTables(db.chatAuthoringDrafts, db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints), async () => {
      let snapshot = await readAgentRunV1(scope, runId)
      if (snapshot.projection.lastSequence !== loaded.snapshot.projection.lastSequence || snapshot.projection.state !== 'awaiting_confirmation') throw new Error('方案任务已变化，本次没有写入')
      snapshot = await harness.append(scope, snapshot, 'candidate.revised', {stepId: STEP, attempt: 1, previousCandidateHash: expectedCandidateHash, candidateHash})
      snapshot = await harness.append(scope, snapshot, 'confirmation.recorded', {stepId: STEP, candidateHash, decision: 'adopt'})
      snapshot = await harness.append(scope, snapshot, 'adoption.started', {stepId: STEP, candidateHash, intentHash: adoptionHash})
      const saved = await commitChatPlanWriteV2(prepared)
      if (await hash({settings: JSON.parse(saved.settingsJson), revision: saved.revision}) !== postStateHash) throw new Error('方案写入结果不一致')
      await input.onBoundary?.('written-in-transaction')
      snapshot = await harness.append(scope, snapshot, 'adoption.committed', {stepId: STEP, candidateHash, adoptionHash})
      snapshot = await harness.checkpoint(scope, snapshot, payload)
      snapshot = await harness.append(scope, snapshot, 'step.succeeded', {stepId: STEP, attempt: 1, outputHash: candidateHash})
      await verify(scope, snapshot, payload)
    })
    await input.onBoundary?.('committed')
    return readChatConsultationV2(scope, runId)
  })
}
