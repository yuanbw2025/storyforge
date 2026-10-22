import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { startTtrpgOpenEpochV1, closeTtrpgOpenEpochV1, consultTtrpgOracleV1, startTtrpgOpenOperationV1,
  closeTtrpgOpenStageV1, recordTtrpgOpenHumanNarrationV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents, applyProductRuntimeEvent } from '../../src/lib/product/runtime-core'
import { prepareTtrpgOpenIntentInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { assertTtrpgOpenEpochPurposeV1, parseTtrpgOpenEpochV1 } from '../../src/lib/ttrpg/open-coordination'
import { setupChecksFixtureV1 } from '../helpers/open-ttrpg-checks'
import { resumeTtrpgOpenChecksV1 } from '../../src/lib/ttrpg/open-checks-coordinator'
import { resumeTtrpgOpenPlayV1 } from '../../src/lib/ttrpg/open-play-coordinator'
import { operationInput } from '../helpers/open-ttrpg-branch-recovery'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

const rawInput = '为当前共同阶段生成一份复盘候选'
async function setup(enabled = true) {
  const f = await readyOpenTtrpgSessionV1('Brief passive window', p => {
    p.ttrpg!.campaign.runtimePolicy.enabled = enabled
    p.ttrpg!.campaign.characterTemplates[1].controller = 'hybrid'
  })
  const input = { ...await openEnvelopeV1(f.sessionId, 'brief.epoch'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'request-brief' as const, rawInput }
  return { f, input }
}
describe('R-TTRPGOPEN8 explicit passive recap epoch', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it('records one exact human request, caps one model call and zero AI actions, replays and closes without gameplay changes', async () => {
    const { f, input } = await setup(), before = await readProductRuntimeState(f.sessionId)
    const event = await startTtrpgOpenEpochV1(input), after = await readProductRuntimeState(f.sessionId)
    expect((await startTtrpgOpenEpochV1(input)).id).toBe(event.id)
    const epoch = after.ttrpg!.openRun!.coordination.epochs[0]
    expect(epoch).toMatchObject({ triggerKind: 'request-brief', viewerKey: OPEN_HUMAN_VIEWER, budget: { maximumCalls: 1, maximumAiActions: 0 }, successfulActorKeys: [] })
    expect(after.entities).toEqual(before.entities)
    const { coordination: _a, ...gameplay } = after.ttrpg!.openRun!, { coordination: _b, ...original } = before.ttrpg!.openRun!
    expect(gameplay).toEqual(original); expect(await db.agentRuns.count()).toBe(0)
    const session = (await db.productRuntimeSessions.get(f.sessionId))!, events = await db.productRuntimeEvents.where('sessionId').equals(f.sessionId).sortBy('sequence')
    expect(replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events)).toEqual(after)
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId, 'brief.epoch.close'), viewerKey: OPEN_HUMAN_VIEWER, epochKey: epoch.epochKey, reason: '明确取消本次尚未派发的复盘' })
    expect((await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.coordination.activeEpochKey).toBeNull()
  })
  it('rejects a role action, Oracle and ordinary intent preparation under recap authority before any write or Run creation', async () => {
    const { f, input } = await setup(); await startTtrpgOpenEpochV1(input)
    const before = await readProductRuntimeState(f.sessionId), action = f.runtimePackage.ttrpg!.rulePack.content.actions[0]
    await expect(startTtrpgOpenOperationV1({ ...await openEnvelopeV1(f.sessionId, 'brief.cannot.act'), viewerKey: OPEN_HUMAN_VIEWER,
      request: { route: 'existing-action', actorKey: 'hero', controllerMode: 'human', ruleKey: action.key,
        targetKey: action.target === 'self' ? 'hero' : action.target === 'scene' ? null : 'keeper', effectBindings: {} } })).rejects.toThrow(/复盘/)
    await expect(consultTtrpgOracleV1({ ...await openEnvelopeV1(f.sessionId, 'brief.cannot.oracle'), viewerKey: OPEN_HUMAN_VIEWER,
      askedBy: 'player:hero', oracleKey: 'oracle.yes', question: '码头安全吗？', likelihoodTierKey: 'even' })).rejects.toThrow(/Oracle/)
    await expect(prepareTtrpgOpenIntentInputV1({ ...await openEnvelopeV1(f.sessionId, 'brief.cannot.intent'), viewerKey: OPEN_HUMAN_VIEWER,
      scope: f.scope, actorKey: 'hero', rawInput, modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 800, maximumCostUsd: 0.1 })).rejects.toThrow(/复盘窗口/)
    expect(await db.agentRuns.count()).toBe(0)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  })
  it('keeps purpose grants separate and rejects rehashed/forged action or budget authority in replay', async () => {
    const { f, input } = await setup(), before = await readProductRuntimeState(f.sessionId), event = await startTtrpgOpenEpochV1(input)
    const payload = JSON.parse(event.payloadJson), epoch = payload.epoch
    expect(() => assertTtrpgOpenEpochPurposeV1(epoch, 'prose.ttrpg-open-brief')).not.toThrow()
    expect(() => assertTtrpgOpenEpochPurposeV1(epoch, 'prose.ttrpg-open-kp')).toThrow()
    expect(() => assertTtrpgOpenEpochPurposeV1({ triggerKind: 'submit-action' }, 'prose.ttrpg-open-brief')).toThrow()
    expect(() => parseTtrpgOpenEpochV1({ ...epoch, budget: { ...epoch.budget, maximumCalls: 2 } })).toThrow()
    expect(() => parseTtrpgOpenEpochV1({ ...epoch, budget: { ...epoch.budget, maximumAiActions: 1 } })).toThrow()
    expect(() => parseTtrpgOpenEpochV1({ ...epoch, successfulActorKeys: ['hero'] })).toThrow()
    payload.epoch.budget.maximumCalls = 2
    expect(() => applyProductRuntimeEvent(before, { ...event, payloadJson: JSON.stringify(payload) })).toThrow()
  })
  it('refuses another player, disabled frozen AI and a second new window without changing the original authority', async () => {
    const { f, input } = await setup(), before = await readProductRuntimeState(f.sessionId)
    await expect(startTtrpgOpenEpochV1({ ...input, viewerKey: 'viewer.seat.companion.1' })).rejects.toThrow(/主持/)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
    await startTtrpgOpenEpochV1(input)
    const active = await readProductRuntimeState(f.sessionId)
    await expect(startTtrpgOpenEpochV1({ ...input, ...await openEnvelopeV1(f.sessionId, 'brief.second') })).rejects.toThrow(/active epoch/)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(active)
    const disabled = await setup(false)
    await expect(startTtrpgOpenEpochV1(disabled.input)).rejects.toThrow(/未允许模型复盘/)
  })
  it('opens a recap after the real stage and action finish, while preserving the closed stage and its history', async () => {
    const f = await setupChecksFixtureV1({ ai: true, closure: true }); await resumeTtrpgOpenChecksV1(f.command)
    await closeTtrpgOpenStageV1({ ...await operationInput(f.f.sessionId, f.command.operationKey, 'stage.close'), summary: '主持确认阶段收束' })
    await resumeTtrpgOpenPlayV1(f.command)
    await recordTtrpgOpenHumanNarrationV1({ ...await operationInput(f.f.sessionId, f.command.operationKey, 'narration'), reason: 'host-authored', text: '本阶段告一段落。' })
    await resumeTtrpgOpenPlayV1(f.command)
    const state = await readProductRuntimeState(f.f.sessionId)
    if (state.ttrpg!.openRun!.coordination.activeEpochKey) await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.f.sessionId, 'stage.action.close'), viewerKey: OPEN_HUMAN_VIEWER,
      epochKey: state.ttrpg!.openRun!.coordination.activeEpochKey!, reason: '本次阶段行动已完成' })
    const before = await readProductRuntimeState(f.f.sessionId)
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.f.sessionId, 'closed.stage.brief'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'request-brief', rawInput })
    const after = await readProductRuntimeState(f.f.sessionId)
    expect(after.ttrpg!.openRun!.stage).toEqual(before.ttrpg!.openRun!.stage)
    expect(after.ttrpg!.openRun!.stage.status).toBe('closed')
    expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
  })
  it('preserves the passive one-call contract across complete backup remapping', async () => {
    const { f, input } = await setup(); await startTtrpgOpenEpochV1(input)
    const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const epoch = (await readProductRuntimeState(session.id!)).ttrpg!.openRun!.coordination.epochs[0]
    expect(epoch).toMatchObject({ triggerKind: 'request-brief', budget: { maximumCalls: 1, maximumAiActions: 0 } })
    expect(() => assertTtrpgOpenEpochPurposeV1(epoch, 'prose.ttrpg-open-companion')).toThrow()
  })
})
