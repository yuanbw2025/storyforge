import { _electron as electron } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import assert from 'node:assert/strict'

const phase = process.argv[2]
assert.ok(['seed', 'verify'].includes(phase))
const profile = join(homedir(), '.config', 'StoryForge-arch-ci')
await mkdir(profile, { recursive: true })
const source = await readFile('release/test-fixtures/native-upgrade.js', 'utf8')
const app = await electron.launch({
  executablePath: '/usr/bin/storyforge', args: [], chromiumSandbox: true,
  env: { ...process.env, STORYFORGE_TEST_USER_DATA: profile }, timeout: 60000,
})
try {
  const page = await app.firstWindow()
  await page.waitForSelector('#root main, #root button', { timeout: 60000 })
  await page.evaluate(value => { (0, eval)(value) }, source)
  await page.evaluate(async operation => {
    const browser = /** @type {Window & {__nativeUpgrade:{seed():Promise<unknown>,verify():Promise<unknown>}}} */ (/** @type {unknown} */ (globalThis))
    if (operation === 'seed') await browser.__nativeUpgrade.seed()
    else await browser.__nativeUpgrade.verify()
  }, phase)
  const state = await page.evaluate(() => {
    const browser = /** @type {Window & {storyforgeClient:{getState():Promise<{platform:string}>}}} */ (/** @type {unknown} */ (globalThis))
    return browser.storyforgeClient.getState()
  })
  assert.equal(state.platform, 'linux')
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile)
  console.log(JSON.stringify({ platform: 'arch-x64', phase, productionData: 'passed' }))
} finally {
  const stopped = new Promise(resolve => app.process().once('exit', resolve))
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await stopped
}
