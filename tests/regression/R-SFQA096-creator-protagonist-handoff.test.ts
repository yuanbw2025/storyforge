import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { CURRENT_BACKUP_VERSION } from '../../src/lib/export/backup-trust'
import { importProjectJSON } from '../../src/lib/export/json-export'
import { assertTextOpenWorldBuildNewWorkV1 } from '../../src/lib/open-world/source-admission'
import { confirmTextOpenWorldCreatorBriefV1, startTextOpenWorldCreatorBriefSessionV1 } from '../../src/lib/open-world/creator-brief'
import { createTextOpenWorldCreatorSourceLocatorV1 } from '../../src/lib/open-world/creator-brief-persistence'
import { confirmTextOpenWorldCreatorProductionPreflightV1, createTextOpenWorldCreatorProductionPreflightV1 } from '../../src/lib/open-world/creator-production-preflight'
import { readTextOpenWorldCreatorExecutionBriefV1 } from '../../src/lib/open-world/creator-production-start'
import { createTextOpenWorldProductionExecutorV1 } from '../../src/lib/open-world/production-executor'
import { createTextOpenWorldSourceCurationExecutorV1 } from '../../src/lib/open-world/source-curation'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { ProductProductionDraftRejectedErrorV1, runProductProductionSchedulerCycleV1, runProductProductionUntilBlockedV1 } from '../../src/lib/product-production/scheduler'
import type { TextOpenWorldExperienceInputContextV1 } from '../../src/lib/open-world/experience-design'
import { inspectTextOpenWorldCreatorWorldSourceV1 } from '../../src/lib/open-world/creator-source'
import { authorizeTextOpenWorldCreatorProductionStartV1, previewTextOpenWorldCreatorProductionStartV1 } from '../../src/lib/product-production/service'
import type { AIConfig } from '../../src/lib/types'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { loadCurrentProductWorldSourceCatalogV1, seedCurrentProductWorld } from '../helpers/current-product-world'

const AI_CONFIG: AIConfig = {
  provider: 'deepseek', apiKey: 'isolated-096-no-real-key', model: 'deepseek-v4-flash',
  baseUrl: 'https://api.deepseek.com/v1', temperature: 0.7, maxTokens: 0,
}
const originalAIState = useAIConfigStore.getState()
beforeEach(async () => {
  await db.delete(); await db.open()
  useAIConfigStore.setState({ config: structuredClone(AI_CONFIG), rememberApiKey: false, presets: [], taskRoutes: {} })
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new Error('No external transport is authorized') }))
})
afterEach(() => {
  try { expect(fetch).not.toHaveBeenCalled() }
  finally { db.close(); useAIConfigStore.setState(originalAIState); vi.unstubAllGlobals() }
})

