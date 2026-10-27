/** Durable knowledge is a recipient grant, never an objective fact or active-situation flag. */
import type { TtrpgOpenAudience, TtrpgCampaignContentV2 } from './open-contract'
import type { TtrpgOpenAuthorizationV1 } from './open-authorization'
import { parseTtrpgOpenSourceRefV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import { hashProductProductionValueV2 } from '../product-production/hash'
import * as p from './open-contract-parse'
import { parseTtrpgOpenKnowledgeIdentityGrantV1, type TtrpgOpenKnowledgeIdentityGrantV1 } from './open-identity-knowledge-contract'

export interface TtrpgOpenKnowledgeEntryV1 {
  knowledgeKey: string
  evidenceRef: string
  sourceFactRefs: string[]
  sourceResourceRefs: string[]
  acquisitionRef: TtrpgOpenSourceRefV1
  audience: TtrpgOpenAudience
  recipientActorKeys: string[]
  publicFieldsHash: string
  reliability: 'observed' | 'hearsay' | 'belief'
  identityGrant?: TtrpgOpenKnowledgeIdentityGrantV1
}
export interface TtrpgOpenKnowledgeDisplayV1 {
  evidenceRef: string; title: string; description: string
  reliability: TtrpgOpenKnowledgeEntryV1['reliability']
}
export function parseTtrpgOpenKnowledgeEntryV1(value: unknown): TtrpgOpenKnowledgeEntryV1 {
  const r = p.record(value, ['knowledgeKey', 'evidenceRef', 'sourceFactRefs', 'sourceResourceRefs', 'acquisitionRef',
    'audience', 'recipientActorKeys', 'publicFieldsHash', 'reliability', ...(Object.prototype.hasOwnProperty.call(value, 'identityGrant') ? ['identityGrant'] : [])], 'knowledge entry')
  const audience = p.oneOf(r.audience, p.AUDIENCES, 'knowledge audience')
  const recipientActorKeys = p.keys(r.recipientActorKeys, 'knowledge recipients', 1000)
  if ((audience === 'private' || audience === 'party') && !recipientActorKeys.length) p.fail('发现后的 private/party 知识必须有明确接收者')
  if (audience === 'gm-only' && recipientActorKeys.length) p.fail('gm-only 知识不能向玩家授予')
  return { knowledgeKey: p.key(r.knowledgeKey, 'knowledge key'), evidenceRef: p.key(r.evidenceRef, 'evidence ref'),
    sourceFactRefs: p.keys(r.sourceFactRefs, 'source facts', 100), sourceResourceRefs: p.keys(r.sourceResourceRefs, 'source resources', 100),
    acquisitionRef: parseTtrpgOpenSourceRefV1(r.acquisitionRef), audience, recipientActorKeys,
    publicFieldsHash: p.hash(r.publicFieldsHash, 'public fields hash'), reliability: p.oneOf(r.reliability, ['observed', 'hearsay', 'belief'], 'reliability'),
    ...(Object.prototype.hasOwnProperty.call(r, 'identityGrant') ? { identityGrant: parseTtrpgOpenKnowledgeIdentityGrantV1(r.identityGrant) } : {}) }
}
export function parseTtrpgOpenKnowledgeV1(value: unknown): TtrpgOpenKnowledgeEntryV1[] {
  const entries = p.list(value, 'knowledge', parseTtrpgOpenKnowledgeEntryV1, 100_000)
  p.unique(entries.map(entry => entry.knowledgeKey), 'knowledge keys')
  return entries
}
export function ttrpgOpenEvidenceFieldsV1(campaign: TtrpgCampaignContentV2, evidenceRef: string) {
  const evidence = campaign.situationTemplates.flatMap(template => template.evidence).find(evidence => evidence.clueRef === evidenceRef)
  if (!evidence) p.fail('知识引用不存在的冻结 evidence')
  return { title: evidence.title, description: evidence.description }
}
export async function hashTtrpgOpenEvidenceFieldsV1(campaign: TtrpgCampaignContentV2, evidenceRef: string): Promise<string> {
  return hashProductProductionValueV2(ttrpgOpenEvidenceFieldsV1(campaign, evidenceRef))
}
export function ttrpgOpenActorKnowsEvidenceV1(entries: readonly TtrpgOpenKnowledgeEntryV1[], actorKey: string, evidenceRef: string): boolean {
  return entries.some(entry => !entry.identityGrant && entry.evidenceRef === evidenceRef && entry.reliability === 'observed'
    && entry.audience !== 'gm-only' && (entry.audience === 'public' || entry.recipientActorKeys.includes(actorKey)))
}
/** Hearsay/belief remains visible as labeled observation but cannot satisfy objective evidence gates. */
export function projectTtrpgOpenKnowledgeForViewerV1(input: {
  entries: readonly TtrpgOpenKnowledgeEntryV1[]; authorization: TtrpgOpenAuthorizationV1
  viewerKey: string; campaign: TtrpgCampaignContentV2
}): TtrpgOpenKnowledgeDisplayV1[] {
  const seat = input.authorization.seats.find(seat => seat.viewerKey === input.viewerKey)
  if (!seat || seat.role !== 'player' || seat.actorKey === null || !input.authorization.selectedActorKeys.includes(seat.actorKey)) p.fail('知识投影缺少已授权玩家身份')
  const actorKey = seat.actorKey
  const entries = input.entries.filter(entry => entry.identityGrant?.mode !== 'observation' && entry.audience !== 'gm-only'
    && (entry.audience === 'public' || entry.recipientActorKeys.includes(actorKey)))
  return entries.map(entry => ({ evidenceRef: entry.evidenceRef, ...ttrpgOpenEvidenceFieldsV1(input.campaign, entry.evidenceRef), reliability: entry.reliability }))
}
export function projectTtrpgOpenPublicKnowledgeV1(entries: readonly TtrpgOpenKnowledgeEntryV1[], campaign: TtrpgCampaignContentV2): TtrpgOpenKnowledgeDisplayV1[] {
  return entries.filter(entry => entry.identityGrant?.mode !== 'observation' && entry.audience === 'public').map(entry => ({ evidenceRef: entry.evidenceRef,
    ...ttrpgOpenEvidenceFieldsV1(campaign, entry.evidenceRef), reliability: entry.reliability }))
}
/** Scope is frozen at acquisition. Later roster changes do not expand an old party grant. */
export function assertTtrpgOpenKnowledgeClosureV1(input: {
  entries: readonly TtrpgOpenKnowledgeEntryV1[]; campaign: TtrpgCampaignContentV2
  authorization: TtrpgOpenAuthorizationV1; availableSourceSessionKeys: readonly string[]
}): void {
  const actors = new Set(input.authorization.seats.filter(seat => seat.role === 'player').map(seat => seat.actorKey))
  const facts = new Set(input.campaign.frozenWorldPredicateIndex.entries.map(fact => fact.factKey))
  const resources = new Set(input.campaign.frozenWorldPredicateIndex.entries.flatMap(fact => fact.sourceResourceRefs))
  for (const entry of input.entries) {
    ttrpgOpenEvidenceFieldsV1(input.campaign, entry.evidenceRef)
    if (entry.recipientActorKeys.some(actorKey => !actors.has(actorKey)) || entry.sourceFactRefs.some(ref => !facts.has(ref))
      || entry.sourceResourceRefs.some(ref => !resources.has(ref)) || !input.availableSourceSessionKeys.includes(entry.acquisitionRef.sessionKey)) {
      p.fail('知识的角色/来源/血缘引用不闭合')
    }
  }
}
