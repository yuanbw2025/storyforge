/** All-current-player intersection, independent of GM secrecy and individual advice consent. */
import type { WorkspaceScope } from '../types'
import type { ContextResourceDescriptorV1, FrozenResourceScopeV1 } from '../registry/types'
import { resolveScope } from '../workspace/scope'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { selectTtrpgOpenKnownIdentitiesV1 } from './open-identity-model-projection'
import { TTRPG_OPEN_COMMON_IDENTITY_SOURCE_V1 } from './open-model-purpose-contract'
import { createTtrpgOpenRuntimeResourceProviderV1 } from './open-runtime-resource-provider'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { hashCanonicalValue } from '../agent/run/hash'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import { estimateTokens } from '../ai/context-budget'
import { TtrpgOpenReadConflictV1 } from './open-read-conflict'
import { ttrpgOpenRecallReadStampV1 } from './open-recall-read-stamp'

type Input = { scope: WorkspaceScope; sessionId: number; actorKey: string }
async function readCommon(input: Input) {
  if (input.actorKey !== 'gm') throw new Error('[ttrpg-common-identities] 需要明确共同叙述 POV')
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'party' } })
  const { runtime, state, stateHash, session, authorization } = loaded
  const recipientActorKeys = [...authorization.selectedActorKeys].sort()
  if (!recipientActorKeys.length) throw new Error('[ttrpg-common-identities] 没有当前实际队员')
  const selected = await Promise.all(recipientActorKeys.map(actorKey => selectTtrpgOpenKnownIdentitiesV1(loaded, actorKey)))
  const rank = { observed: 3, hearsay: 2, belief: 1 }
  const identities = [...selected[0].chosen.values()].flatMap(({ identity }) => {
    const receipts = selected.map(view => view.chosen.get(identity.entityRef))
    if (receipts.some(row => !row)) return []
    if (receipts.some(row => stable(row!.identity) !== stable(identity))) throw new Error('[ttrpg-common-identities] 原创建身份不一致')
    const reliability = receipts.map(row => row!.knowledge.reliability).reduce((a, b) => rank[a] <= rank[b] ? a : b)
    return [{ citationKey: `identity.${identity.entityRef}`, entityRef: identity.entityRef, kind: identity.kind, name: identity.name, reliability }]
  }).sort((a, b) => a.entityRef < b.entityRef ? -1 : a.entityRef > b.entityRef ? 1 : 0)
  const contract = { schema: 'storyforge.ttrpg-open-common-identities-context', version: 1, recipientActorKeys,
    semanticIdentitiesOnly: true, originalNames: true, receiptSelection: 'strongest-reliability-then-latest', reliabilityAggregation: 'weakest-of-current-recipients',
    hearsayIsNotFirsthand: true, grantsNoTargetOrResourcePermission: true, locationEquipmentAndCurrentStateExcluded: true,
    grantsNoEvidenceGate: true, citationsOnlyFromDeliveredResources: true }
  const resources = [{ suffix: 'common-identity-contract', title: '全体当前队员共同身份知识边界', mandatory: true, value: contract },
    ...identities.map(identity => ({ suffix: `common-${identity.citationKey}`, title: identity.name, mandatory: false,
      value: { schema: 'storyforge.ttrpg-open-common-identity', version: 1, ...identity } }))]
  const context = { resources, view: { ...contract, identities }, readEvidence: { sessionKey: runtime.sessionKey, sequence: state.lastSequence, stateHash, runtimeSourceHash: session.runtimeSourceHash } }
  await loaded.assertCurrent(); return { context, loaded }
}
export async function loadTtrpgOpenCommonIdentityContextV1(input: Input) { return (await readCommon(input)).context }
export function createTtrpgOpenCommonIdentityProviderV1() {
  return createTtrpgOpenRuntimeResourceProviderV1({ sourceKey: TTRPG_OPEN_COMMON_IDENTITY_SOURCE_V1,
    providerVersion: 'ttrpg-open-common-identities-provider-v1', normalizationVersion: 'ttrpg-open-common-identities-json-v1', kinds: ['fact'], catalog })
}
async function catalog(scope: FrozenResourceScopeV1) {
  if (!scope.productRuntimeSessionId || !scope.worldId || !scope.workId || scope.runtimeActorKey !== 'gm') throw new Error('[ttrpg-common-identities] 需要准确团局与共同叙述 POV')
  const workspace = await resolveScope({ scope: { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId } })
  const { context, loaded } = await readCommon({ scope: workspace, sessionId: scope.productRuntimeSessionId, actorKey: 'gm' })
  const sourceKey = TTRPG_OPEN_COMMON_IDENTITY_SOURCE_V1, prefix = `fact:ttrpg-open:${context.readEvidence.sessionKey}:gm`
  const fingerprint = await ttrpgOpenRecallReadStampV1({ scope, workspace, loaded, consumer: 'party-narrator' })
  const policyHash = await hashCanonicalValue({ sourceKey, schema: context.view.schema, version: 1, recipientActorKeys: context.view.recipientActorKeys, semanticIdentityOnly: true, fullIsAtomic: true })
  const resources = await Promise.all(context.resources.map(async row => {
    const content = stable(row.value), contentHash = await hash(row.value), tokenCount = estimateTokens(content)
    const descriptor: ContextResourceDescriptorV1 = { version: 1, resourceKey: `${prefix}:${row.suffix}`, sourceKey, kind: 'fact', title: row.title, shortSummary: row.title,
      authority: 'confirmed-evidence', contentRevision: context.readEvidence.sequence, contentHash, policyRevision: 1, policyHash,
      scope: { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId, productRuntimeSessionId: scope.productRuntimeSessionId, runtimeActorKey: 'gm' },
      sourceRefs: [{ table: 'productRuntimeSessions', recordId: scope.productRuntimeSessionId!, field: 'runtimeHeadStateJson', revision: context.readEvidence.sequence, contentHash: context.readEvidence.stateHash }],
      relations: [], tokenEstimate: { full: tokenCount }, availableDepths: ['full'], priority: row.mandatory ? 'must-read' : 'normal' }
    return { descriptor, content, tokenCount }
  }))
  await loaded.assertCurrent()
  return { fingerprint, resources, assertCurrent: async () => {
    try { await loaded.assertCurrent() } catch { throw new TtrpgOpenReadConflictV1('共同身份读取期间队员、来源或原记录已经变化') }
  } }
}
