import { db } from '../db/schema'
import type {
  AgentRunArtifactRecordV1,
  AgentRunEventRecord,
  ProductBuildArtifactRecordV1,
  ProductBuildRecordV1,
  ProductProductionBriefRecordV1,
  ProductProductionPlanV3,
  ProductProductionRecordV1,
  ProductTaskBudgetReservationV1,
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
  hashTextOpenWorldCreatorEditImpactPlanHandoffV1,
  listTextOpenWorldCreatorArtifactEditHandoffsV1,
  type TextOpenWorldCreatorArtifactEditHandoffV1,
} from './creator-artifact-edit'
import {
  parseTextOpenWorldCreatorRepairAuthorizationV1,
  parseTextOpenWorldCreatorRepairImpactPlanV1,
  type TextOpenWorldCreatorRepairAuthorizationV1,
  type TextOpenWorldCreatorRepairHandoffRefV1,
  type TextOpenWorldCreatorRepairImpactPlanV1,
} from './creator-artifact-repair-contract'
import {
  textOpenWorldProductionTaskDescendantsV1,
} from './production-contract'
import { readTextOpenWorldProductionPlanAuthorityV1 } from './production-authority'
import { readTextOpenWorldArtifactGovernanceV1 } from './creator-artifact-governance'

const CREATOR_EDIT_RELATION_PREFIX = 'creator-edit:'

function fail(message: string): never {
  throw new Error(`[text-open-world-creator-repair] ${message}`)
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalProductProductionJsonV2(left) === canonicalProductProductionJsonV2(right)
}

function sumRerunBudget(
  plan: ProductProductionPlanV3,
  staleTaskKeys: ReadonlySet<string>,
  targetTaskKeys: ReadonlySet<string>,
  handoffs: readonly TextOpenWorldCreatorArtifactEditHandoffV1[],
): ProductTaskBudgetReservationV1 {
  let cost: number | null = 0
  const result: ProductTaskBudgetReservationV1 = {
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    mediaCalls: 0,
    maximumCostUsd: 0,
    durationMs: 0,
    storageBytes: 0,
  }
  for (const task of plan.tasks) {
    if (!staleTaskKeys.has(task.taskKey)) continue
    if (targetTaskKeys.has(task.taskKey)) {
      result.storageBytes += handoffs
        .filter(handoff => handoff.candidate.ownerSiblingGroup.ownerTaskKey === task.taskKey)
        .flatMap(handoff => handoff.candidate.rebuiltArtifacts)
        .reduce((sum, artifact) => sum + artifact.byteSize, 0)
      continue
    }
    const budget = task.budgetReservation
    result.modelCalls += budget.modelCalls
    result.inputTokens += budget.inputTokens
    result.outputTokens += budget.outputTokens
    result.mediaCalls += budget.mediaCalls
    result.durationMs += budget.durationMs
    result.storageBytes += budget.storageBytes
    if (cost !== null) cost = budget.maximumCostUsd === null ? null : cost + budget.maximumCostUsd
  }
  result.maximumCostUsd = cost
  return result
}

function activeArtifacts(
  build: ProductBuildRecordV1 & { id: number },
  rows: ProductBuildArtifactRecordV1[],
): ProductBuildArtifactRecordV1[] {
  return rows.filter(row => row.controlEpoch === build.controlEpoch
    && (row.status === 'accepted' || row.status === 'carried-forward'))
}

function sortedRows<T extends { id?: number }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => (left.id ?? 0) - (right.id ?? 0))
}

export interface TextOpenWorldCreatorRepairCasWitnessV1 {
  productionJson: string
  baseBuildJson: string
  briefRowJson: string
  sourceArtifactsJson: string
  editRunsJson: string
  editEventsJson: string
  editCheckpointsJson: string
  evidenceArtifactsJson: string
  repairCommandsJson: string
}

