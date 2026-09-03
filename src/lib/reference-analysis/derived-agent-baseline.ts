import type {
  AnalysisDimension,
  Reference,
  ReferenceAnalysisRun,
  ReferenceChunkAnalysis,
  WorkspaceScope,
} from '../types'
import { readOwnedRows } from '../workspace/scope'
import {
  collectCharacterCraftTexts,
  mergeAnalysisResults,
} from './merge-analysis'

export type ReferenceDerivedModeV1 = 'summary' | 'characters'

export interface ReferenceDerivedReferenceSnapshotV1 {
  id: number
  projectId: number
  workId: number | null
  title: string
  author: string
  type: Reference['type']
}

export interface ReferenceDerivedRunSnapshotV1 {
  id: number
  projectId: number
  workId: number | null
  referenceId: number
  version: number
  status: ReferenceAnalysisRun['status']
  depth: ReferenceAnalysisRun['depth']
  sourceFilename: string
  fileHash: string
  totalChars: number
  sourceKind: ReferenceAnalysisRun['sourceKind']
  usageScope: ReferenceAnalysisRun['usageScope']
  rightsNote: string
  rightsConfirmed: boolean
  rightsDeclaredAt: number
  expectedChunks: number
  completedChunks: number
  progress: number
  completedAt: number | null
  activatedAt: number | null
}

export interface ReferenceDerivedOutputSnapshotV1 {
  field: 'analysisSummary' | 'mergedCharacters'
  runPresent: boolean
  runValue: string | null
  referencePresent: boolean
  referenceValue: string | null
}

export interface ReferenceSummaryInputV1 {
  kind: 'summary'
  dimensions: Array<{
    dimension: AnalysisDimension
    label: string
    samples: string[]
  }>
}

export interface ReferenceCharacterInputV1 {
  kind: 'characters'
  craftTexts: string[]
}

