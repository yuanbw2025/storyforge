import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { embedTexts } from '../../src/lib/ai/adapters/embedding-adapter'
import {
  clearProjectRetrievalCache, embedQuery, ensureChunkEmbeddings,
  rebuildChapterChunks, retrieveChunks,
} from '../../src/lib/retrieval/retrieval'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { Chapter, EmbeddingConfig, OutlineNode } from '../../src/lib/types'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

const cfg: EmbeddingConfig = {
  enabled: true, provider: 'ollama', apiKey: '',
  baseUrl: 'http://embedding.invalid/v1', model: 'fixture',
}

function response(data: unknown): Response {
  const result = new Response('', { status: 200 })
  vi.spyOn(result, 'json').mockResolvedValue({ data })
  return result
}

async function seed(texts: string[]) {
  const { scope } = await seedCurrentWorkspace('SFQA078 isolated cache')
  const projectId = scope.projectId
  const now = Date.now()
  const volume = await db.outlineNodes.add(stampNewRecord<OutlineNode>(scope, 'outlineNodes', {
    projectId, parentId: null, type: 'volume', title: '卷', summary: '',
    order: 0, createdAt: now, updatedAt: now,
  }, { owner: 'work' }))
  const chapters: Chapter[] = []
  for (const [order, content] of texts.entries()) {
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord<OutlineNode>(scope, 'outlineNodes', {
      projectId, parentId: volume, type: 'chapter', title: `章${order}`, summary: '',
      order, createdAt: now, updatedAt: now,
    }, { owner: 'work' }))
    const chapter = stampNewRecord<Chapter>(scope, 'chapters', {
      projectId, outlineNodeId, title: `章${order}`, content, wordCount: content.length,
      status: 'draft', order, notes: '作者笔记', createdAt: now, updatedAt: now,
    }, { owner: 'work' })
    chapter.id = await db.chapters.add(chapter)
    chapters.push(chapter)
    await rebuildChapterChunks({ projectId, chapter, knownEntities: ['青灯'], scope })
  }
  return { projectId, chapters }
}

