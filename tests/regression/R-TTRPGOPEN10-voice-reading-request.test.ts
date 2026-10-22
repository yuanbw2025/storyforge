import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupAudioRuntimeV1 } from '../helpers/open-audio-runtime'
import { prepareTtrpgOpenVoiceScriptV1,previewTtrpgOpenVoiceReadingV1,readTtrpgOpenReviewedVoiceReadingV1 } from '../../src/lib/ttrpg/open-audio-service'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { changeTtrpgSafetyStatus } from '../../src/lib/ttrpg/runtime-commands'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import profile from '../../scripts/ttrpg-local-tts/reading-profile.json'

/** Synthetic normalization response; actual current source/owner checks. */
describe('R-TTRPGOPEN10 bounded original CPU reading request',{timeout:60000},()=>{
  beforeEach(async()=>{await db.delete();await db.open()});afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();db.close()})
  async function fixture(){const f=await setupAudioRuntimeV1(true,'门口写着8点。'),sourceReview=await prepareTtrpgOpenVoiceScriptV1({...f.owner,narrationSourceRef:f.narrationSourceRef,audience:'party',privateActorKey:null,decision:'review-original-narration-for-voice'})
    const preview={schema:'storyforge.ttrpg-local-tts-reading-preview',version:1,profileHash:await hashCanonicalValue(profile),normalizerSha256:profile.normalizerSha256,status:'ready-for-reading-review',
      sourceText:f.text,sourceTextSha256:await sha256Text(f.text),overrides:[],readingText:f.text,normalizedText:'门口写着八点.',normalizedTextSha256:await sha256Text('门口写着八点.'),issues:[],issueCount:0,issueOffsetsReferTo:'readingText-utf16',modelCalled:false,generationAllowed:false,adoptionAllowed:false,network:'disabled'}
    return {...f,preview,input:{...f.owner,sourceReview,part:{textOffset:0,textLength:f.text.length},overrides:[],decision:'preview-this-original-voice-reading' as const}}}
  const response=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}})
  it('sends one bounded exact CPU-only request and returns a genuine source-bound review without changing any table',async()=>{
    const f=await fixture(),fetcher=vi.fn(async()=>response(f.preview));vi.stubGlobal('fetch',fetcher)
    const counts=await Promise.all(db.tables.map(t=>t.count())),review=await previewTtrpgOpenVoiceReadingV1(f.input)
    expect((await readTtrpgOpenReviewedVoiceReadingV1({...f.owner,review})).preview).toEqual(f.preview)
    expect(await Promise.all(db.tables.map(t=>t.count()))).toEqual(counts);expect(fetcher).toHaveBeenCalledTimes(1)
    const [url,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit]
    expect(url).toBe('/storyforge/local-tts/v1/reading-preview');expect(init.cache).toBe('no-store');expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({decision:'preview-this-original-voice-reading',input:{schema:'storyforge.ttrpg-local-tts-reading-input',version:1,text:f.text,overrides:[]}})
  })
  it('rejects copied source grants, invalid ranges and prior cancellation before making any HTTP request',async()=>{
    const f=await fixture(),fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
    await expect(previewTtrpgOpenVoiceReadingV1({...f.input,sourceReview:structuredClone(f.input.sourceReview)})).rejects.toThrow()
    await expect(previewTtrpgOpenVoiceReadingV1({...f.input,part:{textOffset:0,textLength:2001}})).rejects.toThrow()
    const controller=new AbortController();controller.abort();await expect(previewTtrpgOpenVoiceReadingV1({...f.input,signal:controller.signal})).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled();expect(await db.agentRuns.count()).toBe(0)
  })
  it('refuses a late CPU response after actual safety pause and does not retry, reserve, or turn it into a review capability',async()=>{
    const f=await fixture();let resolve!:(value:Response)=>void
    const fetcher=vi.fn(()=>new Promise<Response>(done=>{resolve=done}));vi.stubGlobal('fetch',fetcher)
    const result=expect(previewTtrpgOpenVoiceReadingV1(f.input)).rejects.toThrow()
    await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1))
    await changeTtrpgSafetyStatus({...await openEnvelopeV1(f.owner.sessionId,'reading.http.pause'),viewerKey:f.owner.viewerKey,changedBy:f.owner.viewerKey,status:'paused',reason:'原读法返回前暂停'})
    resolve(response(f.preview));await result;expect(fetcher).toHaveBeenCalledTimes(1);expect(await db.agentRuns.count()).toBe(0)
  })
  it('captures original parameters before yielding and refuses failed transport once without falling through to jobs or generation',async()=>{
    const f=await fixture(),fetcher=vi.fn(async()=>{throw Error('CPU transport unknown')});vi.stubGlobal('fetch',fetcher)
    const request={...f.input,scope:{...f.input.scope},part:{...f.input.part}},result=expect(previewTtrpgOpenVoiceReadingV1(request)).rejects.toThrow('CPU transport unknown')
    request.scope.projectId+=999;request.part.textLength=1;await result
    expect(fetcher).toHaveBeenCalledTimes(1);expect(await db.agentRuns.count()).toBe(0)
    const body=JSON.parse((fetcher.mock.calls[0] as unknown as [string,RequestInit])[1].body as string);expect(body.input.text).toBe(f.text)
  })
})
