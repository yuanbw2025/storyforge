import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  confirmFactCandidate,
  replaceConstitutionFactCandidate,
} from '../../src/lib/fact-ledger/fact-ledger'
import {
  checkSettingAssertionClashes,
  fingerprintSettingSource,
  normalizeConstitutionValue,
} from '../../src/lib/fact-ledger/setting-assertions'
import type { TemporalFact } from '../../src/lib/types'
import { seedCurrentProject } from '../helpers/current-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

const now = 1

function assertion(overrides: Partial<TemporalFact>): TemporalFact {
  return {
    projectId: 1,
    worldGroupId: 7,
    subjectWorldGroupId: 7,
    subjectName: '曜月界',
    predicate: 'magicSource',
    factKind: 'state',
    value: '月亮潮汐',
    sourceType: 'setting',
    sourceWorldviewId: 3,
    sourceField: 'worldOrigin',
    sourceFingerprint: 'fnv1a:test',
    sourceQuote: '魔法源于月亮潮汐',
    validFromChapterId: null,
    validToChapterId: null,
    status: 'confirmed',
    locked: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('CANON 覆盖基线 · 世界宪法设定互斥', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    db.close()
  })

  it('R-CANON-setting-clash-1 · 世界起源与力量来源断言冲突', async () => {
    await seedCurrentProject({
      name: 'Canon fixture', genres: ['fantasy'], status: 'drafting',
      description: '', targetWordCount: 0, createdAt: now, updatedAt: now,
    } as any)
    const worldviewId = await db.worldviews.add({
      projectId: 1,
      worldOrigin: '魔法源于月亮潮汐',
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const powerSystemId = await db.powerSystems.add({
      projectId: 1,
      rules: '力量只会从血脉中觉醒',
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const confirmedId = await db.temporalFacts.add(assertion({
      sourceWorldviewId: worldviewId,
      sourceRecordTable: 'worldviews',
      sourceRecordId: worldviewId,
      sourceFingerprint: fingerprintSettingSource('魔法源于月亮潮汐'),
    })) as number
    const candidateId = await db.temporalFacts.add(assertion({
      value: '血脉觉醒',
      sourceWorldviewId: null,
      sourcePowerSystemId: powerSystemId,
      sourceRecordTable: 'powerSystems',
      sourceRecordId: powerSystemId,
      sourceField: 'rules',
      sourceFingerprint: fingerprintSettingSource('力量只会从血脉中觉醒'),
      sourceQuote: '力量只会从血脉中觉醒',
      status: 'candidate',
    })) as number
    await finalizeCurrentFixtureV1(1)

    const result = await confirmFactCandidate(candidateId)
    const [confirmed, candidate] = await Promise.all([
      db.temporalFacts.get(confirmedId),
      db.temporalFacts.get(candidateId),
    ])

    expect(result.confirmed).toBe(false)
    expect(result.clashes).toHaveLength(1)
    expect(confirmed?.status).toBe('confirmed')
    expect(candidate?.status).toBe('candidate')
    expect(normalizeConstitutionValue('月亮 潮汐。')).toBe(normalizeConstitutionValue('月亮潮汐'))

    const replacement = await replaceConstitutionFactCandidate(candidateId)
    expect(replacement).toMatchObject({ confirmed: true, replaced: 1 })
    expect((await db.temporalFacts.get(confirmedId))?.status).toBe('superseded')
    expect((await db.temporalFacts.get(candidateId))?.status).toBe('confirmed')
  })

  it('R-CANON-setting-clash-2 · 故事核心与角色档案的亲属设定冲突', () => {
    const storyCore = assertion({
      id: 11,
      worldGroupId: null,
      subjectWorldGroupId: null,
      characterId: 9,
      subjectName: '林飞',
      predicate: 'parentStatus',
      value: '自幼父母双亡',
      sourceWorldviewId: null,
      sourceStoryCoreId: 5,
      sourceField: 'logline',
      sourceQuote: '孤儿林飞独自长大',
    })
    const character = assertion({
      id: 12,
      worldGroupId: null,
      subjectWorldGroupId: null,
      characterId: 9,
      subjectName: '林飞',
      predicate: 'parentStatus',
      value: '父母健在',
      sourceWorldviewId: null,
      sourceCharacterId: 9,
      sourceField: 'background',
      sourceQuote: '他的父母仍住在故乡',
      status: 'candidate',
    })

    const clashes = checkSettingAssertionClashes(character, [storyCore])
    expect(clashes).toHaveLength(1)
    expect(clashes[0].confirmed.sourceStoryCoreId).toBe(5)

    expect(checkSettingAssertionClashes(
      { ...character, value: ' 父母 健在。' },
      [{ ...storyCore, value: '父母健在' }],
    )).toEqual([])
  })
})
