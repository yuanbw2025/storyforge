import { expect, test } from '@playwright/test'

/** Internal API evidence in real IndexedDB. No public open player is asserted. */
test('open authority: real IndexedDB reload, two-tab epoch race and pure replay', async ({ page, context }) => {
  await page.goto('./')
  const fixture = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { readyOpenTtrpgSessionV1, OPEN_HUMAN_VIEWER } = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const { readProductRuntimeStateVersion, readProductRuntimeState } = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const created = await readyOpenTtrpgSessionV1('浏览器 open 授权地基')
    const state = await readProductRuntimeState(created.sessionId)
    const version = await readProductRuntimeStateVersion(created.sessionId)
    return { sessionId: created.sessionId, viewerKey: OPEN_HUMAN_VIEWER,
      sessionKey: state.ttrpg.sessionKey, authorization: state.ttrpg.authorization,
      baseSequence: version.sequence, baseStateHash: version.stateHash }
  })
  expect(fixture.authorization.completedBySeatKey).toBe('seat.hero')
  expect(fixture.authorization.approvalBindings).toHaveLength(2)
  expect(fixture.authorization.sourceRef).toEqual({ sessionKey: fixture.sessionKey, sequence: fixture.authorization.revision })
  const other = await context.newPage()
  await other.goto('./')
  const startInTab = (tab: typeof page, commandId: string) => tab.evaluate(async input => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { startTtrpgOpenEpochV1 } = await importer('/storyforge/src/lib/ttrpg/runtime-commands.ts')
    try {
      const event = await startTtrpgOpenEpochV1(input)
      return { accepted: true, sequence: event.sequence, error: '' }
    } catch (error) { return { accepted: false, sequence: null, error: String(error) } }
  }, { ...fixture, commandId, triggerKind: 'submit-action', rawInput: '检查灯塔的门锁' })
  const results = await Promise.all([startInTab(page, 'browser.epoch.a'), startInTab(other, 'browser.epoch.b')])
  expect(results.filter(result => result.accepted)).toHaveLength(1)
  expect(results.find(result => !result.accepted)!.error).toMatch(/状态已变化|active epoch/)
  await other.close()
  const readEvidence = () => page.evaluate(async sessionId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const { readProductRuntimeState, replayProductRuntimeEvents, parseProductRuntimeState } = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const state = await readProductRuntimeState(sessionId)
    const session = await db.productRuntimeSessions.get(sessionId)
    const events = await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence')
    return { state, head: JSON.parse(session.runtimeHeadStateJson),
      replay: replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events),
      eventCount: events.length }
  }, fixture.sessionId)
  const before = await readEvidence()
  expect(before.state).toEqual(before.replay)
  expect(before.state).toEqual(before.head)
  expect(before.state.ttrpg.openRun.coordination.epochs).toHaveLength(1)
  expect(before.state.ttrpg.openRun.worldTime.worldTurn).toBe(0)
  await page.reload()
  expect(await readEvidence()).toEqual(before)
  const closed = await page.evaluate(async input => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { openEnvelopeV1 } = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const { closeTtrpgOpenEpochV1, advanceTtrpgWorldTurnV1, changeTtrpgSafetyStatus, recordTtrpgOpenFailureV1 } = await importer('/storyforge/src/lib/ttrpg/runtime-commands.ts')
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(input.sessionId, 'browser.pause'),
      status: 'paused', reason: '真人请求暂停', changedBy: 'seat.hero', viewerKey: input.viewerKey })
    let rejectedAiResume = ''
    try { await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(input.sessionId, 'browser.ai.resume'),
      status: 'active', changedBy: 'gm', viewerKey: 'viewer.gm' }) }
    catch (error) { rejectedAiResume = String(error) }
    await recordTtrpgOpenFailureV1({ ...await openEnvelopeV1(input.sessionId, 'browser.pause.diagnostic'),
      category: 'gate-failed', violatedRule: '暂停时记录诊断', failureKey: 'browser.failure' })
    const event = await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(input.sessionId, 'browser.close'),
      epochKey: input.epochKey, viewerKey: input.viewerKey, reason: '明确取消，未执行游戏行动' })
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(input.sessionId, 'browser.resume'),
      status: 'active', changedBy: 'seat.hero', viewerKey: input.viewerKey })
    let rejectedTick = ''
    try { await advanceTtrpgWorldTurnV1({ ...await openEnvelopeV1(input.sessionId, 'browser.free.tick'), reason: 'game-action' }) }
    catch (error) { rejectedTick = String(error) }
    return { sequence: event.sequence, rejectedTick, rejectedAiResume }
  }, { sessionId: fixture.sessionId, viewerKey: fixture.viewerKey,
    epochKey: before.state.ttrpg.openRun.coordination.activeEpochKey })
  expect(closed.rejectedTick).toMatch(/operation/)
  expect(closed.rejectedAiResume).toMatch(/真人主持授权/)
  const after = await readEvidence()
  expect(after.eventCount).toBe(before.eventCount + 4)
  expect(after.state).toEqual(after.replay)
  expect(after.state).toEqual(after.head)
  expect(after.state.ttrpg.sessionKey).toBe(fixture.sessionKey)
  expect(after.state.ttrpg.openRun.coordination.activeEpochKey).toBeNull()
  expect(after.state.ttrpg.openRun.coordination.epochs[0].closedRef.sequence).toBe(closed.sequence)
  expect(after.state.clock).toBe(0)
  await page.reload()
  expect(await readEvidence()).toEqual(after)
})

