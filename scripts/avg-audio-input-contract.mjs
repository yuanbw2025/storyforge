/* global Buffer */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export const AUDIO_INPUT_ENTRY = 'eval.avg.audio-input-calibration'
export const MAX_MODEL_CALLS = 2
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024
export const MAX_RESPONSE_BYTES = 65536
export const AUDIO_INPUT_PROMPT = `Inspect only the attached audio. No reference transcript is supplied.
Return exactly one JSON object with these five keys:
"perception": "heard", "not-heard", or "uncertain";
"speechPresent": true, false, or null;
"transcript": verbatim speech in its original language, or an empty string;
"observations": an array of at most eight objects {"fromMs": number, "toMs": number, "observation": string};
"limitations": an array of at most six short strings.
If you cannot decode or hear this attachment, use uncertain/null/empty transcript and explain that limitation. Do not invent speech. Silence contains no speech. Observations must concern this attachment, not an imagined reference. This is a capability experiment; you cannot approve, adopt, or release a product asset.`

export const sha256 = value => createHash('sha256').update(value).digest('hex')
export const normalizeTranscript = value => value.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu, '')

export function assertOfflineAudioEntry(registry = JSON.parse(readFileSync(new URL('../src/lib/agent/ai-entry-registry.json', import.meta.url), 'utf8'))) {
  const matches = registry.offlineEvaluations?.filter(entry => entry.entryId === AUDIO_INPUT_ENTRY) ?? []
  const row = matches[0]
  const keys = ['adoptAllowed', 'boundary', 'caller', 'contract', 'entryId', 'reason', 'transport']
  if (registry.version !== 2 || registry.scope !== 'formal-ai-execution-entry' || matches.length !== 1
    || JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(keys)
    || row.boundary !== 'eval-only' || row.adoptAllowed !== false || row.transport !== 'configured-chat-audio-input-v1'
    || row.caller !== 'scripts/evaluate-avg-audio-input.mjs' || row.contract !== 'scripts/avg-audio-input-contract.mjs'
    || typeof row.reason !== 'string' || !row.reason.trim()
    || [...(registry.entries ?? []), ...(registry.limitedTransports ?? [])].some(entry => entry.entryId === AUDIO_INPUT_ENTRY)) {
    throw new Error('Audio evaluation registry boundary rejected')
  }
}

export function inspectWav(bytes, expectedHash) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 44 || bytes.length > MAX_AUDIO_BYTES
    || !/^[a-f0-9]{64}$/.test(expectedHash) || sha256(bytes) !== expectedHash
    || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE'
    || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('WAV bytes/hash/header rejected')
  let fmt, data
  let offset = 12
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error('Truncated WAV chunk')
    const id = bytes.toString('ascii', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    const start = offset + 8
    if (start + size > bytes.length) throw new Error('Truncated WAV payload')
    if (id === 'fmt ') {
      if (fmt || size !== 16) throw new Error('WAV requires one PCM fmt chunk')
      fmt = { encoding: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4), byteRate: bytes.readUInt32LE(start + 8),
        blockAlign: bytes.readUInt16LE(start + 12), bits: bytes.readUInt16LE(start + 14) }
    }
    if (id === 'data') {
      if (data) throw new Error('Multiple WAV data chunks rejected')
      data = bytes.subarray(start, start + size)
    }
    offset = start + size + size % 2
  }
  if (offset !== bytes.length || !fmt || !data?.length || fmt.encoding !== 1 || fmt.bits !== 16
    || ![1, 2].includes(fmt.channels) || fmt.sampleRate < 8000 || fmt.sampleRate > 48000
    || fmt.blockAlign !== fmt.channels * 2 || fmt.byteRate !== fmt.sampleRate * fmt.blockAlign
    || data.length % fmt.blockAlign !== 0) throw new Error('Unsupported WAV format')
  const durationMs = data.length / fmt.byteRate * 1000
  if (durationMs > 20000) throw new Error('WAV exceeds 20-second evaluation boundary')
  return { channels: fmt.channels, sampleRate: fmt.sampleRate, durationMs, bytes: bytes.length, sha256: expectedHash }
}

export function makeSilence({ sampleRate, channels }) {
  const dataBytes = Math.round(sampleRate * 0.8) * channels * 2
  const out = Buffer.alloc(44 + dataBytes)
  out.write('RIFF'); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8)
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(channels, 22)
  out.writeUInt32LE(sampleRate, 24); out.writeUInt32LE(sampleRate * channels * 2, 28)
  out.writeUInt16LE(channels * 2, 32); out.writeUInt16LE(16, 34); out.write('data', 36)
  out.writeUInt32LE(dataBytes, 40)
  return out
}

export function parseAudioObservation(content, durationMs) {
  if (typeof content !== 'string' || content.length > 16000) throw new Error('Audio observation text rejected')
  const answer = JSON.parse(content.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1'))
  if (!answer || Array.isArray(answer) || JSON.stringify(Object.keys(answer).sort())
    !== JSON.stringify(['limitations', 'observations', 'perception', 'speechPresent', 'transcript'])
    || !['heard', 'not-heard', 'uncertain'].includes(answer.perception)
    || ![true, false, null].includes(answer.speechPresent) || typeof answer.transcript !== 'string' || answer.transcript.length > 4096
    || !Array.isArray(answer.observations) || answer.observations.length > 8
    || !Array.isArray(answer.limitations) || answer.limitations.length > 6
    || answer.limitations.some(item => typeof item !== 'string' || item.length > 400)
    || answer.observations.some(item => !item || Array.isArray(item)
      || JSON.stringify(Object.keys(item).sort()) !== JSON.stringify(['fromMs', 'observation', 'toMs'])
      || !Number.isFinite(item.fromMs) || !Number.isFinite(item.toMs) || item.fromMs < 0
      || item.toMs < item.fromMs || item.toMs > durationMs + 1
      || typeof item.observation !== 'string' || item.observation.length > 400)) throw new Error('Audio observation schema rejected')
  return answer
}

export function assessAudioCapability(results, expectedText) {
  const speech = results[0]?.observation
  const silence = results[1]?.observation
  const speechMatch = !!speech && speech.perception === 'heard' && speech.speechPresent === true
    && normalizeTranscript(speech.transcript) === normalizeTranscript(expectedText)
  const silenceCorrect = !!silence && silence.speechPresent === false && silence.transcript.trim() === ''
  return { outcome: speechMatch && silenceCorrect ? 'sample-transcription-capability-evidenced' : 'not-evidenced',
    speechMatch, silenceCorrect, acousticObservations: 'unverified-model-output',
    authorReviewChanged: false, adoptionAllowed: false, releaseAllowed: false,
    limitation: 'One WAV and one synthetic control establish no general acoustic, speaker, emotional, human, or commercial quality acceptance.' }
}
