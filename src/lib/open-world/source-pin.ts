import { db } from '../db/schema'
import { resolveCanonicalChapterSequence } from '../ai/chapter-memory/canonical-chapter-sequence'
import { byOutlineOrderThenId } from '../outline/canonical-outline-walk'
import {
  acceptTextOpenWorldSourcePinBundleArtifactsV1,
  readAcceptedBuildArtifacts,
} from '../product-production/artifact-store'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
  isSha256Hash,
} from '../product-production/hash'
import { TEXT_OPEN_WORLD_SOURCE_PIN_LIMITS_V1 } from './source-pin-contract'
import { openWorldSemanticResourceCatalogV1 } from '../context-gateway/world-release-client'
import {
  listWorldReferenceCatalogV1,
  portableWorldReferenceV1,
  validatePortableWorldReferenceV1,
} from '../world-engine/world-reference'
import { countWords, htmlToPlainText } from '../utils/html'
import { effectiveWorkKind } from '../workspace/work-kind'
import { WORLD_CAPABILITY_AREAS } from '../registry/types'
import {
  assertRecordInScope,
  getTableSpec,
  readOwnedRows,
  resolveScope,
} from '../workspace/scope'
import type {
  AdaptationSourceSelectionV1,
  Chapter,
  OutlineNode,
  ProductBuildArtifactRecordV1,
  StoryCore,
  TextOpenWorldSourceAuthorizationV1,
  TextOpenWorldSourceKindV1,
  TextOpenWorldSourcePermissionV1,
  TextOpenWorldSourcePinBundleV1,
  TextOpenWorldSourcePinSourceV1,
  TextOpenWorldSourcePinUnitKindV1,
  TextOpenWorldSourcePinUnitRefV1,
  TextOpenWorldSourcePinUnitV1,
  TextOpenWorldSourcePinV1,
  TextOpenWorldSourceRightsBasisV1,
  TextOpenWorldNovelSourceSnapshotPreviewV1,
  WorkspaceScope,
  WorldReferenceV1,
} from '../types'

const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const MAX_SOURCE_UNIT_CHARS = 200_000
const MAX_SOURCE_UNITS = TEXT_OPEN_WORLD_SOURCE_PIN_LIMITS_V1.maximumUnits
const MAX_SOURCE_TOTAL_CHARS = TEXT_OPEN_WORLD_SOURCE_PIN_LIMITS_V1.maximumTotalChars
const WORLD_PERMISSIONS: TextOpenWorldSourcePermissionV1[] = [
  'derive-text-open-world',
  'read-world-release-catalog',
  'read-world-release-original',
]
const NOVEL_PERMISSIONS: TextOpenWorldSourcePermissionV1[] = [
  'derive-text-open-world',
  'freeze-product-private-novel',
  'read-frozen-novel',
]

export interface TextOpenWorldSourceAuthorizationInputV1 {
  productInstanceKey: string
  briefRevision: number
  briefHash: string
  authorStartRevision: number
  authorizationNonce: string
  rightsBasis: TextOpenWorldSourceRightsBasisV1
  rightsNote?: string
  authorizedAt: number
}

export type TextOpenWorldWorldSourceSelectionV1 =
  | { mode: 'entire-release' }
  | { mode: 'selected-resources'; resourceKeys: string[] }

interface NovelSourceTextUnitV1 {
  kind: Exclude<TextOpenWorldSourcePinUnitKindV1, 'world-resource'>
  label: string
  text: string
}

type SourceUnitIdentityInputV1 = Pick<
  TextOpenWorldSourcePinUnitRefV1,
  | 'unitKey'
  | 'kind'
  | 'order'
  | 'partIndex'
  | 'partCount'
  | 'readDepth'
  | 'sourceResourceKey'
  | 'sourceArea'
  | 'sourceResourceKind'
  | 'label'
  | 'sourceContentHash'
  | 'charCount'
  | 'wordCount'
>

interface PreparedNovelSourceChunkV1 extends SourceUnitIdentityInputV1 {
  label: string
  contentText: string
  charCount: number
  wordCount: number
}

interface PreparedNovelSourceSnapshotInternalV1 {
  scope: WorkspaceScope
  source: Extract<TextOpenWorldSourcePinSourceV1, { kind: 'novel' }>
  sourceVersionHash: string
  sourceBoundaryHash: string
  chunks: PreparedNovelSourceChunkV1[]
  preview: TextOpenWorldNovelSourceSnapshotPreviewV1
}

export interface TextOpenWorldNovelSourceCasWitnessV1 {
  schema: 'storyforge.text-open-world-novel-source-cas-witness'
  version: 1
  projectId: number
  worldId: number
  workId: number
  selectionJson: string
  sourceVersionHash: string
  sourceBoundaryHash: string
  /** Ephemeral, process-local proof. It is never persisted or exposed to UI. */
  rawReadSetJson: string
}

function fail(message: string): never {
  throw new Error(`[text-open-world-source-pin] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} 字段不精确`)
  }
}

function stableKey(value: string, label: string): string {
  const normalized = value.trim()
  if (!STABLE_KEY.test(normalized)) fail(`${label} 不是稳定 key`)
  return normalized
}

function nonEmptyText(value: string, label: string, maximum = 10_000): string {
  const normalized = value.trim().normalize('NFC')
  if (!normalized || normalized.length > maximum) fail(`${label} 为空或过长`)
  return normalized
}

function timestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} 不是合法时间`)
  return value
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} 必须是正整数`)
  return value
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

function expectedPermissions(kind: TextOpenWorldSourceKindV1): TextOpenWorldSourcePermissionV1[] {
  return kind === 'world-release' ? [...WORLD_PERMISSIONS] : [...NOVEL_PERMISSIONS]
}

function splitSourceText(value: string): string[] {
  const text = value.trim().normalize('NFC')
  if (!text) return []
  const parts: string[] = []
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(text.length, offset + MAX_SOURCE_UNIT_CHARS)
    const code = text.charCodeAt(end - 1)
    if (end < text.length && code >= 0xD800 && code <= 0xDBFF) end -= 1
    parts.push(text.slice(offset, end))
    offset = end
  }
  return parts
}

function sourceUnitArtifactKey(order: number): string {
  return order === 0
    ? 'text-open-world.source-pin-unit'
    : `text-open-world.source-pin-unit.${String(order + 1).padStart(5, '0')}`
}

function unitRef(
  payload: TextOpenWorldSourcePinUnitV1,
  artifactContentHash: string,
): TextOpenWorldSourcePinUnitRefV1 {
  return {
    unitKey: payload.unitKey,
    artifactKey: payload.artifactKey,
    artifactContentHash,
    kind: payload.kind,
    label: payload.label,
    order: payload.order,
    partIndex: payload.partIndex,
    partCount: payload.partCount,
    readDepth: payload.readDepth,
    sourceResourceKey: payload.sourceResourceKey,
    sourceArea: payload.sourceArea,
    sourceResourceKind: payload.sourceResourceKind,
    sourceContentHash: payload.sourceContentHash,
    charCount: payload.charCount,
    wordCount: payload.wordCount,
  }
}

function sourceUnitIdentity(ref: SourceUnitIdentityInputV1): unknown {
  return {
    unitKey: ref.unitKey,
    kind: ref.kind,
    order: ref.order,
    partIndex: ref.partIndex,
    partCount: ref.partCount,
    readDepth: ref.readDepth,
    sourceResourceKey: ref.sourceResourceKey,
    sourceArea: ref.sourceArea,
    sourceResourceKind: ref.sourceResourceKind,
    label: ref.label,
    sourceContentHash: ref.sourceContentHash,
    charCount: ref.charCount,
    wordCount: ref.wordCount,
  }
}

async function sourceBoundaryHash(input: {
  sourceVersionHash: string
  source: TextOpenWorldSourcePinSourceV1
  units: readonly SourceUnitIdentityInputV1[]
}): Promise<string> {
  return hashProductProductionValueV2({
    sourceVersionHash: input.sourceVersionHash,
    source: input.source,
    units: input.units.map(sourceUnitIdentity),
  })
}

async function readEvidenceHash(input: TextOpenWorldSourcePinV1['readEvidence'], units: TextOpenWorldSourcePinUnitRefV1[]): Promise<string> {
  return hashProductProductionValueV2({
    method: input.method,
    readDepth: input.readDepth,
    unitCount: input.unitCount,
    totalChars: input.totalChars,
    totalWords: input.totalWords,
    capturedAt: input.capturedAt,
    units: units.map(sourceUnitIdentity),
  })
}

