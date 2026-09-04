import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'
import { buildRagLibrary, updateRagDocumentPolicy } from '../../src/lib/retrieval/rag-library'
import { isPortableResourceUidV1 } from '../../src/lib/context-gateway/resource-uid'
import { createAgentRunV1, deleteAgentRunV1, appendAgentRunEventV1 } from '../../src/lib/agent/run/event-store'
import {
  inspectAgentRunArtifactAvailabilityV1,
  pruneAgentRunArtifactsExplicitlyV1,
  readAgentRunArtifactExactV1,
  recordAgentRunArtifactV1,
} from '../../src/lib/memory/artifact-store'
import { buildMemoryArtifactIndexV1 } from '../../src/lib/memory/settlement'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { WorkspaceScope } from '../../src/lib/types'

async function seedWorkspace(name = 'CTXG-2 资源工程'): Promise<{ projectId: number; scope: WorkspaceScope }> {
  const created = await createWorkspace({
    name,
    genres: ['fantasy'],
    description: '',
    targetWordCount: 1_000_000,
  })
  return { projectId: created.scope.projectId, scope: created.scope }
}

function runContract(projectId: number) {
  return {
    version: 1,
    objective: '验证 exact artifact 原文仓',
    workflowKind: 'read-only-audit',
    runtimeBindingHash: 'a'.repeat(64),
    scope: { projectId, worldGroupId: null },
    permissions: { contextSourceKeys: ['chapterContent'], writeTargets: [] },
    budget: {
      maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 1000,
      maxOutputTokens: 100, maxAttemptsPerStep: 1,
    },
    acceptance: [{ id: 'result', kind: 'output-present', required: true }],
    verificationPlan: [{ id: 'terminal', kind: 'terminal', verifier: 'ctxg2-v1', criterionIds: ['result'] }],
    failurePolicy: {
      onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author',
    },
  }
}

describe('CTXG-2 · stable resource identity and pure catalog', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => {
    vi.restoreAllMocks()
    db.close()
  })

  it('stamps every current resource at creation and rejects identity-missing rows without mutating them', async () => {
    const fixture = await seedWorkspace()
    const now = 1_787_400_000_100
    const stamped = stampNewRecord(fixture.scope, 'worldviews', {
      projectId: fixture.projectId,
      worldGroupId: null,
      worldOrigin: '潮汐退去以后，岛链才显露。',
      createdAt: now,
      updatedAt: now,
    }, { owner: 'world' }) as Record<string, unknown>
    expect(isPortableResourceUidV1(stamped.ragDocumentId, 'worldview')).toBe(true)
    const stampedId = await db.worldviews.add(stamped as any) as number
    const invalidId = await db.worldviews.add({
      projectId: fixture.projectId, worldId: fixture.scope.worldId, worldGroupId: null,
      worldOrigin: '缺少资源身份的非法当前记录', createdAt: now + 1, updatedAt: now + 1,
    } as any) as number

    await expect(buildRagLibrary({ projectId: fixture.projectId, scope: fixture.scope }))
      .rejects.toThrow('identity-missing')
    expect((await db.worldviews.get(invalidId))?.ragDocumentId).toBeUndefined()
    expect((await db.worldviews.get(stampedId))?.ragDocumentId).toBe(stamped.ragDocumentId)
    await db.worldviews.delete(invalidId)
    const beforeCatalog = JSON.stringify(await db.worldviews.where('projectId').equals(fixture.projectId).toArray())
    const catalog1 = await buildRagLibrary({ projectId: fixture.projectId, scope: fixture.scope })
    const catalog2 = await buildRagLibrary({ projectId: fixture.projectId, scope: fixture.scope })
    expect(catalog2).toEqual(catalog1)
    expect(JSON.stringify(await db.worldviews.where('projectId').equals(fixture.projectId).toArray())).toBe(beforeCatalog)

    const exported = await exportProjectJSON(fixture.projectId)
    const duplicateIdentityBackup = structuredClone(exported) as any
    duplicateIdentityBackup.worldviews.push({ ...duplicateIdentityBackup.worldviews[0], id: 99 })
    const countBeforeRejectedImport = await db.projects.count()
    await expect(importProjectJSON(duplicateIdentityBackup)).rejects.toThrow('resource UID 重复')
    expect(await db.projects.count()).toBe(countBeforeRejectedImport)
    const importedProjectId = await importProjectJSON(exported)
    const imported = await db.worldviews.where('projectId').equals(importedProjectId).toArray()
    expect(imported.map(row => row.ragDocumentId)).toEqual([stamped.ragDocumentId])
  })

  it('versions retrieval policy independently without changing Canon timestamps or resource UID', async () => {
    const fixture = await seedWorkspace()
    const now = 1_787_400_000_200
    const row = stampNewRecord(fixture.scope, 'worldviews', {
      projectId: fixture.projectId,
      worldGroupId: null,
      worldOrigin: '固定正文',
      createdAt: now,
      updatedAt: now,
    }, { owner: 'world' }) as any
    const id = await db.worldviews.add(row) as number
    await updateRagDocumentPolicy({
      projectId: fixture.projectId,
      scope: fixture.scope,
      tableName: 'worldviews',
      recordId: id,
      patch: { weight: 2 },
    })
    const v1 = await db.worldviews.get(id)
    await updateRagDocumentPolicy({
      projectId: fixture.projectId,
      scope: fixture.scope,
      tableName: 'worldviews',
      recordId: id,
      patch: { weight: 3 },
    })
    const v2 = await db.worldviews.get(id)
    expect(v1).toMatchObject({ ragPolicyRevision: 1, updatedAt: now, ragDocumentId: row.ragDocumentId })
    expect(v2).toMatchObject({ ragPolicyRevision: 2, updatedAt: now, ragDocumentId: row.ragDocumentId })
    expect(v1?.ragPolicyHash).toMatch(/^[a-f0-9]{64}$/)
    expect(v2?.ragPolicyHash).not.toBe(v1?.ragPolicyHash)
    expect(v2?.worldOrigin).toBe('固定正文')
  })

  it('current exact-artifact table enforces content-address uniqueness', async () => {
    expect(await db.agentRunArtifacts.count()).toBe(0)
    const body = {
      projectId: 1, artifactKind: 'context-packet', contentHash: 'a'.repeat(64),
      retentionState: 'available', createdAt: 1,
    }
    await db.agentRunArtifacts.add(body as any)
    await expect(db.agentRunArtifacts.add(body as any)).rejects.toMatchObject({ name: 'ConstraintError' })
  })
})

