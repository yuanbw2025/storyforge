import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {createChatDraftV3} from '../../src/lib/character-interaction/draft-service'
import {previewChatExperiencePackageV1, installChatExperiencePackageV1} from '../../src/lib/character-interaction/experience-package'
import {readChatReleaseUpgradePlanV1} from '../../src/lib/character-interaction/release-upgrade-plan'
import * as upgradePlans from '../../src/lib/character-interaction/release-upgrade-plan'
import {copyChatSaveToReleaseV1} from '../../src/lib/character-interaction/release-upgrade'
import {seedChatExperiencePackageFixture} from '../helpers/chat-experience-package-fixture'
import {useCharacterInteractionPlayerStore as player} from '../../src/stores/character-interaction-player'
import {commitInteractionPlayerMessage, deleteProductRuntimeSession, readProductRuntimeState, readProductRuntimeStateVersion,
  requestChatNarrativeTrigger, saveChatComposerDraftV1} from '../../src/lib/character-interaction/runtime-api'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {chatActionReviewOutputFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {readChatMessageEditPlanV1, forkChatMessageEditV1} from '../../src/lib/character-interaction/narrative-edit'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'
import {assertChatReleaseUpgradeReceiptV1} from '../../src/lib/character-interaction/release-upgrade-receipt'

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).buffer
beforeEach(async () => {db.close(); await db.delete(); await db.open(); player.setState({scope: null, busy: false, selectedSessionId: null})})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function fixture(options: {secondOrdinaryScene?: boolean} = {}) {
  const f = await seedChatExperiencePackageFixture(options), target = await createChatDraftV3('存档升级工程核验')
  const source = await installChatExperiencePackageV1(await previewChatExperiencePackageV1({scope: target.scope, bytes: bytes(f.original)}))
  const next = await installChatExperiencePackageV1(await previewChatExperiencePackageV1({scope: target.scope, bytes: bytes(f.illustrated)}))
  await player.getState().load(target.scope, null)
  const parentSessionId = await player.getState().start(source.id!, '旧版本的故事', options.secondOrdinaryScene ? {sceneKey: 'courtyard'} : undefined)
  await player.getState().sendPlayerMessage('请把灯移到门边，我想先坐一会儿。')
  return {scope: target.scope, parentSessionId, targetReleaseId: next.id!, source, next}
}
async function command(sessionId: number) {
  const v = await readProductRuntimeStateVersion(sessionId)
  return {sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}
}
const action: ChatNarrativeActionV1 = {kind: 'complete', text: '我把灯移到门边。门边亮了起来。', goalKey: 'find-seal', evidenceFactKeys: ['lost'],
  audienceKeys: ['guard', 'player'], waitingForPlayer: false,
  newFacts: [{factKey: 'lit-door', kind: 'observation', text: '门边亮了起来。', evidenceFactKeys: ['lost'], evidenceExcerpt: '门边亮了起来。'}],
  disclosures: [], threadUpdates: [], goalStatus: null}
async function candidate(f: Awaited<ReturnType<typeof fixture>>, inspect?: (messages: unknown) => void, output = action) {
  const state = await readProductRuntimeState(f.parentSessionId), message = state.interaction!.messages.at(-1)!
  const trigger = await requestChatNarrativeTrigger({...await command(f.parentSessionId), kind: 'player-response', sourceEventSequence: message.eventSequence})
  return generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.parentSessionId, participantKey: 'guard',
    skillId: 'character.chat-narrative-action', narrativeTriggerSequence: trigger.sequence, objective: '工程核验',
    runAI: withChatActionChoiceFixture(async messages => {inspect?.(messages); return JSON.stringify(output)}), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
}