async function createAuthorization(input: {
  sourceKind: TextOpenWorldSourceKindV1
  sourceVersionHash: string
  sourceBoundaryHash: string
  authorization: TextOpenWorldSourceAuthorizationInputV1
}): Promise<TextOpenWorldSourceAuthorizationV1> {
  const productInstanceKey = stableKey(input.authorization.productInstanceKey, 'productInstanceKey')
  positiveInteger(input.authorization.briefRevision, 'briefRevision')
  positiveInteger(input.authorization.authorStartRevision, 'authorStartRevision')
  if (!isSha256Hash(input.authorization.briefHash)) fail('briefHash 必须是 SHA-256')
  const nonce = nonEmptyText(input.authorization.authorizationNonce, 'authorizationNonce', 500)
  if (!['author-owned', 'licensed', 'public-domain'].includes(input.authorization.rightsBasis)) {
    fail('rightsBasis 未被允许')
  }
  const rightsNote = (input.authorization.rightsNote ?? '').trim().normalize('NFC')
  if (rightsNote.length > 2_000) fail('rightsNote 过长')
  const authorizedAt = timestamp(input.authorization.authorizedAt, 'authorizedAt')
  const authorizationNonceHash = await hashProductProductionValueV2({
    nonce,
    productInstanceKey,
    sourceKind: input.sourceKind,
    sourceVersionHash: input.sourceVersionHash,
    sourceBoundaryHash: input.sourceBoundaryHash,
    briefRevision: input.authorization.briefRevision,
    authorStartRevision: input.authorization.authorStartRevision,
  })
  const body: Omit<TextOpenWorldSourceAuthorizationV1, 'authorizationHash'> = {
    schema: 'storyforge.text-open-world-source-authorization',
    version: 1,
    productInstanceKey,
    sourceKind: input.sourceKind,
    sourceVersionHash: input.sourceVersionHash,
    sourceBoundaryHash: input.sourceBoundaryHash,
    briefRevision: input.authorization.briefRevision,
    briefHash: input.authorization.briefHash,
    authorStartRevision: input.authorization.authorStartRevision,
    authorizationNonceHash,
    rightsBasis: input.authorization.rightsBasis,
    rightsNote,
    permissions: expectedPermissions(input.sourceKind),
    authorizedAt,
  }
  return { ...body, authorizationHash: await hashProductProductionValueV2(body) }
}

async function createPin(input: {
  productInstanceKey: string
  sourceVersionHash: string
  sourceBoundaryHash: string
  source: TextOpenWorldSourcePinSourceV1
  units: TextOpenWorldSourcePinBundleV1['units']
  authorization: TextOpenWorldSourceAuthorizationV1
  method: TextOpenWorldSourcePinV1['readEvidence']['method']
  readDepth: TextOpenWorldSourcePinV1['readEvidence']['readDepth']
  createdAt: number
}): Promise<TextOpenWorldSourcePinV1> {
  const refs = input.units.map(item => unitRef(item.payload, item.artifactContentHash))
  const totals = refs.reduce((result, item) => ({
    chars: result.chars + item.charCount,
    words: result.words + item.wordCount,
  }), { chars: 0, words: 0 })
  const evidenceBase: Omit<TextOpenWorldSourcePinV1['readEvidence'], 'evidenceHash'> = {
    method: input.method,
    readDepth: input.readDepth,
    unitCount: refs.length,
    totalChars: totals.chars,
    totalWords: totals.words,
    capturedAt: input.createdAt,
  }
  const readEvidence = {
    ...evidenceBase,
    evidenceHash: await readEvidenceHash({ ...evidenceBase, evidenceHash: '' }, refs),
  }
  const body: Omit<TextOpenWorldSourcePinV1, 'pinHash'> = {
    schema: 'storyforge.text-open-world-source-pin',
    version: 1,
    canonicalJsonVersion: 2,
    productType: 'text-open-world',
    productInstanceKey: input.productInstanceKey,
    sourceKind: input.source.kind,
    sourceVersionHash: input.sourceVersionHash,
    sourceBoundaryHash: input.sourceBoundaryHash,
    source: input.source,
    authorization: input.authorization,
    units: refs,
    readEvidence,
    createdAt: input.createdAt,
  }
  return { ...body, pinHash: await hashProductProductionValueV2(body) }
}

function orderedOutlineNodes(nodes: OutlineNode[]): OutlineNode[] {
  const byId = new Map(nodes.flatMap(node => node.id == null ? [] : [[node.id, node]]))
  const children = new Map<number | null, OutlineNode[]>()
  for (const node of nodes) {
    if (node.id == null) fail('小说大纲存在无 ID 节点')
    const parent = node.parentId != null && byId.has(node.parentId) ? node.parentId : null
    const list = children.get(parent) ?? []
    list.push(node)
    children.set(parent, list)
  }
  for (const rows of children.values()) rows.sort(byOutlineOrderThenId)
  const ordered: OutlineNode[] = []
  const visiting = new Set<number>()
  const visited = new Set<number>()
  const walk = (node: OutlineNode) => {
    if (node.id == null) return
    if (visiting.has(node.id)) fail('小说大纲存在循环')
    if (visited.has(node.id)) return
    visiting.add(node.id)
    ordered.push(node)
    for (const child of children.get(node.id) ?? []) walk(child)
    visiting.delete(node.id)
    visited.add(node.id)
  }
  for (const root of children.get(null) ?? []) walk(root)
  for (const node of [...nodes].sort(byOutlineOrderThenId)) if (node.id != null && !visited.has(node.id)) walk(node)
  return ordered
}

function descendants(rootId: number, nodes: OutlineNode[]): Set<number> {
  const byId = new Map(nodes.flatMap(node => node.id == null ? [] : [[node.id, node]]))
  if (!byId.has(rootId)) fail('小说来源大纲子树根不存在')
  const children = new Map<number, number[]>()
  for (const node of nodes) {
    if (node.id == null || node.parentId == null) continue
    const list = children.get(node.parentId) ?? []
    list.push(node.id)
    children.set(node.parentId, list)
  }
  const output = new Set<number>()
  const visiting = new Set<number>()
  const walk = (id: number) => {
    if (visiting.has(id)) fail('小说大纲存在循环')
    if (output.has(id)) return
    visiting.add(id)
    output.add(id)
    for (const child of children.get(id) ?? []) walk(child)
    visiting.delete(id)
  }
  walk(rootId)
  return output
}

function selectedNovelRows(input: {
  selection: AdaptationSourceSelectionV1
  outlines: OutlineNode[]
  chapters: Chapter[]
}): { outlines: OutlineNode[]; chapters: Chapter[]; label: string } {
  const canonical = resolveCanonicalChapterSequence(input.outlines, input.chapters)
  if (canonical.anomalies.some(item => item.kind === 'outline-cycle')) fail('小说大纲存在循环')
  if (canonical.anomalies.some(item => item.kind === 'duplicate-chapter-mapping')) {
    fail('同一大纲节点绑定多个章节，必须先整理小说章序')
  }
  const ordered = orderedOutlineNodes(input.outlines)
  const chapterIds = canonical.sequence.flatMap(item => item.chapter.id == null ? [] : [item.chapter.id])
  let selectedChapterIds: number[]
  let selectedOutlineIds: Set<number>
  let label: string
  if (input.selection.mode === 'entire-work') {
    selectedChapterIds = chapterIds
    selectedOutlineIds = new Set(ordered.map(item => item.id!))
    label = '整部小说'
  } else if (input.selection.mode === 'outline-subtree') {
    const rootId = input.selection.outlineNodeId
    selectedOutlineIds = descendants(rootId, input.outlines)
    selectedChapterIds = canonical.sequence
      .filter(item => item.outlineNode?.id != null && selectedOutlineIds.has(item.outlineNode.id))
      .map(item => item.chapter.id!)
    label = `大纲子树：${input.outlines.find(item => item.id === rootId)!.title}`
  } else if (input.selection.mode === 'chapter-range') {
    const start = chapterIds.indexOf(input.selection.startChapterId)
    const end = chapterIds.indexOf(input.selection.endChapterId)
    if (start < 0 || end < 0 || start > end) fail('小说章节范围不存在或顺序非法')
    selectedChapterIds = chapterIds.slice(start, end + 1)
    selectedOutlineIds = new Set()
    label = `章节范围：${start + 1}-${end + 1}`
  } else {
    if (!input.selection.chapterIds.length
      || new Set(input.selection.chapterIds).size !== input.selection.chapterIds.length) {
      fail('小说章节选择为空或重复')
    }
    const requested = new Set(input.selection.chapterIds)
    selectedChapterIds = chapterIds.filter(id => requested.has(id))
    if (selectedChapterIds.length !== requested.size) fail('小说章节选择包含越界 ID')
    selectedOutlineIds = new Set()
    label = `指定章节：${selectedChapterIds.length}章`
  }
  const chapterSet = new Set(selectedChapterIds)
  const outlineById = new Map(input.outlines.flatMap(item => item.id == null ? [] : [[item.id, item]]))
  for (const entry of canonical.sequence) {
    if (entry.chapter.id == null || !chapterSet.has(entry.chapter.id)) continue
    let outlineId: number | null = entry.outlineNode?.id ?? null
    const visited = new Set<number>()
    while (outlineId != null && !visited.has(outlineId)) {
      visited.add(outlineId)
      selectedOutlineIds.add(outlineId)
      outlineId = outlineById.get(outlineId)?.parentId ?? null
    }
  }
  return {
    outlines: ordered.filter(item => selectedOutlineIds.has(item.id!)),
    chapters: canonical.sequence
      .filter(item => item.chapter.id != null && chapterSet.has(item.chapter.id))
      .map(item => item.chapter),
    label,
  }
}

