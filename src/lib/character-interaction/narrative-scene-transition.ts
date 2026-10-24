import type {CharacterInteractionRuntimeState} from '../types'
import type {ChatNarrativeActionV1, ChatNarrativeStateV1, ChatNarrativeTriggerStateV1} from '../types/chat-narrative'
import {isChatMessageRetrievableV1} from './narrative-retrieval'
import {validateChatPlayerRequestEvidenceV1} from './narrative-player-pause'

function fail(message: string): never {throw new Error(`[chat-scene-transition] ${message}`)}
function row(value: unknown, fields: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== fields.split(',').sort().join(',')) fail('转场字段无效')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('转场文本无效')
}
function key(value: unknown): asserts value is string {
  text(value, 160)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value)) fail('转场引用无效')
}
function sequence(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || value === 0) fail('转场须引用实际事件')
}
export function validateChatSceneTransitionV1(value: unknown): void {
  const r = row(value, 'destinationFactKey,destinationExcerpt,arrivalFactKey,evidenceExcerpt,playerEventSequence,playerExcerpt')
  key(r.destinationFactKey); key(r.arrivalFactKey); text(r.destinationExcerpt, 200); text(r.evidenceExcerpt, 2000)
  validateChatPlayerRequestEvidenceV1({playerEventSequence: r.playerEventSequence, playerExcerpt: r.playerExcerpt})
}

/** Check the unchanged situation, before disclosures or newly created facts.
 * Semantic consent/arrival is independently reviewed, never inferred from a quote match. */
export function requireChatSceneTransitionV1(state: CharacterInteractionRuntimeState, actorKey: string, trigger: ChatNarrativeTriggerStateV1, action: ChatNarrativeActionV1) {
  const change = action.sceneTransition
  if (change == null) return null
  const story = state.chatNarrative!, scene = state.activeScene!
  const destination = story.situation.facts.find(f => f.factKey === change.destinationFactKey)
  const arrival = action.newFacts.find(f => f.factKey === change.arrivalFactKey)
  const source = state.messages.filter(m => m.role === 'player' && m.supersededBySequence == null).slice(-1)[0]
  if (!source || source.eventSequence !== change.playerEventSequence || !isChatMessageRetrievableV1(state, source)
    || source.eventSequence <= scene.startedAtSequence || !source.text.includes(change.playerExcerpt)
    || source.audienceKeys != null && !source.audienceKeys.includes(actorKey)
    || !['player-response', 'continue'].includes(trigger.kind)
    || trigger.kind === 'player-response' && trigger.sourceEventSequence !== source.eventSequence
    || source.eventSequence >= trigger.requestedSequence
    || story.sceneTransitions?.some(t => t.requested.messageId === source.messageId)) fail('转场缺少当前场景最新且未消费的真实玩家授权来源')
  if (scene.activeParticipantKeys.length !== 1 || scene.activeParticipantKeys[0] !== actorKey
    || action.audienceKeys.length !== 2 || !action.audienceKeys.includes(actorKey) || !action.audienceKeys.includes(state.playerKey)
    || action.kind !== 'complete' || action.waitingForPlayer
    || !story.situation.goals.some(g => g.goalKey === action.goalKey && g.actorKey === actorKey && g.status === 'active')
    || action.followupGoal != null || action.threadFollowupGoal != null || action.pauseGoal != null || action.promiseRequest != null) fail('转场须是当前单角色场景的实际完成行动，不能代其他角色移动或绕过目标授权')
  if (!destination || !destination.audienceKeys.includes(actorKey) || !destination.audienceKeys.includes(state.playerKey)
    || !destination.text.includes(change.destinationExcerpt) || change.destinationExcerpt === story.situation.location
    || !action.evidenceFactKeys.includes(destination.factKey)
    || !arrival || action.newFacts.length !== 1 || arrival.kind !== 'observation'
    || !arrival.evidenceFactKeys.includes(destination.factKey) || !arrival.text.includes(change.destinationExcerpt)
    || !change.evidenceExcerpt.includes(arrival.text) || !action.text.includes(change.evidenceExcerpt)) fail('转场必须引用此前双方已知地点和本次实际到达事实；不得以新造地点或调查结果代替')
  return {change, source}
}

