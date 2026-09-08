import {
  createTextAdventureCommunityPackageV1,
  type TextAdventureCommunityPackageV1,
} from '../../src/lib/adventure/community-package'
import { analyzeTextAdventureRouteQualityV1 } from '../../src/lib/adventure/quality-analysis'
import { runTextAdventureAutoplayV1 } from '../../src/lib/adventure/autoplay'
import { createProductBrowserPerformanceReceiptV1 } from '../../src/lib/product-production/browser-performance'
import {
  PRODUCT_BROWSER_PERFORMANCE_GATE_ID_V1,
  PRODUCT_MAIN_ROUTE_PLAYTHROUGH_GATE_ID_V1,
  PRODUCT_MAIN_ROUTE_PLAYTHROUGH_POLICY_ID_V1,
  TEXT_ADVENTURE_HUMAN_PLAYTEST_GATE_ID_V1,
  TEXT_ADVENTURE_HUMAN_PLAYTEST_POLICY_ID_V1,
  type ProductQualityGateReceiptV1,
  type TextAdventureHumanPlaytestSessionEvidenceV1,
} from '../../src/lib/product-production/quality-receipts'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
} from '../../src/lib/product-production/hash'
import { evaluateProductRuntimeProductQualityV1 } from '../../src/lib/product-production/product-quality'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import type {
  ProductBuildManifestV1,
  ProductBuildQualityReportV1,
  ProductRuntimePackageV1,
} from '../../src/lib/types'
import { createFixtureProductReleaseManifestV1 } from './product-release-v1'
import { CURRENT_PRODUCT_SOURCE_CATALOG } from './current-product-world'
import { createTextAdventureFoundationRuntimePackageV2 } from './text-adventure-v2-foundation'
import { createCurrentProductBriefFixture } from './current-runtime-package'

const HASH = 'a'.repeat(64)
const PREVIEW_HASH = 'b'.repeat(64)
const CREATED_AT = 1_800_000_000_000

async function browserReceipt(packageHash: string): Promise<ProductQualityGateReceiptV1> {
  const measurement = {
    runtimeVerifier: 'playwright-cdp' as const,
    browserName: 'chromium', browserVersion: 'fixture', platform: 'desktop',
    viewport: { width: 1440, height: 900 }, packageHash, previewHash: PREVIEW_HASH,
    firstInteractiveBytes: 2 * 1024 * 1024,
    cachedSceneLatenciesMs: Array.from({ length: 20 }, (_, index) => 30 + index),
    choiceInputLatenciesMs: Array.from({ length: 20 }, (_, index) => 10 + index),
    memorySamples: [
      { elapsedMs: 5 * 60 * 1000, usedHeapBytes: 100 * 1024 * 1024 },
      { elapsedMs: 30 * 60 * 1000, usedHeapBytes: 105 * 1024 * 1024 },
    ],
    measuredAt: CREATED_AT,
  }
  const receipt = await createProductBrowserPerformanceReceiptV1(measurement)
  const evidence = {
    schema: 'storyforge.product-browser-performance-evidence' as const,
    version: 1 as const,
    measurement,
    receipt,
  }
  const body = {
    schema: 'storyforge.product-quality-gate-receipt' as const, version: 1 as const,
    gateId: PRODUCT_BROWSER_PERFORMANCE_GATE_ID_V1, gateVersion: '1',
    verifierId: 'storyforge.playwright-browser-runtime', verifierVersion: '1',
    verifierKind: 'browser-runtime' as const,
    inputHashes: [packageHash, PREVIEW_HASH],
    environmentHash: await hashProductProductionValueV2(receipt.environment),
    measuredJson: canonicalProductProductionJsonV2(evidence), status: 'passed' as const,
    thresholdProfileId: 'storyforge.product-browser-performance.v1', thresholdProfileVersion: '1',
    evidenceRefs: [receipt.receiptHash], createdAt: CREATED_AT,
  }
  return { ...body, receiptHash: await hashProductProductionValueV2(body) }
}

