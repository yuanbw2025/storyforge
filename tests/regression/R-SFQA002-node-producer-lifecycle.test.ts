import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, STORYFORGE_SCHEMA_VERSION } from '../../src/lib/db/schema'
import { seedCurrentWorkspace, currentWorkFixtureRecordV1, addCurrentWorldFixtureV1, addCurrentWorkFixtureV1 } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { appendAgentRunEventV1, createAgentRunV1, readAgentRunV1, type CreateAgentRunV1Input } from '../../src/lib/agent/run/event-store'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { createAgentRunCheckpointV1 } from '../../src/lib/agent/run/checkpoint'
import { createContextManifestFromAssemblyV1 } from '../../src/lib/agent/run/context-manifest'
import { createVerificationReceiptV1 } from '../../src/lib/agent/run/verification-receipt'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { recordAgentRunArtifactV1, readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { markAndSweepAgentRunArtifactsV1, pruneAgentRunArtifactsExplicitlyV1 } from '../../src/lib/memory/artifact-retention-store'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { CURRENT_EXPORT_VERSION, deriveStrictExportProjectSnapshot, deriveStrictExportProjectSnapshotInCurrentTransaction } from '../../src/lib/export/registry-export'
import { transactionTablesFor } from '../../src/lib/registry/lifecycle'
import { useNodeFlowStore } from '../../src/stores/node-flow'
import { useWorldGroupStore } from '../../src/stores/world-group'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import type { NodeFlow, NodeRunRecord, WorkspaceScope } from '../../src/lib/types'

const RAW = '\r\n  {"field":"theme","value":"e\u0301 与 é 保持原字节"}\n\t '
function contract(scope: WorkspaceScope) {
  return { version: 1, runtimeBindingHash: 'a'.repeat(64), objective: 'Node producer lifecycle fixture; no actual inference', workflowKind: 'direct-generation',
    scope: { projectId: scope.projectId, worldGroupId: null }, permissions: { contextSourceKeys: ['worldview'], writeTargets: [{ table: 'storyCores', fields: ['theme'], mode: 'candidate-only' }] },
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 100, maxOutputTokens: 100, maxAttemptsPerStep: 1 },
    acceptance: [{ id: 'output', kind: 'output-present', required: true }],
    verificationPlan: [{ id: 'terminal', kind: 'terminal', verifier: 'node-lifecycle-fixture', criterionIds: ['output'] }],
    failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' } }
}
async function fixture(label = 'node producer lifecycle', supplied?: WorkspaceScope) {
  const scope = supplied ?? (await seedCurrentWorkspace(label)).scope
  const now = Date.now()
  const graphJson = JSON.stringify({ version: 2, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } })
  const flowId = await db.nodeFlows.add(stampNewRecord<NodeFlow>(scope, 'nodeFlows', { projectId: scope.projectId, worldGroupId: null, name: label, description: '', graphJson, createdAt: now, updatedAt: now }, { owner: 'work' })) as number
  const nodeRunId = await db.nodeRuns.add(stampNewRecord<NodeRunRecord>(scope, 'nodeRuns', { projectId: scope.projectId, flowId, status: 'running', inputSnapshotsJson: '{}', nodeResultsJson: '{}', executionPlanJson: '{}', graphSnapshotJson: graphJson, startedAt: now, updatedAt: now, completedAt: null }, { owner: 'work' })) as number
  return { scope, flowId, nodeRunId }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
async function inputFor(f: Fixture): Promise<CreateAgentRunV1Input> {
  return { scope: { ...f.scope }, contract: contract(f.scope), nodeProducer: {
    nodeRunId: f.nodeRunId, nodeProducerNodeId: 'story-theme', nodeProducerVariantIndex: 0, nodeProducerAttempt: 1,
    expectedNodeRunHash: await hashCanonicalValue(await db.nodeRuns.get(f.nodeRunId)),
    expectedFlowHash: await hashCanonicalValue(await db.nodeFlows.get(f.flowId)),
  } }
}
async function allRows() { return Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()]))) }
async function raw(runId: number, scope: WorkspaceScope, content = RAW) {
  return recordAgentRunArtifactV1({ scope, runId, artifactKind: 'raw-response', content })
}
async function expectRaw(projectId: number, contentHash: string) {
  expect(await readAgentRunArtifactExactV1({ projectId, artifactKind: 'raw-response', contentHash })).toBe(RAW)
}
beforeEach(async () => { await db.delete(); await db.open() })
afterEach(async () => { vi.restoreAllMocks(); await db.delete(); await db.open() })

