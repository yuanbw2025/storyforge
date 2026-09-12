import { db } from '../db/schema'
import type {
  ProductBuildArtifactRecordV1,
  ProductBuildQualityReportV1,
  ProductBuildRecordV1,
  ProductProductionBriefRecordV1,
  ProductProductionRecordV1,
  ProductQualityGateReceiptRecordV1,
  ProductQualityGateReceiptStatusV1,
  ProductRuntimeEvent,
  ProductRuntimeSession,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope, resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import { readAcceptedBuildArtifacts } from '../product-production/artifact-store'
import { parseProductBuildQualityReportV1 } from '../product-production/adoption'
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
import {
  TEXT_OPEN_WORLD_CREATOR_GRAYBOX_COVERAGE_KEYS_V1,
  TEXT_OPEN_WORLD_CREATOR_GRAYBOX_GATE_ID_V1,
  TEXT_OPEN_WORLD_CREATOR_HARD_GATE_ID_V1,
  TEXT_OPEN_WORLD_CREATOR_ISSUE_CATEGORIES_V1,
  TEXT_OPEN_WORLD_CREATOR_ISSUE_GATE_PREFIX_V1,
  TEXT_OPEN_WORLD_CREATOR_ISSUE_WAIVER_GATE_PREFIX_V1,
  TEXT_OPEN_WORLD_CREATOR_RELEASE_QUALITY_GATE_ID_V1,
  TEXT_OPEN_WORLD_CREATOR_SEMANTIC_GATE_ID_V1,
  parseTextOpenWorldCreatorGrayboxEvidenceV1,
  parseTextOpenWorldCreatorHardGateEvidenceV1,
  parseTextOpenWorldCreatorIssueEvidenceV1,
  parseTextOpenWorldCreatorIssueWaiverEvidenceV1,
  parseTextOpenWorldCreatorReleaseQualityEvidenceV1,
  parseTextOpenWorldCreatorSemanticDecisionEvidenceV1,
  type TextOpenWorldCreatorBuildBindingV1,
  type TextOpenWorldCreatorGrayboxEnvironmentV1,
  type TextOpenWorldCreatorGrayboxEvidenceV1,
  type TextOpenWorldCreatorGrayboxHumanChecksV1,
  type TextOpenWorldCreatorGrayboxSessionEvidenceV1,
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
} from './creator-quality-contract'

const HARD_GATE_POLICY_ID = 'storyforge.text-open-world-creator-hard-gates.v1'
const SEMANTIC_POLICY_ID = 'storyforge.text-open-world-creator-semantic-release.v1'
const GRAYBOX_POLICY_ID = 'storyforge.text-open-world-creator-graybox.v1'
const ISSUE_POLICY_ID = 'storyforge.text-open-world-creator-issue.v1'
const ISSUE_WAIVER_POLICY_ID = 'storyforge.text-open-world-creator-issue-waiver.v1'
const RELEASE_QUALITY_POLICY_ID = 'storyforge.text-open-world-creator-release-quality.v1'
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
  authorityRowsJson: {
    production: string
    build: string
    brief: string
    artifacts: string
  }
}

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
  witness: TextOpenWorldCreatorGrayboxSessionEvidenceV1
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
  grayboxCandidates: TextOpenWorldCreatorGrayboxCandidateV1[]
  grayboxReceipt: TextOpenWorldCreatorQualityReceiptV1<TextOpenWorldCreatorGrayboxEvidenceV1> | null
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function stringListsEqual(left: string[], right: string[]): boolean {
  return canonicalProductProductionJsonV2(left) === canonicalProductProductionJsonV2(uniqueStrings(right))
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
  if (!build || build.id == null || input.expectedBuildId != null && build.id !== input.expectedBuildId
    || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })
    || !['preview-ready', 'release-ready'].includes(build.status)
    || production.status !== 'preview-ready') fail('当前Creator Build尚未封账或已变化')
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
  authority: BuildAuthorityV1
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
  authority: BuildAuthorityV1
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
  if (session.projectId !== authority.scope.projectId || session.worldId !== authority.scope.worldId
    || session.workId !== authority.scope.workId || session.productBuildId !== authority.build.id
    || session.productReleaseId != null || session.kind !== 'text-open-world'
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
      witness,
    },
    eventRowsJson: canonicalRows(events),
    checkpointRowsJson: canonicalRows(checkpoints),
    sessionRowJson: canonicalRows([session]),
  }
}

