/**
 * Codex C6 · 新分类词条进 AI 上下文(上下游生成读得到)
 *
 * 锁定:① 新建方面分类(如 originPower/natWater/humSociety)下的词条,
 *        其名称、一句话简介、结构化字段(fieldSchema)都进入 buildCodexContext;
 *       ② 全貌(worldview 字段,含新加的 naturalResourceOverview)进 formatWorldviewBlock。
 * 这俩源都在各 AI 生成流程的 sourceKeys 里 → AI 生成正文/大纲时确实读得到。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useCodexStore } from '../../src/stores/codex'
import { buildCodexContext } from '../../src/lib/ai/codex-context'
import { formatWorldviewBlock } from '../../src/lib/ai/context-builder'

async function createProject(): Promise<number> {
  const now = Date.now()
  return await db.projects.add({
    name: 'C6ctx', genre: '', description: '', targetWordCount: 0,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number
}

async function catId(pid: number, key: string): Promise<number> {
  return (await db.codexCategories.where('projectId').equals(pid).toArray())
    .find(c => c.builtInKey === key)!.id!
}

describe('Codex C6 · 新分类词条进 AI 上下文', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('新分类(力量层级)的词条名/简介/结构化字段都进生成上下文', async () => {
    const pid = await createProject()
    const store = useCodexStore.getState()
    await store.loadAll(pid)   // ensureBuiltIns 播种含新分类
    const cid = await catId(pid, 'originPower')
    await store.addEntry({
      projectId: pid, categoryId: cid, name: '归元境', summary: '凡人入道的第一大境界',
      description: '', fields: JSON.stringify({ rank: '一阶', mark: '初凝灵力', condition: '打通任督二脉' }),
      importance: 0, order: 0, worldGroupId: null,
    } as any)

    const ctx = await buildCodexContext(pid, null)
    expect(ctx).toContain('归元境')              // 词条名进上下文 → AI 可调用
    expect(ctx).toContain('凡人入道的第一大境界')  // 简介
    expect(ctx).toContain('一阶')                // 结构化字段值(rank)被读取
    expect(ctx).toContain('初凝灵力')            // 结构化字段值(mark)
  })

  it('自然环境新分类(山川水系)的词条字段也读得到', async () => {
    const pid = await createProject()
    const store = useCodexStore.getState()
    await store.loadAll(pid)
    const cid = await catId(pid, 'natWater')
    await store.addEntry({
      projectId: pid, categoryId: cid, name: '忘川河', summary: '',
      description: '', fields: JSON.stringify({ type: '河流', scale: '横贯东西三千里', feature: '阴气森森' }),
      order: 0, worldGroupId: null,
    } as any)
    const ctx = await buildCodexContext(pid, null)
    expect(ctx).toContain('忘川河')
    expect(ctx).toContain('横贯东西三千里')
  })

  it('全貌:naturalResourceOverview 进 worldview AI 上下文', () => {
    const block = formatWorldviewBlock({ naturalResourceOverview: '灵矿遍地，北寒铁、南火晶各据一方。' } as any)
    expect(block).toContain('自然资源')
    expect(block).toContain('北寒铁')
  })
})
