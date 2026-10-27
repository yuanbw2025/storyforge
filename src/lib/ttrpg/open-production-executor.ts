/** TTRPG-owned open-mode production, quality and usage policy. No provider is called outside the original Harness. */
import { readTtrpgCompatibleOpeningProductionBaseV1 } from './open-compatible-opening-production'
import { assertTtrpgOpenReleaseCompatibilityV1 } from './open-release-compatibility'
import { ttrpgOpenProductionMediaContextV1, assertTtrpgOpenProductionMediaRequirementsV1, bindTtrpgOpenProductionMediaV1 } from './open-production-media'
import { compileProductionTtrpgOpenCampaignV2 } from './open-production-compiler'
import { isTtrpgRuntimeContentV2, verifyTtrpgFrozenContentHashesV1, type ProductRuntimePackageWithTtrpgV2 } from './content-version'
import { assertTtrpgOpenPublicationGatesV1 } from './open-gates'
import { validateTtrpgOpenNarrativeEnvelopeV1 } from './open-narrative-envelope'

import { db } from '../db/schema'
import type { ProductBuildQualityReportV1, ProductProductionBriefV3, ProductProductionRecordV1 } from '../types'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { readVerifiedMediaBlobObjectData, sha256MediaData } from '../product-production/media-blob-store'
import { detectProductImageDimensionsV1 } from '../product-production/media-adapters'
import { parseProductRuntimePackageV1 } from '../product-production/runtime-package'
import type { ProductProductionTaskExecutionInputV1, ProductProductionTaskExecutionResultV1 } from '../product-production/scheduler'
import type { ProductProductionExecutorHelpersV1 } from '../product-production/production-executor'
import { readTtrpgProductSourcePlanV1 } from './production-source-plan'

