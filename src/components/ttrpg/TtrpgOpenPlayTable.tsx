import TtrpgOpenContinuationPanel from './TtrpgOpenContinuationPanel'
import TtrpgOpenStageOpeningPanel from './TtrpgOpenStageOpeningPanel'
import TtrpgOpenSituationPanel from './TtrpgOpenSituationPanel'
import TtrpgOpenPublicSituationPanel from './TtrpgOpenPublicSituationPanel'
import TtrpgOpenCommonOraclePanel from './TtrpgOpenCommonOraclePanel'
import TtrpgOpenConsultationPanel from './TtrpgOpenConsultationPanel'
import TtrpgOpenAudioPanel from './TtrpgOpenAudioPanel'
import TtrpgNarrationListeningSettings from './TtrpgNarrationListeningSettings'
import TtrpgOpenIdentityKnowledgePanel from './TtrpgOpenIdentityKnowledgePanel'
import TtrpgOpenEntityPanel from './TtrpgOpenEntityPanel'
import TtrpgOpenBriefPanel from './TtrpgOpenBriefPanel'
import TtrpgOpenWorldPatchPanel from './TtrpgOpenWorldPatchPanel'
import TtrpgOpenHistoricalResponses from './TtrpgOpenHistoricalResponses'
import TtrpgOpenMemoryPanel from './TtrpgOpenMemoryPanel'
import { readTtrpgOpenTableContextTraceV1, type TtrpgOpenTableContextTraceV1 } from '../../lib/ttrpg/open-table-service'
import { delegateTtrpgOpenTableHostingV1, resumeTtrpgOpenTableHostingV1, stopTtrpgOpenTableHostingV1 } from '../../lib/ttrpg/open-table-service'
import TtrpgOpenTableConversation from './TtrpgOpenTableConversation'
import TtrpgOpenManualAction from './TtrpgOpenManualAction'
import { recoverTtrpgOpenTableResponseV1, resumeTtrpgOpenManualActionV1 } from '../../lib/ttrpg/open-table-service'
import TtrpgOpenPrivateChoicePanel from './TtrpgOpenPrivateChoicePanel'
import TtrpgOpenIntentReview from './TtrpgOpenIntentReview'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ProductRuntimeSession, ProductRuntimeState, WorkspaceScope } from '../../lib/types'
import { useAIConfigStore } from '../../stores/ai-config'
import { readTtrpgOpenTableV1, consentTtrpgOpenTableSeatV1, startTtrpgOpenTableV1, requestTtrpgOpenTableCandidateV1,
  acceptTtrpgOpenTableCandidateV1, confirmTtrpgOpenTableRiskV1, chooseTtrpgOpenTableConsequenceV1, recoverTtrpgOpenTableGatesV1, preauthorizeTtrpgOpenTableCompanionV1, resumeTtrpgOpenTableV1,
  recordTtrpgOpenTableHumanNarrationV1, repairTtrpgOpenTableHumanNarrationV1, repairTtrpgOpenTableModelNarrationV1, repairTtrpgOpenTableIntentV1, cancelTtrpgOpenTablePreparedRequestV1, finishTtrpgOpenTableWindowV1, rejectTtrpgOpenTableIntentV1, changeTtrpgOpenTableSafetyV1, type TtrpgOpenTableViewV1 } from '../../lib/ttrpg/open-table-service'
