/** Minimal export sanitizer for user-authored chapter HTML. */
export function sanitizeExportHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<(iframe|object|embed|link|meta)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(iframe|object|embed|link|meta)\b[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/\s+(href|src|xlink:href)\s*=\s*"javascript:[^"]*"/gi, '')
    .replace(/\s+(href|src|xlink:href)\s*=\s*'javascript:[^']*'/gi, '')
    .replace(/\s+(href|src|xlink:href)\s*=\s*javascript:[^\s>]+/gi, '')
}
