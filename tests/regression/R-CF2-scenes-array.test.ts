import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { adopt } from '../../src/lib/registry/adopt'
import { normalizeDetailedScenes } from '../../src/lib/types/detailed-outline'
import type { DetailedScene } from '../../src/lib/types/detailed-outline'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'
import { seedCurrentProject } from '../helpers/current-workspace'

const scene = (over: Partial<DetailedScene> = {}): DetailedScene => ({
  sceneId: 's1', title: '初遇', summary: '主角登场', characterIds: [],
  location: '城门', conflict: '冲突', pace: 'medium', estimatedWords: 800, notes: '', ...over,
})

describe('R-CF2-scenes-array', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('normalizeDetailedScenes 只接受当前数组结构，拒绝旧字符串和损坏项', () => {
    expect(normalizeDetailedScenes([scene()])).toHaveLength(1)
    expect(() => normalizeDetailedScenes(JSON.stringify([scene()]))).toThrow('必须是当前结构的数组')
    expect(() => normalizeDetailedScenes(undefined)).toThrow('必须是当前结构的数组')
    expect(() => normalizeDetailedScenes(['x', null, scene()] as unknown)).toThrow('包含非法场景项')
  })

  it('adopt detailedOutlines.scenes 后 DB 仍为数组（json→arr 根因修复，不再被 stringify）', async () => {
    const now = Date.now()
    const projectId = await seedCurrentProject({ name: 'P', createdAt: now, updatedAt: now } as any) as number
    const nodeId = await db.outlineNodes.add({ projectId, type: 'chapter', title: '第1章', parentId: null, order: 0, summary: '', createdAt: now, updatedAt: now } as any) as number
    await finalizeCurrentFixtureV1(projectId)

    await adopt({
      projectId, target: 'detailedOutlines', mode: 'add',
      data: {
        outlineNodeId: nodeId,
        scenes: [scene(), scene({ sceneId: 's2', title: '冲突' })],
        prohibitions: ['不能提前知情'],
      },
    })
    const row = await db.detailedOutlines.where('outlineNodeId').equals(nodeId).first()
    expect(Array.isArray(row!.scenes)).toBe(true)          // 关键：不是字符串
    expect(row!.scenes).toHaveLength(2)
    expect(row!.prohibitions).toEqual(['不能提前知情'])
    expect(() => (row!.scenes as DetailedScene[]).reduce((s, sc) => s + sc.estimatedWords, 0)).not.toThrow()
  })

})
