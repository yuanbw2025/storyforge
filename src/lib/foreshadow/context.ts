import { resolveCanonicalChapterSequence } from '../ai/chapter-memory/canonical-chapter-sequence'
import type { Chapter, Foreshadow, OutlineNode } from '../types'

const FORESHADOW_TYPE_LABELS: Record<string, string> = {
  chekhov: '契诃夫之枪',
  prophecy: '预言暗示',
  symbol: '象征伏笔',
  character: '角色伏笔',
  dialogue: '对话伏笔',
  environment: '环境伏笔',
  timeline: '时间线伏笔',
  'red-herring': '红鲱鱼',
  parallel: '平行伏笔',
  callback: '回调伏笔',
}

interface ChapterMeta {
  labelById: Map<number, string>
  orderById: Map<number, number>
}

export interface ForeshadowTaskContextOptions {
  currentChapterId?: number | null
  chapters?: Chapter[]
  outlineNodes?: OutlineNode[]
  maxItems?: number
}

export function parseForeshadowEchoChapterIds(value: unknown): number[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? (() => {
          try { return JSON.parse(value || '[]') } catch { return [] }
        })()
      : []

  if (!Array.isArray(raw)) return []
  return raw
    .map(item => Number(item))
    .filter(item => Number.isInteger(item) && item > 0)
}

function buildChapterMeta(chapters: Chapter[] = [], outlineNodes: OutlineNode[] = []): ChapterMeta {
  const { sequence } = resolveCanonicalChapterSequence(outlineNodes, chapters)
  const labelById = new Map<number, string>()
  const orderById = new Map<number, number>()

  sequence.forEach((entry, index) => {
    if (entry.chapter.id == null) return
    const title = (entry.chapter.title || entry.outlineNode?.title || `章节#${entry.chapter.id}`).trim()
    labelById.set(entry.chapter.id, title)
    orderById.set(entry.chapter.id, index)
  })

  return { labelById, orderById }
}

function chapterLabel(meta: ChapterMeta, chapterId?: number | null): string {
  if (chapterId == null) return '未指定'
  return meta.labelById.get(chapterId) ?? `章节#${chapterId}（引用可能已失效）`
}

function formatForeshadowLine(f: Foreshadow): string {
  const bits = [
    f.description?.trim(),
    f.notes?.trim() ? `备注：${f.notes.trim()}` : '',
    f.importance != null ? `重要度：${f.importance}/10` : '',
  ].filter(Boolean)
  const body = bits.join('；')
  return `"${f.name}"（${FORESHADOW_TYPE_LABELS[f.type] || f.type}，当前状态：${f.status}）${body ? `：${body}` : ''}`
}

function chapterOrder(meta: ChapterMeta, chapterId?: number | null): number | null {
  if (chapterId == null) return null
  return meta.orderById.get(chapterId) ?? null
}

export function buildForeshadowTaskContext(
  foreshadows: Foreshadow[],
  options: ForeshadowTaskContextOptions = {},
): string {
  const open = foreshadows.filter(f => f.status !== 'resolved')
  if (!open.length) return ''

  const meta = buildChapterMeta(options.chapters, options.outlineNodes)
  const maxItems = options.maxItems ?? 25
  const currentChapterId = options.currentChapterId ?? null

  if (currentChapterId == null) {
    const lines = open.slice(0, maxItems).map(f => {
      const echoIds = parseForeshadowEchoChapterIds(f.echoChapterIds)
      const refs = [
        f.plantChapterId != null ? `埋设：${chapterLabel(meta, f.plantChapterId)}` : '',
        echoIds.length ? `呼应：${echoIds.map(id => chapterLabel(meta, id)).join(' / ')}` : '',
        f.resolveChapterId != null ? `回收：${chapterLabel(meta, f.resolveChapterId)}` : '',
        f.expectedResolveChapterId != null ? `预期回收：${chapterLabel(meta, f.expectedResolveChapterId)}` : '',
      ].filter(Boolean).join('；')
      return `- ${formatForeshadowLine(f)}${refs ? `（${refs}）` : ''}`
    })
    return `【伏笔状态】\n${lines.join('\n')}`
  }

  const currentOrder = chapterOrder(meta, currentChapterId)
  const parts: string[] = ['【当前章节伏笔任务】']
  const seenTask = new Set<string>()
  const pushTask = (kind: string, f: Foreshadow, instruction: string) => {
    const key = `${kind}:${f.id ?? f.name}`
    if (seenTask.has(key)) return
    seenTask.add(key)
    parts.push(`- [${kind}] ${formatForeshadowLine(f)}。${instruction}`)
  }

  for (const f of open) {
    if (f.plantChapterId === currentChapterId) {
      pushTask('埋设', f, '本章应自然埋下这个线索，不要提前解释答案。')
    }

    const echoIds = parseForeshadowEchoChapterIds(f.echoChapterIds)
    if (echoIds.includes(currentChapterId)) {
      pushTask('呼应', f, '本章应侧面提及或制造读者回忆，但仍保持悬念。')
    }

    if (f.resolveChapterId === currentChapterId || (f.resolveChapterId == null && f.expectedResolveChapterId === currentChapterId)) {
      pushTask('回收', f, '本章应揭示、兑现或明确推进这个伏笔，避免只重复提示。')
    }
  }

  if (currentOrder != null) {
    const overdue = open.filter(f => {
      if (seenTask.has(`回收:${f.id ?? f.name}`)) return false
      const dueOrder = chapterOrder(meta, f.expectedResolveChapterId)
      if (dueOrder == null) return false
      return dueOrder < currentOrder
    })
    for (const f of overdue.slice(0, 8)) {
      pushTask('逾期提醒', f, `预期回收点已过（${chapterLabel(meta, f.expectedResolveChapterId)}），如不回收请在本章给出延后理由或补充线索。`)
    }

    const upcoming = open.filter(f => {
      const dueOrder = chapterOrder(meta, f.expectedResolveChapterId)
      if (dueOrder == null || dueOrder <= currentOrder) return false
      return dueOrder - currentOrder <= 3
    })
    const upcomingOnly = upcoming.filter(f => !seenTask.has(`回收:${f.id ?? f.name}`))
    if (upcomingOnly.length) {
      parts.push('\n【临近回收提醒】')
      for (const f of upcomingOnly.slice(0, 8)) {
        parts.push(`- "${f.name}"：预计在 ${chapterLabel(meta, f.expectedResolveChapterId)} 回收，当前章节可酌情预热。`)
      }
    }
  }

  return parts.length > 1 ? parts.join('\n') : ''
}
