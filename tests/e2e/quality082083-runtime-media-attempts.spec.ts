import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })
test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin
  await page.route('**/*', route => {
    const request = route.request()
    return new URL(request.url()).origin === origin && ['GET', 'HEAD'].includes(request.method())
      ? route.continue() : route.abort()
  })
  await page.goto('./')
})

test('native sent attempt survives browser reload and backup without reissuing or releasing its hold', async ({ page }) => {
  const seeded = await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (path: string) => Promise<unknown>
    const { seedTtrpgRuntimeMediaAttemptFixtureV1 } = await importer('/storyforge/tests/helpers/current-ttrpg-runtime-media-attempt.ts') as typeof import('../helpers/current-ttrpg-runtime-media-attempt')
    const f = await seedTtrpgRuntimeMediaAttemptFixtureV1()
    let markSent!: () => void
    const sent = new Promise<void>(resolve => { markSent = resolve })
    void f.execute({ executionLocation: 'browser-direct', async request() {
      markSent()
      return new Promise(() => {}) // The browser closes while the synthetic provider is pending.
    } }).catch(() => undefined)
    await sent
    return { sessionId: f.sessionId, requestId: f.row.id!, projectId: f.scope.projectId }
  })
  await page.reload()
  const proof = await page.evaluate(async ids => {
    const importer = new Function('p', 'return import(p)') as (path: string) => Promise<unknown>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const { authoredImagePackAdapterV1: adapter } = await importer('/storyforge/src/lib/product-production/media-adapters.ts') as typeof import('../../src/lib/product-production/media-adapters')
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-media.ts') as typeof import('../../src/lib/ttrpg/runtime-media')
    const { exportProjectJSON, importProjectJSON } = await importer('/storyforge/src/lib/export/json-export.ts') as typeof import('../../src/lib/export/json-export')
    const original = (await db.ttrpgRuntimeAssetRequests.get(ids.requestId))!
    const expiration = { sessionId: ids.sessionId, now: original.processorLeaseExpiresAt! + 1 }
    const recovered = await Promise.all([api.recoverTtrpgRuntimeMediaQueueV1(expiration), api.recoverTtrpgRuntimeMediaQueueV1(expiration)])
    const backup = await exportProjectJSON(ids.projectId)
    const copyId = await importProjectJSON(backup)
    const copied = (await db.ttrpgRuntimeAssetRequests.where('projectId').equals(copyId).first())!
    const rejected = await Promise.allSettled([
      api.retryTtrpgRuntimeAssetRequestV1({ requestId: copied.id!, viewerKey: 'viewer.gm' }),
      api.enqueueTtrpgRuntimeAssetRequestV1({ sessionId: copied.sessionId, viewerKey: 'viewer.gm', slotKey: copied.slotKey,
        requestKey: 'native.exceeds.remaining.hold', adapterId: adapter.capability.adapterId, adapter, environment: 'test', maximumRequestCostUsd: 6 }),
    ])
    let repeatCalls = 0
    await Promise.allSettled([api.processTtrpgRuntimeAssetRequestV1({ requestId: copied.id!, adapter, environment: 'test',
      transport: { executionLocation: 'browser-direct', async request() { repeatCalls++; throw new Error('native duplicate send') } } })])
    return { recovered, original, copied, repeatCalls, rejected: rejected.map(item => item.status) }
  }, seeded)
  expect(proof.recovered.reduce((sum, count) => sum + count, 0)).toBe(1)
  expect(proof.original.status).toBe('generating')
  expect(proof.copied).toMatchObject({ status: 'failed', lastErrorCode: 'provider-outcome-unknown', actualCostUsd: null, mediaAssetId: null, processorLeaseId: null })
  expect(proof.copied.attemptAccountingJson).toBe(proof.original.attemptAccountingJson)
  expect(proof.rejected).toEqual(['rejected', 'rejected'])
  expect(proof.repeatCalls).toBe(0)
})