describe('CTXG-2 · exact artifact lifecycle', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { vi.restoreAllMocks(); db.close() })

  it('stores exact bytes before the ledger ref, deduplicates, round-trips and reports availability', async () => {
    const fixture = await seedWorkspace('Exact evidence')
    const firstRun = await createAgentRunV1({ scope: fixture.scope, contract: runContract(fixture.projectId) })
    const secondRun = await createAgentRunV1({ scope: fixture.scope, contract: runContract(fixture.projectId) })
    const content = JSON.stringify({ version: 1, sources: ['worldview.races'], text: '逐字证据\n第二行' })
    const first = await recordAgentRunArtifactV1({
      scope: fixture.scope, runId: firstRun.run.id, artifactKind: 'context-packet', content,
    })
    const retry = await recordAgentRunArtifactV1({
      scope: fixture.scope, runId: firstRun.run.id, artifactKind: 'context-packet', content,
    })
    const shared = await recordAgentRunArtifactV1({
      scope: fixture.scope, runId: secondRun.run.id, artifactKind: 'context-packet', content,
    })
    expect(first.bodyCreated).toBe(true)
    expect(retry.eventCreated).toBe(false)
    expect(shared.bodyCreated).toBe(false)
    expect(await db.agentRunArtifacts.where('projectId').equals(fixture.projectId).count()).toBe(1)
    expect(await readAgentRunArtifactExactV1({
      projectId: fixture.projectId,
      artifactKind: 'context-packet',
      contentHash: first.artifact.contentHash,
    })).toBe(content)
    expect(await inspectAgentRunArtifactAvailabilityV1({
      projectId: fixture.projectId,
      artifactKind: 'context-packet',
      contentHash: first.artifact.contentHash,
    })).toMatchObject({ state: 'available', byteLength: new TextEncoder().encode(content).byteLength })

    const index = await buildMemoryArtifactIndexV1(fixture.projectId)
    expect(index.runs.flatMap(run => run.artifactAvailability)).toEqual(expect.arrayContaining([
      expect.objectContaining({ contentHash: first.artifact.contentHash, state: 'available' }),
    ]))

    const exported = await exportProjectJSON(fixture.projectId)
    const tampered = structuredClone(exported) as any
    tampered.agentRunArtifacts[0].content = `${content}被篡改`
    const projectCountBeforeRejectedImport = await db.projects.count()
    await expect(importProjectJSON(tampered)).rejects.toThrow('hash/byteLength')
    expect(await db.projects.count()).toBe(projectCountBeforeRejectedImport)

    const secretInjected = structuredClone(exported) as any
    secretInjected.agentRunArtifacts[0].content = JSON.stringify({ Authorization: 'Bearer abcdefghijklmnopqrstuvwxyz' })
    await expect(importProjectJSON(secretInjected)).rejects.toThrow('密钥或认证材料')
    expect(await db.projects.count()).toBe(projectCountBeforeRejectedImport)

    const importedProjectId = await importProjectJSON(exported)
    expect(await readAgentRunArtifactExactV1({
      projectId: importedProjectId,
      artifactKind: 'context-packet',
      contentHash: first.artifact.contentHash,
    })).toBe(content)
    await cascadeDeleteProject(importedProjectId)
    expect(await db.agentRunArtifacts.where('projectId').equals(importedProjectId).count()).toBe(0)
  })

  it('rolls back half-written evidence and rejects secrets/hidden reasoning', async () => {
    const fixture = await seedWorkspace('Atomic evidence')
    const run = await createAgentRunV1({ scope: fixture.scope, contract: runContract(fixture.projectId) })
    const beforeEvents = await db.agentRunEvents.where('runId').equals(run.run.id).count()
    await expect(recordAgentRunArtifactV1({
      scope: fixture.scope,
      runId: run.run.id,
      artifactKind: 'raw-response',
      content: JSON.stringify({ api_key: 'abcdefghijklmnopqrstuv' }),
    })).rejects.toThrow('禁止字段 api_key')
    expect(await db.agentRunArtifacts.where('projectId').equals(fixture.projectId).count()).toBe(0)
    expect(await db.agentRunEvents.where('runId').equals(run.run.id).count()).toBe(beforeEvents)

    await expect(recordAgentRunArtifactV1({
      scope: fixture.scope,
      runId: run.run.id,
      artifactKind: 'context-packet',
      content: '正文先写但事件非法',
      stepId: 'missing-step',
      attempt: 1,
    })).rejects.toThrow()
    expect(await db.agentRunArtifacts.where('projectId').equals(fixture.projectId).count()).toBe(0)
    expect(await db.agentRunEvents.where('runId').equals(run.run.id).count()).toBe(beforeEvents)

    const add = vi.spyOn(db.agentRunArtifacts, 'add').mockRejectedValueOnce(new Error('body-write-failed'))
    await expect(recordAgentRunArtifactV1({
      scope: fixture.scope,
      runId: run.run.id,
      artifactKind: 'context-packet',
      content: '正文写入故障',
    })).rejects.toThrow('body-write-failed')
    expect(add).toHaveBeenCalledOnce()
    expect(await db.agentRunEvents.where('runId').equals(run.run.id).count()).toBe(beforeEvents)
  })

  it('mark-and-sweep keeps shared bodies, then leaves a verified tombstone after the final Run is deleted', async () => {
    const fixture = await seedWorkspace('Retention evidence')
    const firstRun = await createAgentRunV1({ scope: fixture.scope, contract: runContract(fixture.projectId) })
    const secondRun = await createAgentRunV1({ scope: fixture.scope, contract: runContract(fixture.projectId) })
    const recorded = await recordAgentRunArtifactV1({
      scope: fixture.scope, runId: firstRun.run.id, artifactKind: 'raw-response', content: '共享原始响应',
    })
    await recordAgentRunArtifactV1({
      scope: fixture.scope, runId: secondRun.run.id, artifactKind: 'raw-response', content: '共享原始响应',
    })
    await expect(pruneAgentRunArtifactsExplicitlyV1({
      projectId: fixture.projectId,
      targets: [{ artifactKind: 'raw-response', contentHash: recorded.artifact.contentHash }],
    })).rejects.toThrow('未终结 Run')

    await deleteAgentRunV1(fixture.scope, firstRun.run.id)
    expect(await inspectAgentRunArtifactAvailabilityV1({
      projectId: fixture.projectId,
      artifactKind: 'raw-response',
      contentHash: recorded.artifact.contentHash,
    })).toMatchObject({ state: 'available' })

    await deleteAgentRunV1(fixture.scope, secondRun.run.id)
    const pruned = await inspectAgentRunArtifactAvailabilityV1({
      projectId: fixture.projectId,
      artifactKind: 'raw-response',
      contentHash: recorded.artifact.contentHash,
    })
    expect(pruned.state).toBe('evidence-pruned')
    expect(pruned.pruneReceiptHash).toMatch(/^[a-f0-9]{64}$/)
    await expect(readAgentRunArtifactExactV1({
      projectId: fixture.projectId,
      artifactKind: 'raw-response',
      contentHash: recorded.artifact.contentHash,
    })).rejects.toThrow('evidence-pruned')
  })

  it('permits explicit pruning only after the referencing Run reaches a terminal state', async () => {
    const fixture = await seedWorkspace('Explicit retention')
    let run = await createAgentRunV1({ scope: fixture.scope, contract: runContract(fixture.projectId) })
    const recorded = await recordAgentRunArtifactV1({
      scope: fixture.scope, runId: run.run.id, artifactKind: 'tool-result', content: '可按保留策略裁剪',
    })
    run = await appendAgentRunEventV1({
      scope: fixture.scope,
      runId: run.run.id,
      type: 'run.failed',
      payload: { code: 'fixture-terminal', retryable: false },
      expectedLastSequence: recorded.snapshot.projection.lastSequence,
    })
    expect(run.projection.state).toBe('failed')
    const receipts = await pruneAgentRunArtifactsExplicitlyV1({
      projectId: fixture.projectId,
      targets: [{ artifactKind: 'tool-result', contentHash: recorded.artifact.contentHash }],
      now: 1_787_400_000_900,
    })
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ reasonCode: 'explicit-retention-prune', state: 'evidence-pruned' })
  })
})
