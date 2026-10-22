/** One volatile, unsubmitted UI draft per window. Never a persistent actor store,
 * an AI source, or a second Settings writer. It survives SPA unmount so browser
 * history cannot silently discard the author's unique proposed identities. */
import type { WorkspaceScope } from '../../lib/types'
import type { TtrpgAuthoringSettingsV2 } from '../../lib/ttrpg/authoring-contract-v2'
import { parseTtrpgAuthoringSettingsV2 } from '../../lib/ttrpg/authoring-contract-v2'
import type { TtrpgOpenAuthoringSeatPlanV1 } from '../../lib/ttrpg/open-authoring-seat-plan'
import { assertTtrpgOpenAuthoringSeatPlanCurrentV1, parseTtrpgOpenAuthoringSeatPlanV1,
  proposeTtrpgOpenAuthoringSeatPlanV1 } from '../../lib/ttrpg/open-authoring-seat-plan'
import type { TtrpgOpenCompanionPolicyV1 } from '../../lib/ttrpg/open-contract'
import { companionPolicy } from '../../lib/ttrpg/open-content-templates'
import { registerPendingDraftFlusherV1 } from '../../lib/authoring/pending-edit-coordinator'

export type OpenSeatSettings = Extract<TtrpgAuthoringSettingsV2, { runFormat: 'open' }>
export interface SeatApprovalProposal {
  plan: TtrpgOpenAuthoringSeatPlanV1
  policy: TtrpgOpenCompanionPolicyV1
  manualIdentity: boolean
  removalConfirmed: boolean
}
export interface SeatApprovalDraft {
  owner: WorkspaceScope
  revision: number
  basis: string
  original: { plan?: TtrpgOpenAuthoringSeatPlanV1; policy: TtrpgOpenCompanionPolicyV1 }
  proposal: SeatApprovalProposal
  applied: boolean
  expected: string | null
}
export const seatApprovalOwnerKey = (scope: WorkspaceScope) => `${scope.projectId}:${scope.worldId}:${scope.workId}`
export const seatApprovalFingerprint = (settings: OpenSeatSettings) => {
  const canonical = parseTtrpgAuthoringSettingsV2(settings)
  if (canonical.runFormat !== 'open') throw new Error('批准配置只适用于开放跑团')
  return JSON.stringify({ seats: canonical.wizard.seats, plan: canonical.authoringSeatPlan ?? null,
    policy: canonical.openAuthoring.companionPolicy })
}
export function matchesSeatApprovalFingerprint(settings: OpenSeatSettings, expected: string | null) {
  try { return expected !== null && seatApprovalFingerprint(settings) === expected } catch { return false }
}

export function proposeSeatApprovalDraft(owner: WorkspaceScope, revision: number, settings: OpenSeatSettings, useExistingIdentities = false): SeatApprovalDraft {
  const policy = settings.openAuthoring.companionPolicy
  if (!policy) throw new Error('请先到开场设定填写本桌边界草稿')
  const plan = proposeTtrpgOpenAuthoringSeatPlanV1({ seats: settings.wizard.seats, previous: settings.authoringSeatPlan })
  // Old opaque actor identities cannot be inferred from seat order or a name.
  const manualIdentity = !settings.authoringSeatPlan && (useExistingIdentities || policy.approvalBindings.length > 0)
  if (manualIdentity) plan.seats.forEach(seat => { seat.characterKey = '' })
  return { owner: { ...owner }, revision, basis: seatApprovalFingerprint(settings),
    original: structuredClone({ plan: settings.authoringSeatPlan, policy }),
    proposal: { plan, policy: structuredClone(policy), manualIdentity, removalConfirmed: false }, applied: false, expected: null }
}

export function removedSeatApprovalKeys(draft: SeatApprovalDraft): string[] {
  const next = new Set(draft.proposal.plan.seats.map(seat => seat.characterKey.trim()))
  const nextAi = new Set(draft.proposal.plan.seats.filter(seat => seat.controller === 'ai').map(seat => seat.characterKey.trim()))
  return [...new Set([...(draft.original.plan?.seats.map(seat => seat.characterKey).filter(key => !next.has(key)) ?? []),
    ...draft.original.policy.approvalBindings.map(binding => binding.companionActorKey).filter(key => !nextAi.has(key))])]
}

