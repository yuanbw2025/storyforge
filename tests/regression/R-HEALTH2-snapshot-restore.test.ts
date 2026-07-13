import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useBackupStore } from '../../src/stores/backup'

async function seedProject(): Promise<{ projectId: number; chapterId: number }> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '快照恢复测试', genre: '', description: '', targetWordCount: 0,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number
  const volumeId = await db.outlineNodes.add({
    projectId, parentId: null, type: 'volume', title: '第一卷', summary: '开端', order: 0,
    createdAt: now, updatedAt: now,
  } as any) as number
  const outlineNodeId = await db.outlineNodes.add({
    projectId, parentId: volumeId, type: 'chapter', title: '第一章', summary: '原始章纲', order: 0,
    createdAt: now, updatedAt: now,
  } as any) as number
  const chapterId = await db.chapters.add({
    projectId, outlineNodeId, title: '第一章', content: '<p>快照中的原始正文</p>',
    wordCount: 9, status: 'draft', order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  return { projectId, chapterId }
}

describe('HEALTH-2 · 项目快照恢复关键流程', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useBackupStore.setState({ snapshots: [], loading: false })
  })

  afterEach(() => db.close())

  it('创建快照后修改原项目，恢复会新建项目并还原快照时正文', async () => {
    const { projectId, chapterId } = await seedProject()
    const snapshotId = await useBackupStore.getState().createSnapshot(projectId, '改稿前', 'manual')
    await db.chapters.update(chapterId, { content: '<p>快照后被改写的正文</p>', wordCount: 10 })

    const restoredProjectId = await useBackupStore.getState().restoreSnapshot(snapshotId)
    const restoredChapter = await db.chapters.where('projectId').equals(restoredProjectId).first()

    expect(restoredProjectId).not.toBe(projectId)
    expect((await db.projects.get(restoredProjectId))?.name).toBe('快照恢复测试（导入）')
    expect(restoredChapter?.content).toContain('快照中的原始正文')
    expect(restoredChapter?.content).not.toContain('快照后被改写')
    expect((await db.chapters.get(chapterId))?.content).toContain('快照后被改写')
  })

  it('清理只保留最近 20 个自动快照，手动快照不会被误删', async () => {
    const { projectId } = await seedProject()
    const rows = Array.from({ length: 23 }, (_, index) => ({
      projectId,
      label: `自动 ${index}`,
      type: 'auto' as const,
      data: '{}',
      size: 2,
      createdAt: index + 1,
    }))
    await db.snapshots.bulkAdd([
      ...rows,
      { projectId, label: '长期手动备份', type: 'manual', data: '{}', size: 2, createdAt: 0 },
    ] as any)

    await useBackupStore.getState().pruneSnapshots(projectId)

    const remaining = await db.snapshots.where('projectId').equals(projectId).toArray()
    expect(remaining.filter(snapshot => snapshot.type === 'auto')).toHaveLength(20)
    expect(remaining.some(snapshot => snapshot.label === '长期手动备份')).toBe(true)
    expect(remaining.some(snapshot => snapshot.label === '自动 0')).toBe(false)
    expect(remaining.some(snapshot => snapshot.label === '自动 22')).toBe(true)
  })
})

