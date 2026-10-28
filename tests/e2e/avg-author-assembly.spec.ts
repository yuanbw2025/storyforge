import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed','e2e'))
  await page.goto('./avg/library')
})

test('author assembly decodes owned PNG/WAV, survives pending refresh, confirms exact dependencies and restores portable media', async ({ page }) => {
  const seeded = await page.evaluate(async () => {
    const load = new Function('p','return import(p)') as (p: string) => Promise<any>
    const [fixture, editor, draft] = await Promise.all([load('/storyforge/tests/helpers/avg-author-stage-fixture.ts'),
      load('/storyforge/src/lib/avg/editor-service.ts'), load('/storyforge/src/lib/avg/draft-service.ts')])
    const s = await fixture.seedAvgAuthorStageInputs()
    const media = await fixture.importAuthorStageMediaFixture(s)
    const workspace = { ...fixture.avgAuthorWorkspaceFixture(), presentation: media.presentation }
    const current = await draft.readAvgDraftV1(s.scope)
    const saved = await editor.saveAvgAuthorWorkspaceV1(s.scope,current.revision,workspace)
    const candidate = await fixture.stageAuthorStageFixture(s,media.presentation)
    return { scope: s.scope, buildId: s.buildId, productionId: s.productionId, candidateId: candidate.id,
      payloadJson: candidate.payloadJson, workspaceJson: saved.editorJson, image: media.image, voice: media.voice }
  })
  expect(seeded.image).toMatchObject({ width: 32,height: 18,durationMs: null })
  expect(seeded.voice.durationMs).toBeGreaterThanOrEqual(849)
  expect(seeded.voice.durationMs).toBeLessThanOrEqual(851)
  await page.reload()
  const result = await page.evaluate(async s => {
    const load = new Function('p','return import(p)') as (p: string) => Promise<any>
    const [fixture, compiler, { db }, backups, lifecycle, editor] = await Promise.all([
      load('/storyforge/tests/helpers/avg-author-stage-fixture.ts'),load('/storyforge/src/lib/avg/executable-compiler.ts'),
      load('/storyforge/src/lib/db/schema.ts'),load('/storyforge/src/lib/export/json-export.ts'),
      load('/storyforge/src/lib/workspace/lifecycle.ts'),load('/storyforge/src/lib/avg/editor-service.ts')])
    const candidate = await db.productBuildArtifacts.get(s.candidateId)
    let pendingError = ''
    try { await compiler.compileAdoptedAvgBuildV2({ ...await fixture.stageInput(s),product: { key: 'avg.author.fixture',title:'作者组装',description:'' } }) } catch(e) { pendingError=String(e) }
    const adopted = await fixture.confirmAuthorStageFixture(s,candidate)
    if (!adopted.ok) throw new Error(JSON.stringify(adopted))
    const actual = await compiler.compileAdoptedAvgBuildV2({ ...await fixture.stageInput(s),product: { key:'avg.author.fixture',title:'作者组装',description:'' } })
    const projectId = await backups.importProjectJSON(await backups.exportProjectJSON(s.scope.projectId))
    const build = await db.productBuilds.where('projectId').equals(projectId).first()
    const scope = { projectId,worldId:build.worldId,workId:build.workId }
    const restored = await compiler.compileAdoptedAvgBuildV2({ scope,buildId:build.id,expectedBuildRevision:build.stateRevision,controlEpoch:build.controlEpoch,
      product: { key:'avg.author.fixture',title:'作者组装',description:'' } })
    const image = await editor.readAvgDraftMediaV1(scope,s.image), voice = await editor.readAvgDraftMediaV1(scope,s.voice)
    const assetIds = await db.avgDraftMedia.where('workId').equals(scope.workId).toArray()
    const sourceIds = await db.avgDraftMedia.where('workId').equals(s.scope.workId).toArray()
    const draft = await db.avgAuthoringDrafts.where('workId').equals(scope.workId).first()
    await lifecycle.deleteWork(projectId,scope.workId)
    return { pendingError, adopted:adopted.ok, confirmedReceipt:adopted.result.authorReceiptHash,
      actualReceipt:actual.source.authorStage.authorReceiptHash, restoredReceipt:restored.source.authorStage.authorReceiptHash,
      samePackage:JSON.stringify(restored.runtimePackage)===JSON.stringify(actual.runtimePackage),
      imageBytes:image.byteLength,voiceBytes:voice.byteLength,remapped:assetIds.every((a:any,i:number)=>a.blobObjectId!==sourceIds[i].blobObjectId),
      editorPreserved:draft.editorJson===s.workspaceJson,originalPreserved:(await db.productBuildArtifacts.get(s.candidateId)).payloadJson===s.payloadJson,
      deleted:(await db.avgDraftMedia.where('workId').equals(scope.workId).count())===0, originalMedia:await db.avgDraftMedia.where('workId').equals(s.scope.workId).count(),
      runs:await db.agentRuns.count(),sessions:await db.productRuntimeSessions.count() }
  },seeded)
  expect(result.pendingError).toContain('未采用')
  expect(result).toMatchObject({ adopted:true,samePackage:true,remapped:true,editorPreserved:true,originalPreserved:true,deleted:true,originalMedia:2,runs:0,sessions:0 })
  expect(result.imageBytes).toBe(seeded.image.byteSize)
  expect(result.voiceBytes).toBe(seeded.voice.byteSize)
  expect(result.confirmedReceipt).toBe(result.actualReceipt)
  expect(result.restoredReceipt).toBe(result.actualReceipt)
})

