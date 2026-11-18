import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// Source red: the release's installed callback must not reject every directory
// request after the author has chosen it. No native UI or user data is touched.
test('the installed desktop policy handles fileSystem directory requests', () => {
 const source=readFileSync(new URL('./main.mjs',import.meta.url),'utf8')
 const legacy=source.match(/setPermissionRequestHandler\(([^\n]+)\)/)?.[1]
 if(legacy){
  const callback=vm.runInNewContext('('+legacy+')');let granted
  callback({},'fileSystem',/** @param {boolean} value */ value=>{granted=value},{isDirectory:true,fileAccessType:'writable'})
  assert.notEqual(granted,false,'Every directory permission is denied by the installed callback')
 }else assert.match(source,/installFileSystemPermissions\(/)
})

import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { installFileSystemPermissions } from './file-system-permissions.mjs'
function fixture() {
 /** @typedef {(requester:unknown,permission:string,callback:(value:boolean)=>void,details:Record<string,unknown>)=>void} RequestHandler */
 /** @type {RequestHandler} */
 let request=()=>{throw Error('Permission handler not installed')}
 const session=Object.assign(new EventEmitter(),{setPermissionRequestHandler:/** @param {RequestHandler} fn */ fn=>{request=fn}})
 const frame={url:'http://localhost:17831/storyforge/settings',frames:/** @type {unknown[]} */ ([])}
 const contents=Object.assign(new EventEmitter(),{mainFrame:frame,isDestroyed:()=>false});const window={webContents:contents,isDestroyed:()=>false}
 /** @type {[unknown,{cancelId:number,defaultId:number}][]} */
 const prompts=[];let answer=0;let fail=false
 /** @type {undefined|(()=>Promise<{response:number}>)} */
 let respond
 const dialog={showMessageBox:async (/** @type {[unknown,{cancelId:number,defaultId:number}]} */ ...args)=>{prompts.push(args);if(fail)throw Error('system error');return respond?await respond():{response:answer}}}
 installFileSystemPermissions(/** @type {Parameters<typeof installFileSystemPermissions>[0]} */ (/** @type {unknown} */ ({session,window,dialog,origin:'http://localhost:17831'})))
 const details={requestingUrl:frame.url,isMainFrame:false,isDirectory:true,filePath:join(tmpdir(),'synthetic-project'),fileAccessType:'writable'}
 return {session,frame,contents,window,prompts,details,allow:()=>{answer=1},fail:()=>{fail=true},defer:/** @param {()=>Promise<{response:number}>} fn */ fn=>{respond=fn},
  request:(permission='fileSystem',/** @type {Record<string,unknown>} */ d=details,/** @type {unknown} */ c=contents)=>new Promise(resolve=>request(c,permission,resolve,d)),
  restricted:(/** @type {{origin:string,webContents:unknown,frame:unknown}} */ d={origin:'http://localhost:17831',webContents:contents,frame})=>new Promise(resolve=>session.emit('file-system-access-restricted',{},d,resolve))}
}
test('author confirmation gates directory access; cancel defaults to denial',async()=>{
 const f=fixture();assert.equal(await f.request(),false);f.allow();assert.equal(await f.request(),true)
 assert.equal(f.prompts.length,2);assert.equal(f.prompts[0][1].cancelId,0);assert.equal(f.prompts[0][1].defaultId,0)
 assert.equal(await f.request('fileSystem',{...f.details,fileAccessType:'readable'}),true)
})
test('foreign windows, origins, paths, missing metadata and child documents never prompt',async()=>{
 const f=fixture();f.allow()
 assert.equal(await f.request('fileSystem',f.details,{}),false)
 for(const patch of [{requestingUrl:'https://example.com/storyforge/'},{requestingUrl:'http://localhost:17831/storyforge-evil/'},{requestingUrl:'http://localhost:17831/storyforge/'},{requestingUrl:'http://user@localhost:17831/storyforge/settings'},{isDirectory:false},{fileAccessType:'unknown'},{filePath:'relative'}])assert.equal(await f.request('fileSystem',{...f.details,...patch}),false)
 assert.equal(await f.request('fileSystem',{}),false)
 f.frame.frames=[{}];assert.equal(await f.request(),false);assert.equal(f.prompts.length,0)
})
test('unrelated permissions retain denial and existing persistent-storage remains supported',async()=>{
 const f=fixture();for(const p of ['media','notifications','openExternal','unknown'])assert.equal(await f.request(p),false)
 assert.equal(await f.request('persistent-storage'),true);assert.equal(f.prompts.length,0)
})
test('navigation while OS approval is open invalidates the answer',async()=>{
 const f=fixture();
 /** @type {(value:{response:number})=>void} */
 let complete=()=>{throw Error('Prompt did not start')};f.defer(()=>new Promise(resolve=>{complete=resolve}));const result=f.request()
 f.frame.url='http://localhost:17831/storyforge/other';complete({response:1});assert.equal(await result,false)
})
test('destroyed window and failed OS prompt deny without granting or writing',async()=>{
 const f=fixture();f.fail();assert.equal(await f.request(),false);f.window.isDestroyed=()=>true;assert.equal(await f.request(),false)
})
test('restricted paths can only reselect or cancel, never bypass protection',async()=>{
 const f=fixture();assert.equal(await f.restricted(),'tryAgain');f.allow();assert.equal(await f.restricted(),'deny')
 assert.equal(await f.restricted({origin:'https://example.com',webContents:f.contents,frame:f.frame}),'deny')
 assert.equal(await f.restricted({origin:'http://localhost:17831',webContents:f.contents,frame:{url:f.frame.url}}),'deny')
 f.fail();assert.equal(await f.restricted(),'deny')
})

test('a same-URL navigation cannot reuse an earlier OS confirmation',async()=>{
 const f=fixture();
 /** @type {(value:{response:number})=>void} */
 let complete=()=>{throw Error('Prompt did not start')};f.defer(()=>new Promise(resolve=>{complete=resolve}));const result=f.request()
 f.contents.emit('did-start-navigation',{},f.frame.url,false,true);complete({response:1});assert.equal(await result,false)
})
