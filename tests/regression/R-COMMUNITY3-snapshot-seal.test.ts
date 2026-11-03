import { describe, expect, it } from 'vitest'
import { assertUnchangedPublicSnapshotV1, sealPublicSnapshotV1 } from '../../src/lib/community-works/snapshot-seal'
import type { NovelPublicSnapshotV1 } from '../../src/lib/community-works/public-snapshot'

describe('community snapshot seal', () => {
  it('seals UTF-8 bytes and refuses a changed chapter after preview', async () => {
    const snapshot: NovelPublicSnapshotV1 = {
      schemaVersion: 1, kind: 'novel', title: '海边🌊', description: '', genres: [],
      chapters: [{ title: '第一章', content: '旧正文' }],
    }
    const seal = await sealPublicSnapshotV1(snapshot)
    expect(seal.byteLength).toBe(new TextEncoder().encode(JSON.stringify(snapshot)).byteLength)
    expect(seal.sha256).toMatch(/^[0-9a-f]{64}$/)
    snapshot.chapters[0].content = '作者正在编辑'
    if (seal.snapshot.kind !== 'novel') throw new Error('意外的快照类型')
    expect(seal.snapshot.chapters[0].content).toBe('旧正文')
    snapshot.chapters[0].content = '旧正文'
    await expect(assertUnchangedPublicSnapshotV1(seal, structuredClone(snapshot))).resolves.toBeUndefined()
    await expect(assertUnchangedPublicSnapshotV1(seal, {
      ...snapshot, chapters: [{ title: '第一章', content: '新正文' }],
    })).rejects.toThrow('重新预览')
  })
})
