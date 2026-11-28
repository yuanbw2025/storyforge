/** Read-only conversion evidence. Never replaces the original DOCX text or
 * enters a model, candidate, database record, or adoption request. */
export type DocxBlockV1 =
  | { kind: 'paragraph' | 'heading'; index: number; text: string; level?: number }
  | { kind: 'table'; index: number; rows: Array<Array<{ text: string; colSpan: number; rowSpan: number }>> }
export interface DocxStructureV1 { blocks: DocxBlockV1[]; notices: string[] }
export const DOCX_STRUCTURE_NOTICE_V1 = 'Word 对照仅显示提取出的标题、段落与表格结构，不保证复杂排版还原；图片、页眉页脚、批注和修订请核对原件。AI 解析仍使用原来的完整纯文本。'

/** Parse in an inert document, then publish text/numbers only. In particular,
 * no generated HTML, URL, image, event handler, or style reaches the live DOM. */
export function projectDocxStructureV1(html: string, notices: string[] = []): DocxStructureV1 {
  const root = document.implementation.createHTMLDocument('').createElement('div')
  root.innerHTML = html
  root.querySelectorAll('script,style,iframe,object,embed,svg,math,template').forEach(node => node.remove())
  const blocks: DocxBlockV1[] = []
  const text = (node: Element) => {
    const copy = node.cloneNode(true) as Element
    copy.querySelectorAll('br').forEach(item => item.replaceWith('\n'))
    copy.querySelectorAll('p,li').forEach(item => item.append('\n'))
    return (copy.textContent ?? '').replace(/\n$/, '')
  }
  const span = (cell: Element, key: string) => {
    const value = cell.getAttribute(key)
    return value && /^[1-9]\d{0,2}$/.test(value) ? Number(value) : 1
  }
  const visit = (parent: Element) => {
    for (const node of Array.from(parent.children)) {
      const tag = node.tagName.toLowerCase()
      if (tag === 'table') {
        const rows = Array.from(node.querySelectorAll('tr')).filter(row => row.closest('table') === node).map(row =>
          Array.from(row.children).filter(cell => ['td', 'th'].includes(cell.tagName.toLowerCase())).map(cell =>
            ({ text: text(cell), colSpan: span(cell, 'colspan'), rowSpan: span(cell, 'rowspan') })))
        blocks.push({ kind: 'table', index: blocks.length, rows })
      } else if (/^(p|h[1-6]|li)$/.test(tag)) {
        blocks.push({ kind: tag[0] === 'h' ? 'heading' : 'paragraph', index: blocks.length, text: text(node),
          ...(tag[0] === 'h' ? { level: Number(tag[1]) } : {}) })
      } else visit(node)
    }
  }
  visit(root)
  return { blocks, notices: [DOCX_STRUCTURE_NOTICE_V1, ...notices] }
}
