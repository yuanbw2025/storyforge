import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {seedChatRoleProfileFixture} from '../helpers/chat-role-profile'
import {generateChatRoleProfileCandidateV1, readChatRoleProfileRunV1, readLatestChatRoleProfileRunV1, adoptChatRoleProfileCandidateV1, recoverChatRoleProfileRunV1, cancelChatRoleProfileRunV1} from '../../src/lib/character-interaction/role-profile-harness'
import {readAgentRunV1} from '../../src/lib/agent/run/event-store'
import {readChatDraftV1, saveChatDraftV1, createChatDraftV2} from '../../src/lib/character-interaction/draft-service'
import {parseChatAuthoringSettings} from '../../src/lib/character-interaction/authoring-contract'
import {readChatRoleProfilesV1, removeChatRoleProfileV1} from '../../src/lib/character-interaction/role-profile-store'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function ready() {
  const f = await seedChatRoleProfileFixture(), runAI = vi.fn(async () => JSON.stringify(f.candidate))
  const view = await generateChatRoleProfileCandidateV1({scope: f.scope, request: f.request, runAI})
  const confirmation = {scope: f.scope, runId: view.runId, expectedCandidateHash: view.candidateHash!, candidate: f.candidate}
  return {...f, view, runAI, confirmation}
}

it('uses a distinct writable contract and waits for edited author confirmation before the atomic profile/receipt commit', async () => {
  const f = await ready(), world = await db.worldReleases.toArray()
  expect(f.view.status).toBe('ready'); expect(f.view.result!.artifact.status).toBe('usable-with-warnings')
  expect((await readChatDraftV1(f.scope)).roleProfilesJson).toBeUndefined()
  const before = await readAgentRunV1(f.scope, f.view.runId)
  expect(before.projection.state).toBe('awaiting_confirmation')
  expect(before.contract.executionBindings![0].formalEntry!.entryId).toBe('chat.role-profile')
  expect(JSON.parse(before.contract.executionBindings![0].formalEntry!.bindingJson).adoptAllowed).toBe(true)
  expect(before.contract.permissions.writeTargets).toEqual([{table: 'chatAuthoringDrafts', fields: ['roleProfilesJson'], mode: 'author-confirmed'}])
  const edited = structuredClone(f.candidate); edited.traits[0].text = '面对不确定情况保持谨慎，不轻易放弃立场。'
  const adopted = await adoptChatRoleProfileCandidateV1({...f.confirmation, candidate: edited})
  expect(adopted.status).toBe('adopted')
  expect((await readChatRoleProfilesV1(f.scope))!.profiles[0].candidate).toEqual(edited)
  expect((await readChatDraftV1(f.scope)).revision).toBe(f.draft.revision + 1)
  const after = await readAgentRunV1(f.scope, f.view.runId)
  expect(after.projection.state).toBe('completed')
  for (const type of ['candidate.persisted', 'candidate.revised', 'confirmation.recorded', 'adoption.committed', 'verification.accepted']) expect(after.events.filter(row => row.type === type)).toHaveLength(1)
  expect(await adoptChatRoleProfileCandidateV1({...f.confirmation, candidate: edited})).toEqual(adopted)
  expect((await readChatDraftV1(f.scope)).revision).toBe(f.draft.revision + 1)
  expect(await db.worldReleases.toArray()).toEqual(world)
  expect(f.runAI).toHaveBeenCalledTimes(1)
})

it.each(['response.saved', 'model.responded', 'candidate.persisted'] as const)('recovers the retained candidate after %s without a call or profile write', async boundary => {
  const f = await seedChatRoleProfileFixture(), runAI = vi.fn(async () => JSON.stringify(f.candidate)); let runId = 0
  await expect(generateChatRoleProfileCandidateV1({scope: f.scope, request: f.request, runAI, onBoundary: (point, id) => {runId = id; if (point === boundary) throw new Error('interruption')}})).rejects.toThrow('interruption')
  const recovered = await recoverChatRoleProfileRunV1(f.scope, runId)
  expect(recovered.status).toBe('ready'); expect(recovered.result!.candidate).toEqual(f.candidate)
  expect((await readChatDraftV1(f.scope)).roleProfilesJson).toBeUndefined()
  expect(runAI).toHaveBeenCalledTimes(1)
})

it('rolls back both profile and ledger on an interrupted write, and never repeats a committed write', async () => {
  const f = await ready()
  await expect(adoptChatRoleProfileCandidateV1({...f.confirmation, onBoundary: point => {if (point === 'written-in-transaction') throw new Error('rollback')}})).rejects.toThrow('rollback')
  expect((await readChatDraftV1(f.scope)).roleProfilesJson).toBeUndefined()
  expect((await readAgentRunV1(f.scope, f.view.runId)).projection.state).toBe('awaiting_confirmation')
  await expect(adoptChatRoleProfileCandidateV1({...f.confirmation, onBoundary: point => {if (point === 'committed') throw new Error('after-commit')}})).rejects.toThrow('after-commit')
  const saved = await readChatDraftV1(f.scope)
  expect((await recoverChatRoleProfileRunV1(f.scope, f.view.runId)).status).toBe('adopted')
  await adoptChatRoleProfileCandidateV1(f.confirmation)
  expect(await readChatDraftV1(f.scope)).toEqual(saved)
  await expect(cancelChatRoleProfileRunV1(f.scope, f.view.runId)).rejects.toThrow('已采纳')
})

