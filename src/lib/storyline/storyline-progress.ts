/**
 * Phase 39 · 动态故事线进度。
 *
 * StoryArc / StoryStage 是作者维护的静态闭集；模型只能把一章正文映射到闭集，
 * 结果先停留在内存候选，作者调用 accept* 后才经 adopt() 写入权威表。
 */
import type {
  ChatMessage,
  StoryArc,
  StoryStage,
  StorylineCrossing,
  StorylineProgress,
  StorylineProgressStatus,
  WorkspaceScope,
} from '../types'
import { STORYLINE_PROGRESS_STATUSES, parseStages } from '../types'
import { adopt } from '../registry/adopt'
import { db } from '../db/schema'
import { htmlToPlainText } from '../utils/html'
import { resolveCanonicalChapterSequence } from '../ai/chapter-memory/canonical-chapter-sequence'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveReadScopeLike,
  resolveScope,
  scopeTransactionTables,
} from '../workspace/scope'
import { hashCanonicalValue } from '../agent/run/hash'

export interface StorylineProgressCandidate {
  kind: 'progress'
  arcId: number
  currentStageId: string | null
  status: StorylineProgressStatus
  progressNote: string
  involvedEntities: string[]
  evidenceQuote: string
}

export interface StorylineCrossingCandidate {
  kind: 'crossing'
  arcIdA: number
  arcIdB: number
  note: string
  evidenceQuote: string
}

export interface NewStorylineCandidate {
  kind: 'new-arc'
  name: string
  arcType: 'main' | 'sub'
  description: string
  evidenceQuote: string
}

export interface StorylineAnalysisCandidates {
  progress: StorylineProgressCandidate[]
  crossings: StorylineCrossingCandidate[]
  newArcs: NewStorylineCandidate[]
}

type ArcBoundary = Pick<StoryArc, 'id' | 'name' | 'type' | 'description' | 'stages'>

export function buildStorylineProgressPrompt(args: {
  chapterTitle: string
  chapterContent: string
  arcs: ArcBoundary[]
}): ChatMessage[] {
  const registry = args.arcs.map(arc => ({
    id: arc.id,
    name: arc.name,
    type: arc.type,
    description: arc.description ?? '',
    stages: parseStages(arc.stages).map(stage => ({
      id: stage.id,
      title: stage.title,
      description: stage.description,
    })),
  }))
  return [
    {
      role: 'system',
      content: `你是小说故事线映射器。你只能分析正文如何推进作者已经登记的故事线，不得把推测当事实。

输出严格 JSON，不要 Markdown：
{
  "progress": [{"arcId": 1, "currentStageId": "阶段ID或null", "status": "dormant|active|climax|resolved|abandoned", "progressNote": "本章如何推进", "involvedEntities": ["正文实体名"], "quote": "正文逐字引文"}],
  "crossings": [{"arcIdA": 1, "arcIdB": 2, "note": "两线在本章如何互相影响", "quote": "正文逐字引文"}],
  "newArcs": [{"name": "疑似新故事线", "type": "main|sub", "description": "为什么值得登记", "quote": "正文逐字引文"}]
}

硬规则：
1. progress/crossings 只能使用登记清单里的数字 arcId；currentStageId 只能使用该线的阶段 ID；
2. quote 必须逐字出现在正文，禁止改写；没有逐字证据就不要输出；
3. 同一条线本章最多一个 progress；交汇必须是两条不同的已登记线；
4. 新线不得冒充已登记线；只能放 newArcs，后续由作者另行确认创建；
5. 没有可靠映射时返回三个空数组，宁缺毋滥。`,
    },
    {
      role: 'user',
      content: `【已登记故事线闭集】\n${JSON.stringify(registry)}\n\n【章节】${args.chapterTitle}\n\n【正文】\n${args.chapterContent}\n\n请输出 JSON：`,
    },
  ]
}

