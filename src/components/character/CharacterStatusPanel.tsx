/**
 * 角色动态状态面板 — Phase 23.1
 *
 * 在角色卡片下方展示该角色的当前状态（来自状态卡系统），
 * 包括：位置、实力等级、持有物品、近期事件等。
 */
import { useMemo } from 'react'
import { MapPin, Zap, Package, History, Swords } from 'lucide-react'
import { useStateCardStore } from '../../stores/state-card'
import { parseFields, type StateField } from '../../lib/types/state-card'

interface Props {
  projectId: number
  characterName: string
}

/** 状态字段图标映射 */
function getFieldIcon(key: string) {
  const k = key.toLowerCase()
  if (k.includes('位置') || k.includes('地点') || k.includes('location')) return MapPin
  if (k.includes('实力') || k.includes('境界') || k.includes('等级') || k.includes('level')) return Zap
  if (k.includes('物品') || k.includes('装备') || k.includes('持有') || k.includes('item')) return Package
  if (k.includes('战斗') || k.includes('战力') || k.includes('技能')) return Swords
  return History
}

export default function CharacterStatusPanel({ projectId, characterName }: Props) {
  const { cards } = useStateCardStore()

  // 找到该角色的状态卡
  const stateCard = useMemo(() => {
    return cards.find(
      c => c.projectId === projectId
        && c.category === 'character'
        && c.entityName === characterName,
    )
  }, [cards, projectId, characterName])

  if (!stateCard) return null

  const fields: StateField[] = parseFields(stateCard.fields)
  if (fields.length === 0) return null

  return (
    <div className="mt-2 p-2 bg-bg-elevated/50 rounded-lg border border-border/50">
      <p className="text-[10px] text-text-muted font-medium mb-1.5 uppercase tracking-wide">
        当前状态
      </p>
      <div className="space-y-1">
        {fields.map((f, i) => {
          const Icon = getFieldIcon(f.key)
          return (
            <div key={i} className="flex items-start gap-1.5 text-xs">
              <Icon className="w-3 h-3 text-text-muted flex-shrink-0 mt-0.5" />
              <span className="text-text-muted flex-shrink-0">{f.key}：</span>
              <span className="text-text-secondary">{f.value}</span>
            </div>
          )
        })}
      </div>
      {stateCard.lastChapterId && (
        <p className="mt-1 text-[10px] text-text-muted">
          最后更新于章节 #{stateCard.lastChapterId}
        </p>
      )}
    </div>
  )
}
