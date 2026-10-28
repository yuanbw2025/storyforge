import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isDeepStrictEqual } from 'node:util'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as readiness from '../../src/lib/avg/sound-production-brief'
import * as verifier from '../../src/lib/product-production/media-runtime-verifier'
import { runAuthorizedProductProductionV1, readProductProductionDetailsV1, stopProductProductionV1 } from '../../src/lib/product-production/service'
import * as capabilities from '../../src/lib/product-production/capabilities'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { avgSoundReviewStartFixtureV1 } from '../helpers/avg-sound-review-fixture'
import { avgSoundRuntimeStageFixtureV1 } from '../helpers/avg-sound-runtime-fixture'
import { adoptAvgSoundSourcesV1, adoptAvgSoundArtifactV1, acceptedAvgSoundArtifactV1 } from '../helpers/avg-sound-harness-fixture'
import { exportProjectJSON } from '../../src/lib/export/json-export'
import { runProductProductionSchedulerCycleV1 } from '../../src/lib/product-production/scheduler'
import { readAvgAssemblyWorkspaceV1, stageAvgWorkspaceInputV1, confirmAvgWorkspaceInputV1, runAvgAssemblyV1 } from '../../src/lib/avg/assembly-service'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'

const offline = () => useAIConfigStore.getState().setConfig({ provider: 'deepseek', apiKey: '', baseUrl: 'https://unused.fixture.invalid/v1' })
const backupState = async (projectId: number) => ({ ...await exportProjectJSON(projectId), exportedAt: 0 })
beforeEach(async () => {
  await db.delete(); await db.open()
  useAIConfigStore.getState().setConfig({ provider: 'agnes', baseUrl: 'https://sound-proposal.fixture.invalid/v1', apiKey: 'intercepted-engineering-key-no-external-account',
    model: 'agnes-2.5-flash', temperature: .7, maxTokens: 0 })
  vi.spyOn(readiness, 'avgSoundProductionExecutionReadyV1').mockReturnValue(true)
  vi.spyOn(verifier, 'verifyProductMediaRuntimeUrlsV1').mockImplementation(async input => ({ measuredAt: Date.now(), environment: input.environment,
    assets: input.assets.map(a => ({ assetKey: a.assetKey, contentHash: a.contentHash, mimeType: a.mimeType, mediaClass: 'audio', status: 'decoded',
      decodedWidth: null, decodedHeight: null, decodedDurationMs: a.mimeType === 'audio/wav' ? 12000 : 500, decodedHasAlpha: null,
      decodedChannelCount: a.mimeType === 'audio/wav' ? 2 : 1, decodedSampleRateHz: 48000, integratedLufs: -18, truePeakDbtp: -12,
      loopSeamDbfs: -40, policyFailures: [], failureCode: null })) }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })

describe('AVG sound formal service with actual authorization and controlled HTTP/decoder', () => {
  it('waits for actual author inputs without resolving an empty current model configuration or dispatching any request', async () => {
    const s = await avgSoundReviewStartFixtureV1(); offline()
    const result = await runAuthorizedProductProductionV1(s)
    expect(result.buildStatus).toBe('building'); expect(s.calls).toHaveLength(0); expect(s.wire.fetcher).not.toHaveBeenCalled()
    expect(await acceptedAvgSoundArtifactV1(s, 'avg.proposal.sound-plan')).toBeUndefined()
  }, 90_000)
  it('runs the single ready text proposal, waits for its independent adoption offline, then produces original music and library audio without a text Key', async () => {
    const s = await avgSoundReviewStartFixtureV1(); await adoptAvgSoundSourcesV1(s)
    await runAuthorizedProductProductionV1(s)
    expect(s.calls).toHaveLength(1); expect(await acceptedAvgSoundArtifactV1(s, 'avg.proposal.sound-plan')).toBeDefined()
    offline(); await runAuthorizedProductProductionV1(s)
    expect(s.calls).toHaveLength(1); expect(s.wire.fetcher).not.toHaveBeenCalled()
    await adoptAvgSoundArtifactV1(s, 'avg.media.sound-plan', s.author.plan)
    const result = await runAuthorizedProductProductionV1(s)
    expect(result.buildStatus).toBe('building')
    expect(await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.bgm')).toBeDefined()
    expect(await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.sfx')).toBeDefined()
    expect(s.wire.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    await runAuthorizedProductProductionV1(s)
    expect(s.calls).toHaveLength(1)
    expect(s.wire.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  }, 90_000)
  it('rejects a changed current text route before claiming or dispatching the ready proposal', async () => {
    const s = await avgSoundReviewStartFixtureV1(); await adoptAvgSoundSourcesV1(s)
    useAIConfigStore.getState().setConfig({ model: 'agnes-2.5-pro' })
    expect(useAIConfigStore.getState().config.model).toBe('agnes-2.5-pro')
    const before = await backupState(s.scope.projectId)
    await expect(runAuthorizedProductProductionV1(s)).rejects.toThrow()
    expect(isDeepStrictEqual(await backupState(s.scope.projectId), before)).toBe(true)
    expect(s.calls).toHaveLength(0); expect(s.wire.fetcher).not.toHaveBeenCalled()
  }, 90_000)
  it('keeps public execution gated with no credential lookup, dispatch or data change', async () => {
    const s = await avgSoundReviewStartFixtureV1(); await adoptAvgSoundSourcesV1(s); offline()
    vi.mocked(readiness.avgSoundProductionExecutionReadyV1).mockReturnValue(false)
    const before = await backupState(s.scope.projectId)
    await expect(runAuthorizedProductProductionV1(s)).rejects.toThrow(/声音实际生产/)
    expect(isDeepStrictEqual(await backupState(s.scope.projectId), before)).toBe(true)
    expect(s.calls).toHaveLength(0); expect(s.wire.fetcher).not.toHaveBeenCalled()
  }, 90_000)
  it('finishes adopted Stage offline and revalidates a frozen sound Preview without reopening execution, rejecting a missing original request', async () => {
    const s = await avgSoundRuntimeStageFixtureV1(); offline()
    const result = await runAuthorizedProductProductionV1(s)
    expect(result.buildStatus).toBe('preview-ready'); expect(s.calls).toHaveLength(1)
    vi.mocked(readiness.avgSoundProductionExecutionReadyV1).mockReturnValue(false)
    await runAuthorizedProductProductionV1(s)
    const raw = (await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.bgm'))!, payload = JSON.parse(raw.payloadJson)
    const snapshot = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([s.scope.projectId, 'source-snapshot', payload.requestSnapshotHash]).first()
    await db.agentRunArtifacts.delete(snapshot!.id!)
    await expect(runAuthorizedProductProductionV1(s)).rejects.toThrow()
    expect(s.wire.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  }, 90_000)
  it('preserves an unknown original music dispatch and does not resolve text credentials or replay on a repeated public run', async () => {
    const s = await avgSoundReviewStartFixtureV1(); await adoptAvgSoundSourcesV1(s); await runAuthorizedProductProductionV1(s)
    await adoptAvgSoundArtifactV1(s, 'avg.media.sound-plan', s.author.plan); offline()
    let posts = 0
    vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('/audio/music') && init?.method === 'POST') { posts++; throw new TypeError('ENGINEERING unknown connection outcome after dispatch') }
      return s.fetcher(url, init)
    })
    const result = await runAuthorizedProductProductionV1(s)
    expect(result.buildStatus).toBe('recovery-required'); expect(posts).toBe(1)
    const before = await backupState(s.scope.projectId)
    await expect(runAuthorizedProductProductionV1(s)).rejects.toThrow()
    expect(isDeepStrictEqual(await backupState(s.scope.projectId), before)).toBe(true)
    expect(posts).toBe(1); expect(s.calls).toHaveLength(1)
  }, 90_000)
  it('recovers an actually checkpointed original proposal offline without requesting a new route or dispatching again', async () => {
    const s = await avgSoundReviewStartFixtureV1(); await adoptAvgSoundSourcesV1(s)
    await expect(runProductProductionSchedulerCycleV1({ ...s, onDurableBoundary: async (boundary, snapshot) => {
      if (boundary === 'candidate.checkpoint' && snapshot.contract.scope.productProduction?.taskKey === 'avg.sound.propose.plan') {
        throw new Error('ENGINEERING power loss immediately after the genuine candidate checkpoint')
      }
    } })).rejects.toThrow(/ENGINEERING power loss/)
    expect(s.calls).toHaveLength(1); expect(await acceptedAvgSoundArtifactV1(s, 'avg.proposal.sound-plan')).toBeUndefined()
    offline(); await runAuthorizedProductProductionV1(s)
    expect(await acceptedAvgSoundArtifactV1(s, 'avg.proposal.sound-plan')).toBeDefined()
    expect(s.calls).toHaveLength(1); expect(s.wire.fetcher).not.toHaveBeenCalled()
  }, 90_000)
  it('reads sound workbench artifacts and uses its existing staging/confirmation/run services with original owner and usage', async () => {
    const s = await avgSoundReviewStartFixtureV1(), draft = await readAvgDraftV1(s.scope)
    const candidate = await stageAvgWorkspaceInputV1({ scope: s.scope, productionId: s.productionId,
      expectedDraftRevision: draft.revision, artifactKey: 'avg.system.plan', declaration: 'ENGINEERING exact saved author rules, no hearing or commercial acceptance' })
    const pending = await readAvgAssemblyWorkspaceV1(s.scope, s.productionId)
    expect(pending.details!.executionBrief!.avgSoundPlanning).toEqual(s.brief.avgSoundPlanning)
    expect(pending.artifacts.some(r => r.id === candidate.id && r.status === 'pending')).toBe(true)
    vi.mocked(readiness.avgSoundProductionExecutionReadyV1).mockReturnValue(false)
    await expect(confirmAvgWorkspaceInputV1({ scope: s.scope, productionId: s.productionId, artifactKey: candidate.artifactKey,
      candidateVersion: candidate.version, candidateHash: JSON.parse(candidate.metadataJson).candidateHash })).rejects.toThrow(/正式声音工作流/)
    vi.mocked(readiness.avgSoundProductionExecutionReadyV1).mockReturnValue(true)
    await confirmAvgWorkspaceInputV1({ scope: s.scope, productionId: s.productionId, artifactKey: candidate.artifactKey,
      candidateVersion: candidate.version, candidateHash: JSON.parse(candidate.metadataJson).candidateHash })
    for (const script of s.author.workspace.scripts) await adoptAvgSoundArtifactV1(s, `avg.content.scene-script.${script.sceneKey}`, script)
    await runAvgAssemblyV1(s)
    const view = await readAvgAssemblyWorkspaceV1(s.scope, s.productionId)
    expect(view.artifacts.some(r => r.artifactKey === 'avg.proposal.sound-plan' && r.status === 'accepted')).toBe(true)
    expect(view.soundProgress!.tasks.find(t => t.taskKey === 'avg.sound.propose.plan')!.status).toBe('completed')
    expect(view.soundRecordedUsage!.modelCalls).toBe(1)
    offline(); await runAvgAssemblyV1(s); expect(s.calls).toHaveLength(1)
  }, 90_000)
  it('retains a real author stop performed during route resolution and creates no later claim or dispatch', async () => {
    const s = await avgSoundReviewStartFixtureV1(); await adoptAvgSoundSourcesV1(s)
    const resolve = capabilities.resolveConfiguredTextCapabilityV1
    let stopped: Awaited<ReturnType<typeof backupState>> | undefined
    vi.spyOn(capabilities, 'resolveConfiguredTextCapabilityV1').mockImplementation(async (...args) => {
      const route = await resolve(...args), details = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
      await stopProductProductionV1({ scope: s.scope, production: details.production })
      stopped = await backupState(s.scope.projectId)
      return route
    })
    await expect(runAuthorizedProductProductionV1(s)).rejects.toThrow(/解析期间制作来源已变化/)
    expect(stopped).toBeDefined(); expect(isDeepStrictEqual(await backupState(s.scope.projectId), stopped)).toBe(true)
    expect(s.calls).toHaveLength(0); expect(s.wire.fetcher).not.toHaveBeenCalled()
  }, 90_000)
  it('does not execute the earlier unsealed sound Build after the author saves another not-started Brief', async () => {
    const s = await avgSoundReviewStartFixtureV1(); await adoptAvgSoundSourcesV1(s)
    const details = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    const saved = await executeProductProductionCommand({ scope: s.scope, productionId: s.productionId, command: {
      type: 'save-brief-revision', commandId: `sound.service.next.${crypto.randomUUID()}`, expectedStateRevision: details.production.stateRevision,
      parentRevision: details.brief!.revision, brief: s.brief } })
    expect(saved.ok).toBe(true); offline()
    const before = await backupState(s.scope.projectId)
    await expect(runAuthorizedProductProductionV1(s)).rejects.toThrow(/待开始方案已变化/)
    expect(isDeepStrictEqual(await backupState(s.scope.projectId), before)).toBe(true)
    expect(s.calls).toHaveLength(0); expect(s.wire.fetcher).not.toHaveBeenCalled()
  }, 90_000)
})
