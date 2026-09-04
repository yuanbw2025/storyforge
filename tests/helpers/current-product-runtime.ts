import { db } from '../../src/lib/db/schema'
import { createProductRuntimeInstanceFromSource } from '../../src/lib/product/runtime-instances'
import {
  hashProductRuntimeStateV1,
  parseProductRuntimeState,
} from '../../src/lib/product/runtime-api'
import type { ProductRuntimeState } from '../../src/lib/types'
import { createCurrentProductBuildPreviewFixture } from './current-product-runtime-internal'
import {
  loadCurrentProductWorldSourceCatalogV1,
  seedCurrentProductWorld,
} from './current-product-world'
import { stampNewRecord } from '../../src/lib/workspace/scope'

export interface CurrentProductRuntimeTestBedV1 {
  project: Awaited<ReturnType<typeof seedCurrentProductWorld>>['project']
  world: Awaited<ReturnType<typeof seedCurrentProductWorld>>['world']
  work: Awaited<ReturnType<typeof seedCurrentProductWorld>>['work']
  scope: Awaited<ReturnType<typeof seedCurrentProductWorld>>['scope']
  release: Awaited<ReturnType<typeof seedCurrentProductWorld>>['release']
  buildId: number
  previewHash: string
}

async function resetFormalSessionForKernelTestV1(
  sessionId: number,
  initialState?: ProductRuntimeState,
) {
  const session = await db.productRuntimeSessions.get(sessionId)
  if (!session) throw new Error('现行产品测试会话不存在')
  const formalState = parseProductRuntimeState(session.initialStateJson)
  const selectedCharacterKeys = formalState.ttrpg?.campaign?.roster
    .map(item => item.characterKey) ?? []
  const state = parseProductRuntimeState({
    ...(initialState ?? formalState),
    ...(initialState ? {
      entities: {
        ...formalState.entities,
        ...initialState.entities,
      },
    } : {}),
    // Even low-level kernel tests retain the exact immutable Product Build
    // narrative binding. Only product-owned mutable state is replaced.
    narrative: formalState.narrative,
    ...(initialState ? {
      ttrpg: {
        ...(formalState.ttrpg ?? {}),
        ...(initialState.ttrpg ?? {}),
        product: formalState.ttrpg?.product ? {
          ...formalState.ttrpg.product,
          sessionZero: {
            ...formalState.ttrpg.product.sessionZero,
            completed: true,
            acceptedItemKeys: [...formalState.ttrpg.product.sessionZero.requiredItemKeys],
            selectedCharacterKeys,
            completedBy: 'kernel-test',
            completedAtSequence: 1,
          },
        } : undefined,
      },
    } : {}),
    lastSequence: 0,
  })
  const stateJson = JSON.stringify(state)
  const stateHash = await hashProductRuntimeStateV1(state)
  await db.transaction('rw', db.productRuntimeSessions, db.productRuntimeEvents, async () => {
    await db.productRuntimeEvents.where('sessionId').equals(sessionId).delete()
    await db.productRuntimeSessions.update(sessionId, {
      initialStateJson: stateJson,
      runtimeHeadSequence: 0,
      runtimeHeadStateJson: stateJson,
      runtimeHeadStateHash: stateHash,
      updatedAt: Date.now(),
    })
  })
  return (await db.productRuntimeSessions.get(sessionId))!
}

/**
 * Current-only test bed for product runtime kernels. It enters through a real
 * WorldRelease -> Product Build -> Preview Instance and then removes the
 * automatic entry events so event-reducer tests can start at sequence zero.
 * No corresponding bypass exists under src/.
 */
export async function createCurrentTtrpgRuntimeTestBedV1(input: {
  title: string
  seed?: string
  initialState?: ProductRuntimeState
  withWorldGroup?: boolean
}): Promise<CurrentProductRuntimeTestBedV1 & {
  session: Awaited<ReturnType<typeof resetFormalSessionForKernelTestV1>>
  worldGroupId: number | null
}> {
  const owned = await seedCurrentProductWorld(input.title)
  const worldGroupId = input.withWorldGroup
    ? await db.worldGroups.add(stampNewRecord(owned.scope, 'worldGroups', {
        projectId: owned.scope.projectId,
        name: '潮汐界',
        description: '',
        type: 'primary',
        order: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }, { owner: 'world' })) as number
    : null
  const catalog = await loadCurrentProductWorldSourceCatalogV1({
    scope: owned.scope,
    worldReleaseId: owned.release.id!,
    productType: 'ttrpg',
  })
  const built = await createCurrentProductBuildPreviewFixture({
    scope: owned.scope,
    worldRelease: owned.release,
    sourceCatalog: catalog,
    title: input.title,
    worldGroupId,
    seed: input.seed,
  })
  const session = await resetFormalSessionForKernelTestV1(built.session.id!, input.initialState)
  return {
    ...owned,
    buildId: built.buildId,
    previewHash: built.preview.previewHash,
    session,
    worldGroupId,
  }
}

export async function createSiblingCurrentTtrpgRuntimeSessionV1(input: {
  bed: CurrentProductRuntimeTestBedV1
  title: string
  seed?: string
  initialState?: ProductRuntimeState
}) {
  const session = await createProductRuntimeInstanceFromSource({
    scope: input.bed.scope,
    source: {
      kind: 'build',
      productBuildId: input.bed.buildId,
      expectedPreviewHash: input.bed.previewHash,
    },
    title: input.title,
    seed: input.seed,
  })
  return resetFormalSessionForKernelTestV1(session.id!, input.initialState)
}
