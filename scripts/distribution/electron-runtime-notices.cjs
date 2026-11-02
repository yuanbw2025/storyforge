// Build-owned attribution resources, separate from workspace/model data.
const { readFile, writeFile, copyFile, mkdir, readdir, lstat } = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { lockedRuntimeVersion, assertRuntimeVersion } = require('./desktop-runtime.cjs')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

async function requiredNotice(file) {
  let stat
  try { stat = await lstat(file) } catch { throw new Error(`Required desktop notice missing: ${path.basename(file)}`) }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 64 * 1024 * 1024) throw new Error(`Invalid desktop notice: ${path.basename(file)}`)
  return { file, bytes: await readFile(file) }
}

/** afterExtract runs before Electron Builder removes the macOS root notices. */
async function preserveDesktopNotices(context) {
  const { appOutDir, electronPlatformName, packager } = context
  const mac = electronPlatformName === 'darwin' || electronPlatformName === 'mas'
  let resources
  if (mac) {
    const apps = (await readdir(appOutDir, { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name.endsWith('.app'))
    if (apps.length !== 1) throw new Error('Expected one extracted Electron app for runtime notices')
    resources = path.join(appOutDir, apps[0].name, 'Contents', 'Resources')
  } else resources = path.join(appOutDir, 'resources')
  const licenseName = mac ? 'LICENSE' : 'LICENSE.electron.txt'
  const rows = [
    { name: 'Electron-LICENSE.txt', ...await requiredNotice(path.join(appOutDir, licenseName)) },
    { name: 'Chromium-LICENSES.html', ...await requiredNotice(path.join(appOutDir, 'LICENSES.chromium.html')) },
    { name: 'NPM-THIRD-PARTY-NOTICES.txt', ...await requiredNotice(path.join(packager.projectDir, 'dist', 'THIRD-PARTY-NOTICES.txt')) },
  ]
  if (!rows[2].bytes.toString('utf8').startsWith('StoryForge third-party notices.')) throw new Error('Generate current desktop dependency notices before packaging')
  const electronVersion = assertRuntimeVersion(packager.config.electronVersion, lockedRuntimeVersion(packager.projectDir))
  const destination = path.join(resources, 'third-party')
  await mkdir(destination, { recursive: true })
  const files = []
  for (const row of rows) {
    const target = path.join(destination, row.name)
    await copyFile(row.file, target)
    const actual = await readFile(target)
    if (!actual.equals(row.bytes)) throw new Error(`Desktop notice changed during copy: ${row.name}`)
    files.push({ name: row.name, sourceName: path.basename(row.file), size: actual.length, sha256: digest(actual) })
  }
  await writeFile(path.join(destination, 'manifest.json'), JSON.stringify({
    schema: 'storyforge.desktop-third-party-notices', version: 1,
    electronVersion, platform: electronPlatformName, files,
  }, null, 2) + '\n')
}

module.exports = { preserveDesktopNotices }
