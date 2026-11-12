import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { act, createElement, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import CommunityPrototypeGallery from '../../src/components/community/CommunityPrototypeGallery'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { createWorkspaceForProductDistributionV1, createWorkspaceForAdventureWebPackageV1 } from '../../src/lib/product-platform/workspace-install'
import { createWorldWork, listWorldWorks, switchActiveWork } from '../../src/lib/workspace/works'
import { createChatDraftV3, readChatDraftV1 } from '../../src/lib/character-interaction/draft-service'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { runProductProductionUntilBlockedV1 } from '../../src/lib/product-production/scheduler'
import { PRODUCTION_PRODUCT_KINDS_V1 } from '../../src/lib/types/product-identity'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { seedAiTownRuntimeFixture } from '../helpers/ai-town-runtime'
import { createFixtureProductReleaseManifestV1 } from '../helpers/product-release-v1'
import { createTextAdventureCommunityPackageFixtureV1 } from '../helpers/text-adventure-community-package'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { parseCommunityTtrpgCatalogV1, startCommunityTtrpgGameV1 } from '../../src/lib/ttrpg/community-games'
import { installAdventureWebPackageV1 } from '../../src/lib/adventure/web-player-install'
import { createTextAdventureInstance } from '../../src/lib/product/runtime-instances'
import { readProductRuntimeState } from '../../src/lib/adventure/runtime-api'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { captureProductProductionOriginalResponseV1 } from '../../src/lib/product-production/local-request'
import { inspectProductProductionLocalNoDispatchV1 } from '../../src/lib/product-production/local-no-dispatch-booking'
import { openContentRevisionFixtureV1 } from '../helpers/open-ttrpg-content-revision'
import type { ProductDistributionBundleV2 } from '../../src/lib/product-platform/distribution-bundle'
import * as distributionBundle from '../../src/lib/product-platform/distribution-bundle'
import { consultAvgV1 } from '../../src/lib/avg/consultation'
import { consultAiTownV1 } from '../../src/lib/ai-town/consultation'
import { generateChatConsultationV2, adoptChatConsultationV2, readChatConsultationV2, recoverChatConsultationV2 } from '../../src/lib/character-interaction/consultation-harness'
import { seedChatConsultationFixtureV2 } from '../helpers/chat-consultation'
import { useNodeFlowStore } from '../../src/stores/node-flow'
import { emptyAuthoringGraph, type AuthoringNodeGraph } from '../../src/lib/node-authoring/contracts'
import { AUTHORING_NODE_BY_ID, defaultConfigForTemplate } from '../../src/lib/node-authoring/catalog'
import { runAuthoringGraph, adoptAuthoringCandidate, reviseAuthoringCandidate, recoverInterruptedAuthoringRun } from '../../src/lib/node-authoring/executor'
import { createQualityNodeFieldFlow, qualityNodeFieldRaw } from '../helpers/quality002-node-field'
import { generateTtrpgCampaignProposalCandidateV2 } from '../../src/lib/ttrpg/campaign-proposal-harness'
import { generateTtrpgOpenAuthoringDesignCandidateV1 } from '../../src/lib/ttrpg/open-authoring-design-harness'
import { authorizeSFQA050ProductionV1, SFQA050_CONFIG_A, sfqa050ResponseV1 } from '../helpers/sfqa050-provider-dispatch-binding'
import { SFQA004_UPPER_ENTRIES, SFQA004_UPPER_WORK_KINDS, sfqa004ChannelV1, sfqa004WorkspaceInputV1, sfqa004OriginalResponseFixtureV1, sfqa004HistoricalDraftV1 } from '../helpers/sfqa004-product-entry-admission'

import { prepareChatPlanWriteV2, commitChatPlanWriteV2 } from '../../src/lib/character-interaction/consultation-store'
import { prepareChatRoleProfileWriteV1, commitChatRoleProfileWriteV1, removeChatRoleProfileV1 } from '../../src/lib/character-interaction/role-profile-store'
import { prepareChatSourceUnitWriteV1, commitChatSourceUnitWriteV1, removeChatSourceUnitBundleV1 } from '../../src/lib/character-interaction/source-unit-store'
import { seedChatRoleProfileFixture } from '../helpers/chat-role-profile'
import { seedChatSourceUnitConfirmationFixture, sourceUnitAuthorizationReportFixture } from '../helpers/chat-source-unit-confirmation'
import { CommercialHttpClientV1 } from '../../src/lib/commercial/http-client'
import { inspectTextOpenWorldCreatorWorldSourceV1 } from '../../src/lib/open-world/creator-source'
import { startTextOpenWorldCreatorBriefSessionV1, saveTextOpenWorldCreatorBriefDraftV1, generateTextOpenWorldCreatorBriefCandidateV1, confirmTextOpenWorldCreatorBriefV1, recoverLatestTextOpenWorldCreatorBriefSessionV1 } from '../../src/lib/open-world/creator-brief'
import * as creationResponseEvidence from '../../src/lib/agent/run/creation-response-evidence'
import { seedSfqa105GovernedBuild, SFQA105_ARTIFACT_KEY } from '../helpers/sfqa105-creator-source-refs'
import { saveAvgEditorV1, saveAvgAuthorWorkspaceV1, importAvgMediaV1, listAvgDraftMediaV1 } from '../../src/lib/avg/editor-service'
import { createAvgAuthoringPresetV1 } from '../../src/lib/avg/authoring-presets'
import { legacyPackage as avgEditorPackage } from '../helpers/avg-carrier-fixture'
import { seedAvgAuthorArtifacts, stageAuthorFixture } from '../helpers/avg-author-artifact-fixture'

import { readTextOpenWorldArtifactGovernanceV1 } from '../../src/lib/open-world/creator-artifact-governance'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import { prepareTextOpenWorldCreatorArtifactEditV1, createTextOpenWorldCreatorDirectEditOperationsV1, generateTextOpenWorldCreatorArtifactEditCandidateV1,
  confirmTextOpenWorldCreatorArtifactEditIntentV1, reviseTextOpenWorldCreatorArtifactEditCandidateV1, readLatestTextOpenWorldCreatorArtifactEditStateV1,
  resumeTextOpenWorldCreatorArtifactEditIntakeV1, cancelTextOpenWorldCreatorArtifactEditIntakeV1 } from '../../src/lib/open-world/creator-artifact-edit'


Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

describe('SFQA004 · real authoring and production boundaries', () => {
  let previous: Pick<ReturnType<typeof useAIConfigStore.getState>, 'config' | 'presets' | 'taskRoutes'>
  let previousLocks: PropertyDescriptor | undefined
  let gallery: { host: HTMLDivElement; root: Root } | null = null
  beforeEach(async () => {
    await db.delete(); await db.open()
    previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks')
    const locks = new Set<string>()
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: async (name: string, options: LockOptions | ((lock: object | null) => Promise<unknown>), callback?: (lock: object | null) => Promise<unknown>) => {
        const run = typeof options === 'function' ? options : callback!
        if (locks.has(name)) return run(null)
        locks.add(name)
        try { return await run({ name, mode: 'exclusive' }) } finally { locks.delete(name) }
      },
    } })
    sfqa004ChannelV1('production')
    const state = useAIConfigStore.getState()
    previous = { config: state.config, presets: state.presets, taskRoutes: state.taskRoutes }
    useAIConfigStore.setState({ config: { ...SFQA050_CONFIG_A }, presets: [], taskRoutes: {} })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => sfqa050ResponseV1())
  })
  afterEach(async () => {
    if (gallery) { await act(async () => gallery!.root.unmount()); gallery.host.remove(); gallery = null }
    if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks)
    else Reflect.deleteProperty(navigator, 'locks')
    vi.restoreAllMocks(); useAIConfigStore.setState(previous); await db.delete(); db.close()
  })

  async function roots() {
    return { projects: await db.projects.count(), worlds: await db.worlds.count(), works: await db.works.count() }
  }

  it.each(SFQA004_UPPER_WORK_KINDS)('new %s workspace fails before allocating any owner roots', async kind => {
    await expect(createWorkspace(sfqa004WorkspaceInputV1(), { kind })).rejects.toThrow('product-catalog')
    expect(await roots()).toEqual({ projects: 0, worlds: 0, works: 0 })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('chat draft creation cannot allocate a production-hidden product', async () => {
    await expect(createChatDraftV3('004 hidden chat')).rejects.toThrow('product-catalog')
    expect(await roots()).toEqual({ projects: 0, worlds: 0, works: 0 })
    expect(await db.chatAuthoringDrafts.count()).toBe(0)
  })

  it.each(SFQA004_UPPER_WORK_KINDS)('new %s Work cannot borrow an existing released workspace', async kind => {
    const base = await createWorkspace(sfqa004WorkspaceInputV1())
    await expect(createWorldWork(base.scope.projectId, { title: '004 hidden Work', kind })).rejects.toThrow('product-catalog')
    expect(await roots()).toEqual({ projects: 1, worlds: 1, works: 1 })
  })

  it('production opt-in and a world-engine purpose cannot authorize a hidden product', async () => {
    sfqa004ChannelV1('production', true)
    await expect(createWorkspace(sfqa004WorkspaceInputV1(), { kind: 'character-interaction', purpose: 'world-engine' })).rejects.toThrow('product-catalog')
    expect(await roots()).toEqual({ projects: 0, worlds: 0, works: 0 })
  })

  it('author workspace creation captures kind and metadata before its first asynchronous allocation', async () => {
    const input = sfqa004WorkspaceInputV1('004 original owner')
    const options = { kind: 'novel' as 'novel' | 'character-interaction' }
    const pending = createWorkspace(input, options)
    options.kind = 'character-interaction'; input.name = '004 mutated owner'
    const created = await pending
    expect(created.work.kind).toBe('novel')
    expect(created.work.title).toBe('004 original owner')
  })

  it('appending a Work captures its admitted identity before resolving the owner', async () => {
    const owner = await createWorkspace(sfqa004WorkspaceInputV1())
    const input = { title: '004 captured Work', kind: 'novel' as 'novel' | 'character-interaction' }
    const pending = createWorldWork(owner.scope.projectId, input)
    input.kind = 'character-interaction'
    expect((await pending).kind).toBe('novel')
  })

  it('unknown authoring identities fail closed without allocating roots', async () => {
    await expect(createWorkspace(sfqa004WorkspaceInputV1(), { kind: 'unregistered-product' as never })).rejects.toThrow('product-catalog')
    expect(await roots()).toEqual({ projects: 0, worlds: 0, works: 0 })
  })

  it.each(['novel', 'screenplay', 'comic', 'motion-drama'] as const)('released %s authoring still creates the correct Work in production', async kind => {
    const created = await createWorkspace(sfqa004WorkspaceInputV1(), { kind })
    expect(created.work.kind).toBe(kind)
    expect(await roots()).toEqual({ projects: 1, worlds: 1, works: 1 })
  })

  it('historical chat remains readable and selectable after switching to production', async () => {
    sfqa004ChannelV1('local-development')
    const old = await createChatDraftV3('004 historical chat')
    const original = await readChatDraftV1(old.scope)
    sfqa004ChannelV1('production')
    expect(await readChatDraftV1(old.scope)).toEqual(original)
    expect(JSON.parse(original.settingsJson).version).toBe(3)
    expect((await listWorldWorks(old.scope.projectId)).map(work => work.id)).toContain(old.scope.workId)
    expect(await switchActiveWork(old.scope.projectId, old.scope.workId)).toEqual(old.scope)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each((['chat', 'avg', 'town', 'ttrpg'] as const).flatMap(kind => [false, true].map(optIn => [kind, optIn] as const)))('historical %s rejects new manual settings with production opt-in %s and preserves original bytes', async (kind, optIn) => {
    sfqa004ChannelV1('local-development')
    const f = await sfqa004HistoricalDraftV1(kind)
    const work = await db.works.get(f.scope.workId)
    sfqa004ChannelV1('production', optIn)
    await expect(f.save()).rejects.toThrow('product-catalog')
    expect(await f.read()).toEqual(f.before)
    expect(await db.works.get(f.scope.workId)).toEqual(work)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['chat', 'avg', 'town', 'ttrpg'] as const)('local %s authoring keeps its existing owner/CAS write path', async kind => {
    sfqa004ChannelV1('local-development')
    const f = await sfqa004HistoricalDraftV1(kind)
    const saved = await f.save()
    expect(saved.revision).toBe(f.before.revision + 1)
    expect((await db.works.get(f.scope.workId))!.title).toBe('004 explicitly edited owner')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['avg', 'town'] as const)('%s S2 rechecks the actual delayed model boundary after initial local admission', async kind => {
    sfqa004ChannelV1('local-development')
    const f = await sfqa004HistoricalDraftV1(kind)
    const runAI = vi.fn(async () => JSON.stringify({ answer: '004 controlled S2 answer', settings: null }))
    const pending = kind === 'avg' ? consultAvgV1({ scope: f.scope, question: '004 prepare a candidate', runAI })
      : consultAiTownV1({ scope: f.scope, question: '004 prepare a candidate', runAI })
    sfqa004ChannelV1('production')
    await expect(pending).rejects.toThrow('product-catalog')
    expect(runAI).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    const after = await f.read()
    expect(after.settingsJson).toBe(f.before.settingsJson)
    if (!('conversationJson' in after)) throw new Error('004 expected an AVG/town conversation')
    expect(after.conversationJson).toContain('product-catalog')
    expect((await db.agentRunEvents.toArray()).some(event => event.type === 'model.requested')).toBe(false)
  })

  it.each(['avg', 'town'] as const)('%s keeps the original model answer/history when maturity changes during its already admitted call', async kind => {
    sfqa004ChannelV1('local-development')
    const f = await sfqa004HistoricalDraftV1(kind)
    const runAI = vi.fn(async () => {
      sfqa004ChannelV1('production')
      return JSON.stringify({ answer: '004 retain this originally admitted response', settings: f.settings })
    })
    if (kind === 'avg') await consultAvgV1({ scope: f.scope, question: '004 existing request', runAI })
    else await consultAiTownV1({ scope: f.scope, question: '004 existing request', runAI })
    const after = await f.read()
    if (!('conversationJson' in after)) throw new Error('004 expected an AVG/town conversation')
    expect(after.conversationJson).toContain('004 retain this originally admitted response')
    expect(runAI).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled()
    expect(after.settingsJson).toBe(f.before.settingsJson)
  })

  it('chat S2 rejects a fresh delayed callback while retaining the readable draft', async () => {
    sfqa004ChannelV1('local-development')
    const f = await seedChatConsultationFixtureV2()
    const runAI = vi.fn(async () => JSON.stringify(f.candidate))
    const pending = generateChatConsultationV2({ scope: f.scope, request: f.request, runAI })
    sfqa004ChannelV1('production')
    await expect(pending).rejects.toThrow('product-catalog')
    expect(runAI).not.toHaveBeenCalled()
    expect(await readChatDraftV1(f.scope)).toEqual(f.confirmed)
  })

  it('chat direct formal adoption is denied before fresh writes, rechecks the native transaction, and replays an already committed receipt', async () => {
    sfqa004ChannelV1('local-development')
    const f = await seedChatConsultationFixtureV2()
    const view = await generateChatConsultationV2({ scope: f.scope, request: f.request, runAI: async () => JSON.stringify(f.candidate) })
    const confirmation = { scope: f.scope, runId: view.runId, expectedCandidateHash: view.candidateHash!, fields: ['openingSituation'] as const }
    const before = await readAgentRunV1(f.scope, view.runId)
    sfqa004ChannelV1('production')
    await expect(adoptChatConsultationV2(confirmation)).rejects.toThrow('product-catalog')
    expect(await readChatDraftV1(f.scope)).toEqual(f.confirmed)
    expect(await readAgentRunV1(f.scope, view.runId)).toEqual(before)
    sfqa004ChannelV1('local-development')
    await expect(adoptChatConsultationV2({ ...confirmation, onBoundary: boundary => {
      if (boundary === 'before-commit') sfqa004ChannelV1('production')
    } })).rejects.toThrow('product-catalog')
    expect(await readChatDraftV1(f.scope)).toEqual(f.confirmed)
    expect(await readAgentRunV1(f.scope, view.runId)).toEqual(before)
    sfqa004ChannelV1('local-development')
    const adopted = await adoptChatConsultationV2(confirmation)
    const saved = await readChatDraftV1(f.scope)
    sfqa004ChannelV1('production')
    expect(await adoptChatConsultationV2(confirmation)).toEqual(adopted)
    expect(await readChatConsultationV2(f.scope, view.runId)).toEqual(adopted)
    expect(await recoverChatConsultationV2(f.scope, view.runId)).toEqual(adopted)
    expect(await readChatDraftV1(f.scope)).toEqual(saved)
    expect(fetch).not.toHaveBeenCalled()
  }, 30_000)

  it('chat late rejection after model.requested is a durable zero-dispatch terminal rather than unknown', async () => {
    sfqa004ChannelV1('local-development')
    const f = await seedChatConsultationFixtureV2()
    const runAI = vi.fn(async () => JSON.stringify(f.candidate))
    let runId = 0
    await expect(generateChatConsultationV2({ scope: f.scope, request: f.request, runAI, onBoundary: (boundary, id) => {
      runId = id
      if (boundary === 'model.requested') sfqa004ChannelV1('production')
    } })).rejects.toThrow('product-catalog')
    expect(runAI).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    const run = await readAgentRunV1(f.scope, runId)
    expect(run.run.status).toBe('failed')
    expect((await readChatConsultationV2(f.scope, runId)).status).toBe('blocked')
    expect((await recoverChatConsultationV2(f.scope, runId)).status).toBe('blocked')
    const denial = run.events.find(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'tool-result')!
    if (denial.type !== 'evidence.artifact.recorded') throw new Error('Missing real no-dispatch evidence')
    expect(JSON.parse(await readAgentRunArtifactExactV1({ projectId: f.scope.projectId, artifactKind: 'tool-result',
      contentHash: denial.payload.contentHash }))).toMatchObject({ schema: 'storyforge.chat-source-no-dispatch', dispatched: false,
      modelCalls: 0, inputTokens: 0, outputTokens: 0 })
    expect(await readChatDraftV1(f.scope)).toEqual(f.confirmed)
  }, 30_000)

  it('chat preserves an already dispatched response and candidate when maturity changes before it returns', async () => {
    sfqa004ChannelV1('local-development')
    const f = await seedChatConsultationFixtureV2()
    const runAI = vi.fn(async () => { sfqa004ChannelV1('production'); return JSON.stringify(f.candidate) })
    const view = await generateChatConsultationV2({ scope: f.scope, request: f.request, runAI })
    expect(view.status).toBe('ready')
    expect(view.candidateHash).toBeTruthy()
    expect((await recoverChatConsultationV2(f.scope, view.runId)).candidateHash).toBe(view.candidateHash)
    expect(await readChatDraftV1(f.scope)).toEqual(f.confirmed)
    expect(runAI).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled()
  }, 30_000)

  function manualNodeGraph(): AuthoringNodeGraph {
    const template = AUTHORING_NODE_BY_ID.get('input.manual-text')!
    return { ...emptyAuthoringGraph(), nodes: [{ id: 'manual', templateId: template.id, templateVersion: 1,
      title: template.label, x: 0, y: 0, config: { ...defaultConfigForTemplate(template), text: '004 historical manual input' },
      inputs: structuredClone(template.inputs), outputs: structuredClone(template.outputs) }] }
  }

  it('Node graph creation and manual save obey the preview entry while existing graphs remain readable', async () => {
    const owner = await createWorkspace(sfqa004WorkspaceInputV1())
    await expect(useNodeFlowStore.getState().createFlow(owner.scope.projectId, null, { graph: manualNodeGraph() })).rejects.toThrow('product-catalog')
    expect(await db.nodeFlows.count()).toBe(0)
    sfqa004ChannelV1('local-development')
    const id = await useNodeFlowStore.getState().createFlow(owner.scope.projectId, null, { graph: manualNodeGraph() })
    const before = (await db.nodeFlows.get(id))!
    sfqa004ChannelV1('production')
    await useNodeFlowStore.getState().load(owner.scope)
    expect(useNodeFlowStore.getState().flows).toContainEqual(before)
    await expect(useNodeFlowStore.getState().saveFlow({ ...before, name: '004 denied graph edit' })).rejects.toThrow('product-catalog')
    expect(await db.nodeFlows.get(id)).toEqual(before)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a preview Work cannot start or resume shared graph execution, while original prefix recovery stays available', async () => {
    sfqa004ChannelV1('local-development')
    const owner = await createWorkspace(sfqa004WorkspaceInputV1(), { kind: 'character-interaction' })
    const id = await useNodeFlowStore.getState().createFlow(owner.scope.projectId, null, { graph: manualNodeGraph() })
    const flow = (await db.nodeFlows.get(id))!
    const controller = new AbortController(); controller.abort('paused')
    const paused = await runAuthoringGraph({ flow, signal: controller.signal })
    expect(paused.run.status).toBe('paused')
    sfqa004ChannelV1('production')
    await expect(runAuthoringGraph({ flow })).rejects.toThrow('product-catalog')
    await expect(runAuthoringGraph({ flow, resumeRunId: paused.run.id })).rejects.toThrow('product-catalog')
    const recovered = await recoverInterruptedAuthoringRun({ flow, runId: paused.run.id!, scope: owner.scope })
    expect(recovered.id).toBe(paused.run.id)
    expect(recovered.nodeResultsJson).toBe(paused.run.nodeResultsJson)
    expect(await db.nodeRuns.count()).toBe(1)
    expect(fetch).not.toHaveBeenCalled()
  }, 30_000)

  it('candidate revision and rejection use the stored Work gate and persist only an authorized decision', async () => {
    sfqa004ChannelV1('local-development')
    const owner = await createWorkspace(sfqa004WorkspaceInputV1(), { kind: 'character-interaction' })
    const id = await useNodeFlowStore.getState().createFlow(owner.scope.projectId, null, { graph: manualNodeGraph() })
    const flow = (await db.nodeFlows.get(id))!
    const generated = await runAuthoringGraph({ flow })
    const input = { flow, scope: owner.scope, nodeId: 'manual', runId: generated.run.id! }
    const stored = await db.nodeRuns.get(input.runId)
    sfqa004ChannelV1('production')
    await expect(reviseAuthoringCandidate({ ...input, reject: true })).rejects.toThrow('product-catalog')
    await expect(reviseAuthoringCandidate({ ...input, output: '未获准的修改' })).rejects.toThrow('product-catalog')
    expect(await db.nodeRuns.get(input.runId)).toEqual(stored)
    sfqa004ChannelV1('local-development')
    await reviseAuthoringCandidate({ ...input, output: '作者修订' })
    const draft = await db.nodeRuns.get(input.runId)
    expect(JSON.parse(draft!.nodeResultsJson).manual).toMatchObject({ output: '作者修订', status: 'draft' })
    await reviseAuthoringCandidate({ ...input, reject: true })
    const saved = await db.nodeRuns.get(input.runId)
    expect(JSON.parse(saved!.nodeResultsJson).manual).toMatchObject({ output: '作者修订', status: 'rejected' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('released longform uses the shared engine and original formal receipt in production without inheriting Node UI preview denial', async () => {
    sfqa004ChannelV1('local-development')
    const f = await createQualityNodeFieldFlow('world', 1)
    vi.mocked(fetch).mockImplementation(async () => sfqa050ResponseV1(qualityNodeFieldRaw(f.field, 0)))
    sfqa004ChannelV1('production')
    const generated = await runAuthoringGraph({ flow: f.flow })
    expect(generated.run.status).toBe('completed')
    const input = { flow: f.flow, runId: generated.run.id!, nodeId: 'field', scope: f.scope, output: generated.candidates.field.output }
    expect((await adoptAuthoringCandidate(input)).written).toHaveLength(1)
    const canonical = await db.worldviews.toArray()
    expect(await adoptAuthoringCandidate(input)).toMatchObject({ recovered: true, written: [] })
    await recoverInterruptedAuthoringRun(input)
    expect(await db.worldviews.toArray()).toEqual(canonical)
    expect(fetch).toHaveBeenCalledTimes(1)
  }, 30_000)

  it('both TTRPG campaign and open-design public APIs reject fresh production S2 requests before source work or model dispatch', async () => {
    sfqa004ChannelV1('local-development')
    const f = await sfqa004HistoricalDraftV1('ttrpg')
    const runAI = vi.fn(async () => '')
    sfqa004ChannelV1('production')
    await expect(generateTtrpgOpenAuthoringDesignCandidateV1({ scope: f.scope, revision: f.before.revision,
      request: { schema: 'storyforge.ttrpg-open-authoring-design-request', version: 1, instruction: '004 requested design', sections: ['pressure'] }, runAI })).rejects.toThrow('product-catalog')
    await expect(generateTtrpgCampaignProposalCandidateV2({ scope: f.scope, worldReleaseId: 1, objective: '004 requested campaign',
      seed: { title: '004 campaign', background: 'frozen source', coreConflict: 'keep source', opening: 'author start', structure: 'node-based' }, runAI })).rejects.toThrow('product-catalog')
    expect(runAI).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(await db.agentRuns.count()).toBe(0)
    expect(await f.read()).toEqual(f.before)
  })

  it.each(PRODUCTION_PRODUCT_KINDS_V1)('new %s intent uses production identity rather than the novel owner kind', async productType => {
    const world = await seedCurrentProductWorld('004 released world')
    await expect(executeProductProductionCommand({ scope: world.scope, command: {
      type: 'create-intent', commandId: '004.new-intent', productionKey: `004.${productType}`,
      productType, worldReleaseId: world.release.id!, userText: '004 explicit author intent',
    } })).rejects.toThrow('product-catalog')
    expect(await db.productProductions.count()).toBe(0)
    expect(await db.productProductionCommands.count()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('an authorized local Build cannot dispatch new tasks in production or retry them invisibly', async () => {
    sfqa004ChannelV1('local-development')
    const owned = await authorizeSFQA050ProductionV1('general')
    sfqa004ChannelV1('production')
    const executor = vi.fn(owned.executor)
    await runProductProductionUntilBlockedV1({ ...owned, executor })
    expect(executor).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    const build = (await db.productBuilds.where('productionId').equals(owned.productionId).first())!
    expect(build.status).toBe('recovery-required')
    expect(build.failureJson).toContain('product-catalog')
    expect(build.failureJson).not.toContain('task-result-unknown')
    const ledger = JSON.parse(build.budgetLedgerJson)
    expect(ledger.attempts.every((entry: { usageKnown: boolean; usage: { modelCalls: number; mediaCalls: number } }) => (
      entry.usageKnown && entry.usage.modelCalls === 0 && entry.usage.mediaCalls === 0
    ))).toBe(true)
    expect((await db.agentRunEvents.toArray()).some(event => event.type === 'model.requested')).toBe(false)
    await runProductProductionUntilBlockedV1({ ...owned, executor })
    expect(executor).not.toHaveBeenCalled()
    const p = (await db.productProductions.get(owned.productionId))!
    expect(await executeProductProductionCommand({ ...owned, command: { type: 'resolve-blocker', commandId: '004.cancel.failed',
      expectedStateRevision: p.stateRevision, blockerKey: JSON.parse(build.failureJson).taskKey,
      resolution: { action: 'cancel', note: '004 stop without another attempt' } } })).toMatchObject({ ok: true })
    expect((await db.productProductions.get(owned.productionId))!.status).toBe('stopped')
  }, 30_000)

  it('old command receipts replay exactly while fresh authoring, adoption and publication fail before mutation', async () => {
    sfqa004ChannelV1('local-development')
    const owned = await authorizeSFQA050ProductionV1('general')
    const row = (await db.productProductionBriefs.where('productionId').equals(owned.productionId).first())!
    const before = await db.productProductions.get(owned.productionId)
    const build = await db.productBuilds.where('productionId').equals(owned.productionId).first()
    const count = await db.productProductionCommands.count()
    sfqa004ChannelV1('production')
    const intent = await executeProductProductionCommand({ scope: owned.scope, command: {
      type: 'create-intent', commandId: 'sfqa050.intent', productionKey: 'sfqa050.general', productType: 'text-adventure',
      worldReleaseId: owned.brief.source.worldReleaseId, userText: '作者明确开始受控生产',
    } })
    expect(intent).toMatchObject({ ok: true, replayed: true, productionId: owned.productionId })
    const start = { type: 'authorize-start' as const, commandId: 'sfqa050.start', expectedStateRevision: before!.stateRevision - 1,
      briefRevision: row.revision, briefHash: row.briefHash, authorizationNonce: 'sfqa050.explicit.author.start' }
    expect(await executeProductProductionCommand({ ...owned, command: start })).toMatchObject({ ok: true, replayed: true })
    for (const command of [
      { ...start, commandId: '004.fresh.start', expectedStateRevision: before!.stateRevision },
      { type: 'save-brief-revision', commandId: '004.fresh.save', expectedStateRevision: before!.stateRevision, parentRevision: row.revision, brief: owned.brief },
      { type: 'publish', commandId: '004.fresh.publish', expectedStateRevision: before!.stateRevision, buildNumber: 1,
        expectedManifestHash: 'a'.repeat(64), adoptionIntentHash: 'b'.repeat(64) },
      { type: 'adopt-avg-artifact', commandId: '004.fresh.adopt', expectedStateRevision: before!.stateRevision, expectedBuildRevision: 1,
        controlEpoch: 0, buildNumber: 1, artifactKey: '004.candidate', candidateVersion: 1, candidateHash: 'c'.repeat(64) },
    ]) await expect(executeProductProductionCommand({ ...owned, command })).rejects.toThrow('product-catalog')
    expect(await db.productProductions.get(owned.productionId)).toEqual(before)
    expect(await db.productBuilds.get(build!.id!)).toEqual(build)
    expect(await db.productProductionCommands.count()).toBe(count)
    expect(fetch).not.toHaveBeenCalled()
  }, 30_000)

  it('rechecks admission after the asynchronous durable boundary before entering the executor', async () => {
    sfqa004ChannelV1('local-development')
    const owned = await authorizeSFQA050ProductionV1('general')
    const executor = vi.fn(owned.executor)
    await runProductProductionUntilBlockedV1({ ...owned, executor, onDurableBoundary: async boundary => {
      if (boundary === 'provider.requested') sfqa004ChannelV1('production')
    } })
    expect(executor).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    const build = (await db.productBuilds.where('productionId').equals(owned.productionId).first())!
    expect(build.status).toBe('recovery-required')
    expect(build.failureJson).not.toContain('task-result-unknown')
  }, 30_000)

  it('pause, stop, archive and restore remain governed maintenance without starting another Build', async () => {
    sfqa004ChannelV1('local-development')
    const owned = await authorizeSFQA050ProductionV1('general')
    sfqa004ChannelV1('production')
    for (const details of [
      { type: 'pause', reason: '004 author stops spending' },
      { type: 'stop', retention: 'keep-build' },
      { type: 'archive', reason: '004 preserve owned history' },
      { type: 'restore' },
    ]) {
      const p = (await db.productProductions.get(owned.productionId))!
      expect(await executeProductProductionCommand({ ...owned, command: {
        ...details, commandId: `004.maintenance.${details.type}`, expectedStateRevision: p.stateRevision,
      } })).toMatchObject({ ok: true })
    }
    expect((await db.productProductions.get(owned.productionId))!.status).toBe('stopped')
    expect(await db.productBuilds.count()).toBe(1)
    expect(fetch).not.toHaveBeenCalled()
  }, 30_000)

  it('production can verify and look up an existing immutable local preview without granting new creation', async () => {
    sfqa004ChannelV1('local-development')
    const owned = await seedAiTownRuntimeFixture()
    const p = (await db.productProductions.get(owned.productionId))!
    const build = (await db.productBuilds.get(owned.buildId))!
    sfqa004ChannelV1('production')
    expect(await executeProductProductionCommand({ ...owned, command: { type: 'request-preview', commandId: '004.history.preview',
      expectedStateRevision: p.stateRevision, buildNumber: build.buildNumber } })).toMatchObject({ ok: true,
      result: { previewHash: build.previewHash, packageHash: build.packageHash } })
    expect(await db.productBuilds.get(owned.buildId)).toEqual(build)
    expect(fetch).not.toHaveBeenCalled()
  }, 30_000)

  it('production can book genuinely unsent legacy attempts under the original proof without new execution', async () => {
    sfqa004ChannelV1('local-development')
    useAIConfigStore.setState({ config: { ...SFQA050_CONFIG_A, contextWindow: 131_072 } })
    const owned = await openContentRevisionFixtureV1({ legacyNoDispatch: true })
    const build = (await db.productBuilds.get(owned.buildId))!
    const p = (await db.productProductions.get(owned.productionId))!
    const artifact = (await db.productBuildArtifacts.where('buildId').equals(owned.buildId).toArray())
      .find(row => row.artifactKey === 'ttrpg.open.situation-layer' && row.controlEpoch === JSON.parse(build.planJson).controlEpoch && row.status === 'accepted')!
    const view = { expectedStateRevision: p.stateRevision, buildNumber: build.buildNumber, controlEpoch: build.controlEpoch,
      planHash: build.planHash, anchor: { artifactKey: 'ttrpg.open.situation-layer' as const, version: artifact.version, contentHash: artifact.contentHash } }
    sfqa004ChannelV1('production')
    const inspected = await inspectProductProductionLocalNoDispatchV1({ ...owned, view })
    expect(await executeProductProductionCommand({ ...owned, command: { type: 'book-local-no-dispatch', commandId: '004.history.book',
      ...view, ledgerHash: inspected.ledgerHash, proofs: inspected.candidates.map(row => ({ attemptKeyHash: row.attemptKeyHash, proofHash: row.proofHash })) } })).toMatchObject({ ok: true })
    const current = (await db.productBuilds.get(owned.buildId))!
    expect(current.planHash).toBe(build.planHash)
    expect(current.controlEpoch).toBe(build.controlEpoch)
    expect(current.status).toBe(build.status)
    expect(current.budgetLedgerJson).not.toBe(build.budgetLedgerJson)
    expect(fetch).not.toHaveBeenCalled()
  }, 30_000)

  it('books an already retained original receipt in production, then replays its preauthorized author revision with zero new model requests', async () => {
    sfqa004ChannelV1('local-development')
    const priorLocks = Object.getOwnPropertyDescriptor(navigator, 'locks')
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<unknown>) => callback({}) } })
    try {
      const f = await sfqa004OriginalResponseFixtureV1(fetcher => vi.mocked(fetch).mockImplementation(fetcher))
      const original = await readAgentRunV1(f.scope, f.query.runId)
      expect(original.run.status).toBe('failed')
      const capture = await captureProductProductionOriginalResponseV1(f.query)
      const captureBefore = await readAgentRunV1(f.scope, capture.runId)
      sfqa004ChannelV1('production')
      const p = (await db.productProductions.get(f.productionId))!
      const build = (await db.productBuilds.get(f.query.buildId))!
      const command = { type: 'book-original-response' as const, commandId: '004.original.book', expectedStateRevision: p.stateRevision,
        buildNumber: build.buildNumber, controlEpoch: build.controlEpoch, planHash: build.planHash, taskKey: f.query.taskKey,
        originalRunId: f.query.runId, originalAttempt: f.query.attempt, captureRunId: capture.runId,
        captureReceiptHash: capture.receiptHash, disposition: 'use-native-token-usage' as const }
      expect(await executeProductProductionCommand({ ...f, command })).toMatchObject({ ok: true })
      expect(await executeProductProductionCommand({ ...f, command })).toMatchObject({ ok: true, replayed: true })
      const current = (await db.productProductions.get(f.productionId))!
      const authorCommand = { type: 'resolve-blocker' as const, commandId: '004.original.author', expectedStateRevision: current.stateRevision,
        blockerKey: f.query.taskKey, resolution: { action: 'author-edit' as const, note: '004 author verifies original material',
          authorDraftJson: JSON.stringify(f.data.sourceFacts), originalResponseSource: { captureRunId: capture.runId, captureReceiptHash: capture.receiptHash } } }
      await expect(executeProductProductionCommand({ ...f, command: authorCommand })).rejects.toThrow('product-catalog')
      sfqa004ChannelV1('local-development')
      expect(await executeProductProductionCommand({ ...f, command: authorCommand })).toMatchObject({ ok: true })
      sfqa004ChannelV1('production')
      const calls = f.requests.length
      await runProductProductionUntilBlockedV1(f)
      expect(f.requests).toHaveLength(calls)
      const accepted = (await db.productBuildArtifacts.where('buildId').equals(f.query.buildId).toArray())
        .find(artifact => artifact.artifactKey === f.query.taskKey && artifact.status === 'accepted')!
      expect(accepted).toBeTruthy()
      const run = await readAgentRunV1(f.scope, accepted.producerRunId!)
      expect(run.run.status).toBe('completed')
      expect(run.events.some(event => event.type === 'model.requested')).toBe(false)
      expect(await readAgentRunV1(f.scope, f.query.runId)).toEqual(original)
      expect(await readAgentRunV1(f.scope, capture.runId)).toEqual(captureBefore)
      expect(f.requests.filter(request => request.method === 'POST' && request.path.endsWith('/requests'))).toHaveLength(1)
    } finally {
      if (priorLocks) Object.defineProperty(navigator, 'locks', priorLocks)
      else Reflect.deleteProperty(navigator, 'locks')
    }
  }, 30_000)

  it.each(['plan', 'role', 'units'] as const)('the direct %s owner commit rejects fresh production writes after preparation and preserves local CAS', async kind => {
    sfqa004ChannelV1('local-development')
    const prepared = await (async () => {
      if (kind === 'plan') {
        const f = await seedChatConsultationFixtureV2()
        const input = await prepareChatPlanWriteV2(f.scope, f.request, f.candidate, ['openingSituation'])
        return { scope: f.scope, before: input.expected, commit: () => commitChatPlanWriteV2(input) }
      }
      if (kind === 'role') {
        const f = await seedChatRoleProfileFixture()
        const input = await prepareChatRoleProfileWriteV1(f.scope, f.request, f.candidate)
        return { scope: f.scope, before: input.expected, commit: () => commitChatRoleProfileWriteV1(input),
          remove: (revision: number) => removeChatRoleProfileV1(f.scope, revision, f.actor.resourceKey) }
      }
      const f = await seedChatSourceUnitConfirmationFixture()
      const input = await prepareChatSourceUnitWriteV1(f.scope, f.request, sourceUnitAuthorizationReportFixture(f.candidate, f.permissions))
      return { scope: f.scope, before: input.expected, commit: () => commitChatSourceUnitWriteV1(input),
        remove: (revision: number) => removeChatSourceUnitBundleV1(f.scope, revision, f.candidate.fragments.map(row => row.fragmentKey)) }
    })()
    sfqa004ChannelV1('production', true)
    await expect(prepared.commit()).rejects.toThrow('product-catalog')
    expect(await readChatDraftV1(prepared.scope)).toEqual(prepared.before)
    sfqa004ChannelV1('local-development')
    const saved = await prepared.commit()
    expect(saved.revision).toBe(prepared.before.revision + 1)
    if ('remove' in prepared && prepared.remove) {
      sfqa004ChannelV1('production')
      await expect(prepared.remove(saved.revision)).rejects.toThrow('product-catalog')
      expect(await readChatDraftV1(prepared.scope)).toEqual(saved)
      sfqa004ChannelV1('local-development')
      expect((await prepared.remove(saved.revision)).revision).toBe(saved.revision + 1)
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['createListing', 'reviseListing', 'submitListing', 'publishListing', 'acquire', 'registerRelease'] as const)('the public marketplace %s boundary cannot borrow production opt-in and never dispatches', async method => {
    sfqa004ChannelV1('production', true)
    const network = vi.fn(async (_target: string) => new Response('[]', { headers: { 'content-type': 'application/json' } }))
    const client = new CommercialHttpClientV1({ baseUrl: 'https://sfqa004-market.example', fetch: network })
    const input = { accessToken: '004-controlled-fixture-token', requestId: '004.fresh', listingId: '004.listing',
      releaseHash: 'a'.repeat(64), productType: 'ttrpg' as const, title: '004 candidate', summary: '004 listing', contentWarnings: [],
      license: { licenseId: '004.offline', licenseVersion: '1', allowOfflineExport: true, allowRemix: false, commercialReuse: false, requiresAttribution: true, termsUrl: 'https://sfqa004-market.example/license' },
      currency: 'CNY', amountMinor: 0, creatorShareBps: 8000, bundle: ttrpgDistribution().bundle }
    await expect(client[method](input)).rejects.toThrow('product-catalog')
    expect(network).not.toHaveBeenCalled()
    expect(await roots()).toEqual({ projects: 0, worlds: 0, works: 0 })
  })

  it('marketplace read methods keep their original authenticated wire paths under production maturity', async () => {
    const network = vi.fn(async (_target: string) => new Response('[]', { headers: { 'content-type': 'application/json' } }))
    const client = new CommercialHttpClientV1({ baseUrl: 'https://sfqa004-market.example', fetch: network })
    expect(await client.discover()).toEqual([])
    expect(await client.myListings('004-history-token')).toEqual([])
    expect(await client.reviewQueue('004-review-token')).toEqual([])
    expect(network).toHaveBeenCalledTimes(3)
    expect(network.mock.calls.map(call => String(call[0]))).toEqual([
      'https://sfqa004-market.example/v1/commercial/discover',
      'https://sfqa004-market.example/v1/commercial/listings/mine',
      'https://sfqa004-market.example/v1/commercial/listings/review-queue',
    ])
  })

  async function creatorSession() {
    const owned = await seedCurrentProductWorld('004 Creator source')
    const preview = await inspectTextOpenWorldCreatorWorldSourceV1({ scope: owned.scope, localReleaseRecordId: owned.release.id!, expectedReleaseHash: owned.release.contentHash })
    const selection = { sourceKind: 'world-release' as const, sourceScope: owned.scope,
      localReleaseRecordId: owned.release.id!, expectedReleaseHash: owned.release.contentHash, preview }
    const session = await startTextOpenWorldCreatorBriefSessionV1({ selection, sessionKey: 'sfqa004-creator' })
    return { owned, selection, session }
  }

  it('Creator Brief fresh start/save/manual confirm/model APIs use their own product even under a released source Work', async () => {
    sfqa004ChannelV1('local-development')
    const f = await creatorSession()
    const before = { runs: await db.agentRuns.toArray(), events: await db.agentEvents.toArray(), productions: await db.productProductions.toArray(), briefs: await db.productProductionBriefs.toArray() }
    sfqa004ChannelV1('production', true)
    const runAI = vi.fn(async () => '{}')
    await expect(startTextOpenWorldCreatorBriefSessionV1({ selection: f.selection, sessionKey: '004-other' })).rejects.toThrow('product-catalog')
    await expect(saveTextOpenWorldCreatorBriefDraftV1({ session: f.session, draft: f.session.draft })).rejects.toThrow('product-catalog')
    await expect(generateTextOpenWorldCreatorBriefCandidateV1({ session: f.session, draft: f.session.draft, runAI })).rejects.toThrow('product-catalog')
    await expect(confirmTextOpenWorldCreatorBriefV1({ session: f.session, draft: f.session.draft, acknowledgements: {
      sourceIdentityReviewed: true, productBoundaryReviewed: true, unresolvedItemsClosed: true, directPublishWorkflowReviewed: true,
    } })).rejects.toThrow('product-catalog')
    expect(await db.agentRuns.toArray()).toEqual(before.runs)
    expect(await db.agentEvents.toArray()).toEqual(before.events)
    expect(await db.productProductions.toArray()).toEqual(before.productions)
    expect(await db.productProductionBriefs.toArray()).toEqual(before.briefs)
    expect((await recoverLatestTextOpenWorldCreatorBriefSessionV1([f.owned.scope]))?.draft).toEqual(f.session.draft)
    expect(runAI).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('Creator Brief late pre-dispatch denial records known zero usage and a failed durable run', async () => {
    sfqa004ChannelV1('local-development')
    const f = await creatorSession()
    const original = creationResponseEvidence.recordCreationModelRequestV1
    vi.spyOn(creationResponseEvidence, 'recordCreationModelRequestV1').mockImplementation(async input => {
      const prepared = await original(input)
      sfqa004ChannelV1('production')
      return prepared
    })
    const runAI = vi.fn(async () => '{}')
    await expect(generateTextOpenWorldCreatorBriefCandidateV1({ session: f.session, draft: f.session.draft, runAI })).rejects.toThrow('product-catalog')
    const row = (await db.agentRuns.orderBy('id').last())!
    const run = await readAgentRunV1(f.owned.scope, row.id!)
    expect(run.projection.state).toBe('failed')
    expect(run.events.some(event => event.type === 'run.paused')).toBe(false)
    const evidence = run.events.find(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'tool-result')!
    if (evidence.type !== 'evidence.artifact.recorded') throw new Error('004 missing no-dispatch evidence')
    const observation = JSON.parse(await readAgentRunArtifactExactV1({ projectId: f.owned.scope.projectId, artifactKind: 'tool-result', contentHash: evidence.payload.contentHash })).observation
    expect(observation.requestLifecycle).toEqual({ phase: 'pre-dispatch', responseStatus: null })
    expect(observation.usage).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
    expect(runAI).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  async function creatorEditFixture() {
    const f = await seedSfqa105GovernedBuild()
    const governance = await readTextOpenWorldArtifactGovernanceV1({ scope: f.scope, productionId: f.productionId })
    const selection = { scope: f.scope, productionId: f.productionId, buildId: f.buildId,
      expectedSnapshotHash: governance.snapshotHash, artifactKey: SFQA105_ARTIFACT_KEY, entityIdentity: f.entityIdentity }
    const context = await prepareTextOpenWorldCreatorArtifactEditV1(selection)
    const field = context.editableFields.find(row => row.jsonPointer.endsWith('/biography'))!
    const operations = await createTextOpenWorldCreatorDirectEditOperationsV1({ context, values: { [field.fieldId]: '004 author explicitly changes only this biography.' } })
    const raw = JSON.stringify({ schema: 'storyforge.text-open-world-creator-edit-model-output', version: 1, operations })
    return { ...f, selection, context, field, operations, raw }
  }

  it('Creator edit fresh direct/opaque/formal requests are denied under production maturity', async () => {
    sfqa004ChannelV1('local-development')
    const f = await creatorEditFixture()
    const before = await db.agentRuns.toArray()
    const runAI = vi.fn(async () => f.raw)
    sfqa004ChannelV1('production', true)
    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({ selection: f.selection, mode: 'direct', operations: f.operations })).rejects.toThrow('product-catalog')
    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({ selection: f.selection, mode: 'agent', authorInstruction: '004 change biography', runAI })).rejects.toThrow('product-catalog')
    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({ selection: f.selection, mode: 'agent', authorInstruction: '004 change biography', aiConfig: SFQA050_CONFIG_A })).rejects.toThrow('product-catalog')
    expect(await db.agentRuns.toArray()).toEqual(before)
    expect(runAI).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  }, 30_000)

  it('Creator edit keeps an original candidate and no-change revision in production', async () => {
    sfqa004ChannelV1('local-development')
    const f = await creatorEditFixture()
    sfqa004ChannelV1('local-development')
    const candidate = await generateTextOpenWorldCreatorArtifactEditCandidateV1({ selection: f.selection, mode: 'direct', operations: f.operations })
    const confirm = { selection: f.selection, runId: candidate.snapshot.run.id, warningAcknowledgementCodes: [] }
    sfqa004ChannelV1('production')
    const historical = await readLatestTextOpenWorldCreatorArtifactEditStateV1(f.selection)
    if (!historical || 'kind' in historical) throw new Error('004 expected original candidate')
    expect(historical.candidate.candidateHash).toBe(candidate.candidate.candidateHash)
    expect((await generateTextOpenWorldCreatorArtifactEditCandidateV1({ selection: f.selection, mode: 'direct', operations: f.operations })).candidate.candidateHash).toBe(candidate.candidate.candidateHash)
    expect((await reviseTextOpenWorldCreatorArtifactEditCandidateV1({ ...confirm, operations: f.operations })).candidate.candidateHash).toBe(candidate.candidate.candidateHash)
    expect(fetch).not.toHaveBeenCalled()
  }, 30_000)

  it('Creator edit rejects a new revision or first intent for a historical candidate in production', async () => {
    sfqa004ChannelV1('local-development')
    const f = await creatorEditFixture()
    const candidate = await generateTextOpenWorldCreatorArtifactEditCandidateV1({ selection: f.selection, mode: 'direct', operations: f.operations })
    const confirm = { selection: f.selection, runId: candidate.snapshot.run.id, warningAcknowledgementCodes: [] }
    const revised = await createTextOpenWorldCreatorDirectEditOperationsV1({ context: f.context, values: { [f.field.fieldId]: '004 later fresh biography' } })
    sfqa004ChannelV1('production')
    await expect(reviseTextOpenWorldCreatorArtifactEditCandidateV1({ ...confirm, operations: revised })).rejects.toThrow('product-catalog')
    await expect(confirmTextOpenWorldCreatorArtifactEditIntentV1(confirm)).rejects.toThrow('product-catalog')
    expect(fetch).not.toHaveBeenCalled()
  }, 30_000)

  it('Creator edit replays an already committed terminal receipt under production maturity', async () => {
    sfqa004ChannelV1('local-development')
    const f = await creatorEditFixture()
    const candidate = await generateTextOpenWorldCreatorArtifactEditCandidateV1({ selection: f.selection, mode: 'direct', operations: f.operations })
    const confirm = { selection: f.selection, runId: candidate.snapshot.run.id, warningAcknowledgementCodes: [] }
    const accepted = await confirmTextOpenWorldCreatorArtifactEditIntentV1(confirm)
    sfqa004ChannelV1('production')
    expect((await confirmTextOpenWorldCreatorArtifactEditIntentV1(confirm)).snapshot.projection.terminalReceiptHash).toBe(accepted.snapshot.projection.terminalReceiptHash)
    expect(fetch).not.toHaveBeenCalled()
  }, 30_000)

  it('Creator edit checks after model.requested and settles a known pre-dispatch failure without unknown outcome', async () => {
    sfqa004ChannelV1('local-development')
    const f = await creatorEditFixture()
    const runAI = vi.fn(async () => f.raw)
    let runId = 0
    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({ selection: f.selection, mode: 'agent', authorInstruction: '004 late model boundary', runAI,
      onDurableBoundary: (boundary, snapshot) => { if (boundary === 'model.requested') { runId = snapshot.run.id; sfqa004ChannelV1('production') } },
    })).rejects.toThrow('product-catalog')
    const run = await readAgentRunV1(f.scope, runId)
    expect(run.projection.state).toBe('failed')
    expect(run.events.some(event => event.type === 'run.paused' || event.type === 'model.responded')).toBe(false)
    const result = run.events.find(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'tool-result')!
    if (result.type !== 'evidence.artifact.recorded') throw new Error('004 missing known model failure')
    const failure = JSON.parse(await readAgentRunArtifactExactV1({ projectId: f.scope.projectId, artifactKind: 'tool-result', contentHash: result.payload.contentHash }))
    expect(failure).toMatchObject({ phase: 'pre-dispatch', responseStatus: null, failureCode: 'creator-edit-model-not-dispatched', retryable: false, usage: null })
    expect(runAI).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  }, 30_000)

  it('Creator edit restores an already retained paid result after maturity changes with zero redispatch', async () => {
    sfqa004ChannelV1('local-development')
    const f = await creatorEditFixture()
    let runId = 0
    const runAI = vi.fn(async () => f.raw)
    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({ selection: f.selection, mode: 'agent', authorInstruction: '004 keep paid raw', runAI,
      onDurableBoundary: (boundary, snapshot) => { if (boundary === 'model-result.recorded') { runId = snapshot.run.id; sfqa004ChannelV1('production'); throw new Error('004 controlled paid-result interruption') } },
    })).rejects.toThrow('004 controlled paid-result interruption')
    const restored = await readLatestTextOpenWorldCreatorArtifactEditStateV1(f.selection)
    if (!restored || 'kind' in restored) throw new Error('004 expected restored paid candidate')
    expect(restored.candidate.modelUsage.modelCalls).toBe(1)
    expect(restored.snapshot.run.id).toBe(runId)
    expect(restored.candidate.patch.operations).toEqual(f.operations)
    const snapshot = await readAgentRunV1(f.scope, runId)
    const raw = snapshot.events.find(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'raw-response')!
    if (raw.type !== 'evidence.artifact.recorded') throw new Error('004 missing retained raw')
    expect(await readAgentRunArtifactExactV1({ projectId: f.scope.projectId, artifactKind: 'raw-response', contentHash: raw.payload.contentHash })).toBe(f.raw)
    expect(runAI).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled()
  }, 30_000)

  it('Creator edit resumes a previously frozen intent and terminal verification in production', async () => {
    sfqa004ChannelV1('local-development')
    const f = await creatorEditFixture()
    const direct = await generateTextOpenWorldCreatorArtifactEditCandidateV1({ selection: f.selection, mode: 'direct', operations: f.operations })
    const confirm = { selection: f.selection, runId: direct.snapshot.run.id, warningAcknowledgementCodes: [] }
    await expect(confirmTextOpenWorldCreatorArtifactEditIntentV1({ ...confirm, onDurableBoundary: boundary => {
      if (boundary === 'intent.checkpoint') { sfqa004ChannelV1('production'); throw new Error('004 frozen intent interruption') }
    } })).rejects.toMatchObject({ name: 'CreatorEditDurableBoundaryInterruptionV1', cause: { message: '004 frozen intent interruption' } })
    expect((await confirmTextOpenWorldCreatorArtifactEditIntentV1(confirm)).snapshot.projection.state).toBe('completed')
    expect(fetch).not.toHaveBeenCalled()
  }, 30_000)

  it('Creator edit explicit pre-request intake resume denies new execution while cancel stays available', async () => {
    sfqa004ChannelV1('local-development')
    const f = await creatorEditFixture()
    let runId = 0
    const runAI = vi.fn(async () => f.raw)
    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({ selection: f.selection, mode: 'agent', authorInstruction: '004 unstarted intake', runAI,
      onDurableBoundary: (boundary, snapshot) => { if (boundary === 'intake.checkpoint') { runId = snapshot.run.id; throw new Error('004 intake interruption') } },
    })).rejects.toMatchObject({ name: 'CreatorEditDurableBoundaryInterruptionV1', cause: { message: '004 intake interruption' } })
    sfqa004ChannelV1('production')
    await expect(resumeTextOpenWorldCreatorArtifactEditIntakeV1({ selection: f.selection, runId, runAI })).rejects.toThrow('product-catalog')
    expect((await cancelTextOpenWorldCreatorArtifactEditIntakeV1({ selection: f.selection, runId })).projection.state).toBe('cancelled')
    expect(runAI).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  }, 30_000)

  async function waitForRenderedPage(assertion: () => void) {
    const deadline = Date.now() + 4000
    let failure: unknown
    do {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
      try { assertion(); return } catch (cause) { failure = cause }
    } while (Date.now() < deadline)
    throw failure
  }

  async function renderPage(Page: ComponentType, route: string) {
    const host = document.createElement('div')
    document.body.append(host)
    gallery = { host, root: createRoot(host) }
    await act(async () => gallery!.root.render(createElement(MemoryRouter, { initialEntries: [route] },
      createElement(Routes, null,
        createElement(Route, { path: '/:product/:pageId', element: createElement(Page) }),
        createElement(Route, { path: '/home/settings', element: createElement('p', { 'data-testid': '004-settings' }, '004 settings') })))) )
    return host
  }

  function pageButton(host: HTMLElement, label: string) {
    const result = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.trim() === label)
    if (!result) throw new Error(`004 missing real page button: ${label}`)
    return result
  }

  it.each((['chat', 'avg', 'town', 'ttrpg'] as const).flatMap(kind => [false, true].map(optIn => [kind, optIn] as const)))('actual %s library keeps historical links while new creation is disabled in production opt-in %s', async (kind, optIn) => {
    sfqa004ChannelV1('local-development')
    const f = await sfqa004HistoricalDraftV1(kind)
    sfqa004ChannelV1('production', optIn)
    const Page = kind === 'chat' ? (await import('../../src/pages/CharacterChatPage')).default
      : kind === 'avg' ? (await import('../../src/pages/AvgPage')).default
        : kind === 'town' ? (await import('../../src/pages/AiTownPage')).default
          : (await import('../../src/pages/TtrpgPage')).default
    const host = await renderPage(Page, `/${kind}/library?project=${f.scope.projectId}&work=${f.scope.workId}`)
    const title = (await db.works.get(f.scope.workId))!.title
    await waitForRenderedPage(() => expect(host.textContent).toContain(title))
    expect(host.textContent).toContain('当前产品尚未开放创作')
    const label = kind === 'chat' ? '新建角色聊天' : kind === 'avg' ? '新建 AVG' : kind === 'town' ? '新建小镇' : '新建战役'
    await waitForRenderedPage(() => expect(pageButton(host, label).disabled).toBe(true))
    expect(Array.from(host.querySelectorAll('a')).some(link => link.href.includes(`/${kind}/play?`))).toBe(true)
    expect(Array.from(host.querySelectorAll('a')).some(link => link.href.includes(`/${kind}/vision?`))).toBe(true)
    const settings = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.trim() === '通用设置')
    if (settings) expect(settings.disabled).toBe(false)
    expect(await f.read()).toEqual(f.before)
    expect(vi.mocked(fetch).mock.calls.some(([url]) => /chat\/completions|\/requests(?:\/|$)/.test(String(url)))).toBe(false)
  }, 15_000)

  it.each(['chat', 'avg', 'town', 'ttrpg'] as const)('actual %s authoring deep link shows saved fields read-only and keeps settings navigation', async kind => {
    sfqa004ChannelV1('local-development')
    const f = await sfqa004HistoricalDraftV1(kind)
    sfqa004ChannelV1('production', true)
    const Page = kind === 'chat' ? (await import('../../src/pages/CharacterChatPage')).default
      : kind === 'avg' ? (await import('../../src/pages/AvgPage')).default
        : kind === 'town' ? (await import('../../src/pages/AiTownPage')).default
          : (await import('../../src/pages/TtrpgPage')).default
    const host = await renderPage(Page, `/${kind}/vision?project=${f.scope.projectId}&work=${f.scope.workId}`)
    await waitForRenderedPage(() => expect(host.querySelector<HTMLFieldSetElement>('fieldset.avg-form')?.disabled).toBe(true))
    expect(host.textContent).toContain('当前产品尚未开放创作')
    const savedTitle = (await db.works.get(f.scope.workId))!.title
    await waitForRenderedPage(() => expect(host.querySelector<HTMLInputElement>('fieldset.avg-form input')?.value).toBe(savedTitle))
    const settings = Array.from(host.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>('button,a')).find(control => control.textContent?.trim() === '通用设置')!
    expect(settings).toBeDefined()
    await act(async () => settings.click())
    await waitForRenderedPage(() => expect(host.querySelector('[data-testid="004-settings"]')).not.toBeNull())
    expect(await f.read()).toEqual(f.before)
    expect(vi.mocked(fetch).mock.calls.some(([url]) => /chat\/completions|\/requests(?:\/|$)/.test(String(url)))).toBe(false)
  }, 15_000)

  it('longform layout keeps its released steps mode while excluding the unopened Node entry', async () => {
    const Layout = (await import('../../src/components/longform/LongformLayout')).default
    const host = await renderPage(() => createElement(Layout, { section: 'workbench', onSection: () => undefined, onMode: () => undefined, onHome: () => undefined, children: '004 manuscript' }), '/long/workbench')
    expect(host.textContent).toContain('004 manuscript')
    expect(pageButton(host, '分步骤模式').disabled).toBe(false)
    expect(Array.from(host.querySelectorAll('button')).some(button => button.textContent === '节点模式')).toBe(false)
  })

  it.each([false, true])('text-game production deep link keeps its original Studio/history when openWorld is %s and fresh entry is denied', async openWorld => {
    sfqa004ChannelV1('local-development')
    const owned = await seedCurrentProductWorld('004 text-game history')
    sfqa004ChannelV1('production', true)
    const Page = (await import('../../src/pages/TextGameDevelopmentPage')).default
    const host = await renderPage(() => createElement(Page, { openWorld }), `/${openWorld ? 'openworld' : 'adventure'}/production?project=${owned.scope.projectId}&work=${owned.scope.workId}`)
    await waitForRenderedPage(() => expect(host.querySelector('[data-testid="product-production-studio"]')).not.toBeNull())
    expect(host.textContent).toContain('当前产品尚未开放创作')
    expect(Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('新建 Production'))?.disabled).toBe(true)
    expect(vi.mocked(fetch).mock.calls.some(([url]) => /chat\/completions|\/requests(?:\/|$)/.test(String(url)))).toBe(false)
  }, 15_000)

  it('actual Node workspace opens a saved graph read-only while creation/save/run controls stay closed', async () => {
    sfqa004ChannelV1('local-development')
    const owner = await createWorkspace(sfqa004WorkspaceInputV1())
    const id = await useNodeFlowStore.getState().createFlow(owner.scope.projectId, null, { graph: manualNodeGraph() })
    const flow = (await db.nodeFlows.get(id))!
    sfqa004ChannelV1('production', true)
    const Workspace = (await import('../../src/components/node-authoring/NodeAuthoringWorkspace')).default
    const { ToastProvider } = await import('../../src/components/shared/Toast')
    const host = await renderPage(() => createElement(ToastProvider, { children: createElement(Workspace, { project: owner.project, worldGroupId: null }) }), '/long/workbench')
    await waitForRenderedPage(() => expect(host.querySelector<HTMLInputElement>('[aria-label="节点图名称"]')?.value).toBe(flow.name))
    expect(host.textContent).toContain('当前为只读查看')
    expect(host.querySelector<HTMLButtonElement>('[aria-label="新建节点图"]')?.disabled).toBe(true)
    expect(pageButton(host, '保存').disabled).toBe(true)
    const execute = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('运行全部'))
    if (execute) expect(execute.disabled).toBe(true)
    expect(pageButton(host, flow.name).disabled).toBe(false)
    expect(await db.nodeFlows.get(id)).toEqual(flow)
    expect(fetch).not.toHaveBeenCalled()
  }, 15_000)

  it('actual chat consultation keeps its original candidate and latest/cancel actions while fresh send/adopt is disabled', async () => {
    sfqa004ChannelV1('local-development')
    const f = await seedChatConsultationFixtureV2()
    const candidate = await generateChatConsultationV2({ scope: f.scope, request: f.request, runAI: async () => JSON.stringify(f.candidate) })
    sfqa004ChannelV1('production', true)
    const Consultation = (await import('../../src/components/character-interaction/Consultation')).default
    const host = await renderPage(() => createElement(Consultation, { scope: f.scope, draft: f.confirmed, dirty: false, onSource: () => undefined, onProduction: () => undefined }), '/chat/agent')
    await waitForRenderedPage(() => expect(host.textContent).toContain(f.candidate.answer))
    expect(pageButton(host, '发送').disabled).toBe(true)
    expect(pageButton(host, '采用勾选的修改').disabled).toBe(true)
    expect(pageButton(host, '查看最新结果').disabled).toBe(false)
    expect(pageButton(host, '结束本次讨论').disabled).toBe(false)
    await act(async () => pageButton(host, '查看最新结果').click())
    await waitForRenderedPage(() => expect(pageButton(host, '结束本次讨论').disabled).toBe(false))
    await act(async () => pageButton(host, '结束本次讨论').click())
    await waitForRenderedPage(() => expect(host.textContent).toContain('本次讨论已结束'))
    expect((await readChatConsultationV2(f.scope, candidate.runId)).candidateHash).toBe(candidate.candidateHash)
    expect(await readChatDraftV1(f.scope)).toEqual(f.confirmed)
    expect(fetch).not.toHaveBeenCalled()
  }, 15_000)

  it.each(['editor', 'workspace'] as const)('the native AVG %s writer rejects fresh production revisions under its original owner/CAS path', async mode => {
    sfqa004ChannelV1('local-development')
    const f = await sfqa004HistoricalDraftV1('avg')
    const write = () => mode === 'editor' ? saveAvgEditorV1(f.scope, f.before.revision, 'a'.repeat(64), avgEditorPackage())
      : saveAvgAuthorWorkspaceV1(f.scope, f.before.revision, createAvgAuthoringPresetV1())
    sfqa004ChannelV1('production', true)
    await expect(write()).rejects.toThrow('product-catalog')
    expect(await f.read()).toEqual(f.before)
    sfqa004ChannelV1('local-development')
    const saved = await write()
    expect(saved.revision).toBe(f.before.revision + 1)
    expect(saved.editorJson).toBeTruthy()
    await expect(write()).rejects.toThrow(/其他页面修改/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('native AVG media intake cannot allocate new blob/asset rows in production, while existing media remains readable', async () => {
    sfqa004ChannelV1('local-development')
    const f = await sfqa004HistoricalDraftV1('avg')
    const input = { scope: f.scope, data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer,
      mimeType: 'image/png', name: '004 controlled intake bytes', kind: 'background' as const,
      license: '004 engineering fixture', altText: '004 imported source', characterTag: '' }
    sfqa004ChannelV1('production', true)
    const counts = async () => [await db.mediaBlobObjects.count(), await db.avgDraftMedia.count()]
    const before = await counts()
    await expect(importAvgMediaV1(input)).rejects.toThrow('product-catalog')
    expect(await counts()).toEqual(before)
    sfqa004ChannelV1('local-development')
    await importAvgMediaV1(input)
    const saved = await counts()
    sfqa004ChannelV1('production')
    expect((await listAvgDraftMediaV1(f.scope)).items.length).toBe(1)
    expect(await counts()).toEqual(saved)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('native AVG author artifact staging preserves its exact pending candidate replay but denies a fresh artifact version', async () => {
    sfqa004ChannelV1('local-development')
    const f = await seedAvgAuthorArtifacts()
    const original = await stageAuthorFixture(f, 0)
    const before = await db.productBuildArtifacts.toArray()
    sfqa004ChannelV1('production', true)
    expect(await stageAuthorFixture(f, 0)).toEqual(original)
    const payload = JSON.parse(original.payloadJson)
    payload.goal = '004 author explicitly revises the original production goal'
    await expect(stageAuthorFixture(f, 0, payload)).rejects.toThrow('product-catalog')
    expect(await db.productBuildArtifacts.toArray()).toEqual(before)
    sfqa004ChannelV1('local-development')
    expect((await stageAuthorFixture(f, 0, payload)).version).toBe(original.version + 1)
    expect(fetch).not.toHaveBeenCalled()
  }, 15_000)

  function ttrpgDistribution() {
    const bundle = JSON.parse(readFileSync('public/games/fog-harbor/game.json', 'utf8')) as ProductDistributionBundleV2
    const catalog = JSON.parse(readFileSync('public/games/catalog.json', 'utf8'))
    const game = parseCommunityTtrpgCatalogV1(catalog).find(item => item.key === 'fog-harbor')!
    return { bundle, game }
  }

  it('the actual frozen community TTRPG installs in production and creates separate player saves without author authority', async () => {
    const { game, bundle } = ttrpgDistribution()
    const first = await startCommunityTtrpgGameV1(game, bundle)
    const second = await startCommunityTtrpgGameV1(game, bundle)
    const session = (await db.productRuntimeSessions.get(first))!
    expect(second).not.toBe(first)
    expect((await db.productRuntimeSessions.get(second))!.productReleaseId).toBe(session.productReleaseId)
    expect(await roots()).toEqual({ projects: 1, worlds: 1, works: 1 })
    expect(await db.worldReleases.count()).toBe(0)
    expect(await db.productBuilds.count()).toBe(0)
    const scope = { projectId: session.projectId, worldId: session.worldId!, workId: session.workId! }
    await expect(createWorldWork(scope.projectId, { title: '004 install is not creation permission', kind: 'ttrpg' })).rejects.toThrow('product-catalog')
    await expect(executeProductProductionCommand({ scope, command: { type: 'create-intent', commandId: '004.install.intent',
      productionKey: '004.install', productType: 'ttrpg', worldReleaseId: 1, userText: 'new authoring' } })).rejects.toThrow('product-catalog')
    expect(fetch).not.toHaveBeenCalled()
  }, 30_000)

  it('frozen TTRPG rejects altered catalog identity and tampered bundle with zero owner roots', async () => {
    const { game, bundle } = ttrpgDistribution()
    await expect(startCommunityTtrpgGameV1({ ...game, bundleHash: 'a'.repeat(64) }, bundle)).rejects.toThrow('不匹配')
    const tampered = structuredClone(bundle); tampered.productRelease.manifest.productType = 'ai-town'
    await expect(startCommunityTtrpgGameV1(game, tampered)).rejects.toThrow()
    await expect(createWorkspaceForProductDistributionV1(sfqa004WorkspaceInputV1(), {
      bundle, expectedBundleHash: bundle.bundleHash, expectedProductType: 'ai-town',
    })).rejects.toThrow('身份')
    expect(await roots()).toEqual({ projects: 0, worlds: 0, works: 0 })
  }, 30_000)

  it('TTRPG freezes the raw bundle and catalog before its first await', async () => {
    const { game, bundle } = ttrpgDistribution()
    const originalHash = bundle.productRelease.contentHash
    const pending = startCommunityTtrpgGameV1(game, bundle)
    game.bundleHash = 'a'.repeat(64); game.title = '004 mutated metadata'
    bundle.productRelease.manifest.runtimePackage.definition.title = '004 mutated payload'
    const id = await pending
    const session = (await db.productRuntimeSessions.get(id))!
    expect((await db.productReleases.get(session.productReleaseId!))!.contentHash).toBe(originalHash)
    expect((await db.projects.get(session.projectId))!.name).not.toContain('mutated')
  }, 30_000)

  it('standalone Adventure installs and reuses its real immutable release in production', async () => {
    const candidate = await createTextAdventureCommunityPackageFixtureV1()
    const first = await installAdventureWebPackageV1(candidate)
    const session = await createTextAdventureInstance({ scope: first.scope, productReleaseId: first.release.id!, title: '004 preserved player' })
    expect((await readProductRuntimeState(session.id!)).adventure?.currentLocationKey).toBeTruthy()
    const second = await installAdventureWebPackageV1(candidate)
    expect(second.scope).toEqual(first.scope)
    expect(second.release.id).toBe(first.release.id)
    expect(await db.worldReleases.count()).toBe(0)
    expect(await db.productBuilds.count()).toBe(0)
    expect(await db.agentRuns.count()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  }, 30_000)

  it('Adventure rejects forged review evidence and expected identity without allocating roots', async () => {
    const candidate = await createTextAdventureCommunityPackageFixtureV1()
    const tampered = structuredClone(candidate); tampered.evidence.gateReceipts[0]!.status = 'failed'
    await expect(installAdventureWebPackageV1(tampered)).rejects.toThrow()
    await expect(createWorkspaceForAdventureWebPackageV1(sfqa004WorkspaceInputV1(), {
      package: candidate, expectedCandidatePackageHash: 'a'.repeat(64),
    })).rejects.toThrow('身份')
    expect(await roots()).toEqual({ projects: 0, worlds: 0, works: 0 })
  }, 30_000)

  it('Adventure installs the captured package even if the caller mutates its raw review evidence', async () => {
    const candidate = await createTextAdventureCommunityPackageFixtureV1()
    const expectedHash = candidate.distributionBundle.productRelease.contentHash
    const pending = installAdventureWebPackageV1(candidate)
    candidate.evidence.gateReceipts[0]!.status = 'failed'
    expect((await pending).release.contentHash).toBe(expectedHash)
  }, 30_000)

  async function townDistribution() {
    sfqa004ChannelV1('local-development')
    const fixture = await seedAiTownRuntimeFixture()
    const manifest = await createFixtureProductReleaseManifestV1({ runtimePackage: parseProductRuntimePackageV1(fixture.preview.runtimePackage) })
    const body = { schema: 'storyforge.product-distribution-bundle' as const, version: 2 as const,
      productRelease: { manifest, contentHash: await hashProductProductionValueV2(manifest) },
      sourceWorld: { contentHash: manifest.sourceWorldRelease.contentHash }, media: [] }
    const bundle = { ...body, bundleHash: await hashProductProductionValueV2(body) }
    await db.delete(); await db.open(); sfqa004ChannelV1('production')
    return bundle
  }

  async function renderGallery(bundle: ProductDistributionBundleV2) {
    const catalog = JSON.parse(readFileSync('public/prototypes/catalog.json', 'utf8'))
    vi.mocked(fetch).mockImplementation(async target => new Response(JSON.stringify(
      String(target).endsWith('/catalog.json') ? catalog : bundle,
    ), { headers: { 'content-type': 'application/json' } }))
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
    const host = document.createElement('div'); document.body.append(host)
    gallery = { host, root: createRoot(host) }
    await act(async () => gallery!.root.render(createElement(CommunityPrototypeGallery, { productType: 'ai-town' })))
    return host
  }

  async function importGallery(host: HTMLDivElement, expectedText: string) {
    await act(async () => {
      await vi.waitFor(() => expect([...host.querySelectorAll('button')].some(button => button.textContent === '导入原型并准备游玩')).toBe(true))
      ;[...host.querySelectorAll('button')].find(button => button.textContent === '导入原型并准备游玩')!.click()
    })
    await vi.waitFor(async () => {
      await act(async () => { await Promise.resolve() })
      expect(host.textContent).toContain(expectedText)
    })
  }

  it('the real prototype gallery imports a verified AI-town runtime copy in production', async () => {
    const bundle = await townDistribution()
    const host = await renderGallery(bundle)
    await importGallery(host, '已导入；现在可以创建自己的小镇存档')
    expect(await roots()).toEqual({ projects: 1, worlds: 1, works: 1 })
    expect((await db.works.toArray())[0]!.kind).toBe('ai-town')
    expect((await db.productReleases.toArray())[0]!.contentHash).toBe(bundle.productRelease.contentHash)
    expect(await db.worldReleases.count()).toBe(0)
    expect(await db.productBuilds.count()).toBe(0)
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).includes('/prototypes/'))).toBe(true)
  }, 30_000)

  it('the real prototype gallery rejects a different valid product before creating owner roots', async () => {
    const host = await renderGallery(ttrpgDistribution().bundle)
    await importGallery(host, '原型产品与目录身份不一致。')
    expect(await roots()).toEqual({ projects: 0, worlds: 0, works: 0 })
    expect(await db.productReleases.count()).toBe(0)
  }, 30_000)

  it('the real prototype gallery rejects a tampered frozen hash before creating any owner roots', async () => {
    const bundle = ttrpgDistribution().bundle
    bundle.bundleHash = 'a'.repeat(64)
    const host = await renderGallery(bundle)
    await importGallery(host, '分发包 bundleHash 不一致')
    expect(await roots()).toEqual({ projects: 0, worlds: 0, works: 0 })
    expect(await db.productReleases.count()).toBe(0)
  }, 30_000)

  it('a failed prototype import retries inside the same empty owner without granting a new authoring permission', async () => {
    const bundle = await townDistribution()
    vi.spyOn(distributionBundle, 'importMarketplaceProductDistributionV2').mockRejectedValueOnce(new Error('004 controlled install failure'))
    const host = await renderGallery(bundle)
    await importGallery(host, '004 controlled install failure')
    expect(await roots()).toEqual({ projects: 1, worlds: 1, works: 1 })
    expect(await db.productReleases.count()).toBe(0)
    await importGallery(host, '已导入；现在可以创建自己的小镇存档')
    expect(await roots()).toEqual({ projects: 1, worlds: 1, works: 1 })
    expect(await db.productReleases.count()).toBe(1)
    const work = (await db.works.toArray())[0]!
    await expect(createWorldWork(work.projectId, { title: '004 no new authoring permission', kind: 'ai-town' })).rejects.toThrow('product-catalog')
  }, 30_000)
})

describe('SFQA004 · actual navigation follows catalog maturity', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  it.each([
    ['http://localhost:4178/storyforge/', 'local-development'],
    ['http://127.0.0.1:4178/storyforge/', 'local-development'],
    ['http://[::1]:4178/storyforge/', 'local-development'],
    ['https://localhost.evil.example/storyforge/', 'production'],
    ['https://127.0.0.1.evil.example/storyforge/', 'production'],
  ] as const)('actual browser hostname %s stays in %s', async (url, expectedChannel) => {
    window.location.href = url
    vi.resetModules()
    const { currentProductCatalogChannelV1 } = await import('../../src/lib/product/product-catalog')
    expect(currentProductCatalogChannelV1()).toBe(expectedChannel)
    const { PRODUCT_NAVIGATION } = await import('../../src/components/navigation/product-navigation')
    expect(PRODUCT_NAVIGATION.some(item => item.id === 'chat')).toBe(expectedChannel === 'local-development')
  })

  it('an unregistered actual navigation entry fails closed rather than inheriting home access', async () => {
    sfqa004ChannelV1('production')
    vi.resetModules()
    const { products } = await import('../../ui-preview/src/catalog')
    products.push({ ...products[0]!, id: 'unregistered-product' })
    await expect(import('../../src/components/navigation/product-navigation')).rejects.toThrow('未登记的导航产品')
  })

  it('blocked experimental storage keeps the local preview usable without enabling the marketplace', async () => {
    vi.stubGlobal('window', { location: { hostname: 'localhost' }, localStorage: { getItem: () => { throw new Error('controlled storage denial') } } })
    vi.resetModules()
    const { PRODUCT_NAVIGATION } = await import('../../src/components/navigation/product-navigation')
    expect(PRODUCT_NAVIGATION.some(item => item.id === 'chat')).toBe(true)
    expect(PRODUCT_NAVIGATION.some(item => item.id === 'community')).toBe(false)
  })

  it.each([
    ['production', false], ['production', true],
    ['local-development', false], ['local-development', true],
  ] as const)('%s navigation with opt-in %s uses every actual product identity', async (channel, optIn) => {
    sfqa004ChannelV1(channel, optIn)
    vi.resetModules()
    const { PRODUCT_NAVIGATION } = await import('../../src/components/navigation/product-navigation')
    const { evaluateProductEntryV1 } = await import('../../src/lib/product/product-catalog')
    const actualIds = PRODUCT_NAVIGATION.map(item => item.id)
    expect(actualIds.slice(0, 7)).toEqual(['home', 'world', 'long', 'short', 'script', 'comic', 'motion'])
    for (const [navigationId, productId] of SFQA004_UPPER_ENTRIES) {
      expect(actualIds.includes(navigationId), productId).toBe(evaluateProductEntryV1({ productId, channel, experimentalOptIn: optIn }).visible)
    }
    expect(actualIds.includes('community')).toBe(evaluateProductEntryV1({ productId: 'platform.marketplace', channel, experimentalOptIn: optIn }).visible)
  })

  it('non-browser test entry keeps previews while requiring explicit experimental opt-in', async () => {
    vi.stubGlobal('window', undefined)
    vi.resetModules()
    const { PRODUCT_NAVIGATION } = await import('../../src/components/navigation/product-navigation')
    const { currentProductCatalogChannelV1 } = await import('../../src/lib/product/product-catalog')
    expect(currentProductCatalogChannelV1()).toBe('test')
    expect(PRODUCT_NAVIGATION.map(item => item.id)).toEqual([
      'home', 'world', 'long', 'short', 'script', 'comic', 'motion', ...SFQA004_UPPER_ENTRIES.map(([id]) => id),
    ])
  })
})
