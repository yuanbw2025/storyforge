/** Read-only F13 proposal resources. A resource or scope never grants a model call or entity creation. */
import type { WorkspaceScope } from '../types'
import type { ContextResourceDescriptorV1, FrozenResourceScopeV1 } from '../registry/types'
import { canonicalStringify, hashCanonicalValue as hash } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { estimateTokens } from '../ai/context-budget'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { isTtrpgOpenPassiveEpochV1 } from './open-coordination'
import { verifyTtrpgOpenOracleJournalV1 } from './open-oracle-contract'
import { ttrpgOpenEntityIdentityCatalogV1, ttrpgOpenEntityReferenceVisibleV1 as visible } from './open-entity-catalog'
import { countTtrpgOpenEntityInstancesV1 } from './open-entity-mechanics'
import { ttrpgOpenMechanicalStateHashV1 } from './open-rule-plan'
import { createTtrpgOpenRuntimeResourceProviderV1, type TtrpgOpenResourceRowV1 } from './open-runtime-resource-provider'
import { TtrpgOpenReadConflictV1 } from './open-read-conflict'
import { assertInstanceBinding } from '../product/runtime-instances'
import { readProductRuntimeState } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { parseTtrpgOpenEntityModelSelectionV1, type TtrpgOpenEntityModelSelectionV1 } from './open-entity-model-contract'

export const TTRPG_OPEN_ENTITY_SOURCE_V1 = 'ttrpgOpenEntityInput'
export interface TtrpgOpenEntityProposalScopeV1 {
  scopeKey: string; audience: 'public' | 'party' | 'private' | 'gm-only'; recipientActorKeys: string[];
}
type Resource = { suffix: string; title: string; mandatory: boolean; value: unknown }

