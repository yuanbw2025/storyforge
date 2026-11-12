import { workspaceWriteText } from '../helpers/workspace-projection-write'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  buildWorkspaceSelfCheckReportV1,
  buildWorkspaceFileAdoptionCandidatesV1,
  confirmMissingChapterFileDeletionsV1,
  resolveWorkspaceConflictsUsingDatabaseV1,
  recoverPendingWorkspaceSyncV1,
  synchronizeProjectChangesToFolderV1,
  WORKSPACE_FILE_SCAN_MAX_BYTES_V1,
  WORKSPACE_SCAN_MAX_TOTAL_BYTES_V1,
} from '../../src/lib/memory/workspace-projection'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { Chapter, OutlineNode } from '../../src/lib/types'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

/** Real UTF-8 size/mtime semantics, with explicit outside-writer injection points. */
function contentDirectory() {
  type Entry = { text: string; lastModified: number; reads: number; declaredSize?: number }
  const files = new Map<string, Entry>()
  const writes: string[] = []
  const budgetBodyReads: { path: string; declaredBytes: number }[] = []
  let clock = 100
  let afterHistory: (() => void) | undefined
  let afterOpen: { path: string; run: () => void } | undefined
  let afterStage: { path: string; run: () => void } | undefined
  let beforeRead: { path: string; remaining: number; run: () => void } | undefined
  let afterClose: { path: string; run: () => void } | undefined
  let afterTrash: (() => void) | undefined
  let aborts = 0
  const missing = () => new DOMException('not found', 'NotFoundError')
  const handle = (prefix: string): FileSystemDirectoryHandle => ({
    kind: 'directory', name: prefix || 'SFQA092',
    async getDirectoryHandle(name: string) { return handle(`${prefix}${name}/`) },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      const path = `${prefix}${name}`
      if (!files.has(path) && !options?.create) throw missing()
      if (!files.has(path)) files.set(path, { text: '', lastModified: ++clock, reads: 0 })
      return {
        kind: 'file', name,
        async getFile() {
          if (beforeRead?.path === path && --beforeRead.remaining === 0) {
            const actor = beforeRead.run
            beforeRead = undefined
            actor()
          }
          const current = files.get(path)
          if (!current) throw missing()
          const text = current.text
          const size = current.declaredSize ?? new TextEncoder().encode(text).byteLength
          return {
            size,
            lastModified: current.lastModified,
            async text() { return text },
            async arrayBuffer() {
              current.reads++
              if (current.declaredSize !== undefined) budgetBodyReads.push({ path, declaredBytes: size })
              return new TextEncoder().encode(text).buffer
            },
          } as File
        },
        async createWritable() {
          if (afterOpen?.path === path) {
            const actor = afterOpen.run
            afterOpen = undefined
            actor()
          }
          let next = ''
          let aborted = false
          return {
            async write(value: string | ArrayBuffer) {
              next = workspaceWriteText(value)
              if (afterStage?.path === path) {
                const actor = afterStage.run
                afterStage = undefined
                actor()
              }
            },
            async close() {
              if (aborted) throw new DOMException('aborted', 'InvalidStateError')
              files.set(path, { text: next, lastModified: ++clock, reads: 0 })
              writes.push(path)
              if (afterClose?.path === path) {
                const actor = afterClose.run
                afterClose = undefined
                actor()
              }
              if (path.startsWith('.storyforge/history/') && afterHistory) {
                const actor = afterHistory
                afterHistory = undefined
                actor()
              }
              if (path.startsWith('.storyforge/trash/') && afterTrash) {
                const actor = afterTrash
                afterTrash = undefined
                actor()
              }
            },
            async abort() { aborted = true; aborts++ },
          } as FileSystemWritableFileStream
        },
      } as FileSystemFileHandle
    },
  }) as FileSystemDirectoryHandle
  return {
    handle: handle(''), files, writes, budgetBodyReads,
    read(path: string) { return files.get(path)?.text ?? null },
    replace(path: string, text: string, preserveMetadata = false) {
      const old = files.get(path)
      if (!old) throw missing()
      if (preserveMetadata && new TextEncoder().encode(text).byteLength !== new TextEncoder().encode(old.text).byteLength) {
        throw new Error('fixture must preserve actual UTF-8 byte length')
      }
      files.set(path, { text, lastModified: preserveMetadata ? old.lastModified : ++clock, reads: 0 })
    },
    afterNextHistory(actor: () => void) { afterHistory = actor },
    afterWritableOpen(path: string, actor: () => void) { afterOpen = { path, run: actor } },
    afterWritableStage(path: string, actor: () => void) { afterStage = { path, run: actor } },
    afterWritableClose(path: string, actor: () => void) { afterClose = { path, run: actor } },
    beforeFileRead(path: string, nthRead: number, actor: () => void) { beforeRead = { path, remaining: nthRead, run: actor } },
    afterNextTrash(actor: () => void) { afterTrash = actor },
    abortCount() { return aborts },
  }
}

