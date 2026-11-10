import {beforeEach,expect,it,vi} from 'vitest'
beforeEach(()=>{localStorage.clear();vi.resetModules();vi.restoreAllMocks()})
it.each([false,true])('negotiates extended reports (%s) without losing errors arriving while capability read waits',async(supports)=>{
 const ctx=await import('../../src/lib/diagnostics/operation-trail');ctx.installOperationTrail();ctx.setDiagnosticContextEnabled(true)
 const telemetry=await import('../../src/lib/feedback/client-telemetry');telemetry.setTelemetryPreferences(false,true)
 const now=Date.now()
 const row={occurredAt:new Date(now).toISOString(),source:'react' as const,name:'TypeError',build:'v4.0.5+1234567',frames:['/assets/a.js:1:2'],details:{version:1 as const,code:'property-access' as const,trail:[]}}
 telemetry.recordClientError(row)
 let release:(value:Response)=>void=()=>{}
 const capability=new Promise<Response>(resolve=>{release=resolve})
 const bodies:Record<string,unknown>[]=[]
 vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
  if(String(url).endsWith('capabilities'))return capability
  const body=JSON.parse(String(init?.body));bodies.push(body);return new Response(JSON.stringify({accepted:body.events.map((r:{id:string})=>r.id),discarded:[]}),{status:200})
 }))
 const flushing=telemetry.flushClientTelemetry()
 telemetry.recordClientError({...row,name:'RangeError',frames:['/assets/b.js:1:2']})
 release(new Response(JSON.stringify({diagnosticContext:supports?1:0}),{status:200}));await flushing
 const events=bodies[0].events as {error?:{details?:unknown}}[]
 expect(!!events[0].error?.details).toBe(supports)
 const stored=JSON.parse(localStorage.getItem(telemetry.TELEMETRY_KEY)!)
 expect(stored.queue).toHaveLength(1);expect(stored.queue[0].error.name).toBe('RangeError')
 vi.unstubAllGlobals()
})
it('keeps maximal valid enhanced events under the existing 32KiB server budget without dropping overflow or changing IDs',async()=>{
 vi.useFakeTimers()
 try{
  const ctx=await import('../../src/lib/diagnostics/operation-trail');ctx.installOperationTrail();ctx.setDiagnosticContextEnabled(true)
  const telemetry=await import('../../src/lib/feedback/client-telemetry');telemetry.setTelemetryPreferences(false,true)
  const build='v4.0.5-'+'a'.repeat(40)+'+'+'f'.repeat(40)
  const prefix='/storyforge/assets/',suffix='.js:1:1',frame=prefix+'a'.repeat(160-prefix.length-suffix.length)+suffix
  for(let n=0;n<20;n++){
   const at=new Date(Date.now()-n*1000).toISOString()
   telemetry.recordClientError({occurredAt:at,source:'native',name:'NativeOutOfMemory',build,frames:Array(8).fill(frame),details:{version:1,code:'native-exit',trail:Array.from({length:20},()=>({at,area:'community' as const,action:'generate' as const})),native:{process:'renderer',reason:'oom',exitCode:-2147483648}}})
  }
  const stored=JSON.parse(localStorage.getItem(telemetry.TELEMETRY_KEY)!)
  for(const row of stored.queue)row.client.build=build
  localStorage.setItem(telemetry.TELEMETRY_KEY,JSON.stringify(stored))
  const ids=stored.queue.map((row:{id:string})=>row.id) as string[]
  const bodies:string[]=[],accepted:string[]=[]
  vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
   if(String(url).endsWith('capabilities'))return new Response('{"diagnosticContext":1}')
   const raw=String(init?.body);bodies.push(raw)
   if(new TextEncoder().encode(raw).byteLength>32*1024)return new Response('{"error":"BODY_TOO_LARGE"}',{status:413})
   const body=JSON.parse(raw);accepted.push(...body.events.map((row:{id:string})=>row.id));return new Response(JSON.stringify({accepted:body.events.map((row:{id:string})=>row.id),discarded:[]}))
  }))
  await telemetry.flushClientTelemetry()
  expect(new TextEncoder().encode(bodies[0]).byteLength).toBeLessThanOrEqual(30*1024)
  const pending=JSON.parse(localStorage.getItem(telemetry.TELEMETRY_KEY)!).queue
  expect(pending.length).toBeGreaterThan(0);expect(pending.every((row:{attempts:number})=>row.attempts===0)).toBe(true)
  for(let n=0;n<4&&accepted.length<20;n++){await vi.advanceTimersByTimeAsync(61000);await telemetry.flushClientTelemetry()}
  expect([...accepted].sort()).toEqual([...ids].sort());expect(new Set(accepted).size).toBe(20)
  expect(JSON.parse(localStorage.getItem(telemetry.TELEMETRY_KEY)!).queue).toEqual([])
  expect(bodies.every(raw=>new TextEncoder().encode(raw).byteLength<=30*1024)).toBe(true)
 }finally{vi.unstubAllGlobals();vi.useRealTimers()}
})
