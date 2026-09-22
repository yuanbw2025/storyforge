import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createTextOpenWorldActionRegistryV1 } from '../../src/lib/open-world/action-registry'
import { commitTextOpenWorldCommandV1 } from '../../src/lib/open-world/commands'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { commitTextOpenWorldOutcomeBatchV1 } from '../../src/lib/open-world/events'
import {
  createTextOpenWorldPreflightFeedbackV1,
  readTextOpenWorldFeedbackV1,
  verifyTextOpenWorldFeedbackReceiptV1,
} from '../../src/lib/open-world/feedback'
import { createInitialTextOpenWorldSessionProjectionV1, deriveTextOpenWorldContextsV1 } from '../../src/lib/open-world/session-projection'
import { readProductRuntimeState, readProductRuntimeStateVersion } from '../../src/lib/product/runtime-core'
import type { TextOpenWorldCommandOutcomeV1, TextOpenWorldDegradationV1, TextOpenWorldOutcomeReasonV1 } from '../../src/lib/types'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

async function fixture(suffix: string) {
  const textOpenWorldVNext = createTextOpenWorldVNextFixture()
  if (suffix === 'success') {
    ;(textOpenWorldVNext.modules.actions.payload as any).actions.find((action: any) => action.key === 'action.investigate-channel').successEffectKeys = ['effect.reward-currency', 'effect.investigate-time']
  }
  const created = await createGovernedTextOpenWorldSessionFixtureV1({
    name: `TEXT-OPEN-WORLD Feedback验收-${suffix}-${crypto.randomUUID()}`,
    textOpenWorldVNext,
    title: `Feedback ${suffix}`,
    seed: `feedback-${suffix}`,
  })
  return { ...created, textOpenWorldVNext }
}

async function command(sessionId: number, commandId: string) {
  const base = await readProductRuntimeStateVersion(sessionId)
  return commitTextOpenWorldCommandV1({
    schema: 'storyforge.text-open-world.command', version: 1, commandId, sessionId,
    actorKey: 'player', actionKey: 'action.investigate-channel', payload: { targetKey: 'location.salt-port' },
    baseSequence: base.sequence, baseStateHash: base.stateHash, source: 'system-action', requestedAt: 1_000,
  })
}

async function settle(input: {
  sessionId: number
  commandId: string
  claimKey: string
  outcome: TextOpenWorldCommandOutcomeV1
  reason: TextOpenWorldOutcomeReasonV1 | null
  degradation: TextOpenWorldDegradationV1 | null
  effectKeys?: string[]
}) {
  const pending = (await readProductRuntimeState(input.sessionId)).textOpenWorld!
  const catalog = createTextOpenWorldEffectCatalogV1(pending.runtimePackage)
  const plan = await catalog.plan({ effectKeys: input.effectKeys ?? [], claimKey: input.claimKey, state: pending.state })
  const { receipt } = await catalog.apply({ plan, state: pending.state })
  return commitTextOpenWorldOutcomeBatchV1({
    sessionId: input.sessionId, commandId: input.commandId, ruleset: { key: 'storyforge.standard', version: 1 },
    randomRequests: [], plan, receipt, outcome: input.outcome, reason: input.reason, degradation: input.degradation,
  })
}

