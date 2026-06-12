/**
 * R-FB3 · 章节大纲(摘要)可手改并持久化,且重生成不覆盖手改(社区反馈 FB-3)
 *
 * 反馈(light莫言/江也):「章节自动生成的章节大纲,最好也能更改。有时候章节名字看起来还可以,
 * 但是章节大纲又有问题,要反复生成查看」。诉求 = 章节摘要可手动编辑并保存,不必为改一句话整章重生成。
 *
 * 本测试锁定两点:
 *  ① 手改章节摘要经 store.updateNode 真正写库(UI ChapterRow 的 onBlur 走的就是这条路);
 *  ② 重跑「章节大纲展开」(同名章节再 adopt)被 skip-by-title 策略拦下,手改的摘要不被无脑覆盖。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { adopt } from '../../src/lib/registry/adopt'
import { useOutlineStore } from '../../src/stores/outline'

async function createProject(): Promise<number> {
  const now = Date.now()
  return await db.projects.add({
    name: 'FB3 Test', genre: '', description: '', targetWordCount: 0,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number
}

async function adoptChapter(projectId: number, parentId: number, title: string, summary: string, order: number) {
  return adopt({
    projectId,
    target: 'outlineNodes',
    mode: 'add',
    data: { parentId, type: 'chapter', title, summary, order },
  })
}

describe('R-FB3 · 章节大纲可手改并持久化', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('手改章节摘要经 store.updateNode 写库(可编辑+保存)', async () => {
    const pid = await createProject()
    const vol = await adopt({ projectId: pid, target: 'outlineNodes', mode: 'add',
      data: { parentId: null, type: 'volume', title: '第一卷', summary: 'v', order: 0 } })
    const volId = vol.written[0].id!
    await adoptChapter(pid, volId, '第1章 初遇', 'AI 自动生成的摘要', 0)
    const ch = (await db.outlineNodes.where('projectId').equals(pid).toArray()).find(n => n.type === 'chapter')!

    // 模拟 UI ChapterRow 失焦保存:store.updateNode 改 summary
    await useOutlineStore.getState().updateNode(ch.id!, { summary: '我手动改写后的章节大纲' })

    const after = await db.outlineNodes.get(ch.id!)
    expect(after!.summary).toBe('我手动改写后的章节大纲')
  })

  it('重跑章节展开(同名章节再采纳)不覆盖手改的摘要', async () => {
    const pid = await createProject()
    const vol = await adopt({ projectId: pid, target: 'outlineNodes', mode: 'add',
      data: { parentId: null, type: 'volume', title: '第一卷', summary: 'v', order: 0 } })
    const volId = vol.written[0].id!
    await adoptChapter(pid, volId, '第1章 初遇', 'AI 初版摘要', 0)
    const ch = (await db.outlineNodes.where('projectId').equals(pid).toArray()).find(n => n.type === 'chapter')!

    // 用户手改摘要
    await useOutlineStore.getState().updateNode(ch.id!, { summary: '用户精修过的大纲' })

    // 再次「章节展开」生成同名章节、AI 给了不同摘要 → 应被 skip,不覆盖
    const r2 = await adoptChapter(pid, volId, '第1章 初遇', 'AI 重新生成的另一版摘要', 0)
    expect(r2.written.length).toBe(0)
    expect(r2.skipped.length).toBeGreaterThan(0)

    const after = await db.outlineNodes.get(ch.id!)
    expect(after!.summary).toBe('用户精修过的大纲')   // 手改被保留,没被 AI 覆盖
    // DB 里该章仍只有 1 条(没产生重复)
    const chapters = (await db.outlineNodes.where('projectId').equals(pid).toArray()).filter(n => n.type === 'chapter')
    expect(chapters.length).toBe(1)
  })
})
