import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  axesFromLegacy,
  deriveCharacterRole,
  filterCharactersByRoleWeight,
} from '../../src/lib/character/character-axes'
import { migrateCharactersToAxes, CHARACTER_AXES_SNAPSHOT_KIND } from '../../src/lib/migrations/character-axes-upgrade'
import { finalizeCharacterAxesMigrationSnapshots } from '../../src/lib/migrations/finalize-character-axes-snapshots'
import { adopt } from '../../src/lib/registry/adopt'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

const fixtureNames: string[] = []

class LegacyV32CharacterDB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(32).stores({
      projects: '++id, name',
      characters: '++id, projectId, name, role',
      snapshots: '++id, projectId, type, createdAt',
    })
  }
}

class UpgradedV33CharacterDB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(32).stores({
      projects: '++id, name',
      characters: '++id, projectId, name, role',
      snapshots: '++id, projectId, type, createdAt',
    })
    this.version(33).stores({
      characters: '++id, projectId, name, role, roleWeight, moralAxis, orderAxis',
    }).upgrade(migrateCharactersToAxes)
  }
}

afterEach(async () => {
  for (const name of fixtureNames.splice(0)) await Dexie.delete(name)
})

describe('R-R1-character-axes', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('v32→v33 真实老库迁移覆盖旧 6 值，并先写迁移快照 marker', async () => {
    const name = `r1-v33-${Math.random()}`
    fixtureNames.push(name)
    const oldDb = new LegacyV32CharacterDB(name)
    await oldDb.open()
    const projectId = await oldDb.table('projects').add({ name: '旧项目' })
    for (const [role, alignment] of [
      ['protagonist', undefined],
      ['antagonist', undefined],
      ['supporting', 'good'],
      ['minor', 'evil'],
      ['npc', undefined],
      ['extra', undefined],
    ] as const) {
      await oldDb.table('characters').add({ projectId, name: role, role, alignment })
    }
    oldDb.close()

    const upgraded = new UpgradedV33CharacterDB(name)
    await upgraded.open()
    const rows = await upgraded.table('characters').toArray()
    expect(rows.map(row => [row.role, row.roleWeight, row.moralAxis, row.orderAxis])).toEqual([
      ['protagonist', 'main', 'good', 'neutral'],
      ['antagonist', 'main', 'evil', 'neutral'],
      ['supporting', 'main', 'good', 'neutral'],
      ['minor', 'secondary', 'evil', 'neutral'],
      ['npc', 'npc', 'neutral', 'neutral'],
      ['extra', 'extra', 'neutral', 'neutral'],
    ])
    const snapshot = (await upgraded.table('snapshots').toArray())[0]
    expect(snapshot.label).toBe('R1 角色轴迁移前自动快照')
    expect(JSON.parse(snapshot.data).kind).toBe(CHARACTER_AXES_SNAPSHOT_KIND)
    expect(JSON.parse(snapshot.data).characters).toHaveLength(6)
    upgraded.close()
  })

  it('role 只由戏份+道德轴派生', () => {
    expect(deriveCharacterRole('main', 'good')).toBe('protagonist')
    expect(deriveCharacterRole('main', 'evil')).toBe('antagonist')
    expect(deriveCharacterRole('main', 'neutral')).toBe('supporting')
    expect(deriveCharacterRole('secondary', 'evil')).toBe('minor')
    expect(deriveCharacterRole('npc', 'good')).toBe('npc')
    expect(deriveCharacterRole('extra', 'evil')).toBe('extra')
    expect(axesFromLegacy('supporting', 'evil')).toMatchObject({
      roleWeight: 'main', moralAxis: 'evil', orderAxis: 'neutral',
    })
  })

  it('迁移 marker 在开库后完成为可恢复的标准项目快照', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: '快照项目', genre: 'fantasy', createdAt: now, updatedAt: now,
    } as any) as number
    const characterId = await db.characters.add({
      projectId,
      name: '旧反派',
      role: 'antagonist',
      roleWeight: 'main',
      moralAxis: 'evil',
      orderAxis: 'neutral',
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
    const marker = JSON.stringify({
      kind: CHARACTER_AXES_SNAPSHOT_KIND,
      schemaVersion: 32,
      characters: [{
        id: characterId,
        projectId,
        name: '旧反派',
        role: 'antagonist',
        alignment: 'evil',
        createdAt: now,
        updatedAt: now,
      }],
    })
    const snapshotId = await db.snapshots.add({
      projectId,
      label: 'R1 角色轴迁移前自动快照',
      type: 'auto',
      data: marker,
      size: marker.length,
      createdAt: now,
    })

    await finalizeCharacterAxesMigrationSnapshots()
    const snapshot = await db.snapshots.get(snapshotId)
    const restored = JSON.parse(snapshot!.data)
    expect(restored.version).toBe(3)
    expect(restored.characters[0]).toMatchObject({
      name: '旧反派',
      role: 'antagonist',
      alignment: 'evil',
    })
    expect(restored.characters[0]).not.toHaveProperty('roleWeight')
    expect(restored.characters[0]).not.toHaveProperty('moralAxis')
    expect(restored.characters[0]).not.toHaveProperty('orderAxis')
  })

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

  it('AdoptionSchema 强制戏份与九宫格完整，并派生兼容 role', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: '校验项目', genre: 'fantasy', createdAt: now, updatedAt: now,
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
      role: 'antagonist',
    })
  })

  it('九宫格字段导出/导入往返不丢失', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: '往返项目', genre: 'fantasy', createdAt: now, updatedAt: now,
    } as any) as number
    await db.characters.add({
      projectId,
      name: '混乱中立者',
      roleWeight: 'main',
      moralAxis: 'neutral',
      orderAxis: 'chaotic',
      role: 'supporting',
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
    const exported = await exportProjectJSON(projectId)
    const importedId = await importProjectJSON(exported)
    const row = await db.characters.where('projectId').equals(importedId).first()
    expect(row).toMatchObject({
      roleWeight: 'main',
      moralAxis: 'neutral',
      orderAxis: 'chaotic',
      role: 'supporting',
    })
  })
})
