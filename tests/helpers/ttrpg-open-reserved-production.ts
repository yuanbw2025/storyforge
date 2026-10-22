/** Simulated model payloads for ACTUAL fresh UI-reserved keys. Never changes the
 * frozen Brief/settings/authority; only adapts fixture model output and hashes. */
import type { ProductProductionBriefV3, WorkspaceScope } from '../../src/lib/types'
import { openProductionCompilerFixtureV1 } from './open-ttrpg-production-artifacts'
import { assertTtrpgOpenAuthoringSeatPlanCurrentV1 } from '../../src/lib/ttrpg/open-authoring-seat-plan'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'

export async function openReservedProductionFixtureV1(basis: { brief: ProductProductionBriefV3; productionId: number; scope: WorkspaceScope }) {
  const before = JSON.stringify(basis.brief), settings = basis.brief.ttrpgOpen!.settings
  if (settings.runFormat !== 'open' || !settings.authoringSeatPlan) throw new Error('requires the actual reserved Brief')
  const plan = assertTtrpgOpenAuthoringSeatPlanCurrentV1({ plan: settings.authoringSeatPlan, seats: settings.wizard.seats,
    companionPolicy: settings.openAuthoring.companionPolicy })
  // The older helper edits its own in-memory fixture Brief. Isolate that edit;
  // the real production's immutable Brief remains byte-for-byte unchanged.
  const data = await openProductionCompilerFixtureV1(true, { ...basis, brief: structuredClone(basis.brief) })
  const map = new Map(data.ruleSystem.characterTemplates.filter(actor => actor.role === 'player').map(actor => {
    const reserved = plan.seats.find(seat => seat.seatKey === actor.seatKey && seat.controller === actor.controller)
    if (!reserved) throw new Error('fixture actor has no explicit reserved seat')
    return [actor.characterKey, reserved.characterKey]
  }))
  const remap = (value: unknown): unknown => typeof value === 'string' ? map.get(value) ?? value
    : Array.isArray(value) ? value.map(remap) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item)])) : value
  const sourceFacts = remap(data.sourceFacts) as typeof data.sourceFacts
  const ruleSystem = remap(data.ruleSystem) as typeof data.ruleSystem
  const situationLayer = remap(data.situationLayer) as typeof data.situationLayer
  situationLayer.authoring.companionPolicy = structuredClone(settings.openAuthoring.companionPolicy)
  const wrap = async (payload: unknown) => ({ payload, contentHash: await hashProductProductionValueV2(payload) })
  if (JSON.stringify(basis.brief) !== before) throw new Error('fixture changed the real frozen Brief')
  return { sourceFacts, ruleSystem, situationLayer, input: { ...data.input, brief: basis.brief,
    briefHash: await hashProductProductionValueV2(basis.brief), sourceFacts: await wrap(sourceFacts),
    ruleSystem: await wrap(ruleSystem), situationLayer: await wrap(situationLayer) } }
}
