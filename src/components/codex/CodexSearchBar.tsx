/**
 * 词条搜索条 —— 放在 世界起源 / 自然环境 / 人文环境 面板顶部。
 * 搜索该面板下所有词条(按传入的 categoryKeys 限定),支持:
 *   · 全字匹配(名称/简介/字段值包含查询串)—— 最高优先;
 *   · 单字相关性(名称含查询里的若干个字)—— 模糊记忆也能定位,按命中字数排序。
 * 点结果 → 回调跳到对应方面(子页)。纯读现有词条数据,不加表不加依赖。
 */
import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useCodexStore } from '../../stores/codex'
import { parseEntryFields } from '../../lib/types/codex'
import { scoreCodexEntry } from '../../lib/codex/search'

interface Props {
  /** 本面板包含的词条分类(builtInKey 列表) */
  categoryKeys: string[]
  /** 点击结果:跳到该分类所属的子页(传 builtInKey) */
  onJump?: (categoryKey: string) => void
}

export default function CodexSearchBar({ categoryKeys, onJump }: Props) {
  const { categories, entries } = useCodexStore()
  const [q, setQ] = useState('')

  // 本面板的分类 id → builtInKey / 名称
  const catInfo = useMemo(() => {
    const m = new Map<number, { key: string; name: string }>()
    for (const c of categories) {
      if (c.builtInKey && categoryKeys.includes(c.builtInKey)) {
        m.set(c.id!, { key: c.builtInKey, name: c.name })
      }
    }
    return m
  }, [categories, categoryKeys])

  const results = useMemo(() => {
    const query = q.trim()
    if (!query) return []
    const scored: { id: number; name: string; cat: string; catKey: string; summary: string; score: number }[] = []
    for (const e of entries) {
      const info = catInfo.get(e.categoryId)
      if (!info) continue
      const name = (e.name || '').trim()
      const fieldsText = Object.values(parseEntryFields(e.fields)).join(' ')
      const score = scoreCodexEntry(name, e.summary || '', fieldsText, query)
      if (score === 0) continue
      scored.push({ id: e.id!, name: name || '未命名', cat: info.name, catKey: info.key, summary: e.summary || '', score })
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, 12)
  }, [q, entries, catInfo])

  return (
    <div className="relative">
      <div className="flex items-center gap-2 px-3 py-2 bg-bg-elevated border border-border rounded-lg">
        <Search className="w-4 h-4 text-text-muted shrink-0" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="搜索本面板词条（支持全字匹配 / 单字模糊定位）"
          className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
        />
        {q && (
          <button onClick={() => setQ('')} className="text-text-muted hover:text-text-primary shrink-0">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      {q.trim() && (
        <div className="absolute z-20 mt-1 w-full max-h-80 overflow-y-auto bg-bg-surface border border-border rounded-lg shadow-lg">
          {results.length === 0 ? (
            <p className="px-3 py-3 text-xs text-text-muted text-center">没有匹配的词条</p>
          ) : (
            results.map(r => (
              <button
                key={r.id}
                onClick={() => { onJump?.(r.catKey); setQ('') }}
                className="w-full text-left px-3 py-2 hover:bg-bg-hover border-b border-border/40 last:border-0"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-primary font-medium truncate">{r.name}</span>
                  <span className="text-[10px] text-text-muted bg-bg-elevated px-1.5 py-0.5 rounded shrink-0">{r.cat}</span>
                </div>
                {r.summary && <p className="text-xs text-text-muted truncate mt-0.5">{r.summary}</p>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
