/* global window */
import assert from 'node:assert/strict'
/** Synthetic profile only. Exercise the real renderer-crash event and IPC, then recover.
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {import('@playwright/test').Page} page */
export async function verifyDiagnosticContext(app, page) {
  await page.goto('http://localhost:17831/storyforge/home/settings')
  const choice = page.getByLabel('附带最近操作轨迹（可选，默认关闭）')
  await choice.waitFor(); await choice.check()
  await page.evaluate(async () => {
    const client = /** @type {Window & {storyforgeClient?: {diagnosticContext?(v:unknown):Promise<void>}}} */ (window).storyforgeClient
    if (!client?.diagnosticContext) throw new Error('Missing native diagnostic context')
    await client.diagnosticContext({enabled:true,trail:[{at:new Date().toISOString(),area:'longform',action:'save',text:'PRIVATE-SYNTHETIC'}]})
  })
  const gone = await app.evaluate(({BrowserWindow}) => new Promise(resolve => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    contents.once('render-process-gone', (_event, details) => resolve({reason:details.reason,exitCode:details.exitCode}))
    contents.forcefullyCrashRenderer()
  }))
  assert.equal(gone.reason, 'crashed')
  await page.reload(); await choice.waitFor()
  const rows = await page.evaluate(async () => {
    const client = /** @type {Window & {storyforgeClient?: {diagnostics?():Promise<unknown[]>}}} */ (window).storyforgeClient
    return await client?.diagnostics?.() ?? []
  })
  const row = /** @type {{name?:string,details?:{trail?:{action:string}[],native?:{process:string,reason:string,exitCode:number}}}|undefined} */ (rows.find(value => value && typeof value === 'object' && 'name' in value && value.name === 'NativeCrash'))
  assert.ok(row?.details?.native)
  assert.equal(row.details.native.process, 'renderer'); assert.equal(row.details.native.reason, 'crashed')
  assert.equal(row.details.native.exitCode, gone.exitCode)
  assert.ok(row.details.trail?.some(step => step.action === 'save'))
  assert.equal(JSON.stringify(rows).includes('PRIVATE-SYNTHETIC'), false)
  await choice.uncheck()
  await page.waitForFunction(async () => {
    const client = /** @type {Window & {storyforgeClient?: {diagnostics?():Promise<unknown[]>}}} */ (window).storyforgeClient
    const rows = await client?.diagnostics?.() ?? []
    return rows.every(value => value && typeof value === 'object' && !('details' in value))
  })
  console.log('Native diagnostic context: real isolated renderer crash, bounded prior action, reason/exit code, reload and opt-out cleanup passed; no model or report upload.')
}
