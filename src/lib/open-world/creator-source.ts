import {
  listAdaptationSourceOptions,
  previewAdaptationSourceSelection,
} from '../adaptation/source-manifest'
import { openWorldSemanticResourceCatalogV1 } from '../context-gateway/world-release-client'
import {
  previewWorldRequirementsV1,
} from '../product/source-contracts'
import {
  TEXT_OPEN_WORLD_REQUIREMENT_ADAPTER_V1,
  type UpperProductWorldRequirementGoalV1,
} from '../product/world-requirement-adapters'
import type {
  AdaptationSourceSelectionV1,
  TextOpenWorldCreatorNovelSourceCatalogV1,
  TextOpenWorldCreatorNovelSourcePreviewV1,
  TextOpenWorldCreatorSourceGapV1,
  TextOpenWorldCreatorSourcePreviewV1,
  TextOpenWorldCreatorSourceReadinessV1,
  TextOpenWorldCreatorWorldResourceCountsV1,
  TextOpenWorldCreatorWorldSourceCandidateV1,
  TextOpenWorldNovelSourceSnapshotPreviewV1,
  WorkspaceScope,
  WorldReferenceCatalogEntryV1,
  WorldRequirementResolutionV1,
} from '../types'
import {
  listWorldReferenceCatalogV1,
} from '../world-engine/world-reference'
import { prepareTextOpenWorldNovelSourceSnapshotV1 } from './source-pin'

const HASH = /^[a-f0-9]{64}$/

export class TextOpenWorldCreatorSourceErrorV1 extends Error {
  constructor(readonly code: string, message: string) {
    super(`[text-open-world-creator-source:${code}] ${message}`)
    this.name = 'TextOpenWorldCreatorSourceErrorV1'
  }
}

function fail(code: string, message: string): never {
  throw new TextOpenWorldCreatorSourceErrorV1(code, message)
}

function readinessFromGaps(
  gaps: readonly TextOpenWorldCreatorSourceGapV1[],
): TextOpenWorldCreatorSourceReadinessV1 {
  if (gaps.some(gap => gap.severity === 'blocking')) return 'blocked'
  return gaps.length ? 'ready-with-gaps' : 'ready'
}

function requirementGap(
  requirement: WorldRequirementResolutionV1,
): TextOpenWorldCreatorSourceGapV1 | null {
  if (!['missing', 'insufficient', 'conflict'].includes(requirement.status)) return null
  const blocking = requirement.level === 'stable-required'
  return {
    code: `world-requirement-${requirement.status}`,
    severity: blocking ? 'blocking' : requirement.level === 'conditional' ? 'warning' : 'recommendation',
    title: blocking ? `缺少必需来源：${requirement.label}` : `建议补充：${requirement.label}`,
    detail: requirement.status === 'insufficient'
      ? `当前匹配 ${requirement.availableResourceCount} 项，至少需要 ${requirement.minimumResources} 项。`
      : requirement.status === 'conflict'
        ? '候选世界中的相关来源存在未解决冲突。'
        : '候选世界中没有匹配的语义资源。',
    requirementKey: requirement.key,
  }
}

function worldRequirementGoal(
  resources: Awaited<ReturnType<typeof openWorldSemanticResourceCatalogV1>>['resources'],
): UpperProductWorldRequirementGoalV1 {
  const areas = [...new Set(resources.flatMap(resource => resource.worldSemantic?.area ?? []))].sort()
  const resourceKinds = [...new Set(resources.flatMap(resource => resource.worldSemantic?.resourceKind ?? []))].sort()
  const contextKinds = [...new Set(resources.map(resource => resource.kind))].sort()
  const participantCount = resources.filter(resource => resource.worldSemantic?.area === 'characters').length
  return {
    selectedAreas: areas,
    selectedResourceKinds: resourceKinds,
    selectedContextKinds: contextKinds,
    selectedResourceCount: resources.length,
    participantCount,
    includeSelectedRelations: participantCount > 1,
    inheritStoryContinuity: true,
    allowCrossWorld: false,
  }
}