export function applyChatSceneTransitionV1(state: CharacterInteractionRuntimeState, input: {
  actorKey: string; messageId: string; sequence: number; transition: NonNullable<ReturnType<typeof requireChatSceneTransitionV1>>
}): void {
  const {change, source} = input.transition, story = state.chatNarrative!, scene = state.activeScene!
  const record = {sceneKey: scene.sceneKey, actorKey: input.actorKey, fromLocation: story.situation.location,
    destinationFactKey: change.destinationFactKey, destinationExcerpt: change.destinationExcerpt, arrivalFactKey: change.arrivalFactKey,
    requested: {messageId: source.messageId, sequence: source.eventSequence, excerpt: source.text},
    arrived: {messageId: input.messageId, sequence: input.sequence, excerpt: change.evidenceExcerpt}}
  story.sceneTransitions = [...(story.sceneTransitions ?? []), record]
  story.situation.location = scene.location = change.destinationExcerpt
  story.situation.title = scene.title = change.destinationExcerpt
}

export function validateChatSceneTransitionRecordsV1(state: ChatNarrativeStateV1, boundary: {participantKeys: readonly string[]; sceneKeys: readonly string[]}): void {
  if (state.sceneTransitions === undefined) return
  if (!Array.isArray(state.sceneTransitions) || state.sceneTransitions.length > 1000 || state.revision === 0 && state.sceneTransitions.length) fail('转场历史无效')
  const requests = new Set<string>(), arrivals = new Set<string>()
  let previous = Number.MIN_SAFE_INTEGER
  for (const value of state.sceneTransitions) {
    const r = row(value, 'sceneKey,actorKey,fromLocation,destinationFactKey,destinationExcerpt,arrivalFactKey,requested,arrived')
    key(r.sceneKey); key(r.actorKey); key(r.destinationFactKey); key(r.arrivalFactKey)
    text(r.fromLocation, 4000); text(r.destinationExcerpt, 200)
    if (!boundary.sceneKeys.includes(r.sceneKey) || !boundary.participantKeys.includes(r.actorKey)) fail('转场场景或角色越界')
    for (const v of [r.requested, r.arrived]) {
      const e = row(v, 'messageId,sequence,excerpt'); text(e.messageId, 200); text(e.excerpt, 20000); sequence(e.sequence)
    }
    const {requested, arrived} = value
    const destination = state.situation.facts.find(f => f.factKey === value.destinationFactKey)
    const arrival = state.situation.facts.find(f => f.factKey === value.arrivalFactKey)
    if (!destination || !destination.text.includes(value.destinationExcerpt)
      || destination.sourceEventSequence !== 0 && destination.sourceEventSequence >= arrived.sequence
      || !arrival || arrival.origin !== 'runtime-consequence' || arrival.sourceEventSequence !== arrived.sequence
      || !arrival.text.includes(value.destinationExcerpt) || !arrived.excerpt.includes(arrival.text)
      || [destination, arrival].some(f => !f.audienceKeys.includes('player') || !f.audienceKeys.includes(value.actorKey))
      || value.fromLocation === value.destinationExcerpt || requested.sequence >= arrived.sequence || arrived.sequence > state.lastEventSequence
      || arrived.sequence <= previous || requested.messageId === arrived.messageId || requests.has(requested.messageId) || arrivals.has(arrived.messageId)) fail('转场历史缺少一致的事实、授权及到达顺序')
    requests.add(requested.messageId); arrivals.add(arrived.messageId); previous = arrived.sequence
  }
}

