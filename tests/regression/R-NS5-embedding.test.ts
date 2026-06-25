/**
 * R-NS5-embedding · 语义检索通道（NS-5 embedding）
 * 守卫：① 混合打分让语义命中超过关键词未命中；② 跨模型向量不混算；
 *      ③ 回填幂等可续跑、换模型重算；④ 无配置/失败→优雅退回纯关键词。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { rebuildChapterChunks, retrieveChunks, ensureChunkEmbeddings, embedQuery } from '../../src/lib/retrieval/retrieval'
import type { EmbeddingConfig } from '../../src/lib/types'

const now = Date.now()
async function seed(texts: string[]) {
  const pid = await db.projects.add({ name: 'P', genre: 'x', description: '', targetWordCount: 0, enableMultiWorld: false, createdAt: now, updatedAt: now } as any) as number
  const vol = await db.outlineNodes.add({ projectId: pid, parentId: null, type: 'volume', title: '卷', summary: '', order: 0, createdAt: now, updatedAt: now } as any) as number
  const chaps: number[] = []
  for (let i = 0; i < texts.length; i++) {
    const n = await db.outlineNodes.add({ projectId: pid, parentId: vol, type: 'chapter', title: `第${i + 1}章`, summary: '', order: i, createdAt: now, updatedAt: now } as any) as number
    const c = await db.chapters.add({ projectId: pid, outlineNodeId: n, title: `第${i + 1}章`, content: texts[i], wordCount: 0, status: 'draft', order: i, notes: '', createdAt: now, updatedAt: now } as any) as number
    chaps.push(c)
  }
  return { pid, chaps }
}
const cfg = (over: Partial<EmbeddingConfig> = {}): EmbeddingConfig => ({ enabled: true, provider: 'ollama', apiKey: '', baseUrl: 'http://x/v1', model: 'bge-m3', ...over })

describe('NS-5 · embedding 语义检索通道', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close(); vi.restoreAllMocks() })

  it('混合打分：语义命中的块排在关键词未命中之上', async () => {
    const { pid, chaps } = await seed(['第一章 甲段落。', '第二章 乙段落。', '第三章 当前。'])
    for (const c of chaps) await rebuildChapterChunks({ projectId: pid, chapter: (await db.chapters.get(c))!, knownEntities: [] })
    // 手填向量（模型 bge-m3）：chap0 与查询同向，chap1 近正交
    const all = await db.retrievalChunks.where('projectId').equals(pid).toArray()
    for (const ch of all) {
      const vec = ch.sourceChapterId === chaps[0] ? [1, 0, 0] : [0.1, 1, 0]
      await db.retrievalChunks.update(ch.id!, { embedding: vec, embeddingModel: 'ollama:bge-m3' })
    }
    const got = await retrieveChunks({
      projectId: pid, currentChapterId: chaps[2], queryTerms: ['无关词'],
      queryEmbedding: [1, 0, 0], queryEmbeddingModel: 'ollama:bge-m3', topK: 5,
    })
    expect(got.length).toBeGreaterThan(0)
    expect(got[0].chunk.sourceChapterId).toBe(chaps[0]) // 语义最近者居首
  })

  it('跨模型不混算：查询模型与块向量模型不符则余弦不计', async () => {
    const { pid, chaps } = await seed(['第一章 内容。', '第二章 当前。'])
    await rebuildChapterChunks({ projectId: pid, chapter: (await db.chapters.get(chaps[0]))!, knownEntities: [] })
    const ch = (await db.retrievalChunks.where('projectId').equals(pid).toArray())[0]
    await db.retrievalChunks.update(ch.id!, { embedding: [1, 0, 0], embeddingModel: 'openai:text-embedding-3-small' })
    // 查询用 bge-m3，块是 openai → 余弦应被跳过，无关键词命中 → 不召回
    const got = await retrieveChunks({
      projectId: pid, currentChapterId: chaps[1], queryTerms: ['xyz'],
      queryEmbedding: [1, 0, 0], queryEmbeddingModel: 'ollama:bge-m3', topK: 5,
    })
    expect(got.length).toBe(0)
  })

  it('回填幂等 + 换模型重算（mock embeddings 接口）', async () => {
    const { pid, chaps } = await seed(['第一章 文本一。\n\n第二段。'])
    await rebuildChapterChunks({ projectId: pid, chapter: (await db.chapters.get(chaps[0]))!, knownEntities: [] })
    let calls = 0
    const fetchMock = vi.fn(async (_url: string, opts: any) => {
      calls++
      const input = JSON.parse(opts.body).input as string[]
      return { ok: true, json: async () => ({ data: input.map((_t, i) => ({ index: i, embedding: [1, 2, 3] })) }) } as any
    })
    vi.stubGlobal('fetch', fetchMock)

    const r1 = await ensureChunkEmbeddings({ projectId: pid, cfg: cfg() })
    expect(r1.embedded).toBeGreaterThan(0)
    const callsAfterFirst = calls
    // 再跑：向量已是当前模型 → 不重嵌
    const r2 = await ensureChunkEmbeddings({ projectId: pid, cfg: cfg() })
    expect(r2.embedded).toBe(0)
    expect(calls).toBe(callsAfterFirst)
    // 换模型 → 全部重算
    const r3 = await ensureChunkEmbeddings({ projectId: pid, cfg: cfg({ model: 'text-embedding-3-small', provider: 'openai', apiKey: 'sk-x' }) })
    expect(r3.embedded).toBe(r1.embedded)
    expect(calls).toBeGreaterThan(callsAfterFirst)
    const rows = await db.retrievalChunks.where('projectId').equals(pid).toArray()
    expect(rows.every(c => c.embeddingModel === 'openai:text-embedding-3-small')).toBe(true)
  })

  it('优雅降级：未启用→不嵌；接口失败→embedQuery 返回 null', async () => {
    const { pid } = await seed(['第一章。'])
    const off = await ensureChunkEmbeddings({ projectId: pid, cfg: cfg({ enabled: false }) })
    expect(off.embedded).toBe(0)
    expect(await embedQuery('查询', cfg({ enabled: false }))).toBe(null) // 未启用
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom') }))
    expect(await embedQuery('查询', cfg())).toBe(null) // 失败退回 null（调用方走关键词）
  })
})
