import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  acceptProductBuildArtifact,
  carryForwardProductBuildArtifactsAcrossBuildsV1,
} from '../../src/lib/product-production/artifact-store'
import { prepareProductProductionAdoption, publishProductProductionBuild } from '../../src/lib/product-production/adoption'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createProductProductionPlanV3, parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { beginProductProductionEvolutionV1 } from '../../src/lib/product-production/service'
import { readLatestVerifiedAgentRunCheckpointV1 } from '../../src/lib/agent/run/checkpoint'
import { acceptAgentRunContract } from '../../src/lib/agent/run/contract'
import { canonicalStringify as canonicalAgentRunJsonV1 } from '../../src/lib/agent/run/hash'
import { verifyProductBuildPreviewManifestV1 } from '../../src/lib/product-production/preview-manifest'
import { createLegacyProductBuildRootTerminalReceiptV1 } from '../../src/lib/product-production/receipts'
import { resolveProductRuntimeSource } from '../../src/lib/product-production/preview-source'
import { runCurrentProductProductionAcceptanceFixture } from '../helpers/current-product-production-acceptance-fixture'
import { createProductRuntimeInstanceFromSource } from '../../src/lib/product/runtime-instances'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { installFakeOpfsV1 } from '../helpers/fake-opfs'

async function authorizedProduction(input: {
  name: string
  productType?: 'avg'
  visualLevel?: 'none' | 'key-scenes'
}) {
  const owned = await seedCurrentProductWorld(input.name)
  const release = owned.release
  const suggestions = await suggestProductStartingPoints({ scope: owned.scope, worldReleaseId: release.id! })
  const startingPoint = suggestions.suggestions.find(item => item.kind === 'mainline')!
  const brief = await draftProductProductionBriefV3({
    scope: owned.scope, worldReleaseId: release.id!, suggestionKey: startingPoint.suggestionKey,
    productType: input.productType ?? 'avg', scale: 'scene',
    visualLevel: input.visualLevel ?? 'none', audioLevel: 'none',
    requiredFacts: ['世界冻结版本中的历史不可被无理由改写'],
    forbiddenChanges: ['不得把候选内容直接写回世界正式表'],
  })
  const created = await executeProductProductionCommand({
    scope: owned.scope,
    command: {
      type: 'create-intent', commandId: `${input.name}.intent`, productionKey: `${input.name}.production`,
      productType: input.productType ?? 'avg', worldReleaseId: release.id!, userText: `${input.name} 游戏制作`,
    },
  })
  const saved = await executeProductProductionCommand({
    scope: owned.scope, productionId: created.productionId,
    command: {
      type: 'save-brief-revision', commandId: `${input.name}.brief`, expectedStateRevision: 0,
      parentRevision: null, brief,
    },
  })
  const authorized = await executeProductProductionCommand({
    scope: owned.scope, productionId: created.productionId,
    command: {
      type: 'authorize-start', commandId: `${input.name}.start`, expectedStateRevision: 1,
      briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: `${input.name}.click`,
    },
  })
  return {
    ...owned, release, productionId: created.productionId,
    buildId: authorized.result.buildId as number,
  }
}