export function parseStorylineProgressResult(args: {
  raw: string
  chapterContent: string
  arcs: ArcBoundary[]
}): StorylineAnalysisCandidates {
  const empty: StorylineAnalysisCandidates = { progress: [], crossings: [], newArcs: [] }
  const start = args.raw.indexOf('{')
  const end = args.raw.lastIndexOf('}')
  if (start < 0 || end <= start) return empty

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(args.raw.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return empty
  }

  const arcsById = new Map<number, { arc: ArcBoundary; stages: Map<string, StoryStage> }>()
  const registeredNames = new Set<string>()
  for (const arc of args.arcs) {
    if (arc.id == null) continue
    arcsById.set(arc.id, {
      arc,
      stages: new Map(parseStages(arc.stages).map(stage => [stage.id, stage])),
    })
    registeredNames.add(normalizeName(arc.name))
  }

  const seenProgress = new Set<number>()
  const progress = arrayOfRecords(parsed.progress).flatMap((item): StorylineProgressCandidate[] => {
    const arcId = finiteId(item.arcId)
    const boundary = arcId == null ? undefined : arcsById.get(arcId)
    const status = String(item.status ?? '').trim() as StorylineProgressStatus
    const quote = String(item.quote ?? item.evidenceQuote ?? '').trim()
    const note = String(item.progressNote ?? '').trim()
    const stageIdRaw = item.currentStageId == null ? null : String(item.currentStageId).trim()
    const stageId = stageIdRaw || null
    if (
      arcId == null || !boundary || seenProgress.has(arcId)
      || !STORYLINE_PROGRESS_STATUSES.includes(status)
      || !note || !isExactQuote(args.chapterContent, quote)
      || (stageId != null && !boundary.stages.has(stageId))
    ) return []
    seenProgress.add(arcId)
    return [{
      kind: 'progress',
      arcId,
      currentStageId: stageId,
      status,
      progressNote: note,
      involvedEntities: cleanStringArray(item.involvedEntities).slice(0, 20),
      evidenceQuote: quote,
    }]
  })

  const seenCrossings = new Set<string>()
  const crossings = arrayOfRecords(parsed.crossings).flatMap((item): StorylineCrossingCandidate[] => {
    const rawA = finiteId(item.arcIdA)
    const rawB = finiteId(item.arcIdB)
    const note = String(item.note ?? '').trim()
    const quote = String(item.quote ?? item.evidenceQuote ?? '').trim()
    if (
      rawA == null || rawB == null || rawA === rawB
      || !arcsById.has(rawA) || !arcsById.has(rawB)
      || !note || !isExactQuote(args.chapterContent, quote)
    ) return []
    const [arcIdA, arcIdB] = rawA < rawB ? [rawA, rawB] : [rawB, rawA]
    const key = `${arcIdA}:${arcIdB}`
    if (seenCrossings.has(key)) return []
    seenCrossings.add(key)
    return [{ kind: 'crossing', arcIdA, arcIdB, note, evidenceQuote: quote }]
  })

  const seenNewNames = new Set<string>()
  const newArcs = arrayOfRecords(parsed.newArcs).flatMap((item): NewStorylineCandidate[] => {
    const name = String(item.name ?? '').trim()
    const description = String(item.description ?? '').trim()
    const evidenceQuote = String(item.quote ?? item.evidenceQuote ?? '').trim()
    const arcType = String(item.type ?? item.arcType ?? '').trim() as 'main' | 'sub'
    const key = normalizeName(name)
    if (
      !name || !description || (arcType !== 'main' && arcType !== 'sub')
      || !isExactQuote(args.chapterContent, evidenceQuote)
      || registeredNames.has(key) || seenNewNames.has(key)
    ) return []
    seenNewNames.add(key)
    return [{ kind: 'new-arc', name, arcType, description, evidenceQuote }]
  })

  return { progress, crossings, newArcs }
}

export async function acceptStorylineProgressCandidate(args: {
  projectId: number
  chapterId: number
  candidate: StorylineProgressCandidate
  scope?: WorkspaceScope
}): Promise<number> {
  const scope = await resolveScope({ projectId: args.projectId, scope: args.scope })
  const chapter = await assertChapterEvidence(
    scope,
    args.chapterId,
    args.candidate.evidenceQuote,
  )
  await assertArcStageBoundary(scope, args.candidate.arcId, args.candidate.currentStageId)
  const existing = (await readOwnedRows<StorylineProgress>(scope, 'storylineProgress', { owner: 'work' }))
    .find(row => row.arcId === args.candidate.arcId)
  const result = await adopt({
    projectId: args.projectId,
    scope,
    target: 'storylineProgress',
    mode: existing?.id != null ? 'replace' : 'add',
    ...(existing?.id != null ? { recordId: existing.id } : {}),
    data: {
      arcId: args.candidate.arcId,
      currentStageId: args.candidate.currentStageId,
      status: args.candidate.status,
      progressNote: args.candidate.progressNote,
      lastActiveChapterId: args.chapterId,
      lastActiveChapterTitle: chapter.title,
      involvedEntities: args.candidate.involvedEntities,
      evidenceQuote: args.candidate.evidenceQuote,
    },
  })
  return requireWrittenId(result, '故事线进度')
}

