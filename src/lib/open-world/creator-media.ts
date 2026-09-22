import Dexie from 'dexie'
import { db } from '../db/schema'
import type {
  MediaBlobObjectRecordV1,
  ProductBuildArtifactRecordV1,
  ProductBuildRecordV1,
  ProductProductionBriefRecordV1,
  ProductProductionPlanV3,
  ProductProductionRecordV1,
  ProductTaskBudgetReservationV1,
  ProviderCapabilityRequirementV1,
  TextOpenWorldMediaRequirementsV1,
  WorkspaceScope,
} from '../types'
import type { ResolvedProductMediaCapabilityV1 } from '../product-production/media-transport'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
  isSha256Hash,
} from '../product-production/hash'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { readMediaBlobObjectData } from '../product-production/media-blob-store'
import { detectProductImageDimensionsV1, detectProductMediaMimeTypeV1 } from '../product-production/media-adapters'
import { readTextOpenWorldArtifactGovernanceV1 } from './creator-artifact-governance'
import { readTextOpenWorldCreatorDerivedBuildAuthorityV1 } from './creator-derived-authority'
import { textOpenWorldProductionTaskDescendantsV1 } from './production-contract'
import {
  parseTextOpenWorldCreatorMediaAuthorizationV1,
  parseTextOpenWorldCreatorMediaPlanV1,
  type TextOpenWorldCreatorImportedMediaV1,
  type TextOpenWorldCreatorMediaAuthorizationV1,
  type TextOpenWorldCreatorMediaModeV1,
  type TextOpenWorldCreatorMediaPlanV1,
  type TextOpenWorldCreatorMediaRightsBasisV1,
  type TextOpenWorldCreatorMediaSlotV1,
} from './creator-media-contract'

const MAX_MEDIA_COMMANDS = 128

function fail(message: string): never {
  throw new Error(`[text-open-world-creator-media] ${message}`)
}

function same(left: unknown, right: unknown): boolean {
  return canonicalProductProductionJsonV2(left) === canonicalProductProductionJsonV2(right)
}

function activeArtifacts(
  build: ProductBuildRecordV1 & { id: number },
  rows: ProductBuildArtifactRecordV1[],
): ProductBuildArtifactRecordV1[] {
  return rows.filter(row => row.controlEpoch === build.controlEpoch
    && (row.status === 'accepted' || row.status === 'carried-forward'))
}

function mediaKindForSlot(
  slot: TextOpenWorldMediaRequirementsV1['slots'][number],
): TextOpenWorldCreatorMediaSlotV1['mediaKind'] {
  if (slot.kind === 'character-portrait') return 'character-pose'
  if (slot.kind === 'scene-background') return 'background'
  fail(`首版 Creator 媒资包不支持槽位:${slot.kind}`)
}

function targetVisualSlots(
  requirements: TextOpenWorldMediaRequirementsV1,
  outputKeys: string[],
): TextOpenWorldCreatorMediaSlotV1[] {
  const selected = requirements.slots.filter(slot => (
    (slot.kind === 'character-portrait' || slot.kind === 'scene-background')
    && slot.productionMode !== 'fallback-only'
  )).sort((left, right) => {
    const priority = (kind: typeof left.kind) => kind === 'scene-background' ? 0 : 1
    return priority(left.kind) - priority(right.kind) || left.order - right.order
  })
  if (selected.length !== outputKeys.length) fail('P10媒资需求与当前 media.visual sibling group 数量不一致')
  return selected.map((slot, index) => ({
    artifactKey: outputKeys[index]!,
    slotKey: slot.key,
    slotKind: slot.kind as TextOpenWorldCreatorMediaSlotV1['slotKind'],
    subjectKey: slot.subjectKey,
    mediaKind: mediaKindForSlot(slot),
    title: slot.title,
    altText: slot.title,
    width: slot.kind === 'character-portrait' ? 720 : 1200,
    height: slot.kind === 'character-portrait' ? 1080 : 675,
  }))
}

