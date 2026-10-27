import { afterEach,beforeEach,describe,it,expect,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedManualTableV1,firstManualRequestV1 } from '../helpers/open-ttrpg-manual'
import { proposeTtrpgOpenManualActionV1,readTtrpgOpenTableV1,resumeTtrpgOpenManualActionV1,confirmTtrpgOpenTableRiskV1,resumeTtrpgOpenTableV1,readTtrpgOpenManualActionCatalogV1,requestTtrpgOpenTableCandidateV1 } from '../../src/lib/ttrpg/open-table-service'
import { readProductRuntimeState,parseProductRuntimeState,replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import { rt } from '../helpers/open-ttrpg-branch-recovery'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'
import { startTtrpgOpenOperationV1,startTtrpgOpenEpochV1 } from '../../src/lib/ttrpg/runtime-commands'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { stableProductRuntimeJsonV1 } from '../../src/lib/product/runtime-values'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { parseTtrpgOpenEpochV1 } from '../../src/lib/ttrpg/open-coordination'
import { resolveTtrpgOpenDiscoveryRecipientsV1 } from '../../src/lib/ttrpg/open-knowledge-discovery'
import type { AIConfig } from '../../src/lib/types'

describe('R-TTRPGOPEN3 durable human rule proposals', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete();await db.open() });afterEach(() => { vi.restoreAllMocks();db.close() })
  it.each(['existing-action','generic-check'] as const)('proposes %s without AI consent, waits for risk approval and settles through the same kernel', async route => {
    const x = await seedManualTableV1(),{ request } = firstManualRequestV1(x.catalog,route),before = await readProductRuntimeState(x.f.sessionId)
    expect((await readTtrpgOpenTableV1(x.input)).player!.aiAllowed).toBe(false)
    const input = { ...x.input,request,rawInput: '我明确按冻结规则调查现场',basisHash: x.catalog.basisHash,submissionKey: 'manual.first' }
    const proposed = await proposeTtrpgOpenManualActionV1(input)
    expect(await proposeTtrpgOpenManualActionV1(input)).toEqual(proposed)
    const pending = await readTtrpgOpenTableV1(x.input),op = pending.player!.operation!
    expect(op.status).toBe('awaiting-approval');expect((await readProductRuntimeState(x.f.sessionId)).entities).toEqual(before.entities)
    for (const a of op.approvals) await confirmTtrpgOpenTableRiskV1({ ...x.input,operationKey: op.operationKey,riskHash: op.riskHash,actorKey: a.actorKey,decision: 'approve' })
    await resumeTtrpgOpenTableV1({ ...x.input,operationKey: op.operationKey })
    const after = await readProductRuntimeState(x.f.sessionId)
    expect(rt(after).openRun!.worldTime.worldTurn).toBeGreaterThan(0)
    expect(rt(after).openRun!.coordination.calls).toEqual([])
    expect(rt(after).openRun!.coordination.epochs).toHaveLength(1)
    expect(await proposeTtrpgOpenManualActionV1(input)).toMatchObject({ operationKey: proposed.operationKey })
    expect((await readProductRuntimeState(x.f.sessionId)).entities).toEqual(after.entities)
    const row = (await db.productRuntimeSessions.get(x.f.sessionId))!
    expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson),await db.productRuntimeEvents.where('sessionId').equals(x.f.sessionId).sortBy('sequence'))).toEqual(after)
  })
  it('leaves a recoverable exact request after epoch commit and recovers it across a full backup without duplicate authorization', async () => {
    const x = await seedManualTableV1(),{ request } = firstManualRequestV1(x.catalog),input = { ...x.input,request,rawInput: '人工行动半提交恢复',basisHash: x.catalog.basisHash,submissionKey: 'manual.interruption' }
    const add = db.productRuntimeEvents.add.bind(db.productRuntimeEvents)
    vi.spyOn(db.productRuntimeEvents,'add').mockImplementationOnce((...args: Parameters<typeof add>) => add(...args)).mockRejectedValueOnce(new Error('manual operation store unavailable'))
    await expect(proposeTtrpgOpenManualActionV1(input)).rejects.toThrow('manual operation store unavailable')
    vi.restoreAllMocks()
    const before = await readProductRuntimeState(x.f.sessionId),pending = (await readTtrpgOpenTableV1(x.input)).player!.manualActionPending!
    expect(pending).not.toBeNull();expect(rt(before).openRun!.operations).toEqual([])
    const projectId = await importProjectJSON(await exportProjectJSON(x.f.scope.projectId)),copy = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const restored = { scope: { projectId,worldId: copy.worldId,workId: copy.workId },sessionId: copy.id!,viewerKey: x.input.viewerKey,epochKey: pending.epochKey }
    const receipt = await resumeTtrpgOpenManualActionV1(restored)
    expect(await resumeTtrpgOpenManualActionV1(restored)).toEqual(receipt)
    const state = rt(await readProductRuntimeState(copy.id!))
    expect(state.openRun!.coordination.epochs).toHaveLength(1);expect(state.openRun!.operations).toHaveLength(1)
    expect(state.openRun!.operations[0].plan.request).toEqual(request)
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
  })
  it('rejects stale catalogs, forbidden targets, forged bindings and another actor before persisting any authority', async () => {
    const x = await seedManualTableV1(),{ request } = firstManualRequestV1(x.catalog,'generic-check'),before = await readProductRuntimeState(x.f.sessionId)
    for (const patch of [ { basisHash: 'f'.repeat(64) },{ request: { ...request,targetKey: 'unknown.secret' } },{ request: { ...request,actorKey: 'companion.1' } },{ request: { ...request,effectBindings: {} } } ]) {
      await expect(proposeTtrpgOpenManualActionV1({ ...x.input,request,rawInput: '非法请求必须零写入',basisHash: x.catalog.basisHash,submissionKey: crypto.randomUUID(),...patch })).rejects.toThrow()
      expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
    }
    expect((await readTtrpgOpenManualActionCatalogV1(x.input)).basisHash).toBe(x.catalog.basisHash)
  })
  it('does not permit a second or changed request under the frozen manual window', async () => {
    const x = await seedManualTableV1(),{ request } = firstManualRequestV1(x.catalog)
    await proposeTtrpgOpenManualActionV1({ ...x.input,request,rawInput: '仅此一次',basisHash: x.catalog.basisHash,submissionKey: 'manual.frozen' })
    const before = await readProductRuntimeState(x.f.sessionId)
    await expect(startTtrpgOpenOperationV1({ ...await openEnvelopeV1(x.f.sessionId,'another.manual.request'),viewerKey: x.input.viewerKey,request })).rejects.toThrow()
    await expect(proposeTtrpgOpenManualActionV1({ ...x.input,request,rawInput: '偷偷替换了说明',basisHash: x.catalog.basisHash,submissionKey: 'manual.frozen' })).rejects.toThrow(/绑定另一项/)
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
  })
  it('keeps a half-submitted manual request exact and denies another viewer or a model action request', async () => {
    const x = await seedManualTableV1(),{ request } = firstManualRequestV1(x.catalog),add = db.productRuntimeEvents.add.bind(db.productRuntimeEvents)
    vi.spyOn(db.productRuntimeEvents,'add').mockImplementationOnce((...args: Parameters<typeof add>) => add(...args)).mockRejectedValueOnce(new Error('manual cut'))
    await expect(proposeTtrpgOpenManualActionV1({ ...x.input,request,rawInput: '人工授权只供原请求',basisHash: x.catalog.basisHash,submissionKey: 'manual.cut' })).rejects.toThrow()
    vi.restoreAllMocks()
    const before = await readProductRuntimeState(x.f.sessionId),epochKey = rt(before).openRun!.coordination.activeEpochKey!
    await expect(startTtrpgOpenOperationV1({ ...await openEnvelopeV1(x.f.sessionId,'changed.manual.request'),viewerKey: x.input.viewerKey,request: { ...request,targetKey: 'unknown.target' } })).rejects.toThrow(/替换/)
    await expect(resumeTtrpgOpenManualActionV1({ ...x.host,epochKey })).rejects.toThrow()
    await expect(requestTtrpgOpenTableCandidateV1({ ...x.input,purpose: 'intent',rawInput: '不能挪用人工授权',aiConfig: {} as AIConfig,maximumCostUsd: 0 })).rejects.toThrow(/人工行动/)
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
    expect(rt(before).openRun!.coordination.calls).toEqual([])
  })
  it('checks manual hashes and ownership in the core before saving an epoch and preserves absent legacy metadata', async () => {
    const x = await seedManualTableV1(),{ request } = firstManualRequestV1(x.catalog),before = await readProductRuntimeState(x.f.sessionId)
    const requestJson = stableProductRuntimeJsonV1(request)
    await expect(startTtrpgOpenEpochV1({ ...await openEnvelopeV1(x.f.sessionId,'bad.manual.hash'),viewerKey: x.input.viewerKey,triggerKind: 'submit-action',rawInput: '拒绝坏 hash',manualAction: { requestJson,requestHash: 'f'.repeat(64) } })).rejects.toThrow(/hash/)
    const foreign = { ...request,actorKey: 'companion.1' }
    await expect(startTtrpgOpenEpochV1({ ...await openEnvelopeV1(x.f.sessionId,'foreign.manual.actor'),viewerKey: x.input.viewerKey,triggerKind: 'submit-action',rawInput: '拒绝代替别人授权',manualAction: { requestJson: stableProductRuntimeJsonV1(foreign),requestHash: await hashProductProductionValueV2(foreign) } })).rejects.toThrow(/本人/)
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
    await proposeTtrpgOpenManualActionV1({ ...x.input,request,rawInput: '合法人工请求',basisHash: x.catalog.basisHash,submissionKey: 'manual.legacy.shape' })
    const epoch = structuredClone(rt(await readProductRuntimeState(x.f.sessionId)).openRun!.coordination.epochs[0]);delete epoch.manualAction
    expect(parseTtrpgOpenEpochV1(epoch)).not.toHaveProperty('manualAction')
  })
  it('resolves broad empty audiences at the discovery boundary without expanding explicit or private recipients', () => {
    const party = ['hero','companion.1']
    expect(resolveTtrpgOpenDiscoveryRecipientsV1({ allowedAudience: 'party',recipientActorKeys: [] },party)).toEqual(party)
    expect(resolveTtrpgOpenDiscoveryRecipientsV1({ allowedAudience: 'public',recipientActorKeys: [] },party)).toEqual(party)
    expect(resolveTtrpgOpenDiscoveryRecipientsV1({ allowedAudience: 'private',recipientActorKeys: [] },party)).toEqual([])
    expect(resolveTtrpgOpenDiscoveryRecipientsV1({ allowedAudience: 'party',recipientActorKeys: ['hero'] },party)).toEqual(['hero'])
  })
})
