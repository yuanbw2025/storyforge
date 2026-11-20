/**
 * 大文档智能切块器。
 *
 * 策略（优先级从高到低）：
 *  1) 如果原文里有「第X章/回/节」标题，以章节边界切；连续多个章节合并进一个 chunk
 *     直到凑够 targetChars，保证 chunk 之间不会把一章劈两半。
 *  2) 如果没识别到章节标题（大纲/人物表这种），按空行分割的「段落」凑 chunk。
 *  3) 退化：硬按字符数切，保留 overlapChars 的尾部重叠到下一 chunk（降上下文丢失）。
 *
 * 单位：字符数（中文字符 ≈ 1 token，粗估够用；真实 tokenizer 差异用 20% 余量吸收）。
 */

export interface ChunkPlan {
  index: number
  startChar: number
  endChar: number
  charCount: number
  label?: string
  text: string
}

export interface ChunkOptions {
  /** 单块目标字符数（默认 30000） */
  targetChars?: number
  /** 硬切时尾部重叠到下块的字符数（默认 500） */
  overlapChars?: number
}

const DEFAULT_TARGET = 30000
const DEFAULT_OVERLAP = 500

// Legacy AI plan identity: keep byte-for-byte chunk semantics for frozen paid sessions.
// A future matcher change needs versioned recovery; new novel chapters use their own matcher.
const CHAPTER_REGEX = /^\s*第\s*[一二三四五六七八九十百千万零〇两\d０-９]+\s*[章回节卷部篇][\s\S]{0,30}$/gm
const NOVEL_CHAPTER_REGEX = /^[^\S\r\n\u2028\u2029]*第[^\S\r\n\u2028\u2029]*[一二三四五六七八九十百千万零〇两\d０-９]+[^\S\r\n\u2028\u2029]*[章回节卷部篇][^\r\n\u2028\u2029]{0,200}$/gm

export function chunkDocument(text: string, opts: ChunkOptions = {}): ChunkPlan[] {
  const target = Math.max(5000, opts.targetChars ?? DEFAULT_TARGET)
  const overlap = Math.max(0, Math.min(2000, opts.overlapChars ?? DEFAULT_OVERLAP))

  if (!text || text.length === 0) return []

  // 极短文档 —— 直接一块
  if (text.length <= target) {
    return [{
      index: 0,
      startChar: 0,
      endChar: text.length,
      charCount: text.length,
      label: '全文',
      text,
    }]
  }

  // ── 第 1 步：找章节边界 ────────────────────────────────────
  const boundaries = findChapterBoundaries(text)
  if (boundaries.length >= 2) {
    return chunkByChapters(text, boundaries, target)
  }

  // ── 第 2 步：按段落凑块 ────────────────────────────────────
  const paraChunks = chunkByParagraphs(text, target)
  if (paraChunks.length >= 2) return paraChunks

  // ── 第 3 步：硬切 ───────────────────────────────────────────
  return chunkByCharacters(text, target, overlap)
}

/** Recognized novel chapters follow headings, never the model processing budget.
 * Every input character belongs to exactly one range; unstructured text retains the existing fallback.
 */
export function splitDocumentChapters(text: string): ChunkPlan[] {
  if (!text) return []
  const headings = findChapterBoundaries(text, NOVEL_CHAPTER_REGEX)
  if (!headings.length) return chunkDocument(text, { targetChars: 20_000, overlapChars: 0 })
  const starts = headings.map(heading => ({ ...heading }))
  if (text.slice(0, starts[0].start).trim()) starts.unshift({ start: 0, title: '前言' })
  else starts[0].start = 0
  return starts.map((heading, index) => {
    const endChar = starts[index + 1]?.start ?? text.length
    return { index, startChar: heading.start, endChar, charCount: endChar - heading.start,
      label: heading.title, text: text.slice(heading.start, endChar) }
  })
}

function findChapterBoundaries(text: string, matcher = CHAPTER_REGEX): Array<{ start: number; title: string }> {
  const out: Array<{ start: number; title: string }> = []
  // 重置 lastIndex
  matcher.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = matcher.exec(text)) !== null) {
    out.push({ start: m.index, title: m[0].trim() })
    // 避免零宽无限循环
    if (m.index === matcher.lastIndex) matcher.lastIndex++
  }
  return out
}

function chunkByChapters(
  text: string,
  boundaries: Array<{ start: number; title: string }>,
  target: number,
): ChunkPlan[] {
  // 把章节扩为 [start, end)
  const chapters = boundaries.map((b, i) => ({
    start: b.start,
    end: i + 1 < boundaries.length ? boundaries[i + 1].start : text.length,
    title: b.title,
  }))

  // 0 ~ 第一章之前的"前言"如果有内容，作为第 0 块附加
  const preface = boundaries[0].start > 0 ? text.slice(0, boundaries[0].start).trim() : ''

  const chunks: ChunkPlan[] = []
  let bufStart = preface ? 0 : chapters[0].start
  let bufEnd = bufStart
  let bufLabels: string[] = preface ? ['（前言）'] : []

  const flush = () => {
    if (bufEnd <= bufStart) return
    const slice = text.slice(bufStart, bufEnd)
    chunks.push({
      index: chunks.length,
      startChar: bufStart,
      endChar: bufEnd,
      charCount: slice.length,
      label: bufLabels.length > 3
        ? `${bufLabels[0]} … ${bufLabels[bufLabels.length - 1]}（共 ${bufLabels.length} 节）`
        : bufLabels.join(' · '),
      text: slice,
    })
    bufStart = bufEnd
    bufLabels = []
  }

  for (const ch of chapters) {
    const prospectiveLen = ch.end - bufStart
    if (prospectiveLen > target && bufEnd > bufStart) {
      // 当前已有内容，先 flush，再看下一章是否单章就超长
      flush()
    }
    // 如果单章就超过 target，仍然独立成块（不拆章，保证章内上下文完整）
    bufEnd = ch.end
    bufLabels.push(ch.title.slice(0, 24))
    if (bufEnd - bufStart >= target) {
      flush()
    }
  }
  flush()
  return chunks
}

