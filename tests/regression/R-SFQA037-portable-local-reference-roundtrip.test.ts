import Dexie from 'dexie'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { BACKUP_REFERENCE_REVIEW_TITLE, inspectProjectBackup } from '../../src/lib/export/backup-trust'
import { cascadeDeleteGroup } from '../../src/lib/registry/lifecycle'
import { deleteStoryArcLifecycle } from '../../src/lib/storyline/lifecycle'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import { cascadeDeleteChapterRecords } from '../../src/lib/chapters/lifecycle'
import { resolveWorkspaceScope } from '../../src/lib/workspace/ownership'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { Chapter, OutlineNode } from '../../src/lib/types'
import { addCurrentWorkFixtureV1, seedCurrentWorkspace } from '../helpers/current-workspace'

const sample = { id: 'calibration-stable-id', chapterTitle: '原章', beforeText: '原证据 e\u0301', afterText: '作者改稿 🌙', authorNote: '逐字保留', capturedAt: 4 }
const time = { createdAt: 1, updatedAt: 1 }
const record = (value: unknown) => value as Record<string, unknown>

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())

async function fixture() {
  const { scope } = await seedCurrentWorkspace('037 主作品引用隔离', { enableMultiWorld: true })
  const sibling = await addCurrentWorkFixtureV1({ projectId: scope.projectId, worldId: scope.worldId,
    create: { kind: 'novel', novelProfile: 'long', title: '同世界不同作品' } })
  const other = { ...scope, workId: sibling.id! }
  const chapter = async (owner: typeof scope, id: number, title: string) => {
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord(owner, 'outlineNodes', {
      id: id + 11, projectId: owner.projectId, title, summary: '', type: 'chapter', parentId: null, order: id, ...time,
    }, { owner: 'work' }) as OutlineNode)
    return db.chapters.add(stampNewRecord(owner, 'chapters', {
      id, projectId: owner.projectId, outlineNodeId, title, content: '<p>保留原文。</p>', status: 'draft',
      order: id, wordCount: 5, notes: '', ...time,
    }, { owner: 'work' }) as Chapter)
  }
  const first = await chapter(scope, 71, '原章')
  const last = await chapter(scope, 122, '回收章')
  const foreign = await chapter(other, 250, '另一作品章')
  const worldGroupId = await db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
    id: 83, projectId: scope.projectId, name: '隔离世界组', description: '', type: 'primary', order: 0, ...time,
  }, { owner: 'world' }))
  const key = { projectId: scope.projectId, ...time }
  await db.foreshadows.add(stampNewRecord(scope, 'foreshadows', { ...key, name: '灯塔伏笔', description: '伏笔原证据', notes: '原备注',
    type: 'symbol', status: 'planted', plantChapterId: first, echoChapterIds: JSON.stringify([first, last]),
    resolveChapterId: last, expectedResolveChapterId: last }, { owner: 'work' }))
  await db.stateCards.add(stampNewRecord(scope, 'stateCards', { ...key, category: 'character', entityName: '守望者',
    fields: '[{"key":"位置","value":"灯塔"}]', lastChapterId: first }, { owner: 'work' }))
  await db.characters.add(stampNewRecord(scope, 'characters', { ...key, name: '守望者', roleWeight: 'main', moralAxis: 'good',
    orderAxis: 'lawful', shortDescription: '', appearance: '', personality: '', background: '', motivation: '',
    abilities: '', relationships: '[]', arc: '', firstAppearChapterId: first, exitChapterId: last, homeWorldGroupId: null }, { owner: 'world' }))
  await db.notes.add(stampNewRecord(scope, 'notes', { ...key, chapterId: first, content: '旧稿便签', color: 'yellow', pinned: false }, { owner: 'work' }))
  await db.notes.add(stampNewRecord(other, 'notes', { ...key, chapterId: foreign, content: '另一作品便签', color: 'blue', pinned: true }, { owner: 'work' }))
  await db.historicalTimelineEvents.add(stampNewRecord(scope, 'historicalTimelineEvents', { ...key, era: '纪元', year: 5, date: '五年',
    title: '航线开通', description: '原史料事件', isHistorical: false, relatedChapterIds: [first, foreign] }, { owner: 'world' }))
  await db.historicalKeywords.add(stampNewRecord(scope, 'historicalKeywords', { ...key, keyword: '灯塔', category: 'architecture', era: '纪元',
    description: '原关键词', relatedChapterIds: [first, last] }, { owner: 'world' }))
  await db.userStyleProfiles.add(stampNewRecord(scope, 'userStyleProfiles', { ...key, worldId: scope.worldId, workId: scope.workId,
    profile: '原文风', enabled: true, sampleCount: 1, sampleWords: 8, sourceChapterIds: JSON.stringify([first, last]),
    revisionPairs: JSON.stringify([{ ...sample, sourceChapterId: first }]) }, { owner: 'work' }))
  const arcId = await db.storyArcs.add(stampNewRecord(scope, 'storyArcs', { ...key, id: 93, name: '守灯线', type: 'main', stages: '[]',
    description: '故事线原证据', worldGroupId }, { owner: 'work' }))
  await db.narrativeModules.add(stampNewRecord(scope, 'narrativeModules', { ...key, kind: 'main', title: '真实投影', description: '',
    status: 'draft', sourceProjection: 'story-arc', sourceRefId: arcId, entryNodeKey: null }, { owner: 'work' }))
  return { scope, sibling, first, last, foreign }
}