export async function loadTtrpgOpenEntityContextV1(input: { scope: WorkspaceScope; sessionId: number; actorKey: string }) {
  return (await entityRead(input)).context
}
/** Exact selection, with no silent truncation or reads from adjacent privacy partitions. */
export function selectTtrpgOpenEntityModelResourcesV1(context: Awaited<ReturnType<typeof loadTtrpgOpenEntityContextV1>>,
  inventory: readonly ContextResourceDescriptorV1[], selectionValue: TtrpgOpenEntityModelSelectionV1) {
  const selection = parseTtrpgOpenEntityModelSelectionV1(selectionValue)
  const partition = context.directory.find(d => canonicalStringify(d.sourceRef) === canonicalStringify(selection.oracleSourceRef)
    && canonicalStringify(d.scope) === canonicalStringify(selection.scope))
  if (!partition || selection.epochInputRevision !== context.epochInputRevision) throw new Error('实体提案须选择本窗口实际原咨询及可读范围。')
  const suffixes = ['entity-contract', partition.oracleSuffix,
    ...selection.templateKeys.map(key => partition.templates.find(t => t.templateKey === key)?.suffix),
    ...selection.placementRefs.map(key => partition.placements.find(p => p.entityKey === key)?.suffix)]
  if (suffixes.some(s => !s)) throw new Error('实体模板或地点/持有人未获本次范围授权。')
  const rows = inventory.filter(row => row.sourceKey === TTRPG_OPEN_ENTITY_SOURCE_V1 && suffixes.some(suffix => row.resourceKey.endsWith(`:${suffix}`)))
  if (rows.length !== suffixes.length) throw new Error('实体提案资料缺少准确完整资源。')
  return rows.map(row => ({ ...row, priority: 'must-read' as const }))
}
async function entityRead(input: { scope: WorkspaceScope; sessionId: number; actorKey: string }) {
  if (input.actorKey !== 'gm') throw new Error('实体提案资料需要明确的受限主持视图。')
  await assertInstanceBinding(input.sessionId, input.scope)
  const initial = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
  const owner = initial?.openRun?.coordination.epochs.find(e => e.epochKey === initial.openRun!.coordination.activeEpochKey)?.viewerKey
  if (!owner) throw new Error('实体提案资料缺少原真人咨询窗口。')
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: owner } })
  const { runtime, state, content, authorization: auth } = loaded, run = runtime.openRun!
  const epoch = run.coordination.epochs.find(e => e.epochKey === run.coordination.activeEpochKey)
  const host = epoch && auth.seats.find(s => s.viewerKey === epoch.viewerKey)
  if (!epoch || !host || host.viewerKey !== owner || !loaded.humanHost || !host.consent.sessionLoggingAllowed
    || !content.campaign.runtimePolicy.enabled || runtime.product.safety.status !== 'active'
    || host.controller === 'ai' || host.assignmentState !== 'claimed' || isTtrpgOpenPassiveEpochV1(epoch)
    || !auth.seats.some(s => s.role === 'gm' && s.consent.aiAdviceAllowed && s.consent.aiIdentityDisclosed)
    || run.stage.status !== 'open' || epoch.manualAction || epoch.hostingDelegation && !epoch.hostingDelegation.stoppedRef
    || run.entityOperations?.some(o => !o.resolution) || run.operations.some(o => ['awaiting-approval', 'executing'].includes(o.status))
    || runtime.branchLineage?.recoveryTasks.some(t => !['completed', 'withdrawn'].includes(t.status))) throw new Error('当前没有可用于实体提案的原真人咨询窗口。')
  // Human-host identity is checked independently; GM model POV is not a human permission.
  if (epoch.authorizationHash !== await hash(auth)
    || epoch.sessionZeroRevision !== auth.revision) throw new TtrpgOpenReadConflictV1('实体提案的原主持或资料已变化。')
  await verifyTtrpgOpenOracleJournalV1({ receipts: run.oracleReceipts ?? [], rulePack: content.rulePack.content,
    sessionKey: runtime.sessionKey, seed: loaded.session.seed, ancestors: runtime.branchLineage?.ancestors ?? [] })
  const gm = host.role === 'gm', selected = [...auth.selectedActorKeys].sort(), scopes: TtrpgOpenEntityProposalScopeV1[] = []
  const scope = async (audience: TtrpgOpenEntityProposalScopeV1['audience'], recipients: string[]) => {
    const recipientActorKeys = [...new Set(recipients)].sort()
    if (audience === 'private' && (!recipientActorKeys.length || !gm && !recipientActorKeys.includes(host.actorKey!))) return
    if (['party', 'private'].includes(audience) && recipientActorKeys.some(actor => !auth.seats.find(s => s.actorKey === actor)?.consent.sessionLoggingAllowed)) return
    const scopeKey = 'entity-scope.' + (await hash({ audience, recipientActorKeys })).slice(0, 40)
    if (!scopes.some(s => s.scopeKey === scopeKey)) scopes.push({ scopeKey, audience, recipientActorKeys })
  }
  await scope('public', []); await scope('party', selected)
  for (const actorKey of gm ? selected : [host.actorKey!]) await scope('private', [actorKey])
  for (const template of content.campaign.dynamicEntityTemplates) if (template.knownByActorKeys.length
    && visible(template.audience, template.knownByActorKeys, host.actorKey, gm, false)) {
    await scope('private', template.knownByActorKeys.filter(k => selected.includes(k)))
  }
  if (gm) await scope('gm-only', [])
  const catalog = ttrpgOpenEntityIdentityCatalogV1(content, run.entityOperations ?? [])
  const allowed = (audience: 'public' | 'party' | 'private' | 'gm-only', recipients: string[], partition: TtrpgOpenEntityProposalScopeV1, dynamic: boolean) =>
    partition.audience === 'gm-only' ? gm : partition.audience === 'public' ? audience === 'public'
      : partition.recipientActorKeys.every(actor => visible(audience, recipients, actor, false, dynamic))
  const contract = { schema: 'storyforge.ttrpg-open-entity-source-contract', version: 1, sourceKey: TTRPG_OPEN_ENTITY_SOURCE_V1,
    output: { rootFields: ['proposals'], proposalFields: ['templateKey', 'name', 'description', 'parameters', 'locationRef', 'ownerRef'], maximumProposals: 3 },
    exactOriginalOracleAndSingleScopeRequired: true, fullTemplateAndPlacementReadsRequired: true, noForwardReferences: true,
    templatesAreDefinitionsNotInstances: true, placementReferencesAreExistingInstances: true,
    scopeIsRecipientCeilingForEveryProposedItem: true, noEntityIdsOrMechanicalOverrides: true,
    initialEquipmentConsumesOracleQuota: true, outputIsCandidate: true, humanApprovalRequired: true,
    noModelCallAuthority: true, noEntityCreationAuthority: true, noKnowledgeGrant: true, noWorldWrite: true }
  const resources: Resource[] = [{ suffix: 'entity-contract', title: '实体提案的格式与权威边界', mandatory: true, value: contract }]
  const directory: Array<{ sourceRef: { sessionKey: string; sequence: number }; scope: TtrpgOpenEntityProposalScopeV1;
    oracleSuffix: string; templates: Array<{ templateKey: string; suffix: string }>; placements: Array<{ entityKey: string; suffix: string }> }> = []
  for (const oracle of run.oracleReceipts ?? []) {
    if (oracle.sourceRef.sessionKey !== runtime.sessionKey || oracle.viewerKey !== host.viewerKey || oracle.authorizationEpochKey !== epoch.epochKey) continue
    const table = content.rulePack.content.oracles.find(t => t.oracleKey === oracle.resolution.outcome.oracleKey)!
    const used = (run.entityOperations ?? []).filter(o => o.resolution?.kind === 'materialized' && canonicalStringify(o.plan.oracleSourceRef) === canonicalStringify(oracle.sourceRef))
      .reduce((n, o) => n + countTtrpgOpenEntityInstancesV1(content, o.plan.items.map(i => i.proposal)), 0)
    const remaining = table.interpretation.maxNewEntities - used
    if (remaining <= 0) continue
    for (const partition of scopes) {
      if (oracle.audience === 'gm-only' && partition.audience !== 'gm-only' || oracle.audience !== 'public' && partition.audience === 'public') continue
      const tag = (await hash({ sourceRef: oracle.sourceRef, scopeKey: partition.scopeKey })).slice(0, 40)
      const shared = { oracleSourceRef: oracle.sourceRef, scope: partition }
      const templates = [], placements = []
      for (const template of content.campaign.dynamicEntityTemplates) {
        const priorCount = (run.entityOperations ?? []).filter(o => o.resolution?.kind === 'materialized').flatMap(o => o.plan.items)
          .filter(i => i.proposal.templateKey === template.templateKey).length
        const instanceCost = countTtrpgOpenEntityInstancesV1(content, [{ templateKey: template.templateKey, name: 'preview', description: 'preview', parameters: {}, locationRef: null, ownerRef: null }])
        if (priorCount >= template.maximumInstances || instanceCost > remaining || !visible(template.audience, template.knownByActorKeys, host.actorKey, gm, false)
          || !allowed(template.audience, template.knownByActorKeys, partition, false)) continue
        const suffix = `entity-template.${tag}.${(await hash(template.templateKey)).slice(0, 32)}`
        templates.push({ templateKey: template.templateKey, suffix })
        resources.push({ suffix, title: '本次范围内的冻结实体模板', mandatory: false, value: {
          schema: 'storyforge.ttrpg-open-entity-template-input', version: 1, ...shared,
          templateKey: template.templateKey, kind: template.kind, description: template.description,
          maximumNameLength: template.maximumNameLength, remainingInstances: template.maximumInstances - priorCount,
          parameters: template.parameters, instanceCost, templateHash: await hash(template) } })
      }
      if (!templates.length) continue
      for (const identity of catalog) {
        if (identity.kind === 'item' || state.entities[identity.entityKey]?.lifecycleStatus !== 'active'
          || !visible(identity.audience, identity.recipientActorKeys, host.actorKey, gm, identity.dynamic)
          || !allowed(identity.audience, identity.recipientActorKeys, partition, identity.dynamic)
          || identity.kind === 'actor' && content.campaign.characterTemplates.some(c => c.characterKey === identity.entityKey && c.role === 'player')
            && (!selected.includes(identity.entityKey) || partition.audience !== 'public' && !partition.recipientActorKeys.includes(identity.entityKey))) continue
        const suffix = `entity-placement.${tag}.${(await hash(identity.entityKey)).slice(0, 32)}`
        placements.push({ entityKey: identity.entityKey, suffix })
        resources.push({ suffix, title: '本次范围内的合法地点或库存持有人', mandatory: false, value: {
          schema: 'storyforge.ttrpg-open-entity-placement-input', version: 1, ...shared,
          entityRef: identity.entityKey, kind: identity.kind, name: state.entities[identity.entityKey].name,
          use: identity.kind === 'actor' ? 'inventory-owner' : 'location', origin: identity.sourceRef } })
      }
      const oracleSuffix = `entity-oracle.${tag}`, raw = oracle.resolution.outcome.rawResult
      resources.push({ suffix: oracleSuffix, title: '本次范围内的原咨询与创建上限', mandatory: false, value: {
        schema: 'storyforge.ttrpg-open-entity-oracle-input', version: 1, ...shared,
        question: oracle.resolution.outcome.question, rawResult: raw,
        selectedEntryText: typeof raw === 'string' ? null : table.entries?.find(e => e.entryKey === raw.entryKey)?.text ?? null,
        remainingInstances: remaining, mustRespect: table.interpretation.mustRespect, forbiddenScopes: table.interpretation.forbiddenScopes,
        authorizationEpochKey: epoch.epochKey } })
      directory.push({ sourceRef: oracle.sourceRef, scope: partition, oracleSuffix, templates, placements })
    }
  }
  await loaded.assertCurrent()
  return { loaded, context: { resources, directory, epochInputRevision: epoch.inputRevision, visibilityHash: await hash(resources),
    admissionStateHash: await ttrpgOpenMechanicalStateHashV1(state),
    readEvidence: { sequence: state.lastSequence, stateHash: loaded.stateHash, runtimeSourceHash: loaded.source.runtimeSourceHash } } }
}

