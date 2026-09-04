import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

describe('WORLD-2C C1 · ownership schema foundation', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('World/Work/角色作品绑定使用便携 ID 往返，不复用源数据库外键', async () => {
    const now = Date.now()
    const root = await seedCurrentWorkspace('同一世界双作品地基')
    const { projectId, worldId, workId } = root.scope
    const characterId = await db.characters.add(stampNewRecord(root.scope, 'characters', {
      projectId,
      name: '共同世界角色',
      roleWeight: 'secondary',
      moralAxis: 'neutral',
      orderAxis: 'neutral',
      homeWorldGroupId: null,
      isCrossWorld: false,
      createdAt: now,
      updatedAt: now,
    }, { owner: 'world' }) as any) as number
    await db.worlds.update(worldId, {
      name: '可复用世界',
      description: '世界 Canon',
      updatedAt: now,
    })
    await db.works.update(workId, {
      title: '第一部作品',
      description: '独立作品内容',
      updatedAt: now,
    })
    await db.workCharacterBindings.add(stampNewRecord(root.scope, 'workCharacterBindings', {
      projectId,
      characterId,
      role: 'protagonist',
      arc: '只属于第一部作品的弧光',
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' }))
    await finalizeCurrentFixtureV1(projectId)

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

  it('删除 LocalWorkspace 时 ownership 根、绑定和作用域审计全部级联，其他工作区不受影响', async () => {
    const now = Date.now()
    const doomed = await seedCurrentWorkspace('待删除')
    const survivor = await seedCurrentWorkspace('保留')
    const { projectId: doomedProjectId, worldId: doomedWorldId, workId: doomedWorkId } = doomed.scope
    const survivorProjectId = survivor.scope.projectId
    const doomedCharacterId = await db.characters.add(stampNewRecord(doomed.scope, 'characters', {
      projectId: doomedProjectId,
      name: '待删除角色',
      roleWeight: 'secondary',
      moralAxis: 'neutral',
      orderAxis: 'neutral',
      homeWorldGroupId: null,
      isCrossWorld: false,
      createdAt: now,
      updatedAt: now,
    }, { owner: 'world' }) as any) as number
    await db.workCharacterBindings.add(stampNewRecord(doomed.scope, 'workCharacterBindings', {
      projectId: doomedProjectId, workId: doomedWorkId, characterId: doomedCharacterId,
      createdAt: now, updatedAt: now,
    }, { owner: 'work' }))
    await db.ownershipScopeChanges.add({
      projectId: doomedProjectId,
      worldId: doomedWorldId,
      workId: doomedWorkId,
      tableName: 'workCharacterBindings',
      recordId: 1,
      previousOwner: 'work',
      targetOwner: 'world',
      changedAt: now,
      createdAt: now,
    })
    await cascadeDeleteProject(doomedProjectId)

    expect(await db.worlds.where('projectId').equals(doomedProjectId).count()).toBe(0)
    expect(await db.works.where('projectId').equals(doomedProjectId).count()).toBe(0)
    expect(await db.workCharacterBindings.where('projectId').equals(doomedProjectId).count()).toBe(0)
    expect(await db.ownershipScopeChanges.where('projectId').equals(doomedProjectId).count()).toBe(0)
    expect(await db.worlds.where('projectId').equals(survivorProjectId).count()).toBe(1)
    expect(await db.projects.get(survivorProjectId)).toBeDefined()
  })
})
