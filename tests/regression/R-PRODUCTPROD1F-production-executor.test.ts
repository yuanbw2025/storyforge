import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { prepareProductProductionAdoption } from '../../src/lib/product-production/adoption'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { PRODUCT_BROWSER_PERFORMANCE_POLICY_V1 } from '../../src/lib/product-production/browser-performance'
import {
  resolveProductMediaProviderAdapterV1,
  type MediaProviderTransportV1,
  type RedactedMediaTransportRequestV1,
} from '../../src/lib/product-production/media-adapters'
import type { ResolvedProductMediaCapabilityV1 } from '../../src/lib/product-production/media-transport'
import {
  createBuiltInProductionCapabilityBindingV1,
  createConfiguredProductProductionExecutorV1,
  isolateCharacterProviderPromptV1,
  legalizeProductionModelProtocolDefaultsV1,
  parseProductMediaRequirementsArtifactV2,
  parseProductionModelJsonObjectV1,
  type ProductionTextRunnerV1,
} from '../../src/lib/product-production/production-executor'
import { runProductProductionUntilBlockedV1 } from '../../src/lib/product-production/scheduler'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import { adventureNarrativeActionContext, availableAdventureActions } from '../../src/lib/adventure/runtime'
import { commitAdventureAction, commitAdventureNarrativeChoice } from '../../src/lib/adventure/runtime-api'
import { planTextAdventureNarrativeLocationsV1 } from '../../src/lib/adventure/narrative-location-plan'
import {
  textAdventureActSceneKeysV1,
  textAdventureNarrativeSkeletonV1,
} from '../../src/lib/adventure/scene-script'
import { resolveProductRuntimeSource } from '../../src/lib/product-production/preview-source'
import {
  recordProductBrowserPerformanceMeasurementV1,
  recordProductBuildMainRoutePlaythroughV1,
  recordProductMediaRuntimeMeasurementV1,
} from '../../src/lib/product-production/quality-receipts'
import {
  beginProductProductionEvolutionV1,
  listProductProductionReviewArtifactsV1,
  publishProductProductionV1,
  startProductProductionPreviewV1,
} from '../../src/lib/product-production/service'
import {
  commitNarrativeChoice,
  readProductRuntimeState,
  readProductRuntimeStateVersion,
} from '../../src/lib/product/runtime-api'
import {
  completeTtrpgSessionZero,
  openTtrpgCampaignScene,
  submitTtrpgActionIntentV2,
} from '../../src/lib/ttrpg/runtime-api'
import { reachAvgPresentationBeat } from '../../src/lib/avg/runtime-api'
import {
  configureTtrpgSessionParticipantV2,
  readTtrpgSessionParticipantsV2,
} from '../../src/lib/ttrpg/participants'
import type { ProductionProductKindV1 } from '../../src/lib/types'
import { seedCurrentProductWorld } from '../helpers/current-product-world'

async function fixture(qualityProfile: 'prototype' | 'commercial-candidate' = 'prototype') {
  const owned = await seedCurrentProductWorld('formal-executor')
  const release = owned.release
  const suggestions = await suggestProductStartingPoints({ scope: owned.scope, worldReleaseId: release.id! })
  const brief = await draftProductProductionBriefV3({
    scope: owned.scope, worldReleaseId: release.id!, suggestionKey: suggestions.suggestions[0].suggestionKey,
    productType: 'avg', qualityProfile, scale: 'scene', visualLevel: 'key-scenes', audioLevel: 'music-sfx',
    requiredFacts: ['冻结世界事实保持一致'], forbiddenChanges: ['不得写回世界正式表'],
  })
  const created = await executeProductProductionCommand({
    scope: owned.scope,
    command: {
      type: 'create-intent', commandId: 'formal.intent', productionKey: 'formal.production',
      productType: 'avg', worldReleaseId: release.id!, userText: '正式自动制作 AVG',
    },
  })
  const saved = await executeProductProductionCommand({
    scope: owned.scope, productionId: created.productionId,
    command: {
      type: 'save-brief-revision', commandId: 'formal.brief', expectedStateRevision: 0,
      parentRevision: null, brief,
    },
  })
  await executeProductProductionCommand({
    scope: owned.scope, productionId: created.productionId,
    command: {
      type: 'authorize-start', commandId: 'formal.authorize', expectedStateRevision: 1,
      briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: 'formal.click',
    },
  })
  return { ...owned, release, brief, productionId: created.productionId }
}

async function fixtureForProduct(productType: ProductionProductKindV1, options?: {
  scale?: 'scene' | 'short-arc' | 'chapter'
  visualLevel?: 'none' | 'key-scenes'
  omitWorldArtifacts?: boolean
}) {
  const owned = await seedCurrentProductWorld(`formal-${productType}`)
  const release = owned.release
  const suggestions = await suggestProductStartingPoints({ scope: owned.scope, worldReleaseId: release.id! })
  const brief = await draftProductProductionBriefV3({
    scope: owned.scope, worldReleaseId: release.id!, suggestionKey: suggestions.suggestions[0].suggestionKey,
    productType, qualityProfile: 'prototype', scale: options?.scale ?? 'scene',
    visualLevel: options?.visualLevel ?? (productType === 'text-adventure' ? 'key-scenes' : 'none'), audioLevel: 'none',
    playerRole: `扮演 ${productType} 的冻结世界行动者`,
    openingSituation: `从用户确认的雾港潮门入口开始 ${productType} 体验。`,
    requiredFacts: ['冻结世界事实保持一致'], forbiddenChanges: ['不得写回世界正式表'],
    confirmTtrpgDefaultMappings: productType === 'ttrpg',
    textAdventure: productType === 'text-adventure' ? { confirmAll: true } : undefined,
  })
  if (options?.omitWorldArtifacts) {
    const artifactKeys = new Set(brief.source.selection.roleBindings.items ?? [])
    brief.source.selection.resourceKeys = brief.source.selection.resourceKeys
      .filter(resourceKey => !artifactKeys.has(resourceKey))
    brief.source.selection.roleBindings.items = []
  }
  const created = await executeProductProductionCommand({
    scope: owned.scope,
    command: {
      type: 'create-intent', commandId: `current.${productType}.intent`, productionKey: `current.${productType}`,
      productType, worldReleaseId: release.id!, userText: `正式自动制作 ${productType}`,
    },
  })
  const saved = await executeProductProductionCommand({
    scope: owned.scope, productionId: created.productionId,
    command: {
      type: 'save-brief-revision', commandId: `six.${productType}.brief`, expectedStateRevision: 0,
      parentRevision: null, brief,
    },
  })
  if (!saved.ok) {
    throw new Error(`save ${productType} failed: ${saved.errorCode ?? 'unknown'} ${String(saved.result.message ?? '')}`)
  }
  const authorized = await executeProductProductionCommand({
    scope: owned.scope, productionId: created.productionId,
    command: {
      type: 'authorize-start', commandId: `six.${productType}.authorize`, expectedStateRevision: 1,
      briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: `six.${productType}.click`,
    },
  })
  if (!authorized.ok) {
    throw new Error(`authorize ${productType} failed: ${authorized.errorCode ?? 'unknown'} ${String(authorized.result.message ?? '')}`)
  }
  return { ...owned, release, brief, productionId: created.productionId }
}

function firstCharacterAnchor(brief: Awaited<ReturnType<typeof fixture>>['brief']): string {
  const selected = brief.source.selection.roleBindings.characters
    ?? brief.source.selection.roleBindings.participants ?? []
  return selected.length ? 'character:1' : 'intent:protagonist'
}

async function completeAvgBuildPreviewMainRoute(input: {
  scope: Awaited<ReturnType<typeof fixture>>['scope']
  productionId: number
}): Promise<number> {
  const opened = await startProductProductionPreviewV1({
    scope: input.scope, productionId: input.productionId, worldGroupId: null,
  })
  expect(opened.productType).toBe('avg')
  for (let turn = 0; turn < 30; turn += 1) {
    let state = await readProductRuntimeState(opened.sessionId)
    if (state.narrative?.completed) return opened.sessionId
    const nodeKey = state.narrative?.currentNodeKey
    if (!nodeKey) throw new Error('商业 AVG 主路线缺少当前节点')
    const beats = (state.narrative?.beats ?? [])
      .filter(beat => beat.nodeKey === nodeKey)
      .sort((left, right) => left.order - right.order || left.beatKey.localeCompare(right.beatKey))
    const reachedIndex = state.presentation?.currentNodeKey === nodeKey && state.presentation.currentBeatKey
      ? beats.findIndex(beat => beat.beatKey === state.presentation!.currentBeatKey) : -1
    for (const beat of beats.slice(reachedIndex + 1)) {
      const base = await readProductRuntimeStateVersion(opened.sessionId)
      await reachAvgPresentationBeat({
        sessionId: opened.sessionId, beatKey: beat.beatKey,
        commandId: `commercial-preview:beat:${opened.sessionId}:${beat.beatKey}`,
        baseSequence: base.sequence, baseStateHash: base.stateHash,
        snapshotKey: `commercial-preview:${nodeKey}`,
      })
    }
    state = await readProductRuntimeState(opened.sessionId)
    const choiceKey = state.narrative?.availableChoiceKeys?.[0]
    if (!choiceKey) throw new Error('商业 AVG 主路线没有可提交选择')
    const base = await readProductRuntimeStateVersion(opened.sessionId)
    await commitNarrativeChoice({
      sessionId: opened.sessionId, choiceKey,
      commandId: `commercial-preview:choice:${opened.sessionId}:${turn}`,
      baseSequence: base.sequence, baseStateHash: base.stateHash,
    })
  }
  throw new Error('商业 AVG 主路线在 30 次选择内未到达结局')
}

function playtestStrategyOutput() {
  const kinds = [
    'golden-route', 'alternate-route', 'failure-forward', 'each-ending', 'random-long-run',
    'resource-edge', 'side-quest-skip', 'side-quest-complete', 'refresh-resume',
    'save-load-branch', 'ai-offline', 'media-offline', 'corruption-recovery',
    'export-import', 'delete-lifecycle',
  ] as const
  const browserKinds = new Set([
    'random-long-run', 'resource-edge', 'side-quest-skip', 'side-quest-complete',
    'refresh-resume', 'save-load-branch', 'corruption-recovery', 'export-import', 'delete-lifecycle',
  ])
  return {
    schema: 'storyforge.text-adventure-playtest-strategy-artifact' as const, version: 1 as const,
    routeCases: kinds.map(kind => ({
      caseKey: `playtest.${kind}`, kind,
      executionMode: browserKinds.has(kind) ? 'real-browser' as const : 'deterministic-autoplay' as const,
      objective: `验证 ${kind} 的可执行结果与状态证据。`,
      steps: ['从当前 Build 的固定入口开始', '按登记路线执行并保留状态与界面证据'],
      expectedAssertions: ['没有软锁或越权写入', '结果绑定当前 Build 与 package hash'],
      evidenceRefs: [`quality.autoplay#autoplay.${kind}`], required: true,
    })),
    humanSessions: [{
      sessionKey: 'human.independent-golden', participantRole: 'independent-player' as const,
      routeKind: 'golden-route' as const, timingRequired: true,
      prompts: ['记录理解障碍、无聊点、选择感与情绪变化'],
      passCriteria: ['完整抵达结局', '实际时长达到 Brief 验收区间'],
    }, {
      sessionKey: 'human.author-alternate', participantRole: 'author' as const,
      routeKind: 'alternate-route' as const, timingRequired: false,
      prompts: ['核对替代路线与主线因果差异'],
      passCriteria: ['替代路线可完成且具有持续回响'],
    }],
    blockingRisks: [], recommendation: 'eligible-for-human-validation' as const,
  }
}

