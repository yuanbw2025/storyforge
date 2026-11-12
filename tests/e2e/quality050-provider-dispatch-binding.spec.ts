import { expect, test } from '@playwright/test'

/** Isolated browser/public production APIs; no real model or author data. */
test('frozen provider A reaches vision transport and changed scheduler binding sends nothing after reload', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'sfqa050-isolated-native')
  })
  const requests: Array<{ host: string; model: string; temperature: number }> = []
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue()
    if (!['sfqa050-a.invalid', 'sfqa050-b.invalid'].includes(url.hostname)
      || !url.pathname.endsWith('/chat/completions')) return route.abort()
    const body = route.request().postDataJSON() as { model: string; temperature: number }
    requests.push({ host: url.hostname, model: body.model, temperature: body.temperature })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      choices: [{ message: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }) })
  })
  await page.goto('./')
  const proof = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const helper = await load('/storyforge/tests/helpers/sfqa050-provider-dispatch-binding.ts') as typeof import('../helpers/sfqa050-provider-dispatch-binding')
    const { useAIConfigStore } = await load('/storyforge/src/stores/ai-config.ts') as typeof import('../../src/stores/ai-config')
    const { resolveConfiguredTextCapabilityV1, runConfiguredProductionVisionV1 } = await load('/storyforge/src/lib/product-production/capabilities.ts') as typeof import('../../src/lib/product-production/capabilities')
    const { runProductProductionUntilBlockedV1 } = await load('/storyforge/src/lib/product-production/scheduler.ts') as typeof import('../../src/lib/product-production/scheduler')
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    useAIConfigStore.setState({ config: { ...helper.SFQA050_CONFIG_A }, presets: [], taskRoutes: {} })
    const owned = await helper.authorizeSFQA050ProductionV1('general')
    const input = { projectId: owned.scope.projectId, category: 'product-production', requirementKey: owned.capabilityBindings[0]!.requirementKey }
    const config = { ...helper.SFQA050_CONFIG_A }
    const frozen = await resolveConfiguredTextCapabilityV1(input)
    const vision = await runConfiguredProductionVisionV1({ ...input,
      expectedCapabilityHash: frozen.receipt.capabilityHash, messages: [{ role: 'user', content: '核对原图片' }],
      images: [await helper.sfqa050ImageV1()], maximumOutputTokens: 256,
    }, { resolveConfig: () => config, now: () => {
      Object.assign(config, helper.SFQA050_CONFIG_B)
      helper.installSFQA050RouteV1(helper.SFQA050_CONFIG_B)
      return 101
    } })
    let entered = 0
    await runProductProductionUntilBlockedV1({ ...owned, executor: async execution => {
      entered += 1
      helper.installSFQA050RouteV1(helper.SFQA050_CONFIG_B)
      return owned.executor(execution)
    } })
    const build = (await db.productBuilds.where('productionId').equals(owned.productionId).first())!
    return { scope: owned.scope, productionId: owned.productionId, entered, status: build.status,
      ledger: build.budgetLedgerJson, receipt: { provider: vision.bindingReceipt.provider, model: vision.bindingReceipt.model,
        capabilityHash: vision.bindingReceipt.capabilityHash }, frozenCapabilityHash: frozen.receipt.capabilityHash }
  })
  expect(proof.entered).toBeGreaterThan(0)
  expect(proof.status).toBe('recovery-required')
  expect(proof.receipt).toEqual({ provider: 'agnes', model: 'sfqa050-model-a', capabilityHash: proof.frozenCapabilityHash })
  expect(requests).toEqual([{ host: 'sfqa050-a.invalid', model: 'sfqa050-model-a', temperature: 0.7 }])
  await page.reload()
  const reloaded = await page.evaluate(async input => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const { readProductProductionProgressV1 } = await load('/storyforge/src/lib/product-production/service.ts') as typeof import('../../src/lib/product-production/service')
    await readProductProductionProgressV1({ scope: input.scope, productionId: input.productionId })
    const build = (await db.productBuilds.where('productionId').equals(input.productionId).first())!
    return { status: build.status, ledger: build.budgetLedgerJson }
  }, { scope: proof.scope, productionId: proof.productionId })
  expect(reloaded).toEqual({ status: proof.status, ledger: proof.ledger })
  expect(requests).toHaveLength(1)
})
