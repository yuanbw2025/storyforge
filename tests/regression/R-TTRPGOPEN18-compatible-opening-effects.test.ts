import { describe, expect, it } from 'vitest'
import { openCampaignFixture, openRuleFixture } from '../helpers/ttrpg-open-content'
import type { TtrpgOpenAuthoringV1, TtrpgOpenEffectPlanTemplateV1 } from '../../src/lib/ttrpg/open-contract'
import type { TtrpgRuntimeContentV2 } from '../../src/lib/ttrpg/content-version'
import { parseTtrpgOpenAuthoringV1 } from '../../src/lib/ttrpg/open-content-authoring'
import { appendedTtrpgCompatibleOpeningEffectPlanKeysV2, assertTtrpgCompatibleOpeningAuthoringV1,
  cloneTtrpgCompatibleOpeningTemplateV1, cloneTtrpgCompatibleOpeningTemplateWithEffectsV2,
  parseTtrpgCompatibleOpeningRevision, parseTtrpgCompatibleOpeningRevisionV1, ttrpgCompatibleOpeningAuthoringBaseV1,
} from '../../src/lib/ttrpg/open-compatible-opening-contract'
import { assertTtrpgOpenReleaseCompatibilityV1 } from '../../src/lib/ttrpg/open-release-compatibility'

function fixture() {
  const campaign = openCampaignFixture(), original = campaign.situationTemplates[0]
  for (const [i, evidence] of original.evidence.entries()) {
    evidence.discoveryPolicy.allowedAudience = 'private'; evidence.discoveryPolicy.recipientActorKeys = ['hero']
    evidence.discoveryPolicy.requiresPlayerConfirmation = true
    evidence.discoveryPolicy.costEffectPlanRef = 'plan.success'
    evidence.discoveryPolicy.failForwardEffectPlanRef = `plan.failure.${i + 1}`
    const effects: TtrpgOpenEffectPlanTemplateV1['effects'] = [
      { effectKey: `cost.${i}`, family: 'numeric', operation: 'resource.spend', targetRef: 'parameter:actor', valueKey: openRuleFixture().resources[0].key, amount: 2 },
      { effectKey: `knowledge.${i}`, family: 'knowledge', operation: 'knowledge.discover', targetRef: 'parameter:actor', evidenceRef: evidence.clueRef },
    ]
    campaign.effectPlanTemplates.push({ planKey: `plan.failure.${i + 1}`, degree: 'failure', ruleRef: openRuleFixture().actions[0].key,
      reason: '保留私密理由和失败代价', audience: 'actor:hero', parameters: [{ parameterKey: 'actor', entityKinds: ['actor'], allowedRefs: ['hero'],
        allowDynamicFromTemplateKeys: [], required: true }], effects: i === 0 ? effects : [], alternatives: i === 0 ? [] : [
        { alternativeKey: 'pay', title: '付出代价', effects }, { alternativeKey: 'pay-more', title: '另一项代价', effects: effects.map(e => ({ ...e, effectKey: `${e.effectKey}.other` })) },
      ] })
  }
  original.preconditions = [{ op: 'evidence-known-by', actorKey: 'hero', clueRef: original.evidence[0].clueRef }]
  const base = ttrpgCompatibleOpeningAuthoringBaseV1(campaign, [])
  const copied = cloneTtrpgCompatibleOpeningTemplateWithEffectsV2({ original, effectPlanTemplates: base.effectPlanTemplates,
    templateKey: 'author.next', title: '新的港口开局' })
  const next = parseTtrpgOpenAuthoringV1({ ...base, situationTemplates: [...base.situationTemplates, copied.template],
    effectPlanTemplates: [...base.effectPlanTemplates, ...copied.effectPlanTemplates], openingSituationKeys: [copied.template.templateKey] })
  const content: TtrpgRuntimeContentV2 = { campaign, rulePack: { content: openRuleFixture(), contentHash: 'a'.repeat(64) }, compatibility: { runtimeProtocol: 2, minimumPlayerVersion: 2 } }
  return { campaign, base, copied, next, content }
}
const effects = (plan: TtrpgOpenEffectPlanTemplateV1) => [...plan.effects, ...plan.alternatives.flatMap(a => a.effects)]

