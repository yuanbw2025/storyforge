import { setupCommonOracleSourceV1 } from './open-common-oracle-source'
import { openEnvelopeV1 } from './open-ttrpg-session'
import { closeTtrpgOpenEntityDeskV1 } from '../../src/lib/ttrpg/open-entity-desk'
import { loadTtrpgOpenCommonOracleContextV1 } from '../../src/lib/ttrpg/open-common-oracle-context'
import { startTtrpgOpenCommonOracleWindowV1 } from '../../src/lib/ttrpg/open-common-oracle-window'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'

export async function setupCommonOracleModelV1(audience: 'public' | 'party' = 'party', modelIdentity = { provider: 'test-adapter', model: 'injected' }) {
  const s = await setupCommonOracleSourceV1(audience, false, pkg => {
    if (audience === 'public') {
      const binding = pkg.ttrpg!.campaign.entityBindings.find(row => row.bindingKey === 'keeper')!
      binding.audience = 'public'; binding.knownByActorKeys = []
    }
  })
  await closeTtrpgOpenEntityDeskV1({ ...s.owner, submissionKey: 'common.model.close.original' })
  const source = await loadTtrpgOpenCommonOracleContextV1(s.contextInput), selected = source.directory[0]
  const before = await readProductRuntimeState(s.f.sessionId), budget = before.ttrpg!.epochBudget
  const authorized = await startTtrpgOpenCommonOracleWindowV1({ ...s.owner, ...await openEnvelopeV1(s.f.sessionId, 'common.model.authorize'),
    oracleSourceRef: selected.oracleSourceRef, oracleInputHash: selected.contentHash, snapshotHash: selected.snapshotHash,
    decision: 'request-this-one-common-oracle-candidate', modelIdentity,
    maximumInputTokens: Math.min(16000, budget.maximumTokens - 1000), maximumOutputTokens: 1000, maximumCostUsd: 0.2 })
  const state = await readProductRuntimeState(s.f.sessionId), grant = state.ttrpg!.openRun!.coordination.epochs.at(-1)!.commonOracle!
  return { ...s, source, before, authorized, grant, read: { ...s.owner, runId: authorized.runId, requestKey: authorized.requestKey } }
}
