/**
 * R-13: chunk import writes to selected target world.
 *
 * Regression target:
 *   Import pipeline wrote worldview/characters/outline without worldGroupId,
 *   so multiworld projects imported data into default/null ownership and could
 *   merge same-name characters across worlds.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { applyChunkResult } from '../../src/lib/import/chunk-writer'

describe('R-13: import chunk target world routing', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    db.close()
  })

  it('stamps imported worldview, characters, and outline nodes to target world', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: 'Import Target Test',
      genre: 'fantasy',
      genres: ['fantasy'],
      status: 'drafting',
      description: '',
      targetWordCount: 0,
      enableMultiWorld: true,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const worldA = await db.worldGroups.add({
      projectId, name: '镜城', type: 'primary', order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    const worldB = await db.worldGroups.add({
      projectId, name: '雾都', type: 'parallel', order: 1, createdAt: now, updatedAt: now,
    } as any) as number
    await db.characters.add({
      projectId,
      homeWorldGroupId: worldB,
      name: '沈砚',
      role: 'protagonist',
      shortDescription: '雾都旧角色',
      createdAt: now,
      updatedAt: now,
    } as any)

    await applyChunkResult(projectId, {
      worldview: { worldOrigin: '镜城由海贸兴起。' },
      characters: [{ name: '沈砚', role: 'protagonist', shortDescription: '镜城账房' }],
      outline: [{ title: '镜城卷', summary: '镜税风波', children: [{ title: '第一章', summary: '入城' }] }],
    } as any, worldA)

    const worldviews = await db.worldviews.where('projectId').equals(projectId).toArray()
    expect(worldviews).toHaveLength(1)
    expect(worldviews[0].worldGroupId).toBe(worldA)

    const chars = await db.characters.where('projectId').equals(projectId).toArray()
    expect(chars.filter(c => c.name === '沈砚' && c.homeWorldGroupId === worldB)).toHaveLength(1)
    expect(chars.filter(c => c.name === '沈砚' && c.homeWorldGroupId === worldA)).toHaveLength(1)

    const nodes = await db.outlineNodes.where('projectId').equals(projectId).toArray()
    expect(nodes).toHaveLength(2)
    expect(nodes.every(node => node.worldGroupId === worldA)).toBe(true)
  })
})

