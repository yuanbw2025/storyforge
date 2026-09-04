import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/ai/client', () => ({
  chat: vi.fn(async () => JSON.stringify({
    field: 'worldOrigin',
    value: '节点生成的候选世界来源。',
  })),
}))

import { db } from '../../src/lib/db/schema'
import type { NodeFlow, Project } from '../../src/lib/types'
import {
  AUTHORING_NODE_BY_ID,
  buildAuthoringOverviewGraph,
  defaultConfigForTemplate,
  emptyAuthoringGraph,
  inspectAuthoringGraphFreshness,
  runAuthoringGraph,
  adoptAuthoringCandidate,
  readAuthoringTargetFingerprint,
  type AuthoringNodeGraph,
  type AuthoringNodeInstance,
} from '../../src/lib/node-authoring'
import { resolveScopeLike, stampNewRecord } from '../../src/lib/workspace/scope'
import { putCurrentWorkspaceFixtureV1 } from '../helpers/current-workspace'

const project: Project = {
  id: 73002,
  workspaceUid: 'WS-00000000-0000-4000-8000-000000073002',
  workspacePurpose: 'independent-work',
  name: '领域节点同步测试',
  enableMultiWorld: false,
  activeWorldId: 73002,
  activeWorkId: 73002,
  createdAt: 1,
  updatedAt: 1,
}

describe('FLOW-3C · Canon 绑定概览与下游失效', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    await putCurrentWorkspaceFixtureV1(project)
    const scope = await resolveScopeLike(project.id!)
    await db.worldviews.put(stampNewRecord(scope, 'worldviews', {
      projectId: project.id!,
      worldGroupId: null,
      worldOrigin: '潮汐退去后，第一座城从海床升起。',
      mountainsRivers: '北境河流汇入黑潮海。',
      createdAt: 1,
      updatedAt: 1,
    }, { owner: 'world' }) as any)
    await db.storyCores.put(stampNewRecord(scope, 'storyCores', {
      projectId: project.id!,
      logline: '一名测潮者寻找沉没城市。',
      concept: '海床上的城市会在退潮时醒来。',
      createdAt: 1,
      updatedAt: 1,
    }, { owner: 'work' }) as any)
  })

  afterEach(() => db.close())

  it('从项目资料生成实时绑定概览，不把正文复制进图 JSON', async () => {
    const overview = await buildAuthoringOverviewGraph({ projectId: project.id!, worldGroupId: null })
    expect(overview.entryCount).toBeGreaterThanOrEqual(3)
    expect(overview.graph.nodes.every(node => node.binding?.mode === 'live')).toBe(true)
    expect(overview.graph.nodes.every(node => !JSON.stringify(node.config).includes('潮汐退去'))).toBe(true)
    expect(overview.graph.nodes.some(node => node.binding?.ref?.fieldKey === 'worldOrigin')).toBe(true)
    expect(overview.graph.edges.length).toBeGreaterThan(0)
  })

  it('分步骤修改来源后标记绑定节点及其下游需要重跑', async () => {
    const overview = await buildAuthoringOverviewGraph({ projectId: project.id!, worldGroupId: null })
    const now = Date.now()
    const scope = await resolveScopeLike(project.id!)
    const flowId = await db.nodeFlows.add(stampNewRecord(scope, 'nodeFlows', {
      projectId: project.id!,
      worldGroupId: null,
      name: '同步概览',
      description: '',
      graphJson: JSON.stringify(overview.graph),
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' }) as NodeFlow) as number
    const flow = (await db.nodeFlows.get(flowId)) as NodeFlow
    const firstRun = await runAuthoringGraph({ flow })
    const changedWorld = await db.worldviews.where('projectId').equals(project.id!).first()
    await db.worldviews.update(changedWorld!.id!, { worldOrigin: '黑潮退去后，第二座城从海床升起。' })
    const report = await inspectAuthoringGraphFreshness({
      flow,
      snapshots: firstRun.snapshots,
      candidates: firstRun.candidates,
    })
    const changed = overview.graph.nodes.find(node => node.binding?.ref?.fieldKey === 'worldOrigin')!
    expect(report[changed.id].reasons).toContain('source-updated')
    const downstream = overview.graph.edges.find(edge => edge.sourceNodeId === changed.id)?.targetNodeId
    if (downstream) expect(report[downstream].reasons).toContain('upstream-stale')
  })

  it('目标 Canon 已变化时阻止采纳，避免覆盖分步骤模式的新内容', async () => {
    const worldview = await db.worldviews.where('projectId').equals(project.id!).first()
    const worldviewId = worldview!.id!
    await db.worldviews.update(worldviewId, { worldOrigin: '节点运行前的世界来源。' })
    const template = AUTHORING_NODE_BY_ID.get('world.origin')!
    const origin: AuthoringNodeInstance = {
      id: 'origin-conflict',
      templateId: template.id,
      templateVersion: template.version,
      title: template.label,
      x: 0,
      y: 0,
      config: { ...defaultConfigForTemplate(template), candidateCount: 1 },
      inputs: structuredClone(template.inputs),
      outputs: structuredClone(template.outputs),
    }
    const graph: AuthoringNodeGraph = { ...emptyAuthoringGraph(), nodes: [origin] }
    const scope = await resolveScopeLike(project.id!)
    const flowId = await db.nodeFlows.add(stampNewRecord(scope, 'nodeFlows', {
      projectId: project.id!,
      worldGroupId: null,
      name: 'Canon 冲突保护',
      description: '',
      graphJson: JSON.stringify(graph),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, { owner: 'work' })) as number
    const flow = (await db.nodeFlows.get(flowId)) as NodeFlow

    const outcome = await runAuthoringGraph({ flow })
    expect(outcome.candidates[origin.id].signature?.targetHash).toBeDefined()
    const targetBeforeAdopt = await readAuthoringTargetFingerprint({ node: origin, projectId: project.id!, worldGroupId: null })
    await db.worldviews.update(worldviewId, { worldOrigin: '分步骤模式刚刚保存的新世界来源。' })
    const targetAfterUpdate = await readAuthoringTargetFingerprint({ node: origin, projectId: project.id!, worldGroupId: null })
    expect(targetAfterUpdate?.hash).not.toBe(targetBeforeAdopt?.hash)

    await expect(adoptAuthoringCandidate({
      flow,
      nodeId: origin.id,
      output: outcome.candidates[origin.id].output,
    })).rejects.toThrow('目标内容已在分步骤模式或其它入口中更新')
    expect((await db.worldviews.get(worldviewId))?.worldOrigin).toBe('分步骤模式刚刚保存的新世界来源。')
  })
})
