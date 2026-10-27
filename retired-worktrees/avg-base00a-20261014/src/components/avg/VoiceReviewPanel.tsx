import { useCallback, useEffect, useState } from 'react'
import type { ProductBuildArtifactRecordV1, WorkspaceScope } from '../../lib/types'
import type { AvgReviewIssuesV1 } from '../../lib/avg/artifact-contract'
import { AVG_VOICE_REVIEW_CRITERIA_V1, type AvgAuthorVoiceEvidenceV1, type AvgVoiceReviewCriterionV1 } from '../../lib/avg/voice-review-contract'
import { assertAvgVoiceReviewMeasuredSelectableV1, parseAvgAuthorVoiceReviewV1 } from '../../lib/avg/voice-review'
import { parseAvgAuthorVoiceChoice } from '../../lib/avg/audio-choice-dispatch'
import { confirmAvgWorkspaceInputV1, readAvgVoiceCandidateV3, stageAvgAudioReviewV3, stageAvgVoiceChoiceV3 } from '../../lib/avg/assembly-service'
import VoiceAuditionPlayer from './VoiceAuditionPlayer'

const LABELS: Record<AvgVoiceReviewCriterionV1, string> = {
  'text-match': '与原句一致', pronunciation: '读音', delivery: '演法', 'clip-boundaries': '首尾完整', noise: '噪音与破音',
}
const defaults = (): AvgAuthorVoiceEvidenceV1['checks'] => AVG_VOICE_REVIEW_CRITERIA_V1.map(criterion => ({ criterion, result: 'unknown', note: '' }))
type Observation = Pick<AvgAuthorVoiceEvidenceV1, 'audioHash' | 'requestIdentityHash'> & { audition: NonNullable<AvgAuthorVoiceEvidenceV1['audition']> }
type Selected = Awaited<ReturnType<typeof readAvgVoiceCandidateV3>>
type Props = {
  scope: WorkspaceScope; productionId: number; raw: ProductBuildArtifactRecordV1; processed?: ProductBuildArtifactRecordV1
  review?: ProductBuildArtifactRecordV1; pendingReview?: ProductBuildArtifactRecordV1
  choice?: ProductBuildArtifactRecordV1; pendingChoice?: ProductBuildArtifactRecordV1
  disabled: boolean; canAdopt: boolean; declaration: string
  onPending: (value: boolean) => void; onAction: (task: () => Promise<void>) => Promise<void>; onReload: () => Promise<void>
}
function candidateHash(row?: ProductBuildArtifactRecordV1) {
  try { return row ? String(JSON.parse(row.metadataJson).candidateHash ?? '') : '' } catch { return '' }
}

function ReviewSummary({ row }: { row: ProductBuildArtifactRecordV1 }) {
  try {
    const report = parseAvgAuthorVoiceReviewV1(row.payloadJson), evidence = report.audioEvidence!
    return <><p>{evidence.note}</p><ul>{evidence.checks.map(c => <li key={c.criterion}>{LABELS[c.criterion]}：{c.result === 'pass' ? '通过' : c.result === 'fail' ? '需返修' : '未观察'} · {c.note}</li>)}</ul>
      {report.unobserved.length > 0 && <p>尚未观察：{report.unobserved.join('；')}</p>}
      {report.issues.map(issue => <p key={issue.issueKey}>问题：{issue.evidence}；返修范围：{issue.allowedChange}；复验：{issue.recheck}</p>)}</>
  } catch { return <p role="alert">审听记录无法核验，请保留原记录并检查本版本来源。</p> }
}

function ChoiceSummary({ row }: { row: ProductBuildArtifactRecordV1 }) {
  try {
    const choice = parseAvgAuthorVoiceChoice(row.payloadJson)
    return <><p>音频：{choice.asset.name} · {choice.asset.durationMs} 毫秒</p><p>{choice.declaration}</p><p>使用权仍须按本批音色声明及实际服务条款核对。</p></>
  } catch { return <p role="alert">配音选择无法核验，请保留原记录并检查本版本来源。</p> }
}

/** A single selected clip owns the bytes/URL and native playback generation.
 * Loading, author assessment, pending save, confirmation and selection are
 * distinct operations. Unknown/failed observations remain reviewable.
 */
export default function VoiceReviewPanel(props: Props) {
  return <CurrentVoiceReview key={`${props.scope.workId}:${props.raw.buildId}:${props.raw.controlEpoch}:${props.raw.artifactKey}:${props.raw.version}:${props.raw.contentHash}:${props.processed?.version ?? ''}:${props.processed?.contentHash ?? ''}`} {...props} />
}

