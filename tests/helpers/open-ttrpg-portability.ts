/** Internal real-owner fixture; no provider or implicit resume authorization. */
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from './open-ttrpg-session'
import { startTtrpgOpenEpochV1 } from '../../src/lib/ttrpg/runtime-commands'
import { prepareTtrpgOpenIntentInputV1 } from '../../src/lib/ttrpg/open-intent-input'
export async function preparePortableOpenRequestV1(title = 'portable pending request', configure?: Parameters<typeof readyOpenTtrpgSessionV1>[1], beforeEpoch?: (fixture: Awaited<ReturnType<typeof readyOpenTtrpgSessionV1>>) => Promise<void>) {
  const fixture = await readyOpenTtrpgSessionV1(title, pkg => {
    pkg.ttrpg!.campaign.runtimePolicy.enabled = true
    pkg.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50000
    configure?.(pkg)
  })
  await beforeEpoch?.(fixture)
  const rawInput = '调查河港'
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'portable.epoch'), viewerKey: OPEN_HUMAN_VIEWER,
    triggerKind: 'submit-action', rawInput })
  const input = { ...await openEnvelopeV1(fixture.sessionId, 'portable.prepare'), scope: fixture.scope,
    actorKey: 'hero', viewerKey: OPEN_HUMAN_VIEWER, rawInput, maximumOutputTokens: 800, maximumCostUsd: 0.1,
    modelIdentity: { provider: 'test-adapter', model: 'injected' } }
  return { ...fixture, input, prepared: await prepareTtrpgOpenIntentInputV1(input) }
}