import './ttrpg-open-play.css'
import TtrpgOpenConsequencePanel from './TtrpgOpenConsequencePanel'
import TtrpgOpenHostTable from './TtrpgOpenHostTable'
import { consentTtrpgOpenHostSeatV1 } from '../../lib/ttrpg/open-table-service'
import { readTtrpgOpenSettledViewV1 } from '../../lib/ttrpg/open-read-conflict'
export interface TtrpgPlayTablePropsV1 {
  session: ProductRuntimeSession; state: ProductRuntimeState; scope: WorkspaceScope
  onChanged: () => Promise<void>; onCheckpoint: (name: string) => Promise<void>; onBusyChange?: (busy: boolean) => void
}
const labels: Record<string, string> = { rule: '规则裁定', time: '世界时间', mechanics: '规则后果', effect: '行动后果', knowledge: '线索发现', pressure: '威胁推进', situations: '局势变化', terminal: '阶段检查', gates: '继续冒险的条件', narration: 'KP 叙述', handoff: '下一位行动者' }
const waits: Record<string, string> = { 'awaiting-choice': '请先确认本次行动的后果选项。', 'awaiting-consequence': '本次后果需要主持或受影响玩家确认。', 'awaiting-stage-consequence': '阶段后果需要相关玩家确认。', 'awaiting-stage-closure': '当前阶段可以收束，请先确认阶段总结。', 'awaiting-gate-recovery': '当前仍有继续冒险的条件需要修复，已完成的行动已保存。', 'awaiting-human-response': '正在等待真人回应。', completed: '本次行动与主持结果已保存。' }
export default function TtrpgOpenPlayTable(props: TtrpgPlayTablePropsV1) {
  const config = useAIConfigStore(s => s.config), [view, setView] = useState<TtrpgOpenTableViewV1 | null>(null)
  const [selected, setSelected] = useState(''), [viewerKey, setViewerKey] = useState(''), [accepted, setAccepted] = useState(false), [aiAllowed, setAiAllowed] = useState(false)
  const [hostViewer,setHostViewer] = useState(''),[selectedHost,setSelectedHost] = useState(''),[hostAccepted,setHostAccepted] = useState(false)
  const [manualDraft, setManualDraft] = useState(''), [manualReason, setManualReason] = useState<'host-authored' | 'budget-exhausted' | 'model-unavailable' | 'replace-candidate'>('host-authored')
  const [draft, setDraft] = useState(''), [costLimit, setCostLimit] = useState('0.10'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [hostingAccepted, setHostingAccepted] = useState(false), [hostingStopping, setHostingStopping] = useState(false)
  const [contextTrace, setContextTrace] = useState<TtrpgOpenTableContextTraceV1>(null)
  useEffect(() => { setContextTrace(null) }, [viewerKey, props.session.id, props.state.lastSequence])
  const hostingSignal = useRef<AbortSignal | null>(null)
  const activeViewer = useRef(''), revision = useRef(0), controller = useRef<AbortController | null>(null), live = useRef(true)
  const sessionId = props.session.id!, { projectId, worldId, workId } = props.scope
  const authorityKey = JSON.stringify([props.session.runtimeSourceHash, props.state.ttrpg && 'authorization' in props.state.ttrpg ? props.state.ttrpg.authorization : null])
  const consultationOwner = JSON.stringify([projectId, worldId, workId, sessionId, viewerKey])
  const [consultationDisclosure, setConsultationDisclosure] = useState({ owner: '', open: false })
  useEffect(() => { setConsultationDisclosure({ owner: consultationOwner, open: false }) }, [consultationOwner])
  const refresh = useCallback(async () => {
    const current = ++revision.current
    try {
      const next = await readTtrpgOpenSettledViewV1(() => readTtrpgOpenTableV1({ scope: { projectId, worldId, workId }, sessionId,
        ...(activeViewer.current ? { viewerKey: activeViewer.current } : {}) }), () => live.current && revision.current === current)
      if (next && live.current && revision.current === current) { setView(next) }
    } catch (cause) { if (live.current && revision.current === current) { setView(null);setError(cause instanceof Error ? cause.message : String(cause)) } }
  }, [projectId, worldId, workId, sessionId])
  // Identity/source changes clear private views before paint. A new receipt in
  // the same identity only refreshes data; it must not unmount active editors.
  useLayoutEffect(() => { live.current = true;setView(null);return () => { live.current = false;revision.current += 1;controller.current?.abort() } }, [refresh, viewerKey, authorityKey])
  useEffect(() => { void refresh() }, [refresh, viewerKey, authorityKey, props.state.lastSequence])
  const perform = async (job: (signal: AbortSignal) => Promise<void>) => {
    if (controller.current) return
    const abort = new AbortController();controller.current = abort;setBusy(true);props.onBusyChange?.(true);setError('');setNotice('')
    try { await job(abort.signal) } catch (cause) { if (live.current) setError(abort.signal.aborted ? '已停止。本次已保存的行动或未知请求会保留，请先读取进度。' : cause instanceof Error ? cause.message : String(cause)) }
    finally {
      controller.current = null
      if (live.current) { setBusy(false);props.onBusyChange?.(false);try { await props.onChanged();await refresh() } catch (cause) { setError(`操作结果已保留，但进度暂时无法读取：${cause instanceof Error ? cause.message : String(cause)}`) } }
    }
  }
  const input = () => ({ scope: props.scope, sessionId, viewerKey: activeViewer.current })
  const request = (purpose: 'intent' | 'companion' | 'kp', actorKey?: string) => perform(async signal => {
    const maximumCostUsd = Number(costLimit)
    if (!Number.isFinite(maximumCostUsd) || maximumCostUsd < 0 || maximumCostUsd > 1000) throw new Error('请填写有效的本次调用预算预留')
    await requestTtrpgOpenTableCandidateV1({ ...input(), purpose, actorKey, rawInput: purpose === 'intent' ? draft.trim() : '根据已知情况继续当前行动。', aiConfig: config, maximumCostUsd, signal })
  })
  const p = view?.player, op = p?.operation
  const continueHosting = (grant: boolean) => perform(async signal => {
    hostingSignal.current = signal
    try {
      if (grant) {
        const maximumCostUsdPerCall = Number(costLimit)
        if (!Number.isFinite(maximumCostUsdPerCall) || maximumCostUsdPerCall < 0) throw new Error('请填写有效的每次调用预留上限')
        await delegateTtrpgOpenTableHostingV1({ ...input(), maximumCostUsdPerCall, decision: 'delegate-this-epoch' })
        await refresh()
      }
      const result = await resumeTtrpgOpenTableHostingV1({ ...input(), aiConfig: config, signal })
      const messages: Record<typeof result.reason, string> = { stopped: '本轮自动主持已停止，已保存的进度会保留。', paused: '冒险已暂停，请明确恢复后再继续主持。',
        'awaiting-result': '原请求已发送，请等待或核对结果。', 'model-recovery': '原模型请求需要核对，请先处理请求记录。', 'needs-human': '现在需要真人审查或选择，请按桌面提示处理。',
        'candidate-review': '原回复已保留，请检查需要修订的候选。', budget: '本轮已到预算或队友行动上限，交回真人。', 'stage-closed': '本阶段已收束，进度已保存。', human: '本轮协作已交回真人，请决定下一步。', yield: '本次推进已保存，请明确继续本轮主持。' }
      setNotice(messages[result.reason])
    } finally { if (hostingSignal.current === signal) hostingSignal.current = null }
  })
  const stopHosting = async () => {
    const hosting = p?.hosting, running = controller.current
    if (hostingStopping || !hosting?.permission) return
    setHostingStopping(true);setError('')
    if (!running) { setBusy(true);props.onBusyChange?.(true) }
    try {
      await stopTtrpgOpenTableHostingV1({ ...input(), epochKey: hosting.epochKey, hostingDelegationRef: hosting.permission.sourceRef }, () => {
        if (running?.signal === hostingSignal.current) running?.abort()
      })
      setNotice('本轮自动主持已停止。已结算的行动和已发送的请求记录会保留。')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally {
      try { await props.onChanged();await refresh() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
      setHostingStopping(false);if (!running) { setBusy(false);props.onBusyChange?.(false) }
    }
  }
  if (hostViewer) return <TtrpgOpenHostTable key={`${sessionId}:${hostViewer}`} {...props} viewerKey={hostViewer} onExit={() => {
    setHostViewer('');setSelectedHost('');setHostAccepted(false);activeViewer.current = '';setViewerKey('');setSelected('');setView(null);void refresh()
  }} />
  return <section className="sf-open-table" data-testid="ttrpg-open-player-table">
    <header><p className="sf-open-table-preview">开放跑团 · 开发预览</p><h1>{view?.title ?? props.session.title}</h1>{view && <p>{view.pitch}</p>}</header>
    <TtrpgNarrationListeningSettings key={`listening:${sessionId}:${viewerKey}`} paused={props.state.ttrpg?.product.safety.status !== 'active'}/>
    {error && <div role="alert"><p>{error}</p><button disabled={busy} onClick={() => { setError('');void refresh() }}>重新读取进度</button></div>}
    {notice && <p role="status">{notice}</p>}
    {view && viewerKey && !view.started && <button disabled={busy} onClick={() => { ++revision.current;activeViewer.current = '';setViewerKey('');setSelected('');setAccepted(false);setView(null);setError('');setNotice('') }}>返回身份选择</button>}
    {!view && !error && <p role="status">正在读取冒险…</p>}
    {view && !viewerKey && <fieldset disabled={busy} className="sf-open-table-card"><legend>确认当前玩家</legend>
      <p>本机交接角色时，请让对应玩家亲自确认；确认前不会显示角色秘密。</p>
      <label>我的角色<select aria-label="我的角色" value={selected} onChange={e => setSelected(e.target.value)}><option value="">选择角色</option>{view.seats.filter(s => s.controller === 'human' || s.controller === 'hybrid').map(s => <option key={s.viewerKey} value={s.viewerKey}>{s.name}</option>)}</select></label>
      {!view.sessionZeroComplete && <><p>{view.agreement.premise}</p>{view.continuationOpening && <p>承接到世界轮次 {view.continuationOpening.worldTurn}，保留 {view.continuationOpening.interruptedCount} 项中断行动及 {view.continuationOpening.unknownCount} 条未知结果。确认后按本桌新席位检查开局。</p>}<ul>{view.agreement.consentChecklist.map(item => <li key={item}>{item}</li>)}</ul><p>不涉及：{view.agreement.lines.join('、') || '按本桌约定'}；淡出处理：{view.agreement.veils.join('、') || '按本桌约定'}；暂停信号：{view.agreement.pauseSignal}</p><label><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />我已了解安全约定和 AI 身份，并确认这是我的角色。</label>
        <label><input type="checkbox" checked={aiAllowed} onChange={e => setAiAllowed(e.target.checked)} />允许 AI 根据我的角色资料提供行动建议。</label></>}
      <button disabled={!selected || (!view.sessionZeroComplete && !accepted)} onClick={() => void perform(async () => {
        if (!view.sessionZeroComplete) await consentTtrpgOpenTableSeatV1({ scope: props.scope, sessionId, viewerKey: selected, aiAdviceAllowed: aiAllowed })
        activeViewer.current = selected;setViewerKey(selected);setAccepted(false);setDraft('');setManualDraft('');setView(null)
      })}>确认身份并进入</button>
    </fieldset>}
    {view && !viewerKey && Boolean(view.hostSeats?.length) && <fieldset className="sf-open-table-card" disabled={busy} aria-label="真人主持入口"><legend>真人主持入口</legend>
      <p>主持席位与玩家角色分别确认。进入后可能显示主持专用资料。</p>
      <label>我的主持席位<select aria-label="我的主持席位" value={selectedHost} onChange={e => setSelectedHost(e.target.value)}><option value="">选择主持席位</option>{view.hostSeats.map(s => <option key={s.viewerKey} value={s.viewerKey}>真人主持</option>)}</select></label>
      <label><input type="checkbox" checked={hostAccepted} onChange={e => setHostAccepted(e.target.checked)} />我是本桌真人主持，已了解安全约定，可以查看主持专用资料。</label>
      <button disabled={!selectedHost || !hostAccepted} onClick={() => void perform(async () => {
        if (!view.sessionZeroComplete) await consentTtrpgOpenHostSeatV1({ scope: props.scope,sessionId,viewerKey: selectedHost })
        setManualDraft('');setDraft('');setView(null);setHostViewer(selectedHost)
      })}>确认主持身份并进入</button>
    </fieldset>}
    {view && viewerKey && !view.started && <fieldset disabled={busy} className="sf-open-table-card"><legend>{view.continuationOpening ? '确认续团开局' : '开团约定'}</legend>
      <p>{view.agreement.premise}</p>{view.continuationOpening && <p>承接到世界轮次 {view.continuationOpening.worldTurn}，保留 {view.continuationOpening.interruptedCount} 项中断行动及 {view.continuationOpening.unknownCount} 条未知结果。确认后按本桌新席位检查开局。</p>}<ul>{view.agreement.consentChecklist.map(item => <li key={item}>{item}</li>)}</ul>
      {view.agreement.lines.length > 0 && <p>不涉及：{view.agreement.lines.join('、')}</p>}{view.agreement.veils.length > 0 && <p>淡出处理：{view.agreement.veils.join('、')}</p>}
      <p>暂停信号：{view.agreement.pauseSignal}。其他真人也需要分别确认自己的角色。</p>
      <label><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />我确认以上约定，开始这场冒险。</label>
      <button disabled={!accepted} onClick={() => void perform(async () => { await startTtrpgOpenTableV1({ ...input(), acceptedItemKeys: view.requiredItemKeys });setNotice('冒险已经开始。') })}>{view.continuationOpening ? '确认续团开局' : '开始冒险'}</button>
    </fieldset>}
    {view?.sessionZeroComplete && viewerKey && props.state.ttrpg && 'openRun' in props.state.ttrpg && Boolean(props.state.ttrpg.openRun) && <TtrpgOpenTableConversation key={`${sessionId}:${viewerKey}`} input={input()} sequence={props.state.lastSequence} busy={busy} perform={job => perform(async () => { await job() })} />}
    {view?.sessionZeroComplete && viewerKey && props.state.ttrpg && 'openRun' in props.state.ttrpg && Boolean(props.state.ttrpg.openRun) && <TtrpgOpenMemoryPanel key={`memory:${sessionId}:${viewerKey}`} input={input()} sequence={props.state.lastSequence} busy={busy} perform={job => perform(() => job())} />}
    {view?.sessionZeroComplete && viewerKey && props.state.ttrpg && 'openRun' in props.state.ttrpg && Boolean(props.state.ttrpg.openRun) && <TtrpgOpenBriefPanel key={`brief:${sessionId}:${viewerKey}`} input={input()} sequence={props.state.lastSequence} busy={busy} perform={job => perform(signal => job(signal))} />}
    {view?.sessionZeroComplete && viewerKey && props.state.ttrpg && 'openRun' in props.state.ttrpg && Boolean(props.state.ttrpg.openRun) && <TtrpgOpenSituationPanel key={`situation:${sessionId}:${viewerKey}`} input={input()} sequence={props.state.lastSequence} busy={busy} perform={job => perform(async () => job())} />}
    {view?.sessionZeroComplete && viewerKey && props.state.ttrpg && 'openRun' in props.state.ttrpg && Boolean(props.state.ttrpg.openRun) && <TtrpgOpenPublicSituationPanel key={`public-situation:${sessionId}:${viewerKey}`} input={input()} sequence={props.state.lastSequence} busy={busy} perform={job => perform(async () => job())} />}
    {view?.sessionZeroComplete && viewerKey && props.state.ttrpg && 'openRun' in props.state.ttrpg && Boolean(props.state.ttrpg.openRun) && <TtrpgOpenConsultationPanel key={`consultation:${sessionId}:${viewerKey}`} open={consultationDisclosure.owner === consultationOwner && consultationDisclosure.open} onOpenChange={open => setConsultationDisclosure({ owner: consultationOwner, open })} input={input()} sequence={props.state.lastSequence} busy={busy} perform={job => perform(async () => job())} />}
    {/* The common desk revalidates its own owner and authority; table rereads keep the original request and review. */}
    {props.state.ttrpg?.product.sessionZero.completed && viewerKey && props.state.ttrpg && 'openRun' in props.state.ttrpg && Boolean(props.state.ttrpg.openRun) && <TtrpgOpenCommonOraclePanel key={`common-oracle:${sessionId}:${viewerKey}`} input={input()} sequence={props.state.lastSequence} busy={busy || !view?.sessionZeroComplete} perform={job => perform(async () => job())} />}
    {/* Audio validates its own current owner/authorization. A table reread must not discard the original voice task or candidate. */}
    {props.state.ttrpg?.product.sessionZero.completed && viewerKey && props.state.ttrpg && 'openRun' in props.state.ttrpg && Boolean(props.state.ttrpg.openRun) && <TtrpgOpenAudioPanel key={`audio:${sessionId}:${viewerKey}`} input={input()} sequence={props.state.lastSequence} paused={props.state.ttrpg.product.safety.status !== 'active'} busy={busy || !view?.sessionZeroComplete} onChanged={async () => { await props.onChanged(); await refresh() }} />}
    {view?.sessionZeroComplete && viewerKey && props.state.ttrpg && 'openRun' in props.state.ttrpg && Boolean(props.state.ttrpg.openRun) && <TtrpgOpenIdentityKnowledgePanel key={`identity:${sessionId}:${viewerKey}`} input={input()} sequence={props.state.lastSequence} busy={busy} onChanged={async () => { await props.onChanged(); await refresh() }} />}
    {view?.sessionZeroComplete && viewerKey && props.state.ttrpg && 'openRun' in props.state.ttrpg && Boolean(props.state.ttrpg.openRun) && <TtrpgOpenEntityPanel key={`entity:${sessionId}:${viewerKey}`} input={input()} sequence={props.state.lastSequence} busy={busy} perform={job => perform(async () => job())} />}
    {view?.sessionZeroComplete && viewerKey && props.state.ttrpg && 'openRun' in props.state.ttrpg && Boolean(props.state.ttrpg.openRun) && <TtrpgOpenWorldPatchPanel key={`patch:${sessionId}:${viewerKey}`} input={input()} sequence={props.state.lastSequence} busy={busy} perform={job => perform(async () => job())} />}
    {p && <>
      {!p.passiveRecap && (p.hosting?.canDelegate || p.hosting?.permission) && <section className="sf-open-table-card" aria-label="本轮自动主持">
        <h2>本轮自动主持</h2>
        <p>沿用本轮剩余额度，推进已确认行动、安全队友协作和已结算结果的 KP 叙述。风险、选择和权限问题交回真人。</p>
        {p.hosting.canDelegate && <>
          <label>自动主持每次调用预留上限（美元）<input type="number" min="0" step="0.01" value={costLimit} disabled={busy} onChange={e => setCostLimit(e.target.value)} /></label>
          <label><input type="checkbox" checked={hostingAccepted} disabled={busy} onChange={e => setHostingAccepted(e.target.checked)} />我委托本轮有限主持，保留随时停止和亲自确认风险的决定权。</label>
          <button disabled={busy || !hostingAccepted || view.safetyStatus === 'paused' || p.blockedByModel || p.remainingCalls <= 0} onClick={() => void continueHosting(true)}>委托本轮自动主持</button>
        </>}
        {p.hosting.canResume && <>
          <button disabled={busy || view.safetyStatus === 'paused'} onClick={() => void continueHosting(false)}>继续本轮自动主持</button>
          <button disabled={hostingStopping} onClick={() => void stopHosting()}>{hostingStopping ? '正在保存停止决定…' : '停止本轮自动主持'}</button>
        </>}
        {p.hosting.permission?.stoppedRef && <p role="status">本轮自动主持已停止。可继续处理已保存的进度；新的自动主持需要明确开始下一轮。</p>}
      </section>}
      {p.blockedByEntity && <p role="status">请先在本局对象面板确认或放弃当前计划。</p>}
      {p.canHumanHost && props.session.productReleaseId != null && <TtrpgOpenContinuationPanel input={input()} sequence={view.sequence} busy={busy} perform={job => perform(async () => { await job() })} />}
      {p.stageStatus === 'closed' && <TtrpgOpenStageOpeningPanel input={input()} sequence={view.sequence} busy={busy} perform={job => perform(async () => { await job() })} />}
      {p.stageStatus === 'closed' && <p role="status">本阶段已明确收束；请完成剩余后果与叙述，并保存进度。</p>}
      <div className="sf-open-table-toolbar"><span>{p.view.self.name} · 世界轮次 {p.view.authority.worldTurn}</span><span>{p.passiveRecap ? p.passivePurpose === 'situation-generation' ? '当前正在拟定新局势' : '当前为阶段复盘' : <>本轮剩余请求额度：{p.remainingCalls}</>}</span>
        <button disabled={busy} onClick={() => void perform(async () => {})}>读取最新进度</button>
        <button disabled={busy} onClick={() => void perform(async () => { await changeTtrpgOpenTableSafetyV1({ ...input(), status: view.safetyStatus === 'paused' ? 'active' : 'paused', reason: view.safetyStatus === 'paused' ? '真人明确恢复冒险' : '真人使用安全暂停' }) })}>{view.safetyStatus === 'paused' ? '恢复冒险' : '暂停冒险'}</button>
        <button disabled={busy} onClick={() => { ++revision.current;activeViewer.current = '';setViewerKey('');setSelected('');setView(null);setDraft('');setManualDraft('');setError('');setNotice('') }}>交接给另一位玩家</button>
        <button disabled={busy} onClick={() => void perform(async () => { await props.onCheckpoint(`开放冒险 · 第 ${p.view.authority.worldTurn} 轮`);setNotice('进度已保存。') })}>保存进度</button>
      </div>
      <details className="sf-open-table-card"><summary>我的角色与私密资料</summary><p>{p.view.self.playerProfile?.privateGoal}</p><p>{p.view.self.playerProfile?.secret}</p><p>{p.view.self.playerProfile?.portrayal}</p></details>
      <section className="sf-open-table-card" aria-label="我的当前状态"><h2>我的当前状态</h2>
        <p>{p.liveCharacter.resources.map(r => `${r.name}：${r.value ?? '未记录'}`).join('；')}</p>
        <p>状态：{p.liveCharacter.conditions.length ? p.liveCharacter.conditions.map(c => `${c.name} ${c.stacks} 层${c.remainingRounds === null ? '' : `（剩余 ${c.remainingRounds} 轮）`}`).join('；') : '无附加状态'}</p>
        {p.liveCharacter.abilities.filter(a => a.remainingUses !== null || a.cooldownUntilRound !== null).map(a => <p key={a.key}>{a.name}{a.remainingUses !== null ? `：剩余 ${a.remainingUses} 次` : ''}{a.cooldownUntilRound !== null ? `；冷却至第 ${a.cooldownUntilRound} 轮` : ''}</p>)}
        <p>随身物品：{p.liveCharacter.inventory.length ? p.liveCharacter.inventory.map(i => `${i.name} ×${i.quantity}${i.charges === null ? '' : `（充能 ${i.charges}）`}${i.durability === null ? '' : `（耐久 ${i.durability}）`}`).join('；') : '无'}</p>
      </section>
      <section className="sf-open-table-card" aria-label="冒险记录"><h2>冒险记录</h2>{p.narrations.length ? p.narrations.map(n => <article key={n.key}>{n.paragraphs.map((text, i) => <p key={i}>{text}</p>)}{n.sourceKind === 'human' && <small>真人主持补写{n.unresolvedModelResult ? '；原模型发送结果仍未知，原用量和费用记录继续保留。' : ''}</small>}</article>) : <p>行动结算后的 KP 叙述会保存在这里。</p>}
        {p.view.pressureSignals.map((s, i) => <p key={i}>征兆：{s.signalText}</p>)}
      </section>
      <section className="sf-open-table-card" aria-label="当前可知线索与方向"><h2>眼前的线索与方向</h2>
        {p.affordances.map(point => <article key={point.key}><p><strong>{point.label}</strong> · {point.hint}</p>{point.actions.length > 0 && <p>可以尝试：{point.actions.join('、')}</p>}</article>)}
        {p.view.knowledge.map((clue, i) => <article key={`${clue.evidenceRef}:${i}`}><h3>{clue.title}</h3><p>{clue.description}</p><p>{clue.reliability === 'observed' ? '亲自观察所得' : clue.reliability === 'hearsay' ? '转述消息，尚需核实' : '角色判断，尚需验证'}</p></article>)}
        {!p.affordances.length && !p.view.knowledge.length && <p>当前没有新的可见线索；可以继续观察现场或与同伴交谈。</p>}
      </section>
      {view.safetyStatus === 'paused' && <p role="status">冒险已暂停。现有进度会保留，恢复前不会继续行动。</p>}
      {p.pendingRejections.map(receipt => <aside className="sf-open-table-card" key={receipt.requestKey}><p>行动建议已放弃，保存回执还需要补齐；不会重新执行或重新调用模型。</p><button disabled={busy} onClick={() => void perform(async () => { await rejectTtrpgOpenTableIntentV1({ ...input(), ...receipt }) })}>补齐放弃记录</button></aside>)}
      {p.pendingCancellations.map(requestKey => <aside className="sf-open-table-card" key={requestKey}><p>尚未发送的请求已取消，停止回执需要补齐。</p><button disabled={busy} onClick={() => void perform(async () => { await cancelTtrpgOpenTablePreparedRequestV1({ ...input(), requestKey }) })}>补齐请求取消回执</button></aside>)}
      {p.modelNarrationRepairs.map(receipt => <aside className="sf-open-table-card" key={receipt.requestKey}><p>KP 叙述已保存，最终采用回执需要补齐；不会重发模型。</p><button disabled={busy} onClick={() => void perform(async () => { await repairTtrpgOpenTableModelNarrationV1({ ...input(), ...receipt }) })}>补齐 KP 叙述回执</button></aside>)}
      {p.semanticIntentRepairs.map(receipt => <aside className="sf-open-table-card" key={receipt.requestKey}><p>{receipt.actorName}的行动提案已接纳，生成任务的回执需要补齐。提案回执不代表风险批准或行动结算。</p><button disabled={busy} onClick={() => void perform(async () => { await repairTtrpgOpenTableIntentV1({ ...input(), ...receipt }) })}>补齐行动提案回执</button></aside>)}
      {p.humanNarrationRepairs.map(operationKey => <aside className="sf-open-table-card" key={operationKey}><p>人工叙述已保存，原模型候选的停止回执尚待补齐。</p><button disabled={busy} onClick={() => void perform(async () => { await repairTtrpgOpenTableHumanNarrationV1({ ...input(), operationKey }) })}>补齐人工叙述回执</button></aside>)}
      <fieldset className="sf-open-table-actions" disabled={view.safetyStatus === 'paused' || p.passiveRecap}>
      <section className="sf-open-table-card"><h2>模型使用了哪些资料</h2>
        <button disabled={busy} onClick={() => void perform(async () => { const trace = await readTtrpgOpenTableContextTraceV1(input());setContextTrace(trace);if (!trace) setNotice('当前身份还没有模型请求记录。') })}>查看最近一次上下文记录</button>
        {contextTrace?.generation === 'legacy' && <p>这是较早的请求，保留原有上下文证据，没有分层预算记录。</p>}
        {contextTrace?.generation === 'p7' && <div aria-label="实际上下文记录">{contextTrace.historical && <p>这是导入前的原始记录。尚未发送的请求可以明确取消；新的 AI 请求需要当前玩家重新授权。</p>}<p>第 {contextTrace.worldTurn} 轮请求：实际交付 {contextTrace.resourceCount} 条资料、{contextTrace.contextTokens} 个正文 token；上下文上限 {contextTrace.budgetTokens}，采用 {contextTrace.triggerCount} 条情境指引。</p>
          <ul>{contextTrace.tiers.filter(tier => tier.tokens > 0 || tier.omitted).map(tier => <li key={tier.tierKey}>{{ rules: '规则', 'authority-state': '权限与当前状态', 'active-situations': '当前预警', 'known-facts': '已知资料', 'recent-events': '近期叙述', 'memory-summary': '记忆摘要', 'dynamic-injection': '情境指引', flavor: '氛围资料' }[tier.tierKey]}：{tier.omitted ? '本次预算内未交付' : `${tier.tokens} 个正文 token`}</li>)}</ul>
          <details><summary>查看实际资料与触发依据</summary>
            <ul aria-label="实际交付资料">{contextTrace.inspection.resources.map(row => <li key={row.label}>{row.label} · {row.category} · {row.source} · {row.origin} · {row.tokens} 个正文 token</li>)}</ul>
            {contextTrace.inspection.injections.length > 0 && <ul aria-label="实际指引触发依据">{contextTrace.inspection.injections.map(row => <li key={row.label}>{row.label}：{row.reason}</li>)}</ul>}
            {contextTrace.inspection.omissions.length > 0 && <ul aria-label="本次资料省略原因">{contextTrace.inspection.omissions.map(row => <li key={row.category}>{row.category}：{row.reason}，仅交付预算允许的完整条目。</li>)}</ul>}
          </details>
          <p>记录已与原请求和实际读取回执核对。列出的资料均来自当时的实际读取，不代表当前仍授权再次发送。情境指引和历史叙述不会自动成为规则、事实或角色知识。</p></div>}
      </section>
      {p.requests.length > 0 && <aside className="sf-open-table-card"><h2>模型请求进度</h2>{p.requests.map(r => <p key={r.requestKey}>{r.purpose}：{r.status === 'unknown' ? '发送结果未知，请先核对原请求；不会自动重发。' : r.status === 'prepared' ? '请求已准备，尚未发送。' : r.status === 'dispatched' ? '已发送，正在等待原请求结果。' : '请求已停止，请检查配置或已有错误。'}{r.status === 'prepared' && <button disabled={busy} onClick={() => void perform(async () => { await cancelTtrpgOpenTablePreparedRequestV1({ ...input(), requestKey: r.requestKey }) })}>取消尚未发送的请求</button>}</p>)}</aside>}
      <TtrpgOpenHistoricalResponses key={`history:${sessionId}:${viewerKey}:${view.sequence}`} input={input()} entries={p.historicalResponses ?? []} busy={busy} perform={job => perform(() => job())} />
      {(p.candidateRecoveries ?? []).map(saved => <section className="sf-open-table-card" key={saved.requestKey} aria-label="待恢复的模型回复">
        <p>{saved.purpose}的回复已保存，整理结果时发生中断。恢复会沿用原回复和原用量。</p>
        <button disabled={busy} onClick={() => void perform(async () => {
          await recoverTtrpgOpenTableResponseV1({ ...input(), runId: saved.runId, requestKey: saved.requestKey })
          setNotice('已恢复保存的回复，请检查结果后再确认。')
        })}>恢复已保存的回复</button>
      </section>)}
      {p.candidates.map(candidate => <section className="sf-open-table-card" key={candidate.candidateHash} aria-label="待确认候选"><h2>{candidate.schema === 'storyforge.ttrpg-open-kp-candidate' ? '本次 KP 叙述' : '待确认的行动意图'}</h2>
        {candidate.schema === 'storyforge.ttrpg-open-kp-candidate' ? candidate.narration?.paragraphs.map((paragraph, i) => <p key={i}>{paragraph.text}</p>) : <TtrpgOpenIntentReview input={input()} sequence={view.sequence} candidate={candidate} busy={busy} perform={job => perform(() => job())} />}
        {candidate.schema === 'storyforge.ttrpg-open-kp-candidate' && (['ready', 'usable-with-warnings'].includes(candidate.artifact.status) ? <button disabled={busy} onClick={() => void perform(async () => {
          await acceptTtrpgOpenTableCandidateV1({ ...input(), runId: candidate.runId, requestKey: candidate.requestKey, candidateHash: candidate.candidateHash, kind: candidate.schema === 'storyforge.ttrpg-open-kp-candidate' ? 'kp' : 'intent' })
        })}>确认这份{candidate.schema === 'storyforge.ttrpg-open-kp-candidate' ? '叙述' : '行动意图'}</button> : <><p>这份结果需要修订，尚不能执行；原始响应已经保留。</p>
          {candidate.artifact.issues.filter(issue => issue.disposition === 'blocking').map(issue => <p key={`${issue.code}:${issue.path}`} role="alert">{issue.message}</p>)}</>)}
      </section>)}
      {op && <section className="sf-open-table-card" aria-label="当前行动"><h2>{op.ruleLabel}</h2><p>行动者：{op.actorName}；目标：{op.targetName ?? '目标尚未公开，需先详细审查'}。</p><p>当前步骤：{labels[op.nextStepKey?.split('.')[0] ?? ''] ?? '等待行动确认'}</p><p>耗时：{op.timeCostWorldTurns} 个世界轮次。</p>
        {p.gateRecovery && <section aria-label="冒险继续条件"><h3>冒险继续条件</h3>
          {p.gateRecovery.status === 'stopped' ? <p role="status">这次有限修复后仍无法安全继续，本轮主持已停止。已完成的行动和进度会保留，请保存进度。{p.gateRecovery.needsAuthorReview ? '此问题已连续发生，需要作品作者审阅。' : '后续由真人检查本场冒险的继续条件。'}</p> : <>
            <p>目前还缺少可继续冒险的条件。可以请求一次规则允许的局势或补充线索修复；不会重掷、扣角色资源或推进时间。</p>
            {p.gateRecovery.canAttempt && <button disabled={busy || p.hasPendingModelRequest} onClick={() => void perform(async () => { const result = await recoverTtrpgOpenTableGatesV1({ ...input(),operationKey: op.operationKey,proof: p.gateRecovery!.proof });setNotice(result.status === 'gate-recovery-stopped' ? '本轮主持已停止，已提交进度保留。' : result.status === 'awaiting-human-response' ? '请求已保存，请交回本轮发起人继续检查。' : '修复结果已保存，继续条件已重新检查。') })}>尝试一次有限修复</button>}
            {p.gateRecovery.status === 'attempted' && <p>已尝试过一次，请继续检查结果；不会再次投放局势或线索。</p>}
            {!p.gateRecovery.canAttempt && p.gateRecovery.status === 'awaiting' && <p>当前需要相关玩家亲自回应，请交接给该玩家。</p>}
          </>}
        </section>}
        <section aria-label="本次行动风险与后果"><h3>本次行动风险与后果</h3>
          {op.risk.lines.map((line, i) => <p key={i}>{line}</p>)}
          {op.risk.templates.map((t, i) => <div key={`${t.templateKey}:${i}`}><p>{t.when}的后果：</p>{t.lines.map((line, n) => <p key={n}>{line}</p>)}{t.alternatives.map(a => <p key={a.alternativeKey}>可选「{a.title}」：{a.lines.join('；') || '不追加效果'}</p>)}</div>)}
          {!op.risk.lines.length && !op.risk.templates.length && <p>行动规则没有直接的资源或能力消耗；世界时间按上方规则推进，后续世界变化的后果另行确认。</p>}
          {op.risk.blockers.map(line => <p key={line}>{line}</p>)}
          {op.risk.privateRoll && <p>本次采用保密裁定；这里不显示骰点或由结果决定的选项。若需要选择后果，请由主持人确认。</p>}
        </section>
        {op.requiresDetailedReview && <p>本行动还有需要逐项审查的规则后果，请先完成详细审查。</p>}
        {op.status === 'awaiting-approval' && op.approvals.map(a => <div key={a.actorKey}><p>需要确认：{a.name}</p><button disabled={busy || op.requiresDetailedReview} onClick={() => void perform(async () => { await confirmTtrpgOpenTableRiskV1({ ...input(), operationKey: op.operationKey, actorKey: a.actorKey, decision: 'approve', riskHash: op.riskHash }) })}>同意以上风险与代价</button><button disabled={busy} onClick={() => void perform(async () => { await confirmTtrpgOpenTableRiskV1({ ...input(), operationKey: op.operationKey, actorKey: a.actorKey, decision: 'reject', riskHash: op.riskHash }) })}>拒绝本次行动</button></div>)}
        {p.canHumanHost && op.risk.privateRoll && ['effect','knowledge'].includes(op.nextStepKey ?? '') && <TtrpgOpenPrivateChoicePanel input={input()} operationKey={op.operationKey} sequence={view.sequence} busy={busy} perform={job => perform(async () => { await job() })} />}
        <TtrpgOpenConsequencePanel key={`${viewerKey}:${op.operationKey}`} input={input()} player={p} sequence={view.sequence} busy={busy} perform={job => perform(async () => { await job() })} />
        {p.preauthorizationAvailable && <button disabled={busy} onClick={() => void perform(async () => { await preauthorizeTtrpgOpenTableCompanionV1({ ...input(), operationKey: op.operationKey }) })}>按开团时已允许的范围执行队友行动</button>}
        {op.risk.choices.map(c => <fieldset key={`${c.kind}:${c.templateKey}`} disabled={busy || !c.canChoose}><legend>{c.kind === 'knowledge' ? '确认发现线索的代价' : '确认本次行动后果'}</legend>{c.alternatives.map(a => <div key={a.alternativeKey}><p>{a.title}：{a.lines.join('；') || '不追加效果'}</p><button onClick={() => void perform(async () => { await chooseTtrpgOpenTableConsequenceV1({ ...input(), operationKey: op.operationKey, kind: c.kind, templateKey: c.templateKey, alternativeKey: a.alternativeKey, riskHash: op.riskHash, ...(c.disclosureHash ? { disclosureHash: c.disclosureHash } : {}) });setNotice('选择已保存；继续结算后才会应用对应后果。') })}>选择「{a.title}」</button></div>)}</fieldset>)}
        {op.status === 'executing' && op.isStarter && <button disabled={busy} onClick={() => void perform(async () => { const result = await resumeTtrpgOpenTableV1({ ...input(), operationKey: op.operationKey });setNotice(waits[result.status] ?? (result.status === 'awaiting-narration' ? '行动已结算，可以生成本次 KP 叙述。' : '进度已保存。')) })}>继续结算已确认的行动</button>}
        {op.nextStepKey === 'narration' && !op.narrationRecorded && p.canHumanHost && <details className="sf-open-table-manual"><summary>改由真人主持补写叙述</summary>
          <p>仅补写全队已知的行动结果；不会重掷或修改规则事实。原模型候选、用量和失败记录会保留，本次人工稿将成为正式叙述。</p>
          <label>补写原因<select aria-label="补写原因" value={manualReason} onChange={e => setManualReason(e.target.value as typeof manualReason)}><option value="host-authored">由真人主持撰写</option><option value="budget-exhausted">本轮模型预算不足</option><option value="model-unavailable">模型不可用或结果未知</option><option value="replace-candidate">放弃原模型叙述，采用人工稿</option></select></label>
          <label>人工叙述<textarea aria-label="人工叙述" maxLength={16000} value={manualDraft} onChange={e => setManualDraft(e.target.value)} /></label>
          {p.hasPendingModelRequest && <p>请先取消尚未发送的请求，或核对已发送请求的结果；不能并行替换。</p>}
          <button disabled={busy || p.hasPendingModelRequest || !manualDraft.trim()} onClick={() => void perform(async () => { await recordTtrpgOpenTableHumanNarrationV1({ ...input(), operationKey: op.operationKey, text: manualDraft, reason: manualReason });setManualDraft('');setNotice('人工叙述已保存；原模型记录会继续保留。') })}>确认保存人工叙述</button>
        </details>}
        {op.nextStepKey === 'narration' && !op.narrationRecorded && p.canRequestKp && p.hostingAllowed && <button disabled={busy || p.blockedByModel || p.remainingCalls <= 0 || p.candidates.length > 0} onClick={() => void request('kp')}>生成本次 KP 叙述</button>}
      </section>}
      {!op && !p.blockedByEntity && !p.manualEpoch && p.isEpochStarter && p.handoff?.kind === 'companion-ready' && <button disabled={busy || p.stageStatus === 'closed' || p.blockedByModel || p.remainingCalls <= 0 || p.candidates.length > 0} onClick={() => void request('companion', p.handoff!.actorKey!)}>请下一位 AI 队友提出行动</button>}
      {!op && !p.blockedByEntity && !p.passiveRecap && p.epochKey && p.isEpochStarter && <button disabled={busy || p.hasPendingModelRequest || p.candidates.length > 0 || (p.candidateRecoveries?.length ?? 0) > 0} onClick={() => void perform(async () => { await finishTtrpgOpenTableWindowV1(input());setDraft('');setNotice('本轮主持已结束，可以输入下一次行动。') })}>{p.hasUnknownModelResult ? '明确停止本轮授权，保留未知请求记录' : '结束本轮主持，准备下一次行动'}</button>}
      {!op && p.manualActionPending && <aside className="sf-open-table-card"><p>本人的人工行动已授权，提案回执尚需补齐；不会新开授权或调用模型。</p><button disabled={busy} onClick={() => void perform(async () => { await resumeTtrpgOpenManualActionV1({ ...input(),epochKey: p.manualActionPending!.epochKey }) })}>继续提交已授权的人工行动</button></aside>}
      {!op && !p.epochKey && p.stageStatus === 'open' && <TtrpgOpenManualAction key={`${sessionId}:${viewerKey}`} input={input()} sequence={view.sequence} busy={busy} perform={job => perform(async () => { await job() })} />}
      {!op && <fieldset disabled={busy || p.stageStatus === 'closed' || p.blockedByModel || p.candidates.length > 0 || p.remainingCalls <= 0 || !p.aiAllowed || Boolean(p.epochKey)} className="sf-open-table-card"><legend>我想采取的行动</legend>
        <label>行动意图<textarea aria-label="行动意图" value={draft} onChange={e => setDraft(e.target.value)} placeholder="描述你想做什么、使用什么方法…" /></label>
        <button disabled={!draft.trim()} onClick={() => void request('intent')}>请 KP 整理行动意图</button>
      </fieldset>}
      <label>本次模型调用预算预留（美元）<input aria-label="本次模型调用预算预留" type="number" min="0" max="1000" step="0.01" value={costLimit} disabled={busy} onChange={e => setCostLimit(e.target.value)} /></label>
      <p>这是本轮的预算预留；实际费用未知时会保留为未知，不等于供应方账单。</p>
      {!p.aiAllowed && p.gateRecovery?.status !== 'stopped' && <p>本角色尚未允许 AI 建议，或该作品尚未启用 AI 主持。</p>}
      </fieldset>
    </>}
    {busy && <div role="status"><p>正在保存或处理当前操作…</p><button disabled={hostingStopping || Boolean(hostingSignal.current && !p?.hosting?.permission)} onClick={() => hostingSignal.current && hostingSignal.current === controller.current?.signal ? void stopHosting() : controller.current?.abort()}>{hostingSignal.current ? '停止自动主持并保留进度' : '停止等待'}</button></div>}
  </section>
}
