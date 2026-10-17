import { useCallback, useEffect, useRef, useState } from 'react'
import { useAIConfigStore } from '../../stores/ai-config'
import type { TtrpgPredicateV1 } from '../../lib/ttrpg/open-contract'
import { readTtrpgOpenSituationDeskV1, requestTtrpgOpenSituationDeskV1, resumeTtrpgOpenSituationDeskV1, recoverTtrpgOpenSituationDeskV1,
  confirmTtrpgOpenSituationDeskV1, declineTtrpgOpenSituationDeskV1, repairTtrpgOpenSituationDeskV1, finishTtrpgOpenSituationDeskV1,
  cancelTtrpgOpenSituationDeskPreparedV1, enableTtrpgOpenSituationDeskV1, repairTtrpgOpenSituationDeskResponseV1,
  abandonTtrpgOpenSituationDeskWaitV1, type TtrpgOpenSituationDeskInputV1 } from '../../lib/ttrpg/open-situation-desk-service'
import { reconcileTtrpgOpenStoppedSituationV1 } from '../../lib/ttrpg/open-generated-situation-stop'

type Desk = Awaited<ReturnType<typeof readTtrpgOpenSituationDeskV1>>
const audiences = { 'gm-only': '仅主持', party: '队伍', private: '指定角色私下知晓', public: '公开' }
function conditionText(p: TtrpgPredicateV1, name: (key: string) => string): string {
  switch (p.op) {
    case 'all': return '（' + p.of.map(v => conditionText(v, name)).join('，且') + '）'
    case 'any': return '（' + p.of.map(v => conditionText(v, name)).join('，或') + '）'
    case 'not': return '不满足（' + conditionText(p.of, name) + '）'
    case 'actor-at': return name(p.actorKey) + '位于' + name(p.locationRef)
    case 'item-held': return name(p.actorKey) + '持有' + name(p.itemKey)
    case 'ability-available': return name(p.actorKey) + '可使用' + name(p.abilityKey)
    case 'resource-at-least': return name(p.actorKey) + '的' + name(p.resourceKey) + '至少为' + p.value
    case 'clock-at-least': return name(p.clockKey) + '至少推进至' + p.value
    case 'front-stage-at-least': return name(p.frontKey) + '至少达到阶段' + name(p.stageKey)
    case 'evidence-known-by': return name(p.actorKey) + '已获知线索' + name(p.clueRef)
    case 'situation-active': return name(p.templateKey) + '正在发生'
    case 'world-turn-at-least': return '世界轮次至少为' + p.value
    case 'chaos-at-least': return '混沌值至少为' + p.value
    case 'social-balance-at-least': return name(p.balanceKey) + '的关系余额至少为' + p.value
    case 'story-fact': return '本局记录' + name(p.factKey) + '符合' + String(p.expected ?? '既定条件')
    case 'world-fact': case 'session-fact': {
      const verbs = { exists: '存在', 'located-at': '位于', owns: '拥有', knows: '了解', 'allied-with': '结盟', 'hostile-to': '敌对',
        owes: '欠有债务', promised: '有承诺', damaged: '受损', destroyed: '已毁坏', blocked: '受阻', open: '开放' }
      return (p.op === 'world-fact' ? '冻结世界：' : '当前团局：') + name(p.subjectRef) + '的「' + verbs[p.predicateKey]
        + '」' + (p.objectRef ? '涉及' + name(p.objectRef) : '') + (p.value !== undefined ? '为' + String(p.value) : '存在有效记录')
    }
  }
}

