import { parseAvgAudioProcessingRecipeV2, type AvgAudioProcessingRecipeV2, type AvgAudioDynamicsObservationV2 } from './audio-processing-contract-v2'
import { quantizeAvgAudioGainSampleV1 } from './audio-gain-kernel'
import { avgNumber } from './protocol-validation'

export const AVG_AUDIO_DSP_MAX_PHASES_V2 = 2048
export const AVG_AUDIO_DSP_MAX_TAPS_V2 = 384
export const AVG_AUDIO_DSP_MAX_RESAMPLE_MACS_V2 = 256000000
export interface AvgAudioDspInputV2 { pcm: ArrayBuffer; channelCount: number; sampleCount: number; sourceSampleRateHz: number; recipe: AvgAudioProcessingRecipeV2 }
const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a

/** Finite preflight, before allocating output or running any DSP. Unsupported
 * rational complexity is rejected, never approximated, truncated or retried. */
export function planAvgAudioDspLayoutV2(input: Omit<AvgAudioDspInputV2, 'pcm'>) {
  const recipe = parseAvgAudioProcessingRecipeV2(input.recipe)
  const channelCount = avgNumber(input.channelCount, 'DSP channels', 1, 2)
  const sampleCount = avgNumber(input.sampleCount, 'DSP source frames', 2, 48000 * 120)
  const sourceSampleRateHz = avgNumber(input.sourceSampleRateHz, 'DSP source rate', 8000, 48000)
  const outputSampleRateHz = recipe.targetSampleRateHz ?? sourceSampleRateHz
  const outputSampleCount = Math.round(sampleCount * outputSampleRateHz / sourceSampleRateHz)
  const bypass = sourceSampleRateHz === outputSampleRateHz
  const cutoff = Math.min(1, outputSampleRateHz / sourceSampleRateHz), radius = 32 / cutoff
  const halfTaps = Math.ceil(radius), taps = halfTaps * 2, phases = outputSampleRateHz / gcd(sourceSampleRateHz, outputSampleRateHz)
  if (outputSampleCount < 2 || outputSampleCount > 48000 * 120 || 44 + outputSampleCount * channelCount * 2 > 32 * 1024 * 1024
    || sampleCount * 1000 > recipe.maximumDurationMs * sourceSampleRateHz
    || outputSampleCount * 1000 > recipe.maximumDurationMs * outputSampleRateHz
    || Math.abs(Math.round(sampleCount * 1000 / sourceSampleRateHz) - Math.round(outputSampleCount * 1000 / outputSampleRateHz)) > 1
    || !bypass && (phases > AVG_AUDIO_DSP_MAX_PHASES_V2 || taps > AVG_AUDIO_DSP_MAX_TAPS_V2
      || outputSampleCount * taps * channelCount + phases * taps > AVG_AUDIO_DSP_MAX_RESAMPLE_MACS_V2)) {
    throw new Error('[avg-audio-process] 明确重采样超过有限帧数、相位、运算或时长上限，原件保留')
  }
  return { recipe, channelCount, sampleCount, sourceSampleRateHz, outputSampleRateHz, outputSampleCount, cutoff, radius, halfTaps, taps, phases, bypass }
}

/** Pure deterministic PCM arithmetic; no DB, network, decode or authority.
 * Formal compute and complete recomputation both execute in dedicated Workers. */
