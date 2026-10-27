/** Normal author facade for the existing, proven same-Build resume command. */
import { db } from '../db/schema'
import type { ProductProductionCommandV1, TtrpgOpenContentRevisionV1, WorkspaceScope } from '../types'
import { readProductProductionDetailsV1 } from '../product-production/service'
import { parseProductProductionCommandV1 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { hashProductProductionValueV2, canonicalProductProductionJsonV2 } from '../product-production/hash'
import { executeProductProductionCommand } from '../product-production/commands'
import { prepareTtrpgOpenContentRevisionSourceV1 } from '../product-production/artifact-store'
import { resolveProductProductionTaskRecoveryPolicyV1 } from '../product-production/recovery-policy'

export interface TtrpgOpenContentRevisionViewV1 {
  scope: WorkspaceScope; productionId: number; buildId: number; controlEpoch: number
  expectedStateRevision: number; planHash: string
}
export interface TtrpgOpenContentRevisionOwnerV1 extends TtrpgOpenContentRevisionViewV1 {
  ledgerHash: string; failureHash: string
}
type Key = TtrpgOpenContentRevisionV1['artifactKey']
export const TTRPG_OPEN_CONTENT_REVISION_LABELS_V1: Record<Key, string> = {
  'ttrpg.open.source-facts': '来源事实', 'ttrpg.open.rule-system': '规则与角色', 'ttrpg.open.situation-layer': '局势与压力',
}
const keys = Object.keys(TTRPG_OPEN_CONTENT_REVISION_LABELS_V1) as Key[]
function fail(message: string): never { throw Error(`[ttrpg-content-revision] ${message}`) }
async function current(view: TtrpgOpenContentRevisionViewV1) {
  if ([view.scope.projectId, view.scope.worldId, view.scope.workId].some(id => !Number.isSafeInteger(id) || Number(id) < 1)) {
    fail('必须明确作品、世界和工作区，不能回退读取活动作品')
  }
  const details = await readProductProductionDetailsV1(view.scope, view.productionId, ['ttrpg'])
  const { build, production } = details
  if (!build || build.id !== view.buildId || build.status !== 'paused' || production.status !== 'paused'
    || !['building', 'recovery-required'].includes(build.resumeState ?? '') || build.releasedProductReleaseId != null
    || build.controlEpoch !== view.controlEpoch || production.controlEpoch !== view.controlEpoch
    || production.stateRevision !== view.expectedStateRevision || build.planHash !== view.planHash
    || production.currentBriefRevision !== build.briefRevision || !details.executionBrief?.ttrpgOpen) {
    fail('制作状态已变化；请先明确暂停当前未发布轮次，再重新读取原稿')
  }
  const plan = parseProductProductionPlanV3(build.planJson, details.executionBrief, build.briefHash)
  if (await hashProductProductionValueV2(plan) !== build.planHash) fail('原制作计划校验失败')
  const owner: TtrpgOpenContentRevisionOwnerV1 = { ...view,
    ledgerHash: await hashProductProductionValueV2(build.budgetLedgerJson),
    failureHash: await hashProductProductionValueV2(build.failureJson) }
  const rows = await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()
  const choices = keys.flatMap(artifactKey => {
    const task = plan.tasks.find(task => task.taskKey === artifactKey)
    if (!task || !resolveProductProductionTaskRecoveryPolicyV1({ productType: 'ttrpg', task }).authorDraftAllowed || task.reuse !== null) return []
    const matches = rows.filter(row => row.artifactKey === artifactKey && row.controlEpoch === plan.controlEpoch
      && ['accepted', 'carried-forward'].includes(row.status))
    if (matches.length !== 1 || matches[0].projectId !== view.scope.projectId || matches[0].worldId !== view.scope.worldId
      || matches[0].workId !== view.scope.workId || matches[0].carriedFrom != null && matches[0].carriedFrom.buildNumber !== build.buildNumber) return []
    return [{ artifactKey, version: matches[0].version, contentHash: matches[0].contentHash }]
  })
  const { readProductProductionUnreportedFailedAttemptsV1 } = await import('../product-production/scheduler')
  return { details, build: { ...build, id: build.id! }, plan, owner, choices,
    unreportedFailedCount: readProductProductionUnreportedFailedAttemptsV1(build.budgetLedgerJson).length,
    needsAccounting: JSON.parse(build.failureJson).code === 'pause-provider-result-unknown' }
}
async function exact(owner: TtrpgOpenContentRevisionOwnerV1) {
  const result = await current(owner)
  if (canonicalProductProductionJsonV2(owner) !== canonicalProductProductionJsonV2(result.owner)) fail('原用量或暂停记录已变化，请重新读取')
  return result
}
export async function inspectTtrpgOpenContentRevisionV1(view: TtrpgOpenContentRevisionViewV1) {
  const { owner, choices, needsAccounting, unreportedFailedCount, details } = await current(view)
  return { owner, choices, needsAccounting, unreportedFailedCount, brief: details.executionBrief!.ttrpgOpen! }
}
export async function readTtrpgOpenContentRevisionDraftV1(input: { owner: TtrpgOpenContentRevisionOwnerV1; artifactKey: Key }) {
  const before = await exact(input.owner), selected = before.choices.find(row => row.artifactKey === input.artifactKey)
  if (!selected) fail('此岗位当前没有唯一可返修的已采用原稿')
  const source = await prepareTtrpgOpenContentRevisionSourceV1({ scope: input.owner.scope, build: before.build,
    artifactKey: selected.artifactKey, version: selected.version, contentHash: selected.contentHash })
  if (source.artifact.payloadJson.length > 120_000) fail('完整原稿超过修订上限，不能自动裁剪')
  await source.assertCurrent(); await exact(input.owner)
  return { ...selected, owner: input.owner, authorDraftJson: source.artifact.payloadJson }
}
export async function prepareTtrpgOpenContentRevisionProposalV1(input: {
  source: Awaited<ReturnType<typeof readTtrpgOpenContentRevisionDraftV1>>
  authorDraftJson: string; note: string; commandId: string
}) {
  const before = await exact(input.source.owner)
  if (before.needsAccounting) fail('暂停时仍有在途请求；请先用现有费用核对入口明确处理，再暂停返修')
  if (before.unreportedFailedCount) fail('旧失败仍有未报告用量；请先单独核对原始证据，再载入原稿返修')
  const impact = await (await import('./open-production-content-revision-impact')).inspectTtrpgOpenContentRevisionImpactV1({
    scope: input.source.owner.scope, buildId: before.build.id, plan: before.plan, fromControlEpoch: before.plan.controlEpoch,
    sourcePlanHash: before.build.planHash, artifactKey: input.source.artifactKey })
  const command = parseProductProductionCommandV1({ type: 'resume', commandId: input.commandId,
    expectedStateRevision: input.source.owner.expectedStateRevision,
    ttrpgContentRevision: { artifactKey: input.source.artifactKey, expectedArtifactVersion: input.source.version,
      expectedArtifactHash: input.source.contentHash, expectedPlanHash: input.source.owner.planHash,
      expectedControlEpoch: input.source.owner.controlEpoch, expectedImpactHash: impact.impactHash, note: input.note, authorDraftJson: input.authorDraftJson } })
  if (command.type !== 'resume' || !command.ttrpgContentRevision) fail('修订命令格式无效')
  const blockedReason = impact.additionalTaskKeys.length > 0 ? 'upstream-version-changed' as const : null
  if (!blockedReason) await (await import('./open-production-content-revision')).prepareTtrpgOpenContentRevisionV1({
    scope: input.source.owner.scope, productionId: input.source.owner.productionId, build: before.build, command })
  await impact.assertCurrent(); await exact(input.source.owner)
  return { source: input.source, command, commandHash: await hashProductProductionValueV2(command),
    tasks: impact.tasks, additionalTaskKeys: impact.additionalTaskKeys, blockedReason }
}
export async function submitTtrpgOpenContentRevisionV1(proposal: Awaited<ReturnType<typeof prepareTtrpgOpenContentRevisionProposalV1>>) {
  if (proposal.blockedReason || proposal.additionalTaskKeys.length > 0) fail('上游执行版本已变化，请保留旧轮次并明确开始新一轮制作')
  const command = parseProductProductionCommandV1(proposal.command)
  if (command.type !== 'resume' || !command.ttrpgContentRevision
    || await hashProductProductionValueV2(command) !== proposal.commandHash) fail('已核对的修订内容已变化')
  const owner = proposal.source.owner
  // A lost return reuses the exact command; stale-view validation must not
  // obscure a durable receipt already committed by this same author action.
  const existing = await db.productProductionCommands.where('[productionId+commandId]').equals([owner.productionId, command.commandId]).first()
  if (!existing) {
    const checked = await prepareTtrpgOpenContentRevisionProposalV1({ source: proposal.source, commandId: command.commandId,
      authorDraftJson: command.ttrpgContentRevision.authorDraftJson, note: command.ttrpgContentRevision.note })
    if (checked.blockedReason || checked.commandHash !== proposal.commandHash || canonicalProductProductionJsonV2(checked.tasks) !== canonicalProductProductionJsonV2(proposal.tasks)
      || canonicalProductProductionJsonV2(checked.additionalTaskKeys) !== canonicalProductProductionJsonV2(proposal.additionalTaskKeys)) {
      fail('执行版本或实际影响已变化，请重新核对返修影响后提交')
    }
  }
  const receipt = await executeProductProductionCommand({ scope: owner.scope, productionId: owner.productionId, command: command as ProductProductionCommandV1 })
  if (!receipt.ok) fail(receipt.errorCode ?? '修订未提交，请刷新核对')
  return { receipt, details: await readProductProductionDetailsV1(owner.scope, owner.productionId, ['ttrpg']) }
}

/** Read-only preview of the separate historical bookkeeping command. */
export async function prepareTtrpgOpenLocalNoDispatchProposalV1(input: {
  source: Awaited<ReturnType<typeof readTtrpgOpenContentRevisionDraftV1>>; commandId: string
}) {
  const owner = input.source.owner, before = await exact(owner)
  if (before.needsAccounting) fail('暂停时仍有在途请求；请先通过原费用核对入口处理')
  if (!before.unreportedFailedCount) fail('当前没有待核对的旧未知记录，请重新载入原稿')
  const { inspectProductProductionLocalNoDispatchV1 } = await import('../product-production/local-no-dispatch-booking')
  const view = { expectedStateRevision: owner.expectedStateRevision, buildNumber: before.build.buildNumber,
    controlEpoch: owner.controlEpoch, planHash: owner.planHash,
    anchor: { artifactKey: input.source.artifactKey, version: input.source.version, contentHash: input.source.contentHash } }
  const inspected = await inspectProductProductionLocalNoDispatchV1({ scope: owner.scope, productionId: owner.productionId, view })
  if (inspected.ledgerHash !== owner.ledgerHash) fail('旧账本已变化，请重新载入原稿')
  const command = parseProductProductionCommandV1({ type: 'book-local-no-dispatch', commandId: input.commandId, ...view,
    ledgerHash: inspected.ledgerHash, proofs: inspected.candidates.map(row => ({ attemptKeyHash: row.attemptKeyHash, proofHash: row.proofHash })) })
  if (command.type !== 'book-local-no-dispatch') fail('旧失败核对命令格式无效')
  await inspected.assertCurrent(); await exact(owner)
  return { source: input.source, command, commandHash: await hashProductProductionValueV2(command),
    attempts: inspected.candidates.map(row => ({ taskKey: row.original.taskKey, attempt: row.original.attempt,
      controlEpoch: row.original.controlEpoch, classification: row.proof.classification, durationMs: row.durationMs })) }
}

export async function submitTtrpgOpenLocalNoDispatchV1(proposal: Awaited<ReturnType<typeof prepareTtrpgOpenLocalNoDispatchProposalV1>>) {
  const command = parseProductProductionCommandV1(proposal.command), owner = proposal.source.owner
  if (command.type !== 'book-local-no-dispatch' || await hashProductProductionValueV2(command) !== proposal.commandHash) {
    fail('已核对的旧失败处置已变化，请重新核对')
  }
  const existing = await db.productProductionCommands.where('[productionId+commandId]').equals([owner.productionId, command.commandId]).first()
  if (!existing) {
    const checked = await prepareTtrpgOpenLocalNoDispatchProposalV1({ source: proposal.source, commandId: command.commandId })
    if (checked.commandHash !== proposal.commandHash) fail('原失败证据已变化，请重新核对')
  }
  const receipt = await executeProductProductionCommand({ scope: owner.scope, productionId: owner.productionId, command })
  if (!receipt.ok) fail(receipt.errorCode ?? '旧失败核对未提交，请刷新核对')
  return { receipt, details: await readProductProductionDetailsV1(owner.scope, owner.productionId, ['ttrpg']) }
}
