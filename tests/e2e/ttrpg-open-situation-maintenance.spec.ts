import { expect, test } from '@playwright/test'

/** Isolated native IndexedDB + actual deterministic commands; no provider/public UI acceptance. */
for (const cut of ['planned', 'expired', 'approved']) {
  test(`real situation consequences recover after ${cut} and reload without double payment or admission`, async ({ page }) => {
    await page.goto('./')
    const initial = await page.evaluate(async cut => {
      const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
      const helper = await importer('/storyforge/tests/helpers/open-ttrpg-maintenance.ts'), api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
      const f = await helper.setupMaintenanceFixtureV1({ effect: true, cost: true, chain: true })
      await helper.maintenanceStepV1(f.command)
      if (cut !== 'planned') await helper.maintenanceStepV1(f.command)
      if (cut === 'approved') await api.resumeTtrpgOpenSituationsV1(f.command)
      if (cut === 'approved') await helper.approveMaintenanceEffectV1(f.command)
      return { command: f.command, resource: f.f.runtimePackage.ttrpg.rulePack.content.resources[0].key, state: await api.readProductRuntimeState(f.command.sessionId), cut }
    }, cut)
    await page.reload()
    const result = await page.evaluate(async f => {
      const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
      const helper = await importer('/storyforge/tests/helpers/open-ttrpg-maintenance.ts'), api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
      if (f.cut !== 'approved') { await api.resumeTtrpgOpenSituationsV1(f.command); await helper.approveMaintenanceEffectV1(f.command) }
      const outcome = await api.resumeTtrpgOpenSituationsV1(f.command), state = await api.readProductRuntimeState(f.command.sessionId)
      await api.resumeTtrpgOpenSituationsV1(f.command)
      return { outcome, state, repeated: await api.readProductRuntimeState(f.command.sessionId) }
    }, initial)
    expect(result.outcome).toEqual({ status: 'executing', nextStepKey: 'terminal' })
    const run = result.state.ttrpg.openRun
    expect(Number(result.state.entities.hero.attributes[`resource.${initial.resource}`])).toBe(Number(initial.state.entities.hero.attributes[`resource.${initial.resource}`]) - 1)
    expect(run.situations.history).toHaveLength(1)
    expect(run.situations.history[0].instance.resolutionKind).toBe('no-intervention')
    expect(run.situations.active).toMatchObject([{ templateKey: 'situation.actual-consequence', activationReason: 'consequence', activatedAtWorldTurn: 2, noInterventionDueWorldTurn: 5 }])
    expect(run.situationCycles.at(-1).work.every((w: any) => w.completedRef)).toBe(true)
    expect(run.worldTime).toEqual(initial.state.ttrpg.openRun.worldTime)
    expect(run.knowledge).toEqual(initial.state.ttrpg.openRun.knowledge)
    expect(result.repeated).toEqual(result.state)
  })
}

test('FIFO admission uses actual capacity after reload and preserves the next reservation', async ({ page }) => {
  await page.goto('./')
  const initial = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-maintenance.ts'), api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const f = await helper.setupMaintenanceFixtureV1({ resolve: true, queue: true })
    await helper.maintenanceStepV1(f.command); await helper.maintenanceStepV1(f.command)
    return { command: f.command, state: await api.readProductRuntimeState(f.command.sessionId) }
  })
  await page.reload()
  const result = await page.evaluate(async f => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    await api.resumeTtrpgOpenSituationsV1(f.command)
    return await api.readProductRuntimeState(f.command.sessionId)
  }, initial)
  expect(result.ttrpg.openRun.situations.active).toHaveLength(5)
  expect(result.ttrpg.openRun.situations.active.some((i: any) => i.templateKey === 'situation.queue.5')).toBe(true)
  expect(result.ttrpg.openRun.situations.queued).toEqual([initial.state.ttrpg.openRun.situations.queued[1]])
})
