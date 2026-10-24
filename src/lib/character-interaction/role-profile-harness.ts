import Dexie from 'dexie'
import {db} from '../db/schema'
import {scopeTransactionTables} from '../workspace/scope'
import type {WorkspaceScope} from '../types'
import {executeFrozenFormalAIEntryV1} from '../agent/formal-ai-entry'
import {hashCanonicalValue, canonicalStringify} from '../agent/run/hash'
import {createVerificationReceiptV1} from '../agent/run/verification-receipt'
import {readAgentRunV1, type AgentRunSnapshotV1} from '../agent/run/event-store'
import {createChatSourceRunHarnessV1, type ChatSourceRunPayloadV1} from './source-run-harness'
import {CHAT_ROLE_PROFILE_PROMPT_V1, createChatRoleProfileArtifactV1} from './role-profile-candidate'
import {parseChatRoleProfileCandidateV1, parseChatRoleProfileSetV1, validateChatRoleProfileEvidenceV1, type ChatRoleProfileCandidateV1, type ChatRoleProfileSetV1} from './role-profile'
import {prepareChatRoleProfileWriteV1, commitChatRoleProfileWriteV1} from './role-profile-store'

const STEP = 'chat:role-profile', VERIFIER = 'chat-role-profile-v1', CRITERION = 'profile.grounded-quotes'
const hash = (value: unknown) => Dexie.currentTransaction ? Dexie.waitFor(hashCanonicalValue(value)) : hashCanonicalValue(value)
const harness = createChatSourceRunHarnessV1({
  step: STEP, skill: 'chat.role-profile.v1', entry: 'chat.role-profile', category: 'authoring.chat-role-profile',
  kind: 'storyforge.chat-role-profile-run', verifier: VERIFIER, lockKey: 'chat-role-profile',
  prompt: CHAT_ROLE_PROFILE_PROMPT_V1, objective: '基于指定角色已知原文生成带引用的人物理解，作者审定后用于新制作；不修改世界或知情范围', criterion: CRITERION,
  writeTargets: [{table: 'chatAuthoringDrafts', fields: ['roleProfilesJson'], mode: 'author-confirmed'}],
  createArtifact: createChatRoleProfileArtifactV1, hasCandidate: result => !!result.candidate,
  validateContext: context => {
    if (!context.perspective || !context.fragments.some(row => row.resourceKey === context.perspective!.actorKey)) throw new Error('人物整理必须指定AI角色并选择至少一项该人物自己的已知资料')
  },
  runModel: ({formalEntry, skill, messages, resolved, scope, signal, result}) => executeFrozenFormalAIEntryV1('chat.role-profile', formalEntry, skill,
    'src/lib/character-interaction/role-profile-harness.ts', messages, resolved.config,
    {category: 'authoring.chat-role-profile', projectId: scope.projectId, contextOverflowPolicy: 'reject'}, signal, result, undefined, resolved),
})
type Payload = ChatSourceRunPayloadV1<ReturnType<typeof createChatRoleProfileArtifactV1>> & {adoption?: {
  candidate: ChatRoleProfileCandidateV1; originalCandidateHash: string; candidateHash: string; profileSet: ChatRoleProfileSetV1
  revision: number; postStateHash: string; adoptionHash: string
}}