export function reviewSeatApprovalDraft(draft: SeatApprovalDraft, owner: WorkspaceScope, revision: number,
  settings: OpenSeatSettings): { plan: TtrpgOpenAuthoringSeatPlanV1; policy: TtrpgOpenCompanionPolicyV1 } {
  if (seatApprovalOwnerKey(draft.owner) !== seatApprovalOwnerKey(owner) || draft.revision !== revision)
    throw new Error('作品或原编辑版本已变化；请下载待确认副本，再清除副本并重新核对')
  const fingerprint = seatApprovalFingerprint(settings)
  if (fingerprint !== draft.basis && !(draft.applied && fingerprint === draft.expected))
    throw new Error('席位或原批准关系已变化；待确认副本仍保留，请重新核对')
  if (removedSeatApprovalKeys(draft).length && !draft.proposal.removalConfirmed)
    throw new Error('请明确核对将移除的旧角色预留和批准关系')
  const plan = parseTtrpgOpenAuthoringSeatPlanV1(draft.proposal.plan)
  const aiKeys = new Set(plan.seats.filter(seat => seat.controller === 'ai').map(seat => seat.characterKey))
  const policy = companionPolicy({ ...draft.proposal.policy,
    approvalBindings: draft.proposal.policy.approvalBindings.filter(binding => aiKeys.has(binding.companionActorKey.trim())) }, 'companionPolicy')
  assertTtrpgOpenAuthoringSeatPlanCurrentV1({ plan, seats: settings.wizard.seats, companionPolicy: policy })
  return { plan, policy }
}

let draft: SeatApprovalDraft | null = null
let host: { token: symbol; owner: string; fingerprint: string; revision: number } | null = null
let unregister: (() => void) | null = null
const listeners = new Set<() => void>()
const notify = () => { for (const listener of listeners) listener() }
const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
export const readSeatApprovalDraft = () => draft
export function subscribeSeatApprovalDraft(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function beginSeatApprovalDraft(next: SeatApprovalDraft) {
  if (draft) throw new Error('已有另一份待确认配置，请先恢复或清除其暂存副本')
  draft = structuredClone(next)
  unregister = registerPendingDraftFlusherV1(() => {
    if (!draft || (draft.applied && host?.owner === seatApprovalOwnerKey(draft.owner) &&
      host.revision === draft.revision && host.fingerprint === draft.expected)) return
    throw new Error('AI 队友批准配置尚未应用或已离开原作品；请到跑团作品库恢复或清除待确认副本')
  })
  window.addEventListener('beforeunload', beforeUnload)
  notify()
}
export function updateSeatApprovalDraft(expected: SeatApprovalDraft, proposal: SeatApprovalProposal) {
  if (draft !== expected) throw new Error('待确认配置已变化，请重新核对')
  if (draft.applied) throw new Error('配置已应用到表单；请先保存或清除暂存副本')
  draft = { ...draft, proposal: structuredClone(proposal) }; notify()
}
export function markSeatApprovalApplied(expected: SeatApprovalDraft, settings: OpenSeatSettings) {
  if (draft !== expected) throw new Error('待确认配置已变化，请重新核对')
  draft = { ...draft, applied: true, expected: seatApprovalFingerprint(settings) }; notify()
}
export function setSeatApprovalHost(owner: WorkspaceScope, revision: number, settings: OpenSeatSettings) {
  const token = Symbol('seat-approval-host')
  // A temporarily invalid human form must block formal work, never crash React.
  try { host = { token, owner: seatApprovalOwnerKey(owner), revision, fingerprint: seatApprovalFingerprint(settings) } }
  catch { host = null }
  return () => { if (host?.token === token) host = null }
}
export function clearSeatApprovalDraft(expected: SeatApprovalDraft) {
  if (draft !== expected) throw new Error('待确认配置已变化，请重新核对')
  draft = null; unregister?.(); unregister = null
  window.removeEventListener('beforeunload', beforeUnload); notify()
}
/** Only an actual newer canonical save/readback can acknowledge this UI draft. */
export function acknowledgeSeatApprovalSave(owner: WorkspaceScope, revision: number, settings: OpenSeatSettings) {
  if (draft?.applied && draft.expected && seatApprovalOwnerKey(owner) === seatApprovalOwnerKey(draft.owner) &&
    revision > draft.revision && seatApprovalFingerprint(settings) === draft.expected) clearSeatApprovalDraft(draft)
}
