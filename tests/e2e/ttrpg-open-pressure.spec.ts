import { expect, test } from '@playwright/test'

/** Native isolated IndexedDB/API; authored warnings, no live provider or public UI acceptance. */
test('advance warning and pressure ticks survive reload and settle only once', async ({ page }) => {
  await page.goto('./')
  const initial = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-pressure.ts')
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const fixture = await helper.setupPressureFixtureV1({ prewarn: true,isolateSituations: true })
    await api.resumeTtrpgOpenOperationV1(fixture.command)
    await api.advanceTtrpgOpenPressureV1(await helper.nextPressureInputV1(fixture.command))
    await api.advanceTtrpgOpenPressureV1(await helper.nextPressureInputV1(fixture.command))
    return { command: fixture.command, scope: fixture.f.scope, state: await api.readProductRuntimeState(fixture.f.sessionId) }
  })
  expect(initial.state.ttrpg.openRun.pressureSignals[0].worldTurn).toBe(0)
  expect(initial.state.ttrpg.openRun.pressureCycles[0].tickRefs).toHaveLength(1)
  expect(initial.state.ttrpg.openRun.clocks[0].value).toBe(1)
  await page.reload()
  const resumed = await page.evaluate(async fixture => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const { settleOpenPaidTurnsV1 } = await importer('/storyforge/tests/helpers/open-ttrpg-paid-turns.ts')
    const result = await settleOpenPaidTurnsV1(fixture.command)
    const state = await api.readProductRuntimeState(fixture.command.sessionId)
    const view = await api.loadTtrpgOpenPlayerContextV1({ scope: fixture.scope, sessionId: fixture.command.sessionId, actorKey: 'hero' })
    await api.resumeTtrpgOpenPressureV1(fixture.command)
    return { result, state, repeated: await api.readProductRuntimeState(fixture.command.sessionId), signals: view.view.pressureSignals }
  }, initial)
  expect(resumed.result).toEqual({ status: 'executing', nextStepKey: 'terminal' })
  expect(resumed.state.ttrpg.openRun.clocks[0].value).toBe(3)
  expect(resumed.state.ttrpg.openRun.fronts[0].stageKey).toBe('rising')
  expect(resumed.state.ttrpg.openRun.chaos.value).toBe(6)
  expect(resumed.state.ttrpg.openRun.pressureCycles.flatMap((c: any) => c.tickRefs)).toHaveLength(3)
  expect(resumed.state.ttrpg.openRun.worldTime.worldTurn).toBe(3)
  expect(resumed.signals).toMatchObject([{ signalText: '风更大了', atWorldTurn: 0 }])
  expect(Object.keys(resumed.signals[0])).not.toContain('stageKey')
  expect(Object.keys(resumed.signals[0])).not.toContain('frontKey')
  expect(resumed.repeated).toEqual(resumed.state)
})
