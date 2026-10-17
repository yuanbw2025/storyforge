/** Read-only labels derived from the verified original receipt. Never expose unselected metadata. */
import type { TtrpgOpenContextSelectionReceiptV1 } from './open-context-selection'

export const TTRPG_CONTEXT_TIER_LABELS_V1 = {
  rules: '规则', 'authority-state': '权限与当前状态', 'active-situations': '当前预警',
  'known-facts': '已知资料', 'recent-events': '近期叙述', 'memory-summary': '记忆摘要',
  'dynamic-injection': '情境指引', flavor: '氛围资料',
} as const
const sources: Readonly<Record<string, string>> = {
  ttrpgOpenAuthority: '冻结规则与本人状态', ttrpgOpenKnowledge: '本人可见知识',
  ttrpgOpenKpInput: '实际结算与共同可见资料', ttrpgOpenGmOracleInput: '本次主持咨询',
  ttrpgOpenActorContext: '本人情境与已保存叙述', ttrpgOpenPartyContext: '共同情境与已保存叙述',
  ttrpgOpenGmContext: '主持情境与已保存叙述',
}
const reasons: Readonly<Record<string, string>> = {
  'text-match': '本次输入文字匹配', predicate: '可见条件满足', both: '文字与可见条件同时满足',
  always: '作者设置的固定指引', sticky: '延续此前触发的有效期',
}
export function projectTtrpgOpenContextInspectionV1(receipt: TtrpgOpenContextSelectionReceiptV1) {
  // Stable ordinals, not authored keys, raw text, resource IDs, or hidden trigger names.
  const resources = receipt.selected.map((row, index) => ({
    label: `资料 ${index + 1}`, category: TTRPG_CONTEXT_TIER_LABELS_V1[row.tierKey],
    source: sources[row.sourceKey] ?? '原请求的已登记来源', tokens: row.tokens,
    origin: row.tierKey === 'rules' || row.tierKey === 'dynamic-injection' ? '冻结作品' : '本次授权读取的资料',
  }))
  const injections = receipt.deliveredTriggers.map((trigger, index) => ({
    label: `情境指引 ${index + 1}`, reason: reasons[trigger.matchedBy] ?? '原请求中记录的触发',
  }))
  const omissions = receipt.tokenBudget.tiers.flatMap(tier => {
    const tokenLimited = tier.demoted
    const countLimited = receipt.resourceCountBudget.tiers.some(row => row.tierKey === tier.tierKey && row.demoted)
    return tokenLimited || countLimited ? [{ category: TTRPG_CONTEXT_TIER_LABELS_V1[tier.tierKey],
      reason: tokenLimited && countLimited ? '正文预算与资料条数上限' : tokenLimited ? '正文预算上限' : '资料条数上限' }] : []
  })
  return { resources, injections, omissions }
}
