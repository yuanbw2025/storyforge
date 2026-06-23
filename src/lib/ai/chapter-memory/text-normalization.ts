import type { Chapter } from '../../types'

export const CHAPTER_TEXT_NORMALIZATION_VERSION = 'chapter-text-v1'

const BLOCK_END_TAG = /<\/(?:p|div|h[1-6]|li|blockquote|pre|section|article|tr)>/gi
const BREAK_TAG = /<br\s*\/?>/gi
const SCRIPT_OR_STYLE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi
const ANY_TAG = /<[^>]+>/g

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  }
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&([a-z]+);/gi, (entity, name: string) => named[name.toLowerCase()] ?? entity)
}

/**
 * 无 DOM、跨浏览器/Vitest 一致的章节正文标准化。
 * hash 与 evidence offset 必须只使用本函数的结果。
 */
export function normalizeChapterText(content: string): string {
  return decodeEntities(
    content
      .replace(/\r\n?/g, '\n')
      .replace(SCRIPT_OR_STYLE, '')
      .replace(BREAK_TAG, '\n')
      .replace(BLOCK_END_TAG, '\n')
      .replace(ANY_TAG, ''),
  )
    .normalize('NFC')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function sha256Text(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function hashChapterText(content: string): Promise<string> {
  return sha256Text(normalizeChapterText(content))
}

export type DerivedMemoryStatus = 'missing' | 'unverified' | 'verified' | 'stale'

export async function getChapterDerivedMemoryStatus(chapter: Chapter): Promise<{
  summary: DerivedMemoryStatus
  handoff: DerivedMemoryStatus
  currentSourceTextHash: string
}> {
  const currentSourceTextHash = await hashChapterText(chapter.content)
  const summary = !chapter.summary
    ? 'missing'
    : !chapter.summarySourceTextHash
      ? 'unverified'
      : chapter.summaryTextNormalizationVersion !== CHAPTER_TEXT_NORMALIZATION_VERSION
        ? 'stale'
        : chapter.summarySourceTextHash === currentSourceTextHash ? 'verified' : 'stale'
  const handoff = !chapter.continuityHandoff
    ? 'missing'
    : chapter.continuityHandoff.textNormalizationVersion !== CHAPTER_TEXT_NORMALIZATION_VERSION
      ? 'stale'
      : chapter.continuityHandoff.sourceTextHash === currentSourceTextHash ? 'verified' : 'stale'

  return { summary, handoff, currentSourceTextHash }
}
