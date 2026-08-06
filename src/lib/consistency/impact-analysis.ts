/**
 * NS-6 · 全闭环 — 正文修改的 stale 传播 + 影响分析。
 *
 * 设计 §22.8 NS-6 / §26.4：改某章正文后——
 * - 该章派生记忆失效：handoff/摘要由 hash 自动 stale（NS-1）、检索块由 hash 重建（NS-5）；
 *   事实账本里【源自该章】且证据引文已不在新正文的【已确认】事实 → 标记 stale/待复核（§16.7），
 *   绝不自动删事实、绝不动 locked。
 * - 影响分析：列出"引用了该章事实/紧随其后的"后续章节，交作者复核——只提示、不自动改正文。
 */
import { db } from '../db/schema'
import type { TemporalFact } from '../types/temporal-fact'
import { normalizeChapterText } from '../ai/chapter-memory/text-normalization'
import { resolveCanonicalChapterSequence } from '../ai/chapter-memory/canonical-chapter-sequence'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveReadScopeLike,
  resolveScopeLike,
  type WorkspaceScopeLike,
} from '../world-engine/scope'
import type { Chapter, OutlineNode } from '../types'

/**
 * 正文改动后传播 stale：源自该章、证据已失效的【已确认】事实标记 stale（待作者重新确认）。
 * 不删事实、不动 locked、不碰候选/已否决。
 */
export async function propagateChapterEditStale(scopeInput: WorkspaceScopeLike, chapterId: number): Promise<{ demotedFacts: number }> {
  const scope = await resolveScopeLike(scopeInput)
  const chapter = await db.chapters.get(chapterId)
  if (!await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('来源章节不存在或不属于当前作品')
  }
  const content = normalizeChapterText(chapter?.content || '')
  const facts = (await readOwnedRows<TemporalFact>(scope, 'temporalFacts', { owner: 'work' }))
    .filter(f => f.sourceChapterId === chapterId && f.status === 'confirmed' && !f.locked)
  let demoted = 0
  for (const f of facts) {
    // 证据引文已不在新正文 → 该确认事实失去依据，标记 stale 待复核
    if (f.sourceQuote && !content.includes(f.sourceQuote) && f.id != null) {
      await db.temporalFacts.update(f.id, { status: 'stale', updatedAt: Date.now() })
      demoted++
    }
  }
  return { demotedFacts: demoted }
}

export interface EditImpact {
  /** 源自被改章的事实（作者应复核它们是否仍成立） */
  factsFromChapter: TemporalFact[]
  /** 规范章序在被改章之后、可能受影响需复核的后续章 id（按章序） */
  downstreamChapterIds: number[]
}

/**
 * 影响分析：改了某章后，列出源自该章的事实 + 其后续章（供作者复核）。只读、只提示，不自动改任何正文。
 */
export async function analyzeEditImpact(scopeInput: WorkspaceScopeLike, chapterId: number): Promise<EditImpact> {
  const scope = await resolveReadScopeLike(scopeInput)
  const source = await db.chapters.get(chapterId)
  if (!await assertRecordInScope(scope, 'chapters', source, { owner: 'work' })) {
    throw new Error('来源章节不存在或不属于当前作品')
  }
  const [facts, outlineNodes, chapters] = await Promise.all([
    readOwnedRows<TemporalFact>(scope, 'temporalFacts', { owner: 'work' })
      .then(rows => rows.filter(f => f.sourceChapterId === chapterId)),
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
  ])
  const { sequence } = resolveCanonicalChapterSequence(outlineNodes, chapters)
  const idx = sequence.findIndex(e => e.chapter.id === chapterId)
  const downstreamChapterIds = idx >= 0
    ? sequence.slice(idx + 1).map(e => e.chapter.id!).filter(id => id != null)
    : []
  return { factsFromChapter: facts, downstreamChapterIds }
}
