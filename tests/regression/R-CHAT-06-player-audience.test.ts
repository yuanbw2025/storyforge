import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {applyInteractionEvent, buildInteractionContextWindow, createInitialInteractionState, interactionVisibilityView, parseInteractionState} from '../../src/lib/character-interaction/runtime'
import {branchProductRuntimeSession, commitInteractionPlayerMessage, deleteProductRuntimeSession, joinInteractionParticipant, leaveInteractionParticipant, readProductRuntimeState, readProductRuntimeStateVersion} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatNarrativeFixture, seedChatNarrativeRuntimeFixture} from '../helpers/chat-narrative-fixture'
import type {ProductRuntimeEvent} from '../../src/lib/types'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())

async function command(sessionId: number) {
  const v = await readProductRuntimeStateVersion(sessionId)
  return {sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}
}
const say = async (sessionId: number, audienceKeys?: string[] | null) => commitInteractionPlayerMessage({
  ...await command(sessionId), messageId: crypto.randomUUID(), text: '只有在场的人听见这段铜铃往事。', audienceKeys,
})
function oldEvent(version?: number): ProductRuntimeEvent {
  const envelope = {commandId: 'player.legacy', baseSequence: 1, baseStateHash: 'a'.repeat(64)}
  return {projectId: 1, sessionId: 1, sequence: 2, type: 'interaction.player.message.committed', actorKey: 'player', targetKey: null, createdAt: 1, ...envelope,
    payloadJson: JSON.stringify({...envelope, messageId: 'legacy', text: '历史公开消息', audienceKeys: null, ...(version === undefined ? {} : {playerAudienceVersion: version})})}
}
function initial(narrative = true) {
  const frozen = chatNarrativeFixture()
  if (!narrative) delete frozen.chatNarrative
  const state = createInitialInteractionState(frozen)
  state.activeScene = {...state.sceneTemplates[0], sceneId: 'audience', status: 'active', activeParticipantKeys: ['guard'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 0}
  return state
}

it('keeps old event replay and non-narrative state unchanged while versioning new audience semantics', () => {
  const legacy = applyInteractionEvent(initial(), oldEvent())!
  expect(legacy.messages[0].audienceKeys).toBeNull()
  expect(interactionVisibilityView(legacy, 'artisan').messages).toHaveLength(1)
  const current = applyInteractionEvent(initial(), oldEvent(1))!
  expect(current.messages[0].audienceKeys).toEqual(['player', 'guard'])
  expect(current.messages[0]).not.toHaveProperty('playerConversation')
  expect(interactionVisibilityView(current, 'artisan').messages).toEqual([])
  expect(applyInteractionEvent(initial(false), oldEvent(1))).toEqual(applyInteractionEvent(initial(false), oldEvent()))
  expect(applyInteractionEvent(initial(), oldEvent(2))!.messages[0]).toMatchObject({audienceKeys: ['player', 'guard'], playerConversation: 'present'})
  expect(applyInteractionEvent(initial(false), oldEvent(2))).toEqual(applyInteractionEvent(initial(false), oldEvent()))
  expect(() => applyInteractionEvent(initial(), oldEvent(3))).toThrow('听众版本')
})

it('rejects malformed conversation modes when restoring saved messages instead of coercing arrays or objects into a valid mode', () => {
  const state = applyInteractionEvent(initial(), oldEvent(2))!
  for (const playerConversation of [['private'], ['present'], null, {mode: 'private'}, 1]) {
    expect(() => parseInteractionState({...state, messages: [{...state.messages[0], playerConversation}]})).toThrow('范围标记')
  }
  expect(parseInteractionState(state)!.messages[0].playerConversation).toBe('present')
})

it('freezes public listeners so a returning role does not learn dialogue said in its absence', async () => {
  const f = await seedChatNarrativeRuntimeFixture()
  await leaveInteractionParticipant({...await command(f.sessionId), participantKey: 'artisan'})
  const before = (await readProductRuntimeState(f.sessionId)).interaction!
  const message = await say(f.sessionId)
  expect(JSON.parse(message.payloadJson).playerAudienceVersion).toBe(2)
  await joinInteractionParticipant({...await command(f.sessionId), participantKey: 'artisan'})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.messages[0].audienceKeys).toEqual(['player', 'guard'])
  expect(state.messages[0].playerConversation).toBe('present')
  expect(buildInteractionContextWindow(state, 'artisan').messages).toEqual([])
  expect(buildInteractionContextWindow(state, 'guard').messages[0].text).toContain('铜铃往事')
  expect(state.knowledge).toEqual(before.knowledge)
  expect(state.chatNarrative!.situation).toEqual(before.chatNarrative!.situation)
  await say(f.sessionId)
  const after = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(interactionVisibilityView(after, 'artisan').messages.map(m => m.eventSequence)).toEqual([after.messages[1].eventSequence])
})

