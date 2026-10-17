import { ttrpgOpenMechanicalStateHashV1 } from './open-rule-plan'
/** Common-only source foundation. Catalog/read/hash is never permission to send or adopt a fact. */
import { assertTtrpgOpenCommonOracleRequestSourceV1 } from './open-common-oracle-request'
import { ttrpgOpenCommonOracleSourceContractV1 } from './open-common-oracle-delivery'
import type { WorkspaceScope } from '../types'
import type { ContextResourceDescriptorV1, FrozenResourceScopeV1 } from '../registry/types'
import { canonicalStringify as stable, hashCanonicalValue } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { estimateTokens } from '../ai/context-budget'
import { resolveScope } from '../workspace/scope'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { loadTtrpgOpenCommonOracleProjectionV1 } from './open-player-context'
import { TtrpgOpenReadConflictV1 } from './open-read-conflict'
import { ttrpgOpenEntityIdentityCatalogV1, ttrpgOpenEntityReferenceVisibleV1 } from './open-entity-catalog'
import { createTtrpgOpenOracleRuntimeReferencePolicyV1, ttrpgOpenOracleRuntimeReferenceKeysV1 } from './open-runtime-entity-references'
import { projectTtrpgOpenOracleRuntimeIdentityScopeV1, isTtrpgOpenOracleRuntimeGuidanceVisibleV1 } from './open-oracle-runtime-delivery'
import { createTtrpgOpenRuntimeResourceProviderV1, type TtrpgOpenResourceRowV1 } from './open-runtime-resource-provider'

