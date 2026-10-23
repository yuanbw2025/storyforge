import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import {
  assertProductBuildTerminalReadSetUnchangedV1,
  verifyProductBuildTerminalArtifactSetV1,
  verifyTextOpenWorldBudgetRecoveryPrefixV1,
  type ProductBuildTerminalCasReadSetV1,
} from '../product-production/artifact-store'
import { canonicalProductProductionJsonV2 as json, hashProductProductionValueV2 as hash } from '../product-production/hash'
import { createProductBuildRootBudgetEvidenceV1 } from '../product-production/root-budget-evidence'
import { verifyStoredProductBuildRootBudgetEvidenceV1 } from '../product-production/root-budget-evidence-store'
import {
  assertProductProductionBudgetLedgerV1,
  projectProductProductionObservedTextLatencyV1,
  type ProductProductionTaskUsageV1,
} from '../product-production/scheduler'
import {
  readTextOpenWorldCreatorDerivedBuildAuthorityV1,
  type TextOpenWorldCreatorDerivedBuildAuthorityV1,
} from './creator-derived-authority'
import type {
  TextOpenWorldCreatorCalibrationEvidenceV1,
  TextOpenWorldCreatorCalibrationUsageSourceV1,
} from './creator-quality-contract'

function fail(message: string): never {
  throw new Error(`[text-open-world-calibration-usage] ${message}`)
}

interface Attempt {
  runId: number
  usage: ProductProductionTaskUsageV1 | null
  usageKnown: boolean
  resolution?: string
}

/** Callers supply a verified Build ledger. Current task summaries deliberately
 * do not participate: failed attempts and old epochs still consumed resources. */
export async function projectTextOpenWorldCalibrationUsageV1(input: {
  derived: TextOpenWorldCreatorDerivedBuildAuthorityV1
  proofHash: string
}): Promise<{ source: TextOpenWorldCreatorCalibrationUsageSourceV1; chargedRunIds: number[] }> {
  const { derived } = input
  const build = derived.build
  assertProductProductionBudgetLedgerV1(build.budgetLedgerJson)
  const ledger = JSON.parse(build.budgetLedgerJson) as { version: number; attempts: Attempt[] }
  if (ledger.version !== 2 || !Array.isArray(ledger.attempts)) fail('制作来源必须提供完整v2尝试账本')
  const attempts = ledger.attempts
  const measured = attempts.filter(attempt => attempt.usageKnown
    && attempt.resolution !== 'author-charged-reservation-upper-bound')
  const sum = (rows: Attempt[], key: 'modelCalls' | 'inputTokens' | 'outputTokens' | 'durationMs') => {
    const total = rows.reduce((value, row) => value + (row.usage?.[key] ?? 0), 0)
    if (!Number.isSafeInteger(total) || total < 0) fail('制作来源用量超出安全整数范围')
    return total
  }
  const quote = derived.contracts.start.preflight.priceQuote ?? fail('制作来源缺少冻结报价')
  const limits = derived.contracts.executionBrief.productionBudget
  const latency = projectProductProductionObservedTextLatencyV1(build.budgetLedgerJson)
  const inputTokens = sum(attempts, 'inputTokens')
  const outputTokens = sum(attempts, 'outputTokens')
  return {
    source: {
      buildNumber: build.buildNumber, briefHash: build.briefHash, planHash: build.planHash,
      origin: derived.origin, proofHash: input.proofHash,
      usage: {
        // The sealed proof binds the complete ledger and current Run ownership.
        // Only the local Run locator is omitted from this portable observation.
        ledgerHash: await hash({ proofHash: input.proofHash,
          attempts: attempts.map(({ runId: _runId, ...attempt }) => attempt) }),
        modelCalls: sum(attempts, 'modelCalls'), inputTokens, outputTokens,
        totalDurationMs: sum(attempts, 'durationMs'),
        averageCallDurationMs: latency.averageCallDurationMs,
        p95CallDurationMs: latency.p95CallDurationMs, maximumCallDurationMs: latency.maximumCallDurationMs,
        estimatedTextCostUsd: inputTokens / 1_000_000 * quote.inputUsdPerMillionTokens
          + outputTokens / 1_000_000 * quote.outputUsdPerMillionTokens,
        priceQuoteHash: quote.quoteHash, priceQuoteSource: quote.source, priceQuoteAsOf: quote.asOf,
        budgetMaximumCalls: limits.maximumModelCalls,
        budgetMaximumInputTokens: limits.maximumInputTokens,
        budgetMaximumOutputTokens: limits.maximumOutputTokens,
        budgetMaximumDurationMs: limits.maximumDurationMs,
        budgetMaximumCostUsd: limits.maximumCostUsd ?? fail('制作来源缺少费用上限'),
      },
      observedModelCalls: sum(measured, 'modelCalls'),
      observedInputTokens: sum(measured, 'inputTokens'),
      observedOutputTokens: sum(measured, 'outputTokens'),
      unknownAttemptCount: attempts.filter(attempt => !attempt.usageKnown).length,
      chargedUpperBoundAttemptCount: attempts.filter(attempt =>
        attempt.resolution === 'author-charged-reservation-upper-bound').length,
    },
    // A single Run can contain several real retry attempts. Their usage is
    // counted separately above; only Run ownership across Builds is unique.
    chargedRunIds: [...new Set(attempts.filter(attempt => attempt.usage != null
      && (attempt.usage.modelCalls > 0 || attempt.usage.inputTokens > 0 || attempt.usage.outputTokens > 0))
      .map(attempt => attempt.runId))],
  }
}