function novelTextUnits(input: {
  title: string
  description: string
  genres: string[]
  storyCores: StoryCore[]
  outlines: OutlineNode[]
  chapters: Chapter[]
}): NovelSourceTextUnitV1[] {
  const units: NovelSourceTextUnitV1[] = [{
    kind: 'work-metadata',
    label: input.title,
    text: [
      '# 作品',
      `标题：${input.title}`,
      input.description ? `简介：${input.description}` : '',
      input.genres.length ? `题材：${input.genres.join('、')}` : '',
    ].filter(Boolean).join('\n'),
  }]
  for (const [index, core] of [...input.storyCores]
    .sort((left, right) => (left.id ?? 0) - (right.id ?? 0)).entries()) {
    units.push({
      kind: 'story-core',
      label: core.logline?.trim() || `故事核心${index + 1}`,
      text: [
        '# 故事核心',
        core.logline ? `一句话故事：${core.logline}` : '',
        `主题：${core.theme}`,
        `核心冲突：${core.centralConflict}`,
        `情节模式：${core.plotPattern}`,
        core.concept ? `概念：${core.concept}` : '',
        core.mainPlot ? `主线：${core.mainPlot}` : '',
        core.subPlots ? `支线：${core.subPlots}` : '',
      ].filter(Boolean).join('\n'),
    })
  }
  for (const outline of input.outlines) {
    units.push({
      kind: 'outline-node',
      label: outline.title,
      text: ['# 大纲节点', `类型：${outline.type}`, `标题：${outline.title}`, outline.summary]
        .filter(Boolean).join('\n'),
    })
  }
  for (const chapter of input.chapters) {
    const body = htmlToPlainText(chapter.content || '').trim()
    units.push({
      kind: 'chapter',
      label: chapter.title,
      text: [
        '# 章节',
        `标题：${chapter.title}`,
        chapter.summary ? `摘要：${chapter.summary}` : '',
        '正文：',
        body,
      ].filter(Boolean).join('\n'),
    })
  }
  return units.filter(item => item.text.trim())
}

async function prepareNovelSourceChunksV1(
  units: NovelSourceTextUnitV1[],
): Promise<PreparedNovelSourceChunkV1[]> {
  const expanded = units.flatMap(unit => {
    const parts = splitSourceText(unit.text)
    return parts.map((contentText, index) => ({
      unit,
      contentText,
      partIndex: index + 1,
      partCount: parts.length,
    }))
  })
  if (!expanded.length || expanded.length > MAX_SOURCE_UNITS
    || expanded.reduce((sum, item) => sum + item.contentText.length, 0) > MAX_SOURCE_TOTAL_CHARS) {
    fail(`小说冻结单元为空，或超过 ${MAX_SOURCE_UNITS} 单元/400万字符上限`)
  }
  const chunks: PreparedNovelSourceChunkV1[] = []
  for (const [order, item] of expanded.entries()) chunks.push({
      unitKey: `source.novel.${String(order + 1).padStart(5, '0')}`,
      kind: item.unit.kind,
      label: item.partCount === 1 ? item.unit.label : `${item.unit.label}（${item.partIndex}/${item.partCount}）`,
      order,
      partIndex: item.partIndex,
      partCount: item.partCount,
      readDepth: 'full',
      sourceResourceKey: null,
      sourceArea: null,
      sourceResourceKind: null,
      sourceContentHash: await hashProductProductionValueV2(item.contentText),
      contentText: item.contentText,
      charCount: item.contentText.length,
      wordCount: countWords(item.contentText),
    })
  return chunks
}

async function buildNovelUnitArtifacts(input: {
  productInstanceKey: string
  chunks: PreparedNovelSourceChunkV1[]
  capturedAt: number
}): Promise<TextOpenWorldSourcePinBundleV1['units']> {
  const units: TextOpenWorldSourcePinBundleV1['units'] = []
  for (const item of input.chunks) {
    const artifactKey = sourceUnitArtifactKey(item.order)
    const payload: TextOpenWorldSourcePinUnitV1 = {
      schema: 'storyforge.text-open-world-source-pin-unit',
      version: 1,
      productInstanceKey: input.productInstanceKey,
      sourceKind: 'novel',
      unitKey: item.unitKey,
      artifactKey,
      kind: item.kind,
      label: item.label,
      order: item.order,
      partIndex: item.partIndex,
      partCount: item.partCount,
      readDepth: 'full',
      sourceResourceKey: null,
      sourceArea: null,
      sourceResourceKind: null,
      sourceContentHash: item.sourceContentHash,
      contentText: item.contentText,
      charCount: item.charCount,
      wordCount: item.wordCount,
      capturedAt: input.capturedAt,
    }
    units.push({ payload, artifactContentHash: await hashProductProductionValueV2(payload) })
  }
  return units
}

async function prepareNovelSourceSnapshotInternalV1(input: {
  sourceScope: WorkspaceScope
  selection: AdaptationSourceSelectionV1
}): Promise<PreparedNovelSourceSnapshotInternalV1> {
  const scope = await resolveScope({ scope: input.sourceScope })
  const sourceWork = await db.works.get(scope.workId)
  if (!sourceWork || sourceWork.projectId !== scope.projectId
    || sourceWork.worldId !== scope.worldId || effectiveWorkKind(sourceWork) !== 'novel') {
    fail('来源 scope 不是有效小说 Work')
  }
  const [outlines, chapters, storyCores] = await Promise.all([
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
    readOwnedRows<StoryCore>(scope, 'storyCores', { owner: 'work' }),
  ])
  const selected = selectedNovelRows({ selection: input.selection, outlines, chapters })
  const textUnits = novelTextUnits({
    title: sourceWork.title,
    description: sourceWork.description,
    genres: sourceWork.genres,
    storyCores,
    outlines: selected.outlines,
    chapters: selected.chapters,
  })
  const chapterPreviews = selected.chapters.map((chapter, order) => {
    if (chapter.id == null) fail('小说选择存在无 ID 章节')
    const plain = htmlToPlainText(chapter.content || '').trim()
    return {
      id: chapter.id,
      outlineNodeId: chapter.outlineNodeId,
      title: chapter.title,
      order,
      wordCount: countWords(plain),
      hasContent: Boolean(plain),
    }
  })
  const outlinePreviews = selected.outlines.map(outline => {
    if (outline.id == null) fail('小说选择存在无 ID 大纲')
    return {
      id: outline.id,
      parentId: outline.parentId,
      type: outline.type,
      title: outline.title,
      order: outline.order,
    }
  })
  const hasFullText = chapterPreviews.some(chapter => chapter.hasContent)
  const hasOutline = selected.outlines.some(outline => outline.summary.trim())
    || storyCores.some(core => core.centralConflict.trim() || core.theme.trim())
  if (!hasFullText && !hasOutline) fail('小说选择没有正文或有效故事/大纲内容')
  const chunks = await prepareNovelSourceChunksV1(textUnits)
  const sourceUpdatedAt = Math.max(
    sourceWork.updatedAt,
    ...selected.outlines.map(item => item.updatedAt),
    ...selected.chapters.map(item => item.updatedAt),
    ...storyCores.map(item => item.updatedAt),
  )
  const sourceVersionHash = await hashProductProductionValueV2({
    workCode: sourceWork.code,
    selectionMode: input.selection.mode,
    units: chunks.map(sourceUnitIdentity),
  })
  const source: Extract<TextOpenWorldSourcePinSourceV1, { kind: 'novel' }> = {
    kind: 'novel',
    workCode: stableKey(sourceWork.code, 'workCode'),
    workTitle: nonEmptyText(sourceWork.title, 'workTitle', 500),
    snapshotVersion: 1,
    sourceUpdatedAt,
    sourceContentHash: sourceVersionHash,
    coverage: hasFullText ? 'full-text' : 'outline-only',
    selection: {
      mode: input.selection.mode,
      label: selected.label,
      selectedChapterCount: selected.chapters.length,
      selectedOutlineCount: selected.outlines.length,
    },
  }
  const sourceBoundaryHashValue = await sourceBoundaryHash({
    sourceVersionHash,
    source,
    units: chunks,
  })
  return {
    scope,
    source,
    sourceVersionHash,
    sourceBoundaryHash: sourceBoundaryHashValue,
    chunks,
    preview: {
      schema: 'storyforge.text-open-world-novel-source-snapshot-preview',
      version: 1,
      sourceKind: 'novel',
      workCode: source.workCode,
      workTitle: source.workTitle,
      sourceUpdatedAt,
      sourceVersionHash,
      sourceBoundaryHash: sourceBoundaryHashValue,
      coverage: source.coverage,
      selection: structuredClone(source.selection),
      outlines: outlinePreviews,
      chapters: chapterPreviews,
      storyCoreCount: storyCores.length,
      writtenChapterCount: chapterPreviews.filter(chapter => chapter.hasContent).length,
      totalWordCount: chapterPreviews.reduce((total, chapter) => total + chapter.wordCount, 0),
      sourceUnitCount: chunks.length,
    },
  }
}