test('open operation: causal effects and time resume after a real browser reload', async ({ page }) => {
  await page.goto('./')
  const fixture = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const helpers = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const created = await helpers.readyOpenTtrpgSessionV1('浏览器行动恢复')
    const sessionId = created.sessionId, viewerKey = helpers.OPEN_HUMAN_VIEWER
    await api.startTtrpgOpenEpochV1({ ...await helpers.openEnvelopeV1(sessionId, 'browser.op.epoch'), viewerKey,
      triggerKind: 'submit-action', rawInput: '完成冻结规则行动' })
    const action = created.runtimePackage.ttrpg.rulePack.content.actions[0]
    await api.startTtrpgOpenOperationV1({ ...await helpers.openEnvelopeV1(sessionId, 'browser.op.start'), viewerKey,
      request: { route: 'existing-action', ruleKey: action.key, actorKey: 'hero', targetKey: action.target === 'self' ? 'hero' : action.target === 'scene' ? null : 'keeper',
        controllerMode: 'human', effectBindings: {} } })
    const state = await api.readProductRuntimeState(sessionId), operation = state.ttrpg.openRun.operations[0]
    const stepInput = async (stepKey: string) => ({ ...await helpers.openEnvelopeV1(sessionId,
      await api.ttrpgOpenOperationCommandIdV1(state.ttrpg.sessionKey, operation.operationKey, stepKey)),
      operationKey: operation.operationKey, frozenPlanHash: operation.planHash, viewerKey })
    for (const required of operation.plan.requiredApprovals) await api.confirmTtrpgOpenOperationV1({
      ...await stepInput(`approval.${required.actorKey}`), actorKey: required.actorKey, riskHash: operation.riskHash, decision: 'approve' })
    const rule = await api.resolveTtrpgOpenOperationRuleV1(await stepInput('rule'))
    return { sessionId, viewerKey, operationKey: operation.operationKey, frozenPlanHash: operation.planHash, ruleSequence: rule.sequence }
  })
  await page.reload()
  const final = await page.evaluate(async input => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const resumed = await api.resumeTtrpgOpenOperationV1(input)
    const state = await api.readProductRuntimeState(input.sessionId)
    const session = await db.productRuntimeSessions.get(input.sessionId)
    const events = await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).sortBy('sequence')
    const count = events.length
    await api.resumeTtrpgOpenOperationV1(input)
    return { resumed, state, replay: api.replayProductRuntimeEvents(api.parseProductRuntimeState(session.initialStateJson), events),
      count, afterCount: await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).count(),
      ticks: events.filter((event: any) => event.type === 'ttrpg.world-turn.advanced').map((event: any) => JSON.parse(event.payloadJson)) }
  }, fixture)
  expect(final.resumed).toEqual({ status: 'awaiting-owner', nextStepKey: 'pressure' })
  expect(final.state).toEqual(final.replay)
  expect(final.state.clock).toBe(1)
  expect(final.state.ttrpg.scene).toBeNull()
  expect(final.state.ttrpg.round).toBe(0)
  expect(final.state.ttrpg.openRun.ruleReceipts).toHaveLength(1)
  expect(final.afterCount).toBe(final.count)
  expect(final.ticks).toHaveLength(1)
  expect(final.ticks[0].byEventSequence).toBe(fixture.ruleSequence)
})

