import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

const names: string[] = []

afterEach(async () => {
  for (const name of names.splice(0)) await Dexie.delete(name)
})

describe('WORLD-1 · DB v41 修炼体系迁移', () => {
  it('只新增空表，不从角色 powerLevel 或世界观文本猜测结构化体系', async () => {
    const name = `world-v41-${Math.random()}`
    names.push(name)
    const old = new Dexie(name)
    old.version(40).stores({
      projects: '++id',
      characters: '++id, projectId, name',
      worldviews: '++id, projectId',
    })
    await old.open()
    const projectId = await old.table('projects').add({ name: '旧项目' })
    await old.table('characters').add({
      projectId, name: '林舟', powerLevel: '金丹',
    })
    await old.table('worldviews').add({
      projectId, powerHierarchy: '炼气→筑基→金丹',
    })
    old.close()

    const upgraded = new Dexie(name)
    upgraded.version(40).stores({
      projects: '++id',
      characters: '++id, projectId, name',
      worldviews: '++id, projectId',
    })
    upgraded.version(41).stores({
      cultivationSystems: '++id, projectId, worldGroupId, name',
    })
    await upgraded.open()

    expect(upgraded.tables.map(table => table.name)).toContain('cultivationSystems')
    expect(await upgraded.table('cultivationSystems').count()).toBe(0)
    expect((await upgraded.table('characters').get(1)).powerLevel).toBe('金丹')
    upgraded.close()
  })
})
