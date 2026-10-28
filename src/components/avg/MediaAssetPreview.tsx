import { readAvgRawImageCandidateBytesV5,readAvgProcessedImageCandidateBytesV5,type AvgV5PreviewBoundary,type AvgV5ProcessedImageDisplayEvidence } from '../../lib/avg/media-candidate-preview-v5'
import type { AvgVisualRawReuseSourceV4 } from '../../lib/avg/visual-image-reuse-contract'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { FrozenRuntimeMediaAssetV2, ProductMediaKind, WorkspaceScope } from '../../lib/types'
import { readAvgDraftMediaV1 } from '../../lib/avg/editor-service'
import { readAvgRawImageCandidateBytesV2, readAvgRetainedImageCandidateBytesV1,readAvgProcessedImageCandidateBytesV1 } from '../../lib/avg/assembly-service'
import { canonicalProductProductionJsonV2 } from '../../lib/product-production/hash'
import { readAvgAdoptedGeneratedImageV2 } from '../../lib/avg/media-generated-reference'
import type { AvgGeneratedImageSource } from '../../lib/avg/media-generated-reference-contract'
import { readAvgAdoptedGeneratedVoice } from '../../lib/avg/generated-voice-source'
import type { AvgGeneratedVoiceSource } from '../../lib/avg/stage-processed-voice-source-contract'
import type { AvgHistoricalVisualBoundaryV4 } from '../../lib/avg/visual-image-history'

export const AVG_MEDIA_KIND_LABELS: Record<ProductMediaKind, string> = { background: '背景', 'character-pose': '角色姿势', 'character-expression': '角色表情',
  cg: 'CG', ui: '图标与界面', bgm: '音乐', ambience: '环境声', sfx: '音效', voice: '配音' }
export interface AvgRawPreviewReference { requirementKey: string; version: number; contentHash: string; visualVersion?:5;historicalV5?:AvgV5PreviewBoundary; retained?:boolean;processed?:boolean;historical?:Omit<AvgHistoricalVisualBoundaryV4,'scope'>;historicalSource?:AvgVisualRawReuseSourceV4 }
const previewBackdrops = {
  original: { label: '原样', style: {} },
  grid: { label: '透明网格', style: { backgroundColor: '#ffffff', backgroundImage: 'repeating-conic-gradient(#d8d8d8 0 25%, #ffffff 0 50%)', backgroundSize: '20px 20px' } },
  light: { label: '浅色', style: { backgroundColor: '#f7f7f7', backgroundImage: 'none' } },
  neutral: { label: '中性灰', style: { backgroundColor: '#808080', backgroundImage: 'none' } },
  dark: { label: '深色', style: { backgroundColor: '#181818', backgroundImage: 'none' } },
} satisfies Record<string, { label: string; style: CSSProperties }>
type PreviewBackdrop = keyof typeof previewBackdrops

/** Local URLs are created only after the existing owner/hash proof reader.
 * Provider URL strings and arbitrary Blob IDs are never displayed directly. */
export default function MediaAssetPreview({ scope, asset, productionId, raw, rawSound, generatedSource, generatedVoiceSource, onObserved,onUnavailable,comparisonAspectRatio,smallImageSizes,caption }: {
  scope: WorkspaceScope; asset: FrozenRuntimeMediaAssetV2; productionId?: number | null; raw?: AvgRawPreviewReference; generatedSource?: AvgGeneratedImageSource; onObserved?: () => void;onUnavailable?:()=>void
  comparisonAspectRatio?:number;smallImageSizes?:readonly number[];caption?:string
  generatedVoiceSource?: AvgGeneratedVoiceSource
  rawSound?: { artifactKey: string; version: number; contentHash: string }
}) {
  const [url, setUrl] = useState(''), [error, setError] = useState('')
  const [processingEvidence,setProcessingEvidence]=useState<AvgV5ProcessedImageDisplayEvidence|null>(null)
  const [backdrop, setBackdrop] = useState<PreviewBackdrop>('original')
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
    setUrl(''); setError(''); setVoiceOrigin(null); setBackdrop('original');setProcessingEvidence(null)
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
        const candidate = await readAvgAdoptedGeneratedVoice({ scope, source: JSON.parse(generatedVoiceSourceJson) as AvgGeneratedVoiceSource })
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
      if(visualVersion===5&&processed){
        const candidate=await readAvgProcessedImageCandidateBytesV5({scope,productionId,requirementKey,version,contentHash,
          ...(historicalV5Json?{historical:JSON.parse(historicalV5Json) as AvgV5PreviewBoundary}:{})})
        if(canonicalProductProductionJsonV2(candidate.asset)!==canonicalProductProductionJsonV2(current))throw new Error('显示图片与准确原图不一致')
        if(alive)setProcessingEvidence(candidate.processingEvidence)
        return candidate.data
      }
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
      : url ? <>{!error&&<details className="avg-preview-backdrops"><summary>透明边缘与底色检查</summary>
          <div role="group" aria-label={`图片对比底色：${asset.name}`}>
            {(Object.keys(previewBackdrops) as PreviewBackdrop[]).map(value=><button key={value} type="button" className="lf-action"
              aria-pressed={backdrop===value} onClick={()=>setBackdrop(value)}>{previewBackdrops[value].label}</button>)}
          </div><p>切换底色检查边缘残色、孔隙和主体完整性。仅改变当前预览，仍须逐项记录实际观察并独立选用。</p>
        </details>}
        <img key={url} src={url} alt={asset.altText || asset.name} onLoad={onObserved} onError={historicalJson||historicalV5Json||visualVersion===5||generatedSourceJson||onUnavailable?()=>{setError('原图无法解码，请重新读取并核对文件。');setProcessingEvidence(null);unavailable.current?.()}:undefined}
          style={{...previewBackdrops[backdrop].style,...(comparisonAspectRatio?{aspectRatio:comparisonAspectRatio}:{})}}/>
        {processingEvidence?.contentHash===asset.contentHash&&<ProcessingEvidenceView evidence={processingEvidence}/>}
        {smallImageSizes&&<div className="avg-review-icon-sizes">{smallImageSizes.map(size=><img key={size} src={url} alt={`${asset.name} · ${size} 像素观察`} style={{width:size,height:size,objectFit:'contain',...previewBackdrops[backdrop].style}}/>)}</div>}</> : <p>读取图片…</p>}
    <p>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : `${((asset.durationMs ?? 0) / 1000).toFixed(2)} 秒`} · {Math.ceil(asset.byteSize / 1024)} KiB</p>
    <p>来源：{asset.source} · 授权：{asset.license}</p>
    {voiceOrigin && <div aria-label="沿用配音来源">
      <p>原已采用版本 {voiceOrigin.buildNumber} · {voiceOrigin.speaker} · 音色 {voiceOrigin.voiceId}</p>
      <p>准确原句：{voiceOrigin.text}</p><p>音色使用权说明：{voiceOrigin.declaration}</p><p>条款或授权依据：{voiceOrigin.reference}</p>
    </div>}
  </figure>
}

