import { useEffect, useState } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import type { AvgAudioProcessingRecipeV2 } from '../../lib/avg/audio-processing-contract-v2'
import type { AvgAuthorWorkspaceV1 } from '../../lib/avg/author-workspace-contract'
import type { readAvgAssemblyWorkspaceV1 } from '../../lib/avg/assembly-service'
import { readAvgAdoptedGeneratedVoice } from '../../lib/avg/generated-voice-source'
import { readAvgVoiceDraftV1 } from '../../lib/avg/voice-draft-contract'
import { saveAvgVoiceLocalRepairDraftV2, clearAvgVoiceLocalRepairDraftV2 } from '../../lib/avg/voice-local-repair-service'
import { AVG_AUDIO_GAIN_MIN_MILLI_DB_V1, AVG_AUDIO_GAIN_MAX_MILLI_DB_V1 } from '../../lib/avg/audio-gain-kernel'

type Props = {
  scope: WorkspaceScope; workspace: AvgAuthorWorkspaceV1; view: Awaited<ReturnType<typeof readAvgAssemblyWorkspaceV1>>
  disabled: boolean; onPending: (value: boolean) => void; onAction: (task: () => Promise<void>) => Promise<void>
  onReload: () => Promise<void>; onNotice: (value: string) => void
}

export default function VoiceLocalRepairPanel({ scope, workspace, view, disabled, onPending, onAction, onReload, onNotice }: Props) {
  const [assetKey, setAssetKey] = useState(''), [gain, setGain] = useState('-3'), [declaration, setDeclaration] = useState('')
  const [limitPeaks, setLimitPeaks] = useState(false), [sampleRatePolicy, setSampleRatePolicy] = useState<'preserve' | 'explicit'>('preserve')
  const [targetSampleRateHz, setTargetSampleRateHz] = useState('48000')
  const [target, setTarget] = useState<Awaited<ReturnType<typeof readAvgAdoptedGeneratedVoice>> | null>(null), [error, setError] = useState('')
  const repair = workspace.voiceLocalRepair, parent = view.details?.build
  const source = workspace.presentation.inheritedVoices?.find(e => e.assetKey === assetKey)?.source
  const sourceJson = source ? JSON.stringify(source) : ''
  useEffect(() => { onPending(!!assetKey && !repair); return () => onPending(false) }, [assetKey, repair, onPending])
  useEffect(() => {
    let alive = true
    setTarget(null); setError('')
    if (sourceJson && !repair) void readAvgAdoptedGeneratedVoice({ scope, source: JSON.parse(sourceJson) }).then(result => {
      if (alive) setTarget(result)
    }).catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { alive = false }
  }, [scope, sourceJson, repair])
  if (repair) return <section aria-label="已保存的单句音量返修"><h4>单句音量返修要求已保存</h4>
    <p>{workspace.voiceProduction && readAvgVoiceDraftV1(workspace.voiceProduction).voice.batch.requirements[0].text}</p>
    <p>基于预览版本 #{repair.parentBuildNumber}，只处理这一句。原音频与旧加工结果保留，不重新调用配音模型。</p>
    <p>请到制作页重新核对方案并明确开始；新结果仍须独立试听、采用和配置。其他媒资继续沿用。</p>
    <button type="button" className="lf-action" disabled={disabled} onClick={() => void onAction(async () => {
      await clearAvgVoiceLocalRepairDraftV2({ scope, expectedDraftRevision: view.draft.revision }); await onReload()
      onNotice('本地返修草稿已撤销，原音频和旧结果保留。请重新核对制作方案。')
    })}>撤销尚未配置的新返修要求</button>
  </section>
  if (!parent?.previewHash || workspace.voiceProduction || workspace.mediaBatch || workspace.soundProduction
    || !workspace.presentation.inheritedVoices?.length) return null
  const validRate = sampleRatePolicy === 'preserve' || targetSampleRateHz.trim() !== '' && Number.isSafeInteger(Number(targetSampleRateHz))
    && Number(targetSampleRateHz) >= 8000 && Number(targetSampleRateHz) <= 48000
  const validGain = gain.trim() !== '' && Number.isFinite(Number(gain)) && Number(gain) >= AVG_AUDIO_GAIN_MIN_MILLI_DB_V1 / 1000
    && Number(gain) <= AVG_AUDIO_GAIN_MAX_MILLI_DB_V1 / 1000
  return <section aria-label="已完成配音的单句音量返修"><h4>只返修一句配音的音量 <small>实验</small></h4>
    <p>以当前预览版本 #{parent.buildNumber} 为基线，从保留的原音频重新调整这一句。保存不生成音频，其他台词和媒资不重做。</p>
    <fieldset className="avg-form" disabled={disabled}>
      <legend>选择已采用配音</legend>
      <label>返修句子<select value={assetKey} onChange={e => setAssetKey(e.target.value)}><option value="">请选择一句</option>
        {workspace.presentation.inheritedVoices.map(entry => <option key={entry.assetKey} value={entry.assetKey}>
          {workspace.presentation.stage.assets.find(a => a.assetKey === entry.assetKey)?.name ?? entry.assetKey}</option>)}
      </select></label>
      {target && <><p>{target.requirement.text}</p>
        <label>相对原音频的音量增减（dB）<input type="number" step={0.1} value={gain}
          min={AVG_AUDIO_GAIN_MIN_MILLI_DB_V1 / 1000} max={AVG_AUDIO_GAIN_MAX_MILLI_DB_V1 / 1000} onChange={e => setGain(e.target.value)} /></label>
        <label><input type="checkbox" checked={limitPeaks} onChange={e => setLimitPeaks(e.target.checked)}/>缓和突出的音量尖峰</label>
        <label>采样率<select value={sampleRatePolicy} onChange={e => setSampleRatePolicy(e.target.value as 'preserve' | 'explicit')}>
          <option value="preserve">保留原采样率</option><option value="explicit">指定采样率</option></select></label>
        {sampleRatePolicy === 'explicit' && <label>指定采样率（Hz）<input type="number" min="8000" max="48000" step="1" list="voice-repair-sample-rates"
          value={targetSampleRateHz} onChange={e => setTargetSampleRateHz(e.target.value)}/>
          <datalist id="voice-repair-sample-rates">{[16000, 22050, 24000, 44100, 48000].map(rate => <option key={rate} value={rate}/>)}</datalist></label>}
        <label>本次返修说明<textarea maxLength={2000} value={declaration} onChange={e => setDeclaration(e.target.value)} /></label>
      </>}
      <button type="button" className="lf-action" disabled={!target || !validGain || !validRate || !declaration.trim()} onClick={() => void onAction(async () => {
        const original = { schema: 'storyforge.avg.audio-processing-recipe' as const, version: 1 as const, gainMilliDb: Math.round(Number(gain) * 1000),
          maximumDurationMs: target!.requirement.maximumDurationMs, sampleRatePolicy: 'preserve' as const, channelPolicy: 'preserve' as const,
          timelinePolicy: 'preserve' as const, overflowPolicy: 'reject' as const, declaration }
        const advanced: AvgAudioProcessingRecipeV2 | undefined = limitPeaks || sampleRatePolicy === 'explicit'
          ? { ...original, version: 2, sampleRatePolicy, targetSampleRateHz: sampleRatePolicy === 'explicit' ? Number(targetSampleRateHz) : null,
            resampler: 'blackman-sinc64.v1', processingOrder: 'resample-gain-linked-limit.v1',
            dynamics: limitPeaks ? { processor: 'linked-lookahead-peak-limit.v1', ceilingMilliDbfs: -1500, lookaheadMs: 3, releaseMs: 80 } : null } : undefined
        await saveAvgVoiceLocalRepairDraftV2({ scope, expectedDraftRevision: view.draft.revision, expectedBuildId: parent.id!,
          expectedBuildRevision: parent.stateRevision, expectedPreviewHash: parent.previewHash, assetKey,
          recipe: advanced ?? original })
        await onReload(); onNotice('单句音量返修要求已保存，没有调用配音模型。请到制作页核对方案后明确开始。')
      })}>以当前预览保存此句音量返修</button>
      {!!assetKey && <button type="button" className="lf-action" onClick={() => { setAssetKey(''); setDeclaration(''); setLimitPeaks(false); setSampleRatePolicy('preserve'); setTargetSampleRateHz('48000') }}>撤销未保存的返修选择</button>}
    </fieldset>
    {error && <p role="alert">{error}</p>}
  </section>
}
