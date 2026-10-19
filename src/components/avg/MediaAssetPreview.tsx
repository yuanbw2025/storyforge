import { readAvgRawImageCandidateBytesV5,readAvgProcessedImageCandidateBytesV5,type AvgV5PreviewBoundary } from '../../lib/avg/media-candidate-preview-v5'
import type { AvgVisualRawReuseSourceV4 } from '../../lib/avg/visual-image-reuse-contract'
import { useEffect, useRef, useState } from 'react'
import type { FrozenRuntimeMediaAssetV2, ProductMediaKind, WorkspaceScope } from '../../lib/types'
import { readAvgDraftMediaV1 } from '../../lib/avg/editor-service'
import { readAvgRawImageCandidateBytesV2, readAvgRetainedImageCandidateBytesV1,readAvgProcessedImageCandidateBytesV1 } from '../../lib/avg/assembly-service'
import { canonicalProductProductionJsonV2 } from '../../lib/product-production/hash'
import { readAvgAdoptedGeneratedImageV2 } from '../../lib/avg/media-generated-reference'
import type { AvgGeneratedImageSource } from '../../lib/avg/media-generated-reference-contract'
import { readAvgAdoptedGeneratedVoiceV1 } from '../../lib/avg/generated-voice-source'
import type { AvgGeneratedVoiceSourceV1 } from '../../lib/avg/stage-voice-source-contract'
import type { AvgHistoricalVisualBoundaryV4 } from '../../lib/avg/visual-image-history'

export const AVG_MEDIA_KIND_LABELS: Record<ProductMediaKind, string> = { background: '背景', 'character-pose': '角色姿势', 'character-expression': '角色表情',
  cg: 'CG', ui: '图标与界面', bgm: '音乐', ambience: '环境声', sfx: '音效', voice: '配音' }
export interface AvgRawPreviewReference { requirementKey: string; version: number; contentHash: string; visualVersion?:5;historicalV5?:AvgV5PreviewBoundary; retained?:boolean;processed?:boolean;historical?:Omit<AvgHistoricalVisualBoundaryV4,'scope'>;historicalSource?:AvgVisualRawReuseSourceV4 }

/** Local URLs are created only after the existing owner/hash proof reader.
 * Provider URL strings and arbitrary Blob IDs are never displayed directly. */
