import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { openContentRevisionFixtureV1 } from '../helpers/open-ttrpg-content-revision'
import { inspectProductProductionLocalNoDispatchV1 as inspect, prepareProductProductionLocalNoDispatchBookingV1 as prepare } from '../../src/lib/product-production/local-no-dispatch-booking'
import { parseProductProductionCommandV1 } from '../../src/lib/product-production/contracts'
import priorInput from '../fixtures/ttrpg-open-pre-booking-input-v1.json'
import { hashProductProductionTaskInputV1, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { publishProductProductionV1, recoverImportedProductProductionProofsV1 } from '../../src/lib/product-production/service'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
beforeEach(async () => { await db.delete(); await db.open(); vi.stubGlobal('fetch', vi.fn(async () => { throw Error('No real transport in legacy local accounting fixture') })) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })
const snapshot = async () => JSON.stringify({ productions: await db.productProductions.toArray(), builds: await db.productBuilds.toArray(),
  runs: await db.agentRuns.toArray(), events: await db.agentRunEvents.toArray(), checkpoints: await db.agentRunCheckpoints.toArray(),
  raw: await db.agentRunArtifacts.toArray(), artifacts: await db.productBuildArtifacts.toArray(), worlds: await db.worldReleases.toArray() })
async function fixture() {
  const f = await openContentRevisionFixtureV1({ legacyNoDispatch: true }), build = (await db.productBuilds.get(f.buildId))!, p = (await db.productProductions.get(f.productionId))!
  const plan = JSON.parse(build.planJson), artifact = (await db.productBuildArtifacts.where('buildId').equals(f.buildId).toArray())
    .find(row => row.artifactKey === 'ttrpg.open.situation-layer' && row.controlEpoch === plan.controlEpoch && row.status === 'accepted')!
  const view = { expectedStateRevision: p.stateRevision, buildNumber: build.buildNumber, controlEpoch: build.controlEpoch, planHash: build.planHash,
    anchor: { artifactKey: 'ttrpg.open.situation-layer' as const, version: artifact.version, contentHash: artifact.contentHash } }
  const inspected = await inspect({ ...f, view })
  const command = { type: 'book-local-no-dispatch' as const, commandId: 'explicit.author.book-local', ...view,
    ledgerHash: inspected.ledgerHash, proofs: inspected.candidates.map(row => ({ attemptKeyHash: row.attemptKeyHash, proofHash: row.proofHash })) }
  return { ...f, send: f.command, build, p, artifact, view, inspected, command }
}
it('proves the actual preflight and empty kernel histories read-only, preserving raw unknown entries and all source authority', async () => {
  const f = await fixture(), before = await snapshot(), prepared = await prepare(f)
  expect(f.calls).toHaveLength(3); expect(prepared.candidates.map(row => row.proof.classification)).toEqual(['preflight-before-dispatch', 'empty-media-kernel'])
  expect(prepared.accounting.entries.map(row => row.original)).toEqual(f.inspected.candidates.map(row => row.original))
  expect(prepared.accounting.entries.every(row => !row.original.usageKnown && row.original.usage === null)).toBe(true)
  expect(JSON.stringify(prepared.accounting)).not.toMatch(/"runId"|"rootRunId"|"buildId"/)
  expect(await snapshot()).toBe(before); expect(fetch).not.toHaveBeenCalled()
}, 30000)
it('books only explicitly proven unsent attempts once, without epoch/status/Plan/raw/known-provider changes', async () => {
  const f = await fixture(), before = await snapshot(), result = await f.send(f.command)
  expect(result.ok, JSON.stringify(result)).toBe(true)
  const build = (await db.productBuilds.get(f.buildId))!, after = JSON.parse(build.budgetLedgerJson), old = JSON.parse(f.build.budgetLedgerJson)
  expect(build).toEqual({ ...f.build, budgetLedgerJson: build.budgetLedgerJson, stateRevision: f.build.stateRevision + 1, updatedAt: build.updatedAt })
  for (let i = 0; i < old.attempts.length; i++) {
    if (old.attempts[i].usageKnown) expect(after.attempts[i]).toEqual(old.attempts[i])
    else expect(after.attempts[i]).toMatchObject({ ...old.attempts[i], usageKnown: true,
      resolution: 'system-released-before-dispatch', usage: { modelCalls: 0, mediaCalls: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, storageBytes: 0 } })
  }
  const previous = JSON.parse(before), current = JSON.parse(await snapshot())
  for (const key of ['runs', 'events', 'checkpoints', 'raw', 'artifacts', 'worlds']) expect(current[key]).toEqual(previous[key])
  const replay = await f.send(f.command); expect(replay).toMatchObject({ ok: true, replayed: true, result: result.result })
  expect(await db.productBuilds.get(f.buildId)).toEqual(build); expect(f.calls).toHaveLength(3)
}, 30000)
it('rolls back a failed receipt write and safely replays a same-command preparation race', async () => {
  const f = await fixture(), update = db.productProductionCommands.update.bind(db.productProductionCommands), before = await snapshot()
  const spy = vi.spyOn(db.productProductionCommands, 'update').mockImplementation(async (...args) => {
    if ((args[1] as { status?: string }).status === 'succeeded') throw Error('fixture no-dispatch receipt failure')
    return update(...args)
  })
  await expect(f.send(f.command)).rejects.toThrow('receipt failure'); expect(await snapshot()).toBe(before); spy.mockRestore()
  const results = await Promise.all([f.send(f.command), f.send(f.command)])
  expect(results.every(result => result.ok)).toBe(true)
  expect((await db.productProductions.get(f.productionId))!.stateRevision).toBe(f.p.stateRevision + 1)
  expect(await db.productProductionCommands.where('[productionId+commandId]').equals([f.productionId, f.command.commandId]).count()).toBe(1)
}, 30000)
it('rejects missing, stale, foreign, incomplete or duplicate proof sets before any bookkeeping', async () => {
  const f = await fixture(), before = await snapshot()
  for (const change of [{ ledgerHash: 'e'.repeat(64) }, { proofs: f.command.proofs.slice(0, 1) },
    { proofs: f.command.proofs.map(row => ({ ...row, proofHash: 'f'.repeat(64) })) },
    { anchor: { ...f.command.anchor, version: f.command.anchor.version + 1 } }]) {
    await expect(f.send({ ...f.command, ...change })).rejects.toThrow()
  }
  expect(() => parseProductProductionCommandV1({ ...f.command, proofs: [f.command.proofs[0], f.command.proofs[0]] })).toThrow('重复')
  await expect(prepare({ ...f, scope: { ...f.scope, workId: f.scope.workId + 1 } })).rejects.toThrow()
  expect(await snapshot()).toBe(before)
}, 30000)
it('never turns a genuinely requested model attempt into an unsent record by relabeling its ledger', async () => {
  const f = await fixture(), ledger = JSON.parse(f.build.budgetLedgerJson)
  const paid = ledger.attempts.find((row: { taskKey: string; errorCode: string }) => row.taskKey === 'ttrpg.open.source-facts' && row.errorCode === 'task-draft-rejected')
  expect(paid).toBeTruthy(); paid.usage = null; paid.usageKnown = false
  await db.productBuilds.update(f.buildId, { budgetLedgerJson: JSON.stringify(ledger) })
  const before = await snapshot()
  await expect(inspect({ ...f, view: f.view })).rejects.toThrow('发送')
  expect(await snapshot()).toBe(before)
}, 30000)
it('closes CAS over failed root/event/checkpoint evidence and cannot borrow imported pending producer authority', async () => {
  const f = await fixture(), prepared = await prepare(f), entry = f.inspected.candidates[0].entry
  const event = (await db.agentRunEvents.where('runId').equals(entry.runId).toArray())[0]
  await db.agentRunEvents.update(event.id!, { payloadJson: event.payloadJson + ' ' })
  await expect(prepared.assertCurrent()).rejects.toThrow('已变化'); await db.agentRunEvents.put(event)
  const copiedProject = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const copied = (await db.productProductions.where('projectId').equals(copiedProject).toArray()).find(row => row.productionKey === f.p.productionKey)!
  await expect(inspect({ scope: { projectId: copiedProject, worldId: copied.worldId, workId: copied.workId }, productionId: copied.id!, view: f.view })).rejects.toThrow()
  expect(await db.productBuilds.get(f.buildId)).toEqual(f.build)
}, 30000)
it('retains the accounting provenance through normal author repair, publication and colliding complete backup recovery', async () => {
  const f = await fixture(); expect((await f.send(f.command)).ok).toBe(true)
  const p = (await db.productProductions.get(f.productionId))!, draft = JSON.parse(f.artifact.payloadJson)
  draft.metadata.visualBible.characters[0].expressionBaselines = [{ expressionKey: 'neutral', prompt: '平静注视前方' }]
  expect((await f.send({ type: 'resume', commandId: 'author.repair.after.local-booking', expectedStateRevision: p.stateRevision,
    ttrpgContentRevision: { artifactKey: 'ttrpg.open.situation-layer', expectedArtifactVersion: f.artifact.version,
      expectedArtifactHash: f.artifact.contentHash, expectedPlanHash: f.build.planHash, expectedControlEpoch: f.build.controlEpoch,
      note: '明确修订原稿', authorDraftJson: JSON.stringify(draft) } })).ok).toBe(true)
  const result = await f.run(); expect(result.terminal, (await db.productBuilds.get(f.buildId))!.failureJson).toBe(true)
  await publishProductProductionV1(f)
  const original = (await db.productBuilds.get(f.buildId))!, recorded = (await db.productProductionCommands.where('[productionId+commandId]').equals([f.productionId, f.command.commandId]).first())!
  const copiedProject = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const copied = (await db.productProductions.where('projectId').equals(copiedProject).toArray()).find(row => row.productionKey === f.p.productionKey)!
  const copiedReceipt = (await db.productProductionCommands.where('[productionId+commandId]').equals([copied.id!, f.command.commandId]).first())!
  expect(copiedReceipt.resultJson).toBe(recorded.resultJson)
  expect((await recoverImportedProductProductionProofsV1({ scope: { projectId: copiedProject, worldId: copied.worldId, workId: copied.workId }, productionId: copied.id! })).terminal).toBe(true)
  expect(await db.productBuilds.get(f.buildId)).toEqual(original); expect(f.calls).toHaveLength(3)
  expect(JSON.parse(recorded.resultJson).accounting.originalLedgerHash).toBe(await hashProductProductionValueV2(f.build.budgetLedgerJson))
}, 60000)

it('preserves the exact pre-booking native dispatch checksum including its null metadata', async () => {
  expect(priorInput.recordedSourceHead).toBe('9fc121994326ddb683724b45deb5487c4a2db840')
  expect(await hashProductProductionTaskInputV1({ structuralInput: priorInput.structuralInput, sourcePlanHash: null,
    confirmedBriefHash: null, contextPacketHash: null, creatorDerivedAuthorizationHash: null })).toBe(priorInput.expectedInputHash)
  expect(await hashProductProductionValueV2(priorInput.structuralInput)).not.toBe(priorInput.expectedInputHash)
})
it('retains unknown usage if a local proof body is missing or changed, or its parent has no real terminal state', async () => {
  const f = await fixture(), raw = (await db.agentRunArtifacts.toArray()).find(row => row.content.includes('storyforge.ttrpg-open-empty-media-kernel-input'))!
  await db.agentRunArtifacts.update(raw.id!, { content: raw.content + ' ' })
  const changed = await snapshot(); await expect(inspect({ ...f, view: f.view })).rejects.toThrow(); expect(await snapshot()).toBe(changed)
  await db.agentRunArtifacts.put(raw)
  const parentId = (await db.agentRuns.get(f.inspected.candidates[1].entry.runId))!.parentRunId!
  const parent = (await db.agentRuns.get(parentId))!
  await db.agentRuns.update(parentId, { status: 'running' })
  const pending = await snapshot(); await expect(inspect({ ...f, view: f.view })).rejects.toThrow(); expect(await snapshot()).toBe(pending)
  await db.agentRuns.put(parent)
  const prepared = await prepare(f)
  const checkpoint = (await db.agentRunCheckpoints.toArray())[0]
  expect(checkpoint).toBeTruthy()
  // Deliberate storage-tampering race: a terminal root cannot legitimately
  // create a new checkpoint; even a forged inserted row must invalidate CAS.
  await db.agentRunCheckpoints.add({ ...checkpoint, id: undefined, runId: parentId })
  await expect(prepared.assertCurrent()).rejects.toThrow('已变化')
}, 30000)
