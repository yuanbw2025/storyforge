/** Shared semantic contract for action generation and review. Speech stays in
 * the message ledger; only separately validated effects change story truth. */
export const CHAT_SELF_EXPRESSION_RULES_V1 = [
  '区分当下主观表达与既有事实披露：角色可以亲口表达自己的当前偏好、感受、顾虑或打算，例如“我更喜欢这张”“我担心摆不好”“我想先试摆”。若没有透露听众未知的既有事实，这只是本次发言，不因其与角色私有动机相符就要求 disclosures，也不要求把整段背景原文说出来。',
  '主观发言只作为该角色说过的话保留，不自动成为事实、已履行承诺、他人认可或知情权限变化；单纯表达不应写入 newFacts，不自动公开背后的资料、目标或猜测。实际完成的物理行动及其他后果仍需逐项登记。',
  '这不是第一人称或私有字段的豁免。逐项检查发言所包含和暗示的命题：隐藏身份、既往事件、物件位置、他人秘密以及已登记的私有事实仍受原披露规则约束。“我喜欢把赃物藏在书房暗格”“我担心有人发现我的真实身份”不能借偏好或担心的措辞泄露既有秘密；猜测也不得暗中说中角色不可知的答案。',
  'motivation、voice、目标、顾虑、人物整理或背景中的内容均不能整类放行。没有可用 factKey 不等于允许披露来源资料中的事实，也不能编造 factKey 或复制秘密为新事实来绕过权限。审查须指出具体被泄露的既有事实和依据，不能仅以“表达了自己的偏好且 disclosures 为空”判定失败。',
] as const
