import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatMediaGallery } from '../../src/components/character-interaction/ChatMedia'
import { useChatMedia } from '../../src/components/character-interaction/useChatMedia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as events from '../../src/lib/agent/run/event-store'
import * as checkpoints from '../../src/lib/agent/run/checkpoint'
import * as artifacts from '../../src/lib/memory/artifact-store'
import * as runtimeMedia from '../../src/lib/product/runtime-media-library'
import { db } from '../../src/lib/db/schema'
import {
  commitChatNarrativeAction, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger, startInteractionScene,
} from '../../src/lib/character-interaction/runtime-api'
import {
  generateChatRuntimeVisualsV1, latestChatVisualJobsV1, readChatRuntimeVisualJobsV1,
} from '../../src/lib/character-interaction/runtime-visuals'
import { readResumableInteractionRunsV1 } from '../../src/lib/character-interaction/runtime-run-recovery'
import { resolveProductMediaProviderAdapterV1, type RedactedMediaTransportRequestV1 } from '../../src/lib/product-production/media-adapters'
import { readProductMediaBlobData } from '../../src/lib/product-production/media-blob-store'
import type { ResolvedProductMediaCapabilityV1 } from '../../src/lib/product-production/media-transport'
import { createCharacterInteractionInstance } from '../../src/lib/product/runtime-instances'
import { AIError } from '../../src/lib/types'
import type { ChatNarrativeActionV1 } from '../../src/lib/types/chat-narrative'
import { seedChatMediaPlayerFixture } from '../helpers/chat-media-fixture'
import { chatActionReviewFixture } from '../helpers/chat-narrative-fixture'

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(async () => { vi.restoreAllMocks(); db.close(); await db.delete() })

async function playable() {
  const f = await seedChatMediaPlayerFixture({dynamic: true})
  const session = await createCharacterInteractionInstance({scope: f.scope, productReleaseId: f.releaseId, title: '动态配图测试'})
  const envelope = async (commandId: string) => {const v = await readProductRuntimeStateVersion(session.id!); return {sessionId: session.id!, commandId, baseSequence: v.sequence, baseStateHash: v.stateHash}}
  const scene = await startInteractionScene({...await envelope('start'), sceneId: 'inn.current', sceneKey: 'inn'})
  const trigger = await requestChatNarrativeTrigger({...await envelope('trigger'), kind: 'scene-start', sourceEventSequence: scene.sequence})
  const action: ChatNarrativeActionV1 = {kind: 'complete', text: '叶岑检查了后门。后门闩完好，没有撬动痕迹。他把看到的情况告诉了两人。', goalKey: 'find-seal',
    evidenceFactKeys: ['lost'], audienceKeys: ['player', 'guard', 'artisan'], waitingForPlayer: false,
    newFacts: [{factKey: 'door-checked', kind: 'observation', text: '后门闩完好，没有撬动痕迹。', evidenceFactKeys: ['lost'], evidenceExcerpt: '后门闩完好，没有撬动痕迹。'}],
    disclosures: [], threadUpdates: [], goalStatus: null}
  const committed = await commitChatNarrativeAction({...await envelope('action'), actorKey: 'guard', triggerSequence: trigger.sequence, messageId: 'inspection', factEvidenceVersion: 1, action, review: chatActionReviewFixture(action)})
  expect(committed.type).toBe('interaction.narrative.action-reviewed.committed')
  return {...f, sessionId: session.id!}
}
function capability(failure: boolean | 'unknown' = false) {
  const outgoing: RedactedMediaTransportRequestV1[] = [], adapterId = 'agnes.image-2.1-flash.v1'
  const value: ResolvedProductMediaCapabilityV1 = {adapter: resolveProductMediaProviderAdapterV1(adapterId),
    binding: {requirementKey: 'chat.runtime.image', adapterId, bindingHash: 'a'.repeat(64)},
    receipt: {schema: 'storyforge.configured-agnes-image-binding-receipt', version: 1, requirementKey: 'chat.runtime.image', adapterId,
      adapterVersion: 1, provider: 'agnes', model: 'agnes-image-2.1-flash', endpointOrigin: 'https://fixture.invalid', executionLocation: 'browser-direct',
      credentialSource: 'existing-ai-config', credentialPresent: true, capabilityHash: 'a'.repeat(64), boundAt: 1, receiptHash: 'b'.repeat(64)},
    transport: {executionLocation: 'browser-direct', request: async request => {
      outgoing.push(request)
      if (failure === 'unknown') throw new Error('transport-outcome-unknown')
      if (failure) throw new AIError(503, 'fixture-provider-unavailable')
      // Complete synthetic 1×1 PNG; verified asset bytes, not header-only test data.
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'), value => value.charCodeAt(0))
      return {status: 200, contentType: 'application/json', body: null, providerRequestId: 'fixture', usage: {}, costUsd: null,
        json: {data: [{b64_json: btoa(String.fromCharCode(...bytes))}]}}
    }}}
  return {value, outgoing}
}


