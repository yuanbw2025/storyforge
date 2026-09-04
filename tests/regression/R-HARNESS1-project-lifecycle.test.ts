import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { cascadeDeleteGroup, cascadeDeleteProject } from '../../src/lib/registry/lifecycle'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import {
  appendAgentRunEventV1,
  createAgentRunV1,
  deleteAgentRunV1,
  readAgentRunV1,
  reviseAgentRunContractV1,
} from '../../src/lib/agent/run/event-store'
import { createAgentRunCheckpointV1, verifyAgentRunCheckpointV1 } from '../../src/lib/agent/run/checkpoint'
import { seedFullProject } from '../helpers/seed-full-project'
import type { WorkspaceScope } from '../../src/lib/types'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'

function runContract(input: { projectId: number; worldGroupId: number; outlineNodeId: number }) {
  return {
    version: 1,
    objective: '验证导入后的完成凭证失效',
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
    runtimeBindingHash: 'a'.repeat(64),
    budget: {
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: 4_000,
      maxOutputTokens: 1_000,
      maxAttemptsPerStep: 1,
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

async function createSmallWorkspace(): Promise<{
  scope: WorkspaceScope
  worldGroupId: number
  outlineNodeId: number
}> {
  const now = Date.now()
  const { scope } = await seedCurrentWorkspace('完成凭证移植')
  const worldGroupId = await db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
    name: '主世界',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }, { owner: 'world' })) as number
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
    worldGroupId,
    parentId: null,
    type: 'volume',
    title: '第一卷',
    summary: '',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' })) as number
  return { scope, worldGroupId, outlineNodeId }
}

async function importedScope(projectId: number): Promise<WorkspaceScope> {
  const project = await db.projects.get(projectId)
  expect(project?.activeWorldId).toBeTypeOf('number')
  expect(project?.activeWorkId).toBeTypeOf('number')
  return {
    projectId,
    worldId: project!.activeWorldId!,
    workId: project!.activeWorkId!,
  }
}

