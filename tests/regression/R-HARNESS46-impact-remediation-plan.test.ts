import { describe, expect, it } from 'vitest'
import type { EditImpactGraphV1 } from '../../src/lib/consistency/impact-analysis'
import { buildImpactRemediationPlanV1 } from '../../src/lib/consistency/impact-remediation-plan'

function graph(): EditImpactGraphV1 {
  return {
    version: 1,
    source: { table: 'chapters', recordId: 7, sourceTextHash: 'a'.repeat(64) },
    nodes: [
      { id: 'source:chapters:7', kind: 'changed-source', table: 'chapters', recordId: 7 },
      { id: 'outline:11', kind: 'outline', table: 'outlineNodes', recordId: 11 },
      { id: 'chapter:8', kind: 'chapter', table: 'chapters', recordId: 8 },
      { id: 'outline:12', kind: 'outline', table: 'outlineNodes', recordId: 12 },
      { id: 'fact:21', kind: 'fact', table: 'temporalFacts', recordId: 21, status: 'stale' },
      { id: 'source-record:characters:4', kind: 'source-record', table: 'characters', recordId: 4 },
      { id: 'summary:31', kind: 'summary', table: 'narrativeSummaryNodes', recordId: 31 },
      { id: 'retrieval-chunk:41', kind: 'retrieval-chunk', table: 'retrievalChunks', recordId: 41, status: 'stale' },
      { id: 'state-card:51', kind: 'state-card', table: 'stateCards', recordId: 51 },
    ],
    edges: [
      { from: 'source:chapters:7', to: 'outline:11', relation: 'chapter-outline' },
      { from: 'source:chapters:7', to: 'chapter:8', relation: 'chronological-downstream' },
      { from: 'chapter:8', to: 'outline:12', relation: 'chapter-outline' },
      { from: 'source:chapters:7', to: 'fact:21', relation: 'source-fact' },
      { from: 'source-record:characters:4', to: 'fact:21', relation: 'fact-source-record' },
      { from: 'source:chapters:7', to: 'summary:31', relation: 'derived-summary' },
      { from: 'source:chapters:7', to: 'retrieval-chunk:41', relation: 'derived-retrieval' },
      { from: 'source:chapters:7', to: 'state-card:51', relation: 'derived-state' },
    ],
    staleFactIds: [21],
    downstreamChapterIds: [8],
    sourceRecordIds: ['characters:4'],
    graphHash: 'b'.repeat(64),
  }
}

describe('R-HARNESS46 · 确定性影响处理计划', () => {
  it('把所有影响节点闭集分类为系统重建或作者确认，并绑定图 hash', async () => {
    const plan = await buildImpactRemediationPlanV1(graph())
    expect(plan.graphHash).toBe('b'.repeat(64))
    expect(plan.source.sourceTextHash).toBe('a'.repeat(64))
    expect(plan.items).toHaveLength(9)
    expect(plan.counts).toEqual({ total: 9, deterministic: 2, authorConfirmed: 7 })
    expect(plan.items.find(item => item.nodeId === 'summary:31')).toMatchObject({
      action: 'rebuild-summary', mode: 'deterministic',
    })
    expect(plan.items.find(item => item.nodeId === 'retrieval-chunk:41')).toMatchObject({
      action: 'rebuild-retrieval', mode: 'deterministic',
    })
    expect(plan.items.find(item => item.nodeId === 'fact:21')).toMatchObject({
      action: 'review-fact', mode: 'author-confirmed',
      dependencyNodeIds: ['source-record:characters:4', 'source:chapters:7'],
    })
    expect(plan.items.find(item => item.nodeId === 'chapter:8')).toMatchObject({
      action: 'review-downstream-chapter', mode: 'author-confirmed',
    })
    expect(plan.planHash).toHaveLength(64)
  })

  it('同一图产生同一计划 hash，正文或图 hash 变化会使计划失效', async () => {
    const first = await buildImpactRemediationPlanV1(graph())
    const second = await buildImpactRemediationPlanV1(graph())
    expect(second.planHash).toBe(first.planHash)
    const changed = graph()
    changed.source.sourceTextHash = 'c'.repeat(64)
    changed.graphHash = 'd'.repeat(64)
    expect((await buildImpactRemediationPlanV1(changed)).planHash).not.toBe(first.planHash)
  })

  it('拒绝缺少版本或证据 hash 的伪影响图', async () => {
    const damaged = graph()
    damaged.graphHash = ''
    await expect(buildImpactRemediationPlanV1(damaged)).rejects.toThrow('影响图版本或 hash 无效')
  })
})
