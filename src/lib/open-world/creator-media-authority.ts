import { db } from '../db/schema'
import type {
  ProductBuildArtifactRecordV1,
  ProductBuildRecordV1,
  ProductProductionBriefRecordV1,
  ProductProductionCommandRecordV1,
  ProductProductionPlanV3,
  ProductProductionPlanTaskV3,
  ProductProductionRecordV1,
  TextOpenWorldCreatorBriefV1,
  TextOpenWorldCreatorProductionSourcePlanV1,
  TextOpenWorldCreatorProductionStartV1,
  WorkspaceScope,
  ProductTaskBudgetReservationV1,
} from '../types'
import type { ProductProductionTaskExecutionResultV1 } from '../product-production/scheduler'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2, isSha256Hash } from '../product-production/hash'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { readMediaBlobObjectData } from '../product-production/media-blob-store'
import { detectProductImageDimensionsV1, detectProductMediaMimeTypeV1 } from '../product-production/media-adapters'
import {
  parseTextOpenWorldCreatorMediaAuthorizationV1,
  type TextOpenWorldCreatorMediaAuthorizationV1,
} from './creator-media-contract'
import {
  deriveTextOpenWorldCreatorMediaExecutionBriefV1,
  textOpenWorldCreatorMediaRerunBudgetV1,
} from './creator-media'
import { textOpenWorldProductionTaskDescendantsV1 } from './production-contract'

const MAXIMUM_MEDIA_COMMANDS = 128

function fail(message: string): never {
  throw new Error(`[text-open-world-creator-media-authority] ${message}`)
}

function same(left: unknown, right: unknown): boolean {
  return canonicalProductProductionJsonV2(left) === canonicalProductProductionJsonV2(right)
}

function normalizedTask(task: ProductProductionPlanV3['tasks'][number]) {
  return {
    ...task,
    requiredReceipts: task.requiredReceipts.map(receipt => ({ ...receipt, receiptHash: null })),
    reuse: null,
  }
}