describe('Text Open World vNext · unified player feedback receipt', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('不可用和高风险未确认只产生preflight回执，绝不允许叙述成功', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const projection = deriveTextOpenWorldContextsV1(createInitialTextOpenWorldSessionProjectionV1(runtimePackage))
    const unavailableContext = { ...projection.action, actorKey: 'system' as const }
    const unavailable = createTextOpenWorldActionRegistryV1(runtimePackage).project(unavailableContext)[0]
    const rejected = await createTextOpenWorldPreflightFeedbackV1({ sessionId: 1, targetKey: null, baseSequence: 0, availability: unavailable, confirmed: false })
    expect(rejected).toMatchObject({ phase: 'preflight', status: 'rejected', outcomeCommitted: false, gameplayStateChanged: false, presentation: { mayNarrateSuccess: false }, evidenceEventIds: [] })

    const riskyPackage = createTextOpenWorldVNextFixture(); (riskyPackage.modules.actions.payload as any).actions[0].confirmationPolicy = 'high-risk'
    const riskyProjection = createInitialTextOpenWorldSessionProjectionV1(riskyPackage)
    const risky = createTextOpenWorldActionRegistryV1(riskyPackage).project(deriveTextOpenWorldContextsV1(riskyProjection).action)[0]
    const confirmation = await createTextOpenWorldPreflightFeedbackV1({ sessionId: 1, targetKey: 'location.salt-port', baseSequence: 0, availability: risky, confirmed: false })
    expect(confirmation).toMatchObject({ status: 'confirmation-required', reason: { code: 'confirmation-required' }, presentation: { mayNarrateSuccess: false } })
    await expect(verifyTextOpenWorldFeedbackReceiptV1({ ...confirmation, presentation: { ...confirmation.presentation, headline: '伪造成功' } })).rejects.toThrow('receiptHash不匹配')
  })

  it('只有Effect终态提交后才从pending变成可叙述的成功回执', async () => {
    const created = await fixture('success'); const current = created.session; await command(current.id!, 'command.feedback.success')
    const pending = await readTextOpenWorldFeedbackV1({ sessionId: current.id!, commandId: 'command.feedback.success' })
    expect(pending).toMatchObject({ phase: 'pending', status: 'pending', outcomeCommitted: false, presentation: { mayNarrateSuccess: false }, evidenceEventSequences: [3] })

    await settle({ sessionId: current.id!, commandId: 'command.feedback.success', claimKey: 'claim.feedback.success', outcome: 'success', reason: null, degradation: null, effectKeys: ['effect.reward-currency', 'effect.investigate-time'] })
    const success = await readTextOpenWorldFeedbackV1({ sessionId: current.id!, commandId: 'command.feedback.success' })
    expect(success).toMatchObject({ phase: 'terminal', status: 'succeeded', outcomeCommitted: true, gameplayStateChanged: true, presentation: { headline: '检查盐渠已完成', mayNarrateSuccess: true }, evidenceEventSequences: [3, 4] })
    expect(success.changes).toEqual([
      expect.objectContaining({ effectKey: 'effect.reward-currency', domain: 'inventory' }),
      expect.objectContaining({ effectKey: 'effect.investigate-time', domain: 'time' }),
    ])
    await expect(verifyTextOpenWorldFeedbackReceiptV1(success)).resolves.toEqual(success)
  })

  it('规则内失败和表现降级都是已提交终态，但只有降级可按成功事实继续叙述', async () => {
    const failedCreated = await fixture('failure')
    const failedSession = failedCreated.session; await command(failedSession.id!, 'command.feedback.failure')
    await settle({ sessionId: failedSession.id!, commandId: 'command.feedback.failure', claimKey: 'claim.feedback.failure', outcome: 'failure', reason: { code: 'combat-defeat', message: '战斗失败，已返回安全状态。' }, degradation: null })
    const failed = await readTextOpenWorldFeedbackV1({ sessionId: failedSession.id!, commandId: 'command.feedback.failure' })
    expect(failed).toMatchObject({ status: 'failed', outcomeCommitted: true, reason: { code: 'combat-defeat' }, presentation: { mayNarrateSuccess: false } })

    const degradedCreated = await fixture('degraded')
    const degradedSession = degradedCreated.session; await command(degradedSession.id!, 'command.feedback.degraded')
    const degradation = { code: 'portrait-unavailable', message: '角色头像暂时不可用。', unavailableCapability: 'portrait', fallback: '使用角色姓名与文字描写。' }
    await settle({ sessionId: degradedSession.id!, commandId: 'command.feedback.degraded', claimKey: 'claim.feedback.degraded', outcome: 'degraded', reason: null, degradation, effectKeys: ['effect.investigate-time'] })
    const degraded = await readTextOpenWorldFeedbackV1({ sessionId: degradedSession.id!, commandId: 'command.feedback.degraded' })
    expect(degraded).toMatchObject({ status: 'degraded', outcomeCommitted: true, degradation, presentation: { mayNarrateSuccess: true } })
    expect(degraded.presentation.details).toContain('替代表现：使用角色姓名与文字描写。')
  }, 10_000)

  it('失败缺原因或降级缺替代说明时，原子批次不会写入终态事件', async () => {
    const created = await fixture('invalid'); const current = created.session; await command(current.id!, 'command.feedback.invalid')
    const pending = (await readProductRuntimeState(current.id!)).textOpenWorld!; const catalog = createTextOpenWorldEffectCatalogV1(pending.runtimePackage)
    const plan = await catalog.plan({ effectKeys: [], claimKey: 'claim.feedback.invalid', state: pending.state }); const { receipt } = await catalog.apply({ plan, state: pending.state })
    await expect(commitTextOpenWorldOutcomeBatchV1({ sessionId: current.id!, commandId: 'command.feedback.invalid', ruleset: { key: 'storyforge.standard', version: 1 }, randomRequests: [], plan, receipt, outcome: 'failure', reason: null, degradation: null }))
      .rejects.toThrow('failure结果中不能为空')
    expect(await db.productRuntimeEvents.where('sessionId').equals(current.id!).count()).toBe(3)
  })
})
