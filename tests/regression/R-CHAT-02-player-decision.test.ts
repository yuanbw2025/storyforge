import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {chatSituationConstructionRequestV1} from '../../src/lib/character-interaction/narrative-progression'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {CHAT_PLAYER_DECISION_ACTION_RULE_V1, CHAT_PLAYER_DECISION_REVIEW_RULE_V1, supportsChatPlayerDecisionPromptV1, supportsChatPlayerDecisionReviewV1, supportsChatSituationWaitScopeV1} from '../../src/lib/character-interaction/player-decision-prompt'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())

const invitation = '你愿意陪我一起寻找铜印吗？我先等你的决定。'
const undecided = '我还没有决定，先听你说。'
const stop = '先别找铜印，等我明确说可以再继续。'
const independentText = '我先确认屋内有没有可查阅的失物记录，不需要你参加。'
const independent: ChatNarrativeActionV1 = {kind: 'speak', text: independentText, goalKey: 'find-seal', evidenceFactKeys: ['lost'],
  audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null,
  situationRequest: {threadKey: 'investigate', direction: '核实屋内是否有可供查阅的失物记录；不预定存在、允许查阅或内容。', evidenceFactKeys: ['lost'], evidenceExcerpt: independentText},
  nextPossibilities: [{text: '先核实屋内可查阅的失物记录；旧同行邀请仍未获同意。', evidenceFactKeys: ['lost']}]}

/** Persist both turns through the production harness; injected text and reviews
 * exercise contracts and recovery, never model narrative quality. */
async function pendingInvitation(playerHold = false) {
  const f = await seedChatNarrativeRuntimeFixture({actorSituationExpansion: true})
  let version = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'scope.start', baseSequence: version.sequence, baseStateHash: version.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  const save = async (action: ChatNarrativeActionV1) => {
    const generated = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '工程夹具：保留未回答邀请及真实暂停来源',
      runAI: withChatActionChoiceFixture(async () => JSON.stringify(action)), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
    await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  }
  await save({...independent, kind: 'attempt', text: invitation, waitingForPlayer: true, situationRequest: null,
    nextPossibilities: [{text: '等玩家决定是否一起寻找铜印；尚未同意前不视为同行。', evidenceFactKeys: ['lost']}]})
  const reply = async (text: string, key: string) => {
    version = await readProductRuntimeStateVersion(f.sessionId)
    const message = await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: `${key}.message`, messageId: key, baseSequence: version.sequence, baseStateHash: version.stateHash, text, audienceKeys: ['guard', 'player']})
    version = await readProductRuntimeStateVersion(f.sessionId)
    await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: `${key}.trigger`, baseSequence: version.sequence, baseStateHash: version.stateHash, kind: 'player-response', sourceEventSequence: message.sequence})
    return message.sequence
  }
  if (playerHold) {
    const sequence = await reply(stop, 'scope.stop'), ack = '好，在你明确同意前，我暂停寻找铜印。'
    await save({...independent, text: ack, waitingForPlayer: true, goalStatus: 'paused', nextPossibilities: [], situationRequest: null,
      pauseGoal: {threadKey: 'investigate', playerEventSequence: sequence, playerExcerpt: stop, evidenceExcerpt: ack}})
  }
  await reply(undecided, 'scope.undecided')
  return f
}

