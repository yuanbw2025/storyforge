import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import { createTextOpenWorldActionRegistryV1 } from '../../src/lib/open-world/action-registry'
import {
  createTextOpenWorldEffectCatalogV1,
  validateTextOpenWorldEffectStateV1,
} from '../../src/lib/open-world/effect-dsl'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import {
  createInitialTextOpenWorldSessionProjectionV1,
  deriveTextOpenWorldContextsV1,
  parseTextOpenWorldSessionProjectionV1,
} from '../../src/lib/open-world/session-projection'
import { createTextOpenWorldInstance } from '../../src/lib/product/runtime-instances'
import {
  hashProductRuntimeStateV1,
  readProductRuntimeState,
  replayProductRuntimeEvents,
} from '../../src/lib/product/runtime-core'
import type {
  ProductRuntimeSession,
  TextOpenWorldActionAvailabilityV1,
  TextOpenWorldSessionProjectionV1,
} from '../../src/lib/types'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

const MAIN_INSTANCE_KEY = 'quest-instance.12.quest.main.1.release.13.session-start'
const FIXED_SEEDS = ['salt-ridge-alpha', 'salt-ridge-omega'] as const
const SAFE_ACTION_KEYS = new Set([
  'action.investigate-channel',
  'action.talk-caretaker',
  'action.travel-port-ridge',
  'action.travel-ridge-port',
  'action.fast-travel',
  'action.rest',
  'action.equip-rust-sword',
  'action.unequip-rust-sword',
])

function fail(message: string): never {
  throw new Error(`[text-open-world-g7-invariant] ${message}`)
}

function deterministicPicker(seed: string): () => number {
  let state = 0x811c9dc5
  for (const character of seed) {
    state ^= character.charCodeAt(0)
    state = Math.imul(state, 0x01000193) >>> 0
  }
  if (state === 0) state = 0x9e3779b9
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return state >>> 0
  }
}

function assertFiniteNumbers(value: unknown, path = 'state'): void {
  if (typeof value === 'number') {
    expect(Number.isFinite(value), `${path}必须是有限数值`).toBe(true)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertFiniteNumbers(entry, `${path}[${index}]`))
    return
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, entry]) => assertFiniteNumbers(entry, `${path}.${key}`))
  }
}

function assertRuntimeInvariants(projection: TextOpenWorldSessionProjectionV1): void {
  const state = projection.state
  const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
  validateTextOpenWorldEffectStateV1(state, modules)
  assertFiniteNumbers(state)

  expect(state.player.health).toBeGreaterThanOrEqual(0)
  expect(state.player.skillResource).toBeGreaterThanOrEqual(0)
  expect(state.inventory.currency).toBeGreaterThanOrEqual(0)
  expect(state.time.worldMinute).toBeGreaterThanOrEqual(0)
  Object.values(state.inventory.stackQuantities).forEach(quantity => expect(quantity).toBeGreaterThan(0))
  Object.values(state.economy.limitedStockQuantitiesByVendorKey)
    .flatMap(stock => Object.values(stock))
    .forEach(quantity => expect(quantity).toBeGreaterThanOrEqual(0))

  const instanceIds = Object.keys(state.inventory.itemInstances)
  expect(new Set(instanceIds).size).toBe(instanceIds.length)
  const equippedIds = Object.values(state.inventory.equippedItemInstanceIdBySlot)
    .filter((instanceId): instanceId is string => instanceId != null)
  expect(new Set(equippedIds).size).toBe(equippedIds.length)
  for (const item of modules.items.items.filter(candidate => candidate.unique)) {
    const count = Object.values(state.inventory.itemInstances)
      .filter(instance => instance.itemKey === item.key).length
    expect(count).toBeLessThanOrEqual(1)
  }
}

function availableSafeActions(projection: TextOpenWorldSessionProjectionV1): TextOpenWorldActionAvailabilityV1[] {
  return createTextOpenWorldActionRegistryV1(projection.runtimePackage)
    .project(deriveTextOpenWorldContextsV1(projection).action)
    .filter(entry => entry.available && SAFE_ACTION_KEYS.has(entry.action.key))
    .sort((left, right) => left.action.key.localeCompare(right.action.key))
}

