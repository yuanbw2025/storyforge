import { mkdirSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

const names = new Set(['NativeCrash', 'NativeOutOfMemory', 'NativeUnresponsive', 'NativeInterrupted'])
const areas = new Set(['home', 'longform', 'short', 'world', 'script', 'comic', 'motion', 'ttrpg', 'chat', 'town', 'avg', 'adventure', 'settings', 'community', 'workshop', 'player', 'other'])
const actions = new Set(['navigate', 'button', 'submit', 'save', 'generate', 'adopt', 'dismiss', 'retry', 'import', 'export', 'play', 'stop'])
/** @typedef {{at: string, area: string, action: string}} Step */
/** @typedef {{process: string, reason: string, exitCode?: number}} Native */
/** @typedef {{version: 1, code: 'native-exit', trail: Step[], native?: Native}} Detail */
/** @typedef {{source: 'native', name: string, occurredAt: string, frames: string[], build: string, details?: Detail}} Row */
/** @param {unknown} value @param {number} end @returns {Step[]} */
function trail(value, end) {
  if (!Array.isArray(value)) return []
  let previous = end - 300000
  return value.slice(-20).flatMap((/** @type {Record<string, any>} */ row) => {
    const time = typeof row?.at === 'string' ? Date.parse(row.at) : NaN
    if (!Number.isFinite(time) || time < previous || time > end || !areas.has(row.area) || !actions.has(row.action)) return []
    previous = time
    return [{ at: new Date(time).toISOString(), area: String(row.area), action: String(row.action) }]
  })
}
/** @param {unknown} value @returns {Native|undefined} */
function native(value) {
  if (!value || typeof value !== 'object') return
  const row = /** @type {Record<string, unknown>} */ (value)
  if (typeof row.process !== 'string' || !['browser', 'renderer', 'GPU', 'Utility', 'unknown'].includes(row.process)
    || typeof row.reason !== 'string' || !['crashed', 'oom', 'unresponsive', 'uncaught', 'interrupted'].includes(row.reason)) return
  return { process: row.process, reason: row.reason, ...(typeof row.exitCode === 'number' && Number.isInteger(row.exitCode) && Math.abs(row.exitCode) <= 2147483648 ? { exitCode: row.exitCode } : {}) }
}
/** @param {string} directory @param {string} build */
export function desktopDiagnostics(directory, build) {
  const path = join(directory, 'native-diagnostics.json')
  const read = () => {
    try {
      if (statSync(path).size > 65536) return { running: false, errors: /** @type {Row[]} */ ([]), context: { enabled: false, trail: /** @type {Step[]} */ ([]) } }
      const value = JSON.parse(readFileSync(path, 'utf8'))
      /** @type {Row[]} */
      const errors = Array.isArray(value.errors) ? value.errors.slice(-5).flatMap((/** @type {Record<string, any>} */ row) => {
        const time = typeof row?.occurredAt === 'string' ? Date.parse(row.occurredAt) : NaN
        if (!names.has(row?.name) || !Number.isFinite(time) || time < Date.now() - 7 * 86400000 || time > Date.now() + 300000) return []
        const detail = row.details
        const process = native(detail?.native)
        return [{ source: /** @type {const} */ ('native'), name: String(row.name), occurredAt: new Date(time).toISOString(), frames: [],
          build: typeof row.build === 'string' && /^v\d+\.\d+\.\d+\+(?:local|[a-f0-9]{7,40})$/.test(row.build) ? row.build : 'unknown',
          ...(detail?.version === 1 ? { details: { version: /** @type {const} */ (1), code: /** @type {const} */ ('native-exit'), trail: trail(detail.trail, time), ...(process ? { native: process } : {}) } } : {}) }]
      }) : []
      return { running: value.running === true, errors, context: { enabled: value.context?.enabled === true, trail: trail(value.context?.trail, Date.now()) } }
    } catch { return { running: false, errors: /** @type {Row[]} */ ([]), context: { enabled: false, trail: /** @type {Step[]} */ ([]) } } }
  }
  /** @param {ReturnType<typeof read>} value */
  const write = value => { try { mkdirSync(directory, { recursive: true, mode: 0o700 }); writeFileSync(path + '.tmp', JSON.stringify(value), { mode: 0o600 }); renameSync(path + '.tmp', path) } catch { /* Best effort diagnostics. */ } }
  /** @param {string} name @param {unknown} [process] */
  const record = (name, process) => {
    if (!names.has(name)) return
    const value = read(), now = Date.now(), info = native(process)
    value.errors = [...value.errors, { source: /** @type {const} */ ('native'), name, occurredAt: new Date(now).toISOString(), frames: [], build,
      ...(value.context.enabled ? { details: { version: /** @type {const} */ (1), code: /** @type {const} */ ('native-exit'), trail: trail(value.context.trail, now), ...(info ? { native: info } : {}) } } : {}) }].slice(-5)
    write(value)
  }
  return {
    start() { const previous = read(); if (previous.running) record('NativeInterrupted', { process: 'browser', reason: 'interrupted' }); write({ ...read(), running: true, context: { enabled: false, trail: [] } }) },
    cleanExit() { write({ ...read(), running: false, context: { enabled: false, trail: [] } }) },
    /** @param {unknown} value */
    setContext(value) {
      const item = value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {}
      const current = read(), enabled = item.enabled === true
      current.context = { enabled, trail: enabled ? trail(item.trail, Date.now()) : [] }
      if (!enabled) current.errors = current.errors.map(row => { const copy = { ...row }; delete copy.details; return copy })
      write(current)
    },
    record,
    read: () => read().errors,
  }
}
