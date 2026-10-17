import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readProductRuntimeState, readProductRuntimeStateVersion, branchProductRuntimeSession, parseProductRuntimeState, replayProductRuntimeEvents, applyProductRuntimeEvent, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from '../../src/lib/ttrpg/open-runtime-contract'
import { consultTtrpgOracleV1, startTtrpgOpenEpochV1, closeTtrpgOpenEpochV1, completeTtrpgOpenSessionZeroV1, changeTtrpgSafetyStatus, startTtrpgOpenOperationV1, confirmTtrpgOpenOperationV1, ttrpgOpenOperationCommandIdV1 } from '../../src/lib/ttrpg/runtime-commands'
import { resumeTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/open-operation-coordinator'
import { verifyTtrpgOracleOutcomeV1 } from '../../src/lib/ttrpg/oracle'
import { openEnvelopeV1, readyOpenTtrpgSessionV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { loadTtrpgOpenPlayerContextV1 } from '../../src/lib/ttrpg/open-player-context'
import { TTRPG_OPEN_ORACLE_HISTORY_PROVIDER_V1 } from '../../src/lib/ttrpg/open-context-provider'
import { createContextGatewayToolSessionV1 } from '../../src/lib/context-gateway/tool-session'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { verifyTtrpgOpenOracleJournalV1 } from '../../src/lib/ttrpg/open-oracle-contract'

const rt = (state: Awaited<ReturnType<typeof readProductRuntimeState>>) => parseTtrpgRuntimeStateV2(state.ttrpg)!
async function setup(configure?: Parameters<typeof readyOpenTtrpgSessionV1>[1]) {
  const fixture = await readyOpenTtrpgSessionV1('oracle runtime', configure)
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'epoch'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'submit-action', rawInput: '问问命运' })
  return fixture
}
async function ask(sessionId: number, commandId: string) {
  return { ...await openEnvelopeV1(sessionId, commandId), viewerKey: OPEN_HUMAN_VIEWER, askedBy: 'player:hero' as const,
    oracleKey: 'oracle.yes', question: '码头今天会下雨吗？', likelihoodTierKey: 'even' }
}
describe('R-TTRPGOPEN2 real Oracle events and frozen consultations', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('returns the original command receipt and retains two distinct rolls without changing time or mechanics', async () => {
    const fixture = await setup(), before = await readProductRuntimeState(fixture.sessionId)
    const input = await ask(fixture.sessionId, 'oracle.one')
    const first = await consultTtrpgOracleV1(input)
    expect(await consultTtrpgOracleV1(input)).toEqual(first)
    await expect(consultTtrpgOracleV1({ ...input, question: '偷偷换一个问题' })).rejects.toThrow(/不同命令/)
    await consultTtrpgOracleV1(await ask(fixture.sessionId, 'oracle.two'))
    const state = await readProductRuntimeState(fixture.sessionId), run = rt(state).openRun!
    expect(state.entities).toEqual(before.entities)
    expect(run.worldTime).toEqual(rt(before).openRun!.worldTime)
    expect(run.chaos).toEqual(rt(before).openRun!.chaos)
    expect(run.consultedThisWorldTurn).toBe(2)
    expect(run.oracleReceipts).toHaveLength(2)
    expect(run.oracleReceipts![1].previousOracleRef).toEqual(run.oracleReceipts![0].sourceRef)
    for (const receipt of run.oracleReceipts!) expect(await verifyTtrpgOracleOutcomeV1({ rulePack: receipt.frozenRulePack,
      seed: fixture.session.seed, ...receipt.resolution })).toBe(true)
    await expect(consultTtrpgOracleV1(await ask(fixture.sessionId, 'oracle.three'))).rejects.toThrow(/最多咨询两次/)
    const session = (await db.productRuntimeSessions.get(fixture.sessionId))!
    const events = await db.productRuntimeEvents.where('sessionId').equals(fixture.sessionId).sortBy('sequence')
    expect(replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events)).toEqual(state)
  })
  it('does not regain the same-turn quota by closing and reopening an epoch', async () => {
    const fixture = await setup()
    await consultTtrpgOracleV1(await ask(fixture.sessionId, 'one'))
    await consultTtrpgOracleV1(await ask(fixture.sessionId, 'two'))
    const epochKey = rt(await readProductRuntimeState(fixture.sessionId)).openRun!.coordination.activeEpochKey!
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'close'), viewerKey: OPEN_HUMAN_VIEWER, epochKey, reason: '玩家结束窗口' })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'reopen'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'continue-host', rawInput: '继续' })
    await expect(consultTtrpgOracleV1(await ask(fixture.sessionId, 'three'))).rejects.toThrow(/最多咨询两次/)
  })
  it('rejects unavailable tables/tiers, hidden GM results, impersonation and paused play before any event', async () => {
    const fixture = await setup(), before = await readProductRuntimeState(fixture.sessionId)
    const input = await ask(fixture.sessionId, 'bad')
    await expect(consultTtrpgOracleV1({ ...input, oracleKey: 'invented' })).rejects.toThrow(/冻结规则包/)
    await expect(consultTtrpgOracleV1({ ...input, likelihoodTierKey: 'invented' })).rejects.toThrow(/档位/)
    await expect(consultTtrpgOracleV1({ ...input, askedBy: 'player:companion.1' })).rejects.toThrow(/代替其他真人/)
    await expect(consultTtrpgOracleV1({ ...input, askedBy: 'gm' })).rejects.toThrow(/真人 GM/)
    expect(await readProductRuntimeState(fixture.sessionId)).toEqual(before)
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(fixture.sessionId, 'pause'), status: 'paused', viewerKey: OPEN_HUMAN_VIEWER, changedBy: OPEN_HUMAN_VIEWER, reason: '暂停' })
    await expect(consultTtrpgOracleV1(await ask(fixture.sessionId, 'paused'))).rejects.toThrow(/暂停/)
    const hidden = await setup(pkg => { pkg.ttrpg!.rulePack.content.oracles[0].audience = 'gm-only' })
    await expect(consultTtrpgOracleV1(await ask(hidden.sessionId, 'secret'))).rejects.toThrow(/受众不可读/)
  })
  it('retains qualified parent results and quota on a child, requires fresh consent, and adds a new result without rewriting its parent', async () => {
    const fixture = await setup()
    await consultTtrpgOracleV1(await ask(fixture.sessionId, 'parent.roll'))
    const parentBefore = await readProductRuntimeState(fixture.sessionId)
    const child = await branchProductRuntimeSession({ parentSessionId: fixture.sessionId,
      throughSequence: (await readProductRuntimeStateVersion(fixture.sessionId)).sequence, title: 'Oracle branch', seed: 'child.oracle.seed' })
    const childBefore = await readProductRuntimeState(child.id!)
    expect(rt(childBefore).openRun!.oracleReceipts).toEqual(rt(parentBefore).openRun!.oracleReceipts)
    await expect(consultTtrpgOracleV1(await ask(child.id!, 'unauthorized'))).rejects.toThrow(/Session Zero/)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'child.zero'), viewerKey: OPEN_HUMAN_VIEWER,
      acceptedItemKeys: rt(childBefore).product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(child.id!, 'child.epoch'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'continue-host', rawInput: '再问一次' })
    await consultTtrpgOracleV1(await ask(child.id!, 'child.roll'))
    const receipts = rt(await readProductRuntimeState(child.id!)).openRun!.oracleReceipts!
    expect(receipts[1].sourceRef.sessionKey).not.toBe(receipts[0].sourceRef.sessionKey)
    expect(receipts[1].previousOracleRef).toEqual(receipts[0].sourceRef)
    expect(await verifyTtrpgOracleOutcomeV1({ rulePack: receipts[0].frozenRulePack, seed: fixture.session.seed, ...receipts[0].resolution })).toBe(true)
    await expect(consultTtrpgOracleV1(await ask(child.id!, 'extra.roll'))).rejects.toThrow(/最多咨询两次/)
    expect(await readProductRuntimeState(fixture.sessionId)).toEqual(parentBefore)
    const tampered = structuredClone(await readProductRuntimeState(child.id!))
    rt(tampered) // ensure the untouched child parses first
    const journal = (tampered.ttrpg as ReturnType<typeof rt>).openRun!.oracleReceipts!
    journal[0].resolution.outcome.question = '改写父结果'
    expect(() => parseTtrpgRuntimeStateV2(tampered.ttrpg)).toThrow(/祖先|不闭合/)
    await deleteProductRuntimeSession(fixture.sessionId)
    expect(rt(await readProductRuntimeState(child.id!)).openRun!.oracleReceipts).toEqual(receipts)
  })
  it('blocks consultations during pending rule business and resets the quota only after causal game time', async () => {
    const fixture = await setup()
    await consultTtrpgOracleV1(await ask(fixture.sessionId, 'roll'))
    const rule = fixture.runtimePackage.ttrpg!.rulePack.content.actions[0]
    await startTtrpgOpenOperationV1({ ...await openEnvelopeV1(fixture.sessionId, 'action'), viewerKey: OPEN_HUMAN_VIEWER,
      request: { route: 'existing-action', ruleKey: rule.key, actorKey: 'hero', targetKey: rule.target === 'self' ? 'hero' : rule.target === 'scene' ? null : 'keeper', controllerMode: 'human', effectBindings: {} } })
    await expect(consultTtrpgOracleV1(await ask(fixture.sessionId, 'during.action'))).rejects.toThrow(/当前行动/)
    const operation = rt(await readProductRuntimeState(fixture.sessionId)).openRun!.operations[0]
    const approvalKey = await ttrpgOpenOperationCommandIdV1(rt(await readProductRuntimeState(fixture.sessionId)).sessionKey, operation.operationKey, 'approval.hero');
    await confirmTtrpgOpenOperationV1({ ...await openEnvelopeV1(fixture.sessionId, approvalKey), operationKey: operation.operationKey,
      frozenPlanHash: operation.planHash, viewerKey: OPEN_HUMAN_VIEWER, actorKey: 'hero', riskHash: operation.riskHash, decision: 'approve' })
    await resumeTtrpgOpenOperationV1({ sessionId: fixture.sessionId, operationKey: operation.operationKey, frozenPlanHash: operation.planHash, viewerKey: OPEN_HUMAN_VIEWER })
    const state = await readProductRuntimeState(fixture.sessionId)
    expect(rt(state).openRun!.worldTime.worldTurn).toBeGreaterThan(0)
    expect(rt(state).openRun!.consultedThisWorldTurn).toBe(0)
    expect(rt(state).openRun!.oracleReceipts).toHaveLength(1)
  })
  it('rejects a changed raw result during offline replay', async () => {
    const fixture = await setup(), before = await readProductRuntimeState(fixture.sessionId)
    const event = await consultTtrpgOracleV1(await ask(fixture.sessionId, 'roll'))
    const body = JSON.parse(event.payloadJson)
    body.receipt.resolution.outcome.rawResult = body.receipt.resolution.outcome.rawResult === 'yes' ? 'no' : 'yes'
    expect(() => applyProductRuntimeEvent(before, { ...event, payloadJson: JSON.stringify(body) })).toThrow(/原始结果/)
  })
  it('serves public history through the registered actor provider without exposing seed, proof or frozen GM tables', async () => {
    const fixture = await setup()
    await consultTtrpgOracleV1(await ask(fixture.sessionId, 'public.roll'))
    const scope = { ...fixture.scope, productRuntimeSessionId: fixture.sessionId, runtimeActorKey: 'companion.1' }
    const metadata = await TTRPG_OPEN_ORACLE_HISTORY_PROVIDER_V1.listMetadata({ scope, limit: 10 })
    expect(metadata.items).toHaveLength(2)
    const selected = metadata.items.find(item => item.resourceKey.endsWith('oracle.0'))!
    const body = await TTRPG_OPEN_ORACLE_HISTORY_PROVIDER_V1.read({ scope, resourceKey: selected.resourceKey, depth: 'full', maxTokens: 6000 })
    expect(JSON.parse(body.content).outcome.question).toBe('码头今天会下雨吗？')
    for (const forbidden of ['seedCommitment', 'proofHash', 'frozenRulePack', 'playerProfile', fixture.session.seed]) expect(body.content).not.toContain(forbidden)
    const policy = { version: 'context-access-policy-v1' as const, policyId: 'oracle-history-test',
      mandatorySourceKeys: ['ttrpgOpenOracleHistory'], allowedSourceKeys: ['ttrpgOpenOracleHistory'], allowedResourceKinds: ['fact' as const],
      allowedDepths: ['full' as const], selectorPolicyId: 'deterministic-v1', maxReadCalls: 3, maxRetrievedTokens: 6000,
      allowOriginalRead: false, candidateAccess: 'forbidden' as const }
    await expect(createContextGatewayToolSessionV1({ scope, policy })).rejects.toThrow(/allow-list/)
    expect((await createContextGatewayToolSessionV1({ scope, policy, allowedResourceKeys: metadata.items.map(item => item.resourceKey) })).resourceKeyAllowList!.size).toBe(2)
    await expect(TTRPG_OPEN_ORACLE_HISTORY_PROVIDER_V1.read({ scope, resourceKey: selected.resourceKey, depth: 'full', maxTokens: 1 })).rejects.toThrow(/预算/)
    await expect(TTRPG_OPEN_ORACLE_HISTORY_PROVIDER_V1.readOriginal({ scope, resourceKey: selected.resourceKey, sourceRef: selected.sourceRefs[0], maxTokens: 6000 })).rejects.toThrow(/原始/)
  })
  it('keeps a real GM-only consultation out of every player history', async () => {
    const fixture = await setup(pkg => { pkg.ttrpg!.campaign.gmMode = 'human'; pkg.ttrpg!.rulePack.content.oracles[0].audience = 'gm-only' })
    const epochKey = rt(await readProductRuntimeState(fixture.sessionId)).openRun!.coordination.activeEpochKey!
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'end.player'), viewerKey: OPEN_HUMAN_VIEWER, epochKey, reason: '主持人私密咨询' })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'gm.epoch'), viewerKey: 'viewer.gm', triggerKind: 'continue-host', rawInput: '私密咨询' })
    await consultTtrpgOracleV1({ ...await ask(fixture.sessionId, 'gm.roll'), viewerKey: 'viewer.gm', askedBy: 'gm', question: 'GM-PRIVATE-ORACLE-QUESTION' })
    expect(rt(await readProductRuntimeState(fixture.sessionId)).openRun!.oracleReceipts).toHaveLength(1)
    for (const actorKey of ['hero', 'companion.1', 'companion.2']) {
      const context = await loadTtrpgOpenPlayerContextV1({ scope: fixture.scope, sessionId: fixture.sessionId, actorKey })
      expect(context.view.oracleHistory).toEqual([])
      expect(JSON.stringify(context.view)).not.toContain('GM-PRIVATE-ORACLE-QUESTION')
      const metadata = await TTRPG_OPEN_ORACLE_HISTORY_PROVIDER_V1.listMetadata({ scope: { ...fixture.scope, productRuntimeSessionId: fixture.sessionId, runtimeActorKey: actorKey }, limit: 10 })
      expect(metadata.items).toHaveLength(1)
    }
  })
  it('preserves the exact consultation journal across project backup and scope remapping', async () => {
    const fixture = await setup()
    await consultTtrpgOracleV1(await ask(fixture.sessionId, 'portable.roll'))
    const before = rt(await readProductRuntimeState(fixture.sessionId)).openRun!.oracleReceipts
    const backup = await exportProjectJSON(fixture.scope.projectId)
    const importedProjectId = await importProjectJSON(backup)
    const imported = await db.productRuntimeSessions.where('projectId').equals(importedProjectId).first()
    expect(imported!.id).not.toBe(fixture.sessionId)
    expect(rt(await readProductRuntimeState(imported!.id!)).openRun!.oracleReceipts).toEqual(before)
    expect(rt(await readProductRuntimeState(fixture.sessionId)).openRun!.oracleReceipts).toEqual(before)
  })
  it('grants one persisted result to concurrent identical submissions and rejects altered cryptographic history', async () => {
    const fixture = await setup(), input = await ask(fixture.sessionId, 'concurrent.oracle')
    const results = await Promise.all([consultTtrpgOracleV1(input), consultTtrpgOracleV1(input)])
    expect(results[0]).toEqual(results[1])
    const runtime = rt(await readProductRuntimeState(fixture.sessionId)), receipts = runtime.openRun!.oracleReceipts!
    expect(receipts).toHaveLength(1)
    const verification = { receipts, rulePack: fixture.runtimePackage.ttrpg!.rulePack.content,
      seed: fixture.session.seed, sessionKey: runtime.sessionKey, ancestors: [] }
    await expect(verifyTtrpgOpenOracleJournalV1(verification)).resolves.toBeUndefined()
    await expect(verifyTtrpgOpenOracleJournalV1({ ...verification, seed: 'different.seed' })).rejects.toThrow(/复算证据/)
    const modified = structuredClone(receipts)
    modified[0].resolution.rollReceipt.diceResolution.proofHash = '0'.repeat(64)
    await expect(verifyTtrpgOpenOracleJournalV1({ ...verification, receipts: modified })).rejects.toThrow(/复算证据/)
  })
})
