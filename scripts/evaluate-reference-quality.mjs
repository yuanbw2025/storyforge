// Eval only: fixed public/original fixtures, no database, adoption, retry or publishing.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { assertOfflineReferenceEntry, REFERENCE_QUALITY_MAX_CALLS } from './reference-quality-contract.mjs'
import { createServer } from 'vite'
/** @typedef {{id: string, title: string, text: string, author?: string}} ReferenceEvalCase */
/** @typedef {{role: 'system'|'user'|'assistant', content: string}} ReferenceEvalMessage */
const root = process.cwd()
const output = process.argv[2]
if (!output || !output.startsWith('/') || output.startsWith(root + '/')) throw Error('Use an absolute output directory outside the checkout')
const registry = JSON.parse(await readFile('src/lib/agent/ai-entry-registry.json','utf8'))
assertOfflineReferenceEntry(registry)
const local = await import(pathToFileURL(join(process.env.STORYFORGE_LOCAL_API_HOME || join(homedir(),'.config/storyforge/api'),'lib/local-api.mjs')).href)
const {profile,apiKey} = local.loadProfile(process.argv[3] || 'agnes-primary',{purpose:'comparison'})
const server = await createServer({server:{middlewareMode:true},appType:'custom'})
await mkdir(output,{recursive:false})
let calls=0
/** @param {string | Uint8Array} x */
const hash = x=>createHash('sha256').update(x).digest('hex')
try {
  const {referenceChunkMessages} = await server.ssrLoadModule('/src/lib/reference-analysis/chunk-prompt.ts')
  const {REFERENCE_APPLICATION_SKILL} = await server.ssrLoadModule('/src/lib/reference-analysis/content-skill.ts')
  const baselineSource = JSON.parse(await readFile('tests/fixtures/reference-quality/baseline-prompt.json','utf8'))
  const baseline = new Function(ts.transpile(baselineSource)+';return referenceChunkMessages')()
  const fixture = process.env.REFERENCE_EVAL_PUBLIC ? 'tests/fixtures/reference-quality/public-cases.json' : 'tests/fixtures/reference-quality/cases.json'
  /** @type {ReferenceEvalCase[]} */
  const allCases = JSON.parse(await readFile(fixture,'utf8'))
  const caseFilter = process.env.REFERENCE_EVAL_CASES
  const cases = caseFilter ? allCases.filter(c => caseFilter.split(',').includes(c.id)) : allCases
  const sourceHashes=Object.fromEntries(await Promise.all(['src/lib/reference-analysis/chunk-prompt.ts','src/lib/reference-analysis/content-skill.ts',fixture].map(async p=>[p,hash(await readFile(p))])))
  /**
   * @param {string} id
   * @param {ReferenceEvalMessage[]} messages
   * @returns {Promise<string>}
   */
  const request = async (id,messages,maxTokens=8192) => {
    if (++calls>REFERENCE_QUALITY_MAX_CALLS) throw Error('Evaluation call cap exceeded')
    const body={...profile.api.chat.requestDefaults,model:profile.modelOrCapability,messages,stream:false,max_tokens:maxTokens,temperature:0.3}
    const started=Date.now()
    let response; try { response = await fetch(profile.endpoint.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)}) } catch { await writeFile(resolve(output,id+'.failure.json'),JSON.stringify({id,error:'transport-timeout-or-network',elapsedMs:Date.now()-started})); throw Error('Transport failed; no retry') }
    if(!response.ok) {await writeFile(resolve(output,id+'.failure.json'),JSON.stringify({status:response.status,elapsedMs:Date.now()-started})); throw Error('Provider HTTP '+response.status)}
    const data=await response.json(), text=data.choices?.[0]?.message?.content
    if(typeof text!=='string') throw Error('Missing response text')
    await writeFile(resolve(output,id+'.json'),JSON.stringify({id,model:body.model,temperature:body.temperature,maxTokens,messages,promptHash:hash(JSON.stringify(messages)),text,usage:data.usage,finishReason:data.choices[0].finish_reason,elapsedMs:Date.now()-started},null,2))
    console.log(id+' saved')
    return text
  }
  /** @type {Record<string, Record<string, string>>} */
  const analyses={}
  for(const c of cases) {
    const args={ref:{title:c.title,author:c.author || '评测原创',type:'story'},depth:'deep',chunk:{index:0,text:c.text,label:'仅本次提供范围',charCount:c.text.length},totalChunks:1}
    analyses[c.id]={}
    for(const [variant,builder] of [['old',baseline],['new',referenceChunkMessages]]) analyses[c.id][variant]=await request(c.id+'-'+variant,builder(args))
  }
  // Repeat two development cases; keep all results, including regressions.
  for(const c of (process.env.REFERENCE_EVAL_SHORT ? [] : cases.filter(c => ['knowledge','quiet'].includes(c.id)))) for(const [variant,builder] of [['old',baseline],['new',referenceChunkMessages]]) await request(c.id+'-'+variant+'-repeat',builder({ref:{title:c.title,type:'story'},depth:'deep',chunk:{index:0,text:c.text,charCount:c.text.length},totalChunks:1}))
  // 2x2 exploratory ablation: equal whole-unit material cap, same task/model/output budget.
  for(const c of (process.env.REFERENCE_EVAL_SHORT ? [] : cases.filter(c => ['knowledge','quiet'].includes(c.id)))) {
    const task=c.id==='quiet'?'写一段500字以内的新故事：空间站维修员与离职前的搭档整理工具。保持安静与人物边界，不出现师徒或椅子。':'写一段500字以内的新故事：两名市集测绘员商量撤离，甲隐瞒通行证失效，乙已从别处知道。乙不直接拆穿，不出现船票、姐弟或病人。'
    for(const material of ['old','new']) for(const instruction of ['old','new']) {
      let parsed; try{parsed=JSON.parse(analyses[c.id][material].replace(/^```json\s*|\s*```$/g,''))}catch{throw Error('Analysis JSON invalid')}
      const keys=c.id==='quiet'?['characterCraft','dialogueTechnique','emotionalBeats']:['narrativeStyle','characterCraft','dialogueTechnique']
      const units=keys.map(k=>[k,parsed[k]]).filter(([,v])=>typeof v==='string')
      const selected=[];for(const unit of units)if(JSON.stringify([...selected,unit]).length<=1800)selected.push(unit)
      await request(c.id+'-apply-'+material+'-'+instruction,[{role:'system',content:instruction==='new'?REFERENCE_APPLICATION_SKILL:'请灵活运用参考方法论指导写作，不要生搬硬套。'},{role:'user',content:JSON.stringify(selected)+'\n'+task}],2048)
    }
  }
  await writeFile(resolve(output,'manifest.json'),JSON.stringify({calls,model:profile.modelOrCapability,sourceHashes,limits:'Exploratory developer review; no human readers, not a longform or market evaluation'},null,2))
} finally {await server.close()}
