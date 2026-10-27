import { useCallback, useEffect, useRef, useState } from 'react'
import { useAIConfigStore } from '../../stores/ai-config'
import { readTtrpgOpenBriefDeskV1, requestTtrpgOpenBriefDeskV1, resumeTtrpgOpenBriefDeskV1, recoverTtrpgOpenBriefDeskCandidateV1,
  confirmTtrpgOpenBriefDeskV1, repairTtrpgOpenBriefDeskReceiptV1, rejectTtrpgOpenBriefDeskV1, cancelTtrpgOpenBriefDeskPreparedV1,
  finishTtrpgOpenBriefDeskV1, type TtrpgOpenBriefDeskInputV1 } from '../../lib/ttrpg/open-brief-service'
import type { TtrpgOpenBriefAttributionV1 } from '../../lib/ttrpg/open-brief-contract'

type Desk = Awaited<ReturnType<typeof readTtrpgOpenBriefDeskV1>>
const labels = { 'release-time': '发行时资料', confirmed: '已确认记录', observed: '亲历或已见记录', hearsay: '转述', belief: '个人推测', narrated: '主持叙述' }
function sourceLabel(source: TtrpgOpenBriefAttributionV1, actors: Array<{ key: string; name: string }>) {
  const observer = source.kind === 'known-identity' ? '全队共同身份' : source.observerKey === null ? '本桌资料' : source.observerKey === 'gm' ? '主持' : actors.find(actor => actor.key === source.observerKey)?.name ?? '原观察者'
  return `${observer} · ${labels[source.reliability]}${source.origin === 'model-reviewed' ? ' · AI复盘经确认' : ''}`
}

