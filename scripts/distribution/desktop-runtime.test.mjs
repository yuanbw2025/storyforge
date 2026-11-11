import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import policy from './desktop-runtime.cjs'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'storyforge-runtime-policy-'))
  const resourcesPath = join(root, 'resources')
  mkdirSync(join(resourcesPath, 'third-party'), { recursive: true })
  const devDependencies = { electron: '44.10.0' }
  const pkg = { devDependencies }
  const lock = { packages: { '': { devDependencies }, 'node_modules/electron': { version: '44.10.0' } } }
  const manifest = { schema: 'storyforge.desktop-third-party-notices', version: 1, electronVersion: '44.10.0' }
  const save = () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify(pkg))
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock))
    writeFileSync(join(resourcesPath, 'third-party', 'manifest.json'), JSON.stringify(manifest))
  }
  const application = (electronVersion = '44.10.0') => ({ evaluate: async () => ({ electronVersion, nodeVersion: '24.22.1', chromiumVersion: '152.0.7977.169', resourcesPath }) })
  save()
  return { root, pkg, lock, manifest, save, application, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

test('known affected runtimes and nonexact/prerelease specifications cannot become build versions', () => {
  for (const version of ['44.7.2', '44.9.0', '42.11.15']) assert.throws(() => policy.assertRuntimeVersion(version), /at least 44\.9\.1/)
  for (const version of ['^44.10.0', '44.10.0-beta.1', '44.10', undefined, '44.010.0']) assert.throws(() => policy.assertRuntimeVersion(version), /exact stable/)
  for (const version of ['44.9.1', '44.10.0', '45.0.0']) assert.equal(policy.assertRuntimeVersion(version), version)
})

test('a safe package declaration cannot hide a stale resolved or root lock entry', () => {
  const f = fixture()
  try {
    assert.equal(policy.lockedRuntimeVersion(f.root), '44.10.0')
    f.lock.packages['node_modules/electron'].version = '44.7.2'; f.save()
    assert.throws(() => policy.lockedRuntimeVersion(f.root), /lockfile runtime mismatch/)
    f.lock.packages['node_modules/electron'].version = '44.10.0'
    f.lock.packages[''].devDependencies = { electron: '44.9.1' }; f.save()
    assert.throws(() => policy.lockedRuntimeVersion(f.root), /lockfile runtime mismatch/)
  } finally { f.dispose() }
})

test('safe locked metadata cannot substitute for the actual launched runtime', async () => {
  const f = fixture()
  try {
    await assert.rejects(policy.verifyRunningRuntime(f.application('44.7.2'), { projectDir: f.root }), /at least/)
    await assert.rejects(policy.verifyRunningRuntime(f.application('44.9.1'), { projectDir: f.root }), /runtime mismatch/)
    const receipt = await policy.verifyRunningRuntime(f.application(), { projectDir: f.root })
    assert.equal(receipt.electronVersion, '44.10.0')
    assert.equal(JSON.stringify(receipt).includes(f.root), false)
  } finally { f.dispose() }
})

test('an actual safe runtime still rejects a stale or invalid packaged manifest', async () => {
  const f = fixture()
  try {
    f.manifest.electronVersion = '44.9.1'; f.save()
    await assert.rejects(policy.verifyRunningRuntime(f.application(), { projectDir: f.root }), /runtime mismatch/)
    f.manifest.electronVersion = '44.10.0'; f.manifest.schema = 'other'; f.save()
    await assert.rejects(policy.verifyRunningRuntime(f.application(), { projectDir: f.root }), /Invalid desktop runtime manifest/)
  } finally { f.dispose() }
})
