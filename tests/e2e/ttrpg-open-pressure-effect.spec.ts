import { expect, test } from '@playwright/test'

/** Native isolated approval/receipt flow; not public UI or real provider acceptance. */
test('a pressure option and stakeholder approval survive reload and charge once', async ({ page }) => {
  await page.goto('./')
  const prepared = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-pressure-effect.ts')
    const envelope = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const f = await helper.setupPressureEffectFixtureV1()
    const locator = { ...f.command, viewerKey: f.gmViewer, cycleKey: f.cycleKey, workKey: f.workKey }
    const request = { bindings: { actor: 'hero' }, alternativeKey: 'large' }
    const before = await api.readProductRuntimeState(f.command.sessionId), review = await api.prepareTtrpgOpenPressureEffectV1({ ...locator, request })
    const key = `pressure.work.${f.workKey}.${review.reviewKey}.propose`
    const input = { ...await envelope.openEnvelopeV1(f.command.sessionId, await api.ttrpgOpenOperationCommandIdV1(before.ttrpg.sessionKey, f.command.operationKey, key)), ...locator,
      request, riskHash: review.riskHash, reviewKey: review.reviewKey }
    await api.proposeTtrpgOpenPressureEffectV1(input)
    return { command: f.command, locator, review, resource: f.resource, before: before.entities.hero.attributes[`resource.${f.resource}`], state: await api.readProductRuntimeState(f.command.sessionId) }
  })
  expect(prepared.state.entities.hero.attributes[`resource.${prepared.resource}`]).toBe(prepared.before)
  expect(prepared.state.ttrpg.openRun.pressureCycles.find((c: any) => c.cycleKey === prepared.locator.cycleKey).work[0].effectReviews[0].request.alternativeKey).toBe('large')
  await page.reload()
  const confirmed = await page.evaluate(async fixture => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts'), envelope = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const state = await api.readProductRuntimeState(fixture.command.sessionId)
    const view = await api.readTtrpgOpenPressureEffectApprovalViewV1({ ...fixture.locator, actorKey: 'hero' })
    const key = `pressure.work.${fixture.locator.workKey}.${fixture.review.reviewKey}.approval.hero`
    await api.confirmTtrpgOpenPressureEffectV1({ ...await envelope.openEnvelopeV1(fixture.command.sessionId, await api.ttrpgOpenOperationCommandIdV1(state.ttrpg.sessionKey, fixture.command.operationKey, key)), ...fixture.locator,
      riskHash: view.riskHash, reviewKey: view.reviewKey, actorKey: 'hero', decision: 'approve' })
    return { view, state: await api.readProductRuntimeState(fixture.command.sessionId) }
  }, prepared)
  expect(Object.keys(confirmed.view)).not.toContain('mechanicalStateJson')
  expect(confirmed.state.entities.hero.attributes[`resource.${prepared.resource}`]).toBe(prepared.before)
  await page.reload()
  const finished = await page.evaluate(async fixture => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const result = await api.resumeTtrpgOpenPressureV1(fixture.command), state = await api.readProductRuntimeState(fixture.command.sessionId)
    await api.resumeTtrpgOpenPressureV1(fixture.command)
    return { result, state, repeated: await api.readProductRuntimeState(fixture.command.sessionId) }
  }, prepared)
  expect(finished.result).toEqual({ status: 'executing', nextStepKey: 'situations.2' })
  expect(finished.state.entities.hero.attributes[`resource.${prepared.resource}`]).toBe(prepared.before - 2)
  expect(finished.state.ttrpg.openRun.pressureCycles.find((c: any) => c.cycleKey === prepared.locator.cycleKey).work[0].completedRef).not.toBeNull()
  expect(finished.repeated).toEqual(finished.state)
})
