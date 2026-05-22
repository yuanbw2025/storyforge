/**
 * 状态表 Store — 管理角色/地点/物品/势力的状态卡 CRUD
 */
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { StateCard, StateCategory, StateDiffItem } from '../lib/types'
import { parseFields, stringifyFields } from '../lib/types/state-card'

const now = () => Date.now()

interface StateCardStore {
  cards: StateCard[]
  loading: boolean

  /** 加载项目的全部状态卡 */
  loadAll: (projectId: number) => Promise<void>

  /** 新增一张状态卡 */
  addCard: (card: Omit<StateCard, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>

  /** 更新一张状态卡 */
  updateCard: (id: number, data: Partial<StateCard>) => Promise<void>

  /** 删除一张状态卡 */
  deleteCard: (id: number) => Promise<void>

  /** 批量应用 diff（用于章后审核确认） */
  applyDiffs: (projectId: number, diffs: StateDiffItem[], chapterId?: number) => Promise<void>

  /** 构建用于 AI 注入的状态表文本（全量） */
  buildStateContext: () => string

  /** 按需召回：只注入与参考文本相关的状态卡 */
  buildSelectiveStateContext: (referenceText: string, extraIds?: number[]) => { text: string; matchedIds: number[]; allIds: number[] }
}

export const useStateCardStore = create<StateCardStore>((set, get) => ({
  cards: [],
  loading: false,

  loadAll: async (projectId: number) => {
    set({ loading: true })
    try {
      const cards = await db.stateCards.where('projectId').equals(projectId).toArray()
      set({ cards, loading: false })
    } catch (err) {
      console.error('[StateCard] loadAll 失败:', err)
      set({ loading: false })
    }
  },

  addCard: async (card) => {
    try {
      const newCard: StateCard = { ...card, createdAt: now(), updatedAt: now() }
      const id = await db.stateCards.add(newCard) as number
      set({ cards: [...get().cards, { ...newCard, id }] })
      console.log('[StateCard] 新增:', card.entityName, id)
      return id
    } catch (err) {
      console.error('[StateCard] addCard 失败:', err)
      throw err
    }
  },

  updateCard: async (id, data) => {
    try {
      const patch = { ...data, updatedAt: now() }
      await db.stateCards.update(id, patch)
      set({ cards: get().cards.map(c => c.id === id ? { ...c, ...patch } : c) })
    } catch (err) {
      console.error('[StateCard] updateCard 失败:', id, err)
      throw err
    }
  },

  deleteCard: async (id) => {
    try {
      await db.stateCards.delete(id)
      set({ cards: get().cards.filter(c => c.id !== id) })
      console.log('[StateCard] 删除:', id)
    } catch (err) {
      console.error('[StateCard] deleteCard 失败:', id, err)
      throw err
    }
  },

  applyDiffs: async (projectId, diffs, chapterId) => {
    const { cards } = get()
    const updates: Promise<void>[] = []
    const newCards: StateCard[] = []

    for (const diff of diffs) {
      // 找到对应的状态卡
      const existing = cards.find(
        c => c.entityName === diff.entityName && c.category === diff.category
      )

      if (existing && existing.id) {
        // 更新已有卡的字段
        const fields = parseFields(existing.fields)
        const fieldIdx = fields.findIndex(f => f.key === diff.field)
        if (fieldIdx >= 0) {
          fields[fieldIdx].value = diff.newValue
        } else {
          fields.push({ key: diff.field, value: diff.newValue })
        }
        const patch: Partial<StateCard> = {
          fields: stringifyFields(fields),
          updatedAt: now(),
        }
        if (chapterId) patch.lastChapterId = chapterId
        updates.push(
          db.stateCards.update(existing.id, patch).then(() => {
            // 立即更新内存状态
            set({
              cards: get().cards.map(c =>
                c.id === existing.id ? { ...c, ...patch } : c
              ),
            })
          })
        )
      } else {
        // 新实体 → 创建新卡
        const newCard: StateCard = {
          projectId,
          category: diff.category,
          entityName: diff.entityName,
          fields: stringifyFields([{ key: diff.field, value: diff.newValue }]),
          lastChapterId: chapterId,
          createdAt: now(),
          updatedAt: now(),
        }
        newCards.push(newCard)
      }
    }

    try {
      // 批量写入新卡
      for (const nc of newCards) {
        const id = await db.stateCards.add(nc) as number
        set({ cards: [...get().cards, { ...nc, id }] })
      }
      // 等待所有更新
      await Promise.all(updates)
      console.log(`[StateCard] applyDiffs: ${diffs.length} 条变更已应用（新增 ${newCards.length}，更新 ${updates.length}）`)
    } catch (err) {
      console.error('[StateCard] applyDiffs 失败:', err)
      throw err
    }
  },

  buildStateContext: () => {
    const { cards } = get()
    if (!cards.length) return ''

    const grouped = new Map<StateCategory, StateCard[]>()
    for (const c of cards) {
      const list = grouped.get(c.category) || []
      list.push(c)
      grouped.set(c.category, list)
    }

    const LABELS: Record<StateCategory, string> = {
      character: '角色', location: '地点', item: '物品', faction: '势力', event: '事件',
    }

    const parts: string[] = ['【当前状态表】']
    for (const [cat, catCards] of grouped) {
      parts.push(`\n[${LABELS[cat]}]`)
      for (const card of catCards) {
        const fields = parseFields(card.fields)
        const fieldStr = fields.map(f => `${f.key}：${f.value}`).join(' | ')
        parts.push(`- ${card.entityName} | ${fieldStr}`)
      }
    }

    return parts.join('\n')
  },

  buildSelectiveStateContext: (referenceText: string, extraIds?: number[]) => {
    const { cards } = get()
    if (!cards.length) {
      console.log('[StateCard] buildSelectiveStateContext: 无状态卡')
      return { text: '', matchedIds: [], allIds: [] }
    }

    const allIds = cards.map(c => c.id!).filter(Boolean)
    const refLower = referenceText.toLowerCase()
    const extraSet = new Set(extraIds || [])

    // 匹配规则：实体名出现在参考文本中，或者字段值中有关键词出现在参考文本中
    const matched: StateCard[] = []
    const matchedIds: number[] = []

    for (const card of cards) {
      // 强制包含用户手动勾选的
      if (card.id && extraSet.has(card.id)) {
        matched.push(card)
        matchedIds.push(card.id)
        continue
      }

      // 实体名匹配
      if (refLower.includes(card.entityName.toLowerCase())) {
        matched.push(card)
        if (card.id) matchedIds.push(card.id)
        continue
      }

      // 字段值匹配（如位置名、物品名等出现在文本中）
      const fields = parseFields(card.fields)
      const fieldMatch = fields.some(f =>
        f.value.length >= 2 && refLower.includes(f.value.toLowerCase())
      )
      if (fieldMatch) {
        matched.push(card)
        if (card.id) matchedIds.push(card.id)
      }
    }

    // 如果匹配为空，回退到全量注入
    if (matched.length === 0) {
      console.log('[StateCard] selectiveContext: 无匹配，回退全量注入', cards.length, '张')
      return { text: get().buildStateContext(), matchedIds: allIds, allIds }
    }

    console.log(`[StateCard] selectiveContext: 匹配 ${matched.length}/${cards.length} 张卡片`)

    const LABELS: Record<StateCategory, string> = {
      character: '角色', location: '地点', item: '物品', faction: '势力', event: '事件',
    }

    const grouped = new Map<StateCategory, StateCard[]>()
    for (const c of matched) {
      const list = grouped.get(c.category) || []
      list.push(c)
      grouped.set(c.category, list)
    }

    const parts: string[] = ['【当前状态表（按需召回）】']
    for (const [cat, catCards] of grouped) {
      parts.push(`\n[${LABELS[cat]}]`)
      for (const card of catCards) {
        const fields = parseFields(card.fields)
        const fieldStr = fields.map(f => `${f.key}：${f.value}`).join(' | ')
        parts.push(`- ${card.entityName} | ${fieldStr}`)
      }
    }

    return { text: parts.join('\n'), matchedIds, allIds }
  },
}))
