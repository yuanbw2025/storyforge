import type { ChapterContinuityHandoff, ChatMessage } from '../../types'
import { usePromptStore } from '../../../stores/prompt'
import { renderPrompt } from '../prompt-engine'
import {
  CHAPTER_TEXT_NORMALIZATION_VERSION,
  hashChapterText,
  normalizeChapterText,
} from '../chapter-memory/text-normalization'

export const CHAPTER_MEMORY_SCHEMA_VERSION = 1
export const CHAPTER_MEMORY_EXTRACTOR_VERSION = 'chapter-memory-v1'

export interface PreparedChapterMemoryRequest {
  normalizedText: string
  sourceTextHash: string
  messages: ChatMessage[]
}

interface RawEvidenceQuote {
  quote?: unknown
  prefix?: unknown
  suffix?: unknown
}

interface RawHandoff {
  finalScene?: {
    location?: unknown
    storyTime?: unknown
    activeCharacters?: unknown
    lastAction?: unknown
  }
  stateChanges?: unknown
  knowledgeChanges?: unknown
  commitments?: unknown
  openLoops?: unknown
  immediateNextIntent?: unknown
  evidenceQuotes?: unknown
}

export interface ParsedChapterMemory {
  summary: string
  handoff: ChapterContinuityHandoff
}

export async function prepareChapterMemoryRequest(
  chapterTitle: string,
  chapterContent: string,
): Promise<PreparedChapterMemoryRequest> {
  const normalizedText = normalizeChapterText(chapterContent)
  const sourceTextHash = await hashChapterText(chapterContent)
  const tpl = usePromptStore.getState().getActive('chapter.memory')
  const { messages } = renderPrompt(tpl, { chapterTitle, chapterText: normalizedText })
  return { normalizedText, sourceTextHash, messages }
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  let json = fence ? fence[1].trim() : trimmed
  const start = json.indexOf('{')
  const end = json.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  json = json.slice(start, end + 1)
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function strings(value: unknown, max = 24): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, max)
}

function optionalString(value: unknown): string | undefined {
  const text = String(value ?? '').trim()
  return text || undefined
}

function optionalAnchor(value: unknown): string | undefined {
  const text = String(value ?? '')
  return text.trim() ? text : undefined
}

function allExactOffsets(text: string, quote: string): number[] {
  const offsets: number[] = []
  let start = 0
  while (start <= text.length - quote.length) {
    const found = text.indexOf(quote, start)
    if (found < 0) break
    offsets.push(found)
    start = found + 1
  }
  return offsets
}

function locateEvidenceQuote(
  normalizedText: string,
  raw: RawEvidenceQuote,
): ChapterContinuityHandoff['evidenceQuotes'][number] | null {
  const quote = String(raw.quote ?? '').trim()
  if (!quote) return null
  let offsets = allExactOffsets(normalizedText, quote)
  if (offsets.length === 0) return null

  if (offsets.length > 1) {
    const prefix = optionalAnchor(raw.prefix)
    const suffix = optionalAnchor(raw.suffix)
    if (!prefix && !suffix) return null
    offsets = offsets.filter(offset => {
      const before = normalizedText.slice(Math.max(0, offset - (prefix?.length ?? 0)), offset)
      const after = normalizedText.slice(offset + quote.length, offset + quote.length + (suffix?.length ?? 0))
      return (!prefix || before === prefix) && (!suffix || after === suffix)
    })
  }
  if (offsets.length !== 1) return null

  const startOffset = offsets[0]
  const endOffset = startOffset + quote.length
  if (normalizedText.slice(startOffset, endOffset) !== quote) return null
  return { quote, startOffset, endOffset }
}

export function parseChapterMemoryOutput(args: {
  raw: string
  chapterId: number
  normalizedText: string
  sourceTextHash: string
  generatedAt?: number
}): ParsedChapterMemory | null {
  const parsed = extractJsonObject(args.raw)
  if (!parsed) return null
  const summary = String(parsed.summary ?? '').trim()
  const rawHandoff = parsed.handoff
  if (!summary || !rawHandoff || typeof rawHandoff !== 'object' || Array.isArray(rawHandoff)) return null
  const handoff = rawHandoff as RawHandoff
  const finalScene = handoff.finalScene && typeof handoff.finalScene === 'object'
    ? handoff.finalScene
    : {}
  const rawQuotes = Array.isArray(handoff.evidenceQuotes)
    ? handoff.evidenceQuotes as RawEvidenceQuote[]
    : []
  const evidenceQuotes = rawQuotes
    .map(quote => locateEvidenceQuote(args.normalizedText, quote))
    .filter((quote): quote is NonNullable<typeof quote> => quote !== null)
    .slice(0, 24)

  return {
    summary,
    handoff: {
      chapterId: args.chapterId,
      sourceTextHash: args.sourceTextHash,
      schemaVersion: CHAPTER_MEMORY_SCHEMA_VERSION,
      extractorVersion: CHAPTER_MEMORY_EXTRACTOR_VERSION,
      textNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION,
      finalScene: {
        location: optionalString(finalScene.location),
        storyTime: optionalString(finalScene.storyTime),
        activeCharacters: strings(finalScene.activeCharacters),
        lastAction: optionalString(finalScene.lastAction),
      },
      stateChanges: strings(handoff.stateChanges),
      knowledgeChanges: strings(handoff.knowledgeChanges),
      commitments: strings(handoff.commitments),
      openLoops: strings(handoff.openLoops),
      immediateNextIntent: optionalString(handoff.immediateNextIntent),
      evidenceQuotes,
      generatedAt: args.generatedAt ?? Date.now(),
    },
  }
}