async function collect(projectId: number) {
  const scope = await resolveWorkspaceScope(projectId)
  const rows = <T>(table: Dexie.Table<T, number>) => table.where('projectId').equals(projectId).toArray()
  return { scope, chapters: await rows(db.chapters), foreshadow: (await rows(db.foreshadows))[0], state: (await rows(db.stateCards))[0],
    character: (await rows(db.characters))[0], notes: await rows(db.notes), event: (await rows(db.historicalTimelineEvents))[0],
    keyword: (await rows(db.historicalKeywords))[0], style: (await rows(db.userStyleProfiles))[0],
    group: (await rows(db.worldGroups))[0], arc: (await rows(db.storyArcs))[0], module: (await rows(db.narrativeModules))[0] }
}

function verifyRoundTrip(state: Awaited<ReturnType<typeof collect>>) {
  const [first, last, foreign] = ['原章', '回收章', '另一作品章'].map(title => state.chapters.find(row => row.title === title)!.id)
  expect(state.foreshadow).toMatchObject({ plantChapterId: first, resolveChapterId: last, expectedResolveChapterId: last,
    echoChapterIds: JSON.stringify([first, last]), description: '伏笔原证据' })
  expect(state.state.lastChapterId).toBe(first)
  expect(state.character).toMatchObject({ firstAppearChapterId: first, exitChapterId: last })
  expect(state.notes.find(row => row.content === '旧稿便签')?.chapterId).toBe(first)
  expect(state.notes.find(row => row.content === '另一作品便签')?.chapterId).toBe(foreign)
  expect(state.event.relatedChapterIds).toEqual([first, foreign])
  expect(state.keyword.relatedChapterIds).toEqual([first, last])
  expect(state.style.sourceChapterIds).toBe(JSON.stringify([first, last]))
  expect(JSON.parse(state.style.revisionPairs!)).toEqual([{ ...sample, sourceChapterId: first }])
  expect(state.arc.worldGroupId).toBe(state.group.id)
  expect(state.module.sourceRefId).toBe(state.arc.id)
  expect(state.chapters.every(row => row.content === '<p>保留原文。</p>')).toBe(true)
}

