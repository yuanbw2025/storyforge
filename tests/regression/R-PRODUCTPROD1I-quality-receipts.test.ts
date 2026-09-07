import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  PRODUCT_BROWSER_PERFORMANCE_POLICY_V1,
  type ProductBrowserPerformanceMeasurementV1,
} from '../../src/lib/product-production/browser-performance'
import {
  listCompletedProductBuildPlaythroughsV1,
  readLatestProductBrowserPerformanceGateV1,
  readLatestProductMediaRuntimeGateV1,
  readLatestTextAdventureHumanPlaytestGateV1,
  recordProductBrowserPerformanceMeasurementV1,
  recordProductBuildMainRoutePlaythroughV1,
  recordProductMediaRuntimeMeasurementV1,
  recordTextAdventureHumanPlaytestV1,
  recordTextAdventureHumanVisualReviewV1,
  requirePassedProductBrowserPerformanceGateV1,
  requirePassedProductBuildMainRouteGateV1,
  requirePassedProductMediaRuntimeGateV1,
  requirePassedTextAdventureHumanPlaytestGateV1,
  requirePassedTextAdventureHumanVisualReviewGateV1,
} from '../../src/lib/product-production/quality-receipts'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createProductBuildPreviewManifestV1 } from '../../src/lib/product-production/preview-manifest'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import { buildUpperProductModulesV1 } from '../../src/lib/product-production/product-adapters'
import { parseProductMediaRequirementsArtifactV2 } from '../../src/lib/product-production/production-executor'
import { putMediaBlobObject } from '../../src/lib/product-production/media-blob-store'
import { compileTextAdventureProductionBriefV1 } from '../../src/lib/adventure/production-brief'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { commitNarrativeChoice, readProductRuntimeStateVersion } from '../../src/lib/avg/runtime-api'
import { commitAdventureAction, commitAdventureNarrativeChoice } from '../../src/lib/adventure/runtime-api'
import { createProductRuntimeInstance } from '../../src/lib/product/runtime-instances'
import { EMPTY_PRODUCT_RUNTIME_STATE } from '../../src/lib/types'
import { CURRENT_PRODUCT_RESOURCE_KEYS, CURRENT_PRODUCT_SOURCE_CATALOG, currentProductSelection } from '../helpers/current-product-world'
import {
  createTextAdventureFoundationContentV2,
  createTextAdventureFoundationNarrativeV2,
  createTextAdventureFoundationRuntimePackageV2,
} from '../helpers/text-adventure-v2-foundation'

const PACKAGE_HASH = 'a'.repeat(64)
const PREVIEW_HASH = 'b'.repeat(64)
const MEDIA_HASH = 'c'.repeat(64)
function commercialBrief() {
  return parseProductProductionBriefV3({
    schema: 'storyforge.product-production-brief', version: 3,
    source: {
      worldReleaseId: 1, worldContentHash: PACKAGE_HASH,
      selection: currentProductSelection('avg', {
        story: [CURRENT_PRODUCT_RESOURCE_KEYS.story],
        characters: [CURRENT_PRODUCT_RESOURCE_KEYS.character],
      }),
      startingPoint: {
        kind: 'mainline', title: '性能路线', summary: '冻结世界的主路线',
        sourceRefs: [CURRENT_PRODUCT_RESOURCE_KEYS.story],
        protagonistRefs: [CURRENT_PRODUCT_RESOURCE_KEYS.character], openingConflict: '潮门失去信号。',
      },
    },
    intent: {
      productType: 'avg', playerRole: '守灯人', protagonistRefs: [CURRENT_PRODUCT_RESOURCE_KEYS.character],
      openingSituation: '潮门失去信号。', coreExperience: ['可验证选择'], requiredFacts: ['世界事实不变'],
      forbiddenChanges: ['不写回世界'], contentBoundaries: [], tone: ['悬疑'],
    },
    scale: { scope: 'scene', targetPlayMinutes: 20, targetWordCount: 2_000, targetEndingCount: 2 },
    media: {
      visualLevel: 'none', audioLevel: 'none', imageCount: 0, musicTrackCount: 0,
      sfxCount: 0, voiceLineCount: 0, requiredMediaKinds: [],
    },
    consultationBudget: {
      maximumModelCalls: 1, maximumInputTokens: 1_000, maximumOutputTokens: 1_000, maximumCostUsd: null,
    },
    productionBudget: {
      maximumModelCalls: 4, maximumInputTokens: 20_000, maximumOutputTokens: 10_000,
      maximumCostUsd: null, maximumMediaCalls: 0, maximumDurationMs: 60_000,
      maximumStorageBytes: 1_000_000,
    },
    qualityProfile: 'commercial-candidate', capabilityRequirements: [],
    externalDataPolicy: {
      allowedDataClasses: ['world-selection'], forbiddenDataClasses: ['api-key'],
      allowReferenceImages: false, allowVoiceScripts: false,
    },
    fallbackPolicy: {
      allowTextOnly: false, allowExistingProjectMedia: true, allowProceduralAudio: false,
      onRequiredCapabilityMissing: 'pause',
    },
    completionContract: {
      requiresPlayablePreview: true, requiredGateIds: ['runtime.playable'],
      minimumMediaCoverage: 1, allowSoftWaivers: false,
    },
    unresolvedDecisionKeys: [],
  })
}

