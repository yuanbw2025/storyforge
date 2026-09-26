import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { classifyRequestedDomainIdsV1, selectAgentSkillIdV1 } from '../../src/lib/agent/workflow-catalog'
import { createMasterAgentPlan, executeMasterAgentPlan } from '../../src/lib/agent/orchestrator'
import * as client from '../../src/lib/ai/client'
import { prepareProseCopilot } from '../../src/lib/agent/prose-copilot'
import { prepareOutlineCopilot } from '../../src/lib/agent/outline-copilot'
import { readLongformProgressV1 } from '../../src/lib/agent/longform-progress'
import { runGenerationNode } from '../../src/lib/generation/generation-node'
import { parseAuthorOrdinalV1 } from '../../src/lib/agent/author-intent'
import { seedCurrentMasterCandidate } from '../helpers/current-master-candidate'
import { rejectMasterAgentCandidateV1 } from '../../src/lib/agent/run/master-adoption'
import { findResumableMasterAgentRunV1, parseMasterAgentPlanV1, hashMasterAgentPlanV1 } from '../../src/lib/agent/run/master-durable'

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
  afterEach(() => { vi.restoreAllMocks(); db.close() })

  it('不存在的目标在规划前给出准确说明，不让模型要求补写中间章节', async () => {
    const { project, scope } = await fixture()
    const complete = vi.fn()
    const plan = await createMasterAgentPlan({
      projectId: project.id!, scope, worldGroupId: null, planningOnly: true,
      request: '只写第八章正文，不要创建章节，不要改第一章。',
    }, { complete })
    expect(complete).not.toHaveBeenCalled()
    expect(plan.tasks).toEqual([])
    expect(plan.summary).toContain('未找到指定的第八章')
    expect(plan.summary).toContain('不必先写完前面的章节')
    expect(await db.chapters.count()).toBe(0)
  })

  it('保留多轮规划补充，但写入目标仍由作者原话决定', async () => {
    const { project, scope, secondId } = await fixture()
    const request = '按刚才的讨论写第二章正文，不要改第一章。'
    const plan = await createMasterAgentPlan(
      { projectId: project.id!, scope, worldGroupId: null, request, planningOnly: true },
      { complete: async () => JSON.stringify({ summary: '续接讨论方向', tasks: [{
        id: 'prose', agentId: 'prose', instruction: '写第一章正文：季禾是修钟师，遇到停在十三点的钟。', dependsOn: [],
      }] }) },
    )
    delete plan.phase
    const persisted = parseMasterAgentPlanV1(JSON.parse(JSON.stringify(plan)))
    const calls = vi.spyOn(client, 'chat').mockResolvedValue('季禾推开钟铺的门，柜台后那只钟停在十三点。她伸手拨动指针，却听见柜台底下传来敲击声。掌柜说那不是钟声，让她别碰抽屉。季禾收回手，看见钥匙孔里冒出一丝白雾。她认得那股冷意，却想不起曾在何处遇见。')
    const candidates = await executeMasterAgentPlan({ projectId: project.id!, scope, worldGroupId: null, plan: persisted })
    expect(candidates[0].payload.proseOutlineNodeId).toBe(secondId)
    const messages = calls.mock.calls[0][0].map(message => message.content).join('\n')
    expect(messages).toContain(request)
    expect(messages).toContain('季禾是修钟师')
    expect(messages).toContain('规划解读只可补充原话未指明的内容')
    expect(await db.chapters.count()).toBe(0)
    const changed = structuredClone(persisted)
    changed.tasks[0].requestContext!.originalRequest = '写第一章正文'
    expect(await hashMasterAgentPlanV1(changed)).not.toBe(await hashMasterAgentPlanV1(persisted))
  })

  it('多任务保留原话，各任务仍保持独立目标，旧计划无需补字段', async () => {
    const { project, scope } = await fixture()
    const request = '先规划卷纲，再写第一章正文；主角是夜班邮差，来信出自三天后的自己。不要创建角色卡。'
    const plan = await createMasterAgentPlan(
      { projectId: project.id!, scope, worldGroupId: null, request },
      { complete: async () => JSON.stringify({ summary: '分步生成', tasks: [
        { id: 'outline', agentId: 'outline', instruction: '生成卷纲', dependsOn: [] },
        { id: 'prose', agentId: 'prose', instruction: '写第一章正文', dependsOn: ['outline'] },
      ] }) },
    )
    expect(plan.tasks.map(task => task.instruction)).toEqual(['生成卷纲', '写第一章正文'])
    for (const task of parseMasterAgentPlanV1(plan).tasks) expect(task.requestContext?.originalRequest).toBe(request)
    const legacy = structuredClone(plan)
    for (const task of legacy.tasks) delete task.requestContext
    expect(parseMasterAgentPlanV1(legacy)).toEqual(legacy)
    const bad = structuredClone(plan)
    Object.assign(bad.tasks[0].requestContext!, { unauthorizedTarget: 9 })
    expect(() => parseMasterAgentPlanV1(bad)).toThrow()
  })

  it('作者拒绝候选后不会把该运行当成中断并提示恢复', async () => {
    const { scope, conversation, candidate } = await seedCurrentMasterCandidate()
    await rejectMasterAgentCandidateV1({
      scope, worldGroupId: null, runId: candidate.payload.runId!,
      candidateEventId: candidate.event.id!,
    })
    expect(await findResumableMasterAgentRunV1({ scope, conversationId: conversation.id! })).toBeNull()
    expect(await db.agentRuns.count()).toBe(1)
    expect(await db.characters.count()).toBe(0)
  })

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

  it('书名号中的未知卷章名不能回退到默认位置', async () => {
    const { project, scope } = await fixture()
    await expect(prepareProseCopilot({
      projectId: project.id!, scope, worldGroupId: null,
      authorRequest: '写《尚不存在》的正文，雨夜收信。',
    })).rejects.toThrow('未找到指定章节《尚不存在》')
    await expect(prepareOutlineCopilot({
      projectId: project.id!, scope, worldGroupId: null, skillId: 'outline.chapters',
      authorRequest: '生成《尚不存在》的章纲。',
    })).rejects.toThrow('未找到指定卷《尚不存在》')
    expect(await db.chapters.count()).toBe(0)
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
        request: '只写第一个场景，夜班邮差林照发现自己三天后寄来的信；不要创建角色卡。开头拆信，结尾车站灯熄灭。',
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
    for (const task of plan.tasks) {
      expect(task.instruction).toContain('夜班邮差林照')
      expect(task.instruction).toContain('三天后')
      expect(task.instruction).toContain('不要创建角色卡')
      expect(task.instruction).toContain('结尾车站灯熄灭')
    }
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
    expect(prepared.prepared.messages.find(message => message.role === 'system')?.content)
      .toContain('只输出 1 个 JSON 元素')
    expect(prepared.prepared.messages.at(-1)?.content).toContain('一句话摘要')
    expect(prepared.prepared.messages.at(-1)?.content).toContain('三天后')
    const result = await runGenerationNode(prepared.node, prepared.prepared)
    expect(result.gate.status).toBe('blocked')
  })

  it('单任务保留作者原话中的目标和长尾限制，不受规划改写或 1000 字裁剪影响', async () => {
    const { project, scope } = await fixture()
    const request = '只写第二章正文。' + '雨夜街道。'.repeat(210) + '结尾必须停在蓝色信封落地；不要写第一章。'
    const plan = await createMasterAgentPlan(
      { projectId: project.id!, scope, worldGroupId: null, request, planningOnly: true },
      { complete: async () => JSON.stringify({
        summary: '写一个场景',
        tasks: [{ id: 'prose', agentId: 'prose', instruction: '写第一章正文', dependsOn: [] }],
      }) },
    )
    expect(plan.tasks).toHaveLength(1)
    expect(plan.tasks[0].instruction).toBe(request)
    const prepared = await prepareProseCopilot({
      projectId: project.id!, scope, worldGroupId: null, authorRequest: plan.tasks[0].instruction,
    })
    expect(prepared.prepared.messages.map(message => message.content).join('\n'))
      .toContain('结尾必须停在蓝色信封落地')
  })
})
