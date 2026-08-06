import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'

describe('WORLD-2C C1 · ownership schema foundation', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('World/Work/角色作品绑定使用便携 ID 往返，不复用源数据库外键', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: '同一世界双作品地基',
      genre: 'fantasy',
      genres: ['fantasy'],
      status: 'drafting',
      description: '',
      targetWordCount: 100000,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const characterId = await db.characters.add({
      projectId,
      name: '共同世界角色',
      role: 'supporting',
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const worldId = await db.worlds.add({
      projectId,
      code: 'world-c1-portable',
      name: '可复用世界',
      description: '世界 Canon',
      currentVersion: 1,
      createdAt: now,
      updatedAt: now,
    }) as number
    const workId = await db.works.add({
      projectId,
      worldId,
      title: '第一部作品',
      description: '独立作品内容',
      genres: ['fantasy'],
      status: 'drafting',
      targetWordCount: 100000,
      createdAt: now,
      updatedAt: now,
    }) as number
    await db.workCharacterBindings.add({
      projectId,
      workId,
      characterId,
      role: 'protagonist',
      arc: '只属于第一部作品的弧光',
      createdAt: now,
      updatedAt: now,
    })
    await db.projects.update(projectId, { activeWorldId: worldId, activeWorkId: workId })

    const backup = await exportProjectJSON(projectId)
    expect(backup.project).toMatchObject({ _activeWorldExportId: 0, _activeWorkExportId: 0 })
    expect(backup.works?.[0]).toMatchObject({ _worldExportId: 0, title: '第一部作品' })
    expect(backup.workCharacterBindings?.[0]).toMatchObject({
      _workExportId: 0,
      _characterExportId: 0,
      arc: '只属于第一部作品的弧光',
    })

    const importedProjectId = await importProjectJSON(backup)
    const importedWorld = await db.worlds.where('projectId').equals(importedProjectId).first()
    const importedWork = await db.works.where('projectId').equals(importedProjectId).first()
    const importedCharacter = await db.characters.where('projectId').equals(importedProjectId).first()
    const importedBinding = await db.workCharacterBindings.where('projectId').equals(importedProjectId).first()
    const importedProject = await db.projects.get(importedProjectId)

    expect(importedWorld?.id).not.toBe(worldId)
    expect(importedWork?.worldId).toBe(importedWorld?.id)
    expect(importedWork?.worldId).not.toBe(worldId)
    expect(importedBinding?.workId).toBe(importedWork?.id)
    expect(importedBinding?.characterId).toBe(importedCharacter?.id)
    expect(importedBinding?.characterId).not.toBe(characterId)
    expect(importedProject?.activeWorldId).toBe(importedWorld?.id)
    expect(importedProject?.activeWorkId).toBe(importedWork?.id)
  })

  it('删除 LocalWorkspace 时 ownership 根、绑定和迁移凭证全部级联，其他工作区不受影响', async () => {
    const now = Date.now()
    const doomedProjectId = await db.projects.add({
      name: '待删除', genre: '', genres: [], status: 'drafting', description: '', targetWordCount: 0,
      createdAt: now, updatedAt: now,
    } as any) as number
    const survivorProjectId = await db.projects.add({
      name: '保留', genre: '', genres: [], status: 'drafting', description: '', targetWordCount: 0,
      createdAt: now, updatedAt: now,
    } as any) as number
    const doomedWorldId = await db.worlds.add({
      projectId: doomedProjectId, code: 'doomed', name: '待删除世界', description: '',
      currentVersion: 1, createdAt: now, updatedAt: now,
    }) as number
    const doomedWorkId = await db.works.add({
      projectId: doomedProjectId, worldId: doomedWorldId, title: '待删除作品', description: '', genres: [],
      status: 'drafting', targetWordCount: 0, createdAt: now, updatedAt: now,
    }) as number
    const doomedCharacterId = await db.characters.add({
      projectId: doomedProjectId, name: '待删除角色', role: 'supporting', createdAt: now, updatedAt: now,
    } as any) as number
    await db.workCharacterBindings.add({
      projectId: doomedProjectId, workId: doomedWorkId, characterId: doomedCharacterId,
      createdAt: now, updatedAt: now,
    })
    await db.ownershipMigrations.add({
      projectId: doomedProjectId,
      contractVersion: 1,
      status: 'prepared',
      sourceFingerprint: 'fixture',
      sourceCounts: {},
      projectBeforeImage: {},
      ownerBeforeImages: {},
      preparedAt: now,
      updatedAt: now,
    })
    await db.worlds.add({
      projectId: survivorProjectId, code: 'survivor', name: '保留世界', description: '',
      currentVersion: 1, createdAt: now, updatedAt: now,
    })

    await cascadeDeleteProject(doomedProjectId)

    expect(await db.worlds.where('projectId').equals(doomedProjectId).count()).toBe(0)
    expect(await db.works.where('projectId').equals(doomedProjectId).count()).toBe(0)
    expect(await db.workCharacterBindings.where('projectId').equals(doomedProjectId).count()).toBe(0)
    expect(await db.ownershipMigrations.where('projectId').equals(doomedProjectId).count()).toBe(0)
    expect(await db.worlds.where('projectId').equals(survivorProjectId).count()).toBe(1)
    expect(await db.projects.get(survivorProjectId)).toBeDefined()
  })
})
