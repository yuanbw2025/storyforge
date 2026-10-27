import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, relative, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { db } from '../../src/lib/db/schema'
import { setupAudioRuntimeV1 } from '../helpers/open-audio-runtime'
import { prepareTtrpgOpenVoiceScriptV1, prepareTtrpgOpenVoiceReadingReviewV1, readTtrpgOpenReviewedVoiceReadingV1 } from '../../src/lib/ttrpg/open-audio-service'
import { ttrpgOpenVoiceReadingTextV1, verifyTtrpgOpenVoiceReadingPreviewV1 } from '../../src/lib/ttrpg/open-voice-reading-contract'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { changeTtrpgSafetyStatus } from '../../src/lib/ttrpg/runtime-commands'
import { rt } from '../helpers/open-ttrpg-branch-recovery'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'

const profile = JSON.parse(readFileSync('scripts/ttrpg-local-tts/reading-profile.json', 'utf8'))
const fixture = async (text = '门口写着8点。') => ({ schema: 'storyforge.ttrpg-local-tts-reading-preview', version: 1,
  profileHash: await hashCanonicalValue(profile), normalizerSha256: profile.normalizerSha256, status: 'ready-for-reading-review',
  sourceText: text, sourceTextSha256: await sha256Text(text), overrides: [], readingText: text,
  normalizedText: '门口写着八点.', normalizedTextSha256: await sha256Text('门口写着八点.'), issues: [], issueCount: 0,
  issueOffsetsReferTo: 'readingText-utf16', modelCalled: false, generationAllowed: false, adoptionAllowed: false, network: 'disabled' })

