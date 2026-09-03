export interface DecodedProductAudioPcmV1 {
  channels: Float32Array[]
  sampleRateHz: number
}

export interface ProductAudioQualityAnalysisV1 {
  channelCount: number
  sampleRateHz: number
  durationMs: number
  integratedLufs: number
  truePeakDbtp: number
  loopSeamDbfs: number
}

interface BiquadCoefficients {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

const round = (value: number, digits = 2): number => Number(value.toFixed(digits))
const db = (amplitude: number): number => 20 * Math.log10(Math.max(amplitude, 1e-10))

function highShelf(sampleRateHz: number): BiquadCoefficients {
  // ITU-R BS.1770 K-weighting pre-filter parameters used by the EBU reference
  // implementation. Coefficients are derived for the decoded sample rate.
  const frequency = 1_681.974_450_955_533
  const gainDb = 3.999_843_853_973_347
  const quality = 0.707_175_236_955_419_6
  const k = Math.tan(Math.PI * frequency / sampleRateHz)
  const vh = 10 ** (gainDb / 20)
  const vb = vh ** 0.499_666_774_154_541_6
  const denominator = 1 + k / quality + k * k
  return {
    b0: (vh + vb * k / quality + k * k) / denominator,
    b1: 2 * (k * k - vh) / denominator,
    b2: (vh - vb * k / quality + k * k) / denominator,
    a1: 2 * (k * k - 1) / denominator,
    a2: (1 - k / quality + k * k) / denominator,
  }
}

function rlbHighPass(sampleRateHz: number): BiquadCoefficients {
  const frequency = 38.135_470_876_024_44
  const quality = 0.500_327_037_323_877_3
  const k = Math.tan(Math.PI * frequency / sampleRateHz)
  const denominator = 1 + k / quality + k * k
  return {
    b0: 1 / denominator,
    b1: -2 / denominator,
    b2: 1 / denominator,
    a1: 2 * (k * k - 1) / denominator,
    a2: (1 - k / quality + k * k) / denominator,
  }
}

function filter(samples: Float32Array, coefficients: BiquadCoefficients): Float64Array {
  const output = new Float64Array(samples.length)
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0
  for (let index = 0; index < samples.length; index += 1) {
    const x0 = samples[index]
    const y0 = coefficients.b0 * x0 + coefficients.b1 * x1 + coefficients.b2 * x2
      - coefficients.a1 * y1 - coefficients.a2 * y2
    output[index] = y0
    x2 = x1; x1 = x0; y2 = y1; y1 = y0
  }
  return output
}

function kWeighted(samples: Float32Array, sampleRateHz: number): Float64Array {
  const first = filter(samples, highShelf(sampleRateHz))
  const asFloat = Float32Array.from(first)
  return filter(asFloat, rlbHighPass(sampleRateHz))
}

function integratedLoudness(channels: Float32Array[], sampleRateHz: number): number {
  const weighted = channels.map(channel => kWeighted(channel, sampleRateHz))
  const blockLength = Math.max(1, Math.round(sampleRateHz * 0.4))
  const stepLength = Math.max(1, Math.round(sampleRateHz * 0.1))
  const energies: number[] = []
  const length = weighted[0].length
  if (length < blockLength) {
    let energy = 0
    for (const channel of weighted) {
      for (const sample of channel) energy += sample * sample
    }
    energies.push(energy / Math.max(1, length))
  } else {
    for (let start = 0; start + blockLength <= length; start += stepLength) {
      let energy = 0
      for (const channel of weighted) {
        let sum = 0
        for (let index = start; index < start + blockLength; index += 1) sum += channel[index] ** 2
        energy += sum / blockLength
      }
      energies.push(energy)
    }
  }
  const loudness = (energy: number) => -0.691 + 10 * Math.log10(Math.max(energy, 1e-20))
  const absolute = energies.filter(energy => loudness(energy) >= -70)
  if (!absolute.length) return -120
  const preliminaryEnergy = absolute.reduce((sum, value) => sum + value, 0) / absolute.length
  const relativeThreshold = loudness(preliminaryEnergy) - 10
  const gated = absolute.filter(energy => loudness(energy) >= relativeThreshold)
  const finalEnergy = gated.reduce((sum, value) => sum + value, 0) / gated.length
  return loudness(finalEnergy)
}

function cubicPeak(channels: Float32Array[]): number {
  let peak = 0
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      peak = Math.max(peak, Math.abs(channel[index]))
      if (index + 1 >= channel.length) continue
      const p0 = channel[Math.max(0, index - 1)]
      const p1 = channel[index]
      const p2 = channel[index + 1]
      const p3 = channel[Math.min(channel.length - 1, index + 2)]
      for (const t of [0.25, 0.5, 0.75]) {
        const value = 0.5 * ((2 * p1) + (-p0 + p2) * t
          + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
          + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)
        peak = Math.max(peak, Math.abs(value))
      }
    }
  }
  return peak
}

function loopSeam(channels: Float32Array[]): number {
  let discontinuity = 0
  for (const channel of channels) {
    if (channel.length < 3) continue
    const last = channel.length - 1
    const predictedFirst = channel[last] + (channel[last] - channel[last - 1])
    const boundarySlope = channel[0] - channel[last]
    const openingSlope = channel[1] - channel[0]
    discontinuity = Math.max(
      discontinuity,
      Math.abs(predictedFirst - channel[0]),
      Math.abs(boundarySlope - openingSlope),
    )
  }
  return db(discontinuity)
}

/**
 * Versioned local PCM analyzer used only after the browser has decoded the
 * exact Build blob. Loudness follows the BS.1770 block/gating model; true peak
 * uses deterministic 4x cubic inter-sample probing and is intentionally tied
 * to the receipt verifier version so a future certified meter cannot silently
 * reinterpret an older pass.
 */
export function analyzeDecodedProductAudioPcmV1(input: DecodedProductAudioPcmV1): ProductAudioQualityAnalysisV1 {
  if (!Number.isInteger(input.sampleRateHz) || input.sampleRateHz < 8_000 || input.sampleRateHz > 384_000) {
    throw new Error('audio-sample-rate-invalid')
  }
  if (input.channels.length < 1 || input.channels.length > 8) throw new Error('audio-channel-count-invalid')
  const sampleCount = input.channels[0].length
  if (sampleCount < 2 || input.channels.some(channel => channel.length !== sampleCount)) {
    throw new Error('audio-channel-length-invalid')
  }
  for (const channel of input.channels) {
    for (const sample of channel) if (!Number.isFinite(sample)) throw new Error('audio-sample-invalid')
  }
  return {
    channelCount: input.channels.length,
    sampleRateHz: input.sampleRateHz,
    durationMs: Math.max(1, Math.round(sampleCount / input.sampleRateHz * 1_000)),
    integratedLufs: round(integratedLoudness(input.channels, input.sampleRateHz)),
    truePeakDbtp: round(db(cubicPeak(input.channels))),
    loopSeamDbfs: round(loopSeam(input.channels)),
  }
}
