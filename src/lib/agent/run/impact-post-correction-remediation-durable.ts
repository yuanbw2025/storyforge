import type { WorkspaceScope } from '../../types'
import {
  executeImpactRemediationV1,
} from './impact-remediation-durable'
import {
  readCurrentImpactPostCorrectionReplanV1,
  type ImpactPostCorrectionReplanResultV1,
} from './impact-post-correction-replan-durable'
import { readAgentRunChildV1 } from './event-store'
import { hashCanonicalValue } from './hash'

/**
 * HARNESS-58: execute the deterministic remainder of a fresh H57 plan.
 *
 * The caller cannot manufacture lineage from a historical UI object: this
 * adapter re-reads the current post-correction plan and binds H47 to that exact
 * terminal receipt and output checkpoint.
 */
export async function executeImpactPostCorrectionRemediationV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  sourceChapterId: number
  expectedReplan: ImpactPostCorrectionReplanResultV1
  onDurableBoundary?: Parameters<typeof executeImpactRemediationV1>[0]['onDurableBoundary']
}) {
  const { outputHash, ...outputBody } = input.expectedReplan.output
  if (await hashCanonicalValue(outputBody) !== outputHash) {
    throw new Error('人工修正后的重规划输出已损坏。')
  }
  const relation = `impact-remediation-after-replan:${input.expectedReplan.output.outputHash}`
  const child = await readAgentRunChildV1({
    scope: input.scope,
    parentRunId: input.expectedReplan.snapshot.run.id,
    relation,
  })
  const current = child
    ? input.expectedReplan
    : await readCurrentImpactPostCorrectionReplanV1({
        scope: input.scope,
        chapterId: input.sourceChapterId,
      })
  if (
    !current
    || current.snapshot.run.id !== input.expectedReplan.snapshot.run.id
    || current.receiptHash !== input.expectedReplan.receiptHash
    || current.output.outputHash !== input.expectedReplan.output.outputHash
  ) {
    throw new Error('人工修正后的重规划已过期，请先恢复或重新生成当前计划。')
  }
  return executeImpactRemediationV1({
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    plan: current.output.plan,
    parent: {
      runId: current.snapshot.run.id,
      receiptHash: current.receiptHash,
      relation,
      artifactHash: current.output.outputHash,
    },
    onDurableBoundary: input.onDurableBoundary,
  })
}

/**
 * Read the exact completed H58 child for a fresh H57 result without creating
 * or resuming work. The existing executor remains the single verifier for its
 * terminal checkpoint and frozen plan lineage.
 */
export async function readCompletedImpactPostCorrectionRemediationV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  sourceChapterId: number
  expectedReplan: ImpactPostCorrectionReplanResultV1
}): Promise<Awaited<ReturnType<typeof executeImpactPostCorrectionRemediationV1>> | null> {
  const relation = `impact-remediation-after-replan:${input.expectedReplan.output.outputHash}`
  const child = await readAgentRunChildV1({
    scope: input.scope,
    parentRunId: input.expectedReplan.snapshot.run.id,
    relation,
  })
  if (child?.projection.state !== 'completed' || !child.projection.terminalReceiptHash) return null
  return executeImpactPostCorrectionRemediationV1(input)
}