export function executeAvgAudioDspPcmV2(input: AvgAudioDspInputV2) {
  const layout = planAvgAudioDspLayoutV2(input), { recipe, channelCount, sampleCount, sourceSampleRateHz,
    outputSampleRateHz, outputSampleCount, cutoff, radius, halfTaps, taps, phases, bypass } = layout
  if (!(input.pcm instanceof ArrayBuffer) || input.pcm.byteLength > 32 * 1024 * 1024
    || input.pcm.byteLength !== sampleCount * channelCount * 2) throw new Error('[avg-audio-process] 原始PCM布局与冻结来源不一致')
  const source = new DataView(input.pcm), values = new Float64Array(outputSampleCount * channelCount)
  const kernels = new Map<number, Float64Array>(), divisor = gcd(sourceSampleRateHz, outputSampleRateHz)
  const phaseStep = sourceSampleRateHz / divisor
  const kernel = (phaseIndex: number) => {
    let found = kernels.get(phaseIndex)
    if (found) return found
    found = new Float64Array(taps)
    const fraction = phaseIndex / phases
    for (let tap = 0; tap < taps; tap++) {
      const distance = fraction - (tap - halfTaps + 1), normalized = distance / radius
      if (Math.abs(normalized) >= 1) continue
      const x = Math.PI * distance * cutoff
      const sinc = x === 0 ? 1 : Math.sin(x) / x
      found[tap] = cutoff * sinc * (.42 + .5 * Math.cos(Math.PI * normalized) + .08 * Math.cos(2 * Math.PI * normalized))
    }
    kernels.set(phaseIndex, found)
    return found
  }
  const gain = 10 ** (recipe.gainMilliDb / 20000)
  for (let frame = 0; frame < outputSampleCount; frame++) {
    if (bypass) {
      for (let ch = 0; ch < channelCount; ch++) values[frame * channelCount + ch] = source.getInt16((frame * channelCount + ch) * 2, true) * gain
      continue
    }
    const center = Math.floor(frame * sourceSampleRateHz / outputSampleRateHz)
    const weights = kernel((frame * phaseStep) % phases), start = center - halfTaps + 1
    let sum = 0
    for (let tap = 0; tap < taps; tap++) { const at = start + tap; if (at >= 0 && at < sampleCount) sum += weights[tap] }
    if (!Number.isFinite(sum) || Math.abs(sum) < 1e-12) throw new Error('[avg-audio-process] 重采样边界核无法归一化')
    for (let ch = 0; ch < channelCount; ch++) {
      let value = 0
      for (let tap = 0; tap < taps; tap++) {
        const at = start + tap
        if (at >= 0 && at < sampleCount) value += source.getInt16((at * channelCount + ch) * 2, true) * weights[tap]
      }
      values[frame * channelCount + ch] = value / sum * gain
    }
  }
  const dynamicsObservation: AvgAudioDynamicsObservationV2 = { limitedFrameCount: 0, maximumReductionMilliDb: 0 }
  const output = new ArrayBuffer(outputSampleCount * channelCount * 2), view = new DataView(output)
  const dynamics = recipe.dynamics
  // Integer-domain ceiling accounts for quantization. This is sampled peak,
  // not intersample true peak or a loudness/quality certificate.
  const ceiling = dynamics ? Math.floor(32768 * 10 ** (dynamics.ceilingMilliDbfs / 20000)) : 0
  const lookahead = dynamics ? Math.ceil(outputSampleRateHz * dynamics.lookaheadMs / 1000) : 0
  const release = dynamics ? Math.exp(-1 / (outputSampleRateHz * dynamics.releaseMs / 1000)) : 0
  const deque = dynamics ? new Int32Array(outputSampleCount) : null
  const peaks = dynamics ? new Float64Array(outputSampleCount) : null
  if (peaks) for (let frame = 0; frame < outputSampleCount; frame++) {
    let peak = 0
    for (let ch = 0; ch < channelCount; ch++) peak = Math.max(peak, Math.abs(values[frame * channelCount + ch]))
    peaks[frame] = peak
  }
  let head = 0, tail = 0, pushed = -1, prior = 1, minimum = 1
  for (let frame = 0; frame < outputSampleCount; frame++) {
    let envelope = 1
    if (dynamics && deque && peaks) {
      const last = Math.min(outputSampleCount - 1, frame + lookahead)
      while (pushed < last) {
        const next = ++pushed
        while (tail > head && peaks[deque[tail - 1]] <= peaks[next]) tail--
        deque[tail++] = next
      }
      while (head < tail && deque[head] < frame) head++
      const peak = peaks[deque[head]], required = peak > ceiling ? ceiling / peak : 1
      envelope = Math.min(required, prior * release + 1 - release); prior = envelope
      if (envelope < 1) dynamicsObservation.limitedFrameCount++
      minimum = Math.min(minimum, envelope)
    }
    for (let ch = 0; ch < channelCount; ch++) {
      const sample = quantizeAvgAudioGainSampleV1(values[frame * channelCount + ch], envelope)
      if (!Number.isFinite(sample) || dynamics && Math.abs(sample) > ceiling) throw new Error('[avg-audio-process] 动态输出未满足明确采样峰值上限')
      view.setInt16((frame * channelCount + ch) * 2, sample, true)
    }
  }
  dynamicsObservation.maximumReductionMilliDb = minimum < 1 ? Math.round(-20000 * Math.log10(minimum)) : 0
  return { pcm: output, channelCount, sampleCount: outputSampleCount, sampleRateHz: outputSampleRateHz, dynamicsObservation }
}
