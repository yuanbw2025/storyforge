import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  appendAgentRunEventV1,
  createAgentRunV1,
  readAgentRunV1,
  reviseAgentRunContractV1,
} from '../../src/lib/agent/run/event-store'
import {
  beginAgentRunRecoveryV1,
  completeAgentRunRecoveryV1,
  createAgentRunCheckpointV1,
  verifyAgentRunCheckpointV1,
} from '../../src/lib/agent/run/checkpoint'
import type { WorkspaceScope } from '../../src/lib/types'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampCurrentFixtureResourceUidsV1 } from '../helpers/current-resource-identity'

async function createWorkspace(label: string): Promise<{
  scope: WorkspaceScope
  worldGroupId: number
  outlineNodeId: number
}> {
  const now = Date.now()
  const created = await seedCurrentWorkspace(label)
  const { projectId, worldId, workId } = created.scope
  const worldGroupId = await db.worldGroups.add({
    projectId,
    worldId,
    name: '主世界',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }) as number
  const outlineNodeId = await db.outlineNodes.add({
    projectId,
    worldId: null,
    workId,
    worldGroupId,
    parentId: null,
    type: 'volume',
    title: '第一卷',
    summary: '',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }) as number
  await stampCurrentFixtureResourceUidsV1(projectId)
  return { scope: { projectId, worldId, workId }, worldGroupId, outlineNodeId }
}