export function createTtrpgOpenProductionExecutorsV1(helpers: ProductProductionExecutorHelpersV1) {
  // An explicit never-returning function annotation preserves TypeScript's
  // control-flow narrowing across the injected neutral helper boundary.
  const fail: (message: string) => never = helpers.fail
  const { record, parseProductMediaRequirementsArtifactV2, artifactRecord, artifactPayload, elapsed, zeroUsage, visualSvg, mediaAsset } = helpers
  function openMediaContext(input: ProductProductionTaskExecutionInputV1, brief: ProductProductionBriefV3) {
    if (!brief.ttrpgOpen) return null
    return ttrpgOpenProductionMediaContextV1({ ruleSystem: artifactPayload(input, 'ttrpg.open.rule-system'),
      situationLayer: artifactPayload(input, 'ttrpg.open.situation-layer'), rulePack: brief.ttrpgOpen.rulePack })
  }
  async function executeTtrpgOpenIntegrationTask(input: ProductProductionTaskExecutionInputV1, options: {
    production: ProductProductionRecordV1; brief: ProductProductionBriefV3
  }): Promise<ProductProductionTaskExecutionResultV1> {
    const startedAt = performance.now(), build = await db.productBuilds.get(input.buildId)
    if (!options.brief.ttrpgOpen || !build || build.productionId !== input.productionId
      || build.buildNumber !== input.buildNumber || build.controlEpoch !== input.controlEpoch
      || build.planHash !== input.planHash || build.briefHash !== await hashProductProductionValueV2(options.brief)
      || ['projectId', 'worldId', 'workId'].some(key => build[key as keyof typeof build] !== input.scope[key as keyof typeof input.scope])) {
      fail('open 集成缺少当前 Build/Brief/作用域证据')
    }
    const briefRow = await db.productProductionBriefs.where('[productionId+revision]')
      .equals([input.productionId, build.briefRevision]).first()
    if (!briefRow || briefRow.briefHash !== build.briefHash) fail('open 集成缺少冻结 Brief row')
    const sourcePlan = await readTtrpgProductSourcePlanV1(briefRow)
    const accepted = async (artifactKey: string) => {
      const row = artifactRecord(input, artifactKey), stored = row.id ? await db.productBuildArtifacts.get(row.id) : null
      if (!stored || stored.buildId !== input.buildId || stored.contentHash !== row.contentHash
        || stored.payloadJson !== row.payloadJson || stored.artifactKey !== artifactKey
        || !['accepted', 'carried-forward'].includes(stored.status)
        || ['projectId', 'worldId', 'workId'].some(key => stored[key as keyof typeof stored] !== input.scope[key as keyof typeof input.scope])) {
        fail(`open 集成需要当前 Build 已采纳的产物:${artifactKey}`)
      }
      const payload: unknown = JSON.parse(stored.payloadJson)
      if (await hashProductProductionValueV2(payload) !== stored.contentHash) fail(`open 采纳产物 hash 不一致:${artifactKey}`)
      return { payload, contentHash: stored.contentHash }
    }
    const compatibleBase = options.brief.ttrpgOpen.compatibleOpeningRevision
      ? await readTtrpgCompatibleOpeningProductionBaseV1({ scope: input.scope, productionId: input.productionId, brief: options.brief }) : null
    let campaign = await compileProductionTtrpgOpenCampaignV2({ brief: options.brief, briefHash: build.briefHash,
      campaignKey: `${options.production.productionKey}.open`, verifiedSourcePlan: sourcePlan, ...(compatibleBase ? { compatibleBase: compatibleBase.content } : {}),
      sourceFacts: await accepted('ttrpg.open.source-facts'), ruleSystem: await accepted('ttrpg.open.rule-system'),
      situationLayer: await accepted('ttrpg.open.situation-layer') })
    const mediaPlan = await accepted('media.requirements')
    const requirements = parseProductMediaRequirementsArtifactV2(mediaPlan.payload, options.brief,
      openMediaContext(input, options.brief)?.characterAnchors ?? [], null, 'frozen')
    assertTtrpgOpenProductionMediaRequirementsV1({ context: openMediaContext(input, options.brief)!, ...requirements })
    const assetsByArtifact = new Map<string, ReturnType<typeof mediaAsset>['asset']>()
    const mediaRights: { assetKey: string; contentHash: string; source: string; license: string; declaration: unknown }[] = []
    for (const requirement of [...requirements.visual, ...requirements.audio]) {
      const row = artifactRecord(input, requirement.artifactKey), stored = row.id ? await db.productBuildArtifacts.get(row.id) : null
      if (!stored || stored.buildId !== input.buildId || stored.controlEpoch !== build.controlEpoch
        || !['accepted', 'carried-forward'].includes(stored.status)
        || stored.contentHash !== row.contentHash || stored.payloadJson !== row.payloadJson || stored.metadataJson !== row.metadataJson
        || ['projectId', 'worldId', 'workId'].some(key => stored[key as keyof typeof stored] !== input.scope[key as keyof typeof input.scope])) {
        fail(`open 媒资缺少当前 Build 采纳证据:${requirement.artifactKey}`)
      }
      const media = mediaAsset(stored)
      if (canonicalProductProductionJsonV2(record(JSON.parse(stored.payloadJson), 'media payload').request)
        !== canonicalProductProductionJsonV2(requirement)) fail(`open 素材没有消费冻结需求:${requirement.artifactKey}`)
      const blob = stored.blobObjectId ? await db.mediaBlobObjects.get(stored.blobObjectId) : null
      if (!blob || blob.contentHash !== stored.contentHash || blob.mimeType !== stored.mimeType || blob.byteSize !== stored.byteSize
        || ['projectId', 'worldId', 'workId'].some(key => blob[key as keyof typeof blob] !== input.scope[key as keyof typeof input.scope])) {
        fail(`open 媒资文件/hash/作用域不一致:${requirement.artifactKey}`)
      }
      const bytes = await readVerifiedMediaBlobObjectData(blob)
      if (stored.mediaKind && ['background', 'character-pose', 'character-expression', 'cg', 'ui'].includes(stored.mediaKind)) {
        const visualRequirement = requirements.visual.find(item => item.artifactKey === requirement.artifactKey)
        const governedSvg = stored.mimeType === 'image/svg+xml' && media.asset.source === 'storyforge-procedural-svg-v1'
          && visualRequirement && await sha256MediaData(visualSvg(visualRequirement, options.production.title,
            requirements.visual.indexOf(visualRequirement))) === stored.contentHash
        const dimensions = governedSvg && visualRequirement
          ? { width: visualRequirement.width, height: visualRequirement.height } : detectProductImageDimensionsV1(bytes)
        if (!dimensions || dimensions.width !== media.asset.width || dimensions.height !== media.asset.height) {
          fail(`open 素材实际图片与尺寸声明不一致:${requirement.artifactKey}`)
        }
      }
      assetsByArtifact.set(requirement.artifactKey, media.asset)
      mediaRights.push({ assetKey: media.asset.assetKey, contentHash: media.asset.contentHash,
        source: media.asset.source, license: media.asset.license, declaration: JSON.parse(stored.rightsJson) })
    }
    campaign = bindTtrpgOpenProductionMediaV1({ campaign, visual: requirements.visual, assetsByArtifact })
    const rule = options.brief.ttrpgOpen.rulePack
    const pkg: ProductRuntimePackageWithTtrpgV2 = {
      schema: 'storyforge.product-runtime-package', version: 1, productType: 'ttrpg',
      definition: { productKey: options.production.productionKey, title: campaign.title, description: campaign.pitch,
        enabledCapabilities: ['narrative', 'ttrpg'], rulesetVersion: 1,
        initialVariables: { productAdapterId: 'storyforge.ttrpg-open.v2', productAdapterCommercialReady: false } },
      sourceWorld: { contentHash: options.brief.source.worldContentHash, selection: options.brief.source.selection },
      narrative: { moduleKind: 'opening', moduleTitle: campaign.title, entryNodeKey: 'open.entry',
        nodes: [{ key: 'open.entry', kind: 'entry', title: campaign.title, summary: options.brief.intent.openingSituation,
          conditionJson: '{}', effectsJson: '[]', successorKeys: [] }],
        beats: [{ beatKey: 'open.entry.text', nodeKey: 'open.entry', kind: 'narration', speakerKey: null,
          text: options.brief.intent.openingSituation, order: 0 }], choices: [] },
      ttrpg: { rulePack: { content: rule, contentHash: options.brief.ttrpgOpen.rulePackHash }, campaign,
        compatibility: { runtimeProtocol: 2, minimumPlayerVersion: 2 } },
    }
    if (assetsByArtifact.size) {
      pkg.presentation = { version: 1, assets: [...assetsByArtifact.values()], cues: [] }
      pkg.definition.enabledCapabilities.push('presentation')
    }
    if (compatibleBase) {
      if (!pkg.ttrpg || !isTtrpgRuntimeContentV2(pkg.ttrpg)) fail('兼容开局输出必须是完整开放跑团')
      assertTtrpgOpenReleaseCompatibilityV1(compatibleBase.content, pkg.ttrpg)
    }
    const parsed = parseProductRuntimePackageV1(pkg, { ttrpgProtocol: 2 })
    return { artifacts: [
      { artifactKey: 'ttrpg.rule-pack', kind: 'rule-pack', payload: rule,
        quality: { compiler: 'storyforge.ttrpg-open.v2' }, rights: { license: rule.license } },
      { artifactKey: 'ttrpg.campaign-pack', kind: 'campaign-pack', payload: campaign,
        quality: { exactAdoptedInputsVerified: true }, rights: { origin: 'author-adopted-open-artifacts' } },
      { artifactKey: 'runtime.package', kind: 'presentation', payload: parsed,
        quality: { parser: 'parseProductRuntimePackageV1', runtimeProtocol: 2, narrativeEnvelopeVerified: true }, rights: { mediaLicenses: mediaRights } },
    ], passedGateIds: [...input.task.acceptanceGateIds], usage: zeroUsage(elapsed(startedAt)) }
  }
  async function executeTtrpgOpenQualityTask(input: ProductProductionTaskExecutionInputV1, options: {
    brief: ProductProductionBriefV3
  }): Promise<ProductProductionTaskExecutionResultV1> {
    const startedAt = performance.now()
    const pkg = parseProductRuntimePackageV1(artifactPayload(input, 'runtime.package'), { ttrpgProtocol: 2 })
    if (!options.brief.ttrpgOpen || !pkg.ttrpg || !isTtrpgRuntimeContentV2(pkg.ttrpg)) fail('open QA 缺少协议 2 内容')
    await verifyTtrpgFrozenContentHashesV1(pkg.ttrpg)
    for (const [key, payload] of [['ttrpg.rule-pack', pkg.ttrpg.rulePack.content],
      ['ttrpg.campaign-pack', pkg.ttrpg.campaign]] as const) {
      const artifact = artifactRecord(input, key), value = artifactPayload(input, key)
      if (canonicalProductProductionJsonV2(value) !== canonicalProductProductionJsonV2(payload)
        || await hashProductProductionValueV2(value) !== artifact.contentHash) fail(`open QA 独立产物与 runtime 不一致:${key}`)
    }
    const packageHash = await hashProductProductionValueV2(pkg)
    if (packageHash !== artifactRecord(input, 'runtime.package').contentHash) fail('open QA package hash 不一致')
    const publication = assertTtrpgOpenPublicationGatesV1(pkg.ttrpg.campaign, pkg.ttrpg.rulePack.content)
    const envelope = validateTtrpgOpenNarrativeEnvelopeV1(pkg.narrative,
      new Set(pkg.ttrpg.campaign.characterTemplates.map(template => template.characterKey)))
    const playable = publication.valid && envelope.valid
    const requiredKinds = new Set(options.brief.media.requiredMediaKinds), assets = pkg.presentation?.assets ?? []
    const coveredKinds = new Set(assets.map(asset => asset.kind).filter(kind => requiredKinds.has(kind)))
    const mediaCoverage = requiredKinds.size ? coveredKinds.size / requiredKinds.size : 1
    const rightsValid = options.brief.qualityProfile !== 'commercial-candidate'
      && assets.every(asset => asset.source.trim() && asset.license.trim())
    const evidence = new Map([
      ...publication.gates.map(gate => [gate.gateId, gate] as const),
      ['runtime.package.valid', { gateId: 'runtime.package.valid', passed: true, evidence: [packageHash] }] as const,
      ['runtime.playable', { gateId: 'runtime.playable', passed: playable, evidence: ['open-content-structural-loop', ...envelope.errors] }] as const,
      ['narrative.graph.valid', { gateId: 'narrative.graph.valid', passed: envelope.valid, evidence: ['open-read-only-envelope', ...envelope.errors] }] as const,
      ['rights.complete', { gateId: 'rights.complete', passed: rightsValid,
        evidence: [...(assets.length ? assets.map(asset => `${asset.assetKey}:${asset.source}:${asset.license}`) : ['no-media-assets']), 'adapterCommercialReady=false'] }] as const,
    ])
    const hardGateResults = [...new Set([...options.brief.completionContract.requiredGateIds,
      ...publication.gates.map(gate => gate.gateId)])].map(gateId => evidence.get(gateId)
        ?? { gateId, passed: false, evidence: [`unsupported-gate:${gateId}`] })
    if (hardGateResults.some(gate => !gate.passed)) fail(`open QA 硬门失败:${hardGateResults.filter(gate => !gate.passed).map(gate => gate.gateId).join(',')}`)
    const releaseReady = mediaCoverage >= options.brief.completionContract.minimumMediaCoverage
    const report: ProductBuildQualityReportV1 = { schema: 'storyforge.product-build-quality-report', version: 1,
      buildNumber: input.buildNumber, packageHash, hardGateResults,
      softGateResults: [{ gateId: 'media.coverage', passed: releaseReady, evidence: [`coverage=${mediaCoverage}`] }],
      mediaCoverage, playable, releaseReady, warnings: [
        '本报告只验证已采纳内容的结构与引用；真实模型、长局、人类游玩和商业验收需独立证据。',
        '开放模式产品入口仍为实验性；通过内容结构检查不改变入口开放状态。',
      ] }
    return { artifacts: [{ artifactKey: 'quality.report', kind: 'quality-report', payload: report,
      quality: { hardGatesPassed: true, releaseReady }, rights: {} }], passedGateIds: [...input.task.acceptanceGateIds],
      usage: zeroUsage(elapsed(startedAt)) }
  }
  async function executeTtrpgOpenKernelWithUsageV1(execute: () => Promise<ProductProductionTaskExecutionResultV1>): Promise<ProductProductionTaskExecutionResultV1> {
    const started = performance.now()
    try { return await execute() } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      if (!('productProductionUsage' in failure)) Object.defineProperty(failure, 'productProductionUsage', {
        value: zeroUsage(elapsed(started)), enumerable: false, configurable: false, writable: false,
      })
      throw failure
    }
  }
  return { openMediaContext, executeTtrpgOpenIntegrationTask, executeTtrpgOpenQualityTask, executeTtrpgOpenKernelWithUsageV1 }
}
