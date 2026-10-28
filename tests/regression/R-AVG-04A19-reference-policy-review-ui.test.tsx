import { act } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import VisualReviewPanel from '../../src/components/avg/VisualReviewPanel'
import MediaProductionPanel from '../../src/components/avg/MediaProductionPanel'
import * as readiness from '../../src/lib/avg/visual-planning-brief-v5'
import MediaAssetPreview from '../../src/components/avg/MediaAssetPreview'
import { avgVersionedPlanningFixture } from '../helpers/avg-versioned-planning-fixture'
import { parseAvgVisualProductionRequirementV1 } from '../../src/lib/avg/media-production-contract'
import { parseAvgVisualProductionRequirementV2 } from '../../src/lib/avg/media-production-contract-v2'
import { assertAvgReferencePolicyReviewV2,assertAvgReferencePolicySelectableV2,parseAvgAuthorVisualReviewV2 } from '../../src/lib/avg/visual-review-contract-v2'
import type { ProductBuildArtifactRecordV1,WorkspaceScope } from '../../src/lib/types'

const api=vi.hoisted(()=>({image1:vi.fn(),image2:vi.fn(),stage1:vi.fn(),stage2:vi.fn(),confirm:vi.fn(),raw1:vi.fn(),processed1:vi.fn(),raw5:vi.fn(),processed5:vi.fn()}))
vi.mock('../../src/lib/avg/editor-service',()=>({readAvgDraftReferenceImageV1:api.image1,readAvgDraftReferenceImageV2:api.image2,readAvgDraftMediaV1:vi.fn()}))
vi.mock('../../src/lib/avg/assembly-service',()=>({stageAvgVisualReviewV1:api.stage1,confirmAvgWorkspaceInputV1:api.confirm,
  readAvgRawImageCandidateBytesV2:api.raw1,readAvgProcessedImageCandidateBytesV1:api.processed1,readAvgRetainedImageCandidateBytesV1:vi.fn()}))
vi.mock('../../src/lib/avg/visual-review-service-v5',()=>({stageAvgVisualReviewV2:api.stage2}))
vi.mock('../../src/lib/avg/media-candidate-preview-v5',()=>({readAvgRawImageCandidateBytesV5:api.raw5,readAvgProcessedImageCandidateBytesV5:api.processed5}))
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
const actions:Promise<void>[]=[],roots:Root[]=[],scope:WorkspaceScope={projectId:1,worldId:2,workId:3},hash='c'.repeat(64)
// Controlled UI rows and load events only; no producer or artistic evidence.
const raw={version:1,contentHash:hash} as ProductBuildArtifactRecordV1
function requirement(){
  const f=avgVersionedPlanningFixture(),t=f.versioned.templates[1]
  return parseAvgVisualProductionRequirementV2({...t.parameters,prompt:'UI observation fixture',negativePrompt:'',invariants:t.requiredDetails,
    forbiddenDepictions:t.forbiddenDepictions,references:f.versioned.referenceCatalog.map(c=>c.reference)})
}
beforeEach(()=>{
  vi.resetAllMocks();vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1');vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','1');vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('UI must not dispatch a provider')}))
  api.image2.mockResolvedValue({asset:{mimeType:'image/png'},data:new ArrayBuffer(4)})
  api.image1.mockResolvedValue({asset:{mimeType:'image/png'},data:new ArrayBuffer(4)})
  let id=0;vi.spyOn(URL,'createObjectURL').mockImplementation(()=>`blob:ui-${++id}`)
  vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{})
})
afterEach(async()=>{for(const root of roots.splice(0))await act(async()=>root.unmount());vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();document.body.innerHTML=''})
async function mount(version:1|2=2){
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root)
  const r=requirement(),onReload=vi.fn(),onPending=vi.fn()
  const displayed=version===2?r:parseAvgVisualProductionRequirementV1({...r,references:avgVersionedPlanningFixture().legacy.referenceCatalog.map(c=>c.reference)})
  const base={scope,productionId:8,requirement:displayed,raw,policyVersion:version===2?2 as const:undefined,image:<p>controlled frame</p>,rawObserved:true,disabled:false,canAdopt:true,locked:false,
    declaration:'UI fixture only',onPending,onReload,onAction:(task:()=>Promise<void>)=>{const pending=task();actions.push(pending);return pending}}
  const render=async(override:Partial<typeof base>={})=>{await act(async()=>root.render(<VisualReviewPanel {...base} {...override}/>))}
  await render();return {host,r,render,onReload}
}
async function set(host:HTMLElement,label:string,value:string){
  const el=host.querySelector<HTMLSelectElement|HTMLTextAreaElement>(`[aria-label="${label}"]`)!;expect(el).not.toBeNull()
  await act(async()=>{
    if(el instanceof HTMLTextAreaElement)Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(el,value)
    else el.value=value
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement?'change':'input',{bubbles:true}))
  })
}
async function notes(host:HTMLElement){
  await set(host,'参考1：观察依据','受控界面测试的观察依据一');await set(host,'参考2：观察依据','受控界面测试的观察依据二')
  const el=[...host.querySelectorAll('textarea')].at(-1)!
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(el,'受控界面测试，不证明实际艺术质量');el.dispatchEvent(new Event('input',{bubbles:true}))})
}
async function observe(host:HTMLElement){await act(async()=>{host.querySelectorAll('img').forEach(img=>img.dispatchEvent(new Event('load')))})}
async function save(host:HTMLElement){const b=[...host.querySelectorAll('button')].find(b=>b.textContent!.startsWith('保存视觉评审候选'))!;expect(b.disabled).toBe(false);await act(async()=>{b.click();await Promise.all(actions.splice(0))})}

