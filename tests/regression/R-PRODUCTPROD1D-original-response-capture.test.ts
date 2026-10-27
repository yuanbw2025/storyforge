import { createProductProductionPlanV3 } from '../../src/lib/product-production/plan'
/** Real owner/DB/Harness and explicit fake native transport; no actual provider or author data. */
import { beforeEach, afterEach, expect, it, vi } from "vitest"
import { db } from "../../src/lib/db/schema"
import { useAIConfigStore } from "../../src/stores/ai-config"
import { openProductionFixtureV1 } from "../helpers/open-ttrpg-production"
import { executeProductProductionCommand } from "../../src/lib/product-production/commands"
import { resolveConfiguredTextCapabilityV1 } from "../../src/lib/product-production/capabilities"
import { createConfiguredProductProductionExecutorV1 } from "../../src/lib/product-production/production-executor"
import { runProductProductionUntilBlockedV1 } from "../../src/lib/product-production/scheduler"
import { readAgentRunV1 } from "../../src/lib/agent/run/event-store"
import { readAgentRunArtifactExactV1 } from "../../src/lib/memory/artifact-store"
import { sha256Text } from "../../src/lib/ai/chapter-memory/text-normalization"
import { CODEX_DURABLE_RECEIPT_RETENTION_V1 } from "../../src/lib/ai/codex-transport"
import { captureProductProductionOriginalResponseV1 } from "../../src/lib/product-production/local-request"

let previousLocks: PropertyDescriptor | undefined
beforeEach(async () => {
 await db.delete(); await db.open(); window.location.href='http://localhost:4178/storyforge/'
 useAIConfigStore.getState().setConfig({provider:'codex',model:'fixture-native-only',apiKey:'',contextWindow:131072,maxTokens:16000})
 previousLocks=Object.getOwnPropertyDescriptor(navigator,'locks')
 const active=new Set<string>()
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async (name:string,_options:unknown,callback:(lock:object|null)=>Promise<unknown>)=>{
  if(active.has(name))return callback(null);active.add(name);try{return await callback({name,mode:'exclusive'})}finally{active.delete(name)}
 }}})
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();if(previousLocks)Object.defineProperty(navigator,'locks',previousLocks);else Reflect.deleteProperty(navigator,'locks');db.close()})

async function authorized(profile: 2 | 3 = 3) {
  const { scope, productionId, brief } = await openProductionFixtureV1()
  const previous = (await db.productProductions.get(productionId))!
  expect((await executeProductProductionCommand({ scope, productionId, command: { type: 'save-brief-revision',
    commandId: 'native-binding.save', expectedStateRevision: previous.stateRevision,
    parentRevision: previous.currentBriefRevision, brief } })).ok).toBe(true)
  const current = (await db.productProductions.get(productionId))!
  const row = (await db.productProductionBriefs.where('[productionId+revision]').equals([productionId, current.currentBriefRevision!]).first())!
  expect((await executeProductProductionCommand({ scope, productionId, command: { type: 'authorize-start',
    commandId: 'native-binding.start', expectedStateRevision: current.stateRevision,
    briefRevision: row.revision, briefHash: row.briefHash, authorizationNonce: 'explicit.fixture.author' } })).ok).toBe(true)
  const requirementKey = brief.capabilityRequirements.find(r => r.mediaClass === 'text')!.requirementKey
  const resolved = await resolveConfiguredTextCapabilityV1({ projectId: scope.projectId, category: 'product-production', requirementKey })
  const capabilityBindings = [{ requirementKey, adapterId: 'configured-text.v1', bindingHash: resolved.receipt.capabilityHash,
    provider: resolved.receipt.provider, model: resolved.receipt.model }]
  const executor = createConfiguredProductProductionExecutorV1({ production: (await db.productProductions.get(productionId))!, brief })
  return { scope, productionId, brief, capabilityBindings, executor, ...(profile === 2 ? { suppliedPlan: await createProductProductionPlanV3({ brief, briefHash: row.briefHash, buildNumber: 1, ttrpgOpenExecutionProfile: 2 }) } : {}) }
}
async function requestEvidence(scope: { projectId: number }, runId: number, attempt = 1) {
  const snapshot = await readAgentRunV1(scope, runId)
  const found = []
  for (const event of snapshot.events) {
    if (event.type !== 'evidence.artifact.recorded' || event.payload.artifactKind !== 'source-snapshot' || event.payload.attempt !== attempt) continue
    const value = JSON.parse(await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: 'source-snapshot', contentHash: event.payload.contentHash }))
    if (value?.schema === 'storyforge.product-production-local-request') found.push(value)
  }
  expect(found).toHaveLength(1)
  return found[0]
}

