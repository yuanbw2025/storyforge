/** Portable Session Zero authority. No local row IDs, model calls or writes. */
import type { TtrpgSessionParticipantRecordV2 } from '../types'
import type { TtrpgCampaignContentV2 } from './open-contract'
import { bool as boolean, integer, key, list, record } from './open-contract-parse'
import { stableProductRuntimeJsonV1 } from '../product/runtime-values'
import { parseTtrpgOpenSourceRefV1, type TtrpgOpenSourceRefV1 } from './open-coordination'

type Consent = TtrpgSessionParticipantRecordV2['consent']
const CONSENT_KEYS = [
  'safetyBoundariesAccepted', 'aiIdentityDisclosed', 'aiAdviceAllowed',
  'aiSubstitutionAllowed', 'pvpAllowed', 'characterDeathAllowed',
  'sessionLoggingAllowed', 'generatedPortraitAllowed', 'publicSharingAllowed',
] as const

export interface TtrpgOpenSeatAuthorityV1 {
  seatKey: string
  actorKey: string | null
  viewerKey: string
  role: 'gm' | 'player'
  controller: 'human' | 'ai' | 'hybrid'
  assignmentState: 'assigned' | 'claimed'
  revision: number
  sessionZeroAcceptedAtSequence: number
  consent: Consent
}

export interface TtrpgOpenAuthorizationV1 {
  schema: 'storyforge.ttrpg-open-authorization'
  version: 1
  revision: number
  sourceRef: TtrpgOpenSourceRefV1
  completedBySeatKey: string
  viewerKey: string
  selectedActorKeys: string[]
  seats: TtrpgOpenSeatAuthorityV1[]
  approvalBindings: TtrpgCampaignContentV2['companionPolicy']['approvalBindings']
}

function fail(message: string): never { throw new Error(`[ttrpg-open-authorization] ${message}`) }
function parseSeat(value: unknown): TtrpgOpenSeatAuthorityV1 {
  const row = record(value, ['seatKey', 'actorKey', 'viewerKey', 'role', 'controller',
    'assignmentState', 'revision', 'sessionZeroAcceptedAtSequence', 'consent'], 'seat authority')
  if (row.role !== 'gm' && row.role !== 'player') fail('活动席位角色无效')
  if (row.controller !== 'human' && row.controller !== 'ai' && row.controller !== 'hybrid') fail('活动席位控制权无效')
  if (row.assignmentState !== 'assigned' && row.assignmentState !== 'claimed') fail('活动席位不可用')
  const consent = record(row.consent, CONSENT_KEYS, 'seat consent')
  const parsedConsent: Consent = {
    safetyBoundariesAccepted: boolean(consent.safetyBoundariesAccepted, 'safetyBoundariesAccepted'),
    aiIdentityDisclosed: boolean(consent.aiIdentityDisclosed, 'aiIdentityDisclosed'),
    aiAdviceAllowed: boolean(consent.aiAdviceAllowed, 'aiAdviceAllowed'),
    aiSubstitutionAllowed: boolean(consent.aiSubstitutionAllowed, 'aiSubstitutionAllowed'),
    pvpAllowed: boolean(consent.pvpAllowed, 'pvpAllowed'),
    characterDeathAllowed: boolean(consent.characterDeathAllowed, 'characterDeathAllowed'),
    sessionLoggingAllowed: boolean(consent.sessionLoggingAllowed, 'sessionLoggingAllowed'),
    generatedPortraitAllowed: boolean(consent.generatedPortraitAllowed, 'generatedPortraitAllowed'),
    publicSharingAllowed: boolean(consent.publicSharingAllowed, 'publicSharingAllowed'),
  }
  if (!parsedConsent.safetyBoundariesAccepted || !parsedConsent.aiIdentityDisclosed) fail('席位尚未接受安全约定或 AI 身份披露')
  if (row.controller !== 'ai' && row.assignmentState !== 'claimed') fail('真人席位必须显式 claimed')
  const actorKey = row.actorKey === null ? null : key(row.actorKey, 'actorKey')
  if ((row.role === 'player') !== (actorKey !== null)) fail('席位角色与 actor 不一致')
  return {
    seatKey: key(row.seatKey, 'seatKey'), actorKey, viewerKey: key(row.viewerKey, 'viewerKey'),
    role: row.role, controller: row.controller, assignmentState: row.assignmentState,
    revision: integer(row.revision, 'seat.revision', 1, Number.MAX_SAFE_INTEGER),
    sessionZeroAcceptedAtSequence: integer(row.sessionZeroAcceptedAtSequence, 'seat.acceptedAt', 1, Number.MAX_SAFE_INTEGER),
    consent: parsedConsent,
  }
}

