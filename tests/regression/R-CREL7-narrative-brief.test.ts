import { describe, expect, it } from 'vitest'
import type { AssembleContextResult } from '../../src/lib/registry/types'
import {
  buildNarrativeBriefV1,
  formatNarrativeBriefForPromptV1,
  parseNarrativeBriefV1,
} from '../../src/lib/agent/narrative-brief'

function assembled(entries: Array<[string, string]>): AssembleContextResult {
  return {
    text: entries.map(([, content]) => content).join('\n\n'),
    included: entries.map(([key]) => key),
    segments: entries.map(([key, content]) => ({
      label: key,
      layer: 'L1',
      content,
      tokens: 100,
      trimmable: false,
    })),
    omitted: [],
    trimmed: [],
    totalInputTokens: entries.length * 100,
    inputBudget: 20_000,
    overBudgetBeforeTrim: false,
    overBudgetAfterTrim: false,
  }
}

describe('CREL-7 · NarrativeBrief 运行时叙事任务合同', () => {
  it('只从已装配注册来源提取已知驱动力，缺失项保持显式开放', () => {
    const brief = buildNarrativeBriefV1({
      authorRequest: '规划一条围绕潮汐钟的主线',
      assembled: assembled([
        ['storyCore', [
          '【故事核心】',
          '一句话故事：守灯人必须在城市与共同记忆之间作出选择。',
          '主题：记忆与责任',
          '核心冲突：守灯人必须决定是否敲响会抹除全城记忆的潮汐钟。',
        ].join('\n')],
        ['characters', [
          '【核心角色（完整信息）】',
          '阿澜（主要角色）；动机/欲望：找回失踪的姐姐；目标(短/长期)：进入钟塔并找到姐姐',
        ].join('\n')],
        ['worldview', '【世界观】\n世界来源：盐海退潮时浮空城会短暂出现。'],
      ]),
    })

    expect(brief).toMatchObject({
      version: 1,
      creativeGoal: '规划一条围绕潮汐钟的主线',
      protagonistDesire: '进入钟塔并找到姐姐',
      obstacle: '守灯人必须决定是否敲响会抹除全城记忆的潮汐钟。',
      requiredChoice: '守灯人必须决定是否敲响会抹除全城记忆的潮汐钟。',
      assumptions: [],
    })
    expect(brief.stakes).toContain('待本轮候选提出')
    expect(brief.mustHonor).toEqual(expect.arrayContaining([
      '守灯人必须在城市与共同记忆之间作出选择。',
      '盐海退潮时浮空城会短暂出现。',
    ]))
    expect(brief.creativeFreedom).toEqual(expect.arrayContaining([
      expect.stringContaining('失败代价'),
      expect.stringContaining('退出变化'),
      expect.stringContaining('下一步压力'),
    ]))
    expect(brief.creativeFreedom.join('\n')).not.toContain('主角欲望')
  })

  it('只有零散世界观时仍形成推进任务，不把开放项伪装成 Canon', () => {
    const brief = buildNarrativeBriefV1({
      authorRequest: '从这个设定开始讲故事',
      assembled: assembled([
        ['worldview', '【世界观】\n世界来源：每十年海床会升起一座城。'],
      ]),
    })

    expect(brief.protagonistDesire).toContain('待本轮候选提出')
    expect(brief.obstacle).toContain('待本轮候选提出')
    expect(brief.creativeFreedom).toHaveLength(7)
    expect(brief.assumptions).toEqual([])
    expect(formatNarrativeBriefForPromptV1(brief)).toContain(
      '开放项必须转化为行动、阻力、选择和状态变化，不要用世界观介绍代替故事推进。',
    )
  })

  it('继承上游候选的临时假设并在提示中保留非 Canon 边界', () => {
    const brief = buildNarrativeBriefV1({
      authorRequest: '继续规划下一卷',
      assembled: assembled([]),
      inheritedAssumptions: [{
        version: 1,
        id: 'story-arc-1:assumption:1',
        text: '潮汐钟可以只抹除一段指定记忆',
        derivedFrom: ['candidate:story-arc-1'],
        confidence: 'low',
        conflictsWith: [],
        status: 'provisional',
      }],
    })

    expect(brief.assumptions).toEqual([
      expect.objectContaining({
        id: 'story-arc-1:assumption:1',
        status: 'provisional',
      }),
    ])
    const prompt = formatNarrativeBriefForPromptV1(brief)
    expect(prompt).toContain('上游临时假设（作者采纳前不是正式设定）')
    expect(prompt).toContain('潮汐钟可以只抹除一段指定记忆')
  })

  it('拒绝额外字段、重复项和冒充已确认事实的运行时假设', () => {
    const base = buildNarrativeBriefV1({
      authorRequest: '推进故事',
      assembled: assembled([]),
    })
    expect(() => parseNarrativeBriefV1({ ...base, leaked: true })).toThrow('字段必须严格')
    expect(() => parseNarrativeBriefV1({
      ...base,
      mustHonor: ['同一事实', '同一事实'],
    })).toThrow('不能有重复项')
    expect(() => parseNarrativeBriefV1({
      ...base,
      assumptions: [{
        version: 1,
        id: 'assumption:1',
        text: '主角与钟楼守卫相识',
        derivedFrom: ['creativeGoal'],
        confidence: 'low',
        conflictsWith: [],
        status: 'author-confirmed',
      }],
    })).toThrow('只能携带 provisional')
  })
})
