import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'

async function runCompression(page: Page, maxOutputTokens?: number) {
  return page.evaluate(async maxOutputTokens => {
    const imp = new Function('p', 'return import(p)')
    const [{ createAgentContextCompressionSessionV1 }, { getAgentSkillV1 }, { AgentTeamBudgetTracker }, { estimateTokens }] = await Promise.all([
      imp('/storyforge/src/lib/agent/context-compression.ts'), imp('/storyforge/src/lib/agent/skill-registry.ts'),
      imp('/storyforge/src/lib/agent/team-budget.ts'), imp('/storyforge/src/lib/ai/context-budget.ts'),
    ])
    const content = ['【潮门规则】禁止触碰潮汐钟。', '主角尚未知晓旧港秘密，后续获知前不能据此行动。', '海历3021年，议会只允许十年开启一次潮门。', '潮汐推移形成盐晶层。'.repeat(1050)].join('\n')
    const policy = { ...getAgentSkillV1('world-origin.worldview-field', 'world-origin').contextCompression, ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }) }
    const session = createAgentContextCompressionSessionV1({
      policy, config: { provider: 'agnes', model: 'agnes-2.5-flash', apiKey: 'isolated-test-token', baseUrl: 'https://compression.invalid/v1', maxTokens: 8000, temperature: 0.2 },
      projectId: 1, authorRequest: '根据既有内容补全', routingCategory: 'agent.world-origin',
      runtime: { budget: new AgentTeamBudgetTracker('balanced'), requiredFutureModelCalls: 1 },
    })
    const result = await session.sourceTransformer({ source: { key: 'worldview', label: '世界观', layer: 'L2', budgetTokens: 8000, protectedFromTrim: false }, content, originalTokens: estimateTokens(content), sourceBudgetTokens: 1000, inputBudgetTokens: 8000 })
    return { result, deliveredTokens: result?.content ? estimateTokens(result.content) : null }
  }, maxOutputTokens)
}
test.beforeEach(async ({ page }) => { await createLongform(page, '压缩协议隔离验证') })
test('actual bounded JSON transport preserves literal anchors and source budget', async ({ page }) => {
  const requests: Record<string, unknown>[] = []
  await page.route('https://compression.invalid/**', async route => {
    const body = route.request().postDataJSON(); requests.push(body)
    const anchors = JSON.parse(body.messages[1].content.match(/【必须覆盖的逐字锚点】([^\n]+)/u)[1])
    const content = JSON.stringify({ version: 1, summary: '潮门规则、时间与认知边界均沿用原文。', coveredAnchorIds: anchors.map((anchor: { id: string }) => anchor.id), evidenceQuotes: anchors.map((anchor: { id: string; quote: string }) => ({ anchorId: anchor.id, quote: anchor.quote })) })
    await route.fulfill({ json: { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } } })
  })
  const { result, deliveredTokens } = await runCompression(page)
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({ response_format: { type: 'json_object' }, chat_template_kwargs: { enable_thinking: false } })
  expect(result.compression).toMatchObject({ outcome: 'verified', attempts: 1, requiredAnchorCount: 3, coveredAnchorCount: 3 })
  expect(deliveredTokens).toBeLessThanOrEqual(1000)
})
test('a rejected transport is one dispatch with explicit fallback evidence', async ({ page }) => {
  let requests = 0
  await page.route('https://compression.invalid/**', async route => { requests++; await route.fulfill({ status: 503, json: { error: { message: 'temporarily unavailable' } } }) })
  const { result } = await runCompression(page)
  expect(requests).toBe(1)
  expect(result.compression).toMatchObject({ outcome: 'fallback', attempts: 1 })
})
test('an impossible JSON envelope falls back before dispatch', async ({ page }) => {
  let requests = 0
  await page.route('https://compression.invalid/**', route => { requests++; return route.abort() })
  const { result } = await runCompression(page, 8)
  expect(requests).toBe(0)
  expect(result.compression).toMatchObject({ outcome: 'fallback', attempts: 0, failureCode: 'compression-envelope-exceeds-output-budget' })
})
test('only a completed invalid response uses the bounded semantic repair', async ({ page }) => {
  let requests = 0
  await page.route('https://compression.invalid/**', async route => {
    requests++
    const body = route.request().postDataJSON()
    const anchors = JSON.parse(body.messages[1].content.match(/【必须覆盖的逐字锚点】([^\n]+)/u)[1])
    const content = requests === 1 ? '{}' : JSON.stringify({ version: 1, summary: '沿用潮门规则和认知边界。', coveredAnchorIds: anchors.map((anchor: { id: string }) => anchor.id), evidenceQuotes: anchors.map((anchor: { id: string; quote: string }) => ({ anchorId: anchor.id, quote: anchor.quote })) })
    await route.fulfill({ json: { choices: [{ message: { content }, finish_reason: 'stop' }] } })
  })
  expect((await runCompression(page)).result.compression).toMatchObject({ outcome: 'verified', attempts: 2 })
  expect(requests).toBe(2)
})
