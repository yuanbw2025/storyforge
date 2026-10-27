import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const config = require('../../electron-builder.config.cjs')
function fixture(platform = 'darwin', omit) {
  const root = mkdtempSync(join(tmpdir(), 'sf-desktop-notices-')), appOutDir = join(root, 'output'), projectDir = join(root, 'project')
  const resources = platform === 'darwin' ? join(appOutDir, 'Electron.app', 'Contents', 'Resources') : join(appOutDir, 'resources')
  mkdirSync(resources, { recursive: true }); mkdirSync(join(projectDir, 'dist'), { recursive: true })
  const source = platform === 'darwin' ? 'LICENSE' : 'LICENSE.electron.txt'
  const inputs = [[join(appOutDir, source), 'Electron copyright notice\n'], [join(appOutDir, 'LICENSES.chromium.html'), '<html>Full Chromium upstream notices 中文</html>'], [join(projectDir, 'dist', 'THIRD-PARTY-NOTICES.txt'), 'StoryForge third-party notices.\nDependency copyright text.']]
  for (const [name, data] of inputs) if (!name.endsWith(omit ?? '__none__')) writeFileSync(name, data)
  return { root, resources, inputs, context: { appOutDir, electronPlatformName: platform, packager: { projectDir, config: { electronVersion: '44.7.2' } } } }
}
for (const platform of ['darwin', 'win32']) test(`actual ${platform} build hook retains exact runtime and dependency notices after root cleanup`, async () => {
  const f = fixture(platform)
  try {
    await config.afterExtract(f.context)
    // macOS packaging removes the runtime root files after this hook.
    const expected = f.inputs.map(([, data]) => Buffer.from(data))
    for (const [file] of f.inputs) rmSync(file)
    const manifest = JSON.parse(readFileSync(join(f.resources, 'third-party', 'manifest.json')))
    assert.equal(manifest.electronVersion, '44.7.2'); assert.equal(manifest.platform, platform); assert.equal(manifest.files.length, 3)
    for (let i = 0; i < manifest.files.length; i++) {
      const row = manifest.files[i], bytes = readFileSync(join(f.resources, 'third-party', row.name))
      assert.deepEqual(bytes, expected[i]); assert.equal(row.size, bytes.length)
      assert.equal(row.sha256, createHash('sha256').update(bytes).digest('hex'))
    }
    assert.equal(JSON.stringify(manifest).includes(f.root), false)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})
for (const omit of ['LICENSES.chromium.html', 'THIRD-PARTY-NOTICES.txt']) test(`missing ${omit} fails before producing a partial notice directory`, async () => {
  const f = fixture('darwin', omit)
  try { await assert.rejects(config.afterExtract(f.context), /Required desktop notice missing/); assert.equal(existsSync(join(f.resources, 'third-party')), false) }
  finally { rmSync(f.root, { recursive: true, force: true }) }
})
