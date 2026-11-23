import { getSchema } from '@tiptap/core'
import { DOMParser as ProseMirrorDOMParser, type Node as ProseMirrorNode, type ParseOptions } from '@tiptap/pm/model'
import { richEditorExtensionsV1 } from './rich-editor-schema'

const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const supportedTags = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 's', 'strike', 'del', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'br', 'hr', 'a'])
const inertTags = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template'])
let cachedSchema: ReturnType<typeof getSchema> | undefined

interface HtmlToken {
  from: number
  to: number
  kind: 'text' | 'comment' | 'open' | 'close'
  tag?: string
  attrs?: [string, string][]
  selfClosing?: boolean
}

export interface AuthoringHtmlSliceV1 {
  /** Source offsets, never recovered by matching paragraph text. */
  from: number
  to: number
  leading: string
  html: string
}

export function authoringSchemaV1() {
  return cachedSchema ??= getSchema(richEditorExtensionsV1())
}

export function decodeAuthoringEntityV1(text: string): string {
  // RCDATA decodes entities only. '<' is escaped before it enters this decoder;
  // neither an original block nor Markdown HTML is inserted into preview DOM.
  const decoder = document.createElement('textarea')
  decoder.innerHTML = text.replace(/</g, '&lt;')
  return decoder.value
}

export function safeAuthoringLinkV1(value: string): boolean {
  if (!/^(https?:\/\/|mailto:)/i.test(value) || /[\u0000-\u0020\u007f]/.test(value)) return false
  try {
    const url = new URL(value)
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) && !url.username && !url.password
  } catch { return false }
}