describe('R-TTRPGOPEN10 source-preserving local reading contract', () => {
  it('carries every actual reading JSON dependency into the frozen browser workspace without copying voice executors', () => {
    const runner = readFileSync('scripts/serve-e2e-snapshot.mjs', 'utf8')
    const manifest = runner.match(/const snapshotEntries = (\[[\s\S]*?\n\])/)?.[1]
    expect(manifest).toBeDefined()
    const entries = runInNewContext(manifest!) as string[], included = (asset: string) => entries.some(entry => asset === entry || asset.startsWith(`${entry}/`))
    const metadata = new Set<string>()
    for (const file of readdirSync('src/lib/ttrpg').filter(name => /\.tsx?$/.test(name)).map(name => 'src/lib/ttrpg/' + name)) {
      for (const imported of readFileSync(file, 'utf8').matchAll(/\b(?:from\s+|import\s*(?:\(\s*)?)['"]([^'"]+\.json)['"]/g)) {
        const absolute = resolve(dirname(resolve(file)), imported[1]), asset = relative(process.cwd(), absolute).replace(/\\/g, '/')
        expect(existsSync(absolute), asset).toBe(true); metadata.add(asset)
      }
    }
    expect(metadata.size).toBeGreaterThan(0)
    expect(metadata.has('scripts/ttrpg-local-tts/product-profile-v2.json')).toBe(true)
    for (const asset of metadata) expect(included(asset), asset).toBe(true)
    for (const file of ['product-bridge.mjs', 'product-jobs.mjs', 'product-contract.mjs', 'reading-preview.mjs']) expect(included(`scripts/ttrpg-local-tts/${file}`)).toBe(true)
    expect(runner).toContain('delete snapshotEnv.STORYFORGE_TTRPG_LOCAL_TTS_RUNTIME_DIR')
    for (const file of ['engine.py', 'evaluate.mjs', 'reading_frontend.py', 'product-worker.py']) expect(included(`scripts/ttrpg-local-tts/${file}`)).toBe(false)
  })
  it('retains original bytes and full UTF-16 ranges for explicit pronunciations, including a supplementary glyph', () => {
    const text = '𠮷野掷2d6+3。'
    expect(ttrpgOpenVoiceReadingTextV1(text, [{ textOffset: 0, textLength: 2, spokenText: '吉' },
      { textOffset: 4, textLength: 5, spokenText: '两枚六面骰，加三' }])).toEqual({
      overrides: [{ textOffset: 0, textLength: 2, spokenText: '吉' }, { textOffset: 4, textLength: 5, spokenText: '两枚六面骰，加三' }], readingText: '吉野掷两枚六面骰，加三。' })
    expect(text).toBe('𠮷野掷2d6+3。')
    for (const overrides of [[{ textOffset: 0, textLength: 1, spokenText: '吉' }], [{ textOffset: 1, textLength: 1, spokenText: '吉' }],
      [{ textOffset: 0, textLength: 2, spokenText: '' }], [{ textOffset: 0, textLength: 2, spokenText: '吉', generationAllowed: true }],
      [{ textOffset: 4, textLength: 5, spokenText: '骰' }, { textOffset: 0, textLength: 2, spokenText: '吉' }]]) {
      expect(() => ttrpgOpenVoiceReadingTextV1(text, overrides)).toThrow()
    }
    expect(() => ttrpgOpenVoiceReadingTextV1('中'.repeat(2001), [])).toThrow()
    expect(() => ttrpgOpenVoiceReadingTextV1('中', [{ textOffset: 0, textLength: 1, spokenText: '文'.repeat(4001) }])).toThrow()
  })
  it('verifies exact original/normalized hashes, fixed profile, bounded issues and no execution rights', async () => {
    const valid = await fixture()
    expect(await verifyTtrpgOpenVoiceReadingPreviewV1(valid, valid.sourceText, [])).toEqual(valid)
    for (const patch of [{ generationAllowed: true }, { modelCalled: true }, { adoptionAllowed: true }, { network: 'allowed' }, { sourceText: '另一团文字' },
      { sourceTextSha256: '0'.repeat(64) }, { normalizedText: '删改后的旁白' }, { normalizedTextSha256: '0'.repeat(64) }, { profileHash: '0'.repeat(64) },
      { normalizerSha256: '0'.repeat(64) }, { inputProject: 1 }, { issueCount: 1 }, { overrides: [{ textOffset: 0, textLength: 2, spokenText: '屋外' }] }]) {
      await expect(verifyTtrpgOpenVoiceReadingPreviewV1({ ...valid, ...patch }, valid.sourceText, [])).rejects.toThrow()
    }
    const blocked = { ...await fixture('编号001。'), status: 'needs-reading-choice', normalizedText: null, normalizedTextSha256: null,
      issues: [{ code: 'ambiguous-number', textOffset: 2, textLength: 3 }], issueCount: 1 }
    expect(await verifyTtrpgOpenVoiceReadingPreviewV1(blocked, blocked.sourceText, [])).toEqual(blocked)
    await expect(verifyTtrpgOpenVoiceReadingPreviewV1({ ...blocked, status: 'ready-for-reading-review' }, blocked.sourceText, [])).rejects.toThrow()
    await expect(verifyTtrpgOpenVoiceReadingPreviewV1({ ...blocked, issues: [{ code: 'ambiguous-number', textOffset: 6, textLength: 1 }] }, blocked.sourceText, [])).rejects.toThrow()
  })
  it('the real Node boundary rejects original substitution, split ranges, changed hashes and invocation flags', () => {
    const script = `
      import {validateReadingInput,verifyReadingPreview,readingProfileHash,parseReadingArgs} from './scripts/ttrpg-local-tts/reading-preview.mjs';
      import {createHash} from 'node:crypto';import {readFileSync} from 'node:fs';
      const p=JSON.parse(readFileSync('scripts/ttrpg-local-tts/reading-profile.json','utf8')),h=s=>createHash('sha256').update(s).digest('hex');
      const input={schema:'storyforge.ttrpg-local-tts-reading-input',version:1,text:'门口写着8点。',overrides:[]};
      const result={schema:'storyforge.ttrpg-local-tts-reading-preview',version:1,profileHash:readingProfileHash,normalizerSha256:p.normalizerSha256,
        status:'ready-for-reading-review',sourceText:input.text,sourceTextSha256:h(input.text),overrides:[],readingText:input.text,
        normalizedText:'门口写着八点.',normalizedTextSha256:h('门口写着八点.'),issues:[],issueCount:0,issueOffsetsReferTo:'readingText-utf16',
        modelCalled:false,generationAllowed:false,adoptionAllowed:false,network:'disabled'};
      verifyReadingPreview(result,input);const denied=[];
      for(const patch of [{modelCalled:true},{generationAllowed:true},{sourceText:'他人原文'},{normalizedTextSha256:'0'.repeat(64)},
        {issueCount:1},{profileHash:'0'.repeat(64)},{extra:'field'}]){
        try{verifyReadingPreview({...result,...patch},input);denied.push(false)}catch{denied.push(true)}
      }
      try{validateReadingInput({...input,text:'𠮷野',overrides:[{textOffset:0,textLength:1,spokenText:'吉'}]});denied.push(false)}catch{denied.push(true)}
      for(const args of [[],['--runtime-dir','x','--text','secret'],['--runtime-dir','--generate']]){
        try{parseReadingArgs(args);denied.push(false)}catch{denied.push(true)}
      }
      console.log(JSON.stringify({denied,hash:readingProfileHash}));`
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }))
    expect(result.denied).toEqual(Array(11).fill(true))
  })
  it('executes the actual CPU planner with no model: ambiguity blocks before normalization and explicit choices preserve original offsets', () => {
    const script = `
import importlib.util,json
s=importlib.util.spec_from_file_location('reading','scripts/ttrpg-local-tts/reading_frontend.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
p=json.load(open('scripts/ttrpg-local-tts/reading-profile.json'));calls=[]
def normalize(t):calls.append(t);return t
rows=[]
for text in ['编号001。','伤害-2。','时间12:30。','日期2026-10-18。','掷2d6+3。','去找𠮷野。','HP10。','进度50%。','数字12345678901234567。','伤害-二。','体力.5。','编号12。','2026年。','共1,000枚。','版本1.2.3。']:
 r=m.preview(text,[],normalize,p);assert r['status']=='needs-reading-choice' and r['sourceText']==text and r['normalizedText'] is None;rows.append(r)
assert not calls
source='𠮷野掷2d6+3。';overrides=[{'textOffset':0,'textLength':2,'spokenText':'吉'},{'textOffset':4,'textLength':5,'spokenText':'两枚六面骰，加三'}]
r=m.preview(source,overrides,normalize,p);assert r['sourceText']==source and r['normalizedText']=='吉野掷两枚六面骰，加三。'
bad=[]
for ranges in [[{'textOffset':0,'textLength':1,'spokenText':'吉'}],[{'textOffset':1,'textLength':1,'spokenText':'吉'}],list(reversed(overrides))]:
 try:m.apply_readings(source,ranges,p);bad.append(False)
 except ValueError:bad.append(True)
many=m.preview('中𠮷'*500,[],normalize,p);assert many['issueCount']==500 and len(many['issues'])==64 and many['sourceText']=='中𠮷'*500
print(json.dumps({'blocked':len(rows),'normalizerCalls':len(calls),'bad':bad,'manyIssueCount':many['issueCount']}))`
    expect(JSON.parse(execFileSync('python3', ['-B', '-c', script], { encoding: 'utf8' }))).toEqual({ blocked: 15, normalizerCalls: 1, bad: [true, true, true], manyIssueCount: 500 })
  })
})

