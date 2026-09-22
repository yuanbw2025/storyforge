import { db } from '../db/schema'
import { resolveRequestConfig } from '../ai/client'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../ai/config-readiness'
import { useAIConfigStore } from '../../stores/ai-config'
import type {
  ProductBuildArtifactRecordV1,
  ProductBuildCompatibilityReportV1,
  ProductBuildQualityReportV1,
  ProductBuildRecordV1,
  ProductProductionBriefRecordV1,
  ProductProductionCommandRecordV1,
  ProductProductionRecordV1,
  ProductQualityGateReceiptRecordV1,
  ProductQualityGateReceiptStatusV1,
  ProductRuntimeEvent,
  ProductRuntimePackageV1,
  ProductRuntimeSession,
  TextOpenWorldContentBudgetV1,
  TextOpenWorldMainlineThreadV1,
  TextOpenWorldRegionNarrativePacksV1,
  TextOpenWorldSceneScriptsV1,
  TextOpenWorldSemanticReviewV1,
  TextOpenWorldSignificantThreadsV1,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope, resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import { readAcceptedBuildArtifacts } from '../product-production/artifact-store'
import { readInstanceAgentRunV1 } from '../agent/run/event-store'
import { parseProductBuildQualityReportV1 } from '../product-production/adoption'
import { createProductBuildCompatibilityReportV1 } from '../product-production/compatibility'
import { parseProductRuntimePackageV1 } from '../product-production/runtime-package'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
  isSha256Hash,
} from '../product-production/hash'
import {
  parseProductQualityGateReceiptV1,
  type ProductQualityGateReceiptV1,
} from '../product-production/quality-receipts'
import {
  readProductRuntimeState,
  readProductRuntimeStateVersion,
  verifyProductRuntimeCheckpoint,
} from './runtime-api'
import {
  inspectTextOpenWorldCheckpointV1,
  inspectTextOpenWorldRuntimeHeadV1,
} from './checkpoints'
import { readTextOpenWorldArtifactGovernanceV1 } from './creator-artifact-governance'
import { readTextOpenWorldCreatorDerivedBuildAuthorityV1 } from './creator-derived-authority'
import { projectProductProductionSchedulerV1 } from '../product-production/scheduler'
import {
  buildTextOpenWorldCreatorCalibrationContextV1,
  projectTextOpenWorldContentDurationV1,
  projectTextOpenWorldTemplateDifferentiationV1,
  runTextOpenWorldCreatorIndependentCalibrationReviewV1,
  TEXT_OPEN_WORLD_CREATOR_CALIBRATION_CATEGORY_V1,
  type TextOpenWorldCreatorCalibrationReviewContextV1,
} from './creator-quality-calibration'
import {
  TEXT_OPEN_WORLD_CREATOR_CALIBRATION_GATE_ID_V1,
  TEXT_OPEN_WORLD_CREATOR_GRAYBOX_COVERAGE_KEYS_V1,
  TEXT_OPEN_WORLD_CREATOR_GRAYBOX_GATE_ID_V1,
  TEXT_OPEN_WORLD_CREATOR_FULL_PLAYTEST_GATE_ID_V1,
  TEXT_OPEN_WORLD_CREATOR_HARD_GATE_ID_V1,
  TEXT_OPEN_WORLD_CREATOR_ISSUE_CATEGORIES_V1,
  TEXT_OPEN_WORLD_CREATOR_ISSUE_GATE_PREFIX_V1,
  TEXT_OPEN_WORLD_CREATOR_ISSUE_WAIVER_GATE_PREFIX_V1,
  TEXT_OPEN_WORLD_CREATOR_RELEASE_QUALITY_GATE_ID_V1,
  TEXT_OPEN_WORLD_CREATOR_SEMANTIC_GATE_ID_V1,
  TEXT_OPEN_WORLD_CREATOR_UPDATE_VERIFICATION_GATE_ID_V1,
  parseTextOpenWorldCreatorCalibrationEvidenceV1,
  parseTextOpenWorldCreatorGrayboxEvidenceV1,
  parseTextOpenWorldCreatorFullPlaytestEvidenceV1,
  parseTextOpenWorldCreatorHardGateEvidenceV1,
  parseTextOpenWorldCreatorIssueEvidenceV1,
  parseTextOpenWorldCreatorIssueWaiverEvidenceV1,
  parseTextOpenWorldCreatorReleaseQualityEvidenceV1,
  parseTextOpenWorldCreatorSemanticDecisionEvidenceV1,
  parseTextOpenWorldCreatorUpdateVerificationEvidenceV1,
  type TextOpenWorldCreatorBuildBindingV1,
  type TextOpenWorldCreatorCalibrationEvidenceV1,
  type TextOpenWorldCreatorCalibrationReadinessV1,
  type TextOpenWorldCreatorGrayboxEnvironmentV1,
  type TextOpenWorldCreatorGrayboxEvidenceV1,
  type TextOpenWorldCreatorGrayboxHumanChecksV1,
  type TextOpenWorldCreatorGrayboxSessionEvidenceV1,
  type TextOpenWorldCreatorFullPlaytestAssessmentV1,
  type TextOpenWorldCreatorFullPlaytestEvidenceV1,
  type TextOpenWorldCreatorFullPlaytestHumanChecksV1,
  type TextOpenWorldCreatorFullPlaytestRuntimeAIEvidenceV1,
  type TextOpenWorldCreatorHardGateCheckV1,
  type TextOpenWorldCreatorHardGateEvidenceV1,
  type TextOpenWorldCreatorHumanQualityChecksV1,
  type TextOpenWorldCreatorIssueCategoryV1,
  type TextOpenWorldCreatorIssueEvidenceV1,
  type TextOpenWorldCreatorIssueRuntimeWitnessV1,
  type TextOpenWorldCreatorIssueSeverityV1,
  type TextOpenWorldCreatorIssueWaiverEvidenceV1,
  type TextOpenWorldCreatorQualityReceiptV1,
  type TextOpenWorldCreatorReleaseQualityEvidenceV1,
  type TextOpenWorldCreatorReviewFindingV1,
  type TextOpenWorldCreatorReviewSummaryV1,
  type TextOpenWorldCreatorSemanticDecisionEvidenceV1,
  type TextOpenWorldCreatorSemanticWaiverV1,
  type TextOpenWorldCreatorUpdateIssueResolutionV1,
  type TextOpenWorldCreatorUpdateLowScoreResolutionV1,
  type TextOpenWorldCreatorUpdateVerificationEvidenceV1,
  type TextOpenWorldCreatorUpdateVerificationHumanChecksV1,
} from './creator-quality-contract'
import { parseTextOpenWorldCreatorRepairAuthorizationV1 } from './creator-artifact-repair-contract'
import { verifyOwnedTextOpenWorldPlayerReleaseV1 } from './player-version-compatibility'
import {
  replayTextOpenWorldMigrationSourceStateHashV1,
  verifyTextOpenWorldSaveMigrationBranchV1,
} from './player-save-migration-contract'
import { readVerifiedProductRuntimeHeadV1 } from '../product/runtime-core'

const HARD_GATE_POLICY_ID = 'storyforge.text-open-world-creator-hard-gates.v1'
const SEMANTIC_POLICY_ID = 'storyforge.text-open-world-creator-semantic-release.v1'
const GRAYBOX_POLICY_ID = 'storyforge.text-open-world-creator-graybox.v1'
const FULL_PLAYTEST_POLICY_ID = 'storyforge.text-open-world-creator-full-playtest.v1'
const CALIBRATION_POLICY_ID = 'storyforge.text-open-world-creator-release-calibration.v1'
const ISSUE_POLICY_ID = 'storyforge.text-open-world-creator-issue.v1'
const ISSUE_WAIVER_POLICY_ID = 'storyforge.text-open-world-creator-issue-waiver.v1'
const RELEASE_QUALITY_POLICY_ID = 'storyforge.text-open-world-creator-release-quality.v1'
const UPDATE_VERIFICATION_POLICY_ID = 'storyforge.text-open-world-creator-update-verification.v1'
const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

interface BuildAuthorityV1 {
  scope: WorkspaceScope
  production: ProductProductionRecordV1 & { id: number }
  build: ProductBuildRecordV1 & { id: number }
  briefRow: ProductProductionBriefRecordV1 & { id: number }
  artifacts: ProductBuildArtifactRecordV1[]
  quality: ProductBuildQualityReportV1
  buildBinding: TextOpenWorldCreatorBuildBindingV1
  governanceSnapshotHash: string
  hardChecks: TextOpenWorldCreatorHardGateCheckV1[]
  reviews: TextOpenWorldCreatorReviewSummaryV1[]
  derivedCommandChain: Array<ProductProductionCommandRecordV1 & { id: number }>
  authorityRowsJson: {
    production: string
    build: string
    brief: string
    artifacts: string
  }
}

type ReceiptAuthorityV1 = Pick<BuildAuthorityV1, 'scope' | 'build' | 'buildBinding'>

interface VerifiedReceiptV1<T> extends TextOpenWorldCreatorQualityReceiptV1<T> {
  row: ProductQualityGateReceiptRecordV1 & { id: number }
  gateReceipt: ProductQualityGateReceiptV1
}

export interface TextOpenWorldCreatorGrayboxCandidateV1 {
  sessionId: number
  title: string
  createdAt: number
  updatedAt: number
  completed: boolean
  endingKey: string | null
  coverageKeys: TextOpenWorldCreatorGrayboxSessionEvidenceV1['coverageKeys']
  missingCoverageKeys: TextOpenWorldCreatorGrayboxSessionEvidenceV1['coverageKeys']
  eventCount: number
  checkpointCount: number
  source: 'build-preview' | 'product-release'
  witness: TextOpenWorldCreatorGrayboxSessionEvidenceV1
}

export interface TextOpenWorldCreatorUpdateVerificationReadinessV1 {
  required: boolean
  ready: boolean
  issue: string | null
  sourceReleaseVersion: number | null
  targetReleaseVersion: number | null
  compatibility: TextOpenWorldCreatorUpdateVerificationEvidenceV1['compatibility'] | null
  sourceIssues: Array<Pick<TextOpenWorldCreatorUpdateIssueResolutionV1,
    'sourceIssueReceiptHash' | 'issueKey' | 'category' | 'severity' | 'affectedStableKeys'>>
  sourceLowScores: Array<Pick<TextOpenWorldCreatorUpdateLowScoreResolutionV1,
    'criterionKey' | 'sourceRating' | 'targetRating'>>
  sourceSessionCandidates: Array<{ sessionId: number; title: string; status: ProductRuntimeSession['status'] }>
  migratedSessionCandidates: Array<{ sessionId: number; title: string; parentSessionId: number }>
  targetRouteWitnessKeys: string[]
}

export interface TextOpenWorldCreatorIssueRecordV1 {
  receipt: TextOpenWorldCreatorQualityReceiptV1<TextOpenWorldCreatorIssueEvidenceV1>
  waiver: TextOpenWorldCreatorQualityReceiptV1<TextOpenWorldCreatorIssueWaiverEvidenceV1> | null
  blocksRelease: boolean
  portableJson: string
}

export interface TextOpenWorldCreatorQualityWorkspaceV1 {
  schema: 'storyforge.text-open-world-creator-quality-workspace'
  version: 1
  productionId: number
  buildId: number
  build: TextOpenWorldCreatorBuildBindingV1
  buildStatus: ProductBuildRecordV1['status']
  governanceSnapshotHash: string
  hardChecks: TextOpenWorldCreatorHardGateCheckV1[]
  hardGatesPassed: boolean
  reviews: TextOpenWorldCreatorReviewSummaryV1[]
  modelFindings: TextOpenWorldCreatorReviewFindingV1[]
  calibrationReadiness: TextOpenWorldCreatorCalibrationReadinessV1
  calibrationReceipt: TextOpenWorldCreatorQualityReceiptV1<TextOpenWorldCreatorCalibrationEvidenceV1> | null
  grayboxCandidates: TextOpenWorldCreatorGrayboxCandidateV1[]
  grayboxReceipt: TextOpenWorldCreatorQualityReceiptV1<TextOpenWorldCreatorGrayboxEvidenceV1> | null
  fullPlaytestReceipt: TextOpenWorldCreatorQualityReceiptV1<TextOpenWorldCreatorFullPlaytestEvidenceV1> | null
  updateVerificationReadiness: TextOpenWorldCreatorUpdateVerificationReadinessV1
  updateVerificationReceipt: TextOpenWorldCreatorQualityReceiptV1<TextOpenWorldCreatorUpdateVerificationEvidenceV1> | null
  issues: TextOpenWorldCreatorIssueRecordV1[]
  semanticDecisionReceipt: TextOpenWorldCreatorQualityReceiptV1<TextOpenWorldCreatorSemanticDecisionEvidenceV1> | null
  releaseQualityReceipt: TextOpenWorldCreatorQualityReceiptV1<TextOpenWorldCreatorReleaseQualityEvidenceV1> | null
  releaseQualityReady: boolean
  blockers: string[]
}

function fail(message: string): never {
  throw new Error(`[text-open-world-creator-quality] ${message}`)
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function boundedText(value: unknown, label: string, maximum: number, minimum = 1): string {
  if (typeof value !== 'string') fail(`${label} 必须是文本`)
  const normalized = value.trim().normalize('NFC')
  if (normalized.length < minimum || normalized.length > maximum) fail(`${label} 长度无效`)
  return normalized
}

function boundedLines(value: unknown, label: string, maximumItems: number, maximumLength: number, minimumItems = 0): string[] {
  if (!Array.isArray(value) || value.length < minimumItems || value.length > maximumItems) fail(`${label} 数量无效`)
  const rows = value.map((item, index) => boundedText(item, `${label}[${index}]`, maximumLength))
  if (new Set(rows).size !== rows.length) fail(`${label} 不能重复`)
  return rows
}

function bindingEquals(left: TextOpenWorldCreatorBuildBindingV1, right: TextOpenWorldCreatorBuildBindingV1): boolean {
  return canonicalProductProductionJsonV2(left) === canonicalProductProductionJsonV2(right)
}

function buildBindingFromRow(
  productionKey: string,
  build: ProductBuildRecordV1,
): TextOpenWorldCreatorBuildBindingV1 {
  if (![build.packageHash, build.previewHash, build.manifestHash, build.qualityReportHash, build.rootTerminalReceiptHash]
    .every(value => typeof value === 'string' && isSha256Hash(value))) fail('历史Build缺少终态Hash')
  return {
    productionKey, buildNumber: build.buildNumber, packageHash: build.packageHash,
    previewHash: build.previewHash, manifestHash: build.manifestHash,
    qualityReportHash: build.qualityReportHash, rootTerminalReceiptHash: build.rootTerminalReceiptHash!,
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function stringListsEqual(left: string[], right: string[]): boolean {
  return canonicalProductProductionJsonV2(left) === canonicalProductProductionJsonV2(uniqueStrings(right))
}

function acceptedArtifactPayload<T>(authority: BuildAuthorityV1, artifactKey: string): T {
  const rows = authority.artifacts.filter(row => row.artifactKey === artifactKey)
    .sort((left, right) => right.version - left.version || right.updatedAt - left.updatedAt)
  const row = rows[0]
  if (!row) fail(`校准缺少受治理Artifact:${artifactKey}`)
  try { return JSON.parse(row.payloadJson) as T } catch { fail(`校准Artifact不是合法JSON:${artifactKey}`) }
}

function acceptedArtifactHash(authority: BuildAuthorityV1, artifactKey: string): string {
  const rows = authority.artifacts.filter(row => row.artifactKey === artifactKey)
    .sort((left, right) => right.version - left.version || right.updatedAt - left.updatedAt)
  return rows[0]?.contentHash ?? fail(`校准缺少Artifact Hash:${artifactKey}`)
}

function textCallDurations(budgetLedgerJson: string): number[] {
  let value: unknown
  try { value = JSON.parse(budgetLedgerJson) } catch { fail('Build预算账本不是合法JSON') }
  const ledger = object(value, 'budget ledger')
  const charges = object(ledger.charges, 'budget ledger.charges')
  const durations: number[] = []
  for (const [key, raw] of Object.entries(charges)) {
    const charge = object(raw, `budget ledger.charges.${key}`)
    const usage = object(charge.usage, `budget ledger.charges.${key}.usage`)
    const calls = Number(usage.modelCalls)
    const durationMs = Number(usage.durationMs)
    if (!Number.isSafeInteger(calls) || calls < 0 || !Number.isSafeInteger(durationMs) || durationMs < 0) {
      fail(`Build预算账本用量无效:${key}`)
    }
    if (calls > 0) {
      const perCall = Math.max(1, Math.round(durationMs / calls))
      for (let index = 0; index < calls; index += 1) durations.push(perCall)
    }
  }
  return durations.sort((left, right) => left - right)
}

function percentile(values: number[], quantile: number): number {
  if (!values.length) return 0
  return values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * quantile) - 1))]!
}

function plausibleRealProviderIdentity(provider: string, model: string): boolean {
  return !/(fixture|mock|simulat|fake|test-provider|test-model)/i.test(`${provider}/${model}`)
}

async function calibrationReadiness(authority: BuildAuthorityV1): Promise<{
  readiness: TextOpenWorldCreatorCalibrationReadinessV1
  graderConfig: ReturnType<typeof resolveRequestConfig>['config']
  graderResolution: ReturnType<typeof resolveRequestConfig>
  generator: Awaited<ReturnType<typeof readTextOpenWorldCreatorDerivedBuildAuthorityV1>>['contracts']['start']['preflight']['providerBinding']
}> {
  const derived = await readTextOpenWorldCreatorDerivedBuildAuthorityV1({
    scope: authority.scope, buildId: authority.build.id,
  })
  const generator = derived.contracts.start.preflight.providerBinding
  const aiState = useAIConfigStore.getState()
  const resolved = resolveRequestConfig(aiState.config, {
    category: TEXT_OPEN_WORLD_CREATOR_CALIBRATION_CATEGORY_V1,
    projectId: authority.scope.projectId,
  })
  const grader = resolved.config
  const credentialReady = isAIConfigReady(grader) && Boolean(grader.model.trim() && grader.baseUrl.trim())
  const independentIdentity = grader.provider !== generator.provider || grader.model.trim() !== generator.model.trim()
  const realIdentities = plausibleRealProviderIdentity(generator.provider, generator.model)
    && plausibleRealProviderIdentity(grader.provider, grader.model)
  const issue = !credentialReady
    ? getAIConfigRequiredMessage(grader)
    : !independentIdentity
      ? '审查路由必须选择与生产生成器不同的 provider/model；请在AI设置中给“审查校验”绑定独立预设。'
      : !realIdentities
        ? 'fixture/mock/simulated 身份只能验证协议，不能冻结真实质量校准回执。'
        : null
  return {
    readiness: {
      generator: { provider: generator.provider, model: generator.model },
      grader: { provider: grader.provider, model: grader.model },
      credentialReady, independentIdentity, ready: issue == null, issue,
    },
    graderConfig: grader, graderResolution: resolved,
    generator,
  }
}

function canonicalRows<T extends { id?: number }>(rows: T[]): string {
  return canonicalProductProductionJsonV2([...rows]
    .sort((left, right) => (left.id ?? -1) - (right.id ?? -1))
    .map(row => ({ ...row, id: row.id ?? null })))
}

