/* global window */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { buildDiagnosticOptOutFixture } from './diagnostic-fixture.mjs'
/** Synthetic profile only. Exercise the real renderer-crash event and IPC, then recover.
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {import('@playwright/test').Page} page
 * @param {() => Promise<import('@playwright/test').ElectronApplication>} launch */
export async function verifyDiagnosticContext(app, page, launch) {
  await page.goto('http://localhost:17831/storyforge/home/settings')
  await page.getByRole('region', { name: '问题与故障反馈' }).waitFor()
  assert.equal(await page.getByLabel('附带最近操作轨迹（可选，默认关闭）').count(), 0)
  assert.equal(await page.evaluate(() => localStorage.getItem('storyforge-diagnostic-context-v1')), null)
  // Use the installed operation collector: a direct IPC fixture can be replaced
  // by a later real UI update. Button content must never enter the stored trail.
  await page.evaluate(() => {
    const button = window.document.createElement('button')
    button.id = 'native-diagnostic-save-probe'
    button.setAttribute('data-diagnostic-action', 'save')
    button.textContent = 'PRIVATE-SYNTHETIC'
    window.document.body.append(button)
  })
  await page.locator('#native-diagnostic-save-probe').click()
  const directory = await app.evaluate(({app}) => app.getPath('userData'))
  await expect.poll(async () => {
    const state = JSON.parse(await readFile(join(directory, 'native-diagnostics.json'), 'utf8'))
    assert.equal(JSON.stringify(state).includes('PRIVATE-SYNTHETIC'), false)
    return state.context
  }, { timeout: 10000, message: 'Real operation trail must reach native storage before the crash' }).toMatchObject({
    enabled: true, trail: expect.arrayContaining([expect.objectContaining({action:'save'})]),
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
    // SIGABRT exercises a fatal exit; SIGKILL/forcefullyCrashRenderer may instead
    // report `killed`, which must not be mislabeled or accepted as a crash.
    const pid = await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.getOSProcessId())
    assert.ok(Number.isInteger(pid) && pid > 1 && pid !== app.process().pid && pid !== process.pid)
    process.kill(pid, 'SIGABRT')
  } else {
    const session = await page.context().newCDPSession(page)
    void session.send('Page.crash').catch(() => {})
  }
  const gone = await observed.evaluate(state => state.result).finally(() => observed.dispose())
  if (process.platform === 'linux') assert.ok(['crashed', 'abnormal-exit'].includes(gone.reason))
  else assert.equal(gone.reason, 'crashed')
  const expectedName = gone.reason === 'abnormal-exit' ? 'NativeInterrupted' : 'NativeCrash'
  const expectedReason = gone.reason === 'abnormal-exit' ? 'interrupted' : 'crashed'
  console.log('Native diagnostic observed fatal renderer exit:', JSON.stringify(gone))
  const stopped = new Promise(resolve => app.process().once('exit', () => resolve(undefined)))
  await app.evaluate(({app}) => app.exit(0))
  await stopped
  app = await launch(); page = await app.firstWindow()
  await page.waitForSelector('#root main, #root button', {timeout:60000})
  await page.goto('http://localhost:17831/storyforge/home/settings')
  await page.getByRole('region', { name: '问题与故障反馈' }).waitFor()
  assert.equal(await page.evaluate(() => localStorage.getItem('storyforge-diagnostic-context-v1')), null)
  const rows = await page.evaluate(async () => {
    const client = /** @type {Window & {storyforgeClient?: {diagnostics?():Promise<unknown[]>}}} */ (window).storyforgeClient
    return await client?.diagnostics?.() ?? []
  })
  const row = /** @type {{name?:string,details?:{trail?:{action:string}[],native?:{process:string,reason:string,exitCode:number}}}|undefined} */ (rows.find(value => value && typeof value === 'object' && 'name' in value && value.name === expectedName))
  assert.ok(row?.details?.native)
  assert.equal(row.details.native.process, 'renderer'); assert.equal(row.details.native.reason, expectedReason)
  assert.equal(row.details.native.exitCode, gone.exitCode)
  assert.ok(row.details.trail?.some(step => step.action === 'save'))
  assert.equal(JSON.stringify(rows).includes('PRIVATE-SYNTHETIC'), false)
  // Exercise the existing production preference/cleanup API in this synthetic
  // profile, then let normal bootstrap preserve the stored legacy opt-out.
  const optOutSource = await buildDiagnosticOptOutFixture()
  assert.equal(await page.evaluate(source => {
    (0, eval)(source)
    return window.__storyforgeDiagnosticFixture.disable()
  }, optOutSource), true)
  await page.reload()
  await page.getByRole('region', { name: '问题与故障反馈' }).waitFor()
  assert.equal(await page.evaluate(() => localStorage.getItem('storyforge-operation-trail-v1')), null)
  await page.waitForFunction(async () => {
    const client = /** @type {Window & {storyforgeClient?: {diagnostics?():Promise<unknown[]>}}} */ (window).storyforgeClient
    const rows = await client?.diagnostics?.() ?? []
    return rows.every(value => value && typeof value === 'object' && !('details' in value))
  })
  console.log('Native diagnostic context: real isolated fatal renderer exit, classified diagnostic, bounded prior action, exit code, reload and persisted legacy opt-out cleanup passed; no model or report upload.')
  return { app, page }
}
