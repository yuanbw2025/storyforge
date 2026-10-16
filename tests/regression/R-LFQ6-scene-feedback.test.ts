import { afterEach, describe, expect, it } from 'vitest'
import { usePromptStore } from '../../src/stores/prompt'
import { buildChapterContentRequestV1, buildContinueRequestV1 } from '../../src/lib/ai/adapters/chapter-adapter'
import { buildWholeChapterQualityReviewRequestV1, parseWholeChapterQualityReviewV1, QUALITY_REVIEW_PROMPT_VERSION_V1, formatQualityReviewAnchorsV1 } from '../../src/lib/prose/quality-review'
import { buildQualityRecheckRequestV1, parseQualityRecheckV1, verifyQualityRecheckV1, QUALITY_RECHECK_PROMPT_VERSION_V1 } from '../../src/lib/prose/quality-recheck'
import { freezeQualityRevisionPlanV1 } from '../../src/lib/prose/quality-revision'
import { describeResolvedAIRequestSettingsV1, resolveRequestConfig } from '../../src/lib/ai/client'
import { useAIConfigStore } from '../../src/stores/ai-config'

const oldPrompts = usePromptStore.getState()
const settings = describeResolvedAIRequestSettingsV1(resolveRequestConfig({ ...useAIConfigStore.getState().config, provider: 'ollama', model: 'scene-feedback-test', maxTokens: 4000 }), false)

afterEach(() => usePromptStore.setState(oldPrompts, true))

describe('LFQ6 · 群友探路反馈进入既有正文与审修链', () => {
  it('已保存的旧作者模板也能在生成和续写取得场景任务，显式关闭连续性时仍尊重作者选择', () => {
    const template = { ...oldPrompts.getActive('chapter.content'), systemPrompt: '作者自己的克制风格', userPromptTemplate: '{{userHint}}', continuityMode: 'inherit' as const }
    const options = { requiredGatewayContext: '事实：电量零，绳索八米。' }
    for (const mode of ['inherit', 'off'] as const) {
      usePromptStore.setState({ getActive: () => ({ ...template, continuityMode: mode }) })
      const requests = [
        buildChapterContentRequestV1('探路', '确认回撤线后停止', options.requiredGatewayContext, '', '', undefined, '允许撤退，不增新装备', options),
        buildContinueRequestV1('两人站在拐角外。', '确认回撤线后停止', options.requiredGatewayContext, '不增加新线索', options),
      ]
      for (const request of requests) {
        expect(request.messages[0].content).toContain(template.systemPrompt)
        expect(request.messages.some(message => message.content.includes(options.requiredGatewayContext))).toBe(true)
        const guidanceOccurrences = request.messages.reduce((sum, message) => sum + (message.content.match(/场景执行：/g)?.length ?? 0), 0)
        expect(guidanceOccurrences).toBe(mode === 'off' ? 0 : 1)
      }
      expect(template.systemPrompt).toBe('作者自己的克制风格')
    }
  })

  it.each([
    ['whole-chapter-quality-review-v4', 'quality-revision-recheck-v2'],
    ['whole-chapter-quality-review-v5', 'quality-revision-recheck-v3'],
    ['whole-chapter-quality-review-v6', 'quality-revision-recheck-v4'],
    ['whole-chapter-quality-review-v6', 'quality-revision-recheck-v5'],
    ['whole-chapter-quality-review-v7', 'quality-revision-recheck-v6'],
  ] as const)('历史或当前嵌套报告 %s / %s 按实际请求版本恢复验签', async (reviewVersion, recheckVersion) => {
    const originalText = '绳子只有一百二十厘米。\n她把十五米绳索全部放出。\n两人决定撤回。'
    const request = await buildWholeChapterQualityReviewRequestV1({ mode: 'quality', chapterTitle: '探路', chapterText: originalText, registeredContext: '仅有一条绳索，没有新装备。' })
    const report = await parseWholeChapterQualityReviewV1({ raw: JSON.stringify({ summary: '同一条绳索长度矛盾', strengths: ['保留试探和撤回的选择'], issues: [{ dimension: 'continuity', confidence: 'suggestion', quote: '她把十五米绳索全部放出。', start: null, end: null, reason: '总长不足', suggestion: '修正探测距离，保留试探过程' }] }), mode: 'quality', chapterText: originalText, targetTextHash: request.targetTextHash, messages: request.messages, responseCompletion: 'complete', settings })
    const plan = await freezeQualityRevisionPlanV1({ scope: { projectId: 1, worldId: 1, workId: 1 }, chapterId: 1, reportRunId: 1, report, reviewMessages: request.messages, reviewCurrent: true, originalText, selectedIssueIds: [report.issues[0].id], previousCalls: 2, authorRequest: '修正长度，保留撤退' })
    const candidateText = '绳子只有一百二十厘米。\n她将绳子探向脚边，确认石沿后把它收回。\n两人决定撤回。'
    const messages = (await buildQualityRecheckRequestV1({ plan, originalReport: report, chapterTitle: '探路', candidateText, registeredContext: originalText })).map((message, index) => index === 0 ? { ...message, content: message.content.replace(`全文评审契约：${QUALITY_REVIEW_PROMPT_VERSION_V1}。`, `全文评审契约：${reviewVersion}。`).replace(`复核契约：${QUALITY_RECHECK_PROMPT_VERSION_V1}。`, `复核契约：${recheckVersion}。`) } : { ...message, content: message.content.replace(formatQualityReviewAnchorsV1(candidateText), formatQualityReviewAnchorsV1(candidateText, reviewVersion)) })
    const location = recheckVersion === 'quality-revision-recheck-v6' ? { anchorId: 'p2' } : ['quality-revision-recheck-v4', 'quality-revision-recheck-v5'].includes(recheckVersion) ? { anchorId: 'p2-1' } : { quote: '她将绳子探向脚边，确认石沿后把它收回。' }
    const artifact = await parseQualityRecheckV1({ raw: JSON.stringify({ review: { summary: '范围内修正，阅读收益由作者判断', strengths: ['试探过程仍保留'], issues: [] }, outcomes: [{ issueId: plan.issueIds[0], status: 'improved', ...location, reason: '不再放出超过总长的绳索' }] }), plan, candidateText, messages, settings, completion: 'complete' })
    expect(artifact.promptVersion).toBe(recheckVersion)
    expect(artifact.review.reviewer.promptVersion).toBe(reviewVersion)
    expect(await verifyQualityRecheckV1(artifact, plan, candidateText, messages)).toBe(true)
    expect(await verifyQualityRecheckV1(artifact, plan, candidateText + '作者改稿', messages)).toBe(false)
  })
})
