import type {ChatActionChoiceV1} from './action-choice-contract'
import type {InteractionContextWindow} from './runtime'
import {supportsChatPlayerAcknowledgementV1, assertChatPlayerAcknowledgementContextV1} from './player-acknowledgement-control'

export const CHAT_CHOICE_CONTINUATION_PRODUCER_V1 = 'chat-narrative-action-v71'
export const CHAT_POSSIBILITY_DISPOSITIONS_V1 = ['available', 'blocked', 'resolved', 'not-useful'] as const
export interface ChatPossibilityCheckV1 {
  index: number
  disposition: typeof CHAT_POSSIBILITY_DISPOSITIONS_V1[number]
  reason: string
}

export function supportsChatChoiceContinuationV1(version: string | undefined): boolean {
  return version === CHAT_CHOICE_CONTINUATION_PRODUCER_V1 || supportsChatPlayerAcknowledgementV1(version)
}

export const CHAT_CHOICE_CONTINUATION_EXPRESSION_RULE_V1 = '【选择与表达的分工】本合同选择步骤逐项核对已有发展方向。若随附草稿选中的 kind=wait，本步只生成 version:1 yield-to-player 控制候选，action=null，不生成任何台词，也不改成其它控制类型。必须填写真实的既有表达来源和具体依赖，不能编造依据；选择草稿并不证明应当等待，原确定性校验和独立审查仍可拒绝它。其它选择仍可按原始角色视角修正，不把方向核对当作既成事实、许可或必须逐项执行的剧情。'

export const CHAT_CHOICE_CONTINUATION_RULE_V1 = `
先逐项核对本次角色视角 possibilities，再比较下一步。输出 possibilityChecks，按原数组顺序每项恰好一次：{index:从0开始的原位置,disposition:"available|blocked|resolved|not-useful",reason:"基于当前事实和实际对话的简短理由，最多160字"}；无已有方向时填 []。available 表示现在仍有意义且具备条件；blocked 须说明该方向本身缺少什么条件；resolved 须有已经完成的依据；not-useful 说明为何现在不再值得推进。它们是判断草稿，不是事实、许可或目标变更，也不要求逐项执行。
不能因为一个提议尚待玩家决定，就把其他独立方向一起判为 blocked。已经表达过的建议不再当成新进展；仍未讨论、且确实影响当前安排的不同问题可以继续。先检查旧方向，再从当前目标和最新回应考虑新方向，不把旧清单当成全部可能，更不为了填表造新事情。若存在 available，不得以 wait 或空方向宣称现在只能等待；角色因真实理由暂停仍可选择 pause，独立审查照常判断。
wait 专指本次明确 continue、没有待处理结果/改写且非多人调度时，已有具体玩家决定未答、没有有意义独立方向，准备无新台词地交还控制。它不是“再说一句我等你”。首次提出问题或有必要的新说明应选 question/own-action 等合适方向；新玩家消息需要承接，不选静默 wait。选择 wait 后，表达步骤只填写原 version:1 yield-to-player 的来源与依赖，仍经原独立审查，不能把等待当成剧情进展。`

export function chatChoiceContinuationRulesV1(version: string | undefined): string {
  if (!supportsChatPlayerAcknowledgementV1(version)) return CHAT_CHOICE_CONTINUATION_RULE_V1
  return CHAT_CHOICE_CONTINUATION_RULE_V1.slice(0, CHAT_CHOICE_CONTINUATION_RULE_V1.indexOf('\nwait 专指')) + `
wait 表示已有具体玩家决定未答、没有有意义独立方向，而且没有待处理结果/改写、不是多人调度。本次 continue 可静默交还控制；本次 player-response 只有最新原话明确仅表示仍在听、没有新增待答内容且未作决定时，才可交还控制。不能只凭短句或语气词分类，不把回应推定成同意；新的问题、拒绝、取消、暂停要求、信息、决定或行动请求必须承接，不选择静默 wait。首次问题、必要的新说明或独立行动仍使用相应方向，不重复询问玩家想聊哪点或要不要继续。
选择 wait 后，表达只生成 yield-to-player 控制候选，action=null，没有新台词：continue 使用 version:1，符合上述条件的 player-response 使用 version:4。实际角色问题及此后的完整玩家回应仍需独立审查，不能把等待当成剧情进展。`
}

