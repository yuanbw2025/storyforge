import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { importProductRuntimeMediaAssetV1 } from '../../src/lib/product/runtime-media-library'
import { setupAudioRuntimeV1,audioWavFixtureV1 } from '../helpers/open-audio-runtime'
import { createAgentRunV1,deleteAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { recordAgentRunArtifactV1,readAgentRunArtifactExactV1,inspectAgentRunArtifactAvailabilityV1,markAndSweepAgentRunArtifactsV1,pruneAgentRunArtifactsExplicitlyV1 } from '../../src/lib/memory/artifact-store'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'
import { branchProductRuntimeSession,deleteProductRuntimeSession,readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { prepareTtrpgOpenAudioUploadV1,confirmTtrpgOpenAudioReviewV1 } from '../../src/lib/ttrpg/open-audio-service'
import { REGISTRY_BY_NAME } from '../../src/lib/registry/project-tables'
import { extractExactArtifactOwnerRootsV1 } from '../../src/lib/memory/artifact-roots'
import { canonicalStringify } from '../../src/lib/agent/run/hash'
import * as blobs from '../../src/lib/product-production/media-blob-store'

const contract=(projectId:number)=>({version:1,objective:'product media evidence fixture',workflowKind:'read-only-audit',runtimeBindingHash:'b'.repeat(64),scope:{projectId,worldGroupId:null},permissions:{contextSourceKeys:['chapterContent'],writeTargets:[]},budget:{maxModelCalls:1,maxToolCalls:0,maxInputTokens:1000,maxOutputTokens:100,maxAttemptsPerStep:1},acceptance:[{id:'result',kind:'output-present',required:true}],verificationPlan:[{id:'terminal',kind:'terminal',verifier:'media-evidence-fixture',criterionIds:['result']}],failurePolicy:{onProtocolError:'fail',onVerificationFailure:'fail',onStaleInput:'pause-for-author'}})
describe('PRODUCTMEDIA-1 opt-in exact evidence ownership',{timeout:60000},()=>{
  beforeEach(async()=>{await db.delete();await db.open()});afterEach(()=>{vi.restoreAllMocks();db.close()})
  async function fixture(){const f=await setupAudioRuntimeV1(),run=await createAgentRunV1({scope:f.owner.scope,contract:contract(f.owner.scope.projectId)})
    const saved=await recordAgentRunArtifactV1({scope:f.owner.scope,runId:run.run.id,artifactKind:'raw-response',content:'immutable original media evidence'})
    const ref={artifactKind:saved.artifact.artifactKind,contentHash:saved.artifact.contentHash}
    const input={scope:f.owner.scope,productRuntimeSessionId:f.owner.sessionId,assetKey:'media.evidence.fixture',kind:'voice' as const,name:'fixture WAV',blob:audioWavFixtureV1(),source:'isolated fixture',license:'fixture only',durationMs:250}
    return {...f,run,ref,input,locator:{projectId:f.owner.scope.projectId,...ref}}}
  it('keeps legacy shape absent, including full backup import, and never retrofits evidence onto an existing manual version',async()=>{
    const f=await fixture(),asset=await importProductRuntimeMediaAssetV1(f.input)
    expect(Object.hasOwn(asset,'exactArtifactRefsJson')).toBe(false);expect(REGISTRY_BY_NAME.get('productMediaAssets')!.defaults).not.toHaveProperty('exactArtifactRefsJson')
    await expect(importProductRuntimeMediaAssetV1({...f.input,exactArtifactRefs:[f.ref]})).rejects.toThrow(/原逐字证据不同/)
    const copy=await importProjectJSON(await exportProjectJSON(f.owner.scope.projectId)),imported=await db.productMediaAssets.where('projectId').equals(copy).first()
    expect(imported).toBeDefined();expect(Object.hasOwn(imported!,'exactArtifactRefsJson')).toBe(false)
    expect(await db.productMediaAssets.where('projectId').equals(f.owner.scope.projectId).count()).toBe(1)
  })
  it('pins original body after source Run deletion, blocks explicit prune, survives backup, and releases only the deleted project owner',async()=>{
    const f=await fixture(),asset=await importProductRuntimeMediaAssetV1({...f.input,exactArtifactRefs:[f.ref,f.ref]})
    expect(asset.exactArtifactRefsJson).toBe(canonicalStringify([f.ref]))
    await deleteAgentRunV1(f.owner.scope,f.run.run.id);await markAndSweepAgentRunArtifactsV1(f.owner.scope.projectId)
    expect(await readAgentRunArtifactExactV1(f.locator)).toBe('immutable original media evidence')
    await expect(pruneAgentRunArtifactsExplicitlyV1({projectId:f.owner.scope.projectId,targets:[f.ref]})).rejects.toThrow(/已确认产物/)
    const copy=await importProjectJSON(await exportProjectJSON(f.owner.scope.projectId)),imported=await db.productMediaAssets.where('projectId').equals(copy).first()
    expect(imported!.exactArtifactRefsJson).toBe(asset.exactArtifactRefsJson)
    await deleteProductRuntimeSession(f.owner.sessionId);await markAndSweepAgentRunArtifactsV1(f.owner.scope.projectId)
    expect(await inspectAgentRunArtifactAvailabilityV1(f.locator)).toMatchObject({state:'evidence-pruned'})
    expect(await readAgentRunArtifactExactV1({...f.locator,projectId:copy})).toBe('immutable original media evidence')
  })
  it('serializes simultaneous same-original imports to one asset/binding and rejects changed evidence on that immutable version',async()=>{
    const f=await fixture(),input={...f.input,exactArtifactRefs:[f.ref]},assets=await Promise.all([importProductRuntimeMediaAssetV1(input),importProductRuntimeMediaAssetV1(input)])
    expect(assets[0].id).toBe(assets[1].id);expect(await db.productMediaAssets.count()).toBe(1);expect(await db.productMediaBlobs.count()).toBe(1)
    const extra=await recordAgentRunArtifactV1({scope:f.owner.scope,runId:f.run.run.id,artifactKind:'source-snapshot',content:'another exact source'})
    await expect(importProductRuntimeMediaAssetV1({...input,exactArtifactRefs:[{artifactKind:extra.artifact.artifactKind,contentHash:extra.artifact.contentHash}]})).rejects.toThrow(/原逐字证据不同/)
    expect((await db.productMediaAssets.get(assets[0].id!))!.exactArtifactRefsJson).toBe(canonicalStringify([f.ref]))
  })
  it('refuses malformed, missing, corrupt and pruned evidence before importing any physical object or metadata',async()=>{
    const f=await fixture(),before=await db.mediaBlobObjects.count()
    for(const refs of [[],Array.from({length:65},()=>f.ref),[{...f.ref,contentHash:'broken'}],[{...f.ref,adoptionAllowed:true}],[{...f.ref,adoptionAllowed:undefined}],[{...f.ref,artifactKind:'unknown'}],[{...f.ref,contentHash:'0'.repeat(64)}]]){
      await expect(importProductRuntimeMediaAssetV1({...f.input,exactArtifactRefs:refs as never})).rejects.toThrow()
    }
    const row=await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([f.owner.scope.projectId,f.ref.artifactKind,f.ref.contentHash]).first()
    await db.agentRunArtifacts.update(row!.id!,{content:'corrupt'})
    await expect(importProductRuntimeMediaAssetV1({...f.input,exactArtifactRefs:[f.ref]})).rejects.toThrow(/corrupt/)
    await db.agentRunArtifacts.update(row!.id!,{content:null,retentionState:'evidence-pruned'})
    await expect(importProductRuntimeMediaAssetV1({...f.input,exactArtifactRefs:[f.ref]})).rejects.toThrow(/evidence-pruned/)
    expect(await db.mediaBlobObjects.count()).toBe(before);expect(await db.productMediaAssets.count()).toBe(0)
  })
  it('rechecks actual original evidence in the binding transaction if it is pruned during physical import',async()=>{
    const f=await fixture(),put=blobs.putMediaBlobObject
    vi.spyOn(blobs,'putMediaBlobObject').mockImplementationOnce(async input=>{const result=await put(input);await deleteAgentRunV1(f.owner.scope,f.run.run.id);return result})
    await expect(importProductRuntimeMediaAssetV1({...f.input,exactArtifactRefs:[f.ref]})).rejects.toThrow(/evidence-pruned/)
    expect(await db.productMediaAssets.count()).toBe(0);expect(await db.productMediaBlobs.count()).toBe(0)
    expect(await inspectAgentRunArtifactAvailabilityV1(f.locator)).toMatchObject({state:'evidence-pruned'})
  })
  it('uses registered roots for the last child copy after real accepted-manual-track branching and original parent deletion',async()=>{
    const f=await fixture(),review=await prepareTtrpgOpenAudioUploadV1({...f.owner,request:f.request('evidence.accepted.manual','voice'),file:audioWavFixtureV1(),name:'manual foundation fixture',source:'fixture',license:'fixture only',durationMs:250,decision:'prepare-this-file-for-reviewed-audio'})
    await confirmTtrpgOpenAudioReviewV1({...f.owner,review,decision:'confirm-this-audio-and-audience'})
    const asset=await db.productMediaAssets.where('productRuntimeSessionId').equals(f.owner.sessionId).first()
    // Isolated future-owner metadata fixture, not a generated-adoption grant:
    // membership/branching uses a genuinely accepted existing manual track.
    await db.productMediaAssets.update(asset!.id!,{exactArtifactRefsJson:canonicalStringify([f.ref])})
    await deleteAgentRunV1(f.owner.scope,f.run.run.id)
    const child=await branchProductRuntimeSession({parentSessionId:f.owner.sessionId,throughSequence:(await readProductRuntimeState(f.owner.sessionId)).lastSequence,title:'media root child'})
    const copied=await db.productMediaAssets.where('productRuntimeSessionId').equals(child.id!).first();expect(copied!.exactArtifactRefsJson).toBe(canonicalStringify([f.ref]))
    await deleteProductRuntimeSession(f.owner.sessionId);await markAndSweepAgentRunArtifactsV1(f.owner.scope.projectId)
    expect(await readAgentRunArtifactExactV1(f.locator)).toBe('immutable original media evidence')
    await deleteProductRuntimeSession(child.id!);await markAndSweepAgentRunArtifactsV1(f.owner.scope.projectId)
    expect(await inspectAgentRunArtifactAvailabilityV1(f.locator)).toMatchObject({state:'evidence-pruned'})
  })
  it('captures incoming references before the first await and never lets another project acquire the original body',async()=>{
    const f=await fixture(),refs=[{...f.ref}],input={...f.input,scope:{...f.input.scope},exactArtifactRefs:refs}
    const pending=importProductRuntimeMediaAssetV1(input);refs[0].contentHash='0'.repeat(64);input.scope.projectId+=999
    const result=await pending;expect(result.exactArtifactRefsJson).toBe(canonicalStringify([f.ref]))
    const other=await setupAudioRuntimeV1();await expect(importProductRuntimeMediaAssetV1({...f.input,scope:other.owner.scope,productRuntimeSessionId:other.owner.sessionId,exactArtifactRefs:[f.ref]})).rejects.toThrow(/missing/)
    expect(await db.productMediaAssets.where('projectId').equals(other.owner.scope.projectId).count()).toBe(0)
  })
  it('fails closed on damaged declared owner JSON without deleting its source Run or body',async()=>{
    const f=await fixture(),asset=await importProductRuntimeMediaAssetV1({...f.input,exactArtifactRefs:[f.ref]})
    await db.productMediaAssets.update(asset.id!,{exactArtifactRefsJson:'{damaged'})
    expect(()=>extractExactArtifactOwnerRootsV1({exactArtifactRefsJson:'{damaged'},REGISTRY_BY_NAME.get('productMediaAssets')!.exactArtifactRoots!)).toThrow(/清理已停止/)
    await expect(deleteAgentRunV1(f.owner.scope,f.run.run.id)).rejects.toThrow(/清理已停止/)
    expect(await db.agentRuns.get(f.run.run.id)).toBeDefined();expect(await readAgentRunArtifactExactV1(f.locator)).toBe('immutable original media evidence')
  })
  it('does not queue or retry an import when another page holds the native metadata lock',async()=>{
    const f=await fixture(),descriptor=Object.getOwnPropertyDescriptor(navigator,'locks'),request=vi.fn(async(_key:string,_options:unknown,callback:(lock:null)=>unknown)=>callback(null))
    Object.defineProperty(navigator,'locks',{configurable:true,value:{request}})
    try{
      await expect(importProductRuntimeMediaAssetV1({...f.input,exactArtifactRefs:[f.ref]})).rejects.toThrow(/另一页面/)
      expect(request).toHaveBeenCalledTimes(1);expect(await db.productMediaAssets.count()).toBe(0);expect(await db.mediaBlobObjects.count()).toBe(0)
    }finally{if(descriptor)Object.defineProperty(navigator,'locks',descriptor);else Reflect.deleteProperty(navigator,'locks')}
    const result=await importProductRuntimeMediaAssetV1({...f.input,exactArtifactRefs:[f.ref]});expect(result.version).toBe(1)
  })
})
