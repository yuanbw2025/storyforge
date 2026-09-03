import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendAgentEvent, getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import {
  appendAgentRunEventV1,
  createAgentRunV1,
  readAgentRunV1,
} from '../../src/lib/agent/run/event-store'
import { db } from '../../src/lib/db/schema'
import { deriveStrictExportProjectJSON } from '../../src/lib/export/registry-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import type { AgentEvent, Character, WorkspaceScope } from '../../src/lib/types'
import { readOwnedRows, scopeTransactionTables } from '../../src/lib/workspace/scope'

async function createWorkspace(): Promise<WorkspaceScope> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: 'Dexie transaction longevity',
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: '',
    targetWordCount: 100_000,


    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId,
    code: 'dexie-transaction-longevity',
    name: '事务世界',
    description: '',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId,
    worldId,
    title: '事务作品',
    description: '',
    genres: ['fantasy'],
    status: 'drafting',
    targetWordCount: 100_000,
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.projects.update(projectId, {
    activeWorldId: worldId,
    activeWorkId: workId,
    ownershipSchemaVersion: 1,
  })
  return { projectId, worldId, workId }
}

describe.sequential('R-DEXIE-PREMATURE-COMMIT · long reads and ledgers keep write transactions alive', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('filters a populated World collection before writing in the same transaction', async () => {
    const scope = await createWorkspace()
    const now = Date.now()
    const characters = Array.from({ length: 96 }, (_, index) => ({
      projectId: scope.projectId,
      worldId: scope.worldId,
      name: `存量角色 ${index + 1}`,
      role: 'minor',
      roleWeight: 'secondary',
      moralAxis: 'neutral',
      orderAxis: 'neutral',
      homeWorldGroupId: null,
      isCrossWorld: false,
      createdAt: now,
      updatedAt: now,
    })) as Character[]
    await db.characters.bulkAdd(characters)

    await db.transaction('rw', scopeTransactionTables(db.characters), async () => {
      const owned = await readOwnedRows<Character>(scope, 'characters', { owner: 'world' })
      expect(owned).toHaveLength(96)
      await db.characters.add({
        ...characters[0],
        id: undefined,
        name: '事务末尾新增角色',
      })
    })

    expect(await db.characters.where('projectId').equals(scope.projectId).count()).toBe(97)
  })

  it('appends the next sequence after a long Agent conversation', async () => {
    const scope = await createWorkspace()
    const conversation = await getOrCreateAgentConversation({
      projectId: scope.projectId,
      worldGroupId: null,
      scope,
    })
    const now = Date.now()
    const events = Array.from({ length: 160 }, (_, index) => ({
      projectId: scope.projectId,
      workId: scope.workId,
      conversationId: conversation.id!,
      durableRunId: null,
      sequence: index + 1,
      kind: 'message' as const,
      role: 'assistant' as const,
      content: `历史事件 ${index + 1}`,
      payload: '{}',
      createdAt: now + index,
    })) satisfies AgentEvent[]
    await db.agentEvents.bulkAdd(events)

    const appended = await appendAgentEvent({
      projectId: scope.projectId,
      scope,
      conversationId: conversation.id!,
      kind: 'message',
      role: 'user',
      content: '继续使用 AI',
    })

    expect(appended.sequence).toBe(161)
    expect(await db.agentEvents.where('conversationId').equals(conversation.id!).count()).toBe(161)
  })

  it('round-trips a 167-event durable ledger and appends afterward', async () => {
    const scope = await createWorkspace()
    const now = Date.now()
    const worldGroupId = await db.worldGroups.add({
      projectId: scope.projectId,
      worldId: scope.worldId,
      name: '主世界',
      order: 0,
      createdAt: now,
      updatedAt: now,
    }) as number
    const outlineNodeId = await db.outlineNodes.add({
      projectId: scope.projectId,
      worldId: null,
      workId: scope.workId,
      worldGroupId,
      parentId: null,
      type: 'volume',
      title: '第一卷',
      summary: '',
      order: 0,
      createdAt: now,
      updatedAt: now,
    }) as number
    let snapshot = await createAgentRunV1({
      scope,
      worldGroupId,
      contract: {
        version: 1,
        objective: '验证大账本导入后仍可继续运行',
        workflowKind: 'long-running-resumable',
        scope: {
          projectId: scope.projectId,
          worldGroupId,
          outlineNodeIds: [outlineNodeId],
        },
        permissions: {
          contextSourceKeys: ['worldview', 'storyCore'],
          writeTargets: [{ table: 'outlineNodes', fields: ['summary'], mode: 'candidate-only' }],
        },
        budget: {
          maxModelCalls: 3,
          maxToolCalls: 300,
          maxInputTokens: 8_000,
          maxOutputTokens: 2_000,
          maxAttemptsPerStep: 2,
        },
        acceptance: [{ id: 'outline.output', kind: 'output-present', required: true }],
        verificationPlan: [{
          id: 'outline.terminal',
          kind: 'terminal',
          verifier: 'terminal-v1',
          criterionIds: ['outline.output'],
        }],
        failurePolicy: {
          onProtocolError: 'fail',
          onVerificationFailure: 'fail',
          onStaleInput: 'pause-for-author',
        },
      },
    })
    snapshot = await appendAgentRunEventV1({
      scope,
      runId: snapshot.run.id,
      type: 'step.scheduled',
      payload: { stepId: 'outline.generate' },
    })
    snapshot = await appendAgentRunEventV1({
      scope,
      runId: snapshot.run.id,
      type: 'step.started',
      payload: { stepId: 'outline.generate', attempt: 1 },
    })
    for (let index = 0; index < 163; index += 1) {
      snapshot = await appendAgentRunEventV1({
        scope,
        runId: snapshot.run.id,
        type: 'tool.called',
        payload: {
          stepId: 'outline.generate',
          attempt: 1,
          toolName: 'read_context',
          callHash: index.toString(16).padStart(64, '0'),
        },
      })
    }
    expect(snapshot.events).toHaveLength(167)

    const exported = await deriveStrictExportProjectJSON(scope.projectId)
    const importedProjectId = await deriveImportProjectJSON(exported)
    const importedProject = await db.projects.get(importedProjectId)
    const importedRun = await db.agentRuns.where('projectId').equals(importedProjectId).first()
    expect(importedProject?.activeWorldId).toBeTypeOf('number')
    expect(importedProject?.activeWorkId).toBeTypeOf('number')
    expect(importedRun?.id).toBeTypeOf('number')

    const importedScope: WorkspaceScope = {
      projectId: importedProjectId,
      worldId: importedProject!.activeWorldId!,
      workId: importedProject!.activeWorkId!,
    }
    const restored = await readAgentRunV1(importedScope, importedRun!.id!)
    expect(restored.events).toHaveLength(167)

    const appended = await appendAgentRunEventV1({
      scope: importedScope,
      runId: importedRun!.id!,
      type: 'context.assembled',
      payload: {
        stepId: 'outline.generate',
        attempt: 1,
        manifestHash: 'f'.repeat(64),
      },
    })
    expect(appended.events).toHaveLength(168)
  }, 20_000)
})
