import { db } from '../db/schema'
import {
  readTextOpenWorldArtifactGovernanceV1,
  type TextOpenWorldArtifactGovernanceProjectionV1,
  type TextOpenWorldGovernedArtifactV1,
} from './creator-artifact-governance'
import {
  TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_LIMITS_V1,
  TEXT_OPEN_WORLD_CREATOR_EDITABLE_ARTIFACT_KINDS_V1,
  hashTextOpenWorldCreatorEditCarriedLineageV1,
  hashTextOpenWorldCreatorEditOwnerSiblingGroupV1,
  parseTextOpenWorldCreatorEditFieldV1,
  parseTextOpenWorldCreatorEditTargetV1,
  type TextOpenWorldCreatorEditBaseSiblingV1,
  type TextOpenWorldCreatorEditFieldV1,
  type TextOpenWorldCreatorEditOwnerSiblingGroupV1,
  type TextOpenWorldCreatorEditProducerEvidenceV1,
  type TextOpenWorldCreatorEditTargetV1,
} from './creator-artifact-edit-contract'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
  isSha256Hash,
} from '../product-production/hash'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import {
  hashProductProductionCarriedCandidateV1,
  hashProductProductionCarriedReceiptV1,
  hashProductProductionTaskCandidateV1,
  hashProductProductionTaskReceiptV1,
  parseProductProductionPortableTaskLedgerV1,
} from '../product-production/task-evidence'
import { readAgentRunV1 } from '../agent/run/event-store'
import { readLatestVerifiedAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import type {
  ProductBuildArtifactRecordV1,
  ProductBuildRecordV1,
  ProductProductionPlanTaskV3,
} from '../types'
import type { AssembleContextInput } from '../registry/types'

const EDITABLE_KIND_SET = new Set<string>(TEXT_OPEN_WORLD_CREATOR_EDITABLE_ARTIFACT_KINDS_V1)

export interface TextOpenWorldCreatorEditSemanticProjectionV1 {
  taskKey: string
  outputArtifactKeys: readonly string[]
  target: {
    artifactKey: string
    entityIdentity: string | null
  }
  /** Full validated group draft. It stays inside this module and is never sent to the model. */
  draft: unknown
  draftHash: string
  stableStructureHash: string
  editableFields: readonly TextOpenWorldCreatorEditFieldV1[]
}

/**
 * Narrow wiring point for the 19 domain projectors. The context layer owns DB,
 * governance and snapshot CAS; the domain dispatch exclusively owns which
 * semantic values are editable.
 */
export interface TextOpenWorldCreatorEditSemanticResolverV1 {
  project(input: {
    taskKey: string
    artifacts: Array<{ artifactKey: string; payload: unknown }>
    context: string
    target: {
      artifactKey: string
      entityIdentity: string | null
    }
  }): Promise<TextOpenWorldCreatorEditSemanticProjectionV1>
}

export interface TextOpenWorldCreatorEditSemanticDraftV1 {
  schema: 'storyforge.text-open-world-creator-edit-semantic-draft'
  version: 1
  artifactKey: string
  entityIdentity: string | null
  fields: Array<{
    fieldId: string
    label: string
    valueKind: TextOpenWorldCreatorEditFieldV1['valueKind']
    value: unknown
  }>
}

export interface TextOpenWorldCreatorEditTargetContextV1 {
  schema: 'storyforge.text-open-world-creator-edit-target-context'
  version: 1
  governanceSnapshotHash: string
  production: TextOpenWorldArtifactGovernanceProjectionV1['production']
  build: TextOpenWorldArtifactGovernanceProjectionV1['build'] & {
    stateRevision: number
    manifestHash: string
    rootTerminalReceiptHash: string
  }
  target: TextOpenWorldCreatorEditTargetV1
  ownerSiblingGroup: TextOpenWorldCreatorEditOwnerSiblingGroupV1
  producerEvidence: TextOpenWorldCreatorEditProducerEvidenceV1
  productionValidationReceiptHash: string
  baseDraftHash: string
  stableStructureHash: string
  semanticDraft: TextOpenWorldCreatorEditSemanticDraftV1
  semanticDraftHash: string
  editableFields: TextOpenWorldCreatorEditFieldV1[]
}

export interface TextOpenWorldCreatorEditWorkspaceBaseArtifactV1 {
  rowId: number
  artifactKey: string
  requirementKey: string | null
  kind: string
  version: number
  status: 'accepted' | 'carried-forward'
  controlEpoch: number
  inputHash: string
  contentHash: string
  producerRunId: number
  producerReceiptHash: string
  parentArtifactHash: string | null
  carriedFrom: TextOpenWorldCreatorEditBaseSiblingV1['carriedFrom']
  payload: unknown
  metadata: unknown
  quality: unknown
  rights: unknown
}

/** Internal harness payload. Only targetContext is registered/model-visible. */
export interface TextOpenWorldCreatorEditWorkspaceV1 {
  targetContext: TextOpenWorldCreatorEditTargetContextV1
  fullDraft: unknown
  stableStructureHash: string
  taskContext: string
  baseArtifacts: TextOpenWorldCreatorEditWorkspaceBaseArtifactV1[]
}

export interface TextOpenWorldCreatorEditContextDependenciesV1 {
  readGovernance(input: {
    scope: NonNullable<AssembleContextInput['scope']>
    productionId: number
  }): Promise<TextOpenWorldArtifactGovernanceProjectionV1>
  readBuild(buildId: number): Promise<(ProductBuildRecordV1 & { id: number }) | undefined>
  readArtifacts(rowIds: number[]): Promise<Array<ProductBuildArtifactRecordV1 | undefined>>
  readProducerEvidence(input: {
    scope: NonNullable<AssembleContextInput['scope']>
    build: ProductBuildRecordV1 & { id: number }
    task: ProductProductionPlanTaskV3
    plan: ReturnType<typeof parseProductProductionPlanV3>
    baseSiblings: readonly TextOpenWorldCreatorEditBaseSiblingV1[]
    producerRunId: number
    producerReceiptHash: string
    inputHash: string
  }): Promise<TextOpenWorldCreatorEditProducerEvidenceV1>
  readTaskContext(input: {
    assembleInput: AssembleContextInput
    task: ProductProductionPlanTaskV3
  }): Promise<string>
  semanticResolver: TextOpenWorldCreatorEditSemanticResolverV1
}

function fail(message: string): never {
  throw new Error(`[text-open-world-creator-edit-context] ${message}`)
}

function requiredPositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) fail(`${label} 必须是正整数`)
  return Number(value)
}

function sameOrderedStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function exactGovernedSibling(
  projection: TextOpenWorldArtifactGovernanceProjectionV1,
  task: ProductProductionPlanTaskV3,
  artifactKey: string,
): TextOpenWorldGovernedArtifactV1 {
  const matches = projection.artifacts.filter(artifact => (
    artifact.artifactKey === artifactKey
    && artifact.currentEpoch
    && (artifact.artifactStatus === 'accepted' || artifact.artifactStatus === 'carried-forward')
    && artifact.health === 'verified'
    && artifact.productionValidation === 'production-validated'
    && artifact.ownerTaskKey === task.taskKey
  ))
  if (matches.length !== 1) {
    fail(`owner task sibling 不存在、重复或尚未通过生产验证:${artifactKey}`)
  }
  return matches[0]!
}

function assertRawSiblingMatchesView(
  row: ProductBuildArtifactRecordV1 | undefined,
  view: TextOpenWorldGovernedArtifactV1,
  input: { buildId: number; controlEpoch: number },
): asserts row is ProductBuildArtifactRecordV1 & { id: number } {
  if (!row || row.id !== view.rowId || row.buildId !== input.buildId
    || row.controlEpoch !== input.controlEpoch || row.artifactKey !== view.artifactKey
    || row.kind !== view.kind || row.version !== view.version
    || row.status !== view.artifactStatus || row.inputHash !== view.inputHash
    || row.contentHash !== view.contentHash || row.producerRunId !== view.producerRunId
    || row.producerReceiptHash !== view.producerReceiptHash
    || canonicalProductProductionJsonV2(JSON.parse(row.payloadJson)) !== row.payloadJson) {
    fail(`Artifact raw row 与治理快照不一致:${view.artifactKey}`)
  }
}

function decodePointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~')
}

function valueAtJsonPointer(root: unknown, pointer: string): unknown {
  let cursor = root
  for (const encoded of pointer.slice(1).split('/')) {
    const key = decodePointerSegment(encoded)
    if (Array.isArray(cursor)) {
      if (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= cursor.length
        || !Object.prototype.hasOwnProperty.call(cursor, Number(key))) {
        fail(`editable field JSON Pointer 不存在:${pointer}`)
      }
      cursor = cursor[Number(key)]
    } else if (cursor && typeof cursor === 'object'
      && Object.prototype.hasOwnProperty.call(cursor, key)) {
      cursor = (cursor as Record<string, unknown>)[key]
    } else {
      fail(`editable field JSON Pointer 不存在:${pointer}`)
    }
  }
  return cursor
}

async function defaultReadTaskContext(input: {
  assembleInput: AssembleContextInput
  task: ProductProductionPlanTaskV3
}): Promise<string> {
  if (!input.task.skillId) fail(`owner task 缺少已登记 Skill:${input.task.taskKey}`)
  const [{ getAgentSkillV1 }, { CONTEXT_SOURCE_BY_KEY }] = await Promise.all([
    import('../agent/skill-registry'),
    import('../registry/context-sources'),
  ])
  const skill = getAgentSkillV1(input.task.skillId)
  if (skill.contextSourceKeys.length !== 1) {
    fail(`owner task 必须有唯一权威领域上下文源:${input.task.taskKey}`)
  }
  const sourceKey = skill.contextSourceKeys[0]!
  if (sourceKey === 'text-open-world.creator-edit-target' || sourceKey === 'manualText') {
    fail(`owner task 领域上下文不得递归读取 Creator edit source:${input.task.taskKey}`)
  }
  const source = CONTEXT_SOURCE_BY_KEY.get(sourceKey)
  if (!source || source.ownerFrom !== 'work') fail(`owner task 上下文源未登记或 owner 错误:${sourceKey}`)
  const context = await source.read({
    ...input.assembleInput,
    sourceKeys: [sourceKey],
    productProductionTaskKey: input.task.taskKey,
    productArtifactKeys: [...input.task.inputArtifactKeys],
  })
  if (!context.trim()) fail(`owner task 领域上下文为空:${sourceKey}`)
  return context
}

const DEFAULT_SEMANTIC_RESOLVER_V1: TextOpenWorldCreatorEditSemanticResolverV1 = {
  project: async input => {
    const dispatch = await import('./creator-artifact-edit-dispatch')
    return await dispatch.projectTextOpenWorldCreatorAuthorEditableDraftV1(input)
  },
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exactObjectKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !(key in value))) {
    fail(`${label} 字段不精确`)
  }
}