it('037 actual export wire replaces physical chapter/group/projection locators and keeps original textual evidence', async () => {
  const f = await fixture()
  const wire = await exportProjectJSON(f.scope.projectId)
  expect(record(wire.foreshadows[0])).not.toHaveProperty('plantChapterId')
  expect(record(wire.foreshadows[0])).not.toHaveProperty('resolveChapterId')
  expect(record(wire.foreshadows[0])).not.toHaveProperty('expectedResolveChapterId')
  expect(record(wire.foreshadows[0])).not.toHaveProperty('echoChapterIds')
  expect(record(wire.stateCards[0])).not.toHaveProperty('lastChapterId')
  expect(record(wire.characters[0])).not.toHaveProperty('firstAppearChapterId')
  expect(record(wire.characters[0])).not.toHaveProperty('exitChapterId')
  expect(record(wire.notes[0])).not.toHaveProperty('chapterId')
  expect(record(wire.historicalTimelineEvents[0])).not.toHaveProperty('relatedChapterIds')
  expect(record(wire.historicalKeywords[0])).not.toHaveProperty('relatedChapterIds')
  expect(record(wire.userStyleProfiles[0])).not.toHaveProperty('sourceChapterIds')
  expect(JSON.parse(wire.userStyleProfiles[0].revisionPairs!)).toEqual([{ ...sample, sourceChapterId: null }])
  expect(record(wire.storyArcs[0])).not.toHaveProperty('worldGroupId')
  expect(record(wire.narrativeModules[0])).not.toHaveProperty('sourceRefId')
})

it('037 actual import and derive remap the relationships in the same database and a fresh database', async () => {
  const f = await fixture()
  const wire = await exportProjectJSON(f.scope.projectId)
  const imported = await importProjectJSON(wire)
  verifyRoundTrip(await collect(imported))
  verifyRoundTrip(await collect(f.scope.projectId))
  await db.delete(); await db.open()
  verifyRoundTrip(await collect(await deriveImportProjectJSON(wire)))
})

it('037 actual chapter delete detaches scoped references, retains text and leaves another Work chapter and note intact', async () => {
  const f = await fixture()
  await cascadeDeleteChapterRecords([f.first])
  const state = await collect(f.scope.projectId)
  expect(state.foreshadow).toMatchObject({ plantChapterId: null, resolveChapterId: f.last,
    echoChapterIds: JSON.stringify([f.last]), description: '伏笔原证据' })
  expect(state.state.lastChapterId ?? null).toBeNull()
  expect(state.character.firstAppearChapterId).toBeNull()
  expect(state.character.exitChapterId).toBe(f.last)
  expect(state.notes.find(row => row.content === '旧稿便签')?.chapterId ?? null).toBeNull()
  expect(state.notes.find(row => row.content === '另一作品便签')?.chapterId).toBe(f.foreign)
  expect(state.event.relatedChapterIds).toEqual([f.foreign])
  expect(state.keyword.relatedChapterIds).toEqual([f.last])
  expect(state.style.sourceChapterIds).toBe(JSON.stringify([f.last]))
  expect(JSON.parse(state.style.revisionPairs!)).toEqual([{ ...sample, sourceChapterId: null }])
})

