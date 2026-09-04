import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  assertFutureEvolutionPlanFreshV1,
  buildFutureEvolutionPlanV1,
} from '../../src/lib/outline/future-evolution'
import type { WorkspaceScope } from '../../src/lib/types'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

async function seedWorkspace(): Promise<{
  scope: WorkspaceScope
  worldGroupId: number
  otherWorldGroupId: number
  chapterIds: number[]
  outlineIds: number[]
}> {
  const now = Date.now()
  const createdWorkspaceV1 = await seedCurrentWorkspace('未来演化验收', {
    targetWordCount: 1_000_000,
  })
  const { projectId, worldId, workId } = createdWorkspaceV1.scope
  const worldGroupId = await db.worldGroups.add({
    projectId, worldId, name: '主世界', order: 0, createdAt: now, updatedAt: now,
  }) as number
  const otherWorldGroupId = await db.worldGroups.add({
    projectId, worldId, name: '异世界', order: 1, createdAt: now, updatedAt: now,
  }) as number
  const volumeId = await db.outlineNodes.add({
    projectId, workId, parentId: null, type: 'volume', title: '第一卷', summary: '', order: 0,
    worldGroupId, createdAt: now, updatedAt: now,
  } as any) as number
  const outlineIds: number[] = []
  for (let index = 0; index < 4; index += 1) {
    outlineIds.push(await db.outlineNodes.add({
      projectId, workId, parentId: volumeId, type: 'chapter', title: `第${index + 1}章`,
      summary: `章纲${index + 1}`, order: index,
      // Child nodes intentionally inherit the volume world group.
      worldGroupId: null, createdAt: now + index, updatedAt: now + index,
    } as any) as number)
  }
  await db.outlineNodes.add({
    projectId, workId, parentId: null, type: 'chapter', title: '异世界章', summary: '', order: 9,
    worldGroupId: otherWorldGroupId, createdAt: now, updatedAt: now,
  } as any)
  const chapterIds: number[] = []
  for (let index = 0; index < 3; index += 1) {
    chapterIds.push(await db.chapters.add({
      projectId, workId, outlineNodeId: outlineIds[index], title: `第${index + 1}章`,
      content: index < 2 ? `<p>已写正文${index + 1}</p>` : '', wordCount: index < 2 ? 8 : 0,
      status: index < 2 ? 'draft' : 'outline', order: index, notes: '',
      createdAt: now + index, updatedAt: now + index,
    } as any) as number)
  }
  await db.detailedOutlines.add({
    projectId, workId, outlineNodeId: outlineIds[2], scenes: [],
    createdAt: now, updatedAt: now,
  } as any)
  const arcId = await db.storyArcs.add({
    projectId, workId, worldGroupId, name: '守灯主线', type: 'main',
    stages: JSON.stringify([
      { id: 'stage-1', title: '点灯', description: '', keyEvents: [] },
      { id: 'stage-2', title: '渡海', description: '', keyEvents: [] },
      { id: 'stage-3', title: '回城', description: '', keyEvents: [] },
    ]),
    status: 'active', origin: 'manual', createdAt: now, updatedAt: now,
  } as any) as number
  await db.storylineProgress.add({
    projectId, workId, arcId, currentStageId: 'stage-2', status: 'active',
    progressNote: '已渡海', lastActiveChapterId: chapterIds[1],
    lastActiveChapterTitle: '第2章', involvedEntities: '[]', createdAt: now, updatedAt: now,
  } as any)
  await db.characters.bulkAdd([
    {
      projectId, worldId, homeWorldGroupId: worldGroupId, isCrossWorld: false,
      name: '守灯人', roleWeight: 'main', moralAxis: 'good', orderAxis: 'lawful',
      shortDescription: '', appearance: '', personality: '', background: '', motivation: '', abilities: '',
      relationships: '', arc: '', createdAt: now, updatedAt: now,
    },
    {
      projectId, worldId, homeWorldGroupId: otherWorldGroupId, isCrossWorld: false,
      name: '异界旅人', roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral',
      shortDescription: '', appearance: '', personality: '', background: '', motivation: '', abilities: '',
      relationships: '', arc: '', createdAt: now, updatedAt: now,
    },
    {
      projectId, worldId, homeWorldGroupId: otherWorldGroupId, isCrossWorld: true,
      name: '跨界信使', roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral',
      shortDescription: '', appearance: '', personality: '', background: '', motivation: '', abilities: '',
      relationships: '', arc: '', createdAt: now, updatedAt: now,
    },
  ] as any)
  await finalizeCurrentFixtureV1(projectId)
  return {
    scope: { projectId, worldId, workId }, worldGroupId, otherWorldGroupId, chapterIds, outlineIds,
  }
}

describe.sequential('FUTURE-1 · 只向未来的持续演化控制面', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('以最后已写章冻结历史，保留继承世界作用域并派生完整阶段链', async () => {
    const fixture = await seedWorkspace()
    const plan = await buildFutureEvolutionPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
    })
    expect(plan.frontier).toMatchObject({
      lastWrittenOrdinal: 2,
      lastWrittenOutlineNodeId: fixture.outlineIds[1],
      lastWrittenChapterId: fixture.chapterIds[1],
      protectedOutlineNodeIds: fixture.outlineIds.slice(0, 2),
      futureOutlineNodeIds: fixture.outlineIds.slice(2),
    })
    expect(plan.futureTargets).toMatchObject([
      { outlineNodeId: fixture.outlineIds[2], detailStatus: 'present' },
      { outlineNodeId: fixture.outlineIds[3], detailStatus: 'missing' },
    ])
    expect(plan.protectedStoryArcs[0].protectedStageIds).toEqual(['stage-1', 'stage-2'])
    expect(plan.visibleCharacterIds).toHaveLength(2)
    expect(plan.stages.map(stage => stage.id)).toEqual([
      'foundation', 'outline', 'detail', 'prose', 'settlement',
    ])
    expect(plan.stages.find(stage => stage.id === 'detail')?.targetOutlineNodeIds)
      .toEqual(fixture.outlineIds.slice(2))
    expect(plan.stages.find(stage => stage.id === 'prose')?.targetOutlineNodeIds)
      .toEqual([fixture.outlineIds[2]])
    expect(plan.stages.flatMap(stage => stage.skillContracts).every(contract => (
      contract.contextSourceKeys.length > 0 && contract.writeTargets.length > 0
    ))).toBe(true)
    expect(plan).not.toHaveProperty('productBoundary')
  })

  it('任何正文或上游 Canon 变化都会使旧计划 stale，重新规划后推进边界', async () => {
    const fixture = await seedWorkspace()
    const first = await buildFutureEvolutionPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
    })
    await assertFutureEvolutionPlanFreshV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      expectedPlanHash: first.planHash,
    })
    await db.chapters.update(fixture.chapterIds[2], {
      content: '<p>第三章已经由作者确认写入。</p>',
      wordCount: 13,
      updatedAt: Date.now() + 100,
    })
    await expect(assertFutureEvolutionPlanFreshV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      expectedPlanHash: first.planHash,
    })).rejects.toThrow('必须在最新正式内容上重新规划')
    const current = await buildFutureEvolutionPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
    })
    expect(current.frontier.lastWrittenOrdinal).toBe(3)
    expect(current.frontier.futureOutlineNodeIds).toEqual([fixture.outlineIds[3]])
  })
})
