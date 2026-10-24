import type {CharacterInteractionRuntimeState} from '../types'
import type {ChatActorGoalV1, ChatNarrativeActionV1, ChatNarrativeTriggerStateV1, ChatPlayerRequestEvidenceV1} from '../types/chat-narrative'
import {isChatMessageRetrievableV1} from './narrative-retrieval'

function fail(message: string): never {throw new Error(`[chat-player-pause] ${message}`)}
function row(value: unknown, fields: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== fields.split(',').sort().join(',')) fail('暂停依据字段无效')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('暂停依据文本无效')
}
function sequence(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || value === 0) fail('暂停依据必须来自实际事件')
}
export function validateChatPlayerRequestEvidenceV1(value: unknown): void {
  const r = row(value, 'playerEventSequence,playerExcerpt')
  sequence(r.playerEventSequence); text(r.playerExcerpt, 1200)
}
export function validateChatGoalPlayerPauseV1(value: unknown, input: {initial: boolean; status: string; updatedSequence: number; threadKeys: string[]}): void {
  if (value === undefined) return
  if (input.initial || input.status !== 'paused') fail('玩家暂停只能属于运行中的暂停目标')
  const p = row(value, 'threadKey,requested,acknowledged')
  if (!input.threadKeys.includes(String(p.threadKey))) fail('暂停引用的原事项不存在')
  for (const item of [p.requested, p.acknowledged]) {
    const e = row(item, 'messageId,sequence,excerpt'); text(e.messageId, 200); text(e.excerpt, 2000); sequence(e.sequence)
  }
  const requested = p.requested as {sequence: number; messageId: string}, acknowledged = p.acknowledged as {sequence: number; messageId: string}
  if (requested.sequence >= acknowledged.sequence || acknowledged.sequence > input.updatedSequence || requested.messageId === acknowledged.messageId) fail('暂停请求和确认的事件顺序无效')
}

/** The semantic reviewer decides whether the quote actually grants a hold or
 * release. Domain checks bind it to this turn and to the entire audience. */
export function requireChatPlayerRequestV1(state: CharacterInteractionRuntimeState, actorKey: string, trigger: ChatNarrativeTriggerStateV1, request: ChatPlayerRequestEvidenceV1, audiences: string[]) {
  const source = state.messages.find(m => m.role === 'player' && m.eventSequence === request.playerEventSequence)
  if (trigger.kind !== 'player-response' || trigger.actionSequences.length || trigger.sourceEventSequence !== request.playerEventSequence
    || !source || source.supersededBySequence != null || !isChatMessageRetrievableV1(state, source)
    || state.messages.filter(m => m.role === 'player' && m.supersededBySequence == null).slice(-1)[0] !== source
    || !source.text.includes(request.playerExcerpt) || source.audienceKeys != null && [actorKey, ...audiences.filter(k => k !== state.playerKey)].some(k => !source.audienceKeys!.includes(k))) fail('暂停或恢复必须引用本轮真实可见的最新玩家消息，不以继续操作代替')
  return source
}

/** A hold on an existing responsibility needs no invented followup goal.
 * Only the current player's request authorizes this new boundary; the review
 * still verifies the acknowledgement and every separately promised term. */
export function requireChatExistingGoalPauseV1(state: CharacterInteractionRuntimeState, actorKey: string, trigger: ChatNarrativeTriggerStateV1, action: ChatNarrativeActionV1) {
  const pause = action.pauseGoal
  if (pause == null) return null
  const story = state.chatNarrative, goal = story?.situation.goals.find(g => g.actorKey === actorKey && g.goalKey === action.goalKey)
  const thread = story?.situation.threads.find(t => t.threadKey === pause.threadKey)
  if (!goal || !['active', 'paused'].includes(goal.status) || goal.playerPause
    || !thread || !['open', 'blocked', 'paused'].includes(thread.status)
    || !thread.participantKeys.includes(actorKey) || !thread.audienceKeys.includes(actorKey)
    || action.kind !== 'speak' || !action.waitingForPlayer
    || action.goalStatus !== (goal.status === 'active' ? 'paused' : null)
    || action.followupGoal != null || action.threadFollowupGoal != null || action.resumeGoal != null || action.promiseRequest != null
    || action.newFacts.length || action.goalUpdates?.length || action.relationshipUpdates?.length || action.beliefUpdates?.length
    || action.nextPossibilities?.length || action.situationRequest != null
    || action.commitmentEffects?.some(e => e.kind !== 'promise')
    || action.threadUpdates.some(e => e.threadKey !== pause.threadKey || e.status !== 'paused')
    || !action.evidenceFactKeys.length && action.disclosures.length
    || !action.text.includes(pause.evidenceExcerpt)) fail('已有目标暂停只能确认当前自身剩余责任及真实请求，不能推进、换目标或处置旧约')
  const source = requireChatPlayerRequestV1(state, actorKey, trigger, pause, action.audienceKeys)
  return {goal, source, pause}
}

