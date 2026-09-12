import { db } from '../db/schema'
import type {
  ProductBuildArtifactRecordV1,
  ProductBuildRecordV1,
  ProductProductionBriefRecordV1,
  ProductProductionCommandRecordV1,
  ProductProductionPlanV3,
  ProductProductionRecordV1,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
  isSha256Hash,
} from '../product-production/hash'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import {
  parseTextOpenWorldCreatorRepairAuthorizationV1,
  type TextOpenWorldCreatorRepairAuthorizationV1,
} from './creator-artifact-repair-contract'
import type {
  ProductProductionBriefV3,
  TextOpenWorldCreatorBriefV1,
  TextOpenWorldCreatorProductionStartV1,
  TextOpenWorldCreatorProductionSourcePlanV1,
} from '../types'
import type {
  ProductProductionTaskExecutionResultV1,
} from '../product-production/scheduler'

const MAXIMUM_REPAIR_COMMANDS = 128

function fail(message: string): never {
  throw new Error(`[text-open-world-creator-repair-authority] ${message}`)
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalProductProductionJsonV2(left) === canonicalProductProductionJsonV2(right)
}

function activeArtifacts(
  build: ProductBuildRecordV1 & { id: number },
  rows: ProductBuildArtifactRecordV1[],
): ProductBuildArtifactRecordV1[] {
  return rows.filter(row => row.controlEpoch === build.controlEpoch
    && (row.status === 'accepted' || row.status === 'carried-forward'))
}

function stripReuse(plan: ProductProductionPlanV3): ProductProductionPlanV3 {
  return {
    ...plan,
    tasks: plan.tasks.map(task => ({
      ...task,
      requiredReceipts: task.requiredReceipts.map(receipt => ({ ...receipt, receiptHash: null })),
      reuse: null,
    })),
  }
}

async function validateRepairPlanV1(input: {
  authorization: TextOpenWorldCreatorRepairAuthorizationV1
  sourceBuild: ProductBuildRecordV1 & { id: number }
  targetBuild: ProductBuildRecordV1 & { id: number }
  sourcePlan: ProductProductionPlanV3
  targetPlan: ProductProductionPlanV3
  sourceArtifacts: ProductBuildArtifactRecordV1[]
}): Promise<void> {
  const { authorization, sourceBuild, targetBuild, sourcePlan, targetPlan } = input
  const impact = authorization.impactPlan
  const normalizedTarget = stripReuse({
    ...targetPlan,
    buildNumber: sourcePlan.buildNumber,
    controlEpoch: sourcePlan.controlEpoch,
  })
  if (!sameJson(normalizedTarget, stripReuse(sourcePlan))) {
    fail('repair Plan 改动了冻结 DAG、预算、能力或验收门')
  }
  const contracts = sourcePlan.tasks.map(task => ({ taskKey: task.taskKey, dependsOn: task.dependsOn }))
  const { textOpenWorldProductionTaskDescendantsV1 } = await import('./production-contract')
  const expectedStale = new Set(impact.targetTaskKeys.flatMap(taskKey => (
    textOpenWorldProductionTaskDescendantsV1(taskKey, contracts)
  )))
  const expectedStaleKeys = sourcePlan.tasks.filter(task => expectedStale.has(task.taskKey)).map(task => task.taskKey)
  const expectedReuseKeys = sourcePlan.tasks.filter(task => !expectedStale.has(task.taskKey)).map(task => task.taskKey)
  if (!sameJson(expectedStaleKeys, impact.staleTaskKeys)
    || !sameJson(expectedReuseKeys, impact.reuseTaskKeys)) {
    fail('repair authorization 的 stale/reuse 闭包不能由冻结 DAG 重建')
  }
  const handoffByTask = new Map(impact.handoffs.map(handoff => [handoff.ownerTaskKey, handoff]))
  const sourceByKey = new Map(activeArtifacts(sourceBuild, input.sourceArtifacts)
    .map(row => [row.artifactKey, row]))
  for (const task of targetPlan.tasks) {
    const handoff = handoffByTask.get(task.taskKey)
    if (handoff && (!sameJson(handoff.artifacts.map(row => row.artifactKey), task.outputArtifactKeys)
      || task.reuse !== null)) {
      fail(`repair target 没有精确覆盖完整 sibling group:${task.taskKey}`)
    }
    if (handoff && handoff.artifacts.some(delta => {
      const source = sourceByKey.get(delta.artifactKey)
      return !source || source.contentHash !== delta.baseContentHash
    })) {
      fail(`repair target 的 base sibling 已偏离授权来源:${task.taskKey}`)
    }
    if (expectedStale.has(task.taskKey)) {
      if (task.reuse !== null) fail(`stale task 不得复用:${task.taskKey}`)
      continue
    }
    const sources = task.outputArtifactKeys.map(key => sourceByKey.get(key))
    if (sources.some(row => row == null)) fail(`reuse task 来源 sibling 不完整:${task.taskKey}`)
    const rows = sources as ProductBuildArtifactRecordV1[]
    const representative = rows[0]
    const expectedReuseKey = await hashProductProductionValueV2({
      schema: 'storyforge.product-production-cross-build-reuse',
      version: 1,
      sourceBuildNumber: sourceBuild.buildNumber,
      targetBuildNumber: targetBuild.buildNumber,
      taskKey: task.taskKey,
      userImpact: impact.targetTaskKeys,
      artifacts: rows.map(row => ({ artifactKey: row.artifactKey, contentHash: row.contentHash })),
    })
    if (!task.reuse
      || task.reuse.sourceBuildNumber !== sourceBuild.buildNumber
      || task.reuse.sourceArtifactKey !== representative.artifactKey
      || task.reuse.sourceContentHash !== representative.contentHash
      || task.reuse.reuseKey !== expectedReuseKey
      || task.reuse.requiresRevalidation !== true) {
      fail(`reuse task 缺少精确跨 Build 授权:${task.taskKey}`)
    }
  }
}

