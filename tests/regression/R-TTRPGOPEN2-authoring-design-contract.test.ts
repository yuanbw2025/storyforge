import { describe, expect, it } from 'vitest'
import { openCampaignFixture, emptyOpenAuthoringFixture } from '../helpers/ttrpg-open-content'
import { initializeTtrpgOpenAuthoringPoliciesV1 } from '../../src/lib/ttrpg/open-authoring-edit'
import { TTRPG_OPEN_AUTHORING_DESIGN_SECTIONS_V1, MAX_TTRPG_OPEN_AUTHORING_DESIGN_CHARACTERS_V1,
  parseTtrpgOpenAuthoringDesignRequestV1, parseTtrpgOpenAuthoringDesignProposalsV1, composeTtrpgOpenAuthoringDesignV1,
  type TtrpgOpenAuthoringDesignContextV1 } from '../../src/lib/ttrpg/open-authoring-design-contract'

function fixture() {
  const campaign = openCampaignFixture()
  const base = initializeTtrpgOpenAuthoringPoliciesV1(emptyOpenAuthoringFixture())
  base.factPolicy = [{ fact: { ...structuredClone(campaign.frozenWorldPredicateIndex.entries[0]), factKey: 'fact.author.locked' }, authorConfirmed: true }]
  const context: TtrpgOpenAuthoringDesignContextV1 = { base, readWorldResourceKeys: ['world.harbor'], request: {
    schema: 'storyforge.ttrpg-open-authoring-design-request', version: 1, instruction: '提供三种不同压力的港口调查方向', sections: [...TTRPG_OPEN_AUTHORING_DESIGN_SECTIONS_V1] } }
  const value = { schema: 'storyforge.ttrpg-open-authoring-design-proposals', version: 1, proposals: Array.from({ length: 3 }, (_, index) => ({
    proposalKey: `proposal.${index}`, title: `港口方向${index}`, pitch: '调查灯塔并选择如何应对潮水。', patch: {
      situationTemplates: structuredClone(campaign.situationTemplates), openingSituationKeys: [...campaign.openingSituationKeys],
      effectPlanTemplates: structuredClone(campaign.effectPlanTemplates),
      pressure: { clocks: campaign.clocks.map(clock => ({ ...structuredClone(clock), maximum: 6 + index * 2 })), fronts: structuredClone(campaign.fronts) },
      dynamicEntityTemplates: [], factProposals: structuredClone(campaign.frozenWorldPredicateIndex.entries),
    },
  })) }
  return { value, context }
}
const picks = (key: string) => Object.fromEntries(TTRPG_OPEN_AUTHORING_DESIGN_SECTIONS_V1.map(section => [section, key]))
describe('R-TTRPGOPEN2 closed S2 design proposals', () => {
  it('keeps the saved policy/facts and immutable input separate, adding only unconfirmed facts to a selected draft', () => {
    const { value, context } = fixture(), before = JSON.stringify(context), raw = JSON.stringify(value)
    const result = composeTtrpgOpenAuthoringDesignV1(value, picks('proposal.1'), context)
    expect(result.pressure.clocks[0].maximum).toBe(8)
    expect(result.runtimePolicy).toEqual(context.base.runtimePolicy); expect(result.companionPolicy).toEqual(context.base.companionPolicy)
    expect(result.stageClosurePolicy).toEqual(context.base.stageClosurePolicy)
    expect(result.factPolicy.map(fact => fact.authorConfirmed)).toEqual([true, false])
    expect(JSON.stringify(context)).toBe(before); expect(JSON.stringify(value)).toBe(raw)
    result.runtimePolicy!.enabled = true
    expect(context.base.runtimePolicy!.enabled).toBe(false)
  })
  it('combines actual requested sections and rejects combinations with missing local opening references', () => {
    const { value, context } = fixture()
    const result = composeTtrpgOpenAuthoringDesignV1(value, { ...picks('proposal.0'), pressure: 'proposal.2' }, context)
    expect(result.situationTemplates).toEqual(value.proposals[0].patch.situationTemplates)
    expect(result.pressure.clocks[0].maximum).toBe(10)
    value.proposals[2].patch.situationTemplates[0].templateKey = 'situation.other'
    value.proposals[2].patch.openingSituationKeys = ['situation.other']
    expect(() => composeTtrpgOpenAuthoringDesignV1(value, { ...picks('proposal.0'), openingSituationKeys: 'proposal.2' }, context)).toThrow('未知引用')
  })
  it('accepts only the requested section set and preserves all other existing author content', () => {
    const { value, context } = fixture()
    context.base.situationTemplates = value.proposals[0].patch.situationTemplates
    context.base.openingSituationKeys = value.proposals[0].patch.openingSituationKeys
    context.request.sections = ['pressure']
    const partial = { ...value, proposals: value.proposals.map(proposal => ({ ...proposal, patch: { pressure: proposal.patch.pressure } })) }
    const result = composeTtrpgOpenAuthoringDesignV1(partial, { pressure: 'proposal.2' }, context)
    expect(result.situationTemplates).toEqual(context.base.situationTemplates); expect(result.factPolicy).toEqual(context.base.factPolicy)
    expect(() => parseTtrpgOpenAuthoringDesignProposalsV1(value, context)).toThrow('字段不精确')
  })
  it.each(['runtimePolicy', 'companionPolicy', 'stageClosurePolicy', 'contextPolicy', 'worldReference', 'rulePack', 'scope', 'candidateHash'])('cannot accept model-controlled %s in a design patch', field => {
    const { value, context } = fixture()
    Object.assign(value.proposals[0].patch, { [field]: {} })
    expect(() => parseTtrpgOpenAuthoringDesignProposalsV1(value, context)).toThrow('字段不精确')
  })
  it('rejects title-only alternatives, missing/extra proposals and duplicate stable keys', () => {
    const { value, context } = fixture()
    const same = structuredClone(value); same.proposals.forEach(item => { item.patch.pressure.clocks[0].maximum = 6; item.patch.situationTemplates[0].title = item.title })
    expect(() => parseTtrpgOpenAuthoringDesignProposalsV1(same, context)).toThrow('更换标题')
    expect(() => parseTtrpgOpenAuthoringDesignProposalsV1({ ...value, proposals: value.proposals.slice(0, 2) }, context)).toThrow()
    expect(() => parseTtrpgOpenAuthoringDesignProposalsV1({ ...value, proposals: [...value.proposals, value.proposals[0]] }, context)).toThrow()
    value.proposals[1].proposalKey = value.proposals[0].proposalKey
    expect(() => parseTtrpgOpenAuthoringDesignProposalsV1(value, context)).toThrow('重复')
  })
  it.each(['immediate', 'choice', 'mixed-single', 'mixed-choice', 'single', 'empty', 'empty-option'] as const)(
    'keeps immediate and player-choice consequences mutually exclusive without changing the candidate: %s', shape => {
      const { value, context } = fixture(), plan = value.proposals[0].patch.effectPlanTemplates[0]
      const effect = structuredClone(plan.effects[0])
      plan.effects = shape === 'immediate' || shape.startsWith('mixed') ? [effect] : []
      plan.alternatives = shape === 'immediate' || shape === 'empty' ? [] : [
        { alternativeKey: 'choose.a', title: '选择第一项后果', effects: shape === 'empty-option' ? [] : [structuredClone(effect)] },
        ...(['choice', 'mixed-choice', 'empty-option'].includes(shape)
          ? [{ alternativeKey: 'choose.b', title: '选择另一项后果', effects: [structuredClone(effect)] }] : []),
      ]
      const raw = JSON.stringify(value), before = JSON.stringify(context)
      if (shape === 'immediate' || shape === 'choice') expect(parseTtrpgOpenAuthoringDesignProposalsV1(raw, context).proposals).toHaveLength(3)
      else expect(() => parseTtrpgOpenAuthoringDesignProposalsV1(raw, context)).toThrow()
      expect(JSON.stringify(value)).toBe(raw); expect(JSON.stringify(context)).toBe(before)
    },
  )
  it('cannot override retained facts, self-confirm a proposed fact or cite an allowed-but-unread resource', () => {
    const { value, context } = fixture()
    const overwrite = structuredClone(value); overwrite.proposals[0].patch.factProposals[0].factKey = 'fact.author.locked'
    expect(() => parseTtrpgOpenAuthoringDesignProposalsV1(overwrite, context)).toThrow('现有事实')
    const confirmed = structuredClone(value); Object.assign(confirmed.proposals[0].patch.factProposals[0], { authorConfirmed: true })
    expect(() => parseTtrpgOpenAuthoringDesignProposalsV1(confirmed, context)).toThrow('字段不精确')
    const unread = structuredClone(value); unread.proposals[0].patch.situationTemplates[0].sourceRefs = ['world.unread']
    expect(() => parseTtrpgOpenAuthoringDesignProposalsV1(unread, context)).toThrow('未实际读取')
    context.readWorldResourceKeys = []
    expect(() => parseTtrpgOpenAuthoringDesignProposalsV1(value, context)).toThrow('未实际读取')
  })
  it('does not turn an incomplete boundary into model authority, and rejects oversized/unknown/versionless input', () => {
    const { value, context } = fixture()
    expect(() => parseTtrpgOpenAuthoringDesignProposalsV1(' '.repeat(MAX_TTRPG_OPEN_AUTHORING_DESIGN_CHARACTERS_V1 + 1), context)).toThrow('过长')
    expect(() => parseTtrpgOpenAuthoringDesignProposalsV1({ ...value, version: 2 }, context)).toThrow()
    expect(() => parseTtrpgOpenAuthoringDesignRequestV1({ ...context.request, sections: [] })).toThrow()
    expect(() => parseTtrpgOpenAuthoringDesignRequestV1({ ...context.request, sections: ['pressure', 'pressure'] })).toThrow()
    expect(() => parseTtrpgOpenAuthoringDesignRequestV1({ ...context.request, sections: ['runtimePolicy'] })).toThrow()
    expect(() => composeTtrpgOpenAuthoringDesignV1(value, { ...picks('proposal.0'), pressure: 'unknown' }, context)).toThrow('没有对应候选')
    context.base.runtimePolicy = null
    expect(() => parseTtrpgOpenAuthoringDesignProposalsV1(value, context)).toThrow('本桌边界')
  })
})
