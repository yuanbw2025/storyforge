import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { classifyRequestedDomainIdsV1, selectAgentSkillIdV1 } from '../../src/lib/agent/workflow-catalog'
import { createMasterAgentPlan } from '../../src/lib/agent/orchestrator'
import { prepareProseCopilot } from '../../src/lib/agent/prose-copilot'
import { prepareOutlineCopilot } from '../../src/lib/agent/outline-copilot'
import { readLongformProgressV1 } from '../../src/lib/agent/longform-progress'
import { runGenerationNode } from '../../src/lib/generation/generation-node'
import { parseAuthorOrdinalV1 } from '../../src/lib/agent/author-intent'

async function fixture() {
  const { project, scope } = await seedCurrentWorkspace('自由选写')
  const now = Date.now()
  const row = { summary: '', order: 0, worldGroupId: null, createdAt: now, updatedAt: now }
  const volumeId = (await db.outlineNodes.add(
    stampNewRecord(
      scope,
      'outlineNodes',
      { ...row, title: '港口', type: 'volume', parentId: null },
      { owner: 'work' },
    ),
  )) as number
  const firstId = (await db.outlineNodes.add(
    stampNewRecord(
      scope,
      'outlineNodes',
      { ...row, title: '雨夜来信', type: 'chapter', parentId: volumeId },
      { owner: 'work' },
    ),
  )) as number
  const secondId = (await db.outlineNodes.add(
    stampNewRecord(
      scope,
      'outlineNodes',
      { ...row, title: '消失的邮差', type: 'chapter', order: 1, parentId: volumeId },
      { owner: 'work' },
    ),
  )) as number
  return { project, scope, firstId, secondId, volumeId }
}