async function mainRouteReceipt(
  runtime: ProductRuntimePackageV1,
  packageHash: string,
): Promise<ProductQualityGateReceiptV1> {
  const route = analyzeTextAdventureRouteQualityV1(runtime).routes[0]
  if (!route) throw new Error('[text-adventure-community-package-fixture] 主路线不存在')
  const routeEvents = [
    {
      kind: 'started' as const, sequence: 1, nodeKey: route.nodeKeys[0], fromNodeKey: null,
      choiceKey: null, toNodeKey: null, endingKey: null,
      payloadHash: await hashProductProductionValueV2({ entryNodeKey: route.nodeKeys[0] }), createdAt: CREATED_AT,
    },
    ...route.choiceKeys.map((choiceKey, index) => ({
      kind: 'choice' as const, sequence: index + 2, nodeKey: null,
      fromNodeKey: route.nodeKeys[index], choiceKey, toNodeKey: route.nodeKeys[index + 1], endingKey: null,
      payloadHash: HASH, createdAt: CREATED_AT + index + 1,
    })),
    {
      kind: 'ending' as const, sequence: route.choiceKeys.length + 2, nodeKey: null, fromNodeKey: null,
      choiceKey: null, toNodeKey: null, endingKey: route.endingNodeKey,
      payloadHash: HASH, createdAt: CREATED_AT + route.choiceKeys.length + 1,
    },
  ]
  const eventStreamHash = await hashProductProductionValueV2(routeEvents)
  const environment = {
    browserName: 'chromium', browserVersion: 'fixture', platform: 'desktop',
    viewport: { width: 1440, height: 900 },
  }
  const evidence = {
    schema: 'storyforge.product-main-route-playthrough-evidence' as const, version: 1 as const,
    packageHash, previewHash: PREVIEW_HASH, runtimeSourceHash: packageHash,
    sessionKind: 'text-adventure' as const, routeEvents, eventStreamHash,
    choiceCount: route.choiceKeys.length, endingKey: route.endingNodeKey, environment,
    confirmation: { kind: 'author-confirmed-main-route' as const, confirmedAt: CREATED_AT + 100 },
  }
  const body = {
    schema: 'storyforge.product-quality-gate-receipt' as const, version: 1 as const,
    gateId: PRODUCT_MAIN_ROUTE_PLAYTHROUGH_GATE_ID_V1, gateVersion: '1',
    verifierId: 'storyforge.author-main-route-confirmation', verifierVersion: '1',
    verifierKind: 'human-evidence' as const,
    inputHashes: [packageHash, PREVIEW_HASH, eventStreamHash],
    environmentHash: await hashProductProductionValueV2(environment),
    measuredJson: canonicalProductProductionJsonV2(evidence), status: 'passed' as const,
    thresholdProfileId: PRODUCT_MAIN_ROUTE_PLAYTHROUGH_POLICY_ID_V1, thresholdProfileVersion: '1',
    evidenceRefs: [eventStreamHash], createdAt: evidence.confirmation.confirmedAt,
  }
  return { ...body, receiptHash: await hashProductProductionValueV2(body) }
}

