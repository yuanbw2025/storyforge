import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {
  parseCharacterDrivenPlanArcs,
  stringifyCharacterDrivenPlanArcs,
} from '../../src/lib/types'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'
import { seedCurrentProject } from '../helpers/current-workspace'

describe('R-CF9C · 方案导出导入便携引用', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('重映射角色、父版本和 active 引用，不泄漏源数据库主键', async () => {
    const projectId = await seedCurrentProject({
      name: '便携方案',
      genres: ['fantasy'],
      status: 'drafting',
      description: '',
      targetWordCount: 10_000,
      createdAt: 1,
      updatedAt: 1,
    } as any)
    const characterId = await db.characters.add({
      projectId,
      name: '高主键角色',
      roleWeight: 'main',
      moralAxis: 'good',
      orderAxis: 'neutral',
      shortDescription: '', appearance: '', personality: '', background: '',
      motivation: '', abilities: '', relationships: '', arc: '',
      homeWorldGroupId: null, isCrossWorld: false,
      createdAt: 1,
      updatedAt: 1,
    } as any)
    const sourceId = await db.characterDrivenPlans.add({
      projectId,
      name: '源方案',
      arcs: stringifyCharacterDrivenPlanArcs([{
        characterId,
        name: '高主键角色',
        role: '主角',
        initialState: '起点',
        targetState: '终点',
      }]),
      userHint: '',
      generatedVolumes: '[]',
      status: 'draft',
      version: 1,
      parentPlanId: null,
      createdAt: 1,
      updatedAt: 1,
    })
    const childId = await db.characterDrivenPlans.add({
      projectId,
      name: '子版本',
      arcs: stringifyCharacterDrivenPlanArcs([{
        characterId,
        name: '高主键角色',
        role: '主角',
        initialState: '起点',
        targetState: '新终点',
      }]),
      userHint: '第二版',
      generatedVolumes: '[]',
      status: 'draft',
      version: 2,
      parentPlanId: sourceId,
      createdAt: 2,
      updatedAt: 2,
    })
    const sourceWorkId = (await db.projects.get(projectId))?.activeWorkId
    await db.works.update(sourceWorkId!, { activeCharacterDrivenPlanId: childId })
    await finalizeCurrentFixtureV1(projectId)

    const exported = await exportProjectJSON(projectId)
    expect(exported.project).not.toHaveProperty('activeCharacterDrivenPlanId')
    expect(exported.works[0]._activeCharacterDrivenPlanExportId).toBe(1)
    expect(exported.characterDrivenPlans?.[0]._arcCharacterIndexes).toEqual([0])
    expect(exported.characterDrivenPlans?.[1]._parentExportId).toBe(0)

    // 先制造其它项目记录，保证新主键与源主键不同，测试不能误打误撞通过。
    await seedCurrentProject({
      name: '占位',
      genres: ['other'],
      status: 'drafting',
      description: '',
      targetWordCount: 1,
      createdAt: 3,
      updatedAt: 3,
    } as any)
    const importedProjectId = await importProjectJSON(exported)
    const importedCharacter = await db.characters.where('projectId').equals(importedProjectId).first()
    const importedPlans = await db.characterDrivenPlans
      .where('projectId').equals(importedProjectId)
      .sortBy('version')
    const importedWork = await db.works.where('projectId').equals(importedProjectId).first()

    expect(importedPlans).toHaveLength(2)
    expect(parseCharacterDrivenPlanArcs(importedPlans[0].arcs)[0].characterId).toBe(importedCharacter?.id)
    expect(importedPlans[1].parentPlanId).toBe(importedPlans[0].id)
    expect(importedWork?.activeCharacterDrivenPlanId).toBe(importedPlans[1].id)
  })

})
