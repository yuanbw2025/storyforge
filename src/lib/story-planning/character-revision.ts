import { normalizeChapterText } from '../ai/chapter-memory/text-normalization'
import { walkOutlineChaptersInCanonicalOrder } from '../outline/canonical-outline-walk'
import { buildBestChapterByOutlineMap } from '../chapters/selectors'
import {
  isLegacyReadScope,
  readOwnedRows,
  resolveReadScopeLike,
  resolveScopeLike,
  type WorkspaceScopeLike,
} from '../world-engine/scope'
import { adopt } from '../registry/adopt'
import type { Chapter, OutlineNode } from '../types'
import type { WorkspaceScope } from '../types/world-ownership'

export type CharacterRevisionChangeType =
  | 'add-character'
  | 'revise-arc'
  | 'revise-ending'
  | 'remove-or-demote'

export type CharacterRevisionStrategy = 'light' | 'balanced' | 'deep'
export type CharacterRevisionSeverity = 'low' | 'medium' | 'high' | 'critical'

export interface CharacterRevisionScopeInput {
  changeType: CharacterRevisionChangeType
  characterId: number | null
  characterName: string
  changeDescription: string
  protectedThroughOrdinal: number
  transitionChapterCount: number
  strategy: CharacterRevisionStrategy
  anchorNodeIds: number[]
  extraRequirements: string
}

export interface CharacterRevisionChapterSnapshot {
  outlineNodeId: number
  chapterId: number | null
  ordinal: number
  title: string
  summary: string
  volumeTitle: string
  worldGroupId: number | null
  written: boolean
  wordCount: number
  outlineUpdatedAt: number
}

export interface CharacterRevisionSnapshot {
  projectId: number
  workspaceScope?: WorkspaceScope
  chapters: CharacterRevisionChapterSnapshot[]
  lastWrittenOrdinal: number
  lastWrittenChapterId: number | null
  writtenChapterCount: number
  plannedChapterCount: number
  hasChapterMemory: boolean
  anomalies: string[]
}

export interface CharacterRevisionAffectedChapter {
  ordinal: number
  title: string
  severity: CharacterRevisionSeverity
  reason: string
  evidenceQuotes: string[]
  recommendation: 'protect' | 'manual-review' | 'optional-draft'
}

export interface CharacterRevisionFactBoundary {
  statement: string
  sourceChapterOrdinal: number | null
  evidenceQuote: string
}

export interface CharacterRevisionConflict {
  severity: CharacterRevisionSeverity
  source: string
  title: string
  reason: string
  evidenceQuote: string
}

export interface CharacterRevisionForeshadowSuggestion {
  chapterOrdinal: number
  title: string
  suggestion: string
  writtenRegion: boolean
}

export interface CharacterRevisionPatch {
  outlineNodeId: number
  ordinal: number
  title: string
  currentTitle: string
  currentSummary: string
  proposedTitle: string
  proposedSummary: string
  reason: string
  anchorProtected: boolean
}

export interface CharacterRevisionOption {
  id: string
  intensity: CharacterRevisionStrategy
  label: string
  summary: string
  risks: string[]
  patches: CharacterRevisionPatch[]
}

export interface CharacterRevisionPlan {
  changeSummary: string
  scopeSummary: string
  affectedWrittenChapters: CharacterRevisionAffectedChapter[]
  immutableFacts: CharacterRevisionFactBoundary[]
  conflicts: CharacterRevisionConflict[]
  foreshadowSuggestions: CharacterRevisionForeshadowSuggestion[]
  mainPlotSuggestion: string
  options: CharacterRevisionOption[]
  warnings: string[]
}

