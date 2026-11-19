/** Closed display-only link policy. Return the authored URL, never a repaired
 * or decoded URL. Relative routes, credentials and other schemes stay text. */
export function markdownReadHrefV1(raw: string): string | null {
  if (!raw || /[\s\\\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(raw)
    || /&(?:#[xX]?[0-9a-fA-F]+;?|[a-zA-Z][a-zA-Z0-9]+;)/u.test(raw)
    || /%25/i.test(raw)) return null
  let decoded: string
  try { decoded = decodeURIComponent(raw) } catch { return null }
  if (/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(decoded)) return null
  if (raw.startsWith('#')) return raw
  if (!/^https?:\/\//i.test(raw)) return null
  try {
    const url = new URL(raw)
    return ['https:', 'http:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? raw : null
  } catch { return null }
}

/** Decode a small text-only entity set for readable prose. This produces a
 * React text child, never markup/attributes; code and raw HTML are not decoded. */
export function markdownReadTextV1(raw: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }
  return raw.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, key: string) => {
    if (!key.startsWith('#')) return named[key.toLowerCase()] ?? entity
    const code = key.slice(0, 2).toLowerCase() === '#x' ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10)
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\ufffd'
  })
}