describe('R-TTRPGOPEN10 actual owner reading review', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it('rechecks the actual accepted source and audience without reserving quota, creating a Run or changing narration', async () => {
    const s = await setupAudioRuntimeV1(true, '门口写着8点。')
    const sourceReview = await prepareTtrpgOpenVoiceScriptV1({ ...s.owner, narrationSourceRef: s.narrationSourceRef, audience: 'party', privateActorKey: null, decision: 'review-original-narration-for-voice' })
    const before = [await db.productRuntimeEvents.count(), await db.agentRuns.count(), await db.agentRunEvents.count()]
    const review = await prepareTtrpgOpenVoiceReadingReviewV1({ ...s.owner, sourceReview, part: { textOffset: 0, textLength: sourceReview.script.text.length },
      overrides: [], preview: await fixture(), decision: 'review-this-local-voice-reading' })
    expect(await readTtrpgOpenReviewedVoiceReadingV1({ ...s.owner, review })).toMatchObject({ preview: await fixture(), generationAllowed: false, adoptionAllowed: false })
    expect([await db.productRuntimeEvents.count(), await db.agentRuns.count(), await db.agentRunEvents.count()]).toEqual(before)
    expect(rt(await readProductRuntimeState(s.owner.sessionId)).openRun?.voiceRequests ?? []).toEqual([])
    await expect(readTtrpgOpenReviewedVoiceReadingV1({ ...s.owner, review: structuredClone(review) })).rejects.toThrow()
    await expect(readTtrpgOpenReviewedVoiceReadingV1({ ...s.owner, viewerKey: 'other.viewer', review })).rejects.toThrow()
    const saved = review.preview.readingText; review.preview.readingText = '改写'
    await expect(readTtrpgOpenReviewedVoiceReadingV1({ ...s.owner, review })).rejects.toThrow(); review.preview.readingText = saved
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.owner.sessionId, 'reading.pause'), viewerKey: s.owner.viewerKey,
      changedBy: s.owner.viewerKey, status: 'paused', reason: 'pause reading' })
    await expect(readTtrpgOpenReviewedVoiceReadingV1({ ...s.owner, review })).rejects.toThrow()
  })
  it('rejects a preview for a different original part before creating any domain or model records', async () => {
    const s = await setupAudioRuntimeV1(true, '门口写着8点。')
    const sourceReview = await prepareTtrpgOpenVoiceScriptV1({ ...s.owner, narrationSourceRef: s.narrationSourceRef, audience: 'party', privateActorKey: null, decision: 'review-original-narration-for-voice' })
    const count = await db.productRuntimeEvents.count()
    await expect(prepareTtrpgOpenVoiceReadingReviewV1({ ...s.owner, sourceReview, part: { textOffset: 2, textLength: 2 }, overrides: [],
      preview: await fixture(), decision: 'review-this-local-voice-reading' })).rejects.toThrow()
    expect(await db.productRuntimeEvents.count()).toBe(count); expect(await db.agentRuns.count()).toBe(0)
  })
})
