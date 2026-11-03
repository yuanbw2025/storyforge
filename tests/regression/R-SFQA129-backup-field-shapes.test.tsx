import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../../tests/helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import { inspectProjectBackup } from '../../src/lib/export/backup-trust'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
beforeEach(async () => { await db.delete(); await db.open(); failure = null; useLocationStore.setState({ locations: [], loading: false }); Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })
import { act, Component, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { useLocationStore } from '../../src/stores/location'
import LocationPanel from '../../src/components/location/LocationPanel'
import { parseLocationTagsV1, readLocationTagsV1 } from '../../src/lib/types/location'
import { adopt } from '../../src/lib/registry/adopt'
import { readCanonicalWorkManuscriptWordCount } from '../../src/lib/workspace/works'
import { createSfqa021WorldSharingCarrierV1 } from '../helpers/sfqa021-world-sharing-carrier'
import { installWorldSourcePackageV1, exportOriginalWorldSourceWireV1 } from '../../src/lib/world-engine/source-receipt'
import { resolveWorkspaceScope } from '../../src/lib/workspace/ownership'

async function backupFixture() {
  const f = await seedCurrentWorkspace('129合法基线隔离备份')
  await db.importantLocations.add(stampNewRecord(f.scope, 'importantLocations', { projectId: f.scope.projectId, name: '旧港', tags: '["港口"]', description: '原地描述', significance: '', parentId: null, sortOrder: 0, createdAt: 1, updatedAt: 1 }, { owner: 'world' }))
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(f.scope, 'outlineNodes', { projectId: f.scope.projectId, parentId: null, type: 'chapter', title: '到港', summary: '船抵旧港。', order: 0, createdAt: 1, updatedAt: 1 }, { owner: 'work' })) as number
  await db.chapters.add(stampNewRecord(f.scope, 'chapters', { projectId: f.scope.projectId, outlineNodeId, title: '到港', content: '<p>原稿保留。</p>', wordCount: 5, status: 'draft', order: 0, notes: '', createdAt: 1, updatedAt: 1 }, { owner: 'work' }))
  const backup = await exportProjectJSON(f.scope.projectId)
  expect(inspectProjectBackup(backup).valid).toBe(true)
  return { ...f, backup }
}
it.each(['{}', 'null', '42', '"港口"', '[7]', '["港口",null]', '{invalid'])('129 preflight rejects malformed importantLocations.tags=%s with table/row/field evidence', async tags => {
  const f = await backupFixture(); const bad = structuredClone(f.backup)
  bad.importantLocations[0].tags = tags
  const report = inspectProjectBackup(bad)
  console.info('129 actual preflight', { tags, valid: report.valid, errors: report.errors })
  expect(report.errors.join(';')).toMatch(/importantLocations\[0\].*tags/)
  expect(report.valid).toBe(false)
})
it.each([{}, 7])('129 preflight rejects chapter content of invalid type %j before writing', async content => {
  const f = await backupFixture(); const bad = structuredClone(f.backup)
  ;(bad.chapters[0] as unknown as Record<string, unknown>).content = content
  expect(inspectProjectBackup(bad).errors.join(';')).toMatch(/chapters\[0\].*content/)
})
it.each(['restore', 'derive'])('129 actual %s importer refuses a JSON-null location tag before any database mutation', async mode => {
  const f = await backupFixture(); const bad = structuredClone(f.backup); bad.importantLocations[0].tags = 'null'
  const counts = await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))
  const operation = mode === 'restore' ? importProjectJSON : deriveImportProjectJSON
  await expect(operation(bad)).rejects.toThrow(/importantLocations.*tags/)
  expect(await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))).toEqual(counts)
})

it.each([undefined, null, {}, 7, [], '["未登记"]', '["港口","港口"]'])('129 rejects invalid stored tag value %j at preflight and both import boundaries with zero writes', async tags => {
  const f = await backupFixture(), bad = structuredClone(f.backup)
  Reflect.set(bad.importantLocations[0], 'tags', tags)
  expect(inspectProjectBackup(bad).errors.join(';')).toMatch(/importantLocations\[0\].*tags/)
  const counts = await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))
  for (const operation of [importProjectJSON, deriveImportProjectJSON]) await expect(operation(bad)).rejects.toThrow(/importantLocations\[0\].*tags/)
  expect(await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))).toEqual(counts)
})