function readTerminalLedgerEvidence(input: {
  build: ProductBuildRecordV1 & { id: number }
  plan: ReturnType<typeof parseProductProductionPlanV3>
  task: ProductProductionPlanTaskV3
}) {
  const entries = parseProductProductionPortableTaskLedgerV1({
    budgetLedgerJson: input.build.budgetLedgerJson,
    plan: input.plan,
  })
  const entry = entries.find(row => row.taskKey === input.task.taskKey)
  if (!entry) fail(`terminal ledger 缺少 owner task:${input.task.taskKey}`)
  let parsed: unknown
  try { parsed = JSON.parse(input.build.budgetLedgerJson) } catch {
    fail('terminal ledger JSON 损坏')
  }
  if (canonicalProductProductionJsonV2(parsed) !== input.build.budgetLedgerJson) {
    fail('terminal ledger 不是规范 JSON')
  }
  const ledger = objectRecord(parsed, 'terminal ledger')
  const rootRunId = requiredPositiveInteger(ledger.rootRunId, 'terminal ledger.rootRunId')
  const tasks = objectRecord(ledger.tasks, 'terminal ledger.tasks')
  const rawTask = objectRecord(tasks[input.task.taskKey], `terminal ledger task:${input.task.taskKey}`)
  const taskRunId = requiredPositiveInteger(rawTask.runId, 'terminal ledger task.runId')
  if (!Array.isArray(rawTask.passedGateIds)) fail('terminal ledger task.passedGateIds 无效')
  return {
    entries,
    entry,
    rawTask,
    rootRunId,
    taskRunId,
    rawPassedGateIds: rawTask.passedGateIds as unknown[],
  }
}

async function readClosedRootRun(input: {
  scope: NonNullable<AssembleContextInput['scope']>
  build: ProductBuildRecordV1 & { id: number }
  taskParentRunId: number | null | undefined
  ledgerRootRunId: number
}) {
  if (input.taskParentRunId !== input.ledgerRootRunId) {
    fail('producer Run 未绑定 terminal ledger root')
  }
  const root = await readAgentRunV1(input.scope, input.ledgerRootRunId)
  const boundary = root.contract.scope.productProduction
  if (root.run.id !== input.ledgerRootRunId
    || root.run.projectId !== input.scope.projectId || root.run.workId !== input.scope.workId
    || root.run.productBuildId !== input.build.id
    || root.run.parentRunId != null || root.run.parentRelation != null
    || root.run.status !== 'completed' || root.projection.state !== 'completed'
    || root.run.terminalReceiptHash !== input.build.rootTerminalReceiptHash
    || root.projection.terminalReceiptHash !== input.build.rootTerminalReceiptHash
    || !boundary || boundary.productBuildId !== input.build.id
    || boundary.buildNumber !== input.build.buildNumber
    || boundary.controlEpoch !== input.build.controlEpoch
    || boundary.planHash !== input.build.planHash || boundary.taskKey !== '$root') {
    fail('producer root Run 与 Build terminal receipt 不闭合')
  }
  return root
}

function exactSiblingCandidateArtifacts(
  result: Record<string, unknown>,
  siblings: readonly TextOpenWorldCreatorEditBaseSiblingV1[],
): void {
  if (!Array.isArray(result.artifacts) || result.artifacts.length !== siblings.length) {
    fail('producer checkpoint candidate 未完整覆盖 owner siblings')
  }
  const byKey = new Map<string, Record<string, unknown>>()
  for (const value of result.artifacts) {
    const row = objectRecord(value, 'producer checkpoint artifact')
    if (typeof row.artifactKey !== 'string' || byKey.has(row.artifactKey)) {
      fail('producer checkpoint candidate Artifact key 无效或重复')
    }
    byKey.set(row.artifactKey, row)
  }
  if (siblings.some(sibling => {
    const row = byKey.get(sibling.artifactKey)
    return !row || row.contentHash !== sibling.contentHash
  })) fail('producer checkpoint candidate 与 owner sibling contentHash 不闭合')
}

function zeroPortableUsage(value: {
  modelCalls: number
  inputTokens: number
  outputTokens: number
  mediaCalls: number
  costUsd: number | null
  durationMs: number
  storageBytes: number
}): boolean {
  return value.modelCalls === 0 && value.inputTokens === 0 && value.outputTokens === 0
    && value.mediaCalls === 0 && value.costUsd === 0 && value.durationMs === 0
    && value.storageBytes === 0
}

