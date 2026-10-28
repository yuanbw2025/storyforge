import { useEffect, useState } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import type { AvgAuthorWorkspaceV1 } from '../../lib/avg/author-workspace-contract'
import type { AvgAudioProcessingRecipeV2 } from '../../lib/avg/audio-processing-contract-v2'
import type { AvgSoundPlanningScopeV1 } from '../../lib/avg/sound-scope-contract'
import type { AvgAudioProductionProcessingPlan } from '../../lib/avg/audio-production-contract'
import { avgAudioProcessingExecutionReadyV1 } from '../../lib/avg/audio-production-brief'
import { saveAvgSoundProcessingDraftV1 } from '../../lib/avg/sound-draft-service'
import { assertAvgSoundProcessingDraft, avgSoundProcessingDraftTargetsV1 } from '../../lib/avg/sound-processing-draft-contract'
import { AVG_AUDIO_GAIN_MIN_MILLI_DB_V1, AVG_AUDIO_GAIN_MAX_MILLI_DB_V1 } from '../../lib/avg/audio-gain-kernel'

type Props = {
  scope: WorkspaceScope; workspace: AvgAuthorWorkspaceV1; expectedDraftRevision: number
  disabled: boolean; canEdit: boolean; onPending: (value: boolean) => void
  onAction: (action: () => Promise<void>) => Promise<void>; onReload: () => Promise<void>; onNotice?: (text: string) => void
}
const NAMES = { bgm: '背景音乐', ambience: '环境声', sfx: '一次性音效' }

/** Save requirements before preparation/start. A closed processor still
 * permits a reviewable draft; this panel never plays or changes any audio. */
