import { db } from '../db/schema'
import type { TtrpgProductionBriefV2, WorkspaceScope } from '../types'
import type { AssembleContextInput, ContextSourceTransformer } from '../registry/types'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { assertRecordInScope } from '../workspace/scope'
import { readAgentRunV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'

export class ProductProductionContextBudgetErrorV1 extends Error {}
export class ProductProductionRecoveryDirectiveErrorV1 extends Error {}

type ProductProductionRecoveryActionV1 = 'retry' | 'author-edit' | 'change-capability'

export interface ValidatedProductProductionRecoveryDirectiveV1 {
  resolvedDirective: boolean
  resolution: Record<string, unknown> | null
  previousFailure: Record<string, unknown> | null
  snapshot: AgentRunSnapshotV1 | null
  failedAttempt: number | null
}

/** Structured production contracts must remain exact JSON, including secrets
 * and late fields. Their registered cap is soft; the task budget is hard. */
export const preserveProductProductionContextV1: ContextSourceTransformer = async input => {
  if (!input.source.key.startsWith('product-production.')) return undefined
  if (input.originalTokens > input.inputBudgetTokens) {
    throw new ProductProductionContextBudgetErrorV1(`[product-production-context] ${input.source.label} 需要 ${input.originalTokens} tokens，超过本任务输入预算 ${input.inputBudgetTokens}；未调用模型，请缩小制作范围。`)
  }
  return {
    content: input.content, delivery: 'full', allowSourceBudgetOverflow: true,
    compression: {
      version: 1, promptVersion: 'agent-context-compression-v1', outcome: 'fallback',
      fallback: 'full-source', sourceHash: await sha256Text(input.content), attempts: 0,
      targetTokens: input.sourceBudgetTokens, requiredAnchorCount: 1, coveredAnchorCount: 0,
      failureCode: 'structured-production-contract-requires-exact-json',
    },
  }
}

function requiredScope(input: AssembleContextInput): WorkspaceScope {
  if (!input.scope) throw new Error('[product-production-context] 缺少已解析 WorkspaceScope')
  return input.scope
}

function requiredId(value: number | undefined, label: string): number {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) throw new Error(`[product-production-context] 缺少 ${label}`)
  return value!
}

async function productionAndBuild(input: AssembleContextInput) {
  const scope = requiredScope(input)
  const productionId = requiredId(input.productProductionId, 'productProductionId')
  const production = await db.productProductions.get(productionId)
  if (!production || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })) {
    throw new Error('[product-production-context] Production 不存在或跨 Work')
  }
  const buildId = input.productBuildId
  const build = buildId == null ? null : await db.productBuilds.get(buildId)
  if (build && (build.productionId !== productionId
    || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' }))) {
    throw new Error('[product-production-context] Build 不属于当前 Production/Work')
  }
  return { scope, production, build }
}

/**
 * Validate one recovery directive against the exact failed task Run. Callers
 * use `blocked` before accepting a command and `resolved` immediately before
 * execution, so a persisted directive cannot bypass either boundary.
 *
 * Legacy failures without provenance may retain ordinary retry compatibility,
 * but can never authorize a complete author JSON or a capability change.
 */
