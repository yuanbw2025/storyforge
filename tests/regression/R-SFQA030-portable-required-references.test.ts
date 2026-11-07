import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { inspectProjectBackup } from '../../src/lib/export/backup-trust'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import type { Chapter, OutlineNode } from '../../src/lib/types'
import { resolveWorkspaceScope } from '../../src/lib/workspace/ownership'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { addCurrentWorkFixtureV1, addCurrentWorldFixtureV1, seedCurrentWorkspace } from '../helpers/current-workspace'

const text = '<p>原稿：潮汐留存 e\u0301 🌙。</p>'
const roots = () => PROJECT_TABLES.map(spec => spec.table.count())
const asRecord = (value: unknown) => value as Record<string, unknown>

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())

async function fixture() {
  const home = await seedCurrentWorkspace('030 原备份工作区')
  const otherWorld = await addCurrentWorldFixtureV1({ projectId: home.scope.projectId, name: '另一个明确世界' })
  const otherWork = await addCurrentWorkFixtureV1({ projectId: home.scope.projectId, worldId: otherWorld.id!,
    create: { kind: 'novel', novelProfile: 'long', title: '另一个独立作品' } })
  const foreign = { projectId: home.scope.projectId, workId: otherWork.id!, worldId: otherWorld.id! }
  const outline = (scope: typeof home.scope, id: number, title: string) => db.outlineNodes.add(stampNewRecord(scope,
    'outlineNodes', { id, projectId: scope.projectId, parentId: null, type: 'chapter', title, summary: '',
      order: 0, createdAt: 1, updatedAt: 1 }, { owner: 'work' }) as OutlineNode)
  const ownNode = await outline(home.scope, 41, '同作品章纲')
  await outline(foreign, 133, '另一作品章纲')
  await db.chapters.add(stampNewRecord(home.scope, 'chapters', { id: 67, projectId: home.scope.projectId,
    outlineNodeId: ownNode, title: '原稿章', content: text, status: 'draft', order: 0, wordCount: 9,
    perspectiveCharacterId: null, notes: '', createdAt: 1, updatedAt: 1 }, { owner: 'work' }) as Chapter)
  const backup = await exportProjectJSON(home.scope.projectId)
  expect(inspectProjectBackup(backup).valid).toBe(true)
  return { home, otherWorld, otherWork, backup }
}

async function expectNoPreflightWrites(backup: unknown, message: RegExp) {
  const before = await Promise.all(roots())
  let rootInserts = 0
  const inserted = () => { rootInserts++ }
  db.projects.hook('creating', inserted)
  try {
    expect(inspectProjectBackup(backup)).toMatchObject({ valid: false })
    expect(inspectProjectBackup(backup).errors.join('；')).toMatch(message)
    await expect(importProjectJSON(backup)).rejects.toThrow(message)
    await expect(deriveImportProjectJSON(backup)).rejects.toThrow(message)
  } finally { db.projects.hook('creating').unsubscribe(inserted) }
  expect(rootInserts).toBe(0)
  expect(await Promise.all(roots())).toEqual(before)
}

