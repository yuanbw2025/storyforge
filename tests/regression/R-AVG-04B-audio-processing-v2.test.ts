// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { audioRecipeV2, audioPcmV2, audioWaveV2 } from '../helpers/avg-audio-v2-fixture'
import { parseAvgAudioProcessingRecipeV1, parseAvgAudioProcessingReceiptV1 } from '../../src/lib/avg/audio-processing-contract'
import { parseAvgAudioProcessingRecipeV2, assertAvgAudioProcessingReceiptV2 } from '../../src/lib/avg/audio-processing-contract-v2'
import { parseAvgAudioProcessingRecipe, parseAvgAudioProcessingReceipt, assertAvgAudioProcessingReceipt } from '../../src/lib/avg/audio-processing-versioned-contract'
import { executeAvgAudioDspPcmV2, planAvgAudioDspLayoutV2 } from '../../src/lib/avg/audio-dsp-kernel-v2'
import { processAvgAudioPcmWaveV2 } from '../../src/lib/avg/audio-processing-v2'
import { processAvgAudioPcmWave } from '../../src/lib/avg/audio-processing-dispatch'
import { inspectAvgVoiceWaveV1 } from '../../src/lib/avg/voice-wave'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { inspectAvgAudioProcessingWaveBytesV1 } from '../../src/lib/avg/audio-processing'

