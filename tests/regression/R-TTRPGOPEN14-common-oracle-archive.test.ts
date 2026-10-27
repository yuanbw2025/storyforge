import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupCommonOracleModelV1 as setup } from '../helpers/open-common-oracle-model'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { prepareTtrpgOpenCommonOracleInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { generateTtrpgOpenCommonOracleCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { archiveTtrpgOpenUnresumableCommonOracleWindowV1 as archive } from '../../src/lib/ttrpg/open-common-oracle-archive'
import { TTRPG_OPEN_COMMON_ORACLE_ARCHIVE_DECISION_V1 as decision } from '../../src/lib/ttrpg/open-common-oracle-archive-contract'
import { changeTtrpgSafetyStatus, reviewTtrpgOpenCommonOracleCandidateV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState, branchProductRuntimeSession, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import * as archives from '../../src/lib/ttrpg/open-common-oracle-archive'
import * as adoption from '../../src/lib/ttrpg/open-oracle-adoption'
import { readTtrpgOpenCommonOracleRequestCloseOwnerV1 } from '../../src/lib/ttrpg/open-common-oracle-close'
import * as commands from '../../src/lib/ttrpg/runtime-commands'
import { assertTtrpgOpenOracleInterpretationSlotV1 } from '../../src/lib/ttrpg/open-model-calls'
import * as events from '../../src/lib/agent/run/event-store'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'

const output = JSON.stringify({ interpretation: '原共同解释保留。', facts: [] })
const request = (s: Awaited<ReturnType<typeof setup>>) => ({ ...s.owner, epochKey: s.grant.epochKey, requestKey: s.read.requestKey, decision })
async function copy(s: Awaited<ReturnType<typeof setup>>) {
  const projectId = await importProjectJSON(await exportProjectJSON(s.f.scope.projectId))
  const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
  const scope = await resolveScope({ scope: { projectId, worldId: session.worldId!, workId: session.workId! } })
  return { ...request(s), scope, sessionId: session.id! }
}
describe('R-TTRPGOPEN14 explicit human archival of unresumable common requests', { timeout: 120000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('rejects the real local Run and wrong human, then atomically archives an imported unsent request without touching either Run', async () => {
    const s = await setup(); await prepareTtrpgOpenCommonOracleInputV1(s.read)
    await expect(archive(request(s))).rejects.toThrow('当前不能归档')
    const copied = await copy(s), source = await events.readInstanceAgentRunV1(s.f.scope, s.read.runId)
    const runs = await db.agentRuns.toArray(), before = await readProductRuntimeState(copied.sessionId)
    await expect(archive({ ...copied, viewerKey: 'not-this-human' })).rejects.toThrow()
    const cut = vi.spyOn(db.productRuntimeEvents, 'add').mockRejectedValueOnce(new Error('COMMON-ARCHIVE-STORAGE-CUT'))
    await expect(archive(copied)).rejects.toThrow('当前不能归档'); expect(cut).toHaveBeenCalled(); cut.mockRestore()
    expect(await readProductRuntimeState(copied.sessionId)).toEqual(before)
    const saved = await archive(copied), after = await readProductRuntimeState(copied.sessionId), run = after.ttrpg!.openRun!
    expect(run.coordination.activeEpochKey).toBeNull(); expect(run.coordination.calls.at(-1)!.status).toBe('failed')
    expect(run.coordination.calls.at(-1)!.usage?.actualCostUsd).toBe(0)
    expect(run.coordination.epochs.at(-1)!.commonOracleArchive).toMatchObject({ producer: 'imported', observation: 'not-dispatched' })
    expect(await archive(copied)).toEqual(saved); expect(await readProductRuntimeState(copied.sessionId)).toEqual(after)
    expect(await db.agentRuns.toArray()).toEqual(runs); expect(await events.readInstanceAgentRunV1(s.f.scope, s.read.runId)).toEqual(source)
    expect(Object.keys(saved).sort()).toEqual(['epochKey', 'requestKey', 'sequence'])
  })
  it('uses the governed Run deletion lifecycle; paused orphaned unsent requests close with their original slot retained and survive backup', async () => {
    const s = await setup(); await prepareTtrpgOpenCommonOracleInputV1(s.read)
    await events.deleteAgentRunV1(s.f.scope, s.read.runId)
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.f.sessionId, 'common.archive.pause'), viewerKey: s.owner.viewerKey, changedBy: 'hero', status: 'paused', reason: '暂停时归档原记录缺失的请求' })
    await archive(request(s))
    const state = await readProductRuntimeState(s.f.sessionId), run = state.ttrpg!.openRun!, call = run.coordination.calls.at(-1)!
    expect(call.status).toBe('failed'); expect(call.commonOracle?.basisHash).toBe(s.grant.basisHash)
    expect(() => assertTtrpgOpenOracleInterpretationSlotV1(state.ttrpg!, s.grant.worldTurn)).toThrow('每个 worldTurn')
    expect(run.coordination.epochs.at(-1)!.commonOracleArchive?.producer).toBe('unavailable'); expect(await db.agentRuns.count()).toBe(0)
    const copied = await copy(s)
    expect((await readProductRuntimeState(copied.sessionId)).ttrpg!.openRun).toEqual(run)
  })
  it('preserves the actual retained answer after model.responded was interrupted, with no invented model or Run receipt', async () => {
    const s = await setup(), append = events.appendAgentRunEventV1
    const cut = vi.spyOn(events, 'appendAgentRunEventV1').mockImplementation(async input => { if (input.type === 'model.responded') throw new Error('COMMON-ARCHIVE-RAW-CUT'); return append(input) })
    await expect(generateTtrpgOpenCommonOracleCandidateV1({ ...s.read, runAI: async () => output })).rejects.toThrow('COMMON-ARCHIVE-RAW-CUT'); cut.mockRestore()
    const copied = await copy(s), beforeRuns = await db.agentRuns.toArray(), beforeEvents = await db.agentRunEvents.toArray()
    await archive(copied)
    const run = (await readProductRuntimeState(copied.sessionId)).ttrpg!.openRun!, call = run.coordination.calls.at(-1)!
    expect(call.status).toBe('succeeded'); expect(call.responseArtifactHash).toMatch(/^[a-f0-9]{64}$/)
    expect(call.usage).toMatchObject({ source: 'estimated', actualCostUsd: null })
    expect(run.coordination.epochs.at(-1)!.commonOracleArchive).toMatchObject({ priorStatus: 'dispatched', observation: 'retained-response', responseArtifactHash: call.responseArtifactHash })
    expect(await db.agentRuns.toArray()).toEqual(beforeRuns); expect(await db.agentRunEvents.toArray()).toEqual(beforeEvents)
    const restoredProjectId = await importProjectJSON(await exportProjectJSON(copied.scope.projectId))
    const restored = (await db.productRuntimeSessions.where('projectId').equals(restoredProjectId).toArray())[0]
    expect((await readProductRuntimeState(restored.id!)).ttrpg!.openRun).toEqual(run)
  })
  it('archives an imported unobserved send as unknown without zeroing its conservative cost or allowing a late source answer to replace it', async () => {
    const s = await setup(); let release!: () => void, started!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve }), sending = new Promise<void>(resolve => { started = resolve })
    const generation = generateTtrpgOpenCommonOracleCandidateV1({ ...s.read, runAI: async () => { started(); await waiting; return output } })
    const observed = generation.then(value => value, error => error)
    await sending
    const copied = await copy(s); await archive(copied)
    const state = await readProductRuntimeState(copied.sessionId), call = state.ttrpg!.openRun!.coordination.calls.at(-1)!
    expect(call.status).toBe('unknown'); expect(call.usage).toEqual({ source: 'unknown', inputTokens: null, outputTokens: null, actualCostUsd: null })
    expect(call.reservedCostUsd).toBeGreaterThan(0)
    release(); await observed
    expect(await readProductRuntimeState(copied.sessionId)).toEqual(state)
  })
  it('retains unknown costs for an actually dispatched orphan and rejects a late answer after the governed Run deletion', async () => {
    const s = await setup(); let release!: () => void, started!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve }), sending = new Promise<void>(resolve => { started = resolve })
    const generation = generateTtrpgOpenCommonOracleCandidateV1({ ...s.read, runAI: async () => { started(); await waiting; return output } })
    const observed = generation.then(value => value, error => error)
    await sending; await events.deleteAgentRunV1(s.f.scope, s.read.runId)
    await archive(request(s))
    const state = await readProductRuntimeState(s.f.sessionId), run = state.ttrpg!.openRun!
    expect(run.coordination.calls.at(-1)!).toMatchObject({ status: 'unknown', usage: { source: 'unknown', actualCostUsd: null } })
    expect(run.coordination.epochs.at(-1)!.commonOracleArchive).toMatchObject({ producer: 'unavailable', observation: 'unverifiable-response' })
    release(); expect(await observed).toBeInstanceOf(Error)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(state); expect(await db.agentRuns.count()).toBe(0)
  })
  it('rejects a source restoration between preview and commit without closing or changing the restored record', async () => {
    const s = await setup(); await prepareTtrpgOpenCommonOracleInputV1(s.read)
    const original = (await db.agentRuns.get(s.read.runId))!
    await events.deleteAgentRunV1(s.f.scope, s.read.runId)
    const before = await readProductRuntimeState(s.f.sessionId), prepare = archives.prepareTtrpgOpenCommonOracleArchiveForKernelV1
    const race = vi.spyOn(archives, 'prepareTtrpgOpenCommonOracleArchiveForKernelV1').mockImplementationOnce(async input => {
      const result = await prepare(input); await db.agentRuns.put(original); return result
    })
    await expect(archive(request(s))).rejects.toThrow('当前不能归档'); expect(race).toHaveBeenCalled(); race.mockRestore()
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before); expect(await db.agentRuns.get(s.read.runId)).toEqual(original)
  })
  it('returns the original archival receipt after a committed return interruption and rejects damaged imported provenance', async () => {
    const s = await setup(); await prepareTtrpgOpenCommonOracleInputV1(s.read)
    const copied = await copy(s), close = commands.closeTtrpgOpenEpochV1
    const cut = vi.spyOn(commands, 'closeTtrpgOpenEpochV1').mockImplementationOnce(async input => { await close(input); throw new Error('COMMON-ARCHIVE-COMMITTED-RETURN-CUT') })
    await expect(archive(copied)).rejects.toThrow('当前不能归档'); expect(cut).toHaveBeenCalled(); cut.mockRestore()
    const state = await readProductRuntimeState(copied.sessionId), receipt = await archive(copied)
    expect(receipt.sequence).toBe(state.lastSequence); expect(await readProductRuntimeState(copied.sessionId)).toEqual(state)
    const broken = await copy(s), row = (await db.agentRuns.where('productRuntimeSessionId').equals(broken.sessionId).toArray())[0]
    const origin = JSON.parse(row.portableRuntimeOriginJson!); origin.originHash = '0'.repeat(64)
    await db.agentRuns.update(row.id!, { portableRuntimeOriginJson: JSON.stringify(origin) })
    const before = await readProductRuntimeState(broken.sessionId)
    await expect(archive(broken)).rejects.toThrow(); expect(await readProductRuntimeState(broken.sessionId)).toEqual(before)
  })
  it('archives a real candidate imported into a fresh database with all physical IDs reused without restoring execution authority', async () => {
    const s = await setup(); await generateTtrpgOpenCommonOracleCandidateV1({ ...s.read, runAI: async () => output })
    const before = await readProductRuntimeState(s.f.sessionId), backup = await exportProjectJSON(s.f.scope.projectId)
    await db.delete(); await db.open()
    const projectId = await importProjectJSON(backup), session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    expect(projectId).toBe(s.f.scope.projectId); expect(session.id).toBe(s.f.sessionId)
    expect(await db.agentRuns.get(s.read.runId)).toBeTruthy()
    await expect(prepareTtrpgOpenCommonOracleInputV1(s.read)).rejects.toThrow()
    await archive(request(s))
    const after = await readProductRuntimeState(s.f.sessionId)
    expect(after.ttrpg!.openRun!.coordination.calls).toEqual(before.ttrpg!.openRun!.coordination.calls)
    expect(after.ttrpg!.openRun!.coordination.epochs.at(-1)!.commonOracleArchive?.producer).toBe('imported')
    expect(await db.agentRuns.count()).toBe(1)
  })
  it('does not accept an unrelated failed Run as the terminal proof of an accepted review', async () => {
    const s = await setup(), generated = await generateTtrpgOpenCommonOracleCandidateV1({ ...s.read, runAI: async () => output })
    const cut = vi.spyOn(adoption, 'reconcileTtrpgOpenOracleFactRunV1').mockRejectedValueOnce(new Error('COMMON-ACCEPT-RECEIPT-CUT'))
    await expect(reviewTtrpgOpenCommonOracleCandidateV1({ ...s.read, ...await openEnvelopeV1(s.f.sessionId, 'common.archive.unrelated.failure'), candidateHash: generated.candidate.candidateHash,
      interpretationDecision: 'accept', interpretationReason: null, choices: [] })).rejects.toThrow(); cut.mockRestore()
    const snapshot = await events.readInstanceAgentRunV1(s.f.scope, s.read.runId)
    await events.appendAgentRunEventV1({ ...s.read, productRuntimeSessionId: s.f.sessionId, type: 'run.failed', payload: { code: 'unrelated-failure', retryable: false }, expectedLastSequence: snapshot.projection.lastSequence })
    await expect(readTtrpgOpenCommonOracleRequestCloseOwnerV1({ ...request(s), close: { requestKey: s.read.requestKey, decision: 'close-this-reviewed-common-oracle-window' } })).rejects.toThrow('原终验回执')
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.coordination.activeEpochKey).toBe(s.grant.epochKey)
  })
  it('preserves archival evidence through actual before/after branches and parent deletion without child execution or archive authority', async () => {
    const s = await setup(); await prepareTtrpgOpenCommonOracleInputV1(s.read)
    const copied = await copy(s), before = await readProductRuntimeState(copied.sessionId)
    await archive(copied)
    const after = await readProductRuntimeState(copied.sessionId), children = []
    for (const throughSequence of [before.lastSequence, after.lastSequence]) {
      const child = await branchProductRuntimeSession({ parentSessionId: copied.sessionId, throughSequence, title: 'Common archive cut' })
      await expect(archive({ ...copied, sessionId: child.id! })).rejects.toThrow()
      children.push({ child, state: await readProductRuntimeState(child.id!) })
    }
    const retained = children[1].state.ttrpg!.branchLineage!.ancestors.at(-1)!.snapshot.openRun!.coordination.epochs.at(-1)!.commonOracleArchive
    expect(retained).toEqual(after.ttrpg!.openRun!.coordination.epochs.at(-1)!.commonOracleArchive)
    await deleteProductRuntimeSession(copied.sessionId)
    for (const { child, state } of children) expect(await readProductRuntimeState(child.id!)).toEqual(state)
    await expect(importProjectJSON(await exportProjectJSON(copied.scope.projectId))).resolves.toBeGreaterThan(0)
  })
  it('keeps the original terminal call and explicit accepted review byte-for-byte after import', async () => {
    const s = await setup(), generated = await generateTtrpgOpenCommonOracleCandidateV1({ ...s.read, runAI: async () => output })
    await reviewTtrpgOpenCommonOracleCandidateV1({ ...s.read, ...await openEnvelopeV1(s.f.sessionId, 'common.archive.review'), candidateHash: generated.candidate.candidateHash,
      interpretationDecision: 'accept', interpretationReason: null, choices: [] })
    const copied = await copy(s), before = (await readProductRuntimeState(copied.sessionId)).ttrpg!.openRun!
    await archive(copied)
    const after = (await readProductRuntimeState(copied.sessionId)).ttrpg!.openRun!
    expect(after.coordination.calls).toEqual(before.coordination.calls); expect(after.oracleReviews).toEqual(before.oracleReviews); expect(after.factLedger).toEqual(before.factLedger)
    expect(after.worldTime).toEqual(before.worldTime); expect(after.coordination.epochs.at(-1)!.commonOracleArchive?.observation).toBe('terminal-retained')
  })
})
