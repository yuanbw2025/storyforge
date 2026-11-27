import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AgentEvent, WorkspaceScope } from '../../lib/types'
import { readCandidateLocalSaveWitnessV1, type CandidateLocalDraftStateV1, type CandidateLocalSaveWitnessV1 } from '../../lib/authoring/candidate-local-save-evidence'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'

/** Observes the original candidate queue and DB. It never writes a candidate. */
export default function CandidateSaveFeedback({ event, scope, draftState, busy, onRetry, children }: {
  event: AgentEvent
  scope?: WorkspaceScope
  draftState?: CandidateLocalDraftStateV1
  busy: boolean
  onRetry: () => Promise<void>
  children: ReactNode
}) {
  const revision = draftState?.revision ?? 0, state = draftState?.status ?? 'idle'
  const scopeKey = scope ? `${scope.projectId}:${scope.worldId}:${scope.workId}` : ''
  const identity = `${scopeKey}:${event.conversationId}:${event.id}`
  const [confirmed, setConfirmed] = useState<{ event: AgentEvent; identity: string; witness: CandidateLocalSaveWitnessV1 } | null>(null)
  const [requested, setRequested] = useState({ identity, revision: 0 })
  const [composing, setComposing] = useState(false)
  const [retrying, setRetrying] = useState(false), [retryError, setRetryError] = useState(''), [readVersion, setReadVersion] = useState(0)
  const current = useRef(identity); current.current = identity
  const unsubmitted = requested.identity === identity && requested.revision > revision
  const projectId = scope?.projectId, worldId = scope?.worldId, workId = scope?.workId
  useEffect(() => { setRequested({ identity, revision: 0 }); setComposing(false); setRetrying(false); setRetryError('') }, [identity])
  useEffect(() => {
    let active = true
    setConfirmed(null)
    if (projectId != null && worldId != null && workId != null && state === 'idle' && !unsubmitted && !composing && !retrying) {
      void readCandidateLocalSaveWitnessV1({ projectId, worldId, workId }, event).then(witness => {
        if (active && witness) setConfirmed({ event, identity, witness })
      }).catch(() => { /* Missing or stale durable proof grants no success label. */ })
    }
    return () => { active = false }
  }, [projectId, worldId, workId, state, revision, unsubmitted, composing, retrying, event, identity, readVersion])
  const status = retrying ? 'saving' : state === 'failed' || retryError ? 'failed'
    : state === 'blocked' || unsubmitted || composing ? 'dirty'
      : state === 'saving' || state === 'discarding' ? 'saving'
        : confirmed?.event === event && confirmed.identity === identity ? 'saved' : 'unconfirmed'
  const retry = async () => {
    const owner = identity
    setRetryError(''); setRetrying(true)
    try { await flushPendingEditsV1(); await onRetry() }
    catch (cause) { if (current.current === owner) setRetryError(cause instanceof Error ? cause.message : '候选尚未保存，输入已保留。') }
    finally { if (current.current === owner) { setRetrying(false); setReadVersion(value => value + 1) } }
  }
  return <div onInputCapture={() => { setRetryError(''); setRequested({ identity, revision: revision + 1 }) }}
    onCompositionStartCapture={() => setComposing(true)} onCompositionEndCapture={() => setComposing(false)}>
    {children}
    <p role="status" data-candidate-local-save-status={status} className="mt-1 min-h-4 text-[10px] text-text-muted"
      title="候选已保存表示当前候选及其运行记录已在本机数据库中核对；尚未采纳写入正式稿。本机保存、云同步和外部备份分别完成。">
      {status === 'saved' ? '候选已保存到本机 · 尚未采纳' : status === 'saving' ? '正在保存候选…'
        : status === 'failed' ? '候选保存失败 · 输入已保留' : status === 'dirty' ? '候选未保存 · 尚未采纳' : '候选保存未确认 · 尚未采纳'}
      {(status === 'failed' || status === 'unconfirmed') && <button type="button" disabled={busy || composing} className="ml-2 underline disabled:opacity-50"
        onClick={() => { void retry() }}>重试保存候选</button>}
    </p>
    {retryError && <p role="alert" className="text-xs text-error">{retryError}</p>}
  </div>
}
