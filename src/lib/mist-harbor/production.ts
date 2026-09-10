import { openWorldSemanticResourceCatalogV1 } from '../context-gateway/world-release-client'
import { db } from '../db/schema'
import { resolveScope } from '../workspace/scope'
import type {
  ProductBuildQualityReportV1,
  ProductProductionBriefV3,
  ProductProductionPlanV3,
  WorkspaceScope,
} from '../types'
import { loadProductProductionConsultationSourceV2 } from '../product-production/world-source'
import {
  compileUpperProductWorldRoleBindingsV1,
  upperProductAllowedAreasV1,
  upperProductAllowedContextKindsV1,
} from '../product/world-requirement-adapters'
import {
  createProductProductionWithBriefV1,
  listProductProductionWorkspaceV1,
  readProductProductionDetailsV1,
  publishProductProductionV1,
  retryProductProductionBlockerV1,
  archiveProductProductionV1,
} from '../product-production/service'
import { executeProductProductionCommand } from '../product-production/commands'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { parseProductRuntimePackageV1 } from '../product-production/runtime-package'
import { evaluateProductRuntimeProductQualityV1 } from '../product-production/product-quality'
import {
  runProductProductionUntilBlockedV1,
  type ProductProductionTaskExecutorV1,
} from '../product-production/scheduler'
import { assertProductReleaseUnchanged, parseAnyProductReleaseManifest } from '../product/releases'

import {
  compileMistHarbor,
  mistProductKey,
  mistProductType,
  mistTitle,
  type MistHarborEdition,
} from './compiler'
import { createMistHarborWorld } from '../world-engine/mist-harbor-preset'
import { loadMistHarborMedia, mistMediaKeys, frozenMistMedia } from './media'

export async function createMistHarborBrief(
  scope: WorkspaceScope,
  worldReleaseId: number,
  edition: MistHarborEdition,
): Promise<ProductProductionBriefV3> {
  const source = await loadProductProductionConsultationSourceV2({ scope, worldReleaseId })
  const catalog = await openWorldSemanticResourceCatalogV1({
    localReleaseRecordId: worldReleaseId,
    expectedProjectId: scope.projectId,
    expectedWorldId: scope.worldId,
  })
  const areas = upperProductAllowedAreasV1(mistProductType(edition))
  const kinds = upperProductAllowedContextKindsV1(mistProductType(edition))
  const allowed = new Set(
    catalog.resources
      .filter(
        (row) => row.worldSemantic && areas.includes(row.worldSemantic.area) && kinds.includes(row.kind),
      )
      .map((row) => row.resourceKey),
  )
  const selected = { ...source.selectionCatalog }
  for (const key of Object.keys(selected) as Array<keyof typeof selected>)
    selected[key] = selected[key].filter((resource) => allowed.has(resource))
  const roleBindings = compileUpperProductWorldRoleBindingsV1(mistProductType(edition), selected)
  const resourceKeys = [...new Set(Object.values(selected).flat())].sort()
  return parseProductProductionBriefV3({
    schema: 'storyforge.product-production-brief',
    version: 3,
    source: {
      worldReleaseId,
      worldContentHash: source.worldReference.releaseHash,
      selection: {
        schema: 'storyforge.product-world-source-selection',
        version: 1,
        productType: mistProductType(edition),
        worldReferenceHash: source.worldReference.referenceHash,
        resourceKeys,
        roleBindings,
      },
      startingPoint: {
        kind: 'mainline',
        title: mistTitle(edition),
        summary: '失潮之夜，港民姓名开始消失。',
        sourceRefs: resourceKeys,
        protagonistRefs: roleBindings.participants ?? [],
        openingConflict: '在黑潮抵达前调查旧案，决定潮汐钟的命运。',
      },
    },
    intent: {
      productType: mistProductType(edition),
      playerRole: '林澈，雾港守灯人',
      protagonistRefs: roleBindings.participants ?? [],
      openingSituation: '潮汐迟到十三分钟。',
      coreExperience: ['调查失名之谜', '选择真相、安全或远航'],
      requiredFacts: ['黑潮事故四十七名遇难者', '主钟接管需要三枚权限印记'],
      forbiddenChanges: ['不得让父亲突然生还', '不得以无来源神力解决危机'],
      contentBoundaries: ['涉及灾难与失亲，无血腥画面'],
      tone: ['工业海港悬疑', '克制'],
    },
    scale: { scope: 'multi-chapter', targetPlayMinutes: 30, targetWordCount: 7000, targetEndingCount: 3 },
    media: {
      visualLevel: edition === 'avg' ? 'key-scenes' : 'none',
      audioLevel: 'none',
      imageCount: edition === 'avg' ? 17 : 0,
      musicTrackCount: 0,
      sfxCount: 0,
      voiceLineCount: 0,
      requiredMediaKinds: edition === 'avg' ? ['background', 'character-pose', 'cg'] : [],
    },
    consultationBudget: {
      maximumModelCalls: 0,
      maximumInputTokens: 0,
      maximumOutputTokens: 0,
      maximumCostUsd: 0,
    },
    productionBudget: {
      maximumModelCalls: 0,
      maximumInputTokens: 100000,
      maximumOutputTokens: 0,
      maximumCostUsd: 0,
      maximumMediaCalls: 0,
      maximumDurationMs: 300000,
      maximumStorageBytes: 20000000,
    },
    qualityProfile: 'internal',
    capabilityRequirements: [],
    externalDataPolicy: {
      allowedDataClasses: ['world-selection'],
      forbiddenDataClasses: ['api-key'],
      allowReferenceImages: false,
      allowVoiceScripts: false,
    },
    fallbackPolicy: {
      allowTextOnly: true,
      allowExistingProjectMedia: false,
      allowProceduralAudio: true,
      onRequiredCapabilityMissing: 'pause',
    },
    completionContract: {
      requiresPlayablePreview: true,
      requiredGateIds: [
        'runtime.package.valid',
        'runtime.playable',
        'narrative.graph.valid',
        'rights.complete',
        'mist-harbor.authored-content',
      ],
      minimumMediaCoverage: 0,
      allowSoftWaivers: false,
    },
    unresolvedDecisionKeys: [],
  })
}

