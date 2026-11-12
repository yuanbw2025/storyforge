import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { backupFilename, readStoryforgeBackups, writeProjectSnapshotToFolder } from '../../src/lib/storage/folder-backup'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { Chapter, OutlineNode } from '../../src/lib/types'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

class SnapshotDirectory {
  readonly files = new Map<string, string>()
  opens = 0
  aborts = 0
  fail: 'read' | 'write' | 'close' | null = null
  beforeOpen: (() => void) | null = null

  readonly handle = {
    kind: 'directory',
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (!this.files.has(name)) {
        if (!options?.create) throw new DOMException('Missing file', 'NotFoundError')
        this.files.set(name, '')
      }
      return {
        getFile: async () => {
          if (this.fail === 'read') throw new DOMException('Read failure', 'NotReadableError')
          return new File([this.files.get(name)!], name)
        },
        createWritable: async () => {
          this.opens += 1
          this.beforeOpen?.()
          let buffer = ''
          return {
            write: async (value: string) => {
              if (this.fail === 'write') throw new Error('snapshot write failure')
              buffer = value
            },
            close: async () => {
              if (this.fail === 'close') throw new Error('snapshot close failure')
              this.files.set(name, buffer)
            },
            abort: async () => { this.aborts += 1 },
          }
        },
      }
    },
    entries: this.entries.bind(this),
  } as unknown as FileSystemDirectoryHandle

  private async *entries() {
    for (const [name, text] of this.files) {
      yield [name, { kind: 'file', getFile: async () => new File([text], name) }]
    }
  }
}

async function workspace(name: string, body: string) {
  const { scope } = await seedCurrentWorkspace(name)
  const now = Date.now()
  const outline: OutlineNode = {
    projectId: scope.projectId, parentId: null, type: 'chapter', title: name,
    summary: '', order: 0, createdAt: now, updatedAt: now,
  }
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', outline))
  const chapter: Chapter = {
    projectId: scope.projectId, outlineNodeId, title: name, content: `<p>${body}</p>`,
    wordCount: body.length, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
  }
  await db.chapters.add(stampNewRecord(scope, 'chapters', chapter))
  return { id: scope.projectId, uid: (await db.projects.get(scope.projectId))!.workspaceUid, body }
}

beforeEach(async () => { await db.delete(); await db.open() })

