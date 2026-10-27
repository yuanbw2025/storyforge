import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { publicSituationOutputV1 } from '../helpers/open-public-situation-generation'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { readTtrpgOpenPublicSituationDeskV1, requestTtrpgOpenPublicSituationDeskV1, finalizeTtrpgOpenPublicSituationDeskV1,
  enableTtrpgOpenPublicSituationDeskV1, finishTtrpgOpenPublicSituationDeskV1 } from '../../src/lib/ttrpg/open-public-situation-desk'
import { readTtrpgOpenSituationDeskV1, requestTtrpgOpenSituationDeskV1 } from '../../src/lib/ttrpg/open-situation-desk-service'
import { loadTtrpgOpenPublicSituationKernelV1 } from '../../src/lib/ttrpg/open-public-situation-kernel'
import { readTtrpgOpenTableV1, readTtrpgOpenTableContextTraceV1 } from '../../src/lib/ttrpg/open-table-service'

async function setup() {
  const f = await readyOpenTtrpgSessionV1('Public desk actual workflow', p => {
    const c = p.ttrpg!.campaign; c.runtimePolicy.enabled = true; c.runtimePolicy.maximumEpochTokens = 50000; c.runtimePolicy.maximumOutputTokens = 8000
    c.fronts[0].goal = 'PRIVATE-DESK-FRONT'; c.characterTemplates.find(t => t.role === 'npc')!.gmProfile!.secret = 'PRIVATE-DESK-GM'
  })
  const input = { scope: f.scope, sessionId: f.sessionId, viewerKey: OPEN_HUMAN_VIEWER }, send = vi.fn(async () => {
    const run = (await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!, epoch = run.coordination.epochs.find(e => e.epochKey === run.coordination.activeEpochKey)!
    const kernel = await loadTtrpgOpenPublicSituationKernelV1({ ...input, actorKey: 'gm' }, epoch.publicSituation!)
    return JSON.stringify(publicSituationOutputV1(kernel))
  })
  const request = { ...input, submissionKey: 'explicit.public.desk', rawInput: '  给大家共享这一次的要求 e\u0301。\n', maximumCostUsd: 0.1,
    sharingDecision: 'share-this-request-with-current-party' as const, delegationDecision: 'adopt-this-one-candidate' as const, runAI: send }
  return { f, input, send, request }
}
describe('R-TTRPGOPEN10 explicit common desk workflow', { timeout: 180000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('has no fresh private fallback path and requires both decisions before any Run, epoch or paid call', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.input.sessionId)
    expect(await readTtrpgOpenSituationDeskV1(s.input)).toBeNull()
    expect(await readTtrpgOpenPublicSituationDeskV1(s.input)).toMatchObject({ canRequest: true, request: null, accepted: [] })
    expect(await readTtrpgOpenPublicSituationDeskV1(s.input)).toMatchObject({ canRequest: true })
    expect(await db.agentRuns.count()).toBe(0); expect(await readProductRuntimeState(s.input.sessionId)).toEqual(before)
    await expect(requestTtrpgOpenSituationDeskV1(s.request)).rejects.toThrow(/真人主持|共同资料/)
    for (const change of [{ sharingDecision: 'unchecked' }, { delegationDecision: 'unchecked' }]) {
      await expect(requestTtrpgOpenPublicSituationDeskV1({ ...s.request, ...change } as typeof s.request)).rejects.toThrow(/明确共享/)
    }
    expect(await db.agentRuns.count()).toBe(0); expect(await readProductRuntimeState(s.input.sessionId)).toEqual(before); expect(s.send).not.toHaveBeenCalled()
  })
  it('sends once, adopts with original delegation, closes without admitting, and exposes only safe player-host progress', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.input.sessionId)
    await requestTtrpgOpenPublicSituationDeskV1(s.request)
    const page = (await readTtrpgOpenPublicSituationDeskV1(s.input))!, state = await readProductRuntimeState(s.input.sessionId), receipt = state.ttrpg!.openRun!.situationReceipts![0]
    expect(page).toMatchObject({ adopted: true, currentWindow: false, receiptPending: false, canFinalize: false, canEnable: true, request: { status: 'succeeded', local: true } })
    expect(page.accepted).toHaveLength(1); expect(state.ttrpg!.openRun!.situations).toEqual(before.ttrpg!.openRun!.situations)
    expect(receipt.version).toBe(2)
    if (receipt.version === 2) expect(receipt.disclosure.authorization.basis.sharedRequest.text).toBe(s.request.rawInput)
    for (const hidden of ['PRIVATE-DESK-FRONT', 'PRIVATE-DESK-GM', receipt.template.driverGoal, receipt.template.evidence[0].description, 'originalText', 'runOriginJson', 'personalizationSourceKeys']) expect(JSON.stringify(page)).not.toContain(hidden)
    await finalizeTtrpgOpenPublicSituationDeskV1(s.input); expect(s.send).toHaveBeenCalledTimes(1)
    const count = await db.productRuntimeEvents.count(); await readTtrpgOpenPublicSituationDeskV1(s.input); expect(await db.productRuntimeEvents.count()).toBe(count)
    await expect(readTtrpgOpenTableContextTraceV1(s.input)).rejects.toThrow(/尚未公开/)
    const table = await readTtrpgOpenTableV1(s.input); expect(table.player!.requests).toEqual([])
    await enableTtrpgOpenPublicSituationDeskV1({ ...s.input, templateKey: receipt.template.templateKey, submissionKey: 'explicit.public.enable' })
    expect((await readTtrpgOpenPublicSituationDeskV1(s.input))!.accepted[0].status).toBe('active'); expect(s.send).toHaveBeenCalledTimes(1)
  })
  it('repairs an actual committed candidate terminal cut without another model call', async () => {
    const s = await setup(), add = db.agentRunEvents.add.bind(db.agentRunEvents)
    const spy = vi.spyOn(db.agentRunEvents, 'add').mockImplementation(async (...args) => { if (args[0].type === 'confirmation.recorded') throw new Error('public desk terminal cut'); return add(...args) })
    await expect(requestTtrpgOpenPublicSituationDeskV1(s.request)).rejects.toThrow()
    spy.mockRestore()
    expect(await readTtrpgOpenPublicSituationDeskV1(s.input)).toMatchObject({ adopted: true, receiptPending: true, currentWindow: true })
    await finishTtrpgOpenPublicSituationDeskV1(s.input)
    await finalizeTtrpgOpenPublicSituationDeskV1(s.input)
    expect(await readTtrpgOpenPublicSituationDeskV1(s.input)).toMatchObject({ adopted: true, receiptPending: false, currentWindow: false }); expect(s.send).toHaveBeenCalledTimes(1)
  })
  it('stops before adoption after the original response arrives and never auto-adopts on a later read', async () => {
    const s = await setup(), controller = new AbortController()
    await expect(requestTtrpgOpenPublicSituationDeskV1({ ...s.request, signal: controller.signal, runAI: async () => {
      const result = await s.send(); controller.abort(new Error('human stopped after original response')); return result
    } })).rejects.toThrow()
    await finishTtrpgOpenPublicSituationDeskV1(s.input)
    const page = await readTtrpgOpenPublicSituationDeskV1(s.input)
    expect(page).toMatchObject({ adopted: false, currentWindow: false, canFinalize: false })
    expect((await readProductRuntimeState(s.input.sessionId)).ttrpg!.openRun!.situationReceipts ?? []).toEqual([])
    await expect(finalizeTtrpgOpenPublicSituationDeskV1(s.input)).rejects.toThrow(); expect(s.send).toHaveBeenCalledTimes(1)
  })
})
