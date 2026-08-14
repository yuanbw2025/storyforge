import { describe, expect, it } from 'vitest'
import type { ImpactRemediationItemV1 } from '../../src/lib/consistency/impact-remediation-plan'
import { resolveImpactDownstreamExecutorPolicyV1 } from '../../src/lib/agent/run/impact-downstream-policy'

function item(input: Partial<ImpactRemediationItemV1> & Pick<ImpactRemediationItemV1, 'kind' | 'table' | 'action' | 'mode'>): ImpactRemediationItemV1 {
  const recordId = input.recordId === undefined ? 7 : input.recordId
  const prefixes: Partial<Record<ImpactRemediationItemV1['kind'], string>> = {
    'changed-source': 'source:chapters',
    chapter: 'chapter',
    outline: 'outline',
    fact: 'fact',
    summary: 'summary',
    'retrieval-chunk': 'retrieval-chunk',
    'storyline-progress': 'storyline-progress',
    'storyline-crossing': 'storyline-crossing',
    'state-card': 'state-card',
    'item-ledger': 'item-ledger',
    'timeline-event': 'timeline-event',
  }
  const nodeId = input.kind === 'source-record'
    ? `source-record:${input.table}:${recordId}`
    : `${prefixes[input.kind]}:${recordId}`
  return {
    id: `impact-remediation:${nodeId}`,
    nodeId,
    recordId,
    dependencyNodeIds: [],
    ...input,
  }
}

describe('R-HARNESS81 · H57 下游执行器政策闭集', () => {
  it('为当前 planner 的全部合法节点形状登记唯一执行器和人工落点', () => {
    const sourceOutlineNodeId = 5
    const sourceRecords = [
      ['worldRules', 'world-rules'],
      ['worldviews', 'worldview-origin'],
      ['powerSystems', 'power-system'],
      ['cultivationSystems', 'power-system'],
      ['storyCores', 'story-design'],
      ['characters', 'characters'],
      ['characterRelations', 'relations'],
      ['storyArcs', 'story-arc'],
      ['storylineProgress', 'story-arc'],
      ['storylineCrossings', 'story-arc'],
      ['outlineNodes', 'outline'],
      ['detailedOutlines', 'detailed-outline'],
      ['creativeRules', 'rules'],
      ['references', 'references'],
    ] as const
    const cases: Array<{
      value: ImpactRemediationItemV1
      policyId: string
      executor: string
      manualModule: string | null
    }> = [
      {
        value: item({ kind: 'changed-source', table: 'chapters', action: 'review-source', mode: 'author-confirmed' }),
        policyId: 'author-source-v1', executor: 'author-review', manualModule: 'chapters-list',
      },
      {
        value: item({ kind: 'fact', table: 'temporalFacts', action: 'review-fact', mode: 'author-confirmed' }),
        policyId: 'author-fact-v1', executor: 'author-review', manualModule: 'fact-library',
      },
      ...sourceRecords.map(([table, manualModule]) => ({
        value: item({ kind: 'source-record', table, action: 'review-source-record', mode: 'author-confirmed' }),
        policyId: 'author-source-record-v1', executor: 'author-review', manualModule,
      })),
      {
        value: item({ kind: 'summary', table: 'narrativeSummaryNodes', action: 'rebuild-summary', mode: 'deterministic' }),
        policyId: 'deterministic-summary-v1', executor: 'deterministic-remediation', manualModule: null,
      },
      {
        value: item({ kind: 'retrieval-chunk', table: 'retrievalChunks', action: 'rebuild-retrieval', mode: 'deterministic' }),
        policyId: 'deterministic-retrieval-v1', executor: 'deterministic-remediation', manualModule: null,
      },
      {
        value: item({ kind: 'outline', table: 'outlineNodes', action: 'review-outline', mode: 'author-confirmed', recordId: sourceOutlineNodeId }),
        policyId: 'author-current-outline-v1', executor: 'author-review', manualModule: 'detailed-outline',
      },
      {
        value: item({ kind: 'outline', table: 'outlineNodes', action: 'review-outline', mode: 'author-confirmed', recordId: 8 }),
        policyId: 'outline-regeneration-v1', executor: 'outline-regeneration', manualModule: null,
      },
      {
        value: item({ kind: 'chapter', table: 'chapters', action: 'review-downstream-chapter', mode: 'author-confirmed' }),
        policyId: 'author-downstream-chapter-v1', executor: 'author-review', manualModule: 'chapters-list',
      },
      {
        value: item({ kind: 'storyline-progress', table: 'storylineProgress', action: 'review-derived-state', mode: 'author-confirmed' }),
        policyId: 'author-coupled-derived-v1', executor: 'author-review', manualModule: 'story-arc',
      },
      {
        value: item({ kind: 'storyline-crossing', table: 'storylineCrossings', action: 'review-derived-state', mode: 'author-confirmed' }),
        policyId: 'author-coupled-derived-v1', executor: 'author-review', manualModule: 'story-arc',
      },
      {
        value: item({ kind: 'state-card', table: 'stateCards', action: 'review-derived-state', mode: 'author-confirmed' }),
        policyId: 'author-coupled-derived-v1', executor: 'author-review', manualModule: 'state-table',
      },
      {
        value: item({ kind: 'item-ledger', table: 'itemLedger', action: 'review-derived-state', mode: 'author-confirmed' }),
        policyId: 'author-coupled-derived-v1', executor: 'author-review', manualModule: 'inventory',
      },
      {
        value: item({ kind: 'timeline-event', table: 'storyTimelineEvents', action: 'review-derived-state', mode: 'author-confirmed' }),
        policyId: 'story-timeline-regeneration-v1', executor: 'story-timeline-regeneration', manualModule: null,
      },
    ]

    for (const expected of cases) {
      const { value, ...shape } = expected
      const resolved = resolveImpactDownstreamExecutorPolicyV1({
        item: value,
        sourceOutlineNodeId,
      })
      expect(resolved).toMatchObject(shape)
      expect(resolved.reason.length).toBeGreaterThan(10)
    }
  })

  it('错 kind/action/table/mode、伪造 nodeId 与未知新类型全部 fail-closed', () => {
    const validTimeline = item({
      kind: 'timeline-event', table: 'storyTimelineEvents', action: 'review-derived-state', mode: 'author-confirmed',
    })
    const invalid = [
      { ...validTimeline, table: 'itemLedger' },
      { ...validTimeline, action: 'review-outline' as const },
      { ...validTimeline, mode: 'deterministic' as const },
      { ...validTimeline, nodeId: 'timeline-event:999' },
      { ...validTimeline, id: 'impact-remediation:timeline-event:999' },
      item({ kind: 'summary', table: 'narrativeSummaryNodes', action: 'rebuild-summary', mode: 'author-confirmed' }),
      item({ kind: 'state-card', table: 'stateCards', action: 'review-fact', mode: 'author-confirmed' }),
      { ...validTimeline, kind: 'future-generated-kind' as ImpactRemediationItemV1['kind'] },
      item({ kind: 'source-record', table: 'notRegistered', action: 'review-source-record', mode: 'author-confirmed' }),
      item({ kind: 'fact', table: 'temporalFacts', action: 'review-fact', mode: 'author-confirmed', recordId: 0 }),
    ]
    for (const value of invalid) {
      expect(() => resolveImpactDownstreamExecutorPolicyV1({
        item: value,
        sourceOutlineNodeId: 5,
      })).toThrow('没有受治理执行器政策')
    }
  })
})