it.each([false, true])('an unanswered saved invitation permits an independent request without granting player consent (options=%s)', async options => {
  const f = await pendingInvitation(), before = await readProductRuntimeState(f.sessionId), worlds = await db.worldReleases.toArray()
  const alternative = {...independent, text: '我先了解这里是否保留失物记录，你不用参与。', situationRequest: {...independent.situationRequest!, evidenceExcerpt: '我先了解这里是否保留失物记录，你不用参与。'}}
  let calls = 0
  const generated = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: options ? 'character.chat-narrative-options' : 'character.chat-narrative-action', objective: '工程夹具：等待范围不扩张为整个目标暂停',
    runAI: withChatActionChoiceFixture(async messages => {
      calls++; expect(messages[1].content).toContain(invitation); expect(messages[1].content).toContain(undecided)
      expect(messages[1].content).toContain('尚未同意前不视为同行'); expect(messages[1].content).not.toContain('柜台下')
      expect(messages[0].content).toContain(options ? '旧邀请未答复不阻塞有依据且不依赖该决定的局部方向' : '旧邀请未答不阻塞真正独立方向')
      expect(messages[0].content).not.toContain('玩家要求休息或等待决定时不提出')
      return JSON.stringify(options ? {options: [independent, alternative]} : independent)
    }), runReviewAI: async messages => {
      expect(messages[0].content).toContain('旧邀请未答复本身不禁止有依据且不依赖该决定的局部方向')
      expect(messages[0].content).not.toContain('休息、暂停、等待选择或未获授权时必须为空')
      calls++; return JSON.stringify(options ? {options: ['option-1', 'option-2'].map(optionKey => ({optionKey, ...chatActionReviewOutputFixture()}))} : chatActionReviewOutputFixture())
    }})
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id, ...(options ? {optionKey: 'option-1'} : {})})
  const after = (await readProductRuntimeState(f.sessionId)).interaction!, story = after.chatNarrative!
  expect(story.situation.goals).toEqual(before.interaction!.chatNarrative!.situation.goals)
  expect(story.situation.facts).toEqual(before.interaction!.chatNarrative!.situation.facts)
  expect(story.situation.threads).toEqual(before.interaction!.chatNarrative!.situation.threads)
  expect(after.messages.slice(0, -1)).toEqual(before.interaction!.messages)
  expect(after.messages.at(-1)!.text).toBe(independentText)
  expect(story.triggers.at(-1)!.status).toBe('complete')
  expect(story.pendingSituation).toMatchObject({...independent.situationRequest, actorKey: 'guard', goalKey: 'find-seal'})
  expect(story.situation.possibilities.filter(p => p.actorKey === 'guard')).toEqual(independent.nextPossibilities!.map(p => ({...p, actorKey: 'guard'})))
  expect(await db.worldReleases.toArray()).toEqual(worlds)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId)), session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
  db.close(); await db.open()
  expect((await readProductRuntimeState(session.id!)).interaction).toEqual(after)
  const version = await readProductRuntimeStateVersion(session.id!)
  await requestChatNarrativeTrigger({sessionId: session.id!, commandId: 'scope.restored', baseSequence: version.sequence, baseStateHash: version.stateHash, kind: 'continue', sourceEventSequence: version.sequence, direction: {actorKey: 'guard', actionLimit: 1}})
  expect(chatSituationConstructionRequestV1((await readProductRuntimeState(session.id!)).interaction!, 'guard')?.text).toBe(independent.situationRequest!.direction)
  expect(calls).toBe(2)
})

it.each(['current-action-waits', 'player-paused-goal'] as const)('a saved invitation cannot bypass %s through an independent request', async boundary => {
  const f = await pendingInvitation(boundary === 'player-paused-goal'), before = await readProductRuntimeState(f.sessionId)
  const action = {...independent, waitingForPlayer: boundary === 'current-action-waits'}, raw = JSON.stringify(action)
  if (boundary === 'player-paused-goal') expect(before.interaction!.chatNarrative!.situation.goals[0].playerPause?.requested.excerpt).toBe(stop)
  let calls = 0, reviews = 0, runId = 0
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '工程反例：独立方向不能越过实际等待或玩家暂停',
    onRunCreated: id => {runId = id}, runAI: withChatActionChoiceFixture(async () => {calls++; return raw}), runReviewAI: async () => {reviews++; return JSON.stringify(chatActionReviewOutputFixture())}})).rejects.toThrow(boundary === 'current-action-waits' ? '不允许角色扩展情境' : '玩家暂停尚未解除')
  expect([calls, reviews]).toEqual([1, 0]); expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  expect((await db.agentRunArtifacts.toArray()).some(row => row.artifactKind === 'raw-response' && row.content === JSON.stringify({outcome: 'action', action, handoff: null}))).toBe(true)
})

