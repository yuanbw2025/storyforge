import { useEffect, useRef, useState } from 'react'
import type { FrozenRuntimeMediaAssetV2, ProductMediaKind, WorkspaceScope } from '../../lib/types'
import { readAvgDraftMediaV1 } from '../../lib/avg/editor-service'
import { readAvgRawImageCandidateBytesV2, readAvgRetainedImageCandidateBytesV1,readAvgProcessedImageCandidateBytesV1 } from '../../lib/avg/assembly-service'
import { canonicalProductProductionJsonV2 } from '../../lib/product-production/hash'
import { readAvgAdoptedGeneratedImageV1 } from '../../lib/avg/media-generated-reference'
import type { AvgGeneratedReferenceSourceV1 } from '../../lib/avg/media-generated-reference-contract'
import { readAvgAdoptedGeneratedVoiceV1 } from '../../lib/avg/generated-voice-source'
import type { AvgGeneratedVoiceSourceV1 } from '../../lib/avg/stage-voice-source-contract'

export const AVG_MEDIA_KIND_LABELS: Record<ProductMediaKind, string> = { background: '背景', 'character-pose': '角色姿势', 'character-expression': '角色表情',
  cg: 'CG', ui: '图标与界面', bgm: '音乐', ambience: '环境声', sfx: '音效', voice: '配音' }
export interface AvgRawPreviewReference { requirementKey: string; version: number; contentHash: string; retained?:boolean;processed?:boolean }

/** Local URLs are created only after the existing owner/hash proof reader.
 * Provider URL strings and arbitrary Blob IDs are never displayed directly. */
export default function MediaAssetPreview({ scope, asset, productionId, raw, generatedSource, generatedVoiceSource, onObserved,comparisonAspectRatio,smallImageSizes,caption }: {
  scope: WorkspaceScope; asset: FrozenRuntimeMediaAssetV2; productionId?: number | null; raw?: AvgRawPreviewReference; generatedSource?: AvgGeneratedReferenceSourceV1; onObserved?: () => void
  comparisonAspectRatio?:number;smallImageSizes?:readonly number[];caption?:string
  generatedVoiceSource?: AvgGeneratedVoiceSourceV1
}) {
  const [url, setUrl] = useState(''), [error, setError] = useState('')
  const [readAttempt, setReadAttempt] = useState(0)
  const [voiceOrigin, setVoiceOrigin] = useState<{ buildNumber: number; text: string; speaker: string; voiceId: string;
    declaration: string; reference: string } | null>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const requirementKey = raw?.requirementKey, version = raw?.version, contentHash = raw?.contentHash
  const retained=raw?.retained??false
  const processed=raw?.processed??false
  const generatedSourceJson=generatedSource?JSON.stringify(generatedSource):''
  const generatedVoiceSourceJson = generatedVoiceSource ? JSON.stringify(generatedVoiceSource) : ''
  const assetJson = JSON.stringify(asset)
  useEffect(() => {
    let alive = true, created = ''
    const element = audio.current
    setUrl(''); setError(''); setVoiceOrigin(null)
    const current = JSON.parse(assetJson) as FrozenRuntimeMediaAssetV2
    const read = async () => {
      if ([!!requirementKey, !!generatedSourceJson, !!generatedVoiceSourceJson].filter(Boolean).length > 1) throw new Error('媒资预览不能同时声明多种来源')
      if (generatedVoiceSourceJson) {
        const candidate = await readAvgAdoptedGeneratedVoiceV1({ scope, source: JSON.parse(generatedVoiceSourceJson) as AvgGeneratedVoiceSourceV1 })
        if (canonicalProductProductionJsonV2(candidate.asset) !== canonicalProductProductionJsonV2(current)) throw new Error('显示配音与准确已采用来源不一致')
        if (alive) setVoiceOrigin({ buildNumber: candidate.source.raw.buildNumber, text: candidate.requirement.text,
          speaker: candidate.requirement.speakerKey ?? '旁白', voiceId: candidate.preset.voiceId,
          declaration: candidate.preset.rights.declaration, reference: candidate.preset.rights.reference })
        return candidate.data
      }
      if(generatedSourceJson){
        const candidate=await readAvgAdoptedGeneratedImageV1({scope,source:JSON.parse(generatedSourceJson) as AvgGeneratedReferenceSourceV1})
        if(canonicalProductProductionJsonV2(candidate.asset)!==canonicalProductProductionJsonV2(current))throw new Error('显示图片与准确生成参考不一致')
        return candidate.data
      }
      if (!requirementKey) return readAvgDraftMediaV1(scope, current)
      if (!productionId || version === undefined || !contentHash) throw new Error('原图缺少准确制作来源')
      const reader=processed?readAvgProcessedImageCandidateBytesV1:retained?readAvgRetainedImageCandidateBytesV1:readAvgRawImageCandidateBytesV2
      const candidate = await reader({ scope, productionId, requirementKey, version, contentHash })
      if (canonicalProductProductionJsonV2(candidate.asset) !== canonicalProductProductionJsonV2(current)) throw new Error('显示图片与准确原图不一致')
      return candidate.data
    }
    void read().then(bytes => {
      if (!alive) return
      created = URL.createObjectURL(new Blob([bytes], { type: current.mimeType })); setUrl(created)
    }).catch(cause => { if (alive) setError(String(cause)) })
    return () => { alive = false; element?.pause(); if (created) URL.revokeObjectURL(created) }
  }, [scope, assetJson, productionId, requirementKey, version, contentHash, retained, processed, generatedSourceJson, generatedVoiceSourceJson, readAttempt])
  return <figure className="avg-assembly-media-preview"><figcaption>{caption??asset.name} · {AVG_MEDIA_KIND_LABELS[asset.kind]}</figcaption>
    {error && <><p role="alert">{error}</p><button className="lf-action" aria-label={`重新读取媒资：${asset.name}`} onClick={()=>setReadAttempt(value=>value+1)}>重新读取媒资</button><p>重新核验已保存文件与准确来源，不会新增生成请求。</p></>}
    {asset.mimeType.startsWith('audio/') ? <audio ref={audio} controls src={url || undefined} preload="metadata" />
      : url ? <><img src={url} alt={asset.altText || asset.name} onLoad={onObserved} style={comparisonAspectRatio?{aspectRatio:comparisonAspectRatio}:undefined}/>
        {smallImageSizes&&<div className="avg-review-icon-sizes">{smallImageSizes.map(size=><img key={size} src={url} alt={`${asset.name} · ${size} 像素观察`} style={{width:size,height:size,objectFit:'contain'}}/>)}</div>}</> : <p>读取图片…</p>}
    <p>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : `${((asset.durationMs ?? 0) / 1000).toFixed(2)} 秒`} · {Math.ceil(asset.byteSize / 1024)} KiB</p>
    <p>来源：{asset.source} · 授权：{asset.license}</p>
    {voiceOrigin && <div aria-label="沿用配音来源">
      <p>原已采用版本 {voiceOrigin.buildNumber} · {voiceOrigin.speaker} · 音色 {voiceOrigin.voiceId}</p>
      <p>准确原句：{voiceOrigin.text}</p><p>音色使用权说明：{voiceOrigin.declaration}</p><p>条款或授权依据：{voiceOrigin.reference}</p>
    </div>}
  </figure>
}