it.each([undefined, null, {}, 7, []])('129 invalid mandatory chapter content %j cannot enter either actual importer', async content => {
  const f = await backupFixture(), bad = structuredClone(f.backup)
  Reflect.set(bad.chapters[0], 'content', content)
  const counts = await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))
  for (const operation of [importProjectJSON, deriveImportProjectJSON]) await expect(operation(bad)).rejects.toThrow(/chapters\[0\].*content/)
  expect(await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))).toEqual(counts)
})

it.each([14, 15, 16, 17, 18])('129 legitimate v%i backup preserves exact tags/body, historical nullable fields and free plugin data at both entry points', async version => {
  const f = await backupFixture(), backup = structuredClone(f.backup)
  backup.version = version
  for (const spec of PROJECT_TABLES) if (spec.exportable && ((spec.introducedBackupVersion ?? 1) > version
    || spec.optionalInBackupVersions?.includes(version))) Reflect.deleteProperty(backup, spec.name)
  backup.importantLocations[0].tags = '[ "港口", "城市" ]'
  Reflect.set(backup.importantLocations[0], 'pluginMemo', { untouched: ['任意自由字段', { enabled: false }] })
  Reflect.set(backup.chapters[0], 'summary', null)
  Reflect.set(backup.chapters[0], '_perspectiveCharacterExportId', null)
  const before = JSON.stringify(backup)
  expect(inspectProjectBackup(backup).errors).toEqual([])
  for (const operation of [importProjectJSON, deriveImportProjectJSON]) {
    const id = await operation(backup)
    const restored = await exportProjectJSON(id)
    expect(restored.importantLocations[0].tags).toBe('[ "港口", "城市" ]')
    expect(Reflect.get(restored.importantLocations[0], 'pluginMemo')).toEqual(Reflect.get(backup.importantLocations[0], 'pluginMemo'))
    expect(restored.chapters[0].content).toBe('<p>原稿保留。</p>')
    expect(restored.chapters[0].summary).toBeNull()
    expect((await db.chapters.where('projectId').equals(id).first())?.perspectiveCharacterId).toBeNull()
    const project = (await db.projects.get(id))!
    expect(await readCanonicalWorkManuscriptWordCount({ projectId: id, worldId: project.activeWorldId!, workId: project.activeWorkId! })).toBeGreaterThan(0)
  }
  expect(JSON.stringify(backup)).toBe(before)
})

it.each([['[]', ''], ['["港口"]', '<p></p>'], ['["港口","城市"]', '  <p>逐字保留 &amp; 原稿。</p>  ']])('129 legal tags %s and body remain readable after restore/derive and reopen', async (tags, content) => {
  const f = await backupFixture(), backup = structuredClone(f.backup)
  backup.importantLocations[0].tags = tags; backup.chapters[0].content = content
  for (const operation of [importProjectJSON, deriveImportProjectJSON]) {
    const id = await operation(backup)
    db.close(); await db.open()
    const row = (await db.importantLocations.where('projectId').equals(id).first())!
    expect(row.tags).toBe(tags); expect(readLocationTagsV1(row.tags)).toEqual(JSON.parse(tags))
    expect((await db.chapters.where('projectId').equals(id).first())?.content).toBe(content)
    const project = (await db.projects.get(id))!
    // The existing manuscript count includes eight non-whitespace characters
    // in this literal decoded text, including its punctuation and ampersand.
    expect(await readCanonicalWorkManuscriptWordCount({ projectId: id, worldId: project.activeWorldId!, workId: project.activeWorkId! })).toBe(content.includes('逐字') ? 8 : 0)
  }
})

it('129 the shared array codec returns a copy, preserves order, and rejects sparse model/adoption arrays', () => {
  const tags = ['港口', '城市']
  const parsed = parseLocationTagsV1(tags)
  expect(parsed).toEqual(tags); expect(parsed).not.toBe(tags)
  expect(() => parseLocationTagsV1(Array(1))).toThrow('非字符串')
  expect(tags).toEqual(['港口', '城市'])
})

