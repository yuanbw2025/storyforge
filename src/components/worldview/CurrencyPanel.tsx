/**
 * 货币体系管理面板 — Phase 23.2
 *
 * 管理世界的货币单位和兑换关系，
 * 数据存储在 worldview.economy 字段（JSON 格式），
 * 写作时自动注入到 AI prompt 避免 AI 搞错货币。
 */
import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Coins, ArrowRightLeft } from 'lucide-react'
import { CInput } from '../shared/CompositionInput'
import { useWorldviewStore } from '../../stores/worldview'

export interface Currency {
  id: string
  name: string       // 如"灵石"
  symbol: string     // 如"💎"
  description: string // 如"修仙界通用货币"
  value: number      // 相对基准值
}

export interface CurrencySystem {
  currencies: Currency[]
  baseCurrencyId: string  // 基准货币 ID
  note: string           // 备注
}

function emptyCurrencySystem(): CurrencySystem {
  return { currencies: [], baseCurrencyId: '', note: '' }
}

function parseCurrencySystem(json: string | undefined): CurrencySystem {
  if (!json) return emptyCurrencySystem()
  try {
    const parsed = JSON.parse(json)
    if (parsed.currencies) return parsed
    return emptyCurrencySystem()
  } catch {
    return emptyCurrencySystem()
  }
}

interface Props {
  projectId: number
}

export default function CurrencyPanel({ projectId }: Props) {
  const { worldview, saveWorldview } = useWorldviewStore()
  const [system, setSystem] = useState<CurrencySystem>(emptyCurrencySystem())

  useEffect(() => {
    if (worldview?.economy) {
      setSystem(parseCurrencySystem(worldview.economy))
    }
  }, [worldview?.economy])

  const save = useCallback(async (next: CurrencySystem) => {
    setSystem(next)
    await saveWorldview({
      projectId,
      economy: JSON.stringify(next),
    })
  }, [projectId, saveWorldview])

  const addCurrency = () => {
    const id = `cur-${Date.now()}`
    const next: CurrencySystem = {
      ...system,
      currencies: [...system.currencies, {
        id, name: '新货币', symbol: '💰',
        description: '', value: 1,
      }],
      baseCurrencyId: system.baseCurrencyId || id,
    }
    save(next)
  }

  const updateCurrency = (id: string, patch: Partial<Currency>) => {
    const next: CurrencySystem = {
      ...system,
      currencies: system.currencies.map(c =>
        c.id === id ? { ...c, ...patch } : c,
      ),
    }
    save(next)
  }

  const removeCurrency = (id: string) => {
    const next: CurrencySystem = {
      ...system,
      currencies: system.currencies.filter(c => c.id !== id),
      baseCurrencyId: system.baseCurrencyId === id
        ? (system.currencies.find(c => c.id !== id)?.id || '')
        : system.baseCurrencyId,
    }
    save(next)
  }

  const baseCurrency = system.currencies.find(c => c.id === system.baseCurrencyId)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-text-primary flex items-center gap-1.5">
          <Coins className="w-4 h-4 text-yellow-500" />
          货币体系
        </h4>
        <button
          onClick={addCurrency}
          className="flex items-center gap-1 px-2 py-1 text-xs text-accent hover:bg-accent/10 rounded"
        >
          <Plus className="w-3 h-3" /> 添加货币
        </button>
      </div>

      {system.currencies.length === 0 ? (
        <p className="text-xs text-text-muted py-3 text-center">
          暂无货币。点击「添加货币」开始构建货币体系。
        </p>
      ) : (
        <div className="space-y-2">
          {system.currencies.map(cur => (
            <div key={cur.id} className="flex items-start gap-2 p-2 bg-bg-elevated rounded-lg border border-border/50">
              <CInput
                value={cur.symbol}
                onChange={e => updateCurrency(cur.id, { symbol: e.target.value })}
                className="w-10 text-center bg-bg-base border border-border rounded px-1 py-1 text-sm"
              />
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <CInput
                    value={cur.name}
                    onChange={e => updateCurrency(cur.id, { name: e.target.value })}
                    className="flex-1 bg-bg-base border border-border rounded px-2 py-1 text-xs text-text-primary font-medium"
                    placeholder="货币名称"
                  />
                  <CInput
                    value={String(cur.value)}
                    onChange={e => updateCurrency(cur.id, { value: Number(e.target.value) || 1 })}
                    className="w-20 bg-bg-base border border-border rounded px-2 py-1 text-xs text-text-primary text-center"
                    placeholder="兑换比"
                  />
                  {system.baseCurrencyId !== cur.id && (
                    <button
                      onClick={() => save({ ...system, baseCurrencyId: cur.id })}
                      className="text-[10px] px-1.5 py-0.5 text-text-muted hover:text-accent rounded"
                      title="设为基准货币"
                    >
                      基准
                    </button>
                  )}
                  {system.baseCurrencyId === cur.id && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-yellow-500/10 text-yellow-500 rounded">
                      基准
                    </span>
                  )}
                </div>
                <CInput
                  value={cur.description}
                  onChange={e => updateCurrency(cur.id, { description: e.target.value })}
                  className="w-full bg-bg-base border border-border rounded px-2 py-1 text-xs text-text-secondary"
                  placeholder="描述（如：修仙界通用货币）"
                />
              </div>
              <button
                onClick={() => removeCurrency(cur.id)}
                className="p-1 text-text-muted hover:text-error flex-shrink-0"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 兑换关系提示 */}
      {system.currencies.length >= 2 && baseCurrency && (
        <div className="p-2 bg-bg-base rounded-lg text-xs text-text-muted">
          <p className="flex items-center gap-1 mb-1">
            <ArrowRightLeft className="w-3 h-3" /> 兑换关系（基准：{baseCurrency.symbol} {baseCurrency.name}）
          </p>
          {system.currencies.filter(c => c.id !== system.baseCurrencyId).map(c => (
            <p key={c.id} className="ml-4">
              1 {baseCurrency.symbol}{baseCurrency.name} = {(c.value / baseCurrency.value).toFixed(c.value >= baseCurrency.value ? 0 : 2)} {c.symbol}{c.name}
            </p>
          ))}
        </div>
      )}

      <CInput
        value={system.note}
        onChange={e => save({ ...system, note: e.target.value })}
        className="w-full bg-bg-base border border-border rounded px-2 py-1.5 text-xs text-text-secondary"
        placeholder="货币体系备注（如：上古时期用玉币，现以灵石为主）"
      />
    </div>
  )
}

/**
 * 构建货币体系上下文注入到 AI prompt
 * 在 context-builder 中调用
 */
export function buildCurrencyContext(economyJson: string | undefined): string {
  const system = parseCurrencySystem(economyJson)
  if (system.currencies.length === 0) return ''
  const baseCurrency = system.currencies.find(c => c.id === system.baseCurrencyId)
  const lines = ['【货币体系】']
  for (const c of system.currencies) {
    lines.push(`- ${c.symbol} ${c.name}${c.description ? `（${c.description}）` : ''}`)
  }
  if (system.currencies.length >= 2 && baseCurrency) {
    lines.push('兑换关系：')
    for (const c of system.currencies) {
      if (c.id === system.baseCurrencyId) continue
      lines.push(`  1 ${baseCurrency.name} = ${(c.value / baseCurrency.value).toFixed(c.value >= baseCurrency.value ? 0 : 2)} ${c.name}`)
    }
  }
  if (system.note) lines.push(`备注：${system.note}`)
  lines.push('写作时请严格使用以上货币名称和兑换关系，不要自创货币。')
  return lines.join('\n')
}
