import type { loadTtrpgOpenKpContextV1 } from './open-kp-context'
import type { loadTtrpgOpenBriefContextV1 } from './open-brief-context'
import type { loadTtrpgOpenGmOracleContextV1 } from './open-gm-oracle-context'
/** Formal P7 selection. This module plans metadata; only Context Gateway supplies model text. */
import type { WorkspaceScope } from '../types'
import type { ContextResourceDescriptorV1 } from '../registry/types'
import type { AgentSkillDefinitionV1 } from '../agent/skill-registry'
import { selectContextResourcesV1 } from '../context-gateway/selector'
import { createContextAccessPolicyForExecutionV1 } from '../context-gateway/skill-policy'
import { verifyProductRuntimeSessionSourceV1 } from '../product-production/preview-source'
import { assertInstanceBinding } from '../product/runtime-instances'
import { isTtrpgRuntimeContentV2 } from './content-version'
import { hashCanonicalValue, canonicalStringify } from '../agent/run/hash'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { estimateTokens } from '../ai/context-budget'
import { assembleTtrpgContextWithBudgetV1, type TtrpgContextTierKeyV1 } from './context-budget'
import { selectTtrpgContextInjectionsV1, matchesTtrpgContextTriggerV1, type TtrpgContextTriggerStateV1 } from './context-trigger'
import { evaluateTtrpgOpenContextPredicateV1, type TtrpgOpenContextPredicateViewV1 } from './open-context-predicate-view'
import type { TtrpgRuntimeStateV2 } from './open-runtime-contract'
import { ttrpgOpenContextConsumerForPurposeV1, TTRPG_OPEN_GUIDANCE_SOURCE_KEYS_V1, TTRPG_OPEN_LEARNED_IDENTITY_SOURCE_V1, TTRPG_OPEN_COMMON_IDENTITY_SOURCE_V1, type TtrpgOpenModelPurposeV1 } from './open-model-purpose-contract'
import type { loadTtrpgOpenPlayerContextV1 } from './open-player-context'
import type { loadTtrpgOpenModelContextV1 } from './open-model-purpose'
import { selectTtrpgOpenMemoryResourcesV1 } from './open-memory-selection'
import type { TtrpgOpenSourceRefV1 } from './open-coordination'
import { isTtrpgOpenOracleRuntimeGuidanceVisibleV1 } from './open-oracle-runtime-delivery'

