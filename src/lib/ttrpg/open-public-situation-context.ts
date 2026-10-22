/** Read-only common source basis. Not a model-call or an adoption authorization. */
import type { WorkspaceScope } from '../types'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { loadTtrpgOpenCommonProjectionV1 } from './open-player-context'
import { TtrpgOpenReadConflictV1 } from './open-read-conflict'
import type { ContextResourceDescriptorV1, FrozenResourceScopeV1 } from '../registry/types'
import { resolveScope } from '../workspace/scope'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { estimateTokens } from '../ai/context-budget'
import { createTtrpgOpenRuntimeResourceProviderV1, type TtrpgOpenResourceRowV1 } from './open-runtime-resource-provider'
import { TTRPG_OPEN_PUBLIC_SITUATION_REQUEST_POLICY_V1 } from './open-public-situation-request'
import { describeTtrpgOpenPublicPredicateScopeV1 } from './open-public-situation-predicates'
import { TTRPG_OPEN_SITUATION_OUTPUT_SCHEMA_V1 } from './open-generated-situation-output-schema'
import { ttrpgOpenMechanicalStateHashV1 } from './open-rule-plan'
import { hashTtrpgOpenPublicSituationRequestBasisV1 } from './open-public-situation-request'
import { TTRPG_OPEN_PUBLIC_SITUATION_TRIGGER_V1 } from './open-public-situation-authorization-contract'
import { createTtrpgOpenRuntimeEntityReferencesV1, assertTtrpgOpenRuntimeEntityReferencesMatchV1, assertTtrpgOpenSituationRuntimeReferenceJournalV1,
  type TtrpgOpenSituationRuntimeReferencePolicyV1 } from './open-runtime-entity-references'
import { ttrpgOpenEntityIdentityCatalogV1, ttrpgOpenEntityReferenceVisibleV1 } from './open-entity-catalog'

export const TTRPG_OPEN_PUBLIC_SITUATION_SOURCE_V1 = 'ttrpgOpenPublicSituationInput'

