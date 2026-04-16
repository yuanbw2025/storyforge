/**
 * HTML 与纯文本互转工具
 * 用于 TipTap 富文本 <-> 旧纯文本内容 的双向兼容
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
  // 兼容 CRLF
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  return lines
    .map(l => (l.trim().length === 0 ? '<p></p>' : `<p>${escape(l)}</p>`))
    .join('')
}

/** 将任意内容（可能是 HTML 或纯文本）标准化为 HTML */
export function toHtml(content: string): string {
  if (!content) return ''
  return isHtml(content) ? content : plainTextToHtml(content)
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
  // 简化处理：直接返回非空白字符数（与旧实现一致）
  return plainText.replace(/\s/g, '').length
}