interface TriggerHistoryReceiptV1 { schema: string; version: number; domainHash: string; receiptHash: string; worldTurn: number; matchedTriggerKeys: string[]; deliveredTriggerKeys: string[]; deliveredTriggers: Array<{ triggerKey: string; matchedBy: string }> }
function hasPartyPredicateFacts(context: Awaited<ReturnType<typeof loadTtrpgOpenModelContextV1>>): context is
  Awaited<ReturnType<typeof loadTtrpgOpenKpContextV1>> | Awaited<ReturnType<typeof loadTtrpgOpenBriefContextV1>> {
  return 'predicateFacts' in context
}
function hasActorKnowledge(context: Awaited<ReturnType<typeof loadTtrpgOpenModelContextV1>>): context is Awaited<ReturnType<typeof loadTtrpgOpenPlayerContextV1>> {
  return 'view' in context && 'self' in context.view && 'knowledge' in context.view
}
export type TtrpgOpenContextSelectionReceiptV1 = Awaited<ReturnType<typeof selectTtrpgOpenContextResourcesV1>>['receipt']
export async function selectTtrpgOpenContextResourcesV1(input: {
  scope: WorkspaceScope; sessionId: number; actorKey: string; purpose: TtrpgOpenModelPurposeV1
  skill: AgentSkillDefinitionV1; runtime: TtrpgRuntimeStateV2
  context: Awaited<ReturnType<typeof loadTtrpgOpenModelContextV1>>
  inventory: readonly ContextResourceDescriptorV1[]; rawInput: string; budgetTokens: number
  oracleSourceRef?: TtrpgOpenSourceRefV1
}) {
  const session = await assertInstanceBinding(input.sessionId, input.scope)
  const source = await verifyProductRuntimeSessionSourceV1({ scope: input.scope, session, ttrpgProtocol: 2 })
  const content = source.runtimePackage.ttrpg, run = input.runtime.openRun!, authorization = input.runtime.authorization!
  if (!content || !isTtrpgRuntimeContentV2(content) || source.runtimeSourceHash !== input.context.readEvidence.runtimeSourceHash) throw new Error('[ttrpg-context] 情境计划需要准确冻结 open 来源')
  const policy = content.campaign.contextPolicy, consumer = ttrpgOpenContextConsumerForPurposeV1(input.purpose)
  const entity = input.purpose === 'entity-proposal', commonOracle = input.purpose === 'common-oracle-interpret'
  const brief = input.purpose === 'stage-brief', situation = input.purpose === 'situation-proposal', publicSituation = input.purpose === 'public-situation-proposal', passive = brief || situation || publicSituation || entity || commonOracle
  const publicGrant = publicSituation ? run.coordination.epochs.find(e => e.epochKey === run.coordination.activeEpochKey)?.publicSituation : undefined
  const commonGrant = commonOracle ? run.coordination.epochs.find(e => e.epochKey === run.coordination.activeEpochKey)?.commonOracle : undefined
  if (publicSituation && !publicGrant) throw new Error('[ttrpg-public-situation] 情境计划需要本次原 Run 授权')
  if (commonOracle && !commonGrant) throw new Error('共同事实情境计划需要本次原 Run 授权')
  const guidanceKey = TTRPG_OPEN_GUIDANCE_SOURCE_KEYS_V1[consumer]
  const recipients = consumer === 'actor' ? [input.actorKey] : [...authorization.selectedActorKeys].sort()
  const oracle = input.oracleSourceRef ? run.oracleReceipts?.find(receipt => canonicalStringify(receipt.sourceRef) === canonicalStringify(input.oracleSourceRef)) : undefined
  const oracleRuntimeScope = consumer === 'gm-assistant' && 'oracleRuntimeReferencePolicy' in input.context ? input.context.oracleRuntimeReferencePolicy : undefined
  const normalizationScope = consumer === 'gm-assistant' && 'normalizationRuntimeReferencePolicy' in input.context ? input.context.normalizationRuntimeReferencePolicy : undefined
  const runtimeScope = normalizationScope ? { audience: normalizationScope.oraclePolicy.audience, recipientActorKeys: normalizationScope.recipientActorKeys } : oracleRuntimeScope
  const consultationAudience = consumer === 'gm-assistant' && !situation && !publicSituation && !entity ? normalizationScope?.oraclePolicy.audience ?? oracle?.audience : undefined
  if (consumer === 'gm-assistant' && !situation && !publicSituation && !entity && !consultationAudience) throw new Error('[ttrpg-context] GM 情境需要明确真实咨询密级')
  const policyHash = await hashCanonicalValue(policy ?? null)
  const domainHash = await hashCanonicalValue({ consumer, actorKey: input.actorKey, recipients, consultationAudience: consultationAudience ?? null,
    policyHash, runtimeSourceHash: source.runtimeSourceHash, ...(passive ? { purpose: input.purpose } : {}),
    ...(oracleRuntimeScope ? { oracleRuntimeScope: { oracleSourceRef: oracleRuntimeScope.oracleSourceRef, snapshotHash: oracleRuntimeScope.references.snapshotHash } } : {}),
    ...(normalizationScope ? { normalizationRuntimeScope: { oracleSourceRef: normalizationScope.oraclePolicy.oracleSourceRef, snapshotHash: normalizationScope.oraclePolicy.references.snapshotHash,
      recipientActorKeys: normalizationScope.recipientActorKeys, reviewSourceRef: normalizationScope.reviewSourceRef, reviewHash: normalizationScope.reviewHash } } : {}) })
  const states = new Map<string, TtrpgContextTriggerStateV1>()
  // Prepared/cancelled-unsent calls do not consume timing; dispatched unknown calls do.
  const calls = passive ? [] : [...(input.runtime.branchLineage?.ancestors.flatMap(ancestor => ancestor.snapshot.openRun?.coordination.calls ?? []) ?? []), ...run.coordination.calls]
  const seen = new Set<string>()
  for (const call of calls) {
    if (!call.dispatchRef || seen.has(call.requestHash)) continue
    seen.add(call.requestHash)
    const rendered = JSON.parse(await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'rendered-request', contentHash: call.requestHash })) as { contextSelection?: TriggerHistoryReceiptV1 }
    const history = rendered.contextSelection
    if (!history || history.domainHash !== domainHash) continue
    const { receiptHash, ...body } = history
    if (history.schema !== 'storyforge.ttrpg-open-context-selection' || history.version !== 1 || await hashCanonicalValue(body) !== receiptHash
      || !Number.isSafeInteger(history.worldTurn) || history.worldTurn > run.worldTime.worldTurn) throw new Error('[ttrpg-context] 原派发请求的情境回执损坏')
    for (const [triggerKey, previous] of states) if (!history.matchedTriggerKeys.includes(triggerKey)) {
      const { matchedWorldTurn: _matchedWorldTurn, ...rest } = previous; states.set(triggerKey, rest)
    }
    for (const triggerKey of history.matchedTriggerKeys) {
      const previous = states.get(triggerKey) ?? { triggerKey }
      states.set(triggerKey, { ...previous, matchedWorldTurn: Math.min(previous.matchedWorldTurn ?? history.worldTurn, history.worldTurn) })
    }
    for (const { triggerKey, matchedBy } of history.deliveredTriggers) {
      if (matchedBy === 'sticky') continue
      const previous = states.get(triggerKey) ?? { triggerKey }
      const { matchedWorldTurn: _matchedWorldTurn, ...rest } = previous
      states.set(triggerKey, { ...rest, lastTriggeredWorldTurn: Math.max(previous.lastTriggeredWorldTurn ?? 0, history.worldTurn) })
    }
  }
  const player = 'view' in input.context ? input.context.view : undefined
  const kp = consumer === 'party-narrator' && hasPartyPredicateFacts(input.context) ? input.context : undefined
  const gm = consumer === 'gm-assistant' && !situation && !publicSituation && !entity && !commonOracle ? input.context as Awaited<ReturnType<typeof loadTtrpgOpenGmOracleContextV1>> : undefined
  const oraclePacket = gm?.resources.map(row => row.value).find(value => value && typeof value === 'object' && 'schema' in value
    && value.schema === 'storyforge.ttrpg-open-gm-oracle-input' && 'sourceRef' in value && canonicalStringify(value.sourceRef) === canonicalStringify(input.oracleSourceRef)) as Record<string, unknown> | undefined
  const projection: TtrpgOpenContextPredicateViewV1 = { worldTurn: run.worldTime.worldTurn, player,
    worldFacts: player?.initialObservations ?? kp?.predicateFacts.worldFacts ?? [],
    sessionFacts: player?.sessionFacts ?? kp?.predicateFacts.sessionFacts ?? [] }
  if (oraclePacket) {
    projection.worldFacts = oraclePacket.permittedFrozenFacts as TtrpgOpenContextPredicateViewV1['worldFacts']
    projection.sessionFacts = oraclePacket.permittedSessionFacts as TtrpgOpenContextPredicateViewV1['sessionFacts']
  }
  const rank = { public: 0, party: 1, private: 2, 'gm-only': 3 }
  const triggers = (passive ? [] : policy?.triggers ?? []).filter(row => row.consumers.includes(consumer)).map(row => row.trigger).filter(trigger => {
    const audienceAllowed = runtimeScope ? isTtrpgOpenOracleRuntimeGuidanceVisibleV1(runtimeScope, trigger.audience, trigger.knownByActorKeys) : trigger.audience === 'public' || trigger.audience === 'party'
      || consumer === 'gm-assistant' && trigger.audience === 'gm-only'
      || trigger.audience === 'private' && (consumer === 'gm-assistant' ? trigger.knownByActorKeys.includes('gm') : recipients.every(key => trigger.knownByActorKeys.includes(key)))
    return audienceAllowed && (!consultationAudience || rank[trigger.audience] <= rank[consultationAudience])
      && (trigger.predicate === null || evaluateTtrpgOpenContextPredicateV1(trigger.predicate, projection) !== undefined)
  })
  const selectionInput = { worldTurn: run.worldTime.worldTurn, text: input.rawInput, audience: 'gm-only' as const, triggerStates: [...states.values()],
    evaluatePredicate: (predicate: NonNullable<typeof triggers[number]['predicate']>) => evaluateTtrpgOpenContextPredicateV1(predicate, projection) === true }
  const matchedTriggerKeys = triggers.filter(trigger => matchesTtrpgContextTriggerV1(trigger, selectionInput)).map(trigger => trigger.triggerKey).sort()
  const injections = selectTtrpgContextInjectionsV1({ ...selectionInput, triggers })
  const triggered = new Map<string, typeof injections[number]>(await Promise.all(injections.map(async injection => [`trigger.${await hashCanonicalValue(injection.triggerKey)}`, injection] as const)))
  // A clue can be seen firsthand and later reported again. New actor reads keep one original best grade;
  // different evidence identities with the same title remain subject to the Gateway conflict guard.
  const known = new Map<string, { index: number; rank: number }>()
  const identityGeneration = consumer === 'actor' && input.skill.contextSourceKeys.some(key => key === TTRPG_OPEN_LEARNED_IDENTITY_SOURCE_V1)
  if (identityGeneration) {
    if (!hasActorKnowledge(input.context)) throw new Error('[ttrpg-context] 身份代际需要准确本人知识投影')
    const rank = { observed: 3, hearsay: 2, belief: 1 }
    input.context.view.knowledge.forEach((row, index) => {
      const previous = known.get(row.evidenceRef)
      if (!previous || rank[row.reliability] > previous.rank) known.set(row.evidenceRef, { index, rank: rank[row.reliability] })
    })
  }
  const selectedKnowledge = new Set([...known.values()].map(row => row.index))
  const eligible = input.inventory.filter(row => (!identityGeneration || row.sourceKey !== 'ttrpgOpenKnowledge' || !/:knowledge\.(?:v2\.)?(0|[1-9]\d*)$/.test(row.resourceKey)
    || selectedKnowledge.has(Number(row.resourceKey.slice(row.resourceKey.lastIndexOf('.') + 1)))))
    .filter(row => row.sourceKey !== guidanceKey || !row.resourceKey.includes(':trigger.') || triggered.has(row.resourceKey.slice(row.resourceKey.lastIndexOf(':') + 1)))
  const ruleRows = eligible.filter(row => row.sourceKey === 'ttrpgOpenAuthority' && /:(action|check)\./.test(row.resourceKey))
  const scope = { ...input.scope, productRuntimeSessionId: input.sessionId, runtimeActorKey: input.actorKey }
  const rules = ruleRows.length ? await selectContextResourcesV1({ taskKind: input.skill.contextTaskKind,
    accessPolicy: createContextAccessPolicyForExecutionV1(input.skill), scope, descriptors: ruleRows, query: input.rawInput,
    budgetTokens: Math.max(1, Math.floor(Math.min(input.budgetTokens, policy?.maximumContextTokens ?? 16000) / 4)), readsAllowed: false }) : undefined
  const selectedRules = new Set(rules?.selected.map(row => row.resourceKey))
  const memoryRows = eligible.filter(row => ['ttrpgOpenMemory', 'ttrpgOpenPartyMemory'].includes(row.sourceKey) && row.priority !== 'must-read')
  const memoryKeys = await selectTtrpgOpenMemoryResourcesV1({ ...input, scope, rows: memoryRows,
    budgetTokens: Math.min(8000, Math.max(1, Math.floor(Math.min(input.budgetTokens, policy?.maximumContextTokens ?? 16000) / 4))) })
  const briefRows = passive ? eligible.filter(row => row.sourceKey === (publicSituation ? 'ttrpgOpenPublicSituationInput' : situation ? 'ttrpgOpenSituationInput' : 'ttrpgOpenBriefInput') && row.priority !== 'must-read') : []
  const briefKeys = await selectTtrpgOpenMemoryResourcesV1({ ...input, scope, rows: briefRows,
    budgetTokens: Math.max(1, Math.floor(Math.min(input.budgetTokens, policy?.maximumContextTokens ?? 16000) / 2)) })
  const namedIdentity = (row: ContextResourceDescriptorV1) => [TTRPG_OPEN_LEARNED_IDENTITY_SOURCE_V1, TTRPG_OPEN_COMMON_IDENTITY_SOURCE_V1].some(key => row.sourceKey === key)
    && /:(learned-identity|common-identity)\./.test(row.resourceKey) && input.rawInput.includes(row.title.normalize('NFC'))
  const candidates = eligible.filter(row => (!ruleRows.includes(row) || selectedRules.has(row.resourceKey))
    && (!memoryRows.includes(row) || memoryKeys.has(row.resourceKey))
    && (!briefRows.includes(row) || briefKeys.has(row.resourceKey))).sort((a, b) => Number(namedIdentity(b)) - Number(namedIdentity(a)) || (a.resourceKey < b.resourceKey ? -1 : a.resourceKey > b.resourceKey ? 1 : 0))
  const tierFor = (row: ContextResourceDescriptorV1): TtrpgContextTierKeyV1 => {
    if (row.priority === 'must-read') return /:rules-core$/.test(row.resourceKey) ? 'rules' : 'authority-state'
    if (row.sourceKey === 'ttrpgOpenAuthority' && /:(action|check)\./.test(row.resourceKey)) return 'rules'
    if (['ttrpgOpenMemory', 'ttrpgOpenPartyMemory'].includes(row.sourceKey)) return 'memory-summary'
    if (row.resourceKey.includes(':trigger.')) return 'dynamic-injection'
    if (row.resourceKey.includes(':recent.')) return 'recent-events'
    if (row.resourceKey.includes(':pressure.') || row.resourceKey.includes(':kp-entry.signal.')) return 'active-situations'
    return 'known-facts'
  }
  const blocks = candidates.map(row => ({ tierKey: tierFor(row), sourceKey: row.sourceKey, blockKey: row.resourceKey, content: row.resourceKey,
    tokens: row.tokenEstimate.full! + estimateTokens(`【${row.kind}｜${row.title}｜full】\n`) + 2, required: row.priority === 'must-read' || namedIdentity(row) }))
  const budgetTokens = Math.min(input.budgetTokens, policy?.maximumContextTokens ?? 16000)
  const tokens = assembleTtrpgContextWithBudgetV1({ blocks, budgetTokens })
  const count = assembleTtrpgContextWithBudgetV1({ blocks: blocks.filter(block => tokens.segments.some(segment => segment.blockKey === block.blockKey)).map(block => ({ ...block, tokens: 1 })),
    budgetTokens: input.skill.contextGateway!.maxReadCalls })
  const selectedKeys = new Set(count.segments.map(segment => segment.blockKey))
  const resources = candidates.filter(row => selectedKeys.has(row.resourceKey))
  // Guidance dependencies are factual read requirements, never extra grants.
  const readSources = new Set(resources.map(row => row.sourceKey))
  const deliveredTriggerKeys = [...triggered.entries()].filter(([suffix, injection]) => resources.some(row => row.resourceKey.endsWith(`:${suffix}`))
    && injection.sourceRefs.every(key => readSources.has(key))).map(([, injection]) => injection.triggerKey).sort()
  const finalResources = resources.filter(row => !row.resourceKey.includes(':trigger.') || deliveredTriggerKeys.includes(triggered.get(row.resourceKey.slice(row.resourceKey.lastIndexOf(':') + 1))!.triggerKey))
  const body = { schema: 'storyforge.ttrpg-open-context-selection' as const, version: 1 as const, consumer, domainHash, policyHash,
    worldTurn: run.worldTime.worldTurn, baseSequence: commonGrant?.basis.readEvidence.sequence ?? publicGrant?.basis.readEvidence.sequence ?? input.context.readEvidence.sequence,
    baseStateHash: commonGrant?.basis.readEvidence.stateHash ?? publicGrant?.basis.readEvidence.stateHash ?? input.context.readEvidence.stateHash,
    budgetTokens, tokenBudget: tokens.receipt, resourceCountBudget: count.receipt, matchedTriggerKeys, deliveredTriggerKeys,
    deliveredTriggers: injections.filter(injection => deliveredTriggerKeys.includes(injection.triggerKey)).map(({ triggerKey, matchedBy }) => ({ triggerKey, matchedBy })),
    selected: finalResources.map(row => ({ resourceKey: row.resourceKey, sourceKey: row.sourceKey, contentHash: row.contentHash, tierKey: tierFor(row), tokens: row.tokenEstimate.full! })) }
  return { resources: finalResources, receipt: { ...body, receiptHash: await hashCanonicalValue(body) } }
}