async function authorize(protagonistMode: 'source-character' | 'author-defined', choice: 'valid' | 'missing' | 'wrong' | 'non-character' = 'valid') {
  const owner = await seedCurrentProductWorld('096 isolated frozen protagonist')
  const release = owner.release
  const catalog = await loadCurrentProductWorldSourceCatalogV1({ scope: owner.scope, worldReleaseId: release.id!, productType: 'text-open-world' })
  const character = catalog.characters[0]!
  const preview = await inspectTextOpenWorldCreatorWorldSourceV1({ scope: owner.scope, localReleaseRecordId: release.id!, expectedReleaseHash: release.contentHash })
  const started = await startTextOpenWorldCreatorBriefSessionV1({
    selection: { sourceKind: 'world-release', sourceScope: owner.scope, localReleaseRecordId: release.id!, expectedReleaseHash: release.contentHash, preview },
    sessionKey: 'sfqa096.formal.start',
  })
  const directive = protagonistMode === 'source-character'
    ? `仅使用封存角色 ${character.name}（${character.resourceKey}）；必须保留姓名和来源身份。`
    : '由作者设定一个第一次来到潮门的巡灯学徒。'
  const confirmed = await confirmTextOpenWorldCreatorBriefV1({
    session: started, draft: { ...started.draft, protagonistMode, protagonistDirective: directive,
      ...(protagonistMode === 'source-character' && choice !== 'missing'
        ? { protagonistSourceResourceKey: choice === 'valid' ? character.resourceKey :
          choice === 'non-character' ? catalog.locations[0]!.resourceKey : 'world-release:characters:another-source' } : {}) },
    acknowledgements: { sourceIdentityReviewed: true, productBoundaryReviewed: true,
      unresolvedItemsClosed: true, directPublishWorkflowReviewed: true },
  })
  const brief = confirmed.confirmedBrief!
  const preflight = await createTextOpenWorldCreatorProductionPreflightV1({
    brief, projectId: confirmed.scope.projectId, aiConfig: AI_CONFIG, rememberApiKey: false, pricing: { mode: 'catalog' },
  })
  const confirmation = await confirmTextOpenWorldCreatorProductionPreflightV1({
    brief, preflight, projectId: confirmed.scope.projectId, aiConfig: AI_CONFIG, rememberApiKey: false,
    acknowledgement: { credentialPolicyReviewed: true, providerAndModelReviewed: true,
      priceAndBudgetReviewed: true, mediaCostBoundaryReviewed: true },
  })
  const input = {
    scope: confirmed.scope, productionId: confirmed.production.id, briefRevision: brief.revision,
    briefHash: brief.briefHash, expectedStateRevision: confirmed.production.stateRevision,
    sourceLocator: createTextOpenWorldCreatorSourceLocatorV1(confirmed.selection!), preflight, confirmation,
    rightsBasis: 'author-owned' as const, rightsNote: '确认使用自己封存的角色及世界。',
    authorizationNonce: 'sfqa096.formal.authorize', authorizedAt: Date.now(),
  }
  const start = await previewTextOpenWorldCreatorProductionStartV1(input)
  const receipt = await authorizeTextOpenWorldCreatorProductionStartV1({ ...input, expectedPlanHash: start.start.productionPlanHash })
  expect(receipt).toMatchObject({ ok: true, replayed: false })
  const briefRow = (await db.productProductionBriefs.where('[productionId+revision]').equals([input.productionId, input.briefRevision]).first())!
  const build = (await db.productBuilds.where('productionId').equals(input.productionId).first())!
  const frozen = await readTextOpenWorldCreatorExecutionBriefV1({ briefRow, planJson: build.planJson })
  expect(frozen.creatorBrief.draft).toMatchObject({ protagonistMode, protagonistDirective: directive,
    ...(protagonistMode === 'source-character' ? { protagonistSourceResourceKey: character.resourceKey } : {}) })
  expect(frozen.sourcePlan.selection).toMatchObject({ kind: 'world-release', resourceKeys: expect.arrayContaining([character.resourceKey]) })
  expect(frozen.start.startHash).toBe(start.start.startHash)
  const production = (await db.productProductions.get(input.productionId))!
  return { frozen, character, directive, production, scope: input.scope }
}

it('096 transfers the chosen frozen protagonist and author directive into the formally authorized execution brief', async () => {
  const { frozen, character, directive } = await authorize('source-character')
  expect({
    startRefs: frozen.executionBrief.source.startingPoint.protagonistRefs,
    executionRefs: frozen.executionBrief.intent.protagonistRefs,
    directiveAvailableToExecution: JSON.stringify(frozen.executionBrief).includes(directive),
  }).toEqual({
    startRefs: [character.resourceKey], executionRefs: [character.resourceKey], directiveAvailableToExecution: true,
  })
})

it('096 still allows a genuinely author-defined protagonist without a fake source reference', async () => {
  const { frozen } = await authorize('author-defined')
  expect(frozen.executionBrief.intent.protagonistRefs).toEqual([])
  expect(frozen.executionBrief.source.startingPoint.protagonistRefs).toEqual([])
})

it.each(['missing', 'wrong', 'non-character'] as const)('096 cannot authorize source-character with a %s frozen selection', async choice => {
  await expect(authorize('source-character', choice)).rejects.toThrow(/明确选择|不属于当前封存/)
  expect(await db.productBuilds.count()).toBe(0)
  expect(await db.productProductionBriefs.filter(row => row.status === 'authorized').count()).toBe(0)
})

