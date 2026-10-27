// Physical transport validation only. The browser's governed Run remains the
// authority for source/consent; a JSON object cannot manufacture that authority.
import { readFileSync, realpathSync, lstatSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { validateReadingInput, verifyReadingPreview } from './reading-preview.mjs'

export const base = path.dirname(fileURLToPath(import.meta.url))
export const repo = path.resolve(base, '../..')
export const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
export const stable = value => JSON.stringify(canonical(value))
export const digest = bytes => createHash('sha256').update(bytes).digest('hex')
export const exact = (row, keys) => row && typeof row === 'object' && !Array.isArray(row)
  && Object.keys(row).sort().join(',') === [...keys].sort().join(',')
export const productProfile = JSON.parse(readFileSync(path.join(base, 'product-profile.json'), 'utf8'))
export const productProfileHash = digest(stable(productProfile))
export const qwenProductProfiles = ['uncle_fu', 'serena'].map(voice => JSON.parse(readFileSync(path.join(base, `product-qwen-${voice}-v1.json`), 'utf8')))
export const productProfiles = [productProfile, ...qwenProductProfiles]
export function currentProductProfile(value) {
  const p = productProfiles.find(p => p.profileId === value?.profileId)
  if (!p || stable(p) !== stable(value)) throw new Error('Unsupported current speech profile; preserve the original job')
  return p
}
export const isQwenProfile = p => p?.version === 3 && p.engine === 'qwen3-tts-mlx-metal'
export const IMPLEMENTATION_PATHS = [
  'scripts/ttrpg-local-tts/product-contract.mjs', 'scripts/ttrpg-local-tts/product-worker.py',
  'scripts/ttrpg-local-tts/product-jobs.mjs', 'scripts/ttrpg-local-tts/product-bridge.mjs',
  'scripts/ttrpg-local-tts/engine.py', 'scripts/ttrpg-local-tts/reading_frontend.py',
  'scripts/ttrpg-local-tts/reading-preview.mjs', 'src/lib/ttrpg/open-local-voice-transport.ts',
  'src/lib/ttrpg/open-voice-execution.ts',
]
export const QWEN_IMPLEMENTATION_PATHS = [...IMPLEMENTATION_PATHS, 'scripts/ttrpg-local-tts/qwen-product.py',
  'scripts/ttrpg-local-tts/qwen-native-eval-profile.json', 'src/lib/ttrpg/open-voice-execution-input.ts', 'src/lib/ttrpg/open-voice-product-profile.ts']
export function assertProductImplementation(profile = productProfile) {
  const p = currentProductProfile(profile), sources = p.implementation?.sources, qwen = isQwenProfile(p)
  const file = qwen ? `product-qwen-${p.speaker}-v1.json` : 'product-profile.json'
  if (stable(JSON.parse(readFileSync(path.join(base, file), 'utf8'))) !== stable(p)
    || (!qwen && (p.version !== 2 || p.profileId !== 'melo-zh-product-v2')) || p.requiredAuthority !== 'original-durable-voice-execution-v1'
    || p.network !== 'disabled' || p.automaticRetryAllowed !== false || p.adoptionAllowed !== false
    || p.maxSegmentAudioSeconds !== 60 || p.maxConcurrentJobs !== 1 || p.authorizationLeaseMs !== 10000 || p.authorizationRenewMs !== 2000 || p.statusRequestTimeoutMs !== 15000 || p.rawResponseTimeoutMs !== 120000 || p.readingRecomputationRequired !== true
    || p.implementation?.version !== (qwen ? 'storyforge-local-tts-qwen-worker-v1' : 'storyforge-local-tts-worker-v1') || !Array.isArray(sources)
    || stable(sources.map(row => row.path)) !== stable(qwen ? QWEN_IMPLEMENTATION_PATHS : IMPLEMENTATION_PATHS)) throw new Error('Unsupported pinned product implementation')
  if (qwen && (p.sampleRate !== 24000 || p.maxTextEncoderCalls !== 0 || p.maxCodecTokensPerSegment !== 512 || p.decodeUpsampleRate !== 1920
    || p.gpuMemoryLimitBytes !== 6442450944 || !['uncle_fu', 'serena'].includes(p.speaker) || p.instructAllowed !== false || p.referenceVoiceAllowed !== false
    || digest(readFileSync(path.join(repo, p.nativeAssetDescriptor))) !== p.nativeAssetProfileSha256)) throw new Error('Unsupported native Qwen contract')
  for (const row of sources) {
    if (!exact(row, ['path', 'sha256']) || digest(readFileSync(path.join(repo, row.path))) !== row.sha256) throw new Error('Product implementation bytes changed')
  }
  const entry = JSON.parse(readFileSync(path.join(repo, 'src/lib/agent/ai-entry-registry.json'), 'utf8')).entries.filter(row => row.entryId === 'ttrpg.open.local-voice')
  if (entry.length !== 1 || entry[0].outputModality !== 'audio' || entry[0].adoptAllowed !== false
    || entry[0].skillId !== 'prose.ttrpg-open-local-voice' || entry[0].executionBoundary !== 'product-runtime'
    || stable(entry[0].allowedCallers) !== stable(['src/lib/ttrpg/open-voice-execution.ts'])) throw new Error('Product audio entry is not registered')
}
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const key = v => typeof v === 'string' && v.length > 0 && v.length <= 500 && !/[\x00-\x1f]/.test(v)
function ref(value) { return exact(value, ['sessionKey', 'sequence']) && key(value.sessionKey) && Number.isSafeInteger(value.sequence) && value.sequence >= 0 }
/** Stored identity is sufficient for read/stop after an implementation upgrade.
 * It is never launch permission; start still requires validateProductJob. */
export function readStoredProductJob(value) {
  const e = value?.execution, p = e?.profile, s = e?.source, r = e?.reading
  if (!exact(value, ['jobKey', 'inputArtifactHash', 'execution']) || !hash(value.inputArtifactHash)
    || typeof value.jobKey !== 'string' || !new RegExp('^ttrpg\\.voice\\.[1-9][0-9]*\\.' + value.inputArtifactHash + '$').test(value.jobKey)
    || !exact(e, ['schema', 'version', 'requestKey', 'decision', 'intent', 'source', 'reading', 'profile', 'profileHash'])
    || e.schema !== 'storyforge.ttrpg-open-voice-execution-input' || e.version !== 1 || !key(e.requestKey)
    || digest(stable(e)) !== value.inputArtifactHash || digest(stable(p)) !== e.profileHash
    || p.schema !== 'storyforge.ttrpg-local-tts-product-profile' || ![1, 2, 3].includes(p.version)
    || p.assetProfileSha256 !== productProfile.assetProfileSha256 || p.network !== 'disabled' || p.automaticRetryAllowed !== false || p.adoptionAllowed !== false
    || !s || typeof s.text !== 'string' || s.text.length > 2000 || digest(s.text) !== s.textHash
    || !s.part || !Number.isSafeInteger(s.part.textOffset) || s.part.textOffset < 0 || s.part.textLength !== s.text.length || s.part.textHash !== s.textHash
    || !r || typeof r.normalizedText !== 'string' || r.normalizedText.length > 4000 || digest(r.normalizedText) !== r.normalizedTextSha256
    || r.sourceTextHash !== s.textHash || digest(stable(r.profile)) !== r.profileHash) throw new Error('Stored original speech identity changed')
  if (p.version === 3) {
    const supported = qwenProductProfiles.find(profile => profile.profileId === p.profileId)
    if (!supported || stable({ ...p, implementation: null }) !== stable({ ...supported, implementation: null })) throw new Error('Unsupported original Qwen identity')
  }
  return structuredClone(value)
}
export function validateProductJob(value) {
  readStoredProductJob(value)
  if (!exact(value, ['jobKey', 'inputArtifactHash', 'execution']) || !hash(value.inputArtifactHash)
    || typeof value.jobKey !== 'string' || !new RegExp('^ttrpg\\.voice\\.[1-9][0-9]*\\.' + value.inputArtifactHash + '$').test(value.jobKey)) throw new Error('Invalid original speech job identity')
  const e = value.execution
  const selected = currentProductProfile(e.profile), selectedHash = digest(stable(selected))
  if (!exact(e, ['schema', 'version', 'requestKey', 'decision', 'intent', 'source', 'reading', 'profile', 'profileHash'])
    || e.schema !== 'storyforge.ttrpg-open-voice-execution-input' || e.version !== 1 || !key(e.requestKey)
    || e.decision !== 'prepare-this-confirmed-local-voice-execution' || e.profileHash !== selectedHash
    || stable(e.profile) !== stable(selected) || digest(stable(e)) !== value.inputArtifactHash
    || !exact(e.intent, ['inputArtifactHash', 'receiptHash', 'verificationArtifactHash']) || !Object.values(e.intent).every(hash)) throw new Error('Speech job does not match its exact original input/profile')
  const s = e.source, r = e.reading
  if (!exact(s, ['text', 'textHash', 'scriptHash', 'part', 'narrationSourceRef', 'reservationSourceRef', 'scope'])
    || typeof s.text !== 'string' || !hash(s.scriptHash) || !hash(s.textHash) || digest(s.text) !== s.textHash
    || !exact(s.part, ['textOffset', 'textLength', 'textHash']) || !Number.isSafeInteger(s.part.textOffset) || s.part.textOffset < 0
    || s.part.textLength !== s.text.length || s.part.textHash !== s.textHash || !ref(s.narrationSourceRef) || !ref(s.reservationSourceRef)
    || !exact(s.scope, ['schema', 'version', 'authorizationRef', 'issuerSeatKey', 'issuerViewerKey', 'audience', 'privateActorKey', 'recipients'])
    || !ref(s.scope.authorizationRef) || !Array.isArray(s.scope.recipients) || !s.scope.recipients.length || s.scope.recipients.length > 100
    || s.scope.recipients.some(row => !exact(row, ['seatKey', 'viewerKey', 'actorKey', 'role', 'controller']))) throw new Error('Invalid exact original speech source')
  if (!exact(r, ['schema', 'version', 'decision', 'sourceTextHash', 'profile', 'profileHash', 'normalizerSha256', 'overrides', 'normalizedText', 'normalizedTextSha256', 'previewHash'])
    || r.schema !== 'storyforge.ttrpg-open-confirmed-voice-reading' || r.version !== 1 || r.decision !== 'confirm-this-exact-local-voice-reading'
    || r.sourceTextHash !== s.textHash || r.profileHash !== digest(stable(r.profile)) || r.normalizerSha256 !== r.profile.normalizerSha256
    || stable(r.profile) !== stable(JSON.parse(readFileSync(path.join(base, 'reading-profile.json'), 'utf8')))) throw new Error('Missing original human-confirmed reading')
  const input = { schema: 'storyforge.ttrpg-local-tts-reading-input', version: 1, text: s.text, overrides: r.overrides }
  const preview = { schema: 'storyforge.ttrpg-local-tts-reading-preview', version: 1, profileHash: r.profileHash, normalizerSha256: r.normalizerSha256,
    status: 'ready-for-reading-review', sourceText: s.text, sourceTextSha256: s.textHash, overrides: r.overrides, readingText: validateReadingInput(input),
    normalizedText: r.normalizedText, normalizedTextSha256: r.normalizedTextSha256, issues: [], issueCount: 0, issueOffsetsReferTo: 'readingText-utf16',
    modelCalled: false, generationAllowed: false, adoptionAllowed: false, network: 'disabled' }
  verifyReadingPreview(preview, input)
  if (digest(stable(preview)) !== r.previewHash) throw new Error('Confirmed reading preview hash changed')
  return structuredClone(value)
}
export function ownedRuntime(value) {
  const runtime = realpathSync(value), st = lstatSync(runtime)
  if (!st.isDirectory() || st.uid !== process.getuid()) throw new Error('Unowned runtime directory')
  const profileBytes = readFileSync(path.join(runtime, 'runtime-profile.json'))
  const owner = JSON.parse(readFileSync(path.join(runtime, 'owner.json'), 'utf8')), setup = JSON.parse(readFileSync(path.join(runtime, 'setup-receipt.json'), 'utf8'))
  if (digest(profileBytes) !== productProfile.assetProfileSha256 || owner.profileHash !== productProfile.assetProfileSha256
    || owner.profileId !== productProfile.assetProfileId || setup.status !== 'passed' || setup.profileHash !== owner.profileHash) throw new Error('Pinned shared runtime is not ready')
  return runtime
}
export function verifyQwenNativeResult(result, profile) {
  const n = result.native, rows = n?.segments, segments = result.alignment.segments
  if (!exact(n, ['kind', 'speaker', 'assetProfileSha256', 'memoryGuidelineBytes', 'peakMetalBytes', 'memoryChecks', 'segments'])
    || n.kind !== 'qwen3-tts-native-v1' || n.speaker !== profile.speaker || n.assetProfileSha256 !== profile.nativeAssetProfileSha256
    || n.memoryGuidelineBytes !== profile.gpuMemoryLimitBytes || !Number.isSafeInteger(n.peakMetalBytes) || n.peakMetalBytes < 1 || n.peakMetalBytes > profile.gpuMemoryLimitBytes
    || !Array.isArray(rows) || rows.length !== segments.length) throw new Error('Native speaker or actual Metal resource evidence failed')
  let tokens = 0
  for (const [index, row] of rows.entries()) {
    if (!exact(row, ['index', 'codecTokens', 'eosObserved']) || row.index !== index || row.eosObserved !== true
      || !Number.isSafeInteger(row.codecTokens) || row.codecTokens < 1 || row.codecTokens >= profile.maxCodecTokensPerSegment
      || segments[index].sampleCount !== row.codecTokens * profile.decodeUpsampleRate) throw new Error('Native Qwen codec clock is incomplete; zero codes must be retained')
    tokens += row.codecTokens
  }
  if (!Number.isSafeInteger(n.memoryChecks) || n.memoryChecks < tokens + 2) throw new Error('Actual per-step memory observations missing')
}

/** Recheck the actual canonical PCM and complete normalized-reading coverage.
 * Segment clocks are physical sample boundaries, never word/character timing. */
export function verifyProductResult(result, bytes, input) {
  // Output retrieval is not permission to execute an old implementation.
  // The wire/physical contract is unchanged; keep its original implementation
  // hashes instead of requiring today's code hash for an already finished job.
  const p = input.execution.profile, a = result?.audio, alignment = result?.alignment
  const supported = productProfiles.find(profile => profile.profileId === p.profileId)
  if (!supported) throw new Error('Unsupported original output profile')
  const qwen = isQwenProfile(supported)
  const { implementation: currentImplementation, ...currentCore } = supported
  const { implementation, ...originalCore } = p
  if (stable(originalCore) !== stable(currentCore) || input.execution.profileHash !== digest(stable(p))
    || !exact(implementation, ['version', 'sources']) || implementation.version !== currentImplementation.version
    || !Array.isArray(implementation.sources) || stable(implementation.sources.map(row => row.path)) !== stable(qwen ? QWEN_IMPLEMENTATION_PATHS : IMPLEMENTATION_PATHS)
    || implementation.sources.some(row => !exact(row, ['path', 'sha256']) || !hash(row.sha256))) throw new Error('Unsupported original output contract; preserve its files')
  if (!exact(result, ['schema', 'version', 'status', 'jobKey', 'inputArtifactHash', 'profileHash', 'implementationHash', 'sourceTextHash', 'normalizedTextSha256', 'previewHash', 'audio', 'alignment', 'usage', 'metrics', 'network', 'candidateAccepted', 'adoptionAllowed', 'humanListening', ...(qwen ? ['native'] : [])])
    || result.schema !== 'storyforge.ttrpg-local-tts-product-result' || result.version !== (qwen ? 2 : 1) || result.status !== 'generated'
    || result.jobKey !== input.jobKey || result.inputArtifactHash !== input.inputArtifactHash || result.profileHash !== input.execution.profileHash
    || result.implementationHash !== digest(stable(p.implementation)) || result.sourceTextHash !== input.execution.source.textHash
    || result.normalizedTextSha256 !== input.execution.reading.normalizedTextSha256 || result.previewHash !== input.execution.reading.previewHash
    || result.candidateAccepted !== false || result.adoptionAllowed !== false || result.humanListening !== 'unproven' || result.network !== 'disabled'
    || !exact(a, ['mimeType', 'byteSize', 'sha256', 'sampleRate', 'channels', 'sampleFormat', 'samples', 'durationMs'])
    || !Buffer.isBuffer(bytes) || bytes.length < 46 || bytes.length > p.maxAudioBytes || a.mimeType !== 'audio/wav'
    || a.byteSize !== bytes.length || a.sha256 !== digest(bytes) || a.sampleRate !== p.sampleRate || a.channels !== 1 || a.sampleFormat !== 's16le'
    || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.readUInt32LE(4) + 8 !== bytes.length || bytes.toString('ascii', 8, 16) !== 'WAVEfmt '
    || bytes.readUInt32LE(16) !== 16 || bytes.readUInt16LE(20) !== 1 || bytes.readUInt16LE(22) !== 1 || bytes.readUInt32LE(24) !== p.sampleRate
    || bytes.readUInt32LE(28) !== p.sampleRate * 2 || bytes.readUInt16LE(32) !== 2 || bytes.readUInt16LE(34) !== 16 || bytes.toString('ascii', 36, 40) !== 'data'
    || bytes.readUInt32LE(40) !== bytes.length - 44 || !Number.isSafeInteger(a.samples) || a.samples < 1 || a.samples * 2 !== bytes.length - 44
    || a.samples > p.sampleRate * p.maxAudioSeconds || a.durationMs !== Math.round(a.samples * 1000 / p.sampleRate)) throw new Error('Exact product result/PCM identity failed')
  if (!exact(alignment, ['kind', 'wordAlignmentProvided', 'originalPart', 'segments']) || alignment.kind !== 'normalized-reading-segments'
    || alignment.wordAlignmentProvided !== false || stable(alignment.originalPart) !== stable(input.execution.source.part)
    || !Array.isArray(alignment.segments) || !alignment.segments.length || alignment.segments.length > p.maxSegments) throw new Error('Invalid truthful segment clock')
  const text = input.execution.reading.normalizedText; let offset = 0, sample = 0
  for (const [index, row] of alignment.segments.entries()) {
    if (!exact(row, ['index', 'readingOffsetUtf16', 'readingLengthUtf16', 'textSha256', 'sampleOffset', 'sampleCount', 'gain']) || row.index !== index
      || row.readingOffsetUtf16 !== offset || row.sampleOffset !== sample || !Number.isSafeInteger(row.readingLengthUtf16) || row.readingLengthUtf16 < 1 || row.readingLengthUtf16 > p.maxSegmentUtf16
      || !Number.isSafeInteger(row.sampleCount) || row.sampleCount < 1 || row.sampleCount > p.sampleRate * p.maxSegmentAudioSeconds
      || !Number.isFinite(row.gain) || row.gain <= 0 || row.gain > 1 || digest(text.slice(offset, offset + row.readingLengthUtf16)) !== row.textSha256) throw new Error('Incomplete or fabricated segment/sample coverage')
    offset += row.readingLengthUtf16; sample += row.sampleCount
  }
  const count = alignment.segments.length, u = result.usage
  if (offset !== text.length || sample !== a.samples || !exact(u, ['textEncoderCallsStarted', 'textEncoderCallsCompleted', 'speechCallsStarted', 'speechCallsCompleted'])
    || u.textEncoderCallsStarted !== (qwen ? 0 : count) || u.textEncoderCallsCompleted !== (qwen ? 0 : count)
    || u.speechCallsStarted !== count || u.speechCallsCompleted !== count
    || count > p.maxSpeechInferenceCalls || (!qwen && count > p.maxTextEncoderCalls)) throw new Error('Physical model-call/segment evidence does not close')
  if (qwen) verifyQwenNativeResult(result, p)
  let energy = 0, peak = 0
  for (let i = 44; i < bytes.length; i += 2) { const value = bytes.readInt16LE(i) / 32767; energy += value * value; peak = Math.max(peak, Math.abs(value)) }
  const rms = Math.sqrt(energy / a.samples), m = result.metrics
  if (!exact(m, ['wallMs', 'cpuMs', 'maxRssBytes', 'rms', 'peak']) || ['wallMs', 'cpuMs', 'maxRssBytes'].some(key => !Number.isSafeInteger(m[key]) || m[key] < 0)
    || !Number.isFinite(m.rms) || !Number.isFinite(m.peak) || Math.abs(m.rms - rms) > 1e-7 || Math.abs(m.peak - peak) > 1e-7 || rms < .00001 || peak > .9901) throw new Error('Actual PCM statistics failed')
  return result
}