async function novelSourceRawReadSetJsonV1(scope: WorkspaceScope): Promise<string> {
  const sourceWork = await db.works.get(scope.workId)
  if (!sourceWork || sourceWork.projectId !== scope.projectId
    || sourceWork.worldId !== scope.worldId || effectiveWorkKind(sourceWork) !== 'novel') {
    fail('来源 scope 不是有效小说 Work')
  }
  const [outlines, chapters, storyCores] = await Promise.all([
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
    readOwnedRows<StoryCore>(scope, 'storyCores', { owner: 'work' }),
  ])
  const byId = <T extends { id?: number }>(rows: T[]) => [...rows]
    .sort((left, right) => (left.id ?? -1) - (right.id ?? -1))
    .map(row => ({ ...row, id: row.id ?? null }))
  const stripUndefined = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stripUndefined)
    if (value != null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .map(([key, child]) => [key, stripUndefined(child)]))
    }
    return value
  }
  return canonicalProductProductionJsonV2(stripUndefined({
    work: { ...sourceWork, id: sourceWork.id ?? null },
    outlines: byId(outlines),
    chapters: byId(chapters),
    storyCores: byId(storyCores),
  }))
}

/**
 * Builds an ephemeral exact-row witness outside the command transaction. The
 * final authorization transaction only re-reads and byte-compares these rows;
 * it never repeats hundreds of WebCrypto hashes while holding IndexedDB locks.
 */
export async function createTextOpenWorldNovelSourceCasWitnessV1(input: {
  sourceScope: WorkspaceScope
  selection: AdaptationSourceSelectionV1
  expectedSourceVersionHash: string
  expectedSourceBoundaryHash: string
}): Promise<TextOpenWorldNovelSourceCasWitnessV1> {
  const scope = await resolveScope({ scope: input.sourceScope })
  const before = await novelSourceRawReadSetJsonV1(scope)
  const snapshot = await prepareNovelSourceSnapshotInternalV1({
    sourceScope: scope,
    selection: input.selection,
  })
  const after = await novelSourceRawReadSetJsonV1(scope)
  if (before !== after
    || snapshot.sourceVersionHash !== input.expectedSourceVersionHash
    || snapshot.sourceBoundaryHash !== input.expectedSourceBoundaryHash) {
    fail('小说来源在授权见证生成期间变化')
  }
  return {
    schema: 'storyforge.text-open-world-novel-source-cas-witness',
    version: 1,
    projectId: scope.projectId,
    worldId: scope.worldId,
    workId: scope.workId,
    selectionJson: canonicalProductProductionJsonV2(input.selection),
    sourceVersionHash: snapshot.sourceVersionHash,
    sourceBoundaryHash: snapshot.sourceBoundaryHash,
    rawReadSetJson: after,
  }
}

export async function assertTextOpenWorldNovelSourceCasWitnessCurrentV1(input: {
  scope: WorkspaceScope
  selection: AdaptationSourceSelectionV1
  witness: TextOpenWorldNovelSourceCasWitnessV1
}): Promise<void> {
  const { scope, witness } = input
  if (witness.schema !== 'storyforge.text-open-world-novel-source-cas-witness'
    || witness.version !== 1 || witness.projectId !== scope.projectId
    || witness.worldId !== scope.worldId || witness.workId !== scope.workId
    || witness.selectionJson !== canonicalProductProductionJsonV2(input.selection)
    || !isSha256Hash(witness.sourceVersionHash)
    || !isSha256Hash(witness.sourceBoundaryHash)
    || await novelSourceRawReadSetJsonV1(scope) !== witness.rawReadSetJson) {
    fail('小说来源在原子授权边界已经变化')
  }
}

/** Prepare the exact immutable identity later used by formal freeze without
 * persisting anything or returning the internally read novel text. */
export async function prepareTextOpenWorldNovelSourceSnapshotV1(input: {
  sourceScope: WorkspaceScope
  selection: AdaptationSourceSelectionV1
}): Promise<TextOpenWorldNovelSourceSnapshotPreviewV1> {
  const prepared = await prepareNovelSourceSnapshotInternalV1(input)
  return structuredClone(prepared.preview)
}

/** Opaque transaction capability for the product-private novel source CAS. */
export function textOpenWorldNovelSourceTransactionTablesV1() {
  return ['works', 'outlineNodes', 'chapters', 'storyCores'].map(name => getTableSpec(name).table)
}

async function resolveExpectedWorldReleaseHashV1(input: {
  scope: WorkspaceScope
  localReleaseRecordId: number
  authorization: TextOpenWorldSourceAuthorizationInputV1
  expectedReleaseHash?: string
}): Promise<string> {
  if (input.expectedReleaseHash != null) {
    if (!isSha256Hash(input.expectedReleaseHash)) fail('expectedReleaseHash 非法')
    return input.expectedReleaseHash
  }

  // The production executor predates the creator-source handoff contract. Its
  // authorized Brief is nevertheless an immutable compare-and-swap witness,
  // so derive the expected release identity from that row instead of silently
  // trusting whatever currently occupies the local release id.
  const productInstanceKey = stableKey(
    input.authorization.productInstanceKey,
    'productInstanceKey',
  )
  const production = await db.productProductions
    .where('[workId+productionKey]')
    .equals([input.scope.workId, productInstanceKey])
    .first()
  if (!production?.id
    || !await assertRecordInScope(input.scope, 'productProductions', production, { owner: 'work' })) {
    fail('正式冻结必须提供 expectedReleaseHash 或匹配的授权 Production')
  }
  const brief = await db.productProductionBriefs
    .where('[productionId+revision]')
    .equals([production.id, input.authorization.briefRevision])
    .first()
  if (!brief
    || !await assertRecordInScope(input.scope, 'productProductionBriefs', brief, { owner: 'work' })
    || brief.status !== 'authorized'
    || brief.briefHash !== input.authorization.briefHash
    || brief.sourceWorldReleaseId !== input.localReleaseRecordId
    || !isSha256Hash(brief.sourceWorldContentHash)) {
    fail('授权 Brief 不能证明待冻结 WorldRelease 的精确版本')
  }
  return brief.sourceWorldContentHash
}