it('keeps an explicit private audience private and rejects targeting an absent role atomically', async () => {
  const f = await seedChatNarrativeRuntimeFixture()
  await say(f.sessionId, ['guard'])
  let state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.messages[0].audienceKeys).toEqual(['player', 'guard'])
  expect(state.messages[0].playerConversation).toBe('private')
  expect(interactionVisibilityView(state, 'artisan').messages).toEqual([])
  await leaveInteractionParticipant({...await command(f.sessionId), participantKey: 'artisan'})
  const before = await readProductRuntimeState(f.sessionId)
  await expect(say(f.sessionId, ['guard', 'artisan'])).rejects.toThrow('当前在场')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.messages).toHaveLength(1)
})

it('returns the original event for an exact retry even after the set of listeners changes', async () => {
  const f = await seedChatNarrativeRuntimeFixture(), input = {...await command(f.sessionId), messageId: 'retry', text: '在场时听见'}
  const message = await commitInteractionPlayerMessage(input)
  await leaveInteractionParticipant({...await command(f.sessionId), participantKey: 'artisan'})
  expect(await commitInteractionPlayerMessage(input)).toEqual(message)
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages).toHaveLength(1)
  await expect(commitInteractionPlayerMessage({...input, text: '不同内容'})).rejects.toThrow('不同命令')
})

it.each([undefined, 1])('preserves the payload binding of an old version %s command when retried through the new API', async version => {
  const f = await seedChatNarrativeRuntimeFixture(), input = {...await command(f.sessionId), messageId: 'old-retry', text: '旧版消息', audienceKeys: null}
  const event = {...oldEvent(), projectId: f.scope.projectId, sessionId: f.sessionId, sequence: input.baseSequence + 1,
    commandId: input.commandId, baseSequence: input.baseSequence, baseStateHash: input.baseStateHash,
    payloadJson: JSON.stringify({commandId: input.commandId, baseSequence: input.baseSequence, baseStateHash: input.baseStateHash,
      messageId: input.messageId, text: input.text, audienceKeys: null, ...(version === undefined ? {} : {playerAudienceVersion: version})})}
  const id = await db.productRuntimeEvents.add(event)
  expect(await commitInteractionPlayerMessage(input)).toEqual({...event, id})
  const message = (await readProductRuntimeState(f.sessionId)).interaction!.messages[0]
  expect(message.audienceKeys).toEqual(version === undefined ? null : ['player', 'guard', 'artisan'])
  expect(message).not.toHaveProperty('playerConversation')
})

it('retains the original audience after nested branching, parent deletion, export/import and refresh', async () => {
  const f = await seedChatNarrativeRuntimeFixture()
  await leaveInteractionParticipant({...await command(f.sessionId), participantKey: 'artisan'})
  await say(f.sessionId)
  const child = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence, title: 'audience-child'})
  const nested = await branchProductRuntimeSession({parentSessionId: child.id!, throughSequence: 0, title: 'audience-nested'})
  await deleteProductRuntimeSession(f.sessionId)
  await deleteProductRuntimeSession(child.id!)
  await joinInteractionParticipant({...await command(nested.id!), participantKey: 'artisan'})
  const before = (await readProductRuntimeState(nested.id!)).interaction!
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const restored = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === nested.title)!
  db.close(); await db.open()
  const after = (await readProductRuntimeState(restored.id!)).interaction!
  expect(after).toEqual(before)
  expect(after.messages[0].eventSequence).toBeLessThan(0)
  expect(after.messages[0].playerConversation).toBe('present')
  expect(interactionVisibilityView(after, 'artisan').messages).toEqual([])
  expect(interactionVisibilityView(after, 'guard').messages[0].text).toContain('铜铃往事')
})
