import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { createContextManifestV1, createContextManifestV2FromV1, verifyContextManifestIntegrityV2 } from '../../src/lib/agent/run/context-manifest'
import {
  appendAgentRunEventV1,
  appendPrivilegedAgentRunEventInTransactionV1,
  createAgentRunV1,
  readAgentRunV1,
  readVerifiedAgentRunInTransactionV1,
} from '../../src/lib/agent/run/event-store'
import { parseAgentRunEventV1 } from '../../src/lib/agent/run/event-schema'
import { buildMemoryArtifactIndexV1, evaluateMemorySettlementBarrierV1 } from '../../src/lib/memory/settlement'
import { buildWorkspaceSelfCheckReportV1, synchronizeProjectChangesToFolderV1 } from '../../src/lib/memory/workspace-projection'
import * as settlementCore from '../../src/lib/memory/settlement-core'
import aiEntryRegistry from '../../src/lib/agent/ai-entry-registry.json'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)

function notFound(): DOMException { return new DOMException('not found', 'NotFoundError') }

function memoryDirectory(): FileSystemDirectoryHandle {
  type Dir = { files: Map<string, string>; dirs: Map<string, Dir> }
  const root: Dir = { files: new Map(), dirs: new Map() }
  const handle = (dir: Dir, name: string): FileSystemDirectoryHandle => ({
    kind: 'directory', name,
    async getDirectoryHandle(part: string, options?: { create?: boolean }) {
      let child = dir.dirs.get(part)
      if (!child && options?.create) { child = { files: new Map(), dirs: new Map() }; dir.dirs.set(part, child) }
      if (!child) throw notFound()
      return handle(child, part)
    },
    async getFileHandle(fileName: string, options?: { create?: boolean }) {
      if (!dir.files.has(fileName) && !options?.create) throw notFound()
      if (!dir.files.has(fileName)) dir.files.set(fileName, '')
      return {
        kind: 'file', name: fileName,
        async getFile() { const text = dir.files.get(fileName)!; return { async text() { return text } } as File },
        async createWritable() {
          let text = ''
          return {
            async write(value: string | Blob | BufferSource) { text += String(value) },
            async close() { dir.files.set(fileName, text) },
          } as FileSystemWritableFileStream
        },
      } as FileSystemFileHandle
    },
  } as FileSystemDirectoryHandle)
  return handle(root, 'memory')
}

async function seed() {
  const now = Date.now()
  const created = await seedCurrentWorkspace('沉淀屏障')
  const { scope } = created
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
    projectId: scope.projectId,
    parentId: null,
    type: 'chapter',
    title: '一',
    summary: '',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' })) as number
  const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', {
    projectId: scope.projectId,
    outlineNodeId,
    title: '一',
    content: '<p>正文</p>',
    wordCount: 2,
    status: 'draft',
    order: 0,
    notes: '',
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' })) as number
  return { projectId: scope.projectId, chapterId, scope }
}