describe('SFQA002 D5 real Node producer association', () => {
  it('preserves the legacy creation path without adding any operational tuple', async () => {
    const f = await fixture(); const result = await createAgentRunV1({ scope: f.scope, contract: contract(f.scope) })
    expect(result.run).not.toHaveProperty('nodeRunId')
    expect(result.run).not.toHaveProperty('nodeProducerNodeId')
    expect(result.events.map(event => event.type)).toEqual(['run.created', 'contract.accepted'])
  })
  it('creates a real Work-owned Run with the exact independent slot and unchanged signed contract', async () => {
    const f = await fixture(); const input = await inputFor(f); const result = await createAgentRunV1(input)
    expect(result.run).toMatchObject({ workId: f.scope.workId, nodeRunId: f.nodeRunId, nodeProducerNodeId: 'story-theme', nodeProducerVariantIndex: 0, nodeProducerAttempt: 1 })
    expect(JSON.parse(result.run.contractJson)).not.toHaveProperty('nodeProducer')
    expect(result.run.contractHash).toBe(await hashCanonicalValue(result.contract))
    expect((await readAgentRunV1(f.scope, result.run.id)).projection.errors).toEqual([])
  })
  it('atomically refuses duplicate tuple creation, including a terminal original slot', async () => {
    const f = await fixture(); const input = await inputFor(f); const a = await createAgentRunV1(input); const before = await allRows()
    await expect(createAgentRunV1(input)).rejects.toThrow(/node.producer|节点/i)
    expect(await allRows()).toEqual(before)
    expect(await db.agentRuns.count()).toBe(1); expect(a.run.id).toBeDefined()
    await appendAgentRunEventV1({ scope: f.scope, runId: a.run.id, type: 'run.cancelled', payload: { reason: 'explicit fixture end' } })
    const terminal = await allRows(); await expect(createAgentRunV1(input)).rejects.toThrow(/node.producer|节点/i); expect(await allRows()).toEqual(terminal)
  })
  it('serializes simultaneous attempts for the same tuple without a schema index or local map', async () => {
    const f = await fixture(); const input = await inputFor(f)
    const result = await Promise.allSettled([createAgentRunV1(input), createAgentRunV1(structuredClone(input))])
    expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    expect(result.filter(item => item.status === 'rejected')).toHaveLength(1)
    expect(await db.agentRuns.count()).toBe(1); expect(await db.agentRunEvents.count()).toBe(2)
  })
  it('permits distinct original variants and distinct NodeRuns without borrowing authority', async () => {
    const a = await fixture(); const b = await fixture('other flow', a.scope)
    const first = await createAgentRunV1(await inputFor(a)); const secondInput = await inputFor(a)
    secondInput.nodeProducer!.nodeProducerVariantIndex = 1
    const second = await createAgentRunV1(secondInput); const other = await createAgentRunV1(await inputFor(b))
    expect(new Set([first.run.id, second.run.id, other.run.id]).size).toBe(3)
    expect(first.run.terminalReceiptHash).toBeNull(); expect(second.run.terminalReceiptHash).toBeNull()
  })
  it.each(['paused', 'failed', 'completed', 'cancelled'] as const)('refuses a %s NodeRun with zero new records', async status => {
    const f = await fixture(); await db.nodeRuns.update(f.nodeRunId, { status }); const input = await inputFor(f); const before = await allRows()
    await expect(createAgentRunV1(input)).rejects.toThrow(/node.producer|节点/i)
    expect(await allRows()).toEqual(before)
  })
  it.each(['node', 'flow'] as const)('refuses a missing %s before creating any Run or event', async target => {
    const f = await fixture(); const input = await inputFor(f)
    if (target === 'node') await db.nodeRuns.delete(f.nodeRunId); else await db.nodeFlows.delete(f.flowId)
    const before = await allRows(); await expect(createAgentRunV1(input)).rejects.toThrow(/node.producer|节点/i); expect(await allRows()).toEqual(before)
  })
  it.each(['world-id', 'project', 'world', 'work'] as const)('validates the real %s root rather than only stored Node owner columns', async target => {
    const f = await fixture(); const input = await inputFor(f)
    if (target === 'world-id') input.scope.worldId += 999999
    if (target === 'project') await db.projects.delete(f.scope.projectId)
    if (target === 'world') await db.worlds.delete(f.scope.worldId)
    if (target === 'work') await db.works.delete(f.scope.workId)
    const before = await allRows()
    await expect(createAgentRunV1(input)).rejects.toThrow(/WorkspaceScope|工作区/)
    expect(await allRows()).toEqual(before)
  })
  it.each(['same-world', 'foreign-world'] as const)('checks the actual non-null group owner after public Flow creation: %s', async mode => {
    const scope = (await seedCurrentWorkspace('Node actual group ' + mode)).scope
    const otherWorld = await addCurrentWorldFixtureV1({ projectId: scope.projectId, name: 'World B' })
    const otherWork = await addCurrentWorkFixtureV1({ projectId: scope.projectId, worldId: otherWorld.id!, create: { title: 'Work B', kind: 'novel', novelProfile: 'long' } })
    const groupScope = mode === 'same-world' ? scope : { projectId: scope.projectId, worldId: otherWorld.id!, workId: otherWork.id! }
    const groupId = await useWorldGroupStore.getState().createGroup({ projectId: scope.projectId, name: 'Actual group', description: '', type: 'parallel', order: 0 }, groupScope)
    const flowId = await useNodeFlowStore.getState().createFlow(scope.projectId, groupId)
    const flow = (await db.nodeFlows.get(flowId))!; const now = Date.now()
    const nodeRunId = await db.nodeRuns.add(stampNewRecord<NodeRunRecord>(scope, 'nodeRuns', { projectId: scope.projectId, flowId, status: 'running', inputSnapshotsJson: '{}', nodeResultsJson: '{}', executionPlanJson: '{}', graphSnapshotJson: flow.graphJson, startedAt: now, updatedAt: now, completedAt: null }, { owner: 'work' })) as number
    const input = await inputFor({ scope, flowId, nodeRunId }); input.worldGroupId = groupId
    input.contract = { ...contract(scope), scope: { projectId: scope.projectId, worldGroupId: groupId } }
    const before = await allRows()
    if (mode === 'same-world') expect((await createAgentRunV1(input)).run.worldGroupId).toBe(groupId)
    else { await expect(createAgentRunV1(input)).rejects.toThrow(/节点|world|World/); expect(await allRows()).toEqual(before) }
  })
  it.each(['node', 'flow'] as const)('checks the complete %s snapshot again in the native create transaction', async target => {
    const f = await fixture(); const input = await inputFor(f)
    if (target === 'node') await db.nodeRuns.update(f.nodeRunId, { nodeResultsJson: '{"changed":true}' }); else await db.nodeFlows.update(f.flowId, { description: 'author edit after capture' })
    const before = await allRows(); await expect(createAgentRunV1(input)).rejects.toThrow(/snapshot|快照/i); expect(await allRows()).toEqual(before)
  })
  it.each(['project', 'work', 'flow-owner'] as const)('refuses foreign %s scope without touching either owner', async target => {
    const f = await fixture(); const input = await inputFor(f)
    if (target === 'project') { const foreign = await fixture('foreign'); input.scope = foreign.scope; input.contract = contract(foreign.scope) }
    else { const workId = await db.works.add(currentWorkFixtureRecordV1({ projectId: f.scope.projectId, worldId: f.scope.worldId, title: 'sibling' })) as number
      if (target === 'work') { input.scope = { ...f.scope, workId }; input.contract = contract(input.scope) }
      else { await db.nodeFlows.update(f.flowId, stampNewRecord({ ...f.scope, workId }, 'nodeFlows', { updatedAt: Date.now() }, { owner: 'work' })); input.nodeProducer!.expectedFlowHash = await hashCanonicalValue(await db.nodeFlows.get(f.flowId)) }
    }
    const before = await allRows(); await expect(createAgentRunV1(input)).rejects.toThrow(/node.producer|节点/i); expect(await allRows()).toEqual(before)
  })
  it.each(['variant', 'attempt', 'node-id', 'hash'] as const)('refuses malformed %s before writing anything', async target => {
    const f = await fixture(); const input = await inputFor(f)
    if (target === 'variant') input.nodeProducer!.nodeProducerVariantIndex = 8
    if (target === 'attempt') Object.assign(input.nodeProducer!, { nodeProducerAttempt: 2 })
    if (target === 'node-id') input.nodeProducer!.nodeProducerNodeId = ''
    if (target === 'hash') input.nodeProducer!.expectedFlowHash = 'bad'
    const before = await allRows(); await expect(createAgentRunV1(input)).rejects.toThrow(); expect(await allRows()).toEqual(before)
  })
  it('uses call-time input even if the caller mutates tuple, scope and contract during acceptance hashing', async () => {
    const f = await fixture(); const input = await inputFor(f); const pending = createAgentRunV1(input)
    input.nodeProducer!.nodeProducerNodeId = 'other'; input.nodeProducer!.nodeProducerVariantIndex = 7; input.scope.workId = 987654; input.contract = { broken: true }
    const created = await pending
    expect(created.run).toMatchObject({ nodeRunId: f.nodeRunId, workId: f.scope.workId, nodeProducerNodeId: 'story-theme', nodeProducerVariantIndex: 0 })
  })
  it('detaches by the actual removeFlow registered transaction and retains complete original bytes', async () => {
    const f = await fixture(); const sibling = await fixture('same Work sibling', f.scope)
    const run = await createAgentRunV1(await inputFor(f)); const saved = await raw(run.run.id, f.scope)
    const other = await createAgentRunV1(await inputFor(sibling)); const before = await db.agentRuns.get(other.run.id)
    await useNodeFlowStore.getState().removeFlow(f.flowId)
    expect(await db.nodeFlows.get(f.flowId)).toBeUndefined(); expect(await db.nodeRuns.get(f.nodeRunId)).toBeUndefined()
    expect(await db.agentRuns.get(run.run.id)).toMatchObject({ workId: f.scope.workId, nodeRunId: null, nodeProducerNodeId: 'story-theme', nodeProducerVariantIndex: 0, nodeProducerAttempt: 1 })
    expect(await db.agentRuns.get(other.run.id)).toEqual(before); await markAndSweepAgentRunArtifactsV1(f.scope.projectId); await expectRaw(f.scope.projectId, saved.artifact.contentHash)
  })
  it('allows the outstanding original Run to retain late raw after graph detach without minting new authority', async () => {
    const f = await fixture(); const input = await inputFor(f); const run = await createAgentRunV1(input)
    let release!: (value: string) => void; const response = new Promise<string>(resolve => { release = resolve })
    const outstanding = response.then(content => raw(run.run.id, f.scope, content))
    await useNodeFlowStore.getState().removeFlow(f.flowId); release(RAW); const saved = await outstanding
    await expectRaw(f.scope.projectId, saved.artifact.contentHash)
    expect((await readAgentRunV1(f.scope, run.run.id)).projection.terminalReceiptHash ?? null).toBeNull()
    await expect(createAgentRunV1(input)).rejects.toThrow(); expect(await db.agentRuns.count()).toBe(1)
  })
  it('rolls back detachment if the final native Flow delete fails', async () => {
    const f = await fixture(); await createAgentRunV1(await inputFor(f)); const before = await allRows()
    vi.spyOn(db.nodeFlows, 'delete').mockImplementationOnce(() => Dexie.Promise.reject(new Error('late Flow delete fault')))
    await expect(useNodeFlowStore.getState().removeFlow(f.flowId)).rejects.toThrow('late Flow delete fault'); expect(await allRows()).toEqual(before)
  })
  it('preserves old internal17/public roundtrip without tuple, and carries new operational refs through real remap', async () => {
    const f = await fixture(); const legacy = await createAgentRunV1({ scope: f.scope, contract: contract(f.scope) }); const active = await createAgentRunV1(await inputFor(f)); const saved = await raw(active.run.id, f.scope)
    const beforeRaw = (await db.agentRunArtifacts.get(saved.artifact.id))!.content
    await createAgentRunCheckpointV1({ scope: f.scope, runId: active.run.id, resumePayload: { portable: false, kind: 'node-lifecycle-fixture', originalNode: 'story-theme', rawHash: saved.artifact.contentHash } })
    const exported = await exportProjectJSON(f.scope.projectId); const snapshot = await deriveStrictExportProjectSnapshot(f.scope.projectId)
    expect(exported.version).toBe(CURRENT_EXPORT_VERSION); expect(snapshot.data.version).toBe(CURRENT_EXPORT_VERSION)
    const originalText = JSON.stringify(exported); const importedId = await importProjectJSON(exported); expect(JSON.stringify(exported)).toBe(originalText)
    const runs = await db.agentRuns.where('projectId').equals(importedId).toArray(); const linked = runs.find(row => row.nodeProducerNodeId === 'story-theme')!
    expect(linked.nodeRunId).not.toBe(f.nodeRunId); expect(linked.nodeProducerVariantIndex).toBe(0)
    const node = await db.nodeRuns.get(linked.nodeRunId!); expect(node?.projectId).toBe(importedId)
    expect(linked.status).toBe('cancelled'); expect(runs.find(row => row.id !== linked.id)?.nodeProducerNodeId).toBeUndefined()
    expect((await readAgentRunV1(f.scope, legacy.run.id)).projection.state).toBe('planned')
    expect((await db.agentRunArtifacts.where('projectId').equals(importedId).first())?.content).toBe(beforeRaw)
  })
  it('accepts an actual legacy17 row with no optional coordinate and retains old signed Node JSON', async () => {
    const f = await fixture(); await createAgentRunV1({ scope: f.scope, contract: contract(f.scope) })
    const nodeBefore = (await db.nodeRuns.get(f.nodeRunId))!.nodeResultsJson
    const exported = await exportProjectJSON(f.scope.projectId)
    expect(exported.agentRuns![0]).not.toHaveProperty('_nodeRunExportId')
    for (const value of exported.agentRuns ?? []) delete (value as unknown as Record<string, unknown>)._nodeRunExportId
    expect(exported.agentRuns![0]).not.toHaveProperty('_nodeRunExportId')
    const original = JSON.stringify(exported); const imported = await importProjectJSON(exported)
    expect(db.verno).toBe(STORYFORGE_SCHEMA_VERSION); expect(JSON.stringify(exported)).toBe(original)
    expect((await db.nodeRuns.where('projectId').equals(imported).first())?.nodeResultsJson).toBe(nodeBefore)
    expect((await db.agentRuns.where('projectId').equals(imported).first())?.nodeProducerNodeId).toBeUndefined()
  })
  it('roundtrips an explicitly detached original tuple without inferring a new parent', async () => {
    const f = await fixture(); const run = await createAgentRunV1(await inputFor(f)); const saved = await raw(run.run.id, f.scope)
    await useNodeFlowStore.getState().removeFlow(f.flowId)
    const exported = await exportProjectJSON(f.scope.projectId); const imported = await importProjectJSON(exported)
    const restored = await db.agentRuns.where('projectId').equals(imported).first()
    expect(restored).toMatchObject({ nodeRunId: null, nodeProducerNodeId: 'story-theme', nodeProducerVariantIndex: 0, nodeProducerAttempt: 1 })
    expect(await db.nodeRuns.where('projectId').equals(imported).count()).toBe(0)
    await expectRaw(imported, saved.artifact.contentHash)
  })
  it('retires an imported Node producer before its first checkpoint instead of restoring dispatch authority', async () => {
    const f = await fixture(); await createAgentRunV1(await inputFor(f))
    expect(await db.agentRunCheckpoints.count()).toBe(0)
    const exported = await exportProjectJSON(f.scope.projectId); const before = JSON.stringify(exported)
    const imported = await importProjectJSON(exported)
    expect(JSON.stringify(exported)).toBe(before)
    expect((await db.agentRuns.where('projectId').equals(imported).first())?.status).toBe('cancelled')
    const restored = await exportProjectJSON(imported)
    expect(restored.agentRunEvents.slice(0, exported.agentRunEvents.length)).toEqual(exported.agentRunEvents)
    expect(restored.agentRunEvents[restored.agentRunEvents.length - 1]?.payloadJson).toBe(JSON.stringify({ reason: 'project-import-node-producer-readonly' }))
    expect(restored.agentRunCheckpoints).toEqual([])
  })
  it.each(['failed', 'cancelled'] as const)('retains an original %s prefix exactly across repeated imports', async state => {
    const f = await fixture(); const run = await createAgentRunV1(await inputFor(f)); await raw(run.run.id, f.scope)
    if (state === 'failed') await appendAgentRunEventV1({ scope: f.scope, runId: run.run.id, type: 'run.failed', payload: { code: 'synthetic-nonretryable', retryable: false } })
    else await appendAgentRunEventV1({ scope: f.scope, runId: run.run.id, type: 'run.cancelled', payload: { reason: 'explicit-author-end' } })
    const original = await exportProjectJSON(f.scope.projectId); const a = await importProjectJSON(original); const b = await exportProjectJSON(a)
    expect(b.agentRunEvents).toEqual(original.agentRunEvents)
    const c = await importProjectJSON(b); expect((await exportProjectJSON(c)).agentRunEvents).toEqual(original.agentRunEvents)
    expect((await db.agentRuns.where('projectId').equals(c).first())?.status).toBe(state)
  })
  it('keeps a completed deterministic fixture prefix under the original stale rule without a second retirement', async () => {
    const f = await fixture(); let snapshot = await createAgentRunV1(await inputFor(f)); const stepId = 'fixture-output'
    const append = async <T extends Parameters<typeof appendAgentRunEventV1>[0]['type']>(type: T, payload: import('../../src/lib/types').AgentRunEventPayloadByTypeV1[T]) => {
      snapshot = await appendAgentRunEventV1({ scope: f.scope, runId: snapshot.run.id, type, payload, expectedLastSequence: snapshot.projection.lastSequence })
    }
    await append('step.scheduled', { stepId }); await append('step.started', { stepId, attempt: 1 })
    const assembled = await assembleContext({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, sourceKeys: ['worldview'], inputBudgetMaxTokens: 100 })
    const manifest = await createContextManifestFromAssemblyV1({ runId: snapshot.run.id, stepId, attempt: 1, projectId: f.scope.projectId, worldGroupId: null, declaredSourceKeys: ['worldview'], assembled })
    await append('context.assembled', { stepId, attempt: 1, manifestHash: manifest.manifestHash })
    await append('model.requested', { stepId, attempt: 1, bindingHash: 'a'.repeat(64) })
    // Engineering-only synthetic response; this fixture has no formal write or author-acceptance criterion.
    const observed = await Promise.resolve(RAW); const saved = await raw(snapshot.run.id, f.scope, observed); snapshot = saved.snapshot
    const outputHash = await hashCanonicalValue({ raw: observed })
    await append('model.responded', { stepId, attempt: 1, outputHash })
    await append('candidate.persisted', { stepId, attempt: 1, candidateHash: outputHash, requiresConfirmation: false })
    await append('step.succeeded', { stepId, attempt: 1, outputHash })
    await append('verification.started', { verifierSetVersion: 'node-lifecycle-fixture' })
    const receipt = await createVerificationReceiptV1({ version: 1, runId: snapshot.run.id, generation: 1, contractHash: snapshot.run.contractHash,
      contextManifestHashes: [manifest.manifestHash], candidateHashes: [outputHash], adoptionEventIds: [], postStateHash: outputHash,
      verifierSetVersion: 'node-lifecycle-fixture', criteria: [{ id: 'output', status: 'passed', evidenceRefs: [saved.artifact.contentHash] }], acceptedAt: Date.now() })
    await append('verification.accepted', { receiptHash: receipt.receiptHash })
    expect(snapshot.projection.state).toBe('completed')
    const original = await exportProjectJSON(f.scope.projectId); const a = await importProjectJSON(original); const b = await exportProjectJSON(a)
    expect(b.agentRunEvents.slice(0, original.agentRunEvents.length)).toEqual(original.agentRunEvents)
    expect(JSON.parse(b.agentRunEvents[b.agentRunEvents.length - 1]!.payloadJson)).toEqual({ previousReceiptHash: receipt.receiptHash, reason: 'project-import-scope-rebound' })
    const c = await importProjectJSON(b); expect((await exportProjectJSON(c)).agentRunEvents).toEqual(b.agentRunEvents)
  })
  it('rejects duplicate portable tuples without changing either source or any database row', async () => {
    const f = await fixture(); await createAgentRunV1(await inputFor(f)); const input = await inputFor(f); input.nodeProducer!.nodeProducerVariantIndex = 1; await createAgentRunV1(input)
    const exported = await exportProjectJSON(f.scope.projectId)
    exported.agentRuns![1]!.nodeProducerVariantIndex = 0
    const before = await allRows(); const original = JSON.stringify(exported)
    await expect(importProjectJSON(exported)).rejects.toThrow(/重复/)
    expect(await allRows()).toEqual(before); expect(JSON.stringify(exported)).toBe(original)
  })
  it.each(['nodeProducerNodeId', 'nodeProducerVariantIndex', 'nodeProducerAttempt'] as const)('rejects a portable tuple missing %s before completing import', async field => {
    const f = await fixture(); await createAgentRunV1(await inputFor(f)); const exported = await exportProjectJSON(f.scope.projectId)
    delete exported.agentRuns![0]![field]; const before = await allRows()
    await expect(importProjectJSON(exported)).rejects.toThrow(/节点|nodeProducer/); expect(await allRows()).toEqual(before)
  })
  it('rejects active cross-Work links even when every local ID maps in the same Project', async () => {
    const f = await fixture(); const workId = await db.works.add(currentWorkFixtureRecordV1({ projectId: f.scope.projectId, worldId: f.scope.worldId, title: 'other Work' })) as number
    const other = await fixture('other', { ...f.scope, workId }); const run = await createAgentRunV1(await inputFor(f))
    await db.agentRuns.update(run.run.id, { nodeRunId: other.nodeRunId }); const before = await allRows()
    await expect(exportProjectJSON(f.scope.projectId)).rejects.toThrow(/Work/); expect(await allRows()).toEqual(before)
  })
  it.each(['export', 'import'] as const)('rejects a foreign-World group in the complete portable relation: %s', async operation => {
    const f = await fixture(); const otherWorld = await addCurrentWorldFixtureV1({ projectId: f.scope.projectId, name: 'portable World B' })
    const groupId = await useWorldGroupStore.getState().createGroup({ projectId: f.scope.projectId, name: 'portable group', description: '', type: 'parallel', order: 0 }, f.scope)
    await useNodeFlowStore.getState().saveFlow({ ...(await db.nodeFlows.get(f.flowId))!, worldGroupId: groupId })
    const input = await inputFor(f); input.worldGroupId = groupId; input.contract = { ...contract(f.scope), scope: { projectId: f.scope.projectId, worldGroupId: groupId } }
    await createAgentRunV1(input)
    if (operation === 'export') {
      // Deliberate corrupt owner metadata; original contract/events/hash are untouched.
      await db.worldGroups.update(groupId, { updatedAt: Date.now(), ...{ worldId: otherWorld.id! } })
      const before = await allRows(); await expect(exportProjectJSON(f.scope.projectId)).rejects.toThrow(/World|世界/); expect(await allRows()).toEqual(before)
    } else {
      const exported = await exportProjectJSON(f.scope.projectId)
      const group = exported.worldGroups![0] as unknown as Record<string, unknown>
      expect(group._worldOwnerExportId).toBeDefined()
      const foreign = exported.worlds!.findIndex(row => row.code === otherWorld.code); expect(foreign).toBeGreaterThanOrEqual(0)
      group._worldOwnerExportId = foreign
      const before = await allRows(); const original = JSON.stringify(exported)
      await expect(importProjectJSON(exported)).rejects.toThrow(/World|世界/)
      expect(await allRows()).toEqual(before); expect(JSON.stringify(exported)).toBe(original)
    }
  })
  it('preserves healthy required scalar index zero and rejects another registered broken required FK', async () => {
    const f = await fixture(); const exported = await exportProjectJSON(f.scope.projectId)
    expect(exported.nodeRuns![0]!._flowExportId).toBe(0)
    await db.nodeRuns.update(f.nodeRunId, { flowId: 999999 }); const before = await allRows()
    await expect(exportProjectJSON(f.scope.projectId)).rejects.toThrow(/nodeRuns.flowId/); expect(await allRows()).toEqual(before)
  })
  it('refuses native dangling link export instead of projecting it to a fake null detach', async () => {
    const f = await fixture(); const run = await createAgentRunV1(await inputFor(f)); await db.nodeRuns.delete(f.nodeRunId)
    const before = await allRows(); await expect(exportProjectJSON(f.scope.projectId)).rejects.toThrow(); expect(await allRows()).toEqual(before)
    expect((await db.agentRuns.get(run.run.id))?.nodeRunId).toBe(f.nodeRunId)
  })
  it('rejects a damaged portable Work/Node tuple and rolls the entire import back', async () => {
    const f = await fixture(); await createAgentRunV1(await inputFor(f)); const second = await seedCurrentWorkspace('foreign Work')
    const exported = await exportProjectJSON(f.scope.projectId)
    const row = exported.agentRuns![0] as unknown as Record<string, unknown>; row._nodeRunExportId = 987654
    const before = await allRows(); await expect(importProjectJSON(exported)).rejects.toThrow(); expect(await allRows()).toEqual(before)
    expect(await db.works.get(second.scope.workId)).toBeDefined()
  })
  it('keeps pending exact evidence pinned and follows existing Work deletion/GC', async () => {
    const f = await fixture(); const foreign = await fixture('foreign Project'); const run = await createAgentRunV1(await inputFor(f)); const saved = await raw(run.run.id, f.scope)
    const other = await createAgentRunV1(await inputFor(foreign)); const otherSaved = await raw(other.run.id, foreign.scope); const foreignBefore = await db.agentRuns.get(other.run.id)
    await expect(pruneAgentRunArtifactsExplicitlyV1({ projectId: f.scope.projectId, targets: [{ artifactKind: 'raw-response', contentHash: saved.artifact.contentHash }] })).rejects.toThrow(/live.run|未终结/i)
    await deleteWork(f.scope.workId); expect(await db.agentRuns.get(run.run.id)).toBeUndefined()
    expect(await db.agentRuns.get(other.run.id)).toEqual(foreignBefore); await expectRaw(foreign.scope.projectId, otherSaved.artifact.contentHash)
  })
  it('retains the same physical raw body and every sibling Work record after deleting its other owner', async () => {
    const f = await fixture(); const workId = await db.works.add(currentWorkFixtureRecordV1({ projectId: f.scope.projectId, worldId: f.scope.worldId, title: 'retained sibling Work' })) as number
    const sibling = await fixture('sibling', { ...f.scope, workId }); const a = await createAgentRunV1(await inputFor(f)); const b = await createAgentRunV1(await inputFor(sibling))
    const rawA = await raw(a.run.id, f.scope); const rawB = await raw(b.run.id, sibling.scope); expect(rawA.artifact.id).toBe(rawB.artifact.id)
    const before = { run: await db.agentRuns.get(b.run.id), node: await db.nodeRuns.get(sibling.nodeRunId), flow: await db.nodeFlows.get(sibling.flowId), work: await db.works.get(workId) }
    await deleteWork(f.scope.workId)
    expect({ run: await db.agentRuns.get(b.run.id), node: await db.nodeRuns.get(sibling.nodeRunId), flow: await db.nodeFlows.get(sibling.flowId), work: await db.works.get(workId) }).toEqual(before)
    await expectRaw(f.scope.projectId, rawB.artifact.contentHash)
  })
  it('captures the registered current snapshot in an actual caller-owned native transaction with zero DB writes', async () => {
    const f = await fixture(); const run = await createAgentRunV1(await inputFor(f)); await raw(run.run.id, f.scope)
    const before = await allRows()
    const internal = await db.transaction('r', transactionTablesFor('importProject'), () =>
      deriveStrictExportProjectSnapshotInCurrentTransaction(f.scope.projectId, { worldId: f.scope.worldId, workId: f.scope.workId }))
    expect(internal.data.version).toBe(CURRENT_EXPORT_VERSION)
    expect(internal.data.agentRuns![0]!._nodeRunExportId).toBe(0)
    expect(internal.data.nodeRuns![0]!._flowExportId).toBe(0)
    expect(await allRows()).toEqual(before)
  })
  // Keep the isolated second module/connection after dynamic import controls.
  it('enforces tuple uniqueness across two real IndexedDB connections', async () => {
    const f = await fixture(); const input = await inputFor(f)
    vi.resetModules()
    const otherModule = await import('../../src/lib/agent/run/event-store')
    const { db: otherDb } = await import('../../src/lib/db/schema')
    expect(otherDb).not.toBe(db); await otherDb.open()
    try {
      const result = await Promise.allSettled([createAgentRunV1(input), otherModule.createAgentRunV1(structuredClone(input))])
      expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(1)
      expect(result.filter(item => item.status === 'rejected')).toHaveLength(1)
      expect(await db.agentRuns.count()).toBe(1); expect(await db.agentRunEvents.count()).toBe(2)
    } finally { otherDb.close() }
  })

})