it.each([false, true])('preserves a reviewer rejection of a false player dependency without committing an action (options=%s)', async options => {
  const f = await seedChatNarrativeRuntimeFixture(), version = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'decision.start', baseSequence: version.sequence, baseStateHash: version.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  const before = await readProductRuntimeState(f.sessionId), worlds = await db.worldReleases.toArray()
  const action: ChatNarrativeActionV1 = {kind: 'attempt', text: '你不用参与，我自己换个办法。想加入时再告诉我。', goalKey: 'find-seal', evidenceFactKeys: ['lost'],
    audienceKeys: ['guard', 'player'], waitingForPlayer: true, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
  const review = chatActionReviewOutputFixture()
  Object.assign(review.checks.find(c => c.check === 'player-agency')!, {passed: false, reason: '工程注入：该独立办法不依赖玩家加入，旧邀请不能阻塞它。'})
  let calls = 0
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard',
    skillId: options ? 'character.chat-narrative-options' : 'character.chat-narrative-action', objective: '工程反例，不能当作模型语义判断准确率',
    runAI: withChatActionChoiceFixture(async messages => {
      calls++; expect(messages[0].content).toContain(options ? CHAT_PLAYER_DECISION_ACTION_RULE_V1 : '等待仅绑定当前具体步骤确实需要的玩家许可、物品或参与')
      expect(messages[1].content).not.toContain('铜印在柜台下')
      return JSON.stringify(options ? {options: [action, {...action, text: '我自己先想别的办法，不用你参加。'}]} : action)
    }), runReviewAI: async messages => {
      calls++; expect(messages[0].content).toContain(CHAT_PLAYER_DECISION_REVIEW_RULE_V1)
      return JSON.stringify(options ? {options: ['option-1', 'option-2'].map(optionKey => ({optionKey, ...review}))} : review)
    }})).rejects.toThrow('语义审查未通过')
  expect(calls).toBe(2); expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(await db.worldReleases.toArray()).toEqual(worlds)
  expect((await db.agentRunArtifacts.toArray()).some(row => row.artifactKind === 'raw-response' && row.content.includes(action.text))).toBe(true)
})

it.each([true, false])('keeps a real player decision blocking, while a reviewed independent action commits its consequences (waiting=%s)', async waiting => {
  const f = await seedChatNarrativeRuntimeFixture(), version = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'decision.positive', baseSequence: version.sequence, baseStateHash: version.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  const text = waiting ? '你愿意陪我一起找铜印吗？我先等你的决定。' : '我在纸上记下了铜印失踪这件事。'
  const action: ChatNarrativeActionV1 = {kind: waiting ? 'attempt' : 'complete', text, goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'],
    waitingForPlayer: waiting, newFacts: waiting ? [] : [{factKey: 'own-note', kind: 'observation', text, evidenceFactKeys: ['lost'], evidenceExcerpt: text}], disclosures: [], threadUpdates: [], goalStatus: null}
  const generated = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '工程正例，不扩张行动权限',
    runAI: withChatActionChoiceFixture(async () => JSON.stringify(action)), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  expect(generated.snapshot.contract.executionBindings!.map(binding => binding.promptVersion)).toEqual(expect.arrayContaining(['chat-narrative-action-v72', 'chat-narrative-action-review-v42']))
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.chatNarrative!.triggers.at(-1)!.status).toBe(waiting ? 'waiting-player' : 'complete')
  expect(state.chatNarrative!.situation.facts.some(fact => fact.factKey === 'own-note')).toBe(!waiting)
  expect(state.messages.at(-1)!.text).toBe(text)
})

it('does not retrofit new decision guidance into old producers, revisions, or unknown future versions', () => {
  for (const version of [undefined, 'chat-narrative-action-v36', 'chat-narrative-options-v26', 'chat-action-revision-v16', 'chat-narrative-action-v999']) expect(supportsChatPlayerDecisionPromptV1(version)).toBe(false)
  for (const version of [undefined, 'chat-narrative-action-review-v30', 'chat-narrative-options-review-v24', 'chat-narrative-action-review-v999']) expect(supportsChatPlayerDecisionReviewV1(version)).toBe(false)
  for (const version of [undefined, 'chat-narrative-action-v43', 'chat-narrative-options-v33', 'chat-narrative-action-review-v31', 'chat-narrative-options-review-v25', 'chat-action-revision-v20', 'chat-narrative-action-v999']) expect(supportsChatSituationWaitScopeV1(version)).toBe(false)
})
