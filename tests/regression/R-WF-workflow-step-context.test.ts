/**
 * R-WF · 工作流多步链上下文反例测试(FB-1 复现防护)
 *
 * 背景:社区用户江也反馈「极速起书」工作流第 2 步「世界起源」没有根据第 1 步
 * 「一句话故事」生成,且项目名/流派/维度全空,被感知为「串到别的书」。
 * 网络抓包确认根因:① runStep 递归读 React state `results` 闭包陈旧,
 * 上一步输出取不到;② 工作流未走 assembleContext,项目上下文全空。
 *
 * 本测试锁定修复后的纯整形逻辑 assembleWorkflowStepVars 的不变量,防止回潮。
 */
import { describe, it, expect } from 'vitest'
import { assembleWorkflowStepVars } from '../../src/components/settings/prompt/workflow-helpers'

describe('R-WF · 工作流步骤上下文整形', () => {
  const STEP1_OUTPUT =
    '这部小说讲述科技高度发达的未来世界中,人类与人工智能的冲突与融合,探索身份与自由。'

  it('R-WF-1:第 2 步必须带上显式入边连接的第 1 步输出', () => {
    const ctx = assembleWorkflowStepVars({
      step: { label: '世界起源' },
      upstreamInputs: [{
        sourceStepId: 'logline', sourceLabel: '一句话故事',
        targetVariable: 'worldContext', output: STEP1_OUTPUT,
      }],
      projectName: '测试书',
      genres: '科幻',
      assembledContext: '',
      worldRulesContext: '',
    })
    expect(String(ctx.worldContext)).toContain('人工智能')
    expect(String(ctx.worldContext)).toContain(STEP1_OUTPUT)
  })

  it('R-WF-2:项目名/流派/维度必须有值(修复全空 → AI 不再失去依据)', () => {
    const ctx = assembleWorkflowStepVars({
      step: { label: '世界起源' },
      upstreamInputs: [],
      projectName: '测试书',
      genres: '科幻',
    })
    expect(ctx.projectName).toBe('测试书')
    expect(ctx.genres).toBe('科幻')
    expect(ctx.dimension).toBe('世界起源') // 维度取步骤标签
  })

  it('R-WF-3:已存项目设定(assembleContext 结果)与上一步输出一起进入 worldContext', () => {
    const ctx = assembleWorkflowStepVars({
      step: { label: '主要角色' },
      upstreamInputs: [{
        sourceStepId: 'world', sourceLabel: '世界起源',
        targetVariable: 'worldContext', output: STEP1_OUTPUT,
      }],
      projectName: '测试书',
      genres: '科幻',
      assembledContext: '【世界观】已存的赛博都市设定',
    })
    expect(String(ctx.worldContext)).toContain('已存的赛博都市设定')
    expect(String(ctx.worldContext)).toContain('人工智能')
  })

  it('R-WF-4:显式端口可以把上游输出送入特定模板变量', () => {
    const ctx = assembleWorkflowStepVars({
      step: { label: '第一章正文' },
      upstreamInputs: [{
        sourceStepId: 'outline', sourceLabel: '章节细纲',
        targetVariable: 'chapterSummary', output: '第一卷第一章:主角觉醒',
      }],
      projectName: '测试书',
      genres: '科幻',
    })
    expect(ctx.chapterSummary).toContain('章节细纲')
    expect(ctx.chapterSummary).toContain('第一卷第一章:主角觉醒')
  })

  it('R-WF-5:第 1 步(无上一步)不应注入空的 worldContext,但项目元信息仍在', () => {
    const ctx = assembleWorkflowStepVars({
      step: { label: '一句话故事' },
      upstreamInputs: [],
      projectName: '测试书',
      genres: '科幻',
    })
    expect(ctx.worldContext).toBeUndefined()
    expect(ctx.projectName).toBe('测试书')
  })

  it('R-WF-6:步骤预填内容必须与配置提示一起进入 userHint', () => {
    const ctx = assembleWorkflowStepVars({
      step: { label: '一句话故事', userHint: '保留悬疑感' },
      upstreamInputs: [],
      projectName: '测试书',
      genres: '悬疑',
      userInput: '一个失忆侦探发现自己是凶手。',
    })
    expect(ctx.userHint).toBe('保留悬疑感\n一个失忆侦探发现自己是凶手。')
  })

  it('FLOW-1:显式图只注入目标节点自己的入边并按端口变量分组', () => {
    const ctx = assembleWorkflowStepVars({
      step: { label: '汇合生成' },
      projectName: '测试书',
      genres: '悬疑',
      assembledContext: '【已存设定】雾港',
      upstreamInputs: [
        {
          sourceStepId: 'world',
          sourceLabel: '世界设定',
          targetVariable: 'worldContext',
          output: '记忆可以买卖',
        },
        {
          sourceStepId: 'character',
          sourceLabel: '角色设计',
          targetVariable: 'characters',
          output: '失忆侦探林默',
        },
      ],
    })

    expect(ctx.characters).toContain('失忆侦探林默')
    expect(ctx.worldContext).toContain('世界设定 → worldContext')
    expect(ctx.worldContext).toContain('记忆可以买卖')
    expect(ctx.worldContext).not.toContain('拓扑相邻但未连接的输出')
  })
})
