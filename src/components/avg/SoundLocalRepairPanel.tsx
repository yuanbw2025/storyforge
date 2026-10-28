import { canonicalProductProductionJsonV2 } from '../../lib/product-production/hash'
import { useEffect, useState } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import type { AvgAuthorWorkspaceV1 } from '../../lib/avg/author-workspace-contract'
import type { AvgAudioProcessingRecipeV2 } from '../../lib/avg/audio-processing-contract-v2'
import type { readAvgAssemblyWorkspaceV1 } from '../../lib/avg/assembly-service'
import { readAvgAdoptedGeneratedSoundV1 } from '../../lib/avg/stage-sound-sources'
import { saveAvgSoundLocalRepairDraftV1, clearAvgSoundLocalRepairDraftV1 } from '../../lib/avg/sound-local-repair-service'
import { AVG_AUDIO_GAIN_MIN_MILLI_DB_V1, AVG_AUDIO_GAIN_MAX_MILLI_DB_V1 } from '../../lib/avg/audio-gain-kernel'

type Props = {
  scope: WorkspaceScope; workspace: AvgAuthorWorkspaceV1; view: Awaited<ReturnType<typeof readAvgAssemblyWorkspaceV1>>
  enabled?: boolean; disabled: boolean; canEdit: boolean; onPending: (value: boolean) => void
  onAction: (action: () => Promise<void>) => Promise<void>; onReload: () => Promise<void>; onNotice: (value: string) => void
}
type Target = Awaited<ReturnType<typeof readAvgAdoptedGeneratedSoundV1>>
const NAMES = { bgm: '背景音乐', ambience: '环境声', sfx: '音效' }

/** The caller enables new proposals only after the whole repair chain is
 * available. Existing proposals remain readable and explicitly removable. */
