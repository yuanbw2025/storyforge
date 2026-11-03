import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { TtrpgProductionSeatV2 } from '../../src/lib/types'
import { readProductRuntimeState, readProductRuntimeStateVersion } from '../../src/lib/product/runtime-core'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import { authoredImagePackAdapterV1, type MediaProviderTransportV1 } from '../../src/lib/product-production/media-adapters'
import { sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import { configureTtrpgSessionParticipantV2, readTtrpgSessionParticipantsV2 } from '../../src/lib/ttrpg/participants'
import { completeTtrpgSessionZero, discoverTtrpgClue, openTtrpgCampaignScene } from '../../src/lib/ttrpg/runtime-commands'
import { enqueueTtrpgRuntimeAssetRequestV1, processTtrpgRuntimeAssetRequestV1, readTtrpgRuntimeMediaBlobV1, readVisibleTtrpgRuntimeMediaRequestsV1 } from '../../src/lib/ttrpg/runtime-media'
import { createTtrpgViewerProjectionV1 } from '../../src/lib/ttrpg/viewer-projection'
import { seedCurrentProductWorld, loadCurrentProductWorldSourceCatalogV1 } from '../helpers/current-product-world'
import { createCurrentTtrpgRuntimePackageFixture } from '../helpers/current-ttrpg-runtime-package'
import { seedCurrentProductBuild } from '../helpers/current-product-build'

const PLAYER = 'viewer.player.1', OTHER = 'viewer.player.2', GM = 'viewer.gm'
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8WgWQAAAABJRU5ErkJggg=='), ch => ch.charCodeAt(0)).buffer
async function ready() {
  const owner = await seedCurrentProductWorld('SFQA091 governed media disclosure')
  if (!owner.release.id) throw new Error('Expected the frozen WorldRelease')
  const worldRelease = { ...owner.release, id: owner.release.id }
  const sourceCatalog = await loadCurrentProductWorldSourceCatalogV1({ scope: owner.scope, worldReleaseId: worldRelease.id, productType: 'ttrpg' })
  const source = sourceCatalog.characters[0]
  if (!source) throw new Error('Expected a world character')
  const seats: TtrpgProductionSeatV2[] = [1, 2].map(index => ({ seatKey: `player.${index}`, label: `Player ${index}`, controller: 'human', role: 'player',
    characterMode: index === 1 ? 'world-template' : 'quick-card', sourceCharacterResourceKey: index === 1 ? source.resourceKey : null,
    characterName: `${source.name} ${index}`, rankTier: index === 1 ? null : 'B', privateGoal: '保留自己的选择。' }))
  let runtimePackage = await createCurrentTtrpgRuntimePackageFixture({ scope: owner.scope, worldRelease, sourceCatalog,
    playerController: 'human', gmMode: 'human', authoredScenario: true, seats })
  if (!runtimePackage.ttrpg) throw new Error('Expected scripted TTRPG content')
  const campaign = runtimePackage.ttrpg.campaign, opening = campaign.scenes.find(row => row.sceneKey === campaign.openingSceneKey)
  const future = campaign.scenes.find(row => opening?.nextSceneKeys.includes(row.sceneKey)), clue = campaign.clues[0]
  const players = campaign.characterTemplates.filter(row => row.role === 'player')
  if (!opening || !future || !clue || players.length !== 2 || !campaign.mediaManifest) throw new Error('Expected real authored disclosure targets')
  campaign.handouts.push({ handoutKey: 'handout.sfqa091', title: '尚未发现的手记', body: '线索揭示后的正文', revealClueKey: clue.clueKey, assetKey: null, fallbackText: '尚未发现的手记正文' })
  // A legal author-configured media policy is frozen before the public Build.
  // No runtime rule or viewer-disclosure condition is mocked or replaced.
  const common = { productionRequired: false, assetKey: null, promptTemplate: '合成测试插图', width: null, height: null }
  campaign.mediaManifest.slots = [
    { ...common, slotKey: 'scene.opening', kind: 'scene', targetRef: opening.sceneKey, audience: 'party', fallbackText: '开场插图描述', altText: '开场插图' },
    { ...common, slotKey: 'scene.future', kind: 'scene', targetRef: future.sceneKey, audience: 'party', fallbackText: 'SPOILER_future_fallback', altText: 'SPOILER_future_alt' },
    { ...common, slotKey: 'handout.hidden', kind: 'handout', targetRef: 'handout.sfqa091', audience: 'party', fallbackText: 'SPOILER_handout_fallback', altText: 'SPOILER_handout_alt' },
    { ...common, slotKey: 'portrait.private', kind: 'character-portrait', targetRef: players[0].characterKey, audience: 'private', fallbackText: '本人私域', altText: '本人私域插图' },
    { ...common, slotKey: 'portrait.gm', kind: 'character-portrait', targetRef: players[0].characterKey, audience: 'gm-only', fallbackText: '仅主持可见', altText: '主持资料插图' },
  ]
  campaign.mediaManifest.runtimePolicy = { ...campaign.mediaManifest.runtimePolicy, enabled: true, networkPolicy: 'any', maximumSessionCostUsd: 20, maximumGeneratedAssets: 10 }
  runtimePackage = parseProductRuntimePackageV1(runtimePackage)
  const made = await seedCurrentProductBuild({ scope: owner.scope, worldRelease, runtimePackage, title: 'SFQA091 disclosure', seed: 'sfqa091' })
  if (!made.session.id || !runtimePackage.ttrpg) throw new Error('Expected the real instance')
  const sessionId = made.session.id
  for (const seat of await readTtrpgSessionParticipantsV2(sessionId)) await configureTtrpgSessionParticipantV2({ sessionId, seatKey: seat.seatKey,
    expectedRevision: seat.revision, commandId: `consent.${seat.seatKey}`, requestedByViewerKey: seat.viewerKey,
    assignmentState: 'claimed', consent: { aiIdentityDisclosed: true, generatedPortraitAllowed: true } })
  const envelope = async (commandId: string) => { const v = await readProductRuntimeStateVersion(sessionId); return { sessionId, commandId, baseSequence: v.sequence, baseStateHash: v.stateHash } }
  const initial = await readProductRuntimeState(sessionId)
  if (!initial.ttrpg) throw new Error('Expected a TTRPG state')
  await completeTtrpgSessionZero({ ...await envelope('zero'), acceptedItemKeys: initial.ttrpg.product.sessionZero.requiredItemKeys, selectedCharacterKeys: players.map(row => row.characterKey), completedBy: GM })
  const adapter = { ...authoredImagePackAdapterV1, estimate: vi.fn(authoredImagePackAdapterV1.estimate), generate: vi.fn(authoredImagePackAdapterV1.generate) }
  const request = (slotKey: string, viewerKey = PLAYER) => enqueueTtrpgRuntimeAssetRequestV1({ sessionId, viewerKey, slotKey,
    requestKey: `${slotKey}.${viewerKey}`, adapterId: adapter.capability.adapterId, adapter, environment: 'test' })
  return { ...owner, ...made, sessionId, ttrpg: runtimePackage.ttrpg, players, opening, future, clue, envelope, adapter, request }
}
async function projection(f: Awaited<ReturnType<typeof ready>>, viewerKey: string) {
  const participant = (await readTtrpgSessionParticipantsV2(f.sessionId)).find(row => row.viewerKey === viewerKey)
  if (!participant) throw new Error('Expected the current viewer')
  return createTtrpgViewerProjectionV1({ state: await readProductRuntimeState(f.sessionId), campaign: f.ttrpg.campaign,
    rulePack: f.ttrpg.rulePack.content, role: participant.role, actorKey: participant.actorKey })
}

beforeEach(async () => {
  await db.delete(); await db.open()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new Error('No real provider or network authorized') }))
})
afterEach(() => {
  try { expect(fetch).not.toHaveBeenCalled() }
  finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() }
})

