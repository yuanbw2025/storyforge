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
  executablePath: '/usr/bin/storyforge', args: [],
  env: { ...process.env, STORYFORGE_TEST_USER_DATA: profile }, timeout: 60000,
})
try {
  const page = await app.firstWindow()
  await page.waitForSelector('#root main, #root button', { timeout: 60000 })
  if (phase === 'seed') {
    await page.getByLabel('我已阅读并同意《用户协议》').check()
    await page.getByRole('button', { name: '同意协议并继续', exact: true }).click()
  }
  await page.evaluate(value => { (0, eval)(value) }, source)
  if (phase === 'seed') await page.evaluate(() => window.__nativeUpgrade.seed())
  else await page.evaluate(() => window.__nativeUpgrade.verify())
  const state = await page.evaluate(() => window.storyforgeClient.getState())
  assert.equal(state.platform, 'linux')
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile)
  console.log(JSON.stringify({ platform: 'arch-x64', phase, productionData: 'passed' }))
} finally {
  const stopped = new Promise(resolve => app.process().once('exit', resolve))
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await stopped
}
