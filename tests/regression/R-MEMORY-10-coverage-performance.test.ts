import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { generateWorkspaceUid } from '../../src/lib/memory/identity'
import {
  buildWorkspaceFileAdoptionCandidatesV1,
  buildWorkspaceSelfCheckReportV1,
  synchronizeProjectChangesToFolderV1,
  WORKSPACE_FILE_SCAN_MAX_BYTES_V1,
} from '../../src/lib/memory/workspace-projection'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

function notFound(): DOMException { return new DOMException('not found', 'NotFoundError') }

function metadataDirectory() {
  type FileNode = { text: string; lastModified: number; textReads: number; declaredSize?: number }
  type Dir = { files: Map<string, FileNode>; dirs: Map<string, Dir> }
  const root: Dir = { files: new Map(), dirs: new Map() }
  let clock = 1000

  const dirHandle = (dir: Dir, prefix: string): FileSystemDirectoryHandle => ({
    kind: 'directory', name: prefix.split('/').filter(Boolean).at(-1) ?? 'memory-performance',
    async getDirectoryHandle(part: string, options?: { create?: boolean }) {
      let child = dir.dirs.get(part)
      if (!child && options?.create) { child = { files: new Map(), dirs: new Map() }; dir.dirs.set(part, child) }
      if (!child) throw notFound()
      return dirHandle(child, `${prefix}${part}/`)
    },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      let node = dir.files.get(name)
      if (!node && options?.create) {
        node = { text: '', lastModified: ++clock, textReads: 0 }
        dir.files.set(name, node)
      }
      if (!node) throw notFound()
      const target = node
      return {
        kind: 'file', name,
        async getFile() {
          return {
            size: target.declaredSize ?? new TextEncoder().encode(target.text).byteLength,
            lastModified: target.lastModified,
            async text() { target.textReads++; return target.text },
          } as File
        },
        async createWritable() {
          let next = ''
          return {
            async write(value: string | Blob | BufferSource) { next += String(value) },
            async close() {
              target.text = next
              target.declaredSize = undefined
              target.lastModified = ++clock
            },
          } as FileSystemWritableFileStream
        },
      } as FileSystemFileHandle
    },
  } as FileSystemDirectoryHandle)

  const locate = (path: string): FileNode => {
    const parts = path.split('/').filter(Boolean)
    const name = parts.pop()!
    let dir = root
    for (const part of parts) {
      const next = dir.dirs.get(part)
      if (!next) throw notFound()
      dir = next
    }
    const node = dir.files.get(name)
    if (!node) throw notFound()
    return node
  }

  return {
    handle: dirHandle(root, ''),
    read(path: string): string { return locate(path).text },
    write(path: string, text: string): void {
      const node = locate(path)
      node.text = text
      node.declaredSize = undefined
      node.lastModified = ++clock
    },
    resetReads(path: string): void { locate(path).textReads = 0 },
    reads(path: string): number { return locate(path).textReads },
    declareSize(path: string, size: number): void {
      const node = locate(path)
      node.declaredSize = size
      node.lastModified = ++clock
      node.textReads = 0
    },
  }
}

async function seed() {
  const now = Date.now()
  const projectId = await db.projects.add({
    workspaceUid: generateWorkspaceUid(), name: '性能项目', genre: 'fantasy', genres: [], status: 'drafting',
    description: '', targetWordCount: 1_000_000, createdAt: now, updatedAt: now,
  } as any) as number
  const ownership = await ensureWorkspaceOwnership(projectId)
  const outlineNodeId = await db.outlineNodes.add({
    projectId, workId: ownership.scope.workId, parentId: null, type: 'chapter', title: '长章', summary: '', order: 0,
    createdAt: now, updatedAt: now,
  } as any) as number
  const chapterId = await db.chapters.add({
    projectId, workId: ownership.scope.workId, outlineNodeId, title: '长章',
    content: `<p>${'长正文。'.repeat(20_000)}</p>`, wordCount: 80_000,
    status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
  } as any) as number
  return { projectId, chapterId }
}

describe('MEMORY-10 · full classification and bounded incremental scan', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('skips unchanged large documents by committed file metadata and reparses only a changed file', async () => {
    const seeded = await seed()
    const disk = metadataDirectory()
    const initial = await buildWorkspaceSelfCheckReportV1(seeded.projectId, disk.handle)
    await synchronizeProjectChangesToFolderV1({
      projectId: seeded.projectId, root: disk.handle, expectedPlanHash: initial.plan.planHash,
    })
    const binding = await db.workspaceDocuments.where('tableName').equals('chapters').first()
    expect(binding?.fileByteLength).toBeGreaterThan(100_000)
    expect(binding?.fileLastModified).toBeGreaterThan(0)
    const path = binding!.relativePath

    disk.resetReads(path)
    const clean = await buildWorkspaceSelfCheckReportV1(seeded.projectId, disk.handle)
    expect(clean.plan.items.find(item => item.identity.documentId === binding!.documentId)?.changeKind).toBe('clean')
    expect(disk.reads(path), 'metadata 未变化时不应重读大正文').toBe(0)

    disk.write(path, disk.read(path).replace('长正文。', '新正文。'))
    disk.resetReads(path)
    const changed = await buildWorkspaceSelfCheckReportV1(seeded.projectId, disk.handle)
    expect(changed.plan.items.find(item => item.identity.documentId === binding!.documentId)?.changeKind).toBe('file-changed')
    expect(disk.reads(path)).toBe(1)
    const candidates = await buildWorkspaceFileAdoptionCandidatesV1({
      projectId: seeded.projectId, root: disk.handle, expectedPlanHash: changed.plan.planHash,
    })
    expect(candidates.candidates).toHaveLength(1)
    expect(candidates.candidates[0].recordId).toBe(seeded.chapterId)
  })

  it('quarantines an oversized external file before reading its body', async () => {
    const seeded = await seed()
    const disk = metadataDirectory()
    const initial = await buildWorkspaceSelfCheckReportV1(seeded.projectId, disk.handle)
    await synchronizeProjectChangesToFolderV1({
      projectId: seeded.projectId, root: disk.handle, expectedPlanHash: initial.plan.planHash,
    })
    const binding = await db.workspaceDocuments.where('tableName').equals('chapters').first()
    disk.declareSize(binding!.relativePath, WORKSPACE_FILE_SCAN_MAX_BYTES_V1 + 1)
    const report = await buildWorkspaceSelfCheckReportV1(seeded.projectId, disk.handle)
    const item = report.plan.items.find(row => row.identity.documentId === binding!.documentId)
    expect(item?.changeKind).toBe('invalid')
    expect(item?.issues.join('\n')).toContain('单文件扫描上限')
    expect(disk.reads(binding!.relativePath)).toBe(0)
  })
})
