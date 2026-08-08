export interface H4WilsonIntervalV1 {
  successes: number
  samples: number
  estimate: number | null
  lower: number
  upper: number
  confidence: 0.95
}

export interface H4ConsistencyDensityObservationV1 {
  fixtureId: string
  narrativeChars: number
  hardConflictCount: number
}

export interface H4ConsistencyDensityComparisonV1 {
  schemaVersion: 1
  metric: 'hard-conflicts-per-10k-chars'
  pairedCases: number
  baselineDensity: number
  candidateDensity: number
  relativeReduction: number
  bootstrap: {
    method: 'paired-percentile'
    samples: number
    seed: number
    confidence: 0.95
    lower: number
    upper: number
  }
}

function assertCount(value: number, path: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${path} 必须是非负整数`)
}

export function wilsonInterval95V1(successes: number, samples: number): H4WilsonIntervalV1 {
  assertCount(successes, 'successes')
  assertCount(samples, 'samples')
  if (successes > samples) throw new Error('successes 不得大于 samples')
  if (samples === 0) {
    return { successes, samples, estimate: null, lower: 0, upper: 1, confidence: 0.95 }
  }
  const z = 1.959963984540054
  const zSquared = z * z
  const estimate = successes / samples
  const denominator = 1 + zSquared / samples
  const center = (estimate + zSquared / (2 * samples)) / denominator
  const margin = z * Math.sqrt(
    (estimate * (1 - estimate) + zSquared / (4 * samples)) / samples,
  ) / denominator
  return {
    successes,
    samples,
    estimate,
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
    confidence: 0.95,
  }
}

function validateObservations(
  values: readonly H4ConsistencyDensityObservationV1[],
  path: string,
): Map<string, H4ConsistencyDensityObservationV1> {
  if (!values.length) throw new Error(`${path} 不得为空`)
  const result = new Map<string, H4ConsistencyDensityObservationV1>()
  for (const [index, value] of values.entries()) {
    if (!value.fixtureId.trim()) throw new Error(`${path}[${index}].fixtureId 不得为空`)
    if (!Number.isInteger(value.narrativeChars) || value.narrativeChars <= 0) {
      throw new Error(`${path}[${index}].narrativeChars 必须是正整数`)
    }
    assertCount(value.hardConflictCount, `${path}[${index}].hardConflictCount`)
    if (result.has(value.fixtureId)) throw new Error(`${path}.fixtureId 不得重复`)
    result.set(value.fixtureId, value)
  }
  return result
}

function meanDensity(values: readonly H4ConsistencyDensityObservationV1[]): number {
  return values.reduce((sum, value) => (
    sum + value.hardConflictCount * 10_000 / value.narrativeChars
  ), 0) / values.length
}

function percentile(values: readonly number[], probability: number): number {
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.floor((ordered.length - 1) * probability)]
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  if (state === 0) state = 0x9e3779b9
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_0000_0000
  }
}

export function compareH4ConsistencyErrorDensityV1(input: {
  baseline: readonly H4ConsistencyDensityObservationV1[]
  candidate: readonly H4ConsistencyDensityObservationV1[]
  bootstrapSamples?: number
  seed?: number
}): H4ConsistencyDensityComparisonV1 {
  const baselineById = validateObservations(input.baseline, 'baseline')
  const candidateById = validateObservations(input.candidate, 'candidate')
  if (
    baselineById.size !== candidateById.size
    || [...baselineById.keys()].some(id => !candidateById.has(id))
  ) throw new Error('baseline 与 candidate 必须包含相同 fixtureId')
  const pairs = [...baselineById.values()].map(baseline => {
    const candidate = candidateById.get(baseline.fixtureId)!
    return { baseline, candidate }
  })
  const baselineDensity = meanDensity(pairs.map(pair => pair.baseline))
  if (baselineDensity <= 0) throw new Error('baseline density 必须大于 0 才能计算相对下降')
  const candidateDensity = meanDensity(pairs.map(pair => pair.candidate))
  const bootstrapSamples = input.bootstrapSamples ?? 2_000
  if (!Number.isInteger(bootstrapSamples) || bootstrapSamples < 200 || bootstrapSamples > 20_000) {
    throw new Error('bootstrapSamples 必须在 200 到 20000 之间')
  }
  const seed = input.seed ?? 0x48415234
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new Error('seed 必须是 uint32')
  }
  const random = seededRandom(seed)
  const reductions: number[] = []
  for (let sample = 0; sample < bootstrapSamples; sample += 1) {
    const sampledBaseline: H4ConsistencyDensityObservationV1[] = []
    const sampledCandidate: H4ConsistencyDensityObservationV1[] = []
    for (let index = 0; index < pairs.length; index += 1) {
      const pair = pairs[Math.floor(random() * pairs.length)]
      sampledBaseline.push(pair.baseline)
      sampledCandidate.push(pair.candidate)
    }
    const sampledBaselineDensity = meanDensity(sampledBaseline)
    if (sampledBaselineDensity <= 0) continue
    reductions.push(1 - meanDensity(sampledCandidate) / sampledBaselineDensity)
  }
  if (reductions.length < Math.ceil(bootstrapSamples * 0.9)) {
    throw new Error('有效 bootstrap 样本不足，baseline 零密度配对过多')
  }
  return {
    schemaVersion: 1,
    metric: 'hard-conflicts-per-10k-chars',
    pairedCases: pairs.length,
    baselineDensity,
    candidateDensity,
    relativeReduction: 1 - candidateDensity / baselineDensity,
    bootstrap: {
      method: 'paired-percentile',
      samples: reductions.length,
      seed,
      confidence: 0.95,
      lower: percentile(reductions, 0.025),
      upper: percentile(reductions, 0.975),
    },
  }
}