async function fixture() {
  const now = Date.now()
  const brief = commercialBrief()
  const briefHash = await hashProductProductionValueV2(brief)
  const owned = await createWorkspace({
    name: 'browser receipt fixture',
    genres: ['interactive-fiction'],
    status: 'drafting',
    description: '',
    targetWordCount: 1,
    enableMultiWorld: false,
  }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
  const projectId = owned.scope.projectId
  const productionId = await db.productProductions.add({
    ...owned.scope, productionKey: `perf.${projectId}`, title: '性能验收', status: 'preview-ready',
    productType: 'avg',
    stateRevision: 1, controlEpoch: 0, currentBriefRevision: 1, currentBuildNumber: 1,
    currentProductReleaseId: null, lastErrorJson: '{}',
    createdAt: now, updatedAt: now,
  }) as number
  await db.productProductionBriefs.add({
    ...owned.scope, productionId, revision: 1, parentRevision: null, status: 'authorized',
    sourceWorldReleaseId: 1, sourceWorldContentHash: PACKAGE_HASH,
    userIntentSummary: brief.intent.openingSituation, unresolvedJson: '[]', estimateJson: '{}',
    briefJson: canonicalProductProductionJsonV2(brief), briefHash,
    sourcePlanJson: '{}', sourcePlanHash: PACKAGE_HASH,
    confirmedBriefJson: canonicalProductProductionJsonV2(brief), confirmedBriefHash: briefHash,
    authorizedAt: now, createdAt: now,
  })
  const buildId = await db.productBuilds.add({
    ...owned.scope, productionId, buildNumber: 1, briefRevision: 1, briefHash,
    parentBuildNumber: null, sourceProductReleaseId: null, status: 'preview-ready', resumeState: null,
    stateRevision: 1, controlEpoch: 0, planRevision: 1, planJson: '{}', planHash: PACKAGE_HASH,
    budgetLedgerJson: '{}', manifestJson: '{}', manifestHash: PREVIEW_HASH, packageHash: PACKAGE_HASH,
    previewManifestJson: '{}', previewHash: PREVIEW_HASH, qualityReportJson: '{}', qualityReportHash: briefHash,
    compatibilityJson: '{}', rootTerminalReceiptHash: PACKAGE_HASH, adoptionIntentHash: null,
    releasedProductReleaseId: null, failureJson: '{}', authorizedAt: now,
    startedAt: now, completedAt: now, createdAt: now, updatedAt: now,
  }) as number
  return { ...owned, buildId }
}

async function mediaFixture(input: { width?: number; height?: number } = {}) {
  const width = input.width ?? 1280
  const height = input.height ?? 720
  const owned = await fixture()
  const brief = parseProductProductionBriefV3({
    ...commercialBrief(),
    media: {
      visualLevel: 'key-scenes', audioLevel: 'none', imageCount: 1,
      musicTrackCount: 0, sfxCount: 0, voiceLineCount: 0,
      requiredMediaKinds: ['background'],
    },
    productionBudget: { ...commercialBrief().productionBudget, maximumMediaCalls: 1 },
  })
  const briefHash = await hashProductProductionValueV2(brief)
  const runtimePackage = parseProductRuntimePackageV1({
    schema: 'storyforge.product-runtime-package', version: 1, productType: 'avg',
    definition: {
      productKey: 'quality.media', title: '媒资验收', description: '',
      enabledCapabilities: ['narrative', 'presentation'], rulesetVersion: 1, initialVariables: {},
    },
    sourceWorld: { contentHash: PACKAGE_HASH, selection: brief.source.selection },
    narrative: {
      moduleKind: 'main', moduleTitle: '媒资路线', entryNodeKey: 'ending',
      nodes: [{
        key: 'ending', kind: 'ending', title: '结局', summary: '', conditionJson: '{}',
        effectsJson: '[]', successorKeys: [],
      }],
      beats: [{
        beatKey: 'beat.ending', nodeKey: 'ending', kind: 'narration', speakerKey: null,
        text: '图片应当能在浏览器显示。', order: 0,
      }],
      choices: [],
    },
    presentation: {
      version: 1, cues: [], assets: [{
        assetKey: 'image.opening', version: 1, kind: 'background', name: '开场背景',
        mimeType: 'image/png', byteSize: 24, width, height, durationMs: null,
        contentHash: MEDIA_HASH, blobContentHash: MEDIA_HASH, source: 'agnes-image-2.1-flash',
        license: 'provider-commercial-terms', altText: '雾港开场', characterTag: '', sceneTag: 'opening',
      }],
    },
  })
  const build = await db.productBuilds.get(owned.buildId)
  const production = await db.productProductions.get(build!.productionId)
  const preview = await createProductBuildPreviewManifestV1({
    productionKey: production!.productionKey, buildNumber: 1,
    buildManifestHash: build!.manifestHash, runtimePackage,
    mediaBindings: [{
      assetKey: 'image.opening', artifactKey: 'media.visual.001', blobContentHash: MEDIA_HASH,
    }],
  })
  await db.productProductionBriefs.where('[productionId+revision]').equals([build!.productionId, 1]).modify({
    briefJson: canonicalProductProductionJsonV2(brief), briefHash,
  })
  await db.productBuilds.update(owned.buildId, {
    briefHash, packageHash: preview.packageHash, previewHash: preview.previewHash,
    previewManifestJson: canonicalProductProductionJsonV2(preview),
  })
  return { ...owned, packageHash: preview.packageHash, previewHash: preview.previewHash, briefHash }
}

async function textAdventureHumanVisualFixture() {
  const owned = await fixture()
  const scale = { scope: 'short-arc' as const, targetPlayMinutes: 60, targetWordCount: 15_000, targetEndingCount: 3 }
  const media = {
    visualLevel: 'key-scenes' as const, audioLevel: 'none' as const, imageCount: 1,
    musicTrackCount: 0, sfxCount: 0, voiceLineCount: 0, requiredMediaKinds: ['background' as const],
  }
  const brief = parseProductProductionBriefV3({
    ...commercialBrief(),
    source: {
      ...commercialBrief().source,
      selection: currentProductSelection('text-adventure', {
        characters: [CURRENT_PRODUCT_RESOURCE_KEYS.character],
        locations: [CURRENT_PRODUCT_RESOURCE_KEYS.location],
        items: [CURRENT_PRODUCT_RESOURCE_KEYS.artifact],
        quests: [CURRENT_PRODUCT_RESOURCE_KEYS.arc],
      }),
    },
    intent: { ...commercialBrief().intent, productType: 'text-adventure' },
    scale,
    media,
    productionBudget: { ...commercialBrief().productionBudget, maximumMediaCalls: 1 },
    textAdventure: compileTextAdventureProductionBriefV1({
      scale,
      media,
      draft: {
        targetRegionCount: 2, targetAreaCount: 5, targetLocationCount: 12, targetSceneCount: 18,
        targetSideQuestCount: 3, targetAmbientEventCount: 6, minimumDistinctRoutes: 2, confirmAll: true,
      },
    }),
  })
  const briefHash = await hashProductProductionValueV2(brief)
  const imageBlob = await putMediaBlobObject({
    scope: owned.scope,
    data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]).buffer,
    mimeType: 'image/png',
  })
  const assetKey = 'quality.text-adventure.build-1.image.opening'
  const artifactKey = 'media.visual.001'
  const narrative = createTextAdventureFoundationNarrativeV2()
  const modules = buildUpperProductModulesV1({ brief, narrative })
  const runtimePackage = parseProductRuntimePackageV1({
    schema: 'storyforge.product-runtime-package', version: 1, productType: 'text-adventure',
    definition: {
      productKey: 'quality.text-adventure', title: '逐图审查夹具', description: '验证三层图片质量证据。',
      enabledCapabilities: [...modules.enabledCapabilities, 'presentation'], rulesetVersion: 2,
      initialVariables: {},
    },
    sourceWorld: { contentHash: PACKAGE_HASH, selection: brief.source.selection },
    narrative,
    interaction: modules.interaction,
    adventure: {
      ...createTextAdventureFoundationContentV2(),
      media: { mode: 'key-illustrations', fallback: 'text-only', assetKeys: [assetKey] },
    },
    presentation: {
      version: 1, cues: [], assets: [{
        assetKey, version: 1, kind: 'background', name: '雾港开场', mimeType: 'image/png',
        byteSize: imageBlob.byteSize, width: 1280, height: 720, durationMs: null,
        contentHash: imageBlob.contentHash, blobContentHash: imageBlob.contentHash,
        source: 'fixture-provider', license: 'fixture-commercial-license', altText: '雾港灯塔开场',
        characterTag: '', sceneTag: 'opening',
      }],
    },
  })
  const build = (await db.productBuilds.get(owned.buildId))!
  const production = (await db.productProductions.get(build.productionId))!
  const preview = await createProductBuildPreviewManifestV1({
    productionKey: production.productionKey, buildNumber: build.buildNumber,
    buildManifestHash: build.manifestHash, runtimePackage,
    mediaBindings: [{ assetKey, artifactKey, blobContentHash: imageBlob.contentHash }],
  })
  const requirements = parseProductMediaRequirementsArtifactV2({
    schema: 'storyforge.product-media-requirements-artifact', version: 2,
    visual: [{
      artifactKey, mediaKind: 'background', sceneTag: 'opening', beatKey: 'beat.opening.1',
      prompt: '雾港灯塔在暴潮前点亮，构图清晰，不包含文字。', altText: '暴潮前的雾港灯塔',
      width: 1280, height: 720, palette: ['#172033', '#52647A', '#D8C6A0'],
      characterAnchorRefs: [], hardConstraints: [],
    }],
    audio: [],
  }, brief)
  const visualBible = { schema: 'fixture.visual-bible', version: 1, style: 'painterly maritime mystery' }
  const requirementsHash = await hashProductProductionValueV2(requirements)
  const visualBibleHash = await hashProductProductionValueV2(visualBible)
  const audit = {
    schema: 'storyforge.text-adventure-media-audit-artifact', version: 1,
    buildNumber: 1, requirementsHash, visualBibleHash,
    assets: [{
      artifactKey, status: 'fulfilled', assetKey, requirementHash: await hashProductProductionValueV2(requirements.visual[0]),
      contentHash: imageBlob.contentHash, mimeType: 'image/png', width: 1280, height: 720,
      source: 'fixture-provider', license: 'fixture-commercial-license', rightsComplete: true,
      fallbackReason: null,
    }],
    passed: true,
  }
  const auditHash = await hashProductProductionValueV2(audit)
  const visualReview = {
    schema: 'storyforge.text-adventure-visual-quality-review-artifact', version: 1,
    buildNumber: 1, mediaAuditHash: auditHash, status: 'passed',
    reviews: [{
      artifactKey, contentHash: imageBlob.contentHash, verdict: 'accept',
      scores: { requirementFit: 5, identityContinuity: 5, styleContinuity: 5, composition: 4, technicalCleanliness: 5 },
      issues: [], reviewSource: 'multimodal-model',
    }],
    blockingIssueCount: 0, providerReviewCompleted: true,
  }
  const now = Date.now()
  const jsonArtifact = async (artifactKeyValue: string, kind: 'asset-manifest' | 'visual-bible' | 'integration-report' | 'playtest-report', payload: unknown) => ({
    ...owned.scope, buildId: owned.buildId, artifactKey: artifactKeyValue, requirementKey: null,
    version: 1, kind, mediaKind: null, status: 'accepted' as const, producerRunId: null,
    producerReceiptHash: null, controlEpoch: 0, inputHash: PACKAGE_HASH,
    contentHash: await hashProductProductionValueV2(payload), payloadJson: canonicalProductProductionJsonV2(payload),
    metadataJson: '{}', qualityJson: '{}', rightsJson: '{}', blobObjectId: null,
    mimeType: null, byteSize: 1, parentArtifactHash: null, carriedFrom: null,
    createdAt: now, updatedAt: now,
  })
  await db.productBuildArtifacts.bulkAdd([
    await jsonArtifact('media.requirements', 'asset-manifest', requirements),
    await jsonArtifact('media.visual-bible', 'visual-bible', visualBible),
    await jsonArtifact('media.audit', 'integration-report', audit),
    await jsonArtifact('quality.visual-review', 'playtest-report', visualReview),
    {
      ...owned.scope, buildId: owned.buildId, artifactKey, requirementKey: null, version: 1,
      kind: 'image', mediaKind: 'background', status: 'accepted', producerRunId: null,
      producerReceiptHash: null, controlEpoch: 0, inputHash: PACKAGE_HASH,
      contentHash: imageBlob.contentHash,
      payloadJson: canonicalProductProductionJsonV2({ schema: 'storyforge.generated-media-artifact', version: 1 }),
      metadataJson: canonicalProductProductionJsonV2({ assetKey, name: '雾港开场' }),
      qualityJson: '{}', rightsJson: '{}', blobObjectId: imageBlob.id!, mimeType: 'image/png',
      byteSize: imageBlob.byteSize, parentArtifactHash: null, carriedFrom: null, createdAt: now, updatedAt: now,
    },
  ])
  await db.productProductions.update(production.id!, { productType: 'text-adventure' })
  await db.productProductionBriefs.where('[productionId+revision]').equals([production.id!, 1]).modify({
    briefJson: canonicalProductProductionJsonV2(brief), briefHash,
    confirmedBriefJson: canonicalProductProductionJsonV2(brief), confirmedBriefHash: briefHash,
  })
  await db.productBuilds.update(owned.buildId, {
    briefHash, packageHash: preview.packageHash, previewHash: preview.previewHash,
    previewManifestJson: canonicalProductProductionJsonV2(preview),
  })
  return { ...owned, assetKey, artifactKey, imageBlob }
}

