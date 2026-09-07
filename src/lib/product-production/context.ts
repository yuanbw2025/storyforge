import { db } from '../db/schema'
import type { TtrpgProductionBriefV2, WorkspaceScope } from '../types'
import type { AssembleContextInput, ContextSourceTransformer } from '../registry/types'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { assertRecordInScope } from '../workspace/scope'
import { readAgentRunV1 } from '../agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'

export class ProductProductionContextBudgetErrorV1 extends Error {}

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
  const resolution = JSON.parse(build.failureJson).resolution
  const authorRepairNote = typeof resolution?.note === 'string' ? resolution.note : null
  const authorDraftJson = resolution?.action === 'author-edit' && typeof resolution.authorDraftJson === 'string' ? resolution.authorDraftJson : null
  const runs = (await db.agentRuns.where('productBuildId').equals(build.id!).toArray())
    .filter(run => run.status === 'failed' && run.parentRelation === `task:${input.productProductionTaskKey}`)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  if (!runs.length) return JSON.stringify({ schema: 'storyforge.product-production.repair-feedback', version: 1, authorRepairNote, authorDraftJson, previous: null })
  const snapshot = await readAgentRunV1(scope, runs[0].id!)
  const boundary = snapshot.contract.scope.productProduction
  if (!boundary || boundary.productBuildId !== build.id || boundary.taskKey !== input.productProductionTaskKey)
    throw new Error('[product-production-context] 修复草稿与 Build/task 不一致')
  const events = snapshot.events.filter(event => event.type === 'evidence.artifact.recorded'
    && event.payload.stepId === input.productProductionTaskKey
    && ['raw-response', 'tool-result'].includes(event.payload.artifactKind))
  const latestAttempt = Math.max(0, ...events.map(event => event.type === 'evidence.artifact.recorded' ? event.payload.attempt ?? 0 : 0))
  const evidence = []
  for (const event of events) {
    if (event.type !== 'evidence.artifact.recorded' || event.payload.attempt !== latestAttempt) continue
    evidence.push({ kind: event.payload.artifactKind, contentHash: event.payload.contentHash,
      content: await readAgentRunArtifactExactV1({ projectId: scope.projectId,
        artifactKind: event.payload.artifactKind, contentHash: event.payload.contentHash }) })
  }
  return JSON.stringify({ schema: 'storyforge.product-production.repair-feedback', version: 1,
    taskKey: input.productProductionTaskKey, authorRepairNote, authorDraftJson, previous: { runId: snapshot.run.id,
      contractHash: snapshot.run.contractHash, controlEpoch: boundary.controlEpoch, attempt: latestAttempt, evidence } })
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
