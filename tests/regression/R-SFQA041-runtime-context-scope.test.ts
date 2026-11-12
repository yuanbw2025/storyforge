import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { generateOpenWorldRuntimeCandidateV1 } from '../../src/lib/open-world/harness'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { generateWorldCode } from '../../src/lib/workspace/identity'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { resolveReadScope } from '../../src/lib/workspace/scope'
import { buildWorkRecord, createWorldWork, switchActiveWork } from '../../src/lib/workspace/works'
import type { AssembleContextInput } from '../../src/lib/registry/types'
import type { WorkspaceScope } from '../../src/lib/types'
import { seedAiTownRuntimeFixture } from '../helpers/ai-town-runtime'
import { seedChatRuntimeFixture } from '../helpers/character-chat-fixture'
import { seedCurrentProductBuild } from '../helpers/current-product-build'
import { createCurrentRuntimePackageFixture } from '../helpers/current-runtime-package'
import { loadCurrentProductWorldSourceCatalogV1, seedCurrentProductWorld } from '../helpers/current-product-world'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextP9Fixture } from '../helpers/text-open-world-vnext-fixture'

const sourceKey = 'openWorldRuntime'
const title = '041 governed runtime'

async function siblingWork(scope: WorkspaceScope): Promise<WorkspaceScope> {
  const other = await createWorldWork(scope.projectId, {
    title: '041 same world sibling Work', kind: 'novel', novelProfile: 'long',
  })
  expect(other.worldId).toBe(scope.worldId)
  expect(other.id).not.toBe(scope.workId)
  return { ...scope, workId: other.id! }
}

async function setup() {
  const owned = await createGovernedTextOpenWorldSessionFixtureV1({
    name: title, title, textOpenWorldVNext: createTextOpenWorldVNextP9Fixture(),
  })
  return {
    own: {
      projectId: owned.scope.projectId, scope: owned.scope,
      worldGroupId: owned.session.worldGroupId ?? null,
      productRuntimeSessionId: owned.session.id!, sourceKeys: [sourceKey],
    },
    foreignScope: await siblingWork(owned.scope),
  }
}

async function expectDeniedBeforePayload(reads: (() => Promise<unknown>)[]) {
  const releaseRead = vi.spyOn(db.productReleases, 'get')
  const buildRead = vi.spyOn(db.productBuilds, 'get')
  const eventRead = vi.spyOn(db.productRuntimeEvents, 'where')
  try {
    for (const read of reads) await expect(read()).rejects.toThrow(/scope|Work|实例/)
    expect(releaseRead).not.toHaveBeenCalled()
    expect(buildRead).not.toHaveBeenCalled()
    expect(eventRead).not.toHaveBeenCalled()
  } finally {
    releaseRead.mockRestore()
    buildRead.mockRestore()
    eventRead.mockRestore()
  }
}

async function adventureFixture() {
  const owned = await seedCurrentProductWorld('041 formal adventure')
  const worldRelease = { ...owned.release, id: owned.release.id! }
  const sourceCatalog = await loadCurrentProductWorldSourceCatalogV1({
    scope: owned.scope, worldReleaseId: worldRelease.id, productType: 'text-adventure',
  })
  const runtimePackage = createCurrentRuntimePackageFixture({
    productType: 'text-adventure', worldRelease, sourceCatalog,
  })
  const { session } = await seedCurrentProductBuild({ scope: owned.scope, worldRelease, runtimePackage, title: '041 adventure' })
  return { scope: owned.scope, sessionId: session.id! }
}

