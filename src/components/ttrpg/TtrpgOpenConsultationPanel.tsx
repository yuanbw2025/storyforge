import { useCallback, useEffect, useRef, useState } from 'react'
import { readTtrpgOpenConsultationDeskV1, startTtrpgOpenConsultationDeskV1, consultTtrpgOpenConsultationDeskV1,
  closeTtrpgOpenConsultationDeskV1, type TtrpgOpenConsultationDeskV1 } from '../../lib/ttrpg/open-consultation-desk'
import type { TtrpgOpenConsultationInputV1 } from '../../lib/ttrpg/open-human-consultation'
import { prepareTtrpgOpenClueShareV1, confirmTtrpgOpenClueShareV1, type TtrpgOpenClueShareReviewV1 } from '../../lib/ttrpg/open-knowledge-share-desk'
import { readTtrpgOpenSettledViewV1 } from '../../lib/ttrpg/open-read-conflict'

type Props = { input: TtrpgOpenConsultationInputV1; sequence: number; busy: boolean; open?: boolean; onOpenChange?: (open: boolean) => void; perform: (job: () => Promise<void>) => Promise<void> }
export default function TtrpgOpenConsultationPanel(props: Props) {
  return <Consultation key={JSON.stringify(props.input)} {...props} />
}
function Consultation(props: Props) {
  const [expanded, setExpanded] = useState(false), [page, setPage] = useState<TtrpgOpenConsultationDeskV1 | null>(null)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [tableKey, setTableKey] = useState(''), [tier, setTier] = useState(''), [question, setQuestion] = useState('')
  const [sourceKey, setSourceKey] = useState(''), [audience, setAudience] = useState<'private' | 'party' | 'public'>('party'), [recipients, setRecipients] = useState<string[]>([])
  const [pending, setPending] = useState<{ sequence: number; review: TtrpgOpenClueShareReviewV1 } | null>(null), [agreed, setAgreed] = useState(false)
  const isExpanded = props.open ?? expanded
  const live = useRef(true), generation = useRef(0), locked = useRef(false)
  const { scope: { projectId, worldId, workId }, sessionId, viewerKey } = props.input
  const input = useCallback(() => ({ scope: { projectId, worldId, workId }, sessionId, viewerKey }), [projectId, worldId, workId, sessionId, viewerKey])
  const refresh = useCallback(async () => {
    const token = ++generation.current
    try {
      const value = await readTtrpgOpenSettledViewV1(() => readTtrpgOpenConsultationDeskV1(input()), () => live.current && token === generation.current)
      if (value && live.current && token === generation.current) { setPage(value); setError('') }
    } catch (cause) { if (live.current && token === generation.current) { setPage(null); setError(cause instanceof Error ? cause.message : '咨询暂时无法读取，请核对原进度。') } }
  }, [input])
  useEffect(() => { live.current = true; generation.current += 1; return () => { live.current = false } }, [])
  useEffect(() => { setPending(null); setAgreed(false); if (isExpanded) void refresh() }, [isExpanded, props.sequence, refresh])
  const view = page?.sequence === props.sequence ? page : null, review = pending?.sequence === props.sequence ? pending.review : null
  const source = view?.sharing.sources.find(row => JSON.stringify([row.knowledgeKey, row.actorKey]) === sourceKey)
  const table = view?.tables.find(row => row.key === tableKey)
  const resetReview = () => { setPending(null); setAgreed(false); setError(''); setNotice('') }
  const act = (job: () => Promise<void>, message: string) => props.perform(async () => {
    if (locked.current || !live.current) return
    locked.current = true; setError(''); setNotice('')
    try { await job(); if (live.current) setNotice(message) }
    catch (cause) { if (live.current) setError(cause instanceof Error ? cause.message : '操作未完成，请先读取原进度。') }
    finally { locked.current = false; if (live.current) await refresh() }
  })
  return <details className="sf-open-table-card" data-testid="ttrpg-open-consultation-desk" open={isExpanded}
    onToggle={event => { setExpanded(event.currentTarget.open); props.onOpenChange?.(event.currentTarget.open) }}>
    <summary>咨询与线索交流</summary>
    <p>可按冻结规则咨询，也可把已经知道的线索明确分享给同伴。咨询和分享不推进游戏时间。</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {isExpanded && <>
      <button disabled={props.busy} onClick={() => { setError(''); void refresh() }}>读取咨询与交流进度</button>
      {!view && !error && <p role="status">正在读取本人可用的咨询与线索…</p>}
      {view && <>
        {view.unavailable && <p>{view.unavailable}</p>}
        <button disabled={props.busy || !view.canStart} onClick={() => void act(async () => {
          await startTtrpgOpenConsultationDeskV1({ ...input(), submissionKey: crypto.randomUUID(), decision: 'start-this-consultation-and-sharing' })
        }, '本次咨询与交流已开始。')}>开始本次咨询与交流</button>
        <button disabled={props.busy || !view.canClose} onClick={() => void act(async () => {
          await closeTtrpgOpenConsultationDeskV1({ ...input(), submissionKey: crypto.randomUUID() })
        }, '本次咨询与交流已结束，原结果和分享记录已保留。')}>结束本次咨询与交流</button>
        <fieldset disabled={props.busy || !view.canConsult}><legend>受限 Oracle 咨询</legend>
          <p>本世界轮次还可咨询 {view.remainingConsultations} 次；重新开始窗口不会补充次数。</p>
          <label>Oracle 咨询表<select aria-label="Oracle 咨询表" value={tableKey} onChange={event => { setTableKey(event.target.value); setTier('') }}>
            <option value="">选择允许的咨询表</option>{view.tables.map(row => <option key={row.key} value={row.key}>{row.title}</option>)}
          </select></label>
          {Boolean(table?.tiers.length) && <label>Oracle 可能性<select aria-label="Oracle 可能性" value={tier} onChange={event => setTier(event.target.value)}>
            <option value="">明确选择可能性</option>{table!.tiers.map(row => <option key={row.key} value={row.key}>{row.label}</option>)}
          </select></label>}
          <label>Oracle 咨询问题<textarea aria-label="Oracle 咨询问题" maxLength={2000} value={question} onChange={event => setQuestion(event.target.value)} /></label>
          <button disabled={!table || !question.trim() || Boolean(table.tiers.length) && !tier} onClick={() => void act(async () => {
            await consultTtrpgOpenConsultationDeskV1({ ...input(), submissionKey: crypto.randomUUID(), oracleKey: tableKey, question, likelihoodTierKey: tier || null })
            if (live.current) setQuestion('')
          }, '本次原咨询结果已保存，刷新不会重新咨询。')}>确认问题并咨询一次</button>
        </fieldset>
        <section aria-label="已保存的咨询结果">{view.history.map(row => <article key={JSON.stringify(row.sourceRef)}>
          <p>第 {row.worldTurn} 轮 · {row.audience === 'gm-only' ? '仅主持' : row.audience === 'public' ? '公开' : '全队'} · 问题：{row.question}</p><p>原结果：{row.result}</p>
        </article>)}</section>
        <section aria-label="分享已知线索">
          <h3>分享已知线索</h3><p>接收者将按转述或信念保存这段文字，原观察记录会保留。</p>
          {!review && <fieldset disabled={props.busy || !view.sharing.canShare}>
            <label>要分享的线索<select aria-label="要分享的线索" value={sourceKey} onChange={event => { setSourceKey(event.target.value); resetReview() }}>
              <option value="">选择实际知道的线索</option>{view.sharing.sources.map(row => <option key={JSON.stringify([row.knowledgeKey, row.actorKey])} value={JSON.stringify([row.knowledgeKey, row.actorKey])}>{row.actorName}：{row.title} · {row.reliability === 'observed' ? '本人观察' : row.reliability === 'hearsay' ? '转述' : '信念'}</option>)}
            </select></label>
            {source && <p className="whitespace-pre-wrap">{source.description}</p>}
            <label>线索分享范围<select aria-label="线索分享范围" value={audience} onChange={event => { setAudience(event.target.value as typeof audience); setRecipients([]); resetReview() }}>
              <option value="party">当前全队</option>{view.sharing.privateAllowed && <option value="private">指定同伴</option>}<option value="public">公开</option>
            </select></label>
            {audience === 'party' && <p>当前全队：{view.sharing.players.map(row => row.name).join('、')}</p>}
            {audience === 'private' && view.sharing.players.map(row => <label key={row.actorKey}><input type="checkbox" checked={recipients.includes(row.actorKey)}
              onChange={() => { setRecipients(values => values.includes(row.actorKey) ? values.filter(value => value !== row.actorKey) : [...values, row.actorKey]); resetReview() }} />分享给 {row.name}</label>)}
            {audience === 'public' && <p>这段文字将成为公开知识。</p>}
            <button disabled={!source || audience === 'private' && !recipients.length} onClick={() => void act(async () => {
              const value = await prepareTtrpgOpenClueShareV1({ ...input(), submissionKey: crypto.randomUUID(), actorKey: source!.actorKey, sourceKnowledgeKey: source!.knowledgeKey, audience,
                recipientActorKeys: audience === 'public' ? [] : audience === 'party' ? view.sharing.players.map(row => row.actorKey) : recipients })
              if (live.current) { setPending({ sequence: props.sequence, review: value }); setAgreed(false) }
            }, '请核对准确文字、范围和接收者，再决定是否分享。')}>审阅这次线索分享</button>
          </fieldset>}
          {review && <section aria-label="线索分享确认">
            <h4>{review.title}</h4><p className="whitespace-pre-wrap">{review.description}</p><p>转述者：{review.actorName}</p>
            <p>范围：{review.audience === 'public' ? '公开' : review.audience === 'party' ? '当前全队' : '指定同伴'}；接收者：{review.recipients.join('、') || '公开读者'}；保存为{review.reliability === 'belief' ? '信念' : '转述'}。</p>
            <label><input type="checkbox" disabled={props.busy} checked={agreed} onChange={event => setAgreed(event.target.checked)} />我已核对这段线索文字、分享范围和接收者。</label>
            <button disabled={props.busy || !agreed} onClick={() => void act(async () => {
              await confirmTtrpgOpenClueShareV1({ ...input(), review, decision: 'share-this-exact-clue-with-these-recipients' })
              if (live.current) { setPending(null); setAgreed(false); setSourceKey('') }
            }, '这段线索已按指定范围分享，原观察和转述来源已保留。')}>明确分享这段线索</button>
            <button disabled={props.busy} onClick={resetReview}>返回重选线索与接收者</button>
          </section>}
        </section>
      </>}
    </>}
  </details>
}
