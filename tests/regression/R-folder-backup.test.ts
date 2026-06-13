/**
 * R-FOLDER · 本地文件夹持久层（FB-11 数据持久）
 *
 * ① 句柄持久化:存进独立 IndexedDB 后能读回、能清除（绑定跨刷新/更新不丢）。
 * ② 写盘 + 回读往返:把项目写成 JSON 落到（假）文件夹 → 读回 → 导入成新项目,数据一致。
 *
 * File System Access API 在 jsdom 不存在,这里用「假目录句柄」模拟其行为
 * （getFileHandle/createWritable/entries），覆盖 folder-backup 的纯逻辑。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  saveFolderHandle, loadFolderHandle, clearFolderHandle, projFolderKey,
} from '../../src/lib/storage/folder-handle-store'
import {
  writeProjectJSONToFolder, readStoryforgeBackups, backupFilename,
} from '../../src/lib/storage/folder-backup'
import { importProjectJSON } from '../../src/lib/export/json-export'

// ── 假的 FileSystemDirectoryHandle（内存版）──
function makeFakeDir(name = 'BackupDir') {
  const files = new Map<string, string>()
  const dir: any = {
    name,
    kind: 'directory',
    async getFileHandle(fname: string, _opts?: { create?: boolean }) {
      return {
        async createWritable() {
          let buf = ''
          return {
            async write(chunk: string) { buf += chunk },
            async close() { files.set(fname, buf) },
          }
        },
      }
    },
    async *entries() {
      for (const [fname, content] of files) {
        yield [fname, {
          kind: 'file',
          async getFile() { return { async text() { return content } } },
        }]
      }
    },
    _files: files,
  }
  return dir
}

describe('R-FOLDER · 本地文件夹持久层', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('句柄持久化:存→读→清（绑定跨刷新不丢）', async () => {
    // 真实 FileSystemDirectoryHandle 是可结构化克隆的宿主对象;jsdom/fake-indexeddb
    // 无法克隆带方法的假对象,故此用例用纯可克隆对象验证「存/读/清」往返本身。
    const handle = { name: '我的备份盘', kind: 'directory' as const }
    const key = projFolderKey(7)
    await saveFolderHandle(key, handle as any)

    const got = await loadFolderHandle(key)
    expect(got).toBeTruthy()
    expect((got as any).name).toBe('我的备份盘')

    await clearFolderHandle(key)
    expect(await loadFolderHandle(key)).toBeNull()
  })

  it('写盘 → 回读 → 导入往返,数据一致', async () => {
    const now = Date.now()
    const pid = await db.projects.add({
      name: '盘里的书', genre: '', description: '', targetWordCount: 0,
      enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as any) as number
    await db.characters.add({ projectId: pid, name: '盘中角色', role: 'protagonist', createdAt: now, updatedAt: now } as any)

    const dir = makeFakeDir()
    // 写盘:文件名按书名生成
    const wrote = await writeProjectJSONToFolder(dir as any, pid)
    expect(wrote).toBe(true)
    expect(dir._files.has(backupFilename('盘里的书'))).toBe(true)

    // 模拟"数据重置":删掉项目
    await db.projects.delete(pid)
    await db.characters.where('projectId').equals(pid).delete()
    expect(await db.projects.count()).toBe(0)

    // 回读 + 导入
    const backups = await readStoryforgeBackups(dir as any)
    expect(backups).toHaveLength(1)
    const newId = await importProjectJSON(backups[0].data)
    expect(newId).toBeGreaterThan(0)
    const restored = await db.projects.get(newId)
    expect(restored?.name).toContain('盘里的书')
    const chars = await db.characters.where('projectId').equals(newId).toArray()
    expect(chars.map(c => c.name)).toContain('盘中角色')
  })

  it('回读忽略非 storyforge 文件 + 解析失败的文件', async () => {
    const dir = makeFakeDir()
    dir._files.set('storyforge-好书.json', JSON.stringify({ version: 3, exportedAt: 1, project: { name: '好书' }, worldviews: [], storyCores: [], powerSystems: [], characters: [], outlineNodes: [], chapters: [], foreshadows: [], geographies: [], histories: [], creativeRules: [], characterRelations: [] }))
    dir._files.set('readme.txt', '不是备份')
    dir._files.set('storyforge-坏文件.json', '{坏 JSON')

    const backups = await readStoryforgeBackups(dir as any)
    expect(backups.map(b => b.name)).toEqual(['storyforge-好书.json'])
  })
})