describe('AVG explicit dynamics and rational resampling V2 numeric contract', () => {
  it('keeps the original recipe strict and rejects ambiguous rates, unknown DSP and unbounded parameters', () => {
    expect(() => parseAvgAudioProcessingRecipeV1(audioRecipeV2())).toThrow()
    expect(parseAvgAudioProcessingRecipe(audioRecipeV2()).version).toBe(2)
    for (const patch of [{ version: 3 }, { sampleRatePolicy: 'preserve' }, { targetSampleRateHz: null },
      { resampler: 'header-only' }, { processingOrder: 'gain-resample-limit' }, { targetSampleRateHz: 96000 },
      { dynamics: { processor: 'linked-lookahead-peak-limit.v1', ceilingMilliDbfs: -100, lookaheadMs: 3, releaseMs: 80 } },
      { dynamics: { processor: 'linked-lookahead-peak-limit.v1', ceilingMilliDbfs: -1500, lookaheadMs: 0, releaseMs: 80 } },
      { approved: true }]) expect(() => parseAvgAudioProcessingRecipeV2({ ...audioRecipeV2(), ...patch })).toThrow()
    expect(parseAvgAudioProcessingRecipeV2(audioRecipeV2({ sampleRatePolicy: 'preserve', targetSampleRateHz: null })).targetSampleRateHz).toBeNull()
  })
  it('writes actual twice-count PCM and a valid 48k WAV, retaining the original full container and sample timing', async () => {
    const original = await audioWaveV2(), before = original.data.slice(0)
    const result = await processAvgAudioPcmWaveV2({ ...original, recipe: audioRecipeV2() })
    const wave = inspectAvgVoiceWaveV1(result.data, 1000)
    expect(wave).toMatchObject({ sampleRateHz: 48000, sampleCount: 4800, durationMs: 100, dataOffset: 44, dataByteSize: 9600 })
    expect(result.data.byteLength).toBe(9644)
    const raw = new DataView(before), output = new DataView(result.data)
    for (let frame = 0; frame < 2400; frame++) expect(output.getInt16(44 + frame * 4, true)).toBe(raw.getInt16(44 + frame * 2, true))
    expect(output.getInt16(44 + 2, true)).not.toBe(output.getInt16(44, true))
    expect(new Uint8Array(original.data)).toEqual(new Uint8Array(before))
    expect(result.receipt.source.contentHash).toBe(original.source.contentHash)
    expect(result.receipt.output.contentHash).not.toBe(original.source.contentHash)
    expect(parseAvgAudioProcessingReceipt(result.receipt)).toEqual(result.receipt)
    expect(await assertAvgAudioProcessingReceiptV2(audioRecipeV2(), result.receipt)).toEqual(result.receipt)
  })
  it('supports rational 44.1k conversion and stereo phase without relabeling the source frames', () => {
    const pcm = audioPcmV2(44100, 4410, 2), source = new DataView(pcm)
    // Freeze an exactly linked source, rather than independently quantizing
    // two ideal sine waves and mistaking their source rounding for DSP drift.
    for (let frame = 0; frame < 4410; frame++) source.setInt16(frame * 4, 2 * source.getInt16(frame * 4 + 2, true), true)
    const original = pcm.slice(0)
    const output = executeAvgAudioDspPcmV2({ pcm, channelCount: 2, sampleCount: 4410, sourceSampleRateHz: 44100, recipe: audioRecipeV2() })
    expect(output).toMatchObject({ channelCount: 2, sampleCount: 4800, sampleRateHz: 48000 })
    const samples = new DataView(output.pcm)
    for (let frame = 128; frame < output.sampleCount - 128; frame++) {
      expect(Math.abs(samples.getInt16(frame * 4, true) - 2 * samples.getInt16(frame * 4 + 2, true))).toBeLessThanOrEqual(1)
    }
    expect(new Uint8Array(pcm)).toEqual(new Uint8Array(original))
  })
  it('uses an anti-alias low-pass for downsampling and preserves in-band amplitude', () => {
    const rms = (frequency: number) => {
      const output = executeAvgAudioDspPcmV2({ pcm: audioPcmV2(48000, 48000, 1, frequency, 10000), channelCount: 1,
        sampleCount: 48000, sourceSampleRateHz: 48000, recipe: audioRecipeV2({ targetSampleRateHz: 16000 }) })
      const samples = new DataView(output.pcm); let energy = 0
      for (let frame = 128; frame < output.sampleCount - 128; frame++) energy += samples.getInt16(frame * 2, true) ** 2
      return Math.sqrt(energy / (output.sampleCount - 256))
    }
    const inBand = rms(1000), aboveNyquist = rms(12000)
    expect(Math.abs(inBand - 10000 / Math.sqrt(2))).toBeLessThan(15)
    expect(aboveNyquist / inBand).toBeLessThan(.01)
  })
  it('anticipates peaks with a linked envelope, preserves stereo relation and reports actual limiting', () => {
    const pcm = new ArrayBuffer(2400 * 4), source = new DataView(pcm)
    for (let frame = 0; frame < 2400; frame++) { source.setInt16(frame * 4, frame === 500 ? 30000 : 8000, true); source.setInt16(frame * 4 + 2, frame === 500 ? 15000 : 4000, true) }
    const recipe = audioRecipeV2({ sampleRatePolicy: 'preserve', targetSampleRateHz: null, gainMilliDb: 6000,
      dynamics: { processor: 'linked-lookahead-peak-limit.v1', ceilingMilliDbfs: -1500, lookaheadMs: 3, releaseMs: 80 } })
    const result = executeAvgAudioDspPcmV2({ pcm, channelCount: 2, sampleCount: 2400, sourceSampleRateHz: 24000, recipe })
    expect(result.dynamicsObservation.limitedFrameCount).toBeGreaterThan(0)
    expect(result.dynamicsObservation.maximumReductionMilliDb).toBeGreaterThan(0)
    const output = new DataView(result.pcm), ceiling = Math.floor(32768 * 10 ** (-1500 / 20000))
    for (let frame = 0; frame < result.sampleCount; frame++) {
      expect(Math.abs(output.getInt16(frame * 4, true))).toBeLessThanOrEqual(ceiling)
      expect(Math.abs(output.getInt16(frame * 4, true) - 2 * output.getInt16(frame * 4 + 2, true))).toBeLessThanOrEqual(1)
    }
    expect(output.getInt16((500 - 60) * 4, true)).toBeLessThan(output.getInt16((500 - 80) * 4, true))
  })
  it('rejects overflow without selected dynamics and rejects excessive work without truncation', () => {
    const pcm = audioPcmV2(24000, 2400, 1, 1000, 30000)
    expect(() => executeAvgAudioDspPcmV2({ pcm, channelCount: 1, sampleCount: 2400, sourceSampleRateHz: 24000,
      recipe: audioRecipeV2({ sampleRatePolicy: 'preserve', targetSampleRateHz: null, gainMilliDb: 24000 }) })).toThrow(/溢出/)
    expect(() => planAvgAudioDspLayoutV2({ channelCount: 2, sampleCount: 48000 * 120, sourceSampleRateHz: 48000,
      recipe: audioRecipeV2({ maximumDurationMs: 120000, targetSampleRateHz: 8000 }) })).toThrow(/上限/)
    expect(() => planAvgAudioDspLayoutV2({ channelCount: 1, sampleCount: 24000, sourceSampleRateHz: 24000,
      recipe: audioRecipeV2({ targetSampleRateHz: 44101 }) })).toThrow(/上限/)
  })
  it('rejects forged rate/frame and dynamics observations even after rehashing their receipt', async () => {
    const source = await audioWaveV2(), recipe = audioRecipeV2(), result = await processAvgAudioPcmWaveV2({ ...source, recipe })
    const { receiptHash: _receiptHash, ...body } = result.receipt
    const bad = { ...body, dynamicsObservation: { limitedFrameCount: 1, maximumReductionMilliDb: 1000 } }
    await expect(assertAvgAudioProcessingReceiptV2(recipe, { ...bad, receiptHash: await hashProductProductionValueV2(bad) })).rejects.toThrow()
    const rate = { ...body, output: { ...body.output, sampleRateHz: 24000, sampleCount: 2400, durationMs: 100, dataByteSize: 4800, byteSize: 4844 } }
    await expect(assertAvgAudioProcessingReceiptV2(recipe, { ...rate, receiptHash: await hashProductProductionValueV2(rate) })).rejects.toThrow()
    await expect(assertAvgAudioProcessingReceiptV2({ ...recipe, gainMilliDb: -1000 }, result.receipt)).rejects.toThrow()
    expect(() => parseAvgAudioProcessingReceiptV1(result.receipt)).toThrow()
  })
  it('refuses a header-only rate edit even when the edited container and receipt hashes are accurate', async () => {
    const source = await audioWaveV2(), recipe = audioRecipeV2(), result = await processAvgAudioPcmWaveV2({ ...source, recipe })
    const headerOnly = source.data.slice(0), view = new DataView(headerOnly)
    view.setUint32(24, 48000, true); view.setUint32(28, 96000, true)
    const observation = await inspectAvgAudioProcessingWaveBytesV1(headerOnly, 'voice', 1000)
    expect(observation.sampleCount).toBe(2400); expect(observation.durationMs).toBe(50)
    const { receiptHash: _receiptHash, ...body } = result.receipt, forged = { ...body, output: observation }
    await expect(assertAvgAudioProcessingReceiptV2(recipe, { ...forged, receiptHash: await hashProductProductionValueV2(forged) })).rejects.toThrow(/时间轴/)
  })
  it('dispatches original V1 without changing its receipt or metadata preservation', async () => {
    const source = await audioWaveV2(), recipe = { schema: 'storyforge.avg.audio-processing-recipe' as const, version: 1 as const,
      gainMilliDb: 0, maximumDurationMs: 1000, sampleRatePolicy: 'preserve' as const, channelPolicy: 'preserve' as const,
      timelinePolicy: 'preserve' as const, overflowPolicy: 'reject' as const, declaration: 'Original V1 unchanged.' }
    const result = await processAvgAudioPcmWave({ ...source, recipe })
    expect(result.receipt.version).toBe(1); expect(new Uint8Array(result.data)).toEqual(new Uint8Array(source.data))
    expect(() => assertAvgAudioProcessingReceipt(audioRecipeV2(), result.receipt)).toThrow(/版本/)
  })
})
