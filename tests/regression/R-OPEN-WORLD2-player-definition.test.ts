import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { addNarrativeNode, createNarrativeModule } from '../../src/lib/narrative/blueprint'
import {
  compileTextOpenWorldPlayerDefinitionV1,
  compileTextOpenWorldPlayerFromWorldReleaseV1,
  installTextOpenWorldPlayerDefinitionV1,
} from '../../src/lib/open-world/player-definition'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createTextOpenWorldInstance } from '../../src/lib/product/runtime-instances'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import type { ProductRelease, TextOpenWorldPlayerCharacterDefinitionV1 } from '../../src/lib/types'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { openWorldSemanticResourceCatalogV1 } from '../../src/lib/context-gateway/world-release-client'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { createFixtureProductReleaseManifestV1 } from '../helpers/product-release-v1'
import { createTextOpenWorldProductRuntimePackageFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

const build: TextOpenWorldPlayerCharacterDefinitionV1['build'] = {
  progressionProfileKey: 'progression.default',
  initialLevel: 1,
  attributes: { power: 4, vitality: 3, agility: 2 },
  learnedSkillKeys: ['skill.basic-attack'],
  startingItemKeys: ['item.rust-sword'],
  startingCurrency: 12,
}

const identity = {
  name: '阮岚', pronouns: '她', appearance: '披着旧斗篷', background: '来自潮线之外', personality: '谨慎而坚定',
  publicKnowledge: '受盐港邀请而来', privateKnowledge: '害怕深水', shortGoal: '查清断流原因', longGoal: '找到新的归处',
  portrayal: '寡言，观察后再行动',
}

async function worldFixture() {
  const now = Date.now()
  const owned = await createWorkspace({
    name: '主角冻结验收', genres: ['fantasy'], status: 'drafting', description: '',
    targetWordCount: 10_000, enableMultiWorld: false,
  }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
  const projectId = owned.scope.projectId
  const characterId = await db.characters.add(stampNewRecord(owned.scope, 'characters', {
    projectId, name: '引潮人阿洛', role: 'protagonist', roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral',
    shortDescription: '知道旧盐路的引潮人。', appearance: '灰蓝短发，左手有盐蚀疤痕。', personality: '谨慎，重视承诺。',
    background: '在断脊盐渠旁长大。', motivation: '确认失踪兄长的去向。', goals: '让盐港和断脊都能活过旱季。',
    abilities: '辨认潮痕', relationships: '[]', arc: '', identity: '盐港引潮人', innerConflict: '害怕真相会摧毁家庭记忆。',
    fears: '再次失去亲人。', speechStyle: '短句，先问证据。', habits: '紧张时摩挲左手疤痕。', createdAt: now, updatedAt: now,
  } as any, { owner: 'world' })) as number
  await db.importantLocations.add(stampNewRecord(owned.scope, 'importantLocations', {
    projectId, name: '盐脊港', tags: '[]', description: '盐雾边港。', significance: '起点', parentId: null,
    sortOrder: 0, createdAt: now, updatedAt: now,
  } as any, { owner: 'world' }))
  const module = await createNarrativeModule({ scope: owned.scope, owner: 'world', kind: 'main', title: '潮线' })
  await addNarrativeNode({ scope: owned.scope, moduleId: module.id!, key: 'entry', kind: 'entry', title: '归港', summary: '阿洛归港。', successorKeys: ['ending'], order: 0 })
  await addNarrativeNode({ scope: owned.scope, moduleId: module.id!, key: 'ending', kind: 'ending', title: '潮线以外', summary: '阿洛作出选择。', order: 1 })
  const revision = await createWorldRevision({ scope: owned.scope, label: '主角来源', selectedNarrativeModuleIds: [module.id!] })
  const worldRelease = await publishWorldRevision(revision.id!)
  const catalog = await openWorldSemanticResourceCatalogV1({
    localReleaseRecordId: worldRelease.id!,
    expectedProjectId: owned.scope.projectId,
    expectedWorldId: owned.scope.worldId,
  })
  const character = catalog.resources.find(item => item.kind === 'character' && item.title === '引潮人阿洛')!
  const location = catalog.resources.find(item => item.kind === 'location' && item.title === '盐脊港')!
  const runtimePackage = createTextOpenWorldVNextFixture()
  runtimePackage.sourceManifest.contentHash = worldRelease.contentHash
  runtimePackage.sourceManifest.sourceVersion = worldRelease.version
  runtimePackage.sourceManifest.resourceHashes = [{ resourceId: character.resourceKey, contentHash: character.contentHash }]
  return { ...owned, characterId, worldRelease, character, location, runtimePackage }
}

describe('Text Open World vNext · protagonist definition and frozen initial build', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('把自建、已确认AI候选和预设统一编译为同一个产品定义', () => {
    const authored = compileTextOpenWorldPlayerDefinitionV1({ origin: { kind: 'creator-authored' }, identity, build })
    const candidate = compileTextOpenWorldPlayerDefinitionV1({
      origin: { kind: 'ai-candidate', candidateKey: 'candidate.player.1', authorConfirmed: true }, identity, build,
    })
    const preset = compileTextOpenWorldPlayerDefinitionV1({ origin: { kind: 'preset', presetKey: 'preset.wanderer' }, identity, build })
    expect(authored.identity.sourceRefs).toEqual(['text-open-world:creator-authored'])
    expect(candidate.identity.sourceRefs).toEqual(['text-open-world:ai-candidate:candidate.player.1'])
    expect(preset.identity.sourceRefs).toEqual(['text-open-world:preset:preset.wanderer'])
    expect({ ...candidate.identity, sourceRefs: [] }).toEqual({ ...authored.identity, sourceRefs: [] })
    expect(candidate.build).toEqual(authored.build)
    expect(() => compileTextOpenWorldPlayerDefinitionV1({
      origin: { kind: 'ai-candidate', candidateKey: 'candidate.player.2', authorConfirmed: false }, identity, build,
    })).toThrow('必须经作者确认')
  })

  it('只从冻结WorldRelease复制角色，活数据漂移不改变结果，并冻结进Release与Session', async () => {
    const created = await worldFixture()
    const player = await compileTextOpenWorldPlayerFromWorldReleaseV1({
      scope: created.scope, worldReleaseId: created.worldRelease.id!, resourceId: created.character.resourceKey,
      runtimePackage: created.runtimePackage, build, identityOverrides: { pronouns: '他' },
    })
    expect(player).toMatchObject({
      identity: {
        name: '引潮人阿洛', pronouns: '他', background: '在断脊盐渠旁长大。', shortGoal: '确认失踪兄长的去向。',
        longGoal: '让盐港和断脊都能活过旱季。', sourceRefs: [created.character.resourceKey],
      },
      build,
    })
    await db.characters.update(created.characterId, { name: '被活数据改名的角色', goals: '完全不同的目标', updatedAt: Date.now() })
    const sameFrozenPlayer = await compileTextOpenWorldPlayerFromWorldReleaseV1({
      scope: created.scope, worldReleaseId: created.worldRelease.id!, resourceId: created.character.resourceKey,
      runtimePackage: created.runtimePackage, build, identityOverrides: { pronouns: '他' },
    })
    expect(sameFrozenPlayer).toEqual(player)

    const textOpenWorldVNext = await installTextOpenWorldPlayerDefinitionV1({ runtimePackage: created.runtimePackage, player })
    const productRuntimePackage = createTextOpenWorldProductRuntimePackageFixtureV1(textOpenWorldVNext)
    const manifest = await createFixtureProductReleaseManifestV1({
      runtimePackage: productRuntimePackage,
      productionKey: 'fixture.text-open-world.player-freeze',
    })
    const release: ProductRelease = {
      projectId: created.scope.projectId,
      worldId: created.scope.worldId,
      workId: created.scope.workId,
      productionKey: manifest.productionProvenance.productionKey,
      productType: 'text-open-world',
      worldReleaseId: created.worldRelease.id!,
      version: 1,
      label: '阿洛的盐脊 v1',
      manifestJson: JSON.stringify(manifest),
      contentHash: await hashProductProductionValueV2(manifest),
      createdAt: Date.now(),
    }
    release.id = await db.productReleases.add(release) as number
    const session = await createTextOpenWorldInstance({
      scope: created.scope,
      productReleaseId: release.id,
      title: '阿洛的盐脊',
    })
    const state = await readProductRuntimeState(session.id!)
    expect(state.textOpenWorld?.runtimePackage.modules.actors.payload).toMatchObject({ player })
    expect(state.textOpenWorld?.state.player).toMatchObject({ level: 1, attributes: build.attributes })
    expect(state.textOpenWorld?.state.inventory).toMatchObject({ currency: 12, itemQuantities: { 'item.rust-sword': 1 } })
  })

  it('拒绝跨World、非角色资源、缺少Hash证据和非法初始构筑', async () => {
    const created = await worldFixture()
    await expect(compileTextOpenWorldPlayerFromWorldReleaseV1({
      scope: created.scope, worldReleaseId: created.worldRelease.id!, resourceId: created.location.resourceKey,
      runtimePackage: created.runtimePackage, build,
    })).rejects.toThrow('不是角色')

    const missingEvidence = structuredClone(created.runtimePackage)
    missingEvidence.sourceManifest.resourceHashes = []
    await expect(compileTextOpenWorldPlayerFromWorldReleaseV1({
      scope: created.scope, worldReleaseId: created.worldRelease.id!, resourceId: created.character.resourceKey,
      runtimePackage: missingEvidence, build,
    })).rejects.toThrow('资源Hash证据')

    const other = await createWorkspace({
      name: '另一个世界', genres: ['fantasy'], status: 'drafting', description: '',
      targetWordCount: 1, enableMultiWorld: false,
    }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
    await expect(compileTextOpenWorldPlayerFromWorldReleaseV1({
      scope: other.scope, worldReleaseId: created.worldRelease.id!, resourceId: created.character.resourceKey,
      runtimePackage: created.runtimePackage, build,
    })).rejects.toThrow('不属于请求的世界作用域')

    const invalidPlayer = compileTextOpenWorldPlayerDefinitionV1({
      origin: { kind: 'creator-authored' }, identity,
      build: { ...build, learnedSkillKeys: ['skill.not-in-package'], startingItemKeys: ['item.not-in-package'] },
    })
    await expect(installTextOpenWorldPlayerDefinitionV1({
      runtimePackage: created.runtimePackage, player: invalidPlayer,
    })).rejects.toThrow(/player skill|player starting item/)
    expect(() => compileTextOpenWorldPlayerDefinitionV1({
      origin: { kind: 'preset', presetKey: 'preset.invalid' }, identity,
      build: { ...build, progressionProfileKey: 'progression.unregistered' },
    })).toThrow('progression.default')
  })
})
