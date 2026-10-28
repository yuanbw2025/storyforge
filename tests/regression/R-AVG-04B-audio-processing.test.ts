import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import { parseAvgSoundPlanV1, parseAvgAudioProcessingRecipeV1, assertAvgAudioProcessingReceiptV1 } from '../../src/lib/avg/sound-plan-contract'
import { parseAvgAudioProcessingReceiptV1, type AvgAudioProcessingRecipeV1, type AvgAudioProcessingReceiptV1 } from '../../src/lib/avg/audio-processing-contract'
import { processAvgAudioPcmWaveV1, assertAvgAudioProcessingWaveBytesV1, inspectAvgAudioProcessingWaveBytesV1 } from '../../src/lib/avg/audio-processing'
import { inspectAvgVoiceWaveV1 } from '../../src/lib/avg/voice-wave'

// Original tiny PCM frames, not human voice/music or a producer receipt.
function wave(samples: number[], channels = 2, rate = 24_000, metadata = false) {
  const bytes = new ArrayBuffer(44 + samples.length * 2 + (metadata ? 12 : 0)), view = new DataView(bytes)
  const text = (at: number, value: string) => [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)))
  text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true)
  view.setUint32(24, rate, true); view.setUint32(28, rate * channels * 2, true); view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples.length * 2, true)
  samples.forEach((value, i) => view.setInt16(44 + i * 2, value, true))
  if (metadata) { const at = 44 + samples.length * 2; text(at, 'JUNK'); view.setUint32(at + 4, 4, true); text(at + 8, 'keep') }
  return bytes
}
const recipe = (gainMilliDb = -20_000): AvgAudioProcessingRecipeV1 => ({ schema: 'storyforge.avg.audio-processing-recipe', version: 1,
  gainMilliDb, maximumDurationMs: 120_000, sampleRatePolicy: 'preserve', channelPolicy: 'preserve', timelinePolicy: 'preserve',
  overflowPolicy: 'reject', declaration: '原创 PCM 工程帧的本地增益；不签审听、许可或商业效果，也不准许自动采用。' })
