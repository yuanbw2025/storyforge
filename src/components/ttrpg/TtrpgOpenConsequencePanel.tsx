import { useEffect, useRef, useState } from 'react'
import { readTtrpgOpenTableHostConsequenceV1, prepareTtrpgOpenTableConsequenceV1, proposeTtrpgOpenTableConsequenceV1,
  confirmTtrpgOpenTableConsequenceV1, readTtrpgOpenTableStageClosureV1, closeTtrpgOpenTableStageV1,
  type TtrpgOpenTableInputV1, type TtrpgOpenTableViewV1, type TtrpgOpenTableHostConsequenceV1 } from '../../lib/ttrpg/open-table-service'
type Player = Pick<NonNullable<TtrpgOpenTableViewV1['player']>, 'canHumanHost' | 'consequence' | 'consequenceApprovals'> & { operation: { operationKey: string; nextStepKey: string | null } | null }
type Prepared = Awaited<ReturnType<typeof prepareTtrpgOpenTableConsequenceV1>>
export default function TtrpgOpenConsequencePanel(props: {
  input: TtrpgOpenTableInputV1; player: Player; sequence: number; busy: boolean; perform: (job: () => Promise<void>) => Promise<void>
}) {
  const { input, player: p, busy, perform } = props, locator = p.consequence ? { ...input, ...p.consequence } : null
  const [hostConsent, setHostConsent] = useState(false), [host, setHost] = useState<TtrpgOpenTableHostConsequenceV1 | null>(null)
  const [bindings, setBindings] = useState<Record<string, string>>({}), [alternative, setAlternative] = useState(''), [prepared, setPrepared] = useState<Prepared | null>(null)
  const [stage, setStage] = useState<Awaited<ReturnType<typeof readTtrpgOpenTableStageClosureV1>> | null>(null), [summary, setSummary] = useState('')
  const active = useRef(true), generation = useRef(0)
  useEffect(() => { active.current = true;return () => { active.current = false } }, [])
  useEffect(() => { generation.current++;setHost(null);setPrepared(null);setStage(null);setSummary('');setBindings({});setAlternative('');setHostConsent(false) }, [props.sequence])
  const closeHost = () => { generation.current++;setHost(null);setPrepared(null);setStage(null);setSummary('');setBindings({});setAlternative('');setHostConsent(false) }
  const readHost = () => perform(async () => {
    if (!locator || !hostConsent) return
    const version = ++generation.current, result = await readTtrpgOpenTableHostConsequenceV1(locator)
    if (!active.current || version !== generation.current) return
    setHost(result);setPrepared(null);setBindings(Object.fromEntries(result.parameters.map(p => [p.key, ''])));setAlternative('')
  })
  return <>
    {p.consequenceApprovals.map(a => <section className="sf-open-table-card" key={`${a.actorKey}:${a.reviewKey}`} aria-label={`确认${a.actorName}的后果`}>
      <h3>{a.actorName}的具体后果</h3>{a.lines.map((line, i) => <p key={i}>{line}</p>)}
      <p>这里只确认该角色受到的后果；确认后仍由结算步骤实际应用。</p>
      <button disabled={busy || !a.canApprove || !a.reviewable} onClick={() => void perform(async () => { if (locator) await confirmTtrpgOpenTableConsequenceV1({ ...locator, actorKey: a.actorKey, reviewKey: a.reviewKey, riskHash: a.riskHash, decision: 'approve' }) })}>接受该角色的后果</button>
      <button disabled={busy || !a.canApprove} onClick={() => void perform(async () => { if (locator) await confirmTtrpgOpenTableConsequenceV1({ ...locator, actorKey: a.actorKey, reviewKey: a.reviewKey, riskHash: a.riskHash, decision: 'reject' }) })}>拒绝该角色的后果</button>
    </section>)}
    {p.canHumanHost && (locator || p.operation?.nextStepKey === 'gates') && <section className="sf-open-table-card" aria-label="主持审查">
      <h3>主持审查</h3><p>此区域可能显示未公开的规则与叙事资料；交接回玩家前请关闭。</p>
      {!host && !stage && <label><input type="checkbox" checked={hostConsent} disabled={busy} onChange={e => setHostConsent(e.target.checked)} />我正在以主持身份审查，可以查看未公开资料。</label>}
      {locator && !host && <button disabled={busy || !hostConsent} onClick={() => void readHost()}>进入后果参数审查</button>}
      {host && locator && <fieldset disabled={busy || !host.canPropose} aria-label="主持后果参数">
        <legend>{host.title}</legend>
        {host.history.map(h => <p key={h.revision}>第 {h.revision} 次裁定：{({ 'awaiting-approval': '等待相关玩家确认', approved: '已确认，等待结算', rejected: '已拒绝', stale: '状态已变化，需重新裁定', unpayable: '代价无法支付，需重新裁定' } as Record<string, string>)[h.status]}</p>)}
        {host.parameters.map(param => <label key={param.key}>{param.label}{param.required ? '（必选）' : '（可选）'}<select aria-label={param.label} value={bindings[param.key] ?? ''} onChange={e => { setBindings(v => ({ ...v, [param.key]: e.target.value }));setPrepared(null) }}><option value="">请选择</option>{!param.required && <option value="__none__">不绑定</option>}{param.options.map(o => <option key={o.key} value={o.key}>{o.name}</option>)}</select></label>)}
        {host.alternatives.length > 0 && <label>后果方案<select aria-label="后果方案" value={alternative} onChange={e => { setAlternative(e.target.value);setPrepared(null) }}><option value="">请选择一项</option>{host.alternatives.map(a => <option key={a.key} value={a.key}>{a.title}</option>)}</select></label>}
        <button disabled={host.parameters.some(p => !bindings[p.key]) || host.alternatives.length > 0 && !alternative} onClick={() => void perform(async () => {
          const version = ++generation.current
          const result = await prepareTtrpgOpenTableConsequenceV1({ ...locator, request: { bindings: Object.fromEntries(host.parameters.map(p => [p.key, bindings[p.key] === '__none__' ? null : bindings[p.key]])), alternativeKey: alternative || null } })
          if (active.current && version === generation.current) setPrepared(result)
        })}>检查具体后果</button>
        {prepared && <section aria-label="主持后果预览"><h4>第 {prepared.revision} 次裁定预览</h4>{prepared.lines.map((line, i) => <p key={i}>{line}</p>)}<p>还需以下角色分别确认：{prepared.affectedNames.join('、') || '无'}</p>
          <button disabled={!prepared.reviewable} onClick={() => void perform(async () => { await proposeTtrpgOpenTableConsequenceV1({ ...locator, request: prepared.request, reviewKey: prepared.reviewKey, riskHash: prepared.riskHash }) })}>确认主持裁定并提交相关玩家</button>
        </section>}
      </fieldset>}
      {!locator && !stage && p.operation?.nextStepKey === 'gates' && <button disabled={busy || !hostConsent} onClick={() => void perform(async () => {
        const version = ++generation.current, result = await readTtrpgOpenTableStageClosureV1({ ...input, operationKey: p.operation!.operationKey })
        if (active.current && version === generation.current) setStage(result)
      })}>审查阶段收束条件</button>}
      {stage && <section aria-label="阶段收束审查">{stage.eligible && !stage.stageClosed ? <>
        <p>{stage.maximumReached ? '本阶段已达到约定的最长时间，需要明确收束。' : '本阶段已满足作者约定的收束条件。'}</p><p>{stage.prompt}</p>
        <label>主持私密阶段记录<textarea aria-label="主持私密阶段记录" maxLength={16000} value={summary} disabled={busy} onChange={e => setSummary(e.target.value)} /></label>
        <p>此记录仅供主持，不会直接发送给玩家。收束不额外推进世界时间；既定时钟和后果仍会分别结算。</p>
        <button disabled={busy || !summary.trim()} onClick={() => void perform(async () => { await closeTtrpgOpenTableStageV1({ ...input, operationKey: p.operation!.operationKey, summary }) })}>确认收束当前阶段</button>
      </> : <p>{stage.stageClosed ? '阶段已收束，请继续完成剩余结算。' : '当前尚未满足阶段收束条件，可以关闭审查并处理当前行动。'}</p>}</section>}
      {(host || stage) && <button disabled={busy} onClick={closeHost}>关闭主持资料，返回玩家</button>}
    </section>}
  </>
}