describe('R-HARNESS1-project-lifecycle · run 全生命周期', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('导出使用便携契约 ID，导入后重绑定并保持事件重放与检查点可用', async () => {
    const source = await seedFullProject()
    const sourceRun = await db.agentRuns.get(source.agentRun)
    const sourceHash = sourceRun!.contractHash
    const exported = await exportProjectJSON(source.projectId)
    const portableContract = JSON.parse(exported.agentRuns![0].contractJson)
    expect(portableContract.scope).toEqual({
      projectId: 1,
      worldGroupId: 1,
      outlineNodeIds: [1],
    })
    const portableRunHashes = new Map(exported.agentRuns!.map(run => [run._exportId, run.contractHash]))
    expect(exported.agentRunEvents?.every(event => (
      event.contractHash === portableRunHashes.get(event._agentRunExportId)
    ))).toBe(true)

    const importedProjectId = await importProjectJSON(exported)
    const scope = await importedScope(importedProjectId)
    const importedRun = await db.agentRuns.where('projectId').equals(importedProjectId).first()
    const importedGroup = await db.worldGroups.where('projectId').equals(importedProjectId).first()
    const importedVolume = (await db.outlineNodes.where('projectId').equals(importedProjectId).toArray())
      .find(node => node.type === 'volume')
    expect(importedRun).toMatchObject({
      workId: scope.workId,
      worldGroupId: importedGroup!.id,
      lastSequence: 3,
      status: 'planned',
    })
    expect(importedRun!.contractHash).not.toBe(sourceHash)

    const snapshot = await readAgentRunV1(scope, importedRun!.id!)
    expect(snapshot.contract.scope).toEqual({
      projectId: importedProjectId,
      worldGroupId: importedGroup!.id,
      outlineNodeIds: [importedVolume!.id],
    })
    expect(snapshot.events.map(event => event.sequence)).toEqual([1, 2, 3])
    const importedCheckpoint = await db.agentRunCheckpoints
      .where('runId').equals(importedRun!.id!).first()
    expect(await verifyAgentRunCheckpointV1(scope, importedCheckpoint!.id!)).toBe(true)
  })

  it('run、世界组、Work 和项目删除都不会遗留事件或检查点', async () => {
    const source = await seedFullProject()
    const exported = await exportProjectJSON(source.projectId)

    const runDeleteProjectId = await importProjectJSON(exported)
    const runDeleteScope = await importedScope(runDeleteProjectId)
    const runDelete = await db.agentRuns.where('projectId').equals(runDeleteProjectId).first()
    expect(await deleteAgentRunV1(runDeleteScope, runDelete!.id!)).toBe(true)
    expect(await db.agentRunEvents.where('runId').equals(runDelete!.id!).count()).toBe(0)
    expect(await db.agentRunCheckpoints.where('runId').equals(runDelete!.id!).count()).toBe(0)

    const groupDeleteProjectId = await importProjectJSON(exported)
    const group = await db.worldGroups.where('projectId').equals(groupDeleteProjectId).sortBy('order')
    const groupRun = await db.agentRuns.where('projectId').equals(groupDeleteProjectId).first()
    await cascadeDeleteGroup(groupDeleteProjectId, group[0].id!)
    expect(await db.agentRuns.get(groupRun!.id!)).toBeUndefined()
    expect(await db.agentRunEvents.where('runId').equals(groupRun!.id!).count()).toBe(0)
    expect(await db.agentRunCheckpoints.where('runId').equals(groupRun!.id!).count()).toBe(0)

    const workFixture = await createSmallWorkspace()
    const workRun = await createAgentRunV1({
      scope: workFixture.scope,
      worldGroupId: workFixture.worldGroupId,
      contract: runContract({
        projectId: workFixture.scope.projectId,
        worldGroupId: workFixture.worldGroupId,
        outlineNodeId: workFixture.outlineNodeId,
      }),
    })
    await createAgentRunCheckpointV1({ scope: workFixture.scope, runId: workRun.run.id })
    await deleteWork(workFixture.scope.workId)
    expect(await db.agentRuns.get(workRun.run.id)).toBeUndefined()
    expect(await db.agentRunEvents.where('runId').equals(workRun.run.id).count()).toBe(0)
    expect(await db.agentRunCheckpoints.where('runId').equals(workRun.run.id).count()).toBe(0)

    const projectDeleteProjectId = await importProjectJSON(exported)
    await cascadeDeleteProject(projectDeleteProjectId)
    expect(await db.agentRuns.where('projectId').equals(projectDeleteProjectId).count()).toBe(0)
    expect(await db.agentRunEvents.where('projectId').equals(projectDeleteProjectId).count()).toBe(0)
    expect(await db.agentRunCheckpoints.where('projectId').equals(projectDeleteProjectId).count()).toBe(0)
  })

  it('导入 completed run 后追加 receipt stale 证据，不沿用来源完成态', async () => {
    const fixture = await createSmallWorkspace()
    let snapshot = await createAgentRunV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      contract: runContract({
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
      payload: { stepId: 'outline.generate', attempt: 1, outputHash: 'a'.repeat(64) },
    })
    snapshot = await appendAgentRunEventV1({
      scope: fixture.scope,
      runId: snapshot.run.id,
      type: 'verification.started',
      payload: { verifierSetVersion: 'terminal-v1' },
    })
    snapshot = await appendAgentRunEventV1({
      scope: fixture.scope,
      runId: snapshot.run.id,
      type: 'verification.accepted',
      payload: { receiptHash: 'b'.repeat(64) },
    })
    expect(snapshot.projection.state).toBe('completed')

    const completedBackup = await exportProjectJSON(fixture.scope.projectId)
    const importedProjectId = await importProjectJSON(completedBackup)
    const scope = await importedScope(importedProjectId)
    const run = await db.agentRuns.where('projectId').equals(importedProjectId).first()
    const imported = await readAgentRunV1(scope, run!.id!)
    expect(imported.projection.state).toBe('running')
    expect(imported.projection.terminalReceiptHash).toBeUndefined()
    expect(imported.events.at(-1)).toMatchObject({
      type: 'verification.staled',
      payload: {
        previousReceiptHash: 'b'.repeat(64),
        reason: 'project-import-scope-rebound',
      },
    })
  })

  it('多代契约与前代检查点一并重映射，但前代检查点不能恢复新代运行', async () => {
    const fixture = await createSmallWorkspace()
    const created = await createAgentRunV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      contract: runContract({
        projectId: fixture.scope.projectId,
        worldGroupId: fixture.worldGroupId,
        outlineNodeId: fixture.outlineNodeId,
      }),
    })
    const generationOneCheckpoint = await createAgentRunCheckpointV1({
      scope: fixture.scope,
      runId: created.run.id,
    })
    const nextContract = {
      ...runContract({
        projectId: fixture.scope.projectId,
        worldGroupId: fixture.worldGroupId,
        outlineNodeId: fixture.outlineNodeId,
      }),
      objective: '第二代契约目标',
    }
    await reviseAgentRunContractV1({
      scope: fixture.scope,
      runId: created.run.id,
      contract: nextContract,
      expectedLastSequence: generationOneCheckpoint.snapshot.projection.lastSequence,
    })

    const importedProjectId = await importProjectJSON(await exportProjectJSON(fixture.scope.projectId))
    const scope = await importedScope(importedProjectId)
    const run = await db.agentRuns.where('projectId').equals(importedProjectId).first()
    const snapshot = await readAgentRunV1(scope, run!.id!)
    expect(snapshot.projection).toMatchObject({ generation: 2, state: 'planned' })
    expect(snapshot.contract.objective).toBe('第二代契约目标')
    const generationOneHash = snapshot.events.find(event => event.type === 'contract.accepted')!.contractHash
    const revised = snapshot.events.find(event => event.type === 'contract.revised')!
    expect(revised.contractHash).not.toBe(generationOneHash)
    expect(revised.type === 'contract.revised' && revised.payload.previousContractHash)
      .toBe(generationOneHash)
    const importedCheckpoint = await db.agentRunCheckpoints.where('runId').equals(run!.id!).first()
    expect(importedCheckpoint?.contractHash).toBe(generationOneHash)
    expect(await verifyAgentRunCheckpointV1(scope, importedCheckpoint!.id!)).toBe(false)
  })

  it('损坏运行拒绝导出，篡改便携契约的导入整体回滚', async () => {
    const corruptSource = await seedFullProject()
    const event = await db.agentRunEvents
      .where('[runId+sequence]').equals([corruptSource.agentRun, 2]).first()
    await db.agentRunEvents.update(event!.id!, { contractHash: 'f'.repeat(64) })
    await expect(exportProjectJSON(corruptSource.projectId))
      .rejects.toThrow('导出前事件不可重放')

    await db.delete()
    await db.open()
    const portableSource = await seedFullProject()
    const backup = await exportProjectJSON(portableSource.projectId)
    const portableContract = JSON.parse(backup.agentRuns![0].contractJson)
    portableContract.scope.outlineNodeIds = [999]
    backup.agentRuns![0].contractJson = JSON.stringify(portableContract)
    const projectCount = await db.projects.count()
    await expect(importProjectJSON(backup)).rejects.toThrow('contractHash 与 contractJson 不一致')
    expect(await db.projects.count()).toBe(projectCount)
  })
})