export interface TextOpenWorldCreatorRepairExecutionAuthorityV1 {
  production: ProductProductionRecordV1 & { id: number }
  sourceBuild: ProductBuildRecordV1 & { id: number }
  targetBuild: ProductBuildRecordV1 & { id: number }
  briefRow: ProductProductionBriefRecordV1 & { id: number }
  command: ProductProductionCommandRecordV1 & { id: number }
  /** Oldest-to-newest repair authorization chain required by this Build. */
  commandChain: Array<ProductProductionCommandRecordV1 & { id: number }>
  creatorBrief: TextOpenWorldCreatorBriefV1
  sourcePlan: TextOpenWorldCreatorProductionSourcePlanV1
  start: TextOpenWorldCreatorProductionStartV1
  executionBrief: ProductProductionBriefV3
  sourceProductionPlan: ProductProductionPlanV3
  targetProductionPlan: ProductProductionPlanV3
  authorization: TextOpenWorldCreatorRepairAuthorizationV1
}

/**
 * Upgrade a repair-looking Build to execution authority using only persisted
 * Creator start evidence plus one successful formal repair command receipt.
 */
export async function readTextOpenWorldCreatorRepairExecutionAuthorityV1(input: {
  scope: WorkspaceScope
  buildId: number
}): Promise<TextOpenWorldCreatorRepairExecutionAuthorityV1> {
  const scope = await resolveScope({ scope: input.scope })
  const targetValue = await db.productBuilds.get(input.buildId)
  if (!targetValue?.id
    || !await assertRecordInScope(scope, 'productBuilds', targetValue, { owner: 'work' })
    || targetValue.parentBuildNumber == null) fail('目标不是当前 Work 内的 repair Build')
  const targetBuild = targetValue as ProductBuildRecordV1 & { id: number }
  const sourceBuildNumber = targetBuild.parentBuildNumber as number
  const sourceValue = await db.productBuilds.where('[productionId+buildNumber]')
    .equals([targetBuild.productionId, sourceBuildNumber]).first()
  const [productionValue, briefValue, commandRows, sourceArtifactRows] = await Promise.all([
    db.productProductions.get(targetBuild.productionId),
    db.productProductionBriefs.where('[productionId+revision]')
      .equals([targetBuild.productionId, targetBuild.briefRevision]).first(),
    db.productProductionCommands.where('[productionId+status]')
      .equals([targetBuild.productionId, 'succeeded'])
      .filter(row => row.type === 'authorize-text-open-world-creator-repair')
      .limit(MAXIMUM_REPAIR_COMMANDS + 1)
      .toArray(),
    db.productBuildArtifacts.where('buildId').equals(sourceValue?.id ?? -1).toArray(),
  ])
  if (!productionValue?.id || !sourceValue?.id || !briefValue?.id
    || !await assertRecordInScope(scope, 'productProductions', productionValue, { owner: 'work' })
    || !await assertRecordInScope(scope, 'productBuilds', sourceValue, { owner: 'work' })
    || !await assertRecordInScope(scope, 'productProductionBriefs', briefValue, { owner: 'work' })
    || productionValue.productType !== 'text-open-world'
    || targetBuild.productionId !== productionValue.id
    || sourceValue.productionId !== productionValue.id
    || briefValue.productionId !== productionValue.id
    || briefValue.briefKind !== 'text-open-world-creator-v1'
    || briefValue.status !== 'authorized'
    || targetBuild.briefHash !== briefValue.briefHash
    || targetBuild.briefRevision !== briefValue.revision
    || targetBuild.parentBuildNumber !== sourceValue.buildNumber
    || targetBuild.buildNumber !== sourceValue.buildNumber + 1) {
    fail('repair Production/Build/Creator Brief 关系不闭合')
  }
  if (commandRows.length > MAXIMUM_REPAIR_COMMANDS) fail('repair command 历史超过安全上限')
  const production = productionValue as ProductProductionRecordV1 & { id: number }
  const sourceBuild = sourceValue as ProductBuildRecordV1 & { id: number }
  const briefRow = briefValue as ProductProductionBriefRecordV1 & { id: number }
  const matches: Array<{
    command: ProductProductionCommandRecordV1 & { id: number }
    authorization: TextOpenWorldCreatorRepairAuthorizationV1
  }> = []
  for (const row of commandRows) {
    if (!row.id || !await assertRecordInScope(scope, 'productProductionCommands', row, { owner: 'work' })
      || row.productionId !== production.id || row.errorCode !== null
      || row.completedAt == null || row.completedAt < row.createdAt
      || row.expectedStateRevision == null || !isSha256Hash(row.payloadHash)) continue
    try {
      const authorization = await parseTextOpenWorldCreatorRepairAuthorizationV1(row.resultJson)
      if (authorization.impactPlan.targetBuildNumber === targetBuild.buildNumber
        && authorization.targetPlanHash === targetBuild.planHash) {
        matches.push({
          command: row as ProductProductionCommandRecordV1 & { id: number },
          authorization,
        })
      }
    } catch {
      // A malformed historical receipt is not authority for this Build.
    }
  }
  if (matches.length !== 1) fail('repair Build 缺少唯一成功授权命令回执')
  const { command, authorization } = matches[0]
  const impact = authorization.impactPlan
  if (command.expectedStateRevision !== authorization.expectedStateRevision
    || impact.productionKey !== production.productionKey
    || impact.baseBuild.buildNumber !== sourceBuild.buildNumber
    || impact.baseBuild.stateRevision !== sourceBuild.stateRevision
    || impact.baseBuild.controlEpoch !== sourceBuild.controlEpoch
    || impact.baseBuild.briefRevision !== sourceBuild.briefRevision
    || impact.baseBuild.briefHash !== sourceBuild.briefHash
    || impact.baseBuild.planHash !== sourceBuild.planHash
    || impact.baseBuild.manifestHash !== sourceBuild.manifestHash
    || impact.baseBuild.rootTerminalReceiptHash !== sourceBuild.rootTerminalReceiptHash
    || targetBuild.authorizedAt !== authorization.authorizedAt
    || !['preview-ready', 'release-ready', 'released'].includes(sourceBuild.status)
    || !isSha256Hash(sourceBuild.rootTerminalReceiptHash)) {
    fail('repair authorization 与 sealed base Build 不闭合')
  }
  const priorDerived = sourceBuild.parentBuildNumber == null
    ? null
    : await import('./creator-derived-authority').then(module => (
        module.readTextOpenWorldCreatorDerivedBuildAuthorityV1({ scope, buildId: sourceBuild.id })
      ))
  const { readTextOpenWorldCreatorExecutionBriefV1 } = await import('./creator-production-start')
  const contracts = priorDerived?.contracts ?? await readTextOpenWorldCreatorExecutionBriefV1({
    briefRow,
    planJson: sourceBuild.planJson,
  })
  const sourceProductionPlan = priorDerived?.productionPlan ?? parseProductProductionPlanV3(
    sourceBuild.planJson,
    contracts.executionBrief,
    briefRow.briefHash,
  )
  const targetProductionPlan = parseProductProductionPlanV3(
    targetBuild.planJson,
    contracts.executionBrief,
    briefRow.briefHash,
  )
  if (canonicalProductProductionJsonV2(targetProductionPlan) !== targetBuild.planJson
    || await hashProductProductionValueV2(targetProductionPlan) !== targetBuild.planHash
    || authorization.targetPlanHash !== targetBuild.planHash) {
    fail('repair target Plan Hash 不闭合')
  }
  await validateRepairPlanV1({
    authorization,
    sourceBuild,
    targetBuild,
    sourcePlan: sourceProductionPlan,
    targetPlan: targetProductionPlan,
    sourceArtifacts: sourceArtifactRows,
  })
  return {
    production,
    sourceBuild,
    targetBuild,
    briefRow,
    command,
    commandChain: [
      ...(priorDerived?.commandChain ?? []),
      command,
    ],
    creatorBrief: contracts.creatorBrief,
    sourcePlan: contracts.sourcePlan,
    start: contracts.start,
    executionBrief: contracts.executionBrief,
    sourceProductionPlan,
    targetProductionPlan,
    authorization,
  }
}

