/**
 * R-FB6 · 分块导入大纲只显示第1块(社区反馈 Poseidon/zzjj)
 *
 * 现象:导入分10块全部成功、日志"入库大纲N",但大纲面板只显示第1块,其余丢失。
 * 假设根因:逐块 AI 输出结构不一致——有的块返回"卷+章"(显示正常),有的块返回
 * 扁平章节列表(无卷包裹)。后者被写成 parentId=null 的顶层章节,而大纲面板只渲染
 * "卷→章",顶层孤儿章节不显示(虽已入库)。
 *
 * 本测试:① 复现——扁平块的章节成为孤儿(parentId=null);② 修复后——孤儿章节挂到卷下。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { applyChunkResult } from '../../src/lib/import/chunk-writer'

async function createProject(): Promise<number> {
  const now = Date.now()
  return await db.projects.add({
    name: 'FB6', genre: '', description: '', targetWordCount: 0,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number
}

describe('R-FB6 · 分块导入大纲不丢块', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('扁平块(无卷包裹)的章节也应挂到卷下、面板可见(不成为顶层孤儿)', async () => {
    const projectId = await createProject()

    // 块1:正常"卷+章"结构
    await applyChunkResult(projectId, {
      outline: [{ type: 'volume', title: '第一卷 风起', children: [
        { type: 'chapter', title: '第1章 甲', summary: 'a' },
        { type: 'chapter', title: '第2章 乙', summary: 'b' },
      ] }],
    } as any)

    // 块2:扁平章节列表(无卷包裹)——FB-6 触发点
    await applyChunkResult(projectId, {
      outline: [
        { type: 'chapter', title: '第3章 丙', summary: 'c' },
        { type: 'chapter', title: '第4章 丁', summary: 'd' },
      ],
    } as any)

    const all = await db.outlineNodes.where('projectId').equals(projectId).toArray()
    const chapters = all.filter(n => n.type === 'chapter')
    expect(chapters.length).toBe(4) // 4 章都入库

    // 关键:不能有"顶层孤儿章节"(parentId=null 的 chapter),否则面板看不到
    const orphanChapters = chapters.filter(c => c.parentId == null)
    expect(orphanChapters.map(c => c.title)).toEqual([]) // 修复后:无孤儿

    // 每个章节都应能在某个卷下找到(面板可渲染)
    const volumeIds = new Set(all.filter(n => n.type === 'volume').map(v => v.id))
    for (const c of chapters) {
      expect(volumeIds.has(c.parentId as number)).toBe(true)
    }
  })

  it('多个不同卷的块都应各自成卷(不被误并)', async () => {
    const projectId = await createProject()
    for (let i = 1; i <= 3; i++) {
      await applyChunkResult(projectId, {
        outline: [{ type: 'volume', title: `第${i}卷`, children: [
          { type: 'chapter', title: `第${i}卷-章A`, summary: 'a' },
          { type: 'chapter', title: `第${i}卷-章B`, summary: 'b' },
        ] }],
      } as any)
    }
    const all = await db.outlineNodes.where('projectId').equals(projectId).toArray()
    expect(all.filter(n => n.type === 'volume').length).toBe(3)
    expect(all.filter(n => n.type === 'chapter').length).toBe(6)
  })
})
