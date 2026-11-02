/**
 * 状态表 Store — 管理角色/地点/物品/势力的状态卡 CRUD
 */
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { StateCard, StateCategory, StateDiffItem, StateField, Character, WorkspaceScope } from '../lib/types'
import { readStateCardFields, stringifyFields } from '../lib/types/state-card'
import { adopt, hashAdoptRecordFieldsV1 } from '../lib/registry/adopt'
import { assertRecordInScope, readOwnedRows, resolveScopeLike, scopeTransactionTables, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'

const now = () => Date.now()
let loadRequest = 0
const sameScope = (left: WorkspaceScope | null, right: WorkspaceScope) =>
  left?.projectId === right.projectId && left.worldId === right.worldId && left.workId === right.workId

interface StateCardStore {
  cards: StateCard[]
  loading: boolean
  loadedScope: WorkspaceScope | null

  /** 加载项目的全部状态卡 */
  loadAll: (scope: WorkspaceScopeLike) => Promise<void>

  /** 新增一张状态卡 */
  addCard: (card: Omit<StateCard, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>

  /** 更新一张状态卡 */
  updateCard: (id: number, data: Partial<StateCard>, options?: { expectedFields?: unknown; scope?: WorkspaceScopeLike }) => Promise<void>

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
  loadedScope: null,

  loadAll: async (scopeInput: WorkspaceScopeLike) => {
    const request = ++loadRequest
    set({ loading: true, loadedScope: null })
    try {
      const scope = await resolveScopeLike(scopeInput)
      const cards = await readOwnedRows<StateCard>(scope, 'stateCards', { owner: 'work' })
      if (request === loadRequest) set({ cards, loadedScope: scope })
    } catch (err) {
      console.error('[StateCard] loadAll 失败:', err)
    } finally {
      if (request === loadRequest) set({ loading: false })
    }
  },

  addCard: async (card) => {
    try {
      readStateCardFields(card)
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

  updateCard: async (id, data, options) => {
    const current = await db.stateCards.get(id)
    if (!current) throw new Error('状态卡已不存在，未保存。')
    const scope = await resolveScopeLike(options?.scope ?? current.projectId)
    if (!await assertRecordInScope(scope, 'stateCards', current, { owner: 'work' })) {
      throw new Error('状态卡不属于当前作品，未保存。')
    }
    const result = await adopt({
      projectId: current.projectId, scope, target: 'stateCards', recordId: id,
      mode: 'replace', data,
      ...(options && 'expectedFields' in options ? { compareAndSet: {
        kind: 'record-fields-value-hash' as const, fields: ['fields'],
        expectedHash: await hashAdoptRecordFieldsV1({ fields: options.expectedFields }, ['fields']),
      } } : {}),
    })
    if (!result.written.some(row => row.id === id)) {
      const reason = result.typeErrors[0]?.got || result.skipped[0]?.reason || '状态卡未保存，输入已保留。'
      throw new Error(reason.startsWith('CAS 失败') ? '状态字段已被另一页面修改，请重新打开后修复。当前输入已保留。' : reason)
    }
    const saved = await db.stateCards.get(id)
    if (!saved) throw new Error('状态卡保存后无法回读，请重试。')
    set({ cards: get().cards.map(card => card.id === id ? saved : card) })
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
    const frozenDiffs = diffs.map(diff => ({ ...diff }))
    const scope = await resolveScopeLike(typeof scopeInput === 'number' ? scopeInput : { ...scopeInput })
    // Read the target and apply its delta under the same owner transaction.
    // A global display cache is never a baseline for formal adoption.
    const refreshed = await db.transaction('rw', scopeTransactionTables(db.stateCards, db.characters, db.chapters), async () => {
      await resolveScopeLike(scope)
      if (chapterId != null && !await assertRecordInScope(scope, 'chapters', await db.chapters.get(chapterId), { owner: 'work' })) {
        throw new Error('状态候选的来源章节不属于指定作品，未采纳。')
      }
      const knownCharacters = new Set(
        (await readOwnedRows<Character>(scope, 'characters', { owner: 'world' })).map(character => character.name),
      )
      const cards = await readOwnedRows<StateCard>(scope, 'stateCards', { owner: 'work' })
      const byEntity = new Map<string, { entityName: string; fields: StateField[] }>()
      for (const diff of frozenDiffs) {
        if (diff.category !== 'character' || !knownCharacters.has(diff.entityName)) {
          throw new Error('状态候选只能修改指定世界内已登记的角色，未采纳。')
        }
        let acc = byEntity.get(diff.entityName)
        if (!acc) {
          const existing = cards.find(card => card.entityName === diff.entityName && card.category === 'character')
          acc = { entityName: diff.entityName, fields: existing ? readStateCardFields(existing) : [] }
          byEntity.set(diff.entityName, acc)
        }
        const index = acc.fields.findIndex(field => field.key === diff.field)
        if ((index >= 0 ? acc.fields[index].value : null) !== diff.oldValue) {
          throw new Error(`角色“${diff.entityName}”的“${diff.field}”已变化，状态候选已过期；请重新核对。`)
        }
        if (index >= 0) acc.fields[index] = { key: diff.field, value: diff.newValue }
        else acc.fields.push({ key: diff.field, value: diff.newValue })
      }
      const result = await adopt({
        projectId: scope.projectId, scope, target: 'stateCards', mode: 'add-many',
        data: [...byEntity.values()].map(acc => ({
          category: 'character', entityName: acc.entityName,
          fields: stringifyFields(acc.fields), lastChapterId: chapterId ?? null,
        })),
      })
      if (result.written.length !== byEntity.size || result.skipped.length || result.typeErrors.length || result.fkErrors.length || result.unknown.length) {
        throw new Error('状态候选未完整写入，整批已回滚；请核对后重试。')
      }
      return readOwnedRows<StateCard>(scope, 'stateCards', { owner: 'work' })
    })
    if (sameScope(get().loadedScope, scope)) set({ cards: refreshed })
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
        const fields = readStateCardFields(card)
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
      const fields = readStateCardFields(card)
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
        const fields = readStateCardFields(card)
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
    return { fields: readStateCardFields(card), card }
  },
}))
