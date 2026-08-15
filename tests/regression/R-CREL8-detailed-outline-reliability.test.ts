import { describe, expect, it } from 'vitest'
import {
  createDetailedOutlineCreativeArtifactV1,
  revalidateDetailedOutlineCreativeDraftV1,
} from '../../src/lib/agent/detailed-outline-copilot'
import { buildDetailedOutlineGenerationRunContractV1 } from '../../src/lib/agent/run/detailed-outline-generation-durable'
import type { NarrativeBriefV1 } from '../../src/lib/agent/narrative-brief'

const brief: NarrativeBriefV1 = {
  version: 1,
  creativeGoal: '把潮门章纲拆成可执行场景',
  protagonistDesire: '进入潮门',
  obstacle: '守卫拒绝放行',
  stakes: '失踪船只会在涨潮前消失',
  requiredChoice: '是否暴露密令',
  entryState: '主角抵达潮门外港',
  exitChange: '主角取得进入内港的资格',
  nextPressure: '涨潮将在一小时后封闭入口',
  mustHonor: [],
  mustNotReveal: [],
  creativeFreedom: [],
  assumptions: [{
    version: 1,
    id: 'upstream:1',
    text: '守卫认识失踪船只的领航员',
    derivedFrom: ['candidate:story-arc-1'],
    confidence: 'low',
    conflictsWith: [],
    status: 'provisional',
  }],
}

const valid = JSON.stringify({
  scenes: [{
    title: '潮门试探',
    summary: '守灯人用密令试探守卫，迫使对方暴露失踪船只的线索。',
    location: '潮门外港',
    conflict: '隐藏身份与获得通行资格互相冲突。',
    pace: 'fast',
    estimatedWords: 1200,
    characterIds: [],
  }],
})

describe('CREL-8 · 场景细纲可靠性', () => {
  it('协议损坏仍保留一次调用的可编辑草稿，作者修订后只做本地重校验', async () => {
    const artifact = await createDetailedOutlineCreativeArtifactV1({
      raw: '场景一：潮门试探（不是 JSON）',
      operation: 'scenes',
      narrativeBrief: brief,
      qualityMode: 'balanced',
      modelIdentity: { provider: 'openai', model: 'test-model' },
      inputText: '生成场景细纲',
      durationMs: 320,
    })

    expect(artifact).toMatchObject({
      status: 'manual-repair',
      assumptions: [expect.objectContaining({ status: 'provisional' })],
      callEvidence: [{ callIndex: 1, purpose: 'generate', latencyMs: 320 }],
      repair: null,
    })
    expect(artifact.originalText).toContain('不是 JSON')

    const revalidated = revalidateDetailedOutlineCreativeDraftV1({
      raw: valid,
      operation: 'scenes',
      narrativeBrief: brief,
      previousArtifact: artifact,
    })
    expect(revalidated.status).toBe('ready')
    expect(revalidated.validFragments).toHaveLength(1)
    expect(revalidated.callEvidence).toEqual(artifact.callEvidence)
  })

  it('细纲 RunContract 明确单次生成且协议错误不自动重试', () => {
    const contract = buildDetailedOutlineGenerationRunContractV1({
      projectId: 1,
      worldGroupId: null,
      outlineNodeId: 2,
      operation: 'scenes',
    })
    expect(contract.budget.maxModelCalls).toBe(1)
    expect(contract.failurePolicy.onProtocolError).toBe('fail')
  })
})