async function completePreviewMainRoute(input: Awaited<ReturnType<typeof fixture>>): Promise<number> {
  const now = Date.now()
  const initial = structuredClone(EMPTY_PRODUCT_RUNTIME_STATE)
  initial.narrative = {
    schema: 'storyforge.product-narrative-runtime', version: 2,
    sourceModuleId: null, sourceModuleExportId: 1, moduleKind: 'main', moduleTitle: '性能主路线',
    sourceHash: PACKAGE_HASH, contentHash: PACKAGE_HASH,
    nodes: [
      { key: 'opening', kind: 'entry', title: '开场', summary: '进入路线', conditionJson: '{}', effectsJson: '[]', successorKeys: ['ending'] },
      { key: 'ending', kind: 'ending', title: '结局', summary: '完成路线', conditionJson: '{}', effectsJson: '[]', successorKeys: [] },
    ],
    currentNodeKey: 'opening', visitedNodeKeys: ['opening'], availableNodeKeys: ['ending'], variables: {},
    completed: false, beats: [],
    choices: [{
      choiceKey: 'choice.finish', sourceNodeKey: 'opening', text: '完成路线', description: '走到结局',
      unavailableReason: '', targetNodeKey: 'ending', displayConditionJson: '{}',
      availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 0,
    }],
    visibleChoiceKeys: ['choice.finish'], availableChoiceKeys: ['choice.finish'], choiceHistory: [],
    endingKey: null, completedAtSequence: null, lastEnteredNodeSequence: null,
  }
  const sessionId = await db.productRuntimeSessions.add({
    ...input.scope, worldGroupId: null, productReleaseId: null,
    productBuildId: input.buildId, runtimeSourceHash: PACKAGE_HASH,
    kind: 'avg', title: '作者主路线试玩', status: 'active', rulesetVersion: 1,
    seed: 'quality-receipt-route', canonSnapshotJson: '{}', initialStateJson: JSON.stringify(initial),
    parentSessionId: null, parentThroughSequence: null, createdAt: now, updatedAt: now,
  }) as number
  await db.productRuntimeEvents.bulkAdd([
    {
      projectId: input.scope.projectId, worldGroupId: null, sessionId, sequence: 1,
      type: 'narrative.started', actorKey: null, targetKey: 'opening',
      payloadJson: JSON.stringify({ entryNodeKey: 'opening', contentHash: PACKAGE_HASH }), createdAt: now,
    },
    {
      projectId: input.scope.projectId, worldGroupId: null, sessionId, sequence: 2,
      type: 'narrative.node.entered', actorKey: null, targetKey: 'opening',
      payloadJson: JSON.stringify({ nodeKey: 'opening', causeSequence: 1 }), createdAt: now,
    },
  ])
  const base = await readProductRuntimeStateVersion(sessionId)
  await commitNarrativeChoice({
    sessionId, choiceKey: 'choice.finish', commandId: `quality-route:${sessionId}`,
    baseSequence: base.sequence, baseStateHash: base.stateHash,
  })
  return sessionId
}

