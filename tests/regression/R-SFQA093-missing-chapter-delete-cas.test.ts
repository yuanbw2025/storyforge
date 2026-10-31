import Dexie from 'dexie'
import { File as NativeFile } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  buildWorkspaceSelfCheckReportV1,
  confirmMissingChapterFileDeletionsV1,
  synchronizeProjectChangesToFolderV1,
} from '../../src/lib/memory/workspace-projection'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { useChapterStore } from '../../src/stores/chapter'
import type { Chapter } from '../../src/lib/types'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

function memoryDirectory() {
  const files = new Map<string, { text: string; modified: number }>()
  const directories = new Set([''])
  let clock = 100
  let onClose: ((path: string) => Promise<void>) | undefined
  let rejectClose: ((path: string) => boolean) | undefined
  const missing = () => new DOMException('文件不存在', 'NotFoundError')
  const directory = (prefix: string): FileSystemDirectoryHandle => ({
    kind: 'directory', name: prefix.split('/').filter(Boolean).slice(-1)[0] ?? 'CAS测试目录',
    async getDirectoryHandle(name: string, options?: { create?: boolean }) {
      const path = `${prefix}${name}/`
      if (!directories.has(path) && !options?.create) throw missing()
      directories.add(path)
      return directory(path)
    },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      const path = `${prefix}${name}`
      if (!files.has(path) && !options?.create) throw missing()
      if (!files.has(path)) files.set(path, { text: '', modified: ++clock })
      return {
        kind: 'file', name,
        async getFile() {
          const row = files.get(path)
          if (!row) throw missing()
          return new NativeFile([row.text], name, { lastModified: row.modified })
        },
        async createWritable() {
          let staged = ''
          return {
            async write(value: string) { staged += value },
            async close() {
              if (rejectClose?.(path)) throw new DOMException('测试目录写入授权已撤回', 'NotAllowedError')
              files.set(path, { text: staged, modified: ++clock })
              await onClose?.(path)
            },
          }
        },
      }
    },
  } as unknown as FileSystemDirectoryHandle)
  return {
    root: directory(''), files,
    onClose(hook: typeof onClose) { onClose = hook },
    rejectClose(when: typeof rejectClose) { rejectClose = when },
  }
}

async function values() {
  return Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])))
}

async function fixture(count = 1) {
  const owner = await seedCurrentWorkspace('归档删除CAS')
  const { projectId } = owner.scope
  const chapters = []
  for (let index = 0; index < count; index++) {
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord(owner.scope, 'outlineNodes', {
      projectId, parentId: null, type: 'chapter' as const, title: `章纲${index}`, summary: '',
      order: index, createdAt: 1, updatedAt: 1,
    })) as number
    const id = await db.chapters.add(stampNewRecord(owner.scope, 'chapters', {
      projectId, outlineNodeId, title: `章节${index}`, content: `<p>OLD_AUTHOR_BODY_${index}</p>`,
      wordCount: 20, status: 'draft' as const, order: index, notes: `完整作者笔记${index}`,
      createdAt: 1, updatedAt: 1,
    })) as number
    const chapter = await db.chapters.get(id)
    if (!chapter) throw new Error('真实章节创建失败')
    chapters.push(chapter)
    await db.notes.add(stampNewRecord(owner.scope, 'notes', {
      projectId, chapterId: id, content: `保留的章节便签${index}`, color: 'yellow' as const,
      pinned: false, createdAt: 1, updatedAt: 1,
    }))
  }
  const disk = memoryDirectory()
  const first = await buildWorkspaceSelfCheckReportV1(projectId, disk.root)
  await synchronizeProjectChangesToFolderV1({ projectId, root: disk.root, expectedPlanHash: first.plan.planHash })
  const bindings = (await db.workspaceDocuments.where('projectId').equals(projectId).toArray())
    .filter(row => row.tableName === 'chapters').sort((a, b) => a.recordId - b.recordId)
  expect(bindings).toHaveLength(count)
  for (const binding of bindings) disk.files.delete(binding.relativePath)
  const missing = await buildWorkspaceSelfCheckReportV1(projectId, disk.root)
  expect(missing.summary.missing).toBe(count)
  return { ...owner, chapters, bindings, disk, missing, input: { projectId, root: disk.root, expectedPlanHash: missing.plan.planHash } }
}

