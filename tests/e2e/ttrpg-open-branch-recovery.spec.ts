import { expect, test } from '@playwright/test'

/** Real IndexedDB protocol evidence; no public author/AI playthrough is asserted. */
test('open child recovery survives reload, preserves parent result and completes only unconsumed ticks', async ({ page }) => {
  await page.goto('./')
  const fixture = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-branch-recovery.ts')
    const parent = await helper.parentAtCut('time.1')
    const child = await helper.forkAndStart(parent.sessionId)
    await helper.approve(child.sessionId, child.op.operationKey)
    return { parent, sessionId: child.sessionId, operationKey: child.op.operationKey,
      frozenPlanHash: child.op.planHash, markerSequence: child.marker.sequence,
      viewerKey: 'viewer.seat.hero', initialStateJson: child.child.initialStateJson }
  })
  await page.reload()
  const result = await page.evaluate(async input => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const { settleOpenPaidTurnsV1 } = await importer('/storyforge/tests/helpers/open-ttrpg-paid-turns.ts')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const resumed = await api.resumeTtrpgOpenOperationV1(input)
    const settled = await settleOpenPaidTurnsV1(input)
    await settleOpenPaidTurnsV1({ ...input.parent, viewerKey: input.viewerKey })
    const parent = await api.readProductRuntimeState(input.parent.sessionId), child = await api.readProductRuntimeState(input.sessionId)
    const events = await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).sortBy('sequence')
    const before = events.length
    await settleOpenPaidTurnsV1(input)
    return { resumed, settled, child, parent, eventCount: before,
      afterCount: await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).count(),
      replay: api.replayProductRuntimeEvents(api.parseProductRuntimeState(input.initialStateJson), events),
      ticks: events.filter((event: any) => event.type === 'ttrpg.world-turn.advanced').map((event: any) => JSON.parse(event.payloadJson)),
      rolls: events.filter((event: any) => event.type === 'ttrpg.rule.action.resolved').length }
  }, fixture)
  expect(result.resumed).toEqual({ status: 'awaiting-owner', nextStepKey: 'pressure.1' })
  expect(result.settled).toEqual({ status: 'executing', nextStepKey: 'terminal' })
  expect(result.child.ttrpg.openRun.operations[0].receipts.filter((r: any) => r.stepKey.startsWith('pressure.')).map((r: any) => r.stepKey)).toEqual(['pressure.1', 'pressure.2', 'pressure.3'])
  expect(result.child.entities).toEqual(result.parent.entities)
  expect(result.child.ttrpg.product.abilityStates).toEqual(result.parent.ttrpg.product.abilityStates)
  expect(result.child.ttrpg.openRun.worldTime.worldTurn).toBe(3)
  expect(result.rolls).toBe(0)
  expect(result.ticks).toHaveLength(2)
  expect(result.ticks.every((tick: any) => tick.causeRef.sequence === fixture.markerSequence)).toBe(true)
  expect(result.child).toEqual(result.replay)
  expect(result.afterCount).toBe(result.eventCount)
  await page.reload()
  const restored = await page.evaluate(async sessionId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    return (await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')).readProductRuntimeState(sessionId)
  }, fixture.sessionId)
  expect(restored).toEqual(result.child)
})
