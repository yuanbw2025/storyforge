import type { TtrpgProductionSeatV2 } from '../../src/lib/types'
import { readProductRuntimeState, readProductRuntimeStateVersion } from '../../src/lib/product/runtime-core'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import { authoredImagePackAdapterV1, type MediaProviderTransportV1 } from '../../src/lib/product-production/media-adapters'
import { configureTtrpgSessionParticipantV2, readTtrpgSessionParticipantsV2 } from '../../src/lib/ttrpg/participants'
import { completeTtrpgSessionZero, openTtrpgCampaignScene } from '../../src/lib/ttrpg/runtime-commands'
import { enqueueTtrpgRuntimeAssetRequestV1, processTtrpgRuntimeAssetRequestV1 } from '../../src/lib/ttrpg/runtime-media'
import { seedCurrentProductWorld, loadCurrentProductWorldSourceCatalogV1 } from './current-product-world'
import { createCurrentTtrpgRuntimePackageFixture } from './current-ttrpg-runtime-package'
import { seedCurrentProductBuild } from './current-product-build'

export const GM = 'viewer.gm'
export const SLOT = 'scene.opening'

export async function seedTtrpgRuntimeMediaAttemptFixtureV1() {
  const owner = await seedCurrentProductWorld('082/083 isolated runtime media attempt')
  if (!owner.release.id) throw new Error('Expected a real WorldRelease')
  const worldRelease = { ...owner.release, id: owner.release.id }
  const sourceCatalog = await loadCurrentProductWorldSourceCatalogV1({ scope: owner.scope,
    worldReleaseId: worldRelease.id, productType: 'ttrpg' })
  const source = sourceCatalog.characters[0]!
  const seats: TtrpgProductionSeatV2[] = [1, 2].map(index => ({ seatKey: `player.${index}`, label: `Player ${index}`,
    controller: 'human', role: 'player', characterMode: index === 1 ? 'world-template' : 'quick-card',
    sourceCharacterResourceKey: index === 1 ? source.resourceKey : null, characterName: `${source.name} ${index}`,
    rankTier: index === 1 ? null : 'B', privateGoal: '保留自己的选择。' }))
  const runtimePackage = await createCurrentTtrpgRuntimePackageFixture({ scope: owner.scope, worldRelease, sourceCatalog,
    playerController: 'human', gmMode: 'human', authoredScenario: true, seats })
  const campaign = runtimePackage.ttrpg!.campaign
  campaign.mediaManifest!.slots = [{ slotKey: SLOT, kind: 'scene', targetRef: campaign.openingSceneKey, audience: 'party',
    productionRequired: false, assetKey: null, promptTemplate: '隔离媒资测试', width: null, height: null,
    fallbackText: '开场插图说明', altText: '开场插图' }]
  campaign.mediaManifest!.runtimePolicy = { ...campaign.mediaManifest!.runtimePolicy,
    enabled: true, networkPolicy: 'any', maximumSessionCostUsd: 10, maximumGeneratedAssets: 10 }
  const made = await seedCurrentProductBuild({ scope: owner.scope, worldRelease, title: '082/083 durable attempt',
    runtimePackage: parseProductRuntimePackageV1(runtimePackage) })
  const sessionId = made.session.id!
  for (const seat of await readTtrpgSessionParticipantsV2(sessionId)) await configureTtrpgSessionParticipantV2({
    sessionId, seatKey: seat.seatKey, expectedRevision: seat.revision, commandId: `consent.${seat.seatKey}`,
    requestedByViewerKey: seat.viewerKey, assignmentState: 'claimed',
    consent: { aiIdentityDisclosed: true, generatedPortraitAllowed: true },
  })
  const envelope = async (commandId: string) => { const version = await readProductRuntimeStateVersion(sessionId)
    return { sessionId, commandId, baseSequence: version.sequence, baseStateHash: version.stateHash } }
  const initial = await readProductRuntimeState(sessionId)
  await completeTtrpgSessionZero({ ...await envelope('zero'), completedBy: GM,
    acceptedItemKeys: initial.ttrpg!.product!.sessionZero.requiredItemKeys,
    selectedCharacterKeys: campaign.characterTemplates.filter(row => row.role === 'player').map(row => row.characterKey) })
  await openTtrpgCampaignScene({ ...await envelope('opening'), sceneKey: campaign.openingSceneKey })
  const adapter = authoredImagePackAdapterV1
  const row = await enqueueTtrpgRuntimeAssetRequestV1({ sessionId, viewerKey: GM, slotKey: SLOT,
    requestKey: 'isolated.runtime.attempt', adapterId: adapter.capability.adapterId, adapter,
    environment: 'test', maximumRequestCostUsd: 5 })
  return { scope: owner.scope, sessionId, row, adapter, execute: (transport: MediaProviderTransportV1) => processTtrpgRuntimeAssetRequestV1({
    requestId: row.id!, adapter, transport, environment: 'test',
  }) }
}