function worldResourceCounts(
  resources: Awaited<ReturnType<typeof openWorldSemanticResourceCatalogV1>>['description']['resources'],
): TextOpenWorldCreatorWorldResourceCountsV1 {
  const areas = new Map<string, { resourceCount: number; rowCount: number }>()
  const kinds = new Map<string, { resourceCount: number; rowCount: number }>()
  for (const resource of resources) {
    const area = areas.get(resource.area) ?? { resourceCount: 0, rowCount: 0 }
    area.resourceCount += 1
    area.rowCount += resource.rowCount
    areas.set(resource.area, area)
    const kind = kinds.get(resource.resourceKind) ?? { resourceCount: 0, rowCount: 0 }
    kind.resourceCount += 1
    kind.rowCount += resource.rowCount
    kinds.set(resource.resourceKind, kind)
  }
  return {
    totalResources: resources.length,
    totalRows: resources.reduce((total, resource) => total + resource.rowCount, 0),
    byArea: [...areas.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([area, value]) => ({ area: area as TextOpenWorldCreatorWorldResourceCountsV1['byArea'][number]['area'], ...value })),
    byKind: [...kinds.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([resourceKind, value]) => ({ resourceKind, ...value })),
  }
}

function capabilityGaps(
  capabilities: TextOpenWorldCreatorWorldSourceCandidateV1['capabilities'],
): TextOpenWorldCreatorSourceGapV1[] {
  return capabilities.flatMap(capability => {
    if (capability.status === 'available') return []
    return [{
      code: `world-capability-${capability.status}`,
      severity: capability.status === 'missing' ? 'recommendation' as const : 'warning' as const,
      title: capability.status === 'missing'
        ? `世界能力缺失：${capability.area}`
        : `世界能力不完整：${capability.area}`,
      detail: capability.status === 'missing'
        ? '该能力区没有可供文字开放世界生产读取的确认资源。'
        : `该能力区仍有候选、冲突或省略内容；当前仅有 ${capability.confirmedRowCount} 条确认记录。`,
      requirementKey: null,
    }]
  })
}

function sameWorldReference(
  left: WorldReferenceCatalogEntryV1['reference'],
  right: WorldReferenceCatalogEntryV1['reference'],
): boolean {
  return left.localReleaseRecordId === right.localReleaseRecordId
    && left.worldCode === right.worldCode
    && left.releaseUid === right.releaseUid
    && left.releaseVersion === right.releaseVersion
    && left.releaseHash === right.releaseHash
    && left.referenceHash === right.referenceHash
    && left.manifestIdentity.schemaHash === right.manifestIdentity.schemaHash
    && left.capabilityIdentity.catalogHash === right.capabilityIdentity.catalogHash
    && left.capabilityIdentity.profileHash === right.capabilityIdentity.profileHash
}

async function inspectWorldCatalogEntryV1(input: {
  scope: WorkspaceScope
  entry: WorldReferenceCatalogEntryV1
}): Promise<TextOpenWorldCreatorWorldSourceCandidateV1> {
  const catalog = await openWorldSemanticResourceCatalogV1({
    localReleaseRecordId: input.entry.reference.localReleaseRecordId,
    expectedProjectId: input.scope.projectId,
    expectedWorldId: input.scope.worldId,
  })
  const openedReference = catalog.description.worldReference
  if (!sameWorldReference(input.entry.reference, openedReference)
    || catalog.description.identity.releaseHash !== input.entry.reference.releaseHash
    || catalog.description.identity.releaseVersion !== input.entry.reference.releaseVersion) {
    fail('world-release-drift', 'WorldRelease 目录与打开结果的 ID、Hash 或版本不一致')
  }
  const requirementPreview = await previewWorldRequirementsV1({
    adapter: TEXT_OPEN_WORLD_REQUIREMENT_ADAPTER_V1,
    goal: worldRequirementGoal(catalog.resources),
    descriptors: catalog.resources,
  })
  const gaps = [
    ...requirementPreview.requirements.flatMap(requirement => {
      const gap = requirementGap(requirement)
      return gap ? [gap] : []
    }),
    ...capabilityGaps(catalog.description.capabilities),
  ]
  return {
    schema: 'storyforge.text-open-world-creator-world-source-candidate',
    version: 1,
    sourceKind: 'world-release',
    worldReference: structuredClone(input.entry.reference),
    label: input.entry.label,
    worldName: catalog.description.identity.worldName,
    workTitle: catalog.description.identity.workTitle,
    releasedAt: catalog.description.identity.releasedAt,
    capabilities: structuredClone(catalog.description.capabilities),
    resourceCounts: worldResourceCounts(catalog.description.resources),
    requirements: structuredClone(requirementPreview.requirements),
    readiness: readinessFromGaps(gaps),
    gaps,
  }
}

