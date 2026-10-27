import { ttrpgOpenSituationCatalogV1, ttrpgOpenSituationRuntimeReferenceCatalogV1 } from './open-session-situation-catalog'
/** P9 deterministic human-GM preflight. This is not a registered model source, a Run or an acceptance command. */
import type { WorkspaceScope } from '../types'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { verifyTtrpgOpenFactLedger, ttrpgOpenSessionFactsV1 } from './open-fact-ledger'
import { verifyTtrpgOpenOracleJournalV1 } from './open-oracle-contract'
import { ttrpgOpenMechanicalStateHashV1 } from './open-rule-plan'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import { reviewTtrpgOpenGeneratedSituationProposalV1, type TtrpgOpenSituationProposalBasisV1, type TtrpgOpenSituationPersonalizationSourceV1 } from './open-generated-situation-contract'
import * as p from './open-contract-parse'
import { assertTtrpgOpenRuntimeEntityReferencesMatchV1, assertTtrpgOpenSituationRuntimeReferenceJournalV1,
  type TtrpgOpenSituationRuntimeReferencePolicyV1 } from './open-runtime-entity-references'

export interface TtrpgOpenSituationPreflightInputV1 { scope: WorkspaceScope; sessionId: number; viewerKey: string; proposalKey: string }
export async function loadTtrpgOpenSituationProposalBasisV1(input: TtrpgOpenSituationPreflightInputV1) {
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  if (!loaded.humanHost || loaded.seat?.role !== 'gm' || loaded.seat.controller === 'ai') throw new Error('局势私域预检需要当前已认领的真人 GM；兼任主持不取得 GM 资料。')
  return buildTtrpgOpenSituationBasisFromVerifiedReadV1(loaded, input.proposalKey)
}
/** Internal builder: the caller must first enforce its exact human or model consumer authority. */
export async function buildTtrpgOpenSituationBasisFromVerifiedReadV1(loaded: Awaited<ReturnType<typeof loadTtrpgOpenMemoryReadStateV1>>, inputProposalKey: string,
  explicitReferencePolicy?: TtrpgOpenSituationRuntimeReferencePolicyV1) {
  const { content, runtime, authorization, source } = loaded, run = runtime.openRun!, ancestors = runtime.branchLineage?.ancestors ?? []
  if (authorization.seats.some(s => !s.consent.sessionLoggingAllowed)) throw new Error('本桌尚未同意保存生成局势所需的来源记录。')
  if (run.stage.status !== 'open' || runtime.product.safety.status !== 'active') throw new Error('局势预检需要阶段进行中且本桌未暂停。')
  await verifyTtrpgOpenOracleJournalV1({ receipts: run.oracleReceipts ?? [], rulePack: content.rulePack.content, sessionKey: runtime.sessionKey, seed: loaded.session.seed, ancestors })
  await verifyTtrpgOpenFactLedger({ ledger: run.factLedger, content, runtimeSourceHash: source.runtimeSourceHash, oracleReceipts: run.oracleReceipts ?? [], entityOperations: run.entityOperations, storyFacts: runtime.product.effectLedger.storyFacts })
  const sessionFacts = ttrpgOpenSessionFactsV1(run.factLedger).filter(f => !f.retired)
  const referencePolicy = explicitReferencePolicy ?? run.coordination.epochs.find(e => e.epochKey === inputProposalKey)?.runtimeEntityReferencePolicy
  if (referencePolicy) {
    assertTtrpgOpenSituationRuntimeReferenceJournalV1({ policy: referencePolicy, operations: run.entityOperations ?? [],
      recipientActorKeys: authorization.selectedActorKeys, rulePackContentHash: runtime.product.rulePackContentHash,
      consumerRef: { sessionKey: runtime.sessionKey, sequence: loaded.state.lastSequence + 1 } })
    await assertTtrpgOpenRuntimeEntityReferencesMatchV1({ content, operations: run.entityOperations ?? [], runtimeSourceHash: source.runtimeSourceHash,
      snapshot: referencePolicy.references, mode: 'current', ...(referencePolicy.consumer === 'common-party' ? { entityRefs: referencePolicy.references.references.map(row => row.entityRef) } : {}) })
  }
  const selected = new Set(authorization.selectedActorKeys), personalizationSources: TtrpgOpenSituationPersonalizationSourceV1[] = []
  const personalizationValues: Array<{ sourceKey: string; value: unknown }> = []
  for (const actorKey of authorization.selectedActorKeys) {
    const actor = content.campaign.characterTemplates.find(a => a.characterKey === actorKey && a.role === 'player') ?? p.fail('个性化身份缺少冻结玩家模板')
    // Public authored identity is not a new objective fact or a player commitment.
    const value = { runtimeSourceHash: source.runtimeSourceHash, actorKey, name: actor.name, description: actor.description }
    const contentHash = await hash(value), sourceKey = `identity.${contentHash.slice(0, 48)}`
    personalizationSources.push({ sourceKey, kind: 'identity', actorKeys: [actorKey], knownByActorKeys: [actorKey], sourceRef: null, contentHash })
    personalizationValues.push({ sourceKey, value })
  }
  const origins = [...ancestors.map(a => ({ sessionKey: a.sessionKey, run: a.snapshot.openRun })), { sessionKey: runtime.sessionKey, run }]
  for (const origin of origins) for (const operation of origin.run?.operations ?? []) {
    const actorKey = operation.plan.request.actorKey
    if (!selected.has(actorKey) || operation.inheritance || operation.status !== 'completed' || operation.plan.request.controllerMode !== 'human') continue
    const approved = operation.approvals.find(a => a.actorKey === actorKey && a.decision === 'approve')
    if (!approved) continue
    const contentHash = await hash({ sourceRef: approved.sourceRef, actorKey, planHash: operation.planHash, riskHash: operation.riskHash, decision: approved.decision })
    const sourceKey = `choice.${contentHash.slice(0, 48)}`
    if (!personalizationSources.some(s => s.sourceKey === sourceKey)) {
      personalizationSources.push({ sourceKey, kind: 'choice', actorKeys: [actorKey], knownByActorKeys: [actorKey], sourceRef: approved.sourceRef, contentHash })
      personalizationValues.push({ sourceKey, value: { approval: { sourceRef: approved.sourceRef, actorKey, planHash: operation.planHash, riskHash: operation.riskHash, decision: approved.decision },
        request: structuredClone(operation.plan.request), status: 'completed', grantsPlayerCommitment: false } })
    }
  }
  const catalog = ttrpgOpenSituationCatalogV1(content.campaign, run)
  const historicalRuntimeEntityReferences = ttrpgOpenSituationRuntimeReferenceCatalogV1(run.situationReceipts ?? [])
  const rows = [...(run.situations.history ?? []).map(h => h.instance), ...run.situations.active, ...run.situations.queued]
  const originByInstance = new Map<string, string>()
  for (const origin of origins) for (const instance of [...(origin.run?.situations.history ?? []).map(h => h.instance), ...(origin.run?.situations.active ?? []), ...(origin.run?.situations.queued ?? [])]) {
    if (!originByInstance.has(instance.situationKey)) originByInstance.set(instance.situationKey, origin.sessionKey)
  }
  const history: TtrpgOpenSituationProposalBasisV1['history'] = []
  for (const instance of rows) {
    if (history.some(h => h.situationKey === instance.situationKey)) continue
    const originSessionKey = originByInstance.get(instance.situationKey) ?? p.fail('局势历史缺少实际来源分支')
    const template = catalog.byKey.get(instance.templateKey) ?? p.fail('局势历史缺少原冻结或已采用模板')
    history.push({ template: structuredClone(template), status: 'accepted', sourceRef: { sessionKey: originSessionKey, sequence: instance.activatedAtSequence }, situationKey: instance.situationKey })
  }
  // Until a definition has a real instance, its actual acceptance is still recent generation history.
  // Once instantiated, retain the original activation history only, without double-counting the definition.
  for (const receipt of run.situationReceipts ?? []) if (!rows.some(i => i.templateKey === receipt.template.templateKey)) {
    history.push({ template: structuredClone(receipt.template), status: 'accepted', sourceRef: receipt.sourceRef,
      situationKey: receipt.template.templateKey, sourceKind: 'adopted-definition' })
  }
  const order = origins.map(o => o.sessionKey)
  history.sort((a, b) => order.indexOf(a.sourceRef.sessionKey) - order.indexOf(b.sourceRef.sessionKey) || a.sourceRef.sequence - b.sourceRef.sequence || a.situationKey.localeCompare(b.situationKey))
  const proposalKey = p.key(inputProposalKey, 'system proposal key')
  const basis: TtrpgOpenSituationProposalBasisV1 = {
    runtimeSourceHash: source.runtimeSourceHash, worldReleaseHash: content.campaign.sourceWorld.contentHash,
    sourceLineageHash: await hash({ sessionKey: runtime.sessionKey, runtimeSourceHash: source.runtimeSourceHash, ancestors: ancestors.map(a => a.evidenceHash) }),
    sessionKey: runtime.sessionKey, assignedTemplateKey: `generated.${(await hash({ sessionKey: runtime.sessionKey, proposalKey })).slice(0, 40)}`,
    selectedActorKeys: [...authorization.selectedActorKeys], worldTurn: run.worldTime.worldTurn,
    authorizationHash: await hash(authorization), mechanicalStateHash: await ttrpgOpenMechanicalStateHashV1(loaded.state),
    campaign: structuredClone(content.campaign), rule: structuredClone(content.rulePack.content), sessionFacts,
    ...(referencePolicy ? { runtimeEntityReferences: structuredClone(referencePolicy.references) } : {}),
    ...(historicalRuntimeEntityReferences.length ? { historicalRuntimeEntityReferences: structuredClone(historicalRuntimeEntityReferences) } : {}),
    ...(catalog.sessionTemplates.length && ttrpgOpenSessionFactsV1(run.factLedger).some(f => f.retired) ? { retiredSessionFacts: ttrpgOpenSessionFactsV1(run.factLedger).filter(f => f.retired) } : {}), sessionTemplates: structuredClone(catalog.sessionTemplates), history,
    cooldownUntilWorldTurn: { ...run.situations.cooldowns }, personalizationSources,
  }
  await loaded.assertCurrent()
  return { basis, personalizationValues, readEvidence: { sequence: loaded.state.lastSequence, stateHash: loaded.stateHash, runtimeSourceHash: source.runtimeSourceHash }, assertCurrent: loaded.assertCurrent }
}
export async function preflightTtrpgOpenGeneratedSituationV1(input: TtrpgOpenSituationPreflightInputV1 & { value: unknown }) {
  const loaded = await loadTtrpgOpenSituationProposalBasisV1(input)
  const review = await reviewTtrpgOpenGeneratedSituationProposalV1({ value: input.value, basis: loaded.basis })
  await loaded.assertCurrent()
  return review
}
