import type {FrozenInteractionRuntimeV2} from '../types'

/** Public attribution, not story knowledge or a grant of redistribution rights. */
export interface ChatCharacterCardCreditsV1 {
  version: 1
  characters: Array<{
    participantKey: string; characterKey: string; sourceHash: string
    cardContentHash: string; creator: string; characterVersion: string
  }>
}
export function parseChatCharacterCardCreditsV1(value: unknown, interaction: FrozenInteractionRuntimeV2): ChatCharacterCardCreditsV1 {
  const fail = (): never => {throw new Error('外部角色卡署名与冻结人物来源不一致')}
  const credits = value as ChatCharacterCardCreditsV1
  if (!credits || typeof credits !== 'object' || Array.isArray(credits) || Object.keys(credits).sort().join(',') !== 'characters,version'
    || credits.version !== 1 || !Array.isArray(credits.characters) || !credits.characters.length || credits.characters.length > 8) fail()
  const seen = new Set<string>()
  for (const row of credits.characters) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || Object.keys(row).sort().join(',') !== 'cardContentHash,characterKey,characterVersion,creator,participantKey,sourceHash'
      || typeof row.creator !== 'string' || row.creator.length > 1000 || typeof row.characterVersion !== 'string' || row.characterVersion.length > 200
      || typeof row.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.sourceHash)
      || typeof row.cardContentHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.cardContentHash)
      || seen.has(row.participantKey)
      || !interaction.profiles.some(profile => profile.participantKey === row.participantKey && profile.characterKey === row.characterKey)
      || !interaction.chatSource?.privateCharacterSources?.some(source => source.resourceKey === row.characterKey && source.sourceHash === row.sourceHash)) fail()
    seen.add(row.participantKey)
  }
  return structuredClone(credits)
}
