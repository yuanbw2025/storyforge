import type { WorkspaceScope } from '../../types'
import type { AgentRunRecord } from '../../types/agent-run'
import { readOwnedRows } from '../../world-engine/scope'
import type { ImpactPostCorrectionReplanResultV1 } from './impact-post-correction-replan-durable'

export const IMPACT_GENERATIVE_SLOT_RELATION_PREFIX_V1 = 'impact-generative-target:' as const

const IMPACT_GENERATIVE_STEP_MARKERS_V1 = [
  'impact-remediation:outline-regenerate',
  'impact-remediation:story-timeline-regenerate',
] as const

const ACTIVE_GENERATIVE_STATES = new Set<AgentRunRecord['status']>([
  'planned',
  'running',
  'awaiting_confirmation',
  'verifying',
  'recovering',
])

export function isActiveImpactGenerativeRunV1(row: AgentRunRecord): boolean {
  return ACTIVE_GENERATIVE_STATES.has(row.status)
}

export function isImpactGenerativeRunRecordV1(row: AgentRunRecord): boolean {
  return row.parentRunId != null
    && IMPACT_GENERATIVE_STEP_MARKERS_V1.some(marker => row.contractJson?.includes(marker))
}

export async function readImpactGenerativeSiblingRunsV1(input: {
  scope: WorkspaceScope
  parentRunId: number
}): Promise<AgentRunRecord[]> {
  return (await readOwnedRows<AgentRunRecord>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => row.parentRunId === input.parentRunId && isImpactGenerativeRunRecordV1(row))
    .sort((left, right) => (left.id ?? 0) - (right.id ?? 0))
}

export async function assertImpactGenerativeSlotAvailableV1(input: {
  scope: WorkspaceScope
  parentRunId: number
}): Promise<AgentRunRecord[]> {
  const siblings = await readImpactGenerativeSiblingRunsV1(input)
  const active = siblings.filter(isActiveImpactGenerativeRunV1)
  if (active.length > 0) {
    throw new Error(`H57 当前已有待处理的生成式 child #${active[0].id ?? '?'}，请先确认、放弃或完成恢复。`)
  }
  return siblings
}

export async function nextImpactGenerativeSlotRelationV1(input: {
  scope: WorkspaceScope
  replan: ImpactPostCorrectionReplanResultV1
}): Promise<string> {
  const siblings = await assertImpactGenerativeSlotAvailableV1({
    scope: input.scope,
    parentRunId: input.replan.snapshot.run.id,
  })
  return `${IMPACT_GENERATIVE_SLOT_RELATION_PREFIX_V1}${input.replan.output.outputHash}:${siblings.length + 1}`
}
