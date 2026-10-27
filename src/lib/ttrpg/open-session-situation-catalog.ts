/** One read-only resolver. Its combined view is never a frozen Campaign/RuntimePackage. */
import type { TtrpgCampaignContentV2, TtrpgSituationTemplateV1 } from './open-contract'
import type { TtrpgOpenSessionSituationReceipt } from './open-session-situation-contract'
import { ttrpgOpenSessionFactsV1, type TtrpgOpenFactLedger } from './open-fact-ledger'
import * as p from './open-contract-parse'
import type { TtrpgOpenRuntimeEntityReferenceV1 } from './open-runtime-entity-references'

/** Historical identity resolution only. This union is never delivered as the current consumer's model directory. */
export function ttrpgOpenSituationRuntimeReferenceCatalogV1(receipts: readonly TtrpgOpenSessionSituationReceipt[]) {
  const identities = new Map<string, TtrpgOpenRuntimeEntityReferenceV1>()
  for (const receipt of receipts) for (const row of receipt.runtimeEntityReferences?.references ?? []) {
    const prior = identities.get(row.entityRef)
    if (prior && JSON.stringify(prior) !== JSON.stringify(row)) p.fail('不同局势不得重定义同一原实例身份或接收者')
    identities.set(row.entityRef, row)
  }
  return [...identities.values()]
}

export interface TtrpgOpenSessionSituationRefV1 { templateKey: string; receiptHash: string }
/** A generated party/public label cannot widen the original once request to future seats. */
export function ttrpgOpenSessionSituationActorAccessV1(run: { situationReceipts?: readonly TtrpgOpenSessionSituationReceipt[] } | null | undefined, templateKey: string, actorKey: string) {
  const owner = run?.situationReceipts?.find(row => row.template.templateKey === templateKey)
  return owner?.version !== 2 || owner.disclosure.authorization.basis.recipientActorKeys.includes(actorKey)
}
export function ttrpgOpenSessionSituationDiscoveryPolicyV1(owner: TtrpgOpenSessionSituationReceipt | undefined,
  policy: TtrpgSituationTemplateV1['evidence'][number]['discoveryPolicy']): TtrpgSituationTemplateV1['evidence'][number]['discoveryPolicy'] {
  if (owner?.version !== 2 || policy.allowedAudience === 'gm-only') return policy
  const allowed = owner.disclosure.authorization.basis.recipientActorKeys
  const requested = policy.recipientActorKeys.length ? policy.recipientActorKeys : policy.allowedAudience === 'private' ? [] : allowed
  return { ...policy, allowedAudience: policy.allowedAudience === 'private' ? 'private' : 'party',
    recipientActorKeys: requested.filter(actor => allowed.includes(actor)) }
}
export function parseTtrpgOpenSessionSituationRefsV1(value: unknown) {
  const refs = p.list(value, 'cycle accepted situation refs', (value) => {
    const r = p.record(value, ['templateKey', 'receiptHash'], 'accepted situation ref')
    return { templateKey: p.key(r.templateKey, 'accepted template identity'), receiptHash: p.hash(r.receiptHash, 'original accepted receipt') }
  }, 1000, 1)
  p.unique(refs.map(r => r.templateKey), 'cycle accepted situation refs')
  return refs
}
/** Include actual active/queued owners and their next-definition dependencies, not the whole catalog. */
export function ttrpgOpenSituationCatalogSnapshotV1(campaign: TtrpgCampaignContentV2, run: {
  situationReceipts?: readonly TtrpgOpenSessionSituationReceipt[];
  situations: { active: readonly { templateKey: string }[]; queued: readonly { templateKey: string }[] };
}): { sessionSituationRefs?: TtrpgOpenSessionSituationRefV1[] } {
  const catalog = ttrpgOpenSituationCatalogV1(campaign, run), keys = new Set([...run.situations.active, ...run.situations.queued].map(i => i.templateKey))
  for (const key of [...keys]) for (const consequence of catalog.byKey.get(key)?.consequences ?? []) {
    if (consequence.nextSituationTemplateKey) keys.add(consequence.nextSituationTemplateKey)
  }
  const refs = (run.situationReceipts ?? []).filter(r => keys.has(r.template.templateKey)).map(r => ({ templateKey: r.template.templateKey, receiptHash: r.receiptHash }))
  return refs.length ? { sessionSituationRefs: refs } : {}
}

export function ttrpgOpenSituationCatalogV1(campaign: TtrpgCampaignContentV2, run?: { situationReceipts?: readonly TtrpgOpenSessionSituationReceipt[]; factLedger?: TtrpgOpenFactLedger } | null) {
  const sessionTemplates = (run?.situationReceipts ?? []).map(r => r.template)
  const templates = [...campaign.situationTemplates, ...sessionTemplates]
  p.unique(templates.map(t => t.templateKey), 'frozen/session situation identity')
  p.unique(templates.flatMap(t => t.evidence.map(e => e.clueRef)), 'frozen/session evidence identity')
  const byKey = new Map(templates.map(t => [t.templateKey, t]))
  const evidence = new Map(templates.flatMap(template => template.evidence.map(item => [item.clueRef, { template, evidence: item }] as const)))
  const runtimeEntityReferences = ttrpgOpenSituationRuntimeReferenceCatalogV1(run?.situationReceipts ?? [])
  return { templates, sessionTemplates, byKey, evidence,
    /** Ephemeral validation view only; keep campaign/source hashes bound to the original campaign. */
    validationView: { ...campaign, situationTemplates: templates,
      ...(runtimeEntityReferences.length ? { runtimeEntityReferences } : {}),
      ...(run?.factLedger ? { sessionFactKeys: ttrpgOpenSessionFactsV1(run.factLedger).map(f => f.factKey) } : {}) } }
}