it('copies settled story progress once, preserves old state and unsent text, and continues independently after backup and parent deletion', async () => {
  const f = await fixture(), generated = await candidate(f)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  await saveChatComposerDraftV1({scope: f.scope, sessionId: f.parentSessionId, expectedRevision: 0, text: '还没有发送的私密草稿', audienceKeys: ['guard']})
  const parent = await db.productRuntimeSessions.get(f.parentSessionId), events = await db.productRuntimeEvents.where('sessionId').equals(f.parentSessionId).toArray()
  const before = await readProductRuntimeState(f.parentSessionId), plan = await readChatReleaseUpgradePlanV1(f)
  expect(plan).toMatchObject({canCopy: true, blockers: [], sourceSequence: before.lastSequence})
  expect(JSON.stringify(plan)).not.toContain('私密草稿')
  const input = {scope: f.scope, title: '图片版本的故事', request: {parentSessionId: f.parentSessionId,
    targetReleaseId: f.targetReleaseId, expectedPlanHash: plan.planHash, commandId: 'upgrade.once'}}
  const [child, repeat] = await Promise.all([copyChatSaveToReleaseV1(input), copyChatSaveToReleaseV1(input)])
  expect(repeat.id).toBe(child.id)
  expect(child).toMatchObject({parentSessionId: f.parentSessionId, parentThroughSequence: before.lastSequence, productReleaseId: f.targetReleaseId, runtimeSourceHash: plan.compatibility.targetPackageHash})
  expect(await db.productRuntimeSessions.get(f.parentSessionId)).toEqual(parent)
  expect(await db.productRuntimeEvents.where('sessionId').equals(f.parentSessionId).toArray()).toEqual(events)
  expect(await db.agentRuns.where('productRuntimeSessionId').equals(child.id!).count()).toBe(0)
  expect(child.chatComposerDraft).toBeUndefined()
  let copied = await readProductRuntimeState(child.id!)
  expect(copied.lastSequence).toBe(1)
  expect(copied.interaction!.messages.map(message => message.text)).toEqual(before.interaction!.messages.map(message => message.text))
  expect(copied.interaction!.messages.every(message => message.eventSequence < 0)).toBe(true)
  const expectedFacts = structuredClone(before.interaction!.chatNarrative!.situation.facts)
  expectedFacts.find(fact => fact.factKey === 'lit-door')!.sourceEventSequence = -1
  expect(copied.interaction!.chatNarrative!.situation.facts).toEqual(expectedFacts)
  expect(copied.interaction!.relationships).toEqual(before.interaction!.relationships)
  const receipt = (await db.productRuntimeEvents.where('sessionId').equals(child.id!).toArray())[0]
  expect(receipt.type).toBe('interaction.release.upgraded')
  const payload = JSON.parse(receipt.payloadJson)
  expect(payload).toMatchObject({planHash: plan.planHash, sourceStateHash: plan.sourceStateHash, targetReleaseHash: f.next.contentHash})
  expect(() => assertChatReleaseUpgradeReceiptV1(JSON.parse(child.initialStateJson), receipt, {...payload, targetPackageHash: '0'.repeat(64)})).toThrow()
  await expect(copyChatSaveToReleaseV1({...input, request: {...input.request, expectedPlanHash: '0'.repeat(64)}})).rejects.toThrow('另一份')
  const backup = await exportProjectJSON(f.scope.projectId)
  const tampered = structuredClone(backup), tamperedReceipt = tampered.productRuntimeEvents.find(event => event.type === 'interaction.release.upgraded')!
  const badBody = JSON.parse(tamperedReceipt._portablePayloadJson); badBody.sourceStateHash = '0'.repeat(64)
  tamperedReceipt._portablePayloadJson = JSON.stringify(badBody)
  const workspacesBefore = await db.projects.count()
  await expect(importProjectJSON(tampered)).rejects.toThrow('升级回执与原故事')
  expect(await db.projects.count()).toBe(workspacesBefore)
  const importedProject = await importProjectJSON(backup)
  const restored = (await db.productRuntimeSessions.where('projectId').equals(importedProject).filter(row => row.title === child.title).first())!
  expect(restored.parentSessionId).not.toBe(f.parentSessionId)
  db.close(); await db.open()
  expect(await readProductRuntimeState(restored.id!)).toEqual(copied)
  await deleteProductRuntimeSession(restored.parentSessionId!)
  expect((await db.productRuntimeSessions.get(restored.id!))!.parentSessionId).toBeNull()
  expect(await readProductRuntimeState(restored.id!)).toEqual(copied)
  // A deleted source timeline is not required to retain or back up the copy.
  const detachedProject = await importProjectJSON(await exportProjectJSON(importedProject))
  expect(await db.productRuntimeSessions.where('projectId').equals(detachedProject).count()).toBe(1)
  const scope = {projectId: restored.projectId, worldId: restored.worldId!, workId: restored.workId!}
  await commitInteractionPlayerMessage({...await command(restored.id!), messageId: 'new-player', text: '灯已经移到门边了，现在我想谈谈铜印。'})
  let sawOldFact = false
  const continuation = await candidate({...f, scope, parentSessionId: restored.id!}, messages => {
    const prompt = JSON.stringify(messages); sawOldFact = prompt.includes('门边亮了起来。')
    expect(prompt).not.toContain('掌柜把铜印留在柜台下的木箱里。')
    expect(prompt).not.toContain('还没有发送的私密草稿')
  },
    {...action, kind: 'speak', text: '好，你想从哪里谈起？', newFacts: []})
  expect(sawOldFact).toBe(true)
  // The new run is a new candidate, not a relabelled copy of the old receipt.
  expect(continuation.snapshot.run.productRuntimeSessionId).toBe(restored.id!)
  copied = await readProductRuntimeState(restored.id!)
  expect(copied.interaction!.messages.at(-1)?.text).toContain('灯已经移到门边')
  expect(await readProductRuntimeState(f.parentSessionId)).toEqual(before)
}, 30_000)

