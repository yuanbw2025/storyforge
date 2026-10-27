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
import { seedCurrentProject } from '../helpers/current-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

async function seed(): Promise<{ projectId: number; nodeId: number }> {
  const now = Date.now()
  const projectId = await seedCurrentProject({
    name: 'FB9', genres: [], description: '', targetWordCount: 0,
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
    prohibitions: ['主角不能提前知道黑影身份', '不能重复首次获得钥匙'],
    scenes: [
      { sceneId: 's1', title: '废墟苏醒', summary: '主角在废墟中醒来', characterIds: [], location: '城郊废墟', conflict: '失忆与求生', pace: 'medium', estimatedWords: 800, notes: '' },
      { sceneId: 's2', title: '遭遇追兵', summary: '被神秘组织追杀', characterIds: [], location: '地下管道', conflict: '逃命', pace: 'fast', estimatedWords: 1200, notes: '' },
    ],
    createdAt: now, updatedAt: now,
  } as any)
  await finalizeCurrentFixtureV1(projectId)
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
    expect(r.text).toContain('不可写清单')
    expect(r.text).toContain('不能重复首次获得钥匙')
  })

  it('该章节没有细纲时,源安静省略(不报错、不注入空块)', async () => {
    const now = Date.now()
    const projectId = await seedCurrentProject({
      name: 'FB9b', genres: [], description: '', targetWordCount: 0,
      enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as any) as number
    const nodeId = await db.outlineNodes.add({
      projectId, parentId: null, type: 'chapter', title: '空章', summary: '', order: 0,
      createdAt: now, updatedAt: now,
    } as any) as number
    await finalizeCurrentFixtureV1(projectId)
    const r = await assembleContext({ projectId, outlineNodeId: nodeId, sourceKeys: ['detailedOutline'] })
    expect(r.included).not.toContain('detailedOutline')
    expect(r.omitted).toContain('detailedOutline')
  })

  it('共享注册源保留作者六项场景任务和备注，旧场景不补造任务', async () => {
    const { projectId, nodeId } = await seed()
    const detail = (await db.detailedOutlines.toArray())[0]
    const task = { entryState: '没有钥匙', goal: '找到可通行的路', keyChoice: '先询问守门人', outcome: '得到路线但尚未出发', exitState: '停在路口', sceneFunction: '建立一个可验证的小目标', notes: '不要追加追兵身份' }
    await db.detailedOutlines.update(detail.id!, { scenes: [{ ...detail.scenes[0], ...task }, detail.scenes[1]] })
    const result = await assembleContext({ projectId, outlineNodeId: nodeId, sourceKeys: ['detailedOutline'] })
    for (const value of Object.values(task)) expect(result.text).toContain(value)
    expect(result.text).not.toContain('undefined')
    expect(result.text.match(/进入状态:/g)).toHaveLength(1)
    expect((await db.detailedOutlines.get(detail.id!))!.scenes[1]).not.toHaveProperty('entryState')
  })
})
