import { seedOpenFixtureReleaseV1 } from './open-ttrpg-release'
import { createProductRuntimeInstanceFromSource } from '../../src/lib/product/runtime-instances'
import { seedCurrentProductWorld } from './current-product-world'
import { seedCurrentProductBuild } from './current-product-build'
import { openRuntimePackageFixture } from './ttrpg-open-package'
import { hashTtrpgFrozenPredicateIndexV1 } from '../../src/lib/ttrpg/content-version'
import { configureTtrpgSessionParticipantV2, readTtrpgSessionParticipantsV2 } from '../../src/lib/ttrpg/participants'
import { readProductRuntimeState, readProductRuntimeStateVersion } from '../../src/lib/product/runtime-core'
import { completeTtrpgOpenSessionZeroV1, startTtrpgOpenRunV1 } from '../../src/lib/ttrpg/runtime-commands'
import type { ProductRuntimePackageWithTtrpgV2 } from '../../src/lib/ttrpg/content-version'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'

export const OPEN_HUMAN_VIEWER = 'viewer.seat.hero'

/** Internal protocol-2 fixture, not evidence of normal author production. */
export async function seedOpenTtrpgSessionV1(title = 'open foundation', configure?: (runtimePackage: ProductRuntimePackageWithTtrpgV2) => void, released = false) {
  const world = await seedCurrentProductWorld(title)
  const runtimePackage = await openRuntimePackageFixture()
  configure?.(runtimePackage)
  const campaign = runtimePackage.ttrpg!.campaign
  if (campaign.version !== 2) throw new Error('fixture requires V2')
  runtimePackage.sourceWorld.contentHash = world.release.contentHash
  campaign.sourceWorld.contentHash = world.release.contentHash
  campaign.sourceWorld.bundleHash = world.release.contentHash
  campaign.frozenWorldPredicateIndex.worldReleaseHash = world.release.contentHash
  campaign.frozenWorldPredicateIndex.indexHash = await hashTtrpgFrozenPredicateIndexV1(campaign.frozenWorldPredicateIndex)
  runtimePackage.ttrpg!.rulePack.contentHash = await hashProductProductionValueV2(runtimePackage.ttrpg!.rulePack.content)
  const result = await seedCurrentProductBuild({ scope: world.scope, worldRelease: world.release,
    runtimePackage, title, seed: 'open.foundation.seed' }, { ttrpgProtocol: 2 })
  const published = released ? await seedOpenFixtureReleaseV1(world.scope, runtimePackage) : null
  const session = published ? await createProductRuntimeInstanceFromSource({ scope: world.scope, source: { kind: 'release', productReleaseId: published.id }, title, seed: 'open.foundation.seed' }) : result.session
  return { ...result, session, published, scope: world.scope, runtimePackage, campaign, sessionId: session.id! }
}

export async function openEnvelopeV1(sessionId: number, commandId: string) {
  const version = await readProductRuntimeStateVersion(sessionId)
  return { sessionId, commandId, baseSequence: version.sequence, baseStateHash: version.stateHash }
}

export async function configureOpenSeatsV1(sessionId: number) {
  for (const seat of await readTtrpgSessionParticipantsV2(sessionId)) {
    await configureTtrpgSessionParticipantV2({ sessionId, seatKey: seat.seatKey,
      expectedRevision: seat.revision, commandId: `consent.${seat.seatKey}`,
      requestedByViewerKey: seat.controller === 'ai' ? 'viewer.gm' : seat.viewerKey,
      assignmentState: seat.controller === 'ai' ? 'assigned' : 'claimed',
      consent: { aiIdentityDisclosed: true, aiAdviceAllowed: true } })
  }
}

export async function readyOpenTtrpgSessionV1(title = 'ready open foundation', configure?: Parameters<typeof seedOpenTtrpgSessionV1>[1], selectedCharacterKeys = ['hero', 'companion.1', 'companion.2'], released = false) {
  const fixture = await seedOpenTtrpgSessionV1(title, configure, released)
  await configureOpenSeatsV1(fixture.sessionId)
  const state = await readProductRuntimeState(fixture.sessionId)
  const zero = await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(fixture.sessionId, 'open.zero'),
    acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys,
    selectedCharacterKeys, viewerKey: OPEN_HUMAN_VIEWER })
  const started = await startTtrpgOpenRunV1({ ...await openEnvelopeV1(fixture.sessionId, 'open.start'), viewerKey: OPEN_HUMAN_VIEWER })
  return { ...fixture, zero, started }
}
