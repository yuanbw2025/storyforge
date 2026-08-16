import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createContextManifestV1, createContextManifestV2FromV1, verifyContextManifestIntegrityV2 } from '../../src/lib/agent/run/context-manifest'
import { appendAgentRunEventV1, createAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { generateWorkspaceUid } from '../../src/lib/memory/identity'
import { buildMemoryArtifactIndexV1, evaluateMemorySettlementBarrierV1 } from '../../src/lib/memory/settlement'
import { buildWorkspaceSelfCheckReportV1, synchronizeProjectChangesToFolderV1 } from '../../src/lib/memory/workspace-projection'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import aiEntryRegistry from '../../src/lib/agent/ai-entry-registry.json'

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
  const projectId = await db.projects.add({
    workspaceUid: generateWorkspaceUid(), name: '沉淀屏障', genre: 'fantasy', genres: [], status: 'drafting',
    description: '', targetWordCount: 100, createdAt: now, updatedAt: now,
  } as any) as number
  const ownership = await ensureWorkspaceOwnership(projectId)
  const outlineNodeId = await db.outlineNodes.add({
    projectId, workId: ownership.scope.workId, parentId: null, type: 'chapter', title: '一', summary: '', order: 0,
    createdAt: now, updatedAt: now,
  } as any) as number
  const chapterId = await db.chapters.add({
    projectId, workId: ownership.scope.workId, outlineNodeId, title: '一', content: '<p>正文</p>', wordCount: 2,
    status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
  } as any) as number
  return { projectId, chapterId, scope: ownership.scope }
}

describe('MEMORY-8 · Harness settlement and ContextManifestV2', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('keeps every formal UI model entry governed while auxiliary entries remain explicitly non-Canon', () => {
    expect(aiEntryRegistry.entries.every(entry => ['governed', 'auxiliary'].includes(entry.status))).toBe(true)
    expect(aiEntryRegistry.entries.filter(entry => entry.status === 'governed')
      .every(entry => ['durable-run', 'generation-node', 'simulation-runtime'].includes(entry.mechanism))).toBe(true)
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

    const beforeSync = await evaluateMemorySettlementBarrierV1({ scope: seeded.scope, runId: snapshot.run.id })
    expect(beforeSync.state).toBe('settled')
    expect(beforeSync.workspaceDirty).toBe(true)
    expect(beforeSync.artifactRefs.some(ref => ref.authority === 'accepted' && ref.contentHash === HASH_C)).toBe(true)
    expect(beforeSync.artifactRefs.some(ref => ref.contentHash === HASH_A && ref.sourceKind === 'domain-record')).toBe(true)

    const index = await buildMemoryArtifactIndexV1(seeded.projectId)
    expect(index.runs).toHaveLength(1)
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
})
