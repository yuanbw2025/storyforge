/**
 * R-FB9 · 场景细纲进入 AI 生成上下文(社区反馈 FB-9)
 *
 * 反馈(zzjj):正文生成不"吃"场景细纲。
 * 根因:detailedOutlines 此前只在 DB 表/写回/删除层登记,从未登记成 CONTEXT_SOURCE,
 * 所以 assembleContext 永远读不到它 → 正文等生成拿不到细纲。
 *
 * 本测试锁定:注册 `detailedOutline` 源后,assembleContext({ need:['detailedOutline'] })
 * 能按当前章节节点读出场景拆解。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'

async function seed(): Promise<{ projectId: number; nodeId: number }> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: 'FB9', genre: '', description: '', targetWordCount: 0,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number
  const nodeId = await db.outlineNodes.add({
    projectId, parentId: null, type: 'chapter', title: '第1章 觉醒',
    summary: '主角觉醒', order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  await db.detailedOutlines.add({
    projectId, outlineNodeId: nodeId,
    openingHook: '承接上一章的爆炸',
    endingCliffhanger: '神秘黑影出现',
    scenes: [
      { sceneId: 's1', title: '废墟苏醒', summary: '主角在废墟中醒来', characterIds: [], location: '城郊废墟', conflict: '失忆与求生', pace: 'normal', estimatedWords: 800, notes: '' },
      { sceneId: 's2', title: '遭遇追兵', summary: '被神秘组织追杀', characterIds: [], location: '地下管道', conflict: '逃命', pace: 'fast', estimatedWords: 1200, notes: '' },
    ],
    createdAt: now, updatedAt: now,
  } as any)
  return { projectId, nodeId }
}

describe('R-FB9 · 细纲进入生成上下文', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('detailedOutline 已注册为上下文源', () => {
    expect(CONTEXT_SOURCE_BY_KEY.get('detailedOutline')).toBeTruthy()
  })

  it('assembleContext 能按当前章节节点读出场景细纲', async () => {
    const { projectId, nodeId } = await seed()
    const r = await assembleContext({
      projectId,
      outlineNodeId: nodeId,
      sourceKeys: ['detailedOutline'],
    })
    expect(r.included).toContain('detailedOutline')
    // 场景内容确实进入了上下文文本
    expect(r.text).toContain('废墟苏醒')
    expect(r.text).toContain('遭遇追兵')
    expect(r.text).toContain('开头衔接')
    expect(r.text).toContain('结尾悬念')
  })

  it('该章节没有细纲时,源安静省略(不报错、不注入空块)', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: 'FB9b', genre: '', description: '', targetWordCount: 0,
      enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as any) as number
    const nodeId = await db.outlineNodes.add({
      projectId, parentId: null, type: 'chapter', title: '空章', summary: '', order: 0,
      createdAt: now, updatedAt: now,
    } as any) as number
    const r = await assembleContext({ projectId, outlineNodeId: nodeId, sourceKeys: ['detailedOutline'] })
    expect(r.included).not.toContain('detailedOutline')
    expect(r.omitted).toContain('detailedOutline')
  })
})