export function supportsChatExistingGoalPauseV1(version: string | undefined): boolean {
  return ['chat-narrative-action-review-v27', 'chat-narrative-options-review-v21', 'chat-narrative-action-review-v28', 'chat-narrative-options-review-v22', 'chat-narrative-action-review-v29', 'chat-narrative-options-review-v23', 'chat-narrative-action-review-v30', 'chat-narrative-action-review-v31', 'chat-narrative-action-review-v32', 'chat-narrative-action-review-v33', 'chat-narrative-action-review-v34', 'chat-narrative-action-review-v35', 'chat-narrative-action-review-v36', 'chat-narrative-action-review-v37', 'chat-narrative-action-review-v38', 'chat-narrative-action-review-v39', 'chat-narrative-action-review-v40', 'chat-narrative-action-review-v41', 'chat-narrative-action-review-v42', 'chat-narrative-options-review-v24', 'chat-narrative-options-review-v25', 'chat-narrative-options-review-v26', 'chat-narrative-options-review-v27', 'chat-narrative-options-review-v28', 'chat-narrative-options-review-v29', 'chat-narrative-options-review-v30'].includes(version ?? '')
}
export function supportsChatExistingGoalPausePromptV1(version: string | undefined): boolean {
  return ['chat-narrative-action-v33', 'chat-narrative-options-v23', 'chat-action-revision-v15', 'chat-narrative-action-v34', 'chat-narrative-options-v24', 'chat-action-revision-v16', 'chat-action-revision-v17', 'chat-action-revision-v18', 'chat-action-revision-v19', 'chat-action-revision-v20', 'chat-action-revision-v21', 'chat-action-revision-v22', 'chat-action-revision-v23', 'chat-action-revision-v24', 'chat-action-revision-v25', 'chat-narrative-action-v35', 'chat-narrative-options-v25', 'chat-narrative-action-v36', 'chat-narrative-action-v37', 'chat-narrative-action-v38', 'chat-narrative-action-v39', 'chat-narrative-action-v40', 'chat-narrative-action-v41', 'chat-narrative-action-v42', 'chat-narrative-action-v43', 'chat-narrative-action-v44', 'chat-narrative-action-v45', 'chat-narrative-action-v46', 'chat-narrative-action-v47', 'chat-narrative-action-v48', 'chat-narrative-action-v50', 'chat-narrative-action-v51', 'chat-narrative-action-v52', 'chat-narrative-action-v53', 'chat-narrative-action-v54', 'chat-narrative-action-v55', 'chat-narrative-action-v56', 'chat-narrative-action-v57', 'chat-narrative-action-v58', 'chat-narrative-action-v59', 'chat-narrative-action-v60', 'chat-narrative-action-v61', 'chat-narrative-action-v62', 'chat-narrative-action-v63', 'chat-narrative-action-v64', 'chat-narrative-action-v65', 'chat-narrative-action-v66', 'chat-narrative-action-v67', 'chat-narrative-action-v68', 'chat-narrative-action-v69', 'chat-narrative-action-v70', 'chat-narrative-action-v71', 'chat-narrative-action-v72', 'chat-narrative-options-v26', 'chat-narrative-options-v27', 'chat-narrative-options-v28', 'chat-narrative-options-v29', 'chat-narrative-options-v30', 'chat-narrative-options-v31', 'chat-narrative-options-v32', 'chat-narrative-options-v33', 'chat-narrative-options-v34', 'chat-narrative-options-v35', 'chat-narrative-options-v36', 'chat-narrative-options-v37', 'chat-narrative-options-v38', 'chat-narrative-options-v39', 'chat-narrative-options-v40', 'chat-narrative-options-v41', 'chat-narrative-options-v42'].includes(version ?? '')
}
export function assertChatExistingGoalPauseReviewVersionV1(actions: readonly ChatNarrativeActionV1[], version: string | undefined): void {
  if (actions.some(a => a.pauseGoal != null) && !supportsChatExistingGoalPauseV1(version)) fail('旧审查合同不支持已有目标的玩家暂停；保留原候选，不自动换约或重发')
}

