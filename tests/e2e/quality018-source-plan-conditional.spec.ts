import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })
test('SFQA018 · native public V1 start/publication require active sources and preserve historical reads', async ({ page, context, baseURL }, info) => {
  test.setTimeout(120_000)
  if (!baseURL || !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname)) {
    throw new Error('SFQA018 requires an isolated loopback browser')
  }
  const origin = new URL(baseURL).origin, forbidden: string[] = []
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === origin && ['GET', 'HEAD', 'OPTIONS'].includes(request.method())) await route.continue()
    else { forbidden.push(`${request.method()} ${url.origin}${url.pathname}`); await route.abort('blockedbyclient') }
  })
  try {
    await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'sfqa018-isolated'))
    await page.goto('./')
    await expect(page.getByRole('heading', { name: /天地为炉，\s*万象成故事。/ })).toBeVisible()
    const result = await page.evaluate(async () => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { exerciseSfqa018NativeV1 } = await load<typeof import('../helpers/sfqa018-source-plan-native')>(
        '/storyforge/tests/helpers/sfqa018-source-plan-native.ts')
      return exerciseSfqa018NativeV1()
    })
    expect(result.failures.map(row => row.status)).toEqual(['missing', 'insufficient', 'conflict'])
    expect(result.controls).toEqual([
      { active: false, strategy: 'block', outcome: 'omitted' },
      { active: true, strategy: 'degrade-explicitly', outcome: 'missing' },
    ])
    expect(result.matched?.status).toBe('matched')
    expect(result.legacyUnchanged).toBe(true)
    expect(result.builds).toBe(0)
    expect(result.modelRequestedEvents).toBe(0)
    expect(forbidden).toEqual([])
    await info.attach('sfqa018-native-source-proof', { body: JSON.stringify(result), contentType: 'application/json' })
  } finally {
    await info.attach('sfqa018-network', { body: JSON.stringify({ forbidden, actualExternalRequests: 0 }), contentType: 'application/json' })
  }
})
