import {db} from '../db/schema'
import {resolveScope, assertRecordInScope} from '../workspace/scope'
import {assertProductReleaseUnchanged} from '../product/releases'
import {hashProductProductionValueV2} from '../product-production/hash'
import {hashProductRuntimeStateV1, readProductRuntimeState} from './runtime-api'
import {readResumableInteractionRunsV1} from './runtime-run-recovery'
import {compareChatReleaseUpgradeV1, type ChatReleaseUpgradeCompatibilityV1} from './release-upgrade-contract'
import type {ProductRuntimeState, WorkspaceScope} from '../types'

export interface ChatReleaseUpgradeRequestV1 {
  parentSessionId: number
  targetReleaseId: number
  expectedPlanHash: string
  commandId: string
}
export interface ChatReleaseUpgradePlanV1 {
  parentSessionId: number
  targetReleaseId: number
  sourceTitle: string
  targetTitle: string
  sourceSequence: number
  sourceStateHash: string
  compatibility: ChatReleaseUpgradeCompatibilityV1
  blockers: Array<'closed-save' | 'unfinished-run' | 'pending-edit' | 'pending-situation'>
  canCopy: boolean
  planHash: string
}

/** Capture all rows that can invalidate the player's confirmation, including
 * a run started without appending a runtime event. No credentials or raw model
 * output are exposed in the public preview. */
async function snapshot(parentSessionId: number, targetReleaseId: number) {
  const parent = await db.productRuntimeSessions.get(parentSessionId)
  if (!parent || parent.productReleaseId == null || parent.productBuildId != null || parent.kind !== 'character-interaction') {
    throw new Error('升级需要绑定正式角色聊天版本的存档')
  }
  return {
    parent,
    source: await db.productReleases.get(parent.productReleaseId),
    target: await db.productReleases.get(targetReleaseId),
    events: await db.productRuntimeEvents.where('sessionId').equals(parentSessionId).sortBy('sequence'),
    runs: (await db.agentRuns.where('productRuntimeSessionId').equals(parentSessionId).toArray()).sort((a, b) => a.id! - b.id!),
  }
}

export interface PreparedChatReleaseUpgradeV1 {
  scope: WorkspaceScope
  saved: Awaited<ReturnType<typeof snapshot>>
  state: ProductRuntimeState
  evidence: string
  plan: ChatReleaseUpgradePlanV1
}

export async function prepareChatReleaseUpgradeV1(input: {scope: WorkspaceScope; parentSessionId: number; targetReleaseId: number}): Promise<PreparedChatReleaseUpgradeV1> {
  const args = structuredClone(input), scope = await resolveScope({scope: args.scope})
  const saved = await snapshot(args.parentSessionId, args.targetReleaseId)
  if ((await db.works.get(scope.workId))?.kind !== 'character-interaction'
    || saved.parent.projectId !== scope.projectId || saved.parent.worldId !== scope.worldId || saved.parent.workId !== scope.workId
    || !saved.source || !saved.target
    || !await assertRecordInScope(scope, 'productReleases', saved.source, {owner: 'work'})
    || !await assertRecordInScope(scope, 'productReleases', saved.target, {owner: 'work'})) {
    throw new Error('升级的存档与两个版本必须属于当前角色聊天作品')
  }
  await assertProductReleaseUnchanged(saved.source.id!)
  await assertProductReleaseUnchanged(saved.target.id!)
  const compatibility = await compareChatReleaseUpgradeV1(saved.source.manifestJson, saved.target.manifestJson)
  const state = await readProductRuntimeState(saved.parent.id!)
  const initial = JSON.parse(saved.parent.initialStateJson)
  if (saved.parent.runtimeSourceHash !== compatibility.sourcePackageHash
    || initial.narrative?.contentHash !== compatibility.sourcePackageHash
    || initial.narrative?.sourceHash !== compatibility.sourcePackageHash
    || state.narrative?.version !== 2 || state.narrative.contentHash !== compatibility.sourcePackageHash
    || state.narrative.sourceHash !== compatibility.sourcePackageHash
    || !state.interaction) throw new Error('原存档与冻结版本的绑定不一致')
  const sourceStateHash = await hashProductRuntimeStateV1(state)
  const blockers: ChatReleaseUpgradePlanV1['blockers'] = []
  if (!['active', 'paused'].includes(saved.parent.status)) blockers.push('closed-save')
  if ((await readResumableInteractionRunsV1(scope, saved.parent.id!)).length) blockers.push('unfinished-run')
  if (state.interaction.chatNarrative?.pendingEdit) blockers.push('pending-edit')
  if (state.interaction.chatNarrative?.pendingSituation) blockers.push('pending-situation')
  const evidence = JSON.stringify(saved)
  const body = {parentSessionId: args.parentSessionId, targetReleaseId: args.targetReleaseId,
    sourceTitle: saved.parent.title, targetTitle: saved.target.label,
    sourceSequence: state.lastSequence, sourceStateHash, compatibility, blockers,
    canCopy: !blockers.length && compatibility.disposition === 'copy-preserving-story'}
  const plan: ChatReleaseUpgradePlanV1 = {...body, planHash: await hashProductProductionValueV2({
    schema: 'storyforge.chat-release-upgrade-plan', version: 1, scope, ...body,
    rowsHash: await hashProductProductionValueV2(evidence),
  })}
  const prepared = {scope, saved, state, evidence, plan}
  await assertChatReleaseUpgradeUnchangedV1(prepared)
  return prepared
}

/** Called again inside the shared session/event/run transaction. Changes to a
 * save, either release or the Harness ledger require a new explicit preview. */
export async function assertChatReleaseUpgradeUnchangedV1(prepared: PreparedChatReleaseUpgradeV1) {
  if (JSON.stringify(await snapshot(prepared.plan.parentSessionId, prepared.plan.targetReleaseId)) !== prepared.evidence) {
    throw new Error('存档、版本或生成任务已变化，请重新预览升级')
  }
}

export async function readChatReleaseUpgradePlanV1(input: {scope: WorkspaceScope; parentSessionId: number; targetReleaseId: number}) {
  return (await prepareChatReleaseUpgradeV1(input)).plan
}

/** The same explicit confirmation can be retried after a lost UI response.
 * Reusing its command for another parent, target or plan is a conflict. */
export async function readCompletedChatReleaseUpgradeV1(scope: WorkspaceScope, request: ChatReleaseUpgradeRequestV1) {
  const receipts = await db.productRuntimeEvents.where('type').equals('interaction.release.upgraded')
    .filter(event => event.projectId === scope.projectId && event.commandId === request.commandId).toArray()
  for (const receipt of receipts) {
    const child = await db.productRuntimeSessions.get(receipt.sessionId)
    if (!child || child.worldId !== scope.worldId || child.workId !== scope.workId) continue
    const body = JSON.parse(receipt.payloadJson)
    if (child.kind !== 'character-interaction' || child.parentSessionId !== request.parentSessionId
      || child.productReleaseId !== request.targetReleaseId || body.planHash !== request.expectedPlanHash
      || receipt.sequence !== 1 || receipt.baseSequence !== 0) throw new Error('升级命令已用于另一份存档或预览')
    return child
  }
  return null
}
