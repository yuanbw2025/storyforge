import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { createConfiguredProductProductionExecutorV1, createBuiltInProductionCapabilityBindingV1, type ProductionTextRunnerV1 } from '../../src/lib/product-production/production-executor'
import { ProductProductionDraftRejectedErrorV1 } from '../../src/lib/product-production/scheduler'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { assertTtrpgOpenProductionMediaRequirementsV1, bindTtrpgOpenProductionMediaV1,
  ttrpgOpenProductionMediaContextV1 } from '../../src/lib/ttrpg/open-production-media'
import { createProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import type { ProductBuildArtifactRecordV1 } from '../../src/lib/types'
import type { ProductProductionTaskExecutionInputV1 } from '../../src/lib/product-production/scheduler'
import { openProductionCompilerFixtureV1 } from '../helpers/open-ttrpg-production-artifacts'

describe('R-TTRPGOPEN2 current Build deterministic open integration', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  async function fixture(publishable = false, withMedia = false, withAudio = false) {
    const data = await openProductionCompilerFixtureV1(publishable), { brief } = data.input
    const mediaRequirement = { schema: 'storyforge.product-media-requirements-artifact', version: 2,
      visual: withMedia ? [{ artifactKey: 'media.visual.001', mediaKind: 'background', sceneTag: 'slot.harbor',
        beatKey: 'open.entry.text', prompt: '无人物的港口远景', altText: '港口', width: 640, height: 360,
        palette: ['#123456', '#789abc', '#ffffff'], characterAnchorRefs: [], hardConstraints: [] }] : [],
      audio: withAudio ? [{ artifactKey: 'media.audio.001', mediaKind: 'sfx', sceneTag: 'sound.wind', beatKey: 'open.entry.text',
        prompt: '短促环境音效', altText: '环境音效', durationMs: 500 }] : [] }
    if (withMedia) {
      brief.media = { ...brief.media, visualLevel: 'key-scenes', imageCount: 1, requiredMediaKinds: ['background'] }
      const basis = { requirementKey: 'media.visual', mediaClass: 'image' as const, operation: 'generate',
        adapterFamily: 'configured-media', minimumCapabilityVersion: '1', allowedDataClasses: ['world-selection'],
        maximumRequestCost: null, maximumTotalCost: null, rightsPolicyVersion: 'storyforge-rights-v1', required: true }
      brief.capabilityRequirements.push({ ...basis, capabilityHash: await hashProductProductionValueV2(basis) })
      data.situationLayer.metadata.mediaManifest.slots = [{ slotKey: 'slot.harbor', kind: 'scene', targetRef: 'harbor',
        audience: 'party', productionRequired: true, assetKey: null, fallbackText: '港口远景', altText: '港口',
        promptTemplate: '无人物的港口远景', width: 640, height: 360 }]
    }
    if (withAudio) {
      brief.media.audioLevel = 'music-sfx'; brief.media.sfxCount = 1; brief.media.requiredMediaKinds.push('sfx')
      brief.productionBudget.maximumMediaCalls = brief.media.imageCount + 1
      const basis = { requirementKey: 'media.sfx', mediaClass: 'sfx' as const, operation: 'generate',
        adapterFamily: 'configured-media', minimumCapabilityVersion: '1', allowedDataClasses: ['world-selection'],
        maximumRequestCost: null, maximumTotalCost: null, rightsPolicyVersion: 'storyforge-rights-v1', required: true }
      brief.capabilityRequirements.push({ ...basis, capabilityHash: await hashProductProductionValueV2(basis) })
    }
    const production = (await db.productProductions.get(data.productionId))!
    const saved = await executeProductProductionCommand({ scope: data.scope, productionId: data.productionId,
      command: { type: 'save-brief-revision', commandId: 'executor.save', expectedStateRevision: production.stateRevision,
        parentRevision: production.currentBriefRevision, brief } })
    expect(saved.ok).toBe(true)
    const current = (await db.productProductions.get(data.productionId))!
    const row = (await db.productProductionBriefs.where('[productionId+revision]')
      .equals([data.productionId, current.currentBriefRevision]).first())!
    const started = await executeProductProductionCommand({ scope: data.scope, productionId: data.productionId,
      command: { type: 'authorize-start', commandId: 'executor.start', expectedStateRevision: current.stateRevision,
        briefRevision: row.revision, briefHash: row.briefHash, authorizationNonce: 'author.executor.start' } })
    expect(started.ok).toBe(true)
    const build = (await db.productBuilds.where('productionId').equals(data.productionId).first())!
    const plan = await createProductProductionPlanV3({ brief, briefHash: build.briefHash,
      buildNumber: build.buildNumber, controlEpoch: build.controlEpoch })
    // Isolated executor fixture: the scheduler's plan initialization is tested separately.
    build.planJson = JSON.stringify(plan); build.planHash = await hashProductProductionValueV2(plan)
    await db.productBuilds.put(build)
    async function put(artifactKey: string, payload: unknown) {
      const artifact: ProductBuildArtifactRecordV1 = { ...data.scope, buildId: build.id!, artifactKey,
        requirementKey: null, version: 1, kind: artifactKey === 'media.requirements' ? 'asset-manifest' : 'product-module',
        mediaKind: null, status: 'accepted', producerRunId: null, producerReceiptHash: null, controlEpoch: build.controlEpoch,
        inputHash: build.briefHash, contentHash: await hashProductProductionValueV2(payload), payloadJson: JSON.stringify(payload),
        metadataJson: '{}', qualityJson: '{}', rightsJson: '{}', blobObjectId: null, mimeType: null, byteSize: 0,
        parentArtifactHash: null, carriedFrom: null, createdAt: Date.now(), updatedAt: Date.now() }
      artifact.id = await db.productBuildArtifacts.add(artifact)
      return artifact
    }
    const artifacts = await Promise.all([
      put('ttrpg.open.source-facts', data.sourceFacts), put('ttrpg.open.rule-system', data.ruleSystem),
      put('ttrpg.open.situation-layer', data.situationLayer),
      put('media.requirements', mediaRequirement),
    ])
    const request: ProductProductionTaskExecutionInputV1 = { scope: data.scope, productionId: data.productionId,
      buildId: build.id!, buildNumber: build.buildNumber, controlEpoch: build.controlEpoch, planHash: build.planHash,
      task: plan.tasks.find(task => task.taskKey === 'ttrpg.open.integration')!, attempt: 1,
      idempotencyKey: 'executor.integration', contextText: '', inputArtifacts: artifacts,
      capabilityBindings: [], authorResolution: null, signal: new AbortController().signal }
    const execute = createConfiguredProductProductionExecutorV1({ production: current, brief,
      runText: async () => { throw new Error('deterministic integration must not call a provider') } })
    return { ...data, artifacts, request, execute, put, plan, mediaRequirement }
  }
  it('builds protocol 2 from actual accepted rows and rejects protocol 1 readers without fabricated endings', async () => {
    const { request, execute } = await fixture()
    const result = await execute(request), pkg = result.artifacts.find(row => row.artifactKey === 'runtime.package')!.payload
    const parsed = parseProductRuntimePackageV1(pkg, { ttrpgProtocol: 2 })
    expect(parsed.ttrpg!.campaign.version).toBe(2)
    expect(parsed.ttrpg!.campaign.endings).toEqual([])
    expect(parsed.narrative.choices).toEqual([])
    expect(result.usage.modelCalls).toBe(0)
    expect(() => parseProductRuntimePackageV1(pkg)).toThrow()
  })
  it('rejects unadopted rows, cross-scope artifacts, changed hashes and a stale Build fence', async () => {
    const { artifacts, request, execute } = await fixture(), row = artifacts[0]
    await db.productBuildArtifacts.update(row.id!, { status: 'candidate' })
    await expect(execute(request)).rejects.toThrow(/已采纳/)
    await db.productBuildArtifacts.update(row.id!, { status: 'accepted', projectId: row.projectId + 1 })
    await expect(execute(request)).rejects.toThrow(/已采纳/)
    await db.productBuildArtifacts.update(row.id!, { projectId: row.projectId, payloadJson: '{}' })
    await expect(execute(request)).rejects.toThrow(/已采纳/)
    await db.productBuildArtifacts.put(row)
    await db.productBuilds.update(request.buildId, { controlEpoch: request.controlEpoch + 1 })
    await expect(execute(request)).rejects.toThrow(/Build/)
  })
  it('blocks a structurally incomplete open scenario through open gates rather than filling closed-story defaults', async () => {
    const { request, execute, put, plan } = await fixture(), result = await execute(request)
    const inputArtifacts = await Promise.all(result.artifacts.map(row => put(row.artifactKey, row.payload)))
    await expect(execute({ ...request, inputArtifacts,
      task: plan.tasks.find(task => task.taskKey === 'ttrpg.open.quality')! })).rejects.toThrow(/open-situation-layer|safety-and-companions/)
  })
  it('joins all nine actual open content gates without requiring fictional endings or claiming external acceptance', async () => {
    const { request, execute, put, plan } = await fixture(true), result = await execute(request)
    const inputArtifacts = await Promise.all(result.artifacts.map(row => put(row.artifactKey, row.payload)))
    const checked = await execute({ ...request, inputArtifacts,
      task: plan.tasks.find(task => task.taskKey === 'ttrpg.open.quality')! })
    const report = checked.artifacts[0].payload as { hardGateResults: { gateId: string; passed: boolean }[]; warnings: string[] }
    expect(report.hardGateResults.every(gate => gate.passed)).toBe(true)
    expect(report.hardGateResults.map(gate => gate.gateId)).toContain('product.ttrpg.open-situation-layer')
    expect(report.hardGateResults.map(gate => gate.gateId)).not.toContain('product.narrative.endings')
    expect(report.warnings.join()).toMatch(/真实模型.*独立证据/)
  })
  it('uses the shared generator and real owned blob, binds an exact open slot, and refuses corrupt bytes', async () => {
    const { request, execute, put, plan } = await fixture(true, true)
    await expect(execute(request)).rejects.toThrow(/media.visual.001/)
    const generated = await execute({ ...request, task: plan.tasks.find(task => task.taskKey === 'media.visual')!,
      capabilityBindings: [await createBuiltInProductionCapabilityBindingV1({ requirementKey: 'media.visual', adapterId: 'storyforge.procedural-svg.v1' })] })
    expect(generated.usage.mediaCalls).toBe(1)
    const output = generated.artifacts[0], media = await put(output.artifactKey, output.payload)
    Object.assign(media, { kind: output.kind, mediaKind: output.mediaKind, metadataJson: JSON.stringify(output.metadata),
      qualityJson: JSON.stringify(output.quality), rightsJson: JSON.stringify(output.rights), contentHash: output.contentHash,
      blobObjectId: output.blobObjectId, mimeType: output.mimeType, byteSize: output.byteSize })
    await db.productBuildArtifacts.put(media)
    const input = { ...request, inputArtifacts: [...request.inputArtifacts, media] }
    const integrated = await execute(input)
    const pkg = parseProductRuntimePackageV1(integrated.artifacts.find(row => row.artifactKey === 'runtime.package')!.payload, { ttrpgProtocol: 2 })
    expect(pkg.ttrpg!.campaign.mediaManifest!.slots[0].assetKey).toBe(pkg.presentation!.assets[0].assetKey)
    expect(pkg.presentation!.cues).toEqual([])
    const checkedRows = await Promise.all(integrated.artifacts.map(row => put(row.artifactKey, row.payload)))
    const checked = await execute({ ...request, inputArtifacts: checkedRows, task: plan.tasks.find(task => task.taskKey === 'ttrpg.open.quality')! })
    expect(checked.artifacts[0].payload).toMatchObject({ mediaCoverage: 1, releaseReady: true })
    await db.mediaBlobObjects.update(media.blobObjectId!, { data: new Uint8Array([1, 2, 3]).buffer })
    await expect(execute(input)).rejects.toThrow(/大小不匹配|哈希不匹配/)
  })
  it('rejects changed media targets or fictional prebound assets before accepting a package', async () => {
    const { input, ruleSystem, situationLayer, mediaRequirement } = await fixture(true, true)
    const context = ttrpgOpenProductionMediaContextV1({ ruleSystem, situationLayer, rulePack: input.brief.ttrpgOpen!.rulePack })
    const changed = structuredClone(mediaRequirement.visual)
    changed[0].sceneTag = 'slot.nonexistent'
    expect(() => assertTtrpgOpenProductionMediaRequirementsV1({ context, visual: changed, audio: [] })).toThrow(/槽位/)
    const { compileProductionTtrpgOpenCampaignV2 } = await import('../../src/lib/ttrpg/open-production-compiler')
    const campaign = await compileProductionTtrpgOpenCampaignV2({ ...input, briefHash: await hashProductProductionValueV2(input.brief),
      situationLayer: { payload: situationLayer, contentHash: await hashProductProductionValueV2(situationLayer) } })
    campaign.mediaManifest.slots[0].productionRequired = false
    campaign.mediaManifest.slots[0].assetKey = 'fictional.asset'
    expect(() => bindTtrpgOpenProductionMediaV1({ campaign, visual: [], assetsByArtifact: new Map() })).toThrow(/真实文件/)
  })
  it('uses the existing audio owner to produce real WAV bytes, includes them in the package, and measures actual coverage', async () => {
    const { request, execute, put, plan } = await fixture(true, false, true)
    const generated = await execute({ ...request, task: plan.tasks.find(task => task.taskKey === 'media.audio')!,
      capabilityBindings: [await createBuiltInProductionCapabilityBindingV1({ requirementKey: 'media.sfx', adapterId: 'storyforge.procedural-audio.v1' })] })
    const output = generated.artifacts[0], media = await put(output.artifactKey, output.payload)
    Object.assign(media, { kind: output.kind, mediaKind: output.mediaKind, metadataJson: JSON.stringify(output.metadata),
      qualityJson: JSON.stringify(output.quality), rightsJson: JSON.stringify(output.rights), contentHash: output.contentHash,
      blobObjectId: output.blobObjectId, mimeType: output.mimeType, byteSize: output.byteSize })
    await db.productBuildArtifacts.put(media)
    const blob = (await db.mediaBlobObjects.get(media.blobObjectId!))!
    expect(new TextDecoder().decode(blob.data!.slice(0, 4))).toBe('RIFF')
    expect(blob.byteSize).toBeGreaterThan(44)
    const integrated = await execute({ ...request, inputArtifacts: [...request.inputArtifacts, media] })
    const pkg = parseProductRuntimePackageV1(integrated.artifacts.find(row => row.artifactKey === 'runtime.package')!.payload, { ttrpgProtocol: 2 })
    expect(pkg.presentation!.assets[0]).toMatchObject({ kind: 'sfx', mimeType: 'audio/wav', durationMs: 500 })
    const inputArtifacts = await Promise.all(integrated.artifacts.map(row => put(row.artifactKey, row.payload)))
    const checked = await execute({ ...request, inputArtifacts, task: plan.tasks.find(task => task.taskKey === 'ttrpg.open.quality')! })
    expect(checked.artifacts[0].payload).toMatchObject({ mediaCoverage: 1 })
  })
  it('integrates after export/import using remapped locators and unchanged confirmed Brief bytes', async () => {
    const { request, input, scope, artifacts } = await fixture()
    const projectId = await importProjectJSON(await exportProjectJSON(scope.projectId))
    const production = (await db.productProductions.where('projectId').equals(projectId).first())!
    const build = (await db.productBuilds.where('productionId').equals(production.id!).first())!
    const restoredScope = { projectId, worldId: production.worldId!, workId: production.workId! }
    const restoredRows = await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()
    expect(restoredRows.map(row => row.contentHash).sort()).toEqual(artifacts.map(row => row.contentHash).sort())
    const execute = createConfiguredProductProductionExecutorV1({ production, brief: input.brief,
      runText: async () => { throw new Error('no provider') } })
    const result = await execute({ ...request, scope: restoredScope, productionId: production.id!, buildId: build.id!,
      controlEpoch: build.controlEpoch, planHash: build.planHash, inputArtifacts: restoredRows })
    const pkg = parseProductRuntimePackageV1(result.artifacts.find(row => row.artifactKey === 'runtime.package')!.payload,
      { ttrpgProtocol: 2 })
    expect(pkg.ttrpg!.campaign.sourceWorld.contentHash).toBe(input.brief.source.worldContentHash)
  })
  it.each(['ttrpg.open.source-facts', 'ttrpg.open.rule-system'])('%s retains paid raw output and pauses for explicit author review', async taskKey => {
    const data = await fixture(), task = data.plan.tasks.find(task => task.taskKey === taskKey)!
    const payload = taskKey.endsWith('source-facts') ? data.sourceFacts : data.ruleSystem
    const bindingHash = 'a'.repeat(64), requirementKey = task.capabilityRequirementKeys[0], raws: string[] = []
    let calls = 0
    const runText: ProductionTextRunnerV1 = async () => {
      calls++
      return { output: JSON.stringify(payload), usage: { inputTokens: 90, outputTokens: 120 },
        bindingReceipt: { schema: 'storyforge.provider-binding-receipt', version: 1, requirementKey,
          adapterId: 'configured-text.v1', adapterVersion: 1, provider: 'fixture', model: 'fixture-model',
          endpointOrigin: 'https://fixture.invalid', executionLocation: 'browser-direct',
          credentialSource: 'existing-ai-config', credentialPresent: true, capabilityHash: bindingHash,
          boundAt: 1, receiptHash: bindingHash } }
    }
    const production = (await db.productProductions.get(data.productionId))!
    const execute = createConfiguredProductProductionExecutorV1({ production, brief: data.input.brief, runText })
    const request = { ...data.request, task, capabilityBindings: [{ requirementKey, adapterId: 'configured-text.v1', bindingHash }],
      onModelOutput: async (raw: string) => { raws.push(raw) } }
    const failure = await execute(request).catch(error => error)
    expect(failure).toBeInstanceOf(ProductProductionDraftRejectedErrorV1)
    expect(failure.usage).toMatchObject({ modelCalls: 1, inputTokens: 90, outputTokens: 120, costUsd: null })
    expect(raws).toEqual([JSON.stringify(payload)]); expect(calls).toBe(1)
    const authorDraftJson = JSON.stringify(payload)
    await expect(execute({ ...request, authorDraftJson })).rejects.toThrow(/人工确认回执/)
    const confirmed = await execute({ ...request, authorDraftJson, authorResolution: {
      commandId: 'author.review.current-task', blockerKey: taskKey, resolvedAt: Date.now(),
      resolution: { action: 'author-edit', authorDraftJson, note: '逐项确认事实或数值与来源' } } })
    expect(confirmed.usage.modelCalls).toBe(0); expect(calls).toBe(1)
    expect(confirmed.artifacts[0].rights).toMatchObject({ authorRevisionCommandId: 'author.review.current-task' })
  })
})
