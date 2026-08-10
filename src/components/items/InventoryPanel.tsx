/**
 * 物品栏 — INV-1（按角色归属）
 *
 * AI 从已写章节正文中提取各角色的物品获得/消耗，
 * 聚合为「当前持有数量 + 获得/消耗历程」，支持按角色切换查看。
 */
import { useState, useEffect, useMemo } from 'react'
import { Package, Sparkles, Loader2, Trash2, ChevronDown, ChevronRight, Plus, ArrowUpCircle, ArrowDownCircle } from 'lucide-react'
import { useItemLedgerStore } from '../../stores/item-ledger'
import { useChapterStore } from '../../stores/chapter'
import { useCharacterStore } from '../../stores/character'
import { useOutlineStore } from '../../stores/outline'
import { useAIConfigStore } from '../../stores/ai-config'
import { chat, resolveRequestConfig } from '../../lib/ai/client'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../../lib/ai/config-readiness'
import {
  buildInventoryExtractPrompt, parseInventoryEvents, type ExtractedItemEvent,
} from '../../lib/ai/adapters/inventory-extract-adapter'
import { aggregateInventory, ITEM_LEDGER_ACTION_LABELS } from '../../lib/types/item-ledger'
import type { CharacterRoleWeight } from '../../lib/types/character'
import type { Project, ItemLedgerAction } from '../../lib/types'
import { splitExtractionText, uniqueBy } from '../../lib/ai/structured-extraction'
import { adopt } from '../../lib/registry/adopt'
import { assembleContext } from '../../lib/registry/assemble-context'
import {
  listInventoryExtractionChapters,
  selectInventoryExtractionChapters,
  type InventoryExtractionMode,
} from '../../lib/inventory/extraction-range'
import {
  INITIAL_RECORD_TARGET_CLASS,
  initialRecordTargetAttributes,
  useInitialRecordTarget,
} from '../shared/initial-record-target'

interface Props {
  project: Project
  initialEntryId?: number | null
}

const ROLE_WEIGHT_GROUPS: { weight: CharacterRoleWeight; label: string }[] = [
  { weight: 'main', label: '主要角色' },
  { weight: 'secondary', label: '次要角色' },
  { weight: 'npc', label: 'NPC' },
  { weight: 'extra', label: '路人' },
]

