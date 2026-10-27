import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseLimitedAITransports } from '../../src/lib/agent/limited-ai-transport'
import { assertFormalAIEntryCallV1 } from '../../src/lib/agent/formal-ai-entry'

const caller = 'scripts/ttrpg-local-tts/native-voice-evaluate.mjs'
const entryId = 'ttrpg.local-voice.native-fixture-eval'
describe('R-TTRPGOPEN10 native Chinese voice fixture admission', () => {
  it('has four pinned native presets with no model loaded or product authority', () => {
    const result = JSON.parse(execFileSync(process.execPath, [caller, '--check-only'], { encoding: 'utf8' }))
    expect(result).toEqual({ entryId, evaluationOnly: true, adoptionAllowed: false, modelCalled: false, voices: ['zm_010', 'zf_001', 'zm_011', 'zf_017'] })
    const registry = JSON.parse(readFileSync('src/lib/agent/ai-entry-registry.json', 'utf8'))
    const entry = registry.limitedTransports.find((r: {entryId: string}) => r.entryId === entryId)
    expect(parseLimitedAITransports([entry])[0]).toMatchObject({ boundary: 'offline-fixture-audio-eval', adoptAllowed: false })
    expect(() => assertFormalAIEntryCallV1({ formalEntryId: entryId, category: 'runtime.ttrpg-open.local-voice' })).toThrow()
  })
  it('selects only two fixed Qwen presets through the same limited entry without loading a model', () => {
    const result = JSON.parse(execFileSync(process.execPath, [caller, '--engine', 'qwen', '--check-only'], { encoding: 'utf8' }))
    expect(result).toEqual({ entryId, evaluationOnly: true, adoptionAllowed: false, modelCalled: false, voices: ['uncle_fu', 'serena'] })
    const source = `
      import assert from 'node:assert/strict';import {selectNativeFixture} from './${caller}';
      const k=selectNativeFixture(),q=selectNativeFixture('qwen');
      assert.equal(k.engine,'kokoro');assert.equal(q.profile.fixture,k.profile.fixture);
      assert.equal(q.profile.maxCalls,2);assert.equal(q.profile.maxCodecTokensPerVoice,512);
      assert.equal(q.profile.instructAllowed,false);assert.equal(q.profile.referenceVoiceAllowed,false);
      assert.throws(()=>selectNativeFixture('../unregistered-worker'));
      console.log('passed');`
    expect(execFileSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' }).trim()).toBe('passed')
  })
  it('rejects the actually observed over-budget Metal peak even if a worker reports success', () => {
    const source = `
      import assert from 'node:assert/strict';
      import {assertQwenResourceAdmission,selectNativeFixture} from './${caller}';
      const p=selectNativeFixture('qwen').profile;
      assert.equal(p.version,3);assert.equal(p.decoderChunkTokens,100);assert.equal(p.gpuMemoryLimitBytes,6442450944);
      const valid={resourceAcceptance:'passed',memoryGuidelineBytes:6442450944,peakMetalBytes:4000000000,memoryChecks:100};
      assertQwenResourceAdmission(valid,p);
      for(const patch of [{peakMetalBytes:7296809999},{peakMetalBytes:0},{peakMetalBytes:'4000000000'},
        {resourceAcceptance:'unproven'},{memoryGuidelineBytes:8589934592},{memoryChecks:0}])
        assert.throws(()=>assertQwenResourceAdmission({...valid,...patch},p));
      console.log('passed');`
    expect(execFileSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' }).trim()).toBe('passed')
  })
  it('preserves the valid zero codec frame instead of accepting the actual short V2 sample count', () => {
    const source = `
      import assert from 'node:assert/strict';import {assertQwenCodecClock,selectNativeFixture} from './${caller}';
      const p=selectNativeFixture('qwen').profile;assert.equal(p.decodeUpsampleRate,1920);
      const voice={codecTokens:318,samples:610560,sampleRate:24000,eosObserved:true};
      const pcm={samples:610560,sampleRate:24000};assertQwenCodecClock(voice,pcm,p);
      assert.throws(()=>assertQwenCodecClock({...voice,samples:608640},{...pcm,samples:608640},p));
      assert.throws(()=>assertQwenCodecClock({...voice,eosObserved:false},pcm,p));
      assert.throws(()=>assertQwenCodecClock({...voice,codecTokens:512},pcm,p));
      assert.throws(()=>assertQwenCodecClock({...voice,codecTokens:'318'},pcm,p));
      console.log('passed');`
    expect(execFileSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' }).trim()).toBe('passed')
  })
  it.each([
    ['--text', 'private'], ['--reference-voice', 'person.wav'], ['--voice', 'celebrity'], ['--project', '/author'],
    ['--check-only', '--check-only'], ['--check-only', '--melo-runtime-dir', '/tmp'], ['--native-runtime-dir'],
    ['--engine', 'unknown'], ['--engine', '../worker'], ['--engine'], ['--engine', 'qwen', '--engine', 'kokoro'],
  ])('rejects arbitrary/ambiguous input %j', (...args) => {
    const r = spawnSync(process.execPath, [caller, ...args], { encoding: 'utf8' })
    expect(r.status).toBe(1); expect(r.stdout).toBe(''); expect(r.stderr).toContain('ttrpg-native-fixture:')
  })
  it('does not grant altered transport authority or accept damaged, mismatched or silent PCM', () => {
    const source = `
      import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
      import {assertVoiceTransport,verifyNativeFixturePcm} from './${caller}';
      const registry=JSON.parse(readFileSync('src/lib/agent/ai-entry-registry.json','utf8'));
      const entry=registry.limitedTransports.find(r=>r.entryId==='${entryId}');
      for(const patch of [{adoptAllowed:true},{boundary:'read-only-audio'},{allowedCallers:['src/fake.ts']},{adoptionTargets:['world']}])
        assert.throws(()=>assertVoiceTransport('${entryId}','${caller}',{...registry,limitedTransports:[{...entry,...patch}]}));
      assert.throws(()=>assertVoiceTransport('${entryId}','${caller}',{...registry,limitedTransports:[entry,entry]}));
      const sr=24000,n=sr*6,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);
      b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(sr,24);b.writeUInt32LE(sr*2,28);
      b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);
      for(let i=0;i<n;i++)b.writeInt16LE(Math.round(10000*Math.sin(i/10)),44+i*2);
      assert.equal(verifyNativeFixturePcm(b).samples,n);assert.throws(()=>verifyNativeFixturePcm(b,'0'.repeat(64)));
      const s=Buffer.from(b);s.fill(0,44);assert.throws(()=>verifyNativeFixturePcm(s));
      assert.throws(()=>verifyNativeFixturePcm(b.subarray(0,b.length-2)));
      const wrong=Buffer.from(b);wrong.writeUInt32LE(44100,24);assert.throws(()=>verifyNativeFixturePcm(wrong));
      console.log('passed');`
    expect(execFileSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' }).trim()).toBe('passed')
  })
  it.each(['kokoro', 'qwen'])('respects the shared physical slot for %s and preserves its owner', engine => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'ttrpg-native-fixture-slot-'))
    try {
      const melo = path.join(temporary, 'shared'), runtime = path.join(temporary, 'candidate')
      mkdirSync(melo); mkdirSync(runtime)
      const lock = path.join(melo, '.eval.lock'), owner = JSON.stringify({ kind: 'other-active-evaluation', pid: process.pid })
      writeFileSync(lock, owner)
      const r = spawnSync(process.execPath, [caller, '--engine', engine, '--melo-runtime-dir', melo, '--native-runtime-dir', runtime], { encoding: 'utf8' })
      expect(r.status).toBe(1); expect(r.stderr).toContain('EEXIST'); expect(readFileSync(lock, 'utf8')).toBe(owner)
      expect(existsSync(path.join(runtime, '.eval.lock'))).toBe(false)
      const runs = readdirSync(path.join(runtime, 'evaluations')); expect(runs).toHaveLength(1)
      expect(JSON.parse(readFileSync(path.join(runtime, 'evaluations', runs[0], 'attempt.json'), 'utf8'))).toMatchObject({ status: 'failed', voices: [], automaticRetryAllowed: false })
    } finally { rmSync(temporary, { recursive: true, force: true }) }
  })
  it('retains a spawn failure and releases only its own two claims', () => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'ttrpg-native-fixture-spawn-'))
    try {
      const melo = path.join(temporary, 'shared'), runtime = path.join(temporary, 'candidate')
      mkdirSync(melo); mkdirSync(runtime)
      const r = spawnSync(process.execPath, [caller, '--melo-runtime-dir', melo, '--native-runtime-dir', runtime], { encoding: 'utf8' })
      expect(r.status).toBe(1); expect(r.stderr).toContain('ENOENT')
      expect(existsSync(path.join(melo, '.eval.lock'))).toBe(false); expect(existsSync(path.join(runtime, '.eval.lock'))).toBe(false)
      const runs = readdirSync(path.join(runtime, 'evaluations')); expect(runs).toHaveLength(1)
      expect(JSON.parse(readFileSync(path.join(runtime, 'evaluations', runs[0], 'attempt.json'), 'utf8'))).toMatchObject({ status: 'failed', voices: [], automaticRetryAllowed: false })
    } finally { rmSync(temporary, { recursive: true, force: true }) }
  })
  it('releases the shared claim if the candidate is already held, preserving the other claim', () => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'ttrpg-native-fixture-second-slot-'))
    try {
      const melo = path.join(temporary, 'shared'), runtime = path.join(temporary, 'candidate')
      mkdirSync(melo); mkdirSync(runtime)
      const lock = path.join(runtime, '.eval.lock'), owner = JSON.stringify({ kind: 'previous-unknown-attempt', pid: process.pid })
      writeFileSync(lock, owner)
      const r = spawnSync(process.execPath, [caller, '--melo-runtime-dir', melo, '--native-runtime-dir', runtime], { encoding: 'utf8' })
      expect(r.status).toBe(1); expect(r.stderr).toContain('EEXIST'); expect(readFileSync(lock, 'utf8')).toBe(owner)
      expect(existsSync(path.join(melo, '.eval.lock'))).toBe(false)
    } finally { rmSync(temporary, { recursive: true, force: true }) }
  })
})
