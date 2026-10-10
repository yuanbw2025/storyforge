import JSZip from 'jszip'
import { parseAgentRunContractV1 } from '../../src/lib/agent/run/contract'
import { readFile } from 'node:fs/promises'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { activePackages, enablePackage, extensionScope, installPackage } from '../../src/lib/extensions/store'
import { connectExtensionMcp } from '../../src/lib/extensions/mcp-client'
import { executeExtensionTool, previewExtensionTool, readExtensionToolRun, refreshExtensionToolRun } from '../../src/lib/extensions/mcp-run'
import type { ExtensionConnector, ExtensionReviewRequest } from '../../src/lib/extensions/types'
import { deriveExportProjectJSON } from '../../src/lib/export/registry-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import { domainScope } from '../../src/lib/extensions/domain'

beforeEach(async()=>{await db.delete();await db.open()})
afterEach(()=>db.close())
function server(protocol:'2026-07-28'|'legacy', task=false) {
 const calls: {method:string;params?:Record<string,unknown>}[]=[], headers:Headers[]=[]
 let remoteStatus='working'
 const taskData=()=>({taskId:'task-sf-1',createdAt:'2026-10-08T00:00:00Z',lastUpdatedAt:'2026-10-08T00:00:01Z',ttlMs:600000,status:remoteStatus})
 const fetcher:typeof fetch=async(_url,init)=>{
  headers.push(new Headers(init?.headers))
  if(init?.method==='GET')return new Response(null,{status:405})
  const request=JSON.parse(String(init?.body));calls.push(request)
  if(request.id==null)return new Response(null,{status:202})
  let result:unknown
  const capabilities={tools:{},...(task?(protocol==='legacy'?{tasks:{requests:{tools:{call:{}}},cancel:{}}}:{extensions:{'io.modelcontextprotocol/tasks':{}}}):{})}
  if(request.method==='server/discover')result={supportedVersions:['2026-07-28'],capabilities,serverInfo:{name:'isolated',version:'1.0.0'}}
  else if(request.method==='initialize')result={protocolVersion:'2025-11-25',capabilities,serverInfo:{name:'isolated',version:'1.0.0'}}
  else if(request.method==='tools/list')result={...(protocol==='legacy'?{}:{resultType:'complete',ttlMs:0,cacheScope:'private'}),tools:[{name:'lookup',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false},...(task?{execution:{taskSupport:'optional'}}:{})}]}
  else if(request.method==='tools/call')result=task?(protocol==='legacy'?{task:{...taskData(),ttl:600000}}:{...taskData(),resultType:'task'}):{...(protocol==='legacy'?{}:{resultType:'complete'}),content:[{type:'text',text:'已找到灯塔资料'}]}
  else if(request.method==='tasks/result')result={content:[{type:'text',text:'长任务资料'}]}
  else if(request.method==='tasks/get')result=protocol==='legacy'?{...taskData(),ttl:600000}:{...taskData(),resultType:'complete',...(remoteStatus==='completed'?{result:{resultType:'complete',content:[{type:'text',text:'长任务资料'}]}}:{})}
  else if(request.method==='tasks/cancel'){remoteStatus='cancelled';result={...taskData(),resultType:'complete'}}
  else throw new Error(`unexpected ${request.method}`)
  return Response.json({jsonrpc:'2.0',id:request.id,result})
 }
 return {fetcher,calls,headers,complete:()=>{remoteStatus='completed'}}
}
async function setup(protocol:'2026-07-28'|'legacy'='2026-07-28'){const created=await createWorkspace({name:'MCP 验证',description:'',genres:[],status:'drafting',targetWordCount:30000},{purpose:'independent-work',kind:'novel',novelProfile:'long'});const scope=await extensionScope(created.project.id!,'work');const bytes=await readFile('public/workshop/packages/storyforge.tool-desk-1.0.0.sfplugin');const zip=await JSZip.loadAsync(bytes);const manifest=JSON.parse(await zip.file('manifest.json')!.async('string'));manifest.connectors[0].protocol=protocol;zip.file('manifest.json',JSON.stringify(manifest));const pkg=await installPackage(await zip.generateAsync({type:'arraybuffer'}));await enablePackage(pkg,scope);const [{profile}]=await activePackages(scope);const request:ExtensionReviewRequest={scope,profileId:profile.id,pluginId:pkg.pluginId,digest:pkg.digest,kind:'tool',connectorId:'local',tool:'lookup',toolInput:{query:'灯塔'},instruction:''};return{request,created}}
describe('official MCP adapter and durable tool execution',()=>{
 it.each([false,true])('imports tool results and task IDs as read-only history without contacting the original task (task=%s)',async(task)=>{
  const {request,created}=await setup(),preview=await previewExtensionTool(request),fixture=server('2026-07-28',task)
  const connection=await connectExtensionMcp(preview.checkpoint.connector,{fetch:fixture.fetcher})
  try{
   await executeExtensionTool(request,preview.hash,connection)
   const imported=await deriveImportProjectJSON(await deriveExportProjectJSON(created.project.id!))
   const scope=await domainScope((await db.extensionProfiles.where('projectId').equals(imported).toArray())[0]),run=(await db.agentRuns.where('projectId').equals(imported).toArray())[0]
   const history=await readExtensionToolRun(scope,run.id!);expect(history.historicalOnly).toBe(true);if(task)expect(history.checkpoint.reference?.taskId).toBe('task-sf-1');else expect(history.checkpoint.result).toMatchObject({content:[{text:'已找到灯塔资料'}]})
   const count=fixture.calls.length
   await expect(refreshExtensionToolRun(scope,run.id!,connection)).rejects.toThrow('历史副本')
   await expect(refreshExtensionToolRun(scope,run.id!,connection,true)).rejects.toThrow('历史副本')
   expect(fixture.calls).toHaveLength(count)
  }finally{await connection.close()}
 })
 for(const protocol of ['2026-07-28','legacy'] as const)it(`negotiates ${protocol}, limits tools, omits Apps and sends the host token only as authorization`,async()=>{
  const fixture=server(protocol),connector:ExtensionConnector={id:'x',title:'test',url:'https://tools.invalid/mcp',protocol,tools:['lookup']}
  const connection=await connectExtensionMcp(connector,{token:'host-only-test-token',fetch:fixture.fetcher})
  try{expect(connection.tools.map(tool=>tool.name)).toEqual(['lookup']);expect(connection.capabilities.apps).toBe(false);expect(connection.capabilities.tasks.execution).toBe(false);expect(fixture.calls[0].method).toBe(protocol==='legacy'?'initialize':'server/discover');expect(fixture.headers.every(header=>header.get('authorization')==='Bearer host-only-test-token')).toBe(true);expect(JSON.stringify(fixture.calls)).not.toContain('host-only-test-token')}finally{await connection.close()}
 })
 it('persists one immediate tool result with a terminal receipt; invalid input is rejected before dispatch',async()=>{
  const {request,created}=await setup(),preview=await previewExtensionTool(request),fixture=server('2026-07-28'),connection=await connectExtensionMcp(preview.checkpoint.connector,{fetch:fixture.fetcher})
  try{const run=await executeExtensionTool(request,preview.hash,connection);expect(run.projection.state).toBe('completed');expect(run.contract.budget.maxModelCalls).toBe(0);expect(()=>parseAgentRunContractV1({...run.contract,permissions:{contextSourceKeys:['storyCore'],writeTargets:[]}})).toThrow('零模型');expect(()=>parseAgentRunContractV1({...run.contract,budget:{...run.contract.budget,maxModelCalls:1}})).toThrow();expect(run.projection.terminalReceiptHash).toMatch(/^[a-f0-9]{64}$/);expect((await readExtensionToolRun(created.scope,run.run.id)).checkpoint.result).toMatchObject({content:[{text:'已找到灯塔资料'}]});expect(fixture.calls.filter(call=>call.method==='tools/call')).toHaveLength(1);const invalid={...request,toolInput:{query:12}};await expect(executeExtensionTool(invalid,(await previewExtensionTool(invalid)).hash,connection)).rejects.toThrow('输入格式');expect(fixture.calls.filter(call=>call.method==='tools/call')).toHaveLength(1)}finally{await connection.close()}
 })
 for(const protocol of ['2026-07-28','legacy'] as const)it(`retains ${protocol} external task reference across reconnection and never repeats tools/call`,async()=>{
  const {request,created}=await setup(protocol),preview=await previewExtensionTool(request),fixture=server(protocol,true)
  const first=await connectExtensionMcp(preview.checkpoint.connector,{fetch:fixture.fetcher})
  const run=await executeExtensionTool(request,preview.hash,first);expect(run.projection.state).toBe('paused');expect((await readExtensionToolRun(created.scope,run.run.id)).checkpoint.reference?.taskId).toBe('task-sf-1');await first.close()
  fixture.complete();const second=await connectExtensionMcp(preview.checkpoint.connector,{fetch:fixture.fetcher})
  try{const done=await refreshExtensionToolRun(created.scope,run.run.id,second);expect(done.projection.state).toBe('completed');expect((await readExtensionToolRun(created.scope,run.run.id)).checkpoint.result).toMatchObject({content:[{text:'长任务资料'}]});expect(fixture.calls.filter(call=>call.method==='tools/call')).toHaveLength(1)}finally{await second.close()}
 })
 it('does not silently retry an unknown result, and rejects recovery without an external ID',async()=>{
  const {request,created}=await setup(),preview=await previewExtensionTool(request),fixture=server('2026-07-28');let calls=0
  const connection=await connectExtensionMcp(preview.checkpoint.connector,{fetch:async(input,init)=>{if(init?.body&&JSON.parse(String(init.body)).method==='tools/call'){calls++;throw new TypeError('network dropped')}return fixture.fetcher(input,init)}})
  try{await expect(executeExtensionTool(request,preview.hash,connection)).rejects.toThrow();expect(calls).toBe(1);const run=(await db.agentRuns.toArray())[0];expect(run.status).toBe('paused');await expect(refreshExtensionToolRun(created.scope,run.id!,connection)).rejects.toThrow('不会重发');expect(calls).toBe(1)}finally{await connection.close()}
 })
 it('cancels a known task without replay and leaves a terminal cancellation event',async()=>{
  const {request,created}=await setup(),preview=await previewExtensionTool(request),fixture=server('2026-07-28',true),connection=await connectExtensionMcp(preview.checkpoint.connector,{fetch:fixture.fetcher})
  try {const run=await executeExtensionTool(request,preview.hash,connection);const stopped=await refreshExtensionToolRun(created.scope,run.run.id,connection,true);expect(stopped.projection.state).toBe('cancelled');expect(fixture.calls.filter(call=>call.method==='tools/call')).toHaveLength(1);expect(fixture.calls.filter(call=>call.method==='tasks/cancel')).toHaveLength(1)}finally{await connection.close()}
 })

})