function tokenize(html: string): HtmlToken[] | null {
  const result: HtmlToken[] = []
  let pos = 0
  while (pos < html.length) {
    if (html.startsWith('<!--', pos)) {
      const end = html.indexOf('-->', pos + 4)
      if (end < 0) return null
      // Only unambiguous HTML comments may be preserved as raw fallback.
      // Browsers also close malformed comments at <!-->, <!---> or --!>;
      // treating that remainder as comment text could conceal executable tags.
      const body = html.slice(pos + 4, end)
      if (body.startsWith('>') || body.startsWith('->') || body.includes('--')) return null
      result.push({ from: pos, to: end + 3, kind: 'comment' }); pos = end + 3
      continue
    }
    if (html[pos] !== '<' || !/^<\/?[A-Za-z]/.test(html.slice(pos, pos + 3))) {
      let end = html.indexOf('<', pos + 1)
      if (end < 0) end = html.length
      result.push({ from: pos, to: end, kind: 'text' }); pos = end
      continue
    }
    const start = pos
    let quote = ''
    for (pos += 1; pos < html.length; pos++) {
      const char = html[pos]
      if (quote) { if (char === quote) quote = '' }
      else if (char === '"' || char === "'") quote = char
      else if (char === '>') break
    }
    if (pos === html.length || quote) return null
    const raw = html.slice(start, ++pos)
    const match = /^<(\/?)([A-Za-z][\w:-]*)([\s\S]*?)>$/.exec(raw)
    if (!match) return null
    const tag = match[2].toLowerCase()
    if (match[1]) {
      if (match[3].trim()) return null
      result.push({ from: start, to: pos, kind: 'close', tag })
      continue
    }
    const tail = match[3].replace(/\/\s*$/, '')
    const attrs: [string, string][] = []
    const attribute = /\s+([^\s=<>"'`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s<>"'`=]+)))?/gy
    let consumed = 0
    while (consumed < tail.length) {
      if (!tail.slice(consumed).trim()) break
      attribute.lastIndex = consumed
      const attr = attribute.exec(tail)
      if (!attr) return null
      attrs.push([attr[1].toLowerCase(), decodeAuthoringEntityV1(attr[2] ?? attr[3] ?? attr[4] ?? '')])
      consumed = attribute.lastIndex
    }
    const selfClosing = voidTags.has(tag) || /\/\s*>$/.test(raw)
    result.push({ from: start, to: pos, kind: 'open', tag, attrs, selfClosing })
    if (!selfClosing && ['script', 'style', 'textarea'].includes(tag)) {
      const lower = html.toLowerCase()
      const end = lower.indexOf(`</${tag}`, pos)
      if (end < 0) return null
      if (end > pos) result.push({ from: pos, to: end, kind: 'text' })
      pos = end
    }
  }
  return result
}

/** Strict framing preserves every byte. Ambiguous/legacy HTML becomes one
 * protected slice rather than being repaired or silently normalized on load. */
export function splitAuthoringHtmlV1(html: string): { slices: AuthoringHtmlSliceV1[]; trailing: string; framed: boolean } {
  if (!html) return { slices: [], trailing: '', framed: true }
  const tokens = tokenize(html)
  const fallback = () => ({ slices: [{ from: 0, to: html.length, leading: '', html }], trailing: '', framed: false })
  if (!tokens) return fallback()
  const slices: AuthoringHtmlSliceV1[] = []
  const stack: string[] = []
  let rootStart = -1, consumed = 0
  for (const token of tokens) {
    if (token.kind === 'text' && !stack.length && html.slice(token.from, token.to).trim()) return fallback()
    if (token.kind === 'open') {
      if (!stack.length) rootStart = token.from
      if (!token.selfClosing) stack.push(token.tag!)
      else if (!stack.length) {
        slices.push({ from: rootStart, to: token.to, leading: html.slice(consumed, rootStart), html: html.slice(rootStart, token.to) }); consumed = token.to
      }
    } else if (token.kind === 'close') {
      if (stack.pop() !== token.tag) return fallback()
      if (!stack.length) {
        slices.push({ from: rootStart, to: token.to, leading: html.slice(consumed, rootStart), html: html.slice(rootStart, token.to) }); consumed = token.to
      }
    }
  }
  if (stack.length || (!slices.length && html.trim())) return fallback()
  return { slices, trailing: html.slice(consumed), framed: true }
}

export interface ParsedAuthoringHtmlV1 {
  dom: HTMLElement
  pmDoc: ProseMirrorNode
  protected: boolean
}

/** Read-only position proof with the real rich-editor parser. This separate
 * document has no browsing context; its raw DOM is never returned or mounted
 * as a preview. The controlled preview DOM below is a different object. */
export function parseAuthoringPmProofV1(html: string, schema = authoringSchemaV1(), options?: ParseOptions): ProseMirrorNode {
  const root = document.implementation.createHTMLDocument('').createElement('div')
  root.innerHTML = html
  return ProseMirrorDOMParser.fromSchema(schema).parse(root, options)
}

/** Resource-bearing attributes and executable nodes never enter this inert
 * parse tree. It is owned by the adapter, never attached to a browser view. */
export function parseAuthoringHtmlV1(html: string, framed = true): ParsedAuthoringHtmlV1 {
  const schema = authoringSchemaV1()
  const dom = document.createElement('div')
  const tokens = tokenize(html)
  let protect = !framed || !tokens
  if (!tokens) {
    const p = document.createElement('p'); p.textContent = html; dom.append(p)
    return { dom, pmDoc: ProseMirrorDOMParser.fromSchema(schema).parse(dom), protected: true }
  }
  const stack: { tag: string; dom: HTMLElement | null }[] = [{ tag: '', dom }]
  for (const token of tokens) {
    const parent = stack[stack.length - 1]
    if (token.kind === 'comment') { protect = true; continue }
    if (token.kind === 'text') {
      if (parent.dom) parent.dom.append(document.createTextNode(decodeAuthoringEntityV1(html.slice(token.from, token.to))))
    } else if (token.kind === 'open') {
      const tag = token.tag!
      if (!supportedTags.has(tag)) protect = true
      const element = inertTags.has(tag) || !parent.dom ? null : document.createElement(supportedTags.has(tag) || ['div', 'span'].includes(tag) ? tag : 'span')
      for (const [name, value] of token.attrs ?? []) {
        if (name === 'style') {
          protect = true
          for (const declaration of value.split(';')) {
            const split = declaration.indexOf(':')
            if (split < 0) continue
            const property = declaration.slice(0, split).trim().toLowerCase()
            const cssValue = declaration.slice(split + 1).trim()
            if (['color', 'background-color', 'font-family', 'font-size', 'line-height', 'margin-bottom'].includes(property)
              && !/url\s*\(|expression|@|[\u0000-\u001f]/i.test(cssValue)) element?.style.setProperty(property, cssValue)
          }
        } else if (tag === 'a' && name === 'href' && safeAuthoringLinkV1(value)) element?.setAttribute(name, value)
        else if (tag === 'a' && name === 'title') element?.setAttribute(name, value)
        else if (tag === 'a' && name === 'target' && value === schema.marks.link?.spec.attrs?.target?.default) continue
        else if (tag === 'a' && name === 'rel' && value === schema.marks.link?.spec.attrs?.rel?.default) continue
        else if (tag === 'ol' && name === 'start' && /^-?\d{1,9}$/.test(value)) element?.setAttribute(name, value)
        else if (tag === 'code' && name === 'class' && /^language-[\w+.#-]+$/.test(value)) element?.setAttribute(name, value)
        else protect = true
      }
      if (element && parent.dom) parent.dom.append(element)
      if (!token.selfClosing) stack.push({ tag, dom: element })
    } else if (token.kind === 'close') {
      if (stack.length < 2 || stack[stack.length - 1].tag !== token.tag) { protect = true; continue }
      stack.pop()
    }
  }
  if (stack.length !== 1) protect = true
  const pmDoc = parseAuthoringPmProofV1(html)
  if (dom.textContent !== pmDoc.textContent) protect = true
  return { dom, pmDoc, protected: protect }
}

/** Safe Markdown HTML fallback is a file-format boundary, not permission to
 * render original bytes in the editor or a promise of full backup fidelity. */
export function canExportAuthoringHtmlV1(html: string): boolean {
  const tokens = tokenize(html)
  if (!tokens) return false
  for (const token of tokens) {
    if (token.kind !== 'open') continue
    const tag = token.tag!
    if (!supportedTags.has(tag) && !['div', 'span', 'u'].includes(tag)) return false
    for (const [name, value] of token.attrs ?? []) {
      if (name === 'style') {
        for (const declaration of value.split(';')) {
          if (!declaration.trim()) continue
          const colon = declaration.indexOf(':')
          if (colon < 0) return false
          const property = declaration.slice(0, colon).trim().toLowerCase(), css = declaration.slice(colon + 1).trim()
          if (!['color', 'background-color', 'font-family', 'font-size', 'line-height', 'margin-bottom'].includes(property)
            || /url\s*\(|expression|@|[\u0000-\u001f]/i.test(css)) return false
        }
      } else if (tag === 'a' && name === 'href' && safeAuthoringLinkV1(value)) continue
      else if (tag === 'a' && name === 'title') continue
      else if (tag === 'a' && name === 'target' && ['_blank', '_self'].includes(value)) continue
      else if (tag === 'a' && name === 'rel' && value.split(/\s+/).every(part => ['noopener', 'noreferrer', 'nofollow'].includes(part))) continue
      else if (tag === 'ol' && name === 'start' && /^-?\d{1,9}$/.test(value)) continue
      else if (tag === 'code' && name === 'class' && /^language-[\w+.#-]+$/.test(value)) continue
      else return false
    }
  }
  return true
}