function ProcessingEvidenceView({evidence}:{evidence:AvgV5ProcessedImageDisplayEvidence}){
  const foreground=evidence.foreground
  const percent=(value:number)=>`${(value*100).toFixed(1)}%`
  return <section aria-label="本地图像加工测量"><h6>准确加工候选的解码与像素观察</h6>
    <p>{evidence.contentHash.slice(0,12)} · {evidence.output.width} × {evidence.output.height} · {evidence.output.hasAlpha?'含透明像素':'未观察到透明像素'}</p>
    {foreground?<> {'modelId' in foreground
      ? <p>算法：{foreground.algorithm} · 模型 {foreground.modelId} · 模型分数 {percent(foreground.modelScore)} · alpha 覆盖 {percent(foreground.alphaCoverage)} · 设备 {foreground.device}</p>
      : <p>算法：{foreground.algorithm} · 遮罩比例 {percent(foreground.algorithmMaskRatio)} · 移除/半透明像素 {percent(foreground.removedPixelRatio)}</p>}
      {'backdropColor'in foreground&&<p>估算底色 RGB({foreground.backdropColor.red}, {foreground.backdropColor.green}, {foreground.backdropColor.blue}) · 边缘色系覆盖 {percent(foreground.backdropBorderCoverage)}</p>}
      {'reservedBorderRatio'in foreground&&<p>声明色键边缘覆盖 {percent(foreground.reservedBorderRatio)}</p>}
      {'background'in foreground&&<details><summary>亮灰背景检查</summary><p>边缘底色 RGB({foreground.background.median.join(', ')}) · 可确认边缘 {percent(foreground.background.borderCoverage)} · 连通背景 {foreground.background.floodPixelCount} 像素 · 从分割掩模移除 {foreground.background.removedMaskPixelCount} 像素</p><p>只清除与外缘连通且符合底色检查的区域；相近颜色的衣饰仍须人工对照。</p></details>}
      {'selectedCandidateIndex'in foreground&&<details><summary>分割候选与选择依据</summary>
        <p>掩模覆盖 {percent(foreground.maskCoverage)} · alpha 过半覆盖 {percent(foreground.alphaThresholdCoverage)}</p>
        <table><thead><tr><th>提示与掩模</th><th>模型分数</th><th>掩模覆盖</th><th>选择</th></tr></thead><tbody>
          {foreground.candidates.map((candidate,index)=><tr key={index}><td>{candidate.promptIndex===0?'人物框':'人物框与身体定位'} · {candidate.maskIndex+1}</td>
            <td>{percent(candidate.score)}</td><td>{percent(candidate.maskCoverage)}</td><td>{index===foreground.selectedCandidateIndex?'当前候选':'未选'}</td></tr>)}
        </tbody></table></details>}
      <details><summary>像素加工计数与边缘残差</summary><p>清除 {foreground.clearedPixelCount} · 半透明 {foreground.translucentPixelCount} · 不透明 {foreground.opaquePixelCount}</p>
        {'correctedPixelCount'in foreground&&<p>边缘修正 {foreground.correctedPixelCount} · 未支持边缘 {foreground.unsupportedBoundaryPixelCount}</p>}
        {'maxCompositeResidual'in foreground&&<p>最大合成残差 {foreground.maxCompositeResidual}</p>}</details>
    </>:<p>该加工回执没有前景像素分项观察。</p>}
    <p>这些是绑定当前加工候选的算法与解码测量，不能证明边缘自然、主体无损、角色一致或美术评审通过。</p>
  </section>
}