function contract(input: {
  projectId: number
  worldGroupId: number
  outlineNodeId: number
  objective?: string
}) {
  return {
    version: 1,
    runtimeBindingHash: 'a'.repeat(64),
    objective: input.objective ?? '生成第一卷卷纲候选',
    workflowKind: 'long-running-resumable',
    scope: {
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      outlineNodeIds: [input.outlineNodeId],
    },
    permissions: {
      contextSourceKeys: ['worldview', 'storyCore'],
      writeTargets: [{ table: 'outlineNodes', fields: ['summary'], mode: 'candidate-only' }],
    },
    budget: {
      maxModelCalls: 3,
      maxToolCalls: 4,
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
  }
}

async function createRunningStep(label: string) {
  const fixture = await createWorkspace(label)
  let snapshot = await createAgentRunV1({
    scope: fixture.scope,
    worldGroupId: fixture.worldGroupId,
    contract: contract({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      outlineNodeId: fixture.outlineNodeId,
    }),
  })
  snapshot = await appendAgentRunEventV1({
    scope: fixture.scope,
    runId: snapshot.run.id,
    type: 'step.scheduled',
    payload: { stepId: 'outline.generate' },
  })
  snapshot = await appendAgentRunEventV1({
    scope: fixture.scope,
    runId: snapshot.run.id,
    type: 'step.started',
    payload: { stepId: 'outline.generate', attempt: 1 },
  })
  return { fixture, snapshot }
}

async function crashAndRecoverRunningStep(input: Awaited<ReturnType<typeof createRunningStep>>) {
  const saved = await createAgentRunCheckpointV1({
    scope: input.fixture.scope,
    runId: input.snapshot.run.id,
  })
  const paused = await appendAgentRunEventV1({
    scope: input.fixture.scope,
    runId: input.snapshot.run.id,
    type: 'run.paused',
    payload: { reason: 'simulated-crash', recoverable: true },
    expectedLastSequence: saved.snapshot.projection.lastSequence,
  })
  const plan = await beginAgentRunRecoveryV1({
    scope: input.fixture.scope,
    runId: input.snapshot.run.id,
    expectedLastSequence: paused.projection.lastSequence,
  })
  const resumed = await completeAgentRunRecoveryV1({
    scope: input.fixture.scope,
    runId: input.snapshot.run.id,
    checkpointHash: plan.checkpointHash,
    expectedLastSequence: plan.snapshot.projection.lastSequence,
  })
  return { plan, resumed }
}

describe('R-HARNESS1-event-store-resume · durable run ledger', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('原子创建运行，并发追加仍保持唯一连续序号，过期写 fail-closed', async () => {
    const fixture = await createWorkspace('并发账本')
    const created = await createAgentRunV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      contract: contract({
        projectId: fixture.scope.projectId,
        worldGroupId: fixture.worldGroupId,
        outlineNodeId: fixture.outlineNodeId,
      }),
      now: 100,
    })
    expect(created.projection).toMatchObject({ state: 'planned', lastSequence: 2 })
    expect(created.events.map(event => event.type)).toEqual(['run.created', 'contract.accepted'])

    const scheduled = await appendAgentRunEventV1({
      scope: fixture.scope,
      runId: created.run.id,
      type: 'step.scheduled',
      payload: { stepId: 'outline.generate' },
      expectedLastSequence: 2,
    })
    await appendAgentRunEventV1({
      scope: fixture.scope,
      runId: created.run.id,
      type: 'step.started',
      payload: { stepId: 'outline.generate', attempt: 1 },
      expectedLastSequence: scheduled.projection.lastSequence,
    })

    await Promise.all([
      appendAgentRunEventV1({
        scope: fixture.scope,
        runId: created.run.id,
        type: 'tool.called',
        payload: {
          stepId: 'outline.generate',
          attempt: 1,
          toolName: 'read_context',
          callHash: 'a'.repeat(64),
        },
      }),
      appendAgentRunEventV1({
        scope: fixture.scope,
        runId: created.run.id,
        type: 'context.assembled',
        payload: {
          stepId: 'outline.generate',
          attempt: 1,
          manifestHash: 'b'.repeat(64),
        },
      }),
    ])

    const snapshot = await readAgentRunV1(fixture.scope, created.run.id)
    expect(snapshot.events.map(event => event.sequence)).toEqual([1, 2, 3, 4, 5, 6])
    expect(snapshot.run.lastSequence).toBe(6)
    expect(await db.agentRunEvents.where('runId').equals(created.run.id).count()).toBe(6)

    await expect(appendAgentRunEventV1({
      scope: fixture.scope,
      runId: created.run.id,
      type: 'model.requested',
      payload: {
        stepId: 'outline.generate',
        attempt: 1,
        bindingHash: 'c'.repeat(64),
      },
      expectedLastSequence: 4,
    })).rejects.toMatchObject({ code: 'sequence_conflict' })
    expect((await readAgentRunV1(fixture.scope, created.run.id)).run.lastSequence).toBe(6)
  })

  it('拒绝跨 Work 读取，并在事件或投影被篡改时拒绝继续执行', async () => {
    const owner = await createWorkspace('账本归属方')
    const other = await createWorkspace('越界工作区')
    const created = await createAgentRunV1({
      scope: owner.scope,
      worldGroupId: owner.worldGroupId,
      contract: contract({
        projectId: owner.scope.projectId,
        worldGroupId: owner.worldGroupId,
        outlineNodeId: owner.outlineNodeId,
      }),
    })

    await expect(readAgentRunV1(other.scope, created.run.id))
      .rejects.toMatchObject({ code: 'scope' })

    const accepted = await db.agentRunEvents
      .where('[runId+sequence]').equals([created.run.id, 2]).first()
    await db.agentRunEvents.update(accepted!.id!, { contractHash: 'f'.repeat(64) })
    await expect(readAgentRunV1(owner.scope, created.run.id))
      .rejects.toMatchObject({ code: 'event_replay' })
    expect((await db.agentRuns.get(created.run.id))?.status).toBe('planned')
  })

  it('检查点可验证、恢复幂等，并明确返回无需重复执行的成功步骤', async () => {
    const fixture = await createWorkspace('断点恢复')
    let snapshot = await createAgentRunV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      contract: contract({
        projectId: fixture.scope.projectId,
        worldGroupId: fixture.worldGroupId,
        outlineNodeId: fixture.outlineNodeId,
      }),
    })
    snapshot = await appendAgentRunEventV1({
      scope: fixture.scope,
      runId: snapshot.run.id,
      type: 'step.scheduled',
      payload: { stepId: 'outline.generate' },
    })
    snapshot = await appendAgentRunEventV1({
      scope: fixture.scope,
      runId: snapshot.run.id,
      type: 'step.started',
      payload: { stepId: 'outline.generate', attempt: 1 },
    })
    snapshot = await appendAgentRunEventV1({
      scope: fixture.scope,
      runId: snapshot.run.id,
      type: 'step.succeeded',
      payload: { stepId: 'outline.generate', attempt: 1, outputHash: 'd'.repeat(64) },
    })
    const saved = await createAgentRunCheckpointV1({
      scope: fixture.scope,
      runId: snapshot.run.id,
      resumePayload: { providerCursor: 'opaque-1' },
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    const originalWaitFor = Dexie.waitFor.bind(Dexie)
    let activeWaits = 0
    let maxActiveWaits = 0
    const waitForSpy = vi.spyOn(Dexie, 'waitFor').mockImplementation((async (
      promise: Promise<unknown>,
      timeout?: number,
    ) => {
      activeWaits += 1
      maxActiveWaits = Math.max(maxActiveWaits, activeWaits)
      try {
        return await originalWaitFor(promise, timeout)
      } finally {
        activeWaits -= 1
      }
    }) as typeof Dexie.waitFor)
    try {
      expect(await verifyAgentRunCheckpointV1(fixture.scope, saved.checkpoint.id)).toBe(true)
      expect(maxActiveWaits).toBe(1)
    } finally {
      waitForSpy.mockRestore()
    }

    const paused = await appendAgentRunEventV1({
      scope: fixture.scope,
      runId: snapshot.run.id,
      type: 'run.paused',
      payload: { reason: '页面刷新', recoverable: true },
      expectedLastSequence: saved.snapshot.projection.lastSequence,
    })
    const firstRecovery = await beginAgentRunRecoveryV1({
      scope: fixture.scope,
      runId: snapshot.run.id,
      expectedLastSequence: paused.projection.lastSequence,
    })
    expect(firstRecovery.completedStepIds).toEqual(['outline.generate'])
    expect(firstRecovery.resumePayload).toEqual({ providerCursor: 'opaque-1' })
    expect(firstRecovery.snapshot.projection.state).toBe('recovering')

    const repeatedRecovery = await beginAgentRunRecoveryV1({
      scope: fixture.scope,
      runId: snapshot.run.id,
    })
    expect(repeatedRecovery.snapshot.projection.lastSequence)
      .toBe(firstRecovery.snapshot.projection.lastSequence)

    const resumed = await completeAgentRunRecoveryV1({
      scope: fixture.scope,
      runId: snapshot.run.id,
      checkpointHash: firstRecovery.checkpointHash,
      expectedLastSequence: firstRecovery.snapshot.projection.lastSequence,
    })
    expect(resumed.projection.state).toBe('running')
    expect(resumed.projection.steps['outline.generate'].status).toBe('succeeded')

    await db.agentRunCheckpoints.update(saved.checkpoint.id, {
      resumePayloadJson: JSON.stringify({ providerCursor: 'tampered' }),
    })
    expect(await verifyAgentRunCheckpointV1(fixture.scope, saved.checkpoint.id)).toBe(false)
  })

  it('契约修订递增 generation，并使旧检查点明确失效', async () => {
    const fixture = await createWorkspace('契约修订')
    const created = await createAgentRunV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      contract: contract({
        projectId: fixture.scope.projectId,
        worldGroupId: fixture.worldGroupId,
        outlineNodeId: fixture.outlineNodeId,
      }),
    })
    const saved = await createAgentRunCheckpointV1({
      scope: fixture.scope,
      runId: created.run.id,
    })
    const revised = await reviseAgentRunContractV1({
      scope: fixture.scope,
      runId: created.run.id,
      contract: contract({
        projectId: fixture.scope.projectId,
        worldGroupId: fixture.worldGroupId,
        outlineNodeId: fixture.outlineNodeId,
        objective: '改为生成第一卷三幕式卷纲候选',
      }),
      expectedLastSequence: saved.snapshot.projection.lastSequence,
    })
    expect(revised.run.generation).toBe(2)
    expect(revised.projection.generation).toBe(2)
    expect(await verifyAgentRunCheckpointV1(fixture.scope, saved.checkpoint.id)).toBe(false)
  })

  it('模型返回后崩溃可恢复，且不会把未持久化输出当成候选', async () => {
    const modelReturned = await createRunningStep('模型已返回')
    modelReturned.snapshot = await appendAgentRunEventV1({
      scope: modelReturned.fixture.scope,
      runId: modelReturned.snapshot.run.id,
      type: 'model.responded',
      payload: {
        stepId: 'outline.generate',
        attempt: 1,
        outputHash: '1'.repeat(64),
      },
    })
    const afterModel = await crashAndRecoverRunningStep(modelReturned)
    expect(afterModel.plan).toMatchObject({
      completedStepIds: [],
      persistedCandidateStepIds: [],
      confirmedAdoptionStepIds: [],
      committedAdoptionStepIds: [],
    })
    expect(afterModel.resumed.projection.steps['outline.generate'].status).toBe('running')
    expect(afterModel.resumed.events.some(event => event.type === 'model.responded')).toBe(true)
  })

  it('候选持久化后崩溃可恢复，且不会重复创建候选', async () => {
    const candidatePersisted = await createRunningStep('候选已持久化')
    candidatePersisted.snapshot = await appendAgentRunEventV1({
      scope: candidatePersisted.fixture.scope,
      runId: candidatePersisted.snapshot.run.id,
      type: 'candidate.persisted',
      payload: {
        stepId: 'outline.generate',
        attempt: 1,
        candidateHash: '2'.repeat(64),
        requiresConfirmation: true,
      },
    })
    const afterCandidate = await crashAndRecoverRunningStep(candidatePersisted)
    expect(afterCandidate.plan.persistedCandidateStepIds).toEqual(['outline.generate'])
    expect(afterCandidate.plan.confirmedAdoptionStepIds).toEqual([])
    expect(afterCandidate.resumed.projection.state).toBe('awaiting_confirmation')
  })

  it('作者确认后崩溃可恢复，且不会重复请求确认', async () => {
    const confirmationRecorded = await createRunningStep('作者已确认')
    confirmationRecorded.snapshot = await appendAgentRunEventV1({
      scope: confirmationRecorded.fixture.scope,
      runId: confirmationRecorded.snapshot.run.id,
      type: 'candidate.persisted',
      payload: {
        stepId: 'outline.generate',
        attempt: 1,
        candidateHash: '3'.repeat(64),
        requiresConfirmation: true,
      },
    })
    confirmationRecorded.snapshot = await appendAgentRunEventV1({
      scope: confirmationRecorded.fixture.scope,
      runId: confirmationRecorded.snapshot.run.id,
      type: 'confirmation.recorded',
      payload: {
        stepId: 'outline.generate',
        candidateHash: '3'.repeat(64),
        decision: 'adopt',
      },
    })
    const afterConfirmation = await crashAndRecoverRunningStep(confirmationRecorded)
    expect(afterConfirmation.plan.confirmedAdoptionStepIds).toEqual(['outline.generate'])
    expect(afterConfirmation.plan.committedAdoptionStepIds).toEqual([])
  })

  it('采纳提交后崩溃可恢复，且不会重复正式写入', async () => {
    const adoptionCommitted = await createRunningStep('采纳已提交')
    adoptionCommitted.snapshot = await appendAgentRunEventV1({
      scope: adoptionCommitted.fixture.scope,
      runId: adoptionCommitted.snapshot.run.id,
      type: 'candidate.persisted',
      payload: {
        stepId: 'outline.generate',
        attempt: 1,
        candidateHash: '4'.repeat(64),
        requiresConfirmation: true,
      },
    })
    adoptionCommitted.snapshot = await appendAgentRunEventV1({
      scope: adoptionCommitted.fixture.scope,
      runId: adoptionCommitted.snapshot.run.id,
      type: 'confirmation.recorded',
      payload: {
        stepId: 'outline.generate',
        candidateHash: '4'.repeat(64),
        decision: 'adopt',
      },
    })
    adoptionCommitted.snapshot = await appendAgentRunEventV1({
      scope: adoptionCommitted.fixture.scope,
      runId: adoptionCommitted.snapshot.run.id,
      type: 'adoption.started',
      payload: { stepId: 'outline.generate', candidateHash: '4'.repeat(64) },
    })
    adoptionCommitted.snapshot = await appendAgentRunEventV1({
      scope: adoptionCommitted.fixture.scope,
      runId: adoptionCommitted.snapshot.run.id,
      type: 'adoption.committed',
      payload: {
        stepId: 'outline.generate',
        candidateHash: '4'.repeat(64),
        adoptionHash: '5'.repeat(64),
      },
    })
    const afterAdoption = await crashAndRecoverRunningStep(adoptionCommitted)
    expect(afterAdoption.plan.committedAdoptionStepIds).toEqual(['outline.generate'])
    expect(afterAdoption.resumed.projection.steps['outline.generate'].adoptionHash).toBe('5'.repeat(64))
  })
})
