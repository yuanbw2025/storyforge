import TtrpgOpenContinuationPanel from './TtrpgOpenContinuationPanel'
import TtrpgOpenStageOpeningPanel from './TtrpgOpenStageOpeningPanel'
import TtrpgOpenBriefPanel from './TtrpgOpenBriefPanel'
import TtrpgOpenEntityPanel from './TtrpgOpenEntityPanel'
import TtrpgOpenFactPanel from './TtrpgOpenFactPanel'
import TtrpgOpenConsultationPanel from './TtrpgOpenConsultationPanel'
import TtrpgOpenOracleModelPanel from './TtrpgOpenOracleModelPanel'
import TtrpgOpenNormalizationModelPanel from './TtrpgOpenNormalizationModelPanel'
import TtrpgOpenSituationPanel from './TtrpgOpenSituationPanel'
import TtrpgOpenWorldPatchPanel from './TtrpgOpenWorldPatchPanel'
import TtrpgOpenHistoricalResponses from './TtrpgOpenHistoricalResponses'
import TtrpgOpenMemoryPanel from './TtrpgOpenMemoryPanel'
import TtrpgOpenAudioPanel from './TtrpgOpenAudioPanel'
import TtrpgNarrationListeningSettings from './TtrpgNarrationListeningSettings'
import TtrpgOpenIdentityKnowledgePanel from './TtrpgOpenIdentityKnowledgePanel'
import TtrpgOpenTableConversation from './TtrpgOpenTableConversation'
import TtrpgOpenPrivateChoicePanel from './TtrpgOpenPrivateChoicePanel'
import { useCallback,useEffect,useLayoutEffect,useRef,useState } from 'react'
import type { TtrpgPlayTablePropsV1 } from './TtrpgOpenPlayTable'
import { readTtrpgOpenHostTableV1,startTtrpgOpenTableV1,changeTtrpgOpenTableSafetyV1,
  recordTtrpgOpenTableHumanNarrationV1,repairTtrpgOpenTableHumanNarrationV1,resumeTtrpgOpenTableV1,
  confirmTtrpgOpenHostRiskV1,chooseTtrpgOpenTableConsequenceV1,recoverTtrpgOpenTableGatesV1,finishTtrpgOpenTableWindowV1,
  type TtrpgOpenHostTableViewV1 } from '../../lib/ttrpg/open-table-service'
import TtrpgOpenConsequencePanel from './TtrpgOpenConsequencePanel'
import { readTtrpgOpenSettledViewV1 } from '../../lib/ttrpg/open-read-conflict'

