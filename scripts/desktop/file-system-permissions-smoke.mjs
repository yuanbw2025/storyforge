// Isolated Electron integration: real external directory handles and native
// permission requests, with OS confirmation answered by a controlled stub.
// This does not automate the native picker or prove a reporter's exact setup.
import { _electron as electron } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const profile = await mkdtemp(join(tmpdir(), 'storyforge-fsa-profile-'))
await mkdir('node_modules/.cache', { recursive: true })
const fixture = await mkdtemp(join(process.cwd(), 'node_modules/.cache/storyforge-fsa-'))
const directory = join(fixture, 'synthetic-directory')
await mkdir(directory)
await writeFile(join(directory, 'original.txt'), 'synthetic original')
const html = `<button id="request">Authorize</button><button id="write">Write fixture</button><div style="width:500px;height:400px">Drop</div><script>
window.events=[];document.ondragover=e=>e.preventDefault();document.ondrop=async e=>{e.preventDefault();window.handle=await e.dataTransfer.items[0].getAsFileSystemHandle()};
document.querySelector('#request').onclick=async()=>{events.push(await handle.requestPermission({mode:'readwrite'}))};
document.querySelector('#write').onclick=async()=>{const f=await handle.getFileHandle('explicit.txt',{create:true});const w=await f.createWritable();await w.write('explicit synthetic write');await w.close();events.push('written')};</script>`
const harness = join(profile, 'app.cjs')
await writeFile(harness, `const {app,BrowserWindow,session}=require('electron');const {createServer}=require('http');
app.setPath('userData',${JSON.stringify(join(profile, 'data'))});
app.whenReady().then(async()=>{const {installFileSystemPermissions}=await import(${JSON.stringify(new URL('./file-system-permissions.mjs', import.meta.url).href)});
const server=createServer((q,r)=>{r.setHeader('content-type','text/html');r.end(${JSON.stringify(html)})}).listen(0,'127.0.0.1',()=>{
const origin='http://127.0.0.1:'+server.address().port;const window=new BrowserWindow({show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
global.prompts=0;installFileSystemPermissions({session:session.defaultSession,window,origin,dialog:{showMessageBox:async()=>{global.prompts++;return {response:Number(process.env.FSA_TEST_RESPONSE)}}}});
window.loadURL(origin+'/storyforge/');});app.on('will-quit',()=>server.close());});`)
let app
try {
 for (const response of [0, 1]) {
  app = await electron.launch({ ...(process.env.STORYFORGE_ELECTRON_PATH ? { executablePath: process.env.STORYFORGE_ELECTRON_PATH } : {}), args: [harness], env: { ...process.env, FSA_TEST_RESPONSE: String(response) } })
  const page = await app.firstWindow()
  await page.waitForSelector('#request')
  const cdp = await page.context().newCDPSession(page)
  for (const type of /** @type {const} */ (['dragEnter', 'dragOver', 'drop'])) await cdp.send('Input.dispatchDragEvent', { type, x: 100, y: 100, data: { items: [], files: [directory], dragOperationsMask: 1 } })
  await page.waitForFunction('!!window.handle')
  await page.locator('#request').click()
  await page.waitForFunction('window.events.length === 1')
  assert.deepEqual(await page.evaluate('window.events'), [response ? 'granted' : 'denied'])
  assert.equal(await app.evaluate(() => Reflect.get(globalThis, 'prompts')), 1)
  assert.equal(await readFile(join(directory, 'original.txt'), 'utf8'), 'synthetic original')
  await assert.rejects(readFile(join(directory, 'explicit.txt')), { code: 'ENOENT' })
  if (response) {
   await page.locator('#write').click()
   await page.waitForFunction("window.events.includes('written')")
   assert.equal(await readFile(join(directory, 'explicit.txt'), 'utf8'), 'explicit synthetic write')
  }
  console.log(JSON.stringify({ response, runtime: await app.evaluate(() => process.versions.electron), actualFsaPermission: response ? 'granted' : 'denied', noWriteBeforeExplicitAction: true, nativeChooserAutomated: false, osConfirmationStubbed: true }))
  await app.evaluate(({ app }) => app.exit(0)); app = undefined
 }
} finally {
 if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
 await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
 await rm(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