export function parseTtrpgOpenAuthorizationV1(value: unknown): TtrpgOpenAuthorizationV1 {
  const row = record(value, ['schema', 'version', 'revision', 'sourceRef', 'completedBySeatKey', 'viewerKey',
    'selectedActorKeys', 'seats', 'approvalBindings'], 'open authorization')
  if (row.schema !== 'storyforge.ttrpg-open-authorization' || row.version !== 1) fail('授权 schema/version 无效')
  const revision = integer(row.revision, 'authorization.revision', 1, Number.MAX_SAFE_INTEGER)
  const sourceRef = parseTtrpgOpenSourceRefV1(row.sourceRef)
  if (sourceRef.sequence !== revision) fail('授权 sourceRef 与 revision 不一致')
  const selectedActorKeys = list(row.selectedActorKeys, 'selectedActorKeys', (v) => key(v, 'selected actor'), 1000, 1)
  const seats = list(row.seats, 'seats', parseSeat, 1001, 2)
  if (new Set(selectedActorKeys).size !== selectedActorKeys.length
    || new Set(seats.map(seat => seat.seatKey)).size !== seats.length
    || new Set(seats.map(seat => seat.viewerKey)).size !== seats.length
    || seats.filter(seat => seat.role === 'gm').length !== 1
    || seats.some(seat => seat.sessionZeroAcceptedAtSequence !== revision)
    || stableProductRuntimeJsonV1(seats.filter(seat => seat.role === 'player').map(seat => seat.actorKey).sort())
      !== stableProductRuntimeJsonV1([...selectedActorKeys].sort())) fail('授权席位与活动角色/revision 不一致')
  const completedBySeatKey = key(row.completedBySeatKey, 'completedBySeatKey')
  const viewerKey = key(row.viewerKey, 'viewerKey')
  const approver = seats.find(seat => seat.seatKey === completedBySeatKey && seat.viewerKey === viewerKey)
  if (!approver || approver.controller === 'ai' || approver.assignmentState !== 'claimed') fail('Session Zero 只能由已认领真人席位确认')
  const approvalBindings = list(row.approvalBindings, 'approvalBindings', value => {
    const binding = record(value, ['companionActorKey', 'approverSeatKeys', 'partyResourceApprovalAllowed'], 'approval binding')
    const companionActorKey = key(binding.companionActorKey, 'companionActorKey')
    const companion = seats.find(seat => seat.actorKey === companionActorKey && seat.role === 'player')
    if (!companion || !['ai', 'hybrid'].includes(companion.controller)) fail('批准关系的队友不在 AI/hybrid 活动席位中')
    const approverSeatKeys = list(binding.approverSeatKeys, 'approverSeatKeys', v => key(v, 'approver seat'), 1000, 1)
    if (new Set(approverSeatKeys).size !== approverSeatKeys.length || approverSeatKeys.some(seatKey => {
      const seat = seats.find(item => item.seatKey === seatKey)
      return !seat || seat.controller === 'ai' || seat.assignmentState !== 'claimed'
    })) fail('AI 队友必须绑定已确认的真人批准席位，禁止 AI 自批')
    return { companionActorKey, approverSeatKeys, partyResourceApprovalAllowed: boolean(binding.partyResourceApprovalAllowed, 'partyResourceApprovalAllowed') }
  }, 1000, 0)
  const companions = seats.filter(seat => seat.role === 'player' && ['ai', 'hybrid'].includes(seat.controller)).map(seat => seat.actorKey).sort()
  if (new Set(approvalBindings.map(binding => binding.companionActorKey)).size !== approvalBindings.length
    || stableProductRuntimeJsonV1(approvalBindings.map(binding => binding.companionActorKey).sort()) !== stableProductRuntimeJsonV1(companions)) {
    fail('每名活动 AI/hybrid 队友必须恰有一项真人批准关系')
  }
  return { schema: 'storyforge.ttrpg-open-authorization', version: 1, revision, sourceRef,
    completedBySeatKey, viewerKey, selectedActorKeys, seats, approvalBindings }
}

function seatProjection(row: TtrpgSessionParticipantRecordV2): Record<string, unknown> {
  return { seatKey: row.seatKey, actorKey: row.actorKey, viewerKey: row.viewerKey,
    role: row.role, controller: row.controller, assignmentState: row.assignmentState,
    revision: row.revision, sessionZeroAcceptedAtSequence: row.sessionZeroAcceptedAtSequence,
    consent: structuredClone(row.consent) }
}