async function syncedWorkspace(withChapter = false) {
  const created = await seedCurrentWorkspace('CACHE_BASE')
  const projectId = created.scope.projectId
  let chapterId: number | undefined
  if (withChapter) {
    const now = Date.now()
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord(created.scope, 'outlineNodes', {
      projectId, parentId: null, type: 'chapter', title: '第一章', summary: '', order: 0,
      createdAt: now, updatedAt: now,
    }, { owner: 'work' }) as OutlineNode) as number
    chapterId = await db.chapters.add(stampNewRecord(created.scope, 'chapters', {
      projectId, outlineNodeId, title: '第一章', content: '<p>作者原稿。</p>',
      wordCount: 5, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
    }, { owner: 'work' }) as Chapter) as number
  }
  const disk = contentDirectory()
  const initial = await buildWorkspaceSelfCheckReportV1(projectId, disk.handle)
  await synchronizeProjectChangesToFolderV1({ projectId, root: disk.handle, expectedPlanHash: initial.plan.planHash })
  const binding = await db.workspaceDocuments.where('[projectId+tableName+recordId]')
    .equals([projectId, 'projects', projectId]).first()
  if (!binding) throw new Error('real initial sync must create the workspace binding')
  return { projectId, disk, binding, chapterId, original: disk.read(binding.relativePath)! }
}

async function stoppedSync(input: Parameters<typeof synchronizeProjectChangesToFolderV1>[0]) {
  try { return { receipt: await synchronizeProjectChangesToFolderV1(input), error: null } }
  catch (error) { return { receipt: null, error } }
}

