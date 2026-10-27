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
  const data = await openProductionCompilerFixtureV1(true, {scope,productionId,brief})
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
  return { scope, productionId, brief, capabilityBindings, executor, data }
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

function transport(mode: 'completed' | 'lost-poll', scope: { projectId: number }, options: { ackFails?: boolean; output?: string } = {}) {
  const requests: Array<{ url: string; method: string }> = []
  let wire: { id: string; model: string; messages: unknown[]; receiptRetention: string; responseFormat: string } | undefined
  let ownerRunId = 0
  const output = options.output ?? '{"fixture":"complete raw deliberately fails the closed candidate parser"}'
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
 const data=await authorized(), fake=transport('lost-poll',data.scope,{output:JSON.stringify(data.data.sourceFacts)})
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


import { openProductionCompilerFixtureV1 } from '../helpers/open-ttrpg-production-artifacts'
import { prepareProductProductionOriginalAuthorSourceV1, assertProductProductionOriginalAuthorSourceCurrentV1, readProductProductionOriginalAuthorSourceForExecutionV1 } from '../../src/lib/product-production/original-response-author-source'

async function booked(){const f=await captured();expect((await f.book()).ok).toBe(true);return f}
async function authorCommand(f:Awaited<ReturnType<typeof captured>>,draft:unknown=f.data.sourceFacts,includeSource=true,id='fixture.author.original'){
 const production=(await db.productProductions.get(f.productionId))!
 return {type:'resolve-blocker' as const,commandId:id,expectedStateRevision:production.stateRevision,blockerKey:f.query.taskKey,
  resolution:{action:'author-edit' as const,note:'本人明确核对完整原回答后修订',authorDraftJson:JSON.stringify(draft),
   ...(includeSource?{originalResponseSource:{captureRunId:f.capture.runId,captureReceiptHash:f.capture.receiptHash}}:{})}}
}
async function submit(f:Awaited<ReturnType<typeof captured>>,command:Awaited<ReturnType<typeof authorCommand>>){return executeProductProductionCommand({scope:f.scope,productionId:f.productionId,command})}
async function runOnlySource(f:Awaited<ReturnType<typeof captured>>){
 return runProductProductionUntilBlockedV1({...f,executor:async(input)=>{
  if(input.task.taskKey===f.query.taskKey)return f.executor(input)
  throw new Error('explicit fixture stops before a downstream model task')
 }})
}
function sourceArtifact(f:Awaited<ReturnType<typeof captured>>){return db.productBuildArtifacts.where('buildId').equals(f.query.buildId).toArray().then(rows=>rows.find(row=>row.artifactKey===f.query.taskKey&&row.status==='accepted'))}

it('uses the exact booked original as separate authored source evidence, passes normal candidate/adoption with zero additional model POSTs, and keeps old terminals immutable',async()=>{
 const f=await booked(),oldOriginal=JSON.stringify(await readAgentRunV1(f.scope,f.query.runId)),oldCapture=JSON.stringify(await readAgentRunV1(f.scope,f.capture.runId)),worlds=JSON.stringify(await db.worldReleases.toArray()),calls=f.fake.fetch.mock.calls.length
 const cmd=await authorCommand(f),receipt=await submit(f,cmd);expect(receipt.ok).toBe(true)
 const source=receipt.result.originalResponseAuthorSource as {captured:{rawResponseHash:string};authorDraftHash:string;targetControlEpoch:number}
 expect(source.captured.rawResponseHash).toBe(f.capture.rawResponseHash);expect(source.authorDraftHash).toBe(await sha256Text(cmd.resolution.authorDraftJson))
 await runOnlySource(f)
 const accepted=(await sourceArtifact(f))!;expect(accepted).toBeTruthy()
 expect(JSON.parse(accepted.rightsJson)).toMatchObject({origin:'author-revised-model-draft',authorRevisionCommandId:cmd.commandId,
  originalResponseSourceHash:receipt.result.originalResponseAuthorSourceHash,originalResponseRawHash:f.capture.rawResponseHash,
  originalResponseCaptureReceiptHash:f.capture.receiptHash})
 const run=await readAgentRunV1(f.scope,accepted.producerRunId!)
 expect(run.events.some(row=>row.type==='model.requested')).toBe(false)
 expect(run.events.some(row=>row.type==='evidence.artifact.recorded'&&row.payload.contentHash===receipt.result.originalResponseAuthorSourceHash)).toBe(true)
 expect(run.run.status).toBe('completed');expect(run.events.some(row=>row.type==='candidate.persisted')).toBe(true)
 expect(accepted.producerReceiptHash).toBe(run.projection.terminalReceiptHash)
 const build=(await db.productBuilds.get(f.query.buildId))!,ledger=JSON.parse(build.budgetLedgerJson)
 expect(ledger.attempts.find((row:{runId:number})=>row.runId===accepted.producerRunId)).toMatchObject({usageKnown:true,usage:{modelCalls:0,inputTokens:0,outputTokens:0}})
 expect(ledgerAttempt(build,f.query.runId)).toMatchObject({usageKnown:true,usage:{modelCalls:1,inputTokens:101,outputTokens:11}})
 expect(f.fake.fetch.mock.calls.length).toBe(calls);expect(JSON.stringify(await readAgentRunV1(f.scope,f.query.runId))).toBe(oldOriginal)
 expect(JSON.stringify(await readAgentRunV1(f.scope,f.capture.runId))).toBe(oldCapture);expect(JSON.stringify(await db.worldReleases.toArray())).toBe(worlds)
},30000)

it('preserves the original model source across a rejected author revision and a second explicit author edit without re-fetching, inference or loss of the original charge',async()=>{
 const f=await booked(),draft=structuredClone(f.data.sourceFacts);draft.factPolicy.forEach(row=>{row.authorConfirmed=false})
 const first=await submit(f,await authorCommand(f,draft));expect(first.ok).toBe(true);await runOnlySource(f)
 const failed=(await db.productBuilds.get(f.query.buildId))!;expect(JSON.parse(failed.failureJson).code).toBe('task-draft-rejected')
 expect(await sourceArtifact(f)).toBeUndefined()
 const calls=f.fake.fetch.mock.calls.length,second=await submit(f,await authorCommand(f,f.data.sourceFacts,false,'fixture.author.retry.original'))
 expect(second.ok).toBe(true);expect(second.result.originalResponseAuthorSource).toMatchObject({previousAuthorSourceHash:first.result.originalResponseAuthorSourceHash,
  captured:{rawResponseHash:f.capture.rawResponseHash},authorRevisionCommandId:'fixture.author.retry.original'})
 await runOnlySource(f);const accepted=(await sourceArtifact(f))!
 expect(JSON.parse(accepted.rightsJson)).toMatchObject({originalResponseSourceHash:second.result.originalResponseAuthorSourceHash,originalResponseRawHash:f.capture.rawResponseHash})
 expect(f.fake.fetch.mock.calls.length).toBe(calls);expect(ledgerAttempt((await db.productBuilds.get(f.query.buildId))!,f.query.runId).usage).toMatchObject({modelCalls:1,inputTokens:101,outputTokens:11})
},30000)

it('rejects unbooked, wrong, malformed and mixed accounting references without changing the original recovery state',async()=>{
 const f=await captured(),cmd=await authorCommand(f),before=(await db.productBuilds.get(f.query.buildId))!,calls=f.fake.fetch.mock.calls.length
 await expect(submit(f,cmd)).rejects.toThrow('来源证明不是对象');expect(await db.productBuilds.get(f.query.buildId)).toEqual(before)
 for(const ref of [{captureRunId:0,captureReceiptHash:f.capture.receiptHash},{captureRunId:f.capture.runId,captureReceiptHash:'bad'},
  {captureRunId:f.capture.runId,captureReceiptHash:f.capture.receiptHash,actualUsage:{inputTokens:0}}]){
  expect(()=>parseProductProductionCommandV1({...cmd,resolution:{...cmd.resolution,originalResponseSource:ref}})).toThrow()
 }
 for(const action of ['retry','cancel','change-capability'])expect(()=>parseProductProductionCommandV1({...cmd,resolution:{action,note:'test',originalResponseSource:cmd.resolution.originalResponseSource}})).toThrow()
 expect((await f.book()).ok).toBe(true);const current=await authorCommand(f)
 await expect(submit(f,{...current,resolution:{...current.resolution,originalResponseSource:{captureRunId:f.capture.runId,captureReceiptHash:'f'.repeat(64)}}})).rejects.toThrow()
 await expect(submit(f,{...current,resolution:{...current.resolution,unknownResultReservation:{runId:f.query.runId,attempt:f.query.attempt,
  controlEpoch:f.build.controlEpoch,disposition:'confirmed-not-charged'}}} as never)).rejects.toThrow('不能同时')
 expect(f.fake.fetch.mock.calls.length).toBe(calls)
},30000)

it('fails closed on source-body corruption, unrelated Work or a stale native capture, without another local operation',async()=>{
 const f=await booked(),cmd=await authorCommand(f),before=(await db.productBuilds.get(f.query.buildId))!,calls=f.fake.fetch.mock.calls.length
 await expect(executeProductProductionCommand({scope:{...f.scope,workId:f.scope.workId!+1},productionId:f.productionId,command:cmd})).rejects.toThrow()
 const raw=(await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([f.scope.projectId,'raw-response',f.capture.rawResponseHash]).first())!
 await db.agentRunArtifacts.update(raw.id!,{content:'corrupted original with old hash'});await expect(submit(f,cmd)).rejects.toThrow()
 expect(await db.productBuilds.get(f.query.buildId)).toEqual(before);expect(f.fake.fetch.mock.calls.length).toBe(calls)
},30000)

it('rechecks command/raw/Run witnesses within the existing owner transaction',async()=>{
 const f=await booked(),cmd=await authorCommand(f),prepared=(await prepareProductProductionOriginalAuthorSourceV1({scope:f.scope,
  productionId:f.productionId,command:cmd,payloadHash:await sha256Text('fixture.payload'),now:Date.now()}))!
 const assert=()=>assertProductProductionOriginalAuthorSourceCurrentV1(prepared,prepared.production,prepared.build)
 await assert();const book=prepared.commands[0];await db.productProductionCommands.update(book.id!,{resultJson:'{}'})
 await expect(assert()).rejects.toThrow('原作者或记账回执');await db.productProductionCommands.put(book)
 const run=prepared.runs[0];await db.agentRuns.update(run.id!,{updatedAt:run.updatedAt+1});await expect(assert()).rejects.toThrow();await db.agentRuns.put(run)
 const body=prepared.artifacts[0];await db.agentRunArtifacts.update(body.id!,{retentionState:'evicted'});await expect(assert()).rejects.toThrow();await db.agentRunArtifacts.put(body);await assert()
},30000)

it('rolls back the source proof, epoch advance and revision if author command receipt persistence fails, and replays the first successful receipt without revalidating deleted local proof',async()=>{
 const f=await booked(),cmd=await authorCommand(f),before=(await db.productBuilds.get(f.query.buildId))!,update=db.productProductionCommands.update.bind(db.productProductionCommands)
 const spy=vi.spyOn(db.productProductionCommands,'update').mockImplementation(async(...args)=>{if((args[1] as {status?:string}).status==='succeeded')throw Error('fixture source command receipt failure');return update(...args)})
 await expect(submit(f,cmd)).rejects.toThrow('source command receipt failure');expect(await db.productBuilds.get(f.query.buildId)).toEqual(before)
 spy.mockRestore();const receipt=await submit(f,cmd);expect(receipt.ok).toBe(true)
 await db.agentRuns.delete(f.capture.runId)
 const replay=await submit(f,cmd);expect(replay).toMatchObject({ok:true,replayed:true,result:receipt.result})
},30000)

it('retains accepted authored material and its original raw/proof through the real backup lifecycle; pending imported source cannot regain local execution authority',async()=>{
 const f=await booked(),cmd=await authorCommand(f),receipt=await submit(f,cmd);expect(receipt.ok).toBe(true)
 const pending=(await db.productBuilds.get(f.query.buildId))!,{exportProjectJSON,importProjectJSON}=await import('../../src/lib/export/json-export')
 const pendingProject=await importProjectJSON(await exportProjectJSON(f.scope.projectId))
 const importedProd=(await db.productProductions.where('projectId').equals(pendingProject).toArray()).find(row=>row.productionKey===f.production.productionKey)!
 const importedBuild=(await db.productBuilds.where('productionId').equals(importedProd.id!).toArray()).find(row=>row.buildNumber===pending.buildNumber)!
 const calls=f.fake.fetch.mock.calls.length
 await expect(readProductProductionOriginalAuthorSourceForExecutionV1({scope:{projectId:pendingProject,worldId:importedProd.worldId,workId:importedProd.workId},productionId:importedProd.id!,build:{...importedBuild,id:importedBuild.id!},taskKey:f.query.taskKey})).rejects.toThrow()
 await runOnlySource(f);const accepted=(await sourceArtifact(f))!,acceptedProject=await importProjectJSON(await exportProjectJSON(f.scope.projectId))
 const prod=(await db.productProductions.where('projectId').equals(acceptedProject).toArray()).find(row=>row.productionKey===f.production.productionKey)!
 const build=(await db.productBuilds.where('productionId').equals(prod.id!).toArray()).find(row=>row.buildNumber===pending.buildNumber)!
 const copy=(await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()).find(row=>row.artifactKey===f.query.taskKey&&row.status==='accepted')!
 expect(copy.payloadJson).toBe(accepted.payloadJson);expect(copy.rightsJson).toBe(accepted.rightsJson)
 const raw=await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([acceptedProject,'raw-response',f.capture.rawResponseHash]).first()
 expect(raw?.content).toBe(f.fake.output)
 const proof=await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([acceptedProject,'source-snapshot',receipt.result.originalResponseAuthorSourceHash as string]).first()
 expect(proof?.content).toBeTruthy();expect(f.fake.fetch.mock.calls.length).toBe(calls)
},30000)

it('revalidates full Brief/Plan and exact current failed Plan before inheriting a retained source into another author revision',async()=>{
 const f=await booked(),draft=structuredClone(f.data.sourceFacts);draft.factPolicy.forEach(row=>{row.authorConfirmed=false})
 expect((await submit(f,await authorCommand(f,draft))).ok).toBe(true);await runOnlySource(f)
 const cmd=await authorCommand(f,f.data.sourceFacts,false,'fixture.author.hash-guard'),build=(await db.productBuilds.get(f.query.buildId))!
 const briefRow=(await db.productProductionBriefs.where('[productionId+revision]').equals([f.productionId,build.briefRevision]).first())!
 const modified=JSON.parse(briefRow.briefJson);modified.intent.userText+=' changed without a new authorized revision'
 await db.productProductionBriefs.update(briefRow.id!,{briefJson:JSON.stringify(modified)})
 await expect(submit(f,cmd)).rejects.toThrow();expect(await db.productBuilds.get(f.query.buildId)).toEqual(build)
 await db.productProductionBriefs.put(briefRow)
 const failure=JSON.parse(build.failureJson)
 await db.productBuilds.update(build.id!,{failureJson:JSON.stringify({...failure,failureProvenance:{...failure.failureProvenance,planHash:'f'.repeat(64)}})})
 await expect(submit(f,cmd)).rejects.toThrow('当前作者失败尝试')
 await db.productBuilds.put(build)
 const calls=f.fake.fetch.mock.calls.length;expect((await submit(f,cmd)).ok).toBe(true);await runOnlySource(f)
 expect(await sourceArtifact(f)).toBeTruthy();expect(f.fake.fetch.mock.calls.length).toBe(calls)
},30000)
