/** Registry/retention foundation only. Opaque pointer fixtures deliberately are
 * not executable E16 receipts, valid checkpoints, listening or adoption proof. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { extractExactArtifactOwnerRootsV1 } from '../../src/lib/memory/artifact-roots'
import { exactArtifactOwnerTablesV1 } from '../../src/lib/memory/artifact-root-registry'
import { createAgentRunV1, deleteAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { recordAgentRunArtifactV1, inspectAgentRunArtifactAvailabilityV1, markAndSweepAgentRunArtifactsV1, pruneAgentRunArtifactsExplicitlyV1 } from '../../src/lib/memory/artifact-store'
import { seedOpenTtrpgSessionV1 } from '../helpers/open-ttrpg-session'

const ref = { artifactKind: 'raw-response' as const, contentHash: 'a'.repeat(64) }
const state = (refs: unknown, ancestor = false) => {
  const run = { openRun: { audioReceipts: [{ generated: { artifactRefs: refs } }] } }
  return JSON.stringify({ ttrpg: ancestor ? { branchLineage: { ancestors: [{ snapshot: run }] } } : run })
}
const specs = (name: string) => PROJECT_TABLES.find(row => row.name === name)!.exactArtifactRoots!
describe('R-TTRPGOPEN10 generated audio owner path closure', () => {
  it.each(['initialStateJson', 'runtimeHeadStateJson'])('retains current and ancestor %s without adding defaults or accepting another product', field => {
    for (const ancestor of [false, true]) expect(extractExactArtifactOwnerRootsV1({ kind: 'ttrpg', [field]: state([ref, ref], ancestor) }, specs('productRuntimeSessions'))).toEqual([ref])
    expect(extractExactArtifactOwnerRootsV1({ kind: 'avg', [field]: '{not-declared-for-this-product' }, specs('productRuntimeSessions'))).toEqual([])
    expect(extractExactArtifactOwnerRootsV1({ kind: 'ttrpg', [field]: JSON.stringify({ ttrpg: { openRun: { audioReceipts: [{ version: 1 }] } } }) }, specs('productRuntimeSessions'))).toEqual([])
  })
  it('retains actual audio-event and checkpoint current/ancestor pointers, and skips absent or legacy roots', () => {
    expect(extractExactArtifactOwnerRootsV1({ type: 'ttrpg.audio.cue.applied', payloadJson: JSON.stringify({ receipt: { generated: { artifactRefs: [ref] } } }) }, specs('productRuntimeEvents'))).toEqual([ref])
    expect(extractExactArtifactOwnerRootsV1({ type: 'other-event', payloadJson: '{other-owner' }, specs('productRuntimeEvents'))).toEqual([])
    for (const ancestor of [false, true]) expect(extractExactArtifactOwnerRootsV1({ stateJson: state([ref], ancestor) }, specs('productRuntimeCheckpoints'))).toEqual([ref])
    for (const json of ['{}', '{"ttrpg":null,"adventure":{}}', '{"ttrpg":{"openRun":{"audioReceipts":[{"version":1}]}}}']) expect(extractExactArtifactOwnerRootsV1({ stateJson: json }, specs('productRuntimeCheckpoints'))).toEqual([])
    expect(exactArtifactOwnerTablesV1()).toContain(db.productRuntimeCheckpoints)
    expect(PROJECT_TABLES.find(row => row.name === 'productRuntimeSessions')!.defaults).not.toHaveProperty('audioReceipts')
  })
  it('fails closed on every newly declared damaged root rather than silently losing its body', () => {
    for (const bad of [{}, [{ ...ref, contentHash: 'wrong' }], [{ ...ref, artifactKind: 'unknown' }], [{ ...ref, extra: true }]]) {
      expect(() => extractExactArtifactOwnerRootsV1({ kind: 'ttrpg', runtimeHeadStateJson: state(bad) }, specs('productRuntimeSessions'))).toThrow(/清理已停止/)
      expect(() => extractExactArtifactOwnerRootsV1({ stateJson: state(bad, true) }, specs('productRuntimeCheckpoints'))).toThrow(/清理已停止/)
      expect(() => extractExactArtifactOwnerRootsV1({ type: 'ttrpg.audio.cue.applied', payloadJson: JSON.stringify({ receipt: { generated: { artifactRefs: bad } } }) }, specs('productRuntimeEvents'))).toThrow(/清理已停止/)
    }
  })
})

function contract(projectId: number) {
  return { version: 1, objective: 'audio-retention-only source fixture', workflowKind: 'read-only-audit', runtimeBindingHash: 'b'.repeat(64),
    scope: { projectId, worldGroupId: null }, permissions: { contextSourceKeys: ['chapterContent'], writeTargets: [] },
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 1000, maxOutputTokens: 100, maxAttemptsPerStep: 1 },
    acceptance: [{ id: 'result', kind: 'output-present', required: true }], verificationPlan: [{ id: 'terminal', kind: 'terminal', verifier: 'audio-root-fixture', criterionIds: ['result'] }],
    failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' } }
}
async function fixture() {
  const f = await seedOpenTtrpgSessionV1('audio retention metadata fixture')
  const source = await createAgentRunV1({ scope: f.scope, contract: contract(f.scope.projectId) })
  const body = await recordAgentRunArtifactV1({ scope: f.scope, runId: source.run.id, artifactKind: 'raw-response', content: 'opaque immutable source; not actual audio or E16' })
  return { ...f, source, ref: { artifactKind: body.artifact.artifactKind, contentHash: body.artifact.contentHash } }
}
describe('R-TTRPGOPEN10 actual generated-audio root cleanup transactions', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it.each(['initial', 'head', 'ancestor', 'event', 'checkpoint', 'checkpoint-ancestor'] as const)('keeps exact source after Run deletion with only the %s owner, then releases with that last pointer', async location => {
    const f = await fixture(), original = await db.productRuntimeSessions.get(f.sessionId)
    let eventId: number | undefined, checkpointId: number | undefined
    if (location === 'initial') await db.productRuntimeSessions.update(f.sessionId, { initialStateJson: state([f.ref]) })
    if (location === 'head' || location === 'ancestor') await db.productRuntimeSessions.update(f.sessionId, { runtimeHeadStateJson: state([f.ref], location === 'ancestor') })
    if (location === 'event') eventId = await db.productRuntimeEvents.add({ projectId: f.scope.projectId, sessionId: f.sessionId,
      sequence: 100001, type: 'ttrpg.audio.cue.applied', payloadJson: JSON.stringify({ receipt: { generated: { artifactRefs: [f.ref] } } }), createdAt: Date.now() })
    if (location.startsWith('checkpoint')) checkpointId = await db.productRuntimeCheckpoints.add({ projectId: f.scope.projectId, sessionId: f.sessionId, throughSequence: 0,
      name: 'retention pointer only; never replay', stateJson: state([f.ref], location === 'checkpoint-ancestor'), stateHash: 'b'.repeat(64), createdAt: Date.now() })
    await deleteAgentRunV1(f.scope, f.source.run.id)
    await markAndSweepAgentRunArtifactsV1(f.scope.projectId)
    expect(await inspectAgentRunArtifactAvailabilityV1({ projectId: f.scope.projectId, ...f.ref })).toMatchObject({ state: 'available' })
    await expect(pruneAgentRunArtifactsExplicitlyV1({ projectId: f.scope.projectId, targets: [f.ref] })).rejects.toThrow(/已确认产物/)
    if (eventId !== undefined) await db.productRuntimeEvents.delete(eventId)
    if (checkpointId !== undefined) await db.productRuntimeCheckpoints.delete(checkpointId)
    await db.productRuntimeSessions.update(f.sessionId, { initialStateJson: original!.initialStateJson, runtimeHeadStateJson: original!.runtimeHeadStateJson })
    await markAndSweepAgentRunArtifactsV1(f.scope.projectId)
    expect(await inspectAgentRunArtifactAvailabilityV1({ projectId: f.scope.projectId, ...f.ref })).toMatchObject({ state: 'evidence-pruned' })
  })
  it('does not let an identical pointer in a different project keep this project body', async () => {
    const a = await fixture(), b = await fixture()
    expect(a.ref).toEqual(b.ref)
    await db.productRuntimeSessions.update(b.sessionId, { runtimeHeadStateJson: state([b.ref]) })
    await deleteAgentRunV1(a.scope, a.source.run.id)
    expect(await inspectAgentRunArtifactAvailabilityV1({ projectId: a.scope.projectId, ...a.ref })).toMatchObject({ state: 'evidence-pruned' })
    expect(await inspectAgentRunArtifactAvailabilityV1({ projectId: b.scope.projectId, ...b.ref })).toMatchObject({ state: 'available' })
  })
  it('rolls back source deletion if a declared checkpoint pointer is damaged', async () => {
    const f = await fixture()
    await db.productRuntimeCheckpoints.add({ projectId: f.scope.projectId, sessionId: f.sessionId, throughSequence: 0, name: 'damaged root fixture',
      stateJson: state([{ ...f.ref, contentHash: 'damaged' }]), stateHash: 'b'.repeat(64), createdAt: Date.now() })
    await expect(deleteAgentRunV1(f.scope, f.source.run.id)).rejects.toThrow(/清理已停止/)
    expect(await db.agentRuns.get(f.source.run.id)).toBeDefined()
    expect(await inspectAgentRunArtifactAvailabilityV1({ projectId: f.scope.projectId, ...f.ref })).toMatchObject({ state: 'available' })
  })
})
