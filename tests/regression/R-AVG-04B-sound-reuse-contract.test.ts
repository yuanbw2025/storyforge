import { describe, expect, it } from 'vitest'
import { parseAvgSoundRevalidationEvidenceV1 } from '../../src/lib/avg/sound-reuse-contract'
import type { AvgGeneratedSoundSource } from '../../src/lib/avg/stage-processed-sound-source-contract'

const hash = '1'.repeat(64)
// Structural locator fixtures only. No Run, receipt, proof hash, adoption or
// byte observation is produced or authenticated by these pure codec tests.
function source(version: 1 | 2): AvgGeneratedSoundSource {
  const base = { schema: 'storyforge.avg.generated-sound-source' as const, version: 1 as const, productionKey: 'fixture.sound',
    buildNumber: 1, controlEpoch: 0, briefHash: hash, planHash: hash, requirementKey: 'desk.bgm', requestIdentityHash: hash,
    raw: { artifactKey: 'avg.sound.raw.desk.bgm', version: 1, contentHash: hash, producerReceiptHash: hash,
      responseEvidenceHash: hash, requestSnapshotHash: hash, rightsHash: hash },
    compiled: { artifactKey: 'avg.media.compiled-sound-requirements', version: 1, contentHash: hash },
    review: { artifactKey: 'avg.review.audio.desk.bgm', version: 1, contentHash: hash, authorReceiptHash: hash },
    choice: { artifactKey: 'avg.sound.choice.desk.bgm', version: 1, contentHash: hash, authorReceiptHash: hash } }
  return version === 1 ? base : { ...base, version: 2, processing: { schema: 'storyforge.avg.audio-processing-producer-proof', version: 1,
    noProviderRequest: true, buildNumber: 1, briefHash: hash, planHash: hash, controlEpoch: 0, taskKey: 'avg.sound.process.desk.bgm',
    artifactKey: 'avg.sound.processed.desk.bgm', artifactVersion: 1, contentHash: hash, inputHash: hash,
    producerReceiptHash: hash, candidateHash: hash, proofHash: hash, processingEvidenceHash: hash } }
}
function evidence(raw = false, originVersion: 1 | 2 = 1): Record<string, unknown> {
  return { schema: raw ? 'storyforge.avg.raw-sound-revalidation' : 'storyforge.avg.sound-requirements-revalidation',
    version: 1, noProviderRequest: true, retainedOrigin: source(originVersion), sourceBuildRevision: 0,
    repairHash: hash, sourceContextHash: hash, inputs: [{ artifactKey: 'avg.content.system-plan', version: 1e9, contentHash: hash }],
    contentHashVerified: true, ...(raw ? { decoderVerified: true, hearing: 'unobserved', authorAdopted: false } : {}) }
}

describe('AVG inert sound revalidation evidence', () => {
  it('preserves exact compiled/raw shapes and original/processed locators without mutating caller values', () => {
    for (const raw of [false, true]) for (const version of [1, 2] as const) {
      const value = evidence(raw, version), before = structuredClone(value)
      expect(parseAvgSoundRevalidationEvidenceV1(value)).toEqual(before)
      expect(parseAvgSoundRevalidationEvidenceV1(JSON.stringify(value))).toEqual(before)
      expect(value).toEqual(before)
    }
  })

  it('rejects unknown fields, cross-schema observations, false verification and claimed hearing/adoption', () => {
    const changes = [
      { schema: 'storyforge.avg.sound-compilation-evidence' }, { version: 2 }, { noProviderRequest: false },
      { contentHashVerified: false }, { producerRunId: 7 }, { responseEvidenceHash: hash },
      { decoderVerified: true }, { hearing: 'unobserved' }, { authorAdopted: false },
    ]
    for (const change of changes) expect(() => parseAvgSoundRevalidationEvidenceV1({ ...evidence(), ...change })).toThrow()
    for (const change of [{ decoderVerified: false }, { hearing: 'observed' }, { authorAdopted: true }]) {
      expect(() => parseAvgSoundRevalidationEvidenceV1({ ...evidence(true), ...change })).toThrow()
    }
    const missing = evidence(true); delete missing.decoderVerified
    expect(() => parseAvgSoundRevalidationEvidenceV1(missing)).toThrow()
    const badOrigin = evidence(); (badOrigin.retainedOrigin as { version: number }).version = 3
    expect(() => parseAvgSoundRevalidationEvidenceV1(badOrigin)).toThrow()
  })

  it('bounds exact nonempty unique input refs, source revision and both identity hashes', () => {
    const ref = { artifactKey: 'avg.content.system-plan', version: 1, contentHash: hash }
    const badInputs = [[], [ref, { ...ref, version: 2 }], [ref, { ...ref, contentHash: '2'.repeat(64) }],
      [undefined], [{ ...ref, producerReceiptHash: hash }], [{ ...ref, artifactKey: 'bad/key' }],
      [{ ...ref, version: 0 }], [{ ...ref, version: 1e9 + 1 }], [{ ...ref, version: 1.5 }], [{ ...ref, contentHash: 'bad' }],
      Array.from({ length: 129 }, (_, n) => ({ ...ref, artifactKey: 'fixture.' + n })), Array(1)]
    for (const inputs of badInputs) expect(() => parseAvgSoundRevalidationEvidenceV1({ ...evidence(), inputs })).toThrow()
    for (const sourceBuildRevision of [-1, 1e9 + 1, 1.5, Infinity, NaN]) {
      expect(() => parseAvgSoundRevalidationEvidenceV1({ ...evidence(), sourceBuildRevision })).toThrow()
    }
    for (const field of ['repairHash', 'sourceContextHash']) {
      expect(() => parseAvgSoundRevalidationEvidenceV1({ ...evidence(), [field]: 'bad' })).toThrow()
    }
    const inputs = Array.from({ length: 128 }, (_, n) => ({ ...ref, artifactKey: 'fixture.' + n }))
    expect(parseAvgSoundRevalidationEvidenceV1({ ...evidence(), sourceBuildRevision: 1e9, inputs }).inputs).toHaveLength(128)
  })
})
