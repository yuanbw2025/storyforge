import { getHTMLFromFragment } from '@tiptap/core'
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { AddMarkStep, RemoveMarkStep, AttrStep, DocAttrStep } from '@tiptap/pm/transform'
import { authoringSchemaV1, parseAuthoringPmProofV1, splitAuthoringHtmlV1 } from './authoring-html-blocks'
import { htmlToPlainText } from '../utils/html'

interface RichBlockBindingV1 { from: number; to: number; html: string; content: Fragment }

/** A frontend edit boundary over the existing HTML, with no persistence or AI
 * authority. Native PM transactions identify changed blocks. Unchanged blocks
 * and gaps retain their original bytes, including noncanonical safe styles. */
export class AuthoringRichTextSessionV1 {
  private document: ProseMirrorNode
  private bindings: RichBlockBindingV1[]
  private gaps: { pos: number; html: string }[]
  private html: string

  constructor(html: string, input?: { document: ProseMirrorNode }) {
    const framing = splitAuthoringHtmlV1(html)
    if (!framing.framed) throw new Error('旧 HTML 无法建立可靠的富文本块边界，原稿已保留。')
    let pos = 0
    const schema = input?.document.type.schema ?? authoringSchemaV1()
    this.gaps = []
    this.bindings = framing.slices.map(slice => {
      // Parse each framed root with full text whitespace. Raw inter-root
      // formatting gaps stay outside the document, so they cannot invent
      // paragraphs. This is only this frontend's view, not the formal AI parser.
      const content = parseAuthoringPmProofV1(slice.html, schema, { preserveWhitespace: 'full' }).content
      if (slice.leading) this.gaps.push({ pos, html: slice.leading })
      const row = { from: pos, to: pos + content.size, html: slice.html, content }; pos = row.to
      return row
    })
    if (framing.trailing) this.gaps.push({ pos: pos + 1, html: framing.trailing })
    this.document = this.bindings.length ? schema.nodes.doc.create(null, this.bindings.reduce((content, row) => content.append(row.content), Fragment.empty)) : schema.nodes.doc.createAndFill()!
    if (input && !input.document.eq(this.document)) throw new Error('富文本初始文档与原始 HTML 不符，未建立编辑会话。')
    this.html = html
  }

  getDocument(): ProseMirrorNode { return this.document }
  getHtml(): string { return this.html }
  /** The existing durable selection contract uses the default PM parser. A
   * full-whitespace view may not reuse its coordinates unless docs are equal. */
  canUseFormalPositions(): boolean {
    return parseAuthoringPmProofV1(this.html, this.document.type.schema).eq(this.document)
  }

  /** Tiptap reports the root and appended transactions together. Validate the
   * complete batch before a single caller save callback; never save a prefix. */
  applyTransactions(transactions: readonly Transaction[]): { html: string; plainText: string } | null {
    const before = { document: this.document, bindings: this.bindings, gaps: this.gaps, html: this.html }
    try {
      for (const transaction of transactions) this.applyTransaction(transaction)
      return before.html === this.html ? null : { html: this.html, plainText: htmlToPlainText(this.html) }
    } catch (error) {
      this.document = before.document; this.bindings = before.bindings; this.gaps = before.gaps; this.html = before.html
      throw error
    }
  }

  applyTransaction(transaction: Transaction): { html: string; plainText: string } | null {
    if (!transaction.before.eq(this.document)) throw new Error('富文本交易来自旧正文会话，原稿未覆盖。')
    if (!transaction.docChanged) return null
    const bindings = this.bindings.map(row => ({ ...row, touched: false }))
    let gaps = this.gaps.map(gap => ({ ...gap }))
    for (const step of transaction.steps) {
      const map = step.getMap()
      const touch = (from: number, to: number) => {
        for (const row of bindings) if (from === to ? from > row.from && from < row.to : from < row.to && to > row.from) row.touched = true
      }
      map.forEach((from, to) => touch(from, to))
      // Mark and attribute changes have an empty StepMap; their explicit PM
      // positions still determine exactly which raw envelopes are invalidated.
      if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) touch(step.from, step.to)
      if (step instanceof AttrStep) touch(step.pos, step.pos + 1)
      if (step instanceof DocAttrStep) for (const row of bindings) row.touched = true
      for (const row of bindings) { row.from = map.map(row.from, 1); row.to = map.map(row.to, -1) }
      gaps = gaps.map(gap => ({ ...gap, pos: map.map(gap.pos, 1) }))
    }
    const boundaries = new Set([0])
    transaction.doc.forEach((node, offset) => { boundaries.add(offset); boundaries.add(offset + node.nodeSize) })
    const unchanged = new Map<number, RichBlockBindingV1>()
    for (const row of bindings) if (!row.touched && row.to > row.from && boundaries.has(row.from) && boundaries.has(row.to)
      && transaction.doc.content.cut(row.from, row.to).eq(row.content)) unchanged.set(row.from, row)
    let html = '', gapIndex = 0, skippedTo = -1
    const next: RichBlockBindingV1[] = []
    transaction.doc.forEach((node, from) => {
      if (from < skippedTo) return
      while (gapIndex < gaps.length && gaps[gapIndex].pos <= from) html += gaps[gapIndex++].html
      const raw = unchanged.get(from)
      const to = raw?.to ?? from + node.nodeSize
      const blockHtml = raw?.html ?? getHTMLFromFragment(Fragment.from(node), transaction.doc.type.schema)
      if (!raw && !parseAuthoringPmProofV1(blockHtml, transaction.doc.type.schema, { preserveWhitespace: 'full' }).content.eq(Fragment.from(node))) throw new Error('变更块不能逐字恢复，当前草稿未保存。')
      html += blockHtml; skippedTo = to
      next.push({ from, to, html: blockHtml, content: transaction.doc.content.cut(from, to) })
    })
    while (gapIndex < gaps.length) html += gaps[gapIndex++].html
    this.document = transaction.doc; this.bindings = next; this.gaps = gaps
    const changed = html !== this.html
    this.html = html
    return changed ? { html, plainText: htmlToPlainText(html) } : null
  }
}
