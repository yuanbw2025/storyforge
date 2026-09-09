import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  adventureEffectiveAbilityValue,
  adventureRequirementSatisfied,
  applyAdventureEffects,
  availableAdventureStorylets,
  availableAdventureActions,
  createInitialAdventureState,
  parseAdventureContent,
  qualifiedAdventureEndings,
  validateAdventureContent,
} from '../../src/lib/adventure/runtime'
import { analyzeTextAdventureRouteQualityV1 } from '../../src/lib/adventure/quality-analysis'
import {
  branchProductRuntimeSession,
  commitAdventureAction,
  commitAdventureNarrativeChoice,
  createProductRuntimeCheckpoint,
  readProductRuntimeState,
  readProductRuntimeStateVersion,
  verifyProductRuntimeCheckpoint,
} from '../../src/lib/adventure/runtime-api'
import { db } from '../../src/lib/db/schema'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import { evaluateProductRuntimeProductQualityV1 } from '../../src/lib/product-production/product-quality'
import { parseProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-api'
import { createProductRuntimeInstanceFromSource } from '../../src/lib/product/runtime-instances'
import { seedCurrentProductBuild } from '../helpers/current-product-build'
import { createCurrentProductBriefFixture, createCurrentRuntimePackageFixture } from '../helpers/current-runtime-package'
import {
  loadCurrentProductWorldSourceCatalogV1,
  seedCurrentProductWorld,
} from '../helpers/current-product-world'
import {
  createTextAdventureFoundationContentV2,
  createTextAdventureFoundationRuntimePackageV2,
} from '../helpers/text-adventure-v2-foundation'
import { createFixtureProductReleaseManifestV1 } from '../helpers/product-release-v1'

async function act(sessionId: number, actionKey: string, commandId = `textadv-v2:${sessionId}:${actionKey}`) {
  const base = await readProductRuntimeStateVersion(sessionId)
  return commitAdventureAction({
    sessionId,
    actionKey,
    commandId,
    baseSequence: base.sequence,
    baseStateHash: base.stateHash,
  })
}

async function fixture() {
  const owned = await seedCurrentProductWorld('TEXTADV-2 基座纵切面')
  const sourceCatalog = await loadCurrentProductWorldSourceCatalogV1({
    scope: owned.scope,
    worldReleaseId: owned.release.id!,
    productType: 'text-adventure',
  })
  const runtimePackage = createTextAdventureFoundationRuntimePackageV2({
    worldRelease: owned.release as typeof owned.release & { id: number },
    sourceCatalog,
  })
  const built = await seedCurrentProductBuild({
    scope: owned.scope,
    worldRelease: owned.release as typeof owned.release & { id: number },
    runtimePackage,
    title: '雾潮灯塔 V2',
    seed: 'text-adventure-v2-golden-seed',
  })
  return { ...owned, sourceCatalog, runtimePackage, ...built, sessionId: built.session.id! }
}

describe('TEXTADV-2 · 通用文字冒险基座纵切面', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('严格解析八项通用能力、四级空间、角色成长、装备、任务、时间、storylet 与结局', () => {
    const parsed = parseAdventureContent(createTextAdventureFoundationContentV2())
    expect(parsed.version).toBe(2)
    if (parsed.version !== 2) throw new Error('夹具没有进入 TEXTADV-2 解析器')
    expect(parsed.capabilities.filter(item => item.enabled).map(item => item.key)).toEqual([
      'space', 'character', 'inventory', 'equipment', 'quests', 'time', 'storylets', 'endings',
    ])
    expect(parsed.regions).toHaveLength(2)
    expect(parsed.areas).toHaveLength(3)
    expect(parsed.locations).toHaveLength(4)
    expect(parsed.scenes).toHaveLength(4)
    expect(parsed.abilities.some(item => item.role === 'stat')).toBe(true)
    expect(parsed.abilities.some(item => item.role === 'skill')).toBe(true)
    expect(parsed.resources.map(item => item.role)).toEqual(expect.arrayContaining([
      'health', 'mana', 'stamina', 'experience', 'skill-points', 'currency', 'clock',
    ]))
    expect(parsed.quests[0].stages).toHaveLength(2)
    expect(parsed.storylets).toHaveLength(2)
    expect(parsed.endings.map(item => item.key)).toEqual(['ending.rescue', 'ending.seal'])
    expect(validateAdventureContent(parsed)).toMatchObject({ valid: true, errors: [] })
  })

  it('拒绝跨层引用和缺失的通用 capability', () => {
    const content = createTextAdventureFoundationContentV2()
    expect(() => parseAdventureContent({
      ...content,
      capabilities: content.capabilities.filter(item => item.key !== 'equipment'),
    })).toThrow('缺少必需 V2 capability:equipment')
    expect(() => parseAdventureContent({
      ...content,
      locations: content.locations.map((item, index) => index === 0 ? { ...item, areaKey: 'area.missing' } : item),
    })).toThrow('地点引用不存在区域')
    expect(() => parseAdventureContent({
      ...content,
      items: content.items.map((item, index) => index === 0 ? { ...item, equipmentSlotKey: 'slot.missing' } : item),
    })).toThrow('物品引用不存在装备槽')
    expect(() => parseAdventureContent({
      ...content,
      actions: content.actions.map((item, index) => index === 0 ? { ...item, suspectId: 'suspect.1' } : item),
    } as never)).toThrow('V2 行动字段不符合合同')
    expect(() => parseAdventureContent({
      ...content,
      actions: content.actions.map((item, index) => index === 0 ? {
        ...item, requirements: [{ itemKey: 'item.storm-cloak', itemState: 'stored' }],
      } : item),
    } as never)).toThrow('物品条件状态无效')
    expect(() => parseAdventureContent({
      ...content,
      actions: content.actions.map((item, index) => index === 0 ? {
        ...item, requirements: [{ itemState: 'carried' }],
      } : item),
    } as never)).toThrow('必须同时声明 itemKey')
    expect(() => parseAdventureContent({ ...content, suspectEvidenceBoard: [] } as never)).toThrow('字段不符合合同')
  })

  it('发布质量门拒绝把内部占位角色暴露为可交谈人物', async () => {
    const seeded = await fixture()
    const broken = structuredClone(seeded.runtimePackage)
    const talk = broken.adventure!.actions.find(action => action.kind === 'talk')!
    const profile = broken.interaction.profiles.find(item => (
      item.participantKey === talk.interaction?.participantKey
    ))!
    profile.characterKey = `generated:${profile.participantKey}`
    profile.name = '产品角色 1'
    const report = evaluateProductRuntimeProductQualityV1({
      runtimePackage: broken,
      brief: createCurrentProductBriefFixture({
        productType: 'text-adventure',
        worldRelease: seeded.release as typeof seeded.release & { id: number },
        sourceCatalog: seeded.sourceCatalog,
      }),
    })
    expect(report.gates).toContainEqual(expect.objectContaining({
      gateId: 'product.adventure.v2-character-presence', passed: false,
    }))
  })

  it('按可达路线计算玩家真实可见内容，不再用 Brief 目标分钟或系统描述冒充剧情量', async () => {
    const seeded = await fixture()
    const analysis = analyzeTextAdventureRouteQualityV1(seeded.runtimePackage)
    expect(analysis).toMatchObject({
      truncated: false,
      reachableEndingKeys: ['ending.rescue', 'ending.seal'],
      mainQuestStageCount: 2,
      mainQuestObjectiveCount: 2,
    })
    expect(analysis.routes).toHaveLength(2)
    expect(analysis.minimumRouteTextUnits).toBeLessThan(500)
    expect(analysis.minimumRouteDialogueTurns).toBe(0)
    expect(analysis.minimumRouteStatefulDecisions).toBe(0)
    expect(analysis.endingTextUnits.every(item => item.textUnits < 80)).toBe(true)
  })

  it('商业推荐质量门拒绝短主线、浅任务、无对白和无持续状态决定的工程夹具', async () => {
    const seeded = await fixture()
    const commercialBrief = createCurrentProductBriefFixture({
      productType: 'text-adventure',
      worldRelease: seeded.release as typeof seeded.release & { id: number },
      sourceCatalog: seeded.sourceCatalog,
    })
    commercialBrief.qualityProfile = 'commercial-candidate'
    const report = evaluateProductRuntimeProductQualityV1({
      runtimePackage: seeded.runtimePackage,
      brief: commercialBrief,
    })
    expect(report.passed).toBe(false)
    expect(report.gates.filter(gate => gate.gateId.startsWith('product.adventure.recommendation-')))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ gateId: 'product.adventure.recommendation-route-volume', passed: false }),
        expect.objectContaining({ gateId: 'product.adventure.recommendation-dialogue-and-cast', passed: false }),
        expect.objectContaining({ gateId: 'product.adventure.recommendation-decisions', passed: false }),
        expect.objectContaining({ gateId: 'product.adventure.recommendation-main-quest', passed: false }),
        expect.objectContaining({ gateId: 'product.adventure.recommendation-endings', passed: false }),
      ]))
  })

  it('文字开放世界不能误用文字冒险 V2 私域契约', async () => {
    const owned = await seedCurrentProductWorld('TEXTADV-2 产品隔离反例')
    const sourceCatalog = await loadCurrentProductWorldSourceCatalogV1({
      scope: owned.scope,
      worldReleaseId: owned.release.id!,
      productType: 'text-open-world',
    })
    const openWorld = createCurrentRuntimePackageFixture({
      productType: 'text-open-world',
      worldRelease: owned.release as typeof owned.release & { id: number },
      sourceCatalog,
    })
    expect(() => parseProductRuntimePackageV1({
      ...openWorld,
      adventure: createTextAdventureFoundationContentV2(),
    })).toThrow('text-open-world 仍只接受隔离的 Adventure V1')
  })

  it('装备修正只影响有效能力，不篡改基础属性，且同槽位冲突会在纯预演阶段失败', () => {
    const base = createTextAdventureFoundationContentV2()
    const content = parseAdventureContent({
      ...base,
      items: [...base.items, {
        key: 'item.second-cloak', title: '备用披风', description: '用于验证同槽位不变量。',
        tags: ['armor'], stackable: false, consumable: false, category: 'equipment' as const,
        equipmentSlotKey: 'slot.body', modifiers: [], usableActionKey: null,
      }],
      initialInventory: [...base.initialInventory, { itemKey: 'item.second-cloak', quantity: 1 }],
    })
    if (content.version !== 2) throw new Error('装备测试没有进入 V2')
    const initial = createInitialAdventureState(content, 'a'.repeat(64))
    expect(adventureRequirementSatisfied({ itemKey: 'item.storm-cloak', itemState: 'carried' }, initial)).toBe(true)
    expect(adventureRequirementSatisfied({ itemKey: 'item.storm-cloak', itemState: 'equipped' }, initial)).toBe(false)
    expect(adventureEffectiveAbilityValue(content, initial, 'ability.perception')).toBe(2)
    const equipped = applyAdventureEffects(content, initial, [{
      op: 'change-item-state', itemKey: 'item.storm-cloak', state: 'equipped',
    }], 1)
    expect(equipped.abilities['ability.perception']).toBe(2)
    expect(adventureEffectiveAbilityValue(content, equipped, 'ability.perception')).toBe(3)
    expect(adventureRequirementSatisfied({ itemKey: 'item.storm-cloak', itemState: 'carried' }, equipped)).toBe(false)
    expect(adventureRequirementSatisfied({ itemKey: 'item.storm-cloak', itemState: 'equipped' }, equipped)).toBe(true)
    expect(() => applyAdventureEffects(content, equipped, [{
      op: 'change-item-state', itemKey: 'item.second-cloak', state: 'equipped',
    }], 2)).toThrow('装备槽已占用:slot.body')
  })

  it('相同发布包、种子、状态序号与命令会产生相同随机判定证据', async () => {
    const seeded = await fixture()
    const second = await createProductRuntimeInstanceFromSource({
      scope: seeded.scope,
      source: {
        kind: 'build',
        productBuildId: seeded.buildId,
        expectedPreviewHash: seeded.preview.previewHash,
      },
      title: '雾潮灯塔 V2 · 确定性对照',
      seed: 'text-adventure-v2-golden-seed',
    })
    await act(seeded.sessionId, 'action.search.cache', 'golden:deterministic-search')
    await act(second.id!, 'action.search.cache', 'golden:deterministic-search')
    const firstState = await readProductRuntimeState(seeded.sessionId)
    const secondState = await readProductRuntimeState(second.id!)
    expect(firstState.adventure?.checks.at(-1)).toEqual(secondState.adventure?.checks.at(-1))
    expect(firstState.adventure?.actionHistory.at(-1)?.outcome).toBe(secondState.adventure?.actionHistory.at(-1)?.outcome)
  })

  it('V2 内容可冻结进不可变 ProductRelease，并从正式发布版本创建独立会话', async () => {
    const seeded = await fixture()
    const manifest = await createFixtureProductReleaseManifestV1({
      runtimePackage: seeded.runtimePackage,
      productionKey: 'text-adventure-v2-release-fixture',
    })
    const releaseId = await db.productReleases.add({
      ...seeded.scope,
      productionKey: manifest.productionProvenance.productionKey,
      productType: 'text-adventure',
      worldReleaseId: seeded.release.id!,
      version: 1,
      label: '雾潮灯塔 V2 v1',
      manifestJson: JSON.stringify(manifest),
      contentHash: await hashProductProductionValueV2(manifest),
      createdAt: Date.now(),
    }) as number
    const session = await createProductRuntimeInstanceFromSource({
      scope: seeded.scope,
      source: { kind: 'release', productReleaseId: releaseId },
      title: '雾潮灯塔 V2 · 正式版本',
      seed: 'text-adventure-v2-release-seed',
    })
    expect(session).toMatchObject({ productReleaseId: releaseId, productBuildId: null })
    expect((await readProductRuntimeState(session.id!)).adventure).toMatchObject({
      version: 2,
      currentLocationKey: 'location.harbor',
    })
  })

  it('从正式 Build 离线走通失败推进、任务、装备、时间、存档、分支、重放和两个因果结局', async () => {
    const seeded = await fixture()
    const quality = evaluateProductRuntimeProductQualityV1({
      runtimePackage: seeded.runtimePackage,
      brief: createCurrentProductBriefFixture({
        productType: 'text-adventure',
        worldRelease: seeded.release as typeof seeded.release & { id: number },
        sourceCatalog: seeded.sourceCatalog,
      }),
    })
    expect(quality.gates.filter(gate => gate.gateId.startsWith('product.adventure.v2-') && !gate.passed)).toEqual([])
    let state = await readProductRuntimeState(seeded.sessionId)
    expect(state.adventure).toMatchObject({ version: 2, currentLocationKey: 'location.harbor' })
    expect(state.narrative).toMatchObject({ currentNodeKey: 'opening', completed: false })

    const equipBase = await readProductRuntimeStateVersion(seeded.sessionId)
    const equipInput = {
      sessionId: seeded.sessionId,
      actionKey: 'action.equip.cloak',
      commandId: 'golden:equip-cloak',
      baseSequence: equipBase.sequence,
      baseStateHash: equipBase.stateHash,
    }
    const firstEquip = await commitAdventureAction(equipInput)
    const eventCountAfterEquip = await db.productRuntimeEvents.where('sessionId').equals(seeded.sessionId).count()
    const replayedEquip = await commitAdventureAction(equipInput)
    expect(replayedEquip.id).toBe(firstEquip.id)
    expect(await db.productRuntimeEvents.where('sessionId').equals(seeded.sessionId).count()).toBe(eventCountAfterEquip)
    state = await readProductRuntimeState(seeded.sessionId)
    expect(adventureEffectiveAbilityValue(seeded.runtimePackage.adventure!, state.adventure!, 'ability.perception')).toBe(3)

    await act(seeded.sessionId, 'action.talk.keeper')
    expect((await db.productRuntimeEvents.where('sessionId').equals(seeded.sessionId).toArray())
      .some(event => event.type === 'interaction.relationship.changed')).toBe(true)
    await act(seeded.sessionId, 'action.search.cache')
    await act(seeded.sessionId, 'action.move.marsh')
    await act(seeded.sessionId, 'action.find.route')
    state = await readProductRuntimeState(seeded.sessionId)
    expect(state.adventure?.actionHistory.at(-1)?.outcome).toBe('failure')
    expect(state.adventure?.conditions.map(item => item.conditionKey)).toEqual(expect.arrayContaining([
      'condition.wounded', 'condition.route-known',
    ]))
    expect(state.adventure?.resources['resource.health']).toBe(8)
    expect(state.adventure?.quests[0].objectives.find(item => item.objectiveKey === 'objective.route')?.completed).toBe(true)

    await act(seeded.sessionId, 'action.move.tower')
    await act(seeded.sessionId, 'action.take.lens')
    state = await readProductRuntimeState(seeded.sessionId)
    expect(state.adventure?.quests[0].status).toBe('completed')
    expect(state.adventure?.resources['resource.experience']).toBe(20)
    expect(state.adventure?.resources['resource.skill-points']).toBe(1)
    expect(state.adventure?.abilities['ability.level']).toBe(2)
    expect((await db.productRuntimeEvents.where('sessionId').equals(seeded.sessionId).toArray())
      .some(event => event.type === 'adventure.ability.changed')).toBe(true)
    expect(state.narrative?.availableChoiceKeys).toContain('choice.enter-core')

    await commitAdventureNarrativeChoice({ sessionId: seeded.sessionId, choiceKey: 'choice.enter-core' })
    state = await readProductRuntimeState(seeded.sessionId)
    expect(state.adventure?.currentLocationKey).toBe('location.core')
    expect(state.narrative?.currentNodeKey).toBe('crossroads')
    const checkpoint = await createProductRuntimeCheckpoint({ sessionId: seeded.sessionId, name: '灯塔核心抉择前' })
    expect(await verifyProductRuntimeCheckpoint(checkpoint.id!)).toBe(true)

    await act(seeded.sessionId, 'action.prepare.rescue')
    const rescueReady = await readProductRuntimeState(seeded.sessionId)
    expect(rescueReady.adventure?.conditions.map(item => item.conditionKey)).toContain('condition.route-rescue')
    expect(rescueReady.narrative?.availableChoiceKeys).toContain('choice.rescue')
    await commitAdventureNarrativeChoice({
      sessionId: seeded.sessionId,
      choiceKey: 'choice.rescue',
      commandId: 'golden:ending-rescue',
    })
    const rescue = await readProductRuntimeState(seeded.sessionId)
    expect(rescue.narrative).toMatchObject({ completed: true, endingKey: 'ending.rescue' })

    const branch = await branchProductRuntimeSession({
      parentSessionId: seeded.sessionId,
      throughSequence: checkpoint.throughSequence,
      title: '灯塔核心 · 封闭光路时间线',
    })
    await act(branch.id!, 'action.prepare.seal', 'golden:branch:prepare-seal')
    await commitAdventureNarrativeChoice({
      sessionId: branch.id!,
      choiceKey: 'choice.seal',
      commandId: 'golden:ending-seal',
    })
    const sealed = await readProductRuntimeState(branch.id!)
    expect(sealed.narrative).toMatchObject({ completed: true, endingKey: 'ending.seal' })
    expect(sealed.adventure?.conditions.some(item => item.conditionKey === 'condition.route-rescue')).toBe(false)

    const parent = await db.productRuntimeSessions.get(seeded.sessionId)
    const events = await db.productRuntimeEvents.where('sessionId').equals(seeded.sessionId).sortBy('sequence')
    const replayed = replayProductRuntimeEvents(parseProductRuntimeState(parent!.initialStateJson), events)
    expect(replayed).toEqual(rescue)
    expect(branch).toMatchObject({ parentSessionId: seeded.sessionId, parentThroughSequence: checkpoint.throughSequence })
    expect(sealed.adventure?.resources['resource.time']).toBeGreaterThan(0)
  })

  it('可用行动闭集会隐藏未满足条件的移动，并为失败推进保留合法后续', () => {
    const content = createTextAdventureFoundationContentV2()
    let state = createInitialAdventureState(content, 'b'.repeat(64))
    expect(availableAdventureActions(content, state).find(item => item.action.key === 'action.move.marsh')?.available).toBe(true)
    expect(availableAdventureStorylets(content, state).map(item => item.key)).toContain('storylet.hidden-cache')
    expect(qualifiedAdventureEndings(content, state)).toEqual([])
    state = { ...state, currentLocationKey: 'location.marsh', visitedLocationKeys: [...state.visitedLocationKeys, 'location.marsh'] }
    expect(availableAdventureActions(content, state).find(item => item.action.key === 'action.move.tower')?.available).toBe(false)
  })
})
