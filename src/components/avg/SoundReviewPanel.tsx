import { useCallback, useEffect, useState } from 'react'
import type { ProductBuildArtifactRecordV1, WorkspaceScope } from '../../lib/types'
import { readAvgSoundCandidateV1, stageAvgSoundReviewV1, stageAvgSoundChoiceV1 } from '../../lib/avg/sound-workbench-service'
import { confirmAvgWorkspaceInputV1 } from '../../lib/avg/assembly-service'
import { parseAvgAuthorSoundReviewV3, type AvgAuthorSoundEvidenceV1, type AvgSoundReviewCriterionV1, type AvgSoundReviewIssuesV3 } from '../../lib/avg/sound-review-contract'
import { assertAvgSoundReviewSelectableV3, avgSoundReviewCriteriaV1 } from '../../lib/avg/sound-review'
import { parseAvgAuthorSoundChoiceV1 } from '../../lib/avg/sound-choice-contract'
import SoundAuditionPlayer, { type SoundObservation } from './SoundAuditionPlayer'

const LABELS: Record<AvgSoundReviewCriterionV1, string> = { 'purpose-fit': '符合用途', 'noise-distortion': '噪音与失真', 'clip-boundaries': '首尾完整', 'instrumental-only': '纯器乐无歌词', 'loop-seam': '循环接缝' }
type Selected = Awaited<ReturnType<typeof readAvgSoundCandidateV1>>
type Props = { scope: WorkspaceScope; productionId: number; raw: ProductBuildArtifactRecordV1
  review?: ProductBuildArtifactRecordV1; pendingReview?: ProductBuildArtifactRecordV1; choice?: ProductBuildArtifactRecordV1; pendingChoice?: ProductBuildArtifactRecordV1
  disabled: boolean; canAdopt: boolean; declaration: string; onPending: (value: boolean) => void
  onAction: (action: () => Promise<void>) => Promise<void>; onReload: () => Promise<void> }
