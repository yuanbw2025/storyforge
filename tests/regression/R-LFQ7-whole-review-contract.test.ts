import { describe, expect, it } from 'vitest'
import { buildWholeChapterQualityReviewRequestV1, parseWholeChapterQualityReviewV1, verifyWholeChapterQualityReviewV1, qualityReviewAnchorsV1, formatQualityReviewAnchorsV1, QUALITY_REVIEW_PROMPT_VERSION_V1 } from '../../src/lib/prose/quality-review'
import { describeResolvedAIRequestSettingsV1, resolveRequestConfig } from '../../src/lib/ai/client'
import { useAIConfigStore } from '../../src/stores/ai-config'

const settings = describeResolvedAIRequestSettingsV1(resolveRequestConfig({ ...useAIConfigStore.getState().config, provider: 'ollama', model: 'review-contract-test', temperature: 0, maxTokens: 4000 }), false)
const issue = (quote: string, start: number | null, end: number | null) => ({ dimension: 'causality', confidence: 'uncertain', quote, start, end, reason: '付款过程没有写出，却直接记为已收款。', suggestion: '核对付款过程，保持金额和签字人。' })

describe('LFQ7 · 全章输入、真实引文与阅读建议合同', () => {
  it('完整接受长要求、长引文和超过旧条数的报告，并可按原件回读验签', async () => {
    const chapterText = '完整且可核验的原文。'.repeat(160), authorRequest = '保留作者的实际要求。'.repeat(1800)
    const request = await buildWholeChapterQualityReviewRequestV1({mode: 'quality', chapterTitle: '长报告', chapterText, registeredContext: '', authorRequest})
    expect(request.messages[1].content).toContain(authorRequest)
    const longText = '需要逐项解释的依据。'.repeat(420)
    const issues = Array.from({length: 45}, () => ({...issue(chapterText, 0, chapterText.length), reason: longText, suggestion: longText}))
    const raw = {summary: longText, strengths: Array.from({length: 25}, () => longText), issues}
    const parse = (value: unknown) => parseWholeChapterQualityReviewV1({raw: JSON.stringify(value), mode: 'quality', chapterText, targetTextHash: request.targetTextHash, messages: request.messages, settings, responseCompletion: 'complete'})
    const report = await parse(raw)
    expect(report.summary).toBe(longText)
    expect(report.strengths).toEqual(raw.strengths)
    expect(report.issues).toHaveLength(45)
    expect(report.issues[44]).toMatchObject({quote: chapterText, reason: longText, suggestion: longText})
    expect(await verifyWholeChapterQualityReviewV1(report, chapterText, request.messages)).toBe(true)
    await expect(parse({...raw, issues: [...issues, {...issues[0], quote: '原文里不存在的引文'}]})).rejects.toThrow('引文')
  })

  it('登记资料与作者计划先交接，再核对实际完整正文，避免以计划自证结算', async () => {
    const chapterText = '她实际回听了三次。\n计数器仍写消耗两次。'
    const registeredContext = '计划只回听两次，但尚未执行。'
    const authorRequest = '核对实际回听与余额，保留人物选择的代价。'
    const request = await buildWholeChapterQualityReviewRequestV1({ mode: 'quality', chapterTitle: '回听', chapterText, registeredContext, authorRequest })
    const delivered = request.messages[1].content
    expect(delivered.indexOf(registeredContext)).toBeLessThan(delivered.indexOf(authorRequest))
    expect(delivered.indexOf(authorRequest)).toBeLessThan(delivered.indexOf('【完整正文'))
    expect(delivered.indexOf('【完整正文')).toBeLessThan(delivered.indexOf(chapterText))
    expect(delivered.indexOf(chapterText)).toBeLessThan(delivered.indexOf('【正文结束】'))
    expect(request.messages[0].content).toContain('suggestion必须单独给出非空')
  })

  it.each(['whole-chapter-quality-review-v10', 'whole-chapter-quality-review-v11', 'whole-chapter-quality-review-v12'] as const)('实际漏写suggestion的响应在%s仍整份拒绝；完整历史报告不改版本', async promptVersion => {
    const chapterText = '她已经回听三次，结算却只记两次。'
    const request = await buildWholeChapterQualityReviewRequestV1({ mode: 'quality', chapterTitle: '回听', chapterText, registeredContext: '' })
    const messages = request.messages.map((message, index) => index === 0 ? { ...message, content: message.content.replace(`全文评审契约：${QUALITY_REVIEW_PROMPT_VERSION_V1}。`, `全文评审契约：${promptVersion}。`) } : message)
    const row = { dimension: 'system-payoff', confidence: 'suggestion', anchorId: 'p1', reason: '实际三次却只记两次；建议核对每次动作。' }
    const parse = (value: unknown) => parseWholeChapterQualityReviewV1({ raw: JSON.stringify({ summary: '核对实际动作', strengths: [], issues: [value] }), mode: 'quality', chapterText, targetTextHash: request.targetTextHash, messages, responseCompletion: 'complete', settings, promptVersion })
    await expect(parse(row)).rejects.toThrow('字段不符合报告契约')
    const complete = await parse({ ...row, suggestion: '保持已确认规则，逐次核对资源结算。' })
    expect(complete.reviewer.promptVersion).toBe(promptVersion)
    expect(await verifyWholeChapterQualityReviewV1(complete, chapterText, messages)).toBe(true)
  })

  it('片段编号精确定位重复原文；长段与代理对不截断，伪造编号和混合协议仍拒绝', async () => {
    const chapterText = '她收回绳子。\n\n她收回绳子。\n' + '甲'.repeat(159) + '😀确认回撤线。'
    const request = await buildWholeChapterQualityReviewRequestV1({ mode: 'quality', chapterTitle: '探路', chapterText, registeredContext: '' })
    const anchors = qualityReviewAnchorsV1(chapterText)
    expect(anchors.map(anchor => anchor.anchorId)).toEqual(['p1', 'p2', 'p3-1', 'p3-2'])
    expect(anchors.map(row => row.quote).join('')).toBe(chapterText.replace(/\n/g, ''))
    expect(anchors.every(row => !/[\uD800-\uDBFF]$/.test(row.quote))).toBe(true)
    expect(request.messages[1].content).toContain(chapterText)
    const row = { dimension: 'continuity', confidence: 'suggestion', anchorId: 'p2', reason: '同一道具在后文重复收回，需要核对状态', suggestion: '保留一次真实收回动作' }
    const parse = (value: unknown) => parseWholeChapterQualityReviewV1({ raw: JSON.stringify({ summary: '核对道具状态', strengths: ['保留回撤选择'], issues: [value] }), mode: 'quality', chapterText, targetTextHash: request.targetTextHash, messages: request.messages, responseCompletion: 'complete', settings })
    const report = await parse(row)
    expect(report.issues[0].quote).toBe('她收回绳子。')
    expect(report.issues[0].start).toBe(chapterText.lastIndexOf('她收回绳子。'))
    expect(report.issues[0].paragraph).toBe(2)
    expect(await verifyWholeChapterQualityReviewV1(report, chapterText, request.messages)).toBe(true)
    await expect(parse({ ...row, anchorId: 'p99-1' })).rejects.toThrow('编号')
    await expect(parse({ ...row, anchorId: 'p2-1' })).rejects.toThrow('编号')
    await expect(parse({ ...row, anchorId: 'p3' })).rejects.toThrow('编号')
    await expect(parse({ ...row, quote: '随意改写的引文' })).rejects.toThrow('契约')
    const historicalMessages = request.messages.map((message, index) => ({ ...message, content: index === 0 ? message.content.replace(`全文评审契约：${QUALITY_REVIEW_PROMPT_VERSION_V1}。`, '全文评审契约：whole-chapter-quality-review-v6。') : message.content.replace(formatQualityReviewAnchorsV1(chapterText), formatQualityReviewAnchorsV1(chapterText, 'whole-chapter-quality-review-v6')) }))
    const oldInput = { mode: 'quality' as const, chapterText, targetTextHash: request.targetTextHash, messages: historicalMessages, responseCompletion: 'complete' as const, settings, promptVersion: 'whole-chapter-quality-review-v6' as const }
    const historical = await parseWholeChapterQualityReviewV1({ ...oldInput, raw: JSON.stringify({ summary: '历史段落定位', strengths: [], issues: [{ ...row, anchorId: 'p2-1' }] }) })
    expect(await verifyWholeChapterQualityReviewV1(historical, chapterText, historicalMessages)).toBe(true)
    await expect(parseWholeChapterQualityReviewV1({ ...oldInput, raw: JSON.stringify({ summary: '旧请求不能用新编号', strengths: [], issues: [row] }) })).rejects.toThrow('编号')
  })

  it.each(['writingStyle', 'consistencyRules', 'atmosphere'])('真实模型误用资料字段 %s 作为问题维度时拒绝，不把缺失意见补成合格报告', async dimension => {
    const chapterText = '她在获得许可后，才作出约定要求的承诺。'
    const request = await buildWholeChapterQualityReviewRequestV1({ mode: 'quality', chapterTitle: '许可', chapterText, registeredContext: '许可需先取得明确承诺。' })
    const value = { summary: '核对发生顺序', strengths: [], issues: [{ dimension, confidence: 'suggestion', anchorId: 'p1', reason: '承诺晚于许可', suggestion: '在授权范围核对顺序' }] }
    await expect(parseWholeChapterQualityReviewV1({ raw: JSON.stringify(value), mode: 'quality', chapterText, targetTextHash: request.targetTextHash, messages: request.messages, responseCompletion: 'complete', settings })).rejects.toThrow('维度')
  })

  it('真实探针中的跨段拼接引文仍拒绝；单段定位有效，旧v3记录按原版本验签', async () => {
    const chapterText = '账本初始余额三点，操作消耗两点。\n陈禾扣除两点，余额变成八点。'
    const request = await buildWholeChapterQualityReviewRequestV1({ mode: 'quality', chapterTitle: '账本', chapterText, registeredContext: '初始三点，消耗两点，不凭空奖励。' })
    const base = { mode: 'quality' as const, chapterText, targetTextHash: request.targetTextHash, messages: request.messages, responseCompletion: 'complete' as const, settings }
    const root = { summary: '核对扣点后的数量', strengths: [], issues: [issue('账本初始余额三点，操作消耗两点。陈禾扣除两点，余额变成八点', null, null)] }
    await expect(parseWholeChapterQualityReviewV1({ ...base, raw: JSON.stringify(root) })).rejects.toThrow('引文')
    const raw = JSON.stringify({ ...root, issues: [issue('余额变成八点。', null, null)] })
    const current = await parseWholeChapterQualityReviewV1({ ...base, raw })
    expect(current.reviewer.promptVersion).toBe(QUALITY_REVIEW_PROMPT_VERSION_V1)
    expect(current.issues[0].paragraph).toBe(2)
    const old = await parseWholeChapterQualityReviewV1({ ...base, raw, promptVersion: 'whole-chapter-quality-review-v3' })
    expect(await verifyWholeChapterQualityReviewV1(old, chapterText, request.messages)).toBe(true)
  })

  it('末尾4500字之后的问题、长章和登记资料尾部完整进入三个评审请求', async () => {
    const text = '前段叙述。'.repeat(1000) + '\n\n未付款却记为已收款。'
    for (const mode of ['quality', 'style', 'readability'] as const) {
      const request = await buildWholeChapterQualityReviewRequestV1({ mode, chapterTitle: '交付', chapterText: text, registeredContext: '登记资料'.repeat(1000) + '【资料尾部】' })
      expect(request.messages[1].content).toContain(text)
      expect(request.messages[1].content).toContain('【资料尾部】')
      expect(request.messages[0].content).toContain('缓冲、安静、留白、角色有意隐瞒')
      expect(request.messages[0].content).toContain('不输出AI概率')
      const quote = '未付款却记为已收款。'; const start = text.indexOf(quote)
      const report = await parseWholeChapterQualityReviewV1({ raw: JSON.stringify({ summary: '需核对交付过程', strengths: ['保留自然停笔'], issues: [issue(quote, start, start + quote.length)] }), mode, chapterText: text, targetTextHash: request.targetTextHash, messages: request.messages, responseCompletion: 'complete', settings })
      expect(report.issues[0].start).toBeGreaterThan(4000)
      expect(report.issues[0].paragraph).toBe(2)
      expect(report.coverage.end).toBe(text.length)
      expect(report.reviewer.correlatedJudge).toBe(true)
      expect(await verifyWholeChapterQualityReviewV1(report, text, request.messages)).toBe(true)
      expect(await verifyWholeChapterQualityReviewV1(report, text + '作者新改一段', request.messages)).toBe(false)
    }
  })

  it('伪造引文、重复引文猜位置和虚构满分字段均被拒绝，UTF16位置保留', async () => {
    const text = '😀收条已签。\n\n收条已签。'
    const request = await buildWholeChapterQualityReviewRequestV1({ mode: 'quality', chapterTitle: '收条', chapterText: text, registeredContext: '' })
    const parse = (row: unknown) => parseWholeChapterQualityReviewV1({ raw: JSON.stringify(row), mode: 'quality', chapterText: text, targetTextHash: request.targetTextHash, messages: request.messages, responseCompletion: 'complete', settings })
    const root = { summary: '仅为建议', strengths: [], issues: [issue('并不存在的付款', 0, 7)] }
    await expect(parse(root)).rejects.toThrow('不一致')
    await expect(parse({ ...root, issues: [issue('收条已签。', null, null)] })).rejects.toThrow('重复')
    await expect(parse({ ...root, issues: [], overallScore: 100 })).rejects.toThrow('契约')
    const good = await parse({ ...root, issues: [issue('收条已签。', 2, 7)] })
    expect(good.issues[0].start).toBe(2)
    expect(await verifyWholeChapterQualityReviewV1({ ...good, issues: [{ ...good.issues[0], start: 0 }] }, text, request.messages)).toBe(false)
  })

  it('只送前段、响应截断或完成未知都不能声称全文已评；独立模型身份与报告损坏可回查', async () => {
    const text = '安静清点工具。\n\n关灯后停笔。'
    const request = await buildWholeChapterQualityReviewRequestV1({ mode: 'style', chapterTitle: '关灯', chapterText: text, registeredContext: '' })
    const base = { raw: JSON.stringify({ summary: '缓冲章可保留', strengths: ['具体行动有效'], issues: [] }), mode: 'style' as const, chapterText: text, targetTextHash: request.targetTextHash, messages: request.messages, responseCompletion: 'complete' as const, settings }
    await expect(parseWholeChapterQualityReviewV1({ ...base, messages: [{ role: 'user', content: '安静清点工具。' }] })).rejects.toThrow('完整正文')
    await expect(parseWholeChapterQualityReviewV1({ ...base, responseCompletion: 'length' })).rejects.toThrow('未完成')
    await expect(parseWholeChapterQualityReviewV1({ ...base, responseCompletion: 'unknown' })).rejects.toThrow('未完成')
    const report = await parseWholeChapterQualityReviewV1({ ...base, generatorIdentity: { provider: 'agnes', model: 'another-generator' } })
    expect(report.reviewer.correlatedJudge).toBe(false)
    expect(await verifyWholeChapterQualityReviewV1(report, text, request.messages)).toBe(true)
    expect(await verifyWholeChapterQualityReviewV1(report, text, [{ role: 'user', content: text }])).toBe(false)
    expect(await verifyWholeChapterQualityReviewV1({ ...report, coverage: { ...report.coverage, end: 8 } }, text, request.messages)).toBe(false)
  })

  it('只归一化完整JSON围栏，缺引文或夹带解释仍拒绝；历史v1报告继续验签', async () => {
    const chapterText = '陈禾接过一百二十元，数好后把收条交还。'
    const request = await buildWholeChapterQualityReviewRequestV1({ mode: 'quality', chapterTitle: '交清', chapterText, registeredContext: '' })
    const raw = JSON.stringify({ summary: '已描写实际收款过程', strengths: ['行动具体'], issues: [] })
    const base = { raw, mode: 'quality' as const, chapterText, targetTextHash: request.targetTextHash, messages: request.messages, responseCompletion: 'complete' as const, settings }
    const fenced = await parseWholeChapterQualityReviewV1({ ...base, raw: '```json\n' + raw + '\n```' })
    expect(await verifyWholeChapterQualityReviewV1(fenced, chapterText, request.messages)).toBe(true)
    await expect(parseWholeChapterQualityReviewV1({ ...base, raw: '说明\n```json\n' + raw + '\n```' })).rejects.toThrow()
    await expect(parseWholeChapterQualityReviewV1({ ...base, raw: JSON.stringify({ summary: '猜测', strengths: [], issues: [{ ...issue('', null, null), quote: null }] }) })).rejects.toThrow('quote')
    const historical = await parseWholeChapterQualityReviewV1({ ...base, promptVersion: 'whole-chapter-quality-review-v1' })
    expect(await verifyWholeChapterQualityReviewV1(historical, chapterText, request.messages)).toBe(true)
    expect(request.messages[0].content).toContain('不要另写quote、start或end')
    expect(request.messages[0].content).toContain('章纲、细纲与作者要求是计划')
  })

  it('富文本存稿的单换行按非空文本段定位，旧v2的段落规则仍可验签', async () => {
    const chapterText = '准备验收。\n\n检查封盖。\n拿出收条。\n实际收款缺失。'
    const request = await buildWholeChapterQualityReviewRequestV1({ mode: 'quality', chapterTitle: '验收', chapterText, registeredContext: '' })
    const raw = JSON.stringify({ summary: '核对动作和结果', strengths: [], issues: [issue('实际收款缺失。', null, null)] })
    const base = { raw, mode: 'quality' as const, chapterText, targetTextHash: request.targetTextHash, messages: request.messages, responseCompletion: 'complete' as const, settings }
    const current = await parseWholeChapterQualityReviewV1(base)
    expect(current.coverage.paragraphs).toBe(4)
    expect(current.issues[0].paragraph).toBe(4)
    expect(await verifyWholeChapterQualityReviewV1(current, chapterText, request.messages)).toBe(true)
    const old = await parseWholeChapterQualityReviewV1({ ...base, promptVersion: 'whole-chapter-quality-review-v2' })
    expect(old.coverage.paragraphs).toBe(2)
    expect(old.issues[0].paragraph).toBe(2)
    expect(await verifyWholeChapterQualityReviewV1(old, chapterText, request.messages)).toBe(true)
  })
})