export function assertChatSceneTransitionSourcesV1(state: CharacterInteractionRuntimeState): void {
  for (const r of state.chatNarrative?.sceneTransitions ?? []) {
    const source = state.messages.find(m => m.messageId === r.requested.messageId && m.eventSequence === r.requested.sequence)
    const arrival = state.messages.find(m => m.messageId === r.arrived.messageId && m.eventSequence === r.arrived.sequence)
    if (!source || source.role !== 'player' || source.supersededBySequence != null || source.text !== r.requested.excerpt
      || source.audienceKeys != null && !source.audienceKeys.includes(r.actorKey)
      || !arrival || arrival.role !== 'character' || arrival.speakerKey !== r.actorKey || arrival.supersededBySequence != null
      || !arrival.text.includes(r.arrived.excerpt) || !arrival.audienceKeys?.includes(r.actorKey) || !arrival.audienceKeys.includes(state.playerKey)) fail('转场缺少完整玩家授权或角色到达消息')
  }
  const latest = state.chatNarrative?.sceneTransitions?.slice(-1)[0], scene = state.activeScene, situation = state.chatNarrative?.situation
  // A later explicitly constructed scene may have its own location. Otherwise
  // the last completed visit must still be reflected in both current views.
  if (latest && scene && situation && latest.sceneKey === scene.sceneKey && situation.sceneKey === scene.sceneKey
    && latest.arrived.sequence > scene.startedAtSequence && situation.seed.sourceEventSequence <= latest.arrived.sequence
    && (scene.location !== latest.destinationExcerpt || situation.location !== latest.destinationExcerpt)) fail('已完成转场与当前场景地点不一致')
}

export function validateChatSceneTransitionCheckV1(value: unknown, action: ChatNarrativeActionV1): void {
  const transition = action.sceneTransition
  if (transition == null) {if (value !== undefined) fail('没有转场的候选不能附带转场审查'); return}
  const check = row(value, 'destinationFactKey,arrivalFactKey,playerEventSequence,passed,reason')
  text(check.reason, 2000)
  if (check.destinationFactKey !== transition.destinationFactKey || check.arrivalFactKey !== transition.arrivalFactKey
    || check.playerEventSequence !== transition.playerEventSequence || typeof check.passed !== 'boolean') fail('转场审查未绑定本次授权和到达')
}

export function supportsChatSceneTransitionV1(version: string | undefined): boolean {
  return ['chat-narrative-action-review-v28', 'chat-narrative-options-review-v22', 'chat-narrative-action-review-v29', 'chat-narrative-options-review-v23', 'chat-narrative-action-review-v30', 'chat-narrative-action-review-v31', 'chat-narrative-action-review-v32', 'chat-narrative-action-review-v33', 'chat-narrative-action-review-v34', 'chat-narrative-action-review-v35', 'chat-narrative-action-review-v36', 'chat-narrative-action-review-v37', 'chat-narrative-action-review-v38', 'chat-narrative-action-review-v39', 'chat-narrative-action-review-v40', 'chat-narrative-action-review-v41', 'chat-narrative-action-review-v42', 'chat-narrative-options-review-v24', 'chat-narrative-options-review-v25', 'chat-narrative-options-review-v26', 'chat-narrative-options-review-v27', 'chat-narrative-options-review-v28', 'chat-narrative-options-review-v29', 'chat-narrative-options-review-v30'].includes(version ?? '')
}
export function supportsChatSceneTransitionPromptV1(version: string | undefined): boolean {
  return ['chat-narrative-action-v34', 'chat-narrative-options-v24', 'chat-action-revision-v16', 'chat-action-revision-v17', 'chat-action-revision-v18', 'chat-action-revision-v19', 'chat-action-revision-v20', 'chat-action-revision-v21', 'chat-action-revision-v22', 'chat-action-revision-v23', 'chat-action-revision-v24', 'chat-action-revision-v25', 'chat-narrative-action-v35', 'chat-narrative-options-v25', 'chat-narrative-action-v36', 'chat-narrative-action-v37', 'chat-narrative-action-v38', 'chat-narrative-action-v39', 'chat-narrative-action-v40', 'chat-narrative-action-v41', 'chat-narrative-action-v42', 'chat-narrative-action-v43', 'chat-narrative-action-v44', 'chat-narrative-action-v45', 'chat-narrative-action-v46', 'chat-narrative-action-v47', 'chat-narrative-action-v48', 'chat-narrative-action-v50', 'chat-narrative-action-v51', 'chat-narrative-action-v52', 'chat-narrative-action-v53', 'chat-narrative-action-v54', 'chat-narrative-action-v55', 'chat-narrative-action-v56', 'chat-narrative-action-v57', 'chat-narrative-action-v58', 'chat-narrative-action-v59', 'chat-narrative-action-v60', 'chat-narrative-action-v61', 'chat-narrative-action-v62', 'chat-narrative-action-v63', 'chat-narrative-action-v64', 'chat-narrative-action-v65', 'chat-narrative-action-v66', 'chat-narrative-action-v67', 'chat-narrative-action-v68', 'chat-narrative-action-v69', 'chat-narrative-action-v70', 'chat-narrative-action-v71', 'chat-narrative-action-v72', 'chat-narrative-options-v26', 'chat-narrative-options-v27', 'chat-narrative-options-v28', 'chat-narrative-options-v29', 'chat-narrative-options-v30', 'chat-narrative-options-v31', 'chat-narrative-options-v32', 'chat-narrative-options-v33', 'chat-narrative-options-v34', 'chat-narrative-options-v35', 'chat-narrative-options-v36', 'chat-narrative-options-v37', 'chat-narrative-options-v38', 'chat-narrative-options-v39', 'chat-narrative-options-v40', 'chat-narrative-options-v41', 'chat-narrative-options-v42'].includes(version ?? '')
}
export function assertChatSceneTransitionReviewVersionV1(actions: readonly ChatNarrativeActionV1[], version: string | undefined): void {
  if (actions.some(a => a.sceneTransition != null) && !supportsChatSceneTransitionV1(version)) fail('旧审查合同不支持玩家授权转场；保留原候选，不自动换约或重发')
}

