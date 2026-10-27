import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { branchProductRuntimeSession, readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from '../../src/lib/ttrpg/open-runtime-contract'
import { parseTtrpgOpenSituationCycleV1 } from '../../src/lib/ttrpg/open-situation-cycle'
import { resumeTtrpgOpenChecksV1 } from '../../src/lib/ttrpg/open-checks-coordinator'
import { resumeTtrpgOpenSituationsV1 } from '../../src/lib/ttrpg/open-situation-coordinator'
import { setupChecksFixtureV1 } from '../helpers/open-ttrpg-checks'
import { setupMaintenanceFixtureV1 } from '../helpers/open-ttrpg-maintenance'

async function inherited(sessionId: number) {
  const parent = await readProductRuntimeState(sessionId)
  const child = await branchProductRuntimeSession({ parentSessionId: sessionId, throughSequence: parent.lastSequence,
    title: '精确祖先校验', seed: 'exact.history.seed' })
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(child.id!)).ttrpg)!
  expect(await readProductRuntimeState(sessionId)).toEqual(parent)
  return runtime
}
describe('R-TTRPGOPEN6 inherited evidence remains exact after comparison lookup', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('requires full original terminal/gate contents even when the source session and sequence match', async () => {
    const f = await setupChecksFixtureV1()
    await resumeTtrpgOpenChecksV1(f.command)
    const runtime = await inherited(f.command.sessionId)
    expect(runtime.openRun!.terminalReceipts).toHaveLength(1)
    expect(runtime.openRun!.gateReceipts).toHaveLength(1)
    expect(() => parseTtrpgRuntimeStateV2(runtime)).not.toThrow()
    const terminal = structuredClone(runtime)
    terminal.openRun!.terminalReceipts![0].decision.worldTurn += 1
    expect(terminal.openRun!.terminalReceipts![0].sourceRef).toEqual(runtime.openRun!.terminalReceipts![0].sourceRef)
    expect(() => parseTtrpgRuntimeStateV2(terminal)).toThrow(/终态\/门缺少实际祖先评估记录/)
    const gate = structuredClone(runtime)
    gate.openRun!.gateReceipts![0].evaluationBasisJson = JSON.stringify({ ...JSON.parse(gate.openRun!.gateReceipts![0].evaluationBasisJson), changed: true })
    expect(gate.openRun!.gateReceipts![0].sourceRef).toEqual(runtime.openRun!.gateReceipts![0].sourceRef)
    expect(() => parseTtrpgRuntimeStateV2(gate)).toThrow(/终态\/门缺少实际祖先评估记录/)
    expect(() => parseTtrpgRuntimeStateV2(runtime)).not.toThrow()
  })
  it('requires each carried cycle reference to exist within its real ancestor cutpoint', async () => {
    const f = await setupMaintenanceFixtureV1({ resolve: true })
    await resumeTtrpgOpenSituationsV1(f.command)
    const runtime = await inherited(f.command.sessionId)
    // The fixture retains its initial admission cycle and the later maintenance cycle.
    expect(runtime.openRun!.situationCycles).toHaveLength(2)
    expect(() => parseTtrpgRuntimeStateV2(runtime)).not.toThrow()
    const changed = structuredClone(runtime), ancestor = changed.branchLineage!.ancestors[0]
    const cycle = changed.openRun!.situationCycles!.find(c => c.maintenanceRefs.length > 0)!
    expect(cycle).toBeDefined()
    cycle.maintenanceRefs[0] = { sessionKey: ancestor.sessionKey, sequence: ancestor.throughSequence + 1 }
    expect(() => parseTtrpgOpenSituationCycleV1(cycle)).not.toThrow()
    expect(() => parseTtrpgRuntimeStateV2(changed)).toThrow(/局势周期缺少实际祖先依据/)
    expect(() => parseTtrpgRuntimeStateV2(runtime)).not.toThrow()
  })
})