async function validatePlan(input: {
  authorization: TextOpenWorldCreatorMediaAuthorizationV1
  sourceBuild: ProductBuildRecordV1 & { id: number }
  targetBuild: ProductBuildRecordV1 & { id: number }
  sourcePlan: ProductProductionPlanV3
  targetPlan: ProductProductionPlanV3
  sourceArtifacts: ProductBuildArtifactRecordV1[]
}): Promise<ProductProductionPlanV3> {
  const { authorization, sourceBuild, targetBuild, sourcePlan, targetPlan } = input
  const media = authorization.plan
  const contracts = sourcePlan.tasks.map(task => ({
    taskKey: task.taskKey,
    dependsOn: task.dependsOn,
  }))
  const stale = new Set(textOpenWorldProductionTaskDescendantsV1('media.visual', contracts))
  const expectedStale = sourcePlan.tasks.filter(task => stale.has(task.taskKey)).map(task => task.taskKey)
  const expectedReuse = sourcePlan.tasks.filter(task => !stale.has(task.taskKey)).map(task => task.taskKey)
  if (targetPlan.tasks.length !== sourcePlan.tasks.length
    || media.staleTaskKeys.length + media.reuseTaskKeys.length !== sourcePlan.tasks.length
    || !same(media.staleTaskKeys, expectedStale)
    || !same(media.reuseTaskKeys, expectedReuse)) {
    fail('媒资Build stale/reuse分区不符合冻结DAG')
  }
  const active = input.sourceArtifacts.filter(row => row.controlEpoch === sourceBuild.controlEpoch
    && (row.status === 'accepted' || row.status === 'carried-forward'))
  const activeByKey = new Map(active.map(row => [row.artifactKey, row]))
  const expectedKeys = sourcePlan.tasks.flatMap(task => task.outputArtifactKeys)
  if (active.length !== expectedKeys.length || expectedKeys.some(key => !activeByKey.has(key))) {
    fail('媒资Build来源Artifact集合不完整')
  }
  const initialTasks = []
  for (let index = 0; index < sourcePlan.tasks.length; index += 1) {
    const sourceTask = sourcePlan.tasks[index]!
    const targetTask = targetPlan.tasks[index]
    if (!targetTask || sourceTask.taskKey !== targetTask.taskKey) fail('媒资Build改变了任务顺序或身份')
    const expected = normalizedTask(sourceTask)
    if (sourceTask.taskKey === 'media.visual') {
      expected.budgetReservation = {
        ...expected.budgetReservation,
        maximumCostUsd: media.capability.maximumCostUsd,
      }
    }
    if (!same(normalizedTask(targetTask), expected)) {
      fail(`媒资Build改写了未授权任务合同:${sourceTask.taskKey}`)
    }
    if (media.staleTaskKeys.includes(sourceTask.taskKey)) {
      if (targetTask.reuse !== null) fail(`stale任务不能携带reuse:${sourceTask.taskKey}`)
      initialTasks.push(expected)
      continue
    }
    const sourceRows = sourceTask.outputArtifactKeys.map(key => activeByKey.get(key)!)
    const representative = sourceRows[0]!
    const expectedReuseKey = await hashProductProductionValueV2({
      schema: 'storyforge.product-production-cross-build-reuse',
      version: 1,
      sourceBuildNumber: sourceBuild.buildNumber,
      targetBuildNumber: targetBuild.buildNumber,
      taskKey: sourceTask.taskKey,
      userImpact: ['media.visual'],
      artifacts: sourceRows.map(row => ({ artifactKey: row.artifactKey, contentHash: row.contentHash })),
    })
    initialTasks.push({ ...expected, reuse: {
      sourceBuildNumber: sourceBuild.buildNumber,
      sourceArtifactKey: representative.artifactKey,
      sourceContentHash: representative.contentHash,
      reuseKey: expectedReuseKey,
      requiresRevalidation: true as const,
      reason: `Creator媒资调整未影响${sourceTask.taskKey}，完整sibling group与依赖保持不变`,
    } })
  }
  const initialPlan = parseProductProductionPlanV3({ ...sourcePlan,
    buildNumber: targetBuild.buildNumber, controlEpoch: sourceBuild.controlEpoch, tasks: initialTasks })
  if (await hashProductProductionValueV2(initialPlan) !== authorization.targetProductionPlanHash) {
    fail('media原始Plan不能由封存来源与授权重建')
  }
  if (targetPlan.controlEpoch < initialPlan.controlEpoch || targetPlan.controlEpoch > targetBuild.controlEpoch) {
    fail('media Plan恢复轮次越界')
  }
  const expectedPlan = targetPlan.controlEpoch === initialPlan.controlEpoch ? initialPlan : {
    ...initialPlan, controlEpoch: targetPlan.controlEpoch,
    tasks: initialPlan.tasks.map(task => ({ ...task, reuse: null })),
  }
  if (!same(expectedPlan, targetPlan)) {
    fail('media Plan不是原始授权或精确恢复Plan')
  }
  if (!same(media.estimatedRerunBudget, textOpenWorldCreatorMediaRerunBudgetV1(
    initialPlan, stale, media.mode, media.imports.reduce((sum, item) => sum + item.byteSize, 0),
  ))) {
    fail('media预算不符合签署的导入清单与下游任务')
  }
  return initialPlan
}

export interface TextOpenWorldCreatorMediaExecutionAuthorityV1 {
  production: ProductProductionRecordV1 & { id: number }
  sourceBuild: ProductBuildRecordV1 & { id: number }
  targetBuild: ProductBuildRecordV1 & { id: number }
  briefRow: ProductProductionBriefRecordV1 & { id: number }
  command: ProductProductionCommandRecordV1 & { id: number }
  commandChain: Array<ProductProductionCommandRecordV1 & { id: number }>
  creatorBrief: TextOpenWorldCreatorBriefV1
  sourcePlan: TextOpenWorldCreatorProductionSourcePlanV1
  start: TextOpenWorldCreatorProductionStartV1
  executionBrief: ReturnType<typeof deriveTextOpenWorldCreatorMediaExecutionBriefV1> extends Promise<infer T> ? T : never
  sourceProductionPlan: ProductProductionPlanV3
  targetProductionPlan: ProductProductionPlanV3
  authorizedProductionPlan: ProductProductionPlanV3
  authorization: TextOpenWorldCreatorMediaAuthorizationV1
}