it.each([null, {}, '[7]', '["未登记"]', '["港口","港口"]'])('129 formal adoption and direct author tag writes reject %j without partial changes', async tags => {
  const f = await backupFixture(), row = (await db.importantLocations.where('projectId').equals(f.scope.projectId).first())!
  await useLocationStore.getState().loadAll(f.scope)
  const result = await adopt({ projectId: f.scope.projectId, scope: f.scope, target: 'importantLocations', recordId: row.id!, mode: 'replace', data: { tags } })
  expect(result.written).toHaveLength(0); expect(result.typeErrors.some(error => error.field === 'tags')).toBe(true)
  await expect(useLocationStore.getState().updateLocation(row.id!, { tags: tags as string })).rejects.toThrow('tags')
  await expect(useLocationStore.getState().addLocation({ projectId: row.projectId, name: '不能新增', tags: tags as string,
    description: row.description, significance: row.significance, parentId: null, sortOrder: 1 })).rejects.toThrow('tags')
  expect(await db.importantLocations.where('projectId').equals(f.scope.projectId).toArray()).toEqual([row])
})

it('129 legitimate array adoption uses the same codec and explicit repair rejects stale tags before writing', async () => {
  const f = await backupFixture(), row = (await db.importantLocations.where('projectId').equals(f.scope.projectId).first())!
  const result = await adopt({ projectId: f.scope.projectId, scope: f.scope, target: 'importantLocations', recordId: row.id!, mode: 'replace', data: { tags: ['城市', '港口'] } })
  expect(result.written).toHaveLength(1)
  expect((await db.importantLocations.get(row.id!))?.tags).toBe('["城市","港口"]')
  await useLocationStore.getState().loadAll(f.scope)
  await expect(useLocationStore.getState().updateLocation(row.id!, { tags: '[]' }, { expectedTags: 'null' })).rejects.toThrow('已被其它页面修改')
  expect((await db.importantLocations.get(row.id!))?.tags).toBe('["城市","港口"]')
})

it.each([3, 4, 5] as const)('129 applying registered raw-row validators preserves a legitimate F2 v%i receipt through both backup entry points', async version => {
  const f = await createSfqa021WorldSharingCarrierV1(version)
  const wire = JSON.stringify(f.pkg, null, 2) + '\n'
  const stored = await installWorldSourcePackageV1(f.target.scope, wire)
  const backup = await exportProjectJSON(f.target.scope.projectId)
  expect(backup.worldSourceReceipts).toHaveLength(1)
  expect(inspectProjectBackup(backup).errors).toEqual([])
  for (const operation of [importProjectJSON, deriveImportProjectJSON]) {
    const id = await operation(backup), scope = await resolveWorkspaceScope(id)
    expect(await exportOriginalWorldSourceWireV1(scope, stored.declarationHash)).toBe(wire)
  }
})

let failure: Error | null = null
class Boundary extends Component<{ children?: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { failure = error }
  render() { return this.state.failed ? createElement('div', { role: 'alert' }, 'whole-panel-crashed') : this.props.children }
}
it.each(['tree', 'list'])('129 restored missing tags remain visible and absent in the real %s view', async mode => {
  const f = await backupFixture()
  Reflect.deleteProperty(f.backup.importantLocations[0], 'tags')
  const wireBefore = JSON.stringify(f.backup)
  const projectId = await importProjectJSON(f.backup)
  const project = await db.projects.get(projectId)
  if (!project) throw new Error('restored synthetic workspace missing')
  const scope = await resolveWorkspaceScope(projectId)
  await useLocationStore.getState().loadAll(scope)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(createElement(Boundary, null, createElement(LocationPanel, { project }))))
    const deadline = Date.now() + 3000
    while (!failure && ![...host.querySelectorAll('button')].some(button => button.textContent?.trim() === '列表') && Date.now() < deadline) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
    }
    if (mode === 'list' && !failure) await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === '列表')!.click() })
    expect(failure).toBeNull()
    expect(host.textContent).toContain('旧港')
    expect(host.textContent).not.toContain('标签异常')
    expect(host.querySelector('[aria-label="旧港标签原值"]')).toBeNull()
    const row = await db.importantLocations.where('projectId').equals(projectId).first()
    expect(row).toBeDefined()
    expect(Object.prototype.hasOwnProperty.call(row, 'tags')).toBe(false)
    expect(row?.description).toBe('原地描述')
    expect(JSON.stringify(f.backup)).toBe(wireBefore)
  } finally { await act(async () => root.unmount()); host.remove() }
})