/** Derive the exact catalog descriptor boundary used by Creator SourcePlan. */
export async function prepareTextOpenWorldWorldSourceBoundaryV1(input: {
  scope: WorkspaceScope
  localReleaseRecordId: number
  expectedReleaseHash: string
  selection: TextOpenWorldWorldSourceSelectionV1
}): Promise<{
  sourceVersionHash: string
  sourceBoundaryHash: string
  selectedResourceKeys: string[]
}> {
  const scope = await resolveScope({ scope: input.scope })
  if (!isSha256Hash(input.expectedReleaseHash)) fail('expectedReleaseHash 非法')
  const catalog = await openWorldSemanticResourceCatalogV1({
    localReleaseRecordId: input.localReleaseRecordId,
    expectedProjectId: scope.projectId,
    expectedWorldId: scope.worldId,
  })
  if (catalog.description.identity.releaseHash !== input.expectedReleaseHash) {
    fail('WorldRelease 已在边界推导前变化')
  }
  const descriptorByKey = new Map(catalog.resources.map(item => [item.resourceKey, item]))
  const selectedResourceKeys = input.selection.mode === 'entire-release'
    ? [...descriptorByKey.keys()].sort()
    : uniqueSorted(input.selection.resourceKeys.map(key => stableKey(key, 'resourceKey')))
  if (!selectedResourceKeys.length || selectedResourceKeys.length > MAX_SOURCE_UNITS
    || (input.selection.mode === 'selected-resources'
      && selectedResourceKeys.length !== input.selection.resourceKeys.length)) {
    fail('WorldRelease 选择为空、重复或超过资源上限')
  }
  const descriptors = selectedResourceKeys.map(key => {
    const descriptor = descriptorByKey.get(key)
    if (!descriptor?.worldSemantic) fail(`资源不属于冻结 WorldRelease:${key}`)
    return descriptor as typeof descriptor & { worldSemantic: NonNullable<typeof descriptor.worldSemantic> }
  })
  const portableReference = await portableWorldReferenceV1(catalog.description.worldReference)
  const source: Extract<TextOpenWorldSourcePinSourceV1, { kind: 'world-release' }> = {
    kind: 'world-release',
    worldReference: portableReference,
    releaseUid: portableReference.releaseUid,
    releaseVersion: portableReference.releaseVersion,
    releaseHash: portableReference.releaseHash,
    sourceManifestHash: catalog.description.sourceManifestHash,
    catalogHash: portableReference.capabilityIdentity.catalogHash,
    selection: { mode: input.selection.mode, selectedResourceKeys },
  }
  const units: SourceUnitIdentityInputV1[] = descriptors.map((descriptor, order) => ({
    unitKey: `source.world.${String(order + 1).padStart(5, '0')}`,
    kind: 'world-resource',
    label: descriptor.title.trim() || descriptor.resourceKey,
    order,
    partIndex: 1,
    partCount: 1,
    readDepth: 'index',
    sourceResourceKey: descriptor.resourceKey,
    sourceArea: descriptor.worldSemantic.area,
    sourceResourceKind: descriptor.worldSemantic.resourceKind,
    sourceContentHash: descriptor.contentHash,
    charCount: 0,
    wordCount: 0,
  }))
  return {
    sourceVersionHash: source.releaseHash,
    sourceBoundaryHash: await sourceBoundaryHash({
      sourceVersionHash: source.releaseHash,
      source,
      units,
    }),
    selectedResourceKeys,
  }
}

/** Freeze only neutral WorldRelease catalog coordinates. P1 is responsible for
 * full/original reads and their Context Manifest evidence. */
export async function freezeTextOpenWorldWorldReleaseSourceV1(input: {
  scope: WorkspaceScope
  localReleaseRecordId: number
  /** Exact creator-preview identity. Legacy production calls derive the same
   * witness from their already-authorized Brief. */
  expectedReleaseHash?: string
  selection: TextOpenWorldWorldSourceSelectionV1
  authorization: TextOpenWorldSourceAuthorizationInputV1
  createdAt?: number
}): Promise<TextOpenWorldSourcePinBundleV1> {
  const scope = await resolveScope({ scope: input.scope })
  const createdAt = timestamp(input.createdAt ?? Date.now(), 'createdAt')
  const productInstanceKey = stableKey(input.authorization.productInstanceKey, 'productInstanceKey')
  const expectedReleaseHash = await resolveExpectedWorldReleaseHashV1({
    scope,
    localReleaseRecordId: input.localReleaseRecordId,
    authorization: input.authorization,
    expectedReleaseHash: input.expectedReleaseHash,
  })
  const catalog = await openWorldSemanticResourceCatalogV1({
    localReleaseRecordId: input.localReleaseRecordId,
    expectedProjectId: scope.projectId,
    expectedWorldId: scope.worldId,
  })
  if (catalog.description.identity.releaseHash !== expectedReleaseHash) {
    fail('WorldRelease 已在预览后变化；请重新确认来源')
  }
  const descriptorByKey = new Map(catalog.resources.map(item => [item.resourceKey, item]))
  const selectedResourceKeys = input.selection.mode === 'entire-release'
    ? [...descriptorByKey.keys()].sort()
    : uniqueSorted(input.selection.resourceKeys.map(key => stableKey(key, 'resourceKey')))
  if (!selectedResourceKeys.length || selectedResourceKeys.length > MAX_SOURCE_UNITS) {
    fail('WorldRelease 选择为空或超过资源上限')
  }
  if (input.selection.mode === 'selected-resources'
    && selectedResourceKeys.length !== input.selection.resourceKeys.length) fail('WorldRelease 选择包含重复资源')
  const descriptors = selectedResourceKeys.map(key => {
    const descriptor = descriptorByKey.get(key)
    if (!descriptor?.worldSemantic) fail(`资源不属于冻结 WorldRelease:${key}`)
    return descriptor as typeof descriptor & {
      worldSemantic: NonNullable<typeof descriptor.worldSemantic>
    }
  })
  const units: TextOpenWorldSourcePinBundleV1['units'] = []
  for (const [order, descriptor] of descriptors.entries()) {
    const artifactKey = sourceUnitArtifactKey(order)
    const payload: TextOpenWorldSourcePinUnitV1 = {
      schema: 'storyforge.text-open-world-source-pin-unit',
      version: 1,
      productInstanceKey,
      sourceKind: 'world-release',
      unitKey: `source.world.${String(order + 1).padStart(5, '0')}`,
      artifactKey,
      kind: 'world-resource',
      label: descriptor.title.trim() || descriptor.resourceKey,
      order,
      partIndex: 1,
      partCount: 1,
      readDepth: 'index',
      sourceResourceKey: descriptor.resourceKey,
      sourceArea: descriptor.worldSemantic.area,
      sourceResourceKind: descriptor.worldSemantic.resourceKind,
      sourceContentHash: descriptor.contentHash,
      contentText: null,
      charCount: 0,
      wordCount: 0,
      capturedAt: createdAt,
    }
    units.push({ payload, artifactContentHash: await hashProductProductionValueV2(payload) })
  }
  const portableReference = await portableWorldReferenceV1(catalog.description.worldReference)
  const source: TextOpenWorldSourcePinSourceV1 = {
    kind: 'world-release',
    worldReference: portableReference,
    releaseUid: portableReference.releaseUid,
    releaseVersion: portableReference.releaseVersion,
    releaseHash: portableReference.releaseHash,
    sourceManifestHash: catalog.description.sourceManifestHash,
    catalogHash: portableReference.capabilityIdentity.catalogHash,
    selection: { mode: input.selection.mode, selectedResourceKeys },
  }
  const refs = units.map(item => unitRef(item.payload, item.artifactContentHash))
  const boundaryHash = await sourceBoundaryHash({
    sourceVersionHash: source.releaseHash,
    source,
    units: refs,
  })
  const authorization = await createAuthorization({
    sourceKind: 'world-release',
    sourceVersionHash: source.releaseHash,
    sourceBoundaryHash: boundaryHash,
    authorization: input.authorization,
  })
  if (authorization.authorizedAt > createdAt) fail('createdAt 不能早于作者授权')
  const pin = await createPin({
    productInstanceKey,
    sourceVersionHash: source.releaseHash,
    sourceBoundaryHash: boundaryHash,
    source,
    units,
    authorization,
    method: 'world-release-index',
    readDepth: 'index',
    createdAt,
  })
  return validateTextOpenWorldSourcePinBundleV1({ pin, units })
}

/** Copy the selected novel text into product-private immutable unit Artifacts.
 * Mutable source rows are deliberately absent from the resulting pin. */
export async function freezeTextOpenWorldNovelSourceV1(input: {
  targetScope: WorkspaceScope
  sourceScope: WorkspaceScope
  selection: AdaptationSourceSelectionV1
  expectedSourceVersionHash: string
  expectedSourceBoundaryHash: string
  authorization: TextOpenWorldSourceAuthorizationInputV1
  createdAt?: number
}): Promise<TextOpenWorldSourcePinBundleV1> {
  if (!isSha256Hash(input.expectedSourceVersionHash)
    || !isSha256Hash(input.expectedSourceBoundaryHash)) {
    fail('小说来源预览 Hash 非法')
  }
  const [targetScope, prepared] = await Promise.all([
    resolveScope({ scope: input.targetScope }),
    prepareNovelSourceSnapshotInternalV1({
      sourceScope: input.sourceScope,
      selection: input.selection,
    }),
  ])
  if (targetScope.projectId !== prepared.scope.projectId) fail('小说来源必须与产品位于同一项目')
  if (prepared.sourceVersionHash !== input.expectedSourceVersionHash
    || prepared.sourceBoundaryHash !== input.expectedSourceBoundaryHash) {
    fail('小说来源已在预览后变化；请重新确认来源')
  }
  const createdAt = timestamp(input.createdAt ?? Date.now(), 'createdAt')
  const productInstanceKey = stableKey(input.authorization.productInstanceKey, 'productInstanceKey')
  const units = await buildNovelUnitArtifacts({
    productInstanceKey,
    chunks: prepared.chunks,
    capturedAt: createdAt,
  })
  const authorization = await createAuthorization({
    sourceKind: 'novel',
    sourceVersionHash: prepared.sourceVersionHash,
    sourceBoundaryHash: prepared.sourceBoundaryHash,
    authorization: input.authorization,
  })
  if (authorization.authorizedAt > createdAt) fail('createdAt 不能早于作者授权')
  const pin = await createPin({
    productInstanceKey,
    sourceVersionHash: prepared.sourceVersionHash,
    sourceBoundaryHash: prepared.sourceBoundaryHash,
    source: prepared.source,
    units,
    authorization,
    method: 'novel-private-full-copy',
    readDepth: 'full',
    createdAt,
  })
  return validateTextOpenWorldSourcePinBundleV1({ pin, units })
}

