import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  GAME_BROWSER_PERFORMANCE_POLICY_V1,
  type GameBrowserPerformanceMeasurementV1,
} from '../../src/lib/game-production/browser-performance'
import {
  listCompletedGameBuildPlaythroughsV1,
  readLatestGameBrowserPerformanceGateV1,
  readLatestGameMediaRuntimeGateV1,
  recordGameBrowserPerformanceMeasurementV1,
  recordGameBuildMainRoutePlaythroughV1,
  recordGameMediaRuntimeMeasurementV1,
  requirePassedGameBrowserPerformanceGateV1,
  requirePassedGameBuildMainRouteGateV1,
  requirePassedGameMediaRuntimeGateV1,
} from '../../src/lib/game-production/quality-receipts'
import { parseGameProductionBriefV3 } from '../../src/lib/game-production/contracts'
import { canonicalGameProductionJsonV2, hashGameProductionValueV2 } from '../../src/lib/game-production/hash'
import { createGameBuildPreviewManifestV1 } from '../../src/lib/game-production/preview-manifest'
import { parseGameRuntimePackageV2 } from '../../src/lib/game-production/runtime-package'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import { commitNarrativeChoice, readSimulationStateVersion } from '../../src/lib/simulation/runtime'
import { EMPTY_SIMULATION_STATE } from '../../src/lib/types'
import { CURRENT_PRODUCT_RESOURCE_KEYS, currentProductSelection } from '../helpers/current-product-world'

