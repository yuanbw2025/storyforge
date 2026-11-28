import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentRunUtf8ByteLengthV1 } from '../../src/lib/agent/run/checkpoint-contract'

const NativeEncoder = TextEncoder
const encodedLength = (value: string) => new NativeEncoder().encode(value).byteLength

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('R-BUG831 · exact bounded-memory checkpoint UTF-8 counting', () => {
  it.each(['', 'plain ASCII', '汉字\u0000é', '😀𠀀', '\ud800', '\udc00', '\ud800x\udc00'])('keeps exact short-string bytes for %j', value => {
    expect(agentRunUtf8ByteLengthV1(value)).toBe(encodedLength(value))
  })

  it('matches the standard encoder across every UTF-16 code unit', () => {
    const value = Array.from({ length: 65_536 }, (_, index) => String.fromCharCode(index)).join('')
    expect(agentRunUtf8ByteLengthV1(value)).toBe(encodedLength(value))
  })

  it.each([16_383, 16_384, 32_767, 65_535])('keeps a surrogate pair and lone surrogates around offset %i', offset => {
    const value = '汉'.repeat(offset) + '😀\ud800X\udc00' + 'é'.repeat(70_000)
    expect(agentRunUtf8ByteLengthV1(value)).toBe(encodedLength(value))
  })

  it('uses bounded native chunks without a second payload-sized byte buffer', () => {
    const value = '汉😀é'.repeat(80_000)
    const expected = encodedLength(value)
    const calls: { inputLength: number; buffer: Uint8Array }[] = []
    class BoundedEncoder extends NativeEncoder {
      override encode(): Uint8Array<ArrayBuffer> { throw new Error('No full-payload encode allocation') }
      override encodeInto(input: string, destination: Uint8Array<ArrayBufferLike>): TextEncoderEncodeIntoResult {
        calls.push({ inputLength: input.length, buffer: destination })
        return super.encodeInto(input, destination)
      }
    }
    vi.stubGlobal('TextEncoder', BoundedEncoder)
    expect(agentRunUtf8ByteLengthV1(value)).toBe(expected)
    expect(calls.length).toBeGreaterThan(1)
    expect(new Set(calls.map(call => call.buffer)).size).toBe(1)
    expect(Math.max(...calls.map(call => call.buffer.byteLength))).toBeLessThanOrEqual(64 * 1024)
    expect(Math.max(...calls.map(call => call.inputLength))).toBeLessThanOrEqual(16 * 1024 + 1)
  })

  it.each(['missing', 'encode-only', 'partial'] as const)('keeps original exact fallback for a %s native implementation', mode => {
    const value = '汉😀\ud800x\udc00'.repeat(20_000)
    const expected = encodedLength(value)
    if (mode === 'missing') vi.stubGlobal('TextEncoder', undefined)
    else if (mode === 'encode-only') {
      class EncodeOnly { encode(input: string) { return new NativeEncoder().encode(input) } }
      vi.stubGlobal('TextEncoder', EncodeOnly)
    }
    else {
      class PartialEncoder extends NativeEncoder {
        override encodeInto(): TextEncoderEncodeIntoResult { return { read: 1, written: 1 } }
      }
      vi.stubGlobal('TextEncoder', PartialEncoder)
    }
    expect(agentRunUtf8ByteLengthV1(value)).toBe(expected)
  })
})
