/** E14 is an instance Harness diagnostic, retained with the actual input; it never advances the game. */
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { readInstanceAgentRunV1 } from '../agent/run/event-store'
import { recordAgentRunArtifactV1, readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import type { TtrpgOpenInputEvidenceV1 } from './open-input-evidence'
import type { WorkspaceScope } from '../types'

export async function recordTtrpgContextAssemblyV1(input: {
  scope: WorkspaceScope; productRuntimeSessionId: number; runId: number; stepId: string; attempt: number
  evidence: TtrpgOpenInputEvidenceV1; expectedLastSequence: number
}) {
  const { evidence } = input, receipt = evidence.contextSelection, assembly = evidence.contextAssembly
  const snapshot = await readInstanceAgentRunV1(input.scope, input.runId)
  if (!receipt || !assembly || snapshot.run.productRuntimeSessionId !== input.productRuntimeSessionId
    || evidence.preflight.runId !== input.runId || evidence.preflight.stepId !== input.stepId || evidence.preflight.attempt !== input.attempt
    || canonicalStringify(assembly) !== canonicalStringify({ schema: 'storyforge.ttrpg-context-assembly', version: 1, eventType: 'ttrpg.context.assembled', receiptHash: receipt.receiptHash })) throw new Error('[ttrpg-context] E14 必须属于原实例与实际请求')
  const { receiptHash, ...body } = receipt
  const rendered = JSON.parse(await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'rendered-request', contentHash: evidence.preflight.promptHash })) as { contextSelection?: unknown }
  if (await hashCanonicalValue(body) !== receiptHash || canonicalStringify(rendered.contextSelection) !== canonicalStringify(receipt)
    || !snapshot.events.some(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'rendered-request'
      && event.payload.contentHash === evidence.preflight.promptHash && event.payload.stepId === input.stepId && event.payload.attempt === input.attempt)) throw new Error('[ttrpg-context] E14 不接受任意调用方注入的预算回执')
  return recordAgentRunArtifactV1({ ...input, artifactKind: 'source-snapshot', content: canonicalStringify(evidence) })
}