async function verifyOwnHash(value: Record<string, unknown>, hashKey: string, label: string): Promise<string> {
  const claimed = value[hashKey]
  if (typeof claimed !== 'string' || !isSha256Hash(claimed)) fail(`${label}.${hashKey} 无效`)
  const body = { ...value }
  delete body[hashKey]
  if (await hashProductProductionValueV2(body) !== claimed) fail(`${label}.${hashKey} 校验失败`)
  return claimed
}

async function parseReviewArtifact(
  artifact: ProductBuildArtifactRecordV1,
  kind: 'balance' | 'semantic',
): Promise<TextOpenWorldCreatorReviewSummaryV1> {
  let raw: unknown
  try { raw = JSON.parse(artifact.payloadJson) } catch { fail(`${kind}评审 Artifact 不是合法JSON`) }
  const row = object(raw, `${kind}评审`)
  const expectedSchema = `storyforge.text-open-world-${kind}-review`
  const hashKey = kind === 'balance' ? 'balanceReviewHash' : 'semanticReviewHash'
  if (row.schema !== expectedSchema || row.version !== 1 || row.productType !== 'text-open-world'
    || !Array.isArray(row.scores) || !Array.isArray(row.findings)
    || !['pass', 'repair-required'].includes(String(row.verdict))
    || !Number.isInteger(row.minimumScore) || !Number.isInteger(row.threshold)) {
    fail(`${kind}评审身份或基础字段无效`)
  }
  if (await hashProductProductionValueV2(raw) !== artifact.contentHash) fail(`${kind}评审 Artifact contentHash 无效`)
  const reviewHash = await verifyOwnHash(row, hashKey, `${kind}评审`)
  const scores = row.scores.map((value, index) => {
    const score = object(value, `${kind}.scores[${index}]`)
    const number = Number(score.score)
    if (!Number.isInteger(number) || number < 0 || number > 100) fail(`${kind}.scores[${index}].score 无效`)
    return {
      metricKey: boundedText(score.metricKey, `${kind}.scores[${index}].metricKey`, 100),
      score: number,
      rationale: boundedText(score.rationale, `${kind}.scores[${index}].rationale`, 4_000),
    }
  })
  const findings = row.findings.map((value, index) => {
    const finding = object(value, `${kind}.findings[${index}]`)
    const repair = object(finding.repair, `${kind}.findings[${index}].repair`)
    const findingScore = Number(finding.score)
    if (!['advisory', 'blocking'].includes(String(finding.severity))
      || !Number.isInteger(findingScore) || findingScore < 0 || findingScore > 100) {
      fail(`${kind}.findings[${index}].severity/score 无效`)
    }
    const targetEntityKeys = boundedLines(finding.targetEntityKeys, `${kind}.findings[${index}].targetEntityKeys`, 1_000, 200)
    const rawKey = boundedText(finding.key, `${kind}.findings[${index}].key`, 150)
    return {
      findingKey: `${kind}:${rawKey}`,
      reviewKind: kind,
      severity: finding.severity as 'advisory' | 'blocking',
      metricKey: boundedText(finding.metricKey, `${kind}.findings[${index}].metricKey`, 100),
      score: findingScore,
      summary: boundedText(finding.summary, `${kind}.findings[${index}].summary`, 1_000),
      evidence: boundedText(finding.evidence, `${kind}.findings[${index}].evidence`, 4_000),
      targetArtifactKey: boundedText(finding.targetArtifactKey, `${kind}.findings[${index}].targetArtifactKey`, 200),
      targetEntityKeys,
      repairTaskKey: boundedText(repair.targetTaskKey, `${kind}.findings[${index}].repair.targetTaskKey`, 200),
    } satisfies TextOpenWorldCreatorReviewFindingV1
  })
  if (new Set(scores.map(score => score.metricKey)).size !== scores.length
    || new Set(findings.map(finding => finding.findingKey)).size !== findings.length) fail(`${kind}评审指标或finding重复`)
  const minimumScore = Math.min(...scores.map(score => score.score))
  if (scores.length < 1 || minimumScore !== row.minimumScore
    || row.verdict === 'pass' && (minimumScore < Number(row.threshold) || findings.some(item => item.severity === 'blocking'))
    || row.verdict === 'repair-required' && minimumScore >= Number(row.threshold)) fail(`${kind}评审结论不闭合`)
  return {
    reviewKind: kind,
    artifactHash: artifact.contentHash,
    reviewHash,
    minimumScore,
    threshold: Number(row.threshold),
    verdict: row.verdict as 'pass' | 'repair-required',
    scores,
    findings: findings.sort((left, right) => left.findingKey.localeCompare(right.findingKey)),
  }
}

async function loadBuildAuthority(input: {
  scope: WorkspaceScope
  productionId: number
  expectedBuildId?: number
}): Promise<BuildAuthorityV1> {
  const scope = await resolveScope({ scope: input.scope })
  const production = await db.productProductions.get(input.productionId)
  if (!production || production.id == null
    || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })
    || production.productType !== 'text-open-world' || production.currentBuildNumber == null) {
    fail('Production不存在、跨Work、产品错误或没有当前Build')
  }
  const build = await db.productBuilds
    .where('[productionId+buildNumber]').equals([production.id, production.currentBuildNumber]).first()
  const previewAuthority = build != null
    && ['preview-ready', 'release-ready'].includes(build.status)
    && production.status === 'preview-ready'
  const releasedAuthority = build != null
    && build.status === 'released'
    && production.status === 'released'
    && production.currentProductReleaseId != null
    && build.releasedProductReleaseId === production.currentProductReleaseId
  if (!build || build.id == null || input.expectedBuildId != null && build.id !== input.expectedBuildId
    || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })
    || (!previewAuthority && !releasedAuthority)) fail('当前Creator Build尚未封账、已发布绑定损坏或已经变化')
  const briefRow = await db.productProductionBriefs
    .where('[productionId+revision]').equals([production.id, build.briefRevision]).first()
  if (!briefRow || briefRow.id == null
    || !await assertRecordInScope(scope, 'productProductionBriefs', briefRow, { owner: 'work' })
    || briefRow.briefKind !== 'text-open-world-creator-v1' || briefRow.status !== 'authorized'
    || briefRow.briefHash !== build.briefHash) fail('当前Build没有已授权Creator Brief')
  const derivedAuthority = await readTextOpenWorldCreatorDerivedBuildAuthorityV1({
    scope, buildId: build.id,
  })
  if (derivedAuthority.production.id !== production.id
    || derivedAuthority.build.id !== build.id
    || derivedAuthority.contracts.creatorBrief.briefHash !== briefRow.briefHash) {
    fail('Creator派生Build授权与当前Brief不闭合')
  }
  if (![build.packageHash, build.previewHash, build.manifestHash, build.qualityReportHash, build.rootTerminalReceiptHash]
    .every(value => typeof value === 'string' && isSha256Hash(value))) fail('当前Build缺少终态Hash')
  const governance = await readTextOpenWorldArtifactGovernanceV1({ scope, productionId: production.id })
  if (governance.production.id !== production.id || governance.production.stateRevision !== production.stateRevision
    || governance.build.id !== build.id || governance.build.buildNumber !== build.buildNumber
    || governance.build.planHash !== build.planHash) fail('Artifact治理快照与当前Build不一致')
  const artifacts = await readAcceptedBuildArtifacts({ scope, buildId: build.id })
  const currentArtifacts = governance.artifacts.filter(row => row.currentEpoch)
  const quality = parseProductBuildQualityReportV1(build.qualityReportJson)
  if (await hashProductProductionValueV2(quality) !== build.qualityReportHash
    || quality.buildNumber !== build.buildNumber || quality.packageHash !== build.packageHash) fail('Build QualityReport绑定无效')
  const artifact = (key: string) => artifacts.find(row => row.artifactKey === key) ?? fail(`缺少质量Artifact:${key}`)
  const reviews = await Promise.all([
    parseReviewArtifact(artifact('text-open-world.balance-review'), 'balance'),
    parseReviewArtifact(artifact('text-open-world.semantic-review'), 'semantic'),
  ])
  const buildBinding: TextOpenWorldCreatorBuildBindingV1 = {
    productionKey: production.productionKey,
    buildNumber: build.buildNumber,
    packageHash: build.packageHash,
    previewHash: build.previewHash,
    manifestHash: build.manifestHash,
    qualityReportHash: build.qualityReportHash,
    rootTerminalReceiptHash: build.rootTerminalReceiptHash!,
  }
  const hardChecks: TextOpenWorldCreatorHardGateCheckV1[] = [
    {
      gateKey: 'creator-build.current-sealed', label: '当前Creator Build与已授权Brief已封账',
      passed: true, evidenceHashes: [build.briefHash, build.planHash, build.manifestHash].sort(),
    },
    {
      gateKey: 'creator-artifacts.production-validated', label: '全部当前Artifact通过正式生产与物理证据验证',
      passed: governance.summary.currentProblemArtifactCount === 0
        && governance.summary.currentIntegrityOnlyArtifactCount === 0
        && governance.summary.currentProductionValidatedArtifactCount === artifacts.length
        && currentArtifacts.length === artifacts.length,
      evidenceHashes: [governance.snapshotHash],
    },
    {
      gateKey: 'runtime-package.playable', label: 'V3运行包与QA报告可玩且发布覆盖闭合',
      passed: quality.playable && quality.releaseReady,
      evidenceHashes: [build.packageHash, build.previewHash, build.qualityReportHash].sort(),
    },
    ...quality.hardGateResults.map(gate => ({
      gateKey: `qa.${gate.gateId}`,
      label: `生产QA：${gate.gateId}`,
      passed: gate.passed,
      evidenceHashes: gate.evidence.filter(isSha256Hash).sort(),
    })),
    {
      gateKey: 'model-reviews.no-blocker', label: '平衡与叙事双评审没有阻断项',
      passed: reviews.every(review => review.verdict === 'pass'
        && review.minimumScore >= review.threshold
        && review.findings.every(finding => finding.severity === 'advisory')),
      evidenceHashes: reviews.flatMap(review => [review.artifactHash, review.reviewHash]).sort(),
    },
  ]
  return {
    scope,
    production: production as ProductProductionRecordV1 & { id: number },
    build: build as ProductBuildRecordV1 & { id: number },
    briefRow: briefRow as ProductProductionBriefRecordV1 & { id: number },
    artifacts,
    quality,
    buildBinding,
    governanceSnapshotHash: governance.snapshotHash,
    hardChecks,
    reviews: reviews.sort((left, right) => left.reviewKind.localeCompare(right.reviewKind)),
    derivedCommandChain: derivedAuthority.commandChain,
    authorityRowsJson: {
      production: canonicalRows([production]),
      build: canonicalRows([build]),
      brief: canonicalRows([briefRow]),
      artifacts: canonicalRows(artifacts),
    },
  }
}

async function assertAuthorityRowsUnchangedInTransaction(authority: BuildAuthorityV1): Promise<void> {
  const [production, build, brief, artifacts] = await Promise.all([
    db.productProductions.get(authority.production.id),
    db.productBuilds.get(authority.build.id),
    db.productProductionBriefs.get(authority.briefRow.id),
    db.productBuildArtifacts.where('buildId').equals(authority.build.id).toArray(),
  ])
  const activeArtifacts = artifacts.filter(row => row.status === 'accepted' || row.status === 'carried-forward')
  if (!production || !build || !brief
    || canonicalRows([production]) !== authority.authorityRowsJson.production
    || canonicalRows([build]) !== authority.authorityRowsJson.build
    || canonicalRows([brief]) !== authority.authorityRowsJson.brief
    || canonicalRows(activeArtifacts) !== authority.authorityRowsJson.artifacts) {
    fail('Creator质量写入前Production/Build/Brief/Artifact已变化')
  }
}

async function createGateReceipt<T>(input: {
  gateId: string
  verifierId: string
  verifierKind: ProductQualityGateReceiptV1['verifierKind']
  inputHashes: string[]
  environmentHash: string | null
  evidence: T
  status: ProductQualityGateReceiptStatusV1
  policyId: string
  evidenceRefs: string[]
  createdAt: number
}): Promise<ProductQualityGateReceiptV1> {
  const body = {
    schema: 'storyforge.product-quality-gate-receipt' as const,
    version: 1 as const,
    gateId: input.gateId,
    gateVersion: '1',
    verifierId: input.verifierId,
    verifierVersion: '1',
    verifierKind: input.verifierKind,
    inputHashes: [...new Set(input.inputHashes)],
    environmentHash: input.environmentHash,
    measuredJson: canonicalProductProductionJsonV2(input.evidence),
    status: input.status,
    thresholdProfileId: input.policyId,
    thresholdProfileVersion: '1',
    evidenceRefs: [...new Set(input.evidenceRefs)],
    createdAt: input.createdAt,
  }
  return { ...body, receiptHash: await hashProductProductionValueV2(body) }
}

function pendingReceiptRow(
  authority: BuildAuthorityV1,
  receipt: ProductQualityGateReceiptV1,
): ProductQualityGateReceiptRecordV1 {
  return stampNewRecord(authority.scope, 'productQualityGateReceipts', {
    projectId: authority.scope.projectId,
    worldId: authority.scope.worldId,
    workId: authority.scope.workId,
    buildId: authority.build.id,
    gateId: receipt.gateId,
    gateVersion: receipt.gateVersion,
    verifierId: receipt.verifierId,
    verifierVersion: receipt.verifierVersion,
    status: receipt.status,
    receiptJson: canonicalProductProductionJsonV2(receipt),
    receiptHash: receipt.receiptHash,
    createdAt: receipt.createdAt,
  } satisfies ProductQualityGateReceiptRecordV1, { owner: 'work' })
}

async function verifyGenericReceiptRow<T>(input: {
  row: ProductQualityGateReceiptRecordV1 & { id: number }
  authority: ReceiptAuthorityV1
  gateId: string
  verifierId: string
  policyId: string
  statuses: ProductQualityGateReceiptStatusV1[]
  parseEvidence: (value: unknown) => T
}): Promise<VerifiedReceiptV1<T>> {
  const receipt = parseProductQualityGateReceiptV1(input.row.receiptJson)
  const { receiptHash, ...body } = receipt
  if (await hashProductProductionValueV2(body) !== receiptHash
    || input.row.buildId !== input.authority.build.id
    || input.row.gateId !== input.gateId || receipt.gateId !== input.gateId
    || input.row.gateVersion !== '1' || receipt.gateVersion !== '1'
    || input.row.verifierId !== input.verifierId || receipt.verifierId !== input.verifierId
    || input.row.verifierVersion !== '1' || receipt.verifierVersion !== '1'
    || input.row.status !== receipt.status || !input.statuses.includes(receipt.status)
    || input.row.receiptHash !== receipt.receiptHash
    || receipt.thresholdProfileId !== input.policyId || receipt.thresholdProfileVersion !== '1') {
    fail(`质量回执索引或Hash无效:${input.gateId}`)
  }
  let raw: unknown
  try { raw = JSON.parse(receipt.measuredJson) } catch { fail(`质量回执证据不是合法JSON:${input.gateId}`) }
  const evidence = input.parseEvidence(raw)
  return {
    row: input.row,
    gateReceipt: receipt,
    rowId: input.row.id,
    gateId: receipt.gateId,
    status: receipt.status,
    receiptHash: receipt.receiptHash,
    evidence,
    createdAt: receipt.createdAt,
  }
}

async function latestFixedReceipt<T>(input: {
  authority: ReceiptAuthorityV1
  gateId: string
  verifierId: string
  policyId: string
  statuses: ProductQualityGateReceiptStatusV1[]
  parseEvidence: (value: unknown) => T
}): Promise<VerifiedReceiptV1<T> | null> {
  const rows = await db.productQualityGateReceipts
    .where('[buildId+gateId]').equals([input.authority.build.id, input.gateId]).toArray()
  rows.sort((left, right) => right.createdAt - left.createdAt || (right.id ?? -1) - (left.id ?? -1))
  const row = rows[0]
  if (!row || row.id == null) return null
  if (!await assertRecordInScope(input.authority.scope, 'productQualityGateReceipts', row, { owner: 'work' })) {
    fail(`质量回执跨Work:${input.gateId}`)
  }
  return verifyGenericReceiptRow({ ...input, row: row as ProductQualityGateReceiptRecordV1 & { id: number } })
}

function parseCommandActionKey(event: ProductRuntimeEvent): string | null {
  if (event.type !== 'text-open-world.command.committed') return null
  try {
    const raw = object(JSON.parse(event.payloadJson), 'command event')
    const envelope = object(raw.envelope, 'command envelope')
    return typeof envelope.actionKey === 'string' && STABLE_KEY.test(envelope.actionKey) ? envelope.actionKey : null
  } catch { return null }
}

function changedGrowthOrEconomy(initial: ReturnType<typeof JSON.parse>, current: Awaited<ReturnType<typeof readProductRuntimeState>>): boolean {
  const before = initial?.textOpenWorld?.state
  const after = current.textOpenWorld?.state
  if (!before || !after) return false
  return before.player?.level !== after.player?.level
    || before.player?.experience !== after.player?.experience
    || before.inventory?.currency !== after.inventory?.currency
    || canonicalProductProductionJsonV2(before.inventory?.stackQuantities ?? {})
      !== canonicalProductProductionJsonV2(after.inventory?.stackQuantities ?? {})
    || canonicalProductProductionJsonV2(before.inventory?.itemInstances ?? {})
      !== canonicalProductProductionJsonV2(after.inventory?.itemInstances ?? {})
}

