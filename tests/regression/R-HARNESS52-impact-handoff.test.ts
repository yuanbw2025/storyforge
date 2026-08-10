import { describe, expect, it } from 'vitest'
import {
  buildImpactHandoffV2,
  buildImpactHandoffUrlV2,
  parseImpactHandoffV2,
  resolveImpactHandoffModuleV2,
} from '../../src/lib/consistency/impact-handoff'
import type { ImpactRemediationPlanV1 } from '../../src/lib/consistency/impact-remediation-plan'

const HASH = 'a'.repeat(64)

function plan(item: Partial<ImpactRemediationPlanV1['items'][number]> = {}): ImpactRemediationPlanV1 {
  const itemValue = {
    id: 'impact-remediation:fact:1',
    nodeId: 'fact:1',
    kind: 'fact' as const,
    table: 'temporalFacts',
    recordId: 1,
    action: 'review-fact' as const,
    mode: 'author-confirmed' as const,
    reason: '需要作者复核',
    dependencyNodeIds: ['source:chapters:7'],
    ...item,
  }
  return {
    version: 1,
    source: { table: 'chapters', recordId: 7, sourceTextHash: HASH },
    graphHash: HASH,
    items: [itemValue],
    counts: { total: 1, deterministic: 0, authorConfirmed: 1 },
    planHash: HASH,
  }
}

describe('R-HARNESS52 · 影响人工入口交接协议', () => {
  it('按既有人工模块映射治理项并保留返回章节', () => {
    const handoff = buildImpactHandoffV2({
      plan: plan(),
      itemId: 'impact-remediation:fact:1',
      decision: 'needs-manual-action',
      reviewRunId: 8,
      reviewReceiptHash: HASH,
      sourceOutlineNodeId: 11,
    })
    expect(handoff).toMatchObject({
      targetModule: 'fact-library',
      targetRecordId: 1,
      sourceChapterId: 7,
      returnModule: 'chapters-list',
      returnNodeId: 11,
      planHash: HASH,
      reviewRunId: 8,
      reviewReceiptHash: HASH,
    })
  })

  it('正文来源项回到已有章节编辑入口，而不是新建修复面板', () => {
    const handoff = buildImpactHandoffV2({
      plan: plan({
        id: 'impact-remediation:source:7',
        nodeId: 'source:chapters:7',
        kind: 'changed-source',
        table: 'chapters',
        recordId: 7,
        action: 'review-source',
      }),
      itemId: 'impact-remediation:source:7',
      decision: 'needs-manual-action',
      reviewRunId: 8,
      reviewReceiptHash: HASH,
      sourceOutlineNodeId: 11,
    })
    expect(handoff.targetModule).toBe('chapters-list')
    expect(handoff.targetRecordId).toBe(11)
  })

  it('地址可往返解析，并拒绝损坏或不完整证据', () => {
    const handoff = buildImpactHandoffV2({
      plan: plan({ action: 'review-derived-state', kind: 'state-card', table: 'stateCards', recordId: 22 }),
      itemId: 'impact-remediation:fact:1',
      decision: 'needs-manual-action',
      reviewRunId: 8,
      reviewReceiptHash: HASH,
      sourceOutlineNodeId: 11,
    })
    const url = buildImpactHandoffUrlV2(3, handoff)
    const raw = new URL(url, 'http://localhost').searchParams.get('impactHandoff')
    expect(parseImpactHandoffV2(raw)).toEqual({ ...handoff, targetModule: 'state-table', targetRecordId: 22 })
    expect(parseImpactHandoffV2(encodeURIComponent(JSON.stringify({ ...handoff, planHash: 'bad' })))).toBeNull()
    expect(parseImpactHandoffV2(encodeURIComponent(JSON.stringify({ ...handoff, reviewReceiptHash: 'bad' })))).toBeNull()
    expect(parseImpactHandoffV2(encodeURIComponent(JSON.stringify({ ...handoff, targetModule: 'inventory' })))).toBeNull()
    expect(parseImpactHandoffV2(encodeURIComponent(JSON.stringify({ ...handoff, action: 'rebuild-summary' })))).toBeNull()
    expect(parseImpactHandoffV2('%7Bbroken')).toBeNull()
  })

  it('不允许确定性项、未知表映射或未知模块绕过人工协议', () => {
    expect(() => buildImpactHandoffV2({
      plan: plan({ mode: 'deterministic', action: 'rebuild-summary', kind: 'summary', table: 'narrativeSummaryNodes' }),
      itemId: 'impact-remediation:fact:1',
      decision: 'needs-manual-action',
      reviewRunId: 8,
      reviewReceiptHash: HASH,
      sourceOutlineNodeId: null,
    })).toThrow('作者确认项')
    expect(resolveImpactHandoffModuleV2({ action: 'review-source-record', table: 'unknownTable' })).toBe('fact-library')
    expect(resolveImpactHandoffModuleV2({ action: 'review-source-record', table: 'powerSystems' })).toBe('power-system')
    expect(resolveImpactHandoffModuleV2({ action: 'review-source-record', table: 'cultivationSystems' })).toBe('power-system')
  })
})
