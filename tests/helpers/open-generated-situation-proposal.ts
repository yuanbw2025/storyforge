/** Explicit engineering candidate using a real frozen source and confirmed session fact; no model/acceptance receipt is invented. */
import { seedTtrpgWorldPatchReviewV1 } from './open-ttrpg-world-patch'
import { loadTtrpgOpenSituationProposalBasisV1 } from '../../src/lib/ttrpg/open-generated-situation-basis'
import type { TtrpgOpenSituationProposalBasisV1 } from '../../src/lib/ttrpg/open-generated-situation-contract'

export function generatedSituationProposalFixtureV1(basis: TtrpgOpenSituationProposalBasisV1) {
  const original = structuredClone(basis.campaign.situationTemplates[0]), key = basis.assignedTemplateKey
  const refs = new Map(original.evidence.map((e, i) => [e.clueRef, `${key}.evidence.${i + 1}`]))
  const remap = (value: unknown): unknown => typeof value === 'string' ? refs.get(value) ?? value : Array.isArray(value) ? value.map(remap)
    : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v)])) : value
  const { templateKey: _templateKey, ...body } = original
  const template = remap(body) as typeof body
  const sessionFact = basis.sessionFacts.find(f => f.audience === 'party')!
  template.evidence[0].sourceFactRefs = [sessionFact.factKey]
  template.whyNowRefs = [`session:${sessionFact.factKey}`, `clock:${basis.campaign.clocks[0].clockKey}`]
  return { schema: 'storyforge.ttrpg-open-situation-proposal' as const, version: 1 as const, template,
    personalizationSourceKeys: [basis.personalizationSources.find(s => s.actorKeys.includes('hero'))!.sourceKey] }
}
export async function seedGeneratedSituationProposalV1() {
  const f = await seedTtrpgWorldPatchReviewV1(), input = { ...f.host, proposalKey: 'generated.proposal.one' }
  const loaded = await loadTtrpgOpenSituationProposalBasisV1(input)
  return { f, input, loaded, value: generatedSituationProposalFixtureV1(loaded.basis) }
}
