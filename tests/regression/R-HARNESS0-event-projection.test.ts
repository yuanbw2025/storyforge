import { describe, expect, it } from 'vitest'
import { parseAgentRunEventV1 } from '../../src/lib/agent/run/event-schema'
import {
  hashAgentRunProjectionV1,
  isAgentRunCompletedV1,
  replayAgentRunEventsV1,
} from '../../src/lib/agent/run/projection'

const CONTRACT_HASH = 'a'.repeat(64)
const OBJECTIVE_HASH = 'b'.repeat(64)
const OUTPUT_HASH = 'c'.repeat(64)
const RECEIPT_HASH = 'd'.repeat(64)

function event(
  sequence: number,
  type: string,
  payload: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return {
    version: 1,
    runId: 9,
    sequence,
    generation: 1,
    projectId: 7,
    worldGroupId: null,
    contractHash: CONTRACT_HASH,
    type,
    createdAt: 1_786_111_000_000 + sequence,
    payload,
    ...overrides,
  }
}

function successfulStepEvents() {
  return [
    event(1, 'run.created', { objectiveHash: OBJECTIVE_HASH }),
    event(2, 'contract.accepted', {}),
    event(3, 'step.scheduled', { stepId: 'outline.generate' }),
    event(4, 'step.started', { stepId: 'outline.generate', attempt: 1 }),
    event(5, 'model.responded', { stepId: 'outline.generate', attempt: 1, outputHash: OUTPUT_HASH }),
    event(6, 'step.succeeded', { stepId: 'outline.generate', attempt: 1, outputHash: OUTPUT_HASH }),
  ]
}

