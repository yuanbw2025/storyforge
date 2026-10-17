import { expect, test } from '@playwright/test'

test('native AVG V2 renders its canonical dialogue and Cue, branches on typed knowledge, and resumes an actual save', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./avg/library')
  const owned = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [fixture, runtime] = await Promise.all([
      load('/storyforge/tests/helpers/avg-native-fixture.ts'), load('/storyforge/src/lib/product/runtime-instances.ts'),
    ])
    const s = await fixture.seedAvgNativePreview()
    const session = await runtime.createProductRuntimeInstance({ scope: s.scope, kind: 'avg', title: '原生 V2 试玩',
      productSource: { kind: 'build', productBuildId: s.buildId, expectedPreviewHash: s.preview.previewHash } })
    return { scope: s.scope, sessionId: session.id, buildId: s.buildId }
  })
  const query = `project=${owned.scope.projectId}&work=${owned.scope.workId}&session=${owned.sessionId}`
  await page.goto(`./avg/play?${query}`)
  await expect(page.locator('.avg-dialogue p')).toHaveText('封口仍在。')
  await expect(page.locator('.avg-speaker')).toHaveText('保管员')
  await expect(page.locator('.avg-stage')).toHaveAttribute('data-tone', 'night')
  await page.screenshot({ path: info.outputPath('avg-native-stage.png'), fullPage: true })
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await expect(page.getByRole('button', { name: '向保管员说明', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '检查封口', exact: true }).click()
  await expect(page.locator('.avg-dialogue p')).toHaveText('封口仍在。')
  await page.getByRole('button', { name: '快速存档', exact: true }).click()
  await page.reload()
  await expect(page.locator('.avg-dialogue p')).toHaveText('封口仍在。')
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await expect(page.getByRole('button', { name: '检查封口', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '向保管员说明', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '向保管员说明', exact: true }).click()
  await expect(page.locator('.avg-dialogue p')).toHaveText('保管员收下信封。')
  await page.screenshot({ path: info.outputPath('avg-native-ending.png'), fullPage: true })
  const state = await page.evaluate(async s => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [runtime, { db }, player] = await Promise.all([
      load('/storyforge/src/lib/product/runtime-core.ts'), load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/stores/avg-game-player.ts'),
    ])
    const store = player.useAvgGamePlayerStore.getState()
    const value = await runtime.readProductRuntimeState(store.selectedSessionId)
    return { version: store.selectedManifest.version, rules: value.avgRules?.version, ending: value.narrative.endingKey,
      knowledge: value.narrative.variables.avg.knowledge, runs: await db.agentRuns.count(),
      saves: await db.productRuntimeCheckpoints.where('sessionId').equals(s.sessionId).count() }
  }, owned)
  expect(state).toMatchObject({ version: 2, rules: 1, ending: 'handover', knowledge: { player: { seal: true }, keeper: { seal: true } }, runs: 0 })
  expect(state.saves).toBeGreaterThan(0)
})