it('037 preflight and restored Work note preserve exact legacy values while valid links and author text survive', async () => {
  const f = await fixture()
  const wire = await exportProjectJSON(f.scope.projectId)
  expect(inspectProjectBackup(wire).warnings.join('')).not.toContain(BACKUP_REFERENCE_REVIEW_TITLE)
  const plant = record(wire.foreshadows[0])
  delete plant._plantChapterExportId
  plant.plantChapterId = f.first
  delete plant._echoChapterExportIds
  plant.echoChapterIds = `[ ${f.first}, ${f.foreign} ]`
  const profile = record(wire.userStyleProfiles[0])
  delete profile._revisionPairSourceChapterExportIds
  profile.revisionPairs = JSON.stringify([{ ...sample, sourceChapterId: f.first }])
  const affectedNote = record(wire.notes[0])
  affectedNote._chapterExportId = record(wire.notes[1])._chapterExportId
  const affectedHistory = record(wire.historicalTimelineEvents[0])
  affectedHistory._relatedChapterExportIds = [...affectedHistory._relatedChapterExportIds as number[], 999]
  const pending = inspectProjectBackup(wire)
  expect(pending.valid).toBe(true)
  expect(pending.warnings.join('')).toContain('5 项关联待确认')

  const imported = await importProjectJSON(wire)
  const state = await collect(imported)
  const first = state.chapters.find(row => row.title === '原章')!.id
  expect(state.foreshadow.plantChapterId).toBeNull()
  expect(state.foreshadow.echoChapterIds).toBe('[]')
  expect(state.state.lastChapterId).toBe(first)
  expect(state.event.relatedChapterIds).toHaveLength(2)
  expect(state.notes.find(row => row.content === '旧稿便签')?.chapterId).toBeNull()
  expect(JSON.parse(state.style.revisionPairs!)).toEqual([{ ...sample, sourceChapterId: null }])
  const report = state.notes.find(row => row.content.startsWith(BACKUP_REFERENCE_REVIEW_TITLE))!
  expect(report).toMatchObject({ workId: state.scope.workId, pinned: true })
  const [, source, , ...lines] = report.content.split('\n')
  expect(source).toMatch(/来源 v18 .*SHA-256：[a-f0-9]{64}/)
  const entries = lines.map(line => JSON.parse(line))
  expect(entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ 字段: 'plantChapterId', 原值: f.first, 恢复时新库位置: `foreshadows#${state.foreshadow.id}` }),
    expect.objectContaining({ 字段: 'echoChapterIds', 原值: plant.echoChapterIds }),
    expect.objectContaining({ 字段: 'revisionPairs[0].sourceChapterId', 原值: f.first, 样本ID: sample.id }),
    expect.objectContaining({ 字段: '_chapterExportId', 原值: affectedNote._chapterExportId }),
    expect.objectContaining({ 字段: '_relatedChapterExportIds[2]', 原值: 999 }),
  ]))
  verifyRoundTrip(await collect(f.scope.projectId))

  const restoredWire = await exportProjectJSON(imported)
  expect(inspectProjectBackup(restoredWire).warnings.join('')).not.toContain(BACKUP_REFERENCE_REVIEW_TITLE)
  db.close(); await db.open()
  expect((await db.notes.get(report.id!))?.content).toBe(report.content)
  const again = await collect(await deriveImportProjectJSON(restoredWire))
  expect(again.notes.filter(row => row.content.startsWith(BACKUP_REFERENCE_REVIEW_TITLE)).map(row => row.content)).toEqual([report.content])
})

it('037 report write failure rolls back restored project and original source stays intact', async () => {
  const f = await fixture()
  const wire = await exportProjectJSON(f.scope.projectId)
  record(wire.notes[0]).chapterId = f.first
  const add = db.notes.add.bind(db.notes)
  const failure = vi.spyOn(db.notes, 'add').mockImplementation(note =>
    note.content.startsWith(BACKUP_REFERENCE_REVIEW_TITLE) ? new Dexie.Promise<number>((_, reject) => reject(new Error('report write failed'))) : add(note))
  try {
    await expect(deriveImportProjectJSON(wire)).rejects.toThrow('report write failed')
    expect(await db.projects.count()).toBe(1)
    verifyRoundTrip(await collect(f.scope.projectId))
  } finally { failure.mockRestore() }
})

it('037 deleting a group detaches StoryArcs without deleting them; only registered story arc projection is detached on arc deletion', async () => {
  const f = await fixture()
  const before = await collect(f.scope.projectId)
  const siblingGroup = await db.worldGroups.add({ ...before.group, id: undefined, name: '未删世界组' })
  const siblingArc = await db.storyArcs.add({ ...before.arc, id: undefined, worldGroupId: siblingGroup, name: '未删故事线' })
  const custom = await db.narrativeModules.add({ ...before.module, id: undefined, title: '人工投影', sourceProjection: 'custom' })
  await cascadeDeleteGroup(f.scope.projectId, before.group.id!)
  expect(await db.worldGroups.get(before.group.id!)).toBeUndefined()
  expect(await db.storyArcs.get(before.arc.id!)).toMatchObject({ worldGroupId: null, description: '故事线原证据' })
  expect(await db.storyArcs.get(siblingArc)).toMatchObject({ worldGroupId: siblingGroup })
  await deleteStoryArcLifecycle(before.arc.id!)
  expect(await db.narrativeModules.get(before.module.id!)).toMatchObject({ sourceRefId: null })
  expect(await db.narrativeModules.get(custom)).toMatchObject({ sourceRefId: before.arc.id })
})

