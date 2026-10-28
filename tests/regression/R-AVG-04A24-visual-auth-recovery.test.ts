import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { avgV5RegisteredProposalsFixture, adoptAvgV5Sources } from '../helpers/avg-v5-registered-proposals-fixture'
import { runProductProductionUntilBlockedV1 } from '../../src/lib/product-production/scheduler'
import { readProductProductionDetailsV1 } from '../../src/lib/product-production/service'
import { restartAvgVisualPlanningFromDraftV5, startAvgAssemblyV1 } from '../../src/lib/avg/assembly-service'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { avgVersionedPlanningFixture } from '../helpers/avg-versioned-planning-fixture'
import { avgImageProcessingRecipeFixture } from '../helpers/avg-image-processing-fixture'
import type { AvgImageProcessingPlan, AvgImageProcessingPlanV1 } from '../../src/lib/avg/image-processing-contract'
import { AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4, AVG_FOREGROUND_SAM2_MATTING_ID_V4,
  AVG_FOREGROUND_SAM2_MATTING_METHOD_V4, AVG_FOREGROUND_SAM2_MODEL_REVISION_V4,
  AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V4, AVG_FOREGROUND_SAM2_MATTING_ID_V5,
  AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V5, AVG_FOREGROUND_SAM2_QUALITY_GATE_V5, parseAvgForegroundPolicy } from '../../src/lib/avg/image-foreground-contract'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import * as executionBindings from '../../src/lib/agent/execution-binding'
import { readAvgHeldVisualModelAuthorizationFailureV1 } from '../../src/lib/avg/visual-held-model-auth-failure'

beforeEach(async () => {
  await db.delete(); await db.open()
  vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', '1')
  vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING', '1')
  useAIConfigStore.getState().setConfig({ provider: 'agnes', baseUrl: 'https://v5-proposal.fixture.invalid/v1', apiKey: 'test-only-intercepted-no-external-network', model: 'agnes-2.5-flash', temperature: .7, maxTokens: 0 })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); db.close() })

async function failedDirection(status: 401 | 403 | 404 | 'unknown', providerErrorCode = '', imageProcessing?: AvgImageProcessingPlan) {
  const s = await avgV5RegisteredProposalsFixture({ imageProcessing })
  s.fetcher.mockImplementation(async () => {
    if (status === 'unknown') throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify({ error: { code: providerErrorCode, message: 'controlled authorization rejected (request id: isolated-auth)', type: 'AgnesAI_error' } }), { status, headers: { 'content-type': 'application/json' } })
  })
  await adoptAvgV5Sources(s)
  await runProductProductionUntilBlockedV1(s)
  const details = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
  expect(s.fetcher).toHaveBeenCalledTimes(1)
  expect(details.build!.status).toBe('recovery-required')
  const input = { scope: s.scope, productionId: s.productionId, expectedBuildId: s.buildId,
    expectedBuildRevision: details.build!.stateRevision, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision }
  return { ...s, failed: details.build!, input }
}

