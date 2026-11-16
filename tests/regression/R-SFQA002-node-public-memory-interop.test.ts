/** Mainline-compatible Node lifecycle consumers. Uses the current registry
 * export format, not a fixed backup version or a fixed database table count.
 * Synthetic observations do not claim a real Node field production/adoption. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { appendAgentRunEventV1, createAgentRunV1, readAgentRunV1, type AgentRunSnapshotV1, type CreateAgentRunV1Input } from '../../src/lib/agent/run/event-store'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { createContextManifestFromAssemblyV1 } from '../../src/lib/agent/run/context-manifest'
import { recordCreationModelRequestV1, recordCreationModelResponseV1, recordUnavailableCreationResponseV1 } from '../../src/lib/agent/run/creation-response-evidence'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { buildMemoryArtifactIndexV1 } from '../../src/lib/memory/settlement'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { exportWorkspacePackageFromProjectV1, importWorkspacePackageV1 } from '../../src/lib/memory/workspace-projection'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'
import { useNodeFlowStore } from '../../src/stores/node-flow'
import type { AgentRunEventPayloadByTypeV1, AgentRunEventTypeV1, NodeFlow, NodeRunRecord, WorkspaceScope } from '../../src/lib/types'

const RAW = '\r\n  {"field":"theme","value":"e\u0301 与 é 保持原字节 🌙"}\n\t '
const OBSERVED_USAGE = { inputTokens: 11, outputTokens: 7, totalTokens: 18 }

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

async function allRows() {
  return Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])))
}
async function importedNode(input: { detached?: boolean } = {}) {
  const f = await fixture('D5 memory interoperability')
  const original = await createAgentRunV1(await inputFor(f))
  if (input.detached) await useNodeFlowStore.getState().removeFlow(f.flowId)
  const exported = await exportProjectJSON(f.scope.projectId)
  expect(exported.agentRuns[0]).toHaveProperty('_nodeRunExportId')
  const before = JSON.stringify(exported)
  const projectId = await importProjectJSON(exported)
  expect(JSON.stringify(exported)).toBe(before)
  const runs = await db.agentRuns.where('projectId').equals(projectId).toArray()
  expect(runs).toHaveLength(1)
  const run = runs[0]!
  const work = await db.works.get(run.workId!)
  expect(work).toBeDefined()
  const scope = { projectId, worldId: work!.worldId, workId: work!.id! }
  const snapshot = await readAgentRunV1(scope, run.id!)
  expect(snapshot.projection.errors).toEqual([])
  expect(snapshot.projection.state).toBe('cancelled')
  expect(snapshot.events.map(event => event.type)).toEqual(['run.created', 'contract.accepted', 'run.cancelled'])
  expect(snapshot.events[2]!.payload).toEqual({ reason: 'project-import-node-producer-readonly' })
  expect(snapshot.projection.memorySettlement).toBeUndefined()
  expect(await db.agentRunCheckpoints.where('projectId').equals(projectId).count()).toBe(0)
  return { original, scope, run, snapshot }
}
async function append<T extends AgentRunEventTypeV1>(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1,
  type: T, payload: AgentRunEventPayloadByTypeV1[T]) {
  return appendAgentRunEventV1({ scope, runId: snapshot.run.id, type, payload,
    expectedLastSequence: snapshot.projection.lastSequence })
}
async function onlyRun(projectId: number) {
  const rows = await db.agentRuns.where('projectId').equals(projectId).toArray()
  expect(rows).toHaveLength(1)
  const run = rows[0]!, work = await db.works.get(run.workId!)
  expect(work).toBeDefined()
  const scope = { projectId, worldId: work!.worldId, workId: work!.id! }
  return { scope, snapshot: await readAgentRunV1(scope, run.id!) }
}
async function exactBodies(projectId: number) {
  return (await db.agentRunArtifacts.where('projectId').equals(projectId).toArray())
    .map(row => ({ artifactKind: row.artifactKind, contentHash: row.contentHash, content: row.content, byteLength: row.byteLength }))
    .sort((a, b) => `${a.artifactKind}:${a.contentHash}`.localeCompare(`${b.artifactKind}:${b.contentHash}`))
}
async function assertExactBodies(projectId: number, original: Awaited<ReturnType<typeof exactBodies>>) {
  expect(await exactBodies(projectId)).toEqual(original)
  for (const row of original) {
    expect(await readAgentRunArtifactExactV1({ projectId, artifactKind: row.artifactKind, contentHash: row.contentHash })).toBe(row.content)
  }
}
/** These are public-engine engineering observations. There is one deterministic
 * callback, no physical transport/model and no field adoption/author receipt. */