async function defaultReadProducerEvidence(input: {
  scope: NonNullable<AssembleContextInput['scope']>
  build: ProductBuildRecordV1 & { id: number }
  task: ProductProductionPlanTaskV3
  plan: ReturnType<typeof parseProductProductionPlanV3>
  baseSiblings: readonly TextOpenWorldCreatorEditBaseSiblingV1[]
  producerRunId: number
  producerReceiptHash: string
  inputHash: string
}): Promise<TextOpenWorldCreatorEditProducerEvidenceV1> {
  const statuses = new Set(input.baseSiblings.map(sibling => sibling.status))
  if (statuses.size !== 1) fail('owner sibling group 不允许混合 accepted/carried-forward')
  const status = input.baseSiblings[0]?.status
  if (!status) fail('owner sibling group 为空')
  const ledger = readTerminalLedgerEvidence(input)
  if (ledger.taskRunId !== input.producerRunId
    || ledger.entry.idempotencyKey !== input.inputHash
    || ledger.entry.terminalReceiptHash !== input.producerReceiptHash) {
    fail('owner task terminal ledger 与 sibling producer 不闭合')
  }
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, input.producerRunId)
  if (status === 'carried-forward') {
    if (checkpoint) fail('carried synthetic producer Run 不得包含 candidate checkpoint')
    const snapshot = await readAgentRunV1(input.scope, input.producerRunId)
    const boundary = snapshot.contract.scope.productProduction
    const terminalStep = snapshot.projection.steps[input.task.taskKey]
    const dependencies = input.task.dependsOn.map(taskKey => {
      const dependency = ledger.entries.find(entry => entry.taskKey === taskKey)
      if (!dependency) fail(`carried owner task 缺少 dependency ledger:${taskKey}`)
      return { taskKey, receiptHash: dependency.terminalReceiptHash }
    })
    const candidateHash = await hashProductProductionCarriedCandidateV1(input.baseSiblings)
    const terminalReceiptHash = await hashProductProductionCarriedReceiptV1({
      taskKey: input.task.taskKey,
      inputHash: input.inputHash,
      candidateHash,
      dependencies,
      passedGateIds: input.task.acceptanceGateIds,
      controlEpoch: input.build.controlEpoch,
    })
    if (ledger.entry.attempt !== 1 || ledger.entry.candidateHash !== candidateHash
      || terminalReceiptHash !== input.producerReceiptHash
      || canonicalProductProductionJsonV2(ledger.rawPassedGateIds)
        !== canonicalProductProductionJsonV2(input.task.acceptanceGateIds)
      || !zeroPortableUsage(ledger.entry.usage)
      || snapshot.run.id !== input.producerRunId
      || snapshot.run.projectId !== input.scope.projectId || snapshot.run.workId !== input.scope.workId
      || snapshot.run.productBuildId !== input.build.id
      || snapshot.run.parentRunId == null
      || snapshot.run.parentRelation !== `task:${input.task.taskKey}`
      || snapshot.run.status !== 'completed' || snapshot.projection.state !== 'completed'
      || snapshot.run.terminalReceiptHash !== terminalReceiptHash
      || snapshot.projection.terminalReceiptHash !== terminalReceiptHash
      || terminalStep?.status !== 'succeeded' || terminalStep.attempt !== 1
      || terminalStep.candidateHash != null || terminalStep.outputHash !== candidateHash
      || !boundary || boundary.productBuildId !== input.build.id
      || boundary.buildNumber !== input.build.buildNumber
      || boundary.controlEpoch !== input.build.controlEpoch
      || boundary.planHash !== input.build.planHash || boundary.taskKey !== input.task.taskKey) {
      fail('carried producer synthetic Run/ledger/candidate/receipt 不闭合')
    }
    const root = await readClosedRootRun({
      scope: input.scope,
      build: input.build,
      taskParentRunId: snapshot.run.parentRunId,
      ledgerRootRunId: ledger.rootRunId,
    })
    const carriedLineageHash = await hashTextOpenWorldCreatorEditCarriedLineageV1({
      taskKey: input.task.taskKey,
      controlEpoch: input.build.controlEpoch,
      inputHash: input.inputHash,
      candidateHash,
      terminalReceiptHash,
      siblings: input.baseSiblings,
    })
    return {
      schema: 'storyforge.text-open-world-creator-edit-producer-evidence',
      version: 1,
      proofKind: 'carried-lineage',
      taskKey: input.task.taskKey,
      runId: input.producerRunId,
      rootRunId: root.run.id,
      attempt: 1,
      controlEpoch: input.build.controlEpoch,
      inputHash: input.inputHash,
      candidateHash,
      checkpointHash: null,
      terminalReceiptHash,
      rootTerminalReceiptHash: input.build.rootTerminalReceiptHash!,
      dependencies,
      carriedLineageHash,
    }
  }
  if (!checkpoint) fail('accepted producer Run 缺少已验证 task-candidate checkpoint')
  const snapshot = checkpoint.snapshot
  const boundary = snapshot.contract.scope.productProduction
  const candidate = objectRecord(checkpoint.resumePayload, 'producer checkpoint candidate')
  exactObjectKeys(candidate, [
    'schema', 'version', 'taskKey', 'attempt', 'controlEpoch', 'inputHash', 'candidateHash', 'result',
  ], 'producer checkpoint candidate')
  const result = objectRecord(candidate.result, 'producer checkpoint result')
  exactObjectKeys(result, ['artifacts', 'passedGateIds', 'usage'], 'producer checkpoint result')
  const attempt = Number(candidate.attempt)
  const controlEpoch = Number(candidate.controlEpoch)
  const candidateInputHash = candidate.inputHash
  const candidateHash = candidate.candidateHash
  const checkpointStep = checkpoint.projection.steps[input.task.taskKey]
  const terminalStep = snapshot.projection.steps[input.task.taskKey]
  if (candidate.schema !== 'storyforge.product-production-task-candidate'
    || candidate.version !== 1 || candidate.taskKey !== input.task.taskKey
    || !Number.isSafeInteger(attempt) || attempt < 1 || attempt > input.task.maxAttempts
    || controlEpoch !== input.build.controlEpoch
    || !isSha256Hash(candidateInputHash) || candidateInputHash !== input.inputHash
    || !isSha256Hash(candidateHash)
    || snapshot.run.id !== input.producerRunId
    || snapshot.run.projectId !== input.scope.projectId || snapshot.run.workId !== input.scope.workId
    || snapshot.run.productBuildId !== input.build.id
    || snapshot.run.parentRunId == null
    || snapshot.run.parentRelation !== `task:${input.task.taskKey}`
    || snapshot.run.status !== 'completed' || snapshot.projection.state !== 'completed'
    || snapshot.run.terminalReceiptHash !== input.producerReceiptHash
    || snapshot.projection.terminalReceiptHash !== input.producerReceiptHash
    || !boundary || boundary.productBuildId !== input.build.id
    || boundary.buildNumber !== input.build.buildNumber
    || boundary.controlEpoch !== input.build.controlEpoch
    || boundary.planHash !== input.build.planHash
    || boundary.taskKey !== input.task.taskKey
    || checkpointStep?.attempt !== attempt || checkpointStep.candidateHash !== candidateHash
    || terminalStep?.status !== 'succeeded' || terminalStep.attempt !== attempt
    || terminalStep.candidateHash !== candidateHash || terminalStep.outputHash !== candidateHash
    || ledger.entry.attempt !== attempt || ledger.entry.candidateHash !== candidateHash) {
    fail('producer checkpoint/Run/Build/task 身份不闭合')
  }
  exactSiblingCandidateArtifacts(result, input.baseSiblings)
  if (await hashProductProductionTaskCandidateV1(result) !== candidateHash) {
    fail('producer checkpoint candidateHash 不匹配')
  }
  if (!Array.isArray(result.passedGateIds)
    || result.passedGateIds.some(gate => typeof gate !== 'string')
    || !result.usage || typeof result.usage !== 'object'
    || canonicalProductProductionJsonV2(result.passedGateIds)
      !== canonicalProductProductionJsonV2(ledger.rawPassedGateIds)
    || canonicalProductProductionJsonV2(result.usage)
      !== canonicalProductProductionJsonV2(ledger.entry.usage)
    || await hashProductProductionTaskReceiptV1({
      taskKey: input.task.taskKey,
      attempt,
      inputHash: candidateInputHash,
      candidateHash,
      passedGateIds: result.passedGateIds as string[],
      usage: result.usage,
      controlEpoch,
    }) !== input.producerReceiptHash) {
    fail('producer task terminal receipt 无法由 checkpoint 重算')
  }
  const root = await readClosedRootRun({
    scope: input.scope,
    build: input.build,
    taskParentRunId: snapshot.run.parentRunId,
    ledgerRootRunId: ledger.rootRunId,
  })
  return {
    schema: 'storyforge.text-open-world-creator-edit-producer-evidence',
    version: 1,
    proofKind: 'accepted-checkpoint',
    taskKey: input.task.taskKey,
    runId: input.producerRunId,
    rootRunId: root.run.id,
    attempt,
    controlEpoch,
    inputHash: candidateInputHash,
    candidateHash,
    checkpointHash: checkpoint.checkpoint.checkpointHash,
    terminalReceiptHash: input.producerReceiptHash,
    rootTerminalReceiptHash: input.build.rootTerminalReceiptHash!,
    dependencies: [],
    carriedLineageHash: null,
  }
}

