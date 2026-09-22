import type { ProductTaskBudgetReservationV1 } from '../types'
import { hashProductProductionValueV2, isSha256Hash } from '../product-production/hash'

const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const MAXIMUM_TASKS = 128
const MAXIMUM_HANDOFFS = 32
const MAXIMUM_ARTIFACTS = 256

function fail(message: string): never {
  throw new Error(`[text-open-world-creator-repair] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} 字段不精确:${actual.join(',')}`)
  }
}

function stableKey(value: unknown, label: string): string {
  if (typeof value !== 'string') fail(`${label} 必须是字符串`)
  const normalized = value.trim().normalize('NFC')
  if (!STABLE_KEY.test(normalized)) fail(`${label} 不是稳定 key`)
  return normalized
}

function sha(value: unknown, label: string): string {
  if (!isSha256Hash(value)) fail(`${label} 不是 SHA-256`)
  return value
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) fail(`${label} 必须是正整数`)
  return Number(value)
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(`${label} 必须是非负整数`)
  return Number(value)
}

function optionalIdentity(value: unknown, label: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string') fail(`${label} 必须是字符串或 null`)
  const normalized = value.trim().normalize('NFC')
  if (!normalized || normalized.length > 500) fail(`${label} 为空或过长`)
  return normalized
}

