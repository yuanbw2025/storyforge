import { mkdirSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const codes = new Set(['EADDRINUSE', 'EACCES', 'UNCAUGHT', 'INTERRUPTED', 'OTHER'])
const buildPattern = /^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]{1,40})?\+[a-f0-9]{40}$/
function launcherBuild() {
  const metadata = read(join(dirname(fileURLToPath(import.meta.url)), '../..'), 'release.json')
  if (typeof metadata?.version !== 'string' || typeof metadata?.commit !== 'string') return 'unknown'
  const build = `v${metadata?.version}+${metadata?.commit}`
  return buildPattern.test(build) ? build : 'unknown'
}
export const diagnosticsDirectory = () => join(homedir(), '.storyforge', 'diagnostics')

function write(directory, name, value) {
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const file = join(directory, name)
    const temporary = file + `.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 })
    renameSync(temporary, file)
  } catch { /* Diagnostics cannot block or crash the application. */ }
}
function read(directory, name) {
  try {
    const file = join(directory, name)
    if (statSync(file).size > 2_048) return null
    return JSON.parse(readFileSync(file, 'utf8'))
  }
  catch { return null }
}
export function readLauncherFailure(directory = diagnosticsDirectory()) {
  const row = read(directory, 'last-failure.json')
  if (!row || !['error', 'interrupted'].includes(row.kind) || !codes.has(row.code)
    || typeof row.occurredAt !== 'string' || !Number.isFinite(Date.parse(row.occurredAt))
    || Date.parse(row.occurredAt) < Date.now() - 7 * 86_400_000 || Date.parse(row.occurredAt) > Date.now() + 300_000) return null
  return { occurredAt: new Date(row.occurredAt).toISOString(), kind: row.kind, code: row.code, build: typeof row.build === 'string' && buildPattern.test(row.build) ? row.build : 'unknown' }
}
export function recordLauncherFailure(error, directory = diagnosticsDirectory()) {
  // Never persist error.message, stack, request headers, provider URLs or paths.
  const code = codes.has(error?.code) ? error.code : 'OTHER'
  write(directory, 'last-failure.json', { occurredAt: new Date().toISOString(), kind: 'error', code, build: launcherBuild() })
}
export function monitorLauncherFailures(directory = diagnosticsDirectory()) {
  const listener = () => recordLauncherFailure({ code: 'UNCAUGHT' }, directory)
  // Monitoring must not swallow the exception or keep a broken process alive.
  process.on('uncaughtExceptionMonitor', listener)
  return () => process.removeListener('uncaughtExceptionMonitor', listener)
}
export function beginLauncherSession(directory = diagnosticsDirectory(), isAlive = pid => {
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}) {
  const previous = read(directory, 'session.json')
  if (previous?.running === true && Number.isSafeInteger(previous.pid) && previous.pid > 0 && !isAlive(previous.pid)) {
    // A missing process could mean a kill or power loss; never claim a proven crash.
    const failure = readLauncherFailure(directory)
    if (!failure || !previous.startedAt || Date.parse(failure.occurredAt) < Date.parse(previous.startedAt)) {
      write(directory, 'last-failure.json', { occurredAt: new Date().toISOString(), kind: 'interrupted', code: 'INTERRUPTED', build: typeof previous.build === 'string' && buildPattern.test(previous.build) ? previous.build : 'unknown' })
    }
  }
  write(directory, 'session.json', { running: true, pid: process.pid, startedAt: new Date().toISOString(), build: launcherBuild() })
  return () => {
    const current = read(directory, 'session.json')
    if (current?.pid === process.pid) write(directory, 'session.json', { running: false, pid: process.pid })
  }
}