async function parseMediaRequirements(
  artifact: ProductBuildArtifactRecordV1,
): Promise<TextOpenWorldMediaRequirementsV1> {
  let value: unknown
  try { value = JSON.parse(artifact.payloadJson) } catch { fail('MediaRequirements 不是合法 JSON') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('MediaRequirements 必须是对象')
  const requirements = value as TextOpenWorldMediaRequirementsV1
  if (requirements.schema !== 'storyforge.text-open-world-media-requirements'
    || requirements.version !== 1 || !isSha256Hash(requirements.mediaRequirementsHash)) {
    fail('MediaRequirements 身份无效')
  }
  const body = { ...requirements } as Record<string, unknown>
  delete body.mediaRequirementsHash
  if (await hashProductProductionValueV2(body) !== requirements.mediaRequirementsHash
    || artifact.contentHash !== await hashProductProductionValueV2(requirements)) {
    fail('MediaRequirements Hash 不闭合')
  }
  return requirements
}

function sumRerunBudget(
  plan: ProductProductionPlanV3,
  stale: ReadonlySet<string>,
  mode: TextOpenWorldCreatorMediaModeV1,
  importedBytes: number,
): ProductTaskBudgetReservationV1 {
  const result: ProductTaskBudgetReservationV1 = {
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    mediaCalls: 0,
    maximumCostUsd: 0,
    durationMs: 0,
    storageBytes: 0,
  }
  let cost: number | null = 0
  for (const task of plan.tasks) {
    if (!stale.has(task.taskKey)) continue
    const budget = task.budgetReservation
    result.modelCalls += budget.modelCalls
    result.inputTokens += budget.inputTokens
    result.outputTokens += budget.outputTokens
    result.mediaCalls += mode === 'author-import' && task.taskKey === 'media.visual'
      ? 0 : budget.mediaCalls
    result.durationMs += budget.durationMs
    result.storageBytes += mode === 'author-import' && task.taskKey === 'media.visual'
      ? importedBytes : budget.storageBytes
    if (cost !== null) {
      const taskCost = mode === 'author-import' && task.taskKey === 'media.visual'
        ? 0 : budget.maximumCostUsd
      cost = taskCost === null ? null : cost + taskCost
    }
  }
  result.maximumCostUsd = cost
  return result
}

async function capabilityWithMediaBudget(
  source: ProviderCapabilityRequirementV1,
  maximumCostUsd: number,
  slotCount: number,
): Promise<ProviderCapabilityRequirementV1> {
  const body = {
    ...source,
    maximumRequestCost: maximumCostUsd / slotCount,
    maximumTotalCost: maximumCostUsd,
  }
  delete (body as Partial<ProviderCapabilityRequirementV1>).capabilityHash
  return {
    ...body,
    capabilityHash: await hashProductProductionValueV2(body),
  } as ProviderCapabilityRequirementV1
}

/** Reconstruct the scheduler budget envelope authorized only for this media child Build. */
export async function deriveTextOpenWorldCreatorMediaExecutionBriefV1(input: {
  sourceBrief: ReturnType<typeof parseProductProductionBriefV3>
  plan: TextOpenWorldCreatorMediaPlanV1
}) {
  const source = parseProductProductionBriefV3(input.sourceBrief)
  if (input.plan.mode === 'author-import') return source
  const image = source.capabilityRequirements.find(item => (
    item.requirementKey === input.plan.capability.requirementKey && item.mediaClass === 'image'
  )) ?? fail('Creator执行Brief缺少冻结图片 capability')
  const maximumCostUsd = input.plan.capability.maximumCostUsd
  const sourceMaximum = source.productionBudget.maximumCostUsd
  if (sourceMaximum == null) fail('Creator文本生产预算必须有明确费用上限')
  return parseProductProductionBriefV3({
    ...source,
    productionBudget: {
      ...source.productionBudget,
      maximumCostUsd: sourceMaximum + maximumCostUsd,
    },
    capabilityRequirements: await Promise.all(source.capabilityRequirements.map(item => (
      item.requirementKey === image.requirementKey
        ? capabilityWithMediaBudget(item, maximumCostUsd, input.plan.slots.length)
        : item
    ))),
  })
}

export interface TextOpenWorldCreatorMediaImportInputV1 {
  artifactKey: string
  slotKey: string
  blobObjectId: number
  name: string
  altText: string
  source: string
  license: string
  rightsBasis: TextOpenWorldCreatorMediaRightsBasisV1
  rightsNote: string
}

export interface TextOpenWorldCreatorMediaCasWitnessV1 {
  productionJson: string
  baseBuildJson: string
  briefRowJson: string
  artifactsJson: string
  importBlobsJson: string
  creatorCommandsJson: string
}

export interface TextOpenWorldCreatorMediaPreparedImportV1 {
  descriptor: TextOpenWorldCreatorImportedMediaV1
  blobObjectId: number
}

export interface TextOpenWorldCreatorMediaPreparationV1 {
  scope: WorkspaceScope
  production: ProductProductionRecordV1 & { id: number }
  baseBuild: ProductBuildRecordV1 & { id: number }
  briefRow: ProductProductionBriefRecordV1 & { id: number }
  sourcePlan: ProductProductionPlanV3
  targetPlan: ProductProductionPlanV3
  targetPlanHash: string
  sourceExecutionBrief: ReturnType<typeof parseProductProductionBriefV3>
  targetExecutionBrief: ReturnType<typeof parseProductProductionBriefV3>
  mediaPlan: TextOpenWorldCreatorMediaPlanV1
  imports: TextOpenWorldCreatorMediaPreparedImportV1[]
  provider: ResolvedProductMediaCapabilityV1 | null
  casWitness: TextOpenWorldCreatorMediaCasWitnessV1
}

export interface TextOpenWorldCreatorMediaWorkspaceV1 {
  productionId: number
  buildId: number
  buildNumber: number
  buildStatus: ProductBuildRecordV1['status']
  mediaRequirementsHash: string
  slots: TextOpenWorldCreatorMediaSlotV1[]
  currentAssets: Array<{
    artifactKey: string
    contentHash: string
    mimeType: string | null
    byteSize: number
    source: string
    license: string
  }>
  proceduralMapReady: true
  audioFallback: 'silent'
}

/** Read-only author projection used to choose the complete visual sibling
 * group before any upload or provider authorization is created. */
export async function inspectTextOpenWorldCreatorMediaWorkspaceV1(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
}): Promise<TextOpenWorldCreatorMediaWorkspaceV1> {
  const scope = await resolveScope({ scope: input.scope })
  const derived = await readTextOpenWorldCreatorDerivedBuildAuthorityV1({ scope, buildId: input.buildId })
  const { production, build } = derived
  if (production.id !== input.productionId
    || production.currentBuildNumber !== build.buildNumber
    || production.status !== 'preview-ready'
    || !['preview-ready', 'release-ready'].includes(build.status)) {
    fail('只有当前已封账的Creator Build可以查看媒资工作区')
  }
  const visualTask = derived.productionPlan.tasks.find(task => task.taskKey === 'media.visual')
    ?? fail('当前Creator Plan没有visual媒资任务')
  const rows = await db.productBuildArtifacts.where('buildId').equals(build.id).toArray()
  const active = activeArtifacts(build, rows)
  const byKey = new Map(active.map(row => [row.artifactKey, row]))
  const requirementArtifact = byKey.get('text-open-world.media-requirements')
    ?? fail('当前Build缺少MediaRequirements')
  const requirements = await parseMediaRequirements(requirementArtifact)
  const slots = targetVisualSlots(requirements, visualTask.outputArtifactKeys)
  const currentAssets = slots.map(slot => {
    const row = byKey.get(slot.artifactKey) ?? fail(`当前Build缺少visual Artifact:${slot.artifactKey}`)
    let metadata: Record<string, unknown> = {}
    try {
      const value = JSON.parse(row.metadataJson) as unknown
      if (value && typeof value === 'object' && !Array.isArray(value)) metadata = value as Record<string, unknown>
    } catch { /* malformed metadata is displayed as unknown and rejected by preparation governance */ }
    return {
      artifactKey: row.artifactKey,
      contentHash: row.contentHash,
      mimeType: row.mimeType,
      byteSize: row.byteSize,
      source: typeof metadata.source === 'string' ? metadata.source : 'unknown',
      license: typeof metadata.license === 'string' ? metadata.license : 'unknown',
    }
  })
  return {
    productionId: production.id,
    buildId: build.id,
    buildNumber: build.buildNumber,
    buildStatus: build.status,
    mediaRequirementsHash: requirements.mediaRequirementsHash,
    slots,
    currentAssets,
    proceduralMapReady: true,
    audioFallback: 'silent',
  }
}

