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
  readLatestVerifiedAgentRunCheckpointV1,
  verifyAgentRunCheckpointV1,
} from '../../src/lib/agent/run/checkpoint'
import type { Chapter, WorkspaceScope } from '../../src/lib/types'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { addCurrentWorldFixtureV1, currentWorkFixtureRecordV1, seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampCurrentFixtureResourceUidsV1 } from '../helpers/current-resource-identity'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { updateWorkspace } from '../../src/lib/workspace/works'

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

async function createInheritedChapter(label: string) {
  const fixture = await createWorkspace(label)
  await db.projects.update(fixture.scope.projectId, { enableMultiWorld: true })
  const now = Date.now()
  const fields = { projectId: fixture.scope.projectId, workId: fixture.scope.workId,
    summary: '', order: 0, createdAt: now, updatedAt: now }
  const blockId = await db.outlineNodes.add({ ...fields, parentId: fixture.outlineNodeId, type: 'storyBlock', title: '故事块' }) as number
  const chapterOutlineId = await db.outlineNodes.add({ ...fields, parentId: blockId, type: 'chapter', title: '继承世界组的章纲' }) as number
  const chapterId = await db.chapters.add(stampNewRecord<Chapter>(fixture.scope, 'chapters', { projectId: fixture.scope.projectId,
    outlineNodeId: chapterOutlineId, title: '继承世界组的章节', content: '', wordCount: 0,
    status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now }, { owner: 'work' })) as number
  await stampCurrentFixtureResourceUidsV1(fixture.scope.projectId)
  return { ...fixture, blockId, chapterOutlineId, chapterId }
}