function modelOutputs(
  worldHash: string,
  productType: ProductionProductKindV1 = 'avg',
  characterAnchorRef = 'character:0',
  playerRole = '扮演冻结 Brief 主角',
) {
  return {
    'content.design': {
      schema: 'storyforge.product-design-artifact', version: 1, title: '雾港抉择',
      logline: '玩家必须在潮汐封锁前选择真相或庇护。', playerGoal: '调查港口信号并决定公开何种事实。',
      coreLoop: ['阅读现场', '作出选择', '承受后果'], sourceAnchors: [`world:${worldHash}`],
      invariants: ['冻结世界事实保持一致', '不得写回世界正式表'], tone: ['沉浸', '克制'],
      targetPlayMinutes: 20, targetEndingCount: 2,
    },
    'content.narrative': productType === 'text-adventure' ? {
      schema: 'storyforge.product-narrative-artifact', version: 1, moduleKind: 'main', moduleTitle: '雾港抉择',
      entryNodeKey: 'opening',
      nodes: [
        { key: 'opening', kind: 'entry', title: '潮门之前', summary: '玩家抵达潮门广场。', condition: {}, effects: [] },
        { key: 'square', kind: 'scene', title: '广场回声', summary: '玩家在潮门广场先理解封港局势。', condition: {}, effects: [] },
        { key: 'warehouse', kind: 'scene', title: '旧仓支路', summary: '旧仓街是一条承担额外风险的支路。', condition: {}, effects: [] },
        { key: 'tower', kind: 'choice', title: '信号塔抉择', summary: '决定公开或封存记录。', condition: {}, effects: [] },
        { key: 'truth-ending', kind: 'ending', title: '公开真相', summary: '真相改变了港口。', condition: {}, effects: [] },
        { key: 'shelter-ending', kind: 'ending', title: '守住庇护', summary: '秘密换来短暂安稳。', condition: {}, effects: [] },
      ],
      beats: [
        { beatKey: 'beat.opening', nodeKey: 'opening', kind: 'narration', speakerKey: null, text: '潮声压过了塔顶的警铃。', order: 0 },
        { beatKey: 'beat.square', nodeKey: 'square', kind: 'narration', speakerKey: null, text: '雾中的人群把恐惧、责任与彼此矛盾的希望交给你。'.repeat(100), order: 0 },
        { beatKey: 'beat.warehouse', nodeKey: 'warehouse', kind: 'narration', speakerKey: null, text: '旧仓支路让你看见选择之外仍有人在承受代价。'.repeat(30), order: 0 },
        { beatKey: 'beat.tower', nodeKey: 'tower', kind: 'narration', speakerKey: null, text: '守灯人摊开最后一份信号记录。', order: 0 },
        { beatKey: 'beat.truth', nodeKey: 'truth-ending', kind: 'narration', speakerKey: null, text: '灯光把所有证词投向海面。', order: 0 },
        { beatKey: 'beat.shelter', nodeKey: 'shelter-ending', kind: 'narration', speakerKey: null, text: '门重新合拢，秘密仍在呼吸。', order: 0 },
      ],
      choices: [
        { choiceKey: 'choice.enter-square', sourceNodeKey: 'opening', text: '进入广场', description: '先理解局势', unavailableReason: '', targetNodeKey: 'square', displayCondition: {}, availableCondition: {}, effects: [], tags: [], order: 0 },
        { choiceKey: 'choice.direct-tower', sourceNodeKey: 'square', text: '直接前往信号塔', description: '聚焦主线', unavailableReason: '', targetNodeKey: 'tower', displayCondition: {}, availableCondition: {}, effects: [], tags: [], order: 0 },
        { choiceKey: 'choice.warehouse', sourceNodeKey: 'square', text: '绕行旧仓街', description: '承担额外风险', unavailableReason: '', targetNodeKey: 'warehouse', displayCondition: {}, availableCondition: {}, effects: [], tags: [], order: 1 },
        { choiceKey: 'choice.warehouse-tower', sourceNodeKey: 'warehouse', text: '带着新发现前往信号塔', description: '支路汇流', unavailableReason: '', targetNodeKey: 'tower', displayCondition: {}, availableCondition: {}, effects: [], tags: [], order: 0 },
        { choiceKey: 'choice.truth', sourceNodeKey: 'tower', text: '公开信号记录', description: '承担真相的后果', unavailableReason: '', targetNodeKey: 'truth-ending', displayCondition: {}, availableCondition: {}, effects: [], tags: ['truth'], order: 0 },
        { choiceKey: 'choice.shelter', sourceNodeKey: 'tower', text: '封存信号记录', description: '保护眼前的人', unavailableReason: '', targetNodeKey: 'shelter-ending', displayCondition: {}, availableCondition: {}, effects: [], tags: ['shelter'], order: 1 },
      ],
    } : {
      schema: 'storyforge.product-narrative-artifact', version: 1, moduleKind: 'main', moduleTitle: '雾港抉择',
      entryNodeKey: 'opening',
      nodes: [
        { key: 'opening', kind: 'entry', title: '潮门之前', summary: '玩家抵达信号塔。', condition: {}, effects: [] },
        { key: '公开真相结局', kind: 'scene', title: '公开真相', summary: '真相改变了港口。', condition: {}, effects: [] },
        { key: 'shelter-ending', kind: 'ending', title: '守住庇护', summary: '秘密换来短暂安稳。', condition: {}, effects: [] },
        { key: '未连接草稿', kind: 'scene', title: '未采用草稿', summary: '供应商附带但入口不可达的草稿节点。', condition: {}, effects: [] },
      ],
      beats: [
        { beatKey: 'beat.opening', nodeKey: 'opening', kind: 'narration', speakerKey: null, text: '潮声压过了塔顶的警铃。', order: 0 },
        { beatKey: '真相段落', nodeKey: '公开真相结局', kind: 'narration', speakerKey: null, text: '灯光把所有证词投向海面。', order: 0 },
        { beatKey: 'beat.shelter', nodeKey: 'shelter-ending', kind: 'narration', speakerKey: null, text: '门重新合拢，秘密仍在呼吸。', order: 0 },
        { beatKey: '草稿段落', nodeKey: '未连接草稿', kind: 'narration', speakerKey: null, text: '这段草稿不进入可玩闭包。', order: 0 },
      ],
      choices: [
        { choiceKey: '公开真相选项', sourceNodeKey: 'opening', text: '公开信号记录', description: '承担真相的后果', unavailableReason: '', targetNodeKey: '公开真相结局', displayCondition: {}, availableCondition: {}, effects: [], tags: ['真相'], order: 0 },
        { choiceKey: 'choice.shelter', sourceNodeKey: 'opening', text: '封存信号记录', description: '保护眼前的人', unavailableReason: '', targetNodeKey: 'shelter-ending', displayCondition: {}, availableCondition: {}, effects: [], tags: ['shelter'], order: 1 },
      ],
    },
    'content.product-module': productType === 'text-adventure' ? {
      schema: 'storyforge.text-adventure-systems-artifact', version: 1,
      abilities: [
        { key: 'ability.attack', title: '攻击', description: '通用攻击能力。', role: 'stat', initial: 3, minimum: 0, maximum: 20 },
        { key: 'ability.defense', title: '防御', description: '通用防护能力。', role: 'stat', initial: 3, minimum: 0, maximum: 20 },
        { key: 'ability.perception', title: '感知', description: '发现环境细节。', role: 'skill', initial: 4, minimum: 0, maximum: 20 },
        { key: 'ability.resolve', title: '意志', description: '面对压力保持行动。', role: 'skill', initial: 4, minimum: 0, maximum: 20 },
      ],
      resources: [
        { key: 'resource.health', title: '生命', description: '承受行动代价。', role: 'health', initial: 10, minimum: 0, maximum: 10 },
        { key: 'resource.mana', title: '法力', description: '驱动特殊能力。', role: 'mana', initial: 8, minimum: 0, maximum: 8 },
        { key: 'resource.stamina', title: '体力', description: '持续行动所需。', role: 'stamina', initial: 10, minimum: 0, maximum: 10 },
        { key: 'resource.experience', title: '经验', description: '记录成长。', role: 'experience', initial: 0, minimum: 0, maximum: 1000 },
        { key: 'resource.skill-points', title: '技能点', description: '用于能力成长。', role: 'skill-points', initial: 0, minimum: 0, maximum: 100 },
        { key: 'resource.currency', title: '货币', description: '通用交换资源。', role: 'currency', initial: 2, minimum: 0, maximum: 1000 },
        { key: 'resource.clock', title: '时间', description: '世界行动时间。', role: 'clock', initial: 0, minimum: 0, maximum: 100000 },
      ],
      equipmentSlots: [
        { key: 'slot.weapon', title: '武器', acceptsTags: ['weapon'] },
        { key: 'slot.body', title: '身体', acceptsTags: ['armor'] },
      ],
      starterEquipment: [{
        key: 'item.starter-lamp', title: '守灯杖', description: '能照亮雾中标记的旧灯杖。',
        slotKey: 'slot.weapon', tags: ['weapon'], modifierAbilityKey: 'ability.perception', modifierDelta: 1,
      }, {
        key: 'item.starter-cloak', title: '守灯披风', description: '能抵御潮雾侵蚀的旧披风。',
        slotKey: 'slot.body', tags: ['armor'], modifierAbilityKey: 'ability.resolve', modifierDelta: 1,
      }],
    } : {
      schema: 'storyforge.product-module-artifact', version: 1, productType,
      interfaceStyle: '低饱和雾港舞台，文字保持高对比。', interactionNotes: ['每次选择后明确展示后果。'],
      presentationPolicy: { pacing: 'balanced', transitionMs: 500, backgroundStrategy: 'key-scenes' },
    },
    'content.adventure-architecture': {
      schema: 'storyforge.text-adventure-architecture-artifact', version: 1,
      title: '雾港抉择', premise: '玩家穿行雾港，在潮门关闭前决定信号记录的去向。',
      emotionalPromise: '从猜疑走向承担，让每个结局回应玩家的选择。', themes: ['信任', '责任'],
      regions: [{
        title: '雾港大区', description: '被潮汐与旧信号塔控制的沿海大区。',
        areas: [{
          title: '外港区', description: '商船与守灯人聚集的入口区域。',
          locations: [
            { title: '潮门广场', description: '通往各处的石砌广场。', tags: ['hub'] },
            { title: '旧仓街', description: '堆放航海物资的狭长街区。', tags: ['trade'] },
          ],
        }, {
          title: '灯塔区', description: '掌控港口信号的高地。',
          locations: [{ title: '信号塔', description: '保存最后一份信号记录的塔楼。', tags: ['climax'] }],
        }],
      }],
      visualBible: {
        style: '克制的手绘海港奇幻风格。', palette: ['#0d1b2a', '#31506b', '#d8b26e'],
        compositionRules: ['环境优先于装饰', '关键人物保持轮廓一致'],
        characterAnchorNotes: ['守灯人使用深蓝制服与铜色灯具'],
      },
    },
    'content.adventure-side-quests': {
      schema: 'storyforge.text-adventure-quest-bundle-artifact', version: 1, bundleKind: 'side',
      entries: [{
        key: 'lost-lamp', title: '失落的引航灯', description: '找回被潮水卷走的引航灯。',
        hook: '旧仓街的一名船工请求你在潮门关闭前帮忙。', objective: '在旧仓街找回引航灯',
        locationOrdinal: 2, abilityKey: 'ability.perception', difficulty: 10,
        successText: '你在木箱夹层找到了引航灯。', costlySuccessText: '你找到了灯，但划伤了手臂。',
        failureText: '灯被冲远了，但船工给出了另一条通往灯塔的小路。',
        rewardExperience: 5, rewardCurrency: 2, timeCostMinutes: 10,
      }],
    },
    'content.adventure-ambient-events': {
      schema: 'storyforge.text-adventure-quest-bundle-artifact', version: 1, bundleKind: 'ambient',
      entries: [{
        key: 'tide-warning', title: '潮汐警告', description: '辨认潮门墙上的水位记号。',
        hook: '潮门广场的海水正漫过旧刻度。', objective: '判断安全通过时间', locationOrdinal: 1,
        abilityKey: 'ability.perception', difficulty: 8, successText: '你准确读出了潮汐变化。',
        costlySuccessText: '你读懂刻度，但浪费了一些时间。', failureText: '你判断失误，却因此发现墙后的避险通道。',
        rewardExperience: 2, rewardCurrency: 0, timeCostMinutes: 5,
      }, {
        key: 'warehouse-echo', title: '仓街回声', description: '追查仓街深处反复出现的敲击声。',
        hook: '旧仓街的雾里传来规律的三次敲击。', objective: '确认敲击声来源', locationOrdinal: 2,
        abilityKey: 'ability.resolve', difficulty: 9, successText: '你发现那是被困船员的求救信号。',
        costlySuccessText: '你救出船员，但耽误了赶往灯塔的时间。', failureText: '声音消失了，却留下一张通往灯塔的旧图。',
        rewardExperience: 3, rewardCurrency: 1, timeCostMinutes: 8,
      }],
    },
    'content.adventure-quality-review': {
      schema: 'storyforge.text-adventure-quality-review-artifact', version: 1,
      scores: {
        causality: 4, playerAgency: 4, routeDifferentiation: 4, pacing: 4,
        setupPayoff: 4, characterMotivation: 4, emotionalImpact: 4,
      },
      issues: [], passed: true,
    },
    'qa.playtest-strategy': playtestStrategyOutput(),
    'media.requirements': {
      schema: 'storyforge.product-media-requirements-artifact', version: 2,
      visual: [
        { artifactKey: 'media.visual.001', mediaKind: 'background', sceneTag: 'opening', beatKey: 'beat.opening', prompt: '雾港信号塔与潮门的宽幅原创场景。', altText: '雾中的港口信号塔和潮门。', width: 1280, height: 720, palette: ['#0d1b2a', '#31506b', '#d8b26e'], characterAnchorRefs: [], hardConstraints: [] },
        { artifactKey: 'media.visual.002', mediaKind: 'character-pose', sceneTag: 'protagonist', beatKey: 'beat.opening', prompt: '披风主角的原创剪影立绘。', altText: '站在雾中的披风主角。', width: 720, height: 1080, palette: ['#14213d', '#6c7a89', '#e5c07b'], characterAnchorRefs: [characterAnchorRef], hardConstraints: ['不得写回世界正式表', '保持角色身份、年龄段与核心视觉特征', `角色定位：${playerRole}`].sort() },
      ],
      audio: [
        { artifactKey: 'media.audio.001', mediaKind: 'bgm', sceneTag: 'opening', beatKey: 'beat.opening', prompt: '雾港开场的克制主题音。', altText: '低沉而克制的雾港主题音。', durationMs: 3000 },
        { artifactKey: 'media.audio.002', mediaKind: 'sfx', sceneTag: 'opening-bell', beatKey: 'beat.opening', prompt: '远处的港口警铃。', altText: '远处港口警铃声。', durationMs: 1000 },
        { artifactKey: 'media.audio.003', mediaKind: 'sfx', sceneTag: 'truth-light', beatKey: 'beat.truth', prompt: '信号灯启动的短促电流声。', altText: '信号灯启动声。', durationMs: 1000 },
        { artifactKey: 'media.audio.004', mediaKind: 'sfx', sceneTag: 'shelter-door', beatKey: 'beat.shelter', prompt: '沉重潮门缓慢闭合。', altText: '潮门闭合声。', durationMs: 1000 },
      ],
    },
  } as const
}