export function textOpenWorldCalibrationLineageChecksV1(
  sources: TextOpenWorldCreatorCalibrationUsageSourceV1[],
): TextOpenWorldCreatorCalibrationEvidenceV1['checks'] {
  const calls = sources.reduce((sum, source) => sum + source.observedModelCalls, 0)
  const inputTokens = sources.reduce((sum, source) => sum + source.observedInputTokens, 0)
  const outputTokens = sources.reduce((sum, source) => sum + source.observedOutputTokens, 0)
  const unknown = sources.reduce((sum, source) => sum + source.unknownAttemptCount, 0)
  const upperBounds = sources.reduce((sum, source) => sum + source.chargedUpperBoundAttemptCount, 0)
  const withinBudget = sources.every(({ usage }) => (
    usage.modelCalls <= usage.budgetMaximumCalls
      && usage.inputTokens <= usage.budgetMaximumInputTokens
      && usage.outputTokens <= usage.budgetMaximumOutputTokens
      && usage.totalDurationMs <= usage.budgetMaximumDurationMs
      && usage.estimatedTextCostUsd <= usage.budgetMaximumCostUsd
  ))
  return [
    {
      key: 'production-call-usage-observed',
      passed: sources.length > 0 && calls > 0 && inputTokens > 0 && outputTokens > 0
        && unknown === 0 && upperBounds === 0,
      summary: `${sources.length}个已验真制作版本合计实测${calls}次调用、输入${inputTokens}、输出${outputTokens} tokens；当前版本新增${sources[sources.length - 1]?.observedModelCalls ?? 0}次。未知尝试${unknown}项，上限计费${upperBounds}项，均不冒充实测。`,
    },
    {
      key: 'production-budget-and-cost', passed: sources.length > 0 && withinBudget,
      summary: `逐版本核对原冻结预算${withinBudget ? '通过' : '未通过'}；按各自冻结报价估算文本费用合计$${sources.reduce((sum, source) => sum + source.usage.estimatedTextCostUsd, 0).toFixed(4)}，不是供应商账单，预算不跨版本互相抵扣。`,
    },
  ]
}

export interface VerifiedTextOpenWorldCalibrationLineageV1 {
  sources: TextOpenWorldCreatorCalibrationUsageSourceV1[]
  readSets: ProductBuildTerminalCasReadSetV1[]
}

/** Follow only registered same-Brief derivations. A reconfirmed Creator Start
 * ends the chain even if it retains a historical parentBuildNumber. */
