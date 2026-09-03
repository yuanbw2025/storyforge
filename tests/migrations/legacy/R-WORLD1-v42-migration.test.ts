import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../../../src/lib/db/schema'

class LegacyV41 extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(41).stores({
      projects: '++id, updatedAt',
      cultivationSystems: '++id, projectId, worldGroupId, name',
    })
  }
}

describe('WORLD-1 · v42 修炼进度空迁移', () => {
  afterEach(async () => {
    db.close()
    await Dexie.delete('storyforge')
  })

  it('不从角色卡或旧文本猜测正文修炼历史', async () => {
    db.close()
    await Dexie.delete('storyforge')
    const old = new LegacyV41('storyforge')
    await old.open()
    await old.table('projects').add({
      name: '旧项目',
      updatedAt: Date.now(),
      powerHierarchy: '主角已经修炼到金丹',
    })
    old.close()

    await db.open()
    expect(await db.cultivationProgress.count()).toBe(0)
  })
})
