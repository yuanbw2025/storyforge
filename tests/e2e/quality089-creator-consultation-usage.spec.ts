import { expect, test, type Page } from '@playwright/test'
import { sfqa089UsagePlanV1, type Sfqa089UsageCaseV1 } from '../helpers/sfqa089-creator-usage-fixture'

test.use({ serviceWorkers: 'block' })

async function openUsage(page: Page) {
  await expect(page.getByTestId('text-open-world-creator-brief-studio')).toBeVisible()
  await page.getByTestId('text-open-world-creator-brief-continue').click()
  const usage = page.locator('[aria-labelledby="tow-usage-heading"]')
  await expect(usage).toBeVisible()
  return usage
}

for (const kind of ['direct', 'edited', 'ignored', 'repair', 'manual', 'rejected'] as Sfqa089UsageCaseV1[]) {
  test(`SFQA089 · ${kind} consultation keeps its actual usage through readiness and refresh`, async ({ context, page, baseURL }, info) => {
    test.setTimeout(120_000)
    if (!baseURL || !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname)) {
      throw new Error('SFQA089 requires an isolated loopback browser')
    }
    const origin = new URL(baseURL).origin, plan = sfqa089UsagePlanV1(kind)
    const forbidden: string[] = [], models: string[] = []
    const endpoint = 'https://sfqa089-fixture.invalid/v1/chat/completions'
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type' }
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.href === endpoint && request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: cors })
      } else if (url.href === endpoint && request.method() === 'POST') {
        const response = plan.responses[models.length]
        const body = request.postDataJSON() as { model?: string }
        if (!response || typeof body.model !== 'string') {
          forbidden.push('extra or invalid synthetic request'); await route.abort(); return
        }
        models.push(body.model)
        await route.fulfill({ status: 200, contentType: 'application/json', headers: cors,
          body: JSON.stringify({ id: `sfqa089-${models.length}`, choices: [{ index: 0, finish_reason: 'stop',
            message: { role: 'assistant', content: response.content } }],
          usage: { prompt_tokens: response.input, completion_tokens: response.output,
            total_tokens: response.input + response.output } }) })
      } else if (url.origin === origin && ['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        await route.continue()
      } else { forbidden.push(`${request.method()} ${url.origin}${url.pathname}`); await route.abort('blockedbyclient') }
    })
    try {
      await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'sfqa089-isolated'))
      await page.goto('./')
      await expect(page.getByRole('heading', { name: /天地为炉，\s*万象成故事。/ })).toBeVisible()
      const seeded = await page.evaluate(async kind => {
        const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
        const { seedSfqa089UsageCaseV1 } = await load<typeof import('../helpers/sfqa089-creator-usage-fixture')>(
          '/storyforge/tests/helpers/sfqa089-creator-usage-fixture.ts')
        return seedSfqa089UsageCaseV1(kind)
      }, kind)
      expect(models).toHaveLength(plan.responses.length)
      await page.goto(`./world/versions?project=${seeded.scope.projectId}`)
      await page.getByRole('region', { name: '世界修订、发布与产品交接' })
        .getByRole('button', { name: '交给文字开放世界', exact: true }).click()
      const assertUsage = async () => {
        const section = await openUsage(page)
        if (kind === 'manual') {
          await expect(section).toContainText('没有发生模型调用或费用')
          await expect(section.getByTestId('text-open-world-consultation-usage')).toHaveCount(0)
        } else {
          const grid = section.getByTestId('text-open-world-consultation-usage')
          await expect(grid).toContainText(`${plan.responses.length} 次`)
          await expect(grid).toContainText(`${plan.input} / ${plan.output}`)
          await expect(section).not.toContainText('没有发生模型调用或费用')
          if (!plan.knownCost) await expect(grid).toContainText('按已知价格估算未知')
          if (kind === 'repair') await expect(section).toContainText('本次确认关联 2 次')
          if (kind === 'ignored') await expect(section).toContainText('之前的会谈用量仍计入')
        }
        return section.textContent()
      }
      const firstText = await assertUsage()
      await page.reload()
      const refreshedText = await assertUsage()
      expect(refreshedText).toBe(firstText)
      const after = await page.evaluate(async () => {
        const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
        const { readSfqa089UsageFootprintV1 } = await load<typeof import('../helpers/sfqa089-creator-usage-fixture')>(
          '/storyforge/tests/helpers/sfqa089-creator-usage-fixture.ts')
        return readSfqa089UsageFootprintV1()
      })
      expect(after).toEqual(seeded.before)
      expect(models).toHaveLength(plan.responses.length)
      expect(forbidden).toEqual([])
      await info.attach('sfqa089-native-usage-proof', { body: JSON.stringify({ kind, before: seeded.before,
        after, requests: models.length, models, confirmedOrigin: seeded.confirmedOrigin,
        actualExternalRequests: 0, refreshedText }), contentType: 'application/json' })
    } finally {
      await info.attach('sfqa089-network', { body: JSON.stringify({ requests: models.length, forbidden,
        actualExternalRequests: 0, transport: 'local Playwright fulfillment' }), contentType: 'application/json' })
    }
  })
}