function professionalTextAdventurePlanningOutputs(
  brief: Awaited<ReturnType<typeof fixtureForProduct>>['brief'],
) {
  const contract = brief.textAdventure!
  const sceneCount = Math.max(3, contract.narrative.targetSceneCount)
  const sceneKeys = Array.from({ length: sceneCount }, (_, index) => `scene.${String(index + 1).padStart(3, '0')}`)
  const sceneLocationPlan = planTextAdventureNarrativeLocationsV1(
    sceneCount,
    contract.narrative.targetLocationCount,
  )
  const npcCount = brief.qualityProfile === 'commercial-candidate'
    ? Math.max(5, Math.ceil(brief.scale.targetPlayMinutes / 12)) : 2
  const characters = [{
    key: 'character.player', role: 'player' as const, sourceResourceKey: null, name: '守灯人',
    publicIdentity: '负责维护潮门信号的年轻守灯人。', desire: '让港口在风暴中活下来。',
    fear: '自己的选择会牺牲无辜者。', secret: '曾经隐瞒一次错误警报。', motivation: '弥补旧错并守住共同体。',
    voice: '简短、克制，面对责任时不回避。', initialKnowledge: ['潮门即将关闭'],
    forbiddenKnowledge: ['不知道议会密封记录的完整内容'], relationshipArc: ['被居民怀疑', '以行动赢得或失去信任'],
    visualAnchor: '深蓝守灯制服、铜色灯杖、被海风磨白的披风边缘。',
  }, ...Array.from({ length: npcCount }, (_, index) => ({
    key: `character.npc.${index + 1}`, role: index < 2 ? 'major-npc' as const : 'supporting-npc' as const,
    sourceResourceKey: null, name: `港民 ${index + 1}`, publicIdentity: `掌握第 ${index + 1} 段港口生活线索的居民。`,
    desire: `保护自己负责的港口群体 ${index + 1}。`, fear: '真相引发无法控制的报复。',
    secret: `隐瞒与第 ${index + 1} 次潮汐事故有关的一项选择。`, motivation: '在公共责任与私人牵挂之间寻找出路。',
    voice: `说话具体，常以第 ${index + 1} 号灯标比喻风险。`, initialKnowledge: [`知道线索 ${index + 1}`],
    forbiddenKnowledge: ['不知道其他角色未公开的秘密'], relationshipArc: ['试探守灯人', '根据玩家行动选择协助或疏远'],
    visualAnchor: `海港工作服，携带能辨认身份的 ${index + 1} 号铜制工具。`,
  }))]
  const storyEndings = Array.from({ length: Math.max(brief.scale.targetEndingCount, 4) }, (_, index) => ({
    key: `ending.${String(index + 1).padStart(3, '0')}`, title: `潮声之后 ${index + 1}`,
    dramaticAnswer: `玩家以第 ${index + 1} 种代价回答公开真相与保护共同体能否共存。`,
    requiredConsequences: [`承认选择 ${index + 1} 的代价`, `兑现人物关系 ${index + 1} 的变化`],
  }))
  const setupPayoffs = [{
    key: 'setup.warning-bell', setup: '第一幕异常警铃总比潮汐早三分钟响起。',
    payoff: '第三幕证实警铃被某人提前校准，用来为撤离争取时间。', introducedAct: 1, resolvedAct: 3,
  }, {
    key: 'setup.copper-mark', setup: '铜制灯标背面刻着被磨损的共同誓言。',
    payoff: '终局时誓言成为居民是否相信玩家的情感证据。', introducedAct: 1, resolvedAct: 3,
  }]
  const actSceneCounts = [0, 1, 2].map(actIndex => (
    Math.floor(sceneCount / 3) + (actIndex < sceneCount % 3 ? 1 : 0)
  ))
  const minuteCounts = [0, 1, 2].map(actIndex => (
    Math.floor(brief.scale.targetPlayMinutes / 3) + (actIndex < brief.scale.targetPlayMinutes % 3 ? 1 : 0)
  ))
  let sceneOffset = 0
  const acts = actSceneCounts.map((count, actIndex) => {
    const sceneCards = sceneKeys.slice(sceneOffset, sceneOffset + count).map((sceneKey, localIndex) => ({
      key: sceneKey, title: `第 ${actIndex + 1} 幕场景 ${localIndex + 1}`,
      locationOrdinal: sceneLocationPlan[sceneOffset + localIndex].locationOrdinal,
      purpose: '推进主冲突并让玩家获得可行动的信息。', conflict: '公开事实与保护眼前人物无法同时零成本完成。',
      entryState: '玩家带着上一场留下的关系与资源后果进入。', exitState: '局面发生不可忽略的变化并开启下一目标。',
      castKeys: ['character.player', `character.npc.${(sceneOffset + localIndex) % npcCount + 1}`],
      setupKeys: actIndex === 0 ? [setupPayoffs[localIndex % setupPayoffs.length].key] : [],
      payoffKeys: actIndex === 2 ? [setupPayoffs[localIndex % setupPayoffs.length].key] : [],
    }))
    sceneOffset += count
    return {
      key: `act.${actIndex + 1}`, title: `第 ${actIndex + 1} 幕`, targetMinutes: minuteCounts[actIndex],
      goal: '完成本幕可验证目标并提高风险。', irreversibleTurn: '玩家的选择改变后续人物立场与可用资源。', sceneCards,
    }
  })
  const decisionCount = brief.qualityProfile === 'commercial-candidate'
    ? Math.max(2, Math.ceil(brief.scale.targetPlayMinutes / 10)) : 1
  const decisions = Array.from({ length: decisionCount }, (_, index) => ({
    key: `decision.${index + 1}`, sceneKey: sceneKeys[index % Math.max(1, sceneKeys.length - 2)],
    prompt: `第 ${index + 1} 次关键决定要承担什么代价？`, options: [0, 1].map(optionIndex => ({
      key: `option.${index + 1}.${optionIndex + 1}`, label: optionIndex === 0 ? '公开承担' : '暂时保护',
      cost: optionIndex === 0 ? '失去一名角色的信任' : '消耗有限的撤离时间',
      persistentEffectKey: `flag.decision.${index + 1}.${optionIndex + 1}`,
      echoSceneKeys: [sceneKeys[(index + 1) % sceneKeys.length], sceneKeys[(index + 2) % sceneKeys.length]],
    })),
  }))
  const stageCount = brief.qualityProfile === 'commercial-candidate'
    ? Math.max(3, Math.ceil(brief.scale.targetPlayMinutes / 20)) : 3
  const objectiveCount = brief.qualityProfile === 'commercial-candidate'
    ? Math.max(8, Math.ceil(brief.scale.targetPlayMinutes / 7.5)) : 8
  const objectiveKeys = Array.from({ length: objectiveCount }, (_, index) => `objective.${index + 1}`)
  const stageIndexForObjective = (objectiveIndex: number) => Math.min(
    stageCount - 1,
    Math.floor(objectiveIndex * stageCount / objectiveCount),
  )
  const stages = Array.from({ length: stageCount }, (_, stageIndex) => ({
    key: `stage.${stageIndex + 1}`, title: `主线阶段 ${stageIndex + 1}`,
    objectiveKeys: objectiveKeys.filter((_, index) => stageIndexForObjective(index) === stageIndex),
  }))
  const mainQuestPlan = {
    schema: 'storyforge.text-adventure-quest-plan-artifact' as const, version: 1 as const, bundleKind: 'main' as const,
    quests: [{
      key: 'quest.main', title: '最后的灯火', description: '调查信号记录、协调港民并决定潮门命运。',
      characterKeys: characters.map(character => character.key), stages,
      objectives: objectiveKeys.map((objectiveKey, index) => {
        const sceneIndex = Math.min(sceneKeys.length - 1, Math.floor(index * sceneKeys.length / objectiveCount))
        return {
          key: objectiveKey, stageKey: stages[stageIndexForObjective(index)].key, title: `主线目标 ${index + 1}`,
          narrativePurpose: '把场景冲突转成玩家可执行且有后果的任务。',
          sceneKeys: [sceneKeys[sceneIndex]],
          locationOrdinal: sceneLocationPlan[sceneIndex].locationOrdinal,
          alternatives: Array.from({ length: index < 2 ? 2 : 1 }, (_, alternativeIndex) => ({
            key: `alternative.${index + 1}.${alternativeIndex + 1}`,
            actionKind: alternativeIndex === 0 ? 'inspect' as const : 'talk' as const,
            targetCharacterKey: alternativeIndex === 1
              ? `character.npc.${sceneIndex % npcCount + 1}` : null,
            cost: '消耗时间或关系信任。',
            successConsequence: '目标完成并让后续人物态度发生可见变化。',
            failureForwardConsequence: '目标未按预期完成，但获得替代入口并继续主线。',
            persistentEffectKeys: [`flag.objective.${index + 1}.${alternativeIndex + 1}`],
          })),
        }
      }),
    }],
  }
  const mainObjectiveScripts = mainQuestPlan.quests[0].objectives.map(objective => ({
    objectiveKey: objective.key, sceneKey: objective.sceneKeys[0],
    alternatives: objective.alternatives.map(alternative => ({
      alternativeKey: alternative.key,
      resolution: alternative.actionKind === 'talk'
        ? { mode: 'automatic' as const, abilityKey: null, difficulty: null, costlySuccessFloor: null }
        : { mode: 'check' as const, abilityKey: 'ability.perception', difficulty: 10, costlySuccessFloor: 6 },
      timeCostMinutes: 5,
      successText: `你完成了${objective.title}，局面沿可验证的行动继续推进。`,
      costlySuccessText: `你完成了${objective.title}，但时间和身体状态付出了明确代价。`,
      failureForwardText: `你没有按预期完成${objective.title}，却获得替代入口并继续主线。`,
    })),
  }))
  return {
    'content.source-sufficiency': {
      schema: 'storyforge.text-adventure-source-sufficiency-artifact', version: 1,
      decision: 'ready', adaptationStrategy: 'adapt-rich',
      coverage: [{ domain: 'world-premise', status: 'sufficient', resourceKeys: [], rationale: '冻结世界前提足以建立产品私域冒险。' }],
      gaps: [], privateAdditions: [], authorDecisionRequired: false,
    },
    'content.story-bible': {
      schema: 'storyforge.text-adventure-story-bible-artifact', version: 1, title: '雾港抉择',
      premise: '潮门关闭前，守灯人必须决定如何处理会改变港口秩序的信号记录。',
      playerFantasy: '以有限资源承担共同体守护者的艰难选择。', thematicQuestion: '真相与保护能否在责任中共存？',
      emotionalPromise: '让玩家从被怀疑走向承担，并在结局看见关系回响。', centralConflict: '公开记录会引发冲突，封存记录会延续伤害。',
      canonFacts: ['潮门按冻结规则关闭', '信号塔保存港口记录', '玩家不能改写世界引擎事实'],
      productPrivateFacts: [], prohibitions: ['不得临时制造推翻冻结世界的幕后设定'], setupPayoffs,
      endings: storyEndings.slice(0, brief.scale.targetEndingCount),
    },
    'content.cast-bible': {
      schema: 'storyforge.text-adventure-cast-bible-artifact', version: 1, characters,
    },
    'content.narrative-arc-plan': {
      schema: 'storyforge.text-adventure-narrative-arc-plan-artifact', version: 1,
      acts, decisions,
      endings: storyEndings.slice(0, brief.scale.targetEndingCount).map((ending, index) => ({
        endingKey: ending.key, sceneKey: sceneKeys[sceneKeys.length - 1],
      })),
    },
    'content.main-quest-plan': mainQuestPlan,
    'content.quest-script': {
      schema: 'storyforge.text-adventure-quest-script-artifact', version: 1,
      mainObjectiveScripts,
      sideQuestScripts: [{
        entryKey: 'lost-lamp', actionKind: 'quest-action', abilityKey: 'ability.perception',
        difficulty: 10, costlySuccessFloor: 6, timeCostMinutes: 10,
        successText: '你在旧仓街木箱夹层找到了引航灯。',
        costlySuccessText: '你找到了引航灯，但手臂受伤并耽误了时间。',
        failureForwardText: '灯被冲远了，但船工给出另一条通往灯塔的路线。',
      }],
      ambientEventScripts: [{
        entryKey: 'tide-warning', actionKind: 'inspect', abilityKey: 'ability.perception',
        difficulty: 8, costlySuccessFloor: 4, timeCostMinutes: 5,
        successText: '你准确读出了潮汐变化。', costlySuccessText: '你读懂刻度，但浪费了一些时间。',
        failureForwardText: '你判断失误，却因此发现墙后的避险通道。',
      }, {
        entryKey: 'warehouse-echo', actionKind: 'attempt', abilityKey: 'ability.resolve',
        difficulty: 9, costlySuccessFloor: 5, timeCostMinutes: 8,
        successText: '你发现那是被困船员的求救信号。', costlySuccessText: '你救出船员，但耽误了赶往灯塔的时间。',
        failureForwardText: '声音消失了，却留下一张通往灯塔的旧图。',
      }],
    },
  } as const
}

function professionalTextAdventureSceneScriptOutputs(
  brief: Awaited<ReturnType<typeof fixtureForProduct>>['brief'],
  planning: ReturnType<typeof professionalTextAdventurePlanningOutputs>,
  locationTitles: string[],
) {
  const storyBible = planning['content.story-bible']
  const arcPlan = planning['content.narrative-arc-plan']
  const castBible = planning['content.cast-bible']
  const skeleton = textAdventureNarrativeSkeletonV1(brief)
  const locations = planTextAdventureNarrativeLocationsV1(skeleton.sceneKeys.length, locationTitles.length)
  const sceneCards = arcPlan.acts.flatMap(act => act.sceneCards)
  const sceneCardByKey = new Map(sceneCards.map(scene => [scene.key, scene]))
  const npcKeys = castBible.characters.filter(character => character.role !== 'player').map(character => character.key)
  const endingByKey = new Map(storyBible.endings.map(ending => [ending.key, ending]))
  const targetUnitsPerScene = Math.max(240, Math.ceil(brief.scale.targetWordCount / skeleton.sceneKeys.length) + 80)
  const sceneScriptOutputs = Object.fromEntries([0, 1, 2].map(actIndex => {
    const sceneKeys = textAdventureActSceneKeysV1(brief, actIndex)
    const scenes = sceneKeys.map(sceneKey => {
      const sceneIndex = skeleton.sceneKeys.indexOf(sceneKey)
      const sceneCard = sceneCardByKey.get(sceneKey)!
      const locationTitle = locationTitles[locations[sceneIndex].locationIndex]
      const beatCount = Math.max(5, Math.ceil(targetUnitsPerScene / 75))
      const beats = Array.from({ length: beatCount }, (_, beatIndex) => {
        const dialogue = beatIndex % 2 === 1
        const turningPoint = ['确认风险', '交换条件', '承担代价', '发现回响'][beatIndex % 4]
        return {
          beatKey: `beat.act-${actIndex + 1}.${String(sceneIndex + 1).padStart(3, '0')}.${String(beatIndex + 1).padStart(3, '0')}`,
          kind: dialogue ? 'dialogue' as const : beatIndex % 4 === 2 ? 'action' as const : 'narration' as const,
          speakerKey: dialogue ? npcKeys[(sceneIndex + beatIndex) % npcKeys.length] : null,
          text: dialogue
            ? `${locationTitle}的第${sceneIndex + 1}场对话推进到第${beatIndex + 1}个回合。角色不再复述已知事实，而是围绕${turningPoint}提出具体条件，逼迫守灯人把责任、关系和有限时间放在同一个选择里衡量。`
            : `${locationTitle}的潮声在第${sceneIndex + 1}场发生了新的变化。第${beatIndex + 1}段行动让${sceneCard.conflict}从抽象矛盾变成眼前可见的后果，也把${sceneCard.purpose}所需的信息交到玩家手中。`,
          order: beatIndex,
        }
      })
      return {
        sceneKey,
        title: sceneCard.title,
        summary: `${locationTitle}内，${sceneCard.purpose}；玩家进入时${sceneCard.entryState}，离开时${sceneCard.exitState}。`,
        beats,
      }
    })
    const choices = skeleton.edges.filter(edge => sceneKeys.includes(edge.sourceNodeKey)).map(edge => ({
      choiceKey: edge.choiceKey,
      sourceNodeKey: edge.sourceNodeKey,
      targetNodeKey: edge.targetNodeKey,
      text: edge.targetNodeKey.startsWith('ending.')
        ? `接受${endingByKey.get(edge.targetNodeKey)!.title}的结局`
        : edge.order === 0 ? `以公开承担的方式进入${edge.targetNodeKey}` : `以保护同伴的方式进入${edge.targetNodeKey}`,
      description: edge.order === 0
        ? '把事实公开给相关角色，以关系压力换取共同决策。'
        : '先保护眼前的人，以有限时间和后续信任承担代价。',
      unavailableReason: '必须先完成当前场景的主线目标。',
      order: edge.order,
    }))
    const endings = actIndex === 2 ? skeleton.endingKeys.map((endingKey, endingIndex) => ({
      endingKey,
      title: endingByKey.get(endingKey)!.title,
      summary: endingByKey.get(endingKey)!.dramaticAnswer,
      beats: Array.from({ length: 4 }, (_, beatIndex) => ({
        beatKey: `beat.act-3.ending-${String(endingIndex + 1).padStart(3, '0')}.${String(beatIndex + 1).padStart(3, '0')}`,
        kind: beatIndex === 1 ? 'dialogue' as const : 'narration' as const,
        speakerKey: beatIndex === 1 ? npcKeys[endingIndex % npcKeys.length] : null,
        text: `结局${endingIndex + 1}的第${beatIndex + 1}个回响明确交代此前的选择如何改变港城、同行者和守灯人的责任，并让${endingByKey.get(endingKey)!.requiredConsequences.join('与')}成为可以理解的结果。`,
        order: beatIndex,
      })),
    })) : []
    const taskKey = `content.scene-script.act-${actIndex + 1}`
    return [taskKey, {
      schema: 'storyforge.text-adventure-scene-script-bundle-artifact' as const,
      version: 1 as const,
      actKey: `act.${actIndex + 1}`,
      moduleTitle: storyBible.title,
      scenes,
      choices,
      endings,
    }]
  })) as Record<string, {
    schema: 'storyforge.text-adventure-scene-script-bundle-artifact'
    version: 1
    actKey: string
    moduleTitle: string
    scenes: Array<{ sceneKey: string; title: string; summary: string; beats: Array<{
      beatKey: string; kind: 'narration' | 'dialogue' | 'action'; speakerKey: string | null; text: string; order: number
    }> }>
    choices: Array<{
      choiceKey: string; sourceNodeKey: string; targetNodeKey: string; text: string
      description: string; unavailableReason: string; order: number
    }>
    endings: Array<{ endingKey: string; title: string; summary: string; beats: Array<{
      beatKey: string; kind: 'narration' | 'dialogue'; speakerKey: string | null; text: string; order: number
    }> }>
  }>
  const dialoguePassOutputs = Object.fromEntries(Object.values(sceneScriptOutputs).map(bundle => {
    const dialogueBeats = [
      ...bundle.scenes.flatMap(scene => scene.beats),
      ...bundle.endings.flatMap(ending => ending.beats),
    ].filter(beat => beat.kind === 'dialogue').sort((left, right) => left.beatKey.localeCompare(right.beatKey))
    const choices = [...bundle.choices].sort((left, right) => left.choiceKey.localeCompare(right.choiceKey))
    const usedSpeakerKeys = [...new Set(dialogueBeats.map(beat => beat.speakerKey!))].sort()
    const taskKey = `content.dialogue-pass.act-${bundle.actKey.slice('act.'.length)}`
    return [taskKey, {
      schema: 'storyforge.text-adventure-dialogue-pass-artifact' as const,
      version: 1 as const,
      actKey: bundle.actKey,
      characterAssessments: usedSpeakerKeys.map(characterKey => ({
        characterKey,
        voiceDistinctness: 'adequate' as const,
        knowledgeBoundary: 'passed' as const,
        notes: '审校后说话方式与角色圣经一致，未越过已知事实边界。',
      })),
      beatReviews: dialogueBeats.map(beat => ({
        beatKey: beat.beatKey,
        speakerKey: beat.speakerKey!,
        verdict: 'keep' as const,
        issueTags: ['none'] as const,
        rationale: '声音、目的和知识边界均符合角色圣经。',
        revisedText: beat.text,
      })),
      choiceReviews: choices.map(choice => ({
        choiceKey: choice.choiceKey,
        verdict: 'keep' as const,
        issueTags: ['none'] as const,
        rationale: '选择措辞表达了可理解的玩家意图与差异化代价。',
        revisedText: choice.text,
        revisedDescription: choice.description,
      })),
      summary: '已逐条覆盖本幕全部对白与玩家选择文案，角色声音、知识边界和玩家意图均可进入确定性装配。',
    }]
  }))
  return {
    ...sceneScriptOutputs,
    ...dialoguePassOutputs,
  }
}