it('also preserves ordinary interaction scene progress and a paused save without starting the narrative mode', async () => {
  const f = await fixture({secondOrdinaryScene: true})
  await db.productRuntimeSessions.update(f.parentSessionId, {status: 'paused'})
  const before = await readProductRuntimeState(f.parentSessionId), plan = await readChatReleaseUpgradePlanV1(f)
  expect(plan.canCopy).toBe(true)
  const child = await copyChatSaveToReleaseV1({scope: f.scope, title: '庭院旧进度', request: {parentSessionId: f.parentSessionId,
    targetReleaseId: f.targetReleaseId, expectedPlanHash: plan.planHash, commandId: 'upgrade.ordinary'}})
  expect(child.status).toBe('paused')
  const state = await readProductRuntimeState(child.id!)
  expect(state.interaction!.chatNarrative).toBeUndefined()
  expect(state.interaction!.activeScene!.sceneKey).toBe('courtyard')
  expect(state.interaction!.totalPlayerTurns).toBe(before.interaction!.totalPlayerTurns)
  expect(state.interaction!.messages.map(message => message.text)).toEqual(before.interaction!.messages.map(message => message.text))
  const imported = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const restored = (await db.productRuntimeSessions.where('projectId').equals(imported).filter(row => row.title === child.title).first())!
  expect(await readProductRuntimeState(restored.id!)).toEqual(state)
}, 30_000)

it('rejects a run that starts after preparation even when no new runtime event is appended', async () => {
  const f = await fixture(), state = await readProductRuntimeState(f.parentSessionId)
  const trigger = await requestChatNarrativeTrigger({...await command(f.parentSessionId), kind: 'player-response', sourceEventSequence: state.interaction!.messages.at(-1)!.eventSequence})
  const plan = await readChatReleaseUpgradePlanV1(f), count = await db.productRuntimeSessions.count()
  const realPrepare = upgradePlans.prepareChatReleaseUpgradeV1
  vi.spyOn(upgradePlans, 'prepareChatReleaseUpgradeV1').mockImplementationOnce(async args => {
    const prepared = await realPrepare(args)
    await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.parentSessionId, participantKey: 'guard',
      skillId: 'character.chat-narrative-action', narrativeTriggerSequence: trigger.sequence, objective: '另一页面的生成请求',
      runAI: withChatActionChoiceFixture(async () => JSON.stringify(action)), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
    expect((await readProductRuntimeStateVersion(f.parentSessionId)).sequence).toBe(plan.sourceSequence)
    return prepared
  })
  await expect(copyChatSaveToReleaseV1({scope: f.scope, title: '不可跳过待确认任务', request: {parentSessionId: f.parentSessionId,
    targetReleaseId: f.targetReleaseId, expectedPlanHash: plan.planHash, commandId: 'upgrade.run-race'}})).rejects.toThrow('生成任务已变化')
  expect(await db.productRuntimeSessions.count()).toBe(count)
}, 30_000)