function transport(mode: 'completed' | 'lost-poll', scope: { projectId: number }, options: { ackFails?: boolean } = {}) {
  const requests: Array<{ url: string; method: string }> = []
  let wire: { id: string; model: string; messages: unknown[]; receiptRetention: string; responseFormat: string } | undefined
  let ownerRunId = 0
  const output = '{"fixture":"complete raw deliberately fails the closed candidate parser"}'
  const usage = { inputTokens: 101, outputTokens: 11 }
  const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url), method = init?.method ?? 'GET'; requests.push({ url: path, method })
    if (path.endsWith('/status')) return response({ state: 'ready' })
    if (path.endsWith('/requests') && method === 'POST') {
      wire = JSON.parse(String(init?.body))
      expect(wire!.receiptRetention).toBe(CODEX_DURABLE_RECEIPT_RETENTION_V1)
      const run = (await db.agentRuns.orderBy('id').last())!; ownerRunId = run.id!
      const snapshot = await readAgentRunV1(scope, ownerRunId)
      const taskKey = snapshot.contract.scope.productProduction!.taskKey
      const evidence = await requestEvidence(scope, ownerRunId, snapshot.projection.steps[taskKey].attempt)
      expect(evidence.request.requestId).toBe(wire!.id)
      expect(evidence.request.requestHash).toBe(await sha256Text(String(init?.body)))
      expect(evidence.messages).toEqual(wire!.messages)
      return response({ id: wire!.id, status: 'accepted' })
    }
    if (wire && path.endsWith(`/requests/${wire.id}/acknowledge`)) {
      const run = await readAgentRunV1(scope, ownerRunId), expectedHash = await sha256Text(output)
      const raw = run.events.find(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'raw-response' && e.payload.contentHash === expectedHash)
      expect(raw).toBeTruthy()
      const bodies = await db.agentRunArtifacts.where('projectId').equals(scope.projectId).toArray()
      expect(bodies.some(b => b.content?.includes('storyforge.product-production-local-response') && b.content.includes(expectedHash))).toBe(true)
      if (options.ackFails) return response({ error: 'simulated unavailable handoff' }, 503)
      return response({ id: wire.id, acknowledged: true, acknowledgedAt: Date.now(), status: 'completed' })
    }
    if (wire && path.endsWith(`/requests/${wire.id}`)) {
      if (mode === 'lost-poll') throw new TypeError('simulated local observation lost')
      return response({ id: wire.id, model: wire.model, createdAt: Date.now(), status: 'completed', text: output,
        usage, dispatched: true, requestHash: await sha256Text(JSON.stringify(wire)), requestHashAlgorithm: 'sha256-json-request-v1',
        receiptRetention: CODEX_DURABLE_RECEIPT_RETENTION_V1 })
    }
    throw Error('Unexpected fixture transport route: ' + path)
  })
  vi.stubGlobal('fetch', fetch)
  return { requests, fetch, get runId() { return ownerRunId }, get wire() { return wire }, output, usage }
}


