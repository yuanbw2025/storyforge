import Dexie from 'dexie'
import {db} from '../db/schema'
import {scopeTransactionTables} from '../workspace/scope'
import type {WorkspaceScope} from '../types'
import {executeFrozenFormalAIEntryV1} from '../agent/formal-ai-entry'
import {hashCanonicalValue, canonicalStringify} from '../agent/run/hash'
import {createVerificationReceiptV1} from '../agent/run/verification-receipt'
import {readAgentRunV1, type AgentRunSnapshotV1} from '../agent/run/event-store'
import {createChatSourceRunHarnessV1, type ChatSourceRunPayloadV1} from './source-run-harness'
import {readChatSourceUnitConfirmationContextV1, validateChatSourceUnitConfirmationRequestV1, type ChatSourceUnitConfirmationRequestV1, type ChatSourceUnitConfirmationContextV1} from './source-unit-confirmation-context'
import {createChatSourceUnitConfirmationArtifactV1} from './source-unit-confirmation-candidate'
import {chatSourceUnitConfirmationPromptV1} from './source-unit-discovery-policy'
import {parseChatSourceUnitSetV1, type ChatSourceUnitSetV1} from './source-unit-authorization'
import {prepareChatSourceUnitWriteV1, commitChatSourceUnitWriteV1} from './source-unit-store'