async function observedNode(outcome: 'unavailable' | 'returned') {
  const f = await fixture(`Node observed ${outcome}`)
  let snapshot = await createAgentRunV1(await inputFor(f))
  const stepId = 'fixture-output', attempt = 1
  snapshot = await append(f.scope, snapshot, 'step.scheduled', { stepId })
  snapshot = await append(f.scope, snapshot, 'step.started', { stepId, attempt })
  const assembled = await assembleContext({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null,
    sourceKeys: ['worldview'], inputBudgetMaxTokens: 100 })
  const manifest = await createContextManifestFromAssemblyV1({ runId: snapshot.run.id, stepId, attempt,
    projectId: f.scope.projectId, worldGroupId: null, declaredSourceKeys: ['worldview'], assembled })
  snapshot = await append(f.scope, snapshot, 'context.assembled', { stepId, attempt, manifestHash: manifest.manifestHash })
  const prepared = await recordCreationModelRequestV1({ scope: f.scope, snapshot, stepId, attempt,
    contextManifestHash: manifest.manifestHash, messages: [{ role: 'user', content: '保留合成原文的 Unicode 与 CRLF。' }] })
  snapshot = await append(f.scope, prepared.snapshot, 'model.requested', { stepId, attempt, bindingHash: 'a'.repeat(64) })
  if (outcome === 'unavailable') {
    const error = new Error('synthetic observation: dispatched, complete response unavailable')
    const unavailable = await recordUnavailableCreationResponseV1({ snapshot, request: prepared.request, error,
      result: { requestLifecycle: { phase: 'request-dispatched', responseStatus: null } } })
    expect(unavailable.error).toBe(error)
    expect(unavailable.observation.usage).toBeNull()
    expect(unavailable.persistenceFailures).toEqual([])
    snapshot = unavailable.snapshot
  } else {
    const observed = await Promise.resolve({ raw: RAW, result: { usage: { ...OBSERVED_USAGE }, finishReason: 'stop',
      requestLifecycle: { phase: 'response-observed' as const, responseStatus: 200 } } })
    snapshot = await recordCreationModelResponseV1({ snapshot, request: prepared.request, ...observed })
    snapshot = await append(f.scope, snapshot, 'model.responded', { stepId, attempt, outputHash: await hashCanonicalValue({ raw: observed.raw }) })
  }
  const bodies = await exactBodies(f.scope.projectId)
  expect(bodies.filter(row => row.artifactKind === 'rendered-request')).toHaveLength(1)
  expect(bodies.filter(row => row.artifactKind === 'raw-response')).toHaveLength(outcome === 'returned' ? 1 : 0)
  return { ...f, snapshot, stepId, attempt, manifest, bodies }
}
async function fullPackageRoundtrip(projectId: number) {
  const pkg = await exportWorkspacePackageFromProjectV1(projectId), bytes = JSON.stringify(pkg)
  await cascadeDeleteProject(projectId)
  const restored = await importWorkspacePackageV1(pkg)
  expect(JSON.stringify(pkg)).toBe(bytes)
  return { pkg, bytes, restored }
}
beforeEach(async () => {
  await db.delete(); await db.open()
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No network/model belongs to this import fixture') }))
})
afterEach(async () => {
  expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); await db.delete()
})

