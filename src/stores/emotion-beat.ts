/**
 * 情感节拍卡 Store — 管理章节的情感节拍规划
 */
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { EmotionBeatCard, EmotionBeat } from '../lib/types'
import { stringifyBeats, parseBeats } from '../lib/types/emotion-beat'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveReadScopeLike,
  resolveScopeLike,
  stampNewRecord,
  type WorkspaceScopeLike,
} from '../lib/workspace/scope'

const now = () => Date.now()

interface EmotionBeatStore {
  cards: EmotionBeatCard[]
  loading: boolean

  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
  getByChapter: (chapterId: number) => EmotionBeatCard | undefined
  saveCard: (card: Omit<EmotionBeatCard, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  updateCard: (id: number, data: Partial<EmotionBeatCard>) => Promise<void>
  deleteCard: (id: number) => Promise<void>

  /** 构建用于 AI 注入的节拍卡文本 */
  buildBeatContext: (chapterId: number) => string
}

// DB 中 beats 字段存 JSON 字符串，运行时是 EmotionBeat[]
// 需要序列化/反序列化处理
interface DBEmotionBeatCard extends Omit<EmotionBeatCard, 'beats'> {
  beats: string
}

function fromDB(row: DBEmotionBeatCard): EmotionBeatCard {
  return { ...row, beats: parseBeats(row.beats as string) }
}

function toBeatString(beats: EmotionBeat[]): string {
  return stringifyBeats(beats)
}

export const useEmotionBeatStore = create<EmotionBeatStore>((set, get) => ({
  cards: [],
  loading: false,

  loadAll: async (scopeInput) => {
    set({ loading: true })
    try {
      const rows = await readOwnedRows<EmotionBeatCard>(
        await resolveReadScopeLike(scopeInput),
        'emotionBeatCards',
        { owner: 'work' },
      )
      const cards = (rows as unknown as DBEmotionBeatCard[]).map(fromDB)
      set({ cards, loading: false })
      console.log(`[EmotionBeat] 加载 ${cards.length} 张节拍卡`)
    } catch (err) {
      console.error('[EmotionBeat] loadAll 失败:', err)
      set({ loading: false })
    }
  },

  getByChapter: (chapterId: number) => {
    return get().cards.find(c => c.chapterId === chapterId)
  },

  saveCard: async (card) => {
    try {
      const scope = await resolveScopeLike(card.projectId)
      const chapter = await db.chapters.get(card.chapterId)
      if (!chapter || !await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) {
        throw new Error('情感节拍卡关联章节不属于当前作品')
      }
      const dbCard = stampNewRecord(scope, 'emotionBeatCards', {
        ...card,
        beats: toBeatString(card.beats),
        createdAt: now(),
        updatedAt: now(),
      }, { owner: 'work' })

      // 如果已存在同章节的卡，更新它
      const existing = (await readOwnedRows<EmotionBeatCard>(
        scope,
        'emotionBeatCards',
        { owner: 'work' },
      )).find(c => c.chapterId === card.chapterId)
      if (existing?.id) {
         
        await db.emotionBeatCards.update(existing.id, dbCard as any)
        const updated = { ...card, id: existing.id, createdAt: existing.createdAt, updatedAt: now() }
        set({ cards: get().cards.map(c => c.id === existing.id ? updated : c) })
        console.log('[EmotionBeat] 更新节拍卡:', card.chapterTitle, existing.id)
        return existing.id
      }

       
      const id = await db.emotionBeatCards.add(dbCard as any) as number
      const newCard: EmotionBeatCard = { ...card, id, createdAt: now(), updatedAt: now() }
      set({ cards: [...get().cards, newCard] })
      console.log('[EmotionBeat] 新增节拍卡:', card.chapterTitle, id)
      return id
    } catch (err) {
      console.error('[EmotionBeat] saveCard 失败:', err)
      throw err
    }
  },

  updateCard: async (id, data) => {
    try {
      const existingRecord = await db.emotionBeatCards.get(id)
      if (!existingRecord) return
      const scope = await resolveScopeLike(existingRecord.projectId)
      const current = await db.emotionBeatCards.get(id)
      if (!current || !await assertRecordInScope(scope, 'emotionBeatCards', current, { owner: 'work' })) return
      const patch: Record<string, unknown> = { ...data, updatedAt: now() }
      if (data.beats) {
        patch.beats = toBeatString(data.beats)
      }
       
      await db.emotionBeatCards.update(id, patch as any)
      set({
        cards: get().cards.map(c => c.id === id ? { ...c, ...data, updatedAt: now() } : c),
      })
      console.log('[EmotionBeat] 更新:', id)
    } catch (err) {
      console.error('[EmotionBeat] updateCard 失败:', id, err)
      throw err
    }
  },

  deleteCard: async (id) => {
    try {
      const existingRecord = await db.emotionBeatCards.get(id)
      if (!existingRecord) return
      const scope = await resolveScopeLike(existingRecord.projectId)
      const current = await db.emotionBeatCards.get(id)
      if (!current || !await assertRecordInScope(scope, 'emotionBeatCards', current, { owner: 'work' })) return
      await db.emotionBeatCards.delete(id)
      set({ cards: get().cards.filter(c => c.id !== id) })
      console.log('[EmotionBeat] 删除:', id)
    } catch (err) {
      console.error('[EmotionBeat] deleteCard 失败:', id, err)
      throw err
    }
  },

  buildBeatContext: (chapterId: number) => {
    const card = get().cards.find(c => c.chapterId === chapterId)
    if (!card || !card.beats.length) return ''

    const parts: string[] = [`【本章情感节拍规划】`]
    if (card.overallArc) parts.push(`整体弧线：${card.overallArc}`)
    parts.push('')
    for (const beat of card.beats) {
      parts.push(`▸ ${beat.label}`)
      if (beat.sceneGoal) parts.push(`  场景目标：${beat.sceneGoal}`)
      if (beat.emotionTone) parts.push(`  情感基调：${beat.emotionTone}`)
      if (beat.readerFeeling) parts.push(`  读者感受：${beat.readerFeeling}`)
      if (beat.characterGrowth) parts.push(`  角色变化：${beat.characterGrowth}`)
    }

    return parts.join('\n')
  },
}))