export function createTtrpgOpenEntityContextProviderV1() {
  return createTtrpgOpenRuntimeResourceProviderV1({ sourceKey: TTRPG_OPEN_ENTITY_SOURCE_V1,
    providerVersion: 'ttrpg-open-entity-provider-v1', normalizationVersion: 'ttrpg-open-entity-json-v1', kinds: ['fact', 'reference'],
    catalog: entityCatalog, assertAccess: async (scope, fingerprint) => {
      if ((await entityCatalog(scope)).fingerprint !== fingerprint) throw new TtrpgOpenReadConflictV1('实体提案资料的权限、来源或进度已变化。')
    } })
}
async function entityCatalog(scope: FrozenResourceScopeV1) {
  if (!scope.productRuntimeSessionId || !scope.worldId || !scope.workId || scope.runtimeActorKey !== 'gm') throw new Error('实体提案资料需要准确团局及受限主持视图。')
  try {
    const { loaded, context } = await entityRead({ scope: { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId }, sessionId: scope.productRuntimeSessionId, actorKey: 'gm' })
    const policyHash = await hash({ sourceKey: TTRPG_OPEN_ENTITY_SOURCE_V1, singleOracleAndScope: true, fullIsAtomic: true, originalRead: false })
    const refs: ContextResourceDescriptorV1['sourceRefs'] = [
      { table: loaded.immutable.table, recordId: loaded.immutable.recordId, field: loaded.immutable.field, revision: loaded.source.packageHash, contentHash: await sha256Text(loaded.immutable.raw!) },
      { table: 'productRuntimeSessions', recordId: scope.productRuntimeSessionId, field: 'runtimeHeadStateJson', revision: loaded.state.lastSequence, contentHash: loaded.stateHash }]
    const resources: TtrpgOpenResourceRowV1[] = await Promise.all(context.resources.map(async item => {
      const content = canonicalStringify(item.value), tokenCount = estimateTokens(content)
      return { content, tokenCount, searchText: item.title, descriptor: { version: 1, resourceKey: `fact:ttrpg-open:${loaded.runtime.sessionKey}:gm:${item.suffix}`,
        sourceKey: TTRPG_OPEN_ENTITY_SOURCE_V1, kind: item.mandatory ? 'fact' : 'reference', title: item.title,
        shortSummary: item.title, authority: item.suffix.startsWith('entity-template.') ? 'author-canon' : 'confirmed-evidence',
        contentRevision: loaded.state.lastSequence, contentHash: await sha256Text(content),
        policyRevision: 1, policyHash, scope: { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
          productRuntimeSessionId: scope.productRuntimeSessionId, runtimeActorKey: 'gm' },
        relations: [], sourceRefs: refs, tokenEstimate: { full: tokenCount }, availableDepths: ['full'],
        priority: item.mandatory ? 'must-read' : 'normal' } }
    }))
    await loaded.assertCurrent()
    return { fingerprint: await hash({ scope, evidence: context.readEvidence, visibilityHash: context.visibilityHash }), resources }
  } catch (cause) {
    if (cause instanceof TtrpgOpenReadConflictV1) throw new TtrpgOpenReadConflictV1('实体提案资料的权限、来源或进度已变化。')
    throw new Error('当前实体提案资料不可读取，请核对本桌授权与原咨询。')
  }
}