/**
 * Resolve an author-confirmed task sibling group from the candidate rows that
 * the formal repair command atomically staged in the new Build. This is a
 * zero-provider execution result; the scheduler still issues a new task Run,
 * candidate checkpoint, receipt and accepted Artifact versions for the target
 * Build.
 */
export async function resolveTextOpenWorldCreatorRepairTaskResultV1(input: {
  authority: TextOpenWorldCreatorRepairExecutionAuthorityV1
  taskKey: string
  inputArtifacts: ProductBuildArtifactRecordV1[]
}): Promise<{
  result: ProductProductionTaskExecutionResultV1
  evidenceJson: string
} | null> {
  const { authority } = input
  const handoff = authority.authorization.impactPlan.handoffs
    .find(row => row.ownerTaskKey === input.taskKey)
  if (!handoff) return null
  const task = authority.targetProductionPlan.tasks.find(row => row.taskKey === input.taskKey)
    ?? fail(`repair target task 不属于 target Plan:${input.taskKey}`)
  if (task.reuse !== null
    || !sameJson(task.outputArtifactKeys, handoff.artifacts.map(row => row.artifactKey))) {
    fail(`repair target task/sibling 授权不闭合:${input.taskKey}`)
  }
  const sourceRows = activeArtifacts(
    authority.sourceBuild,
    await db.productBuildArtifacts.where('buildId').equals(authority.sourceBuild.id).toArray(),
  )
  const sourceByKey = new Map(sourceRows.map(row => [row.artifactKey, row]))
  if (input.inputArtifacts.length !== task.inputArtifactKeys.length
    || task.inputArtifactKeys.some(key => {
      const current = input.inputArtifacts.find(row => row.artifactKey === key)
      const source = sourceByKey.get(key)
      return !current || !source || current.contentHash !== source.contentHash
    })) {
    fail(`repair target 输入已偏离确认候选的 base Build:${input.taskKey}`)
  }
  const allTargetRows = await db.productBuildArtifacts
    .where('buildId').equals(authority.targetBuild.id).toArray()
  const candidates = allTargetRows.filter(row => row.controlEpoch === authority.targetBuild.controlEpoch
    && row.status === 'candidate' && task.outputArtifactKeys.includes(row.artifactKey))
  if (candidates.length !== task.outputArtifactKeys.length
    || new Set(candidates.map(row => row.artifactKey)).size !== candidates.length) {
    fail(`repair target 缺少唯一完整 staged candidate sibling:${input.taskKey}`)
  }
  const artifacts: ProductProductionTaskExecutionResultV1['artifacts'] = []
  let storageBytes = 0
  for (const artifactKey of task.outputArtifactKeys) {
    const row = candidates.find(candidate => candidate.artifactKey === artifactKey)!
    const delta = handoff.artifacts.find(candidate => candidate.artifactKey === artifactKey)!
    let payload: unknown
    let metadata: unknown
    let quality: unknown
    let rights: unknown
    try {
      payload = JSON.parse(row.payloadJson)
      metadata = JSON.parse(row.metadataJson)
      quality = JSON.parse(row.qualityJson)
      rights = JSON.parse(row.rightsJson)
    } catch {
      fail(`repair staged candidate JSON 损坏:${artifactKey}`)
    }
    const payloadBytes = new TextEncoder().encode(row.payloadJson).byteLength
    if (row.inputHash !== handoff.impactHandoffHash
      || row.contentHash !== delta.contentHash
      || row.parentArtifactHash !== delta.baseContentHash
      || row.producerRunId == null
      || row.producerReceiptHash !== handoff.verificationReceiptHash
      || row.carriedFrom !== null
      || row.blobObjectId !== null || row.mediaKind !== null || row.mimeType !== null
      || row.byteSize !== payloadBytes
      || await hashProductProductionValueV2(payload) !== row.contentHash) {
      fail(`repair staged candidate 证据不闭合:${artifactKey}`)
    }
    storageBytes += row.byteSize
    artifacts.push({
      artifactKey: row.artifactKey,
      requirementKey: row.requirementKey,
      kind: row.kind,
      payload,
      metadata,
      quality,
      rights,
      contentHash: row.contentHash,
      byteSize: row.byteSize,
    })
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
    evidenceJson: canonicalProductProductionJsonV2({
      schema: 'storyforge.text-open-world-creator-repair-task-source',
      version: 1,
      authorizationHash: authority.authorization.authorizationHash,
      impactPlanHash: authority.authorization.impactPlanHash,
      targetPlanHash: authority.authorization.targetPlanHash,
      ownerTaskKey: handoff.ownerTaskKey,
      impactHandoffHash: handoff.impactHandoffHash,
      candidateHash: handoff.candidateHash,
      verificationReceiptHash: handoff.verificationReceiptHash,
      artifacts: handoff.artifacts,
    }),
  }
}