async function validateAuthorization(input: TextOpenWorldSourceAuthorizationV1): Promise<void> {
  exactKeys(record(input, 'SourcePin authorization'), [
    'schema', 'version', 'productInstanceKey', 'sourceKind', 'sourceVersionHash',
    'sourceBoundaryHash', 'briefRevision', 'briefHash', 'authorStartRevision',
    'authorizationNonceHash', 'rightsBasis', 'rightsNote', 'permissions',
    'authorizedAt', 'authorizationHash',
  ], 'SourcePin authorization')
  if (input.schema !== 'storyforge.text-open-world-source-authorization' || input.version !== 1) {
    fail('授权合同身份无效')
  }
  stableKey(input.productInstanceKey, 'authorization.productInstanceKey')
  positiveInteger(input.briefRevision, 'authorization.briefRevision')
  positiveInteger(input.authorStartRevision, 'authorization.authorStartRevision')
  for (const hash of [
    input.sourceVersionHash, input.sourceBoundaryHash, input.briefHash,
    input.authorizationNonceHash, input.authorizationHash,
  ]) if (!isSha256Hash(hash)) fail('授权 Hash 非法')
  if (!['author-owned', 'licensed', 'public-domain'].includes(input.rightsBasis)) fail('授权 rightsBasis 非法')
  if (typeof input.rightsNote !== 'string' || input.rightsNote.length > 2_000) fail('授权 rightsNote 非法')
  const permissions = expectedPermissions(input.sourceKind)
  if (JSON.stringify(input.permissions) !== JSON.stringify(permissions)) fail('授权 permission 不是系统派生值')
  timestamp(input.authorizedAt, 'authorization.authorizedAt')
  const { authorizationHash, ...body } = input
  if (await hashProductProductionValueV2(body) !== authorizationHash) fail('授权 Hash 不匹配')
}

export async function validateTextOpenWorldSourcePinUnitV1(
  value: unknown,
): Promise<TextOpenWorldSourcePinUnitV1> {
  const row = record(value, 'SourcePinUnit') as unknown as TextOpenWorldSourcePinUnitV1
  exactKeys(row as unknown as Record<string, unknown>, [
    'schema', 'version', 'productInstanceKey', 'sourceKind', 'unitKey', 'artifactKey',
    'kind', 'label', 'order', 'partIndex', 'partCount', 'readDepth', 'sourceResourceKey',
    'sourceArea', 'sourceResourceKind', 'sourceContentHash', 'contentText', 'charCount',
    'wordCount', 'capturedAt',
  ], 'SourcePinUnit')
  if (row.schema !== 'storyforge.text-open-world-source-pin-unit' || row.version !== 1) {
    fail('SourcePinUnit 合同身份无效')
  }
  stableKey(row.productInstanceKey, 'unit.productInstanceKey')
  stableKey(row.unitKey, 'unit.unitKey')
  stableKey(row.artifactKey, 'unit.artifactKey')
  if (!/^text-open-world\.source-pin-unit(?:\.\d{5})?$/.test(row.artifactKey)) fail('unit.artifactKey 不属于 P0')
  if (!['world-release', 'novel'].includes(row.sourceKind)) fail('unit.sourceKind 非法')
  if (!['world-resource', 'work-metadata', 'story-core', 'outline-node', 'chapter'].includes(row.kind)) {
    fail('unit.kind 非法')
  }
  nonEmptyText(row.label, 'unit.label', 1_000)
  if (!Number.isSafeInteger(row.order) || row.order < 0
    || !Number.isSafeInteger(row.partIndex) || row.partIndex < 1
    || !Number.isSafeInteger(row.partCount) || row.partCount < row.partIndex) fail('unit 顺序或分片非法')
  if (!isSha256Hash(row.sourceContentHash)) fail('unit.sourceContentHash 非法')
  timestamp(row.capturedAt, 'unit.capturedAt')
  if (row.sourceKind === 'world-release') {
    if (row.kind !== 'world-resource' || row.readDepth !== 'index' || row.contentText !== null
      || !row.sourceResourceKey || !WORLD_CAPABILITY_AREAS.includes(row.sourceArea as never)
      || typeof row.sourceResourceKind !== 'string'
      || nonEmptyText(row.sourceResourceKind, 'unit.sourceResourceKind', 200) !== row.sourceResourceKind
      || row.charCount !== 0 || row.wordCount !== 0 || row.partIndex !== 1 || row.partCount !== 1) {
      fail('WorldRelease unit 必须是无正文的 index 证据')
    }
  } else {
    if (row.kind === 'world-resource' || row.readDepth !== 'full' || typeof row.contentText !== 'string'
      || row.sourceResourceKey !== null || row.sourceArea !== null || row.sourceResourceKind !== null) {
      fail('小说 unit 必须是产品私有 full copy')
    }
    if (!row.contentText || row.contentText.length > MAX_SOURCE_UNIT_CHARS
      || row.charCount !== row.contentText.length || row.wordCount !== countWords(row.contentText)
      || await hashProductProductionValueV2(row.contentText) !== row.sourceContentHash) {
      fail('小说 unit 正文、计数或 Hash 不匹配')
    }
  }
  return structuredClone(row)
}

