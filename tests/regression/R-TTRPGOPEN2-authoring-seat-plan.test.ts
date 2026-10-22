import { describe, expect, it } from 'vitest'
import { defaultTtrpgSettingsV2, parseTtrpgAuthoringSettingsV2 } from '../../src/lib/ttrpg/authoring-contract-v2'
import { parseTtrpgSettings, serializeTtrpgSettings } from '../../src/lib/ttrpg/authoring-contract'
import { parseTtrpgOpenAuthoringSeatPlanV1, proposeTtrpgOpenAuthoringSeatPlanV1,
  assertTtrpgOpenAuthoringSeatPlanCurrentV1, assertTtrpgOpenAuthoringSeatPlanSystemV1 } from '../../src/lib/ttrpg/open-authoring-seat-plan'
import { openCampaignFixture } from '../helpers/ttrpg-open-content'

function setup() {
  const settings = defaultTtrpgSettingsV2('open'); if (settings.runFormat !== 'open') throw Error('format')
  settings.openAuthoring.companionPolicy = { minimumCompanions: 2, maximumCompanions: 3,
    preauthorizedActionKinds: [], confirmationRequiredKinds: ['irreversible', 'resource-spend', 'party-relation-change', 'secret-reveal'], approvalBindings: [] }
  const plan = proposeTtrpgOpenAuthoringSeatPlanV1({ seats: settings.wizard.seats })
  settings.authoringSeatPlan = plan
  settings.openAuthoring.companionPolicy.approvalBindings = plan.seats.filter(seat => seat.controller === 'ai').map(seat => ({
    companionActorKey: seat.characterKey, approverSeatKeys: [plan.seats.find(seat => seat.controller === 'human')!.seatKey], partyResourceApprovalAllowed: false }))
  const current = () => assertTtrpgOpenAuthoringSeatPlanCurrentV1({ plan, seats: settings.wizard.seats, companionPolicy: settings.openAuthoring.companionPolicy })
  return { settings, plan, current }
}
describe('R-TTRPGOPEN2 explicit versioned author-seat identity plan', () => {
  it('keeps absent old open/scripted Settings byte-stable and never adds a default reservation', () => {
    for (const format of ['open', 'scripted'] as const) {
      const settings = defaultTtrpgSettingsV2(format), before = serializeTtrpgSettings(settings).settingsJson
      expect(JSON.stringify(parseTtrpgAuthoringSettingsV2(JSON.parse(before)))).toBe(before)
      expect(serializeTtrpgSettings(settings).settingsJson).toBe(before)
      expect(Object.hasOwn(parseTtrpgSettings(settings), 'authoringSeatPlan')).toBe(false)
    }
  })
  it('proposes only portable logical identities, retains prior keys on explicit reconciliation, and grants no approvals itself', () => {
    const { settings, plan, current } = setup(); expect(current()).toEqual(plan)
    expect(plan.seats).toHaveLength(3); expect(new Set(plan.seats.map(seat => seat.characterKey)).size).toBe(3)
    expect(plan.seats.every(seat => seat.characterKey.startsWith('actor.reserved.'))).toBe(true)
    expect(proposeTtrpgOpenAuthoringSeatPlanV1({ seats: settings.wizard.seats, previous: plan })).toEqual(plan)
    expect(parseTtrpgAuthoringSettingsV2(settings)).toEqual(settings)
    expect(Object.hasOwn(plan, 'approvalBindings')).toBe(false)
  })
  it.each(['version', 'extra', 'duplicate-seat', 'duplicate-actor', 'gm', 'unknown-controller', 'null', 'scripted'] as const)('rejects %s without changing the source object', kind => {
    const { settings } = setup(), candidate: any = structuredClone(settings)
    if (kind === 'version') candidate.authoringSeatPlan.version = 2
    if (kind === 'extra') candidate.authoringSeatPlan.executionAllowed = true
    if (kind === 'duplicate-seat') candidate.authoringSeatPlan.seats[1].seatKey = candidate.authoringSeatPlan.seats[0].seatKey
    if (kind === 'duplicate-actor') candidate.authoringSeatPlan.seats[1].characterKey = candidate.authoringSeatPlan.seats[0].characterKey
    if (kind === 'gm') candidate.authoringSeatPlan.seats[0].characterKey = 'gm'
    if (kind === 'unknown-controller') candidate.authoringSeatPlan.seats[0].controller = 'root'
    if (kind === 'null') candidate.authoringSeatPlan = null
    if (kind === 'scripted') { candidate.runFormat = 'scripted'; candidate.openAuthoring = null }
    const before = JSON.stringify(candidate)
    expect(() => parseTtrpgAuthoringSettingsV2(candidate)).toThrow(); expect(JSON.stringify(candidate)).toBe(before)
  })
  it.each(['remove', 'controller', 'role', 'no-human', 'self', 'missing-approval'] as const)('retains a structurally valid human draft while refusing %s at a source/production boundary', kind => {
    const { settings, current } = setup(), policy = settings.openAuthoring.companionPolicy!
    if (kind === 'remove') settings.wizard.seats.pop()
    if (kind === 'controller') settings.wizard.seats[0].controller = 'open'
    if (kind === 'role') settings.wizard.seats[1].role = 'assistant-gm'
    if (kind === 'no-human') policy.approvalBindings[0].approverSeatKeys = ['player.3']
    if (kind === 'self') policy.approvalBindings[0].approverSeatKeys = ['player.2']
    if (kind === 'missing-approval') policy.approvalBindings.pop()
    expect(parseTtrpgAuthoringSettingsV2(settings)).toEqual(settings)
    expect(() => current()).toThrow()
  })
  it.each(['missing', 'identity', 'swapped', 'controller', 'npc'] as const)('rejects actual produced %s instead of treating a reserved key as an actor', kind => {
    const { settings, plan } = setup(), characters = plan.seats.map(seat => ({ ...seat, role: 'player' as 'player' | 'npc' }))
    expect(() => assertTtrpgOpenAuthoringSeatPlanSystemV1({ settings, characters })).not.toThrow()
    if (kind === 'missing') characters.pop()
    if (kind === 'identity') characters[1].characterKey = 'model.invented'
    if (kind === 'swapped') [characters[1].seatKey, characters[2].seatKey] = [characters[2].seatKey, characters[1].seatKey]
    if (kind === 'controller') characters[1].controller = 'human'
    if (kind === 'npc') characters[1].role = 'npc'
    expect(() => assertTtrpgOpenAuthoringSeatPlanSystemV1({ settings, characters })).toThrow(/预留不一致/)
  })
  it('does not reinterpret legacy actor keys or enforce a plan against an old absent-field Settings snapshot', () => {
    const settings = defaultTtrpgSettingsV2('open'), campaign = openCampaignFixture()
    const before = JSON.stringify(settings)
    expect(() => assertTtrpgOpenAuthoringSeatPlanSystemV1({ settings, characters: campaign.characterTemplates })).not.toThrow()
    expect(JSON.stringify(settings)).toBe(before)
    expect(() => parseTtrpgOpenAuthoringSeatPlanV1({ schema: 'storyforge.ttrpg-open-authoring-seat-plan', version: 1, seats: [] })).toThrow()
  })
})