test('author media refuses corrupt decoding, false MIME, foreign ownership, false dimensions and corrupted physical bytes', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const load = new Function('p','return import(p)') as (p: string) => Promise<any>
    const [fixture,editor,draft,{ db },compiler] = await Promise.all([load('/storyforge/tests/helpers/avg-author-stage-fixture.ts'),
      load('/storyforge/src/lib/avg/editor-service.ts'),load('/storyforge/src/lib/avg/draft-service.ts'),load('/storyforge/src/lib/db/schema.ts'),
      load('/storyforge/src/lib/avg/executable-compiler.ts')])
    const s = await fixture.seedAvgAuthorStageInputs(), media = await fixture.importAuthorStageMediaFixture(s)
    const errors: string[]=[]
    for (const [bytes,mime] of [[new Uint8Array([137,80,78,71,13,10,26,10]).buffer,'image/png'],
      [new TextEncoder().encode('RIFFxxxxWAVE').buffer,'audio/wav'],[new Uint8Array([137,80,78,71,13,10,26,10]).buffer,'image/jpeg']] as const) {
      try { await editor.importAvgMediaForAssemblyV1({ scope:s.scope,data:bytes,mimeType:mime,name:'无效媒体',kind:mime.startsWith('audio')?'voice':'background',license:'原创校准',altText:'测试',characterTag:'' }) } catch(e) { errors.push(String(e)) }
    }
    const foreign=await draft.createAvgDraftV1('外部作者')
    const row=await db.avgDraftMedia.where('workId').equals(s.scope.workId).first()
    await db.avgDraftMedia.update(row.id,{ ...foreign.scope })
    let foreignError='';try { await fixture.stageAuthorStageFixture(s,media.presentation) } catch(e) { foreignError=String(e) }
    await db.avgDraftMedia.update(row.id,s.scope)
    const falseMetadata=structuredClone(media.presentation);falseMetadata.stage.assets[0].width=999
    let dimensionError='';try { await fixture.stageAuthorStageFixture(s,falseMetadata) } catch(e) { dimensionError=String(e) }
    await db.avgDraftMedia.update(row.id,{assetJson:JSON.stringify(falseMetadata.stage.assets[0])})
    let restoredMetadataError='';try { await fixture.stageAuthorStageFixture(s,falseMetadata) } catch(e) { restoredMetadataError=String(e) }
    await db.avgDraftMedia.update(row.id,{assetJson:row.assetJson})
    const physical=await db.mediaBlobObjects.get(row.blobObjectId), falseMime=structuredClone(media.presentation)
    falseMime.stage.assets[0].mimeType='image/jpeg'
    await db.avgDraftMedia.update(row.id,{assetJson:JSON.stringify(falseMime.stage.assets[0])})
    await db.mediaBlobObjects.update(physical.id,{mimeType:'image/jpeg'})
    let restoredMimeError='';try { await fixture.stageAuthorStageFixture(s,falseMime) } catch(e) { restoredMimeError=String(e) }
    await db.avgDraftMedia.update(row.id,{assetJson:row.assetJson})
    await db.mediaBlobObjects.update(physical.id,{mimeType:physical.mimeType})
    const candidate=await fixture.stageAuthorStageFixture(s,media.presentation)
    const adopted=await fixture.confirmAuthorStageFixture(s,candidate)
    if(!adopted.ok) throw new Error(JSON.stringify(adopted))
    const blob=await db.mediaBlobObjects.get(row.blobObjectId), bad=blob.data.slice(0)
    new Uint8Array(bad)[bad.byteLength-1]^=1
    await db.mediaBlobObjects.update(blob.id,{ data:bad })
    let corruptError='';try { await compiler.compileAdoptedAvgBuildV2({ ...await fixture.stageInput(s),product:{key:'avg.author.fixture',title:'校验',description:''} }) } catch(e) { corruptError=String(e) }
    await db.mediaBlobObjects.update(blob.id,{ data:blob.data })
    return { errors,foreignError,dimensionError,restoredMetadataError,restoredMimeError,corruptError,uploads:await db.avgDraftMedia.where('workId').equals(s.scope.workId).count(),
      status:(await db.productBuildArtifacts.get(candidate.id)).status,runs:await db.agentRuns.count() }
  })
  expect(result.errors).toHaveLength(3)
  expect(result.errors[0]).toContain('解码失败')
  expect(result.errors[1]).toContain('解码失败')
  expect(result.errors[2]).toContain('MIME')
  expect(result.foreignError).toContain('未导入当前作品')
  expect(result.dimensionError).toContain('未导入当前作品')
  expect(result.restoredMetadataError).toContain('解码尺寸或时长')
  expect(result.restoredMimeError).toContain('MIME')
  expect(result.corruptError).toContain('哈希不匹配')
  expect(result).toMatchObject({ uploads:2,status:'accepted',runs:0 })
})

