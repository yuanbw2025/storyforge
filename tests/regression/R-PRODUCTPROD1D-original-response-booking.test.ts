/** Candidate overlay only. Real frozen core/DB/Harness, explicit fake native transport. */
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

async function authorized() {
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
  return { scope, productionId, brief, capabilityBindings, executor }
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
 let nativeUsage: typeof fake.usage | null=fake.usage
 let status='completed', wait:Promise<void>|null=null, acks=0
 const response=(body:unknown)=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}})
 fake.fetch.mockImplementation(async(url,init)=>{
  const path=String(url),method=init?.method??'GET';calls.push({method,path})
  if(method==='GET'&&path.endsWith(`/requests/${fake.wire!.id}`)){
   if(wait)await wait
   return response({id:fake.wire!.id,model:fake.wire!.model,createdAt:Date.now(),status,text:fake.output,usage:nativeUsage,
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
 return {...data,query,fake,prior,build,calls,get acks(){return acks},setUsage:(value:typeof fake.usage|null)=>{nativeUsage=value},setStatus:(value:string)=>{status=value},delay:(gate:Promise<void>)=>{wait=gate}}
}


import { parseProductProductionCommandV1 } from '../../src/lib/product-production/contracts'
import { prepareProductProductionOriginalResponseBookingV1, assertProductProductionOriginalBookingCurrentV1 } from '../../src/lib/product-production/original-response-booking'
import { bookProductProductionOriginalUsageLedgerV1 } from '../../src/lib/product-production/scheduler'

async function captured(options: { usage?: { inputTokens: number; outputTokens: number } | null } = {}) {
 const f=await blocked();if('usage' in options)f.setUsage(options.usage!)
 const capture=await captureProductProductionOriginalResponseV1(f.query)
 const production=(await db.productProductions.get(f.productionId))!,build=(await db.productBuilds.get(f.query.buildId))!
 const command={type:'book-original-response' as const,commandId:'fixture.book.original',expectedStateRevision:production.stateRevision,
  buildNumber:build.buildNumber,controlEpoch:build.controlEpoch,planHash:build.planHash,taskKey:f.query.taskKey,
  originalRunId:f.query.runId,originalAttempt:f.query.attempt,captureRunId:capture.runId,captureReceiptHash:capture.receiptHash,
  disposition:'use-native-token-usage' as 'use-native-token-usage'|'charge-reservation-upper-bound'}
 const book=(delta:Record<string,unknown>={})=>executeProductProductionCommand({scope:f.scope,productionId:f.productionId,command:{...command,...delta}})
 return {...f,capture,production,build,command,book}
}
function ledgerAttempt(build:{budgetLedgerJson:string},runId:number){return JSON.parse(build.budgetLedgerJson).attempts.find((row:{runId:number})=>row.runId===runId)}

it('books verified actual usage once without transport, new Runs, candidate, adoption, epoch advance or automatic restart',async()=>{
 const f=await captured(),runBytes=JSON.stringify(await db.agentRuns.toArray()),worldBytes=JSON.stringify(await db.worldReleases.toArray()),calls=f.fake.fetch.mock.calls.length
 const artifacts=JSON.stringify(await db.productBuildArtifacts.toArray()),failure=JSON.parse(f.build.failureJson)
 const receipt=await f.book();expect(receipt.ok).toBe(true);expect(receipt.result).toMatchObject({newModelCalls:0,candidateCreated:false,adopted:false,blocked:false})
 const build=(await db.productBuilds.get(f.build.id!))!,production=(await db.productProductions.get(f.productionId))!
 expect(build.status).toBe('recovery-required');expect(production.status).toBe('producing');expect(build.controlEpoch).toBe(f.build.controlEpoch)
 expect(production.controlEpoch).toBe(f.production.controlEpoch);expect(production.stateRevision).toBe(f.production.stateRevision+1)
 const attempt=ledgerAttempt(build,f.query.runId);expect(attempt).toMatchObject({usageKnown:true,outcome:'failed',usage:{modelCalls:1,inputTokens:101,outputTokens:11,mediaCalls:0,costUsd:null,storageBytes:0}})
 expect(attempt.resolution).toBeUndefined();expect(attempt.usage.durationMs).toBeGreaterThanOrEqual(0)
 expect(JSON.parse(build.failureJson)).toMatchObject({code:failure.code,failureProvenance:failure.failureProvenance,
  originalResponseBooking:{portable:false,originalRunId:f.query.runId,captureRunId:f.capture.runId,effectiveDisposition:'provider-actual-charge',previousReservation:{usageKnown:false},observedPhysicalRequests:1}})
 expect(JSON.stringify(await db.agentRuns.toArray())).toBe(runBytes);expect(f.fake.fetch.mock.calls.length).toBe(calls)
 expect(JSON.stringify(await db.worldReleases.toArray())).toBe(worldBytes);expect(JSON.stringify(await db.productBuildArtifacts.toArray())).toBe(artifacts)
},30000)

it('replays the durable command before proof preflight even if the captured copy is no longer available',async()=>{
 const f=await captured();const first=await f.book(),before=(await db.productBuilds.get(f.build.id!))!
 await db.agentRuns.delete(f.capture.runId);f.fake.fetch.mockRejectedValue(new Error('no transport allowed'))
 const replay=await f.book();expect(replay).toMatchObject({ok:true,replayed:true,result:first.result,stateRevision:first.stateRevision})
 expect(await db.productBuilds.get(f.build.id!)).toEqual(before)
 await expect(f.book({disposition:'charge-reservation-upper-bound'})).rejects.toThrow('相同 commandId 的 payload 不同')
},30000)

it('a fresh command for the same exact booked proof is a no-op, retaining the first booking and original reservation history',async()=>{
 const f=await captured();expect((await f.book()).ok).toBe(true)
 const build=(await db.productBuilds.get(f.build.id!))!,production=(await db.productProductions.get(f.productionId))!
 const second=await f.book({commandId:'fixture.book.same-proof.again',expectedStateRevision:production.stateRevision})
 expect(second.ok).toBe(true);expect(await db.productBuilds.get(f.build.id!)).toEqual(build);expect(await db.productProductions.get(f.productionId)).toEqual(production)
},30000)

it('cannot call a completed dispatched answer free when usage is missing; only explicit original upper-bound policy can close it',async()=>{
 const f=await captured({usage:null});await expect(f.book()).rejects.toThrow('没有可靠的 token 用量')
 expect(await db.productBuilds.get(f.build.id!)).toEqual(f.build)
 expect(()=>parseProductProductionCommandV1({...f.command,disposition:'confirmed-not-charged'})).toThrow()
 const receipt=await f.book({disposition:'charge-reservation-upper-bound'});expect(receipt.ok).toBe(true)
 const after=(await db.productBuilds.get(f.build.id!))!,beforeAttempt=ledgerAttempt(f.build,f.query.runId),afterAttempt=ledgerAttempt(after,f.query.runId)
 expect(afterAttempt).toMatchObject({usageKnown:true,resolution:'author-charged-reservation-upper-bound',usage:beforeAttempt.usage})
 expect(JSON.parse(after.failureJson).originalResponseBooking).toMatchObject({effectiveDisposition:'author-charged-reservation-upper-bound',observedPhysicalRequests:1})
},30000)

it('retains truthful spend beyond the task and Build ceiling and rejects continuation under the old authorization',async()=>{
 const f=await captured({usage:{inputTokens:999999999,outputTokens:999999999}}),receipt=await f.book()
 expect(receipt).toMatchObject({ok:true,result:{blocked:true,newModelCalls:0}})
 const build=(await db.productBuilds.get(f.build.id!))!,production=(await db.productProductions.get(f.productionId))!
 expect(ledgerAttempt(build,f.query.runId)).toMatchObject({usageKnown:true,usage:{inputTokens:999999999,outputTokens:999999999}})
 const booking=JSON.parse(build.failureJson).originalResponseBooking
 expect(booking.blockers.some((s:string)=>s.includes('task usage'))).toBe(true);expect(booking.blockers.some((s:string)=>s.startsWith('Build:inputTokens'))).toBe(true)
 const calls=f.fake.fetch.mock.calls.length
 for(const action of ['retry','change-capability','author-edit']){
  const command={type:'resolve-blocker',commandId:'fixture.reject-overbudget.'+action,expectedStateRevision:production.stateRevision,
   blockerKey:f.query.taskKey,resolution:{action,note:'Explicit fixture action',...(action==='author-edit'?{authorDraftJson:'{}'}:{})}}
  const result=await executeProductProductionCommand({scope:f.scope,productionId:f.productionId,command})
  expect(result).toMatchObject({ok:false,errorCode:'invalid-state-transition'});expect(String(result.result.message)).toContain('旧任务或 Build 授权不足')
 }
 expect(await db.productBuilds.get(f.build.id!)).toEqual(build);expect(f.fake.fetch.mock.calls.length).toBe(calls)
},30000)

it('rejects malformed/extra usage claims, foreign Work, stale Plan/epoch/attempt/capture and revision without touching the ledger',async()=>{
 const f=await captured(),calls=f.fake.fetch.mock.calls.length
 for(const delta of [{actualUsage:{inputTokens:0,outputTokens:0}},{controlEpoch:-1},{originalAttempt:0},{captureReceiptHash:'x'},
  {planHash:'x'},{rawResponse:'spoof'}, {confirmation:true}])expect(()=>parseProductProductionCommandV1({...f.command,...delta})).toThrow()
 for(const delta of [{controlEpoch:f.command.controlEpoch+1},{planHash:'f'.repeat(64)},{originalAttempt:2},
  {captureRunId:f.capture.runId+1},{captureReceiptHash:'f'.repeat(64)},{expectedStateRevision:f.command.expectedStateRevision+1}]){
  await expect(f.book(delta)).rejects.toThrow()
 }
 await expect(executeProductProductionCommand({scope:{...f.scope,workId:f.scope.workId!+1},productionId:f.productionId,command:f.command})).rejects.toThrow()
 expect(await db.productBuilds.get(f.build.id!)).toEqual(f.build);expect(f.fake.fetch.mock.calls.length).toBe(calls)
},30000)

it('rolls back ledger, revision and booking atomically when durable command receipt storage fails; explicit retry is safe',async()=>{
 const f=await captured(),update=db.productProductionCommands.update.bind(db.productProductionCommands)
 const spy=vi.spyOn(db.productProductionCommands,'update').mockImplementation(async(...args)=>{
  if((args[1] as {status?:string}).status==='succeeded')throw Error('simulated command receipt storage failure')
  return update(...args)
 })
 await expect(f.book()).rejects.toThrow('receipt storage failure')
 expect(await db.productBuilds.get(f.build.id!)).toEqual(f.build);expect(await db.productProductions.get(f.productionId)).toEqual(f.production)
 expect(await db.productProductionCommands.where('[productionId+commandId]').equals([f.productionId,f.command.commandId]).count()).toBe(0)
 spy.mockRestore();expect((await f.book()).ok).toBe(true)
},30000)

it('concurrent distinct author commands can settle only once at the original state revision',async()=>{
 const f=await captured(),results=await Promise.allSettled([f.book(),f.book({commandId:'fixture.book.concurrent'})])
 const receipts=results.flatMap(row=>row.status==='fulfilled'?[row.value]:[])
 expect(receipts.filter(row=>row.ok)).toHaveLength(1)
 const production=(await db.productProductions.get(f.productionId))!,build=(await db.productBuilds.get(f.build.id!))!
 expect(production.stateRevision).toBe(f.production.stateRevision+1);expect(build.stateRevision).toBe(f.build.stateRevision+1)
 expect(ledgerAttempt(build,f.query.runId).usage).toMatchObject({modelCalls:1,inputTokens:101,outputTokens:11})
},30000)

it('transaction witnesses reject changed raw retention, terminal owner, Build and newly materialized original product storage',async()=>{
 const f=await captured(),prepared=await prepareProductProductionOriginalResponseBookingV1({scope:f.scope,productionId:f.productionId,command:f.command,now:Date.now()})
 const assert=()=>assertProductProductionOriginalBookingCurrentV1(prepared,f.production,f.build)
 await assert()
 const body=prepared.artifacts.find(row=>row.artifactKind==='raw-response')!
 await db.agentRunArtifacts.update(body.id!,{retentionState:'evicted'})
 await expect(assert()).rejects.toThrow('原文或来源证据');await db.agentRunArtifacts.put(body)
 const run=prepared.runs[0];await db.agentRuns.update(run.id!,{updatedAt:run.updatedAt+1})
 await expect(assert()).rejects.toThrow('原 Run');await db.agentRuns.put(run)
 await expect(assertProductProductionOriginalBookingCurrentV1(prepared,f.production,{...f.build,stateRevision:f.build.stateRevision+1})).rejects.toThrow('作品或账本')
 const artifactId=await db.productBuildArtifacts.add({projectId:f.scope.projectId,workId:f.scope.workId,buildId:f.build.id,
  producerRunId:f.query.runId,artifactKey:'fixture.race',createdAt:Date.now()} as never)
 await expect(assert()).rejects.toThrow('产品工件');await db.productBuildArtifacts.delete(artifactId)
 await assert()
},30000)

it('cannot overwrite a previous human/system accounting disposition or conflicting actual tokens with a newly fetched original answer',async()=>{
 const f=await captured(),ledger=JSON.parse(f.build.budgetLedgerJson),attempt=ledger.attempts.find((row:{runId:number})=>row.runId===f.query.runId)
 for(const resolution of ['author-confirmed-not-charged','author-charged-reservation-upper-bound','system-released-before-dispatch']){
  attempt.usageKnown=true;attempt.resolution=resolution
  expect(()=>bookProductProductionOriginalUsageLedgerV1({budgetLedgerJson:JSON.stringify(ledger),taskKey:f.query.taskKey,runId:f.query.runId,
   attempt:f.query.attempt,controlEpoch:f.build.controlEpoch,disposition:'use-native-token-usage',nativeUsage:f.fake.usage,observedDurationMs:0})).toThrow()
 }
 delete attempt.resolution;attempt.usage={...attempt.usage,modelCalls:1,inputTokens:102,outputTokens:11}
 for(const disposition of ['use-native-token-usage','charge-reservation-upper-bound'] as const)expect(()=>bookProductProductionOriginalUsageLedgerV1({budgetLedgerJson:JSON.stringify(ledger),taskKey:f.query.taskKey,runId:f.query.runId,
  attempt:f.query.attempt,controlEpoch:f.build.controlEpoch,disposition,nativeUsage:f.fake.usage,observedDurationMs:0})).toThrow('冲突')
},30000)

it('an imported pending proof preserves exact raw bytes and the old reservation, but cannot settle a new native owner',async()=>{
 const f=await captured(),{exportProjectJSON,importProjectJSON}=await import('../../src/lib/export/json-export')
 const projectId=await importProjectJSON(await exportProjectJSON(f.scope.projectId))
 const production=(await db.productProductions.where('projectId').equals(projectId).toArray()).find(row=>row.productionKey===f.production.productionKey)!
 const build=(await db.productBuilds.where('productionId').equals(production.id!).toArray()).find(row=>row.buildNumber===f.build.buildNumber)!
 const runs=await db.agentRuns.where('productBuildId').equals(build.id!).toArray()
 const original=runs.find(row=>row.parentRelation===`task:${f.query.taskKey}`)!,capture=runs.find(row=>JSON.parse(row.contractJson).scope.productProduction?.taskKey==='production.original-response-capture')!
 const raw=await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([projectId,'raw-response',f.capture.rawResponseHash]).first()
 expect(raw?.content).toBe(f.fake.output)
 const calls=f.fake.fetch.mock.calls.length,before=(await db.productBuilds.get(build.id!))!
 await expect(executeProductProductionCommand({scope:{projectId,worldId:production.worldId,workId:production.workId},productionId:production.id!,command:{...f.command,
  expectedStateRevision:production.stateRevision,buildNumber:build.buildNumber,controlEpoch:build.controlEpoch,planHash:build.planHash,
  originalRunId:original.id!,captureRunId:capture.id!}})).rejects.toThrow()
 expect(await db.productBuilds.get(build.id!)).toEqual(before);expect(f.fake.fetch.mock.calls.length).toBe(calls)
 expect(ledgerAttempt(before,original.id!).usageKnown).toBe(false)
},30000)

it('backup/import retains an already booked charge and original opaque proof history without gaining native retry or rebooking permission',async()=>{
 const f=await captured();expect((await f.book()).ok).toBe(true)
 const original=(await db.productBuilds.get(f.build.id!))!,originalAttempt=ledgerAttempt(original,f.query.runId)
 const {exportProjectJSON,importProjectJSON}=await import('../../src/lib/export/json-export')
 const projectId=await importProjectJSON(await exportProjectJSON(f.scope.projectId))
 const production=(await db.productProductions.where('projectId').equals(projectId).toArray()).find(row=>row.productionKey===f.production.productionKey)!
 const build=(await db.productBuilds.where('productionId').equals(production.id!).toArray()).find(row=>row.buildNumber===f.build.buildNumber)!
 const originalBooking=JSON.parse(original.failureJson).originalResponseBooking
 expect(JSON.parse(build.failureJson).originalResponseBooking).toEqual(originalBooking)
 const attempt=JSON.parse(build.budgetLedgerJson).attempts.find((row:{taskKey:string})=>row.taskKey===f.query.taskKey)
 expect(attempt.usage).toEqual(originalAttempt.usage);expect(attempt.usageKnown).toBe(true);expect(attempt.runId).not.toBe(f.query.runId)
 const calls=f.fake.fetch.mock.calls.length
 const capture=(await db.agentRuns.where('productBuildId').equals(build.id!).toArray()).find(row=>JSON.parse(row.contractJson).scope.productProduction?.taskKey==='production.original-response-capture')!
 await expect(executeProductProductionCommand({scope:{projectId,worldId:production.worldId,workId:production.workId},productionId:production.id!,command:{...f.command,
  commandId:'fixture.import.cannot-rebook',expectedStateRevision:production.stateRevision,buildNumber:build.buildNumber,
  controlEpoch:build.controlEpoch,planHash:build.planHash,originalRunId:attempt.runId,captureRunId:capture.id!}})).rejects.toThrow()
 expect(f.fake.fetch.mock.calls.length).toBe(calls);expect(await db.productBuilds.get(build.id!)).toEqual(build)
},30000)
