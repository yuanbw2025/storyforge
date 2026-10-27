import { assertTtrpgOpenKnowledgeSourceCompatibleV1 } from './open-release-compatibility'
import { verifyTtrpgOpenReleaseContinuationRuntimeV1 } from './open-release-continuation-proof'
import { verifyTtrpgOpenCommonOracleEpochsV1 } from './open-common-oracle-request'
import { ttrpgOpenEntityIdentityCatalogV1, ttrpgOpenEntityReferenceVisibleV1 } from './open-entity-catalog'
import { verifyTtrpgOpenEntityStateV1 } from './open-entity-proof'
import { verifyTtrpgOpenIdentityKnowledgeV1 } from './open-identity-knowledge-proof'
import { ttrpgOpenSituationCatalogV1 } from './open-session-situation-catalog'
import { verifyTtrpgOpenSessionSituationHashesV1 } from './open-session-situation-proof'
import { verifyTtrpgOpenManualEpochsV1 } from './open-manual-action'
import { verifyTtrpgOpenPrivateChoiceHashesV1 } from './open-private-choice'
import { TtrpgOpenReadConflictV1 } from './open-read-conflict'
import { verifyTtrpgOpenOracleReviewHashesV1 } from './open-oracle-review'
/** Actor-only read model. Raw responses, GM plans and other characters' private fields stay outside it. */
import type { WorkspaceScope } from '../types'
import { assertInstanceBinding } from '../product/runtime-instances'
import { verifyProductRuntimeSessionSourceV1 } from '../product-production/preview-source'
import { readProductRuntimeState, readProductRuntimeStateVersion, hashProductRuntimeStateV1, readSessionEvents } from '../product/runtime-core'
import { isTtrpgRuntimeContentV2 } from './content-version'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { readTtrpgSessionParticipantsV2 } from './participants'
import { assertTtrpgOpenAuthorizationRowsCurrentV1 } from './open-authorization'
import { projectTtrpgOpenKnowledgeForViewerV1, hashTtrpgOpenEvidenceFieldsV1 } from './open-knowledge'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { ttrpgOpenMechanicalStateHashV1, ttrpgOpenPredicateContextV1 } from './open-rule-plan'
import { projectTtrpgRulePackMechanicalCoreV1 } from './rule-pack-v2'
import { verifyTtrpgOpenOracleJournalV1 } from './open-oracle-contract'
import { verifyTtrpgOpenFactLedger, projectTtrpgOpenSessionFactsForActorV1 } from './open-fact-ledger'
import { ttrpgOpenKnowledgeDiscoveryOriginV1 } from './open-knowledge-share'
import { evaluateTtrpgPredicateV1 } from './predicate'
import { canonicalStringify } from '../agent/run/hash'

type OpenPlayerReadV1 = { scope: WorkspaceScope; sessionId: number; actorKey: string }
export async function loadTtrpgOpenPlayerContextV1(input: OpenPlayerReadV1) { return loadOpenPlayerProjectionV1(input) }
/** Human display does not grant a model permission to read the actor. */
export async function loadTtrpgOpenHumanViewV1(input: OpenPlayerReadV1 & { viewerKey: string }) {
  return loadOpenPlayerProjectionV1(input, input.viewerKey)
}
/** Common-view narration sees no self profile, sheet, inventory or private goals. */
export async function loadTtrpgOpenPartyProjectionV1(input: OpenPlayerReadV1) {
  return partyProjection(await loadOpenPlayerProjectionV1(input, undefined, true))
}
function partyProjection(loaded: Awaited<ReturnType<typeof loadOpenPlayerProjectionV1>>) {
  const { actorsHere, initialObservations, knowledge, sessionFacts, pressureSignals } = loaded.view
  return { view: { actorsHere, initialObservations, knowledge, sessionFacts, pressureSignals }, readEvidence: loaded.readEvidence }
}
async function loadPartyProjectionBatchV1(input: { scope: WorkspaceScope; sessionId: number }) {
  const basis = await loadOpenPlayerProjectionBasisV1(input)
  return Promise.all([...basis.authorization.selectedActorKeys].sort().map(actorKey => projectOpenPlayerProjectionV1({ ...input, actorKey }, basis, undefined, true)))
}
/** No caller-selected subset: common means every currently authorized player, including AI seats.
 * Private per-actor views never escape this function. Shared rule definitions confer no grants. */
