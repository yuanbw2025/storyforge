import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createFreshOpenDraftFixtureV1 } from '../helpers/open-ttrpg-fresh-authoring'
import { openProductionCompilerFixtureV1 } from '../helpers/open-ttrpg-production-artifacts'
import { prepareTtrpgBrief } from '../../src/lib/ttrpg/authoring-service'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { createConfiguredProductProductionExecutorV1, createBuiltInProductionCapabilityBindingV1, type ProductionTextRunnerV1 } from '../../src/lib/product-production/production-executor'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { runProductProductionUntilBlockedV1, type ProductProductionTaskExecutionInputV1 } from '../../src/lib/product-production/scheduler'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { estimateTokens } from '../../src/lib/ai/context-budget'
import { estimateTtrpgOpenProductionTextV3, estimateTtrpgOpenProductionWireV3 } from '../../src/lib/ttrpg/open-production-wire-budget'
import { createProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { TTRPG_OPEN_PRODUCTION_SKILL_IDS_V1, type TtrpgOpenProductionTaskKeyV2 } from '../../src/lib/ttrpg/open-production-bindings'
import { resolveProductRuntimeSource } from '../../src/lib/product-production/preview-source'
import { createProductRuntimeInstanceFromSource } from '../../src/lib/product/runtime-instances'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { withOpenAuthoringSeatPlanFixtureV1 } from '../helpers/ttrpg-open-seat-plan'

describe('R-TTRPGOPEN2 governed fresh production journey (isolated model transport)', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it.each([{ withMedia: false, withSeatPlan: false, legacyPrompts: false }, { withMedia: true, withSeatPlan: false, legacyPrompts: false },
    { withMedia: false, withSeatPlan: true, legacyPrompts: false }, { withMedia: false, withSeatPlan: false, legacyPrompts: true },
    { withMedia: false, withSeatPlan: false, legacyPrompts: false, profileVersion: 2 }])(
    'requires human reviews and completes a pinned preview (image=$withMedia, explicit seat plan=$withSeatPlan, old prompt=$legacyPrompts, retained profile=$profileVersion)', async ({ withMedia, withSeatPlan, legacyPrompts, profileVersion }) => {
    const generation = legacyPrompts ? 1 : profileVersion ?? 3
    const { scope, draft } = await createFreshOpenDraftFixtureV1(2, true)
    const productionId = await prepareTtrpgBrief(scope, draft.revision)
    let production = (await db.productProductions.get(productionId))!
    let row = (await db.productProductionBriefs.where('[productionId+revision]')
      .equals([productionId, production.currentBriefRevision!]).first())!
    const brief = parseProductProductionBriefV3(row.briefJson)
    const data = await openProductionCompilerFixtureV1(true, { brief, productionId, scope })
    if (withSeatPlan) brief.ttrpgOpen!.settings = withOpenAuthoringSeatPlanFixtureV1(brief.ttrpgOpen!.settings, data.ruleSystem.characterTemplates)
    const mediaPayload = { schema: 'storyforge.product-media-requirements-artifact', version: 2,
      visual: withMedia ? [{ artifactKey: 'media.visual.001', mediaKind: 'background', sceneTag: 'slot.harbor', beatKey: 'open.entry.text',
        prompt: '无人物的港口远景', altText: '港口', width: 640, height: 360,
        palette: ['#123456', '#789abc', '#ffffff'], characterAnchorRefs: [], hardConstraints: [] }] : [], audio: [] }
    if (withMedia) {
      brief.media = { ...brief.media, visualLevel: 'key-scenes', imageCount: 1, requiredMediaKinds: ['background'] }
      // Explicit author revision admits five exact-context lanes before authorize-start.
      brief.productionBudget.maximumInputTokens = 5 * 48_000
      const basis = { requirementKey: 'media.visual', mediaClass: 'image' as const, operation: 'generate', adapterFamily: 'configured-media',
        minimumCapabilityVersion: '1', allowedDataClasses: ['world-selection'], maximumRequestCost: null, maximumTotalCost: null,
        rightsPolicyVersion: 'storyforge-rights-v1', required: true }
      brief.capabilityRequirements.push({ ...basis, capabilityHash: await hashProductProductionValueV2(basis) })
      data.situationLayer.metadata.mediaManifest.slots = [{ slotKey: 'slot.harbor', kind: 'scene', targetRef: 'harbor', audience: 'party',
        productionRequired: true, assetKey: null, fallbackText: '港口远景', altText: '港口', promptTemplate: '无人物的港口远景', width: 640, height: 360 }]
    }
    if (withMedia || withSeatPlan) {
      const saved = await executeProductProductionCommand({ scope, productionId, command: { type: 'save-brief-revision', commandId: 'journey.explicit.brief',
        expectedStateRevision: production.stateRevision, parentRevision: production.currentBriefRevision, brief } })
      expect(saved.ok).toBe(true)
      production = (await db.productProductions.get(productionId))!
      row = (await db.productProductionBriefs.where('[productionId+revision]').equals([productionId, production.currentBriefRevision!]).first())!
    }
    const started = await executeProductProductionCommand({ scope, productionId, command: { type: 'authorize-start',
      commandId: 'journey.start', expectedStateRevision: production.stateRevision, briefRevision: row.revision,
      briefHash: row.briefHash, authorizationNonce: 'author.journey.confirmed' } })
    expect(started.ok).toBe(true)
    const bindingHash = 'a'.repeat(64), requirementKey = brief.capabilityRequirements.find(requirement => requirement.mediaClass === 'text')!.requirementKey
    const calls: string[] = []
    const executions = new Map<string, ProductProductionTaskExecutionInputV1>()
    const runText: ProductionTextRunnerV1 = async request => {
      let taskKey: string, payload: unknown
      if (request.system.includes('storyforge.ttrpg-open-source-facts')) { taskKey = 'ttrpg.open.source-facts'; payload = data.sourceFacts }
      else if (request.system.includes('storyforge.ttrpg-open-rule-system')) {
        taskKey = 'ttrpg.open.rule-system'; payload = data.ruleSystem
        if (withSeatPlan) {
          expect(request.contextText).toContain('authoringSeatPlan')
          for (const reserved of brief.ttrpgOpen!.settings.authoringSeatPlan!.seats) expect(request.contextText).toContain(reserved.characterKey)
          const wrong = structuredClone(data.ruleSystem), companions = wrong.characterTemplates.filter(actor => actor.controller === 'ai')
          ;[companions[0].seatKey, companions[1].seatKey] = [companions[1].seatKey, companions[0].seatKey]
          payload = wrong
        }
      }
      else if (request.system.includes('storyforge.ttrpg-open-situation-layer')) { taskKey = 'ttrpg.open.situation-layer'; payload = data.situationLayer }
      else if (request.system.includes('storyforge.product-media-requirements-artifact')) {
        taskKey = 'ttrpg.open.media-plan'; payload = mediaPayload
      } else throw new Error('unexpected model task')
      if (taskKey !== 'ttrpg.open.media-plan') {
        expect(request.system.includes(generation === 3 ? '【请求格式版本3】' : '【请求格式版本2】')).toBe(!legacyPrompts)
        const execution = executions.get(taskKey)!
        expect(execution.task.skillId).toBe(`product-production.${taskKey.replace('ttrpg.open.', 'ttrpg-open-')}.${`v${generation}`}`)
        if (!legacyPrompts) {
          const marker = '{"schema":"storyforge.ttrpg-open-production-world-reads"'
          const offset = request.contextText.lastIndexOf(marker)
          expect(offset).toBeGreaterThan(0)
          const worldText = request.contextText.slice(offset), projected = JSON.parse(worldText)
          expect(projected.version).toBe(2); expect(projected.resources.length).toBeGreaterThan(0)
          const snapshot = await readAgentRunV1(scope, execution.taskRunId)
          const refs = snapshot.events.filter(event => event.type === 'evidence.artifact.recorded'
            && event.payload.stepId === taskKey && event.payload.attempt === execution.attempt)
            .map(event => event.payload as { artifactKind: 'rendered-request' | 'context-packet' | 'source-snapshot'; contentHash: string })
          const exact = async (kind: typeof refs[number]['artifactKind']) => {
            const ref = refs.find(item => item.artifactKind === kind)!
            return JSON.parse(await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: kind, contentHash: ref.contentHash }))
          }
          const recorded = await exact('rendered-request'), packet = await exact('context-packet')
          expect(recorded).toMatchObject({ schema: 'storyforge.ttrpg-open-production-task-request', version: generation,
            system: request.system, contextText: request.contextText, worldContentHash: await sha256Text(worldText),
            systemTokens: generation === 3 ? estimateTtrpgOpenProductionTextV3(request.system) : estimateTokens(request.system), maximumOutputTokens: request.maximumOutputTokens,
            requestHash: await hashProductProductionValueV2({ system: request.system, contextText: request.contextText,
              maximumOutputTokens: request.maximumOutputTokens }) })
          expect(packet.contentHash).toBe(await sha256Text(packet.content))
          expect(recorded.retrievalTrace.traceHash).toBe(packet.retrievalTraceHash)
          const decisions = [...recorded.retrievalTrace.mandatory, ...recorded.retrievalTrace.autoSelected, ...recorded.retrievalTrace.agentReads]
          expect(projected.resources.map((resource: { resourceKey: string }) => resource.resourceKey).sort())
            .toEqual(decisions.map((read: { resourceKey: string }) => read.resourceKey).sort())
          expect(recorded.worldContentHash).not.toBe(packet.contentHash)
          expect(generation === 3 ? estimateTtrpgOpenProductionWireV3(request.system, request.contextText)
            : estimateTokens(request.system) + estimateTokens(request.contextText)).toBeLessThanOrEqual(execution.attemptBudgetReservation!.inputTokens)
          expect(request.maximumOutputTokens).toBeLessThanOrEqual(execution.attemptBudgetReservation!.outputTokens)
          const worldSnapshots = await Promise.all(refs.filter(ref => ref.artifactKind === 'source-snapshot').map(async ref =>
            JSON.parse(await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: ref.artifactKind, contentHash: ref.contentHash }))))
          const actual = worldSnapshots.filter(source => source.sourceKey === 'worldRelease')
          expect(projected.resources.map((resource: { resourceKey: string }) => resource.resourceKey).sort())
            .toEqual(actual.map(source => source.resourceKey).sort())
          for (const resource of projected.resources) {
            const original = actual.find(source => source.resourceKey === resource.resourceKey)!
            expect(resource.readContent).toBe(original.content)
            expect(resource.contentHash).toBe(original.sourceRefs[0].contentHash)
            expect(resource.depth).toBe(decisions.find((read: { resourceKey: string }) => read.resourceKey === resource.resourceKey)!.depth)
            if (resource.depth === 'full' || resource.depth === 'original') expect(await sha256Text(resource.readContent)).toBe(resource.contentHash)
          }
        }
      }
      calls.push(taskKey)
      return { output: JSON.stringify(payload), usage: { inputTokens: 100, outputTokens: 200 },
        bindingReceipt: { schema: 'storyforge.provider-binding-receipt', version: 1, requirementKey,
          adapterId: 'configured-text.v1', adapterVersion: 1, provider: 'fixture', model: 'fixture-model',
          endpointOrigin: 'https://fixture.invalid', executionLocation: 'browser-direct', credentialSource: 'existing-ai-config',
          credentialPresent: true, capabilityHash: bindingHash, boundAt: 1, receiptHash: bindingHash } }
    }
    const mediaBindings = withMedia ? [await createBuiltInProductionCapabilityBindingV1({ requirementKey: 'media.visual', adapterId: 'storyforge.procedural-svg.v1' })] : []
    const oldPlan = generation < 3 ? await createProductProductionPlanV3({ brief, briefHash: row.briefHash, buildNumber: 1, ttrpgOpenExecutionProfile: 2,
      controlEpoch: (await db.productProductions.get(productionId))!.controlEpoch }) : null
    if (oldPlan && legacyPrompts) for (const task of oldPlan.tasks) if (Object.prototype.hasOwnProperty.call(TTRPG_OPEN_PRODUCTION_SKILL_IDS_V1, task.taskKey)) {
      task.skillId = TTRPG_OPEN_PRODUCTION_SKILL_IDS_V1[task.taskKey as TtrpgOpenProductionTaskKeyV2]
    }
    let firstRun = true
    const run = async () => {
      const execute = createConfiguredProductProductionExecutorV1({ production: (await db.productProductions.get(productionId))!, brief, runText })
      const suppliedPlan = firstRun && oldPlan ? oldPlan : undefined
      firstRun = false
      const result = await runProductProductionUntilBlockedV1({ scope, productionId, suppliedPlan,
        executor: async request => { executions.set(request.task.taskKey, request); return execute(request) },
        capabilityBindings: [{ requirementKey, adapterId: 'configured-text.v1', bindingHash }, ...mediaBindings] })
      if (legacyPrompts) {
        const saved = (await db.productBuilds.where('productionId').equals(productionId).first())!
        for (const task of JSON.parse(saved.planJson).tasks) if (Object.prototype.hasOwnProperty.call(TTRPG_OPEN_PRODUCTION_SKILL_IDS_V1, task.taskKey)) {
          expect(task.skillId).toBe(TTRPG_OPEN_PRODUCTION_SKILL_IDS_V1[task.taskKey as TtrpgOpenProductionTaskKeyV2])
        }
      }
      return result
    }
    for (const [taskKey, payload] of [['ttrpg.open.source-facts', data.sourceFacts], ['ttrpg.open.rule-system', data.ruleSystem]] as const) {
      const blocked = await run()
      expect(blocked.buildStatus).toBe('recovery-required')
      const build = (await db.productBuilds.where('productionId').equals(productionId).first())!
      expect(JSON.parse(build.failureJson).taskKey, build.failureJson).toBe(taskKey)
      if (withSeatPlan && taskKey === 'ttrpg.open.rule-system') expect(JSON.parse(build.failureJson).detail).toContain('authoringSeatPlan')
      // Invalid model output consumes the original explicitly budgeted repair
      // attempt. A refresh must not grant a third call or hide that cost.
      const expectedCalls = withSeatPlan && taskKey === 'ttrpg.open.rule-system' ? 2 : 1
      expect(calls.filter(key => key === taskKey), build.failureJson).toHaveLength(expectedCalls)
      const repeat = await run()
      expect(repeat.buildStatus).toBe('recovery-required')
      expect(calls.filter(key => key === taskKey)).toHaveLength(expectedCalls)
      production = (await db.productProductions.get(productionId))!
      const reviewed = await executeProductProductionCommand({ scope, productionId, command: { type: 'resolve-blocker',
        commandId: `author.review.${taskKey}`, expectedStateRevision: production.stateRevision, blockerKey: taskKey,
        resolution: { action: 'author-edit', note: '确认逐项事实来源和规则数值', authorDraftJson: JSON.stringify(payload) } } })
      expect(reviewed, JSON.stringify(reviewed)).toMatchObject({ ok: true })
    }
    const complete = await run()
    const diagnostic = (await db.productBuilds.where('productionId').equals(productionId).first())!
    expect(complete.terminal, diagnostic.failureJson).toBe(true)
    expect(calls).toEqual(['ttrpg.open.source-facts', 'ttrpg.open.rule-system', ...(withSeatPlan ? ['ttrpg.open.rule-system'] : []), 'ttrpg.open.situation-layer', ...(withMedia || generation < 3 ? ['ttrpg.open.media-plan'] : [])])
    const build = (await db.productBuilds.where('productionId').equals(productionId).first())!
    expect(build.rootTerminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
    const source = { kind: 'build' as const, productBuildId: build.id!, expectedPreviewHash: build.previewHash }
    const playable = await resolveProductRuntimeSource({ scope, source, ttrpgProtocol: 2 })
    expect(playable.runtimePackage.ttrpg!.campaign.version).toBe(2)
    expect(playable.runtimePackage.ttrpg!.campaign.endings).toEqual([])
    if (withMedia) expect(playable.runtimePackage.presentation!.assets).toHaveLength(1)
    playable.mediaResolver.dispose()
    await expect(resolveProductRuntimeSource({ scope, source })).rejects.toThrow()
    const session = await createProductRuntimeInstanceFromSource({ scope, source, title: '开放制作预览', seed: 'journey.preview' })
    expect((await readProductRuntimeState(session.id!)).ttrpg).toMatchObject({ version: 2, runFormat: 'open', openRun: null })
  }, 60_000)
})
