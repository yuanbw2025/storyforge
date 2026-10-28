import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { act } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import MediaAssetPreview from '../../src/components/avg/MediaAssetPreview'
import type { FrozenRuntimeMediaAssetV2 } from '../../src/lib/types'

const api=vi.hoisted(()=>({raw5:vi.fn(),processed5:vi.fn(),draft:vi.fn()}))
vi.mock('../../src/lib/avg/media-candidate-preview-v5',()=>({readAvgRawImageCandidateBytesV5:api.raw5,readAvgProcessedImageCandidateBytesV5:api.processed5}))
vi.mock('../../src/lib/avg/editor-service',()=>({readAvgDraftMediaV1:api.draft}))
const scope={projectId:1,worldId:1,workId:1},roots:Root[]=[]
const asset:FrozenRuntimeMediaAssetV2={assetKey:'figure.keeper',version:1,kind:'character-pose',name:'保管员透明图',mimeType:'image/png',byteSize:4,
 width:576,height:768,durationMs:null,contentHash:'a'.repeat(64),blobContentHash:'a'.repeat(64),source:'controlled-unit-only',license:'工程字节，不代表艺术/授权通过',altText:'保管员工程图',characterTag:'keeper',sceneTag:'desk'}
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Read-only comparison cannot call a provider')}))
 let id=0;vi.spyOn(URL,'createObjectURL').mockImplementation(()=>`blob:comparison-${++id}`);vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{})
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{})
 api.raw5.mockResolvedValue({asset,data:new Uint8Array([1,2,3,4]).buffer});api.processed5.mockResolvedValue({asset,data:new Uint8Array([1,2,3,4]).buffer})
})
afterEach(async()=>{for(const root of roots.splice(0))await act(async()=>root.unmount());vi.restoreAllMocks();vi.unstubAllGlobals();document.body.replaceChildren()})
async function mount(processed=false){
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root)
 const observed=vi.fn(),unavailable=vi.fn()
 const render=async(current=asset)=>act(async()=>{root.render(<MediaAssetPreview scope={scope} asset={current} productionId={9}
  raw={{visualVersion:5,requirementKey:'keeper.pose',version:current.version,contentHash:current.contentHash,processed}}
  onObserved={observed} onUnavailable={unavailable} comparisonAspectRatio={3/4} smallImageSizes={[24,48]}/>);await vi.dynamicImportSettled()})
 await render()
 const button=(label:string)=>Array.from(host.querySelectorAll<HTMLButtonElement>('.avg-preview-backdrops button')).find(b=>b.textContent===label)!
 const select=async(label:string)=>act(async()=>{host.querySelector('details')!.open=true;button(label).click()})
 return {host,root,render,observed,unavailable,button,select}
}

