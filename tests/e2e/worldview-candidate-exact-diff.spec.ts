import { expect, test, type Page, type TestInfo, type Locator } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { cpus, totalmem } from 'node:os'

const left='# 星海\r\n原有议席每七次退潮轮换。\r\n\r\n## 约定\r\n仍须遵守原有边界。'
const right='# 星海\r\n原有议席每七次退潮轮换。\r\n\r\n> 因果约束：甲因乙果。\r\n\r\n> 势力关联：两方互助。\r\n\r\n> 剧情伏笔：未响的钟。\r\n\r\n## 约定\r\n仍须遵守原有边界。'
const themes=['storyforge','inkwash','mist','paper-ink','apricot','vellum','gilded','verdant','ember','silver-blue','dusk','starlight','starlight-dark','cosmic-glass']
async function attachJSON(info:TestInfo,name:string,value:unknown){const path=info.outputPath(name);writeFileSync(path,typeof value==='string'?value:JSON.stringify(value,null,2));await info.attach(name,{path,contentType:'application/json'})}
const rawHash=(value:string)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
function readTextareaGeometry(element:Element){const input=element as HTMLTextAreaElement,css=getComputedStyle(input),rect=input.getBoundingClientRect();return{className:input.className,bbox:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},clientWidth:input.clientWidth,clientHeight:input.clientHeight,scrollTop:input.scrollTop,scrollLeft:input.scrollLeft,scrollHeight:input.scrollHeight,wrap:input.wrap,spellcheck:input.spellcheck,readOnly:input.readOnly,disabled:input.disabled,ariaInvalid:input.getAttribute('aria-invalid'),inert:!!input.closest('[inert],[hidden],[aria-hidden="true"]'),focused:document.activeElement===input,selection:[input.selectionStart,input.selectionEnd,input.selectionDirection],valueLength:input.value.length,layoutKey:input.closest('[data-input-area-layout]')?.getAttribute('data-input-area-layout')??null,mode:input.closest('.worldview-review-v2')?.querySelector('[aria-pressed="true"]')?.textContent??null,css:Object.fromEntries(['fontFamily','fontSize','fontWeight','lineHeight','whiteSpace','wordBreak','overflowWrap','letterSpacing','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderTopStyle','borderRightStyle','borderBottomStyle','borderLeftStyle','boxSizing','overflowX','overflowY','height','minHeight','maxHeight','width','minWidth','maxWidth','resize'].map(key=>[key,Reflect.get(css,key)])),dpr:devicePixelRatio,visualScale:visualViewport?.scale??null,rootZoom:getComputedStyle(document.documentElement).zoom,bodyZoom:getComputedStyle(document.body).zoom}}
function startInputObservation(element:Element,detailed:boolean){
  const input=element as HTMLTextAreaElement,tasks:Array<{start:number;duration:number}>=[],events:unknown[]=[],controller=new AbortController(),started=performance.now(),marks:Record<string,number>={start:started}
  const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())tasks.push({start:entry.startTime,duration:entry.duration})});observer.observe({type:'longtask',buffered:false})
  const record=(phase:string,event:Event)=>{if(event.target!==input)return;const css=getComputedStyle(input),rect=input.getBoundingClientRect();events.push({phase,at:performance.now(),trusted:event.isTrusted,inputType:(event as InputEvent).inputType,dataUnits:(event as InputEvent).data?.length??0,units:input.textLength,bbox:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},clientWidth:input.clientWidth,clientHeight:input.clientHeight,scrollTop:input.scrollTop,scrollLeft:input.scrollLeft,scrollHeight:input.scrollHeight,wrap:input.wrap,whiteSpace:css.whiteSpace,wordBreak:css.wordBreak,overflowWrap:css.overflowWrap,spellcheck:input.spellcheck,focused:document.activeElement===input,inert:!!input.closest('[hidden],[inert],[aria-hidden="true"]'),readOnly:input.readOnly,disabled:input.disabled,selection:[input.selectionStart,input.selectionEnd]})}
  if(detailed){window.addEventListener('beforeinput',event=>record('beforeinput',event),{capture:true,signal:controller.signal});window.addEventListener('input',event=>record('input-before-react',event),{capture:true,signal:controller.signal});document.addEventListener('input',event=>record('input-after-react',event),{signal:controller.signal})}
  Reflect.set(window,'__054InputMeasure',{tasks,events,controller,observer,started,marks})
}
function stopInputObservation(){const measurement=Reflect.get(window,'__054InputMeasure') as {tasks:Array<{start:number;duration:number}>;events:unknown[];controller:AbortController;observer:PerformanceObserver;started:number;marks:Record<string,number>};for(const entry of measurement.observer.takeRecords())measurement.tasks.push({start:entry.startTime,duration:entry.duration});measurement.observer.disconnect();measurement.controller.abort();return{elapsed:performance.now()-measurement.started,longTasks:measurement.tasks,events:measurement.events,marks:{...measurement.marks,done:performance.now()}}}
async function measureInputPair(page:Page,target:Locator,initial:string,text:string,info:TestInfo,tag:string,ack:()=>Promise<void>,step:'bulk'|'small'|'both'='both'){
  await expect(target).toHaveValue(initial);await target.evaluate(element=>{const input=element as HTMLTextAreaElement,top=input.scrollTop,left=input.scrollLeft;input.focus({preventScroll:true});input.setSelectionRange(input.value.length,input.value.length);input.scrollTop=top;input.scrollLeft=left})
  const actualInitial=await target.inputValue(),before=await target.evaluate(readTextareaGeometry),detailedObservation=process.env.STORYFORGE_DIFF_PERF!=='matched-input-passive';expect(actualInitial).toBe(initial);expect(before.bbox.width).toBeGreaterThan(200);expect(before.inert).toBe(false);await target.evaluate(startInputObservation,detailedObservation)
  let failure:unknown=null
  const mark=(name:string)=>page.evaluate(name=>Reflect.get(window,'__054InputMeasure').marks[name]=performance.now(),name)
  try{if(step!=='small'){await mark('bulkStart');await target.fill(text);await mark('bulkFilled');await expect(target).toHaveValue(text);await ack();await mark('bulkAck');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await mark('bulkPaint')}
    if(step!=='bulk'){if(step==='both')await target.evaluate(element=>{const input=element as HTMLTextAreaElement;input.focus({preventScroll:true});input.setSelectionRange(input.value.length,input.value.length)})
    await mark('smallStart');await page.keyboard.insertText('新');await mark('smallFilled');await expect(target).toHaveValue(text+'新');await ack();await mark('smallAck');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await mark('smallPaint')}
  }catch(error){failure=error}
  const measured=await page.evaluate(stopInputObservation),after=await target.evaluate(readTextareaGeometry),actualFinal=await target.inputValue(),record={tag,step,bulkExecuted:step!=='small',smallExecuted:step!=='bulk',initialHash:rawHash(initial),initialUnits:initial.length,bulkHash:rawHash(text),bulkUnits:text.length,smallHash:rawHash(text+'新'),smallUnits:text.length+1,actualInitialHash:rawHash(actualInitial),actualInitialUnits:actualInitial.length,actualFinalHash:rawHash(actualFinal),actualFinalUnits:actualFinal.length,profiler:false,observation:detailedObservation?'per-event-geometry-diagnostic':'passive-longtasks-only',before,after,...measured,error:failure instanceof Error?failure.message:failure?String(failure):null}
  await attachJSON(info,`054-${tag}-matched-input.json`,record);if(failure)throw failure;return record
}
async function mountMatchingControl(page:Page,reference:ReturnType<typeof readTextareaGeometry>,initial:string){
  await page.evaluate(async({reference,initial})=>{
    const load=new Function('path','return import(path)') as <T>(path:string)=>Promise<T>
    const [react,dom,{CTextarea},layout]=await Promise.all([load<{default:typeof import('react')}>('/storyforge/node_modules/.vite/deps/react.js'),load<{default:typeof import('react-dom/client')}>('/storyforge/node_modules/.vite/deps/react-dom_client.js'),load<typeof import('../../src/components/shared/CompositionInput')>('/storyforge/src/components/shared/CompositionInput.tsx'),load<typeof import('../../src/lib/input-area-layout')>('/storyforge/src/lib/input-area-layout.ts')])
    const host=document.createElement('div');host.dataset.nativeReactControl='054';host.className='worldview-review-v2';Object.assign(host.style,{width:`${reference.bbox.width+24}px`,position:'fixed',left:`${reference.bbox.x-12}px`,top:`${reference.bbox.y-12}px`,zIndex:'2147483000'});document.body.append(host)
    function Controlled(){const [value,setValue]=react.default.useState(initial);return react.default.createElement(CTextarea,{value,onChange:event=>setValue(event.target.value),'aria-label':'054 matched CTextarea baseline',className:reference.className,wrap:reference.wrap,spellCheck:reference.spellcheck,inputAreaLayout:layout.inputAreaLayoutV1(reference.layoutKey!==null,layout.worldviewInputAreaFieldV1('worldOrigin'),'candidate'),style:{height:reference.css.height,fontFamily:reference.css.fontFamily,fontSize:reference.css.fontSize,lineHeight:reference.css.lineHeight}})}
    const root=dom.default.createRoot(host);Reflect.set(window,'__054ControlRoot',root);root.render(react.default.createElement(Controlled))
  },{reference,initial})
  const control=page.getByRole('textbox',{name:'054 matched CTextarea baseline',exact:true});await expect(control).toBeVisible();await control.evaluate((element,reference)=>{const input=element as HTMLTextAreaElement;Object.assign(input.style,reference.css);if(reference.ariaInvalid!==null)input.setAttribute('aria-invalid',reference.ariaInvalid);input.setSelectionRange(reference.selection[0] as number,reference.selection[1] as number,reference.selection[2] as 'forward'|'backward'|'none');input.scrollTop=reference.scrollTop;input.scrollLeft=reference.scrollLeft},reference)
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  const measured=await control.evaluate(readTextareaGeometry)
  for(const dimension of ['width','height'] as const)expect(Math.abs(measured.bbox[dimension]-reference.bbox[dimension])).toBeLessThanOrEqual(1)
  expect(measured.clientWidth).toBe(reference.clientWidth);expect(measured.clientHeight).toBe(reference.clientHeight);expect(measured.css).toEqual(reference.css);expect(measured.wrap).toBe(reference.wrap);expect(measured.spellcheck).toBe(reference.spellcheck)
  return control
}
function readDiffContrast(element:Element){
  const rgb=(value:string)=>{const parts=value.match(/[\d.]+/g)?.map(Number);if(!parts||parts.length<3)throw new Error('unsupported computed color');return parts}
  const luminance=(value:number[])=>value.slice(0,3).map(n=>{const c=n/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4}).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0)
  const effective=(node:Element)=>{let background=[255,255,255,1];const chain:Element[]=[];for(let p:Element|null=node;p;p=p.parentElement)chain.push(p);for(const p of chain.reverse()){const color=rgb(getComputedStyle(p).backgroundColor),alpha=color[3]??1;background=color.slice(0,3).map((n,i)=>n*alpha+background[i]*(1-alpha)).concat(1)}return background}
  return [...element.querySelectorAll<HTMLElement>('.wv-diff-cell,.wv-diff-span,button,.wv-diff-decoration')].filter(node=>node.getClientRects().length).map(node=>{const style=getComputedStyle(node),a=luminance(rgb(style.color)),b=luminance(effective(node));return{kind:node.dataset.diffKind??node.className,row:node.closest('.wv-diff-row')?.className,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),font:parseFloat(style.fontSize),line:parseFloat(style.lineHeight)}})
}

