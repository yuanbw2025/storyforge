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

  it('R-WF-1:第 2 步必须带上第 1 步的输出(修复闭包陈旧 → 链路贯通)', () => {
    // 模拟「世界起源」步骤:inputMapping 映射到 storyCore(与模板变量 worldContext 不一致)
    const ctx = assembleWorkflowStepVars({
      step: {
        label: '世界起源',
        inputMapping: { previousOutput: 'storyCore' },
      },
      prevOutput: STEP1_OUTPUT,
      projectName: '测试书',
      genres: '科幻',
      assembledContext: '',
      worldRulesContext: '',
    })
    // 关键:即便 inputMapping 名字对不上模板变量,通用槽位 worldContext 也必须带上上一步输出
    expect(String(ctx.worldContext)).toContain('人工智能')
    expect(String(ctx.worldContext)).toContain(STEP1_OUTPUT)
  })

  it('R-WF-2:项目名/流派/维度必须有值(修复全空 → AI 不再失去依据)', () => {
    const ctx = assembleWorkflowStepVars({
      step: { label: '世界起源', inputMapping: { previousOutput: 'storyCore' } },
      prevOutput: STEP1_OUTPUT,
      projectName: '测试书',
      genres: '科幻',
    })
    expect(ctx.projectName).toBe('测试书')
    expect(ctx.genres).toBe('科幻')
    expect(ctx.dimension).toBe('世界起源') // 维度取步骤标签
  })

  it('R-WF-3:已存项目设定(assembleContext 结果)与上一步输出一起进入 worldContext', () => {
    const ctx = assembleWorkflowStepVars({
      step: { label: '主要角色', inputMapping: { previousOutput: 'worldContext' } },
      prevOutput: STEP1_OUTPUT,
      projectName: '测试书',
      genres: '科幻',
      assembledContext: '【世界观】已存的赛博都市设定',
    })
    expect(String(ctx.worldContext)).toContain('已存的赛博都市设定')
    expect(String(ctx.worldContext)).toContain('人工智能')
  })

  it('R-WF-4:保留 inputMapping 中的特定变量(如 chapter.content 的 chapterSummary)', () => {
    const ctx = assembleWorkflowStepVars({
      step: { label: '第一章正文', inputMapping: { previousOutput: 'chapterSummary' } },
      prevOutput: '第一卷第一章:主角觉醒',
      projectName: '测试书',
      genres: '科幻',
    })
    expect(ctx.chapterSummary).toBe('第一卷第一章:主角觉醒')
  })

  it('R-WF-5:第 1 步(无上一步)不应注入空的 worldContext,但项目元信息仍在', () => {
    const ctx = assembleWorkflowStepVars({
      step: { label: '一句话故事' },
      prevOutput: '',
      projectName: '测试书',
      genres: '科幻',
    })
    expect(ctx.worldContext).toBeUndefined()
    expect(ctx.projectName).toBe('测试书')
  })
})
