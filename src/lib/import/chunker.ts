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

/** 匹配中文章节标题（行首，可前后有空格） */
const CHAPTER_REGEX = /^[\s　]*第\s*[一二三四五六七八九十百千万零〇两\d０-９]+\s*[章回节卷部篇][\s　\S]{0,30}$/gm

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

function findChapterBoundaries(text: string): Array<{ start: number; title: string }> {
  const out: Array<{ start: number; title: string }> = []
  // 重置 lastIndex
  CHAPTER_REGEX.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CHAPTER_REGEX.exec(text)) !== null) {
    out.push({ start: m.index, title: m[0].trim() })
    // 避免零宽无限循环
    if (m.index === CHAPTER_REGEX.lastIndex) CHAPTER_REGEX.lastIndex++
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