describe('SFQA-127 · folder snapshot ownership', () => {
  it.each([['同名', '同名'], ['A/B', 'A-B'], ['甲', '乙']])('shared directory keeps independent owners: %s / %s', async (aName, bName) => {
    const a = await workspace(aName, '甲的独有正文 😀')
    const b = await workspace(bName, '乙的独有正文 e\u0301')
    const dir = new SnapshotDirectory()
    await expect(writeProjectSnapshotToFolder(dir.handle, a.id)).resolves.toBe(true)
    await expect(writeProjectSnapshotToFolder(dir.handle, b.id)).resolves.toBe(true)
    const backups = await readStoryforgeBackups(dir.handle)
    expect(backups).toHaveLength(2)
    expect(new Set(backups.map(file => file.data.project.workspaceUid))).toEqual(new Set([a.uid, b.uid]))
    for (const item of [a, b]) {
      const backup = backups.find(file => file.data.project.workspaceUid === item.uid)!
      expect(backup.data.chapters.map(chapter => chapter.content).join('')).toContain(item.body)
      expect(backup.data.chapters.map(chapter => chapter.content).join('')).not.toContain(item === a ? b.body : a.body)
    }
    expect((await db.chapters.toArray()).map(chapter => chapter.content)).toEqual([`<p>${a.body}</p>`, `<p>${b.body}</p>`])
  })

  it('keeps exact workspace identities distinct on case-insensitive filesystems', () => {
    const uid = 'WS-aaaaaaaa-1111-4444-8888-aaaaaaaaaaaa'
    expect(backupFilename(uid).toLowerCase()).not.toBe(backupFilename(uid.toLowerCase()).toLowerCase())
    expect(() => backupFilename('../foreign')).toThrow()
  })

  it('keeps an old name-only snapshot even if its title equals the workspace UID', async () => {
    const a = await workspace('改名保留', '原快照正文')
    const dir = new SnapshotDirectory()
    await db.projects.update(a.id, { name: a.uid })
    const legacyName = `storyforge-${a.uid}.json`
    const original = JSON.stringify(await exportProjectJSON(a.id))
    dir.files.set(legacyName, original)
    await db.projects.update(a.id, { name: '更新后的工作区名称' })
    await writeProjectSnapshotToFolder(dir.handle, a.id)
    expect(dir.files.get(legacyName)).toBe(original)
    expect((await readStoryforgeBackups(dir.handle)).map(file => file.name).sort()).toEqual([legacyName, backupFilename(a.uid)].sort())
  })

  it('can retry a failed first write without touching other files in the directory', async () => {
    const a = await workspace('第一次失败', '重试后保留正文')
    const dir = new SnapshotDirectory()
    dir.files.set('storyforge-旧空文件.json', '')
    dir.fail = 'write'
    await expect(writeProjectSnapshotToFolder(dir.handle, a.id)).rejects.toThrow('snapshot write failure')
    dir.fail = null
    await expect(writeProjectSnapshotToFolder(dir.handle, a.id)).resolves.toBe(true)
    expect(JSON.parse(dir.files.get(backupFilename(a.uid))!).project.workspaceUid).toBe(a.uid)
    expect(dir.files.get('storyforge-旧空文件.json')).toBe('')
  })

  it('rename and repeated updates keep the same stable snapshot path', async () => {
    const a = await workspace('原名称', '保留正文')
    const dir = new SnapshotDirectory()
    await writeProjectSnapshotToFolder(dir.handle, a.id)
    const firstName = [...dir.files.keys()][0]
    await db.projects.update(a.id, { name: '另一个/名称' })
    await writeProjectSnapshotToFolder(dir.handle, a.id)
    await writeProjectSnapshotToFolder(dir.handle, a.id)
    expect([...dir.files.keys()]).toEqual([firstName])
    const [backup] = await readStoryforgeBackups(dir.handle)
    expect(backup.data.project).toMatchObject({ workspaceUid: a.uid, name: '另一个/名称' })
    expect(backup.data.chapters[0].content).toContain(a.body)
  })

  it('an imported copy gets its own UID and cannot replace the source snapshot', async () => {
    const a = await workspace('可恢复', '导入后也保留正文')
    const importedId = await importProjectJSON(await exportProjectJSON(a.id))
    const imported = (await db.projects.get(importedId))!
    expect(imported.workspaceUid).not.toBe(a.uid)
    const dir = new SnapshotDirectory()
    await writeProjectSnapshotToFolder(dir.handle, a.id)
    await writeProjectSnapshotToFolder(dir.handle, importedId)
    const backups = await readStoryforgeBackups(dir.handle)
    expect(backups).toHaveLength(2)
    expect(new Set(backups.map(item => item.data.project.workspaceUid))).toEqual(new Set([a.uid, imported.workspaceUid]))
    expect(backups.every(item => item.data.chapters[0].content.includes(a.body))).toBe(true)
  })

  it('a foreign valid snapshot at the target path is rejected before opening a writer', async () => {
    const a = await workspace('相同名称', 'A 正文')
    const b = await workspace('相同名称', 'B 正文')
    const dir = new SnapshotDirectory()
    const original = JSON.stringify(await exportProjectJSON(b.id))
    dir.files.set(backupFilename(a.uid), original)
    await expect(writeProjectSnapshotToFolder(dir.handle, a.id)).rejects.toThrow('其他工作区')
    expect(dir.opens).toBe(0)
    expect(dir.files.get(backupFilename(a.uid))).toBe(original)
  })

  it('unreadable or malformed existing files fail closed without replacing their bytes', async () => {
    const a = await workspace('受保护', '现有正文')
    const dir = new SnapshotDirectory()
    const filename = backupFilename(a.uid)
    dir.files.set(filename, '{bad JSON')
    await expect(writeProjectSnapshotToFolder(dir.handle, a.id)).rejects.toThrow('现有快照')
    dir.fail = 'read'
    await expect(writeProjectSnapshotToFolder(dir.handle, a.id)).rejects.toThrow('Read failure')
    expect(dir.files.get(filename)).toBe('{bad JSON')
    expect(dir.opens).toBe(0)
  })

  it.each(['write', 'close'] as const)('a %s failure aborts and keeps the last valid snapshot', async fault => {
    const a = await workspace('稳定快照', '最后有效正文')
    const dir = new SnapshotDirectory()
    await writeProjectSnapshotToFolder(dir.handle, a.id)
    const before = new Map(dir.files)
    await db.projects.update(a.id, { name: '尚未成功备份的名称' })
    dir.fail = fault
    await expect(writeProjectSnapshotToFolder(dir.handle, a.id)).rejects.toThrow(`snapshot ${fault} failure`)
    expect(dir.aborts).toBe(1)
    expect(dir.files).toEqual(before)
  })

  it('legacy name-only backups remain discoverable and unchanged alongside the UID snapshot', async () => {
    const a = await workspace('旧文件', '旧版按名称的正文')
    const dir = new SnapshotDirectory()
    const legacyName = 'storyforge-旧文件.json'
    const original = JSON.stringify(await exportProjectJSON(a.id))
    dir.files.set(legacyName, original)
    await writeProjectSnapshotToFolder(dir.handle, a.id)
    const backups = await readStoryforgeBackups(dir.handle)
    expect(backups.map(file => file.name).sort()).toEqual([legacyName, backupFilename(a.uid)].sort())
    expect(dir.files.get(legacyName)).toBe(original)
    expect(backups.every(file => file.data.chapters[0].content.includes(a.body))).toBe(true)
  })

  it('a target replaced after the owner check is preserved and the staged writer is aborted', async () => {
    const a = await workspace('A', 'A 正文')
    const b = await workspace('B', 'B 正文')
    const dir = new SnapshotDirectory()
    await writeProjectSnapshotToFolder(dir.handle, a.id)
    const foreign = JSON.stringify(await exportProjectJSON(b.id))
    dir.beforeOpen = () => { dir.files.set(backupFilename(a.uid), foreign) }
    await expect(writeProjectSnapshotToFolder(dir.handle, a.id)).rejects.toThrow('快照已变化')
    expect(dir.files.get(backupFilename(a.uid))).toBe(foreign)
    expect(dir.aborts).toBe(1)
  })
})