async function confirmPreviewMainRoute(input: Awaited<ReturnType<typeof fixture>>, sessionId: number) {
  return recordProductBuildMainRoutePlaythroughV1({
    scope: input.scope, productBuildId: input.buildId, productRuntimeSessionId: sessionId,
    authorConfirmation: 'author-confirmed-main-route',
    environment: {
      browserName: 'chromium', browserVersion: 'fixture', platform: 'desktop',
      viewport: { width: 1440, height: 900 },
    },
  })
}

async function textAdventurePlaytestFixture() {
  const owned = await fixture()
  const scale = { scope: 'scene' as const, targetPlayMinutes: 20, targetWordCount: 4_000, targetEndingCount: 2 }
  const media = {
    visualLevel: 'none' as const, audioLevel: 'none' as const, imageCount: 0,
    musicTrackCount: 0, sfxCount: 0, voiceLineCount: 0, requiredMediaKinds: [],
  }
  const brief = parseProductProductionBriefV3({
    ...commercialBrief(),
    source: {
      ...commercialBrief().source,
      selection: currentProductSelection('text-adventure', {
        characters: [CURRENT_PRODUCT_RESOURCE_KEYS.character],
        locations: [CURRENT_PRODUCT_RESOURCE_KEYS.location],
        items: [CURRENT_PRODUCT_RESOURCE_KEYS.artifact],
        quests: [CURRENT_PRODUCT_RESOURCE_KEYS.arc],
      }),
    },
    intent: { ...commercialBrief().intent, productType: 'text-adventure' },
    scale, media,
    textAdventure: compileTextAdventureProductionBriefV1({ scale, media, draft: { confirmAll: true } }),
  })
  const authored = createTextAdventureFoundationRuntimePackageV2({
    worldRelease: { id: 1, contentHash: PACKAGE_HASH } as never,
    sourceCatalog: {
      ...CURRENT_PRODUCT_SOURCE_CATALOG,
      worldReference: { referenceHash: 'f'.repeat(64) },
    } as never,
  })
  const opening = authored.narrative.nodes.find(node => node.key === 'opening')!
  const crossroads = authored.narrative.nodes.find(node => node.key === 'crossroads')!
  const enterCore = authored.narrative.choices.find(choice => choice.choiceKey === 'choice.enter-core')!
  opening.successorKeys = ['approach']
  enterCore.targetNodeKey = 'approach'
  crossroads.effectsJson = '[]'
  authored.narrative.nodes.splice(1, 0,
    { key: 'approach', kind: 'scene', title: '灯芯回声', summary: '听完两种代价。', conditionJson: '{}', effectsJson: '[]', successorKeys: ['stance'] },
    { key: 'stance', kind: 'choice', title: '先作承诺', summary: '决定先保护什么。', conditionJson: '{}', effectsJson: '[]', successorKeys: ['crossroads'] },
  )
  authored.narrative.choices.push(
    { choiceKey: 'choice.listen', sourceNodeKey: 'approach', text: '听完争论', description: '理解两种代价。', unavailableReason: '', targetNodeKey: 'stance', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 0 },
    { choiceKey: 'choice.promise-people', sourceNodeKey: 'stance', text: '先保护求救者', description: '承担港城风险。', unavailableReason: '', targetNodeKey: 'crossroads', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 0 },
    { choiceKey: 'choice.promise-city', sourceNodeKey: 'stance', text: '先保护港城', description: '承担海上风险。', unavailableReason: '', targetNodeKey: 'crossroads', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 1 },
  )
  const runtimePackage = parseProductRuntimePackageV1(authored)
  const briefHash = await hashProductProductionValueV2(brief)
  const packageHash = await hashProductProductionValueV2(runtimePackage)
  const build = (await db.productBuilds.get(owned.buildId))!
  const production = (await db.productProductions.get(build.productionId))!
  const preview = await createProductBuildPreviewManifestV1({
    productionKey: production.productionKey, buildNumber: build.buildNumber,
    buildManifestHash: build.manifestHash, runtimePackage, mediaBindings: [],
  })
  await db.productProductions.update(production.id!, { productType: 'text-adventure' })
  await db.productProductionBriefs.where('[productionId+revision]').equals([production.id!, 1]).modify({
    briefJson: canonicalProductProductionJsonV2(brief), briefHash,
    confirmedBriefJson: canonicalProductProductionJsonV2(brief), confirmedBriefHash: briefHash,
  })
  await db.productBuilds.update(owned.buildId, {
    briefHash, packageHash, previewHash: preview.previewHash,
    previewManifestJson: canonicalProductProductionJsonV2(preview),
  })
  return { ...owned, briefHash, packageHash, previewHash: preview.previewHash }
}

