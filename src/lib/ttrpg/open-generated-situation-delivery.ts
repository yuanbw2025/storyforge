/** Actual full model reads, not a directory or internal validation snapshot, support each external reference. */
import type { ContextGatewaySourceSnapshotInputV1 } from '../context-gateway/attempt-evidence'
import type { TtrpgPredicateV1, TtrpgSituationTemplateV1 } from './open-contract'
import type { TtrpgOpenSituationProposalBasisV1 } from './open-generated-situation-contract'
import { reviewTtrpgOpenGeneratedSituationProposalV1, TTRPG_OPEN_SITUATION_INPUT_SOURCE_V1 } from './open-generated-situation-contract'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import * as p from './open-contract-parse'

export interface TtrpgOpenSituationKernelSnapshotV1 {
  schema: 'storyforge.ttrpg-open-situation-kernel-snapshot'; version: 1;
  basis: TtrpgOpenSituationProposalBasisV1;
  resources: Array<{ suffix: string; title: string; mandatory: boolean; value: unknown }>;
}
export interface TtrpgOpenSituationReferenceProofV1 { kind: string; ref: string; resourceKey: string; contentHash: string }
export async function verifyTtrpgOpenSituationKernelSnapshotV1(input: {
  snapshot: TtrpgOpenSituationKernelSnapshotV1; admissionStateHash: string; visibilityHash: string;
  runtimeSourceHash: string; sessionKey: string; epochKey: string; authorizationHash: string;
}) {
  const s = p.record(input.snapshot, ['schema', 'version', 'basis', 'resources'], 'situation kernel snapshot')
  if (s.schema !== 'storyforge.ttrpg-open-situation-kernel-snapshot' || s.version !== 1
    || await hashCanonicalValue(s.basis) !== input.admissionStateHash || await hashCanonicalValue(s.resources) !== input.visibilityHash
    || input.snapshot.basis.runtimeSourceHash !== input.runtimeSourceHash || input.snapshot.basis.sessionKey !== input.sessionKey
    || input.snapshot.basis.authorizationHash !== input.authorizationHash
    || input.snapshot.basis.assignedTemplateKey !== 'generated.' + (await hashCanonicalValue({ sessionKey: input.sessionKey, proposalKey: input.epochKey })).slice(0, 40)) {
    p.fail('局势内部验证快照不属于原调用和系统分配身份')
  }
  return input.snapshot
}
export async function reviewTtrpgOpenDeliveredSituationV1(input: {
  value: unknown; snapshot: TtrpgOpenSituationKernelSnapshotV1; reads: readonly ContextGatewaySourceSnapshotInputV1[];
}) {
  const { basis, resources } = input.snapshot, prefix = 'fact:ttrpg-open:' + basis.sessionKey + ':gm:'
  const delivered = new Map<string, { resourceKey: string; contentHash: string }>()
  for (const read of input.reads) {
    if (read.sourceKey !== TTRPG_OPEN_SITUATION_INPUT_SOURCE_V1 || !read.resourceKey?.startsWith(prefix)
      || typeof read.content !== 'string') p.fail('局势引用混入其他来源/角色或不是完整正文')
    const suffix = read.resourceKey!.slice(prefix.length), expected = resources.find(r => r.suffix === suffix)
    if (!expected || read.content !== canonicalStringify(expected.value)
      || delivered.has(suffix)) p.fail('局势实际交付正文与原授权来源快照不一致或重复')
    delivered.set(suffix, { resourceKey: read.resourceKey!, contentHash: await hashCanonicalValue(expected.value) })
  }
  for (const item of resources.filter(r => r.mandatory)) if (!delivered.has(item.suffix)) p.fail('局势缺少实际完整交付的必读合同/阶段/目录/历史')
  const review = await reviewTtrpgOpenGeneratedSituationProposalV1({ value: input.value, basis })
  const planned = planTtrpgOpenSituationReferenceNeedsV1({ template: review.proposal.template, personalizationSourceKeys: review.proposal.personalizationSourceKeys,
    basis, resources, availableSuffixes: new Set(delivered.keys()) })
  const references = planned.map(({ suffix, ...reference }) => {
    const evidence = delivered.get(suffix) ?? p.fail('局势引用的正文未在本次完整交付：' + reference.kind + ':' + reference.ref)
    return { ...reference, ...evidence }
  })
  return { review, references }
}
/** Pure source planning, NOT evidence that any model has read the planned resource. */
export function planTtrpgOpenSituationReferenceNeedsV1(input: {
  template: TtrpgSituationTemplateV1; personalizationSourceKeys?: readonly string[]; basis: TtrpgOpenSituationProposalBasisV1;
  resources: TtrpgOpenSituationKernelSnapshotV1['resources']; availableSuffixes: ReadonlySet<string>;
}) {
  const { template: t, basis, resources, availableSuffixes } = input, c = basis.campaign, rule = basis.rule
  const references: Array<{ suffix: string; kind: string; ref: string }> = []
  const need = (suffix: string, kind: string, ref: string) => {
    if (!references.some(r => r.kind === kind && r.ref === ref && r.suffix === suffix)) references.push({ kind, ref, suffix })
  }
  const historicalOwner = basis.sessionTemplates.some(s => s.templateKey === t.templateKey && canonicalStringify(s) === canonicalStringify(t))
  const historicalInstance = (key: string) => historicalOwner && !basis.runtimeEntityReferences?.references.some(row => row.entityRef === key)
    && basis.historicalRuntimeEntityReferences?.some(row => row.entityRef === key)
  const historical = (key: string) => historicalOwner && basis.retiredSessionFacts?.some(f => f.factKey === key)
  const fact = (key: string) => {
    if (historical(key)) need('situation-definition.' + t.templateKey, 'adopted-historical-reference', key)
    else need((basis.sessionFacts.some(f => f.factKey === key) ? 'session-fact.' : 'world-fact.') + key, 'fact', key)
  }
  const entity = (key: string) => {
    if (historicalInstance(key)) { need('situation-definition.' + t.templateKey, 'adopted-historical-reference', key); return }
    need('entity.' + key, 'entity', key)
    const instance = basis.runtimeEntityReferences?.references.find(row => row.entityRef === key)
    if (instance) {
      need('runtime-entity-references', 'runtime-identity', key)
      if (instance.dynamicTemplateKey) need('dynamic-template.' + instance.dynamicTemplateKey, 'original-instance-template', instance.dynamicTemplateKey)
      if (instance.kind === 'actor') need('actor.' + instance.templateKey, 'original-npc-definition', instance.templateKey)
      if (instance.kind === 'item') need('item-definition.' + instance.templateKey, 'original-item-definition', instance.templateKey)
    }
  }
  const action = (key: string, kind: 'action' | 'generic-check' = 'action') => need((kind === 'generic-check' ? 'check.' : 'action.') + key, kind, key)
  const effect = (key: string | null) => { if (key !== null) need('effect.' + key, 'effect', key) }
  const provenance = (key: string) => {
    const source = resources.find(r => availableSuffixes.has(r.suffix) && (
      c.frozenWorldPredicateIndex.entries.some(f => r.suffix === 'world-fact.' + f.factKey && f.sourceResourceRefs.includes(key))
      || c.entityBindings.some(b => r.suffix === 'entity.' + b.bindingKey && b.sourceResourceRef === key)
      || basis.runtimeEntityReferences && c.dynamicEntityTemplates.some(t => r.suffix === 'dynamic-template.' + t.templateKey && t.sourceRefs.includes(key))))
    if (!source) p.fail('世界溯源引用没有本次完整读取的冻结抽取资料')
    need(source.suffix, 'extracted-world-provenance', key)
  }
  const ref = (key: string) => {
    if (historical(key)) fact(key)
    else if (c.frozenWorldPredicateIndex.entries.some(f => f.factKey === key) || basis.sessionFacts.some(f => f.factKey === key)) fact(key)
    else if (c.entityBindings.some(b => b.bindingKey === key) || basis.runtimeEntityReferences?.references.some(row => row.entityRef === key) || historicalInstance(key)) entity(key)
    else if (key === c.campaignKey) need('campaign-premise', 'campaign', key)
    else if (key === rule.ruleSystemId) need('rules-core', 'rules', key)
    else if (c.fronts.some(f => f.frontKey === key)) need('front.' + key, 'front', key)
    else if (c.clocks.some(f => f.clockKey === key)) need('clock.' + key, 'clock', key)
    else if ([...c.situationTemplates, ...basis.sessionTemplates].some(s => s.templateKey === key)) need('situation-definition.' + key, 'situation', key)
    else if (c.secrets.some(s => s.secretKey === key)) need('secret.' + key, 'secret', key)
    else if (rule.compendium.some(s => s.key === key)) need('compendium.' + key, 'rule-reference', key)
    else {
      const owner = [...c.situationTemplates, ...basis.sessionTemplates].find(s => s.evidence.some(e => e.clueRef === key))
      if (owner) need('situation-definition.' + owner.templateKey, 'existing-evidence', key)
      else provenance(key)
    }
  }
  const predicate = (value: TtrpgPredicateV1): void => {
    switch (value.op) {
      case 'all': case 'any': value.of.forEach(predicate); return
      case 'not': predicate(value.of); return
      case 'world-fact': case 'session-fact': {
        const facts = value.op === 'world-fact' ? c.frozenWorldPredicateIndex.entries : basis.sessionFacts
        const matches = facts.filter(f => f.subjectRef === value.subjectRef && f.predicateKey === value.predicateKey && f.objectRef === value.objectRef)
        if (!matches.length && value.op === 'session-fact' && historicalOwner) {
          const old = basis.retiredSessionFacts?.find(f => f.subjectRef === value.subjectRef && f.predicateKey === value.predicateKey && f.objectRef === value.objectRef)
          if (old) { fact(old.factKey); return }
        }
        if (!matches.length) p.fail('局势谓词缺少真实事实槽')
        matches.forEach(f => fact(f.factKey)); return
      }
      case 'evidence-known-by': if (!t.evidence.some(e => e.clueRef === value.clueRef)) ref(value.clueRef); entity(value.actorKey); return
      case 'clock-at-least': need('clock.' + value.clockKey, 'clock', value.clockKey); return
      case 'front-stage-at-least': need('front.' + value.frontKey, 'front-stage', value.stageKey); return
      case 'actor-at': entity(value.actorKey); entity(value.locationRef); return
      case 'item-held': entity(value.actorKey); entity(value.itemKey); return
      case 'ability-available': entity(value.actorKey); action(value.abilityKey); return
      case 'resource-at-least': entity(value.actorKey); need('rules-core', 'resource-definition', value.resourceKey); return
      case 'social-balance-at-least': {
        need('current-ledgers', 'social-balance', value.balanceKey); need('rules-core', 'social-rules', value.balanceKey)
        if (!rule.socialTierMappings.some(m => m.balanceKey === value.balanceKey)) {
          const owner = c.effectPlanTemplates.find(plan => [...plan.effects, ...plan.alternatives.flatMap(a => a.effects)].some(e => e.family === 'social' && e.socialKey === value.balanceKey))
          if (!owner) p.fail('局势社会余额缺少冻结规则定义')
          effect(owner.planKey)
        }
        return
      }
      case 'story-fact': {
        need('current-ledgers', 'story-fact', value.factKey)
        const owner = c.effectPlanTemplates.find(plan => [...plan.effects, ...plan.alternatives.flatMap(a => a.effects)].some(e => e.family === 'story' && e.storyKey === value.factKey))
        if (!owner) p.fail('局势局部事实缺少冻结规则定义'); effect(owner.planKey); return
      }
      case 'situation-active': need('situation-definition.' + value.templateKey, 'situation', value.templateKey); return
      case 'chaos-at-least': case 'world-turn-at-least': need('situation-frame', 'current-frame', value.op); return
    }
  }
  if (t.driverBinding.kind === 'npc') {
    const driverKey = t.driverBinding.characterKey
    if (basis.runtimeEntityReferences?.references.some(row => row.entityRef === driverKey) || historicalInstance(driverKey)) entity(driverKey)
    else need('actor.' + driverKey, 'npc-driver', driverKey)
  }
  else if (t.driverBinding.kind === 'front') need('front.' + t.driverBinding.frontKey, 'front-driver', t.driverBinding.frontKey)
  else fact(t.driverBinding.factRef)
  t.driverBeliefs.forEach(b => { if (b.factRef !== null) ref(b.factRef) })
  t.preconditions.forEach(predicate)
  t.obstacles.forEach(o => { if (o.ref !== null) ref(o.ref); predicate(o.predicate) })
  t.interventionPoints.forEach(i => { i.suggestedActionKeys.forEach(key => action(key)); if (i.requiresPredicate) predicate(i.requiresPredicate) })
  for (const key of new Set([...t.interventionPoints.flatMap(i => i.knownByActorKeys),
    ...t.evidence.flatMap(e => [...e.knownByActorKeys, ...e.discoveryPolicy.recipientActorKeys])])) {
    if (basis.selectedActorKeys.includes(key)) need('situation-frame', 'selected-recipient', key)
    else need('actor.' + key, 'nonparty-recipient', key)
  }
  t.evidence.forEach(e => { e.sourceFactRefs.forEach(fact); e.sourceResourceRefs.forEach(provenance)
    e.discoveryPolicy.paths.forEach(path => action(path.key, path.kind))
    e.discoveryPolicy.preconditions.forEach(predicate); effect(e.discoveryPolicy.failForwardEffectPlanRef); effect(e.discoveryPolicy.costEffectPlanRef) })
  t.whyNowRefs.forEach(key => {
    const separator = key.indexOf(':'), kind = key.slice(0, separator), value = key.slice(separator + 1)
    if (kind === 'world') c.frozenWorldPredicateIndex.entries.filter(f => f.subjectRef + ':' + f.predicateKey === value).forEach(f => fact(f.factKey))
    else if (kind === 'session') fact(value)
    else if (kind === 'clock') need('clock.' + value, 'why-now-clock', value)
    else { const owner = c.fronts.find(f => f.telegraph.some(t => t.telegraphKey === value)) ?? p.fail('局势征兆来源缺失'); need('front.' + owner.frontKey, 'why-now-telegraph', value) }
  })
  effect(t.noInterventionOutcome.effectPlanRef); t.noInterventionOutcome.advancesClockKeys.forEach(key => need('clock.' + key, 'clock', key))
  t.consequences.forEach(v => { ref(v.ref); effect(v.effectPlanRef); if (v.nextSituationTemplateKey !== null) need('situation-definition.' + v.nextSituationTemplateKey, 'next-situation', v.nextSituationTemplateKey) })
  t.sourceRefs.forEach(ref)
  ;(input.personalizationSourceKeys ?? []).forEach(key => need('personalization.' + key, 'personalization', key))
  return references.sort((a, b) => { const left = canonicalStringify(a), right = canonicalStringify(b); return left < right ? -1 : left > right ? 1 : 0 })
}