describe('SFQA002 public Node memory interoperability', () => {
  it('keeps an ordinary planned no-tuple import and derived index unchanged', async () => {
    const f = await fixture('legacy no-tuple')
    await createAgentRunV1({ scope: f.scope, contract: contract(f.scope) })
    const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    const rows = await db.agentRuns.where('projectId').equals(projectId).toArray()
    expect(rows).toHaveLength(1); expect(rows[0]!.status).toBe('planned')
    expect(rows[0]!.nodeProducerNodeId).toBeUndefined()
    const before = await allRows()
    const index = await buildMemoryArtifactIndexV1(projectId, { projectedWorkspaceDirty: false })
    expect(index.runs).toHaveLength(1)
    expect(index.runs[0]).toMatchObject({ state: 'incomplete', settlementSource: 'derived-current', settlementReceiptHash: null })
    expect(await allRows()).toEqual(before)
  })
  it('indexes a real planned/no-checkpoint Node import as incomplete without inventing a settlement', async () => {
    const f = await importedNode()
    const before = await allRows()
    const index = await buildMemoryArtifactIndexV1(f.scope.projectId, { projectedWorkspaceDirty: false })
    expect(index.runs).toHaveLength(1)
    expect(index.runs[0]).toMatchObject({ state: 'incomplete', settlementSource: 'derived-current', settlementReceiptHash: null, terminalReceiptHash: null })
    expect((await readAgentRunV1(f.scope, f.run.id!)).events).toEqual(f.snapshot.events)
    expect(await allRows()).toEqual(before)
  })
  it('keeps detached nullable Node provenance without requiring a deleted Flow or NodeRun', async () => {
    const f = await importedNode({ detached: true })
    expect(f.run.nodeRunId).toBeNull(); expect(f.run.nodeProducerNodeId).toBe('story-theme')
    expect(await db.nodeRuns.where('projectId').equals(f.scope.projectId).count()).toBe(0)
    const before = await allRows()
    const index = await buildMemoryArtifactIndexV1(f.scope.projectId, { projectedWorkspaceDirty: false })
    expect(index.runs[0]).toMatchObject({ state: 'incomplete', settlementSource: 'derived-current', settlementReceiptHash: null })
    expect(await allRows()).toEqual(before)
  })
  it('still verifies actual ordinary terminal settlement even if its author reason copies the import wording', async () => {
    const f = await fixture('ordinary author cancellation')
    const created = await createAgentRunV1({ scope: f.scope, contract: contract(f.scope) })
    const snapshot = await appendAgentRunEventV1({ scope: f.scope, runId: created.run.id, type: 'run.cancelled', payload: { reason: 'project-import-node-producer-readonly' } })
    expect(snapshot.events.filter(event => event.type === 'memory.settlement.recorded')).toHaveLength(1)
    const before = await allRows()
    const index = await buildMemoryArtifactIndexV1(f.scope.projectId, { projectedWorkspaceDirty: false })
    expect(index.runs[0]?.settlementSource).toBe('terminal-event')
    expect(index.runs[0]?.settlementReceiptHash).toBe(snapshot.projection.memorySettlement?.receiptHash)
    expect(await allRows()).toEqual(before)
  })
  it('does not let the import reason exempt a malformed operational tuple', async () => {
    const f = await importedNode()
    await db.agentRuns.update(f.run.id!, { nodeProducerNodeId: undefined })
    const before = await allRows()
    await expect(buildMemoryArtifactIndexV1(f.scope.projectId, { projectedWorkspaceDirty: false })).rejects.toThrow(/nodeProducer|节点|关联/i)
    expect(await allRows()).toEqual(before)
  })
  it('restores a current public package with only the exact Node retirement transition', async () => {
    const f = await fixture('public planned Node package')
    await createAgentRunV1(await inputFor(f))
    const pkg = await exportWorkspacePackageFromProjectV1(f.scope.projectId)
    const raw = JSON.stringify(pkg)
    await cascadeDeleteProject(f.scope.projectId)
    const restored = await importWorkspacePackageV1(pkg)
    expect(restored.reboundHarnessRunCount).toBe(1)
    expect(restored.report.plan.items.filter(row => row.changeKind !== 'clean').map(row => row.identity.documentKind).sort())
      .toEqual(['recovery-capsule'])
    // A planned Run and its exact read-only retirement both derive incomplete
    // with no artifacts or settlement. The original memory index stays equal.
    const indexItem = restored.report.plan.items.find(row => row.identity.documentKind === 'memory-artifact-index')
    expect(indexItem).toBeDefined()
    expect(indexItem!.changeKind).toBe('clean')
    expect(indexItem!.databaseCanonicalHash).toBe(indexItem!.fileCanonicalHash)
    expect(indexItem!.baselineCanonicalHash).toBe(indexItem!.fileCanonicalHash)
    expect(JSON.stringify(pkg)).toBe(raw)
    const rows = await db.agentRuns.where('projectId').equals(restored.projectId).toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'cancelled', nodeProducerNodeId: 'story-theme', nodeProducerVariantIndex: 0, nodeProducerAttempt: 1 })
    const index = await buildMemoryArtifactIndexV1(restored.projectId, { projectedWorkspaceDirty: false })
    expect(index.runs[0]).toMatchObject({ state: 'incomplete', settlementSource: 'derived-current', settlementReceiptHash: null })
    const events = await db.agentRunEvents.where('runId').equals(rows[0]!.id!).sortBy('sequence')
    expect(events.map(event => event.type)).toEqual(['run.created', 'contract.accepted', 'run.cancelled'])
    expect(JSON.parse(events[2]!.payloadJson)).toEqual({ reason: 'project-import-node-producer-readonly' })
  })
  it('restores actual requested/unavailable engineering evidence without manufacturing a raw response or usage', async () => {
    const f = await observedNode('unavailable')
    const original = await exportProjectJSON(f.scope.projectId), bytes = JSON.stringify(original)
    expect(original.agentRunEvents.filter(row => row.type === 'model.requested')).toHaveLength(1)
    expect(original.agentRunEvents.filter(row => row.type === 'model.responded')).toHaveLength(0)
    const observation = f.bodies.find(row => row.artifactKind === 'tool-result')!
    expect(JSON.parse(observation.content!)).toMatchObject({ observation: { outcome: 'unavailable', usage: null,
      requestLifecycle: { phase: 'request-dispatched', responseStatus: null } } })
    const { restored } = await fullPackageRoundtrip(f.scope.projectId)
    const current = await onlyRun(restored.projectId), reexported = await exportProjectJSON(restored.projectId)
    expect(reexported.agentRunEvents.slice(0, original.agentRunEvents.length)).toEqual(original.agentRunEvents)
    expect(JSON.stringify(original)).toBe(bytes)
    expect(current.snapshot.events[current.snapshot.events.length - 1]?.type).toBe('run.cancelled')
    expect(current.snapshot.events.some(event => event.type === 'memory.settlement.recorded')).toBe(false)
    await assertExactBodies(restored.projectId, f.bodies)
    const index = await buildMemoryArtifactIndexV1(restored.projectId, { projectedWorkspaceDirty: false })
    expect(index.runs[0]).toMatchObject({ state: 'incomplete', settlementSource: 'derived-current', settlementReceiptHash: null })
  })
  it('restores the exact observed Unicode/CRLF raw response and synthetic observable usage before any adoption', async () => {
    const f = await observedNode('returned'), original = await exportProjectJSON(f.scope.projectId)
    const raw = f.bodies.find(row => row.artifactKind === 'raw-response')!
    expect(JSON.parse(raw.content!)).toMatchObject({ raw: RAW, observation: { outcome: 'returned', usage: OBSERVED_USAGE } })
    expect(f.snapshot.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
    expect(f.snapshot.events.filter(event => event.type === 'model.responded')).toHaveLength(1)
    const { restored } = await fullPackageRoundtrip(f.scope.projectId), current = await onlyRun(restored.projectId)
    expect((await exportProjectJSON(restored.projectId)).agentRunEvents.slice(0, original.agentRunEvents.length)).toEqual(original.agentRunEvents)
    expect(current.snapshot.events.filter(event => event.type === 'adoption.committed')).toHaveLength(0)
    expect(current.snapshot.events.filter(event => event.type === 'verification.accepted')).toHaveLength(0)
    await assertExactBodies(restored.projectId, f.bodies)
    expect(JSON.parse((await readAgentRunArtifactExactV1({ projectId: restored.projectId, artifactKind: 'raw-response', contentHash: raw.contentHash }))!).raw).toBe(RAW)
  })
  it.each(['sequence', 'contract-hash', 'future-clock'] as const)('rejects a deliberately corrupted actual import tail: %s, without re-signing or rewriting any old prefix', async mutation => {
    const f = await importedNode(), rows = await db.agentRunEvents.where('runId').equals(f.run.id!).sortBy('sequence')
    const tail = rows[rows.length - 1]!, prefix = rows.slice(0, -1)
    if (mutation === 'sequence') await db.agentRunEvents.update(tail.id!, { sequence: tail.sequence + 1 })
    if (mutation === 'contract-hash') await db.agentRunEvents.update(tail.id!, { contractHash: 'f'.repeat(64) })
    if (mutation === 'future-clock') {
      const future = Date.now() + 60_000
      await db.agentRunEvents.update(tail.id!, { createdAt: future })
      await db.agentRuns.update(f.run.id!, { updatedAt: future })
    }
    const before = await allRows()
    await expect(buildMemoryArtifactIndexV1(f.scope.projectId, { projectedWorkspaceDirty: false })).rejects.toThrow()
    expect(await db.agentRunEvents.bulkGet(prefix.map(row => row.id!))).toEqual(prefix)
    expect(await allRows()).toEqual(before)
  })
})
