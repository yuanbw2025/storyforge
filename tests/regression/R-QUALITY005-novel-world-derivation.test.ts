import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import * as contentRevision from '../../src/lib/authoring/content-revision'
import { db } from '../../src/lib/db/schema'
import { startTextOpenWorldCreatorBriefSessionV1 } from '../../src/lib/open-world/creator-brief'
import { inspectTextOpenWorldCreatorWorldSourceV1 } from '../../src/lib/open-world/creator-source'
import {
  deriveTextOpenWorldNovelWorldDraftV1,
  previewTextOpenWorldNovelWorldDraftV1,
} from '../../src/lib/open-world/novel-world-derivation'
import { deriveNovelToWorld } from '../../src/lib/world-engine/derivation'
import * as worldReleases from '../../src/lib/world-engine/releases'
import { seedQuality005LegacyNovelV1 } from '../helpers/quality005-legacy-novel'

async function operationCounts() {
  return {
    productions: await db.productProductions.count(), builds: await db.productBuilds.count(),
    artifacts: await db.productBuildArtifacts.count(), sessions: await db.productRuntimeSessions.count(),
    runtimeEvents: await db.productRuntimeEvents.count(), blobs: await db.mediaBlobObjects.count(),
    runs: await db.agentRuns.count(), releases: await db.productReleases.count(),
  }
}

