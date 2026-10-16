import { htmlToPlainText, plainTextToHtml } from '../utils/html'
import { applyQualityRevisionPatchesV1, type QualityRevisionPlanV1 } from './quality-revision'

interface Point { node: Node; offset: number }
interface Unit { char: string; start: Point; end: Point }
const BLOCKS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE'])

/** Map the same canonical text used by review to detached DOM positions. Only
 * authorized text ranges are replaced; model HTML is always literal text. */
export async function previewQualityRevisionHTMLV1(input: {
  sourceHtml: string
  plan: QualityRevisionPlanV1
  raw: string
  normalize?: (html: string) => string
}): Promise<{ contentHtml: string; outputText: string; changedSpanIds: string[] }> {
  if (typeof document === 'undefined') throw new Error('富文本修订需要可用的文档解析环境。')
  const originalText = htmlToPlainText(input.sourceHtml)
  if (input.normalize && input.normalize(input.sourceHtml) !== input.sourceHtml) throw new Error('原稿格式尚未与编辑器同步，请先保存当前正文。')
  const result = await applyQualityRevisionPatchesV1({ plan: input.plan, originalText, raw: input.raw })
  const root = document.createElement('div')
  root.innerHTML = input.sourceHtml
  const units: Unit[] = []
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? ''
      for (let i = 0; i < value.length; i++) units.push({ char: value[i], start: { node, offset: i }, end: { node, offset: i + 1 } })
      return
    }
    const element = node as Element
    if (element.tagName === 'BR') {
      units.push({ char: '\n', start: { node, offset: 0 }, end: { node, offset: 0 } })
      return
    }
    for (const child of [...node.childNodes]) walk(child)
    if (BLOCKS.has(element.tagName)) units.push({ char: '\n', start: { node, offset: node.childNodes.length }, end: { node, offset: node.childNodes.length } })
  }
  for (const child of [...root.childNodes]) walk(child)
  const collapsed: Unit[] = []
  let newlines = 0
  for (const unit of units) {
    newlines = unit.char === '\n' ? newlines + 1 : 0
    if (newlines <= 2) collapsed.push(unit)
  }
  while (collapsed.length && !collapsed[0].char.trim()) collapsed.shift()
  while (collapsed.length && !collapsed[collapsed.length - 1].char.trim()) collapsed.pop()
  if (collapsed.map(unit => unit.char).join('') !== originalText) throw new Error('原稿富文本与评审文字映射不一致，未修改手稿。')
  const received = input.raw.trim()
  const fence = /^```(?:json)?[\t ]*\r?\n([\s\S]*)\r?\n```$/.exec(received)
  const edits = JSON.parse(fence ? fence[1] : received).edits as { spanId: string; replacement: string }[]
  const ordered = edits.map(edit => ({ ...input.plan.allowedSpans.find(span => span.id === edit.spanId)!, replacement: edit.replacement })).sort((a, b) => b.start - a.start)
  for (const edit of ordered) {
    const start = collapsed[edit.start]?.start
    const end = collapsed[edit.end - 1]?.end
    if (!start || !end || !root.contains(start.node) || !root.contains(end.node)) throw new Error('修订文字范围已失效。')
    const range = document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    range.deleteContents()
    const fragment = document.createDocumentFragment()
    edit.replacement.replace(/\r\n?/g, '\n').split('\n').forEach((line, index) => {
      if (index) fragment.append(document.createElement('br'))
      fragment.append(document.createTextNode(line))
    })
    range.insertNode(fragment)
  }
  const contentHtml = input.normalize ? input.normalize(root.innerHTML) : root.innerHTML
  const outputText = htmlToPlainText(contentHtml)
  // Removing an entire paragraph can leave leading/trailing or adjacent blank
  // blocks. Compare with the same text projection used for the source, without
  // relaxing the patch scope or changing any unselected visible text.
  const expectedText = htmlToPlainText(plainTextToHtml(result.outputText))
  if (outputText !== expectedText) throw new Error('富文本预演超出了授权文字范围。')
  return { ...result, contentHtml, outputText }
}
