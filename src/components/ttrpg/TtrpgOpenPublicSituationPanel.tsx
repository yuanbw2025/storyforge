import { useCallback, useEffect, useRef, useState } from 'react'
import { useAIConfigStore } from '../../stores/ai-config'
import type { TtrpgOpenSituationDeskInputV1 } from '../../lib/ttrpg/open-situation-desk-service'
import { readTtrpgOpenPublicSituationDeskV1, requestTtrpgOpenPublicSituationDeskV1, resumeTtrpgOpenPublicSituationDeskV1,
  finalizeTtrpgOpenPublicSituationDeskV1, finishTtrpgOpenPublicSituationDeskV1, enableTtrpgOpenPublicSituationDeskV1,
  repairTtrpgOpenPublicSituationDeskResponseV1, abandonTtrpgOpenPublicSituationDeskWaitV1 } from '../../lib/ttrpg/open-public-situation-desk'
import { reconcileTtrpgOpenStoppedPublicSituationV1 } from '../../lib/ttrpg/open-public-situation-stop'

type Desk = Awaited<ReturnType<typeof readTtrpgOpenPublicSituationDeskV1>>
/** Common request does not grant the player-host access to unrevealed GM material. */
export default function TtrpgOpenPublicSituationPanel(props: { input: TtrpgOpenSituationDeskInputV1; sequence: number; busy: boolean; perform: (job: () => Promise<void>) => Promise<void> }) {
  const config = useAIConfigStore(s => s.config), [page, setPage] = useState<Desk>(null)
  const [error, setError] = useState(''), [readError, setReadError] = useState(''), [notice, setNotice] = useState(''), [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState('结合大家已知的信息，拟定一个可以调查并有不同选择的新局势。'), [cost, setCost] = useState('0.10')
  const [shared, setShared] = useState(false), [delegated, setDelegated] = useState(false), [sending, setSending] = useState(false)
  const [includeRuntimeEntities, setIncludeRuntimeEntities] = useState(false)
  const live = useRef(true), revision = useRef(0), controller = useRef<AbortController | null>(null), stopRequested = useRef(false)
  const { sessionId, viewerKey, scope: { projectId, worldId, workId } } = props.input
  const input = useCallback(() => ({ scope: { projectId, worldId, workId }, sessionId, viewerKey }), [projectId, worldId, workId, sessionId, viewerKey])
  const load = useCallback(async () => {
    const token = ++revision.current
    try { const next = await readTtrpgOpenPublicSituationDeskV1(input()); if (live.current && token === revision.current) { setPage(next); setReadError('') } }
    catch { if (live.current && token === revision.current) { setPage(null); setReadError('当前无法读取共同局势进度，请重新读取。') } }
  }, [input])
  useEffect(() => { live.current = true; return () => { live.current = false; revision.current += 1; controller.current?.abort() } }, [input])
  useEffect(() => { void load(); return () => { revision.current += 1 } }, [load, props.sequence])
  useEffect(() => { setShared(false); setDelegated(false) }, [input, draft, cost, config, includeRuntimeEntities])
  useEffect(() => { setIncludeRuntimeEntities(false) }, [input])
  const act = (job: () => Promise<string | void>, success?: string) => props.perform(async () => {
    setError(''); setNotice('')
    try { const result = await job(); if (live.current) setNotice(result ?? success ?? '进度已更新。') }
    catch (cause) { if (live.current) setError(cause instanceof Error ? cause.message : '本次操作尚未完成，请保留原记录。') }
    finally { if (live.current) await load() }
  })
  const send = (resume = false) => act(async () => {
    const abort = new AbortController(); controller.current = abort; stopRequested.current = false; setSending(true)
    try {
      if (resume) await resumeTtrpgOpenPublicSituationDeskV1({ ...input(), aiConfig: config, signal: abort.signal })
      else {
        if (!shared || !delegated) throw new Error('请先确认本次共享与一次委托。')
        await requestTtrpgOpenPublicSituationDeskV1({ ...input(), aiConfig: config, signal: abort.signal, submissionKey: crypto.randomUUID(), rawInput: draft,
          maximumCostUsd: Number(cost), sharingDecision: 'share-this-request-with-current-party', delegationDecision: 'adopt-this-one-candidate',
          ...(includeRuntimeEntities ? { includeRuntimeEntities: true } : {}) })
      }
    } catch (cause) { if (!stopRequested.current) throw cause }
    finally {
      try { if (stopRequested.current) await finishTtrpgOpenPublicSituationDeskV1(input()) }
      finally { controller.current = null; if (live.current) { setSending(false); setShared(false); setDelegated(false) } }
    }
    return stopRequested.current ? '本次共同请求已结束，原回答及费用记录保留。' : '本次请求已处理，请查看保存状态；局势需要单独启用。'
  })
  if (!page && !readError) return null
  return <details className="sf-open-table-card" data-testid="ttrpg-open-public-situation-desk" open={expanded} onToggle={e => setExpanded(e.currentTarget.open)}>
    <summary>用共同资料拟定新局势</summary>
    <p>AI 主持只读取当前队伍共同可知的资料和本次明确共享的输入。通过检查后，仅按本次委托保存一个局势定义；不会代替玩家行动。</p>
    {error && <p role="alert">{error}</p>}{readError && <p role="alert">{readError}</p>}{notice && <p role="status">{notice}</p>}
    <button disabled={props.busy} onClick={() => { setError(''); void load() }}>读取共同局势进度</button>
    {page?.canRequest && <fieldset disabled={props.busy}><legend>请求一个新局势</legend>
      <label>本次共同局势要求<textarea aria-label="本次共同局势要求" maxLength={20000} value={draft} onChange={e => setDraft(e.target.value)} /></label>
      <label>本次调用预留上限（美元）<input aria-label="共同局势调用预留上限" type="number" min="0" max="1000" step="0.01" value={cost} onChange={e => setCost(e.target.value)} /></label>
      <label><input type="checkbox" checked={includeRuntimeEntities} disabled={!page.runtimeInstanceCount} onChange={e => setIncludeRuntimeEntities(e.target.checked)} />本次允许引用全队共同可知的已创建对象（{page.runtimeInstanceCount} 个）。</label>
      <p>仅提供这些对象的身份和名称；私密对象、装备和主持档案保持各自的知情范围。</p>
      <label><input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} />我同意把以上本次输入共享给当前队伍。</label>
      <label><input type="checkbox" checked={delegated} onChange={e => setDelegated(e.target.checked)} />我委托 AI 主持在检查通过后采用本次这一个候选，保存局势定义。</label>
      <button disabled={!shared || !delegated || !draft.trim() || !cost.trim()} onClick={() => void send()}>请求并保存一个共同局势</button>
    </fieldset>}
    {page && !page.canRequest && <p>{page.unavailable}</p>}
    {sending && <button onClick={() => { stopRequested.current = true; controller.current?.abort() }}>停止本次共同局势请求</button>}
    {page?.request && !page.request.local && <p>这是历史请求，只供查阅，不能恢复发送或采用权限。</p>}
    {page?.request?.local && page.currentWindow && ['authorized', 'prepared'].includes(page.request.status) && <aside><p>本次授权已保存，尚未发送；继续时仍使用原请求和原模型。</p>
      <button disabled={props.busy} onClick={() => void send(true)}>继续原共同局势请求</button></aside>}
    {page?.request?.status === 'dispatched' && <p role="status">原请求已发出，正在等待结果。</p>}
    {!sending && page?.request?.responseRecovery === 'saved-response' && <button disabled={props.busy} onClick={() => void act(async () => { await repairTtrpgOpenPublicSituationDeskResponseV1(input()) }, '已恢复原回答回执，未再次请求模型。')}>恢复原共同局势回答回执</button>}
    {!sending && page?.request?.responseRecovery === 'unobserved' && <aside><p>尚无已保存回答。结束等待会保留原发送记录和可能费用。</p>
      <button disabled={props.busy} onClick={() => void act(async () => { await abandonTtrpgOpenPublicSituationDeskWaitV1({ ...input(), decision: 'abandon-wait-as-unknown' }) }, '已结束等待，原结果与费用仍按未知保留。')}>结束共同请求等待，保留未知费用</button></aside>}
    {page?.request?.status === 'unknown' && <p>原请求的结果与费用待核对，系统不会重发。</p>}
    {page?.request?.status === 'failed' && <p>本次请求未完成，原记录保留。</p>}
    {page?.summary && !page.adopted && <p role="status">{['ready', 'usable-with-warnings'].includes(page.summary.status) ? '原候选已保存，尚未完成采用。' : '原回复未通过检查，当前不能采用。'}尚未公开的主持目标与线索正文保持隐藏。</p>}
    {page?.request?.local && page.request.status === 'succeeded' && page.currentWindow && !page.summary && <button disabled={props.busy} onClick={() => void act(async () => { await finalizeTtrpgOpenPublicSituationDeskV1(input()) })}>恢复原共同局势候选与采用进度</button>}
    {(page?.canFinalize || page?.receiptPending) && <button disabled={props.busy} onClick={() => void act(async () => { await finalizeTtrpgOpenPublicSituationDeskV1(input()) }, '已完成原候选采用与回执，未再次请求模型。')}>{page.receiptPending ? '补齐共同局势采用回执' : '按原一次委托完成共同局势采用'}</button>}
    {page?.adopted && <p role="status">局势定义已保存，尚未启用时可在下方单独启用。</p>}
    {page?.currentWindow && <button disabled={props.busy || page.request?.status === 'dispatched'} onClick={() => void act(async () => { await finishTtrpgOpenPublicSituationDeskV1(input()) }, '本次共同请求已结束，已保存定义和原记录保留。')}>{page.adopted ? '结束本次共同局势拟定' : '取消本次共同局势拟定'}</button>}
    {page?.stopRepairs.map(epochKey => <button key={epochKey} disabled={props.busy} onClick={() => void act(async () => { await reconcileTtrpgOpenStoppedPublicSituationV1({ ...input(), epochKey }) }, '原共同请求结束记录已补齐。')}>补齐共同局势结束记录</button>)}
    {Boolean(page?.accepted.length) && <section aria-label="本局共同局势"><h3>本局共同局势</h3>{page!.accepted.map(r => <article key={r.templateKey}><p>{r.title} · {{ active: '正在发生', queued: '等待空位', saved: '定义已保存' }[r.status]}</p>
      <button disabled={props.busy || !page!.canEnable || r.status !== 'saved'} onClick={() => void act(async () => {
        const event = await enableTtrpgOpenPublicSituationDeskV1({ ...input(), templateKey: r.templateKey, submissionKey: crypto.randomUUID() })
        const result = JSON.parse(event.payloadJson).result as { transition: 'activated' | 'queued' | 'existing' | 'rejected' }
        return { activated: '该局势已启用。', queued: '局势已进入等待队列。', existing: '该局势已在运行或等待。', rejected: '未满足启用条件，已保存定义仍保留。' }[result.transition]
      })}>启用「{r.title}」</button></article>)}</section>}
  </details>
}
