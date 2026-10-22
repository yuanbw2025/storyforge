import { afterEach, describe, expect, it, vi } from 'vitest'
import { openRuntimePackageFixture } from '../helpers/ttrpg-open-package'
import { parseTtrpgRuntimeContentVersionedV1, parseTtrpgFrozenRuntimeContentV1, createTtrpgVerifiedContentViewV1 } from '../../src/lib/ttrpg/content-version'
import * as ruleParser from '../../src/lib/ttrpg/rule-pack-v2'

async function content(title: string) {
  const raw = (await openRuntimePackageFixture()).ttrpg!
  raw.campaign.title = title
  return raw
}
describe('R-TTRPGOPEN8 exact frozen content parsing reuse', () => {
  afterEach(() => vi.restoreAllMocks())
  it('validates identical actual JSON once and returns independent mutable views without trusting claimed identity', async () => {
    const raw = await content('cache.identity'), spy = vi.spyOn(ruleParser, 'parseRulePackV2')
    const first = parseTtrpgRuntimeContentVersionedV1(raw, raw.campaign.sourceWorld.contentHash, 2)
    const coldCalls = spy.mock.calls.length
    expect(coldCalls).toBeGreaterThan(0)
    const expected = structuredClone(first)
    expect(parseTtrpgRuntimeContentVersionedV1(structuredClone(raw), raw.campaign.sourceWorld.contentHash, 2)).toEqual(expected)
    expect(spy).toHaveBeenCalledTimes(coldCalls)
    first.rulePack.content.title = 'Caller edit must not poison the cached result'
    first.campaign.characterTemplates[0].name = 'Another caller mutation'
    expect(parseTtrpgRuntimeContentVersionedV1(raw, raw.campaign.sourceWorld.contentHash, 2)).toEqual(expected)
    raw.campaign.title = 'A changed actual value with the same claimed hashes'
    expect(parseTtrpgRuntimeContentVersionedV1(raw, raw.campaign.sourceWorld.contentHash, 2).campaign.title).toBe(raw.campaign.title)
    expect(spy).toHaveBeenCalledTimes(coldCalls * 2)
    expect(() => parseTtrpgRuntimeContentVersionedV1(raw, 'f'.repeat(64), 2)).toThrow(/来源/)
    expect(() => parseTtrpgRuntimeContentVersionedV1(raw, raw.campaign.sourceWorld.contentHash, 1)).toThrow()
  })
  it('never lets invisible or non-JSON fields collide with an already validated JSON body', async () => {
    const raw = await content('cache.closed-json')
    parseTtrpgRuntimeContentVersionedV1(raw, raw.campaign.sourceWorld.contentHash, 2)
    for (const kind of ['undefined', 'symbol', 'hidden', 'accessor']) {
      const altered = structuredClone(raw)
      let getterReads = 0
      if (kind === 'undefined') Object.defineProperty(altered.campaign, 'extra', { value: undefined, enumerable: true })
      if (kind === 'symbol') Object.defineProperty(altered.campaign, Symbol('extra'), { value: 1, enumerable: true })
      if (kind === 'hidden') Object.defineProperty(altered.campaign, 'extra', { value: 1 })
      if (kind === 'accessor') Object.defineProperty(altered.campaign, 'title', { enumerable: true, get() { getterReads += 1; return raw.campaign.title } })
      expect(() => parseTtrpgRuntimeContentVersionedV1(altered, raw.campaign.sourceWorld.contentHash, 2)).toThrow()
      expect(getterReads).toBe(0)
    }
  })
  it('parses the same descriptor snapshot as its key even if the caller changes during inspection', async () => {
    const raw = await content('cache.snapshot'), original = structuredClone(raw)
    const proxy = new Proxy(raw, { getOwnPropertyDescriptor(target, name) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, name)
      if (name === 'compatibility') target.campaign.title = 'Changed after the campaign snapshot was read'
      return descriptor
    } })
    const first = parseTtrpgRuntimeContentVersionedV1(proxy, raw.campaign.sourceWorld.contentHash, 2)
    expect(raw.campaign.title).not.toBe(original.campaign.title)
    expect(first.campaign.title).toBe(original.campaign.title)
    expect(parseTtrpgRuntimeContentVersionedV1(original, original.campaign.sourceWorld.contentHash, 2)).toEqual(first)
  })
  it('evicts bounded old entries while retaining exact validation when an old body returns', async () => {
    const raw = await content('cache.eviction.0'), spy = vi.spyOn(ruleParser, 'parseRulePackV2')
    let coldCalls = 0
    for (let i = 0; i < 9; i++) {
      raw.campaign.title = `cache.eviction.${i}`
      parseTtrpgRuntimeContentVersionedV1(raw, raw.campaign.sourceWorld.contentHash, 2)
      if (i === 0) coldCalls = spy.mock.calls.length
    }
    expect(coldCalls).toBeGreaterThan(0)
    expect(spy).toHaveBeenCalledTimes(coldCalls * 9)
    raw.campaign.title = 'cache.eviction.0'
    parseTtrpgRuntimeContentVersionedV1(raw, raw.campaign.sourceWorld.contentHash, 2)
    expect(spy).toHaveBeenCalledTimes(coldCalls * 10)
  })
  it('continues to revalidate actual rule and frozen fact hashes outside the structural memo', async () => {
    const raw = await content('cache.hash-authority')
    await expect(createTtrpgVerifiedContentViewV1(raw)).resolves.toMatchObject({ runFormat: 'open' })
    raw.rulePack.content.title = 'A different rule pack under the old claimed hash'
    await expect(createTtrpgVerifiedContentViewV1(raw)).rejects.toThrow(/contentHash/)
    await expect(createTtrpgVerifiedContentViewV1(raw)).rejects.toThrow(/contentHash/)
    const second = await content('cache.fact-authority')
    if (second.campaign.version !== 2) throw new Error('requires open fixture')
    second.campaign.frozenWorldPredicateIndex.entries[0].sourceFieldRefs[0].contentHash = 'f'.repeat(64)
    await expect(createTtrpgVerifiedContentViewV1(second)).rejects.toThrow(/indexHash/)
  })
  it('does not alias distinct accepted numeric values before their JSON serialization', async () => {
    const raw = await content('cache.negative-zero')
    if (raw.campaign.version !== 2) throw new Error('requires open fixture')
    raw.campaign.clocks[0].initialValue = -0
    const negative = parseTtrpgRuntimeContentVersionedV1(raw, raw.campaign.sourceWorld.contentHash, 2)
    if (negative.campaign.version !== 2) throw new Error('requires open fixture')
    expect(Object.is(negative.campaign.clocks[0].initialValue, -0)).toBe(true)
    raw.campaign.clocks[0].initialValue = 0
    const zero = parseTtrpgRuntimeContentVersionedV1(raw, raw.campaign.sourceWorld.contentHash, 2)
    if (zero.campaign.version !== 2) throw new Error('requires open fixture')
    expect(Object.is(zero.campaign.clocks[0].initialValue, -0)).toBe(false)
  })
  it('reuses only its deeply frozen runtime view while preserving separate mutable authoring parses', async () => {
    const raw = await content('cache.immutable-view'), spy = vi.spyOn(ruleParser, 'parseRulePackV2')
    const frozen = parseTtrpgFrozenRuntimeContentV1(raw, raw.campaign.sourceWorld.contentHash)
    const calls = spy.mock.calls.length
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(Object.isFrozen(frozen.campaign.characterTemplates[0].characterSheet)).toBe(true)
    expect(parseTtrpgFrozenRuntimeContentV1(frozen, raw.campaign.sourceWorld.contentHash)).toBe(frozen)
    expect(spy).toHaveBeenCalledTimes(calls)
    expect(() => { frozen.campaign.title = 'Cannot mutate a runtime snapshot' }).toThrow()
    const mutable = parseTtrpgRuntimeContentVersionedV1(frozen, raw.campaign.sourceWorld.contentHash, 2)
    expect(JSON.stringify(mutable)).toBe(JSON.stringify(frozen))
    mutable.campaign.title = 'Authoring callers retain an independent editable value'
    expect(frozen.campaign.title).toBe(raw.campaign.title)
    expect(() => parseTtrpgFrozenRuntimeContentV1(frozen, 'f'.repeat(64))).toThrow(/来源/)
  })
  it('never treats an externally frozen body as a validated identity', async () => {
    const raw = await content('cache.foreign-freeze')
    const frozen = parseTtrpgFrozenRuntimeContentV1(raw, raw.campaign.sourceWorld.contentHash)
    const copy = structuredClone(frozen)
    Object.defineProperty(copy.campaign, 'extra', { value: undefined, enumerable: true })
    Object.freeze(copy)
    expect(() => parseTtrpgFrozenRuntimeContentV1(copy, raw.campaign.sourceWorld.contentHash)).toThrow()
    expect(parseTtrpgFrozenRuntimeContentV1(frozen, raw.campaign.sourceWorld.contentHash)).toBe(frozen)
  })
  it('preserves escaped JSON text and null-prototype input on a cold snapshot and an exact warm read', async () => {
    const title = 'cache.roundtrip " \\ \n \u0000 \ud800 🌊 __proto__', raw = await content(title)
    Object.setPrototypeOf(raw, null); Object.setPrototypeOf(raw.campaign, null)
    const first = parseTtrpgFrozenRuntimeContentV1(raw, raw.campaign.sourceWorld.contentHash)
    expect(first.campaign.title).toBe(title)
    expect(parseTtrpgFrozenRuntimeContentV1(structuredClone(raw), raw.campaign.sourceWorld.contentHash)).toBe(first)
    const mutable = parseTtrpgRuntimeContentVersionedV1(raw, raw.campaign.sourceWorld.contentHash, 2)
    mutable.campaign.title = 'independent author copy'
    expect(first.campaign.title).toBe(title)
  })
  it('keeps an own prototype-named extra field distinct from a valid cached body and cannot pollute prototypes', async () => {
    const raw = await content('cache.proto-field'), frozen = parseTtrpgFrozenRuntimeContentV1(raw, raw.campaign.sourceWorld.contentHash)
    const altered = structuredClone(raw)
    Object.defineProperty(altered.campaign, '__proto__', { enumerable: true, value: { cachePolluted: true } })
    expect(() => parseTtrpgFrozenRuntimeContentV1(altered, raw.campaign.sourceWorld.contentHash)).toThrow()
    expect(Object.prototype).not.toHaveProperty('cachePolluted')
    expect(parseTtrpgFrozenRuntimeContentV1(raw, raw.campaign.sourceWorld.contentHash)).toBe(frozen)
  })
})
