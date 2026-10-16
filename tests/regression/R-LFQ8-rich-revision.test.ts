import { describe, expect, it } from 'vitest'
import { htmlToPlainText } from '../../src/lib/utils/html'
import { previewQualityRevisionHTMLV1 } from '../../src/lib/prose/quality-revision-html'
import { freezeQualityRevisionPlanV1 } from '../../src/lib/prose/quality-revision'
import { buildWholeChapterQualityReviewRequestV1, parseWholeChapterQualityReviewV1 } from '../../src/lib/prose/quality-review'
import { describeResolvedAIRequestSettingsV1, resolveRequestConfig } from '../../src/lib/ai/client'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { normalizeRichEditorHTMLV1 } from '../../src/lib/editor/rich-editor-schema'

async function setup(sourceHtml: string, quote: string, protectedQuotes: string[] = []) {
  const originalText = htmlToPlainText(sourceHtml)
  const request = await buildWholeChapterQualityReviewRequestV1({ mode: 'quality', chapterTitle: '交付', chapterText: originalText, registeredContext: '' })
  const report = await parseWholeChapterQualityReviewV1({ raw: JSON.stringify({ summary: '只修指定文字', strengths: [], issues: [{ dimension: 'voice', confidence: 'suggestion', quote, start: null, end: null, reason: '任务说明泄漏', suggestion: '移除说明，保留签字事件' }] }), mode: 'quality', chapterText: originalText, targetTextHash: request.targetTextHash, messages: request.messages, responseCompletion: 'complete', settings: describeResolvedAIRequestSettingsV1(resolveRequestConfig(useAIConfigStore.getState().config), false) })
  const plan = await freezeQualityRevisionPlanV1({ scope: { projectId: 1, worldId: 1, workId: 1 }, chapterId: 1, reportRunId: 1, report, reviewMessages: request.messages, reviewCurrent: true, originalText, selectedIssueIds: [report.issues[0].id], protectedQuotes, previousCalls: 2 })
  return plan
}

describe('LFQ8 · 富文本范围修订', () => {
  it.each([
    ['<p><strong>绳索总长八米。</strong></p><p></p><p>多余总结。</p>', '绳索总长八米。'],
    ['<p><strong>绳索总长八米。</strong></p><p></p><p>多余总结。</p><p></p><p>两人撤回。</p>', '绳索总长八米。\n\n两人撤回。'],
  ])('删除末段或相邻空段中的完整段落时按既有文字投影验范围：%s', async (html, expectedText) => {
    const sourceHtml = normalizeRichEditorHTMLV1(html)
    const plan = await setup(sourceHtml, '多余总结。')
    const result = await previewQualityRevisionHTMLV1({ sourceHtml, plan, raw: JSON.stringify({ edits: [{ spanId: plan.allowedSpans[0].id, replacement: '' }] }), normalize: normalizeRichEditorHTMLV1 })
    expect(result.outputText).toBe(expectedText)
    expect(result.outputText).toBe(htmlToPlainText(result.contentHtml))
    expect(result.contentHtml).toContain('<strong>绳索总长八米。</strong>')
    expect(result.contentHtml).not.toContain('多余总结。')
    expect(result.contentHtml).toBe(normalizeRichEditorHTMLV1(result.contentHtml))
    expect(sourceHtml).toContain('多余总结。')
    await expect(previewQualityRevisionHTMLV1({ sourceHtml, plan, raw: JSON.stringify({ edits: [{ spanId: 'p1.1', replacement: '绳索变为八十米。' }] }), normalize: normalizeRichEditorHTMLV1 })).rejects.toThrow('授权')
  })

  it('未选段落的字色、加粗与链接不变，保护文字扣除；模型HTML作为字面文本', async () => {
    const sourceHtml = '<p style="color: red"><strong>余额三点。</strong><a href="https://example.com">查看约定</a></p><p>她签下名字。<em>正文到此结束。</em></p><p>下一章暂未写。</p>'
    const plan = await setup(sourceHtml, '正文到此结束。', ['她签下名字。'])
    const raw = JSON.stringify({ edits: [{ spanId: plan.allowedSpans[0].id, replacement: '<img src=x onerror=alert(1)>' }] })
    const result = await previewQualityRevisionHTMLV1({ sourceHtml, plan, raw })
    expect(result.contentHtml).toContain('<p style="color: red"><strong>余额三点。</strong><a href="https://example.com">查看约定</a></p>')
    expect(result.contentHtml).toContain('她签下名字。')
    expect(result.contentHtml).toContain('<p>下一章暂未写。</p>')
    expect(result.contentHtml).toContain('&lt;img')
    expect(result.contentHtml).not.toContain('<img')
  })

  it('多个段落、内联标记、换行、实体及emoji的位置一致，原DOM不写回', async () => {
    const sourceHtml = '<p>😀原话 &amp; 事实。</p><p>签字。<strong>保留金额一百二十。</strong>正文到此结束。</p>'
    const plan = await setup(sourceHtml, '正文到此结束。', ['保留金额一百二十。'])
    const raw = JSON.stringify({ edits: plan.allowedSpans.map((span, index) => ({ spanId: span.id, replacement: index === 0 ? '她签字。\n笔尖停下。' : '' })) })
    const result = await previewQualityRevisionHTMLV1({ sourceHtml, plan, raw })
    expect(result.outputText).toBe('😀原话 & 事实。\n她签字。\n笔尖停下。保留金额一百二十。')
    expect(result.contentHtml).toContain('<strong>保留金额一百二十。</strong>')
    expect(sourceHtml).toContain('正文到此结束。')
  })

  it('采用实际编辑器schema的候选刷新格式稳定，未支持的格式不会悄悄丢掉', async () => {
    const sourceHtml = normalizeRichEditorHTMLV1('<p><strong>余额三点。</strong></p><p>她签字。<em>正文到此结束。</em></p>')
    const plan = await setup(sourceHtml, '正文到此结束。', ['她签字。'])
    const result = await previewQualityRevisionHTMLV1({ sourceHtml, plan, raw: JSON.stringify({ edits: [{ spanId: plan.allowedSpans[0].id, replacement: '' }] }), normalize: normalizeRichEditorHTMLV1 })
    expect(result.contentHtml).toBe(normalizeRichEditorHTMLV1(result.contentHtml))
    expect(result.contentHtml).toContain('<strong>余额三点。</strong>')
    const old = '<p style="color: red">旧格式。</p><p>正文到此结束。</p>'
    const oldPlan = await setup(old, '正文到此结束。')
    await expect(previewQualityRevisionHTMLV1({ sourceHtml: old, plan: oldPlan, raw: JSON.stringify({ edits: [{ spanId: oldPlan.allowedSpans[0].id, replacement: '停笔。' }] }), normalize: normalizeRichEditorHTMLV1 })).rejects.toThrow('格式尚未')
  })
})