/** Identity-keyed. Sequence refresh only reloads; it never aborts its own in-flight request. */
export default function TtrpgOpenSituationPanel(props: { input: TtrpgOpenSituationDeskInputV1; sequence: number; busy: boolean; perform: (job: () => Promise<void>) => Promise<void> }) {
  const config = useAIConfigStore(s => s.config), [page, setPage] = useState<Desk>(null)
  const [error, setError] = useState(''), [readError, setReadError] = useState(''), [notice, setNotice] = useState(''), [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState('结合当前地点、角色身份和已经发生的变化，拟定一个有不同选择的新局势。'), [cost, setCost] = useState('0.10')
  const [disclosedHash, setDisclosedHash] = useState(''), [sending, setSending] = useState(false)
  const [includeRuntimeEntities, setIncludeRuntimeEntities] = useState(false)
  const live = useRef(true), revision = useRef(0), controller = useRef<AbortController | null>(null), stopRequested = useRef(false)
  const { sessionId, viewerKey, scope: { projectId, worldId, workId } } = props.input
  const input = useCallback(() => ({ scope: { projectId, worldId, workId }, sessionId, viewerKey }), [projectId, worldId, workId, sessionId, viewerKey])
  const load = useCallback(async () => {
    const token = ++revision.current
    try { const next = await readTtrpgOpenSituationDeskV1(input()); if (live.current && token === revision.current) { setPage(next); setReadError('') } }
    catch (cause) { if (live.current && token === revision.current) { setPage(null); setReadError(cause instanceof Error ? cause.message : String(cause)) } }
  }, [input])
  useEffect(() => { live.current = true; return () => { live.current = false; revision.current += 1; controller.current?.abort() } }, [input])
  useEffect(() => { void load(); return () => { revision.current += 1 } }, [load, props.sequence])
  useEffect(() => { setDisclosedHash('') }, [page?.candidate?.candidateHash, page?.templateHash, input])
  useEffect(() => { setIncludeRuntimeEntities(false) }, [input])
  const act = (job: () => Promise<string | void>, success?: string) => props.perform(async () => {
    setError(''); setNotice('')
    try { const result = await job(); if (live.current) setNotice(result ?? success ?? '进度已更新。') }
    catch (cause) { if (live.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (live.current) await load() }
  })
  const send = (resume = false) => act(async () => {
    const abort = new AbortController(); controller.current = abort; stopRequested.current = false; setSending(true)
    try {
      if (resume) await resumeTtrpgOpenSituationDeskV1({ ...input(), aiConfig: config, signal: abort.signal })
      else await requestTtrpgOpenSituationDeskV1({ ...input(), submissionKey: crypto.randomUUID(), rawInput: draft, maximumCostUsd: Number(cost), aiConfig: config, signal: abort.signal,
        ...(includeRuntimeEntities ? { includeRuntimeEntities: true } : {}) })
    } catch (cause) { if (!stopRequested.current) throw cause }
    finally {
      try { if (stopRequested.current) await finishTtrpgOpenSituationDeskV1(input()) }
      finally { controller.current = null; if (live.current) setSending(false) }
    }
    return stopRequested.current ? '本次拟定已明确结束，原请求及费用记录保留。' : '回复已保留，请读取并审阅当前进度。'
  })
  if (!page && !error && !readError) return null
  const candidate = page?.candidate, template = candidate?.review?.proposal.template
  const name = (key: string) => page?.labels.find(l => l.key === key)?.title ?? key
  const conditions = (rows: TtrpgPredicateV1[]) => rows.length ? rows.map(p => conditionText(p, name)).join('；') : '无额外前置条件'
  return <details className="sf-open-table-card" data-testid="ttrpg-open-situation-desk" open={expanded} onToggle={e => setExpanded(e.currentTarget.open)}>
    <summary>拟定与管理新局势</summary>
    <p>每次由本人主动请求。保存定义后，再明确结束拟定并单独启用；不会代替玩家行动。</p>
    {page && !page.privateGm && <p>本桌使用 AI 主持，此处目前只能请求、保留或取消私域候选，尚无采用通道，不会自动投入运行。</p>}
    {error && <p role="alert">{error}</p>}{readError && <p role="alert">{readError}</p>}{notice && <p role="status">{notice}</p>}
    <button disabled={props.busy} onClick={() => { setError(''); void load() }}>读取局势拟定进度</button>
    {page?.canRequest && <fieldset disabled={props.busy}><legend>请求一个新局势</legend>
      <label>局势拟定要求<textarea aria-label="局势拟定要求" value={draft} maxLength={10000} onChange={e => setDraft(e.target.value)} /></label>
      <label>本次调用预留上限（美元）<input aria-label="局势调用预留上限" type="number" min="0" max="1000" step="0.01" value={cost} onChange={e => setCost(e.target.value)} /></label>
      <label><input type="checkbox" checked={includeRuntimeEntities} disabled={!page.runtimeInstanceCount} onChange={e => setIncludeRuntimeEntities(e.target.checked)} />本次允许引用本局已创建的对象（{page.runtimeInstanceCount} 个）。</label>
      <p>勾选后模型可读取这些对象的主持资料和当前状态，用于拟定候选。采用局势仍须单独审阅。</p>
      <button disabled={!draft.trim() || !cost.trim()} onClick={() => void send()}>请求 AI 拟定局势</button>
    </fieldset>}
    {page && !page.canRequest && <p>{page.unavailable}</p>}
    {sending && <button onClick={() => { stopRequested.current = true; controller.current?.abort() }}>停止本次局势请求</button>}
    {page?.request?.status === 'prepared' && <aside><p>原请求已保存，尚未发送。</p>
      {page.request.local && <button disabled={props.busy} onClick={() => void send(true)}>继续原局势请求</button>}
      <button disabled={props.busy} onClick={() => void act(async () => { await cancelTtrpgOpenSituationDeskPreparedV1(input()) }, '原未发送请求已取消。')}>取消未发送的局势请求</button>
    </aside>}
    {page?.request?.status === 'dispatched' && <p role="status">原请求已发出，正在等待结果。请保留原记录。</p>}
    {!sending && page?.request?.responseRecovery === 'saved-response' && <button disabled={props.busy} onClick={() => void act(async () => { await repairTtrpgOpenSituationDeskResponseV1(input()) }, '已补齐原回答回执，未再次请求模型；缺失用量只按估计记录。')}>恢复原局势回答回执</button>}
    {!sending && page?.request?.responseRecovery === 'unobserved' && <aside><p>本页没有正在等待的本地请求，尚无已保存回答。结束等待仍会保留原发送记录和可能费用。</p>
      <button disabled={props.busy} onClick={() => void act(async () => { await abandonTtrpgOpenSituationDeskWaitV1({ ...input(), decision: 'abandon-wait-as-unknown' }) }, '等待已结束，原请求的结果与费用仍按未知保留，未再次发送。')}>结束等待，保留未知结果与费用</button></aside>}
    {page?.request?.status === 'unknown' && <p>原请求的结果与费用待核对。可以明确结束本次拟定，系统不会重发。</p>}
    {page?.request?.status === 'failed' && <p>本次请求未完成，原记录保留。结束本次拟定后可主动发起新请求。</p>}
    {page?.request && !page.request.local && <p>这是历史请求，只供查阅，不能恢复发送或采用权限。</p>}
    {page?.request?.status === 'succeeded' && !page.summary && page.currentWindow && page.request.local && <button disabled={props.busy} onClick={() => void act(async () => { await recoverTtrpgOpenSituationDeskV1(input()) }, '已恢复原回答，未再次请求模型。')}>恢复已保存的局势回复</button>}
    {page?.summary && !page.privateGm && <p role="status">{page.adopted ? '原局势已采用。' : page.stopped ? '本次局势拟定已结束。' : '私域局势候选已保留。'}兼任主持没有本次私域候选的读取或采用权限。</p>}
    {candidate && <section aria-label="主持局势审阅"><h3>{page?.adopted ? '已采用的局势定义' : '待审局势'}</h3>
      {template ? <><h4>玩家会看到的标题</h4><p>{template.title}</p><h4>玩家提示与接收范围</h4>
        {template.interventionPoints.map(p => <article key={p.pointKey}><p>{p.affordanceHint}</p><p>{audiences[p.visibleTo]}：{p.knownByActorKeys.map(name).join('、') || '按本桌公开范围'}；{p.requiresPredicate ? conditionText(p.requiresPredicate, name) : '无额外提示条件'}</p></article>)}
        <h4>线索正文与发现条件</h4>{template.evidence.map(e => <article key={e.clueRef}><strong>{e.title}</strong><p>{e.description}</p>
          <p>初始知情：{audiences[e.audience]}，{e.knownByActorKeys.map(name).join('、') || '无初始知情角色'}。</p>
          <p>发现后：{audiences[e.discoveryPolicy.allowedAudience]}，{e.discoveryPolicy.recipientActorKeys.map(name).join('、') || (['public', 'party'].includes(e.discoveryPolicy.allowedAudience) ? '当时已授权队伍' : '无隐含接收者')}；{e.discoveryPolicy.requiresPlayerConfirmation ? '须玩家确认' : '按实际发现结算'}。</p>
          <p>发现条件：{conditions(e.discoveryPolicy.preconditions)}；可用方式：{e.discoveryPolicy.paths.map(p => name(p.key)).join('、')}。</p>
        </article>)}
        <details><summary>主持专用目标与完整定义</summary><p>{template.driverGoal}</p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(template, null, 2)}</pre></details>
      </> : <p>原回复格式或引用未通过检查，当前不能采用。</p>}
      {candidate.artifact.issues.filter(i => i.suggestedAction !== 'none').map(i => <p key={i.code + i.path}>{i.message}</p>)}
      <details><summary>查看局势原始回复</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{candidate.artifact.originalText}</pre></details>
      {page?.confirmationUnavailable && <p>{page.confirmationUnavailable}</p>}
      {page?.canConfirm && <fieldset disabled={props.busy}><legend>本版本的明确披露</legend>
        <label><input type="checkbox" checked={disclosedHash === page.templateHash} onChange={e => setDisclosedHash(e.target.checked ? page.templateHash! : '')} />我已审阅本版本的玩家标题、提示、线索正文和披露条件，同意保存此版本。</label>
        <button disabled={!disclosedHash || disclosedHash !== page.templateHash} onClick={() => void act(async () => { await confirmTtrpgOpenSituationDeskV1({ ...input(), candidateHash: candidate.candidateHash, templateHash: disclosedHash, disclosure: 'player-and-discovery-text-reviewed' }) }, '已采用局势定义，尚未启用。')}>确认披露并采用局势</button>
      </fieldset>}
      {!page?.adopted && !page?.declined && page?.currentWindow && <button disabled={props.busy} onClick={() => void act(async () => { await declineTtrpgOpenSituationDeskV1({ ...input(), candidateHash: candidate.candidateHash }) }, '这份局势已放弃，原回复保留。')}>放弃这份局势</button>}
      {page?.declined && <p>这份局势已明确放弃，不能再采用。</p>}
    </section>}
    {page?.adopted && <p role="status">局势定义已保存。结束拟定窗口后，可在下方单独启用。</p>}
    {page?.receiptPending && candidate && <button disabled={props.busy} onClick={() => void act(async () => { await repairTtrpgOpenSituationDeskV1({ ...input(), candidateHash: candidate.candidateHash }) }, '已补齐原采用回执，未重复采用。')}>补齐局势采用回执</button>}
    {page?.currentWindow && <button disabled={props.busy || page.request?.status === 'dispatched'} onClick={() => void act(async () => { await finishTtrpgOpenSituationDeskV1(input()) }, '本次局势拟定已结束，已采用定义和原记录保留。')}>{page.adopted ? '结束本次局势拟定' : '取消本次局势拟定'}</button>}
    {page?.stopRepairs.map(epochKey => <aside key={epochKey}><p>结束决定已保存，原运行收尾尚待补齐。</p><button disabled={props.busy} onClick={() => void act(async () => { await reconcileTtrpgOpenStoppedSituationV1({ ...input(), epochKey }) }, '局势拟定的结束记录已补齐。')}>补齐局势拟定结束记录</button></aside>)}
    {Boolean(page?.accepted.length) && <section aria-label="本局已采用局势"><h3>本局已采用局势</h3>{page!.accepted.map(r => <article key={r.templateKey}><p>{r.title} · {{ active: '正在发生', queued: '等待空位', saved: '定义已保存' }[r.status]}</p>
      <button disabled={props.busy || !page!.canEnable || r.status !== 'saved'} onClick={() => void act(async () => {
        const event = await enableTtrpgOpenSituationDeskV1({ ...input(), templateKey: r.templateKey, submissionKey: crypto.randomUUID() })
        const result = JSON.parse(event.payloadJson).result as { transition: 'activated' | 'queued' | 'existing' | 'rejected' }
        return { activated: '该局势已启用。', queued: '局势已进入等待队列。', existing: '该局势已在运行或等待。', rejected: '未满足启用条件，已采用定义仍保留。' }[result.transition]
      })}>启用「{r.title}」</button></article>)}</section>}
  </details>
}