describe('R-LONGFORM · 作者自由选写和目标保护', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })
  afterEach(() => db.close())

  it.each([
    ['只写第一个场景，不要补全世界设定和角色卡。', ['prose']],
    ['不要生成角色，只写第一章正文', ['prose']],
    ['跳过世界观和角色，只规划两卷卷纲', ['outline']],
    ['先不写正文，只设计一个反派', ['character']],
    ['暂时不要生成角色', []],
    ['不要续写，生成第一章正文', ['prose']],
    ['生成正文但不要创建角色', ['prose']],
    ['写一个离别场景，不必补全世界设定', ['prose']],
    ['设计一位不需要睡眠的角色', ['character']],
    ['生成正文并且不要生成角色', ['prose']],
  ])('尊重否定边界：%s', (request, expected) => {
    expect([...classifyRequestedDomainIdsV1(request)]).toEqual(expected)
  })

  it('续写禁令不会把新写操作路由到追加正文', () => {
    expect(selectAgentSkillIdV1('prose', '不要续写，生成第一章正文')).toBe('prose.generate')
  })

  it('世界、故事、角色、细纲全部留白也能跳写第二章；正式数据保持不变', async () => {
    const { project, scope, secondId } = await fixture()
    const prepared = await prepareProseCopilot({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: '不要改第一章《雨夜来信》，写第二章正文：雨停以后，邮差发现信箱里有一封来自自己的信。不要重写其他章节。',
    })
    expect(prepared.outlineNodeId).toBe(secondId)
    expect(prepared.prepared.messages.map((message) => message.content).join('\n')).toContain('雨停以后')
    expect(await db.chapters.count()).toBe(0)
    expect(await db.characters.count()).toBe(0)
    expect(await db.detailedOutlines.count()).toBe(0)
    expect((await readLongformProgressV1(scope, null)).nextRequest).toContain('正文')
  })

  it('序号与标题冲突时拒绝写入，不猜测另一个目标', async () => {
    const { project, scope } = await fixture()
    await expect(
      prepareProseCopilot({
        projectId: project.id!,
        scope,
        worldGroupId: null,
        authorRequest: '写第二章《雨夜来信》的正文',
      }),
    ).rejects.toThrow('序号与标题')
  })

  it('含糊中文章序不会截断成另一个真实章节，且不产生正式写入', async () => {
    const { project, scope } = await fixture()
    const before = await db.outlineNodes.toArray()
    for (const ordinal of ['一二', '一零三', '一百二三']) {
      await expect(prepareProseCopilot({
        projectId: project.id!, scope, worldGroupId: null,
        authorRequest: `写第${ordinal}章正文，邮差来到港口。`,
      })).rejects.toThrow('未找到指定')
    }
    expect(await db.chapters.count()).toBe(0)
    expect(await db.outlineNodes.toArray()).toEqual(before)
  })

  it('明确第一卷不会回退最后一卷，不存在的卷不会默默创建', async () => {
    const { project, scope, volumeId } = await fixture()
    const now = Date.now()
    await db.outlineNodes.add(
      stampNewRecord(
        scope,
        'outlineNodes',
        {
          title: '远山',
          summary: '到山上寻找邮差',
          type: 'volume',
          parentId: null,
          order: 1,
          worldGroupId: null,
          createdAt: now,
          updatedAt: now,
        },
        { owner: 'work' },
      ),
    )
    const prepared = await prepareOutlineCopilot({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: '不要写第二卷《远山》，为第一卷生成一个章纲',
      skillId: 'outline.chapters',
    })
    expect(prepared.parentVolumeId).toBe(volumeId)
    await expect(
      prepareOutlineCopilot({
        projectId: project.id!,
        scope,
        worldGroupId: null,
        authorRequest: '为第99卷生成章纲',
        skillId: 'outline.chapters',
      }),
    ).rejects.toThrow('未找到指定')
    await expect(
      prepareOutlineCopilot({
        projectId: project.id!,
        scope,
        worldGroupId: null,
        authorRequest: '为第一卷《远山》生成章纲',
        skillId: 'outline.chapters',
      }),
    ).rejects.toThrow('卷序号与卷名')
    await expect(
      prepareOutlineCopilot({
        projectId: project.id!, scope, worldGroupId: null,
        authorRequest: '为第一二卷生成章纲', skillId: 'outline.chapters',
      }),
    ).rejects.toThrow('未找到指定')
  })

  it.each([
    ['一百零二', 102],
    ['三百二十', 320],
    ['一千零一', 1001],
    ['21', 21],
  ])('长篇中文章序 %s', (text, ordinal) => {
    expect(parseAuthorOrdinalV1(text)).toBe(ordinal)
  })

  it.each(['一二', '一零三', '一百二三'])('不截断含糊中文章序 %s', text => {
    expect(parseAuthorOrdinalV1(text)).toBeNull()
  })

  it('模型以自然语言回答讨论时保留回复，绝不猜测写入', async () => {
    const { project, scope } = await fixture()
    const plan = await createMasterAgentPlan(
      {
        projectId: project.id!,
        scope,
        worldGroupId: null,
        request: '我想讨论这个场景的氛围',
        planningOnly: true,
      },
      { complete: async () => '可以从雨声与灯光的反差入手，先写一个动作即可。' },
    )
    expect(plan.summary).toContain('雨声')
    expect(plan.tasks).toEqual([])
    expect(await db.agentRuns.count()).toBe(0)
  })

  it('候选讨论即使模型试图提出任务也只能产生回复', async () => {
    const { project, scope } = await fixture()
    const plan = await createMasterAgentPlan(
      {
        projectId: project.id!,
        scope,
        worldGroupId: null,
        request: '这位角色为什么这样做',
        planningOnly: true,
        readOnlyDiscussion: true,
      },
      {
        complete: async () =>
          JSON.stringify({
            summary: '可以加强动机。',
            tasks: [{ id: 'bad', agentId: 'character', instruction: '生成角色', dependsOn: [] }],
          }),
      },
    )
    expect(plan.tasks).toEqual([])
    expect(await db.characters.count()).toBe(0)
  })

  it('角色补全只绑定允许的字段，不把禁止改动的外貌加入写入范围', async () => {
    const { project, scope } = await fixture()
    const now = Date.now()
    const characterId = await db.characters.add(stampNewRecord(scope, 'characters', {
      name: '青禾', homeWorldGroupId: null, isCrossWorld: false, roleWeight: 'npc',
      moralAxis: 'good', orderAxis: 'lawful', appearance: '', background: '',
      createdAt: now, updatedAt: now,
    }, { owner: 'world' }) as any)
    for (const request of ['补全青禾角色的背景故事，不要修改外貌', '补全青禾角色，不要修改外貌']) {
      const plan = await createMasterAgentPlan({ projectId: project.id!, scope, worldGroupId: null, request, planningOnly: true }, {
        complete: async () => JSON.stringify({ summary: '补全选定角色字段', tasks: [{ id: 'character', agentId: 'character', instruction: request, dependsOn: [] }] }),
      })
      expect(plan.tasks[0].characterSupplementRequest?.characterId).toBe(characterId)
      expect(plan.tasks[0].characterSupplementRequest?.dimensions).toContain('background')
      expect(plan.tasks[0].characterSupplementRequest?.dimensions).not.toContain('appearance')
    }
    expect((await db.characters.get(characterId))?.background).toBe('')
  })

  it('全是否定的请求不会从模型任务或默认角色路径获得写入权限', async () => {
    const { project, scope } = await fixture()
    const plan = await createMasterAgentPlan(
      { projectId: project.id!, scope, worldGroupId: null, request: '不要生成角色', planningOnly: true },
      {
        complete: async () =>
          JSON.stringify({
            summary: '收到。',
            tasks: [{ id: 'bad', agentId: 'character', instruction: '生成角色', dependsOn: [] }],
          }),
      },
    )
    expect(plan.tasks).toEqual([])
  })
  it('空白作品只提出可确认的最小卷章计划，讨论不创建正式数据', async () => {
    const { project, scope } = await seedCurrentWorkspace('从一个场景开始')
    const plan = await createMasterAgentPlan(
      {
        projectId: project.id!,
        scope,
        worldGroupId: null,
        request: '只写第一个场景，邮差发现来自自己的信',
        planningOnly: true,
      },
      {
        complete: async () =>
          JSON.stringify({
            summary: '写一个场景',
            tasks: [
              {
                id: 'prose',
                agentId: 'prose',
                instruction: '写第一章正文，邮差发现来自自己的信',
                dependsOn: [],
              },
            ],
          }),
      },
    )
    expect(plan.phase).toBe('proposal')
    expect(plan.tasks.map((task) => task.skillId)).toEqual([
      'outline.volumes',
      'outline.chapters',
      'prose.generate',
    ])
    expect(plan.tasks[2].dependsOn).toEqual([plan.tasks[1].id])
    expect(await db.outlineNodes.count()).toBe(0)
    expect(await db.agentRuns.count()).toBe(0)
    const prepared = await prepareOutlineCopilot(
      {
        projectId: project.id!,
        scope,
        worldGroupId: null,
        authorRequest: plan.tasks[0].instruction,
        skillId: 'outline.volumes',
      },
      {
        runAI: async () =>
          JSON.stringify([
            { title: '卷一', summary: '来信' },
            { title: '卷二', summary: '追踪' },
          ]),
      },
    )
    expect(prepared.snapshot.maxItems).toBe(1)
    const result = await runGenerationNode(prepared.node, prepared.prepared)
    expect(result.gate.status).toBe('blocked')
  })
})
