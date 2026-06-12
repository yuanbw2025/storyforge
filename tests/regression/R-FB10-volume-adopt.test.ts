/**
 * R-FB10 · 卷级大纲采纳写入(社区反馈 FB-10)
 *
 * 反馈:买辣椒——「生成卷级大纲,点击采纳写入后,并未写入」。
 * 根因:outlineNodes 的 AdoptionSchema 是 duplicatePolicy:'skip'(identity=parentId+type+title);
 * 命中去重时 adopt 进 skipped、不写入也不抛错,而 OutlinePanel 的采纳回调此前完全不反馈 →
 * 用户感知为「点了采纳却没反应」。
 *
 * 本测试锁定:① 全新卷能正常写入(基础路径没坏);② 同名卷再采纳会被 skip 且带原因
 * (供 UI 反馈,而非静默)。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { adopt } from '../../src/lib/registry/adopt'

async function createProject(): Promise<number> {
  const now = Date.now()
  return await db.projects.add({
    name: 'FB10 Test', genre: '', description: '', targetWordCount: 0,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number
}

async function adoptVolume(projectId: number, title: string, order: number) {
  return adopt({
    projectId,
    target: 'outlineNodes',
    mode: 'add',
    data: { parentId: null, type: 'volume', title, summary: 's', order },
  })
}

describe('R-FB10 · 卷级大纲采纳写入', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('全新卷能正常写入 DB(基础采纳路径正常)', async () => {
    const pid = await createProject()
    const r = await adoptVolume(pid, '第一卷 风起', 0)
    expect(r.written.length).toBe(1)
    const rows = await db.outlineNodes.where('projectId').equals(pid).toArray()
    expect(rows.filter(n => n.type === 'volume').length).toBe(1)
    expect(rows[0].title).toBe('第一卷 风起')
  })

  it('顶层卷写入后 parentId 必须严格为 null(否则被大纲面板 ===null 过滤藏起 → "采纳没反应")', async () => {
    const pid = await createProject()
    await adoptVolume(pid, '第一卷 风起', 0)
    const vol = (await db.outlineNodes.where('projectId').equals(pid).toArray())
      .find(n => n.type === 'volume')!
    // 根因坐实:adopt 旧实现丢弃 parentId:null → 存成 undefined → UI `parentId === null` 严格过滤把卷藏起
    expect(vol.parentId).toBe(null)
    expect(vol.parentId === null).toBe(true)
  })

  it('同名卷再采纳:被 skip 且 written 为空、带可反馈的原因(不静默)', async () => {
    const pid = await createProject()
    await adoptVolume(pid, '第一卷 风起', 0)
    const r2 = await adoptVolume(pid, '第一卷 风起', 1)
    // 关键:重复时不写入、不抛错,但有 skipped 原因供 UI 反馈
    expect(r2.written.length).toBe(0)
    expect(r2.skipped.length).toBeGreaterThan(0)
    expect(String(r2.skipped[0].reason)).toContain('重复')
    // DB 里仍只有 1 个卷(没有重复)
    const vols = (await db.outlineNodes.where('projectId').equals(pid).toArray()).filter(n => n.type === 'volume')
    expect(vols.length).toBe(1)
  })

  it('不同标题的多个卷都能写入', async () => {
    const pid = await createProject()
    const r1 = await adoptVolume(pid, '第一卷 风起', 0)
    const r2 = await adoptVolume(pid, '第二卷 云涌', 1)
    const r3 = await adoptVolume(pid, '第三卷 雷动', 2)
    expect(r1.written.length + r2.written.length + r3.written.length).toBe(3)
    const vols = (await db.outlineNodes.where('projectId').equals(pid).toArray()).filter(n => n.type === 'volume')
    expect(vols.length).toBe(3)
  })
})
