import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { verifyFormalRuntimeSourceV1, preparePreviewProductRuntimeSessionRecordV1,
  insertPreparedProductRuntimeSessionV1, parseProductRuntimeState } from '../../src/lib/product/runtime-core'
import { createProductRuntimeInstanceFromSource } from '../../src/lib/product/runtime-instances'
import * as previewSource from '../../src/lib/product-production/preview-source'
import { createTextOpenWorldCreatorReleaseFixtureV1 } from '../helpers/text-open-world-creator-release'

async function buildPreview() {
  const f = await createTextOpenWorldCreatorReleaseFixtureV1('world-release', 1, { portableRoot: true })
  await db.productBuilds.update(f.creator.buildId, { status: 'preview-ready' })
  const session = await createProductRuntimeInstanceFromSource({ scope: f.scope,
    source: { kind: 'build', productBuildId: f.creator.buildId, expectedPreviewHash: f.portableRoot!.previewHash },
    title: '005 actual World Build authority snapshot' })
  return { ...f, session }
}

function preparedInput(f: Awaited<ReturnType<typeof buildPreview>>): Parameters<typeof preparePreviewProductRuntimeSessionRecordV1>[0] {
  return { ...f.scope, kind: 'text-open-world', title: '005 actual second World preview', seed: f.session.seed,
    canonSnapshot: JSON.parse(f.session.canonSnapshotJson), initialState: parseProductRuntimeState(f.session.initialStateJson),
    productBuildId: f.creator.buildId, expectedPreviewHash: f.portableRoot!.previewHash,
    runtimeSourceHash: f.session.runtimeSourceHash, origin: 'preview' }
}

describe('SFQA-005 · capture the source tuple that the real strict verifier validates', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => vi.restoreAllMocks())
  afterAll(() => db.close())

  it('retains the real unchanged World Build, Production and exact frozen Brief tuple', async () => {
    const f = await buildPreview(), source = await verifyFormalRuntimeSourceV1(f.session, ['text-open-world'])
    expect(source.source.kind).toBe('build')
    if (source.source.kind !== 'build') throw new Error('Actual Build source required')
    expect(source.runtimePackage.textOpenWorldVNext?.sourceManifest.kind).toBe('world-release')
    expect(source.source.build).toEqual(await db.productBuilds.get(f.creator.buildId))
    expect(source.source.production).toEqual(await db.productProductions.get(f.creator.productionId))
    expect(source.source.brief).toEqual(await db.productProductionBriefs.get(source.source.brief.id))
  }, 30_000)

  it.each(['build', 'production', 'brief'] as const)('rejects a %s row changed after the actual verifier returns, rather than adopting it as a new CAS baseline', async target => {
    const f = await buildPreview(), build = (await db.productBuilds.get(f.creator.buildId))!
    const brief = (await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first())!
    const actualSource = previewSource.verifyProductRuntimeSessionSourceV1
    const runs = await db.agentRuns.toArray(), events = await db.productRuntimeEvents.toArray()
    let injected = 0
    vi.spyOn(previewSource, 'verifyProductRuntimeSessionSourceV1').mockImplementation(async input => {
      const result = await actualSource(input)
      if (!injected) {
        if (target === 'build') await db.productBuilds.update(build.id!, { previewManifestJson: '{}' })
        else if (target === 'production') await db.productProductions.update(build.productionId, { updatedAt: Date.now() + 10_000 })
        else await db.productProductionBriefs.update(brief.id!, { briefHash: '0'.repeat(64) })
        injected += 1
      }
      return result
    })
    const outcome = await verifyFormalRuntimeSourceV1(f.session, ['text-open-world'])
      .then(() => ({ ok: true, error: '' }), (error: unknown) => ({ ok: false, error: String(error) }))
    expect(injected).toBe(1)
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toMatch(/Build\/Production\/Brief.*变化/)
    expect(await db.agentRuns.toArray()).toEqual(runs)
    expect(await db.productRuntimeEvents.toArray()).toEqual(events)
    if (target === 'build') expect((await db.productBuilds.get(build.id!))!.previewManifestJson).toBe('{}')
    if (target === 'brief') expect((await db.productProductionBriefs.get(brief.id!))!.briefHash).toBe('0'.repeat(64))
  }, 30_000)

  it('does not insert a new Session using an unverified Build row captured after preview validation', async () => {
    const f = await buildPreview(), actual = previewSource.verifyProductRuntimeSource
    const count = await db.productRuntimeSessions.count(), events = await db.productRuntimeEvents.toArray()
    let injected = 0
    vi.spyOn(previewSource, 'verifyProductRuntimeSource').mockImplementation(async input => {
      const verified = await actual(input)
      if (!injected) { await db.productBuilds.update(f.creator.buildId, { previewManifestJson: '{}' }); injected += 1 }
      return verified
    })
    const outcome = await preparePreviewProductRuntimeSessionRecordV1(preparedInput(f))
      .then(value => insertPreparedProductRuntimeSessionV1(value)).then(() => ({ ok: true, error: '' }),
        (error: unknown) => ({ ok: false, error: String(error) }))
    expect(injected).toBe(1)
    expect(outcome.ok, outcome.error).toBe(false)
    expect(outcome.error).toMatch(/Build.*变化|冻结来源.*变化/)
    expect(await db.productRuntimeSessions.count()).toBe(count)
    expect(await db.productRuntimeEvents.toArray()).toEqual(events)
  }, 30_000)

  it.each(['build', 'production', 'brief'] as const)('rechecks the prepared %s source inside the Session insertion transaction', async target => {
    const f = await buildPreview(), prepared = await preparePreviewProductRuntimeSessionRecordV1(preparedInput(f))
    const build = (await db.productBuilds.get(f.creator.buildId))!
    const brief = (await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first())!
    const count = await db.productRuntimeSessions.count(), events = await db.productRuntimeEvents.toArray()
    if (target === 'build') await db.productBuilds.update(build.id!, { previewManifestJson: '{}' })
    else if (target === 'production') await db.productProductions.update(build.productionId, { updatedAt: Date.now() + 10_000 })
    else await db.productProductionBriefs.update(brief.id!, { briefHash: '0'.repeat(64) })
    const outcome = await insertPreparedProductRuntimeSessionV1(prepared).then(() => ({ ok: true, error: '' }),
      (error: unknown) => ({ ok: false, error: String(error) }))
    expect(outcome.ok, outcome.error).toBe(false)
    expect(outcome.error).toMatch(/Build.*变化|冻结来源.*变化/)
    expect(await db.productRuntimeSessions.count()).toBe(count)
    expect(await db.productRuntimeEvents.toArray()).toEqual(events)
  }, 30_000)

  it('detaches an already checked prepared Session payload before any source-CAS await', async () => {
    const f = await buildPreview(), prepared = await preparePreviewProductRuntimeSessionRecordV1(preparedInput(f))
    const expected = structuredClone(prepared), actualGet = db.productBuilds.get.bind(db.productBuilds)
    let injected = 0
    vi.spyOn(db.productBuilds, 'get').mockImplementation(key => {
      const actual = actualGet(key)
      void actual.then(() => {
        if (!injected) { prepared.workId = f.scope.workId + 1000; injected += 1 }
      })
      return actual
    })
    const inserted = await insertPreparedProductRuntimeSessionV1(prepared)
    expect(injected).toBe(1)
    expect((await db.productRuntimeSessions.get(inserted.id!))!.workId).toBe(expected.workId)
    expect(inserted.workId).toBe(expected.workId)
  }, 30_000)
})
