import { planTtrpgOpenSituationReferenceNeedsV1 } from './open-generated-situation-delivery'
/** GM-model-only drafting input. Never expose this projection through the human fallback desk. */
import type { WorkspaceScope } from '../types'
import type { ContextResourceDescriptorV1, FrozenResourceScopeV1 } from '../registry/types'
import { resolveScope } from '../workspace/scope'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { estimateTokens } from '../ai/context-budget'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { assertTtrpgOpenHumanHostV1 } from './open-authorization'
import { assertTtrpgOpenEpochAuthorityV1 } from './open-coordination'
import { buildTtrpgOpenSituationBasisFromVerifiedReadV1 } from './open-generated-situation-basis'
import { TTRPG_OPEN_SITUATION_INPUT_SOURCE_V1 } from './open-generated-situation-contract'
import { createTtrpgOpenRuntimeResourceProviderV1, type TtrpgOpenResourceRowV1 } from './open-runtime-resource-provider'
import { TTRPG_SITUATION_GENERATION_HOMOGENEITY_THRESHOLD_V1, TTRPG_SITUATION_GENERATION_HISTORY_LIMIT_V1, TTRPG_SITUATION_GENERATION_COOLDOWN_WORLD_TURNS_V1 } from './situation-generation'
import { projectTtrpgOpenWorldFactsV1 } from './open-fact-authority'
import { TTRPG_OPEN_SITUATION_OUTPUT_SCHEMA_V1 } from './open-generated-situation-output-schema'

type ReadInput = { scope: WorkspaceScope; sessionId: number; actorKey: string }
async function authorizedRead(input: ReadInput) {
  if (input.actorKey !== 'gm') throw new Error('[ttrpg-situation] 生成资料只允许明确的模型 GM 视角')
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'party' } })
  const { runtime, authorization } = loaded, run = runtime.openRun!
  const epoch = run.coordination.epochs.find(e => e.epochKey === run.coordination.activeEpochKey)
  const gm = authorization.seats.find(s => s.role === 'gm')
  if (!epoch || epoch.triggerKind !== 'request-situation' || run.stage.status !== 'open'
    || !gm?.consent.aiAdviceAllowed || !gm.consent.aiIdentityDisclosed
    || run.operations.some(o => ['awaiting-approval', 'executing'].includes(o.status))
    || runtime.branchLineage?.recoveryTasks.some(t => !['completed', 'withdrawn'].includes(t.status))
    || run.coordination.calls.some(c => ['prepared', 'dispatched'].includes(c.status)
      && (c.authorizationEpochKey !== epoch.epochKey || c.skillId !== 'prose.ttrpg-open-situation-propose'))) {
    throw new Error('[ttrpg-situation] 当前没有有效的独立生成窗口或 GM 模型读取同意')
  }
  const host = assertTtrpgOpenHumanHostV1(authorization, epoch.viewerKey)
  assertTtrpgOpenEpochAuthorityV1({ epoch, authorization, authorizationHash: await hashCanonicalValue(authorization), viewerKey: epoch.viewerKey })
  if (host.seatKey !== epoch.triggeredBySeatKey) throw new Error('[ttrpg-situation] 生成窗口不属于原真人授权席位')
  await loaded.assertCurrent()
  return { loaded, epoch }
}

