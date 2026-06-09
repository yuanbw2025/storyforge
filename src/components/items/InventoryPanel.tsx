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
import { buildInventoryExtractPrompt, parseInventoryEvents } from '../../lib/ai/adapters/inventory-extract-adapter'
import { aggregateInventory, ITEM_LEDGER_ACTION_LABELS } from '../../lib/types/item-ledger'
import { htmlToPlainText } from '../../lib/utils/html'
import type { Project, ItemLedgerAction } from '../../lib/types'

interface Props {
  project: Project
}

export default function InventoryPanel({ project }: Props) {
  const { entries, loading, loadAll, addEntries, addEntry, updateEntry, deleteEntry, deleteByChapter } = useItemLedgerStore()
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

  // 已写正文的章节（有内容的）
  const writtenChapters = useMemo(
    () => chapters.filter(c => c.content && htmlToPlainText(c.content).trim().length > 50),
    [chapters],
  )

  const handleExtract = async () => {
    if (!aiConfig.apiKey) {
      setExtractError('请先在「设置」中配置 AI API Key')
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
        const text = htmlToPlainText(ch.content)
        try {
          const messages = buildInventoryExtractPrompt(ch.title, text)
          const raw = await chat(messages, aiConfig, { category: 'inventory.extract', projectId: project.id! })
          const events = parseInventoryEvents(raw)
          // 重新提取该章前先清理旧记录，避免重复累加
          if (ch.id != null) await deleteByChapter(project.id!, ch.id)
          if (events.length > 0) {
            await addEntries(events.map(e => ({
              projectId: project.id!,
              itemName: e.itemName,
              action: e.action,
              quantity: e.quantity,
              chapterId: ch.id ?? null,
              chapterTitle: ch.title,
              note: e.note || undefined,
            })))
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
        <div className="space-y-1.5">
          {inventory.map(item => {
            const isOpen = expanded === item.itemName
            return (
              <div key={item.itemName} className="bg-bg-surface border border-border rounded-lg overflow-hidden">
                {/* 物品头部 */}
                <button
                  onClick={() => setExpanded(isOpen ? null : item.itemName)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-bg-hover/40 transition-colors"
                >
                  {isOpen ? <ChevronDown className="w-4 h-4 text-text-muted shrink-0" /> : <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />}
                  <span className="text-sm font-medium text-text-primary flex-1 min-w-0 truncate">{item.itemName}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${
                    item.quantity > 0 ? 'bg-green-500/10 text-green-400'
                      : item.quantity === 0 ? 'bg-bg-elevated text-text-muted'
                      : 'bg-red-500/10 text-red-400'
                  }`}>
                    ×{item.quantity}
                  </span>
                  <span className="text-[10px] text-text-muted shrink-0">{item.entries.length} 条记录</span>
                </button>

                {/* 流水历程 */}
                {isOpen && (
                  <div className="border-t border-border/50 divide-y divide-border/30">
                    {item.entries.map(e => (
                      <div key={e.id} className="flex items-center gap-2 px-3 py-2 text-xs group">
                        {e.action === 'gain'
                          ? <ArrowUpCircle className="w-3.5 h-3.5 text-green-400 shrink-0" />
                          : <ArrowDownCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                        <span className={e.action === 'gain' ? 'text-green-400' : 'text-red-400'}>
                          {ITEM_LEDGER_ACTION_LABELS[e.action]} ×{e.quantity}
                        </span>
                        {e.chapterTitle && <span className="text-text-muted">· {e.chapterTitle}</span>}
                        {e.note && <span className="text-text-muted truncate">· {e.note}</span>}
                        <div className="ml-auto flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <select
                            value={e.action}
                            onChange={ev => updateEntry(e.id!, { action: ev.target.value as ItemLedgerAction })}
                            className="bg-bg-base border border-border rounded text-[10px] px-1 py-0.5 text-text-secondary"
                          >
                            <option value="gain">获得</option>
                            <option value="consume">消耗</option>
                          </select>
                          <button onClick={() => deleteEntry(e.id!)} className="p-0.5 text-text-muted hover:text-red-400">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
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
