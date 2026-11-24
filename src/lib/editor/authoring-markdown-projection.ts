import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { safeAuthoringLinkV1 } from './authoring-html-blocks'

export interface MarkdownBlockProjectionV1 {
  source: string
  kind: string
  lossless: boolean
}

function escapeText(text: string): string {
  return text.replace(/&(?=(?:#\d+|#x[\da-f]+|[a-z][a-z\d]+);)/gi, '&amp;')
    .replace(/<(?=[a-z!/?])/gi, '&lt;')
    .replace(/([\\`*_[\]~|])/g, '\\$1')
    .replace(/(^|\n)([ \t]*)(>+|#{1,6}(?=\s|$)|[+-](?=\s|$)|=+|-+)/g, '$1$2\\$3')
    .replace(/(^|\n)([ \t]*\d{1,9})([.)])(?=[ \t])/g, '$1$2\\$3')
    .replace(/^ {4,}/gm, spaces => '&#32;' + spaces.slice(1))
}
export { escapeText as escapeAuthoringMarkdownTextV1 }

function delimiter(text: string, minimum: number): string {
  let longest = 0
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length)
  return '`'.repeat(Math.max(minimum, longest + 1))
}

/** Separators terminate containers; additional blank lines represent real
 * empty paragraphs. Empty paragraphs carry no opaque placeholder or block id. */
export function joinMarkdownBlockProjectionsV1<T extends MarkdownBlockProjectionV1>(rows: readonly T[]): { source: string; ranges: { from: number; to: number }[] } {
  let source = ''
  const ranges: { from: number; to: number }[] = []
  let previous: T | null = null, emptyCount = 0
  for (const row of rows) {
    if (row.kind === 'paragraph' && !row.source) { emptyCount++; continue }
    const separator = previous ? (previous.kind === 'paragraph' && row.kind === 'paragraph' ? 1 : 2) : 0
    const start = source.length
    source += '\n'.repeat(separator + emptyCount)
    for (let i = 0; i < emptyCount; i++) {
      const pos = start + (previous ? separator : 0) + i
      ranges.push({ from: pos, to: pos })
    }
    ranges.push({ from: source.length, to: source.length + row.source.length })
    source += row.source; previous = row; emptyCount = 0
  }
  if (emptyCount) {
    const start = source.length
    source += '\n'.repeat(previous ? emptyCount : Math.max(0, emptyCount - 1))
    for (let i = 0; i < emptyCount; i++) {
      const pos = start + (previous ? i + 1 : i)
      ranges.push({ from: pos, to: pos })
    }
  }
  return { source, ranges }
}

/** Pure serialization of the existing schema; it never normalizes the stored
 * HTML or claims to encode attributes Markdown cannot represent. */
export function projectAuthoringPmV1(node: ProseMirrorNode): MarkdownBlockProjectionV1 {
  let lossless = true
  const inline = (parent: ProseMirrorNode): string => {
    let source = ''
    parent.forEach(child => {
      if (child.type.name === 'hardBreak') { source += '\\\n'; return }
      if (!child.isText) { lossless = false; source += escapeText(child.textContent); return }
      const text = child.text ?? ''
      let value = escapeText(text)
      for (const mark of [...child.marks].reverse()) {
        if (mark.type.name === 'bold') value = `**${value}**`
        else if (mark.type.name === 'italic') value = `*${value}*`
        else if (mark.type.name === 'strike') value = `~~${value}~~`
        else if (mark.type.name === 'code') {
          if (text.includes('\n')) lossless = false
          const fence = delimiter(text, 1)
          const padding = /^[` ]|[` ]$/.test(text) && /[^ ]/.test(text) ? ' ' : ''
          value = `${fence}${padding}${text}${padding}${fence}`
        } else if (mark.type.name === 'link') {
          const href = String(mark.attrs.href ?? '')
          if (!safeAuthoringLinkV1(href)) { lossless = false; continue }
          const title = mark.attrs.title ? ` "${String(mark.attrs.title).replace(/[\\"]/g, '\\$&')}"` : ''
          value = `[${value}](<${href.replace(/>/g, '%3E')}>${title})`
        } else lossless = false
      }
      source += value
    })
    return source
  }
  const block = (current: ProseMirrorNode): MarkdownBlockProjectionV1 => {
    const kind = current.type.name
    if (kind === 'paragraph' || kind === 'heading') {
      if (current.attrs.lineHeight || current.attrs.paragraphSpacing) lossless = false
      return { source: (kind === 'heading' ? `${'#'.repeat(current.attrs.level)} ` : '') + inline(current), kind, lossless }
    }
    if (kind === 'horizontalRule') return { source: '---', kind, lossless }
    if (kind === 'codeBlock') {
      const text = current.textContent, fence = delimiter(text, 3)
      const language = current.attrs.language ?? ''
      if (language && !/^[\w+.#-]+$/.test(language)) lossless = false
      return { source: `${fence}${language}\n${text}\n${fence}`, kind, lossless }
    }
    const parts: MarkdownBlockProjectionV1[] = []
    current.forEach(child => parts.push(block(child)))
    if (kind === 'doc') return { source: joinMarkdownBlockProjectionsV1(parts).source, kind, lossless }
    if (kind === 'blockquote') {
      return { source: parts.map(row => row.source).join('\n\n').split('\n').map(line => `> ${line}`).join('\n'), kind, lossless }
    }
    if (kind === 'listItem') {
      return { source: parts.map(row => row.source).join('\n\n'), kind, lossless }
    }
    if (kind === 'bulletList' || kind === 'orderedList') {
      return { source: parts.map((part, index) => {
        const prefix = kind === 'bulletList' ? '- ' : `${Number(current.attrs.start ?? 1) + index}. `
        return part.source.split('\n').map((line, lineIndex) => lineIndex ? ' '.repeat(prefix.length) + line : prefix + line).join('\n')
      }).join('\n'), kind, lossless }
    }
    lossless = false
    return { source: escapeText(current.textContent), kind, lossless }
  }
  const result = block(node)
  return { ...result, lossless }
}

export function projectProtectedTextV1(doc: ProseMirrorNode): MarkdownBlockProjectionV1 {
  return { source: doc.textBetween(0, doc.content.size, '\n', '\n').split('\n').map(escapeText).join('\n'), kind: 'paragraph', lossless: false }
}