describe('SFQA092 · actual content identity before workspace replacement', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { db.close() })

  it('rejects same-size/same-mtime external content in the public normal-sync path', async () => {
    const { projectId, disk, binding, original } = await syncedWorkspace()
    const external = original.replace('CACHE_BASE', 'DISK_DRAFT')
    disk.replace(binding.relativePath, external, true)
    await db.projects.update(projectId, { name: 'DB_CURRENT' })
    const manifest = disk.read('.storyforge/manifest.json')
    const report = await buildWorkspaceSelfCheckReportV1(projectId, disk.handle)
    const result = await stoppedSync({ projectId, root: disk.handle, expectedPlanHash: report.plan.planHash })
    console.info('SFQA092 same-metadata', JSON.stringify({
      kind: report.plan.items.find(item => item.identity.documentId === binding.documentId)?.changeKind,
      state: result.receipt?.state ?? null,
      externalPreserved: disk.read(binding.relativePath) === external,
      externalInHistory: [...disk.files].some(([path, file]) => path.startsWith('.storyforge/history/') && file.text === external),
    }))
    expect(result.error, 'ordinary sync must stop before replacing the external draft').toBeInstanceOf(Error)
    expect(report.summary.conflict).toBe(1)
    expect(disk.read(binding.relativePath)).toBe(external)
    expect(disk.read('.storyforge/manifest.json')).toBe(manifest)
    expect((await db.workspaceDocuments.get(binding.id!))?.lastSyncRevision).toBe(binding.lastSyncRevision)
  })

  it.each(['history', 'writable-open', 'writable-stage'] as const)('rejects a real external edit during %s before replacement', async phase => {
    const { projectId, disk, binding, original } = await syncedWorkspace()
    await db.projects.update(projectId, { name: 'DB_CURRENT' })
    const report = await buildWorkspaceSelfCheckReportV1(projectId, disk.handle)
    const external = original.replace('CACHE_BASE', 'DISK_DRAFT')
    const actor = () => disk.replace(binding.relativePath, external, true)
    if (phase === 'history') disk.afterNextHistory(actor)
    else if (phase === 'writable-open') disk.afterWritableOpen(binding.relativePath, actor)
    else disk.afterWritableStage(binding.relativePath, actor)
    const manifest = disk.read('.storyforge/manifest.json')
    const result = await stoppedSync({ projectId, root: disk.handle, expectedPlanHash: report.plan.planHash })
    console.info('SFQA092 preimage-race', JSON.stringify({ phase, state: result.receipt?.state ?? null,
      externalPreserved: disk.read(binding.relativePath) === external, aborts: disk.abortCount() }))
    expect(result.error, 'a changed real preimage must stop the write saga').toBeInstanceOf(Error)
    expect(disk.read(binding.relativePath)).toBe(external)
    expect(disk.read('.storyforge/manifest.json')).toBe(manifest)
    expect((await db.workspaceDocuments.get(binding.id!))?.lastSyncRevision).toBe(binding.lastSyncRevision)
    expect(disk.read('.storyforge/transactions/pending.json')).not.toBeNull()
    if (phase !== 'history') expect(disk.abortCount()).toBe(1)
  })

  it('rechecks a frozen plan even when a later disk edit preserves size and mtime', async () => {
    const { projectId, disk, binding, original } = await syncedWorkspace()
    await db.projects.update(projectId, { name: 'DB_CURRENT' })
    const report = await buildWorkspaceSelfCheckReportV1(projectId, disk.handle)
    const external = original.replace('CACHE_BASE', 'DISK_DRAFT')
    disk.replace(binding.relativePath, external, true)
    const manifest = disk.read('.storyforge/manifest.json')
    const result = await stoppedSync({ projectId, root: disk.handle, expectedPlanHash: report.plan.planHash })
    expect(result.error).toBeInstanceOf(Error)
    expect(disk.read(binding.relativePath)).toBe(external)
    expect(disk.read('.storyforge/manifest.json')).toBe(manifest)
    expect((await buildWorkspaceSelfCheckReportV1(projectId, disk.handle)).summary.conflict).toBe(1)
  })

  it('reads unchanged contents once and treats changed formatting as the same canonical content', async () => {
    const { projectId, disk, binding, original } = await syncedWorkspace()
    disk.replace(binding.relativePath, JSON.stringify(JSON.parse(original)))
    const report = await buildWorkspaceSelfCheckReportV1(projectId, disk.handle)
    expect(report.plan.items.find(item => item.identity.documentId === binding.documentId)?.changeKind).toBe('clean')
    expect(disk.files.get(binding.relativePath)?.reads).toBe(1)
    expect(report.zeroModelCalls).toBe(true)
  })

  it('enforces the total declared-byte budget before reading further bodies without allocating large payloads', async () => {
    const { projectId, disk } = await syncedWorkspace()
    const bindings = await db.workspaceDocuments.where('projectId').equals(projectId).toArray()
    expect(bindings.length).toBeGreaterThan(WORKSPACE_SCAN_MAX_TOTAL_BYTES_V1 / WORKSPACE_FILE_SCAN_MAX_BYTES_V1)
    let actualPayloadBytes = 0
    for (const binding of bindings) {
      const entry = disk.files.get(binding.relativePath)
      if (!entry) throw new Error('the real initial sync must materialize every document')
      actualPayloadBytes += new TextEncoder().encode(entry.text).byteLength
      // Virtual File.size promises model full-size bodies; their returned text
      // stays tiny. Count promised bytes consumed at each actual text() call.
      // This is a control-flow proof, not a large-memory or performance test.
      entry.declaredSize = WORKSPACE_FILE_SCAN_MAX_BYTES_V1
    }
    expect(actualPayloadBytes).toBeLessThan(1024 * 1024)
    const report = await buildWorkspaceSelfCheckReportV1(projectId, disk.handle)
    const consumed = disk.budgetBodyReads.reduce((sum, read) => sum + read.declaredBytes, 0)
    expect(consumed, 'actual text() calls must stop within the cumulative promised-byte budget').toBeLessThanOrEqual(WORKSPACE_SCAN_MAX_TOTAL_BYTES_V1)
    expect(disk.budgetBodyReads).toHaveLength(4)
    const readPaths = new Set(disk.budgetBodyReads.map(read => read.path))
    const blocked = report.plan.items.filter(item => !readPaths.has(item.relativePath))
    expect(blocked.length).toBeGreaterThan(0)
    expect(blocked.every(item => item.changeKind === 'invalid' && item.issues.some(issue => issue.includes('本次扫描超过大小上限')))).toBe(true)
  })

  it('does not overwrite an outside file created while opening an initially missing target', async () => {
    const created = await seedCurrentWorkspace('CACHE_BASE')
    const projectId = created.scope.projectId
    const disk = contentDirectory()
    const report = await buildWorkspaceSelfCheckReportV1(projectId, disk.handle)
    const binding = await db.workspaceDocuments.where('[projectId+tableName+recordId]')
      .equals([projectId, 'projects', projectId]).first()
    if (!binding) throw new Error('public projection must create an actual registered binding')
    const external = '作者在另一个编辑器刚刚新建的原稿'
    disk.afterWritableOpen(binding.relativePath, () => disk.replace(binding.relativePath, external))
    const result = await stoppedSync({ projectId, root: disk.handle, expectedPlanHash: report.plan.planHash })
    expect(result.error).toBeInstanceOf(Error)
    expect(disk.read(binding.relativePath)).toBe(external)
    expect(disk.read('.storyforge/manifest.json')).toBeNull()
    expect((await db.workspaceDocuments.get(binding.id!))?.lastSyncRevision).toBe(0)
    expect(disk.abortCount()).toBe(1)
  })

  it('rejects a changed actual file between verified report and candidate parsing', async () => {
    const { projectId, disk, binding, original } = await syncedWorkspace()
    disk.replace(binding.relativePath, original.replace('CACHE_BASE', 'DISK_DRAFT'), true)
    const report = await buildWorkspaceSelfCheckReportV1(projectId, disk.handle)
    const latest = original.replace('CACHE_BASE', 'NEXT_DRAFT')
    disk.beforeFileRead(binding.relativePath, 2, () => disk.replace(binding.relativePath, latest, true))
    await expect(buildWorkspaceFileAdoptionCandidatesV1({
      projectId, root: disk.handle, expectedPlanHash: report.plan.planHash,
    })).rejects.toThrow('候选文件已变化')
    expect((await db.projects.get(projectId))?.name).toBe('CACHE_BASE')
    expect(disk.read(binding.relativePath)).toBe(latest)
  })

  it('does not delete a real chapter whose missing file reappears during the trash archive', async () => {
    const { projectId, disk, chapterId } = await syncedWorkspace(true)
    const binding = await db.workspaceDocuments.where('[projectId+tableName+recordId]')
      .equals([projectId, 'chapters', chapterId!]).first()
    if (!binding) throw new Error('initial sync must include the real registered chapter')
    const original = disk.read(binding.relativePath)!
    disk.files.delete(binding.relativePath)
    const report = await buildWorkspaceSelfCheckReportV1(projectId, disk.handle)
    const manifest = disk.read('.storyforge/manifest.json')
    disk.afterNextTrash(() => disk.files.set(binding.relativePath, { text: original, lastModified: 10_000, reads: 0 }))
    await expect(confirmMissingChapterFileDeletionsV1({
      projectId, root: disk.handle, expectedPlanHash: report.plan.planHash,
    })).rejects.toThrow('硬盘文件已变化')
    expect(await db.chapters.get(chapterId!)).toBeDefined()
    expect(await db.workspaceDocuments.get(binding.id!)).toBeDefined()
    expect(disk.read(binding.relativePath)).toBe(original)
    expect(disk.read('.storyforge/manifest.json')).toBe(manifest)
  })

  it('does not attest a completed write when an outside editor changes only BOM before readback', async () => {
    const { projectId, disk, binding } = await syncedWorkspace()
    await db.projects.update(projectId, { name: 'DB_CURRENT' })
    const before = await buildWorkspaceSelfCheckReportV1(projectId, disk.handle)
    const manifest = disk.read('.storyforge/manifest.json')
    disk.afterWritableClose(binding.relativePath, () => disk.replace(binding.relativePath, '\ufeff' + disk.read(binding.relativePath)))
    await expect(synchronizeProjectChangesToFolderV1({
      projectId, root: disk.handle, expectedPlanHash: before.plan.planHash,
    })).rejects.toThrow('写后回读失败')
    expect(disk.read(binding.relativePath)?.startsWith('\ufeff')).toBe(true)
    expect(disk.read('.storyforge/manifest.json')).toBe(manifest)
    expect(await db.workspaceDocuments.get(binding.id!)).toEqual(binding)
  })

  it('preserves an outside damaged manuscript when resuming an interrupted write', async () => {
    const { projectId, disk, binding } = await syncedWorkspace()
    await db.projects.update(projectId, { name: 'DB_CURRENT' })
    const before = await buildWorkspaceSelfCheckReportV1(projectId, disk.handle)
    const manifest = disk.read('.storyforge/manifest.json')
    const outside = '{unfinished author text'
    disk.afterWritableStage(binding.relativePath, () => disk.replace(binding.relativePath, outside))
    await expect(synchronizeProjectChangesToFolderV1({
      projectId, root: disk.handle, expectedPlanHash: before.plan.planHash,
    })).rejects.toThrow('硬盘文件已变化')
    const writes = [...disk.writes]
    await expect(recoverPendingWorkspaceSyncV1(projectId, disk.handle)).rejects.toThrow('拒绝覆盖')
    expect(disk.writes).toEqual(writes)
    expect(disk.read(binding.relativePath)).toBe(outside)
    expect(disk.read('.storyforge/manifest.json')).toBe(manifest)
    expect(await db.workspaceDocuments.get(binding.id!)).toEqual(binding)
  })

  it('keeps explicit project-wins, exact disk history and a truthful completed receipt', async () => {
    const { projectId, disk, binding, original } = await syncedWorkspace()
    const external = original.replace('CACHE_BASE', 'DISK_DRAFT')
    disk.replace(binding.relativePath, external, true)
    await db.projects.update(projectId, { name: 'DB_CURRENT' })
    const report = await buildWorkspaceSelfCheckReportV1(projectId, disk.handle)
    const receipt = await resolveWorkspaceConflictsUsingDatabaseV1({ projectId, root: disk.handle, expectedPlanHash: report.plan.planHash })
    expect(receipt.state).toBe('completed')
    expect(disk.read(binding.relativePath)).toContain('DB_CURRENT')
    expect([...disk.files].some(([path, file]) => path.startsWith('.storyforge/history/') && file.text === external)).toBe(true)
    expect((await buildWorkspaceSelfCheckReportV1(projectId, disk.handle)).summary.conflict).toBe(0)
  })
})
