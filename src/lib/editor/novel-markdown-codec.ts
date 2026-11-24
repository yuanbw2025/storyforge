import { EditorState, type Extension } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { commonmarkLanguage, markdown } from '@codemirror/lang-markdown'
import { Strikethrough, type MarkdownConfig } from '@lezer/markdown'
import { DOMParser as ProseMirrorDOMParser, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { getHTMLFromFragment } from '@tiptap/core'
import { authoringSchemaV1, decodeAuthoringEntityV1, safeAuthoringLinkV1 } from './authoring-html-blocks'

type SyntaxNode = NonNullable<ReturnType<typeof ensureSyntaxTree>>['topNode']
export const NOVEL_MARKDOWN_DIALECT_V1 = 'storyforge.novel-markdown@1' as const

export interface SourceTextPieceV1 {
  node: Text
  text: string
  /** One original UTF-16 boundary per emitted UTF-16 boundary. -1 forbids
   * selecting half a surrogate or the interior of an encoded entity. */
  boundaries: readonly number[]
}
export interface SourceTextLeafV1 {
  from: number
  to: number
  dom: HTMLElement
  pieces: SourceTextPieceV1[]
}
export interface CompiledNovelBlockV1 {
  from: number
  to: number
  kind: string
  dom: HTMLElement
  pmDoc: ProseMirrorNode
  html: string
  leaves: SourceTextLeafV1[]
  pendingSyntax: boolean
  /** Cached leaf pointers remain relative to the source revision that created
   * them; unchanged blocks need only this constant positional translation. */
  sourceShift?: number
  syntaxSignature?: string
}

const novelPhysicalParagraphs: MarkdownConfig = { parseBlock: [{
  name: 'NovelPhysicalParagraph', after: 'SetextHeading',
  leaf(context) {
    if (context.depth !== 1) return null
    return {
      // Let the original block parser consume all continuations and Setext
      // underlines first. Splitting while reading lines changes indentation,
      // reference definitions and multiline Setext semantics.
      nextLine() { return false },
      finish(cx, leaf) {
        const lines = leaf.content.split('\n')
        let offset = leaf.start, text = ''
        for (let index = 0; index < lines.length; index++) {
          text += (text ? '\n' : '') + lines[index]
          const last = index === lines.length - 1
          if (!last && / {2,}$|\\$/.test(text)) continue
          const elements = cx.parser.parseInline(text, offset)
          const complete = elements.filter(element => ['StrongEmphasis', 'Emphasis', 'Strikethrough', 'InlineCode', 'Escape', 'Entity', 'Link', 'Image', 'HTMLTag'].includes(cx.parser.nodeSet.types[element.type].name))
          let elementIndex = 0, balanced = true
          for (const match of text.matchAll(/[`*_[\]~\\<]/g)) {
            const pos = offset + match.index!
            while (elementIndex < complete.length && complete[elementIndex].to <= pos) elementIndex++
            if (!complete[elementIndex] || complete[elementIndex].from > pos) { balanced = false; break }
          }
          // Unmatched delimiters stay in the same container, where a later
          // close can still change every affected physical paragraph.
          if (!balanced && !last) continue
          cx.addLeafElement(leaf, cx.elt('Paragraph', offset, offset + text.length, elements))
          offset += text.length + 1; text = ''
        }
        return true
      },
    }
  },
}] }

export function createNovelMarkdownStateV1(source: string, extensions: readonly Extension[] = [], options: { rootParagraphs?: 'physical-lines' | 'commonmark' } = {}): EditorState {
  return EditorState.create({ doc: source, extensions: [markdown({
    base: commonmarkLanguage, extensions: options.rootParagraphs === 'commonmark' ? [Strikethrough] : [Strikethrough, novelPhysicalParagraphs], addKeymap: false,
    completeHTMLTags: false, pasteURLAsLink: false,
  }), ...extensions] })
}

function children(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child)
  return result
}
function codePointBoundaries(text: string, from: number): number[] {
  const result = Array.from({ length: text.length + 1 }, (_, offset) => from + offset)
  for (let i = 1; i < text.length; i++) {
    const left = text.charCodeAt(i - 1), right = text.charCodeAt(i)
    if (left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff) result[i] = -1
  }
  return result
}

/** A bounded parse produces controlled DOM and source pointers. No Markdown
 * HTML, image URL, raw protected block or arbitrary style is rendered as DOM. */
export function compileNovelMarkdownV1(state: EditorState, reuse?: (from: number, to: number, kind: string, syntaxSignature: string) => CompiledNovelBlockV1 | undefined, options: { rootParagraphs?: 'physical-lines' | 'commonmark' } = {}): CompiledNovelBlockV1[] {
  const source = state.doc.toString()
  const tree = ensureSyntaxTree(state, state.doc.length, 2000)
  if (!tree || tree.length !== state.doc.length) throw new Error('正文解析尚未完成，源草稿已保留。')
  const schema = authoringSchemaV1()
  const blocks: CompiledNovelBlockV1[] = []
  let activeLeaves: SourceTextLeafV1[] = []
  let pending = false
  // Lezer childAfter starts at the first sibling. A novel root paragraph can
  // contain thousands of physical lines, so using it once per line made dense
  // inline documents quadratic. Index each container once for this parse.
  const indexedChildren = new Map<string, SyntaxNode[]>()
  const childrenInRange = (node: SyntaxNode, from: number, to: number): SyntaxNode[] => {
    const key = `${node.from}:${node.to}:${node.name}`
    let rows = indexedChildren.get(key)
    if (!rows) { rows = children(node); indexedChildren.set(key, rows) }
    let low = 0, high = rows.length
    while (low < high) { const middle = (low + high) >>> 1; if (rows[middle].to <= from) low = middle + 1; else high = middle }
    const result: SyntaxNode[] = []
    for (let index = low; index < rows.length && rows[index].from < to; index++) result.push(rows[index])
    return result
  }
  const syntaxSignature = (node: SyntaxNode, from: number, to: number): string => {
    const visit = (parent: SyntaxNode): unknown[] => {
      const parts: unknown[] = []
      for (const child of childrenInRange(parent, from, to)) {
        if (child.to <= from) continue
        const attributes = child.name === 'Link' ? children(child).filter(row => row.name === 'URL' || row.name === 'LinkTitle').map(row => source.slice(row.from, row.to)) : []
        parts.push([child.name, Math.max(0, child.from - from), Math.min(to - from, child.to - from), attributes, visit(child)])
      }
      return parts
    }
    return JSON.stringify(visit(node))
  }

  const emit = (parent: HTMLElement, leaf: SourceTextLeafV1, text: string, boundaries: number[]) => {
    if (!text) return
    const node = document.createTextNode(text)
    parent.append(node); leaf.pieces.push({ node, text, boundaries })
  }
  const rawText = (parent: HTMLElement, leaf: SourceTextLeafV1, from: number, to: number) => {
    const text = source.slice(from, to)
    emit(parent, leaf, text, codePointBoundaries(text, from))
  }
  const leafFor = (dom: HTMLElement, from: number, to: number): SourceTextLeafV1 => {
    const leaf = { dom, from, to, pieces: [] as SourceTextPieceV1[] }
    activeLeaves.push(leaf)
    return leaf
  }
  const hardBreak = (parent: HTMLElement, leaf: SourceTextLeafV1) => {
    parent.append(document.createElement('br'))
    // A virtual visible newline participates in proof, but offers no invented
    // selectable DOM position. PM textBetween may reject this range honestly.
    leaf.pieces.push({ node: document.createTextNode('\n'), text: '\n', boundaries: [-1, -1] })
  }
  const gap = (parent: HTMLElement, leaf: SourceTextLeafV1, from: number, to: number, indent: number) => {
    let pos = from
    while (pos < to) {
      const newline = source.indexOf('\n', pos)
      const end = newline < 0 || newline >= to ? to : newline
      rawText(parent, leaf, pos, end)
      if (end === to) break
      hardBreak(parent, leaf)
      pos = end + 1
      // List continuations carry container indentation in source, not prose.
      let removed = 0
      while (pos < to && source[pos] === ' ' && removed < indent) { pos++; removed++ }
    }
  }

  const inline = (node: SyntaxNode, parent: HTMLElement, leaf: SourceTextLeafV1, from: number, to: number, indent: number) => {
    let pos = from
    for (const child of childrenInRange(node, from, to)) {
      if (child.to <= from || child.from >= to) continue
      if (child.from > pos) gap(parent, leaf, pos, Math.min(to, child.from), indent)
      const start = Math.max(from, child.from), end = Math.min(to, child.to)
      if (['EmphasisMark', 'StrikethroughMark', 'CodeMark', 'HeaderMark', 'LinkMark'].includes(child.name)) {
        // Delimiters are intentionally absent from the visible text map.
      } else if (child.name === 'QuoteMark') {
        pos = Math.min(to, child.to + (source[child.to] === ' ' ? 1 : 0))
        continue
      } else if (['Emphasis', 'StrongEmphasis', 'Strikethrough'].includes(child.name)) {
        const tag = child.name === 'Emphasis' ? 'em' : child.name === 'StrongEmphasis' ? 'strong' : 's'
        const element = document.createElement(tag)
        inline(child, element, leaf, start, end, indent); parent.append(element)
      } else if (child.name === 'Escape') {
        if (start <= child.from + 1 && end === child.to) rawText(parent, leaf, child.from + 1, child.to)
        else rawText(parent, leaf, start, end)
      } else if (child.name === 'Entity') {
        const text = decodeAuthoringEntityV1(source.slice(start, end))
        const boundaries = Array(text.length + 1).fill(-1) as number[]
        boundaries[0] = start; boundaries[text.length] = end
        emit(parent, leaf, text, boundaries)
      } else if (child.name === 'HardBreak') {
        hardBreak(parent, leaf)
      } else if (child.name === 'InlineCode') {
        const marks = children(child).filter(row => row.name === 'CodeMark')
        if (marks.length !== 2) { rawText(parent, leaf, start, end); pos = end; continue }
        let contentFrom = marks[0].to, contentTo = marks[1].from
        let text = source.slice(contentFrom, contentTo).replace(/\n/g, ' ')
        if (text.startsWith(' ') && text.endsWith(' ') && /[^ ]/.test(text)) {
          contentFrom++; contentTo--; text = text.slice(1, -1)
        }
        const code = document.createElement('code')
        const clippedFrom = Math.max(contentFrom, from), clippedTo = Math.min(contentTo, to)
        const clipped = source.slice(clippedFrom, clippedTo).replace(/\n/g, ' ')
        emit(code, leaf, clipped, codePointBoundaries(clipped, clippedFrom)); parent.append(code)
      } else if (child.name === 'Link' || child.name === 'Autolink') {
        const parts = children(child)
        const urlPart = parts.find(row => row.name === 'URL')
        let url = urlPart ? decodeAuthoringEntityV1(source.slice(urlPart.from, urlPart.to).replace(/^<|>$/g, '')) : ''
        url = url.replace(/\\([!-/:-@[-`{-~])/g, '$1')
        if (!safeAuthoringLinkV1(url)) { rawText(parent, leaf, start, end); pos = end; continue }
        const link = document.createElement('a'); link.setAttribute('href', url)
        if (child.name === 'Autolink' && urlPart) rawText(link, leaf, Math.max(start, urlPart.from), Math.min(end, urlPart.to))
        else {
          const marks = parts.filter(row => row.name === 'LinkMark')
          const labelTo = marks.find(row => source.slice(row.from, row.to) === ']')?.from
          if (labelTo === undefined) { rawText(parent, leaf, start, end); pos = end; continue }
          const title = parts.find(row => row.name === 'LinkTitle')
          if (title) link.setAttribute('title', decodeAuthoringEntityV1(source.slice(title.from + 1, title.to - 1)))
          inline(child, link, leaf, Math.max(start, child.from + 1), Math.min(end, labelTo), indent)
        }
        parent.append(link)
      } else {
        // Unsupported image/HTML/reference syntax remains visible literal text.
        rawText(parent, leaf, start, end)
      }
      pos = Math.max(pos, end)
    }
    if (pos < to) gap(parent, leaf, pos, to, indent)
  }

  const literalLines = (parent: HTMLElement, from: number, to: number) => {
    let pos = from
    while (pos <= to) {
      const newline = source.indexOf('\n', pos)
      const end = newline < 0 || newline > to ? to : newline
      const p = document.createElement('p'), leaf = leafFor(p, pos, end)
      rawText(p, leaf, pos, end); parent.append(p)
      if (end === to) break
      pos = end + 1
    }
  }
  const render = (node: SyntaxNode, parent: HTMLElement, rootParagraph: boolean) => {
    if (node.name === 'Paragraph') {
      const indent = node.from - state.doc.lineAt(node.from).from
      if (!rootParagraph) {
        const p = document.createElement('p'), leaf = leafFor(p, node.from, node.to)
        inline(node, p, leaf, node.from, node.to, indent); parent.append(p)
        return
      }
      const breaks: { from: number; to: number }[] = []
      const visit = (current: SyntaxNode) => { if (current.name === 'HardBreak') breaks.push(current); for (const child of children(current)) visit(child) }
      visit(node)
      let from = node.from
      for (let line = state.doc.lineAt(node.from).number; line <= state.doc.lineAt(node.to).number; line++) {
        const end = Math.min(node.to, state.doc.line(line).to)
        if (end < node.to && breaks.some(row => row.from <= end && row.to > end)) continue
        const p = document.createElement('p'), leaf = leafFor(p, from, end)
        inline(node, p, leaf, from, end, 0); parent.append(p)
        from = end + 1
      }
    } else if (/^(ATX|Setext)Heading[1-6]$/.test(node.name)) {
      const h = document.createElement(`h${node.name.slice(-1)}`)
      const marks = children(node).filter(row => row.name === 'HeaderMark')
      let from = node.from, to = node.to
      if (node.name.startsWith('ATX')) {
        from = marks[0]?.to ?? from
        while (from < to && /[ \t]/.test(source[from])) from++
        if (marks.length > 1) to = marks[marks.length - 1].from
        while (to > from && /[ \t]/.test(source[to - 1])) to--
      } else if (marks.length) to = state.doc.lineAt(marks[0].from).from - 1
      const leaf = leafFor(h, from, to)
      inline(node, h, leaf, from, to, 0); parent.append(h)
    } else if (node.name === 'BulletList' || node.name === 'OrderedList' || node.name === 'Blockquote' || node.name === 'ListItem') {
      const tag = { BulletList: 'ul', OrderedList: 'ol', Blockquote: 'blockquote', ListItem: 'li' }[node.name]!
      const element = document.createElement(tag)
      if (node.name === 'OrderedList') {
        const start = /^\d+/.exec(source.slice(node.from))?.[0]
        if (start && Number(start) !== 1) element.setAttribute('start', start)
      }
      for (const child of children(node)) if (!['QuoteMark', 'ListMark'].includes(child.name)) render(child, element, false)
      if (!element.childNodes.length) element.append(document.createElement('p'))
      parent.append(element)
    } else if (node.name === 'HorizontalRule') parent.append(document.createElement('hr'))
    else if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
      const parts = children(node), marks = parts.filter(row => row.name === 'CodeMark')
      if (node.name === 'FencedCode' && marks.length !== 2) {
        pending = true; literalLines(parent, node.from, node.to); return
      }
      const pre = document.createElement('pre'), code = document.createElement('code')
      const info = parts.find(row => row.name === 'CodeInfo')
      if (info) {
        const language = source.slice(info.from, info.to).split(/\s/)[0]
        if (/^[\w+.#-]+$/.test(language)) code.className = `language-${language}`
      }
      const codeParts = parts.filter(row => row.name === 'CodeText')
      const from = codeParts[0]?.from ?? (marks[0]?.to ?? node.from)
      const to = codeParts[codeParts.length - 1]?.to ?? from
      const leaf = leafFor(code, from, to)
      for (const part of codeParts) rawText(code, leaf, part.from, part.to)
      pre.append(code); parent.append(pre)
    } else literalLines(parent, node.from, node.to)
  }
  const finish = (from: number, to: number, kind: string, dom: HTMLElement) => {
    const pmDoc = ProseMirrorDOMParser.fromSchema(schema).parse(dom)
    // Canonicalize only a newly authored supported block, and only when PM has
    // retained every text code unit. Existing raw envelopes are never routed
    // through this serializer; whitespace that PM cannot represent stays raw.
    const html = dom.textContent === pmDoc.textContent ? getHTMLFromFragment(pmDoc.content, schema) : dom.innerHTML
    blocks.push({ from, to, kind, dom, pmDoc, html, leaves: activeLeaves, pendingSyntax: pending })
    activeLeaves = []; pending = false
  }
  const emptyLine = (lineNumber: number) => {
    const line = state.doc.line(lineNumber)
    const cached = reuse?.(line.from, line.to, 'paragraph', '[]')
    if (cached) { blocks.push(cached); return }
    const dom = document.createElement('div')
    const p = document.createElement('p'), leaf = leafFor(p, line.from, line.to)
    rawText(p, leaf, line.from, line.to); dom.append(p)
    finish(line.from, line.to, 'paragraph', dom)
  }
  let consumedLine = 0, previousStructural = false
  for (const node of children(tree.topNode)) {
    const firstLine = state.doc.lineAt(node.from).number
    const structural = node.name !== 'Paragraph'
    // One blank needed to terminate a structural container is syntax. Further
    // root blank lines are explicit empty paragraphs in the novel dialect.
    const separator = consumedLine && (previousStructural || structural) ? 1 : 0
    if (options.rootParagraphs !== 'commonmark') for (let line = consumedLine + 1 + separator; line < firstLine; line++) emptyLine(line)
    if (node.name === 'Paragraph' && options.rootParagraphs !== 'commonmark') {
      const breaks: SyntaxNode[] = []
      const visit = (current: SyntaxNode) => {
        if (current.name === 'HardBreak') breaks.push(current)
        for (const child of children(current)) visit(child)
      }
      visit(node)
      let from = node.from, breakIndex = 0
      for (let line = firstLine; line <= state.doc.lineAt(node.to).number; line++) {
        const to = Math.min(node.to, state.doc.line(line).to)
        while (breakIndex < breaks.length && breaks[breakIndex].to <= to) breakIndex++
        if (to < node.to && breaks[breakIndex]?.from <= to && breaks[breakIndex].to > to) continue
        const signature = syntaxSignature(node, from, to)
        const cached = reuse?.(from, to, 'paragraph', signature)
        if (cached) blocks.push(cached)
        else {
          const dom = document.createElement('div'), p = document.createElement('p')
          const leaf = leafFor(p, from, to)
          inline(node, p, leaf, from, to, 0); dom.append(p)
          finish(from, to, 'paragraph', dom)
          blocks[blocks.length - 1].syntaxSignature = signature
        }
        from = to + 1
      }
    } else {
      const cached = reuse?.(node.from, node.to, node.name, '')
      if (cached) blocks.push(cached)
      else {
        const dom = document.createElement('div'); render(node, dom, false)
        finish(node.from, node.to, node.name, dom)
      }
    }
    consumedLine = state.doc.lineAt(node.to).number
    previousStructural = structural
  }
  if (options.rootParagraphs !== 'commonmark') for (let line = consumedLine + 1; line <= state.doc.lines; line++) emptyLine(line)
  return blocks
}