export default function InventoryPanel({ project, initialEntryId }: Props) {
  const { entries, loading, loadAll, addEntry, updateEntry, deleteEntry, deleteByChapter } = useItemLedgerStore()
  const { chapters, loadAll: loadChapters } = useChapterStore()
  const { characters, loadAll: loadCharacters } = useCharacterStore()
  const { nodes: outlineNodes, loadAll: loadOutline } = useOutlineStore()
  const aiConfig = useAIConfigStore(s => s.config)

  const [extracting, setExtracting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [selectedCharacterId, setSelectedCharacterId] = useState<number | null>(null)
  const [extractMode, setExtractMode] = useState<InventoryExtractionMode>('all')
  const [extractStart, setExtractStart] = useState<number>(1)
  const [extractEnd, setExtractEnd] = useState<number>(1)

  useEffect(() => {
    loadAll(project.id!)
    loadChapters(project.id!)
    loadCharacters(project.id!)
    loadOutline(project.id!)
  }, [project.id, loadAll, loadChapters, loadCharacters, loadOutline])

  const visibleEntries = useMemo(
    () => selectedCharacterId != null
      ? entries
      : entries.filter(entry => !((entry.characterId ?? null) === null && entry.heldByName === '未知(历史数据)')),
    [entries, selectedCharacterId],
  )
  const inventory = useMemo(
    () => aggregateInventory(visibleEntries, selectedCharacterId ?? undefined),
    [visibleEntries, selectedCharacterId],
  )

  const inventoryStats = useMemo(() => ({
    activeKinds: inventory.filter(item => item.quantity > 0).length,
    totalHeld: inventory.reduce((sum, item) => sum + Math.max(0, item.quantity), 0),
    movements: inventory.reduce((sum, item) => sum + item.entries.length, 0),
  }), [inventory])

  const extractionChapters = useMemo(
    () => listInventoryExtractionChapters(chapters, outlineNodes),
    [chapters, outlineNodes],
  )

  useEffect(() => {
    if (extractionChapters.length === 0) return
    setExtractStart(current => Math.min(Math.max(current, 1), extractionChapters.length))
    setExtractEnd(current => current <= 1 ? extractionChapters.length : Math.min(current, extractionChapters.length))
  }, [extractionChapters.length])

  // 角色列表按 roleWeight 分组
  const groupedCharacters = useMemo(() => {
    const result: { weight: CharacterRoleWeight; label: string; chars: typeof characters }[] = []
    for (const group of ROLE_WEIGHT_GROUPS) {
      const chars = characters.filter(c => c.roleWeight === group.weight)
      if (chars.length > 0) result.push({ ...group, chars })
    }
    return result
  }, [characters])

  // 未归属条目（历史数据的 characterId === null && heldByName === '未知(历史数据)'）
  const unclaimedEntries = useMemo(
    () => entries.filter(e => (e.characterId ?? null) === null && e.heldByName === '未知(历史数据)'),
    [entries],
  )
  const targetEntry = entries.find(entry => entry.id === initialEntryId) ?? null
  const targetInventoryKey = targetEntry
    ? JSON.stringify([targetEntry.characterId ?? targetEntry.heldByName, targetEntry.itemName.trim()])
    : null

  useEffect(() => {
    if (!targetEntry || !targetInventoryKey) return
    setSelectedCharacterId(targetEntry.characterId ?? null)
    setExpanded(targetInventoryKey)
  }, [targetEntry, targetInventoryKey])
  useInitialRecordTarget(
    initialEntryId,
    targetEntry != null && (
      targetEntry.heldByName === '未知(历史数据)' || expanded === targetInventoryKey
    ),
  )

  const handleExtract = async () => {
    const effectiveConfig = resolveRequestConfig(aiConfig, { category: 'inventory.extract' }).config
    if (!isAIConfigReady(effectiveConfig)) {
      setExtractError(getAIConfigRequiredMessage(effectiveConfig))
      return
    }
    const selection = selectInventoryExtractionChapters({
      chapters,
      outlineNodes,
      mode: extractMode,
      startOrdinal: extractStart,
      endOrdinal: extractEnd,
    })
    if (selection.error) {
      setExtractError(selection.error)
      return
    }
    const targetChapters = selection.chapters
    const characterNames = characters.map(c => c.name).filter(Boolean)
    const nameToId = new Map(characters.filter(c => c.name).map(c => [c.name.trim(), c.id!]))
    setExtracting(true)
    setExtractError(null)
    setProgress({ done: 0, total: targetChapters.length })
    try {
      for (let i = 0; i < targetChapters.length; i++) {
        const ch = targetChapters[i]
        try {
          const found: ExtractedItemEvent[] = []
          const knownNames = [...new Set(entries.map(entry => entry.itemName.trim()).filter(Boolean))]
          const chapterSource = await assembleContext({
            projectId: project.id!,
            chapterId: ch.id,
            sourceKeys: ['chapterContent'],
          })
          for (const chunk of splitExtractionText(chapterSource.text)) {
            const messages = buildInventoryExtractPrompt(
              ch.title,
              chunk,
              [...knownNames, ...found.map(event => event.itemName)],
              characterNames,
            )
            const raw = await chat(messages, aiConfig, { category: 'inventory.extract', projectId: project.id! })
            found.push(...parseInventoryEvents(raw))
          }
          const key = (ev: ExtractedItemEvent) => JSON.stringify([
            ev.itemName.trim().toLocaleLowerCase(),
            ev.heldByName.trim(),
            ev.action,
            ev.quantity,
            ev.note.trim(),
          ])
          const events = uniqueBy(found, key)
          if (ch.id != null) await deleteByChapter(project.id!, ch.id)
          if (events.length > 0) {
            await adopt({
              projectId: project.id!,
              target: 'itemLedger',
              mode: 'add-many',
              data: events.map(ev => ({
                itemName: ev.itemName,
                heldByName: ev.heldByName,
                characterId: nameToId.get(ev.heldByName.trim()) ?? null,
                action: ev.action,
                quantity: ev.quantity,
                chapterId: ch.id ?? null,
                chapterTitle: ch.title,
                note: ev.note || '',
              })),
            })
            await loadAll(project.id!)
          }
        } catch (err) {
          console.error('[Inventory] 章节提取失败:', ch.title, err)
        }
        setProgress({ done: i + 1, total: targetChapters.length })
      }
    } finally {
      setExtracting(false)
      setProgress(null)
    }
  }

  const selectedCharacter = selectedCharacterId != null ? characters.find(c => c.id === selectedCharacterId) : null

  const handleManualAdd = async () => {
    if (!selectedCharacter) {
      setExtractError('请先选择一个角色，再手动添加其物品')
      return
    }
    await addEntry({
      projectId: project.id!,
      itemName: '新物品',
      heldByName: selectedCharacter.name,
      characterId: selectedCharacter.id ?? null,
      action: 'gain',
      quantity: 1,
      note: '手动添加',
    })
  }

  const handleUpdateQuantity = (id: number, value: string, fallback: number) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) return fallback
    const quantity = Math.max(0, Math.floor(parsed))
    void updateEntry(id, { quantity })
    return quantity
  }

  const handleUpdateItemName = (id: number, value: string, fallback: string) => {
    const itemName = value.trim()
    if (!itemName) return fallback
    void updateEntry(id, { itemName })
    return itemName
  }

  const handleUpdateHeldByName = (id: number, value: string) => {
    const heldByName = value.trim()
    if (!heldByName) return
    const match = characters.find(c => c.name.trim() === heldByName)
    void updateEntry(id, { heldByName, characterId: match?.id ?? null })
  }

  return (
    <div className="max-w-3xl space-y-5">
      {/* 顶部 */}
      <div className="pb-4 border-b border-border/40">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
              <Package className="w-5 h-5" /> 物品栏
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              AI 从已写正文中按角色提取物品获得/消耗，自动统计持有数量和历程。
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleManualAdd}
              disabled={!selectedCharacter}
              title={selectedCharacter ? `给${selectedCharacter.name}添加物品` : '请先选择一个角色'}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-bg-elevated text-text-secondary border border-border hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> 手动添加
            </button>
            <button
              onClick={handleExtract}
              disabled={extracting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              {extracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {extracting ? `提取中 ${progress?.done}/${progress?.total}` : '从正文提取物品栏'}
            </button>
          </div>
        </div>

        {/* 角色切换器 */}
        {characters.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-text-muted shrink-0">查看角色：</span>
            <select
              value={selectedCharacterId ?? ''}
              onChange={ev => setSelectedCharacterId(ev.target.value ? Number(ev.target.value) : null)}
              className="flex-1 max-w-xs bg-bg-base border border-border rounded-lg text-xs px-2 py-1.5 text-text-secondary"
            >
              <option value="">全部角色</option>
              {groupedCharacters.map(group => (
                <optgroup key={group.weight} label={group.label}>
                  {group.chars.map(c => (
                    <option key={c.id} value={c.id}>{c.name}{c.roleWeight === 'main' ? ' · 主要' : ''}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            {selectedCharacter && (
              <span className="text-xs text-accent">当前：{selectedCharacter.name} 的背包</span>
            )}
          </div>
        )}

        {/* 提取范围选择（QUICKWIN-3） */}
        {extractionChapters.length > 0 && (
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="text-text-muted">提取范围：</span>
            <select
              value={extractMode}
              onChange={ev => setExtractMode(ev.target.value as InventoryExtractionMode)}
              className="bg-bg-base border border-border rounded px-1.5 py-0.5 text-text-secondary"
            >
              <option value="all">全部已写章节</option>
              <option value="range">自定义起止章</option>
            </select>
            {extractMode === 'range' && (
              <>
                <select
                  value={extractStart}
                  onChange={ev => setExtractStart(Number(ev.target.value))}
                  className="bg-bg-base border border-border rounded px-1.5 py-0.5 text-text-secondary max-w-40"
                >
                  {extractionChapters.map(item => (
                    <option key={item.chapter.id ?? item.ordinal} value={item.ordinal}>
                      第{item.ordinal}章 · {item.chapter.title}{item.hasWrittenContent ? '' : '（无正文）'}
                    </option>
                  ))}
                </select>
                <span className="text-text-muted">至</span>
                <select
                  value={extractEnd}
                  onChange={ev => setExtractEnd(Number(ev.target.value))}
                  className="bg-bg-base border border-border rounded px-1.5 py-0.5 text-text-secondary max-w-40"
                >
                  {extractionChapters.map(item => (
                    <option key={item.chapter.id ?? item.ordinal} value={item.ordinal}>
                      第{item.ordinal}章 · {item.chapter.title}{item.hasWrittenContent ? '' : '（无正文）'}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        )}
      </div>

      {extractError && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">{extractError}</div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-bg-surface p-3">
          <p className="text-[10px] uppercase tracking-wide text-text-muted">当前种类</p>
          <p className="text-xl font-semibold text-text-primary mt-1">{inventoryStats.activeKinds}</p>
        </div>
        <div className="rounded-xl border border-border bg-bg-surface p-3">
          <p className="text-[10px] uppercase tracking-wide text-text-muted">持有总量</p>
          <p className="text-xl font-semibold text-green-400 mt-1">{inventoryStats.totalHeld}</p>
        </div>
        <div className="rounded-xl border border-border bg-bg-surface p-3">
          <p className="text-[10px] uppercase tracking-wide text-text-muted">流水记录</p>
          <p className="text-xl font-semibold text-accent mt-1">{inventoryStats.movements}</p>
        </div>
      </div>

      {extracting && progress && (
        <div className="p-3 bg-accent/10 border border-accent/20 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-accent mb-1.5">
            <Loader2 className="w-4 h-4 animate-spin" />
            正在逐章提取物品流水…（{progress.done}/{progress.total}）
          </div>
          <div className="h-1.5 bg-bg-base rounded-full overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        </div>
      )}

      {/* 物品栏 */}
      {loading ? (
        <div className="text-text-muted text-sm py-8 text-center">加载中...</div>
      ) : inventory.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">物品栏空空如也</p>
          <p className="text-xs mt-1">写完一些章节后，点「从正文提取物品栏」让 AI 自动整理</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {inventory.map(item => {
            const inventoryKey = JSON.stringify([item.characterId ?? item.heldByName, item.itemName])
            const isOpen = expanded === inventoryKey
            const containsTarget = item.entries.some(entry => entry.id === initialEntryId)
            const gained = item.entries.filter(entry => entry.action === 'gain').reduce((sum, entry) => sum + entry.quantity, 0)
            const consumed = item.entries.filter(entry => entry.action === 'consume').reduce((sum, entry) => sum + entry.quantity, 0)
            return (
              <div key={inventoryKey} className={`bg-bg-surface border rounded-xl overflow-hidden ${
                item.quantity > 0 ? 'border-border' : 'border-border/60 opacity-80'
              } ${containsTarget ? 'border-amber-400/60' : ''}`}>
                {/* 物品头部 */}
                <button
                  onClick={() => setExpanded(isOpen ? null : inventoryKey)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-bg-hover/40 transition-colors"
                >
                  {isOpen ? <ChevronDown className="w-4 h-4 text-text-muted shrink-0" /> : <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />}
                  <span className="text-sm font-semibold text-text-primary min-w-0 truncate">{item.itemName}</span>
                  {item.heldByName && (
                    <span className="text-[10px] text-text-muted bg-bg-elevated px-1.5 py-0.5 rounded shrink-0">{item.heldByName}</span>
                  )}
                  <span className="text-[10px] text-text-muted flex-1">
                    累计获得 {gained} · 消耗 {consumed}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${
                    item.quantity > 0 ? 'bg-green-500/10 text-green-400'
                      : item.quantity === 0 ? 'bg-bg-elevated text-text-muted'
                      : 'bg-red-500/10 text-red-400'
                  }`}>
                    ×{item.quantity}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                    item.quantity > 0 ? 'bg-green-500/10 text-green-400' : 'bg-bg-elevated text-text-muted'
                  }`}>
                    {item.quantity > 0 ? '持有中' : item.quantity === 0 ? '已耗尽' : '需核对'}
                  </span>
                </button>

                {/* 流水历程 */}
                {isOpen && (
                  <div className="border-t border-border/50 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-text-muted mb-2">获得 / 消耗时间线</p>
                    <div className="relative ml-1 border-l border-border/70">
                    {item.entries.map(e => (
                      <div
                        key={e.id}
                        {...initialRecordTargetAttributes(e.id === initialEntryId, e.id)}
                        className={`relative flex flex-wrap items-center gap-2 pl-4 py-2 text-xs group rounded ${
                          e.id === initialEntryId ? INITIAL_RECORD_TARGET_CLASS : ''
                        }`}
                      >
                        <span className={`absolute -left-1.5 w-3 h-3 rounded-full border-2 bg-bg-surface ${
                          e.action === 'gain' ? 'border-green-400' : 'border-red-400'
                        }`} />
                        {e.action === 'gain'
                          ? <ArrowUpCircle className="w-3.5 h-3.5 text-green-400 shrink-0" />
                          : <ArrowDownCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                        <span className={`shrink-0 ${e.action === 'gain' ? 'text-green-400' : 'text-red-400'}`}>
                          {ITEM_LEDGER_ACTION_LABELS[e.action]} ×{e.quantity}
                        </span>
                        {e.chapterTitle && <span className="text-text-muted min-w-0 truncate">· {e.chapterTitle}</span>}
                        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5 shrink-0">
                          <input
                            defaultValue={e.itemName}
                            onBlur={ev => {
                              ev.currentTarget.value = handleUpdateItemName(e.id!, ev.currentTarget.value, e.itemName)
                            }}
                            onKeyDown={ev => {
                              if (ev.key === 'Enter') ev.currentTarget.blur()
                            }}
                            title="修改物品名"
                            aria-label="修改物品名"
                            className="w-24 sm:w-28 bg-bg-base border border-border rounded text-[10px] px-1 py-0.5 text-text-secondary focus:outline-none focus:border-accent"
                          />
                          <input
                            defaultValue={e.heldByName ?? ''}
                            onBlur={ev => handleUpdateHeldByName(e.id!, ev.currentTarget.value)}
                            onKeyDown={ev => { if (ev.key === 'Enter') ev.currentTarget.blur() }}
                            placeholder="持有人"
                            title="修改持有人"
                            aria-label="修改持有人"
                            className="w-16 bg-bg-base border border-border rounded text-[10px] px-1 py-0.5 text-text-secondary focus:outline-none focus:border-accent"
                          />
                          <input
                            type="number"
                            min={0}
                            step={1}
                            defaultValue={e.quantity}
                            onBlur={ev => {
                              ev.currentTarget.value = String(handleUpdateQuantity(e.id!, ev.currentTarget.value, e.quantity))
                            }}
                            onKeyDown={ev => {
                              if (ev.key === 'Enter') ev.currentTarget.blur()
                            }}
                            title="修改数量"
                            aria-label="修改数量"
                            className="w-14 bg-bg-base border border-border rounded text-[10px] px-1 py-0.5 text-text-secondary focus:outline-none focus:border-accent"
                          />
                          <select
                            value={e.action}
                            onChange={ev => updateEntry(e.id!, { action: ev.target.value as ItemLedgerAction })}
                            className="bg-bg-base border border-border rounded text-[10px] px-1 py-0.5 text-text-secondary"
                          >
                            <option value="gain">获得</option>
                            <option value="consume">消耗</option>
                          </select>
                          <button
                            onClick={() => deleteEntry(e.id!)}
                            title="删除流水"
                            aria-label="删除流水"
                            className="p-0.5 text-text-muted hover:text-red-400"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                          <input
                            defaultValue={e.note ?? ''}
                            onBlur={ev => updateEntry(e.id!, { note: ev.target.value.trim() })}
                            onKeyDown={ev => {
                              if (ev.key === 'Enter') ev.currentTarget.blur()
                            }}
                            placeholder="备注"
                            title="修改备注"
                            aria-label="修改备注"
                            className="w-24 sm:w-32 bg-bg-base border border-border rounded text-[10px] px-1 py-0.5 text-text-muted focus:outline-none focus:border-accent"
                          />
                        </div>
                      </div>
                    ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 未归属（历史数据） */}
      {unclaimedEntries.length > 0 && selectedCharacterId == null && (
        <div className="border border-dashed border-border/60 rounded-xl p-4 bg-bg-elevated/30">
          <p className="text-xs text-text-muted mb-2">
            未归属物品（历史数据）。可在这里选择角色认领，原始记录不会丢失。
          </p>
          <div className="text-[10px] text-text-muted space-y-1">
            {unclaimedEntries.map(e => (
              <div
                key={e.id}
                {...initialRecordTargetAttributes(e.id === initialEntryId, e.id)}
                className={`flex items-center gap-2 rounded ${e.id === initialEntryId ? INITIAL_RECORD_TARGET_CLASS : ''}`}
              >
                <span>{e.itemName}</span>
                <span className="text-text-muted/60">{e.action === 'gain' ? '获得' : '消耗'} ×{e.quantity}</span>
                {e.chapterTitle && <span className="text-text-muted/60">· {e.chapterTitle}</span>}
                <select
                  value=""
                  aria-label={`认领${e.itemName}`}
                  onChange={event => {
                    const characterId = Number(event.target.value)
                    const character = characters.find(candidate => candidate.id === characterId)
                    if (character && e.id != null) {
                      void updateEntry(e.id, { characterId, heldByName: character.name })
                    }
                  }}
                  className="ml-auto bg-bg-base border border-border rounded px-1.5 py-0.5 text-text-secondary"
                >
                  <option value="">选择角色认领…</option>
                  {groupedCharacters.flatMap(group => group.chars).map(character => (
                    <option key={character.id} value={character.id}>{character.name}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