it('rejects stale draft races, altered evidence, another Work and mismatched candidate bindings without adoption', async () => {
  const f = await ready(), other = await createChatDraftV2('其他作品')
  await expect(readChatRoleProfileRunV1(other.scope, f.view.runId)).rejects.toThrow()
  await expect(adoptChatRoleProfileCandidateV1({...f.confirmation, expectedCandidateHash: '0'.repeat(64)})).rejects.toThrow('已变化')
  const wrong = structuredClone(f.candidate); wrong.traits[0].evidence[0].quote = '原文没有出现'
  await expect(adoptChatRoleProfileCandidateV1({...f.confirmation, candidate: wrong})).rejects.toThrow('连续文字')
  await expect(adoptChatRoleProfileCandidateV1({...f.confirmation, onBoundary: async point => {
    if (point === 'before-commit') await saveChatDraftV1(f.scope, f.draft.revision, {...parseChatAuthoringSettings(JSON.parse(f.draft.settingsJson)), playerRole: '最新身份'})
  }})).rejects.toThrow('没有写入')
  expect((await readChatDraftV1(f.scope)).roleProfilesJson).toBeUndefined()
  expect((await readChatRoleProfileRunV1(f.scope, f.view.runId)).status).toBe('stale')
  expect((await readAgentRunV1(f.scope, f.view.runId)).events.some(row => row.type === 'adoption.committed')).toBe(false)
})

it('requires a known actor and own source before a request, retains invalid responses and fences unknown results until explicit dismissal', async () => {
  const f = await seedChatRoleProfileFixture(), call = vi.fn(async () => JSON.stringify(f.candidate))
  const {actorKey: _actor, ...authorRequest} = f.request
  await expect(generateChatRoleProfileCandidateV1({scope: f.scope, request: authorRequest, runAI: call})).rejects.toThrow('必须指定')
  expect(call).not.toHaveBeenCalled(); expect(await db.agentRuns.count()).toBe(0)
  const invalid = await generateChatRoleProfileCandidateV1({scope: f.scope, request: f.request, runAI: async () => '{"traits":[]}'})
  expect(invalid.status).toBe('blocked'); expect(invalid.result!.artifact.originalText).toBe('{"traits":[]}')
  await expect(adoptChatRoleProfileCandidateV1({scope: f.scope, runId: invalid.runId, expectedCandidateHash: invalid.candidateHash!, candidate: f.candidate})).rejects.toThrow('不能采纳')
  await expect(generateChatRoleProfileCandidateV1({scope: f.scope, request: f.request, runAI: async () => {throw new Error('unknown')}})).rejects.toThrow('unknown')
  const unknown = (await readLatestChatRoleProfileRunV1(f.scope))!
  expect(unknown.status).toBe('unknown')
  await expect(recoverChatRoleProfileRunV1(f.scope, unknown.runId)).rejects.toThrow('不能自动重发')
  await expect(generateChatRoleProfileCandidateV1({scope: f.scope, request: f.request, runAI: call})).rejects.toThrow('尚未结束')
  expect(call).not.toHaveBeenCalled()
  await cancelChatRoleProfileRunV1(f.scope, unknown.runId)
  expect((await generateChatRoleProfileCandidateV1({scope: f.scope, request: f.request, runAI: call})).status).toBe('ready')
})

it('restores an unadopted candidate after import and revalidates an adopted historical receipt without reverting later author edits', async () => {
  const f = await ready()
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const draft = (await db.chatAuthoringDrafts.where('projectId').equals(projectId).first())!, scope = {projectId, worldId: draft.worldId, workId: draft.workId}
  const imported = (await db.agentRuns.where('projectId').equals(projectId).first())!
  const candidate = await recoverChatRoleProfileRunV1(scope, imported.id!)
  expect(candidate.status).toBe('ready')
  await adoptChatRoleProfileCandidateV1({scope, runId: imported.id!, expectedCandidateHash: candidate.candidateHash!, candidate: f.candidate})
  const saved = await readChatDraftV1(scope)
  await removeChatRoleProfileV1(scope, saved.revision, f.actor.resourceKey)
  const again = await importProjectJSON(await exportProjectJSON(projectId))
  const moved = (await db.chatAuthoringDrafts.where('projectId').equals(again).first())!, movedScope = {projectId: again, worldId: moved.worldId, workId: moved.workId}
  const movedRun = (await db.agentRuns.where('projectId').equals(again).first())!
  expect((await recoverChatRoleProfileRunV1(movedScope, movedRun.id!)).status).toBe('adopted')
  expect((await readChatRoleProfilesV1(movedScope))!.profiles).toEqual([])
  expect(await readChatDraftV1(movedScope)).toEqual(moved)
  expect(f.runAI).toHaveBeenCalledTimes(1)
})
