import { expect, test } from '@playwright/test'

/** Native isolated IndexedDB/API exercise, not public-player UI or real-model acceptance. */
test('Oracle survives reload with the original result, enforces quota and preserves the qualified parent result on a child', async ({ page }) => {
  await page.goto('./')
  const first = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const commands = await importer('/storyforge/src/lib/ttrpg/runtime-commands.ts')
    const core = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const fixture = await helper.readyOpenTtrpgSessionV1('isolated browser Oracle')
    await commands.startTtrpgOpenEpochV1({ ...await helper.openEnvelopeV1(fixture.sessionId, 'browser.epoch'),
      viewerKey: helper.OPEN_HUMAN_VIEWER, triggerKind: 'submit-action', rawInput: '问问码头的天气' })
    const input = { ...await helper.openEnvelopeV1(fixture.sessionId, 'browser.oracle.one'), viewerKey: helper.OPEN_HUMAN_VIEWER,
      askedBy: 'player:hero', oracleKey: 'oracle.yes', question: '今天码头会下雨吗？', likelihoodTierKey: 'even' }
    return { sessionId: fixture.sessionId, input, event: await commands.consultTtrpgOracleV1(input), state: await core.readProductRuntimeState(fixture.sessionId) }
  })
  await page.reload()
  const repeated = await page.evaluate(async fixture => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const commands = await importer('/storyforge/src/lib/ttrpg/runtime-commands.ts')
    const core = await importer('/storyforge/src/lib/product/runtime-core.ts')
    return { event: await commands.consultTtrpgOracleV1(fixture.input), state: await core.readProductRuntimeState(fixture.sessionId) }
  }, first)
  expect(repeated).toEqual({ event: first.event, state: first.state })
  const child = await page.evaluate(async fixture => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const commands = await importer('/storyforge/src/lib/ttrpg/runtime-commands.ts')
    const core = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const child = await core.branchProductRuntimeSession({ parentSessionId: fixture.sessionId,
      throughSequence: fixture.state.lastSequence, title: 'Oracle native child', seed: 'child.browser.oracle' })
    const state = await core.readProductRuntimeState(child.id)
    await commands.completeTtrpgOpenSessionZeroV1({ ...await helper.openEnvelopeV1(child.id, 'child.zero'),
      viewerKey: helper.OPEN_HUMAN_VIEWER, acceptedItemKeys: state.ttrpg.product.sessionZero.requiredItemKeys,
      selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
    await commands.startTtrpgOpenEpochV1({ ...await helper.openEnvelopeV1(child.id, 'child.epoch'),
      viewerKey: helper.OPEN_HUMAN_VIEWER, triggerKind: 'continue-host', rawInput: '子分支继续咨询' })
    await commands.consultTtrpgOracleV1({ ...fixture.input, ...await helper.openEnvelopeV1(child.id, 'child.roll') })
    let blocked = ''
    try { await commands.consultTtrpgOracleV1({ ...fixture.input, ...await helper.openEnvelopeV1(child.id, 'child.extra') }) }
    catch (error) { blocked = String(error) }
    return { sessionId: child.id, state: await core.readProductRuntimeState(child.id), parent: await core.readProductRuntimeState(fixture.sessionId), blocked }
  }, first)
  expect(child.blocked).toContain('最多咨询两次')
  expect(child.parent).toEqual(first.state)
  expect(child.state.ttrpg.openRun.worldTime.worldTurn).toBe(0)
  expect(child.state.ttrpg.openRun.oracleReceipts[0]).toEqual(first.state.ttrpg.openRun.oracleReceipts[0])
  expect(child.state.ttrpg.openRun.oracleReceipts[1].previousOracleRef).toEqual(child.state.ttrpg.openRun.oracleReceipts[0].sourceRef)
  await page.reload()
  const restored = await page.evaluate(async sessionId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    return (await importer('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(sessionId)
  }, child.sessionId)
  expect(restored).toEqual(child.state)
})
