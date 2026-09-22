import { db } from '../db/schema'
import type {
  ProductBuildArtifactRecordV1,
  ProductBuildRecordV1,
  ProductProductionBriefRecordV1,
  ProductProductionCommandRecordV1,
  ProductProductionPlanV3,
  ProductProductionRecordV1,
  TextOpenWorldCreatorBriefV1,
  TextOpenWorldCreatorProductionSourcePlanV1,
  TextOpenWorldCreatorProductionStartV1,
  WorkspaceScope,
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
}): Promise<void> {
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
    if (!targetTask.reuse
      || targetTask.reuse.sourceBuildNumber !== sourceBuild.buildNumber
      || targetTask.reuse.sourceArtifactKey !== representative.artifactKey
      || targetTask.reuse.sourceContentHash !== representative.contentHash
      || targetTask.reuse.reuseKey !== expectedReuseKey
      || targetTask.reuse.requiresRevalidation !== true) {
      fail(`媒资Build reuse授权无效:${sourceTask.taskKey}`)
    }
  }
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
      if (authorization.plan.targetBuildNumber === targetBuild.buildNumber
        && authorization.targetProductionPlanHash === targetBuild.planHash) {
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
    || await hashProductProductionValueV2(targetProductionPlan) !== targetBuild.planHash
    || authorization.targetProductionPlanHash !== targetBuild.planHash) {
    fail('media target Plan Hash不闭合')
  }
  await validatePlan({
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
      .equals([targetBuild.id, 'candidate']).toArray()
    const task = targetProductionPlan.tasks.find(item => item.taskKey === 'media.visual')
      ?? fail('media target Plan缺少media.visual')
    if (candidates.length !== task.outputArtifactKeys.length
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
    authorization,
  }
}

export async function resolveTextOpenWorldCreatorImportedMediaTaskResultV1(input: {
  authority: TextOpenWorldCreatorMediaExecutionAuthorityV1
  taskKey: string
}): Promise<{ result: ProductProductionTaskExecutionResultV1; evidenceJson: string } | null> {
  const { authority } = input
  if (authority.authorization.plan.mode !== 'author-import' || input.taskKey !== 'media.visual') return null
  const task = authority.targetProductionPlan.tasks.find(item => item.taskKey === input.taskKey)
    ?? fail('导入media任务不属于target Plan')
  const candidates = await db.productBuildArtifacts.where('[buildId+status]')
    .equals([authority.targetBuild.id, 'candidate']).toArray()
  const byKey = new Map(candidates.map(row => [row.artifactKey, row]))
  const artifacts = []
  let storageBytes = 0
  for (const [index, artifactKey] of task.outputArtifactKeys.entries()) {
    const row = byKey.get(artifactKey)
    const descriptor = authority.authorization.plan.imports[index]
    if (!row || !descriptor || row.contentHash !== descriptor.contentHash
      || row.blobObjectId == null || row.mimeType !== descriptor.mimeType
      || row.byteSize !== descriptor.byteSize || row.controlEpoch !== authority.targetBuild.controlEpoch) {
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