describe('MEMORY-8 · Harness settlement and ContextManifestV2', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('keeps every formal UI model entry governed while auxiliary entries remain explicitly non-Canon', () => {
    const formalEntries = aiEntryRegistry.entries.filter(entry => entry.entryKind === 'formal')
    expect(formalEntries
      .every(entry => ['durable-run', 'generation-node', 'authoring-draft', 'product-runtime']
        .includes(entry.executionBoundary))).toBe(true)
    expect(formalEntries.filter(entry => entry.executionBoundary === 'authoring-draft')
      .every(entry => entry.adoptAllowed === true
        && 'adoptionTargets' in entry
        && entry.adoptionTargets.length > 0)).toBe(true)
    expect(aiEntryRegistry.entries.filter(entry => entry.entryKind !== 'formal')
      .every(entry => entry.adoptAllowed === false && !('adoptionTargets' in entry))).toBe(true)
  })

  it('derives accepted memory references from one durable ledger and exposes disk dirty until sync', async () => {
    const seeded = await seed()
    let snapshot = await createAgentRunV1({
      scope: seeded.scope,
      contract: {
        version: 1,
        objective: '生成并由作者采纳章节标题候选',
        workflowKind: 'direct-generation',
        scope: { projectId: seeded.projectId, worldGroupId: null, chapterIds: [seeded.chapterId] },
        runtimeBindingHash: HASH_A,
        permissions: {
          contextSourceKeys: ['chapterContent'],
          writeTargets: [{ table: 'chapters', fields: ['title'], mode: 'author-confirmed' }],
        },
        budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 1000, maxOutputTokens: 100, maxAttemptsPerStep: 1 },
        acceptance: [{ id: 'title.adoption', kind: 'adoption-committed', required: true }],
        verificationPlan: [{ id: 'title.terminal', kind: 'terminal', verifier: 'memory-test-v1', criterionIds: ['title.adoption'] }],
        failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
      },
    })
    const manifest = await createContextManifestV1({
      version: 1, runId: snapshot.run.id, stepId: 'title', attempt: 1,
      scope: { projectId: seeded.projectId, worldGroupId: null },
      inputBudget: 1000, totalInputTokens: 2,
      sources: [{ key: 'chapterContent', status: 'included', contentHash: HASH_A, tokens: 2 }],
    })
    const append = async (type: any, payload: any) => {
      snapshot = await appendAgentRunEventV1({
        scope: seeded.scope, runId: snapshot.run.id, type, payload,
        expectedLastSequence: snapshot.projection.lastSequence,
      } as any)
    }
    await append('step.scheduled', { stepId: 'title' })
    await append('step.started', { stepId: 'title', attempt: 1 })
    await append('context.assembled', { stepId: 'title', attempt: 1, manifestHash: manifest.manifestHash })
    await append('model.requested', { stepId: 'title', attempt: 1, bindingHash: HASH_A })
    await append('model.responded', { stepId: 'title', attempt: 1, outputHash: HASH_B })
    await append('candidate.persisted', { stepId: 'title', attempt: 1, candidateHash: HASH_C, requiresConfirmation: true })
    expect((await evaluateMemorySettlementBarrierV1({ scope: seeded.scope, runId: snapshot.run.id })).state)
      .toBe('awaiting-confirmation')
    await append('confirmation.recorded', { stepId: 'title', candidateHash: HASH_C, decision: 'adopt' })
    await append('adoption.started', { stepId: 'title', candidateHash: HASH_C })
    await append('adoption.committed', { stepId: 'title', candidateHash: HASH_C, adoptionHash: HASH_A })
    await append('step.succeeded', { stepId: 'title', attempt: 1, outputHash: HASH_B })
    await append('verification.started', { verifierSetVersion: 'memory-test-v1' })
    await append('verification.accepted', { receiptHash: HASH_B })
    expect(snapshot.events.slice(-2).map(event => event.type)).toEqual([
      'verification.accepted',
      'memory.settlement.recorded',
    ])
    expect(snapshot.projection.memorySettlement).toMatchObject({
      state: 'settled', terminalReceiptHash: HASH_B, workspaceDirty: true,
    })

    const beforeSync = await evaluateMemorySettlementBarrierV1({ scope: seeded.scope, runId: snapshot.run.id })
    expect(beforeSync.state).toBe('settled')
    expect(beforeSync.workspaceDirty).toBe(true)
    expect(beforeSync.artifactRefs.some(ref => ref.authority === 'accepted' && ref.contentHash === HASH_C)).toBe(true)
    expect(beforeSync.artifactRefs.some(ref => ref.contentHash === HASH_A && ref.sourceKind === 'domain-record')).toBe(true)

    const index = await buildMemoryArtifactIndexV1(seeded.projectId)
    expect(index.runs).toHaveLength(1)
    expect(index.workspaceDirty).toBe(true)
    expect(index.runs[0]).toMatchObject({
      settlementSource: 'terminal-event',
      settlementReceiptHash: snapshot.projection.memorySettlement?.receiptHash,
    })
    expect(index.runs[0].artifactRefs.every(ref => !('text' in ref))).toBe(true)

    const root = memoryDirectory()
    const report = await buildWorkspaceSelfCheckReportV1(seeded.projectId, root)
    await synchronizeProjectChangesToFolderV1({ projectId: seeded.projectId, root, expectedPlanHash: report.plan.planHash })
    expect((await evaluateMemorySettlementBarrierV1({ scope: seeded.scope, runId: snapshot.run.id })).workspaceDirty).toBe(false)

    const v2 = await createContextManifestV2FromV1({ manifest, scope: seeded.scope })
    expect(v2.version).toBe(2)
    expect(v2.v1ManifestHash).toBe(manifest.manifestHash)
    expect(v2.sources[0].provenance.mirrorDocumentIds).toHaveLength(1)
    expect(v2.sources[0].provenance.freshnessStatus).toBe('fresh')
    expect(await verifyContextManifestIntegrityV2(v2)).toBe(true)
  })

  it('rolls terminal completion back atomically when memory governance cannot settle the run', async () => {
    const seeded = await seed()
    let snapshot = await createAgentRunV1({
      scope: seeded.scope,
      contract: {
        version: 1,
        objective: '验证终态与记忆结算必须原子提交',
        workflowKind: 'read-only-audit',
        scope: { projectId: seeded.projectId, worldGroupId: null },
        runtimeBindingHash: HASH_B,
        permissions: {
          contextSourceKeys: ['chapterContent'],
          writeTargets: [],
        },
        budget: {
          maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 100,
          maxOutputTokens: 100, maxAttemptsPerStep: 1,
        },
        acceptance: [{ id: 'audit.output', kind: 'output-present', required: true }],
        verificationPlan: [{
          id: 'audit.terminal', kind: 'terminal', verifier: 'memory-atomic-test-v1',
          criterionIds: ['audit.output'],
        }],
        failurePolicy: {
          onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author',
        },
      },
    })
    const append = async (type: any, payload: any) => {
      snapshot = await appendAgentRunEventV1({
        scope: seeded.scope,
        runId: snapshot.run.id,
        type,
        payload,
        expectedLastSequence: snapshot.projection.lastSequence,
      } as any)
    }
    await append('step.scheduled', { stepId: 'audit' })
    await append('step.started', { stepId: 'audit', attempt: 1 })
    await append('step.succeeded', { stepId: 'audit', attempt: 1, outputHash: HASH_A })
    await append('verification.started', { verifierSetVersion: 'memory-atomic-test-v1' })

    const failure = vi.spyOn(settlementCore, 'hashMemoryArtifactIndexV1')
      .mockRejectedValueOnce(new Error('simulated-memory-settlement-failure'))
    try {
      await expect(appendAgentRunEventV1({
        scope: seeded.scope,
        runId: snapshot.run.id,
        type: 'verification.accepted',
        payload: { receiptHash: HASH_B },
        expectedLastSequence: snapshot.projection.lastSequence,
      })).rejects.toThrow('simulated-memory-settlement-failure')
    } finally {
      failure.mockRestore()
    }

    const persisted = await readAgentRunV1(seeded.scope, snapshot.run.id)
    expect(persisted.projection.state).toBe('verifying')
    expect(persisted.projection.terminalReceiptHash).toBeUndefined()
    expect(persisted.projection.memorySettlement).toBeUndefined()
    expect(persisted.events.at(-1)?.type).toBe('verification.started')
  })

  it('拒绝缺少原子记忆结算事件的损坏终态运行', async () => {
    const seeded = await seed()
    let snapshot = await createAgentRunV1({
      scope: seeded.scope,
      contract: {
        version: 1,
        objective: '验证终态结算完整性',
        workflowKind: 'read-only-audit',
        scope: { projectId: seeded.projectId, worldGroupId: null },
        permissions: { contextSourceKeys: ['chapterContent'], writeTargets: [] },
        runtimeBindingHash: HASH_C,
        budget: {
          maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 100,
          maxOutputTokens: 100, maxAttemptsPerStep: 1,
        },
        acceptance: [{ id: 'current.output', kind: 'output-present', required: true }],
        verificationPlan: [{
          id: 'current.terminal', kind: 'terminal', verifier: 'current-memory-v1',
          criterionIds: ['current.output'],
        }],
        failurePolicy: {
          onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author',
        },
      },
    })
    for (const [type, payload] of [
      ['step.scheduled', { stepId: 'current' }],
      ['step.started', { stepId: 'current', attempt: 1 }],
      ['step.succeeded', { stepId: 'current', attempt: 1, outputHash: HASH_A }],
      ['verification.started', { verifierSetVersion: 'current-memory-v1' }],
    ] as const) {
      snapshot = await appendAgentRunEventV1({
        scope: seeded.scope,
        runId: snapshot.run.id,
        type,
        payload: payload as any,
        expectedLastSequence: snapshot.projection.lastSequence,
      } as any)
    }

    await db.transaction(
      'rw',
      db.projects, db.worlds, db.works, db.agentRuns, db.agentRunEvents,
      async () => {
        const current = await readVerifiedAgentRunInTransactionV1(seeded.scope, snapshot.run.id)
        const corruptedAccepted = parseAgentRunEventV1({
          version: 1,
          runId: current.run.id,
          sequence: current.projection.lastSequence + 1,
          generation: current.projection.generation,
          projectId: current.run.projectId,
          worldGroupId: current.run.worldGroupId ?? null,
          contractHash: current.run.contractHash,
          type: 'verification.accepted',
          createdAt: Date.now(),
          payload: { receiptHash: HASH_B },
        })
        await appendPrivilegedAgentRunEventInTransactionV1(current, corruptedAccepted)
      },
    )

    const corrupted = await readAgentRunV1(seeded.scope, snapshot.run.id)
    expect(corrupted.projection.state).toBe('completed')
    expect(corrupted.projection.memorySettlement).toBeUndefined()
    await expect(buildMemoryArtifactIndexV1(seeded.projectId))
      .rejects.toThrow('缺少当前终态记忆结算事件')
  })

  it('keeps failed terminal settlement receipts verifiable across project export and ID remap', async () => {
    const seeded = await seed()
    let snapshot = await createAgentRunV1({
      scope: seeded.scope,
      contract: {
        version: 1,
        objective: '失败 Run 的记忆结算必须可移植',
        workflowKind: 'direct-generation',
        scope: { projectId: seeded.projectId, worldGroupId: null },
        runtimeBindingHash: HASH_A,
        permissions: { contextSourceKeys: ['chapterContent'], writeTargets: [] },
        budget: {
          maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 100,
          maxOutputTokens: 100, maxAttemptsPerStep: 1,
        },
        acceptance: [{ id: 'portable.output', kind: 'output-present', required: true }],
        verificationPlan: [{
          id: 'portable.terminal', kind: 'terminal', verifier: 'portable-memory-v1',
          criterionIds: ['portable.output'],
        }],
        failurePolicy: {
          onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author',
        },
      },
    })
    snapshot = await appendAgentRunEventV1({
      scope: seeded.scope,
      runId: snapshot.run.id,
      type: 'step.scheduled',
      payload: { stepId: 'portable' },
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    snapshot = await appendAgentRunEventV1({
      scope: seeded.scope,
      runId: snapshot.run.id,
      type: 'run.failed',
      payload: { code: 'author-visible-test-failure', retryable: false },
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    const sourceReceiptHash = snapshot.projection.memorySettlement?.receiptHash
    expect(sourceReceiptHash).toMatch(/^[a-f0-9]{64}$/)

    const importedProjectId = await importProjectJSON(await exportProjectJSON(seeded.projectId))
    const importedIndex = await buildMemoryArtifactIndexV1(importedProjectId)
    expect(importedIndex.runs).toHaveLength(1)
    expect(importedIndex.runs[0]).toMatchObject({
      state: 'incomplete',
      settlementSource: 'terminal-event',
      settlementReceiptHash: sourceReceiptHash,
    })
  })
})
