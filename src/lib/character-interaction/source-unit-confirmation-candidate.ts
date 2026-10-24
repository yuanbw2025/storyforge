import {createCreativeIssueV1} from '../agent/creative-execution'
import {parseCreativeArtifactV1, type CreativeCallEvidenceV1} from '../agent/creative-reliability'
import {CHAT_SOURCE_UNITS_REVIEW_PROMPT_V1} from './source-units-candidate'
import {parseChatSourceUnitAuthorizationReviewV1, chatSourceUnitAuthorizationPassedV1, type ChatSourceUnitAuthorizationReviewV1} from './source-unit-authorization'
import type {ChatSourceUnitConfirmationContextV1} from './source-unit-confirmation-context'

export const CHAT_SOURCE_UNIT_CONFIRMATION_PROMPT_V1 = `${CHAT_SOURCE_UNITS_REVIEW_PROMPT_V1}
本次还须独立核查作者明确提出的逐项知情与发现授权，不能因为是作者填写就判通过。source 是完整原文；candidate 是待确认事实；permissions 的角色使用便携 resourceKey，player 指玩家；prerequisites 是系统核验为调查角色已知的完整前提资料。
除上述事实解释检查外，对每条权限判断 initialKnowledgeFaithful：初始知情人是否与原文及限制一致，原文明确起初不知的人不能因勾选就提前知道；discoverySupported：有 discovery 时实际完成该条件是否足以证明整项事实，不能看位置就知道经手者或原因，不能把未来情节当可调查事实；没有 discovery 时此项不能被调查自动开放，该布尔值检查是否保持此限制。角色主观意图不是已发生的证据。无法确定就返回 false 并说明。
仅输出新结构 {"interpretation":上述完整fragments报告,"permissions":[{"fragmentKey":"原标识","unitKey":"事实key","initialKnowledgeFaithful":true,"discoverySupported":true,"reason":"具体依据或问题"}]}。每项权限恰好一条报告。不要修改候选或权限。所有项目通过后仍须作者明确确认才可保存。`

export function createChatSourceUnitConfirmationArtifactV1(raw: string, context: ChatSourceUnitConfirmationContextV1, call: CreativeCallEvidenceV1) {
  let report: ChatSourceUnitAuthorizationReviewV1 | null = null, error = ''
  try {
    if (raw.length > 120_000) throw new Error('事实确认复核回复超过容量')
    report = parseChatSourceUnitAuthorizationReviewV1(JSON.parse(raw.replace(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/, '$1')), context.candidate, context.permissions)
  } catch (cause) {error = cause instanceof Error ? cause.message : String(cause)}
  const passed = !!report && chatSourceUnitAuthorizationPassedV1(report)
  const artifact = parseCreativeArtifactV1({version: 1, policyVersion: 'creative-reliability-v1', status: passed ? 'usable-with-warnings' : 'blocked', qualityMode: 'economy',
    originalText: raw.slice(0, 120_000), editableText: report ? JSON.stringify(report) : '', validFragments: [], rejectedFragments: [], assumptions: [],
    issues: [createCreativeIssueV1({code: passed ? 'source-unit-confirmation-required' : 'source-unit-confirmation-rejected', path: '$',
      message: error || (passed ? '事实、初知范围与发现条件已获独立复核通过；仍须作者核对并明确确认。' : '事实或权限未通过独立复核，没有保存或自动重发。'),
      severity: passed ? 'warning' : 'error', disposition: passed ? 'advisory' : 'blocking', action: passed ? 'none' : 'edit'})],
    canonEvidenceRefs: [...context.source.fragments, ...context.prerequisites].map(row => `source:${row.sourceHash}:${row.fragmentKey}`), callEvidence: [call], repair: null})
  return {report, passed, artifact}
}