export async function acceptStorylineCrossingCandidate(args: {
  projectId: number
  chapterId: number
  candidate: StorylineCrossingCandidate
  scope?: WorkspaceScope
}): Promise<number> {
  const scope = await resolveScope({ projectId: args.projectId, scope: args.scope })
  if (args.candidate.arcIdA === args.candidate.arcIdB) throw new Error('故事线不能与自身交汇')
  const chapter = await assertChapterEvidence(
    scope,
    args.chapterId,
    args.candidate.evidenceQuote,
  )
  await Promise.all([
    assertArcStageBoundary(scope, args.candidate.arcIdA, null),
    assertArcStageBoundary(scope, args.candidate.arcIdB, null),
  ])
  const [arcIdA, arcIdB] = args.candidate.arcIdA < args.candidate.arcIdB
    ? [args.candidate.arcIdA, args.candidate.arcIdB]
    : [args.candidate.arcIdB, args.candidate.arcIdA]
  const result = await adopt({
    projectId: args.projectId,
    scope,
    target: 'storylineCrossings',
    mode: 'add',
    data: {
      arcIdA,
      arcIdB,
      chapterId: args.chapterId,
      chapterTitle: chapter.title,
      note: args.candidate.note,
      evidenceQuote: args.candidate.evidenceQuote,
    },
  })
  return requireWrittenId(result, '故事线交汇')
}

/** 新故事线候选仍需作者单独确认；创建后只进入静态登记，不自动采纳动态进度。 */
export async function acceptNewStorylineCandidate(args: {
  projectId: number
  candidate: NewStorylineCandidate
  scope?: WorkspaceScope
}): Promise<number> {
  const scope = await resolveScope({ projectId: args.projectId, scope: args.scope })
  const existing = await readOwnedRows<StoryArc>(scope, 'storyArcs', { owner: 'work' })
  if (existing.some(arc => normalizeName(arc.name) === normalizeName(args.candidate.name))) {
    throw new Error('同名故事线已登记，请重新映射后再处理')
  }
  const result = await adopt({
    projectId: args.projectId,
    scope,
    target: 'storyArcs',
    mode: 'add',
    data: {
      name: args.candidate.name,
      type: args.candidate.arcType,
      description: args.candidate.description,
      stages: [],
    },
  })
  return requireWrittenId(result, '新故事线')
}

/**
 * Durable storyline mapping adoption. A single author confirmation commits the
 * complete mapping candidate through the existing adoption registry. New arcs
 * remain static registrations; they do not receive progress automatically.
 */