async function captureCasWitnessV1(input: {
  production: ProductProductionRecordV1 & { id: number }
  baseBuild: ProductBuildRecordV1 & { id: number }
  briefRow: ProductProductionBriefRecordV1 & { id: number }
  importBlobIds: number[]
}): Promise<TextOpenWorldCreatorMediaCasWitnessV1> {
  const [artifacts, blobs, commands] = await Promise.all([
    db.productBuildArtifacts.where('buildId').equals(input.baseBuild.id).toArray(),
    Promise.all(input.importBlobIds.map(id => db.mediaBlobObjects.get(id))),
    db.productProductionCommands.where('productionId').equals(input.production.id).toArray(),
  ])
  if (blobs.some(blob => !blob?.id)) fail('导入媒资 Blob 已不存在')
  // Preparation and ordinary revalidation hash the physical bytes. During the
  // final rw transaction, the rows are already locked and WebCrypto must not
  // be nested inside Dexie's atomic boundary; compare the exact row envelope
  // there and rely on the immediately preceding physical preparation proof.
  if (!Dexie.currentTransaction) {
    for (const blob of blobs as Array<MediaBlobObjectRecordV1 & { id: number }>) {
      await readMediaBlobObjectData({
        scope: {
          projectId: input.production.projectId,
          worldId: input.production.worldId,
          workId: input.production.workId,
        },
        blobObjectId: blob.id,
        expected: {
          contentHash: blob.contentHash,
          mimeType: blob.mimeType,
          byteSize: blob.byteSize,
        },
      })
    }
  }
  const creatorCommands = commands.filter(row => row.status === 'succeeded' && (
    row.type === 'authorize-text-open-world-creator-repair'
      || row.type === 'authorize-text-open-world-creator-media'
  )).sort((left, right) => (left.id ?? 0) - (right.id ?? 0))
  if (creatorCommands.length > MAX_MEDIA_COMMANDS) fail('Creator派生命令历史超过安全上限')
  return {
    productionJson: canonicalProductProductionJsonV2(input.production),
    baseBuildJson: canonicalProductProductionJsonV2(input.baseBuild),
    briefRowJson: canonicalProductProductionJsonV2(input.briefRow),
    artifactsJson: canonicalProductProductionJsonV2(
      artifacts.sort((left, right) => (left.id ?? 0) - (right.id ?? 0)),
    ),
    importBlobsJson: canonicalProductProductionJsonV2(
      (blobs as Array<MediaBlobObjectRecordV1 & { id: number }>)
        .sort((left, right) => left.id - right.id)
        .map(({ data, ...blob }) => ({
          ...blob,
          indexedDbByteLength: data?.byteLength ?? null,
        })),
    ),
    creatorCommandsJson: canonicalProductProductionJsonV2(creatorCommands),
  }
}

