import { afterEach, beforeEach, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { db } from '../../src/lib/db/schema'
import { inspectProjectBackup } from '../../src/lib/export/backup-trust'
import { exportProjectJSON, importProjectJSON, type ProjectExportData } from '../../src/lib/export/json-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { NARRATIVE_DOMAIN_FIELDS_V1 } from '../../src/lib/narrative-domain/codec'
import { seedConfirmedNarrativeDomainV1 } from '../helpers/narrative-domain-fixture'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => { db.close() })

function versionedBackup(native: ProjectExportData, version: number): ProjectExportData {
  const wire = structuredClone(native)
  wire.version = version
  for (const spec of PROJECT_TABLES) {
    if (spec.exportable && ((spec.introducedBackupVersion ?? 1) > version
      || spec.optionalInBackupVersions?.includes(version))) Reflect.deleteProperty(wire, spec.name)
    const rows: unknown = Reflect.get(wire, spec.name)
    if (version < 16 && Array.isArray(rows)) for (const row of rows) {
      if (row && typeof row === 'object') for (const field of NARRATIVE_DOMAIN_FIELDS_V1) {
        Reflect.deleteProperty(row, `_${field}Portable`)
      }
    }
  }
  return wire
}

function annotationProjection(wire: object): Record<string, unknown> {
  return Object.fromEntries(PROJECT_TABLES.flatMap(spec => {
    const rows: unknown = Reflect.get(wire, spec.name)
    if (!Array.isArray(rows)) return []
    const annotations = rows.flatMap((row: unknown) => {
      if (!row || typeof row !== 'object') return []
      const fields = NARRATIVE_DOMAIN_FIELDS_V1.flatMap(field => {
        const key = `_${field}Portable`
        return Object.prototype.hasOwnProperty.call(row, key) ? [[key, Reflect.get(row, key)]] : []
      })
      return fields.length ? [Object.fromEntries([['_exportId', Reflect.get(row, '_exportId')], ...fields])] : []
    })
    return annotations.length ? [[spec.name, annotations]] : []
  }))
}

const counts = () => Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))

// Synthetic author data exported by unmodified main bc18 with its own v17
// exporter. Preserve these original bytes independently of the v18 exporter.
function actualMainlineV17Backup(): ProjectExportData {
  const raw = readFileSync('tests/fixtures/sfqa021-v17-narrative-backup.json', 'utf8')
  expect(createHash('sha256').update(raw).digest('hex')).toBe('4f28139cd92bf26f7a7a962aa0cfc2fcc46f21d75de5c8c6f6af3fe7d3ae604b')
  return JSON.parse(raw) as ProjectExportData
}

it('actual mainline v17 bytes retain confirmed annotations through restore/derive/reopen', async () => {
  const wire = actualMainlineV17Backup()
  const beforeWire = JSON.stringify(wire)
  const expected = annotationProjection(wire)
  expect(wire.version).toBe(17)
  expect(Object.keys(expected)).toEqual(['storyTimelineEvents'])
  expect(Object.prototype.hasOwnProperty.call(wire, 'worldSourceReceipts')).toBe(false)
  const preflight = inspectProjectBackup(wire)
  expect(preflight.valid).toBe(true)
  expect(preflight.warnings.join(' ')).toContain('关联待确认')
  const original = wire.chapters.find(chapter => chapter._outlineExportId === null)!
  expect(original.content).toBeTruthy()
  for (const operation of [importProjectJSON, deriveImportProjectJSON]) {
    const id = await operation(wire)
    db.close(); await db.open()
    const exported = await exportProjectJSON(id)
    expect(annotationProjection(exported)).toEqual(expected)
    const restoredChapter = exported.chapters.find(chapter => chapter.ragDocumentId === original.ragDocumentId)!
    expect(restoredChapter.content).toBe(original.content)
    const placeholder = exported.outlineNodes.find(node => node._exportId === restoredChapter._outlineExportId)!
    expect(placeholder.title).toBe('【恢复占位·原章纲待确认】' + original.title)
    expect(placeholder.summary).toBe('')
    const report = exported.notes.find(note => note.content.startsWith('备份恢复：待确认关联'))!
    expect(report.content).toContain('来源 v17')
    expect(report.content).toContain(original.ragDocumentId!)
    expect(report.content).toContain('"原值":null')
    const next = await exportProjectJSON(await operation(exported))
    expect(next.outlineNodes.filter(node => node.ragDocumentId === placeholder.ragDocumentId)).toHaveLength(1)
    expect(next.notes.filter(note => note.content === report.content)).toHaveLength(1)
    expect(inspectProjectBackup(exported).valid).toBe(true)
    expect(JSON.stringify(wire)).toBe(beforeWire)
  }
})