const STEP = 'chat:source-unit-confirmation', VERIFIER = 'chat-source-unit-confirmation-v1', CRITERION = 'source-units.interpretation-and-permissions'
const CRITERIA = ['source-units.confirmed', 'source-units.adopted', 'source-units.post-state'] as const
const hash = (value: unknown) => Dexie.currentTransaction ? Dexie.waitFor(hashCanonicalValue(value)) : hashCanonicalValue(value)
const harness = createChatSourceRunHarnessV1({
  step: STEP, skill: 'chat.source-unit-confirmation.v1', entry: 'chat.source-unit-confirmation', category: 'authoring.chat-source-unit-confirmation',
  kind: 'storyforge.chat-source-unit-confirmation-run', verifier: VERIFIER, lockKey: 'chat-source-unit-confirmation',
  prompt: chatSourceUnitConfirmationPromptV1, objective: '独立复核事实、初知和发现条件；只有精确候选获得作者确认后才保存产品私域整理', criterion: CRITERION,
  confirmationCriteria: CRITERIA, writeTargets: [{table: 'chatAuthoringDrafts', fields: ['sourceUnitsJson'], mode: 'author-confirmed'}],
  source: {key: 'chat.source-unit-confirmation', options: (request: ChatSourceUnitConfirmationRequestV1) => ({chatSourceUnitConfirmationRequest: request}),
    read: readChatSourceUnitConfirmationContextV1, validateRequest: validateChatSourceUnitConfirmationRequestV1},
  createArtifact: createChatSourceUnitConfirmationArtifactV1, hasCandidate: result => result.passed,
  runModel: ({formalEntry, skill, messages, resolved, scope, signal, result}) => executeFrozenFormalAIEntryV1('chat.source-unit-confirmation', formalEntry, skill,
    'src/lib/character-interaction/source-unit-confirmation-harness.ts', messages, resolved.config,
    {category: 'authoring.chat-source-unit-confirmation', projectId: scope.projectId, contextOverflowPolicy: 'reject'}, signal, result, undefined, resolved),
})
type Payload = ChatSourceRunPayloadV1<ReturnType<typeof createChatSourceUnitConfirmationArtifactV1>, ChatSourceUnitConfirmationRequestV1, ChatSourceUnitConfirmationContextV1> & {
  adoption?: {originalCandidateHash: string; candidateHash: string; unitSet: ChatSourceUnitSetV1; revision: number; postStateHash: string; adoptionHash: string}
}
async function checked(scope: WorkspaceScope, runId: number) {
  const loaded = await harness.load(scope, runId), payload = loaded.payload as Payload, saved = payload.adoption
  const events = loaded.snapshot.events.filter(row => row.type === 'adoption.committed')
  if (!!saved !== !!events.length) throw new Error('事实正文与采纳记录不一致')
  if (saved) {
    const set = parseChatSourceUnitSetV1(saved.unitSet)
    const expected = {...payload.context, review: payload.result?.report}
    const originalCandidateHash = await hash(payload.result), candidateHash = await hash({originalCandidateHash, candidate: payload.context.candidate, permissions: payload.context.permissions})
    const postStateHash = await hash({units: set, revision: saved.revision}), adoptionHash = await hash({candidateHash, postStateHash})
    if (!payload.result?.passed || !set.bundles.some(bundle => canonicalStringify(bundle) === canonicalStringify(expected))
      || saved.originalCandidateHash !== originalCandidateHash || saved.candidateHash !== candidateHash || saved.postStateHash !== postStateHash || saved.adoptionHash !== adoptionHash
      || events.length !== 1 || events[0].type !== 'adoption.committed' || events[0].payload.candidateHash !== candidateHash || events[0].payload.adoptionHash !== adoptionHash
      || !loaded.snapshot.events.some(row => row.type === 'candidate.revised' && row.payload.previousCandidateHash === originalCandidateHash && row.payload.candidateHash === candidateHash)
      || !loaded.snapshot.events.some(row => row.type === 'confirmation.recorded' && row.payload.candidateHash === candidateHash && row.payload.decision === 'adopt')) throw new Error('事实确认、复核或采纳证据不一致')
  }
  return {...loaded, payload}
}
async function verify(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, payload: Payload) {
  if (snapshot.projection.state === 'completed') return
  const adoption = payload.adoption
  if (!adoption) throw new Error('事实尚未采纳')
  const committed = snapshot.events.find(row => row.type === 'adoption.committed')!
  const event = (await db.agentRunEvents.where('runId').equals(snapshot.run.id).toArray()).find(row => row.sequence === committed.sequence && row.type === 'adoption.committed')
  if (!event?.id) throw new Error('缺少事实采纳事件身份')
  if (snapshot.projection.state !== 'verifying') snapshot = await harness.append(scope, snapshot, 'verification.started', {verifierSetVersion: VERIFIER})
  const receipt = await Dexie.waitFor(createVerificationReceiptV1({version: 1, runId: snapshot.run.id, generation: snapshot.projection.generation,
    contractHash: snapshot.run.contractHash, contextManifestHashes: [payload.manifestHash], candidateHashes: [adoption.candidateHash], adoptionEventIds: [event.id],
    postStateHash: adoption.postStateHash, verifierSetVersion: VERIFIER, acceptedAt: Date.now(),
    criteria: [CRITERION, ...CRITERIA].map(id => ({id, status: 'passed', evidenceRefs: [`event:${event.id}`, `post-state:${adoption.postStateHash}`]}))}))
  await harness.append(scope, snapshot, 'verification.accepted', {receiptHash: receipt.receiptHash})
}
export async function readChatSourceUnitConfirmationRunV1(scope: WorkspaceScope, runId: number) {
  const view = await harness.read(scope, runId)
  if (view.context) await checked(scope, runId)
  return {...view, candidateHash: view.result ? await hash(view.result) : null}
}
export async function readLatestChatSourceUnitConfirmationRunV1(scope: WorkspaceScope) {
  const view = await harness.latest(scope)
  return view ? readChatSourceUnitConfirmationRunV1(scope, view.runId) : null
}
export async function reviewChatSourceUnitConfirmationV1(input: Parameters<typeof harness.generate>[0]) {
  const view = await harness.generate(input)
  return readChatSourceUnitConfirmationRunV1(input.scope, view.runId)
}
export async function recoverChatSourceUnitConfirmationV1(scope: WorkspaceScope, runId: number) {
  return harness.withLock(scope, true, async () => {
    const {snapshot, payload} = await checked(scope, runId)
    if (payload.adoption) await verify(scope, snapshot, payload)
    else if (!['completed', 'failed', 'cancelled'].includes(snapshot.projection.state)) await harness.finish(scope, snapshot, payload)
    return readChatSourceUnitConfirmationRunV1(scope, runId)
  })
}
export async function cancelChatSourceUnitConfirmationV1(scope: WorkspaceScope, runId: number) {
  if ((await readAgentRunV1(scope, runId)).events.some(row => row.type === 'adoption.committed')) throw new Error('事实已保存，请恢复回执；不能取消已提交内容')
  return harness.cancel(scope, runId)
}
export async function adoptChatSourceUnitConfirmationV1(input: {scope: WorkspaceScope; runId: number; expectedCandidateHash: string; candidate: unknown; permissions: unknown;
  onBoundary?: (boundary: 'before-commit' | 'written-in-transaction' | 'committed') => void | Promise<void>}) {
  const {scope, runId, expectedCandidateHash, candidate, permissions} = structuredClone({...input, onBoundary: undefined})
  return harness.withLock(scope, true, async () => {
    const loaded = await checked(scope, runId), payload = loaded.payload
    if (!payload.result?.passed || !payload.result.report || await hash(payload.result) !== expectedCandidateHash
      || canonicalStringify(candidate) !== canonicalStringify(payload.context.candidate) || canonicalStringify(permissions) !== canonicalStringify(payload.context.permissions)) throw new Error('当前事实或权限与复核结果不符，请重新复核')
    if (payload.adoption) {await verify(scope, loaded.snapshot, payload); return readChatSourceUnitConfirmationRunV1(scope, runId)}
    if (loaded.snapshot.projection.state !== 'awaiting_confirmation') throw new Error('本次复核不在等待作者确认状态')
    const prepared = await prepareChatSourceUnitWriteV1(scope, payload.request, payload.result.report)
    if (canonicalStringify(prepared.context) !== canonicalStringify(payload.context)) throw new Error('复核后原文、分类或前提已经变化')
    const candidateHash = await hash({originalCandidateHash: expectedCandidateHash, candidate, permissions}), postStateHash = await hash({units: prepared.set, revision: prepared.expected.revision + 1})
    const adoptionHash = await hash({candidateHash, postStateHash})
    payload.adoption = {originalCandidateHash: expectedCandidateHash, candidateHash, unitSet: prepared.set, revision: prepared.expected.revision + 1, postStateHash, adoptionHash}
    await input.onBoundary?.('before-commit')
    await db.transaction('rw', scopeTransactionTables(db.chatAuthoringDrafts, db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints), async () => {
      let snapshot = await readAgentRunV1(scope, runId)
      if (snapshot.projection.lastSequence !== loaded.snapshot.projection.lastSequence || snapshot.projection.state !== 'awaiting_confirmation') throw new Error('确认任务已变化，本次没有写入')
      snapshot = await harness.append(scope, snapshot, 'candidate.revised', {stepId: STEP, attempt: 1, previousCandidateHash: expectedCandidateHash, candidateHash})
      snapshot = await harness.append(scope, snapshot, 'confirmation.recorded', {stepId: STEP, candidateHash, decision: 'adopt'})
      snapshot = await harness.append(scope, snapshot, 'adoption.started', {stepId: STEP, candidateHash, intentHash: adoptionHash})
      const saved = await commitChatSourceUnitWriteV1(prepared)
      if (await hash({units: JSON.parse(saved.sourceUnitsJson!), revision: saved.revision}) !== postStateHash) throw new Error('事实写入结果不一致')
      await input.onBoundary?.('written-in-transaction')
      snapshot = await harness.append(scope, snapshot, 'adoption.committed', {stepId: STEP, candidateHash, adoptionHash})
      snapshot = await harness.checkpoint(scope, snapshot, payload)
      snapshot = await harness.append(scope, snapshot, 'step.succeeded', {stepId: STEP, attempt: 1, outputHash: candidateHash})
      await verify(scope, snapshot, payload)
    })
    await input.onBoundary?.('committed')
    return readChatSourceUnitConfirmationRunV1(scope, runId)
  })
}
export type ChatSourceUnitConfirmationViewV1 = Awaited<ReturnType<typeof readChatSourceUnitConfirmationRunV1>>