describe('AVG exact reference-policy observations in the native review controls',()=>{
  it('saves unknown observations against every exact reference and never adopts or infers pass from display',async()=>{
    const {host,r}=await mount();expect(host.textContent).toContain('蜡封信件')
    expect([...host.querySelectorAll<HTMLOptionElement>('option[value="pass"]')].every(o=>o.disabled)).toBe(true)
    await notes(host);await save(host)
    const report=parseAvgAuthorVisualReviewV2(api.stage2.mock.calls[0][0].report)
    await assertAvgReferencePolicyReviewV2(report,r)
    expect(report.referencePolicy.checks).toHaveLength(2);expect(report.referencePolicy.checks.every(c=>c.permittedFeatures==='unknown'&&c.excludedFeatures==='unknown')).toBe(true)
    expect(()=>assertAvgReferencePolicySelectableV2(report)).toThrow();expect(report.unobserved.length).toBeGreaterThan(0)
    expect(api.image2).toHaveBeenCalledTimes(2);expect(api.stage1).not.toHaveBeenCalled();expect(api.confirm).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()
  })
  it('requires explicit per-reference choices after display and binds passing observations to the full requirement',async()=>{
    const {host,r}=await mount();await observe(host)
    for(const label of ['身份与造型','参考连续性','构图与完整性','可辨认性','透明边缘'])await set(host,`观察结果：${label}`,'pass')
    for(const i of [1,2])for(const field of ['允许取用','排除内容'])await set(host,`参考${i}：${field}`,'pass')
    await notes(host);await save(host);const report=parseAvgAuthorVisualReviewV2(api.stage2.mock.calls[0][0].report)
    await assertAvgReferencePolicyReviewV2(report,r);expect(()=>assertAvgReferencePolicySelectableV2(report)).not.toThrow()
    expect(report.visualEvidence.referenceHashes).toEqual(r.references.map(ref=>ref.contentHash));expect(report.unobserved).toEqual([]);expect(api.confirm).not.toHaveBeenCalled()
  })
  it('records an excluded-content failure as an owned blocking issue with a bounded repair instruction',async()=>{
    const {host,r}=await mount();await observe(host);await set(host,'参考1：排除内容','fail');await notes(host)
    const repair=[...host.querySelectorAll('label')].find(l=>l.textContent!.startsWith('允许的返修与加工范围'))!.querySelector('textarea')!
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(repair,'移除误抄的蜡封信件，保留人物身份');repair.dispatchEvent(new Event('input',{bubbles:true}))})
    await save(host);const report=parseAvgAuthorVisualReviewV2(api.stage2.mock.calls[0][0].report);await assertAvgReferencePolicyReviewV2(report,r)
    expect(report.issues).toContainEqual(expect.objectContaining({issueKey:'reference.0.excluded',locationKey:r.references[0].assetKey,severity:'blocking',owner:'media',allowedChange:'移除误抄的蜡封信件，保留人物身份'}))
    expect(()=>assertAvgReferencePolicySelectableV2(report)).toThrow();expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['frame','scope','requirement'] as const)('clears stale observation and reloads references after a %s change',async kind=>{
    const {host,r,render}=await mount();await observe(host);await set(host,'参考1：允许取用','pass');await notes(host)
    await render(kind==='frame'?{raw:{...raw,version:2,contentHash:'d'.repeat(64)}}:kind==='scope'?{scope:{...scope,workId:4}}:{requirement:{...r,altText:'changed exact requirement'}})
    expect(host.querySelector<HTMLSelectElement>('[aria-label="参考1：允许取用"]')!.value).toBe('unknown')
    expect(host.querySelector<HTMLOptionElement>('[aria-label="参考1：允许取用"] option[value="pass"]')!.disabled).toBe(true)
    expect(api.image2).toHaveBeenCalledTimes(4);expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);expect(api.stage2).not.toHaveBeenCalled()
  })
  it('revokes a reference display observation when the exact reference fails decoding',async()=>{
    const {host}=await mount();await observe(host)
    const select=host.querySelector<HTMLOptionElement>('[aria-label="参考1：允许取用"] option[value="pass"]')!
    expect(select.disabled).toBe(false)
    await act(async()=>host.querySelector('img')!.dispatchEvent(new Event('error')))
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('参考图片无法解码');expect(select.disabled).toBe(true)
    expect(api.stage2).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()
  })
  it('requires both the original and derivative to display before a V5 author can mark observations, and revokes availability after decode failure',async()=>{
    vi.spyOn(readiness,'avgVisualPlanningExecutionReadyV5').mockReturnValue(true)
    const r=requirement(),workspace=avgVersionedPlanningFixture().source
    const asset={assetKey:r.assetKey,version:1,kind:r.mediaKind,name:r.name,altText:r.altText,mimeType:'image/png',byteSize:4,width:r.width,height:r.height,contentHash:hash,source:'controlled-ui',license:'UI engineering only'}
    const derivativeAsset={...asset,contentHash:'d'.repeat(64)}
    api.raw5.mockResolvedValue({asset,data:new ArrayBuffer(4)});api.processed5.mockResolvedValue({asset:derivativeAsset,data:new ArrayBuffer(4)})
    const artifacts=[{artifactKey:`avg.media.raw.${r.requirementKey}`,status:'accepted',version:1,contentHash:hash,metadataJson:JSON.stringify(asset),payloadJson:'{}'},
      {artifactKey:`avg.media.processed.${r.requirementKey}`,status:'accepted',version:1,contentHash:derivativeAsset.contentHash,metadataJson:JSON.stringify(derivativeAsset),payloadJson:'{}'}]
    const view={draft:{revision:1,worldReleaseId:1},details:{production:{id:8,status:'producing'},build:{id:1,status:'building',budgetLedgerJson:'{}'},executionBrief:{avgVisualPlanning:{version:5}}},
      imageDefinition:{mediaBatch:{requirements:[r],visualReviewPolicy:'author-visual-v1'},imageProcessing:{entries:[{requirementKey:r.requirementKey}]}},artifacts,media:{items:[]},processingTasks:[]}
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);const noop=vi.fn()
    await act(async()=>root.render(<MediaProductionPanel scope={scope} view={view as never} workspace={workspace} disabled={false} canEdit={false} canImportReference={true} canPrepareProcessing={false} canAdopt={true} sourcesReady={true}
      declaration="controlled UI" generating={false} visible={true} onPending={noop} onAction={task=>task()} onSave={noop} onClear={noop} onReload={noop} onNotice={noop} onGenerate={noop} onCancel={noop}/>))
    expect(host.textContent).toContain('导入仅供生成使用的参考图');expect(host.textContent).not.toContain('新增图片需求')
    const figures=[...host.querySelectorAll('figure.avg-assembly-media-preview')],original=figures[0].querySelector('img')!,derived=figures[1].querySelector('img')!
    await act(async()=>derived.dispatchEvent(new Event('load')))
    expect(host.textContent).toContain('原图尚未显示')
    await act(async()=>original.dispatchEvent(new Event('load')))
    expect(host.textContent).toContain('准确原图已显示')
    await act(async()=>original.dispatchEvent(new Event('error')))
    expect(host.textContent).toContain('原图尚未显示');expect(host.textContent).toContain('原图无法解码')
    expect(api.confirm).not.toHaveBeenCalled();expect(api.stage2).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps the exact V5 source image inspectable while local processing is still pending, without opening review or selection',async()=>{
    vi.spyOn(readiness,'avgVisualPlanningExecutionReadyV5').mockReturnValue(true)
    const r=requirement(),workspace=avgVersionedPlanningFixture().source
    const asset={assetKey:r.assetKey,version:1,kind:r.mediaKind,name:r.name,altText:r.altText,mimeType:'image/png',byteSize:4,width:r.width,height:r.height,contentHash:hash,source:'controlled-ui',license:'UI engineering only'}
    api.raw5.mockResolvedValue({asset,data:new ArrayBuffer(4)})
    const view={draft:{revision:1,worldReleaseId:1},details:{production:{id:8,status:'producing'},build:{id:1,status:'building',budgetLedgerJson:'{}'},executionBrief:{avgVisualPlanning:{version:5}}},
      imageDefinition:{mediaBatch:{requirements:[r],visualReviewPolicy:'author-visual-v1'},imageProcessing:{entries:[{requirementKey:r.requirementKey}]}},
      artifacts:[{artifactKey:`avg.media.raw.${r.requirementKey}`,status:'accepted',version:1,contentHash:hash,metadataJson:JSON.stringify(asset),payloadJson:'{}'}],media:{items:[]},processingTasks:[]}
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);const noop=vi.fn()
    await act(async()=>root.render(<MediaProductionPanel scope={scope} view={view as never} workspace={workspace} disabled={false} canEdit={false} canImportReference={true} canPrepareProcessing={false} canAdopt={true} sourcesReady={true}
      declaration="controlled UI" generating={false} visible={true} onPending={noop} onAction={task=>task()} onSave={noop} onClear={noop} onReload={noop} onNotice={noop} onGenerate={noop} onCancel={noop}/>))
    const toggle=[...host.querySelectorAll('button')].find(button=>button.textContent?.includes('原图'))
    expect(toggle,host.textContent).toBeDefined();expect(host.textContent).toContain('等待本地加工');expect(host.textContent).toContain('加工结果返回前不能提交视觉评审或选用')
    expect(host.textContent).not.toContain('保存视觉评审候选');expect(host.textContent).not.toContain('保存选图候选')
    if(toggle?.textContent?.includes('查看原图'))await act(async()=>toggle.click())
    expect(api.raw5).toHaveBeenCalledWith({scope,productionId:8,requirementKey:r.requirementKey,version:1,contentHash:hash})
    expect(host.querySelector('img')).not.toBeNull();expect(api.confirm).not.toHaveBeenCalled();expect(api.stage2).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps the legacy default on review1 without synthesizing policy observations',async()=>{
    const {host}=await mount(1)
    // A genuine legacy requirement exercises the unchanged default protocol.
    expect(host.querySelector('[aria-label="逐项参考内容核对"]')).toBeNull()
    const el=host.querySelector('textarea')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(el,'未观察原因');el.dispatchEvent(new Event('input',{bubbles:true}))})
    await save(host);expect(api.stage1).toHaveBeenCalledTimes(1);expect(api.stage2).not.toHaveBeenCalled();expect(api.confirm).not.toHaveBeenCalled()
  })
})

describe('AVG explicit V5 preview dispatch',()=>{
  it.each([false,true])('reads actual V5 bytes with processed=%s and never falls back to old source readers',async processed=>{
    const asset={assetKey:'preview',name:'受控图像',mimeType:'image/png',contentHash:hash,kind:'background',altText:'controlled',byteSize:4} as const
    const reader=processed?api.processed5:api.raw5;reader.mockResolvedValue({asset,data:new ArrayBuffer(4)})
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root)
    await act(async()=>root.render(<MediaAssetPreview scope={scope} asset={asset as never} productionId={8} raw={{requirementKey:'preview',version:1,contentHash:hash,visualVersion:5,processed}}/>))
    expect(reader).toHaveBeenCalledWith({scope,productionId:8,requirementKey:'preview',version:1,contentHash:hash});expect(host.querySelector('img')).not.toBeNull()
    expect(api.raw1).not.toHaveBeenCalled();expect(api.processed1).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()
  })
})