it('037 current export preserves dangling and cross-Work locators in backup only, once, without bringing foreign rows into the backup', async () => {
  const f = await fixture()
  const outside = await seedCurrentWorkspace('导出包之外的作品')
  const outsideOutline = await db.outlineNodes.add(stampNewRecord(outside.scope, 'outlineNodes', {
    id: 916, projectId: outside.scope.projectId, title: '不可读的外部章节大纲', summary: '', type: 'chapter', parentId: null, order: 1, ...time,
  }, { owner: 'work' }) as OutlineNode)
  const outsideChapter = await db.chapters.add(stampNewRecord(outside.scope, 'chapters', {
    id: 917, projectId: outside.scope.projectId, outlineNodeId: outsideOutline, title: '不可读的外部手稿',
    content: '<p>外部手稿原文</p>', status: 'draft', order: 1, wordCount: 5, notes: '', ...time,
  }, { owner: 'work' }) as Chapter)
  const original = await collect(f.scope.projectId)
  await db.foreshadows.update(original.foreshadow.id!, {
    plantChapterId: outsideChapter, echoChapterIds: `[ ${f.last}, 991, ${f.foreign} ]`,
  })
  await db.notes.update(original.notes.find(row => row.content === '旧稿便签')!.id!, { chapterId: f.foreign })
  await db.userStyleProfiles.update(original.style.id!, { revisionPairs: JSON.stringify([{ ...sample, sourceChapterId: 992 }]) })
  const damaged = await collect(f.scope.projectId)
  const wire = await exportProjectJSON(f.scope.projectId)
  expect(inspectProjectBackup(wire).valid).toBe(true)
  expect(JSON.stringify(wire)).not.toContain('外部手稿')
  expect(await collect(f.scope.projectId)).toEqual(damaged)
  expect((await collect(outside.scope.projectId)).chapters[0].id).toBe(outsideChapter)
  const reports = wire.notes.filter(note => note.content.startsWith(BACKUP_REFERENCE_REVIEW_TITLE))
  expect(reports).toHaveLength(1)
  const entries = reports[0].content.split('\n').slice(3).map(line => JSON.parse(line))
  expect(entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ 字段: 'plantChapterId', 原值: outsideChapter }),
    expect.objectContaining({ 字段: 'echoChapterIds', 原值: damaged.foreshadow.echoChapterIds }),
    expect.objectContaining({ 字段: 'chapterId', 原值: f.foreign }),
    expect.objectContaining({ 字段: 'revisionPairs[0].sourceChapterId', 原值: 992 }),
  ]))
  async function verifyRestored(projectId: number) {
    const restored = await collect(projectId)
    const last = restored.chapters.find(chapter => chapter.title === '回收章')!.id
    expect(restored.foreshadow).toMatchObject({ plantChapterId: null, resolveChapterId: last, echoChapterIds: JSON.stringify([last]) })
    expect(restored.notes.find(note => note.content === '旧稿便签')?.chapterId).toBeNull()
    expect(JSON.parse(restored.style.revisionPairs!)).toEqual([{ ...sample, sourceChapterId: null }])
    const next = await exportProjectJSON(projectId)
    expect(next.notes.filter(note => note.content.startsWith(BACKUP_REFERENCE_REVIEW_TITLE)).map(note => note.content)).toEqual([reports[0].content])
  }
  await verifyRestored(await importProjectJSON(wire))
  await db.delete(); await db.open()
  await verifyRestored(await deriveImportProjectJSON(wire))
})
