import type {
  ChapterContinuityHandoff,
  ChapterPlanReconciliation,
  ChatMessage,
} from '../../types'
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

interface RawReconciliationItem {
  text?: unknown
  evidenceQuotes?: unknown
}

interface RawPlanReconciliation {
  completedGoals?: unknown
  unfinishedGoals?: unknown
  deviations?: unknown
  newConstraints?: unknown
  nextChapterImpacts?: unknown
  proposedOutlineSummary?: unknown
}

export interface ParsedChapterMemory {
  summary: string
  handoff: ChapterContinuityHandoff
  planReconciliation?: ChapterPlanReconciliation
}

export async function prepareChapterMemoryRequest(
  chapterTitle: string,
  chapterContent: string,
  chapterPlan = '',
  nextChapterPlan = '',
): Promise<PreparedChapterMemoryRequest> {
  const normalizedText = normalizeChapterText(chapterContent)
  const sourceTextHash = await hashChapterText(chapterContent)
  const tpl = usePromptStore.getState().getActive('chapter.memory')
  const { messages } = renderPrompt(tpl, {
    chapterTitle,
    chapterText: normalizedText,
    chapterPlan,
    nextChapterPlan,
  })
  if (chapterPlan && !tpl.variables.includes('chapterPlan')) {
    const last = messages[messages.length - 1]
    if (last?.role === 'user') {
      last.content += [
        '',
        '【兼容追加：计划—正文对账】',
        `原章纲与细纲：\n${chapterPlan}`,
        `下一章当前计划：\n${nextChapterPlan || '（无）'}`,
        '请在原 JSON 顶层同时输出 planReconciliation；每个条目必须带正文逐字 evidenceQuotes。',
      ].join('\n')
    }
  }
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

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => String(item ?? '').trim())
    .filter(Boolean)
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

function reconciliationItems(
  value: unknown,
  normalizedText: string,
): ChapterPlanReconciliation['completedGoals'] {
  if (!Array.isArray(value)) return []
  return value
    .map(raw => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
      const item = raw as RawReconciliationItem
      const text = String(item.text ?? '').trim()
      if (!text) return null
      const rawQuotes = Array.isArray(item.evidenceQuotes)
        ? item.evidenceQuotes as RawEvidenceQuote[]
        : []
      const evidenceQuotes = rawQuotes
        .map(quote => locateEvidenceQuote(normalizedText, quote))
        .filter((quote): quote is NonNullable<typeof quote> => quote !== null)
      if (!evidenceQuotes.length) return null
      return { text, evidenceQuotes }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
}

export function parseChapterMemoryOutput(args: {
  raw: string
  chapterId: number
  normalizedText: string
  sourceTextHash: string
  planSourceHash?: string
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

  let planReconciliation: ChapterPlanReconciliation | undefined
  const rawReconciliation = parsed.planReconciliation
  if (
    args.planSourceHash
    && rawReconciliation
    && typeof rawReconciliation === 'object'
    && !Array.isArray(rawReconciliation)
  ) {
    const reconciliation = rawReconciliation as RawPlanReconciliation
    planReconciliation = {
      chapterId: args.chapterId,
      sourceTextHash: args.sourceTextHash,
      planSourceHash: args.planSourceHash,
      schemaVersion: 1,
      extractorVersion: 'chapter-plan-reconciliation-v1',
      textNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION,
      completedGoals: reconciliationItems(reconciliation.completedGoals, args.normalizedText),
      unfinishedGoals: reconciliationItems(reconciliation.unfinishedGoals, args.normalizedText),
      deviations: reconciliationItems(reconciliation.deviations, args.normalizedText),
      newConstraints: reconciliationItems(reconciliation.newConstraints, args.normalizedText),
      nextChapterImpacts: reconciliationItems(reconciliation.nextChapterImpacts, args.normalizedText),
      proposedOutlineSummary: optionalString(reconciliation.proposedOutlineSummary),
      reviewStatus: 'pending',
      generatedAt: args.generatedAt ?? Date.now(),
    }
  }

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
    planReconciliation,
  }
}