function assertMainlineReachable(projection: TextOpenWorldSessionProjectionV1): void {
  const instance = projection.state.quests.instancesByKey[MAIN_INSTANCE_KEY]
    ?? fail('主线实例缺失')
  expect(instance.status).toBe('revealed')
  const accept = createTextOpenWorldActionRegistryV1(projection.runtimePackage)
    .project(deriveTextOpenWorldContextsV1(projection).action)
    .find(entry => entry.action.key === 'action.accept-main')
    ?? fail('主线接取Action缺失')
  expect(accept).toMatchObject({ available: true, validTargetKeys: [MAIN_INSTANCE_KEY] })
}

async function replayHash(session: ProductRuntimeSession): Promise<string> {
  const events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
  const replayed = replayProductRuntimeEvents(JSON.parse(session.initialStateJson), events)
  return hashProductRuntimeStateV1(replayed)
}

describe('Text Open World G7 · property, invariant and fixed-seed replay gates', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('多组确定性属性序列始终保持资源有界、物品所有权唯一和状态合同有效', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const modules = parseTextOpenWorldModulesV1(runtimePackage)
    const catalog = createTextOpenWorldEffectCatalogV1(runtimePackage)

    for (const seed of Array.from({ length: 16 }, (_, index) => `property-${index + 1}`)) {
      const next = deterministicPicker(seed)
      let state = createInitialTextOpenWorldSessionProjectionV1(runtimePackage).state
      for (let step = 0; step < 32; step += 1) {
        const equipped = state.inventory.equippedItemInstanceIdBySlot.weapon != null
        const candidates = [
          'effect.reward-currency',
          'effect.investigate-time',
          'effect.drop-salt-1',
          'effect.reward-experience',
          equipped ? 'effect.unequip-rust-sword' : 'effect.equip-rust-sword',
        ]
        const effectKey = candidates[next() % candidates.length]!
        const plan = await catalog.plan({
          effectKeys: [effectKey],
          claimKey: `claim.g7-property.${seed}.${step}`,
          state,
        })
        const applied = await catalog.apply({ plan, state })
        state = applied.state
        validateTextOpenWorldEffectStateV1(state, modules)
        assertFiniteNumbers(state)
        expect(state.inventory.currency).toBeGreaterThanOrEqual(0)
        expect(state.player.health).toBeGreaterThanOrEqual(0)
        expect(state.player.skillResource).toBeGreaterThanOrEqual(0)
        expect(state.time.worldMinute).toBeGreaterThanOrEqual(0)
        expect(new Set(Object.values(state.inventory.equippedItemInstanceIdBySlot)
          .filter((value): value is string => value != null)).size)
          .toBe(Object.values(state.inventory.equippedItemInstanceIdBySlot).filter(Boolean).length)
      }
    }
  })

  it('同一Release和固定seed的合法行动序列产生相同重放Hash，并保持主线可达、命令幂等与Session隔离', async () => {
    for (const seed of FIXED_SEEDS) {
      const created = await createGovernedTextOpenWorldSessionFixtureV1({
        name: `TEXT-OPEN-WORLD G7固定seed-${seed}`,
        textOpenWorldVNext: createTextOpenWorldVNextFixture(),
        title: '盐脊固定seed不变量',
        seed,
      })
      const mirror = await createTextOpenWorldInstance({
        scope: created.scope,
        productReleaseId: created.release.id!,
        title: '盐脊固定seed不变量镜像',
        seed,
      })
      const next = deterministicPicker(seed)

      for (let step = 0; step < 4; step += 1) {
        const firstBefore = await readProductRuntimeState(created.session.id!)
        const mirrorBefore = await readProductRuntimeState(mirror.id!)
        expect(await hashProductRuntimeStateV1(firstBefore)).toBe(await hashProductRuntimeStateV1(mirrorBefore))
        assertRuntimeInvariants(firstBefore.textOpenWorld!)
        assertRuntimeInvariants(mirrorBefore.textOpenWorld!)
        assertMainlineReachable(firstBefore.textOpenWorld!)
        assertMainlineReachable(mirrorBefore.textOpenWorld!)

        const candidates = availableSafeActions(firstBefore.textOpenWorld!)
        expect(candidates.length).toBeGreaterThan(0)
        const action = step === 0
          ? candidates.find(candidate => candidate.action.key === 'action.talk-caretaker')
            ?? fail('固定seed序列缺少首个Director交谈Action')
          : candidates[next() % candidates.length]!
        const targetKey = action.targetScope === 'none'
          ? null
          : action.validTargetKeys[next() % action.validTargetKeys.length] ?? fail(`Action缺少目标:${action.action.key}`)
        const commandId = `command.g7-invariant.${seed}.${step}`
        const input = {
          actionKey: action.action.key,
          ...(targetKey == null ? {} : { targetKey }),
          commandId,
          requestedAt: 10_000 + step,
        }

        const mirrorHashBeforeFirstWrite = await hashProductRuntimeStateV1(mirrorBefore)
        const mirrorEventCountBeforeFirstWrite = await db.productRuntimeEvents.where('sessionId').equals(mirror.id!).count()
        const firstReceipt = await executeTextOpenWorldActionV1({ sessionId: created.session.id!, ...input })
        const firstEventCount = await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).count()
        const retry = await executeTextOpenWorldActionV1({
          sessionId: created.session.id!,
          ...input,
          requestedAt: 90_000 + step,
        })
        expect(retry.receiptHash).toBe(firstReceipt.receiptHash)
        expect(await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).count()).toBe(firstEventCount)
        expect(await hashProductRuntimeStateV1(await readProductRuntimeState(mirror.id!)))
          .toBe(mirrorHashBeforeFirstWrite)
        expect(await db.productRuntimeEvents.where('sessionId').equals(mirror.id!).count())
          .toBe(mirrorEventCountBeforeFirstWrite)

        await executeTextOpenWorldActionV1({ sessionId: mirror.id!, ...input })
        const firstAfter = await readProductRuntimeState(created.session.id!)
        const mirrorAfter = await readProductRuntimeState(mirror.id!)
        expect(await hashProductRuntimeStateV1(firstAfter)).toBe(await hashProductRuntimeStateV1(mirrorAfter))
      }
      const firstFinal = await readProductRuntimeState(created.session.id!)
      const mirrorFinal = await readProductRuntimeState(mirror.id!)
      expect(await replayHash(created.session)).toBe(await hashProductRuntimeStateV1(firstFinal))
      expect(await replayHash(mirror)).toBe(await hashProductRuntimeStateV1(mirrorFinal))
    }
  }, 90_000)

  it('状态解析拒绝资源越界、非有限数值、唯一物品重复和单实例多槽占用', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const base = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)

    const negativeCurrency = structuredClone(base)
    negativeCurrency.state.inventory.currency = -1
    expect(() => parseTextOpenWorldSessionProjectionV1(negativeCurrency)).toThrow('inventory.currency数值无效')

    const nonFiniteHealth = structuredClone(base)
    nonFiniteHealth.state.player.health = Number.NaN
    expect(() => parseTextOpenWorldSessionProjectionV1(nonFiniteHealth)).toThrow('player.health数值无效')

    const duplicateUniqueItem = structuredClone(base)
    duplicateUniqueItem.state.inventory.itemInstances['instance.g7.canal-seal.1'] = {
      itemKey: 'item.canal-seal', acquiredByClaimKey: 'initial-build', stateTags: [],
    }
    duplicateUniqueItem.state.inventory.itemInstances['instance.g7.canal-seal.2'] = {
      itemKey: 'item.canal-seal', acquiredByClaimKey: 'initial-build', stateTags: [],
    }
    expect(() => parseTextOpenWorldSessionProjectionV1(duplicateUniqueItem)).toThrow('唯一物品重复持有')

    const duplicateEquipmentOwner = structuredClone(base)
    duplicateEquipmentOwner.state.inventory.equippedItemInstanceIdBySlot.weapon = 'instance.initial.1.item.rust-sword'
    duplicateEquipmentOwner.state.inventory.equippedItemInstanceIdBySlot.armor = 'instance.initial.1.item.rust-sword'
    expect(() => validateTextOpenWorldEffectStateV1(
      duplicateEquipmentOwner.state,
      parseTextOpenWorldModulesV1(runtimePackage),
    ))
      .toThrow()
  })
})
