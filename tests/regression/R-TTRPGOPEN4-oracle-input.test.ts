import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { startTtrpgOpenEpochV1, consultTtrpgOracleV1, dispatchTtrpgOpenModelCallV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from '../../src/lib/ttrpg/open-runtime-contract'
import { prepareTtrpgOpenOracleInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { TTRPG_OPEN_GM_ORACLE_INPUT_PROVIDER_V1, TTRPG_OPEN_AUTHORITY_PROVIDER_V1 } from '../../src/lib/ttrpg/open-context-provider'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { loadTtrpgOpenGmOracleContextV1 } from '../../src/lib/ttrpg/open-gm-oracle-context'

async function setup() {
  const rawInput = '咨询并解释本次码头 Oracle'
  const fixture = await readyOpenTtrpgSessionV1('oracle interpreter input', pkg => {
    pkg.ttrpg!.campaign.runtimePolicy.enabled = true
    pkg.ttrpg!.campaign.characterTemplates.find(actor => actor.characterKey === 'keeper')!.gmProfile!.secret = 'UNRELATED-GM-PROFILE-SECRET'
  })
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'epoch'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'continue-host', rawInput })
  await consultTtrpgOracleV1({ ...await openEnvelopeV1(fixture.sessionId, 'oracle'), viewerKey: OPEN_HUMAN_VIEWER,
    askedBy: 'player:hero', oracleKey: 'oracle.yes', question: '码头会下雨吗？', likelihoodTierKey: 'even' })
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(fixture.sessionId)).ttrpg)!
  const oracleSourceRef = runtime.openRun!.oracleReceipts![0].sourceRef
  return { ...fixture, rawInput, oracleSourceRef }
}
describe('R-TTRPGOPEN4 exact governed GM Oracle input', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('reads a registered GM source but never sends unrelated profiles, seeds or another POV', async () => {
    const fixture = await setup(), scope = { ...fixture.scope, productRuntimeSessionId: fixture.sessionId, runtimeActorKey: 'gm' }
    const page = await TTRPG_OPEN_GM_ORACLE_INPUT_PROVIDER_V1.listMetadata({ scope, limit: 10 })
    expect(page.items).toHaveLength(2)
    const key = `oracle.${await hashProductProductionValueV2(fixture.oracleSourceRef)}`
    const item = page.items.find(item => item.resourceKey.endsWith(key))!
    const body = await TTRPG_OPEN_GM_ORACLE_INPUT_PROVIDER_V1.read({ scope, resourceKey: item.resourceKey, depth: 'full', maxTokens: 16000 })
    expect(JSON.parse(body.content).sourceRef).toEqual(fixture.oracleSourceRef)
    expect(body.content).not.toContain('UNRELATED-GM-PROFILE-SECRET')
    expect(body.content).not.toContain('seedCommitment')
    await expect(TTRPG_OPEN_GM_ORACLE_INPUT_PROVIDER_V1.listMetadata({ scope: { ...scope, runtimeActorKey: 'hero' }, limit: 10 })).rejects.toThrow(/GM 视角/)
    await expect(TTRPG_OPEN_AUTHORITY_PROVIDER_V1.listMetadata({ scope, limit: 10 })).rejects.toThrow(/活动玩家/)
    await expect(TTRPG_OPEN_GM_ORACLE_INPUT_PROVIDER_V1.readOriginal({ scope, resourceKey: item.resourceKey, sourceRef: item.sourceRefs[0], maxTokens: 16000 })).rejects.toThrow(/原始/)
  })
  it('freezes exactly the requested consultation and one-send receipt under its real Skill/Run', async () => {
    const fixture = await setup()
    const prepared = await prepareTtrpgOpenOracleInputV1({ ...await openEnvelopeV1(fixture.sessionId, 'interpret.reserve'), scope: fixture.scope,
      viewerKey: OPEN_HUMAN_VIEWER, rawInput: fixture.rawInput, oracleSourceRef: fixture.oracleSourceRef,
      modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 1000, maximumCostUsd: 0.2 })
    expect(prepared.evidence.manifest.sources.map(source => source.key)).toEqual(['ttrpgOpenGmOracleInput', 'ttrpgOpenGmContext'])
    expect(prepared.evidence.selector.selected).toHaveLength(3)
    expect(JSON.stringify(prepared.messages)).not.toContain('UNRELATED-GM-PROFILE-SECRET')
    const first = await dispatchTtrpgOpenModelCallV1({ ...await openEnvelopeV1(fixture.sessionId, 'dispatch'), requestKey: prepared.requestKey, runId: prepared.runId, viewerKey: OPEN_HUMAN_VIEWER })
    expect(first.sendAuthorized).toBe(true)
    const repeat = await dispatchTtrpgOpenModelCallV1({ ...await openEnvelopeV1(fixture.sessionId, 'dispatch'), requestKey: prepared.requestKey, runId: prepared.runId, viewerKey: OPEN_HUMAN_VIEWER })
    expect(repeat.sendAuthorized).toBe(false)
  })
  it('rejects a fabricated consultation and revoked GM consent before reserving any call', async () => {
    const fixture = await setup(), before = await readProductRuntimeState(fixture.sessionId)
    await expect(prepareTtrpgOpenOracleInputV1({ ...await openEnvelopeV1(fixture.sessionId, 'bad'), scope: fixture.scope,
      viewerKey: OPEN_HUMAN_VIEWER, rawInput: fixture.rawInput, oracleSourceRef: { ...fixture.oracleSourceRef, sequence: 1 },
      modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 1000, maximumCostUsd: 0.2 })).rejects.toThrow(/实际 Oracle/)
    expect(await readProductRuntimeState(fixture.sessionId)).toEqual(before)
    const gm = await db.ttrpgSessionParticipants.where('sessionId').equals(fixture.sessionId).filter(seat => seat.role === 'gm').first()
    await db.ttrpgSessionParticipants.update(gm!.id!, { consent: { ...gm!.consent, aiAdviceAllowed: false } })
    await expect(loadTtrpgOpenGmOracleContextV1({ scope: fixture.scope, sessionId: fixture.sessionId, actorKey: 'gm' })).rejects.toThrow(/变化|授权/)
  })
})