describe('030 portable mandatory references before any physical write', () => {
  it.each([
    ['missing', undefined], ['explicit null', null], ['string ID', '0'], ['negative ID', -1],
    ['non-existent ID', 992337],
  ])('rejects a %s mandatory Chapter → Outline reference', async (_name, value) => {
    const { backup } = await fixture()
    const row = asRecord(backup.chapters[0])
    if (value === undefined) delete row._outlineExportId
    else row._outlineExportId = value
    await expectNoPreflightWrites(backup, /chapters.*outline/i)
  })

  it.each([
    ['missing', undefined], ['explicit null', null], ['string ID', '0'], ['fractional ID', 0.2],
    ['non-existent ID', 9348],
  ])('rejects a %s mandatory Work → World reference', async (_name, value) => {
    const { backup } = await fixture()
    const row = asRecord(backup.works[0])
    if (value === undefined) delete row._worldExportId
    else row._worldExportId = value
    await expectNoPreflightWrites(backup, /works.*world/i)
  })

  it('rejects two valid but unrelated active roots and rejects disagreement between root contracts', async () => {
    const { backup, otherWork } = await fixture()
    const foreign = backup.works.find(row => row.code === otherWork.code)!
    const ownership = { ...backup, ownership: { ...backup.ownership, workExportId: foreign._exportId } }
    await expectNoPreflightWrites(ownership, /ownership.*(?:Work|world)/i)
    const inconsistentProject = { ...backup, project: { ...backup.project, _activeWorkExportId: foreign._exportId } }
    await expectNoPreflightWrites(inconsistentProject, /project.*activeWork/i)
  })

  it.each(['_activeWorkExportId', '_activeWorldExportId'] as const)('rejects a missing or null project %s before creating anything', async field => {
    const { backup } = await fixture()
    const row = asRecord(backup.project)
    delete row[field]
    await expectNoPreflightWrites(backup, new RegExp(`project.*${field}`, 'i'))
    row[field] = null
    await expectNoPreflightWrites(backup, new RegExp(`project.*${field}`, 'i'))
  })

  it('accepts a real exclusive World owner with a null Work slot and refuses malformed or competing owner slots', async () => {
    const { home } = await fixture()
    await db.outlineNodes.add(stampNewRecord(home.scope, 'outlineNodes', {
      projectId: home.scope.projectId, parentId: null, type: 'volume', title: 'World 的独立大纲',
      summary: '可空的 Work 坐标', order: 0, createdAt: 1, updatedAt: 1,
    }, { owner: 'world' }) as OutlineNode)
    const backup = await exportProjectJSON(home.scope.projectId)
    const worldRow = asRecord(backup.outlineNodes.find(row => row.title === 'World 的独立大纲')!)
    worldRow._workOwnerExportId = null
    expect(inspectProjectBackup(backup).valid).toBe(true)
    const restored = await importProjectJSON(backup)
    const newScope = await resolveWorkspaceScope(restored)
    expect(await db.outlineNodes.where('projectId').equals(restored).filter(row => row.title === 'World 的独立大纲').first())
      .toMatchObject({ worldId: newScope.worldId, workId: null })
    worldRow._workOwnerExportId = '0'
    await expectNoPreflightWrites(backup, /outlineNodes.*owner/i)
    worldRow._workOwnerExportId = backup.ownership.workExportId
    await expectNoPreflightWrites(backup, /outlineNodes.*owner/i)
  })

  it('rejects a valid outline coordinate belonging to a different Work', async () => {
    const { backup } = await fixture()
    const foreign = backup.outlineNodes.find(row => row.title === '另一作品章纲')!
    asRecord(backup.chapters[0])._outlineExportId = asRecord(foreign)._exportId
    await expectNoPreflightWrites(backup, /chapters.*outline/i)
  })

  it('preserves real optional null references and reopens the correct Work in same and fresh databases', async () => {
    const { home, backup } = await fixture()
    const active = backup.works.find(row => row.code === home.work.code)!
    const ownOutline = backup.outlineNodes.find(row => row.title === '同作品章纲')!
    asRecord(ownOutline)._exportId = 702
    asRecord(backup.chapters[0])._outlineExportId = 702
    asRecord(backup.chapters[0])._perspectiveCharacterExportId = null
    expect(inspectProjectBackup(backup).valid).toBe(true)
    const verify = async (id: number) => {
      const current = await resolveWorkspaceScope(id)
      const [work, chapter] = await Promise.all([db.works.get(current.workId), db.chapters.where('projectId').equals(id).first()])
      expect(work?.code).toBe(active.code)
      expect(chapter).toMatchObject({ workId: current.workId, content: text, perspectiveCharacterId: null })
      expect(await db.outlineNodes.get(chapter!.outlineNodeId)).toMatchObject({ title: '同作品章纲', workId: current.workId })
    }
    await verify(await importProjectJSON(backup))
    await db.delete(); await db.open()
    await verify(await deriveImportProjectJSON(backup))
  })
})
