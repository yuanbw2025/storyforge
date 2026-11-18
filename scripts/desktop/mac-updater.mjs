import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

/** @typedef {{name:string, browser_download_url:string, digest?:string|null, size:number}} ReleaseAsset */
/** @typedef {{tag_name?:string, draft?:boolean, prerelease?:boolean, assets?:ReleaseAsset[]}} Release */
/** @typedef {{version:string, name:string, url:string, digest:string, size:number}} Candidate */
/** @typedef {{app:{getPath(name:string):string,getVersion():string}, shell:{openPath?:(path:string)=>Promise<string>,showItemInFolder?:(path:string)=>void}, arch?:string,fetchImpl?:typeof fetch}} PackageUpdaterOptions */
/** @typedef {EventEmitter & {checkForUpdates():Promise<void>,downloadUpdate():Promise<void>,openInstaller():Promise<void>}} PackageUpdater */

const repository = 'https://github.com/yuanbw2025/storyforge'
const latest = 'https://api.github.com/repos/yuanbw2025/storyforge/releases/latest'
/** @param {string} value */
const versionParts = value => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) ? value.split('.').map(Number) : null
/** @param {Release} release @param {string} current @param {string} arch */
export function selectMacUpdate(release, current, arch) {
  return selectPackageUpdate(release, current, arch, 'darwin')
}
/** @param {Release} release @param {string} current @param {string} arch */
export function selectArchUpdate(release, current, arch) {
  return selectPackageUpdate(release, current, arch, 'linux')
}
/** @param {Release} release @param {string} current @param {string} arch @param {string} platform */
function selectPackageUpdate(release, current, arch, platform) {
  const version = String(release.tag_name ?? '').replace(/^v/, '')
  const next = versionParts(version), previous = versionParts(current)
  const supported = platform === 'linux' ? arch === 'x64' : ['arm64', 'x64'].includes(arch)
  if (release.draft || release.prerelease || !next || !previous || !supported) return null
  const firstDifference = next.findIndex((value, index) => value !== previous[index])
  if (firstDifference < 0 || next[firstDifference] <= previous[firstDifference]) return null
  const name = platform === 'linux'
    ? `StoryForge-${version}-arch-x64.pkg.tar.zst`
    : `StoryForge-${version}-macos-${arch}.dmg`
  const matches = (release.assets ?? []).filter(asset => asset.name === name)
  if (matches.length !== 1) throw new Error('Missing exact architecture asset')
  const asset = matches[0]
  if (asset.browser_download_url !== `${repository}/releases/download/v${version}/${name}`
    || !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '')
    || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > 2 * 1024 ** 3) throw new Error('Invalid release asset')
  return { version, name, url: asset.browser_download_url, digest: String(asset.digest).slice(7), size: asset.size }
}

/** Download in-app; macOS installs through a user-confirmed DMG replacement. */
/** @param {PackageUpdaterOptions} options */
export function createMacUpdater(options) {
  return createPackageUpdater({ ...options, platform: 'darwin' })
}
/** @param {PackageUpdaterOptions} options */
export function createArchUpdater(options) {
  return createPackageUpdater({ ...options, platform: 'linux' })
}
/** @param {PackageUpdaterOptions & {platform:string}} options */
function createPackageUpdater({ app, shell, arch = process.arch, fetchImpl = fetch, platform }) {
  const updater = /** @type {PackageUpdater} */ (new EventEmitter())
  const directory = join(app.getPath('userData'), 'updates')
  /** @type {Candidate | null | undefined} */
  let candidate
  /** @type {(Candidate & {path:string}) | undefined} */
  let downloaded
  updater.checkForUpdates = async () => {
    updater.emit('checking-for-update')
    candidate = undefined
    downloaded = undefined
    try {
      const response = await fetchImpl(latest, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30_000) })
      if (!response.ok) throw new Error('Release request failed')
      candidate = selectPackageUpdate(await response.json(), app.getVersion(), arch, platform)
      updater.emit(candidate ? 'update-available' : 'update-not-available', candidate)
    } catch (error) { updater.emit('error', error); throw error }
  }
  updater.downloadUpdate = async () => {
    if (!candidate) throw new Error('No verified candidate')
    const selected = candidate
    const partial = join(directory, selected.name + '.partial')
    let handle
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      handle = await open(partial, 'w', 0o600)
      const response = await fetchImpl(selected.url, { signal: AbortSignal.timeout(45 * 60_000) })
      if (!response.ok || !response.body) throw new Error('Download failed')
      const hash = createHash('sha256')
      let received = 0
      for await (const chunk of response.body) {
        received += chunk.byteLength
        if (received > selected.size) throw new Error('Oversize download')
        hash.update(chunk)
        await handle.writeFile(chunk)
        updater.emit('download-progress', { percent: received / selected.size * 100 })
      }
      if (received !== selected.size || hash.digest('hex') !== selected.digest) throw new Error('Download integrity mismatch')
      await handle.close(); handle = undefined
      const path = join(directory, selected.name)
      await rename(partial, path)
      downloaded = { ...selected, path }
      updater.emit('update-downloaded')
    } catch (error) {
      downloaded = undefined
      await handle?.close().catch(() => {})
      await rm(partial, { force: true }).catch(() => {})
      updater.emit('error', error)
      throw error
    }
  }
  updater.openInstaller = async () => {
    if (!downloaded) throw new Error('No verified installer')
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(downloaded.path)) hash.update(chunk)
    if (hash.digest('hex') !== downloaded.digest) throw new Error('Installer changed')
    if (platform === 'linux') {
      if (!shell.showItemInFolder) throw new Error('Package folder integration unavailable')
      shell.showItemInFolder(downloaded.path)
      return
    }
    if (!shell.openPath) throw new Error('Installer integration unavailable')
    const error = await shell.openPath(downloaded.path)
    if (error) throw new Error('Installer could not be opened')
  }
  return updater
}
