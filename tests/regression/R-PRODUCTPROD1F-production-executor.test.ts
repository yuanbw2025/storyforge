import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { TEXT_ADVENTURE_PRODUCTION_AGENT_IDS } from '../../src/lib/agent/skill-registry'
import { prepareProductProductionAdoption } from '../../src/lib/product-production/adoption'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createProductProductionPlanV3 } from '../../src/lib/product-production/plan'
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
  planTextAdventureMainQuestIdentityV1,
  parseProductMediaRequirementsArtifactV2,
  parseProductionModelJsonObjectV1,
  type ProductionTextRunnerV1,
  type ProductionVisionRunnerV1,
} from '../../src/lib/product-production/production-executor'
import { putMediaBlobObject } from '../../src/lib/product-production/media-blob-store'
import { runProductProductionUntilBlockedV1 } from '../../src/lib/product-production/scheduler'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import { adventureNarrativeActionContext, availableAdventureActions } from '../../src/lib/adventure/runtime'
import { commitAdventureAction, commitAdventureNarrativeChoice } from '../../src/lib/adventure/runtime-api'
import { planTextAdventureNarrativeLocationsV1 } from '../../src/lib/adventure/narrative-location-plan'
import {
  textAdventureActSceneKeysV1,
  textAdventureNarrativeSkeletonV1,
  textAdventureSceneScriptPartSceneKeysV1,
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
import type {
  ProductBuildArtifactRecordV1,
  ProductProductionBriefV3,
  ProductionProductKindV1,
} from '../../src/lib/types'
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
  qualityProfile?: 'prototype' | 'commercial-candidate'
  maximumModelCalls?: number
}) {
  const owned = await seedCurrentProductWorld(`formal-${productType}`)
  const release = owned.release
  const suggestions = await suggestProductStartingPoints({ scope: owned.scope, worldReleaseId: release.id! })
  const brief = await draftProductProductionBriefV3({
    scope: owned.scope, worldReleaseId: release.id!, suggestionKey: suggestions.suggestions[0].suggestionKey,
    productType, qualityProfile: options?.qualityProfile ?? 'prototype', scale: options?.scale ?? 'scene',
    visualLevel: options?.visualLevel ?? (productType === 'text-adventure' ? 'key-scenes' : 'none'), audioLevel: 'none',
    playerRole: `扮演 ${productType} 的冻结世界行动者`,
    openingSituation: `从用户确认的雾港潮门入口开始 ${productType} 体验。`,
    requiredFacts: ['冻结世界事实保持一致'], forbiddenChanges: ['不得写回世界正式表'],
    confirmTtrpgDefaultMappings: productType === 'ttrpg',
    textAdventure: productType === 'text-adventure' ? { confirmAll: true } : undefined,
  })
  if (options?.maximumModelCalls != null) brief.productionBudget.maximumModelCalls = options.maximumModelCalls
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

function productionSupervisionOutput() {
  const agents = [...TEXT_ADVENTURE_PRODUCTION_AGENT_IDS]
  const assignments = [
    agents.slice(0, 3),
    agents.slice(3, 8),
    agents.slice(8, 14),
    agents.slice(14, 16),
    agents.slice(16, 17),
    agents.slice(17),
  ]
  const stageKeys = [
    'g1-source-and-direction',
    'g2-architecture-and-quests',
    'g3-scripts-and-dialogue',
    'g4-quality-and-media',
    'g5-assembly-and-automation',
    'g6-human-validation-and-release',
  ] as const
  return {
    schema: 'storyforge.text-adventure-production-supervision-artifact' as const,
    version: 1 as const,
    productionPromise: '以冻结来源、专业分工、确定性状态权威和可验证质量门交付完整文字冒险。',
    stages: stageKeys.map((key, index) => ({
      key,
      objective: `完成 G${index + 1} 的专业工件并冻结可验证交接。`,
      responsibleAgentIds: assignments[index],
      exitCriteria: [`G${index + 1} 所有必需工件有 accepted receipt`],
      stopConditions: [`G${index + 1} 任一协议或质量硬门失败时暂停`],
    })),
    risks: [{
      key: 'risk.source-gap', severity: 'blocking' as const,
      ownerAgentId: 'text-adventure-source-editor', evidence: '来源可能不足以支撑目标时长。',
      mitigation: '先审计来源并通过作者闸门冻结私域补充。',
    }, {
      key: 'risk-content-shortage', severity: 'blocking' as const,
      ownerAgentId: 'text-adventure-scene-writer', evidence: '场景正文可能低于商业候选硬门。',
      mitigation: '按幕预算、内容量检查和有界修复闭环处理。',
    }, {
      key: 'risk-route-causality', severity: 'warning' as const,
      ownerAgentId: 'text-adventure-continuity-editor', evidence: '分支可能汇流后失去持续回响。',
      mitigation: '审查决定、状态效果、后续回响和结局条件。',
    }],
    authorGates: [{
      key: 'gate.source-scope', afterStageKey: 'g1-source-and-direction' as const,
      decision: '确认来源范围和产品私域补充。',
    }, {
      key: 'gate.visual-anchors', afterStageKey: 'g4-quality-and-media' as const,
      decision: '确认主要角色视觉锚点和媒资清单。',
    }, {
      key: 'gate.release', afterStageKey: 'g6-human-validation-and-release' as const,
      decision: '完成真人试玩后由作者确认发布。',
    }],
    nonGoals: ['不写回 WorldRelease', '不实现 AVG 连续舞台演出', '不把专用调查机制放入通用内核'],
  }
}

function questScriptRunOutputs(
  brief: Awaited<ReturnType<typeof fixtureForProduct>>['brief'],
  questScript: {
    schema: 'storyforge.text-adventure-quest-script-artifact'
    version: 2
    mainObjectiveScripts: ReadonlyArray<{ sceneKey: string } & Record<string, unknown>>
    sideQuestScripts: ReadonlyArray<unknown>
    ambientEventScripts: ReadonlyArray<unknown>
  },
) {
  const emptySupplemental = { sideQuestScripts: [], ambientEventScripts: [] }
  return {
    ...Object.fromEntries([0, 1, 2].flatMap(actIndex => {
      const sceneKeys = new Set(textAdventureActSceneKeysV1(brief, actIndex))
      return (['single', 'multi'] as const).map(routeClass => [
        `content.quest-script.main.act-${actIndex + 1}.${routeClass}`,
        {
          schema: questScript.schema,
          version: questScript.version,
          mainObjectiveScripts: questScript.mainObjectiveScripts.filter(script => {
            const alternativeCount = Array.isArray(script.alternatives) ? script.alternatives.length : 0
            return sceneKeys.has(script.sceneKey) && (routeClass === 'multi'
              ? alternativeCount > 1 : alternativeCount <= 1)
          }),
          ...emptySupplemental,
        },
      ])
    })),
    'content.quest-script.supplemental': {
      schema: questScript.schema,
      version: questScript.version,
      mainObjectiveScripts: [],
      sideQuestScripts: questScript.sideQuestScripts,
      ambientEventScripts: questScript.ambientEventScripts,
    },
  }
}

function modelOutputs(
  worldHash: string,
  productType: ProductionProductKindV1 = 'avg',
  characterAnchorRef = 'character:0',
  playerRole = '扮演冻结 Brief 主角',
) {
  return {
    'production.supervision': productionSupervisionOutput(),
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
      schema: 'storyforge.text-adventure-quest-bundle-artifact', version: 2, bundleKind: 'side',
      entries: [{
        key: 'lost-lamp', title: '失落的引航灯', description: '找回被潮水卷走的引航灯。',
        hook: '旧仓街的一名船工请求你在潮门关闭前帮忙。',
        stages: [{
          key: 'trace', title: '追查灯迹', objective: '在旧仓街追查引航灯留下的痕迹',
          locationOrdinal: 2, actionKind: 'inspect', abilityKey: 'ability.perception', difficulty: 10,
          successText: '你在旧仓街木箱夹层找到了引航灯。',
          costlySuccessText: '你在旧仓街找到了灯，但划伤了手臂。',
          failureText: '引航灯被冲出旧仓街，但船工指出了沿岸留下的新痕迹。', timeCostMinutes: 6,
        }, {
          key: 'relight', title: '重新点灯', objective: '在信号塔重新点亮引航灯',
          locationOrdinal: 3, actionKind: 'use', abilityKey: 'ability.resolve', difficulty: 11,
          successText: '你在信号塔重新点亮了引航灯。',
          costlySuccessText: '你在信号塔点亮灯火，却耗尽了备用燃料。',
          failureText: '信号塔的灯芯损坏，但应急反光板仍为船队打开了归路。', timeCostMinutes: 8,
        }],
        rewardExperience: 5, rewardCurrency: 2,
      }],
    },
    'content.adventure-ambient-events': {
      schema: 'storyforge.text-adventure-quest-bundle-artifact', version: 2, bundleKind: 'ambient',
      entries: [{
        key: 'tide-warning', title: '潮汐警告', description: '辨认潮门墙上的水位记号。',
        hook: '潮门广场的海水正漫过旧刻度。', stages: [{
          key: 'read-tide', title: '读取潮汐', objective: '在潮门广场判断安全通过时间', locationOrdinal: 1,
          actionKind: 'inspect', abilityKey: 'ability.perception', difficulty: 8,
          successText: '你在潮门广场准确读出了潮汐变化。',
          costlySuccessText: '你在潮门广场读懂刻度，但浪费了一些时间。',
          failureText: '你在潮门广场判断失误，却因此发现墙后的避险通道。', timeCostMinutes: 5,
        }], rewardExperience: 2, rewardCurrency: 0,
      }, {
        key: 'warehouse-echo', title: '仓街回声', description: '追查仓街深处反复出现的敲击声。',
        hook: '旧仓街的雾里传来规律的三次敲击。', stages: [{
          key: 'follow-echo', title: '追随回声', objective: '在旧仓街确认敲击声来源', locationOrdinal: 2,
          actionKind: 'attempt', abilityKey: 'ability.resolve', difficulty: 9,
          successText: '你在旧仓街发现那是被困船员的求救信号。',
          costlySuccessText: '你在旧仓街救出船员，但耽误了赶往灯塔的时间。',
          failureText: '旧仓街的声音消失了，却留下一张通往灯塔的旧图。', timeCostMinutes: 8,
        }], rewardExperience: 3, rewardCurrency: 1,
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
  const decisionCount = Math.max(
    brief.scale.targetEndingCount - 1,
    brief.qualityProfile === 'commercial-candidate'
      ? Math.max(2, Math.ceil(brief.scale.targetPlayMinutes / 10)) : 1,
  )
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
  const questScript = {
    schema: 'storyforge.text-adventure-quest-script-artifact' as const,
    version: 2 as const,
    mainObjectiveScripts,
    sideQuestScripts: [{
      entryKey: 'lost-lamp', stages: [{
        stageKey: 'trace', actionKind: 'inspect', abilityKey: 'ability.perception',
        difficulty: 10, costlySuccessFloor: 6, timeCostMinutes: 6,
        successText: '你在旧仓街木箱夹层找到了引航灯。',
        costlySuccessText: '你在旧仓街找到引航灯，但手臂受伤。',
        failureForwardText: '灯被冲出旧仓街，但船工指出了沿岸留下的新痕迹。',
      }, {
        stageKey: 'relight', actionKind: 'use', abilityKey: 'ability.resolve',
        difficulty: 11, costlySuccessFloor: 7, timeCostMinutes: 8,
        successText: '你在信号塔重新点亮了引航灯。',
        costlySuccessText: '你在信号塔点亮灯火，却耗尽了备用燃料。',
        failureForwardText: '信号塔的灯芯损坏，但应急反光板仍为船队打开了归路。',
      }],
    }],
    ambientEventScripts: [{
      entryKey: 'tide-warning', stages: [{
        stageKey: 'read-tide', actionKind: 'inspect', abilityKey: 'ability.perception',
        difficulty: 8, costlySuccessFloor: 4, timeCostMinutes: 5,
        successText: '你在潮门广场准确读出了潮汐变化。',
        costlySuccessText: '你在潮门广场读懂刻度，但浪费了一些时间。',
        failureForwardText: '你在潮门广场判断失误，却因此发现墙后的避险通道。',
      }],
    }, {
      entryKey: 'warehouse-echo', stages: [{
        stageKey: 'follow-echo', actionKind: 'attempt', abilityKey: 'ability.resolve',
        difficulty: 9, costlySuccessFloor: 5, timeCostMinutes: 8,
        successText: '你在旧仓街发现那是被困船员的求救信号。',
        costlySuccessText: '你在旧仓街救出船员，但耽误了赶往灯塔的时间。',
        failureForwardText: '旧仓街的声音消失了，却留下一张通往灯塔的旧图。',
      }],
    }],
  }
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
    'content.narrative-arc-scenes': {
      schema: 'storyforge.text-adventure-narrative-arc-scenes-artifact', version: 1,
      acts,
      endings: storyEndings.slice(0, brief.scale.targetEndingCount).map(ending => ({
        endingKey: ending.key, sceneKey: sceneKeys[sceneKeys.length - 1],
      })),
    },
    'content.narrative-decision-plan': {
      schema: 'storyforge.text-adventure-narrative-decision-plan-artifact', version: 1,
      decisions,
    },
    'content.narrative-arc-plan': {
      schema: 'storyforge.text-adventure-narrative-arc-plan-artifact', version: 1,
      acts, decisions,
      endings: storyEndings.slice(0, brief.scale.targetEndingCount).map(ending => ({
        endingKey: ending.key, sceneKey: sceneKeys[sceneKeys.length - 1],
      })),
    },
    'content.main-quest-plan': mainQuestPlan,
    'content.quest-script': questScript,
    ...questScriptRunOutputs(brief, questScript),
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
  const sceneScriptPartOutputs = Object.fromEntries(Object.entries(sceneScriptOutputs).flatMap(([taskKey, bundle]) => {
    const actIndex = Number(taskKey.slice('content.scene-script.act-'.length)) - 1
    return textAdventureSceneScriptPartSceneKeysV1(brief, actIndex).map((sceneKeys, partIndex, parts) => {
      const selected = new Set(sceneKeys)
      return [`${taskKey}.part-${partIndex + 1}`, {
        ...bundle,
        scenes: bundle.scenes.filter(scene => selected.has(scene.sceneKey)),
        choices: bundle.choices.filter(choice => selected.has(choice.sourceNodeKey)),
        endings: partIndex === parts.length - 1 ? bundle.endings : [],
      }]
    })
  }))
  return {
    ...sceneScriptOutputs,
    ...sceneScriptPartOutputs,
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
  const questEntry = (kind: 'side' | 'ambient', index: number) => {
    const firstLocationOrdinal = index % locationTitles.length + 1
    const secondLocationOrdinal = firstLocationOrdinal % locationTitles.length + 1
    const stage = (
      stageIndex: number,
      locationOrdinal: number,
      actionKind: 'inspect' | 'use',
    ) => {
      const locationTitle = locationTitles[locationOrdinal - 1]
      return {
        key: `${kind}-${index + 1}.stage-${stageIndex + 1}`,
        title: `${locationTitle}阶段 ${stageIndex + 1}`,
        objective: `在${locationTitle}完成${kind === 'side' ? '支线' : '区域事件'}阶段 ${stageIndex + 1}`,
        locationOrdinal, actionKind,
        abilityKey: stageIndex % 2 ? 'ability.resolve' : 'ability.perception',
        difficulty: 9 + index + stageIndex,
        successText: `你在${locationTitle}完成行动并改变了局部状态。`,
        costlySuccessText: `你在${locationTitle}达成目标，但付出了明确代价。`,
        failureText: `你在${locationTitle}行动失败，却打开了替代局面并继续推进。`,
        timeCostMinutes: 6 + stageIndex * 2,
      }
    }
    return {
      key: `${kind}-${index + 1}`, title: `${kind === 'side' ? '支线' : '区域事件'} ${index + 1}`,
      description: `${locationTitles[firstLocationOrdinal - 1]}里，与主线主题呼应但拥有独立目标和回响。`,
      hook: '一个可理解的局面邀请玩家介入。',
      stages: kind === 'side'
        ? [stage(0, firstLocationOrdinal, 'inspect'), stage(1, secondLocationOrdinal, 'use')]
        : [stage(0, firstLocationOrdinal, 'inspect')],
      rewardExperience: 3, rewardCurrency: 1,
    }
  }
  const professional = professionalTextAdventurePlanningOutputs(brief)
  const sceneScripts = professionalTextAdventureSceneScriptOutputs(brief, professional, locationTitles)
  const sideEntries = Array.from(
    { length: contract.narrative.targetSideQuestCount }, (_, index) => questEntry('side', index),
  )
  const ambientEntries = Array.from(
    { length: contract.narrative.targetAmbientEventCount }, (_, index) => questEntry('ambient', index),
  )
  const mainPlan = professional['content.main-quest-plan']
  const scriptedSupplemental = (entries: typeof sideEntries) => (
    entries.map(entry => ({
      entryKey: entry.key,
      stages: entry.stages.map(stage => ({
        stageKey: stage.key, actionKind: stage.actionKind, abilityKey: stage.abilityKey,
        difficulty: stage.difficulty, costlySuccessFloor: Math.max(1, stage.difficulty - 4),
        timeCostMinutes: stage.timeCostMinutes,
        successText: stage.successText, costlySuccessText: stage.costlySuccessText,
        failureForwardText: stage.failureText,
      })),
    }))
  )
  const questScript = {
    schema: 'storyforge.text-adventure-quest-script-artifact' as const, version: 2 as const,
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
    sideQuestScripts: scriptedSupplemental(sideEntries),
    ambientEventScripts: scriptedSupplemental(ambientEntries),
  }
  return {
    ...base,
    ...professional,
    ...sceneScripts,
    'content.adventure-architecture': {
      ...base['content.adventure-architecture'],
      regions,
    },
    'content.adventure-side-quests': {
      schema: 'storyforge.text-adventure-quest-bundle-artifact' as const, version: 2 as const, bundleKind: 'side' as const,
      entries: sideEntries,
    },
    'content.adventure-ambient-events': {
      schema: 'storyforge.text-adventure-quest-bundle-artifact' as const, version: 2 as const, bundleKind: 'ambient' as const,
      entries: ambientEntries,
    },
    'content.quest-script': questScript,
    ...questScriptRunOutputs(brief, questScript),
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
  it('按商业时长冻结完整主线阶段与目标槽位，不允许单对象样例替代任务量', () => {
    const brief = {
      qualityProfile: 'commercial-candidate',
      scale: { targetPlayMinutes: 60 },
      textAdventure: {},
    } as ProductProductionBriefV3
    const sceneConstraints = Array.from({ length: 12 }, (_, index) => ({
      sceneKey: `scene.${String(index + 1).padStart(3, '0')}`,
      locationOrdinal: Math.floor(index / 2) + 1,
      nonPlayerCastKeys: index % 3 === 1 ? ['character.npc-01'] : [],
    }))
    const plan = planTextAdventureMainQuestIdentityV1(brief, sceneConstraints)

    expect(plan.stages).toHaveLength(3)
    expect(plan.objectives).toHaveLength(8)
    expect(plan.stages.flatMap(stage => stage.objectiveKeys)).toEqual(
      plan.objectives.map(objective => objective.objectiveKey),
    )
    expect(plan.objectives[0].sceneKey).toBe('scene.001')
    expect(plan.objectives.at(-1)?.sceneKey).toBe('scene.012')
    expect(plan.objectives.filter(objective => objective.alternativeKeys.length === 2)).toHaveLength(2)
    expect(new Set(plan.objectives.flatMap(objective => objective.requiredActionKinds))).toEqual(
      new Set(['talk', 'give', 'use']),
    )

    const legalized = legalizeProductionModelProtocolDefaultsV1(
      'content.main-quest-plan',
      {
        quests: [{
          key: 'invented-main', characterKeys: [],
          stages: plan.stages.map((_, index) => ({
            key: `invented-stage-${index}`, stageKey: `stage-scaffold-${index}`,
            title: `阶段 ${index + 1}`, objectiveKeys: [],
          })),
          objectives: plan.objectives.map((_, index) => ({
            key: `invented-objective-${index}`, stageKey: 'invented-stage',
            title: `目标 ${index + 1}`, narrativePurpose: '推进主线。',
            sceneKeys: ['scene.999'], sceneKey: 'scene.prompt-scaffold',
            locationOrdinal: 99, alternatives: [],
            objectiveKey: 'objective.prompt-scaffold',
            nonPlayerCastKeys: ['character.prompt-scaffold'],
            alternativeKeys: ['alternative.prompt-scaffold'],
            requiredActionKinds: ['talk'],
          })),
        }],
      },
      { questPlanIdentity: plan, questSceneCastPlan: sceneConstraints },
    )
    const quest = (legalized.payload.quests as Array<Record<string, unknown>>)[0]
    expect(quest.key).toBe('quest.main')
    expect((quest.stages as Array<Record<string, unknown>>).map(stage => ({
      stageKey: stage.key, objectiveKeys: stage.objectiveKeys,
    }))).toEqual(plan.stages)
    expect((quest.objectives as Array<Record<string, unknown>>).map(objective => ({
      objectiveKey: objective.key,
      stageKey: objective.stageKey,
      sceneKey: (objective.sceneKeys as string[])[0],
      locationOrdinal: objective.locationOrdinal,
    }))).toEqual(plan.objectives.map(objective => ({
      objectiveKey: objective.objectiveKey,
      stageKey: objective.stageKey,
      sceneKey: objective.sceneKey,
      locationOrdinal: objective.locationOrdinal,
    })))
    expect(quest.stages as Array<Record<string, unknown>>).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ stageKey: expect.anything() })]),
    )
    expect(quest.objectives as Array<Record<string, unknown>>).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ requiredActionKinds: expect.anything() }),
        expect.objectContaining({ nonPlayerCastKeys: expect.anything() }),
        expect.objectContaining({ alternativeKeys: expect.anything() }),
      ]),
    )
    expect(legalized.defaultedFields).toEqual(expect.arrayContaining([
      'quests[0].stages[0].stageKey<-discarded-prompt-scaffold',
      'quests[0].objectives[0].requiredActionKinds<-discarded-prompt-scaffold',
    ]))
  })

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
    const supervision = legalizeProductionModelProtocolDefaultsV1('production.supervision', {
      stages: Array.from({ length: 6 }, (_, index) => ({
        key: `g${index + 1}`, responsibleAgentIds: index === 0 ? ['showrunner'] : [],
      })),
    })
    expect((supervision.payload.stages as Array<{ responsibleAgentIds: string[] }>).flatMap(
      stage => stage.responsibleAgentIds,
    )).toEqual([
      'text-adventure-showrunner', 'text-adventure-source-editor', 'text-adventure-creative-director',
      'text-adventure-story-architect', 'text-adventure-cast-director',
      'text-adventure-space-designer', 'text-adventure-game-designer',
      'text-adventure-narrative-designer', 'text-adventure-main-quest-designer',
      'text-adventure-side-quest-designer', 'text-adventure-storylet-designer',
      'text-adventure-quest-scripter', 'text-adventure-scene-writer',
      'text-adventure-dialogue-editor', 'text-adventure-continuity-editor',
      'text-adventure-art-director', 'text-adventure-visual-qa-director',
      'text-adventure-playtest-director',
    ])
    expect(supervision.defaultedFields).toEqual([
      'stages[0].responsibleAgentIds', 'stages[1].responsibleAgentIds',
      'stages[2].responsibleAgentIds', 'stages[3].responsibleAgentIds',
      'stages[4].responsibleAgentIds', 'stages[5].responsibleAgentIds',
    ])

    const sourceSufficiency = legalizeProductionModelProtocolDefaultsV1(
      'content.source-sufficiency',
      {
        decision: 'ready-with-private-additions',
        authorDecisionRequired: false,
        coverage: [{ domain: 'world-premise', status: 'sufficient', resourceKeys: [], ratione: '来源充分。' }],
        gaps: [
          { key: 'gap.items', severity: 'warning' },
          { key: '缺少视觉锚点', severity: 'warning' },
          { key: 'gap.items', severity: 'warning' },
        ],
        privateAdditions: [
          { key: '补充规则细节', kind: 'rule-detail' },
          { key: 'gap.items', kind: 'item' },
        ],
      },
      { allowedSourceResourceKeys: ['story.world-rules'] },
    )
    expect(sourceSufficiency.payload).toEqual({
      authorDecisionRequired: true,
      decision: 'ready-with-private-additions',
      coverage: [{ domain: 'world-premise', status: 'sufficient', resourceKeys: [], rationale: '来源充分。' }],
      gaps: [
        { key: 'gap.items', severity: 'warning' },
        { key: 'gap.generated.002', severity: 'warning' },
        { key: 'gap.generated.003', severity: 'warning' },
      ],
      privateAdditions: [
        { key: 'private-addition.generated.001', kind: 'rule-detail' },
        { key: 'private-addition.generated.002', kind: 'item' },
      ],
    })
    expect(sourceSufficiency.defaultedFields).toEqual([
      'authorDecisionRequired<-decision',
      'coverage[0].rationale<-ratione',
      'gaps[1].key',
      'gaps[2].key',
      'privateAdditions[0].key',
      'privateAdditions[1].key',
    ])

    const sourceReferences = legalizeProductionModelProtocolDefaultsV1(
      'content.source-sufficiency',
      {
        coverage: [{
          domain: 'space', status: 'partial', rationale: '只接受冻结引用。',
          resourceKeys: [' story.world-rules ', 'world:invented-hash', 42],
        }],
      },
      { allowedSourceResourceKeys: ['story.world-rules'] },
    )
    expect(sourceReferences.payload).toEqual({
      coverage: [{
        domain: 'space', status: 'partial', rationale: '只接受冻结引用。',
        resourceKeys: ['story.world-rules'],
      }],
    })
    expect(sourceReferences.defaultedFields).toEqual([
      'coverage[0].resourceKeys[1]<-discarded-unauthorized',
      'coverage[0].resourceKeys[2]<-discarded-unauthorized',
    ])

    const arcGrouping = legalizeProductionModelProtocolDefaultsV1(
      'content.narrative-arc-scenes',
      {
        metadata: { providerNote: 'not part of the governed artifact' },
        acts: [
          { key: 'act.1', targetMinutes: '20', sceneCards: [{ key: 'scene.001', title: '一', locationOrdinal: '1' }] },
          { key: 'act.2', sceneCards: [{ key: 'scene.003', title: '三' }, { key: 'scene.002', title: '二' }] },
          { key: 'act.3', sceneCards: [{ key: 'scene.004', title: '四' }] },
        ],
      },
      { narrativeArcSceneKeys: [['scene.001', 'scene.002'], ['scene.003'], ['scene.004']] },
    )
    expect((arcGrouping.payload.acts as Array<{ sceneCards: Array<{ key: string }> }>).map(
      act => act.sceneCards.map(card => card.key),
    )).toEqual([['scene.001', 'scene.002'], ['scene.003'], ['scene.004']])
    const legalizedArcActs = arcGrouping.payload.acts as Array<{
      targetMinutes?: unknown
      sceneCards: Array<{ key: string; locationOrdinal?: unknown }>
    }>
    expect(legalizedArcActs[0].targetMinutes).toBe(20)
    expect(legalizedArcActs[0].sceneCards[0].locationOrdinal).toBe(1)
    expect(arcGrouping.payload).not.toHaveProperty('metadata')
    expect(arcGrouping.defaultedFields).toEqual([
      'metadata<-discarded-provider-annotation',
      'acts[0].targetMinutes<-decimal-string',
      'acts[0].sceneCards[0].locationOrdinal<-decimal-string',
      'acts[0].sceneCards<-frozen-scene-key-group',
      'acts[1].sceneCards<-frozen-scene-key-group',
    ])
    const frozenArcLocations = legalizeProductionModelProtocolDefaultsV1(
      'content.narrative-arc-scenes',
      {
        acts: [
          { key: 'act.1', sceneCards: [{ key: 'scene.001', locationOrdinal: 2 }, { key: 'scene.002', locationOrdinal: 2 }] },
          { key: 'act.2', sceneCards: [{ key: 'scene.003', locationOrdinal: 1 }] },
          { key: 'act.3', sceneCards: [{ key: 'scene.004', locationOrdinal: 1 }] },
        ],
      },
      {
        narrativeArcSceneKeys: [['scene.001', 'scene.002'], ['scene.003'], ['scene.004']],
        narrativeArcLocationOrdinals: [1, 1, 2, 2],
        narrativeArcEndingKeys: ['ending.open', 'ending.hidden'],
      },
    )
    expect((frozenArcLocations.payload.acts as Array<{
      sceneCards: Array<{ locationOrdinal: number }>
    }>).flatMap(act => act.sceneCards.map(card => card.locationOrdinal))).toEqual([1, 1, 2, 2])
    expect(frozenArcLocations.defaultedFields).toContain(
      'acts[0].sceneCards[0].locationOrdinal<-frozen-location-plan',
    )
    expect(frozenArcLocations.payload.endings).toEqual([
      { endingKey: 'ending.open', sceneKey: 'scene.004' },
      { endingKey: 'ending.hidden', sceneKey: 'scene.004' },
    ])
    expect(frozenArcLocations.defaultedFields).toContain('endings<-frozen-narrative-skeleton')

    const frozenArcLocationBeforeLaterIdentityFailure = legalizeProductionModelProtocolDefaultsV1(
      'content.narrative-arc-scenes',
      {
        acts: [
          { key: 'act.1', sceneCards: [{ key: 'scene.001', locationOrdinal: 9 }, { key: 'scene.002', locationOrdinal: 9 }] },
          { key: 'act.2', sceneCards: [{ key: 'scene.003', locationOrdinal: 9 }] },
          { key: 'act.3', sceneCards: [{ key: 'scene.wrong', locationOrdinal: 9 }] },
        ],
      },
      {
        narrativeArcSceneKeys: [['scene.001', 'scene.002'], ['scene.003'], ['scene.004']],
        narrativeArcLocationOrdinals: [1, 1, 2, 2],
      },
    )
    expect((frozenArcLocationBeforeLaterIdentityFailure.payload.acts as Array<{
      sceneCards: Array<{ locationOrdinal: number }>
    }>).flatMap(act => act.sceneCards.map(card => card.locationOrdinal))).toEqual([1, 1, 2, 9])
    expect(frozenArcLocationBeforeLaterIdentityFailure.defaultedFields).toContain(
      'acts[1].sceneCards[0].locationOrdinal<-frozen-location-plan',
    )

    const decisionKeys = legalizeProductionModelProtocolDefaultsV1(
      'content.narrative-decision-plan',
      {
        decisions: [{
          key: '第一处抉择', sceneKey: 'scene.wrong', prompt: '是否公开？',
          options: [
            { key: '公开真相', persistentEffectKey: '公开！', label: '公开', cost: '失去庇护' },
            { key: 'option.invalid key', persistentEffectKey: '隐瞒！', label: '隐瞒', cost: '承担秘密' },
          ],
        }],
      },
      {
        narrativeDecisionSceneKeys: ['scene.001'],
        narrativeArcSceneKeys: [['scene.001', 'scene.002'], ['scene.003'], ['scene.004']],
      },
    )
    expect(decisionKeys.payload.decisions).toEqual([{
      key: 'decision.1', sceneKey: 'scene.001', prompt: '是否公开？',
      options: [
        {
          key: 'option.1.1', persistentEffectKey: 'flag.decision.1.1', label: '公开',
          cost: '失去庇护', echoSceneKeys: ['scene.002', 'scene.003'],
        },
        {
          key: 'option.1.2', persistentEffectKey: 'flag.decision.1.2', label: '隐瞒',
          cost: '承担秘密', echoSceneKeys: ['scene.002', 'scene.003'],
        },
      ],
    }])
    expect(decisionKeys.defaultedFields).toEqual([
      'decisions[0].key<-frozen-ordinal',
      'decisions[0].sceneKey<-frozen-scene-plan',
      'decisions[0].options[0].key<-frozen-ordinal',
      'decisions[0].options[0].persistentEffectKey<-frozen-ordinal',
      'decisions[0].options[0].echoSceneKeys<-frozen-later-scenes',
      'decisions[0].options[1].key<-frozen-ordinal',
      'decisions[0].options[1].persistentEffectKey<-frozen-ordinal',
      'decisions[0].options[1].echoSceneKeys<-frozen-later-scenes',
    ])

    const projectedQuestCast = legalizeProductionModelProtocolDefaultsV1(
      'content.main-quest-plan',
      {
        quests: [{
          characterKeys: ['船长', 'character.hallucinated'],
          objectives: [
            { sceneKeys: ['scene.001'] },
            { sceneKeys: ['scene.002'] },
          ],
        }],
      },
      {
        questSceneCastPlan: [
          { sceneKey: 'scene.001', castKeys: ['character.player', 'character.npc.1'] },
          { sceneKey: 'scene.002', castKeys: ['character.player', 'character.npc.2'] },
        ],
        questFallbackCastKeys: ['character.player'],
      },
    )
    expect((projectedQuestCast.payload.quests as Array<{ characterKeys: string[] }>)[0].characterKeys)
      .toEqual(['character.player', 'character.npc.1', 'character.npc.2'])
    expect(projectedQuestCast.defaultedFields).toEqual([
      'quests[0].characterKeys<-scene-cast-projection',
    ])

    const topologicallyOrderedQuest = legalizeProductionModelProtocolDefaultsV1(
      'content.main-quest-plan',
      {
        quests: [{
          stages: [
            { key: 'stage.2', objectiveKeys: ['objective.3'] },
            { key: 'stage.1', objectiveKeys: ['objective.2', 'objective.1'] },
          ],
          objectives: [
            { key: 'objective.1', sceneKeys: ['scene.001'] },
            { key: 'objective.2', sceneKeys: ['scene.002'] },
            { key: 'objective.3', sceneKeys: ['scene.003'] },
          ],
        }],
      },
      {
        questSceneCastPlan: [
          { sceneKey: 'scene.001', castKeys: [] },
          { sceneKey: 'scene.002', castKeys: [] },
          { sceneKey: 'scene.003', castKeys: [] },
        ],
      },
    )
    expect((topologicallyOrderedQuest.payload.quests as Array<{ stages: unknown[] }>)[0].stages)
      .toEqual([
        { key: 'stage.1', objectiveKeys: ['objective.1', 'objective.2'] },
        { key: 'stage.2', objectiveKeys: ['objective.3'] },
      ])
    expect(topologicallyOrderedQuest.defaultedFields).toContain(
      'quests[0].stages<-frozen-scene-topology',
    )

    const frozenQuestScriptIdentities = legalizeProductionModelProtocolDefaultsV1(
      'content.quest-script',
      {
        mainObjectiveScripts: [{
          objectiveKey: 'invented-objective', sceneKey: 'invented-scene',
          alternatives: [{
            alternativeKey: 'invented-alternative',
            resolution: {
              mode: 'automatic', abilityKey: 'ability.invented', difficulty: '31', costlySuccessFloor: '30',
            },
            timeCostMinutes: '4.6',
            successText: '无需检定即可完成。', costlySuccessText: '', failureForwardText: '   ',
          }, {
            alternativeKey: 'invented-alternative-2',
            resolution: {
              mode: 'check', abilityKey: 'ability.insight', difficulty: '31', costlySuccessFloor: '30',
            },
            timeCostMinutes: 0,
          }, {
            alternativeKey: 'surplus-alternative',
            resolution: { mode: 'automatic' }, timeCostMinutes: 5,
          }],
        }, {
          objectiveKey: 'surplus-objective', sceneKey: 'surplus-scene', alternatives: [],
        }],
        sideQuestScripts: [{
          entryKey: 'invented-side', stages: [{
            stageKey: 'invented-side-stage', actionKind: 'inspect', abilityKey: 'invented-ability',
            difficulty: '31', costlySuccessFloor: '30', timeCostMinutes: '8.4',
          }, {
            stageKey: 'invented-side-stage-2', actionKind: 'use', abilityKey: 'invented-ability',
            difficulty: 1, costlySuccessFloor: 0, timeCostMinutes: 121,
          }, {
            stageKey: 'surplus-side-stage', actionKind: 'inspect', abilityKey: 'ability.insight',
          }],
        }, { entryKey: 'surplus-side', stages: [] }],
        ambientEventScripts: [{
          entryKey: 'invented-ambient', stages: [{
            stageKey: 'invented-ambient-stage', actionKind: 'inspect', abilityKey: 'invented-ability',
            difficulty: 1, costlySuccessFloor: 0, timeCostMinutes: 121,
          }],
        }, { entryKey: 'surplus-ambient', stages: [] }],
      },
      {
        questScriptIdentityPlan: {
          mainObjectiveScripts: [{
            objectiveKey: 'objective.1', sceneKey: 'scene.001',
            alternativeKeys: ['alternative.1', 'alternative.2'],
          }],
          sideQuestScripts: [{
            entryKey: 'side.1', stages: [{
              stageKey: 'side.1.stage.1', actionKind: 'use', abilityKey: 'ability.insight',
              difficulty: 14, costlySuccessFloor: 10, timeCostMinutes: 7,
            }, {
              stageKey: 'side.1.stage.2', actionKind: 'inspect', abilityKey: 'ability.agility',
              difficulty: 16, costlySuccessFloor: 12, timeCostMinutes: 9,
            }],
          }],
          ambientEventScripts: [{
            entryKey: 'ambient.1', stages: [{
              stageKey: 'ambient.1.stage.1', actionKind: 'quest-action', abilityKey: 'ability.agility',
              difficulty: 8, costlySuccessFloor: 4, timeCostMinutes: 5,
            }],
          }],
        },
      },
    )
    expect(frozenQuestScriptIdentities.payload).toMatchObject({
      mainObjectiveScripts: [{
        objectiveKey: 'objective.1', sceneKey: 'scene.001',
        alternatives: [{
          alternativeKey: 'alternative.1',
          resolution: { mode: 'automatic', abilityKey: null, difficulty: null, costlySuccessFloor: null },
          timeCostMinutes: 5,
          successText: '无需检定即可完成。',
          costlySuccessText: '无需检定即可完成。',
          failureForwardText: '无需检定即可完成。',
        }, {
          alternativeKey: 'alternative.2',
          resolution: {
            mode: 'check', abilityKey: 'ability.insight', difficulty: 30, costlySuccessFloor: 29,
          },
          timeCostMinutes: 1,
        }],
      }],
      sideQuestScripts: [{
        entryKey: 'side.1', stages: [{
          stageKey: 'side.1.stage.1', actionKind: 'use', abilityKey: 'ability.insight',
          difficulty: 14, costlySuccessFloor: 10, timeCostMinutes: 7,
        }, {
          stageKey: 'side.1.stage.2', actionKind: 'inspect', abilityKey: 'ability.agility',
          difficulty: 16, costlySuccessFloor: 12, timeCostMinutes: 9,
        }],
      }],
      ambientEventScripts: [{
        entryKey: 'ambient.1', stages: [{
          stageKey: 'ambient.1.stage.1', actionKind: 'quest-action', abilityKey: 'ability.agility',
          difficulty: 8, costlySuccessFloor: 4, timeCostMinutes: 5,
        }],
      }],
    })
    expect(frozenQuestScriptIdentities.defaultedFields.length).toBeGreaterThanOrEqual(35)
    expect(frozenQuestScriptIdentities.defaultedFields).toEqual(expect.arrayContaining([
      'mainObjectiveScripts[1..1]<-discarded-surplus',
      'mainObjectiveScripts[0].alternatives[2..2]<-discarded-surplus',
      'sideQuestScripts[1..1]<-discarded-surplus',
      'sideQuestScripts[0].stages[2..2]<-discarded-surplus',
      'sideQuestScripts[0].stages[0].stageKey<-frozen-plan',
      'sideQuestScripts[0].stages[0].actionKind<-frozen-plan',
      'sideQuestScripts[0].stages[0].abilityKey<-frozen-plan',
      'ambientEventScripts[1..1]<-discarded-surplus',
    ]))

    const flattenedQuestObjectives = legalizeProductionModelProtocolDefaultsV1(
      'content.main-quest-plan',
      {
        quests: [{
          key: 'quest.main', title: '主线', description: '主线说明', characterKeys: [],
          stages: [{
            key: 'stage.1', title: '启程',
            objectives: [{
              key: 'objective.1', title: '登船', sceneKeys: ['scene.001'], locationOrdinal: 2,
              alternatives: [{
                actionKind: 'inspect', targetCharacterKey: 'character.npc.1',
                persistentEffectKeys: ['记住了潮汐！'],
              }, {
                actionKind: 'talk', targetCharacterKey: 'character.player',
              }],
            }],
          }],
        }],
      },
      {
        questSceneCastPlan: [{
          sceneKey: 'scene.001', castKeys: ['character.player', 'character.npc.1'],
          nonPlayerCastKeys: ['character.npc.1'], locationOrdinal: 1,
        }],
      },
    )
    const flattenedQuest = (
      flattenedQuestObjectives.payload.quests as Array<Record<string, unknown>>
    )[0]
    expect(flattenedQuest.stages).toEqual([{
      key: 'stage.1', title: '启程', objectiveKeys: ['objective.1'],
    }])
    expect(flattenedQuest.objectives).toEqual([{
      key: 'objective.1', title: '登船', sceneKeys: ['scene.001'], locationOrdinal: 1, stageKey: 'stage.1',
      alternatives: [{
        actionKind: 'inspect', targetCharacterKey: null,
        persistentEffectKeys: ['flag.quest.1.objective.1.alternative.1.effect.1'],
      }, {
        actionKind: 'talk', targetCharacterKey: 'character.npc.1',
        persistentEffectKeys: ['flag.quest.1.objective.1.alternative.2.effect.1'],
      }],
    }])
    expect(flattenedQuest.characterKeys).toEqual(['character.player', 'character.npc.1'])
    expect(flattenedQuestObjectives.defaultedFields).toContain(
      'quests[0].objectives[0].alternatives[0].targetCharacterKey<-non-talk-null',
    )
    expect(flattenedQuestObjectives.defaultedFields).toContain(
      'quests[0].objectives[0].alternatives[1].targetCharacterKey<-scene-npc',
    )
    expect(flattenedQuestObjectives.defaultedFields).toContain(
      'quests[0].objectives[0].alternatives[1].persistentEffectKeys<-required-event-flag',
    )
    expect(flattenedQuestObjectives.defaultedFields).toContain(
      'quests[0].objectives[0].alternatives[0].persistentEffectKeys<-frozen-ordinal',
    )
    expect(flattenedQuestObjectives.defaultedFields).toContain(
      'quests[0].objectives[0].locationOrdinal<-scene-location-projection',
    )

    const repairedTalkTargets = legalizeProductionModelProtocolDefaultsV1(
      'content.main-quest-plan',
      {
        quests: [{
          key: 'quest.main', title: '主线', description: '主线说明', characterKeys: [],
          stages: [{ key: 'stage.1', title: '推进', objectiveKeys: ['objective.1', 'objective.2'] }],
          objectives: [{
            key: 'objective.1', stageKey: 'stage.1', title: '向在场者询问',
            sceneKeys: ['scene.001'], locationOrdinal: 1,
            alternatives: [{ actionKind: 'talk', targetCharacterKey: 'character.npc.absent' }],
          }, {
            key: 'objective.2', stageKey: 'stage.1', title: '独自处理',
            sceneKeys: ['scene.002'], locationOrdinal: 2,
            alternatives: [{ actionKind: 'talk', targetCharacterKey: 'character.npc.absent' }],
          }],
        }],
      },
      {
        questSceneCastPlan: [{
          sceneKey: 'scene.001', castKeys: ['character.player', 'character.npc.2', 'character.npc.3'],
          nonPlayerCastKeys: ['character.npc.2', 'character.npc.3'], locationOrdinal: 1,
        }, {
          sceneKey: 'scene.002', castKeys: ['character.player'], nonPlayerCastKeys: [], locationOrdinal: 2,
        }],
      },
    )
    const repairedObjectives = (
      (repairedTalkTargets.payload.quests as Array<Record<string, unknown>>)[0].objectives
    ) as Array<Record<string, unknown>>
    expect(repairedObjectives[0].alternatives).toEqual([expect.objectContaining({
      actionKind: 'talk', targetCharacterKey: 'character.npc.2',
    })])
    expect(repairedObjectives[1].alternatives).toEqual([expect.objectContaining({
      actionKind: 'quest-action', targetCharacterKey: null,
    })])
    expect(repairedTalkTargets.defaultedFields).toEqual(expect.arrayContaining([
      'quests[0].objectives[0].alternatives[0].targetCharacterKey<-scene-npc',
      'quests[0].objectives[1].alternatives[0].actionKind<-scene-without-npc',
    ]))

    const sceneScript = legalizeProductionModelProtocolDefaultsV1(
      'content.scene-script.act-2.part-1',
      {
        schema: 'provider.scene-script', version: 2, actKey: 'act.9', moduleTitle: '临时标题',
        scenes: [{
          sceneKey: 'scene.004', title: '潮门', summary: '潮声逼近。',
          beats: [
            { beatKey: 'beat.2', kind: 'narration', speakerKey: null, text: '后发生。', order: 2 },
            { beatKey: 'beat.1', kind: 'narration', speakerKey: null, text: '先发生。', order: 1 },
          ],
          choices: [{
            choiceKey: 'choice.1', sourceNodeKey: 'scene.004', targetNodeKey: 'scene.005',
            text: '继续', description: '走向潮门。', unavailableReason: null, order: 0,
          }],
        }],
        choices: [{
          choiceKey: 'choice.1', sourceNodeKey: 'scene.004', targetNodeKey: 'scene.005',
          text: '继续', description: '走向潮门。', unavailableReason: null, order: 0,
        }],
        endings: [{
          endingKey: 'ending.1', title: '余潮', summary: '潮声退去。',
          beats: [
            { beatKey: 'beat.end.2', kind: 'narration', speakerKey: null, text: '灯火熄灭。', order: 2 },
            { beatKey: 'beat.end.1', kind: 'narration', speakerKey: null, text: '天光升起。', order: 1 },
          ],
        }],
      },
      { sceneScriptModuleTitle: '潮钟群岛：最后的灯火' },
    )
    expect(sceneScript.payload).toMatchObject({
      schema: 'storyforge.text-adventure-scene-script-bundle-artifact',
      version: 1,
      actKey: 'act.2',
      moduleTitle: '潮钟群岛：最后的灯火',
      scenes: [{
        beats: [{ beatKey: 'beat.1', order: 0 }, { beatKey: 'beat.2', order: 1 }],
        choices: [expect.not.objectContaining({ unavailableReason: expect.anything() })],
      }],
      choices: [expect.not.objectContaining({ unavailableReason: expect.anything() })],
      endings: [{ beats: [{ beatKey: 'beat.end.1' }, { beatKey: 'beat.end.2' }] }],
    })
    expect(sceneScript.defaultedFields).toEqual([
      'schema<-frozen-scene-script-envelope',
      'version<-frozen-scene-script-envelope',
      'actKey<-frozen-scene-script-envelope',
      'moduleTitle<-frozen-scene-script-envelope',
      'scenes[0].beats<-stable-order',
      'scenes[0].beats[0].order<-canonical-position',
      'scenes[0].beats[1].order<-canonical-position',
      'scenes[0].choices[0].unavailableReason<-null-as-omitted',
      'endings[0].beats<-stable-order',
      'endings[0].beats[0].order<-canonical-position',
      'endings[0].beats[1].order<-canonical-position',
      'choices[0].unavailableReason<-null-as-omitted',
    ])

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
      entries: [{
        key: 'tide-warning', title: '潮汐警告', hook: '旧仓街响起三次敲击', leaked: true,
        stages: [{
          key: 'follow-echo', title: '追随回声', objective: '在旧仓街确认回声来源',
          locationOrdinal: 1, successText: '旧仓街的回声得到回应。',
        }, null],
      }],
    }, { questLocationTitles: ['潮门广场', '旧仓街'] })
    expect(quests.payload).toMatchObject({
      entries: [{
        rewardExperience: 2, rewardCurrency: 0, leaked: true,
        stages: [{ locationOrdinal: 2 }],
      }],
    })
    expect(quests.defaultedFields).toEqual([
      'entries[0].rewardExperience', 'entries[0].rewardCurrency',
      'entries[0].stages[0].timeCostMinutes',
      'entries[0].stages[0].locationOrdinal<-stage-location',
    ])
    expect(quests.discardedNullEntries).toEqual(['entries[0].stages[1]'])
    expect(quests.discardedUnregisteredStateFields).toEqual([])

    const anchoredQuest = legalizeProductionModelProtocolDefaultsV1(
      'content.adventure-side-quests',
      {
        entries: [{
          stages: [{
            title: '修复破损浮标',
            objective: '找到被风暴卷走的铜制定位片',
            locationOrdinal: 2,
            successText: '定位片重新发出微光。',
            costlySuccessText: '定位片亮了，但耽误了潮汐窗口。',
            failureText: '虽然没能修好，你仍找到了替代航线。',
          }],
        }],
      },
      { questLocationTitles: ['潮门广场', '冰窟渔村'] },
    )
    expect(anchoredQuest.payload).toMatchObject({
      entries: [{
        stages: [{
          locationOrdinal: 2,
          objective: '在冰窟渔村，找到被风暴卷走的铜制定位片',
        }],
      }],
    })
    expect(anchoredQuest.defaultedFields).toContain(
      'entries[0].stages[0].objective<-frozen-location-anchor',
    )
  })

  it('文字冒险单项图片在有界重试耗尽后生成显式纯文字降级工件', async () => {
    const owned = await fixtureForProduct('text-adventure', { visualLevel: 'key-scenes' })
    const briefHash = await hashProductProductionValueV2(owned.brief)
    const plan = await createProductProductionPlanV3({ buildNumber: 1, briefHash, brief: owned.brief })
    const task = plan.tasks.find(item => item.taskKey === 'media.visual.001')!
    const mediaRequirements = {
      ...modelOutputs(
      owned.brief.source.worldContentHash,
      'text-adventure',
      firstCharacterAnchor(owned.brief),
      owned.brief.intent.playerRole,
      )['media.requirements'],
      audio: [],
    }
    const professional = professionalTextAdventurePlanningOutputs(owned.brief)
    const cast = professional['content.cast-bible'] as {
      characters: Array<{
        key: string; name: string; role: 'player' | 'major-npc' | 'supporting-npc'
        publicIdentity: string; visualAnchor: string
      }>
    }
    const visualBibleHash = 'f'.repeat(64)
    const visualBible = {
      schema: 'storyforge.text-adventure-visual-bible-artifact', version: 1,
      style: '雾港写实插画', palette: ['#172033', '#52647A', '#D8C6A0'],
      compositionRules: ['保留文字安全区', '人物关系优先'],
      continuityRules: ['角色身份连续', '服装标志物连续', '场景光照连续'],
      characterAnchors: cast.characters.map(character => ({
        characterKey: character.key, name: character.name, role: character.role,
        identity: character.publicIdentity, visualAnchor: character.visualAnchor,
        requirementArtifactKeys: [], palette: ['#172033', '#52647A', '#D8C6A0'],
        hardConstraints: ['保持身份年龄', `身份:${character.publicIdentity}`, `锚点:${character.visualAnchor}`],
      })),
      assetRequirements: mediaRequirements.visual.map(requirement => ({
        artifactKey: requirement.artifactKey, mediaKind: requirement.mediaKind,
        sceneTag: requirement.sceneTag, beatKey: requirement.beatKey,
      })),
    }
    const artifact = (
      artifactKey: string,
      kind: ProductBuildArtifactRecordV1['kind'],
      payload: unknown,
      contentHash: string,
    ): ProductBuildArtifactRecordV1 => ({
      projectId: owned.scope.projectId, worldId: owned.scope.worldId, workId: owned.scope.workId,
      buildId: 1, artifactKey, requirementKey: null, version: 1,
      kind, mediaKind: null, status: 'accepted', producerRunId: null,
      producerReceiptHash: null, controlEpoch: 0, inputHash: 'a'.repeat(64),
      contentHash, payloadJson: JSON.stringify(payload),
      metadataJson: '{}', qualityJson: '{}', rightsJson: '{}', blobObjectId: null,
      mimeType: null, byteSize: 1, parentArtifactHash: null, carriedFrom: null,
      createdAt: 1, updatedAt: 1,
    })
    const inputArtifacts = [
      artifact('media.requirements', 'asset-manifest', mediaRequirements, 'b'.repeat(64)),
      artifact('content.cast-bible', 'product-design', professional['content.cast-bible'], 'a'.repeat(64)),
      artifact('media.visual-bible', 'visual-bible', visualBible, visualBibleHash),
      artifact('media.anchor-decision', 'visual-bible', {
        schema: 'storyforge.text-adventure-media-anchor-decision-artifact', version: 1,
        visualBibleHash, decision: 'not-required-noncommercial', confirmedCharacterKeys: [],
        authorCommandId: null, authorNote: null,
      }, '9'.repeat(64)),
    ]
    const executor = createConfiguredProductProductionExecutorV1({
      production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief,
    })
    const execution = {
      scope: owned.scope, productionId: owned.productionId, buildId: 1, buildNumber: 1,
      controlEpoch: 0, planHash: 'c'.repeat(64), task, attempt: 1,
      idempotencyKey: 'd'.repeat(64), contextText: '', inputArtifacts,
      capabilityBindings: [{
        requirementKey: 'media.visual', adapterId: 'missing.fixture', bindingHash: 'e'.repeat(64),
      }],
      authorResolution: null, signal: new AbortController().signal,
    }
    await expect(executor(execution)).rejects.toThrow('媒资 capability 未按冻结 binding 解析')
    const fallback = await executor({ ...execution, attempt: task.maxAttempts })
    expect(fallback.usage).toMatchObject({ mediaCalls: 1, costUsd: null, storageBytes: 0 })
    expect(fallback.artifacts).toEqual([expect.objectContaining({
      artifactKey: 'media.visual.001', kind: 'integration-report',
      payload: expect.objectContaining({
        schema: 'storyforge.omitted-media-artifact', fallback: 'text-only',
      }),
      quality: expect.objectContaining({ providerAttemptsExhausted: task.maxAttempts }),
    })])

    const fallbackRows: ProductBuildArtifactRecordV1[] = []
    for (const visualTask of plan.tasks.filter(item => /^media\.visual\.\d{3}$/.test(item.taskKey))) {
      const result = visualTask.taskKey === task.taskKey
        ? fallback
        : await executor({ ...execution, task: visualTask, attempt: visualTask.maxAttempts })
      const candidate = result.artifacts[0]
      const row = artifact(
        candidate.artifactKey,
        'integration-report',
        candidate.payload,
        await hashProductProductionValueV2(candidate.payload),
      )
      row.metadataJson = JSON.stringify(candidate.metadata ?? {})
      row.qualityJson = JSON.stringify(candidate.quality ?? {})
      row.rightsJson = JSON.stringify(candidate.rights ?? {})
      fallbackRows.push(row)
    }
    const auditTask = plan.tasks.find(item => item.taskKey === 'media.audit')!
    const audit = await executor({
      ...execution, task: auditTask, attempt: 1,
      inputArtifacts: [
        artifact('media.requirements', 'asset-manifest', mediaRequirements, 'b'.repeat(64)),
        artifact('content.cast-bible', 'product-design', professional['content.cast-bible'], 'a'.repeat(64)),
        artifact('media.visual-bible', 'visual-bible', visualBible, visualBibleHash),
        ...fallbackRows,
      ],
    })
    expect(audit.artifacts[0]).toMatchObject({
      artifactKey: 'media.audit', kind: 'integration-report',
      payload: {
        schema: 'storyforge.text-adventure-media-audit-artifact', passed: true,
        assets: mediaRequirements.visual.map((requirement: { artifactKey: string }) => ({
          artifactKey: requirement.artifactKey, status: 'text-fallback', assetKey: null,
          rightsComplete: true, fallbackReason: 'provider-unavailable-after-bounded-retry',
        })),
      },
    })
  })

  it('商业文字冒险先编译独立视觉圣经，未确认角色锚点时绝不允许开始出图', async () => {
    const owned = await fixtureForProduct('text-adventure', {
      scale: 'short-arc', visualLevel: 'key-scenes', qualityProfile: 'commercial-candidate',
    })
    const briefHash = await hashProductProductionValueV2(owned.brief)
    const plan = await createProductProductionPlanV3({ buildNumber: 1, briefHash, brief: owned.brief })
    const compileTask = plan.tasks.find(item => item.taskKey === 'media.visual-bible.compile')!
    const anchorGateTask = plan.tasks.find(item => item.taskKey === 'media.anchor-author-gate')!
    const visualKeys = plan.tasks.filter(item => /^media\.visual\.\d{3}$/.test(item.taskKey))
      .map(item => item.taskKey)
    const professional = fullLengthTextAdventureOutputs(owned.brief) as Record<string, unknown>
    const mediaRequirements = {
      schema: 'storyforge.product-media-requirements-artifact', version: 2,
      visual: visualKeys.map((artifactKey, index) => ({
        artifactKey, mediaKind: index === 1 ? 'character-pose' : index === 0 ? 'background' : 'cg',
        sceneTag: `scene.${String(index + 1).padStart(3, '0')}`,
        beatKey: `beat.${String(index + 1).padStart(3, '0')}`,
        prompt: index === 1 ? '守灯人深蓝制服与铜色灯杖的角色定稿。' : `雾港关键场景插图 ${index + 1}。`,
        altText: index === 1 ? '手持铜色灯杖的守灯人。' : `雾港关键场景 ${index + 1}。`,
        width: index === 1 ? 720 : 1280, height: index === 1 ? 1080 : 720,
        palette: ['#172033', '#52647A', '#D8C6A0'],
        characterAnchorRefs: index === 1 ? ['character.player'] : [],
        hardConstraints: [],
      })),
      audio: [],
    }
    const artifact = async (
      artifactKey: string,
      kind: ProductBuildArtifactRecordV1['kind'],
      payload: unknown,
    ): Promise<ProductBuildArtifactRecordV1> => ({
      projectId: owned.scope.projectId, worldId: owned.scope.worldId, workId: owned.scope.workId,
      buildId: 1, artifactKey, requirementKey: null, version: 1, kind,
      mediaKind: null, status: 'accepted', producerRunId: null, producerReceiptHash: null,
      controlEpoch: 0, inputHash: 'a'.repeat(64),
      contentHash: await hashProductProductionValueV2(payload), payloadJson: JSON.stringify(payload),
      metadataJson: '{}', qualityJson: '{}', rightsJson: '{}', blobObjectId: null,
      mimeType: null, byteSize: 1, parentArtifactHash: null, carriedFrom: null,
      createdAt: 1, updatedAt: 1,
    })
    const production = (await db.productProductions.get(owned.productionId))!
    const executor = createConfiguredProductProductionExecutorV1({ production, brief: owned.brief })
    const compileResult = await executor({
      scope: owned.scope, productionId: owned.productionId, buildId: 1, buildNumber: 1,
      controlEpoch: 0, planHash: 'b'.repeat(64), task: compileTask, attempt: 1,
      idempotencyKey: 'c'.repeat(64), contextText: '', capabilityBindings: [],
      inputArtifacts: [
        await artifact('content.cast-bible', 'product-design', professional['content.cast-bible']),
        await artifact('content.adventure-architecture', 'product-design', professional['content.adventure-architecture']),
        await artifact('media.requirements', 'asset-manifest', mediaRequirements),
      ],
      authorResolution: null, signal: new AbortController().signal,
    })
    const visualBiblePayload = compileResult.artifacts[0].payload
    const visualBibleArtifact = await artifact('media.visual-bible', 'visual-bible', visualBiblePayload)
    const gateInput = {
      scope: owned.scope, productionId: owned.productionId, buildId: 1, buildNumber: 1,
      controlEpoch: 0, planHash: 'b'.repeat(64), task: anchorGateTask, attempt: 1,
      idempotencyKey: 'd'.repeat(64), contextText: '', capabilityBindings: [],
      inputArtifacts: [
        await artifact('content.cast-bible', 'product-design', professional['content.cast-bible']),
        visualBibleArtifact,
      ],
      authorResolution: null, signal: new AbortController().signal,
    }
    const legacyTwoImageBrief = structuredClone(owned.brief)
    legacyTwoImageBrief.media.imageCount = 2
    const legacyExecutor = createConfiguredProductProductionExecutorV1({
      production,
      brief: legacyTwoImageBrief,
    })
    await expect(legacyExecutor(gateInput)).rejects.toThrow(
      '商业文字冒险媒资计划不足:2/12',
    )
    await expect(executor(gateInput)).rejects.toThrow('需要作者明确确认角色视觉锚点')
    const confirmed = await executor({
      ...gateInput,
      authorResolution: {
        commandId: 'author.confirm-character-anchors', blockerKey: 'media.anchor-author-gate',
        resolution: { action: 'confirm-character-anchors' as const, note: '已逐项审查并确认全部角色锚点。' },
        resolvedAt: 2,
      },
    })
    expect(confirmed.artifacts[0]).toMatchObject({
      artifactKey: 'media.anchor-decision',
      payload: {
        decision: 'confirm-character-anchors',
        authorCommandId: 'author.confirm-character-anchors',
        confirmedCharacterKeys: expect.arrayContaining(['character.player']),
      },
    })
  })

  it('独立 Visual QA Director 实际接收冻结图片 key/hash，并由逐项证据派生审图结论', async () => {
    const owned = await fixtureForProduct('text-adventure', { visualLevel: 'key-scenes' })
    const briefHash = await hashProductProductionValueV2(owned.brief)
    const plan = await createProductProductionPlanV3({ buildNumber: 1, briefHash, brief: owned.brief })
    const task = plan.tasks.find(item => item.taskKey === 'media.visual-quality-review')!
    const imageKeys = plan.tasks.filter(item => /^media\.visual\.\d{3}$/.test(item.taskKey))
      .map(item => item.taskKey)
    const blob = await putMediaBlobObject({
      scope: owned.scope,
      data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer,
      mimeType: 'image/png',
    })
    const auditPayload = {
      schema: 'storyforge.text-adventure-media-audit-artifact', version: 1,
      buildNumber: 1, requirementsHash: 'a'.repeat(64), visualBibleHash: 'b'.repeat(64),
      assets: imageKeys.map((artifactKey, index) => ({
        artifactKey, status: 'fulfilled', assetKey: `current.text-adventure.build-1.${artifactKey}`,
        requirementHash: String(index + 1).repeat(64).slice(0, 64), contentHash: blob.contentHash,
        mimeType: 'image/png', width: 1280, height: 720,
        source: 'fixture-provider', license: 'fixture-license', rightsComplete: true, fallbackReason: null,
      })),
      passed: true,
    }
    const auditHash = await hashProductProductionValueV2(auditPayload)
    const artifact = (artifactKey: string, options: Partial<ProductBuildArtifactRecordV1> = {}): ProductBuildArtifactRecordV1 => ({
      projectId: owned.scope.projectId, worldId: owned.scope.worldId, workId: owned.scope.workId,
      buildId: 1, artifactKey, requirementKey: null, version: 1, kind: 'image', mediaKind: 'background',
      status: 'accepted', producerRunId: null, producerReceiptHash: null, controlEpoch: 0,
      inputHash: 'c'.repeat(64), contentHash: blob.contentHash, payloadJson: '{}',
      metadataJson: '{}', qualityJson: '{}', rightsJson: '{}', blobObjectId: blob.id!,
      mimeType: 'image/png', byteSize: blob.byteSize, parentArtifactHash: null, carriedFrom: null,
      createdAt: 1, updatedAt: 1, ...options,
    })
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const bindingHash = 'd'.repeat(64)
    const seen: Array<{ artifactKey: string; contentHash: string; byteLength: number }> = []
    const runVision: ProductionVisionRunnerV1 = async request => {
      seen.push(...request.images.map(image => ({
        artifactKey: image.artifactKey, contentHash: image.contentHash, byteLength: image.data.byteLength,
      })))
      return {
        output: JSON.stringify({
          schema: 'storyforge.text-adventure-visual-quality-model-output', version: 1,
          reviews: request.images.map(image => ({
            artifactKey: image.artifactKey, contentHash: image.contentHash, verdict: 'accept',
            scores: {
              requirementFit: 5, identityContinuity: 5, styleContinuity: 4,
              composition: 4, technicalCleanliness: 5,
            },
            issues: [],
          })),
        }),
        usage: { inputTokens: 200, outputTokens: 100 },
        bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1,
          requirementKey: textRequirement.requirementKey,
          adapterId: 'configured-text.v1', adapterVersion: 1,
          provider: 'fixture', model: 'fixture-vision', endpointOrigin: 'https://fixture.invalid',
          executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
          capabilityHash: bindingHash, boundAt: 1, receiptHash: 'e'.repeat(64),
        },
      }
    }
    const executor = createConfiguredProductProductionExecutorV1({
      production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief, runVision,
    })
    const result = await executor({
      scope: owned.scope, productionId: owned.productionId, buildId: 1, buildNumber: 1,
      controlEpoch: 0, planHash: 'f'.repeat(64), task, attempt: 1,
      idempotencyKey: '1'.repeat(64), contextText: '{"registered":true}',
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash,
      }],
      inputArtifacts: [
        artifact('media.audit', {
          kind: 'integration-report', mediaKind: null, blobObjectId: null, mimeType: null,
          contentHash: auditHash, payloadJson: JSON.stringify(auditPayload), byteSize: 1,
        }),
        ...imageKeys.map(artifactKey => artifact(artifactKey)),
      ],
      authorResolution: null, signal: new AbortController().signal,
    })
    expect(seen).toEqual(imageKeys.map(artifactKey => ({
      artifactKey, contentHash: blob.contentHash, byteLength: blob.byteSize,
    })))
    expect(result).toMatchObject({
      usage: { modelCalls: 1, inputTokens: 200, outputTokens: 100 },
      artifacts: [{
        artifactKey: 'quality.visual-review', kind: 'playtest-report',
        payload: {
          status: 'passed', providerReviewCompleted: true, blockingIssueCount: 0,
          mediaAuditHash: auditHash,
        },
      }],
    })
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

  it('来源审查可被退回重做，接受私域补充后才允许专业团队继续生产', async () => {
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
    const readySourceAudit = {
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
    outputs['content.source-sufficiency'] = {
      schema: 'storyforge.text-adventure-source-sufficiency-artifact', version: 1,
      decision: 'blocked', adaptationStrategy: 'expand-sparse',
      coverage: [{
        domain: 'characters', status: 'partial', resourceKeys: [],
        rationale: '第一次审查错误地把产品私域角色弧当成世界来源缺失。',
      }],
      gaps: [{
        key: 'gap.character-arc', severity: 'blocking',
        description: '缺少产品运行期的角色关系弧。', affectedStages: ['content.cast-bible'],
      }],
      privateAdditions: [], authorDecisionRequired: true,
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
    expect(taskCalls).toEqual(['production.supervision', 'content.source-sufficiency'])
    const blockedBuild = (await db.productBuilds.get(first.buildId))!
    expect(JSON.parse(blockedBuild.failureJson)).toMatchObject({
      taskKey: 'source.author-gate', detail: expect.stringContaining('来源存在阻断'),
    })
    expect(await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([first.buildId, 'content.design']).count()).toBe(0)

    const firstBlockedProduction = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'resolve-blocker', commandId: 'source-review.retry',
        expectedStateRevision: firstBlockedProduction.stateRevision,
        blockerKey: 'content.source-sufficiency',
        resolution: {
          action: 'retry',
          note: '作者指出角色弧属于产品私域，要求保持来源和 Brief 不变重新审查。',
        },
      },
    })
    outputs['content.source-sufficiency'] = readySourceAudit
    const reviewed = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief, runText,
      }),
      capabilityBindings,
    })
    expect(reviewed).toMatchObject({ terminal: false, buildStatus: 'recovery-required' })
    expect(taskCalls.filter(taskKey => taskKey === 'content.source-sufficiency')).toHaveLength(2)
    expect(JSON.parse((await db.productBuilds.get(reviewed.buildId))!.failureJson)).toMatchObject({
      taskKey: 'source.author-gate', detail: expect.stringContaining('作者明确接受'),
    })

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
    const validArcPlan = outputs['content.narrative-arc-scenes']
    const invalidArcPlan = structuredClone(validArcPlan) as {
      acts: Array<{ sceneCards: unknown[] }>
    }
    invalidArcPlan.acts[0].sceneCards = invalidArcPlan.acts[0].sceneCards.slice(1)
    outputs['content.narrative-arc-scenes'] = invalidArcPlan
    const arcBlocked = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief, runText,
      }),
      capabilityBindings,
    })
    expect(arcBlocked).toMatchObject({ terminal: false, buildStatus: 'recovery-required' })
    expect(JSON.parse((await db.productBuilds.get(arcBlocked.buildId))!.failureJson)).toMatchObject({
      taskKey: 'content.narrative-arc-scenes', detail: expect.stringContaining('sceneCards 数量无效'),
    })
    const decisionBeforeArcRetry = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([arcBlocked.buildId, 'content.source-decision'])
      .filter(row => row.controlEpoch === arcBlocked.controlEpoch && row.status === 'accepted').first()
    expect(decisionBeforeArcRetry).toBeDefined()
    const arcBlockedProduction = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'resolve-blocker', commandId: 'narrative-arc.retry',
        expectedStateRevision: arcBlockedProduction.stateRevision,
        blockerKey: 'content.narrative-arc-scenes',
        resolution: { action: 'retry', note: '修正三幕冻结场景槽位后继续。' },
      },
    })
    outputs['content.narrative-arc-scenes'] = validArcPlan
    const completed = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief, runText,
      }),
      capabilityBindings,
    })
    const postRetryArtifacts = await db.productBuildArtifacts.where('buildId').equals(completed.buildId).toArray()
    expect(
      completed,
      `post-arc-retry projection=${JSON.stringify(completed)} failure=${(await db.productBuilds.get(completed.buildId))?.failureJson} artifacts=${JSON.stringify(postRetryArtifacts.map(row => ({ key: row.artifactKey, epoch: row.controlEpoch, status: row.status })))}`,
    ).toMatchObject({ terminal: true, buildStatus: 'release-ready' })
    expect(taskCalls.filter(taskKey => taskKey === 'content.source-sufficiency')).toHaveLength(2)
    expect(taskCalls.filter(taskKey => taskKey === 'source.author-gate')).toHaveLength(0)
    const decision = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([completed.buildId, 'content.source-decision'])
      .filter(row => row.status === 'carried-forward').first()
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
    let narrativeArcSystem = ''
    let narrativeDecisionSystem = ''
    let mainQuestSystem = ''
    let productModuleSystem = ''
    let sideQuestSystem = ''
    let questScriptSystem = ''
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
      if (taskKey === 'content.narrative-arc-scenes') narrativeArcSystem = request.system
      if (taskKey === 'content.narrative-decision-plan') narrativeDecisionSystem = request.system
      if (taskKey === 'content.main-quest-plan') mainQuestSystem = request.system
      if (taskKey === 'content.product-module') productModuleSystem = request.system
      if (taskKey === 'content.adventure-side-quests') sideQuestSystem = request.system
      if (taskKey.startsWith('content.quest-script.')) questScriptSystem += request.system
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
    expect(sceneScriptSystems).toHaveLength(6)
    const actOneSceneSystem = sceneScriptSystems.find(system => (
      system.includes('任务=content.scene-script.act-1.part-1')
    ))
    const actThreeSceneSystem = sceneScriptSystems.find(system => (
      system.includes('任务=content.scene-script.act-3.part-2')
    ))
    expect(actOneSceneSystem).toContain('你是第 1 幕的专职分场叙事作者')
    expect(actOneSceneSystem).toContain(
      'scenes 必须恰好输出 2 项，并按顺序逐字覆盖 ["scene.001","scene.002"]',
    )
    expect(actOneSceneSystem).toContain('禁止只写前面部分就提交')
    expect(actOneSceneSystem).toContain('"sceneKey":"scene.001","locationTitle":"地点 1-1-1"')
    expect(actOneSceneSystem).toContain('"sceneKey":"scene.001","beats0MustStartWith":"地点 1-1-1"')
    expect(actOneSceneSystem).toContain('beats[0] 必须是 narration、speakerKey=null')
    expect(actOneSceneSystem).toContain('text 的第一个字开始逐字复制 beats0MustStartWith')
    expect(actOneSceneSystem).toContain('一律不得改写')
    expect(actOneSceneSystem).toContain('每个 locationTitle 必须至少一次逐字出现在对应 scene')
    expect(actOneSceneSystem).toContain('简称不能证明场景已经落实到冻结地点')
    expect(actOneSceneSystem).toContain('choices 只能作为根对象的数组')
    expect(actOneSceneSystem).toContain('禁止填写角色姓名、称谓、narrator、空字符串或 null')
    expect(actOneSceneSystem).toContain('必须使用 kind=narration 且 speakerKey=null')
    expect(actThreeSceneSystem).toContain('"endings":["ending.001","ending.002","ending.003"]')
    expect(narrativeArcSystem).toContain('场景与地点的冻结映射=')
    expect(narrativeArcSystem).toContain('"sceneKey":"scene.001","locationOrdinal":1,"locationTitle":"地点 1-1-1"')
    expect(narrativeDecisionSystem).toContain('你是同一位叙事设计师的决定设计 Run')
    expect(narrativeDecisionSystem).toContain('"decisionKey":"decision.1","sceneKey":"scene.001"')
    expect(narrativeDecisionSystem).toContain('"optionKeys":["option.1.1","option.1.2"]')
    expect(mainQuestSystem).toContain('场景的冻结地点与出场角色约束=')
    expect(mainQuestSystem).toContain('characterKeys 将由系统确定性投影')
    expect(mainQuestSystem).toContain('quests[0] 必须同时包含 key/title/description/characterKeys/stages/objectives')
    expect(mainQuestSystem).toContain('每个主线 objective.sceneKeys 必须恰好包含一个场景 key')
    expect(mainQuestSystem).toContain('locationOrdinal 必须复制所引用场景共同绑定的地点编号')
    expect(mainQuestSystem).toContain('stage 及其 objectiveKeys 必须按场景约束数组中的 sceneKey 顺序单调推进')
    expect(mainQuestSystem).toContain('nonPlayerCastKeys 是 talk 目标的唯一白名单')
    expect(mainQuestSystem).toContain('"nonPlayerCastKeys"')
    expect(sceneScriptContexts).toHaveLength(6)
    const actOneSceneContext = sceneScriptContexts.find(context => (
      context.includes('"taskKey":"content.scene-script.act-1.part-1"')
    ))
    expect(actOneSceneContext).toContain('storyforge.text-adventure-scene-script-inputs')
    expect(actOneSceneContext).not.toContain('storyforge.product-production.artifact-inputs')
    expect(actOneSceneContext).not.toContain('"key":"scene.012"')
    expect(sideQuestSystem).toContain('地点编号与标题的唯一映射=')
    expect(sideQuestSystem).toContain('"locationOrdinal":1,"locationTitle":"地点 1-1-1"')
    expect(sideQuestSystem).toContain('每条支线必须包含 2–4 个有因果顺序的实质阶段')
    expect(sideQuestSystem).toContain('不能把“接取任务”充当模型阶段')
    expect(sideQuestSystem).toContain('每个 stage 的 title、objective、successText、costlySuccessText、failureText')
    expect(sideQuestSystem).toContain('title 与 objective 合并后必须且只能出现这一个登记地点标题')
    expect(sideQuestSystem).toContain('跨地点线索只能写进 successText、costlySuccessText 或 failureText')
    expect(sideQuestSystem).toContain('abilityKey 只能逐字使用这些上游已登记能力=')
    expect(sideQuestSystem).toContain('"ability.perception"')
    expect(questScriptSystem).toContain('上游已冻结的脚本身份与顺序=')
    expect(questScriptSystem).toContain('不得重新命名、翻译、合并阶段、重设补充任务数值')
    expect(questScriptSystem).toContain('check.resolution.abilityKey 只能逐字使用')
    expect(questScriptSystem).toContain('"ability.perception"')
    expect(dialoguePassSystems).toHaveLength(3)
    expect(dialoguePassSystems[0]).toContain('独立对白编辑，不是分场作者')
    expect(dialoguePassSystems[0]).toContain('使用序号差量协议')
    expect(dialoguePassSystems[0]).toContain('reviewedBeatCount')
    expect(dialoguePassSystems[0]).toContain('禁止回显 keep 项的原文')
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
    expect(runtimePackage.adventure.quests.filter(item => item.category === 'side')
      .every(item => item.stages.length === 3 && item.objectives.length === 3)).toBe(true)
    expect(runtimePackage.adventure.actions.filter(item => item.key.startsWith('action.accept.side.'))).toHaveLength(3)
    expect(runtimePackage.adventure.actions.filter(item => item.key.startsWith('action.side.'))
      .every(item => item.label.startsWith('推进：'))).toBe(true)
    const sideUseAction = runtimePackage.adventure.actions.find(item => (
      item.key.startsWith('action.side.side-1.') && item.kind === 'use'
    ))!
    expect(sideUseAction).toMatchObject({ kind: 'use' })
    expect(sideUseAction.targetKey).toMatch(/^item\.side\.side-1\./)
    expect(sideUseAction.requirements).toContainEqual({ itemKey: sideUseAction.targetKey, itemQuantity: 1 })
    expect(runtimePackage.adventure.items).toContainEqual(expect.objectContaining({
      key: sideUseAction.targetKey, usableActionKey: sideUseAction.key, category: 'quest',
    }))
    expect(runtimePackage.adventure.actions).toContainEqual(expect.objectContaining({
      key: expect.stringMatching(/^action\.prepare\.side\.side-1\./), kind: 'take',
      successEffects: [expect.objectContaining({ op: 'gain-item', itemKey: sideUseAction.targetKey })],
    }))
    expect(runtimePackage.adventure.actions.filter(item => item.key.startsWith('action.ambient.'))
      .every(item => item.label.startsWith('处理：'))).toBe(true)
    expect(runtimePackage.adventure.actions.some(item => item.key.startsWith('action.travel.'))).toBe(false)
    expect(runtimePackage.adventure.storylets).toHaveLength(7)
    expect(runtimePackage.adventure.endings).toHaveLength(3)
    const echoActions = runtimePackage.adventure.actions.filter(item => item.key.startsWith('action.echo.'))
    const arcDecisionCount = (outputs['content.narrative-arc-plan'] as {
      decisions: Array<{ options: Array<{ echoSceneKeys: string[] }> }>
    }).decisions.reduce((total, decision) => (
      total + decision.options.reduce((optionTotal, option) => optionTotal + option.echoSceneKeys.length, 0)
    ), 0)
    expect(echoActions).toHaveLength(arcDecisionCount)
    expect(echoActions.every(action => action.requirements.some(requirement => (
      'conditionKey' in requirement && requirement.conditionPresent === true
    )))).toBe(true)
    const firstDecisionChoices = runtimePackage.narrative.choices.filter(choice => (
      choice.sourceNodeKey === runtimePackage.narrative.entryNodeKey
    ))
    const firstDecisionConditionKeys = firstDecisionChoices.map(choice => {
      const actionKey = choice.tags.find(tag => tag.startsWith('adventure-action:'))!.slice('adventure-action:'.length)
      const action = runtimePackage.adventure!.actions.find(item => item.key === actionKey)!
      return action.successEffects.find(effect => effect.op === 'apply-condition')!.conditionKey
    })
    const endingChoiceActions = runtimePackage.narrative.choices.filter(choice => choice.targetNodeKey.startsWith('ending.'))
      .map(choice => {
        const actionKey = choice.tags.find(tag => tag.startsWith('adventure-action:'))!.slice('adventure-action:'.length)
        return runtimePackage.adventure!.actions.find(item => item.key === actionKey)!
      })
    expect(endingChoiceActions[0].requirements).toContainEqual({
      conditionKey: firstDecisionConditionKeys[0], conditionPresent: true,
    })
    expect(endingChoiceActions[1].requirements).toContainEqual({
      conditionKey: firstDecisionConditionKeys[1], conditionPresent: true,
    })
    expect(endingChoiceActions[2].requirements).toContainEqual({
      conditionKey: firstDecisionConditionKeys[1], conditionPresent: true,
    })
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
    const acceptedSideQuest = (await readProductRuntimeState(preview.sessionId)).adventure?.quests
      .find(item => item.questKey === entrySideQuest.key)
    expect(acceptedSideQuest?.status).toBe('active')
    expect(acceptedSideQuest?.objectives[0]).toMatchObject({ completed: true, optional: false })
    expect(acceptedSideQuest?.objectives[1]).toMatchObject({ completed: false, optional: false })

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
      'content.narrative', 'content.narrative-arc-plan', 'content.quest-script',
      'content.scene-script.act-1', 'content.scene-script.act-2', 'content.scene-script.act-3', 'media.visual-bible',
      'quality.autoplay', 'quality.playtest-plan', 'quality.report', 'runtime.package',
    ])
  }, 30_000)

  it('保留独立叙事审查证据，并在存在阻塞问题时拒绝装配可玩包', async () => {
    const owned = await fixtureForProduct('text-adventure', { visualLevel: 'none', maximumModelCalls: 48 })
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
      if (taskKey === 'content.scene-script.act-1.part-1' && (taskCalls.get(taskKey) ?? 0) >= 2) {
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
    const interruptedFailure = JSON.parse(interruptedBuild.failureJson) as {
      taskKey: string
      taskFailures: Record<string, { detail?: string }>
    }
    expect(interruptedFailure).toMatchObject({
      repairCause: {
        taskKey: 'integration.package', detail: expect.stringContaining('文字冒险叙事质量审查未通过'),
      },
    })
    expect(interruptedFailure.taskFailures['content.scene-script.act-1.part-1']?.detail)
      .toContain('fixture repair provider timeout')
    failFirstRepairEpoch = false
    const interruptedProduction = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'resolve-blocker', commandId: 'text-adventure.quality-repair.retry-after-timeout',
        expectedStateRevision: interruptedProduction.stateRevision, blockerKey: interruptedFailure.taskKey,
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
      ['production.supervision', 1], ['content.source-sufficiency', 1], ['content.design', 1], ['content.story-bible', 1],
      ['content.cast-bible', 1], ['content.adventure-architecture', 1],
      ['content.narrative-arc-scenes', 1], ['content.narrative-decision-plan', 1],
      ['content.main-quest-plan', 1],
      ['content.scene-script.act-1.part-1', 4], ['content.scene-script.act-1.part-2', 2],
      ['content.scene-script.act-2.part-1', 2],
      ['content.scene-script.act-3.part-1', 2],
      ['content.dialogue-pass.act-1', 2], ['content.dialogue-pass.act-2', 2],
      ['content.dialogue-pass.act-3', 2],
      ['content.product-module', 1], ['content.adventure-side-quests', 2],
      ['content.quest-script.main.act-1.single', 1], ['content.quest-script.main.act-1.multi', 1],
      ['content.quest-script.main.act-2.single', 1], ['content.quest-script.main.act-2.multi', 1],
      ['content.quest-script.main.act-3.single', 1], ['content.quest-script.main.act-3.multi', 1],
      ['content.quest-script.supplemental', 2],
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