// Observe the actual browser Worker without replacing its implementation or
// bypassing the production job protocol. Only isolated synthetic text is kept.
async function observeNativeDiffWorkers(page:Page) {
  await page.addInitScript(()=>{
    const observations:{jobs:Array<{url:string;at:number;job:any}>;replies:Array<{at:number;jobId:unknown;inputBindingHash:unknown;type:unknown}>;terminated:Array<{at:number;jobId:number|undefined}>}={jobs:[],replies:[],terminated:[]}
    Reflect.set(window,'__054NativeWorkers',observations)
    const NativeWorker=window.Worker
    window.Worker=new Proxy(NativeWorker,{construct(Target,args){
      const worker=Reflect.construct(Target,args) as Worker,url=String(args[0]),post=worker.postMessage.bind(worker),terminate=worker.terminate.bind(worker)
      let jobId:number|undefined
      if(url.includes('worldview-diff'))worker.addEventListener('message',event=>observations.replies.push({at:performance.now(),jobId:event.data?.jobId,inputBindingHash:event.data?.inputBindingHash,type:event.data?.type}))
      worker.postMessage=(message:unknown,options?:any)=>{if(url.includes('worldview-diff')){jobId=(message as {jobId?:number}).jobId;observations.jobs.push({url,at:performance.now(),job:structuredClone(message)})}post(message,options)}
      worker.terminate=()=>{if(url.includes('worldview-diff'))observations.terminated.push({at:performance.now(),jobId});terminate()}
      return worker
    }})
  })
}

async function nativeWorkerMatrix(page:Page,measureCore:boolean) {
  return page.evaluate(async measureCore=>{
    const observed=Reflect.get(window,'__054NativeWorkers') as {jobs:Array<{url:string;job:any}>}
    const original=observed.jobs.find(item=>item.url.includes('worldview-diff'))
    if(!original)throw new Error('No real view-dispatched worker job')
    const canonical=(value:any):string=>JSON.stringify((function sort(item:any):any{if(Array.isArray(item))return item.map(sort);if(item&&typeof item==='object')return Object.fromEntries(Object.keys(item).filter(key=>item[key]!==undefined).sort().map(key=>[key,sort(item[key])]));return item})(value))
    const hash=async(value:unknown)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value))))].map(byte=>byte.toString(16).padStart(2,'0')).join('')
    const records:any[]=[],longTasks:Array<{start:number;duration:number}>=[]
    const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())longTasks.push({start:entry.startTime,duration:entry.duration})})
    observer.observe({type:'longtask',buffered:false})
    let serial=10000
    // Development-only timing of the unchanged A kernel in a real browser
    // Worker. Its clock excludes startup, messaging and B protocol hashing;
    // production end-to-end measurements below use the actual built Worker.
    const coreURL=measureCore?URL.createObjectURL(new Blob([`import {diffWorldviewTextExactV2} from ${JSON.stringify(new URL('/storyforge/src/lib/agent/worldview-text-diff-v2.ts',location.origin).href)};
self.onmessage=event=>{try{const started=performance.now();const result=diffWorldviewTextExactV2(event.data);self.postMessage({elapsed:performance.now()-started,work:result.work,coarseReasons:result.coarseReasons});}catch(error){self.postMessage({error:String(error)});}};`],{type:'text/javascript'})):null
    const cases=(size:number)=>{
      const fit=(text:string)=>text.repeat(Math.ceil(size/text.length)).slice(0,size)
      const prose=fit('第七章 星海约定\n甲方在退潮时归还钥匙，乙方保管旧信。\n\n')
      const chapters=Array.from({length:20},(_,i)=>`第${i}章\n${fit(`星海${i}号约定。\n`).slice(0,Math.floor(size/20)-12)}\n`).join('')
      return [
        ['same',prose,prose],['small',prose,prose.slice(0,size/2)+'八'+prose.slice(size/2+1)],['all',fit('甲'),fit('乙')],
        ['repeated',fit('重复段落\n\n'),fit('重复段落\n\n').replace('重复','新增')],['reordered',chapters,chapters.slice(chapters.length>>1)+chapters.slice(0,chapters.length>>1)],
        ['long-line',fit('一行超长正文，'),fit('一行超长正文，').slice(0,-1)+'。'],['no-newline',fit('甲乙丙丁'),fit('甲乙戊丁')],
        ['table-list',fit('| 项目 | 数量 |\n| 星海 | 70 |\n- 第一项\n'),fit('| 项目 | 数量 |\n| 星海 | 80 |\n- 新增项\n')],
        ['emoji-crlf',fit('👩‍🚀 星海 e\u0301\r\n\r\n'),fit('👩‍🚀 星海 e\u0301\r\n\r\n').replace('星海','银河')],
      ] as const
    }
    const makeJob=async(leftRaw:string,rightRaw:string)=>{
      const job={...original.job,jobId:++serial,rightRevision:serial,leftRaw,rightRaw,leftHash:await hash(leftRaw),rightHash:await hash(rightRaw)}
      job.inputBindingHash=await hash({jobId:job.jobId,identityKey:job.identityKey,baselineHash:job.baselineHash,leftHash:job.leftHash,rightRevision:job.rightRevision,rightHash:job.rightHash,sourceKind:job.sourceKind,profileRequestHash:job.profileRequestHash,budgetHash:job.budgetHash})
      return job
    }
    const run=async(worker:Worker,job:any,started=performance.now())=>{
      const reply=await new Promise<any>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Native matrix worker exceeded 1200ms')),1200);worker.onmessage=event=>{clearTimeout(timeout);resolve(event.data)};worker.onerror=event=>{clearTimeout(timeout);reject(new Error(event.message))};worker.postMessage(job)})
      const elapsed=performance.now()-started
      if(reply.type!=='result'||reply.inputBindingHash!==job.inputBindingHash)throw new Error('Native matrix response binding')
      for(const side of ['left','right'] as const){let cursor=0,text='';const raw=job[side+'Raw'];for(const op of reply.result.ops){const [start,end]=op[side];if(start!==cursor)throw new Error('Native matrix coverage');text+=raw.slice(start,end);cursor=end;if(op.kind==='equal'&&job.leftRaw.slice(...op.left)!==job.rightRaw.slice(...op.right))throw new Error('Native matrix false equal')}if(cursor!==raw.length||text!==raw)throw new Error('Native matrix reconstruction')}
      return{elapsed,work:reply.result.work,coarseReasons:reply.result.coarseReasons,ops:reply.result.ops.length,rows:reply.result.rows.length}
    }
    try{
      for(const size of [10000,50000])for(const [name,leftRaw,rightRaw]of cases(size))for(const phase of ['cold','warm']){
        const samples:any[]=[],diffOnlySamples:any[]=[];let warm:Worker|undefined,core:Worker|undefined
        try{if(phase==='warm'){warm=new Worker(original.url,{type:'module'});await run(warm,await makeJob(leftRaw,rightRaw))}
          if(coreURL)core=new Worker(coreURL,{type:'module'})
          for(let sample=0;sample<5;sample++){const job=await makeJob(leftRaw,rightRaw),started=performance.now(),worker=warm??new Worker(original.url,{type:'module'});try{samples.push(await run(worker,job,started))}finally{if(!warm)worker.terminate()}
            if(core){const measurement=await new Promise<any>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Native pure kernel timeout')),1200);core!.onmessage=event=>{clearTimeout(timeout);if(event.data.error)reject(new Error(event.data.error));else resolve(event.data)};core!.onerror=event=>{clearTimeout(timeout);reject(new Error(event.message))};core!.postMessage({left:leftRaw,right:rightRaw,budget:job.budget,segmentation:job.profile})});diffOnlySamples.push(measurement)}
          }
        }catch(error){throw new Error(JSON.stringify({stage:'native-worker-matrix',size,name,phase,leftUnits:leftRaw.length,rightUnits:rightRaw.length,samples,diffOnlySamples,priorRecords:records,error:String(error)}))}finally{warm?.terminate();core?.terminate()}
        const times=samples.map(item=>item.elapsed).sort((a,b)=>a-b)
        const diffTimes=diffOnlySamples.map(item=>item.elapsed).sort((a,b)=>a-b)
        records.push({size,name,phase,leftUnits:leftRaw.length,rightUnits:rightRaw.length,leftCodePoints:[...leftRaw].length,rightCodePoints:[...rightRaw].length,p50:times[2],p95:times[4],samples,diffOnlySamples,diffOnlyP50:diffTimes[2],diffOnlyP95:diffTimes[4]})
      }
      // Terminate a posted large job immediately, then require a new Worker to
      // return only the fresh binding. No mock scheduling or result injection.
      const cancelled=await makeJob('甲'.repeat(50000),'乙'.repeat(50000)),old=new Worker(original.url,{type:'module'})
      let late=0;old.onmessage=()=>late++;old.postMessage(cancelled);const cancelStart=performance.now();old.terminate();const cancellationMs=performance.now()-cancelStart
      const fresh=new Worker(original.url,{type:'module'});let freshResult
      try{freshResult=await run(fresh,await makeJob('新任务','新任务八'))}finally{fresh.terminate()}
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
      return{records,cancellationMs,late,freshResult,longTasks,hardwareConcurrency:navigator.hardwareConcurrency,userAgent:navigator.userAgent,coldDefinition:'new actual B Worker each sample; includes constructor/startup/message transfer/protocol hashes/core/result delivery; excludes page/build/job-input preparation',warmDefinition:'one prewarmed actual B Worker per case; same end-to-end interval',diffOnlyDefinition:measureCore?'dev-only real browser Worker importing exact unchanged A kernel; timer surrounds kernel only; excludes startup/message/protocol hashing':'not measured from the optimized production bundle'}
    }finally{observer.disconnect();if(coreURL)URL.revokeObjectURL(coreURL)}
  },measureCore)
}

