import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  filterCharactersByRoleWeight,
} from '../../src/lib/character/character-axes'
import { adopt } from '../../src/lib/registry/adopt'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { seedCurrentProject } from '../helpers/current-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

describe('R-R1-character-axes', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('三分流面板与主要角色页按 roleWeight 唯一归位', () => {
    const rows = [
      { name: '甲', roleWeight: 'main' as const },
      { name: '乙', roleWeight: 'secondary' as const },
      { name: '丙', roleWeight: 'npc' as const },
      { name: '丁', roleWeight: 'extra' as const },
    ]
    expect(filterCharactersByRoleWeight(rows, 'main').map(row => row.name)).toEqual(['甲'])
    expect(filterCharactersByRoleWeight(rows, 'secondary').map(row => row.name)).toEqual(['乙'])
    expect(filterCharactersByRoleWeight(rows, 'npc').map(row => row.name)).toEqual(['丙'])
    expect(filterCharactersByRoleWeight(rows, 'extra').map(row => row.name)).toEqual(['丁'])
  })

  it('AdoptionSchema 强制戏份与九宫格完整', async () => {
    const now = Date.now()
    const projectId = await seedCurrentProject({
      name: '校验项目', genres: ['fantasy'], createdAt: now, updatedAt: now,
    } as any) as number
    const rejected = await adopt({
      projectId,
      target: 'characters',
      mode: 'add',
      data: { name: '缺阵营', roleWeight: 'main' },
    })
    expect(rejected.written).toHaveLength(0)
    expect(rejected.skipped[0]?.reason).toContain('moralAxis')

    await adopt({
      projectId,
      target: 'characters',
      mode: 'add',
      data: {
        name: '守序反派',
        roleWeight: 'main',
        moralAxis: 'evil',
        orderAxis: 'lawful',
      },
    })
    const row = await db.characters.where('projectId').equals(projectId).first()
    expect(row).toMatchObject({
      roleWeight: 'main',
      moralAxis: 'evil',
      orderAxis: 'lawful',
    })
    expect(row).not.toHaveProperty('role')
  })

  it('九宫格字段导出/导入往返不丢失', async () => {
    const now = Date.now()
    const projectId = await seedCurrentProject({
      name: '往返项目', genres: ['fantasy'], createdAt: now, updatedAt: now,
    } as any) as number
    await db.characters.add({
      projectId,
      name: '混乱中立者',
      roleWeight: 'main',
      moralAxis: 'neutral',
      orderAxis: 'chaotic',
      shortDescription: '',
      appearance: '',
      personality: '',
      background: '',
      motivation: '',
      abilities: '',
      relationships: '',
      arc: '',
      createdAt: now,
      updatedAt: now,
    })
    await finalizeCurrentFixtureV1(projectId)
    const exported = await exportProjectJSON(projectId)
    const importedId = await importProjectJSON(exported)
    const row = await db.characters.where('projectId').equals(importedId).first()
    expect(row).toMatchObject({
      roleWeight: 'main',
      moralAxis: 'neutral',
      orderAxis: 'chaotic',
    })
    expect(row).not.toHaveProperty('role')
  })
})
