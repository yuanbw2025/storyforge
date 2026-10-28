import { narrativeProductionProtocolFixtureV4 } from '../helpers/narrative-production-protocol-fixture'
import { runProductProductionUntilBlockedV1 } from '../../src/lib/product-production/scheduler'
import { publishProductProductionV1 } from '../../src/lib/product-production/service'
import type { ProductionTextRunnerV1 } from '../../src/lib/product-production/production-executor'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { createAgentRunV1, appendAgentRunEventV1 } from '../../src/lib/agent/run/event-store'
import { createContextManifestV1, createContextManifestV2FromV1 } from '../../src/lib/agent/run/context-manifest'
import { recordContextGatewayPreflightEvidenceV1, finalizeContextGatewayAttemptEvidenceV1 } from '../../src/lib/context-gateway/attempt-evidence'
import { executeContextGatewayV1, type ContextGatewayExecutionV1 } from '../../src/lib/context-gateway/execution'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { createProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createProductProductionSourcePlanV1, executeProductProductionWorldGatewayV1,
  parseProductProductionSourcePlanV1, parseConfirmedProductBriefV1 } from '../../src/lib/product-production/source-contracts'
import { loadProductProductionConsultationSourceV2 } from '../../src/lib/product-production/world-source'
import { createProductReleaseManifestV1, productReleaseIdentityHashV1, verifyProductReleaseManifestV1 } from '../../src/lib/product-production/runtime-package'
import { aggregateProductSourceManifestFromExactRuns, createConfirmedProductBriefV1, createProductReleaseLineageV1,
  portableProductSourcePlan, productReleaseUidV1, resolveProductSourceReadBoundary, validateProductSourceManifest,
  validateProductSourcePlan, validateProductSourcePlanV1 } from '../../src/lib/product/source-contracts'
