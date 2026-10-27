/** Public projection proof. A clock observation, rule affordance or actor name is never
 * relabeled as a full GM definition, effect plan, private biography or current owner. */
import type { ContextGatewaySourceSnapshotInputV1 } from '../context-gateway/attempt-evidence'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { parseTtrpgOpenGeneratedSituationProposalV1, reviewTtrpgOpenGeneratedSituationProposalV1 } from './open-generated-situation-contract'
import type { TtrpgOpenPublicSituationKernelV1 } from './open-public-situation-kernel'
import type { TtrpgOpenPublicPredicateScopeV1 } from './open-public-situation-predicates'
import { assertTtrpgOpenPublicSituationPredicatesV1 } from './open-public-situation-predicates'
import type { loadTtrpgOpenPublicSituationContextV1 } from './open-public-situation-context'
import type { TtrpgPredicateV1 } from './open-contract'
import * as p from './open-contract-parse'

export interface TtrpgOpenPublicSituationReferenceV1 {
  kind: string; ref: string; projection: 'common-frame' | 'selected-identity' | 'release-observation' | 'confirmed-session-fact'
    | 'observed-evidence' | 'rule-definition' | 'visible-clock' | 'frozen-extraction-provenance' | 'committed-common-instance-identity';
  resourceKey: string; contentHash: string;
}
type Context = Awaited<ReturnType<typeof loadTtrpgOpenPublicSituationContextV1>>
/** Fail deterministically before model.requested/transport, using delivered public bodies only. */
export function assertTtrpgOpenPublicSituationDraftMaterialV1(snapshot: TtrpgOpenPublicSituationKernelV1, reads: readonly ContextGatewaySourceSnapshotInputV1[]) {
  const prefix = `fact:ttrpg-open:${snapshot.basis.sessionKey}:gm:`
  const full = snapshot.resources.filter(row => reads.some(read => read.sourceKey === 'ttrpgOpenPublicSituationInput'
    && read.resourceKey === prefix + row.suffix && read.content === canonicalStringify(row.value)))
  const get = (suffix: string) => full.find(row => row.suffix === suffix)?.value
  const frame = get('public-situation-frame') as Context['frame'] | undefined
  const rules = get('public-situation-rules') as Context['rules'] | undefined
  const identities = get('public-situation-identities') as { personalization: Context['personalization']; npcDriverKeys: string[] } | undefined
  const currentFacts = full.filter(row => row.suffix.startsWith('public-situation-entry.')).map(row => p.object(row.value, 'common material').entry as Context['entries'][number])
    .filter(entry => entry.kind === 'confirmed-session-fact' || entry.kind === 'release-observation' && entry.value.authority === 'invariant')
  const whyNow = new Set([...(frame?.clocks.map(row => 'clock:' + row.clockKey) ?? []), ...currentFacts.flatMap(entry =>
    entry.kind === 'confirmed-session-fact' ? ['session:' + entry.value.factKey]
      : entry.kind === 'release-observation' ? ['world:' + entry.value.subjectRef + ':' + entry.value.predicateKey] : [])])
  if (snapshot.resources.some(row => row.mandatory && !full.includes(row)) || !frame?.clocks.length || !identities?.personalization.length
    || !rules || !rules.actions.length && !rules.genericChecks.length || whyNow.size < 2
    || !currentFacts.length && !identities.npcDriverKeys.length) throw new Error('[ttrpg-public-situation] 本次完整共同资料不足以起草合法局势；未调用模型，请补充共同资料或结束本次窗口')
}
export async function reviewTtrpgOpenDeliveredPublicSituationV1(input: {
  value: unknown; snapshot: TtrpgOpenPublicSituationKernelV1; reads: readonly ContextGatewaySourceSnapshotInputV1[];
}) {
  const { snapshot } = input, prefix = `fact:ttrpg-open:${snapshot.basis.sessionKey}:gm:`
  const delivered = new Map<string, { resourceKey: string; contentHash: string }>()
  const reject = (): never => { throw new Error('[ttrpg-public-situation] 候选引用缺少本次完整共同资料证明') }
  for (const read of input.reads) {
    if (read.sourceKey !== 'ttrpgOpenPublicSituationInput' || !read.resourceKey?.startsWith(prefix) || typeof read.content !== 'string') reject()
    const suffix = read.resourceKey!.slice(prefix.length), expected = snapshot.resources.find(row => row.suffix === suffix)
    if (!expected || delivered.has(suffix) || read.content !== canonicalStringify(expected.value)) reject()
    delivered.set(suffix, { resourceKey: read.resourceKey!, contentHash: await hashCanonicalValue(expected!.value) })
  }
  for (const resource of snapshot.resources) if (resource.mandatory && !delivered.has(resource.suffix)) reject()
  const body = (suffix: string) => snapshot.resources.find(row => row.suffix === suffix)?.value ?? reject()
  const frame = body('public-situation-frame') as Context['frame']
  const scope = body('public-situation-predicates') as TtrpgOpenPublicPredicateScopeV1
  const rules = body('public-situation-rules') as Context['rules']
  const identities = body('public-situation-identities') as { personalization: Context['personalization']; npcDriverKeys: string[] }
  const instanceResource = snapshot.resources.find(row => row.suffix === 'public-situation-instances')
  const instances = instanceResource ? (p.object(instanceResource.value, 'common instances').identities as Array<{ entityRef: string; kind: string }>) : []
  const assignment = body('public-situation-assignment') as { assignedTemplateKey: string; requestKey: string; basisHash: string }
  if (assignment.assignedTemplateKey !== snapshot.basis.assignedTemplateKey || assignment.requestKey !== snapshot.requestKey
    || assignment.basisHash !== snapshot.authorizationBasisHash
    || canonicalStringify(identities.personalization.map(row => row.source)) !== canonicalStringify(snapshot.basis.personalizationSources)) reject()
  const proposal = parseTtrpgOpenGeneratedSituationProposalV1(input.value, assignment.assignedTemplateKey), t = proposal.template
  // Walk every branch before touching the full private deterministic kernel. No short-circuit
  // can turn an unsupported predicate into a hidden-state read oracle.
  assertTtrpgOpenPublicSituationPredicatesV1(t, scope)
  const references: TtrpgOpenPublicSituationReferenceV1[] = []
  const need = (suffix: string, kind: string, ref: string, projection: TtrpgOpenPublicSituationReferenceV1['projection']) => {
    const read = delivered.get(suffix) ?? reject()
    if (!references.some(row => row.kind === kind && row.ref === ref && row.resourceKey === read.resourceKey)) references.push({ kind, ref, projection, ...read })
  }
  const entries = snapshot.resources.filter(row => row.suffix.startsWith('public-situation-entry.')).map(row => ({
    suffix: row.suffix, entry: (p.object(row.value, 'common entry').entry as Context['entries'][number]) }))
  const fact = (key: string, currentOnly = false) => {
    const found = entries.find(row => (row.entry.kind === 'release-observation' && row.entry.value.factRef === key
      && (!currentOnly || row.entry.value.authority === 'invariant'))
      || (row.entry.kind === 'confirmed-session-fact' && row.entry.value.factKey === key)) ?? reject()
    need(found.suffix, 'fact', key, found.entry.kind === 'confirmed-session-fact' ? 'confirmed-session-fact' : 'release-observation')
  }
  const clock = (key: string) => {
    if (!frame.clocks.some(row => row.clockKey === key)) reject()
    need('public-situation-frame', 'clock', key, 'visible-clock')
  }
  const actor = (key: string) => {
    if (instances.some(row => row.entityRef === key && row.kind === 'actor')) need('public-situation-instances', 'visible-instance-actor', key, 'committed-common-instance-identity')
    else {
      if (!frame.actors.some(row => row.actorKey === key) && !frame.recipientActorKeys.includes(key)) reject()
      need('public-situation-frame', 'visible-actor-or-recipient', key, 'common-frame')
    }
  }
  const recipient = (key: string) => {
    if (!frame.recipientActorKeys.includes(key)) reject()
    need('public-situation-frame', 'selected-recipient', key, 'common-frame')
  }
  const action = (key: string, kind: 'action' | 'generic-check') => {
    if (kind === 'action' ? !rules.actions.some(row => row.actionKey === key) : !rules.genericChecks.some(row => row.checkKey === key)) reject()
    need('public-situation-rules', kind, key, 'rule-definition')
  }
  const provenance = (key: string) => {
    const found = entries.find(row => row.entry.kind === 'release-observation' && row.entry.value.sourceResourceRefs.includes(key)) ?? reject()
    need(found.suffix, 'extracted-world-provenance', key, 'frozen-extraction-provenance')
  }
  const ref = (key: string) => {
    if (instances.some(row => row.entityRef === key)) { need('public-situation-instances', 'visible-instance-identity', key, 'committed-common-instance-identity'); return }
    if (entries.some(row => (row.entry.kind === 'release-observation' && row.entry.value.factRef === key)
      || (row.entry.kind === 'confirmed-session-fact' && row.entry.value.factKey === key))) { fact(key); return }
    if (frame.actors.some(row => row.actorKey === key) || frame.recipientActorKeys.includes(key)) { actor(key); return }
    if (frame.clocks.some(row => row.clockKey === key)) { clock(key); return }
    const evidence = entries.find(row => row.entry.kind === 'known-evidence' && row.entry.reliability === 'observed' && row.entry.value.evidenceRef === key)
    if (evidence) { need(evidence.suffix, 'known-evidence', key, 'observed-evidence'); return }
    provenance(key)
  }
  const predicate = (value: TtrpgPredicateV1): void => {
    switch (value.op) {
      case 'all': case 'any': value.of.forEach(predicate); return
      case 'not': predicate(value.of); return
      case 'world-fact': case 'session-fact': {
        const matches = entries.filter(row => value.op === 'world-fact'
          ? row.entry.kind === 'release-observation' && row.entry.value.authority === 'invariant' && row.entry.value.subjectRef === value.subjectRef
            && row.entry.value.predicateKey === value.predicateKey && row.entry.value.objectRef === value.objectRef
          : row.entry.kind === 'confirmed-session-fact' && row.entry.value.subjectRef === value.subjectRef
            && row.entry.value.predicateKey === value.predicateKey && row.entry.value.objectRef === value.objectRef)
        if (!matches.length) reject()
        for (const row of matches) {
          if (row.entry.kind === 'release-observation') fact(row.entry.value.factRef, true)
          else if (row.entry.kind === 'confirmed-session-fact') fact(row.entry.value.factKey, true)
        }
        return
      }
      case 'clock-at-least': clock(value.clockKey); return
      case 'evidence-known-by': ref(value.clueRef); actor(value.actorKey); return
      case 'world-turn-at-least': need('public-situation-frame', 'world-turn', 'world-turn', 'common-frame'); return
      default: reject()
    }
  }
  ;[...t.preconditions, ...t.obstacles.map(row => row.predicate), ...t.interventionPoints.flatMap(row => row.requiresPredicate ? [row.requiresPredicate] : []),
    ...t.evidence.flatMap(row => row.discoveryPolicy.preconditions)].forEach(predicate)
  if (t.driverBinding.kind === 'npc') {
    if (!identities.npcDriverKeys.includes(t.driverBinding.characterKey)) reject()
    actor(t.driverBinding.characterKey)
  } else if (t.driverBinding.kind === 'world-event') fact(t.driverBinding.factRef, true)
  else reject() // No full front definitions or actual player-commitment source was delivered.
  t.driverBeliefs.forEach(belief => { if (belief.factRef !== null) ref(belief.factRef) })
  t.obstacles.forEach(row => { if (row.ref !== null) ref(row.ref) })
  t.interventionPoints.forEach(row => { row.knownByActorKeys.forEach(recipient); row.suggestedActionKeys.forEach(key => action(key, 'action')) })
  for (const evidence of t.evidence) {
    evidence.sourceFactRefs.forEach(key => fact(key)); evidence.sourceResourceRefs.forEach(provenance)
    evidence.knownByActorKeys.forEach(recipient); evidence.discoveryPolicy.recipientActorKeys.forEach(recipient)
    evidence.discoveryPolicy.paths.forEach(path => action(path.key, path.kind))
    if (evidence.discoveryPolicy.failForwardEffectPlanRef !== null || evidence.discoveryPolicy.costEffectPlanRef !== null) reject()
  }
  for (const key of t.whyNowRefs) {
    if (key.startsWith('world:')) {
      const found = entries.filter(row => row.entry.kind === 'release-observation' && row.entry.value.authority === 'invariant'
        && `world:${row.entry.value.subjectRef}:${row.entry.value.predicateKey}` === key)
      if (!found.length) reject()
      for (const row of found) if (row.entry.kind === 'release-observation') fact(row.entry.value.factRef, true)
    } else if (key.startsWith('session:')) {
      const keyRef = key.slice(8)
      if (!entries.some(row => row.entry.kind === 'confirmed-session-fact' && row.entry.value.factKey === keyRef)) reject()
      fact(keyRef, true)
    } else if (key.startsWith('clock:')) clock(key.slice(6))
    else reject() // Observed telegraph prose is not its hidden front/definition identity.
  }
  if (t.noInterventionOutcome.effectPlanRef !== null || t.consequences.length) reject()
  t.noInterventionOutcome.advancesClockKeys.forEach(clock)
  t.sourceRefs.forEach(ref)
  for (const key of proposal.personalizationSourceKeys) {
    const identity = identities.personalization.find(row => row.source.sourceKey === key) ?? reject()
    if (identity.source.kind !== 'identity' || identity.source.contentHash !== await hashCanonicalValue(identity.value)) reject()
    need('public-situation-identities', 'personalization', key, 'selected-identity')
  }
  // Predicate slot proofs point to the full declared common allowlist, without claiming that
  // a live location, inventory, HP, private story ledger or hidden effect was model-visible.
  need('public-situation-predicates', 'supported-predicate-scope', 'public-condition-scope', 'common-frame')
  const review = await reviewTtrpgOpenGeneratedSituationProposalV1({ value: input.value, basis: snapshot.basis })
  references.sort((a, b) => canonicalStringify(a).localeCompare(canonicalStringify(b)))
  return { review, references }
}
