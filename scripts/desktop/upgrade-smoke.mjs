import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'

const [oldPath, nextPath, previousVersion] = process.argv.slice(2)
assert.ok(oldPath && nextPath && /^\d+\.\d+\.\d+$/.test(previousVersion ?? ''), 'Pass the old and new installer paths and the expected previous x.y.z version')
const oldPackage = resolve(oldPath)
const nextPackage = resolve(nextPath)
const root = await mkdtemp(join(tmpdir(), 'storyforge-real-upgrade-'))
const installation = join(root, 'installed')
const profile = join(root, 'profile')
const fixture = await readFile('release/test-fixtures/native-upgrade.js', 'utf8')
const previousFixture = await readFile('release/test-fixtures/native-upgrade-old.js', 'utf8')
const currentVersion = JSON.parse(await readFile('package.json', 'utf8')).version
const executablePath = process.platform === 'win32' ? join(installation, 'StoryForge.exe') : join(installation, 'StoryForge.app/Contents/MacOS/StoryForge')
let app
async function install(path) {
  if (process.platform === 'win32') execFileSync(path, ['/S', `/D=${installation}`], { timeout: 180000 })
  else if (path.endsWith('.app')) execFileSync('/usr/bin/ditto', [path, join(installation, 'StoryForge.app')], { timeout: 60000 })
  else {
    const mount = join(root, 'mount')
    execFileSync('hdiutil', ['attach', path, '-nobrowse', '-mountpoint', mount], { timeout: 60000 })
    try {
      await rm(join(installation, 'StoryForge.app'), { recursive: true, force: true })
      execFileSync('/usr/bin/ditto', [join(mount, 'StoryForge.app'), join(installation, 'StoryForge.app')], { timeout: 60000 })
    } finally { execFileSync('hdiutil', ['detach', mount], { timeout: 60000 }) }
  }
}
async function launch(source, expectedVersion) {
  app = await electron.launch({ executablePath, args: [], env: { ...process.env, STORYFORGE_TEST_USER_DATA: profile }, timeout: 60000 })
  const page = await app.firstWindow()
  await page.waitForSelector('#root main, #root button', { timeout: 60000 })
  const consent = page.getByRole('button', { name: '同意协议并继续', exact: true })
  if (await consent.count()) {
    await page.getByLabel('我已阅读并同意《用户协议》').check()
    await consent.click(); await consent.waitFor({ state: 'hidden' })
  }
  assert.equal(await app.evaluate(({ app }) => app.getVersion()), expectedVersion)
  await page.evaluate(source => { (0, eval)(source) }, source)
  assert.equal(await page.evaluate(() => window.__nativeUpgradeSource.version), expectedVersion)
  return page
}
async function close() {
  const process = app.process()
  const exited = new Promise(resolve => process.once('exit', resolve))
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await exited
  app = undefined
}
try {
  await install(oldPackage)
  let page = await launch(previousFixture, previousVersion)
  const seeded = await page.evaluate(() => window.__nativeUpgrade.seed())
  const backupPath = join(root, 'backup.json')
  await writeFile(backupPath, JSON.stringify(seeded.backup))
  await close()
  page = await launch(previousFixture, previousVersion)
  await page.evaluate(() => window.__nativeUpgrade.verify())
  await close()
  await install(nextPackage)
  page = await launch(fixture, currentVersion)
  const result = await page.evaluate(backup => window.__nativeUpgrade.verify(true, backup), JSON.parse(await readFile(backupPath, 'utf8')))
  await page.goto(`http://localhost:17831/storyforge/workspace/${result.projectId}`)
  await expect(page.locator('[data-workspace-ready=longform]')).toBeVisible({ timeout: 60000 })
  await expect(page.getByTitle(result.title)).toBeVisible()
  await close()
  page = await launch(fixture, currentVersion)
  const restarted = await page.evaluate(() => window.__nativeUpgrade.verify(false, undefined, true))
  assert.equal(restarted.restoredId, result.restoredId)
  console.log(JSON.stringify({ result: 'passed', oldVersion: previousVersion, newVersion: currentVersion, platform: process.platform, checks: ['version-matched old producer and old-package restart before replacement', 'actual installer replacement', 'production workspace export unchanged after registered legacy conversion', 'OPFS file retained', 'invalid backup rejected without writes', 'production backup restored to new work', 'restored work survived process restart', 'workspace UI opened'] }))
} finally {
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
}
