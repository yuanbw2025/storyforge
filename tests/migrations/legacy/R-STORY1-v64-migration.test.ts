import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

const names: string[] = []

afterEach(async () => {
  for (const name of names.splice(0)) await Dexie.delete(name)
})

class StoryIntentV64FixtureDB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(63).stores({
      storyArcs: '++id, projectId, type',
    })
    this.version(64).stores({
      storyArcs: '++id, projectId, type, sourceStoryCoreId, producerRunId',
    }).upgrade(async tx => {
      await tx.table('storyArcs').toCollection().modify(arc => {
        if (!Object.prototype.hasOwnProperty.call(arc, 'origin')) arc.origin = 'manual'
        if (!Object.prototype.hasOwnProperty.call(arc, 'status')) arc.status = 'active'
      })
    })
  }
}

describe('STORY-1 · v64 故事线投影来源迁移', () => {
  it('保留旧故事线原文并只补 manual/active，不猜测 StoryCore 或 Agent 来源', async () => {
    const name = `story-intent-v64-${Math.random()}`
    names.push(name)
    const legacy = new Dexie(name)
    legacy.version(63).stores({ storyArcs: '++id, projectId, type' })
    await legacy.open()
    const id = await legacy.table('storyArcs').add({
      projectId: 1,
      type: 'main',
      name: '作者旧主线',
      stages: '[{"title":"旧阶段"}]',
      description: '不可丢失的作者原文',
    }) as number
    legacy.close()

    const upgraded = new StoryIntentV64FixtureDB(name)
    await upgraded.open()
    const row = await upgraded.table('storyArcs').get(id)
    expect(row).toMatchObject({
      name: '作者旧主线',
      stages: '[{"title":"旧阶段"}]',
      description: '不可丢失的作者原文',
      origin: 'manual',
      status: 'active',
    })
    expect(row).not.toHaveProperty('sourceStoryCoreId')
    expect(row).not.toHaveProperty('producerRunId')
    expect(upgraded.table('storyArcs').schema.idxByName).toHaveProperty('sourceStoryCoreId')
    expect(upgraded.table('storyArcs').schema.idxByName).toHaveProperty('producerRunId')
    upgraded.close()
  })
})
