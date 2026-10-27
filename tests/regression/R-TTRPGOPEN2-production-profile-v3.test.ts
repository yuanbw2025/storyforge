/** Normal governance/DB/Plan and explicit simulated transport.
 * Original model output and independent human acceptance are separate evidence. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { openProductionFixtureV1 } from '../helpers/open-ttrpg-production'
import { openProductionCompilerFixtureV1 } from '../helpers/open-ttrpg-production-artifacts'
import { createProductProductionPlanV3, parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createConfiguredProductProductionExecutorV1, createBuiltInProductionCapabilityBindingV1, type ProductionTextRunnerV1 } from '../../src/lib/product-production/production-executor'
import { runProductProductionUntilBlockedV1, ProductProductionResultUnknownErrorV1 } from '../../src/lib/product-production/scheduler'
import { readTtrpgOpenProductionTaskBriefContextV3, readTtrpgOpenProductionMediaInputsV3 } from '../../src/lib/product-production/context'
import { estimateTtrpgOpenProductionTextV3, estimateTtrpgOpenProductionWireV3, TTRPG_OPEN_WIRE_OVERHEAD_RESERVE_V3 } from '../../src/lib/ttrpg/open-production-wire-budget'
import { TTRPG_OPEN_PRODUCTION_BINDINGS_V3, TTRPG_OPEN_PRODUCTION_SKILL_IDS_V1 } from '../../src/lib/ttrpg/open-production-bindings'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { prepareProductProductionAdoption } from '../../src/lib/product-production/adoption'
import { publishProductProductionV1 } from '../../src/lib/product-production/service'
import { verifyProductReleaseManifestV1 } from '../../src/lib/product-production/runtime-package'
import type { ProductProductionTaskExecutionInputV1 } from '../../src/lib/product-production/scheduler'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => { vi.restoreAllMocks(); db.close() })

async function fixture() {
  const base = await openProductionFixtureV1()
  const brief = structuredClone(base.brief)
  Object.assign(brief.productionBudget, { maximumModelCalls: 16, maximumInputTokens: 192000,
    maximumOutputTokens: 60000, maximumDurationMs: 3600000, maximumMediaCalls: 0 })
  return { ...base, brief }
}
async function authorize(data: Awaited<ReturnType<typeof fixture>>) {
  const previous = (await db.productProductions.get(data.productionId))!
  expect((await executeProductProductionCommand({ scope: data.scope, productionId: data.productionId,
    command: { type: 'save-brief-revision', commandId: 'profile3.save', expectedStateRevision: previous.stateRevision,
      parentRevision: previous.currentBriefRevision, brief: data.brief } })).ok).toBe(true)
  const current = (await db.productProductions.get(data.productionId))!
  const row = (await db.productProductionBriefs.where('[productionId+revision]').equals([data.productionId, current.currentBriefRevision!]).first())!
  expect((await executeProductProductionCommand({ scope: data.scope, productionId: data.productionId,
    command: { type: 'authorize-start', commandId: 'profile3.start', expectedStateRevision: current.stateRevision,
      briefRevision: row.revision, briefHash: row.briefHash, authorizationNonce: 'explicit-fixture-author' } })).ok).toBe(true)
  const requirementKey = data.brief.capabilityRequirements.find(r => r.mediaClass === 'text')!.requirementKey
  return { requirementKey, row, capabilityBindings: [{ requirementKey, adapterId: 'configured-text.v1', bindingHash: 'a'.repeat(64) }] }
}

it('new closed text-only generation uses its full original ceiling and skips an empty model plan; both old generations retain exact budgets/time', async () => {
  const data = await fixture(), briefHash = await hashProductProductionValueV2(data.brief)
  const args = { brief: data.brief, briefHash, buildNumber: 1 }
  const current = await createProductProductionPlanV3(args)
  const old = await createProductProductionPlanV3({ ...args, ttrpgOpenExecutionProfile: 2 })
  const content = current.tasks.filter(t => t.taskKey !== 'ttrpg.open.media-plan' && t.executionMode === 'model')
  expect(content.map(t => t.budgetReservation.inputTokens)).toEqual([48000, 64000, 80000])
  expect(content.map(t => t.budgetReservation.outputTokens)).toEqual([12000, 24000, 24000])
  expect(content.map(t => t.timeoutMs)).toEqual([600000, 600000, 600000])
  for (const t of content) expect(t.skillId).toBe(TTRPG_OPEN_PRODUCTION_BINDINGS_V3[t.taskKey as keyof typeof TTRPG_OPEN_PRODUCTION_BINDINGS_V3].skillId)
  expect(current.tasks.find(t => t.taskKey === 'ttrpg.open.media-plan')).toMatchObject({ skillId: null,
    executionMode: 'deterministic', budgetReservation: { modelCalls: 0, inputTokens: 0, outputTokens: 0 } })
  expect(old.tasks.filter(t => t.executionMode === 'model').map(t => t.timeoutMs)).toEqual([180000, 180000, 180000, 180000])
  expect(old.tasks.filter(t => t.executionMode === 'model').map(t => t.budgetReservation.inputTokens)).toEqual([48000, 48000, 48000, 48000])
  const v1 = structuredClone(old)
  for (const task of v1.tasks) if (task.taskKey in TTRPG_OPEN_PRODUCTION_SKILL_IDS_V1) task.skillId = TTRPG_OPEN_PRODUCTION_SKILL_IDS_V1[task.taskKey as keyof typeof TTRPG_OPEN_PRODUCTION_SKILL_IDS_V1]
  for (const plan of [current, old, v1]) {
    const frozen = JSON.stringify(plan)
    expect(JSON.stringify(parseProductProductionPlanV3(frozen, data.brief, briefHash))).toBe(frozen)
    for (const key of ['modelCalls', 'inputTokens', 'outputTokens', 'durationMs', 'storageBytes'] as const) {
      const maximum = ({ modelCalls: 'maximumModelCalls', inputTokens: 'maximumInputTokens', outputTokens: 'maximumOutputTokens',
        durationMs: 'maximumDurationMs', storageBytes: 'maximumStorageBytes' } as const)[key]
      expect(plan.tasks.reduce((sum, t) => sum + t.budgetReservation[key], 0)).toBeLessThanOrEqual(data.brief.productionBudget[maximum])
    }
  }
  const mixed = structuredClone(current); mixed.tasks[0] = structuredClone(old.tasks[0])
  expect(() => parseProductProductionPlanV3(mixed, data.brief, briefHash)).toThrow(/专属任务/)
  const forged = structuredClone(current); forged.tasks[1].timeoutMs = 180000
  expect(() => parseProductProductionPlanV3(forged, data.brief, briefHash)).toThrow(/专属任务/)
})

it.each([2, 3] as const)('the new reader only accepts its exact authorized owner/closed profile (actual profile=%s)', async profile => {
  const data = await fixture(), auth = await authorize(data)
  const plan = await createProductProductionPlanV3({ brief: data.brief, briefHash: auth.row.briefHash, buildNumber: 1, ttrpgOpenExecutionProfile: profile })
  const calls = vi.fn(async () => { throw new ProductProductionResultUnknownErrorV1() })
  const stopped = await runProductProductionUntilBlockedV1({ ...data, ...auth, suppliedPlan: plan, executor: calls })
  const input = { projectId: data.scope.projectId, scope: data.scope, productProductionId: data.productionId,
    productBuildId: stopped.buildId, productProductionTaskKey: 'ttrpg.open.source-facts', sourceKeys: ['product-production.ttrpg-open-task-brief'] }
  const before = JSON.stringify(await db.productBuilds.toArray())
  if (profile === 2) await expect(readTtrpgOpenProductionTaskBriefContextV3(input)).rejects.toThrow(/原 V3/)
  else {
    expect(JSON.parse(await readTtrpgOpenProductionTaskBriefContextV3(input))).toMatchObject({ taskKey: 'ttrpg.open.source-facts',
      original: { briefHash: auth.row.briefHash, productionKey: (await db.productProductions.get(data.productionId))!.productionKey } })
    await expect(readTtrpgOpenProductionTaskBriefContextV3({ ...input, scope: { ...data.scope, workId: data.scope.workId! + 1 } })).rejects.toThrow()
    await expect(readTtrpgOpenProductionTaskBriefContextV3({ ...input, productProductionTaskKey: 'ttrpg.open.integration' })).rejects.toThrow(/原 V3/)
    await expect(readTtrpgOpenProductionTaskBriefContextV3({ ...input, projectId: data.scope.projectId + 1 })).rejects.toThrow(/作用域/)
  }
  expect(JSON.stringify(await db.productBuilds.toArray())).toBe(before)
  expect(calls).toHaveBeenCalledTimes(1)
}, 30000)

it.each([false, true])('normal reviewed production uses complete content and projects only adopted media material (nonempty=%s)', async withMedia => {
  const data = await fixture(), { brief, scope, productionId } = data
  const outputs = await openProductionCompilerFixtureV1(true, { brief, productionId, scope })
  const hidden = outputs.ruleSystem.characterTemplates.find(actor => actor.gmProfile)?.gmProfile
  expect(hidden).toBeTruthy()
  hidden!.secret = 'PRIVATE_CARD_SENTINEL_NOT_A_MEDIA_INPUT'
  if (withMedia) {
    brief.media = { ...brief.media, imageCount: 1, visualLevel: 'key-scenes', requiredMediaKinds: ['background'] }
    brief.productionBudget.maximumInputTokens = 240000
    brief.productionBudget.maximumMediaCalls = 1
    const capability = { requirementKey: 'media.visual', mediaClass: 'image' as const, operation: 'generate', adapterFamily: 'configured-media',
      minimumCapabilityVersion: '1', allowedDataClasses: ['world-selection'], maximumRequestCost: null, maximumTotalCost: null,
      rightsPolicyVersion: 'storyforge-rights-v1', required: true }
    brief.capabilityRequirements.push({ ...capability, capabilityHash: await hashProductProductionValueV2(capability) })
    outputs.situationLayer.metadata.mediaManifest = { ...outputs.situationLayer.metadata.mediaManifest as object,
      slots: [{ slotKey: 'slot.harbor', kind: 'scene', targetRef: 'harbor', audience: 'party', productionRequired: true,
        assetKey: null, fallbackText: '港口远景', altText: '港口', promptTemplate: '无人物港口', width: 640, height: 360 }] }
  }
  const auth = await authorize(data), seen: string[] = [], executions = new Map<string, ProductProductionTaskExecutionInputV1>()
  const capabilityBindings = [...auth.capabilityBindings, ...(withMedia ? [await createBuiltInProductionCapabilityBindingV1({ requirementKey: 'media.visual', adapterId: 'storyforge.procedural-svg.v1' })] : [])]
  const worldsBefore = JSON.stringify(await db.worldReleases.toArray())
  const runText: ProductionTextRunnerV1 = async request => {
    const taskKey = request.system.includes('storyforge.ttrpg-open-source-facts') ? 'ttrpg.open.source-facts'
      : request.system.includes('storyforge.ttrpg-open-rule-system') ? 'ttrpg.open.rule-system'
      : request.system.includes('storyforge.ttrpg-open-situation-layer') ? 'ttrpg.open.situation-layer' : 'ttrpg.open.media-plan'
    const execution = executions.get(taskKey)!
    expect(request.system).toContain('【请求格式版本3】')
    expect(estimateTtrpgOpenProductionWireV3(request.system, request.contextText)).toBeLessThanOrEqual(execution.attemptBudgetReservation!.inputTokens)
    expect(request.maximumOutputTokens).toBeLessThanOrEqual(execution.attemptBudgetReservation!.outputTokens)
    const snapshot = await readAgentRunV1(scope, execution.taskRunId!)
    const evidence = snapshot.events.find(event => event.type === 'evidence.artifact.recorded'
      && event.payload.artifactKind === 'rendered-request' && event.payload.attempt === execution.attempt)
    expect(evidence?.type).toBe('evidence.artifact.recorded')
    const frozen = JSON.parse(await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: 'rendered-request',
      contentHash: evidence!.type === 'evidence.artifact.recorded' ? evidence!.payload.contentHash : '' }))
    expect(frozen).toMatchObject({ version: 3, system: request.system, contextText: request.contextText,
      inputEstimationMethod: 'zh-json-full-wire-conservative-v1', overheadReserveTokens: 4096 })
    if (taskKey === 'ttrpg.open.media-plan') {
      expect(request.contextText).not.toContain('PRIVATE_CARD_SENTINEL_NOT_A_MEDIA_INPUT')
      expect(request.contextText).not.toContain('storyforge.ttrpg-open-production-world-reads')
      expect(request.contextText).toContain('storyforge.ttrpg-open-production-media-inputs')
    } else expect(request.contextText).toContain('storyforge.ttrpg-open-production-world-reads')
    seen.push(taskKey)
    const payload = taskKey === 'ttrpg.open.source-facts' ? outputs.sourceFacts : taskKey === 'ttrpg.open.rule-system'
      ? outputs.ruleSystem : taskKey === 'ttrpg.open.situation-layer' ? outputs.situationLayer : {
        schema: 'storyforge.product-media-requirements-artifact', version: 2, audio: [], visual: [{
          artifactKey: 'media.visual.001', mediaKind: 'background', sceneTag: 'slot.harbor', beatKey: 'open.entry.text',
          prompt: '无人物港口', altText: '港口', width: 640, height: 360, palette: ['#123456', '#789abc', '#ffffff'], characterAnchorRefs: [], hardConstraints: [] }] }
    // Simulate a provider consuming the full original task allowance. Human
    // review must still work at zero remaining input/output without a new call.
    return { output: JSON.stringify(payload), usage: {
      inputTokens: execution.task.budgetReservation.inputTokens, outputTokens: request.maximumOutputTokens },
      bindingReceipt: { schema: 'storyforge.provider-binding-receipt', version: 1, requirementKey: auth.requirementKey,
        adapterId: 'configured-text.v1', adapterVersion: 1, provider: 'fixture', model: 'fixture-only', endpointOrigin: 'https://fixture.invalid',
        executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
        capabilityHash: 'a'.repeat(64), boundAt: 1, receiptHash: 'a'.repeat(64) } }
  }
  const run = async () => {
    const execute = createConfiguredProductProductionExecutorV1({ brief, production: (await db.productProductions.get(productionId))!, runText })
    return runProductProductionUntilBlockedV1({ scope, productionId, capabilityBindings,
      executor: request => { executions.set(request.task.taskKey, request); return execute(request) } })
  }
  for (const [key, payload] of [['ttrpg.open.source-facts', outputs.sourceFacts], ['ttrpg.open.rule-system', outputs.ruleSystem]] as const) {
    const blocked = await run(), build = (await db.productBuilds.get(blocked.buildId))!
    expect(JSON.parse(build.failureJson).taskKey, build.failureJson).toBe(key)
    const production = (await db.productProductions.get(productionId))!
    expect((await executeProductProductionCommand({ scope, productionId, command: { type: 'resolve-blocker',
      commandId: 'profile3.author-review.' + key, expectedStateRevision: production.stateRevision, blockerKey: key,
      resolution: { action: 'author-edit', note: '明确逐项复核原来源和数值', authorDraftJson: JSON.stringify(payload) } } })).ok).toBe(true)
  }
  const result = await run(), build = (await db.productBuilds.get(result.buildId))!
  const failureEvidence = (await db.agentRunArtifacts.toArray()).flatMap(row => {
    if (!row.content?.includes('storyforge.product-task-failure')) return []
    try {
      const value = JSON.parse(row.content)
      return value?.schema === 'storyforge.product-task-failure' ? [value] : []
    } catch { return [] }
  })
  expect(result.terminal, build.failureJson + '\n' + JSON.stringify({ seen, failureEvidence,
    ledger: JSON.parse(build.budgetLedgerJson) })).toBe(true)
  expect(seen).toEqual(['ttrpg.open.source-facts', 'ttrpg.open.rule-system', 'ttrpg.open.situation-layer',
    ...(withMedia ? ['ttrpg.open.media-plan'] : [])])
  for (const key of ['ttrpg.open.source-facts', 'ttrpg.open.rule-system']) {
    const review = executions.get(key)!
    expect(review.authorDraftJson).toEqual(expect.any(String))
    const snapshot = await readAgentRunV1(scope, review.taskRunId!)
    expect(snapshot.events.some(event => event.type === 'model.requested')).toBe(false)
    expect(snapshot.events.filter(event => event.type === 'budget.settled').at(-1)?.payload)
      .toMatchObject({ modelCalls: 0, toolCalls: 0, tokens: 0 })
  }
  const prepared = await prepareProductProductionAdoption({ scope, productionId })
  expect(prepared.intent.packageHash).toBe(build.packageHash)
  const published = await publishProductProductionV1({ scope, productionId })
  const release = (await db.productReleases.get(published.receipt.productReleaseId))!
  const manifest = await verifyProductReleaseManifestV1(release.manifestJson, { ttrpgProtocol: 2 })
  expect(manifest.sourceContracts).toHaveProperty('sourceManifest.sourcePlanHash', brief.ttrpgOpen!.sourcePlan.planHash)
  expect(manifest.productionProvenance?.rootTerminalReceiptHash).toBe(build.rootTerminalReceiptHash)
  expect(seen.filter(key => key === 'ttrpg.open.media-plan')).toHaveLength(withMedia ? 1 : 0)
  expect(JSON.stringify(await db.worldReleases.toArray())).toBe(worldsBefore)
  expect((await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()).some(row => row.payloadJson.includes('PRIVATE_CARD_SENTINEL_NOT_A_MEDIA_INPUT'))).toBe(true)
  if (!withMedia) {
    const empty = executions.get('ttrpg.open.media-plan')!
    expect(empty.contextText).toBe('')
    expect(empty.task.budgetReservation.modelCalls).toBe(0)
    const snapshot = await readAgentRunV1(scope, empty.taskRunId!)
    expect(snapshot.events.some(e => e.type === 'model.requested')).toBe(false)
    expect(snapshot.contract.permissions.contextSourceKeys).toEqual([])
    expect(snapshot.contract.permissions.writeTargets).toEqual([])
    expect(snapshot.contract.budget).toMatchObject({ maxModelCalls: 0, maxInputTokens: 0, maxOutputTokens: 0 })
    expect(snapshot.events.some(e => e.type === 'tool.called' || e.type === 'context.assembled')).toBe(false)
    expect(snapshot.events.some(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'source-snapshot')).toBe(true)
    // Unit-fuzz the deterministic boundary with an unauthorized required slot.
    // This is an uncommitted input mutation, not a signed replacement artifact.
    const forbidden = vi.fn<ProductionTextRunnerV1>(async () => { throw Error('no inference allowed') })
    const check = createConfiguredProductProductionExecutorV1({ brief, production: (await db.productProductions.get(productionId))!, runText: forbidden })
    const wrong = { ...empty, inputArtifacts: empty.inputArtifacts.map(row => {
      if (row.artifactKey !== 'ttrpg.open.situation-layer') return row
      const payload = JSON.parse(row.payloadJson)
      payload.metadata.mediaManifest.slots = [{ slotKey: 'unauthorized.required', kind: 'scene', targetRef: 'harbor',
        audience: 'party', productionRequired: true, assetKey: null, fallbackText: '未授权图', altText: '未授权图',
        promptTemplate: '未授权图', width: 640, height: 360 }]
      return { ...row, payloadJson: JSON.stringify(payload) }
    }) }
    await expect(check(wrong)).rejects.toThrow(/零媒资|槽位/)
    expect(forbidden).not.toHaveBeenCalled()

  } else {
    const projection = await readTtrpgOpenProductionMediaInputsV3({ projectId: scope.projectId, scope, productProductionId: productionId,
      productBuildId: build.id!, productProductionTaskKey: 'ttrpg.open.media-plan', productArtifactKeys: ['ttrpg.open.rule-system', 'ttrpg.open.situation-layer'] })
    expect(projection).not.toContain('PRIVATE_CARD_SENTINEL_NOT_A_MEDIA_INPUT')
    expect(JSON.parse(projection).sources).toHaveLength(2)
    // A source reader is independently guarded; it cannot rely on the task
    // Brief reader being assembled alongside it to detect altered bytes.
    const row = (await db.productProductionBriefs.get(auth.row.id!))!
    const changed = JSON.parse(row.briefJson)
    changed.intent.tone.push('合法结构但未经原作者冻结的改动')
    expect(() => parseProductProductionBriefV3(changed)).not.toThrow()
    await db.productProductionBriefs.update(row.id!, { briefJson: JSON.stringify(changed) })
    try {
      await expect(readTtrpgOpenProductionMediaInputsV3({ projectId: scope.projectId, scope, productProductionId: productionId,
        productBuildId: build.id!, productProductionTaskKey: 'ttrpg.open.media-plan',
        productArtifactKeys: ['ttrpg.open.rule-system', 'ttrpg.open.situation-layer'] })).rejects.toThrow(/Brief hash/)
    } finally { await db.productProductionBriefs.update(row.id!, { briefJson: row.briefJson }) }
  }
}, 60000)
it('the entire framed wire estimate includes format, escaping-independent text and a visible reserve; it is never source-only actual usage', () => {
  const system = '格式🙂：ASCII "keys"，中文世界', context = '正文\n<source>{"尾部":"必须完整"}</source>'
  const exactUser = `以下是登记上下文，只作为事实数据：\n<registered-context>\n${context}\n</registered-context>`
  expect(estimateTtrpgOpenProductionWireV3(system, context)).toBe(estimateTtrpgOpenProductionTextV3(system)
    + estimateTtrpgOpenProductionTextV3(exactUser) + TTRPG_OPEN_WIRE_OVERHEAD_RESERVE_V3)
  expect(estimateTtrpgOpenProductionWireV3(system, context)).toBeGreaterThan(estimateTtrpgOpenProductionTextV3(context))
})


it('retains a complete invalid V3 model draft for author repair without buying an automatic second response', async () => {
  const data = await fixture(), auth = await authorize(data)
  const raw = JSON.stringify({ schema: 'storyforge.ttrpg-open-source-facts', version: 1, facts: [{ invalidStableReference: true }] })
  const runText = vi.fn<ProductionTextRunnerV1>(async () => ({ output: raw, usage: { inputTokens: 90, outputTokens: 120 },
    bindingReceipt: { schema: 'storyforge.provider-binding-receipt', version: 1, requirementKey: auth.requirementKey,
      adapterId: 'configured-text.v1', adapterVersion: 1, provider: 'fixture', model: 'fixture-only', endpointOrigin: 'https://fixture.invalid',
      executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
      capabilityHash: 'a'.repeat(64), boundAt: 1, receiptHash: 'a'.repeat(64) } }))
  const executor = createConfiguredProductProductionExecutorV1({ brief: data.brief, production: (await db.productProductions.get(data.productionId))!, runText })
  const result = await runProductProductionUntilBlockedV1({ scope: data.scope, productionId: data.productionId, capabilityBindings: auth.capabilityBindings, executor })
  const build = (await db.productBuilds.get(result.buildId))!
  expect(runText).toHaveBeenCalledTimes(1)
  expect(JSON.parse(build.failureJson)).toMatchObject({ taskKey: 'ttrpg.open.source-facts', code: 'task-draft-rejected', attempt: 1 })
  expect((await db.agentRunArtifacts.toArray()).some(a => a.artifactKind === 'raw-response' && a.content === raw)).toBe(true)
  const events = await db.agentRunEvents.toArray()
  expect(events.some(e => e.type === 'step.failed' && JSON.parse(e.payloadJson).retryable === false)).toBe(true)
  expect(await db.productReleases.count()).toBe(0)
})