async function createSessionWitness(input: {
  authority: BuildAuthorityV1
  session: ProductRuntimeSession & { id: number }
}): Promise<{ candidate: TextOpenWorldCreatorGrayboxCandidateV1; eventRowsJson: string; checkpointRowsJson: string; sessionRowJson: string }> {
  const { authority, session } = input
  const buildPreview = session.productBuildId === authority.build.id && session.productReleaseId == null
  const formalRelease = authority.build.releasedProductReleaseId != null
    && session.productBuildId == null
    && session.productReleaseId === authority.build.releasedProductReleaseId
  if (session.projectId !== authority.scope.projectId || session.worldId !== authority.scope.worldId
    || session.workId !== authority.scope.workId || (!buildPreview && !formalRelease)
    || session.kind !== 'text-open-world'
    || session.runtimeSourceHash !== authority.build.packageHash) fail('灰盒Session未绑定当前Creator Build')
  const [state, version, headInspection, events, checkpoints] = await Promise.all([
    readProductRuntimeState(session.id),
    readProductRuntimeStateVersion(session.id),
    inspectTextOpenWorldRuntimeHeadV1(session.id),
    db.productRuntimeEvents.where('sessionId').equals(session.id).sortBy('sequence'),
    db.productRuntimeCheckpoints.where('sessionId').equals(session.id).toArray(),
  ])
  if (headInspection.code !== 'valid' || headInspection.canonicalStateHash !== version.stateHash
    || version.sequence !== state.lastSequence || version.stateHash !== session.runtimeHeadStateHash
    || events.length < 1 || events[events.length - 1]?.sequence !== state.lastSequence
    || events.some((event, index) => event.projectId !== authority.scope.projectId
      || event.sessionId !== session.id || event.sequence !== index + 1
      || (event.worldGroupId ?? null) !== (session.worldGroupId ?? null))) fail('灰盒Session事件重放或缓存头无效')
  const validCheckpointHashes: string[] = []
  for (const checkpoint of checkpoints.sort((left, right) => left.throughSequence - right.throughSequence || (left.id ?? 0) - (right.id ?? 0))) {
    if (checkpoint.id == null || checkpoint.projectId !== authority.scope.projectId
      || checkpoint.sessionId !== session.id || (checkpoint.worldGroupId ?? null) !== (session.worldGroupId ?? null)) {
      fail('灰盒Checkpoint作用域无效')
    }
    const inspection = await inspectTextOpenWorldCheckpointV1(checkpoint.id)
    const valid = inspection.valid || await verifyProductRuntimeCheckpoint(checkpoint.id)
    if (!valid) fail('灰盒Checkpoint不能重放')
    validCheckpointHashes.push(checkpoint.stateHash)
  }
  validCheckpointHashes.sort()
  const actionKeys = [...new Set(events.map(parseCommandActionKey).filter((value): value is string => value != null))].sort()
  const initial = JSON.parse(session.initialStateJson)
  const endingKey = state.textOpenWorld?.state.endings.reachedKey ?? state.narrative?.endingKey ?? null
  const coverage = new Set<TextOpenWorldCreatorGrayboxSessionEvidenceV1['coverageKeys'][number]>()
  if (session.status === 'completed' && endingKey) coverage.add('mainline-ending')
  if (actionKeys.length > 0 && events.some(event => event.type === 'text-open-world.effects.applied')) coverage.add('governed-action')
  if (events.some(event => ['world.travel.completed', 'world.region.discovered'].includes(event.type))
    || actionKeys.some(key => /travel|move|location|map/i.test(key))) coverage.add('world-exploration')
  if (actionKeys.some(key => /combat|attack|skill|escape|flee/i.test(key))
    || events.some(event => event.type === 'text-open-world.effects.applied' && /combat/i.test(event.payloadJson))) coverage.add('combat')
  if (changedGrowthOrEconomy(initial, state)
    || actionKeys.some(key => /craft|buy|sell|equip|item|shop|vendor/i.test(key))) coverage.add('growth-or-economy')
  if (validCheckpointHashes.length > 0 && headInspection.code === 'valid') coverage.add('checkpoint-replay')
  const portable = {
    runtimeSourceHash: session.runtimeSourceHash,
    seedHash: await hashProductProductionValueV2(session.seed),
    titleHash: await hashProductProductionValueV2(session.title),
    status: session.status,
    initialStateHash: await hashProductProductionValueV2(initial),
    currentStateHash: version.stateHash,
    eventStreamHash: '0'.repeat(64),
    eventCount: events.length,
    throughSequence: state.lastSequence,
    endingKey,
    actionKeys,
    checkpointStateHashes: validCheckpointHashes,
    coverageKeys: [...coverage].sort(),
    startedAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
  // Replace the temporary redacted placeholders with deterministic hashes. No
  // command id or player/world prose enters the portable graybox receipt.
  const eventStreamHash = await hashProductProductionValueV2(await Promise.all(events.map(async event => ({
    sequence: event.sequence,
    type: event.type,
    actorKeyHash: event.actorKey ? await hashProductProductionValueV2(event.actorKey) : null,
    targetKeyHash: event.targetKey ? await hashProductProductionValueV2(event.targetKey) : null,
    commandIdHash: event.commandId ? await hashProductProductionValueV2(event.commandId) : null,
    payloadHash: await hashProductProductionValueV2(JSON.parse(event.payloadJson)),
    createdAt: event.createdAt,
  }))))
  portable.eventStreamHash = eventStreamHash
  const witnessWithoutKey = portable
  const sessionWitnessKey = `session.${(await hashProductProductionValueV2(witnessWithoutKey)).slice(0, 24)}`
  const witness: TextOpenWorldCreatorGrayboxSessionEvidenceV1 = { sessionWitnessKey, ...portable }
  return {
    candidate: {
      sessionId: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      completed: session.status === 'completed' && endingKey != null,
      endingKey,
      coverageKeys: witness.coverageKeys,
      missingCoverageKeys: TEXT_OPEN_WORLD_CREATOR_GRAYBOX_COVERAGE_KEYS_V1
        .filter(key => !coverage.has(key)),
      eventCount: events.length,
      checkpointCount: validCheckpointHashes.length,
      source: buildPreview ? 'build-preview' : 'product-release',
      witness,
    },
    eventRowsJson: canonicalRows(events),
    checkpointRowsJson: canonicalRows(checkpoints),
    sessionRowJson: canonicalRows([session]),
  }
}

async function listGrayboxCandidates(authority: BuildAuthorityV1): Promise<TextOpenWorldCreatorGrayboxCandidateV1[]> {
  const sessionGroups = await Promise.all([
    db.productRuntimeSessions.where('productBuildId').equals(authority.build.id).toArray(),
    authority.build.releasedProductReleaseId == null ? Promise.resolve([])
      : db.productRuntimeSessions.where('productReleaseId').equals(authority.build.releasedProductReleaseId).toArray(),
  ])
  const sessions = sessionGroups.flat()
    .filter((session, index, rows) => rows.findIndex(item => item.id === session.id) === index)
    .filter(session => session.id != null && session.projectId === authority.scope.projectId
      && session.worldId === authority.scope.worldId && session.workId === authority.scope.workId
      && session.runtimeSourceHash === authority.build.packageHash
      && session.kind === 'text-open-world') as Array<ProductRuntimeSession & { id: number }>
  const candidates: TextOpenWorldCreatorGrayboxCandidateV1[] = []
  for (const session of sessions) {
    try { candidates.push((await createSessionWitness({ authority, session })).candidate) }
    catch { /* A corrupt preview is not offered as evidence; the player recovery UI still owns repair. */ }
  }
  return candidates.sort((left, right) => right.updatedAt - left.updatedAt || right.sessionId - left.sessionId)
}

interface FullPlaytestRuntimeAICaptureV1 {
  evidence: TextOpenWorldCreatorFullPlaytestRuntimeAIEvidenceV1
  runRowsJson: string
  eventRowsJson: string
}

async function captureFullPlaytestRuntimeAIV1(
  authority: BuildAuthorityV1,
  sessionIds: number[],
): Promise<FullPlaytestRuntimeAICaptureV1> {
  const runRows = (await Promise.all(sessionIds.map(sessionId => (
    db.agentRuns.where('productRuntimeSessionId').equals(sessionId).toArray()
  )))).flat().sort((left, right) => (left.id ?? -1) - (right.id ?? -1))
  if (runRows.some(run => run.id == null || run.projectId !== authority.scope.projectId
    || !sessionIds.includes(run.productRuntimeSessionId ?? -1) || run.workId != null
    || run.productBuildId != null)) fail('完整试玩运行时AI Run作用域无效')
  const rawEventRows = (await Promise.all(runRows.map(run => (
    db.agentRunEvents.where('runId').equals(run.id!).sortBy('sequence')
  )))).flat().sort((left, right) => left.runId - right.runId || left.sequence - right.sequence)
  const snapshots = await Promise.all(runRows.map(run => readInstanceAgentRunV1(authority.scope, run.id!)))
  const waits: number[] = []
  let modelRequestCount = 0
  let modelResponseCount = 0
  let freeInputResponseCount = 0
  const portableRuns: Array<Record<string, unknown>> = []
  for (const snapshot of snapshots) {
    const freeInputRun = (snapshot.contract.executionBindings ?? []).some(binding => (
      binding.skillId === 'prose.text-open-world-runtime-intent'
    ))
    const pending = new Map<string, number[]>()
    for (const event of snapshot.events) {
      if (event.type === 'model.requested') {
        modelRequestCount += 1
        const key = `${event.generation}:${event.payload.stepId}:${event.payload.attempt}`
        pending.set(key, [...(pending.get(key) ?? []), event.createdAt])
      } else if (event.type === 'model.responded') {
        modelResponseCount += 1
        if (freeInputRun) freeInputResponseCount += 1
        const key = `${event.generation}:${event.payload.stepId}:${event.payload.attempt}`
        const starts = pending.get(key) ?? []
        const startedAt = starts.shift()
        if (startedAt == null || event.createdAt < startedAt) fail('完整试玩运行时AI请求/响应顺序无效')
        waits.push(event.createdAt - startedAt)
        if (starts.length) pending.set(key, starts)
        else pending.delete(key)
      }
    }
    const eventHash = await hashProductProductionValueV2(snapshot.events.map(event => ({
      sequence: event.sequence, generation: event.generation, contractHash: event.contractHash,
      type: event.type, payload: event.payload, createdAt: event.createdAt,
    })))
    portableRuns.push({
      contractHash: snapshot.run.contractHash, generation: snapshot.run.generation,
      status: snapshot.run.status, lastSequence: snapshot.run.lastSequence,
      terminalReceiptHash: snapshot.run.terminalReceiptHash ?? null, eventHash,
    })
  }
  if (freeInputResponseCount < 1) fail('完整试玩必须至少真实完成一次玩家自由输入runtime-intent响应')
  const evidenceHash = await hashProductProductionValueV2(portableRuns)
  return {
    evidence: {
      runCount: runRows.length, modelRequestCount, modelResponseCount,
      freeInputResponseCount,
      failedRunCount: runRows.filter(run => run.status === 'failed').length,
      totalObservedWaitMs: waits.reduce((sum, value) => sum + value, 0),
      maximumObservedWaitMs: waits.length ? Math.max(...waits) : 0,
      evidenceHash,
    },
    runRowsJson: canonicalRows(runRows),
    eventRowsJson: canonicalRows(rawEventRows),
  }
}

async function parseIssueReceipt(
  authority: ReceiptAuthorityV1,
  row: ProductQualityGateReceiptRecordV1 & { id: number },
): Promise<VerifiedReceiptV1<TextOpenWorldCreatorIssueEvidenceV1>> {
  const receipt = await verifyGenericReceiptRow({
    row, authority, gateId: row.gateId, verifierId: 'storyforge.author-issue-report',
    policyId: ISSUE_POLICY_ID, statuses: ['failed', 'needs-human'],
    parseEvidence: parseTextOpenWorldCreatorIssueEvidenceV1,
  })
  const expectedGateId = `${TEXT_OPEN_WORLD_CREATOR_ISSUE_GATE_PREFIX_V1}${receipt.evidence.issueFingerprint.slice(0, 24)}`
  const expectedStatus = receipt.evidence.severity === 'blocking' ? 'failed' : 'needs-human'
  if (row.gateId !== expectedGateId || receipt.status !== expectedStatus
    || !bindingEquals(receipt.evidence.build, authority.buildBinding)
    || receipt.gateReceipt.verifierKind !== 'human-evidence'
    || !stringListsEqual(receipt.gateReceipt.inputHashes, [
      authority.build.packageHash, authority.build.previewHash, receipt.evidence.issueFingerprint,
    ])
    || !stringListsEqual(receipt.gateReceipt.evidenceRefs, [
      receipt.evidence.issueFingerprint,
      ...(receipt.evidence.runtimeWitness ? [
        receipt.evidence.runtimeWitness.eventStreamHash,
        receipt.evidence.runtimeWitness.currentStateHash,
      ] : []),
    ])
    || receipt.gateReceipt.environmentHash !== null
    || receipt.gateReceipt.createdAt !== receipt.evidence.reportedAt) fail('问题回执与当前Build或索引不闭合')
  return receipt
}

async function parseIssueWaiverReceipt(
  authority: ReceiptAuthorityV1,
  issue: VerifiedReceiptV1<TextOpenWorldCreatorIssueEvidenceV1>,
  row: ProductQualityGateReceiptRecordV1 & { id: number },
): Promise<VerifiedReceiptV1<TextOpenWorldCreatorIssueWaiverEvidenceV1>> {
  const receipt = await verifyGenericReceiptRow({
    row, authority, gateId: row.gateId, verifierId: 'storyforge.author-advisory-waiver',
    policyId: ISSUE_WAIVER_POLICY_ID, statuses: ['waived'],
    parseEvidence: parseTextOpenWorldCreatorIssueWaiverEvidenceV1,
  })
  if (issue.evidence.severity !== 'advisory'
    || row.gateId !== `${TEXT_OPEN_WORLD_CREATOR_ISSUE_WAIVER_GATE_PREFIX_V1}${issue.evidence.issueFingerprint.slice(0, 24)}`
    || receipt.evidence.issueKey !== issue.evidence.issueKey
    || receipt.evidence.issueReceiptHash !== issue.receiptHash
    || !bindingEquals(receipt.evidence.build, authority.buildBinding)
    || receipt.gateReceipt.verifierKind !== 'human-evidence'
    || !stringListsEqual(receipt.gateReceipt.inputHashes, [authority.build.packageHash, issue.receiptHash])
    || !stringListsEqual(receipt.gateReceipt.evidenceRefs, [issue.receiptHash])
    || receipt.gateReceipt.environmentHash !== null
    || receipt.gateReceipt.createdAt !== receipt.evidence.confirmedAt) fail('问题软豁免与原问题或Build不闭合')
  return receipt
}

async function readIssues(authority: ReceiptAuthorityV1): Promise<Array<{
  issue: VerifiedReceiptV1<TextOpenWorldCreatorIssueEvidenceV1>
  waiver: VerifiedReceiptV1<TextOpenWorldCreatorIssueWaiverEvidenceV1> | null
}>> {
  const rows = await db.productQualityGateReceipts.where('buildId').equals(authority.build.id).toArray()
  const issueRows = rows.filter(row => row.id != null && row.gateId.startsWith(TEXT_OPEN_WORLD_CREATOR_ISSUE_GATE_PREFIX_V1))
  const waiverRows = rows.filter(row => row.id != null && row.gateId.startsWith(TEXT_OPEN_WORLD_CREATOR_ISSUE_WAIVER_GATE_PREFIX_V1))
  const issues: Array<{
    issue: VerifiedReceiptV1<TextOpenWorldCreatorIssueEvidenceV1>
    waiver: VerifiedReceiptV1<TextOpenWorldCreatorIssueWaiverEvidenceV1> | null
  }> = []
  for (const raw of issueRows) {
    if (!await assertRecordInScope(authority.scope, 'productQualityGateReceipts', raw, { owner: 'work' })) fail('问题回执跨Work')
    const issue = await parseIssueReceipt(authority, raw as ProductQualityGateReceiptRecordV1 & { id: number })
    const matching = waiverRows.filter(row => row.gateId === `${TEXT_OPEN_WORLD_CREATOR_ISSUE_WAIVER_GATE_PREFIX_V1}${issue.evidence.issueFingerprint.slice(0, 24)}`)
      .sort((left, right) => right.createdAt - left.createdAt || (right.id ?? -1) - (left.id ?? -1))
    const waiver = matching[0]?.id == null ? null
      : await parseIssueWaiverReceipt(authority, issue, matching[0] as ProductQualityGateReceiptRecordV1 & { id: number })
    issues.push({ issue, waiver })
  }
  return issues.sort((left, right) => right.issue.createdAt - left.issue.createdAt || left.issue.evidence.issueKey.localeCompare(right.issue.evidence.issueKey))
}

function publicReceipt<T>(value: VerifiedReceiptV1<T> | null): TextOpenWorldCreatorQualityReceiptV1<T> | null {
  if (!value) return null
  return {
    rowId: value.rowId, gateId: value.gateId, status: value.status,
    receiptHash: value.receiptHash, evidence: structuredClone(value.evidence), createdAt: value.createdAt,
  }
}

async function currentIssueSet(input: Awaited<ReturnType<typeof readIssues>>): Promise<{
  issueReceiptHashes: string[]
  issueWaiverReceiptHashes: string[]
  issueSetHash: string
}> {
  const issueReceiptHashes = input.map(row => row.issue.receiptHash).sort()
  const issueWaiverReceiptHashes = input.flatMap(row => row.waiver ? [row.waiver.receiptHash] : []).sort()
  return {
    issueReceiptHashes,
    issueWaiverReceiptHashes,
    issueSetHash: await hashProductProductionValueV2({ issueReceiptHashes, issueWaiverReceiptHashes }),
  }
}

async function readGrayboxReceipt(authority: BuildAuthorityV1): Promise<VerifiedReceiptV1<TextOpenWorldCreatorGrayboxEvidenceV1> | null> {
  const receipt = await latestFixedReceipt({
    authority, gateId: TEXT_OPEN_WORLD_CREATOR_GRAYBOX_GATE_ID_V1,
    verifierId: 'storyforge.creator-graybox-playtest', policyId: GRAYBOX_POLICY_ID,
    statuses: ['passed'], parseEvidence: parseTextOpenWorldCreatorGrayboxEvidenceV1,
  })
  if (!receipt) return null
  if (!bindingEquals(receipt.evidence.build, authority.buildBinding)
    || receipt.evidence.sessions.some(session => session.runtimeSourceHash !== authority.build.packageHash)
    || receipt.gateReceipt.verifierKind !== 'human-evidence'
    || !stringListsEqual(receipt.gateReceipt.inputHashes, [
      authority.build.packageHash, authority.build.previewHash,
      ...receipt.evidence.sessions.map(session => session.eventStreamHash),
    ])
    || !stringListsEqual(receipt.gateReceipt.evidenceRefs, receipt.evidence.sessions.flatMap(session => [
      session.currentStateHash, session.eventStreamHash, ...session.checkpointStateHashes,
    ]))
    || receipt.gateReceipt.environmentHash !== await hashProductProductionValueV2(receipt.evidence.environment)
    || receipt.gateReceipt.createdAt !== receipt.evidence.confirmedAt) fail('灰盒回执与当前Build/环境不闭合')
  return receipt
}

async function readFullPlaytestReceipt(input: {
  authority: ReceiptAuthorityV1
  calibrationReceipt: VerifiedReceiptV1<TextOpenWorldCreatorCalibrationEvidenceV1> | null
  issueSet: Awaited<ReturnType<typeof currentIssueSet>>
}): Promise<VerifiedReceiptV1<TextOpenWorldCreatorFullPlaytestEvidenceV1> | null> {
  const receipt = await latestFixedReceipt({
    authority: input.authority, gateId: TEXT_OPEN_WORLD_CREATOR_FULL_PLAYTEST_GATE_ID_V1,
    verifierId: 'storyforge.creator-full-human-playtest', policyId: FULL_PLAYTEST_POLICY_ID,
    statuses: ['passed', 'needs-human'], parseEvidence: parseTextOpenWorldCreatorFullPlaytestEvidenceV1,
  })
  if (!receipt || !input.calibrationReceipt || input.calibrationReceipt.status !== 'passed') return null
  const evidence = receipt.evidence
  if (evidence.calibrationReceiptHash !== input.calibrationReceipt.receiptHash
    || evidence.issueSetHash !== input.issueSet.issueSetHash
    || canonicalProductProductionJsonV2(evidence.issueReceiptHashes)
      !== canonicalProductProductionJsonV2(input.issueSet.issueReceiptHashes)) return null
  const status = evidence.outcome === 'accepted' ? 'passed' : 'needs-human'
  if (!bindingEquals(evidence.build, input.authority.buildBinding)
    || receipt.status !== status
    || receipt.gateReceipt.verifierKind !== 'human-evidence'
    || !stringListsEqual(receipt.gateReceipt.inputHashes, [
      input.authority.build.packageHash, input.authority.build.previewHash,
      input.calibrationReceipt.receiptHash, input.issueSet.issueSetHash,
      evidence.runtimeAi.evidenceHash,
      ...evidence.routes.map(route => route.session.eventStreamHash),
    ])
    || !stringListsEqual(receipt.gateReceipt.evidenceRefs, [
      input.calibrationReceipt.receiptHash, evidence.runtimeAi.evidenceHash,
      ...evidence.issueReceiptHashes,
      ...evidence.routes.flatMap(route => [
        route.session.currentStateHash, route.session.eventStreamHash,
        ...route.session.checkpointStateHashes,
      ]),
    ])
    || receipt.gateReceipt.environmentHash !== await hashProductProductionValueV2(evidence.environment)
    || receipt.gateReceipt.createdAt !== evidence.confirmedAt) fail('完整真人试玩回执与当前Build、校准或问题集不闭合')
  return receipt
}

interface UpdateVerificationContextV1 {
  sourceBuild: ProductBuildRecordV1 & { id: number }
  repairAuthorizations: Array<Awaited<ReturnType<typeof parseTextOpenWorldCreatorRepairAuthorizationV1>>>
  derivedCommandHashes: string[]
  targetTaskKeys: string[]
  staleTaskKeys: string[]
  sourceRelease: Awaited<ReturnType<typeof verifyOwnedTextOpenWorldPlayerReleaseV1>>
  targetRelease: Awaited<ReturnType<typeof verifyOwnedTextOpenWorldPlayerReleaseV1>> | null
  sourceCalibration: VerifiedReceiptV1<TextOpenWorldCreatorCalibrationEvidenceV1>
  sourceFullPlaytest: VerifiedReceiptV1<TextOpenWorldCreatorFullPlaytestEvidenceV1>
  targetFullPlaytest: VerifiedReceiptV1<TextOpenWorldCreatorFullPlaytestEvidenceV1> | null
  sourceIssues: Awaited<ReturnType<typeof readIssues>>
  repairIssues: Awaited<ReturnType<typeof readIssues>>
  sourceLowScores: TextOpenWorldCreatorFullPlaytestAssessmentV1[]
  compatibility: ProductBuildCompatibilityReportV1
  sourceSessions: Array<ProductRuntimeSession & { id: number }>
  migratedSessions: Array<ProductRuntimeSession & { id: number }>
}

function updateReleaseBindingV1(
  release: Awaited<ReturnType<typeof verifyOwnedTextOpenWorldPlayerReleaseV1>>,
): TextOpenWorldCreatorUpdateVerificationEvidenceV1['sourceRelease'] {
  return {
    releaseUid: release.manifest.lineage.releaseUid,
    releaseVersion: release.release.version,
    releaseHash: release.manifest.releaseIdentityHash,
    packageHash: release.manifest.packageHash,
  }
}

interface ReleaseSaveCaptureV1 {
  session: ProductRuntimeSession & { id: number }
  sessionWitnessKey: string
  stateHash: string
  throughSequence: number
  sessionRowJson: string
  eventRowsJson: string
}

async function captureReleaseSaveV1(input: {
  scope: WorkspaceScope
  release: Awaited<ReturnType<typeof verifyOwnedTextOpenWorldPlayerReleaseV1>>
  session: ProductRuntimeSession & { id: number }
  throughSequence?: number
}): Promise<ReleaseSaveCaptureV1> {
  const { scope, release, session } = input
  if (session.projectId !== scope.projectId || session.worldId !== scope.worldId
    || session.workId !== scope.workId || session.kind !== 'text-open-world'
    || session.productBuildId != null || session.productReleaseId !== release.release.id
    || session.runtimeSourceHash !== release.manifest.packageHash) {
    fail('更新验证存档没有固定在指定正式Release')
  }
  const allEvents = await db.productRuntimeEvents.where('sessionId').equals(session.id).sortBy('sequence')
  const throughSequence = input.throughSequence ?? allEvents.length
  if (!Number.isSafeInteger(throughSequence) || throughSequence < 0
    || throughSequence > allEvents.length
    || allEvents.some((event, index) => event.projectId !== scope.projectId
      || event.sessionId !== session.id || event.sequence !== index + 1
      || (event.worldGroupId ?? null) !== (session.worldGroupId ?? null))) {
    fail('更新验证存档事件前缀不完整或越界')
  }
  const events = allEvents.slice(0, throughSequence)
  const stateHash = throughSequence === allEvents.length
    ? (await readVerifiedProductRuntimeHeadV1(session)).stateHash
    : await replayTextOpenWorldMigrationSourceStateHashV1({ session, events, throughSequence })
  const eventStreamHash = await hashProductProductionValueV2(await Promise.all(events.map(async event => ({
    sequence: event.sequence,
    type: event.type,
    actorKeyHash: event.actorKey ? await hashProductProductionValueV2(event.actorKey) : null,
    targetKeyHash: event.targetKey ? await hashProductProductionValueV2(event.targetKey) : null,
    commandIdHash: event.commandId ? await hashProductProductionValueV2(event.commandId) : null,
    payloadHash: await hashProductProductionValueV2(JSON.parse(event.payloadJson)),
    createdAt: event.createdAt,
  }))))
  const portable = {
    releaseUid: release.manifest.lineage.releaseUid,
    releaseHash: release.manifest.releaseIdentityHash,
    runtimeSourceHash: session.runtimeSourceHash,
    seedHash: await hashProductProductionValueV2(session.seed),
    titleHash: await hashProductProductionValueV2(session.title),
    status: session.status,
    stateHash,
    eventStreamHash,
    throughSequence,
    startedAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
  return {
    session,
    sessionWitnessKey: `save.${(await hashProductProductionValueV2(portable)).slice(0, 24)}`,
    stateHash,
    throughSequence,
    sessionRowJson: canonicalRows([session]),
    eventRowsJson: canonicalRows(allEvents),
  }
}

const EMPTY_UPDATE_READINESS: TextOpenWorldCreatorUpdateVerificationReadinessV1 = {
  required: false, ready: false, issue: null,
  sourceReleaseVersion: null, targetReleaseVersion: null, compatibility: null,
  sourceIssues: [], sourceLowScores: [], sourceSessionCandidates: [],
  migratedSessionCandidates: [], targetRouteWitnessKeys: [],
}

async function updateVerificationContextV1(input: {
  authority: BuildAuthorityV1
  targetFullPlaytest: VerifiedReceiptV1<TextOpenWorldCreatorFullPlaytestEvidenceV1> | null
}): Promise<{ context: UpdateVerificationContextV1 | null; readiness: TextOpenWorldCreatorUpdateVerificationReadinessV1 }> {
  const { authority } = input
  if (authority.build.sourceProductReleaseId == null) {
    return { context: null, readiness: structuredClone(EMPTY_UPDATE_READINESS) }
  }
  const sourceBuildRows = await db.productBuilds.where('productionId').equals(authority.production.id)
    .filter(row => row.releasedProductReleaseId === authority.build.sourceProductReleaseId).toArray()
  if (sourceBuildRows.length !== 1 || sourceBuildRows[0]?.id == null
    || sourceBuildRows[0].buildNumber >= authority.build.buildNumber) {
    fail('更新修复Build没有绑定唯一已发布源版本')
  }
  const sourceBuild = sourceBuildRows[0] as ProductBuildRecordV1 & { id: number }
  const repairAuthorizations = []
  for (const command of authority.derivedCommandChain) {
    if (command.type !== 'authorize-text-open-world-creator-repair') continue
    repairAuthorizations.push(await parseTextOpenWorldCreatorRepairAuthorizationV1(command.resultJson))
  }
  if (!repairAuthorizations.length) fail('更新Build派生链缺少局部修复授权')
  const derivedCommandHashes = [...new Set(await Promise.all(authority.derivedCommandChain.map(async command => (
    hashProductProductionValueV2({
      type: command.type,
      payloadHash: command.payloadHash,
      resultHash: await hashProductProductionValueV2(JSON.parse(command.resultJson)),
    })
  ))))].sort()
  const targetTaskKeys = [...new Set(repairAuthorizations.flatMap(row => row.impactPlan.targetTaskKeys))].sort()
  const staleTaskKeys = [...new Set(repairAuthorizations.flatMap(row => row.impactPlan.staleTaskKeys))].sort()
  const sourceReleaseRoot = await db.productReleases.get(authority.build.sourceProductReleaseId)
  if (!sourceReleaseRoot) fail('更新源Release不存在')
  const sourceRelease = await verifyOwnedTextOpenWorldPlayerReleaseV1(authority.scope, sourceReleaseRoot)
  if (sourceRelease.manifest.productionProvenance.buildNumber !== sourceBuild.buildNumber
    || sourceRelease.manifest.packageHash !== sourceBuild.packageHash) {
    fail('更新源Release与修复基线Build不闭合')
  }
  const sourceAuthority: ReceiptAuthorityV1 = {
    scope: authority.scope,
    build: sourceBuild,
    buildBinding: buildBindingFromRow(authority.production.productionKey, sourceBuild),
  }
  const sourceCalibration = await latestFixedReceipt({
    authority: sourceAuthority, gateId: TEXT_OPEN_WORLD_CREATOR_CALIBRATION_GATE_ID_V1,
    verifierId: 'storyforge.creator-independent-release-calibration', policyId: CALIBRATION_POLICY_ID,
    statuses: ['passed'], parseEvidence: parseTextOpenWorldCreatorCalibrationEvidenceV1,
  })
  const sourceIssues = await readIssues(sourceAuthority)
  const sourceIssueSet = await currentIssueSet(sourceIssues)
  const sourceFullPlaytest = await readFullPlaytestReceipt({
    authority: sourceAuthority, calibrationReceipt: sourceCalibration, issueSet: sourceIssueSet,
  })
  if (!sourceCalibration || !sourceFullPlaytest || sourceFullPlaytest.status !== 'needs-human'
    || sourceFullPlaytest.evidence.outcome !== 'repair-required'
    || !bindingEquals(sourceFullPlaytest.evidence.build, sourceAuthority.buildBinding)) {
    fail('已发布源版本缺少真人发现问题的完整试玩回执')
  }
  const repairIssues = sourceIssues.filter(row => row.issue.evidence.severity === 'blocking'
    || (row.issue.evidence.severity === 'advisory' && !row.waiver))
  const sourceLowScores = sourceFullPlaytest.evidence.assessments.filter(row => row.rating < 3)
  if (repairIssues.length + sourceLowScores.length < 1) fail('源版本完整试玩没有需要修复的问题或低分项')
  const runtimePackage = parseProductRuntimePackageV1(
    acceptedArtifactPayload<ProductRuntimePackageV1>(authority, 'text-open-world.runtime-package'),
  )
  const compatibility = await createProductBuildCompatibilityReportV1({
    previous: {
      buildNumber: sourceBuild.buildNumber,
      packageHash: sourceRelease.manifest.packageHash,
      runtimePackage: sourceRelease.manifest.runtimePackage,
    },
    current: {
      buildNumber: authority.build.buildNumber,
      packageHash: authority.build.packageHash,
      runtimePackage,
    },
  })
  let storedCompatibility: unknown
  try { storedCompatibility = JSON.parse(authority.build.compatibilityJson) }
  catch { fail('更新Build兼容报告不是合法JSON') }
  if (canonicalProductProductionJsonV2(storedCompatibility)
    !== canonicalProductProductionJsonV2(compatibility)) fail('更新Build兼容报告与当前RuntimePackage复算不一致')
  if (compatibility.migrationPolicy === 'initial-session') fail('修复Build不能使用首版存档策略')
  let targetRelease: Awaited<ReturnType<typeof verifyOwnedTextOpenWorldPlayerReleaseV1>> | null = null
  if (authority.build.status === 'released' && authority.build.releasedProductReleaseId != null) {
    const targetReleaseRoot = await db.productReleases.get(authority.build.releasedProductReleaseId)
    if (!targetReleaseRoot) fail('修复版Release不存在')
    targetRelease = await verifyOwnedTextOpenWorldPlayerReleaseV1(authority.scope, targetReleaseRoot)
    const parent = targetRelease.manifest.lineage.parentRelease
    if (targetRelease.manifest.productionProvenance.buildNumber !== authority.build.buildNumber
      || targetRelease.manifest.packageHash !== authority.build.packageHash
      || parent?.releaseUid !== sourceRelease.manifest.lineage.releaseUid
      || parent.releaseHash !== sourceRelease.manifest.releaseIdentityHash) {
      fail('修复版Release没有形成源版本的直接不可变后继')
    }
  }
  const sourceSessions = (await db.productRuntimeSessions
    .where('productReleaseId').equals(sourceRelease.release.id!).toArray())
    .filter(row => row.id != null && row.projectId === authority.scope.projectId
      && row.worldId === authority.scope.worldId && row.workId === authority.scope.workId
      && row.productBuildId == null && row.runtimeSourceHash === sourceRelease.manifest.packageHash
      && row.kind === 'text-open-world') as Array<ProductRuntimeSession & { id: number }>
  const migratedSessions = targetRelease == null ? [] : (await db.productRuntimeSessions
    .where('productReleaseId').equals(targetRelease.release.id!).toArray())
    .filter(row => row.id != null && row.projectId === authority.scope.projectId
      && row.worldId === authority.scope.worldId && row.workId === authority.scope.workId
      && row.parentSessionId != null && sourceSessions.some(source => source.id === row.parentSessionId)
      && row.productBuildId == null && row.runtimeSourceHash === targetRelease!.manifest.packageHash
      && row.kind === 'text-open-world') as Array<ProductRuntimeSession & { id: number }>
  const issue = !input.targetFullPlaytest || input.targetFullPlaytest.status !== 'passed'
    || input.targetFullPlaytest.evidence.outcome !== 'accepted'
    ? '修复Build尚未完成通过线的真人双结局完整试玩'
    : !targetRelease
      ? '修复Build尚未正式发布为新的不可变Release'
      : sourceSessions.length < 1
        ? '源Release没有可用于验证旧档继续或显式迁移的正式存档'
        : null
  const sourceLowScoreReadiness = sourceLowScores.map(row => {
    const targetRating = input.targetFullPlaytest?.evidence.assessments
      .find(item => item.criterionKey === row.criterionKey)?.rating
    if (input.targetFullPlaytest?.status === 'passed'
      && (targetRating == null || targetRating < 3)) {
      fail(`修复版完整试玩没有把低分项提升到通过线:${row.criterionKey}`)
    }
    return {
      criterionKey: row.criterionKey,
      sourceRating: row.rating as 1 | 2,
      targetRating: (targetRating ?? 3) as 3 | 4 | 5,
    }
  })
  const readiness: TextOpenWorldCreatorUpdateVerificationReadinessV1 = {
    required: true, ready: issue == null, issue,
    sourceReleaseVersion: sourceRelease.release.version,
    targetReleaseVersion: targetRelease?.release.version ?? null,
    compatibility: {
      level: compatibility.level,
      migrationPolicy: compatibility.migrationPolicy,
      reportHash: compatibility.reportHash,
    },
    sourceIssues: repairIssues.map(row => ({
      sourceIssueReceiptHash: row.issue.receiptHash,
      issueKey: row.issue.evidence.issueKey,
      category: row.issue.evidence.category,
      severity: row.issue.evidence.severity,
      affectedStableKeys: [...row.issue.evidence.affectedStableKeys],
    })),
    sourceLowScores: sourceLowScoreReadiness,
    sourceSessionCandidates: sourceSessions.map(row => ({
      sessionId: row.id, title: row.title, status: row.status,
    })),
    migratedSessionCandidates: migratedSessions.map(row => ({
      sessionId: row.id, title: row.title, parentSessionId: row.parentSessionId!,
    })),
    targetRouteWitnessKeys: input.targetFullPlaytest?.evidence.routes
      .map(row => row.session.sessionWitnessKey) ?? [],
  }
  return {
    context: {
      sourceBuild, repairAuthorizations, derivedCommandHashes, targetTaskKeys, staleTaskKeys,
      sourceRelease, targetRelease, sourceCalibration, sourceFullPlaytest,
      targetFullPlaytest: input.targetFullPlaytest, sourceIssues, repairIssues,
      sourceLowScores, compatibility, sourceSessions, migratedSessions,
    },
    readiness,
  }
}

async function readUpdateVerificationReceipt(input: {
  authority: BuildAuthorityV1
  context: UpdateVerificationContextV1 | null
}): Promise<VerifiedReceiptV1<TextOpenWorldCreatorUpdateVerificationEvidenceV1> | null> {
  const receipt = await latestFixedReceipt({
    authority: input.authority, gateId: TEXT_OPEN_WORLD_CREATOR_UPDATE_VERIFICATION_GATE_ID_V1,
    verifierId: 'storyforge.creator-release-update-verification',
    policyId: UPDATE_VERIFICATION_POLICY_ID, statuses: ['passed'],
    parseEvidence: parseTextOpenWorldCreatorUpdateVerificationEvidenceV1,
  })
  const context = input.context
  if (!receipt || !context) return null
  const targetRelease = context.targetRelease
  const targetFullPlaytest = context.targetFullPlaytest
  if (!targetRelease || !targetFullPlaytest) return null
  const evidence = receipt.evidence
  const repairAuthorization = context.repairAuthorizations[context.repairAuthorizations.length - 1]!
  const expectedIssueHashes = context.repairIssues.map(row => row.issue.receiptHash).sort()
  const expectedLow = context.sourceLowScores.map(row => row.criterionKey).sort()
  const targetRouteKeys = targetFullPlaytest.evidence.routes
    .map(row => row.session.sessionWitnessKey).sort()
  const expectedIssueFacts = context.repairIssues.map(row => ({
    sourceIssueReceiptHash: row.issue.receiptHash,
    issueKey: row.issue.evidence.issueKey,
    category: row.issue.evidence.category,
    severity: row.issue.evidence.severity,
    affectedStableKeys: [...row.issue.evidence.affectedStableKeys],
  })).sort((left, right) => left.sourceIssueReceiptHash.localeCompare(right.sourceIssueReceiptHash))
  const actualIssueFacts = evidence.issueResolutions.map(row => ({
    sourceIssueReceiptHash: row.sourceIssueReceiptHash,
    issueKey: row.issueKey,
    category: row.category,
    severity: row.severity,
    affectedStableKeys: [...row.affectedStableKeys],
  }))
  const expectedLowFacts = context.sourceLowScores.map(row => ({
    criterionKey: row.criterionKey,
    sourceRating: row.rating,
    targetRating: targetFullPlaytest.evidence.assessments
      .find(item => item.criterionKey === row.criterionKey)?.rating,
  })).sort((left, right) => left.criterionKey.localeCompare(right.criterionKey))
  const actualLowFacts = evidence.lowScoreResolutions.map(row => ({
    criterionKey: row.criterionKey,
    sourceRating: row.sourceRating,
    targetRating: row.targetRating,
  }))
  const inputHashes = [
    context.sourceRelease.manifest.packageHash,
    input.authority.build.packageHash,
    context.sourceFullPlaytest.receiptHash,
    targetFullPlaytest.receiptHash,
    repairAuthorization.authorizationHash,
    repairAuthorization.impactPlanHash,
    ...context.derivedCommandHashes,
    context.compatibility.reportHash,
    evidence.saveWitness.sourceStateHash,
    ...(evidence.saveWitness.targetStateHash ? [evidence.saveWitness.targetStateHash] : []),
    ...(evidence.saveWitness.migrationPreviewHash ? [evidence.saveWitness.migrationPreviewHash] : []),
  ]
  const evidenceRefs = [
    context.sourceFullPlaytest.receiptHash,
    targetFullPlaytest.receiptHash,
    repairAuthorization.authorizationHash,
    repairAuthorization.impactPlanHash,
    ...context.derivedCommandHashes,
    context.compatibility.reportHash,
    ...expectedIssueHashes,
    ...targetRouteKeys,
    evidence.saveWitness.sourceSessionWitnessKey,
    evidence.saveWitness.sourceStateHash,
    ...(evidence.saveWitness.targetSessionWitnessKey ? [evidence.saveWitness.targetSessionWitnessKey] : []),
    ...(evidence.saveWitness.targetStateHash ? [evidence.saveWitness.targetStateHash] : []),
    ...(evidence.saveWitness.migrationPreviewHash ? [evidence.saveWitness.migrationPreviewHash] : []),
  ]
  if (!bindingEquals(evidence.targetBuild, input.authority.buildBinding)
    || !bindingEquals(evidence.sourceBuild,
      buildBindingFromRow(input.authority.production.productionKey, context.sourceBuild))
    || evidence.sourceFullPlaytestReceiptHash !== context.sourceFullPlaytest.receiptHash
    || evidence.targetFullPlaytestReceiptHash !== targetFullPlaytest.receiptHash
    || evidence.repairAuthorizationHash !== repairAuthorization.authorizationHash
    || evidence.impactPlanHash !== repairAuthorization.impactPlanHash
    || canonicalProductProductionJsonV2(evidence.derivedCommandHashes)
      !== canonicalProductProductionJsonV2(context.derivedCommandHashes)
    || canonicalProductProductionJsonV2(evidence.issueResolutions.map(row => row.sourceIssueReceiptHash).sort())
      !== canonicalProductProductionJsonV2(expectedIssueHashes)
    || canonicalProductProductionJsonV2(evidence.lowScoreResolutions.map(row => row.criterionKey).sort())
      !== canonicalProductProductionJsonV2(expectedLow)
    || canonicalProductProductionJsonV2(evidence.sourceRelease)
      !== canonicalProductProductionJsonV2(updateReleaseBindingV1(context.sourceRelease))
    || canonicalProductProductionJsonV2(evidence.targetRelease)
      !== canonicalProductProductionJsonV2(updateReleaseBindingV1(targetRelease))
    || canonicalProductProductionJsonV2(evidence.targetTaskKeys)
      !== canonicalProductProductionJsonV2(context.targetTaskKeys)
    || canonicalProductProductionJsonV2(evidence.staleTaskKeys)
      !== canonicalProductProductionJsonV2(context.staleTaskKeys)
    || canonicalProductProductionJsonV2(actualIssueFacts) !== canonicalProductProductionJsonV2(expectedIssueFacts)
    || canonicalProductProductionJsonV2(actualLowFacts) !== canonicalProductProductionJsonV2(expectedLowFacts)
    || evidence.issueResolutions.some(row => row.targetRouteWitnessKeys.some(key => !targetRouteKeys.includes(key)))
    || evidence.lowScoreResolutions.some(row => row.targetRouteWitnessKeys.some(key => !targetRouteKeys.includes(key)))
    || evidence.compatibility.reportHash !== context.compatibility.reportHash
    || evidence.compatibility.level !== context.compatibility.level
    || evidence.compatibility.migrationPolicy !== context.compatibility.migrationPolicy
    || receipt.gateReceipt.verifierKind !== 'human-evidence'
    || !stringListsEqual(receipt.gateReceipt.inputHashes, inputHashes)
    || !stringListsEqual(receipt.gateReceipt.evidenceRefs, evidenceRefs)
    || receipt.gateReceipt.environmentHash !== null
    || receipt.gateReceipt.createdAt !== evidence.verifiedAt) fail('修复版更新验证回执与当前Release链不闭合')
  return receipt
}

async function readCalibrationReceipt(authority: BuildAuthorityV1): Promise<VerifiedReceiptV1<TextOpenWorldCreatorCalibrationEvidenceV1> | null> {
  const receipt = await latestFixedReceipt({
    authority, gateId: TEXT_OPEN_WORLD_CREATOR_CALIBRATION_GATE_ID_V1,
    verifierId: 'storyforge.creator-independent-release-calibration', policyId: CALIBRATION_POLICY_ID,
    statuses: ['passed', 'failed'], parseEvidence: parseTextOpenWorldCreatorCalibrationEvidenceV1,
  })
  if (!receipt) return null
  const evidence = receipt.evidence
  const derived = await readTextOpenWorldCreatorDerivedBuildAuthorityV1({
    scope: authority.scope, buildId: authority.build.id,
  })
  const generator = derived.contracts.start.preflight.providerBinding
  const quote = derived.contracts.start.preflight.priceQuote ?? fail('校准Build缺少冻结价格快照')
  const currentLedgerHash = await hashProductProductionValueV2(JSON.parse(authority.build.budgetLedgerJson))
  const semanticReview = acceptedArtifactPayload<TextOpenWorldSemanticReviewV1>(authority, 'text-open-world.semantic-review')
  if (!bindingEquals(evidence.build, authority.buildBinding)
    || evidence.generator.provider !== generator.provider || evidence.generator.model !== generator.model
    || evidence.generator.bindingHash !== generator.bindingHash
    || evidence.productionUsage.priceQuoteHash !== quote.quoteHash
    || evidence.productionUsage.priceQuoteSource !== quote.source
    || evidence.productionUsage.priceQuoteAsOf !== quote.asOf
    || evidence.productionUsage.ledgerHash !== currentLedgerHash
    || evidence.productionSemanticReview.reviewHash !== semanticReview.semanticReviewHash
    || canonicalProductProductionJsonV2(evidence.productionSemanticReview.scores)
      !== canonicalProductProductionJsonV2(semanticReview.scores.filter(score => (
        ['mainline-arc', 'significant-stories', 'repetition', 'duration-and-guidance'].includes(score.metricKey)
      )))
    || (evidence.independentReview.provider === evidence.generator.provider
      && evidence.independentReview.model === evidence.generator.model)
    || !plausibleRealProviderIdentity(evidence.generator.provider, evidence.generator.model)
    || !plausibleRealProviderIdentity(evidence.independentReview.provider, evidence.independentReview.model)
    || receipt.status !== (evidence.passed ? 'passed' : 'failed')
    || receipt.gateReceipt.verifierKind !== 'provider-review'
    || !stringListsEqual(receipt.gateReceipt.inputHashes, [
      authority.build.packageHash,
      acceptedArtifactHash(authority, 'text-open-world.mainline-thread'),
      acceptedArtifactHash(authority, 'text-open-world.significant-threads'),
      acceptedArtifactHash(authority, 'text-open-world.region-narrative-packs'),
      acceptedArtifactHash(authority, 'text-open-world.scene-scripts'),
      acceptedArtifactHash(authority, 'text-open-world.content-budget'),
      acceptedArtifactHash(authority, 'text-open-world.semantic-review'),
      evidence.generator.bindingHash, evidence.productionUsage.priceQuoteHash,
      evidence.productionUsage.ledgerHash, evidence.independentReview.inputHash,
      evidence.independentReview.outputHash,
    ])
    || !stringListsEqual(receipt.gateReceipt.evidenceRefs, [
      evidence.productionSemanticReview.reviewHash,
      evidence.independentReview.inputHash, evidence.independentReview.outputHash,
      evidence.productionUsage.ledgerHash,
    ])
    || receipt.gateReceipt.environmentHash !== null
    || receipt.gateReceipt.createdAt !== evidence.evaluatedAt) fail('发布校准回执与当前Build/模型/账本不闭合')
  return receipt
}

async function readSemanticDecisionReceipt(authority: BuildAuthorityV1): Promise<VerifiedReceiptV1<TextOpenWorldCreatorSemanticDecisionEvidenceV1> | null> {
  const receipt = await latestFixedReceipt({
    authority, gateId: TEXT_OPEN_WORLD_CREATOR_SEMANTIC_GATE_ID_V1,
    verifierId: 'storyforge.creator-human-quality-review', policyId: SEMANTIC_POLICY_ID,
    statuses: ['passed', 'waived'], parseEvidence: parseTextOpenWorldCreatorSemanticDecisionEvidenceV1,
  })
  if (!receipt) return null
  const expectedReviews = authority.reviews.map(review => ({
    reviewKind: review.reviewKind,
    artifactHash: review.artifactHash,
    reviewHash: review.reviewHash,
    minimumScore: review.minimumScore,
    verdict: 'pass' as const,
    findingKeys: review.findings.map(finding => finding.findingKey).sort(),
  }))
  if (!bindingEquals(receipt.evidence.build, authority.buildBinding)
    || canonicalProductProductionJsonV2(receipt.evidence.reviews) !== canonicalProductProductionJsonV2(expectedReviews)
    || receipt.status !== (receipt.evidence.decision === 'passed' ? 'passed' : 'waived')
    || receipt.gateReceipt.verifierKind !== 'human-evidence'
    || !stringListsEqual(receipt.gateReceipt.inputHashes, [
      authority.build.packageHash,
      ...authority.reviews.flatMap(review => [review.artifactHash, review.reviewHash]),
    ])
    || !stringListsEqual(receipt.gateReceipt.evidenceRefs, authority.reviews.flatMap(review => [
      review.reviewHash, ...review.findings.map(finding => finding.findingKey),
    ]))
    || receipt.gateReceipt.environmentHash !== null
    || receipt.gateReceipt.createdAt !== receipt.evidence.confirmedAt) fail('语义发布决定与当前双评审不闭合')
  const findingKeys = authority.reviews.flatMap(review => review.findings.map(finding => finding.findingKey)).sort()
  const waiverKeys = receipt.evidence.waivers.map(waiver => waiver.findingKey).sort()
  if (findingKeys.length !== waiverKeys.length || findingKeys.some((key, index) => key !== waiverKeys[index])) {
    fail('语义发布决定未逐项覆盖当前建议finding')
  }
  return receipt
}

async function readReleaseQualityReceipt(input: {
  authority: BuildAuthorityV1
  hardReceipt: VerifiedReceiptV1<TextOpenWorldCreatorHardGateEvidenceV1> | null
  calibrationReceipt: VerifiedReceiptV1<TextOpenWorldCreatorCalibrationEvidenceV1> | null
  semanticReceipt: VerifiedReceiptV1<TextOpenWorldCreatorSemanticDecisionEvidenceV1> | null
  grayboxReceipt: VerifiedReceiptV1<TextOpenWorldCreatorGrayboxEvidenceV1> | null
  issueSet: Awaited<ReturnType<typeof currentIssueSet>>
}): Promise<VerifiedReceiptV1<TextOpenWorldCreatorReleaseQualityEvidenceV1> | null> {
  const receipt = await latestFixedReceipt({
    authority: input.authority, gateId: TEXT_OPEN_WORLD_CREATOR_RELEASE_QUALITY_GATE_ID_V1,
    verifierId: 'storyforge.creator-release-quality-join', policyId: RELEASE_QUALITY_POLICY_ID,
    statuses: ['passed'], parseEvidence: parseTextOpenWorldCreatorReleaseQualityEvidenceV1,
  })
  if (!receipt || !input.hardReceipt || !input.calibrationReceipt
    || input.calibrationReceipt.status !== 'passed' || !input.semanticReceipt || !input.grayboxReceipt) return null
  const evidence = receipt.evidence
  if (!bindingEquals(evidence.build, input.authority.buildBinding)
    || evidence.hardGateReceiptHash !== input.hardReceipt.receiptHash
    || evidence.semanticDecisionReceiptHash !== input.semanticReceipt.receiptHash
    || evidence.grayboxReceiptHash !== input.grayboxReceipt.receiptHash
    || canonicalProductProductionJsonV2(evidence.issueReceiptHashes) !== canonicalProductProductionJsonV2(input.issueSet.issueReceiptHashes)
    || canonicalProductProductionJsonV2(evidence.issueWaiverReceiptHashes) !== canonicalProductProductionJsonV2(input.issueSet.issueWaiverReceiptHashes)
    || evidence.issueSetHash !== input.issueSet.issueSetHash
    || receipt.gateReceipt.verifierKind !== 'deterministic'
    || !stringListsEqual(receipt.gateReceipt.inputHashes, [
      input.authority.build.packageHash, input.authority.build.previewHash,
      input.hardReceipt.receiptHash, input.calibrationReceipt.receiptHash, input.semanticReceipt.receiptHash,
      input.grayboxReceipt.receiptHash, input.issueSet.issueSetHash,
    ])
    || !stringListsEqual(receipt.gateReceipt.evidenceRefs, [
      input.hardReceipt.receiptHash, input.calibrationReceipt.receiptHash, input.semanticReceipt.receiptHash,
      input.grayboxReceipt.receiptHash, ...input.issueSet.issueReceiptHashes,
      ...input.issueSet.issueWaiverReceiptHashes,
    ])
    || receipt.gateReceipt.environmentHash !== null
    || receipt.gateReceipt.createdAt !== evidence.completedAt) return null
  return receipt
}

async function readQualityWorkspaceWithAuthority(authority: BuildAuthorityV1): Promise<{
  workspace: TextOpenWorldCreatorQualityWorkspaceV1
  internal: {
    issues: Awaited<ReturnType<typeof readIssues>>
    hardReceipt: VerifiedReceiptV1<TextOpenWorldCreatorHardGateEvidenceV1> | null
    calibrationReceipt: VerifiedReceiptV1<TextOpenWorldCreatorCalibrationEvidenceV1> | null
    semanticReceipt: VerifiedReceiptV1<TextOpenWorldCreatorSemanticDecisionEvidenceV1> | null
    grayboxReceipt: VerifiedReceiptV1<TextOpenWorldCreatorGrayboxEvidenceV1> | null
    fullPlaytestReceipt: VerifiedReceiptV1<TextOpenWorldCreatorFullPlaytestEvidenceV1> | null
    updateContext: UpdateVerificationContextV1 | null
    updateVerificationReceipt: VerifiedReceiptV1<TextOpenWorldCreatorUpdateVerificationEvidenceV1> | null
    releaseReceipt: VerifiedReceiptV1<TextOpenWorldCreatorReleaseQualityEvidenceV1> | null
    issueSet: Awaited<ReturnType<typeof currentIssueSet>>
  }
}> {
  const [grayboxCandidates, issues, calibrationState] = await Promise.all([
    listGrayboxCandidates(authority), readIssues(authority), calibrationReadiness(authority),
  ])
  const hardReceipt = await latestFixedReceipt({
    authority, gateId: TEXT_OPEN_WORLD_CREATOR_HARD_GATE_ID_V1,
    verifierId: 'storyforge.creator-deterministic-hard-gates', policyId: HARD_GATE_POLICY_ID,
    statuses: ['passed'], parseEvidence: parseTextOpenWorldCreatorHardGateEvidenceV1,
  })
  if (hardReceipt && (!bindingEquals(hardReceipt.evidence.build, authority.buildBinding)
    || hardReceipt.evidence.governanceSnapshotHash !== authority.governanceSnapshotHash
    || canonicalProductProductionJsonV2(hardReceipt.evidence.checks) !== canonicalProductProductionJsonV2(authority.hardChecks)
    || hardReceipt.gateReceipt.verifierKind !== 'deterministic'
    || !stringListsEqual(hardReceipt.gateReceipt.inputHashes, [
      authority.build.packageHash, authority.build.previewHash, authority.build.manifestHash,
      authority.build.qualityReportHash, authority.buildBinding.rootTerminalReceiptHash,
      authority.governanceSnapshotHash,
    ])
    || !stringListsEqual(hardReceipt.gateReceipt.evidenceRefs,
      authority.hardChecks.flatMap(check => check.evidenceHashes))
    || hardReceipt.gateReceipt.environmentHash !== null
    || hardReceipt.gateReceipt.createdAt !== hardReceipt.evidence.evaluatedAt)) {
    fail('硬门回执与当前治理快照不闭合')
  }
  const [calibrationReceipt, semanticReceipt, grayboxReceipt] = await Promise.all([
    readCalibrationReceipt(authority), readSemanticDecisionReceipt(authority), readGrayboxReceipt(authority),
  ])
  const issueSet = await currentIssueSet(issues)
  const fullPlaytestReceipt = await readFullPlaytestReceipt({ authority, calibrationReceipt, issueSet })
  const updateState = await updateVerificationContextV1({
    authority, targetFullPlaytest: fullPlaytestReceipt,
  })
  const updateVerificationReceipt = await readUpdateVerificationReceipt({
    authority, context: updateState.context,
  })
  const releaseReceipt = await readReleaseQualityReceipt({
    authority, hardReceipt, calibrationReceipt, semanticReceipt, grayboxReceipt, issueSet,
  })
  const modelFindings = authority.reviews.flatMap(review => review.findings)
  const blockers: string[] = []
  if (authority.hardChecks.some(check => !check.passed)) blockers.push('存在未通过且不可豁免的代码硬门')
  if (authority.reviews.some(review => review.verdict !== 'pass')) blockers.push('平衡或叙事模型评审仍要求新Build修复')
  if (!calibrationReceipt) blockers.push(calibrationState.readiness.ready
    ? '尚未运行当前Build的独立叙事、重复度、时长与成本校准'
    : `独立校准尚未就绪：${calibrationState.readiness.issue}`)
  else if (calibrationReceipt.status !== 'passed') blockers.push('独立校准未达到发布线，必须根据finding创建新Build修复')
  if (!grayboxReceipt) blockers.push('尚无当前Build的完整隔离灰盒试玩回执')
  if (!semanticReceipt) blockers.push(modelFindings.length
    ? '模型建议项尚未逐项说明软豁免并完成作者质量复核'
    : '尚未完成作者叙事、玩法、媒资和可访问性复核')
  const blockingIssues = issues.filter(row => row.issue.evidence.severity === 'blocking')
  const unwaivedAdvisories = issues.filter(row => row.issue.evidence.severity === 'advisory' && !row.waiver)
  if (blockingIssues.length) blockers.push(`${blockingIssues.length}个阻断问题只能通过新Build修复`)
  if (unwaivedAdvisories.length) blockers.push(`${unwaivedAdvisories.length}个非阻断问题尚未说明软豁免`)
  if (!releaseReceipt && blockers.length === 0) blockers.push('所有证据已齐，请冻结当前Build的发布质量结论')
  return {
    workspace: {
      schema: 'storyforge.text-open-world-creator-quality-workspace', version: 1,
      productionId: authority.production.id, buildId: authority.build.id,
      build: authority.buildBinding, buildStatus: authority.build.status,
      governanceSnapshotHash: authority.governanceSnapshotHash,
      hardChecks: structuredClone(authority.hardChecks),
      hardGatesPassed: authority.hardChecks.every(check => check.passed),
      reviews: structuredClone(authority.reviews), modelFindings: structuredClone(modelFindings),
      calibrationReadiness: structuredClone(calibrationState.readiness),
      calibrationReceipt: publicReceipt(calibrationReceipt),
      grayboxCandidates, grayboxReceipt: publicReceipt(grayboxReceipt),
      fullPlaytestReceipt: publicReceipt(fullPlaytestReceipt),
      updateVerificationReadiness: structuredClone(updateState.readiness),
      updateVerificationReceipt: publicReceipt(updateVerificationReceipt),
      issues: issues.map(row => ({
        receipt: publicReceipt(row.issue)!, waiver: publicReceipt(row.waiver),
        blocksRelease: row.issue.evidence.severity === 'blocking' || !row.waiver,
        portableJson: row.issue.gateReceipt.measuredJson,
      })),
      semanticDecisionReceipt: publicReceipt(semanticReceipt),
      releaseQualityReceipt: publicReceipt(releaseReceipt),
      releaseQualityReady: releaseReceipt != null,
      blockers,
    },
    internal: {
      issues, hardReceipt, calibrationReceipt, semanticReceipt, grayboxReceipt,
      fullPlaytestReceipt, updateContext: updateState.context, updateVerificationReceipt,
      releaseReceipt, issueSet,
    },
  }
}

export async function readTextOpenWorldCreatorQualityWorkspaceV1(input: {
  scope: WorkspaceScope
  productionId: number
  expectedBuildId?: number
}): Promise<TextOpenWorldCreatorQualityWorkspaceV1> {
  const authority = await loadBuildAuthority(input)
  return (await readQualityWorkspaceWithAuthority(authority)).workspace
}

export async function recordTextOpenWorldCreatorCalibrationV1(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  signal?: AbortSignal
}, dependencies: {
  runReview?: typeof runTextOpenWorldCreatorIndependentCalibrationReviewV1
  now?: () => number
} = {}): Promise<TextOpenWorldCreatorQualityReceiptV1<TextOpenWorldCreatorCalibrationEvidenceV1>> {
  const authority = await loadBuildAuthority({
    scope: input.scope, productionId: input.productionId, expectedBuildId: input.buildId,
  })
  const state = await calibrationReadiness(authority)
  if (!state.readiness.ready) fail(state.readiness.issue ?? '独立校准尚未就绪')
  const [progress, mainline, significant, regions, scenes, contentBudget, semanticReview] = await Promise.all([
    projectProductProductionSchedulerV1({ scope: authority.scope, productionId: authority.production.id }),
    Promise.resolve(acceptedArtifactPayload<TextOpenWorldMainlineThreadV1>(authority, 'text-open-world.mainline-thread')),
    Promise.resolve(acceptedArtifactPayload<TextOpenWorldSignificantThreadsV1>(authority, 'text-open-world.significant-threads')),
    Promise.resolve(acceptedArtifactPayload<TextOpenWorldRegionNarrativePacksV1>(authority, 'text-open-world.region-narrative-packs')),
    Promise.resolve(acceptedArtifactPayload<TextOpenWorldSceneScriptsV1>(authority, 'text-open-world.scene-scripts')),
    Promise.resolve(acceptedArtifactPayload<TextOpenWorldContentBudgetV1>(authority, 'text-open-world.content-budget')),
    Promise.resolve(acceptedArtifactPayload<TextOpenWorldSemanticReviewV1>(authority, 'text-open-world.semantic-review')),
  ])
  if (progress.buildId !== authority.build.id) fail('生产账本不再指向当前Build，不能冻结校准')
  const context: TextOpenWorldCreatorCalibrationReviewContextV1 = buildTextOpenWorldCreatorCalibrationContextV1({
    buildPackageHash: authority.build.packageHash, mainline, significant, regions, scenes, contentBudget,
  })
  const independentReview = await (dependencies.runReview ?? runTextOpenWorldCreatorIndependentCalibrationReviewV1)({
    projectId: authority.scope.projectId, config: state.graderConfig,
    frozenResolution: state.graderResolution, context, signal: input.signal,
  })
  if (independentReview.provider !== state.readiness.grader.provider
    || independentReview.model !== state.readiness.grader.model) fail('独立grader返回身份与冻结路由不一致')
  const templateDifferentiation = projectTextOpenWorldTemplateDifferentiationV1({ regions, scenes })
  const contentDuration = projectTextOpenWorldContentDurationV1(contentBudget)
  const quote = (await readTextOpenWorldCreatorDerivedBuildAuthorityV1({
    scope: authority.scope, buildId: authority.build.id,
  })).contracts.start.preflight.priceQuote ?? fail('Creator生产缺少冻结价格快照')
  const usage = progress.budget.usage
  const estimatedTextCostUsd = usage.inputTokens / 1_000_000 * quote.inputUsdPerMillionTokens
    + usage.outputTokens / 1_000_000 * quote.outputUsdPerMillionTokens
  const durations = textCallDurations(authority.build.budgetLedgerJson)
  const ledgerHash = await hashProductProductionValueV2(JSON.parse(authority.build.budgetLedgerJson))
  const productionUsage: TextOpenWorldCreatorCalibrationEvidenceV1['productionUsage'] = {
    ledgerHash, modelCalls: usage.modelCalls, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
    totalDurationMs: usage.durationMs,
    averageCallDurationMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0,
    p95CallDurationMs: percentile(durations, 0.95), maximumCallDurationMs: durations[durations.length - 1] ?? 0,
    estimatedTextCostUsd, priceQuoteHash: quote.quoteHash, priceQuoteSource: quote.source,
    priceQuoteAsOf: quote.asOf, budgetMaximumCalls: progress.budget.limits.maximumModelCalls,
    budgetMaximumInputTokens: progress.budget.limits.maximumInputTokens,
    budgetMaximumOutputTokens: progress.budget.limits.maximumOutputTokens,
    budgetMaximumDurationMs: progress.budget.limits.maximumDurationMs,
    budgetMaximumCostUsd: progress.budget.limits.maximumCostUsd ?? fail('Creator生产预算必须冻结费用上限'),
  }
  const semanticMetrics = new Set(['mainline-arc', 'significant-stories', 'repetition', 'duration-and-guidance'])
  const productionSemanticScores = semanticReview.scores.filter(score => semanticMetrics.has(score.metricKey))
  if (productionSemanticScores.length !== semanticMetrics.size) fail('正式语义评审缺少G7-11所需指标')
  const checks: TextOpenWorldCreatorCalibrationEvidenceV1['checks'] = [
    {
      key: 'real-independent-provider-identities', passed: state.readiness.ready,
      summary: `生成器 ${state.readiness.generator.provider}/${state.readiness.generator.model}；独立评审 ${state.readiness.grader.provider}/${state.readiness.grader.model}。`,
    },
    {
      key: 'production-semantic-release-line',
      passed: productionSemanticScores.every(score => score.score >= 70),
      summary: `正式语义评审四项最低 ${Math.min(...productionSemanticScores.map(score => score.score))} 分。`,
    },
    {
      key: 'independent-narrative-release-line',
      passed: independentReview.scores.every(score => score.score >= 70),
      summary: `独立复评三项最低 ${Math.min(...independentReview.scores.map(score => score.score))} 分。`,
    },
    {
      key: 'three-distinct-variants-per-template',
      passed: templateDifferentiation.templateCount > 0
        && templateDifferentiation.minimumVariantsPerTemplate >= 3
        && templateDifferentiation.exactDuplicateTitleCount === 0
        && templateDifferentiation.exactDuplicateDescriptionCount === 0
        && templateDifferentiation.maximumPairSimilarityBasisPoints <= 8_500,
      summary: `${templateDifferentiation.templateCount}个模板/${templateDifferentiation.variantCount}个变体；最少${templateDifferentiation.minimumVariantsPerTemplate}份，最大文本相似度${(templateDifferentiation.maximumPairSimilarityBasisPoints / 100).toFixed(1)}%。`,
    },
    {
      key: 'authored-duration-inventory',
      passed: contentDuration.mainlineMinutes >= contentDuration.requestedMainlineMinimum
        && contentDuration.mainlineMinutes <= contentDuration.requestedMainlineMaximum
        && contentDuration.optionalInventoryMinutes >= contentDuration.requestedOptionalMinimum
        && contentDuration.optionalInventoryMinutes <= contentDuration.requestedOptionalMaximum
        && contentDuration.totalAuthoredMinutes >= contentDuration.typicalPlaythroughMinutes,
      summary: `主线${contentDuration.mainlineMinutes}分钟、可选库存${contentDuration.optionalInventoryMinutes}分钟、总创作库存${contentDuration.totalAuthoredMinutes}分钟；均为结构估算，不冒充真人时长。`,
    },
    {
      key: 'production-call-usage-observed',
      passed: usage.modelCalls > 0 && usage.inputTokens > 0 && usage.outputTokens > 0
        && durations.length === usage.modelCalls,
      summary: `${usage.modelCalls}次模型调用，输入${usage.inputTokens}、输出${usage.outputTokens} tokens；平均${productionUsage.averageCallDurationMs}ms，P95 ${productionUsage.p95CallDurationMs}ms。`,
    },
    {
      key: 'production-budget-and-cost',
      passed: usage.modelCalls <= productionUsage.budgetMaximumCalls
        && usage.inputTokens <= productionUsage.budgetMaximumInputTokens
        && usage.outputTokens <= productionUsage.budgetMaximumOutputTokens
        && usage.durationMs <= productionUsage.budgetMaximumDurationMs
        && estimatedTextCostUsd <= productionUsage.budgetMaximumCostUsd,
      summary: `按冻结${quote.source}价格快照估算文本费用$${estimatedTextCostUsd.toFixed(4)}；这不是供应商账单。`,
    },
  ]
  const evaluatedAt = Math.max(1, Math.round((dependencies.now ?? Date.now)()))
  const evidence = parseTextOpenWorldCreatorCalibrationEvidenceV1({
    schema: 'storyforge.text-open-world-creator-calibration-evidence', version: 1,
    build: authority.buildBinding,
    generator: {
      provider: state.generator.provider, model: state.generator.model,
      bindingHash: state.generator.bindingHash,
    },
    independentReview,
    productionSemanticReview: {
      reviewHash: semanticReview.semanticReviewHash,
      scores: productionSemanticScores.map(score => ({ ...score })),
    },
    templateDifferentiation, contentDuration, productionUsage, checks,
    passed: checks.every(check => check.passed), evaluatedAt,
  })
  const receipt = await createGateReceipt({
    gateId: TEXT_OPEN_WORLD_CREATOR_CALIBRATION_GATE_ID_V1,
    verifierId: 'storyforge.creator-independent-release-calibration', verifierKind: 'provider-review',
    inputHashes: [
      authority.build.packageHash,
      acceptedArtifactHash(authority, 'text-open-world.mainline-thread'),
      acceptedArtifactHash(authority, 'text-open-world.significant-threads'),
      acceptedArtifactHash(authority, 'text-open-world.region-narrative-packs'),
      acceptedArtifactHash(authority, 'text-open-world.scene-scripts'),
      acceptedArtifactHash(authority, 'text-open-world.content-budget'),
      acceptedArtifactHash(authority, 'text-open-world.semantic-review'),
      evidence.generator.bindingHash, evidence.productionUsage.priceQuoteHash,
      evidence.productionUsage.ledgerHash, evidence.independentReview.inputHash,
      evidence.independentReview.outputHash,
    ],
    environmentHash: null, evidence, status: evidence.passed ? 'passed' : 'failed',
    policyId: CALIBRATION_POLICY_ID,
    evidenceRefs: [
      evidence.productionSemanticReview.reviewHash,
      evidence.independentReview.inputHash, evidence.independentReview.outputHash,
      evidence.productionUsage.ledgerHash,
    ],
    createdAt: evaluatedAt,
  })
  const pending = pendingReceiptRow(authority, receipt)
  const stored = await db.transaction('rw', scopeTransactionTables(
    db.productProductions, db.productProductionBriefs, db.productBuilds,
    db.productBuildArtifacts, db.productQualityGateReceipts,
  ), async () => {
    await assertAuthorityRowsUnchangedInTransaction(authority)
    const existing = await db.productQualityGateReceipts
      .where('[buildId+gateId+receiptHash]').equals([authority.build.id, receipt.gateId, receipt.receiptHash]).first()
    if (existing?.id != null) return existing as ProductQualityGateReceiptRecordV1 & { id: number }
    const id = await db.productQualityGateReceipts.add(pending) as number
    return { ...pending, id }
  })
  const verified = await verifyGenericReceiptRow({
    row: stored, authority, gateId: TEXT_OPEN_WORLD_CREATOR_CALIBRATION_GATE_ID_V1,
    verifierId: 'storyforge.creator-independent-release-calibration', policyId: CALIBRATION_POLICY_ID,
    statuses: ['passed', 'failed'], parseEvidence: parseTextOpenWorldCreatorCalibrationEvidenceV1,
  })
  return publicReceipt(verified)!
}

export async function recordTextOpenWorldCreatorGrayboxV1(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  sessionIds: number[]
  environment: TextOpenWorldCreatorGrayboxEnvironmentV1
  humanChecks: TextOpenWorldCreatorGrayboxHumanChecksV1
  authorNote: string
}): Promise<TextOpenWorldCreatorQualityReceiptV1<TextOpenWorldCreatorGrayboxEvidenceV1>> {
  const authority = await loadBuildAuthority({ scope: input.scope, productionId: input.productionId, expectedBuildId: input.buildId })
  const sessionIds = [...new Set(input.sessionIds)]
  if (sessionIds.length !== input.sessionIds.length || sessionIds.length < 1 || sessionIds.length > 6
    || sessionIds.some(id => !Number.isInteger(id) || id < 1)) fail('灰盒Session选择无效')
  const sessionRows = await db.productRuntimeSessions.bulkGet(sessionIds)
  if (sessionRows.some(row => !row || row.id == null)) fail('灰盒Session不存在')
  const witnesses = await Promise.all(sessionRows.map(row => createSessionWitness({
    authority, session: row as ProductRuntimeSession & { id: number },
  })))
  const combinedCoverageKeys = [...new Set(witnesses.flatMap(row => row.candidate.coverageKeys))].sort()
  const missing = TEXT_OPEN_WORLD_CREATOR_GRAYBOX_COVERAGE_KEYS_V1.filter(key => !combinedCoverageKeys.includes(key))
  if (missing.length) fail(`灰盒试玩未覆盖首版标准路径:${missing.join(',')}`)
  if (!witnesses.some(row => row.candidate.completed)) fail('灰盒试玩至少需要一个已完成主线的Session')
  const confirmedAt = Math.max(Date.now(), ...witnesses.map(row => row.candidate.updatedAt))
  const evidence = parseTextOpenWorldCreatorGrayboxEvidenceV1({
    schema: 'storyforge.text-open-world-creator-graybox-evidence', version: 1,
    build: authority.buildBinding,
    sessions: witnesses.map(row => row.candidate.witness).sort((left, right) => left.sessionWitnessKey.localeCompare(right.sessionWitnessKey)),
    combinedCoverageKeys,
    environment: input.environment,
    humanChecks: input.humanChecks,
    authorNote: input.authorNote.trim(),
    confirmedAt,
  })
  const receipt = await createGateReceipt({
    gateId: TEXT_OPEN_WORLD_CREATOR_GRAYBOX_GATE_ID_V1,
    verifierId: 'storyforge.creator-graybox-playtest', verifierKind: 'human-evidence',
    inputHashes: [authority.build.packageHash, authority.build.previewHash,
      ...evidence.sessions.map(session => session.eventStreamHash)],
    environmentHash: await hashProductProductionValueV2(evidence.environment),
    evidence, status: 'passed', policyId: GRAYBOX_POLICY_ID,
    evidenceRefs: evidence.sessions.flatMap(session => [session.currentStateHash, session.eventStreamHash, ...session.checkpointStateHashes]),
    createdAt: confirmedAt,
  })
  const pending = pendingReceiptRow(authority, receipt)
  const stored = await db.transaction('rw', scopeTransactionTables(
    db.productProductions, db.productProductionBriefs, db.productBuilds, db.productBuildArtifacts,
    db.productRuntimeSessions, db.productRuntimeEvents, db.productRuntimeCheckpoints,
    db.productQualityGateReceipts,
  ), async () => {
    await assertAuthorityRowsUnchangedInTransaction(authority)
    for (const [index, witness] of witnesses.entries()) {
      const session = await db.productRuntimeSessions.get(sessionIds[index]!)
      const events = await db.productRuntimeEvents.where('sessionId').equals(sessionIds[index]!).toArray()
      const checkpoints = await db.productRuntimeCheckpoints.where('sessionId').equals(sessionIds[index]!).toArray()
      if (!session || canonicalRows([session]) !== witness.sessionRowJson
        || canonicalRows(events) !== witness.eventRowsJson
        || canonicalRows(checkpoints) !== witness.checkpointRowsJson) fail('灰盒Session证据在写入前变化')
    }
    const existing = await db.productQualityGateReceipts
      .where('[buildId+gateId+receiptHash]').equals([authority.build.id, receipt.gateId, receipt.receiptHash]).first()
    if (existing?.id != null) return existing as ProductQualityGateReceiptRecordV1 & { id: number }
    const id = await db.productQualityGateReceipts.add(pending) as number
    return { ...pending, id }
  })
  return publicReceipt(await verifyGenericReceiptRow({
    row: stored, authority, gateId: TEXT_OPEN_WORLD_CREATOR_GRAYBOX_GATE_ID_V1,
    verifierId: 'storyforge.creator-graybox-playtest', policyId: GRAYBOX_POLICY_ID,
    statuses: ['passed'], parseEvidence: parseTextOpenWorldCreatorGrayboxEvidenceV1,
  }))!
}