function fullLengthTextAdventureOutputs(
  brief: Awaited<ReturnType<typeof fixtureForProduct>>['brief'],
) {
  const base = modelOutputs(
    brief.source.worldContentHash, 'text-adventure', firstCharacterAnchor(brief), brief.intent.playerRole,
  )
  const contract = brief.textAdventure!
  const regions = Array.from({ length: contract.narrative.targetRegionCount }, (_, regionIndex) => ({
    title: `雾港大区 ${regionIndex + 1}`,
    description: `承载主线第 ${regionIndex + 1} 阶段的完整大区域。`,
    areas: Array.from({ length: contract.narrative.targetAreaCount / contract.narrative.targetRegionCount }, (_, areaIndex) => ({
      title: `区域 ${regionIndex + 1}-${areaIndex + 1}`,
      description: '连接主线、支线和环境事件的中层区域。',
      locations: Array.from({ length: contract.narrative.targetLocationCount / contract.narrative.targetAreaCount }, (_, locationIndex) => ({
        title: `地点 ${regionIndex + 1}-${areaIndex + 1}-${locationIndex + 1}`,
        description: '具备独立场景目标、环境反馈与移动出口的可玩地点。', tags: ['adventure'],
      })),
    })),
  }))
  const locationTitles = regions.flatMap(region => region.areas.flatMap(area => (
    area.locations.map(location => location.title)
  )))
  const questEntry = (kind: 'side' | 'ambient', index: number) => ({
    key: `${kind}-${index + 1}`, title: `${kind === 'side' ? '支线' : '区域事件'} ${index + 1}`,
    description: `${locationTitles[index % locationTitles.length]}里，与主线主题呼应但拥有独立目标和回响。`,
    hook: '一个可理解的局面邀请玩家介入。',
    objective: `完成${kind === 'side' ? '支线' : '区域事件'}目标 ${index + 1}`,
    locationOrdinal: index % contract.narrative.targetLocationCount + 1,
    abilityKey: index % 2 ? 'ability.resolve' : 'ability.perception', difficulty: 9 + index,
    successText: '行动成功并改变了局部状态。', costlySuccessText: '目标达成，但玩家付出了明确代价。',
    failureText: '行动失败，却打开了替代局面并继续推进。', rewardExperience: 3, rewardCurrency: 1,
    timeCostMinutes: 8,
  })
  const professional = professionalTextAdventurePlanningOutputs(brief)
  const sceneScripts = professionalTextAdventureSceneScriptOutputs(brief, professional, locationTitles)
  const sideEntries = Array.from(
    { length: contract.narrative.targetSideQuestCount }, (_, index) => questEntry('side', index),
  )
  const ambientEntries = Array.from(
    { length: contract.narrative.targetAmbientEventCount }, (_, index) => questEntry('ambient', index),
  )
  const mainPlan = professional['content.main-quest-plan']
  const scriptedSupplemental = (entries: typeof sideEntries, actionKind: 'quest-action' | 'inspect') => (
    entries.map(entry => ({
      entryKey: entry.key, actionKind, abilityKey: entry.abilityKey,
      difficulty: entry.difficulty, costlySuccessFloor: Math.max(1, entry.difficulty - 4),
      timeCostMinutes: entry.timeCostMinutes,
      successText: entry.successText, costlySuccessText: entry.costlySuccessText,
      failureForwardText: entry.failureText,
    }))
  )
  return {
    ...base,
    ...professional,
    ...sceneScripts,
    'content.adventure-architecture': {
      ...base['content.adventure-architecture'],
      regions,
    },
    'content.adventure-side-quests': {
      schema: 'storyforge.text-adventure-quest-bundle-artifact' as const, version: 1 as const, bundleKind: 'side' as const,
      entries: sideEntries,
    },
    'content.adventure-ambient-events': {
      schema: 'storyforge.text-adventure-quest-bundle-artifact' as const, version: 1 as const, bundleKind: 'ambient' as const,
      entries: ambientEntries,
    },
    'content.quest-script': {
      schema: 'storyforge.text-adventure-quest-script-artifact' as const, version: 1 as const,
      mainObjectiveScripts: mainPlan.quests[0].objectives.map(objective => ({
        objectiveKey: objective.key, sceneKey: objective.sceneKeys[0],
        alternatives: objective.alternatives.map(alternative => ({
          alternativeKey: alternative.key,
          resolution: alternative.actionKind === 'talk'
            ? { mode: 'automatic' as const, abilityKey: null, difficulty: null, costlySuccessFloor: null }
            : { mode: 'check' as const, abilityKey: 'ability.perception', difficulty: 10, costlySuccessFloor: 6 },
          timeCostMinutes: 5,
          successText: `你完成了${objective.title}，主线获得清晰进展。`,
          costlySuccessText: `你完成了${objective.title}，但付出了时间和体力。`,
          failureForwardText: `你没有按预期完成${objective.title}，却找到替代推进方式。`,
        })),
      })),
      sideQuestScripts: scriptedSupplemental(sideEntries, 'quest-action'),
      ambientEventScripts: scriptedSupplemental(ambientEntries, 'inspect'),
    },
    'media.requirements': {
      ...base['media.requirements'], visual: [], audio: [],
    },
  }
}

async function relayCapabilities(brief: Awaited<ReturnType<typeof fixture>>['brief'], calls: RedactedMediaTransportRequestV1[]) {
  const png = (width: number, height: number) => {
    const bytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0, 0, 0, 0, 0, 0, 0, 0,
    ])
    const view = new DataView(bytes.buffer)
    view.setUint32(16, width, false); view.setUint32(20, height, false)
    return String.fromCharCode(...bytes)
  }
  const transport: MediaProviderTransportV1 = {
    executionLocation: 'trusted-relay',
    async request(request) {
      calls.push(structuredClone(request))
      if (request.adapterId === 'openai.gpt-image-2.v1') return {
        status: 200, contentType: 'application/json', body: null,
        json: { created: 1, data: [{
          b64_json: btoa(png(String(request.body.prompt).includes('主角') ? 720 : 1280,
            String(request.body.prompt).includes('主角') ? 1080 : 720)),
          revised_prompt: '原创雾港构图',
        }] },
        providerRequestId: request.requestId, usage: { outputImages: 1 }, costUsd: 0.02,
      }
      return {
        status: 200, contentType: 'audio/mpeg',
        body: Uint8Array.from([0x49, 0x44, 0x33, 0x04]).buffer, json: null,
        providerRequestId: request.requestId, usage: { outputAudio: 1 }, costUsd: 0.01,
      }
    },
  }
  const resolved = new Map<string, ResolvedProductMediaCapabilityV1>()
  for (const requirement of brief.capabilityRequirements.filter(item => ['image', 'music', 'sfx'].includes(item.mediaClass))) {
    const adapterId = requirement.mediaClass === 'image'
      ? 'openai.gpt-image-2.v1'
      : requirement.mediaClass === 'music' ? 'elevenlabs.music.v2' : 'elevenlabs.sound-effects.v2'
    const capabilityHash = await hashProductProductionValueV2({ requirementKey: requirement.requirementKey, adapterId })
    const adapter = resolveProductMediaProviderAdapterV1(adapterId)
    resolved.set(requirement.requirementKey, {
      adapter, transport,
      binding: { requirementKey: requirement.requirementKey, adapterId, bindingHash: capabilityHash },
      receipt: {
        schema: 'storyforge.media-relay-binding-receipt', version: 1,
        requirementKey: requirement.requirementKey, adapterId, adapterVersion: 1,
        relayOrigin: 'https://relay.fixture.invalid', executionLocation: 'trusted-relay',
        credentialSource: 'relay-session', capabilityHash, boundAt: 1,
        receiptHash: await hashProductProductionValueV2({ requirementKey: requirement.requirementKey, capabilityHash }),
      },
    })
  }
  return resolved
}

describe('R-PRODUCTPROD-1F · provider JSON response normalization', () => {
  it('角色 provider prompt 在冻结前剥离模型夹带的场景描述', () => {
    expect(isolateCharacterProviderPromptV1(
      '青年守灯人，深蓝制服，手持潮汐纸条；背景为灯塔控制室与风暴海面',
      '守灯人立绘',
    )).toBe('青年守灯人，深蓝制服，手持潮汐纸条')
  })

  it('接受原始对象、Markdown 围栏和单一说明文字包装，并正确处理字符串内花括号', () => {
    expect(parseProductionModelJsonObjectV1('{"ok":true}', 'raw')).toEqual({ ok: true })
    expect(parseProductionModelJsonObjectV1('```json\n{"ok":true}\n```', 'fenced')).toEqual({ ok: true })
    expect(parseProductionModelJsonObjectV1(
      '这是请求的结果：\n{"message":"保留 {角色} 与 \\"引号\\"","ok":true}\n以上。',
      'wrapped',
    )).toEqual({ message: '保留 {角色} 与 "引号"', ok: true })
  })

  it('拒绝数组、多个对象、结构损坏和过长输出', () => {
    expect(() => parseProductionModelJsonObjectV1('[{"ok":true}]', 'array')).toThrow('array 必须是对象')
    expect(() => parseProductionModelJsonObjectV1('{"a":1}\n{"b":2}', 'multiple')).toThrow('必须只包含一个完整 JSON 对象')
    expect(() => parseProductionModelJsonObjectV1('```json\n{"a":"unterminated}\n```', 'broken')).toThrow('必须只包含一个完整 JSON 对象')
    expect(() => parseProductionModelJsonObjectV1('x'.repeat(2_000_001), 'large')).toThrow('模型输出为空或过长')
  })

  it('仅补全有确定空语义的叙事协议字段，并保留未知字段供严格解析器拒绝', () => {
    const narrative = legalizeProductionModelProtocolDefaultsV1('content.narrative', {
      nodes: [{
        key: 'entry', kind: 'entry', title: '入口', summary: '开始。',
        condition: { path: '', eq: true }, effects: ['invented-state-change'],
      }],
      beats: [{ beatKey: 'beat.entry', nodeKey: 'entry', kind: 'narration', text: '雾散了。' }],
      choices: [{
        choiceKey: 'choice.leave', sourceNodeKey: 'entry', text: '离开',
        targetNodeKey: 'ending', availableCondition: { all: [], leaked: true },
        effects: ['invented-choice-effect'], leaked: true,
      }, null],
    }, { narrativeStatePolicy: 'empty-unregistered' })
    expect(narrative.payload).toMatchObject({
      nodes: [{ condition: {}, effects: [] }],
      beats: [{ speakerKey: null, order: 0 }],
      choices: [{
        description: '', unavailableReason: '', displayCondition: {}, availableCondition: {},
        effects: [], tags: [], order: 0, leaked: true,
      }],
    })
    expect(narrative.defaultedFields).toContain('choices[0].description')
    expect(narrative.discardedNullEntries).toEqual(['choices[1]'])
    expect(narrative.discardedUnregisteredStateFields).toEqual([
      'nodes[0].condition', 'nodes[0].effects',
      'choices[0].availableCondition', 'choices[0].effects',
    ])

    const quests = legalizeProductionModelProtocolDefaultsV1('content.adventure-ambient-events', {
      entries: [{ key: 'tide-warning', title: '潮汐警告', leaked: true }],
    })
    expect(quests.payload).toMatchObject({
      entries: [{
        rewardExperience: 2, rewardCurrency: 0, timeCostMinutes: 5, leaked: true,
      }],
    })
    expect(quests.defaultedFields).toEqual([
      'entries[0].rewardExperience', 'entries[0].rewardCurrency', 'entries[0].timeCostMinutes',
    ])
    expect(quests.discardedNullEntries).toEqual([])
    expect(quests.discardedUnregisteredStateFields).toEqual([])
  })
})

