/** Author-only read model. GM seats and installed copies do not establish production ownership. */
import { db } from '../db/schema'
import type { WorkspaceScope, ProductRuntimeSession } from '../types'
import { resolveScope, assertRecordInScope } from '../workspace/scope'
import { verifyProductRuntimeSessionSourceV1, verifyProductRuntimeSource } from '../product-production/preview-source'
import { verifyProductReleaseManifestV1 } from '../product-production/runtime-package'
import { assertInstanceBinding, readBoundInstances } from '../product/runtime-instances'
import { readProductRuntimeState, readProductRuntimeStateVersion } from '../product/runtime-core'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { nextTtrpgOpenOperationStepV1 } from './open-operation'
import { TTRPG_OPEN_GATE_KEYS } from './open-gates'
import type { TtrpgOpenGateKeyV1 } from './open-gates'

export const TTRPG_OPEN_AUTHOR_GATE_LABELS: Record<TtrpgOpenGateKeyV1, string> = {
  'exit-exists': '存在可行动出口', 'hypothesis-formable': '线索能够形成假设',
  'telegraph-complete': '威胁预警完整', 'facts-consistent': '事实一致',
}
type Locator = { scope: WorkspaceScope; productionId: number }
type SessionLocator = Locator & { sessionId: number }
async function readAuthorProduction(input: Locator) {
  const scope = await resolveScope({ scope: input.scope }), production = await db.productProductions.get(input.productionId)
  if (!production || !await assertRecordInScope(scope,'productProductions',production,{ owner: 'work' })) throw new Error('作者 Production 不存在或跨 Work')
  if (production.productType !== 'ttrpg') throw new Error('Production 不属于跑团产品入口')
  const buildHistory = await db.productBuilds.where('productionId').equals(input.productionId).toArray()
  for (const build of buildHistory) if (!await assertRecordInScope(scope,'productBuilds',build,{ owner: 'work' })) throw new Error('作者 Build 历史跨 Work')
  return { production,buildHistory }
}
type ProductionDetails = Awaited<ReturnType<typeof readAuthorProduction>>

async function ownedSource(input: Locator, details: ProductionDetails, session: ProductRuntimeSession) {
  if (session.kind !== 'ttrpg') return null
  const build = details.buildHistory.find(b => session.productBuildId != null
    ? b.id === session.productBuildId : b.releasedProductReleaseId != null && b.releasedProductReleaseId === session.productReleaseId)
  if (!build) return null
  if (session.productReleaseId != null) {
    const release = await db.productReleases.get(session.productReleaseId)
    if (!release || release.distributionProvenance || release.productionKey !== details.production.productionKey
      || release.productType !== 'ttrpg') return null
    const manifest = await verifyProductReleaseManifestV1(release.manifestJson,{ ttrpgProtocol: 2 })
    const provenance = manifest.productionProvenance
    if (build.status !== 'released' || !provenance || provenance.productionKey !== details.production.productionKey
      || provenance.buildNumber !== build.buildNumber || provenance.buildManifestHash !== build.manifestHash
      || !build.rootTerminalReceiptHash || provenance.rootTerminalReceiptHash !== build.rootTerminalReceiptHash) return null
    // Release.contentHash hashes its entire manifest, not just the runtime package.
    await verifyProductRuntimeSource({ scope: input.scope, source: { kind: 'build', productBuildId: build.id!, expectedPreviewHash: build.previewHash }, ttrpgProtocol: 2 })
  }
  await assertInstanceBinding(session.id!, input.scope)
  const source = await verifyProductRuntimeSessionSourceV1({ scope: input.scope, session, ttrpgProtocol: 2 })
  if (source.runtimeSourceHash !== session.runtimeSourceHash || source.packageHash !== build.packageHash) throw new Error('试玩来源与作者制作版本不一致')
  const content = source.runtimePackage.ttrpg
  if (!content || content.campaign.version !== 2 || content.campaign.runFormat !== 'open') return null
  return { productionKey: details.production.productionKey, buildNumber: build.buildNumber,
    briefHash: build.briefHash, packageHash: source.packageHash, runtimeSourceHash: source.runtimeSourceHash,
    sourceKind: session.productBuildId != null ? 'build' as const : 'release' as const,
    rulePackHash: content.rulePack.contentHash, worldReleaseHash: source.runtimePackage.sourceWorld.contentHash }
}

