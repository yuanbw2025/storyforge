import { createTtrpgOpenRuntimeResourceProviderV1 } from './open-runtime-resource-provider'
/** Progressive actor context. Full resources are indivisible; original runtime heads are never disclosed. */
import type { ContextResourceProviderV1, ContextResourceDescriptorV1, FrozenResourceScopeV1 } from '../registry/types'
import { resolveScope } from '../workspace/scope'
import { loadTtrpgOpenPlayerContextV1 } from './open-player-context'
import { loadTtrpgOpenKpContextV1 } from './open-kp-context'
import { loadTtrpgOpenGmOracleContextV1 } from './open-gm-oracle-context'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { estimateTokens } from '../ai/context-budget'

type SourceKey = 'ttrpgOpenAuthority' | 'ttrpgOpenKnowledge' | 'ttrpgOpenOracleHistory' | 'ttrpgOpenFacts' | 'ttrpgOpenGmOracleInput' | 'ttrpgOpenKpInput'
type RuntimeResourceRow = { suffix: string; title: string; value: unknown; mandatory: boolean }
type ResourceRow = { descriptor: ContextResourceDescriptorV1; content: string; tokenCount: number }
const catalogCache = new Map<string, { fingerprint: string; resources: ResourceRow[]; legacyResources?: ResourceRow[] }>()
function playerRows(context: Awaited<ReturnType<typeof loadTtrpgOpenPlayerContextV1>>, scope: FrozenResourceScopeV1, sourceKey: Exclude<SourceKey, 'ttrpgOpenGmOracleInput' | 'ttrpgOpenKpInput'>) {
  const { initialObservations, knowledge, rules, oracleHistory, sessionFacts, ...authority } = context.view
  return sourceKey === 'ttrpgOpenAuthority'
    ? [{ suffix: 'authority', title: '当前角色与权限', value: authority, mandatory: true },
      { suffix: 'rules-core', title: '角色规则目录与资源定义', value: rules.core, mandatory: true },
      ...rules.actions.map(action => ({ suffix: `action.${action.actionKey}`, title: action.name, value: action, mandatory: false })),
      ...(rules.interactions?.length ? [{ suffix: 'interactions',title: '当前角色的冻结无检定互动',value: rules.interactions,mandatory: true }] : []),
      ...rules.genericChecks.map(check => ({ suffix: `check.${check.checkKey}`, title: check.title, value: check, mandatory: false }))]
    : sourceKey === 'ttrpgOpenOracleHistory' ? [
      { suffix: 'oracle-contract', title: 'Oracle 已确认结果的边界', mandatory: true,
        value: { schema: 'storyforge.ttrpg-open-oracle-context', version: 1, actorKey: scope.runtimeActorKey,
          rawResultsAreFinal: true, interpretationsAreCandidates: true, resultsAreNotMechanicalOrWorldFacts: true,
          gmOnlyExcluded: true, seedAndPrivateRuleTablesExcluded: true } },
      ...oracleHistory.map((entry, index) => ({ suffix: `oracle.${index}`, title: entry.outcome.question, value: entry, mandatory: false })),
    ] : sourceKey === 'ttrpgOpenFacts' ? [
      { suffix: 'session-fact-contract', title: '会话叙事事实的权威边界', mandatory: true,
        value: { schema: 'storyforge.ttrpg-open-session-fact-context', version: 1, actorKey: scope.runtimeActorKey,
          onlyActiveAuthorizedFacts: true, mechanicalOwnersExcluded: true, playerDecisionsAndEvidenceGrantsExcluded: true,
          worldIsFrozen: true, gmOnlyAndOtherActorPrivateExcluded: true, oldPartyRecipientsDoNotExpand: true } },
      ...sessionFacts.map((fact, index) => ({ suffix: `session-fact.${index}`, title: fact.detail, value: fact, mandatory: false })),
    ] : [
      { suffix: 'knowledge-contract', title: '角色知识边界', mandatory: true,
        value: { schema: 'storyforge.ttrpg-open-knowledge-context', version: 1, actorKey: scope.runtimeActorKey,
          initialObservationsAreReleaseTime: true, onlyObservedGrantsPassEvidenceGates: true, otherActorSecretsExcluded: true } },
      ...initialObservations.map((observation, index) => ({ suffix: `initial.${index}`, title: `${observation.subjectRef} · ${observation.predicateKey}`, value: observation, mandatory: false })),
      ...knowledge.map((entry, index) => ({ suffix: `knowledge.${index}`, title: entry.title, value: entry, mandatory: false })),
    ]
}
async function catalog(scope: FrozenResourceScopeV1, sourceKey: SourceKey) {
  if (!scope.productRuntimeSessionId || !scope.worldId || !scope.workId || !scope.runtimeActorKey) throw new Error('[ttrpg-open-provider] 需要明确 instance、World/Work 与角色 POV')
  const workspace = await resolveScope({ scope: { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId } })
  const input = { scope: workspace, sessionId: scope.productRuntimeSessionId, actorKey: scope.runtimeActorKey }
  const kpContext = sourceKey === 'ttrpgOpenKpInput' ? await loadTtrpgOpenKpContextV1(input) : undefined
  const context = kpContext ?? ( sourceKey === 'ttrpgOpenGmOracleInput' ? await loadTtrpgOpenGmOracleContextV1(input) : await loadTtrpgOpenPlayerContextV1(input))
  const legacyRows = 'resources' in context ? context.resources : playerRows(context, scope, sourceKey as Exclude<SourceKey, 'ttrpgOpenGmOracleInput' | 'ttrpgOpenKpInput'>)
  const rows: RuntimeResourceRow[] = kpContext ? kpContext.modernResources : sourceKey === 'ttrpgOpenAuthority' && 'view' in context
    ? legacyRows.flatMap(row => row.suffix !== 'authority' ? [row] : [
      { ...row, suffix: 'authority.v3', value: Object.fromEntries(Object.entries(row.value as Record<string, unknown>).filter(([key]) => key !== 'pressureSignals')) },
      ...context.view.pressureSignals.map((value, index) => ({ suffix: `pressure.${index}`, title: `角色已知预警 · ${index}`, value, mandatory: false })),
    ]) : legacyRows
  const prefix = `fact:ttrpg-open:${context.readEvidence.sessionKey}:${scope.runtimeActorKey}`
  const fingerprint = await hashCanonicalValue({ scope, runtimeSourceHash: context.readEvidence.runtimeSourceHash,
    stateHash: context.readEvidence.stateHash, visibilityHash: context.visibilityHash })
  const cacheKey = `${sourceKey}:${fingerprint}`
  const cached = catalogCache.get(cacheKey)
  if (cached) return cached
  const oraclePolicy = 'oracleRuntimeReferencePolicy' in context ? context.oracleRuntimeReferencePolicy : undefined
  const normalizationPolicy = 'normalizationRuntimeReferencePolicy' in context ? context.normalizationRuntimeReferencePolicy : undefined
  const policyHash = await hashCanonicalValue({ sourceKey, actorKey: scope.runtimeActorKey, originalRead: false, fullIsAtomic: true,
    ...(oraclePolicy ? { oracleRuntimeReferencePolicy: oraclePolicy } : {}), ...(normalizationPolicy ? { normalizationRuntimeReferencePolicy: normalizationPolicy } : {}) })
  const materialize = (inputRows: typeof rows) => Promise.all(inputRows.map(async row => {
    const content = canonicalStringify(row.value), contentHash = await sha256Text(content), tokenCount = estimateTokens(content)
    const descriptor: ContextResourceDescriptorV1 = { version: 1, resourceKey: `${prefix}:${row.suffix}`, sourceKey,
      kind: 'fact', title: row.title, shortSummary: row.title, authority: 'confirmed-evidence',
      contentRevision: context.readEvidence.sequence, contentHash, policyRevision: oraclePolicy || normalizationPolicy ? 2 : 1, policyHash,
      scope: { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
        productRuntimeSessionId: scope.productRuntimeSessionId, runtimeActorKey: scope.runtimeActorKey }, relations: [],
      sourceRefs: [{ table: 'productRuntimeSessions', recordId: scope.productRuntimeSessionId!, field: 'runtimeHeadStateJson',
        revision: context.readEvidence.sequence, contentHash: context.readEvidence.stateHash }],
      tokenEstimate: { full: tokenCount }, availableDepths: ['full'], priority: row.mandatory ? 'must-read' : 'normal' }
    return { descriptor, content, tokenCount }
  }))
  const resources = await materialize(rows), legacyResources = rows === legacyRows ? [] : await materialize(legacyRows)
  const result = { fingerprint, resources, legacyResources }
  catalogCache.set(cacheKey, result)
  while (catalogCache.size > 4) catalogCache.delete(catalogCache.keys().next().value!)
  return result
}