describe('SFQA093 missing chapter deletion protects the archived source preimage', () => {
  beforeEach(async () => {
    await db.delete(); await db.open()
    useChapterStore.setState({ chapters: [], currentChapter: null })
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('禁止真实网络') }))
  })
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled()
    vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close()
  })

  it('keeps the healthy explicit delete, original trash and reference lifecycle', async () => {
    const f = await fixture()
    const receipt = await confirmMissingChapterFileDeletionsV1(f.input)
    expect(receipt.state).toBe('completed')
    expect(await db.chapters.get(f.chapters[0]!.id!)).toBeUndefined()
    expect(await db.notes.where('projectId').equals(f.scope.projectId).count()).toBe(1)
    expect(await db.workspaceDocuments.get(f.bindings[0]!.id!)).toBeUndefined()
    expect(f.disk.files.get(`.storyforge/trash/${f.missing.plan.planId}/${f.bindings[0]!.relativePath}`)?.text)
      .toContain('OLD\\_AUTHOR\\_BODY\\_0')
    expect(JSON.parse(f.disk.files.get('.storyforge/recovery/project.json')!.text).backup.chapters).toEqual([])
  })

  it('still rejects a real author save before confirmation without a trash or DB side effect', async () => {
    const f = await fixture()
    await useChapterStore.getState().updateChapter(f.chapters[0]!.id!, { content: '<p>NEW_BEFORE_CONFIRM</p>' })
    const before = await values()
    await expect(confirmMissingChapterFileDeletionsV1(f.input)).rejects.toThrow('请重新检查')
    expect(await values()).toEqual(before)
    expect([...f.disk.files.keys()].some(path => path.startsWith('.storyforge/trash/'))).toBe(false)
  })

  for (const patch of [
    { content: '<p>NEW_DURING_TRASH</p>' },
    { notes: 'NEW_NOTES_DURING_TRASH' },
    { summary: 'NEW_DERIVED_METADATA_DURING_TRASH' },
  ]) it(`rejects a real late save of ${Object.keys(patch)[0]} before any registered deletion`, async () => {
    const f = await fixture()
    let afterSave: Awaited<ReturnType<typeof values>> | undefined
    f.disk.onClose(async path => {
      if (afterSave || !path.startsWith('.storyforge/trash/')) return
      await useChapterStore.getState().updateChapter(f.chapters[0]!.id!, patch)
      afterSave = await values()
    })
    await expect(confirmMissingChapterFileDeletionsV1(f.input)).rejects.toThrow('重新检查')
    expect(afterSave).toBeDefined()
    expect(await values()).toEqual(afterSave)
    expect(await db.chapters.get(f.chapters[0]!.id!)).toMatchObject(patch)
    expect(f.disk.files.get(`.storyforge/trash/${f.missing.plan.planId}/${f.bindings[0]!.relativePath}`)?.text)
      .toContain('OLD\\_AUTHOR\\_BODY\\_0')
  })

  it('does not rebind archived evidence to mutable aliases of real DB reading results', async () => {
    const f = await fixture()
    const seen = new Set<Chapter>()
    const observe = (row: Chapter) => {
      if (row.id === f.chapters[0]!.id) seen.add(row)
      return row
    }
    let afterSave: Awaited<ReturnType<typeof values>> | undefined
    db.chapters.hook('reading', observe)
    f.disk.onClose(async path => {
      if (afterSave || !path.startsWith('.storyforge/trash/')) return
      await useChapterStore.getState().updateChapter(f.chapters[0]!.id!, { content: '<p>NEW_SAVED_WITH_OBSERVED_ALIASES</p>' })
      const actual = await db.chapters.get(f.chapters[0]!.id!)
      if (!actual) throw new Error('真实晚存章节不存在')
      // Return values remain actual rows; mutate only the already observed aliases.
      for (const row of seen) Object.assign(row, actual)
      afterSave = await values()
    })
    try {
      await expect(confirmMissingChapterFileDeletionsV1(f.input)).rejects.toThrow('重新检查')
      expect(afterSave).toBeDefined()
      expect(await values()).toEqual(afterSave)
      expect((await db.chapters.get(f.chapters[0]!.id!))?.content).toBe('<p>NEW_SAVED_WITH_OBSERVED_ALIASES</p>')
    } finally { db.chapters.hook('reading').unsubscribe(observe) }
  })

  it('rejects the whole multi-chapter deletion if the last archived chapter changes', async () => {
    const f = await fixture(2)
    let afterSave: Awaited<ReturnType<typeof values>> | undefined
    f.disk.onClose(async path => {
      if (afterSave || !path.endsWith(f.bindings[1]!.relativePath) || !path.startsWith('.storyforge/trash/')) return
      await useChapterStore.getState().updateChapter(f.chapters[1]!.id!, { content: '<p>NEW_SECOND_CHAPTER</p>' })
      afterSave = await values()
    })
    await expect(confirmMissingChapterFileDeletionsV1(f.input)).rejects.toThrow('重新检查')
    expect(afterSave).toBeDefined()
    expect(await values()).toEqual(afterSave)
    expect(await db.chapters.count()).toBe(2)
    for (const binding of f.bindings) expect(await db.workspaceDocuments.get(binding.id!)).toEqual(binding)
  })

  it('retains every DB row if the archive close fails', async () => {
    const f = await fixture()
    const before = await values()
    f.disk.rejectClose(path => path.startsWith('.storyforge/trash/'))
    await expect(confirmMissingChapterFileDeletionsV1(f.input)).rejects.toThrow('授权已撤回')
    expect(await values()).toEqual(before)
  })

  it('requires a truthful trash readback before deleting the original row', async () => {
    const f = await fixture()
    const before = await values()
    f.disk.onClose(async path => {
      if (path.startsWith('.storyforge/trash/')) f.disk.files.set(path, { text: '损坏的回收副本', modified: 999 })
    })
    await expect(confirmMissingChapterFileDeletionsV1(f.input)).rejects.toThrow('回收副本')
    expect(await values()).toEqual(before)
    expect(await db.chapters.get(f.chapters[0]!.id!)).toEqual(f.chapters[0])
  })

  for (const target of ['chapter', 'binding'] as const) it(`rolls back both content and binding on native ${target} failure`, async () => {
    const f = await fixture()
    const before = await values()
    const fail = () => { throw new Error(`真实${target}删除失败`) }
    const table = target === 'chapter' ? db.chapters : db.workspaceDocuments
    table.hook('deleting', fail)
    try {
      await expect(confirmMissingChapterFileDeletionsV1(f.input)).rejects.toThrow(`真实${target}删除失败`)
      expect(await values()).toEqual(before)
    } finally { table.hook('deleting').unsubscribe(fail) }
  })

  it('keeps the authorized workspace when the caller mutates its options during archive IO', async () => {
    const f = await fixture()
    const other = await seedCurrentWorkspace('不属于本次删除的工作区')
    const otherRows = (await values()).projects
    f.disk.onClose(async path => {
      if (path.startsWith('.storyforge/trash/')) f.input.projectId = other.scope.projectId
    })
    const receipt = await confirmMissingChapterFileDeletionsV1(f.input)
    expect(receipt.projectId).toBe(f.scope.projectId)
    expect((await values()).projects).toEqual(otherRows)
    expect(JSON.parse(f.disk.files.get('.storyforge/recovery/project.json')!.text).backup.project.workspaceUid)
      .toBe((await db.projects.get(f.scope.projectId))!.workspaceUid)
  })

  for (const kind of ['body', 'summary'] as const)
    it(`rejects a real ${kind} update between projection and native deletion capture`, async () => {
      const f = await fixture()
      const marker = `INDEPENDENT_CAPTURE_WINDOW_${kind.toUpperCase()}`
      const content = `<p>${marker}</p>`
      const patch: Partial<Chapter> = kind === 'body' ? { content } : { summary: marker }
      const nativeTransaction = db.transaction
      let injected = 0
      let saved: ReturnType<typeof db.chapters.update> | undefined
      const capturedReads: Chapter[] = []
      const observeRead = (row: Chapter) => {
        const transaction = Dexie.currentTransaction
        if (row?.id === f.chapters[0]!.id && transaction?.mode === 'readonly'
          && transaction.storeNames.length === 5
          && transaction.storeNames.includes('chapters')
          && transaction.storeNames.includes('workspaceDocuments')) {
          capturedReads.push(structuredClone(row))
        }
        return row
      }
      db.chapters.hook('reading', observeRead)
      const observer = vi.spyOn(db, 'transaction').mockImplementation(function (
        this: typeof db,
        ...args: Parameters<typeof db.transaction>
      ) {
        const tables: readonly unknown[] = Array.isArray(args[1]) ? args[1] : []
        if (args[0] === 'r' && tables.length === 5 && tables.includes(db.chapters)
          && tables.includes(db.workspaceDocuments) && !injected) {
          injected++
          saved = db.chapters.update(f.chapters[0]!.id!, patch)
        }
        // Enqueue the real update, then preserve the actual receiver, arguments,
        // callback and exact native Dexie promise of the capture transaction.
        const original = nativeTransaction.apply(this, args)
        return original
      })
      let error: unknown
      try {
        try { await confirmMissingChapterFileDeletionsV1(f.input) }
        catch (cause) { error = cause }
        await saved
        expect(injected).toBe(1)
        expect(saved).toBeDefined()
        expect(capturedReads.length).toBeGreaterThan(0)
        expect(capturedReads.some(row => (
          kind === 'body' ? row.content === content : row.summary === marker
        ))).toBe(true)
        expect(error instanceof Error ? error.message : '').toContain('重新检查')
        expect(await db.chapters.get(f.chapters[0]!.id!)).toMatchObject(patch)
      } finally {
        observer.mockRestore()
        db.chapters.hook('reading').unsubscribe(observeRead)
      }
    })
})