export const CHAT_EXISTING_GOAL_PAUSE_COMMITMENT_RULE_V1 = '仅在合法 pauseGoal 完整承载同一暂停条件时，该条件已有 playerPause 来源和恢复约束，不重复建立 promise；额外独立的未来义务仍须登记，原承诺不可因此抹除。'

export const CHAT_EXISTING_GOAL_PAUSE_ACTION_RULE_V1 = 'pauseGoal 默认为 null。玩家本轮明确要求暂停你已有的 active/paused 责任，而你接受时，不新建目标：goalKey 保留原目标，填 pauseGoal={threadKey:"自己参与且知情的未结束原事项",playerEventSequence:trigger.sourceEventSequence,playerExcerpt:"完整暂停条件的玩家原话",evidenceExcerpt:"本次明确接受的逐字原话"}。只能首次player-response、speak、waitingForPlayer=true；active目标用goalStatus=paused，已自行paused但没有playerPause的目标用goalStatus=null。系统在原目标记录真实playerPause，继续/返回不会解除。可同时如实报告已完成观察，但须引用可知事实、完整登记实际披露；只确认暂停时可以evidenceFactKeys=[]，不引用无关世界事实。不得做新动作、生成结果、改其他目标/关系/猜测、增加打算或情境，也不能同时followupGoal/threadFollowupGoal/resumeGoal/promiseRequest。nextPossibilities=null或[]，threadUpdates仅可按实际范围把原线paused。同一暂停条件由playerPause完整保存并强制执行，不需要再为相同等待条件新增promise；尤其不能覆盖原有未履行承诺。正文另有独立未来义务时仍完整登记commitmentEffects.promise；不能在暂停路径履行、撤回或改约。已有playerPause只能沿原resumeGoal规则处理，不能覆盖原请求；普通客套、含糊回应或玩家不亲自参与不自动构成暂停。'
export const CHAT_EXISTING_GOAL_PAUSE_REVIEW_RULE_V1 = '已有目标暂停专审：接受玩家对已有自身责任的明确暂停，须用pauseGoal把原目标与本轮真实请求及完整确认绑定，不能只改goalStatus而丢失恢复条件，也不能另建目标绕过。核对原责任、threadKey、完整暂停范围、条件与否定、摘录和听众；不是仅因玩家消息较新或字段合法就放行。允许在暂停未来行动时报告已完成观察，不能借报告继续检查或新增结果；空事实引用只支持确认这项暂停和对应等待约定，不能支持背景断言或知识披露。合法pauseGoal把本次暂停条件、玩家原请求和完整确认保存为可执行控制边界；同一等待条件已经由playerPause承载，没有重复promise不构成漏记。这仅覆盖该原责任的暂停及恢复条件，不能豁免额外独立的未来义务；额外承诺仍按commitmentChecks核验，旧约不得在此路径履行、撤回或偷偷改写。原已有playerPause不可覆盖，继续/返回或普通回复不能解除；解除后仍按原resumeGoal及原约核验。没有明确玩家暂停的自主暂缓保持原规则，不强造控制边界或承诺。'