async function checked(scope: WorkspaceScope, runId: number) {
  const loaded = await harness.load(scope, runId), payload = loaded.payload as Payload, saved = payload.adoption
  const adopted = loaded.snapshot.events.filter(row => row.type === 'adoption.committed')
  if (!!saved !== !!adopted.length) throw new Error('人物整理的正文与采纳记录不一致')
  if (saved) {
    validateChatRoleProfileEvidenceV1(saved.candidate, payload.context)
    parseChatRoleProfileSetV1(saved.profileSet)
    const profile = saved.profileSet.profiles.find(row => row.actorKey === payload.context.perspective?.actorKey)
    const originalCandidateHash = await hash(payload.result)
    const candidateHash = await hash({originalCandidateHash, candidate: saved.candidate})
    const postStateHash = await hash({profiles: saved.profileSet, revision: saved.revision})
    const adoptionHash = await hash({candidateHash, postStateHash})
    if (!profile || canonicalStringify(profile.candidate) !== canonicalStringify(saved.candidate)
      || saved.originalCandidateHash !== originalCandidateHash || saved.candidateHash !== candidateHash || saved.postStateHash !== postStateHash || saved.adoptionHash !== adoptionHash
      || adopted.length !== 1 || adopted[0].type !== 'adoption.committed' || adopted[0].payload.candidateHash !== candidateHash || adopted[0].payload.adoptionHash !== adoptionHash
      || !loaded.snapshot.events.some(row => row.type === 'candidate.revised' && row.payload.previousCandidateHash === originalCandidateHash && row.payload.candidateHash === candidateHash)
      || !loaded.snapshot.events.some(row => row.type === 'confirmation.recorded' && row.payload.candidateHash === candidateHash && row.payload.decision === 'adopt')) throw new Error('人物整理的修订、确认或采纳证据不一致')
  }
  return {...loaded, payload}
}

/** Rebuild a receipt after import using the portable committed snapshot; never rewrite a newer draft. */
async function verify(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, payload: Payload) {
  if (snapshot.projection.state === 'completed') return
  const adoption = payload.adoption
  if (!adoption) throw new Error('人物整理尚未采纳')
  const committed = snapshot.events.find(row => row.type === 'adoption.committed')!
  const event = (await db.agentRunEvents.where('runId').equals(snapshot.run.id).toArray()).find(row => row.sequence === committed.sequence && row.type === 'adoption.committed')
  if (!event?.id) throw new Error('缺少采纳事件身份')
  if (snapshot.projection.state !== 'verifying') snapshot = await harness.append(scope, snapshot, 'verification.started', {verifierSetVersion: VERIFIER})
  const receipt = await Dexie.waitFor(createVerificationReceiptV1({version: 1, runId: snapshot.run.id, generation: snapshot.projection.generation,
    contractHash: snapshot.run.contractHash, contextManifestHashes: [payload.manifestHash], candidateHashes: [adoption.candidateHash], adoptionEventIds: [event.id],
    postStateHash: adoption.postStateHash, verifierSetVersion: VERIFIER, acceptedAt: Date.now(),
    criteria: [CRITERION, 'profile.confirmed', 'profile.adopted', 'profile.post-state'].map(id => ({id, status: 'passed', evidenceRefs: [`event:${event.id}`, `post-state:${adoption.postStateHash}`]}))}))
  await harness.append(scope, snapshot, 'verification.accepted', {receiptHash: receipt.receiptHash})
}

export async function generateChatRoleProfileCandidateV1(input: Parameters<typeof harness.generate>[0]) {
  const scope = structuredClone(input.scope)
  const view = await harness.generate({...input, scope})
  return readChatRoleProfileRunV1(scope, view.runId)
}
export async function readChatRoleProfileRunV1(scope: WorkspaceScope, runId: number) {
  const view = await harness.read(scope, runId)
  if (view.context) await checked(scope, runId)
  return {...view, candidateHash: view.result ? await hash(view.result) : null}
}
export async function readLatestChatRoleProfileRunV1(scope: WorkspaceScope) {
  const view = await harness.latest(scope)
  return view ? readChatRoleProfileRunV1(scope, view.runId) : null
}
export type ChatRoleProfileRunViewV1 = Awaited<ReturnType<typeof readChatRoleProfileRunV1>>
export async function recoverChatRoleProfileRunV1(scope: WorkspaceScope, runId: number) {
  return harness.withLock(scope, true, async () => {
    const {snapshot, payload} = await checked(scope, runId)
    if (payload.adoption) await verify(scope, snapshot, payload)
    else if (!['completed', 'failed', 'cancelled'].includes(snapshot.projection.state)) await harness.finish(scope, snapshot, payload)
    return readChatRoleProfileRunV1(scope, runId)
  })
}
export async function cancelChatRoleProfileRunV1(scope: WorkspaceScope, runId: number) {
  const snapshot = await readAgentRunV1(scope, runId)
  if (snapshot.events.some(row => row.type === 'adoption.committed')) throw new Error('人物整理已采纳，请恢复回执，不能取消已保存内容')
  return harness.cancel(scope, runId)
}

