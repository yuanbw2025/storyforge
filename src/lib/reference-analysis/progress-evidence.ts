import type { WorkspaceScope } from '../types'
import type { AgentRunSnapshotV1 } from '../agent/run/event-store'
import { readAgentRunArtifactExactV1, recordAgentRunArtifactV1 } from '../memory/artifact-store'
import type { ReferenceCompletedAnswerV1, ReferenceGlobalProgressV1 } from './adaptive-requests'

interface StoredAnswerV1 {
  start: number
  end: number
  sourceLength: number
  responseHash: string
  requestTokens?: number
}
export interface StoredReferenceProgressV1 {
  version: 1
  completed: StoredAnswerV1[]
  global?: { sourceHash: string; completed: StoredAnswerV1[] }
}
const storedAnswers = (answers: ReferenceCompletedAnswerV1[]): StoredAnswerV1[] => answers.map(answer => {
  if (!answer.artifactHash || !/^[a-f0-9]{64}$/.test(answer.artifactHash)) throw new Error('分批进度缺少原回答证据。')
  return { start: answer.selection.start, end: answer.selection.end, sourceLength: answer.selection.sourceLength,
    responseHash: answer.artifactHash, ...(answer.requestTokens == null ? {} : { requestTokens: answer.requestTokens }) }
})

/** Checkpoints carry references, never another copy of the manuscript or raw answers. */
export async function storeReferenceProgressV1(input: {
  scope: WorkspaceScope; snapshot: AgentRunSnapshotV1; stepId: string
  completed: ReferenceCompletedAnswerV1[]; globalProgress?: ReferenceGlobalProgressV1
}): Promise<{ snapshot: AgentRunSnapshotV1; state: StoredReferenceProgressV1 }> {
  let snapshot = input.snapshot
  const state: StoredReferenceProgressV1 = { version: 1, completed: storedAnswers(input.completed) }
  if (input.globalProgress) {
    const saved = await recordAgentRunArtifactV1({ scope: input.scope, runId: snapshot.run.id,
      stepId: input.stepId, attempt: 1, artifactKind: 'source-snapshot', expectedLastSequence: snapshot.projection.lastSequence,
      content: JSON.stringify({ version: 'reference-working-source-v1', content: input.globalProgress.source }) })
    snapshot = saved.snapshot
    state.global = { sourceHash: saved.artifact.contentHash, completed: storedAnswers(input.globalProgress.completed) }
  }
  return { snapshot, state }
}

export async function restoreReferenceProgressV1(input: {
  scope: WorkspaceScope; snapshot: AgentRunSnapshotV1; state: StoredReferenceProgressV1; source: string; rootSourceHash: string
}): Promise<{ completed: ReferenceCompletedAnswerV1[]; globalProgress?: ReferenceGlobalProgressV1 }> {
  const owned = (kind: 'raw-response' | 'source-snapshot' | 'rendered-request', hash: string) => {
    if (!/^[a-f0-9]{64}$/.test(hash) || !input.snapshot.events.some(event => event.type === 'evidence.artifact.recorded'
      && event.payload.artifactKind === kind && event.payload.contentHash === hash)) throw new Error('恢复证据不属于当前运行。')
  }
  const restore = async (answers: StoredAnswerV1[], source: string, phase: 'source' | 'review') => {
    if (!Array.isArray(answers)) throw new Error('恢复进度格式无效。')
    const result: ReferenceCompletedAnswerV1[] = []
    let offset = 0
    for (const answer of answers) {
      if (answer.start !== offset || answer.sourceLength !== source.length || !Number.isSafeInteger(answer.end)
        || answer.end <= offset || answer.end > source.length) throw new Error('恢复范围不连续或来源已变化。')
      owned('raw-response', answer.responseHash)
      const raw = JSON.parse(await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'raw-response', contentHash: answer.responseHash }))
      owned('rendered-request', raw.requestArtifactHash)
      const request = JSON.parse(await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'rendered-request', contentHash: raw.requestArtifactHash }))
      const selected = request.referenceSelection
      if (raw.version !== 'creation-model-response-v1' || typeof raw.raw !== 'string'
        || !selected || selected.rootSourceHash !== input.rootSourceHash || selected.phase !== phase
        || selected.start !== answer.start || selected.end !== answer.end || selected.sourceLength !== answer.sourceLength
        || ['length', 'max_tokens', 'MAX_TOKENS', 'content_filter'].includes(raw.observation?.finishReason)) throw new Error('原回答不能证明已完成此恢复范围。')
      result.push({ raw: raw.raw, finishReason: raw.observation?.finishReason ?? undefined,
        artifactHash: answer.responseHash, requestTokens: answer.requestTokens,
        selection: { start: answer.start, end: answer.end, sourceLength: source.length, part: source.slice(answer.start, answer.end) } })
      offset = answer.end
    }
    return result
  }
  if (input.state?.version !== 1) throw new Error('恢复进度版本不受支持。')
  const completed = await restore(input.state.completed, input.source, 'source')
  if (!input.state.global) return { completed }
  owned('source-snapshot', input.state.global.sourceHash)
  const working = JSON.parse(await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'source-snapshot', contentHash: input.state.global.sourceHash }))
  if (working.version !== 'reference-working-source-v1' || typeof working.content !== 'string') throw new Error('派生资料证据无效。')
  return { completed, globalProgress: { source: working.content, completed: await restore(input.state.global.completed, working.content, 'review') } }
}