export async function adoptStorylineAnalysisCandidates(args: {
  projectId: number
  chapterId: number
  snapshot: { serialized: string; chapterContentHash: string; arcs: ArcBoundary[] }
  candidate: StorylineAnalysisCandidates
  scope?: WorkspaceScope
}): Promise<Awaited<ReturnType<typeof adopt>>> {
  const scope = await resolveScope({ projectId: args.projectId, scope: args.scope })
  const chapter = await assertChapterEvidence(scope, args.chapterId, firstEvidenceQuote(args.candidate))
  const content = htmlToPlainText(chapter.content || '')
  const contentHash = await hashStorylineContent(content)
  if (contentHash !== args.snapshot.chapterContentHash) {
    throw new Error('正文已变化，候选证据不再成立，请重新映射')
  }
  const arcs = await readOwnedRows<StoryArc>(scope, 'storyArcs', { owner: 'work' })
  const parsed = parseStorylineProgressResult({
    raw: JSON.stringify(args.candidate),
    chapterContent: content,
    arcs,
  })
  if (
    parsed.progress.length + parsed.crossings.length + parsed.newArcs.length === 0
  ) throw new Error('故事线候选没有通过确定性证据校验。')
  return db.transaction(
    'rw',
    scopeTransactionTables(db.storylineProgress, db.storylineCrossings, db.storyArcs, db.chapters),
    async () => {
      const results: Awaited<ReturnType<typeof adopt>>[] = []
      for (const candidate of parsed.progress) {
        await assertArcStageBoundary(scope, candidate.arcId, candidate.currentStageId)
        const existing = (await readOwnedRows<StorylineProgress>(scope, 'storylineProgress', { owner: 'work' }))
          .find(row => row.arcId === candidate.arcId)
        results.push(assertCommittedAdoptResult(await adopt({
          projectId: args.projectId,
          scope,
          target: 'storylineProgress',
          mode: existing?.id != null ? 'replace' : 'add',
          ...(existing?.id != null ? { recordId: existing.id } : {}),
          data: {
            arcId: candidate.arcId,
            currentStageId: candidate.currentStageId,
            status: candidate.status,
            progressNote: candidate.progressNote,
            lastActiveChapterId: args.chapterId,
            lastActiveChapterTitle: chapter.title,
            involvedEntities: candidate.involvedEntities,
            evidenceQuote: candidate.evidenceQuote,
          },
        }), '故事线进度'))
      }
      for (const candidate of parsed.crossings) {
        if (candidate.arcIdA === candidate.arcIdB) throw new Error('故事线不能与自身交汇')
        await assertArcStageBoundary(scope, candidate.arcIdA, null)
        await assertArcStageBoundary(scope, candidate.arcIdB, null)
        const [arcIdA, arcIdB] = candidate.arcIdA < candidate.arcIdB
          ? [candidate.arcIdA, candidate.arcIdB]
          : [candidate.arcIdB, candidate.arcIdA]
        results.push(assertCommittedAdoptResult(await adopt({
          projectId: args.projectId,
          scope,
          target: 'storylineCrossings',
          mode: 'add',
          data: {
            arcIdA,
            arcIdB,
            chapterId: args.chapterId,
            chapterTitle: chapter.title,
            note: candidate.note,
            evidenceQuote: candidate.evidenceQuote,
          },
        }), '故事线交汇'))
      }
      const existingNames = new Set(arcs.map(arc => normalizeName(arc.name)))
      for (const candidate of parsed.newArcs) {
        const key = normalizeName(candidate.name)
        if (existingNames.has(key)) throw new Error(`同名故事线“${candidate.name}”已登记，请重新映射。`)
        existingNames.add(key)
        results.push(assertCommittedAdoptResult(await adopt({
          projectId: args.projectId,
          scope,
          target: 'storyArcs',
          mode: 'add',
          data: {
            name: candidate.name,
            type: candidate.arcType,
            description: candidate.description,
            stages: [],
          },
        }), '新故事线'))
      }
      return mergeAdoptResults(results)
    },
  )
}

export async function readStorylineProgressContext(
  projectId: number,
  chapterId?: number | null,
  scope?: WorkspaceScope,
): Promise<string> {
  const resolved = scope ?? await resolveReadScopeLike(projectId)
  const [arcs, rawProgress, rawCrossings, chapters, outlineNodes] = await Promise.all([
    readOwnedRows<StoryArc>(resolved, 'storyArcs', { owner: 'work' }),
    readOwnedRows<StorylineProgress>(resolved, 'storylineProgress', { owner: 'work' }),
    readOwnedRows<StorylineCrossing>(resolved, 'storylineCrossings', { owner: 'work' }),
    chapterId != null ? readOwnedRows<any>(resolved, 'chapters', { owner: 'work' }) : Promise.resolve([]),
    chapterId != null ? readOwnedRows<any>(resolved, 'outlineNodes', { owner: 'work' }) : Promise.resolve([]),
  ])
  let progress = rawProgress
  let crossings = rawCrossings
  if (chapterId != null) {
    const { sequence } = resolveCanonicalChapterSequence(outlineNodes, chapters)
    const orderOf = new Map<number, number>()
    sequence.forEach((entry, index) => {
      if (entry.chapter.id != null) orderOf.set(entry.chapter.id, index)
    })
    const currentOrder = orderOf.get(chapterId)
    if (currentOrder == null) return ''
    progress = rawProgress.filter(row => {
      if (row.lastActiveChapterId == null) return false
      const order = orderOf.get(row.lastActiveChapterId)
      return order != null && order <= currentOrder
    })
    crossings = rawCrossings.filter(row => {
      if (row.chapterId == null) return false
      const order = orderOf.get(row.chapterId)
      return order != null && order <= currentOrder
    })
  }
  if (!progress.length && !crossings.length) return ''
  const arcsById = new Map(arcs.filter(arc => arc.id != null).map(arc => [arc.id!, arc]))
  const lines = ['【作者确认的故事线当前进度】']
  for (const row of progress) {
    const arc = arcsById.get(row.arcId)
    if (!arc) continue
    const stage = parseStages(arc.stages).find(item => item.id === row.currentStageId)
    const entities = parseEntityNames(row.involvedEntities)
    lines.push(
      `- ${arc.name}：${row.status}${stage ? ` / ${stage.title}` : ''}；${row.progressNote}`
      + `${entities.length ? `；涉及：${entities.join('、')}` : ''}`
      + `${row.lastActiveChapterTitle ? `（最近：${row.lastActiveChapterTitle}）` : ''}`,
    )
  }
  if (crossings.length) {
    lines.push('【作者确认的故事线交汇】')
    for (const row of crossings.slice(-40)) {
      const a = arcsById.get(row.arcIdA)
      const b = arcsById.get(row.arcIdB)
      if (!a || !b) continue
      lines.push(`- ${a.name} × ${b.name}${row.chapterTitle ? ` @ ${row.chapterTitle}` : ''}：${row.note}`)
    }
  }
  return lines.join('\n')
}

