import { buildChapterOrganizationPrompt } from '../agent/chapter-organization'
import { hashCanonicalValue } from '../agent/run/hash'
import { buildFactExtractPrompt } from '../ai/adapters/fact-extract-adapter'
import { normalizeChapterText } from '../ai/chapter-memory/text-normalization'
import { assembleContext } from '../registry/assemble-context'
import type { AIConfig, Chapter, Character, CharacterRelation, ChatMessage, Foreshadow, ItemLedgerEntry, WorkspaceScope } from '../types'
import { readOwnedRows } from '../workspace/scope'
import { AUTHORING_NODE_BY_ID } from './catalog'

export interface AuthoringCanonicalChapterContext {
  scheme: 'registered-chapter-context-v2'
  sourceKeys: string[]
  inputBudgetTokens: number
  provider: AIConfig['provider']
  model: string
}

export function chapterNodeContextPolicy(templateId: string, inputBudgetTokens: number, config: AIConfig): AuthoringCanonicalChapterContext {
  return {
    scheme: 'registered-chapter-context-v2',
    sourceKeys: [...(AUTHORING_NODE_BY_ID.get(templateId)?.reads?.sourceKeys ?? [])],
    inputBudgetTokens, provider: config.provider, model: config.model,
  }
}

interface ChapterSourceInput {
  projectId: number
  scope: WorkspaceScope
  worldGroupId: number | null
  chapter: Chapter
  policy: AuthoringCanonicalChapterContext
}

type Assembly = Awaited<ReturnType<typeof assembleContext>>

function segment(assembled: Assembly, key: string) {
  const index = assembled.included.indexOf(key)
  return index >= 0 ? assembled.segments[index]?.content ?? '' : ''
}

async function readChapterSource({ projectId, scope, worldGroupId, chapter, policy }: ChapterSourceInput) {
  const assembled = await assembleContext({
    projectId, scope, worldGroupId, chapterId: chapter.id, outlineNodeId: chapter.outlineNodeId,
    sourceKeys: policy.sourceKeys, inputBudgetTokens: policy.inputBudgetTokens, provider: policy.provider, model: policy.model,
  })
  const chapterText = normalizeChapterText(segment(assembled, 'chapterContent') || chapter.content || '')
  return { assembled, chapterText }
}

// The model also receives the chapter title and, for organization, scoped target
// lists. Hash the exact prepared messages before dispatch alongside registered sources.
function fingerprint(policy: AuthoringCanonicalChapterContext, assembly: Assembly, messages: ChatMessage[]) {
  return hashCanonicalValue({ keys: policy.sourceKeys, context: assembly.text, messages })
}

export async function readFactNodeSource(input: ChapterSourceInput) {
  const { assembled, chapterText } = await readChapterSource(input)
  const messages = buildFactExtractPrompt({ chapterTitle: input.chapter.title, chapterContent: chapterText })
  return { assembled, chapterText, messages, sourceHash: await fingerprint(input.policy, assembled, messages) }
}

export async function readOrganizationNodeSource(input: ChapterSourceInput) {
  const { assembled, chapterText } = await readChapterSource(input)
  const { scope, worldGroupId } = input
  const [allCharacters, relations, foreshadows, itemRows] = await Promise.all([
    readOwnedRows<Character>(scope, 'characters', { owner: 'world' }),
    readOwnedRows<CharacterRelation>(scope, 'characterRelations', { owner: 'world' }),
    readOwnedRows<Foreshadow>(scope, 'foreshadows', { owner: 'work' }),
    readOwnedRows<ItemLedgerEntry>(scope, 'itemLedger', { owner: 'work' }),
  ])
  const characters = allCharacters.filter(character => character.isCrossWorld || (character.homeWorldGroupId ?? null) === worldGroupId)
  const visibleIds = new Set(characters.flatMap(character => character.id == null ? [] : [character.id]))
  const visibleRelations = relations.filter(relation => visibleIds.has(relation.fromCharacterId) && visibleIds.has(relation.toCharacterId))
  const messages = buildChapterOrganizationPrompt({
    chapterTitle: input.chapter.title, chapterText,
    stateContext: ['stateCards', 'currentFacts', 'characterKnowledge', 'storylineProgress']
      .map(key => segment(assembled, key)).filter(Boolean).join('\n\n'),
    characters, existingRelations: visibleRelations, foreshadows,
    knownItemNames: [...new Set(itemRows.map(item => item.itemName.trim()).filter(Boolean))],
  })
  return { assembled, chapterText, messages, characters, visibleRelations, foreshadows, sourceHash: await fingerprint(input.policy, assembled, messages) }
}