async function authorizedCrossBuildCarryTarget(input: {
  owned: Awaited<ReturnType<typeof authorizedProduction>>
  sourceBuildId: number
  sourceArtifactKeys: string[]
  targetTaskKey: string
  authorizeReuse: boolean
}) {
  const sourceBuild = await db.productBuilds.get(input.sourceBuildId)
  if (!sourceBuild?.id) throw new Error('source Build missing')
  const sourceArtifacts = await db.productBuildArtifacts.where('buildId').equals(sourceBuild.id).toArray()
  const sourceByKey = new Map(sourceArtifacts.map(row => [row.artifactKey, row]))
  const orderedSources = input.sourceArtifactKeys.map(key => sourceByKey.get(key))
  if (orderedSources.some(row => !row)) throw new Error('source Artifact missing')

  const evolution = await beginProductProductionEvolutionV1({
    scope: input.owned.scope,
    productionId: input.owned.productionId,
    userText: `只调整产品层，复用 ${input.targetTaskKey}`,
    affectedLanes: ['product'],
  })
  const production = await db.productProductions.get(input.owned.productionId)
  const briefRow = await db.productProductionBriefs
    .where('[productionId+revision]')
    .equals([input.owned.productionId, evolution.briefRevision])
    .first()
  if (!production || !briefRow) throw new Error('target Production/Brief missing')
  const authorized = await executeProductProductionCommand({
    scope: input.owned.scope,
    productionId: input.owned.productionId,
    command: {
      type: 'authorize-start',
      commandId: `${input.owned.productionId}.${input.targetTaskKey}.reuse-start`,
      expectedStateRevision: production.stateRevision,
      briefRevision: briefRow.revision,
      briefHash: briefRow.briefHash,
      authorizationNonce: `${input.owned.productionId}.${input.targetTaskKey}.reuse-click`,
    },
  })
  const targetBuildId = authorized.result.buildId as number
  const targetBuild = await db.productBuilds.get(targetBuildId)
  if (!targetBuild?.id) throw new Error('target Build missing')
  const brief = parseProductProductionBriefV3(briefRow.briefJson)
  const generated = await createProductProductionPlanV3({
    buildNumber: targetBuild.buildNumber,
    controlEpoch: targetBuild.controlEpoch,
    briefHash: briefRow.briefHash,
    brief,
  })
  const targetTask = generated.tasks.find(task => task.taskKey === input.targetTaskKey)
  if (!targetTask) throw new Error('target Plan task missing')
  const replacedOutputs = new Set(targetTask.outputArtifactKeys)
  const remapInputs = (keys: string[]) => {
    const firstReplacedIndex = keys.findIndex(key => replacedOutputs.has(key))
    if (firstReplacedIndex < 0) return keys
    return keys.flatMap((key, index) => {
      if (!replacedOutputs.has(key)) return [key]
      return index === firstReplacedIndex ? input.sourceArtifactKeys : []
    })
  }
  const reuseKey = await hashProductProductionValueV2({
    schema: 'storyforge.product-production-cross-build-reuse',
    version: 1,
    sourceBuildNumber: sourceBuild.buildNumber,
    targetBuildNumber: targetBuild.buildNumber,
    taskKey: targetTask.taskKey,
    userImpact: brief.evolution!.affectedLanes,
    artifacts: orderedSources.map(row => ({ artifactKey: row!.artifactKey, contentHash: row!.contentHash })),
  })
  const plan = parseProductProductionPlanV3({
    ...generated,
    tasks: generated.tasks.map(task => ({
      ...task,
      inputArtifactKeys: remapInputs(task.inputArtifactKeys),
      ...(task.taskKey === targetTask.taskKey ? {
        outputArtifactKeys: [...input.sourceArtifactKeys],
        subjectLockKeys: [...input.sourceArtifactKeys],
        reuse: input.authorizeReuse ? {
          sourceBuildNumber: sourceBuild.buildNumber,
          sourceArtifactKey: orderedSources[0]!.artifactKey,
          sourceContentHash: orderedSources[0]!.contentHash,
          reuseKey,
          requiresRevalidation: true,
          reason: '本轮产品层改动不影响该 task，允许按完整 sibling 集合复用',
        } : null,
      } : {}),
    })),
  }, brief, briefRow.briefHash)
  const planJson = canonicalProductProductionJsonV2(plan)
  const planHash = await hashProductProductionValueV2(plan)
  await db.productBuilds.update(targetBuild.id, { planJson, planHash, planRevision: 1 })
  return { sourceBuild, sourceArtifacts: orderedSources.map(row => row!), targetBuildId, targetControlEpoch: targetBuild.controlEpoch }
}