export default function MediaAssetPreview({ scope, asset, productionId, raw, rawSound, generatedSource, generatedVoiceSource, onObserved,onUnavailable,comparisonAspectRatio,smallImageSizes,caption }: {
  scope: WorkspaceScope; asset: FrozenRuntimeMediaAssetV2; productionId?: number | null; raw?: AvgRawPreviewReference; generatedSource?: AvgGeneratedImageSource; onObserved?: () => void;onUnavailable?:()=>void
  comparisonAspectRatio?:number;smallImageSizes?:readonly number[];caption?:string
  generatedVoiceSource?: AvgGeneratedVoiceSourceV1
  rawSound?: { artifactKey: string; version: number; contentHash: string }
}) {
  const [url, setUrl] = useState(''), [error, setError] = useState('')
  const [readAttempt, setReadAttempt] = useState(0)
  const [voiceOrigin, setVoiceOrigin] = useState<{ buildNumber: number; text: string; speaker: string; voiceId: string;
    declaration: string; reference: string } | null>(null)
  const unavailable=useRef(onUnavailable);unavailable.current=onUnavailable
  const audio = useRef<HTMLAudioElement>(null)
  const requirementKey = raw?.requirementKey, version = raw?.version, contentHash = raw?.contentHash
  const retained=raw?.retained??false
  const processed=raw?.processed??false,visualVersion=raw?.visualVersion
  const historicalV5Json=raw?.historicalV5?JSON.stringify(raw.historicalV5):''
  const historicalJson=raw?.historical?JSON.stringify(raw.historical):''
  const historicalSourceJson=raw?.historicalSource?JSON.stringify(raw.historicalSource):''
  const generatedSourceJson=generatedSource?JSON.stringify(generatedSource):''
  const generatedVoiceSourceJson = generatedVoiceSource ? JSON.stringify(generatedVoiceSource) : ''
  const assetJson = JSON.stringify(asset)
  const rawSoundJson = rawSound ? JSON.stringify(rawSound) : ''
  useEffect(() => {
    let alive = true, created = ''
    const element = audio.current
    setUrl(''); setError(''); setVoiceOrigin(null)
    const current = JSON.parse(assetJson) as FrozenRuntimeMediaAssetV2
    const read = async () => {
      if(historicalV5Json&&(visualVersion!==5||!requirementKey))throw new Error('新版历史预览缺少准确版本')
      if ([!!requirementKey, !!rawSoundJson, !!generatedSourceJson, !!generatedVoiceSourceJson].filter(Boolean).length > 1) throw new Error('媒资预览不能同时声明多种来源')
      if (rawSoundJson) {
        if (!productionId) throw new Error('原声音缺少准确制作来源')
        const candidate = await (await import('../../lib/avg/sound-workbench-service')).readAvgSoundCandidateV1({ scope, productionId, raw: JSON.parse(rawSoundJson) })
        if (canonicalProductProductionJsonV2(candidate.asset) !== canonicalProductProductionJsonV2(current)) throw new Error('显示声音与准确原音频不一致')
        return candidate.data
      }
      if(historicalSourceJson&&!historicalJson)throw new Error('便携原图预览缺少准确历史边界')
      if(historicalJson&&(!requirementKey||processed||retained))throw new Error('历史原图预览缺少准确来源或混入了其他加工来源')
      if (generatedVoiceSourceJson) {
        const candidate = await readAvgAdoptedGeneratedVoiceV1({ scope, source: JSON.parse(generatedVoiceSourceJson) as AvgGeneratedVoiceSourceV1 })
        if (canonicalProductProductionJsonV2(candidate.asset) !== canonicalProductProductionJsonV2(current)) throw new Error('显示配音与准确已采用来源不一致')
        if (alive) setVoiceOrigin({ buildNumber: candidate.source.raw.buildNumber, text: candidate.requirement.text,
          speaker: candidate.requirement.speakerKey ?? '旁白', voiceId: candidate.preset.voiceId,
          declaration: candidate.preset.rights.declaration, reference: candidate.preset.rights.reference })
        return candidate.data
      }
      if(generatedSourceJson){
        const candidate=await readAvgAdoptedGeneratedImageV2({scope,source:JSON.parse(generatedSourceJson) as AvgGeneratedImageSource})
        if(canonicalProductProductionJsonV2(candidate.asset)!==canonicalProductProductionJsonV2(current))throw new Error('显示图片与准确生成参考不一致')
        return candidate.data
      }
      if (!requirementKey) return readAvgDraftMediaV1(scope, current)
      if (!productionId || version === undefined || !contentHash) throw new Error('原图缺少准确制作来源')
      if(visualVersion===5&&(retained||historicalSourceJson||historicalJson))throw new Error('新版预览不能混入旧版原图复验来源')
      const reader=visualVersion===5?(processed?readAvgProcessedImageCandidateBytesV5:readAvgRawImageCandidateBytesV5)
        :processed?readAvgProcessedImageCandidateBytesV1:retained?readAvgRetainedImageCandidateBytesV1:readAvgRawImageCandidateBytesV2
      const candidate = historicalJson
        ?await(await import('../../lib/avg/visual-image-history')).readAvgHistoricalImageCandidateBytesV4({
          ...JSON.parse(historicalJson) as Omit<AvgHistoricalVisualBoundaryV4,'scope'>,scope,productionId,requirementKey,version,contentHash,...(historicalSourceJson?{source:JSON.parse(historicalSourceJson) as AvgVisualRawReuseSourceV4}:{})})
        :await reader({ scope, productionId, requirementKey, version, contentHash,...(historicalV5Json?{historical:JSON.parse(historicalV5Json) as AvgV5PreviewBoundary}:{}) })
      if (canonicalProductProductionJsonV2(candidate.asset) !== canonicalProductProductionJsonV2(current)) throw new Error('显示图片与准确原图不一致')
      return candidate.data
    }
    void read().then(bytes => {
      if (!alive) return
      created = URL.createObjectURL(new Blob([bytes], { type: current.mimeType })); setUrl(created)
    }).catch(cause => { if (alive){setError(String(cause));unavailable.current?.()} })
    return () => { alive = false; element?.pause(); if (created) URL.revokeObjectURL(created) }
  }, [scope, assetJson, productionId, requirementKey, version, contentHash, retained, processed, visualVersion, historicalV5Json, historicalJson, historicalSourceJson, generatedSourceJson, generatedVoiceSourceJson, rawSoundJson, readAttempt])
  return <figure className="avg-assembly-media-preview"><figcaption>{caption??asset.name} · {AVG_MEDIA_KIND_LABELS[asset.kind]}</figcaption>
    {error && <><p role="alert">{error}</p><button className="lf-action" aria-label={`重新读取媒资：${asset.name}`} onClick={()=>setReadAttempt(value=>value+1)}>重新读取媒资</button><p>重新核验已保存文件与准确来源，不会新增生成请求。</p></>}
    {asset.mimeType.startsWith('audio/') ? <audio ref={audio} controls src={url || undefined} preload="metadata" />
      : url ? <><img key={url} src={url} alt={asset.altText || asset.name} onLoad={onObserved} onError={historicalJson||historicalV5Json||visualVersion===5||generatedSourceJson||onUnavailable?()=>{setError('原图无法解码，请重新读取并核对文件。');unavailable.current?.()}:undefined} style={comparisonAspectRatio?{aspectRatio:comparisonAspectRatio}:undefined}/>
        {smallImageSizes&&<div className="avg-review-icon-sizes">{smallImageSizes.map(size=><img key={size} src={url} alt={`${asset.name} · ${size} 像素观察`} style={{width:size,height:size,objectFit:'contain'}}/>)}</div>}</> : <p>读取图片…</p>}
    <p>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : `${((asset.durationMs ?? 0) / 1000).toFixed(2)} 秒`} · {Math.ceil(asset.byteSize / 1024)} KiB</p>
    <p>来源：{asset.source} · 授权：{asset.license}</p>
    {voiceOrigin && <div aria-label="沿用配音来源">
      <p>原已采用版本 {voiceOrigin.buildNumber} · {voiceOrigin.speaker} · 音色 {voiceOrigin.voiceId}</p>
      <p>准确原句：{voiceOrigin.text}</p><p>音色使用权说明：{voiceOrigin.declaration}</p><p>条款或授权依据：{voiceOrigin.reference}</p>
    </div>}
  </figure>
}
