import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { canonicalManuscriptWordCount } from '../../src/lib/chapters/selectors'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import {
  readCanonicalWorkManuscriptWordCount,
  switchNovelProfile,
  updateActiveWork,
} from '../../src/lib/workspace/works'
import {
  deriveShortNovelStructure,
} from '../../src/lib/workspace/work-kind'
import type { Chapter, CreateWorkspaceInput } from '../../src/lib/types'

function projectInput(name: string, targetWordCount: number): CreateWorkspaceInput {
  return {
    name,
    genres: ['other'],
    status: 'drafting',
    description: '',
    targetWordCount,
    enableMultiWorld: false,
  }
}

describe('NOVEL-PROFILE-1 / SHORT-1 · Work 分类与短篇边界', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('短篇结构建议覆盖全部边界并允许作者指定任意正整数章数', () => {
    expect(deriveShortNovelStructure(5_000)).toMatchObject({ volumeCount: 1, chapterCount: 2, targetWordsPerChapter: 2_500 })
    expect(deriveShortNovelStructure(8_000).chapterCount).toBe(3)
    expect(deriveShortNovelStructure(13_000).chapterCount).toBe(4)
    expect(deriveShortNovelStructure(18_000).chapterCount).toBe(5)
    expect(deriveShortNovelStructure(22_000).chapterCount).toBe(6)
    expect(deriveShortNovelStructure(25_000, 11).chapterCount).toBe(11)
    expect(() => deriveShortNovelStructure(10_000, 0)).toThrow('正整数')
  })

  it('短篇创建拒绝 4,999/25,001 且事务整体零写入，接受 5,000/25,000', async () => {
    for (const target of [4_999, 25_001]) {
      await expect(createWorkspace(projectInput(`非法 ${target}`, target), {
        kind: 'novel',
        novelProfile: 'short',
      })).rejects.toThrow('5,000～25,000')
      expect(await db.projects.count()).toBe(0)
      expect(await db.worlds.count()).toBe(0)
      expect(await db.works.count()).toBe(0)
      expect(await db.outlineNodes.count()).toBe(0)
      expect(await db.chapters.count()).toBe(0)
    }

    const lower = await createWorkspace(projectInput('下边界', 5_000), {
      kind: 'novel',
      novelProfile: 'short',
    })
    const upper = await createWorkspace(projectInput('上边界', 25_000), {
      kind: 'novel',
      novelProfile: 'short',
    })
    expect(lower.work).toMatchObject({ kind: 'novel', novelProfile: 'short', targetWordCount: 5_000 })
    expect(upper.work).toMatchObject({ kind: 'novel', novelProfile: 'short', targetWordCount: 25_000 })
  })

  it('短篇原子创建同 Work 的单卷和动态章节，长篇不创建短篇骨架', async () => {
    const short = await createWorkspace(projectInput('短篇骨架', 18_000), {
      kind: 'novel',
      novelProfile: 'short',
    })
    const outlines = await db.outlineNodes.where('projectId').equals(short.scope.projectId).toArray()
    const chapters = await db.chapters.where('projectId').equals(short.scope.projectId).toArray()
    const volume = outlines.find(row => row.type === 'volume')
    expect(volume).toMatchObject({ title: '短篇正文', parentId: null, workId: short.scope.workId })
    expect(outlines.filter(row => row.type === 'chapter')).toHaveLength(5)
    expect(outlines.filter(row => row.type === 'chapter').every(row => row.parentId === volume?.id && row.workId === short.scope.workId)).toBe(true)
    expect(chapters).toHaveLength(5)
    expect(chapters.every(row => row.workId === short.scope.workId)).toBe(true)

    const long = await createWorkspace(projectInput('长篇不变', 500_000))
    expect(long.work).toMatchObject({ kind: 'novel', novelProfile: 'long', targetWordCount: 500_000 })
    expect(await db.outlineNodes.where('projectId').equals(long.scope.projectId).count()).toBe(0)
    expect(await db.chapters.where('projectId').equals(long.scope.projectId).count()).toBe(0)
  })

  it('非法媒介/Profile 组合在任何根表落库前整体回滚', async () => {
    await expect(createWorkspace(projectInput('非法剧本', 0), {
      kind: 'screenplay',
      novelProfile: 'short',
    })).rejects.toThrow('不能携带小说 Profile')
    expect(await db.projects.count()).toBe(0)
    expect(await db.worlds.count()).toBe(0)
    expect(await db.works.count()).toBe(0)
  })

  it('当前备份往返保留 Profile，非当前版本与非法组合均在写库前拒绝', async () => {
    const created = await createWorkspace(projectInput('短篇备份', 10_000), {
      kind: 'novel',
      novelProfile: 'short',
    })
    const backup = await exportProjectJSON(created.scope.projectId)
    expect(backup.version).toBe(10)
    expect(backup.works?.[0]).toMatchObject({ kind: 'novel', novelProfile: 'short' })

    const importedId = await importProjectJSON(structuredClone(backup))
    expect(await db.works.where('projectId').equals(importedId).first()).toMatchObject({
      kind: 'novel',
      novelProfile: 'short',
      targetWordCount: 10_000,
    })

    const wrongVersion = structuredClone(backup) as any
    wrongVersion.version = 9
    const beforeWrongVersion = await db.projects.count()
    await expect(importProjectJSON(wrongVersion)).rejects.toThrow('只接受当前备份版本 v10')
    expect(await db.projects.count()).toBe(beforeWrongVersion)

    const invalid = structuredClone(backup) as any
    invalid.works[0].kind = 'screenplay'
    invalid.works[0].novelProfile = 'short'
    const before = await db.projects.count()
    await expect(importProjectJSON(invalid)).rejects.toThrow('作品类型或流程配置无效')
    expect(await db.projects.count()).toBe(before)
  })

  it('规范正文只计每个 outline 的 canonical 行并忽略漂移缓存', async () => {
    const now = Date.now()
    const chapters = [
      { id: 1, outlineNodeId: 10, content: '<p>甲乙</p>', wordCount: 9_999, updatedAt: now },
      { id: 2, outlineNodeId: 10, content: '', wordCount: 20_000, updatedAt: now + 1 },
      { id: 3, outlineNodeId: 11, content: '丙 丁', wordCount: 0, updatedAt: now },
    ] as Chapter[]
    expect(canonicalManuscriptWordCount(chapters)).toBe(4)
  })

  it('短转长保持内容 ID；长转短重算正文并在超上限时拒绝', async () => {
    const created = await createWorkspace(projectInput('Profile 切换', 10_000), {
      kind: 'novel',
      novelProfile: 'short',
    })
    const originalIds = (await db.chapters.where('projectId').equals(created.scope.projectId).toArray()).map(row => row.id)
    const long = await switchNovelProfile({
      projectId: created.scope.projectId,
      workId: created.scope.workId,
      profile: 'long',
      targetWordCount: 120_000,
    })
    expect(long.novelProfile).toBe('long')
    expect((await db.chapters.where('projectId').equals(created.scope.projectId).toArray()).map(row => row.id)).toEqual(originalIds)

    const first = (await db.chapters.where('projectId').equals(created.scope.projectId).first())!
    await db.chapters.update(first.id!, { content: '字'.repeat(25_001), wordCount: 1 })
    await expect(switchNovelProfile({
      projectId: created.scope.projectId,
      workId: created.scope.workId,
      profile: 'short',
      targetWordCount: 25_000,
    })).rejects.toThrow('超过短篇上限')
    expect((await db.works.get(created.scope.workId))?.novelProfile).toBe('long')
  })

  it('标记短篇完成以实时正文为准并只修复 Work 字数', async () => {
    const created = await createWorkspace(projectInput('短篇完成门', 10_000), {
      kind: 'novel',
      novelProfile: 'short',
    })
    const first = (await db.chapters.where('projectId').equals(created.scope.projectId).first())!
    await db.chapters.update(first.id!, { content: '字'.repeat(4_999), wordCount: 99_999 })
    await expect(updateActiveWork(created.scope.projectId, { status: 'completed' })).rejects.toThrow('当前 4999 字')

    await db.chapters.update(first.id!, { content: '字'.repeat(5_000), wordCount: 1 })
    await updateActiveWork(created.scope.projectId, { status: 'completed' })
    expect(await readCanonicalWorkManuscriptWordCount(created.scope)).toBe(5_000)
    expect(await db.works.get(created.scope.workId)).toMatchObject({ status: 'completed', currentWordCount: 5_000 })
    expect(await db.projects.get(created.scope.projectId)).not.toHaveProperty('status')
    expect(await db.projects.get(created.scope.projectId)).not.toHaveProperty('currentWordCount')
  })
})