export async function readTextOpenWorldCalibrationLineageV1(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
}): Promise<VerifiedTextOpenWorldCalibrationLineageV1> {
  const sources: TextOpenWorldCreatorCalibrationUsageSourceV1[] = []
  const readSets: ProductBuildTerminalCasReadSetV1[] = []
  const seenBuilds = new Set<number>()
  const seenChargedRuns = new Set<number>()
  let derived = await readTextOpenWorldCreatorDerivedBuildAuthorityV1(input)
  const briefHash = derived.build.briefHash
  while (true) {
    const { build } = derived
    if (seenBuilds.has(build.id) || seenBuilds.size >= 128
      || derived.production.id !== input.productionId || build.productionId !== input.productionId
      || build.briefHash !== briefHash) fail('制作来源循环、跨作品或Brief已变化')
    seenBuilds.add(build.id)
    const verifyInput = { scope: input.scope, productionId: input.productionId, buildId: build.id,
      expectedControlEpoch: build.controlEpoch, expectedPlanHash: build.planHash }
    const proof = build.status === 'recovery-required'
      ? await verifyTextOpenWorldBudgetRecoveryPrefixV1(verifyInput)
      : await verifyProductBuildTerminalArtifactSetV1(verifyInput)
    if (json(proof.casReadSet.buildRows.find(row => row.id === build.id)) !== json(build)) {
      fail('制作来源在验真期间已变化')
    }
    let proofHash: string
    if ('prefixHash' in proof && typeof proof.prefixHash === 'string') proofHash = proof.prefixHash
    else {
      if (!['preview-ready', 'release-ready', 'released'].includes(build.status)
        || !build.rootTerminalReceiptHash) fail('制作来源尚未封账')
      // Original v2 Builds may predate the optional import preimage. Reconstruct
      // it only in memory when the complete current envelope still hashes to
      // the exact original seal; changed/remapped ledgers cannot pass here.
      const rootBudgetEvidenceJson = build.rootBudgetEvidenceJson
        ?? await createProductBuildRootBudgetEvidenceV1({
          planHash: build.planHash, manifestHash: build.manifestHash, packageHash: build.packageHash,
          qualityReportHash: build.qualityReportHash, controlEpoch: build.controlEpoch,
          budgetLedgerJson: build.budgetLedgerJson, artifacts: proof.artifacts,
          expectedReceiptHash: build.rootTerminalReceiptHash,
        })
      await verifyStoredProductBuildRootBudgetEvidenceV1({ scope: input.scope,
        build: { ...build, rootBudgetEvidenceJson }, artifacts: proof.artifacts })
      proofHash = build.rootTerminalReceiptHash
    }
    proof.casReadSet.authorityCommands = [
      ...(proof.casReadSet.authorityCommands ?? []),
      ...derived.commandChain.map(command => ({ id: command.id, rowJson: json(command) })),
    ]
    const projected = await projectTextOpenWorldCalibrationUsageV1({ derived, proofHash })
    for (const runId of projected.chargedRunIds) {
      if (seenChargedRuns.has(runId)) fail('同一付费尝试不能在多个制作版本重复计入')
      seenChargedRuns.add(runId)
    }
    sources.unshift(projected.source)
    readSets.push(proof.casReadSet)
    if (derived.origin === 'creator-start-v1') break
    const parent = derived.origin === 'creator-budget-recovery-v1' ? derived.budgetRecovery.source.build
      : derived.origin === 'creator-repair-v1' ? derived.repair.sourceBuild : derived.media.sourceBuild
    if (parent.buildNumber !== build.parentBuildNumber || parent.buildNumber >= build.buildNumber) {
      fail('制作来源不是已授权的直接父版本')
    }
    derived = await readTextOpenWorldCreatorDerivedBuildAuthorityV1({ scope: input.scope, buildId: parent.id })
  }
  return { sources, readSets }
}

/** Must run inside the receipt write transaction including all proof tables. */
export async function assertTextOpenWorldCalibrationLineageUnchangedV1(
  lineage: VerifiedTextOpenWorldCalibrationLineageV1,
): Promise<void> {
  for (const readSet of lineage.readSets) await assertProductBuildTerminalReadSetUnchangedV1({ readSet })
}

export const textOpenWorldCalibrationProofTablesV1 = () => [
  db.productProductionCommands, db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints, db.mediaBlobObjects,
]
