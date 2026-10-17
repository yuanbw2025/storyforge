/** Model name-only knowledge. It does not amend target, inventory, location or evidence-gate authority. */
import type { WorkspaceScope } from '../types'
import type { ContextResourceDescriptorV1, FrozenResourceScopeV1 } from '../registry/types'
import { resolveScope } from '../workspace/scope'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { selectTtrpgOpenKnownIdentitiesV1 } from './open-identity-model-projection'
import { ttrpgOpenEvidenceFieldsV1 } from './open-knowledge'
import { TTRPG_OPEN_LEARNED_IDENTITY_SOURCE_V1 } from './open-model-purpose-contract'
import { createTtrpgOpenRuntimeResourceProviderV1 } from './open-runtime-resource-provider'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { hashCanonicalValue } from '../agent/run/hash'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import { estimateTokens } from '../ai/context-budget'
import { TtrpgOpenReadConflictV1 } from './open-read-conflict'
import { ttrpgOpenRecallReadStampV1 } from './open-recall-read-stamp'

type Input = { scope: WorkspaceScope; sessionId: number; actorKey: string }
async function readModel(input: Input) {
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'actor', actorKey: input.actorKey } })
  const { runtime, state, stateHash, session } = loaded
  const { chosen, evidence } = await selectTtrpgOpenKnownIdentitiesV1(loaded, input.actorKey)
  const identities = [...chosen.values()].map(({ identity, knowledge }) => ({
    entityRef: identity.entityRef, kind: identity.kind, name: identity.name,
    knowledgeKey: knowledge.knowledgeKey, acquisitionRef: knowledge.acquisitionRef, reliability: knowledge.reliability,
    evidenceRef: knowledge.evidenceRef, evidenceTitle: ttrpgOpenEvidenceFieldsV1(evidence, knowledge.evidenceRef).title,
  })).sort((a, b) => a.entityRef < b.entityRef ? -1 : a.entityRef > b.entityRef ? 1 : 0)
  const contract = { schema: 'storyforge.ttrpg-open-learned-identities-context', version: 1, actorKey: input.actorKey,
    semanticIdentitiesOnly: true, originalNames: true, receiptSelection: 'strongest-reliability-then-latest', hearsayIsNotFirsthand: true,
    grantsNoTargetOrResourcePermission: true, locationEquipmentAndCurrentStateExcluded: true, grantsNoEvidenceGate: true }
  const resources = [{ suffix: 'learned-identity-contract', title: '当前角色已知身份的边界', mandatory: true, value: contract },
    ...identities.map(identity => ({ suffix: `learned-identity.${identity.entityRef}`, title: identity.name, mandatory: false,
      value: { schema: 'storyforge.ttrpg-open-learned-identity', version: 1, ...identity } }))]
  const context = { resources, view: { ...contract, identities }, visibilityHash: await hashCanonicalValue({ contract, identities }),
    readEvidence: { sessionKey: runtime.sessionKey, sequence: state.lastSequence, stateHash, runtimeSourceHash: session.runtimeSourceHash } }
  await loaded.assertCurrent(); return { context, loaded }
}
export async function loadTtrpgOpenLearnedIdentityContextV1(input: Input) { return (await readModel(input)).context }
export function createTtrpgOpenLearnedIdentityProviderV1() {
  return createTtrpgOpenRuntimeResourceProviderV1({ sourceKey: TTRPG_OPEN_LEARNED_IDENTITY_SOURCE_V1,
    providerVersion: 'ttrpg-open-learned-identities-provider-v1', normalizationVersion: 'ttrpg-open-learned-identities-json-v1', kinds: ['fact'], catalog })
}
async function catalog(scope: FrozenResourceScopeV1) {
  if (!scope.productRuntimeSessionId || !scope.worldId || !scope.workId || !scope.runtimeActorKey || scope.runtimeActorKey === 'gm') throw new Error('[ttrpg-identities] 需要准确的团局与玩家 POV')
  const workspace = await resolveScope({ scope: { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId } })
  const { context, loaded } = await readModel({ scope: workspace, sessionId: scope.productRuntimeSessionId, actorKey: scope.runtimeActorKey })
  const sourceKey = TTRPG_OPEN_LEARNED_IDENTITY_SOURCE_V1, prefix = `fact:ttrpg-open:${context.readEvidence.sessionKey}:${scope.runtimeActorKey}`
  const fingerprint = await ttrpgOpenRecallReadStampV1({ scope, workspace, loaded, consumer: 'actor' })
  const policyHash = await hashCanonicalValue({ sourceKey, actorKey: scope.runtimeActorKey, schema: context.view.schema, version: 1, semanticIdentityOnly: true, fullIsAtomic: true })
  const resources = await Promise.all(context.resources.map(async row => {
    const content = stable(row.value), contentHash = await hash(row.value), tokenCount = estimateTokens(content)
    const descriptor: ContextResourceDescriptorV1 = { version: 1, resourceKey: `${prefix}:${row.suffix}`, sourceKey, kind: 'fact', title: row.title, shortSummary: row.title,
      authority: 'confirmed-evidence', contentRevision: context.readEvidence.sequence, contentHash, policyRevision: 1, policyHash,
      scope: { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId, productRuntimeSessionId: scope.productRuntimeSessionId, runtimeActorKey: scope.runtimeActorKey },
      sourceRefs: [{ table: 'productRuntimeSessions', recordId: scope.productRuntimeSessionId!, field: 'runtimeHeadStateJson', revision: context.readEvidence.sequence, contentHash: context.readEvidence.stateHash }],
      relations: [], tokenEstimate: { full: tokenCount }, availableDepths: ['full'], priority: row.mandatory ? 'must-read' : 'normal' }
    return { descriptor, content, tokenCount }
  }))
  await loaded.assertCurrent()
  return { fingerprint, resources, assertCurrent: async () => {
    try { await loaded.assertCurrent() } catch { throw new TtrpgOpenReadConflictV1('身份知识读取期间角色、原记录或进度已经变化') }
  } }
}
