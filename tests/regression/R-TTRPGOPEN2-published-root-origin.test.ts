import {beforeAll,beforeEach,afterEach,expect,it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {seedOpenBrowserProductionV1,runOpenBrowserProductionV1} from '../helpers/open-ttrpg-production-browser'
import {publishProductProductionV1,recoverImportedProductProductionProofsV1} from '../../src/lib/product-production/service'
import {exportProjectJSON,importProjectJSON} from '../../src/lib/export/json-export'
import {readAgentRunV1} from '../../src/lib/agent/run/event-store'
import {hashProductProductionValueV2 as hash} from '../../src/lib/product-production/hash'
import {comparePublishedRootLedgerRebindingV1,assertPortablePublishedRootOriginV1,verifyImportedPublishedRootOriginV1,freezePublishedRootOriginForExportV1} from '../../src/lib/product-production/published-root-origin'
let backup: Awaited<ReturnType<typeof exportProjectJSON>>,key:string
let f: {scope:{projectId:number;worldId:number;workId:number};productionId:number},buildId:number,rootId:number
beforeAll(async()=>{
 await db.delete();await db.open();const source=await seedOpenBrowserProductionV1()
 await runOpenBrowserProductionV1(source);await runOpenBrowserProductionV1(source,true);await runOpenBrowserProductionV1(source,true);await publishProductProductionV1(source)
 key=(await db.productProductions.get(source.productionId))!.productionKey
 backup=await exportProjectJSON(source.scope.projectId);db.close()
},60000)
beforeEach(async()=>{
 await db.delete();await db.open();await importProjectJSON(backup)
 const projectId=await importProjectJSON(backup),p=(await db.productProductions.where('projectId').equals(projectId).toArray()).find(p=>p.productionKey===key)!
 f={scope:{projectId,worldId:p.worldId,workId:p.workId},productionId:p.id!}
 const b=(await db.productBuilds.where('productionId').equals(p.id!).first())!;buildId=b.id!;rootId=JSON.parse(b.budgetLedgerJson).rootRunId
},60000)
afterEach(()=>db.close())
async function context(){
 const production=(await db.productProductions.get(f.productionId))!,build=(await db.productBuilds.get(buildId))!,root=await readAgentRunV1(f.scope,rootId)
 const artifacts=(await db.productBuildArtifacts.where('buildId').equals(buildId).toArray()).filter(r=>r.controlEpoch===build.controlEpoch&&['accepted','carried-forward'].includes(r.status))
 return {scope:f.scope,production,build:{...build,id:build.id!},root,receiptInput:{planHash:build.planHash,manifestHash:build.manifestHash,packageHash:build.packageHash,qualityReportHash:build.qualityReportHash,controlEpoch:build.controlEpoch,budgetLedgerJson:build.budgetLedgerJson,artifacts}}
}
it('repeated real colliding import retains original proof and all published rows, with idempotent recovery',async()=>{
 const c=await context(),original=await assertPortablePublishedRootOriginV1(c.root.run.portablePublishedRootOriginJson!)
 expect(JSON.parse(c.build.budgetLedgerJson).rootRunId).not.toBe((original.body.budgetLedger as {rootRunId:number}).rootRunId)
 const release=await db.productReleases.get(c.build.releasedProductReleaseId!)
 expect(await verifyImportedPublishedRootOriginV1(c)).toBe(true)
 expect((await recoverImportedProductProductionProofsV1(f)).terminal).toBe(true)
 expect((await recoverImportedProductProductionProofsV1(f)).terminal).toBe(true)
 expect(await db.productBuilds.get(buildId)).toEqual(c.build);expect(await db.productProductions.get(f.productionId)).toEqual(c.production);expect(await db.productReleases.get(release!.id!)).toEqual(release)
 const projectId=await importProjectJSON(await exportProjectJSON(f.scope.projectId)),p=(await db.productProductions.where('projectId').equals(projectId).toArray()).find(p=>p.productionKey===key)!
 const next={scope:{projectId,worldId:p.worldId,workId:p.workId},productionId:p.id!},b=(await db.productBuilds.where('productionId').equals(p.id!).first())!,id=JSON.parse(b.budgetLedgerJson).rootRunId
 expect(id).not.toBe(rootId);expect((await db.agentRuns.get(id))!.portablePublishedRootOriginJson).toBe(c.root.run.portablePublishedRootOriginJson)
 expect((await recoverImportedProductProductionProofsV1(next)).terminal).toBe(true);expect(await db.productBuilds.get(b.id!)).toEqual(b)
},60000)
it.each(['cost','tokens','attempt','resolution','aliases'] as const)('rejects changed historical ledger %s without rewriting any released row',async kind=>{
 const c=await context(),ledger=JSON.parse(c.build.budgetLedgerJson),entry=Object.values(ledger.tasks)[0] as Record<string,any>
 if(kind==='cost')ledger.attempts[0].usage.costUsd=1
 if(kind==='tokens')ledger.attempts[0].usage.inputTokens++
 if(kind==='attempt')ledger.attempts[0].attempt++
 if(kind==='resolution')ledger.attempts[0].resolution={kind:'fabricated'}
 if(kind==='aliases')entry.runId=ledger.rootRunId
 await expect(verifyImportedPublishedRootOriginV1({...c,receiptInput:{...c.receiptInput,budgetLedgerJson:JSON.stringify(ledger)}})).rejects.toThrow()
 expect(await db.productBuilds.get(buildId)).toEqual(c.build);expect(await db.productProductions.get(f.productionId)).toEqual(c.production)
})
it('rejects a proof copied onto a live completed prefix without its actual import stale event',async()=>{
 const c=await context(),events=c.root.events.filter(e=>e.type!=='verification.staled')
 await expect(verifyImportedPublishedRootOriginV1({...c,root:{...c.root,events}})).rejects.toThrow('真实导入')
})
it.each(['metadataJson','rightsJson','payloadJson'] as const)('rejects modified artifact %s even when contentHash is retained',async field=>{
 const c=await context(),artifacts=c.receiptInput.artifacts.map((r,i)=>i===0?{...r,[field]:'{"tampered":true}'}:r)
 await expect(verifyImportedPublishedRootOriginV1({...c,receiptInput:{...c.receiptInput,artifacts}})).rejects.toThrow('envelope')
})
it('rejects a foreign actual run despite a syntactically valid bijective ledger',async()=>{
 const c=await context(),ledger=JSON.parse(c.build.budgetLedgerJson),task=Object.values(ledger.tasks)[0] as {runId:number},run=(await db.agentRuns.get(task.runId))!
 await db.agentRuns.update(run.id!,{productBuildId:buildId+1000})
 await expect(verifyImportedPublishedRootOriginV1(c)).rejects.toThrow()
 expect(await db.productBuilds.get(buildId)).toEqual(c.build)
})
it('rejects corrupt proof or unknown extra fields, and never fabricates missing evidence',async()=>{
 const c=await context(),proof=JSON.parse(c.root.run.portablePublishedRootOriginJson!)
 proof.body.budgetLedger.rootRunId++
 await expect(assertPortablePublishedRootOriginV1(JSON.stringify(proof))).rejects.toThrow('hash')
 await expect(assertPortablePublishedRootOriginV1(JSON.stringify({...JSON.parse(c.root.run.portablePublishedRootOriginJson!),extra:true}))).rejects.toThrow('字段')
 expect(await verifyImportedPublishedRootOriginV1({...c,root:{...c.root,run:{...c.root.run,portablePublishedRootOriginJson:undefined}}})).toBe(false)
})
it('normalizes only registered refs and validates keyed-map aliases and keys',()=>{
 const source={rootRunId:1,tasks:{a:{runId:2,attempt:1}},attempts:[{runId:2,attempt:1}],charges:{'2:1':{runId:2,attempt:1,cost:3}},reservations:{'2:1':{runId:2,attempt:1,cost:4}}}
 const current={rootRunId:10,tasks:{a:{runId:20,attempt:1}},attempts:[{runId:20,attempt:1}],charges:{'20:1':{runId:20,attempt:1,cost:3}},reservations:{'20:1':{runId:20,attempt:1,cost:4}}}
 expect([...comparePublishedRootLedgerRebindingV1(source,current)].sort((a,b)=>a[0]-b[0])).toEqual([[1,10],[2,20]])
 expect(()=>comparePublishedRootLedgerRebindingV1(source,{...current,attempts:[{runId:10,attempt:1}]})).toThrow('双射')
 expect(()=>comparePublishedRootLedgerRebindingV1(source,{...current,charges:{'wrong:1':{runId:20,attempt:1,cost:3}}})).toThrow('keyed')
 expect(()=>comparePublishedRootLedgerRebindingV1({...source,opaqueId:1},{...current,opaqueId:10})).toThrow('opaqueId')
})
it('binds the original complete hash, including attempts beyond the portable settled-task projection',async()=>{
 const c=await context(),proof=await assertPortablePublishedRootOriginV1(c.root.run.portablePublishedRootOriginJson!)
 expect(await hash(proof.body)).toBe(c.build.rootTerminalReceiptHash)
 const body=structuredClone(proof.body) as any;body.budgetLedger.attempts[0].usage.outputTokens++
 expect(await hash(body)).not.toBe(c.build.rootTerminalReceiptHash)
})

it.each(['legacy-v1','unproven-v2'] as const)('retains source data without inventing a published V2 proof for %s',async kind=>{
 // This isolated fixture deliberately has an unproven historical Build pointer;
 // it tests backup preservation, never publication authority for that pointer.
 const source=await seedOpenBrowserProductionV1()
 await runOpenBrowserProductionV1(source);await runOpenBrowserProductionV1(source,true);await runOpenBrowserProductionV1(source,true);await publishProductProductionV1(source)
 const build=(await db.productBuilds.where('productionId').equals(source.productionId).first())!,id=JSON.parse(build.budgetLedgerJson).rootRunId
 let rootHash='f'.repeat(64)
 if(kind==='legacy-v1'){
  const {createLegacyProductBuildRootTerminalReceiptV1}=await import('../../src/lib/product-production/receipts')
  const artifacts=(await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()).filter(row=>row.controlEpoch===build.controlEpoch&&['accepted','carried-forward'].includes(row.status))
  rootHash=await createLegacyProductBuildRootTerminalReceiptV1({planHash:build.planHash,manifestHash:build.manifestHash,packageHash:build.packageHash,qualityReportHash:build.qualityReportHash,controlEpoch:build.controlEpoch,budgetLedgerJson:build.budgetLedgerJson,artifacts})
 }
 await db.productBuilds.update(build.id!,{rootTerminalReceiptHash:rootHash})
 const before=await db.productBuilds.get(build.id!)
 expect(await freezePublishedRootOriginForExportV1(id)).toBeUndefined()
 expect(await db.productBuilds.get(build.id!)).toEqual(before)
 expect((await db.agentRuns.get(id))!.portablePublishedRootOriginJson).toBeUndefined()
},60000)