describe('R-PRODUCTPROD-1F · configured formal production executor', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('复用非密钥 binding，并行生成内容、视觉、音频，预览后完成三轮连续演化', async () => {
    const owned = await fixture()
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const imageRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'image')!
    const audioRequirements = owned.brief.capabilityRequirements.filter(item => item.mediaClass === 'music' || item.mediaClass === 'sfx')
    const bindingHash = await hashProductProductionValueV2({ provider: 'existing-global-config' })
    const outputs = modelOutputs(
      owned.brief.source.worldContentHash,
      'avg',
      firstCharacterAnchor(owned.brief),
      owned.brief.intent.playerRole,
    )
    const forgedAnchors = structuredClone(outputs['media.requirements'])
    forgedAnchors.visual[1].characterAnchorRefs = ['character:999999']
    expect(() => parseProductMediaRequirementsArtifactV2(forgedAnchors, owned.brief))
      .toThrow(/角色锚点未绑定 Brief 冻结角色/)
    const anchoredScene = structuredClone(outputs['media.requirements'])
    anchoredScene.visual[0].characterAnchorRefs = [firstCharacterAnchor(owned.brief)]
    anchoredScene.visual[0].hardConstraints = [
      '不得写回世界正式表',
      '保持角色身份、年龄段与核心视觉特征',
      `角色定位：${owned.brief.intent.playerRole}`,
    ].sort()
    expect(parseProductMediaRequirementsArtifactV2(anchoredScene, owned.brief).visual[0].characterAnchorRefs)
      .toEqual(anchoredScene.visual[0].characterAnchorRefs)
    const weakenedConstraints = structuredClone(outputs['media.requirements'])
    weakenedConstraints.visual[1].hardConstraints = ['模型建议缩小约束']
    expect(parseProductMediaRequirementsArtifactV2(weakenedConstraints, owned.brief).visual[1].hardConstraints)
      .toEqual([
        '不得写回世界正式表',
        '保持角色身份、年龄段与核心视觉特征',
        `角色定位：${owned.brief.intent.playerRole}`,
      ].sort())
    const backgroundSuggestion = structuredClone(outputs['media.requirements'])
    backgroundSuggestion.visual[0].hardConstraints = ['背景不得出现人物']
    expect(parseProductMediaRequirementsArtifactV2(backgroundSuggestion, owned.brief).visual[0].hardConstraints)
      .toEqual([])
    const forgedSceneAnchor = structuredClone(anchoredScene)
    forgedSceneAnchor.visual[0].characterAnchorRefs = ['character:999999']
    expect(() => parseProductMediaRequirementsArtifactV2(forgedSceneAnchor, owned.brief))
      .toThrow(/角色锚点未绑定 Brief 冻结角色/)
    const calls: string[] = []
    const runText: ProductionTextRunnerV1 = async request => {
      const taskKey = Object.keys(outputs).find(key => request.system.includes(`任务=${key}。`)) as keyof typeof outputs
      if (!taskKey) throw new Error('unknown formal model task')
      calls.push(taskKey)
      const output = taskKey === 'content.narrative'
        ? {
            ...outputs[taskKey],
            choices: outputs[taskKey].choices.map((choice, index) => (
              index === 1 ? { ...choice, targetNodeKey: '公开真相结局' } : choice
            )),
          }
        : outputs[taskKey]
      return {
        output: JSON.stringify(output), usage: { inputTokens: 100, outputTokens: 100 },
        bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1,
          requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1,
          provider: 'fixture', model: 'fixture-model', endpointOrigin: 'https://fixture.invalid',
          executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
          capabilityHash: bindingHash, boundAt: 1, receiptHash: 'a'.repeat(64),
        },
      }
    }
    const production = (await db.productProductions.get(owned.productionId))!
    const executor = createConfiguredProductProductionExecutorV1({ production, brief: owned.brief, runText })
    const capabilityBindings = [
      { requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash },
      await createBuiltInProductionCapabilityBindingV1({
        requirementKey: imageRequirement.requirementKey, adapterId: 'storyforge.procedural-svg.v1',
      }),
      ...await Promise.all(audioRequirements.map(requirement => createBuiltInProductionCapabilityBindingV1({
        requirementKey: requirement.requirementKey, adapterId: 'storyforge.procedural-audio.v1',
      }))),
    ]
    const projection = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId, executor,
      capabilityBindings,
    })
    expect(projection.terminal).toBe(true)
    expect(calls.sort()).toEqual([
      'content.design', 'content.narrative', 'content.product-module', 'media.requirements',
    ].sort())
    const build = (await db.productBuilds.get(projection.buildId))!
    expect(build.status).toBe('release-ready')
    expect(JSON.parse(build.compatibilityJson)).toMatchObject({
      schema: 'storyforge.product-build-compatibility', level: 'compatible', migrationPolicy: 'initial-session',
    })
    const packageArtifact = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([build.id!, 'runtime.package']).first()
    const runtimePackage = parseProductRuntimePackageV1(packageArtifact!.payloadJson)
    expect(runtimePackage.presentation?.assets).toHaveLength(6)
    expect(runtimePackage.presentation?.cues).toHaveLength(6)
    expect(runtimePackage.presentation?.assets.filter(asset => asset.mimeType === 'audio/wav')).toHaveLength(4)
    expect(await db.mediaBlobObjects.count()).toBe(6)
    const prepared = await prepareProductProductionAdoption({ scope: owned.scope, productionId: owned.productionId })
    expect(prepared).toMatchObject({ productType: 'avg', mediaAssetKeys: expect.arrayContaining([
      'formal.production.build-1.media.visual.001', 'formal.production.build-1.media.visual.002',
    ]) })
    const opened = await startProductProductionPreviewV1({
      scope: owned.scope, productionId: owned.productionId,
    })
    expect(opened.productType).toBe('avg')
    expect(await db.productRuntimeSessions.get(opened.sessionId)).toMatchObject({
      productBuildId: build.id, productReleaseId: null, kind: 'avg', runtimeSourceHash: build.packageHash,
    })
    const playable = await resolveProductRuntimeSource({
      scope: owned.scope,
      source: { kind: 'build', productBuildId: build.id!, expectedPreviewHash: build.previewHash },
    })
    const imageAsset = runtimePackage.presentation!.assets.find(asset => asset.mimeType === 'image/svg+xml')!
    const media = await playable.mediaResolver.read(imageAsset.assetKey)
    expect(media.type).toBe('image/svg+xml')
    expect(media.size).toBeGreaterThan(100)
    playable.mediaResolver.dispose()
    const published = await publishProductProductionV1({
      scope: owned.scope, productionId: owned.productionId,
    })
    const releasedPlayable = await resolveProductRuntimeSource({
      scope: owned.scope,
      source: { kind: 'release', productReleaseId: published.receipt.productReleaseId },
    })
    expect(releasedPlayable.packageHash).toBe(build.packageHash)
    expect(releasedPlayable.runtimePackage).toEqual(runtimePackage)
    const releasedMedia = await releasedPlayable.mediaResolver.read(imageAsset.assetKey)
    expect(releasedMedia.size).toBe(media.size)
    releasedPlayable.mediaResolver.dispose()
    const evolution = await beginProductProductionEvolutionV1({
      scope: owned.scope, productionId: owned.productionId,
      userText: '承接守住庇护的结局，让原来的配角调查第二座信号塔。',
    })
    const nextBriefRow = await db.productProductionBriefs
      .where('[productionId+revision]').equals([owned.productionId, evolution.briefRevision]).first()
    expect(nextBriefRow).toMatchObject({ parentRevision: 1, status: 'draft' })
    expect(JSON.parse(nextBriefRow!.briefJson)).toMatchObject({
      intent: { openingSituation: '承接守住庇护的结局，让原来的配角调查第二座信号塔。' },
      unresolvedDecisionKeys: [],
    })
    expect(await db.productProductions.get(owned.productionId)).toMatchObject({
      status: 'brief-ready', currentBriefRevision: evolution.briefRevision, currentBuildNumber: 1,
    })
    const currentProduction = (await db.productProductions.get(owned.productionId))!
    const authorized = await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'authorize-start', commandId: 'formal.evolution.authorize',
        expectedStateRevision: currentProduction.stateRevision,
        briefRevision: evolution.briefRevision, briefHash: nextBriefRow!.briefHash,
        authorizationNonce: 'formal.evolution.click',
      },
    })
    expect(authorized).toMatchObject({ ok: true, result: { buildNumber: 2 } })
    const nextBrief = parseProductProductionBriefV3(nextBriefRow!.briefJson)
    const evolvedProjection = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: nextBrief, runText,
      }),
      capabilityBindings,
    })
    expect(evolvedProjection.terminal).toBe(true)
    expect(await db.productBuilds.get(evolvedProjection.buildId)).toMatchObject({
      buildNumber: 2, parentBuildNumber: 1, sourceProductReleaseId: published.receipt.productReleaseId,
      status: 'release-ready',
    })
    expect(JSON.parse((await db.productBuilds.get(evolvedProjection.buildId))!.compatibilityJson)).toMatchObject({
      schema: 'storyforge.product-build-compatibility', fromBuildNumber: 1, toBuildNumber: 2,
      level: 'compatible', migrationPolicy: 'identity',
    })
    expect(await db.productBuilds.get(build.id!)).toMatchObject({
      status: 'released', previewHash: build.previewHash, releasedProductReleaseId: published.receipt.productReleaseId,
    })
    expect(await db.productRuntimeSessions.get(opened.sessionId)).toMatchObject({ productBuildId: build.id })

    let previousBuildNumber = 2
    for (const [index, goal] of [
      '继续第二座信号塔的调查，让第一轮选择改变可用路线与同伴态度。',
      '把已经揭示的真相推进到港口议会，保留前三版全部后果并增加最终抉择。',
    ].entries()) {
      const nextEvolution = await beginProductProductionEvolutionV1({
        scope: owned.scope, productionId: owned.productionId, userText: goal,
      })
      const row = await db.productProductionBriefs
        .where('[productionId+revision]').equals([owned.productionId, nextEvolution.briefRevision]).first()
      const productionBeforeStart = (await db.productProductions.get(owned.productionId))!
      await executeProductProductionCommand({
        scope: owned.scope, productionId: owned.productionId,
        command: {
          type: 'authorize-start', commandId: `formal.evolution.${index + 2}.authorize`,
          expectedStateRevision: productionBeforeStart.stateRevision,
          briefRevision: nextEvolution.briefRevision, briefHash: row!.briefHash,
          authorizationNonce: `formal.evolution.${index + 2}.click`,
        },
      })
      const parsedBrief = parseProductProductionBriefV3(row!.briefJson)
      const nextProjection = await runProductProductionUntilBlockedV1({
        scope: owned.scope, productionId: owned.productionId,
        executor: createConfiguredProductProductionExecutorV1({
          production: (await db.productProductions.get(owned.productionId))!, brief: parsedBrief, runText,
        }),
        capabilityBindings,
      })
      expect(nextProjection.terminal).toBe(true)
      const nextBuild = (await db.productBuilds.get(nextProjection.buildId))!
      expect(nextBuild).toMatchObject({
        buildNumber: previousBuildNumber + 1, parentBuildNumber: previousBuildNumber,
        sourceProductReleaseId: published.receipt.productReleaseId, status: 'release-ready',
      })
      previousBuildNumber = nextBuild.buildNumber
    }
    expect(previousBuildNumber).toBe(4)
    expect(await db.productBuilds.where('productionId').equals(owned.productionId).count()).toBe(4)
    expect(await db.productReleases.get(published.receipt.productReleaseId)).toMatchObject({
      contentHash: published.receipt.releaseContentHash,
    })
    expect(await db.productRuntimeSessions.get(opened.sessionId)).toMatchObject({
      productBuildId: build.id, runtimeSourceHash: build.packageHash,
    })
  }, 30_000)

  it('商业候选通过可信中继生成可验证 PNG/MP3，且执行请求与冻结证据不含 API Key', async () => {
    const owned = await fixture('commercial-candidate')
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const textBindingHash = await hashProductProductionValueV2({ provider: 'existing-global-config' })
    const outputs = modelOutputs(
      owned.brief.source.worldContentHash,
      'avg',
      firstCharacterAnchor(owned.brief),
      owned.brief.intent.playerRole,
    )
    const runText: ProductionTextRunnerV1 = async request => {
      const taskKey = Object.keys(outputs).find(key => request.system.includes(`任务=${key}。`)) as keyof typeof outputs
      if (!taskKey) throw new Error('unknown formal model task')
      return {
        output: JSON.stringify(outputs[taskKey]), usage: { inputTokens: 100, outputTokens: 100 },
        bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1,
          requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1,
          provider: 'fixture', model: 'fixture-model', endpointOrigin: 'https://fixture.invalid',
          executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
          capabilityHash: textBindingHash, boundAt: 1, receiptHash: 'b'.repeat(64),
        },
      }
    }
    const relayCalls: RedactedMediaTransportRequestV1[] = []
    const mediaCapabilities = await relayCapabilities(owned.brief, relayCalls)
    const capabilityBindings = [
      { requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash: textBindingHash },
      ...[...mediaCapabilities.values()].map(item => item.binding),
    ]
    const projection = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!,
        brief: owned.brief, runText, mediaCapabilities,
      }),
      capabilityBindings,
    })
    expect(projection.terminal).toBe(true)
    expect(relayCalls).toHaveLength(6)
    expect(JSON.stringify(relayCalls)).not.toMatch(/api[-_]?key|authorization|bearer\s|sk-/i)
    const characterImageCall = relayCalls.find(call => call.adapterId === 'openai.gpt-image-2.v1'
      && String(call.body.prompt).includes('冻结角色锚点'))
    expect(characterImageCall?.body.prompt).toContain('保持角色身份、年龄段与核心视觉特征')
    const backgroundImageCall = relayCalls.find(call => call.adapterId === 'openai.gpt-image-2.v1'
      && !String(call.body.prompt).includes('冻结角色锚点'))
    expect(backgroundImageCall?.body.prompt).toContain('不得出现任何人物、肖像、人形、倒影、剪影或照片')
    const build = (await db.productBuilds.get(projection.buildId))!
    expect(build.status).toBe('preview-ready')
    const media = await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()
    const providerMedia = media.filter(item => item.blobObjectId != null)
    expect(providerMedia.filter(item => item.mimeType === 'image/png')).toHaveLength(2)
    expect(providerMedia.filter(item => item.mimeType === 'audio/mpeg')).toHaveLength(4)
    for (const artifact of providerMedia) {
      expect(JSON.parse(artifact.qualityJson)).toMatchObject({
        mimeVerified: true, contentHashVerified: true,
        providerReceiptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
      expect(JSON.parse(artifact.rightsJson)).toMatchObject({
        origin: 'generated', commercialUse: true,
        license: expect.stringMatching(/^rights-policy:/),
      })
      expect(artifact.qualityJson).not.toContain('outputImages')
      expect(artifact.qualityJson).not.toContain('outputAudio')
    }
    const characterArtifact = providerMedia.find(item => item.mediaKind === 'character-pose')!
    expect(JSON.parse(characterArtifact.qualityJson)).toMatchObject({
      anchorRulesHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      characterAnchorRefs: [firstCharacterAnchor(owned.brief)],
      hardConstraintsApplied: expect.arrayContaining([
        '不得写回世界正式表', '保持角色身份、年龄段与核心视觉特征',
        `角色定位：${owned.brief.intent.playerRole}`,
      ]),
    })
    // The shared blob store deduplicates the four identical fixture audio bytes.
    expect(await db.mediaBlobObjects.count()).toBe(3)
    await expect(prepareProductProductionAdoption({
      scope: owned.scope, productionId: owned.productionId,
    })).rejects.toThrow(/商业候选缺少真实浏览器性能回执/)
    await recordProductBrowserPerformanceMeasurementV1({
      scope: owned.scope, productBuildId: build.id!,
      measurement: {
        browserName: 'chromium', browserVersion: 'fixture', platform: 'desktop',
        viewport: { width: 1440, height: 900 }, packageHash: build.packageHash, previewHash: build.previewHash,
        firstInteractiveBytes: 2 * 1024 * 1024,
        cachedSceneLatenciesMs: Array.from({ length: 20 }, (_, index) => 40 + index),
        choiceInputLatenciesMs: Array.from({ length: 20 }, (_, index) => 20 + index),
        memorySamples: [
          { elapsedMs: PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.warmupDurationMs, usedHeapBytes: 100 * 1024 * 1024 },
          { elapsedMs: PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.minimumLongRunDurationMs, usedHeapBytes: 108 * 1024 * 1024 },
        ],
        measuredAt: Date.now(),
      },
    })
    expect(await db.productBuilds.get(build.id!)).toMatchObject({ status: 'preview-ready' })
    await expect(prepareProductProductionAdoption({
      scope: owned.scope, productionId: owned.productionId,
    })).rejects.toThrow(/真实主路线试玩回执/)
    const sessionId = await completeAvgBuildPreviewMainRoute({
      scope: owned.scope, productionId: owned.productionId,
    })
    await recordProductBuildMainRoutePlaythroughV1({
      scope: owned.scope, productBuildId: build.id!, productRuntimeSessionId: sessionId,
      authorConfirmation: 'author-confirmed-main-route',
      environment: {
        browserName: 'chromium', browserVersion: 'fixture', platform: 'desktop',
        viewport: { width: 1440, height: 900 },
      },
    })
    expect(await db.productBuilds.get(build.id!)).toMatchObject({ status: 'preview-ready' })
    await expect(prepareProductProductionAdoption({
      scope: owned.scope, productionId: owned.productionId,
    })).rejects.toThrow(/媒资解码回执/)
    const runtimeArtifact = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([build.id!, 'runtime.package']).first()
    const runtime = parseProductRuntimePackageV1(runtimeArtifact!.payloadJson)
    await recordProductMediaRuntimeMeasurementV1({
      scope: owned.scope, productBuildId: build.id!,
      measurement: {
        assets: [...runtime.presentation!.assets]
          .sort((left, right) => left.assetKey.localeCompare(right.assetKey))
          .map(asset => asset.mimeType.startsWith('image/') ? {
            assetKey: asset.assetKey, contentHash: asset.blobContentHash, mimeType: asset.mimeType,
            mediaClass: 'image' as const, status: 'decoded' as const,
            decodedWidth: asset.width!, decodedHeight: asset.height!, decodedDurationMs: null,
            decodedHasAlpha: asset.kind === 'character-pose' || asset.kind === 'character-expression',
            decodedChannelCount: null, decodedSampleRateHz: null, integratedLufs: null,
            truePeakDbtp: null, loopSeamDbfs: null, policyFailures: [], failureCode: null,
          } : {
            assetKey: asset.assetKey, contentHash: asset.blobContentHash, mimeType: asset.mimeType,
            mediaClass: 'audio' as const, status: 'decoded' as const,
            decodedWidth: null, decodedHeight: null, decodedDurationMs: asset.durationMs!,
            decodedHasAlpha: null, decodedChannelCount: 2, decodedSampleRateHz: 44_100,
            integratedLufs: -18, truePeakDbtp: -2, loopSeamDbfs: -40,
            policyFailures: [], failureCode: null,
          }),
        environment: {
          browserName: 'chromium', browserVersion: 'fixture', platform: 'desktop',
          viewport: { width: 1440, height: 900 },
        },
        measuredAt: Date.now(),
      },
    })
    expect(await db.productBuilds.get(build.id!)).toMatchObject({ status: 'release-ready' })
    await expect(prepareProductProductionAdoption({
      scope: owned.scope, productionId: owned.productionId,
    })).resolves.toMatchObject({ productType: 'avg' })
  }, 30_000)

  it('作者声明只改玩法模块时跨 Build 复用未受影响闭包，并重新执行装配与 QA', async () => {
    const owned = await fixture()
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const imageRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'image')!
    const audioRequirements = owned.brief.capabilityRequirements.filter(item => item.mediaClass === 'music' || item.mediaClass === 'sfx')
    const bindingHash = await hashProductProductionValueV2({ provider: 'existing-global-config' })
    const outputs = modelOutputs(
      owned.brief.source.worldContentHash,
      'avg',
      firstCharacterAnchor(owned.brief),
      owned.brief.intent.playerRole,
    )
    const calls: string[] = []
    const runText: ProductionTextRunnerV1 = async request => {
      const taskKey = Object.keys(outputs).find(key => request.system.includes(`任务=${key}。`)) as keyof typeof outputs
      if (!taskKey) throw new Error('unknown formal model task')
      calls.push(taskKey)
      return {
        output: JSON.stringify(outputs[taskKey]), usage: { inputTokens: 100, outputTokens: 100 },
        bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1,
          requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1,
          provider: 'fixture', model: 'fixture-model', endpointOrigin: 'https://fixture.invalid',
          executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
          capabilityHash: bindingHash, boundAt: 1, receiptHash: 'c'.repeat(64),
        },
      }
    }
    const capabilityBindings = [
      { requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash },
      await createBuiltInProductionCapabilityBindingV1({
        requirementKey: imageRequirement.requirementKey, adapterId: 'storyforge.procedural-svg.v1',
      }),
      ...await Promise.all(audioRequirements.map(requirement => createBuiltInProductionCapabilityBindingV1({
        requirementKey: requirement.requirementKey, adapterId: 'storyforge.procedural-audio.v1',
      }))),
    ]
    const first = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief, runText,
      }), capabilityBindings,
    })
    expect(first.terminal).toBe(true)
    expect(await db.mediaBlobObjects.count()).toBe(6)
    calls.length = 0

    const evolved = await beginProductProductionEvolutionV1({
      scope: owned.scope, productionId: owned.productionId,
      userText: '保持剧情和素材不变，只把交互节奏改成更快速的玩法模块。',
      affectedLanes: ['product'],
    })
    const briefRow = await db.productProductionBriefs
      .where('[productionId+revision]').equals([owned.productionId, evolved.briefRevision]).first()
    const production = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'authorize-start', commandId: 'formal.product-only.authorize',
        expectedStateRevision: production.stateRevision, briefRevision: evolved.briefRevision,
        briefHash: briefRow!.briefHash, authorizationNonce: 'formal.product-only.click',
      },
    })
    const nextBrief = parseProductProductionBriefV3(briefRow!.briefJson)
    expect(nextBrief.evolution).toMatchObject({ affectedLanes: ['product'] })
    expect(nextBrief.intent.openingSituation).toBe(owned.brief.intent.openingSituation)
    const second = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: nextBrief, runText,
      }), capabilityBindings,
    })
    expect(second.terminal).toBe(true)
    expect(calls).toEqual(['content.product-module'])
    const secondBuild = (await db.productBuilds.get(second.buildId))!
    const plan = JSON.parse(secondBuild.planJson) as { tasks: Array<{ taskKey: string; reuse: unknown }> }
    expect(plan.tasks.filter(task => task.reuse != null).map(task => task.taskKey).sort()).toEqual([
      'content.design', 'content.narrative', 'media.audio', 'media.requirements', 'media.visual',
    ])
    const artifacts = await db.productBuildArtifacts.where('buildId').equals(second.buildId).toArray()
    expect(artifacts.filter(item => item.status === 'carried-forward')).toHaveLength(9)
    expect(artifacts.filter(item => item.status === 'accepted').map(item => item.artifactKey).sort()).toEqual([
      'content.product-module', 'quality.report', 'runtime.package',
    ])
    expect(await db.mediaBlobObjects.count()).toBe(6)

    calls.length = 0
    const reassembly = await beginProductProductionEvolutionV1({
      scope: owned.scope, productionId: owned.productionId,
      userText: '保留全部内容与媒资，只用当前编译器重新装配并复验运行包。',
      affectedLanes: ['runtime'],
    })
    const reassemblyBriefRow = await db.productProductionBriefs
      .where('[productionId+revision]').equals([owned.productionId, reassembly.briefRevision]).first()
    const reassemblyProduction = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'authorize-start', commandId: 'formal.runtime-only.authorize',
        expectedStateRevision: reassemblyProduction.stateRevision,
        briefRevision: reassembly.briefRevision, briefHash: reassemblyBriefRow!.briefHash,
        authorizationNonce: 'formal.runtime-only.click',
      },
    })
    const reassembled = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!,
        brief: parseProductProductionBriefV3(reassemblyBriefRow!.briefJson), runText,
      }), capabilityBindings,
    })
    expect(reassembled).toMatchObject({ terminal: true, buildStatus: 'release-ready' })
    expect(calls).toEqual([])
    const reassembledArtifacts = await db.productBuildArtifacts.where('buildId').equals(reassembled.buildId).toArray()
    expect(reassembledArtifacts.filter(item => item.status === 'accepted').map(item => item.artifactKey).sort()).toEqual([
      'quality.report', 'runtime.package',
    ])
  }, 30_000)

  it('来源不足时暂停在独立作者闸门，接受私域补充后才允许专业团队继续生产', async () => {
    const owned = await fixtureForProduct('text-adventure', { visualLevel: 'none' })
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const bindingHash = await hashProductProductionValueV2({ provider: 'source-decision-fixture' })
    const professional = professionalTextAdventurePlanningOutputs(owned.brief)
    const outputs = {
      ...modelOutputs(
        owned.brief.source.worldContentHash, 'text-adventure',
        firstCharacterAnchor(owned.brief), owned.brief.intent.playerRole,
      ),
      ...professional,
      ...professionalTextAdventureSceneScriptOutputs(
        owned.brief, professional, ['潮门广场', '旧仓街', '信号塔'],
      ),
    } as Record<string, unknown>
    outputs['content.source-sufficiency'] = {
      schema: 'storyforge.text-adventure-source-sufficiency-artifact', version: 1,
      decision: 'ready-with-private-additions', adaptationStrategy: 'expand-sparse',
      coverage: [{
        domain: 'characters', status: 'partial', resourceKeys: [],
        rationale: '冻结来源足以支撑主线，但支线需要一个产品私域引路人。',
      }],
      gaps: [{
        key: 'gap.supporting-guide', severity: 'warning',
        description: '缺少承接支线的引路角色。', affectedStages: ['content.cast-bible'],
      }],
      privateAdditions: [{
        key: 'addition.supporting-guide', kind: 'character', title: '雾港引路人',
        rationale: '只存在于本游戏 Build，不写回冻结世界。',
      }],
      authorDecisionRequired: true,
    }
    outputs['media.requirements'] = {
      ...(outputs['media.requirements'] as Record<string, unknown>), visual: [], audio: [],
    }
    const taskCalls: string[] = []
    const runText: ProductionTextRunnerV1 = async request => {
      const taskKey = Object.keys(outputs).find(key => request.system.includes(`任务=${key}。`))
      if (!taskKey) throw new Error(`unknown source-decision task:${request.system}`)
      taskCalls.push(taskKey)
      return {
        output: JSON.stringify(outputs[taskKey]), usage: { inputTokens: 100, outputTokens: 100 },
        bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1,
          requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1,
          provider: 'fixture', model: 'fixture-source-editor', endpointOrigin: 'https://fixture.invalid',
          executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
          capabilityHash: bindingHash, boundAt: 1, receiptHash: 'c'.repeat(64),
        },
      }
    }
    const capabilityBindings = [{
      requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash,
    }]
    const first = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief, runText,
      }),
      capabilityBindings,
    })
    expect(first).toMatchObject({ terminal: false, buildStatus: 'recovery-required' })
    expect(taskCalls).toEqual(['content.source-sufficiency'])
    const blockedBuild = (await db.productBuilds.get(first.buildId))!
    expect(JSON.parse(blockedBuild.failureJson)).toMatchObject({
      taskKey: 'source.author-gate', detail: expect.stringContaining('作者明确接受'),
    })
    expect(await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([first.buildId, 'content.design']).count()).toBe(0)

    const blockedProduction = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'resolve-blocker', commandId: 'source-decision.accept',
        expectedStateRevision: blockedProduction.stateRevision, blockerKey: 'source.author-gate',
        resolution: {
          action: 'accept-product-private-expansion',
          note: '作者查看清单后接受产品私域引路人，不回写 WorldRelease。',
        },
      },
    })
    const completed = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief, runText,
      }),
      capabilityBindings,
    })
    expect(completed).toMatchObject({ terminal: true, buildStatus: 'release-ready' })
    expect(taskCalls.filter(taskKey => taskKey === 'content.source-sufficiency')).toHaveLength(1)
    const decision = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([completed.buildId, 'content.source-decision'])
      .filter(row => row.status === 'accepted').first()
    expect(JSON.parse(decision!.payloadJson)).toMatchObject({
      decision: 'accept-product-private-expansion',
      acceptedPrivateAdditionKeys: ['addition.supporting-guide'],
      authorCommandId: 'source-decision.accept',
    })
  }, 30_000)

  it('60 分钟文字冒险按 Brief 产出足量主线、空间、支线、区域事件并通过内容量硬门', async () => {
    const owned = await fixtureForProduct('text-adventure', {
      scale: 'short-arc', visualLevel: 'none', omitWorldArtifacts: true,
    })
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const bindingHash = await hashProductProductionValueV2({ provider: 'full-length-text-adventure' })
    const outputs = fullLengthTextAdventureOutputs(owned.brief) as Record<string, unknown>
    const sceneScriptSystems: string[] = []
    const sceneScriptContexts: string[] = []
    let productModuleSystem = ''
    let sideQuestSystem = ''
    const dialoguePassSystems: string[] = []
    const dialoguePassContexts: string[] = []
    let qualityReviewSystem = ''
    let qualityReviewContext = ''
    let playtestSystem = ''
    let playtestContext = ''
    let modelCallCount = 0
    const runText: ProductionTextRunnerV1 = async request => {
      modelCallCount += 1
      const taskKey = Object.keys(outputs).find(key => request.system.includes(`任务=${key}。`))
      if (!taskKey) throw new Error(`unknown full-length task:${request.system}`)
      if (taskKey.startsWith('content.scene-script.act-')) {
        sceneScriptSystems.push(request.system)
        sceneScriptContexts.push(request.contextText)
      }
      if (taskKey === 'content.product-module') productModuleSystem = request.system
      if (taskKey === 'content.adventure-side-quests') sideQuestSystem = request.system
      if (taskKey.startsWith('content.dialogue-pass.act-')) {
        dialoguePassSystems.push(request.system)
        dialoguePassContexts.push(request.contextText)
      }
      if (taskKey === 'content.adventure-quality-review') {
        qualityReviewSystem = request.system
        qualityReviewContext = request.contextText
      }
      if (taskKey === 'qa.playtest-strategy') {
        playtestSystem = request.system
        playtestContext = request.contextText
      }
      return {
        output: JSON.stringify(outputs[taskKey]), usage: { inputTokens: 400, outputTokens: 2_000 },
        bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1,
          requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1,
          provider: 'fixture', model: 'fixture-long-form', endpointOrigin: 'https://fixture.invalid',
          executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
          capabilityHash: bindingHash, boundAt: 1, receiptHash: 'e'.repeat(64),
        },
      }
    }
    const projection = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief, runText,
      }),
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash,
      }],
    })
    const projectedBuild = await db.productBuilds.get(projection.buildId)
    expect(
      projection,
      `full-length text-adventure projection:\n${JSON.stringify(projection, null, 2)}\nfailure=${projectedBuild?.failureJson}`,
    ).toMatchObject({ terminal: true, buildStatus: 'release-ready' })
    expect(sceneScriptSystems).toHaveLength(3)
    expect(sceneScriptSystems[0]).toContain('你是第 1 幕的专职分场叙事作者')
    expect(sceneScriptSystems[0]).toContain('"sceneKey":"scene.001","locationTitle":"地点 1-1-1"')
    expect(sceneScriptSystems[0]).toContain('一律不得改写')
    expect(sceneScriptSystems[2]).toContain('"endings":["ending.001","ending.002","ending.003"]')
    expect(sceneScriptContexts).toHaveLength(3)
    expect(sceneScriptContexts[0]).toContain('storyforge.text-adventure-scene-script-inputs')
    expect(sceneScriptContexts[0]).toContain('"taskKey":"content.scene-script.act-1"')
    expect(sceneScriptContexts[0]).not.toContain('storyforge.product-production.artifact-inputs')
    expect(sceneScriptContexts[0]).not.toContain('"key":"scene.012"')
    expect(sideQuestSystem).toContain('地点编号与标题的唯一映射=')
    expect(sideQuestSystem).toContain('"locationOrdinal":1,"locationTitle":"地点 1-1-1"')
    expect(sideQuestSystem).toContain('不得伪装成尚未实现的跨地点多阶段任务')
    expect(dialoguePassSystems).toHaveLength(3)
    expect(dialoguePassSystems[0]).toContain('独立对白编辑，不是分场作者')
    expect(dialoguePassSystems[0]).toContain('每个 dialogue beat 和 choice 必须恰好审校一次')
    expect(dialoguePassContexts).toHaveLength(3)
    const firstActDialogueContext = dialoguePassContexts.find(context => (
      context.includes('"taskKey":"content.dialogue-pass.act-1"')
    ))!
    expect(firstActDialogueContext).toContain('storyforge.text-adventure-dialogue-inputs')
    expect(firstActDialogueContext).not.toContain('storyforge.product-production.artifact-inputs')
    expect(productModuleSystem).toContain('clock 表示开局后累计经过的分钟数')
    expect(productModuleSystem).toContain('initial 和 minimum 必须同时为 0')
    expect(qualityReviewSystem).toContain('只能是 JSON number 1、2、3、4 或 5')
    expect(qualityReviewSystem).toContain('禁止小数、字符串、"4/5"、"4分"、null')
    expect(qualityReviewContext).toContain('storyforge.text-adventure-quality-inputs')
    expect(qualityReviewContext).toContain('"storyBible"')
    expect(qualityReviewContext).toContain('"cast"')
    expect(qualityReviewContext).toContain('"arcPlan"')
    expect(qualityReviewContext).toContain('"mainQuestPlan"')
    expect(qualityReviewContext).toContain('"dialoguePasses"')
    expect(qualityReviewContext).toContain('"targetCharacterKey"')
    expect(qualityReviewContext).toContain('"artifactKey":"content.narrative"')
    expect(qualityReviewContext).toContain('"openingBeat"')
    expect(qualityReviewContext).toContain('"key":"choice.001"')
    expect(qualityReviewContext).toMatch(/"label":"[^"]+"/)
    expect(qualityReviewContext).toContain('"title":"攻击","role":"stat","initial":3')
    expect(qualityReviewContext).toContain('"timeCostMinutes":')
    expect(qualityReviewContext).not.toContain('该上下文源已按预算截断')
    expect(playtestSystem).toContain('独立 Playtest Director')
    expect(playtestSystem).toContain('不重不漏各覆盖一次上述 15 种 kind')
    expect(playtestContext).toContain('storyforge.text-adventure-playtest-inputs')
    expect(playtestContext).toContain('"deterministicEvidence":["quality.autoplay","quality.report"]')
    expect(playtestContext).not.toContain('storyforge.product-production.artifact-inputs')
    const build = (await db.productBuilds.get(projection.buildId))!
    const quality = JSON.parse(build.qualityReportJson) as {
      hardGateResults: Array<{ gateId: string; passed: boolean; evidence: string[] }>
    }
    expect(quality.hardGateResults).toContainEqual(expect.objectContaining({
      gateId: 'product.adventure.content-volume', passed: true,
    }))
    const autoplayArtifact = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([build.id!, 'quality.autoplay']).first()
    expect(autoplayArtifact).toMatchObject({ status: 'accepted', kind: 'playtest-report' })
    expect(JSON.parse(autoplayArtifact!.payloadJson)).toMatchObject({
      schema: 'storyforge.text-adventure-autoplay-report', passed: true,
      cases: expect.arrayContaining([
        expect.objectContaining({ kind: 'golden-route', passed: true }),
        expect.objectContaining({ kind: 'ending-coverage', passed: true }),
        expect.objectContaining({ kind: 'failure-forward', passed: true }),
        expect.objectContaining({ kind: 'state-roundtrip', passed: true }),
      ]),
    })
    const playtestArtifact = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([build.id!, 'quality.playtest-plan']).first()
    expect(playtestArtifact).toMatchObject({ status: 'accepted', kind: 'playtest-report' })
    expect(JSON.parse(playtestArtifact!.payloadJson)).toMatchObject({
      buildNumber: build.buildNumber,
      recommendation: 'eligible-for-human-validation',
      routeCases: expect.arrayContaining([
        expect.objectContaining({ kind: 'export-import', executionMode: 'real-browser', required: true }),
      ]),
    })
    const runtimeArtifact = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([build.id!, 'runtime.package']).first()
    const runtimePackage = parseProductRuntimePackageV1(runtimeArtifact!.payloadJson)
    expect(runtimePackage.adventure?.version).toBe(2)
    if (runtimePackage.adventure?.version !== 2) throw new Error('60 分钟夹具没有进入 AdventureContentV2')
    expect(runtimePackage.adventure.regions).toHaveLength(2)
    expect(runtimePackage.adventure.areas).toHaveLength(4)
    expect(runtimePackage.adventure.locations).toHaveLength(8)
    expect(runtimePackage.adventure.scenes).toHaveLength(12)
    const locationIndexByKey = new Map(runtimePackage.adventure.locations.map((location, index) => [location.key, index]))
    expect(runtimePackage.adventure.scenes.map(scene => locationIndexByKey.get(scene.locationKey))).toEqual([
      0, 0, 1, 2, 2, 3, 4, 4, 5, 6, 6, 7,
    ])
    expect(runtimePackage.adventure.quests.filter(item => item.category === 'side')).toHaveLength(3)
    expect(runtimePackage.adventure.quests.filter(item => item.category === 'side')
      .every(item => item.initialStatus === 'available')).toBe(true)
    expect(runtimePackage.adventure.actions.filter(item => item.key.startsWith('action.accept.side.'))).toHaveLength(3)
    expect(runtimePackage.adventure.actions.filter(item => item.key.startsWith('action.side.'))
      .every(item => item.label.startsWith('执行：'))).toBe(true)
    expect(runtimePackage.adventure.actions.filter(item => item.key.startsWith('action.ambient.'))
      .every(item => item.label.startsWith('处理：'))).toBe(true)
    expect(runtimePackage.adventure.actions.some(item => item.key.startsWith('action.travel.'))).toBe(false)
    expect(runtimePackage.adventure.storylets).toHaveLength(7)
    expect(runtimePackage.adventure.endings).toHaveLength(3)
    const mainQuest = runtimePackage.adventure.quests.find(item => item.category === 'main')!
    expect(mainQuest.stages).toHaveLength(3)
    expect(mainQuest.objectives).toHaveLength(8)
    expect(mainQuest.objectives.filter(item => item.alternativeActionKeys.length >= 2)).toHaveLength(2)
    expect(runtimePackage.interaction?.profiles).toHaveLength(2)
    expect(runtimePackage.adventure.actions.filter(item => item.kind === 'talk').length).toBeGreaterThanOrEqual(2)
    expect(runtimePackage.adventure.actions.find(item => item.key === 'action.main.alternative.1.1')).toMatchObject({
      rule: { kind: 'random', abilityKey: 'ability.perception', difficulty: 10, costlySuccessFloor: 6 },
      successText: expect.stringContaining('主线获得清晰进展'),
    })
    expect(runtimePackage.adventure.items).toContainEqual(expect.objectContaining({
      key: 'item.product.field-notes', tags: expect.arrayContaining(['product-private']),
    }))
    expect(runtimePackage.adventure.actions).toContainEqual(expect.objectContaining({
      key: 'action.take.product.field-notes', kind: 'take', locationKey: runtimePackage.adventure.initialLocationKey,
    }))
    const preview = await startProductProductionPreviewV1({
      scope: owned.scope, productionId: owned.productionId,
    })
    const previewState = await readProductRuntimeState(preview.sessionId)
    const initialCandidates = availableAdventureActions(
      runtimePackage.adventure, previewState.adventure!,
      adventureNarrativeActionContext({ currentNodeKey: runtimePackage.narrative.entryNodeKey, variables: {} }),
    )
    expect(initialCandidates.filter(item => item.available && item.action.narrativeChoiceKey)).toHaveLength(0)
    const firstObjectiveAction = initialCandidates.find(item => (
      item.available && item.action.key.startsWith('action.main.') && item.action.kind !== 'talk'
    ))!
    const objectiveBase = await readProductRuntimeStateVersion(preview.sessionId)
    await commitAdventureAction({
      sessionId: preview.sessionId, actionKey: firstObjectiveAction.action.key,
      commandId: 'text-adventure:complete-first-main-objective',
      baseSequence: objectiveBase.sequence, baseStateHash: objectiveBase.stateHash,
    })
    const afterObjective = await readProductRuntimeState(preview.sessionId)
    const entryActions = availableAdventureActions(
      runtimePackage.adventure, afterObjective.adventure!,
      adventureNarrativeActionContext({ currentNodeKey: runtimePackage.narrative.entryNodeKey, variables: {} }),
    ).filter(item => item.available && item.action.narrativeChoiceKey).map(item => item.action.narrativeChoiceKey)
    expect(entryActions).toEqual(runtimePackage.narrative.choices.filter(choice => (
      choice.sourceNodeKey === runtimePackage.narrative.entryNodeKey
    )).map(choice => choice.choiceKey))
    const entrySideQuest = runtimePackage.adventure.quests.find(item => (
      item.category === 'side'
      && runtimePackage.adventure!.actions.find(action => action.key === `action.accept.side.${item.key.split('.').at(-1)}`)
        ?.locationKey === runtimePackage.adventure!.initialLocationKey
    ))!
    const entryAcceptAction = `action.accept.side.${entrySideQuest.key.split('.').at(-1)}`
    expect(availableAdventureActions(
      runtimePackage.adventure, previewState.adventure!,
      adventureNarrativeActionContext({ currentNodeKey: runtimePackage.narrative.entryNodeKey, variables: {} }),
    ).find(item => item.action.key === entryAcceptAction)?.available).toBe(true)
    const acceptBase = await readProductRuntimeStateVersion(preview.sessionId)
    await commitAdventureAction({
      sessionId: preview.sessionId, actionKey: entryAcceptAction,
      commandId: 'text-adventure:accept-side-quest',
      baseSequence: acceptBase.sequence,
      baseStateHash: acceptBase.stateHash,
    })
    expect((await readProductRuntimeState(preview.sessionId)).adventure?.quests
      .find(item => item.questKey === entrySideQuest.key)?.status).toBe('active')

    const mainRoute = await startProductProductionPreviewV1({
      scope: owned.scope, productionId: owned.productionId,
    })
    for (let turn = 0; turn < 50; turn += 1) {
      const state = await readProductRuntimeState(mainRoute.sessionId)
      if (state.narrative?.completed) break
      const currentNodeKey = state.narrative?.currentNodeKey
      if (!currentNodeKey || !state.adventure) throw new Error('文字冒险主路线缺少当前节点或玩法状态')
      const available = availableAdventureActions(
        runtimePackage.adventure, state.adventure,
        adventureNarrativeActionContext({ currentNodeKey, variables: state.narrative?.variables ?? {} }),
      ).filter(item => item.available)
      const objectiveAction = available.find(item => (
        item.action.key.startsWith('action.main.') && item.action.kind !== 'talk'
      ))
      if (objectiveAction) {
        const base = await readProductRuntimeStateVersion(mainRoute.sessionId)
        await commitAdventureAction({
          sessionId: mainRoute.sessionId, actionKey: objectiveAction.action.key,
          commandId: `text-adventure:main-route:objective:${turn}`,
          baseSequence: base.sequence, baseStateHash: base.stateHash,
        })
        continue
      }
      const narrativeAction = available.find(item => item.action.narrativeChoiceKey)
      if (!narrativeAction?.action.narrativeChoiceKey) {
        throw new Error(`文字冒险主路线在 ${currentNodeKey} 没有合法主线行动`)
      }
      await commitAdventureNarrativeChoice({
        sessionId: mainRoute.sessionId,
        choiceKey: narrativeAction.action.narrativeChoiceKey,
        commandId: `text-adventure:main-route:choice:${turn}`,
      })
    }
    const completedMainRoute = await readProductRuntimeState(mainRoute.sessionId)
    expect(completedMainRoute.narrative).toMatchObject({ completed: true })
    expect(completedMainRoute.adventure?.quests.find(item => item.questKey === mainQuest.key)?.status).toBe('completed')
    expect(completedMainRoute.adventure?.quests.find(item => item.questKey === mainQuest.key)?.objectives
      .every(objective => objective.completed)).toBe(true)
    const equipActions = runtimePackage.adventure.actions.filter(action => action.key.startsWith('action.equip.'))
    const entrySceneActionKeys = new Set(runtimePackage.adventure.scenes
      .filter(scene => scene.locationKey === runtimePackage.adventure!.initialLocationKey)
      .flatMap(scene => scene.actionKeys))
    expect(equipActions).toHaveLength(2)
    expect(equipActions.every(action => action.locationKey === runtimePackage.adventure!.initialLocationKey)).toBe(true)
    expect(equipActions.every(action => entrySceneActionKeys.has(action.key))).toBe(true)

    await db.productBuildArtifacts.update(runtimeArtifact!.id!, { status: 'invalid' })
    await db.productBuildArtifacts.add({
      ...runtimeArtifact!, id: undefined, version: runtimeArtifact!.version + 1,
      status: 'accepted', createdAt: Date.now(), updatedAt: Date.now(),
    })
    const modelCallCountBeforeReassembly = modelCallCount
    const reassembly = await beginProductProductionEvolutionV1({
      scope: owned.scope, productionId: owned.productionId,
      userText: '保留全部文字冒险内容与媒资，只重新装配和复验运行包。',
      affectedLanes: ['runtime'],
    })
    const reassemblyBriefRow = await db.productProductionBriefs
      .where('[productionId+revision]').equals([owned.productionId, reassembly.briefRevision]).first()
    const reassemblyProduction = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'authorize-start', commandId: 'text-adventure.runtime-only.authorize',
        expectedStateRevision: reassemblyProduction.stateRevision,
        briefRevision: reassembly.briefRevision, briefHash: reassemblyBriefRow!.briefHash,
        authorizationNonce: 'text-adventure.runtime-only.click',
      },
    })
    const reassembled = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!,
        brief: parseProductProductionBriefV3(reassemblyBriefRow!.briefJson), runText,
      }), capabilityBindings: [{
        requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash,
      }],
    })
    expect(reassembled).toMatchObject({ terminal: true, buildStatus: 'release-ready' })
    expect(modelCallCount).toBe(modelCallCountBeforeReassembly + 1)
    const reassemblyArtifacts = await db.productBuildArtifacts.where('buildId').equals(reassembled.buildId).toArray()
    expect(reassemblyArtifacts.filter(item => item.status === 'accepted').map(item => item.artifactKey).sort()).toEqual([
      'content.narrative', 'quality.autoplay', 'quality.playtest-plan', 'quality.report', 'runtime.package',
    ])
  }, 30_000)

  it('保留独立叙事审查证据，并在存在阻塞问题时拒绝装配可玩包', async () => {
    const owned = await fixtureForProduct('text-adventure', { visualLevel: 'none' })
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const bindingHash = await hashProductProductionValueV2({ provider: 'blocking-quality-review' })
    const outputs = modelOutputs(
      owned.brief.source.worldContentHash, 'text-adventure', firstCharacterAnchor(owned.brief),
      owned.brief.intent.playerRole,
    ) as Record<string, unknown>
    const professional = professionalTextAdventurePlanningOutputs(owned.brief)
    Object.assign(
      outputs,
      professional,
      professionalTextAdventureSceneScriptOutputs(
        owned.brief,
        professional,
        ['潮门广场', '旧仓街', '信号塔'],
      ),
    )
    outputs['media.requirements'] = {
      ...(outputs['media.requirements'] as Record<string, unknown>), visual: [], audio: [],
    }
    outputs['content.adventure-quality-review'] = {
      schema: 'storyforge.text-adventure-quality-review-artifact', version: 1,
      scores: {
        causality: 2, playerAgency: 4, routeDifferentiation: 4, pacing: 4,
        setupPayoff: 4, characterMotivation: 4, emotionalImpact: 4,
      },
      issues: [{
        severity: 'blocking', artifactKey: 'content.narrative',
        detail: '主要转折缺少因果铺垫。', recommendation: '补充前置场景与可见状态回响。',
      }, {
        severity: 'blocking', artifactKey: 'content.adventure-side-quests',
        detail: '一条支线钩子与冻结地点错位。', recommendation: '保持稳定 key 并重写错位钩子。',
      }],
      passed: false,
    }
    const taskCalls = new Map<string, number>()
    const repairedSceneContexts: string[] = []
    const repairedSceneSystems: string[] = []
    let failFirstRepairEpoch = true
    const runText: ProductionTextRunnerV1 = async request => {
      const taskKey = Object.keys(outputs).find(key => request.system.includes(`任务=${key}。`))
      if (!taskKey) throw new Error(`unknown blocking-review task:${request.system}`)
      taskCalls.set(taskKey, (taskCalls.get(taskKey) ?? 0) + 1)
      if (taskKey === 'content.scene-script.act-1' && (taskCalls.get(taskKey) ?? 0) >= 2) {
        repairedSceneContexts.push(request.contextText)
        repairedSceneSystems.push(request.system)
        if (failFirstRepairEpoch) throw new Error('fixture repair provider timeout')
      }
      return {
        output: JSON.stringify(outputs[taskKey]), usage: { inputTokens: 100, outputTokens: 100 },
        bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1,
          requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1,
          provider: 'fixture', model: 'fixture-reviewer', endpointOrigin: 'https://fixture.invalid',
          executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
          capabilityHash: bindingHash, boundAt: 1, receiptHash: 'f'.repeat(64),
        },
      }
    }
    const projection = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief, runText,
      }),
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash,
      }],
    })
    expect(projection).toMatchObject({ terminal: false, buildStatus: 'recovery-required' })
    const build = (await db.productBuilds.get(projection.buildId))!
    expect(build.failureJson).toContain('文字冒险叙事质量审查未通过')
    const review = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([build.id!, 'quality.adventure-review']).first()
    expect(review).toMatchObject({ status: 'accepted', kind: 'playtest-report' })
    expect(JSON.parse(review!.payloadJson)).toMatchObject({ passed: false })
    expect(await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([build.id!, 'runtime.package']).count()).toBe(0)

    outputs['content.adventure-quality-review'] = {
      schema: 'storyforge.text-adventure-quality-review-artifact', version: 1,
      scores: {
        causality: 4, playerAgency: 4, routeDifferentiation: 4, pacing: 4,
        setupPayoff: 4, characterMotivation: 4, emotionalImpact: 4,
      },
      issues: [], passed: true,
    }
    const production = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'resolve-blocker', commandId: 'text-adventure.quality-repair.retry',
        expectedStateRevision: production.stateRevision, blockerKey: 'integration.package',
        resolution: { action: 'retry', note: '修复质量审查上下文后重新审查并重建下游' },
      },
    })
    const repairingBuild = (await db.productBuilds.get(build.id!))!
    expect(JSON.parse(repairingBuild.failureJson)).toMatchObject({
      previousFailure: {
        taskKey: 'integration.package', detail: expect.stringContaining('文字冒险叙事质量审查未通过'),
      },
    })
    const interruptedRepair = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief, runText,
      }),
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash,
      }],
    })
    expect(interruptedRepair).toMatchObject({ terminal: false, buildStatus: 'recovery-required' })
    const interruptedBuild = (await db.productBuilds.get(build.id!))!
    expect(JSON.parse(interruptedBuild.failureJson)).toMatchObject({
      taskKey: 'content.scene-script.act-1',
      repairCause: {
        taskKey: 'integration.package', detail: expect.stringContaining('文字冒险叙事质量审查未通过'),
      },
    })
    failFirstRepairEpoch = false
    const interruptedProduction = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'resolve-blocker', commandId: 'text-adventure.quality-repair.retry-after-timeout',
        expectedStateRevision: interruptedProduction.stateRevision, blockerKey: 'content.scene-script.act-1',
        resolution: { action: 'retry', note: '保留原质量反馈并重试超时的主线修复' },
      },
    })
    const repaired = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief, runText,
      }),
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash,
      }],
    })
    expect(repaired).toMatchObject({ terminal: true, buildStatus: 'release-ready' })
    const expectedCalls = new Map([
      ['content.source-sufficiency', 1], ['content.design', 1], ['content.story-bible', 1],
      ['content.cast-bible', 1], ['content.adventure-architecture', 1],
      ['content.narrative-arc-plan', 1], ['content.main-quest-plan', 1],
      ['content.scene-script.act-1', 4], ['content.scene-script.act-2', 2], ['content.scene-script.act-3', 2],
      ['content.dialogue-pass.act-1', 2], ['content.dialogue-pass.act-2', 2],
      ['content.dialogue-pass.act-3', 2],
      ['content.product-module', 1], ['content.adventure-side-quests', 2], ['content.quest-script', 2],
      ['content.adventure-ambient-events', 1], ['content.adventure-quality-review', 2],
      ['media.requirements', 2], ['qa.playtest-strategy', 1],
    ])
    expect(taskCalls).toEqual(expectedCalls)
    expect(repairedSceneContexts).toHaveLength(3)
    for (const repairedSceneContext of repairedSceneContexts) {
      expect(repairedSceneContext).toContain('storyforge.text-adventure-repair-feedback')
      expect(repairedSceneContext).toContain('主要转折缺少因果铺垫')
    }
    expect(repairedSceneContexts[1]).toContain('lastTaskFailures')
    expect(repairedSceneContexts[1]).toContain('fixture repair provider timeout')
    expect(repairedSceneContexts[2]).toContain('lastTaskFailures')
    expect(repairedSceneContexts[2]).toContain('fixture repair provider timeout')
    expect(repairedSceneSystems).toHaveLength(3)
    expect(repairedSceneSystems[0]).toContain('detail 是需要消除的缺陷证据，recommendation 只是建议')
    expect(repairedSceneSystems[0]).toContain('优先重写错位的钩子与结果文本')
    const repairedReviewRows = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([build.id!, 'quality.adventure-review']).toArray()
    expect(repairedReviewRows.filter(row => row.status === 'accepted')).toHaveLength(1)
    expect(JSON.parse(repairedReviewRows.find(row => row.status === 'accepted')!.payloadJson))
      .toMatchObject({ passed: true })
    expect(await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([build.id!, 'runtime.package']).count()).toBe(1)
  }, 30_000)

  it('五种现行生产产品经过正式生产、可玩 Build Preview 与同包原子发布', async () => {
    const products: ProductionProductKindV1[] = [
      'character-interaction', 'text-adventure', 'avg', 'text-open-world', 'ttrpg',
    ]
    for (const productType of products) {
      const owned = await fixtureForProduct(productType)
      const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
      expect(owned.brief.capabilityRequirements.filter(item => item.mediaClass !== 'text'))
        .toHaveLength(productType === 'text-adventure' ? 1 : 0)
      const bindingHash = await hashProductProductionValueV2({ provider: 'existing-global-config', productType })
      const baseOutputs = modelOutputs(
        owned.brief.source.worldContentHash,
        productType,
        firstCharacterAnchor(owned.brief),
        owned.brief.intent.playerRole,
      )
      const professional = productType === 'text-adventure'
        ? professionalTextAdventurePlanningOutputs(owned.brief) : null
      const outputs = {
        ...baseOutputs,
        ...(professional ?? {}),
        ...(professional ? professionalTextAdventureSceneScriptOutputs(
          owned.brief,
          professional,
          ['潮门广场', '旧仓街', '信号塔'],
        ) : {}),
      }
      const runText: ProductionTextRunnerV1 = async request => {
        const taskKey = Object.keys(outputs).find(key => request.system.includes(`任务=${key}。`)) as keyof typeof outputs
        if (!taskKey) throw new Error(`unknown ${productType} model task`)
        const output = taskKey === 'media.requirements'
          ? { ...outputs[taskKey], visual: productType === 'text-adventure' ? outputs[taskKey].visual : [], audio: [] }
          : outputs[taskKey]
        return {
          output: JSON.stringify(output), usage: { inputTokens: 100, outputTokens: 100 },
          bindingReceipt: {
            schema: 'storyforge.provider-binding-receipt', version: 1,
            requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1,
            provider: 'fixture', model: 'fixture-model', endpointOrigin: 'https://fixture.invalid',
            executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
            capabilityHash: bindingHash, boundAt: 1, receiptHash: 'd'.repeat(64),
          },
        }
      }
      const projection = await runProductProductionUntilBlockedV1({
        scope: owned.scope, productionId: owned.productionId,
        executor: createConfiguredProductProductionExecutorV1({
          production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief, runText,
        }),
        capabilityBindings: [
          {
            requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash,
          },
          ...(productType === 'text-adventure' ? [await createBuiltInProductionCapabilityBindingV1({
            requirementKey: owned.brief.capabilityRequirements.find(item => item.mediaClass === 'image')!.requirementKey,
            adapterId: 'storyforge.procedural-svg.v1',
          })] : []),
        ],
      })
      const projectedBuild = await db.productBuilds.get(projection.buildId)
      expect(
        projection,
        `${productType} production projection:\n${JSON.stringify(projection, null, 2)}\nfailure=${projectedBuild?.failureJson}`,
      ).toMatchObject({ terminal: true, buildStatus: 'release-ready' })
      const build = projectedBuild!
      const packageArtifact = await db.productBuildArtifacts
        .where('[buildId+artifactKey]').equals([build.id!, 'runtime.package']).first()
      const runtimePackage = parseProductRuntimePackageV1(packageArtifact!.payloadJson)
      expect(runtimePackage.productType).toBe(productType)
      expect(runtimePackage.sourceWorld.selection).toEqual(owned.brief.source.selection)
      if (productType === 'text-adventure') {
        expect(runtimePackage.adventure?.version).toBe(2)
        expect(runtimePackage.presentation?.assets).toHaveLength(2)
        expect(runtimePackage.adventure?.media.assetKeys).toEqual(
          runtimePackage.presentation?.assets.map(asset => asset.assetKey),
        )
        expect(runtimePackage.narrative.choices.some(choice => (
          choice.tags.some(tag => tag.startsWith('adventure-action:'))
        ))).toBe(true)
        const reviewArtifacts = await listProductProductionReviewArtifactsV1({
          scope: owned.scope,
          buildId: build.id!,
        })
        expect(reviewArtifacts.map(artifact => artifact.artifactKey)).toEqual(expect.arrayContaining([
          'content.adventure-architecture', 'content.narrative', 'content.product-module',
          'content.adventure-side-quests', 'content.adventure-ambient-events', 'content.quest-script',
          'quality.adventure-review', 'media.requirements',
          'runtime.package', 'quality.report',
        ]))
        expect(reviewArtifacts.every(artifact => artifact.payload != null && artifact.contentHash.length === 64)).toBe(true)
      }
      if (productType === 'ttrpg') {
        expect(runtimePackage.ttrpg).toMatchObject({
          rulePack: { contentHash: owned.brief.ttrpg?.rules.effectiveContentHash },
          campaign: { tags: expect.arrayContaining(['production-campaign-v2']) },
        })
        expect(await db.productBuildArtifacts
          .where('[buildId+artifactKey]').equals([build.id!, 'ttrpg.rule-pack']).count()).toBe(1)
        expect(await db.productBuildArtifacts
          .where('[buildId+artifactKey]').equals([build.id!, 'ttrpg.campaign-pack']).count()).toBe(1)
      }
      const preview = await startProductProductionPreviewV1({
        scope: owned.scope, productionId: owned.productionId,
      })
      expect(preview.productType).toBe(productType)
      expect(await db.productRuntimeSessions.get(preview.sessionId)).toMatchObject({
        productBuildId: build.id, productReleaseId: null, runtimeSourceHash: build.packageHash,
      })
      if (productType === 'ttrpg') {
        const beforeSessionZero = await readProductRuntimeState(preview.sessionId)
        const beforeVersion = await readProductRuntimeStateVersion(preview.sessionId)
        await db.productBuilds.update(build.id!, { previewHash: 'f'.repeat(64) })
        await expect(completeTtrpgSessionZero({
          sessionId: preview.sessionId,
          commandId: 'six.ttrpg.preview.tampered',
          baseSequence: beforeVersion.sequence,
          baseStateHash: beforeVersion.stateHash,
          acceptedItemKeys: beforeSessionZero.ttrpg!.product!.sessionZero.requiredItemKeys,
          completedBy: 'gm',
        })).rejects.toThrow(/Preview|运行源|hash/)
        await db.productBuilds.update(build.id!, { previewHash: build.previewHash })
        const initialParticipants = await readTtrpgSessionParticipantsV2(preview.sessionId)
        for (const participant of initialParticipants) {
          await configureTtrpgSessionParticipantV2({
            sessionId: preview.sessionId,
            seatKey: participant.seatKey,
            expectedRevision: participant.revision,
            commandId: `six.ttrpg.preview.disclose.${participant.seatKey}`,
            requestedByViewerKey: 'viewer.gm',
            consent: { aiIdentityDisclosed: true },
          })
        }
        const sessionZero = await completeTtrpgSessionZero({
          sessionId: preview.sessionId,
          commandId: 'six.ttrpg.preview.session-zero',
          baseSequence: beforeVersion.sequence,
          baseStateHash: beforeVersion.stateHash,
          acceptedItemKeys: beforeSessionZero.ttrpg!.product!.sessionZero.requiredItemKeys,
          completedBy: 'gm',
        })
        expect(sessionZero.type).toBe('ttrpg.session-zero.completed')

        let state = await readProductRuntimeState(preview.sessionId)
        let version = await readProductRuntimeStateVersion(preview.sessionId)
        const openedScene = await openTtrpgCampaignScene({
          sessionId: preview.sessionId,
          commandId: 'six.ttrpg.preview.opening',
          baseSequence: version.sequence,
          baseStateHash: version.stateHash,
          sceneKey: state.ttrpg!.product!.openingSceneKey,
        })
        expect(openedScene.type).toBe('ttrpg.scene.opened')
        state = await readProductRuntimeState(preview.sessionId)
        version = await readProductRuntimeStateVersion(preview.sessionId)
        const gm = (await readTtrpgSessionParticipantsV2(preview.sessionId))
          .find(participant => participant.role === 'gm')!
        const intent = await submitTtrpgActionIntentV2({
          sessionId: preview.sessionId,
          commandId: 'six.ttrpg.preview.intent',
          baseSequence: version.sequence,
          baseStateHash: version.stateHash,
          intentKey: 'intent.preview.inspect',
          actorKey: state.ttrpg!.activeActorKey!,
          rawInput: '我观察潮门周围是否留下了可疑痕迹。',
          submittedBy: { role: 'gm', viewerKey: gm.viewerKey },
        })
        expect(intent.type).toBe('ttrpg.intent.receipted')
      }
      const published = await publishProductProductionV1({
        scope: owned.scope, productionId: owned.productionId,
      })
      const released = await resolveProductRuntimeSource({
        scope: owned.scope, source: { kind: 'release', productReleaseId: published.receipt.productReleaseId },
      })
      expect(released.packageHash).toBe(build.packageHash)
      expect(released.runtimePackage).toEqual(runtimePackage)
      released.mediaResolver.dispose()
    }
  }, 60_000)
})
