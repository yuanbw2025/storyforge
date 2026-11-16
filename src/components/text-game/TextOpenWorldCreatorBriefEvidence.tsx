import { useEffect, useRef, useState } from 'react'
import { listTextOpenWorldCreatorBriefRunsV1, type TextOpenWorldCreatorBriefSessionV1 } from '../../lib/open-world/creator-brief'
import { readAgentRunV1 } from '../../lib/agent/run/event-store'
import { readLatestVerifiedAgentRunCheckpointV1 } from '../../lib/agent/run/checkpoint'
import { readAgentRunArtifactExactV1 } from '../../lib/memory/artifact-store'

/** Existing Run/checkpoint/exact-artifact readers only. Opening an archived
 * consultation must never become a new request or a reconstructed adoption. */
export default function TextOpenWorldCreatorBriefEvidence({ session }: { session: TextOpenWorldCreatorBriefSessionV1 }) {
  const [runs, setRuns] = useState<Awaited<ReturnType<typeof listTextOpenWorldCreatorBriefRunsV1>>>([])
  const [evidence, setEvidence] = useState('')
  const [error, setError] = useState('')
  const generation = useRef(0)
  useEffect(() => {
    const current = ++generation.current
    setRuns([]); setEvidence(''); setError('')
    void listTextOpenWorldCreatorBriefRunsV1(session).then(rows => {
      if (current === generation.current) setRuns(rows.sort((a, b) => b.createdAt - a.createdAt))
    }).catch(cause => {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { generation.current += 1 }
  }, [session])

  const inspect = async (runId: number) => {
    const current = ++generation.current
    setEvidence(''); setError('')
    try {
      const snapshot = await readAgentRunV1(session.scope, runId)
      if (snapshot.run.conversationId !== session.conversation.id) throw new Error('调用证据不属于此原会谈。')
      const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(session.scope, runId)
        .then(value => ({ state: 'verified', resumePayload: value?.resumePayload ?? null }))
        .catch(cause => ({ state: 'invalid', diagnostic: cause instanceof Error ? cause.message : String(cause) }))
      const exact = await Promise.all(snapshot.events.flatMap(event => {
        if (event.type !== 'evidence.artifact.recorded' || event.payload.artifactKind !== 'raw-response') return []
        const proof = event.payload
        return [readAgentRunArtifactExactV1({ projectId: session.scope.projectId,
          artifactKind: proof.artifactKind, contentHash: proof.contentHash })
          .then(content => ({ contentHash: proof.contentHash, content }))
          .catch(cause => ({ contentHash: proof.contentHash, diagnostic: cause instanceof Error ? cause.message : String(cause) }))]
      }))
      if (current === generation.current) setEvidence(JSON.stringify({ snapshot, checkpoint, exactResponses: exact }, null, 2))
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return <section className="space-y-3 rounded-xl border border-border bg-bg-elevated p-5" data-testid="text-open-world-legacy-novel-brief-readonly">
    <h2 className="text-base font-semibold">历史小说会谈 · 只读记录</h2>
    <p className="text-xs leading-6">原草稿、候选、调用状态、已记录用量和原文证据保留。没有保存的原文无法从 Hash 还原；查看不会重新调用模型、确认 Brief 或继续旧制作。请返回来源选择，先派生世界草稿并检查封存。</p>
    <details><summary className="cursor-pointer text-xs">原会谈草稿与候选</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify({ draft: session.draft, candidate: session.candidate }, null, 2)}</pre></details>
    {runs.map(run => <button key={run.id} type="button" onClick={() => void inspect(run.id!)} className="mr-2 rounded border border-border px-3 py-2 text-xs">查看原调用 #{run.id} · {run.status}</button>)}
    {evidence && <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs" aria-label="原会谈调用证据">{evidence}</pre>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </section>
}