describe('AVG local image backdrop comparison without source or review authority changes',()=>{
 it.each([false,true])('keeps the same proven image and URL when comparing raw/processed=%s; switching is not a new observation',async processed=>{
  const s=await mount(processed),images=Array.from(s.host.querySelectorAll('img')),main=images[0],reader=processed?api.processed5:api.raw5
  await act(async()=>main.dispatchEvent(new Event('load')));expect(s.observed).toHaveBeenCalledTimes(1)
  const cases=[['浅色','#f7f7f7'],['深色','#181818'],['中性灰','#808080']] as const
  for(const [label,color] of cases){
   await s.select(label);expect(s.host.querySelector('img')).toBe(main);expect(s.button(label).getAttribute('aria-pressed')).toBe('true')
   for(const image of images){expect(image.style.backgroundColor).toBe(color);expect(image.style.backgroundImage).toBe('none');expect(image.getAttribute('src')).toBe('blob:comparison-1')}
  }
  const [width,height='1']=main.style.aspectRatio.split('/');expect(Number(width)/Number(height)).toBe(3/4);expect(images[1].style.width).toBe('24px');expect(images[2].style.width).toBe('48px')
  await s.select('透明网格');expect(main.style.backgroundImage).toContain('repeating-conic-gradient')
  await s.select('原样');expect(main.style.backgroundImage).toBe('');expect(main.style.backgroundColor).toBe('')
  expect(reader.mock.calls).toEqual([[{scope,productionId:9,requirementKey:'keeper.pose',version:1,contentHash:asset.contentHash}]])
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);expect(URL.revokeObjectURL).not.toHaveBeenCalled();expect(s.observed).toHaveBeenCalledTimes(1);expect(fetch).not.toHaveBeenCalled()
 })
 it('shows estimated-magenta pixel measurements only beside the exact V5 processed bytes and clears them on decode failure',async()=>{
  const evidence={contentHash:asset.contentHash,output:{width:576,height:768,hasAlpha:true},foreground:{version:3 as const,
   algorithm:'storyforge.avg.foreground.estimated-magenta-edge-unmix.v3' as const,baseAlgorithm:'storyforge.avg.foreground.estimated-magenta-edge-mask.v3' as const,
   removedPixelRatio:.22,algorithmMaskRatio:.22,backdropColor:{red:248,green:24,blue:246},backdropBorderCoverage:.91,
   clearedPixelCount:1000,translucentPixelCount:200,opaquePixelCount:323232,correctedPixelCount:37,unsupportedBoundaryPixelCount:2,maxCompositeResidual:4}}
  api.processed5.mockResolvedValueOnce({asset,data:new Uint8Array([1,2,3,4]).buffer,processingEvidence:evidence})
  const s=await mount(true),summary=s.host.querySelector('[aria-label="本地图像加工测量"]')
  expect(summary?.textContent).toContain(asset.contentHash.slice(0,12));expect(summary?.textContent).toContain('RGB(248, 24, 246)')
  expect(summary?.textContent).toContain('边缘色系覆盖 91.0%');expect(summary?.textContent).toContain('最大合成残差 4')
  expect(summary?.textContent).toContain('不能证明边缘自然');expect(s.observed).not.toHaveBeenCalled()
  await act(async()=>s.host.querySelector('img')!.dispatchEvent(new Event('error')))
  expect(s.host.querySelector('[role="alert"]')?.textContent).toContain('无法解码');expect(s.host.querySelector('[aria-label="本地图像加工测量"]')).toBeNull()
  expect(s.observed).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()
 })
 it('shows all SAM 2 V5 mask observations and the selected whole-subject candidate without granting review authority',async()=>{
  const candidates=[0.81,0.99,0.98,0.92,0.80,0.86].map((score,index)=>({promptIndex:Math.floor(index/3),maskIndex:index%3,score,maskCoverage:index===0?0.6:0.4}))
  api.processed5.mockResolvedValueOnce({asset,data:new Uint8Array([1,2,3,4]).buffer,processingEvidence:{contentHash:asset.contentHash,
   output:{width:576,height:768,hasAlpha:true},foreground:{version:5,algorithm:'storyforge.avg.foreground.sam2.1-pymatting.v5',modelId:'sam2.1-hiera-tiny',
    modelScore:0.81,maskCoverage:0.6,alphaCoverage:0.5,alphaThresholdCoverage:0.5,device:'cpu',selectedCandidateIndex:0,candidates,
    clearedPixelCount:221184,translucentPixelCount:0,opaquePixelCount:221184}}})
  const s=await mount(true),summary=s.host.querySelector('[aria-label="本地图像加工测量"]')!,rows=Array.from(summary.querySelectorAll('tbody tr'))
  expect(rows).toHaveLength(6);expect(rows[0].textContent).toContain('人物框 · 1');expect(rows[0].textContent).toContain('当前候选')
  expect(rows.slice(1).every(row=>row.textContent!.includes('未选'))).toBe(true)
  expect(summary.textContent).toContain('掩模覆盖 60.0%');expect(summary.textContent).toContain('alpha 过半覆盖 50.0%')
  expect(s.observed).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()
 })
 it('rechecks changed source identity and resets only the local comparison while revoking the previous URL',async()=>{
  const s=await mount(),next={...asset,version:2,contentHash:'b'.repeat(64),blobContentHash:'b'.repeat(64)}
  await s.select('深色');api.raw5.mockResolvedValueOnce({asset:next,data:new Uint8Array([5,6,7,8]).buffer})
  await s.render(next)
  expect(s.button('原样').getAttribute('aria-pressed')).toBe('true');expect(s.host.querySelector('img')!.style.backgroundColor).toBe('')
  expect(s.host.querySelector('img')!.getAttribute('src')).toBe('blob:comparison-2')
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:comparison-1');expect(api.raw5).toHaveBeenCalledTimes(2)
  expect(api.raw5.mock.calls[1][0]).toMatchObject({version:2,contentHash:next.contentHash});expect(s.observed).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()
 })
 it.each(['source-proof','decode'] as const)('keeps %s failure behind explicit reread and never turns comparison into acceptance',async mode=>{
  if(mode==='source-proof')api.raw5.mockRejectedValueOnce(new Error('原始来源已变化'))
  const s=await mount()
  if(mode==='decode')await act(async()=>s.host.querySelector('img')!.dispatchEvent(new Event('error')))
  expect(s.host.querySelector('[role="alert"]')).not.toBeNull();expect(s.host.querySelector('.avg-preview-backdrops')).toBeNull()
  expect(api.raw5).toHaveBeenCalledTimes(1);expect(s.unavailable).toHaveBeenCalledTimes(1);expect(s.observed).not.toHaveBeenCalled()
  const retry=s.host.querySelector<HTMLButtonElement>('button[aria-label="重新读取媒资：保管员透明图"]')!
  await act(async()=>{retry.click();await vi.dynamicImportSettled()})
  expect(api.raw5).toHaveBeenCalledTimes(2);expect(s.button('原样').getAttribute('aria-pressed')).toBe('true')
  expect(s.host.querySelector('[role="alert"]')).toBeNull();expect(s.observed).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()
 })
 it('keeps audio in its existing player with no image comparison controls',async()=>{
  const voice={...asset,mimeType:'audio/wav',kind:'voice' as const,width:null,height:null,durationMs:1000}
  api.draft.mockResolvedValue(new Uint8Array([1,2,3,4]).buffer)
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root)
  await act(async()=>root.render(<MediaAssetPreview scope={scope} asset={voice}/>))
  expect(host.querySelector('audio')).not.toBeNull();expect(host.querySelector('.avg-preview-backdrops')).toBeNull();expect(host.querySelector('img')).toBeNull()
  expect(api.draft).toHaveBeenCalledWith(scope,voice);expect(api.raw5).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()
 })
})