export function assertChatPlayerPauseSourcesV1(state: CharacterInteractionRuntimeState): void {
  for (const goal of state.chatNarrative?.situation.goals ?? []) {
    const pause = goal.playerPause
    if (!pause) continue
    const request = state.messages.find(m => m.messageId === pause.requested.messageId && m.eventSequence === pause.requested.sequence)
    const ack = state.messages.find(m => m.messageId === pause.acknowledged.messageId && m.eventSequence === pause.acknowledged.sequence)
    if (!request || request.role !== 'player' || request.supersededBySequence != null || !request.text.includes(pause.requested.excerpt)
      || !ack || ack.role !== 'character' || ack.speakerKey !== goal.actorKey || ack.supersededBySequence != null || !ack.text.includes(pause.acknowledged.excerpt)
      || !ack.audienceKeys?.includes(goal.actorKey) || !ack.audienceKeys.includes(state.playerKey)
      || request.audienceKeys != null && ack.audienceKeys.some(k => k !== state.playerKey && !request.audienceKeys!.includes(k))) fail('暂停缺少同一玩家请求与角色实际确认的消息依据')
    const thread = state.chatNarrative!.situation.threads.find(t => t.threadKey === pause.threadKey)
    if (!thread?.participantKeys.includes(goal.actorKey) || !thread.audienceKeys.includes(goal.actorKey)) fail('暂停不能接管其他角色或不可知事项')
  }
}

/** Run before a new followup goal is previewed. No background, ownership,
 * message or event is created here; the existing reviewed action commits it. */
export function applyChatPlayerGoalResumeV1(state: CharacterInteractionRuntimeState, input: {action: ChatNarrativeActionV1; actorKey: string; trigger: ChatNarrativeTriggerStateV1}): void {
  const {action, actorKey, trigger} = input, goals = state.chatNarrative!.situation.goals
  const held = goals.filter(g => g.actorKey === actorKey && g.playerPause)
  if (held.some(g => g.goalKey !== action.goalKey && (action.goalUpdates?.some(e => e.goalKey === g.goalKey) || action.threadUpdates.some(e => e.threadKey === g.playerPause!.threadKey)))) fail('不能用另一个目标或附带变化绕过玩家暂停')
  const goal = held.find(g => g.goalKey === action.goalKey)
  if (!goal) {if (action.resumeGoal != null) fail('当前目标没有待恢复的玩家暂停'); return}
  if (action.resumeGoal == null) {
    if (!['speak', 'pause'].includes(action.kind) || !action.waitingForPlayer || action.goalStatus !== null || action.goalUpdates?.length
      || action.newFacts.length || action.threadUpdates.length || action.commitmentEffects?.length || action.nextPossibilities?.length || action.situationRequest != null) fail('玩家暂停尚未解除，只能等待或回应，不能执行和改写暂停事项')
    return
  }
  const source = requireChatPlayerRequestV1(state, actorKey, trigger, action.resumeGoal, action.audienceKeys)
  if (source.eventSequence <= goal.playerPause!.acknowledged.sequence || !['active', 'fulfilled', 'abandoned'].includes(action.goalStatus ?? '')
    || action.followupGoal != null || action.threadFollowupGoal != null) fail('恢复须来自确认暂停后的新玩家依据，并明确处置原目标')
  delete goal.playerPause
}

