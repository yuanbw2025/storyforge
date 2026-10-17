import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createFreshOpenDraftFixtureV1 } from '../helpers/open-ttrpg-fresh-authoring'
import { openProductionCompilerFixtureV1 } from '../helpers/open-ttrpg-production-artifacts'
import { prepareTtrpgBrief } from '../../src/lib/ttrpg/authoring-service'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { createConfiguredProductProductionExecutorV1, createBuiltInProductionCapabilityBindingV1, type ProductionTextRunnerV1 } from '../../src/lib/product-production/production-executor'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { runProductProductionUntilBlockedV1 } from '../../src/lib/product-production/scheduler'
import { resolveProductRuntimeSource } from '../../src/lib/product-production/preview-source'
import { createProductRuntimeInstanceFromSource } from '../../src/lib/product/runtime-instances'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'

describe('R-TTRPGOPEN2 governed fresh production journey (isolated model transport)', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it.each([false, true])('requires both human reviews and completes a pinned protocol 2 preview (owned image=%s)', async withMedia => {
    const { scope, draft } = await createFreshOpenDraftFixtureV1(2, true)
    const productionId = await prepareTtrpgBrief(scope, draft.revision)
    let production = (await db.productProductions.get(productionId))!
    let row = (await db.productProductionBriefs.where('[productionId+revision]')
      .equals([productionId, production.currentBriefRevision!]).first())!
    const brief = parseProductProductionBriefV3(row.briefJson)
    const data = await openProductionCompilerFixtureV1(true, { brief, productionId, scope })
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
      const saved = await executeProductProductionCommand({ scope, productionId, command: { type: 'save-brief-revision', commandId: 'journey.media.brief',
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
    const runText: ProductionTextRunnerV1 = async request => {
      let taskKey: string, payload: unknown
      if (request.system.includes('storyforge.ttrpg-open-source-facts')) { taskKey = 'ttrpg.open.source-facts'; payload = data.sourceFacts }
      else if (request.system.includes('storyforge.ttrpg-open-rule-system')) { taskKey = 'ttrpg.open.rule-system'; payload = data.ruleSystem }
      else if (request.system.includes('storyforge.ttrpg-open-situation-layer')) { taskKey = 'ttrpg.open.situation-layer'; payload = data.situationLayer }
      else if (request.system.includes('storyforge.product-media-requirements-artifact')) {
        taskKey = 'ttrpg.open.media-plan'; payload = mediaPayload
      } else throw new Error('unexpected model task')
      calls.push(taskKey)
      return { output: JSON.stringify(payload), usage: { inputTokens: 100, outputTokens: 200 },
        bindingReceipt: { schema: 'storyforge.provider-binding-receipt', version: 1, requirementKey,
          adapterId: 'configured-text.v1', adapterVersion: 1, provider: 'fixture', model: 'fixture-model',
          endpointOrigin: 'https://fixture.invalid', executionLocation: 'browser-direct', credentialSource: 'existing-ai-config',
          credentialPresent: true, capabilityHash: bindingHash, boundAt: 1, receiptHash: bindingHash } }
    }
    const mediaBindings = withMedia ? [await createBuiltInProductionCapabilityBindingV1({ requirementKey: 'media.visual', adapterId: 'storyforge.procedural-svg.v1' })] : []
    const run = async () => runProductProductionUntilBlockedV1({ scope, productionId,
      executor: createConfiguredProductProductionExecutorV1({ production: (await db.productProductions.get(productionId))!, brief, runText }),
      capabilityBindings: [{ requirementKey, adapterId: 'configured-text.v1', bindingHash }, ...mediaBindings] })
    for (const [taskKey, payload] of [['ttrpg.open.source-facts', data.sourceFacts], ['ttrpg.open.rule-system', data.ruleSystem]] as const) {
      const blocked = await run()
      expect(blocked.buildStatus).toBe('recovery-required')
      const build = (await db.productBuilds.where('productionId').equals(productionId).first())!
      expect(JSON.parse(build.failureJson).taskKey, build.failureJson).toBe(taskKey)
      expect(calls.filter(key => key === taskKey)).toHaveLength(1)
      const repeat = await run()
      expect(repeat.buildStatus).toBe('recovery-required')
      expect(calls.filter(key => key === taskKey)).toHaveLength(1)
      production = (await db.productProductions.get(productionId))!
      const reviewed = await executeProductProductionCommand({ scope, productionId, command: { type: 'resolve-blocker',
        commandId: `author.review.${taskKey}`, expectedStateRevision: production.stateRevision, blockerKey: taskKey,
        resolution: { action: 'author-edit', note: '确认逐项事实来源和规则数值', authorDraftJson: JSON.stringify(payload) } } })
      expect(reviewed, JSON.stringify(reviewed)).toMatchObject({ ok: true })
    }
    const complete = await run()
    const diagnostic = (await db.productBuilds.where('productionId').equals(productionId).first())!
    expect(complete.terminal, diagnostic.failureJson).toBe(true)
    expect(calls).toEqual(['ttrpg.open.source-facts', 'ttrpg.open.rule-system', 'ttrpg.open.situation-layer', 'ttrpg.open.media-plan'])
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