export async function recordTextOpenWorldCreatorFullPlaytestV1(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  routes: Array<{ sessionId: number; reportedActiveMinutes: number }>
  environment: TextOpenWorldCreatorGrayboxEnvironmentV1
  humanChecks: TextOpenWorldCreatorFullPlaytestHumanChecksV1
  assessments: TextOpenWorldCreatorFullPlaytestAssessmentV1[]
  costObservation: {
    source: 'provider-dashboard' | 'not-available'
    runtimeCostUsd: number | null
    note: string
  }
  authorNote: string
}): Promise<TextOpenWorldCreatorQualityReceiptV1<TextOpenWorldCreatorFullPlaytestEvidenceV1>> {
  const authority = await loadBuildAuthority({
    scope: input.scope, productionId: input.productionId, expectedBuildId: input.buildId,
  })
  const sessionIds = input.routes.map(route => route.sessionId)
  if (new Set(sessionIds).size !== sessionIds.length || sessionIds.length < 2 || sessionIds.length > 6
    || sessionIds.some(id => !Number.isInteger(id) || id < 1)) fail('完整试玩路线选择无效')
  const sessionRows = await db.productRuntimeSessions.bulkGet(sessionIds)
  if (sessionRows.some(row => !row || row.id == null)) fail('完整试玩Session不存在')
  const witnesses = await Promise.all(sessionRows.map(row => createSessionWitness({
    authority, session: row as ProductRuntimeSession & { id: number },
  })))
  if (witnesses.some(row => !row.candidate.completed || !row.candidate.endingKey)) {
    fail('完整试玩的每条路线都必须真正完成主线')
  }
  const endingKeys = [...new Set(witnesses.map(row => row.candidate.endingKey!))].sort()
  if (endingKeys.length < 2) fail('完整试玩必须覆盖至少两个不同结局')
  const combinedCoverageKeys = [...new Set(witnesses.flatMap(row => row.candidate.coverageKeys))].sort()
  const missing = TEXT_OPEN_WORLD_CREATOR_GRAYBOX_COVERAGE_KEYS_V1.filter(key => !combinedCoverageKeys.includes(key))
  if (missing.length) fail(`完整试玩未覆盖首版标准路径:${missing.join(',')}`)
  const runtimeAiCapture = await captureFullPlaytestRuntimeAIV1(authority, sessionIds)
  const quality = await readQualityWorkspaceWithAuthority(authority)
  const qualityReceiptRowsJson = canonicalRows(
    await db.productQualityGateReceipts.where('buildId').equals(authority.build.id).toArray(),
  )
  const calibrationReceipt = quality.internal.calibrationReceipt
  if (!calibrationReceipt || calibrationReceipt.status !== 'passed') {
    fail('完整试玩必须绑定当前Build已通过的真实独立模型校准回执')
  }
  const blocksRepair = quality.internal.issues.some(row => (
    row.issue.evidence.severity === 'blocking'
      || (row.issue.evidence.severity === 'advisory' && !row.waiver)
  ))
  const routeMinutes = new Map(input.routes.map(route => [route.sessionId, route.reportedActiveMinutes]))
  const confirmedAt = Math.max(Date.now(), ...witnesses.map(row => row.candidate.updatedAt))
  const issueReceiptHashes = quality.internal.issueSet.issueReceiptHashes
  const provisionalOutcome = blocksRepair || input.assessments.some(assessment => assessment.rating < 3)
    ? 'repair-required' : 'accepted'
  const evidence = parseTextOpenWorldCreatorFullPlaytestEvidenceV1({
    schema: 'storyforge.text-open-world-creator-full-playtest-evidence', version: 1,
    build: authority.buildBinding,
    routes: witnesses.map(row => ({
      session: row.candidate.witness,
      reportedActiveMinutes: routeMinutes.get(row.candidate.sessionId),
    })).sort((left, right) => left.session.sessionWitnessKey.localeCompare(right.session.sessionWitnessKey)),
    endingKeys, combinedCoverageKeys, runtimeAi: runtimeAiCapture.evidence,
    calibrationReceiptHash: calibrationReceipt.receiptHash,
    costObservation: input.costObservation, assessments: input.assessments,
    environment: input.environment, humanChecks: input.humanChecks,
    issueReceiptHashes, issueSetHash: quality.internal.issueSet.issueSetHash,
    authorNote: input.authorNote.trim(), outcome: provisionalOutcome, confirmedAt,
  })
  const status: ProductQualityGateReceiptStatusV1 = evidence.outcome === 'accepted' ? 'passed' : 'needs-human'
  const receipt = await createGateReceipt({
    gateId: TEXT_OPEN_WORLD_CREATOR_FULL_PLAYTEST_GATE_ID_V1,
    verifierId: 'storyforge.creator-full-human-playtest', verifierKind: 'human-evidence',
    inputHashes: [
      authority.build.packageHash, authority.build.previewHash, calibrationReceipt.receiptHash,
      evidence.issueSetHash, evidence.runtimeAi.evidenceHash,
      ...evidence.routes.map(route => route.session.eventStreamHash),
    ],
    environmentHash: await hashProductProductionValueV2(evidence.environment),
    evidence, status, policyId: FULL_PLAYTEST_POLICY_ID,
    evidenceRefs: [
      calibrationReceipt.receiptHash, evidence.runtimeAi.evidenceHash, ...evidence.issueReceiptHashes,
      ...evidence.routes.flatMap(route => [
        route.session.currentStateHash, route.session.eventStreamHash,
        ...route.session.checkpointStateHashes,
      ]),
    ],
    createdAt: confirmedAt,
  })
  const pending = pendingReceiptRow(authority, receipt)
  const stored = await db.transaction('rw', scopeTransactionTables(
    db.productProductions, db.productProductionBriefs, db.productBuilds, db.productBuildArtifacts,
    db.productRuntimeSessions, db.productRuntimeEvents, db.productRuntimeCheckpoints,
    db.agentRuns, db.agentRunEvents, db.productQualityGateReceipts,
  ), async () => {
    await assertAuthorityRowsUnchangedInTransaction(authority)
    const currentQualityReceiptRows = await db.productQualityGateReceipts
      .where('buildId').equals(authority.build.id).toArray()
    if (canonicalRows(currentQualityReceiptRows) !== qualityReceiptRowsJson) {
      fail('完整试玩写入前校准或问题回执集合已经变化')
    }
    for (const [index, witness] of witnesses.entries()) {
      const session = await db.productRuntimeSessions.get(sessionIds[index]!)
      const events = await db.productRuntimeEvents.where('sessionId').equals(sessionIds[index]!).toArray()
      const checkpoints = await db.productRuntimeCheckpoints.where('sessionId').equals(sessionIds[index]!).toArray()
      if (!session || canonicalRows([session]) !== witness.sessionRowJson
        || canonicalRows(events) !== witness.eventRowsJson
        || canonicalRows(checkpoints) !== witness.checkpointRowsJson) fail('完整试玩Session证据在写入前变化')
    }
    const runRows = (await Promise.all(sessionIds.map(sessionId => (
      db.agentRuns.where('productRuntimeSessionId').equals(sessionId).toArray()
    )))).flat()
    const eventRows = (await Promise.all(runRows.map(run => (
      db.agentRunEvents.where('runId').equals(run.id!).toArray()
    )))).flat()
    if (canonicalRows(runRows) !== runtimeAiCapture.runRowsJson
      || canonicalRows(eventRows) !== runtimeAiCapture.eventRowsJson) fail('完整试玩运行时AI证据在写入前变化')
    const existing = await db.productQualityGateReceipts
      .where('[buildId+gateId+receiptHash]').equals([authority.build.id, receipt.gateId, receipt.receiptHash]).first()
    if (existing?.id != null) return existing as ProductQualityGateReceiptRecordV1 & { id: number }
    const id = await db.productQualityGateReceipts.add(pending) as number
    return { ...pending, id }
  })
  return publicReceipt(await verifyGenericReceiptRow({
    row: stored, authority, gateId: TEXT_OPEN_WORLD_CREATOR_FULL_PLAYTEST_GATE_ID_V1,
    verifierId: 'storyforge.creator-full-human-playtest', policyId: FULL_PLAYTEST_POLICY_ID,
    statuses: ['passed', 'needs-human'], parseEvidence: parseTextOpenWorldCreatorFullPlaytestEvidenceV1,
  }))!
}

