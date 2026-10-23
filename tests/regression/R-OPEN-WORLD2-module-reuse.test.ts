import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import * as runtimePackage from '../../src/lib/open-world/runtime-package'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

afterEach(() => vi.restoreAllMocks())

describe('Open world module validation reuse', () => {
  it('reuses identical complete JSON without exposing the validated result to mutations', () => {
    const runtime = createTextOpenWorldVNextFixture()
    runtime.metadata.title = 'reuse-independent-results'
    const parse = vi.spyOn(runtimePackage, 'parseTextOpenWorldRuntimePackageV1')
    const first = parseTextOpenWorldModulesV1(runtime)
    const expectedTitle = first.narrative.scenes[0]!.title
    first.narrative.scenes[0]!.title = 'caller changed this'
    const second = parseTextOpenWorldModulesV1(structuredClone(runtime))
    expect(parse).toHaveBeenCalledTimes(1)
    expect(second.narrative.scenes[0]!.title).toBe(expectedTitle)
    second.narrative.scenes[0]!.title = 'another caller changed this'
    expect(parseTextOpenWorldModulesV1(runtime).narrative.scenes[0]!.title).toBe(expectedTitle)
  })

  it('revalidates mutated contents even when module hashes and object identity remain unchanged', () => {
    const runtime = createTextOpenWorldVNextFixture()
    runtime.metadata.title = 'reuse-source-mutation'
    parseTextOpenWorldModulesV1(runtime)
    const narrative = runtime.modules.narrative.payload as { scenes: Array<{ locationKey: string }> }
    narrative.scenes[0]!.locationKey = 'location.missing'
    expect(() => parseTextOpenWorldModulesV1(runtime)).toThrow('scene location 引用不存在')
    expect(() => parseTextOpenWorldModulesV1(JSON.stringify(runtime))).toThrow('scene location 引用不存在')
  })

  it('does not let lossy JSON values or a toJSON hook impersonate a cached valid package', () => {
    const runtime = createTextOpenWorldVNextFixture()
    runtime.metadata.title = 'reuse-lossy-json'
    parseTextOpenWorldModulesV1(runtime)
    expect(() => parseTextOpenWorldModulesV1({ ...runtime, extra: undefined })).toThrow(/字段不符合合同/)
    const invalid = structuredClone(runtime)
    ;(invalid.modules.narrative.payload as { scenes: Array<{ locationKey: string }> })
      .scenes[0]!.locationKey = 'location.missing'
    Object.defineProperty(invalid, 'toJSON', { value: () => runtime })
    expect(() => parseTextOpenWorldModulesV1(invalid)).toThrow('scene location 引用不存在')
  })

  it('preserves raw string spelling and validates each distinct source instead of trusting its declared hash', () => {
    const runtime = createTextOpenWorldVNextFixture()
    runtime.metadata.title = 'reuse-raw-text'
    const narrative = runtime.modules.narrative.payload as { scenes: Array<{ title: string }> }
    narrative.scenes[0]!.title = 'caf\u00e9'
    const composed = parseTextOpenWorldModulesV1(runtime)
    narrative.scenes[0]!.title = 'cafe\u0301'
    const decomposed = parseTextOpenWorldModulesV1(runtime)
    expect(composed.narrative.scenes[0]!.title).toBe('caf\u00e9')
    expect(decomposed.narrative.scenes[0]!.title).toBe('cafe\u0301')
  })

  it('does not reuse entries when serialization would erase an invalid extra field', () => {
    const runtime = createTextOpenWorldVNextFixture()
    runtime.metadata.title = 'reuse-serialization-types'
    parseTextOpenWorldModulesV1(runtime)
    for (const extra of [undefined, () => 1, Symbol('hidden'), 1n, NaN, Infinity]) {
      expect(() => parseTextOpenWorldModulesV1({ ...runtime, extra })).toThrow(/字段不符合合同/)
    }
    const getter = { ...runtime }
    Object.defineProperty(getter, 'metadata', { enumerable: true, get: () => runtime.metadata })
    const parse = vi.spyOn(runtimePackage, 'parseTextOpenWorldRuntimePackageV1')
    parseTextOpenWorldModulesV1(getter)
    parseTextOpenWorldModulesV1(getter)
    expect(parse).toHaveBeenCalledTimes(2)
  })

  it('retains at most the last package and revalidates a replaced one', () => {
    const first = createTextOpenWorldVNextFixture()
    first.metadata.title = 'reuse-first'
    const second = structuredClone(first)
    second.metadata.title = 'reuse-second'
    const parse = vi.spyOn(runtimePackage, 'parseTextOpenWorldRuntimePackageV1')
    parseTextOpenWorldModulesV1(first)
    parseTextOpenWorldModulesV1(second)
    parseTextOpenWorldModulesV1(first)
    expect(parse).toHaveBeenCalledTimes(3)
  })
})
