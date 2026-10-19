import { useCallback, useEffect, useState } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import { avgVoiceProductionEnabledV3 } from '../../lib/avg/assembly-contract'
import { parseAvgStoredAssemblyBriefV3 } from '../../lib/avg/voice-assembly-storage'
import { prepareAvgVoiceRecoveryBriefV1, readAvgRawVoiceCandidateV3, readAvgVoiceRecoveryOptionsV1, type readAvgAssemblyWorkspaceV1 } from '../../lib/avg/assembly-service'
import VoiceAuditionPlayer from './VoiceAuditionPlayer'
import MediaAssetPreview from './MediaAssetPreview'

type View = Awaited<ReturnType<typeof readAvgAssemblyWorkspaceV1>>
type Options = Awaited<ReturnType<typeof readAvgVoiceRecoveryOptionsV1>>
const noObservation = () => {} // Read-only comparison never writes an audition or pass.

function RecoveryVoiceAudio({ scope, productionId, item, disabled, onSeen }: {
  scope: WorkspaceScope; productionId: number; item: Options['voices'][number]; disabled: boolean
  onSeen: (key: string, hash: string) => void
}) {
  const [clip, setClip] = useState<Awaited<ReturnType<typeof readAvgRawVoiceCandidateV3>> | null>(null), [error, setError] = useState('')
  useEffect(() => {
    let active = true; setClip(null); setError('')
    if (item.version !== null && item.contentHash) void readAvgRawVoiceCandidateV3({ scope, productionId,
      requirementKey: item.requirementKey, version: item.version, contentHash: item.contentHash }).then(value => {
      if (!active) return
      setClip(value); onSeen(item.requirementKey, value.asset.contentHash)
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [scope, productionId, item.requirementKey, item.version, item.contentHash, onSeen])
  return <>{error && <p role="alert">{error}</p>}{!clip && !error && <p>正在核对原音频字节…</p>}
    {clip && <VoiceAuditionPlayer sourceKey={clip.sourceKey} data={clip.data} assetKey={clip.asset.assetKey}
      contentHash={clip.asset.contentHash} requestIdentityHash={clip.payload.request.identityHash}
      durationMs={clip.payload.measurement.durationMs} maximumDurationMs={clip.payload.requirement.maximumDurationMs}
      text={clip.payload.requirement.text} disabled={disabled} onObservation={noObservation} />}</>
}

export default function VoiceRecoveryPanel({ scope, view, disabled, visible, onPending, onAction, onReload, onNotice }: {
  scope: WorkspaceScope; view: View; disabled: boolean; visible: boolean; onPending: (value: boolean) => void
  onAction: (action: () => Promise<void>) => Promise<void>; onReload: () => Promise<void>; onNotice: (text: string) => void
}) {
  const build = view.details?.build, productionId = view.details?.production.id, stored = view.details?.executionBrief?.avgAssembly
  const eligible = !!build && !build.previewHash && stored?.version === 3 && ['cancelled', 'failed', 'recovery-required'].includes(build.status)
  const pendingBrief = eligible && view.details?.production.status === 'brief-ready' && view.details.brief?.revision !== build?.briefRevision
  const [options, setOptions] = useState<Options | null>(null), [error, setError] = useState('')
  const [voices, setVoices] = useState<string[]>([]), [images, setImages] = useState<string[]>([])
  const [seenVoices, setSeenVoices] = useState<Record<string, string>>({}), [seenImages, setSeenImages] = useState<Record<string, string>>({})
  const [voiceOpen, setVoiceOpen] = useState(''), [imageOpen, setImageOpen] = useState(''), [reviewed, setReviewed] = useState(false), [dirty, setDirty] = useState(false)
  const markVoiceSeen = useCallback((key: string, hash: string) => setSeenVoices(old => old[key] === hash ? old : { ...old, [key]: hash }), [])
  useEffect(() => {
    let active = true; setOptions(null); setVoices([]); setImages([]); setSeenVoices({}); setSeenImages({})
    setVoiceOpen(''); setImageOpen(''); setReviewed(false); setDirty(false); setError('')
    if (eligible && !pendingBrief && productionId) void readAvgVoiceRecoveryOptionsV1(scope, productionId)
      .then(value => { if (active) setOptions(value) }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [scope, productionId, build?.id, build?.stateRevision, eligible, pendingBrief])
  useEffect(() => { onPending(dirty); return () => onPending(false) }, [dirty, onPending])
  if (!eligible || !productionId || !build) return null
  if (pendingBrief && stored?.version === 3) {
    const a = parseAvgStoredAssemblyBriefV3(stored).assembly, recovery = a.voice.recovery
    return recovery ? <section aria-label="图音恢复方案"><h4>图音恢复方案已保存</h4>
      <p>保留 {recovery.retained.length} 句原音频；重录 {recovery.rerunRequirementKeys.length} 句。
        {a.image && `图片保留 ${a.image.imageRecovery?.retained.length ?? 0} 张，其余明确重做。`}</p>
      <p>请到制作页核对方案和本次请求上限，再明确开始新版本；仍须重新确认脚本、逐项评审/选择和演出，旧调用及费用记录保留。</p></section> : null
  }
  const voiceReruns = options?.voices.filter(r => !voices.includes(r.requirementKey)) ?? []
  const imageReruns = options?.images?.items.filter(r => !images.includes(r.requirementKey)) ?? []
  const blocked = [...voiceReruns, ...imageReruns].some(r => !!r.retryBlocker)
  const changed = () => { setDirty(true); setReviewed(false) }
  return <section aria-label="图音恢复方案"><h4>明确保留与重录</h4>
    <p>核对原始结果后逐项勾选保留，未勾选项将明确重录或重做。保留只复验原字节，新版本仍需重新审听/评审和采用；此处查看不会保存通过结论。</p>
    {error && <p role="alert">{error}</p>}{!options && !error && <p>正在核对原始字节、来源和调用记录…</p>}
    {options?.voices.map((item, index) => <article aria-label={`恢复配音：第 ${index + 1} 句`} key={item.requirementKey}>
      <p>{item.text}</p><p>音色 {item.voiceId} · 原始费用 {item.costUsd === null ? '未知，保留原回执' : `$${item.costUsd}`}</p>
      {item.asset && item.contentHash && item.version !== null ? <>
        <button className="lf-action" disabled={disabled} onClick={() => setVoiceOpen(voiceOpen === item.requirementKey ? '' : item.requirementKey)}>查看原音频：第 {index + 1} 句</button>
        {visible && voiceOpen === item.requirementKey && <RecoveryVoiceAudio key={`${build.id}:${item.requirementKey}:${item.contentHash}`} scope={scope} productionId={productionId} item={item} disabled={disabled} onSeen={markVoiceSeen} />}
        <label><input type="checkbox" checked={voices.includes(item.requirementKey)} disabled={disabled || seenVoices[item.requirementKey] !== item.contentHash}
          onChange={e => { setVoices(e.target.checked ? [...voices, item.requirementKey] : voices.filter(k => k !== item.requirementKey)); changed() }} />保留本句原音频待复验</label>
      </> : <p>没有可保留的准确原音频：{item.issue}</p>}
      {!voices.includes(item.requirementKey) && item.retryBlocker && <p role="alert">{item.retryBlocker}</p>}
    </article>)}
    {options?.images && <section aria-label="本次图片保留或重做"><h5>同时明确图片决定</h5>
      {options.images.items.map(item => <article key={item.requirementKey}><strong>{item.name}</strong>
        {item.asset && item.proof ? <><button className="lf-action" disabled={disabled} onClick={() => setImageOpen(imageOpen === item.requirementKey ? '' : item.requirementKey)}>查看保留原图：{item.name}</button>
          {visible && imageOpen === item.requirementKey && <MediaAssetPreview scope={scope} productionId={productionId} asset={item.asset}
            raw={{ requirementKey: item.requirementKey, version: item.proof.artifactVersion, contentHash: item.proof.contentHash, retained: true }}
            onObserved={() => setSeenImages(old => old[item.requirementKey] === item.proof!.contentHash ? old : { ...old, [item.requirementKey]: item.proof!.contentHash })} />}
          <label><input type="checkbox" checked={images.includes(item.requirementKey)} disabled={disabled || seenImages[item.requirementKey] !== item.proof.contentHash}
            onChange={e => { setImages(e.target.checked ? [...images, item.requirementKey] : images.filter(k => k !== item.requirementKey)); changed() }} />保留原图：{item.name}</label>
        </> : <p>没有可保留的原图：{item.issue}</p>}
        {!images.includes(item.requirementKey) && item.retryBlocker && <p role="alert">{item.retryBlocker}</p>}
      </article>)}
    </section>}
    <p>新版本：保留 {voices.length} 句，至多 {voiceReruns.length} 次配音请求；保留 {images.length} 张图片，至多 {imageReruns.length} 次图片请求。原始未知费用不会变成零。</p>
    <label><input type="checkbox" checked={reviewed} disabled={disabled || !options} onChange={e => { setReviewed(e.target.checked); setDirty(true) }} />我已核对保留/重做清单、原始调用和费用；明确开始后才执行，旧记录保留</label>
    <button className="lf-action" disabled={disabled || !options || !reviewed || blocked || !avgVoiceProductionEnabledV3()} onClick={() => void onAction(async () => {
      await prepareAvgVoiceRecoveryBriefV1({ scope, productionId, expectedDraftRevision: view.draft.revision, expectedBuildId: options!.buildId,
        expectedBuildRevision: options!.buildRevision, retainedRequirementKeys: voices,
        ...(options!.images ? { retainedImageRequirementKeys: images } : {}),
        declaration: '作者明确保留本次勾选的准确原音频/原图，其他项在新版本明确开始后至多各请求一次；保留项重新评审/审听和采用，原始结果、失败和未知费用不改写。' })
      setDirty(false); await onReload(); onNotice('图音恢复方案已保存，尚未开始。请到制作页核对并明确开始新版本。')
    })}>准备图音恢复方案</button>
    {dirty && <button className="lf-action" disabled={disabled} onClick={() => { setVoices([]); setImages([]); setReviewed(false); setDirty(false) }}>撤销未保存的恢复选择</button>}
  </section>
}