it.each([
  'model.responded', 'candidate.persisted', 'available-checkpoint', 'step.succeeded',
  'verification.started', 'receipt-artifact', 'verification.accepted',
] as const)('reuses the original stored image after a one-shot %s failure', async failurePoint => {
  const f = await playable()
  const provider = capability()
  const input = { scope: f.scope, sessionId: f.sessionId, capability: provider.value }
  const state = await readProductRuntimeStateVersion(f.sessionId)
  const originalAppend = events.appendAgentRunEventV1
  const originalCheckpoint = checkpoints.createAgentRunCheckpointV1
  const originalArtifact = artifacts.recordAgentRunArtifactV1
  let injected = 0
  const failOnce = (point: string) => {
    if (point === failurePoint && injected === 0) {
      injected += 1
      throw Error('SFQA-065 isolated terminal write failed once')
    }
  }
  const seams = [
    vi.spyOn(events, 'appendAgentRunEventV1').mockImplementation(async request => {
      failOnce(request.type)
      return originalAppend(request)
    }),
    vi.spyOn(checkpoints, 'createAgentRunCheckpointV1').mockImplementation(async request => {
      if ((request.resumePayload as {status?: string} | undefined)?.status === 'available') failOnce('available-checkpoint')
      return originalCheckpoint(request)
    }),
    vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(async request => {
      if (request.artifactKind === 'tool-result' && JSON.parse(request.content).receiptHash) failOnce('receipt-artifact')
      return originalArtifact(request)
    }),
  ]
  const first = await generateChatRuntimeVisualsV1(input)
  seams.forEach(seam => seam.mockRestore())
  expect(injected).toBe(1)
  expect(provider.outgoing).toHaveLength(1)
  expect(first).toHaveLength(1)
  const assets = await db.productMediaAssets.where('productRuntimeSessionId').equals(f.sessionId).toArray()
  expect(assets).toHaveLength(1)
  const asset = assets[0]!
  const blob = await db.productMediaBlobs.where('mediaAssetId').equals(asset.id!).first()
  expect((await readProductMediaBlobData({ scope: f.scope, blob: blob!, expected: asset })).byteLength).toBe(69)
  expect(await readResumableInteractionRunsV1(f.scope, f.sessionId)).toEqual([])
  const originalRun = first[0]!.runId
  db.close()
  await db.open()
  const refresh = (await readChatRuntimeVisualJobsV1(f.scope, f.sessionId))[0]!
  await generateChatRuntimeVisualsV1(input)
  const final = await generateChatRuntimeVisualsV1({ ...input, retryFailed: true })
  const current = latestChatVisualJobsV1(final).get(first[0]!.request.key)
  const snapshot = await events.readInstanceAgentRunV1(f.scope, originalRun)
  expect(await readProductRuntimeStateVersion(f.sessionId)).toEqual(state)
  expect({
    refreshAssetId: refresh.asset?.id ?? null,
    repeatedSlotCalls: provider.outgoing.filter(outgoing => outgoing.body.prompt === provider.outgoing[0]!.body.prompt).length,
    allCalls: provider.outgoing.length,
    displayedRun: current?.runId,
    originalRunState: snapshot.projection.state,
  }).toEqual({
    refreshAssetId: asset.id, repeatedSlotCalls: 1, allCalls: 3,
    displayedRun: originalRun, originalRunState: 'completed',
  })
  expect(snapshot.projection.terminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
  for (const type of ['model.requested', 'model.responded', 'candidate.persisted', 'verification.accepted']) {
    expect(snapshot.events.filter(event => event.type === type)).toHaveLength(1)
  }
  const terminalArtifacts = await Promise.all(snapshot.events.flatMap(event => event.type === 'evidence.artifact.recorded'
    && event.payload.artifactKind === 'tool-result' ? [artifacts.readAgentRunArtifactExactV1({
      projectId: f.scope.projectId, artifactKind: 'tool-result', contentHash: event.payload.contentHash,
    }).then(content => JSON.parse(content))] : []))
  expect(terminalArtifacts.filter(body => body.receiptHash).map(body => body.receiptHash))
    .toEqual([snapshot.projection.terminalReceiptHash])
}, 30_000)


it('keeps bytes captured before cancellation owned by their original save', async () => {
  const f = await playable(), provider = capability()
  const other = await createCharacterInteractionInstance({
    scope: f.scope, productReleaseId: f.releaseId, title: '不同存档不继承原图片',
  })
  const controller = new AbortController()
  const original = runtimeMedia.importProductRuntimeMediaAssetV1
  const seam = vi.spyOn(runtimeMedia, 'importProductRuntimeMediaAssetV1').mockImplementation(async input => {
    const asset = await original(input)
    controller.abort()
    return asset
  })
  const input = {scope: f.scope, sessionId: f.sessionId, capability: provider.value}
  const first = await generateChatRuntimeVisualsV1({...input, signal: controller.signal})
  seam.mockRestore()
  expect(controller.signal.aborted).toBe(true)
  expect(provider.outgoing).toHaveLength(1)
  expect(first[0]).toMatchObject({status: 'available', asset: {productRuntimeSessionId: f.sessionId}})
  expect((await events.readInstanceAgentRunV1(f.scope, first[0]!.runId)).projection.state).not.toBe('completed')
  expect(await readChatRuntimeVisualJobsV1(f.scope, other.id!)).toEqual([])
  await generateChatRuntimeVisualsV1(input)
  expect(provider.outgoing).toHaveLength(3)
  expect((await events.readInstanceAgentRunV1(f.scope, first[0]!.runId)).projection.state).toBe('completed')
  expect(await readChatRuntimeVisualJobsV1(f.scope, other.id!)).toEqual([])
}, 30_000)


it('shows the saved image and its local recovery state in the actual gallery without offering a redo', async () => {
  const f = await playable()
  const provider = capability()
  const original = events.appendAgentRunEventV1
  let interrupted = false
  const seam = vi.spyOn(events, 'appendAgentRunEventV1').mockImplementation(async request => {
    if (!interrupted && request.type === 'verification.started') {
      interrupted = true
      throw Error('SFQA-065 isolated terminal write failed once')
    }
    return original(request)
  })
  const first = await generateChatRuntimeVisualsV1({scope: f.scope, sessionId: f.sessionId, capability: provider.value})
  seam.mockRestore()
  const asset = first[0]?.asset
  const session = await db.productRuntimeSessions.get(f.sessionId)
  const interaction = (await readProductRuntimeState(f.sessionId)).interaction
  if (!asset || !session || !interaction) throw Error('gallery fixture is incomplete')
  const before = await events.readInstanceAgentRunV1(f.scope, first[0]!.runId)
  let objectUrls = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:sfqa065-gallery-${++objectUrls}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const Gallery = () => {
    const media = useChatMedia({scope: f.scope, session, interaction, enabled: true})
    return createElement(ChatMediaGallery, {media, id: 'sfqa065-gallery'})
  }
  try {
    await act(async () => { root.render(createElement(Gallery)) })
    const image = () => [...host.querySelectorAll('img')].find(element => element.alt === asset.altText)
    for (let i = 0; !image() && i < 200; i += 1) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    }
    expect(image()?.getAttribute('src')).toMatch(/^blob:sfqa065-gallery-/)
    expect(host.textContent).toContain('原图片已保存')
    expect([...host.querySelectorAll('button')].map(button => button.textContent)).toContain('补齐当前画面')
    expect(host.textContent).not.toContain('重做失败画面')
    expect(provider.outgoing).toHaveLength(1)
    expect((await events.readInstanceAgentRunV1(f.scope, first[0]!.runId)).projection.lastSequence)
      .toBe(before.projection.lastSequence)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
}, 30_000)
