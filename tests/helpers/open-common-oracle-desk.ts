import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { setupCommonOracleSourceV1 } from './open-common-oracle-source'
import { closeTtrpgOpenEntityDeskV1 } from '../../src/lib/ttrpg/open-entity-desk'
import { readTtrpgOpenCommonOracleDeskV1 } from '../../src/lib/ttrpg/open-common-oracle-desk'

export async function setupCommonOracleDeskV1(audience: 'public' | 'party' = 'party') {
  const s = await setupCommonOracleSourceV1(audience, false, pkg => {
    if (audience === 'public') {
      const binding = pkg.ttrpg!.campaign.entityBindings.find(row => row.bindingKey === 'keeper')!
      binding.audience = 'public'; binding.knownByActorKeys = []
    }
  })
  await closeTtrpgOpenEntityDeskV1({ ...s.owner, submissionKey: 'common.ui.close.original' })
  const page = await readTtrpgOpenCommonOracleDeskV1(s.owner)
  if (!page?.canRequest || !page.catalog.length) throw new Error('Expected common desk: ' + page?.unavailable)
  const selected = page.catalog[0], fact = { kind: 'relation' as const, subjectRef: audience === 'party' ? s.npc : 'keeper', predicateKey: 'knows' as const,
    objectRef: 'harbor', canonicalValue: true, detail: '共同咨询给出的关系提案，尚未确认。', sourceFactRefs: [], audience,
    knownByActorKeys: audience === 'party' ? selected.recipients : [], supersedes: null, supersedeReason: null }
  const command = { ...s.owner, ...selected, expectedSequence: page.sequence, submissionKey: 'common.ui.request', maximumCostUsd: 0.1,
    decision: 'request-this-one-common-oracle-candidate' as const }
  return { ...s, before: await readProductRuntimeState(s.f.sessionId), page, selected, command, fact, output: JSON.stringify({ interpretation: '依据原共同咨询提出解释。', facts: [fact] }) }
}
