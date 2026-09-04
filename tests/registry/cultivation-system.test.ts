import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCultivationContext } from '../../src/lib/ai/cultivation-context'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {
  fingerprintSettingSource,
  listSettingAssertionSources,
} from '../../src/lib/fact-ledger/setting-assertions'
import {
  cultivationStageTiers,
  stringifyCultivationStages,
  validateCultivationStages,
  type CultivationStage,
} from '../../src/lib/types/cultivation'
import { useCultivationStore } from '../../src/stores/cultivation'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentProject } from '../helpers/current-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

const stages: CultivationStage[] = [
  { id: 'root', name: '炼体', parentStageIds: [] },
  { id: 'sword', name: '剑胎', branchLabel: '剑修', parentStageIds: ['root'] },
  { id: 'body', name: '金身', branchLabel: '体修', parentStageIds: ['root'] },
  { id: 'unity', name: '归一', parentStageIds: ['sword', 'body'] },
]

describe('WORLD-1 · 修炼体系 DAG', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })
  afterEach(async () => { db.close() })

  it('接受分叉/合流并拒绝环与悬空父节点', () => {
    expect(validateCultivationStages(stages)).toEqual({ valid: true, errors: [] })
    expect(cultivationStageTiers(stages).get('unity')).toBe(2)
    expect(validateCultivationStages([
      { id: 'a', name: 'A', parentStageIds: ['b'] },
      { id: 'b', name: 'B', parentStageIds: ['a'] },
    ]).valid).toBe(false)
    expect(validateCultivationStages([
      { id: 'a', name: 'A', parentStageIds: ['missing'] },
    ]).valid).toBe(false)
  })

  it('删除阶段和体系时清理角色/异兽结构化关联', async () => {
    const now = Date.now()
    const projectId = await seedCurrentProject({
      name: 'cultivation', genres: [], description: '', targetWordCount: 0,
      enableMultiWorld: true, createdAt: now, updatedAt: now,
    } as any) as number
    const worldGroupId = await db.worldGroups.add({
      projectId, name: '主世界', description: '', type: 'primary', order: 0,
      createdAt: now, updatedAt: now,
    } as any) as number
    const systemId = await db.cultivationSystems.add({
      projectId, worldGroupId, name: '分支体系', description: '',
      stages: stringifyCultivationStages(stages), createdAt: now, updatedAt: now,
    }) as number
    const characterId = await db.characters.add({
      projectId, name: '林舟', roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral',
      shortDescription: '', appearance: '', personality: '', background: '', motivation: '',
      abilities: '', relationships: '', arc: '', homeWorldGroupId: worldGroupId, isCrossWorld: false,
      cultivationSystemId: systemId, cultivationStageId: 'unity',
      createdAt: now, updatedAt: now,
    } as any) as number
    const categoryId = await db.codexCategories.add({
      projectId, domain: 'natural', name: '灵兽', parentId: null, fieldSchema: '[]',
      order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    const beastId = await db.codexEntries.add({
      projectId, categoryId, worldGroupId, name: '青麟', summary: '', description: '', fields: '{}',
      refs: '{}', origin: 'manual', sourceEvidenceQuotes: '[]', sourceContentHash: '',
      producerRunId: null, producerCandidateHash: null, order: 0,
      cultivationSystemId: systemId, cultivationStageId: 'unity',
      createdAt: now, updatedAt: now,
    } as any) as number
    const factId = await db.temporalFacts.add({
      projectId, worldGroupId, subjectName: '世界', predicate: 'powerCeiling',
      factKind: 'rule', value: '归一', sourceType: 'setting',
      sourceRecordTable: 'cultivationSystems', sourceRecordId: systemId,
      sourceCultivationSystemId: systemId, sourceField: 'stages',
      sourceFingerprint: fingerprintSettingSource(stringifyCultivationStages(stages)),
      status: 'confirmed', locked: false, createdAt: now, updatedAt: now,
    } as any) as number
    await finalizeCurrentFixtureV1(projectId)
    await useCultivationStore.getState().loadAll(projectId)

    await useCultivationStore.getState().updateSystem(systemId, {
      stages: stringifyCultivationStages(stages.filter(stage => stage.id !== 'unity')),
    })
    expect((await db.characters.get(characterId))?.cultivationStageId ?? null).toBeNull()
    expect((await db.codexEntries.get(beastId))?.cultivationStageId ?? null).toBeNull()
    expect((await db.characters.get(characterId))?.cultivationSystemId).toBe(systemId)

    await useCultivationStore.getState().deleteSystem(systemId)
    expect((await db.characters.get(characterId))?.cultivationSystemId ?? null).toBeNull()
    expect((await db.codexEntries.get(beastId))?.cultivationSystemId ?? null).toBeNull()
    expect((await db.temporalFacts.get(factId))?.sourceCultivationSystemId ?? null).toBeNull()
    expect((await db.temporalFacts.get(factId))?.status).toBe('source-missing')
  })

  it('AI 上下文严格按世界注入 DAG 与角色当前境界', async () => {
    const now = Date.now()
    const projectId = await seedCurrentProject({
      name: 'ctx', genres: [], description: '', targetWordCount: 0,
      enableMultiWorld: true, createdAt: now, updatedAt: now,
    } as any) as number
    const worldA = await db.worldGroups.add({
      projectId, name: '镜界', description: '', type: 'primary', order: 0,
      createdAt: now, updatedAt: now,
    } as any) as number
    const worldB = await db.worldGroups.add({
      projectId, name: '雾界', description: '', type: 'parallel', order: 1,
      createdAt: now, updatedAt: now,
    } as any) as number
    const systemA = await db.cultivationSystems.add({
      projectId, worldGroupId: worldA, name: '镜界剑修', description: '镜光为刃',
      stages: stringifyCultivationStages(stages), createdAt: now, updatedAt: now,
    }) as number
    await db.cultivationSystems.add({
      projectId, worldGroupId: worldB, name: '雾界巫术', description: '',
      stages: '[]', createdAt: now, updatedAt: now,
    })
    await db.characters.add({
      projectId, name: '林舟', roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral',
      shortDescription: '', appearance: '', personality: '', background: '', motivation: '',
      abilities: '', relationships: '', arc: '', homeWorldGroupId: worldA, isCrossWorld: false,
      cultivationSystemId: systemA, cultivationStageId: 'sword',
      createdAt: now, updatedAt: now,
    } as any)
    await finalizeCurrentFixtureV1(projectId)

    const context = await buildCultivationContext(projectId, worldA)
    expect(context).toContain('镜界剑修')
    expect(context).toContain('前置:剑胎 + 金身')
    expect(context).toContain('林舟@剑胎')
    expect(context).not.toContain('雾界巫术')
  })

  it('进入世界宪法来源并在修改后把旧断言标记为 stale', async () => {
    const now = Date.now()
    const created = await seedCurrentWorkspace('canon')
    const projectId = created.scope.projectId
    const worldGroupId = await db.worldGroups.add(stampNewRecord(created.scope, 'worldGroups', {
      projectId, name: '镜界', type: 'custom', description: '', icon: '', order: 0,
      entryCondition: '', exitCondition: '', powerRestriction: '', takeawayRules: '',
      plannedChapterCount: 0, createdAt: now, updatedAt: now,
    } as never, { owner: 'world' })) as number
    const systemId = await db.cultivationSystems.add(stampNewRecord(created.scope, 'cultivationSystems', {
      projectId, worldGroupId, name: '剑修', description: '最高只能斩断山岳',
      stages: stringifyCultivationStages(stages), createdAt: now, updatedAt: now,
    } as never, { owner: 'world' })) as number
    const sources = await listSettingAssertionSources(projectId, worldGroupId)
    const source = sources.find(item =>
      item.table === 'cultivationSystems' && item.recordId === systemId && item.field === 'description')!
    expect(source.text).toContain('最高只能斩断山岳')
    const factId = await db.temporalFacts.add(stampNewRecord(created.scope, 'temporalFacts', {
      projectId, worldGroupId, subjectName: '镜界', predicate: 'powerCeiling',
      factKind: 'rule', value: '斩断山岳', sourceType: 'setting',
      sourceRecordTable: source.table, sourceRecordId: source.recordId,
      sourceCultivationSystemId: source.recordId, sourceField: source.field,
      sourceFingerprint: source.fingerprint, status: 'confirmed', locked: true,
      createdAt: now, updatedAt: now,
    } as never, { owner: 'work' })) as number
    await useCultivationStore.getState().loadAll(projectId)
    await useCultivationStore.getState().updateSystem(systemId, { description: '最高只能劈开巨石' })
    expect((await db.temporalFacts.get(factId))?.status).toBe('stale')
  })

  it('导出导入重映射角色和世界宪法中的修炼体系 FK', async () => {
    const now = Date.now()
    const projectId = await seedCurrentProject({
      name: 'roundtrip', genres: [], description: '', targetWordCount: 0,
      enableMultiWorld: true, createdAt: now, updatedAt: now,
    } as any) as number
    const worldGroupId = await db.worldGroups.add({
      projectId, name: '主世界', type: 'primary', order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    const systemId = await db.cultivationSystems.add({
      projectId, worldGroupId, name: '剑修', description: '剑意',
      stages: stringifyCultivationStages(stages), createdAt: now, updatedAt: now,
    }) as number
    await db.characters.add({
      projectId, homeWorldGroupId: worldGroupId, isCrossWorld: false, name: '林舟',
      roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral',
      shortDescription: '', appearance: '', personality: '', background: '', motivation: '',
      abilities: '', relationships: '', arc: '',
      cultivationSystemId: systemId, cultivationStageId: 'sword',
      createdAt: now, updatedAt: now,
    } as any)
    await db.temporalFacts.add({
      projectId, worldGroupId, subjectName: '主世界', predicate: 'powerCeiling',
      factKind: 'rule', value: '归一', sourceType: 'setting',
      sourceRecordTable: 'cultivationSystems', sourceRecordId: systemId,
      sourceCultivationSystemId: systemId, sourceField: 'stages',
      sourceFingerprint: fingerprintSettingSource(stringifyCultivationStages(stages)),
      status: 'confirmed', locked: true, createdAt: now, updatedAt: now,
    } as any)
    await finalizeCurrentFixtureV1(projectId)

    const importedProjectId = await importProjectJSON(await exportProjectJSON(projectId))
    const importedSystem = await db.cultivationSystems.where('projectId').equals(importedProjectId).first()
    const importedCharacter = await db.characters.where('projectId').equals(importedProjectId).first()
    const importedFact = await db.temporalFacts.where('projectId').equals(importedProjectId).first()
    expect(importedSystem?.id).not.toBe(systemId)
    expect(importedCharacter?.cultivationSystemId).toBe(importedSystem?.id)
    expect(importedFact?.sourceCultivationSystemId).toBe(importedSystem?.id)
  })
})
