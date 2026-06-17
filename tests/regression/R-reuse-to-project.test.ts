/**
 * R-reuse-to-project · 复用已解析会话 → 一键灌进当前项目设定库（社区反馈）
 *
 * 场景:用户已用「导入项目参考」拆解过对标文（解析结果存在 session.merged），想把设定
 * 搬进设定库又不想一个个手填。applyProjectFromSession 复用 session.merged 调 applyChunkResult
 * 写库，**不再调用解析 AI**（省钱）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { applyProjectFromSession } from '../../src/lib/import/pipeline'

describe('R-reuse-to-project · 复用已解析灌进设定库', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('用 session.merged 把世界观/角色写进设定库(零重复解析)', async () => {
    const projectId = await db.projects.add({
      name: '测试项目', genre: 'fantasy', createdAt: 1, updatedAt: 1,
    } as any) as number

    const session = {
      id: 1, projectId, filename: '对标文.txt', totalChars: 1000, totalChunks: 1,
      targetWorldGroupId: null, chunks: [], status: 'done',
      merged: {
        worldview: { worldOrigin: '混沌初开，造物主立世创世' },
        characters: [
          { name: '林惊羽', role: 'protagonist', personality: '坚毅', shortDescription: '天才剑修' },
          { name: '苏长歌', role: 'supporting', personality: '温婉' },
        ],
      },
    } as any

    const counts = await applyProjectFromSession(projectId, session, null)

    // 返回计数
    expect(counts.worldviewFields).toBeGreaterThan(0)
    expect(counts.characters).toBeGreaterThan(0)

    // 设定库实际写入
    const wv = await db.worldviews.where('projectId').equals(projectId).first()
    expect(wv?.worldOrigin).toContain('造物主')
    const chars = await db.characters.where('projectId').equals(projectId).toArray()
    expect(chars.map(c => c.name)).toContain('林惊羽')
    expect(chars.map(c => c.name)).toContain('苏长歌')
  })

  it('merged 为空时不报错，返回零计数', async () => {
    const projectId = await db.projects.add({
      name: '空项目', genre: 'other', createdAt: 1, updatedAt: 1,
    } as any) as number
    const session = { id: 2, projectId, filename: 'x.txt', totalChars: 0, totalChunks: 0, chunks: [], status: 'done', merged: undefined } as any
    const counts = await applyProjectFromSession(projectId, session, null)
    expect(counts.worldviewFields).toBe(0)
    expect(counts.characters).toBe(0)
  })
})