export async function recordTextOpenWorldCreatorUpdateVerificationV1(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  sourceSessionId: number
  saveMode: TextOpenWorldCreatorUpdateVerificationEvidenceV1['saveWitness']['mode']
  migratedSessionId?: number | null
  issueResolutions: Array<{
    sourceIssueReceiptHash: string
    targetRouteWitnessKeys: string[]
    verificationNote: string
  }>
  lowScoreResolutions: Array<{
    criterionKey: TextOpenWorldCreatorUpdateLowScoreResolutionV1['criterionKey']
    targetRouteWitnessKeys: string[]
    verificationNote: string
  }>
  humanChecks: TextOpenWorldCreatorUpdateVerificationHumanChecksV1
  authorNote: string
}): Promise<TextOpenWorldCreatorQualityReceiptV1<TextOpenWorldCreatorUpdateVerificationEvidenceV1>> {
  const authority = await loadBuildAuthority({
    scope: input.scope, productionId: input.productionId, expectedBuildId: input.buildId,
  })
  if (authority.build.sourceProductReleaseId == null || authority.build.status !== 'released') {
    fail('只有已正式发布的Creator修复Build可以记录更新验证')
  }
  const quality = await readQualityWorkspaceWithAuthority(authority)
  if (quality.internal.updateVerificationReceipt) return publicReceipt(quality.internal.updateVerificationReceipt)!
  const context = quality.internal.updateContext
  if (!context?.targetRelease || !context.targetFullPlaytest
    || !quality.workspace.updateVerificationReadiness.ready) {
    fail(`修复版更新验证尚未就绪:${quality.workspace.updateVerificationReadiness.issue ?? '证据不完整'}`)
  }
  const targetRouteKeys = context.targetFullPlaytest.evidence.routes
    .map(row => row.session.sessionWitnessKey).sort()
  const routeSet = new Set(targetRouteKeys)
  const requestedIssues = new Map(input.issueResolutions.map(row => [row.sourceIssueReceiptHash, row]))
  const expectedIssueHashes = context.repairIssues.map(row => row.issue.receiptHash).sort()
  if (requestedIssues.size !== input.issueResolutions.length
    || requestedIssues.size !== expectedIssueHashes.length
    || expectedIssueHashes.some(hash => !requestedIssues.has(hash))) {
    fail('更新验证必须逐项覆盖源版本全部未闭合问题')
  }
  const requestedLowScores = new Map(input.lowScoreResolutions.map(row => [row.criterionKey, row]))
  const expectedLowKeys = context.sourceLowScores.map(row => row.criterionKey).sort()
  if (requestedLowScores.size !== input.lowScoreResolutions.length
    || requestedLowScores.size !== expectedLowKeys.length
    || expectedLowKeys.some(key => !requestedLowScores.has(key))) {
    fail('更新验证必须逐项覆盖源版本全部低分项')
  }
  for (const row of [...input.issueResolutions, ...input.lowScoreResolutions]) {
    if (!row.targetRouteWitnessKeys.length
      || row.targetRouteWitnessKeys.some(key => !routeSet.has(key))) {
      fail('每项修复结论必须绑定修复版完整试玩中的真实路线')
    }
  }
  const sourceSession = context.sourceSessions.find(row => row.id === input.sourceSessionId)
    ?? fail('选择的旧存档不属于源Release')
  let sourceSave: ReleaseSaveCaptureV1
  let targetSave: ReleaseSaveCaptureV1 | null = null
  let migrationPreviewHash: string | null = null
  if (input.saveMode === 'continued-on-source-release') {
    if (input.migratedSessionId != null) fail('继续固定旧版本时不能同时选择迁移子存档')
    sourceSave = await captureReleaseSaveV1({
      scope: authority.scope, release: context.sourceRelease, session: sourceSession,
    })
  } else if (input.saveMode === 'explicit-migration-child') {
    if (context.compatibility.level !== 'compatible' || input.migratedSessionId == null) {
      fail('只有兼容更新和已创建的显式迁移子存档可以验证迁移')
    }
    const child = context.migratedSessions.find(row => row.id === input.migratedSessionId
      && row.parentSessionId === sourceSession.id) ?? fail('迁移子存档与所选源存档不闭合')
    const throughSequence = child.parentThroughSequence ?? fail('迁移子存档缺少源分支序号')
    sourceSave = await captureReleaseSaveV1({
      scope: authority.scope, release: context.sourceRelease, session: sourceSession, throughSequence,
    })
    const migration = await verifyTextOpenWorldSaveMigrationBranchV1({
      parentSession: sourceSession,
      childSession: child,
      parentRelease: context.sourceRelease.release,
      childRelease: context.targetRelease.release,
      parentManifest: context.sourceRelease.manifest,
      childManifest: context.targetRelease.manifest,
      sourceStateHash: sourceSave.stateHash,
    })
    targetSave = await captureReleaseSaveV1({
      scope: authority.scope, release: context.targetRelease, session: child,
    })
    migrationPreviewHash = migration.previewHash
  } else {
    fail('存档验证模式无效')
  }
  const verifiedAt = Date.now()
  const repairAuthorization = context.repairAuthorizations[context.repairAuthorizations.length - 1]!
  const evidence = parseTextOpenWorldCreatorUpdateVerificationEvidenceV1({
    schema: 'storyforge.text-open-world-creator-update-verification-evidence', version: 1,
    sourceBuild: buildBindingFromRow(authority.production.productionKey, context.sourceBuild),
    targetBuild: authority.buildBinding,
    sourceRelease: updateReleaseBindingV1(context.sourceRelease),
    targetRelease: updateReleaseBindingV1(context.targetRelease),
    sourceFullPlaytestReceiptHash: context.sourceFullPlaytest.receiptHash,
    targetFullPlaytestReceiptHash: context.targetFullPlaytest.receiptHash,
    repairAuthorizationHash: repairAuthorization.authorizationHash,
    impactPlanHash: repairAuthorization.impactPlanHash,
    derivedCommandHashes: context.derivedCommandHashes,
    targetTaskKeys: context.targetTaskKeys,
    staleTaskKeys: context.staleTaskKeys,
    issueResolutions: context.repairIssues.map(row => {
      const resolution = requestedIssues.get(row.issue.receiptHash)!
      return {
        sourceIssueReceiptHash: row.issue.receiptHash,
        issueKey: row.issue.evidence.issueKey,
        category: row.issue.evidence.category,
        severity: row.issue.evidence.severity,
        affectedStableKeys: row.issue.evidence.affectedStableKeys,
        targetRouteWitnessKeys: resolution.targetRouteWitnessKeys,
        verificationNote: resolution.verificationNote,
      }
    }),
    lowScoreResolutions: context.sourceLowScores.map(row => {
      const resolution = requestedLowScores.get(row.criterionKey)!
      const targetRating = context.targetFullPlaytest!.evidence.assessments
        .find(item => item.criterionKey === row.criterionKey)?.rating
      return {
        criterionKey: row.criterionKey,
        sourceRating: row.rating,
        targetRating,
        targetRouteWitnessKeys: resolution.targetRouteWitnessKeys,
        verificationNote: resolution.verificationNote,
      }
    }),
    compatibility: {
      level: context.compatibility.level,
      migrationPolicy: context.compatibility.migrationPolicy,
      reportHash: context.compatibility.reportHash,
    },
    saveWitness: {
      mode: input.saveMode,
      sourceSessionWitnessKey: sourceSave.sessionWitnessKey,
      sourceStateHash: sourceSave.stateHash,
      sourceThroughSequence: sourceSave.throughSequence,
      targetSessionWitnessKey: targetSave?.sessionWitnessKey ?? null,
      targetStateHash: targetSave?.stateHash ?? null,
      migrationPreviewHash,
    },
    humanChecks: input.humanChecks,
    authorNote: input.authorNote.trim(),
    verifiedAt,
  })
  const receipt = await createGateReceipt({
    gateId: TEXT_OPEN_WORLD_CREATOR_UPDATE_VERIFICATION_GATE_ID_V1,
    verifierId: 'storyforge.creator-release-update-verification', verifierKind: 'human-evidence',
    inputHashes: [
      context.sourceRelease.manifest.packageHash,
      authority.build.packageHash,
      context.sourceFullPlaytest.receiptHash,
      context.targetFullPlaytest.receiptHash,
      repairAuthorization.authorizationHash,
      repairAuthorization.impactPlanHash,
      ...context.derivedCommandHashes,
      context.compatibility.reportHash,
      evidence.saveWitness.sourceStateHash,
      ...(evidence.saveWitness.targetStateHash ? [evidence.saveWitness.targetStateHash] : []),
      ...(evidence.saveWitness.migrationPreviewHash ? [evidence.saveWitness.migrationPreviewHash] : []),
    ],
    environmentHash: null,
    evidence,
    status: 'passed',
    policyId: UPDATE_VERIFICATION_POLICY_ID,
    evidenceRefs: [
      context.sourceFullPlaytest.receiptHash,
      context.targetFullPlaytest.receiptHash,
      repairAuthorization.authorizationHash,
      repairAuthorization.impactPlanHash,
      ...context.derivedCommandHashes,
      context.compatibility.reportHash,
      ...expectedIssueHashes,
      ...targetRouteKeys,
      evidence.saveWitness.sourceSessionWitnessKey,
      evidence.saveWitness.sourceStateHash,
      ...(evidence.saveWitness.targetSessionWitnessKey ? [evidence.saveWitness.targetSessionWitnessKey] : []),
      ...(evidence.saveWitness.targetStateHash ? [evidence.saveWitness.targetStateHash] : []),
      ...(evidence.saveWitness.migrationPreviewHash ? [evidence.saveWitness.migrationPreviewHash] : []),
    ],
    createdAt: verifiedAt,
  })
  const pending = pendingReceiptRow(authority, receipt)
  const sourceBuildJson = canonicalRows([context.sourceBuild])
  const derivedCommandsJson = canonicalRows(authority.derivedCommandChain)
  const sourceReleaseJson = canonicalRows([context.sourceRelease.release])
  const targetReleaseJson = canonicalRows([context.targetRelease.release])
  const qualityRows = [
    context.sourceCalibration.row,
    ...(quality.internal.calibrationReceipt ? [quality.internal.calibrationReceipt.row] : []),
    context.sourceFullPlaytest.row,
    context.targetFullPlaytest.row,
    ...context.sourceIssues.flatMap(row => [row.issue.row, ...(row.waiver ? [row.waiver.row] : [])]),
    ...quality.internal.issues.flatMap(row => [row.issue.row, ...(row.waiver ? [row.waiver.row] : [])]),
  ]
  const qualityRowsJson = canonicalRows(qualityRows)
  const stored = await db.transaction('rw', scopeTransactionTables(
    db.productProductions, db.productProductionBriefs, db.productProductionCommands,
    db.productBuilds, db.productBuildArtifacts, db.productReleases,
    db.productRuntimeSessions, db.productRuntimeEvents, db.productQualityGateReceipts,
  ), async () => {
    await assertAuthorityRowsUnchangedInTransaction(authority)
    const [sourceBuild, derivedCommands, sourceRelease, targetRelease, sourceSessionCurrent] = await Promise.all([
      db.productBuilds.get(context.sourceBuild.id),
      db.productProductionCommands.bulkGet(authority.derivedCommandChain.map(row => row.id)),
      db.productReleases.get(context.sourceRelease.release.id!),
      db.productReleases.get(context.targetRelease!.release.id!),
      db.productRuntimeSessions.get(sourceSave.session.id),
    ])
    if (!sourceBuild || canonicalRows([sourceBuild]) !== sourceBuildJson
      || derivedCommands.some(row => !row)
      || canonicalRows(derivedCommands.filter((row): row is ProductProductionCommandRecordV1 => row != null))
        !== derivedCommandsJson
      || !sourceRelease || canonicalRows([sourceRelease]) !== sourceReleaseJson
      || !targetRelease || canonicalRows([targetRelease]) !== targetReleaseJson
      || !sourceSessionCurrent || canonicalRows([sourceSessionCurrent]) !== sourceSave.sessionRowJson
      || canonicalRows(await db.productRuntimeEvents.where('sessionId').equals(sourceSave.session.id).toArray())
        !== sourceSave.eventRowsJson) fail('更新验证依赖证据在写入前变化')
    if (targetSave) {
      const [targetSessionCurrent, targetEvents] = await Promise.all([
        db.productRuntimeSessions.get(targetSave.session.id),
        db.productRuntimeEvents.where('sessionId').equals(targetSave.session.id).toArray(),
      ])
      if (!targetSessionCurrent || canonicalRows([targetSessionCurrent]) !== targetSave.sessionRowJson
        || canonicalRows(targetEvents) !== targetSave.eventRowsJson) fail('迁移子存档在写入前变化')
    }
    const currentQualityRows = await db.productQualityGateReceipts.bulkGet(qualityRows.map(row => row.id))
    if (currentQualityRows.some(row => !row)
      || canonicalRows(currentQualityRows.filter((row): row is ProductQualityGateReceiptRecordV1 => row != null))
        !== qualityRowsJson) fail('更新验证质量证据在写入前变化')
    const existing = await db.productQualityGateReceipts
      .where('[buildId+gateId+receiptHash]').equals([authority.build.id, receipt.gateId, receipt.receiptHash]).first()
    if (existing?.id != null) return existing as ProductQualityGateReceiptRecordV1 & { id: number }
    const id = await db.productQualityGateReceipts.add(pending) as number
    return { ...pending, id }
  })
  const verified = await readUpdateVerificationReceipt({ authority, context })
  if (!verified || verified.row.id !== stored.id || verified.receiptHash !== receipt.receiptHash) {
    fail('修复版更新验证回执写入后复验失败')
  }
  return publicReceipt(verified)!
}

