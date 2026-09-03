import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

const names: string[] = []

afterEach(async () => {
  for (const name of names.splice(0)) await Dexie.delete(name)
})

describe('R-CM1 · DB v45 迁移', () => {
  it('只新增空灵感工作区表，不修改旧项目数据', async () => {
    const name = `cm1-v45-${Math.random()}`
    names.push(name)
    const legacy = new Dexie(name)
    legacy.version(44).stores({
      projects: '++id, name',
      characterDrivenPlans: '++id, projectId, status, parentPlanId, updatedAt',
    })
    await legacy.open()
    const projectId = await legacy.table('projects').add({
      name: '旧项目',
      description: '必须原样保留',
    })
    legacy.close()

    const upgraded = new Dexie(name)
    upgraded.version(44).stores({
      projects: '++id, name',
      characterDrivenPlans: '++id, projectId, status, parentPlanId, updatedAt',
    })
    upgraded.version(45).stores({
      inspirationWorkspaces: '++id, projectId, updatedAt',
    })
    await upgraded.open()

    expect(upgraded.tables.map(table => table.name)).toContain('inspirationWorkspaces')
    expect(await upgraded.table('inspirationWorkspaces').count()).toBe(0)
    expect(await upgraded.table('projects').get(projectId)).toEqual({
      id: projectId,
      name: '旧项目',
      description: '必须原样保留',
    })
    upgraded.close()
  })
})