async function humanPlaytestReceipt(
  runtime: ProductRuntimePackageV1,
  packageHash: string,
  briefHash: string,
): Promise<ProductQualityGateReceiptV1> {
  const routes = analyzeTextAdventureRouteQualityV1(runtime).routes
  if (routes.length < 2) throw new Error('[text-adventure-community-package-fixture] 真人试玩需要两条路线')
  const environment = {
    browserName: 'chromium', browserVersion: 'fixture', platform: 'desktop',
    viewport: { width: 1440, height: 900 },
  }
  const actionDefinitions = runtime.adventure!.actions.slice(0, 6)
  if (actionDefinitions.length < 6) throw new Error('[text-adventure-community-package-fixture] 真人试玩行动不足')
  const createSession = async (
    participantRole: 'author' | 'independent-player',
    routeIndex: number,
    startedAt: number,
  ): Promise<TextAdventureHumanPlaytestSessionEvidenceV1> => {
    const route = routes[routeIndex]
    const completedAt = startedAt + 8 * 60 * 1000
    const routeEvents = [
      {
        kind: 'started' as const, sequence: 1, nodeKey: route.nodeKeys[0], fromNodeKey: null,
        choiceKey: null, toNodeKey: null, endingKey: null, payloadHash: HASH, createdAt: startedAt,
      },
      ...route.choiceKeys.map((choiceKey, index) => ({
        kind: 'choice' as const, sequence: 20 + index, nodeKey: null,
        fromNodeKey: route.nodeKeys[index], choiceKey, toNodeKey: route.nodeKeys[index + 1], endingKey: null,
        payloadHash: HASH, createdAt: startedAt + (index + 1) * 60_000,
      })),
      {
        kind: 'ending' as const, sequence: 40, nodeKey: null, fromNodeKey: null,
        choiceKey: null, toNodeKey: null, endingKey: route.endingNodeKey,
        payloadHash: HASH, createdAt: completedAt,
      },
    ]
    const actionEvents = await Promise.all(actionDefinitions.map(async (action, index) => ({
      sequence: 2 + index, commandId: `${participantRole}.action.${index + 1}`,
      actionKey: action.key, kind: action.kind, outcome: 'success' as const,
      payloadHash: await hashProductProductionValueV2({ actionKey: action.key, participantRole }),
      createdAt: startedAt + (index + 1) * 30_000,
    })))
    const eventStreamHash = await hashProductProductionValueV2([
      ...routeEvents.map(event => ({ stream: 'route' as const, sequence: event.sequence, event })),
      ...actionEvents.map(event => ({ stream: 'action' as const, sequence: event.sequence, event })),
    ].sort((left, right) => left.sequence - right.sequence || left.stream.localeCompare(right.stream)))
    const sessionBody = {
      participantRole,
      participant: {
        label: participantRole === 'author' ? '技术夹具作者' : '技术夹具独立玩家',
        declaration: participantRole === 'author'
          ? 'author-self-attestation' as const : 'not-involved-in-production' as const,
      },
      sessionKind: 'text-adventure' as const, routeEvents, actionEvents,
      eventStreamHash, endingKey: route.endingNodeKey, startedAt, completedAt, elapsedMs: completedAt - startedAt,
      choiceCount: route.choiceKeys.length, actionCount: actionEvents.length,
      meaningfulActionCount: actionEvents.length, dialogueActionCount: actionEvents.filter(event => event.kind === 'talk').length,
      thresholds: {
        targetPlayMinutes: 10, minimumElapsedMs: 450_000, maximumElapsedMs: 750_000,
        minimumChoiceCount: 2, minimumActionCount: 6,
      },
      environment,
      assessment: {
        ratings: { comprehension: 4, pacing: 4, agency: 4, emotionalImpact: 4 },
        blockingIssues: [],
        feedback: {
          comprehensionObstacles: '无', boringMoments: '无', errors: '无',
          choiceExperience: '选择后果清楚', endingFeedback: '结局回应了此前行动',
        },
        note: '',
      },
      confirmedAt: completedAt + 1, passed: true,
    }
    return { ...sessionBody, sessionEvidenceHash: await hashProductProductionValueV2(sessionBody) }
  }
  const sessions = [
    await createSession('author', 0, CREATED_AT),
    await createSession('independent-player', 1, CREATED_AT + 1_000_000),
  ]
  const evidence = {
    schema: 'storyforge.text-adventure-human-playtest-coverage-evidence' as const, version: 1 as const,
    buildNumber: 1, packageHash, previewHash: PREVIEW_HASH, briefHash, sessions,
    authorSessionEvidenceHash: sessions[0].sessionEvidenceHash,
    independentPlayerSessionEvidenceHash: sessions[1].sessionEvidenceHash,
    passed: true,
  }
  const sessionHashes = sessions.map(session => session.sessionEvidenceHash)
  const body = {
    schema: 'storyforge.product-quality-gate-receipt' as const, version: 1 as const,
    gateId: TEXT_ADVENTURE_HUMAN_PLAYTEST_GATE_ID_V1, gateVersion: '1',
    verifierId: 'storyforge.text-adventure-human-playtest-coverage', verifierVersion: '1',
    verifierKind: 'human-evidence' as const,
    inputHashes: [packageHash, PREVIEW_HASH, briefHash, ...sessionHashes],
    environmentHash: await hashProductProductionValueV2(sessions.map(session => ({
      participantRole: session.participantRole,
      sessionEvidenceHash: session.sessionEvidenceHash,
      environment: session.environment,
    }))),
    measuredJson: canonicalProductProductionJsonV2(evidence), status: 'passed' as const,
    thresholdProfileId: TEXT_ADVENTURE_HUMAN_PLAYTEST_POLICY_ID_V1, thresholdProfileVersion: '1',
    evidenceRefs: sessionHashes, createdAt: sessions[1].confirmedAt,
  }
  return { ...body, receiptHash: await hashProductProductionValueV2(body) }
}

