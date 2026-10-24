import {canonicalStringify} from '../../src/lib/agent/run/hash'
import {seedChatNarrativeRuntimeFixture, chatActionReviewFixture} from './chat-narrative-fixture'
import {commitChatNarrativeAction, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {CHAT_SITUATION_REVIEW_CHECKS_V1, type ChatNarrativeActionV1, type ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'

export const followupPlayerText = '那可以看看雨停后门口有没有积水吗？我先留在屋里。'
export const followupDirection = '承接旅人查看门口积水的新请求，保留寻找已经结束的结果，只准备自己可做的有限观察，不要求旅人出门。'
export function followupAction(playerEventSequence: number): ChatNarrativeActionV1 {
  return {kind: 'speak', text: '我可以看看门口的积水。你留在屋里就好，这不需要重新寻找铜印。', goalKey: null,
    evidenceFactKeys: ['road'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
    newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null,
    situationRequest: {purpose: 'player-followup', threadKey: null, playerEventSequence, playerExcerpt: '可以看看雨停后门口有没有积水吗',
      direction: followupDirection, evidenceFactKeys: ['road'], evidenceExcerpt: '我可以看看门口的积水。'}}
}
export function followupSituation(): ChatSituationDraftV1 {
  return {kind: 'chat-situation', title: '门口的有限观察', location: '驿站', timeLabel: '傍晚', newFacts: [],
    newGoals: [{goalKey: 'check-entry', actorKey: 'guard', desire: '查看门口积水的情况', concern: '不把门口所见扩大为整条山路安全', boundary: '不要求旅人出门', evidenceFactKeys: ['road']}],
    newThreads: [{threadKey: 'entry-condition', title: '门口状况', question: '门口能观察到什么情况？', audienceKeys: ['guard', 'player'], participantKeys: ['guard'], evidenceFactKeys: ['road'], closureSignals: ['给出实际观察的有限结果，或说明具体阻碍后暂停。']}],
    possibilities: [{actorKey: 'guard', text: '可以在门内观察门口，不推测未看到的山路。', evidenceFactKeys: ['road']}]}
}
export function followupSituationReview(draft = followupSituation()) {
  return {reviewedProposalJson: canonicalStringify(draft), checks: CHAT_SITUATION_REVIEW_CHECKS_V1.map(check => ({check, passed: true, reason: '工程夹具，不是语义质量验收'}))}
}
export function followupResultAction(): ChatNarrativeActionV1 {
  return {kind: 'complete', text: '我站在门内向外查看了门口的积水。', goalKey: 'check-entry', evidenceFactKeys: ['road'],
    audienceKeys: ['guard', 'player'], waitingForPlayer: false,
    newFacts: [{factKey: 'entry-observed', kind: 'observation', text: '我站在门内向外查看了门口的积水。', evidenceFactKeys: ['road'], evidenceExcerpt: '我站在门内向外查看了门口的积水。'}],
    disclosures: [], threadUpdates: [], goalStatus: null,
    situationRequest: {purpose: 'observation-result', threadKey: 'entry-condition', direction: '确认已经完成的门内观察所见，不追加新动作。', evidenceFactKeys: ['entry-observed'], evidenceExcerpt: '我站在门内向外查看了门口的积水。'}}
}
/** Existing background permits an own goal and actual observation in one reviewed action. */
export function followupOwnAction(playerEventSequence: number): ChatNarrativeActionV1 {
  const {actorKey: _actor, ...goal} = followupSituation().newGoals[0]
  const {audienceKeys: _audience, participantKeys: _participants, ...thread} = followupSituation().newThreads[0]
  return {...followupResultAction(), followupGoal: {playerEventSequence, playerExcerpt: '可以看看雨停后门口有没有积水吗',
    evidenceExcerpt: '我站在门内向外查看了门口的积水。', goal, thread}}
}
export async function seedClosedChatFollowupFixtureV1(options: {maxActionsPerTrigger?: number; directorBudget?: number; playerFollowup?: boolean} = {}) {
  const f = await seedChatNarrativeRuntimeFixture({...options, playerFollowup: options.playerFollowup ?? true})
  let v = await readProductRuntimeStateVersion(f.sessionId)
  const trigger = await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'followup.close.trigger', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  v = await readProductRuntimeStateVersion(f.sessionId)
  const action: ChatNarrativeActionV1 = {kind: 'pause', text: '我不再寻找铜印，本次寻找结束。', goalKey: 'find-seal', evidenceFactKeys: ['lost'],
    audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: 'abandoned', nextPossibilities: []}
  await commitChatNarrativeAction({sessionId: f.sessionId, commandId: 'followup.close', baseSequence: v.sequence, baseStateHash: v.stateHash, triggerSequence: trigger.sequence, actorKey: 'guard', messageId: 'followup.closed', action, review: chatActionReviewFixture(action)})
  return f
}
