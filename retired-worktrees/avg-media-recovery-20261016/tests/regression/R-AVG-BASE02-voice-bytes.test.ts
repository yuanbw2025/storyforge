import { afterEach, describe, expect, it, vi } from 'vitest'
import { sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import * as runtimeVerifier from '../../src/lib/product-production/media-runtime-verifier'
import type { ProductMediaRuntimeMeasurementV1 } from '../../src/lib/product-production/quality-receipts'
import { inspectAvgVoiceWaveV1 } from '../../src/lib/avg/voice-wave'
import { inspectAvgVoiceBytesV1 } from '../../src/lib/avg/voice-decoder'

/** Original half-second PCM tone, not human speech or a provider response. */
function waveFixture(extra: { id: string; bytes: number[] }[] = []) {
  const format = new Uint8Array(16), fmt = new DataView(format.buffer)
  fmt.setUint16(0, 1, true); fmt.setUint16(2, 1, true); fmt.setUint32(4, 24_000, true)
  fmt.setUint32(8, 48_000, true); fmt.setUint16(12, 2, true); fmt.setUint16(14, 16, true)
  const pcm = new Uint8Array(24_000), samples = new DataView(pcm.buffer)
  for (let index = 0; index < 12_000; index++) samples.setInt16(index * 2, Math.round(8000 * Math.sin(index * Math.PI / 30)), true)
  const chunks = [{ id: 'fmt ', bytes: Array.from(format) }, ...extra, { id: 'data', bytes: Array.from(pcm) }]
  const output = new ArrayBuffer(12 + chunks.reduce((size, chunk) => size + 8 + chunk.bytes.length + chunk.bytes.length % 2, 0))
  const bytes = new Uint8Array(output), view = new DataView(output)
  const text = (offset: number, value: string) => Array.from(value).forEach((c, index) => { bytes[offset + index] = c.charCodeAt(0) })
  text(0, 'RIFF'); text(8, 'WAVE'); view.setUint32(4, bytes.length - 8, true)
  let offset = 12
  for (const chunk of chunks) {
    text(offset, chunk.id); view.setUint32(offset + 4, chunk.bytes.length, true); bytes.set(chunk.bytes, offset + 8)
    offset += 8 + chunk.bytes.length + chunk.bytes.length % 2
  }
  return output
}

function mockDecoded(patch: Record<string, unknown> = {}) {
  return vi.spyOn(runtimeVerifier, 'verifyProductMediaRuntimeUrlsV1').mockImplementation(async input => ({
    measuredAt: 1, environment: input.environment, assets: [{
      assetKey: input.assets[0]!.assetKey, contentHash: input.assets[0]!.contentHash, mimeType: 'audio/wav',
      mediaClass: 'audio', status: 'decoded', decodedWidth: null, decodedHeight: null,
      decodedDurationMs: 500, decodedHasAlpha: null, decodedChannelCount: 1, decodedSampleRateHz: 48_000,
      integratedLufs: -18, truePeakDbtp: -12, loopSeamDbfs: -40, policyFailures: [], failureCode: null,
      ...patch,
    }],
  }))
}

async function decoderInput(data = waveFixture()) {
  return { data, assetKey: 'voice.desk', contentHash: await sha256MediaData(data), maximumDurationMs: 30_000 }
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('AVG BASE-02 bounded generated voice bytes', () => {
  it('counts real PCM frames and accepts padded metadata without estimating duration from text', () => {
    const data = waveFixture([{ id: 'JUNK', bytes: [1, 2, 3] }])
    expect(inspectAvgVoiceWaveV1(data, 30_000)).toEqual({ codec: 'pcm-s16le', channelCount: 1,
      sampleRateHz: 24_000, sampleCount: 12_000, durationMs: 500, dataOffset: 56, dataByteSize: 24_000 })
  })

  it('rejects container lies, incomplete chunks, missing padding and fake RIFF headers', () => {
    const original = waveFixture([{ id: 'JUNK', bytes: [1, 2, 3] }])
    for (const mutate of [
      (v: DataView) => v.setUint32(4, original.byteLength, true),
      (v: DataView) => v.setUint32(40, 0xffffffff, true),
      (v: DataView) => v.setUint32(40, 11, true),
      (v: DataView) => v.setUint8(0, 0),
    ]) {
      const data = original.slice(0); mutate(new DataView(data))
      expect(() => inspectAvgVoiceWaveV1(data, 30_000)).toThrow(/WAV/)
    }
    for (const data of [new ArrayBuffer(0), original.slice(0, 12), original.slice(0, 47)]) {
      expect(() => inspectAvgVoiceWaveV1(data, 30_000)).toThrow(/WAV/)
    }
  })

  it.each([
    [20, 3], [22, 8], [24, 96_000], [28, 24_000], [32, 1], [34, 32],
  ])('rejects unsupported or inconsistent format metadata at byte %i', (offset, value) => {
    const data = waveFixture(), view = new DataView(data)
    if ([24, 28].includes(offset)) view.setUint32(offset, value, true)
    else view.setUint16(offset, value, true)
    expect(() => inspectAvgVoiceWaveV1(data, 30_000)).toThrow(/PCM16/)
  })

  it('rejects duplicate data, missing samples, partial frames and excessive chunk counts', () => {
    expect(() => inspectAvgVoiceWaveV1(waveFixture([{ id: 'data', bytes: [0, 0] }]), 30_000)).toThrow(/重复/)
    expect(() => inspectAvgVoiceWaveV1(waveFixture([{ id: 'data', bytes: [0] }]), 30_000)).toThrow(/完整帧/)
    expect(() => inspectAvgVoiceWaveV1(waveFixture(Array.from({ length: 127 }, () => ({ id: 'JUNK', bytes: [] }))), 30_000)).toThrow(/分块数量/)
    const data = waveFixture(), view = new DataView(data)
    view.setUint32(40, 0, true)
    expect(() => inspectAvgVoiceWaveV1(data, 30_000)).toThrow(/样本/)
  })

  it('enforces an exact frame ceiling even when the excess would round down to the same millisecond', () => {
    const data = waveFixture(), view = new DataView(data)
    // 12,000 frames at 8 kHz are 1,500 ms; 12,001 exceed that ceiling.
    view.setUint32(24, 8000, true); view.setUint32(28, 16_000, true)
    expect(inspectAvgVoiceWaveV1(data, 1500).durationMs).toBe(1500)
    const extended = new Uint8Array(data.byteLength + 2); extended.set(new Uint8Array(data))
    const larger = new DataView(extended.buffer)
    larger.setUint32(4, extended.length - 8, true); larger.setUint32(40, 24_002, true)
    expect(() => inspectAvgVoiceWaveV1(extended.buffer, 1500)).toThrow(/真实帧数/)
  })

  it('uses actual browser measurements and releases the copied-byte URL, without an artistic or author pass', async () => {
    const decode = mockDecoded(), revoked = vi.spyOn(URL, 'revokeObjectURL')
    const input = await decoderInput(), result = await inspectAvgVoiceBytesV1(input)
    expect(result.data).not.toBe(input.data)
    expect(result.measurement).toMatchObject({ durationMs: 500, channelCount: 1,
      sourceSampleRateHz: 24_000, decodedSampleRateHz: 48_000, sampleCount: 12_000 })
    expect(Object.keys(result)).toEqual(['data', 'measurement'])
    expect(decode).toHaveBeenCalledOnce(); expect(revoked).toHaveBeenCalledOnce()
    expect(decode.mock.calls[0]![0].assets[0]!.durationMs).toBeNull()
  })

  it('refuses a byte hash mismatch before the decoder is reached', async () => {
    const decode = mockDecoded(), input = await decoderInput()
    await expect(inspectAvgVoiceBytesV1({ ...input, contentHash: 'a'.repeat(64) })).rejects.toThrow(/hash/)
    expect(decode).not.toHaveBeenCalled()
  })

  it.each([
    { status: 'failed', failureCode: 'audio-decode-failed' }, { decodedDurationMs: 800 },
    { decodedChannelCount: 2 }, { decodedDurationMs: null }, { decodedSampleRateHz: null },
    { integratedLufs: Number.NaN }, { truePeakDbtp: -200 }, { contentHash: 'b'.repeat(64) },
  ])('refuses damaged, misbound, silent or invalid decoded evidence %j', async patch => {
    mockDecoded(patch); const revoked = vi.spyOn(URL, 'revokeObjectURL')
    await expect(inspectAvgVoiceBytesV1(await decoderInput())).rejects.toThrow()
    expect(revoked).toHaveBeenCalledOnce()
  })

  it('cancels without accepting a late decode or leaking an object URL', async () => {
    const input = await decoderInput(), controller = new AbortController()
    let complete!: (value: ProductMediaRuntimeMeasurementV1) => void
    // The unresolved verifier is a test boundary, not a real audio measurement.
    const pending = new Promise<ProductMediaRuntimeMeasurementV1>((resolve) => { complete = resolve })
    const decode = vi.spyOn(runtimeVerifier, 'verifyProductMediaRuntimeUrlsV1').mockImplementation(() => pending)
    const revoked = vi.spyOn(URL, 'revokeObjectURL')
    const operation = inspectAvgVoiceBytesV1({ ...input, signal: controller.signal })
    const rejected = expect(operation).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce())
    controller.abort(); await rejected
    expect(revoked).toHaveBeenCalledOnce()
    complete({ assets: [], measuredAt: 1, environment: { browserName: 'fixture', browserVersion: 'fixture',
      platform: 'fixture', viewport: { width: 1, height: 1 } } })
    const stopped = new AbortController(); stopped.abort()
    await expect(inspectAvgVoiceBytesV1({ ...input, signal: stopped.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(decode).toHaveBeenCalledOnce()
  })
})
