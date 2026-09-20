import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import { createTextOpenWorldActionRegistryV1 } from '../../src/lib/open-world/action-registry'
import { createTextOpenWorldCrimeCatalogV1 } from '../../src/lib/open-world/crime'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import {
  createInitialTextOpenWorldSessionProjectionV1,
  deriveTextOpenWorldContextsV1,
} from '../../src/lib/open-world/session-projection'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import {
  createTextOpenWorldVNextFixture,
  downgradeTextOpenWorldFixtureCombatV1,
} from '../helpers/text-open-world-vnext-fixture'

async function publishedCrimeSession(name: string) {
  return (await createGovernedTextOpenWorldSessionFixtureV1({
    name: `${name}-${crypto.randomUUID()}`,
    textOpenWorldVNext: createTextOpenWorldVNextFixture(),
    title: name,
    seed: 'crime-seed',
  })).session
}

describe('Text Open World vNext · governed theft, deception and local crime', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('由冻结条件确定成败、在场目击者和唯一Effect集合', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const conditions = deriveTextOpenWorldContextsV1(projection).action.conditionResults
    const catalog = createTextOpenWorldCrimeCatalogV1(runtimePackage)

    expect(catalog.prepare({
      actionKey: 'action.steal-tonic', targetActorKey: 'actor.caretaker', state: projection.state, conditionResults: conditions,
    })).toMatchObject({
      outcome: 'success', failureReason: null,
      authorization: {
        kind: 'crime', crimeKey: 'crime.steal-tonic', crimeKind: 'steal', witnessActorKeys: [],
        effectKeys: ['effect.steal-morality-success', 'effect.steal-item'],
      },
    })

    expect(catalog.prepare({
      actionKey: 'action.deceive-caretaker', targetActorKey: 'actor.caretaker', state: projection.state, conditionResults: conditions,
    })).toMatchObject({
      outcome: 'failure', failureReason: { code: 'crime-attempt-failed' },
      authorization: {
        crimeKey: 'crime.deceive-caretaker', crimeKind: 'deceive', witnessActorKeys: ['actor.caretaker'],
        effectKeys: ['effect.deceive-morality-failure', 'effect.deceive-witnessed-affinity'],
        successConditionResults: [{ conditionKey: 'condition.level-two', satisfied: false }],
      },
    })
  })

  it('犯罪Effect没有与当前状态一致的专用授权时失败关闭', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const effects = createTextOpenWorldEffectCatalogV1(runtimePackage)
    await expect(effects.plan({
      effectKeys: ['effect.steal-morality-success', 'effect.steal-item'],
      claimKey: 'claim.unauthorized-crime',
      state: projection.state,
    })).rejects.toThrow('犯罪Effect缺少犯罪授权')

    const prepared = createTextOpenWorldCrimeCatalogV1(runtimePackage).prepare({
      actionKey: 'action.steal-tonic', targetActorKey: 'actor.caretaker', state: projection.state,
      conditionResults: deriveTextOpenWorldContextsV1(projection).action.conditionResults,
    })
    const forged = structuredClone(prepared.authorization)
    forged.witnessActorKeys = ['actor.caretaker']
    forged.effectKeys.push('effect.steal-witnessed-affinity')
    await expect(effects.plan({
      effectKeys: forged.effectKeys,
      claimKey: 'claim.forged-crime',
      state: projection.state,
      authorization: forged,
    })).rejects.toThrow('犯罪授权与当前确定性状态不一致')
  })

  it('正式ProductRuntimeSession要求二次确认并原子提交偷窃后果', async () => {
    const session = await publishedCrimeSession('盐脊偷窃验收')
    const preflight = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.steal-tonic', targetKey: 'actor.caretaker',
      commandId: 'command.crime.steal.preflight', requestedAt: 1_000,
    })
    expect(preflight).toMatchObject({ phase: 'preflight', status: 'confirmation-required', outcomeCommitted: false })
    expect(await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()).toBe(2)
    const confirmationBaseline = await readProductRuntimeState(session.id!)

    await expect(executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.steal-tonic', targetKey: 'actor.caretaker', confirmed: true,
      commandId: 'command.crime.steal.no-baseline', requestedAt: 1_050,
    })).rejects.toThrow('高风险确认缺少原始Session事件基线')

    const completed = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.steal-tonic', targetKey: 'actor.caretaker', confirmed: true,
      expectedBaseSequence: confirmationBaseline.lastSequence,
      commandId: 'command.crime.steal', requestedAt: 1_100,
    })
    expect(completed).toMatchObject({
      phase: 'terminal', status: 'succeeded', outcomeCommitted: true,
      evidenceEventSequences: [3, 4], reason: null,
    })
    const projection = (await readProductRuntimeState(session.id!)).textOpenWorld!
    const state = projection.state
    expect(state.relationships).toMatchObject({ morality: -5, factionAffinityByKey: { 'faction.canal-keepers': 0 } })
    expect(state.inventory.stackQuantities['item.brine-tonic']).toBe(1)
    expect(createTextOpenWorldActionRegistryV1(projection.runtimePackage)
      .project(deriveTextOpenWorldContextsV1(projection).action)
      .find(entry => entry.action.key === 'action.accept-main')).toMatchObject({ available: true })

    const retry = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.steal-tonic', targetKey: 'actor.caretaker', confirmed: true,
      commandId: 'command.crime.steal', requestedAt: 9_999,
    })
    expect(retry.receiptHash).toBe(completed.receiptHash)
    expect(await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()).toBe(4)
    const consumed = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.steal-tonic', targetKey: 'actor.caretaker', confirmed: true,
      commandId: 'command.crime.steal.again', requestedAt: 1_200,
    })
    expect(consumed).toMatchObject({ phase: 'preflight', status: 'rejected', reason: { code: 'once-consumed' } })
  })

  it('高风险确认拒绝弹窗打开后已经变化的Session事件基线', async () => {
    const session = await publishedCrimeSession('盐脊过期确认验收')
    const preflight = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.steal-tonic', targetKey: 'actor.caretaker',
      commandId: 'command.crime.stale.preflight', requestedAt: 1_000,
    })
    expect(preflight).toMatchObject({ phase: 'preflight', status: 'confirmation-required' })
    const baseline = await readProductRuntimeState(session.id!)

    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.rest',
      commandId: 'command.crime.stale.advance', requestedAt: 1_100,
    })
    await expect(executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.steal-tonic', targetKey: 'actor.caretaker',
      confirmed: true, expectedBaseSequence: baseline.lastSequence,
      commandId: 'command.crime.stale.confirm', requestedAt: 1_200,
    })).rejects.toThrow('确认基线已变化')

    const current = (await readProductRuntimeState(session.id!)).textOpenWorld!.state
    expect(current.relationships.morality).toBe(0)
    expect(current.inventory.stackQuantities['item.brine-tonic'] ?? 0).toBe(0)
  })

  it('欺骗失败仍提交道德与目击阵营后果，并可由事件刷新重放', async () => {
    const session = await publishedCrimeSession('盐脊欺骗验收')
    const confirmationBaseline = await readProductRuntimeState(session.id!)
    const failed = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.deceive-caretaker', targetKey: 'actor.caretaker', confirmed: true,
      expectedBaseSequence: confirmationBaseline.lastSequence,
      commandId: 'command.crime.deceive', requestedAt: 1_300,
    })
    expect(failed).toMatchObject({
      phase: 'terminal', status: 'failed', outcomeCommitted: true,
      reason: { code: 'crime-attempt-failed', message: '谎言中的细节无法自洽，岑阿婆没有相信。' },
      evidenceEventSequences: [3, 4],
    })
    expect(failed.presentation.mayNarrateSuccess).toBe(false)
    expect((await readProductRuntimeState(session.id!)).textOpenWorld!.state.relationships).toMatchObject({
      morality: -4,
      factionAffinityByKey: { 'faction.canal-keepers': -8 },
    })

    await db.productRuntimeSessions.update(session.id!, {
      runtimeHeadSequence: null, runtimeHeadStateJson: null, runtimeHeadStateHash: null,
    })
    const replayed = (await readProductRuntimeState(session.id!)).textOpenWorld!
    expect(replayed.state.relationships).toMatchObject({
      morality: -4,
      factionAffinityByKey: { 'faction.canal-keepers': -8 },
    })
    expect(replayed.actions.completedOnceActionKeys).toContain('action.deceive-caretaker')
  })

  it('Build约束版本配对、犯罪边界、专用Effect和旧Release兼容', () => {
    const mismatched = createTextOpenWorldVNextFixture()
    downgradeTextOpenWorldFixtureCombatV1(mismatched)
    ;(mismatched.modules.actions.payload as any).version = 7
    mismatched.modules.actions.schemaVersion = 7
    expect(() => parseTextOpenWorldModulesV1(mismatched)).toThrow('Action v8必须与Relationship v3一起发布')

    const outOfScope = createTextOpenWorldVNextFixture()
    const outOfScopeEffects = (outOfScope.modules.actions.payload as any).effects
    const witnessed = outOfScopeEffects.find((effect: any) => effect.key === 'effect.steal-witnessed-affinity')
    Object.assign(witnessed, { operation: 'advance-time', payload: { minutes: 1 } })
    expect(() => parseTextOpenWorldModulesV1(outOfScope)).toThrow('包含首版犯罪边界外Effect')

    const sharedWithOrdinaryAction = createTextOpenWorldVNextFixture()
    ;(sharedWithOrdinaryAction.modules.actions.payload as any).actions[0].successEffectKeys.push('effect.steal-item')
    expect(() => parseTextOpenWorldModulesV1(sharedWithOrdinaryAction)).toThrow('犯罪专用Effect不能被非犯罪Action引用')

    const legacy = createTextOpenWorldVNextFixture()
    downgradeTextOpenWorldFixtureCombatV1(legacy)
    ;(legacy.modules.actions.payload as any).version = 7
    legacy.modules.actions.schemaVersion = 7
    ;(legacy.modules.actions.payload as any).actions = (legacy.modules.actions.payload as any).actions
      .filter((action: any) => !['steal', 'deceive', 'crime'].includes(action.category))
    const legacyCrimeEffectKeys = new Set([
      'effect.steal-morality-success', 'effect.steal-morality-failure', 'effect.steal-item', 'effect.steal-witnessed-affinity',
      'effect.deceive-morality-success', 'effect.deceive-morality-failure', 'effect.deceive-witnessed-affinity',
    ])
    ;(legacy.modules.actions.payload as any).effects = (legacy.modules.actions.payload as any).effects
      .filter((effect: any) => !legacyCrimeEffectKeys.has(effect.key))
    ;(legacy.modules.relationships.payload as any).version = 2
    legacy.modules.relationships.schemaVersion = 2
    delete (legacy.modules.relationships.payload as any).crimeActions
    const parsed = parseTextOpenWorldModulesV1(legacy)
    expect(parsed.actions.version).toBe(7)
    expect(parsed.relationships).toMatchObject({ version: 2, crimeActions: [] })

    const projected = createInitialTextOpenWorldSessionProjectionV1(legacy)
    expect(createTextOpenWorldActionRegistryV1(legacy).project(deriveTextOpenWorldContextsV1(projected).action)
      .some(action => ['steal', 'deceive', 'crime'].includes(action.action.category))).toBe(false)
  })
})
