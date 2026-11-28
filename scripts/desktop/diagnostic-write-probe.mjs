/* global process */
// Isolated native smoke only. Never imported by the packaged application.
import { basename } from 'node:path'

/** @param {import('playwright').ElectronApplication} app
 * @param {string} directory */
export async function beginDiagnosticWriteProbe(app, directory) {
  if (!/^storyforge-client-smoke-[a-zA-Z0-9]+$/.test(basename(directory))) throw new Error('Probe requires an isolated smoke profile')
  return app.evaluateHandle(({ app }, expectedDirectory) => {
    if (app.getPath('userData') !== expectedDirectory) throw new Error('Probe profile does not match the running application')
    const fs = process.getBuiltinModule('fs')
    const { syncBuiltinESMExports } = process.getBuiltinModule('module')
    const { join } = process.getBuiltinModule('path')
    const file = join(expectedDirectory, 'native-diagnostics.json')
    const original = { now: Date.now, write: fs.writeFileSync, rename: fs.renameSync }
    /** @type {Record<string, unknown>[]} */
    const events = []
    const remember = (/** @type {Record<string, unknown>} */ event) => { events.push(event); if (events.length > 80) events.shift() }
    const codes = new Set(['EACCES', 'EPERM', 'EBUSY', 'ENOENT', 'ENOSPC', 'EIO'])
    const errorCode = (/** @type {unknown} */ error) => error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && codes.has(error.code) ? error.code : 'OTHER'
    Date.now = () => {
      const at = original.now()
      // Stack is inspected transiently, never retained. Return the exact original
      // clock: do not fix a clock discrepancy or change production validation.
      if (new Error().stack?.replaceAll('\\', '/').includes('/desktop/diagnostics.mjs:')) remember({ kind: 'diagnostic-clock', at })
      return at
    }
    fs.writeFileSync = (...args) => {
      if (args[0] !== file + '.tmp') return original.write(...args)
      const at = original.now()
      try {
        original.write(...args)
        // Only counts and the latest technical timestamp. Never retain file
        // contents, paths, messages, labels, input text or arbitrary object keys.
        let count = 0, latestAt = null
        if (typeof args[1] === 'string' && args[1].length <= 65536) {
          try {
            const context = JSON.parse(args[1]).context
            if (Array.isArray(context?.trail)) {
              count = Math.min(20, context.trail.length)
              const time = Date.parse(context.trail.at(-1)?.at)
              if (Number.isFinite(time)) latestAt = time
            }
          } catch { /* No raw parse error retained. */ }
        }
        remember({ kind: 'write', at, result: 'ok', count, latestAt })
      } catch (error) { remember({ kind: 'write', at, result: errorCode(error) }); throw error }
    }
    fs.renameSync = (...args) => {
      if (args[0] !== file + '.tmp' || args[1] !== file) return original.rename(...args)
      const at = original.now()
      try { original.rename(...args); remember({ kind: 'rename', at, result: 'ok' }) }
      catch (error) { remember({ kind: 'rename', at, result: errorCode(error) }); throw error }
    }
    syncBuiltinESMExports()
    return { finish() {
      Date.now = original.now; fs.writeFileSync = original.write; fs.renameSync = original.rename; syncBuiltinESMExports()
      return { version: 1, syntheticProfile: true, events }
    } }
  }, directory)
}
