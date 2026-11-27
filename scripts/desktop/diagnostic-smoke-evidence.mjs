/* global window */
// Test runner only: never imported by the application or attached to real profiles.
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const areas = new Set(['home', 'longform', 'short', 'world', 'script', 'comic', 'motion', 'ttrpg', 'chat', 'town', 'avg', 'adventure', 'settings', 'community', 'workshop', 'player', 'other'])
const actions = new Set(['navigate', 'button', 'submit', 'save', 'generate', 'adopt', 'dismiss', 'retry', 'import', 'export', 'play', 'stop'])

export function boundedContext(value, now = Date.now()) {
  return {
    enabled: value?.enabled === true,
    trail: Array.isArray(value?.trail) ? value.trail.slice(-20).flatMap(row => {
      const at = typeof row?.at === 'string' ? Date.parse(row.at) : NaN
      // Keep a bounded future timestamp as evidence, without changing production validation.
      return Number.isFinite(at) && at >= now - 300_000 && at <= now + 5000
        && areas.has(row.area) && actions.has(row.action)
        ? [{ at: new Date(at).toISOString(), area: row.area, action: row.action }] : []
    }) : [],
  }
}

async function fileContext(path) {
  try {
    if ((await stat(path)).size > 65536) return { state: 'oversize' }
    return { state: 'read', context: boundedContext(JSON.parse(await readFile(path, 'utf8')).context) }
  } catch (error) {
    return { state: 'unavailable', code: ['ENOENT', 'EACCES', 'EPERM', 'EBUSY'].includes(error?.code) ? error.code : 'OTHER' }
  }
}

export async function preserveDiagnosticSmokeEvidence(app, page, directory) {
  if (!/^storyforge-client-smoke-[a-zA-Z0-9]+$/.test(basename(directory))) throw new Error('Evidence requires an isolated smoke profile')
  const renderer = await page.evaluate(() => {
    const preference = window.localStorage.getItem('storyforge-diagnostic-context-v1')
    const raw = window.localStorage.getItem('storyforge-operation-trail-v1')
    let trail = []
    try { if (raw && raw.length <= 8192) trail = JSON.parse(raw) } catch { /* State only. */ }
    return {
      clicked: window.document.getElementById('native-diagnostic-save-probe')?.getAttribute('data-smoke-clicked') === 'true',
      preference: preference === null ? 'absent' : preference === 'true' ? 'enabled' : 'disabled-or-invalid',
      // No DOM text, input values, URLs, errors, report payloads or arbitrary object fields.
      trail: Array.isArray(trail) ? trail.slice(-20).map(row => ({ at: row?.at, area: row?.area, action: row?.action })) : [],
    }
  })
  const clocks = []
  for (let i = 0; i < 3; i++) {
    const mainBefore = await app.evaluate(() => Date.now())
    const rendererAt = await page.evaluate(() => Date.now())
    const mainAfter = await app.evaluate(() => Date.now())
    clocks.push({ mainBefore, rendererAt, mainAfter })
  }
  const result = {
    version: 1, syntheticProfile: true, clocks,
    renderer: { clicked: renderer.clicked, preference: renderer.preference, ...boundedContext({ enabled: renderer.preference === 'absent' || renderer.preference === 'enabled', trail: renderer.trail }) },
    native: await fileContext(join(directory, 'native-diagnostics.json')),
    temporary: await fileContext(join(directory, 'native-diagnostics.json.tmp')),
  }
  const output = join('release', 'native-smoke', process.platform)
  await mkdir(output, { recursive: true })
  await writeFile(join(output, 'diagnostic-context-evidence.json'), JSON.stringify(result, null, 2), { mode: 0o600 })
}
