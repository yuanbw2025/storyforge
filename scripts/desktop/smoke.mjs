import { _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import runtimePolicy from '../distribution/desktop-runtime.cjs'
const profile = await mkdtemp(join(tmpdir(), 'storyforge-client-smoke-'))
const executablePath = process.argv[2]
const launch = () => electron.launch({
  ...(executablePath ? { executablePath: resolve(executablePath), args: [] } : { args: ['scripts/desktop/main.mjs'] }),
  env: { ...process.env, STORYFORGE_TEST_USER_DATA: profile }, timeout: 60000,
})
let app
try {
  app = await launch()
  console.log(JSON.stringify({ check: 'actual-desktop-runtime', ...await runtimePolicy.verifyRunningRuntime(app, { packaged: !!executablePath }) }))
  let page = await app.firstWindow()
  await page.waitForSelector('#root main, #root button', { timeout: 60000 })
  assert.ok(!(await page.locator('#root').innerText()).includes('StoryForge 无法启动'))
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  const consent = page.getByRole('button', { name: '同意协议并继续', exact: true })
  await consent.waitFor()
  assert.equal(await consent.isDisabled(), true)
  assert.equal(await page.getByRole('checkbox').count(), 1)
  assert.equal(await page.getByText('隐私说明', { exact: true }).count(), 0)
  await page.getByText('一、协议范围与接受', { exact: true }).waitFor()
  await page.getByLabel('我已阅读并同意《用户协议》').check()
  await consent.click()
  await consent.waitFor({ state: 'hidden' })
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
  await app.evaluate(({ app }) => app.exit(0))
  app = await launch()
  page = await app.firstWindow()
  await page.waitForSelector('#root main, #root button', { timeout: 60000 })
  assert.equal(await page.evaluate(() => localStorage.getItem('client-upgrade-probe')), 'preserve-me')
  assert.equal(await page.getByRole('button', { name: '同意协议并继续', exact: true }).count(), 0)
  assert.equal(await page.evaluate(() => !!JSON.parse(localStorage.getItem('storyforge-client-agreement-v1'))?.acceptedAt), true)
  const content = await page.evaluate(async () => {
    const request = indexedDB.open('client-upgrade-probe', 1)
    await new Promise((resolve, reject) => { request.onsuccess = resolve; request.onerror = reject })
    const read = request.result.transaction('values').objectStore('values').get('sample')
    return new Promise((resolve, reject) => { read.onsuccess = () => resolve(read.result); read.onerror = reject })
  })
  assert.equal(content, 'manuscript-probe')
  console.log('Native window, sandbox, unified agreement and stable-profile restart passed. This is not a two-version installer upgrade test.')
} finally {
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  // Chromium's Windows child processes release profile handles shortly after exit.
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
