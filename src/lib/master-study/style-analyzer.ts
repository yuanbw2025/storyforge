/**
 * 风格量化分析器（Phase 19-c Layer 2）
 *
 * 纯本地计算，不调用 AI。对原文全文做文本统计，
 * 产出 MasterStyleMetrics 各字段。
 */
import { db } from '../db/schema'
import type { MasterStyleMetrics } from '../types'

const STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
  '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着',
  '没有', '看', '她', '好', '自己', '这', '他', '那', '被', '从', '把',
  '让', '没', '大', '里', '过', '么', '还', '他们', '这个', '多', '能',
  '吗', '什么', '已经', '如果', '可以', '因为', '但是', '所以', '而且',
  '虽然', '只是', '只有', '我们', '你们', '这些', '那些', '起来', '出来',
  '下来', '进去', '回来', '知道', '时候', '现在', '已经', '然后', '其实',
  '不过', '之后', '或者', '还是', '但', '而', '与', '以', '及', '对',
  '为', '之', '则', '却', '又', '再', '更', '最', '只', '才', '便',
])

interface SentenceInfo {
  length: number
}

export function computeStyleMetrics(
  workId: number,
  fullText: string,
): MasterStyleMetrics {
  const sentences = splitSentences(fullText)
  const sentenceLengths = sentences.map(s => s.length)

  const avgSentenceLength = sentenceLengths.length > 0
    ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length
    : 0

  const sentenceLengthHistogram = buildHistogram(sentenceLengths)
  const dialogRatio = computeDialogRatio(fullText)
  const topWords = extractTopWords(fullText, 50)
  const paragraphDensity = computeParagraphDensity(fullText)

  return {
    workId,
    avgSentenceLength,
    sentenceLengthHistogram,
    dialogRatio,
    topWords,
    paragraphDensity,
    computedAt: Date.now(),
  }
}

export async function computeAndSaveStyleMetrics(
  workId: number,
  fullText: string,
): Promise<MasterStyleMetrics> {
  const metrics = computeStyleMetrics(workId, fullText)
  const existing = await db.masterStyleMetrics.where('workId').equals(workId).first()
  if (existing?.id) {
    await db.masterStyleMetrics.delete(existing.id)
    await db.masterStyleMetrics.add(metrics)
  } else {
    await db.masterStyleMetrics.add(metrics)
  }
  return metrics
}

function splitSentences(text: string): SentenceInfo[] {
  const raw = text.split(/[。！？…\n]+/).filter(s => s.trim().length > 0)
  return raw.map(s => ({ length: s.trim().replace(/\s+/g, '').length }))
}

function buildHistogram(lengths: number[]): Record<string, number> {
  const buckets: Record<string, number> = {
    '0-5': 0, '5-10': 0, '10-15': 0, '15-20': 0, '20-30': 0, '30+': 0,
  }
  for (const len of lengths) {
    if (len <= 5) buckets['0-5']++
    else if (len <= 10) buckets['5-10']++
    else if (len <= 15) buckets['10-15']++
    else if (len <= 20) buckets['15-20']++
    else if (len <= 30) buckets['20-30']++
    else buckets['30+']++
  }
  return buckets
}

function computeDialogRatio(text: string): number {
  if (text.length === 0) return 0
  let dialogChars = 0
  const patterns = [
    /「[^」]*」/g,
    /"[^"]*"/g,
    /"[^"]*"/g,
    /'[^']*'/g,
  ]
  const counted = new Uint8Array(text.length)
  for (const pat of patterns) {
    let m: RegExpExecArray | null
    while ((m = pat.exec(text)) !== null) {
      for (let i = m.index; i < m.index + m[0].length; i++) {
        counted[i] = 1
      }
    }
  }
  for (let i = 0; i < counted.length; i++) {
    if (counted[i]) dialogChars++
  }
  return text.length > 0 ? dialogChars / text.length : 0
}

function extractTopWords(text: string, topN: number): { word: string; count: number }[] {
  const clean = text.replace(/[^一-鿿]/g, '')
  const freq = new Map<string, number>()

  for (let n = 2; n <= 4; n++) {
    for (let i = 0; i <= clean.length - n; i++) {
      const w = clean.slice(i, i + n)
      if (STOP_WORDS.has(w)) continue
      freq.set(w, (freq.get(w) || 0) + 1)
    }
  }

  // 过滤低频词（至少出现 3 次）
  const entries = [...freq.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)

  return entries.map(([word, count]) => ({ word, count }))
}

function computeParagraphDensity(text: string): number {
  const paragraphs = text.split(/\n\s*\n|\n/).filter(p => p.trim().length > 0)
  const totalChars = text.replace(/\s+/g, '').length
  if (totalChars === 0) return 0
  return paragraphs.length / (totalChars / 1000)
}
