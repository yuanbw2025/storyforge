import { useEffect, useState } from 'react'
import type { ProductBuildArtifactRecordV1, WorkspaceScope } from '../../lib/types'
import type { AvgSoundPlanningScopeV1 } from '../../lib/avg/sound-scope-contract'
import type { AvgSoundPlanV1 } from '../../lib/avg/sound-plan-contract'
import { parseAvgSoundPlanV1 } from '../../lib/avg/sound-plan-contract'
import { readAvgSoundProposalV1, stageAvgSoundPlanV1 } from '../../lib/avg/sound-workbench-service'
import { confirmAvgWorkspaceInputV1 } from '../../lib/avg/assembly-service'

type Props = { scope: WorkspaceScope; productionId: number; planning: AvgSoundPlanningScopeV1
  proposal: ProductBuildArtifactRecordV1; adopted?: ProductBuildArtifactRecordV1; pending?: ProductBuildArtifactRecordV1
  disabled: boolean; canAdopt: boolean; compiled: boolean; declaration: string; onPending: (value: boolean) => void
  onAction: (action: () => Promise<void>) => Promise<void>; onReload: () => Promise<void> }
export default function SoundPlanPanel(props: Props) {
  return <OriginalSoundPlan key={`${props.scope.workId}:${props.proposal.buildId}:${props.proposal.controlEpoch}:${props.proposal.version}:${props.proposal.contentHash}`} {...props}/>
}
function OriginalSoundPlan({ scope, productionId, planning, proposal, adopted, pending, disabled, canAdopt, compiled, declaration, onPending, onAction, onReload }: Props) {
  const [plan, setPlan] = useState<AvgSoundPlanV1 | null>(null), [error, setError] = useState(''), [dirty, setDirty] = useState(false), [reviewedHash, setReviewedHash] = useState('')
  useEffect(() => {
    let active = true
    void readAvgSoundProposalV1({ scope, productionId, proposal: { artifactKey: proposal.artifactKey, version: proposal.version, contentHash: proposal.contentHash } })
      .then(value => { if (active) setPlan(structuredClone(value.payload)) }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [scope, productionId, proposal.artifactKey, proposal.version, proposal.contentHash])
  useEffect(() => { onPending(dirty); return () => onPending(false) }, [dirty, onPending])
  const update = (edit: (value: AvgSoundPlanV1) => void) => { setPlan(old => { const next = structuredClone(old!); edit(next); return next }); setDirty(true) }
  const hash = pending ? String(JSON.parse(pending.metadataJson).candidateHash ?? '') : ''
  return <section className="avg-sound-plan" aria-label="声音方案确认"><h5>原始声音方案与作者修订</h5>
    {error && <p role="alert">{error}</p>}{!plan && !error && <p role="status">正在核验原岗位、实际输入与模型原响应…</p>}
    <details><summary>准确原始方案</summary><pre>{JSON.stringify(JSON.parse(proposal.payloadJson), null, 2)}</pre></details>
    {adopted && <details open><summary>已采用声音方案 v{adopted.version}</summary><pre>{JSON.stringify(parseAvgSoundPlanV1(adopted.payloadJson), null, 2)}</pre></details>}
    {plan && <fieldset className="avg-form" disabled={disabled || !canAdopt || compiled}><legend>作者声音方案</legend>
      {(['goal', 'dialogueSpace', 'continuity'] as const).map(key => <label key={key}>{({ goal: '声音方向', dialogueSpace: '对白留白', continuity: '跨场景连续性' })[key]}<textarea value={plan.direction[key]} maxLength={2000} onChange={e => { const value = e.target.value; update(p => { p.direction[key] = value }) }}/></label>)}
      {plan.entries.map((entry, index) => { const t = planning.templates.find(t => t.requirementKey === entry.requirementKey)!; return <fieldset className="avg-assembly-row" key={entry.requirementKey} aria-label={`声音方案 ${entry.requirementKey}`}><legend>{t.purpose}</legend>
        <label>制作意图<textarea value={entry.designIntent} maxLength={2000} onChange={e => { const value = e.target.value; update(p => { p.entries[index].designIntent = value }) }}/></label>
        {t.source.kind === 'generate-music' ? <label>本机音乐说明<textarea value={entry.prompt ?? ''} maxLength={512} onChange={e => { const value = e.target.value; update(p => { p.entries[index].prompt = value }) }}/></label>
          : <label>准确允许音效<select value={entry.librarySourceKey ?? ''} onChange={e => { const value = e.target.value; update(p => { p.entries[index].librarySourceKey = value }) }}>
            {t.source.allowedSourceKeys.map(key => <option key={key} value={key}>{planning.librarySources.find(s => s.sourceKey === key)?.memberPath ?? key}</option>)}</select></label>}
        <label>验收关注点<textarea value={entry.acceptanceNotes.join('\n')} onChange={e => { const value = e.target.value; update(p => { p.entries[index].acceptanceNotes = value.split('\n').map(s => s.trim()).filter(Boolean) }) }}/></label>
      </fieldset> })}
      <button className="lf-action" disabled={!declaration.trim()} onClick={() => void onAction(async () => {
        await stageAvgSoundPlanV1({ scope, productionId, proposal: { artifactKey: proposal.artifactKey, version: proposal.version, contentHash: proposal.contentHash }, payload: plan, declaration })
        setDirty(false); setReviewedHash(''); await onReload()
      })}>保存为待确认声音方案</button>
      <button className="lf-action" disabled={!dirty} onClick={() => { setPlan(structuredClone(JSON.parse(proposal.payloadJson).payload)); setDirty(false) }}>撤销声音方案输入</button>
    </fieldset>}
    {compiled && <p>本批声音方案已编译，原方案保留；修订需明确准备新版本。</p>}
    {pending && <details open><summary>待确认声音方案 v{pending.version}</summary><pre>{JSON.stringify(parseAvgSoundPlanV1(pending.payloadJson), null, 2)}</pre>
      <label><input type="checkbox" disabled={disabled || dirty || !canAdopt || compiled} checked={!!hash && reviewedHash === hash} onChange={e => setReviewedHash(e.target.checked ? hash : '')}/>我已核对声音方案、来源范围与投入边界</label>
      <button className="lf-action" disabled={disabled || dirty || !canAdopt || compiled || reviewedHash !== hash || !hash} onClick={() => void onAction(async () => {
        await confirmAvgWorkspaceInputV1({ scope, productionId, artifactKey: pending.artifactKey, candidateVersion: pending.version, candidateHash: hash }); await onReload()
      })}>确认采用声音方案</button></details>}
  </section>
}