describe('SFQA078: embedding responses are complete, valid and ordered before cache writes', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); db.close() })

  it.each([
    ['ordered', [{ index: 0, embedding: [1, 2] }, { index: 1, embedding: [3, 4] }]],
    ['shuffled', [{ index: 1, embedding: [3, 4] }, { index: 0, embedding: [1, 2] }]],
    ['all indexes omitted', [{ embedding: [1, 2] }, { embedding: [3, 4] }]],
  ])('accepts %s under the batch index policy', async (_name, data) => {
    vi.stubGlobal('fetch', vi.fn(async () => response(data)))
    expect(await embedTexts(['first', 'second'], cfg)).toEqual([[1, 2], [3, 4]])
  })

  it.each([
    ['duplicate', [{ index: 0, embedding: [1] }, { index: 0, embedding: [2] }]],
    ['mixed missing', [{ index: 0, embedding: [1] }, { embedding: [2] }]],
    ['out of range', [{ index: 0, embedding: [1] }, { index: 2, embedding: [2] }]],
    ['negative', [{ index: 0, embedding: [1] }, { index: -1, embedding: [2] }]],
    ['fractional', [{ index: 0, embedding: [1] }, { index: 0.5, embedding: [2] }]],
    ['string index', [{ index: 0, embedding: [1] }, { index: '1', embedding: [2] }]],
    ['null index', [{ index: 0, embedding: [1] }, { index: null, embedding: [2] }]],
    ['null row', [null, { index: 1, embedding: [2] }]],
    ['non-numeric vector', [{ embedding: ['1'] }, { embedding: [2] }]],
    ['NaN vector', [{ embedding: [NaN] }, { embedding: [2] }]],
    ['infinite vector', [{ embedding: [1] }, { embedding: [Infinity] }]],
    ['unequal dimensions', [{ embedding: [1, 2] }, { embedding: [3] }]],
    ['empty vector', [{ embedding: [] }, { embedding: [3] }]],
    ['missing response', [{ index: 0, embedding: [1] }]],
  ])('rejects %s without returning an incomplete or invalid batch', async (_name, data) => {
    vi.stubGlobal('fetch', vi.fn(async () => response(data)))
    await expect(embedTexts(['first', 'second'], cfg)).rejects.toThrow()
  })

  it('does not write or count a failed batch, resumes only missing vectors, and preserves keyword fallback', async () => {
    const { projectId, chapters } = await seed([...Array.from({ length: 18 }, (_, i) => `青灯记录${i}。`), ''])
    const canonicalBefore = await db.chapters.where('projectId').equals(projectId).toArray()
    const all = await db.retrievalChunks.where('projectId').equals(projectId).toArray()
    expect(all).toHaveLength(18)
    const progress = vi.fn()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(Array.from({ length: 16 }, (_, index) => ({ index, embedding: [index, 1] })).reverse()))
      .mockResolvedValueOnce(response([{ index: 0, embedding: [16, 1] }, { index: 0, embedding: [17, 1] }]))
    vi.stubGlobal('fetch', fetchMock)
    await expect(ensureChunkEmbeddings({ projectId, cfg, onProgress: progress })).rejects.toThrow()
    expect(progress.mock.calls).toEqual([[16, 18]])
    const partial = await db.retrievalChunks.where('projectId').equals(projectId).toArray()
    expect(partial.slice(0, 16).map(row => row.embedding)).toEqual(Array.from({ length: 16 }, (_, i) => [i, 1]))
    expect(partial.slice(16).map(row => [row.embedding, row.embeddingModel])).toEqual([[null, null], [null, null]])

    fetchMock.mockResolvedValue(response([{ index: 1, embedding: [17, 1] }, { index: 0, embedding: [16, 1] }]))
    expect(await ensureChunkEmbeddings({ projectId, cfg })).toEqual({ embedded: 2, total: 2, skipped: 16 })
    expect(JSON.parse(String(fetchMock.mock.calls[2][1].body)).input).toEqual(all.slice(16).map(row => row.text))
    expect(await ensureChunkEmbeddings({ projectId, cfg })).toEqual({ embedded: 0, total: 0, skipped: 18 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    fetchMock.mockResolvedValue(response([{ index: 0, embedding: [Infinity] }]))
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const queryEmbedding = await embedQuery('青灯', cfg, projectId)
    expect(queryEmbedding).toBeNull()
    expect(warning).toHaveBeenCalledOnce()
    const found = await retrieveChunks({ projectId, currentChapterId: chapters[18].id!, queryTerms: ['青灯'], queryEmbedding })
    expect(found.length).toBeGreaterThan(0)
    expect(found.every(row => row.chunk.sourceChapterId !== chapters[18].id)).toBe(true)
    expect(await db.chapters.where('projectId').equals(projectId).toArray()).toEqual(canonicalBefore)
  })

  it('recovers a previously corrupted vector through explicit cache clear and rebuild without changing author content', async () => {
    const { projectId, chapters } = await seed(['青灯留在门前。'])
    const original = await db.chapters.get(chapters[0].id!)
    const chunk = await db.retrievalChunks.where('projectId').equals(projectId).first()
    await db.retrievalChunks.update(chunk!.id!, { embedding: [999], embeddingModel: 'ollama:fixture' })
    expect(await clearProjectRetrievalCache(projectId)).toEqual({ chunks: 1, summaries: 0 })
    await rebuildChapterChunks({ projectId, chapter: chapters[0], knownEntities: ['青灯'] })
    vi.stubGlobal('fetch', vi.fn(async () => response([{ index: 0, embedding: [1, 2] }])))
    expect(await ensureChunkEmbeddings({ projectId, cfg })).toEqual({ embedded: 1, total: 1, skipped: 0 })
    expect((await db.retrievalChunks.where('projectId').equals(projectId).first())?.embedding).toEqual([1, 2])
    expect(await db.chapters.get(chapters[0].id!)).toEqual(original)
  })
})