async function input(data = wave([1, -1, 5, -5, 10, -10, 32767, -32768]), gainMilliDb = -20_000) {
  return { data, source: { contentHash: await sha256MediaData(data), mimeType: 'audio/wav' as const, kind: 'voice' as const }, recipe: recipe(gainMilliDb) }
}
async function rehash(receipt: AvgAudioProcessingReceiptV1) {
  const { receiptHash: _hash, ...body } = receipt
  return { ...body, receiptHash: await hashProductProductionValueV2(body) }
}
beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network is authorized by pure audio processing') })))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('AVG source-preserving PCM gain contracts without producer or adoption authority', () => {
  it('processes signed samples symmetrically without changing channels, 24k rate, exact frames or caller bytes', async () => {
    const source = await input(), before = source.data.slice(0), output = await processAvgAudioPcmWaveV1(source)
    const pcm = new DataView(output.data, 44)
    expect(Array.from({ length: 8 }, (_, i) => pcm.getInt16(i * 2, true))).toEqual([0, 0, 1, -1, 1, -1, 3277, -3277])
    expect(source.data).toEqual(before)
    expect(output.receipt).toMatchObject({ version: 1, processor: 'storyforge.avg.pcm16-gain.v1', source: {
      sampleRateHz: 24_000, channelCount: 2, sampleCount: 4, fullScaleSampleCount: 2 },
    output: { sampleRateHz: 24_000, channelCount: 2, sampleCount: 4, samplePeakInteger: 3277, fullScaleSampleCount: 0 } })
    expect(output.receipt.source.contentHash).toBe(source.source.contentHash)
    expect(output.receipt.output.contentHash).toBe(await sha256MediaData(output.data))
    expect(output.receipt.output.pcmHash).not.toBe(output.receipt.source.pcmHash)
    await expect(assertAvgAudioProcessingWaveBytesV1({ source: source.data, output: output.data, recipe: source.recipe, receipt: output.receipt })).resolves.toMatchObject({ receipt: output.receipt })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('preserves all original WAV and ancillary bytes exactly at zero gain', async () => {
    const source = await input(wave([32767, -32768, 123, -123], 2, 48_000, true), 0)
    const output = await processAvgAudioPcmWaveV1(source)
    expect(output.data).toEqual(source.data); expect(output.data).not.toBe(source.data)
    expect(output.receipt.output).toEqual(output.receipt.source)
    expect(inspectAvgVoiceWaveV1(output.data, 120_000)).toEqual(inspectAvgVoiceWaveV1(source.data, 120_000))
  })

  it('permits a declared boost with real headroom and rejects overflow without clipping or changing the raw', async () => {
    const safe = await input(wave([1000, -1000, 2000, -2000]), 20_000), amplified = await processAvgAudioPcmWaveV1(safe)
    expect(amplified.receipt.output.samplePeakInteger).toBe(20_000)
    const unsafe = await input(wave([20_000, -20_000, 10_000, -10_000]), 20_000), before = unsafe.data.slice(0)
    await expect(processAvgAudioPcmWaveV1(unsafe)).rejects.toThrow(/溢出/)
    expect(unsafe.data).toEqual(before); expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    { version: 2 }, { gainMilliDb: 0.1 }, { gainMilliDb: 24_001 }, { gainMilliDb: Number.NaN },
    { sampleRatePolicy: '48000' }, { overflowPolicy: 'clip' }, { declaration: '' }, { approved: true },
  ])('rejects an undeclared recipe variation %j without silently resampling, limiting or granting approval', patch => {
    expect(() => parseAvgAudioProcessingRecipeV1({ ...recipe(), ...patch })).toThrow()
  })

  it('rejects a dishonest source hash, MIME or kind and never consumes an approval field', async () => {
    const s = await input()
    for (const patch of [{ contentHash: 'f'.repeat(64) }, { mimeType: 'audio/ogg' }, { kind: 'music' }, { adopted: true }]) {
      await expect(processAvgAudioPcmWaveV1({ ...s, source: { ...s.source, ...patch } } as never)).rejects.toThrow()
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('captures raw bytes before hashing yields instead of following caller mutations', async () => {
    const s = await input(), before = s.data.slice(0), pending = processAvgAudioPcmWaveV1(s)
    new DataView(s.data).setInt16(44, 24_000, true)
    const output = await pending
    expect(output.receipt.source.contentHash).toBe(await sha256MediaData(before))
    expect(new DataView(output.data).getInt16(44, true)).toBe(0)
    expect(output.receipt.source.contentHash).not.toBe(await sha256MediaData(s.data))
  })

  it('rejects an already aborted request and a stop while the original hash is pending', async () => {
    const s = await input(), already = new AbortController(); already.abort()
    await expect(processAvgAudioPcmWaveV1({ ...s, signal: already.signal })).rejects.toMatchObject({ name: 'AbortError' })
    const late = new AbortController(), pending = processAvgAudioPcmWaveV1({ ...s, signal: late.signal }); late.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(await sha256MediaData(s.data)).toBe(s.source.contentHash)
  })

  it('checks receipt hashes, recipe binding, audio purpose and peak relations even after an outer rehash', async () => {
    const s = await input(), result = await processAvgAudioPcmWaveV1(s), r = result.receipt
    await expect(assertAvgAudioProcessingReceiptV1(s.recipe, { ...r, receiptHash: 'f'.repeat(64) })).rejects.toThrow(/回执/)
    await expect(assertAvgAudioProcessingReceiptV1(recipe(-10_000), r)).rejects.toThrow(/配方/)
    await expect(assertAvgAudioProcessingReceiptV1(s.recipe, await rehash({ ...r, output: { ...r.output, kind: 'bgm' } }))).rejects.toThrow(/时间轴/)
    await expect(assertAvgAudioProcessingReceiptV1(s.recipe, await rehash({ ...r, output: { ...r.output, samplePeakInteger: 2 } }))).rejects.toThrow(/峰值/)
    expect(() => parseAvgAudioProcessingReceiptV1({ ...r, adopted: true })).toThrow(/未知/)
  })

  it('rejects physical corruption and a rehashed ancillary-metadata edit independently of valid PCM observations', async () => {
    const s = await input(wave([1000, -1000, 2000, -2000], 2, 48_000, true)), result = await processAvgAudioPcmWaveV1(s)
    const corrupt = result.data.slice(0); new Uint8Array(corrupt)[44] ^= 1
    await expect(assertAvgAudioProcessingWaveBytesV1({ source: s.data, output: corrupt, recipe: s.recipe, receipt: result.receipt })).rejects.toThrow(/字节/)
    const metadata = result.data.slice(0); new Uint8Array(metadata)[metadata.byteLength - 1] ^= 1
    const output = await inspectAvgAudioProcessingWaveBytesV1(metadata, 'voice', s.recipe.maximumDurationMs)
    const forged = await rehash({ ...result.receipt, output })
    await expect(assertAvgAudioProcessingReceiptV1(s.recipe, forged)).resolves.toEqual(forged)
    await expect(assertAvgAudioProcessingWaveBytesV1({ source: s.data, output: metadata, recipe: s.recipe, receipt: forged })).rejects.toThrow(/非 PCM/)
  })

  it('enforces the exact frame-duration ceiling before millisecond rounding', async () => {
    const s = await input(wave(Array(8001).fill(100), 1, 8000))
    await expect(processAvgAudioPcmWaveV1({ ...s, recipe: { ...s.recipe, maximumDurationMs: 1000 } })).rejects.toThrow(/时长/)
  })

  it('keeps the original semantic sound plan strict and byte-equivalent, with no processing or approval alias', () => {
    const old = { schema: 'storyforge.avg.sound-plan', version: 1, direction: { goal: '工程', dialogueSpace: '对白', continuity: '衔接' },
      entries: [{ requirementKey: 'desk.bgm', designIntent: '背景', prompt: '原创纯器乐', librarySourceKey: null, acceptanceNotes: [] }] }
    expect(JSON.stringify(parseAvgSoundPlanV1(old))).toBe(JSON.stringify(old))
    expect(() => parseAvgSoundPlanV1({ ...old, processing: recipe() })).toThrow(/未知/)
    expect(() => parseAvgSoundPlanV1({ ...old, version: 2 })).toThrow(/版本/)
  })
})
