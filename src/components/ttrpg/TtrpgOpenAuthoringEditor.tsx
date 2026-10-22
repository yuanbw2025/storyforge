import { useEffect, useRef, useState } from 'react'
import type { TtrpgOpenAuthoringV1 } from '../../lib/ttrpg/open-contract'
import { parseTtrpgOpenAuthoringV1 } from '../../lib/ttrpg/open-content-authoring'
import { MAX_TTRPG_OPEN_AUTHORING_EDIT_BYTES_V1, parseTtrpgOpenAuthoringEditV1, reviewTtrpgOpenAuthoringEditV1,
  initializeTtrpgOpenAuthoringPoliciesV1 } from '../../lib/ttrpg/open-authoring-edit'
import { registerPendingDraftFlusherV1 } from '../../lib/authoring/pending-edit-coordinator'
import { downloadTextFile } from '../../lib/export/text-export'

/** Work-owned S2 draft editing. No model, production start or runtime mutation. */
export default function TtrpgOpenAuthoringEditor({ value, onChange }: {
  value: TtrpgOpenAuthoringV1; onChange: (next: TtrpgOpenAuthoringV1) => void
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2)), [pending, setPending] = useState(false)
  const [candidate, setCandidate] = useState<TtrpgOpenAuthoringV1 | null>(null), [confirmed, setConfirmed] = useState<string[]>([])
  const [error, setError] = useState(''), [reading, setReading] = useState(false), [factPage, setFactPage] = useState(0)
  const active = useRef(true), epoch = useRef(0), blocked = useRef(false), current = useRef(value), basis = useRef('')
  current.current = value
  useEffect(() => {
    const generation = epoch; active.current = true
    return () => { active.current = false; generation.current++ }
  }, [])
  useEffect(() => { if (!pending) setText(JSON.stringify(value, null, 2)) }, [value, pending])
  useEffect(() => registerPendingDraftFlusherV1(() => {
    if (blocked.current) throw new Error('请先应用或放弃开放设计的未保存修改')
  }), [])
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (blocked.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])
  const markPending = () => { blocked.current = true; setPending(true); setError('') }
  const discard = () => {
    epoch.current++; blocked.current = false; setPending(false); setReading(false); setCandidate(null); setConfirmed([]); setError(''); setFactPage(0)
    setText(JSON.stringify(current.current, null, 2))
  }
  const inspect = (source: string) => {
    const parsed = parseTtrpgOpenAuthoringEditV1(source)
    basis.current = JSON.stringify(current.current); setCandidate(parsed); setConfirmed([]); setFactPage(0)
  }
  const apply = () => {
    if (!candidate) return
    try {
      if (basis.current !== JSON.stringify(current.current)) throw new Error('原草稿已变化，请重新检查这份设计；未应用的内容已保留')
      const next = reviewTtrpgOpenAuthoringEditV1(candidate, confirmed)
      epoch.current++; blocked.current = false; setPending(false); setCandidate(null); setConfirmed([]); setError('')
      onChange(next)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  const change = (next: TtrpgOpenAuthoringV1) => { setError(''); onChange(next) }
  const policy = value.runtimePolicy
  const facts = candidate?.factPolicy ?? [], pages = Math.max(1, Math.ceil(facts.length / 25))
  return <section className="md:col-span-2 ttrpg-open-authoring-editor" data-testid="ttrpg-open-authoring-editor">
    <h4>开放设计草稿</h4>
    <p>局势、压力、队友和运行边界随本作品保存。导入后先核对内容，再应用到草稿；制作前还会检查世界来源和规则。</p>
    <p>已有 {value.situationTemplates.length} 个局势、{value.pressure.clocks.length} 个压力时钟、{value.factPolicy.length} 条事实。
      {value.factPolicy.some(item => !item.authorConfirmed) && '仍有事实等待本人确认。'}</p>
    {value.factPolicy.some(item => !item.authorConfirmed) && <button className="lf-action" type="button" disabled={pending || reading} onClick={() => {
      markPending(); const source = JSON.stringify(current.current, null, 2); setText(source); inspect(source)
      setConfirmed(current.current.factPolicy.filter(item => item.authorConfirmed).map(item => item.fact.factKey))
    }}>继续核对草稿事实</button>}
    <fieldset disabled={pending || reading}>
      {(!value.companionPolicy || !value.stageClosurePolicy || !policy) && <button className="lf-action" type="button" onClick={() => change(initializeTtrpgOpenAuthoringPoliciesV1(value))}>填写本桌边界草稿</button>}
      {policy && <div className="avg-form">
        <p className="md:col-span-2">运行额度随制作方案冻结。调整后请保存配置并更新审查方案，再核对新版本；已发布作品的后续版本可在正式开始前调整这里的运行额度。</p>
        <label><input type="checkbox" checked={policy.enabled} onChange={event => change({ ...value, runtimePolicy: { ...policy, enabled: event.target.checked } })}/>本作品允许使用 AI 主持与队友，开局仍需确认</label>
        {([
          ['每次授权最多模型调用', 'maximumCallsPerEpoch', 1, 9], ['每次授权最多 AI 行动', 'maxAiActions', 0, 5],
          ['单次输出上限（tokens）', 'maximumOutputTokens', 1, 100000], ['每次授权总量上限（tokens）', 'maximumEpochTokens', 1, 1000000],
          ['每次授权费用上限（美元）', 'maximumEpochCostUsd', 0, 1000], ['最多修复次数', 'maximumRepairAttempts', 0, 3],
        ] as const).map(([label, key, min, max]) => <label key={key}>{label}<input type="number" min={min} max={max} step={key === 'maximumEpochCostUsd' ? '0.01' : '1'}
          value={policy[key]} onChange={event => change({ ...value, runtimePolicy: { ...policy, [key]: Number(event.target.value) } })}/></label>)}
      </div>}
      {value.stageClosurePolicy && <label>每阶段最多世界轮次<input type="number" min="10" max="1000" value={value.stageClosurePolicy.maximumWorldTurns}
        onChange={event => change({ ...value, stageClosurePolicy: { ...value.stageClosurePolicy!, maximumWorldTurns: Number(event.target.value) } })}/></label>}
      {!!value.situationTemplates.length && <details><summary>局势与开场</summary>{value.situationTemplates.map((situation, index) => <div key={situation.templateKey}>
        <label>局势 {index + 1} 标题<input value={situation.title} onChange={event => change({ ...value, situationTemplates: value.situationTemplates.map((item, i) => i === index ? { ...item, title: event.target.value } : item) })}/></label>
        <label><input type="checkbox" checked={value.openingSituationKeys.includes(situation.templateKey)} onChange={event => change({ ...value,
          openingSituationKeys: event.target.checked ? [...value.openingSituationKeys, situation.templateKey] : value.openingSituationKeys.filter(key => key !== situation.templateKey) })}/>作为开局局势</label>
        <label>驱动者目标<textarea value={situation.driverGoal} onChange={event => change({ ...value, situationTemplates: value.situationTemplates.map((item, i) => i === index ? { ...item, driverGoal: event.target.value } : item) })}/></label>
      </div>)}</details>}
    </fieldset>
    <details><summary>导入或修改完整开放设计</summary>
      <p>使用开放设计对象的 JSON，包含局势、事实、压力和边界；作品名称、席位、世界和规则仍在各自页面选择。文件中的事实确认标记须由本人重新核对。</p>
      <label>开放设计文件<input type="file" accept=".json,application/json" disabled={reading} onChange={event => {
        const file = event.target.files?.[0]; if (!file) return
        const token = ++epoch.current; markPending(); setCandidate(null); setConfirmed([]); setReading(true)
        if (file.size > MAX_TTRPG_OPEN_AUTHORING_EDIT_BYTES_V1) { setReading(false); setError('开放设计文件不能超过 4 MB；原草稿保持不变'); return }
        void file.text().then(source => {
          if (!active.current || token !== epoch.current) return
          setText(source); inspect(source)
        }).catch(e => { if (active.current && token === epoch.current) setError(e instanceof Error ? e.message : String(e)) })
          .finally(() => { if (active.current && token === epoch.current) setReading(false) })
      }}/></label>
      <label>开放设计 JSON<textarea aria-label="开放设计 JSON" rows={12} value={text} disabled={reading} onChange={event => {
        epoch.current++; markPending(); setText(event.target.value); setCandidate(null); setConfirmed([])
      }}/></label>
      <div className="avg-actions"><button className="lf-action" type="button" disabled={reading || !pending} onClick={() => { try { setError(''); inspect(text) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } }}>检查开放设计修改</button>
        <button className="lf-action" type="button" disabled={reading} onClick={() => { try { downloadTextFile(JSON.stringify(parseTtrpgOpenAuthoringV1(value), null, 2), '开放设计草稿.json', 'application/json') } catch (e) { setError(e instanceof Error ? e.message : String(e)) } }}>导出当前开放设计</button></div>
    </details>
    {candidate && <section data-testid="ttrpg-open-authoring-candidate"><h5>待应用的开放设计</h5>
      <p>{candidate.situationTemplates.length} 个局势，{candidate.pressure.clocks.length} 个压力时钟，{candidate.effectPlanTemplates.length} 组后果，{facts.length} 条事实。尚未修改原草稿。</p>
      <p>事实确认 {confirmed.length}/{facts.length}；未勾选的内容可留作草稿，正式制作前须继续核对。</p>
      {facts.slice(factPage * 25, factPage * 25 + 25).map(item => <div key={item.fact.factKey}><label>
        <input type="checkbox" checked={confirmed.includes(item.fact.factKey)} onChange={event => setConfirmed(prior => event.target.checked ? [...prior, item.fact.factKey] : prior.filter(key => key !== item.fact.factKey))}/>
        我确认事实 {item.fact.factKey}：{item.fact.subjectRef} · {item.fact.predicateKey} · {JSON.stringify(item.fact.canonicalValue)}
      </label><details><summary>查看事实范围与来源</summary><pre>{JSON.stringify(item.fact, null, 2)}</pre></details></div>)}
      {pages > 1 && <div><button className="lf-action" type="button" disabled={factPage === 0} onClick={() => setFactPage(page => page - 1)}>上一页事实</button><span>{factPage + 1}/{pages}</span><button className="lf-action" type="button" disabled={factPage + 1 === pages} onClick={() => setFactPage(page => page + 1)}>下一页事实</button></div>}
      <button className="lf-action lf-action-primary" type="button" onClick={apply}>应用到开放设计草稿</button>
    </section>}
    {pending && <p role="status">开放设计有未应用的修改；请应用或明确放弃后再切换页面。<button className="lf-action" type="button" onClick={discard}>放弃未应用的设计修改</button></p>}
    {error && <p role="alert">{error}</p>}
  </section>
}
