import { useCallback, useEffect, useState } from 'react'
import type { ProductBuildArtifactRecordV1, WorkspaceScope } from '../../lib/types'
import { readAvgRawSoundCandidateV1, readAvgSoundCandidateV1, stageAvgSoundReviewV1, stageAvgSoundChoiceV1 } from '../../lib/avg/sound-workbench-service'
import { confirmAvgWorkspaceInputV1 } from '../../lib/avg/assembly-service'
import { parseAvgAuthorSoundReviewV3, type AvgAuthorSoundEvidenceV1, type AvgSoundReviewCriterionV1, type AvgSoundReviewIssuesV3 } from '../../lib/avg/sound-review-contract'
import { assertAvgSoundReviewMeasuredSelectableV3, avgSoundReviewCriteriaV1 } from '../../lib/avg/sound-review'
import { parseAvgAuthorSoundChoice } from '../../lib/avg/audio-choice-dispatch'
import SoundAuditionPlayer, { type SoundObservation } from './SoundAuditionPlayer'
import OriginalAudioComparisonPlayer from './OriginalAudioComparisonPlayer'

const LABELS: Record<AvgSoundReviewCriterionV1, string> = { 'purpose-fit': '符合用途', 'noise-distortion': '噪音与失真', 'clip-boundaries': '首尾完整', 'instrumental-only': '纯器乐无歌词', 'loop-seam': '循环接缝' }
type Selected = Awaited<ReturnType<typeof readAvgSoundCandidateV1>>
type Props = { scope: WorkspaceScope; productionId: number; raw: ProductBuildArtifactRecordV1; processed?: ProductBuildArtifactRecordV1; processingRequired?: boolean
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
  } catch { return <p role="alert">声音观察记录无法核验，不能签作通过。</p> }
}
export default function SoundReviewPanel(props: Props) {
  return <CurrentSoundReview key={`${props.scope.workId}:${props.raw.buildId}:${props.raw.controlEpoch}:${props.raw.artifactKey}:${props.raw.version}:${props.raw.contentHash}:${props.processingRequired ?? false}:${props.processed?.artifactKey ?? ''}:${props.processed?.version ?? ''}:${props.processed?.contentHash ?? ''}:${props.processed?.producerReceiptHash ?? ''}`} {...props}/>
}
function CurrentSoundReview({ scope, productionId, raw, processed, processingRequired = false, review, pendingReview, choice, pendingChoice, disabled, canAdopt, declaration, onPending, onAction, onReload }: Props) {
  const [selected, setSelected] = useState<Selected | null>(null), [error, setError] = useState('')
  const [observation, setObservation] = useState<SoundObservation | null>(null), [checks, setChecks] = useState<AvgAuthorSoundEvidenceV1['checks']>([])
  const [note, setNote] = useState(''), [repair, setRepair] = useState(''), [dirty, setDirty] = useState(false)
  const [audioMode, setAudioMode] = useState<'candidate' | 'original'>('candidate')
  const waitingForProcessing = processingRequired && !processed
  const processedKey = processed?.artifactKey, processedVersion = processed?.version, processedHash = processed?.contentHash
  useEffect(() => {
    let active = true; setSelected(null); setError('')
    if (waitingForProcessing) return () => { active = false }
    void readAvgSoundCandidateV1({ scope, productionId, raw: { artifactKey: raw.artifactKey, version: raw.version, contentHash: raw.contentHash },
      ...(processedKey && processedVersion !== undefined && processedHash ? { processed: { artifactKey: processedKey, version: processedVersion, contentHash: processedHash } } : {}) }).then(value => {
      if (active) { setSelected(value); setChecks(avgSoundReviewCriteriaV1(value.payload).map(criterion => ({ criterion, result: 'unknown', note: '' }))) }
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [scope, productionId, raw.artifactKey, raw.version, raw.contentHash, waitingForProcessing, processedKey, processedVersion, processedHash])
  useEffect(() => { onPending(dirty); return () => onPending(false) }, [dirty, onPending])
  useEffect(() => { if (choice) setDirty(false) }, [choice])
  const observe = useCallback((value: SoundObservation | null) => {
    setObservation(value)
    setChecks(old => old.map(c => c.result === 'pass' && !eligible(value?.audition, c.criterion, true)
      || c.result === 'fail' && !eligible(value?.audition, c.criterion, false) ? { ...c, result: 'unknown' as const } : c))
  }, [])
  const loadOriginal = useCallback(() => readAvgRawSoundCandidateV1({ scope, productionId,
    raw: { artifactKey: raw.artifactKey, version: raw.version, contentHash: raw.contentHash } }),
  [scope, productionId, raw.artifactKey, raw.version, raw.contentHash])
  const switchAudio = (next: typeof audioMode) => { if (next !== audioMode) { observe(null); setAudioMode(next) } }
  const a = observation?.audition
  const complete = !!a && a.outcome === 'ended' && !a.muted && a.volume > 0 && a.playbackRate === 1 && !a.seeked && a.completedCycles >= 1 && a.playedMs >= a.durationMs * a.completedCycles - 1
  const report = (): AvgSoundReviewIssuesV3 => {
    if (!selected) throw new Error('准确声音尚未核验')
    const t = selected.payload.requirement.template
    return { schema: 'storyforge.avg.review-issues', version: 3, targetKey: t.requirementKey,
      observations: observation ? ['audio'] : [], unobserved: [...(!complete ? ['尚未完整原速审听准确声音'] : []), ...checks.filter(c => c.result === 'unknown').map(c => `未观察：${LABELS[c.criterion]}`)],
      issues: checks.filter(c => c.result === 'fail').map(c => ({ issueKey: `sound.${c.criterion}`, locationKey: t.assetKey, severity: 'blocking', owner: 'media',
        evidence: c.note, allowedChange: repair, impact: '保留原音频和调用记录，本候选不能选用', recheck: `重新审听准确声音并复验${LABELS[c.criterion]}` })),
      soundEvidence: { audioHash: observation?.audioHash ?? null, requestIdentityHash: selected.payload.requirement.identityHash,
        audition: observation?.audition ?? null, checks, note } }
  }
  let selectable = false
  if (selected && review) { try { assertAvgSoundReviewMeasuredSelectableV3(review.payloadJson, { raw: selected.payload, audio: selected.measurement }); selectable = true } catch { /* retained unknown/failure remains visible */ } }
  const confirmCandidate = (row: ProductBuildArtifactRecordV1) => onAction(async () => {
    await confirmAvgWorkspaceInputV1({ scope, productionId, artifactKey: row.artifactKey, candidateVersion: row.version, candidateHash: candidateHash(row) })
    setDirty(false); await onReload()
  })
  return <section className="avg-sound-review" aria-label="声音审听与选择">
    {error && <p role="alert">{error}</p>}{waitingForProcessing && <p role="status">等待本批已确认的音量加工完成，再审听和选择加工后的声音。</p>}
    {!selected && !error && !waitingForProcessing && <p role="status">正在核验准确声音与来源…</p>}
    {(processed || waitingForProcessing) && <div className="avg-actions" aria-label="声音对照版本">
      <button className="lf-action" disabled={disabled} aria-pressed={audioMode === 'candidate'} onClick={() => switchAudio('candidate')}>审听加工候选</button>
      <button className="lf-action" disabled={disabled} aria-pressed={audioMode === 'original'} onClick={() => switchAudio('original')}>对照原始声音（只读）</button>
    </div>}
    {audioMode === 'original' && <OriginalAudioComparisonPlayer identityKey={`${raw.buildId}:${raw.controlEpoch}:${raw.artifactKey}:${raw.version}:${raw.contentHash}`}
      expectedContentHash={raw.contentHash} loadSource={loadOriginal} disabled={disabled}/>}
    {selected && <><h5>准确声音 · {selected.payload.requirement.template.purpose}</h5>
      {processed && <p>本轮评审针对加工后的版本；原音频与原始调用记录保留，审听结论只适用于这份加工音频。</p>}
      <p>{selected.measurement.durationMs} 毫秒 · {selected.measurement.channelCount} 声道</p>
      {processed && selected.originalMeasurement && <p>原始声音基准：{selected.originalMeasurement.decodedSampleRateHz.toLocaleString('zh-CN')} Hz ·
        {selected.originalMeasurement.integratedLufs.toFixed(1)} LUFS 响度估计 · {selected.originalMeasurement.truePeakDbtp.toFixed(1)} dBTP 峰值估计。</p>}
      <p>{processed ? '当前加工版本' : '当前原始版本'}技术分析：{selected.measurement.decodedSampleRateHz.toLocaleString('zh-CN')} Hz ·
        {selected.measurement.integratedLufs.toFixed(1)} LUFS 响度估计 · {selected.measurement.truePeakDbtp.toFixed(1)} dBTP 峰值估计
        {'loopSeamDbfs' in selected.measurement && <> · 循环接缝估计 {selected.measurement.loopSeamDbfs.toFixed(1)} dBFS</>}。</p>
      <p>这些是应用内解码分析值，不是专业听感、混音目标或广播符合性证明。</p>
      <p>许可：{selected.asset.license}。已核对音频与原始来源，选择仍需作者确认实际适用权利。
        {selected.payload.requirement.dispatch.operation === 'import-licensed-audio' && <a href={selected.payload.requirement.dispatch.source.publisherPage} target="_blank" rel="noreferrer">查看原始来源</a>}</p>
      {audioMode === 'candidate' && <SoundAuditionPlayer sourceKey={selected.sourceKey} data={selected.data} assetKey={selected.asset.assetKey} contentHash={selected.asset.contentHash}
        requestIdentityHash={selected.payload.requirement.identityHash} durationMs={selected.measurement.durationMs}
        channelCount={selected.measurement.channelCount} loop={selected.payload.requirement.template.cue.loop} variant={processed ? 'processed' : 'original'} disabled={disabled} onObservation={observe}/>}
      <fieldset className="avg-form" disabled={disabled || !canAdopt || !!choice || audioMode !== 'candidate'}><legend>逐项记录作者声音观察</legend>
        {checks.map((check, index) => <div className="avg-assembly-row" key={check.criterion}>
          <label>{LABELS[check.criterion]}<select aria-label={LABELS[check.criterion]} value={check.result} onChange={event => {
            const value = event.target.value as typeof check.result; setDirty(true); setChecks(old => old.map((c, i) => i === index ? { ...c, result: value } : c))
          }}><option value="unknown">未观察</option><option value="pass" disabled={!eligible(a, check.criterion, true)}>通过</option><option value="fail" disabled={!eligible(a, check.criterion, false)}>需返修</option></select></label>
          <label>观察依据<input value={check.note} maxLength={2000} onChange={event => { const value = event.target.value; setDirty(true); setChecks(old => old.map((c, i) => i === index ? { ...c, note: value } : c)) }}/></label>
        </div>)}
        <label>本轮声音审听依据<textarea value={note} maxLength={4000} onChange={e => { setNote(e.target.value); setDirty(true) }}/></label>
        {checks.some(c => c.result === 'fail') && <label>允许的声音返修范围<textarea value={repair} maxLength={4000} onChange={e => { setRepair(e.target.value); setDirty(true) }}/></label>}
        <button className="lf-action" disabled={!dirty || !note.trim() || !declaration.trim()} onClick={() => void onAction(async () => {
          await stageAvgSoundReviewV1({ scope, productionId, raw: ref(raw), ...(processed ? { processed: ref(processed) } : {}), report: report(), declaration }); setDirty(false); await onReload()
        })}>保存为待确认声音观察</button>
        <button className="lf-action" disabled={!dirty} onClick={() => { setChecks(old => old.map(c => ({ ...c, result: 'unknown', note: '' }))); setNote(''); setRepair(''); setDirty(false) }}>撤销未保存的声音观察</button>
      </fieldset></>}
    {review && <details><summary>已确认声音观察 v{review.version}</summary><Summary row={review}/></details>}
    {pendingReview && <details open><summary>待确认声音观察 v{pendingReview.version}</summary><Summary row={pendingReview}/>
      <button className="lf-action" disabled={disabled || dirty || !canAdopt || !!choice || !selected || audioMode !== 'candidate' || !candidateHash(pendingReview)} onClick={() => void confirmCandidate(pendingReview)}>确认这份声音观察</button></details>}
    {selected && !choice && <button className="lf-action" disabled={disabled || dirty || !!pendingReview || !canAdopt || !selectable || audioMode !== 'candidate' || !declaration.trim()} onClick={() => void onAction(async () => {
      await stageAvgSoundChoiceV1({ scope, productionId, raw: ref(raw), ...(processed ? { processed: ref(processed) } : {}), declaration }); await onReload()
    })}>{processed ? '将加工声音列为待确认选择' : '将原声音列为待确认选择'}</button>}
    {pendingChoice && <details open><summary>待确认声音选择 v{pendingChoice.version}</summary>
      <p>{parseAvgAuthorSoundChoice(pendingChoice.payloadJson).declaration}</p>
      <button className="lf-action" disabled={disabled || dirty || !canAdopt || !selected || audioMode !== 'candidate' || !candidateHash(pendingChoice)} onClick={() => void confirmCandidate(pendingChoice)}>{processed || processingRequired ? '确认采用加工声音' : '确认采用原声音'}</button></details>}
    {choice && <p>已采用声音 v{choice.version}。舞台配置和演出确认仍须另行完成。</p>}
    <p>播放记录及作者观察不证明独立听众、专业听感或商业作品通过。</p>
  </section>
}