function uniqueStableKeys(value: unknown, label: string, maximum = MAXIMUM_TASKS): string[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} 必须是有界数组`)
  const parsed = value.map((item, index) => stableKey(item, `${label}[${index}]`))
  if (new Set(parsed).size !== parsed.length) fail(`${label} 存在重复 key`)
  return parsed
}

function budget(value: unknown): ProductTaskBudgetReservationV1 {
  const row = record(value, 'estimatedRerunBudget')
  exact(row, [
    'modelCalls', 'inputTokens', 'outputTokens', 'mediaCalls', 'maximumCostUsd',
    'durationMs', 'storageBytes',
  ], 'estimatedRerunBudget')
  const integer = (key: keyof ProductTaskBudgetReservationV1) => nonNegativeInteger(
    row[key], `estimatedRerunBudget.${key}`,
  )
  const maximumCostUsd = row.maximumCostUsd === null
    ? null
    : (() => {
        if (typeof row.maximumCostUsd !== 'number' || !Number.isFinite(row.maximumCostUsd)
          || row.maximumCostUsd < 0) fail('estimatedRerunBudget.maximumCostUsd 无效')
        return row.maximumCostUsd
      })()
  return {
    modelCalls: integer('modelCalls'),
    inputTokens: integer('inputTokens'),
    outputTokens: integer('outputTokens'),
    mediaCalls: integer('mediaCalls'),
    maximumCostUsd,
    durationMs: integer('durationMs'),
    storageBytes: integer('storageBytes'),
  }
}

export interface TextOpenWorldCreatorRepairArtifactDeltaV1 {
  artifactKey: string
  baseContentHash: string
  contentHash: string
}

export interface TextOpenWorldCreatorRepairHandoffRefV1 {
  ownerTaskKey: string
  target: { artifactKey: string; entityIdentity: string | null }
  impactHandoffHash: string
  intentHash: string
  candidateHash: string
  terminalReceiptHash: string
  verificationReceiptHash: string
  baseGroupHash: string
  artifacts: TextOpenWorldCreatorRepairArtifactDeltaV1[]
}

export interface TextOpenWorldCreatorRepairImpactPlanV1 {
  schema: 'storyforge.text-open-world-creator-repair-impact-plan'
  version: 1
  portable: true
  productType: 'text-open-world'
  productionKey: string
  baseBuild: {
    buildNumber: number
    stateRevision: number
    controlEpoch: number
    briefRevision: number
    briefHash: string
    planHash: string
    manifestHash: string
    rootTerminalReceiptHash: string
  }
  targetBuildNumber: number
  handoffSetHash: string
  handoffs: TextOpenWorldCreatorRepairHandoffRefV1[]
  targetTaskKeys: string[]
  staleTaskKeys: string[]
  reuseTaskKeys: string[]
  estimatedRerunBudget: ProductTaskBudgetReservationV1
  impactPlanHash: string
}

export interface TextOpenWorldCreatorRepairAuthorizationV1 {
  schema: 'storyforge.text-open-world-creator-repair-authorization'
  version: 1
  portable: true
  impactPlan: TextOpenWorldCreatorRepairImpactPlanV1
  impactPlanHash: string
  targetPlanHash: string
  expectedStateRevision: number
  authorizationNonceHash: string
  authorizedAt: number
  authorizationHash: string
}

function parseArtifactDelta(value: unknown, label: string): TextOpenWorldCreatorRepairArtifactDeltaV1 {
  const row = record(value, label)
  exact(row, ['artifactKey', 'baseContentHash', 'contentHash'], label)
  const parsed = {
    artifactKey: stableKey(row.artifactKey, `${label}.artifactKey`),
    baseContentHash: sha(row.baseContentHash, `${label}.baseContentHash`),
    contentHash: sha(row.contentHash, `${label}.contentHash`),
  }
  return parsed
}

function parseHandoff(value: unknown, index: number): TextOpenWorldCreatorRepairHandoffRefV1 {
  const label = `handoffs[${index}]`
  const row = record(value, label)
  exact(row, [
    'ownerTaskKey', 'target', 'impactHandoffHash', 'intentHash', 'candidateHash',
    'terminalReceiptHash', 'verificationReceiptHash', 'baseGroupHash', 'artifacts',
  ], label)
  const target = record(row.target, `${label}.target`)
  exact(target, ['artifactKey', 'entityIdentity'], `${label}.target`)
  if (!Array.isArray(row.artifacts) || row.artifacts.length < 1
    || row.artifacts.length > MAXIMUM_ARTIFACTS) fail(`${label}.artifacts 必须是非空有界数组`)
  const artifacts = row.artifacts.map((item, artifactIndex) => (
    parseArtifactDelta(item, `${label}.artifacts[${artifactIndex}]`)
  ))
  if (new Set(artifacts.map(item => item.artifactKey)).size !== artifacts.length) {
    fail(`${label}.artifacts 存在重复 key`)
  }
  // G5-06 deliberately rebuilds the complete owner sibling group. A patch may
  // change one target while byte-identically carrying its siblings, so only
  // the handoff as a whole must contain a real delta.
  if (!artifacts.some(item => item.baseContentHash !== item.contentHash)) {
    fail(`${label}.artifacts 没有实际内容变化`)
  }
  return {
    ownerTaskKey: stableKey(row.ownerTaskKey, `${label}.ownerTaskKey`),
    target: {
      artifactKey: stableKey(target.artifactKey, `${label}.target.artifactKey`),
      entityIdentity: optionalIdentity(target.entityIdentity, `${label}.target.entityIdentity`),
    },
    impactHandoffHash: sha(row.impactHandoffHash, `${label}.impactHandoffHash`),
    intentHash: sha(row.intentHash, `${label}.intentHash`),
    candidateHash: sha(row.candidateHash, `${label}.candidateHash`),
    terminalReceiptHash: sha(row.terminalReceiptHash, `${label}.terminalReceiptHash`),
    verificationReceiptHash: sha(row.verificationReceiptHash, `${label}.verificationReceiptHash`),
    baseGroupHash: sha(row.baseGroupHash, `${label}.baseGroupHash`),
    artifacts,
  }
}

export async function parseTextOpenWorldCreatorRepairImpactPlanV1(
  value: unknown,
): Promise<TextOpenWorldCreatorRepairImpactPlanV1> {
  const row = record(typeof value === 'string' ? (() => {
    try { return JSON.parse(value) } catch { fail('ImpactPlan 不是合法 JSON') }
  })() : value, 'impactPlan')
  exact(row, [
    'schema', 'version', 'portable', 'productType', 'productionKey', 'baseBuild',
    'targetBuildNumber', 'handoffSetHash', 'handoffs', 'targetTaskKeys',
    'staleTaskKeys', 'reuseTaskKeys', 'estimatedRerunBudget', 'impactPlanHash',
  ], 'impactPlan')
  if (row.schema !== 'storyforge.text-open-world-creator-repair-impact-plan'
    || row.version !== 1 || row.portable !== true || row.productType !== 'text-open-world') {
    fail('ImpactPlan schema/version/product 无效')
  }
  const base = record(row.baseBuild, 'impactPlan.baseBuild')
  exact(base, [
    'buildNumber', 'stateRevision', 'controlEpoch', 'briefRevision', 'briefHash',
    'planHash', 'manifestHash', 'rootTerminalReceiptHash',
  ], 'impactPlan.baseBuild')
  if (!Array.isArray(row.handoffs) || row.handoffs.length < 1
    || row.handoffs.length > MAXIMUM_HANDOFFS) fail('impactPlan.handoffs 必须是非空有界数组')
  const handoffs = row.handoffs.map(parseHandoff)
  const targetTaskKeys = uniqueStableKeys(row.targetTaskKeys, 'impactPlan.targetTaskKeys')
  const staleTaskKeys = uniqueStableKeys(row.staleTaskKeys, 'impactPlan.staleTaskKeys')
  const reuseTaskKeys = uniqueStableKeys(row.reuseTaskKeys, 'impactPlan.reuseTaskKeys')
  if (!targetTaskKeys.length || targetTaskKeys.length !== handoffs.length
    || targetTaskKeys.some((key, index) => key !== handoffs[index]?.ownerTaskKey)
    || targetTaskKeys.some(key => !staleTaskKeys.includes(key))
    || staleTaskKeys.some(key => reuseTaskKeys.includes(key))) {
    fail('ImpactPlan target/stale/reuse 分区不闭合')
  }
  const parsed: TextOpenWorldCreatorRepairImpactPlanV1 = {
    schema: 'storyforge.text-open-world-creator-repair-impact-plan',
    version: 1,
    portable: true,
    productType: 'text-open-world',
    productionKey: stableKey(row.productionKey, 'impactPlan.productionKey'),
    baseBuild: {
      buildNumber: positiveInteger(base.buildNumber, 'impactPlan.baseBuild.buildNumber'),
      stateRevision: nonNegativeInteger(base.stateRevision, 'impactPlan.baseBuild.stateRevision'),
      controlEpoch: nonNegativeInteger(base.controlEpoch, 'impactPlan.baseBuild.controlEpoch'),
      briefRevision: positiveInteger(base.briefRevision, 'impactPlan.baseBuild.briefRevision'),
      briefHash: sha(base.briefHash, 'impactPlan.baseBuild.briefHash'),
      planHash: sha(base.planHash, 'impactPlan.baseBuild.planHash'),
      manifestHash: sha(base.manifestHash, 'impactPlan.baseBuild.manifestHash'),
      rootTerminalReceiptHash: sha(
        base.rootTerminalReceiptHash,
        'impactPlan.baseBuild.rootTerminalReceiptHash',
      ),
    },
    targetBuildNumber: positiveInteger(row.targetBuildNumber, 'impactPlan.targetBuildNumber'),
    handoffSetHash: sha(row.handoffSetHash, 'impactPlan.handoffSetHash'),
    handoffs,
    targetTaskKeys,
    staleTaskKeys,
    reuseTaskKeys,
    estimatedRerunBudget: budget(row.estimatedRerunBudget),
    impactPlanHash: sha(row.impactPlanHash, 'impactPlan.impactPlanHash'),
  }
  if (parsed.targetBuildNumber !== parsed.baseBuild.buildNumber + 1) {
    fail('ImpactPlan target Build 必须紧接 base Build')
  }
  const { impactPlanHash, ...body } = parsed
  if (await hashProductProductionValueV2(body) !== impactPlanHash) fail('ImpactPlan Hash 不匹配')
  return parsed
}

export async function parseTextOpenWorldCreatorRepairAuthorizationV1(
  value: unknown,
): Promise<TextOpenWorldCreatorRepairAuthorizationV1> {
  let candidate = value
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate) } catch { fail('Authorization 不是合法 JSON') }
  }
  const row = record(candidate, 'authorization')
  exact(row, [
    'schema', 'version', 'portable', 'impactPlan', 'impactPlanHash', 'targetPlanHash',
    'expectedStateRevision', 'authorizationNonceHash', 'authorizedAt', 'authorizationHash',
  ], 'authorization')
  if (row.schema !== 'storyforge.text-open-world-creator-repair-authorization'
    || row.version !== 1 || row.portable !== true) fail('Authorization schema/version 无效')
  const impactPlan = await parseTextOpenWorldCreatorRepairImpactPlanV1(row.impactPlan)
  const parsed: TextOpenWorldCreatorRepairAuthorizationV1 = {
    schema: 'storyforge.text-open-world-creator-repair-authorization',
    version: 1,
    portable: true,
    impactPlan,
    impactPlanHash: sha(row.impactPlanHash, 'authorization.impactPlanHash'),
    targetPlanHash: sha(row.targetPlanHash, 'authorization.targetPlanHash'),
    expectedStateRevision: nonNegativeInteger(
      row.expectedStateRevision,
      'authorization.expectedStateRevision',
    ),
    authorizationNonceHash: sha(row.authorizationNonceHash, 'authorization.authorizationNonceHash'),
    authorizedAt: positiveInteger(row.authorizedAt, 'authorization.authorizedAt'),
    authorizationHash: sha(row.authorizationHash, 'authorization.authorizationHash'),
  }
  if (parsed.impactPlanHash !== impactPlan.impactPlanHash) fail('Authorization ImpactPlan Hash 不一致')
  const { authorizationHash, ...body } = parsed
  if (await hashProductProductionValueV2(body) !== authorizationHash) fail('Authorization Hash 不匹配')
  return parsed
}
