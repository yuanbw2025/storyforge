/** Real loopback HTTP + synthetic frontend response. No normalizer, weights,
 * speech child or independent listening is exercised by these protocol tests. */
import { describe,it,expect } from 'vitest'
import { execFileSync } from 'node:child_process'

function node(script:string){return JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`
import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {readFileSync,readdirSync} from 'node:fs';
import {createProductVoiceBridge,PREFIX} from './scripts/ttrpg-local-tts/product-bridge.mjs';
import {validateReadingInput,readingProfileHash} from './scripts/ttrpg-local-tts/reading-preview.mjs';
import {syntheticRuntime} from './tests/helpers/local-voice-product-fixture.mjs';
import {digest} from './scripts/ttrpg-local-tts/product-contract.mjs';
const p=JSON.parse(readFileSync('scripts/ttrpg-local-tts/reading-profile.json','utf8'));
const input={schema:'storyforge.ttrpg-local-tts-reading-input',version:1,text:'门口的灯。',overrides:[]};
const body=JSON.stringify({decision:'preview-this-original-voice-reading',input});
function result(value){const reading=validateReadingInput(value),normalized=reading.replaceAll('。','.');return {
 schema:'storyforge.ttrpg-local-tts-reading-preview',version:1,profileHash:readingProfileHash,normalizerSha256:p.normalizerSha256,
 status:'ready-for-reading-review',sourceText:value.text,sourceTextSha256:digest(value.text),overrides:value.overrides,readingText:reading,
 normalizedText:normalized,normalizedTextSha256:digest(normalized),issues:[],issueCount:0,issueOffsetsReferTo:'readingText-utf16',modelCalled:false,generationAllowed:false,adoptionAllowed:false,network:'disabled'}}
const runtime=syntheticRuntime(),initial=readdirSync(runtime);let calls=0,spawns=0;
const post=(url,value=body,signal)=>fetch(url+PREFIX+'/reading-preview',{method:'POST',headers:{'Content-Type':'application/json','X-StoryForge-TTS':'1'},body:value,signal});
const start=async options=>{const bridge=createProductVoiceBridge(runtime,{spawnWorker(){spawns++;throw Error('must not load speech')},...options}),server=createServer((req,res)=>bridge.middleware(req,res,()=>{res.writeHead(404);res.end()}));await new Promise(ok=>server.listen(0,'127.0.0.1',ok));return {bridge,server,url:'http://127.0.0.1:'+server.address().port}};
${script}
`],{encoding:'utf8',maxBuffer:2*1024*1024}))}