it.each(['same-source', 'replacement', 'missing-evidence'] as const)('096 formal P0→P1→P2 enforces the %s protagonist through the real scheduler', async mode => {
  const f = await authorize('source-character')
  const brief = f.frozen.executionBrief
  const requirementKey = brief.capabilityRequirements.find(row => row.mediaClass === 'text')!.requirementKey
  const identity = {
    requirementKey, adapterId: 'configured-text.v1' as const, adapterVersion: 1 as const,
    provider: 'test', model: 'test-model', endpointOrigin: 'https://example.invalid',
    executionConfigHash: await hashProductProductionValueV2({ schema: 'sfqa096.execution-settings', version: 1 }),
    executionLocation: 'browser-direct' as const, credentialSource: 'existing-ai-config' as const,
    credentialPresent: true as const,
  }
  const capabilityHash = await hashProductProductionValueV2(identity)
  const receiptBody = { schema: 'storyforge.provider-binding-receipt' as const, version: 1 as const,
    ...identity, capabilityHash, boundAt: Date.now() }
  const receipt = { ...receiptBody, receiptHash: await hashProductProductionValueV2(receiptBody) }
  const stopAfterP2 = async () => { throw new ProductProductionDraftRejectedErrorV1('isolated 096 end after P2', {
    modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0, costUsd: 0, durationMs: 0, storageBytes: 0,
  }) }
  let p2Calls = 0
  const executor = createTextOpenWorldProductionExecutorV1({
    production: f.production, brief, textCapabilityReceipt: receipt,
    taskExecutors: {
      'p1.source-curation': createTextOpenWorldSourceCurationExecutorV1({
        async runModel(request) {
          const context = JSON.parse(request.contextText) as {
            units: Array<{ unitKey: string; sourceResourceKey: string | null; content: string }>
          }
          const unit = context.units.find(item => item.sourceResourceKey === f.character.resourceKey) ?? context.units[0]!
          const quote = unit.content.slice(0, Math.min(20, unit.content.length))
          return { output: JSON.stringify({
            schema: 'storyforge.text-open-world-source-curation-draft', version: 1,
            unitKeys: context.units.map(item => item.unitKey),
            claims: [{ claimKind: 'plot', canonicalName: f.character.name, statement: '守灯者沿着潮门线索调查失踪事件。',
              entityKeys: ['story.tide-gate', 'character.lamplighter'], confidence: 90,
              coverageTags: ['story-core', 'protagonist', 'core-conflict', 'character', 'faction', 'place', 'timeline'],
              evidence: [{ unitKey: unit.unitKey, quote, start: 0, end: quote.length }] }], gaps: [],
          }), bindingReceipt: receipt, usage: { inputTokens: 300, outputTokens: 180 } }
        },
      }),
      'p2.gameplay-ruleset': stopAfterP2,
      'p2.presentation-profile': stopAfterP2,
    },
    modelTransport: async request => {
      expect(request.category).toBe('text-open-world.production.experience-design.v1')
      p2Calls++
      const context = JSON.parse(request.contextText) as TextOpenWorldExperienceInputContextV1
      expect(context.brief.intent.coreExperience).toContain(f.directive)
      expect(context.protagonistCandidates).toEqual([expect.objectContaining({
        resourceKey: f.character.resourceKey, label: f.character.name, claimKeys: expect.any(Array),
      })])
      const claimKey = context.protagonistCandidates[0]!.claimKeys[0]!
      expect(claimKey).toBeTruthy()
      return { output: JSON.stringify({
        schema: 'storyforge.text-open-world-experience-draft', version: 2,
        experience: { pitch: '围绕潮门调查与探索。', playerFantasy: '守护港口与住民。',
          narrativePillars: ['严格主线', '区域故事', '有界探索'], regionalVarietyPromise: '不同区域有不同人物需求。',
          growthPromise: '调查与战斗有持续反馈。', toneGuide: ['克制'], sourceClaimKeys: [claimKey] },
        protagonist: { displayName: mode === 'replacement' ? '无来源的新主角' : f.character.name,
          identitySummary: '主角调查潮门失踪并保护港口。', motivations: ['追查失踪'],
          personalStakes: ['保护住民'], sourceClaimKeys: mode === 'same-source' ? [claimKey] : [] },
      }), bindingReceipt: receipt, usage: { inputTokens: 41, outputTokens: 13 } }
    },
  })
  const capabilityBindings = brief.capabilityRequirements.filter(row => row.mediaClass === 'text' || row.mediaClass === 'image')
    .map(row => ({ requirementKey: row.requirementKey, bindingHash: row.mediaClass === 'text' ? capabilityHash : 'b'.repeat(64),
      adapterId: row.mediaClass === 'text' ? 'configured-text.v1' : 'storyforge.procedural-svg.v1' }))
  const projection = await runProductProductionUntilBlockedV1({ scope: f.scope, productionId: f.production.id!, executor, capabilityBindings })
  const build = (await db.productBuilds.get(projection.buildId))!
  expect(p2Calls, build.failureJson).toBeGreaterThan(0)
  const p2 = projection.tasks.find(task => task.taskKey === 'p2.experience-design')!
  const protagonist = await db.productBuildArtifacts.where('buildId').equals(build.id!)
    .filter(row => row.artifactKey === 'text-open-world.protagonist-asset').first()
  if (mode !== 'same-source') {
    expect(p2.status).toBe('blocked')
    expect(build.failureJson).toMatch(mode === 'replacement' ? /来源型主角展示名/ : /绑定所选角色来源单元/)
    expect(protagonist).toBeUndefined()
  } else {
    expect(p2.status, build.failureJson).toBe('completed')
    expect(protagonist).toBeDefined()
    expect(JSON.parse(protagonist!.payloadJson)).toMatchObject({
      origin: 'source-character', displayName: f.character.name, sourceRefs: [f.character.resourceKey],
      sourceClaimKeys: expect.arrayContaining([expect.stringMatching(/^source\.claim\./)]),
    })
  }
}, 30_000)