export async function recordTextOpenWorldCreatorIssueV1(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  severity: TextOpenWorldCreatorIssueSeverityV1
  category: TextOpenWorldCreatorIssueCategoryV1
  summary: string
  preconditions: string[]
  reproductionSteps: string[]
  expected: string
  actual: string
  affectedStableKeys: string[]
  sessionId?: number | null
  sourceTextExcluded: true
}): Promise<TextOpenWorldCreatorIssueRecordV1> {
  const authority = await loadBuildAuthority({ scope: input.scope, productionId: input.productionId, expectedBuildId: input.buildId })
  if (!['advisory', 'blocking'].includes(input.severity)
    || !TEXT_OPEN_WORLD_CREATOR_ISSUE_CATEGORIES_V1.includes(input.category)
    || input.sourceTextExcluded !== true) fail('问题级别、类别或来源原文声明无效')
  const summary = boundedText(input.summary, 'summary', 300, 5)
  const preconditions = boundedLines(input.preconditions, 'preconditions', 20, 500)
  const reproductionSteps = boundedLines(input.reproductionSteps, 'reproductionSteps', 30, 1_000, 1)
  const expected = boundedText(input.expected, 'expected', 2_000, 3)
  const actual = boundedText(input.actual, 'actual', 2_000, 3)
  const affectedStableKeys = boundedLines(input.affectedStableKeys, 'affectedStableKeys', 100, 200)
    .map(key => STABLE_KEY.test(key) ? key : fail(`受影响稳定键无效:${key}`)).sort()
  let runtimeWitness: TextOpenWorldCreatorIssueRuntimeWitnessV1 | null = null
  let runtimeCas: Awaited<ReturnType<typeof createSessionWitness>> | null = null
  if (input.sessionId != null) {
    const session = await db.productRuntimeSessions.get(input.sessionId)
    if (!session || session.id == null) fail('问题关联灰盒Session不存在')
    runtimeCas = await createSessionWitness({ authority, session: session as ProductRuntimeSession & { id: number } })
    runtimeWitness = {
      sessionWitnessKey: runtimeCas.candidate.witness.sessionWitnessKey,
      runtimeSourceHash: runtimeCas.candidate.witness.runtimeSourceHash,
      currentStateHash: runtimeCas.candidate.witness.currentStateHash,
      eventStreamHash: runtimeCas.candidate.witness.eventStreamHash,
      throughSequence: runtimeCas.candidate.witness.throughSequence,
    }
  }
  const issueFingerprint = await hashProductProductionValueV2({
    build: authority.buildBinding,
    severity: input.severity, category: input.category, summary, preconditions,
    reproductionSteps, expected, actual, affectedStableKeys, runtimeWitness,
  })
  const issueKey = `issue.${issueFingerprint.slice(0, 24)}`
  const gateId = `${TEXT_OPEN_WORLD_CREATOR_ISSUE_GATE_PREFIX_V1}${issueFingerprint.slice(0, 24)}`
  const priorRows = await db.productQualityGateReceipts.where('[buildId+gateId]').equals([authority.build.id, gateId]).toArray()
  for (const prior of priorRows) {
    if (prior.id == null) continue
    const parsed = await parseIssueReceipt(authority, prior as ProductQualityGateReceiptRecordV1 & { id: number })
    if (parsed.evidence.issueFingerprint === issueFingerprint) {
      return {
        receipt: publicReceipt(parsed)!, waiver: null,
        blocksRelease: true,
        portableJson: parsed.gateReceipt.measuredJson,
      }
    }
  }
  const reportedAt = Date.now()
  const evidence = parseTextOpenWorldCreatorIssueEvidenceV1({
    schema: 'storyforge.text-open-world-creator-issue-evidence', version: 1,
    build: authority.buildBinding, issueKey, issueFingerprint,
    severity: input.severity, category: input.category, summary, preconditions,
    reproductionSteps, expected, actual, affectedStableKeys, runtimeWitness,
    sourceTextExcluded: true, reportedAt,
  })
  const receipt = await createGateReceipt({
    gateId, verifierId: 'storyforge.author-issue-report', verifierKind: 'human-evidence',
    inputHashes: [authority.build.packageHash, authority.build.previewHash, issueFingerprint],
    environmentHash: null, evidence,
    status: input.severity === 'blocking' ? 'failed' : 'needs-human',
    policyId: ISSUE_POLICY_ID,
    evidenceRefs: [issueFingerprint, ...(runtimeWitness ? [runtimeWitness.eventStreamHash, runtimeWitness.currentStateHash] : [])],
    createdAt: reportedAt,
  })
  const pending = pendingReceiptRow(authority, receipt)
  const stored = await db.transaction('rw', scopeTransactionTables(
    db.productProductions, db.productProductionBriefs, db.productBuilds, db.productBuildArtifacts,
    db.productRuntimeSessions, db.productRuntimeEvents, db.productRuntimeCheckpoints,
    db.productQualityGateReceipts,
  ), async () => {
    await assertAuthorityRowsUnchangedInTransaction(authority)
    if (runtimeCas && input.sessionId != null) {
      const [session, events, checkpoints] = await Promise.all([
        db.productRuntimeSessions.get(input.sessionId),
        db.productRuntimeEvents.where('sessionId').equals(input.sessionId).toArray(),
        db.productRuntimeCheckpoints.where('sessionId').equals(input.sessionId).toArray(),
      ])
      if (!session || canonicalRows([session]) !== runtimeCas.sessionRowJson
        || canonicalRows(events) !== runtimeCas.eventRowsJson
        || canonicalRows(checkpoints) !== runtimeCas.checkpointRowsJson) fail('问题关联Session在写入前变化')
    }
    const collision = await db.productQualityGateReceipts.where('[buildId+gateId]').equals([authority.build.id, gateId]).first()
    if (collision) fail('问题键碰撞或并发重复，请刷新')
    const id = await db.productQualityGateReceipts.add(pending) as number
    return { ...pending, id }
  })
  const verified = await parseIssueReceipt(authority, stored)
  return {
    receipt: publicReceipt(verified)!, waiver: null, blocksRelease: true,
    portableJson: verified.gateReceipt.measuredJson,
  }
}

