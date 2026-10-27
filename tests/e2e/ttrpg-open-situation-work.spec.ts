import { expect, test } from '@playwright/test'

/** Native isolated source-backed instance/terminal receipts; not public UI or real-provider acceptance. */
for (const defeat of [false, true]) {
  test(`a ${defeat ? 'defeated-front cleanup' : 'front escalation activation'} resumes after reload and preserves knowledge`, async ({ page }) => {
    await page.goto('./')
    const initial = await page.evaluate(async defeat => {
      const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
      const helper = await importer('/storyforge/tests/helpers/open-ttrpg-situation.ts'), api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
      const f = await helper.setupSituationPressureWorkV1({ defeat })
      return { command: f.command, cycleKey: f.cycleKey, workKey: f.workKey,ownerStepKey: f.ownerStepKey, state: await api.readProductRuntimeState(f.command.sessionId) }
    }, defeat)
    expect(initial.state.ttrpg.openRun.pressureCycles.find((c: any) => c.cycleKey === initial.cycleKey).work[0].completedRef).toBeNull()
    await page.reload()
    const result = await page.evaluate(async fixture => {
      const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
      const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
      const resumed = await api.resumeTtrpgOpenPressureV1(fixture.command), state = await api.readProductRuntimeState(fixture.command.sessionId)
      await api.resumeTtrpgOpenPressureV1(fixture.command)
      return { resumed, state, repeated: await api.readProductRuntimeState(fixture.command.sessionId) }
    }, initial)
    expect(result.resumed).toEqual({ status: 'executing', nextStepKey: initial.ownerStepKey.replace('pressure','situations') })
    expect(result.state.ttrpg.openRun.worldTime).toEqual(initial.state.ttrpg.openRun.worldTime)
    expect(result.state.ttrpg.openRun.knowledge).toEqual(initial.state.ttrpg.openRun.knowledge)
    expect(result.state.ttrpg.openRun.chaos).toEqual(initial.state.ttrpg.openRun.chaos)
    expect(result.state.ttrpg.openRun.pressureCycles.find((c: any) => c.cycleKey === initial.cycleKey).work[0].completedRef).not.toBeNull()
    if (defeat) {
      expect(result.state.ttrpg.openRun.situations.active).toEqual([])
      expect(result.state.ttrpg.openRun.situations.history[0].instance.resolutionKind).toBe('front-defeated')
    } else expect(result.state.ttrpg.openRun.situations.active.some((i: any) => i.templateKey === 'situation.after-storm')).toBe(true)
    expect(result.repeated).toEqual(result.state)
  })
}
