import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  executeTextOpenWorldActionV1,
  executeTextOpenWorldSystemActorStateActionV1,
} from '../../src/lib/open-world/action-executor'
import { createTextOpenWorldActorLifecycleCatalogV1, projectTextOpenWorldActorsV1 } from '../../src/lib/open-world/actors'
import { createTextOpenWorldActionRegistryV1 } from '../../src/lib/open-world/action-registry'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { deriveTextOpenWorldContextsV1 } from '../../src/lib/open-world/session-projection'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import type { TextOpenWorldEffectDefinitionV1 } from '../../src/lib/types'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture, downgradeTextOpenWorldFixtureEconomyV1 } from '../helpers/text-open-world-vnext-fixture'

function lifecycleFixture() {
  const runtimePackage = createTextOpenWorldVNextFixture()
  downgradeTextOpenWorldFixtureEconomyV1(runtimePackage)
  const actors = runtimePackage.modules.actors.payload as any
  actors.actors.push(
    {
      key: 'actor.salt-merchant', tier: 'resident', name: '盐商', biography: '经营基础补给。', portrayal: '谨慎交易。',
      factionKey: null, homeLocationKey: 'location.salt-port', protected: false, mortalityPolicy: 'mortal',
      serviceKeys: ['vendor.salt-merchant'], scheduleKey: null,
    },
    {
      key: 'actor.backup-merchant', tier: 'resident', name: '代售人', biography: '在必要时接管基础补给。', portrayal: '只处理通用交易。',
      factionKey: null, homeLocationKey: 'location.salt-port', protected: false, mortalityPolicy: 'mortal',
      serviceKeys: ['vendor.backup-merchant'], scheduleKey: null,
    },
    {
      key: 'actor.story-witness', tier: 'significant', name: '见证人', biography: '掌握一段支线真相。', portrayal: '言辞克制。',
      factionKey: null, homeLocationKey: 'location.salt-port', protected: false, mortalityPolicy: 'story-only',
      serviceKeys: [], scheduleKey: null,
    },
  )
  actors.serviceContinuity.push(
    {
      key: 'service-continuity.salt-merchant', ownerActorKey: 'actor.salt-merchant', serviceKey: 'vendor.salt-merchant',
      policy: 'replace-on-owner-death', replacementActorKey: 'actor.backup-merchant', replacementServiceKey: 'vendor.backup-merchant',
    },
    {
      key: 'service-continuity.backup-merchant', ownerActorKey: 'actor.backup-merchant', serviceKey: 'vendor.backup-merchant',
      policy: 'disappear-on-owner-death', replacementActorKey: null, replacementServiceKey: null,
    },
  )
  const economy = runtimePackage.modules.economy.payload as any
  economy.vendors.push(
    {
      key: 'vendor.salt-merchant', title: '盐商基础补给', actorKey: 'actor.salt-merchant', locationKey: 'location.salt-port',
      factionKey: null, buyPriceMultiplier: 1, sellPriceMultiplier: 0.5,
      stock: [{ itemKey: 'item.brine-tonic', quantity: null }],
    },
    {
      key: 'vendor.backup-merchant', title: '代售基础补给', actorKey: 'actor.backup-merchant', locationKey: 'location.salt-port',
      factionKey: null, buyPriceMultiplier: 1, sellPriceMultiplier: 0.5,
      stock: [{ itemKey: 'item.brine-tonic', quantity: null }],
    },
  )
  const actions = runtimePackage.modules.actions.payload as any
  actions.effects.push(
    { key: 'effect.kill-salt-merchant', operation: 'change-actor-state', payload: { actorKey: 'actor.salt-merchant', alive: false, present: false, locationKey: null, cause: 'player-attack' } },
    { key: 'effect.kill-story-witness', operation: 'change-actor-state', payload: { actorKey: 'actor.story-witness', alive: false, present: false, locationKey: null, cause: 'story' } },
  )
  actions.actions.push(
    {
      key: 'action.attack-salt-merchant', category: 'attack-actor', label: '攻击盐商', description: '确认后攻击普通角色。',
      actorScope: 'player', targetScope: 'actor', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
      successEffectKeys: ['effect.kill-salt-merchant'], failureEffectKeys: [], timeCostMinutes: 0,
      confirmationPolicy: 'always', repeatPolicy: 'repeatable', cooldownMinutes: null,
    },
    {
      key: 'action.story-kill-witness', category: 'actor-state-action', label: '结算见证人剧情', description: '只由正式故事结果执行。',
      actorScope: 'system', targetScope: 'actor', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
      successEffectKeys: ['effect.kill-story-witness'], failureEffectKeys: [], timeCostMinutes: 0,
      confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
    },
    {
      key: 'action.talk-local', category: 'talk', label: '交谈', description: '与当前位置仍存活且在场的角色交谈。',
      actorScope: 'player', targetScope: 'actor', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
      successEffectKeys: [], failureEffectKeys: [], timeCostMinutes: 0,
      confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
    },
  )
  return runtimePackage
}