export function createMistHarborPlan(
  brief: ProductProductionBriefV3,
  briefHash: string,
  buildNumber: number,
  controlEpoch: number,
): ProductProductionPlanV3 {
  const media = brief.intent.productType === 'avg'
  const tasks = [
    ...(media
      ? [
          {
            taskKey: 'media.import',
            kind: 'visual-assets',
            lane: 'visual',
            outputArtifactKeys: mistMediaKeys,
            inputArtifactKeys: [] as string[],
            dependsOn: [] as string[],
            acceptanceGateIds: ['mist-harbor.media-integrity'],
          },
        ]
      : []),
    {
      taskKey: 'runtime.integrate',
      kind: 'runtime-package',
      lane: 'integration',
      outputArtifactKeys: ['runtime.package'],
      inputArtifactKeys: media ? mistMediaKeys : [],
      dependsOn: media ? ['media.import'] : [],
      acceptanceGateIds: ['runtime.package.valid', 'narrative.graph.valid', 'rights.complete'],
    },
    {
      taskKey: 'quality.verify',
      kind: 'quality-report',
      lane: 'qa',
      outputArtifactKeys: ['quality.report'],
      inputArtifactKeys: ['runtime.package'],
      dependsOn: ['runtime.integrate'],
      acceptanceGateIds: ['runtime.playable', 'mist-harbor.authored-content'],
    },
  ]
  return parseProductProductionPlanV3(
    {
      schema: 'storyforge.product-production-plan',
      version: 3,
      productType: brief.intent.productType,
      briefHash,
      buildNumber,
      controlEpoch,
      concurrency: { maximumCostBearingTasks: 1, maximumTextProviderTasks: 1, maximumMediaProviderTasks: 1 },
      terminalTaskKey: 'quality.verify',
      tasks: tasks.map((task) => ({
        ...task,
        skillId: null,
        executionMode: 'deterministic',
        requirementKeys: [],
        capabilityRequirementKeys: [],
        concurrencyGroup: task.lane,
        subjectLockKeys: task.outputArtifactKeys,
        priority: 50,
        maxAttempts: 1,
        timeoutMs: 120000,
        failurePolicy: 'fail-build',
        fallbackTaskKey: null,
        reuse: null,
        requiredReceipts: task.dependsOn.map((taskKey) => ({ taskKey, receiptHash: null })),
        budgetReservation: {
          modelCalls: 0,
          inputTokens: task.kind === 'runtime-package' ? 100000 : 0,
          outputTokens: 0,
          mediaCalls: 0,
          maximumCostUsd: 0,
          durationMs: 90000,
          storageBytes: 6000000,
        },
      })),
    },
    brief,
    briefHash,
  )
}
export function mistHarborExecutor(
  edition: MistHarborEdition,
  brief: ProductProductionBriefV3,
): ProductProductionTaskExecutorV1 {
  return async (task) => {
    const start = performance.now()
    const usage = (storageBytes = 0) => ({
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      mediaCalls: 0,
      costUsd: 0,
      durationMs: Math.ceil(performance.now() - start),
      storageBytes,
    })
    if (task.task.taskKey === 'media.import') {
      const artifacts = await loadMistHarborMedia(task)
      return {
        artifacts,
        passedGateIds: task.task.acceptanceGateIds,
        usage: usage(artifacts.reduce((sum, item) => sum + (item.byteSize ?? 0), 0)),
      }
    }
    if (task.task.kind === 'runtime-package') {
      if (!task.contextText.trim()) throw new Error('雾港缺少冻结世界读取证据')
      const pkg = compileMistHarbor(
        edition,
        brief,
        edition === 'avg' ? frozenMistMedia(task.inputArtifacts) : [],
      )
      return {
        artifacts: [
          {
            artifactKey: 'runtime.package',
            kind: 'presentation',
            payload: pkg,
            quality: {
              compiler: mistProductKey(edition),
              sourceContextHash: await hashProductProductionValueV2(task.contextText),
            },
            rights: {
              origin: 'storyforge-authored-roadshow',
              sourceCommit: '618d388e',
              license: 'StoryForge 项目内演示与产品使用',
            },
          },
        ],
        passedGateIds: task.task.acceptanceGateIds,
        usage: usage(),
      }
    }
    if (task.task.kind !== 'quality-report') throw new Error('不支持的雾港生产任务')
    const artifact = task.inputArtifacts.find((item) => item.artifactKey === 'runtime.package')
    if (!artifact) throw new Error('雾港运行包缺失')
    const pkg = parseProductRuntimePackageV1(artifact.payloadJson)
    const quality = evaluateProductRuntimeProductQualityV1({ runtimePackage: pkg, brief })
    const intact =
      pkg.narrative.nodes.length === 18 &&
      pkg.narrative.beats.length === 158 &&
      (edition !== 'avg' || pkg.presentation?.assets.length === 17)
    if (!intact || !quality.passed)
      throw new Error('雾港内容核验失败：' + JSON.stringify(quality.gates.filter((gate) => !gate.passed)))
    const packageHash = await hashProductProductionValueV2(pkg)
    const report: ProductBuildQualityReportV1 = {
      schema: 'storyforge.product-build-quality-report',
      version: 1,
      buildNumber: task.buildNumber,
      packageHash,
      hardGateResults: brief.completionContract.requiredGateIds.map((gateId) => ({
        gateId,
        passed: true,
        evidence: [packageHash, '18 nodes / 158 beats / 3 endings; authored content; no model calls'],
      })),
      softGateResults: quality.gates,
      mediaCoverage: 1,
      playable: true,
      releaseReady: true,
      warnings: ['预写内置故事，无运行时模型对话或配音。'],
    }
    return {
      artifacts: [
        { artifactKey: 'quality.report', kind: 'quality-report', payload: report, quality: {}, rights: {} },
      ],
      passedGateIds: task.task.acceptanceGateIds,
      usage: usage(),
    }
  }
}