describe('R-PRODUCTPROD-1C · authorized deterministic acceptance fixture', () => {
  beforeEach(async () => {
    // Coverage forks reuse one process across files. Explicitly close the
    // shared Dexie connection before deleting so a prior suite cannot leave
    // this acceptance fixture waiting on its own stale connection until timeout.
    db.close()
    await db.delete()
    await db.open()
  })
  afterEach(() => db.close())

  it('从冻结 WorldRelease 生成唯一清单、可玩 AVG 预览与可验证 SVG，并可幂等重入', async () => {
    const owned = await authorizedProduction({ name: 'vertical-avg', productType: 'avg', visualLevel: 'key-scenes' })
    const result = await runCurrentProductProductionAcceptanceFixture({
      scope: owned.scope, productionId: owned.productionId,
    })
    expect(result).toMatchObject({ buildId: owned.buildId, releaseReady: true })
    const build = await db.productBuilds.get(owned.buildId)
    expect(build).toMatchObject({ status: 'release-ready', packageHash: result.packageHash, previewHash: result.previewHash })
    expect(await hashProductProductionValueV2(JSON.parse(build!.manifestJson))).toBe(build!.manifestHash)
    const preview = await verifyProductBuildPreviewManifestV1(build!.previewManifestJson)
    expect(preview).toMatchObject({
      buildManifestHash: build!.manifestHash, packageHash: build!.packageHash, previewHash: build!.previewHash,
    })
    expect(preview.mediaBindings).toHaveLength(1)

    const resolved = await resolveProductRuntimeSource({
      scope: owned.scope,
      source: { kind: 'build', productBuildId: owned.buildId, expectedPreviewHash: result.previewHash },
    })
    const media = await resolved.mediaResolver.read(preview.runtimePackage.presentation!.assets[0].assetKey)
    expect(media.type).toBe('image/svg+xml')
    const svg = await media.text()
    expect(svg).toContain('<svg')
    expect(svg).not.toMatch(/<script|onload=|javascript:/i)
    resolved.mediaResolver.dispose()

    const session = await createProductRuntimeInstanceFromSource({
      scope: owned.scope,
      source: { kind: 'build', productBuildId: owned.buildId, expectedPreviewHash: result.previewHash },
      title: 'PRODUCTPROD 验收夹具可玩预览',
    })
    expect(session).toMatchObject({ productBuildId: owned.buildId, runtimeSourceHash: result.packageHash })
    const artifactCount = await db.productBuildArtifacts.where('buildId').equals(owned.buildId).count()
    const replay = await runCurrentProductProductionAcceptanceFixture({ scope: owned.scope, productionId: owned.productionId })
    expect(replay).toEqual(result)
    expect(await db.productBuildArtifacts.where('buildId').equals(owned.buildId).count()).toBe(artifactCount)
  }, 30_000)

  it('暂停会递增 controlEpoch，旧执行者不能再接受任何 Artifact', async () => {
    const owned = await authorizedProduction({ name: 'vertical-epoch', visualLevel: 'none' })
    const build = await db.productBuilds.get(owned.buildId)
    const inputHash = 'a'.repeat(64)
    const paused = await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: { type: 'pause', commandId: 'vertical-epoch.pause', expectedStateRevision: 2, reason: '检查产物' },
    })
    expect(paused).toMatchObject({ ok: true, result: { controlEpoch: 1 } })
    await expect(acceptProductBuildArtifact({
      scope: owned.scope, buildId: owned.buildId, controlEpoch: build!.controlEpoch,
      artifactKey: 'text-open-world.source-pin-unit.00002', kind: 'text-open-world.source-pin-unit',
      payload: { stale: true }, inputHash,
    })).rejects.toThrow(/epoch 已过期/)
    expect(await db.productBuildArtifacts.where('buildId').equals(owned.buildId).count()).toBe(0)
  })

  it('没有 durable producer checkpoint 的普通 Artifact 不能进入 Build', async () => {
    const owned = await authorizedProduction({ name: 'vertical-artifact-revision', visualLevel: 'none' })
    const build = await db.productBuilds.get(owned.buildId)
    await expect(acceptProductBuildArtifact({
      scope: owned.scope, buildId: owned.buildId, controlEpoch: build!.controlEpoch,
      artifactKey: 'content.revisable', kind: 'narrative', payload: { revision: 1 },
      inputHash: 'a'.repeat(64),
    })).rejects.toThrow(/已验证 producer checkpoint/)
    expect(await db.productBuildArtifacts.where('buildId').equals(owned.buildId).count()).toBe(0)
  })

  it('producer candidate 的显式 contentHash 与 payload 不一致时拒绝接受且零写入', async () => {
    const owned = await authorizedProduction({ name: 'vertical-candidate-content-hash', visualLevel: 'none' })
    await runCurrentProductProductionAcceptanceFixture({ scope: owned.scope, productionId: owned.productionId })
    const [build, artifact] = await Promise.all([
      db.productBuilds.get(owned.buildId),
      db.productBuildArtifacts.where('[buildId+artifactKey]').equals([owned.buildId, 'runtime.narrative']).first(),
    ])
    expect(build).toBeTruthy()
    expect(artifact).toBeTruthy()
    await db.productBuilds.update(owned.buildId, { status: 'building', completedAt: null })
    const before = await db.productBuildArtifacts.where('buildId').equals(owned.buildId).toArray()

    await expect(acceptProductBuildArtifact({
      scope: owned.scope,
      buildId: owned.buildId,
      controlEpoch: build!.controlEpoch,
      artifactKey: artifact!.artifactKey,
      requirementKey: artifact!.requirementKey,
      kind: artifact!.kind,
      mediaKind: artifact!.mediaKind,
      payload: JSON.parse(artifact!.payloadJson),
      metadata: JSON.parse(artifact!.metadataJson),
      quality: JSON.parse(artifact!.qualityJson),
      rights: JSON.parse(artifact!.rightsJson),
      contentHash: 'f'.repeat(64),
      blobObjectId: artifact!.blobObjectId,
      mimeType: artifact!.mimeType,
      byteSize: artifact!.byteSize,
      producerRunId: artifact!.producerRunId,
      producerReceiptHash: artifact!.producerReceiptHash,
      inputHash: artifact!.inputHash,
    })).rejects.toThrow(/contentHash 与 payload 不一致/)
    expect(await db.productBuildArtifacts.where('buildId').equals(owned.buildId).toArray()).toEqual(before)
  }, 30_000)

  it('producer child Run 即使 checkpoint 可验证，绑定不存在的 root 也不能接受 Artifact', async () => {
    const owned = await authorizedProduction({ name: 'vertical-producer-root', visualLevel: 'none' })
    await runCurrentProductProductionAcceptanceFixture({ scope: owned.scope, productionId: owned.productionId })
    const [build, artifact] = await Promise.all([
      db.productBuilds.get(owned.buildId),
      db.productBuildArtifacts.where('[buildId+artifactKey]').equals([owned.buildId, 'runtime.narrative']).first(),
    ])
    expect(build).toBeTruthy()
    expect(artifact?.producerRunId).not.toBeNull()
    await db.productBuilds.update(owned.buildId, { status: 'building', completedAt: null })
    const producer = await db.agentRuns.get(artifact!.producerRunId!)
    const corruptedContract = JSON.parse(producer!.contractJson) as {
      ownership: { parentRunId: number; relation: string }
    }
    corruptedContract.ownership.parentRunId = Number.MAX_SAFE_INTEGER
    const acceptedContract = await acceptAgentRunContract(corruptedContract)
    await db.transaction('rw', db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints, async () => {
      await db.agentRuns.update(artifact!.producerRunId!, {
        parentRunId: Number.MAX_SAFE_INTEGER,
        contractJson: canonicalAgentRunJsonV1(acceptedContract.contract),
        contractHash: acceptedContract.contractHash,
      })
      await db.agentRunEvents.where('runId').equals(artifact!.producerRunId!).modify({
        contractHash: acceptedContract.contractHash,
      })
      await db.agentRunCheckpoints.where('runId').equals(artifact!.producerRunId!).modify({
        contractHash: acceptedContract.contractHash,
      })
    })
    expect(await readLatestVerifiedAgentRunCheckpointV1(owned.scope, artifact!.producerRunId!)).toBeTruthy()
    const before = await db.productBuildArtifacts.where('buildId').equals(owned.buildId).toArray()

    await expect(acceptProductBuildArtifact({
      scope: owned.scope,
      buildId: owned.buildId,
      controlEpoch: build!.controlEpoch,
      artifactKey: artifact!.artifactKey,
      requirementKey: artifact!.requirementKey,
      kind: artifact!.kind,
      mediaKind: artifact!.mediaKind,
      payload: JSON.parse(artifact!.payloadJson),
      metadata: JSON.parse(artifact!.metadataJson),
      quality: JSON.parse(artifact!.qualityJson),
      rights: JSON.parse(artifact!.rightsJson),
      contentHash: artifact!.contentHash,
      blobObjectId: artifact!.blobObjectId,
      mimeType: artifact!.mimeType,
      byteSize: artifact!.byteSize,
      producerRunId: artifact!.producerRunId,
      producerReceiptHash: artifact!.producerReceiptHash,
      inputHash: artifact!.inputHash,
    })).rejects.toThrow(/producer Run 未绑定 ledger root/)
    expect(await db.productBuildArtifacts.where('buildId').equals(owned.buildId).toArray()).toEqual(before)
  }, 30_000)

  it('已封存 Build 可用可移植 seal 向直接后继 Build 复用精确 Artifact', async () => {
    const owned = await authorizedProduction({ name: 'vertical-sealed-carry', visualLevel: 'none' })
    await runCurrentProductProductionAcceptanceFixture({ scope: owned.scope, productionId: owned.productionId })
    const target = await authorizedCrossBuildCarryTarget({
      owned,
      sourceBuildId: owned.buildId,
      sourceArtifactKeys: ['runtime.package'],
      targetTaskKey: 'integration.package',
      authorizeReuse: true,
    })
    const sourceArtifact = target.sourceArtifacts[0]
    expect(target.sourceBuild).toMatchObject({ status: 'release-ready' })
    const carried = await carryForwardProductBuildArtifactsAcrossBuildsV1({
      scope: owned.scope,
      sourceBuildId: owned.buildId,
      targetBuildId: target.targetBuildId,
      targetControlEpoch: target.targetControlEpoch,
      artifactKeys: [sourceArtifact!.artifactKey],
    })
    expect(carried).toHaveLength(1)
    expect(carried[0]).toMatchObject({
      buildId: target.targetBuildId,
      artifactKey: sourceArtifact!.artifactKey,
      status: 'carried-forward',
      contentHash: sourceArtifact!.contentHash,
      parentArtifactHash: sourceArtifact!.contentHash,
    })
    expect(carried[0].carriedFrom?.proofHash).toMatch(/^[a-f0-9]{64}$/)
  }, 30_000)

  it('目标 Plan task.reuse=null 时 direct cross-build carry 拒绝且目标零写入', async () => {
    const owned = await authorizedProduction({ name: 'vertical-sealed-no-reuse', visualLevel: 'none' })
    await runCurrentProductProductionAcceptanceFixture({ scope: owned.scope, productionId: owned.productionId })
    const target = await authorizedCrossBuildCarryTarget({
      owned,
      sourceBuildId: owned.buildId,
      sourceArtifactKeys: ['runtime.package'],
      targetTaskKey: 'integration.package',
      authorizeReuse: false,
    })

    await expect(carryForwardProductBuildArtifactsAcrossBuildsV1({
      scope: owned.scope,
      sourceBuildId: owned.buildId,
      targetBuildId: target.targetBuildId,
      targetControlEpoch: target.targetControlEpoch,
      artifactKeys: ['runtime.package'],
    })).rejects.toThrow(/缺少精确 reuse 授权/)
    expect(await db.productBuildArtifacts.where('buildId').equals(target.targetBuildId).count()).toBe(0)
  }, 30_000)

  it('源媒资 IndexedDB data 字节被篡改但 metadata 不变时 direct carry 拒绝且目标零写入', async () => {
    const owned = await authorizedProduction({ name: 'vertical-sealed-media-bytes', visualLevel: 'key-scenes' })
    await runCurrentProductProductionAcceptanceFixture({ scope: owned.scope, productionId: owned.productionId })
    const sourceArtifact = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([owned.buildId, 'media.key-visual']).first()
    expect(sourceArtifact?.blobObjectId).not.toBeNull()
    const target = await authorizedCrossBuildCarryTarget({
      owned,
      sourceBuildId: owned.buildId,
      sourceArtifactKeys: ['media.key-visual'],
      targetTaskKey: 'media.visual',
      authorizeReuse: true,
    })
    const blob = await db.mediaBlobObjects.get(sourceArtifact!.blobObjectId!)
    expect(blob?.backend).toBe('indexeddb')
    expect(blob?.data).toBeTruthy()
    const tampered = blob!.data!.slice(0)
    const bytes = new Uint8Array(tampered)
    bytes[0] ^= 0xff
    await db.mediaBlobObjects.update(blob!.id!, { data: tampered })

    await expect(carryForwardProductBuildArtifactsAcrossBuildsV1({
      scope: owned.scope,
      sourceBuildId: owned.buildId,
      targetBuildId: target.targetBuildId,
      targetControlEpoch: target.targetControlEpoch,
      artifactKeys: ['media.key-visual'],
    })).rejects.toThrow(/共享媒资哈希不匹配/)
    expect(await db.productBuildArtifacts.where('buildId').equals(target.targetBuildId).count()).toBe(0)
  }, 30_000)

  it('源 Build 中未被选择的媒资字节损坏时 direct carry 仍拒绝整个父 Build 证明', async () => {
    const owned = await authorizedProduction({ name: 'vertical-sealed-unrelated-media-bytes', visualLevel: 'key-scenes' })
    await runCurrentProductProductionAcceptanceFixture({ scope: owned.scope, productionId: owned.productionId })
    const unrelatedMedia = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([owned.buildId, 'media.key-visual']).first()
    expect(unrelatedMedia?.blobObjectId).not.toBeNull()
    const target = await authorizedCrossBuildCarryTarget({
      owned,
      sourceBuildId: owned.buildId,
      sourceArtifactKeys: ['runtime.package'],
      targetTaskKey: 'integration.package',
      authorizeReuse: true,
    })
    const blob = await db.mediaBlobObjects.get(unrelatedMedia!.blobObjectId!)
    expect(blob?.backend).toBe('indexeddb')
    expect(blob?.data).toBeTruthy()
    const tampered = blob!.data!.slice(0)
    new Uint8Array(tampered)[0] ^= 0xff
    await db.mediaBlobObjects.update(blob!.id!, { data: tampered })

    await expect(carryForwardProductBuildArtifactsAcrossBuildsV1({
      scope: owned.scope,
      sourceBuildId: owned.buildId,
      targetBuildId: target.targetBuildId,
      targetControlEpoch: target.targetControlEpoch,
      artifactKeys: ['runtime.package'],
    })).rejects.toThrow(/共享媒资哈希不匹配/)
    expect(await db.productBuildArtifacts.where('buildId').equals(target.targetBuildId).count()).toBe(0)
  }, 30_000)

  it.each([
    ['metadataJson', 'metadata'],
    ['rightsJson', 'rights'],
  ] as const)('已完成源 Build 的 %s 被规范 JSON 篡改后，跨 Build carry 拒绝且目标零写入', async (
    field,
  ) => {
    const owned = await authorizedProduction({ name: `vertical-sealed-${field}`, visualLevel: 'none' })
    await runCurrentProductProductionAcceptanceFixture({ scope: owned.scope, productionId: owned.productionId })
    const sourceBuild = await db.productBuilds.get(owned.buildId)
    const sourceArtifact = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([owned.buildId, 'runtime.narrative']).first()
    expect(sourceBuild).toMatchObject({ status: 'release-ready' })
    expect(sourceArtifact).toBeTruthy()
    const { id: _sourceId, ...sourceFields } = sourceBuild!
    const targetControlEpoch = sourceBuild!.controlEpoch + 1
    const targetBuildId = await db.productBuilds.add({
      ...sourceFields,
      buildNumber: sourceBuild!.buildNumber + 1,
      parentBuildNumber: sourceBuild!.buildNumber,
      status: 'authorized',
      controlEpoch: targetControlEpoch,
      stateRevision: 1,
      planRevision: 0,
      rootTerminalReceiptHash: null,
      adoptionIntentHash: null,
      releasedProductReleaseId: null,
      completedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }) as number
    await db.productBuildArtifacts.update(sourceArtifact!.id!, {
      [field]: canonicalProductProductionJsonV2({
        priorEnvelope: JSON.parse(sourceArtifact![field]),
        tampered: true,
      }),
    })
    expect(await db.productBuildArtifacts.where('buildId').equals(targetBuildId).count()).toBe(0)

    await expect(carryForwardProductBuildArtifactsAcrossBuildsV1({
      scope: owned.scope,
      sourceBuildId: owned.buildId,
      targetBuildId,
      targetControlEpoch,
      artifactKeys: [sourceArtifact!.artifactKey],
    })).rejects.toThrow(/root terminal receipt 损坏/)
    expect(await db.productBuildArtifacts.where('buildId').equals(targetBuildId).count()).toBe(0)
  }, 30_000)

  it('旧版 root terminal receipt 仅可兼容校验，不能进入当前正式发布', async () => {
    const owned = await authorizedProduction({ name: 'vertical-legacy-root-receipt', visualLevel: 'none' })
    await runCurrentProductProductionAcceptanceFixture({ scope: owned.scope, productionId: owned.productionId })
    const [build, artifacts] = await Promise.all([
      db.productBuilds.get(owned.buildId),
      db.productBuildArtifacts.where('buildId').equals(owned.buildId).toArray(),
    ])
    expect(build).toMatchObject({ status: 'release-ready' })
    const legacyReceiptHash = await createLegacyProductBuildRootTerminalReceiptV1({
      planHash: build!.planHash,
      manifestHash: build!.manifestHash,
      packageHash: build!.packageHash,
      qualityReportHash: build!.qualityReportHash,
      controlEpoch: build!.controlEpoch,
      budgetLedgerJson: build!.budgetLedgerJson,
      artifacts,
    })
    await db.productBuilds.update(owned.buildId, { rootTerminalReceiptHash: legacyReceiptHash })

    await expect(prepareProductProductionAdoption({
      scope: owned.scope,
      productionId: owned.productionId,
    })).rejects.toThrow(/legacy root terminal receipt.*重新生产 v2 Build/)
    expect(await db.productReleases.where('workId').equals(owned.scope.workId).count()).toBe(0)
  }, 30_000)

  it('release-ready 后 producer/root 事件证明被篡改时采纳准备失败关闭', async () => {
    const owned = await authorizedProduction({ name: 'vertical-publish-root-proof-tamper', visualLevel: 'none' })
    await runCurrentProductProductionAcceptanceFixture({ scope: owned.scope, productionId: owned.productionId })
    const build = await db.productBuilds.get(owned.buildId)
    const ledger = JSON.parse(build!.budgetLedgerJson) as { rootRunId: number }
    const rootEvent = await db.agentRunEvents.where('runId').equals(ledger.rootRunId).first()
    expect(rootEvent?.id).toBeTruthy()
    await db.agentRunEvents.update(rootEvent!.id!, {
      payloadJson: canonicalProductProductionJsonV2({ tamperedAfterBuildSeal: true }),
    })

    await expect(prepareProductProductionAdoption({
      scope: owned.scope,
      productionId: owned.productionId,
    })).rejects.toThrow()
    expect(await db.productReleases.where('workId').equals(owned.scope.workId).count()).toBe(0)
  }, 30_000)

  it('篡改最终 manifest 指针后预览被拒绝，且不会创建半成品会话', async () => {
    const owned = await authorizedProduction({ name: 'vertical-tamper', visualLevel: 'none' })
    const result = await runCurrentProductProductionAcceptanceFixture({ scope: owned.scope, productionId: owned.productionId })
    const before = await db.productRuntimeSessions.count()
    await db.productBuilds.update(owned.buildId, { manifestHash: 'f'.repeat(64) })
    await expect(createProductRuntimeInstanceFromSource({
      scope: owned.scope,
      source: { kind: 'build', productBuildId: owned.buildId, expectedPreviewHash: result.previewHash },
      title: '篡改后的预览',
    })).rejects.toThrow(/Preview 指针或 hash/)
    expect(await db.productRuntimeSessions.count()).toBe(before)
  })

  it('采用意图冻结后原子发布同一个 RuntimePackage，Release 媒资脱离 Preview resolver 仍可读取', async () => {
    const owned = await authorizedProduction({ name: 'vertical-publish', productType: 'avg', visualLevel: 'key-scenes' })
    const built = await runCurrentProductProductionAcceptanceFixture({ scope: owned.scope, productionId: owned.productionId })
    const prepared = await prepareProductProductionAdoption({ scope: owned.scope, productionId: owned.productionId })
    expect(prepared).toMatchObject({
      intent: { buildId: owned.buildId, packageHash: built.packageHash, previewHash: built.previewHash },
      productType: 'avg',
    })
    const command = {
      type: 'publish' as const, commandId: 'vertical-publish.publish',
      expectedStateRevision: prepared.intent.expectedStateRevision,
      buildNumber: prepared.intent.buildNumber, expectedManifestHash: prepared.intent.manifestHash,
      adoptionIntentHash: prepared.adoptionIntentHash,
    }
    const receipt = await publishProductProductionBuild({
      scope: owned.scope, productionId: owned.productionId, command,
    })
    expect(receipt).toMatchObject({ buildId: owned.buildId, packageHash: built.packageHash, replayed: false })
    expect(await db.productBuilds.get(owned.buildId)).toMatchObject({
      status: 'released', releasedProductReleaseId: receipt.productReleaseId,
      adoptionIntentHash: prepared.adoptionIntentHash,
    })
    expect(await db.productProductions.get(owned.productionId)).toMatchObject({
      status: 'released', currentProductReleaseId: receipt.productReleaseId,
    })
    const releaseSource = await resolveProductRuntimeSource({
      scope: owned.scope, source: { kind: 'release', productReleaseId: receipt.productReleaseId },
    })
    expect(releaseSource.runtimePackage).toEqual((await verifyProductBuildPreviewManifestV1(
      (await db.productBuilds.get(owned.buildId))!.previewManifestJson,
    )).runtimePackage)
    const asset = releaseSource.runtimePackage.presentation!.assets[0]
    const releasedMedia = await releaseSource.mediaResolver.read(asset.assetKey)
    expect(releasedMedia).toMatchObject({ type: asset.mimeType, size: asset.byteSize })
    releaseSource.mediaResolver.dispose()
    const releaseSession = await createProductRuntimeInstanceFromSource({
      scope: owned.scope, source: { kind: 'release', productReleaseId: receipt.productReleaseId },
      title: '正式版本会话',
    })
    expect(releaseSession).toMatchObject({ productReleaseId: receipt.productReleaseId, runtimeSourceHash: built.packageHash })

    const replay = await publishProductProductionBuild({
      scope: owned.scope, productionId: owned.productionId, command,
    })
    expect(replay).toMatchObject({ productReleaseId: receipt.productReleaseId, replayed: true })
    expect(await db.productReleases.where('workId').equals(owned.scope.workId).count()).toBe(1)
  }, 30_000)

  it.each(['root-event', 'blob-bytes'] as const)(
    '发布准备后、事务 CAS 前篡改 %s 会零发布并且可恢复重试',
    async mutation => {
      const owned = await authorizedProduction({
        name: `vertical-publish-final-cas-${mutation}`,
        productType: 'avg',
        visualLevel: 'key-scenes',
      })
      await runCurrentProductProductionAcceptanceFixture({ scope: owned.scope, productionId: owned.productionId })
      const prepared = await prepareProductProductionAdoption({ scope: owned.scope, productionId: owned.productionId })
      const command = {
        type: 'publish' as const,
        commandId: `vertical-publish-final-cas-${mutation}.publish`,
        expectedStateRevision: prepared.intent.expectedStateRevision,
        buildNumber: prepared.intent.buildNumber,
        expectedManifestHash: prepared.intent.manifestHash,
        adoptionIntentHash: prepared.adoptionIntentHash,
      }
      const build = await db.productBuilds.get(owned.buildId)
      const ledger = JSON.parse(build!.budgetLedgerJson) as { rootRunId: number }
      const rootEvent = await db.agentRunEvents.where('runId').equals(ledger.rootRunId).first()
      const mediaArtifact = (await db.productBuildArtifacts.where('buildId').equals(owned.buildId).toArray())
        .find(row => row.blobObjectId != null)!
      const blob = await db.mediaBlobObjects.get(mediaArtifact.blobObjectId!)
      expect(rootEvent?.id).toBeTruthy()
      expect(blob?.backend).toBe('indexeddb')
      expect(blob?.data).toBeTruthy()
      const originalEventPayload = rootEvent!.payloadJson
      const originalBlobData = blob!.data!.slice(0)
      let injected = false
      const originalTransaction = db.transaction.bind(db) as unknown as (...args: unknown[]) => Promise<unknown>
      const transactionSpy = vi.spyOn(db, 'transaction')
      transactionSpy.mockImplementation((async (...args: unknown[]) => {
        const tables = args.slice(1, -1).flat()
        if (!injected && tables.includes(db.productReleases)) {
          injected = true
          if (mutation === 'root-event') {
            await db.agentRunEvents.update(rootEvent!.id!, {
              payloadJson: canonicalProductProductionJsonV2({ tamperedBeforePublishTransaction: true }),
            })
          } else {
            const changed = originalBlobData.slice(0)
            new Uint8Array(changed)[0] ^= 0xff
            await db.mediaBlobObjects.update(blob!.id!, { data: changed })
          }
        }
        return originalTransaction(...args)
      }) as never)
      try {
        await expect(publishProductProductionBuild({
          scope: owned.scope,
          productionId: owned.productionId,
          command,
        })).rejects.toThrow(/cas-authorities.*terminal CAS (Run events\/checkpoints|Blob proof)/)
      } finally {
        transactionSpy.mockRestore()
      }
      expect(injected).toBe(true)
      expect(await db.productReleases.where('workId').equals(owned.scope.workId).count()).toBe(0)
      expect(await db.productMediaAssets.where('workId').equals(owned.scope.workId).count()).toBe(0)
      expect(await db.productMediaBlobs.where('workId').equals(owned.scope.workId).count()).toBe(0)
      expect(await db.productProductionCommands
        .where('[productionId+commandId]').equals([owned.productionId, command.commandId]).count()).toBe(0)
      expect(await db.productBuilds.get(owned.buildId)).toMatchObject({
        status: 'release-ready',
        releasedProductReleaseId: null,
      })

      if (mutation === 'root-event') {
        await db.agentRunEvents.update(rootEvent!.id!, { payloadJson: originalEventPayload })
      } else {
        await db.mediaBlobObjects.update(blob!.id!, { data: originalBlobData })
      }
      await expect(publishProductProductionBuild({
        scope: owned.scope,
        productionId: owned.productionId,
        command,
      })).resolves.toMatchObject({ replayed: false, buildId: owned.buildId })
      expect(await db.productReleases.where('workId').equals(owned.scope.workId).count()).toBe(1)
    },
    30_000,
  )

  it('发布初验后 OPFS 字节被替换时，事务前紧邻物理复验零发布并可重试', async () => {
    const fakeOpfs = installFakeOpfsV1()
    try {
      const owned = await authorizedProduction({
        name: 'vertical-publish-opfs-final-verify',
        productType: 'avg',
        visualLevel: 'key-scenes',
      })
      await runCurrentProductProductionAcceptanceFixture({ scope: owned.scope, productionId: owned.productionId })
      const mediaArtifact = (await db.productBuildArtifacts.where('buildId').equals(owned.buildId).toArray())
        .find(row => row.blobObjectId != null)!
      const blob = await db.mediaBlobObjects.get(mediaArtifact.blobObjectId!)
      expect(blob?.backend).toBe('indexeddb')
      const originalData = blob!.data!.slice(0)
      const opfsPath = `storyforge/media/v1/work-${owned.scope.workId}/${blob!.contentHash}`
      const fakePath = `/${opfsPath}`
      fakeOpfs.files.set(fakePath, originalData.slice(0))
      await db.mediaBlobObjects.update(blob!.id!, {
        backend: 'opfs',
        data: null,
        opfsPath,
        updatedAt: Date.now(),
      })
      const prepared = await prepareProductProductionAdoption({
        scope: owned.scope,
        productionId: owned.productionId,
      })
      const command = {
        type: 'publish' as const,
        commandId: 'vertical-publish-opfs-final-verify.publish',
        expectedStateRevision: prepared.intent.expectedStateRevision,
        buildNumber: prepared.intent.buildNumber,
        expectedManifestHash: prepared.intent.manifestHash,
        adoptionIntentHash: prepared.adoptionIntentHash,
      }
      let injected = false
      fakeOpfs.readCount = 0
      fakeOpfs.beforeRead = (path, readCount) => {
        // publish inspect reads once in the terminal verifier and once while
        // binding Runtime assets. The third physical read is the new
        // immediately-before-transaction verification.
        if (injected || readCount !== 3) return
        injected = true
        const changed = fakeOpfs.files.get(path)!.slice(0)
        new Uint8Array(changed)[0] ^= 0xff
        fakeOpfs.files.set(path, changed)
      }
      await expect(publishProductProductionBuild({
        scope: owned.scope,
        productionId: owned.productionId,
        command,
      })).rejects.toThrow(/共享媒资哈希不匹配/)
      expect(injected).toBe(true)
      expect(await db.productReleases.where('workId').equals(owned.scope.workId).count()).toBe(0)
      expect(await db.productProductionCommands
        .where('[productionId+commandId]').equals([owned.productionId, command.commandId]).count()).toBe(0)

      fakeOpfs.beforeRead = null
      fakeOpfs.files.set(fakePath, originalData.slice(0))
      await expect(publishProductProductionBuild({
        scope: owned.scope,
        productionId: owned.productionId,
        command,
      })).resolves.toMatchObject({ replayed: false, buildId: owned.buildId })
    } finally {
      fakeOpfs.restore()
    }
  }, 30_000)

  it('发布事务在 Release 插入后失败会回滚 Release、正式媒资和 command claim，可安全重试', async () => {
    const owned = await authorizedProduction({ name: 'vertical-rollback', productType: 'avg', visualLevel: 'key-scenes' })
    await runCurrentProductProductionAcceptanceFixture({ scope: owned.scope, productionId: owned.productionId })
    const prepared = await prepareProductProductionAdoption({ scope: owned.scope, productionId: owned.productionId })
    const command = {
      type: 'publish' as const, commandId: 'vertical-rollback.publish',
      expectedStateRevision: prepared.intent.expectedStateRevision,
      buildNumber: prepared.intent.buildNumber, expectedManifestHash: prepared.intent.manifestHash,
      adoptionIntentHash: prepared.adoptionIntentHash,
    }
    const update = vi.spyOn(db.productBuilds, 'update').mockRejectedValueOnce(new Error('injected-after-release'))
    await expect(publishProductProductionBuild({
      scope: owned.scope, productionId: owned.productionId, command,
    })).rejects.toThrow(/injected-after-release/)
    update.mockRestore()
    expect(await db.productReleases.where('workId').equals(owned.scope.workId).count()).toBe(0)
    expect(await db.productMediaAssets.where('workId').equals(owned.scope.workId).count()).toBe(0)
    expect(await db.productMediaBlobs.where('workId').equals(owned.scope.workId).count()).toBe(0)
    expect(await db.productProductionCommands
      .where('[productionId+commandId]').equals([owned.productionId, command.commandId]).count()).toBe(0)
    expect(await db.productBuilds.get(owned.buildId)).toMatchObject({ status: 'release-ready', releasedProductReleaseId: null })

    const retried = await publishProductProductionBuild({ scope: owned.scope, productionId: owned.productionId, command })
    expect(retried).toMatchObject({ replayed: false, buildId: owned.buildId })
  }, 30_000)
})