export const CHAT_SCENE_TRANSITION_ACTION_RULE_V1 = 'sceneTransition 默认为 null。当前仅有你一个在场角色时，玩家最新真实消息明确允许与你前往此前双方已知的地点，可把实际共同到达登记为本次 complete 行动的后果；不是邀请、准备、出发、等待或继续按钮本身。填 {destinationFactKey:"此前双方已知地点的事实",destinationExcerpt:"该事实里的地点名称原文",arrivalFactKey:"本次到达事实标识",evidenceExcerpt:"本次实际共同到达的原话",playerEventSequence:真实玩家事件序号,playerExcerpt:"完整授权条件原话"}，waitingForPlayer=false，保留自身 active 目标。newFacts 只登记这一条 observation 到达事实，正文含地点原文，并引用原地点事实；evidenceFactKeys 同样引用它。不得发明地点、借新披露授权或代其他角色移动。仅 player-response 或随后 continue 且没有更新的玩家消息、尚未使用此授权时有效；return 不是转场机会。一次授权只完成一次到达。保留不购买、不拆解等全部条件，不能把到达当作调查、购买或履约结果；需要当地普通条件可按既有 situationRequest 在到达之后另行构建。不能同时 followupGoal/threadFollowupGoal/pauseGoal/promiseRequest；原 playerPause/resumeGoal 和承诺约束仍有效。系统原子更新当前场景标题地点并保存完整玩家原话，时间和参与者不变。'
export const CHAT_SCENE_TRANSITION_REVIEW_RULE_V1 = '转场专审：明确授权的既有地点共同到达是 continuity/player-agency 中禁止擅自移动的受限例外，不要求再次征得同一许可。逐一对照完整最新玩家消息、前文条件、当前地点、此前双方可知事实和候选正文。目的地必须确实是已有可前往地点，不能把猜测、否定、比喻或同名文字当地点。必须明确授权共同前往该处；含糊回应、提议讨论、条件尚未满足、撤回、拒绝、继续或返回按钮都不构成许可。候选须确实完成双方到达，仅出发/邀请/打算/途中不能更新位置。所有限制和原责任继续有效；不得捎带购买、拆解、调查结果、替其他角色移动或借转场泄密。若正文声称共同到达却没有 sceneTransition，consequences 必须失败，不能留下文字与场景分离。含转场的每条候选额外输出 sceneTransitionCheck:{destinationFactKey,arrivalFactKey,playerEventSequence,passed,reason}，精确绑定该候选；没有转场则省略该字段，不写 null。该检查和原六项、承诺及记忆检查均须通过，字段匹配本身不是语义许可。'