/** Identity-keyed human desk. Rendering and refresh never request a model. */
export default function TtrpgOpenBriefPanel(props: { input: TtrpgOpenBriefDeskInputV1; sequence: number; busy: boolean; perform: (job: (signal?: AbortSignal) => Promise<void>) => Promise<void> }) {
  const config = useAIConfigStore(state => state.config)
  const [page, setPage] = useState<Desk>(null), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState('请回顾当前阶段的重要经历、变化和仍未确认的推测。'), [cost, setCost] = useState('0.10'), [sending, setSending] = useState(false)
  const live = useRef(true), revision = useRef(0), controller = useRef<AbortController | null>(null)
  const { sessionId, viewerKey, scope: { projectId, worldId, workId } } = props.input
  const input = useCallback(() => ({ scope: { projectId, worldId, workId }, sessionId, viewerKey }), [projectId, worldId, workId, sessionId, viewerKey])
  const load = useCallback(async () => {
    const current = ++revision.current
    try { const next = await readTtrpgOpenBriefDeskV1(input()); if (live.current && current === revision.current) { setPage(next); setError('') } }
    catch (cause) { if (live.current && current === revision.current) { setPage(null); setError(cause instanceof Error ? cause.message : String(cause)) } }
  }, [input])
  useEffect(() => { live.current = true; setPage(null); void load(); return () => { live.current = false; revision.current += 1; controller.current?.abort() } }, [load, props.sequence])
  const act = (job: (signal?: AbortSignal) => Promise<unknown>, success: string) => props.perform(async signal => {
    setError(''); setNotice('')
    try { await job(signal); if (live.current) setNotice(success) }
    catch (cause) { if (live.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (live.current) await load() }
  })
  const send = (resume: boolean) => act(async parentSignal => {
    const abort = new AbortController(); controller.current = abort; setSending(true)
    const forward = () => abort.abort(parentSignal?.reason)
    if (parentSignal?.aborted) forward()
    else parentSignal?.addEventListener('abort', forward, { once: true })
    try {
      if (resume) await resumeTtrpgOpenBriefDeskV1({ ...input(), aiConfig: config, signal: abort.signal })
      else await requestTtrpgOpenBriefDeskV1({ ...input(), submissionKey: crypto.randomUUID(), rawInput: draft, maximumCostUsd: Number(cost), aiConfig: config, signal: abort.signal })
    } finally { parentSignal?.removeEventListener('abort', forward); controller.current = null; if (live.current) setSending(false) }
  }, '复盘回复已保留，请查看依据后决定是否保存。')
  if (!page && !error) return null
  const candidate = page?.candidate
  return <details className="sf-open-table-card" data-testid="ttrpg-open-brief" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}><summary>阶段复盘</summary>
    <p>由真人主持主动请求，只回顾全队共同资料。确认后才保存为本局记忆，保留传闻、推测和原观察者。</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <button disabled={props.busy} onClick={() => void load()}>读取复盘进度</button>
    {page?.canRequest && <fieldset disabled={props.busy}><legend>请求本阶段复盘</legend>
      <label>复盘要求<textarea aria-label="复盘要求" value={draft} maxLength={10000} onChange={event => setDraft(event.target.value)} /></label>
      <label>本次调用预留上限（美元）<input aria-label="复盘调用预留上限" type="number" min="0" max="1000" step="0.01" value={cost} onChange={event => setCost(event.target.value)} /></label>
      <button disabled={!draft.trim() || !cost.trim()} onClick={() => void send(false)}>请求 AI 阶段复盘</button>
    </fieldset>}
    {page && !page.canRequest && <p>{page.unavailable}</p>}
    {sending && <button onClick={() => controller.current?.abort()}>停止本次复盘请求</button>}
    {page?.request?.status === 'prepared' && <aside><p>原复盘请求已保存，尚未发送。</p>
      {page.request.local && <button disabled={props.busy} onClick={() => void send(true)}>继续原复盘请求</button>}
      <button disabled={props.busy} onClick={() => void act(() => cancelTtrpgOpenBriefDeskPreparedV1(input()), '原复盘请求已取消，调用记录保留。')}>取消未发送的复盘</button>
    </aside>}
    {page?.request?.status === 'dispatched' && <p role="status">原请求已发出，正在等待结果。请保留此记录，勿重复请求。</p>}
    {page?.request?.status === 'unknown' && <p role="status">原请求的结果和费用待核对。系统不会再次发送；可明确结束本次复盘，保留原记录。</p>}
    {page?.request?.status === 'failed' && <p>本次复盘未完成，原记录已保留。结束本次复盘后，才能主动发起新的请求。</p>}
    {page?.request?.status === 'succeeded' && !candidate && page.request.local && <button disabled={props.busy} onClick={() => void act(() => recoverTtrpgOpenBriefDeskCandidateV1(input()), '已恢复原复盘回复，未再次请求模型。')}>恢复已保存的复盘回复</button>}
    {page?.request && !page.request.local && <p>这是导入的历史请求，只供查阅。历史回答可从原回复记录打开。</p>}
    {candidate && <section aria-label="待审阅的阶段复盘"><h3>{page?.saved ? '已保存的阶段复盘' : '复盘候选'}</h3>
      {candidate.brief?.paragraphs.map((paragraph, index) => <article key={index}>
        <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{paragraph.text}</p>
        <details><summary>查看这一段的依据</summary><ul>{paragraph.sourceKeys.map(key => {
          const source = candidate.attributions.find(source => source.citationKey === key)
          return source && <li key={key}>{sourceLabel(source, page!.actors)}{source.originalSources && <ul>{source.originalSources.map(original => <li key={`${original.resourceKey}:${original.contentHash}`}>{sourceLabel(original, page!.actors)}</li>)}</ul>}</li>
        })}</ul></details>
      </article>)}
      {candidate.artifact.issues.filter(issue => issue.disposition === 'blocking' || issue.suggestedAction !== 'none').map(issue => <p key={`${issue.code}:${issue.path}`}>{issue.message}</p>)}
      {!candidate.brief && <p>本次回复的格式或引用需要修订，不能直接保存。</p>}
      <details><summary>查看原始回复</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{candidate.artifact.originalText}</pre></details>
      {page?.canConfirm && <button disabled={props.busy} onClick={() => void act(() => confirmTtrpgOpenBriefDeskV1({ ...input(), candidateHash: candidate.candidateHash }), '复盘已作为 AI 生成、主持确认的本局记忆保存。')}>确认保存这份复盘记忆</button>}
      {!page?.saved && !page?.rejected && <button disabled={props.busy} onClick={() => void act(() => rejectTtrpgOpenBriefDeskV1({ ...input(), candidateHash: candidate.candidateHash }), '已放弃本次复盘，原回复保留。')}>放弃这份复盘</button>}
      {page?.rejected && <p>这份复盘已放弃，不能保存为记忆。</p>}
    </section>}
    {page?.receiptPending && candidate && <button disabled={props.busy} onClick={() => void act(() => repairTtrpgOpenBriefDeskReceiptV1({ ...input(), candidateHash: candidate.candidateHash }), '已补齐原记忆的保存回执，未重复保存。')}>补齐复盘保存回执</button>}
    {page?.saved && <p role="status">本份复盘已保存为本局记忆，来源标记保留。</p>}
    {page?.currentWindow && <button disabled={props.busy || ['prepared', 'dispatched'].includes(page.request?.status ?? '')} onClick={() => void act(() => finishTtrpgOpenBriefDeskV1(input()), '本次复盘已结束，冒险进度保留。')}>结束本次复盘</button>}
  </details>
}
