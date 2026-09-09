import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  inspectTextOpenWorldCreatorNovelSourceV1,
  inspectTextOpenWorldCreatorWorldSourceV1,
  listTextOpenWorldCreatorNovelSourceCatalogV1,
  listTextOpenWorldCreatorWorldSourcesV1,
} from '../../src/lib/open-world/creator-source'
import {
  freezeTextOpenWorldNovelSourceV1,
  prepareTextOpenWorldNovelSourceSnapshotV1,
} from '../../src/lib/open-world/source-pin'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { WorkspaceScope } from '../../src/lib/types'
import { seedCurrentProductWorld } from '../helpers/current-product-world'

const HASH = 'a'.repeat(64)
const SECRET_BODY = '只可参与内部哈希、绝不能返回给创作者入口的小说正文。'

async function protectedDatabaseSnapshot() {
  const entries = await Promise.all([...db.tables]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(async table => [table.name, await table.toArray()] as const))
  return Object.fromEntries(entries)
}

async function seedNovel(name: string, options: {
  withNarrative?: boolean
  withStoryCore?: boolean
} = {}) {
  const created = await createWorkspace({
    name,
    genres: ['fantasy'],
    status: 'drafting',
    description: '盐脊巡井人的小说来源。',
    targetWordCount: 120_000,
    enableMultiWorld: false,
  }, { purpose: 'longform', kind: 'novel', novelProfile: 'long' })
  const now = Date.now()
  if (options.withNarrative === false) return { ...created, chapterId: null, now }
  const volumeId = await db.outlineNodes.add(stampNewRecord(created.scope, 'outlineNodes', {
    projectId: created.scope.projectId,
    parentId: null,
    type: 'volume',
    title: '盐脊卷',
    summary: '巡井人从断流调查走向城邦边境。',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as never, { owner: 'work' })) as number
  const chapterOutlineId = await db.outlineNodes.add(stampNewRecord(created.scope, 'outlineNodes', {
    projectId: created.scope.projectId,
    parentId: volumeId,
    type: 'chapter',
    title: '第一章 断流',
    summary: '巡井人在旧渠发现被抹去的盐印。',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as never, { owner: 'work' })) as number
  const chapterId = await db.chapters.add(stampNewRecord(created.scope, 'chapters', {
    projectId: created.scope.projectId,
    outlineNodeId: chapterOutlineId,
    title: '第一章 断流',
    content: `<p>${SECRET_BODY.repeat(24)}</p>`,
    wordCount: SECRET_BODY.length * 24,
    status: 'final',
    order: 0,
    notes: '',
    summary: '巡井人在旧渠发现被抹去的盐印。',
    createdAt: now,
    updatedAt: now,
  } as never, { owner: 'work' })) as number
  if (options.withStoryCore !== false) {
    await db.storyCores.add(stampNewRecord(created.scope, 'storyCores', {
      projectId: created.scope.projectId,
      theme: '成长与守护',
      centralConflict: '巡井人必须在城邦秩序与断流真相之间作出选择。',
      plotPattern: '调查—成长—远行—回归',
      logline: '巡井人追查正在吞噬各地水源的旧日契约。',
      concept: '从小说拆解为文字开放世界',
      mainPlot: '逐区追查断流源头并完成主线目标。',
      subPlots: '各地角色、势力和地域命运故事。',
      createdAt: now,
      updatedAt: now,
    } as never, { owner: 'work' }))
  }
  return { ...created, chapterId, now }
}

function authorization(productInstanceKey: string, authorizedAt: number) {
  return {
    productInstanceKey,
    briefRevision: 1,
    briefHash: HASH,
    authorStartRevision: 1,
    authorizationNonce: `nonce-${productInstanceKey}`,
    rightsBasis: 'author-owned' as const,
    rightsNote: '专项测试中的作者授权。',
    authorizedAt,
  }
}

describe('R-OPEN-WORLD5 · 创作者双来源目录与只读预检', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('只通过 WorldReference 目录与中立语义目录校验世界 owner/id/hash，并返回能力、资源和需求预检', async () => {
    const owned = await seedCurrentProductWorld(`TOW G5 世界 ${crypto.randomUUID()}`)
    const before = await protectedDatabaseSnapshot()

    const candidates = await listTextOpenWorldCreatorWorldSourcesV1(owned.scope)
    expect(candidates).toHaveLength(1)
    const candidate = candidates[0]!
    expect(candidate).toMatchObject({
      sourceKind: 'world-release',
      worldReference: {
        localReleaseRecordId: owned.release.id,
        releaseVersion: owned.release.version,
        releaseHash: owned.release.contentHash,
      },
      worldName: owned.world.name,
    })
    expect(candidate.worldReference.releaseHash).toHaveLength(64)
    expect(candidate.capabilities.length).toBeGreaterThan(0)
    expect(candidate.resourceCounts.totalResources).toBeGreaterThan(0)
    expect(candidate.resourceCounts.totalRows).toBeGreaterThan(0)
    expect(candidate.requirements.find(item => item.key === 'author-selected-world-sources'))
      .toMatchObject({ status: 'matched', level: 'stable-required' })
    expect(candidate.readiness).not.toBe('blocked')
    const serialized = JSON.stringify(candidate)
    expect(serialized).not.toContain('manifestJson')
    expect(serialized).not.toContain('selectedTables')
    expect(serialized).not.toContain('"records"')

    await expect(inspectTextOpenWorldCreatorWorldSourceV1({
      scope: owned.scope,
      localReleaseRecordId: owned.release.id!,
      expectedReleaseHash: owned.release.contentHash,
    })).resolves.toEqual(candidate)
    await expect(inspectTextOpenWorldCreatorWorldSourceV1({
      scope: owned.scope,
      localReleaseRecordId: owned.release.id!,
      expectedReleaseHash: 'b'.repeat(64),
    })).rejects.toThrow(/Hash 已变化|身份不匹配/)
    expect(await protectedDatabaseSnapshot()).toEqual(before)

    const other = await seedCurrentProductWorld(`TOW G5 另一世界 ${crypto.randomUUID()}`)
    const beforeCrossScope = await protectedDatabaseSnapshot()
    await expect(inspectTextOpenWorldCreatorWorldSourceV1({
      scope: other.scope,
      localReleaseRecordId: owned.release.id!,
      expectedReleaseHash: owned.release.contentHash,
    })).rejects.toThrow(/不属于给定 worldScope/)
    expect(await protectedDatabaseSnapshot()).toEqual(beforeCrossScope)
  }, 30_000)

  it('复用小说改编选择目录，预览与随后正式 freeze 在相同内容和 selection 下产生完全相同的来源 Hash', async () => {
    const novel = await seedNovel(`TOW G5 小说 ${crypto.randomUUID()}`)
    const selection = { mode: 'entire-work' } as const
    const before = await protectedDatabaseSnapshot()

    const catalog = await listTextOpenWorldCreatorNovelSourceCatalogV1(novel.scope)
    expect(catalog).toMatchObject({
      sourceKind: 'novel',
      workCode: novel.work.code,
      workTitle: novel.work.title,
      coverage: 'full-text',
      range: { outlineCount: 2, chapterCount: 1 },
    })
    expect(catalog.chapters[0]).toMatchObject({ title: '第一章 断流', hasContent: true })
    const preview = await inspectTextOpenWorldCreatorNovelSourceV1({
      sourceScope: novel.scope,
      selection,
    })
    const prepared = await prepareTextOpenWorldNovelSourceSnapshotV1({
      sourceScope: novel.scope,
      selection,
    })
    expect(preview).toMatchObject({
      workCode: novel.work.code,
      coverage: 'full-text',
      selection: { mode: 'entire-work', selectedChapterCount: 1, selectedOutlineCount: 2 },
      writtenChapterCount: 1,
    })
    expect(preview.sourceVersionHash).toHaveLength(64)
    expect(preview.sourceBoundaryHash).toHaveLength(64)
    expect(preview.sourceVersionHash).toBe(prepared.sourceVersionHash)
    expect(preview.sourceBoundaryHash).toBe(prepared.sourceBoundaryHash)
    expect(JSON.stringify({ catalog, preview, prepared })).not.toContain(SECRET_BODY)

    const bundle = await freezeTextOpenWorldNovelSourceV1({
      targetScope: novel.scope,
      sourceScope: novel.scope,
      selection,
      expectedSourceVersionHash: preview.sourceVersionHash,
      expectedSourceBoundaryHash: preview.sourceBoundaryHash,
      authorization: authorization('tow.g5.creator.novel', novel.now),
      createdAt: novel.now,
    })
    expect(bundle.pin.sourceVersionHash).toBe(preview.sourceVersionHash)
    expect(bundle.pin.sourceBoundaryHash).toBe(preview.sourceBoundaryHash)
    const formalUnitIdentities = bundle.pin.units.map(unit => ({
      unitKey: unit.unitKey,
      kind: unit.kind,
      order: unit.order,
      partIndex: unit.partIndex,
      partCount: unit.partCount,
      readDepth: unit.readDepth,
      sourceResourceKey: unit.sourceResourceKey,
      sourceContentHash: unit.sourceContentHash,
    }))
    await expect(hashProductProductionValueV2({
      workCode: novel.work.code,
      selectionMode: selection.mode,
      units: formalUnitIdentities,
    })).resolves.toBe(preview.sourceVersionHash)
    await expect(hashProductProductionValueV2({
      sourceVersionHash: preview.sourceVersionHash,
      source: bundle.pin.source,
      units: formalUnitIdentities,
    })).resolves.toBe(preview.sourceBoundaryHash)
    for (const unit of bundle.units) {
      expect(unit.payload.contentText).not.toBeNull()
      await expect(hashProductProductionValueV2(unit.payload.contentText))
        .resolves.toBe(unit.payload.sourceContentHash)
    }
    expect(await protectedDatabaseSnapshot()).toEqual(before)

    await db.chapters.update(novel.chapterId!, {
      content: '<p>来源正文已经发生明确变化。</p>',
      updatedAt: novel.now + 1,
    })
    const afterSourceEdit = await protectedDatabaseSnapshot()
    await expect(freezeTextOpenWorldNovelSourceV1({
      targetScope: novel.scope,
      sourceScope: novel.scope,
      selection,
      expectedSourceVersionHash: preview.sourceVersionHash,
      expectedSourceBoundaryHash: preview.sourceBoundaryHash,
      authorization: authorization('tow.g5.creator.novel', novel.now + 1),
      createdAt: novel.now + 1,
    })).rejects.toThrow(/预览后变化/)
    const changed = await inspectTextOpenWorldCreatorNovelSourceV1({
      sourceScope: novel.scope,
      selection,
    })
    expect(changed.sourceVersionHash).not.toBe(preview.sourceVersionHash)
    expect(changed.sourceBoundaryHash).not.toBe(preview.sourceBoundaryHash)
    expect(await protectedDatabaseSnapshot()).toEqual(afterSourceEdit)
  }, 30_000)

  it('对非法 scope、串入其他小说的 selection 和空内容一律 fail-closed', async () => {
    const first = await seedNovel(`TOW G5 来源 A ${crypto.randomUUID()}`)
    const second = await seedNovel(`TOW G5 来源 B ${crypto.randomUUID()}`)
    const empty = await seedNovel(`TOW G5 空来源 ${crypto.randomUUID()}`, { withNarrative: false })
    const before = await protectedDatabaseSnapshot()

    const invalidScope: WorkspaceScope = {
      ...first.scope,
      workId: second.scope.workId,
    }
    await expect(listTextOpenWorldCreatorNovelSourceCatalogV1(invalidScope))
      .rejects.toThrow(/scope|Work|工作区|来源/i)
    await expect(inspectTextOpenWorldCreatorNovelSourceV1({
      sourceScope: first.scope,
      selection: { mode: 'chapters', chapterIds: [second.chapterId!] },
    })).rejects.toThrow(/越界|跨 Work|不存在/)
    await expect(listTextOpenWorldCreatorNovelSourceCatalogV1(empty.scope))
      .rejects.toThrow(/没有正文或有效故事\/大纲内容/)
    expect(await protectedDatabaseSnapshot()).toEqual(before)
  }, 30_000)
})
