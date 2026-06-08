/**
 * R-4: importProjectJSON 原子性 + FK fail-fast
 *
 * 对应 MASTER-BLUEPRINT §4.0.5。
 *
 * 反例:
 *   旧导入逻辑先创建项目,再遇到无效 FK 时用 0 fallback 或静默跳过。
 *   一旦中途失败,会留下半个导入项目。
 *
 * 期望:
 *   FK remap 缺失时在事务内抛错,整个导入回滚,不留下项目或子表残留。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { importProjectJSON } from '../../src/lib/export/json-export'

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
    const brokenExport = {
      version: 3,
      exportedAt: now,
      project: {
        name: '坏导入',
        genre: 'fantasy',
        description: '',
        targetWordCount: 0,
        enableMultiWorld: false,
        createdAt: now,
        updatedAt: now,
      },
      worldviews: [],
      storyCores: [],
      powerSystems: [],
      characters: [],
      factions: [],
      outlineNodes: [],
      chapters: [{
        _outlineExportId: 999,
        title: '孤儿章节',
        content: '',
        wordCount: 0,
        status: 'draft',
        order: 0,
        notes: '',
        createdAt: now,
        updatedAt: now,
      }],
      foreshadows: [],
      geographies: [],
      histories: [],
      itemSystems: [],
      creativeRules: [],
      characterRelations: [],
    }

    await expect(importProjectJSON(brokenExport as any)).rejects.toThrow('chapters.outlineNodeId')

    expect(await db.projects.count()).toBe(0)
    expect(await db.chapters.count()).toBe(0)
  })
})
