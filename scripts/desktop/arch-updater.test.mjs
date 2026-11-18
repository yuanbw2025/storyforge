import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createArchUpdater, selectArchUpdate } from './mac-updater.mjs'

const bytes = Buffer.from('arch package fixture')
const name = 'StoryForge-4.0.9-arch-x64.pkg.tar.zst'
const asset = {
  name, size: bytes.length, digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex'),
  browser_download_url: `https://github.com/yuanbw2025/storyforge/releases/download/v4.0.9/${name}`,
}
const release = { tag_name: 'v4.0.9', assets: [asset] }
test('Arch selects only increasing stable x64 packages from the official release', () => {
  assert.equal(selectArchUpdate(release, '4.0.8', 'x64').name, name)
  for (const current of ['4.0.9', '4.1.0', '5.0.0']) assert.equal(selectArchUpdate(release, current, 'x64'), null)
  assert.equal(selectArchUpdate(release, '4.0.8', 'arm64'), null)
  assert.equal(selectArchUpdate({ ...release, draft: true }, '4.0.8', 'x64'), null)
  assert.equal(selectArchUpdate({ ...release, prerelease: true }, '4.0.8', 'x64'), null)
  assert.throws(() => selectArchUpdate({ ...release, assets: [asset, asset] }, '4.0.8', 'x64'))
  for (const patch of [{ digest: null }, { browser_download_url: 'https://example.com/app.pkg.tar.zst' }, { size: -1 }]) {
    assert.throws(() => selectArchUpdate({ ...release, assets: [{ ...asset, ...patch }] }, '4.0.8', 'x64'))
  }
})
test('Arch verifies the full download and rechecks bytes before showing the package', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sf-arch-update-'))
  try {
    const shown = []
    let body = bytes
    const updater = createArchUpdater({
      app: { getPath: () => dir, getVersion: () => '4.0.8' }, arch: 'x64',
      shell: { showItemInFolder: path => shown.push(path) },
      fetchImpl: async url => url.includes('api.github.com') ? Response.json(release) : new Response(body),
    })
    updater.on('error', () => {})
    await updater.checkForUpdates()
    body = Buffer.from('corrupt')
    await assert.rejects(updater.downloadUpdate)
    await assert.rejects(updater.openInstaller)
    assert.deepEqual(shown, [])
    body = bytes
    await updater.downloadUpdate()
    await updater.openInstaller()
    assert.deepEqual(shown, [join(dir, 'updates', name)])
    await writeFile(join(dir, 'updates', name), 'tampered')
    await assert.rejects(updater.openInstaller)
    assert.equal(shown.length, 1)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