/** List verified world candidates without exposing WorldRelease rows or their
 * physical manifests. Every returned entry has also passed the neutral open
 * boundary so its owner, local id, portable hash, and capabilities agree. */
export async function listTextOpenWorldCreatorWorldSourcesV1(
  scope: WorkspaceScope,
): Promise<TextOpenWorldCreatorWorldSourceCandidateV1[]> {
  const entries = await listWorldReferenceCatalogV1(scope)
  return Promise.all(entries.map(entry => inspectWorldCatalogEntryV1({ scope, entry })))
}

export async function inspectTextOpenWorldCreatorWorldSourceV1(input: {
  scope: WorkspaceScope
  localReleaseRecordId: number
  expectedReleaseHash: string
}): Promise<TextOpenWorldCreatorWorldSourceCandidateV1> {
  if (!Number.isSafeInteger(input.localReleaseRecordId) || input.localReleaseRecordId < 1) {
    fail('world-release-id', 'localReleaseRecordId 必须是正整数')
  }
  if (!HASH.test(input.expectedReleaseHash)) fail('world-release-hash', 'expectedReleaseHash 必须是完整 SHA-256')
  const entries = await listWorldReferenceCatalogV1(input.scope)
  const entry = entries.find(candidate => candidate.reference.localReleaseRecordId === input.localReleaseRecordId)
  if (!entry) fail('world-release-owner', 'WorldRelease 不属于给定 worldScope')
  if (entry.reference.releaseHash !== input.expectedReleaseHash) {
    fail('world-release-stale', 'WorldRelease Hash 已变化或候选身份不匹配')
  }
  return inspectWorldCatalogEntryV1({ scope: input.scope, entry })
}

function novelGaps(
  snapshot: TextOpenWorldNovelSourceSnapshotPreviewV1,
  outlineOnlyUnitCount = 0,
): TextOpenWorldCreatorSourceGapV1[] {
  const gaps: TextOpenWorldCreatorSourceGapV1[] = []
  if (snapshot.storyCoreCount === 0) gaps.push({
    code: 'novel-story-core-missing',
    severity: 'recommendation',
    title: '建议补充故事核心',
    detail: '来源仍可使用，但缺少主题、核心冲突和主支线等稳定叙事锚点。',
    requirementKey: null,
  })
  if (snapshot.outlines.length === 0) gaps.push({
    code: 'novel-outline-missing',
    severity: 'warning',
    title: '来源没有选中章纲',
    detail: '模型只能从正文推断结构，后续主支线拆解的稳定性会降低。',
    requirementKey: null,
  })
  if (snapshot.writtenChapterCount === 0) gaps.push({
    code: 'novel-full-text-missing',
    severity: 'warning',
    title: '当前范围只有大纲',
    detail: '可以继续规划，但人物语气、场景细节和任务素材需要后续补充。',
    requirementKey: null,
  })
  if (outlineOnlyUnitCount > 0 && snapshot.writtenChapterCount > 0) gaps.push({
    code: 'novel-range-partial-text',
    severity: 'recommendation',
    title: '部分章纲没有正文',
    detail: `当前范围有 ${outlineOnlyUnitCount} 个章纲单元尚无对应正文。`,
    requirementKey: null,
  })
  return gaps
}

