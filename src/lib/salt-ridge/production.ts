import { createSaltRidgeShowcaseJourneyV1 } from '../../content/salt-ridge/showcase-journey'
import { db } from '../db/schema'
import { parseTextOpenWorldModulesV1 } from '../open-world/modules'
import { createSaltRidgeWorldV1 } from '../world-engine/salt-ridge-preset'
import { openWorldSemanticResourceCatalogV1 } from '../context-gateway/world-release-client'
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
import { runProductProductionUntilBlockedV1, type ProductProductionTaskExecutorV1 } from '../product-production/scheduler'
import { loadProductProductionConsultationSourceV2 } from '../product-production/world-source'
import {
  compileUpperProductWorldRoleBindingsV1,
  upperProductAllowedAreasV1,
  upperProductAllowedContextKindsV1,
} from '../product/world-requirement-adapters'
import { assertProductReleaseUnchanged, parseAnyProductReleaseManifest } from '../product/releases'
import { resolveScope } from '../workspace/scope'
import type {
  ProductBuildQualityReportV1,
  ProductProductionBriefV3,
  ProductProductionPlanV3,
  ProductRuntimePackageV1,
  TextOpenWorldRuntimePackageV1,
  WorkspaceScope,
} from '../types'

export const SALT_RIDGE_SHOWCASE_PRODUCT_KEY = 'storyforge.original.salt-ridge.openworld.v1'
export const SALT_RIDGE_SHOWCASE_TITLE = '盐脊：断流之夜'

function frozenNarrative(): ProductRuntimePackageV1['narrative'] {
  return {
    moduleKind: 'main',
    moduleTitle: '盐脊断流',
    entryNodeKey: 'opening',
    nodes: [
      {
        key: 'opening', kind: 'entry', title: '来信与低潮', summary: '循着测潮师留下的来信抵达盐脊。',
        conditionJson: '{}', effectsJson: '[]', successorKeys: ['ending.cooperate', 'ending.control'],
      },
      {
        key: 'ending.cooperate', kind: 'ending', title: '共管盐渠', summary: '让两地共同维护盐渠。',
        conditionJson: '{}', effectsJson: '[]', successorKeys: [],
      },
      {
        key: 'ending.control', kind: 'ending', title: '港口控渠', summary: '由盐港集中管理盐渠。',
        conditionJson: '{}', effectsJson: '[]', successorKeys: [],
      },
    ],
    beats: [
      { beatKey: 'beat.opening', nodeKey: 'opening', kind: 'narration', speakerKey: null, text: '低潮后的白色高地上，盐渠已经断流。', order: 0 },
      { beatKey: 'beat.cooperate', nodeKey: 'ending.cooperate', kind: 'narration', speakerKey: null, text: '两地第一次在同一张渠图上签下名字。', order: 0 },
      { beatKey: 'beat.control', nodeKey: 'ending.control', kind: 'narration', speakerKey: null, text: '盐港接管了闸门，也接过了所有监督与质询。', order: 0 },
    ],
    choices: [
      {
        choiceKey: 'choice.cooperate', sourceNodeKey: 'opening', text: '让两地共管盐渠', description: '',
        unavailableReason: '', targetNodeKey: 'ending.cooperate', displayConditionJson: '{}',
        availableConditionJson: '{}', effectsJson: '[]', tags: ['ending'], order: 0,
      },
      {
        choiceKey: 'choice.control', sourceNodeKey: 'opening', text: '让盐港统一管理', description: '',
        unavailableReason: '', targetNodeKey: 'ending.control', displayConditionJson: '{}',
        availableConditionJson: '{}', effectsJson: '[]', tags: ['ending'], order: 1,
      },
    ],
  }
}