export async function validateTextOpenWorldSourcePinV1(value: unknown): Promise<TextOpenWorldSourcePinV1> {
  const pin = record(value, 'SourcePin') as unknown as TextOpenWorldSourcePinV1
  exactKeys(pin as unknown as Record<string, unknown>, [
    'schema', 'version', 'canonicalJsonVersion', 'productType', 'productInstanceKey',
    'sourceKind', 'sourceVersionHash', 'sourceBoundaryHash', 'source', 'authorization',
    'units', 'readEvidence', 'createdAt', 'pinHash',
  ], 'SourcePin')
  if (pin.schema !== 'storyforge.text-open-world-source-pin' || pin.version !== 1
    || pin.canonicalJsonVersion !== 2 || pin.productType !== 'text-open-world') fail('SourcePin 合同身份无效')
  stableKey(pin.productInstanceKey, 'pin.productInstanceKey')
  const pinSource = record(pin.source, 'SourcePin source')
  const pinAuthorization = record(pin.authorization, 'SourcePin authorization')
  const pinReadEvidence = record(pin.readEvidence, 'SourcePin readEvidence')
  if (!['world-release', 'novel'].includes(pin.sourceKind) || pinSource.kind !== pin.sourceKind) fail('SourcePin 来源类型冲突')
  for (const hash of [pin.sourceVersionHash, pin.sourceBoundaryHash, pin.pinHash]) {
    if (!isSha256Hash(hash)) fail('SourcePin Hash 非法')
  }
  if (!Array.isArray(pin.units) || !pin.units.length || pin.units.length > MAX_SOURCE_UNITS) {
    fail('SourcePin unit refs 为空或超过上限')
  }
  const keys = new Set<string>()
  const artifacts = new Set<string>()
  for (const [index, unit] of pin.units.entries()) {
    exactKeys(unit as unknown as Record<string, unknown>, [
      'unitKey', 'artifactKey', 'artifactContentHash', 'kind', 'label', 'order',
      'partIndex', 'partCount', 'readDepth', 'sourceResourceKey', 'sourceArea',
      'sourceResourceKind', 'sourceContentHash', 'charCount', 'wordCount',
    ], 'Pin unit ref')
    stableKey(unit.unitKey, 'pin.unitKey')
    stableKey(unit.artifactKey, 'pin.artifactKey')
    if (!/^text-open-world\.source-pin-unit(?:\.\d{5})?$/.test(unit.artifactKey)
      || !isSha256Hash(unit.artifactContentHash) || !isSha256Hash(unit.sourceContentHash)
      || !['world-resource', 'work-metadata', 'story-core', 'outline-node', 'chapter'].includes(unit.kind)
      || !['index', 'full'].includes(unit.readDepth)
      || typeof unit.label !== 'string' || nonEmptyText(unit.label, 'pin.unit.label', 1_000) !== unit.label
      || !Number.isSafeInteger(unit.order) || unit.order !== index
      || !Number.isSafeInteger(unit.partIndex) || unit.partIndex < 1
      || !Number.isSafeInteger(unit.partCount) || unit.partCount < unit.partIndex
      || !Number.isSafeInteger(unit.charCount) || unit.charCount < 0
      || !Number.isSafeInteger(unit.wordCount) || unit.wordCount < 0
      || (unit.sourceResourceKey !== null
        && (typeof unit.sourceResourceKey !== 'string' || !STABLE_KEY.test(unit.sourceResourceKey)))
      || (unit.sourceArea !== null && !WORLD_CAPABILITY_AREAS.includes(unit.sourceArea as never))
      || (unit.sourceResourceKind !== null
        && (typeof unit.sourceResourceKind !== 'string'
          || nonEmptyText(unit.sourceResourceKind, 'pin.unit.sourceResourceKind', 200)
            !== unit.sourceResourceKind))) {
      fail('Pin unit 引用字段非法')
    }
    if (keys.has(unit.unitKey) || artifacts.has(unit.artifactKey)) fail('Pin unit key/order 不唯一')
    keys.add(unit.unitKey)
    artifacts.add(unit.artifactKey)
  }
  if (pin.sourceKind === 'world-release') {
    const source = pin.source as Extract<TextOpenWorldSourcePinSourceV1, { kind: 'world-release' }>
    exactKeys(record(source, 'WorldRelease SourcePin source'), [
      'kind', 'worldReference', 'releaseUid', 'releaseVersion', 'releaseHash',
      'sourceManifestHash', 'catalogHash', 'selection',
    ], 'WorldRelease SourcePin source')
    exactKeys(record(source.selection, 'WorldRelease SourcePin selection'), [
      'mode', 'selectedResourceKeys',
    ], 'WorldRelease SourcePin selection')
    await validatePortableWorldReferenceV1(source.worldReference)
    if (source.worldReference.localReleaseRecordId !== 0
      || source.releaseUid !== source.worldReference.releaseUid
      || source.releaseVersion !== source.worldReference.releaseVersion
      || source.releaseHash !== source.worldReference.releaseHash
      || source.catalogHash !== source.worldReference.capabilityIdentity.catalogHash
      || source.releaseHash !== pin.sourceVersionHash
      || !isSha256Hash(source.sourceManifestHash)
      || source.selection.selectedResourceKeys.length !== pin.units.length
      || new Set(source.selection.selectedResourceKeys).size !== source.selection.selectedResourceKeys.length
      || JSON.stringify(source.selection.selectedResourceKeys) !== JSON.stringify([...source.selection.selectedResourceKeys].sort())
      || JSON.stringify(pin.units.map(unit => unit.sourceResourceKey)) !== JSON.stringify(source.selection.selectedResourceKeys)
      || pin.units.some(unit => unit.kind !== 'world-resource' || unit.readDepth !== 'index'
        || !unit.sourceResourceKey || unit.sourceArea == null || unit.sourceResourceKind == null
        || !source.selection.selectedResourceKeys.includes(unit.sourceResourceKey))) {
      fail('WorldRelease SourcePin 身份、选择或 unit 闭包不一致')
    }
  } else {
    const source = pin.source as Extract<TextOpenWorldSourcePinSourceV1, { kind: 'novel' }>
    exactKeys(record(source, 'Novel SourcePin source'), [
      'kind', 'workCode', 'workTitle', 'snapshotVersion', 'sourceUpdatedAt',
      'sourceContentHash', 'coverage', 'selection',
    ], 'Novel SourcePin source')
    exactKeys(record(source.selection, 'Novel SourcePin selection'), [
      'mode', 'label', 'selectedChapterCount', 'selectedOutlineCount',
    ], 'Novel SourcePin selection')
    stableKey(source.workCode, 'source.workCode')
    nonEmptyText(source.workTitle, 'source.workTitle', 500)
    if (source.snapshotVersion !== 1 || source.sourceContentHash !== pin.sourceVersionHash
      || !['full-text', 'outline-only'].includes(source.coverage)
      || !['entire-work', 'outline-subtree', 'chapter-range', 'chapters'].includes(source.selection.mode)
      || !Number.isSafeInteger(source.selection.selectedChapterCount) || source.selection.selectedChapterCount < 0
      || !Number.isSafeInteger(source.selection.selectedOutlineCount) || source.selection.selectedOutlineCount < 0
      || pin.units.some(unit => unit.kind === 'world-resource' || unit.readDepth !== 'full'
        || unit.sourceResourceKey !== null || unit.sourceArea !== null
        || unit.sourceResourceKind !== null)) fail('小说 SourcePin 身份、选择或 unit 闭包不一致')
    timestamp(source.sourceUpdatedAt, 'source.sourceUpdatedAt')
    const expectedSourceContentHash = await hashProductProductionValueV2({
      workCode: source.workCode,
      selectionMode: source.selection.mode,
      units: pin.units.map(sourceUnitIdentity),
    })
    if (expectedSourceContentHash !== source.sourceContentHash) fail('小说 SourcePin sourceContentHash 不匹配')
  }
  if (pinAuthorization.productInstanceKey !== pin.productInstanceKey
    || pin.authorization.sourceKind !== pin.sourceKind
    || pin.authorization.sourceVersionHash !== pin.sourceVersionHash
    || pin.authorization.sourceBoundaryHash !== pin.sourceBoundaryHash) fail('SourcePin 授权绑定不一致')
  await validateAuthorization(pin.authorization)
  exactKeys(pinReadEvidence, [
    'method', 'readDepth', 'unitCount', 'totalChars', 'totalWords', 'evidenceHash',
    'capturedAt',
  ], 'SourcePin readEvidence')
  const expectedBoundary = await sourceBoundaryHash({
    sourceVersionHash: pin.sourceVersionHash,
    source: pin.source,
    units: pin.units,
  })
  if (expectedBoundary !== pin.sourceBoundaryHash) fail('SourcePin sourceBoundaryHash 不匹配')
  const totals = pin.units.reduce((result, item) => ({
    chars: result.chars + item.charCount,
    words: result.words + item.wordCount,
  }), { chars: 0, words: 0 })
  if (totals.chars > MAX_SOURCE_TOTAL_CHARS
    || pin.readEvidence.unitCount !== pin.units.length
    || pin.readEvidence.totalChars !== totals.chars
    || pin.readEvidence.totalWords !== totals.words
    || pin.readEvidence.capturedAt !== pin.createdAt
    || pin.readEvidence.method !== (pin.sourceKind === 'world-release' ? 'world-release-index' : 'novel-private-full-copy')
    || pin.readEvidence.readDepth !== (pin.sourceKind === 'world-release' ? 'index' : 'full')
    || !isSha256Hash(pin.readEvidence.evidenceHash)
    || await readEvidenceHash(pin.readEvidence, pin.units) !== pin.readEvidence.evidenceHash) {
    fail('SourcePin 实际读取证据不一致')
  }
  if (pin.authorization.authorizedAt > pin.createdAt) fail('SourcePin 早于作者授权')
  const { pinHash, ...body } = pin
  if (await hashProductProductionValueV2(body) !== pinHash) fail('SourcePin pinHash 不匹配')
  return structuredClone(pin)
}

export async function validateTextOpenWorldSourcePinBundleV1(
  value: TextOpenWorldSourcePinBundleV1,
): Promise<TextOpenWorldSourcePinBundleV1> {
  const pin = await validateTextOpenWorldSourcePinV1(value.pin)
  if (!Array.isArray(value.units) || value.units.length !== pin.units.length) fail('SourcePin unit Artifact 数量不一致')
  const payloadByArtifact = new Map<string, TextOpenWorldSourcePinBundleV1['units'][number]>()
  for (const item of value.units) {
    const payload = await validateTextOpenWorldSourcePinUnitV1(item.payload)
    if (!isSha256Hash(item.artifactContentHash)
      || await hashProductProductionValueV2(payload) !== item.artifactContentHash
      || payload.capturedAt !== pin.createdAt
      || payloadByArtifact.has(payload.artifactKey)) fail('SourcePin unit Artifact Hash 或 key 不一致')
    payloadByArtifact.set(payload.artifactKey, { payload, artifactContentHash: item.artifactContentHash })
  }
  for (const ref of pin.units) {
    const item = payloadByArtifact.get(ref.artifactKey)
    if (!item || item.payload.productInstanceKey !== pin.productInstanceKey
      || item.payload.sourceKind !== pin.sourceKind
      || canonicalProductProductionJsonV2(unitRef(item.payload, item.artifactContentHash))
        !== canonicalProductProductionJsonV2(ref)) {
      fail(`SourcePin unit Artifact 未闭合:${ref.artifactKey}`)
    }
  }
  return { pin, units: pin.units.map(ref => payloadByArtifact.get(ref.artifactKey)!) }
}

