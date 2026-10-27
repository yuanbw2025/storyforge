import { useCallback, useEffect, useRef, useState } from 'react'
import { readTtrpgOpenNarrativeMemoriesV1, recordTtrpgOpenDeskMemoryV1 } from '../../lib/ttrpg/open-memory-service'
import type { TtrpgOpenTableInputV1 } from '../../lib/ttrpg/open-table-service'
import type { TtrpgOpenMemoryDraftV1 } from '../../lib/ttrpg/open-memory-contract'

type MemoryPage = Awaited<ReturnType<typeof readTtrpgOpenNarrativeMemoriesV1>>
type Submission = Parameters<typeof recordTtrpgOpenDeskMemoryV1>[0]
const reliabilityLabels = { observed: '亲历记录', hearsay: '听来的消息', belief: '个人推测' }
const audienceLabels = { public: '公开', party: '本次全队', private: '指定角色', 'gm-only': '仅主持' }

/** Parent keys this panel by the confirmed human identity; no model context is assembled here. */
export default function TtrpgOpenMemoryPanel(props: {
  input: TtrpgOpenTableInputV1; sequence: number; busy: boolean; perform: (job: () => Promise<void>) => Promise<void>
}) {
  const [page, setPage] = useState<MemoryPage | null>(null), [error, setError] = useState(''), [saved, setSaved] = useState(false)
  const [summary, setSummary] = useState(''), [observer, setObserver] = useState<'self' | 'gm' | 'table'>('self')
  const [reliability, setReliability] = useState<TtrpgOpenMemoryDraftV1['reliability']>('observed')
  const [audience, setAudience] = useState<TtrpgOpenMemoryDraftV1['audience']>('private'), [recipients, setRecipients] = useState<string[]>([])
  const [from, setFrom] = useState('1'), [to, setTo] = useState('1'), [attempted, setAttempted] = useState(false)
  const live = useRef(true), generation = useRef(0), initialized = useRef(false), pending = useRef<Submission | null>(null)
  const { sessionId, viewerKey, scope: { projectId, worldId, workId } } = props.input
  const load = useCallback(async () => {
    const token = ++generation.current
    setPage(null)
    try {
      const next = await readTtrpgOpenNarrativeMemoriesV1({ scope: { projectId, worldId, workId }, sessionId, viewerKey })
      if (live.current && generation.current === token) {
        setPage(next); setError('')
        if (!initialized.current) {
          initialized.current = true
          setFrom(String(Math.max(1, next.sequence - 199))); setTo(String(next.sequence))
          setObserver(next.actorKey ? 'self' : 'gm'); setAudience(next.actorKey ? 'private' : 'gm-only')
        }
      }
    } catch (cause) { if (live.current && generation.current === token) setError(cause instanceof Error ? cause.message : String(cause)) }
  }, [projectId, worldId, workId, sessionId, viewerKey])
  useEffect(() => { live.current = true; void load(); return () => { live.current = false; generation.current += 1 } }, [load, props.sequence])
  const clearAttempt = () => { pending.current = null; setAttempted(false); setSaved(false); setError('') }
  const save = () => props.perform(async () => {
    try {
      if (!pending.current) {
        if (!page) throw new Error('请先读取当前记忆和进度。')
        const first = Number(from), last = Number(to)
        if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > page.sequence || last - first >= 1000) throw new Error('请选择当前团局中连续的 1 至 1000 条事件。')
        const observerKey = observer === 'self' ? page.actorKey : observer === 'gm' ? 'gm' : null
        pending.current = { ...props.input, submissionKey: crypto.randomUUID(), baseSequence: page.sequence, baseStateHash: page.stateHash,
          draft: { observerKey, reliability, audience, knownBy: audience === 'private' && observerKey !== null ? [...new Set([observerKey, ...recipients])] : [],
            summary, fromEventSequence: first, toEventSequence: last } }
        setAttempted(true); setSaved(false)
      }
      await recordTtrpgOpenDeskMemoryV1(pending.current)
      if (live.current) { clearAttempt(); setSummary(''); setRecipients([]); setSaved(true); await load() }
    } catch (cause) { if (live.current) setError(cause instanceof Error ? cause.message : String(cause)) }
  })
  return <details className="sf-open-table-card" data-testid="ttrpg-open-memory"><summary>冒险记忆</summary>
    <p>记录亲历、传闻或推测，并选择谁能看到。记录不会改变规则结果，也不会让角色自动获得线索。</p>
    {error && <p role="alert">{error}</p>}{saved && <p role="status">记忆已保存。</p>}
    <button disabled={props.busy} onClick={() => void load()}>读取最新记忆</button>
    {page && <section aria-label="当前身份可见的冒险记忆">
      {!page.entries.length && <p>暂时没有当前身份可见的记忆。</p>}
      {page.entries.map(entry => <article key={entry.revisionKey}>
        <p><strong>{reliabilityLabels[entry.reliability]}</strong>{entry.origin === 'model-reviewed' ? ' · AI复盘，经主持确认' : ' · 手写记录'} · {audienceLabels[entry.audience]} · 世界第 {entry.recordedAtWorldTurn} 轮{entry.historical ? ' · 继承自先前分支' : ''}</p>
        <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{entry.summary}</p>
        <p>视角：{entry.observerKey === null ? '本桌记录' : entry.observerKey === 'gm' ? '主持' : page.actors.find(actor => actor.key === entry.observerKey)?.name ?? '原记录角色'}；来源：事件 {entry.fromEventSequence}–{entry.toEventSequence}</p>
        {entry.audience === 'private' && <p>可见角色：{entry.knownBy.map(key => key === 'gm' ? '主持' : page.actors.find(actor => actor.key === key)?.name ?? '原接收角色').join('、')}</p>}
      </article>)}
    </section>}
    {page && <fieldset disabled={props.busy || attempted || !page.canRecord}><legend>手写一条记忆</legend>
      <label>记录视角<select aria-label="记录视角" value={observer} onChange={event => {
        const value = event.target.value as typeof observer
        setObserver(value); setRecipients([]); setAudience(value === 'self' ? 'private' : 'gm-only'); if (value === 'table') setReliability('observed')
      }}>{page.actorKey && <option value="self">我的角色</option>}{page.humanHost && <><option value="gm">主持视角</option><option value="table">本桌共同记录</option></>}</select></label>
      <label>记录性质<select aria-label="记录性质" value={reliability} onChange={event => setReliability(event.target.value as typeof reliability)}>
        <option value="observed">亲历记录</option>{observer !== 'table' && <><option value="hearsay">听来的消息</option><option value="belief">个人推测</option></>}
      </select></label>
      <label>记忆可见范围<select aria-label="记忆可见范围" value={audience} onChange={event => setAudience(event.target.value as typeof audience)}>
        {observer !== 'table' && <option value="private">仅自己与指定角色</option>}<option value="party">本次全队</option><option value="public">公开</option>
        {page.humanHost && observer !== 'self' && <option value="gm-only">仅主持</option>}
      </select></label>
      {audience === 'private' && <fieldset><legend>另外分享给</legend><p>记录视角本人始终可以看到。</p>
        {[...page.actors, { key: 'gm', name: '主持' }].filter(actor => actor.key !== (observer === 'self' ? page.actorKey : 'gm')).map(actor => <label key={actor.key}>
          <input type="checkbox" checked={recipients.includes(actor.key)} onChange={event => setRecipients(keys => event.target.checked ? [...keys, actor.key] : keys.filter(key => key !== actor.key))} />{actor.name}
        </label>)}
      </fieldset>}
      <label>回顾起点（本团事件编号）<input aria-label="记忆来源起点" type="number" min="1" max={page.sequence} value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label>回顾终点（本团事件编号）<input aria-label="记忆来源终点" type="number" min="1" max={page.sequence} value={to} onChange={event => setTo(event.target.value)} /></label>
      <label>记忆内容<textarea aria-label="记忆内容" maxLength={20000} value={summary} onChange={event => setSummary(event.target.value)} /></label>
    </fieldset>}
    {page && !page.canRecord && <p>当前冒险已暂停或尚未同意记录，暂时不能保存新记忆。</p>}
    {(page || attempted) && <button disabled={props.busy || !attempted && (!page?.canRecord || !summary.trim())} onClick={() => void save()}>{attempted ? '重试保存这条记录' : '确认保存记忆'}</button>}
    {attempted && <><p>保留原提交内容供重试。如果进度已变化，请重新准备后再确认。</p><button disabled={props.busy} onClick={() => { clearAttempt(); void load() }}>按最新进度重新准备</button></>}
  </details>
}