const DEFAULT_DEPENDENCIES_V1: TextOpenWorldCreatorEditContextDependenciesV1 = {
  readGovernance: readTextOpenWorldArtifactGovernanceV1,
  readBuild: async buildId => {
    const row = await db.productBuilds.get(buildId)
    return row?.id == null ? undefined : row as ProductBuildRecordV1 & { id: number }
  },
  readArtifacts: rowIds => db.productBuildArtifacts.bulkGet(rowIds),
  readProducerEvidence: defaultReadProducerEvidence,
  readTaskContext: defaultReadTaskContext,
  semanticResolver: DEFAULT_SEMANTIC_RESOLVER_V1,
}

/**
 * Reads one exact current Artifact target and its complete Plan-owned sibling
 * group. Raw payloads are used only by the domain resolver; the returned
 * registered source contains the resolver's allowlisted semantic values.
 */
export async function resolveTextOpenWorldCreatorEditWorkspaceV1(
  input: AssembleContextInput,
  overrides: Partial<TextOpenWorldCreatorEditContextDependenciesV1> = {},
): Promise<TextOpenWorldCreatorEditWorkspaceV1> {
  if (!input.scope) fail('缺少已解析 WorkspaceScope')
  const productionId = requiredPositiveInteger(input.productProductionId, 'productProductionId')
  const buildId = requiredPositiveInteger(input.productBuildId, 'productBuildId')
  const artifactKey = input.textOpenWorldCreatorEditArtifactKey
  if (!artifactKey || artifactKey !== artifactKey.trim()) {
    fail('缺少精确 textOpenWorldCreatorEditArtifactKey')
  }
  if (!Object.prototype.hasOwnProperty.call(input, 'textOpenWorldCreatorEditEntityIdentity')) {
    fail('必须显式提供 textOpenWorldCreatorEditEntityIdentity；Artifact 级目标使用 null')
  }
  const entityIdentity = input.textOpenWorldCreatorEditEntityIdentity
  if (entityIdentity !== null && (typeof entityIdentity !== 'string'
    || !entityIdentity.trim() || entityIdentity !== entityIdentity.trim())) {
    fail('textOpenWorldCreatorEditEntityIdentity 必须是非空 identity 或 null')
  }
  const expectedSnapshotHash = input.textOpenWorldCreatorEditExpectedSnapshotHash
  if (!isSha256Hash(expectedSnapshotHash)) fail('expectedSnapshotHash 不是 SHA-256')
  const dependencies = { ...DEFAULT_DEPENDENCIES_V1, ...overrides }
  const governanceInput = { scope: input.scope, productionId }
  const projection = await dependencies.readGovernance(governanceInput)
  if (projection.snapshotHash !== expectedSnapshotHash) {
    fail('目标浏览快照已变化，请刷新后重试')
  }
  if (projection.production.id !== productionId || projection.build.id !== buildId) {
    fail('目标 Production/Build 不是治理快照的当前 Build')
  }
  const build = await dependencies.readBuild(buildId)
  if (!build || build.productionId !== productionId
    || build.projectId !== input.scope.projectId || build.worldId !== input.scope.worldId
    || build.workId !== input.scope.workId
    || build.buildNumber !== projection.build.buildNumber
    || build.status !== projection.build.status
    || build.controlEpoch !== projection.build.controlEpoch
    || build.planHash !== projection.build.planHash
    || !isSha256Hash(build.manifestHash)
    || !isSha256Hash(build.rootTerminalReceiptHash)) {
    fail('当前 Build 记录、Manifest 或 root terminal receipt 不闭合')
  }
  const plan = parseProductProductionPlanV3(build.planJson, undefined, build.briefHash)
  if (canonicalProductProductionJsonV2(plan) !== build.planJson
    || await hashProductProductionValueV2(plan) !== build.planHash
    || plan.buildNumber !== build.buildNumber || plan.controlEpoch !== build.controlEpoch) {
    fail('当前 Build 的冻结 Plan JSON/hash/boundary 不闭合')
  }
  const owners = plan.tasks.filter(task => task.outputArtifactKeys.includes(artifactKey))
  if (owners.length !== 1) fail('目标 Artifact 没有冻结 Plan 的唯一 owner task')
  const ownerTask = owners[0]!
  if (!ownerTask.skillId || ownerTask.executionMode !== 'model'
    || ownerTask.outputArtifactKeys.length < 1
    || ownerTask.outputArtifactKeys.length
      > TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_LIMITS_V1.maximumSiblingArtifacts
    || ownerTask.outputArtifactKeys.some(key => !EDITABLE_KIND_SET.has(key))) {
    fail('owner task 不属于 Creator 可编辑的有界模型产物组')
  }
  const siblingViews = ownerTask.outputArtifactKeys.map(key =>
    exactGovernedSibling(projection, ownerTask, key))
  const targetView = siblingViews.find(view => view.artifactKey === artifactKey)!
  const targetEntities = entityIdentity === null ? [] : projection.entities.filter(entity => (
    entity.identity === entityIdentity && entity.artifactKey === artifactKey
    && entity.artifactVersion === targetView.version
    && entity.artifactContentHash === targetView.contentHash && entity.status === 'verified'
  ))
  if (entityIdentity !== null && targetEntities.length !== 1) {
    fail('目标 entityIdentity 不属于该 Artifact 的当前受治理内容')
  }
  const rawSiblings = await dependencies.readArtifacts(siblingViews.map(view => view.rowId))
  if (rawSiblings.length !== siblingViews.length) fail('owner sibling raw rows 不完整')
  rawSiblings.forEach((row, index) => assertRawSiblingMatchesView(row, siblingViews[index]!, {
    buildId,
    controlEpoch: build.controlEpoch,
  }))
  const siblings = rawSiblings as Array<ProductBuildArtifactRecordV1 & { id: number }>
  const siblingStatuses = new Set(siblings.map(row => row.status))
  const producerRunIds = new Set(siblings.map(row => row.producerRunId))
  const producerReceipts = new Set(siblings.map(row => row.producerReceiptHash))
  const producerInputs = new Set(siblings.map(row => row.inputHash))
  const validationReceipts = new Set(siblingViews.map(view => view.validationReceiptHash))
  if (siblingStatuses.size !== 1
    || ![...siblingStatuses].every(status => status === 'accepted' || status === 'carried-forward')
    || producerRunIds.size !== 1 || producerReceipts.size !== 1 || producerInputs.size !== 1
    || validationReceipts.size !== 1 || siblings[0]!.producerRunId == null
    || !isSha256Hash(siblings[0]!.producerReceiptHash)
    || !isSha256Hash(siblings[0]!.inputHash)
    || !isSha256Hash(siblingViews[0]!.validationReceiptHash)
    || siblingViews.some(view => view.producerRunState !== 'completed')) {
    fail('owner sibling group 的 producer/input/validation receipt 不一致')
  }
  const producerRunId = siblings[0]!.producerRunId!
  const producerReceiptHash = siblings[0]!.producerReceiptHash!
  const baseSiblingEvidence: TextOpenWorldCreatorEditBaseSiblingV1[] = siblings.map(row => ({
    artifactKey: row.artifactKey as TextOpenWorldCreatorEditBaseSiblingV1['artifactKey'],
    requirementKey: row.requirementKey,
    kind: row.kind as TextOpenWorldCreatorEditBaseSiblingV1['kind'],
    version: row.version,
    status: row.status as TextOpenWorldCreatorEditBaseSiblingV1['status'],
    inputHash: row.inputHash,
    contentHash: row.contentHash,
    producerRunId,
    producerReceiptHash,
    parentArtifactHash: row.parentArtifactHash,
    carriedFrom: row.carriedFrom == null ? null : {
      buildNumber: row.carriedFrom.buildNumber,
      artifactKey: row.carriedFrom.artifactKey as TextOpenWorldCreatorEditBaseSiblingV1['artifactKey'],
      version: row.carriedFrom.version,
      contentHash: row.carriedFrom.contentHash,
      proofHash: row.carriedFrom.proofHash,
    },
  }))
  if (baseSiblingEvidence.some(sibling => (
    sibling.status === 'accepted'
      ? sibling.parentArtifactHash !== null || sibling.carriedFrom !== null
      : sibling.parentArtifactHash !== sibling.contentHash || sibling.carriedFrom === null
        || sibling.carriedFrom.artifactKey !== sibling.artifactKey
        || sibling.carriedFrom.contentHash !== sibling.contentHash
        || sibling.carriedFrom.buildNumber > build.buildNumber
        || (sibling.carriedFrom.buildNumber === build.buildNumber
          && sibling.carriedFrom.version >= sibling.version)
        || !isSha256Hash(sibling.carriedFrom.proofHash)
  ))) {
    fail('owner sibling status/carried lineage 包络不闭合')
  }
  if (baseSiblingEvidence[0]!.status === 'carried-forward'
    && new Set(baseSiblingEvidence.map(sibling => sibling.carriedFrom!.buildNumber)).size !== 1) {
    fail('carried owner sibling group 来源 Build 不唯一')
  }
  const producerEvidence = await dependencies.readProducerEvidence({
    scope: input.scope,
    build,
    task: ownerTask,
    plan,
    baseSiblings: baseSiblingEvidence,
    producerRunId,
    producerReceiptHash,
    inputHash: siblings[0]!.inputHash,
  })
  if (producerEvidence.taskKey !== ownerTask.taskKey
    || producerEvidence.runId !== producerRunId
    || producerEvidence.controlEpoch !== build.controlEpoch
    || producerEvidence.inputHash !== siblings[0]!.inputHash
    || producerEvidence.terminalReceiptHash !== producerReceiptHash
    || producerEvidence.rootTerminalReceiptHash !== build.rootTerminalReceiptHash
    || !Number.isSafeInteger(producerEvidence.rootRunId) || producerEvidence.rootRunId < 1
    || !Number.isSafeInteger(producerEvidence.attempt) || producerEvidence.attempt < 1
    || !isSha256Hash(producerEvidence.candidateHash)) {
    fail('已验证 producer evidence 与 owner sibling/base Build 不闭合')
  }
  if (baseSiblingEvidence[0]!.status === 'accepted') {
    if (producerEvidence.proofKind !== 'accepted-checkpoint'
      || !isSha256Hash(producerEvidence.checkpointHash)
      || producerEvidence.carriedLineageHash !== null
      || producerEvidence.dependencies.length !== 0) {
      fail('accepted owner sibling 缺少 checkpoint producer evidence')
    }
  } else {
    const expectedDependencies = ownerTask.dependsOn
    if (producerEvidence.proofKind !== 'carried-lineage'
      || producerEvidence.attempt !== 1 || producerEvidence.checkpointHash !== null
      || !isSha256Hash(producerEvidence.carriedLineageHash)
      || producerEvidence.dependencies.length !== expectedDependencies.length
      || producerEvidence.dependencies.some((dependency, index) => (
        dependency.taskKey !== expectedDependencies[index] || !isSha256Hash(dependency.receiptHash)
      ))) {
      fail('carried owner sibling 缺少同序 ledger/lineage producer evidence')
    }
    const candidateHash = await hashProductProductionCarriedCandidateV1(baseSiblingEvidence)
    const terminalReceiptHash = await hashProductProductionCarriedReceiptV1({
      taskKey: ownerTask.taskKey,
      inputHash: siblings[0]!.inputHash,
      candidateHash,
      dependencies: producerEvidence.dependencies,
      passedGateIds: ownerTask.acceptanceGateIds,
      controlEpoch: build.controlEpoch,
    })
    const lineageHash = await hashTextOpenWorldCreatorEditCarriedLineageV1({
      taskKey: ownerTask.taskKey,
      controlEpoch: build.controlEpoch,
      inputHash: siblings[0]!.inputHash,
      candidateHash,
      terminalReceiptHash,
      siblings: baseSiblingEvidence,
    })
    if (producerEvidence.candidateHash !== candidateHash
      || producerEvidence.terminalReceiptHash !== terminalReceiptHash
      || producerEvidence.carriedLineageHash !== lineageHash) {
      fail('carried owner sibling synthetic candidate/receipt/lineage hash 不闭合')
    }
  }
  const taskContext = await dependencies.readTaskContext({ assembleInput: input, task: ownerTask })
  const baseArtifacts: TextOpenWorldCreatorEditWorkspaceBaseArtifactV1[] = siblings.map(row => ({
    rowId: row.id,
    artifactKey: row.artifactKey,
    requirementKey: row.requirementKey,
    kind: row.kind,
    version: row.version,
    status: row.status as 'accepted' | 'carried-forward',
    controlEpoch: row.controlEpoch,
    inputHash: row.inputHash,
    contentHash: row.contentHash,
    producerRunId: row.producerRunId!,
    producerReceiptHash: row.producerReceiptHash!,
    parentArtifactHash: row.parentArtifactHash,
    carriedFrom: row.carriedFrom == null ? null : structuredClone(row.carriedFrom) as TextOpenWorldCreatorEditBaseSiblingV1['carriedFrom'],
    payload: JSON.parse(row.payloadJson),
    metadata: JSON.parse(row.metadataJson),
    quality: JSON.parse(row.qualityJson),
    rights: JSON.parse(row.rightsJson),
  }))
  const semantic = await dependencies.semanticResolver.project({
    taskKey: ownerTask.taskKey,
    artifacts: baseArtifacts.map(row => ({ artifactKey: row.artifactKey, payload: row.payload })),
    context: taskContext,
    target: { artifactKey, entityIdentity },
  })
  if (semantic.taskKey !== ownerTask.taskKey
    || !sameOrderedStrings(semantic.outputArtifactKeys, ownerTask.outputArtifactKeys)
    || semantic.target.artifactKey !== artifactKey
    || semantic.target.entityIdentity !== entityIdentity
    || !isSha256Hash(semantic.draftHash) || !isSha256Hash(semantic.stableStructureHash)
    || await hashProductProductionValueV2(semantic.draft) !== semantic.draftHash
    || semantic.editableFields.length < 1
    || semantic.editableFields.length
      > TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_LIMITS_V1.maximumEditableFields) {
    fail('领域 semantic projection 与 owner sibling group 不闭合')
  }
  const editableFields = semantic.editableFields.map(parseTextOpenWorldCreatorEditFieldV1)
    .sort((left, right) => left.fieldId.localeCompare(right.fieldId))
  if (editableFields.some(field => field.artifactKey !== artifactKey
    || field.entityIdentity !== entityIdentity)
    || new Set(editableFields.map(field => field.fieldId)).size !== editableFields.length
    || new Set(editableFields.map(field => field.jsonPointer)).size !== editableFields.length) {
    fail('领域 semantic projection 含重复 fieldId/jsonPointer')
  }
  if (!editableFields.length) {
    fail(entityIdentity === null
      ? '该 Artifact 没有明确开放的 Artifact 级字段'
      : '该实体没有领域允许编辑的语义字段')
  }
  const semanticDraft: TextOpenWorldCreatorEditSemanticDraftV1 = {
    schema: 'storyforge.text-open-world-creator-edit-semantic-draft',
    version: 1,
    artifactKey,
    entityIdentity: entityIdentity ?? null,
    fields: [],
  }
  for (const field of editableFields) {
    const value = valueAtJsonPointer(semantic.draft, field.jsonPointer)
    if (await hashProductProductionValueV2(value) !== field.baseValueHash) {
      fail(`editable field baseValueHash 与 semantic draft 不一致:${field.fieldId}`)
    }
    semanticDraft.fields.push({
      fieldId: field.fieldId,
      label: field.label,
      valueKind: field.valueKind,
      value: JSON.parse(canonicalProductProductionJsonV2(value)),
    })
  }
  const target = parseTextOpenWorldCreatorEditTargetV1({
    schema: 'storyforge.text-open-world-creator-edit-target',
    version: 1,
    artifactKey,
    artifactVersion: targetView.version,
    artifactKind: targetView.kind,
    artifactContentHash: targetView.contentHash,
    entityIdentity: entityIdentity ?? null,
    ownerTaskKey: ownerTask.taskKey,
  })
  const siblingGroupBody: Omit<TextOpenWorldCreatorEditOwnerSiblingGroupV1, 'baseGroupHash'> = {
    schema: 'storyforge.text-open-world-creator-edit-owner-sibling-group',
    version: 1,
    ownerTaskKey: ownerTask.taskKey,
    skillId: ownerTask.skillId,
    dependencyTaskKeys: [...ownerTask.dependsOn],
    outputArtifactKeys: ownerTask.outputArtifactKeys as TextOpenWorldCreatorEditOwnerSiblingGroupV1['outputArtifactKeys'],
    acceptanceGateIds: [...ownerTask.acceptanceGateIds],
    baseSiblings: baseSiblingEvidence,
  }
  const ownerSiblingGroup: TextOpenWorldCreatorEditOwnerSiblingGroupV1 = {
    ...siblingGroupBody,
    baseGroupHash: await hashTextOpenWorldCreatorEditOwnerSiblingGroupV1(siblingGroupBody),
  }
  const context: TextOpenWorldCreatorEditTargetContextV1 = {
    schema: 'storyforge.text-open-world-creator-edit-target-context',
    version: 1,
    governanceSnapshotHash: projection.snapshotHash,
    production: structuredClone(projection.production),
    build: {
      ...structuredClone(projection.build),
      stateRevision: build.stateRevision,
      manifestHash: build.manifestHash,
      rootTerminalReceiptHash: build.rootTerminalReceiptHash,
    },
    target,
    ownerSiblingGroup,
    producerEvidence,
    productionValidationReceiptHash: siblingViews[0]!.validationReceiptHash!,
    baseDraftHash: semantic.draftHash,
    stableStructureHash: semantic.stableStructureHash,
    semanticDraft,
    semanticDraftHash: await hashProductProductionValueV2(semanticDraft),
    editableFields,
  }
  // The governance reader's own read-set CAS protects each read. This second
  // full read closes the interval containing raw-row, task-context and domain
  // projection work, so the emitted context never mixes two Build snapshots.
  const finalProjection = await dependencies.readGovernance(governanceInput)
  if (finalProjection.snapshotHash !== expectedSnapshotHash
    || finalProjection.snapshotHash !== projection.snapshotHash) {
    fail('Creator edit context 装配期间治理快照发生变化')
  }
  return {
    targetContext: context,
    fullDraft: structuredClone(semantic.draft),
    stableStructureHash: semantic.stableStructureHash,
    taskContext,
    baseArtifacts,
  }
}

export async function resolveTextOpenWorldCreatorEditTargetContextV1(
  input: AssembleContextInput,
  overrides: Partial<TextOpenWorldCreatorEditContextDependenciesV1> = {},
): Promise<TextOpenWorldCreatorEditTargetContextV1> {
  return (await resolveTextOpenWorldCreatorEditWorkspaceV1(input, overrides)).targetContext
}

export async function readTextOpenWorldCreatorEditTargetContextV1(
  input: AssembleContextInput,
): Promise<string> {
  return canonicalProductProductionJsonV2(await resolveTextOpenWorldCreatorEditTargetContextV1(input))
}
