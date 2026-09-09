import { db } from '../db/schema'
import { resolveCanonicalChapterSequence } from '../ai/chapter-memory/canonical-chapter-sequence'
import { byOutlineOrderThenId } from '../outline/canonical-outline-walk'
import {
  acceptProductBuildArtifact,
  readAcceptedBuildArtifacts,
} from '../product-production/artifact-store'
import {
  hashProductProductionValueV2,
  isSha256Hash,
} from '../product-production/hash'
import { openWorldSemanticResourceCatalogV1 } from '../context-gateway/world-release-client'
import {
  listWorldReferenceCatalogV1,
  portableWorldReferenceV1,
  validatePortableWorldReferenceV1,
} from '../world-engine/world-reference'
import { countWords, htmlToPlainText } from '../utils/html'
import { effectiveWorkKind } from '../workspace/work-kind'
import {
  assertRecordInScope,
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
const MAX_SOURCE_UNITS = 20_000
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
  | 'sourceContentHash'
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

function fail(message: string): never {
  throw new Error(`[text-open-world-source-pin] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
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
    sourceContentHash: ref.sourceContentHash,
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
  if (!expanded.length || expanded.length > MAX_SOURCE_UNITS) fail('小说冻结单元为空或超过上限')
  return Promise.all(expanded.map(async (item, order) => ({
    unitKey: `source.novel.${String(order + 1).padStart(5, '0')}`,
    kind: item.unit.kind,
    label: item.partCount === 1 ? item.unit.label : `${item.unit.label}（${item.partIndex}/${item.partCount}）`,
    order,
    partIndex: item.partIndex,
    partCount: item.partCount,
    readDepth: 'full' as const,
    sourceResourceKey: null,
    sourceContentHash: await hashProductProductionValueV2(item.contentText),
    contentText: item.contentText,
    charCount: item.contentText.length,
    wordCount: countWords(item.contentText),
  })))
}

async function buildNovelUnitArtifacts(input: {
  productInstanceKey: string
  chunks: PreparedNovelSourceChunkV1[]
  capturedAt: number
}): Promise<TextOpenWorldSourcePinBundleV1['units']> {
  return Promise.all(input.chunks.map(async item => {
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
    return { payload, artifactContentHash: await hashProductProductionValueV2(payload) }
  }))
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

/** Prepare the exact immutable identity later used by formal freeze without
 * persisting anything or returning the internally read novel text. */
export async function prepareTextOpenWorldNovelSourceSnapshotV1(input: {
  sourceScope: WorkspaceScope
  selection: AdaptationSourceSelectionV1
}): Promise<TextOpenWorldNovelSourceSnapshotPreviewV1> {
  const prepared = await prepareNovelSourceSnapshotInternalV1(input)
  return structuredClone(prepared.preview)
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
  const units = await Promise.all(descriptors.map(async (descriptor, order) => {
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
    return { payload, artifactContentHash: await hashProductProductionValueV2(payload) }
  }))
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
      || !row.sourceResourceKey || !row.sourceArea || !row.sourceResourceKind
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
  if (pin.schema !== 'storyforge.text-open-world-source-pin' || pin.version !== 1
    || pin.canonicalJsonVersion !== 2 || pin.productType !== 'text-open-world') fail('SourcePin 合同身份无效')
  stableKey(pin.productInstanceKey, 'pin.productInstanceKey')
  if (!['world-release', 'novel'].includes(pin.sourceKind) || pin.source.kind !== pin.sourceKind) fail('SourcePin 来源类型冲突')
  for (const hash of [pin.sourceVersionHash, pin.sourceBoundaryHash, pin.pinHash]) {
    if (!isSha256Hash(hash)) fail('SourcePin Hash 非法')
  }
  if (!Array.isArray(pin.units) || !pin.units.length || pin.units.length > MAX_SOURCE_UNITS) {
    fail('SourcePin unit refs 为空或超过上限')
  }
  const keys = new Set<string>()
  const artifacts = new Set<string>()
  for (const [index, unit] of pin.units.entries()) {
    stableKey(unit.unitKey, 'pin.unitKey')
    stableKey(unit.artifactKey, 'pin.artifactKey')
    if (!isSha256Hash(unit.artifactContentHash) || !isSha256Hash(unit.sourceContentHash)) fail('Pin unit Hash 非法')
    if (keys.has(unit.unitKey) || artifacts.has(unit.artifactKey) || unit.order !== index) fail('Pin unit key/order 不唯一')
    keys.add(unit.unitKey)
    artifacts.add(unit.artifactKey)
  }
  if (pin.sourceKind === 'world-release') {
    const source = pin.source as Extract<TextOpenWorldSourcePinSourceV1, { kind: 'world-release' }>
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
        || !unit.sourceResourceKey || !source.selection.selectedResourceKeys.includes(unit.sourceResourceKey))) {
      fail('WorldRelease SourcePin 身份、选择或 unit 闭包不一致')
    }
  } else {
    const source = pin.source as Extract<TextOpenWorldSourcePinSourceV1, { kind: 'novel' }>
    stableKey(source.workCode, 'source.workCode')
    nonEmptyText(source.workTitle, 'source.workTitle', 500)
    if (source.snapshotVersion !== 1 || source.sourceContentHash !== pin.sourceVersionHash
      || !['full-text', 'outline-only'].includes(source.coverage)
      || !['entire-work', 'outline-subtree', 'chapter-range', 'chapters'].includes(source.selection.mode)
      || !Number.isSafeInteger(source.selection.selectedChapterCount) || source.selection.selectedChapterCount < 0
      || !Number.isSafeInteger(source.selection.selectedOutlineCount) || source.selection.selectedOutlineCount < 0
      || pin.units.some(unit => unit.kind === 'world-resource' || unit.readDepth !== 'full'
        || unit.sourceResourceKey !== null)) fail('小说 SourcePin 身份、选择或 unit 闭包不一致')
    timestamp(source.sourceUpdatedAt, 'source.sourceUpdatedAt')
    const expectedSourceContentHash = await hashProductProductionValueV2({
      workCode: source.workCode,
      selectionMode: source.selection.mode,
      units: pin.units.map(sourceUnitIdentity),
    })
    if (expectedSourceContentHash !== source.sourceContentHash) fail('小说 SourcePin sourceContentHash 不匹配')
  }
  if (pin.authorization.productInstanceKey !== pin.productInstanceKey
    || pin.authorization.sourceKind !== pin.sourceKind
    || pin.authorization.sourceVersionHash !== pin.sourceVersionHash
    || pin.authorization.sourceBoundaryHash !== pin.sourceBoundaryHash) fail('SourcePin 授权绑定不一致')
  await validateAuthorization(pin.authorization)
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
  if (pin.readEvidence.unitCount !== pin.units.length
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
      || payloadByArtifact.has(payload.artifactKey)) fail('SourcePin unit Artifact Hash 或 key 不一致')
    payloadByArtifact.set(payload.artifactKey, { payload, artifactContentHash: item.artifactContentHash })
  }
  for (const ref of pin.units) {
    const item = payloadByArtifact.get(ref.artifactKey)
    if (!item || item.artifactContentHash !== ref.artifactContentHash
      || item.payload.productInstanceKey !== pin.productInstanceKey
      || item.payload.sourceKind !== pin.sourceKind
      || item.payload.unitKey !== ref.unitKey
      || item.payload.sourceContentHash !== ref.sourceContentHash
      || item.payload.order !== ref.order) fail(`SourcePin unit Artifact 未闭合:${ref.artifactKey}`)
  }
  return { pin, units: pin.units.map(ref => payloadByArtifact.get(ref.artifactKey)!) }
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

/** Persist unit Artifacts first and the index last. The index is the closure
 * marker; retries are idempotent, while a different pin in the same Build is a
 * stale source change and is rejected. */
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
  const existing = await readAcceptedBuildArtifacts({ scope, buildId: input.buildId })
  const existingPin = existing.find(item => item.artifactKey === 'text-open-world.source-pin')
  if (existingPin) {
    if (existingPin.contentHash !== bundle.pin.pinHash) fail('同一 Build 的 SourcePin 已冻结；来源变化必须创建新 Build')
    return readAcceptedTextOpenWorldSourcePinBundleV1({ scope, buildId: input.buildId })
  }
  const rights = {
    authorizationHash: bundle.pin.authorization.authorizationHash,
    rightsBasis: bundle.pin.authorization.rightsBasis,
    rightsNote: bundle.pin.authorization.rightsNote,
  }
  const unitArtifacts: ProductBuildArtifactRecordV1[] = []
  for (const item of bundle.units) {
    unitArtifacts.push(await acceptProductBuildArtifact({
      scope,
      buildId: input.buildId,
      controlEpoch: input.controlEpoch,
      artifactKey: item.payload.artifactKey,
      requirementKey: 'text-open-world.source-pin',
      kind: 'text-open-world.source-pin-unit',
      payload: item.payload,
      metadata: {
        sourceKind: bundle.pin.sourceKind,
        sourceUnitKey: item.payload.unitKey,
        readDepth: item.payload.readDepth,
      },
      quality: { gates: ['tow.source-pin.schema', 'tow.source-pin.hash'] },
      rights,
      contentHash: item.artifactContentHash,
      inputHash: bundle.pin.authorization.authorizationHash,
    }))
  }
  const pinArtifact = await acceptProductBuildArtifact({
    scope,
    buildId: input.buildId,
    controlEpoch: input.controlEpoch,
    artifactKey: 'text-open-world.source-pin',
    requirementKey: 'text-open-world.source-pin',
    kind: 'text-open-world.source-pin',
    payload: bundle.pin,
    metadata: {
      sourceKind: bundle.pin.sourceKind,
      sourceVersionHash: bundle.pin.sourceVersionHash,
      sourceBoundaryHash: bundle.pin.sourceBoundaryHash,
      readEvidenceHash: bundle.pin.readEvidence.evidenceHash,
      unitArtifactHashes: bundle.pin.units.map(item => item.artifactContentHash),
    },
    quality: {
      gates: ['tow.source-pin.schema', 'tow.source-pin.hash', 'tow.source-pin.authorization'],
    },
    rights,
    contentHash: bundle.pin.pinHash,
    inputHash: bundle.pin.authorization.authorizationHash,
  })
  return { pinArtifact, unitArtifacts }
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
    if (!descriptor || descriptor.contentHash !== ref.sourceContentHash) {
      fail(`WorldRelease 资源与 SourcePin 不一致:${ref.sourceResourceKey ?? ref.unitKey}`)
    }
  }
  return { kind: 'world-release', worldReference: matched.reference }
}