import { assertExactProductSourceCatalogV2 } from '../../src/lib/product/exact-source-contracts'
import { openWorldSemanticResourceCatalogV1 } from '../../src/lib/context-gateway/world-release-client'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import type { AgentRunEventPayloadMapV1, AgentRunEventTypeV1 } from '../../src/lib/types/agent-run'
import type { ProductSourcePlanV2, ProductSourceManifestV2, ProductRuntimePackageV1, WorkspaceScope, ProductBuildArtifactRecordV1 } from '../../src/lib/types'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { seedNarrativeRelationReleaseV4 } from '../helpers/narrative-release-fixture'
import { openAuthorWorldQueryAccessV1, bindWorldQueryResourcesV1 } from '../../src/lib/context-gateway/world-query-client'
import { WORLD_RELEASE_RESOURCE_KINDS_V1 } from '../../src/lib/context-gateway/world-release-provider-contract'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { createProductRuntimeInstanceFromSource } from '../../src/lib/product/runtime-instances'
import { verifyProductRuntimeSessionSourceV1 } from '../../src/lib/product-production/preview-source'
import { createProductBuildPreviewManifestV1 } from '../../src/lib/product-production/preview-manifest'
import { createConfiguredProductProductionExecutorV1 } from '../../src/lib/product-production/production-executor'
import { branchProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { deleteProductRuntimeSession, readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { parseProductRuntimePackageV2, createProductReleaseManifestV2, productReleaseIdentityHashV2 } from '../../src/lib/product-production/runtime-package'
import { seedAvgNativePreview } from '../helpers/avg-native-fixture'
import { avgSystemFixture } from '../helpers/avg-system-fixture'
import { assertProductRuntimeSourceSnapshotV2 } from '../../src/lib/product/runtime-source-manifest'

async function rehashPlan(plan: ProductSourcePlanV2) {
  const { planHash: _hash, ...body } = plan
  const { localReleaseRecordId: _local, ...reference } = body.worldReference
  return { ...body, planHash: await hashCanonicalValue({ ...body, worldReference: reference }) }
}
async function rehashManifest(manifest: ProductSourceManifestV2) {
  const { manifestHash: _hash, ...body } = manifest
  return { ...body, manifestHash: await hashCanonicalValue(body) }
}

/** Deterministic test execution, with real Gateway reads and existing durable
 * preflight/tool/result/Manifest persistence. No model-quality claim. */
async function persistRead(scope: WorkspaceScope, execution: ContextGatewayExecutionV1) {
  let run = await createAgentRunV1({ scope, contract: {
    version: 1, objective: 'NW-2C 来源合同实际读取回归', workflowKind: 'direct-generation', runtimeBindingHash: 'a'.repeat(64),
    scope: { projectId: scope.projectId, worldGroupId: null }, permissions: { contextSourceKeys: ['worldRelease'], writeTargets: [] },
    budget: { maxModelCalls: 1, maxToolCalls: 200, maxInputTokens: 100000, maxOutputTokens: 1000, maxAttemptsPerStep: 1 },
    acceptance: [{ id: 'read', kind: 'output-present', required: true }],
    verificationPlan: [{ id: 'terminal', kind: 'terminal', verifier: 'nw2c-contract-fixture-v1', criterionIds: ['read'] }],
    failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
  } })
  const append = async <T extends AgentRunEventTypeV1>(type: T, payload: AgentRunEventPayloadMapV1[T]) => {
    run = await appendAgentRunEventV1({ scope, runId: run.run.id, type, payload, expectedLastSequence: run.projection.lastSequence })
  }
  await append('step.scheduled', { stepId: 'read' }); await append('step.started', { stepId: 'read', attempt: 1 })
  const v1 = await createContextManifestV1({ version: 1, runId: run.run.id, stepId: 'read', attempt: 1,
    scope: { projectId: scope.projectId, worldGroupId: null }, inputBudget: 100000, totalInputTokens: execution.contextPacket.tokenCount,
    sources: [{ key: 'worldRelease', status: 'included', contentHash: execution.contextPacket.contentHash, tokens: execution.contextPacket.tokenCount }] })
  const baseManifest = await createContextManifestV2FromV1({ manifest: v1, scope })
  const preflight = await recordContextGatewayPreflightEvidenceV1({ scope, runId: run.run.id, stepId: 'read', attempt: 1,
    contextPacket: execution.contextPacket, selector: execution.selector, renderedRequest: { purpose: 'deterministic-contract-regression' },
    sourceSnapshots: execution.sourceSnapshots, toolTranscript: execution.toolTranscript, expectedLastSequence: run.projection.lastSequence })
  run = preflight.snapshot
  await append('tool.called', { stepId: 'read', attempt: 1, toolName: 'nw2c-read-fixture', callHash: preflight.evidence.promptHash })
  const response = { packetHash: execution.contextPacket.packetHash }, candidateHash = await hashCanonicalValue(response)
  await append('tool.returned', { stepId: 'read', attempt: 1, toolName: 'nw2c-read-fixture', resultHash: candidateHash })
  const finalized = await finalizeContextGatewayAttemptEvidenceV1({ scope, runId: run.run.id, stepId: 'read', attempt: 1,
    baseManifest, preflight: preflight.evidence, selector: execution.selector, sufficiency: execution.sufficiency,
    retrievalTrace: execution.retrievalTrace, gatewayVersionHash: execution.contextPacket.gatewayVersionHash,
    policyHash: execution.session.policyHash, rawResponse: response, candidateHash,
    executionBoundary: { kind: 'tool', toolName: 'nw2c-read-fixture' }, expectedLastSequence: run.projection.lastSequence })
  run = finalized.snapshot
  await append('candidate.persisted', { stepId: 'read', attempt: 1, candidateHash, requiresConfirmation: true })
  return { runId: run.run.id, stepId: 'read', attempt: 1, manifestHash: finalized.manifest.manifestHash }
}

async function fixture(productType: 'character-interaction' | 'avg', owned?: Pick<Awaited<ReturnType<typeof seedCurrentProductWorld>>, 'scope' | 'release'>, characterCount?: number) {
  const world = owned ?? await seedCurrentProductWorld('NW-2C 精确来源', { minimumCharacters: 4 })
  const source = await loadProductProductionConsultationSourceV2({ scope: world.scope, worldReleaseId: world.release.id!, productType })
  const suggestions = await suggestProductStartingPoints({ scope: world.scope, worldReleaseId: world.release.id!, productType })
  const selection = { ...source.selectionCatalog,
    characterResourceKeys: source.selectionCatalog.characterResourceKeys.slice(0, characterCount ?? (productType === 'avg' ? 3 : 2)) }
  const brief = await draftProductProductionBriefV3({ scope: world.scope, worldReleaseId: world.release.id!,
    suggestionKey: suggestions.suggestions[0].suggestionKey, productType, qualityProfile: 'prototype', scale: 'scene',
    visualLevel: 'none', audioLevel: 'none', sourceSelection: selection, playerRole: '扮演调查员，与选入人物交谈' })
  const productionKey = `nw2c-${productType}-${crypto.randomUUID()}`
  const created = await executeProductProductionCommand({ scope: world.scope,
    command: { type: 'create-intent', commandId: `${productionKey}.intent`, productionKey,
      productType, worldReleaseId: world.release.id!, userText: '精确来源合同回归' } })
  const saved = await executeProductProductionCommand({ scope: world.scope, productionId: created.productionId,
    command: { type: 'save-brief-revision', commandId: `${productionKey}.brief`, expectedStateRevision: 0, parentRevision: null, brief } })
  const started = await executeProductProductionCommand({ scope: world.scope, productionId: created.productionId,
    command: { type: 'authorize-start', commandId: `${productionKey}.start`, expectedStateRevision: 1, briefRevision: 1,
      briefHash: saved.result.briefHash as string, authorizationNonce: `${productionKey}.author` } })
  const row = (await db.productProductionBriefs.where('productionId').equals(created.productionId).first())!
  expect(row.status, JSON.stringify(started)).toBe('authorized')
  const sourcePlan = await parseProductProductionSourcePlanV1(row)
  if (sourcePlan.version !== 2) throw new Error('两个增强产品必须生成 V2 计划')
  const confirmedBrief = await parseConfirmedProductBriefV1({ row, sourcePlan })
  const plan = await createProductProductionPlanV3({ buildNumber: 1, briefHash: row.briefHash, brief })
  const task = plan.tasks.find(item => item.kind === 'runtime-package')!
  return { ...world, brief, row, sourcePlan, confirmedBrief, task, productionKey, productionId: created.productionId }
}

async function readAll(f: Awaited<ReturnType<typeof fixture>>) {
  const execution = await executeProductProductionWorldGatewayV1({ scope: f.scope, brief: f.brief,
    sourcePlan: f.sourcePlan, task: f.task, requireCompilationResources: true, budgetTokens: 100000 })
  const pointer = await persistRead(f.scope, execution)
  const manifest = await aggregateProductSourceManifestFromExactRuns({ scope: f.scope, sourcePlan: f.sourcePlan, runContextManifests: [pointer] })
  if (manifest.version !== 2) throw new Error('V2 计划必须聚合 V2 清单')
  return { execution, pointer, manifest }
}

async function compileFixturePackage(f: Awaited<ReturnType<typeof fixture>>) {
  const narrative: ProductRuntimePackageV1['narrative'] = { moduleKind: 'main', moduleTitle: '来源合同回归', entryNodeKey: 'scene.start',
    nodes: [{ key: 'scene.start', kind: 'scene', title: '灯塔', summary: '选择是否归港。', conditionJson: '{}', effectsJson: '[]', successorKeys: ['ending.home', 'ending.wait'] },
      { key: 'ending.home', kind: 'ending', title: '归港', summary: '灯塔重新亮起。', conditionJson: '{}', effectsJson: '[]', successorKeys: [] },
      { key: 'ending.wait', kind: 'ending', title: '等待', summary: '留在渡口等待。', conditionJson: '{}', effectsJson: '[]', successorKeys: [] }],
    beats: [{ beatKey: 'beat.start', nodeKey: 'scene.start', kind: 'narration', speakerKey: null, text: '渡口的风停了。', order: 0 },
      { beatKey: 'beat.home', nodeKey: 'ending.home', kind: 'narration', speakerKey: null, text: '灯塔重新亮起。', order: 0 },
      { beatKey: 'beat.wait', nodeKey: 'ending.wait', kind: 'narration', speakerKey: null, text: '留在渡口等待。', order: 0 }],
    choices: [{ choiceKey: 'choice.home', sourceNodeKey: 'scene.start', text: '归港', description: '向港口走去。', unavailableReason: '',
      targetNodeKey: 'ending.home', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 0 },
      { choiceKey: 'choice.wait', sourceNodeKey: 'scene.start', text: '等待', description: '留在渡口。', unavailableReason: '',
        targetNodeKey: 'ending.wait', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 1 }] }
  const production = (await db.productProductions.get(f.productionId))!
  const build = (await db.productBuilds.where('productionId').equals(f.productionId).first())!
  const payloads: Array<[string, ProductBuildArtifactRecordV1['kind'], unknown]> = [
    ['content.narrative', 'narrative', { schema: 'storyforge.product-narrative-artifact', version: 1, ...narrative }],
    ['content.product-module', 'product-module', { schema: 'storyforge.product-module-artifact', version: 1,
      productType: f.brief.intent.productType, interfaceStyle: '清晰阅读', interactionNotes: ['呈现作者选择'],
      presentationPolicy: { pacing: 'balanced', transitionMs: 500, backgroundStrategy: 'key-scenes' } }],
    ['media.requirements', 'asset-manifest', { schema: 'storyforge.product-media-requirements-artifact', version: 2, visual: [], audio: [] }],
  ]
  const inputArtifacts = await Promise.all(payloads.map(async ([artifactKey, kind, payload]): Promise<ProductBuildArtifactRecordV1> => ({
    ...f.scope, buildId: build.id!, artifactKey, kind, requirementKey: null, version: 1, mediaKind: null, status: 'accepted',
    producerRunId: null, producerReceiptHash: null, controlEpoch: build.controlEpoch, inputHash: 'a'.repeat(64),
    contentHash: await hashProductProductionValueV2(payload), payloadJson: JSON.stringify(payload), metadataJson: '{}',
    qualityJson: '{}', rightsJson: '{}', blobObjectId: null, mimeType: null, byteSize: 1,
    parentArtifactHash: null, carriedFrom: null, createdAt: 1, updatedAt: 1,
  })))
  const result = await createConfiguredProductProductionExecutorV1({ production, brief: f.brief, sourcePlan: f.sourcePlan })({
    scope: f.scope, productionId: f.productionId, buildId: build.id!, buildNumber: build.buildNumber, controlEpoch: build.controlEpoch,
    planHash: build.planHash, task: f.task, attempt: 1, idempotencyKey: `nw2c-${f.productionId}`, contextText: '',
    inputArtifacts, capabilityBindings: [], authorResolution: null, signal: new AbortController().signal,
  })
  return result.artifacts.find(item => item.artifactKey === 'runtime.package')!.payload as ProductRuntimePackageV1
}

async function releaseFor(f: Awaited<ReturnType<typeof fixture>>, sourceManifest: ProductSourceManifestV2) {
  const runtimePackage = await compileFixturePackage(f)
  const sourcePlan = await portableProductSourcePlan(f.sourcePlan)
  const sourceContracts = { sourcePlan, confirmedBrief: f.confirmedBrief, sourceManifest }
  const productionProvenance = { productionKey: f.productionKey, buildNumber: 1,
    buildManifestHash: await hashCanonicalValue(runtimePackage), rootTerminalReceiptHash: await hashCanonicalValue({ fixture: 'contract-only' }) }
  const releaseHash = await productReleaseIdentityHashV1({ schema: 'storyforge.product-release', version: 1,
    productType: runtimePackage.productType, sourceWorldRelease: { contentHash: f.release.contentHash }, runtimePackage,
    packageHash: await hashProductProductionValueV2(runtimePackage), productionProvenance, sourceContracts })
  const lineage = await createProductReleaseLineageV1({ productType: runtimePackage.productType, productInstanceKey: f.productionKey,
    releaseUid: productReleaseUidV1({ productType: runtimePackage.productType, productInstanceKey: f.productionKey, releaseVersion: 1, releaseHash }),
    releaseVersion: 1, releaseHash, parentRelease: null, worldReference: sourcePlan.worldReference, ...sourceContracts,
    build: { buildUid: `fixture-${f.productionKey}`, buildHash: productionProvenance.buildManifestHash },
    quality: { passed: true, receiptHashes: [productionProvenance.rootTerminalReceiptHash] },
    compatibility: { status: 'initial', protocolVersion: 1, evidenceHashes: [] } })
  return createProductReleaseManifestV1({ runtimePackage, productionProvenance, sourceContracts, lineage })
}

describe('NW-2C · exact SourcePlan / actual evidence / two product compiler seams', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { db.close(); vi.useRealTimers() })

  it('同一世界通过聊天与 AVG 的正式保存/开始、实际读取及发布合同得到不同来源清单', async () => {
    const chat = await fixture('character-interaction'), avg = await fixture('avg', chat)
    const manifests: ProductSourceManifestV2[] = []
    for (const f of [chat, avg]) {
      expect(f.sourcePlan.exact.requiredResourceKeys).toEqual([...new Set([
        ...f.sourcePlan.exact.authorResourceKeys, ...f.sourcePlan.exact.dependencyResourceKeys])].sort())
      const { manifest } = await readAll(f)
      expect(manifest.resources.map(item => item.resourceKey)).toEqual(f.sourcePlan.exact.requiredResourceKeys)
      expect(manifest.resources.every(item => item.depths.includes('original'))).toBe(true)
      const release = await releaseFor(f, manifest)
      await expect(verifyProductReleaseManifestV1(JSON.stringify(release))).resolves.toEqual(release)
      manifests.push(manifest)
    }
    expect(chat.sourcePlan.compiler.compilerId).not.toBe(avg.sourcePlan.compiler.compilerId)
    expect(chat.sourcePlan.worldReference.referenceHash).toBe(avg.sourcePlan.worldReference.referenceHash)
    expect(manifests[0].resources.length).toBeLessThan(manifests[1].resources.length)
    await expect(validateProductSourcePlanV1(chat.sourcePlan as never)).rejects.toThrow(/V1/)
  }, 30000)

  it('原生 AVG 确定性集成不能由调用方降成较小的 adaptation 读取片段', async () => {
    const f = await fixture('avg')
    const execution = await executeProductProductionWorldGatewayV1({ scope: f.scope, brief: f.brief,
      sourcePlan: f.sourcePlan, task: {...f.task, kind:'avg-assembly-integrate', taskKey:'avg.assembly.integrate',executionMode:'deterministic'},
      requireCompilationResources:false, budgetTokens:100000 })
    const pointer = await persistRead(f.scope, execution)
    const manifest = await aggregateProductSourceManifestFromExactRuns({scope:f.scope,sourcePlan:f.sourcePlan,runContextManifests:[pointer]})
    expect(manifest.resources.map(r => r.resourceKey)).toEqual(f.sourcePlan.exact.requiredResourceKeys)
    expect(manifest.resources.every(r => r.depths.includes('original'))).toBe(true)
  },30000)

  it('真实 run 只读一项时，即使旧版最低数量已满足也拒绝发布；空指针同样拒绝', async () => {
    const f = await fixture('avg'), boundary = await resolveProductSourceReadBoundary(f.sourcePlan)
    const key = boundary.allowedResourceKeys[0]
    const execution = await executeContextGatewayV1({ scope: f.scope, resourceScope: boundary.sourceScope,
      skill: getAgentSkillV1('product-production.integrate.v1'), accessPolicyOverride: f.sourcePlan.gatewayPolicy,
      allowedResourceKeys: [key], mandatoryResourceKeys: [key], mandatoryOriginalResourceKeys: [key],
      additionalReadsEnabled: false, budgetTokens: 100000, query: '' })
    const pointer = await persistRead(f.scope, execution)
    await expect(aggregateProductSourceManifestFromExactRuns({ scope: f.scope, sourcePlan: f.sourcePlan, runContextManifests: [pointer] }))
      .rejects.toThrow(/缺少|必读/)
    await expect(aggregateProductSourceManifestFromExactRuns({ scope: f.scope, sourcePlan: f.sourcePlan, runContextManifests: [] }))
      .rejects.toThrow(/真实/)
  }, 30000)

  it('同数量错 key、漏原文、错 hash、伪造 evidence pointer 即使重算清单 hash 仍被拒绝', async () => {
    const f = await fixture('avg'), { manifest } = await readAll(f)
    for (const mutate of [
      (value: ProductSourceManifestV2) => { value.resources[0].resourceKey = 'wrong.same-count' },
      (value: ProductSourceManifestV2) => { value.resources[0].depths = ['full'] },
      (value: ProductSourceManifestV2) => { value.resources[0].contentHashes = ['f'.repeat(64)] },
      (value: ProductSourceManifestV2) => { value.resources[0].contextManifestHashes = ['f'.repeat(64)] },
    ]) {
      const changed = structuredClone(manifest); mutate(changed)
      await expect(validateProductSourceManifest({ sourcePlan: f.sourcePlan, sourceManifest: await rehashManifest(changed) }))
        .rejects.toThrow(/精确|缺少/)
    }
  }, 30000)

  it('真实分批读取的 union 可以完成必读集合，单批不能用数量替代剩余资源', async () => {
    const f = await fixture('avg'), boundary = await resolveProductSourceReadBoundary(f.sourcePlan)
    const midpoint = Math.ceil(boundary.allowedResourceKeys.length / 2)
    const pointers = []
    for (const keys of [boundary.allowedResourceKeys.slice(0, midpoint), boundary.allowedResourceKeys.slice(midpoint)]) {
      const execution = await executeContextGatewayV1({ scope: f.scope, resourceScope: boundary.sourceScope,
        skill: getAgentSkillV1('product-production.integrate.v1'), accessPolicyOverride: f.sourcePlan.gatewayPolicy,
        allowedResourceKeys: keys, mandatoryResourceKeys: keys, mandatoryOriginalResourceKeys: keys,
        additionalReadsEnabled: false, budgetTokens: 100000, query: '' })
      pointers.push(await persistRead(f.scope, execution))
    }
    await expect(aggregateProductSourceManifestFromExactRuns({ scope: f.scope, sourcePlan: f.sourcePlan, runContextManifests: [pointers[0]] }))
      .rejects.toThrow(/缺少|必读/)
    const manifest = await aggregateProductSourceManifestFromExactRuns({ scope: f.scope, sourcePlan: f.sourcePlan, runContextManifests: pointers })
    expect(manifest.resources.map(item => item.resourceKey)).toEqual(f.sourcePlan.exact.requiredResourceKeys)
    expect(manifest.runContextManifests).toHaveLength(2)
  }, 30000)

  it('起草步骤只读取冻结的起始切片，集成步骤再核验完整依赖闭包', async () => {
    const f = await fixture('avg')
    const execution = await executeProductProductionWorldGatewayV1({ scope: f.scope, sourcePlan: f.sourcePlan,
      brief: f.brief, task: { ...f.task, taskKey: 'content.design', kind: 'product-design' }, budgetTokens: 100000 })
    const keys = f.sourcePlan.exact.slices.find(item => item.key === 'adaptation')!.resourceKeys
    expect(execution.sourceSnapshots.map(item => item.resourceKey).sort()).toEqual(keys)
    expect(keys.length).toBeLessThan(f.sourcePlan.exact.requiredResourceKeys.length)
  }, 30000)

  it('Brief 条件或角色选择改变后不能继续使用旧计划；条件值也不能靠重算 hash 切换', async () => {
    const f = await fixture('avg'), changed = structuredClone(f.brief)
    changed.intent.openingSituation += '改变后的开局'
    await expect(executeProductProductionWorldGatewayV1({ scope: f.scope, sourcePlan: f.sourcePlan,
      brief: changed, task: f.task, budgetTokens: 100000 })).rejects.toThrow(/Brief 条件已改变/)
    await expect(createConfirmedProductBriefV1({ productType: 'avg', productInstanceKey: f.productionKey,
      sourcePlan: f.sourcePlan, briefRevision: 2, briefContentHash: await hashProductProductionValueV2(changed), authorStartRevision: 2 }))
      .rejects.toThrow(/重新冻结/)
    const tampered = structuredClone(f.sourcePlan)
    const conditional = tampered.exact.requirements.find(item => item.condition)!.condition!
    conditional.result = !conditional.result
    await expect(validateProductSourcePlan(await rehashPlan(tampered))).rejects.toThrow(/条件|精确计划/)
    const { pointer } = await readAll(f)
    const replacement = await createProductProductionSourcePlanV1({ scope: f.scope, productionKey: f.productionKey, brief: changed })
    expect(replacement.gatewayPolicyHash).not.toBe(f.sourcePlan.gatewayPolicyHash)
    await expect(aggregateProductSourceManifestFromExactRuns({ scope: f.scope, sourcePlan: replacement, runContextManifests: [pointer] }))
      .rejects.toThrow(/未绑定 SourcePlan/)
  }, 30000)

  it('required 与 prohibited 冲突、闭包漂移和不足预算均显式拒绝', async () => {
    const f = await fixture('avg')
    const catalog = await openWorldSemanticResourceCatalogV1({ localReleaseRecordId: f.release.id!,
      expectedProjectId: f.scope.projectId, expectedWorldId: f.scope.worldId })
    const forbidden = structuredClone(f.sourcePlan)
    const descriptor = catalog.resources.find(item => item.resourceKey === forbidden.exact.authorResourceKeys[0])!
    forbidden.permission.prohibitedSelectors.push({ areas: [descriptor.worldSemantic!.area], resourceKinds: [descriptor.worldSemantic!.resourceKind], contextKinds: [descriptor.kind], query: null })
    await expect(assertExactProductSourceCatalogV2(forbidden, catalog.resources)).rejects.toThrow(/required\/prohibited/)
    const missing = catalog.resources.filter(item => item.resourceKey !== f.sourcePlan.exact.requiredResourceKeys[0])
    await expect(assertExactProductSourceCatalogV2(f.sourcePlan, missing)).rejects.toThrow(/选择|闭包|selection/)
    const small = structuredClone(f.brief); small.productionBudget.maximumInputTokens = 1
    await expect(createProductProductionSourcePlanV1({ scope: f.scope, productionKey: f.productionKey, brief: small }))
      .rejects.toThrow(/预算/)
  }, 30000)

  it('V2 计划通过现有表生命周期往返，locator 重绑不改变闭包/计划身份', async () => {
    const f = await fixture('avg'), backup = await exportProjectJSON(f.scope.projectId)
    const importedProjectId = await importProjectJSON(structuredClone(backup))
    const row = (await db.productProductionBriefs.where('projectId').equals(importedProjectId).first())!
    const rebound = await parseProductProductionSourcePlanV1(row)
    expect(rebound.planHash).toBe(f.sourcePlan.planHash)
    expect(rebound.worldReference.localReleaseRecordId).not.toBe(f.release.id)
    await expect(resolveProductSourceReadBoundary(rebound)).resolves.toMatchObject({ allowedResourceKeys: f.sourcePlan.exact.permittedResourceKeys })
  }, 30000)

  it('损坏的嵌套 V2 或未知计划版本在导出/导入前失败，导入不写半份项目', async () => {
    const f = await fixture('avg'), backup = await exportProjectJSON(f.scope.projectId)
    const before = await db.projects.count()
    const damaged = structuredClone(backup)
    const row = damaged.productProductionBriefs[0]
    const value = JSON.parse(row._sourcePlanPortableJson)
    value.version = 99
    row._sourcePlanPortableJson = JSON.stringify(value)
    await expect(importProjectJSON(damaged)).rejects.toThrow(/SourcePlan/)
    expect(await db.projects.count()).toBe(before)
    const broken = structuredClone(f.sourcePlan)
    broken.exact.resources[0].contentHash = 'f'.repeat(64)
    await db.productProductionBriefs.update(f.row.id!, { sourcePlanJson: JSON.stringify(broken) })
    await expect(exportProjectJSON(f.scope.projectId)).rejects.toThrow(/hash/)
  }, 30000)

  it('v4 多段原文逐段验签后作为证据包持久化，收窄预算不改变同视角内容身份', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_900_000_000_000)
    const f = await seedNarrativeRelationReleaseV4(), release = f.release
    const access = await openAuthorWorldQueryAccessV1({ scope: f.scope, localReleaseRecordId: release.id!,
      view: 'canon', perspective: { kind: 'author' }, knowledgeThrough: null, disclosedThrough: null })
    const provider = await bindWorldQueryResourcesV1(access)
    const catalog = await provider.listMetadata({ scope: access.scope, limit: 100 })
    const selected = catalog.items.find(item => item.sourceRefs.length > 1 && item.availableDepths.includes('original'))!
    expect(selected).toBeDefined()
    const narrowed = await bindWorldQueryResourcesV1(access, { allowedResourceKeys: null,
      allowedKinds: WORLD_RELEASE_RESOURCE_KINDS_V1, maxTokens: 50000 })
    const changed = (await narrowed.listMetadata({ scope: access.scope, limit: 100 })).items.find(item => item.resourceKey === selected.resourceKey)!
    expect(changed.policyHash).not.toBe(selected.policyHash)
    expect(changed.contentHash).toBe(selected.contentHash)
    const allowedResourceKeys = catalog.items.map(item => item.resourceKey)
    const registeredSkill = getAgentSkillV1('product-production.consult.v1')
    // No discretionary model reads are authorized. The host's required
    // deterministic evidence bundle must still be read and fully accounted.
    const skill = { ...registeredSkill, contextGateway: { ...registeredSkill.contextGateway!, maxReadCalls: 0 } }
    const execution = await executeContextGatewayV1({ scope: f.scope, resourceScope: access.scope, worldQueryAccess: access,
      skill, excludedResourceKinds: skill.contextGateway!.allowedResourceKinds.filter(kind => !WORLD_RELEASE_RESOURCE_KINDS_V1.includes(kind)),
      allowedResourceKeys, mandatoryResourceKeys: [selected.resourceKey], mandatoryOriginalResourceKeys: [selected.resourceKey],
      budgetTokens: 50000, query: '', additionalReadsEnabled: false })
    const snapshot = execution.sourceSnapshots.find(item => item.resourceKey === selected.resourceKey)!
    const bundle = JSON.parse(snapshot.content as string)
    expect(bundle).toMatchObject({ schema: 'storyforge.original-evidence-bundle', version: 1 })
    expect(bundle.spans.length).toBe(selected.sourceRefs.length)
    for (const span of bundle.spans) expect(await sha256Text(span.text)).toBe(span.contentHash)
    expect(execution.metrics.deterministicOriginalReadCalls).toBe(selected.sourceRefs.length)
    expect(execution.session.usage.readCalls).toBe(0)
    await expect(persistRead(f.scope, execution)).resolves.toHaveProperty('manifestHash')
  }, 30000)

  it('v4 两产品正式保存与开始后，索引原文通过 Gateway 留痕并进入各自编译与发布合同', async () => {
    const world = await seedNarrativeRelationReleaseV4({ explicitEntityEvidence: true })
    const chat = await fixture('character-interaction', world, 2), avg = await fixture('avg', world, 1)
    const manifests: ProductSourceManifestV2[] = []
    for (const f of [chat, avg]) {
      expect(f.sourcePlan.worldReference.version).toBe(2)
      expect(f.brief.source.selection.version).toBe(2)
      expect(f.sourcePlan.compiler.resolverVersion).toBe('narrative-neutral-closure-v1')
      const { manifest } = await readAll(f)
      manifests.push(manifest)
      expect(manifest.resources.map(item => item.resourceKey)).toEqual(f.sourcePlan.exact.requiredResourceKeys)
      const release = await releaseFor(f, manifest)
      await expect(verifyProductReleaseManifestV1(release)).resolves.toMatchObject({
        sourceContracts: { sourcePlan: { version: 2, worldReference: { version: 2 } } } })
    }
    expect(manifests[0].resources).toHaveLength(3)
    expect(manifests[1].resources).toHaveLength(1)
  }, 30000)

  it('两个增强产品的正式会话与预览继承冻结计划，备份恢复不伪造运行原文读取', async () => {
    const world = await seedNarrativeRelationReleaseV4({ explicitEntityEvidence: true })
    for (const productType of ['character-interaction', 'avg'] as const) {
      const f = await fixture(productType, world, productType === 'avg' ? 1 : 2)
      const { manifest } = await readAll(f)
      const release = await releaseFor(f, manifest)
      // Deterministic release fixture, never a model or author-quality receipt.
      const releaseId = await db.productReleases.add({ ...f.scope, productionKey: f.productionKey, productType,
        worldReleaseId: f.release.id!, version: 1, label: 'NW-2C 运行合同夹具', manifestJson: JSON.stringify(release),
        contentHash: await hashProductProductionValueV2(release), createdAt: Date.now() })
      const session = await createProductRuntimeInstanceFromSource({ scope: f.scope,
        source: { kind: 'release', productReleaseId: releaseId }, title: '冻结来源运行合同' })
      expect(JSON.parse(session.canonSnapshotJson)).toMatchObject({ version: 2, sourceManifest: {
        sourcePlanHash: f.sourcePlan.planHash, inheritedSourceManifestHash: manifest.manifestHash,
        sourceKind: 'release', directWorldReads: [], readMode: 'frozen-product-package' } })
      await expect(verifyProductRuntimeSessionSourceV1({ scope: f.scope, session })).resolves.toMatchObject({
        sourceManifest: { sourcePlanHash: f.sourcePlan.planHash } })

      const build = (await db.productBuilds.where('productionId').equals(f.productionId).first())!
      const buildManifest = { fixture: 'deterministic-runtime-contract', productType }
      const buildManifestHash = await hashProductProductionValueV2(buildManifest)
      const preview = await createProductBuildPreviewManifestV1({ productionKey: f.productionKey, buildNumber: build.buildNumber,
        buildManifestHash, runtimePackage: release.runtimePackage })
      await db.productBuilds.update(build.id!, { status: 'preview-ready', manifestJson: JSON.stringify(buildManifest),
        manifestHash: buildManifestHash, packageHash: preview.packageHash, previewHash: preview.previewHash,
        previewManifestJson: JSON.stringify(preview) })
      const previewSession = await createProductRuntimeInstanceFromSource({ scope: f.scope,
        source: { kind: 'build', productBuildId: build.id!, expectedPreviewHash: preview.previewHash }, title: '预览来源运行合同' })
      expect(JSON.parse(previewSession.canonSnapshotJson).sourceManifest).toMatchObject({
        sourceKind: 'build-preview', sourcePlanHash: f.sourcePlan.planHash, inheritedSourceManifestHash: null, directWorldReads: [] })
      const production = (await db.productProductions.get(f.productionId))!
      expect(() => createConfiguredProductProductionExecutorV1({ production, brief: f.brief })).toThrow(/SourcePlan/)
      expect(() => createConfiguredProductProductionExecutorV1({ production, brief: f.brief, sourcePlan: f.sourcePlan })).not.toThrow()
    }
    const backup = await exportProjectJSON(world.scope.projectId)
    const importedProjectId = await importProjectJSON(structuredClone(backup))
    const sessions = await db.productRuntimeSessions.where('projectId').equals(importedProjectId).toArray()
    expect(sessions).toHaveLength(4)
    for (const session of sessions) {
      await expect(verifyProductRuntimeSessionSourceV1({ scope: session, session })).resolves.toMatchObject({
        sourceManifest: { directWorldReads: [], readMode: 'frozen-product-package' } })
    }
    const before = await db.projects.count()
    const damaged = structuredClone(backup)
    const rows = damaged.productRuntimeSessions as Array<{ canonSnapshotJson: string }>
    const snapshot = JSON.parse(rows[0].canonSnapshotJson)
    snapshot.sourceManifest.directWorldReads = [{ resourceKey: 'invented', depth: 'original' }]
    const { manifestHash: _hash, ...body } = snapshot.sourceManifest
    snapshot.sourceManifest.manifestHash = await hashProductProductionValueV2(body)
    rows[0].canonSnapshotJson = JSON.stringify(snapshot)
    await expect(importProjectJSON(damaged)).rejects.toThrow(/来源计划|实际读取/)
    expect(await db.projects.count()).toBe(before)
    await db.productRuntimeSessions.update(sessions[0].id!, { canonSnapshotJson: rows[0].canonSnapshotJson })
    await expect(branchProductRuntimeSession({ parentSessionId: sessions[0].id!, throughSequence: 0,
      title: '不得把损坏的来源洗成新分支' })).rejects.toThrow(/来源计划|实际读取/)
    expect(await db.productRuntimeSessions.where('projectId').equals(importedProjectId).count()).toBe(4)
    await expect(exportProjectJSON(importedProjectId)).rejects.toThrow(/来源计划|实际读取/)
  }, 30000)

  it('增强世界的原生 AVG 分支同时保留准确世界来源与私域初态，删除父档和备份后不丢任一证明', async () => {
    const world=await seedNarrativeRelationReleaseV4({explicitEntityEvidence:true}),f=await fixture('avg',world,1)
    const {manifest}=await readAll(f),legacy=await releaseFor(f,manifest),native=await seedAvgNativePreview(avgSystemFixture())
    // Deterministic contract fixture: no model, art, or author-quality evidence.
    const runtimePackage=parseProductRuntimePackageV2({...native.preview.runtimePackage,
      definition:{...native.preview.runtimePackage.definition,productKey:f.productionKey},sourceWorld:legacy.runtimePackage.sourceWorld})
    const sourcePlan=await portableProductSourcePlan(f.sourcePlan),sourceContracts={sourcePlan,confirmedBrief:f.confirmedBrief,sourceManifest:manifest}
    const productionProvenance={...legacy.productionProvenance,buildManifestHash:await hashProductProductionValueV2(runtimePackage)}
    const releaseHash=await productReleaseIdentityHashV2({schema:'storyforge.product-release',version:2,productType:'avg',
      sourceWorldRelease:{contentHash:world.release.contentHash},runtimePackage,packageHash:await hashProductProductionValueV2(runtimePackage),
      productionProvenance,sourceContracts})
    const lineage=await createProductReleaseLineageV1({productType:'avg',productInstanceKey:f.productionKey,
      releaseUid:productReleaseUidV1({productType:'avg',productInstanceKey:f.productionKey,releaseVersion:1,releaseHash}),
      releaseVersion:1,releaseHash,parentRelease:null,worldReference:sourcePlan.worldReference,...sourceContracts,
      build:{buildUid:`fixture-${f.productionKey}`,buildHash:productionProvenance.buildManifestHash},
      quality:{passed:true,receiptHashes:[productionProvenance.rootTerminalReceiptHash]},
      compatibility:{status:'initial',protocolVersion:2,evidenceHashes:[]}})
    const release=await createProductReleaseManifestV2({runtimePackage,productionProvenance,sourceContracts,lineage})
    const releaseId=await db.productReleases.add({...f.scope,productionKey:f.productionKey,productType:'avg',
      worldReleaseId:f.release.id!,version:1,label:'增强原生AVG合同夹具',manifestJson:JSON.stringify(release),
      contentHash:await hashProductProductionValueV2(release),createdAt:Date.now()})
    const parent=await createProductRuntimeInstanceFromSource({scope:f.scope,source:{kind:'release',productReleaseId:releaseId},title:'增强原生原档'})
    const parentSource=JSON.parse(parent.canonSnapshotJson)
    expect(parentSource.version).toBe(2)
    const child=await branchProductRuntimeSession({parentSessionId:parent.id!,throughSequence:0,title:'增强原生分支'})
    const childSource=JSON.parse(child.canonSnapshotJson)
    expect(childSource).toMatchObject({schema:'storyforge.product-runtime-source',version:3,source:parentSource,
      avgBranchOrigin:{schema:'storyforge.avg.branch-origin',version:1,runtimeSourceHash:release.packageHash}})
    const verified=await verifyProductRuntimeSessionSourceV1({scope:f.scope,session:child})
    expect(()=>assertProductRuntimeSourceSnapshotV2({canonSnapshot:childSource,manifest:verified.sourceManifest})).toThrow()
    const initial=await readProductRuntimeState(child.id!)
    await deleteProductRuntimeSession(parent.id!)
    expect(await readProductRuntimeState(child.id!)).toEqual(initial)
    const backup=await exportProjectJSON(f.scope.projectId),projectId=await importProjectJSON(structuredClone(backup))
    const restored=(await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s=>s.title==='增强原生分支')!
    expect(restored.parentSessionId).toBeNull();expect(restored.canonSnapshotJson).toBe(child.canonSnapshotJson)
    expect(await readProductRuntimeState(restored.id!)).toEqual(initial)
    const again=await branchProductRuntimeSession({parentSessionId:restored.id!,throughSequence:0,title:'增强原生再次分支'})
    await expect(verifyProductRuntimeSessionSourceV1({scope:again,session:again})).resolves.toMatchObject({sourceManifest:{packageHash:release.packageHash}})
    for(const mode of ['world','private','missing','extra'] as const){
      const damaged=JSON.parse(restored.canonSnapshotJson)
      if(mode==='world')damaged.source.sourceManifest.directWorldReads=[{resourceKey:'invented'}]
      if(mode==='private')damaged.avgBranchOrigin.initialStateHash='f'.repeat(64)
      if(mode==='missing')delete damaged.avgBranchOrigin
      if(mode==='extra')damaged.unregistered='forged'
      await expect(verifyProductRuntimeSessionSourceV1({scope:restored,session:{...restored,canonSnapshotJson:JSON.stringify(damaged)}})).rejects.toThrow()
      const invalid=structuredClone(backup),row=(invalid.productRuntimeSessions as typeof backup.productRuntimeSessions)!.find(s=>s.title==='增强原生分支')!
      row.canonSnapshotJson=JSON.stringify(damaged)
      const projects=await db.projects.count()
      await expect(importProjectJSON(invalid)).rejects.toThrow()
      expect(await db.projects.count()).toBe(projects)
    }
  },30000)

  it('v4 授权制作导入后用重绑 locator 继续实际 Gateway 和正式编译，原 Brief 字节保持冻结', async () => {
    const world = await seedNarrativeRelationReleaseV4({ explicitEntityEvidence: true })
    const originals = [await fixture('character-interaction', world, 2), await fixture('avg', world, 1)]
    const importedProjectId = await importProjectJSON(await exportProjectJSON(world.scope.projectId))
    for (const f of originals) {
      const production = (await db.productProductions.where('projectId').equals(importedProjectId)
        .filter(row => row.productionKey === f.productionKey).first())!
      const row = (await db.productProductionBriefs.where('productionId').equals(production.id!).first())!
      expect(row.briefJson).toBe(f.row.briefJson)
      const plan = await parseProductProductionSourcePlanV1(row)
      if (plan.version !== 2) throw Error('增强计划丢失')
      expect(plan.worldReference.localReleaseRecordId).not.toBe(f.brief.source.worldReleaseId)
      const scope = { projectId: production.projectId, worldId: production.worldId, workId: production.workId }
      const rebound = { ...f, scope, row, sourcePlan: plan, productionId: production.id!,
        release: (await db.worldReleases.get(plan.worldReference.localReleaseRecordId))! }
      const { manifest } = await readAll(rebound)
      expect(manifest.resources.map(item => item.resourceKey)).toEqual(plan.exact.requiredResourceKeys)
      const runtimePackage = await compileFixturePackage(rebound)
      expect(runtimePackage.sourceWorld.contentHash).toBe(world.release.contentHash)
      expect(runtimePackage.sourceWorld.selection).toEqual(f.brief.source.selection)
      const changed = structuredClone(rebound)
      changed.brief.intent.openingSituation = '未经新确认修改的开场'
      await expect(compileFixturePackage(changed)).rejects.toThrow(/绑定不一致/)
    }
  }, 30000)
})