test('054 actual candidate review: exact middle insertions, native editor, 14 themes and original confirmed adoption',async({browser,baseURL},info)=>{
  const perfMode=process.env.STORYFORGE_DIFF_PERF??''
  test.setTimeout(perfMode?300000:120000)
  if(!baseURL||new URL(baseURL).hostname!=='127.0.0.1')throw new Error('054 requires its own loopback test window')
  const origin=new URL(baseURL).origin,production=process.env.PLAYWRIGHT_PRODUCTION_PREVIEW==='1'
  const statePath=process.env.STORYFORGE_DIFF_NATIVE_STATE
  if(production&&!statePath)throw new Error('Production review requires the isolated pre-adoption state exported by this same dev test')
  const state=statePath?JSON.parse(readFileSync(statePath,'utf8')):undefined
  if(state)for(const item of state.origins)item.origin=origin
  const context=await browser.newContext({baseURL,viewport:{width:1366,height:1000},storageState:state??{cookies:[],origins:[]},serviceWorkers:'block',permissions:['clipboard-read','clipboard-write']})
  const failWorkerOnce=process.env.STORYFORGE_DIFF_FAIL_WORKER==='once'
  if(failWorkerOnce&&perfMode)throw new Error('Keep deliberate Worker recovery separate from performance attribution')
  let forbidden=0,models=0,intentionalWorkerAborts=0;const errors:string[]=[],workers:string[]=[],blockedRequests:Array<{url:string;method:string;resourceType:string;reason:string}>=[]
  try{
    await context.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url())
      const record=(reason:string)=>blockedRequests.push({url:url.origin+url.pathname,method:request.method(),resourceType:request.resourceType(),reason})
      if(failWorkerOnce&&!intentionalWorkerAborts&&url.pathname.includes('worldview-diff.worker')&&(production||url.searchParams.has('worker_file'))){intentionalWorkerAborts++;record('intentional-first-worker-resource-failure');return route.abort()}
      if(/\/chat\/completions|\/(?:responses|requests|messages)(?:\/|$)|:(?:streamGenerateContent|generateContent)/.test(url.pathname)){models++;record('model-attempt');return route.abort()}
      if(url.origin!==origin||!['GET','HEAD'].includes(request.method())){forbidden++;record('outside-isolated-assets');return route.abort()}
      return route.continue()
    })
    await context.addInitScript(()=>localStorage.setItem('storyforge_guide_completed','054-isolated-native'))
    const page=await context.newPage();await observeNativeDiffWorkers(page);page.on('pageerror',error=>errors.push(error.message));page.on('worker',worker=>workers.push(worker.url()))
    await page.goto('./')
    await attachJSON(info,'054-target-runtime.json',{node:process.version,platform:process.platform,arch:process.arch,cpuModel:cpus()[0]?.model,cpuCount:cpus().length,memoryGiB:totalmem()/1024**3,browserVersion:browser.version(),browser:await page.evaluate(()=>({userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,dpr:devicePixelRatio,visualScale:visualViewport?.scale??null,visibility:document.visibilityState,bodyZoom:getComputedStyle(document.body).zoom,rootZoom:getComputedStyle(document.documentElement).zoom})),qualification:'Playwright isolated Chromium/Desktop Chrome profile; browser UA is recorded separately from host OS. No original Chrome/profile or API preset used.'})
    const ids=production?await page.evaluate(()=>JSON.parse(localStorage.getItem('054-isolated-fixture')!)):await page.evaluate(async({left,right})=>{
      const load=new Function('path','return import(path)') as <T>(path:string)=>Promise<T>
      const [{db},{seedCurrentWorkspace},{getOrCreateAgentConversation},{useWorldviewStore},{currentWorldOriginCandidateFixtureV1},{runDurableMasterAgentPlanV1},{AgentTeamBudgetTracker},{prepareRequiredMasterGatewayFixtureV1}]=await Promise.all([
        load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),load<typeof import('../helpers/current-workspace')>('/storyforge/tests/helpers/current-workspace.ts'),
        load<typeof import('../../src/lib/agent/conversations')>('/storyforge/src/lib/agent/conversations.ts'),load<typeof import('../../src/stores/worldview')>('/storyforge/src/stores/worldview.ts'),
        load<typeof import('../helpers/current-worldview-field')>('/storyforge/tests/helpers/current-worldview-field.ts'),load<typeof import('../../src/lib/agent/run/master-durable')>('/storyforge/src/lib/agent/run/master-durable.ts'),
        load<typeof import('../../src/lib/agent/team-budget')>('/storyforge/src/lib/agent/team-budget.ts'),load<typeof import('../helpers/master-agent-gateway')>('/storyforge/tests/helpers/master-agent-gateway.ts')])
      if(await db.projects.count())throw new Error('Expected empty isolated author storage')
      const workspace=await seedCurrentWorkspace('054 精确候选对照隔离长篇'),scope=workspace.scope
      await useWorldviewStore.getState().loadAll(scope)
      await useWorldviewStore.getState().saveWorldview({projectId:scope.projectId,worldOrigin:left},scope)
      const row=await db.worldviews.where('projectId').equals(scope.projectId).first()
      if(!row?.id)throw new Error('Expected actual original World owner record')
      const conversation=await getOrCreateAgentConversation({projectId:scope.projectId,worldGroupId:null,purpose:'master-authoring',scope})
      const current=currentWorldOriginCandidateFixtureV1(right,{id:row.id,ragDocumentId:row.ragDocumentId,updatedAt:row.updatedAt,worldOrigin:row.worldOrigin})
      const task={id:'054-native-field',agentId:'world-origin' as const,skillId:'world-origin.worldview-field' as const,instruction:'只使用固定合成候选，不调用模型。',dependsOn:[]}
      const result=await runDurableMasterAgentPlanV1({scope,worldGroupId:null,conversationId:conversation.id,budget:new AgentTeamBudgetTracker('balanced'),plan:{summary:task.instruction,tasks:[task],workflow:{version:1,workflowId:'single-domain-direct',reasonCodes:['single-explicit-domain']}}},{execute:async options=>{
        const trace=options.executionTrace,budget=options.budget
        if(!trace?.taskStarted||!trace.candidateReady||!budget)throw new Error('Missing actual durable trace or team budget')
        await trace.taskStarted(task)
        const reservation=budget.reserveCall({label:task.id,messages:[{role:'user',content:task.instruction}],maxOutputTokens:200})
        budget.settleCall(reservation,current.draft)
        const gateway=await prepareRequiredMasterGatewayFixtureV1({scope,worldGroupId:null,executionTrace:trace},task,current.draft)
        const candidate={payload:{...current.payload,version:1 as const,taskId:task.id,agentId:task.agentId,skillId:task.skillId,label:'世界来源候选',contextSources:gateway.contextSources,contextEvidence:gateway.contextEvidence,workspaceScope:scope,dependsOnTaskIds:[],teamBudgetEvidence:budget.snapshot()},draft:current.draft,runtimeNode:{} as any,runtimeOutput:current.runtimeOutput,contextGatewayRuntime:gateway.contextGatewayRuntime}
        await trace.candidateReady(task,candidate);return[candidate]
      }})
      const saved=result.candidates[0],viewIdentity={projectId:scope.projectId,worldId:scope.worldId,workId:scope.workId,worldGroupId:null,field:saved.payload.worldviewField,eventId:saved.event.id,conversationId:saved.event.conversationId,taskId:saved.payload.taskId,runId:saved.payload.runId,runStepId:saved.payload.runStepId,runGeneration:saved.payload.runGeneration,skillId:saved.payload.skillId}
      const value={scope,databaseName:db.name,eventId:saved.event.id,runId:result.runId,worldviewId:row.id,worldviewBefore:JSON.stringify(await db.worldviews.get(row.id)),candidateBefore:saved.event.content,viewIdentity}
      localStorage.setItem('054-isolated-fixture',JSON.stringify(value));return value
    },{left,right})
    await page.goto(`./workspace/${ids.scope.projectId}?module=worldview-origin&originField=origin`)
    // Bind the one real review body to the fixture's actual durable candidate.
    // Its immediate owner is the action section; ancestor sections are excluded.
    const reviewBody=page.locator('.worldview-review-v2[data-review-session]')
    await expect(reviewBody).toHaveCount(1)
    await expect.poll(async()=>JSON.parse((await reviewBody.getAttribute('data-review-session'))??'null')).toEqual(ids.viewIdentity)
    const review=reviewBody.locator('..')
    await expect(review).toHaveCount(1);expect(await review.evaluate(element=>element.tagName)).toBe('SECTION')
    await expect(review.getByRole('heading',{name:'待确认 · 世界来源候选',exact:true})).toHaveCount(1)
    const diff=review.getByRole('region',{name:'原文与候选精确对照'})
    await expect(diff).toBeVisible();await expect(diff.locator('.wv-diff-row-added')).toHaveCount(3)
    await expect(diff.locator('.wv-diff-row-added .wv-diff-left .wv-diff-padding')).toHaveCount(3)
    if(failWorkerOnce){expect(intentionalWorkerAborts).toBe(1);await expect(diff.getByRole('status')).toContainText(['后台对照不可用'])}
    else expect(workers.some(url=>url.includes('worldview-diff'))).toBe(true)
    if(['1','matrix'].includes(perfMode)){
      const performanceMatrix=await nativeWorkerMatrix(page,!production).catch(async error=>{await attachJSON(info,'054-native-worker-performance-failure.json',error instanceof Error?error.message:String(error));throw error})
      await attachJSON(info,'054-native-worker-performance.json',performanceMatrix)
      for(const record of performanceMatrix.records)expect(record.p95,`${record.size} ${record.name} ${record.phase}`).toBeLessThanOrEqual(record.size===10000?150:750)
      expect(performanceMatrix.cancellationMs).toBeLessThanOrEqual(100);expect(performanceMatrix.late).toBe(0)
      expect(performanceMatrix.longTasks.filter(entry=>entry.duration>50)).toEqual([])
    }
    const unchanged=await diff.locator('.wv-diff-row-unchanged').count();expect(unchanged).toBeGreaterThanOrEqual(2)
    // Preserve the real run/candidate before exercising the unchanged old adoption chain.
    if(!production)await context.storageState({path:info.outputPath('054-pre-adoption-state.json'),indexedDB:true})
    const initialMatrices:unknown[]=[]
    for(const theme of themes){
      await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;window.dispatchEvent(new Event('themechange'))},theme)
      const matrix=await diff.evaluate(readDiffContrast)
      for(const pair of matrix)expect(pair.ratio,`${theme} initial ${pair.kind}`).toBeGreaterThanOrEqual(4.5)
      initialMatrices.push({theme,matrix})
      if(['storyforge','paper-ink','cosmic-glass','ember'].includes(theme))for(const width of [390,1366,1728]){
        await page.setViewportSize({width,height:1000});await diff.scrollIntoViewIfNeeded()
        await diff.screenshot({path:info.outputPath(`054-initial-${production?'production':'dev'}-${theme}-${width}.png`),animations:'disabled'})
      }
    }
    await attachJSON(info,'054-initial-three-quotes-theme-matrix.json',initialMatrices)
    await page.setViewportSize({width:1366,height:1000});await page.evaluate(()=>{document.documentElement.dataset.theme='storyforge';window.dispatchEvent(new Event('themechange'))})
    for(let index=0;index<3;index++){
      await diff.getByRole('button',{name:'下一处',exact:true}).click()
      const quote=diff.locator('.wv-diff-row-added').nth(index);await expect(quote).toBeFocused()
      for(const width of [1366,390]){await page.setViewportSize({width,height:1000});await quote.scrollIntoViewIfNeeded();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await diff.screenshot({path:info.outputPath(`054-initial-quote-${production?'production':'dev'}-${width}-${index+1}.png`),animations:'disabled'})}
      await page.setViewportSize({width:1366,height:1000})
    }
    await diff.getByRole('button',{name:'上一处',exact:true}).click();await expect(diff.locator('.wv-diff-row-added').nth(1)).toBeFocused()
    await diff.getByRole('checkbox',{name:'只看变化',exact:true}).check()
    const folded=diff.getByRole('button',{name:/^展开 \d+ 行未改内容$/});expect(await folded.count()).toBeGreaterThan(0)
    await folded.first().click();await expect(diff.locator('.wv-diff-row-unchanged').first()).toBeVisible()
    await diff.getByRole('checkbox',{name:'只看变化',exact:true}).uncheck()
    const readNative = () => page.evaluate(async ids => {
      if (!(await indexedDB.databases()).some(item => item.name === ids.databaseName)) throw new Error('Missing isolated fixture database')
      const database = await new Promise<IDBDatabase>((resolve, reject) => { const request=indexedDB.open(ids.databaseName);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error) })
      try {
        const tx=database.transaction(['worldviews','agentEvents','agentRuns'],'readonly')
        const get=(store:string,id:number)=>new Promise<any>((resolve,reject)=>{const request=tx.objectStore(store).get(id);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})
        const [world,candidate,run]=await Promise.all([get('worldviews',ids.worldviewId),get('agentEvents',ids.eventId),get('agentRuns',ids.runId)])
        return {world:JSON.stringify(world),value:world?.worldOrigin,candidate:candidate?.content,candidatePayload:candidate?.payload,run:run?.status,runEvidence:{id:run?.id,projectId:run?.projectId,workId:run?.workId,conversationId:run?.conversationId,worldGroupId:run?.worldGroupId,generation:run?.generation,contractHash:run?.contractHash,terminalReceiptHash:run?.terminalReceiptHash,status:run?.status}}
      } finally { database.close() }
    },ids)
    const before=await readNative()
    expect(before.world).toBe(ids.worldviewBefore)
    expect(before.candidate).toBe(ids.candidateBefore)
    const firstRight=diff.locator('.wv-diff-right [data-raw-start]').first()
    const expectedPartial=await firstRight.evaluate((node,raw)=>raw.slice(Number((node as HTMLElement).dataset.rawStart),Number((node as HTMLElement).dataset.rawEnd)),right)
    await firstRight.click();await firstRight.evaluate(node=>{const range=document.createRange();range.selectNodeContents(node);const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range)})
    await page.keyboard.press('ControlOrMeta+C');expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(expectedPartial)
    await page.evaluate(()=>navigator.clipboard.writeText('054-cross-column-blocked'))
    await diff.locator('.wv-diff-left [data-raw-start]').first().click()
    await diff.evaluate(element=>{const left=element.querySelector('.wv-diff-left [data-raw-start]')?.firstChild,right=element.querySelector('.wv-diff-right [data-raw-start]')?.firstChild;if(!left||!right)throw new Error('Missing real two-column text nodes');const range=document.createRange();range.setStart(left,0);range.setEnd(right,right.textContent?.length??0);const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range)})
    await page.keyboard.press('ControlOrMeta+C');expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('054-cross-column-blocked')
    await page.evaluate(()=>window.getSelection()?.removeAllRanges())
    const area=review.getByRole('textbox',{name:/候选内容$/,includeHidden:true})
    const handle=await area.elementHandle();await review.getByRole('button',{name:'编辑候选',exact:true}).click()
    await expect(area).toHaveValue(right.replace(/\r\n?/g,'\n'))
    await area.evaluate(element=>{const input=element as HTMLTextAreaElement;input.focus();input.setSelectionRange(3,8,'backward')})
    await review.getByRole('button',{name:'对比',exact:true}).click();await expect(diff.locator('.wv-diff-row').first()).toBeVisible()
    if(failWorkerOnce){expect(intentionalWorkerAborts).toBe(1);await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'__054NativeWorkers').replies.filter((reply:{type:string})=>reply.type==='result').length)).toBeGreaterThan(0);await expect(diff.getByRole('status').filter({hasText:'后台对照不可用'})).toHaveCount(0)}
    await review.getByRole('button',{name:'编辑候选',exact:true}).click()
    expect(await area.evaluate((element,old)=>element===old,handle)).toBe(true)
    await expect.poll(()=>area.evaluate(element=>{const input=element as HTMLTextAreaElement;return{start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection}})).toEqual({start:3,end:8,direction:'backward'})
    const afterModes=await readNative()
    expect(afterModes.candidate).toBe(ids.candidateBefore);expect(afterModes.candidatePayload).toBe(before.candidatePayload)
    expect(afterModes.world).toBe(ids.worldviewBefore)
    // A real author edit goes through the existing queue, leaving Canon untouched.
    const edited=right.replace('七次','八次').replace(/\r\n?/g,'\n')
    await area.fill(edited);await expect(review.getByRole('button',{name:'采纳',exact:true})).toBeEnabled()
    // Chromium's actual IME protocol emits the browser composition events; no
    // hand-written change event stands in for its final onChange tail.
    const ime=await context.newCDPSession(page)
    await area.evaluate(element=>{
      const input=element as HTMLTextAreaElement,events:unknown[]=[],controller=new AbortController();Reflect.set(window,'__054ImeEvents',events);Reflect.set(window,'__054ImeObserver',controller)
      for(const name of ['compositionstart','compositionupdate','compositionend','beforeinput','input'])window.addEventListener(name,event=>{if(event.target===input)events.push({type:name+'-window-capture',value:input.value,readOnly:input.readOnly,disabled:input.disabled,defaultPrevented:event.defaultPrevented,focused:document.activeElement===input,at:performance.now()})},{capture:true,signal:controller.signal})
      for(const name of ['compositionstart','compositionupdate','compositionend','beforeinput','input','change'])for(const capture of [true,false])input.addEventListener(name,event=>{
        const detail=event as InputEvent&CompositionEvent
        events.push({type:name,capture,data:detail.data,inputType:detail.inputType,isComposing:detail.isComposing,isTrusted:event.isTrusted,value:input.value,readOnly:input.readOnly,disabled:input.disabled,selection:[input.selectionStart,input.selectionEnd],at:performance.now()})
        if(!capture)queueMicrotask(()=>events.push({type:name+'-after-microtask',value:input.value,connected:input.isConnected,invalid:input.getAttribute('aria-invalid'),at:performance.now()}))
      },{capture,signal:controller.signal})
    })
    try{
      await area.focus();await area.evaluate(element=>{const input=element as HTMLTextAreaElement;input.setSelectionRange(input.value.length,input.value.length)})
      await ime.send('Input.imeSetComposition',{text:'叙事',selectionStart:2,selectionEnd:2})
      await expect(review.getByRole('button',{name:'对比',exact:true})).toBeDisabled();await expect(review.getByRole('button',{name:'采纳',exact:true})).toBeDisabled()
      await ime.send('Input.insertText',{text:'叙事熔炉'})
      await expect(area).toHaveValue(edited+'叙事熔炉');await expect(review.getByRole('button',{name:'对比',exact:true})).toBeEnabled()
      await expect(review.getByRole('button',{name:'采纳',exact:true})).toBeEnabled();expect(await area.evaluate((element,old)=>element===old,handle)).toBe(true)
      await area.fill(edited);await expect(review.getByRole('button',{name:'采纳',exact:true})).toBeEnabled()
    }finally{await attachJSON(info,'054-native-ime-events.json',await page.evaluate(()=>Reflect.get(window,'__054ImeEvents')));await page.evaluate(()=>Reflect.get(window,'__054ImeObserver')?.abort());await ime.detach()}
    await review.getByRole('button',{name:'对比',exact:true}).click();await expect(diff.locator('[data-diff-kind="remove"]')).toContainText(['七'])
    if(['control','control-react'].includes(perfMode)){
      const controls:unknown[]=[]
      await review.getByRole('button',{name:'编辑候选',exact:true}).click()
      const style=await area.evaluate(element=>{const css=getComputedStyle(element);return{fontFamily:css.fontFamily,fontSize:css.fontSize,lineHeight:css.lineHeight,width:element.getBoundingClientRect().width}})
      expect(style.width).toBeGreaterThan(200)
      await review.getByRole('button',{name:'对比',exact:true}).click()
      for(const sample of perfMode==='control-react'?[]:[{size:10000,spellcheck:true,kind:'CJK'},{size:10000,spellcheck:false,kind:'CJK'},{size:10000,spellcheck:false,kind:'Latin'},{size:50000,spellcheck:false,kind:'CJK'}]){
        const text=(sample.kind==='CJK'?'星海约定与退潮后的来信。\n':'An ordinary sentence.\n').repeat(sample.size).slice(0,sample.size)
        await page.evaluate(({style,spellcheck})=>{const input=document.createElement('textarea');input.dataset.nativeFillControl='054';input.spellcheck=spellcheck;Object.assign(input.style,{...style,width:`${style.width}px`,height:'224px',position:'fixed',left:'4px',top:'4px',zIndex:'2147483000'});document.body.append(input);const tasks:Array<{start:number;duration:number}>=[],observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())tasks.push({start:entry.startTime,duration:entry.duration})});observer.observe({type:'longtask',buffered:false});Reflect.set(window,'__054PlainFill',{tasks,observer,started:performance.now()})},{style,spellcheck:sample.spellcheck})
        const control=page.locator('textarea[data-native-fill-control="054"]');await control.fill(text);await expect(control).toHaveValue(text)
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
        const measured=await control.evaluate(element=>{const measurement=Reflect.get(window,'__054PlainFill');measurement.observer.disconnect();const result={elapsed:performance.now()-measurement.started,longTasks:measurement.tasks,actualUnits:(element as HTMLTextAreaElement).value.length};element.remove();return result})
        controls.push({...sample,style,...measured});await attachJSON(info,'054-native-plain-textarea-fill-control.json',controls)
      }
      if(production)throw new Error('The shared CTextarea attribution control requires the isolated dev module graph')
      for(const size of [10000,50000]){
        await page.evaluate(async style=>{
          const load=new Function('path','return import(path)') as <T>(path:string)=>Promise<T>
          const [react,dom,{CTextarea},layout]=await Promise.all([load<{default:typeof import('react')}>('/storyforge/node_modules/.vite/deps/react.js'),load<{default:typeof import('react-dom/client')}>('/storyforge/node_modules/.vite/deps/react-dom_client.js'),load<typeof import('../../src/components/shared/CompositionInput')>('/storyforge/src/components/shared/CompositionInput.tsx'),load<typeof import('../../src/lib/input-area-layout')>('/storyforge/src/lib/input-area-layout.ts')])
          const host=document.createElement('div');host.dataset.nativeReactControl='054';host.className='worldview-review-v2';Object.assign(host.style,{width:`${style.width+24}px`,position:'fixed',left:'4px',top:'4px',zIndex:'2147483000'});document.body.append(host)
          function Controlled(){const [value,setValue]=react.default.useState('');return react.default.createElement(CTextarea,{value,onChange:event=>setValue(event.target.value),'aria-label':'054 controlled CTextarea baseline',inputAreaLayout:layout.inputAreaLayoutV1(true,layout.worldviewInputAreaFieldV1('worldOrigin'),'candidate'),style:{fontFamily:style.fontFamily,fontSize:style.fontSize,lineHeight:style.lineHeight,height:'224px'}})}
          const root=dom.default.createRoot(host);Reflect.set(window,'__054ControlRoot',root);root.render(react.default.createElement(Controlled))
        },style)
        const control=page.getByRole('textbox',{name:'054 controlled CTextarea baseline',exact:true});await expect(control).toBeVisible()
        const actualWidth=await control.evaluate(element=>element.getBoundingClientRect().width);expect(Math.abs(actualWidth-style.width)).toBeLessThanOrEqual(1)
        await page.evaluate(()=>{const tasks:Array<{start:number;duration:number}>=[],observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())tasks.push({start:entry.startTime,duration:entry.duration})});observer.observe({type:'longtask',buffered:false});Reflect.set(window,'__054PlainFill',{tasks,observer,started:performance.now()})})
        const text='星海约定与退潮后的来信。\n'.repeat(size).slice(0,size);await control.fill(text);await expect(control).toHaveValue(text)
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
        const measured=await control.evaluate(element=>{const measurement=Reflect.get(window,'__054PlainFill');measurement.observer.disconnect();return{elapsed:performance.now()-measurement.started,longTasks:measurement.tasks,actualUnits:(element as HTMLTextAreaElement).value.length}})
        controls.push({size,kind:'existing-CTextarea-controlled-local-state',style,actualWidth,...measured});await attachJSON(info,'054-native-plain-textarea-fill-control.json',controls)
        await page.evaluate(()=>{Reflect.get(window,'__054ControlRoot').unmount();document.querySelector('[data-native-react-control="054"]')?.remove()})
      }
      await attachJSON(info,'054-native-plain-textarea-fill-control.json',controls)
    }
    if(['matched-input','matched-input-passive'].includes(perfMode)){
      if(production)throw new Error('Matched control requires the isolated dev module graph')
      const quoteRows=diff.locator('.wv-diff-row-added').filter({hasText:/因果约束|势力关联|剧情伏笔/})
      await expect(quoteRows).toHaveCount(3);await expect(quoteRows.locator('.wv-diff-left .wv-diff-padding')).toHaveCount(3)
      const sentence=await diff.locator('.wv-diff-left [data-diff-kind="remove"]').filter({hasText:/^七$/}).evaluate(node=>node.closest('.wv-diff-row')?.textContent)
      expect(sentence).toContain('原有议席每七次退潮轮换。');expect(sentence).toContain('原有议席每八次退潮轮换。')
      const navigationFrames:unknown[]=[]
      for(const width of [1366,390]){
        await page.setViewportSize({width,height:1000})
        const text=await diff.locator('.wv-diff-toolbar > span').first().textContent(),count=Number(text?.match(/^\d+/)?.[0]);expect(count).toBeGreaterThanOrEqual(3);expect(count).toBeLessThan(30)
        const visited=new Set<string>()
        for(let index=0;index<count;index++){
          await diff.getByRole('button',{name:'下一处',exact:true}).click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
          const frame=await diff.evaluate(element=>{const row=document.activeElement?.closest<HTMLElement>('.wv-diff-row'),a=row?.querySelector<HTMLElement>('.wv-diff-left'),b=row?.querySelector<HTMLElement>('.wv-diff-right');return{selected:(element as HTMLElement).dataset.currentChange,row:row?.dataset.diffRow,kind:row?.className,left:a?{start:Number(a.dataset.cellStart),end:Number(a.dataset.cellEnd),padding:!!a.querySelector('.wv-diff-padding')}:null,right:b?{start:Number(b.dataset.cellStart),end:Number(b.dataset.cellEnd),text:[...b.querySelectorAll('[data-raw-start]')].map(node=>node.textContent).join('')}:null}})
          navigationFrames.push({width,index,...frame})
          if(frame.kind?.includes('wv-diff-row-added')&&/因果约束|势力关联|剧情伏笔/.test(frame.right?.text??'')){expect(Number.isSafeInteger(frame.left?.start)).toBe(true);expect(frame.left?.start).toBeGreaterThanOrEqual(0);expect(frame.left?.end).toBeLessThanOrEqual(left.length);expect(frame.left?.start).toBe(frame.left?.end);expect(frame.left?.padding).toBe(true);visited.add(frame.row!);await diff.screenshot({path:info.outputPath(`054-current-quote-${width}-${visited.size}.png`),animations:'disabled'})}
        }
        expect(visited.size).toBe(3)
      }
      await attachJSON(info,'054-current-projection-navigation.json',navigationFrames)
      for(const theme of ['storyforge','paper-ink','cosmic-glass','ember'])for(const width of [390,1366,1728]){await page.setViewportSize({width,height:1000});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;window.dispatchEvent(new Event('themechange'))},theme);await diff.locator('[data-diff-scroller]').evaluate(element=>element.scrollTop=0);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await diff.screenshot({path:info.outputPath(`054-current-${theme}-${width}.png`),animations:'disabled'})}
      await page.setViewportSize({width:1366,height:1000});await page.evaluate(()=>{document.documentElement.dataset.theme='storyforge';window.dispatchEvent(new Event('themechange'))})
      type InputRecord=Awaited<ReturnType<typeof measureInputPair>>
      const pairs:Array<{size:number;controlBulk:InputRecord;reviewBulk:InputRecord;controlHot:InputRecord;reviewHot:InputRecord;display:unknown}>=[]
      try{for(const size of [10000,50000]){
        const phrase='星海约定与退潮后的来信。\n',text=phrase.repeat(Math.ceil(size/phrase.length)).slice(0,size)
        await review.getByRole('button',{name:'编辑候选',exact:true}).click()
        if(await area.inputValue()!==edited)await area.fill(edited)
        await expect(review.getByRole('button',{name:'采纳',exact:true})).toBeEnabled();await area.scrollIntoViewIfNeeded();await area.focus()
        await area.evaluate(element=>{const input=element as HTMLTextAreaElement;input.setSelectionRange(input.value.length,input.value.length)})
        const reference=await area.evaluate(readTextareaGeometry)
        const ack=async()=>{if(size===10000)await expect(review.getByRole('button',{name:'采纳',exact:true})).toBeEnabled();else await expect(area).toHaveAttribute('aria-invalid','true')}
        const reviewBulk=await measureInputPair(page,area,edited,text,info,`review-bulk-${size}`,ack,'bulk')
        const measureControl=async(reference:ReturnType<typeof readTextareaGeometry>,initial:string,step:'bulk'|'small')=>{const control=await mountMatchingControl(page,reference,initial);try{return await measureInputPair(page,control,initial,text,info,`control-${step}-${size}`,async()=>{},step)}finally{await page.evaluate(()=>{Reflect.get(window,'__054ControlRoot').unmount();document.querySelector('[data-native-react-control="054"]')?.remove()})}}
        const controlBulk=await measureControl(reference,edited,'bulk')
        await area.evaluate(element=>{const input=element as HTMLTextAreaElement;input.focus({preventScroll:true});input.setSelectionRange(input.value.length,input.value.length)})
        const hotReference=await area.evaluate(readTextareaGeometry),controlHot=await measureControl(hotReference,text,'small')
        const reviewHot=await measureInputPair(page,area,text,text,info,`review-small-${size}`,ack,'small')
        for(const [controlResult,reviewResult]of [[controlBulk,reviewBulk],[controlHot,reviewHot]]){
          expect(controlResult.initialHash).toBe(reviewResult.initialHash);expect(controlResult.bulkHash).toBe(reviewResult.bulkHash);expect(controlResult.smallHash).toBe(reviewResult.smallHash);expect(controlResult.actualInitialHash).toBe(reviewResult.actualInitialHash);expect(controlResult.actualFinalHash).toBe(reviewResult.actualFinalHash);expect(controlResult.actualInitialHash).toBe(controlResult.initialHash);expect(controlResult.actualFinalHash).toBe(controlResult.smallExecuted?controlResult.smallHash:controlResult.bulkHash);expect(controlResult.before.selection).toEqual(reviewResult.before.selection)
          expect(controlResult.before.css).toEqual(reviewResult.before.css);expect(controlResult.before.clientWidth).toBe(reviewResult.before.clientWidth);expect(controlResult.before.clientHeight).toBe(reviewResult.before.clientHeight);expect(controlResult.before.scrollTop).toBe(reviewResult.before.scrollTop);expect(controlResult.before.scrollLeft).toBe(reviewResult.before.scrollLeft)
          for(const dimension of ['x','y','width','height'] as const)expect(Math.abs(controlResult.before.bbox[dimension]-reviewResult.before.bbox[dimension])).toBeLessThanOrEqual(1)
        }
        const pair={size,controlBulk,reviewBulk,controlHot,reviewHot,display:null as unknown}
        pairs.push(pair);await attachJSON(info,'054-matched-input-and-display-diagnostic.json',pairs)
        await review.evaluate(element=>{
          const tasks:Array<{start:number;duration:number}>=[],marks:Record<string,number>={compareRequested:performance.now()}
          const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())tasks.push({start:entry.startTime,duration:entry.duration})});observer.observe({type:'longtask',buffered:false})
          const mutations=new MutationObserver(()=>{if(!marks.domMounted&&element.querySelector('.wv-diff-row')){marks.domMounted=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>marks.paint=performance.now()))}});mutations.observe(element,{subtree:true,childList:true})
          Reflect.set(window,'__054DiffPaint',{tasks,marks,observer,mutations})
        })
        await review.getByRole('button',{name:'对比',exact:true}).click();await expect(diff.locator('.wv-diff-row').first()).toBeVisible()
        await page.waitForFunction(()=>Reflect.get(window,'__054DiffPaint').marks.paint)
        const coverage=await diff.evaluate(element=>{
          const observations=Reflect.get(window,'__054NativeWorkers'),job=observations.jobs[observations.jobs.length-1]?.job
          if(!job)throw new Error('Missing actual display job')
          const sides=(['left','right'] as const).map(side=>{const raw=job[side+'Raw'] as string,nodes=[...element.querySelectorAll<HTMLElement>(`[data-diff-side="${side}"] [data-raw-start]`)];let cursor=0,exact=true;const intervals=nodes.map(node=>{const start=Number(node.dataset.rawStart),end=Number(node.dataset.rawEnd);if(start!==cursor||node.textContent!==raw.slice(start,end).replace(/\r\n?/g,'\n'))exact=false;cursor=end;return{start,end,domUnits:node.textContent?.length??0}});return{side,rawUnits:raw.length,mountedUnits:cursor,complete:exact&&cursor===raw.length,intervals}})
          const viewport=element.querySelector<HTMLElement>('[data-diff-scroller]')!,box=viewport.getBoundingClientRect()
          return{job:{inputBindingHash:job.inputBindingHash,identityKey:job.identityKey,baselineHash:job.baselineHash,leftHash:job.leftHash,rightHash:job.rightHash,rightRevision:job.rightRevision,leftRawUnits:job.leftRaw.length,rightRawUnits:job.rightRaw.length,sourceKind:job.sourceKind},reply:[...observations.replies].reverse().find((reply:{inputBindingHash:string})=>reply.inputBindingHash===job.inputBindingHash),sides,rows:element.querySelectorAll('.wv-diff-row').length,folds:element.querySelectorAll('.wv-diff-fold').length,domElements:element.querySelectorAll('*').length,status:[...element.querySelectorAll('[role="status"]')].map(node=>node.textContent),viewport:{x:box.x,y:box.y,width:box.width,height:box.height,clientHeight:viewport.clientHeight,scrollHeight:viewport.scrollHeight,scrollTop:viewport.scrollTop}}
        })
        expect(coverage.job.leftRawUnits).toBe(left.length);expect(coverage.job.leftHash).toBe(rawHash(left));expect(coverage.job.rightRawUnits).toBe(size+1);expect(coverage.job.rightHash).toBe(rawHash(text+'新'));for(const side of coverage.sides)expect(side.complete,`${size} mounted ${side.side}`).toBe(true)
        await diff.locator('[data-diff-scroller]').evaluate(element=>element.scrollTop=element.scrollHeight)
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
        const bottom=await diff.evaluate(element=>{const viewport=element.querySelector<HTMLElement>('[data-diff-scroller]')!,box=viewport.getBoundingClientRect(),spans=element.querySelectorAll<HTMLElement>('[data-diff-side="right"] [data-raw-start]'),last=spans[spans.length-1],node=last?.firstChild;if(!node)throw new Error('Missing final actual source node');const range=document.createRange(),length=node.textContent?.length??0;range.setStart(node,Math.max(0,length-1));range.setEnd(node,length);const rect=range.getBoundingClientRect();return{lastRawEnd:Number(last.dataset.rawEnd),lastGlyph:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},viewport:{top:box.top,bottom:box.bottom},scrollTop:viewport.scrollTop,scrollHeight:viewport.scrollHeight,clientHeight:viewport.clientHeight,visible:rect.height>0&&rect.top<box.bottom&&rect.bottom>box.top}})
        expect(bottom.lastRawEnd).toBe(size+1);expect(bottom.visible).toBe(true)
        await diff.screenshot({path:info.outputPath(`054-display-bottom-${size}.png`),animations:'disabled'})
        const timings=await review.evaluate(()=>{const measurement=Reflect.get(window,'__054DiffPaint');for(const entry of measurement.observer.takeRecords())measurement.tasks.push({start:entry.startTime,duration:entry.duration});measurement.observer.disconnect();measurement.mutations.disconnect();return{marks:measurement.marks,longTasks:measurement.tasks}})
        const persisted=await readNative(),payload=JSON.parse(persisted.candidatePayload)
        expect(persisted.world).toBe(ids.worldviewBefore)
        const display={field:payload.worldviewField,operation:payload.worldviewFieldOperation,available:await review.getByRole('button',{name:'对比',exact:true}).isEnabled(),errors:await review.locator('[role="alert"]').allTextContents(),coverage,bottom,timings,canonicalWorldUnchanged:true,acceptance:false}
        pair.display=display;await attachJSON(info,'054-matched-input-and-display-diagnostic.json',pairs)
      }}finally{await attachJSON(info,'054-matched-input-and-display-diagnostic.json',pairs)}
      // Keep the original end-to-end gate red until the matched evidence has
      // been reviewed; native-control costs are evidence, never an exemption.
      for(const pair of pairs)expect([...pair.reviewBulk.longTasks,...pair.reviewHot.longTasks].filter(task=>task.duration>50),`${pair.size} actual Review end-to-end input`).toEqual([])
      await review.getByRole('button',{name:'编辑候选',exact:true}).click();await area.fill(edited);await expect(review.getByRole('button',{name:'采纳',exact:true})).toBeEnabled();await review.getByRole('button',{name:'对比',exact:true}).click()
    }
    if(['1','display'].includes(perfMode)){
      const displayMeasurements:Array<{size:number;longTasks:Array<{start:number;duration:number}>;domElements:number;marks:Record<string,number>}>=[]
      const profiler=process.env.STORYFORGE_DIFF_PROFILE==='1'?await context.newCDPSession(page):null
      if(profiler){await profiler.send('Profiler.enable');await profiler.send('Profiler.setSamplingInterval',{interval:1000});await profiler.send('Profiler.start')}
      try{
      for(const size of [10000,50000]){
        // A 50k visible blocked draft is a display stress sample. It never
        // becomes a valid candidate and is never adopted or written to Canon.
        const phrase='星海约定与退潮后的来信。\n',stress=phrase.repeat(Math.ceil(size/phrase.length)).slice(0,size)
        await review.getByRole('button',{name:'编辑候选',exact:true}).click()
        await page.evaluate(()=>{
          const tasks:Array<{start:number;duration:number}>=[]
          const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())tasks.push({start:entry.startTime,duration:entry.duration})})
          observer.observe({type:'longtask',buffered:false});Reflect.set(window,'__054DisplayMeasure',{tasks,observer,started:performance.now(),marks:{input:performance.now()}})
        })
        await area.fill(stress);await expect(area).toHaveValue(stress)
        await page.evaluate(()=>Reflect.get(window,'__054DisplayMeasure').marks.filled=performance.now())
        if(size===10000)await expect(review.getByRole('button',{name:'采纳',exact:true})).toBeEnabled()
        else await expect(area).toHaveAttribute('aria-invalid','true')
        await page.evaluate(()=>Reflect.get(window,'__054DisplayMeasure').marks.compare=performance.now())
        await review.getByRole('button',{name:'对比',exact:true}).click();await expect(diff.locator('.wv-diff-row').first()).toBeVisible()
        await diff.getByRole('button',{name:'复制候选正文',exact:true}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(stress)
        const result=await diff.evaluate(element=>{
          const measurement=Reflect.get(window,'__054DisplayMeasure') as {tasks:Array<{start:number;duration:number}>;observer:PerformanceObserver;started:number;marks:Record<string,number>}
          measurement.observer.disconnect();return{elapsed:performance.now()-measurement.started,longTasks:measurement.tasks,marks:{...measurement.marks,done:performance.now()},domElements:element.querySelectorAll('*').length,visibleRows:element.querySelectorAll('.wv-diff-row').length,textUnits:element.textContent?.length,status:[...element.querySelectorAll('[role="status"]')].map(node=>node.textContent)}
        })
        displayMeasurements.push({size,...result});expect(result.domElements).toBeLessThan(5000)
        expect((await readNative()).world).toBe(ids.worldviewBefore)
        if(size===50000){await review.getByRole('button',{name:'编辑候选',exact:true}).click();await expect(area).toHaveAttribute('aria-invalid','true');await expect(review.getByRole('button',{name:'采纳',exact:true})).toBeDisabled();await review.getByRole('button',{name:'对比',exact:true}).click()}
      }
      }finally{if(profiler){const {profile}=await profiler.send('Profiler.stop');await attachJSON(info,'054-native-display-cpu-profile.json',profile);await profiler.detach()}await attachJSON(info,'054-native-display-performance.json',displayMeasurements)}
      for(const result of displayMeasurements)expect(result.longTasks.filter(entry=>entry.duration>50),`${result.size} actual review main thread`).toEqual([])
      await review.getByRole('button',{name:'编辑候选',exact:true}).click();await area.fill(edited)
      await expect(review.getByRole('button',{name:'采纳',exact:true})).toBeEnabled();await review.getByRole('button',{name:'对比',exact:true}).click()
      await expect(diff.locator('[data-diff-kind="remove"]')).toContainText(['七'])
    }
    const measurements:unknown[]=[]
    for(const theme of themes){
      await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;localStorage.setItem('storyforge-theme',theme);window.dispatchEvent(new Event('themechange'))},theme)
      const matrix=await diff.evaluate(readDiffContrast)
      expect(matrix.length).toBeGreaterThan(0);for(const pair of matrix)expect(pair.ratio,`${theme} ${pair.kind}`).toBeGreaterThanOrEqual(4.5)
      measurements.push({theme,matrix})
      const copyButton=diff.getByRole('button',{name:'复制候选正文',exact:true})
      await copyButton.hover()
      const hover=await copyButton.evaluate(node=>({foreground:getComputedStyle(node).color,background:getComputedStyle(node).backgroundColor,shadow:getComputedStyle(node).boxShadow}))
      const hoverMatrix=await diff.evaluate(readDiffContrast);for(const pair of hoverMatrix)expect(pair.ratio,`${theme} hover ${pair.kind}`).toBeGreaterThanOrEqual(4.5)
      await page.keyboard.press('Tab');await copyButton.focus()
      const focus=await copyButton.evaluate(node=>({visible:node.matches(':focus-visible'),outline:getComputedStyle(node).outlineColor,width:parseFloat(getComputedStyle(node).outlineWidth)}))
      expect(focus.visible).toBe(true);expect(focus.width).toBeGreaterThanOrEqual(3)
      const focusMatrix=await diff.evaluate(readDiffContrast);for(const pair of focusMatrix)expect(pair.ratio,`${theme} focus ${pair.kind}`).toBeGreaterThanOrEqual(4.5)
      const selection=await diff.locator('.wv-diff-span').first().evaluate(node=>{
        const selected=window.getSelection(),range=document.createRange();range.selectNodeContents(node);selected?.removeAllRanges();selected?.addRange(range)
        const style=getComputedStyle(node,'::selection')
        const luminance=(color:string)=>{const values=color.match(/[\d.]+/g)?.map(Number);if(!values||values.length<3||(values[3]??1)!==1)throw new Error('Selection must have an opaque paired surface');return values.slice(0,3).map(n=>{const value=n/255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4}).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0)}
        const a=luminance(style.color),b=luminance(style.backgroundColor);return{foreground:style.color,background:style.backgroundColor,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}
      })
      expect(selection.ratio,`${theme} selection`).toBeGreaterThanOrEqual(4.5)
      measurements.push({theme,hover,hoverMatrix,focus,focusMatrix,selection})
      await page.evaluate(()=>window.getSelection()?.removeAllRanges())
      if(['storyforge','paper-ink','cosmic-glass','ember'].includes(theme))for(const width of [390,1366,1728]){
        await page.setViewportSize({width,height:1000});await diff.scrollIntoViewIfNeeded()
        await expect(diff.locator('.wv-diff-span').first()).toHaveCSS('font-size','16px')
        const geometry=await diff.locator('.wv-diff-row').evaluateAll(rows=>rows.map(row=>{const sides=[...row.querySelectorAll<HTMLElement>(':scope > .wv-diff-cell')].filter(cell=>getComputedStyle(cell).display!=='none').map(cell=>{const r=cell.getBoundingClientRect();return{x:r.x,y:r.y,height:r.height,width:r.width}});return sides}))
        if(width!==390)for(const sides of geometry){expect(sides).toHaveLength(2);expect(Math.abs(sides[0].y-sides[1].y)).toBeLessThanOrEqual(1);expect(Math.abs(sides[0].height-sides[1].height)).toBeLessThanOrEqual(1)}
        measurements.push({theme,width,geometry});await diff.screenshot({path:info.outputPath(`054-${production?'production':'dev'}-${theme}-${width}.png`),animations:'disabled'})
      }
    }
    await attachJSON(info,'054-computed-and-geometry.json',measurements)
    await review.getByRole('button',{name:'编辑候选',exact:true}).click();await area.fill('# 星海\n原有议席每八次退潮轮换。\n')
    await expect(review.getByRole('button',{name:'采纳',exact:true})).toBeEnabled();await review.getByRole('button',{name:'对比',exact:true}).click()
    const deleted=diff.locator('.wv-diff-row-removed').filter({hasText:'仍须遵守原有边界。'});await expect(deleted).toHaveCount(1);await expect(deleted).toBeVisible()
    const deletionMatrices:unknown[]=[]
    for(const theme of themes){
      await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;window.dispatchEvent(new Event('themechange'))},theme)
      const matrix=await diff.evaluate(readDiffContrast);expect(matrix.some(row=>row.row?.includes('wv-diff-row-removed'))).toBe(true)
      for(const pair of matrix)expect(pair.ratio,`${theme} deleted block ${pair.kind}`).toBeGreaterThanOrEqual(4.5)
      deletionMatrices.push({theme,matrix})
      if(['storyforge','paper-ink','cosmic-glass','ember'].includes(theme))for(const width of [390,1366,1728]){
        await page.setViewportSize({width,height:1000});await deleted.scrollIntoViewIfNeeded();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
        const geometry=await deleted.evaluate(element=>{const box=element.getBoundingClientRect(),viewport=element.closest('[data-diff-scroller]')!.getBoundingClientRect();return{top:box.top,bottom:box.bottom,viewportTop:viewport.top,viewportBottom:viewport.bottom}})
        expect(geometry.bottom).toBeGreaterThan(geometry.viewportTop);expect(geometry.top).toBeLessThan(geometry.viewportBottom);deletionMatrices.push({theme,width,geometry})
        await diff.screenshot({path:info.outputPath(`054-deletion-${production?'production':'dev'}-${theme}-${width}.png`),animations:'disabled'})
      }
    }
    await attachJSON(info,'054-deleted-block-theme-matrix.json',deletionMatrices)
    expect((await readNative()).world).toBe(ids.worldviewBefore)
    await review.getByRole('button',{name:'编辑候选',exact:true}).click();await area.fill(edited)
    await expect(review.getByRole('button',{name:'采纳',exact:true})).toBeEnabled();await review.getByRole('button',{name:'对比',exact:true}).click()
    await expect(diff.locator('.wv-diff-row-added').filter({hasText:/因果约束|势力关联|剧情伏笔/})).toHaveCount(3)
    await review.getByRole('button',{name:'复制候选正文',exact:true}).click()
    expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(edited)
    expect((await readNative()).world).toBe(ids.worldviewBefore)
    await review.getByRole('button',{name:'采纳',exact:true}).click();await expect(review).toHaveCount(0)
    await expect.poll(async () => (await readNative()).run).toBe('completed')
    const afterAdoption=await readNative();expect(afterAdoption.value).toBe(edited)
    expect(afterAdoption.runEvidence.terminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
    expect(afterAdoption.runEvidence.contractHash).toBe(before.runEvidence.contractHash)
    await attachJSON(info,'054-native-original-adoption-readback.json',{ids,before,afterModes,afterAdoption})
    expect(models).toBe(0);expect(forbidden).toBe(0);expect(errors).toEqual([])
  }finally{await attachJSON(info,'054-native-network-and-runtime.json',{origin,production,models,forbidden,intentionalWorkerAborts,blockedRequests,errors,workers});await context.close()}
})