describe('R-HARNESS0-event-projection · 严格事件回放', () => {
  it('模型已经返回结果、步骤成功，也不能自报 completed', () => {
    const projection = replayAgentRunEventsV1(successfulStepEvents())

    expect(projection.state).toBe('running')
    expect(projection.terminalReceiptHash).toBeUndefined()
    expect(isAgentRunCompletedV1(projection)).toBe(false)
  })

  it('只有 verification.accepted 的 fresh receipt 入口可进入 completed', () => {
    const events = [
      ...successfulStepEvents(),
      event(7, 'verification.started', { verifierSetVersion: 'terminal-v1' }),
      event(8, 'verification.accepted', { receiptHash: RECEIPT_HASH }),
    ]
    const projection = replayAgentRunEventsV1(events)

    expect(projection.state).toBe('completed')
    expect(projection.terminalReceiptHash).toBe(RECEIPT_HASH)
    expect(isAgentRunCompletedV1(projection)).toBe(true)
  })

  it('完成凭证失效后退出 completed，必须重新运行终态验证', () => {
    const projection = replayAgentRunEventsV1([
      ...successfulStepEvents(),
      event(7, 'verification.started', { verifierSetVersion: 'terminal-v1' }),
      event(8, 'verification.accepted', { receiptHash: RECEIPT_HASH }),
      event(9, 'verification.staled', {
        previousReceiptHash: RECEIPT_HASH,
        reason: 'project-import-scope-rebound',
      }),
    ])

    expect(projection.state).toBe('running')
    expect(projection.terminalReceiptHash).toBeUndefined()
    expect(isAgentRunCompletedV1(projection)).toBe(false)
  })

  it('拒绝未知事件、未知字段和版本', () => {
    expect(() => parseAgentRunEventV1(event(1, 'model.declared-complete', {}))).toThrow('event.type')
    expect(() => parseAgentRunEventV1({
      ...event(1, 'run.created', { objectiveHash: OBJECTIVE_HASH }),
      hiddenReasoning: '不得进入账本',
    })).toThrow('event.hiddenReasoning: 未知字段')
    expect(() => parseAgentRunEventV1(event(1, 'run.created', { objectiveHash: OBJECTIVE_HASH }, { version: 2 })))
      .toThrow('仅支持版本 1')
  })

  it('序列缺口、scope 污染和非法状态转换均 fail-closed', () => {
    const gap = replayAgentRunEventsV1([
      event(1, 'run.created', { objectiveHash: OBJECTIVE_HASH }),
      event(3, 'contract.accepted', {}),
    ])
    expect(gap.state).toBe('recovery_required')
    expect(gap.errors[0]).toContain('事件序列不连续')

    const polluted = replayAgentRunEventsV1([
      event(1, 'run.created', { objectiveHash: OBJECTIVE_HASH }),
      event(2, 'contract.accepted', {}, { projectId: 999 }),
    ])
    expect(polluted.state).toBe('recovery_required')
    expect(polluted.errors[0]).toContain('scope 不匹配')

    const premature = replayAgentRunEventsV1([
      event(1, 'run.created', { objectiveHash: OBJECTIVE_HASH }),
      event(2, 'verification.accepted', { receiptHash: RECEIPT_HASH }),
    ])
    expect(premature.state).toBe('recovery_required')
    expect(premature.errors[0]).toContain('不能从 planned 状态执行')
    expect(isAgentRunCompletedV1(premature)).toBe(false)
  })

  it('同一合法事件序列得到相同 projection hash', async () => {
    const events = successfulStepEvents()
    const first = replayAgentRunEventsV1(events)
    const second = replayAgentRunEventsV1(structuredClone(events))

    expect(await hashAgentRunProjectionV1(first)).toBe(await hashAgentRunProjectionV1(second))
  })

  it('候选必须经过作者确认后才能记录采纳', () => {
    const candidateHash = 'e'.repeat(64)
    const withoutConfirmation = replayAgentRunEventsV1([
      event(1, 'run.created', { objectiveHash: OBJECTIVE_HASH }),
      event(2, 'step.scheduled', { stepId: 'outline.generate' }),
      event(3, 'step.started', { stepId: 'outline.generate', attempt: 1 }),
      event(4, 'candidate.persisted', {
        stepId: 'outline.generate',
        attempt: 1,
        candidateHash,
        requiresConfirmation: false,
      }),
      event(5, 'adoption.committed', {
        stepId: 'outline.generate',
        candidateHash,
        adoptionHash: 'f'.repeat(64),
      }),
    ])

    expect(withoutConfirmation.state).toBe('recovery_required')
    expect(withoutConfirmation.errors[0]).toContain('未记录作者采纳确认')
  })

  it('多任务 run 可在已持久候选等待确认时继续其它已调度步骤', () => {
    const firstCandidate = 'e'.repeat(64)
    const secondCandidate = 'f'.repeat(64)
    const afterFirst = [
      event(1, 'run.created', { objectiveHash: OBJECTIVE_HASH }),
      event(2, 'contract.accepted', {}),
      event(3, 'step.scheduled', { stepId: 'world-1' }),
      event(4, 'step.scheduled', { stepId: 'character-1' }),
      event(5, 'step.started', { stepId: 'world-1', attempt: 1 }),
      event(6, 'candidate.persisted', {
        stepId: 'world-1',
        attempt: 1,
        candidateHash: firstCandidate,
        requiresConfirmation: true,
      }),
    ]
    const firstProjection = replayAgentRunEventsV1(afterFirst)
    expect(firstProjection.state).toBe('running')
    expect(firstProjection.steps['world-1'].status).toBe('awaiting_confirmation')
    expect(firstProjection.steps['character-1'].status).toBe('scheduled')

    const allCandidates = replayAgentRunEventsV1([
      ...afterFirst,
      event(7, 'step.started', { stepId: 'character-1', attempt: 1 }),
      event(8, 'candidate.persisted', {
        stepId: 'character-1',
        attempt: 1,
        candidateHash: secondCandidate,
        requiresConfirmation: true,
      }),
    ])
    expect(allCandidates.state).toBe('awaiting_confirmation')
    expect(Object.values(allCandidates.steps).every(step => step.status === 'awaiting_confirmation')).toBe(true)
  })
})