it('actual mainline v17 dangling references are rejected without writing any table', async () => {
  const bad = actualMainlineV17Backup()
  bad.characters = []
  const beforeWire = JSON.stringify(bad)
  const before = await counts()
  expect(inspectProjectBackup(bad).errors.join(';')).toMatch(/source-missing/)
  for (const operation of [importProjectJSON, deriveImportProjectJSON]) {
    await expect(operation(bad)).rejects.toThrow(/source-missing/)
    expect(await counts()).toEqual(before)
    expect(JSON.stringify(bad)).toBe(beforeWire)
  }
})

it.each([16, 17, 18])('registered narrative annotations survive actual v%i restore/derive/reopen', async version => {
  const fixture = await seedConfirmedNarrativeDomainV1()
  const wire = versionedBackup(await exportProjectJSON(fixture.scope.projectId), version)
  const beforeWire = JSON.stringify(wire)
  const expected = annotationProjection(wire)
  expect(Object.keys(expected).length).toBeGreaterThan(0)
  if (version < 18) expect(Object.prototype.hasOwnProperty.call(wire, 'worldSourceReceipts')).toBe(false)
  expect(inspectProjectBackup(wire).valid).toBe(true)
  for (const operation of [importProjectJSON, deriveImportProjectJSON]) {
    const id = await operation(wire)
    db.close(); await db.open()
    const exported = await exportProjectJSON(id)
    expect(annotationProjection(exported)).toEqual(expected)
    expect(inspectProjectBackup(exported).valid).toBe(true)
    expect(JSON.stringify(wire)).toBe(beforeWire)
  }
})

it.each([14, 15])('v%i keeps historical absence and does not invent narrative annotations', async version => {
  const fixture = await seedConfirmedNarrativeDomainV1()
  const wire = versionedBackup(await exportProjectJSON(fixture.scope.projectId), version)
  const beforeWire = JSON.stringify(wire)
  expect(annotationProjection(wire)).toEqual({})
  expect(Object.prototype.hasOwnProperty.call(wire, 'worldSourceReceipts')).toBe(false)
  expect(inspectProjectBackup(wire).valid).toBe(true)
  const restored = await importProjectJSON(wire)
  db.close(); await db.open()
  expect(annotationProjection(await exportProjectJSON(restored))).toEqual({})
  expect(JSON.stringify(wire)).toBe(beforeWire)
})

it('v17 rejects a dangling narrative source in preflight and both import boundaries without writes', async () => {
  const fixture = await seedConfirmedNarrativeDomainV1()
  const bad = versionedBackup(await exportProjectJSON(fixture.scope.projectId), 17)
  expect(bad.characters.length).toBeGreaterThan(0)
  bad.characters = []
  const beforeWire = JSON.stringify(bad)
  const before = await counts()
  const report = inspectProjectBackup(bad)
  expect(report.valid).toBe(false)
  expect(report.errors.join(';')).toMatch(/source-missing/)
  for (const operation of [importProjectJSON, deriveImportProjectJSON]) {
    await expect(operation(bad)).rejects.toThrow(/source-missing/)
    expect(await counts()).toEqual(before)
    expect(JSON.stringify(bad)).toBe(beforeWire)
  }
})

it.each([14, 15, 16, 17])('v%i refuses the v18-only receipt table even when it is empty', async version => {
  const fixture = await seedConfirmedNarrativeDomainV1()
  const bad = versionedBackup(await exportProjectJSON(fixture.scope.projectId), version)
  Reflect.set(bad, 'worldSourceReceipts', [])
  expect(inspectProjectBackup(bad).errors.join(';')).toMatch(/v18.*worldSourceReceipts/)
})

it('a future backup version is rejected before writing', async () => {
  const fixture = await seedConfirmedNarrativeDomainV1()
  const bad = versionedBackup(await exportProjectJSON(fixture.scope.projectId), 19)
  const before = await counts()
  expect(inspectProjectBackup(bad).valid).toBe(false)
  await expect(importProjectJSON(bad)).rejects.toThrow(/备份预检失败/)
  expect(await counts()).toEqual(before)
})