test('open model journal: one two-tab send permit and unknown result survive reload without resend', async ({ page, context }) => {
  await page.goto('./')
  const fixture = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { preparedOpenTtrpgCallV1 } = await importer('/storyforge/tests/helpers/open-ttrpg-call.ts')
    const { openEnvelopeV1 } = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const call = await preparedOpenTtrpgCallV1()
    const event = await call.reserve()
    const requestKey = JSON.parse(event.payloadJson).call.requestKey
    return { sessionId: call.fixture.sessionId, requestKey, runId: call.snapshot().run.id,
      viewerKey: call.reservation.viewerKey, reservation: call.reservation,
      ...await openEnvelopeV1(call.fixture.sessionId, 'browser.call.dispatch') }
  })
  const other = await context.newPage()
  await other.goto('./')
  const dispatch = (tab: typeof page) => tab.evaluate(async input => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { dispatchTtrpgOpenModelCallV1 } = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const result = await dispatchTtrpgOpenModelCallV1(input)
    return { eventId: result.event.id, sendAuthorized: result.sendAuthorized }
  }, fixture)
  const results = await Promise.all([dispatch(page), dispatch(other)])
  expect(results.filter(result => result.sendAuthorized)).toHaveLength(1)
  expect(results[0].eventId).toBe(results[1].eventId)
  await other.close()
  await page.reload()
  const unknown = await page.evaluate(async input => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const { openEnvelopeV1 } = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const beforeCount = await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).count()
    const before = await api.readProductRuntimeState(input.sessionId)
    await api.readProductRuntimeState(input.sessionId)
    const readCount = await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).count()
    await api.finishTtrpgOpenModelCallV1({ ...input, ...await openEnvelopeV1(input.sessionId, 'browser.call.unknown'),
      status: 'unknown', responseArtifactHash: null,
      usage: { source: 'unknown', inputTokens: null, outputTokens: null, actualCostUsd: null }, terminalReason: 'interrupted-after-dispatch' })
    let rejectedResend = ''
    try { await api.reserveTtrpgOpenModelCallV1({ ...input.reservation, ...await openEnvelopeV1(input.sessionId, 'browser.call.new') }) }
    catch (error) { rejectedResend = String(error) }
    const state = await api.readProductRuntimeState(input.sessionId)
    return { beforeCount, readCount, beforeStatus: before.ttrpg.openRun.coordination.calls[0].status,
      state, rejectedResend, afterCount: await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).count() }
  }, fixture)
  expect(unknown.beforeStatus).toBe('dispatched')
  expect(unknown.beforeCount).toBe(unknown.readCount)
  expect(unknown.afterCount).toBe(unknown.beforeCount + 1)
  expect(unknown.rejectedResend).toMatch(/预算/)
  expect(unknown.state.ttrpg.openRun.coordination.calls[0].status).toBe('unknown')
  expect(unknown.state.ttrpg.openRun.coordination.epochs[0].actualCostUsd).toBeNull()
  await page.reload()
  const reloaded = await page.evaluate(async sessionId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { readProductRuntimeState } = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    return readProductRuntimeState(sessionId)
  }, fixture.sessionId)
  expect(reloaded).toEqual(unknown.state)
})