export interface CharacterRevisionApplyResult {
  appliedOutlineNodeIds: number[]
  skipped: Array<{ outlineNodeId: number; reason: string }>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object'
    ? value as Record<string, unknown>
    : null
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function finiteInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function severity(value: unknown): CharacterRevisionSeverity {
  return ['low', 'medium', 'high', 'critical'].includes(String(value))
    ? value as CharacterRevisionSeverity
    : 'medium'
}

function strategy(value: unknown, index: number): CharacterRevisionStrategy {
  if (value === 'light' || value === 'balanced' || value === 'deep') return value
  return (['light', 'balanced', 'deep'] as const)[Math.min(index, 2)]
}

function findVolumeTitle(node: OutlineNode, nodesById: Map<number, OutlineNode>): string {
  let current: OutlineNode | undefined = node
  const visited = new Set<number>()
  while (current) {
    if (current.type === 'volume') return current.title
    if (current.parentId == null || visited.has(current.parentId)) break
    visited.add(current.parentId)
    current = nodesById.get(current.parentId)
  }
  return '未分卷'
}

export async function buildCharacterRevisionSnapshot(scopeInput: WorkspaceScopeLike): Promise<CharacterRevisionSnapshot> {
  const scope = await resolveReadScopeLike(scopeInput)
  const projectId = typeof scopeInput === 'number' ? scopeInput : scopeInput.projectId
  const [outlineNodes, chapters] = await Promise.all([
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
  ])
  const walk = walkOutlineChaptersInCanonicalOrder(outlineNodes)
  const bestChapterByOutline = buildBestChapterByOutlineMap(chapters)
  const snapshots = walk.chapters.map(item => {
    const chapter = bestChapterByOutline.get(item.outlineNode.id!)
    const body = normalizeChapterText(chapter?.content || '')
    return {
      outlineNodeId: item.outlineNode.id!,
      chapterId: chapter?.id ?? null,
      ordinal: item.ordinal,
      title: item.outlineNode.title,
      summary: item.outlineNode.summary,
      volumeTitle: findVolumeTitle(item.outlineNode, walk.nodeById),
      worldGroupId: item.worldGroupId,
      written: body.length > 0,
      wordCount: Math.max(chapter?.wordCount ?? 0, body.length),
      outlineUpdatedAt: item.outlineNode.updatedAt,
    }
  })
  const written = snapshots.filter(chapter => chapter.written)
  const lastWritten = written.reduce<CharacterRevisionChapterSnapshot | null>(
    (latest, chapter) => !latest || chapter.ordinal > latest.ordinal ? chapter : latest,
    null,
  )
  const chaptersById = new Map(chapters.filter(chapter => chapter.id != null).map(chapter => [chapter.id!, chapter]))
  return {
    projectId,
    ...(!isLegacyReadScope(scope) ? { workspaceScope: scope } : {}),
    chapters: snapshots,
    lastWrittenOrdinal: lastWritten?.ordinal ?? 0,
    lastWrittenChapterId: lastWritten?.chapterId ?? null,
    writtenChapterCount: written.length,
    plannedChapterCount: snapshots.length,
    hasChapterMemory: written.some(item => {
      const chapter = item.chapterId == null ? null : chaptersById.get(item.chapterId)
      return !!(chapter?.summary?.trim() || chapter?.continuityHandoff)
    }),
    anomalies: walk.anomalies.map(item => item.detail),
  }
}

export function effectiveProtectedThrough(
  snapshot: CharacterRevisionSnapshot,
  requested: number,
): number {
  return Math.max(
    snapshot.lastWrittenOrdinal,
    Math.min(snapshot.plannedChapterCount, Math.max(0, Math.floor(requested))),
  )
}

export function formatCharacterRevisionScope(
  snapshot: CharacterRevisionSnapshot,
  input: CharacterRevisionScopeInput,
): string {
  const protectedThrough = effectiveProtectedThrough(snapshot, input.protectedThroughOrdinal)
  const transitionEnd = Math.min(
    snapshot.plannedChapterCount,
    protectedThrough + Math.max(0, Math.floor(input.transitionChapterCount)),
  )
  const anchors = new Set(input.anchorNodeIds)
  const lines = [
    '【角色变更请求与确定性施工边界】',
    `变更类型：${input.changeType}`,
    `目标角色：${input.characterName || '未指定'}`,
    `变更内容：${input.changeDescription.trim()}`,
    `策略偏好：${input.strategy}`,
    `硬保护区：第 1-${protectedThrough || 0} 章；禁止输出可应用 patch`,
    `近期过渡区：第 ${protectedThrough + 1}-${transitionEnd} 章；只允许小修和自然切入`,
    `未写规划区：第 ${transitionEnd + 1}-${snapshot.plannedChapterCount} 章；允许按所选强度重规划`,
    `项目进度：${snapshot.writtenChapterCount} 章有正文 / ${snapshot.plannedChapterCount} 章有大纲`,
    `章节记忆：${snapshot.hasChapterMemory ? '存在' : '缺失；只能依据正文短摘/大纲做有限分析'}`,
  ]
  if (input.extraRequirements.trim()) lines.push(`作者附加要求：${input.extraRequirements.trim()}`)
  lines.push('【规范章序与可引用 outlineNodeId】')
  for (const chapter of snapshot.chapters) {
    const region = chapter.ordinal <= protectedThrough
      ? '已写保护区'
      : chapter.ordinal <= transitionEnd ? '近期过渡区' : '未写规划区'
    const flags = [
      region,
      chapter.written ? '有正文-绝不可写回' : '无正文',
      anchors.has(chapter.outlineNodeId) ? '必保留锚点' : '',
    ].filter(Boolean).join('｜')
    lines.push(
      `- 第${chapter.ordinal}章 [node:${chapter.outlineNodeId}] ${chapter.volumeTitle} / ${chapter.title}（${flags}）`
      + `${chapter.summary ? `：${chapter.summary}` : ''}`,
    )
  }
  if (snapshot.anomalies.length) {
    lines.push(`章序异常（谨慎处理）：${snapshot.anomalies.join('；')}`)
  }
  return lines.join('\n')
}

function parseAffected(value: unknown): CharacterRevisionAffectedChapter[] {
  return array(value).flatMap(item => {
    const row = asRecord(item)
    const ordinal = finiteInteger(row?.ordinal)
    if (!row || ordinal == null || ordinal < 1) return []
    return [{
      ordinal,
      title: text(row.title) || `第${ordinal}章`,
      severity: severity(row.severity),
      reason: text(row.reason),
      evidenceQuotes: array(row.evidenceQuotes).map(text).filter(Boolean),
      recommendation: row.recommendation === 'protect'
        || row.recommendation === 'optional-draft'
        ? row.recommendation
        : 'manual-review',
    }]
  })
}

function parseFacts(value: unknown): CharacterRevisionFactBoundary[] {
  return array(value).flatMap(item => {
    const row = asRecord(item)
    if (!row || !text(row.statement)) return []
    const ordinal = finiteInteger(row.sourceChapterOrdinal)
    return [{
      statement: text(row.statement),
      sourceChapterOrdinal: ordinal != null && ordinal > 0 ? ordinal : null,
      evidenceQuote: text(row.evidenceQuote),
    }]
  })
}

function parseConflicts(value: unknown): CharacterRevisionConflict[] {
  return array(value).flatMap(item => {
    const row = asRecord(item)
    if (!row || !text(row.reason)) return []
    return [{
      severity: severity(row.severity),
      source: text(row.source) || '未标注来源',
      title: text(row.title) || '未命名冲突',
      reason: text(row.reason),
      evidenceQuote: text(row.evidenceQuote),
    }]
  })
}

function parseForeshadows(value: unknown, protectedThrough: number): CharacterRevisionForeshadowSuggestion[] {
  return array(value).flatMap(item => {
    const row = asRecord(item)
    const ordinal = finiteInteger(row?.chapterOrdinal)
    if (!row || ordinal == null || ordinal < 1 || !text(row.suggestion)) return []
    return [{
      chapterOrdinal: ordinal,
      title: text(row.title) || `第${ordinal}章`,
      suggestion: text(row.suggestion),
      writtenRegion: ordinal <= protectedThrough,
    }]
  })
}

function parsePatches(
  value: unknown,
  snapshot: CharacterRevisionSnapshot,
  protectedThrough: number,
  anchorIds: Set<number>,
  warnings: string[],
): CharacterRevisionPatch[] {
  const chaptersByNode = new Map(snapshot.chapters.map(chapter => [chapter.outlineNodeId, chapter]))
  const seen = new Set<number>()
  return array(value).flatMap(item => {
    const row = asRecord(item)
    const nodeId = finiteInteger(row?.outlineNodeId)
    const chapter = nodeId == null ? null : chaptersByNode.get(nodeId)
    if (!row || nodeId == null || !chapter) {
      warnings.push(`已拒绝未知大纲节点 patch：${nodeId ?? '?'}`)
      return []
    }
    if (seen.has(nodeId)) {
      warnings.push(`已拒绝重复大纲节点 patch：#${nodeId}`)
      return []
    }
    if (chapter.written || chapter.ordinal <= protectedThrough) {
      warnings.push(`已拒绝第 ${chapter.ordinal} 章 patch：属于已写保护区`)
      return []
    }
    const proposedTitle = text(row.proposedTitle) || chapter.title
    const proposedSummary = text(row.proposedSummary) || chapter.summary
    const anchorProtected = anchorIds.has(nodeId)
    if (anchorProtected && proposedTitle !== chapter.title) {
      warnings.push(`已拒绝锚点「${chapter.title}」改名：锚点标题必须保留`)
      return []
    }
    if (proposedTitle === chapter.title && proposedSummary === chapter.summary) return []
    seen.add(nodeId)
    return [{
      outlineNodeId: nodeId,
      ordinal: chapter.ordinal,
      title: chapter.title,
      currentTitle: chapter.title,
      currentSummary: chapter.summary,
      proposedTitle,
      proposedSummary,
      reason: text(row.reason),
      anchorProtected,
    }]
  })
}

/**
 * 把 AI JSON 收紧为可预览计划。未知 ID、已写章、保护区与锚点改名在解析边界直接拒绝，
 * 但会保留 warning 告诉作者发生了什么。
 */
export function parseCharacterRevisionOutput(
  raw: string,
  snapshot: CharacterRevisionSnapshot,
  input: CharacterRevisionScopeInput,
): CharacterRevisionPlan | null {
  const match = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  const source = match?.[1]?.trim() || raw.trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return null
  }
  const root = asRecord(parsed)
  if (!root) return null
  const protectedThrough = effectiveProtectedThrough(snapshot, input.protectedThroughOrdinal)
  const anchorIds = new Set(input.anchorNodeIds)
  const warnings = array(root.warnings).map(text).filter(Boolean)
  const options = array(root.options).flatMap((item, index) => {
    const row = asRecord(item)
    if (!row) return []
    const intensity = strategy(row.intensity, index)
    return [{
      id: text(row.id) || intensity,
      intensity,
      label: text(row.label) || ({ light: '轻量融入', balanced: '中度改线', deep: '深度重构' }[intensity]),
      summary: text(row.summary),
      risks: array(row.risks).map(text).filter(Boolean),
      patches: parsePatches(row.patches, snapshot, protectedThrough, anchorIds, warnings),
    }]
  }).slice(0, 3)
  if (options.length < 3) warnings.push(`AI 只返回 ${options.length} 档方案；应返回轻量、中度、深度三档`)
  if (!snapshot.hasChapterMemory) {
    warnings.push('缺少可用章节记忆：本次只能做大纲级重规划，正文影响结论需人工复核')
  }
  return {
    changeSummary: text(root.changeSummary),
    scopeSummary: text(root.scopeSummary),
    affectedWrittenChapters: parseAffected(root.affectedWrittenChapters),
    immutableFacts: parseFacts(root.immutableFacts),
    conflicts: parseConflicts(root.conflicts),
    foreshadowSuggestions: parseForeshadows(root.foreshadowSuggestions, protectedThrough),
    mainPlotSuggestion: text(root.mainPlotSuggestion),
    options,
    warnings: [...new Set(warnings)],
  }
}

