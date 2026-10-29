import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { exportProjectJSON, importProjectJSON, type ProjectExportData } from '../../src/lib/export/json-export'
import { db } from '../../src/lib/db/schema'
import { useWorldRulesStore } from '../../src/stores/world-rules'
import { normalizeProjectBackup } from '../../src/lib/export/backup-trust'

// Injected by native tests only. Never included in the application bundle.
const key = 'storyforge-native-upgrade-fixture'
const title = '原生覆盖更新验收作品'
const text = '海风穿过旧城。作者保存的这段正文必须在覆盖更新、重启和完整备份恢复后保持不变。'
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII='
function requireValue(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
function differences(before: unknown, after: unknown, path = '$'): string[] {
  if (Object.is(before, after)) return []
  if (before && after && typeof before === 'object' && typeof after === 'object' && Array.isArray(before) === Array.isArray(after)) {
    const left = before as Record<string, unknown>, right = after as Record<string, unknown>
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort().flatMap(key => differences(left[key], right[key], `${path}.${key}`)).slice(0, 10)
  }
  return [`${path}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`]
}
async function seed() {
  requireValue(!localStorage.getItem(key), 'Test profile must be fresh')
  const created = await createWorkspace({ name: title, genres: ['other'], description: '', status: 'drafting', targetWordCount: 100000, coverImage: image }, { kind: 'novel', novelProfile: 'long', importedNovelText: text })
  // WorkspacePage initializes this empty profile on first entry. Include it in
  // the baseline instead of treating normal first-entry initialization as loss.
  await useWorldRulesStore.getState().loadProfile(created.scope)
  const backup = await exportProjectJSON(created.scope.projectId)
  requireValue(JSON.stringify(backup).includes(text), 'Production export omitted manuscript')
  requireValue(JSON.stringify(backup).includes(image), 'Production export omitted cover')
  const root = await navigator.storage.getDirectory()
  const file = await root.getFileHandle('native-upgrade-storage-probe.txt', { create: true })
  const writer = await file.createWritable()
  await writer.write(text); await writer.close()
  localStorage.setItem(key, JSON.stringify({ projectId: created.scope.projectId, backup }))
  return { projectId: created.scope.projectId, title, text, backup }
}
async function verify(restore = false, externalBackup?: ProjectExportData, requireRestored = false) {
  const stored = JSON.parse(localStorage.getItem(key) ?? 'null')
  if (!stored) {
    let databasePresent: boolean | 'unavailable' = 'unavailable'
    let fileProbeMatches: boolean | 'unavailable' = 'unavailable'
    try { databasePresent = (await indexedDB.databases()).some(database => database.name === db.name) } catch { /* Diagnostic only. */ }
    try {
      const directory = await navigator.storage.getDirectory()
      const probe = await (await directory.getFileHandle('native-upgrade-storage-probe.txt')).getFile()
      fileProbeMatches = await probe.text() === text
    } catch { /* Diagnostic only; the missing marker still fails the gate. */ }
    throw new Error(`Upgrade lost local preferences; synthetic fixture diagnostics: ${JSON.stringify({
      origin: location.origin, localStorageEntries: localStorage.length, databasePresent, fileProbeMatches,
    })}`)
  }
  requireValue(!requireRestored || (Number.isSafeInteger(stored.restoredId) && stored.restoredId > 0), 'Restored work ID missing after restart')
  // Use the production, read-only legacy converter. It validates the original
  // contract and only adds registry-declared empty tables/version metadata;
  // every existing row, value and array order is still compared below.
  const before = structuredClone(normalizeProjectBackup(stored.backup))
  const after = await exportProjectJSON(stored.projectId)
  before.exportedAt = 0; after.exportedAt = 0
  // JSON object key order is not part of the backup contract; array order and every value are.
  const changed = differences(JSON.parse(JSON.stringify(before)), JSON.parse(JSON.stringify(after)))
  requireValue(changed.length === 0, `Upgrade changed exported work data: ${changed.join('; ')}`)
  const root = await navigator.storage.getDirectory()
  const file = await (await root.getFileHandle('native-upgrade-storage-probe.txt')).getFile()
  requireValue(await file.text() === text, 'Upgrade lost origin-private file storage')
  if (restore) {
    const count = await db.projects.count()
    let rejected = false
    try { await importProjectJSON({ ...stored.backup, version: -1 }) } catch { rejected = true }
    requireValue(rejected && await db.projects.count() === count, 'Invalid backup created partial data')
    requireValue(externalBackup, 'Restore must read the backup from a native file')
    const restoredId = await importProjectJSON(externalBackup)
    requireValue(restoredId !== stored.projectId, 'Restore overwrote original work')
    const recovered = JSON.stringify(await exportProjectJSON(restoredId))
    requireValue(recovered.includes(text) && recovered.includes(image), 'Restore lost manuscript or cover')
    stored.restoredId = restoredId
    localStorage.setItem(key, JSON.stringify(stored))
  } else if (stored.restoredId) {
    const recovered = JSON.stringify(await exportProjectJSON(stored.restoredId))
    requireValue(recovered.includes(text) && recovered.includes(image), 'Restored work did not survive restart')
  }
  return { projectId: stored.projectId, restoredId: stored.restoredId, title, text }
}
Object.assign(globalThis, { __nativeUpgrade: { seed, verify } })