export async function adoptChatRoleProfileCandidateV1(input: {
  scope: WorkspaceScope; runId: number; expectedCandidateHash: string; candidate: unknown
  onBoundary?: (boundary: 'before-commit' | 'written-in-transaction' | 'committed') => void | Promise<void>
}) {
  const scope = structuredClone(input.scope), candidate = parseChatRoleProfileCandidateV1(input.candidate), {runId, expectedCandidateHash} = input
  return harness.withLock(scope, true, async () => {
    const loaded = await checked(scope, runId), payload = loaded.payload
    if (await hash(payload.result) !== expectedCandidateHash || !payload.result?.candidate) throw new Error('本次人物候选已变化或不能采纳')
    if (payload.adoption) {
      if (canonicalStringify(candidate) !== canonicalStringify(payload.adoption.candidate)) throw new Error('本次运行已经采纳其他修订，请在已保存人物整理中编辑')
      await verify(scope, loaded.snapshot, payload)
      return readChatRoleProfileRunV1(scope, runId)
    }
    if (loaded.snapshot.projection.state !== 'awaiting_confirmation') throw new Error('本次人物整理不在等待作者确认状态')
    validateChatRoleProfileEvidenceV1(candidate, payload.context)
    const prepared = await prepareChatRoleProfileWriteV1(scope, payload.request, candidate)
    const candidateHash = await hash({originalCandidateHash: expectedCandidateHash, candidate})
    const postStateHash = await hash({profiles: prepared.set, revision: prepared.expected.revision + 1})
    const adoptionHash = await hash({candidateHash, postStateHash})
    payload.adoption = {candidate, originalCandidateHash: expectedCandidateHash, candidateHash, profileSet: prepared.set, revision: prepared.expected.revision + 1, postStateHash, adoptionHash}
    await input.onBoundary?.('before-commit')
    await db.transaction('rw', scopeTransactionTables(db.chatAuthoringDrafts, db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints), async () => {
      let snapshot = await readAgentRunV1(scope, runId)
      if (snapshot.projection.lastSequence !== loaded.snapshot.projection.lastSequence || snapshot.projection.state !== 'awaiting_confirmation') throw new Error('人物整理任务已变化，本次没有写入')
      snapshot = await harness.append(scope, snapshot, 'candidate.revised', {stepId: STEP, attempt: 1, previousCandidateHash: expectedCandidateHash, candidateHash})
      snapshot = await harness.append(scope, snapshot, 'confirmation.recorded', {stepId: STEP, candidateHash, decision: 'adopt'})
      snapshot = await harness.append(scope, snapshot, 'adoption.started', {stepId: STEP, candidateHash, intentHash: adoptionHash})
      const saved = await commitChatRoleProfileWriteV1(prepared)
      if (await hash({profiles: JSON.parse(saved.roleProfilesJson!), revision: saved.revision}) !== postStateHash) throw new Error('人物整理写入结果不一致')
      await input.onBoundary?.('written-in-transaction')
      snapshot = await harness.append(scope, snapshot, 'adoption.committed', {stepId: STEP, candidateHash, adoptionHash})
      snapshot = await harness.checkpoint(scope, snapshot, payload)
      snapshot = await harness.append(scope, snapshot, 'step.succeeded', {stepId: STEP, attempt: 1, outputHash: candidateHash})
      await verify(scope, snapshot, payload)
    })
    await input.onBoundary?.('committed')
    return readChatRoleProfileRunV1(scope, runId)
  })
}
