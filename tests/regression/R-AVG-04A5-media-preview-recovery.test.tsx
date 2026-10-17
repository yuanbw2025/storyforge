import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import MediaAssetPreview from '../../src/components/avg/MediaAssetPreview'
import type { FrozenRuntimeMediaAssetV2 } from '../../src/lib/types'

const readers=vi.hoisted(()=>({raw:vi.fn(),processed:vi.fn(),retained:vi.fn()}))
vi.mock('../../src/lib/avg/assembly-service',()=>({readAvgRawImageCandidateBytesV2:readers.raw,
  readAvgProcessedImageCandidateBytesV1:readers.processed,readAvgRetainedImageCandidateBytesV1:readers.retained}))
vi.mock('../../src/lib/avg/editor-service',()=>({readAvgDraftMediaV1:vi.fn()}))
vi.mock('../../src/lib/avg/media-generated-reference',()=>({readAvgAdoptedGeneratedImageV1:vi.fn()}))
vi.mock('../../src/lib/avg/generated-voice-source',()=>({readAvgAdoptedGeneratedVoiceV1:vi.fn()}))

Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
const scope={projectId:1,worldId:1,workId:1},hash='a'.repeat(64),roots:Root[]=[]
const asset:FrozenRuntimeMediaAssetV2={assetKey:'image.background',version:1,kind:'background',name:'准确背景',mimeType:'image/png',byteSize:4,
  width:576,height:324,durationMs:null,contentHash:hash,blobContentHash:hash,source:'engineering',license:'内部工程像素',altText:'准确背景',characterTag:'',sceneTag:'desk'}
beforeEach(()=>{
  vi.resetAllMocks()
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Preview read must not dispatch provider requests')}))
  vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:exact-owned-image')
  vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{})
})
afterEach(async()=>{for(const root of roots.splice(0))await act(async()=>root.unmount());vi.restoreAllMocks();vi.unstubAllGlobals();document.body.innerHTML=''})
async function mount(){
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root)
  const onObserved=vi.fn()
  await act(async()=>root.render(<MediaAssetPreview scope={scope} asset={asset} productionId={8}
    raw={{requirementKey:'background',version:1,contentHash:hash}} onObserved={onObserved}/>))
  return {host,onObserved}
}
async function reread(host:HTMLElement){
  const button=host.querySelector<HTMLButtonElement>('button[aria-label="重新读取媒资：准确背景"]')
  expect(button).not.toBeNull();await act(async()=>button!.click())
}

describe('AVG explicit local preview reread after stale source proof',()=>{
  it.each(['[avg-visual-image] 编译来源在读取期间变化','[product-production-artifact] 已采用输入在读取期间已变化'])('revalidates the same exact raw source only after a click for %s, without generating or claiming observation',async message=>{
    readers.raw.mockRejectedValueOnce(new Error(message))
      .mockResolvedValueOnce({asset,data:new Uint8Array([1,2,3,4]).buffer})
    const {host,onObserved}=await mount()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(message)
    expect(readers.raw).toHaveBeenCalledTimes(1);expect(host.querySelector('img')).toBeNull();expect(onObserved).not.toHaveBeenCalled()
    await reread(host)
    expect(readers.raw.mock.calls).toEqual(Array.from({length:2},()=>[{scope,productionId:8,requirementKey:'background',version:1,contentHash:hash}]))
    expect(host.querySelector('[role="alert"]')).toBeNull();expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:exact-owned-image')
    expect(onObserved).not.toHaveBeenCalled()
    await act(async()=>{host.querySelector('img')!.dispatchEvent(new Event('load'))})
    expect(onObserved).toHaveBeenCalledTimes(1);expect(fetch).not.toHaveBeenCalled()
    expect(readers.processed).not.toHaveBeenCalled();expect(readers.retained).not.toHaveBeenCalled()
    await act(async()=>roots.pop()!.unmount());expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:exact-owned-image')
  })
  it.each(['reader-rejection','different-asset'] as const)('keeps %s blocked after explicit reread and never creates a display URL',async kind=>{
    readers.raw.mockRejectedValueOnce(new Error('[avg-visual-image] 编译来源在读取期间变化'))
    if(kind==='reader-rejection')readers.raw.mockRejectedValueOnce(new Error('原图 hash 不一致'))
    else readers.raw.mockResolvedValueOnce({asset:{...asset,contentHash:'b'.repeat(64)},data:new ArrayBuffer(4)})
    const {host,onObserved}=await mount();await reread(host)
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(kind==='reader-rejection'?'原图 hash 不一致':'显示图片与准确原图不一致')
    expect(readers.raw).toHaveBeenCalledTimes(2);expect(host.querySelector('img')).toBeNull()
    expect(URL.createObjectURL).not.toHaveBeenCalled();expect(onObserved).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()
  })
})
