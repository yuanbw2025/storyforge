/**
 * 角色动态状态面板 — Phase 23.1
 *
 * 在角色卡片下方展示该角色的当前状态（来自状态卡系统），
 * 包括：位置、实力等级、持有物品、近期事件等。
 */
import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import { MapPin, Zap, Package, History, Swords } from 'lucide-react'
import { db } from '../../lib/db/schema'
import { assertRecordInScope, readOwnedRows, resolveReadScopeLike } from '../../lib/workspace/scope'
import { inspectStateFields } from '../../lib/types/state-card'
import type { Chapter, StateCard, WorkspaceScope } from '../../lib/types'

interface Props {
  scope: WorkspaceScope
  characterId: number | undefined
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

export default function CharacterStatusPanel({ scope, characterId, characterName }: Props) {
  const { projectId, worldId, workId } = scope
  const key = `${projectId}:${worldId}:${workId}:${characterId}:${characterName}`
  const [readback, setReadback] = useState<{ key: string; card: StateCard | null; chapter: Chapter | null; error?: string } | null>(null)
  useEffect(() => {
    const subscription = liveQuery(async () => {
      const frozenScope = await resolveReadScopeLike({ projectId, worldId, workId })
      const character = characterId == null ? null : await db.characters.get(characterId)
      if (!character || character.name !== characterName || !await assertRecordInScope(frozenScope, 'characters', character, { owner: 'world' })) {
        return { key, card: null, chapter: null }
      }
      const card = (await readOwnedRows<StateCard>(frozenScope, 'stateCards', { owner: 'work' }))
        .find(card => card.category === 'character' && card.entityName === characterName) ?? null
      const chapter = card?.lastChapterId ? await db.chapters.get(card.lastChapterId) : null
      return { key, card, chapter: chapter && await assertRecordInScope(frozenScope, 'chapters', chapter, { owner: 'work' }) ? chapter : null }
    }).subscribe({ next: setReadback, error: () => setReadback({ key, card: null, chapter: null, error: '当前作品的角色状态读取失败，请重新打开后重试。' }) })
    return () => subscription.unsubscribe()
  }, [projectId, worldId, workId, characterId, characterName, key])

  const stateCard = readback?.key === key ? readback.card : null
  const sourceChapter = readback?.key === key ? readback.chapter : null
  if (readback?.key === key && readback.error) return <p role="alert" className="text-xs text-error">{readback.error}</p>
  if (!stateCard) return null

  const result = inspectStateFields(stateCard.fields)
  if (!result.ok) return <p role="alert" className="mt-2 text-xs text-error">
    {result.error} 请到“状态与物品”修复，原始记录已保留。
  </p>
  const fields = result.fields
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
      {sourceChapter?.projectId === projectId && sourceChapter.id === stateCard.lastChapterId && (
        <p className="mt-1 text-[10px] text-text-muted">
          最后更新于《{sourceChapter.title}》
        </p>
      )}
    </div>
  )
}