export async function loadTtrpgOpenSituationContextV1(input: ReadInput) {
  return (await readModel(input)).context
}
/** Internal Run validation snapshot, never a model-delivered resource or a human fallback read. */
export async function loadTtrpgOpenSituationKernelInputV1(input: ReadInput) { return readModel(input) }
async function readModel(input: ReadInput) {
  const { loaded, epoch } = await authorizedRead(input)
  const { basis, personalizationValues } = await buildTtrpgOpenSituationBasisFromVerifiedReadV1(loaded, epoch.epochKey)
  const { campaign: c, rule, sessionFacts, personalizationSources } = basis
  const runtimeReferences = basis.runtimeEntityReferences
  const run = loaded.runtime.openRun!
  const currentFacts = projectTtrpgOpenWorldFactsV1({ state: loaded.state, content: loaded.content, sessionFacts })
  // Ground an open-ended draft in the actual party and its present places, rather than depending on
  // a prose search to happen to contain an opaque fact or identity key.
  const currentPlaces = new Set(basis.selectedActorKeys.map(key => loaded.state.entities[key]?.locationKey).filter(Boolean))
  const resources: Array<{ suffix: string; title: string; mandatory: boolean; value: unknown }> = []
  const add = (suffix: string, title: string, value: unknown, mandatory = false) => resources.push({ suffix, title, mandatory, value })
  const contract = {
    schema: 'storyforge.ttrpg-open-situation-input-contract', version: runtimeReferences ? 2 : 1, consumer: 'gm-situation-drafter',
    ...(runtimeReferences ? { runtimeEntityReferencesHash: runtimeReferences.snapshotHash, runtimeIdentitiesAreNotCurrentAvailability: true } : {}),
    output: { schema: 'storyforge.ttrpg-open-situation-proposal', version: 1,
      template: '完整局势正文，严格遵循 outputJsonSchema；禁止 templateKey',
      personalizationSourceKeys: '至少一个已完整读取的 personalization 来源键' },
    outputIsCandidate: true, grantsAcceptance: false, noActivation: true, noMechanicalAuthority: true, noWorldWrite: true,
    noPlayerDecisionOrCommitment: true, noNewEntityOrRuleDefinition: true, narrationIsNotConfirmedFact: true,
    assignedTemplateKey: basis.assignedTemplateKey, evidenceKeyPrefix: basis.assignedTemplateKey + '.',
    referenceDirectoryIsNotDeliveredBody: true, usedReferencesRequireCompleteResourcesAndManifest: true,
    releaseInitialStateIsNotCurrentState: true, retainAudienceAndOriginalRecipients: true,
    invariants: ['S1-S10', 'A1 same motive and both weighted-Jaccard values at or above threshold', 'A2 dependency DAG', 'A3 real scoped player source', 'cooldown'],
    homogeneityThreshold: TTRPG_SITUATION_GENERATION_HOMOGENEITY_THRESHOLD_V1,
    historyComparisonLimit: TTRPG_SITUATION_GENERATION_HISTORY_LIMIT_V1,
    cooldownWorldTurns: TTRPG_SITUATION_GENERATION_COOLDOWN_WORLD_TURNS_V1,
    playerCommitmentSourcesAvailable: false,
    outputJsonSchema: TTRPG_OPEN_SITUATION_OUTPUT_SCHEMA_V1,
    semanticRequirements: ['S1: at least two obstacles with a dependency DAG', 'S2: one non-null belief factRef',
      'S3: at least two intervention points', 'S4: required evidence and real discovery paths',
      'S5: explicit no-intervention outcome', runtimeReferences ? 'S6: frozen or actual committed NPC/front/fact driver; no player commitment exists' : 'S6: frozen NPC/front/fact driver; no player commitment exists',
      'S7: preserve audiences/recipients', 'S8: frozen effects/next-template references only',
      'S9: at least two real whyNow references', 'S10: unique evidence in assigned namespace', 'predicate depth <= 8'],
  }
  const frame = { schema: 'storyforge.ttrpg-open-situation-frame', version: 1,
    ...(runtimeReferences ? { runtimeEntityReferencesHash: runtimeReferences.snapshotHash } : {}),
    sessionKey: basis.sessionKey, runtimeSourceHash: basis.runtimeSourceHash, worldReleaseHash: basis.worldReleaseHash,
    sourceLineageHash: basis.sourceLineageHash, assignedTemplateKey: basis.assignedTemplateKey,
    worldTurn: basis.worldTurn, chaos: run.chaos.value, stage: { ...run.stage }, selectedActorKeys: basis.selectedActorKeys,
    authorizationHash: basis.authorizationHash, mechanicalStateHash: basis.mechanicalStateHash,
    cooldownUntilWorldTurn: basis.cooldownUntilWorldTurn,
    activeSituationKeys: run.situations.active.map(s => s.situationKey), queuedSituationKeys: run.situations.queued.map(s => s.situationKey) }
  const history = basis.history.slice(-TTRPG_SITUATION_GENERATION_HISTORY_LIMIT_V1).map(h => ({
    templateKey: h.template.templateKey, motive: h.template.motive, sourceRef: h.sourceRef, ...(h.sourceKind ? { sourceKind: h.sourceKind } : {}),
    obstacleKinds: h.template.obstacles.map(o => o.kind), actionKeys: h.template.interventionPoints.flatMap(i => i.suggestedActionKeys) }))
  add('situation-contract', '新局势的生成与来源合同', contract, true)
  add('situation-frame', '当前阶段、来源与系统分配的候选身份', frame, true)
  add('situation-recent-history', '内核同质化比较使用的真实最近历史', { history }, true)
  if (runtimeReferences) add('runtime-entity-references', '本次实际已创建实例的版本化身份；不等于当前可用性', runtimeReferences, true)
  add('campaign-premise', '冻结战役背景与本桌安全边界', { title: c.title, pitch: c.pitch, bible: c.bible,
    sessionZero: c.sessionZero, contentWarnings: c.contentWarnings, canonInvariantPredicates: c.canonInvariantPredicates })
  add('rules-core', '冻结规则与事实策略', { ruleSystemId: rule.ruleSystemId, factPolicy: rule.factPolicy,
    attributes: rule.attributes, resources: rule.resources, conditions: rule.conditions, checks: rule.checks, socialTierMappings: rule.socialTierMappings })
  add('current-ledgers', '当前规则所有者的局部事实与余额', { storyFacts: loaded.runtime.product.effectLedger.storyFacts,
    socialBalances: loaded.runtime.product.effectLedger.socialBalances, advancementBalances: loaded.runtime.product.effectLedger.advancementBalances })
  for (const action of rule.actions) add('action.' + action.key, '可引用行动 · ' + action.key, action)
  for (const check of rule.genericChecks) add('check.' + check.checkKey, '可引用通用检定 · ' + check.checkKey, check)
  for (const interaction of rule.interactionBindings ?? []) add('interaction.' + interaction.interactionKey, '冻结互动 · ' + interaction.interactionKey, interaction)
  for (const plan of c.effectPlanTemplates) add('effect.' + plan.planKey, '可引用效果计划 · ' + plan.planKey, plan)
  for (const actor of c.characterTemplates) add('actor.' + actor.characterKey, '冻结角色定义 · ' + actor.characterKey, actor)
  for (const binding of c.entityBindings) {
    const current = loaded.state.entities[binding.bindingKey]
    add('entity.' + binding.bindingKey, '冻结实体绑定与当前状态 · ' + binding.bindingKey, {
      binding, releaseInitialValuesAreNotCurrent: true, current: current ? { entityKey: current.entityKey, name: current.name,
        locationKey: current.locationKey, lifecycleStatus: current.lifecycleStatus, attributes: current.attributes,
        ...(binding.kind === 'actor' ? {
          conditions: loaded.runtime.product.conditions[binding.bindingKey] ?? [],
          abilityStates: Object.values(loaded.runtime.product.abilityStates).filter(a => a.actorInstanceId === binding.bindingKey),
          inventory: Object.values(loaded.runtime.product.inventory.items).filter(i => i.ownerRef === binding.bindingKey).map(i => ({
            itemInstanceId: i.itemInstanceId, definitionRef: i.definitionRef, quantity: i.quantity,
            charges: i.charges, durability: i.durability, identification: i.identification, stateTags: i.stateTags })),
        } : {}) } : null })
  }
  if (runtimeReferences) for (const identity of runtimeReferences.references) {
    const current = loaded.state.entities[identity.entityRef]
    if (!current) throw new Error('[ttrpg-situation] 已创建实例的机械 owner 不存在')
    const operation = run.entityOperations!.find(row => row.plan.operationKey === identity.operationKey)!
    const item = operation.plan.items.find(row => row.entityKey === identity.entityRef)
    add('entity.' + identity.entityRef, '已创建实例与当前机械状态 · ' + current.name, {
      schema: 'storyforge.ttrpg-open-current-instance-reference', version: 1, identity,
      current: { entityKey: current.entityKey, name: current.name, locationKey: current.locationKey, lifecycleStatus: current.lifecycleStatus,
        attributes: current.attributes, ...(identity.kind === 'actor' ? { conditions: loaded.runtime.product.conditions[identity.entityRef] ?? [],
          abilityStates: Object.values(loaded.runtime.product.abilityStates).filter(a => a.actorInstanceId === identity.entityRef),
          inventory: Object.values(loaded.runtime.product.inventory.items).filter(i => i.ownerRef === identity.entityRef) }
          : identity.kind === 'item' ? { inventory: loaded.runtime.product.inventory.items[identity.entityRef] } : {}) },
      initialProposal: item ? item.proposal : null, identityDoesNotGrantNewObservationOrMechanicalAuthority: true,
    })
  }
  if (runtimeReferences) {
    for (const key of new Set(runtimeReferences.references.flatMap(row => row.dynamicTemplateKey ? [row.dynamicTemplateKey] : []))) {
      add('dynamic-template.' + key, '实例的原冻结授权模板 · ' + key, c.dynamicEntityTemplates.find(row => row.templateKey === key)!)
    }
    for (const key of new Set(runtimeReferences.references.filter(row => row.kind === 'item').map(row => row.templateKey))) {
      add('item-definition.' + key, '实例的原冻结物品定义 · ' + key, rule.items.find(row => row.key === key)!)
    }
  }
  for (const fact of c.frozenWorldPredicateIndex.entries) add('world-fact.' + fact.factKey, '冻结事实与当前权威取值 · ' + fact.factKey, {
    fact, temporalMeaning: fact.authority === 'invariant' ? 'immutable' : 'release-initial-state',
    current: currentFacts.find(f => f.subjectRef === fact.subjectRef && f.predicateKey === fact.predicateKey && (f.objectRef ?? null) === fact.objectRef) ?? null },
    fact.predicateKey === 'exists' && currentPlaces.has(fact.subjectRef))
  for (const fact of sessionFacts) add('session-fact.' + fact.factKey, '实际已确认的团内事实 · ' + fact.factKey, fact)
  for (const clock of c.clocks) add('clock.' + clock.clockKey, '冻结时钟与当前值 · ' + clock.clockKey, { definition: clock, current: run.clocks.find(v => v.clockKey === clock.clockKey) })
  for (const front of c.fronts) add('front.' + front.frontKey, '冻结势力前线与当前状态 · ' + front.frontKey, { definition: front, current: run.fronts.find(v => v.frontKey === front.frontKey) })
  for (const secret of c.secrets) add('secret.' + secret.secretKey, '冻结秘密；不可自动公开 · ' + secret.secretKey, secret)
  for (const quest of c.quests) add('quest.' + quest.questKey, '冻结任务定义 · ' + quest.questKey, quest)
  for (const entry of rule.compendium) add('compendium.' + entry.key, '冻结规则条目 · ' + entry.key, entry)
  for (const template of [...c.situationTemplates, ...basis.sessionTemplates]) add('situation-definition.' + template.templateKey, (basis.sessionTemplates.some(s => s.templateKey === template.templateKey) ? '已采用局势定义；历史引用不等于当前事实 · ' : '既有完整局势定义 · ') + template.templateKey, template)
  for (const history of basis.history) add('situation-history.' + history.situationKey, '实际采用过的局势 · ' + history.situationKey, history)
  for (const source of personalizationSources) add('personalization.' + source.sourceKey, '真实玩家来源 · ' + source.kind + ' · ' + source.sourceKey, {
    source, value: personalizationValues.find(v => v.sourceKey === source.sourceKey)!.value, grantsPlayerCommitment: false }, source.kind === 'identity')
  const directory = { schema: 'storyforge.ttrpg-open-situation-reference-directory', version: runtimeReferences ? 2 : 1,
    actionKeys: rule.actions.map(a => a.key), genericCheckKeys: rule.genericChecks.map(a => a.checkKey),
    effectPlanKeys: c.effectPlanTemplates.map(p => p.planKey), entityRefs: [...c.entityBindings.map(b => b.bindingKey), ...(runtimeReferences?.references.map(row => row.entityRef) ?? [])],
    npcDriverKeys: [...c.characterTemplates.filter(a => a.role === 'npc').map(a => a.characterKey), ...(runtimeReferences?.references.filter(row => row.kind === 'actor').map(row => row.entityRef) ?? [])], frontKeys: c.fronts.map(f => f.frontKey),
    factRefs: [...c.frozenWorldPredicateIndex.entries, ...sessionFacts].map(f => f.factKey),
    sourceResourceRefs: [...new Set([...c.frozenWorldPredicateIndex.entries.flatMap(f => f.sourceResourceRefs),
      ...c.entityBindings.flatMap(b => b.sourceResourceRef === null ? [] : [b.sourceResourceRef]),
      ...(runtimeReferences ? c.dynamicEntityTemplates.filter(t => runtimeReferences.references.some(row => row.dynamicTemplateKey === t.templateKey)).flatMap(t => t.sourceRefs) : [])])],
    sourceResourceReferencesAreProvenanceOnly: true,
    secretKeys: c.secrets.map(s => s.secretKey), questKeys: c.quests.map(q => q.questKey),
    whyNowRefs: [...c.frozenWorldPredicateIndex.entries.map(f => 'world:' + f.subjectRef + ':' + f.predicateKey),
      ...c.clocks.map(v => 'clock:' + v.clockKey), ...c.fronts.flatMap(f => f.telegraph.map(t => 'telegraph:' + t.telegraphKey)),
      ...sessionFacts.map(f => 'session:' + f.factKey)],
    nextSituationTemplateKeys: [...c.situationTemplates, ...basis.sessionTemplates].map(t => t.templateKey),
    personalization: personalizationSources, resourceDirectory: resources.map(r => ({ suffix: r.suffix, title: r.title })),
    directoryDoesNotGrantFullRead: true }
  add('situation-directory', '合法引用目录；正文须另行完整读取', directory, true)
  // The current authored setup supplies a coherent starting point, rather than unrelated high-scoring
  // snippets. Its exact rule/fact/entity/effect dependencies share the candidate reference planner.
  const activeKeys = new Set([...run.situations.active, ...run.situations.queued].map(s => s.templateKey))
  const setupKeys = activeKeys.size ? activeKeys : new Set(c.openingSituationKeys)
  const availableSuffixes = new Set(resources.map(r => r.suffix)), required = new Set<string>()
  for (const template of [...c.situationTemplates, ...basis.sessionTemplates].filter(t => setupKeys.has(t.templateKey))) {
    for (const row of planTtrpgOpenSituationReferenceNeedsV1({ template, basis, resources, availableSuffixes })) required.add(row.suffix)
  }
  for (const item of resources) if (required.has(item.suffix)) item.mandatory = true
  await loaded.assertCurrent()
  const visibilityHash = await hashCanonicalValue(resources)
  return { loaded, basis, context: { resources, frame, visibilityHash, admissionStateHash: await hashCanonicalValue(basis),
    readEvidence: { sequence: loaded.state.lastSequence, stateHash: loaded.stateHash, runtimeSourceHash: basis.runtimeSourceHash, sessionKey: basis.sessionKey } } }
}