async function providerReceiptHash(provider: ResolvedProductMediaCapabilityV1): Promise<string> {
  if (!('receiptHash' in provider.receipt) || !isSha256Hash(provider.receipt.receiptHash)) {
    fail('媒资Provider绑定回执无效')
  }
  const { receiptHash, ...body } = provider.receipt
  if (await hashProductProductionValueV2(body) !== receiptHash
    || provider.receipt.capabilityHash !== provider.binding.bindingHash
    || provider.receipt.requirementKey !== provider.binding.requirementKey
    || provider.receipt.adapterId !== provider.binding.adapterId) {
    fail('媒资Provider绑定回执Hash或Binding不闭合')
  }
  return provider.receipt.receiptHash
}

/** Read-only preview used by both UI and the formal command re-preparation. */
export async function prepareTextOpenWorldCreatorMediaV1(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  mode: TextOpenWorldCreatorMediaModeV1
  maximumCostUsd?: number
  provider?: ResolvedProductMediaCapabilityV1 | null
  imports?: TextOpenWorldCreatorMediaImportInputV1[]
}): Promise<TextOpenWorldCreatorMediaPreparationV1> {
  const scope = await resolveScope({ scope: input.scope })
  const derived = await readTextOpenWorldCreatorDerivedBuildAuthorityV1({ scope, buildId: input.buildId })
  const { production, build: baseBuild, briefRow } = derived
  if (production.id !== input.productionId
    || production.status !== 'preview-ready'
    || production.currentBuildNumber !== baseBuild.buildNumber
    || !['preview-ready', 'release-ready'].includes(baseBuild.status)
    || !baseBuild.rootTerminalReceiptHash || !isSha256Hash(baseBuild.manifestHash)) {
    fail('只有当前已封账的 Creator Build 可以规划媒资')
  }
  const sourcePlan = derived.productionPlan
  const sourceExecutionBrief = derived.contracts.executionBrief
  const visualTask = sourcePlan.tasks.find(task => task.taskKey === 'media.visual')
    ?? fail('当前Creator Plan没有visual媒资任务')
  const sourceRows = await db.productBuildArtifacts.where('buildId').equals(baseBuild.id).toArray()
  const active = activeArtifacts(baseBuild, sourceRows)
  const byKey = new Map(active.map(row => [row.artifactKey, row]))
  const expectedKeys = sourcePlan.tasks.flatMap(task => task.outputArtifactKeys)
  if (active.length !== expectedKeys.length || expectedKeys.some(key => !byKey.has(key))) {
    fail('base Build active Artifact没有精确覆盖冻结Plan')
  }
  const requirementArtifact = byKey.get('text-open-world.media-requirements')
    ?? fail('base Build缺少MediaRequirements')
  const requirements = await parseMediaRequirements(requirementArtifact)
  const slots = targetVisualSlots(requirements, visualTask.outputArtifactKeys)
  if (!requirements.slots.some(slot => slot.kind === 'procedural-map'
      && slot.required && slot.productionMode === 'procedural-code' && slot.fallback === 'procedural-svg')
    || !slots.some(slot => slot.slotKind === 'character-portrait')
    || !slots.some(slot => slot.slotKind === 'scene-background')) {
    fail('首版程序地图、头像和背景最低槽位没有闭合')
  }
  const initialCasWitness = await captureCasWitnessV1({
    production,
    baseBuild,
    briefRow,
    importBlobIds: [],
  })
  const governance = await readTextOpenWorldArtifactGovernanceV1({ scope, productionId: production.id })
  if (governance.production.id !== production.id || governance.build.id !== baseBuild.id
    || governance.summary.currentProblemArtifactCount !== 0
    || governance.summary.currentProductionValidatedArtifactCount !== expectedKeys.length) {
    fail('base Build未通过G5-05完整封印与生产权威验证')
  }
  const allBuilds = await db.productBuilds.where('productionId').equals(production.id).toArray()
  const targetBuildNumber = Math.max(0, ...allBuilds.map(row => row.buildNumber)) + 1
  if (targetBuildNumber !== baseBuild.buildNumber + 1) fail('当前Build不是最新基线')
  const assetNamespaceHash = await hashProductProductionValueV2({
    schema: 'storyforge.creator-media-asset-namespace',
    version: 1,
    productionKey: production.productionKey,
  })
  let preparedImports: TextOpenWorldCreatorMediaPreparedImportV1[] = []
  let capability: TextOpenWorldCreatorMediaPlanV1['capability']
  if (input.mode === 'author-import') {
    if (input.provider != null || input.maximumCostUsd != null) {
      fail('作者导入模式不接受Provider或生成费用参数')
    }
    const imports = input.imports ?? []
    if (imports.length !== slots.length) fail('导入必须逐槽覆盖完整media.visual sibling group')
    preparedImports = await Promise.all(slots.map(async (slot, index) => {
      const imported = imports[index]
      if (!imported || imported.artifactKey !== slot.artifactKey || imported.slotKey !== slot.slotKey
        || !['author-owned', 'licensed', 'public-domain'].includes(imported.rightsBasis)) {
        fail(`导入槽位身份或权利依据无效:${slot.artifactKey}`)
      }
      const blob = await db.mediaBlobObjects.get(imported.blobObjectId)
      if (!blob?.id || !await assertRecordInScope(scope, 'mediaBlobObjects', blob, { owner: 'work' })
        || blob.storageState !== 'ready') fail(`导入Blob不存在、越界或未就绪:${slot.artifactKey}`)
      const data = await readMediaBlobObjectData({ scope, blobObjectId: blob.id })
      const mimeType = detectProductMediaMimeTypeV1(data)
      const dimensions = detectProductImageDimensionsV1(data)
      if (!mimeType || !['image/png', 'image/jpeg', 'image/webp'].includes(mimeType) || !dimensions
        || blob.mimeType !== mimeType || blob.byteSize !== data.byteLength) {
        fail(`导入图片真实MIME、尺寸或Blob元数据无效:${slot.artifactKey}`)
      }
      const descriptor: TextOpenWorldCreatorImportedMediaV1 = {
        artifactKey: slot.artifactKey,
        slotKey: slot.slotKey,
        contentHash: blob.contentHash,
        mimeType: mimeType as TextOpenWorldCreatorImportedMediaV1['mimeType'],
        byteSize: blob.byteSize,
        width: dimensions.width,
        height: dimensions.height,
        assetKey: `tow.${assetNamespaceHash.slice(0, 16)}.b${targetBuildNumber}.${slot.slotKey}`,
        name: imported.name.trim().normalize('NFC'),
        altText: imported.altText.trim().normalize('NFC'),
        source: imported.source.trim().normalize('NFC'),
        license: imported.license.trim().normalize('NFC'),
        rightsBasis: imported.rightsBasis,
        rightsNote: imported.rightsNote.trim().normalize('NFC'),
        commercialUse: true,
      }
      return { descriptor, blobObjectId: blob.id }
    }))
    const baseHashes = visualTask.outputArtifactKeys.map(key => byKey.get(key)!.contentHash)
    if (preparedImports.every((item, index) => item.descriptor.contentHash === baseHashes[index])) {
      fail('导入包与当前完整media.visual sibling group相同，不创建空修复Build')
    }
    const bindingBody = {
      schema: 'storyforge.creator-media-import-binding',
      version: 1,
      requirementKey: visualTask.capabilityRequirementKeys[0],
      adapterId: 'storyforge.creator-media-import.v1',
      executionLocation: 'browser-local',
      credentialSource: 'none',
    }
    const bindingHash = await hashProductProductionValueV2(bindingBody)
    capability = {
      requirementKey: visualTask.capabilityRequirementKeys[0] ?? fail('visual task缺少capability requirement'),
      adapterId: 'storyforge.creator-media-import.v1',
      bindingHash,
      bindingReceiptHash: await hashProductProductionValueV2({ ...bindingBody, bindingHash }),
      execution: 'local-import',
      maximumCostUsd: 0,
    }
  } else {
    if ((input.imports?.length ?? 0) > 0) fail('AI生成模式不接受本地导入槽位')
    const maximumCostUsd = input.maximumCostUsd
    const provider = input.provider
    if (!provider || typeof maximumCostUsd !== 'number' || !Number.isFinite(maximumCostUsd)
      || maximumCostUsd <= 0 || maximumCostUsd > 1_000_000) fail('AI生成需要已绑定Provider和正费用上限')
    const requirementKey = visualTask.capabilityRequirementKeys[0]
      ?? fail('visual task缺少capability requirement')
    if (provider.binding.requirementKey !== requirementKey
      || !['agnes.image-2.1-flash.v1', 'openai.gpt-image-2.v1'].includes(provider.binding.adapterId)
      || provider.receipt.requirementKey !== requirementKey
      || provider.receipt.capabilityHash !== provider.binding.bindingHash) {
      fail('AI图片Provider与冻结visual capability不一致')
    }
    capability = {
      requirementKey,
      adapterId: provider.binding.adapterId,
      bindingHash: provider.binding.bindingHash,
      bindingReceiptHash: await providerReceiptHash(provider),
      execution: 'provider',
      maximumCostUsd,
    }
  }
  const contracts = sourcePlan.tasks.map(task => ({ taskKey: task.taskKey, dependsOn: task.dependsOn }))
  const stale = new Set(textOpenWorldProductionTaskDescendantsV1('media.visual', contracts))
  const staleTaskKeys = sourcePlan.tasks.filter(task => stale.has(task.taskKey)).map(task => task.taskKey)
  const reuseTaskKeys = sourcePlan.tasks.filter(task => !stale.has(task.taskKey)).map(task => task.taskKey)
  const targetTasks = await Promise.all(sourcePlan.tasks.map(async task => {
    const base = {
      ...task,
      requiredReceipts: task.requiredReceipts.map(receipt => ({ ...receipt, receiptHash: null })),
      budgetReservation: task.taskKey === 'media.visual'
        ? { ...task.budgetReservation, maximumCostUsd: capability.maximumCostUsd }
        : { ...task.budgetReservation },
      reuse: null,
    }
    if (stale.has(task.taskKey)) return base
    const sources = task.outputArtifactKeys.map(key => byKey.get(key)!)
    return {
      ...base,
      reuse: {
        sourceBuildNumber: baseBuild.buildNumber,
        sourceArtifactKey: sources[0]!.artifactKey,
        sourceContentHash: sources[0]!.contentHash,
        reuseKey: await hashProductProductionValueV2({
          schema: 'storyforge.product-production-cross-build-reuse',
          version: 1,
          sourceBuildNumber: baseBuild.buildNumber,
          targetBuildNumber,
          taskKey: task.taskKey,
          userImpact: ['media.visual'],
          artifacts: sources.map(row => ({ artifactKey: row.artifactKey, contentHash: row.contentHash })),
        }),
        requiresRevalidation: true as const,
        reason: `Creator媒资调整未影响${task.taskKey}，完整sibling group与依赖保持不变`,
      },
    }
  }))
  const targetPlan = parseProductProductionPlanV3({
    ...sourcePlan,
    buildNumber: targetBuildNumber,
    controlEpoch: production.controlEpoch,
    tasks: targetTasks,
  }, undefined, baseBuild.briefHash)
  const targetPlanHash = await hashProductProductionValueV2(targetPlan)
  const importedBytes = preparedImports.reduce((sum, item) => sum + item.descriptor.byteSize, 0)
  const mediaBody = {
    schema: 'storyforge.text-open-world-creator-media-plan' as const,
    version: 1 as const,
    portable: true as const,
    productType: 'text-open-world' as const,
    productionKey: production.productionKey,
    baseBuild: {
      buildNumber: baseBuild.buildNumber,
      stateRevision: baseBuild.stateRevision,
      controlEpoch: baseBuild.controlEpoch,
      briefRevision: baseBuild.briefRevision,
      briefHash: baseBuild.briefHash,
      planHash: baseBuild.planHash,
      manifestHash: baseBuild.manifestHash,
      rootTerminalReceiptHash: baseBuild.rootTerminalReceiptHash!,
    },
    targetBuildNumber,
    mediaRequirementsHash: requirements.mediaRequirementsHash,
    mode: input.mode,
    slots,
    imports: preparedImports.map(item => item.descriptor),
    capability,
    targetTaskKeys: ['media.visual'] as ['media.visual'],
    staleTaskKeys,
    reuseTaskKeys,
    requiredCoverage: {
      proceduralMapReady: true as const,
      portraitSlotCount: slots.filter(slot => slot.slotKind === 'character-portrait').length,
      backgroundSlotCount: slots.filter(slot => slot.slotKind === 'scene-background').length,
      audioFallback: 'silent' as const,
    },
    estimatedRerunBudget: sumRerunBudget(targetPlan, stale, input.mode, importedBytes),
  }
  const mediaPlan = await parseTextOpenWorldCreatorMediaPlanV1({
    ...mediaBody,
    planHash: await hashProductProductionValueV2(mediaBody),
  })
  const targetExecutionBrief = await deriveTextOpenWorldCreatorMediaExecutionBriefV1({
    sourceBrief: sourceExecutionBrief,
    plan: mediaPlan,
  })
  const importBlobIds = preparedImports.map(item => item.blobObjectId)
  const casWitness = await captureCasWitnessV1({ production, baseBuild, briefRow, importBlobIds })
  if (initialCasWitness.productionJson !== casWitness.productionJson
    || initialCasWitness.baseBuildJson !== casWitness.baseBuildJson
    || initialCasWitness.briefRowJson !== casWitness.briefRowJson
    || initialCasWitness.artifactsJson !== casWitness.artifactsJson
    || initialCasWitness.creatorCommandsJson !== casWitness.creatorCommandsJson) {
    fail('媒资规划期间Production、Build、Artifact或Creator命令链发生变化，请重新预览')
  }
  return {
    scope,
    production,
    baseBuild,
    briefRow,
    sourcePlan,
    targetPlan,
    targetPlanHash,
    sourceExecutionBrief,
    targetExecutionBrief,
    mediaPlan,
    imports: preparedImports,
    provider: input.provider ?? null,
    casWitness,
  }
}

