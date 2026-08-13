import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {
  adoptSettingAssertionCandidates,
  buildSettingAssertionExtractMessagesFromRegisteredContextV1,
  formatSettingAssertionScanContext,
  fingerprintSettingSource,
  listSettingAssertionSources,
  parseSettingAssertionCandidatesStrictV1,
} from '../../src/lib/fact-ledger/setting-assertions'
import {
  confirmFactCandidate,
  replaceConstitutionFactCandidate,
} from '../../src/lib/fact-ledger/fact-ledger'
import { adopt } from '../../src/lib/registry/adopt'
import type { TemporalFact } from '../../src/lib/types'

const now = 1

async function seedSettingProject() {
  const projectId = await db.projects.add({
    name: '世界宪法回归',
    genre: 'fantasy',
    description: '',
    targetWordCount: 0,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldGroupId = await db.worldGroups.add({
    projectId,
    name: '曜月界',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldviewId = await db.worldviews.add({
    projectId,
    worldGroupId,
    worldOrigin: '曜月界的魔法源于月亮潮汐。',
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const powerSystemId = await db.powerSystems.add({
    projectId,
    worldGroupId,
    name: '潮汐术',
    description: '术士借用月亮潮汐施法。',
    levels: '观潮、引潮、御潮',
    rules: '最高只能达到御潮。',
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const storyCoreId = await db.storyCores.add({
    projectId,
    logline: '孤儿林飞寻找身世。',
    concept: '',
    mainPlot: '',
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const characterId = await db.characters.add({
    projectId,
    homeWorldGroupId: worldGroupId,
    name: '林飞',
    background: '林飞自幼父母双亡。',
    relationships: '',
    identity: '遗民',
    createdAt: now,
    updatedAt: now,
  } as any) as number
  return { projectId, worldGroupId, worldviewId, powerSystemId, storyCoreId, characterId }
}

function fact(projectId: number, overrides: Partial<TemporalFact>): TemporalFact {
  return {
    projectId,
    subjectName: '曜月界',
    predicate: 'magicSource',
    factKind: 'state',
    value: '月亮潮汐',
    sourceType: 'setting',
    sourceQuote: '魔法源于月亮潮汐',
    sourceFingerprint: fingerprintSettingSource('曜月界的魔法源于月亮潮汐。'),
    status: 'candidate',
    locked: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('CONSISTENCY-3 · 世界宪法闭集、生命周期与回报通道', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('闭集抽取要求登记主题、登记来源、有效主体与逐字证据', async () => {
    const seeded = await seedSettingProject()
    const sources = await listSettingAssertionSources(seeded.projectId, seeded.worldGroupId)
    const subjects = {
      worldGroups: [{ id: seeded.worldGroupId, name: '曜月界' }],
      characters: [{ id: seeded.characterId, name: '林飞', worldGroupId: seeded.worldGroupId }],
    }
    const worldviewSource = sources.find(source =>
      source.table === 'worldviews' && source.field === 'worldOrigin')!
    const prompt = buildSettingAssertionExtractMessagesFromRegisteredContextV1(
      formatSettingAssertionScanContext(sources, subjects),
    ).map(message => message.content).join('\n')
    expect(prompt).toContain(worldviewSource.sourceKey)
    expect(prompt).toContain('magicSource')

    const valid = {
      subjectType: 'worldGroup' as const,
      subjectId: seeded.worldGroupId,
      predicate: 'magicSource',
      value: '月亮潮汐',
      sourceKey: worldviewSource.sourceKey,
      quote: '魔法源于月亮潮汐',
    }
    const parsed = parseSettingAssertionCandidatesStrictV1(
      JSON.stringify({ assertions: [valid] }),
      sources,
      subjects,
    )
    expect(() => parseSettingAssertionCandidatesStrictV1(JSON.stringify({
      assertions: [{ ...valid, predicate: 'inventedRule' }],
    }), sources, subjects)).toThrow('闭集')

    expect(parsed).toHaveLength(1)
    const adopted = await adoptSettingAssertionCandidates({
      projectId: seeded.projectId,
      worldGroupId: seeded.worldGroupId,
      candidates: parsed,
      sources,
      subjects,
    })
    expect(adopted).toEqual({ written: 1, skipped: 0 })
    const row = await db.temporalFacts.where('projectId').equals(seeded.projectId).first()
    expect(row).toMatchObject({
      status: 'candidate',
      sourceType: 'setting',
      sourceWorldviewId: seeded.worldviewId,
      sourceField: 'worldOrigin',
      subjectWorldGroupId: seeded.worldGroupId,
    })
  })

  it('已确认且来源仍有效的宪法进入上下文；来源修改后自动 stale 并阻止重确认', async () => {
    const seeded = await seedSettingProject()
    const factId = await db.temporalFacts.add(fact(seeded.projectId, {
      worldGroupId: seeded.worldGroupId,
      subjectWorldGroupId: seeded.worldGroupId,
      sourceRecordTable: 'worldviews',
      sourceRecordId: seeded.worldviewId,
      sourceWorldviewId: seeded.worldviewId,
      sourceField: 'worldOrigin',
    })) as number
    expect((await confirmFactCandidate(factId)).confirmed).toBe(true)
    const before = await assembleContext({
      projectId: seeded.projectId,
      worldGroupId: seeded.worldGroupId,
      sourceKeys: ['canonAssertions'],
    })
    expect(before.text).toContain('月亮潮汐')

    await adopt({
      projectId: seeded.projectId,
      worldGroupId: seeded.worldGroupId,
      target: 'worldviews',
      mode: 'replace',
      data: { worldOrigin: '魔法源于血脉觉醒。' },
    })
    expect((await db.temporalFacts.get(factId))?.status).toBe('stale')
    const result = await confirmFactCandidate(factId)
    expect(result).toMatchObject({ confirmed: false, reason: 'source-stale' })
    const after = await assembleContext({
      projectId: seeded.projectId,
      worldGroupId: seeded.worldGroupId,
      sourceKeys: ['canonAssertions'],
    })
    expect(after.text).toBe('')
  })

  it('四类显式来源 FK 在项目导出导入后全部指向新项目记录', async () => {
    const seeded = await seedSettingProject()
    await db.temporalFacts.bulkAdd([
      fact(seeded.projectId, {
        worldGroupId: seeded.worldGroupId,
        subjectWorldGroupId: seeded.worldGroupId,
        sourceRecordTable: 'worldviews',
        sourceRecordId: seeded.worldviewId,
        sourceWorldviewId: seeded.worldviewId,
        sourceField: 'worldOrigin',
      }),
      fact(seeded.projectId, {
        worldGroupId: seeded.worldGroupId,
        subjectWorldGroupId: seeded.worldGroupId,
        predicate: 'powerCeiling',
        value: '御潮',
        sourceRecordTable: 'powerSystems',
        sourceRecordId: seeded.powerSystemId,
        sourcePowerSystemId: seeded.powerSystemId,
        sourceField: 'rules',
        sourceFingerprint: fingerprintSettingSource('最高只能达到御潮。'),
        sourceQuote: '最高只能达到御潮',
      }),
      fact(seeded.projectId, {
        worldGroupId: seeded.worldGroupId,
        characterId: seeded.characterId,
        subjectName: '林飞',
        predicate: 'parentStatus',
        value: '父母双亡',
        sourceRecordTable: 'storyCores',
        sourceRecordId: seeded.storyCoreId,
        sourceStoryCoreId: seeded.storyCoreId,
        sourceField: 'logline',
        sourceFingerprint: fingerprintSettingSource('孤儿林飞寻找身世。'),
        sourceQuote: '孤儿林飞',
      }),
      fact(seeded.projectId, {
        worldGroupId: seeded.worldGroupId,
        characterId: seeded.characterId,
        subjectName: '林飞',
        predicate: 'trueIdentity',
        value: '遗民',
        sourceRecordTable: 'characters',
        sourceRecordId: seeded.characterId,
        sourceCharacterId: seeded.characterId,
        sourceField: 'identity',
        sourceFingerprint: fingerprintSettingSource('遗民'),
        sourceQuote: '遗民',
      }),
    ])

    const importedProjectId = await importProjectJSON(await exportProjectJSON(seeded.projectId))
    const [rows, worldview, powerSystem, storyCore, character] = await Promise.all([
      db.temporalFacts.where('projectId').equals(importedProjectId).toArray(),
      db.worldviews.where('projectId').equals(importedProjectId).first(),
      db.powerSystems.where('projectId').equals(importedProjectId).first(),
      db.storyCores.where('projectId').equals(importedProjectId).first(),
      db.characters.where('projectId').equals(importedProjectId).first(),
    ])
    expect(rows.find(row => row.sourceWorldviewId)?.sourceWorldviewId).toBe(worldview!.id)
    expect(rows.find(row => row.sourcePowerSystemId)?.sourcePowerSystemId).toBe(powerSystem!.id)
    expect(rows.find(row => row.sourceStoryCoreId)?.sourceStoryCoreId).toBe(storyCore!.id)
    expect(rows.find(row => row.sourceCharacterId)?.sourceCharacterId).toBe(character!.id)
    expect(rows.every(row => row.status === 'candidate')).toBe(true)
  })

  it('锁定旧宪法拒绝显式取代；导入不可映射来源时保留候选并降级复核', async () => {
    const seeded = await seedSettingProject()
    const oldId = await db.temporalFacts.add(fact(seeded.projectId, {
      worldGroupId: seeded.worldGroupId,
      subjectWorldGroupId: seeded.worldGroupId,
      sourceRecordTable: 'worldviews',
      sourceWorldviewId: seeded.worldviewId,
      sourceField: 'worldOrigin',
      status: 'confirmed',
      locked: true,
    })) as number
    const candidateId = await db.temporalFacts.add(fact(seeded.projectId, {
      worldGroupId: seeded.worldGroupId,
      subjectWorldGroupId: seeded.worldGroupId,
      value: '血脉觉醒',
      sourceRecordTable: 'powerSystems',
      sourcePowerSystemId: seeded.powerSystemId,
      sourceField: 'description',
      sourceFingerprint: fingerprintSettingSource('术士借用月亮潮汐施法。'),
      sourceQuote: '术士借用月亮潮汐施法',
    })) as number
    expect(await replaceConstitutionFactCandidate(candidateId)).toMatchObject({
      confirmed: false,
      replaced: 0,
      reason: 'locked-conflict',
    })
    expect((await db.temporalFacts.get(oldId))?.status).toBe('confirmed')

    const exported = await exportProjectJSON(seeded.projectId)
    const portable = exported.temporalFacts?.find(row => row.value === '血脉觉醒') as any
    portable._srcPowerSystemExportId = 999_999
    const importedProjectId = await importProjectJSON(exported)
    const imported = await db.temporalFacts
      .where('projectId').equals(importedProjectId)
      .filter(row => row.value === '血脉觉醒')
      .first()
    expect(imported).toMatchObject({
      status: 'source-missing',
      sourcePowerSystemId: null,
      value: '血脉觉醒',
    })
  })
})
