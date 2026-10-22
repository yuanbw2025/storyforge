/** Real native IDB/Blob/retention/backup APIs on a seeded AVG instance. This
 * proves shared evidence lifetime, not generated media or product adoption. */
import { test,expect } from '@playwright/test'

test('native product media retains exact evidence across Run deletion and backup, with corrupt owner rollback and project isolation',async({page})=>{
  test.setTimeout(180000);await page.goto('./')
  const original=await page.evaluate(async()=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
    const worldHelpers=await load('/storyforge/tests/helpers/current-product-world.ts'),world=await worldHelpers.seedCurrentProductWorld('native media evidence')
    const catalog=await worldHelpers.loadCurrentProductWorldSourceCatalogV1({scope:world.scope,worldReleaseId:world.release.id,productType:'avg'})
    const pkg=(await load('/storyforge/tests/helpers/current-runtime-package.ts')).createCurrentRuntimePackageFixture({productType:'avg',worldRelease:world.release,sourceCatalog:catalog})
    const build=await(await load('/storyforge/tests/helpers/current-product-build.ts')).seedCurrentProductBuild({scope:world.scope,worldRelease:world.release,runtimePackage:pkg,title:'native shared media evidence'})
    const {db}=await load('/storyforge/src/lib/db/schema.ts'),runs=await load('/storyforge/src/lib/agent/run/event-store.ts'),artifacts=await load('/storyforge/src/lib/memory/artifact-store.ts')
    const run=await runs.createAgentRunV1({scope:world.scope,contract:{version:1,objective:'native media evidence fixture',workflowKind:'read-only-audit',runtimeBindingHash:'b'.repeat(64),scope:{projectId:world.scope.projectId,worldGroupId:null},permissions:{contextSourceKeys:['chapterContent'],writeTargets:[]},budget:{maxModelCalls:1,maxToolCalls:0,maxInputTokens:1000,maxOutputTokens:100,maxAttemptsPerStep:1},acceptance:[{id:'result',kind:'output-present',required:true}],verificationPlan:[{id:'terminal',kind:'terminal',verifier:'native-media-evidence',criterionIds:['result']}],failurePolicy:{onProtocolError:'fail',onVerificationFailure:'fail',onStaleInput:'pause-for-author'}}})
    const body='native original media raw evidence',saved=await artifacts.recordAgentRunArtifactV1({scope:world.scope,runId:run.run.id,artifactKind:'raw-response',content:body})
    const ref={artifactKind:saved.artifact.artifactKind,contentHash:saved.artifact.contentHash}
    const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;canvas.getContext('2d')!.fillRect(0,0,2,2)
    const blob=await new Promise<Blob>((done,fail)=>canvas.toBlob(value=>value?done(value):fail(Error('PNG encoding failed')),'image/png'))
    const input={scope:world.scope,productRuntimeSessionId:build.session.id,assetKey:'native.original.media',kind:'background',name:'native evidence PNG',blob,width:2,height:2,source:'synthetic native fixture',license:'fixture only',exactArtifactRefs:[ref]}
    const media=await load('/storyforge/src/lib/product/runtime-media-library.ts'),[first,second]=await Promise.all([media.importProductRuntimeMediaAssetV1(input),media.importProductRuntimeMediaAssetV1(input)])
    if(first.id!==second.id)throw Error('Concurrent original imports produced different assets')
    const json=first.exactArtifactRefsJson
    await db.productMediaAssets.update(first.id,{exactArtifactRefsJson:'{damaged-native-owner'})
    let denied=false;try{await runs.deleteAgentRunV1(world.scope,run.run.id)}catch{denied=true}
    if(!denied||!await db.agentRuns.get(run.run.id))throw Error('Corrupt declared owner did not roll back Run deletion')
    await db.productMediaAssets.update(first.id,{exactArtifactRefsJson:json})
    await runs.deleteAgentRunV1(world.scope,run.run.id);await artifacts.markAndSweepAgentRunArtifactsV1(world.scope.projectId)
    if(await artifacts.readAgentRunArtifactExactV1({projectId:world.scope.projectId,...ref})!==body)throw Error('Original exact evidence lost')
    return {scope:world.scope,sessionId:build.session.id,assetId:first.id,ref,json,body,denied}
  })
  await page.reload()
  const result=await page.evaluate(async f=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>,{db}=await load('/storyforge/src/lib/db/schema.ts')
    const artifacts=await load('/storyforge/src/lib/memory/artifact-store.ts'),backup=await load('/storyforge/src/lib/export/json-export.ts')
    const before=await artifacts.readAgentRunArtifactExactV1({projectId:f.scope.projectId,...f.ref}),asset=await db.productMediaAssets.get(f.assetId)
    const copy=await backup.importProjectJSON(await backup.exportProjectJSON(f.scope.projectId)),copiedAsset=await db.productMediaAssets.where('projectId').equals(copy).first()
    let pruneDenied=false;try{await artifacts.pruneAgentRunArtifactsExplicitlyV1({projectId:f.scope.projectId,targets:[f.ref]})}catch{pruneDenied=true}
    await(await load('/storyforge/src/lib/product/runtime-core.ts')).deleteProductRuntimeSession(f.sessionId)
    await artifacts.markAndSweepAgentRunArtifactsV1(f.scope.projectId)
    return {before,oldJson:asset.exactArtifactRefsJson,copiedJson:copiedAsset.exactArtifactRefsJson,pruneDenied,
      original:(await artifacts.inspectAgentRunArtifactAvailabilityV1({projectId:f.scope.projectId,...f.ref})).state,
      copiedBody:await artifacts.readAgentRunArtifactExactV1({projectId:copy,...f.ref}),copiedAssets:await db.productMediaAssets.where('projectId').equals(copy).count()}
  },original)
  expect(original.denied).toBe(true);expect(result).toEqual({before:original.body,oldJson:original.json,copiedJson:original.json,pruneDenied:true,original:'evidence-pruned',copiedBody:original.body,copiedAssets:1})
})
