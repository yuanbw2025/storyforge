import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {canonicalStringify} from '../../src/lib/agent/run/hash'
import {buildInteractionContextWindow, createInitialInteractionState, interactionVisibilityView, parseInteractionState, rebaseInteractionStateForBranch} from '../../src/lib/character-interaction/runtime'
import {applyChatNarrativeActionV1, applyReviewedChatNarrativeActionV1, parseChatNarrativeActionV1, previewChatNarrativeActionV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {chatSituationCoordinatorViewV1} from '../../src/lib/character-interaction/narrative-situations'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, changeInteractionRelationship, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewFixture, chatActionReviewOutputFixture, chatNarrativeFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

const playerText = '先核对证据再询问，不要因为旅人着急离开就认定他有罪。'
const responseText = '你提醒得对，着急离开不代表有罪。我更愿意听取你的判断；我先核对已有记录。'
function response(sourceEventSequence = 2): ChatNarrativeActionV1 {
  return {kind: 'speak', text: responseText, goalKey: 'find-seal', evidenceFactKeys: ['lost', 'regret'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
    newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null,
    relationshipUpdates: [{dimensionKey: 'trust', delta: 1, sourceEventSequence, playerExcerpt: playerText, evidenceExcerpt: '我更愿意听取你的判断'}]}
}
function preparedState() {
  const frozen = chatNarrativeFixture()
  frozen.profiles[0].relationshipDimensions = [{key: 'trust', label: '信任', minimum: -100, maximum: 100, initial: 0, largeChangeThreshold: 20}]
  frozen.chatNarrative!.permissions.maxActionsPerTrigger = 3
  const state = createInitialInteractionState(frozen)
  state.activeScene = {...state.sceneTemplates[0], sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 1}
  state.remainingDirectorBudget = 100
  state.messages.push({messageId: 'player:2', eventSequence: 2, role: 'player', speakerKey: 'player', audienceKeys: ['guard'], text: playerText, replyToSequence: null, supersededBySequence: null})
  return requestChatNarrativeTriggerV1(state, {sequence: 3, kind: 'player-response', sourceEventSequence: 2, seed: null})
}
function apply(action = response(), state = preparedState(), sequence = 4) {
  return applyReviewedChatNarrativeActionV1(state, {sequence, actorKey: 'guard', triggerSequence: state.chatNarrative!.triggers.at(-1)!.requestedSequence,
    messageId: `action:${sequence}`, action, review: chatActionReviewFixture(action)})
}

it('commits actor attitude and public evidence atomically while keeping legacy canonical review bindings intact', () => {
  const before = preparedState(), after = apply(response(), before)
  expect(before.relationships[0].value).toBe(0); expect(before.messages).toHaveLength(1)
  expect(after.relationships[0]).toMatchObject({value: 1, lastChangedSequence: 4, fromParticipantKey: 'guard', toParticipantKey: 'player'})
  expect(after.relationshipHistory).toEqual([{eventSequence: 4, fromParticipantKey: 'guard', toParticipantKey: 'player', dimensionKey: 'trust', before: 0, after: 1, delta: 1,
    reason: '我更愿意听取你的判断', ruleKey: 'chat.narrative.evidence.v1', sourceEventSequence: 2, significantEventKey: null}])
  expect(after.messages.at(-1)!.eventSequence).toBe(4); expect(after.remainingDirectorBudget).toBe(98)
  expect(parseInteractionState(after)).toEqual(after)
  const legacy = response(); delete legacy.relationshipUpdates
  expect(canonicalStringify(parseChatNarrativeActionV1(legacy))).toBe(canonicalStringify(legacy))
  const envelope = {sequence: 4, actorKey: 'guard', triggerSequence: 3, messageId: 'old', action: legacy}
  expect(applyChatNarrativeActionV1(before, envelope).relationshipHistory).toEqual([])
  expect(() => applyChatNarrativeActionV1(before, {...envelope, action: response()})).toThrow('旧行动事件')
  expect(() => applyReviewedChatNarrativeActionV1(before, {...envelope, action: response(), review: chatActionReviewFixture(legacy)})).toThrow('另一份候选')
})
it.each([
  ['unregistered dimension', (a: ChatNarrativeActionV1) => {a.relationshipUpdates![0].dimensionKey = 'love'}],
  ['invented player consent field', a => {Object.assign(a.relationshipUpdates![0], {toParticipantKey: 'guard'})}],
  ['future evidence', a => {a.relationshipUpdates![0].sourceEventSequence = 4}],
  ['forged player evidence', a => {a.relationshipUpdates![0].playerExcerpt = '我答应帮助你搜身。'}],
  ['unspoken reason', a => {a.relationshipUpdates![0].evidenceExcerpt = '柜台下的秘密让他信任了玩家'}],
  ['large change', a => {a.relationshipUpdates![0].delta = 20}],
  ['nonfinite change', a => {a.relationshipUpdates![0].delta = NaN}],
  ['zero change', a => {a.relationshipUpdates![0].delta = 0}],
  ['duplicate dimension', a => {a.relationshipUpdates!.push({...a.relationshipUpdates![0]})}],
] as const)('rejects %s without committing even the dialogue', (_name, change) => {
  const state = preparedState(), original = structuredClone(state), action = response()
  change(action); expect(() => apply(action, state)).toThrow(); expect(state).toEqual(original)
})
it('rejects invisible player input, clamping and changes above the frozen dimension limit', () => {
  const state = preparedState()
  state.messages[0].audienceKeys = ['artisan']; expect(() => apply(response(), state)).toThrow('看不到')
  state.messages[0].audienceKeys = ['guard']; state.relationships[0].value = 100
  expect(() => apply(response(), state)).toThrow('边界')
  state.relationships[0].value = 0; state.relationships[0].largeChangeThreshold = 0
  expect(() => apply(response(), state)).toThrow('小幅影响')
  state.relationships[0].largeChangeThreshold = 1; state.relationships[0].minimum = 0; state.relationships[0].maximum = 1
  expect(() => apply(response(), state)).toThrow('小幅影响')
})
it('deduplicates the same event and repeated player wording even after branch rebasing', () => {
  const state = apply()
  expect(() => apply(response(), state, 5)).toThrow('已经影响过')
  const branch = rebaseInteractionStateForBranch(state, 4)
  expect(branch.relationshipHistory[0]).toMatchObject({eventSequence: -1, sourceEventSequence: -3})
  branch.messages.push({...branch.messages[0], messageId: 'repeated', eventSequence: 1, text: ` ${playerText} `})
  const next = requestChatNarrativeTriggerV1(branch, {sequence: 2, kind: 'player-response', sourceEventSequence: 1, seed: null})
  expect(() => apply(response(1), next, 3)).toThrow('重复表达')
  expect(interactionVisibilityView(next, 'guard').relationshipEvidence).toHaveLength(1)
})
it.each(['continue', 'return', 'scene-start'] as const)('does not reward or penalize a %s trigger', kind => {
  const state = preparedState(); state.chatNarrative!.triggers[0].kind = kind
  expect(() => apply(response(), state)).toThrow('真实玩家消息')
  const noChange = {...response(), relationshipUpdates: []}
  expect(apply(noChange, state).relationshipHistory).toEqual([])
})
it('provides role-specific recent causes and unfinished issues without leaking another role or author secrets', () => {
  const state = apply(), guard = interactionVisibilityView(state, 'guard'), artisan = interactionVisibilityView(state, 'artisan')
  expect(guard.relationshipEvidence![0].reason).toBe('我更愿意听取你的判断')
  expect(guard.chatNarrative!.threads[0].status).toBe('open')
  expect(JSON.stringify(guard)).not.toContain('柜台下')
  expect(artisan.relationshipEvidence).toEqual([])
  expect(interactionVisibilityView(state, 'player').relationshipEvidence).toEqual([])
  expect(chatSituationCoordinatorViewV1(state).relationshipEvidence).toEqual(guard.relationshipEvidence)
})

describe('durable relationship consequences', () => {
  beforeEach(async () => {db.close(); await db.delete(); await db.open()})
  afterEach(() => db.close())
  async function prepared(text = playerText) {
    const f = await seedChatNarrativeRuntimeFixture({relationships: true})
    const envelope = async (commandId: string) => {const v = await readProductRuntimeStateVersion(f.sessionId); return {sessionId: f.sessionId, commandId, baseSequence: v.sequence, baseStateHash: v.stateHash}}
    const player = await commitInteractionPlayerMessage({...await envelope('player'), messageId: 'player', text, audienceKeys: ['guard']})
    await requestChatNarrativeTrigger({...await envelope('trigger'), kind: 'player-response', sourceEventSequence: player.sequence})
    return {...f, envelope, action: response(player.sequence)}
  }
  it('adopts once, restores after refresh/export/nested branches, and supplies the cause to the next role call', async () => {
    const f = await prepared()
    const generated = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '回应玩家提醒',
      runAI: withChatActionChoiceFixture(async messages => {expect(JSON.stringify(messages)).toContain('relationshipUpdates'); return JSON.stringify(f.action)}),
      runReviewAI: async messages => {expect(JSON.stringify(messages)).toContain('关系'); return JSON.stringify(chatActionReviewOutputFixture())}})
    expect((await readProductRuntimeState(f.sessionId)).interaction!.relationshipHistory).toEqual([])
    const adopted = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
    await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
    db.close(); await db.open()
    const saved = (await readProductRuntimeState(f.sessionId)).interaction!
    expect(saved.relationshipHistory).toHaveLength(1); expect(saved.relationships[0].value).toBe(1)
    const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: adopted.event!.sequence, title: '关系分支'})
    const nested = await branchProductRuntimeSession({parentSessionId: branch.id!, throughSequence: 0, title: '关系二次分支'})
    const expected = (await readProductRuntimeState(nested.id!)).interaction!
    expect(expected.relationshipHistory[0].sourceEventSequence).toBeLessThan(0)
    const imported = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    const restored = (await db.productRuntimeSessions.where('projectId').equals(imported).toArray()).find(s => s.title === '关系二次分支')!
    const actual = (await readProductRuntimeState(restored.id!)).interaction!
    expect(actual.relationshipHistory).toEqual(expected.relationshipHistory); expect(actual.relationships).toEqual(expected.relationships)
    const restoredView = buildInteractionContextWindow(actual, 'guard')
    expect(restoredView.relationshipEvidence).toEqual(actual.relationshipHistory)
    for (const sequence of [actual.relationshipHistory[0].eventSequence, actual.relationshipHistory[0].sourceEventSequence]) {
      expect(restoredView.messages).toContainEqual(actual.messages.find(m => m.eventSequence === sequence))
    }
    const next = await f.envelope('continue')
    await requestChatNarrativeTrigger({...next, kind: 'continue', sourceEventSequence: next.baseSequence})
    await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '承接上次关系和未完成问题',
      runAI: withChatActionChoiceFixture(async messages => {
        const context = messages.map(m => m.content).join('\n')
        expect(context).toContain('"relationshipEvidence":[{'); expect(context).toContain('"reason":"我更愿意听取你的判断"')
        expect(context).toContain('"value":1'); expect(context).toContain('"largeChangeThreshold":20')
        expect(context).toContain('investigate'); expect(context).not.toContain('柜台下')
        return JSON.stringify({...f.action, kind: 'pause', text: '我先慢慢核对，你可以休息。', relationshipUpdates: []})
      }), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  })
  it('rejects semantic refusal punishment as a whole and closes the old fixed relationship bypass', async () => {
    const f = await prepared('我不想参与搜查，想休息。'), before = await readProductRuntimeStateVersion(f.sessionId)
    const bad: ChatNarrativeActionV1 = {...f.action, text: '你拒绝了我，所以我不再信任你。', relationshipUpdates: [{dimensionKey: 'trust', delta: -1, sourceEventSequence: f.action.relationshipUpdates![0].sourceEventSequence,
      playerExcerpt: '我不想参与搜查', evidenceExcerpt: '所以我不再信任你'}]}
    const state = (await readProductRuntimeState(f.sessionId)).interaction!
    // Structurally valid: only the semantic review can judge this unjustified penalty.
    expect(() => previewChatNarrativeActionV1(state, {sequence: before.sequence + 1, actorKey: 'guard', triggerSequence: state.chatNarrative!.triggers.at(-1)!.requestedSequence, messageId: 'bad', action: bad})).not.toThrow()
    const review = chatActionReviewOutputFixture(); review.checks.find(c => c.check === 'consequences')!.passed = false
    await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '拒绝反例',
      runAI: withChatActionChoiceFixture(async () => JSON.stringify(bad)), runReviewAI: async messages => {expect(JSON.stringify(messages)).toContain('不能仅因拒绝'); return JSON.stringify(review)}})).rejects.toThrow('审查未通过')
    await expect(changeInteractionRelationship({...await f.envelope('bypass'), fromParticipantKey: 'guard', toParticipantKey: 'player', dimensionKey: 'trust', delta: 1, reason: '绕过', ruleKey: 'fixed', sourceEventSequence: bad.relationshipUpdates![0].sourceEventSequence})).rejects.toThrow('已审查的行动')
    expect(await readProductRuntimeStateVersion(f.sessionId)).toEqual(before)
  })
})