const confirmation = 'retain-original-complete-response-without-inference-v1' as const
async function blocked() {
 const data=await authorized(), fake=transport('lost-poll',data.scope)
 const stopped=await runProductProductionUntilBlockedV1(data), original=await requestEvidence(data.scope,fake.runId)
 const query={scope:data.scope,productionId:data.productionId,buildId:stopped.buildId,runId:fake.runId,
  taskKey:original.owner.taskKey,attempt:original.owner.attempt,confirmation}
 const prior=await readAgentRunV1(data.scope,fake.runId), build=(await db.productBuilds.get(stopped.buildId))!
 expect(prior.run.status).toBe('failed')
 const calls:Array<{method:string;path:string}>=[]
 let status='completed', wait:Promise<void>|null=null, acks=0
 const response=(body:unknown)=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}})
 fake.fetch.mockImplementation(async(url,init)=>{
  const path=String(url),method=init?.method??'GET';calls.push({method,path})
  if(method==='GET'&&path.endsWith(`/requests/${fake.wire!.id}`)){
   if(wait)await wait
   return response({id:fake.wire!.id,model:fake.wire!.model,createdAt:Date.now(),status,text:fake.output,usage:fake.usage,
    dispatched:true,requestHash:original.request.requestHash,requestHashAlgorithm:original.request.requestHashAlgorithm,
    receiptRetention:CODEX_DURABLE_RECEIPT_RETENTION_V1})
  }
  if(method==='POST'&&path.endsWith(`/requests/${fake.wire!.id}/acknowledge`)){
   acks++
   const copy=(await db.agentRuns.where('productBuildId').equals(query.buildId).toArray()).find(row=>JSON.parse(row.contractJson).scope.productProduction?.taskKey==='production.original-response-capture')!
   expect(copy).toBeTruthy()
   const snapshot=await readAgentRunV1(query.scope,copy.id!)
   const rawHash=await sha256Text(fake.output)
   expect(snapshot.events.some(event=>event.type==='evidence.artifact.recorded'&&event.payload.artifactKind==='raw-response'&&event.payload.contentHash===rawHash)).toBe(true)
   expect(JSON.stringify(await readAgentRunV1(query.scope,query.runId))).toBe(JSON.stringify(prior))
   return response({id:fake.wire!.id,status:'completed',acknowledged:true,acknowledgedAt:Date.now()})
  }
  throw Error('No inference or unbound transport operation is allowed: '+method+' '+path)
 })
 return {...data,query,fake,prior,build,calls,get acks(){return acks},setStatus:(value:string)=>{status=value},delay:(gate:Promise<void>)=>{wait=gate}}
}

it('retains a complete native answer under a separate zero-model tool Run beforeACK while preserving the original terminal and unknown budget',async()=>{
 const f=await blocked(),worlds=JSON.stringify(await db.worldReleases.toArray())
 const result=await captureProductProductionOriginalResponseV1(f.query)
 expect(result).toMatchObject({originalRunId:f.query.runId,text:f.fake.output,usage:f.fake.usage,modelCalls:0,candidateReady:false,ackStatus:'acknowledged'})
 expect(result.runId).not.toBe(f.query.runId);expect(f.acks).toBe(1)
 expect(JSON.stringify(await readAgentRunV1(f.scope,f.query.runId))).toBe(JSON.stringify(f.prior))
 expect(await db.productBuilds.get(f.query.buildId)).toEqual(f.build)
 expect(JSON.stringify(await db.worldReleases.toArray())).toBe(worlds)
 const captured=await readAgentRunV1(f.scope,result.runId)
 expect(captured.run.status).toBe('completed');expect(captured.projection.terminalReceiptHash).toBe(result.receiptHash)
 expect(captured.contract).toMatchObject({version:1,permissions:{contextSourceKeys:[],writeTargets:[]},budget:{maxModelCalls:0,maxInputTokens:0,maxOutputTokens:0}})
 expect(captured.events.some(event=>['model.requested','model.responded','candidate.persisted','adoption.committed'].includes(event.type))).toBe(false)
 expect(await readAgentRunArtifactExactV1({projectId:f.scope.projectId,artifactKind:'raw-response',contentHash:result.rawResponseHash})).toBe(f.fake.output)
 expect(f.calls.map(call=>call.method)).toEqual(['GET','POST'])
},30000)

it('replays the one completed owner copy offline with the same receipt and without another GET, ACK, inference or Run',async()=>{
 const f=await blocked(),first=await captureProductProductionOriginalResponseV1(f.query),before=JSON.stringify(await db.agentRuns.toArray())
 const count=f.fake.fetch.mock.calls.length;f.fake.fetch.mockRejectedValue(new Error('native now offline'))
 expect(await captureProductProductionOriginalResponseV1(f.query)).toEqual(first)
 expect(f.fake.fetch.mock.calls.length).toBe(count);expect(JSON.stringify(await db.agentRuns.toArray())).toBe(before)
},30000)