async function referencedEvidenceArtifactsV1(
  projectId: number,
  events: AgentRunEventRecord[],
): Promise<AgentRunArtifactRecordV1[]> {
  const refs = new Map<string, { artifactKind: string; contentHash: string }>()
  for (const event of events) {
    if (event.type !== 'evidence.artifact.recorded') continue
    let payload: unknown
    try { payload = JSON.parse(event.payloadJson) } catch { fail(`Run event ${event.id ?? '?'} payload 已损坏`) }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      fail(`Run event ${event.id ?? '?'} evidence payload 无效`)
    }
    const row = payload as Record<string, unknown>
    if (typeof row.artifactKind !== 'string' || typeof row.contentHash !== 'string'
      || !isSha256Hash(row.contentHash)) fail(`Run event ${event.id ?? '?'} evidence ref 无效`)
    refs.set(`${row.artifactKind}:${row.contentHash}`, {
      artifactKind: row.artifactKind,
      contentHash: row.contentHash,
    })
  }
  const artifacts: AgentRunArtifactRecordV1[] = []
  for (const ref of [...refs.values()].sort((left, right) => (
    left.artifactKind.localeCompare(right.artifactKind)
      || left.contentHash.localeCompare(right.contentHash)
  ))) {
    const row = await db.agentRunArtifacts
      .where('[projectId+artifactKind+contentHash]')
      .equals([projectId, ref.artifactKind, ref.contentHash])
      .first()
    if (!row) fail(`Creator edit evidence Artifact 缺失:${ref.artifactKind}:${ref.contentHash}`)
    artifacts.push(row)
  }
  return sortedRows(artifacts)
}

async function captureCasWitnessV1(input: {
  production: ProductProductionRecordV1 & { id: number }
  baseBuild: ProductBuildRecordV1 & { id: number }
  briefRow: ProductProductionBriefRecordV1 & { id: number }
}): Promise<TextOpenWorldCreatorRepairCasWitnessV1> {
  const [sourceArtifacts, allRuns, allCommands] = await Promise.all([
    db.productBuildArtifacts.where('buildId').equals(input.baseBuild.id).toArray(),
    db.agentRuns.where('productBuildId').equals(input.baseBuild.id).toArray(),
    db.productProductionCommands.where('productionId').equals(input.production.id).toArray(),
  ])
  const repairCommands = sortedRows(allCommands.filter(row => (
    row.type === 'authorize-text-open-world-creator-repair' && row.status === 'succeeded'
  )))
  if (repairCommands.length > 128) fail('repair command 历史超过安全上限')
  const editRuns = sortedRows(allRuns.filter(row => row.parentRelation?.startsWith(
    CREATOR_EDIT_RELATION_PREFIX,
  )))
  const runIds = editRuns.flatMap(row => row.id == null ? [] : [row.id])
  const [events, checkpoints] = await Promise.all([
    Promise.all(runIds.map(runId => db.agentRunEvents.where('runId').equals(runId).toArray()))
      .then(rows => sortedRows(rows.flat())),
    Promise.all(runIds.map(runId => db.agentRunCheckpoints.where('runId').equals(runId).toArray()))
      .then(rows => sortedRows(rows.flat())),
  ])
  const evidenceArtifacts = await referencedEvidenceArtifactsV1(input.production.projectId, events)
  return {
    productionJson: canonicalProductProductionJsonV2(input.production),
    baseBuildJson: canonicalProductProductionJsonV2(input.baseBuild),
    briefRowJson: canonicalProductProductionJsonV2(input.briefRow),
    sourceArtifactsJson: canonicalProductProductionJsonV2(sortedRows(sourceArtifacts)),
    editRunsJson: canonicalProductProductionJsonV2(editRuns),
    editEventsJson: canonicalProductProductionJsonV2(events),
    editCheckpointsJson: canonicalProductProductionJsonV2(checkpoints),
    evidenceArtifactsJson: canonicalProductProductionJsonV2(evidenceArtifacts),
    repairCommandsJson: canonicalProductProductionJsonV2(repairCommands),
  }
}