describe('AVG V5 recovery after an exactly observed text request rejection', () => {
  it.each([401, 403] as const)('HTTP %s permits a separately authorized successor, preserves unknown billing and never replays the old request', async status => {
    const s = await failedDirection(status), builds = await db.productBuilds.toArray()
    const ledger = JSON.parse(s.failed.budgetLedgerJson)
    const attempts = ledger.attempts.filter((a: { taskKey: string }) => a.taskKey === 'avg.visual.propose.direction')
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({ usageKnown: false, errorCode: 'task-executor-nonretryable' })
    const run = await readAgentRunV1(s.scope, attempts[0].runId)
    const prepared = await restartAvgVisualPlanningFromDraftV5(s.input)
    expect(prepared.production.status).toBe('brief-ready')
    expect(await db.productBuilds.toArray()).toEqual(builds)
    expect(await readAgentRunV1(s.scope, attempts[0].runId)).toEqual(run)
    const child = await startAvgAssemblyV1({ scope: s.scope, productionId: s.productionId, expectedBriefHash: prepared.brief!.briefHash })
    expect(child.build!).toMatchObject({ parentBuildNumber: s.failed.buildNumber, status: 'building' })
    expect(await db.productBuildArtifacts.where('buildId').equals(child.build!.id!).count()).toBe(0)
    expect(await db.productBuilds.get(s.buildId)).toEqual(s.failed)
    expect(s.fetcher).toHaveBeenCalledTimes(1)
    expect(s.imageCalls).toHaveLength(0)
  }, 30_000)

  it('recognizes an exact model_not_found response only in the new reader and keeps the old request, reservation and adoption unchanged', async () => {
    const s = await failedDirection(404, 'model_not_found'), ledger = JSON.parse(s.failed.budgetLedgerJson)
    const attempt = ledger.attempts.find((a: { taskKey: string }) => a.taskKey === 'avg.visual.propose.direction')!
    const old = await readAgentRunV1(s.scope, attempt.runId), before = await db.productBuilds.toArray()
    expect(attempt.usageKnown).toBe(false)
    await expect(readAvgHeldVisualModelAuthorizationFailureV1({ scope: s.scope, buildId: s.buildId,
      expectedBuildRevision: s.failed.stateRevision, expectedBriefHash: s.failed.briefHash, expectedPlanHash: s.failed.planHash,
      controlEpoch: s.failed.controlEpoch, taskKey: attempt.taskKey, runId: attempt.runId, attempt: 1 })).rejects.toThrow()
    const prepared = await restartAvgVisualPlanningFromDraftV5(s.input)
    expect(prepared.production.status).toBe('brief-ready'); expect(await db.productBuilds.toArray()).toEqual(before)
    const child = await startAvgAssemblyV1({ scope: s.scope, productionId: s.productionId, expectedBriefHash: prepared.brief!.briefHash })
    expect(child.build!.parentBuildNumber).toBe(s.failed.buildNumber)
    expect(await db.productBuildArtifacts.where('buildId').equals(child.build!.id!).count()).toBe(0)
    expect(await db.productBuilds.get(s.buildId)).toEqual(s.failed)
    expect(await readAgentRunV1(s.scope, attempt.runId)).toEqual(old)
    expect(s.fetcher).toHaveBeenCalledTimes(1); expect(s.imageCalls).toHaveLength(0)
  }, 30_000)

  it('preserves the explicit image-processing proposal in a separately started successor without copying old adoption or dispatch', async () => {
    const requirementKey = avgVersionedPlanningFixture().versioned.templates[0].parameters.requirementKey
    const plan: AvgImageProcessingPlanV1 = { schema: 'storyforge.avg.image-processing-plan', version: 1,
      entries: [{ requirementKey, recipe: avgImageProcessingRecipeFixture() }] }
    const s = await failedDirection(404, 'model_not_found', plan), oldRows = await db.productBuildArtifacts.where('buildId').equals(s.buildId).toArray()
    const prepared = await restartAvgVisualPlanningFromDraftV5(s.input)
    const brief = parseProductProductionBriefV3(prepared.brief!.briefJson)
    expect(brief.avgVisualPlanning!.imageProcessing).toEqual(plan)
    expect(prepared.production.status).toBe('brief-ready')
    expect(s.fetcher).toHaveBeenCalledTimes(1); expect(s.imageCalls).toHaveLength(0)
    expect(await db.productBuildArtifacts.where('buildId').equals(s.buildId).toArray()).toEqual(oldRows)
    const child = await startAvgAssemblyV1({ scope: s.scope, productionId: s.productionId, expectedBriefHash: prepared.brief!.briefHash })
    expect(parseProductProductionBriefV3(child.brief!.briefJson).avgVisualPlanning!.imageProcessing).toEqual(plan)
    expect(JSON.parse(child.build!.planJson).tasks.filter((t: { kind: string }) => t.kind === 'avg-media-image-process')).toHaveLength(1)
    expect(await db.productBuildArtifacts.where('buildId').equals(child.build!.id!).count()).toBe(0)
    expect(await db.productBuilds.get(s.buildId)).toEqual(s.failed)
    expect(s.fetcher).toHaveBeenCalledTimes(1); expect(s.imageCalls).toHaveLength(0)
  }, 30_000)

  it.each([4,5] as const)('preflights a frozen SAM 2 V%i recipe before authorizing a successor Build', async version => {
    const character = avgVersionedPlanningFixture().versioned.templates.find(template =>
      template.subjectKind === 'character' && template.parameters.consumer.slot === 'actor' && template.parameters.mediaKind === 'character-pose')!
    const recipe = { ...avgImageProcessingRecipeFixture(), width: character.parameters.width, height: character.parameters.height }
    const plan: AvgImageProcessingPlan = { schema: 'storyforge.avg.image-processing-plan', version: 2,
      entries: [{ requirementKey: character.parameters.requirementKey, recipe: { ...recipe, version: 2,
        foreground: parseAvgForegroundPolicy({ schema: 'storyforge.avg.foreground-policy', version, model: 'sam2.1-hiera-tiny', modelRevision: AVG_FOREGROUND_SAM2_MODEL_REVISION_V4,
          checkpointSha256: AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4, mattingMethod: AVG_FOREGROUND_SAM2_MATTING_METHOD_V4,
          declaration: '隔离回归中的本机候选加工要求。', ...(version===4?{method:'local-sam2-box-matting',algorithm:AVG_FOREGROUND_SAM2_MATTING_ID_V4,promptStrategy:AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V4}
            :{method:'local-sam2-box-anchor-matting',algorithm:AVG_FOREGROUND_SAM2_MATTING_ID_V5,promptStrategy:AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V5,qualityGate:AVG_FOREGROUND_SAM2_QUALITY_GATE_V5}) }) } }] }
    const s = await failedDirection(401, '', plan)
    const prepared = await restartAvgVisualPlanningFromDraftV5(s.input)
    const buildsBefore = await db.productBuilds.toArray()
    const productionBefore = await db.productProductions.get(s.productionId)
    const probe = vi.fn(async () => new Response(JSON.stringify({ error: 'worker unavailable' }), {
      status: 503, headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', probe)

    await expect(startAvgAssemblyV1({ scope: s.scope, productionId: s.productionId, expectedBriefHash: prepared.brief!.briefHash }))
      .rejects.toThrow(/SAM 2 服务未就绪/)
    expect(probe).toHaveBeenCalledTimes(1)
    expect(probe.mock.calls[0]![0]).toBe(`http://127.0.0.1:5278/v${version===4?1:2}/capabilities`)
    expect(await db.productBuilds.toArray()).toEqual(buildsBefore)
    expect(await db.productProductions.get(s.productionId)).toEqual(productionBefore)
    expect(s.fetcher).toHaveBeenCalledTimes(1)
    expect(s.imageCalls).toHaveLength(0)
  }, 30_000)

  it('rejects a generic404 instead of inferring model_not_found from the status alone', async () => {
    const s = await failedDirection(404, 'not_found'), before = await db.productBuilds.toArray()
    await expect(restartAvgVisualPlanningFromDraftV5(s.input)).rejects.toThrow(/未知|重发/)
    expect(await db.productBuilds.toArray()).toEqual(before)
    expect(s.fetcher).toHaveBeenCalledTimes(1); expect(s.imageCalls).toHaveLength(0)
  }, 30_000)

  it('keeps an interrupted transport blocked and never treats a new version as permission to retry it', async () => {
    const s = await failedDirection('unknown'), builds = await db.productBuilds.toArray()
    await expect(restartAvgVisualPlanningFromDraftV5(s.input)).rejects.toThrow(/未知|重发/)
    expect(await db.productBuilds.toArray()).toEqual(builds)
    expect(s.fetcher).toHaveBeenCalledTimes(1)
  }, 30_000)

  it('reads a portable failed request using its frozen tool schema after the current registry advances', async () => {
    const s = await failedDirection(401), projectId = await importProjectJSON(await exportProjectJSON(s.scope.projectId))
    const copy = (await db.productBuilds.where('projectId').equals(projectId).filter(b => b.buildNumber === s.failed.buildNumber).first())!
    const scope = { projectId, worldId: copy.worldId!, workId: copy.workId! }, before = await db.productBuilds.toArray()
    const original = executionBindings.createAgentSkillExecutionBindingV1
    const changedRegistry = vi.spyOn(executionBindings, 'createAgentSkillExecutionBindingV1').mockImplementation(skill => ({
      ...original(skill), toolSchemaVersion: 'controlled-later-tool-schema', toolSchemaHash: 'd'.repeat(64),
    }))
    const prepared = await restartAvgVisualPlanningFromDraftV5({ scope, productionId: copy.productionId, expectedBuildId: copy.id!,
      expectedBuildRevision: copy.stateRevision, expectedDraftRevision: (await readAvgDraftV1(scope)).revision })
    expect(prepared.production.status).toBe('brief-ready')
    expect(await db.productBuilds.toArray()).toEqual(before)
    changedRegistry.mockRestore()
    const child = await startAvgAssemblyV1({ scope, productionId: copy.productionId, expectedBriefHash: prepared.brief!.briefHash })
    expect(child.build!.parentBuildNumber).toBe(copy.buildNumber)
    expect(await db.productBuilds.get(s.buildId)).toEqual(s.failed)
    expect(s.fetcher).toHaveBeenCalledTimes(1)
  }, 30_000)

  it('rejects damaged exact failure bytes and a claimed ledger even if the cached message says HTTP 401', async () => {
    const s = await failedDirection(401), ledger = JSON.parse(s.failed.budgetLedgerJson)
    const attempt = ledger.attempts.find((a: { taskKey: string }) => a.taskKey === 'avg.visual.propose.direction')!
    const run = await readAgentRunV1(s.scope, attempt.runId)
    const evidence = run.events.find(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'tool-result')!
    if (evidence.type !== 'evidence.artifact.recorded') throw new Error('Missing actual failure evidence')
    const row = (await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([s.scope.projectId, 'tool-result', evidence.payload.contentHash]).first())!
    await db.agentRunArtifacts.update(row.id!, { content: row.content + 'tampered' })
    await expect(restartAvgVisualPlanningFromDraftV5(s.input)).rejects.toThrow(/未知|重发/)
    await db.agentRunArtifacts.put(row)
    await db.productBuilds.update(s.buildId, { budgetLedgerJson: JSON.stringify({ ...ledger, rootClaim: { runId: run.run.id, claimedAt: Date.now() } }) })
    await expect(restartAvgVisualPlanningFromDraftV5(s.input)).rejects.toThrow()
    await db.productBuilds.put(s.failed)
    expect(s.fetcher).toHaveBeenCalledTimes(1)
    expect(s.imageCalls).toHaveLength(0)
  }, 30_000)
})