describe('SFQA091 public runtime-media disclosure follows the real viewer projection', () => {
  it('cannot enqueue an unopened scene even with party audience or a plausible slot key', async () => {
    const f = await ready(), before = await readProductRuntimeState(f.sessionId)
    expect((await projection(f, PLAYER)).media?.slots.some(slot => slot.slotKey === 'scene.future')).toBe(false)
    await expect(f.request('scene.future')).rejects.toThrow(/可见/)
    await expect(f.request('scene.opening')).rejects.toThrow(/可见/)
    expect(f.adapter.estimate).not.toHaveBeenCalled()
    expect(f.adapter.generate).not.toHaveBeenCalled()
    expect(await db.ttrpgRuntimeAssetRequests.count()).toBe(0)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  })

  it('hides an already generated future-scene queue and its bytes until that real scene opens', async () => {
    const f = await ready(), row = await f.request('scene.future', GM)
    if (!row.id) throw new Error('Expected the real GM queue row')
    const hash = await sha256MediaData(PNG)
    const transport: MediaProviderTransportV1 = { executionLocation: 'browser-direct', request: vi.fn(async request => ({
      status: 200, contentType: 'image/png', body: PNG,
      json: { packId: 'sfqa091', packVersion: 1, artifactKey: request.body.artifactKey, fileName: 'synthetic.png', declaredContentHash: hash,
        mimeType: 'image/png', width: 1, height: 1, title: 'Synthetic disclosure control', altText: 'Synthetic image', license: 'CC0-1.0', commercialUse: false, source: 'synthetic' },
      providerRequestId: 'sfqa091.local', usage: null, costUsd: 0,
    })) }
    const done = await processTtrpgRuntimeAssetRequestV1({ requestId: row.id, adapter: f.adapter, transport, environment: 'test' })
    expect(done.status).toBe('available')
    if (!done.mediaAssetId) throw new Error('Expected the actual governed media binding')
    const read = { scope: f.scope, sessionId: f.sessionId, mediaAssetId: done.mediaAssetId }
    expect(await readVisibleTtrpgRuntimeMediaRequestsV1({ sessionId: f.sessionId, viewerKey: PLAYER })).toEqual([])
    await expect(readTtrpgRuntimeMediaBlobV1({ ...read, viewerKey: PLAYER })).rejects.toThrow(/不能读取/)
    expect(await (await readTtrpgRuntimeMediaBlobV1({ ...read, viewerKey: GM })).arrayBuffer()).toEqual(PNG)
    await openTtrpgCampaignScene({ ...await f.envelope('opening'), sceneKey: f.opening.sceneKey })
    expect(JSON.stringify(await readVisibleTtrpgRuntimeMediaRequestsV1({ sessionId: f.sessionId, viewerKey: PLAYER }))).not.toContain('SPOILER')
    await openTtrpgCampaignScene({ ...await f.envelope('future'), sceneKey: f.future.sceneKey })
    expect((await projection(f, PLAYER)).media?.slots.some(slot => slot.slotKey === row.slotKey)).toBe(true)
    expect((await readVisibleTtrpgRuntimeMediaRequestsV1({ sessionId: f.sessionId, viewerKey: PLAYER })).map(item => item.requestKey)).toEqual([row.requestKey])
    db.close(); await db.open()
    expect(await (await readTtrpgRuntimeMediaBlobV1({ ...read, viewerKey: PLAYER })).arrayBuffer()).toEqual(PNG)
    const player = (await readTtrpgSessionParticipantsV2(f.sessionId)).find(item => item.viewerKey === PLAYER)
    if (!player?.id) throw new Error('Expected the current participant')
    await db.ttrpgSessionParticipants.update(player.id, { assignmentState: 'left', revision: player.revision + 1 })
    expect(await readVisibleTtrpgRuntimeMediaRequestsV1({ sessionId: f.sessionId, viewerKey: PLAYER })).toEqual([])
    await expect(readTtrpgRuntimeMediaBlobV1({ ...read, viewerKey: PLAYER })).rejects.toThrow(/不能读取/)
  })

  it('uses the same handout knowledge and private/GM ownership boundary for enqueue and historical rows', async () => {
    const f = await ready()
    await openTtrpgCampaignScene({ ...await f.envelope('opening'), sceneKey: f.opening.sceneKey })
    const hidden = await f.request('handout.hidden', GM), privateRow = await f.request('portrait.private'), gmRow = await f.request('portrait.gm', GM)
    await expect(f.request('handout.hidden')).rejects.toThrow(/可见/)
    await expect(f.request('portrait.private', OTHER)).rejects.toThrow(/权限|可见/)
    await expect(f.request('portrait.gm')).rejects.toThrow(/权限|可见/)
    expect((await readVisibleTtrpgRuntimeMediaRequestsV1({ sessionId: f.sessionId, viewerKey: PLAYER })).map(row => row.requestKey)).toEqual([privateRow.requestKey])
    expect(await readVisibleTtrpgRuntimeMediaRequestsV1({ sessionId: f.sessionId, viewerKey: OTHER })).toEqual([])
    await discoverTtrpgClue({ ...await f.envelope('discover.private'), clueKey: f.clue.clueKey, actorKey: f.players[0].characterKey, visibility: 'private' })
    expect((await readVisibleTtrpgRuntimeMediaRequestsV1({ sessionId: f.sessionId, viewerKey: PLAYER })).some(row => row.requestKey === hidden.requestKey)).toBe(true)
    expect((await readVisibleTtrpgRuntimeMediaRequestsV1({ sessionId: f.sessionId, viewerKey: OTHER })).some(row => row.requestKey === hidden.requestKey)).toBe(false)
    await discoverTtrpgClue({ ...await f.envelope('discover.party'), clueKey: f.clue.clueKey, actorKey: f.players[0].characterKey, visibility: 'party' })
    expect((await readVisibleTtrpgRuntimeMediaRequestsV1({ sessionId: f.sessionId, viewerKey: OTHER })).map(row => row.requestKey)).toEqual([hidden.requestKey])
    expect((await readVisibleTtrpgRuntimeMediaRequestsV1({ sessionId: f.sessionId, viewerKey: GM })).map(row => row.requestKey)).toEqual([hidden.requestKey, privateRow.requestKey, gmRow.requestKey])
    if (!hidden.id) throw new Error('Expected the original queue')
    await db.ttrpgRuntimeAssetRequests.update(hidden.id, { targetRef: f.future.sceneKey, audience: 'public' })
    expect((await readVisibleTtrpgRuntimeMediaRequestsV1({ sessionId: f.sessionId, viewerKey: OTHER })).map(row => row.requestKey)).toEqual([])
  })
})
