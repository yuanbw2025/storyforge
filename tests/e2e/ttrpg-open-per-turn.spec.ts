import { expect,test } from '@playwright/test'

/** Real isolated IndexedDB/API; no live provider or human acceptance claim. */
test('a first-turn consequence survives reload and changes the next turn before further time is paid',async ({ page }) => {
  test.setTimeout(90000)
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const x = await (await importer('/storyforge/tests/helpers/open-ttrpg-per-turn.ts')).setupPerTurnConsequenceFixtureV1()
    return { command: x.command,cycleKey: x.cycle.cycleKey,workKey: x.work.workKey,worldTurn: x.state.ttrpg.openRun.worldTime.worldTurn,sequence: x.state.lastSequence }
  })
  expect(f.worldTurn).toBe(1)
  await page.reload()
  const paid = await page.evaluate(async f => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-commands.ts'),{ operationInput } = await importer('/storyforge/tests/helpers/open-ttrpg-branch-recovery.ts')
    const { readProductRuntimeState } = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const locator = { ...f.command,cycleKey: f.cycleKey,workKey: f.workKey },request = { bindings: { actor: 'hero' },alternativeKey: null }
    const review = await api.prepareTtrpgOpenPressureEffectV1({ ...locator,request })
    await api.proposeTtrpgOpenPressureEffectV1({ ...await operationInput(locator.sessionId,locator.operationKey,`pressure.work.${locator.workKey}.${review.reviewKey}.propose`),...locator,request,riskHash: review.riskHash,reviewKey: review.reviewKey })
    for (const a of review.requiredApprovals.filter((a: any) => a.actorKey !== 'gm')) await api.confirmTtrpgOpenPressureEffectV1({ ...await operationInput(locator.sessionId,locator.operationKey,`pressure.work.${locator.workKey}.${review.reviewKey}.approval.${a.actorKey}`),...locator,riskHash: review.riskHash,reviewKey: review.reviewKey,actorKey: a.actorKey,decision: 'approve' })
    const input = { ...await operationInput(locator.sessionId,locator.operationKey,`pressure.work.${locator.workKey}.${review.reviewKey}.apply`),...locator,reviewKey: review.reviewKey }
    const applied = await api.applyTtrpgOpenPressureEffectV1(input),duplicate = await api.applyTtrpgOpenPressureEffectV1(input),state = await readProductRuntimeState(locator.sessionId)
    return { worldTurn: state.ttrpg.openRun.worldTime.worldTurn,conditions: state.ttrpg.product.conditions.hero,applied: applied.sequence,duplicate: duplicate.sequence }
  },f)
  expect(paid.worldTurn).toBe(1);expect(paid.conditions[0].duration).toBe(2);expect(paid.duplicate).toBe(paid.applied)
  await page.reload()
  const final = await page.evaluate(async f => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const { resumeTtrpgOpenPlayV1 } = await importer('/storyforge/src/lib/ttrpg/open-play-coordinator.ts'),api = await importer('/storyforge/src/lib/product/runtime-core.ts'),{ db } = await importer('/storyforge/src/lib/db/schema.ts')
    await resumeTtrpgOpenPlayV1(f.command)
    const state = await api.readProductRuntimeState(f.command.sessionId),row = await db.productRuntimeSessions.get(f.command.sessionId),events = await db.productRuntimeEvents.where('sessionId').equals(f.command.sessionId).sortBy('sequence')
    const replayed = api.replayProductRuntimeEvents(api.parseProductRuntimeState(row.initialStateJson),events)
    await resumeTtrpgOpenPlayV1(f.command)
    return { worldTurn: state.ttrpg.openRun.worldTime.worldTurn,clock: state.ttrpg.openRun.clocks.find((c: any) => c.clockKey === 'temporary.ability').value,
      paidTurns: events.filter((e: any) => e.type === 'ttrpg.world-turn.advanced').map((e: any) => JSON.parse(e.payloadJson).tickIndex),
      conditionBasis: state.ttrpg.openRun.operations[0].pressureTurnConditions.map((t: any) => (t.conditions.hero ?? []).length),
      replayMatches: JSON.stringify(replayed) === JSON.stringify(state),repeatMatches: JSON.stringify(await api.readProductRuntimeState(f.command.sessionId)) === JSON.stringify(state) }
  },f)
  expect(final).toEqual({ worldTurn: 3,clock: 1,paidTurns: [1,2,3],conditionBasis: [0,1,0],replayMatches: true,repeatMatches: true })
})