export async function loadTtrpgOpenCommonProjectionV1(input: { scope: WorkspaceScope; sessionId: number }) {
  const { oracleHistory: _oracleHistory, ...common } = await loadCommonProjection(input)
  return common
}
/** Legacy KP narration keeps its original per-seat AI consent; memory/identity consumers enforce logging separately. */
export async function loadTtrpgOpenKpPartyProjectionV1(input: { scope: WorkspaceScope; sessionId: number }) {
  const { oracleHistory: _oracleHistory, ...common } = await loadCommonProjection(input, false)
  return common
}
/** Separate Oracle consumer; existing common situation and recap bytes stay unchanged. */
export async function loadTtrpgOpenCommonOracleProjectionV1(input: { scope: WorkspaceScope; sessionId: number }) {
  return loadCommonProjection(input)
}
async function loadCommonProjection(input: { scope: WorkspaceScope; sessionId: number }, requireLogging = true) {
  const session = await assertInstanceBinding(input.sessionId, input.scope)
  if (session.kind !== 'ttrpg') throw new Error('[ttrpg-common-context] 当前实例不是跑团')
  const state = await readProductRuntimeState(input.sessionId), runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  if (!runtime?.authorization || !runtime.openRun || runtime.product.safety.status !== 'active') throw new Error('[ttrpg-common-context] 缺少当前有效的共同读取授权')
  const participants = await readTtrpgSessionParticipantsV2(input.sessionId)
  const authorization = assertTtrpgOpenAuthorizationRowsCurrentV1({ authorization: runtime.authorization, participants })
  if (requireLogging && authorization.seats.some(seat => !seat.consent.sessionLoggingAllowed)) throw new Error('[ttrpg-common-context] 共同读取缺少本桌记录同意')
  const recipientActorKeys = [...authorization.selectedActorKeys].sort()
  if (!recipientActorKeys.length) throw new Error('[ttrpg-common-context] 没有实际共同接收者')
  const views = await loadPartyProjectionBatchV1(input)
  const stateHash = await hashProductRuntimeStateV1(state), readEvidence = views[0].readEvidence
  if (views.some(view => view.readEvidence.sequence !== state.lastSequence || view.readEvidence.stateHash !== stateHash
    || view.readEvidence.runtimeSourceHash !== session.runtimeSourceHash || view.readEvidence.sessionKey !== runtime.sessionKey)) {
    throw new TtrpgOpenReadConflictV1('读取共同资料期间团局或接收者已经变化')
  }
  const first = views[0].view
  const common = <T>(values: readonly T[], pick: (view: typeof first) => readonly T[]) => {
    const sets = views.map(view => new Set(pick(view.view).map(canonicalStringify)))
    return values.filter(value => sets.every(set => set.has(canonicalStringify(value))))
  }
  const view = {
    actorsHere: common(first.actorsHere, v => v.actorsHere),
    initialObservations: common(first.initialObservations, v => v.initialObservations),
    knowledge: common(first.knowledge, v => v.knowledge),
    sessionFacts: common(first.sessionFacts, v => v.sessionFacts),
    pressureSignals: common(first.pressureSignals, v => v.pressureSignals),
    rules: { core: { rulePackContentHash: first.rules.core.rulePackContentHash,
      attributes: first.rules.core.attributes, resources: first.rules.core.resources, diceModels: first.rules.core.diceModels },
      actions: common(first.rules.actions, v => v.rules.actions), genericChecks: common(first.rules.genericChecks, v => v.rules.genericChecks) },
  }
  const after = await readProductRuntimeStateVersion(input.sessionId)
  if (after.sequence !== readEvidence.sequence || after.stateHash !== readEvidence.stateHash) throw new TtrpgOpenReadConflictV1('读取共同资料期间运行状态已变化')
  assertTtrpgOpenAuthorizationRowsCurrentV1({ authorization, participants: await readTtrpgSessionParticipantsV2(input.sessionId) })
  return { view, oracleHistory: common(first.oracleHistory, v => v.oracleHistory), recipientActorKeys, authorizationRevision: authorization.revision, readEvidence }
}
async function loadOpenPlayerProjectionV1(input: OpenPlayerReadV1, humanViewerKey?: string, partyNarration = false) {
  return projectOpenPlayerProjectionV1(input, await loadOpenPlayerProjectionBasisV1(input), humanViewerKey, partyNarration)
}
async function loadOpenPlayerProjectionBasisV1(input: { scope: WorkspaceScope; sessionId: number }) {
  const session = await assertInstanceBinding(input.sessionId, input.scope)
  if (session.kind !== 'ttrpg') throw new Error('[ttrpg-open-context] Instance 不是跑团')
  const source = await verifyProductRuntimeSessionSourceV1({ scope: input.scope, session, ttrpgProtocol: 2 })
  if (source.runtimeSourceHash !== session.runtimeSourceHash) throw new Error('[ttrpg-open-context] Instance 来源身份不一致')
  const content = source.runtimePackage.ttrpg
  if (!content || !isTtrpgRuntimeContentV2(content)) throw new Error('[ttrpg-open-context] 新角色读取器仅用于 open')
  const state = await readProductRuntimeState(input.sessionId)
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  if (!runtime?.authorization || !runtime.openRun || runtime.product.rulePackContentHash !== content.rulePack.contentHash
    || runtime.product.campaignKey !== content.campaign.campaignKey) throw new Error('[ttrpg-open-context] 团局没有有效冻结来源与授权')
  await verifyTtrpgOpenReleaseContinuationRuntimeV1({ runtime, runtimeSourceHash: session.runtimeSourceHash, seed: session.seed, initialState: JSON.parse(session.initialStateJson) })
  const participants = await readTtrpgSessionParticipantsV2(input.sessionId)
  await verifyTtrpgOpenSessionSituationHashesV1(runtime.openRun.situationReceipts ?? [])
  await verifyTtrpgOpenEntityStateV1(state, content)
  if (runtime.openRun.knowledge.some(row => row.identityGrant)) await verifyTtrpgOpenIdentityKnowledgeV1({ runtime, runtimeSourceHash: source.runtimeSourceHash, events: await readSessionEvents(session) })
  await verifyTtrpgOpenPrivateChoiceHashesV1(runtime.openRun.operations)
  await verifyTtrpgOpenManualEpochsV1(runtime.openRun.coordination.epochs)
  await verifyTtrpgOpenCommonOracleEpochsV1(runtime.openRun.coordination.epochs)
  await verifyTtrpgOpenOracleJournalV1({ receipts: runtime.openRun.oracleReceipts ?? [], rulePack: content.rulePack.content,
    sessionKey: runtime.sessionKey, seed: session.seed, ancestors: runtime.branchLineage?.ancestors ?? [] })
  await verifyTtrpgOpenOracleReviewHashesV1(runtime.openRun.oracleReviews ?? [])
  await verifyTtrpgOpenFactLedger({ ledger: runtime.openRun.factLedger, content, runtimeSourceHash: session.runtimeSourceHash,
    oracleReceipts: runtime.openRun.oracleReceipts ?? [], entityOperations: runtime.openRun.entityOperations, storyFacts: runtime.product.effectLedger.storyFacts })
  const frozenContentHash = runtime.openRun.knowledge.length ? await hashProductProductionValueV2(content) : null
  for (const knowledge of runtime.openRun.knowledge) {
    const origin = ttrpgOpenKnowledgeDiscoveryOriginV1(runtime, knowledge)
    await assertTtrpgOpenKnowledgeSourceCompatibleV1(runtime, origin, content, frozenContentHash ?? undefined)
  }
  const authorization = assertTtrpgOpenAuthorizationRowsCurrentV1({ authorization: runtime.authorization, participants })
  const admissionStateHash = await ttrpgOpenMechanicalStateHashV1(state), stateHash = await hashProductRuntimeStateV1(state)
  return { session, source, content, state, runtime, authorization, admissionStateHash, stateHash }
}
async function projectOpenPlayerProjectionV1(input: OpenPlayerReadV1, basis: Awaited<ReturnType<typeof loadOpenPlayerProjectionBasisV1>>, humanViewerKey?: string, partyNarration = false) {
  const { session, content, state, runtime, authorization, admissionStateHash, stateHash } = basis
  if (!runtime.openRun) throw new Error('[ttrpg-open-context] 读取基础缺少有效运行态')
  const seat = authorization.seats.find(seat => seat.role === 'player' && seat.actorKey === input.actorKey)
  const actor = state.entities[input.actorKey]
  const template = content.campaign.characterTemplates.find(template => template.characterKey === input.actorKey)
  if (!seat || !actor || !template || !authorization.selectedActorKeys.includes(input.actorKey)) throw new Error('[ttrpg-open-context] 角色不是已确认活动玩家')
  if (humanViewerKey !== undefined) {
    if (seat.viewerKey !== humanViewerKey || seat.controller === 'ai' || seat.assignmentState !== 'claimed') throw new Error('[ttrpg-open-context] 只能读取本人已认领的真人角色')
  } else if (partyNarration) {
    if (!seat.consent.aiIdentityDisclosed || !seat.consent.safetyBoundariesAccepted || !content.campaign.runtimePolicy.enabled) throw new Error('[ttrpg-open-context] 共同叙述未获本桌 AI 主持授权')
  } else if (!seat.consent.aiAdviceAllowed) throw new Error('[ttrpg-open-context] 该角色未授权 AI 读取与建议')
  const visible = (audience: string, knownBy: readonly string[]) => audience === 'public' || audience === 'party'
    || (audience === 'private' && knownBy.includes(input.actorKey))
  const entityCatalog = ttrpgOpenEntityIdentityCatalogV1(content, runtime.openRun.entityOperations ?? [])
  const visibleRef = (ref: string | null) => {
    if (ref === null || ref === input.actorKey) return true
    const binding = entityCatalog.find(binding => binding.entityKey === ref)
    return binding === undefined || ttrpgOpenEntityReferenceVisibleV1(binding.audience, binding.recipientActorKeys, input.actorKey, false, binding.dynamic)
  }
  const knowledge = projectTtrpgOpenKnowledgeForViewerV1({ entries: runtime.openRun.knowledge, authorization,
    viewerKey: seat.viewerKey, campaign: ttrpgOpenSituationCatalogV1(content.campaign, runtime.openRun).validationView })
  const fieldHashes = new Map<string, string>()
  for (const entry of runtime.openRun.knowledge.filter(entry => entry.audience !== 'gm-only'
    && (entry.audience === 'public' || entry.recipientActorKeys.includes(input.actorKey)))) {
    let hash = fieldHashes.get(entry.evidenceRef)
    if (!hash) { hash = await hashTtrpgOpenEvidenceFieldsV1(ttrpgOpenSituationCatalogV1(content.campaign, runtime.openRun).validationView, entry.evidenceRef); fieldHashes.set(entry.evidenceRef, hash) }
    if (hash !== entry.publicFieldsHash) throw new Error('[ttrpg-open-context] 已知字段与冻结知识回执 hash 不一致')
  }
  const mechanicalRules = projectTtrpgRulePackMechanicalCoreV1(content.rulePack.content)
  const ownedItems = Object.values(runtime.product.inventory.items).filter(item => item.ownerRef === input.actorKey && item.quantity > 0)
  const grantedActions = new Set([...template.actionKeys, ...ownedItems.filter(item => !item.stateTags.includes('broken'))
    .flatMap(item => mechanicalRules.items.find(definition => definition.key === item.definitionRef)?.grantedActionKeys ?? [])])
  const availableActions = new Set(ttrpgOpenPredicateContextV1(state, content).actors![input.actorKey].abilityKeys)
  const actionDefinitions = mechanicalRules.actions.filter(action => grantedActions.has(action.key))
  const genericChecks = content.rulePack.content.genericChecks.filter(check => ['public', 'party', `actor:${input.actorKey}`].includes(check.audience))
  const interactionBindings = content.rulePack.content.interactionBindings?.filter(binding => grantedActions.has(binding.actionKey))
    .map(binding => ({ interactionKey: binding.interactionKey,kind: binding.kind,title: binding.title,actionKey: binding.actionKey,
      timeCostWorldTurns: binding.timeCostWorldTurns,requiresEffectReview: binding.effectPlanRef !== null,
      available: availableActions.has(binding.actionKey) && (binding.kind !== 'retreat' || seat.controller === 'human' || seat.controller === 'hybrid')
        && binding.preconditions.every(predicate => evaluateTtrpgPredicateV1(predicate,ttrpgOpenPredicateContextV1(state,content))) }))
  const view = {
    schema: 'storyforge.ttrpg-open-player-context', version: 1,
    source: { campaignKey: content.campaign.campaignKey, rulePackContentHash: content.rulePack.contentHash,
      worldReleaseHash: content.campaign.sourceWorld.contentHash },
    authority: { actorKey: input.actorKey, controller: seat.controller, authorizationRevision: authorization.revision,
      safetyStatus: runtime.product.safety.status, stageStatus: runtime.openRun.stage.status, worldTurn: runtime.openRun.worldTime.worldTurn },
    self: { name: actor.name, locationKey: actor.locationKey,
      attributes: Object.fromEntries(Object.entries(actor.attributes).filter(([, value]) => typeof value === 'number')),
      conditions: structuredClone(runtime.product.conditions[input.actorKey] ?? []),
      playerProfile: structuredClone(template.playerProfile),
      characterSheet: structuredClone(runtime.product.characterCustomizations.find(row => row.characterKey === input.actorKey)?.characterSheet ?? template.characterSheet),
      abilityStates: Object.values(runtime.product.abilityStates).filter(ability => ability.actorInstanceId === input.actorKey).map(ability => structuredClone(ability)),
      inventory: Object.values(runtime.product.inventory.items).filter(item => item.ownerRef === input.actorKey).map(item => ({
        itemInstanceId: item.itemInstanceId, definitionRef: item.definitionRef, quantity: item.quantity, charges: item.charges,
        durability: item.durability, identification: item.identification, stateTags: [...item.stateTags] })) },
    // Initial observations remain labeled as release-time knowledge; do not replace them with hidden live NPC state.
    initialObservations: content.campaign.frozenWorldPredicateIndex.entries.filter(fact => visible(fact.audience, fact.knownByActorKeys)
      && visibleRef(fact.subjectRef) && visibleRef(fact.objectRef)
      && (!['located-at', 'owns'].includes(fact.predicateKey) || typeof fact.canonicalValue !== 'string' || visibleRef(fact.canonicalValue))).map(fact => ({
      subjectRef: fact.subjectRef, predicateKey: fact.predicateKey, objectRef: fact.objectRef, canonicalValue: fact.canonicalValue,
      authority: fact.authority, asOf: 'release' })),
    actorsHere: entityCatalog.filter(binding => binding.kind === 'actor'
      && (binding.entityKey === input.actorKey || ttrpgOpenEntityReferenceVisibleV1(binding.audience, binding.recipientActorKeys, input.actorKey, false, binding.dynamic))
      && state.entities[binding.entityKey]?.locationKey === actor.locationKey).map(binding => ({
        actorKey: binding.entityKey, name: state.entities[binding.entityKey].name, role: state.entities[binding.entityKey].kind })),
    pressureSignals: [
      ...(runtime.openRun.pressureSignals ?? []).filter(signal => signal.audience === 'public' || signal.recipientActorKeys.includes(input.actorKey)).map(signal => ({
        sourceRef: structuredClone(signal.sourceRef), signalText: signal.signalText, atWorldTurn: signal.worldTurn, audience: signal.audience })),
      ...(runtime.openRun.pressureCycles ?? []).flatMap(cycle => cycle.frontReceipts.filter(receipt => receipt.kind === 'telegraph'
        && (receipt.audience === 'public' || receipt.recipientActorKeys.includes(input.actorKey))).map(receipt => ({
        sourceRef: structuredClone(receipt.sourceRef), signalText: cycle.frozenContent.campaign.fronts.find(f => f.frontKey === receipt.frontKey)!.telegraph.find(t => t.telegraphKey === receipt.definitionKey)!.signalText,
        atWorldTurn: receipt.atWorldTurn, audience: receipt.audience }))),
    ],
    knowledge,
    sessionFacts: projectTtrpgOpenSessionFactsForActorV1(runtime.openRun.factLedger, input.actorKey)
      .filter(fact => visibleRef(fact.subjectRef) && visibleRef(fact.objectRef)),
    oracleHistory: (runtime.openRun.oracleReceipts ?? []).filter(receipt => receipt.audience === 'public'
      || (receipt.audience === 'party' && (receipt.sourceRef.sessionKey === runtime.sessionKey ? authorization
        : runtime.branchLineage?.ancestors.find(ancestor => ancestor.sessionKey === receipt.sourceRef.sessionKey)?.snapshot.authorization)
        ?.selectedActorKeys.includes(input.actorKey))).map(receipt => ({
      sourceRef: structuredClone(receipt.sourceRef), previousOracleRef: structuredClone(receipt.previousOracleRef),
      worldTurn: receipt.worldTurn, audience: receipt.audience, outcome: structuredClone(receipt.resolution.outcome),
      // Dice proof and seed material are not necessary for the actor's knowledge projection.
    })),
    rules: {
      // Only the acting player's grants and explicitly visible checks. No GM outcome templates or hidden predicates.
      core: { rulePackContentHash: content.rulePack.contentHash, attributes: mechanicalRules.attributes,
        resources: mechanicalRules.resources, diceModels: mechanicalRules.diceModels,
        actionCatalog: actionDefinitions.map(action => ({ actionKey: action.key, name: action.name, target: action.target,
          available: availableActions.has(action.key) })),
        genericCheckCatalog: genericChecks.map(check => ({ checkKey: check.checkKey, title: check.title, targetKinds: check.targetKinds })) },
      ...(interactionBindings ? { interactions: interactionBindings } : {}),
      actions: actionDefinitions.map(action => ({ actionKey: action.key, name: action.name, description: action.description,
        target: action.target, costResourceKey: action.costResourceKey, costAmount: action.costAmount, usage: action.usage,
        timeCostWorldTurns: content.rulePack.content.timePolicy.actionOverrides.find(override => override.actionKey === action.key)?.timeCostWorldTurns
          ?? content.rulePack.content.timePolicy.existingAction })),
      genericChecks: genericChecks.map(check => ({ checkKey: check.checkKey, title: check.title, targetKinds: check.targetKinds,
        actorAttributeKey: check.actorAttributeKey, diceModelKey: check.diceModelKey, difficulty: check.difficulty,
        resourceCosts: check.resourceCosts, timeCostWorldTurns: check.timeCostWorldTurns })),
    },
  }
  const visibilityHash = await hashProductProductionValueV2(view)
  const after = await readProductRuntimeStateVersion(input.sessionId)
  if (after.sequence !== state.lastSequence || after.stateHash !== stateHash) throw new TtrpgOpenReadConflictV1('[ttrpg-open-context] 读取期间运行状态已变化')
  assertTtrpgOpenAuthorizationRowsCurrentV1({ authorization, participants: await readTtrpgSessionParticipantsV2(input.sessionId) })
  return { view, visibilityHash, admissionStateHash, readEvidence: { sequence: state.lastSequence, stateHash,
    runtimeSourceHash: session.runtimeSourceHash, sessionKey: runtime.sessionKey } }
}