it('refuses all non-complete statuses and foreign ownership before retaining, acknowledging or inventing a capture',async()=>{
 const f=await blocked(),before=JSON.stringify(await db.agentRuns.toArray())
 for(const status of ['accepted','running','failed','cancelled','unknown']){
  f.setStatus(status);await expect(captureProductProductionOriginalResponseV1(f.query)).rejects.toThrow()
 }
 const count=f.calls.length
 for(const delta of [{productionId:f.query.productionId+1},{buildId:f.query.buildId+1},{runId:f.query.runId+1},{attempt:f.query.attempt+1},
  {scope:{...f.scope,workId:f.scope.workId!+1}}]) await expect(captureProductProductionOriginalResponseV1({...f.query,...delta})).rejects.toThrow()
 expect(f.calls.length).toBe(count);expect(f.acks).toBe(0);expect(JSON.stringify(await db.agentRuns.toArray())).toBe(before)
},30000)

it('sends noACK when owner raw persistence fails, then resumes the same capture Run on an explicit retry',async()=>{
 const f=await blocked(),add=db.agentRunArtifacts.add.bind(db.agentRunArtifacts)
 let failed=false
 const spy=vi.spyOn(db.agentRunArtifacts,'add').mockImplementation(async(...args)=>{
  if(!failed&&args[0].artifactKind==='raw-response'&&args[0].content===f.fake.output){failed=true;throw Error('simulated raw storage failure')}
  return add(...args)
 })
 await expect(captureProductProductionOriginalResponseV1(f.query)).rejects.toThrow('storage failure');expect(f.acks).toBe(0)
 const copies=(await db.agentRuns.where('productBuildId').equals(f.query.buildId).toArray()).filter(row=>JSON.parse(row.contractJson).scope.productProduction?.taskKey==='production.original-response-capture')
 expect(copies).toHaveLength(1);spy.mockRestore()
 const completed=await captureProductProductionOriginalResponseV1(f.query)
 expect(completed.runId).toBe(copies[0].id);expect(f.acks).toBe(1)
 expect(await db.productBuilds.get(f.query.buildId)).toEqual(f.build)
},30000)

it('does not silently repeat anACK when the browser dies after the nativeACK but before its owner status can be recorded',async()=>{
 const f=await blocked(),add=db.agentRunArtifacts.add.bind(db.agentRunArtifacts)
 let failed=false
 const spy=vi.spyOn(db.agentRunArtifacts,'add').mockImplementation(async(...args)=>{
  let value:{schema?:string;status?:string}|null=null
  try{value=JSON.parse(args[0].content??'null')}catch{ /* Raw response bytes need not be JSON. */ }
  if(!failed&&value?.schema==='storyforge.product-production-capture-ack'&&value.status==='acknowledged'){
   failed=true;throw Error('simulated crash afterACK')
  }
  return add(...args)
 })
 await expect(captureProductProductionOriginalResponseV1(f.query)).rejects.toThrow('crash afterACK');expect(f.acks).toBe(1)
 spy.mockRestore();f.fake.fetch.mockRejectedValue(new Error('must use retained original bytes, no hidden transport repeat'))
 const result=await captureProductProductionOriginalResponseV1(f.query)
 expect(result.ackStatus).toBe('unknown');expect(result.modelCalls).toBe(0);expect(result.candidateReady).toBe(false);expect(f.acks).toBe(1)
 expect(await db.productBuilds.get(f.query.buildId)).toEqual(f.build)
},30000)

it('allows only one explicitly confirmed cross-tab capture and blocks a concurrent claimant without another operation',async()=>{
 const f=await blocked();let release!:()=>void
 f.delay(new Promise<void>(resolve=>{release=resolve}))
 const first=captureProductProductionOriginalResponseV1(f.query);void first.catch(()=>{})
 await vi.waitFor(()=>expect(f.calls.filter(row=>row.method==='GET')).toHaveLength(1))
 await expect(captureProductProductionOriginalResponseV1(f.query)).rejects.toThrow('另一页面')
 release();await first;expect(f.acks).toBe(1)
 expect((await db.agentRuns.where('productBuildId').equals(f.query.buildId).toArray()).filter(row=>JSON.parse(row.contractJson).scope.productProduction?.taskKey==='production.original-response-capture')).toHaveLength(1)
},30000)

it('requires explicit retention confirmation and real browser ownership locking, preserving all original data when unavailable',async()=>{
 const f=await blocked(),before=JSON.stringify(await db.agentRuns.toArray()),count=f.calls.length
 await expect(captureProductProductionOriginalResponseV1({...f.query,confirmation:'wrong' as any})).rejects.toThrow('明确确认')
 Reflect.deleteProperty(navigator,'locks')
 await expect(captureProductProductionOriginalResponseV1(f.query)).rejects.toThrow('无法排除其他页面')
 expect(f.calls.length).toBe(count);expect(JSON.stringify(await db.agentRuns.toArray())).toBe(before)
},30000)

