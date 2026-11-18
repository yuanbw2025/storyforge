import { _electron as electron } from '@playwright/test'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { verifyDiagnosticContext } from './diagnostic-smoke.mjs'
import { verifyDesktopRelay } from './relay-smoke.mjs'
import runtimePolicy from '../distribution/desktop-runtime.cjs'
const profile = await mkdtemp(join(tmpdir(), 'storyforge-client-smoke-'))
const executablePath = process.argv[2]
const launch = async () => (app = await electron.launch({
  chromiumSandbox: process.platform === 'linux',
  ...(executablePath ? { executablePath: resolve(executablePath), args: [] } : { args: ['scripts/desktop/main.mjs'] }),
  env: { ...process.env, STORYFORGE_TEST_USER_DATA: profile }, timeout: 60000,
}))
/** @type {import('@playwright/test').ElectronApplication | undefined} */
let app
try {
  app = await launch()
  console.log(JSON.stringify({ check: 'actual-desktop-runtime', ...await runtimePolicy.verifyRunningRuntime(app, { packaged: !!executablePath }) }))
  let page = await app.firstWindow()
  await page.waitForSelector('#root main, #root button', { timeout: 60000 })
  assert.ok(!(await page.locator('#root').innerText()).includes('StoryForge 无法启动'))
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  console.log('Native smoke: checking optional agreement')
  await page.goto('http://localhost:17831/storyforge/home/settings')
  await page.getByRole('region', { name: '问题与故障反馈' }).waitFor()
  assert.equal(await page.getByRole('button', { name: '同意协议并继续', exact: true }).count(), 0)
  assert.equal(await page.evaluate("localStorage.getItem('storyforge-client-agreement-v1')"), null)
  const agreement = page.getByRole('region', { name: '用户协议正文' })
  assert.equal(await agreement.isVisible(), false)
  const agreementLink = page.locator('summary').filter({ hasText: /^用户协议$/ })
  await agreementLink.click()
  await agreement.waitFor({ state: 'visible' })
  await page.getByText('十三、个人信息与隐私保护', { exact: true }).waitFor()
  await agreementLink.click()
  assert.equal(await agreement.isVisible(), false)
  console.log('Native smoke: checking actual renderer crash and restart')
  ;({ app, page } = await verifyDiagnosticContext(app, page, launch))
  console.log('Native smoke: checking native model transport')
  await verifyDesktopRelay(app, page)
  await page.evaluate(async () => {
    localStorage.setItem('client-upgrade-probe', 'preserve-me')
    const request = indexedDB.open('client-upgrade-probe', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('values')
    await new Promise((resolve, reject) => { request.onsuccess = resolve; request.onerror = reject })
    const transaction = request.result.transaction('values', 'readwrite')
    transaction.objectStore('values').put('manuscript-probe', 'sample')
    await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = reject })
    request.result.close()
  })
  const running = app.process()
  const exited = new Promise(resolve => running.once('exit', resolve))
  await app.evaluate(({ app }) => app.exit(0))
  await exited
  app = await launch()
  page = await app.firstWindow()
  await page.waitForSelector('#root main, #root button', { timeout: 60000 })
  assert.equal(await page.evaluate(() => localStorage.getItem('client-upgrade-probe')), 'preserve-me')
  assert.equal(await page.getByRole('button', { name: '同意协议并继续', exact: true }).count(), 0)
  assert.equal(await page.evaluate("localStorage.getItem('storyforge-client-agreement-v1')"), null)
  const content = await page.evaluate(async () => {
    const request = indexedDB.open('client-upgrade-probe', 1)
    await new Promise((resolve, reject) => { request.onsuccess = resolve; request.onerror = reject })
    const read = request.result.transaction('values').objectStore('values').get('sample')
    return new Promise((resolve, reject) => { read.onsuccess = () => resolve(read.result); read.onerror = reject })
  })
  assert.equal(content, 'manuscript-probe')
  console.log('Native window, sandbox, optional agreement and stable-profile restart passed. This is not a two-version installer upgrade test.')
} catch (error) {
  console.error('Native smoke failure:', error)
  if (app) {
    const directory = `release/native-smoke/${process.platform}`
    await mkdir(directory, { recursive: true })
    await app.firstWindow().then(page => page.screenshot({ path: `${directory}/failure.png` })).catch(() => {})
  }
  throw error
} finally {
  if (app) {
    const child = app.process()
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve))
      await app.evaluate(({ app }) => app.exit(0)).catch(() => { child.kill() })
      await exited
    }
  }
  // Chromium's Windows child processes release profile handles shortly after exit.
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(error => console.warn('Isolated test profile retained:', error.code))
}