export default function SoundLocalRepairPanel({ scope, workspace, view, enabled = false, disabled, canEdit,
  onPending, onAction, onReload, onNotice }: Props) {
  const [assetKey, setAssetKey] = useState(''), [gain, setGain] = useState('-3'), [declaration, setDeclaration] = useState('')
  const [limitPeaks, setLimitPeaks] = useState(false), [sampleRatePolicy, setSampleRatePolicy] = useState<'preserve' | 'explicit'>('preserve')
  const [targetSampleRateHz, setTargetSampleRateHz] = useState('48000'), [saving, setSaving] = useState(false), [error, setError] = useState('')
  const [loaded, setLoaded] = useState<{ identity: string; value: Target } | null>(null)
  const repair = workspace.soundLocalRepair, parent = view.details?.build
  const source = workspace.presentation.inheritedSounds?.find(entry => entry.assetKey === assetKey)?.source
  const identity = source ? JSON.stringify([assetKey, source]) : ''
  const target = loaded?.identity === identity ? loaded.value : null
  useEffect(() => { onPending(saving || enabled && !!assetKey && !repair); return () => onPending(false) }, [saving, enabled, assetKey, repair, onPending])
  useEffect(() => {
    let alive = true
    setLoaded(null); setError('')
    if (enabled && identity && !repair) void readAvgAdoptedGeneratedSoundV1({ scope, source: JSON.parse(identity)[1] }).then(value => {
      if (alive) setLoaded({ identity, value })
    }).catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { alive = false }
  }, [scope, identity, enabled, repair])
  const action = (task: () => Promise<void>) => onAction(async () => {
    setSaving(true); setError('')
    try { await task() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); throw cause }
    finally { setSaving(false) }
  })
  if (repair) {
    const template = repair.sourceScope.templates.find(row => row.requirementKey === repair.source.requirementKey)
    const execution = view.details?.executionBrief?.avgSoundPlanning
    const started = execution?.version === 2 && canonicalProductProductionJsonV2(execution.repair) === canonicalProductProductionJsonV2(repair)
    const configured = !workspace.presentation.inheritedSounds?.some(e => e.assetKey === repair.sourceAsset.assetKey && canonicalProductProductionJsonV2(e.source) === canonicalProductProductionJsonV2(repair.source))
    return <section className="lf-paper" aria-label="已保存的单项声音返修"><h4>单项声音返修要求已保存</h4>
      <p>{repair.sourceAsset.name}{template && <> · {NAMES[template.channel]}；原用途：{template.purpose}</>}</p>
      <p>基于预览版本 #{repair.parent.buildNumber}，只调整这一项。原音频和旧加工结果保留，不重新生成音乐或导入音效。</p>
      <p>相对原音频调整 {repair.recipe.gainMilliDb / 1000} dB；{repair.recipe.sampleRatePolicy === 'preserve' ? '保留原采样率' : `指定采样率 ${repair.recipe.targetSampleRateHz} Hz`}。
        {repair.recipe.version === 2 && repair.recipe.dynamics ? '缓和突出的音量尖峰。' : ''}</p>
      <p>{repair.declaration}</p>
      <p>{started ? parent?.previewHash ? '本次返修预览已完成。保留已采用声音并结束本批需求后，可以继续编辑下一版本。' : '本次返修已开始，请在声音工作台独立试听、采用和配置，再确认演出与预览。' : '请到制作页重新核对方案并明确开始；新结果仍须独立试听、采用和配置，其他媒资继续沿用。'}</p>
      <button type="button" className="lf-action" disabled={disabled || !canEdit || saving || configured || started} onClick={() => void action(async () => {
        await clearAvgSoundLocalRepairDraftV1({ scope, expectedDraftRevision: view.draft.revision }); await onReload()
        onNotice('单项声音返修要求已撤销，原音频和旧结果保留。请重新核对制作方案。')
      })}>撤销尚未开始的声音返修要求</button>
      {error && <p role="alert">{error}</p>}
    </section>
  }
  if (!enabled || !parent?.previewHash || workspace.voiceProduction || workspace.voiceLocalRepair || workspace.mediaBatch
    || workspace.imageProcessing || workspace.soundProduction || workspace.soundProcessing) return null
  const choices = workspace.presentation.inheritedSounds?.flatMap(entry => {
    const asset = workspace.presentation.stage.assets.find(row => row.assetKey === entry.assetKey)
    return asset && ['bgm', 'ambience', 'sfx'].includes(asset.kind) && asset.mimeType === 'audio/wav' ? [{ entry, asset }] : []
  }) ?? []
  if (!choices.length) return null
  const validGain = gain.trim() !== '' && Number.isFinite(Number(gain)) && Number(gain) >= AVG_AUDIO_GAIN_MIN_MILLI_DB_V1 / 1000
    && Number(gain) <= AVG_AUDIO_GAIN_MAX_MILLI_DB_V1 / 1000
  const validRate = sampleRatePolicy === 'preserve' || targetSampleRateHz.trim() !== '' && Number.isSafeInteger(Number(targetSampleRateHz))
    && Number(targetSampleRateHz) >= 8000 && Number(targetSampleRateHz) <= 48000
  const originalDurationMs = target?.originalAsset.durationMs
  const validTarget = !!target && target.asset.assetKey === assetKey && target.asset.mimeType === 'audio/wav'
    && target.originalAsset.mimeType === 'audio/wav' && originalDurationMs !== null && originalDurationMs !== undefined
    && Number.isFinite(originalDurationMs) && originalDurationMs > 0 && originalDurationMs <= 120_000
  const template = target?.rawPayload.requirement.template
  return <section className="lf-paper" aria-label="已完成声音的单项返修"><h4>只调整一项已采用声音 <small>实验</small></h4>
    <p>以当前预览版本 #{parent.buildNumber} 为基线，从保留的原音频重新调整。保存不生成或修改音频，原用途和其他媒资保持。</p>
    <fieldset className="avg-form" disabled={disabled || !canEdit || saving}><legend>选择已采用声音</legend>
      <label>返修声音<select value={assetKey} onChange={event => setAssetKey(event.target.value)}><option value="">请选择一项</option>
        {choices.map(({ asset }, index) => <option key={asset.assetKey} value={asset.assetKey}>{asset.name || `已采用声音 ${index + 1}`}</option>)}
      </select></label>
      {!!assetKey && !target && !error && <p role="status">正在核对已采用声音与原音频…</p>}
      {template && <><p>原用途：{template.purpose} · {NAMES[template.channel]} · {template.cue.loop ? '循环播放' : '播放一次'}</p>
        <label>相对原音频的音量增减（dB）<input type="number" step={0.1} value={gain}
          min={AVG_AUDIO_GAIN_MIN_MILLI_DB_V1 / 1000} max={AVG_AUDIO_GAIN_MAX_MILLI_DB_V1 / 1000} onChange={event => setGain(event.target.value)}/></label>
        <label><input type="checkbox" checked={limitPeaks} onChange={event => setLimitPeaks(event.target.checked)}/>缓和突出的音量尖峰</label>
        <label>采样率<select value={sampleRatePolicy} onChange={event => setSampleRatePolicy(event.target.value as 'preserve' | 'explicit')}>
          <option value="preserve">保留原采样率</option><option value="explicit">指定采样率</option></select></label>
        {sampleRatePolicy === 'explicit' && <label>指定采样率（Hz）<input type="number" min="8000" max="48000" step="1" list="sound-repair-sample-rates"
          value={targetSampleRateHz} onChange={event => setTargetSampleRateHz(event.target.value)}/>
          <datalist id="sound-repair-sample-rates">{[16000, 22050, 24000, 44100, 48000].map(rate => <option key={rate} value={rate}/>)}</datalist></label>}
        <label>本次返修说明<textarea maxLength={2000} value={declaration} onChange={event => setDeclaration(event.target.value)}/></label>
      </>}
      {target && !validTarget && <p role="alert">所选声音的原音频无法用于本地调整，请核对原件与已采用来源。</p>}
      <button type="button" className="lf-action" disabled={!validTarget || !validGain || !validRate || !declaration.trim()} onClick={() => void action(async () => {
        const original = { schema: 'storyforge.avg.audio-processing-recipe' as const, version: 1 as const, gainMilliDb: Math.round(Number(gain) * 1000),
          maximumDurationMs: Math.max(1000, Math.ceil(originalDurationMs!)), sampleRatePolicy: 'preserve' as const, channelPolicy: 'preserve' as const,
          timelinePolicy: 'preserve' as const, overflowPolicy: 'reject' as const, declaration }
        const advanced: AvgAudioProcessingRecipeV2 | undefined = limitPeaks || sampleRatePolicy === 'explicit'
          ? { ...original, version: 2, sampleRatePolicy, targetSampleRateHz: sampleRatePolicy === 'explicit' ? Number(targetSampleRateHz) : null,
            resampler: 'blackman-sinc64.v1', processingOrder: 'resample-gain-linked-limit.v1',
            dynamics: limitPeaks ? { processor: 'linked-lookahead-peak-limit.v1', ceilingMilliDbfs: -1500, lookaheadMs: 3, releaseMs: 80 } : null } : undefined
        await saveAvgSoundLocalRepairDraftV1({ scope, expectedDraftRevision: view.draft.revision, expectedBuildId: parent.id!,
          expectedBuildRevision: parent.stateRevision, expectedPreviewHash: parent.previewHash, assetKey, recipe: advanced ?? original })
        setAssetKey(''); await onReload(); onNotice('单项声音返修要求已保存，没有生成或修改音频。请到制作页核对方案后明确开始。')
      })}>以当前预览保存此声音返修</button>
      {!!assetKey && <button type="button" className="lf-action" onClick={() => {
        setAssetKey(''); setGain('-3'); setDeclaration(''); setLimitPeaks(false); setSampleRatePolicy('preserve'); setTargetSampleRateHz('48000'); setError('')
      }}>撤销未保存的声音返修选择</button>}
    </fieldset>
    {error && <p role="alert">{error}</p>}
  </section>
}
