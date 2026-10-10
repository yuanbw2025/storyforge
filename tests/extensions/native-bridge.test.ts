// @vitest-environment node
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'
import { expect, it } from 'vitest'
import { startBridge } from '../../tools/mcp-bridge/bridge.mjs'

it('optional bridge launches only configured stdio, pairs exact origin, routes concurrent IDs and denies undeclared tools',async()=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'sf-mcp-bridge-test-'))
 const fixture=path.join(folder,'server.mjs')
 await writeFile(fixture,`import {createInterface} from 'node:readline';import process from 'node:process';createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);setTimeout(()=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{resultType:'complete',content:[{type:'text',text:q.params?.arguments?.query??'fixture'}]}})+'\\n'),q.params?.arguments?.query==='first'?10:0)})`)
 const token='test-token-with-more-than-thirty-two-chars'
 const bridge=await startBridge({origin:'http://127.0.0.1:4186',token,port:0,servers:{reference:{command:process.execPath,args:[fixture],tools:['lookup']}}})
 const address=`http://127.0.0.1:${bridge.port}/mcp/reference`
 const call=(id:number,query:string,overrides:Record<string,string>={})=>fetch(address,{method:'POST',headers:{Origin:'http://127.0.0.1:4186',Authorization:`Bearer ${token}`,'Content-Type':'application/json',...overrides},body:JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name:'lookup',arguments:{query}}})})
 try{
  expect((await call(1,'x',{Origin:'https://foreign.invalid'})).status).toBe(403)
  expect((await call(1,'x',{Authorization:'Bearer wrong'})).status).toBe(401)
  const values=await Promise.all([call(10,'first').then(r=>r.json()),call(11,'second').then(r=>r.json())])
  expect(values.map(value=>[value.id,value.result.content[0].text])).toEqual([[10,'first'],[11,'second']])
  const denied=await fetch(address,{method:'POST',headers:{Origin:'http://127.0.0.1:4186',Authorization:`Bearer ${token}`},body:JSON.stringify({jsonrpc:'2.0',id:12,method:'tools/call',params:{name:'shell',arguments:{command:'never'}}})})
  expect(denied.status).toBe(400)
 }finally{await bridge.close();await rm(folder,{recursive:true,force:true})}
},15000)
