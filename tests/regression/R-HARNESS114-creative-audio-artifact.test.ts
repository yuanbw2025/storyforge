import { describe, expect, it } from 'vitest'
import { parseCreativeArtifactV1, creativeArtifactCanAdoptV1, parseCreativeAudioArtifactV1,
  type CreativeArtifactIssueV1, type CreativeArtifactV1, type CreativeAudioArtifactV1 } from '../../src/lib/agent/creative-reliability'
import { canonicalStringify } from '../../src/lib/agent/run/hash'

const hash = 'a'.repeat(64), rawHash = 'b'.repeat(64)
function audio(): CreativeAudioArtifactV1 {
  return { schema: 'storyforge.creative-audio-artifact', version: 1, policyVersion: 'creative-audio-reliability-v1', modality: 'audio', status: 'ready',
    evidence: { inputArtifactHash: hash, contextManifestHash: hash, rawResponseArtifactHash: rawHash },
    audio: { mimeType: 'audio/wav', contentHash: hash, byteLength: 100 * 1024 * 1024, durationMs: 900000 }, issues: [],
    requestEvidence: { kind: 'original-audio-request', provider: 'local', model: 'original-audio-profile', latencyMs: 12000, outputHash: rawHash },
    humanListening: 'unproven', adoptionAllowed: false, automaticRetryAllowed: false }
}
const issue = (blocking = false): CreativeArtifactIssueV1 => ({ version: 1, code: 'physical-audio-review', severity: blocking ? 'error' : 'warning',
  disposition: blocking ? 'blocking' : 'advisory', path: 'audio', message: '必须按原证据复核', suggestedAction: blocking ? 'replan' : 'none', evidenceRefs: [rawHash], deterministic: true })
describe('R-HARNESS114 explicit audio candidate reference contract', () => {
  it('keeps a large audio descriptor with exact evidence references and no duplicated raw/base64, playback or adoption grant', () => {
    const input = audio(), result = parseCreativeAudioArtifactV1(input)
    expect(result).toEqual(input); expect(result).not.toBe(input)
    expect(canonicalStringify(result).length).toBeLessThan(2048)
    expect(result.humanListening).toBe('unproven'); expect(result.adoptionAllowed).toBe(false)
    expect(creativeArtifactCanAdoptV1(result as unknown as CreativeArtifactV1)).toBe(false)
    expect(() => parseCreativeArtifactV1(result)).toThrow()
  })
  it('retains invalid original response identity in a blocked artifact without pretending there is verified audio', () => {
    const input = audio(); input.status = 'blocked'; input.audio = null; input.issues = [issue(true)]
    expect(parseCreativeAudioArtifactV1(input)).toEqual(input)
  })
  it('accepts advisory review without granting listening, adopting or automatic repair', () => {
    const input = audio(); input.status = 'usable-with-warnings'; input.issues = [issue()]
    expect(parseCreativeAudioArtifactV1(input)).toEqual(input)
    input.status = 'manual-repair'; expect(parseCreativeAudioArtifactV1(input).adoptionAllowed).toBe(false)
  })
  it.each([
    { originalText: 'must not truncate or inline an audio response as text' }, { base64: 'duplicate audio' }, { adoptionAllowed: true },
    { automaticRetryAllowed: true }, { humanListening: 'confirmed' }, { modality: 'text' }, { version: 2 },
    { evidence: { inputArtifactHash: hash, contextManifestHash: hash, rawResponseArtifactHash: 'invalid' } },
    { audio: null }, { issues: [issue(true)] }, { status: 'blocked' }, { requestEvidence: [] },
    { requestEvidence: [audio().requestEvidence, audio().requestEvidence] },
    { requestEvidence: { ...audio().requestEvidence, outputHash: hash } },
    { requestEvidence: { ...audio().requestEvidence, latencyMs: Number.MAX_SAFE_INTEGER + 1 } },
    { requestEvidence: { ...audio().requestEvidence, modelCalls: 1, inputTokens: 123 } },
    { audio: { ...audio().audio!, byteLength: Number.MAX_SAFE_INTEGER + 1 } },
    { audio: { ...audio().audio!, durationMs: -1 } }, { audio: { ...audio().audio!, mimeType: 'text/html' } },
  ])('rejects an invalid capability/evidence/physical descriptor: %j', patch => {
    expect(() => parseCreativeAudioArtifactV1({ ...audio(), ...patch })).toThrow()
  })
  it('preserves valid text V1 canonical bytes, original output and adoption behavior without adding audio fields', () => {
    const text: CreativeArtifactV1 = { version: 1, policyVersion: 'creative-reliability-v1', status: 'ready', qualityMode: 'balanced',
      originalText: '  原始文本\n', editableText: '修订文本', validFragments: [], rejectedFragments: [], issues: [], assumptions: [], canonEvidenceRefs: [],
      callEvidence: [{ version: 1, callIndex: 1, purpose: 'generate', status: 'succeeded', provider: 'fixture', model: 'text-fixture',
        usageSource: 'unknown', inputTokens: null, outputTokens: null, totalTokens: null, latencyMs: 1, estimatedCostUsd: null, outputHash: rawHash }], repair: null }
    const before = canonicalStringify(text), parsed = parseCreativeArtifactV1(text)
    expect(canonicalStringify(parsed)).toBe(before); expect(parsed.originalText).toBe(text.originalText)
    expect(creativeArtifactCanAdoptV1(parsed)).toBe(true); expect(() => parseCreativeAudioArtifactV1(text)).toThrow()
  })
})