async function completeTextAdventureHumanPlaytest(
  input: Awaited<ReturnType<typeof textAdventurePlaytestFixture>>,
  route: 'rescue' | 'seal',
  elapsedMinutes = 16,
): Promise<number> {
  const session = await createProductRuntimeInstance({
    scope: input.scope, kind: 'text-adventure', title: `真人试玩-${route}`,
    productSource: {
      kind: 'build', productBuildId: input.buildId, expectedPreviewHash: input.previewHash,
    },
  })
  const act = async (actionKey: string) => {
    const state = await readProductRuntimeStateVersion(session.id!)
    await commitAdventureAction({
      sessionId: session.id!, actionKey, commandId: `human-${session.id}-${actionKey}`,
      baseSequence: state.sequence, baseStateHash: state.stateHash,
    })
  }
  for (const actionKey of [
    'action.look.harbor', 'action.equip.cloak', 'action.search.cache', 'action.move.marsh',
    'action.find.route', 'action.move.tower', 'action.take.lens', 'action.rest.tower',
  ]) await act(actionKey)
  await commitAdventureNarrativeChoice({ sessionId: session.id!, choiceKey: 'choice.enter-core', commandId: `human-${session.id}-choice-enter` })
  await act(route === 'rescue' ? 'action.prepare.rescue' : 'action.prepare.seal')
  await commitAdventureNarrativeChoice({ sessionId: session.id!, choiceKey: 'choice.listen', commandId: `human-${session.id}-choice-listen` })
  await commitAdventureNarrativeChoice({
    sessionId: session.id!, choiceKey: route === 'rescue' ? 'choice.promise-people' : 'choice.promise-city',
    commandId: `human-${session.id}-choice-promise`,
  })
  await commitAdventureNarrativeChoice({
    sessionId: session.id!, choiceKey: route === 'rescue' ? 'choice.rescue' : 'choice.seal',
    commandId: `human-${session.id}-choice-ending`,
  })
  const events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
  const endingAt = Date.now()
  const startedAt = endingAt - elapsedMinutes * 60_000
  await db.productRuntimeEvents.bulkPut(events.map((event, index) => ({
    ...event,
    createdAt: index === events.length - 1
      ? endingAt : startedAt + Math.floor((endingAt - startedAt) * index / Math.max(1, events.length - 1)),
  })))
  return session.id!
}

const passingHumanAssessment = () => ({
  ratings: { comprehension: 4, pacing: 4, agency: 4, emotionalImpact: 4 },
  blockingIssues: [],
  feedback: {
    comprehensionObstacles: '无', boringMoments: '无', errors: '无',
    choiceExperience: '选择与后果清楚', endingFeedback: '结局回应此前行动',
  },
  note: '',
})

const humanEnvironment = {
  browserName: 'chromium', browserVersion: 'fixture', platform: 'desktop',
  viewport: { width: 1440, height: 900 },
}

function measurement(measuredAt = Date.now()): ProductBrowserPerformanceMeasurementV1 {
  return {
    browserName: 'chromium', browserVersion: 'fixture', platform: 'desktop',
    viewport: { width: 1440, height: 900 }, packageHash: PACKAGE_HASH, previewHash: PREVIEW_HASH,
    firstInteractiveBytes: 2 * 1024 * 1024,
    cachedSceneLatenciesMs: Array.from({ length: 20 }, (_, index) => 40 + index),
    choiceInputLatenciesMs: Array.from({ length: 20 }, (_, index) => 20 + index),
    memorySamples: [
      { elapsedMs: PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.warmupDurationMs, usedHeapBytes: 100 * 1024 * 1024 },
      { elapsedMs: PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.minimumLongRunDurationMs, usedHeapBytes: 108 * 1024 * 1024 },
    ],
    measuredAt,
  }
}