describe('SFQA-005 · explicit novel -> separate World draft -> author seal -> new S2', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => vi.restoreAllMocks())
  afterAll(() => db.close())

  it('creates only an independent unsealed draft and keeps every original source/product/evidence row', async () => {
    const fixture = await seedQuality005LegacyNovelV1()
    const before = await operationCounts()
    const preview = await previewTextOpenWorldNovelWorldDraftV1(fixture.scope)
    expect(preview.range).toBe('all-confirmed-canon')
    const derived = await deriveTextOpenWorldNovelWorldDraftV1(preview)
    expect(derived.release).toBeNull()
    expect(derived.targetScope).not.toEqual(fixture.scope)
    expect((await db.projects.get(derived.targetProjectId))?.workspacePurpose).toBe('world-engine')
    expect((await db.worlds.get(derived.targetScope.worldId))?.currentVersion).toBe(0)
    expect(derived.derivation).toMatchObject({ sourceWorkCode: preview.workCode, targetReleaseId: null })
    expect(JSON.parse(derived.derivation.sourceRangeJson)).toEqual({ kind: 'all-confirmed-canon' })
    expect(await operationCounts()).toEqual(before)
    for (const table of db.tables) {
      for (const row of fixture.rows[table.name] ?? []) {
        const original = row as { id: number }
        expect(await table.get(original.id), `${table.name}:${original.id}`).toEqual(row)
      }
    }
    await expect(contentRevision.verifyWorkspaceContentRevisionV1(preview.sourceRevision, {
      scope: fixture.scope, worldGroupId: null,
    })).resolves.toMatchObject({ fresh: true })
    expect(await db.worldReleases.where('projectId').equals(derived.targetProjectId).count()).toBe(0)
  }, 30_000)

  it('requires a separate author seal and starts a distinct S2 source lineage from its real WorldRelease', async () => {
    const fixture = await seedQuality005LegacyNovelV1()
    const originalProduction = await db.productProductions.get(fixture.creator.productionId)
    const derived = await deriveTextOpenWorldNovelWorldDraftV1(await previewTextOpenWorldNovelWorldDraftV1(fixture.scope))
    expect(await db.worldReleases.where('projectId').equals(derived.targetProjectId).count()).toBe(0)
    const sealed = await worldReleases.publishWorldRevision(derived.revision.id!)
    const preview = await inspectTextOpenWorldCreatorWorldSourceV1({
      scope: derived.targetScope, localReleaseRecordId: sealed.id!, expectedReleaseHash: sealed.contentHash,
    })
    const started = await startTextOpenWorldCreatorBriefSessionV1({
      selection: {
        sourceKind: 'world-release', sourceScope: derived.targetScope,
        localReleaseRecordId: sealed.id!, expectedReleaseHash: sealed.contentHash, preview,
      },
      sessionKey: 'quality005-explicit-world-s2',
    })
    expect(started.sourceBinding.kind).toBe('world-release')
    expect(started.production.id).not.toBe(fixture.creator.productionId)
    expect(started.production.productionKey).not.toBe(fixture.creator.productionKey)
    expect(started.production.currentBuildNumber).toBeNull()
    expect(await db.productProductions.get(fixture.creator.productionId)).toEqual(originalProduction)
  }, 30_000)

  it('rejects source edits since the author preview, preserving the new author text and creating no target', async () => {
    const fixture = await seedQuality005LegacyNovelV1()
    const preview = await previewTextOpenWorldNovelWorldDraftV1(fixture.scope)
    const chapter = (await db.chapters.toCollection().first())!
    const beforeProjects = await db.projects.count()
    await db.chapters.update(chapter.id!, { content: '<p>作者刚保存的新正文。</p>', updatedAt: chapter.updatedAt + 1 })
    await expect(deriveTextOpenWorldNovelWorldDraftV1(preview)).rejects.toThrow(/已变化/)
    expect((await db.chapters.get(chapter.id!))?.content).toContain('作者刚保存的新正文')
    expect(await db.projects.count()).toBe(beforeProjects)
    expect(await db.worldDerivations.count()).toBe(0)
  })

  it.each([3, 4] as const)('checks the expected revision at the actual v%s capture boundary', async formatVersion => {
    const fixture = await seedQuality005LegacyNovelV1()
    const expectedSourceRevision = await contentRevision.captureWorkspaceContentRevisionV1({ scope: fixture.scope, worldGroupId: null })
    const chapter = (await db.chapters.toCollection().first())!
    await db.chapters.update(chapter.id!, { content: '<p>预览通过以后、capture之前的新正文。</p>', updatedAt: chapter.updatedAt + 2 })
    const before = await db.projects.count()
    await expect(deriveNovelToWorld({ sourceScope: fixture.scope, publish: false, formatVersion, expectedSourceRevision }))
      .rejects.toThrow(/预览后.*变化/)
    expect(await db.projects.count()).toBe(before)
    expect((await db.chapters.get(chapter.id!))?.content).toContain('capture之前的新正文')
  }, 30_000)

  it('keeps the original capture-after-edit freshness guard and rolls back no author edits', async () => {
    const fixture = await seedQuality005LegacyNovelV1()
    const preview = await previewTextOpenWorldNovelWorldDraftV1(fixture.scope)
    const original = worldReleases.buildIndependentWorkWorldSnapshot
    const chapter = (await db.chapters.toCollection().first())!
    vi.spyOn(worldReleases, 'buildIndependentWorkWorldSnapshot').mockImplementation(async input => {
      const snapshot = await original(input)
      await db.chapters.update(chapter.id!, { content: '<p>capture期间保存的新正文。</p>', updatedAt: chapter.updatedAt + 3 })
      return snapshot
    })
    const before = await db.projects.count()
    await expect(deriveTextOpenWorldNovelWorldDraftV1(preview)).rejects.toThrow(/捕获期间.*变化/)
    expect(await db.projects.count()).toBe(before)
    expect((await db.chapters.get(chapter.id!))?.content).toContain('capture期间保存的新正文')
  }, 30_000)

  it('rolls back only its new target on a destination failure and preserves an existing World plus a concurrent source edit', async () => {
    const f = await seedQuality005LegacyNovelV1()
    const oldWorld = await deriveTextOpenWorldNovelWorldDraftV1(await previewTextOpenWorldNovelWorldDraftV1(f.scope))
    const oldWorldRows = Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name,
      (await table.toArray()).filter(row => row.projectId === oldWorld.targetProjectId)])))
    const preview = await previewTextOpenWorldNovelWorldDraftV1(f.scope)
    const beforeProjects = (await db.projects.toArray()).map(row => row.id)
    const chapter = (await db.chapters.where('projectId').equals(f.scope.projectId).first())!
    vi.spyOn(worldReleases, 'createWorldRevision').mockImplementation(async () => {
      await db.chapters.update(chapter.id!, { content: '<p>目标写入失败前作者的新稿仍须保留。</p>', updatedAt: chapter.updatedAt + 10 })
      throw new Error('005 destination revision failure')
    })
    await expect(deriveTextOpenWorldNovelWorldDraftV1(preview)).rejects.toThrow('005 destination revision failure')
    expect((await db.projects.toArray()).map(row => row.id)).toEqual(beforeProjects)
    expect((await db.chapters.get(chapter.id!))?.content).toContain('作者的新稿仍须保留')
    expect(await db.worldDerivations.count()).toBe(1)
    expect(await db.worldReleases.count()).toBe(0)
    for (const table of db.tables) expect((await table.toArray()).filter(row => row.projectId === oldWorld.targetProjectId))
      .toEqual(oldWorldRows[table.name])
  }, 30_000)

  it('does not silently reinterpret an unsupported chapter range or corrupt preview as all-confirmed content', async () => {
    const fixture = await seedQuality005LegacyNovelV1()
    const preview = await previewTextOpenWorldNovelWorldDraftV1(fixture.scope)
    const before = await db.projects.count()
    await expect(deriveTextOpenWorldNovelWorldDraftV1({ ...preview, previewHash: '0'.repeat(64) })).rejects.toThrow(/预览或范围/)
    const { previewHash: _hash, ...body } = preview
    const unsupported = { ...body, range: 'chapter-range' }
    await expect(deriveTextOpenWorldNovelWorldDraftV1({
      ...unsupported, previewHash: await hashCanonicalValue(unsupported),
    } as never)).rejects.toThrow(/不支持按卷或章节范围/)
    expect(await db.projects.count()).toBe(before)
  })

  it('does not admit an unsealed derived revision as a WorldRelease or create product work before sealing', async () => {
    const f = await seedQuality005LegacyNovelV1()
    const derived = await deriveTextOpenWorldNovelWorldDraftV1(await previewTextOpenWorldNovelWorldDraftV1(f.scope))
    const before = await operationCounts()
    await expect(inspectTextOpenWorldCreatorWorldSourceV1({ scope: derived.targetScope,
      localReleaseRecordId: derived.revision.id!, expectedReleaseHash: derived.revision.contentHash })).rejects.toThrow()
    expect(await operationCounts()).toEqual(before)
    expect(await db.worldReleases.where('projectId').equals(derived.targetProjectId).count()).toBe(0)
  }, 30_000)

  it.each([3, 4] as const)('preserves independent derivation format %s without the new optional preview revision', async formatVersion => {
    const f = await seedQuality005LegacyNovelV1()
    const before = await operationCounts()
    const derived = await deriveNovelToWorld({ sourceScope: f.scope, publish: false, formatVersion })
    expect(derived.release).toBeNull()
    expect(derived.targetScope.workId).not.toBe(f.scope.workId)
    expect(await operationCounts()).toEqual(before)
  }, 30_000)

  it('does not synchronize later source edits into the independent draft or sealed version', async () => {
    const f = await seedQuality005LegacyNovelV1()
    const derived = await deriveTextOpenWorldNovelWorldDraftV1(await previewTextOpenWorldNovelWorldDraftV1(f.scope))
    const release = await worldReleases.publishWorldRevision(derived.revision.id!)
    const targetBefore = Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name,
      (await table.toArray()).filter(row => row.projectId === derived.targetProjectId)])))
    const sourceChapter = (await db.chapters.where('projectId').equals(f.scope.projectId).first())!
    await db.chapters.update(sourceChapter.id!, { content: '<p>作者后来独立改写源小说。</p>', updatedAt: Date.now() + 1 })
    for (const table of db.tables) expect((await table.toArray()).filter(row => row.projectId === derived.targetProjectId))
      .toEqual(targetBefore[table.name])
    expect((await db.worldReleases.get(release.id!))?.contentHash).toBe(release.contentHash)
    expect((await db.chapters.get(sourceChapter.id!))?.content).toContain('独立改写源小说')
  }, 30_000)

  it('does not synchronize edits to the separate World draft back into its original novel or sealed release', async () => {
    const f = await seedQuality005LegacyNovelV1()
    const derived = await deriveTextOpenWorldNovelWorldDraftV1(await previewTextOpenWorldNovelWorldDraftV1(f.scope))
    const release = await worldReleases.publishWorldRevision(derived.revision.id!)
    const originalRelease = await db.worldReleases.get(release.id!)
    await db.worlds.update(derived.targetScope.worldId, { description: '作者只修改新的世界草稿。', updatedAt: Date.now() + 1 })
    for (const table of db.tables) for (const row of f.rows[table.name] ?? []) {
      expect(await table.get((row as { id: number }).id)).toEqual(row)
    }
    expect(await db.worldReleases.get(release.id!)).toEqual(originalRelease)
    expect((await db.worlds.get(derived.targetScope.worldId))?.description).toBe('作者只修改新的世界草稿。')
  }, 30_000)

  it('rejects a rehashed preview whose explicit source scope points at a different or missing owner', async () => {
    const f = await seedQuality005LegacyNovelV1()
    const preview = await previewTextOpenWorldNovelWorldDraftV1(f.scope)
    const { previewHash: _hash, ...body } = preview
    const foreign = { ...body, sourceScope: { ...f.scope, workId: f.scope.workId + 1000 } }
    const before = await db.projects.count()
    await expect(deriveTextOpenWorldNovelWorldDraftV1({ ...foreign, previewHash: await hashCanonicalValue(foreign) })).rejects.toThrow()
    expect(await db.projects.count()).toBe(before)
    expect((await db.works.get(f.scope.workId))?.code).toBe(preview.workCode)
  })
})
