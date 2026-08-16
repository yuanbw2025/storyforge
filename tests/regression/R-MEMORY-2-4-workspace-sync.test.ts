import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { db } from '../../src/lib/db/schema'
import { generateWorkspaceUid } from '../../src/lib/memory/identity'
import {
  buildWorkspaceSelfCheckReportV1,
  buildWorkspaceFileAdoptionCandidatesV1,
  adoptWorkspaceFileChangesV1,
  chapterHtmlToWorkspaceMarkdownV1,
  classifyWorkspaceDocumentChangeV1,
  resolveWorkspaceConflictsUsingDatabaseV1,
  restoreWorkspaceFromFolderV1,
  confirmMissingChapterFileDeletionsV1,
  recoverPendingWorkspaceSyncV1,
  exportWorkspacePackageV1,
  importWorkspacePackageV1,
  synchronizeProjectChangesToFolderV1,
  workspaceMarkdownToChapterHtmlV1,
} from '../../src/lib/memory/workspace-projection'
import { adopt, hashAdoptRecordFieldsV1 } from '../../src/lib/registry/adopt'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

function notFound(): DOMException {
  return new DOMException('not found', 'NotFoundError')
}

function makeFakeWorkspaceDirectory(name = 'StoryForgeMemory') {
  type Dir = {
    files: Map<string, string>
    directories: Map<string, Dir>
  }
  const root: Dir = { files: new Map(), directories: new Map() }
  const writeOrder: string[] = []
  let failAtWrite: number | null = null

  function directoryHandle(dir: Dir, prefix: string): FileSystemDirectoryHandle {
    return {
      kind: 'directory',
      name: prefix.split('/').filter(Boolean).at(-1) ?? name,
      async getDirectoryHandle(part: string, options?: { create?: boolean }) {
        let child = dir.directories.get(part)
        if (!child && options?.create) {
          child = { files: new Map(), directories: new Map() }
          dir.directories.set(part, child)
        }
        if (!child) throw notFound()
        return directoryHandle(child, `${prefix}${part}/`)
      },
      async getFileHandle(fileName: string, options?: { create?: boolean }) {
        if (!dir.files.has(fileName) && !options?.create) throw notFound()
        if (!dir.files.has(fileName)) dir.files.set(fileName, '')
        return {
          kind: 'file',
          name: fileName,
          async getFile() {
            const text = dir.files.get(fileName)
            if (text == null) throw notFound()
            return { async text() { return text } } as File
          },
          async createWritable() {
            let next = ''
            return {
              async write(value: string | Blob | BufferSource) { next += String(value) },
              async close() {
                if (failAtWrite != null && writeOrder.length + 1 === failAtWrite) {
                  failAtWrite = null
                  throw new DOMException('simulated permission loss', 'NotAllowedError')
                }
                dir.files.set(fileName, next)
                writeOrder.push(`${prefix}${fileName}`)
              },
            } as FileSystemWritableFileStream
          },
        } as FileSystemFileHandle
      },
    } as FileSystemDirectoryHandle
  }

  function locate(path: string): { dir: Dir; name: string } {
    const parts = path.split('/').filter(Boolean)
    const fileName = parts.pop()!
    let dir = root
    for (const part of parts) {
      const child = dir.directories.get(part)
      if (!child) throw notFound()
      dir = child
    }
    return { dir, name: fileName }
  }

  return {
    handle: directoryHandle(root, ''),
    writeOrder,
    failOnWrite(number: number): void { failAtWrite = number },
    read(path: string): string | null {
      try {
        const target = locate(path)
        return target.dir.files.get(target.name) ?? null
      } catch {
        return null
      }
    },
    write(path: string, value: string): void {
      const parts = path.split('/').filter(Boolean)
      const fileName = parts.pop()!
      let dir = root
      for (const part of parts) {
        let child = dir.directories.get(part)
        if (!child) {
          child = { files: new Map(), directories: new Map() }
          dir.directories.set(part, child)
        }
        dir = child
      }
      dir.files.set(fileName, value)
    },
    remove(path: string): void {
      const target = locate(path)
      target.dir.files.delete(target.name)
    },
  }
}