type InheritedChapterFixture = Awaited<ReturnType<typeof createInheritedChapter>>
function inheritedContractInput(fixture: InheritedChapterFixture, target: 'outline' | 'chapter', worldGroupId: number | null = fixture.worldGroupId) {
  return { scope: fixture.scope, worldGroupId,
    contract: { ...contract({ projectId: fixture.scope.projectId, worldGroupId: fixture.worldGroupId, outlineNodeId: fixture.chapterOutlineId }),
      scope: { projectId: fixture.scope.projectId, worldGroupId,
        ...(target === 'outline' ? { outlineNodeIds: [fixture.chapterOutlineId] } : { chapterIds: [fixture.chapterId] }) } } }
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

  it.each(['outline', 'chapter'] as const)('祖链世界组：%s 创建接受继承、最近显式覆盖和无组，不改作者叶字段', async target => {
    const fixture = await createInheritedChapter('合法祖链')
    const before = await db.outlineNodes.where('projectId').equals(fixture.scope.projectId).toArray()
    const created = await createAgentRunV1(inheritedContractInput(fixture, target))
    expect(created.contract.scope.worldGroupId).toBe(fixture.worldGroupId)
    expect(await db.outlineNodes.where('projectId').equals(fixture.scope.projectId).toArray()).toEqual(before)
    expect(await db.outlineNodes.get(fixture.chapterOutlineId)).not.toHaveProperty('worldGroupId')

    const group = (await db.worldGroups.get(fixture.worldGroupId))!
    const otherGroupId = await db.worldGroups.add({ ...group, id: undefined, ragDocumentId: undefined, name: '另一组' }) as number
    await db.outlineNodes.update(fixture.outlineNodeId, { worldGroupId: otherGroupId })
    await db.outlineNodes.update(fixture.blockId, { worldGroupId: fixture.worldGroupId })
    expect((await createAgentRunV1(inheritedContractInput(fixture, target))).contract.scope.worldGroupId).toBe(fixture.worldGroupId)
    await db.outlineNodes.update(fixture.outlineNodeId, { worldGroupId: null })
    await db.outlineNodes.update(fixture.blockId, { worldGroupId: null })
    expect((await createAgentRunV1(inheritedContractInput(fixture, target, null))).contract.scope.worldGroupId).toBeNull()
  })

  it.each(['outline', 'chapter'] as const)('祖链世界组：关闭多世界的 %s 入口使用有效空组，显式非空合同仍须准确匹配', async target => {
    const fixture = await createInheritedChapter('关闭分组保留数据')
    const before = await db.outlineNodes.where('projectId').equals(fixture.scope.projectId).toArray()
    await updateWorkspace(fixture.scope.projectId, { enableMultiWorld: false })
    expect(await db.outlineNodes.where('projectId').equals(fixture.scope.projectId).toArray()).toEqual(before)
    expect(await db.outlineNodes.get(fixture.outlineNodeId)).toMatchObject({ worldGroupId: fixture.worldGroupId })
    expect(await db.outlineNodes.get(fixture.chapterOutlineId)).not.toHaveProperty('worldGroupId')
    const ungrouped = await createAgentRunV1(inheritedContractInput(fixture, target, null))
    expect(ungrouped.contract.scope.worldGroupId).toBeNull()
    const explicit = await createAgentRunV1(inheritedContractInput(fixture, target))
    expect(explicit.contract.scope.worldGroupId).toBe(fixture.worldGroupId)
    const group = (await db.worldGroups.get(fixture.worldGroupId))!
    const otherGroupId = await db.worldGroups.add({ ...group, id: undefined, ragDocumentId: undefined, name: '另一组' }) as number
    const beforeRuns = await db.agentRuns.toArray(), beforeEvents = await db.agentRunEvents.toArray()
    const code = target === 'outline' ? 'outline_world_scope' : 'chapter_world_scope'
    await expect(createAgentRunV1(inheritedContractInput(fixture, target, otherGroupId))).rejects.toMatchObject({ code })
    await updateWorkspace(fixture.scope.projectId, { enableMultiWorld: true })
    await expect(createAgentRunV1(inheritedContractInput(fixture, target, null))).rejects.toMatchObject({ code })
    expect(await db.agentRuns.toArray()).toEqual(beforeRuns)
    expect(await db.agentRunEvents.toArray()).toEqual(beforeEvents)
    expect((await readAgentRunV1(fixture.scope, explicit.run.id)).run.contractJson).toBe(explicit.run.contractJson)
    expect((await readAgentRunV1(fixture.scope, ungrouped.run.id)).run.contractJson).toBe(ungrouped.run.contractJson)
  })

  it.each(['outline', 'chapter'] as const)('祖链世界组：%s 拒绝错组创建及父卷改组后的合同修订，保留冻结合同与历史读取', async target => {
    const fixture = await createInheritedChapter('冻结世界组')
    const input = inheritedContractInput(fixture, target)
    const created = await createAgentRunV1(input)
    const group = (await db.worldGroups.get(fixture.worldGroupId))!
    const otherGroupId = await db.worldGroups.add({ ...group, id: undefined, ragDocumentId: undefined, name: '另一组' }) as number
    const beforeRun = await db.agentRuns.get(created.run.id)
    const beforeEvents = await db.agentRunEvents.toArray()
    const code = target === 'outline' ? 'outline_world_scope' : 'chapter_world_scope'
    await expect(createAgentRunV1(inheritedContractInput(fixture, target, otherGroupId))).rejects.toMatchObject({ code })
    await db.outlineNodes.update(fixture.outlineNodeId, { worldGroupId: otherGroupId })
    await expect(reviseAgentRunContractV1({ scope: fixture.scope, runId: created.run.id, contract: input.contract,
      expectedLastSequence: created.projection.lastSequence })).rejects.toMatchObject({ code })
    expect(await db.agentRuns.toArray()).toEqual([beforeRun])
    expect(await db.agentRunEvents.toArray()).toEqual(beforeEvents)
    expect((await readAgentRunV1(fixture.scope, created.run.id)).run.contractJson).toBe(created.run.contractJson)
  })

  it.each((['outline', 'chapter'] as const).flatMap(target =>
    (['foreign-work', 'missing-parent', 'cycle'] as const).map(damage => ({ target, damage }))))(
    '祖链世界组：$target 拒绝 $damage 即使叶有正确显式组，运行零写入', async ({ target, damage }) => {
      const fixture = await createInheritedChapter('损坏祖链')
      await db.outlineNodes.update(fixture.chapterOutlineId, { worldGroupId: fixture.worldGroupId })
      if (damage === 'foreign-work') {
        const otherWorkId = await db.works.add(currentWorkFixtureRecordV1({ projectId: fixture.scope.projectId,
          worldId: fixture.scope.worldId, title: '另一作品' })) as number
        await db.outlineNodes.update(fixture.outlineNodeId, { workId: otherWorkId })
      } else if (damage === 'missing-parent') {
        await db.outlineNodes.update(fixture.outlineNodeId, { parentId: 999999 })
      } else {
        await db.outlineNodes.update(fixture.outlineNodeId, { parentId: fixture.chapterOutlineId })
      }
      const before = await db.outlineNodes.toArray()
      await expect(createAgentRunV1(inheritedContractInput(fixture, target))).rejects.toMatchObject({ code: 'outline_ancestry' })
      expect(await db.agentRuns.count()).toBe(0)
      expect(await db.agentRunEvents.count()).toBe(0)
      expect(await db.outlineNodes.toArray()).toEqual(before)
    })

  it.each([true, false])('祖链世界组：multiWorld=%s 同项目另一 World 的组不能通过叶覆盖或创建参数借用', async multiWorld => {
    const fixture = await createInheritedChapter('跨 World 组')
    await updateWorkspace(fixture.scope.projectId, { enableMultiWorld: multiWorld })
    const otherWorld = await addCurrentWorldFixtureV1({ projectId: fixture.scope.projectId, name: '另一 World' })
    const group = (await db.worldGroups.get(fixture.worldGroupId))!
    const foreignGroupId = await db.worldGroups.add({ ...group, id: undefined, ragDocumentId: undefined,
      worldId: otherWorld.id!, name: '另一 World 的组' }) as number
    await db.outlineNodes.update(fixture.outlineNodeId, { worldGroupId: foreignGroupId })
    await db.outlineNodes.update(fixture.chapterOutlineId, { worldGroupId: fixture.worldGroupId })
    await expect(createAgentRunV1(inheritedContractInput(fixture, 'chapter', multiWorld ? fixture.worldGroupId : null))).rejects.toMatchObject({ code: 'outline_ancestor_world_scope' })
    await expect(createAgentRunV1(inheritedContractInput(fixture, 'outline', foreignGroupId))).rejects.toMatchObject({ code: 'world_scope' })
    expect(await db.agentRuns.count()).toBe(0)
    expect(await db.agentRunEvents.count()).toBe(0)
  })

  it('persists, revises and reloads a valid contract above the former event snapshot ceiling', async () => {
    const fixture = await createWorkspace('大契约事件快照')
    const base = contract({
      projectId: fixture.scope.projectId, worldGroupId: fixture.worldGroupId,
      outlineNodeId: fixture.outlineNodeId,
    })
    base.acceptance = Array.from({ length: 1500 }, (_, index) => ({
      id: `outline.criterion.${index}`, kind: 'output-present', required: true,
    }))
    base.verificationPlan = [{
      id: 'outline.complete', kind: 'terminal', verifier: 'terminal-v1',
      criterionIds: base.acceptance.map(criterion => criterion.id),
    }]
    const created = await createAgentRunV1({ scope: fixture.scope, worldGroupId: fixture.worldGroupId, contract: base })
    expect(created.run.contractJson.length).toBeGreaterThan(100_000)
    const checkpoint = await createAgentRunCheckpointV1({ scope: fixture.scope, runId: created.run.id })
    expect(await verifyAgentRunCheckpointV1(fixture.scope, checkpoint.checkpoint.id)).toBe(true)
    const revised = await reviseAgentRunContractV1({
      scope: fixture.scope, runId: created.run.id,
      contract: { ...base, objective: '修订后的大契约' },
      expectedLastSequence: checkpoint.snapshot.projection.lastSequence,
    })
    expect(revised.run.generation).toBe(2)
    const reloaded = await readAgentRunV1(fixture.scope, revised.run.id)
    expect(reloaded.run.contractHash).toBe(revised.run.contractHash)
    expect(reloaded.contract.acceptance).toHaveLength(1500)
    expect(reloaded.events.filter(event => event.type === 'contract.accepted' || event.type === 'contract.revised')).toHaveLength(2)
    const backup = await exportProjectJSON(fixture.scope.projectId)
    const importedId = await importProjectJSON(backup)
    const importedProject = await db.projects.get(importedId)
    const importedRun = await db.agentRuns.where('projectId').equals(importedId).first()
    expect(importedProject).toBeDefined()
    expect(importedRun).toBeDefined()
    const restored = await readAgentRunV1({
      projectId: importedId, worldId: importedProject!.activeWorldId!, workId: importedProject!.activeWorkId!,
    }, importedRun!.id!)
    expect(restored.contract.acceptance).toHaveLength(1500)
    expect(restored.run.generation).toBe(2)
    expect(restored.contract.scope.projectId).toBe(importedId)
    expect((await readAgentRunV1(fixture.scope, created.run.id)).run.contractHash).toBe(revised.run.contractHash)
  })

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

  it('在解析恢复载荷前执行原始 UTF-8 字节预算，并精确读取最新检查点', async () => {
    const { fixture, snapshot } = await createRunningStep('检查点读取预算')
    const first = await createAgentRunCheckpointV1({
      scope: fixture.scope,
      runId: snapshot.run.id,
      resumePayload: { marker: 'first' },
    })
    const second = await createAgentRunCheckpointV1({
      scope: fixture.scope,
      runId: snapshot.run.id,
      resumePayload: { marker: 'second', payload: '界'.repeat(64) },
      expectedLastSequence: first.snapshot.projection.lastSequence,
    })

    const latest = await readLatestVerifiedAgentRunCheckpointV1(fixture.scope, snapshot.run.id)
    expect(latest?.checkpoint.id).toBe(second.checkpoint.id)
    expect(latest?.resumePayload).toMatchObject({ marker: 'second' })

    await expect(readLatestVerifiedAgentRunCheckpointV1(fixture.scope, snapshot.run.id, {
      maximumResumePayloadBytes: 32,
    })).rejects.toMatchObject({ code: 'checkpoint_resume_budget' })
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