export const TTRPG_OPEN_COMMON_ORACLE_SOURCE_V1 = 'ttrpgOpenCommonOracleInput'
type Input = { scope: WorkspaceScope; sessionId: number; actorKey: string }
export async function loadTtrpgOpenCommonOracleContextV1(input: Input) {
  if (input.actorKey !== 'gm') throw new Error('[ttrpg-common-oracle] 共同事实来源需要明确共同视图')
  try { return (await readModel(input)).context } catch (error) { return readError(error) }
}
function readError(error: unknown): never {
  if (error instanceof TtrpgOpenReadConflictV1) throw new TtrpgOpenReadConflictV1('共同事实读取期间身份、来源或进度已变化')
  throw new Error('[ttrpg-common-oracle] 当前共同事实资料不可读取，请检查本桌授权与来源')
}
async function readModel(input: Input) {
  if (input.actorKey !== 'gm') throw new Error('[ttrpg-common-oracle] 共同事实来源需要明确共同视图')
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'party' } })
  const common = await loadTtrpgOpenCommonOracleProjectionV1(input)
  const { runtime, content, state, stateHash, source, authorization } = loaded, run = runtime.openRun!
  const gm = authorization.seats.find(row => row.role === 'gm')
  if (gm?.controller !== 'ai' || !gm.consent.aiIdentityDisclosed || !gm.consent.aiAdviceAllowed
    || run.stage.status !== 'open') throw new Error('[ttrpg-common-oracle] 共同事实资料需要当前 AI 主持及未暂停的进行中阶段')
  if (common.readEvidence.sequence !== state.lastSequence || common.readEvidence.stateHash !== stateHash
    || common.readEvidence.runtimeSourceHash !== source.runtimeSourceHash
    || stable(common.recipientActorKeys) !== stable([...authorization.selectedActorKeys].sort())) {
    throw new TtrpgOpenReadConflictV1('共同事实读取期间来源、进度或接收者已变化')
  }
  const recipients = common.recipientActorKeys, catalog = ttrpgOpenEntityIdentityCatalogV1(content, run.entityOperations ?? [])
  const resources: Array<{ suffix: string; title: string; mandatory: boolean; value: unknown }> = [{
    suffix: 'common-oracle-contract', title: '共同 Oracle 解释与事实的来源边界', mandatory: true,
    value: ttrpgOpenCommonOracleSourceContractV1({ recipientActorKeys: recipients, content }) }]
  const directory = []
  for (const oracle of common.oracleHistory) {
    if (oracle.audience === 'gm-only') throw new Error('[ttrpg-common-oracle] 私域咨询不能成为共同事实输入')
    const original = run.oracleReceipts?.find(row => stable(row.sourceRef) === stable(oracle.sourceRef))
    if (!original || stable(original.resolution.outcome) !== stable(oracle.outcome) || original.audience !== oracle.audience) throw new Error('[ttrpg-common-oracle] 咨询缺少原始真实回执')
    const policyInput = { content, operations: run.entityOperations ?? [], runtimeSourceHash: source.runtimeSourceHash, oracle: original,
      recipientActorKeys: recipients, consumerRef: { sessionKey: runtime.sessionKey, sequence: state.lastSequence + 1 } }
    const runtimePolicy = ttrpgOpenOracleRuntimeReferenceKeysV1(policyInput).length ? await createTtrpgOpenOracleRuntimeReferencePolicyV1(policyInput) : undefined
    const identityScope = runtimePolicy ? projectTtrpgOpenOracleRuntimeIdentityScopeV1(runtimePolicy) : null
    const visible = (row: { audience: string; knownByActorKeys?: string[] }) => isTtrpgOpenOracleRuntimeGuidanceVisibleV1({ audience: oracle.audience, recipientActorKeys: recipients }, row.audience, row.knownByActorKeys ?? [])
    const frozenIdentities = content.campaign.entityBindings.filter(binding => visible(binding)
      && recipients.every(actor => ttrpgOpenEntityReferenceVisibleV1(binding.audience, binding.knownByActorKeys, actor, false, false)))
      .map(binding => ({ entityRef: binding.bindingKey, kind: binding.kind, audience: binding.audience, knownByActorKeys: binding.knownByActorKeys,
        playerControlled: content.campaign.characterTemplates.some(row => row.characterKey === binding.bindingKey && row.role === 'player') }))
    const instanceIdentities = identityScope?.references.map(row => {
      const binding = catalog.find(binding => binding.entityKey === row.entityRef), entity = state.entities[row.entityRef]
      if (!binding || !entity || !recipients.every(actor => ttrpgOpenEntityReferenceVisibleV1(binding.audience, binding.recipientActorKeys, actor, false, true))) throw new Error('[ttrpg-common-oracle] 实例缺少当前共同身份来源')
      return { entityRef: row.entityRef, kind: row.kind, audience: row.audience, knownByActorKeys: row.knownByActorKeys, playerControlled: false,
        name: entity.name, runtimeOrigin: row }
    }) ?? []
    const permittedEntityRefs = [...frozenIdentities, ...instanceIdentities], refs = new Set(permittedEntityRefs.map(row => row.entityRef))
    const referencesKnown = (fact: { subjectRef: string; objectRef: string | null; predicateKey: string; canonicalValue: unknown }) => refs.has(fact.subjectRef)
      && (!fact.objectRef || refs.has(fact.objectRef)) && (!['located-at', 'owns'].includes(fact.predicateKey) || typeof fact.canonicalValue !== 'string' || refs.has(fact.canonicalValue))
    const observations = new Set(common.view.initialObservations.map(stable))
    const permittedFrozenFacts = content.campaign.frozenWorldPredicateIndex.entries.filter(fact => visible(fact) && referencesKnown(fact)
      && observations.has(stable({ subjectRef: fact.subjectRef, predicateKey: fact.predicateKey, objectRef: fact.objectRef,
        canonicalValue: fact.canonicalValue, authority: fact.authority, asOf: 'release' }))).map(fact => ({ ...fact, asOf: 'release' as const }))
    // The actual all-player intersection has already checked original fact recipients and retirement.
    const permittedSessionFacts = common.view.sessionFacts.filter(fact => visible(fact) && referencesKnown(fact))
    const suffix = `common-oracle.${await hashCanonicalValue(oracle.sourceRef)}`
    const value = { schema: 'storyforge.ttrpg-open-common-oracle-input', version: 1, sourceRef: oracle.sourceRef,
      audience: oracle.audience, recipientActorKeys: recipients, outcome: oracle.outcome,
      interpretationPolicy: content.rulePack.content.oracles.find(table => table.oracleKey === oracle.outcome.oracleKey)!.interpretation,
      runtimeIdentityScope: identityScope, permittedEntityRefs, permittedFrozenFacts, permittedSessionFacts }
    resources.push({ suffix, title: oracle.outcome.question, mandatory: false, value })
    directory.push({ suffix, oracleSourceRef: oracle.sourceRef, question: oracle.outcome.question, audience: oracle.audience,
      recipientActorKeys: recipients, contentHash: await sha256Text(stable(value)), snapshotHash: identityScope?.snapshotHash ?? null })
  }
  const context = { resources, directory, recipientActorKeys: recipients, authorizationRevision: authorization.revision,
    visibilityHash: await hashCanonicalValue(resources), admissionStateHash: await ttrpgOpenMechanicalStateHashV1(state), readEvidence: common.readEvidence }
  const epoch = run.coordination.epochs.find(row => row.epochKey === run.coordination.activeEpochKey)
  if (epoch?.commonOracle) await assertTtrpgOpenCommonOracleRequestSourceV1(epoch.commonOracle.basis, context)
  await loaded.assertCurrent()
  return { context, loaded }
}
export function createTtrpgOpenCommonOracleContextProviderV1() {
  return createTtrpgOpenRuntimeResourceProviderV1({ sourceKey: TTRPG_OPEN_COMMON_ORACLE_SOURCE_V1,
    providerVersion: 'ttrpg-open-common-oracle-provider-v1', normalizationVersion: 'ttrpg-open-common-oracle-json-v1',
    kinds: ['fact', 'reference'], catalog: commonCatalog, assertAccess: async (scope, fingerprint) => {
      if ((await commonCatalog(scope)).fingerprint !== fingerprint) throw new TtrpgOpenReadConflictV1('共同事实的接收者、来源、权限或进度已变化')
    } })
}
async function commonCatalog(scope: FrozenResourceScopeV1) {
  if (!scope.productRuntimeSessionId || !scope.worldId || !scope.workId || scope.runtimeActorKey !== 'gm') throw new Error('[ttrpg-common-oracle] 共同来源需要准确团局作用域与共同视图')
  try {
    const workspace = await resolveScope({ scope: { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId } })
    const { context, loaded } = await readModel({ scope: workspace, sessionId: scope.productRuntimeSessionId, actorKey: 'gm' })
    const { immutable, source, state, stateHash, runtime } = loaded
    const fingerprint = await hashCanonicalValue({ scope, readEvidence: context.readEvidence, visibilityHash: context.visibilityHash, authorizationRevision: context.authorizationRevision })
    const policyHash = await hashCanonicalValue({ sourceKey: TTRPG_OPEN_COMMON_ORACLE_SOURCE_V1, exactWholePartyIntersection: true, fullIsAtomic: true, originalRead: false })
    const sourceRefs: ContextResourceDescriptorV1['sourceRefs'] = [
      { table: immutable.table, recordId: immutable.recordId, field: immutable.field, revision: source.packageHash, contentHash: await sha256Text(immutable.raw!) },
      { table: 'productRuntimeSessions', recordId: scope.productRuntimeSessionId, field: 'runtimeHeadStateJson', revision: state.lastSequence, contentHash: stateHash }]
    const resources: TtrpgOpenResourceRowV1[] = await Promise.all(context.resources.map(async item => {
      const content = stable(item.value), tokenCount = estimateTokens(content)
      return { content, tokenCount, descriptor: { version: 1, resourceKey: `fact:ttrpg-open:${runtime.sessionKey}:gm:${item.suffix}`,
        sourceKey: TTRPG_OPEN_COMMON_ORACLE_SOURCE_V1, kind: item.mandatory ? 'fact' : 'reference', title: item.title, shortSummary: item.title,
        authority: 'confirmed-evidence', contentRevision: state.lastSequence, contentHash: await sha256Text(content), policyRevision: 1, policyHash,
        scope: { ...workspace, productRuntimeSessionId: scope.productRuntimeSessionId, runtimeActorKey: 'gm' }, relations: [], sourceRefs,
        tokenEstimate: { full: tokenCount }, availableDepths: ['full'], priority: item.mandatory ? 'must-read' : 'normal' } }
    }))
    await loaded.assertCurrent()
    return { fingerprint, resources }
  } catch (error) { return readError(error) }
}