let localInstallationQueue: Promise<unknown> = Promise.resolve()

export function mistHarborInstallation(edition: MistHarborEdition) {
  let installation: Promise<{ scope: WorkspaceScope; releaseId: number }> | null = null

  /** Backups remap workspace IDs; recognize the immutable product, not a local ID. */
  async function findInstalled() {
    const releases = await db.productReleases.toArray()
    const release = releases.find((row) => {
      try {
        return (
          parseAnyProductReleaseManifest(row.manifestJson).definition.productKey === mistProductKey(edition)
        )
      } catch {
        return false
      }
    })
    if (!release) return null
    await assertProductReleaseUnchanged(release.id!)
    return {
      scope: await resolveScope({
        scope: { projectId: release.projectId, worldId: release.worldId, workId: release.workId },
      }),
      releaseId: release.id!,
    }
  }

  /** User-triggered, resumable installation through the existing production lifecycle. */
  function install(onProgress: (message: string) => void = () => {}) {
    if (installation) return installation
    const performInstall = async () => {
      const installed = await findInstalled()
      if (installed) return installed
      onProgress('准备雾港的世界版本…')
      const world = await createMistHarborWorld()
      const { scope } = world
      const releases = await db.productReleases.where('workId').equals(scope.workId).toArray()
      const release = releases.find((row) => {
        try {
          return (
            parseAnyProductReleaseManifest(row.manifestJson).definition.productKey === mistProductKey(edition)
          )
        } catch {
          return false
        }
      })
      if (release) {
        await assertProductReleaseUnchanged(release.id!)
        return { scope, releaseId: release.id! }
      }
      onProgress('锁定剧情与世界来源…')
      const workspace = await listProductProductionWorkspaceV1(scope, [mistProductType(edition)])
      let productionId = workspace.productions.find(
        (item) => item.title === mistTitle(edition) && item.status !== 'archived',
      )?.id
      if (productionId == null)
        productionId = await createProductProductionWithBriefV1({
          scope,
          worldReleaseId: world.worldReleaseId,
          title: mistTitle(edition),
          brief: await createMistHarborBrief(scope, world.worldReleaseId, edition),
        })
      let details = await readProductProductionDetailsV1(scope, productionId)
      if (!details?.brief) throw new Error('内置游戏 Brief 缺失')
      if (details.build && ['failed', 'cancelled'].includes(details.build.status)) {
        onProgress('保留上次准备记录，重新核验内置内容…')
        await archiveProductProductionV1({ scope, production: details.production })
        productionId = await createProductProductionWithBriefV1({
          scope,
          worldReleaseId: world.worldReleaseId,
          title: mistTitle(edition),
          brief: await createMistHarborBrief(scope, world.worldReleaseId, edition),
        })
        details = await readProductProductionDetailsV1(scope, productionId)
      }
      if (details.build?.status === 'recovery-required') {
        await retryProductProductionBlockerV1({ scope, details })
        details = await readProductProductionDetailsV1(scope, productionId)
      }
      if (details.build?.status === 'paused') {
        const resumed = await executeProductProductionCommand({
          scope,
          productionId,
          command: {
            type: 'resume',
            commandId: `mist-harbor.${edition}.resume.${productionId}.${details.production.stateRevision}`,
            expectedStateRevision: details.production.stateRevision,
          },
        })
        if (!resumed.ok) throw new Error(String(resumed.result.message ?? resumed.errorCode))
        details = await readProductProductionDetailsV1(scope, productionId)
      }
      if (!details.brief) throw new Error('内置游戏 Brief 缺失')
      if (!details.build || details.production.status === 'brief-ready') {
        const authorized = await executeProductProductionCommand({
          scope,
          productionId,
          command: {
            type: 'authorize-start',
            commandId: `mist-harbor.${edition}.authorize.${productionId}.${details.brief.revision}`,
            expectedStateRevision: details.production.stateRevision,
            briefRevision: details.brief.revision,
            briefHash: details.brief.briefHash,
            authorizationNonce: `player-start.${crypto.randomUUID()}`,
          },
        })
        if (!authorized.ok) throw new Error(String(authorized.errorCode ?? '内置游戏开始授权失败'))
        details = await readProductProductionDetailsV1(scope, productionId)
      }
      if (!details?.build || !details.brief) throw new Error('内置游戏构建未就绪')
      const brief = parseProductProductionBriefV3(details.brief.briefJson)
      if (!['release-ready', 'released'].includes(details.build.status)) {
        onProgress('编译剧情、任务与分支，核验内容完整性…')
        let failure: unknown
        const execute = mistHarborExecutor(edition, brief)
        const result = await runProductProductionUntilBlockedV1({
          scope,
          productionId,
          suppliedPlan: createMistHarborPlan(
            brief,
            details.brief.briefHash,
            details.build.buildNumber,
            details.build.controlEpoch,
          ),
          executor: async (task) => {
            try {
              return await execute(task)
            } catch (cause) {
              failure = cause
              throw cause
            }
          },
          maximumCycles: 12,
          onDurableBoundary: (boundary, snapshot) => {
            const quality = Boolean(snapshot.projection.steps['quality.verify'])
            onProgress(
              boundary === 'root.completed'
                ? '剧情核验完成，正在保存版本…'
                : quality
                  ? '核验全部章节与分支结局…'
                  : boundary === 'candidate.checkpoint' || boundary === 'artifact.accepted'
                    ? '保存完整剧本与任务…'
                    : '读取雾港的世界设定…',
            )
          },
        })
        if (result.buildStatus !== 'release-ready')
          throw new Error(
            `内置内容准备中断：${failure instanceof Error ? failure.message : result.buildStatus}。已有进度已保留。`,
          )
      }
      onProgress('保存不可变游戏版本…')
      await publishProductProductionV1({ scope, productionId })
      const completed = await readProductProductionDetailsV1(scope, productionId)
      const releaseId = completed?.production.currentProductReleaseId
      if (releaseId == null) throw new Error('内置游戏发布尚未完成')
      await assertProductReleaseUnchanged(releaseId)
      return { scope, releaseId }
    }
    const queued = localInstallationQueue
      .catch(() => undefined)
      .then(async () =>
        typeof navigator !== 'undefined' && navigator.locks
          ? navigator.locks.request('storyforge.mist-harbor.install', performInstall)
          : performInstall(),
      )
    localInstallationQueue = queued
    installation = queued.finally(() => {
      installation = null
    })
    return installation
  }

  return { findInstalled, install }
}
export const mistHarborAdventure = mistHarborInstallation('adventure')
export const mistHarborAvg = mistHarborInstallation('avg')
