import type { InteractionSourceCharacterSnapshotV1 } from '../types'

const HASH = /^[a-f0-9]{64}$/
const KEY = /^[a-zA-Z0-9._:-]+$/

export function createInteractionSourceCharacterSnapshot(input: {
  worldContentHash: string
  characterExportId: number
  name: string
}): InteractionSourceCharacterSnapshotV1 {
  const worldContentHash = input.worldContentHash.trim()
  const name = input.name.trim()
  if (!HASH.test(worldContentHash)) throw new Error('[chatgame] 来源角色世界内容哈希无效')
  if (!Number.isInteger(input.characterExportId) || input.characterExportId < 0) {
    throw new Error('[chatgame] 来源角色便携引用无效')
  }
  if (!name || name.length > 240) throw new Error('[chatgame] 来源角色名称无效')
  return {
    schema: 'storyforge.interaction-source-character',
    version: 1,
    worldContentHash,
    characterExportId: input.characterExportId,
    characterKey: `world-release:${worldContentHash}:character:${input.characterExportId}`,
    name,
  }
}

export function parseInteractionSourceCharacterSnapshot(
  value: unknown,
): InteractionSourceCharacterSnapshotV1 | null {
  if (value == null || value === '') return null
  let parsed = value
  if (typeof parsed === 'string') {
    if (!parsed.trim() || parsed.trim() === '{}') return null
    try { parsed = JSON.parse(parsed) } catch { throw new Error('[chatgame] 来源角色快照不是合法 JSON') }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('[chatgame] 来源角色快照无效')
  }
  const row = parsed as Record<string, unknown>
  const result = createInteractionSourceCharacterSnapshot({
    worldContentHash: typeof row.worldContentHash === 'string' ? row.worldContentHash : '',
    characterExportId: typeof row.characterExportId === 'number' ? row.characterExportId : Number.NaN,
    name: typeof row.name === 'string' ? row.name : '',
  })
  if (row.schema !== result.schema || row.version !== result.version
    || row.characterKey !== result.characterKey || !KEY.test(result.characterKey)
    || result.characterKey.length > 160) {
    throw new Error('[chatgame] 来源角色快照身份不一致')
  }
  return result
}
