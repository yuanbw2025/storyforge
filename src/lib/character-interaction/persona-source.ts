import type {ChatAuthoringSettingsV3} from './authoring-contract'
import type {FrozenChatSourceProjectionV1} from '../types/character-interaction'
import type {ChatPersonaV1} from '../types/chat-narrative'
import {isSha256Hash} from '../product-production/hash'

/** Persona text is the author's explicit shared fiction, not a copy of private source fields. */
export function createChatPersonaV1(settings: ChatAuthoringSettingsV3, source: FrozenChatSourceProjectionV1): ChatPersonaV1 {
  const key = settings.narrative.playerCharacterKey
  if (key !== source.playerCharacterSource?.resourceKey) throw new Error('玩家人物与已确认的世界来源不一致')
  return {playerKey: 'player', name: settings.narrative.personaName, description: settings.playerRole,
    origin: key ? 'world-character' : 'product-private',
    ...(key ? {source: {...source.playerCharacterSource!}} : {})}
}

export function parseChatPersonaV1(value: unknown, aiCharacterKeys: readonly string[]): ChatPersonaV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('玩家身份无效')
  const row = value as Record<string, unknown>
  const mapped = row.origin === 'world-character'
  if (Object.keys(row).sort().join(',') !== (mapped ? 'description,name,origin,playerKey,source' : 'description,name,origin,playerKey')
    || row.playerKey !== 'player' || !['world-character', 'product-private'].includes(String(row.origin))
    || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 200
    || typeof row.description !== 'string' || !row.description.trim() || row.description.length > 4000) throw new Error('玩家身份字段或内容无效')
  if (mapped) {
    const source = row.source as Record<string, unknown> | undefined
    if (!source || typeof source !== 'object' || Array.isArray(source) || Object.keys(source).sort().join(',') !== 'resourceKey,sourceHash'
      || typeof source.resourceKey !== 'string' || !source.resourceKey.trim() || source.resourceKey.length > 500
      || aiCharacterKeys.includes(source.resourceKey) || !isSha256Hash(source.sourceHash)) throw new Error('玩家人物来源无效或与 AI 角色重复')
  }
  return structuredClone(value) as ChatPersonaV1
}