function assertCatalogMatchesSnapshot(input: {
  workTitle: string
  outlineIds: number[]
  chapterWords: Array<{ id: number; wordCount: number }>
  snapshot: TextOpenWorldNovelSourceSnapshotPreviewV1
}): void {
  if (input.workTitle !== input.snapshot.workTitle
    || input.outlineIds.join(',') !== input.snapshot.outlines.map(outline => outline.id).join(',')
    || input.chapterWords.map(chapter => `${chapter.id}:${chapter.wordCount}`).join(',')
      !== input.snapshot.chapters.map(chapter => `${chapter.id}:${chapter.wordCount}`).join(',')) {
    fail('novel-source-drift', '小说目录与快照准备期间发生变化，请重新预检')
  }
}

export async function listTextOpenWorldCreatorNovelSourceCatalogV1(
  sourceScope: WorkspaceScope,
): Promise<TextOpenWorldCreatorNovelSourceCatalogV1> {
  const [catalog, snapshot] = await Promise.all([
    listAdaptationSourceOptions(sourceScope),
    prepareTextOpenWorldNovelSourceSnapshotV1({ sourceScope, selection: { mode: 'entire-work' } }),
  ])
  assertCatalogMatchesSnapshot({
    workTitle: catalog.workTitle,
    outlineIds: catalog.outlines.map(outline => outline.id),
    chapterWords: catalog.chapters.map(chapter => ({ id: chapter.id, wordCount: chapter.wordCount })),
    snapshot,
  })
  const gaps = novelGaps(snapshot)
  return {
    schema: 'storyforge.text-open-world-creator-novel-source-catalog',
    version: 1,
    sourceKind: 'novel',
    workCode: snapshot.workCode,
    workTitle: snapshot.workTitle,
    sourceUpdatedAt: snapshot.sourceUpdatedAt,
    coverage: snapshot.coverage,
    outlines: structuredClone(snapshot.outlines),
    chapters: structuredClone(snapshot.chapters),
    range: {
      firstChapterId: snapshot.chapters[0]?.id ?? null,
      lastChapterId: snapshot.chapters[snapshot.chapters.length - 1]?.id ?? null,
      outlineCount: snapshot.outlines.length,
      chapterCount: snapshot.chapters.length,
    },
    totalWordCount: snapshot.totalWordCount,
    readiness: readinessFromGaps(gaps),
    gaps,
  }
}

export async function inspectTextOpenWorldCreatorNovelSourceV1(input: {
  sourceScope: WorkspaceScope
  selection: AdaptationSourceSelectionV1
}): Promise<TextOpenWorldCreatorNovelSourcePreviewV1> {
  const [catalog, adaptationPreview, snapshot] = await Promise.all([
    listAdaptationSourceOptions(input.sourceScope),
    previewAdaptationSourceSelection(input),
    prepareTextOpenWorldNovelSourceSnapshotV1(input),
  ])
  if (catalog.workTitle !== snapshot.workTitle
    || adaptationPreview.coverage !== snapshot.coverage
    || adaptationPreview.writtenChapterCount !== snapshot.writtenChapterCount
    || adaptationPreview.totalWordCount !== snapshot.totalWordCount) {
    fail('novel-source-drift', '小说选择目录与快照准备结果不一致，请重新预检')
  }
  const gaps = novelGaps(snapshot, adaptationPreview.outlineOnlyUnitCount)
  return {
    ...snapshot,
    readiness: readinessFromGaps(gaps),
    gaps,
  }
}

export async function inspectTextOpenWorldCreatorSourceV1(input:
  | {
      sourceKind: 'world-release'
      scope: WorkspaceScope
      localReleaseRecordId: number
      expectedReleaseHash: string
    }
  | {
      sourceKind: 'novel'
      sourceScope: WorkspaceScope
      selection: AdaptationSourceSelectionV1
    }
): Promise<TextOpenWorldCreatorSourcePreviewV1> {
  return input.sourceKind === 'world-release'
    ? inspectTextOpenWorldCreatorWorldSourceV1(input)
    : inspectTextOpenWorldCreatorNovelSourceV1(input)
}