async function listGrayboxCandidates(authority: BuildAuthorityV1): Promise<TextOpenWorldCreatorGrayboxCandidateV1[]> {
  const sessions = (await db.productRuntimeSessions.where('productBuildId').equals(authority.build.id).toArray())
    .filter(session => session.id != null && session.projectId === authority.scope.projectId
      && session.worldId === authority.scope.worldId && session.workId === authority.scope.workId
      && session.productReleaseId == null && session.runtimeSourceHash === authority.build.packageHash
      && session.kind === 'text-open-world') as Array<ProductRuntimeSession & { id: number }>
  const candidates: TextOpenWorldCreatorGrayboxCandidateV1[] = []
  for (const session of sessions) {
    try { candidates.push((await createSessionWitness({ authority, session })).candidate) }
    catch { /* A corrupt preview is not offered as evidence; the player recovery UI still owns repair. */ }
  }
  return candidates.sort((left, right) => right.updatedAt - left.updatedAt || right.sessionId - left.sessionId)
}

async function parseIssueReceipt(
  authority: BuildAuthorityV1,
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
  authority: BuildAuthorityV1,
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

async function readIssues(authority: BuildAuthorityV1): Promise<Array<{
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
  semanticReceipt: VerifiedReceiptV1<TextOpenWorldCreatorSemanticDecisionEvidenceV1> | null
  grayboxReceipt: VerifiedReceiptV1<TextOpenWorldCreatorGrayboxEvidenceV1> | null
  issueSet: Awaited<ReturnType<typeof currentIssueSet>>
}): Promise<VerifiedReceiptV1<TextOpenWorldCreatorReleaseQualityEvidenceV1> | null> {
  const receipt = await latestFixedReceipt({
    authority: input.authority, gateId: TEXT_OPEN_WORLD_CREATOR_RELEASE_QUALITY_GATE_ID_V1,
    verifierId: 'storyforge.creator-release-quality-join', policyId: RELEASE_QUALITY_POLICY_ID,
    statuses: ['passed'], parseEvidence: parseTextOpenWorldCreatorReleaseQualityEvidenceV1,
  })
  if (!receipt || !input.hardReceipt || !input.semanticReceipt || !input.grayboxReceipt) return null
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
      input.hardReceipt.receiptHash, input.semanticReceipt.receiptHash,
      input.grayboxReceipt.receiptHash, input.issueSet.issueSetHash,
    ])
    || !stringListsEqual(receipt.gateReceipt.evidenceRefs, [
      input.hardReceipt.receiptHash, input.semanticReceipt.receiptHash,
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
    semanticReceipt: VerifiedReceiptV1<TextOpenWorldCreatorSemanticDecisionEvidenceV1> | null
    grayboxReceipt: VerifiedReceiptV1<TextOpenWorldCreatorGrayboxEvidenceV1> | null
    releaseReceipt: VerifiedReceiptV1<TextOpenWorldCreatorReleaseQualityEvidenceV1> | null
    issueSet: Awaited<ReturnType<typeof currentIssueSet>>
  }
}> {
  const [grayboxCandidates, issues] = await Promise.all([
    listGrayboxCandidates(authority), readIssues(authority),
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
  const [semanticReceipt, grayboxReceipt] = await Promise.all([
    readSemanticDecisionReceipt(authority), readGrayboxReceipt(authority),
  ])
  const issueSet = await currentIssueSet(issues)
  const releaseReceipt = await readReleaseQualityReceipt({
    authority, hardReceipt, semanticReceipt, grayboxReceipt, issueSet,
  })
  const modelFindings = authority.reviews.flatMap(review => review.findings)
  const blockers: string[] = []
  if (authority.hardChecks.some(check => !check.passed)) blockers.push('存在未通过且不可豁免的代码硬门')
  if (authority.reviews.some(review => review.verdict !== 'pass')) blockers.push('平衡或叙事模型评审仍要求新Build修复')
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
      grayboxCandidates, grayboxReceipt: publicReceipt(grayboxReceipt),
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
    internal: { issues, hardReceipt, semanticReceipt, grayboxReceipt, releaseReceipt, issueSet },
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
      semanticReceipt.receiptHash, before.internal.grayboxReceipt.receiptHash, before.internal.issueSet.issueSetHash],
    environmentHash: null, evidence: releaseEvidence, status: 'passed', policyId: RELEASE_QUALITY_POLICY_ID,
    evidenceRefs: [hardReceipt.receiptHash, semanticReceipt.receiptHash,
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