describe('R-TTRPGOPEN10 explicit bounded CPU reading bridge',{timeout:30000},()=>{
  it('requires same-origin explicit POST, verifies the exact frontend result, and never creates a job or starts speech',()=>{
    expect(node(`const {bridge,server,url}=await start({previewReading:async(_runtime,value)=>{calls++;return result(value)}});
try{
 const response=await post(url);assert.equal(response.status,200);assert.deepEqual(await response.json(),result(input));
 assert.equal((await fetch(url+PREFIX+'/reading-preview',{headers:{'X-StoryForge-TTS':'1'}})).status,404);
 assert.equal((await fetch(url+PREFIX+'/reading-preview',{method:'POST',body,headers:{'Content-Type':'application/json','X-StoryForge-TTS':'1',Origin:'https://foreign.example'}})).status,403);
 assert.equal((await fetch(url+PREFIX+'/reading-preview',{method:'POST',body})).status,403);
 assert.equal(calls,1);assert.equal(spawns,0);assert.deepEqual(readdirSync(runtime).filter(name=>name!=='product-jobs-v2'),initial);assert.deepEqual(readdirSync(runtime+'/product-jobs-v2'),[]);
 console.log(JSON.stringify({calls,spawns,noJob:true,runtime}));
}finally{bridge.close();await new Promise(ok=>server.close(ok))}`)).toMatchObject({calls:1,spawns:0,noJob:true})
  })
  it('rejects missing decisions, extra authority, invalid UTF8/BOM, oversized input and split or overlapping ranges before the CPU callback',()=>{
    expect(node(`const {bridge,server,url}=await start({previewReading:async()=>{calls++;throw Error('invalid input reached frontend')}});
try{
 const invalid=[JSON.stringify({input}),JSON.stringify({decision:'generate',input}),JSON.stringify({decision:'preview-this-original-voice-reading',input,model:true}),
 JSON.stringify({decision:'preview-this-original-voice-reading',input:{...input,text:'文'.repeat(2001)}}),
 JSON.stringify({decision:'preview-this-original-voice-reading',input:{...input,text:'𠮷野',overrides:[{textOffset:0,textLength:1,spokenText:'吉'}]}}),
 JSON.stringify({decision:'preview-this-original-voice-reading',input:{...input,overrides:[{textOffset:0,textLength:2,spokenText:'门'},{textOffset:1,textLength:1,spokenText:'口'}]}}),
 Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(body)]),Buffer.from([0xff]),'x'.repeat(65537)];
 for(const value of invalid){const r=await post(url,value);assert.equal(r.status,409);assert.equal((await r.json()).automaticRetryAllowed,false)}
 assert.equal(calls,0);assert.equal(spawns,0);console.log(JSON.stringify({rejected:invalid.length,calls,spawns,runtime}));
}finally{bridge.close();await new Promise(ok=>server.close(ok))}`)).toMatchObject({rejected:9,calls:0,spawns:0})
  })
  it('does not pass through substituted source, false hashes or added generation permission from the frontend',()=>{
    expect(node(`const patches=[{sourceText:'另一团的原文'},{normalizedTextSha256:'0'.repeat(64)},{generationAllowed:true}],{bridge,server,url}=await start({previewReading:async(_runtime,value)=>({...result(value),...patches[calls++]})});
try{for(let i=0;i<3;i++)assert.equal((await post(url)).status,409);assert.equal(calls,3);assert.equal(spawns,0);console.log(JSON.stringify({rejected:3,spawns,runtime}));}
finally{bridge.close();await new Promise(ok=>server.close(ok))}`)).toMatchObject({rejected:3,spawns:0})
  })
  it('holds one CPU preview slot, rejects overlap without queuing, and aborts only its own preview on disconnect or service close',()=>{
    expect(node(`let entered,aborted=0,wait=true;const enteredPromise=new Promise(ok=>entered=ok);
const {bridge,server,url}=await start({previewReading:async(_runtime,value,{signal})=>{calls++;if(wait)await new Promise((_ok,fail)=>{entered();signal.addEventListener('abort',()=>{aborted++;fail(Error('own preview stopped'))},{once:true})});return result(value)}});
try{
 const controller=new AbortController(),first=post(url,body,controller.signal).catch(()=>null);await enteredPromise;
 const overlapping=await post(url);assert.equal(overlapping.status,409);assert.equal((await overlapping.json()).error,'reading-preview-busy');assert.equal(calls,1);
 controller.abort();await first;for(let n=0;n<100&&aborted===0;n++)await new Promise(ok=>setTimeout(ok,5));assert.equal(aborted,1);
 wait=false;assert.equal((await post(url)).status,200);assert.equal(calls,2);
 wait=true;const pending=post(url);for(let n=0;n<100&&calls<3;n++)await new Promise(ok=>setTimeout(ok,5));assert.equal(calls,3);
 bridge.close();assert.equal((await pending).status,409);assert.equal(aborted,2);assert.equal((await post(url)).status,409);assert.equal(calls,3);assert.equal(spawns,0);
 console.log(JSON.stringify({calls,aborted,spawns,runtime}));
}finally{bridge.close();await new Promise(ok=>server.close(ok))}`)).toMatchObject({calls:3,aborted:2,spawns:0})
  })
})