function CurrentVoiceReview({ scope, productionId, raw, processed, review, pendingReview, choice, pendingChoice,
  disabled, canAdopt, declaration, onPending, onAction, onReload }: Props) {
  const [selected, setSelected] = useState<Selected | null>(null), [error, setError] = useState('')
  const [observation, setObservation] = useState<Observation | null>(null), [checks, setChecks] = useState(defaults)
  const [note, setNote] = useState(''), [repair, setRepair] = useState(''), [dirty, setDirty] = useState(false)
  const locked = !!choice
  const processedVersion = processed?.version, processedContentHash = processed?.contentHash
  useEffect(() => {
    let active = true
    setSelected(null); setError('')
    void readAvgVoiceCandidateV3({ scope, productionId, requirementKey: raw.artifactKey.slice('avg.voice.raw.'.length),
      version: raw.version, contentHash: raw.contentHash,
      ...(processedVersion !== undefined && processedContentHash ? { processed: { version: processedVersion, contentHash: processedContentHash } } : {}) }).then(value => { if (active) setSelected(value) })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [scope, productionId, raw.artifactKey, raw.version, raw.contentHash, processedVersion, processedContentHash])
  useEffect(() => { onPending(dirty); return () => onPending(false) }, [dirty, onPending])
  useEffect(() => { if (locked) setDirty(false) }, [locked])
  const observe = useCallback((value: Observation | null) => {
    setObservation(value)
    const a = value?.audition, complete = a?.outcome === 'ended' && !a.muted && a.volume > 0 && a.playbackRate === 1 && !a.seeked && a.playedMs >= a.durationMs - 1
    const partlyHeard = a && a.playedMs > 0 && !a.muted && a.volume > 0 && a.playbackRate === 1 && !a.seeked
    setChecks(old => old.map(c => !complete && c.result === 'pass' || !partlyHeard && c.result === 'fail' ? { ...c, result: 'unknown' as const } : c))
  }, [])
  const a = observation?.audition
  const complete = !!a && a.outcome === 'ended' && !a.muted && a.volume > 0 && a.playbackRate === 1 && !a.seeked && a.playedMs >= a.durationMs - 1
  const partlyHeard = !!a && a.playedMs > 0 && !a.muted && a.volume > 0 && a.playbackRate === 1 && !a.seeked
  const report = (): AvgReviewIssuesV1 => {
    if (!selected) throw new Error('准确音频尚未核验')
    const r = selected.payload.requirement
    return { schema: 'storyforge.avg.review-issues', version: 1, targetKey: r.requirementKey,
      observations: observation ? ['audio'] : [],
      unobserved: [...(!complete ? ['尚未完整原速审听准确音频'] : []), ...checks.filter(c => c.result === 'unknown').map(c => `未观察：${LABELS[c.criterion]}`)],
      issues: checks.filter(c => c.result === 'fail').map(c => ({ issueKey: `audio.${c.criterion}`, locationKey: r.assetKey,
        evidence: c.note, severity: 'blocking' as const, owner: 'media' as const, allowedChange: repair,
        impact: '本候选不能选用，保留原始音频、费用与审听记录', recheck: `重新审听准确音频，并复验${LABELS[c.criterion]}` })),
      audioEvidence: { audioHash: observation?.audioHash ?? null, requestIdentityHash: selected.payload.request.identityHash,
        audition: observation?.audition ?? null, checks, note } }
  }
  let selectable = false
  if (selected && review) { try { assertAvgVoiceReviewMeasuredSelectableV1(review.payloadJson, {
    requirement: selected.payload.requirement, requestIdentityHash: selected.payload.request.identityHash,
    audio: { contentHash: selected.asset.contentHash, durationMs: selected.asset.durationMs! },
  }); selectable = true } catch { /* Show retained problems; never infer pass. */ } }
  const confirmCandidate = (row: ProductBuildArtifactRecordV1) => onAction(async () => {
    await confirmAvgWorkspaceInputV1({ scope, productionId, artifactKey: row.artifactKey, candidateVersion: row.version, candidateHash: candidateHash(row) })
    setDirty(false); await onReload()
  })
  return <section className="avg-voice-review" aria-label="配音审听与选择">
    {error && <p role="alert">{error}</p>}
    {!selected && !error && <p role="status">正在核验准确配音与来源…</p>}
    {selected && <>
      <h5>当前句子的配音</h5>
      {processed && <p>正在审听加工后的版本；原音频与原始调用记录保留，审听结论只适用于这份加工音频。</p>}
      <p>音色 {selected.payload.preset.voiceId} · {selected.payload.measurement.durationMs} 毫秒</p>
      <p>音色使用权说明：{selected.payload.preset.rights.declaration}</p><p>依据：{selected.payload.preset.rights.reference}</p>
      <p>原始调用费用：{selected.payload.provider.costUsd === null ? '未知，保留原回执' : `$${selected.payload.provider.costUsd}`}。选择配音仍须满足服务条款和作品使用权利。</p>
      <VoiceAuditionPlayer sourceKey={selected.sourceKey} data={selected.data} assetKey={selected.asset.assetKey}
        contentHash={selected.asset.contentHash} requestIdentityHash={selected.payload.request.identityHash}
        durationMs={selected.asset.durationMs!} maximumDurationMs={selected.payload.requirement.maximumDurationMs}
        text={selected.payload.requirement.text} disabled={disabled} onObservation={observe} />
      <fieldset className="avg-form" disabled={disabled || !canAdopt || locked}>
        <legend>逐项记录作者观察</legend>
        {checks.map((check, index) => <div className="avg-assembly-row" key={check.criterion}>
          <label>{LABELS[check.criterion]}<select aria-label={LABELS[check.criterion]} value={check.result} onChange={event => { setDirty(true); setChecks(old => old.map((c, i) => i === index ? { ...c, result: event.target.value as typeof c.result } : c)) }}>
            <option value="unknown">未观察</option><option value="pass" disabled={!complete}>通过</option><option value="fail" disabled={!partlyHeard}>需返修</option>
          </select></label>
          <label>观察依据<input value={check.note} maxLength={2000} onChange={event => { setDirty(true); setChecks(old => old.map((c, i) => i === index ? { ...c, note: event.target.value } : c)) }} /></label>
        </div>)}
        <label>本轮审听依据<textarea value={note} maxLength={4000} onChange={event => { setNote(event.target.value); setDirty(true) }} /></label>
        {checks.some(c => c.result === 'fail') && <label>允许的返修范围<textarea value={repair} maxLength={4000} onChange={event => { setRepair(event.target.value); setDirty(true) }} /></label>}
        <button className="lf-action" disabled={!dirty || !note.trim() || !declaration.trim()} onClick={() => void onAction(async () => {
          await stageAvgAudioReviewV3({ scope, productionId, requirementKey: selected.payload.requirement.requirementKey,
            rawVersion: raw.version, rawContentHash: raw.contentHash,
            ...(processed ? { processed: { version: processed.version, contentHash: processed.contentHash } } : {}), report: report(), declaration })
          setDirty(false); await onReload()
        })}>保存为待确认审听记录</button>
        <button className="lf-action" disabled={!dirty} onClick={() => { setChecks(defaults()); setNote(''); setRepair(''); setDirty(false) }}>撤销未保存的观察</button>
      </fieldset>
    </>}
    {review && <details><summary>已确认审听记录 v{review.version}</summary><ReviewSummary row={review}/><p>作者观察不等于独立专业配音或商业验收。</p></details>}
    {pendingReview && <details open><summary>待确认审听记录 v{pendingReview.version}</summary><ReviewSummary row={pendingReview}/>
      <button className="lf-action" disabled={disabled || dirty || !canAdopt || locked || !selected || !candidateHash(pendingReview)} onClick={() => void confirmCandidate(pendingReview)}>确认这份审听记录</button></details>}
    {selected && !choice && <button className="lf-action" disabled={disabled || dirty || !canAdopt || !selectable || !declaration.trim()} onClick={() => void onAction(async () => {
      await stageAvgVoiceChoiceV3({ scope, productionId, requirementKey: selected.payload.requirement.requirementKey,
        rawVersion: raw.version, rawContentHash: raw.contentHash,
        ...(processed ? { processed: { version: processed.version, contentHash: processed.contentHash } } : {}), declaration }); await onReload()
    })}>将这版配音列为待确认选择</button>}
    {pendingChoice && <details open><summary>待确认配音选择 v{pendingChoice.version}</summary><ChoiceSummary row={pendingChoice}/>
      <button className="lf-action" disabled={disabled || dirty || !canAdopt || !selected || !candidateHash(pendingChoice)} onClick={() => void confirmCandidate(pendingChoice)}>确认采用这版配音</button></details>}
    {choice && <p>已采用配音 v{choice.version}。审听记录已被选择消费；配置舞台和演出确认仍是后续步骤。</p>}
  </section>
}
