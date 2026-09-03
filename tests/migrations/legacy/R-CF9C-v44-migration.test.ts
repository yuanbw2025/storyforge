import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

const names: string[] = []

afterEach(async () => {
  for (const name of names.splice(0)) await Dexie.delete(name)
})

describe('R-CF9C · DB v44 迁移', () => {
  it('只新增空方案表，不修改旧项目和角色数据', async () => {
    const name = `cf9c-v44-${Math.random()}`
    names.push(name)
    const legacy = new Dexie(name)
    legacy.version(43).stores({
      projects: '++id, name',
      characters: '++id, projectId, name',
    })
    await legacy.open()
    const projectId = await legacy.table('projects').add({
      name: '旧项目',
      description: '必须原样保留',
    })
    await legacy.table('characters').add({
      projectId,
      name: '旧角色',
      background: '旧背景',
    })
    legacy.close()

    const upgraded = new Dexie(name)
    upgraded.version(43).stores({
      projects: '++id, name',
      characters: '++id, projectId, name',
    })
    upgraded.version(44).stores({
      characterDrivenPlans: '++id, projectId, status, parentPlanId, updatedAt',
    })
    await upgraded.open()

    expect(upgraded.tables.map(table => table.name)).toContain('characterDrivenPlans')
    expect(await upgraded.table('characterDrivenPlans').count()).toBe(0)
    expect(await upgraded.table('projects').get(projectId)).toEqual({
      id: projectId,
      name: '旧项目',
      description: '必须原样保留',
    })
    expect((await upgraded.table('characters').get(1)).background).toBe('旧背景')
    upgraded.close()
  })
})