describe('NW-2C v4 durable scheduler and atomic publication', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { db.close(); vi.restoreAllMocks() })

  it.each(['character-interaction', 'avg'] as const)('%s publishes from real task receipts and preserves the frozen world', async productType => {
    const world = await seedNarrativeRelationReleaseV4({ explicitEntityEvidence: true })
    const f = await fixture(productType, world, productType === 'avg' ? 1 : 2)
    const releaseBefore = await db.worldReleases.get(world.release.id!)
    const sourcePlanBefore = f.row.sourcePlanJson
    const requirement = f.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const bindingHash = await hashProductProductionValueV2({ fixture: 'nw-v4-production-protocol', productType })
    const calls: string[] = []
    const runText: ProductionTextRunnerV1 = async request => {
      const { task, output } = narrativeProductionProtocolFixtureV4(request.system, productType === 'avg' ? 'avg' : 'chat')
      calls.push(task)
      return { output: JSON.stringify(output), usage: { inputTokens: 100, outputTokens: 100 }, bindingReceipt: {
        schema: 'storyforge.provider-binding-receipt', version: 1, requirementKey: requirement.requirementKey,
        adapterId: 'configured-text.v1', adapterVersion: 1, provider: 'fixture', model: 'nw-v4-protocol-fixture',
        endpointOrigin: 'https://nw-v4-test.invalid', executionLocation: 'browser-direct', credentialSource: 'existing-ai-config',
        credentialPresent: true, capabilityHash: bindingHash, boundAt: 1, receiptHash: 'd'.repeat(64),
      } }
    }
    const production = (await db.productProductions.get(f.productionId))!
    const projection = await runProductProductionUntilBlockedV1({ scope: f.scope, productionId: f.productionId,
      executor: createConfiguredProductProductionExecutorV1({ production, brief: f.brief, sourcePlan: f.sourcePlan, runText }),
      capabilityBindings: [{ requirementKey: requirement.requirementKey, adapterId: 'configured-text.v1', bindingHash }],
    })
    const build = (await db.productBuilds.get(projection.buildId))!
    expect(projection, JSON.stringify({ projection, failure: build.failureJson })).toMatchObject({ terminal: true, buildStatus: 'release-ready' })
    expect(calls.sort()).toEqual(['content.design', 'content.narrative', 'content.product-module', 'media.requirements'].sort())
    const published = await publishProductProductionV1({ scope: f.scope, productionId: f.productionId })
    const releaseRow = (await db.productReleases.get(published.receipt.productReleaseId))!
    const released = await verifyProductReleaseManifestV1(releaseRow.manifestJson)
    expect(released.sourceContracts!.sourcePlan.planHash).toBe(f.sourcePlan.planHash)
    expect(released.sourceContracts!.sourceManifest.runContextManifests.length).toBeGreaterThan(0)
    expect(released.sourceContracts!.sourceManifest.resources.map(item => item.resourceKey).sort()).toEqual(f.sourcePlan.exact.requiredResourceKeys)
    expect((await db.productBuilds.get(build.id!))!.status).toBe('released')
    const session = await createProductRuntimeInstanceFromSource({ scope: f.scope,
      source: { kind: 'release', productReleaseId: releaseRow.id! }, title: 'NW v4 正式发布来源合同' })
    const runtime = await verifyProductRuntimeSessionSourceV1({ scope: f.scope, session })
    expect(runtime.sourceManifest).toMatchObject({ sourcePlanHash: f.sourcePlan.planHash,
      inheritedSourceManifestHash: released.sourceContracts!.sourceManifest.manifestHash, directWorldReads: [] })
    expect(await db.worldReleases.get(world.release.id!)).toEqual(releaseBefore)
    expect((await db.productProductionBriefs.get(f.row.id!))!.sourcePlanJson).toBe(sourcePlanBefore)
  }, 60000)
})