/**
 * 应用前重新读取项目现状，防止分析后作者又编辑了大纲。这里只允许改无正文的未来章，
 * 所有字段写入继续经过 adopt()/FIELD_REGISTRY。
 */
export async function applyCharacterRevisionPatches(input: {
  projectId: number
  scope?: WorkspaceScope
  protectedThroughOrdinal: number
  anchorNodeIds: number[]
  patches: CharacterRevisionPatch[]
}): Promise<CharacterRevisionApplyResult> {
  const scope = await resolveScopeLike(input.scope ?? input.projectId)
  const fresh = await buildCharacterRevisionSnapshot(scope)
  const protectedThrough = effectiveProtectedThrough(fresh, input.protectedThroughOrdinal)
  const currentByNode = new Map(fresh.chapters.map(chapter => [chapter.outlineNodeId, chapter]))
  const anchors = new Set(input.anchorNodeIds)
  const result: CharacterRevisionApplyResult = { appliedOutlineNodeIds: [], skipped: [] }

  for (const patch of input.patches) {
    const current = currentByNode.get(patch.outlineNodeId)
    if (!current) {
      result.skipped.push({ outlineNodeId: patch.outlineNodeId, reason: '节点已删除或不属于当前项目' })
      continue
    }
    if (current.written || current.ordinal <= protectedThrough) {
      result.skipped.push({ outlineNodeId: patch.outlineNodeId, reason: '节点已进入正文保护区' })
      continue
    }
    if (current.title !== patch.currentTitle || current.summary !== patch.currentSummary) {
      result.skipped.push({ outlineNodeId: patch.outlineNodeId, reason: '分析后大纲已变化，请重新分析' })
      continue
    }
    if (anchors.has(patch.outlineNodeId) && patch.proposedTitle !== current.title) {
      result.skipped.push({ outlineNodeId: patch.outlineNodeId, reason: '锚点标题受保护' })
      continue
    }

    const outlineWrite = await adopt({
      projectId: input.projectId,
      scope,
      worldGroupId: current.worldGroupId,
      target: 'outlineNodes',
      recordId: patch.outlineNodeId,
      mode: 'replace',
      data: {
        title: patch.proposedTitle,
        summary: patch.proposedSummary,
      },
    })
    if (!outlineWrite.written.length) {
      result.skipped.push({ outlineNodeId: patch.outlineNodeId, reason: '统一写回层拒绝了该 patch' })
      continue
    }

    // 历史上“仅大纲”章可能已有空 Chapter 行；标题也经 adopt() 同步，正文始终不写。
    if (current.chapterId != null && patch.proposedTitle !== current.title) {
      await adopt({
        projectId: input.projectId,
        scope,
        target: 'chapters',
        recordId: current.chapterId,
        mode: 'replace',
        data: { title: patch.proposedTitle },
      })
    }
    result.appliedOutlineNodeIds.push(patch.outlineNodeId)
  }
  return result
}
