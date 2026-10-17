/** Per-read identity selection from the canonical owner. No cache, inferred grants or model execution. */
import type { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { ttrpgOpenIdentitySourceBeforeV1 } from './open-identity-knowledge'
import { ttrpgOpenKnowledgeDiscoveryOriginV1 } from './open-knowledge-share'
import { hashTtrpgOpenEvidenceFieldsV1 } from './open-knowledge'
import { ttrpgOpenSituationCatalogV1 } from './open-session-situation-catalog'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'

export async function selectTtrpgOpenKnownIdentitiesV1(loaded: Awaited<ReturnType<typeof loadTtrpgOpenMemoryReadStateV1>>, actorKey: string) {
  const { runtime, content } = loaded, run = runtime.openRun!
  const eligible = run.knowledge.filter(row => row.identityGrant && row.audience !== 'gm-only' && (row.audience === 'public' || row.recipientActorKeys.includes(actorKey)))
  const chosen = new Map<string, { identity: NonNullable<(typeof eligible)[number]['identityGrant']>['identities'][number]; knowledge: (typeof eligible)[number] }>()
  const rank = { observed: 3, hearsay: 2, belief: 1 }, contentHash = eligible.length ? await hash(content) : ''
  const evidence = ttrpgOpenSituationCatalogV1(content.campaign, run).validationView, fields = new Map<string, string>()
  for (const knowledge of eligible) {
    const origin = ttrpgOpenKnowledgeDiscoveryOriginV1(runtime, knowledge)
    let fieldsHash = fields.get(knowledge.evidenceRef)
    if (!fieldsHash) { fieldsHash = await hashTtrpgOpenEvidenceFieldsV1(evidence, knowledge.evidenceRef); fields.set(knowledge.evidenceRef, fieldsHash) }
    if (origin.contentHash !== contentHash || stable(origin.frozenContent) !== stable(content) || fieldsHash !== knowledge.publicFieldsHash) throw new Error('[ttrpg-identities] 原观察没有同一冻结内容与准确字段')
    for (const identity of knowledge.identityGrant!.identities) {
      const previous = chosen.get(identity.entityRef)
      if (!previous || rank[knowledge.reliability] > rank[previous.knowledge.reliability] || rank[knowledge.reliability] === rank[previous.knowledge.reliability]
        && ttrpgOpenIdentitySourceBeforeV1(runtime, previous.knowledge.acquisitionRef, knowledge.acquisitionRef)) chosen.set(identity.entityRef, { identity, knowledge })
    }
  }
  return { chosen, evidence }
}