async function assertArcStageBoundary(scope: WorkspaceScope, arcId: number, stageId: string | null): Promise<void> {
  const arc = await db.storyArcs.get(arcId)
  if (!arc || !await assertRecordInScope(scope, 'storyArcs', arc, { owner: 'work' })) {
    throw new Error('故事线不存在或不属于当前作品')
  }
  if (stageId != null && !parseStages(arc.stages).some(stage => stage.id === stageId)) {
    throw new Error('阶段不属于目标故事线')
  }
}

async function assertChapterEvidence(scope: WorkspaceScope, chapterId: number, quote: string) {
  const chapter = await db.chapters.get(chapterId)
  if (!chapter || !await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('章节不存在或不属于当前作品')
  }
  const content = htmlToPlainText(chapter.content || '')
  if (!isExactQuote(content, quote)) throw new Error('正文已变化，候选证据不再成立，请重新映射')
  return chapter
}

function requireWrittenId(result: Awaited<ReturnType<typeof adopt>>, label: string): number {
  const id = result.written[0]?.id
  if (id == null) {
    const reason = result.skipped[0]?.reason
      || result.fkErrors.map(item => `${item.field}=${String(item.refValue)}`).join(', ')
      || '未知原因'
    throw new Error(`${label}采纳失败：${reason}`)
  }
  return id
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    : []
}

function finiteId(value: unknown): number | null {
  const id = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(item => String(item).trim()).filter(Boolean))]
}

function parseEntityNames(value: string): string[] {
  try {
    return cleanStringArray(JSON.parse(value))
  } catch {
    return []
  }
}

function isExactQuote(content: string, quote: string): boolean {
  return quote.length > 0 && content.includes(quote)
}

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase()
}

function firstEvidenceQuote(candidate: StorylineAnalysisCandidates): string {
  return candidate.progress[0]?.evidenceQuote
    || candidate.crossings[0]?.evidenceQuote
    || candidate.newArcs[0]?.evidenceQuote
    || ''
}

async function hashStorylineContent(content: string): Promise<string> {
  return hashCanonicalValue(content)
}

function mergeAdoptResults(results: Awaited<ReturnType<typeof adopt>>[]): Awaited<ReturnType<typeof adopt>> {
  return results.reduce((merged, result) => ({
    ...merged,
    written: [...merged.written, ...result.written],
    aliasMapped: [...merged.aliasMapped, ...result.aliasMapped],
    skipped: [...merged.skipped, ...result.skipped],
    unknown: [...merged.unknown, ...result.unknown],
    typeErrors: [...merged.typeErrors, ...result.typeErrors],
    fkErrors: [...merged.fkErrors, ...result.fkErrors],
  }), {
    written: [],
    aliasMapped: [],
    skipped: [],
    unknown: [],
    typeErrors: [],
    fkErrors: [],
  } as Awaited<ReturnType<typeof adopt>>)
}

function assertCommittedAdoptResult(
  result: Awaited<ReturnType<typeof adopt>>,
  label: string,
): Awaited<ReturnType<typeof adopt>> {
  if (
    result.written.length !== 1
    || result.skipped.length > 0
    || result.unknown.length > 0
    || result.typeErrors.length > 0
    || result.fkErrors.length > 0
  ) {
    const reason = result.skipped[0]?.reason
      ?? result.unknown[0]
      ?? result.typeErrors[0]?.field
      ?? (result.fkErrors[0]
        ? `${result.fkErrors[0].field}=${String(result.fkErrors[0].refValue)}`
        : undefined)
      ?? '未知原因'
    throw new Error(`${label}采纳未完整写入：${reason}`)
  }
  return result
}

export type { StorylineProgress, StorylineCrossing }
