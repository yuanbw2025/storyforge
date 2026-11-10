import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { inspectPortableTableStructure, orderPortableTreeRows } from '../../src/lib/export/portable-table-structure'
import { inspectProjectBackup } from '../../src/lib/export/backup-trust'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { OutlineNode } from '../../src/lib/types'

const identified = PROJECT_TABLES.filter(spec => spec.exportable && spec.exportIdField)
const trees = PROJECT_TABLES.filter(spec => spec.exportable && spec.tree)

describe.each(identified)('SFQA-019 · $name portable identity', spec => {
  it.each([undefined, null, -1, 0.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '0'])('rejects invalid or missing ID %j', id => {
    expect(inspectPortableTableStructure(spec, [{ _exportId: id }]).join('；')).toContain(`${spec.name}[0]._exportId`)
  })
  it('rejects duplicates without discarding either record', () => {
    const rows = [{ _exportId: 13, note: 'first' }, { _exportId: 13, note: 'second' }]
    expect(inspectPortableTableStructure(spec, rows).join('；')).toContain('重复')
    expect(rows.map(row => row.note)).toEqual(['first', 'second'])
  })
})

describe.each(trees)('SFQA-019 · $name parent chain', spec => {
  const parent = spec.exportRemap!.find(ref => ref.selfTree && ref.field === spec.tree!.parentField)!.exportAs
  it('preserves arbitrary valid IDs, all rows and exact parent references in shuffled input', () => {
    const rows = [{ _exportId: 57, [parent]: 13, text: 'child' }, { _exportId: 91, [parent]: 57, text: 'leaf' }, { _exportId: 13, [parent]: null, text: 'root' }]
    const original = structuredClone(rows)
    expect(inspectPortableTableStructure(spec, rows)).toEqual([])
    expect(orderPortableTreeRows(spec, rows).map(row => row.text)).toEqual(['root', 'child', 'leaf'])
    expect(rows).toEqual(original)
  })
  it.each([999, -1, '13', 0.5])('rejects absent or invalid parent %j', parentId => {
    const rows = [{ _exportId: 13, [parent]: parentId }]
    expect(inspectPortableTableStructure(spec, rows).join('；')).toContain(parent)
    expect(() => orderPortableTreeRows(spec, rows)).toThrow(spec.name)
  })
  it('rejects self cycles and closed cycles even beside an otherwise valid root', () => {
    for (const rows of [
      [{ _exportId: 13, [parent]: 13 }],
      [{ _exportId: 13, [parent]: 57 }, { _exportId: 57, [parent]: 13 }, { _exportId: 91, [parent]: null }],
    ]) {
      expect(inspectPortableTableStructure(spec, rows).join('；')).toContain('循环')
      expect(() => orderPortableTreeRows(spec, rows)).toThrow('循环')
    }
  })
})

it('orders a reversed 20,000-node chain without stack recursion or dropping text', () => {
  const spec = trees.find(spec => spec.name === 'outlineNodes')!
  const rows = Array.from({ length: 20_000 }, (_, id) => ({ _exportId: id, _parentExportId: id ? id - 1 : null, text: `node-${id}` })).reverse()
  const result = orderPortableTreeRows(spec, rows)
  expect(result.map(row => row.text)).toEqual(Array.from({ length: 20_000 }, (_, id) => `node-${id}`))
})

describe('SFQA-019 · both actual import boundaries preserve isolated database contents', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it.each(trees.map(spec => [spec.name, spec] as const))('%s invalid tree is rejected with table/row evidence and no table changes', async (_name, spec) => {
    const fixture = await seedCurrentWorkspace('结构拒绝隔离数据')
    const backup = await exportProjectJSON(fixture.scope.projectId)
    const parent = spec.exportRemap!.find(ref => ref.selfTree && ref.field === spec.tree!.parentField)!.exportAs
    const invalid = { ...backup, [spec.name]: [{ _exportId: 13, [parent]: 57 }, { _exportId: 57, [parent]: 13 }] }
    const counts = await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))
    const report = inspectProjectBackup(invalid)
    expect(report.errors.join('；')).toContain(`${spec.name}[_exportId=13]`)
    await expect(importProjectJSON(invalid)).rejects.toThrow('循环')
    await expect(deriveImportProjectJSON(invalid)).rejects.toThrow('循环')
    expect(await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))).toEqual(counts)
    expect(await db.projects.get(fixture.scope.projectId)).toEqual(fixture.project)
  })

  it('round-trips a valid shuffled long outline in the same and empty databases and keeps the other workspace', async () => {
    const fixture = await seedCurrentWorkspace('非连续编号长链')
    const other = await seedCurrentWorkspace('不得改动的外域')
    const otherBefore = await exportProjectJSON(other.scope.projectId)
    let parentId: number | null = null
    for (let index = 0; index < 40; index++) {
      const row = stampNewRecord(fixture.scope, 'outlineNodes', { id: index * 3 + 10, parentId, type: index === 0 ? 'volume' : 'storyBlock', title: `node-${index}`, summary: `逐字原文-${index}`, order: index, createdAt: 1, updatedAt: 1 }, { owner: 'work' }) as OutlineNode
      parentId = await db.outlineNodes.add(row)
    }
    const backup = await exportProjectJSON(fixture.scope.projectId)
    backup.outlineNodes.reverse()
    expect(inspectProjectBackup(backup).valid).toBe(true)
    const restored = await importProjectJSON(backup)
    const expected = Array.from({ length: 40 }, (_, index) => [`node-${index}`, `逐字原文-${index}`])
    const check = async (projectId: number) => {
      const rows = (await db.outlineNodes.where('projectId').equals(projectId).toArray()).sort((a, b) => a.order - b.order)
      expect(rows.map(row => [row.title, row.summary])).toEqual(expected)
      rows.forEach((row, index) => expect(row.parentId).toBe(index ? rows[index - 1].id : null))
    }
    await check(restored)
    expect({ ...await exportProjectJSON(other.scope.projectId), exportedAt: 0 }).toEqual({ ...otherBefore, exportedAt: 0 })
    await db.delete(); await db.open()
    await check(await importProjectJSON(backup))
  })
})