export function chatPlayerPauseSequencesV1(goals: ChatActorGoalV1[]): number[] {
  return goals.flatMap(g => g.playerPause ? [g.playerPause.requested.sequence, g.playerPause.acknowledged.sequence] : [])
}
export function rebaseChatPlayerPausesV1(goals: ChatActorGoalV1[], rebase: (sequence: number) => number): void {
  for (const g of goals) if (g.playerPause) {
    g.playerPause.requested.sequence = rebase(g.playerPause.requested.sequence)
    g.playerPause.acknowledged.sequence = rebase(g.playerPause.acknowledged.sequence)
  }
}
export function supportsChatPlayerPauseV1(version: string | undefined): boolean {
  return ['chat-narrative-action-review-v22', 'chat-narrative-options-review-v16', 'chat-narrative-action-review-v23', 'chat-narrative-options-review-v17', 'chat-narrative-action-review-v24', 'chat-narrative-options-review-v18', 'chat-narrative-action-review-v25', 'chat-narrative-options-review-v19', 'chat-narrative-action-review-v26', 'chat-narrative-options-review-v20', 'chat-narrative-action-review-v27', 'chat-narrative-options-review-v21', 'chat-narrative-action-review-v28', 'chat-narrative-options-review-v22', 'chat-narrative-action-review-v29', 'chat-narrative-options-review-v23', 'chat-narrative-action-review-v30', 'chat-narrative-action-review-v31', 'chat-narrative-action-review-v32', 'chat-narrative-action-review-v33', 'chat-narrative-action-review-v34', 'chat-narrative-action-review-v35', 'chat-narrative-action-review-v36', 'chat-narrative-action-review-v37', 'chat-narrative-action-review-v38', 'chat-narrative-action-review-v39', 'chat-narrative-action-review-v40', 'chat-narrative-action-review-v41', 'chat-narrative-action-review-v42', 'chat-narrative-options-review-v24', 'chat-narrative-options-review-v25', 'chat-narrative-options-review-v26', 'chat-narrative-options-review-v27', 'chat-narrative-options-review-v28', 'chat-narrative-options-review-v29', 'chat-narrative-options-review-v30'].includes(version ?? '')
}

export const CHAT_PLAYER_PAUSE_ACTION_RULE_V1 = '以下明确暂停路径是原线接续首步须实际行动的唯一例外：若符合 threadFollowupGoal 的原线接续条件，但本轮玩家明确要求暂缓角色尚负责的剩余事项，可在该字段加 pauseRequest:{playerEventSequence:trigger.sourceEventSequence,playerExcerpt:"本轮要求暂缓的逐字摘录"}。新目标只描述原责任剩余部分，不能复活旧目标或将拒绝变成新任务；kind=speak、waitingForPlayer=true、goalStatus=paused，只表达接受暂缓，newFacts/disclosures/goalUpdates/relationshipUpdates/beliefUpdates=[]，nextPossibilities=null或[]，situationRequest=null，不作实际推进。threadUpdates 只能按实际表达与知情范围把原线设为 paused，个人暂停不强制暂停共同行动。若明确答应等待，完整条款仍登记 commitmentEffects.promise；不得登记履行。系统保存真实请求和确认到新目标 playerPause。原线不存在角色自己的剩余责任时，不能为了存暂停强造目标，应自然回应。'
export const CHAT_PLAYER_RESUME_ACTION_RULE_V1 = 'resumeGoal 默认为 null。自己的目标含 playerPause 时，其 requested 和 acknowledged 是已发生的暂停依据，不能由继续/返回解除。未获解除依据，只可 speak/pause、waitingForPlayer=true、goalStatus=null，不能推进、处置约定、改目标/原线或生成新的打算与情境。只有确认暂停之后的新 player-response 首步，玩家本轮确实解除原条件、允许恢复或明确取消该责任时，才填 resumeGoal:{playerEventSequence:trigger.sourceEventSequence,playerExcerpt:"本轮解除或取消的逐字摘录"}，goalKey 引用该原目标、goalStatus=active/fulfilled/abandoned，并按真实结果更新原线和处理原约。普通“嗯”、无关消息或简单继续不是解除；不能用附带目标更新或另建目标绕过。恢复只解除原限制，不替玩家做事、不等于已有成果或履约。'
export const CHAT_PLAYER_PAUSE_REVIEW_RULE_V1 = '玩家暂停及恢复专审：明确接受暂停是上述原线接续须实际行动的唯一例外；pauseRequest 须是本轮真实明确暂缓原事项的请求，角色仍有自己的剩余责任；新目标不能重做旧目标、把拒绝变成新任务或只是为回应而造目标。核对实际确认、暂停范围、完整约定和知情范围。含 playerPause 的原目标在没有真实解除依据时仍须保持等待；resumeGoal 的本轮玩家原话须明确解除记录的具体条件或明确取消原责任，不能仅凭消息较新、字段合法、简单“嗯”或继续操作放行。核对是否还存在其他未解除限制；恢复不是完成或履约。不能通过其他目标、无目标回应、附带变化或新情境绕过；确认暂停的表达用 speak 并可记录已明确作出的等待承诺，不能要求虚构实际进展。'