it('preserves captured bytes through the real author backup lifecycle but never rebinds an imported native request',async()=>{
 const f=await blocked(),copy=await captureProductProductionOriginalResponseV1(f.query)
 const {exportProjectJSON,importProjectJSON}=await import('../../src/lib/export/json-export')
 const originalProduction=(await db.productProductions.get(f.productionId))!,backup=await exportProjectJSON(f.scope.projectId)
 const projectId=await importProjectJSON(backup)
 expect(projectId).not.toBe(f.scope.projectId)
 const production=(await db.productProductions.where('projectId').equals(projectId).toArray()).find(row=>row.productionKey===originalProduction.productionKey)!
 const build=(await db.productBuilds.where('productionId').equals(production.id!).toArray()).find(row=>row.buildNumber===f.build.buildNumber)!
 const task=(await db.agentRuns.where('productBuildId').equals(build.id!).toArray()).find(row=>row.parentRelation===`task:${f.query.taskKey}`)!
 const raw=await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([projectId,'raw-response',copy.rawResponseHash]).first()
 expect(raw?.content).toBe(f.fake.output)
 const before=JSON.stringify(await db.agentRuns.toArray()),count=f.fake.fetch.mock.calls.length
 await expect(captureProductProductionOriginalResponseV1({...f.query,scope:{projectId,worldId:production.worldId,workId:production.workId},productionId:production.id!,buildId:build.id!,runId:task.id!})).rejects.toThrow()
 expect(f.fake.fetch.mock.calls.length).toBe(count);expect(JSON.stringify(await db.agentRuns.toArray())).toBe(before)
},30000)

it('rejects a historical attempt when the same actual task Run has a newer failed attempt',async()=>{
 const data=await authorized(2),fake=transport('completed',data.scope),result=await runProductProductionUntilBlockedV1(data)
 expect(fake.requests.filter(row=>row.method==='POST'&&row.url.endsWith('/requests'))).toHaveLength(2)
 const original=await requestEvidence(data.scope,fake.runId,1),count=fake.fetch.mock.calls.length
 const base={scope:data.scope,productionId:data.productionId,buildId:result.buildId,runId:fake.runId,taskKey:original.owner.taskKey,confirmation}
 await expect(captureProductProductionOriginalResponseV1({...base,attempt:1})).rejects.toThrow('当前失败尝试')
 const current=await captureProductProductionOriginalResponseV1({...base,attempt:2})
 expect(current.ackStatus).toBe('owner-preexisting');expect(current.modelCalls).toBe(0)
 expect(fake.fetch.mock.calls.length).toBe(count)
},30000)

it('cannot create a new capture orACK after the exact Build epoch changes during native observation',async()=>{
 const f=await blocked(),implementation=f.fake.fetch.getMockImplementation()!
 f.fake.fetch.mockImplementation(async(url,init)=>{
  const result=await implementation(url,init)
  if((init?.method??'GET')==='GET')await db.productBuilds.update(f.query.buildId,{controlEpoch:f.build.controlEpoch+1})
  return result
 })
 const before=await db.agentRuns.count()
 await expect(captureProductProductionOriginalResponseV1(f.query)).rejects.toThrow()
 expect(f.acks).toBe(0);expect(await db.agentRuns.count()).toBe(before)
},30000)

it('refuses corrupt retained bytes offline instead of creating a replacement or accepting only a stored receipt',async()=>{
 const f=await blocked(),copy=await captureProductProductionOriginalResponseV1(f.query)
 const raw=(await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([f.scope.projectId,'raw-response',copy.rawResponseHash]).first())!
 await db.agentRunArtifacts.update(raw.id!,{content:'corrupted bytes with the old contentHash'})
 const before=await db.agentRuns.count(),count=f.fake.fetch.mock.calls.length
 f.fake.fetch.mockRejectedValue(Error('no native fallback for corrupted owned evidence'))
 await expect(captureProductProductionOriginalResponseV1(f.query)).rejects.toThrow()
 expect(f.fake.fetch.mock.calls.length).toBe(count);expect(await db.agentRuns.count()).toBe(before)
},30000)