describe('R-PRODUCTPROD-1I · durable Build quality receipts', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('把完整原始测量、聚合结果和 gate hash 作为不可变 Build 证据保存，并对相同测量幂等', async () => {
    const owned = await fixture()
    const input = measurement()
    const first = await recordProductBrowserPerformanceMeasurementV1({
      scope: owned.scope, productBuildId: owned.buildId, measurement: input,
    })
    const replay = await recordProductBrowserPerformanceMeasurementV1({
      scope: owned.scope, productBuildId: owned.buildId, measurement: input,
    })
    expect(first.gateReceipt).toMatchObject({
      gateId: 'browser.performance.desktop', verifierKind: 'browser-runtime', status: 'passed',
      inputHashes: [PACKAGE_HASH, PREVIEW_HASH],
    })
    expect(first.evidence.receipt.passed).toBe(true)
    expect(replay.row.id).toBe(first.row.id)
    expect(await db.productQualityGateReceipts.count()).toBe(1)
    expect(await db.productBuilds.get(owned.buildId)).toMatchObject({ status: 'preview-ready', stateRevision: 1 })
    await expect(requirePassedProductBrowserPerformanceGateV1({
      scope: owned.scope, productBuildId: owned.buildId,
    })).resolves.toMatchObject({ row: { receiptHash: first.row.receiptHash } })
    const sessionId = await completePreviewMainRoute(owned)
    await expect(listCompletedProductBuildPlaythroughsV1({
      scope: owned.scope, productBuildId: owned.buildId,
    })).resolves.toMatchObject([{ sessionId, endingKey: 'ending', choiceCount: 1 }])
    const playthrough = await confirmPreviewMainRoute(owned, sessionId)
    expect(playthrough.gateReceipt).toMatchObject({
      gateId: 'playthrough.main-route', verifierKind: 'human-evidence', status: 'passed',
    })
    await expect(requirePassedProductBuildMainRouteGateV1({
      scope: owned.scope, productBuildId: owned.buildId,
    })).resolves.toMatchObject({ row: { receiptHash: playthrough.row.receiptHash } })
    expect(await db.productBuilds.get(owned.buildId)).toMatchObject({ status: 'release-ready', stateRevision: 2 })
  })

  it('短时 smoke 作为 failed 证据保留，且最新失败会阻止旧通过回执解锁商业发布', async () => {
    const owned = await fixture()
    const smoke = measurement(Date.now())
    smoke.memorySamples = [{ elapsedMs: 60_000, usedHeapBytes: 90 * 1024 * 1024 }]
    const failed = await recordProductBrowserPerformanceMeasurementV1({
      scope: owned.scope, productBuildId: owned.buildId, measurement: smoke,
    })
    expect(failed.gateReceipt.status).toBe('failed')
    expect(failed.evidence.receipt.failures).toContain('long-run-incomplete')
    expect(await db.productBuilds.get(owned.buildId)).toMatchObject({ status: 'preview-ready' })
    await expect(requirePassedProductBrowserPerformanceGateV1({
      scope: owned.scope, productBuildId: owned.buildId,
    })).rejects.toThrow(/浏览器性能未通过/)

    const passedInput = measurement(smoke.measuredAt + 1)
    await recordProductBrowserPerformanceMeasurementV1({
      scope: owned.scope, productBuildId: owned.buildId, measurement: passedInput,
    })
    expect(await db.productBuilds.get(owned.buildId)).toMatchObject({ status: 'preview-ready' })
    await expect(requirePassedProductBrowserPerformanceGateV1({
      scope: owned.scope, productBuildId: owned.buildId,
    })).resolves.toBeTruthy()

    const sessionId = await completePreviewMainRoute(owned)
    await confirmPreviewMainRoute(owned, sessionId)
    expect(await db.productBuilds.get(owned.buildId)).toMatchObject({ status: 'release-ready' })

    const newestFailure = measurement(passedInput.measuredAt + 1)
    newestFailure.firstInteractiveBytes = 13 * 1024 * 1024
    await recordProductBrowserPerformanceMeasurementV1({
      scope: owned.scope, productBuildId: owned.buildId, measurement: newestFailure,
    })
    const latest = await readLatestProductBrowserPerformanceGateV1({
      scope: owned.scope, productBuildId: owned.buildId,
    })
    expect(latest?.gateReceipt.status).toBe('failed')
    expect(await db.productBuilds.get(owned.buildId)).toMatchObject({ status: 'preview-ready' })
    await expect(requirePassedProductBrowserPerformanceGateV1({
      scope: owned.scope, productBuildId: owned.buildId,
    })).rejects.toThrow(/first-interactive-bytes/)
  })

  it('Build hash 或 Work scope 不一致时零写入', async () => {
    const owned = await fixture()
    const badHash = measurement()
    badHash.previewHash = 'd'.repeat(64)
    await expect(recordProductBrowserPerformanceMeasurementV1({
      scope: owned.scope, productBuildId: owned.buildId, measurement: badHash,
    })).rejects.toThrow(/测量输入 hash 与 Build Preview 不一致/)

    const other = await fixture()
    await expect(recordProductBrowserPerformanceMeasurementV1({
      scope: other.scope, productBuildId: owned.buildId, measurement: measurement(),
    })).rejects.toThrow(/Build 不存在或跨 Work/)
    expect(await db.productQualityGateReceipts.count()).toBe(0)
  })

  it('把当前 Preview 的精确媒资 hash 与真实浏览器解码结果冻结为商业硬门', async () => {
    const owned = await mediaFixture()
    const passedMeasurement = {
      assets: [{
        assetKey: 'image.opening', contentHash: MEDIA_HASH, mimeType: 'image/png',
        mediaClass: 'image' as const, status: 'decoded' as const,
        decodedWidth: 1280, decodedHeight: 720, decodedDurationMs: null,
        decodedHasAlpha: false, decodedChannelCount: null, decodedSampleRateHz: null,
        integratedLufs: null, truePeakDbtp: null, loopSeamDbfs: null,
        policyFailures: [], failureCode: null,
      }],
      environment: {
        browserName: 'chromium', browserVersion: 'fixture', platform: 'desktop',
        viewport: { width: 1440, height: 900 },
      },
      measuredAt: Date.now(),
    }
    const passed = await recordProductMediaRuntimeMeasurementV1({
      scope: owned.scope, productBuildId: owned.buildId, measurement: passedMeasurement,
    })
    expect(passed.gateReceipt).toMatchObject({
      gateId: 'media.runtime.decode', verifierKind: 'browser-runtime', status: 'passed',
      gateVersion: '2', verifierVersion: '2',
      inputHashes: [owned.packageHash, owned.previewHash, owned.briefHash, MEDIA_HASH],
    })
    await expect(requirePassedProductMediaRuntimeGateV1({
      scope: owned.scope, productBuildId: owned.buildId,
    })).resolves.toMatchObject({ row: { receiptHash: passed.row.receiptHash } })

    const failed = await recordProductMediaRuntimeMeasurementV1({
      scope: owned.scope, productBuildId: owned.buildId,
      measurement: {
        ...passedMeasurement,
        measuredAt: passedMeasurement.measuredAt + 1,
        assets: [{
          ...passedMeasurement.assets[0], status: 'failed', decodedWidth: null, decodedHeight: null,
          decodedHasAlpha: null,
          failureCode: 'image-decode-failed',
        }],
      },
    })
    expect(failed.gateReceipt.status).toBe('failed')
    expect((await readLatestProductMediaRuntimeGateV1({
      scope: owned.scope, productBuildId: owned.buildId,
    }))?.row.id).toBe(failed.row.id)
    await expect(requirePassedProductMediaRuntimeGateV1({
      scope: owned.scope, productBuildId: owned.buildId,
    })).rejects.toThrow(/image.opening:image-decode-failed/)

    const tampered = structuredClone(passedMeasurement)
    tampered.assets[0].contentHash = 'd'.repeat(64)
    await expect(recordProductMediaRuntimeMeasurementV1({
      scope: owned.scope, productBuildId: owned.buildId, measurement: tampered,
    })).rejects.toThrow(/Preview 不一致/)
  })

  it('浏览器能解码但商业图片尺寸不足时写入 failed receipt，并保持 Preview 不可发布', async () => {
    const owned = await mediaFixture({ width: 1024, height: 576 })
    const receipt = await recordProductMediaRuntimeMeasurementV1({
      scope: owned.scope, productBuildId: owned.buildId,
      measurement: {
        assets: [{
          assetKey: 'image.opening', contentHash: MEDIA_HASH, mimeType: 'image/png',
          mediaClass: 'image', status: 'decoded', decodedWidth: 1024, decodedHeight: 576,
          decodedDurationMs: null, decodedHasAlpha: false, decodedChannelCount: null,
          decodedSampleRateHz: null, integratedLufs: null, truePeakDbtp: null,
          loopSeamDbfs: null, policyFailures: [], failureCode: null,
        }],
        environment: {
          browserName: 'chromium', browserVersion: 'fixture', platform: 'desktop',
          viewport: { width: 1440, height: 900 },
        },
        measuredAt: Date.now(),
      },
    })
    expect(receipt.gateReceipt.status).toBe('failed')
    expect(receipt.evidence.assets[0].policyFailures)
      .toEqual(['image-background-dimensions-below-commercial-minimum'])
    await expect(requirePassedProductMediaRuntimeGateV1({
      scope: owned.scope, productBuildId: owned.buildId,
    })).rejects.toThrow(/image-background-dimensions-below-commercial-minimum/)
    expect(await db.productBuilds.get(owned.buildId)).toMatchObject({ status: 'preview-ready' })
  })

  it('要求作者与独立玩家使用两个不同完整会话，单角色只能留下 needs-human 回执', async () => {
    const owned = await textAdventurePlaytestFixture()
    const authorSessionId = await completeTextAdventureHumanPlaytest(owned, 'rescue')
    const author = await recordTextAdventureHumanPlaytestV1({
      scope: owned.scope, productBuildId: owned.buildId, productRuntimeSessionId: authorSessionId,
      participantRole: 'author', participantLabel: '测试作者', participantDeclaration: 'author-self-attestation',
      assessment: passingHumanAssessment(), environment: humanEnvironment,
    })
    expect(author.gateReceipt).toMatchObject({
      gateId: 'text-adventure.playtest.human-coverage', status: 'needs-human', verifierKind: 'human-evidence',
    })
    expect(author.evidence.sessions[0]).toMatchObject({
      participantRole: 'author', elapsedMs: 16 * 60_000, choiceCount: 4,
      meaningfulActionCount: 10, passed: true,
    })
    await expect(requirePassedTextAdventureHumanPlaytestGateV1({
      scope: owned.scope, productBuildId: owned.buildId,
    })).rejects.toThrow(/尚未由作者与独立玩家分别通过/)
    await expect(recordTextAdventureHumanPlaytestV1({
      scope: owned.scope, productBuildId: owned.buildId, productRuntimeSessionId: authorSessionId,
      participantRole: 'independent-player', participantLabel: '独立玩家甲',
      participantDeclaration: 'not-involved-in-production',
      assessment: passingHumanAssessment(), environment: humanEnvironment,
    })).rejects.toThrow(/同一个事件流不能同时冒充/)

    const independentSessionId = await completeTextAdventureHumanPlaytest(owned, 'seal')
    const completed = await recordTextAdventureHumanPlaytestV1({
      scope: owned.scope, productBuildId: owned.buildId, productRuntimeSessionId: independentSessionId,
      participantRole: 'independent-player', participantLabel: '独立玩家甲',
      participantDeclaration: 'not-involved-in-production',
      assessment: passingHumanAssessment(), environment: humanEnvironment,
    })
    expect(completed.gateReceipt.status).toBe('passed')
    expect(completed.evidence).toMatchObject({ passed: true })
    expect(completed.evidence.sessions.map(item => item.participantRole)).toEqual(['author', 'independent-player'])
    expect(completed.evidence.sessions[0].eventStreamHash).not.toBe(completed.evidence.sessions[1].eventStreamHash)
    await expect(requirePassedTextAdventureHumanPlaytestGateV1({
      scope: owned.scope, productBuildId: owned.buildId,
    })).resolves.toMatchObject({ row: { receiptHash: completed.row.receiptHash } })
  })

  it('过短、交互量不足、低评分或未关闭 blocking 问题会冻结失败证据且拒绝篡改', async () => {
    const owned = await textAdventurePlaytestFixture()
    const sessionId = await completeTextAdventureHumanPlaytest(owned, 'rescue', 2)
    const failed = await recordTextAdventureHumanPlaytestV1({
      scope: owned.scope, productBuildId: owned.buildId, productRuntimeSessionId: sessionId,
      participantRole: 'author', participantLabel: '测试作者',
      participantDeclaration: 'author-self-attestation', environment: humanEnvironment,
      assessment: {
        ...passingHumanAssessment(),
        ratings: { comprehension: 4, pacing: 2, agency: 4, emotionalImpact: 4 },
        blockingIssues: ['选择后任务状态没有及时刷新'],
      },
    })
    expect(failed.gateReceipt.status).toBe('failed')
    expect(failed.evidence.sessions[0]).toMatchObject({ elapsedMs: 2 * 60_000, passed: false })
    await expect(requirePassedTextAdventureHumanPlaytestGateV1({
      scope: owned.scope, productBuildId: owned.buildId,
    })).rejects.toThrow(/尚未由作者与独立玩家分别通过/)
    const row = (await db.productQualityGateReceipts.get(failed.row.id!))!
    const receipt = JSON.parse(row.receiptJson)
    const evidence = JSON.parse(receipt.measuredJson)
    evidence.sessions[0].meaningfulActionCount += 100
    receipt.measuredJson = canonicalProductProductionJsonV2(evidence)
    await db.productQualityGateReceipts.update(row.id!, { receiptJson: canonicalProductProductionJsonV2(receipt) })
    await expect(readLatestTextAdventureHumanPlaytestGateV1({
      scope: owned.scope, productBuildId: owned.buildId,
    })).rejects.toThrow(/receiptHash 校验失败/)
  })

  it('把独立 Visual QA 已接受的每张图片交给作者逐图确认，并冻结精确 Build/Artifact/Blob 证据', async () => {
    const owned = await textAdventureHumanVisualFixture()
    const rejected = await recordTextAdventureHumanVisualReviewV1({
      scope: owned.scope, productBuildId: owned.buildId,
      decisions: [{ assetKey: owned.assetKey, decision: 'rejected', note: '灯塔主体过暗，需要提高视觉焦点。' }],
    })
    expect(rejected.gateReceipt).toMatchObject({
      gateId: 'text-adventure.visual.author-approval', verifierKind: 'human-evidence', status: 'failed',
    })
    expect(rejected.evidence.assets[0]).toMatchObject({
      assetKey: owned.assetKey, artifactKey: owned.artifactKey,
      contentHash: owned.imageBlob.contentHash, blobContentHash: owned.imageBlob.contentHash,
      decision: 'rejected', note: '灯塔主体过暗，需要提高视觉焦点。',
    })
    await expect(requirePassedTextAdventureHumanVisualReviewGateV1({
      scope: owned.scope, productBuildId: owned.buildId,
    })).rejects.toThrow(/逐图确认未通过/)
    expect(await db.productBuilds.get(owned.buildId)).toMatchObject({ status: 'preview-ready' })

    const approved = await recordTextAdventureHumanVisualReviewV1({
      scope: owned.scope, productBuildId: owned.buildId,
      decisions: [{ assetKey: owned.assetKey, decision: 'approved', note: '构图、题材与剧透边界均可接受。' }],
    })
    expect(approved.gateReceipt.status).toBe('passed')
    await expect(requirePassedTextAdventureHumanVisualReviewGateV1({
      scope: owned.scope, productBuildId: owned.buildId,
    })).resolves.toMatchObject({ row: { receiptHash: approved.row.receiptHash } })
    const repeated = await recordTextAdventureHumanVisualReviewV1({
      scope: owned.scope, productBuildId: owned.buildId,
      decisions: [{ assetKey: owned.assetKey, decision: 'approved', note: '构图、题材与剧透边界均可接受。' }],
    })
    expect(repeated.row.id).toBe(approved.row.id)
    expect(repeated.gateReceipt.receiptHash).toBe(approved.gateReceipt.receiptHash)
    expect(await db.productQualityGateReceipts.where('gateId')
      .equals('text-adventure.visual.author-approval').count()).toBe(2)
  })

  it('逐图决定不完整、退回无理由或图片 Blob 在确认后变化时拒绝证据复用', async () => {
    const owned = await textAdventureHumanVisualFixture()
    await expect(recordTextAdventureHumanVisualReviewV1({
      scope: owned.scope, productBuildId: owned.buildId, decisions: [],
    })).rejects.toThrow(/未完整覆盖/)
    await expect(recordTextAdventureHumanVisualReviewV1({
      scope: owned.scope, productBuildId: owned.buildId,
      decisions: [{ assetKey: owned.assetKey, decision: 'rejected', note: '   ' }],
    })).rejects.toThrow(/退回必须填写原因/)
    expect(await db.productQualityGateReceipts.where('gateId')
      .equals('text-adventure.visual.author-approval').count()).toBe(0)

    await recordTextAdventureHumanVisualReviewV1({
      scope: owned.scope, productBuildId: owned.buildId,
      decisions: [{ assetKey: owned.assetKey, decision: 'approved', note: '' }],
    })
    await db.mediaBlobObjects.update(owned.imageBlob.id!, { byteSize: owned.imageBlob.byteSize + 1 })
    await expect(requirePassedTextAdventureHumanVisualReviewGateV1({
      scope: owned.scope, productBuildId: owned.buildId,
    })).rejects.toThrow(/元数据与冻结引用不匹配|大小不一致|数据长度不一致/)
  })
})
