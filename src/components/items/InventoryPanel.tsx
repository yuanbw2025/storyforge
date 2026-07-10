/**
 * 物品栏 — Phase 25.5.2-b（游戏包裹式）
 *
 * 下游提取产物：AI 从已写章节正文中提取主角的物品获得/消耗，
 * 聚合为「当前持有数量 + 获得/消耗历程」。
 */
import { useState, useEffect, useMemo } from 'react'
import { Package, Sparkles, Loader2, Trash2, ChevronDown, ChevronRight, Plus, ArrowUpCircle, ArrowDownCircle } from 'lucide-react'
import { useItemLedgerStore } from '../../stores/item-ledger'
import { useChapterStore } from '../../stores/chapter'
import { useAIConfigStore } from '../../stores/ai-config'
import { chat } from '../../lib/ai/client'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../../lib/ai/config-readiness'
import {
  buildInventoryExtractPrompt, parseInventoryEvents, type ExtractedItemEvent,
} from '../../lib/ai/adapters/inventory-extract-adapter'
import { aggregateInventory, ITEM_LEDGER_ACTION_LABELS } from '../../lib/types/item-ledger'
import { htmlToPlainText } from '../../lib/utils/html'
import type { Project, ItemLedgerAction } from '../../lib/types'
import { splitExtractionText, uniqueBy } from '../../lib/ai/structured-extraction'
import { adopt } from '../../lib/registry/adopt'
import { assembleContext } from '../../lib/registry/assemble-context'

interface Props {
  project: Project
}

export default function InventoryPanel({ project }: Props) {
  const { entries, loading, loadAll, addEntry, updateEntry, deleteEntry, deleteByChapter } = useItemLedgerStore()
  const { chapters, loadAll: loadChapters } = useChapterStore()
  const aiConfig = useAIConfigStore(s => s.config)

  const [extracting, setExtracting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    loadAll(project.id!)
    loadChapters(project.id!)
  }, [project.id, loadAll, loadChapters])

  const inventory = useMemo(() => aggregateInventory(entries), [entries])
  const inventoryStats = useMemo(() => ({
    activeKinds: inventory.filter(item => item.quantity > 0).length,
    totalHeld: inventory.reduce((sum, item) => sum + Math.max(0, item.quantity), 0),
    movements: entries.length,
  }), [inventory, entries.length])

  // 已写正文的章节（有内容的）
  const writtenChapters = useMemo(
    () => chapters.filter(c => c.content && htmlToPlainText(c.content).trim().length > 50),
    [chapters],
  )

  const handleExtract = async () => {
    if (!isAIConfigReady(aiConfig)) {
      setExtractError(getAIConfigRequiredMessage(aiConfig))
      return
    }
    if (writtenChapters.length === 0) {
      setExtractError('还没有已写正文的章节，先去写作再提取')
      return
    }
    setExtracting(true)
    setExtractError(null)
    setProgress({ done: 0, total: writtenChapters.length })
    try {
      for (let i = 0; i < writtenChapters.length; i++) {
        const ch = writtenChapters[i]
        try {
          const found: ExtractedItemEvent[] = []
          const knownNames = aggregateInventory(entries).map(item => item.itemName)
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
            )
            const raw = await chat(messages, aiConfig, { category: 'inventory.extract', projectId: project.id! })
            found.push(...parseInventoryEvents(raw))
          }
          const events = uniqueBy(
            found,
            event => `${event.itemName.trim().toLocaleLowerCase()}\u0000${event.action}\u0000${event.quantity}\u0000${event.note.trim()}`,
          )
          // 全部分块成功后才替换该章旧记录，避免半提取清空用户数据
          if (ch.id != null) await deleteByChapter(project.id!, ch.id)
          if (events.length > 0) {
            await adopt({
              projectId: project.id!,
              target: 'itemLedger',
              mode: 'add-many',
              data: events.map(e => ({
                itemName: e.itemName,
                action: e.action,
                quantity: e.quantity,
                chapterId: ch.id ?? null,
                chapterTitle: ch.title,
                note: e.note || '',
              })),
            })
            await loadAll(project.id!)
          }
        } catch (err) {
          console.error('[Inventory] 章节提取失败:', ch.title, err)
          // 单章失败不中断整体
        }
        setProgress({ done: i + 1, total: writtenChapters.length })
      }
    } finally {
      setExtracting(false)
      setProgress(null)
    }
  }

  const handleManualAdd = async () => {
    await addEntry({
      projectId: project.id!,
      itemName: '新物品',
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
              像游戏包裹一样追踪主角的物品。AI 从已写正文中提取获得/消耗，自动统计持有数量和历程。
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleManualAdd}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-bg-elevated text-text-secondary border border-border hover:text-text-primary transition-colors"
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
            const isOpen = expanded === item.itemName
            const gained = item.entries.filter(entry => entry.action === 'gain').reduce((sum, entry) => sum + entry.quantity, 0)
            const consumed = item.entries.filter(entry => entry.action === 'consume').reduce((sum, entry) => sum + entry.quantity, 0)
            return (
              <div key={item.itemName} className={`bg-bg-surface border rounded-xl overflow-hidden ${
                item.quantity > 0 ? 'border-border' : 'border-border/60 opacity-80'
              }`}>
                {/* 物品头部 */}
                <button
                  onClick={() => setExpanded(isOpen ? null : item.itemName)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-bg-hover/40 transition-colors"
                >
                  {isOpen ? <ChevronDown className="w-4 h-4 text-text-muted shrink-0" /> : <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />}
                  <span className="text-sm font-semibold text-text-primary min-w-0 truncate">{item.itemName}</span>
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
                      <div key={e.id} className="relative flex flex-wrap items-center gap-2 pl-4 py-2 text-xs group">
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
    </div>
  )
}
