import { beforeEach, describe, expect, it } from 'vitest'
import { estimateCreativeRunPreviewV1 } from '../../src/lib/agent/creative-run-preview'

describe('CREL-12 · 运行前成本和产物预览', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('单领域直接生成不为编排器额外收费', () => {
    const preview = estimateCreativeRunPreviewV1({
      request: '规划第一卷章纲',
      qualityMode: 'economy',
      teamBudgetProfile: 'economy',
    })

    expect(preview).toMatchObject({
      workflowId: 'single-domain-direct',
      artifactLabels: ['故事规划'],
      artifactCount: 1,
      deferredArtifactLabels: [],
      plannerCalls: 0,
      requiredReviewCalls: 0,
      usualModelCalls: 1,
      hardMaxModelCalls: 7,
      hardMaxTokens: 80_000,
      automaticRepairCallsPerArtifact: 0,
    })
  })

  it('规划加正文必须先过作者确认屏障，不能把两份产物暗中连跑', () => {
    const preview = estimateCreativeRunPreviewV1({
      request: '规划第一章章纲，然后写出第一章正文',
      qualityMode: 'balanced',
      teamBudgetProfile: 'balanced',
    })

    expect(preview).toMatchObject({
      workflowId: 'staged-author-confirmed',
      artifactLabels: ['故事规划'],
      artifactCount: 1,
      deferredArtifactLabels: ['正文'],
      plannerCalls: 1,
      usualModelCalls: 2,
      hardMaxModelCalls: 7,
      hardMaxTokens: 160_000,
      automaticRepairCallsPerArtifact: 1,
    })
  })

  it('有限并行把强制语义复核计入常规调用数', () => {
    const preview = estimateCreativeRunPreviewV1({
      request: '同时用灵感碎片补充世界设定',
      qualityMode: 'balanced',
      teamBudgetProfile: 'expanded',
    })

    expect(preview.workflowId).toBe('multi-domain-fan-out')
    expect(preview.artifactLabels).toEqual(['世界设定', '灵感反推'])
    expect(preview.plannerCalls).toBe(1)
    expect(preview.requiredReviewCalls).toBe(2)
    expect(preview.usualModelCalls).toBe(5)
    expect(preview.hardMaxTokens).toBe(240_000)
  })
})
