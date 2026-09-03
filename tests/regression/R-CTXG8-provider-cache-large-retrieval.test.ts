import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashChapterText } from '../../src/lib/ai/chapter-memory/text-normalization'
import { db } from '../../src/lib/db/schema'
import { CANON_RESOURCE_PROVIDER_V1 } from '../../src/lib/context-gateway/canon-provider'
import {
  createCachedContextResourceProviderV1,
  invalidateContextGatewayCacheV1,
  markContextGatewayCacheUncertainV1,
  restoreContextGatewayCacheReliabilityV1,
} from '../../src/lib/context-gateway/provider-cache'
import { planNarrativeRetrievalV1 } from '../../src/lib/context-gateway/narrative-retrieval'
import { generateWorkspaceUid } from '../../src/lib/memory/identity'
import type {
  ContextResourceDescriptorV1,
  ContextResourceProviderV1,
  FrozenResourceScopeV1,
  WorkspaceScope,
} from '../../src/lib/types'
import { ensureWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { stampNewRecord } from '../../src/lib/workspace/scope'

const NOW = 1_787_900_000_000
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const POLICY_HASH = 'c'.repeat(64)
const SCOPE_HASH = 'd'.repeat(64)

function fakeDescriptor(contentHash = HASH_A): ContextResourceDescriptorV1 {
  return {
    version: 1,
    resourceKey: 'chapter:chapter-test',
    sourceKey: 'ragSelection',
    kind: 'chapter',
    title: '测试章节',
    shortSummary: '仅用于缓存合同测试',
    authority: 'author-canon',
    contentRevision: contentHash === HASH_A ? 1 : 2,
    contentHash,
    policyRevision: 1,
    policyHash: POLICY_HASH,
    scope: { projectId: 1, worldId: 1, workId: 1, worldGroupId: null, chapterId: 1 },
    relations: [],
    sourceRefs: [{ table: 'chapters', recordId: 1, field: 'content', revision: 1, contentHash }],
    tokenEstimate: { index: 10, summary: 10, focused: 10, full: 10, original: 10 },
    availableDepths: ['index', 'summary', 'focused', 'full', 'original'],
    priority: 'normal',
  }
}

function fakeProvider(input: {
  providerId: string
  providerVersion?: string
  content: () => string
  contentHash: () => string
  calls: { list: number; search: number; read: number; original: number }
}): ContextResourceProviderV1 {
  const page = () => ({
    version: 1 as const,
    items: [fakeDescriptor(input.contentHash())],
    nextCursor: null,
    scopeFingerprint: SCOPE_HASH,
  })
  return {
    version: 'context-resource-provider-v1',
    providerId: input.providerId,
    providerVersion: input.providerVersion ?? 'fake-v1',
    normalizationVersion: 'fake-normalization-v1',
    kinds: ['chapter'],
    listMetadata: async () => { input.calls.list += 1; return page() },
    searchMetadata: async () => { input.calls.search += 1; return page() },
    read: async request => {
      input.calls.read += 1
      const descriptor = fakeDescriptor(input.contentHash())
      return {
        version: 1,
        descriptor,
        depth: request.depth,
        content: input.content(),
        contentHash: input.contentHash(),
        tokenCount: 1,
        sourceRefs: descriptor.sourceRefs,
      }
    },
    readOriginal: async request => {
      input.calls.original += 1
      return {
        version: 1,
        descriptor: fakeDescriptor(input.contentHash()),
        sourceRef: request.sourceRef,
        content: input.content(),
        contentHash: input.contentHash(),
        tokenCount: 1,
      }
    },
    fingerprint: async () => SCOPE_HASH,
  }
}

async function seedWorkspace(name = 'CTXG-8 缓存与长篇') {
  const projectId = await db.projects.add({
    workspaceUid: generateWorkspaceUid(), name, genre: 'fantasy', genres: ['fantasy'],
    status: 'drafting', description: '', targetWordCount: 1_000_000,
    createdAt: NOW, updatedAt: NOW,
  } as any) as number
  const ownership = await ensureWorkspaceOwnership(projectId)
  return { projectId, scope: ownership.scope }
}

async function addScoped(
  scope: WorkspaceScope,
  tableName: string,
  row: Record<string, unknown>,
  owner?: 'world' | 'work',
): Promise<number> {
  return (db as any)[tableName].add(stampNewRecord(scope, tableName, {
    projectId: scope.projectId,
    createdAt: NOW,
    updatedAt: NOW,
    ...row,
  }, owner ? { owner } : {})) as Promise<number>
}

function frozen(scope: WorkspaceScope): FrozenResourceScopeV1 {
  return { ...scope, worldGroupId: null }
}

beforeEach(async () => {
  restoreContextGatewayCacheReliabilityV1()
  await db.delete()
  await db.open()
})

afterEach(async () => {
  restoreContextGatewayCacheReliabilityV1()
  await db.delete()
})

describe('CTXG-8 · provider cache, invalidation and long-form retrieval', () => {
  it('caches metadata/read by scope and versioned result identity without changing the provider contract', async () => {
    const calls = { list: 0, search: 0, read: 0, original: 0 }
    let content = '第一版'
    let contentHash = HASH_A
    const cached = createCachedContextResourceProviderV1(fakeProvider({
      providerId: 'replaceable-backend-a', content: () => content, contentHash: () => contentHash, calls,
    }))
    const scope = { projectId: 1, worldId: 1, workId: 1, worldGroupId: null }
    const listRequest = { scope, kinds: ['chapter'] as const, limit: 10 }
    const readRequest = { scope, resourceKey: 'chapter:chapter-test', depth: 'full' as const, maxTokens: 100 }

    const firstPage = await cached.listMetadata(listRequest)
    firstPage.items[0].title = '调用方局部修改不得污染缓存'
    expect((await cached.listMetadata(listRequest)).items[0].title).toBe('测试章节')
    expect((await cached.read(readRequest)).content).toBe('第一版')
    expect((await cached.read(readRequest)).content).toBe('第一版')
    expect(calls).toMatchObject({ list: 1, read: 1 })

    content = '第二版'
    contentHash = HASH_B
    invalidateContextGatewayCacheV1('test-content-write')
    expect((await cached.read(readRequest)).content).toBe('第二版')
    expect(calls.read).toBe(2)

    const replacementCalls = { list: 0, search: 0, read: 0, original: 0 }
    const replacement = createCachedContextResourceProviderV1(fakeProvider({
      providerId: 'replaceable-backend-b', providerVersion: 'backend-v2',
      content: () => '替换后端', contentHash: () => HASH_B, calls: replacementCalls,
    }))
    expect((await replacement.read(readRequest)).content).toBe('替换后端')
    expect(replacement.version).toBe('context-resource-provider-v1')
  })

  it('fails closed to live provider reads whenever cache invalidation reliability is uncertain', async () => {
    const calls = { list: 0, search: 0, read: 0, original: 0 }
    const cached = createCachedContextResourceProviderV1(fakeProvider({
      providerId: 'uncertain-cache-provider', content: () => '实时 Canon', contentHash: () => HASH_A, calls,
    }))
    const request = {
      scope: { projectId: 1, worldId: 1, workId: 1, worldGroupId: null },
      resourceKey: 'chapter:chapter-test', depth: 'full' as const, maxTokens: 100,
    }
    markContextGatewayCacheUncertainV1('simulated-listener-failure')
    await cached.read(request)
    await cached.read(request)
    expect(calls.read).toBe(2)
  })

  it('invalidates a cached Canon read after a direct Dexie write and never returns the known old field', async () => {
    const fixture = await seedWorkspace()
    const worldviewId = await addScoped(fixture.scope, 'worldviews', {
      worldGroupId: null,
      races: '旧事实：潮民畏惧月光。',
    }, 'world')
    const page = await CANON_RESOURCE_PROVIDER_V1.searchMetadata({
      scope: frozen(fixture.scope), query: '潮民', kinds: ['worldview-field'], limit: 100,
    })
    const firstCatalogPage = await CANON_RESOURCE_PROVIDER_V1.listMetadata({
      scope: frozen(fixture.scope), kinds: ['worldview-field'], limit: 1,
    })
    expect(firstCatalogPage.nextCursor).toBeTruthy()
    const races = page.items.find(item => item.resourceKey.endsWith(':field:races'))!
    const request = { scope: frozen(fixture.scope), resourceKey: races.resourceKey, depth: 'full' as const, maxTokens: 1_000 }
    expect((await CANON_RESOURCE_PROVIDER_V1.read(request)).content).toContain('畏惧月光')
    expect((await CANON_RESOURCE_PROVIDER_V1.read(request)).content).toContain('畏惧月光')

    await db.worldviews.update(worldviewId, { races: '新事实：潮民以月光导航。', updatedAt: NOW + 1 })
    const current = await CANON_RESOURCE_PROVIDER_V1.read(request)
    expect(current.content).toContain('以月光导航')
    expect(current.content).not.toContain('畏惧月光')
    expect(current.descriptor.contentHash).not.toBe(races.contentHash)
    await expect(CANON_RESOURCE_PROVIDER_V1.listMetadata({
      scope: frozen(fixture.scope), kinds: ['worldview-field'], limit: 1,
      cursor: firstCatalogPage.nextCursor!,
    })).rejects.toThrow('目录 cursor 不属于当前 scope/filter/query')
  })

  it('keeps a million-character body out of metadata, uses valid chunks/summaries/dossier as hints, and falls back to Canon for a stale index', async () => {
    const fixture = await seedWorkspace('百万字检索 fixture')
    const volumeId = await addScoped(fixture.scope, 'outlineNodes', {
      parentId: null, type: 'volume', title: '第一卷', summary: '潮海远征', order: 0, worldGroupId: null,
    }, 'work')
    const outlineId = await addScoped(fixture.scope, 'outlineNodes', {
      parentId: volumeId, type: 'chapter', title: '第一章', summary: '漫长航程', order: 0, worldGroupId: null,
    }, 'work')
    const marker = '末尾琥珀信标'
    const body = `<p>${'潮声与盐雾。'.repeat(170_000)}${marker}</p>`
    expect(body.length).toBeGreaterThan(1_000_000)
    const chapterId = await addScoped(fixture.scope, 'chapters', {
      outlineNodeId: outlineId, title: '百万字章节', content: body,
      wordCount: 1_000_000, status: 'draft', order: 0, notes: '', summary: '',
    }, 'work')
    const sourceHash = await hashChapterText(body)
    await addScoped(fixture.scope, 'retrievalChunks', {
      worldGroupId: null, sourceChapterId: chapterId, chunkIndex: 0,
      text: `最后一块记录了${marker}`, keywords: [marker], embedding: [1, 0],
      embeddingModel: 'test-only', sourceTextHash: sourceHash,
    }, 'work')
    await addScoped(fixture.scope, 'narrativeSummaryNodes', {
      worldGroupId: null, level: 'chapter', sourceChapterId: chapterId,
      sourceOutlineNodeId: outlineId, title: '第一章摘要', summary: '被遗忘的双月誓言仍未兑现',
      keywords: ['双月誓言'], sourceHash, status: 'verified', generatedBy: 'system-rollup',
    }, 'work')
    await addScoped(fixture.scope, 'temporalFacts', {
      worldGroupId: null, characterId: null, subjectName: '领航员', predicate: 'location', factKind: 'state',
      value: '盐海', sourceType: 'chapter', sourceChapterId: chapterId, sourceQuote: '领航员仍在盐海。',
      validFromChapterId: chapterId, validToChapterId: null, status: 'confirmed', locked: true,
    }, 'work')

    const scope = frozen(fixture.scope)
    const listStarted = performance.now()
    const metadata = await CANON_RESOURCE_PROVIDER_V1.listMetadata({ scope, kinds: ['chapter'], limit: 100 })
    const firstListMs = performance.now() - listStarted
    const serialized = JSON.stringify(metadata)
    expect(firstListMs).toBeLessThan(10_000)
    expect(serialized.length).toBeLessThan(50_000)
    expect(serialized).not.toContain(marker)
    expect(metadata.items.every(item => !('content' in item) && !('body' in item) && !('original' in item))).toBe(true)

    const cachedStarted = performance.now()
    const cachedMetadata = await CANON_RESOURCE_PROVIDER_V1.listMetadata({ scope, kinds: ['chapter'], limit: 100 })
    expect(performance.now() - cachedStarted).toBeLessThan(250)
    expect(cachedMetadata).toEqual(metadata)

    const indexed = await CANON_RESOURCE_PROVIDER_V1.searchMetadata({
      scope, query: marker, kinds: ['chapter'], limit: 100,
    })
    expect(indexed.items.some(item => item.sourceRefs.some(ref => ref.recordId === chapterId))).toBe(true)
    const summaryPlan = await planNarrativeRetrievalV1({ scope, query: '双月誓言' })
    expect(summaryPlan.diagnostics.verifiedSummaryCount).toBe(1)
    expect(summaryPlan.candidateRecordKeys.has(`chapters:${chapterId}`)).toBe(true)
    const dossierPlan = await planNarrativeRetrievalV1({
      scope, query: '领航员', timeRange: { throughChapterId: chapterId },
    })
    expect(dossierPlan.diagnostics.dossierSourceCount).toBeGreaterThan(0)
    expect(dossierPlan.diagnostics.embeddingAuthoritative).toBe(false)

    const currentMarker = '末尾鲸骨密码'
    const currentBody = `<p>${'潮声与盐雾。'.repeat(170_000)}${currentMarker}</p>`
    await db.chapters.update(chapterId, { content: currentBody, updatedAt: NOW + 2 })
    const fallbackPlan = await planNarrativeRetrievalV1({ scope, query: currentMarker })
    expect(fallbackPlan.diagnostics.chunks).toBe('degraded')
    expect(fallbackPlan.canonFallbackRecordKeys.has(`chapters:${chapterId}`)).toBe(true)
    const fallback = await CANON_RESOURCE_PROVIDER_V1.searchMetadata({
      scope, query: currentMarker, kinds: ['chapter'], limit: 100,
    })
    expect(fallback.items.some(item => item.sourceRefs.some(ref => ref.recordId === chapterId))).toBe(true)
    expect(JSON.stringify(fallback)).not.toContain(marker)
  }, 30_000)
})
