import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as executionBinding from '../../src/lib/agent/execution-binding'
import * as readiness from '../../src/lib/avg/visual-planning-brief-v5'
import { avgV5RegisteredProposalsFixture, adoptAvgV5CompiledSources, adoptAvgV5Sources,
  cycleAvgV5Until, adoptAvgV5Artifact } from '../helpers/avg-v5-registered-proposals-fixture'
import { stopProductProductionV1 } from '../../src/lib/product-production/service'
import { restartAvgVisualPlanningFromDraftV5, startAvgAssemblyV1 } from '../../src/lib/avg/assembly-service'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { readAvgVisualReuseOptionsV5, prepareAvgVisualProposalReuseV5 } from '../../src/lib/avg/visual-planning-reuse-workspace-v5'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { resolveAvgVisualPlanningExecutionV5 } from '../../src/lib/avg/visual-planning-workspace'
import { createConfiguredProductProductionExecutorV1 } from '../../src/lib/product-production/production-executor'
import { readAvgHistoricalVisualArtifactsV5 } from '../../src/lib/avg/author-artifacts'
import { readAvgVisualReuseHistoryV5 } from '../../src/lib/avg/visual-planning-reuse-v5'

beforeEach(async () => {
  await db.delete(); await db.open()
  useAIConfigStore.getState().setConfig({provider:'agnes',baseUrl:'https://v5-proposal.fixture.invalid/v1',
    apiKey:'test-only-intercepted-no-external-network',model:'agnes-2.5-flash',temperature:.7,maxTokens:0})
  vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1'); vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','1')
  vi.spyOn(readiness,'avgVisualPlanningExecutionReadyV5').mockReturnValue(true)
  vi.stubGlobal('fetch',vi.fn(() => { throw new Error('No external network is authorized in this fixture') }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); db.close() })

describe('AVG archived zero-call producer and active method boundaries', () => {
  it('keeps frozen history readable after a tool upgrade, rejects new stale-method reuse and still checks exact producer bytes', async () => {
    // Controlled transport, actual Work/Brief/start/Run/author commands. No art or model-quality claim.
    const s = await avgV5RegisteredProposalsFixture()
    await adoptAvgV5CompiledSources(s)
    await stopProductProductionV1({scope:s.scope,production:(await db.productProductions.get(s.productionId))!})
    const parent = (await db.productBuilds.get(s.buildId))!
    const options = await readAvgVisualReuseOptionsV5({scope:s.scope,productionId:s.productionId,
      buildNumber:parent.buildNumber,expectedBuildRevision:parent.stateRevision})
    expect(options.options.length).toBeGreaterThan(0)
    expect(options.options.every(o => o.available)).toBe(true)
    const restarted = await restartAvgVisualPlanningFromDraftV5({scope:s.scope,productionId:s.productionId,
      expectedBuildId:parent.id!,expectedBuildRevision:parent.stateRevision,expectedDraftRevision:(await readAvgDraftV1(s.scope)).revision})
    const ready = await prepareAvgVisualProposalReuseV5({scope:s.scope,productionId:s.productionId,
      expectedBriefHash:restarted.brief!.briefHash,expectedDraftRevision:(await readAvgDraftV1(s.scope)).revision,
      expectedBuildId:parent.id!,expectedBuildRevision:parent.stateRevision,selections:options.options.map(o => o.selection)})
    const brief = parseProductProductionBriefV3(ready.brief!.briefJson)
    expect(brief.productionBudget.maximumModelCalls).toBe(0)
    const started = await startAvgAssemblyV1({scope:s.scope,productionId:s.productionId,expectedBriefHash:ready.brief!.briefHash})
    const build = started.build!, execution = await resolveAvgVisualPlanningExecutionV5(s.scope,brief,build.id!)
    const child = {...s,brief,buildId:build.id!,plan:parseProductProductionPlanV3(build.planJson,brief,build.briefHash),
      capabilityBindings:execution.capabilityBindings,
      executor:createConfiguredProductProductionExecutorV1({production:started.production,brief,runText:s.runText,...execution})}
    const calls = s.calls.length
    await adoptAvgV5Sources(child)
    await cycleAvgV5Until(child,'avg.proposal.visual-bible')
    await adoptAvgV5Artifact(child,'avg.media.visual-bible',s.author.visualBible)
    await stopProductProductionV1({scope:s.scope,production:(await db.productProductions.get(s.productionId))!})
    const stopped = (await db.productBuilds.get(build.id!))!
    const artifact = (await db.productBuildArtifacts.where('buildId').equals(build.id!).filter(a =>
      a.artifactKey==='avg.media.visual-bible' && a.status==='accepted').first())!
    const input = {scope:s.scope,buildId:build.id!,expectedBuildRevision:stopped.stateRevision,
      controlEpoch:child.plan.controlEpoch,expectedBriefHash:stopped.briefHash,expectedPlanHash:stopped.planHash,
      artifacts:[{artifactKey:artifact.artifactKey,version:artifact.version,contentHash:artifact.contentHash}]}
    const before = await readAvgHistoricalVisualArtifactsV5(input)
    const current = executionBinding.createAgentSkillExecutionBindingV1
    vi.spyOn(executionBinding,'createAgentSkillExecutionBindingV1').mockImplementation(skill => ({...current(skill),
      toolSchemaVersion:'agent-read-tools-controlled-next',toolSchemaHash:'e'.repeat(64)}))
    expect(await readAvgHistoricalVisualArtifactsV5(input)).toEqual(before)
    const task = child.plan.tasks.find(t => t.outputArtifactKeys.includes('avg.proposal.visual-bible'))!
    const source = brief.avgVisualPlanning!.proposalReuse!.find(r => r.artifact.artifactKey==='avg.media.visual-bible')!
    await expect(readAvgVisualReuseHistoryV5({scope:s.scope,build:stopped,brief,task,source})).rejects.toThrow(/方法已变化/)
    expect(s.calls).toHaveLength(calls); expect(s.imageCalls).toHaveLength(0)
    const producer = (await db.productBuildArtifacts.where('buildId').equals(build.id!).filter(a =>
      a.artifactKey==='avg.proposal.visual-bible' && a.status==='accepted').first())!
    await db.productBuildArtifacts.update(producer.id!,{qualityJson:JSON.stringify({...JSON.parse(producer.qualityJson),requestSnapshotHash:'0'.repeat(64)})})
    await expect(readAvgHistoricalVisualArtifactsV5(input)).rejects.toThrow()
    expect(s.calls).toHaveLength(calls); expect(s.imageCalls).toHaveLength(0)
  },30000)
})