export async function readTextOpenWorldCreatorMediaExecutionAuthorityV1(input: {
  scope: WorkspaceScope
  buildId: number
}): Promise<TextOpenWorldCreatorMediaExecutionAuthorityV1> {
  const scope = await resolveScope({ scope: input.scope })
  const targetValue = await db.productBuilds.get(input.buildId)
  if (!targetValue?.id || targetValue.parentBuildNumber == null
    || !await assertRecordInScope(scope, 'productBuilds', targetValue, { owner: 'work' })) {
    fail('目标不是当前Work内的Creator media Build')
  }
  const targetBuild = targetValue as ProductBuildRecordV1 & { id: number }
  const sourceBuildNumber = targetBuild.parentBuildNumber as number
  const sourceValue = await db.productBuilds.where('[productionId+buildNumber]')
    .equals([targetBuild.productionId, sourceBuildNumber]).first()
  const [productionValue, briefValue, commandRows, sourceArtifacts] = await Promise.all([
    db.productProductions.get(targetBuild.productionId),
    db.productProductionBriefs.where('[productionId+revision]')
      .equals([targetBuild.productionId, targetBuild.briefRevision]).first(),
    db.productProductionCommands.where('[productionId+status]')
      .equals([targetBuild.productionId, 'succeeded'])
      .filter(row => row.type === 'authorize-text-open-world-creator-media')
      .limit(MAXIMUM_MEDIA_COMMANDS + 1).toArray(),
    db.productBuildArtifacts.where('buildId').equals(sourceValue?.id ?? -1).toArray(),
  ])
  if (!productionValue?.id || !sourceValue?.id || !briefValue?.id
    || !await assertRecordInScope(scope, 'productProductions', productionValue, { owner: 'work' })
    || !await assertRecordInScope(scope, 'productBuilds', sourceValue, { owner: 'work' })
    || !await assertRecordInScope(scope, 'productProductionBriefs', briefValue, { owner: 'work' })
    || productionValue.productType !== 'text-open-world'
    || briefValue.briefKind !== 'text-open-world-creator-v1'
    || briefValue.status !== 'authorized'
    || targetBuild.productionId !== productionValue.id
    || sourceValue.productionId !== productionValue.id
    || targetBuild.parentBuildNumber !== sourceValue.buildNumber
    || targetBuild.buildNumber !== sourceValue.buildNumber + 1
    || targetBuild.briefHash !== briefValue.briefHash
    || targetBuild.briefRevision !== briefValue.revision) {
    fail('media Production/Build/Creator Brief关系不闭合')
  }
  if (commandRows.length > MAXIMUM_MEDIA_COMMANDS) fail('media命令历史超过安全上限')
  const production = productionValue as ProductProductionRecordV1 & { id: number }
  const sourceBuild = sourceValue as ProductBuildRecordV1 & { id: number }
  const briefRow = briefValue as ProductProductionBriefRecordV1 & { id: number }
  const matches: Array<{
    command: ProductProductionCommandRecordV1 & { id: number }
    authorization: TextOpenWorldCreatorMediaAuthorizationV1
  }> = []
  const commandDiagnostics: string[] = []
  for (const row of commandRows) {
    if (!row.id || !await assertRecordInScope(scope, 'productProductionCommands', row, { owner: 'work' })
      || row.errorCode !== null || row.completedAt == null || row.expectedStateRevision == null
      || !isSha256Hash(row.payloadHash)) {
      commandDiagnostics.push(`${row.commandId}:row-envelope`)
      continue
    }
    try {
      const authorization = await parseTextOpenWorldCreatorMediaAuthorizationV1(row.resultJson)
      if (authorization.plan.targetBuildNumber === targetBuild.buildNumber) {
        matches.push({
          command: row as ProductProductionCommandRecordV1 & { id: number },
          authorization,
        })
      } else {
        commandDiagnostics.push(`${row.commandId}:target-mismatch:${authorization.plan.targetBuildNumber}/${targetBuild.buildNumber}:${authorization.targetProductionPlanHash}/${targetBuild.planHash}`)
      }
    } catch (cause) {
      commandDiagnostics.push(`${row.commandId}:parse:${cause instanceof Error ? cause.message : 'unknown'}`)
    }
  }
  if (matches.length !== 1) {
    fail(`media Build缺少唯一成功授权命令回执:${commandDiagnostics.join('|') || 'none'}`)
  }
  const { command, authorization } = matches[0]!
  const media = authorization.plan
  if (command.expectedStateRevision !== authorization.expectedStateRevision
    || media.productionKey !== production.productionKey
    || media.baseBuild.buildNumber !== sourceBuild.buildNumber
    || media.baseBuild.stateRevision !== sourceBuild.stateRevision
    || media.baseBuild.controlEpoch !== sourceBuild.controlEpoch
    || media.baseBuild.briefRevision !== sourceBuild.briefRevision
    || media.baseBuild.briefHash !== sourceBuild.briefHash
    || media.baseBuild.planHash !== sourceBuild.planHash
    || media.baseBuild.manifestHash !== sourceBuild.manifestHash
    || media.baseBuild.rootTerminalReceiptHash !== sourceBuild.rootTerminalReceiptHash
    || targetBuild.authorizedAt !== authorization.authorizedAt
    || !['preview-ready', 'release-ready', 'released'].includes(sourceBuild.status)
    || !isSha256Hash(sourceBuild.rootTerminalReceiptHash)) {
    fail('media授权与sealed base Build不闭合')
  }
  const { readTextOpenWorldCreatorDerivedBuildAuthorityV1 } = await import('./creator-derived-authority')
  const sourceAuthority = await readTextOpenWorldCreatorDerivedBuildAuthorityV1({ scope, buildId: sourceBuild.id })
  const sourceProductionPlan = sourceAuthority.productionPlan
  const targetProductionPlan = parseProductProductionPlanV3(
    targetBuild.planJson,
    undefined,
    briefRow.briefHash,
  )
  if (canonicalProductProductionJsonV2(targetProductionPlan) !== targetBuild.planJson
    || await hashProductProductionValueV2(targetProductionPlan) !== targetBuild.planHash) {
    fail('media target Plan Hash不闭合')
  }
  const authorizedProductionPlan = await validatePlan({
    authorization,
    sourceBuild,
    targetBuild,
    sourcePlan: sourceProductionPlan,
    targetPlan: targetProductionPlan,
    sourceArtifacts,
  })
  const executionBrief = await deriveTextOpenWorldCreatorMediaExecutionBriefV1({
    sourceBrief: sourceAuthority.contracts.executionBrief,
    plan: media,
  })
  if (media.mode === 'author-import') {
    const candidates = await db.productBuildArtifacts.where('[buildId+status]')
      .equals([targetBuild.id, 'candidate']).filter(row => row.controlEpoch === sourceBuild.controlEpoch).toArray()
    const task = targetProductionPlan.tasks.find(item => item.taskKey === 'media.visual')
      ?? fail('media target Plan缺少media.visual')
    if (candidates.length !== task.outputArtifactKeys.length
      || new Set(candidates.map(row => row.artifactKey)).size !== candidates.length
      || task.outputArtifactKeys.some(key => !candidates.some(row => row.artifactKey === key))) {
      fail('导入media Build缺少完整暂存sibling group')
    }
  }
  return {
    production,
    sourceBuild,
    targetBuild,
    briefRow,
    command,
    commandChain: [...sourceAuthority.commandChain, command],
    creatorBrief: sourceAuthority.contracts.creatorBrief,
    sourcePlan: sourceAuthority.contracts.sourcePlan,
    start: sourceAuthority.contracts.start,
    executionBrief,
    sourceProductionPlan,
    targetProductionPlan,
    authorizedProductionPlan,
    authorization,
  }
}

