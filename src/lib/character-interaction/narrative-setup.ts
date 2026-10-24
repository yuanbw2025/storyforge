import type { ChatNarrativePermissionsV1 } from '../types/chat-narrative'
import { parseChatNarrativePermissionsV1 } from './narrative-contract'

/** S2 choices. The seed and fictional persona description remain in the existing
 * openingSituation/playerRole fields; do not mirror them in a second store. */
export interface ChatNarrativeSetupV1 {
  personaName: string
  /** Optional portable WorldRelease character identity, controlled by the player rather than the AI. */
  playerCharacterKey?: string
  location: string
  timeLabel: string
  openingCount: number
  permissions: ChatNarrativePermissionsV1
}

export const DEFAULT_CHAT_NARRATIVE_SETUP_V1: ChatNarrativeSetupV1 = {
  personaName: '你', location: '', timeLabel: '', openingCount: 3,
  permissions: {
    mode: 'story', triggers: ['scene-start', 'player-response', 'continue', 'return', 'player-seed'],
    allowedNewFactKinds: ['observation', 'object'], maxNewFactsPerAction: 2,
    maxActiveThreads: 2, maxActionsPerTrigger: 2, maxActionCharacters: 1800, intensity: 'everyday', allowActorSituationExpansion: true, allowPlayerFollowupSituations: true,
  },
}

export function parseChatNarrativeSetupV1(value: unknown): ChatNarrativeSetupV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('主动叙事设置必须是对象')
  const row = value as Record<string, unknown>
  const mapped = Object.prototype.hasOwnProperty.call(row, 'playerCharacterKey')
  if (Object.keys(row).sort().join(',') !== (mapped ? 'location,openingCount,permissions,personaName,playerCharacterKey,timeLabel' : 'location,openingCount,permissions,personaName,timeLabel')) throw new Error('主动叙事设置字段无效')
  if (mapped && (typeof row.playerCharacterKey !== 'string' || !row.playerCharacterKey.trim() || row.playerCharacterKey.length > 500)) throw new Error('玩家人物来源无效')
  if (typeof row.personaName !== 'string' || !row.personaName.trim() || row.personaName.length > 200) throw new Error('请填写玩家虚构角色的称呼')
  for (const field of ['location', 'timeLabel']) {
    if (typeof row[field] !== 'string' || String(row[field]).length > 1000) throw new Error('情境时间或地点最多 1000 字符')
  }
  if (!Number.isInteger(row.openingCount) || Number(row.openingCount) < 3 || Number(row.openingCount) > 5) throw new Error('开场候选数应为 3～5')
  return {...structuredClone(value) as ChatNarrativeSetupV1, permissions: parseChatNarrativePermissionsV1(row.permissions)}
}
