/**
 * 当前正文 HTML 与模型纯文本之间的显式转换工具。
 */

/** 判断字符串是否为 HTML（启发式：包含任意 HTML 标签） */
export function isHtml(s: string): boolean {
  if (!s) return false
  return /<\/?[a-z][\s\S]*>/i.test(s)
}

/** 纯文本 → HTML：每行包装为 <p>，空行生成空段落，保留原意 */
export function plainTextToHtml(text: string): string {
  if (!text) return ''
  const escape = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  // 统一换行符。
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  return lines
    .map(l => (l.trim().length === 0 ? '<p></p>' : `<p>${escape(l)}</p>`))
    .join('')
}

/**
 * 正文候选写入富文本编辑器前的唯一纯文本规范化规则。
 *
 * 候选哈希和作者采纳必须复用同一规则，否则模型输出包含空行时，
 * 生成端按原文计算的哈希会与编辑器实际写入的 HTML 不一致。
 */
export function normalizeProseForEditorV1(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim().length > 0)
    .join('\n')
}

/** HTML → 纯文本（剥离标签，段落之间用 \n 分隔） */
export function htmlToPlainText(html: string): string {
  if (!html) return ''
  if (!isHtml(html)) return html
  if (typeof document === 'undefined') {
    // SSR fallback：简单去标签
    return html
      .replace(/<\/(p|div|h[1-6]|li|blockquote|br)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  // 将块级元素转为换行
  const blocks = tmp.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,blockquote,br')
  blocks.forEach(el => {
    if (el.tagName === 'BR') {
      el.replaceWith('\n')
    } else {
      el.append('\n')
    }
  })
  return (tmp.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
}

/** 统计字数（中文按字符数、英文按单词拆分再合计） */
export function countWords(plainText: string): number {
  if (!plainText) return 0
  // 中文按字符、英文按连续非空白内容计入当前统一统计口径。
  return plainText.replace(/\s/g, '').length
}