export async function resolveTextOpenWorldCreatorImportedMediaTaskResultV1(input: {
  authority: TextOpenWorldCreatorMediaExecutionAuthorityV1
  taskKey: string
}): Promise<{
  result: ProductProductionTaskExecutionResultV1
  evidenceJson: string
  authorizedStorageBytes: number
} | null> {
  const { authority } = input
  if (authority.authorization.plan.mode !== 'author-import' || input.taskKey !== 'media.visual') return null
  const task = authority.targetProductionPlan.tasks.find(item => item.taskKey === input.taskKey)
    ?? fail('导入media任务不属于target Plan')
  const candidates = await db.productBuildArtifacts.where('[buildId+status]')
    .equals([authority.targetBuild.id, 'candidate'])
    .filter(row => row.controlEpoch === authority.sourceBuild.controlEpoch).toArray()
  if (candidates.length !== task.outputArtifactKeys.length
    || new Set(candidates.map(row => row.artifactKey)).size !== candidates.length) {
    fail('导入media缺少唯一完整原始候选')
  }
  const byKey = new Map(candidates.map(row => [row.artifactKey, row]))
  const artifacts = []
  let storageBytes = 0
  for (const [index, artifactKey] of task.outputArtifactKeys.entries()) {
    const row = byKey.get(artifactKey)
    const descriptor = authority.authorization.plan.imports[index]
    if (!row || !descriptor || row.contentHash !== descriptor.contentHash
      || row.blobObjectId == null || row.mimeType !== descriptor.mimeType
      || row.byteSize !== descriptor.byteSize) {
      fail(`导入media候选已变化:${artifactKey}`)
    }
    const data = await readMediaBlobObjectData({
      scope: {
        projectId: authority.production.projectId,
        worldId: authority.production.worldId,
        workId: authority.production.workId,
      },
      blobObjectId: row.blobObjectId,
      expected: {
        contentHash: descriptor.contentHash,
        mimeType: descriptor.mimeType,
        byteSize: descriptor.byteSize,
      },
    })
    const dimensions = detectProductImageDimensionsV1(data)
    if (detectProductMediaMimeTypeV1(data) !== descriptor.mimeType || !dimensions
      || dimensions.width !== descriptor.width || dimensions.height !== descriptor.height) {
      fail(`导入media Blob物理内容已变化:${artifactKey}`)
    }
    storageBytes += descriptor.byteSize
    artifacts.push({
      artifactKey,
      requirementKey: row.requirementKey,
      kind: row.kind,
      mediaKind: row.mediaKind,
      payload: JSON.parse(row.payloadJson),
      metadata: JSON.parse(row.metadataJson),
      quality: JSON.parse(row.qualityJson),
      rights: JSON.parse(row.rightsJson),
      contentHash: row.contentHash,
      blobObjectId: row.blobObjectId,
      mimeType: row.mimeType,
      byteSize: row.byteSize,
    })
  }
  const evidence = {
    schema: 'storyforge.text-open-world-creator-media-import-source',
    version: 1,
    authorizationHash: authority.authorization.authorizationHash,
    commandId: authority.command.commandId,
    sourceBuildNumber: authority.sourceBuild.buildNumber,
    targetBuildNumber: authority.targetBuild.buildNumber,
    artifacts: authority.authorization.plan.imports.map(item => ({
      artifactKey: item.artifactKey,
      slotKey: item.slotKey,
      contentHash: item.contentHash,
      rightsBasis: item.rightsBasis,
      source: item.source,
      license: item.license,
    })),
  }
  return {
    // Creator media signs exact import sizes separately from the inherited
    // production Plan. Use that immutable authorization for execution without
    // rewriting any task reservation or refunding failed usage.
    // The scheduler still enforces the Build's aggregate storage ceiling.
    authorizedStorageBytes: authority.authorization.plan.imports.reduce((sum, item) => sum + item.byteSize, 0),
    result: {
      artifacts,
      passedGateIds: [...task.acceptanceGateIds],
      usage: {
        modelCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        mediaCalls: 0,
        costUsd: 0,
        durationMs: 0,
        storageBytes,
      },
    },
    evidenceJson: canonicalProductProductionJsonV2(evidence),
  }
}

