import { expect, test } from '@playwright/test'

// This opt-in feature is exercised only in an isolated technical test server.
// The provider response is original Canvas PNG, never a real paid generation.
for (const {large,retained} of [{large:false,retained:false},{large:true,retained:false},{large:false,retained:true},{large:true,retained:true}]) test(retained
  ? `stopped image ${large ? 'OPFS' : 'IndexedDB'} retains read-only provenance and actual decoded pixels after backup remapping`
  : `generated image ${large ? 'OPFS' : 'IndexedDB'} uses real decoding, explicit choice, refreshed Harness join and portable backup`, async ({ page }) => {
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION !== '1', 'Experimental media dispatch is off by default')
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./avg/library')
  let requests = 0
  let imageBase64 = ''
  let referenceBase64 = ''
  await page.route('https://apihub.agnes-ai.com/v1/images/generations', async route => {
    requests++
    expect(route.request().postDataJSON().extra_body.image).toEqual([`data:image/png;base64,${referenceBase64}`])
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ b64_json: imageBase64 }] }) })
  })
  const seeded = await page.evaluate(async large => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [fixture, service, draft, config, editor] = await Promise.all([load('/storyforge/tests/helpers/avg-production-assembly-fixture.ts'),
      load('/storyforge/src/lib/avg/assembly-service.ts'), load('/storyforge/src/lib/avg/draft-service.ts'), load('/storyforge/src/stores/ai-config.ts'),
      load('/storyforge/src/lib/avg/editor-service.ts')])
    config.useAIConfigStore.getState().setConfig({ provider: 'agnes', apiKey: 'test-only-Agnes-intercepted', model: 'agnes-2.5-flash', baseUrl: 'https://apihub.agnes-ai.com/v1' })
    const s = await fixture.prepareNativeAvgAssembly()
    const canvas = document.createElement('canvas'); canvas.width = 576; canvas.height = 324
    const context = canvas.getContext('2d')!; context.fillStyle = '#18213b'; context.fillRect(0, 0, 576, 324)
    const referenceBase64 = canvas.toDataURL('image/png').split(',')[1]
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('canvas failed')), 'image/png'))
    const reference = await editor.importAvgMediaForAssemblyV1({ scope: s.scope, data: await png.arrayBuffer(), mimeType: 'image/png',
      kind: 'background', name: '原创工程参考', altText: '色块参考', license: 'CC0-1.0 original engineering fixture', characterTag: '' })
    if (large) {
      canvas.width = 2048; canvas.height = 1152
      const pixels = context.createImageData(canvas.width, canvas.height)
      for (let i = 0; i < pixels.data.length; i += 65536) crypto.getRandomValues(pixels.data.subarray(i, Math.min(i + 65536, pixels.data.length)))
      context.putImageData(pixels, 0, 0)
    }
    const imageBase64 = large ? canvas.toDataURL('image/png').split(',')[1] : referenceBase64
    const requirement = { requirementKey: 'desk.background', revision: 1, assetKey: 'avg.generated.desk', name: '原创工程背景', altText: '浏览器解码校准色块',
      family: { subjectKey: 'desk', familyKey: 'desk.day', variantKey: 'day', revision: 1 },
      consumer: { consumerKey: 'desk.background', domain: 'stage', slot: 'background', subjectKey: 'desk', sceneKey: 'desk', lineKey: null, required: true, fallback: 'none' },
      triggerBeatKey: 'line.desk', itemVariantKey: null, mediaKind: 'background', prompt: '原创工程房间', negativePrompt: '', invariants: [], forbiddenDepictions: [],
      width: 576, height: 324, resolutionTier: '1K', alpha: 'not-required', references: [{ assetKey: reference.assetKey, assetVersion: reference.version,
        contentHash: reference.contentHash, mimeType: reference.mimeType, byteSize: reference.byteSize, purpose: 'style', allowedChange: '仅保留配色',
        dataClass: 'avg-authorized-reference', license: reference.license, providerInputAllowed: true, derivativeUseAllowed: true, crop: null, mask: null }] }
    const saved = await service.saveAvgVisualBatchDraftV1({ scope: s.scope, expectedDraftRevision: (await draft.readAvgDraftV1(s.scope)).revision,
      batchKey: 'browser.original', revision: 1, requirements: [requirement],...(large?{visualReviewPolicy:'author-visual-v1'}:{}) })
    const prepared = await service.prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: saved.revision })
    const started = await service.startAvgAssemblyV1({ scope: s.scope, productionId: s.productionId, expectedBriefHash: prepared.brief.briefHash })
    for (const artifactKey of ['avg.system.plan', ...started.executionBrief.avgAssembly.sceneKeys.map((key: string) => `avg.content.scene-script.${key}`)]) {
      const candidate = await service.stageAvgWorkspaceInputV1({ scope: s.scope, productionId: s.productionId,
        expectedDraftRevision: (await draft.readAvgDraftV1(s.scope)).revision, artifactKey, declaration: '原创工程输入；非艺术验收' })
      await service.confirmAvgWorkspaceInputV1({ scope: s.scope, productionId: s.productionId, artifactKey, candidateVersion: candidate.version,
        candidateHash: JSON.parse(candidate.metadataJson).candidateHash })
    }
    return { scope: s.scope, productionId: s.productionId, buildId: started.build.id, imageBase64, referenceBase64,requirement,review:large }
  }, large)
  imageBase64 = seeded.imageBase64
  referenceBase64 = seeded.referenceBase64
  const received = await page.evaluate(async s => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [service, { db }] = await Promise.all([load('/storyforge/src/lib/avg/assembly-service.ts'), load('/storyforge/src/lib/db/schema.ts')])
    const result = await service.runAvgAssemblyV1({ scope: s.scope, productionId: s.productionId })
    const raw = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId, 'avg.media.raw.desk.background']).filter((row: any) => row.status === 'accepted').first()
    if (!raw) throw new Error((await db.productBuilds.get(s.buildId)).failureJson)
    if(s.review){
      const fixture=await load('/storyforge/tests/helpers/avg-visual-review-fixture.ts')
      const report=await service.stageAvgVisualReviewV1({scope:s.scope,productionId:s.productionId,requirementKey:'desk.background',rawVersion:raw.version,rawContentHash:raw.contentHash,
        report:fixture.avgVisualReviewFixture(s.requirement,raw.contentHash),declaration:'控制工程图的视觉观察，实际字节与原生解码复验，不签商业艺术验收'})
      await service.confirmAvgWorkspaceInputV1({scope:s.scope,productionId:s.productionId,artifactKey:report.artifactKey,candidateVersion:report.version,candidateHash:JSON.parse(report.metadataJson).candidateHash})
    }
    const choice = await service.stageAvgMediaChoiceV2({ scope: s.scope, productionId: s.productionId, requirementKey: 'desk.background',
      rawVersion: raw.version, rawContentHash: raw.contentHash, declaration: '作者选择原图用于准确背景；工程验证非艺术验收' })
    return { status: result.buildStatus, choiceId: choice.id, hash: raw.contentHash, blobId: raw.blobObjectId, backend: (await db.mediaBlobObjects.get(raw.blobObjectId)).backend }
  }, seeded)
  expect(received.status).toBe('building'); expect(requests).toBe(1)
  expect(received.backend).toBe(large ? 'opfs' : 'indexeddb')
  await page.reload()
  if (retained) {
    const result = await page.evaluate(async s => {
      const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
      const [{ db }, proofs, backups, service, bytes] = await Promise.all([load('/storyforge/src/lib/db/schema.ts'),
        load('/storyforge/src/lib/product-production/artifact-store.ts'), load('/storyforge/src/lib/export/json-export.ts'),
        load('/storyforge/src/lib/product-production/service.ts'), load('/storyforge/src/lib/product-production/media-blob-store.ts')])
      const details = await service.readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
      await service.stopProductProductionV1({ scope: s.scope, production: details.production })
      const before = await db.productBuilds.get(s.buildId)
      const read = async (scope: any, build: any) => {
        const raw = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id, 'avg.media.raw.desk.background']).filter((r: any) => r.status === 'accepted').first()
        const proof = await proofs.verifyRetainedAvgRawImageArtifactV1({ scope, buildId: build.id, expectedBuildRevision: build.stateRevision,
          expectedBriefHash: build.briefHash, expectedPlanHash: build.planHash, sourceControlEpoch: raw.controlEpoch,
          artifactKey: raw.artifactKey, version: raw.version, contentHash: raw.contentHash })
        return { raw, proof }
      }
      const source = await read(s.scope, before)
      const projectId = await backups.importProjectJSON(await backups.exportProjectJSON(s.scope.projectId))
      const restored = await db.productBuilds.where('projectId').equals(projectId).first()
      const scope = { projectId, worldId: restored.worldId, workId: restored.workId }
      const imported = await read(scope, restored)
      const blob = await db.mediaBlobObjects.get(imported.raw.blobObjectId)
      const bitmap = await createImageBitmap(new Blob([await bytes.readVerifiedMediaBlobObjectData(blob)], { type: blob.mimeType }))
      const decoded = { width: bitmap.width, height: bitmap.height }; bitmap.close()
      let activeRejected = false
      try { await proofs.verifyAcceptedProductBuildArtifactV1({ scope, buildId: restored.id, artifactKey: imported.raw.artifactKey,
        version: imported.raw.version, contentHash: imported.raw.contentHash }) } catch { activeRejected = true }
      return { sameProof: JSON.stringify(source.proof.provenance) === JSON.stringify(imported.proof.provenance),
        remapped: imported.raw.blobObjectId !== source.raw.blobObjectId, activeRejected, decoded, backend: blob.backend,
        runState: (await db.agentRuns.get(imported.raw.producerRunId)).status,
        oldUnchanged: JSON.stringify(await db.productBuilds.get(s.buildId)) === JSON.stringify(before) }
    }, seeded)
    // Portable binary import deliberately restores bytes into IndexedDB; the
    // original large-image OPFS backend was verified before export above.
    expect(result).toMatchObject({ sameProof:true,remapped:true,activeRejected:true,oldUnchanged:true,runState:'running',backend:'indexeddb',
      decoded:{width:large?2048:576,height:large?1152:324} })
    expect(requests).toBe(1)
    return
  }
  const result = await page.evaluate(async ({ s, received }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [service, draft, { db }, previews, backups, runtime] = await Promise.all([load('/storyforge/src/lib/avg/assembly-service.ts'), load('/storyforge/src/lib/avg/draft-service.ts'),
      load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/lib/product-production/preview-manifest.ts'), load('/storyforge/src/lib/export/json-export.ts'),
      load('/storyforge/src/lib/product-production/service.ts')])
    const choice = await db.productBuildArtifacts.get(received.choiceId)
    const pending = choice.status
    await service.confirmAvgWorkspaceInputV1({ scope: s.scope, productionId: s.productionId, artifactKey: choice.artifactKey,
      candidateVersion: choice.version, candidateHash: JSON.parse(choice.metadataJson).candidateHash })
    const configured = await service.configureAvgChosenMediaDraftV2({ scope: s.scope, productionId: s.productionId, expectedDraftRevision: (await draft.readAvgDraftV1(s.scope)).revision })
    const stage = await service.stageAvgWorkspaceInputV1({ scope: s.scope, productionId: s.productionId, expectedDraftRevision: configured.revision,
      artifactKey: 'avg.author.stage', declaration: '作者确认自动配置的准确背景与触发句' })
    await service.confirmAvgWorkspaceInputV1({ scope: s.scope, productionId: s.productionId, artifactKey: stage.artifactKey,
      candidateVersion: stage.version, candidateHash: JSON.parse(stage.metadataJson).candidateHash })
    const finished = await service.runAvgAssemblyV1({ scope: s.scope, productionId: s.productionId })
    const build = await db.productBuilds.get(s.buildId), preview = await previews.verifyStoredProductBuildPreview(build)
    let offlineCarry:null|{status:string;sourceBytes:number;referenceRejected:boolean}=null
    if(received.backend==='opfs'){
      const [editor,references]=await Promise.all([load('/storyforge/src/lib/avg/editor-service.ts'),load('/storyforge/src/lib/avg/media-generated-reference.ts')])
      const current=await draft.readAvgDraftV1(s.scope),workspace=JSON.parse(current.editorJson);workspace.basePreviewHash=build.previewHash
      const saved=await editor.saveAvgAuthorWorkspaceV1(s.scope,current.revision,workspace)
      const kept=await service.keepAvgGeneratedStageDraftV1({scope:s.scope,productionId:s.productionId,expectedDraftRevision:saved.revision,expectedBuildId:s.buildId})
      let referenceRejected=false
      try{await references.prepareAvgGeneratedReferenceImageV1({scope:s.scope,choiceId:received.choiceId})}catch(error){referenceRejected=String(error).includes('8 MiB')}
      const prepared=await service.prepareAvgAssemblyBriefV1({scope:s.scope,expectedDraftRevision:kept.revision})
      const started=await service.startAvgAssemblyV1({scope:s.scope,productionId:s.productionId,expectedBriefHash:prepared.brief.briefHash})
      for(const artifactKey of ['avg.system.plan',...started.executionBrief.avgAssembly.sceneKeys.map((key:string)=>`avg.content.scene-script.${key}`),'avg.author.stage']){
        const candidate=await service.stageAvgWorkspaceInputV1({scope:s.scope,productionId:s.productionId,expectedDraftRevision:(await draft.readAvgDraftV1(s.scope)).revision,artifactKey,declaration:'明确保留大于参考输入上限的舞台原图，零调用重新确认'})
        await service.confirmAvgWorkspaceInputV1({scope:s.scope,productionId:s.productionId,artifactKey,candidateVersion:candidate.version,candidateHash:JSON.parse(candidate.metadataJson).candidateHash})
      }
      const carried=await service.runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})
      offlineCarry={status:carried.buildStatus,sourceBytes:JSON.parse(kept.editorJson).presentation.stage.assets[0].byteSize,referenceRejected}
    }
    const projectId = await backups.importProjectJSON(await backups.exportProjectJSON(s.scope.projectId))
    const restored = await db.productBuilds.where('projectId').equals(projectId).first()
    const scope = { projectId, worldId: restored.worldId, workId: restored.workId }
    const restoredPreview = await previews.verifyStoredProductBuildPreview(restored)
    const active=offlineCarry?await db.productBuilds.where('projectId').equals(projectId).filter((row:any)=>row.buildNumber===2).first():restored
    const session = await runtime.startProductProductionPreviewV1({ scope, productionId: active.productionId, expectedBuildId: active.id, expectedPreviewHash: active.previewHash })
    const aliases = await db.productBuildArtifacts.where('buildId').equals(restored.id).toArray()
    const asset = preview.runtimePackage.modules[0].stage.assets[0]
    return { pending, finished: finished.buildStatus, failure: build.failureJson, asset, sameManifest: restored.previewManifestJson === build.previewManifestJson,
      samePackage: JSON.stringify(restoredPreview.runtimePackage) === JSON.stringify(preview.runtimePackage),
      remapped: aliases.find((row: any) => row.artifactKey === 'avg.media.raw.desk.background').blobObjectId !== received.blobId,
      session: Boolean(session.sessionId), offlineCarry,rawResponses: (await db.agentRunArtifacts.toArray()).filter((row: any) => row.artifactKind === 'raw-response').length }
  }, { s: seeded, received })
  expect(result.finished, result.failure).toBe('preview-ready')
  expect(result).toMatchObject({ pending: 'pending', sameManifest: true, samePackage: true, remapped: true, session: true })
  expect(result.asset).toMatchObject({ contentHash: received.hash, width: large ? 2048 : 576, height: large ? 1152 : 324 })
  expect(result.rawResponses).toBeGreaterThanOrEqual(1)
  if(large){expect(result.offlineCarry).toMatchObject({status:'preview-ready',referenceRejected:true});expect(result.offlineCarry!.sourceBytes).toBeGreaterThan(8*1024*1024)}
  expect(requests).toBe(1)
})