const ref = (row: ProductBuildArtifactRecordV1) => ({ artifactKey: row.artifactKey, version: row.version, contentHash: row.contentHash })
const candidateHash = (row: ProductBuildArtifactRecordV1) => { try { return String(JSON.parse(row.metadataJson).candidateHash ?? '') } catch { return '' } }
function eligible(a: SoundObservation['audition'] | undefined, criterion: AvgSoundReviewCriterionV1, passing: boolean) {
  const heard = !!a && a.playedMs > 0 && !a.muted && a.volume > 0 && a.playbackRate === 1 && !a.seeked
  return heard && (!passing || a.outcome === 'ended' && a.completedCycles >= 1 && a.playedMs >= a.durationMs * a.completedCycles - 1)
    && (criterion !== 'loop-seam' || a.continuousLoops >= 1 && a.completedCycles >= (passing ? 2 : 1) && a.playedMs > a.durationMs)
}
function Summary({ row }: { row: ProductBuildArtifactRecordV1 }) {
  try {
    const r = parseAvgAuthorSoundReviewV3(row.payloadJson)
    return <><p>{r.soundEvidence.note}</p><ul>{r.soundEvidence.checks.map(c => <li key={c.criterion}>{LABELS[c.criterion]}：{c.result === 'pass' ? '通过' : c.result === 'fail' ? '需返修' : '未观察'} · {c.note}</li>)}</ul>
      {r.unobserved.map((text, i) => <p key={i}>未观察：{text}</p>)}{r.issues.map(i => <p key={i.issueKey}>问题：{i.evidence}；允许返修：{i.allowedChange}；复验：{i.recheck}</p>)}</>
  } catch { return <p role="alert">原声音观察记录无法核验，不能签作通过。</p> }
}
export default function SoundReviewPanel(props: Props) {
  return <OriginalSoundReview key={`${props.scope.workId}:${props.raw.buildId}:${props.raw.controlEpoch}:${props.raw.artifactKey}:${props.raw.version}:${props.raw.contentHash}`} {...props}/>
}
function OriginalSoundReview({ scope, productionId, raw, review, pendingReview, choice, pendingChoice, disabled, canAdopt, declaration, onPending, onAction, onReload }: Props) {
  const [selected, setSelected] = useState<Selected | null>(null), [error, setError] = useState('')
  const [observation, setObservation] = useState<SoundObservation | null>(null), [checks, setChecks] = useState<AvgAuthorSoundEvidenceV1['checks']>([])
  const [note, setNote] = useState(''), [repair, setRepair] = useState(''), [dirty, setDirty] = useState(false)
  useEffect(() => {
    let active = true; setSelected(null); setError('')
    void readAvgSoundCandidateV1({ scope, productionId, raw: { artifactKey: raw.artifactKey, version: raw.version, contentHash: raw.contentHash } }).then(value => {
      if (active) { setSelected(value); setChecks(avgSoundReviewCriteriaV1(value.payload).map(criterion => ({ criterion, result: 'unknown', note: '' }))) }
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [scope, productionId, raw.artifactKey, raw.version, raw.contentHash])
  useEffect(() => { onPending(dirty); return () => onPending(false) }, [dirty, onPending])
  useEffect(() => { if (choice) setDirty(false) }, [choice])
  const observe = useCallback((value: SoundObservation | null) => {
    setObservation(value)
    setChecks(old => old.map(c => c.result === 'pass' && !eligible(value?.audition, c.criterion, true)
      || c.result === 'fail' && !eligible(value?.audition, c.criterion, false) ? { ...c, result: 'unknown' as const } : c))
  }, [])
  const a = observation?.audition
  const complete = !!a && a.outcome === 'ended' && !a.muted && a.volume > 0 && a.playbackRate === 1 && !a.seeked && a.completedCycles >= 1 && a.playedMs >= a.durationMs * a.completedCycles - 1
  const report = (): AvgSoundReviewIssuesV3 => {
    if (!selected) throw new Error('原声音尚未核验')
    const t = selected.payload.requirement.template
    return { schema: 'storyforge.avg.review-issues', version: 3, targetKey: t.requirementKey,
      observations: observation ? ['audio'] : [], unobserved: [...(!complete ? ['尚未完整原速审听原声音'] : []), ...checks.filter(c => c.result === 'unknown').map(c => `未观察：${LABELS[c.criterion]}`)],
      issues: checks.filter(c => c.result === 'fail').map(c => ({ issueKey: `sound.${c.criterion}`, locationKey: t.assetKey, severity: 'blocking', owner: 'media',
        evidence: c.note, allowedChange: repair, impact: '保留原音频和调用记录，本候选不能选用', recheck: `重新审听准确声音并复验${LABELS[c.criterion]}` })),
      soundEvidence: { audioHash: observation?.audioHash ?? null, requestIdentityHash: selected.payload.requirement.identityHash,
        audition: observation?.audition ?? null, checks, note } }
  }
  let selectable = false
  if (selected && review) { try { assertAvgSoundReviewSelectableV3(review.payloadJson, selected.payload); selectable = true } catch { /* retained unknown/failure remains visible */ } }
  const confirmCandidate = (row: ProductBuildArtifactRecordV1) => onAction(async () => {
    await confirmAvgWorkspaceInputV1({ scope, productionId, artifactKey: row.artifactKey, candidateVersion: row.version, candidateHash: candidateHash(row) })
    setDirty(false); await onReload()
  })
  return <section className="avg-sound-review" aria-label="声音审听与选择">
    {error && <p role="alert">{error}</p>}{!selected && !error && <p role="status">正在核验原声音、请求、许可与实际字节…</p>}
    {selected && <><h5>准确声音 · {selected.payload.requirement.template.purpose}</h5>
      <p>{selected.asset.kind} · {selected.originalMeasurement.durationMs} 毫秒 · {selected.asset.mimeType} · {selected.asset.byteSize} 字节</p>
      <p>来源：{selected.asset.source}；许可：{selected.asset.license}。当前原字节和producer已核验，选择仍需作者确认实际适用权利。</p>
      <details><summary>原始权利与生产结果</summary><pre>{JSON.stringify({ rights: JSON.parse(selected.raw.rightsJson), result: selected.payload.providerResult }, null, 2)}</pre></details>
      <SoundAuditionPlayer sourceKey={selected.sourceKey} data={selected.data} assetKey={selected.asset.assetKey} contentHash={selected.asset.contentHash}
        requestIdentityHash={selected.payload.requirement.identityHash} durationMs={selected.originalMeasurement.durationMs}
        channelCount={selected.originalMeasurement.channelCount} loop={selected.payload.requirement.template.cue.loop} disabled={disabled} onObservation={observe}/>
      <fieldset className="avg-form" disabled={disabled || !canAdopt || !!choice}><legend>逐项记录作者声音观察</legend>
        {checks.map((check, index) => <div className="avg-assembly-row" key={check.criterion}>
          <label>{LABELS[check.criterion]}<select aria-label={LABELS[check.criterion]} value={check.result} onChange={event => {
            const value = event.target.value as typeof check.result; setDirty(true); setChecks(old => old.map((c, i) => i === index ? { ...c, result: value } : c))
          }}><option value="unknown">未观察</option><option value="pass" disabled={!eligible(a, check.criterion, true)}>通过</option><option value="fail" disabled={!eligible(a, check.criterion, false)}>需返修</option></select></label>
          <label>观察依据<input value={check.note} maxLength={2000} onChange={event => { const value = event.target.value; setDirty(true); setChecks(old => old.map((c, i) => i === index ? { ...c, note: value } : c)) }}/></label>
        </div>)}
        <label>本轮声音审听依据<textarea value={note} maxLength={4000} onChange={e => { setNote(e.target.value); setDirty(true) }}/></label>
        {checks.some(c => c.result === 'fail') && <label>允许的声音返修范围<textarea value={repair} maxLength={4000} onChange={e => { setRepair(e.target.value); setDirty(true) }}/></label>}
        <button className="lf-action" disabled={!dirty || !note.trim() || !declaration.trim()} onClick={() => void onAction(async () => {
          await stageAvgSoundReviewV1({ scope, productionId, raw: ref(raw), report: report(), declaration }); setDirty(false); await onReload()
        })}>保存为待确认声音观察</button>
        <button className="lf-action" disabled={!dirty} onClick={() => { setChecks(old => old.map(c => ({ ...c, result: 'unknown', note: '' }))); setNote(''); setRepair(''); setDirty(false) }}>撤销未保存的声音观察</button>
      </fieldset></>}
    {review && <details><summary>已确认声音观察 v{review.version}</summary><Summary row={review}/></details>}
    {pendingReview && <details open><summary>待确认声音观察 v{pendingReview.version}</summary><Summary row={pendingReview}/>
      <button className="lf-action" disabled={disabled || dirty || !canAdopt || !!choice || !selected || !candidateHash(pendingReview)} onClick={() => void confirmCandidate(pendingReview)}>确认这份声音观察</button></details>}
    {selected && !choice && <button className="lf-action" disabled={disabled || dirty || !!pendingReview || !canAdopt || !selectable || !declaration.trim()} onClick={() => void onAction(async () => {
      await stageAvgSoundChoiceV1({ scope, productionId, raw: ref(raw), declaration }); await onReload()
    })}>将原声音列为待确认选择</button>}
    {pendingChoice && <details open><summary>待确认声音选择 v{pendingChoice.version}</summary>
      <p>{parseAvgAuthorSoundChoiceV1(pendingChoice.payloadJson).declaration}</p>
      <button className="lf-action" disabled={disabled || dirty || !canAdopt || !selected || !candidateHash(pendingChoice)} onClick={() => void confirmCandidate(pendingChoice)}>确认采用原声音</button></details>}
    {choice && <p>已采用声音 v{choice.version}。舞台配置和演出确认仍须另行完成。</p>}
    <p>播放记录及作者观察不证明独立听众、专业听感或商业作品通过。</p>
  </section>
}
