/* global window */
import assert from 'node:assert/strict'
/** Synthetic profile only. Exercise the real renderer-crash event and IPC, then recover.
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {import('@playwright/test').Page} page
 * @param {() => Promise<import('@playwright/test').ElectronApplication>} launch */
export async function verifyDiagnosticContext(app, page, launch) {
  await page.goto('http://localhost:17831/storyforge/home/settings')
  const choice = page.getByLabel('附带最近操作轨迹（可选，默认关闭）')
  await choice.waitFor(); await choice.check()
  await page.evaluate(async () => {
    const client = /** @type {Window & {storyforgeClient?: {diagnosticContext?(v:unknown):Promise<void>}}} */ (window).storyforgeClient
    if (!client?.diagnosticContext) throw new Error('Missing native diagnostic context')
    await client.diagnosticContext({enabled:true,trail:[{at:new Date().toISOString(),area:'longform',action:'save',text:'PRIVATE-SYNTHETIC'}]})
  })
  // Await the handle so the main-process listener is installed before the CDP
  // command can crash the renderer. The event may arrive before we read result.
  const observed = await app.evaluateHandle(({BrowserWindow}) => {
    /** @type {Promise<{reason:string,exitCode:number}>} */
    const result = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Renderer crash event was not observed within 60 seconds')), 60_000)
      BrowserWindow.getAllWindows()[0].webContents.once('render-process-gone', (_event, details) => {
        clearTimeout(timeout)
        resolve({reason:details.reason,exitCode:details.exitCode})
      })
    })
    return {result}
  })
  if (process.platform === 'linux') {
    // Page.crash can leave the sandboxed Arch renderer alive without an exit
    // event. Send a fatal signal to this isolated test window's exact OS PID.
    // SIGABRT exercises a real crash; SIGKILL/forcefullyCrashRenderer may instead
    // report `killed`, which must not be mislabeled or accepted as a crash.
    const pid = await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.getOSProcessId())
    assert.ok(Number.isInteger(pid) && pid > 1 && pid !== app.process().pid && pid !== process.pid)
    process.kill(pid, 'SIGABRT')
  } else {
    const session = await page.context().newCDPSession(page)
    void session.send('Page.crash').catch(() => {})
  }
  const gone = await observed.evaluate(state => state.result).finally(() => observed.dispose())
  assert.equal(gone.reason, 'crashed')
  const stopped = new Promise(resolve => app.process().once('exit', () => resolve(undefined)))
  await app.evaluate(({app}) => app.exit(0))
  await stopped
  app = await launch(); page = await app.firstWindow()
  await page.waitForSelector('#root main, #root button', {timeout:60000})
  await page.goto('http://localhost:17831/storyforge/home/settings')
  const restartedChoice = page.getByLabel('附带最近操作轨迹（可选，默认关闭）')
  await restartedChoice.waitFor()
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
  await restartedChoice.uncheck()
  await page.waitForFunction(async () => {
    const client = /** @type {Window & {storyforgeClient?: {diagnostics?():Promise<unknown[]>}}} */ (window).storyforgeClient
    const rows = await client?.diagnostics?.() ?? []
    return rows.every(value => value && typeof value === 'object' && !('details' in value))
  })
  console.log('Native diagnostic context: real isolated renderer crash, bounded prior action, reason/exit code, reload and opt-out cleanup passed; no model or report upload.')
  return { app, page }
}
