import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import evidence from '../../src/assets/ttrpg/narration-qwen-source-v1.json'
import { TTRPG_NARRATOR_VOICES_V1 } from '../../src/lib/ttrpg/narration-listening-preferences'

it('ships the exact two complete native Qwen recordings, with original public text and retained license evidence', () => {
  expect(evidence.voices.map(v => v.voice)).toEqual(TTRPG_NARRATOR_VOICES_V1.filter(v => v.id.startsWith('qwen.')).map(v => v.speaker))
  expect(evidence.referencePersonAudio).toBe(false)
  expect(evidence.sessionAudioAdoption).toBe(false)
  const hashes = new Set<string>()
  for (const voice of evidence.voices) {
    const bytes = readFileSync(resolve('src/assets/ttrpg', voice.file))
    const hash = createHash('sha256').update(bytes).digest('hex')
    expect(hash).toBe(voice.sha256); hashes.add(hash)
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF')
    expect(bytes.readUInt32LE(4) + 8).toBe(bytes.length)
    expect(bytes.toString('ascii', 8, 16)).toBe('WAVEfmt ')
    expect(bytes.readUInt16LE(20)).toBe(1); expect(bytes.readUInt16LE(22)).toBe(1)
    expect(bytes.readUInt32LE(24)).toBe(24000); expect(bytes.readUInt16LE(34)).toBe(16)
    expect(bytes.toString('ascii', 36, 40)).toBe('data')
    expect(bytes.readUInt32LE(40)).toBe(bytes.length - 44)
    expect((bytes.length - 44) / 2).toBe(voice.samples)
    expect(voice.samples).toBe(voice.codecTokens * 1920); expect(voice.eosObserved).toBe(true)
  }
  expect(hashes.size).toBe(2)
  const license = readFileSync(resolve(evidence.licenseFile))
  expect(createHash('sha256').update(license).digest('hex')).toBe('a44a6081c73ad75f0255bb2bb5cab74ef1829565a895a24e53a4f11290ab7655')
})