it.each(['tree-null', 'list-object'])('129 actual %s view isolates damaged tags while preserving the row, raw data and valid neighbor', async mode => {
  const f = await seedCurrentWorkspace('129损坏地点界面', { purpose: 'world-engine' })
  const tags = mode === 'tree-null' ? 'null' : '{}'
  const add = (name: string, value: string) => db.importantLocations.add(stampNewRecord(f.scope, 'importantLocations', { projectId: f.scope.projectId, name, tags: value, description: '保留原正文', significance: '', parentId: null, sortOrder: 0, createdAt: 1, updatedAt: 1 }, { owner: 'world' }))
  const badId = await add('坏标签地点', tags); await add('仍可读的旧港', '["港口"]')
  await useLocationStore.getState().loadAll(f.scope)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => { root.render(createElement(Boundary, null, createElement(LocationPanel, { project: f.project }))); await new Promise(resolve => setTimeout(resolve, 20)) })
    const deadline = Date.now() + 3000
    while (!failure && ![...host.querySelectorAll('button')].some(button => button.textContent?.trim() === '列表') && Date.now() < deadline) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
    if (mode === 'list-object' && !failure) await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === '列表')!.click() })
    console.info('129 actual UI corruption', { mode, failure: failure ? String(failure) : null, storedTags: (await db.importantLocations.get(badId))?.tags })
    expect(failure, 'a single malformed persisted tags value must not crash the entire real location view').toBeNull()
    expect(host.textContent).toContain('仍可读的旧港')
    expect(host.textContent).toContain('坏标签地点')
    expect((await db.importantLocations.get(badId))?.tags).toBe(tags)
  } finally { await act(async () => root.unmount()); host.remove() }
})

it.each(['repair', 'concurrent-edit', 'deleted'])('129 real author tag repair %s keeps original evidence and rejects a stale or deleted target', async mode => {
  const f = await backupFixture(), row = (await db.importantLocations.where('projectId').equals(f.scope.projectId).first())!
  await db.importantLocations.update(row.id!, { tags: 'null' })
  await useLocationStore.getState().loadAll(f.scope)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const button = (name: string) => [...host.querySelectorAll('button')].find(element => element.textContent?.trim() === name)
  const settle = async (condition: () => boolean | Promise<boolean>) => {
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      let done = false
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); done = await condition() })
      if (done) return
    }
    throw new Error(`actual tag repair did not settle: ${host.textContent}`)
  }
  const change = async (value: string) => {
    const textarea = host.querySelector<HTMLTextAreaElement>('[aria-label="修复旧港标签"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  try {
    await act(async () => root.render(createElement(LocationPanel, { project: f.project })))
    await settle(() => Boolean(button('保存标签修复')))
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="旧港标签原值"]')?.value).toBe('null')
    if (mode === 'repair') {
      await change('[7]'); await act(async () => button('保存标签修复')!.click())
      await settle(() => Boolean(host.textContent?.includes('非字符串')))
      expect((await db.importantLocations.get(row.id!))?.tags).toBe('null')
    }
    await change('["港口","城市"]')
    if (mode === 'concurrent-edit') await db.importantLocations.update(row.id!, { tags: '["城市"]' })
    if (mode === 'deleted') await db.importantLocations.delete(row.id!)
    await act(async () => button('保存标签修复')!.click())
    if (mode !== 'repair') {
      await settle(() => Boolean(host.textContent?.includes(mode === 'deleted' ? '地点已删除' : '已被其它页面修改')))
      expect(host.querySelector<HTMLTextAreaElement>('[aria-label="修复旧港标签"]')?.value).toBe('["港口","城市"]')
      expect((await db.importantLocations.get(row.id!))?.tags).toBe(mode === 'deleted' ? undefined : '["城市"]')
      if (mode === 'concurrent-edit') {
        await act(async () => button('重新载入当前原值')!.click())
        await settle(() => host.querySelector<HTMLTextAreaElement>('[aria-label="旧港标签原值"]')?.value === '["城市"]')
        expect(host.querySelector<HTMLTextAreaElement>('[aria-label="修复旧港标签"]')?.value).toBe('["城市"]')
      }
    } else {
      await settle(async () => (await db.importantLocations.get(row.id!))?.tags === '["港口","城市"]')
      expect(host.querySelector('[aria-label="修复旧港标签"]')).toBeNull()
      expect((await db.importantLocations.get(row.id!))?.description).toBe(row.description)
    }
  } finally { await act(async () => root.unmount()); host.remove() }
  db.close(); await db.open()
  if (mode === 'repair') expect(readLocationTagsV1((await db.importantLocations.get(row.id!))?.tags)).toEqual(['港口', '城市'])
  expect((await db.chapters.where('projectId').equals(f.scope.projectId).first())?.content).toBe('<p>原稿保留。</p>')
})
