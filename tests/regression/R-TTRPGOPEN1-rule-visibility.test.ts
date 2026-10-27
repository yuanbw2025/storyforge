import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { startTtrpgOpenEpochV1, startTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
describe('R-TTRPGOPEN1 actor-scoped rule visibility', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it.each(['gm-only','private'] as const)('refuses an invisible %s target before producing a rule plan or charging resources', async audience => {
    const fixture = await readyOpenTtrpgSessionV1('hidden rule target', pkg => {
      const binding = pkg.ttrpg!.campaign.entityBindings.find(binding => binding.bindingKey === 'keeper')!
      binding.audience = audience
      binding.knownByActorKeys = audience === 'private' ? ['companion.1'] : []
    })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId,'hidden.epoch'),viewerKey:OPEN_HUMAN_VIEWER,triggerKind:'submit-action',rawInput:'尝试行动' })
    const before = await readProductRuntimeState(fixture.sessionId)
    const action = fixture.runtimePackage.ttrpg!.rulePack.content.actions.find(action => action.target === 'single-enemy')!
    await expect(startTtrpgOpenOperationV1({ ...await openEnvelopeV1(fixture.sessionId,'hidden.plan'),viewerKey:OPEN_HUMAN_VIEWER,
      request:{ route:'existing-action',ruleKey:action.key,actorKey:'hero',targetKey:'keeper',controllerMode:'human',effectBindings:{} } })).rejects.toThrow(/信息范围/)
    expect(await readProductRuntimeState(fixture.sessionId)).toEqual(before)
  })
  it('checks the acting companion knowledge instead of borrowing its human approver visibility', async () => {
    const fixture = await readyOpenTtrpgSessionV1('companion target secrecy', pkg => {
      const binding = pkg.ttrpg!.campaign.entityBindings.find(binding => binding.bindingKey === 'keeper')!
      binding.audience='private';binding.knownByActorKeys=['hero']
    })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId,'companion.epoch'),viewerKey:OPEN_HUMAN_VIEWER,triggerKind:'submit-action',rawInput:'让队友尝试行动' })
    const before = await readProductRuntimeState(fixture.sessionId)
    const action = fixture.runtimePackage.ttrpg!.rulePack.content.actions.find(action => action.target === 'single-enemy')!
    await expect(startTtrpgOpenOperationV1({ ...await openEnvelopeV1(fixture.sessionId,'companion.plan'),viewerKey:OPEN_HUMAN_VIEWER,
      request:{ route:'existing-action',ruleKey:action.key,actorKey:'companion.1',targetKey:'keeper',controllerMode:'ai',effectBindings:{} } })).rejects.toThrow(/信息范围/)
    expect(await readProductRuntimeState(fixture.sessionId)).toEqual(before)
  })
})