export async function validateProductProductionRecoveryDirectiveV1(input: {
  scope: WorkspaceScope
  productProductionId: number
  productBuildId: number
  productProductionTaskKey: string
  expectedState: 'blocked' | 'resolved' | 'either'
  requestedAction?: ProductProductionRecoveryActionV1
  allowLegacyRetry?: boolean
}): Promise<ValidatedProductProductionRecoveryDirectiveV1> {
  const { scope, build } = await productionAndBuild({
    projectId: input.scope.projectId,
    scope: input.scope,
    productProductionId: input.productProductionId,
    productBuildId: input.productBuildId,
  })
  if (!build) throw new ProductProductionRecoveryDirectiveErrorV1('[product-production-context] 修复指令需要 Build')
  let failureState: Record<string, unknown>
  try {
    const parsed = JSON.parse(build.failureJson)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
    failureState = parsed as Record<string, unknown>
  } catch {
    throw new ProductProductionRecoveryDirectiveErrorV1('[product-production-context] 修复指令不是合法对象')
  }
  const resolvedDirective = typeof failureState.blockerKey === 'string'
  if ((input.expectedState === 'blocked' && resolvedDirective)
    || (input.expectedState === 'resolved' && !resolvedDirective)) {
    throw new ProductProductionRecoveryDirectiveErrorV1('[product-production-context] 修复指令状态与执行阶段不一致')
  }
  const failureTaskKey = resolvedDirective ? failureState.blockerKey : failureState.taskKey
  if (failureTaskKey !== input.productProductionTaskKey) {
    throw new ProductProductionRecoveryDirectiveErrorV1('[product-production-context] 修复指令与当前 task 不一致')
  }
  const resolution = failureState.resolution && typeof failureState.resolution === 'object'
    && !Array.isArray(failureState.resolution)
    ? failureState.resolution as Record<string, unknown>
    : null
  const resolvedAction = resolvedDirective && typeof resolution?.action === 'string'
    && ['retry', 'author-edit', 'change-capability'].includes(resolution.action)
    ? resolution.action as ProductProductionRecoveryActionV1
    : null
  if (resolvedDirective && resolvedAction == null) {
    throw new ProductProductionRecoveryDirectiveErrorV1('[product-production-context] 已解决 blocker 缺少合法恢复动作')
  }
  const action = resolvedDirective ? resolvedAction : input.requestedAction ?? null
  const previousFailureValue = resolvedDirective ? failureState.previousFailure : failureState
  const previousFailure = previousFailureValue && typeof previousFailureValue === 'object'
    && !Array.isArray(previousFailureValue)
    ? previousFailureValue as Record<string, unknown>
    : null
  const provenance = previousFailure?.failureProvenance
    && typeof previousFailure.failureProvenance === 'object'
    && !Array.isArray(previousFailure.failureProvenance)
    ? previousFailure.failureProvenance as Record<string, unknown>
    : null
  if (!provenance) {
    const legacyInspection = input.expectedState === 'either' && !resolvedDirective && action == null
    if (legacyInspection || (input.allowLegacyRetry === true && action === 'retry')) {
      return {
        resolvedDirective,
        resolution,
        previousFailure,
        snapshot: null,
        failedAttempt: null,
      }
    }
    throw new ProductProductionRecoveryDirectiveErrorV1('[product-production-context] 修复来源缺少可验证 failureProvenance')
  }
  const runId = provenance.runId
  const rootRunId = provenance.rootRunId
  const failedControlEpoch = provenance.controlEpoch
  const failedPlanHash = provenance.planHash
  const failedAttempt = provenance.attempt
  if (previousFailure?.taskKey !== input.productProductionTaskKey
    || typeof runId !== 'number' || !Number.isInteger(runId) || runId < 1
    || typeof rootRunId !== 'number' || !Number.isInteger(rootRunId) || rootRunId < 1
    || typeof failedControlEpoch !== 'number' || !Number.isInteger(failedControlEpoch) || failedControlEpoch < 0
    || typeof failedPlanHash !== 'string' || !/^[a-f0-9]{64}$/.test(failedPlanHash)
    || typeof failedAttempt !== 'number' || !Number.isInteger(failedAttempt) || failedAttempt < 1
    || (resolvedDirective
      ? failedControlEpoch + 1 !== build.controlEpoch
      : failedControlEpoch !== build.controlEpoch)) {
    throw new ProductProductionRecoveryDirectiveErrorV1('[product-production-context] 修复来源谱系无效')
  }
  const run = await db.agentRuns.get(runId)
  if (!run || run.productBuildId !== build.id || run.status !== 'failed'
    || run.parentRunId !== rootRunId
    || run.parentRelation !== `task:${input.productProductionTaskKey}`) {
    throw new ProductProductionRecoveryDirectiveErrorV1('[product-production-context] 修复来源 Run 不存在或越过 Build/task')
  }
  const snapshot = await readAgentRunV1(scope, runId)
  const boundary = snapshot.contract.scope.productProduction
  const failedStep = snapshot.projection.steps[input.productProductionTaskKey]
  if (!boundary || boundary.productBuildId !== build.id
    || boundary.controlEpoch !== failedControlEpoch
    || boundary.planHash !== failedPlanHash
    || boundary.taskKey !== input.productProductionTaskKey
    || snapshot.run.parentRunId !== rootRunId
    || failedStep?.status !== 'failed'
    || failedStep.attempt !== failedAttempt) {
    throw new ProductProductionRecoveryDirectiveErrorV1('[product-production-context] 修复草稿与失败 Run/epoch/attempt 不一致')
  }
  return {
    resolvedDirective,
    resolution,
    previousFailure,
    snapshot,
    failedAttempt,
  }
}

