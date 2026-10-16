import { describe, expect, it } from 'vitest'
import { buildWholeChapterQualityReviewRequestV1, parseWholeChapterQualityReviewV1 } from '../../src/lib/prose/quality-review'
import { freezeQualityRevisionPlanV1, applyQualityRevisionPatchesV1 } from '../../src/lib/prose/quality-revision'
import { describeResolvedAIRequestSettingsV1, resolveRequestConfig } from '../../src/lib/ai/client'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { buildQualityRecheckRequestV1, parseQualityRecheckV1, verifyQualityRecheckV1 } from '../../src/lib/prose/quality-recheck'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'

async function seed() {
  const originalText = '已确认事实：余额3点。\n陈禾写下已收款，但未交代付款过程。\n两人关灯，停笔。'
  const quote = '陈禾写下已收款，但未交代付款过程。'
  const request = await buildWholeChapterQualityReviewRequestV1({ mode: 'quality', chapterTitle: '交付', chapterText: originalText, registeredContext: '本章交清十份餐并收款，保留三点余额。' })
  const settings = describeResolvedAIRequestSettingsV1(resolveRequestConfig({ ...useAIConfigStore.getState().config, provider: 'ollama', model: 'scope-test' }), true)
  const report = await parseWholeChapterQualityReviewV1({ raw: JSON.stringify({ summary: '核对收款过程', strengths: ['自然停笔'], issues: [{ dimension: 'causality', confidence: 'uncertain', quote, start: null, end: null, reason: '关键动作未写出', suggestion: '补足实际收款过程，保留金额和余额' }] }), mode: 'quality', chapterText: originalText, targetTextHash: request.targetTextHash, messages: request.messages, responseCompletion: 'complete', settings })
  return { scope: { projectId: 1, worldId: 2, workId: 3 }, chapterId: 4, reportRunId: 5, report, reviewMessages: request.messages, reviewCurrent: true, originalText, selectedIssueIds: [report.issues[0].id], previousCalls: 2 }
}

