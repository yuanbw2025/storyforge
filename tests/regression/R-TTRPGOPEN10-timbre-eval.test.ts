import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, mkdtempSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseLimitedAITransports } from '../../src/lib/agent/limited-ai-transport'
import { assertFormalAIEntryCallV1 } from '../../src/lib/agent/formal-ai-entry'

const caller = 'scripts/ttrpg-local-tts/timbre-evaluate.mjs'
const entryId = 'ttrpg.local-voice.timbre-eval'
describe('R-TTRPGOPEN10 actual preset evaluation boundary', () => {
  it('inspects the fixed ten synthetic presets without loading a model/environment', () => {
    const result = JSON.parse(execFileSync(process.execPath, [caller, '--check-only'], { encoding: 'utf8' }))
    expect(result).toEqual({ entryId, evaluationOnly: true, adoptionAllowed: false, modelCalled: false, targetCount: 10 })
    const registry = JSON.parse(readFileSync('src/lib/agent/ai-entry-registry.json', 'utf8'))
    const entry = registry.limitedTransports.find((row: {entryId: string}) => row.entryId === entryId)
    expect(parseLimitedAITransports([entry])[0]).toMatchObject({ boundary: 'offline-fixture-audio-eval', adoptAllowed: false })
    expect(() => assertFormalAIEntryCallV1({ formalEntryId: entryId, category: 'runtime.ttrpg-open.local-voice' })).toThrow()
  })
  it.each([
    ['--text', 'private narration'], ['--reference-voice', '/person.wav'], ['--project', '/author'],
    ['--check-only', '--check-only'], ['--melo-runtime-dir'], ['--source-wav', '--check-only'],
  ])('rejects unregistered input or ambiguous arguments %j', (...args) => {
    const result = spawnSync(process.execPath, [caller, ...args], { encoding: 'utf8' })
    expect(result.status).toBe(1); expect(result.stdout).toBe(''); expect(result.stderr).toContain('ttrpg-timbre-eval:')
  })
  it('rejects fixture substitution, incomplete/silent PCM and forged transport authority', () => {
    const code = `
      import assert from 'node:assert/strict';
      import {readFileSync} from 'node:fs';
      import {verifyTimbreWav,assertVoiceTransport,timbreProfile} from './${caller}';
      const sr=22050, samples=Math.floor(timbreProfile.fixture.sourceSamples/2), bytes=Buffer.alloc(44+samples*2);
      bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);
      bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(sr,24);bytes.writeUInt32LE(sr*2,28);
      bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(samples*2,40);
      for(let i=0;i<samples;i++)bytes.writeInt16LE(Math.round(10000*Math.sin(i/10)),44+i*2);
      assert.equal(verifyTimbreWav(bytes).sampleRate,sr);
      assert.throws(()=>verifyTimbreWav(bytes,timbreProfile.fixture.sourceWavSha256,true));
      const silent=Buffer.from(bytes);silent.fill(0,44);assert.throws(()=>verifyTimbreWav(silent));
      const short=bytes.subarray(0,bytes.length-5000);assert.throws(()=>verifyTimbreWav(short));
      const registry=JSON.parse(readFileSync('src/lib/agent/ai-entry-registry.json','utf8'));
      const entry=registry.limitedTransports.find(row=>row.entryId==='${entryId}');
      for(const patch of [{adoptAllowed:true},{boundary:'read-only-audio'},{allowedCallers:['src/fake.ts']},{adoptionTargets:['world']}])
        assert.throws(()=>assertVoiceTransport('${entryId}','${caller}',{...registry,limitedTransports:[{...entry,...patch}]}));
      assert.throws(()=>assertVoiceTransport('${entryId}','${caller}',{...registry,limitedTransports:[entry,entry]}));
      console.log('passed');
    `
    expect(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }).trim()).toBe('passed')
  })
  it('keeps a failed-start receipt and releases its own lock when the pinned interpreter is absent', () => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'ttrpg-timbre-eval-failure-'))
    try {
      const runtime = path.join(temporary, 'candidate'); mkdirSync(runtime)
      const result = spawnSync(process.execPath, [caller, '--melo-runtime-dir', path.join(temporary, 'missing'),
        '--timbre-runtime-dir', runtime, '--source-wav', path.resolve('src/assets/ttrpg/narration-preview.wav')], { encoding: 'utf8' })
      expect(result.status).toBe(1); expect(result.stderr).toContain('ENOENT')
      expect(existsSync(path.join(runtime, '.eval.lock'))).toBe(false)
      const runs = readdirSync(path.join(runtime, 'evaluations')); expect(runs).toHaveLength(1)
      const attempt = JSON.parse(readFileSync(path.join(runtime, 'evaluations', runs[0], 'attempt.json'), 'utf8'))
      expect(attempt).toMatchObject({ status: 'failed', automaticRetryAllowed: false, voices: [] })
      expect(attempt.error).toContain('ENOENT')
    } finally { rmSync(temporary, { recursive: true, force: true }) }
  })
})
