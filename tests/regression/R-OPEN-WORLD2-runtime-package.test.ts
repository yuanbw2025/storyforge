import { describe, expect, it } from 'vitest'
import { DEFAULT_TEXT_OPEN_WORLD_CALIBRATION_V1 } from '../../src/lib/open-world/product-config'
import { parseTextOpenWorldRuntimePackageV1 } from '../../src/lib/open-world/runtime-package'
import { TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1, type TextOpenWorldRuntimePackageV1 } from '../../src/lib/types'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

function fixture(): TextOpenWorldRuntimePackageV1 {
  const dependencies: Partial<Record<typeof TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1[number], typeof TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1[number][]>> = {
    world: ['narrative'], actors: ['world'], quests: ['narrative', 'world', 'actors'], actions: ['quests'],
    progression: ['actions'], combat: ['progression', 'actions'], items: ['progression'], crafting: ['items'],
    economy: ['items', 'relationships'], relationships: ['actors'], 'time-weather': ['world'], director: ['quests', 'time-weather'],
    knowledge: ['narrative', 'world', 'actors'], presentation: ['actions', 'knowledge'],
  }
  return {
    schema: 'storyforge.text-open-world.runtime-package', version: 1,
    metadata: {
      packageKey: 'salt-ridge.v1', title: '盐脊', description: '首个纵向验收世界。', contentLanguage: 'zh-CN',
      rulesetKey: 'storyforge.standard', rulesetVersion: 1,
    },
    sourceManifest: {
      kind: 'world-release', sourceKey: 'salt-ridge-world.v1', sourceVersion: 1,
      contentHash: HASH_A, selectionHash: HASH_B,
      resourceHashes: [{ resourceId: `world-release:v1:${HASH_A}:characters:1`, contentHash: HASH_B }],
    },
    experienceContract: {
      corePromise: '从陌生来客成长为能决定两地未来的行动者。', coreGoal: '保障两地居民的可持续供水。',
      freedomBoundary: '可自由探索和搁置主线，但不能破坏核心目标的可达性。', mainlinePolicy: 'strict-sequence', endingCount: 2,
      requiredPlayMinutes: { minimum: 90, maximum: 120 }, optionalInventoryMinutes: { minimum: 180, maximum: 300 },
    },
    calibration: structuredClone(DEFAULT_TEXT_OPEN_WORLD_CALIBRATION_V1),
    modules: Object.fromEntries(TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1.map(moduleKey => [moduleKey, {
      moduleKey, schemaVersion: 1, contentHash: HASH_A, dependencies: dependencies[moduleKey] ?? [], payload: { definitions: [] },
    }])) as TextOpenWorldRuntimePackageV1['modules'],
    mediaManifest: { version: 1, slotKeys: ['map.world'], requiredSlotKeys: ['map.world'] },
    qualityManifest: { version: 1, hardGateIds: ['package.references'], softMetricIds: ['narrative.variety'], waivedMetricIds: [] },
    compatibility: {
      minimumReaderVersion: 1, compatiblePreviousPackageHashes: [],
      legacyInputKinds: ['open-world-v1', 'adventure-v1', 'open-world-evolution-v1'], migrationPolicy: 'old-release-pinned',
    },
  }
}

describe('Text Open World vNext · product runtime package boundary', () => {
  it('严格解析来源、体验、校准、15个模块、媒资、质量和兼容策略', () => {
    const parsed = parseTextOpenWorldRuntimePackageV1(JSON.stringify(fixture()))
    expect(Object.keys(parsed.modules)).toEqual(TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1)
    expect(parsed.sourceManifest).toMatchObject({ kind: 'world-release', contentHash: HASH_A, selectionHash: HASH_B })
    expect(parsed.experienceContract).toMatchObject({ mainlinePolicy: 'strict-sequence', endingCount: 2 })
    expect(parsed.compatibility).toMatchObject({ minimumReaderVersion: 1, migrationPolicy: 'old-release-pinned' })
  })

  it('拒绝未知模块、模块key错配、无效hash和未知字段', () => {
    const unknownModule = fixture() as any
    unknownModule.modules.secret = { moduleKey: 'secret', schemaVersion: 1, contentHash: HASH_A, dependencies: [], payload: {} }
    expect(() => parseTextOpenWorldRuntimePackageV1(unknownModule)).toThrow('modules 字段不符合合同')

    const keyMismatch = fixture()
    keyMismatch.modules.world.moduleKey = 'actors'
    expect(() => parseTextOpenWorldRuntimePackageV1(keyMismatch)).toThrow('moduleKey 不一致')

    const invalidHash = fixture()
    invalidHash.sourceManifest.contentHash = 'not-a-hash'
    expect(() => parseTextOpenWorldRuntimePackageV1(invalidHash)).toThrow('不是SHA-256')

    expect(() => parseTextOpenWorldRuntimePackageV1({ ...fixture(), extra: true })).toThrow('package 字段不符合合同')
  })

  it('拒绝重复依赖、自依赖和跨模块依赖环', () => {
    const duplicate = fixture()
    duplicate.modules.quests.dependencies = ['world', 'world']
    expect(() => parseTextOpenWorldRuntimePackageV1(duplicate)).toThrow('不能重复')

    const self = fixture()
    self.modules.items.dependencies = ['items']
    expect(() => parseTextOpenWorldRuntimePackageV1(self)).toThrow('不能依赖自身')

    const cycle = fixture()
    cycle.modules.narrative.dependencies = ['presentation']
    expect(() => parseTextOpenWorldRuntimePackageV1(cycle)).toThrow('依赖存在环')
  })

  it('拒绝未声明的必需媒资、非法豁免和失效校准', () => {
    const media = fixture()
    media.mediaManifest.requiredSlotKeys = ['portrait.hero']
    expect(() => parseTextOpenWorldRuntimePackageV1(media)).toThrow('必须属于slotKeys')

    const quality = fixture()
    quality.qualityManifest.waivedMetricIds = ['unknown.metric']
    expect(() => parseTextOpenWorldRuntimePackageV1(quality)).toThrow('只能引用softMetricIds')

    const calibration = fixture()
    calibration.calibration.relationships.attitude.moralityWeight = 0.7
    expect(() => parseTextOpenWorldRuntimePackageV1(calibration)).toThrow('关系权重之和必须为1')
  })
})
