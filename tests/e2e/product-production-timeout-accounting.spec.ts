import { expect, test } from '@playwright/test'

test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'requires isolated open preview') })

/** Actual Chrome/IndexedDB, registered production UI and command/ledger path.
 * Provider output is deliberately unavailable; no real provider or author data. */
test('unknown production result survives reload, books only the exact author choice, then sends once in the next epoch', async ({ page }, info) => {
  let posts = 0
  await page.route('**/fixture-accounting/v1/chat/completions', async route => {
    posts++
    await route.abort('failed')
  })
  await page.goto('./')
  const fixture = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    const { db } = await load('/storyforge/src/lib/db/schema.ts')
    const { openProductionFixtureV1 } = await load('/storyforge/tests/helpers/open-ttrpg-production.ts')
    const { executeProductProductionCommand: command } = await load('/storyforge/src/lib/product-production/commands.ts')
    const api = await load('/storyforge/src/lib/product-production/scheduler.ts')
    const made = await openProductionFixtureV1(), { scope, productionId, brief } = made
    const previous = await db.productProductions.get(productionId)
    const saved = await command({ scope, productionId, command: { type: 'save-brief-revision',
      commandId: 'native-accounting.save', expectedStateRevision: previous.stateRevision,
      parentRevision: previous.currentBriefRevision, brief } })
    if (!saved.ok) throw Error('Fixture Brief not saved')
    const current = await db.productProductions.get(productionId)
    const row = await db.productProductionBriefs.where('[productionId+revision]').equals([productionId, current.currentBriefRevision]).first()
    const started = await command({ scope, productionId, command: { type: 'authorize-start',
      commandId: 'native-accounting.start', expectedStateRevision: current.stateRevision,
      briefRevision: row.revision, briefHash: row.briefHash, authorizationNonce: 'explicit-engineering-fixture' } })
    if (!started.ok) throw Error('Fixture production not authorized')
    const requirementKey = brief.capabilityRequirements.find((r: any) => r.mediaClass === 'text').requirementKey
    let fixtureCalls = 0
    const blocked = await api.runProductProductionUntilBlockedV1({ scope, productionId,
      capabilityBindings: [{ requirementKey, adapterId: 'configured-text.v1', bindingHash: 'a'.repeat(64) }],
      executor: async () => { fixtureCalls++; throw new api.ProductProductionResultUnknownErrorV1() } })
    if (fixtureCalls !== 1 || blocked.buildStatus !== 'recovery-required') throw Error('Initial simulated unknown result did not pause exactly once')
    const { updateWorkspace } = await load('/storyforge/src/lib/workspace/works.ts')
    const project = await db.projects.get(scope.projectId)
    await updateWorkspace(scope.projectId, { productPlatformOptIns: { ...project.productPlatformOptIns, productProductionV3: true } })
    const { useAIConfigStore } = await load('/storyforge/src/stores/ai-config.ts')
    useAIConfigStore.getState().setConfig({ provider: 'custom', model: 'fixture-accounting-only',
      baseUrl: location.origin + '/fixture-accounting/v1', apiKey: 'fixture-only-not-a-real-key', maxTokens: 16000, contextWindow: 131072 })
    const build = await db.productBuilds.get(blocked.buildId)
    return { scope, productionId, buildId: build.id, beforeLedger: build.budgetLedgerJson,
      beforePlan: build.planJson, beforeEpoch: build.controlEpoch,
      worlds: await db.worldReleases.where('projectId').equals(scope.projectId).toArray() }
  })
  const read = () => page.evaluate(async f => {
    const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const build = await db.productBuilds.get(f.buildId)
    return { build, worlds: await db.worldReleases.where('projectId').equals(f.scope.projectId).toArray() }
  }, fixture)
  await page.goto(`./ttrpg/production?project=${fixture.scope.projectId}&work=${fixture.scope.workId}&production=${fixture.productionId}`)
  const accounting = page.getByTestId('product-production-unknown-result-disposition')
  await expect(accounting).toBeVisible()
  await expect(page.getByRole('button', { name: '修正后继续制作', exact: true })).toBeDisabled()
  expect(posts).toBe(0)
  await page.reload()
  await expect(accounting).toBeVisible()
  for (const radio of await accounting.getByRole('radio').all()) await expect(radio).not.toBeChecked()
  const reloaded = await read()
  expect(reloaded.build.budgetLedgerJson).toBe(fixture.beforeLedger)
  expect(reloaded.build.planJson).toBe(fixture.beforePlan)
  expect(posts).toBe(0)

  await accounting.getByRole('radio', { name: '无法确认，按预留上限记账', exact: true }).check()
  await page.getByRole('button', { name: '修正后继续制作', exact: true }).click()
  await expect.poll(() => posts).toBe(1)
  await expect.poll(async () => (await read()).build.status).toBe('recovery-required')
  const after = await read(), ledger = JSON.parse(after.build.budgetLedgerJson)
  expect(after.build.controlEpoch).toBe(fixture.beforeEpoch + 1)
  expect(JSON.parse(after.build.planJson).tasks).toEqual(JSON.parse(fixture.beforePlan).tasks)
  expect(after.worlds).toEqual(fixture.worlds)
  expect(ledger.attempts[0].resolution).toBe('author-charged-reservation-upper-bound')
  expect(ledger.attempts[0].usageKnown).toBe(true)
  expect(ledger.attempts[0].usage).toEqual(JSON.parse(fixture.beforeLedger).attempts[0].usage)
  expect(ledger.attempts.filter((a: any) => !a.usageKnown)).toHaveLength(1)
  expect(posts).toBe(1)
  await page.reload()
  await expect(accounting).toBeVisible()
  for (const radio of await accounting.getByRole('radio').all()) await expect(radio).not.toBeChecked()
  await expect(page.getByRole('button', { name: '修正后继续制作', exact: true })).toBeDisabled()
  expect(posts).toBe(1)
  await page.screenshot({ path: info.outputPath('explicit-accounting-after-unknown-reload.png'), fullPage: true })
  await info.attach('original-booking-and-single-explicit-continuation', { body: JSON.stringify({ fixture, after, posts,
    provider: 'simulated HTTP failure; no real provider', independentHumanAcceptance: false }), contentType: 'application/json' })
})
