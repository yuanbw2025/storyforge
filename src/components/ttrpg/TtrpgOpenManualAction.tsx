import { useCallback,useEffect,useRef,useState } from 'react'
import { readTtrpgOpenManualActionCatalogV1,proposeTtrpgOpenManualActionV1,type TtrpgOpenTableInputV1 } from '../../lib/ttrpg/open-table-service'
type Catalog = Awaited<ReturnType<typeof readTtrpgOpenManualActionCatalogV1>>
export default function TtrpgOpenManualAction(props: {
  input: TtrpgOpenTableInputV1; sequence: number; busy: boolean; perform: (job: () => Promise<void>) => Promise<void>
}) {
  const [catalog,setCatalog] = useState<Catalog | null>(null),[error,setError] = useState(''),[selected,setSelected] = useState(''),[target,setTarget] = useState(''),[discoveryKey,setDiscoveryKey] = useState(''),[rawInput,setRawInput] = useState('')
  const [bindings,setBindings] = useState<Record<string,string>>({}),[discoveryBindings,setDiscoveryBindings] = useState<Record<string,string>>({})
  const live = useRef(true),generation = useRef(0),submission = useRef(crypto.randomUUID())
  const { sessionId,viewerKey,scope } = props.input,{ projectId,worldId,workId } = scope
  const refresh = useCallback(async () => {
    const token = ++generation.current
    try { const value = await readTtrpgOpenManualActionCatalogV1({ scope: { projectId,worldId,workId },sessionId,viewerKey });if (live.current && token === generation.current) { setCatalog(value);setError('');setSelected('');setTarget('');setDiscoveryKey('');setBindings({});setDiscoveryBindings({}) } }
    catch (e) { if (live.current && token === generation.current) { setCatalog(null);setError(e instanceof Error ? e.message : String(e)) } }
  },[sessionId,viewerKey,projectId,worldId,workId])
  useEffect(() => { live.current = true;setCatalog(null);setSelected('');setTarget('');setDiscoveryKey('');setBindings({});setDiscoveryBindings({});void refresh();return () => { live.current = false;generation.current += 1 } },[refresh,props.sequence])
  const ruleKey = (r: Catalog['rules'][number]) => JSON.stringify(r.interactionKey ? [r.route,r.ruleKey,r.interactionKey] : [r.route,r.ruleKey])
  const rule = catalog?.rules.find(r => ruleKey(r) === selected)
  const paths = catalog?.discoveries.filter(d => d.route === rule?.route && d.ruleKey === rule.ruleKey) ?? []
  const discovery = paths.find(d => d.key === discoveryKey)
  const ready = rule && target && rule.parameters.every(p => !p.required || bindings[p.key]) && (!discovery || discovery.parameters.every(p => !p.required || discoveryBindings[p.key]))
  const makeBindings = (source: { templateKeys: string[]; parameters: Catalog['rules'][number]['parameters'] },values: Record<string,string>) => {
    const result: Record<string,Record<string,string | null>> = Object.fromEntries(source.templateKeys.map(key => [key,{}]))
    for (const p of source.parameters) result[p.templateKey][p.parameterKey] = values[p.key] ? JSON.parse(values[p.key]) as string | null : null
    return result
  }
  return <details className="sf-open-table-card" open data-testid="ttrpg-open-manual-action"><summary>按规则手动行动</summary>
    <p>直接选择本角色可用的冻结规则，不需要 AI 建议。提交后先查看风险并亲自确认，再进行结算。</p>
    {error && <p role="alert">{error}</p>}<button disabled={props.busy} onClick={() => void refresh()}>重新读取可用规则</button>
    {!catalog && !error && <p role="status">正在读取本角色的规则…</p>}
    {catalog && <fieldset disabled={props.busy || !catalog.canPropose}><legend>人工规则行动</legend>
      <label>行动规则<select aria-label="行动规则" value={selected} onChange={e => { setSelected(e.target.value);setTarget('');setDiscoveryKey('');setBindings({});setDiscoveryBindings({});submission.current = crypto.randomUUID() }}><option value="">选择能力或通用检定</option>{catalog.rules.map(r => <option key={ruleKey(r)} value={ruleKey(r)} disabled={!r.available || !r.targets.length}>{r.interactionKey ? '互动' : r.route === 'existing-action' ? '能力' : '检定'}：{r.label}{!r.available ? '（当前不可用）' : ''}</option>)}</select></label>
      {rule && <><p>耗时：{rule.timeCostWorldTurns} 个世界轮次。具体风险和费用将在提交后显示。</p>
        <label>行动对象<select aria-label="行动对象" value={target} onChange={e => setTarget(e.target.value)}><option value="">选择对象</option>{rule.targets.map(t => <option key={JSON.stringify(t.key)} value={JSON.stringify(t.key)}>{t.name}</option>)}</select></label>
        {rule.parameters.map((p,i) => <label key={p.key}>行动后果对象 {i + 1}{p.required ? '（必选）' : '（可选）'}<select aria-label={`行动后果对象 ${i + 1}`} value={bindings[p.key] ?? (p.required ? '' : 'null')} onChange={e => setBindings(v => ({ ...v,[p.key]: e.target.value }))}><option value="">选择合法对象</option>{!p.required && <option value="null">不绑定</option>}{p.options.map(o => <option key={o.key} value={JSON.stringify(o.key)}>{o.name}</option>)}</select></label>)}
        {paths.length > 0 && <label>检查线索<select aria-label="检查线索" value={discoveryKey} onChange={e => { setDiscoveryKey(e.target.value);setDiscoveryBindings({}) }}><option value="">本次不进行线索发现</option>{paths.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}</select></label>}
        {discovery?.parameters.map((p,i) => <label key={p.key}>线索后果对象 {i + 1}{p.required ? '（必选）' : '（可选）'}<select aria-label={`线索后果对象 ${i + 1}`} value={discoveryBindings[p.key] ?? (p.required ? '' : 'null')} onChange={e => setDiscoveryBindings(v => ({ ...v,[p.key]: e.target.value }))}><option value="">选择合法对象</option>{!p.required && <option value="null">不绑定</option>}{p.options.map(o => <option key={o.key} value={JSON.stringify(o.key)}>{o.name}</option>)}</select></label>)}
      </>}
      <label>行动说明<textarea aria-label="人工行动说明" maxLength={10000} value={rawInput} onChange={e => setRawInput(e.target.value)} placeholder="可以补充你准备怎样行动…" /></label>
      <button disabled={!ready} onClick={() => void props.perform(async () => {
        if (!rule || !target) return
        await proposeTtrpgOpenManualActionV1({ ...props.input,submissionKey: submission.current,basisHash: catalog.basisHash,rawInput: rawInput.trim() || `我选择${rule.label}`,
          request: { ...(rule.interactionKey ? { interactionKey: rule.interactionKey } : {}),route: rule.route,ruleKey: rule.ruleKey,actorKey: catalog.actorKey,controllerMode: 'human',targetKey: JSON.parse(target) as string | null,effectBindings: makeBindings(rule,bindings),
            ...(discovery ? { discovery: { situationKey: discovery.situationKey,evidenceRef: discovery.evidenceRef,interventionPointKey: discovery.interventionPointKey,effectBindings: makeBindings(discovery,discoveryBindings) } } : {}) } })
      })}>提出行动，查看风险</button>
    </fieldset>}
  </details>
}