export interface TextOpenWorldCreatorRepairPreparationV1 {
  scope: WorkspaceScope
  production: ProductProductionRecordV1 & { id: number }
  baseBuild: ProductBuildRecordV1 & { id: number }
  briefRow: ProductProductionBriefRecordV1 & { id: number }
  sourcePlan: ProductProductionPlanV3
  targetPlan: ProductProductionPlanV3
  targetPlanHash: string
  impactPlan: TextOpenWorldCreatorRepairImpactPlanV1
  /** Verified local payload source; never serialized into the portable command receipt. */
  handoffs: TextOpenWorldCreatorArtifactEditHandoffV1[]
  handoffRunIds: number[]
  casWitness: TextOpenWorldCreatorRepairCasWitnessV1
}

function validateIndependentTargetsV1(
  targetTaskKeys: string[],
  sourcePlan: ProductProductionPlanV3,
): void {
  const contracts = sourcePlan.tasks.map(task => ({ taskKey: task.taskKey, dependsOn: task.dependsOn }))
  for (const taskKey of targetTaskKeys) {
    const descendants = new Set(textOpenWorldProductionTaskDescendantsV1(taskKey, contracts))
    const conflicting = targetTaskKeys.find(other => other !== taskKey && descendants.has(other))
    if (conflicting) {
      fail(`同批修复不能同时包含祖先/后代任务:${taskKey} -> ${conflicting}；请先修复上游 Build`)
    }
  }
}

function assertHandoffAgainstBaseV1(input: {
  handoff: TextOpenWorldCreatorArtifactEditHandoffV1
  production: ProductProductionRecordV1 & { id: number }
  baseBuild: ProductBuildRecordV1 & { id: number }
  sourcePlan: ProductProductionPlanV3
  activeByKey: ReadonlyMap<string, ProductBuildArtifactRecordV1>
}): void {
  const { candidate } = input.handoff
  const task = input.sourcePlan.tasks.find(row => row.taskKey === candidate.ownerSiblingGroup.ownerTaskKey)
    ?? fail(`Handoff owner task 不属于冻结 Plan:${candidate.ownerSiblingGroup.ownerTaskKey}`)
  if (candidate.production.productionId !== input.production.id
    || candidate.production.productionKey !== input.production.productionKey
    || candidate.baseBuild.buildId !== input.baseBuild.id
    || candidate.baseBuild.buildNumber !== input.baseBuild.buildNumber
    || candidate.baseBuild.controlEpoch !== input.baseBuild.controlEpoch
    || candidate.baseBuild.planHash !== input.baseBuild.planHash
    || candidate.baseBuild.manifestHash !== input.baseBuild.manifestHash
    || candidate.baseBuild.rootTerminalReceiptHash !== input.baseBuild.rootTerminalReceiptHash
    || candidate.status !== 'ready'
    || candidate.validation.status !== 'ready') {
    fail(`Handoff 与当前 base Build 不闭合:${task.taskKey}`)
  }
  const expectedKeys = [...task.outputArtifactKeys]
  if (!sameJson(candidate.ownerSiblingGroup.outputArtifactKeys, expectedKeys)
    || !sameJson(candidate.rebuiltArtifacts.map(row => row.artifactKey), expectedKeys)
    || candidate.rebuiltArtifacts.some(artifact => {
      const current = input.activeByKey.get(artifact.artifactKey)
      return !current || current.contentHash !== artifact.baseContentHash
        || current.version !== artifact.baseVersion
    })) {
    fail(`Handoff 必须覆盖 task 完整 sibling group 且 base Hash 当前:${task.taskKey}`)
  }
}