async function scopeInput(scope: FrozenResourceScopeV1): Promise<ReadInput> {
  if (!scope.productRuntimeSessionId || !scope.worldId || !scope.workId || scope.runtimeActorKey !== 'gm') throw new Error('[ttrpg-situation] 生成来源需要准确本桌、作品与模型 GM 视角')
  const workspace = await resolveScope({ scope: { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId } })
  return { scope: workspace, sessionId: scope.productRuntimeSessionId, actorKey: 'gm' }
}
export function createTtrpgOpenSituationContextProviderV1() {
  return createTtrpgOpenRuntimeResourceProviderV1({ sourceKey: TTRPG_OPEN_SITUATION_INPUT_SOURCE_V1,
    providerVersion: 'ttrpg-open-situation-provider-v1', normalizationVersion: 'ttrpg-open-situation-json-v1',
    kinds: ['fact', 'reference'], catalog, assertAccess: async scope => { await authorizedRead(await scopeInput(scope)) } })
}
async function catalog(scope: FrozenResourceScopeV1) {
  const input = await scopeInput(scope), { loaded, context } = await readModel(input)
  const { immutable, source, state, stateHash, runtime } = loaded, workspace = input.scope
  const fingerprint = await hashCanonicalValue({ scope, runtimeSourceHash: source.runtimeSourceHash, stateHash, visibilityHash: context.visibilityHash })
  const policyHash = await hashCanonicalValue({ sourceKey: TTRPG_OPEN_SITUATION_INPUT_SOURCE_V1, consumer: 'gm-situation-drafter', fullIsAtomic: true, originalRead: false,
    ...(context.frame && 'runtimeEntityReferencesHash' in context.frame ? { runtimeEntityReferencesHash: context.frame.runtimeEntityReferencesHash } : {}) })
  const refs: ContextResourceDescriptorV1['sourceRefs'] = [
    { table: immutable.table, recordId: immutable.recordId, field: immutable.field, revision: source.packageHash, contentHash: await sha256Text(immutable.raw!) },
    { table: 'productRuntimeSessions', recordId: input.sessionId, field: 'runtimeHeadStateJson', revision: state.lastSequence, contentHash: stateHash }]
  const resources: TtrpgOpenResourceRowV1[] = await Promise.all(context.resources.map(async item => {
    const content = canonicalStringify(item.value), contentHash = await sha256Text(content), tokenCount = estimateTokens(content)
    return { content, tokenCount, searchText: content, descriptor: { version: 1,
      resourceKey: 'fact:ttrpg-open:' + runtime.sessionKey + ':gm:' + item.suffix, sourceKey: TTRPG_OPEN_SITUATION_INPUT_SOURCE_V1,
      kind: item.mandatory ? 'fact' : 'reference', title: item.title, shortSummary: item.title,
      authority: ['session-fact.', 'situation-history.', 'personalization.choice.', 'entity.', 'front.', 'clock.', 'world-fact.', 'situation-frame'].some(prefix => item.suffix.startsWith(prefix)) ? 'confirmed-evidence' : 'author-canon',
      contentRevision: state.lastSequence, contentHash, policyRevision: 'runtimeEntityReferencesHash' in context.frame ? 2 : 1, policyHash,
      scope: { projectId: workspace.projectId, worldId: workspace.worldId, workId: workspace.workId,
        productRuntimeSessionId: input.sessionId, runtimeActorKey: 'gm' }, relations: [], sourceRefs: refs,
      tokenEstimate: { full: tokenCount }, availableDepths: ['full'], priority: item.mandatory ? 'must-read' : 'normal' } }
  }))
  await loaded.assertCurrent()
  return { fingerprint, resources }
}