export async function waiveTextOpenWorldCreatorAdvisoryIssueV1(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  issueReceiptHash: string
  reason: string
  confirmation: 'author-accepts-advisory-risk'
}): Promise<TextOpenWorldCreatorQualityReceiptV1<TextOpenWorldCreatorIssueWaiverEvidenceV1>> {
  const authority = await loadBuildAuthority({ scope: input.scope, productionId: input.productionId, expectedBuildId: input.buildId })
  const reason = boundedText(input.reason, 'reason', 2_000, 20)
  if (!isSha256Hash(input.issueReceiptHash) || input.confirmation !== 'author-accepts-advisory-risk') fail('问题回执Hash或确认无效')
  const issues = await readIssues(authority)
  const target = issues.find(row => row.issue.receiptHash === input.issueReceiptHash) ?? fail('当前Build没有指定问题回执')
  if (target.issue.evidence.severity !== 'advisory') fail('阻断问题不可豁免，必须通过新Build修复')
  if (target.waiver?.evidence.reason === reason) return publicReceipt(target.waiver)!
  const confirmedAt = Date.now()
  const evidence = parseTextOpenWorldCreatorIssueWaiverEvidenceV1({
    schema: 'storyforge.text-open-world-creator-issue-waiver-evidence', version: 1,
    build: authority.buildBinding, issueKey: target.issue.evidence.issueKey,
    issueReceiptHash: target.issue.receiptHash, reason,
    confirmation: input.confirmation, confirmedAt,
  })
  const receipt = await createGateReceipt({
    gateId: `${TEXT_OPEN_WORLD_CREATOR_ISSUE_WAIVER_GATE_PREFIX_V1}${target.issue.evidence.issueFingerprint.slice(0, 24)}`,
    verifierId: 'storyforge.author-advisory-waiver', verifierKind: 'human-evidence',
    inputHashes: [authority.build.packageHash, target.issue.receiptHash], environmentHash: null,
    evidence, status: 'waived', policyId: ISSUE_WAIVER_POLICY_ID,
    evidenceRefs: [target.issue.receiptHash], createdAt: confirmedAt,
  })
  const pending = pendingReceiptRow(authority, receipt)
  const stored = await db.transaction('rw', scopeTransactionTables(
    db.productProductions, db.productProductionBriefs, db.productBuilds,
    db.productBuildArtifacts, db.productQualityGateReceipts,
  ), async () => {
    await assertAuthorityRowsUnchangedInTransaction(authority)
    const issueRow = await db.productQualityGateReceipts.get(target.issue.rowId)
    if (!issueRow || canonicalRows([issueRow]) !== canonicalRows([target.issue.row])) fail('原问题回执在豁免前变化')
    const existing = await db.productQualityGateReceipts
      .where('[buildId+gateId+receiptHash]').equals([authority.build.id, receipt.gateId, receipt.receiptHash]).first()
    if (existing?.id != null) return existing as ProductQualityGateReceiptRecordV1 & { id: number }
    const id = await db.productQualityGateReceipts.add(pending) as number
    return { ...pending, id }
  })
  return publicReceipt(await parseIssueWaiverReceipt(authority, target.issue, stored))!
}