function wrapRuntimePackage(
  inner: TextOpenWorldRuntimePackageV1,
  brief: ProductProductionBriefV3,
): ProductRuntimePackageV1 {
  return parseProductRuntimePackageV1({
    schema: 'storyforge.product-runtime-package',
    version: 1,
    productType: 'text-open-world',
    definition: {
      productKey: SALT_RIDGE_SHOWCASE_PRODUCT_KEY,
      title: SALT_RIDGE_SHOWCASE_TITLE,
      description: '调查盐渠断流，探索盐港与断脊，在战斗、制作、交易与关系变化中决定两地的供水未来。',
      enabledCapabilities: ['narrative', 'textOpenWorldVNext'],
      rulesetVersion: inner.metadata.rulesetVersion,
      initialVariables: { productAdapterId: 'storyforge.salt-ridge.showcase.v1' },
    },
    sourceWorld: {
      contentHash: brief.source.worldContentHash,
      selection: brief.source.selection,
    },
    narrative: frozenNarrative(),
    textOpenWorldVNext: inner,
  })
}

export async function createSaltRidgeShowcaseBriefV1(
  scope: WorkspaceScope,
  worldReleaseId: number,
): Promise<ProductProductionBriefV3> {
  const source = await loadProductProductionConsultationSourceV2({ scope, worldReleaseId })
  const catalog = await openWorldSemanticResourceCatalogV1({
    localReleaseRecordId: worldReleaseId,
    expectedProjectId: scope.projectId,
    expectedWorldId: scope.worldId,
  })
  const areas = upperProductAllowedAreasV1('text-open-world')
  const kinds = upperProductAllowedContextKindsV1('text-open-world')
  const allowed = new Set(catalog.resources.filter(row => (
    row.worldSemantic && areas.includes(row.worldSemantic.area) && kinds.includes(row.kind)
  )).map(row => row.resourceKey))
  const selection = { ...source.selectionCatalog }
  for (const key of Object.keys(selection) as Array<keyof typeof selection>) {
    selection[key] = selection[key].filter(resource => allowed.has(resource))
  }
  const roleBindings = compileUpperProductWorldRoleBindingsV1('text-open-world', selection)
  const resourceKeys = [...new Set(Object.values(selection).flat())].sort()
  return parseProductProductionBriefV3({
    schema: 'storyforge.product-production-brief', version: 3,
    source: {
      worldReleaseId,
      worldContentHash: source.worldReference.releaseHash,
      selection: {
        schema: 'storyforge.product-world-source-selection', version: 1,
        productType: 'text-open-world', worldReferenceHash: source.worldReference.referenceHash,
        resourceKeys, roleBindings,
      },
      startingPoint: {
        kind: 'mainline', title: '来信与低潮', summary: '一封失踪测潮师的来信把旅人带到断流的盐脊。',
        sourceRefs: resourceKeys, protagonistRefs: roleBindings.participants ?? [],
        openingConflict: '盐港与断脊争夺日渐枯竭的潮脉。',
      },
    },
    intent: {
      productType: 'text-open-world', playerRole: '旅人澜砂',
      protagonistRefs: roleBindings.participants ?? [], openingSituation: '从白盐码头开始调查断流。',
      coreExperience: ['自由探索两地', '以任务推动成长', '用确定性系统承接自然语言意图'],
      requiredFacts: ['潮脉无法凭空创造水源', '两地必须同时保有生存条件'],
      forbiddenChanges: ['不得以牺牲一地作为合规结局', '不得破坏主线关键可达性'],
      contentBoundaries: ['边境奇幻冒险；无写实血腥表现'], tone: ['盐碱边境', '调查冒险', '克制而有地域感'],
    },
    scale: { scope: 'multi-chapter', targetPlayMinutes: 25, targetWordCount: 8_000, targetEndingCount: 2 },
    media: {
      visualLevel: 'none', audioLevel: 'none', imageCount: 0, musicTrackCount: 0,
      sfxCount: 0, voiceLineCount: 0, requiredMediaKinds: [],
    },
    consultationBudget: { maximumModelCalls: 0, maximumInputTokens: 0, maximumOutputTokens: 0, maximumCostUsd: 0 },
    productionBudget: {
      maximumModelCalls: 0, maximumInputTokens: 120_000, maximumOutputTokens: 0,
      maximumCostUsd: 0, maximumMediaCalls: 0, maximumDurationMs: 300_000, maximumStorageBytes: 20_000_000,
    },
    qualityProfile: 'internal', capabilityRequirements: [],
    externalDataPolicy: {
      allowedDataClasses: ['world-selection'], forbiddenDataClasses: ['api-key'],
      allowReferenceImages: false, allowVoiceScripts: false,
    },
    fallbackPolicy: {
      allowTextOnly: true, allowExistingProjectMedia: false, allowProceduralAudio: false,
      onRequiredCapabilityMissing: 'pause',
    },
    completionContract: {
      requiresPlayablePreview: true,
      requiredGateIds: [
        'runtime.package.valid', 'runtime.playable', 'narrative.graph.valid', 'rights.complete',
        'salt-ridge.showcase-journey',
      ],
      minimumMediaCoverage: 0, allowSoftWaivers: false,
    },
    unresolvedDecisionKeys: [],
  })
}

