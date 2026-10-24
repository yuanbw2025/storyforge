import {z} from 'zod'
import type {AgentRunSnapshotV1} from '../agent/run/event-store'
import {hashCanonicalValue} from '../agent/run/hash'
import {parseVerificationReceiptV1, verifyVerificationReceiptIntegrityV1} from '../agent/run/verification-receipt'
import {readAgentRunArtifactExactV1, recordAgentRunArtifactV1} from '../memory/artifact-store'
import type {VerificationReceiptV1, WorkspaceScope} from '../types'

/** Frozen verifier identity opts new choice runs into full receipt retention.
 * Existing completed runs keep their original verifier and evidence boundary. */
export const CHAT_ACTION_TERMINAL_VERIFIER_V2 = 'character-chat-action-terminal-v2'
const envelope = z.object({schema: z.literal('storyforge.chat-action-terminal-receipt'), version: z.literal(1), receipt: z.unknown()}).strict()
const enabled = (snapshot: AgentRunSnapshotV1) => snapshot.contract.verificationPlan.some(plan => plan.id === 'runtime.terminal' && plan.verifier === CHAT_ACTION_TERMINAL_VERIFIER_V2)
function fail(message: string): never {throw new Error(`[chat-terminal-receipt] ${message}`)}

export async function readChatActionTerminalReceiptV1(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1): Promise<VerificationReceiptV1 | null> {
  if (!enabled(snapshot)) return null
  const found = []
  for (const event of snapshot.events) {
    if (event.type !== 'evidence.artifact.recorded' || event.payload.artifactKind !== 'tool-result' || event.payload.stepId != null) continue
    const value = JSON.parse(await readAgentRunArtifactExactV1({projectId: scope.projectId, artifactKind: 'tool-result', contentHash: event.payload.contentHash}))
    if (value?.schema !== 'storyforge.chat-action-terminal-receipt') continue
    const parsed = envelope.safeParse(value)
    if (!parsed.success) fail('终验回执正文格式无效')
    const receipt = parseVerificationReceiptV1(parsed.data.receipt)
    const started = snapshot.events.find(item => item.type === 'verification.started')
    const accepted = snapshot.events.find(item => item.type === 'verification.accepted')
    if (!await verifyVerificationReceiptIntegrityV1(receipt) || receipt.runId !== snapshot.run.id
      || receipt.contractHash !== snapshot.run.contractHash || receipt.generation !== snapshot.projection.generation
      || receipt.verifierSetVersion !== CHAT_ACTION_TERMINAL_VERIFIER_V2 || !started || event.sequence <= started.sequence
      || (accepted && (event.sequence >= accepted.sequence || accepted.payload.receiptHash !== receipt.receiptHash))) fail('终验回执与原运行不一致')
    found.push(receipt)
  }
  if (found.length > 1) fail('终验回执正文不唯一')
  if (snapshot.projection.state === 'completed' && (!found.length || found[0].receiptHash !== snapshot.projection.terminalReceiptHash)) fail('已完成运行缺少原终验回执正文')
  return found[0] ?? null
}

/** A crash after saving the body reuses its exact timestamp/hash; it cannot
 * sign a different post-state or silently recreate pruned evidence. */
export async function retainChatActionTerminalReceiptV1(input: {
  scope: WorkspaceScope; snapshot: AgentRunSnapshotV1; receipt: VerificationReceiptV1
}): Promise<{snapshot: AgentRunSnapshotV1; receipt: VerificationReceiptV1}> {
  if (!enabled(input.snapshot)) return input
  const existing = await readChatActionTerminalReceiptV1(input.scope, input.snapshot)
  if (existing) {
    const body = ({acceptedAt: _time, receiptHash: _hash, ...rest}: VerificationReceiptV1) => rest
    if (await hashCanonicalValue(body(existing)) !== await hashCanonicalValue(body(input.receipt))) fail('原终验回执与当前采用证据不同，不能重新签发')
    return {snapshot: input.snapshot, receipt: existing}
  }
  const {snapshot} = await recordAgentRunArtifactV1({scope: input.scope, runId: input.snapshot.run.id,
    productRuntimeSessionId: input.snapshot.run.productRuntimeSessionId!, artifactKind: 'tool-result',
    content: JSON.stringify({schema: 'storyforge.chat-action-terminal-receipt', version: 1, receipt: input.receipt}),
    expectedLastSequence: input.snapshot.projection.lastSequence})
  const receipt = await readChatActionTerminalReceiptV1(input.scope, snapshot)
  if (!receipt) fail('终验回执正文未持久化')
  return {snapshot, receipt}
}