test('author assembly validates actual OPFS bytes inside confirmation and compilation transactions', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const load = new Function('p','return import(p)') as (p: string) => Promise<any>
    const [fixture,editor,audioFixture,{ db },compiler] = await Promise.all([
      load('/storyforge/tests/helpers/avg-author-stage-fixture.ts'),load('/storyforge/src/lib/avg/editor-service.ts'),
      load('/storyforge/tests/helpers/avg-reading-fixture.ts'),load('/storyforge/src/lib/db/schema.ts'),load('/storyforge/src/lib/avg/executable-compiler.ts')])
    const s=await fixture.seedAvgAuthorStageInputs()
    const audio=await audioFixture.avgReadingAudioFixture(270_000)
    const asset=await editor.importAvgMediaForAssemblyV1({scope:s.scope,data:audio.data,mimeType:'audio/wav',name:'OPFS 原创校准音（非人声）',
      kind:'bgm',license:'CC0-1.0 original engineering fixture',altText:'OPFS 字节验证',characterTag:''})
    const presentation=fixture.avgAuthorStageFixture(); presentation.stage.assets=[asset]
    const candidate=await fixture.stageAuthorStageFixture(s,presentation)
    const adopted=await fixture.confirmAuthorStageFixture(s,candidate)
    if(!adopted.ok) throw new Error(JSON.stringify(adopted))
    const compiled=await compiler.compileAdoptedAvgBuildV2({...await fixture.stageInput(s),product:{key:'avg.author.fixture',title:'OPFS 组装',description:''}})
    const media=await db.avgDraftMedia.where('workId').equals(s.scope.workId).first()
    const blob=await db.mediaBlobObjects.get(media.blobObjectId)
    return {backend:blob.backend,bytes:blob.byteSize,duration:asset.durationMs,receipt:compiled.source.authorStage.authorReceiptHash===adopted.result.authorReceiptHash}
  })
  expect(result).toMatchObject({backend:'opfs',receipt:true})
  expect(result.bytes).toBeGreaterThan(8*1024*1024)
  expect(result.duration).toBeGreaterThanOrEqual(269_999)
})
