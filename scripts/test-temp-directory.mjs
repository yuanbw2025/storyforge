import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, statfs, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const ROOT_NAME = 'storyforge-test-runs-v1'
const KINDS = new Set(['e2e', 'coverage', 'validation'])
const RESERVE_BYTES = 5 * 1024 ** 3
const uid = () => process.getuid?.() ?? null
const exists = async path => lstat(path).catch(error => {
  if (error.code === 'ENOENT') return null
  throw error
})
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid === 0) return true
  try { process.kill(pid, 0); return true } catch (error) { return error.code !== 'ESRCH' }
}
async function managedRoot(tempRoot) {
  const parent = await realpath(tempRoot)
  const root = join(parent, ROOT_NAME)
  await mkdir(root, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error })
  const info = await lstat(root)
  if (!info.isDirectory() || info.isSymbolicLink() || (uid() !== null && info.uid !== uid())) {
    throw new Error('[test-temp] Refusing an unowned or linked temporary root')
  }
  return root
}
export async function assertTestDiskSpace(tempRoot = tmpdir(), requiredBytes = 0) {
  if (!Number.isSafeInteger(requiredBytes) || requiredBytes < 0) throw new Error('Invalid required byte count')
  const space = await statfs(tempRoot)
  if (space.bavail * space.bsize < RESERVE_BYTES + requiredBytes) {
    throw new Error('[test-temp] Less than the required space plus 5 GiB reserve; refusing to start more test output')
  }
}
async function readOwner(directory) {
  const file = join(directory, 'owner.json')
  const info = await exists(file)
  if (!info?.isFile() || info.isSymbolicLink() || info.size > 4096) return null
  try {
    const owner = JSON.parse(await readFile(file, 'utf8'))
    if (owner.version !== 1 || !KINDS.has(owner.kind) || owner.directory !== basename(directory)
      || !owner.directory.startsWith(owner.kind + '-') || owner.host !== hostname()
      || owner.uid !== uid() || typeof owner.nonce !== 'string'
      || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || !Number.isFinite(owner.createdAt)
      || ![owner.childPid, owner.childGroupId].every(pid => pid === null || (Number.isSafeInteger(pid) && pid > 0))) return null
    return owner
  } catch { return null }
}
async function saveOwner(directory, owner) {
  const pending = join(directory, 'owner.next')
  await writeFile(pending, JSON.stringify(owner), { mode: 0o600 })
  await rename(pending, join(directory, 'owner.json'))
}
function noOpenHandles(directory) {
  // Fail closed when lsof is absent, unsupported, times out or cannot inspect
  // the directory. PIDs alone do not cover a surviving descendant process.
  if (process.platform === 'win32') return false
  const result = spawnSync('lsof', ['-nP', '-F', 'p', '+D', directory], { encoding: 'utf8', timeout: 3000 })
  return !result.error && result.status === 1 && !result.stdout.trim() && !result.stderr.trim()
}
async function removeOwned(directory, owner, inode) {
  const info = await exists(directory)
  if (!info) return
  const current = await readOwner(directory)
  if (!info.isDirectory() || info.isSymbolicLink() || info.ino !== inode
    || current?.nonce !== owner.nonce || current.pid !== owner.pid
    || current.childPid !== owner.childPid || current.childGroupId !== owner.childGroupId
    || (uid() !== null && info.uid !== uid())) {
    throw new Error('[test-temp] Directory ownership changed; preserving it')
  }
  // fs.rm removes links themselves; it never traverses the source workspace's
  // node_modules link. Only this marked, individually owned run is removed.
  await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
export async function reapAbandonedTestDirectories({ tempRoot = tmpdir(), now = Date.now(), minimumAgeMs = 24 * 60 * 60 * 1000 } = {}) {
  const root = await managedRoot(tempRoot)
  let removed = 0
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (removed >= 32) break
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const directory = join(root, entry.name)
    try {
      const info = await lstat(directory)
      const owner = await readOwner(directory)
      if (!owner || now - owner.createdAt < minimumAgeMs || alive(owner.pid)
        || (owner.childPid !== null && alive(owner.childPid))
        || (owner.childGroupId !== null && alive(-owner.childGroupId))) continue
      if ((await readdir(directory)).some(name => !['owner.json', 'payload'].includes(name))) continue
      if (!noOpenHandles(directory)) continue
      // Recheck the lease and identity after the external process inspection.
      await removeOwned(directory, owner, info.ino)
      removed += 1
    } catch (error) {
      // Another test can finish or reclaim the same orphan between reads.
      // Best-effort recovery must not break a different test's startup.
      if (error.code !== 'ENOENT') console.error('[test-temp] Preserving unverifiable run ' + entry.name + ': ' + error.message)
    }
  }
  return removed
}
function signalChild(child, signal) {
  try {
    if (process.platform === 'win32') child.kill(signal)
    else process.kill(-child.pid, signal)
  } catch (error) { if (error.code !== 'ESRCH') throw error }
}
async function finishChild(child) {
  if (!child?.pid) return true
  const target = process.platform === 'win32' ? child.pid : -child.pid
  if (!alive(target)) return true
  signalChild(child, 'SIGTERM')
  for (let attempt = 0; attempt < 30 && alive(target); attempt += 1) await delay(50)
  if (alive(target)) signalChild(child, 'SIGKILL')
  for (let attempt = 0; attempt < 30 && alive(target); attempt += 1) await delay(50)
  return !alive(target)
}
export async function withTestDirectory(kind, task, { tempRoot = tmpdir() } = {}) {
  if (!KINDS.has(kind)) throw new Error('Unknown test temporary directory kind')
  let directory, owner, inode, child, completion, forceTimer, interrupted
  const checkInterrupted = () => {
    if (!interrupted) return
    const error = new Error('[test-temp] Interrupted by ' + interrupted)
    error.exitCode = interrupted === 'SIGINT' ? 130 : 143
    throw error
  }
  const stop = signal => {
    interrupted ??= signal
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return
    signalChild(child, signal)
    forceTimer ??= setTimeout(() => signalChild(child, 'SIGKILL'), 2000)
    forceTimer.unref()
  }
  const onInt = () => stop('SIGINT')
  const onTerm = () => stop('SIGTERM')
  process.on('SIGINT', onInt)
  process.on('SIGTERM', onTerm)
  try {
    const root = await managedRoot(tempRoot)
    await reapAbandonedTestDirectories({ tempRoot })
    await assertTestDiskSpace(tempRoot)
    checkInterrupted()
    directory = await mkdtemp(join(root, kind + '-'))
    inode = (await lstat(directory)).ino
    owner = { version: 1, kind, directory: basename(directory), nonce: randomUUID(), host: hostname(), uid: uid(),
      pid: process.pid, childPid: null, childGroupId: null, createdAt: Date.now() }
    await saveOwner(directory, owner)
    const payload = join(directory, 'payload')
    await mkdir(payload)
    console.log('[test-temp] ' + kind + ': ' + directory)
    return await task({
      path: payload,
      checkInterrupted,
      async checkSpace(requiredBytes = 0) { checkInterrupted(); await assertTestDiskSpace(tempRoot, requiredBytes) },
      async run(command, args, options = {}) {
        checkInterrupted()
        if (child) throw new Error('Only one child command is allowed per temporary run')
        child = spawn(command, args, { ...options, detached: process.platform !== 'win32', stdio: 'inherit' })
        completion = new Promise(resolve => {
          child.once('error', error => resolve({ error }))
          child.once('close', (code, signal) => { clearTimeout(forceTimer); resolve({ code, signal }) })
        })
        owner.childPid = child.pid ?? null
        owner.childGroupId = process.platform === 'win32' ? null : child.pid ?? null
        await saveOwner(directory, owner)
        if (interrupted) stop(interrupted)
        const result = await completion
        clearTimeout(forceTimer)
        checkInterrupted()
        if (result.error) throw result.error
        return result.code ?? 1
      },
    })
  } finally {
    clearTimeout(forceTimer)
    try {
      const stopped = await finishChild(child)
      if (completion) await completion
      if (directory && owner && stopped) await removeOwned(directory, owner, inode)
      else if (directory) throw new Error('[test-temp] Child liveness is uncertain; preserving ' + directory)
    } finally {
      clearTimeout(forceTimer)
      process.off('SIGINT', onInt)
      process.off('SIGTERM', onTerm)
    }
  }
}
