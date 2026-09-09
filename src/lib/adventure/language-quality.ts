export interface TextAdventurePlayerVisibleLanguageIssueV1 {
  artifactKey: string
  path: string
  tokens: string[]
  excerpt: string
}

export interface TextAdventurePlayerVisibleLanguageIssueGroupV1 {
  artifactKey: string
  examples: TextAdventurePlayerVisibleLanguageIssueV1[]
  tokens: string[]
}

const PLAYER_VISIBLE_ARTIFACT_KEYS = new Set([
  'content.main-quest-plan',
  'content.narrative-arc-scenes',
  'content.adventure-side-quests',
  'content.adventure-ambient-events',
  'content.quest-script',
  'content.narrative',
  'content.product-module',
])

const PLAYER_VISIBLE_ARTIFACT_PREFIXES = [
  'content.scene-script.',
  'content.dialogue-pass.',
  'content.quest-script.',
] as const

const PLAYER_VISIBLE_FIELD_KEYS = new Set([
  'title', 'text', 'summary', 'description', 'unavailableReason', 'hook', 'objective',
  'narrativePurpose', 'successText', 'costlySuccessText', 'failureText', 'failureForwardText',
  'successConsequence', 'failureForwardConsequence', 'revisedText', 'revisedDescription',
])

/**
 * Chinese-language releases may still use compact acronyms such as AI, HP or
 * MP. A lower-case Latin word of three or more letters inside a player-facing
 * field is instead treated as an accidental model-language leak. Machine keys
 * and schema fields are never inspected.
 */
export function findTextAdventurePlayerVisibleLanguageIssuesV1(
  artifacts: ReadonlyArray<{ artifactKey: string; payload: unknown }>,
): TextAdventurePlayerVisibleLanguageIssueV1[] {
  const issues: TextAdventurePlayerVisibleLanguageIssueV1[] = []
  const visit = (artifactKey: string, value: unknown, path: string, fieldKey: string | null) => {
    if (typeof value === 'string') {
      if (!fieldKey || !PLAYER_VISIBLE_FIELD_KEYS.has(fieldKey)) return
      const tokens = [...value.matchAll(/[A-Za-z]{3,}/g)]
        .map(match => match[0])
        .filter(token => /[a-z]/.test(token))
      if (!tokens.length) return
      issues.push({
        artifactKey,
        path,
        tokens: [...new Set(tokens)].slice(0, 8),
        excerpt: value.length <= 160 ? value : `${value.slice(0, 157)}…`,
      })
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(artifactKey, item, `${path}[${index}]`, fieldKey))
      return
    }
    if (!value || typeof value !== 'object') return
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => (
      visit(artifactKey, item, path ? `${path}.${key}` : key, key)
    ))
  }
  for (const artifact of artifacts) {
    if (!PLAYER_VISIBLE_ARTIFACT_KEYS.has(artifact.artifactKey)
      && !PLAYER_VISIBLE_ARTIFACT_PREFIXES.some(prefix => artifact.artifactKey.startsWith(prefix))) continue
    visit(artifact.artifactKey, artifact.payload, '', null)
  }
  return issues.slice(0, 40)
}

export function groupTextAdventurePlayerVisibleLanguageIssuesV1(
  issues: readonly TextAdventurePlayerVisibleLanguageIssueV1[],
): TextAdventurePlayerVisibleLanguageIssueGroupV1[] {
  const groups = new Map<string, TextAdventurePlayerVisibleLanguageIssueV1[]>()
  for (const issue of issues) {
    const current = groups.get(issue.artifactKey) ?? []
    current.push(issue)
    groups.set(issue.artifactKey, current)
  }
  return [...groups].map(([artifactKey, entries]) => ({
    artifactKey,
    examples: entries.slice(0, 5),
    tokens: [...new Set(entries.flatMap(entry => entry.tokens))].slice(0, 12),
  }))
}
