/**
 * 状态表 Store — 管理角色/地点/物品/势力的状态卡 CRUD
 */
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { StateCard, StateCategory, StateDiffItem, StateField } from '../lib/types'
import { parseFields, stringifyFields } from '../lib/types/state-card'
import { adopt } from '../lib/registry/adopt'
import { assertRecordInScope, readOwnedRows, resolveScopeLike, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'

const now = () => Date.now()

interface StateCardStore {
  cards: StateCard[]
  loading: boolean

  /** 加载项目的全部状态卡 */
  loadAll: (scope: WorkspaceScopeLike) => Promise<void>

  /** 新增一张状态卡 */
  addCard: (card: Omit<StateCard, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>

  /** 更新一张状态卡 */
  updateCard: (id: number, data: Partial<StateCard>) => Promise<void>

  /** 删除一张状态卡 */
  deleteCard: (id: number) => Promise<void>

  /** 批量应用 diff（用于章后审核确认） */
  applyDiffs: (scope: WorkspaceScopeLike, diffs: StateDiffItem[], chapterId?: number) => Promise<void>

  /** 构建用于 AI 注入的状态表文本（全量） */
  buildStateContext: () => string

  /** 按需召回：只注入与参考文本相关的状态卡 */
  buildSelectiveStateContext: (referenceText: string, extraIds?: number[]) => { text: string; matchedIds: number[]; allIds: number[] }

  // ── Phase G1 ──
  /** 获取角色当前状态（从状态卡中筛选） */
  getCharacterState: (characterName: string) => { fields: { key: string; value: string }[]; card: StateCard | null }
}

export const useStateCardStore = create<StateCardStore>((set, get) => ({
  cards: [],
  loading: false,

  loadAll: async (scopeInput: WorkspaceScopeLike) => {
    set({ loading: true })
    try {
      const cards = await readOwnedRows<StateCard>(await resolveScopeLike(scopeInput), 'stateCards', { owner: 'work' })
      set({ cards, loading: false })
    } catch (err) {
      console.error('[StateCard] loadAll 失败:', err)
      set({ loading: false })
    }
  },

  addCard: async (card) => {
    try {
      const newCard = stampNewRecord(
        await resolveScopeLike(card.projectId),
        'stateCards',
        { ...card, createdAt: now(), updatedAt: now() } as StateCard,
        { owner: 'work' },
      ) as StateCard
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
      const current = get().cards.find(c => c.id === id) ?? await db.stateCards.get(id)
      if (!current || !await assertRecordInScope(await resolveScopeLike(current.projectId), 'stateCards', current, { owner: 'work' })) return
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
      const current = get().cards.find(c => c.id === id) ?? await db.stateCards.get(id)
      if (!current || !await assertRecordInScope(await resolveScopeLike(current.projectId), 'stateCards', current, { owner: 'work' })) return
      await db.stateCards.delete(id)
      set({ cards: get().cards.filter(c => c.id !== id) })
      console.log('[StateCard] 删除:', id)
    } catch (err) {
      console.error('[StateCard] deleteCard 失败:', id, err)
      throw err
    }
  },

  applyDiffs: async (scopeInput, diffs, chapterId) => {
    const scope = await resolveScopeLike(scopeInput)
    const projectId = scope.projectId
    const { cards } = get()
    const knownCharacters = new Set(
      (await readOwnedRows<any>(scope, 'characters', { owner: 'world' }))
        .map(character => character.name.trim().toLocaleLowerCase()),
    )
    const validDiffs = diffs.filter(diff =>
      diff.category === 'character'
      && knownCharacters.has(diff.entityName.trim().toLocaleLowerCase()),
    )

    // 先按 (category, entityName) 聚合本批次的所有 diff，逐实体把字段合并到一起，再统一写库。
    // 修复两个 bug：
    //  ① 同一新实体的多条字段变更原会各建一张卡（重复卡）；
    //  ② 同一已有实体的多条字段变更原各自从陈旧快照 parse → 互相覆盖、只剩最后一条。
    type Acc = { category: StateCategory; entityName: string; existing: StateCard | null; fields: StateField[] }
    const byEntity = new Map<string, Acc>()

    for (const diff of validDiffs) {
      const key = `${diff.category}\u0000${diff.entityName}`
      let acc = byEntity.get(key)
      if (!acc) {
        const existing = cards.find(c => c.entityName === diff.entityName && c.category === diff.category) || null
        acc = {
          category: diff.category, entityName: diff.entityName,
          existing,
          fields: existing ? parseFields(existing.fields) : [],
        }
        byEntity.set(key, acc)
      }
      const idx = acc.fields.findIndex(f => f.key === diff.field)
      if (idx >= 0) acc.fields[idx].value = diff.newValue
      else acc.fields.push({ key: diff.field, value: diff.newValue })
    }

    try {
      const result = await adopt({
        projectId,
        scope,
        target: 'stateCards',
        mode: 'add-many',
        data: [...byEntity.values()].map(acc => ({
          category: 'character',
          entityName: acc.entityName,
          fields: stringifyFields(acc.fields),
          lastChapterId: chapterId ?? null,
        })),
      })
      const refreshed = await readOwnedRows<StateCard>(scope, 'stateCards', { owner: 'work' })
      set({ cards: refreshed })
      console.log(`[StateCard] applyDiffs: ${validDiffs.length} 条角色变更已应用（实体 ${byEntity.size}，写入 ${result.written.length}）`)
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

  // ── Phase G1 ──
  getCharacterState: (characterName: string) => {
    const card = get().cards.find(
      c => c.category === 'character' && c.entityName === characterName
    )
    if (!card) return { fields: [], card: null }
    return { fields: parseFields(card.fields), card }
  },
}))
