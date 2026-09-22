import { expect, test } from '@playwright/test'

test('运行时AI高风险确认和断网降级都不制造假进度', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'text-open-world-runtime-ai-e2e')
    localStorage.setItem('storyforge-ai-api-key-remember', 'true')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'agnes',
      apiKey: 'runtime-ai-e2e-key',
      model: 'runtime-ai-e2e-model',
      baseUrl: 'https://runtime-ai-e2e.example/v1',
      temperature: 0,
      maxTokens: 0,
    }))
  })
  let mode: 'high-risk' | 'offline' = 'high-risk'
  let calls = 0
  await page.route('**/chat/completions', async route => {
    calls += 1
    if (mode === 'offline') {
      await route.abort('internetdisconnected')
      return
    }
    const output = {
      kind: 'mapped-action',
      confidence: 0.99,
      actionKeys: ['action.steal-tonic'],
      choiceKeys: [],
      extractedArguments: { targetKey: null },
      rationale: '玩家明确提出偷取当前场景中的药剂。',
      requiresConfirmation: false,
      boundaryExplanation: null,
      replyText: '',
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'runtime-ai-boundary-e2e',
        object: 'chat.completion',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(output) } }],
        usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280 },
      }),
    })
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('./')
  const seeded = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [
      { createGovernedTextOpenWorldSessionFixtureV1 },
      { createTextOpenWorldVNextP9Fixture },
    ] = await Promise.all([
      importer('/storyforge/tests/helpers/text-open-world-product-session.ts'),
      importer('/storyforge/tests/helpers/text-open-world-vnext-fixture.ts'),
    ])
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: '运行时AI浏览器边界验收',
      textOpenWorldVNext: createTextOpenWorldVNextP9Fixture(),
      runtimeShape: 'vnext-only',
      title: '盐脊运行时AI边界存档',
      seed: 'browser-open-world-runtime-ai-boundary',
    })
    return { projectId: created.scope.projectId, sessionId: created.session.id, title: created.session.title }
  })

  await page.goto(`./openworld/runtime?project=${seeded.projectId}&mode=play`)
  const formalSaves = page.getByRole('region', { name: '正式存档' })
  await expect(formalSaves.getByText(seeded.title, { exact: true })).toBeVisible({ timeout: 20_000 })
  await formalSaves.locator('.open-world-save-open').filter({ hasText: seeded.title }).click()
  await page.getByRole('button', { name: '岑阿婆 · 守渠人的话', exact: true }).click()

  const eventCount = () => page.evaluate(async sessionId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    return db.productRuntimeEvents.where('sessionId').equals(sessionId).count()
  }, seeded.sessionId)
  const before = await eventCount()
  const input = page.getByLabel('你想怎么做？')
  await input.fill('我想趁她转身时悄悄拿走那瓶药')
  await page.getByTestId('text-open-world-natural-input').getByRole('button', { name: '提交' }).click()
  const confirmation = page.getByRole('alertdialog', { name: '确认高风险行动' })
  await expect(confirmation).toContainText('偷取盐露药剂', { timeout: 20_000 })
  expect(await eventCount()).toBe(before)
  await confirmation.getByRole('button', { name: '取消', exact: true }).click()
  await expect(confirmation).toBeHidden()
  expect(await eventCount()).toBe(before)

  mode = 'offline'
  await input.fill('请帮我理解附近还有什么可做的事情')
  await page.getByTestId('text-open-world-natural-input').getByRole('button', { name: '提交' }).click()
  const failure = page.getByTestId('text-open-world-runtime-ai-failure')
  await expect(failure).toHaveAttribute('data-failure-kind', 'unknown-result', { timeout: 20_000 })
  await expect(failure).toContainText('不会暗中重发')
  await expect(failure.getByRole('button', { name: /重试/ })).toHaveCount(0)
  await expect(page.getByTestId('text-open-world-input-notice')).toContainText('没有改变世界状态')
  expect(await eventCount()).toBe(before)
  await expect(page.getByTestId('text-open-world-fixed-choices').getByRole('button').first()).toBeEnabled()
  expect(calls).toBe(2)
})