export default function SoundProcessingDraftPanel({ workspace, ...props }: Props) {
  const sound = workspace.soundProduction?.scope
  if (!sound) return null
  return <SavedSoundProcessingDraft key={JSON.stringify([props.scope.workId, sound, workspace.soundProcessing ?? null])}
    {...props} sound={sound} saved={workspace.soundProcessing}/>
}
function SavedSoundProcessingDraft({ scope, sound, saved, expectedDraftRevision, disabled, canEdit,
  onPending, onAction, onReload, onNotice }: Omit<Props, 'workspace'> & { sound: AvgSoundPlanningScopeV1; saved?: AvgAudioProductionProcessingPlan }) {
  const targets = avgSoundProcessingDraftTargetsV1(sound)
  const [rows, setRows] = useState(() => sound.templates.map(t => {
    const entry = saved?.entries.find(e => e.domain === 'sound' && e.requirementKey === t.requirementKey)
    const advanced = entry?.recipe.version === 2 ? entry.recipe : undefined
    return { requirementKey: t.requirementKey, enabled: !!entry, gainDb: String((entry?.recipe.gainMilliDb ?? 0) / 1000),
      version2: !!advanced, limitPeaks: !!advanced?.dynamics, sampleRatePolicy: advanced?.sampleRatePolicy ?? 'preserve',
      targetSampleRateHz: String(advanced?.targetSampleRateHz ?? 48000),
      dynamics: { ...(advanced?.dynamics ?? { processor: 'linked-lookahead-peak-limit.v1' as const, ceilingMilliDbfs: -1500, lookaheadMs: 3, releaseMs: 80 }) },
      maximumSeconds: String((entry?.recipe.maximumDurationMs ?? (t.source.kind === 'generate-music' ? t.source.durationSeconds * 1000 : 120_000)) / 1000),
      declaration: entry?.recipe.declaration ?? '' }
  }))
  const [baseline, setBaseline] = useState(rows), [saving, setSaving] = useState(false), [error, setError] = useState('')
  const pending = JSON.stringify(rows) !== JSON.stringify(baseline)
  useEffect(() => { onPending(pending || saving); return () => onPending(false) }, [pending, saving, onPending])
  const change = (index: number, update: Partial<typeof rows[number]>) => {
    setError(''); setRows(old => old.map((row, i) => i === index ? { ...row, ...update } : row))
  }
  const save = () => onAction(async () => {
    setSaving(true); setError('')
    try {
      const entries = rows.filter(row => row.enabled).map(row => {
        const gain = Number(row.gainDb), seconds = Number(row.maximumSeconds)
        if (!row.gainDb.trim() || !Number.isFinite(gain)
          || gain < AVG_AUDIO_GAIN_MIN_MILLI_DB_V1 / 1000 || gain > AVG_AUDIO_GAIN_MAX_MILLI_DB_V1 / 1000) {
          throw new Error('请填写有效的音量调整值。')
        }
        if (!row.maximumSeconds.trim() || !Number.isFinite(seconds) || seconds < 1 || seconds > 120) {
          throw new Error('请填写1至120秒之间的加工时长上限。')
        }
        const original = { schema: 'storyforge.avg.audio-processing-recipe' as const, version: 1 as const,
          gainMilliDb: Math.round(gain * 1000), maximumDurationMs: Math.round(seconds * 1000),
          sampleRatePolicy: 'preserve' as const, channelPolicy: 'preserve' as const, timelinePolicy: 'preserve' as const,
          overflowPolicy: 'reject' as const, declaration: row.declaration }
        if (!row.version2) return { domain: 'sound' as const, requirementKey: row.requirementKey, recipe: original }
        const rate = row.sampleRatePolicy === 'explicit' ? Number(row.targetSampleRateHz) : null
        if (rate !== null && (!row.targetSampleRateHz.trim() || !Number.isSafeInteger(rate) || rate < 8000 || rate > 48000)) {
          throw new Error('请填写8000至48000之间的整数采样率。')
        }
        const recipe: AvgAudioProcessingRecipeV2 = { ...original, version: 2, sampleRatePolicy: row.sampleRatePolicy,
          targetSampleRateHz: rate, resampler: 'blackman-sinc64.v1', processingOrder: 'resample-gain-linked-limit.v1',
          dynamics: row.limitPeaks ? { ...row.dynamics } : null }
        return { domain: 'sound' as const, requirementKey: row.requirementKey, recipe }
      })
      const plan = entries.length
        ? assertAvgSoundProcessingDraft({ schema: 'storyforge.avg.audio-production-processing-plan', version: entries.some(e => e.recipe.version === 2) ? 2 : 1, entries }, sound) : null
      await saveAvgSoundProcessingDraftV1({ scope, expectedDraftRevision, plan })
      setBaseline(rows); await onReload(); onNotice?.('声音音量调整要求已保存；准备制作方案时会一并核对。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause)); throw cause
    } finally { setSaving(false) }
  })
  return <section className="lf-paper avg-sound-processing-draft" aria-label="声音本地音量调整">
    <h4>声音本地音量调整 <small>实验</small></h4>
    <p>选择要调整的背景音乐、环境声或音效。原音频始终保留，调整保持原时长和声道，采样率默认保留；结果仍须独立审听、确认采用。</p>
    {!avgAudioProcessingExecutionReadyV1() && <p>目前可以保存调整要求，正式加工尚未开放。保存不会生成或修改音频。</p>}
    <fieldset className="avg-form" disabled={disabled || !canEdit || saving}><legend>已保存的声音需求</legend>
      {rows.map((row, index) => {
        const template = sound.templates[index], eligible = targets[index].mimeType === 'audio/wav'
        return <fieldset key={row.requirementKey}><legend>{NAMES[template.channel]} {index + 1}</legend>
          <p>{template.purpose}</p>
          <label><input type="checkbox" checked={row.enabled} disabled={!eligible}
            onChange={event => change(index, { enabled: event.target.checked })}/>调整此声音音量</label>
          {!eligible && <p>允许来源中包含OGG，当前保留原声音；音量调整仅处理全部允许来源均为WAV的需求。</p>}
          {row.enabled && <><label>音量增减（dB）<input type="number" min={AVG_AUDIO_GAIN_MIN_MILLI_DB_V1 / 1000}
            max={AVG_AUDIO_GAIN_MAX_MILLI_DB_V1 / 1000} step={0.1} value={row.gainDb}
            onChange={event => change(index, { gainDb: event.target.value })}/></label>
            <label>加工时长上限（秒）<input type="number" min={template.source.kind === 'generate-music' ? template.source.durationSeconds : 1}
              max="120" step="1" value={row.maximumSeconds} onChange={event => change(index, { maximumSeconds: event.target.value })}/></label>
            <p>超出时长或音频可承受范围时会停止，不会裁短。</p>
            <label><input type="checkbox" checked={row.limitPeaks} onChange={event => change(index, {
              limitPeaks: event.target.checked, version2: event.target.checked || row.sampleRatePolicy === 'explicit',
            })}/>缓和突出的音量尖峰</label>
            <label>采样率<select value={row.sampleRatePolicy} onChange={event => {
              const value = event.target.value as 'preserve' | 'explicit'
              change(index, { sampleRatePolicy: value, version2: value === 'explicit' || row.limitPeaks })
            }}><option value="preserve">保留原采样率</option><option value="explicit">指定采样率</option></select></label>
            {row.sampleRatePolicy === 'explicit' && <label>指定采样率（Hz）<input type="number" min="8000" max="48000" step="1"
              list={`sound-processing-rates-${index}`} value={row.targetSampleRateHz} onChange={event => change(index, { targetSampleRateHz: event.target.value })}/>
              <datalist id={`sound-processing-rates-${index}`}>{[16000, 22050, 24000, 44100, 48000].map(rate => <option key={rate} value={rate}/>)}</datalist></label>}
            <label>调整说明<textarea maxLength={2000} value={row.declaration}
              onChange={event => change(index, { declaration: event.target.value })}/></label></>}
        </fieldset>
      })}
      <button type="button" className="lf-action" disabled={!pending} onClick={() => void save()}>保存声音音量调整要求</button>
      <button type="button" className="lf-action" disabled={!pending} onClick={() => { setRows(baseline); setError('') }}>撤销未保存的声音音量调整</button>
    </fieldset>
    {error && <p role="alert">{error}</p>}
  </section>
}