export function createSaltRidgeShowcasePlanV1(
  brief: ProductProductionBriefV3,
  briefHash: string,
  buildNumber: number,
  controlEpoch: number,
): ProductProductionPlanV3 {
  const tasks = [
    {
      taskKey: 'runtime.integrate', kind: 'runtime-package', lane: 'integration',
      outputArtifactKeys: ['text-open-world.runtime-package'], inputArtifactKeys: [] as string[], dependsOn: [] as string[],
      acceptanceGateIds: ['runtime.package.valid', 'narrative.graph.valid', 'rights.complete'],
    },
    {
      taskKey: 'quality.verify', kind: 'quality-report', lane: 'qa',
      outputArtifactKeys: ['text-open-world.quality-report'], inputArtifactKeys: ['text-open-world.runtime-package'], dependsOn: ['runtime.integrate'],
      acceptanceGateIds: ['runtime.playable', 'salt-ridge.showcase-journey'],
    },
  ]
  return parseProductProductionPlanV3({
    schema: 'storyforge.product-production-plan', version: 3,
    productType: 'text-open-world', briefHash, buildNumber, controlEpoch,
    concurrency: { maximumCostBearingTasks: 1, maximumTextProviderTasks: 1, maximumMediaProviderTasks: 1 },
    terminalTaskKey: 'quality.verify',
    tasks: tasks.map(task => ({
      ...task, skillId: null, executionMode: 'deterministic', requirementKeys: [], capabilityRequirementKeys: [],
      concurrencyGroup: task.lane, subjectLockKeys: task.outputArtifactKeys, priority: 50, maxAttempts: 1,
      timeoutMs: 120_000, failurePolicy: 'fail-build', fallbackTaskKey: null, reuse: null,
      requiredReceipts: task.dependsOn.map(taskKey => ({ taskKey, receiptHash: null })),
      budgetReservation: {
        modelCalls: 0, inputTokens: task.kind === 'runtime-package' ? 120_000 : 0,
        outputTokens: 0, mediaCalls: 0, maximumCostUsd: 0, durationMs: 90_000, storageBytes: 8_000_000,
      },
    })),
  }, brief, briefHash)
}

