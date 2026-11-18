import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFeedbackApp } from './server.mjs'
const repo = 'https://api.github.com/repos/yuanbw2025/storyforge'
/** @param {import('node:test').TestContext} t */
async function setup(t, locked = false) {
  /** @type {(RequestInit & {url:string})[]} */
  const calls = []
  const directory = mkdtempSync(join(tmpdir(), 'sf-feedback-'))
  const app = createFeedbackApp({ githubToken: 'mock', publicUploadPrefix: 'https://docs.storyforge-lab.com/feedback-files', uploadDir: join(directory,'uploads'), githubFetch: async (url, options = {}) => {
    calls.push({url:String(url), ...options})
    const row = { number: 42, title: '<script>untrusted</script>', body: 'public', state: 'open', locked, repository_url: repo, html_url: 'https://github.com/yuanbw2025/storyforge/issues/42' }
    return new Response(JSON.stringify(options.method === 'POST' ? { ...row, html_url: row.html_url+'#issuecomment-99' } : String(url).includes('/search/') ? { items: [row], total_count: 1 } : String(url).includes('/comments?') ? [] : row))
  } })
  const server = app.listen(0,'127.0.0.1'); await new Promise(resolve => server.once('listening',resolve));t.after(() => {server.closeAllConnections();server.close()})
  const address=server.address(); assert.ok(address && typeof address !== 'string'); const base = 'http://127.0.0.1:'+address.port
  /** @param {Record<string,unknown>} data */
  const post = data => fetch(base+'/feedback', {method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'bug',description:'new evidence', ...data})})
  return {base,calls,post}
}
test('explicit comment appends only to validated Issue and returns link; retry does not duplicate', async t => {
 const {post,calls}=await setup(t);const input={action:'comment',issueNumber:'42',requestId:'11111111-1111-4111-8111-111111111111'}
 assert.equal((await (await post(input)).json()).issueNumber,42);assert.equal((await post(input)).status,200)
 const writes=calls.filter(x=>x.method==='POST');assert.equal(writes.length,1);assert.equal(writes[0].url,repo+'/issues/42/comments');assert.match(JSON.parse(String(writes[0].body)).body,/匿名提交/)
 assert.equal((await post({...input,description:'changed'})).status,409)
})
test('legacy create stays compatible and never appends',async t=>{const {post,calls}=await setup(t);assert.equal((await post({title:'test'})).status,200);assert.equal(calls.find(x=>x.method==='POST')?.url,repo+'/issues')})
test('rejects malformed targets, implicit target and locked targets without writing',async t=>{const {post,calls}=await setup(t,true);for(const data of [{action:'comment',issueNumber:'https://evil/42'},{issueNumber:'42'},{action:'comment',issueNumber:'42'}]) assert.ok((await post(data)).status>=400);assert.equal(calls.filter(x=>x.method==='POST').length,0)})
test('search stays repository scoped, detail reads public comments',async t=>{const {base,calls}=await setup(t);assert.equal((await fetch(base+'/feedback?search=repo:evil/foo')).status,200);assert.match(new URL(calls[0].url).searchParams.get('q') ?? '',/repo:yuanbw2025\/storyforge is:issue "repo:evil\/foo"/);assert.equal((await (await fetch(base+'/feedback/42')).json()).issue.number,42)})
test('rejects cross-origin write before GitHub',async t=>{const {base,calls}=await setup(t);assert.equal((await fetch(base+'/feedback',{method:'POST',headers:{Origin:'https://evil.invalid'}})).status,403);assert.equal(calls.length,0)})
test('unknown upstream write remains pending and is never replayed',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'sf-unknown-'));let writes=0
 const server=createFeedbackApp({githubToken:'mock',uploadDir:join(directory,'uploads'),githubFetch:async()=>{writes++;throw Error('connection lost')}}).listen(0,'127.0.0.1')
 await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();server.close()})
 const address=server.address();assert.ok(address && typeof address !== 'string')
 const send=()=>fetch('http://127.0.0.1:'+address.port+'/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'bug',title:'test',description:'evidence',requestId:'22222222-2222-4222-8222-222222222222'})})
 assert.equal((await send()).status,502);assert.equal((await send()).status,409);assert.equal(writes,1)
})
test('multipart follow-up retains attachment rules and targets the existing issue',async t=>{const {base,calls}=await setup(t);const data=new FormData();for(const [k,v]of Object.entries({type:'bug',action:'comment',issueNumber:'42',description:'attachment evidence'}))data.set(k,v);data.set('attachments',new Blob(['safe mock'],{type:'text/plain'}),'sample.txt');assert.equal((await fetch(base+'/feedback',{method:'POST',body:data})).status,200);const write=calls.find(x=>x.method==='POST');assert.match(JSON.parse(String(write?.body)).body,/feedback/);assert.equal(write?.url,repo+'/issues/42/comments')})