export async function readProductProductionBriefContext(input: AssembleContextInput): Promise<string> {
  const { production, scope } = await productionAndBuild(input)
  if (production.currentBriefRevision == null) throw new Error('[product-production-context] Production 尚无当前 Brief')
  const brief = await db.productProductionBriefs
    .where('[productionId+revision]').equals([production.id!, production.currentBriefRevision]).first()
  if (!brief || brief.status !== 'authorized') throw new Error('[product-production-context] 当前 Brief 未授权')
  const content = JSON.parse(brief.briefJson)
  const ttrpgRules = content.intent?.productType === 'ttrpg' && content.ttrpg
    ? await (await import('../ttrpg/production-brief')).resolveTtrpgProductionRulePackV2({ scope, brief: content.ttrpg as TtrpgProductionBriefV2 })
    : null
  return JSON.stringify({
    ...(ttrpgRules ? { ttrpgRules: { contentHash: content.ttrpg.rules.effectiveContentHash,
      attributes: ttrpgRules.attributes, actions: ttrpgRules.actions.map(action => ({ key: action.key, name: action.name, description: action.description, target: action.target })) } } : {}),
    schema: 'storyforge.product-production.brief-context', version: 1,
    productionKey: production.productionKey, briefRevision: brief.revision, briefHash: brief.briefHash,
    sourceWorldContentHash: brief.sourceWorldContentHash, userIntentSummary: brief.userIntentSummary,
    estimate: JSON.parse(brief.estimateJson), brief: JSON.parse(brief.briefJson),
  })
}

export async function readProductProductionArtifactInputs(input: AssembleContextInput): Promise<string> {
  const { build } = await productionAndBuild(input)
  if (!build) throw new Error('[product-production-context] artifact inputs 需要 productBuildId')
  const requested = new Set(input.productArtifactKeys ?? [])
  if (requested.size === 0) throw new Error('[product-production-context] artifact inputs 必须显式选择 artifact keys')
  const artifacts = (await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray())
    .filter(row => requested.has(row.artifactKey) && (row.status === 'accepted' || row.status === 'carried-forward'))
    .map(row => ({
      artifactKey: row.artifactKey, version: row.version, kind: row.kind, contentHash: row.contentHash,
      producerReceiptHash: row.producerReceiptHash, payload: JSON.parse(row.payloadJson),
      metadata: JSON.parse(row.metadataJson),
    }))
  if (artifacts.length !== requested.size) throw new Error('[product-production-context] 选择的 Artifact 缺失或未验收')
  return JSON.stringify({ schema: 'storyforge.product-production.artifact-inputs', version: 1, buildNumber: build.buildNumber, artifacts })
}

