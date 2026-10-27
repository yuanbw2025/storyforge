import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupCommonOracleDeskV1 } from '../helpers/open-common-oracle-desk'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { requestTtrpgOpenCommonOracleDeskV1,readTtrpgOpenCommonOracleDeskV1 } from '../../src/lib/ttrpg/open-common-oracle-desk'
import * as window from '../../src/lib/ttrpg/open-common-oracle-window'
import { parseTtrpgOpenCommonOracleRequestBasisV1,hashTtrpgOpenCommonOracleRequestBasisV1 } from '../../src/lib/ttrpg/open-common-oracle-request'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'

describe('R-TTRPGOPEN14 versioned complete common-fact input budgets',{ timeout: 120000 },() => {
  beforeEach(async () => { await db.delete();await db.open() });afterEach(() => { vi.restoreAllMocks();db.close() })
  it('lets the normal desk use the frozen work and model allowance without silently shrinking the request to legacy16k',async () => {
    const s = await setupCommonOracleDeskV1(),before = await readProductRuntimeState(s.f.sessionId),original = window.startTtrpgOpenCommonOracleWindowV1
    let internalFailure: Error | null = null
    const observe = vi.spyOn(window,'startTtrpgOpenCommonOracleWindowV1').mockImplementation(async input => {
      try { return await original(input) } catch (error) { internalFailure = error as Error;throw error }
    })
    const runAI = vi.fn(async () => s.output)
    let result: Awaited<ReturnType<typeof requestTtrpgOpenCommonOracleDeskV1>> | null = null
    try { result = await requestTtrpgOpenCommonOracleDeskV1({ ...s.command,runAI }) } catch { /* The real UI must continue hiding private internal causes. */ }
    expect(internalFailure === null ? null : (internalFailure as Error).message,'actual authorization failure hidden by the public UI').toBeNull()
    expect(result).toBeTruthy();expect(observe).toHaveBeenCalledOnce();expect(runAI).toHaveBeenCalledOnce()
    const state = await readProductRuntimeState(s.f.sessionId),epoch = state.ttrpg!.openRun!.coordination.epochs.find(e => e.commonOracle)!,basis = epoch.commonOracle!.basis
    expect(basis.version).toBe(2);expect(basis.budget.maximumInputTokens).toBeGreaterThan(18000)
    expect(basis.budget.maximumInputTokens+basis.budget.maximumOutputTokens).toBeLessThanOrEqual(before.ttrpg!.epochBudget.maximumTokens)
    expect(basis.budget.maximumInputTokens+basis.budget.maximumOutputTokens).toBeLessThanOrEqual(32000)
    expect(epoch.budget.maximumCalls).toBe(1);expect(epoch.budget.maximumAiActions).toBe(0)
    expect((await readTtrpgOpenCommonOracleDeskV1({ ...s.owner,requestKey: result!.requestKey }))!.request!.candidate).toBeTruthy()
    expect(state.entities).toEqual(before.entities);expect(state.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect(state.ttrpg!.openRun!.factLedger?.entries ?? []).toEqual([])
    const repeated = await original(observe.mock.calls[0][0])
    expect(repeated.requestKey).toBe(result!.requestKey);expect(await db.agentRuns.count()).toBe(1)
    await expect(original({ ...observe.mock.calls[0][0],basisVersion: 1 })).rejects.toThrow(/其他输入|不能挪用/)
    const legacy = { ...basis,version: 1 as const,budget: { ...basis.budget,maximumInputTokens: 16000 } }
    expect(parseTtrpgOpenCommonOracleRequestBasisV1(legacy)).toEqual(legacy)
    expect(await hashTtrpgOpenCommonOracleRequestBasisV1(legacy)).toBe(await hashCanonicalValue(legacy))
    expect(() => parseTtrpgOpenCommonOracleRequestBasisV1({ ...legacy,budget: { ...legacy.budget,maximumInputTokens: 16001 } })).toThrow()
    expect(await hashTtrpgOpenCommonOracleRequestBasisV1({ ...legacy,version: 2 })).not.toBe(await hashTtrpgOpenCommonOracleRequestBasisV1(legacy))
    expect(() => parseTtrpgOpenCommonOracleRequestBasisV1({ ...basis,budget: { ...basis.budget,maximumInputTokens: 1_000_001 } })).toThrow()
    expect(() => parseTtrpgOpenCommonOracleRequestBasisV1({ ...basis,version: 3 })).toThrow()
  })
  it('rejects a version2 input/output total above the actual frozen work budget before creating a Run or domain window',async () => {
    const s = await setupCommonOracleDeskV1(),before = await readProductRuntimeState(s.f.sessionId),count = await db.productRuntimeEvents.count()
    await expect(window.startTtrpgOpenCommonOracleWindowV1({ ...await openEnvelopeV1(s.f.sessionId,'common.budget.overflow'),...s.owner,
      oracleSourceRef: s.selected.oracleSourceRef,oracleInputHash: s.selected.contentHash,snapshotHash: s.selected.snapshotHash,
      decision: s.command.decision,modelIdentity: { provider: 'test-adapter',model: 'injected' },basisVersion: 2,
      maximumInputTokens: before.ttrpg!.epochBudget.maximumTokens,maximumOutputTokens: 1000,maximumCostUsd: 0.1 })).rejects.toThrow(/预算/)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before);expect(await db.productRuntimeEvents.count()).toBe(count);expect(await db.agentRuns.count()).toBe(0)
  })
})
