import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import * as contracts from '../../src/lib/agent/run/contract'
import { appendAgentRunEventV1, createAgentRunV1, readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { buildReadOnlyAgentRunContractV1 } from '../../src/lib/agent/run/read-only-durable'
import { scopeTransactionTables } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => { vi.restoreAllMocks(); db.close() })

async function fixture() {
  const { scope } = await seedCurrentWorkspace('Native readonly Run proof snapshot')
  const snapshot = await createAgentRunV1({ scope, contract: buildReadOnlyAgentRunContractV1({
    projectId: scope.projectId, worldGroupId: null, goal: 'ENGINEERING ledger integrity only; no inference or author adoption', runtimeBindingHash: 'a'.repeat(64),
  }) })
  return { scope, runId: snapshot.run.id }
}
const tables = () => scopeTransactionTables(db.agentRuns, db.agentRunEvents)

describe('verified Work Run reuse belongs only to an unchanged native readonly snapshot', () => {
  it('fully verifies once within the same native read snapshot and returns independent complete values to sequential and concurrent consumers', async () => {
    const s = await fixture(), original = await readAgentRunV1(s.scope, s.runId), parse = vi.spyOn(contracts, 'acceptAgentRunContract')
    await db.transaction('r', tables(), async () => {
      expect(Dexie.currentTransaction!.idbtrans.mode).toBe('readonly')
      const first = await readAgentRunV1(s.scope, s.runId)
      expect(first).toEqual(original)
      first.run.contractJson = '{caller-local-change'
      first.contract.objective = 'caller-local-change'
      first.events[0].createdAt += 1
      first.projection.errors.push('caller-local-change')
      const second = await readAgentRunV1(s.scope, s.runId)
      expect(second).toEqual(original)
      const left = await readAgentRunV1(s.scope, s.runId), right = await readAgentRunV1(s.scope, s.runId)
      expect(left).toEqual(original); expect(right).toEqual(original)
      expect(left).not.toBe(right); expect(left.contract).not.toBe(right.contract); expect(left.events).not.toBe(right.events)
      left.contract.scope.projectId += 1
      expect(right.contract.scope.projectId).toBe(s.scope.projectId)
      expect(parse).toHaveBeenCalledOnce()
      const [parallelLeft, parallelRight] = await Promise.all([readAgentRunV1(s.scope, s.runId), readAgentRunV1(s.scope, s.runId)])
      expect(parallelLeft).toEqual(original); expect(parallelRight).toEqual(original)
      expect(parallelLeft.contract).not.toBe(parallelRight.contract)
      expect(parse).toHaveBeenCalledOnce()
    })
    expect(await readAgentRunV1(s.scope, s.runId)).toEqual(original)
    expect(parse).toHaveBeenCalledTimes(2)
  })

  it('replays again in a new native transaction and observes a real subsequently appended event', async () => {
    const s = await fixture(), parse = vi.spyOn(contracts, 'acceptAgentRunContract')
    const first = await readAgentRunV1(s.scope, s.runId), second = await readAgentRunV1(s.scope, s.runId)
    expect(first).toEqual(second); expect(parse).toHaveBeenCalledTimes(2)
    await appendAgentRunEventV1({ ...s, type: 'step.scheduled', payload: { stepId: 'snapshot.observation' }, expectedLastSequence: second.projection.lastSequence })
    const fresh = await readAgentRunV1(s.scope, s.runId)
    expect(fresh.projection.lastSequence).toBe(second.projection.lastSequence + 1)
    expect(fresh.events.at(-1)!.type).toBe('step.scheduled')
    expect(fresh.projection.steps['snapshot.observation'].status).toBe('scheduled')
  })

  it.each(['contract', 'event', 'projection', 'columns'] as const)('refuses %s corruption in a later native snapshot instead of retaining old success', async kind => {
    const s = await fixture()
    await db.transaction('r', tables(), async () => {
      await readAgentRunV1(s.scope, s.runId); await readAgentRunV1(s.scope, s.runId)
    })
    if (kind === 'contract') await db.agentRuns.update(s.runId, { contractJson: '{broken' })
    if (kind === 'projection') await db.agentRuns.update(s.runId, { projectionJson: '{}' })
    if (kind === 'columns') await db.agentRuns.update(s.runId, { status: 'paused' })
    if (kind === 'event') {
      const event = (await db.agentRunEvents.where('runId').equals(s.runId).first())!
      await db.agentRunEvents.update(event.id!, { payloadJson: '{broken' })
    }
    await expect(readAgentRunV1(s.scope, s.runId)).rejects.toThrow(/agent-run:/)
  })

  it('does not reuse a readonly Dexie child whose actual native transaction is writable', async () => {
    const s = await fixture(), original = await readAgentRunV1(s.scope, s.runId)
    await expect(db.transaction('rw', tables(), async () => {
      expect(Dexie.currentTransaction!.idbtrans.mode).toBe('readwrite')
      await readAgentRunV1(s.scope, s.runId)
      // Deliberately inconsistent materialized state: the second nested read
      // must detect it, even though both use the same native transaction.
      await db.agentRuns.update(s.runId, { status: 'paused' })
      return readAgentRunV1(s.scope, s.runId)
    })).rejects.toThrow(/projection_columns/)
    expect(await readAgentRunV1(s.scope, s.runId)).toEqual(original)
  })

  it('checks the current Work owner on every read before any snapshot reuse', async () => {
    const owner = await fixture(), other = await fixture()
    await expect(db.transaction('r', tables(), async () => {
      await readAgentRunV1(owner.scope, owner.runId)
      return readAgentRunV1(other.scope, owner.runId)
    })).rejects.toThrow(/agent-run:scope/)
  })
})