export async function readProductProductionQualityFeedback(input: AssembleContextInput): Promise<string> {
  const { build } = await productionAndBuild(input)
  if (!build) throw new Error('[product-production-context] quality feedback 需要 productBuildId')
  const requested = new Set(input.productArtifactKeys ?? [])
  const artifacts = requested.size === 0 ? [] : (await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray())
    .filter(row => requested.has(row.artifactKey))
    .map(row => ({ artifactKey: row.artifactKey, contentHash: row.contentHash, quality: JSON.parse(row.qualityJson) }))
  return JSON.stringify({
    schema: 'storyforge.product-production.quality-feedback', version: 1,
    buildNumber: build.buildNumber, qualityReportHash: build.qualityReportHash,
    qualityReport: JSON.parse(build.qualityReportJson), artifacts,
  })
}

/** Last rejected draft for this exact Build/task, never another product or a live world read. */
export async function readProductProductionRepairFeedback(input: AssembleContextInput): Promise<string> {
  const { scope, build } = await productionAndBuild(input)
  if (!build || !input.productProductionTaskKey) throw new Error('[product-production-context] 修复反馈需要 Build 与 task key')
  const validated = await validateProductProductionRecoveryDirectiveV1({
    scope,
    productProductionId: requiredId(input.productProductionId, 'productProductionId'),
    productBuildId: build.id!,
    productProductionTaskKey: input.productProductionTaskKey,
    expectedState: 'either',
    allowLegacyRetry: true,
  })
  const resolution = validated.resolution
  const authorRepairNote = typeof resolution?.note === 'string' ? resolution.note : null
  const authorDraftJson = resolution?.action === 'author-edit' && typeof resolution.authorDraftJson === 'string' ? resolution.authorDraftJson : null
  const empty = () => JSON.stringify({
    schema: 'storyforge.product-production.repair-feedback', version: 1,
    authorRepairNote, authorDraftJson, previous: null,
  })
  // Historical blockers created before provenance existed may still carry an
  // author note, but must never guess a prior Run by updatedAt.
  if (!validated.snapshot || validated.failedAttempt == null) return empty()
  const snapshot = validated.snapshot
  const boundary = snapshot.contract.scope.productProduction!
  const failedAttempt = validated.failedAttempt
  const events = snapshot.events.filter(event => event.type === 'evidence.artifact.recorded'
    && event.payload.stepId === input.productProductionTaskKey
    && event.payload.attempt === failedAttempt
    // source-snapshot includes the exact repair packet delivered to this Run.
    // Feeding it back would recursively nest feedback on every author retry.
    && ['raw-response', 'tool-result'].includes(event.payload.artifactKind))
  const evidence = []
  for (const event of events) {
    if (event.type !== 'evidence.artifact.recorded') continue
    evidence.push({ kind: event.payload.artifactKind, contentHash: event.payload.contentHash,
      content: await readAgentRunArtifactExactV1({ projectId: scope.projectId,
        artifactKind: event.payload.artifactKind, contentHash: event.payload.contentHash }) })
  }
  return JSON.stringify({ schema: 'storyforge.product-production.repair-feedback', version: 1,
    taskKey: input.productProductionTaskKey, authorRepairNote, authorDraftJson, previous: { runId: snapshot.run.id,
      contractHash: snapshot.run.contractHash, controlEpoch: boundary.controlEpoch, attempt: failedAttempt, evidence } })
}

export async function readProductProductionEvolutionBase(input: AssembleContextInput): Promise<string> {
  const { production, build } = await productionAndBuild(input)
  if (!build) throw new Error('[product-production-context] evolution base 需要 productBuildId')
  if (!['preview-ready', 'release-ready', 'released'].includes(build.status)) {
    throw new Error('[product-production-context] evolution base 必须是冻结可玩 Build')
  }
  return JSON.stringify({
    schema: 'storyforge.product-production.evolution-base', version: 1,
    productionKey: production.productionKey, buildNumber: build.buildNumber,
    manifestHash: build.manifestHash, packageHash: build.packageHash, previewHash: build.previewHash,
    manifest: JSON.parse(build.manifestJson), compatibility: JSON.parse(build.compatibilityJson),
  })
}
