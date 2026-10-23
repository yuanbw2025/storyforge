import { appendAgentRunEventV1, createAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { db } from '../../src/lib/db/schema'
import { acceptTextOpenWorldSourcePinBundleV1 } from '../../src/lib/open-world/source-pin'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createProductBuildPreviewManifestV1 } from '../../src/lib/product-production/preview-manifest'
import { createProductBuildRootTerminalReceiptV1 } from '../../src/lib/product-production/receipts'
import type { ProductRuntimePackageV1, TextOpenWorldSourcePinBundleV1, WorkspaceScope } from '../../src/lib/types'

/**
 * An isolated lifecycle fixture, not a completed production DAG or human QA.
 * Its source-lock child and root use real Run events and a v2 seal over the
 * stored source artifacts, so export/import exercises current proof remapping.
 * Full production/repair coverage belongs to R-OPEN-WORLD3-experience-design.
 */
export async function seedTextOpenWorldReleaseRootFixtureV1(input: {
  creator: { scope: WorkspaceScope; buildId: number; productionKey: string }
  pinBundle: TextOpenWorldSourcePinBundleV1
  runtimePackage: ProductRuntimePackageV1
}) {
  const { scope, buildId, productionKey } = input.creator
  const build = await db.productBuilds.get(buildId)
  if (!build) throw new Error('Release lifecycle fixture Build missing')
  const contract = async (taskKey: string, parentRunId?: number) => ({
    version: 1,
    objective: `Isolated Release lifecycle fixture: ${taskKey}`,
    workflowKind: 'long-running-resumable',
    ...(parentRunId === undefined ? {} : { ownership: { parentRunId, relation: `task:${taskKey}` } }),
    scope: { projectId: scope.projectId, worldGroupId: null, productProduction: {
      productBuildId: buildId, buildNumber: build.buildNumber,
      controlEpoch: build.controlEpoch, planHash: build.planHash, taskKey,
    } },
    permissions: { contextSourceKeys: ['product-production.brief'], writeTargets: [] },
    runtimeBindingHash: await hashProductProductionValueV2({ fixture: 'release-lifecycle', taskKey }),
    dependencyReceiptPolicy: { requiredForJoin: true, verifierSetVersion: 'release-lifecycle-fixture-v1' },
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 1, maxOutputTokens: 1, maxAttemptsPerStep: 1 },
    acceptance: [{ id: 'fixture.output', kind: 'output-present', required: true }],
    verificationPlan: [{ id: 'fixture.terminal', kind: 'terminal',
      verifier: 'release-lifecycle-fixture-v1', criterionIds: ['fixture.output'] }],
    failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
  })
  const begin = async (taskKey: string, parentRunId?: number) => {
    const run = await createAgentRunV1({
      scope, productBuildId: buildId, contract: await contract(taskKey, parentRunId),
    })
    await appendAgentRunEventV1({ scope, runId: run.run.id, type: 'step.scheduled', payload: { stepId: taskKey } })
    await appendAgentRunEventV1({ scope, runId: run.run.id, type: 'step.started', payload: { stepId: taskKey, attempt: 1 } })
    return run.run.id
  }
  const finish = async (runId: number, stepId: string, receiptHash: string) => {
    await appendAgentRunEventV1({ scope, runId, type: 'step.succeeded', payload: { stepId, attempt: 1, outputHash: receiptHash } })
    await appendAgentRunEventV1({ scope, runId, type: 'verification.started', payload: { verifierSetVersion: 'release-lifecycle-fixture-v1' } })
    await appendAgentRunEventV1({ scope, runId, type: 'verification.accepted', payload: { receiptHash } })
  }
  const rootRunId = await begin('$root')
  const taskKey = 'p0.source-lock'
  const runId = await begin(taskKey, rootRunId)
  const sourceArtifacts = await acceptTextOpenWorldSourcePinBundleV1({
    scope, buildId, controlEpoch: build.controlEpoch, bundle: input.pinBundle,
  })
  const artifacts = [sourceArtifacts.pinArtifact, ...sourceArtifacts.unitArtifacts]
  const taskReceiptHash = await hashProductProductionValueV2({
    fixture: 'release-lifecycle.source-lock',
    artifacts: artifacts.map(row => ({ key: row.artifactKey, hash: row.contentHash })),
  })
  for (const row of artifacts) {
    row.producerRunId = runId
    row.producerReceiptHash = taskReceiptHash
    await db.productBuildArtifacts.update(row.id!, {
      producerRunId: row.producerRunId, producerReceiptHash: row.producerReceiptHash,
    })
  }
  await finish(runId, taskKey, taskReceiptHash)
  const usage = { modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0,
    costUsd: 0, durationMs: 0, storageBytes: artifacts.reduce((sum, row) => sum + row.byteSize, 0) }
  const task = { runId, attempt: 1, status: 'settled', idempotencyKey: input.pinBundle.pin.pinHash,
    candidateHash: taskReceiptHash, terminalReceiptHash: taskReceiptHash,
    passedGateIds: [], usage, errorCode: null }
  const budgetLedgerJson = canonicalProductProductionJsonV2({
    schema: 'storyforge.product-production-budget-ledger', version: 2,
    rootRunId, rootClaim: null, tasks: { [taskKey]: task },
    attempts: [{ controlEpoch: build.controlEpoch, taskKey, runId, attempt: 1,
      idempotencyKey: task.idempotencyKey, outcome: 'settled', usage, usageKnown: true, errorCode: null }],
  })
  const packageHash = await hashProductProductionValueV2(input.runtimePackage)
  const manifest = {
    schema: 'storyforge.product-build-manifest', version: 1, productionKey,
    buildNumber: build.buildNumber, briefRevision: build.briefRevision, briefHash: build.briefHash,
    planHash: build.planHash, controlEpoch: build.controlEpoch, runtimePackageHash: packageHash,
    artifactReceipts: artifacts.map(row => ({ artifactKey: row.artifactKey, version: row.version,
      contentHash: row.contentHash, producerReceiptHash: row.producerReceiptHash })),
    completedGateIds: [], fallbackSummary: [],
  }
  const manifestHash = await hashProductProductionValueV2(manifest)
  const preview = await createProductBuildPreviewManifestV1({
    productionKey, buildNumber: build.buildNumber, buildManifestHash: manifestHash,
    runtimePackage: input.runtimePackage,
  })
  const quality = { fixture: 'release-lifecycle-only', packageHash }
  const qualityReportHash = await hashProductProductionValueV2(quality)
  const rootTerminalReceiptHash = await createProductBuildRootTerminalReceiptV1({
    planHash: build.planHash, manifestHash, packageHash, qualityReportHash,
    controlEpoch: build.controlEpoch, budgetLedgerJson, artifacts,
  })
  await finish(rootRunId, '$root', rootTerminalReceiptHash)
  await db.productBuilds.update(buildId, {
    budgetLedgerJson, manifestJson: canonicalProductProductionJsonV2(manifest), manifestHash,
    packageHash, previewManifestJson: canonicalProductProductionJsonV2(preview), previewHash: preview.previewHash,
    qualityReportJson: canonicalProductProductionJsonV2(quality), qualityReportHash, rootTerminalReceiptHash,
  })
  return { sourceArtifacts, manifestHash, previewHash: preview.previewHash, qualityReportHash, rootTerminalReceiptHash }
}
