import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { db } from '../../src/lib/db/schema'
import {
  confirmTextOpenWorldCreatorBriefV1,
  startTextOpenWorldCreatorBriefSessionV1,
} from '../../src/lib/open-world/creator-brief'
import {
  createTextOpenWorldCreatorSourceLocatorV1,
  textOpenWorldCreatorSourceBindingFromSelectionV1,
} from '../../src/lib/open-world/creator-brief-persistence'
import {
  inspectTextOpenWorldCreatorNovelSourceV1,
  inspectTextOpenWorldCreatorWorldSourceV1,
} from '../../src/lib/open-world/creator-source'
import { PRODUCT_CATALOG_BY_ID_V1 } from '../../src/lib/product/product-catalog'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import type { AdaptationSourceSelectionV1, TextOpenWorldCreatorSourceSelectionV1 } from '../../src/lib/types'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentProductWorld } from '../helpers/current-product-world'

const SOURCE_REQUIRED = /WorldRelease|世界.*封存|派生.*世界|来源.*只读/
const ACKNOWLEDGEMENTS = {
  sourceIdentityReviewed: true,
  productBoundaryReviewed: true,
  unresolvedItemsClosed: true,
  directPublishWorkflowReviewed: true,
} as const

async function seedNovel() {
  const created = await createWorkspace({
    name: `005 synthetic novel ${crypto.randomUUID()}`,
    genres: ['fantasy'], status: 'drafting', description: 'Isolated source admission regression.',
    targetWordCount: 10_000, enableMultiWorld: false,
  }, { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
  const now = Date.now()
  const volumeId = await db.outlineNodes.add(stampNewRecord(created.scope, 'outlineNodes', {
    projectId: created.scope.projectId, workId: created.scope.workId,
    parentId: null, type: 'volume', title: '盐渠', summary: '调查断流。',
    order: 0, createdAt: now, updatedAt: now,
  }, { owner: 'work' })) as number
  const chapterIds: number[] = []
  for (let order = 0; order < 2; order += 1) {
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord(created.scope, 'outlineNodes', {
      projectId: created.scope.projectId, workId: created.scope.workId,
      parentId: volumeId, type: 'chapter', title: `调查${order + 1}`, summary: '守渠人找到线索。',
      order, createdAt: now, updatedAt: now,
    }, { owner: 'work' })) as number
    chapterIds.push(await db.chapters.add(stampNewRecord(created.scope, 'chapters', {
      projectId: created.scope.projectId, workId: created.scope.workId,
      outlineNodeId, title: `调查${order + 1}`, content: `<p>守渠人在第${order + 1}处断流点找到线索。</p>`,
      wordCount: 20, status: 'final', order, notes: '', createdAt: now, updatedAt: now,
    }, { owner: 'work' })) as number)
  }
  return { ...created, volumeId, chapterIds }
}

async function novelSelection(
  owned: Awaited<ReturnType<typeof seedNovel>>,
  mode: AdaptationSourceSelectionV1['mode'],
): Promise<TextOpenWorldCreatorSourceSelectionV1> {
  const selection: AdaptationSourceSelectionV1 = mode === 'entire-work'
    ? { mode }
    : mode === 'outline-subtree'
      ? { mode, outlineNodeId: owned.volumeId }
      : mode === 'chapter-range'
        ? { mode, startChapterId: owned.chapterIds[0]!, endChapterId: owned.chapterIds[1]! }
        : { mode: 'chapters', chapterIds: [owned.chapterIds[0]!] }
  return {
    sourceKind: 'novel', sourceScope: owned.scope, selection,
    preview: await inspectTextOpenWorldCreatorNovelSourceV1({ sourceScope: owned.scope, selection }),
  }
}

async function operationRows() {
  return {
    productions: await db.productProductions.toArray(),
    briefs: await db.productProductionBriefs.toArray(),
    commands: await db.productProductionCommands.toArray(),
    builds: await db.productBuilds.toArray(),
    artifacts: await db.productBuildArtifacts.toArray(),
    releases: await db.productReleases.toArray(),
    sessions: await db.productRuntimeSessions.toArray(),
    events: await db.productRuntimeEvents.toArray(),
    conversations: await db.agentConversations.toArray(),
    runs: await db.agentRuns.toArray(),
  }
}

describe('SFQA-005 · new text-open-world source admission', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('declares a sealed world as required without forcing independent adaptations through it', () => {
    expect(PRODUCT_CATALOG_BY_ID_V1.get('upper.text-open-world')).toMatchObject({
      sourcePolicy: 'world-release-required', requiresWorldReference: true,
    })
    for (const id of ['independent.longform', 'independent.shortform', 'independent.screenplay', 'independent.comic', 'independent.motion-drama'] as const) {
      expect(PRODUCT_CATALOG_BY_ID_V1.get(id)?.sourcePolicy).toBe('independent-work')
    }
  })

  it.each(['entire-work', 'outline-subtree', 'chapter-range', 'chapters'] as const)(
    'rejects a self-consistent novel %s before creating a consultation or production',
    async mode => {
      const owned = await seedNovel()
      const selection = await novelSelection(owned, mode)
      const beforeSource = await db.chapters.toArray()
      const before = await operationRows()
      await expect(startTextOpenWorldCreatorBriefSessionV1({
        selection, sessionKey: `quality005-${mode}`,
      })).rejects.toThrow(SOURCE_REQUIRED)
      expect(await operationRows()).toEqual(before)
      expect(await db.chapters.toArray()).toEqual(beforeSource)
    },
  )

  it('rejects a direct command with a valid novel locator and binding hash', async () => {
    const owned = await seedNovel()
    const selection = await novelSelection(owned, 'chapters')
    const before = await operationRows()
    await expect(executeProductProductionCommand({
      scope: owned.scope,
      command: {
        type: 'create-text-open-world-intent', commandId: 'quality005.direct-novel',
        productionKey: 'quality005.direct-novel', productType: 'text-open-world',
        sourceLocator: createTextOpenWorldCreatorSourceLocatorV1(selection),
        expectedSourceBindingHash: await hashCanonicalValue(textOpenWorldCreatorSourceBindingFromSelectionV1(selection)),
        userText: 'This previously accepted direct source must not authorize a new production.',
      },
    })).rejects.toThrow(SOURCE_REQUIRED)
    expect(await operationRows()).toEqual(before)
  })

  it('keeps the sealed WorldRelease consultation and explicit author Brief confirmation', async () => {
    const owned = await seedCurrentProductWorld(`005 world ${crypto.randomUUID()}`)
    const preview = await inspectTextOpenWorldCreatorWorldSourceV1({
      scope: owned.scope, localReleaseRecordId: owned.release.id!,
      expectedReleaseHash: owned.release.contentHash,
    })
    const started = await startTextOpenWorldCreatorBriefSessionV1({
      selection: {
        sourceKind: 'world-release', sourceScope: owned.scope, preview,
        localReleaseRecordId: owned.release.id!, expectedReleaseHash: owned.release.contentHash,
      },
      sessionKey: 'quality005-world',
    })
    const confirmed = await confirmTextOpenWorldCreatorBriefV1({
      session: started, draft: started.draft, acknowledgements: ACKNOWLEDGEMENTS,
    })
    expect(confirmed.confirmedBrief?.sourceBinding.kind).toBe('world-release')
    expect(await db.productProductionBriefs.count()).toBe(1)
    expect(await db.productBuilds.count()).toBe(0)
    expect(await db.productRuntimeSessions.count()).toBe(0)
    expect(await db.worldReleases.get(owned.release.id!)).toEqual(owned.release)
  }, 30_000)
})