/**
 * Technical fixture for package/lifecycle verification only. It is deliberately
 * short and must never be presented as the one-hour flagship product.
 */
export async function createTextAdventureCommunityPackageFixtureV1(): Promise<TextAdventureCommunityPackageV1> {
  const baseRuntime = createTextAdventureFoundationRuntimePackageV2({
    worldRelease: { id: 1, contentHash: HASH } as never,
    sourceCatalog: {
      ...CURRENT_PRODUCT_SOURCE_CATALOG,
      worldReference: { referenceHash: 'f'.repeat(64) },
    } as never,
  })
  const profile = baseRuntime.interaction!.profiles[0]
  const opening = baseRuntime.narrative.nodes.find(node => node.key === 'opening')!
  const crossroads = baseRuntime.narrative.nodes.find(node => node.key === 'crossroads')!
  const enterCore = baseRuntime.narrative.choices.find(choice => choice.choiceKey === 'choice.enter-core')!
  opening.successorKeys = ['approach']
  enterCore.targetNodeKey = 'approach'
  crossroads.effectsJson = '[]'
  baseRuntime.narrative.nodes.splice(1, 0,
    { key: 'approach', kind: 'scene', title: '灯芯回声', summary: '归还透镜后倾听两位守灯人的分歧。', conditionJson: '{}', effectsJson: '[]', successorKeys: ['stance'] },
    { key: 'stance', kind: 'choice', title: '先承诺什么', summary: '在终局前确定你愿意承担的代价。', conditionJson: '{}', effectsJson: '[]', successorKeys: ['crossroads'] },
  )
  baseRuntime.narrative.beats.push(
    { beatKey: 'beat.long-form', nodeKey: 'approach', kind: 'narration', speakerKey: null, text: '雾潮拍击塔身，你沿着每一道锈痕回想港城的人、海上的灯与自己许下的承诺。'.repeat(150), order: 0 },
    ...Array.from({ length: 5 }, (_, index) => ({
      beatKey: `beat.dialogue.${index + 1}`, nodeKey: 'approach', kind: 'dialogue' as const,
      speakerKey: profile.characterKey, text: `守钟人第${index + 1}次提醒你：真正的选择不是没有损失，而是清楚谁将承担损失。`, order: index + 1,
    })),
  )
  baseRuntime.narrative.choices.push(
    { choiceKey: 'choice.listen', sourceNodeKey: 'approach', text: '继续听完争论', description: '把每个人的担忧都记在心里。', unavailableReason: '', targetNodeKey: 'stance', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 0 },
    { choiceKey: 'choice.promise-people', sourceNodeKey: 'stance', text: '先承诺不放弃任何求救者', description: '把人的安全放在设施完好之前。', unavailableReason: '', targetNodeKey: 'crossroads', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: JSON.stringify([{ op: 'set', path: 'promise', value: 'people' }]), tags: [], order: 0 },
    { choiceKey: 'choice.promise-city', sourceNodeKey: 'stance', text: '先承诺不让港城失去屏障', description: '把整座城市的长期安全放在首位。', unavailableReason: '', targetNodeKey: 'crossroads', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: JSON.stringify([{ op: 'set', path: 'promise', value: 'city' }]), tags: [], order: 1 },
  )
  for (const choice of baseRuntime.narrative.choices.filter(item => item.sourceNodeKey === 'crossroads')) {
    choice.effectsJson = JSON.stringify([{ op: 'set', path: 'finalDecision', value: choice.choiceKey }])
  }
  for (const ending of baseRuntime.narrative.nodes.filter(node => node.kind === 'ending')) {
    const beat = baseRuntime.narrative.beats.find(item => item.nodeKey === ending.key)
    if (!beat) throw new Error(`[text-adventure-community-package-fixture] 结局缺少正文:${ending.key}`)
    beat.text += `此后的许多个清晨，人们仍会从这次抉择谈起：有人记住获救者的名字，也有人记住你没有逃避代价。${ending.title}不是一句胜利宣言，而是一份必须继续履行的责任。`.repeat(2)
  }
  const lookAction = baseRuntime.adventure!.actions.find(action => action.key === 'action.look.harbor')!
  lookAction.successText += '你逐行核对潮汐图上的旧标记、守灯人的笔记与历次风暴留下的航线变化。'.repeat(110)
  baseRuntime.adventure!.actions.find(action => action.key === 'action.move.core')!.description = '通过冻结的叙事选择进入终局。'
  const quest = baseRuntime.adventure!.quests.find(item => item.key === 'quest.beacon')!
  quest.stages[0].objectiveKeys.unshift('objective.prepare')
  quest.objectives.unshift({
    key: 'objective.prepare', title: '穿好守灯披风并确认出发装备', optional: false,
    stageKey: quest.stages[0].key, alternativeActionKeys: ['action.equip.cloak'],
  })
  baseRuntime.adventure!.actions.find(action => action.key === 'action.equip.cloak')!.successEffects.push({
    op: 'complete-objective', questKey: quest.key, objectiveKey: 'objective.prepare',
  })
  const towerScene = baseRuntime.adventure!.scenes.find(scene => scene.key === 'scene.tower')!
  towerScene.actionKeys.push('action.give.lens')
  baseRuntime.adventure!.actions.push({
    key: 'action.give.lens', kind: 'give', label: '把备用透镜交给守钟人',
    description: '把已取得的任务物品正式交付给守钟人，并在事件状态中记录所有权转移。',
    locationKey: 'location.tower', targetKey: 'item.beacon-lens',
    requirements: [{ itemKey: 'item.beacon-lens', itemQuantity: 1 }],
    rule: { kind: 'automatic' },
    successEffects: [{ op: 'transfer-item', itemKey: 'item.beacon-lens', quantity: 1, toOwnerKey: 'keeper' }],
    costlySuccessEffects: [], failureEffects: [],
    successText: '你把备用透镜交给守钟人；背包中的物品已经移交，守钟人接过了修复灯芯的责任。',
    costlySuccessText: '你最终完成了透镜交付。', failureText: '守钟人暂时无法接收透镜。',
    unavailableText: '需要先取得备用透镜，且该物品尚未交付。', repeatable: false,
    narrativeChoiceKey: null, interaction: null,
  })
  baseRuntime.definition.initialVariables.productAdapterCommercialReady = true
  const authoredRuntime = parseProductRuntimePackageV1(baseRuntime)
  const runtime = (await createFixtureProductReleaseManifestV1({ runtimePackage: authoredRuntime })).runtimePackage
  const brief = createCurrentProductBriefFixture({
    productType: 'text-adventure',
    worldRelease: { id: 1, contentHash: HASH } as never,
    sourceCatalog: {
      ...CURRENT_PRODUCT_SOURCE_CATALOG,
      worldReference: { referenceHash: 'f'.repeat(64) },
    } as never,
  })
  brief.qualityProfile = 'commercial-candidate'
  brief.scale.targetPlayMinutes = 10
  const normalizedBrief = parseProductProductionBriefV3(JSON.stringify(brief))
  const calculatedQuality = evaluateProductRuntimeProductQualityV1({ runtimePackage: runtime, brief: normalizedBrief })
  if (!calculatedQuality.passed) {
    throw new Error(`[text-adventure-community-package-fixture] 技术夹具未通过产品门:${JSON.stringify(calculatedQuality)}`)
  }
  const runtimePackageHash = await hashProductProductionValueV2(runtime)
  const autoplay = runTextAdventureAutoplayV1({ runtimePackage: runtime, buildNumber: 1, packageHash: runtimePackageHash })
  if (!autoplay.passed) {
    throw new Error(`[text-adventure-community-package-fixture] 技术夹具未通过自动游玩:${JSON.stringify(autoplay)}`)
  }
  const autoplayHash = await hashProductProductionValueV2(autoplay)
  const qualityReport: ProductBuildQualityReportV1 = {
    schema: 'storyforge.product-build-quality-report', version: 1, buildNumber: 1,
    packageHash: runtimePackageHash,
    hardGateResults: calculatedQuality.gates,
    softGateResults: [], mediaCoverage: 1, playable: true, releaseReady: true, warnings: [],
  }
  const qualityReportHash = await hashProductProductionValueV2(qualityReport)
  const buildManifest: ProductBuildManifestV1 = {
    schema: 'storyforge.product-build-manifest', version: 1,
    productionKey: 'candidate.fixture', buildNumber: 1, briefRevision: 1,
    briefHash: await hashProductProductionValueV2(normalizedBrief), planHash: 'd'.repeat(64), controlEpoch: 1,
    runtimePackageHash,
    artifactReceipts: [
      { artifactKey: 'quality.autoplay', version: 1, contentHash: autoplayHash, producerReceiptHash: null },
      { artifactKey: 'quality.report', version: 1, contentHash: qualityReportHash, producerReceiptHash: null },
    ],
    completedGateIds: qualityReport.hardGateResults.map(gate => gate.gateId), fallbackSummary: [],
  }
  const buildManifestHash = await hashProductProductionValueV2(buildManifest)
  const briefHash = await hashProductProductionValueV2(normalizedBrief)
  const rootReceiptHash = 'e'.repeat(64)
  const performance = await browserReceipt(runtimePackageHash)
  const mainRoute = await mainRouteReceipt(runtime, runtimePackageHash)
  const humanPlaytest = await humanPlaytestReceipt(runtime, runtimePackageHash, briefHash)
  const manifest = await createFixtureProductReleaseManifestV1({
    runtimePackage: runtime,
    productionProvenance: {
      productionKey: 'candidate.fixture', buildNumber: 1,
      buildManifestHash, rootTerminalReceiptHash: rootReceiptHash,
    },
    qualityReceiptHashes: [
      rootReceiptHash, buildManifestHash, qualityReportHash,
      performance.receiptHash, mainRoute.receiptHash, humanPlaytest.receiptHash,
    ],
  })
  const releaseContentHash = await hashProductProductionValueV2(manifest)
  const distributionBody = {
    schema: 'storyforge.product-distribution-bundle' as const, version: 2 as const,
    productRelease: { contentHash: releaseContentHash, manifest },
    sourceWorld: { contentHash: manifest.sourceWorldRelease.contentHash }, media: [],
  }
  const distributionBundle = {
    ...distributionBody, bundleHash: await hashProductProductionValueV2(distributionBody),
  }
  return createTextAdventureCommunityPackageV1({
    distributionBundle,
    evidence: {
      previewHash: PREVIEW_HASH, brief: normalizedBrief, buildManifest, qualityReport,
      artifacts: [{ artifactKey: 'quality.autoplay', contentHash: autoplayHash, payload: autoplay }],
      gateReceipts: [performance, mainRoute, humanPlaytest],
    },
  })
}
