const { readFileSync } = require('node:fs')
const path = require('node:path')

// Electron is a shipped runtime even though npm lists it as a devDependency.
const minimumVersion = '44.9.1'
const advisory = 'https://github.com/electron/electron/security/advisories/GHSA-jr5w-w6x2-84p9'
const readJSON = file => JSON.parse(readFileSync(file, 'utf8'))

function assertRuntimeVersion(version, expected) {
  if (typeof version !== 'string' || !/^[1-9]\d*\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)) {
    throw new Error('Electron runtime must use an exact stable x.y.z version')
  }
  const parts = version.split('.').map(Number)
  if (!parts.every(Number.isSafeInteger)) throw new Error('Invalid Electron version')
  const floor = minimumVersion.split('.').map(Number)
  const difference = parts.map((value, index) => value - floor[index]).find(value => value !== 0) ?? 0
  if (difference < 0) throw new Error(`Electron runtime must be at least ${minimumVersion}: ${advisory}`)
  if (expected !== undefined && version !== expected) throw new Error(`Electron runtime mismatch: expected ${expected}, received ${version}`)
  return version
}

function lockedRuntimeVersion(projectDir) {
  const pkg = readJSON(path.join(projectDir, 'package.json'))
  const lock = readJSON(path.join(projectDir, 'package-lock.json'))
  const version = assertRuntimeVersion(pkg.devDependencies?.electron)
  if (lock.packages?.['']?.devDependencies?.electron !== version || lock.packages?.['node_modules/electron']?.version !== version) {
    throw new Error('Electron package and lockfile runtime mismatch')
  }
  return version
}

async function verifyRunningRuntime(application, { projectDir = process.cwd(), packaged = true } = {}) {
  const expected = lockedRuntimeVersion(projectDir)
  const actual = await application.evaluate(() => ({
    electronVersion: process.versions.electron, nodeVersion: process.versions.node,
    chromiumVersion: process.versions.chrome, resourcesPath: process.resourcesPath,
  }))
  assertRuntimeVersion(actual.electronVersion, expected)
  if (packaged) {
    const manifest = readJSON(path.join(actual.resourcesPath, 'third-party', 'manifest.json'))
    if (manifest.schema !== 'storyforge.desktop-third-party-notices' || manifest.version !== 1) throw new Error('Invalid desktop runtime manifest')
    assertRuntimeVersion(manifest.electronVersion, expected)
  }
  // Keep machine-local paths out of build receipts.
  return { electronVersion: actual.electronVersion, nodeVersion: actual.nodeVersion, chromiumVersion: actual.chromiumVersion, checkedAdvisory: advisory }
}

module.exports = { minimumVersion, advisory, assertRuntimeVersion, lockedRuntimeVersion, verifyRunningRuntime }