async function publishedLifecycleSession() {
  const runtimePackage = lifecycleFixture()
  return (await createGovernedTextOpenWorldSessionFixtureV1({
    name: `TEXT-OPEN-WORLD 角色生命周期验收-${crypto.randomUUID()}`,
    textOpenWorldVNext: runtimePackage,
    title: '盐脊角色生命周期',
    seed: 'actor-lifecycle-seed',
  })).session
}

describe('Text Open World vNext · governed Actor lifecycle and service continuity', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('玩家攻击普通NPC后关闭死者交互，并由Build预制替代者接管通用服务', async () => {
    const session = await publishedLifecycleSession()
    const before = await readProductRuntimeState(session.id!)
    const beforeActors = projectTextOpenWorldActorsV1({ runtimePackage: before.textOpenWorld!.runtimePackage, state: before.textOpenWorld!.state })
    expect(beforeActors.find(actor => actor.key === 'actor.salt-merchant')?.availableServices).toEqual([{ key: 'vendor.salt-merchant', title: '盐商基础补给' }])
    expect(beforeActors.find(actor => actor.key === 'actor.backup-merchant')?.availableServices).toEqual([])

    const preflight = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.attack-salt-merchant', targetKey: 'actor.salt-merchant', commandId: 'command.attack.preflight', requestedAt: 1_100,
    })
    expect(preflight).toMatchObject({ phase: 'preflight', status: 'confirmation-required' })
    const result = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.attack-salt-merchant', targetKey: 'actor.salt-merchant', confirmed: true, commandId: 'command.attack.confirmed', requestedAt: 1_200,
    })
    expect(result).toMatchObject({ phase: 'terminal', status: 'succeeded' })

    const after = await readProductRuntimeState(session.id!)
    expect(after.textOpenWorld!.state.actors['actor.salt-merchant']).toMatchObject({ alive: false, present: false })
    const projected = projectTextOpenWorldActorsV1({ runtimePackage: after.textOpenWorld!.runtimePackage, state: after.textOpenWorld!.state })
    expect(projected.some(actor => actor.key === 'actor.salt-merchant')).toBe(false)
    expect(projected.find(actor => actor.key === 'actor.backup-merchant')?.availableServices).toEqual([{ key: 'vendor.backup-merchant', title: '代售基础补给' }])

    const context = deriveTextOpenWorldContextsV1(after.textOpenWorld!).action
    expect(context.validTargetKeysByScope.actor).not.toContain('actor.salt-merchant')
    expect(context.validTargetKeysByScope.vendor).not.toContain('vendor.salt-merchant')
    expect(context.validTargetKeysByScope.vendor).toContain('vendor.backup-merchant')
    expect(() => createTextOpenWorldActionRegistryV1(after.textOpenWorld!.runtimePackage).resolve({
      actionKey: 'action.talk-local', targetKey: 'actor.salt-merchant', context,
    })).toThrow('targetKey不在Action可用目标中')
  })

  it('story-only角色只能由受治理系统剧情Action致死，死亡后同样不可对话', async () => {
    const runtimePackage = lifecycleFixture()
    const initial = (await import('../../src/lib/open-world/session-projection')).createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const forbiddenEffect: TextOpenWorldEffectDefinitionV1 = {
      key: 'effect.attack-story-witness', operation: 'change-actor-state',
      payload: { actorKey: 'actor.story-witness', alive: false, present: false, locationKey: null, cause: 'player-attack' },
    }
    const lifecycle = createTextOpenWorldActorLifecycleCatalogV1(runtimePackage)
    expect(() => lifecycle.preview({ state: initial.state, effect: forbiddenEffect as Extract<TextOpenWorldEffectDefinitionV1, { operation: 'change-actor-state' }> }))
      .toThrow('只允许由正式剧情结果致死')

    const session = await publishedLifecycleSession()
    const result = await executeTextOpenWorldSystemActorStateActionV1({
      sessionId: session.id!, actionKey: 'action.story-kill-witness', targetKey: 'actor.story-witness', commandId: 'command.story-witness', requestedAt: 1_300,
    })
    expect(result).toMatchObject({ phase: 'terminal', status: 'succeeded' })
    const after = await readProductRuntimeState(session.id!)
    expect(after.textOpenWorld!.state.actors['actor.story-witness']).toMatchObject({ alive: false, present: false })
    expect(deriveTextOpenWorldContextsV1(after.textOpenWorld!).action.validTargetKeysByScope.actor).not.toContain('actor.story-witness')
  })

  it('Build拒绝关键NPC攻击合同、缺失替代服务和替代链', () => {
    const protectedAttack = lifecycleFixture()
    const actions = protectedAttack.modules.actions.payload as any
    actions.effects.push({ key: 'effect.kill-caretaker-invalid', operation: 'change-actor-state', payload: { actorKey: 'actor.caretaker', alive: false, present: false, locationKey: null, cause: 'player-attack' } })
    actions.actions.push({
      key: 'action.attack-caretaker-invalid', category: 'attack-actor', label: '错误攻击', description: '不应通过Build。',
      actorScope: 'player', targetScope: 'actor', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [], successEffectKeys: ['effect.kill-caretaker-invalid'], failureEffectKeys: [],
      timeCostMinutes: 0, confirmationPolicy: 'always', repeatPolicy: 'repeatable', cooldownMinutes: null,
    })
    expect(() => parseTextOpenWorldModulesV1(protectedAttack)).toThrow('受保护Actor不能配置死亡Effect')

    const missingReplacement = lifecycleFixture()
    ;(missingReplacement.modules.actors.payload as any).serviceContinuity.find((rule: any) => rule.serviceKey === 'vendor.salt-merchant').replacementServiceKey = 'vendor.missing'
    expect(() => parseTextOpenWorldModulesV1(missingReplacement)).toThrow('replacementServiceKey不存在')

    const replacementChain = lifecycleFixture()
    const rules = (replacementChain.modules.actors.payload as any).serviceContinuity
    const backup = rules.find((rule: any) => rule.serviceKey === 'vendor.backup-merchant')
    Object.assign(backup, {
      policy: 'replace-on-owner-death', replacementActorKey: 'actor.salt-merchant', replacementServiceKey: 'vendor.salt-merchant',
    })
    expect(() => parseTextOpenWorldModulesV1(replacementChain)).toThrow('服务替代链')
  })

  it('临时角色只能按事件解决退场，已死亡角色不能被复活', async () => {
    const runtimePackage = lifecycleFixture()
    const actors = runtimePackage.modules.actors.payload as any
    actors.actors.push({
      key: 'actor.transient', tier: 'transient', name: '过客', biography: '一次事件中的临时角色。', portrayal: '匆忙。',
      factionKey: null, homeLocationKey: 'location.salt-port', protected: false, mortalityPolicy: 'despawn-on-resolution', serviceKeys: [], scheduleKey: null,
    })
    const projection = (await import('../../src/lib/open-world/session-projection')).createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const lifecycle = createTextOpenWorldActorLifecycleCatalogV1(runtimePackage)
    expect(() => lifecycle.preview({
      state: projection.state,
      effect: { key: 'effect.bad-despawn', operation: 'change-actor-state', payload: { actorKey: 'actor.transient', alive: null, present: false, locationKey: null, cause: 'story' } },
    })).toThrow('只能由事件解决结果退场')
    expect(lifecycle.preview({
      state: projection.state,
      effect: { key: 'effect.resolve-despawn', operation: 'change-actor-state', payload: { actorKey: 'actor.transient', alive: null, present: false, locationKey: null, cause: 'resolution' } },
    }).after).toMatchObject({ alive: true, present: false })

    const revive = lifecycleFixture()
    ;(revive.modules.actions.payload as any).effects.push({
      key: 'effect.revive-merchant', operation: 'change-actor-state', payload: { actorKey: 'actor.salt-merchant', alive: true, present: true, locationKey: null, cause: 'story' },
    })
    const reviveProjection = (await import('../../src/lib/open-world/session-projection')).createInitialTextOpenWorldSessionProjectionV1(revive)
    const dead = structuredClone(reviveProjection.state)
    dead.actors['actor.salt-merchant'].alive = false
    dead.actors['actor.salt-merchant'].present = false
    const reviveEffects = createTextOpenWorldEffectCatalogV1(revive)
    await expect(reviveEffects.plan({ effectKeys: ['effect.revive-merchant'], claimKey: 'claim.revive', state: dead })).rejects.toThrow('不允许复活已死亡角色')
  })
})