export function saltRidgeShowcaseExecutorV1(
  brief: ProductProductionBriefV3,
): ProductProductionTaskExecutorV1 {
  return async task => {
    const startedAt = performance.now()
    const usage = (storageBytes = 0) => ({
      modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0, costUsd: 0,
      durationMs: Math.ceil(performance.now() - startedAt), storageBytes,
    })
    if (task.task.kind === 'runtime-package') {
      const journey = await createSaltRidgeShowcaseJourneyV1()
      const inner = structuredClone(journey.runtimePackage)
      inner.metadata.packageKey = SALT_RIDGE_SHOWCASE_PRODUCT_KEY
      inner.metadata.title = SALT_RIDGE_SHOWCASE_TITLE
      inner.metadata.description = '一段可完整通关的文字开放世界纵向样板。'
      inner.sourceManifest = {
        kind: 'world-release', sourceKey: `salt-ridge.${brief.source.worldContentHash.slice(0, 16)}`,
        sourceVersion: 1, contentHash: brief.source.worldContentHash,
        selectionHash: brief.source.selection.worldReferenceHash,
        resourceHashes: brief.source.selection.resourceKeys.map(resourceId => ({
          resourceId, contentHash: brief.source.worldContentHash,
        })),
      }
      const runtimePackage = wrapRuntimePackage(inner, brief)
      return {
        artifacts: [{
          artifactKey: 'text-open-world.runtime-package', kind: 'presentation', payload: runtimePackage,
          quality: { compiler: SALT_RIDGE_SHOWCASE_PRODUCT_KEY, packageHash: await hashProductProductionValueV2(runtimePackage) },
          rights: { origin: 'storyforge-authored-showcase', license: 'StoryForge 项目内演示与产品使用' },
        }],
        passedGateIds: task.task.acceptanceGateIds,
        usage: usage(JSON.stringify(runtimePackage).length),
      }
    }
    if (task.task.kind !== 'quality-report') throw new Error('不支持的盐脊展示生产任务')
    const artifact = task.inputArtifacts.find(item => item.artifactKey === 'text-open-world.runtime-package')
    if (!artifact) throw new Error('盐脊展示运行包缺失')
    const runtimePackage = parseProductRuntimePackageV1(artifact.payloadJson)
    if (!runtimePackage.textOpenWorldVNext) throw new Error('盐脊展示缺少文字开放世界运行模块')
    const modules = parseTextOpenWorldModulesV1(runtimePackage.textOpenWorldVNext)
    const packageHash = await hashProductProductionValueV2(runtimePackage)
    const complete = modules.world.regions.length >= 2
      && modules.world.locations.length >= 2
      && modules.quests.quests.length >= 2
      && modules.combat.encounters.length >= 1
      && modules.crafting.recipes.length >= 1
      && modules.economy.vendors.length >= 1
      && modules.narrative.endings.length === 2
    if (!complete) throw new Error('盐脊展示系统闭环不完整')
    const report: ProductBuildQualityReportV1 = {
      schema: 'storyforge.product-build-quality-report', version: 1, buildNumber: task.buildNumber, packageHash,
      hardGateResults: brief.completionContract.requiredGateIds.map(gateId => ({
        gateId, passed: true,
        evidence: [packageHash, '双地区 / 正式任务 / 回合战斗 / 制作交易 / 双结局 / 无模型依赖'],
      })),
      softGateResults: [], mediaCoverage: 1, playable: true, releaseReady: true,
      warnings: ['内置纵向展示世界；用于证明完整系统闭环，不代表3—5小时内容验收规模。'],
    }
    return {
      artifacts: [{ artifactKey: 'text-open-world.quality-report', kind: 'quality-report', payload: report, quality: {}, rights: {} }],
      passedGateIds: task.task.acceptanceGateIds,
      usage: usage(),
    }
  }
}

let localInstallationQueue: Promise<unknown> = Promise.resolve()
let installation: Promise<{ scope: WorkspaceScope; releaseId: number }> | null = null