describe('R-TTRPGOPEN18 compatible copied discovery effects', () => {
  it('remaps both local grants and every copied identity while retaining costs, alternatives, targets and old bytes', () => {
    const { base, next, copied } = fixture(), before = JSON.stringify(base)
    expect(assertTtrpgCompatibleOpeningAuthoringV1(base, next)).toEqual(['author.next'])
    expect(appendedTtrpgCompatibleOpeningEffectPlanKeysV2(base, next)).toEqual(copied.effectPlanTemplates.map(p => p.planKey))
    expect(copied.effectPlanTemplates).toHaveLength(2)
    expect(next.situationTemplates[0]).toEqual(base.situationTemplates[0])
    expect(next.effectPlanTemplates.slice(0, base.effectPlanTemplates.length)).toEqual(base.effectPlanTemplates)
    expect(copied.template.preconditions).toEqual([{ op: 'evidence-known-by', actorKey: 'hero', clueRef: 'author.next.evidence.1' }])
    for (const [i, evidence] of copied.template.evidence.entries()) {
      expect(evidence.clueRef).toBe(`author.next.evidence.${i + 1}`)
      expect(evidence.discoveryPolicy.costEffectPlanRef).toBe('plan.success')
      const plan = copied.effectPlanTemplates.find(p => p.planKey === evidence.discoveryPolicy.failForwardEffectPlanRef)!
      const source = base.effectPlanTemplates[i + 1]
      expect(plan.planKey).not.toBe(source.planKey)
      expect(effects(plan).filter(e => e.family === 'knowledge').map(e => e.evidenceRef)).toEqual(i === 0 ? [evidence.clueRef] : [evidence.clueRef, evidence.clueRef])
      expect(effects(plan).map(e => e.effectKey).every(key => !effects(source).some(e => e.effectKey === key))).toBe(true)
      expect(plan.alternatives.map(a => a.alternativeKey).every(key => !source.alternatives.some(a => a.alternativeKey === key))).toBe(true)
      expect(plan.parameters).toEqual(source.parameters); expect(plan.audience).toBe(source.audience)
      expect(plan.degree).toBe(source.degree); expect(plan.ruleRef).toBe(source.ruleRef); expect(plan.reason).toBe(source.reason)
      expect(effects(plan).map(e => e.targetRef)).toEqual(effects(source).map(e => e.targetRef))
      expect(effects(plan).filter(e => e.family === 'numeric').map(e => e.amount)).toEqual(effects(source).filter(e => e.family === 'numeric').map(e => e.amount))
      expect(evidence.discoveryPolicy.paths[0].interventionPointKey).toBe(`author.next.point.${i + 1}`)
      expect(evidence.coversObstacleKeys).toEqual([`author.next.obstacle.${i + 1}`])
    }
    expect(copied.template.obstacles[1].dependsOn).toEqual(['author.next.obstacle.1'])
    expect(JSON.stringify(base)).toBe(before)
    expect(cloneTtrpgCompatibleOpeningTemplateWithEffectsV2({ original: base.situationTemplates[0], effectPlanTemplates: base.effectPlanTemplates,
      templateKey: 'author.next', title: '新的港口开局' })).toEqual(copied)
  })
  it('permits the exact extension through release compatibility and rejects mechanical or recipient changes', () => {
    const { base, next, content } = fixture()
    const target = { ...content, campaign: { ...content.campaign, situationTemplates: next.situationTemplates,
      openingSituationKeys: next.openingSituationKeys, effectPlanTemplates: next.effectPlanTemplates } }
    expect(() => assertTtrpgOpenReleaseCompatibilityV1(content, target)).not.toThrow()
    const mutations: Array<(value: TtrpgOpenAuthoringV1) => void> = [
      value => { const e = value.effectPlanTemplates.at(-2)!.effects[0]; if (e.family === 'numeric') e.amount++ },
      value => { value.effectPlanTemplates.at(-2)!.effects[0].targetRef = 'companion.1' },
      value => { value.effectPlanTemplates.at(-2)!.audience = 'public' },
      value => { value.effectPlanTemplates.at(-2)!.degree = 'success' },
      value => { value.effectPlanTemplates.at(-2)!.ruleRef = 'another.rule' },
      value => { value.effectPlanTemplates.at(-2)!.parameters[0].allowedRefs.push('companion.1') },
      value => { value.situationTemplates.at(-1)!.evidence[0].discoveryPolicy.recipientActorKeys.push('companion.1') },
      value => { value.situationTemplates.at(-1)!.evidence[0].discoveryPolicy.allowedAudience = 'public' },
      value => { value.situationTemplates.at(-1)!.evidence[0].discoveryPolicy.requiresPlayerConfirmation = false },
      value => { value.situationTemplates.at(-1)!.evidence[0].discoveryPolicy.paths[0].key = 'another.rule' },
      value => { const e = value.effectPlanTemplates.at(-2)!.effects[1]; if (e.family === 'knowledge') e.evidenceRef = 'author.next.evidence.2' },
      value => { value.effectPlanTemplates[0].reason = '篡改原定义' },
    ]
    for (const mutate of mutations) {
      const invalid = structuredClone(next); mutate(invalid)
      expect(() => assertTtrpgCompatibleOpeningAuthoringV1(base, invalid)).toThrow()
      expect(() => assertTtrpgOpenReleaseCompatibilityV1(content, { ...target, campaign: { ...target.campaign,
        situationTemplates: invalid.situationTemplates, effectPlanTemplates: invalid.effectPlanTemplates } })).toThrow()
    }
  })
  it('rejects unused and unrelated new plans or grants outside their discovery policy', () => {
    const { base, next } = fixture()
    const unused = structuredClone(next); unused.effectPlanTemplates.push({ ...structuredClone(base.effectPlanTemplates[0]), planKey: 'unrelated.plan' })
    expect(() => appendedTtrpgCompatibleOpeningEffectPlanKeysV2(base, unused)).toThrow(/未使用/)
    const mechanical = structuredClone(next), template = mechanical.situationTemplates.at(-1)!
    template.evidence[0].discoveryPolicy.costEffectPlanRef = 'extra.mechanical'
    mechanical.effectPlanTemplates.push({ ...structuredClone(base.effectPlanTemplates[0]), planKey: 'extra.mechanical' })
    expect(() => appendedTtrpgCompatibleOpeningEffectPlanKeysV2(base, mechanical)).toThrow(/本地知识后果副本/)
    const outside = structuredClone(next); outside.situationTemplates.at(-1)!.noInterventionOutcome.effectPlanRef = next.effectPlanTemplates.at(-1)!.planKey
    expect(() => appendedTtrpgCompatibleOpeningEffectPlanKeysV2(base, outside)).toThrow(/只能用于/)
  })
  it('rejects unresolved, nonlocal or another clue knowledge references before producing a clone', () => {
    const { base } = fixture()
    for (const evidenceRef of ['missing.clue', base.situationTemplates[0].evidence[1].clueRef]) {
      const plans = structuredClone(base.effectPlanTemplates), effect = plans[1].effects[1]
      if (effect.family === 'knowledge') effect.evidenceRef = evidenceRef
      expect(() => cloneTtrpgCompatibleOpeningTemplateWithEffectsV2({ original: base.situationTemplates[0], effectPlanTemplates: plans,
        templateKey: 'author.next', title: '失败的复制' })).toThrow(/本局势中该线索/)
    }
    expect(() => cloneTtrpgCompatibleOpeningTemplateWithEffectsV2({ original: base.situationTemplates[0], effectPlanTemplates: base.effectPlanTemplates.slice(0, 1),
      templateKey: 'author.next', title: '失败的复制' })).toThrow(/缺失后果/)
  })
  it('blocks a newly authored legacy-style broken clone without invalidating its already published history', () => {
    const { base, content } = fixture()
    const broken = cloneTtrpgCompatibleOpeningTemplateV1(base.situationTemplates[0], 'author.next', '旧复制方式的错误新开局')
    const next = { ...base, situationTemplates: [...base.situationTemplates, broken], openingSituationKeys: [broken.templateKey] }
    expect(() => assertTtrpgCompatibleOpeningAuthoringV1(base, next)).toThrow(/本局势中该线索/)
    expect(appendedTtrpgCompatibleOpeningEffectPlanKeysV2(base, next)).toEqual([])
    expect(() => assertTtrpgOpenReleaseCompatibilityV1(content, { ...content, campaign: { ...content.campaign,
      situationTemplates: next.situationTemplates, openingSituationKeys: next.openingSituationKeys } })).not.toThrow()
    const missing = structuredClone(next); missing.situationTemplates.at(-1)!.evidence[0].discoveryPolicy.costEffectPlanRef = 'missing.plan'
    expect(() => assertTtrpgCompatibleOpeningAuthoringV1(base, missing)).toThrow(/缺失后果/)
  })
  it('shares unchanged plans when no local knowledge copy is needed', () => {
    const campaign = openCampaignFixture(), base = ttrpgCompatibleOpeningAuthoringBaseV1(campaign, [])
    const copy = cloneTtrpgCompatibleOpeningTemplateWithEffectsV2({ original: base.situationTemplates[0], effectPlanTemplates: base.effectPlanTemplates,
      templateKey: 'author.next', title: '无需新后果的开局' })
    expect(copy.effectPlanTemplates).toEqual([])
    expect(copy.template.consequences).toEqual(base.situationTemplates[0].consequences)
    expect(appendedTtrpgCompatibleOpeningEffectPlanKeysV2(base, { ...base, situationTemplates: [...base.situationTemplates, copy.template] })).toEqual([])
  })
  it('keeps legacy V1 closed and accepts only exact explicitly marked V2 extension metadata', () => {
    const v1 = { schema: 'storyforge.ttrpg-compatible-opening-revision', version: 1, baseReleaseHash: 'a'.repeat(64),
      baseRuntimeSourceHash: 'b'.repeat(64), baseContentHash: 'c'.repeat(64), appendedTemplateKeys: ['author.next'] }
    expect(JSON.stringify(parseTtrpgCompatibleOpeningRevisionV1(v1))).toBe(JSON.stringify(v1))
    expect(parseTtrpgCompatibleOpeningRevision(v1)).toEqual(v1)
    const v2 = { ...v1, version: 2, appendedEffectPlanKeys: ['author.next.plan.2'] }
    expect(parseTtrpgCompatibleOpeningRevision(v2)).toEqual(v2)
    expect(() => parseTtrpgCompatibleOpeningRevisionV1(v2)).toThrow()
    for (const invalid of [{ ...v1, appendedEffectPlanKeys: v2.appendedEffectPlanKeys }, { ...v2, extra: true }, { ...v2, appendedEffectPlanKeys: [] }, { ...v2, version: 3 }]) {
      expect(() => parseTtrpgCompatibleOpeningRevision(invalid)).toThrow()
    }
  })
})
