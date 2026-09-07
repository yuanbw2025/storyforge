import { createTextAdventureFoundationRuntimePackageV2 } from './text-adventure-v2-foundation'
import { CURRENT_PRODUCT_SOURCE_CATALOG, seedCurrentProductWorld } from './current-product-world'
import { db } from '../../src/lib/db/schema'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { parseProductMediaRequirementsArtifactV2 } from '../../src/lib/product-production/production-executor'
import { putMediaBlobObject } from '../../src/lib/product-production/media-blob-store'
import { createProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { createProductBuildPreviewManifestV1, verifyProductBuildPreviewManifestV1 } from '../../src/lib/product-production/preview-manifest'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import type {
  ProductBuildArtifactKindV1,
  ProductBuildArtifactRecordV1,
  ProductMediaKind,
  WorkspaceScope,
} from '../../src/lib/types'

const PRODUCT_KEY = 'e2e.text-adventure.media-revision'

function bytesFromBase64(value: string): ArrayBuffer {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

function artifactKind(artifactKey: string): ProductBuildArtifactKindV1 {
  if (artifactKey === 'media.requirements') return 'asset-manifest'
  if (artifactKey === 'media.visual-bible') return 'visual-bible'
  if (artifactKey === 'media.audit') return 'integration-report'
  if (artifactKey === 'quality.visual-review') return 'playtest-report'
  if (artifactKey === 'runtime.package') return 'runtime-package'
  return 'narrative'
}

async function jsonArtifact(input: {
  scope: WorkspaceScope
  buildId: number
  controlEpoch: number
  artifactKey: string
  payload: unknown
  kind?: ProductBuildArtifactKindV1
}): Promise<ProductBuildArtifactRecordV1> {
  const payloadJson = canonicalProductProductionJsonV2(input.payload)
  return {
    ...input.scope,
    buildId: input.buildId,
    artifactKey: input.artifactKey,
    requirementKey: null,
    version: 1,
    kind: input.kind ?? artifactKind(input.artifactKey),
    mediaKind: null,
    status: 'accepted',
    producerRunId: null,
    producerReceiptHash: null,
    controlEpoch: input.controlEpoch,
    inputHash: await hashProductProductionValueV2({ fixture: input.artifactKey, epoch: input.controlEpoch }),
    contentHash: await hashProductProductionValueV2(input.payload),
    payloadJson,
    metadataJson: '{}',
    qualityJson: '{}',
    rightsJson: '{}',
    blobObjectId: null,
    mimeType: null,
    byteSize: new TextEncoder().encode(payloadJson).byteLength,
    parentArtifactHash: null,
    carriedFrom: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export async function seedTextAdventureMediaRevisionWorkbenchV1(imageBase64: string) {
  const owned = await seedCurrentProductWorld('文字冒险媒资修订浏览器 E2E')
  const project = await db.projects.get(owned.scope.projectId)
  await db.projects.update(owned.scope.projectId, {
    productPlatformOptIns: {
      ...(project?.productPlatformOptIns ?? {}),
      productProductionV3: true,
    },
  })
  const suggestions = await suggestProductStartingPoints({
    scope: owned.scope,
    worldReleaseId: owned.release.id!,
  })
  const drafted = await draftProductProductionBriefV3({
    scope: owned.scope,
    worldReleaseId: owned.release.id!,
    suggestionKey: suggestions.suggestions[0].suggestionKey,
    productType: 'text-adventure',
    qualityProfile: 'commercial-candidate',
    scale: 'short-arc',
    visualLevel: 'key-scenes',
    audioLevel: 'none',
    playerRole: '守灯人',
    openingSituation: '暴潮前修复潮门灯塔，并决定最后的灯火照向谁。',
    coreExperience: ['选择与后果', '资源与关系'],
    requiredFacts: ['潮门只在满月开启'],
    forbiddenChanges: ['不得改写冻结世界'],
    contentBoundaries: ['不含露骨内容'],
    tone: ['克制', '紧张'],
    textAdventure: { confirmAll: true },
  })
  // This fixture deliberately models an already completed two-image legacy
  // Build so the browser test can focus on the immutable revision lifecycle.
  const brief = parseProductProductionBriefV3({
    ...drafted,
    media: { ...drafted.media, imageCount: 2, requiredMediaKinds: ['background', 'cg'] },
    productionBudget: { ...drafted.productionBudget, maximumMediaCalls: 2 },
  })
  const created = await executeProductProductionCommand({
    scope: owned.scope,
    command: {
      type: 'create-intent', commandId: 'e2e.media-revision.intent', productionKey: PRODUCT_KEY,
      productType: 'text-adventure', worldReleaseId: owned.release.id!, userText: '媒资修订浏览器验收',
    },
  })
  const saved = await executeProductProductionCommand({
    scope: owned.scope,
    productionId: created.productionId,
    command: {
      type: 'save-brief-revision', commandId: 'e2e.media-revision.brief', expectedStateRevision: 0,
      parentRevision: null, brief,
    },
  })
  await executeProductProductionCommand({
    scope: owned.scope,
    productionId: created.productionId,
    command: {
      type: 'authorize-start', commandId: 'e2e.media-revision.start', expectedStateRevision: 1,
      briefRevision: 1, briefHash: String(saved.result.briefHash), authorizationNonce: 'e2e-author-click',
    },
  })
  const build = (await db.productBuilds.where('productionId').equals(created.productionId).first())!
  const plan = await createProductProductionPlanV3({
    brief,
    briefHash: build.briefHash,
    buildNumber: build.buildNumber,
    controlEpoch: build.controlEpoch,
  })
  const planHash = await hashProductProductionValueV2(plan)
  const imageBlob = await putMediaBlobObject({
    scope: owned.scope,
    data: bytesFromBase64(imageBase64),
    mimeType: 'image/png',
  })
  const visual = parseProductMediaRequirementsArtifactV2({
    schema: 'storyforge.product-media-requirements-artifact',
    version: 2,
    visual: [
      {
        artifactKey: 'media.visual.001', mediaKind: 'background', sceneTag: 'opening', beatKey: 'beat.opening.1',
        prompt: '暴潮前的潮门灯塔，深蓝与铜金配色，不包含文字。', altText: '暴潮前亮起的潮门灯塔',
        width: 1280, height: 720, palette: ['#172033', '#52647A', '#D8C6A0'],
        characterAnchorRefs: [], hardConstraints: [],
      },
      {
        artifactKey: 'media.visual.002', mediaKind: 'cg', sceneTag: 'ending', beatKey: 'beat.ending.1',
        prompt: '最后的灯火穿过海雾，保留结局悬念，不包含文字。', altText: '海雾中穿行的最后灯火',
        width: 1280, height: 720, palette: ['#172033', '#52647A', '#D8C6A0'],
        characterAnchorRefs: [], hardConstraints: [],
      },
    ],
    audio: [],
  }, brief)
  const visualBible = {
    schema: 'storyforge.text-adventure-visual-bible-artifact', version: 1,
    style: '克制的海洋奇幻厚涂', palette: ['#172033', '#52647A', '#D8C6A0'],
    compositionRules: ['叙事焦点清楚'], continuityRules: ['灯塔铜金结构保持一致'],
    characterAnchors: [], assetDirectives: visual.visual.map(item => ({ artifactKey: item.artifactKey })),
  }
  const requirementsHash = await hashProductProductionValueV2(visual)
  const visualBibleHash = await hashProductProductionValueV2(visualBible)
  const auditAssets = await Promise.all(visual.visual.map(async requirement => ({
    artifactKey: requirement.artifactKey,
    status: 'fulfilled' as const,
    assetKey: `${PRODUCT_KEY}.build-1.${requirement.artifactKey}`,
    requirementHash: await hashProductProductionValueV2(requirement),
    contentHash: imageBlob.contentHash,
    mimeType: 'image/png',
    width: requirement.width,
    height: requirement.height,
    source: 'e2e-controlled-fixture',
    license: 'CC0-1.0',
    rightsComplete: true,
    fallbackReason: null,
  })))
  const mediaAudit = {
    schema: 'storyforge.text-adventure-media-audit-artifact', version: 1,
    buildNumber: 1, requirementsHash, visualBibleHash, assets: auditAssets, passed: true,
  }
  const mediaAuditHash = await hashProductProductionValueV2(mediaAudit)
  const visualReview = {
    schema: 'storyforge.text-adventure-visual-quality-review-artifact', version: 1,
    buildNumber: 1, mediaAuditHash, status: 'passed',
    reviews: auditAssets.map(asset => ({
      artifactKey: asset.artifactKey, contentHash: asset.contentHash, verdict: 'accept',
      scores: {
        requirementFit: 5, identityContinuity: 5, styleContinuity: 5,
        composition: 4, technicalCleanliness: 5,
      },
      issues: [], reviewSource: 'multimodal-model',
    })),
    blockingIssueCount: 0, providerReviewCompleted: true,
  }
  const baseRuntime = createTextAdventureFoundationRuntimePackageV2({
    worldRelease: owned.release,
    sourceCatalog: {
      ...CURRENT_PRODUCT_SOURCE_CATALOG,
      worldReference: { referenceHash: 'f'.repeat(64) },
    } as never,
  })
  const assets = visual.visual.map(requirement => ({
    assetKey: `${PRODUCT_KEY}.build-1.${requirement.artifactKey}`,
    version: 1,
    kind: requirement.mediaKind,
    name: requirement.altText,
    mimeType: 'image/png' as const,
    byteSize: imageBlob.byteSize,
    width: requirement.width,
    height: requirement.height,
    durationMs: null,
    contentHash: imageBlob.contentHash,
    blobContentHash: imageBlob.contentHash,
    source: 'e2e-controlled-fixture',
    license: 'CC0-1.0',
    altText: requirement.altText,
    characterTag: '',
    sceneTag: requirement.sceneTag,
  }))
  const runtimePackage = parseProductRuntimePackageV1({
    ...baseRuntime,
    definition: {
      ...baseRuntime.definition,
      productKey: PRODUCT_KEY,
      title: '潮门灯塔 · 媒资修订验收',
      enabledCapabilities: [...new Set([...baseRuntime.definition.enabledCapabilities, 'presentation'])],
    },
    adventure: {
      ...baseRuntime.adventure,
      media: { mode: 'key-illustrations', fallback: 'text-only', assetKeys: assets.map(item => item.assetKey) },
    },
    presentation: { version: 1, assets, cues: [] },
  })
  const manifest = { schema: 'storyforge.e2e-media-revision-manifest', version: 1, buildNumber: 1 }
  const manifestHash = await hashProductProductionValueV2(manifest)
  const preview = await createProductBuildPreviewManifestV1({
    productionKey: PRODUCT_KEY,
    buildNumber: 1,
    buildManifestHash: manifestHash,
    runtimePackage,
    mediaBindings: visual.visual.map(requirement => ({
      assetKey: `${PRODUCT_KEY}.build-1.${requirement.artifactKey}`,
      artifactKey: requirement.artifactKey,
      blobContentHash: imageBlob.contentHash,
    })),
  })
  const specialPayloads = new Map<string, unknown>([
    ['media.requirements', visual],
    ['media.visual-bible', visualBible],
    ['media.audit', mediaAudit],
    ['quality.visual-review', visualReview],
    ['runtime.package', runtimePackage],
  ])
  const rows: ProductBuildArtifactRecordV1[] = []
  for (const task of plan.tasks) {
    for (const artifactKey of task.outputArtifactKeys) {
      const requirement = visual.visual.find(item => item.artifactKey === artifactKey)
      if (requirement) {
        rows.push({
          ...owned.scope,
          buildId: build.id!, artifactKey, requirementKey: 'media.visual', version: 1,
          kind: 'image', mediaKind: requirement.mediaKind, status: 'accepted',
          producerRunId: null, producerReceiptHash: null, controlEpoch: build.controlEpoch,
          inputHash: await hashProductProductionValueV2({ artifactKey, build: 1 }),
          contentHash: imageBlob.contentHash,
          payloadJson: canonicalProductProductionJsonV2({
            schema: 'storyforge.generated-media-artifact', version: 1,
            assetKey: `${PRODUCT_KEY}.build-1.${artifactKey}`, request: requirement,
          }),
          metadataJson: canonicalProductProductionJsonV2({
            assetKey: `${PRODUCT_KEY}.build-1.${artifactKey}`, name: requirement.altText,
            width: requirement.width, height: requirement.height, durationMs: null,
            altText: requirement.altText, characterTag: '', sceneTag: requirement.sceneTag,
            source: 'e2e-controlled-fixture', license: 'CC0-1.0',
          }),
          qualityJson: canonicalProductProductionJsonV2({ dimensionsVerified: true }),
          rightsJson: canonicalProductProductionJsonV2({
            origin: 'e2e-controlled-fixture', license: 'CC0-1.0', commercialUse: true, redistribution: true,
          }),
          blobObjectId: imageBlob.id!, mimeType: 'image/png', byteSize: imageBlob.byteSize,
          parentArtifactHash: null, carriedFrom: null, createdAt: Date.now(), updatedAt: Date.now(),
        })
      } else {
        rows.push(await jsonArtifact({
          scope: owned.scope,
          buildId: build.id!,
          controlEpoch: build.controlEpoch,
          artifactKey,
          payload: specialPayloads.get(artifactKey) ?? {
            schema: 'storyforge.e2e-placeholder-artifact', version: 1, artifactKey,
          },
        }))
      }
    }
  }
  await db.productBuildArtifacts.bulkAdd(rows)
  await db.productBuilds.update(build.id!, {
    status: 'preview-ready', planRevision: 1,
    planJson: canonicalProductProductionJsonV2(plan), planHash,
    manifestJson: canonicalProductProductionJsonV2(manifest), manifestHash,
    packageHash: preview.packageHash,
    previewManifestJson: canonicalProductProductionJsonV2(preview), previewHash: preview.previewHash,
    completedAt: Date.now(), updatedAt: Date.now(),
  })
  await db.productProductions.update(created.productionId, {
    status: 'preview-ready', updatedAt: Date.now(),
  })
  return {
    scope: owned.scope,
    productionId: created.productionId,
    parentBuildId: build.id!,
    parentBuildNumber: build.buildNumber,
    assetKeys: assets.map(item => item.assetKey),
  }
}

export async function finalizeTextAdventureMediaRevisionBuildV1(input: {
  scope: WorkspaceScope
  productionId: number
}) {
  const production = (await db.productProductions.get(input.productionId))!
  const child = (await db.productBuilds
    .where('[productionId+buildNumber]')
    .equals([input.productionId, production.currentBuildNumber!])
    .first())!
  if (child.buildNumber < 2) throw new Error('[media-revision-e2e] 子 Build 尚未创建')
  const parent = (await db.productBuilds
    .where('[productionId+buildNumber]')
    .equals([input.productionId, child.parentBuildNumber!])
    .first())!
  const parentPreview = await verifyProductBuildPreviewManifestV1(parent.previewManifestJson)
  const rows = (await db.productBuildArtifacts.where('buildId').equals(child.id!).toArray())
    .filter(row => row.status === 'accepted' || row.status === 'carried-forward')
  await db.productBuildArtifacts.where('buildId').equals(child.id!).modify({
    controlEpoch: child.controlEpoch,
    updatedAt: Date.now(),
  })
  const byKey = new Map(rows.map(row => [row.artifactKey, row]))
  const requirementsRow = byKey.get('media.requirements')!
  const visualBibleRow = byKey.get('media.visual-bible')!
  const requirements = JSON.parse(requirementsRow.payloadJson) as {
    visual: Array<{
      artifactKey: string
      mediaKind: ProductMediaKind
      sceneTag: string
      altText: string
      width: number
      height: number
    }>
  }
  const assets = requirements.visual.map(requirement => {
    const artifact = byKey.get(requirement.artifactKey)!
    const metadata = JSON.parse(artifact.metadataJson) as Record<string, unknown>
    return {
      assetKey: String(metadata.assetKey), version: 1, kind: requirement.mediaKind,
      name: String(metadata.name), mimeType: artifact.mimeType!, byteSize: artifact.byteSize,
      width: requirement.width, height: requirement.height, durationMs: null,
      contentHash: artifact.contentHash, blobContentHash: artifact.contentHash,
      source: String(metadata.source), license: String(metadata.license), altText: requirement.altText,
      characterTag: String(metadata.characterTag ?? ''), sceneTag: requirement.sceneTag,
    }
  })
  const runtimePackage = parseProductRuntimePackageV1({
    ...parentPreview.runtimePackage,
    definition: {
      ...parentPreview.runtimePackage.definition,
      enabledCapabilities: [...new Set([...parentPreview.runtimePackage.definition.enabledCapabilities, 'presentation'])],
    },
    adventure: {
      ...parentPreview.runtimePackage.adventure,
      media: { mode: 'key-illustrations', fallback: 'text-only', assetKeys: assets.map(item => item.assetKey) },
    },
    presentation: { version: 1, assets, cues: [] },
  })
  const auditAssets = await Promise.all(requirements.visual.map(async requirement => {
    const artifact = byKey.get(requirement.artifactKey)!
    const metadata = JSON.parse(artifact.metadataJson) as Record<string, unknown>
    const rights = JSON.parse(artifact.rightsJson) as Record<string, unknown>
    return {
      artifactKey: requirement.artifactKey, status: 'fulfilled' as const,
      assetKey: String(metadata.assetKey), requirementHash: await hashProductProductionValueV2(requirement),
      contentHash: artifact.contentHash, mimeType: artifact.mimeType,
      width: requirement.width, height: requirement.height,
      source: String(metadata.source), license: String(metadata.license),
      rightsComplete: rights.commercialUse === true, fallbackReason: null,
    }
  }))
  const audit = {
    schema: 'storyforge.text-adventure-media-audit-artifact', version: 1,
    buildNumber: child.buildNumber,
    requirementsHash: requirementsRow.contentHash,
    visualBibleHash: visualBibleRow.contentHash,
    assets: auditAssets,
    passed: true,
  }
  const auditHash = await hashProductProductionValueV2(audit)
  const visualReview = {
    schema: 'storyforge.text-adventure-visual-quality-review-artifact', version: 1,
    buildNumber: child.buildNumber, mediaAuditHash: auditHash, status: 'passed',
    reviews: auditAssets.map(asset => ({
      artifactKey: asset.artifactKey, contentHash: asset.contentHash, verdict: 'accept',
      scores: {
        requirementFit: 5, identityContinuity: 5, styleContinuity: 5,
        composition: 5, technicalCleanliness: 5,
      },
      issues: [], reviewSource: 'multimodal-model',
    })),
    blockingIssueCount: 0, providerReviewCompleted: true,
  }
  const manifest = {
    schema: 'storyforge.e2e-media-revision-manifest', version: 1,
    buildNumber: child.buildNumber, parentBuildNumber: parent.buildNumber,
  }
  const manifestHash = await hashProductProductionValueV2(manifest)
  const preview = await createProductBuildPreviewManifestV1({
    productionKey: production.productionKey,
    buildNumber: child.buildNumber,
    buildManifestHash: manifestHash,
    runtimePackage,
    mediaBindings: requirements.visual.map(requirement => {
      const artifact = byKey.get(requirement.artifactKey)!
      const metadata = JSON.parse(artifact.metadataJson) as Record<string, unknown>
      return {
        assetKey: String(metadata.assetKey), artifactKey: requirement.artifactKey,
        blobContentHash: artifact.contentHash,
      }
    }),
  })
  const invalidatedKeys = ['media.audit', 'quality.visual-review', 'runtime.package']
  await db.productBuildArtifacts.where('buildId').equals(child.id!).and(row => (
    invalidatedKeys.includes(row.artifactKey)
  )).delete()
  await db.productBuildArtifacts.bulkAdd([
    await jsonArtifact({
      scope: input.scope, buildId: child.id!, controlEpoch: child.controlEpoch,
      artifactKey: 'media.audit', payload: audit,
    }),
    await jsonArtifact({
      scope: input.scope, buildId: child.id!, controlEpoch: child.controlEpoch,
      artifactKey: 'quality.visual-review', payload: visualReview,
    }),
    await jsonArtifact({
      scope: input.scope, buildId: child.id!, controlEpoch: child.controlEpoch,
      artifactKey: 'runtime.package', payload: runtimePackage,
    }),
  ])
  await db.productBuilds.update(child.id!, {
    status: 'preview-ready', manifestJson: canonicalProductProductionJsonV2(manifest), manifestHash,
    packageHash: preview.packageHash, previewManifestJson: canonicalProductProductionJsonV2(preview),
    previewHash: preview.previewHash, failureJson: '{}', completedAt: Date.now(), updatedAt: Date.now(),
  })
  await db.productProductions.update(input.productionId, {
    status: 'preview-ready', currentBuildNumber: child.buildNumber, lastErrorJson: '{}', updatedAt: Date.now(),
  })
  return { childBuildId: child.id!, childBuildNumber: child.buildNumber, parentBuildId: parent.id! }
}
