import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { createAgentRunV1, deleteAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { recordAgentRunArtifactV1, inspectAgentRunArtifactAvailabilityV1, markAndSweepAgentRunArtifactsV1, pruneAgentRunArtifactsExplicitlyV1 } from '../../src/lib/memory/artifact-store'
import { extractExactArtifactOwnerRootsV1 } from '../../src/lib/memory/artifact-roots'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'

const identity = { artifactKind: 'raw-response' as const, contentHash: 'a'.repeat(64) }
const paths = [{ field: 'payloadJson', path: ['rows', '*', 'refs'] }]
describe('CTXG-3 registered confirmed-owner root extraction', () => {
  it('deduplicates exact references across full arrays and optional generations without dropping the tail', () => {
    const rows = Array.from({ length: 2001 }, () => ({ refs: [] as typeof identity[] }))
    rows[2000].refs = [identity, identity]
    expect(extractExactArtifactOwnerRootsV1({ payloadJson: JSON.stringify({ rows }) }, paths)).toEqual([identity])
    expect(extractExactArtifactOwnerRootsV1({ payloadJson: JSON.stringify({ otherProduct: true }) }, paths)).toEqual([])
    expect(extractExactArtifactOwnerRootsV1({ payloadJson: JSON.stringify({ rows: null }) }, paths)).toEqual([])
    expect(extractExactArtifactOwnerRootsV1({ payloadJson: null }, paths)).toEqual([])
  })
  it('stops for damaged declared JSON, non-array roots, unknown kinds and changed hashes', () => {
    for (const raw of ['{', JSON.stringify({ rows: {} }), JSON.stringify({ rows: [{ refs: {} }] }),
      JSON.stringify({ rows: [{ refs: [{ ...identity, contentHash: 'changed' }] }] }),
      JSON.stringify({ rows: [{ refs: [{ ...identity, artifactKind: 'unknown' }] }] }),
      JSON.stringify({ rows: [{ refs: [{ ...identity, surprise: true }] }] })]) {
      expect(() => extractExactArtifactOwnerRootsV1({ payloadJson: raw }, paths)).toThrow(/清理已停止/)
    }
  })
  it('reads own fields only and rejects prototype traversal in a descriptor', () => {
    expect(extractExactArtifactOwnerRootsV1(Object.create({ payloadJson: JSON.stringify({ rows: [{ refs: [identity] }] }) }), paths)).toEqual([])
    expect(() => extractExactArtifactOwnerRootsV1({ payloadJson: '{}' }, [{ field: 'payloadJson', path: ['__proto__', 'refs'] }])).toThrow()
  })
  it('uses a literal declared owner discriminator before reading another product JSON', () => {
    const specs = [{ ...paths[0], when: { field: 'type', equals: 'confirmed' } }]
    expect(extractExactArtifactOwnerRootsV1({ type: 'other-product', payloadJson: '{not-this-owner' }, specs)).toEqual([])
    expect(() => extractExactArtifactOwnerRootsV1({ type: 'confirmed', payloadJson: '{damaged-owner' }, specs)).toThrow(/清理已停止/)
    expect(extractExactArtifactOwnerRootsV1({ type: 'confirmed', payloadJson: JSON.stringify({ rows: [{ refs: [identity] }] }) }, specs)).toEqual([identity])
  })
})

function contract(projectId: number) {
  return { version: 1, objective: 'registered artifact retention fixture', workflowKind: 'read-only-audit', runtimeBindingHash: 'b'.repeat(64),
    scope: { projectId, worldGroupId: null }, permissions: { contextSourceKeys: ['chapterContent'], writeTargets: [] },
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 1000, maxOutputTokens: 100, maxAttemptsPerStep: 1 },
    acceptance: [{ id: 'result', kind: 'output-present', required: true }], verificationPlan: [{ id: 'terminal', kind: 'terminal', verifier: 'root-fixture', criterionIds: ['result'] }],
    failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' } }
}
async function fixture() {
  const { scope } = await createWorkspace({ name: 'Confirmed root lifecycle', genres: ['fantasy'], description: '', targetWordCount: 1000 })
  const source = await createAgentRunV1({ scope, contract: contract(scope.projectId) }), keeper = await createAgentRunV1({ scope, contract: contract(scope.projectId) })
  const recorded = await recordAgentRunArtifactV1({ scope, runId: source.run.id, artifactKind: 'raw-response', content: 'immutable accepted evidence' })
  const ref = { artifactKind: recorded.artifact.artifactKind, contentHash: recorded.artifact.contentHash }
  // This isolated fixture registers another independent owner through real metadata.
  // Its opaque JSON is a retention pointer only, never a valid executable Run origin.
  await db.agentRuns.update(keeper.run.id, { portableRuntimeOriginJson: JSON.stringify({ roots: [ref] }) })
  return { scope, source, keeper, ref }
}
describe('CTXG-3 registered owners in actual cleanup transactions', () => {
  const owner = PROJECT_TABLES.find(s => s.name === 'agentRuns')!, original = owner.exactArtifactRoots
  beforeEach(async () => { owner.exactArtifactRoots = [{ field: 'portableRuntimeOriginJson', path: ['roots'] }]; await db.delete(); await db.open() })
  afterEach(() => { if (original === undefined) delete owner.exactArtifactRoots; else owner.exactArtifactRoots = original; db.close() })
  it('keeps the body after source Run deletion and sweep, blocks explicit pruning, then releases it with its last owner', async () => {
    const f = await fixture()
    await deleteAgentRunV1(f.scope, f.source.run.id)
    await markAndSweepAgentRunArtifactsV1(f.scope.projectId)
    expect(await inspectAgentRunArtifactAvailabilityV1({ projectId: f.scope.projectId, ...f.ref })).toMatchObject({ state: 'available' })
    await expect(pruneAgentRunArtifactsExplicitlyV1({ projectId: f.scope.projectId, targets: [f.ref] })).rejects.toThrow(/已确认产物/)
    await deleteAgentRunV1(f.scope, f.keeper.run.id)
    expect(await inspectAgentRunArtifactAvailabilityV1({ projectId: f.scope.projectId, ...f.ref })).toMatchObject({ state: 'evidence-pruned' })
  })
  it('does not pin another project body through a same-hash reference', async () => {
    const f = await fixture(), other = await fixture()
    await db.agentRuns.update(f.keeper.run.id, { portableRuntimeOriginJson: JSON.stringify({ roots: [] }) })
    await deleteAgentRunV1(f.scope, f.source.run.id)
    expect(await inspectAgentRunArtifactAvailabilityV1({ projectId: f.scope.projectId, ...f.ref })).toMatchObject({ state: 'evidence-pruned' })
    expect(await inspectAgentRunArtifactAvailabilityV1({ projectId: other.scope.projectId, ...other.ref })).toMatchObject({ state: 'available' })
  })
  it('rolls back Run deletion and leaves evidence intact when a declared owner is damaged', async () => {
    const f = await fixture()
    await db.agentRuns.update(f.keeper.run.id, { portableRuntimeOriginJson: '{damaged' })
    await expect(deleteAgentRunV1(f.scope, f.source.run.id)).rejects.toThrow(/清理已停止/)
    expect(await db.agentRuns.get(f.source.run.id)).toBeDefined()
    expect(await inspectAgentRunArtifactAvailabilityV1({ projectId: f.scope.projectId, ...f.ref })).toMatchObject({ state: 'available' })
  })
})
