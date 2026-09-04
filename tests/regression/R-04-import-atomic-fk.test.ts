/**
 * R-4: importProjectJSON 原子性 + FK fail-fast
 *
 * R-04：导入原子性与外键反例。
 *
 * 期望:
 *   FK remap 缺失时在事务内抛错,整个导入回滚,不留下项目或子表残留。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'
import { seedCurrentProject } from '../helpers/current-workspace'

describe('R-04: importProjectJSON 原子性 + FK fail-fast', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
  })

  it('章节引用缺失的大纲节点时,导入抛错且整体回滚', async () => {
    const now = Date.now()
    const projectId = await seedCurrentProject({ name: '坏导入', createdAt: now, updatedAt: now })
    const outlineNodeId = await db.outlineNodes.add({
      projectId,
      parentId: null,
      type: 'chapter',
      title: '孤儿章节',
      summary: '',
      order: 0,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    await db.chapters.add({
      projectId,
      outlineNodeId,
      title: '孤儿章节',
      content: '',
      wordCount: 0,
      status: 'draft',
      order: 0,
      notes: '',
      createdAt: now,
      updatedAt: now,
    } as any)
    await finalizeCurrentFixtureV1(projectId)
    const brokenExport = await exportProjectJSON(projectId)
    brokenExport.outlineNodes = []

    await db.delete()
    await db.open()

    await expect(importProjectJSON(brokenExport)).rejects.toThrow('chapters.outlineNodeId')

    expect(await db.projects.count()).toBe(0)
    expect(await db.chapters.count()).toBe(0)
  })
})