const steps: Record<string,string> = { rule: '规则裁定',mechanics: '规则后果',effect: '行动后果',time: '世界时间',knowledge: '线索发现',pressure: '威胁推进',situations: '局势变化',terminal: '阶段检查',gates: '继续冒险的条件',narration: '主持叙述',handoff: '下一位行动者' }
export default function TtrpgOpenHostTable(props: TtrpgPlayTablePropsV1 & { viewerKey: string; onExit: () => void }) {
  const [view,setView] = useState<TtrpgOpenHostTableViewV1 | null>(null),[error,setError] = useState(''),[notice,setNotice] = useState(''),[busy,setBusy] = useState(false)
  const [accepted,setAccepted] = useState(false),[draft,setDraft] = useState('')
  const live = useRef(true),generation = useRef(0),locked = useRef(false)
  const { projectId,worldId,workId } = props.scope,sessionId = props.session.id!,viewerKey = props.viewerKey
  const authorityKey = JSON.stringify([props.session.runtimeSourceHash, props.state.ttrpg && 'authorization' in props.state.ttrpg ? props.state.ttrpg.authorization : null])
  const input = useCallback(() => ({ scope: { projectId,worldId,workId },sessionId,viewerKey }),[projectId,worldId,workId,sessionId,viewerKey])
  const refresh = useCallback(async () => {
    const token = ++generation.current
    try { const next = await readTtrpgOpenSettledViewV1(() => readTtrpgOpenHostTableV1(input()), () => live.current && token === generation.current);if (next && live.current && token === generation.current) setView(next) }
    catch (e) { if (live.current && token === generation.current) { setView(null);setError(e instanceof Error ? e.message : String(e)) } }
  },[input])
  useLayoutEffect(() => { live.current = true;setView(null);return () => { live.current = false;generation.current += 1 } },[refresh,authorityKey])
  useEffect(() => { void refresh() },[refresh,authorityKey,props.state.lastSequence])
  const perform = async (job: () => Promise<void>) => {
    if (locked.current) return
    locked.current = true;setBusy(true);setError('');setNotice('');props.onBusyChange?.(true)
    try { await job() } catch (e) { if (live.current) setError(e instanceof Error ? e.message : String(e)) }
    finally {
      locked.current = false
      if (live.current) {
        setBusy(false);props.onBusyChange?.(false)
        try { await props.onChanged();await refresh() } catch (e) { setView(null);setError(`进度暂时无法读取：${String(e)}`) }
      }
    }
  }
  const host = view?.host,op = host?.operation
  return <section className="sf-open-table" data-testid="ttrpg-open-host-table">
    <header><p className="sf-open-table-preview">开放跑团 · 开发预览</p><h1>真人主持桌面</h1><p>{view?.title ?? props.session.title}</p>
      <p>此处可能显示主持专用资料。交接给玩家前，请返回身份选择。</p>
      <button disabled={busy} onClick={props.onExit}>返回身份选择</button></header>
    <TtrpgNarrationListeningSettings key={`listening:${sessionId}:${viewerKey}`} paused={props.state.ttrpg?.product.safety.status !== 'active'}/>
    {error && <div role="alert">{error}</div>}{notice && <p role="status">{notice}</p>}
    <button disabled={busy} onClick={() => { setError('');void refresh() }}>读取主持最新进度</button>
    {!view && !error && <p role="status">正在读取主持进度…</p>}
    {view && !view.started && <fieldset className="sf-open-table-card" disabled={busy}><legend>{view.continuationOpening ? '主持确认续团开局' : '主持确认开团'}</legend>
      <p>{view.agreement.premise}</p>{view.continuationOpening && <p>承接到世界轮次 {view.continuationOpening.worldTurn}，保留 {view.continuationOpening.interruptedCount} 项中断行动及 {view.continuationOpening.unknownCount} 条未知结果。确认后按本桌新席位检查开局。</p>}<ul>{view.agreement.consentChecklist.map(s => <li key={s}>{s}</li>)}</ul>
      <p>不涉及：{view.agreement.lines.join('、') || '按本桌约定'}；淡出处理：{view.agreement.veils.join('、') || '按本桌约定'}；暂停信号：{view.agreement.pauseSignal}</p>
      <p>每位真人须分别认领并确认自己的席位。</p><label><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />我确认以上开团约定。</label>
      <button disabled={!accepted} onClick={() => void perform(async () => { await startTtrpgOpenTableV1({ ...input(),acceptedItemKeys: view.requiredItemKeys }) })}>{view.continuationOpening ? '确认续团开局' : '由真人主持开始冒险'}</button>
    </fieldset>}
    {host && <TtrpgOpenHistoricalResponses key={`history:${sessionId}:${viewerKey}:${props.state.lastSequence}`} input={input()} entries={host.historicalResponses ?? []} busy={busy} perform={perform} />}
    {view?.sessionZeroComplete && props.state.ttrpg && 'openRun' in props.state.ttrpg && Boolean(props.state.ttrpg.openRun) && <TtrpgOpenMemoryPanel key={`memory:${sessionId}:${viewerKey}`} input={input()} sequence={props.state.lastSequence} busy={busy} perform={perform} />}
    {/* Audio validates its own current owner/authorization. A table reread must not discard the original voice task or candidate. */}
    {props.state.ttrpg?.product.sessionZero.completed && props.state.ttrpg && 'openRun' in props.state.ttrpg && Boolean(props.state.ttrpg.openRun) && <TtrpgOpenAudioPanel key={`audio:${sessionId}:${viewerKey}`} input={input()} sequence={props.state.lastSequence} paused={props.state.ttrpg.product.safety.status !== 'active'} busy={busy || !view?.sessionZeroComplete} onChanged={async () => { await props.onChanged(); await refresh() }} />}
    {view?.sessionZeroComplete && props.state.ttrpg && 'openRun' in props.state.ttrpg && Boolean(props.state.ttrpg.openRun) && <TtrpgOpenConsultationPanel key={`consultation:${sessionId}:${viewerKey}`} input={input()} sequence={props.state.lastSequence} busy={busy} perform={perform} />}
    {view?.sessionZeroComplete && props.state.ttrpg && 'openRun' in props.state.ttrpg && Boolean(props.state.ttrpg.openRun) && <TtrpgOpenIdentityKnowledgePanel key={`identity:${sessionId}:${viewerKey}`} input={input()} sequence={props.state.lastSequence} busy={busy} onChanged={async () => { await props.onChanged(); await refresh() }} />}
    {view?.sessionZeroComplete && props.state.ttrpg && 'openRun' in props.state.ttrpg && Boolean(props.state.ttrpg.openRun) && <TtrpgOpenBriefPanel key={`brief:${sessionId}:${viewerKey}`} input={input()} sequence={props.state.lastSequence} busy={busy} perform={perform} />}
    {view?.sessionZeroComplete && props.state.ttrpg && 'openRun' in props.state.ttrpg && Boolean(props.state.ttrpg.openRun) && <TtrpgOpenSituationPanel key={`situation:${sessionId}:${viewerKey}`} input={input()} sequence={props.state.lastSequence} busy={busy} perform={perform} />}
    {view?.sessionZeroComplete && props.state.ttrpg && 'openRun' in props.state.ttrpg && Boolean(props.state.ttrpg.openRun) && <TtrpgOpenEntityPanel key={`entity:${sessionId}:${viewerKey}`} input={input()} sequence={props.state.lastSequence} busy={busy} perform={perform} />}
    {view?.sessionZeroComplete && props.state.ttrpg && 'openRun' in props.state.ttrpg && Boolean(props.state.ttrpg.openRun) && <TtrpgOpenFactPanel key={`fact:${sessionId}:${viewerKey}`} input={input()} sequence={props.state.lastSequence} busy={busy} perform={perform} />}
    {view?.sessionZeroComplete && props.state.ttrpg && 'openRun' in props.state.ttrpg && Boolean(props.state.ttrpg.openRun) && <TtrpgOpenOracleModelPanel key={`oracle-fact:${sessionId}:${viewerKey}`} input={input()} sequence={props.state.lastSequence} busy={busy} perform={perform} />}
    {view?.sessionZeroComplete && props.state.ttrpg && 'openRun' in props.state.ttrpg && Boolean(props.state.ttrpg.openRun) && <TtrpgOpenNormalizationModelPanel key={`normalize-fact:${sessionId}:${viewerKey}`} input={input()} sequence={props.state.lastSequence} busy={busy} perform={perform} />}
    {view?.sessionZeroComplete && props.state.ttrpg && 'openRun' in props.state.ttrpg && Boolean(props.state.ttrpg.openRun) && <TtrpgOpenWorldPatchPanel key={`patch:${sessionId}:${viewerKey}`} input={input()} sequence={props.state.lastSequence} busy={busy} perform={perform} />}
    {view?.sessionZeroComplete && props.state.ttrpg && 'openRun' in props.state.ttrpg && Boolean(props.state.ttrpg.openRun) && <TtrpgOpenTableConversation key={`${sessionId}:${viewerKey}`} input={input()} sequence={props.state.lastSequence} busy={busy} perform={job => perform(async () => { await job() })} />}
    {host && <>
      <div className="sf-open-table-toolbar"><span>世界轮次 {host.worldTurn} · {host.stageStatus === 'closed' ? '阶段已收束' : '阶段进行中'}</span>
        <button disabled={busy} onClick={() => void perform(async () => { await changeTtrpgOpenTableSafetyV1({ ...input(),status: view.safetyStatus === 'paused' ? 'active' : 'paused',reason: view.safetyStatus === 'paused' ? '真人主持明确恢复' : '真人主持使用安全暂停' }) })}>{view.safetyStatus === 'paused' ? '主持恢复冒险' : '主持暂停冒险'}</button>
        <button disabled={busy} onClick={() => void perform(async () => { await props.onCheckpoint(`真人主持 · 世界轮次 ${host.worldTurn}`) })}>保存主持检查点</button>
      </div>
      {props.session.productReleaseId != null && <TtrpgOpenContinuationPanel input={input()} sequence={view.sequence} busy={busy} perform={perform} />}
      {host.stageStatus === 'closed' && <TtrpgOpenStageOpeningPanel input={input()} sequence={view.sequence} busy={busy} perform={perform} />}
      {view.safetyStatus === 'paused' && <p role="status">冒险已暂停，现有进度保留。</p>}
      <section className="sf-open-table-card" aria-label="主持冒险记录"><h2>全队冒险记录</h2>{host.narrations.map(n => <article key={n.key}>{n.paragraphs.map((text,i) => <p key={i}>{text}</p>)}</article>)}</section>
      <section className="sf-open-table-card" aria-label="主持当前局势"><h2>当前局势</h2>{host.situations.map(s => <p key={s.key}>{s.title}</p>)}</section>
      {host.humanNarrationRepairs.map(operationKey => <aside className="sf-open-table-card" key={operationKey}><p>主持叙述已保存，原模型候选的停止回执需要补齐；不会重新发送请求。</p><button disabled={busy} onClick={() => void perform(async () => { await repairTtrpgOpenTableHumanNarrationV1({ ...input(),operationKey }) })}>补齐主持叙述回执</button></aside>)}
      {op && <section className="sf-open-table-card" aria-label="主持当前行动"><h2>{op.ruleLabel}</h2><p>行动者：{op.actorName}；耗时：{op.timeCostWorldTurns} 个世界轮次。</p><p>当前步骤：{steps[op.nextStepKey ?? ''] ?? '等待相关玩家确认'}</p>
        {op.risk.privateRoll && <p>本次为保密裁定；主持审查不会替玩家确认风险或代价。</p>}
        {op.ruleResult && <div aria-label="主持查看已保存裁定"><h3>已保存的规则结果</h3><p>{({ automatic: '无需掷骰','critical-success': '大成功','extreme-success': '极难成功','hard-success': '困难成功',success: '成功','partial-success': '部分成功',failure: '失败','critical-failure': '大失败' } as Record<string,string>)[op.ruleResult.outcome] ?? op.ruleResult.outcome}</p>{op.ruleResult.check && <p>骰式 {op.ruleResult.check.expression}；骰点 {op.ruleResult.check.dice.join('、')}；修正 {op.ruleResult.check.modifier}；合计 {op.ruleResult.check.total}；难度 {op.ruleResult.check.dc}</p>}</div>}
        {op.risk.lines.map((line,i) => <p key={i}>{line}</p>)}{op.risk.templates.map((t,i) => <div key={`${t.templateKey}:${i}`}><p>{t.when}的后果：</p>{t.lines.map((text,n) => <p key={n}>{text}</p>)}{t.alternatives.map(a => <p key={a.alternativeKey}>可选「{a.title}」：{a.lines.join('；') || '不追加效果'}</p>)}</div>)}
        {op.risk.blockers.map(s => <p key={s}>{s}</p>)}
        {op.status === 'awaiting-approval' && op.approvals.map(a => <div key={a.actorKey}><p>开团时由主持批准：{a.name}</p>
          <button disabled={busy || !op.risk.reviewable} onClick={() => void perform(async () => { await confirmTtrpgOpenHostRiskV1({ ...input(),operationKey: op.operationKey,actorKey: a.actorKey,riskHash: op.riskHash,decision: 'approve' }) })}>确认授权范围内的风险</button>
          <button disabled={busy} onClick={() => void perform(async () => { await confirmTtrpgOpenHostRiskV1({ ...input(),operationKey: op.operationKey,actorKey: a.actorKey,riskHash: op.riskHash,decision: 'reject' }) })}>拒绝该行动</button></div>)}
        {host.privateChoiceReviews.some(r => r.disclosed) && <p role="status">必要后果告知已保存，等待有权确认的人亲自选择。</p>}
        {op.risk.privateRoll && ['effect','knowledge'].includes(op.nextStepKey ?? '') && <TtrpgOpenPrivateChoicePanel input={input()} operationKey={op.operationKey} sequence={view.sequence} busy={busy} perform={perform} />}
        <TtrpgOpenConsequencePanel input={input()} player={host} sequence={view.sequence} busy={busy} perform={perform} />
        {op.risk.choices.map(c => <fieldset key={`${c.kind}:${c.templateKey}`} disabled={busy || !c.canChoose}><legend>本次裁定的后果选项</legend>
          {!c.canChoose && <p>此项须由对应玩家或开团时明确的批准者确认。</p>}{c.alternatives.map(a => <div key={a.alternativeKey}><p>{a.title}：{a.lines.join('；') || '不追加效果'}</p><button onClick={() => void perform(async () => { await chooseTtrpgOpenTableConsequenceV1({ ...input(),operationKey: op.operationKey,kind: c.kind,templateKey: c.templateKey,alternativeKey: a.alternativeKey,riskHash: op.riskHash,...(c.disclosureHash ? { disclosureHash: c.disclosureHash } : {}) }) })}>选择「{a.title}」</button></div>)}</fieldset>)}
        {op.isStarter && op.status === 'executing' && <button disabled={busy} onClick={() => void perform(async () => { await resumeTtrpgOpenTableV1({ ...input(),operationKey: op.operationKey }) })}>继续主持发起的结算</button>}
        {!op.isStarter && <p>该行动由玩家发起；主持审查或叙述完成后，由该玩家继续原有结算。</p>}
        {host.gateRecovery?.canAttempt && host.gateRecovery.proof && <button disabled={busy} onClick={() => void perform(async () => { await recoverTtrpgOpenTableGatesV1({ ...input(),operationKey: op.operationKey,proof: host.gateRecovery!.proof }) })}>执行本次允许的条件修复</button>}
        {op.nextStepKey === 'narration' && !op.narrationRecorded && <fieldset disabled={busy || view.safetyStatus === 'paused'}><legend>真人主持叙述</legend><p>只描述全队已知的实际结算，不修改骰点、规则事实或角色秘密。</p>
          <label>主持叙述<textarea aria-label="主持叙述" maxLength={16000} value={draft} onChange={e => setDraft(e.target.value)} /></label>
          <button disabled={!draft.trim()} onClick={() => void perform(async () => { await recordTtrpgOpenTableHumanNarrationV1({ ...input(),operationKey: op.operationKey,text: draft,reason: 'host-authored' });setDraft('');setNotice('主持叙述已保存。') })}>确认保存主持叙述</button>
        </fieldset>}
      </section>}
      {!op && <p>{host.blockedByEntity ? '请先在本局对象面板确认或放弃当前计划。' : '当前没有等待处理的行动。玩家可在自己的桌面提出下一步行动。'}</p>}
      {!op && !host.blockedByEntity && host.epochKey && host.isEpochStarter && <button disabled={busy} onClick={() => void perform(async () => { await finishTtrpgOpenTableWindowV1(input()) })}>结束本轮主持授权</button>}
    </>}
  </section>
}
