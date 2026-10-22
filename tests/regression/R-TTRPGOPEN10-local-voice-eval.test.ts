import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseLimitedAITransports } from '../../src/lib/agent/limited-ai-transport'
import { assertFormalAIEntryCallV1, parseFormalAIEntryRegistryV1 } from '../../src/lib/agent/formal-ai-entry'

const caller = 'scripts/ttrpg-local-tts/evaluate.mjs'
const registry = JSON.parse(readFileSync('src/lib/agent/ai-entry-registry.json', 'utf8'))
const transport = registry.limitedTransports.find((entry: { entryId: string }) => entry.entryId === 'ttrpg.local-voice.eval')

describe('R-TTRPGOPEN10 fixed offline voice evaluation boundary', () => {
  it('checks a real fixed-case CLI without models, author input, adoption or playback', () => {
    const output = execFileSync(process.execPath, [caller, '--check-only', '--case', 'narration-zh'], { encoding: 'utf8' })
    expect(JSON.parse(output)).toMatchObject({ entryId: 'ttrpg.local-voice.eval', caseId: 'narration-zh',
      evaluationOnly: true, adoptAllowed: false, modelCalled: false, generationReady: false })
    expect(JSON.parse(output).caseHash).toMatch(/^[a-f0-9]{64}$/)
  })
  it.each([['--check-only', '--case', 'author-project'], ['--case', 'narration-zh', '--text', 'secret'],
    ['--case', 'narration-zh', '--project', '/author/project'], ['--case', 'narration-zh', '--case', 'long-zh'],
    ['--check-only'], ['--case']])('rejects non-fixture or ambiguous CLI args %j', (...args) => {
    const result = spawnSync(process.execPath, [caller, ...args], { encoding: 'utf8' })
    expect(result.status).toBe(1); expect(result.stdout).toBe('')
    expect(result.stderr).toContain('ttrpg-local-tts-eval')
  })
  it('does not grant the evaluation transport creative or legacy binding authority', () => {
    expect(parseLimitedAITransports([transport])[0]).toMatchObject({ boundary: 'offline-fixture-audio-eval', adoptAllowed: false })
    const formalEntries = parseFormalAIEntryRegistryV1(registry).entries
    expect(formalEntries.some(entry => entry.entryId === transport.entryId)).toBe(false)
    const frozen = structuredClone(registry); delete frozen.limitedTransports
    expect(parseFormalAIEntryRegistryV1(frozen).entries).toEqual(formalEntries)
    expect(() => assertFormalAIEntryCallV1({ formalEntryId: 'ttrpg.local-voice.eval', category: 'runtime.ttrpg-open.intent' })).toThrow(/未登记正式 AI 入口/)
    for (const patch of [{ adoptAllowed: true }, { adoptionTargets: ['work'] }, { allowedCallers: ['src/components/Ttrpg.tsx'] },
      { allowedCallers: ['scripts/ttrpg-local-tts/../adopt.mjs'] }, { boundary: 'product-runtime' }]) {
      expect(() => parseLimitedAITransports([{ ...transport, ...patch }])).toThrow(/有限语音/)
    }
    expect(() => parseLimitedAITransports([{ ...registry.limitedTransports.find((row: { boundary: string }) => row.boundary === 'read-only-audio'),
      allowedCallers: [caller] }])).toThrow(/有限语音/)
  })
  it('the actual Node guard rejects duplicate registration, authority changes and forged fixture bytes before any child', () => {
    const script = `
      import { assertVoiceTransport, selectEvaluationCase } from './${caller}';
      import { readFileSync } from 'node:fs';
      const registry=JSON.parse(readFileSync('src/lib/agent/ai-entry-registry.json','utf8'));
      const entry=registry.limitedTransports.find(row=>row.entryId==='ttrpg.local-voice.eval');
      const rejected=[];
      for(const patch of [{adoptAllowed:true},{boundary:'read-only-audio'},{allowedCallers:['src/fake.ts']}]) {
        try { assertVoiceTransport(entry.entryId,'${caller}',{...registry,limitedTransports:[{...entry,...patch}]}); rejected.push(false) }
        catch { rejected.push(true) }
      }
      try { assertVoiceTransport(entry.entryId,'${caller}',{...registry,limitedTransports:[entry,entry]}); rejected.push(false) }catch{ rejected.push(true) }
      try { selectEvaluationCase('narration-zh',Buffer.from('author secret')); rejected.push(false) }catch{ rejected.push(true) }
      console.log(JSON.stringify(rejected));
    `
    expect(JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }))).toEqual([true, true, true, true, true])
  })
  it('validates actual PCM bytes and original text; fabricated silent/corrupt/mislabeled audio never becomes a successful result', () => {
    const script = `
      import { verifyEvaluationResult, selectEvaluationCase } from './${caller}';
      import { createHash } from 'node:crypto';
      const {selected,contract}=selectEvaluationCase('narration-zh'), hash='0'.repeat(64);
      const samples=22050,sr=44100,wav=Buffer.alloc(44+samples*2);
      wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
      wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(sr,24);wav.writeUInt32LE(sr*2,28);
      wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
      for(let i=0;i<samples;i++)wav.writeInt16LE(i%2?8192:-8192,44+i*2);
      const digest=b=>createHash('sha256').update(b).digest('hex');
      const result={schema:'storyforge.ttrpg-local-tts-eval-result',version:1,caseId:selected.id,status:'generated',modelCalled:true,
        evaluationOnly:true,adoptAllowed:false,text:selected.text,normalizedText:selected.expectedNormalizedText,profileHash:hash,fixtureSha256:contract.fixtureSha256,
        network:'disabled',threads:2,humanListeningAcceptance:'unproven',samples,sampleRate:sr,durationMs:500,
        rms:8192/32767,peakBeforeGain:8192/32767,appliedGain:1,wallSeconds:1,cpuSeconds:1,maxRssBytes:1024,audioSha256:digest(wav)};
      verifyEvaluationResult(result,selected,contract,hash,wav);
      const bad=[];
      for(const patch of [{text:'another author text'},{normalizedText:'港口的钟声.'},{adoptAllowed:true},{caseId:'numbers-zh'},{profileHash:'wrong'},
        {modelCalled:false},{humanListeningAcceptance:'passed'},{audioSha256:'wrong'},{rms:0},{durationMs:999},{adoptionTargets:['work']}]){
        try{verifyEvaluationResult({...result,...patch},selected,contract,hash,wav);bad.push(false)}catch{bad.push(true)}
      }
      const silent=Buffer.from(wav);silent.fill(0,44);
      try{verifyEvaluationResult({...result,audioSha256:digest(silent)},selected,contract,hash,silent);bad.push(false)}catch{bad.push(true)}
      const altered=Buffer.from(wav);altered.writeUInt32LE(22050,24);
      try{verifyEvaluationResult({...result,audioSha256:digest(altered)},selected,contract,hash,altered);bad.push(false)}catch{bad.push(true)}
      const mixed=selectEvaluationCase('mixed-script-rejection').selected;
      const rejection={schema:result.schema,version:1,caseId:mixed.id,status:'expected-rejection',reasonCode:'unsupported-script',modelCalled:false,evaluationOnly:true,adoptAllowed:false};
      verifyEvaluationResult(rejection,mixed,contract,hash,null);
      try{verifyEvaluationResult(rejection,mixed,contract,hash,wav);bad.push(false)}catch{bad.push(true)}
      console.log(JSON.stringify({positive:true,bad}));
    `
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }))
    expect(result).toEqual({ positive: true, bad: Array(14).fill(true) })
  })
  it('keeps actual digits and paragraph separators in the frozen source and requires their exact declared spoken normalization', () => {
    const script = `
      import { selectEvaluationCase } from './${caller}';
      const n=selectEvaluationCase('numbers-arabic'), z=selectEvaluationCase('numbers-zh'),
        p=selectEvaluationCase('paragraphs-zh'), a=selectEvaluationCase('narration-zh');
      console.log(JSON.stringify({version:n.contract.version, digits:n.selected.text,
        sameSpokenNumbers:n.selected.expectedNormalizedText===z.selected.expectedNormalizedText,
        paragraphs:p.selected.text,paragraphNormalization:p.selected.expectedNormalizedText,
        sameParagraphChars:p.selected.expectedNormalizedText.replace('...','.')===a.selected.expectedNormalizedText}));
    `
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }))
    expect(result.version).toBe(2); expect(result.digits).toContain('8点20分'); expect(result.digits).toContain('12枚')
    expect(result.paragraphs).toContain('。\n\n你'); expect(result.sameSpokenNumbers).toBe(true); expect(result.sameParagraphChars).toBe(true)
    expect(result.paragraphNormalization).toContain('雾...你')
  })
})
