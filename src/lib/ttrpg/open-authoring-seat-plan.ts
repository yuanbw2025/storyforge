/** Explicit S2 identity reservation, not an actor store or runtime authority.
 * The existing companionPolicy remains the sole approval relationship. Absence
 * leaves all original Settings/Brief/opaque character identities unchanged. */
import type { TtrpgProductionSeatV2 } from '../types'
import type { TtrpgAuthoringSettingsV2 } from './authoring-contract-v2'
import type { TtrpgOpenApprovalActorV1, TtrpgOpenCompanionPolicyV1 } from './open-contract'
import { validateTtrpgOpenApprovalBindingsV1 } from './open-content-references'
import * as p from './open-contract-parse'

export interface TtrpgOpenAuthoringSeatPlanV1 {
  schema: 'storyforge.ttrpg-open-authoring-seat-plan'; version: 1
  /** Snapshot detects later controller/role changes; wizard owns current seats.
   * These portable logical keys never refer to a physical DB row. */
  seats: Array<{ seatKey: string; characterKey: string; controller: 'human' | 'ai' | 'open' }>
}
type Seat = Pick<TtrpgProductionSeatV2, 'seatKey' | 'role' | 'controller'>

export function parseTtrpgOpenAuthoringSeatPlanV1(input: unknown): TtrpgOpenAuthoringSeatPlanV1 {
  const row = p.record(p.json(input), ['schema', 'version', 'seats'], 'authoringSeatPlan')
  const seats = p.list(row.seats, 'reserved player seats', value => {
    const seat = p.record(value, ['seatKey', 'characterKey', 'controller'], 'reserved player seat')
    const characterKey = p.key(seat.characterKey, 'reserved characterKey')
    if (characterKey === 'gm') p.fail('authoringSeatPlan: gm 是主持身份，不能预留为玩家角色')
    return { seatKey: p.key(seat.seatKey, 'reserved seatKey'), characterKey,
      controller: p.oneOf(seat.controller, ['human', 'ai', 'open'], 'reserved controller') }
  }, 12, 1)
  p.unique(seats.map(seat => seat.seatKey), 'reserved seat keys')
  p.unique(seats.map(seat => seat.characterKey), 'reserved character keys')
  return { schema: p.literal(row.schema, 'storyforge.ttrpg-open-authoring-seat-plan', 'seat plan schema'),
    version: p.literal(row.version, 1, 'seat plan version'), seats }
}

function players(input: readonly Seat[]) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 12) p.fail('authoringSeatPlan: 席位数量无效')
  for (const seat of input) {
    if (p.key(seat.seatKey, 'author seatKey') !== seat.seatKey) p.fail('authoringSeatPlan: 先明确修正原席位标识')
    p.oneOf(seat.role, ['player', 'assistant-gm'], 'author seat role')
    p.oneOf(seat.controller, ['human', 'ai', 'open'], 'author seat controller')
  }
  p.unique(input.map(seat => seat.seatKey), 'author seat keys')
  const result = input.filter(seat => seat.role === 'player')
  if (!result.length) p.fail('authoringSeatPlan: 至少需要一个玩家席位')
  return result
}

/** Pure proposal only. The author must separately select approvers, review and
 * save with the original draft service. No identities/approvals are auto-added. */
export function proposeTtrpgOpenAuthoringSeatPlanV1(input: {
  seats: readonly Seat[]; previous?: TtrpgOpenAuthoringSeatPlanV1
}): TtrpgOpenAuthoringSeatPlanV1 {
  const previous = input.previous ? parseTtrpgOpenAuthoringSeatPlanV1(input.previous) : null
  return parseTtrpgOpenAuthoringSeatPlanV1({ schema: 'storyforge.ttrpg-open-authoring-seat-plan', version: 1,
    seats: players(input.seats).map(seat => ({ seatKey: seat.seatKey, controller: seat.controller,
      characterKey: previous?.seats.find(prior => prior.seatKey === seat.seatKey)?.characterKey ?? `actor.reserved.${crypto.randomUUID()}` })) })
}

/** Drafts may retain a stale reservation while human edits are pending. Any
 * new source/model/production boundary must verify it against current seats. */
export function assertTtrpgOpenAuthoringSeatPlanCurrentV1(input: {
  plan: TtrpgOpenAuthoringSeatPlanV1; seats: readonly Seat[]; companionPolicy: TtrpgOpenCompanionPolicyV1 | null
}): TtrpgOpenAuthoringSeatPlanV1 {
  const plan = parseTtrpgOpenAuthoringSeatPlanV1(input.plan), current = players(input.seats)
  if (current.length !== plan.seats.length || plan.seats.some(reserved => !current.some(seat =>
    seat.seatKey === reserved.seatKey && seat.controller === reserved.controller)))
    p.fail('authoringSeatPlan: 席位或控制者已变化，请本人重新核对角色预留和批准关系')
  if (!input.companionPolicy) p.fail('authoringSeatPlan: 请先填写本桌队友边界')
  validateTtrpgOpenApprovalBindingsV1(input.companionPolicy, plan.seats.map(seat => ({ ...seat, role: 'player' })))
  return plan
}

/** A reserved key is not proof that the generated actor exists. Both candidate
 * parsing and final compilation compare the actual templates independently. */
export function assertTtrpgOpenAuthoringSeatPlanSystemV1(input: {
  settings: TtrpgAuthoringSettingsV2; characters: readonly TtrpgOpenApprovalActorV1[]
}): void {
  if (input.settings.runFormat !== 'open' || !input.settings.authoringSeatPlan) return
  const plan = assertTtrpgOpenAuthoringSeatPlanCurrentV1({ plan: input.settings.authoringSeatPlan,
    seats: input.settings.wizard.seats, companionPolicy: input.settings.openAuthoring.companionPolicy })
  const actual = input.characters.filter(character => character.role === 'player')
  if (actual.length !== plan.seats.length || plan.seats.some(seat => !actual.some(character =>
    character.seatKey === seat.seatKey && character.characterKey === seat.characterKey && character.controller === seat.controller)))
    p.fail('authoringSeatPlan: 实际角色身份、席位或控制者与作者确认的预留不一致')
  p.unique(input.characters.map(character => character.characterKey), 'actual character keys')
  p.unique(actual.map(character => character.seatKey), 'actual player seat keys')
}
