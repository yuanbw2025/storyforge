import { countWords, toHtml } from '../utils/html'
import { buildBestChapterByOutlineMap } from '../chapters/selectors'
import { walkOutlineChaptersInCanonicalOrder } from '../outline/canonical-outline-walk'
import type { Chapter, OutlineNode } from '../types'

export interface FindReplaceOptions {
  query: string
  caseSensitive?: boolean
  wholeWord?: boolean
  useRegex?: boolean
  protectedTerms?: string[]
}

export interface FindReplaceOccurrence {
  occurrenceIndex: number
  snippet: string
  matchText: string
}

export interface ChapterMatchPreview {
  chapterId: number
  outlineNodeId: number
  title: string
  count: number
  occurrences: FindReplaceOccurrence[]
}

export interface ChapterSearchTarget {
  id: number
  outlineNodeId: number
  title: string
  content: string
}

interface TextMatch {
  start: number
  end: number
  text: string
  match: RegExpExecArray
}

export interface ReplaceChapterResult {
  html: string
  plainText: string
  wordCount: number
  count: number
}

export function buildChapterSearchTargets(
  chapters: Chapter[],
  outlineNodes: OutlineNode[],
): ChapterSearchTarget[] {
  const chapterByOutline = buildBestChapterByOutlineMap(chapters)
  return walkOutlineChaptersInCanonicalOrder(outlineNodes).chapters
    .map(entry => {
      const outlineNodeId = entry.outlineNode.id
      if (outlineNodeId == null) return null
      const chapter = chapterByOutline.get(outlineNodeId)
      if (!chapter?.id) return null
      return {
        id: chapter.id,
        outlineNodeId,
        title: entry.outlineNode.title || chapter.title || `章节#${chapter.id}`,
        content: chapter.content || '',
      }
    })
    .filter((target): target is ChapterSearchTarget => !!target)
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isAsciiWordChar(char: string | undefined): boolean {
  return !!char && /[A-Za-z0-9_]/.test(char)
}

function createSearchRegExp(options: FindReplaceOptions): RegExp | null {
  const query = options.query.trim()
  if (!query) return null
  const source = options.useRegex ? query : escapeRegExp(query)
  const flags = options.caseSensitive ? 'gu' : 'giu'
  return new RegExp(source, flags)
}

function findMatchesInText(text: string, options: FindReplaceOptions): TextMatch[] {
  const regex = createSearchRegExp(options)
  if (!regex) return []

  const matches: TextMatch[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match[0] === '') {
      regex.lastIndex += 1
      continue
    }
    const start = match.index
    const end = start + match[0].length
    if (options.wholeWord && (isAsciiWordChar(text[start - 1]) || isAsciiWordChar(text[end]))) continue
    if (options.wholeWord && isInsideProtectedLongerTerm(text, start, end, options)) continue
    matches.push({ start, end, text: match[0], match })
  }
  return matches
}

function normalizeForCompare(input: string, caseSensitive?: boolean): string {
  return caseSensitive ? input : input.toLocaleLowerCase()
}

function isInsideProtectedLongerTerm(
  text: string,
  start: number,
  end: number,
  options: FindReplaceOptions,
): boolean {
  const query = normalizeForCompare(options.query.trim(), options.caseSensitive)
  if (!query) return false

  const protectedTerms = (options.protectedTerms ?? [])
    .map(term => term.trim())
    .filter(term => term.length > options.query.trim().length)

  if (!protectedTerms.length) return false

  const normalizedText = normalizeForCompare(text, options.caseSensitive)
  for (const term of protectedTerms) {
    const normalizedTerm = normalizeForCompare(term, options.caseSensitive)
    let at = normalizedText.indexOf(normalizedTerm)
    while (at >= 0) {
      const protectedEnd = at + normalizedTerm.length
      if (start >= at && end <= protectedEnd) return true
      at = normalizedText.indexOf(normalizedTerm, at + 1)
    }
  }
  return false
}

function createHtmlContainer(content: string): HTMLDivElement {
  const container = document.createElement('div')
  container.innerHTML = toHtml(content)
  return container
}

function textNodesOf(root: Node): Text[] {
  const nodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    nodes.push(node as Text)
    node = walker.nextNode()
  }
  return nodes
}

function snippetFor(text: string, match: TextMatch): string {
  const radius = 26
  const start = Math.max(0, match.start - radius)
  const end = Math.min(text.length, match.end + radius)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return `${prefix}${text.slice(start, end)}${suffix}`.replace(/\s+/g, ' ').trim()
}

function expandReplacement(template: string, match: RegExpExecArray, matchedText: string): string {
  return template.replace(/\$(\$|&|\d{1,2})/g, (token, key: string) => {
    if (key === '$') return '$'
    if (key === '&') return matchedText
    const index = Number(key)
    if (!Number.isFinite(index) || index <= 0) return token
    return match[index] ?? ''
  })
}

export function findChapterMatches(
  target: ChapterSearchTarget,
  options: FindReplaceOptions,
): ChapterMatchPreview | null {
  if (!options.query.trim()) return null
  const container = createHtmlContainer(target.content)
  const occurrences: FindReplaceOccurrence[] = []

  for (const node of textNodesOf(container)) {
    const text = node.textContent ?? ''
    for (const match of findMatchesInText(text, options)) {
      occurrences.push({
        occurrenceIndex: occurrences.length,
        snippet: snippetFor(text, match),
        matchText: match.text,
      })
    }
  }

  if (!occurrences.length) return null
  return {
    chapterId: target.id,
    outlineNodeId: target.outlineNodeId,
    title: target.title,
    count: occurrences.length,
    occurrences,
  }
}

export function replaceChapterContent(
  content: string,
  options: FindReplaceOptions & { replacement: string },
  filter?: { onlyOccurrenceIndex?: number; maxReplacements?: number },
): ReplaceChapterResult {
  const container = createHtmlContainer(content)
  let occurrenceIndex = 0
  let replacedCount = 0

  for (const node of textNodesOf(container)) {
    const text = node.textContent ?? ''
    const matches = findMatchesInText(text, options)
    if (!matches.length) continue

    let cursor = 0
    let changed = false
    let next = ''
    for (const match of matches) {
      const currentOccurrence = occurrenceIndex++
      const occurrenceAllowed = filter?.onlyOccurrenceIndex == null
        || currentOccurrence === filter.onlyOccurrenceIndex
      const underLimit = filter?.maxReplacements == null
        || replacedCount < filter.maxReplacements

      if (!occurrenceAllowed || !underLimit) continue
      next += text.slice(cursor, match.start)
      next += options.useRegex
        ? expandReplacement(options.replacement, match.match, match.text)
        : options.replacement
      cursor = match.end
      changed = true
      replacedCount += 1
    }

    if (changed) {
      next += text.slice(cursor)
      node.textContent = next
    }
  }

  const html = container.innerHTML
  const plainText = container.textContent ?? ''
  return {
    html,
    plainText,
    wordCount: countWords(plainText),
    count: replacedCount,
  }
}