const PACKAGE_HASH = 'a'.repeat(64)
const PREVIEW_HASH = 'b'.repeat(64)
const MEDIA_HASH = 'c'.repeat(64)
function commercialBrief() {
  return parseGameProductionBriefV3({
    schema: 'storyforge.game-production-brief', version: 3,
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
  const briefHash = await hashGameProductionValueV2(brief)
  const projectId = await db.projects.add({
    name: 'browser receipt fixture', genre: 'interactive-fiction', genres: ['interactive-fiction'],
    status: 'drafting', description: '', targetWordCount: 1, createdAt: now, updatedAt: now,
  } as never) as number
  const owned = await ensureWorkspaceOwnership(projectId)
  const productionId = await db.gameProductions.add({
    ...owned.scope, productionKey: `perf.${projectId}`, title: '性能验收', status: 'preview-ready',
    stateRevision: 1, controlEpoch: 0, currentBriefRevision: 1, currentBuildNumber: 1,
    currentGameReleaseId: null, lastErrorJson: '{}',
    createdAt: now, updatedAt: now,
  }) as number
  await db.gameProductionBriefs.add({
    ...owned.scope, productionId, revision: 1, parentRevision: null, status: 'authorized',
    sourceWorldReleaseId: 1, sourceWorldContentHash: PACKAGE_HASH,
    userIntentSummary: brief.intent.openingSituation, unresolvedJson: '[]', estimateJson: '{}',
    briefJson: canonicalGameProductionJsonV2(brief), briefHash, authorizedAt: now, createdAt: now,
  })
  const buildId = await db.gameBuilds.add({
    ...owned.scope, productionId, buildNumber: 1, briefRevision: 1, briefHash,
    parentBuildNumber: null, sourceGameReleaseId: null, status: 'preview-ready', resumeState: null,
    stateRevision: 1, controlEpoch: 0, planRevision: 1, planJson: '{}', planHash: PACKAGE_HASH,
    budgetLedgerJson: '{}', manifestJson: '{}', manifestHash: PREVIEW_HASH, packageHash: PACKAGE_HASH,
    previewManifestJson: '{}', previewHash: PREVIEW_HASH, qualityReportJson: '{}', qualityReportHash: briefHash,
    compatibilityJson: '{}', rootTerminalReceiptHash: PACKAGE_HASH, adoptionIntentHash: null,
    releasedGameReleaseId: null, failureJson: '{}', authorizedAt: now,
    startedAt: now, completedAt: now, createdAt: now, updatedAt: now,
  }) as number
  return { ...owned, buildId }
}

async function mediaFixture(input: { width?: number; height?: number } = {}) {
  const width = input.width ?? 1280
  const height = input.height ?? 720
  const owned = await fixture()
  const brief = parseGameProductionBriefV3({
    ...commercialBrief(),
    media: {
      visualLevel: 'key-scenes', audioLevel: 'none', imageCount: 1,
      musicTrackCount: 0, sfxCount: 0, voiceLineCount: 0,
      requiredMediaKinds: ['background'],
    },
    productionBudget: { ...commercialBrief().productionBudget, maximumMediaCalls: 1 },
  })
  const briefHash = await hashGameProductionValueV2(brief)
  const runtimePackage = parseGameRuntimePackageV2({
    schema: 'storyforge.game-runtime-package', version: 2, productType: 'avg',
    definition: {
      gameKey: 'quality.media', title: '媒资验收', description: '',
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
  const build = await db.gameBuilds.get(owned.buildId)
  const production = await db.gameProductions.get(build!.productionId)
  const preview = await createGameBuildPreviewManifestV1({
    productionKey: production!.productionKey, buildNumber: 1,
    buildManifestHash: build!.manifestHash, runtimePackage,
    mediaBindings: [{
      assetKey: 'image.opening', artifactKey: 'media.visual.001', blobContentHash: MEDIA_HASH,
    }],
  })
  await db.gameProductionBriefs.where('[productionId+revision]').equals([build!.productionId, 1]).modify({
    briefJson: canonicalGameProductionJsonV2(brief), briefHash,
  })
  await db.gameBuilds.update(owned.buildId, {
    briefHash, packageHash: preview.packageHash, previewHash: preview.previewHash,
    previewManifestJson: canonicalGameProductionJsonV2(preview),
  })
  return { ...owned, packageHash: preview.packageHash, previewHash: preview.previewHash, briefHash }
}

async function completePreviewMainRoute(input: Awaited<ReturnType<typeof fixture>>): Promise<number> {
  const now = Date.now()
  const initial = structuredClone(EMPTY_SIMULATION_STATE)
  initial.narrative = {
    schema: 'storyforge.simulation-narrative', version: 2,
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
  const sessionId = await db.simulationSessions.add({
    ...input.scope, worldGroupId: null, worldReleaseId: null, gameReleaseId: null,
    gameBuildId: input.buildId, runtimeSourceHash: PACKAGE_HASH,
    narrativeModuleId: null, narrativeModuleExportId: 1, draftSnapshotHash: null,
    kind: 'avg', title: '作者主路线试玩', status: 'active', rulesetVersion: 1,
    seed: 'quality-receipt-route', canonSnapshotJson: '{}', initialStateJson: JSON.stringify(initial),
    parentSessionId: null, parentThroughSequence: null, createdAt: now, updatedAt: now,
  }) as number
  await db.simulationEvents.bulkAdd([
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
  const base = await readSimulationStateVersion(sessionId)
  await commitNarrativeChoice({
    sessionId, choiceKey: 'choice.finish', commandId: `quality-route:${sessionId}`,
    baseSequence: base.sequence, baseStateHash: base.stateHash,
  })
  return sessionId
}

async function confirmPreviewMainRoute(input: Awaited<ReturnType<typeof fixture>>, sessionId: number) {
  return recordGameBuildMainRoutePlaythroughV1({
    scope: input.scope, gameBuildId: input.buildId, simulationSessionId: sessionId,
    authorConfirmation: 'author-confirmed-main-route',
    environment: {
      browserName: 'chromium', browserVersion: 'fixture', platform: 'desktop',
      viewport: { width: 1440, height: 900 },
    },
  })
}

function measurement(measuredAt = Date.now()): GameBrowserPerformanceMeasurementV1 {
  return {
    browserName: 'chromium', browserVersion: 'fixture', platform: 'desktop',
    viewport: { width: 1440, height: 900 }, packageHash: PACKAGE_HASH, previewHash: PREVIEW_HASH,
    firstInteractiveBytes: 2 * 1024 * 1024,
    cachedSceneLatenciesMs: Array.from({ length: 20 }, (_, index) => 40 + index),
    choiceInputLatenciesMs: Array.from({ length: 20 }, (_, index) => 20 + index),
    memorySamples: [
      { elapsedMs: GAME_BROWSER_PERFORMANCE_POLICY_V1.warmupDurationMs, usedHeapBytes: 100 * 1024 * 1024 },
      { elapsedMs: GAME_BROWSER_PERFORMANCE_POLICY_V1.minimumLongRunDurationMs, usedHeapBytes: 108 * 1024 * 1024 },
    ],
    measuredAt,
  }
}

describe('R-GAMEPROD-1I · durable Build quality receipts', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('把完整原始测量、聚合结果和 gate hash 作为不可变 Build 证据保存，并对相同测量幂等', async () => {
    const owned = await fixture()
    const input = measurement()
    const first = await recordGameBrowserPerformanceMeasurementV1({
      scope: owned.scope, gameBuildId: owned.buildId, measurement: input,
    })
    const replay = await recordGameBrowserPerformanceMeasurementV1({
      scope: owned.scope, gameBuildId: owned.buildId, measurement: input,
    })
    expect(first.gateReceipt).toMatchObject({
      gateId: 'browser.performance.desktop', verifierKind: 'browser-runtime', status: 'passed',
      inputHashes: [PACKAGE_HASH, PREVIEW_HASH],
    })
    expect(first.evidence.receipt.passed).toBe(true)
    expect(replay.row.id).toBe(first.row.id)
    expect(await db.gameQualityGateReceipts.count()).toBe(1)
    expect(await db.gameBuilds.get(owned.buildId)).toMatchObject({ status: 'preview-ready', stateRevision: 1 })
    await expect(requirePassedGameBrowserPerformanceGateV1({
      scope: owned.scope, gameBuildId: owned.buildId,
    })).resolves.toMatchObject({ row: { receiptHash: first.row.receiptHash } })
    const sessionId = await completePreviewMainRoute(owned)
    await expect(listCompletedGameBuildPlaythroughsV1({
      scope: owned.scope, gameBuildId: owned.buildId,
    })).resolves.toMatchObject([{ sessionId, endingKey: 'ending', choiceCount: 1 }])
    const playthrough = await confirmPreviewMainRoute(owned, sessionId)
    expect(playthrough.gateReceipt).toMatchObject({
      gateId: 'playthrough.main-route', verifierKind: 'human-evidence', status: 'passed',
    })
    await expect(requirePassedGameBuildMainRouteGateV1({
      scope: owned.scope, gameBuildId: owned.buildId,
    })).resolves.toMatchObject({ row: { receiptHash: playthrough.row.receiptHash } })
    expect(await db.gameBuilds.get(owned.buildId)).toMatchObject({ status: 'release-ready', stateRevision: 2 })
  })

  it('短时 smoke 作为 failed 证据保留，且最新失败会阻止旧通过回执解锁商业发布', async () => {
    const owned = await fixture()
    const smoke = measurement(Date.now())
    smoke.memorySamples = [{ elapsedMs: 60_000, usedHeapBytes: 90 * 1024 * 1024 }]
    const failed = await recordGameBrowserPerformanceMeasurementV1({
      scope: owned.scope, gameBuildId: owned.buildId, measurement: smoke,
    })
    expect(failed.gateReceipt.status).toBe('failed')
    expect(failed.evidence.receipt.failures).toContain('long-run-incomplete')
    expect(await db.gameBuilds.get(owned.buildId)).toMatchObject({ status: 'preview-ready' })
    await expect(requirePassedGameBrowserPerformanceGateV1({
      scope: owned.scope, gameBuildId: owned.buildId,
    })).rejects.toThrow(/浏览器性能未通过/)

    const passedInput = measurement(smoke.measuredAt + 1)
    await recordGameBrowserPerformanceMeasurementV1({
      scope: owned.scope, gameBuildId: owned.buildId, measurement: passedInput,
    })
    expect(await db.gameBuilds.get(owned.buildId)).toMatchObject({ status: 'preview-ready' })
    await expect(requirePassedGameBrowserPerformanceGateV1({
      scope: owned.scope, gameBuildId: owned.buildId,
    })).resolves.toBeTruthy()

    const sessionId = await completePreviewMainRoute(owned)
    await confirmPreviewMainRoute(owned, sessionId)
    expect(await db.gameBuilds.get(owned.buildId)).toMatchObject({ status: 'release-ready' })

    const newestFailure = measurement(passedInput.measuredAt + 1)
    newestFailure.firstInteractiveBytes = 13 * 1024 * 1024
    await recordGameBrowserPerformanceMeasurementV1({
      scope: owned.scope, gameBuildId: owned.buildId, measurement: newestFailure,
    })
    const latest = await readLatestGameBrowserPerformanceGateV1({
      scope: owned.scope, gameBuildId: owned.buildId,
    })
    expect(latest?.gateReceipt.status).toBe('failed')
    expect(await db.gameBuilds.get(owned.buildId)).toMatchObject({ status: 'preview-ready' })
    await expect(requirePassedGameBrowserPerformanceGateV1({
      scope: owned.scope, gameBuildId: owned.buildId,
    })).rejects.toThrow(/first-interactive-bytes/)
  })

  it('Build hash 或 Work scope 不一致时零写入', async () => {
    const owned = await fixture()
    const badHash = measurement()
    badHash.previewHash = 'd'.repeat(64)
    await expect(recordGameBrowserPerformanceMeasurementV1({
      scope: owned.scope, gameBuildId: owned.buildId, measurement: badHash,
    })).rejects.toThrow(/测量输入 hash 与 Build Preview 不一致/)

    const other = await fixture()
    await expect(recordGameBrowserPerformanceMeasurementV1({
      scope: other.scope, gameBuildId: owned.buildId, measurement: measurement(),
    })).rejects.toThrow(/Build 不存在或跨 Work/)
    expect(await db.gameQualityGateReceipts.count()).toBe(0)
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
    const passed = await recordGameMediaRuntimeMeasurementV1({
      scope: owned.scope, gameBuildId: owned.buildId, measurement: passedMeasurement,
    })
    expect(passed.gateReceipt).toMatchObject({
      gateId: 'media.runtime.decode', verifierKind: 'browser-runtime', status: 'passed',
      gateVersion: '2', verifierVersion: '2',
      inputHashes: [owned.packageHash, owned.previewHash, owned.briefHash, MEDIA_HASH],
    })
    await expect(requirePassedGameMediaRuntimeGateV1({
      scope: owned.scope, gameBuildId: owned.buildId,
    })).resolves.toMatchObject({ row: { receiptHash: passed.row.receiptHash } })

    const failed = await recordGameMediaRuntimeMeasurementV1({
      scope: owned.scope, gameBuildId: owned.buildId,
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
    expect((await readLatestGameMediaRuntimeGateV1({
      scope: owned.scope, gameBuildId: owned.buildId,
    }))?.row.id).toBe(failed.row.id)
    await expect(requirePassedGameMediaRuntimeGateV1({
      scope: owned.scope, gameBuildId: owned.buildId,
    })).rejects.toThrow(/image.opening:image-decode-failed/)

    const tampered = structuredClone(passedMeasurement)
    tampered.assets[0].contentHash = 'd'.repeat(64)
    await expect(recordGameMediaRuntimeMeasurementV1({
      scope: owned.scope, gameBuildId: owned.buildId, measurement: tampered,
    })).rejects.toThrow(/Preview 不一致/)
  })

  it('浏览器能解码但商业图片尺寸不足时写入 failed receipt，并保持 Preview 不可发布', async () => {
    const owned = await mediaFixture({ width: 1024, height: 576 })
    const receipt = await recordGameMediaRuntimeMeasurementV1({
      scope: owned.scope, gameBuildId: owned.buildId,
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
    await expect(requirePassedGameMediaRuntimeGateV1({
      scope: owned.scope, gameBuildId: owned.buildId,
    })).rejects.toThrow(/image-background-dimensions-below-commercial-minimum/)
    expect(await db.gameBuilds.get(owned.buildId)).toMatchObject({ status: 'preview-ready' })
  })
})