describe('LFQ8 · 作者选题与限定文字范围', () => {
  it('复核只给一套完整输出结构；无新问题必须明确返回空列表，漏字段仍拒绝', async () => {
    const f = await seed()
    const plan = await freezeQualityRevisionPlanV1(f)
    const candidateText = '已确认事实：余额3点。\n陈禾收款并开收条。\n两人关灯，停笔。'
    const messages = await buildQualityRecheckRequestV1({ plan, originalReport: f.report, chapterTitle: '交付', candidateText, registeredContext: f.originalText })
    const [instructions, shape] = messages[0].content.split('【唯一输出结构】\n')
    expect(instructions).not.toContain('{"summary"')
    expect(instructions).not.toContain('替代上一段的外层契约')
    const example = JSON.parse(shape)
    expect(Object.keys(example).sort()).toEqual(['outcomes', 'review'])
    expect(Object.keys(example.review).sort()).toEqual(['issues', 'strengths', 'summary'])
    expect(example.outcomes.map((item: { issueId: string }) => item.issueId)).toEqual(plan.issueIds)
    const outcome = { issueId: plan.issueIds[0], status: 'improved', anchorId: 'p2', reason: '收款过程已写出' }
    const input = { plan, candidateText, messages, settings: f.report.reviewer.settings, completion: 'complete' as const }
    await expect(parseQualityRecheckV1({ ...input, raw: JSON.stringify({ review: { summary: '已修复', strengths: [] }, outcomes: [outcome] }) })).rejects.toThrow('字段')
    await expect(parseQualityRecheckV1({ ...input, raw: JSON.stringify({ review: { summary: '已修复', strengths: [], issues: [] } }) })).rejects.toThrow('逐项覆盖')
    await expect(buildQualityRecheckRequestV1({ plan, originalReport: f.report, chapterTitle: '交付', candidateText: '  ', registeredContext: '' })).rejects.toThrow('为空')
  })

  it('复核明确旧稿只作比较，全文候选放在资料之后；拒绝旧稿引文，旧版历史仍可验签', async () => {
    const f = await seed()
    const plan = await freezeQualityRevisionPlanV1(f)
    const candidateText = '已确认事实：余额3点。\n赵经理递来一百二十元；陈禾点清后开了收条。\n两人关灯，停笔。'
    const messages = await buildQualityRecheckRequestV1({ plan, originalReport: f.report, chapterTitle: '交付', candidateText, registeredContext: f.originalText })
    expect(messages[1].content.indexOf(candidateText)).toBeGreaterThan(messages[1].content.indexOf(f.originalText))
    expect(messages[1].content).toContain(`唯一审查对象 · hash ${await hashCanonicalValue(candidateText)}`)
    const settings = f.report.reviewer.settings
    const outcome = { issueId: plan.issueIds[0], status: 'improved', quote: '赵经理递来一百二十元；陈禾点清后开了收条。', reason: '实际付款过程可见' }
    const raw = JSON.stringify({ review: { summary: '复核修订后正文', strengths: [], issues: [] }, outcomes: [outcome] })
    const checked = await parseQualityRecheckV1({ raw, plan, candidateText, messages, settings, completion: 'complete' })
    expect(checked.promptVersion).toBe('quality-revision-recheck-v6')
    expect(await verifyQualityRecheckV1(checked, plan, candidateText, messages)).toBe(true)
    await expect(parseQualityRecheckV1({ raw: JSON.stringify({ review: { summary: '误看旧稿', strengths: [], issues: [] }, outcomes: [{ ...outcome, quote: f.report.issues[0].quote }] }), plan, candidateText, messages, settings, completion: 'complete' })).rejects.toThrow('引文')
    const legacyMessages = messages.map((message, i) => i === 0 ? { ...message, content: message.content.replace('复核契约：quality-revision-recheck-v6。', '') } : message)
    const historical = await parseQualityRecheckV1({ raw, plan, candidateText, messages: legacyMessages, settings, completion: 'complete' })
    expect(historical.promptVersion).toBe('quality-revision-recheck-v1')
    expect(await verifyQualityRecheckV1(historical, plan, candidateText, legacyMessages)).toBe(true)
  })

  it('只修所选问题的段落，未选事实和停笔逐字保留；本轮冻结四次总预算', async () => {
    const f = await seed()
    const plan = await freezeQualityRevisionPlanV1(f)
    expect(plan.allowedSpans.map(span => span.id)).toEqual(['p2.1'])
    const result = await applyQualityRevisionPatchesV1({ plan, originalText: f.originalText, raw: JSON.stringify({ edits: [{ spanId: 'p2.1', replacement: '赵经理递来一百二十元；陈禾点清后开了收条。' }] }) })
    expect(result.outputText).toBe('已确认事实：余额3点。\n赵经理递来一百二十元；陈禾点清后开了收条。\n两人关灯，停笔。')
    expect(plan.budget).toEqual({ previousCalls: 2, maxTotalCalls: 4, maxRevisionCalls: 1, maxRecheckCalls: 1 })
    await expect(applyQualityRevisionPatchesV1({ plan, originalText: f.originalText, raw: JSON.stringify({ edits: [{ spanId: 'p1.1', replacement: '余额变成30点。' }] }) })).rejects.toThrow('授权')
  })

  it('保护文字从允许范围中扣除，修订不能替换受保护的原句', async () => {
    const f = await seed()
    const plan = await freezeQualityRevisionPlanV1({ ...f, additionalParagraphs: [1], protectedQuotes: ['已确认事实：余额3点。', '已收款'] })
    expect(plan.allowedSpans.map(span => span.text)).toEqual(['陈禾写下', '，但未交代付款过程。'])
    const result = await applyQualityRevisionPatchesV1({ plan, originalText: f.originalText, raw: JSON.stringify({ edits: [{ spanId: 'p2.2', replacement: '；收款动作已补足。' }] }) })
    expect(result.outputText).toContain('已确认事实：余额3点。')
    expect(result.outputText).toContain('已收款')
    expect(result.outputText).toContain('两人关灯，停笔。')
  })

  it('旧报告、未选问题、伪造引文和越界段落在发模型前拒绝', async () => {
    const f = await seed()
    await expect(freezeQualityRevisionPlanV1({ ...f, reviewCurrent: false })).rejects.toThrow('已变化')
    await expect(freezeQualityRevisionPlanV1({ ...f, originalText: f.originalText + '作者改稿。' })).rejects.toThrow('已变化')
    await expect(freezeQualityRevisionPlanV1({ ...f, selectedIssueIds: [] })).rejects.toThrow('明确选择')
    await expect(freezeQualityRevisionPlanV1({ ...f, selectedIssueIds: ['其它报告的问题'] })).rejects.toThrow('当前报告')
    await expect(freezeQualityRevisionPlanV1({ ...f, additionalParagraphs: [99] })).rejects.toThrow('段落')
    await expect(freezeQualityRevisionPlanV1({ ...f, protectedQuotes: ['不存在的已确认事实'] })).rejects.toThrow('唯一引文')
  })

  it('预算耗尽、重复补丁、夹带全文、过量输出或计划篡改均拒绝', async () => {
    const f = await seed()
    await expect(freezeQualityRevisionPlanV1({ ...f, previousCalls: 3 })).rejects.toThrow('预算')
    const plan = await freezeQualityRevisionPlanV1(f)
    const edit = { spanId: 'p2.1', replacement: '补足收款过程。' }
    await expect(applyQualityRevisionPatchesV1({ plan, originalText: f.originalText, raw: JSON.stringify({ edits: [edit, edit] }) })).rejects.toThrow('重复')
    await expect(applyQualityRevisionPatchesV1({ plan, originalText: f.originalText, raw: JSON.stringify({ edits: [edit], fullText: '偷偷重写全章' }) })).rejects.toThrow('edits')
    await expect(applyQualityRevisionPatchesV1({ plan, originalText: f.originalText, raw: JSON.stringify({ edits: [{ ...edit, replacement: '字'.repeat(801) }] }) })).rejects.toThrow('篇幅预算')
    await expect(applyQualityRevisionPatchesV1({ plan: { ...plan, chapterId: 999 }, originalText: f.originalText, raw: JSON.stringify({ edits: [edit] }) })).rejects.toThrow('已变化')
  })
})