it('096 retains the former signed source-mode Start but blocks new work until the author picks an exact role', async () => {
  // Real synthetic backup created through confirm/preflight/authorize/export
  // on exact363 8d6416e6a9539583a7d5560575ccd17b7498f60c, with two endings and before the role change.
  const archive = JSON.parse(gunzipSync(readFileSync(
    'tests/fixtures/text-open-world/quality096-pre-role-v17-two-endings-20261111.json.gz',
  )).toString('utf8'))
  const projectId = await importProjectJSON(archive)
  const production = (await db.productProductions.where('projectId').equals(projectId).first())!
  const build = (await db.productBuilds.where('productionId').equals(production.id!).first())!
  const briefRow = (await db.productProductionBriefs.where('[productionId+revision]').equals([production.id!, build.briefRevision]).first())!
  const frozen = await readTextOpenWorldCreatorExecutionBriefV1({ briefRow, planJson: build.planJson })
  expect(frozen.creatorBrief.draft.protagonistMode).toBe('source-character')
  expect(frozen.creatorBrief.draft).not.toHaveProperty('protagonistSourceResourceKey')
  expect(frozen.creatorBrief.briefHash).toBe(archive.productProductionBriefs[0].briefHash)
  expect(frozen.start.startHash).toBe(archive.productProductionBriefs[0].confirmedBriefHash)
  expect(frozen.executionBrief.intent.protagonistRefs).toEqual([])
  const scope = { projectId, worldId: production.worldId, workId: production.workId }
  const before = { production, build, briefRow, artifacts: await db.productBuildArtifacts.count(), runs: await db.agentRuns.count() }
  await expect(assertTextOpenWorldBuildNewWorkV1({ scope, productionId: production.id!, buildId: build.id!,
    operation: '执行新的文字开放世界制作任务' })).rejects.toThrow(/明确.*主角/)
  const executor = vi.fn(async () => { throw new Error('historic owner must not execute a provider task') })
  await expect(runProductProductionSchedulerCycleV1({ scope, productionId: production.id!, executor }))
    .rejects.toThrow(/明确.*主角/)
  expect(executor).not.toHaveBeenCalled()
  expect(await db.productProductions.get(production.id!)).toEqual(before.production)
  expect(await db.productBuilds.get(build.id!)).toEqual(before.build)
  expect(await db.productProductionBriefs.get(briefRow.id!)).toEqual(before.briefRow)
  expect(await db.productBuildArtifacts.count()).toBe(before.artifacts)
  expect(await db.agentRuns.count()).toBe(before.runs)
})

function originalV18Archive() {
  return JSON.parse(gunzipSync(readFileSync('tests/fixtures/text-open-world/quality096-legacy-authorized-source-mode-v1.json.gz')).toString('utf8'))
}

it('096 restores the original v18 archive and preserves its authorized build and frozen Brief', async () => {
  const archive = originalV18Archive()
  expect(archive.version).toBe(18)
  const projectId = await importProjectJSON(archive)
  const production = await db.productProductions.where('projectId').equals(projectId).first()
  expect(production).toBeDefined()
  const build = await db.productBuilds.where('productionId').equals(production!.id!).first()
  const brief = await db.productProductionBriefs.where('[productionId+revision]').equals([production!.id!, build!.briefRevision]).first()
  const frozen = await readTextOpenWorldCreatorExecutionBriefV1({ briefRow: brief!, planJson: build!.planJson })
  expect(frozen.creatorBrief.draft.protagonistMode).toBe('source-character')
  expect(frozen.creatorBrief.draft).not.toHaveProperty('protagonistSourceResourceKey')
  expect(frozen.executionBrief.intent.protagonistRefs).toEqual([])
  expect(build!.status).toBe(archive.productBuilds[0].status)
  expect(brief!.briefHash).toBe(archive.productProductionBriefs[0].briefHash)
})

it('096 refuses an archive newer than the supported version before any writes', async () => {
  const archive = originalV18Archive()
  await expect(importProjectJSON({ ...archive, version: CURRENT_BACKUP_VERSION + 1 })).rejects.toThrow(/备份预检|版本/)
  expect(await db.projects.count()).toBe(0)
  expect(await db.productProductions.count()).toBe(0)
  expect(await db.productBuilds.count()).toBe(0)
  expect(await db.agentRuns.count()).toBe(0)
})
