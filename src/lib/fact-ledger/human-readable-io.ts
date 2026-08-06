/**
 * NS-4/NS-5 · 人类可读事实/记忆导出 + 外部候选 diff 导入。
 *
 * 红线：
 * - 导出只读，面向人工审阅/外部编辑；
 * - 导入永远只写 candidate/import，不自动升级 confirmed Canon；
 * - 谓词必须存在于 FACT_PREDICATE_REGISTRY；时序章节引用必须属于本项目，否则跳过。
 */
import { db } from '../db/schema'
import { getFactPredicate, normalizeFactValue } from '../registry/fact-predicate-registry'
import type { FactKind, TemporalFact } from '../types/temporal-fact'
import { resolveCanonicalChapterSequence } from '../ai/chapter-memory/canonical-chapter-sequence'
import type { WorkspaceScope } from '../types/world-ownership'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveReadScopeLike,
  resolveScopeLike,
  stampNewRecord,
} from '../world-engine/scope'

export interface FactCandidateDiffRow {
  subjectName: string
  predicate: string
  value: string
  sourceQuote?: string
  validFromChapterId?: number | null
  validToChapterId?: number | null
}

export interface ImportFactCandidateDiffResult {
  written: number
  skippedInvalid: number
  skippedDuplicate: number
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeRows(raw: unknown): FactCandidateDiffRow[] {
  const arr = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' && Array.isArray((raw as any).facts) ? (raw as any).facts : [])
  return arr.map((item: unknown) => ({
    subjectName: clean((item as any)?.subjectName ?? (item as any)?.subject),
    predicate: clean((item as any)?.predicate),
    value: clean((item as any)?.value),
    sourceQuote: clean((item as any)?.sourceQuote ?? (item as any)?.quote) || undefined,
    validFromChapterId: (item as any)?.validFromChapterId ?? null,
    validToChapterId: (item as any)?.validToChapterId ?? null,
  }))
}

async function validChapterId(scope: WorkspaceScope, chapterId: unknown): Promise<number | null> {
  if (chapterId == null) return null
  if (typeof chapterId !== 'number' || !Number.isFinite(chapterId)) return null
  const chapter = await db.chapters.get(chapterId)
  return await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' }) ? chapterId : null
}

async function validRange(scope: WorkspaceScope, from: number | null, to: number | null): Promise<boolean> {
  if (from == null || to == null) return true
  const [outlineNodes, chapters] = await Promise.all([
    readOwnedRows<any>(scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<any>(scope, 'chapters', { owner: 'work' }),
  ])
  const { sequence } = resolveCanonicalChapterSequence(outlineNodes, chapters)
  const orderOf = new Map<number, number>()
  sequence.forEach((entry, index) => {
    if (entry.chapter.id != null) orderOf.set(entry.chapter.id, index)
  })
  const fromOrder = orderOf.get(from)
  const toOrder = orderOf.get(to)
  return fromOrder != null && toOrder != null && fromOrder <= toOrder
}

async function resolveCharacterId(scope: WorkspaceScope, name: string): Promise<number | null> {
  const matches = (await readOwnedRows<any>(scope, 'characters', { owner: 'world' }))
    .filter(character =>
      character.name === name
      && (character.isCrossWorld || character.homeWorldGroupId == null))
  return matches.length === 1 ? matches[0].id ?? null : null
}

function dedupeKey(fact: Pick<TemporalFact, 'subjectName' | 'predicate' | 'value' | 'validFromChapterId'>): string {
  return [fact.subjectName, fact.predicate, fact.value, fact.validFromChapterId ?? ''].join('|')
}

export async function exportFactMemoryMarkdown(projectId: number): Promise<string> {
  const scope = await resolveReadScopeLike(projectId)
  const [project, facts, summaries] = await Promise.all([
    db.projects.get(projectId),
    readOwnedRows<TemporalFact>(scope, 'temporalFacts', { owner: 'work' }),
    readOwnedRows<any>(scope, 'narrativeSummaryNodes', { owner: 'work' }),
  ])
  const lines: string[] = [
    `# StoryForge 事实/派生记忆导出`,
    '',
    `项目：${project?.name ?? `#${projectId}`}`,
    `导出时间：${new Date().toISOString()}`,
    '',
    '## 事实账本 Temporal Facts',
    '',
  ]
  if (!facts.length) {
    lines.push('（无事实记录）', '')
  } else {
    for (const fact of facts.sort((a, b) => (a.status.localeCompare(b.status) || a.subjectName.localeCompare(b.subjectName)))) {
      const spec = getFactPredicate(fact.predicate)
      lines.push(
        `- [${fact.status}] ${fact.subjectName} / ${spec?.label ?? fact.predicate} = ${fact.value}`,
        `  - id: ${fact.id ?? ''}`,
        `  - predicate: ${fact.predicate}`,
        `  - kind: ${fact.factKind}`,
        `  - source: ${fact.sourceType}${fact.sourceChapterId != null ? ` chapter#${fact.sourceChapterId}` : ''}`,
        `  - valid: ${fact.validFromChapterId ?? '起点未知'} → ${fact.validToChapterId ?? '至今'}`,
        fact.sourceQuote ? `  - quote: ${fact.sourceQuote}` : '',
        '',
      )
    }
  }
  lines.push('## 层级叙事摘要 Narrative Summary Tree', '')
  if (!summaries.length) {
    lines.push('（无派生摘要节点）')
  } else {
    for (const node of summaries.sort((a, b) => a.level.localeCompare(b.level) || a.title.localeCompare(b.title))) {
      lines.push(
        `- [${node.status}] ${node.level} · ${node.title}`,
        `  - sourceChapterId: ${node.sourceChapterId ?? ''}`,
        `  - sourceOutlineNodeId: ${node.sourceOutlineNodeId ?? ''}`,
        `  - summary: ${node.summary.replace(/\n/g, ' / ')}`,
        '',
      )
    }
  }
  return lines.filter((line, index, all) => !(line === '' && all[index - 1] === '')).join('\n')
}

export async function importFactCandidateDiff(projectId: number, raw: unknown): Promise<ImportFactCandidateDiffResult> {
  const scope = await resolveScopeLike(projectId)
  const result: ImportFactCandidateDiffResult = { written: 0, skippedInvalid: 0, skippedDuplicate: 0 }
  const rows = normalizeRows(raw)
  const existing = await readOwnedRows<TemporalFact>(scope, 'temporalFacts', { owner: 'work' })
  const seen = new Set(existing.map(dedupeKey))
  for (const row of rows) {
    const spec = getFactPredicate(row.predicate)
    const normalizedValue = spec ? normalizeFactValue(spec, row.value) : null
    if (!row.subjectName || !normalizedValue || !spec) {
      result.skippedInvalid++
      continue
    }
    const validFromChapterId = await validChapterId(scope, row.validFromChapterId)
    const validToChapterId = await validChapterId(scope, row.validToChapterId)
    if (row.validFromChapterId != null && validFromChapterId == null) {
      result.skippedInvalid++
      continue
    }
    if (row.validToChapterId != null && validToChapterId == null) {
      result.skippedInvalid++
      continue
    }
    if (!await validRange(scope, validFromChapterId, validToChapterId)) {
      result.skippedInvalid++
      continue
    }
    const key = dedupeKey({ ...row, value: normalizedValue, validFromChapterId })
    if (seen.has(key)) {
      result.skippedDuplicate++
      continue
    }
    seen.add(key)
    const fact = stampNewRecord(scope, 'temporalFacts', {
      projectId,
      worldGroupId: null,
      characterId: spec.subjectTypes.includes('character') ? await resolveCharacterId(scope, row.subjectName) : null,
      subjectName: row.subjectName,
      predicate: row.predicate,
      factKind: spec.factKind as FactKind,
      value: normalizedValue,
      sourceType: 'import',
      sourceRecordTable: 'human-readable-diff',
      sourceQuote: row.sourceQuote,
      validFromChapterId,
      validToChapterId,
      status: 'candidate',
      locked: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, { owner: 'work' }) as TemporalFact
    await db.temporalFacts.add(fact)
    result.written++
  }
  return result
}
