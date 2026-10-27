import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupOracleRuntimeModelV1 } from '../helpers/open-oracle-runtime-model'
import { openContextPolicyFixtureV1 } from '../helpers/open-ttrpg-context'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { generateTtrpgOpenOracleCandidateV2 } from '../../src/lib/ttrpg/open-intent-harness'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { startTtrpgOpenEpochV1, closeTtrpgOpenEpochV1, startTtrpgOpenOperationV1, confirmTtrpgOpenOperationV1,
  changeTtrpgSituationV1, recordTtrpgOpenHumanNarrationV1, telegraphTtrpgOpenFrontV1 } from '../../src/lib/ttrpg/runtime-commands'
import { ttrpgOpenScopedKeyV1 } from '../../src/lib/ttrpg/open-coordination'
import { openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { resumeTtrpgOpenPlayV1 } from '../../src/lib/ttrpg/open-play-coordinator'
import { operationInput } from '../helpers/open-ttrpg-branch-recovery'

describe('R-TTRPGOPEN13 versioned Oracle guidance is filtered before metadata and actual delivery', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it.each(['public', 'party', 'gm-only'] as const)('keeps the actual %s Oracle audience in both registered sources and the formal request', async audience => {
    const s = await setupOracleRuntimeModelV1(audience, pkg => {
      const policy = openContextPolicyFixtureV1(), base = policy.triggers[0].trigger
      policy.triggers = [
        { key: 'public', audience: 'public' as const, knownByActorKeys: [], text: 'PUBLIC-ORACLE-GUIDANCE' },
        { key: 'party', audience: 'party' as const, knownByActorKeys: [], text: 'PARTY-ORACLE-GUIDANCE' },
        { key: 'gm', audience: 'gm-only' as const, knownByActorKeys: [], text: 'GM-ORACLE-GUIDANCE' },
        { key: 'gm.private', audience: 'private' as const, knownByActorKeys: ['gm'], text: 'GM-PRIVATE-ORACLE-GUIDANCE' },
        { key: 'hero.private', audience: 'private' as const, knownByActorKeys: ['hero'], text: 'HERO-PRIVATE-ORACLE-GUIDANCE' },
      ].map(row => ({ consumers: ['gm-assistant'], trigger: { ...base, triggerKey: row.key, audience: row.audience, knownByActorKeys: row.knownByActorKeys,
        logic: 'always', textPatterns: [], predicate: null, group: null, sourceRefs: [], injectText: row.text,
        timing: { stickyWorldTurns: 0, cooldownWorldTurns: 0, delayWorldTurns: 0 } } }))
      pkg.ttrpg!.campaign.contextPolicy = policy
    })
    const before = await readProductRuntimeState(s.f.sessionId)
    const provider = CONTEXT_SOURCE_BY_KEY.get('ttrpgOpenGmContext')!.resources!
    const scope = { ...s.f.scope, productRuntimeSessionId: s.f.sessionId, runtimeActorKey: 'gm' }
    const session = await provider.openReadSession!(scope), catalog = await session.provider.listMetadata({ scope, limit: 1000 })
    const bodies = await Promise.all(catalog.items.map(row => session.provider.read({ scope, resourceKey: row.resourceKey, depth: 'full', maxTokens: 16000 })))
    await session.assertCurrent()
    const canaryCheck = (text: string) => {
      expect(text).toContain('PUBLIC-ORACLE-GUIDANCE')
      expect(text.includes('PARTY-ORACLE-GUIDANCE')).toBe(audience !== 'public')
      expect(text.includes('GM-ORACLE-GUIDANCE')).toBe(audience === 'gm-only')
      expect(text.includes('GM-PRIVATE-ORACLE-GUIDANCE')).toBe(audience === 'gm-only')
      expect(text).not.toContain('HERO-PRIVATE-ORACLE-GUIDANCE')
    }
    canaryCheck(JSON.stringify(bodies))
    expect(catalog.items.filter(row => row.kind === 'reference')).toHaveLength(audience === 'public' ? 1 : audience === 'party' ? 2 : 4)
    expect(catalog.items.every(row => row.policyRevision === 2)).toBe(true)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    const runAI = vi.fn(async (messages: Array<{ content: string }>) => {
      canaryCheck(JSON.stringify(messages))
      return JSON.stringify({ interpretation: '资料范围内的原咨询解释。', facts: [s.fact] })
    })
    const result = await generateTtrpgOpenOracleCandidateV2({ ...s.input, runAI })
    expect(runAI).toHaveBeenCalledOnce()
    expect(result.prepared.evidence.contextSelection!.matchedTriggerKeys).toEqual(audience === 'public' ? ['public'] : audience === 'party' ? ['party', 'public'] : ['gm', 'gm.private', 'party', 'public'])
    expect(result.prepared.evidence.contextSelection!.deliveredTriggerKeys).toEqual(result.prepared.evidence.contextSelection!.matchedTriggerKeys)
  })
  it.each(['public', 'party'] as const)('does not make actual retained party narration public in a new %s Oracle request', async audience => {
    const s = await setupOracleRuntimeModelV1(audience, pkg => {
      pkg.ttrpg!.rulePack.content.actions[0].effects = []
      pkg.ttrpg!.campaign.clocks[0].autoAdvance.onIdleWorldTurns = 0
      for (const template of pkg.ttrpg!.campaign.situationTemplates) {
        template.obstacles = template.obstacles.map(row => ({ ...row, predicate: { op: 'world-turn-at-least', value: 10 } }))
        template.consequences = []; template.noInterventionOutcome.afterWorldTurns = 20
      }
    }, async s => {
      const sessionId = s.f.sessionId, viewerKey = OPEN_HUMAN_VIEWER, content = s.f.runtimePackage.ttrpg!
      await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(sessionId, 'oracle.guidance.signal.window'), viewerKey: 'viewer.gm', triggerKind: 'continue-host', rawInput: '明确提前发布原冻结征兆' })
      await telegraphTtrpgOpenFrontV1({ ...await openEnvelopeV1(sessionId, await ttrpgOpenScopedKeyV1(s.state.ttrpg!.sessionKey, 'pressure-signal', ['storm', 'wind'])),
        viewerKey: 'viewer.gm', frontKey: 'storm', telegraphKey: 'wind' })
      await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(sessionId, 'oracle.guidance.close.signal'), viewerKey: 'viewer.gm',
        epochKey: (await readProductRuntimeState(sessionId)).ttrpg!.openRun!.coordination.activeEpochKey!, reason: '原冻结征兆已提前保存，结束本次主持窗口' })
      await changeTtrpgSituationV1({ ...await openEnvelopeV1(sessionId, 'oracle.guidance.opening'), templateKey: content.campaign.openingSituationKeys[0], activationReason: 'opening', mode: 'activated' })
      await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(sessionId, 'oracle.guidance.action'), viewerKey, triggerKind: 'submit-action', rawInput: '检查码头的公开环境' })
      const rule = content.rulePack.content.actions[0], template = content.campaign.situationTemplates[0]
      const situation = (await readProductRuntimeState(sessionId)).ttrpg!.openRun!.situations.active[0]
      await startTtrpgOpenOperationV1({ ...await openEnvelopeV1(sessionId, 'oracle.guidance.operation'), viewerKey,
        request: { route: 'existing-action', actorKey: 'hero', controllerMode: 'human', ruleKey: rule.key,
          targetKey: rule.target === 'self' ? 'hero' : rule.target === 'scene' ? null : 'keeper', effectBindings: {},
          discovery: { situationKey: situation.situationKey, evidenceRef: template.evidence[0].clueRef, interventionPointKey: template.interventionPoints[0].pointKey, effectBindings: {} } } })
      const op = (await readProductRuntimeState(sessionId)).ttrpg!.openRun!.operations.at(-1)!
      const command = { sessionId, viewerKey, operationKey: op.operationKey, frozenPlanHash: op.planHash }
      for (const row of op.plan.requiredApprovals) await confirmTtrpgOpenOperationV1({ ...await operationInput(sessionId, op.operationKey, `approval.${row.actorKey}`),
        actorKey: row.actorKey, riskHash: op.riskHash, decision: 'approve' })
      const settled = await resumeTtrpgOpenPlayV1(command)
      expect(settled.status, JSON.stringify((await readProductRuntimeState(sessionId)).ttrpg!.openRun!.gateReceipts?.map(row => row.result.results))).toBe('awaiting-narration')
      await recordTtrpgOpenHumanNarrationV1({ ...await operationInput(sessionId, op.operationKey, 'narration'), viewerKey: 'viewer.gm', reason: 'host-authored', text: 'PARTY-RETAINED-ORACLE-NARRATION' })
      await resumeTtrpgOpenPlayV1(command)
      const run = (await readProductRuntimeState(sessionId)).ttrpg!.openRun!
      expect(run.narrations).toHaveLength(1)
      expect(run.narrations![0].binding.audience).toBe('party')
      if (run.coordination.activeEpochKey) await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(sessionId, 'oracle.guidance.close.action'), viewerKey,
        epochKey: run.coordination.activeEpochKey, reason: '完成真实行动与全队叙述，另行咨询原 Oracle' })
    })
    const provider = CONTEXT_SOURCE_BY_KEY.get('ttrpgOpenGmContext')!.resources!
    const scope = { ...s.f.scope, productRuntimeSessionId: s.f.sessionId, runtimeActorKey: 'gm' }
    const read = await provider.openReadSession!(scope), catalog = await read.provider.listMetadata({ scope, limit: 1000 })
    expect(catalog.items.some(row => row.resourceKey.includes(':recent.'))).toBe(audience === 'party')
    await read.assertCurrent()
    const runAI = vi.fn(async (messages: Array<{ content: string }>) => {
      expect(JSON.stringify(messages).includes('PARTY-RETAINED-ORACLE-NARRATION')).toBe(audience === 'party')
      return JSON.stringify({ interpretation: '仅在原接收范围内解释。', facts: [s.fact] })
    })
    await generateTtrpgOpenOracleCandidateV2({ ...s.input, runAI })
    expect(runAI).toHaveBeenCalledOnce()
  })
})