export async function loadTtrpgOpenPublicSituationContextV1(input: { scope: WorkspaceScope; sessionId: number; actorKey: string },
  explicitReferencePolicy?: TtrpgOpenSituationRuntimeReferencePolicyV1 | 'current-common-entities') {
  return (await loadPublicSituationReadModel(input, explicitReferencePolicy)).context
}
async function loadPublicSituationReadModel(input: { scope: WorkspaceScope; sessionId: number; actorKey: string },
  explicitReferencePolicy?: TtrpgOpenSituationRuntimeReferencePolicyV1 | 'current-common-entities') {
  if (input.actorKey !== 'gm') throw new Error('[ttrpg-public-situation] 共同局势来源需要明确的共同视图')
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'party' } })
  const common = await loadTtrpgOpenCommonProjectionV1(input)
  const { content, state, stateHash, runtime, source, authorization } = loaded, run = runtime.openRun!
  if (common.readEvidence.sequence !== state.lastSequence || common.readEvidence.stateHash !== stateHash
    || common.readEvidence.runtimeSourceHash !== source.runtimeSourceHash
    || canonicalStringify(common.recipientActorKeys) !== canonicalStringify([...authorization.selectedActorKeys].sort())) {
    throw new TtrpgOpenReadConflictV1('共同局势资料读取期间来源或接收者已变化')
  }
  const recipients = common.recipientActorKeys, view = common.view
  const epoch = run.coordination.epochs.find(e => e.epochKey === run.coordination.activeEpochKey)
  let runtimeEntityReferencePolicy = explicitReferencePolicy === 'current-common-entities' ? undefined
    : explicitReferencePolicy ?? (epoch?.publicSituation ? epoch.runtimeEntityReferencePolicy : undefined)
  if (explicitReferencePolicy === 'current-common-entities') {
    if (epoch) throw new Error('[ttrpg-public-situation] 实例读取须在明确开始前选择')
    const entityRefs = ttrpgOpenEntityIdentityCatalogV1(content, run.entityOperations ?? []).filter(row => row.dynamic && recipients.every(actor =>
      ttrpgOpenEntityReferenceVisibleV1(row.audience, row.recipientActorKeys, actor, false, true))).map(row => row.entityKey)
    const references = await createTtrpgOpenRuntimeEntityReferencesV1({ content, operations: run.entityOperations ?? [], runtimeSourceHash: source.runtimeSourceHash, entityRefs })
    runtimeEntityReferencePolicy = { schema: 'storyforge.ttrpg-open-situation-runtime-reference-policy', version: 1, consumer: 'common-party', references }
  }
  if (runtimeEntityReferencePolicy) {
    if (runtimeEntityReferencePolicy.consumer !== 'common-party' || epoch && canonicalStringify(epoch.runtimeEntityReferencePolicy) !== canonicalStringify(runtimeEntityReferencePolicy)) throw new Error('[ttrpg-public-situation] 实例读取不能借用其他请求策略')
    assertTtrpgOpenSituationRuntimeReferenceJournalV1({ policy: runtimeEntityReferencePolicy, operations: run.entityOperations ?? [], recipientActorKeys: recipients,
      rulePackContentHash: content.rulePack.contentHash, consumerRef: epoch?.startedRef ?? { sessionKey: runtime.sessionKey, sequence: state.lastSequence + 1 } })
    await assertTtrpgOpenRuntimeEntityReferencesMatchV1({ content, operations: run.entityOperations ?? [], runtimeSourceHash: source.runtimeSourceHash,
      snapshot: runtimeEntityReferencePolicy.references, mode: 'current', entityRefs: runtimeEntityReferencePolicy.references.references.map(row => row.entityRef) })
  }
  const instanceIdentities = runtimeEntityReferencePolicy?.references.references.map(row => {
    const entity = state.entities[row.entityRef]
    if (!entity) throw new Error('[ttrpg-public-situation] 原实例身份缺少本桌对象')
    return { entityRef: row.entityRef, kind: row.kind, name: entity.name, sourceRef: row.sourceRef, audience: row.audience, recipientActorKeys: row.recipientActorKeys }
  })
  // Authorization already discloses the selected role keys. No authored biography, secret,
  // location, mechanical owner or private player choice is promoted into this identity.
  const personalization = await Promise.all(recipients.map(async actorKey => {
    const value = { runtimeSourceHash: source.runtimeSourceHash, actorKey, identityKind: 'selected-player-character' as const }
    const contentHash = await hashCanonicalValue(value)
    return { source: { sourceKey: `identity.${contentHash.slice(0, 48)}`, kind: 'identity' as const,
      actorKeys: [actorKey], knownByActorKeys: [...recipients], sourceRef: null, contentHash }, value }
  }))
  const observations = new Set(view.initialObservations.map(canonicalStringify))
  const initial = content.campaign.frozenWorldPredicateIndex.entries.filter(fact => fact.audience === 'public' || fact.audience === 'party'
    || (fact.audience === 'private' && recipients.every(actor => fact.knownByActorKeys.includes(actor))))
    .filter(fact => observations.has(canonicalStringify({ subjectRef: fact.subjectRef, predicateKey: fact.predicateKey,
      objectRef: fact.objectRef, canonicalValue: fact.canonicalValue, authority: fact.authority, asOf: 'release' })))
    .map(fact => ({ factRef: fact.factKey, subjectRef: fact.subjectRef, predicateKey: fact.predicateKey,
      objectRef: fact.objectRef, canonicalValue: fact.canonicalValue, authority: fact.authority, asOf: 'release' as const,
      sourceResourceRefs: [...fact.sourceResourceRefs] }))
  const entries = [
    ...initial.map(value => ({ kind: 'release-observation' as const, reliability: 'release-time' as const, value })),
    ...view.knowledge.map(value => ({ kind: 'known-evidence' as const, reliability: value.reliability, value })),
    ...view.sessionFacts.map(value => ({ kind: 'confirmed-session-fact' as const, reliability: 'confirmed' as const, value })),
    ...view.pressureSignals.map(value => ({ kind: 'published-telegraph' as const, reliability: 'observed' as const, value })),
  ]
  const attributed = await Promise.all(entries.map(async entry => ({ sourceKey: `common.${await hashCanonicalValue(entry)}`, ...entry })))
  const clocks = run.clocks.filter(clock => clock.visibility === 'party' || clock.visibility === 'public').map(clock => ({
    clockKey: clock.clockKey, title: clock.title, value: clock.value, maximum: clock.maximum, completed: clock.completed,
  }))
  const frame = { schema: 'storyforge.ttrpg-open-public-situation-frame', version: 1,
    recipientActorKeys: recipients, stage: { ...run.stage }, worldTurn: run.worldTime.worldTurn, actors: view.actorsHere, clocks }
  // Explicitly separate currently supportable predicates from prose that merely records an old observation.
  // No mutable owner is sampled here: release-time positions, HP, inventory and relationships stay historical.
  const predicateScope = describeTtrpgOpenPublicPredicateScopeV1({
    worldTurn: run.worldTime.worldTurn, recipientActorKeys: recipients,
    invariantFacts: initial.filter(fact => fact.authority === 'invariant'),
    sessionFacts: view.sessionFacts,
    clocks,
    observedEvidenceRefs: [...new Set(view.knowledge.filter(entry => entry.reliability === 'observed').map(entry => entry.evidenceRef))] })
  const contract = { schema: 'storyforge.ttrpg-open-public-situation-source-contract', version: runtimeEntityReferencePolicy ? 2 : 1,
    ...(runtimeEntityReferencePolicy ? { runtimeInstanceIdentityOnly: true, instanceIdentityGrantsNoPositionInventoryOrAction: true } : {}),
    sourceKey: TTRPG_OPEN_PUBLIC_SITUATION_SOURCE_V1, consumer: 'public-situation-generator',
    noMechanicalMutation: true, noWorldWrite: true, noPlayerDecision: true, noImplicitSharing: true,
    outputJsonSchema: TTRPG_OPEN_SITUATION_OUTPUT_SCHEMA_V1,
    releaseObservationsAreNotCurrentState: true, hearsayAndBeliefAreNotObjectiveEvidence: true,
    ruleDefinitionsConferNoActorGrantOrAvailability: true, citationsOnlyFromDeliveredBodies: true,
    predicateScopeIsAnAllowlistNotTheWholeRuntime: true, sourceReadConfersNoAdoptionAuthorization: true,
    semanticRequirements: ['S1: 至少两个障碍，依赖图无环', 'S2: 至少一条 belief 有本次真实可读 factRef',
      'S3: 至少两个介入点，线索发现路径绑定真实介入点和共同规则 key',
      'S4: 至少两条线索，required 线索保留真实发现路径及障碍覆盖',
      'S5: 不介入后果须引用至少一个可见时钟；本次不交付效果计划，effectPlanRef 必须为 null',
      'S6: 驱动只能是共同可见 NPC 身份或不变量/当前会话事实，不虚构玩家承诺',
      'S7: 不降低来源密级或扩大原私密接收者，模型拟定的线索不等于已授予知识',
      'S8: 所有效果引用为 null，consequences 为空；不引入未交付的效果、前线或后续模板',
      'S9: 至少两个真实 whyNowRefs；仅 world:不变量主体:谓词、session:当前事实键、clock:可见时钟键',
      'S10: clueRef 使用本次分配的模板键加点号作为前缀，不能声明 templateKey',
      'A3: 至少一个实际完整交付的共同 identity 来源键；身份不是玩家选择或承诺'] }
  const requestPolicy = TTRPG_OPEN_PUBLIC_SITUATION_REQUEST_POLICY_V1
  const resources = [
    { suffix: 'public-situation-contract', title: '共同局势的来源与权威边界', mandatory: true, value: { ...contract, requestPolicy } },
    { suffix: 'public-situation-frame', title: '当前共同接收者与可见局面', mandatory: true, value: frame },
    { suffix: 'public-situation-predicates', title: '本次共同证据支持的条件', mandatory: true, value: predicateScope },
    { suffix: 'public-situation-rules', title: '共同可读规则定义（不授予角色行动权限）', mandatory: true,
      value: { schema: 'storyforge.ttrpg-open-public-situation-rules', version: 1, ...view.rules } },
    { suffix: 'public-situation-identities', title: '实际选定的玩家身份（不含私密人物资料）', mandatory: true,
      value: { schema: 'storyforge.ttrpg-open-public-situation-identities', version: 1, personalization,
        npcDriverKeys: [...view.actorsHere.filter(actor => content.campaign.characterTemplates.some(t => t.characterKey === actor.actorKey && t.role === 'npc')).map(actor => actor.actorKey),
          ...(instanceIdentities?.filter(row => row.kind === 'actor').map(row => row.entityRef) ?? [])],
        identityKeysAreNotPlayerCommitments: true, privateBiographiesAreNotDelivered: true } },
    ...(instanceIdentities ? [{ suffix: 'public-situation-instances', title: '本次共同可知的已创建实例身份', mandatory: true,
      value: { schema: 'storyforge.ttrpg-open-public-situation-instances', version: 1, identities: instanceIdentities,
        snapshotHash: runtimeEntityReferencePolicy!.references.snapshotHash, identitiesAreNotCurrentMechanicalState: true } }] : []),
    ...attributed.map(entry => ({ suffix: `public-situation-entry.${entry.sourceKey}`, title: `共同局势来源 · ${entry.kind}`, mandatory: false,
      value: { schema: 'storyforge.ttrpg-open-public-situation-entry', version: 1, entry } })),
  ]
  // The base visibility identity survives only the authorization/booking events. The epoch key
  // separately freezes this exact shared input; actual full packet/Manifest include its body.
  const visibilityHash = await hashCanonicalValue(resources)
  let sharedInput: { schema: string; version: number; requestKey: string; basisHash: string; text: string;
    sharingDecision: string; delegationDecision: string; recipientActorKeys: string[] } | null = null
  if (epoch?.triggerKind === TTRPG_OPEN_PUBLIC_SITUATION_TRIGGER_V1) {
    const grant = epoch.publicSituation
    if (!grant || epoch.sessionZeroRevision !== authorization.revision
      || epoch.authorizationHash !== await hashCanonicalValue(authorization)
      || grant.basis.sourceVisibilityHash !== visibilityHash
      || canonicalStringify(grant.basis.recipientActorKeys) !== canonicalStringify(recipients)
      || await hashTtrpgOpenPublicSituationRequestBasisV1(grant.basis) !== grant.basisHash) throw new Error('[ttrpg-public-situation] 本次共同输入授权已失效')
    sharedInput = { schema: 'storyforge.ttrpg-open-public-situation-shared-input', version: 1, requestKey: grant.basis.requestKey,
        basisHash: grant.basisHash, text: grant.basis.sharedRequest.text, sharingDecision: grant.basis.sharedRequest.decision,
        delegationDecision: grant.basis.delegation.decision, recipientActorKeys: recipients }
  }
  const assignment = sharedInput && epoch ? { schema: 'storyforge.ttrpg-open-public-situation-assignment', version: 1,
    assignedTemplateKey: `generated.${(await hashCanonicalValue({ sessionKey: runtime.sessionKey, proposalKey: epoch.epochKey })).slice(0, 40)}`,
    requestKey: sharedInput.requestKey, basisHash: sharedInput.basisHash,
    evidenceKeysMustUseAssignedTemplateKeyAsPrefix: true, playerCommitmentSourcesAvailable: false,
    unsupportedReferences: ['effects', 'fronts', 'next-templates', 'private-actors', 'private-profiles', 'private-choices'],
    ruleProjectionSupportsOnlyDefinitionReferences: true, clockProjectionSupportsOnlyVisibleClockReferences: true } : null
  const allResources = sharedInput && assignment ? [...resources,
    { suffix: 'public-situation-shared-input', title: '本人明确共享的本次局势要求', mandatory: true, value: sharedInput },
    { suffix: 'public-situation-assignment', title: '本次系统分配的候选命名空间与引用边界', mandatory: true, value: assignment }] : resources
  await loaded.assertCurrent()
  return { loaded, context: { resources: allResources, entries: attributed, frame, predicateScope, rules: view.rules,
    personalization, ...(runtimeEntityReferencePolicy ? { runtimeEntityReferencePolicy } : {}), visibilityHash, admissionStateHash: await ttrpgOpenMechanicalStateHashV1(state),
    authorizationRevision: common.authorizationRevision, readEvidence: common.readEvidence } }
}