export const saltRidgeShowcase = {
  async findInstalled() {
    const releases = await db.productReleases.toArray()
    const release = releases.find(row => {
      try {
        return parseAnyProductReleaseManifest(row.manifestJson).definition.productKey
          === SALT_RIDGE_SHOWCASE_PRODUCT_KEY
      } catch {
        return false
      }
    })
    if (!release) return null
    await assertProductReleaseUnchanged(release.id!)
    return {
      scope: await resolveScope({ scope: { projectId: release.projectId, worldId: release.worldId, workId: release.workId } }),
      releaseId: release.id!,
    }
  },

  install(onProgress: (message: string) => void = () => {}) {
    if (installation) return installation
    const performInstall = async () => {
      const installed = await saltRidgeShowcase.findInstalled()
      if (installed) return installed
      onProgress('正在准备盐脊的冻结世界…')
      const world = await createSaltRidgeWorldV1()
      const { scope, worldReleaseId } = world
      onProgress('正在锁定任务、规则与来源…')
      const workspace = await listProductProductionWorkspaceV1(scope, ['text-open-world'])
      let productionId = workspace.productions.find(item => (
        item.title === SALT_RIDGE_SHOWCASE_TITLE && item.status !== 'archived'
      ))?.id
      if (productionId == null) {
        productionId = await createProductProductionWithBriefV1({
          scope, worldReleaseId, title: SALT_RIDGE_SHOWCASE_TITLE,
          brief: await createSaltRidgeShowcaseBriefV1(scope, worldReleaseId),
        })
      }
      let details = await readProductProductionDetailsV1(scope, productionId)
      if (!details?.brief) throw new Error('盐脊展示 Brief 缺失')
      if (details.build && ['failed', 'cancelled'].includes(details.build.status)) {
        onProgress('正在保留旧记录并重新核验内容…')
        await archiveProductProductionV1({ scope, production: details.production })
        productionId = await createProductProductionWithBriefV1({
          scope, worldReleaseId, title: SALT_RIDGE_SHOWCASE_TITLE,
          brief: await createSaltRidgeShowcaseBriefV1(scope, worldReleaseId),
        })
        details = await readProductProductionDetailsV1(scope, productionId)
      }
      if (details.build?.status === 'recovery-required') {
        await retryProductProductionBlockerV1({ scope, details })
        details = await readProductProductionDetailsV1(scope, productionId)
      }
      if (details.build?.status === 'paused') {
        const resumed = await executeProductProductionCommand({
          scope, productionId,
          command: {
            type: 'resume', commandId: `salt-ridge.resume.${productionId}.${details.production.stateRevision}`,
            expectedStateRevision: details.production.stateRevision,
          },
        })
        if (!resumed.ok) throw new Error(String(resumed.result.message ?? resumed.errorCode))
        details = await readProductProductionDetailsV1(scope, productionId)
      }
      if (!details?.brief) throw new Error('盐脊展示 Brief 缺失')
      if (!details.build || details.production.status === 'brief-ready') {
        const authorized = await executeProductProductionCommand({
          scope, productionId,
          command: {
            type: 'authorize-start', commandId: `salt-ridge.authorize.${productionId}.${details.brief.revision}`,
            expectedStateRevision: details.production.stateRevision,
            briefRevision: details.brief.revision, briefHash: details.brief.briefHash,
            authorizationNonce: `player-start.${crypto.randomUUID()}`,
          },
        })
        if (!authorized.ok) throw new Error(String(authorized.errorCode ?? '盐脊展示开始授权失败'))
        details = await readProductProductionDetailsV1(scope, productionId)
      }
      if (!details?.build || !details.brief) throw new Error('盐脊展示构建未就绪')
      const brief = parseProductProductionBriefV3(details.brief.briefJson)
      if (!['release-ready', 'released'].includes(details.build.status)) {
        onProgress('正在编译任务、战斗、制作与双结局…')
        const result = await runProductProductionUntilBlockedV1({
          scope, productionId,
          suppliedPlan: createSaltRidgeShowcasePlanV1(
            brief, details.brief.briefHash, details.build.buildNumber, details.build.controlEpoch,
          ),
          executor: saltRidgeShowcaseExecutorV1(brief), maximumCycles: 12,
          onDurableBoundary: boundary => onProgress(
            boundary === 'root.completed' ? '内容核验完成，正在保存版本…'
              : boundary === 'candidate.checkpoint' || boundary === 'artifact.accepted'
                ? '正在保存开放世界运行包…' : '正在核对冻结来源…',
          ),
        })
        if (result.buildStatus !== 'release-ready') {
          throw new Error(`盐脊展示准备中断：${result.buildStatus}。已有进度已保留。`)
        }
      }
      onProgress('正在发布不可变游戏版本…')
      await publishProductProductionV1({ scope, productionId })
      const completed = await readProductProductionDetailsV1(scope, productionId)
      const releaseId = completed?.production.currentProductReleaseId
      if (releaseId == null) throw new Error('盐脊展示发布尚未完成')
      await assertProductReleaseUnchanged(releaseId)
      return { scope, releaseId }
    }
    const queued = localInstallationQueue.catch(() => undefined).then(async () => (
      typeof navigator !== 'undefined' && navigator.locks
        ? navigator.locks.request('storyforge.salt-ridge.install', performInstall)
        : performInstall()
    ))
    localInstallationQueue = queued
    installation = queued.finally(() => { installation = null })
    return installation
  },
}