export async function listTtrpgOpenAuthorPlaytestsV1(input: Locator) {
  const details = await readAuthorProduction(input)
  const result: Array<{ sessionId: number; title: string; updatedAt: number; buildNumber: number; sourceKind: 'build' | 'release' }> = []
  for (const session of await readBoundInstances(input.scope)) {
    const source = await ownedSource(input, details, session)
    if (source) result.push({ sessionId: session.id!, title: session.title, updatedAt: session.updatedAt,
      buildNumber: source.buildNumber, sourceKind: source.sourceKind })
  }
  return result.sort((a,b) => b.updatedAt - a.updatedAt || b.sessionId - a.sessionId)
}

export async function readTtrpgOpenAuthorDiagnosticsV1(input: SessionLocator) {
  const details = await readAuthorProduction(input)
  const session = await assertInstanceBinding(input.sessionId, input.scope)
  const source = await ownedSource(input, details, session)
  if (!source) throw new Error('此记录没有当前作者作品的实际制作来源；导入副本不提供完整作者诊断')
  const before = await readProductRuntimeStateVersion(input.sessionId)
  const state = await readProductRuntimeState(input.sessionId)
  const after = await readProductRuntimeStateVersion(input.sessionId)
  if (stable(before) !== stable(after)) throw new Error('试玩记录已变化，请重新读取诊断')
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  if (!runtime?.openRun) throw new Error('此试玩尚未开始开放跑团')
  const run = runtime.openRun
  // Explicit projection: no input text, character profiles, model messages, seed, or provider configuration.
  const evaluations = (run.gateReceipts ?? []).map(r => ({ sourceRef: r.sourceRef,
    inherited: r.sourceRef.sessionKey !== runtime.sessionKey, ruleSourceRef: r.ruleSourceRef,
    terminalRef: r.terminalRef, authorizationEpochKey: r.authorizationEpochKey, actorKey: r.actorKey,
    stageRevision: r.result.stageRevision, evaluationBasisHash: r.result.evaluationBasisHash,
    allApplicablePassed: r.result.allApplicablePassed, requestAuthorReview: r.result.requestAuthorReview,
    gates: TTRPG_OPEN_GATE_KEYS.map(key => ({ key, label: TTRPG_OPEN_AUTHOR_GATE_LABELS[key],
      applicability: r.result.results[key].applicability, passed: r.result.results[key].passed,
      evidence: r.result.results[key].evidence, consecutiveFailures: r.result.consecutiveFailures[key] })) }))
  // Persisted append order spans branches; a child's low sequence must not lose to its ancestor.
  const latestByActor = new Map<string, typeof evaluations[number]>()
  for (const evaluation of evaluations) latestByActor.set(evaluation.actorKey,evaluation)
  const report = { schema: 'storyforge.ttrpg-open-author-diagnostics', version: 1,
    source, sessionKey: runtime.sessionKey, head: after,
    worldTurn: run.worldTime.worldTurn, stage: run.stage, safetyStatus: runtime.product.safety.status,
    latestEvaluations: [...latestByActor.values()], evaluations,
    recoveries: (run.gateRecoveries ?? []).map(r => ({ recoveryKey: r.recoveryKey, sourceRef: r.sourceRef,
      inherited: r.sourceRef.sessionKey !== runtime.sessionKey, operationKey: r.operationKey,
      authorizationEpochKey: r.authorizationEpochKey, actorKey: r.actorKey, gateKey: r.gateKey,
      evaluationRef: r.evaluationRef, evaluationBasisHash: r.evaluationBasisHash,
      action: r.action, targetRef: r.targetRef, result: r.result, reason: r.reason,
      stoppedRef: r.stoppedRef, failedEvaluationRefs: r.failedEvaluationRefs, stopReason: r.stopReason })),
    pendingOperations: run.operations.filter(o => o.status !== 'completed' && o.status !== 'rejected').map(o => ({
      operationKey: o.operationKey, frozenPlanHash: o.planHash, status: o.status,
      authorizationEpochKey: o.authorizationEpochKey, sourceRef: o.startedRef,
      nextStep: nextTtrpgOpenOperationStepV1(o), committedSteps: o.businessRefs.map(r => ({ stepKey: r.stepKey, sourceRef: r.sourceRef })) })),
  }
  // The receipt binds exactly what was displayed, including version and qualified branch sources.
  return { report, receipt: stable(report) }
}
export type TtrpgOpenAuthorDiagnosticsV1 = Awaited<ReturnType<typeof readTtrpgOpenAuthorDiagnosticsV1>>
async function fresh(input: SessionLocator & { expectedReceipt: string }) {
  const current = await readTtrpgOpenAuthorDiagnosticsV1(input)
  if (current.receipt !== input.expectedReceipt) throw new Error('诊断已过期，请重新读取后再导出或加入修订')
  return current.report
}
export async function exportTtrpgOpenAuthorDiagnosticsV1(input: SessionLocator & { expectedReceipt: string }) {
  const report = await fresh(input)
  return { filename: `ttrpg-author-diagnostics-build-${report.source.buildNumber}.json`, content: JSON.stringify(report,null,2) }
}
export async function draftTtrpgOpenAuthorRevisionV1(input: SessionLocator & { expectedReceipt: string }) {
  const report = await fresh(input)
  const lines = [`试玩诊断修订依据（不会修改已有发布或存档）`,
    `作品 ${report.source.productionKey}，制作第 ${report.source.buildNumber} 版（${report.source.sourceKind}）。`,
    `内容 ${report.source.packageHash}；Brief ${report.source.briefHash}；世界 ${report.source.worldReleaseHash}；规则 ${report.source.rulePackHash}。`,
    `试玩 ${report.sessionKey}，记录 ${report.head.sequence}，状态 ${report.head.stateHash}，世界回合 ${report.worldTurn}。`]
  let failures = 0
  for (const evaluation of report.latestEvaluations) for (const gate of evaluation.gates) if (gate.applicability === 'applicable' && gate.passed === false) {
    failures++
    lines.push(`角色 ${evaluation.actorKey}：${gate.label}未通过；连续失败 ${gate.consecutiveFailures} 次；来源 ${evaluation.sourceRef.sessionKey}:${evaluation.sourceRef.sequence}；依据 ${evaluation.evaluationBasisHash}。`,...gate.evidence.map(e => `依据：${e}`))
  }
  if (!failures) lines.push('当前最新检查没有失败质量门；不得据此声称真实玩家或长局验收完成。请补充需要修改的问题。')
  for (const recovery of report.recoveries) if (recovery.stoppedRef) lines.push(`已停止的恢复 ${recovery.recoveryKey}：${recovery.result}；${recovery.stopReason}；来源 ${recovery.stoppedRef.sessionKey}:${recovery.stoppedRef.sequence}。`)
  lines.push('请依据上述实际版本修订内容，保留原设计和决策记录；不要改写已提交的运行事实或用提示词强行宣告质量门通过。')
  const text = lines.join('\n'), suffix = '\n[修订摘录已截短；完整来源、检查历史和恢复记录请使用导出的诊断 JSON。]'
  return text.length <= 10000 ? text : text.slice(0,10000 - suffix.length) + suffix
}
