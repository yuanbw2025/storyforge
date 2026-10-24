import {CHAT_INQUIRY_REVIEW_CHECKS_V1, CHAT_SITUATION_REVIEW_CHECKS_V1, type ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'

export const inquiryReassurance = '不必猜，知道的部分直说就好。'
export const inquiryQuestion = '叶岑向掌柜问：“你最后把铜印放在哪里？”'
export const inquiryAnswer = '铜印仍在柜台下的木箱里，我可以确认这个位置。'
export const inquiryTruth = '铜印在柜台下的木箱里。'
export const inquiryPurpose = '铜印用于拓印破损的通行单。'
export function chatInquiryReviewFixture(draft: ChatSituationDraftV1) {
  return {checks: CHAT_SITUATION_REVIEW_CHECKS_V1.map(check => ({check, passed: true, reason: '工程夹具，不是语义验收'})),
    inquiryReview: {checks: CHAT_INQUIRY_REVIEW_CHECKS_V1.map(check => ({check, passed: true, reason: '工程夹具，精确答复绑定'})),
      discoveries: draft.inquiryResult!.discoveries.map(item => ({factKey: item.factKey, passed: true, reason: '工程独立逐项检查'}))}}
}