export function chatChoiceContinuationExpressionRuleV1(version: string | undefined): string {
  return supportsChatPlayerAcknowledgementV1(version)
    ? '【选择与表达的分工】若随附草稿选中的 kind=wait，只生成 yield-to-player 控制候选，action=null，不添加收尾台词。本次 continue 使用 version:1；本次 player-response 仅在最新原话只是表示倾听、没有新增待答内容且未作决定时使用 version:4。新问题、拒绝、决定、暂停或行动请求不能被静默忽略。来源与具体依赖必须真实，完整对话仍经独立审查；选择草稿不等于事实、许可或等待资格。其它选择照常依原视角核对。'
    : CHAT_CHOICE_CONTINUATION_EXPRESSION_RULE_V1
}

function fail(reason: string): never {throw new Error(`[chat-choice-continuation] ${reason}`)}

/** Full coverage of the delivered role plans, not a claim that the model's
 * semantic assessment is correct. Never consult coordinator-only plans. */
export function parseChatPossibilityChecksV1(value: unknown, context: Pick<InteractionContextWindow, 'chatNarrative'>): ChatPossibilityCheckV1[] {
  const plans = context.chatNarrative?.possibilities
  if (!plans || !Array.isArray(value) || value.length !== plans.length) fail('必须逐项核对本次已交付的自身方向')
  return value.map((item: unknown, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('方向核对必须是对象')
    const row = item as Record<string, unknown>
    if (Object.keys(row).sort().join(',') !== 'disposition,index,reason' || row.index !== index
      || !CHAT_POSSIBILITY_DISPOSITIONS_V1.includes(row.disposition as ChatPossibilityCheckV1['disposition'])
      || typeof row.reason !== 'string' || !row.reason.trim() || row.reason.length > 160) fail('方向核对缺失、重复、越界或理由无效')
    return {index, disposition: row.disposition as ChatPossibilityCheckV1['disposition'], reason: row.reason}
  })
}

export function chatChoiceWaitsSilentlyV1(choice: ChatActionChoiceV1 | undefined, version: string | undefined): boolean {
  return supportsChatChoiceContinuationV1(version) && !!choice?.directions.some(d => d.id === choice.selectedId && d.kind === 'wait')
}

export function assertChatChoiceContinuationV1(choice: ChatActionChoiceV1, context: Pick<InteractionContextWindow, 'chatNarrative'> & Partial<Pick<InteractionContextWindow, 'messages'>>, version?: string): void {
  const checks = choice.possibilityChecks ?? fail('缺少自身方向核对')
  const selected = choice.directions.find(d => d.id === choice.selectedId)
  if (checks.some(check => check.disposition === 'available') && (!selected || selected.kind === 'wait')) fail('仍有可推进方向时不能选择空方向或等待')
  if (selected?.kind !== 'wait') return
  const view = context.chatNarrative
  const acknowledged = supportsChatPlayerAcknowledgementV1(version) && view?.trigger?.kind === 'player-response'
  if ((!acknowledged && view?.trigger?.kind !== 'continue') || view?.trigger?.direction?.scheduling || view?.pendingSituation || view?.pendingEdit
    || !selected.playerDependency) fail('静默等待缺少可交还控制的轮次或具体玩家依赖')
  if (acknowledged) {
    if (!context.messages) fail('静默承接缺少实际交付的最新玩家原话')
    assertChatPlayerAcknowledgementContextV1({...context, messages: context.messages})
  }
}

/** No rewriting of a rejected output. This same check runs on retained bytes
 * during recovery and adoption, including non-schema provider transports. */
export function assertChatChoiceExpressionV1(output: string, choice: ChatActionChoiceV1 | undefined, version: string | undefined): void {
  if (!chatChoiceWaitsSilentlyV1(choice, version)) return
  const row = JSON.parse(output.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1'))
  if (!row || row.outcome !== 'handoff' || row.action !== null || ![1, ...(supportsChatPlayerAcknowledgementV1(version) ? [4] : [])].includes(row.handoff?.version)
    || row.handoff.kind !== 'yield-to-player') fail('静默等待必须交还控制，不能生成重复收尾台词或替换为其他结果')
}
