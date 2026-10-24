/** New generated disclosures use the existing per-fact semantic review path.
 * No historical action, source text or raw response is rewritten. */
export function requiresChatReviewedDisclosureV1(version: string | undefined): boolean {
  return ['chat-narrative-action-v69', 'chat-narrative-action-v70', 'chat-narrative-action-v71', 'chat-narrative-action-v72', 'chat-narrative-options-v41', 'chat-narrative-options-v42', 'chat-action-revision-v24', 'chat-action-revision-v25'].includes(version ?? '')
}

export const CHAT_REVIEWED_DISCLOSURE_RULE_V1 = 'disclosures 每项必须为 {factKey,toParticipantKeys,evidenceExcerpt,wording:"equivalent"}。只登记自己已知、且本次确实完整告知原先未知听众的既有事实；接收者必须属于本次听众。所有披露统一进入逐事实独立等义审查，包括照原话说出的内容，不另选逐字披露模式。evidenceExcerpt 逐字摘自本次表达；可用自然人称、语序和措辞完整传达原事实，但必须保留主体、否定、时地范围、不确定性和全部必要限制，不能增加推断或只传一部分。私有背景没有 factKey 也不授权泄露；不能复制秘密为新事实，展示位置不说明身份或动机。双方已知的内容不重复登记。实际物理变化另记 newFacts；每条披露通过独立审查后才更新知情。'

/** Reject malformed new outputs; never insert a missing mode into a response. */
export function assertChatReviewedDisclosureOutputV1(value: unknown, version: string | undefined): void {
  if (!requiresChatReviewedDisclosureV1(version) || value === null || typeof value !== 'object' || Array.isArray(value)) return
  const disclosures = (value as Record<string, unknown>).disclosures
  if (!Array.isArray(disclosures)) return // The canonical parser rejects a missing or invalid array.
  for (const item of disclosures) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)
      || (item as Record<string, unknown>).wording !== 'equivalent') throw new Error('[chat-output] 披露必须显式声明完整等义审查')
  }
}
