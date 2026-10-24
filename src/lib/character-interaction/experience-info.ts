import type {ChatAuthoringSettings} from './authoring-contract'

/** Public statements supplied by the author, not verified identity or a
 * platform license. They are frozen with the release, never role knowledge. */
export interface ChatExperienceInfoV1 {
  version: 1
  author: string
  attribution: string
  usageTerms: string
}
export const CHAT_EXPERIENCE_INFO_LIMITS = {author: 200, attribution: 8000, usageTerms: 8000} as const

export function parseChatExperienceInfoV1(value: unknown): ChatExperienceInfoV1 {
  const row = value as ChatExperienceInfoV1
  if (!row || typeof row !== 'object' || Array.isArray(row) || row.version !== 1
    || Object.keys(row).sort().join(',') !== 'attribution,author,usageTerms,version'
    || Object.entries(CHAT_EXPERIENCE_INFO_LIMITS).some(([key, limit]) =>
      typeof row[key as keyof typeof CHAT_EXPERIENCE_INFO_LIMITS] !== 'string'
      || row[key as keyof typeof CHAT_EXPERIENCE_INFO_LIMITS].length > limit)
    || !row.author.trim() || !row.usageTerms.trim()) {
    throw new Error('请填写作品署名和使用说明；署名最多 200 字，归属与使用说明各最多 8000 字')
  }
  return structuredClone(row)
}

/** Both registered author/production readers exclude publication metadata.
 * Deterministic compilers keep reading the original authorized Brief. */
export function chatSettingsForAIContextV1(settings: ChatAuthoringSettings): ChatAuthoringSettings {
  const result = structuredClone(settings)
  if (result.version === 3) {
    delete result.experienceInfo
    if (result.privateCharacters) {
      result.privateCharacters = result.privateCharacters.map(({cardOrigin: _cardOrigin, ...character}) => character)
    }
  }
  return result
}