it('rechecks the parent inside the atomic commit and rolls back a failed receipt without losing the original save', async () => {
  const f = await fixture(), count = await db.productRuntimeSessions.count()
  let plan = await readChatReleaseUpgradePlanV1(f)
  const realPrepare = upgradePlans.prepareChatReleaseUpgradeV1
  vi.spyOn(upgradePlans, 'prepareChatReleaseUpgradeV1').mockImplementationOnce(async args => {
    const prepared = await realPrepare(args)
    await commitInteractionPlayerMessage({...await command(f.parentSessionId), messageId: 'concurrent', text: '另一页面已经说了这句话。'})
    return prepared
  })
  await expect(copyChatSaveToReleaseV1({scope: f.scope, title: '并发更新', request: {...f, expectedPlanHash: plan.planHash, commandId: 'upgrade.concurrent'}})).rejects.toThrow('已变化')
  expect(await db.productRuntimeSessions.count()).toBe(count)
  plan = await readChatReleaseUpgradePlanV1(f)
  const parent = await db.productRuntimeSessions.get(f.parentSessionId)
  const failReceipt = (_key: unknown, row: {type: string}) => {if (row.type === 'interaction.release.upgraded') throw new Error('模拟保存失败')}
  db.productRuntimeEvents.hook('creating', failReceipt)
  const input = {scope: f.scope, title: '原子复制', request: {parentSessionId: f.parentSessionId, targetReleaseId: f.targetReleaseId, expectedPlanHash: plan.planHash, commandId: 'upgrade.atomic'}}
  try {await expect(copyChatSaveToReleaseV1(input)).rejects.toThrow('模拟保存失败')}
  finally {db.productRuntimeEvents.hook('creating').unsubscribe(failReceipt)}
  expect(await db.productRuntimeSessions.count()).toBe(count)
  expect(await db.productRuntimeSessions.get(f.parentSessionId)).toEqual(parent)
  expect(await db.productRuntimeEvents.where('type').equals('interaction.release.upgraded').count()).toBe(0)
  expect((await copyChatSaveToReleaseV1(input)).parentSessionId).toBe(f.parentSessionId)
  expect(await db.productRuntimeSessions.count()).toBe(count + 1)
}, 30_000)

it('rejects changed confirmations, unfinished candidates, pending history edits and foreign scopes without partial copies', async () => {
  const f = await fixture(), plan = await readChatReleaseUpgradePlanV1(f), count = await db.productRuntimeSessions.count()
  const input = {scope: f.scope, title: '拒绝过时升级', request: {parentSessionId: f.parentSessionId, targetReleaseId: f.targetReleaseId, expectedPlanHash: plan.planHash, commandId: 'upgrade.stale'}}
  await player.getState().sendPlayerMessage('我刚刚改变了想法。')
  await expect(copyChatSaveToReleaseV1(input)).rejects.toThrow('预览已变化')
  expect(await db.productRuntimeSessions.count()).toBe(count)
  const generated = await candidate(f)
  expect((await readChatReleaseUpgradePlanV1(f)).blockers).toContain('unfinished-run')
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const state = await readProductRuntimeState(f.parentSessionId)
  const edit = await forkChatMessageEditV1({scope: f.scope,
    plan: await readChatMessageEditPlanV1(f.scope, f.parentSessionId, state.interaction!.messages[0].messageId), text: '新的措辞'})
  expect((await readChatReleaseUpgradePlanV1({...f, parentSessionId: edit.id!})).blockers).toContain('pending-edit')
  const foreign = await createChatDraftV3('另一个作品')
  await expect(readChatReleaseUpgradePlanV1({...f, scope: foreign.scope})).rejects.toThrow('当前角色聊天作品')
  await db.productRuntimeSessions.update(f.parentSessionId, {status: 'archived'})
  expect((await readChatReleaseUpgradePlanV1(f)).blockers).toContain('closed-save')
}, 30_000)
