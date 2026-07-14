import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  adoptGeneratedOutlineItems,
  adoptGeneratedOutlineSummary,
} from '../../src/lib/outline/adopt-generation'

async function createProject(name = '大纲采纳 service 测试'): Promise<number> {
  const now = Date.now()
  return await db.projects.add({
    name,
    genre: '',
    description: '',
    targetWordCount: 0,
    enableMultiWorld: false,
    createdAt: now,
    updatedAt: now,
  } as any) as number
}

describe('AUDIT-6 · 大纲生成结果写回 use-case', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('按传入顺序新增卷并返回首个写入 ID', async () => {
    const projectId = await createProject()
    const result = await adoptGeneratedOutlineItems({
      projectId,
      parentId: null,
      type: 'volume',
      startingOrder: 3,
      items: [
        { title: '第四卷', summary: '风起' },
        { title: '第五卷', summary: '云涌' },
      ],
    })

    expect(result.writtenCount).toBe(2)
    expect(result.firstId).not.toBeNull()
    expect(result.skippedReasons).toEqual([])
    const rows = await db.outlineNodes.where('projectId').equals(projectId).sortBy('order')
    expect(rows.map(row => ({ parentId: row.parentId, type: row.type, title: row.title, order: row.order }))).toEqual([
      { parentId: null, type: 'volume', title: '第四卷', order: 3 },
      { parentId: null, type: 'volume', title: '第五卷', order: 4 },
    ])
  })

  it('章节写入保持目标卷父级，重复标题返回可反馈原因', async () => {
    const projectId = await createProject()
    const now = Date.now()
    const volumeId = await db.outlineNodes.add({
      projectId,
      parentId: null,
      type: 'volume',
      title: '第一卷',
      summary: '',
      order: 0,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    await db.outlineNodes.add({
      projectId,
      parentId: volumeId,
      type: 'chapter',
      title: '第一章',
      summary: '已有',
      order: 0,
      createdAt: now,
      updatedAt: now,
    } as any)

    const result = await adoptGeneratedOutlineItems({
      projectId,
      parentId: volumeId,
      type: 'chapter',
      startingOrder: 1,
      items: [
        { title: '第一章', summary: '重复' },
        { title: '第二章', summary: '新增' },
      ],
    })

    expect(result.writtenCount).toBe(1)
    expect(result.skippedReasons.join('；')).toContain('重复')
    const chapters = await db.outlineNodes.where('projectId').equals(projectId).toArray()
    const second = chapters.find(row => row.title === '第二章')
    expect(second?.parentId).toBe(volumeId)
    expect(second?.order).toBe(2)
  })

  it('定点替换只更新当前项目节点并返回失败原因', async () => {
    const projectId = await createProject()
    const otherProjectId = await createProject('其它项目')
    const now = Date.now()
    const volumeId = await db.outlineNodes.add({
      projectId,
      parentId: null,
      type: 'volume',
      title: '第一卷',
      summary: '',
      order: 0,
      createdAt: now,
      updatedAt: now,
    } as any) as number

    const success = await adoptGeneratedOutlineSummary(projectId, volumeId, '新卷纲')
    expect(success).toEqual({ written: true, reason: undefined })
    expect((await db.outlineNodes.get(volumeId))?.summary).toBe('新卷纲')

    const rejected = await adoptGeneratedOutlineSummary(otherProjectId, volumeId, '越权改写')
    expect(rejected.written).toBe(false)
    expect(rejected.reason).toContain('不属于当前项目')
    expect((await db.outlineNodes.get(volumeId))?.summary).toBe('新卷纲')
  })
})
