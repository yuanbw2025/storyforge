import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })
for (const version of [1, 2] as const) test(`SFQA058 · native V3 production carries frozen WorldReference V${version} plan`, async ({ page, context, baseURL }, info) => {
  test.setTimeout(150_000)
  if (!baseURL || !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname)) {
    throw new Error('SFQA058 requires an isolated loopback browser')
  }
  const origin = new URL(baseURL).origin, forbidden: string[] = []
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === origin && ['GET', 'HEAD', 'OPTIONS'].includes(request.method())) await route.continue()
    else { forbidden.push(`${request.method()} ${url.origin}${url.pathname}`); await route.abort('blockedbyclient') }
  })
  try {
    await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'sfqa058-isolated'))
    await page.goto('./')
    await expect(page.getByRole('heading', { name: /天地为炉，\s*万象成故事。/ })).toBeVisible()
    const result = await page.evaluate(async version => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { exerciseSfqa058NativeV1 } = await load<typeof import('../helpers/sfqa058-chat-frozen-source-plan-native')>(
        '/storyforge/tests/helpers/sfqa058-chat-frozen-source-plan-native.ts')
      return exerciseSfqa058NativeV1(version)
    }, version)
    expect(result.manifestSteps).toEqual(version === 1 ? ['content.design'] : ['content.design', 'media.requirements'])
    expect(result.syntheticTextCalls).toEqual(version === 1 ? [] : ['situation', 'review'])
    expect(result.controls).toEqual(version === 1 ? ['incomplete-prefix-publication']
      : ['unapproved-start', 'missing-plan', 'wrong-product', 'wrong-version', 'author-review-only'])
    expect(result.mediaCount).toBe(version === 1 ? 0 : 2)
    expect(result.authorOnlyPreserved).toBe(true)
    expect(result.sourceWorldUnchanged).toBe(true)
    await page.reload()
    await expect(page.getByRole('heading', { name: /天地为炉，\s*万象成故事。/ })).toBeVisible()
    const after = await page.evaluate(async ({ scope, productionId }) => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { readSfqa058NativeSnapshotV1 } = await load<typeof import('../helpers/sfqa058-chat-frozen-source-plan-native')>(
        '/storyforge/tests/helpers/sfqa058-chat-frozen-source-plan-native.ts')
      return readSfqa058NativeSnapshotV1(scope, productionId)
    }, { scope: result.scope, productionId: result.productionId })
    expect(after).toEqual(result.snapshot)
    expect(forbidden).toEqual([])
    await info.attach('sfqa058-native-source-proof', { body: JSON.stringify({ ...result, refreshUnchanged: true }), contentType: 'application/json' })
  } finally {
    await info.attach('sfqa058-network', { body: JSON.stringify({ forbidden, actualExternalRequests: 0 }), contentType: 'application/json' })
  }
})
