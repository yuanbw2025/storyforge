import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as readiness from '../../src/lib/avg/sound-production-brief'
import { avgSoundPlanningFixtureV1 } from '../helpers/avg-sound-planning-fixture'
import { avgSoundLibraryFixtureV1, avgSoundWireFixtureV1 } from '../helpers/avg-sound-provider-fixture'
import { prepareNativeAvgAssembly } from '../helpers/avg-production-assembly-fixture'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { saveAvgSoundProductionDraftV1 } from '../../src/lib/avg/sound-draft-service'
import { prepareAvgAssemblyBriefV1, startAvgAssemblyV1, runAvgAssemblyV1 } from '../../src/lib/avg/assembly-service'
import { readProductProductionDetailsV1, evaluateProductProductionAuthorizationReadinessV1, inspectProductProductionCapabilityReadinessV1 } from '../../src/lib/product-production/service'
import { parseAvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import { saveAvgAuthorWorkspaceV1 } from '../../src/lib/avg/editor-service'
import { avgSoundProductionBudgetV1 } from '../../src/lib/avg/sound-production-policy'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'

beforeEach(async () => {
  await db.delete(); await db.open()
  useAIConfigStore.getState().setConfig({ provider: 'agnes', baseUrl: 'https://sound-proposal.fixture.invalid/v1', apiKey: 'intercepted-engineering-key-no-external-account',
    model: 'agnes-2.5-flash', temperature: .7, maxTokens: 0 })
  vi.spyOn(readiness, 'avgSoundProductionExecutionReadyV1').mockReturnValue(true)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })

async function preparedDraft(libraryOnly = false) {
  const source = await avgSoundPlanningFixtureV1(), s = await prepareNativeAvgAssembly(source.workspace)
  const { sourceInputHash: _hash, ...planning } = source.scope
  planning.librarySources = [avgSoundLibraryFixtureV1().source]
  if (libraryOnly) planning.templates = planning.templates.filter(t => t.source.kind === 'licensed-library')
  const draft = await readAvgDraftV1(s.scope)
  const saved = await saveAvgSoundProductionDraftV1({ scope: s.scope, expectedDraftRevision: draft.revision, planning })
  const wire = await avgSoundWireFixtureV1(source.compiled.requirements.find(r => r.dispatch.operation === 'generate-music')!)
  vi.stubGlobal('fetch', wire.fetcher)
  return { ...s, source, saved, wire, planning }
}

describe('AVG saved sound requirements to reviewable Brief and explicit S2 start', () => {
  it('refuses the earlier ordinary Brief after sound requirements were saved, rather than starting without those requirements', async () => {
    const s = await preparedDraft()
    await expect(startAvgAssemblyV1({ scope: s.scope, productionId: s.productionId, expectedBriefHash: s.details.brief!.briefHash })).rejects.toThrow(/声音需求尚未包含/)
    expect(await db.productBuilds.count()).toBe(0); expect(s.wire.fetcher).not.toHaveBeenCalled()
  })
  it('freezes the original sound contract through existing preparation/start without a model/audio POST, relay or inferred adoption', async () => {
    const s = await preparedDraft(), details = await prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: s.saved.revision })
    expect(details.brief!.status).toBe('draft'); expect(details.build).toBeNull()
    const brief = JSON.parse(details.brief!.briefJson)
    expect(brief.avgAssembly).toBeUndefined(); expect(brief.avgSoundPlanning.scope).toEqual(parseAvgAuthorWorkspaceV1(s.saved.editorJson).soundProduction!.scope)
    expect(brief.avgSoundPlanning.musicBinding.bindingHash).toBe(s.wire.route.bindingHash)
    expect(brief.productionBudget).toEqual(avgSoundProductionBudgetV1(brief))
    expect(evaluateProductProductionAuthorizationReadinessV1({ brief, readiness: inspectProductProductionCapabilityReadinessV1({ projectId: s.scope.projectId }) }).ready).toBe(true)
    const started = await startAvgAssemblyV1({ scope: s.scope, productionId: s.productionId, expectedBriefHash: details.brief!.briefHash })
    expect(started.build!.status).toBe('building'); expect(started.executionBrief!.avgSoundPlanning).toEqual(brief.avgSoundPlanning)
    const plan = parseProductProductionPlanV3(started.build!.planJson, started.executionBrief!, started.build!.briefHash)
    expect(plan.tasks.some(t => t.kind === 'avg-sound-plan-propose')).toBe(true)
    expect(plan.tasks.some(t => t.kind === 'avg-sound-music-generate')).toBe(true)
    await runAvgAssemblyV1(s)
    expect(s.wire.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
    expect(await db.productBuildArtifacts.where('buildId').equals(started.build!.id!).count()).toBe(0)
  }, 90_000)
  it('prepares a library-only contract with no local metadata probe or music route', async () => {
    const s = await preparedDraft(true)
    const details = await prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: s.saved.revision })
    expect(JSON.parse(details.brief!.briefJson).avgSoundPlanning.musicBinding).toBeNull()
    await startAvgAssemblyV1({ scope: s.scope, productionId: s.productionId, expectedBriefHash: details.brief!.briefHash })
    expect(s.wire.fetcher).not.toHaveBeenCalled()
  }, 90_000)
  it('preserves a saved draft with the factory closed and does not resolve credentials or probe a service', async () => {
    const s = await preparedDraft()
    vi.mocked(readiness.avgSoundProductionExecutionReadyV1).mockReturnValue(false)
    useAIConfigStore.getState().setConfig({ apiKey: '' })
    await expect(prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: s.saved.revision })).rejects.toThrow(/尚未开放/)
    expect((await readAvgDraftV1(s.scope)).editorJson).toBe(s.saved.editorJson)
    expect((await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])).brief!.briefHash).toBe(s.details.brief!.briefHash)
    expect(s.wire.fetcher).not.toHaveBeenCalled(); expect(await db.productBuilds.count()).toBe(0)
  })
  it.each(['facts', 'text-route', 'music-journal'] as const)('rejects changed %s before creating a Build and preserves the prepared Brief', async changed => {
    const s = await preparedDraft(), details = await prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: s.saved.revision })
    if (changed === 'facts') {
      const current = await readAvgDraftV1(s.scope), workspace = parseAvgAuthorWorkspaceV1(current.editorJson)
      workspace.scripts[0].lines[0].text += '作者修改'
      await saveAvgAuthorWorkspaceV1(s.scope, current.revision, workspace)
    } else if (changed === 'text-route') useAIConfigStore.getState().setConfig({ model: 'agnes-2.5-pro' })
    else vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ...s.wire.capability, journalId: '8'.repeat(64) }), { headers: { 'Content-Type': 'application/json' } }))
    await expect(startAvgAssemblyV1({ scope: s.scope, productionId: s.productionId, expectedBriefHash: details.brief!.briefHash })).rejects.toThrow()
    const after = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    expect(after.brief!.briefHash).toBe(details.brief!.briefHash); expect(after.build).toBeNull()
    expect(s.wire.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
  }, 90_000)
  it('retains a real author edit performed during the metadata probe without saving another Brief or creating a Build', async () => {
    const s = await preparedDraft(); let edited = false, savedJson = ''
    vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
      const response = await s.wire.fetcher(url, init)
      if (!edited) {
        edited = true
        const current = await readAvgDraftV1(s.scope), workspace = parseAvgAuthorWorkspaceV1(current.editorJson)
        workspace.scripts[0].lines[0].text += '作者并发修改'
        savedJson = (await saveAvgAuthorWorkspaceV1(s.scope, current.revision, workspace)).editorJson
      }
      return response
    })
    await expect(prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: s.saved.revision })).rejects.toThrow(/作者草稿已变化/)
    expect((await readAvgDraftV1(s.scope)).editorJson).toBe(savedJson)
    expect((await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])).brief!.briefHash).toBe(s.details.brief!.briefHash)
    expect(await db.productBuilds.count()).toBe(0); expect(await db.agentRuns.count()).toBe(0)
  }, 90_000)
})
