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
