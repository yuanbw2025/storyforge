import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'
import { deriveNovelToWorld } from '../../src/lib/world-engine/derivation'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { WorldReleaseManifestV3, Worldview } from '../../src/lib/types'

function projectInput(name: string, targetWordCount = 100_000) {
  return {
    name,
    genre: 'other',
    genres: ['other'],
    status: 'drafting' as const,
    description: '',
    targetWordCount,
    enableMultiWorld: false,
  }
}

function worldview(scope: { projectId: number; worldId: number; workId: number }, now: number): Worldview {
  return stampNewRecord(scope, 'worldviews', {
    projectId: scope.projectId,
    summary: '潮汐城邦由三族共同治理。',
    worldOrigin: '月潮塑造了群岛文明。',
    races: '潮民、羽民、旧陆人保持不同语言和航海传统。',
    createdAt: now,
    updatedAt: now,
  }, { owner: 'world' })
}

describe('ARCH-01 · 长短篇显式派生世界', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('一键复制已登记语义、留下来源修订并可封存，源作品与目标互不跟随', async () => {
    const source = await createWorkspace(projectInput('潮汐编年史'), {
      purpose: 'independent-work',
      kind: 'novel',
      novelProfile: 'long',
    })
    const sourceWorldviewId = await db.worldviews.add(worldview(source.scope, Date.now())) as number

    const result = await deriveNovelToWorld({
      sourceScope: source.scope,
      targetName: '潮汐世界',
      publish: true,
    })

    const [sourceProject, targetProject, targetWorld, targetWorldview] = await Promise.all([
      db.projects.get(source.scope.projectId),
      db.projects.get(result.targetProjectId),
      db.worlds.get(result.targetScope.worldId),
      db.worldviews.where('projectId').equals(result.targetProjectId).first(),
    ])
    expect(sourceProject).toMatchObject({ workspacePurpose: 'independent-work' })
    expect(sourceProject).not.toHaveProperty('worldCode')
    expect(targetProject).toMatchObject({
      name: '潮汐世界',
      workspacePurpose: 'world-engine',
    })
    expect(targetProject).not.toHaveProperty('worldCode')
    expect(targetProject).not.toHaveProperty('worldVersion')
    expect(targetWorld).toMatchObject({ identityKind: 'world-draft', currentVersion: 1 })
    expect(targetWorld?.code).toMatch(/^W-/)
    expect(targetWorldview?.races).toContain('潮民')
    expect(result.derivation).toMatchObject({
      projectId: result.targetProjectId,
      worldId: result.targetScope.worldId,
      sourceWorkspaceUid: source.project.workspaceUid,
      sourceWorkCode: source.work.code,
      sourceKind: 'long-novel',
      targetRevisionId: result.revision.id,
      targetReleaseId: result.release?.id,
    })
    expect(JSON.parse(result.derivation.sourceRevisionVectorJson)).toMatchObject({ version: 1 })
    expect(JSON.parse(result.derivation.sourceRangeJson)).toEqual({ kind: 'all-confirmed-canon' })

    const manifest = JSON.parse(result.release!.manifestJson) as WorldReleaseManifestV3
    expect(manifest.semanticContract).toBe(3)
    expect(manifest).not.toHaveProperty('selectedNarrativeModules')
    expect(manifest.selectedTables).toContain('worldviews')
    expect(manifest.selectedTables).not.toEqual(expect.arrayContaining([
      'productProductions', 'productBuilds', 'productReleases', 'productMediaAssets',
      'productRuntimeSessions',
    ]))

    await db.worldviews.update(sourceWorldviewId, { races: '源作品后来改成单一种族。', updatedAt: Date.now() + 100 })
    expect((await db.worldviews.where('projectId').equals(result.targetProjectId).first())?.races).toContain('潮民')
    expect((await db.worldReleases.get(result.release!.id!))?.contentHash).toBe(result.release?.contentHash)

    await cascadeDeleteProject(source.scope.projectId)
    expect(await db.projects.get(result.targetProjectId)).toBeTruthy()

    const portable = await exportProjectJSON(result.targetProjectId)
    const restoredId = await importProjectJSON(portable)
    const restoredReceipt = await db.worldDerivations.where('projectId').equals(restoredId).first()
    expect(restoredReceipt?.sourceWorkspaceUid).toBe(result.derivation.sourceWorkspaceUid)
    expect(restoredReceipt?.targetRevisionId).not.toBe(result.derivation.targetRevisionId)
    expect(restoredReceipt?.targetReleaseId).not.toBe(result.derivation.targetReleaseId)

    await cascadeDeleteProject(result.targetProjectId)
    expect(await db.projects.get(restoredId)).toBeTruthy()
  })

  it('短篇记录正确来源类型；剧本和漫画不能借内部作用域伪装成世界', async () => {
    const short = await createWorkspace(projectInput('一夜潮声', 10_000), {
      purpose: 'independent-work',
      kind: 'novel',
      novelProfile: 'short',
    })
    const derived = await deriveNovelToWorld({ sourceScope: short.scope })
    expect(derived.derivation.sourceKind).toBe('short-novel')
    expect(derived.release).toBeNull()
    expect((await db.worlds.get(derived.targetScope.worldId))?.currentVersion).toBe(0)

    const screenplay = await createWorkspace(projectInput('独立剧本'), {
      purpose: 'independent-work',
      kind: 'screenplay',
    })
    const countBefore = await db.projects.count()
    await expect(deriveNovelToWorld({ sourceScope: screenplay.scope })).rejects.toThrow('只有长篇或短篇小说')
    expect(await db.projects.count()).toBe(countBefore)

    const comic = await createWorkspace(projectInput('独立漫画'), {
      purpose: 'independent-work',
      kind: 'comic',
    })
    const countWithComic = await db.projects.count()
    await expect(deriveNovelToWorld({ sourceScope: comic.scope })).rejects.toThrow('只有长篇或短篇小说')
    expect(await db.projects.count()).toBe(countWithComic)
  })
})
