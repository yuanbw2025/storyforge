import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

const names: string[] = []

afterEach(async () => {
  for (const name of names.splice(0)) await Dexie.delete(name)
})

class StorylineV40FixtureDB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(39).stores({
      storyArcs: '++id, projectId, type',
      chapters: '++id, projectId, outlineNodeId, order, status',
    })
    this.version(40).stores({
      storylineProgress: '++id, &arcId, projectId, status, lastActiveChapterId',
      storylineCrossings: '++id, projectId, arcIdA, arcIdB, chapterId',
    })
  }
}

describe('R-Phase39 · v40 空表迁移不猜测历史', () => {
  it('保留 v39 故事线与章节，并只创建空的动态进度表', async () => {
    const name = `storyline-v40-${Math.random()}`
    names.push(name)
    const legacy = new Dexie(name)
    legacy.version(39).stores({
      storyArcs: '++id, projectId, type',
      chapters: '++id, projectId, outlineNodeId, order, status',
    })
    // 先真正制造一个 v39 库。
    await legacy.open()
    await legacy.table('storyArcs').add({ projectId: 1, type: 'main', name: '主线' })
    await legacy.table('chapters').add({ projectId: 1, outlineNodeId: 1, order: 0, status: 'draft' })
    legacy.close()

    const upgraded = new StorylineV40FixtureDB(name)
    await upgraded.open()
    expect(await upgraded.table('storyArcs').count()).toBe(1)
    expect(await upgraded.table('chapters').count()).toBe(1)
    expect(await upgraded.table('storylineProgress').count()).toBe(0)
    expect(await upgraded.table('storylineCrossings').count()).toBe(0)
    upgraded.close()
  })
})