function provider(sourceKey: SourceKey): ContextResourceProviderV1 {
  return createTtrpgOpenRuntimeResourceProviderV1({ sourceKey,
    providerVersion: sourceKey === 'ttrpgOpenAuthority' ? 'ttrpg-open-actor-provider-v3' : sourceKey === 'ttrpgOpenKpInput' ? 'ttrpg-open-kp-provider-v2' : 'ttrpg-open-actor-provider-v1',
    normalizationVersion: 'ttrpg-open-actor-json-v1', kinds: ['fact'], catalog: scope => catalog(scope, sourceKey) })
}
export const TTRPG_OPEN_AUTHORITY_PROVIDER_V1 = provider('ttrpgOpenAuthority')
export const TTRPG_OPEN_KNOWLEDGE_PROVIDER_V1 = provider('ttrpgOpenKnowledge')
export const TTRPG_OPEN_ORACLE_HISTORY_PROVIDER_V1 = provider('ttrpgOpenOracleHistory')
export const TTRPG_OPEN_FACTS_PROVIDER_V1 = provider('ttrpgOpenFacts')

export const TTRPG_OPEN_GM_ORACLE_INPUT_PROVIDER_V1 = provider('ttrpgOpenGmOracleInput')

export const TTRPG_OPEN_KP_INPUT_PROVIDER_V1 = provider('ttrpgOpenKpInput')
