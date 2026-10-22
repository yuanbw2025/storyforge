import { expect, test } from '@playwright/test'

/** Native isolated source-backed owner APIs. Public player UI/provider/human acceptance is separate. */
for (const mode of ['actionable', 'private', 'closure']) {
  test(`runtime ${mode} classification and checks recover after reload without a fabricated pass`, async ({ page }) => {
    await page.goto('./')
    const initial = await page.evaluate(async mode => {
      const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
      const helper = await importer('/storyforge/tests/helpers/open-ttrpg-checks.ts'), api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
      const f = await helper.setupChecksFixtureV1({ privatePoint: mode === 'private', closure: mode === 'closure', stageTick: mode === 'closure' ? 2 : 0 })
      return { command: f.command, state: await api.readProductRuntimeState(f.command.sessionId), mode }
    }, mode)
    await page.reload()
    const result = await page.evaluate(async f => {
      const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
      const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts'), helper = await importer('/storyforge/tests/helpers/open-ttrpg-branch-recovery.ts')
      const first = await api.resumeTtrpgOpenChecksV1(f.command)
      if (f.mode === 'closure') {
        await api.closeTtrpgOpenStageV1({ ...await helper.operationInput(f.command.sessionId, f.command.operationKey, 'stage.close'), summary: '真人明确收束当前阶段，保留证据与未完事项' })
        await api.resumeTtrpgOpenChecksV1(f.command)
      }
      const state = await api.readProductRuntimeState(f.command.sessionId)
      await api.resumeTtrpgOpenChecksV1(f.command)
      return { first, state, repeated: await api.readProductRuntimeState(f.command.sessionId) }
    }, initial)
    const run = result.state.ttrpg.openRun
    expect(run.worldTime).toEqual(initial.state.ttrpg.openRun.worldTime)
    expect(run.knowledge).toEqual(initial.state.ttrpg.openRun.knowledge)
    expect(result.repeated).toEqual(result.state)
    if (mode === 'private') {
      expect(result.first.status).toBe('awaiting-gate-recovery')
      expect(run.gateReceipts[0].result.results['exit-exists'].passed).toBe(false)
      expect(run.operations[0].businessRefs.some((r: any) => r.stepKey === 'gates')).toBe(false)
    } else if (mode === 'closure') {
      expect(result.first.status).toBe('awaiting-stage-closure')
      expect(run.stage).toMatchObject({ status: 'closed', closedAtWorldTurn: 1 })
      expect(run.stageClosures[0].ticks[0]).toMatchObject({ before: 1, after: 3 })
      expect(run.clocks[0].value).toBe(3)
      expect(run.stageClosures[0].completedRef).not.toBeNull()
      expect(Object.values(run.gateReceipts[0].result.results).every((g: any) => g.applicability === 'not-applicable' && g.passed === null)).toBe(true)
    } else {
      expect(result.first).toEqual({ status: 'executing', nextStepKey: 'narration' })
      expect(run.gateReceipts[0].result.allApplicablePassed).toBe(true)
    }
  })
}