/**
 * Single product-owned P0 candidate envelope. The executor, atomic persistence
 * boundary, and producer-proof verifier must all use these exact fields.
 */
export function createTextOpenWorldSourcePinCandidateArtifactsV1(
  bundle: TextOpenWorldSourcePinBundleV1,
) {
  return [...bundle.units.map(unit => ({
    artifactKey: unit.payload.artifactKey,
    requirementKey: 'text-open-world.source-pin',
    kind: 'text-open-world.source-pin-unit' as const,
    payload: unit.payload,
    contentHash: unit.artifactContentHash,
    metadata: {
      sourceKind: bundle.pin.sourceKind,
      sourceUnitKey: unit.payload.unitKey,
      readDepth: unit.payload.readDepth,
    },
    quality: { gates: ['tow.source-pin.schema', 'tow.source-pin.hash'] },
    rights: {
      authorizationHash: bundle.pin.authorization.authorizationHash,
      rightsBasis: bundle.pin.authorization.rightsBasis,
      rightsNote: bundle.pin.authorization.rightsNote,
    },
  })), {
    artifactKey: 'text-open-world.source-pin',
    requirementKey: 'text-open-world.source-pin',
    kind: 'text-open-world.source-pin' as const,
    payload: bundle.pin,
    contentHash: bundle.pin.pinHash,
    metadata: {
      sourceKind: bundle.pin.sourceKind,
      sourceVersionHash: bundle.pin.sourceVersionHash,
      sourceBoundaryHash: bundle.pin.sourceBoundaryHash,
      readEvidenceHash: bundle.pin.readEvidence.evidenceHash,
      unitArtifactHashes: bundle.pin.units.map(item => item.artifactContentHash),
    },
    quality: { gates: ['tow.source-pin.schema', 'tow.source-pin.hash', 'tow.source-pin.authorization'] },
    rights: {
      authorizationHash: bundle.pin.authorization.authorizationHash,
      rightsBasis: bundle.pin.authorization.rightsBasis,
      rightsNote: bundle.pin.authorization.rightsNote,
    },
  }]
}

async function requireTextOpenWorldBuild(input: {
  scope: WorkspaceScope
  buildId: number
  controlEpoch?: number
  productInstanceKey?: string
}): Promise<{ scope: WorkspaceScope; build: NonNullable<Awaited<ReturnType<typeof db.productBuilds.get>>> }> {
  const scope = await resolveScope({ scope: input.scope })
  const build = await db.productBuilds.get(input.buildId)
  if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) fail('Build 不存在或跨 Work')
  const production = await db.productProductions.get(build.productionId)
  if (!production || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })
    || production.productType !== 'text-open-world') fail('Build 不属于文字开放世界产品')
  if (input.controlEpoch != null && build.controlEpoch !== input.controlEpoch) fail('Build controlEpoch 已过期')
  if (input.productInstanceKey != null && production.productionKey !== input.productInstanceKey) {
    fail('SourcePin productInstanceKey 与生产根不一致')
  }
  return { scope, build }
}

/** Persist the complete frozen source and closure marker atomically. */
export async function acceptTextOpenWorldSourcePinBundleV1(input: {
  scope: WorkspaceScope
  buildId: number
  controlEpoch: number
  bundle: TextOpenWorldSourcePinBundleV1
}): Promise<{ pinArtifact: ProductBuildArtifactRecordV1; unitArtifacts: ProductBuildArtifactRecordV1[] }> {
  const bundle = await validateTextOpenWorldSourcePinBundleV1(input.bundle)
  const { scope } = await requireTextOpenWorldBuild({
    scope: input.scope,
    buildId: input.buildId,
    controlEpoch: input.controlEpoch,
    productInstanceKey: bundle.pin.productInstanceKey,
  })
  return acceptTextOpenWorldSourcePinBundleArtifactsV1({
    scope, buildId: input.buildId, controlEpoch: input.controlEpoch, bundle,
  })
}

export async function readAcceptedTextOpenWorldSourcePinBundleV1(input: {
  scope: WorkspaceScope
  buildId: number
}): Promise<{ pinArtifact: ProductBuildArtifactRecordV1; unitArtifacts: ProductBuildArtifactRecordV1[] }> {
  const { scope } = await requireTextOpenWorldBuild({ scope: input.scope, buildId: input.buildId })
  const artifacts = await readAcceptedBuildArtifacts({ scope, buildId: input.buildId })
  const pinArtifact = artifacts.find(item => item.artifactKey === 'text-open-world.source-pin'
    && item.kind === 'text-open-world.source-pin')
  if (!pinArtifact) fail('Build 尚未形成已验收 SourcePin')
  let pinValue: unknown
  try { pinValue = JSON.parse(pinArtifact.payloadJson) }
  catch { fail('SourcePin Artifact JSON 损坏') }
  const pin = await validateTextOpenWorldSourcePinV1(pinValue)
  if (pinArtifact.contentHash !== pin.pinHash) fail('SourcePin Artifact 行 Hash 不匹配')
  const byKey = new Map(artifacts.map(item => [item.artifactKey, item]))
  const unitArtifacts = pin.units.map(ref => {
    const row = byKey.get(ref.artifactKey)
    if (!row || row.kind !== 'text-open-world.source-pin-unit' || row.contentHash !== ref.artifactContentHash) {
      fail(`SourcePin unit Artifact 缺失或 Hash 不匹配:${ref.artifactKey}`)
    }
    return row
  })
  const bundle = await validateTextOpenWorldSourcePinBundleV1({
    pin,
    units: unitArtifacts.map(row => ({
      payload: JSON.parse(row.payloadJson) as TextOpenWorldSourcePinUnitV1,
      artifactContentHash: row.contentHash,
    })),
  })
  if (bundle.pin.productInstanceKey !== (await db.productProductions.get((await db.productBuilds.get(input.buildId))!.productionId))!.productionKey) {
    fail('SourcePin Artifact 与生产根身份不一致')
  }
  return { pinArtifact, unitArtifacts }
}

/** Rebind a portable WorldReference by identity and re-check every selected
 * descriptor. Novel pins are already self-contained and need no source row. */
export async function verifyTextOpenWorldSourcePinAvailabilityV1(input: {
  scope: WorkspaceScope
  pin: TextOpenWorldSourcePinV1
}): Promise<{ kind: 'novel'; selfContained: true } | { kind: 'world-release'; worldReference: WorldReferenceV1 }> {
  const pin = await validateTextOpenWorldSourcePinV1(input.pin)
  if (pin.sourceKind === 'novel') return { kind: 'novel', selfContained: true }
  const source = pin.source as Extract<TextOpenWorldSourcePinSourceV1, { kind: 'world-release' }>
  const scope = await resolveScope({ scope: input.scope })
  const candidates = await listWorldReferenceCatalogV1(scope)
  const matched = candidates.find(item => item.reference.referenceHash === source.worldReference.referenceHash
    && item.reference.releaseUid === source.releaseUid && item.reference.releaseHash === source.releaseHash)
  if (!matched) fail('本地没有与 SourcePin 匹配的冻结 WorldRelease')
  const catalog = await openWorldSemanticResourceCatalogV1({
    localReleaseRecordId: matched.reference.localReleaseRecordId,
    expectedProjectId: scope.projectId,
    expectedWorldId: scope.worldId,
  })
  if (catalog.description.sourceManifestHash !== source.sourceManifestHash
    || matched.reference.capabilityIdentity.catalogHash !== source.catalogHash) fail('WorldRelease 目录或来源 manifest 与 SourcePin 不一致')
  const descriptors = new Map(catalog.resources.map(item => [item.resourceKey, item]))
  for (const ref of pin.units) {
    const descriptor = ref.sourceResourceKey ? descriptors.get(ref.sourceResourceKey) : null
    if (!descriptor || !descriptor.worldSemantic
      || descriptor.contentHash !== ref.sourceContentHash
      || (descriptor.title.trim() || descriptor.resourceKey) !== ref.label
      || descriptor.worldSemantic.area !== ref.sourceArea
      || descriptor.worldSemantic.resourceKind !== ref.sourceResourceKind) {
      fail(`WorldRelease 资源与 SourcePin 不一致:${ref.sourceResourceKey ?? ref.unitKey}`)
    }
  }
  return { kind: 'world-release', worldReference: matched.reference }
}