export function createTtrpgOpenPublicSituationContextProviderV1() {
  return createTtrpgOpenRuntimeResourceProviderV1({ sourceKey: TTRPG_OPEN_PUBLIC_SITUATION_SOURCE_V1,
    providerVersion: 'ttrpg-open-public-situation-provider-v1', normalizationVersion: 'ttrpg-open-public-situation-json-v1',
    kinds: ['fact', 'reference'], catalog: publicCatalog,
    assertAccess: async (scope, pinnedFingerprint) => {
      if ((await publicCatalog(scope)).fingerprint !== pinnedFingerprint) throw new TtrpgOpenReadConflictV1('共同资料的接收者、权限、来源或进度已变化')
    } })
}
async function publicCatalog(scope: FrozenResourceScopeV1) {
  if (!scope.productRuntimeSessionId || !scope.worldId || !scope.workId || scope.runtimeActorKey !== 'gm') throw new Error('[ttrpg-public-situation] 共同来源需要准确团局作用域与共同视图')
  try {
    const workspace = await resolveScope({ scope: { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId } })
    const { context, loaded } = await loadPublicSituationReadModel({ scope: workspace, sessionId: scope.productRuntimeSessionId, actorKey: 'gm' })
    const { immutable, source, runtime, state, stateHash } = loaded
    const fingerprint = await hashCanonicalValue({ scope, readEvidence: context.readEvidence,
      authorizationRevision: context.authorizationRevision, visibilityHash: context.visibilityHash })
    const policyHash = await hashCanonicalValue({ sourceKey: TTRPG_OPEN_PUBLIC_SITUATION_SOURCE_V1,
      consumer: 'public-situation-generator', fullIsAtomic: true, originalRead: false, exactWholePartyIntersection: true,
      ...(context.runtimeEntityReferencePolicy ? { runtimeEntityReferencesHash: context.runtimeEntityReferencePolicy.references.snapshotHash } : {}) })
    const refs: ContextResourceDescriptorV1['sourceRefs'] = [
      { table: immutable.table, recordId: immutable.recordId, field: immutable.field, revision: source.packageHash, contentHash: await sha256Text(immutable.raw!) },
      { table: 'productRuntimeSessions', recordId: scope.productRuntimeSessionId, field: 'runtimeHeadStateJson', revision: state.lastSequence, contentHash: stateHash }]
    const resources: TtrpgOpenResourceRowV1[] = await Promise.all(context.resources.map(async item => {
      const content = canonicalStringify(item.value), tokenCount = estimateTokens(content)
      const reliability = 'entry' in item.value ? item.value.entry.reliability : undefined
      const authority: ContextResourceDescriptorV1['authority'] = reliability === 'release-time' ? 'author-canon'
        : reliability === 'hearsay' || reliability === 'belief' ? 'derived-summary' : 'confirmed-evidence'
      const searchText = 'entry' in item.value ? canonicalStringify(item.value.entry.value) : item.title
      return { content, tokenCount, searchText, descriptor: { version: 1, resourceKey: `fact:ttrpg-open:${runtime.sessionKey}:gm:${item.suffix}`,
        sourceKey: TTRPG_OPEN_PUBLIC_SITUATION_SOURCE_V1, kind: item.mandatory ? 'fact' : 'reference', title: item.title,
        shortSummary: searchText.slice(0, 240), authority, contentRevision: state.lastSequence, contentHash: await sha256Text(content),
        policyRevision: context.runtimeEntityReferencePolicy ? 2 : 1, policyHash, scope: { projectId: workspace.projectId, worldId: workspace.worldId, workId: workspace.workId,
          productRuntimeSessionId: scope.productRuntimeSessionId, runtimeActorKey: 'gm' }, relations: [], sourceRefs: refs,
        tokenEstimate: { full: tokenCount }, availableDepths: ['full'], priority: item.mandatory ? 'must-read' : 'normal' } }
    }))
    await loaded.assertCurrent()
    return { fingerprint, resources }
  } catch (error) {
    // Original proof failures can mention private definitions. None enter public provider errors.
    if (error instanceof TtrpgOpenReadConflictV1) throw new TtrpgOpenReadConflictV1('共同资料读取期间身份、来源或进度已变化')
    throw new Error('[ttrpg-public-situation] 当前共同资料不可读取，请检查本桌授权与来源')
  }
}