export async function assertTextOpenWorldCreatorMediaPreparationCurrentV1(
  prepared: TextOpenWorldCreatorMediaPreparationV1,
): Promise<void> {
  const [production, build, briefRow] = await Promise.all([
    db.productProductions.get(prepared.production.id),
    db.productBuilds.get(prepared.baseBuild.id),
    db.productProductionBriefs.get(prepared.briefRow.id),
  ])
  if (!production?.id || !build?.id || !briefRow?.id) fail('媒资授权CAS基线已删除')
  const current = await captureCasWitnessV1({
    production: production as ProductProductionRecordV1 & { id: number },
    baseBuild: build as ProductBuildRecordV1 & { id: number },
    briefRow: briefRow as ProductProductionBriefRecordV1 & { id: number },
    importBlobIds: prepared.imports.map(item => item.blobObjectId),
  })
  if (!same(current, prepared.casWitness)) fail('媒资授权读取集合已变化，请重新预览')
}

export async function createTextOpenWorldCreatorMediaAuthorizationV1(input: {
  prepared: TextOpenWorldCreatorMediaPreparationV1
  expectedStateRevision: number
  authorizationNonce: string
  authorizedAt: number
}): Promise<TextOpenWorldCreatorMediaAuthorizationV1> {
  const nonce = input.authorizationNonce.trim().normalize('NFC')
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(nonce)) fail('authorizationNonce 无效')
  const body = {
    schema: 'storyforge.text-open-world-creator-media-authorization' as const,
    version: 1 as const,
    portable: true as const,
    plan: input.prepared.mediaPlan,
    mediaPlanHash: input.prepared.mediaPlan.planHash,
    targetProductionPlanHash: input.prepared.targetPlanHash,
    expectedStateRevision: input.expectedStateRevision,
    authorizationNonceHash: await hashProductProductionValueV2({
      nonce,
      productionKey: input.prepared.production.productionKey,
      baseBuildNumber: input.prepared.baseBuild.buildNumber,
      targetBuildNumber: input.prepared.mediaPlan.targetBuildNumber,
      mediaPlanHash: input.prepared.mediaPlan.planHash,
    }),
    acknowledgement: {
      completeBundle: true as const,
      rightsAndProvenance: true as const,
      costAndProvider: true as const,
      oldBuildImmutable: true as const,
    },
    authorizedAt: input.authorizedAt,
  }
  return parseTextOpenWorldCreatorMediaAuthorizationV1({
    ...body,
    authorizationHash: await hashProductProductionValueV2(body),
  })
}
