import { TTRPG_OPEN_ORACLE_INSTANCE_INPUT_V1 } from '../../src/lib/ttrpg/open-coordination'
import { createTtrpgOpenOracleRuntimeReferencePolicyV1 } from '../../src/lib/ttrpg/open-runtime-entity-references'
/** Real F13/Oracle engineering fixture; does not itself grant a model scope. */
import { setupOpenEntityPlanningV1 } from './open-entity-runtime'
import { openEnvelopeV1 } from './open-ttrpg-session'
import { createCompleteTtrpgCharacterSheetV2 } from '../../src/lib/ttrpg/character-sheet'
import { closeTtrpgOpenEntityDeskV1, readTtrpgOpenEntityDeskV1, proposeTtrpgOpenEntityDeskV1, confirmTtrpgOpenEntityDeskV1, materializeTtrpgOpenEntityDeskV1 } from '../../src/lib/ttrpg/open-entity-desk'
import { startTtrpgOpenEpochV1, consultTtrpgOracleV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'

export async function setupOracleRuntimePolicyV1(audience: 'public' | 'party' | 'gm-only', pending = false, options: { aiEnabled?: boolean; configure?: Parameters<typeof setupOpenEntityPlanningV1>[0]; selectedCharacterKeys?: string[] } = {}) {
  const s = await setupOpenEntityPlanningV1(pkg => {
    const c = pkg.ttrpg!.campaign, rule = pkg.ttrpg!.rulePack.content, npc = c.characterTemplates.find(row => row.characterKey === 'keeper')!, item = rule.items[0]
    c.gmMode = 'human'; rule.oracles[0].audience = 'public'
    if (options.aiEnabled) { c.runtimePolicy.enabled = true; c.runtimePolicy.maximumEpochTokens = 50000 }
    rule.oracles.push({ ...structuredClone(rule.oracles[0]), oracleKey: 'oracle.reference.scope', audience })
    c.dynamicEntityTemplates[0].audience = audience === 'public' ? 'public' : 'party'
    c.dynamicEntityTemplates[1].audience = 'private'; c.dynamicEntityTemplates[1].knownByActorKeys = ['hero']
    npc.gmProfile!.secret = 'ORACLE-POLICY-PRIVATE-PROFILE'; npc.itemKeys = [item.key]
    npc.characterSheet = createCompleteTtrpgCharacterSheetV2({ template: npc, rulePack: rule })
    c.entityBindings.find(row => row.bindingKey === 'keeper')!.initialInventoryRefs = ['keeper.initial.gear']
    c.entityBindings.push({ bindingKey: 'keeper.initial.gear', templateKey: item.key, kind: 'item', initialLocationRef: null,
      initialInventoryRefs: [], sourceResourceRef: null, sourceFieldRefs: [], audience: 'party', knownByActorKeys: [] })
    options.configure?.(pkg)
  }, 'viewer.gm', options.selectedCharacterKeys)
  const desk = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: 'viewer.gm' }
  const create = async (oracleSourceRef = s.input.oracleSourceRef, again = false) => {
    await proposeTtrpgOpenEntityDeskV1({ ...desk, submissionKey: again ? 'oracle.policy.second' : 'oracle.policy.first', oracleSourceRef,
      proposals: again ? [{ ...s.proposals[0], name: '稍后才出现的角色' }] : s.proposals.slice(0, 2) })
    if (pending) return
    const plan = (await readTtrpgOpenEntityDeskV1(desk))!.pending!
    for (const row of plan.approvals) await confirmTtrpgOpenEntityDeskV1({ ...desk, operationKey: plan.operationKey, planHash: plan.planHash,
      actorKey: row.actorKey, decision: 'approve', review: 'reviewed-this-plan' })
    await materializeTtrpgOpenEntityDeskV1({ ...desk, operationKey: plan.operationKey, planHash: plan.planHash, decision: 'create-this-confirmed-plan' })
  }
  await create()
  if (!pending) await consultTtrpgOracleV1({ ...await openEnvelopeV1(s.f.sessionId, 'oracle.policy.original.consultation'), viewerKey: 'viewer.gm', askedBy: 'gm',
    oracleKey: 'oracle.reference.scope', question: '依据现有对象解释本次关系，但不改变规则状态。' })
  const state = await readProductRuntimeState(s.f.sessionId), run = state.ttrpg!.openRun!
  const input = { content: s.input.content, operations: run.entityOperations ?? [], runtimeSourceHash: s.f.session.runtimeSourceHash,
    oracle: run.oracleReceipts!.at(-1)!, recipientActorKeys: state.ttrpg!.authorization!.selectedActorKeys,
    consumerRef: { sessionKey: state.ttrpg!.sessionKey, sequence: state.lastSequence + 1 } }
  return { ...s, state, create, input, assertion: { ...input, rulePackContentHash: s.input.content.rulePack.contentHash } }
}