function chunkByParagraphs(text: string, target: number): ChunkPlan[] {
  const paras = text.split(/\n{2,}/)
  const chunks: ChunkPlan[] = []
  let bufStart = 0
  let bufLen = 0
  let cursor = 0

  const flushRange = (from: number, to: number) => {
    if (to <= from) return
    const slice = text.slice(from, to)
    chunks.push({
      index: chunks.length,
      startChar: from,
      endChar: to,
      charCount: slice.length,
      label: `段落 ${chunks.length + 1}`,
      text: slice,
    })
  }

  for (const p of paras) {
    const pLen = p.length + 2 // +2 for \n\n separator
    if (bufLen + pLen > target && bufLen > 0) {
      flushRange(bufStart, cursor)
      bufStart = cursor
      bufLen = 0
    }
    cursor += pLen
    bufLen += pLen
  }
  flushRange(bufStart, text.length)
  return chunks
}

function chunkByCharacters(text: string, target: number, overlap: number): ChunkPlan[] {
  const chunks: ChunkPlan[] = []
  let pos = 0
  while (pos < text.length) {
    const end = Math.min(pos + target, text.length)
    const slice = text.slice(pos, end)
    chunks.push({
      index: chunks.length,
      startChar: pos,
      endChar: end,
      charCount: slice.length,
      label: `区段 ${chunks.length + 1}`,
      text: slice,
    })
    if (end >= text.length) break
    pos = end - overlap
  }
  return chunks
}

/** 轻量 hash（不需要强密码学）：转 16 进制短串，够做"同文件续跑"识别 */
export function quickHash(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0')
  return hex(h2) + hex(h1) + '-' + text.length.toString(36)
}


/** Opt-in foundation for NEW plans only. Legacy chunkDocument/recovery stays unchanged.
 * Offsets are UTF-16 code units into the exact decoded string, NOT file byte offsets.
 * No gaps, trimming or overlap. fits must inspect the whole actual rendered request.
 * Binary probing is conservative: nonmonotonic estimates have no maximum-size guarantee.
 * Every chosen range is checked again with the final total; a changed frame fails visibly.
 */
export function planAdaptiveDocumentParseChunksV1(
  text: string,
  fits: (chunk: ChunkPlan, totalChunks: number) => boolean,
): ChunkPlan[] {
  if (!text.length) return []
  const upperTotal = text.length
  const make = (startChar: number, endChar: number, index: number): ChunkPlan => ({
    index, startChar, endChar, charCount: endChar - startChar,
    label: `区段 ${index + 1}`, text: text.slice(startChar, endChar),
  })
  if (!fits(make(0, 0, 0), upperTotal)) throw new Error('文档解析的完整空请求框架已超预算，不能通过缩小原文解决。')
  const safeEnd = (end: number): number => {
    if (end > 0 && end < text.length) {
      const before = text.charCodeAt(end - 1), after = text.charCodeAt(end)
      if ((before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff)
        || (before === 13 && after === 10)) return end - 1
    }
    return end
  }
  // Independent matchers: do not mutate the legacy regex's lastIndex or its paid plan semantics.
  const chapters: number[] = [], paragraphs: number[] = []
  const heading = new RegExp(NOVEL_CHAPTER_REGEX.source, NOVEL_CHAPTER_REGEX.flags)
  let match: RegExpExecArray | null
  while ((match = heading.exec(text)) !== null) chapters.push(match.index)
  const paragraph = /\r?\n[^\S\r\n]*(?:\r?\n)+/g
  while ((match = paragraph.exec(text)) !== null) paragraphs.push(match.index + match[0].length)
  const lastAtMost = (points: number[], limit: number) => {
    let low = 0, high = points.length - 1, found = -1
    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      if (points[mid] <= limit) { found = points[mid]; low = mid + 1 } else high = mid - 1
    }
    return found
  }
  const chunks: ChunkPlan[] = []
  let start = 0
  while (start < text.length) {
    const index = chunks.length
    let best = text.length
    if (!fits(make(start, best, index), upperTotal)) {
      const minimum = safeEnd(start + 1) > start ? start + 1 : start + 2
      if (minimum > text.length || !fits(make(start, minimum, index), upperTotal)) {
        throw new Error(`第 ${index + 1} 块的完整最小请求无法容纳原文；未丢弃或重发任何分块。`)
      }
      best = minimum
      let low = minimum + 1, high = text.length - 1
      while (low <= high) {
        const mid = Math.floor((low + high) / 2), end = safeEnd(mid)
        if (end <= start) { low = mid + 1; continue }
        if (fits(make(start, end, index), upperTotal)) { best = Math.max(best, end); low = mid + 1 } else high = mid - 1
      }
      const chapterEnd = lastAtMost(chapters, best), paragraphEnd = lastAtMost(paragraphs, best)
      const preferred = chapterEnd > start ? chapterEnd : paragraphEnd > start ? paragraphEnd : best
      if (preferred > start && safeEnd(preferred) === preferred && fits(make(start, preferred, index), upperTotal)) best = preferred
    }
    const chunk = make(start, best, index)
    if (best <= start || !fits(chunk, upperTotal)) throw new Error('文档解析请求框架已变化；分块计划未生效。')
    chunks.push(chunk)
    start = best
  }
  for (const chunk of chunks) {
    if (!fits(chunk, chunks.length)) throw new Error('文档解析最终请求框架已变化；分块计划未生效。')
  }
  return chunks
}