export interface ReferenceDerivedBaselineV1 {
  version: 1
  mode: ReferenceDerivedModeV1
  reference: ReferenceDerivedReferenceSnapshotV1
  run: ReferenceDerivedRunSnapshotV1
  input: ReferenceSummaryInputV1 | ReferenceCharacterInputV1
  output: ReferenceDerivedOutputSnapshotV1
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function snapshotOutput(
  mode: ReferenceDerivedModeV1,
  reference: Reference,
  run: ReferenceAnalysisRun,
): ReferenceDerivedOutputSnapshotV1 {
  const field = mode === 'summary' ? 'analysisSummary' : 'mergedCharacters'
  return {
    field,
    runPresent: Object.prototype.hasOwnProperty.call(run, field),
    runValue: nullableText(run[field]),
    referencePresent: Object.prototype.hasOwnProperty.call(reference, field),
    referenceValue: nullableText(reference[field]),
  }
}

function summaryInput(
  chunks: ReferenceChunkAnalysis[],
  isHistorical: boolean,
): ReferenceSummaryInputV1 {
  const merged = mergeAnalysisResults(chunks, isHistorical)
  return {
    kind: 'summary',
    dimensions: merged.dimensions
      .filter(dimension => dimension.items.length > 0)
      .map(dimension => ({
        dimension: dimension.dimension,
        label: dimension.label,
        samples: dimension.items.slice(0, 3).map(item => item.text.slice(0, 200)),
      })),
  }
}

export async function readReferenceDerivedBaselineV1(input: {
  scope: WorkspaceScope
  runId: number
  mode: ReferenceDerivedModeV1
}): Promise<ReferenceDerivedBaselineV1> {
  if (!Number.isInteger(input.runId) || input.runId <= 0) throw new Error('参考派生 Agent 版本 ID 无效。')
  const [references, runs, chunks] = await Promise.all([
    readOwnedRows<Reference>(input.scope, 'references', { owner: 'work' }),
    readOwnedRows<ReferenceAnalysisRun>(input.scope, 'referenceAnalysisRuns', { owner: 'work' }),
    readOwnedRows<ReferenceChunkAnalysis>(input.scope, 'referenceChunkAnalysis', { owner: 'work' }),
  ])
  const run = runs.find(row => row.id === input.runId)
  if (!run?.id || !['ready', 'active', 'superseded'].includes(run.status)) {
    throw new Error('参考分析版本不存在、未完成或不属于当前 Work。')
  }
  const reference = references.find(row => row.id === run.referenceId)
  if (!reference?.id) throw new Error('参考分析版本的来源资料不存在或不属于当前 Work。')
  const runChunks = chunks
    .filter(row => row.analysisRunId === run.id && row.referenceId === reference.id)
    .sort((left, right) => left.chunkIndex - right.chunkIndex)
  if (!runChunks.length) throw new Error('参考分析版本没有可用分块结果。')
  const derivedInput = input.mode === 'summary'
    ? summaryInput(runChunks, reference.type === 'historical')
    : { kind: 'characters' as const, craftTexts: collectCharacterCraftTexts(runChunks) }
  if (input.mode === 'summary' && derivedInput.kind === 'summary' && !derivedInput.dimensions.length) {
    throw new Error('参考分析版本没有可总结的维度。')
  }
  if (input.mode === 'characters' && derivedInput.kind === 'characters' && !derivedInput.craftTexts.length) {
    throw new Error('参考分析版本没有人物塑造分析可供整理。')
  }
  return {
    version: 1,
    mode: input.mode,
    reference: {
      id: reference.id,
      projectId: reference.projectId,
      workId: reference.workId ?? null,
      title: reference.title,
      author: reference.author,
      type: reference.type,
    },
    run: {
      id: run.id,
      projectId: run.projectId,
      workId: run.workId ?? null,
      referenceId: run.referenceId,
      version: run.version,
      status: run.status,
      depth: run.depth,
      sourceFilename: run.sourceFilename,
      fileHash: run.fileHash,
      totalChars: run.totalChars,
      sourceKind: run.sourceKind,
      usageScope: run.usageScope,
      rightsNote: text(run.rightsNote),
      rightsConfirmed: run.rightsConfirmed,
      rightsDeclaredAt: run.rightsDeclaredAt,
      expectedChunks: run.expectedChunks,
      completedChunks: run.completedChunks,
      progress: run.progress,
      completedAt: typeof run.completedAt === 'number' ? run.completedAt : null,
      activatedAt: typeof run.activatedAt === 'number' ? run.activatedAt : null,
    },
    input: derivedInput,
    output: snapshotOutput(input.mode, reference, run),
  }
}

function sourceStatement(baseline: ReferenceDerivedBaselineV1): string[] {
  const run = baseline.run
  return [
    `作品：${baseline.reference.title}`,
    `作者：${baseline.reference.author || '未知'}`,
    `资料类型：${baseline.reference.type}`,
    `分析版本：v${run.version} / ${run.status} / ${run.depth}`,
    `来源文件：${run.sourceFilename}`,
    `来源哈希：${run.fileHash}`,
    `来源声明：${run.sourceKind} / ${run.usageScope} / ${run.rightsConfirmed ? '已确认' : '未确认'}`,
    `声明备注：${run.rightsNote || '无'}`,
  ]
}

/** Exact registered model input. Existing AI-derived outputs are deliberately excluded. */
export function formatReferenceDerivedBaselineV1(baseline: ReferenceDerivedBaselineV1): string {
  const body = baseline.input.kind === 'summary'
    ? baseline.input.dimensions.flatMap(dimension => [
        `【${dimension.label} / ${dimension.dimension}】`,
        ...dimension.samples.map((sample, index) => `样本 ${index + 1}：${sample}`),
        '',
      ])
    : baseline.input.craftTexts.flatMap((craft, index) => [
        `【人物塑造分析 ${index + 1}】`,
        craft,
        '',
      ])
  return [
    '【参考分析派生 Agent 正式输入基线】',
    `任务：${baseline.mode === 'summary' ? '生成全书分析总结' : '聚合去重角色卡'}`,
    ...sourceStatement(baseline),
    '',
    ...body,
  ].join('\n').trimEnd()
}

export async function readReferenceDerivedBaselineContextV1(input: {
  scope: WorkspaceScope
  runId: number
  mode: ReferenceDerivedModeV1
}): Promise<string> {
  return formatReferenceDerivedBaselineV1(await readReferenceDerivedBaselineV1(input))
}