/** Read-only preview and exact preparation for the formal repair command. */
export async function prepareTextOpenWorldCreatorArtifactRepairV1(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
}): Promise<TextOpenWorldCreatorRepairPreparationV1> {
  const scope = await resolveScope({ scope: input.scope })
  const authority = await readTextOpenWorldProductionPlanAuthorityV1({
    scope,
    productionId: input.productionId,
    buildId: input.buildId,
  })
  if (!authority.authority.valid
    || !['creator-start-v1', 'creator-repair-v1', 'creator-media-v1'].includes(authority.authority.origin)) {
    fail(`base Build 缺少 Creator 生产权威:${authority.authority.diagnostic ?? 'unknown'}`)
  }
  const production = authority.production
  const baseBuild = authority.build
  if (production.status !== 'preview-ready'
    || !['preview-ready', 'release-ready'].includes(baseBuild.status)
    || production.currentBuildNumber !== baseBuild.buildNumber
    || production.currentBriefRevision !== baseBuild.briefRevision
    || !baseBuild.rootTerminalReceiptHash
    || !isSha256Hash(baseBuild.manifestHash)) {
    fail('只有当前已封账的 Creator Build 可以创建局部修复')
  }
  const briefValue = await db.productProductionBriefs
    .where('[productionId+revision]')
    .equals([production.id, baseBuild.briefRevision])
    .first()
  if (!briefValue?.id
    || !await assertRecordInScope(scope, 'productProductionBriefs', briefValue, { owner: 'work' })
    || briefValue.briefKind !== 'text-open-world-creator-v1'
    || briefValue.status !== 'authorized'
    || briefValue.briefHash !== baseBuild.briefHash) {
    fail('base Build 的 Creator Brief 不存在或未授权')
  }
  const briefRow = briefValue as ProductProductionBriefRecordV1 & { id: number }
  const sourcePlan = parseProductProductionPlanV3(
    baseBuild.planJson,
    undefined,
    baseBuild.briefHash,
  )
  if (canonicalProductProductionJsonV2(sourcePlan) !== baseBuild.planJson
    || await hashProductProductionValueV2(sourcePlan) !== baseBuild.planHash) {
    fail('base Build Plan Hash 不闭合')
  }
  const initialCasWitness = await captureCasWitnessV1({ production, baseBuild, briefRow })
  const allBuilds = await db.productBuilds.where('productionId').equals(production.id).toArray()
  const targetBuildNumber = Math.max(0, ...allBuilds.map(row => row.buildNumber)) + 1
  if (targetBuildNumber !== baseBuild.buildNumber + 1) {
    fail('当前 Build 不是 Production 历史中的最新基线')
  }
  const handoffs = await listTextOpenWorldCreatorArtifactEditHandoffsV1({
    scope,
    productionId: production.id,
    buildId: baseBuild.id,
  })
  if (!handoffs.length) fail('没有已确认并完成结算的 Creator Artifact 修改交接单')
  const planOrder = new Map(sourcePlan.tasks.map((task, index) => [task.taskKey, index]))
  handoffs.sort((left, right) => (
    (planOrder.get(left.candidate.ownerSiblingGroup.ownerTaskKey) ?? Number.MAX_SAFE_INTEGER)
      - (planOrder.get(right.candidate.ownerSiblingGroup.ownerTaskKey) ?? Number.MAX_SAFE_INTEGER)
      || left.snapshot.run.id - right.snapshot.run.id
  ))
  const targetTaskKeys = handoffs.map(row => row.candidate.ownerSiblingGroup.ownerTaskKey)
  if (new Set(targetTaskKeys).size !== targetTaskKeys.length) {
    fail('同一 owner task 只能有一张未消费的确认交接单')
  }
  validateIndependentTargetsV1(targetTaskKeys, sourcePlan)
  const sourceArtifacts = await db.productBuildArtifacts.where('buildId').equals(baseBuild.id).toArray()
  const active = activeArtifacts(baseBuild, sourceArtifacts)
  const activeByKey = new Map(active.map(row => [row.artifactKey, row]))
  const expectedArtifactKeys = sourcePlan.tasks.flatMap(task => task.outputArtifactKeys)
  if (active.length !== expectedArtifactKeys.length
    || expectedArtifactKeys.some(key => !activeByKey.has(key))) {
    fail('base Build 的 active Artifact 集合没有精确覆盖 Plan')
  }
  for (const handoff of handoffs) assertHandoffAgainstBaseV1({
    handoff,
    production,
    baseBuild,
    sourcePlan,
    activeByKey,
  })
  const governance = await readTextOpenWorldArtifactGovernanceV1({
    scope,
    productionId: production.id,
  })
  const productionValidated = governance.artifacts.filter(artifact => (
    artifact.currentEpoch
    && artifact.health === 'verified'
    && artifact.productionValidation === 'production-validated'
    && (artifact.artifactStatus === 'accepted' || artifact.artifactStatus === 'carried-forward')
  ))
  if (governance.production.id !== production.id
    || governance.production.stateRevision !== production.stateRevision
    || governance.build.id !== baseBuild.id
    || governance.build.planHash !== baseBuild.planHash
    || governance.summary.currentProblemArtifactCount !== 0
    || governance.summary.currentProductionValidatedArtifactCount !== expectedArtifactKeys.length
    || productionValidated.length !== expectedArtifactKeys.length
    || !sameJson(
      productionValidated.map(artifact => artifact.artifactKey).sort(),
      [...expectedArtifactKeys].sort(),
    )) {
    fail('base Build 未通过 G5-05 完整封印与生产权威验证')
  }
  const contracts = sourcePlan.tasks.map(task => ({ taskKey: task.taskKey, dependsOn: task.dependsOn }))
  const stale = new Set(targetTaskKeys.flatMap(taskKey => (
    textOpenWorldProductionTaskDescendantsV1(taskKey, contracts)
  )))
  const staleTaskKeys = sourcePlan.tasks.filter(task => stale.has(task.taskKey)).map(task => task.taskKey)
  const reuseTaskKeys = sourcePlan.tasks.filter(task => !stale.has(task.taskKey)).map(task => task.taskKey)
  const targetSet = new Set(targetTaskKeys)
  const handoffRefs: TextOpenWorldCreatorRepairHandoffRefV1[] = await Promise.all(
    handoffs.map(async handoff => ({
      ownerTaskKey: handoff.candidate.ownerSiblingGroup.ownerTaskKey,
      target: {
        artifactKey: handoff.candidate.target.artifactKey,
        entityIdentity: handoff.candidate.target.entityIdentity,
      },
      impactHandoffHash: await hashTextOpenWorldCreatorEditImpactPlanHandoffV1(handoff.intent),
      intentHash: handoff.intent.intentHash,
      candidateHash: handoff.candidate.candidateHash,
      terminalReceiptHash: handoff.terminalReceipt.receiptHash,
      verificationReceiptHash: handoff.verificationReceipt.receiptHash,
      baseGroupHash: handoff.candidate.ownerSiblingGroup.baseGroupHash,
      artifacts: handoff.candidate.rebuiltArtifacts.map(artifact => ({
        artifactKey: artifact.artifactKey,
        baseContentHash: artifact.baseContentHash,
        contentHash: artifact.contentHash,
      })),
    })),
  )
  const handoffSetHash = await hashProductProductionValueV2({
    schema: 'storyforge.text-open-world-creator-repair-handoff-set',
    version: 1,
    productionKey: production.productionKey,
    baseBuildNumber: baseBuild.buildNumber,
    handoffs: handoffRefs,
  })
  const impactBody = {
    schema: 'storyforge.text-open-world-creator-repair-impact-plan' as const,
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
      rootTerminalReceiptHash: baseBuild.rootTerminalReceiptHash,
    },
    targetBuildNumber,
    handoffSetHash,
    handoffs: handoffRefs,
    targetTaskKeys,
    staleTaskKeys,
    reuseTaskKeys,
    estimatedRerunBudget: sumRerunBudget(sourcePlan, stale, targetSet, handoffs),
  }
  const impactPlan = await parseTextOpenWorldCreatorRepairImpactPlanV1({
    ...impactBody,
    impactPlanHash: await hashProductProductionValueV2(impactBody),
  })
  const targetTasks = await Promise.all(sourcePlan.tasks.map(async task => {
    const base = {
      ...task,
      requiredReceipts: task.requiredReceipts.map(receipt => ({ ...receipt, receiptHash: null })),
      reuse: null,
    }
    if (stale.has(task.taskKey)) return base
    const sources = task.outputArtifactKeys.map(key => activeByKey.get(key)!)
    const representative = sources[0]
    return {
      ...base,
      reuse: {
        sourceBuildNumber: baseBuild.buildNumber,
        sourceArtifactKey: representative.artifactKey,
        sourceContentHash: representative.contentHash,
        reuseKey: await hashProductProductionValueV2({
          schema: 'storyforge.product-production-cross-build-reuse',
          version: 1,
          sourceBuildNumber: baseBuild.buildNumber,
          targetBuildNumber,
          taskKey: task.taskKey,
          userImpact: targetTaskKeys,
          artifacts: sources.map(row => ({
            artifactKey: row.artifactKey,
            contentHash: row.contentHash,
          })),
        }),
        requiresRevalidation: true as const,
        reason: `Creator 修改未影响 ${task.taskKey}，依赖闭包与完整 sibling group 保持不变`,
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
  const casWitness = await captureCasWitnessV1({ production, baseBuild, briefRow })
  if (!sameJson(initialCasWitness, casWitness)) {
    fail('影响预览期间 Production、Build、Handoff 或证明读集已变化')
  }
  return {
    scope,
    production,
    baseBuild,
    briefRow,
    sourcePlan,
    targetPlan,
    targetPlanHash,
    impactPlan,
    handoffs,
    handoffRunIds: handoffs.map(row => row.snapshot.run.id),
    casWitness,
  }
}

/** The command transaction calls this after enlisting every witness table. */
export async function assertTextOpenWorldCreatorRepairPreparationCurrentV1(
  prepared: TextOpenWorldCreatorRepairPreparationV1,
): Promise<void> {
  const [production, baseBuild, briefRow] = await Promise.all([
    db.productProductions.get(prepared.production.id),
    db.productBuilds.get(prepared.baseBuild.id),
    db.productProductionBriefs.get(prepared.briefRow.id),
  ])
  if (!production?.id || !baseBuild?.id || !briefRow?.id) fail('修复授权 CAS 基线已被删除')
  const current = await captureCasWitnessV1({
    production: production as ProductProductionRecordV1 & { id: number },
    baseBuild: baseBuild as ProductBuildRecordV1 & { id: number },
    briefRow: briefRow as ProductProductionBriefRecordV1 & { id: number },
  })
  if (!sameJson(current, prepared.casWitness)) fail('修复授权读取集合已变化，请重新预览影响')
}

export async function createTextOpenWorldCreatorRepairAuthorizationV1(input: {
  prepared: TextOpenWorldCreatorRepairPreparationV1
  expectedStateRevision: number
  authorizationNonce: string
  authorizedAt: number
}): Promise<TextOpenWorldCreatorRepairAuthorizationV1> {
  const nonce = input.authorizationNonce.trim().normalize('NFC')
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(nonce)) fail('authorizationNonce 无效')
  if (!Number.isSafeInteger(input.authorizedAt) || input.authorizedAt < 1) fail('authorizedAt 无效')
  const authorizationNonceHash = await hashProductProductionValueV2({
    nonce,
    productionKey: input.prepared.production.productionKey,
    baseBuildNumber: input.prepared.baseBuild.buildNumber,
    targetBuildNumber: input.prepared.impactPlan.targetBuildNumber,
    impactPlanHash: input.prepared.impactPlan.impactPlanHash,
  })
  const body = {
    schema: 'storyforge.text-open-world-creator-repair-authorization' as const,
    version: 1 as const,
    portable: true as const,
    impactPlan: input.prepared.impactPlan,
    impactPlanHash: input.prepared.impactPlan.impactPlanHash,
    targetPlanHash: input.prepared.targetPlanHash,
    expectedStateRevision: input.expectedStateRevision,
    authorizationNonceHash,
    authorizedAt: input.authorizedAt,
  }
  return parseTextOpenWorldCreatorRepairAuthorizationV1({
    ...body,
    authorizationHash: await hashProductProductionValueV2(body),
  })
}