export async function finalizeTextOpenWorldCreatorQualityV1(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  semanticWaivers: TextOpenWorldCreatorSemanticWaiverV1[]
  humanChecks: TextOpenWorldCreatorHumanQualityChecksV1
  authorNote: string
}): Promise<TextOpenWorldCreatorQualityWorkspaceV1> {
  const authority = await loadBuildAuthority({ scope: input.scope, productionId: input.productionId, expectedBuildId: input.buildId })
  if (authority.hardChecks.some(check => !check.passed)) fail('代码硬门未全部通过，不能豁免')
  if (authority.reviews.some(review => review.verdict !== 'pass'
    || review.findings.some(finding => finding.severity === 'blocking'))) fail('模型评审仍有阻断项，必须创建新Build修复')
  const before = await readQualityWorkspaceWithAuthority(authority)
  if (!before.internal.calibrationReceipt || before.internal.calibrationReceipt.status !== 'passed') {
    fail('必须先通过当前Build的独立叙事、重复度、时长与成本校准')
  }
  if (!before.internal.grayboxReceipt) fail('必须先冻结当前Build的完整隔离灰盒试玩回执')
  const blockingIssues = before.internal.issues.filter(row => row.issue.evidence.severity === 'blocking')
  const unwaivedAdvisories = before.internal.issues.filter(row => row.issue.evidence.severity === 'advisory' && !row.waiver)
  if (blockingIssues.length) fail('当前Build有不可豁免的阻断问题，必须创建新Build修复')
  if (unwaivedAdvisories.length) fail('当前Build仍有未说明软豁免的非阻断问题')
  const findings = authority.reviews.flatMap(review => review.findings).sort((left, right) => left.findingKey.localeCompare(right.findingKey))
  const semanticWaivers = input.semanticWaivers.map((waiver, index) => ({
    findingKey: boundedText(waiver.findingKey, `semanticWaivers[${index}].findingKey`, 200),
    reason: boundedText(waiver.reason, `semanticWaivers[${index}].reason`, 2_000, 20),
  })).sort((left, right) => left.findingKey.localeCompare(right.findingKey))
  if (new Set(semanticWaivers.map(waiver => waiver.findingKey)).size !== semanticWaivers.length
    || semanticWaivers.length !== findings.length
    || findings.some((finding, index) => finding.findingKey !== semanticWaivers[index]?.findingKey)) {
    fail('所有当前模型建议项都必须逐项说明软豁免，且不能提交多余项')
  }
  const confirmedAt = Date.now()
  const hardEvidence = parseTextOpenWorldCreatorHardGateEvidenceV1({
    schema: 'storyforge.text-open-world-creator-hard-gate-evidence', version: 1,
    build: authority.buildBinding, governanceSnapshotHash: authority.governanceSnapshotHash,
    checks: authority.hardChecks, evaluatedAt: confirmedAt,
  })
  const hardReceipt = await createGateReceipt({
    gateId: TEXT_OPEN_WORLD_CREATOR_HARD_GATE_ID_V1,
    verifierId: 'storyforge.creator-deterministic-hard-gates', verifierKind: 'deterministic',
    inputHashes: [authority.build.packageHash, authority.build.previewHash, authority.build.manifestHash,
      authority.build.qualityReportHash, authority.buildBinding.rootTerminalReceiptHash, authority.governanceSnapshotHash],
    environmentHash: null, evidence: hardEvidence, status: 'passed', policyId: HARD_GATE_POLICY_ID,
    evidenceRefs: authority.hardChecks.flatMap(check => check.evidenceHashes), createdAt: confirmedAt,
  })
  const semanticEvidence = parseTextOpenWorldCreatorSemanticDecisionEvidenceV1({
    schema: 'storyforge.text-open-world-creator-semantic-decision-evidence', version: 1,
    build: authority.buildBinding,
    reviews: authority.reviews.map(review => ({
      reviewKind: review.reviewKind, artifactHash: review.artifactHash, reviewHash: review.reviewHash,
      minimumScore: review.minimumScore, verdict: 'pass',
      findingKeys: review.findings.map(finding => finding.findingKey).sort(),
    })),
    waivers: semanticWaivers,
    humanChecks: input.humanChecks,
    authorNote: input.authorNote.trim(),
    decision: semanticWaivers.length ? 'passed-with-soft-waivers' : 'passed',
    confirmedAt,
  })
  const semanticReceipt = await createGateReceipt({
    gateId: TEXT_OPEN_WORLD_CREATOR_SEMANTIC_GATE_ID_V1,
    verifierId: 'storyforge.creator-human-quality-review', verifierKind: 'human-evidence',
    inputHashes: [authority.build.packageHash, ...authority.reviews.flatMap(review => [review.artifactHash, review.reviewHash])],
    environmentHash: null, evidence: semanticEvidence,
    status: semanticWaivers.length ? 'waived' : 'passed', policyId: SEMANTIC_POLICY_ID,
    evidenceRefs: authority.reviews.flatMap(review => [review.reviewHash, ...review.findings.map(finding => finding.findingKey)]),
    createdAt: confirmedAt,
  })
  const releaseEvidence = parseTextOpenWorldCreatorReleaseQualityEvidenceV1({
    schema: 'storyforge.text-open-world-creator-release-quality-evidence', version: 1,
    build: authority.buildBinding,
    hardGateReceiptHash: hardReceipt.receiptHash,
    semanticDecisionReceiptHash: semanticReceipt.receiptHash,
    grayboxReceiptHash: before.internal.grayboxReceipt.receiptHash,
    issueReceiptHashes: before.internal.issueSet.issueReceiptHashes,
    issueWaiverReceiptHashes: before.internal.issueSet.issueWaiverReceiptHashes,
    issueSetHash: before.internal.issueSet.issueSetHash,
    status: 'passed', completedAt: confirmedAt,
  })
  const releaseReceipt = await createGateReceipt({
    gateId: TEXT_OPEN_WORLD_CREATOR_RELEASE_QUALITY_GATE_ID_V1,
    verifierId: 'storyforge.creator-release-quality-join', verifierKind: 'deterministic',
    inputHashes: [authority.build.packageHash, authority.build.previewHash, hardReceipt.receiptHash,
      before.internal.calibrationReceipt.receiptHash, semanticReceipt.receiptHash,
      before.internal.grayboxReceipt.receiptHash, before.internal.issueSet.issueSetHash],
    environmentHash: null, evidence: releaseEvidence, status: 'passed', policyId: RELEASE_QUALITY_POLICY_ID,
    evidenceRefs: [hardReceipt.receiptHash, before.internal.calibrationReceipt.receiptHash, semanticReceipt.receiptHash,
      before.internal.grayboxReceipt.receiptHash, ...before.internal.issueSet.issueReceiptHashes,
      ...before.internal.issueSet.issueWaiverReceiptHashes],
    createdAt: confirmedAt,
  })
  const pendingRows = [hardReceipt, semanticReceipt, releaseReceipt].map(receipt => pendingReceiptRow(authority, receipt))
  const issueRowsBefore = (await db.productQualityGateReceipts.where('buildId').equals(authority.build.id).toArray())
    .filter(row => row.gateId.startsWith(TEXT_OPEN_WORLD_CREATOR_ISSUE_GATE_PREFIX_V1)
      || row.gateId.startsWith(TEXT_OPEN_WORLD_CREATOR_ISSUE_WAIVER_GATE_PREFIX_V1))
  const issueRowsSnapshot = canonicalRows(issueRowsBefore)
  await db.transaction('rw', scopeTransactionTables(
    db.productProductions, db.productProductionBriefs, db.productBuilds,
    db.productBuildArtifacts, db.productQualityGateReceipts,
  ), async () => {
    await assertAuthorityRowsUnchangedInTransaction(authority)
    const currentAll = await db.productQualityGateReceipts.where('buildId').equals(authority.build.id).toArray()
    const currentIssues = currentAll.filter(row => row.gateId.startsWith(TEXT_OPEN_WORLD_CREATOR_ISSUE_GATE_PREFIX_V1)
      || row.gateId.startsWith(TEXT_OPEN_WORLD_CREATOR_ISSUE_WAIVER_GATE_PREFIX_V1))
    if (canonicalRows(currentIssues) !== issueRowsSnapshot) fail('问题/豁免集合在冻结发布质量前变化')
    const latestGraybox = currentAll.filter(row => row.gateId === TEXT_OPEN_WORLD_CREATOR_GRAYBOX_GATE_ID_V1)
      .sort((left, right) => right.createdAt - left.createdAt || (right.id ?? -1) - (left.id ?? -1))[0]
    if (!latestGraybox || latestGraybox.receiptHash !== before.internal.grayboxReceipt!.receiptHash) {
      fail('灰盒回执在冻结发布质量前变化')
    }
    const latestCalibration = currentAll.filter(row => row.gateId === TEXT_OPEN_WORLD_CREATOR_CALIBRATION_GATE_ID_V1)
      .sort((left, right) => right.createdAt - left.createdAt || (right.id ?? -1) - (left.id ?? -1))[0]
    if (!latestCalibration || latestCalibration.receiptHash !== before.internal.calibrationReceipt!.receiptHash
      || latestCalibration.status !== 'passed') fail('独立校准回执在冻结发布质量前变化')
    for (const [index, receipt] of [hardReceipt, semanticReceipt, releaseReceipt].entries()) {
      const existing = await db.productQualityGateReceipts
        .where('[buildId+gateId+receiptHash]').equals([authority.build.id, receipt.gateId, receipt.receiptHash]).first()
      if (!existing) await db.productQualityGateReceipts.add(pendingRows[index]!)
    }
  })
  const after = await readTextOpenWorldCreatorQualityWorkspaceV1({
    scope: authority.scope, productionId: authority.production.id, expectedBuildId: authority.build.id,
  })
  if (!after.releaseQualityReady) fail('发布质量回执写入后复验失败')
  return after
}

export async function requirePassedTextOpenWorldCreatorQualityGateV1(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
}): Promise<TextOpenWorldCreatorQualityReceiptV1<TextOpenWorldCreatorReleaseQualityEvidenceV1>> {
  const workspace = await readTextOpenWorldCreatorQualityWorkspaceV1({
    scope: input.scope, productionId: input.productionId, expectedBuildId: input.buildId,
  })
  if (!workspace.releaseQualityReady || !workspace.releaseQualityReceipt) {
    fail(`当前Creator Build未通过发布质量门:${workspace.blockers.join('；') || 'unknown'}`)
  }
  return workspace.releaseQualityReceipt
}

export function portableTextOpenWorldCreatorIssueJsonV1(issue: TextOpenWorldCreatorIssueRecordV1): string {
  const evidence = parseTextOpenWorldCreatorIssueEvidenceV1(issue.receipt.evidence)
  return canonicalProductProductionJsonV2({
    schema: 'storyforge.text-open-world-creator-portable-issue', version: 1,
    issue: evidence,
    issueReceiptHash: issue.receipt.receiptHash,
    waiver: issue.waiver ? parseTextOpenWorldCreatorIssueWaiverEvidenceV1(issue.waiver.evidence) : null,
    waiverReceiptHash: issue.waiver?.receiptHash ?? null,
  })
}