async function seedWorkspace() {
  const now = Date.now()
  const projectId = await db.projects.add({
    workspaceUid: generateWorkspaceUid(),
    name: '磁盘记忆', genre: 'fantasy', genres: ['fantasy'], status: 'drafting',
    description: '三方核对', targetWordCount: 100_000, createdAt: now, updatedAt: now,
  } as any) as number
  const ownership = await ensureWorkspaceOwnership(projectId)
  const outlineNodeId = await db.outlineNodes.add({
    projectId, workId: ownership.scope.workId,
    parentId: null, type: 'chapter', title: '第一章', summary: '', order: 0,
    createdAt: now, updatedAt: now,
  } as any) as number
  const chapterId = await db.chapters.add({
    projectId, workId: ownership.scope.workId, outlineNodeId, title: '第一章',
    content: '<p>潮声穿过旧港。</p><p><strong>灯没有灭。</strong></p>',
    wordCount: 12, status: 'draft', order: 0, notes: '作者笔记',
    createdAt: now, updatedAt: now,
  } as any) as number
  return { projectId, chapterId }
}

describe('MEMORY-2～4 · registered projection and author-triggered sync', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('classifies the closed B/D/F matrix deterministically', () => {
    expect(classifyWorkspaceDocumentChangeV1({ baselineCanonicalHash: null, databaseCanonicalHash: 'd', fileCanonicalHash: null }))
      .toBe('project-changed')
    expect(classifyWorkspaceDocumentChangeV1({ baselineCanonicalHash: 'b', databaseCanonicalHash: 'b', fileCanonicalHash: 'f' }))
      .toBe('file-changed')
    expect(classifyWorkspaceDocumentChangeV1({ baselineCanonicalHash: 'b', databaseCanonicalHash: 'd', fileCanonicalHash: 'f' }))
      .toBe('conflict')
    expect(classifyWorkspaceDocumentChangeV1({ baselineCanonicalHash: 'b', databaseCanonicalHash: 'd', fileCanonicalHash: 'd' }))
      .toBe('same-change')
    expect(classifyWorkspaceDocumentChangeV1({ baselineCanonicalHash: 'b', databaseCanonicalHash: 'b', fileCanonicalHash: null }))
      .toBe('file-missing')
    expect(classifyWorkspaceDocumentChangeV1({ baselineCanonicalHash: 'b', databaseCanonicalHash: 'b', fileCanonicalHash: 'b', fileInvalid: true }))
      .toBe('invalid')
  })

  it('writes the initial readable workspace only after self-check and commits manifest last', async () => {
    const seeded = await seedWorkspace()
    const fake = makeFakeWorkspaceDirectory()
    const report = await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)
    expect(report.zeroModelCalls).toBe(true)
    expect(report.summary.projectChanged).toBe(6)

    const receipt = await synchronizeProjectChangesToFolderV1({
      projectId: seeded.projectId,
      root: fake.handle,
      expectedPlanHash: report.plan.planHash,
    })
    expect(receipt.state).toBe('completed')
    expect(fake.writeOrder.at(-1)).toBe('.storyforge/manifest.json')
    const chapterPath = (await db.workspaceDocuments.where('tableName').equals('chapters').first())!.relativePath
    expect(fake.read(chapterPath)).toContain('潮声穿过旧港。')
    expect(fake.read(chapterPath)).toContain('**灯没有灭。**')
    expect(fake.read(chapterPath)).not.toContain('<p>')
    expect(JSON.parse(fake.read('.storyforge/manifest.json')!).manifestHash).toBe(receipt.manifestHash)

    const clean = await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)
    expect(clean.summary).toMatchObject({ clean: 6, projectChanged: 0, fileChanged: 0, conflict: 0 })
  })

  it('never overwrites an external edit and detects a two-sided conflict', async () => {
    const seeded = await seedWorkspace()
    const fake = makeFakeWorkspaceDirectory()
    const initial = await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)
    await synchronizeProjectChangesToFolderV1({ projectId: seeded.projectId, root: fake.handle, expectedPlanHash: initial.plan.planHash })
    const chapterBinding = await db.workspaceDocuments.where('tableName').equals('chapters').first()
    const original = fake.read(chapterBinding!.relativePath)!
    fake.write(chapterBinding!.relativePath, original.replace('潮声穿过旧港。', '硬盘改写了潮声。'))

    const fileChanged = await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)
    expect(fileChanged.summary.fileChanged).toBe(1)
    await expect(synchronizeProjectChangesToFolderV1({
      projectId: seeded.projectId, root: fake.handle, expectedPlanHash: fileChanged.plan.planHash,
    })).rejects.toThrow('拒绝覆盖')
    expect(fake.read(chapterBinding!.relativePath)).toContain('硬盘改写了潮声。')

    await db.chapters.update(seeded.chapterId, { content: '<p>项目内也改写了正文。</p>', updatedAt: Date.now() })
    const conflict = await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)
    expect(conflict.summary.conflict).toBe(1)
  })

  it('rejects a stale frozen plan and restores an explicitly missing file', async () => {
    const seeded = await seedWorkspace()
    const fake = makeFakeWorkspaceDirectory()
    const initial = await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)
    await db.chapters.update(seeded.chapterId, { content: '<p>计划冻结后又变化。</p>', updatedAt: Date.now() })
    await expect(synchronizeProjectChangesToFolderV1({
      projectId: seeded.projectId, root: fake.handle, expectedPlanHash: initial.plan.planHash,
    })).rejects.toThrow('请重新检查')

    const fresh = await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)
    await synchronizeProjectChangesToFolderV1({ projectId: seeded.projectId, root: fake.handle, expectedPlanHash: fresh.plan.planHash })
    const chapterPath = (await db.workspaceDocuments.where('tableName').equals('chapters').first())!.relativePath
    fake.remove(chapterPath)
    const missing = await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)
    expect(missing.summary.missing).toBe(1)
    await synchronizeProjectChangesToFolderV1({ projectId: seeded.projectId, root: fake.handle, expectedPlanHash: missing.plan.planHash })
    expect(fake.read(chapterPath)).toContain('计划冻结后又变化。')
  })

  it('keeps common rich text readable and round-trippable through Markdown', () => {
    const markdown = chapterHtmlToWorkspaceMarkdownV1('<p>第一段。</p><p><strong>重要</strong>，以及<em>强调</em>。</p>')
    expect(markdown).toContain('**重要**')
    expect(markdown).toContain('*强调*')
    const html = workspaceMarkdownToChapterHtmlV1(markdown)
    expect(html).toContain('<strong>重要</strong>')
    expect(html).toContain('<em>强调</em>')
  })

  it('stages all editable disk documents and adopts them through registered CAS before advancing the baseline', async () => {
    const seeded = await seedWorkspace()
    const fake = makeFakeWorkspaceDirectory()
    const initial = await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)
    await synchronizeProjectChangesToFolderV1({ projectId: seeded.projectId, root: fake.handle, expectedPlanHash: initial.plan.planHash })

    const bindings = await db.workspaceDocuments.where('projectId').equals(seeded.projectId).toArray()
    const byTable = new Map(bindings.map(binding => [binding.tableName, binding]))
    const projectFile = JSON.parse(fake.read(byTable.get('projects')!.relativePath)!)
    projectFile.data.name = '硬盘上的新书名'
    projectFile.data.description = ''
    fake.write(byTable.get('projects')!.relativePath, `${JSON.stringify(projectFile, null, 2)}\n`)

    const worldFile = parseYaml(fake.read(byTable.get('worlds')!.relativePath)!)
    worldFile.data.description = '由作者在 YAML 中补充的世界说明'
    fake.write(byTable.get('worlds')!.relativePath, stringifyYaml(worldFile, { lineWidth: 0, sortMapEntries: true }))

    const workFile = parseYaml(fake.read(byTable.get('works')!.relativePath)!)
    workFile.data.title = '硬盘中的作品标题'
    workFile.data.genres = ['fantasy', 'mystery']
    fake.write(byTable.get('works')!.relativePath, stringifyYaml(workFile, { lineWidth: 0, sortMapEntries: true }))

    const chapterPath = byTable.get('chapters')!.relativePath
    fake.write(chapterPath, fake.read(chapterPath)!
      .replace('title: 第一章', 'title: 港口回声')
      .replace('潮声穿过旧港。', '作者从硬盘重写了港口的潮声。'))

    const report = await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)
    expect(report.summary.fileChanged).toBe(4)
    const staged = await buildWorkspaceFileAdoptionCandidatesV1({
      projectId: seeded.projectId,
      root: fake.handle,
      expectedPlanHash: report.plan.planHash,
    })
    expect(staged.zeroModelCalls).toBe(true)
    expect(staged.blockedDocumentIds).toEqual([])
    expect(staged.candidates).toHaveLength(4)
    expect(staged.candidates.find(candidate => candidate.tableName === 'chapters')?.changedFields)
      .toEqual(expect.arrayContaining(['content', 'title', 'wordCount']))

    const receipt = await adoptWorkspaceFileChangesV1({
      projectId: seeded.projectId,
      root: fake.handle,
      expectedPlanHash: report.plan.planHash,
    })
    expect(receipt.databaseAdoptionReceiptHashes).toHaveLength(5)
    expect((await db.projects.get(seeded.projectId))?.name).toBe('硬盘上的新书名')
    expect((await db.projects.get(seeded.projectId))?.description).toBe('')
    expect((await db.worlds.where('projectId').equals(seeded.projectId).first())?.description)
      .toBe('由作者在 YAML 中补充的世界说明')
    expect((await db.works.where('projectId').equals(seeded.projectId).first())?.genres)
      .toEqual(['fantasy', 'mystery'])
    const chapter = await db.chapters.get(seeded.chapterId)
    expect(chapter?.title).toBe('港口回声')
    expect(chapter?.content).toContain('作者从硬盘重写了港口的潮声。')
    expect(chapter?.wordCount).toBeGreaterThan(0)
    expect((await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)).summary.clean).toBe(6)
  })

  it('requires an explicit file-wins decision for a two-sided conflict', async () => {
    const seeded = await seedWorkspace()
    const fake = makeFakeWorkspaceDirectory()
    const initial = await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)
    await synchronizeProjectChangesToFolderV1({ projectId: seeded.projectId, root: fake.handle, expectedPlanHash: initial.plan.planHash })
    const binding = await db.workspaceDocuments.where('tableName').equals('chapters').first()
    fake.write(binding!.relativePath, fake.read(binding!.relativePath)!.replace('潮声穿过旧港。', '硬盘版本胜出。'))
    await db.chapters.update(seeded.chapterId, { title: '项目内版本', updatedAt: Date.now() })

    const conflict = await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)
    expect(conflict.summary.conflict).toBe(1)
    await expect(adoptWorkspaceFileChangesV1({
      projectId: seeded.projectId,
      root: fake.handle,
      expectedPlanHash: conflict.plan.planHash,
    })).rejects.toThrow('冲突')

    await adoptWorkspaceFileChangesV1({
      projectId: seeded.projectId,
      root: fake.handle,
      expectedPlanHash: conflict.plan.planHash,
      conflictResolution: 'file-wins',
    })
    const adopted = await db.chapters.get(seeded.chapterId)
    expect(adopted?.title).toBe('第一章')
    expect(adopted?.content).toContain('硬盘版本胜出。')
  })

  it('can explicitly choose the project version while archiving the conflicting disk file', async () => {
    const seeded = await seedWorkspace()
    const fake = makeFakeWorkspaceDirectory()
    const initial = await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)
    await synchronizeProjectChangesToFolderV1({ projectId: seeded.projectId, root: fake.handle, expectedPlanHash: initial.plan.planHash })
    const binding = await db.workspaceDocuments.where('tableName').equals('chapters').first()
    fake.write(binding!.relativePath, fake.read(binding!.relativePath)!.replace('潮声穿过旧港。', '应当进入历史的硬盘版本。'))
    await db.chapters.update(seeded.chapterId, { title: '保留项目版本', updatedAt: Date.now() })
    const conflict = await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)

    await resolveWorkspaceConflictsUsingDatabaseV1({
      projectId: seeded.projectId,
      root: fake.handle,
      expectedPlanHash: conflict.plan.planHash,
    })
    expect(fake.read(binding!.relativePath)).toContain('title: 保留项目版本')
    expect(fake.read(`.storyforge/history/${conflict.plan.planId}/${binding!.relativePath}`))
      .toContain('应当进入历史的硬盘版本。')
    expect((await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)).summary.clean).toBe(6)
  })

  it('rejects a staged multi-field candidate when any protected database field changes before adoption', async () => {
    const seeded = await seedWorkspace()
    const ownership = await ensureWorkspaceOwnership(seeded.projectId)
    const chapter = await db.chapters.get(seeded.chapterId) as any
    const fields = ['title', 'status', 'order', 'notes', 'content', 'wordCount']
    const expectedHash = await hashAdoptRecordFieldsV1(chapter, fields)
    await db.chapters.update(seeded.chapterId, { notes: '候选生成后项目又变化', updatedAt: Date.now() })
    const result = await adopt({
      projectId: seeded.projectId,
      scope: ownership.scope,
      recordId: seeded.chapterId,
      target: 'chapters',
      mode: 'replace',
      data: { title: '过期候选不得写入' },
      compareAndSet: { kind: 'record-fields-value-hash', fields, expectedHash },
    })
    expect(result.written).toEqual([])
    expect(result.skipped[0]?.reason).toContain('CAS 失败')
    expect((await db.chapters.get(seeded.chapterId))?.title).toBe('第一章')
  })

  it('quarantines structurally valid files with unknown or missing editable fields', async () => {
    const seeded = await seedWorkspace()
    const fake = makeFakeWorkspaceDirectory()
    const initial = await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)
    await synchronizeProjectChangesToFolderV1({ projectId: seeded.projectId, root: fake.handle, expectedPlanHash: initial.plan.planHash })
    const binding = await db.workspaceDocuments.where('tableName').equals('projects').first()
    const projectFile = JSON.parse(fake.read(binding!.relativePath)!)
    projectFile.data.unregisteredShortcut = '不得落库'
    fake.write(binding!.relativePath, `${JSON.stringify(projectFile, null, 2)}\n`)
    const report = await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)
    expect(report.summary.invalid).toBe(1)
    expect(report.plan.items.find(item => item.changeKind === 'invalid')?.issues[0]).toContain('字段不匹配')
  })

  it('restores registered formal content and evidence into an empty database with remapped local IDs', async () => {
    const seeded = await seedWorkspace()
    const ownership = await ensureWorkspaceOwnership(seeded.projectId)
    await db.notes.add({
      projectId: seeded.projectId,
      workId: ownership.scope.workId,
      chapterId: seeded.chapterId,
      content: '恢复胶囊中的正式笔记证据',
      color: 'yellow',
      pinned: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any)
    const fake = makeFakeWorkspaceDirectory()
    const initial = await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)
    await synchronizeProjectChangesToFolderV1({ projectId: seeded.projectId, root: fake.handle, expectedPlanHash: initial.plan.planHash })
    expect(fake.read('.storyforge/recovery/project.json')).toContain('恢复胶囊中的正式笔记证据')

    await db.delete()
    await db.open()
    const dummyProjectId = await db.projects.add({
      workspaceUid: generateWorkspaceUid(), name: '占位项目', genre: 'other', genres: [], status: 'drafting',
      description: '', targetWordCount: 1, createdAt: Date.now(), updatedAt: Date.now(),
    } as any) as number
    await ensureWorkspaceOwnership(dummyProjectId)

    const restored = await restoreWorkspaceFromFolderV1(fake.handle)
    expect(restored.projectId).not.toBe(seeded.projectId)
    expect((await db.projects.get(restored.projectId))?.name).toBe('磁盘记忆')
    const restoredChapter = await db.chapters.where('projectId').equals(restored.projectId).first()
    expect(restoredChapter?.content).toContain('潮声穿过旧港。')
    const restoredNote = await db.notes.where('projectId').equals(restored.projectId).first() as any
    expect(restoredNote?.content).toBe('恢复胶囊中的正式笔记证据')
    expect(restoredNote?.chapterId).toBe(restoredChapter?.id)
    expect(restored.report.summary.clean).toBe(6)
  })

  it('treats a missing chapter as deletion only after confirmation and preserves a trash copy', async () => {
    const seeded = await seedWorkspace()
    const fake = makeFakeWorkspaceDirectory()
    const initial = await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)
    await synchronizeProjectChangesToFolderV1({ projectId: seeded.projectId, root: fake.handle, expectedPlanHash: initial.plan.planHash })
    const binding = await db.workspaceDocuments.where('tableName').equals('chapters').first()
    fake.remove(binding!.relativePath)
    const missing = await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)
    expect(missing.summary.missing).toBe(1)
    expect(await db.chapters.get(seeded.chapterId)).toBeDefined()

    await confirmMissingChapterFileDeletionsV1({
      projectId: seeded.projectId,
      root: fake.handle,
      expectedPlanHash: missing.plan.planHash,
    })
    expect(await db.chapters.get(seeded.chapterId)).toBeUndefined()
    expect(fake.read(`.storyforge/trash/${missing.plan.planId}/${binding!.relativePath}`)).toContain('潮声穿过旧港。')
    expect((await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)).summary.clean).toBe(5)
    expect(JSON.parse(fake.read('.storyforge/recovery/project.json')!).backup.chapters).toEqual([])
  })

  it('never interprets a missing workspace root as a deletion request', async () => {
    const seeded = await seedWorkspace()
    const fake = makeFakeWorkspaceDirectory()
    const initial = await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)
    await synchronizeProjectChangesToFolderV1({ projectId: seeded.projectId, root: fake.handle, expectedPlanHash: initial.plan.planHash })
    fake.remove('storyforge.workspace.json')
    const missing = await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)
    await expect(confirmMissingChapterFileDeletionsV1({
      projectId: seeded.projectId,
      root: fake.handle,
      expectedPlanHash: missing.plan.planHash,
    })).rejects.toThrow('不允许按文件删除根记录')
    expect(await db.projects.get(seeded.projectId)).toBeDefined()
  })

  it('resumes a partial multi-file write without repeating database adoption or model work', async () => {
    const seeded = await seedWorkspace()
    const fake = makeFakeWorkspaceDirectory()
    const initial = await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)
    fake.failOnWrite(4)
    await expect(synchronizeProjectChangesToFolderV1({
      projectId: seeded.projectId, root: fake.handle, expectedPlanHash: initial.plan.planHash,
    })).rejects.toThrow('simulated permission loss')
    expect(fake.read('.storyforge/manifest.json')).toBeNull()
    const interrupted = await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)
    expect(interrupted.summary.sameChange).toBeGreaterThan(0)
    expect(interrupted.summary.projectChanged).toBeGreaterThan(0)

    const receipt = await recoverPendingWorkspaceSyncV1(seeded.projectId, fake.handle)
    expect(receipt.databaseAdoptionReceiptHashes).toEqual([])
    expect(fake.writeOrder.at(-1)).toBe('.storyforge/manifest.json')
    const clean = await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)
    expect(clean.summary.clean).toBe(6)
    expect(clean.zeroModelCalls).toBe(true)
  })

  it('exports and restores a self-verifying workspace package without File System Access support', async () => {
    const seeded = await seedWorkspace()
    const fake = makeFakeWorkspaceDirectory()
    const initial = await buildWorkspaceSelfCheckReportV1(seeded.projectId, fake.handle)
    await synchronizeProjectChangesToFolderV1({ projectId: seeded.projectId, root: fake.handle, expectedPlanHash: initial.plan.planHash })
    const pkg = await exportWorkspacePackageV1(seeded.projectId, fake.handle)
    expect(pkg.format).toBe('storyforge-workspace-package')
    expect(pkg.files.some(file => file.relativePath.endsWith('.md'))).toBe(true)
    expect(pkg.files.some(file => file.relativePath === '.storyforge/recovery/project.json')).toBe(true)

    const tampered = JSON.parse(JSON.stringify(pkg))
    tampered.files[0].text += 'tampered'
    await expect(importWorkspacePackageV1(tampered)).rejects.toThrow('hash')

    await db.delete()
    await db.open()
    const restored = await importWorkspacePackageV1(pkg)
    expect((await db.projects.get(restored.projectId))?.name).toBe('磁盘记忆')
    expect(restored.report.summary.clean).toBe(6)
  })
})