export function createTtrpgOpenAuthorizationV1(input: {
  campaign: TtrpgCampaignContentV2
  participants: TtrpgSessionParticipantRecordV2[]
  selectedActorKeys: string[]
  viewerKey: string
  sequence: number
  sessionKey: string
}): TtrpgOpenAuthorizationV1 {
  const selected = new Set(input.selectedActorKeys)
  const active = input.participants.filter(seat => seat.role === 'gm' || (seat.actorKey !== null && selected.has(seat.actorKey)))
  const approver = active.find(seat => seat.viewerKey === input.viewerKey)
  if (!approver || approver.controller === 'ai' || approver.assignmentState !== 'claimed') fail('Session Zero 只能由已认领真人席位确认')
  const allowed = new Set(input.campaign.characterTemplates.filter(actor => actor.role === 'player').map(actor => actor.characterKey))
  if (selected.size !== input.selectedActorKeys.length || selected.size < input.campaign.playerCount.minimum
    || selected.size > input.campaign.playerCount.maximum || [...selected].some(actor => !allowed.has(actor))) fail('活动角色不属于冻结名单或人数范围')
  const companions = active.filter(seat => seat.role === 'player' && ['ai', 'hybrid'].includes(seat.controller))
  if (companions.length < input.campaign.companionPolicy.minimumCompanions
    || companions.length > input.campaign.companionPolicy.maximumCompanions) fail('活动队友人数不满足冻结合作策略')
  const companionKeys = new Set(companions.map(seat => seat.actorKey))
  return parseTtrpgOpenAuthorizationV1({
    schema: 'storyforge.ttrpg-open-authorization', version: 1, revision: input.sequence,
    sourceRef: { sessionKey: input.sessionKey, sequence: input.sequence },
    completedBySeatKey: approver.seatKey, viewerKey: input.viewerKey,
    selectedActorKeys: [...input.selectedActorKeys],
    seats: active.map(seat => ({ ...seatProjection(seat), revision: seat.revision + 1,
      sessionZeroAcceptedAtSequence: input.sequence,
      consent: { ...seat.consent, safetyBoundariesAccepted: true } })),
    approvalBindings: structuredClone(input.campaign.companionPolicy.approvalBindings.filter(binding => companionKeys.has(binding.companionActorKey))),
  })
}

/** Shared current-row check; read-only actor views do not grant approval authority. */
export function assertTtrpgOpenAuthorizationRowsCurrentV1(input: {
  authorization: TtrpgOpenAuthorizationV1
  participants: TtrpgSessionParticipantRecordV2[]
}): TtrpgOpenAuthorizationV1 {
  const authorization = parseTtrpgOpenAuthorizationV1(input.authorization)
  const expected = [...authorization.seats].sort((a, b) => a.seatKey.localeCompare(b.seatKey))
  const selected = new Set(authorization.selectedActorKeys)
  const actual = input.participants.filter(seat => seat.role === 'gm' || (seat.actorKey !== null && selected.has(seat.actorKey)))
    .map(seatProjection).sort((a, b) => String(a.seatKey).localeCompare(String(b.seatKey)))
  if (stableProductRuntimeJsonV1(actual) !== stableProductRuntimeJsonV1(expected)) fail('授权席位 revision/控制权/同意策略已变化，计划 stale')
  return authorization
}

export function assertTtrpgOpenAuthorizationCurrentV1(input: {
  authorization: TtrpgOpenAuthorizationV1
  participants: TtrpgSessionParticipantRecordV2[]
  viewerKey: string
}): TtrpgOpenSeatAuthorityV1 {
  const authorization = assertTtrpgOpenAuthorizationRowsCurrentV1(input)
  const actor = authorization.seats.find(seat => seat.viewerKey === input.viewerKey)
  if (!actor || actor.controller === 'ai' || actor.assignmentState !== 'claimed') fail('当前 viewer 没有真人主持授权')
  return actor
}

/** Human host authority is independent of permission to send private data to a model. */
export function assertTtrpgOpenHumanHostV1(authorization: TtrpgOpenAuthorizationV1, viewerKey: string): TtrpgOpenSeatAuthorityV1 {
  const seat = authorization.seats.find(s => s.viewerKey === viewerKey), gm = authorization.seats.find(s => s.role === 'gm')
  if (!seat || !gm || seat.controller === 'ai' || seat.assignmentState !== 'claimed' || (gm.controller === 'ai' ? seat.seatKey !== authorization.completedBySeatKey : seat.role !== 'gm')) fail('人工主持需要真人 GM 或 AI GM 模式的 Session Zero 确认者')
  return seat
}