const productCases = {
  'text-adventure': {
    setup: adventureFixture, sources: ['adventureRuntime', 'productRuntime'], participant: undefined,
  },
  'legacy text-open-world': {
    setup: async () => {
      const f = await createGovernedTextOpenWorldSessionFixtureV1({
        name: '041 historical evolution', textOpenWorldVNext: createTextOpenWorldVNextP9Fixture(), runtimeShape: 'legacy-only',
      })
      return { scope: f.scope, sessionId: f.session.id! }
    },
    sources: ['openWorldRuntime', 'textOpenWorldEvolutionRuntime'], participant: undefined,
  },
  'ai-town': {
    setup: async () => {
      const f = await seedAiTownRuntimeFixture()
      return { scope: f.scope, sessionId: f.session.id! }
    },
    sources: ['interactionRuntime', 'aiTownRuntime', 'aiTownDirectorRuntime'], participant: 'participant.1',
  },
  'character-interaction': {
    setup: () => seedChatRuntimeFixture(true), sources: ['interactionRuntime', 'productRuntime'], participant: 'aria',
  },
}

describe('SFQA041 runtime context uses the caller-owned Work', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })

  it.each(['assemble', 'source'] as const)('denies the sibling Work before reading its private runtime payload through %s', async entry => {
    const { own, foreignScope } = await setup()
    const releaseRead = vi.spyOn(db.productReleases, 'get')
    const eventRead = vi.spyOn(db.productRuntimeEvents, 'where')
    const source = CONTEXT_SOURCE_BY_KEY.get(sourceKey)!
    const input = { ...own, scope: foreignScope }
    const result = await Promise.allSettled([
      entry === 'assemble' ? assembleContext(input) : source.read(input),
    ])
    expect({
      status: result[0].status, releases: releaseRead.mock.calls.length, events: eventRead.mock.calls.length,
    }).toEqual({ status: 'rejected', releases: 0, events: 0 })
  }, 20_000)

  it('reads the same governed runtime source for its real owner through both entries', async () => {
    const { own } = await setup()
    const result = await assembleContext(own)
    const text = await CONTEXT_SOURCE_BY_KEY.get(sourceKey)!.read(own)
    expect(result.included).toEqual([sourceKey])
    expect(text.length).toBeGreaterThan(0)
    expect(result.text).toBe(text)
  }, 20_000)

  it('rejects a project-only direct provider scope before source and event reads', async () => {
    const { own } = await setup()
    const provider = CONTEXT_SOURCE_BY_KEY.get(sourceKey)!.resources!
    const releaseRead = vi.spyOn(db.productReleases, 'get')
    const eventRead = vi.spyOn(db.productRuntimeEvents, 'where')
    const result = await Promise.allSettled([provider.fingerprint({
      projectId: own.projectId, productRuntimeSessionId: own.productRuntimeSessionId,
    })])
    expect({
      status: result[0].status, releases: releaseRead.mock.calls.length, events: eventRead.mock.calls.length,
    }).toEqual({ status: 'rejected', releases: 0, events: 0 })
  }, 20_000)

  it.each(Object.entries(productCases))('preserves the real %s owner view and rejects sibling Work at both public entries', async (_, fixture) => {
    const { scope, sessionId } = await fixture.setup()
    const foreignScope = await siblingWork(scope)
    for (const key of fixture.sources) {
      const source = CONTEXT_SOURCE_BY_KEY.get(key)!
      const own = {
        projectId: scope.projectId, scope, productRuntimeSessionId: sessionId,
        interactionParticipantKey: fixture.participant, sourceKeys: [key],
      }
      expect((await source.read(own)).length).toBeGreaterThan(0)
      expect((await assembleContext(own)).included).toEqual([key])
      const foreign = { ...own, scope: foreignScope }
      await expectDeniedBeforePayload([() => source.read(foreign), () => assembleContext(foreign)])
    }
  }, 30_000)

  it('rejects cached provider entries for foreign or incomplete scopes and after owner deletion', async () => {
    const { own, foreignScope } = await setup()
    const provider = CONTEXT_SOURCE_BY_KEY.get(sourceKey)!.resources!
    const scope = { ...own.scope, productRuntimeSessionId: own.productRuntimeSessionId }
    const list = await provider.listMetadata({ scope, limit: 4 })
    const item = list.items[0]
    expect(item).toBeDefined()
    expect((await provider.searchMetadata({ scope, query: item.title, limit: 4 })).items.length).toBeGreaterThan(0)
    expect((await provider.read({ scope, resourceKey: item.resourceKey, depth: 'summary', maxTokens: 1000 })).content).toBeTruthy()
    expect(await provider.fingerprint(scope)).toMatch(/^[0-9a-f]{64}$/)
    const foreign = { ...foreignScope, productRuntimeSessionId: scope.productRuntimeSessionId }
    await expectDeniedBeforePayload([
      () => provider.fingerprint({ projectId: scope.projectId, productRuntimeSessionId: scope.productRuntimeSessionId }),
      () => provider.listMetadata({ scope: foreign, limit: 4 }),
      () => provider.searchMetadata({ scope: foreign, query: item.title, limit: 4 }),
      () => provider.read({ scope: foreign, resourceKey: item.resourceKey, depth: 'summary', maxTokens: 1000 }),
    ])
    await deleteWork(scope.workId)
    expect(await db.productRuntimeSessions.get(scope.productRuntimeSessionId)).toBeUndefined()
    await expectDeniedBeforePayload([() => provider.fingerprint(scope), () => assembleContext(own)])
  }, 30_000)

  it('rejects other valid World and Project roots and a stale selected instance after switching Work', async () => {
    const { own, foreignScope } = await setup()
    const world = (await db.worlds.get(own.scope.worldId))!
    const work = (await db.works.get(own.scope.workId))!
    const worldId = await db.worlds.add({ ...world, id: undefined, code: generateWorldCode(), name: '041 second World' }) as number
    const workId = await db.works.add(buildWorkRecord({
      projectId: own.projectId, worldId, fallback: work, now: Date.now(),
      create: { title: '041 second World Work', kind: 'novel', novelProfile: 'long' },
    })) as number
    const other = await createWorkspace({
      name: '041 other Project', description: '', genres: [], status: 'drafting', targetWordCount: 1,
    }, { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
    const source = CONTEXT_SOURCE_BY_KEY.get(sourceKey)!
    for (const scope of [{ projectId: own.projectId, worldId, workId }, other.scope]) {
      const foreign = { ...own, projectId: scope.projectId, scope }
      await expectDeniedBeforePayload([() => source.read(foreign), () => assembleContext(foreign)])
    }
    await switchActiveWork(foreignScope.projectId, foreignScope.workId)
    const fallback: AssembleContextInput = { ...own, scope: undefined }
    await expectDeniedBeforePayload([() => source.read(fallback), () => assembleContext(fallback)])
    expect((await assembleContext(own)).included).toEqual([sourceKey])
  }, 30_000)

  it('does not authorize the old selected instance ID under a restored owner after import remapping', async () => {
    const { own } = await setup()
    const restoredProjectId = await importProjectJSON(await exportProjectJSON(own.projectId))
    const scope = await resolveReadScope({ projectId: restoredProjectId })
    const [restored] = await db.productRuntimeSessions.where('projectId').equals(restoredProjectId).toArray()
    expect(restored.id).not.toBe(own.productRuntimeSessionId)
    expect(restored.workId).toBe(scope.workId)
    const source = CONTEXT_SOURCE_BY_KEY.get(sourceKey)!
    const input = { ...own, scope, projectId: restoredProjectId }
    await expectDeniedBeforePayload([() => assembleContext(input), () => source.read(input)])
    expect((await assembleContext({ ...input, productRuntimeSessionId: restored.id })).included).toEqual([sourceKey])
    expect((await assembleContext(own)).included).toEqual([sourceKey])
  }, 30_000)

  it('keeps the formal runtime Harness from opening a sibling Work source or calling a model', async () => {
    const { own, foreignScope } = await setup()
    const runAI = vi.fn(async () => '{}')
    const runCount = await db.agentRuns.count()
    await expectDeniedBeforePayload([() => generateOpenWorldRuntimeCandidateV1({
      scope: foreignScope, productRuntimeSessionId: own.productRuntimeSessionId,
      skillId: 'prose.open-world-scene-narration', objective: '041 denied source', runAI,
    })])
    expect(runAI).not.toHaveBeenCalled()
    expect(await db.agentRuns.count()).toBe(runCount)
  }, 20_000)
})