export async function setupOracleRuntimeDeskV1(audience: 'public' | 'party' | 'gm-only' = 'gm-only', configure?: Parameters<typeof setupOpenEntityPlanningV1>[0], options: { selectedCharacterKeys?: string[] } = {}) {
  const s = await setupOracleRuntimePolicyV1(audience, false, { aiEnabled: true, configure, ...options })
  const owner = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: 'viewer.gm' }
  await closeTtrpgOpenEntityDeskV1({ ...owner, submissionKey: 'oracle.model.end.original.consultation' })
  const npc = s.state.ttrpg!.openRun!.entityOperations![0].plan.items.find(row => row.kind === 'actor')!.entityKey
  const place = s.state.ttrpg!.openRun!.entityOperations![0].plan.items.find(row => row.kind === 'location')!.entityKey
  const fact = { kind: 'relation' as const, subjectRef: npc, predicateKey: 'knows' as const, objectRef: audience === 'gm-only' ? place : 'harbor', canonicalValue: true,
    detail: '原模型候选提出该 NPC 了解对应地点，尚须真人确认。', sourceFactRefs: ['fact.harbor'], audience,
    knownByActorKeys: audience === 'party' ? s.input.recipientActorKeys : [], supersedes: null, supersedeReason: null }
  return { ...s, owner, npc, place, fact }
}
export async function setupOracleRuntimeModelV1(audience: 'public' | 'party' | 'gm-only' = 'gm-only', configure?: Parameters<typeof setupOpenEntityPlanningV1>[0],
  beforeWindow?: (s: Awaited<ReturnType<typeof setupOracleRuntimePolicyV1>>) => Promise<void>, options: { selectedCharacterKeys?: string[] } = {}) {
  const rawInput = TTRPG_OPEN_ORACLE_INSTANCE_INPUT_V1, s = await setupOracleRuntimeDeskV1(audience, configure, options)
  await beforeWindow?.(s)
  const before = await readProductRuntimeState(s.f.sessionId)
  const policy = await createTtrpgOpenOracleRuntimeReferencePolicyV1({ ...s.input, consumerRef: { sessionKey: before.ttrpg!.sessionKey, sequence: before.lastSequence + 1 } })
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(s.f.sessionId, 'oracle.model.start'), viewerKey: s.owner.viewerKey,
    triggerKind: 'continue-host', rawInput, oracleRuntimeReferencePolicy: policy })
  const input = { ...await openEnvelopeV1(s.f.sessionId, 'oracle.model.reserve'), ...s.owner, rawInput, oracleSourceRef: s.input.oracle.sourceRef,
    referencePolicy: 'recorded-oracle-instances-v1' as const, maximumOutputTokens: 1000, maximumCostUsd: 0.2 }
  return { ...s, before, policy, input, resume: (p: { runId: number; requestKey: string }) => ({ ...s.owner, ...p }) }
}