/** Reconstruct the signed import ceiling for checkpoint/producer verification.
 * Ordinary tasks and provider media retain their frozen production reservation.
 * Reading authority does not settle/refund usage or enlarge the Build budget. */
export async function readTextOpenWorldCreatorMediaTaskBudgetV1(input: {
  scope: WorkspaceScope
  buildId: number
  task: ProductProductionPlanTaskV3
}): Promise<ProductTaskBudgetReservationV1> {
  if (input.task.taskKey !== 'media.visual') return input.task.budgetReservation
  const build = await db.productBuilds.get(input.buildId)
  if (!build?.parentBuildNumber) return input.task.budgetReservation
  const brief = await db.productProductionBriefs.where('[productionId+revision]')
    .equals([build.productionId, build.briefRevision]).first()
  if (brief?.briefKind !== 'text-open-world-creator-v1') return input.task.budgetReservation
  const { readTextOpenWorldCreatorDerivedBuildAuthorityV1 } = await import('./creator-derived-authority')
  const derived = await readTextOpenWorldCreatorDerivedBuildAuthorityV1({
    scope: input.scope, buildId: input.buildId,
  })
  const authority = derived.media
  if (authority?.authorization.plan.mode !== 'author-import') return input.task.budgetReservation
  const authorizedTask = authority.targetProductionPlan.tasks.find(task => task.taskKey === input.task.taskKey)
  if (!authorizedTask || !same(normalizedTask(authorizedTask), normalizedTask(input.task))) {
    fail('导入media预算任务不属于已签署Plan')
  }
  return {
    ...input.task.budgetReservation,
    modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0, maximumCostUsd: 0,
    storageBytes: authority.authorization.plan.imports.reduce((sum, item) => sum + item.byteSize, 0),
  }
}
