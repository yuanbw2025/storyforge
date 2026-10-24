import {CHAT_SOURCE_UNIT_CONFIRMATION_PROMPT_V1} from './source-unit-confirmation-candidate'

/** Authoring evaluates a conditional disclosure rule; runtime still proves its
 * actual occurrence. No rule here establishes presence or changes a source fact. */
const conditionalDiscovery = `本次是作者制定未来调查条件的复核，尚未发生调查。discoverySupported 检查“如果实际完整满足这个条件，是否足以让角色获知这一项已由原文确立的事实”，不能混成“现在是否已经满足条件”或“保证以后一定成功”。在场、可接触、实际发问、答复及听众仍由后续开场与运行独立核验；本次复核不生成这些事实，不授予人物创作权限。条件明确要求先有在场与接触依据时，不得仅因原文没有当前在场信息、尚未问到或未保证对方会回答而否决；但省略必要身份、接触或实际证据的条件仍应否决。
对涉及人物陈述的条件，区分原文确立的事实、来源中的传闻，以及角色后来听到的一般说法。若原文明确确立某人亲自实施的行为或其自身用途，作者可以把身份明确的该当事人针对该事的具体亲历说明设为这项事实的发现条件；须实际取得与原文一致的说明，且来源没有相关的欺骗、不可靠、未知或另需核实的限制。复核理由应指出原文的行为主体、事实单位和条件中的对应证据。不能仅因“任何自述在现实中都可能撒谎”额外要求原作未规定的无限旁证。
这不是“有人说就当真”：猜测、传闻、转述、第三人的指控、身份不明的答复、关于他人未表达内心的推断，以及与原文或其限制冲突的陈述均不能据此确证事实；普通说法仍只证明说过。原文若只写“声称”“可能”或意图，也不能整理成行为已经完成。看见物品位置只证明位置，不连带证明经手者或用途。逐项检查全部事实、限制、初始知情和发现条件；任一不足仍返回 false，不能删除事实、改写授权或补造背景来通过。`

export function chatSourceUnitConfirmationPromptV1(promptVersion: string): string {
  if (promptVersion === 'chat-source-unit-confirmation-v1') return CHAT_SOURCE_UNIT_CONFIRMATION_PROMPT_V1
  if (promptVersion === 'chat-source-unit-confirmation-v2') return conditionalDiscovery + '\n' + CHAT_SOURCE_UNIT_CONFIRMATION_PROMPT_V1
  throw new Error('不支持的事实发现条件复核版本，不能自动换约')
}
