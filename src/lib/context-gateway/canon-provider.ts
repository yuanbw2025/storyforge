import { estimateTokens } from '../ai/context-budget'
import {
  CHAPTER_TEXT_NORMALIZATION_VERSION,
  normalizeChapterText,
  sha256Text,
} from '../ai/chapter-memory/text-normalization'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { db } from '../db/schema'
import { FIELD_BY_TARGET } from '../registry/field-registry'
import { PROJECT_TABLES, REGISTRY_BY_NAME } from '../registry/project-tables'
import type {
  ContextResourceAuthorityV1,
  ContextResourceDescriptorV1,
  ContextResourceKind,
  ContextResourceProviderV1,
  ContextResourceReadV1,
  ContextResourceRelationV1,
  ContextSourceRefV1,
  ContextTimeRangeV1,
  FieldSpec,
  FrozenResourceScopeV1,
  OriginalEvidenceReadInputV1,
  OriginalEvidenceReadV1,
  ResourceListInputV1,
  ResourcePageV1,
  ResourceReadInputV1,
  ResourceSearchInputV1,
  TableSpec,
} from '../registry/types'
import type { RagDocumentPolicy, RagFieldPolicy } from '../types/rag-library'
import { parseEntryFields, parseFieldSchema } from '../types/codex'
import { normalizeDetailedScenes } from '../types/detailed-outline'
import { parseStages } from '../types/story-arc'
import {
  buildLongTermConsistencyDossierV1,
  formatLongTermConsistencyDossierV1,
} from '../memory/consistency-dossier'
import { htmlToPlainText } from '../utils/html'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import { isPortableResourceUidV1 } from './resource-uid'
import {
  narrativePlanMatchesSourceRefsV1,
  planNarrativeRetrievalV1,
} from './narrative-retrieval'
import {
  contextGatewayCacheEpochV1,
  createCachedContextResourceProviderV1,
} from './provider-cache'

const PROVIDER_SOURCE_KEY = 'ragSelection'
const PROVIDER_VERSION = 'canon-resource-provider-v2'
const NORMALIZATION_VERSION = 'canon-resource-normalization-v1'
const MAX_PAGE_SIZE = 100
const MAX_READ_TOKENS = 100_000
const SYSTEM_FIELDS = new Set([
  'id', 'projectId', 'worldId', 'workId', 'worldGroupId', 'homeWorldGroupId',
  'createdAt', 'updatedAt', 'ragDocumentId', 'ragPolicy', 'ragPolicyRevision',
  'ragPolicyHash', 'summarySourceTextHash', 'summaryTextNormalizationVersion',
  'version', 'schemaVersion',
])

type ResourceIdentity = NonNullable<TableSpec['resourceIdentity']>
type ResourceSpec = TableSpec & { resourceIdentity: ResourceIdentity }
type ResourceRow = Record<string, unknown> & {
  id?: number
  projectId: number
  createdAt?: number
  updatedAt?: number
  ragDocumentId?: string
  ragPolicy?: RagDocumentPolicy
  ragPolicyRevision?: number
  ragPolicyHash?: string
}

interface FieldProjectionV1 {
  key: string
  label: string
  exact: string
  presented: string
  sourceFields: Array<{ key: string; exact: string }>
}

interface ProjectedResourceV1 {
  descriptor: ContextResourceDescriptorV1
  fullContent: string
  focusedContent: string
}

interface CatalogCursorV1 {
  version: 1
  tableIndex: number
  recordId: number
  itemIndex: number
  requestHash: string
  scopeFingerprint: string
}

interface LocatedProjectionV1 {
  projected: ProjectedResourceV1
  tableIndex: number
  recordId: number
  itemIndex: number
}

interface ResourceLocatorV1 {
  tableName: string
  recordId: number
}

const MAX_RESOURCE_LOCATORS_V1 = 100_000

// Disposable acceleration only. The epoch is advanced by the existing global
// Dexie mutation boundary, so a locator can never outlive the Canon generation
// that produced its descriptor. Reads still reload the row and revalidate
// scope/content/policy hashes; this map is not a second identity authority.
let RESOURCE_LOCATORS_V1 = new Map<string, ResourceLocatorV1>()
let resourceLocatorEpochV1 = -1

function locatorCacheKeyV1(scopeFingerprint: string, resourceKey: string): string {
  const epoch = contextGatewayCacheEpochV1()
  if (resourceLocatorEpochV1 !== epoch) {
    RESOURCE_LOCATORS_V1 = new Map<string, ResourceLocatorV1>()
    resourceLocatorEpochV1 = epoch
  }
  return `${scopeFingerprint}\u0000${resourceKey}`
}

function rememberResourceLocatorV1(input: {
  scopeFingerprint: string
  resourceKey: string
  tableName: string
  recordId: number
}): void {
  if (RESOURCE_LOCATORS_V1.size >= MAX_RESOURCE_LOCATORS_V1) {
    RESOURCE_LOCATORS_V1 = new Map<string, ResourceLocatorV1>()
  }
  RESOURCE_LOCATORS_V1.set(locatorCacheKeyV1(input.scopeFingerprint, input.resourceKey), {
    tableName: input.tableName,
    recordId: input.recordId,
  })
}

export class CanonResourceProviderError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`[canon-resource:${code}] ${message}`)
    this.name = 'CanonResourceProviderError'
  }
}

function fail(code: string, message: string): never {
  throw new CanonResourceProviderError(code, message)
}

function resourceSpecs(): ResourceSpec[] {
  return PROJECT_TABLES.filter((spec): spec is ResourceSpec => spec.resourceIdentity != null)
}

export const CANON_RESOURCE_KINDS_V1: readonly ContextResourceKind[] = [...new Set(
  resourceSpecs().map(spec => spec.resourceIdentity.contextKind),
)].sort()

function priority(value: unknown): 'normal' | 'pinned' | 'must-read' {
  return value === 'pinned' || value === 'must-read' ? value : 'normal'
}

function normalizeWeight(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(5, Math.max(0.1, value))
    : 1
}

function normalizeTokenCap(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(50_000, Math.max(100, value)))
    : 4000
}

function normalizedPolicy(value: RagFieldPolicy | undefined): Required<RagFieldPolicy> {
  return {
    enabled: value?.enabled !== false,
    weight: normalizeWeight(value?.weight),
    tokenCap: normalizeTokenCap(value?.tokenCap),
    priority: priority(value?.priority),
  }
}

async function resourcePolicy(row: ResourceRow, fieldKey?: string): Promise<{
  revision: number
  hash: string
  priority: 'normal' | 'pinned' | 'must-read'
  weight: number
  tokenCap: number
}> {
  const raw = row.ragPolicy ?? {}
  const documentHash = await hashCanonicalValue({ version: 1, policy: raw })
  if (row.ragPolicyHash && row.ragPolicyHash !== documentHash) {
    fail('policy-hash-mismatch', `资源 ${row.ragDocumentId ?? '?'} 的检索策略 hash 已损坏`)
  }
  const document = normalizedPolicy(raw)
  if (!fieldKey) {
    return {
      revision: row.ragPolicyRevision ?? 0,
      hash: documentHash,
      priority: document.priority,
      weight: document.weight,
      tokenCap: document.tokenCap,
    }
  }
  const own = normalizedPolicy(raw.fields?.[fieldKey])
  const effective = {
    enabled: document.enabled && own.enabled,
    weight: raw.fields?.[fieldKey]?.weight == null ? document.weight : own.weight,
    tokenCap: raw.fields?.[fieldKey]?.tokenCap == null ? document.tokenCap : own.tokenCap,
    priority: raw.fields?.[fieldKey]?.priority == null ? document.priority : own.priority,
  }
  return {
    revision: row.ragPolicyRevision ?? 0,
    hash: await hashCanonicalValue({ version: 1, documentHash, fieldKey, effective }),
    priority: effective.priority,
    weight: effective.weight,
    tokenCap: effective.tokenCap,
  }
}

function exactValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value == null) return ''
  try {
    return canonicalStringify(value)
  } catch {
    return ''
  }
}

function isMeaningful(value: unknown, exact: string): boolean {
  if (value == null || !exact.trim()) return false
  if (['[]', '{}', 'null'].includes(exact.trim())) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as object).length > 0
  return true
}

function presentedValue(tableName: string, fieldKey: string, exact: string): string {
  return tableName === 'chapters' && fieldKey === 'content' ? htmlToPlainText(exact) : exact.trim()
}

function labelForField(field: FieldSpec | undefined, fieldKey: string): string {
  return field?.label
    ?? field?.labels?.find(label => /[\u3400-\u9fff]/.test(label))
    ?? fieldKey
}

function semanticFieldAllowed(key: string, value: unknown): boolean {
  if (SYSTEM_FIELDS.has(key) || key.startsWith('_') || key.endsWith('Hash')) return false
  if (key.endsWith('Id') || key.endsWith('Ids')) return false
  if (typeof value === 'function'
    || (typeof Blob !== 'undefined' && value instanceof Blob)
    || value instanceof ArrayBuffer) return false
  return true
}

async function fieldsForRow(spec: ResourceSpec, row: ResourceRow): Promise<FieldProjectionV1[]> {
  const registered = spec.resourceIdentity.descriptorMode === 'registered-fields'
    ? (FIELD_BY_TARGET.get(spec.name) ?? [])
    : null
  const definitions = registered
    ? [...new Map(registered.map(item => [item.field, item])).values()]
      .map(field => ({ key: field.field, field }))
    : Object.keys(row).sort().map(key => ({ key, field: undefined }))
  const projected: FieldProjectionV1[] = []
  for (const definition of definitions) {
    const value = row[definition.key]
    if (!semanticFieldAllowed(definition.key, value)) continue
    const exact = exactValue(value)
    if (!isMeaningful(value, exact)) continue
    projected.push({
      key: definition.key,
      label: labelForField(definition.field, definition.key),
      exact,
      presented: presentedValue(spec.name, definition.key, exact),
      sourceFields: [{ key: definition.key, exact }],
    })
  }

  // Codex 自定义字段使用稳定 custom.* 命名空间；定义实时派生自分类 schema，不维护第二份字段清单。
  if (spec.name === 'codexEntries' && typeof row.categoryId === 'number') {
    const category = await db.codexCategories.get(row.categoryId)
    if (category?.projectId === row.projectId) {
      const stored = parseEntryFields(typeof row.fields === 'string' ? row.fields : undefined)
      const fieldsExact = exactValue(row.fields)
      for (const definition of parseFieldSchema(category.fieldSchema)) {
        const value = stored[definition.key]
        const exact = exactValue(value)
        if (!isMeaningful(value, exact)) continue
        projected.push({
          key: `custom.${definition.key}`,
          label: definition.label || definition.key,
          exact,
          presented: exact.trim(),
          sourceFields: [{ key: 'fields', exact: fieldsExact }],
        })
      }
    }
  }

  // 物品流水提供一个当前的聚合事件资源，证据仍精确指向组成它的实际源字段。
  if (spec.name === 'itemLedger') {
    const holder = typeof row.heldByName === 'string' && row.heldByName.trim() ? row.heldByName.trim() : '未知持有人'
    const itemName = exactValue(row.itemName).trim()
    const quantity = exactValue(row.quantity).trim()
    const action = row.action === 'gain' ? '获得' : '消耗'
    const chapterTitle = exactValue(row.chapterTitle).trim()
    if (itemName && quantity) {
      projected.push({
        key: 'event',
        label: '物品事件',
        exact: `${holder}${action}${quantity} × ${itemName}${chapterTitle ? `（${chapterTitle}）` : ''}`,
        presented: `${holder}${action}${quantity} × ${itemName}${chapterTitle ? `（${chapterTitle}）` : ''}`,
        sourceFields: ['heldByName', 'action', 'quantity', 'itemName', 'chapterTitle']
          .filter(key => isMeaningful(row[key], exactValue(row[key])))
          .map(key => ({ key, exact: exactValue(row[key]) })),
      })
    }
  }
  return projected
}

function short(value: string, limit = 240): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`
}

function rowTitle(spec: ResourceSpec, row: ResourceRow): string {
  for (const key of ['title', 'name', 'entityName', 'subjectName', 'itemName', 'key']) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  // Singleton worldview rows intentionally have no author-facing name. Preserve
  // the established library label instead of rendering the source label twice.
  if (spec.name === 'worldviews') {
    return row.worldGroupId == null ? '主世界观' : '当前世界观'
  }
  return spec.resourceIdentity.label
}

function revisionOf(row: ResourceRow): number {
  return typeof row.updatedAt === 'number' ? row.updatedAt : typeof row.createdAt === 'number' ? row.createdAt : 0
}

async function sourceRef(
  spec: ResourceSpec,
  row: ResourceRow,
  fieldKey: string,
  exact: string,
): Promise<ContextSourceRefV1> {
  if (!Number.isInteger(row.id)) fail('record-id', `${spec.name} 资源缺少 numeric id`)
  const contentHash = await sha256Text(exact)
  return {
    table: spec.name,
    recordId: row.id!,
    field: fieldKey,
    revision: revisionOf(row),
    contentHash,
    anchor: { start: 0, end: exact.length, quoteHash: contentHash },
  }
}

async function scopeForRow(
  frozen: FrozenResourceScopeV1,
  spec: ResourceSpec,
  row: ResourceRow,
): Promise<ContextResourceDescriptorV1['scope']> {
  const result: ContextResourceDescriptorV1['scope'] = { projectId: frozen.projectId }
  const locator = spec.domainOwner?.locator
  if (locator?.kind === 'parent') {
    const parentSpec = REGISTRY_BY_NAME.get(locator.table)
    const parentId = row[locator.field]
    const parent = parentSpec && typeof parentId === 'number'
      ? await parentSpec.table.get(parentId) as ResourceRow | undefined
      : undefined
    if (!parentSpec || !parent || parent.projectId !== frozen.projectId) {
      fail('owner-parent', `${spec.name}#${row.id ?? '?'} 缺少可验证的 owner 父记录`)
    }
    Object.assign(result, await scopeForRow(frozen, parentSpec as ResourceSpec, parent))
  }
  const allowed = spec.domainOwner?.allowed ?? []
  const hasWorld = typeof row.worldId === 'number'
  const hasWork = typeof row.workId === 'number'
  if (hasWorld || (allowed.includes('world') && !allowed.includes('work'))) result.worldId = (row.worldId as number | undefined) ?? frozen.worldId
  if (hasWork || (allowed.includes('work') && !allowed.includes('world'))) result.workId = (row.workId as number | undefined) ?? frozen.workId
  if (result.workId != null && result.worldId == null) result.worldId = frozen.worldId
  const group = await worldGroupForRow(spec, row, frozen.worldGroupId)
  if (group !== undefined) result.worldGroupId = group
  const chapterId = chapterForRow(spec.name, row)
  if (chapterId != null) result.chapterId = chapterId
  return result
}

async function worldGroupForRow(
  spec: ResourceSpec,
  row: ResourceRow,
  fallback: number | null | undefined,
): Promise<number | null | undefined> {
  if (spec.name === 'worldGroups') return row.id ?? undefined
  if (spec.name === 'worldGroupLinks') return fallback
  // Codex 分类 schema 属于整个 World，而不是某个 worldGroup。
  if (spec.name === 'codexCategories') return undefined
  if (typeof row.worldGroupId === 'number' || row.worldGroupId === null) return row.worldGroupId as number | null
  if (spec.homeWorldScoped) return (row.homeWorldGroupId as number | null | undefined) ?? null
  let outlineNodeId: number | undefined
  if (spec.name === 'chapters') outlineNodeId = row.outlineNodeId as number | undefined
  else if (spec.name === 'detailedOutlines') outlineNodeId = row.outlineNodeId as number | undefined
  else if (spec.name === 'emotionBeatCards') {
    const chapter = await db.chapters.get(row.chapterId as number)
    outlineNodeId = chapter?.outlineNodeId
  }
  if (outlineNodeId != null) return (await db.outlineNodes.get(outlineNodeId))?.worldGroupId ?? null
  return undefined
}

function chapterForRow(tableName: string, row: ResourceRow): number | undefined {
  if (tableName === 'chapters') return row.id
  for (const key of ['chapterId', 'sourceChapterId', 'lastActiveChapterId', 'plantChapterId']) {
    if (typeof row[key] === 'number') return row[key] as number
  }
  return undefined
}

async function visibleInScope(
  workspace: { projectId: number; worldId: number; workId: number },
  frozen: FrozenResourceScopeV1,
  spec: ResourceSpec,
  row: ResourceRow,
): Promise<boolean> {
  if (row.projectId !== frozen.projectId || !await assertRecordInScope(workspace, spec.name, row)) return false
  if (spec.name === 'knowledgeLedger'
    && Object.prototype.hasOwnProperty.call(frozen, 'characterId')) {
    return frozen.characterId != null && row.characterId === frozen.characterId
  }
  const selectedGroup = frozen.worldGroupId
  if (spec.name === 'worldGroups') return selectedGroup == null || row.id === selectedGroup
  if (spec.name === 'worldGroupLinks') {
    return selectedGroup == null
      || row.fromGroupId === selectedGroup
      || row.toGroupId === selectedGroup
  }
  if (spec.homeWorldScoped) {
    return row.isCrossWorld === true || ((row.homeWorldGroupId ?? null) === (selectedGroup ?? null))
  }
  if (spec.worldScoped) {
    const field = spec.worldGroupField ?? 'worldGroupId'
    return (row[field] ?? null) === (selectedGroup ?? null)
  }
  const derivedGroup = await worldGroupForRow(spec, row, undefined)
  return derivedGroup === undefined || derivedGroup === (selectedGroup ?? null)
}

function recordKey(spec: ResourceSpec, row: ResourceRow): string {
  const identity = spec.resourceIdentity
  if (!isPortableResourceUidV1(row.ragDocumentId, identity.resourceKind)) {
    fail('identity-missing', `${spec.name}#${row.id ?? '?'} 缺少 portable resource UID`)
  }
  return `${identity.contextKind}:${row.ragDocumentId}`
}

function fieldKey(spec: ResourceSpec, row: ResourceRow, key: string): string {
  return `${recordKey(spec, row)}:field:${encodeURIComponent(key)}`
}

function relationKind(field: string): ContextResourceRelationV1['kind'] {
  if (field === 'parentId' || field === 'moduleId') return 'parent'
  if (/CharacterId$/.test(field)) return 'same-entity'
  if (/ChapterId$/.test(field)) return 'appears-in'
  if (/GroupId$/.test(field)) return 'world-link'
  return 'depends-on'
}

async function relationsForRow(spec: ResourceSpec, row: ResourceRow): Promise<ContextResourceRelationV1[]> {
  const relations: ContextResourceRelationV1[] = []
  for (const remap of spec.exportRemap ?? []) {
    const value = row[remap.field]
    if (!Number.isInteger(value)) continue
    const targetSpec = REGISTRY_BY_NAME.get(remap.remapVia)
    if (!targetSpec?.resourceIdentity) continue
    const target = await targetSpec.table.get(value as number) as ResourceRow | undefined
    if (!target || !isPortableResourceUidV1(target.ragDocumentId, targetSpec.resourceIdentity.resourceKind)) continue
    relations.push({
      kind: relationKind(remap.field),
      targetResourceKey: `${targetSpec.resourceIdentity.contextKind}:${target.ragDocumentId}`,
      direction: 'outgoing',
    })
  }
  return [...new Map(relations.map(item => [
    `${item.kind}\u0000${item.targetResourceKey}\u0000${item.direction}`,
    item,
  ])).values()].sort((left, right) => left.targetResourceKey.localeCompare(right.targetResourceKey))
}

function timeRangeForRow(tableName: string, row: ResourceRow): ContextTimeRangeV1 | undefined {
  if (tableName === 'chapters') {
    return { start: row.order as number | undefined, end: row.order as number | undefined, ...(row.id == null ? {} : { throughChapterId: row.id }) }
  }
  if (tableName === 'outlineNodes') {
    return { start: row.order as number | undefined, end: row.order as number | undefined }
  }
  if (tableName === 'temporalFacts') {
    return {
      start: row.validFromChapterId as number | undefined,
      end: row.validToChapterId as number | undefined,
      ...(typeof row.validToChapterId === 'number' ? { throughChapterId: row.validToChapterId } : {}),
    }
  }
  const chapterId = chapterForRow(tableName, row)
  if (chapterId != null) return { throughChapterId: chapterId }
  for (const key of ['date', 'time', 'year', 'timestamp']) {
    if (typeof row[key] === 'string' || typeof row[key] === 'number') return { start: row[key] as string | number }
  }
  return undefined
}

async function chapterDerivedAuthority(row: ResourceRow, field: string): Promise<ContextResourceAuthorityV1> {
  if (!['summary', 'continuityHandoff', 'planReconciliation'].includes(field)) return 'author-canon'
  const content = typeof row.content === 'string' ? normalizeChapterText(row.content) : ''
  const currentHash = await sha256Text(content)
  const derivedValue = row[field] as { sourceTextHash?: unknown; textNormalizationVersion?: unknown } | undefined
  const normalizationVersion = field === 'summary'
    ? row.summaryTextNormalizationVersion
    : derivedValue?.textNormalizationVersion
  const expected = field === 'summary'
    ? row.summarySourceTextHash
    : derivedValue?.sourceTextHash
  return expected === currentHash && normalizationVersion === CHAPTER_TEXT_NORMALIZATION_VERSION
    ? 'derived-summary'
    : 'candidate'
}

async function authorityFor(spec: ResourceSpec, row: ResourceRow, field?: string): Promise<ContextResourceAuthorityV1> {
  if (spec.name === 'chapters' && field) return chapterDerivedAuthority(row, field)
  if (spec.name === 'temporalFacts' || spec.name === 'knowledgeLedger') {
    return row.status === 'confirmed' ? 'confirmed-evidence' : 'candidate'
  }
  if (spec.name === 'characterDrivenPlans') return row.status === 'adopted' ? 'author-canon' : 'candidate'
  if (spec.name === 'narrativeModules' || spec.name === 'narrativeNodes') {
    return row.status === 'draft' ? 'candidate' : 'author-canon'
  }
  if (spec.name === 'inspirationWorkspaces') return 'candidate'
  if (spec.name === 'userStyleProfiles') return 'derived-summary'
  if (spec.name === 'references' && (field === 'analysisSummary' || field === 'importedData')) return 'derived-summary'
  if (spec.name === 'cultivationProgress') return 'confirmed-evidence'
  return 'author-canon'
}

function conservativeAuthority(values: readonly ContextResourceAuthorityV1[]): ContextResourceAuthorityV1 {
  if (values.includes('candidate')) return 'candidate'
  if (values.includes('derived-summary')) return 'derived-summary'
  if (values.includes('confirmed-evidence')) return 'confirmed-evidence'
  if (values.includes('adopted-canon')) return 'adopted-canon'
  return 'author-canon'
}

async function makeDescriptor(input: {
  spec: ResourceSpec
  row: ResourceRow
  frozenScope: FrozenResourceScopeV1
  resourceKey: string
  title: string
  shortSummary: string
  fullContent: string
  focusedContent?: string
  sourceRefs: ContextSourceRefV1[]
  relations: ContextResourceRelationV1[]
  authority: ContextResourceAuthorityV1
  originalTokenEstimate?: number
  policyField?: string
  timeRange?: ContextTimeRangeV1
}): Promise<ProjectedResourceV1> {
  const policy = await resourcePolicy(input.row, input.policyField)
  const sourceRefs = [...new Map(input.sourceRefs.map(ref => [
    `${ref.table}\u0000${ref.recordId}\u0000${ref.field}\u0000${ref.revision}\u0000${ref.contentHash}`,
    ref,
  ])).values()]
  const contentRevision = sourceRefs.reduce<number | string>((latest, ref) => (
    typeof latest === 'number' && typeof ref.revision === 'number'
      ? Math.max(latest, ref.revision)
      : String(ref.revision) > String(latest) ? ref.revision : latest
  ), 0)
  const contentHash = await sha256Text(input.fullContent)
  return {
    descriptor: {
      version: 1,
      resourceKey: input.resourceKey,
      sourceKey: PROVIDER_SOURCE_KEY,
      kind: input.spec.resourceIdentity.contextKind,
      title: input.title,
      shortSummary: short(input.shortSummary),
      authority: input.authority,
      contentRevision,
      contentHash,
      policyRevision: policy.revision,
      policyHash: policy.hash,
      scope: await scopeForRow(input.frozenScope, input.spec, input.row),
      relations: input.relations,
      ...(input.timeRange ? { timeRange: input.timeRange } : {}),
      sourceRefs,
      tokenEstimate: {
        index: estimateTokens(`${input.title}\n${short(input.shortSummary)}`),
        summary: estimateTokens(short(input.shortSummary, 600)),
        focused: estimateTokens(input.focusedContent ?? input.fullContent),
        full: estimateTokens(input.fullContent),
        original: input.originalTokenEstimate ?? estimateTokens(input.fullContent),
      },
      availableDepths: ['index', 'summary', 'focused', 'full', 'original'],
      priority: policy.priority,
      retrievalWeight: policy.weight,
      tokenCap: policy.tokenCap,
    },
    fullContent: input.fullContent,
    focusedContent: input.focusedContent ?? input.fullContent,
  }
}

async function genericResources(
  spec: ResourceSpec,
  row: ResourceRow,
  frozenScope: FrozenResourceScopeV1,
): Promise<ProjectedResourceV1[]> {
  const fields = await fieldsForRow(spec, row)
  if (!fields.length) return []
  const baseTitle = rowTitle(spec, row)
  const groupId = spec.homeWorldScoped
    ? (typeof row.homeWorldGroupId === 'number' ? row.homeWorldGroupId : null)
    : (typeof row.worldGroupId === 'number' ? row.worldGroupId : null)
  const group = groupId == null ? undefined : await db.worldGroups.get(groupId)
  const scopeIdentity = spec.homeWorldScoped && row.isCrossWorld === true
    ? '跨世界'
    : group?.projectId === row.projectId ? `世界：${group.name}` : ''
  const title = scopeIdentity ? `${baseTitle} · ${scopeIdentity}` : baseTitle
  const relations = await relationsForRow(spec, row)
  const refsByField = await Promise.all(fields.map(current => Promise.all(
    current.sourceFields.map(source => sourceRef(spec, row, source.key, source.exact)),
  )))
  const refs = refsByField.flat()
  const fieldAuthorities = await Promise.all(fields.map(current => authorityFor(spec, row, current.key)))
  const body = [`【${spec.resourceIdentity.label} / ${title}】`, ...fields.map(current => `${current.label}：${current.presented}`)].join('\n')
  const preferred = fields.find(current => ['summary', 'description', 'overview', 'logline', 'progressNote'].includes(current.key)) ?? fields[0]
  const record = await makeDescriptor({
    spec,
    row,
    frozenScope,
    resourceKey: recordKey(spec, row),
    title: `${spec.resourceIdentity.label} · ${title}`,
    shortSummary: preferred.presented,
    fullContent: body,
    focusedContent: preferred.presented,
    sourceRefs: refs,
    relations,
    authority: conservativeAuthority(fieldAuthorities),
    timeRange: timeRangeForRow(spec.name, row),
  })
  const fieldResources = await Promise.all(fields.map(async (current, index) => makeDescriptor({
    spec,
    row,
    frozenScope,
    resourceKey: fieldKey(spec, row, current.key),
    title: `${title} · ${current.label}`,
    shortSummary: current.presented,
    fullContent: current.presented,
    originalTokenEstimate: estimateTokens(current.exact),
    sourceRefs: refsByField[index],
    relations: [{ kind: 'parent', targetResourceKey: recordKey(spec, row), direction: 'outgoing' }, ...relations],
    authority: fieldAuthorities[index],
    policyField: current.key,
    timeRange: timeRangeForRow(spec.name, row),
  })))
  return [record, ...fieldResources]
}

async function nestedStoryStages(
  spec: ResourceSpec,
  row: ResourceRow,
  frozenScope: FrozenResourceScopeV1,
): Promise<ProjectedResourceV1[]> {
  if (spec.name !== 'storyArcs' || typeof row.stages !== 'string') return []
  const stages = parseStages(row.stages)
  const ref = await sourceRef(spec, row, 'stages', row.stages)
  const relations = await relationsForRow(spec, row)
  const nested = await Promise.all(stages.map(async stage => {
    const stageKey = `${recordKey(spec, row)}:stage:${encodeURIComponent(stage.id)}`
    const body = canonicalStringify(stage)
    const stageResource = await makeDescriptor({
      spec,
      row,
      frozenScope,
      resourceKey: stageKey,
      title: `${rowTitle(spec, row)} · ${stage.title}`,
      shortSummary: stage.description || stage.title,
      fullContent: body,
      sourceRefs: [ref],
      relations: [{ kind: 'parent', targetResourceKey: recordKey(spec, row), direction: 'outgoing' }, ...relations],
      authority: 'author-canon',
      policyField: 'stages',
      timeRange: { start: stage.startVolume, end: stage.endVolume },
    })
    const eventResources = await Promise.all(stage.keyEvents.map((event, index) => makeDescriptor({
      spec,
      row,
      frozenScope,
      // StoryStage currently owns stable IDs while key events are ordered values.
      // The stable parent stage plus ordinal keeps an unchanged event addressable
      // without inventing a second identity outside the registered schema.
      resourceKey: `${stageKey}:event:${index + 1}`,
      title: `${rowTitle(spec, row)} · ${stage.title} · 关键事件 ${index + 1}`,
      shortSummary: event,
      fullContent: event,
      sourceRefs: [ref],
      relations: [{ kind: 'parent', targetResourceKey: stageKey, direction: 'outgoing' }, ...relations],
      authority: 'author-canon',
      policyField: 'stages',
      timeRange: { start: stage.startVolume, end: stage.endVolume },
    })))
    return [stageResource, ...eventResources]
  }))
  return nested.flat()
}

async function nestedDetailedScenes(
  spec: ResourceSpec,
  row: ResourceRow,
  frozenScope: FrozenResourceScopeV1,
): Promise<ProjectedResourceV1[]> {
  if (spec.name !== 'detailedOutlines') return []
  const scenes = normalizeDetailedScenes(row.scenes)
  if (!scenes.length) return []
  const exact = exactValue(row.scenes)
  const ref = await sourceRef(spec, row, 'scenes', exact)
  const relations = await relationsForRow(spec, row)
  return Promise.all(scenes.map(scene => makeDescriptor({
    spec,
    row,
    frozenScope,
    resourceKey: `${recordKey(spec, row)}:scene:${encodeURIComponent(scene.sceneId)}`,
    title: `${rowTitle(spec, row)} · ${scene.title}`,
    shortSummary: scene.summary || scene.title,
    fullContent: canonicalStringify(scene),
    sourceRefs: [ref],
    relations: [{ kind: 'parent', targetResourceKey: recordKey(spec, row), direction: 'outgoing' }, ...relations],
    authority: 'author-canon',
    policyField: 'scenes',
  })))
}

async function nestedWrittenBoundary(
  spec: ResourceSpec,
  row: ResourceRow,
  frozenScope: FrozenResourceScopeV1,
): Promise<ProjectedResourceV1[]> {
  if (spec.name !== 'chapters' || typeof row.content !== 'string' || !row.content.trim()) return []
  const refs = await Promise.all(['title', 'content', 'wordCount', 'status']
    .filter(field => row[field] !== undefined)
    .map(field => sourceRef(spec, row, field, exactValue(row[field]))))
  const relations = await relationsForRow(spec, row)
  const wordCount = typeof row.wordCount === 'number' ? row.wordCount : 0
  const contentHash = await sha256Text(row.content)
  const body = [
    '【已写正文保护边界】',
    `章节：${rowTitle(spec, row)}`,
    `章节 ID：${row.id}`,
    `大纲节点 ID：${exactValue(row.outlineNodeId)}`,
    `状态：${exactValue(row.status) || 'draft'}`,
    `字数：${wordCount}`,
    `正文 hash：${contentHash}`,
    '约束：该章节已有正文，只读；未来大纲生成不得覆盖、重排或替换该章。',
  ].join('\n')
  return [await makeDescriptor({
    spec,
    row,
    frozenScope,
    resourceKey: `${recordKey(spec, row)}:written-boundary`,
    title: `${rowTitle(spec, row)} · 已写正文保护边界`,
    shortSummary: `已有正文 ${wordCount} 字；outlineNodeId=${exactValue(row.outlineNodeId)}`,
    fullContent: body,
    sourceRefs: refs,
    relations: [{ kind: 'parent', targetResourceKey: recordKey(spec, row), direction: 'outgoing' }, ...relations],
    authority: 'author-canon',
    policyField: 'content',
  })]
}

async function nestedChapterContinuity(
  spec: ResourceSpec,
  row: ResourceRow,
  frozenScope: FrozenResourceScopeV1,
): Promise<ProjectedResourceV1[]> {
  if (spec.name !== 'chapters' || typeof row.content !== 'string' || !row.content.trim()) return []
  const plain = normalizeChapterText(row.content)
  const tail = plain.slice(-4_000)
  const derivedFields = (await Promise.all(
    ['summary', 'continuityHandoff', 'planReconciliation'].map(async field => {
      if (row[field] === undefined || !exactValue(row[field]).trim()) return null
      const authority = await chapterDerivedAuthority(row, field)
      return authority === 'candidate' ? null : { field, authority }
    }),
  )).filter((item): item is NonNullable<typeof item> => item != null)
  const includedDerivedFields = new Set(derivedFields.map(item => item.field))
  const fields = ['content', ...derivedFields.map(item => item.field)]
  const refs = await Promise.all(fields.map(field => sourceRef(spec, row, field, exactValue(row[field]))))
  const relations = await relationsForRow(spec, row)
  const body = [
    '【章节直接连续性】',
    `章节：${rowTitle(spec, row)}`,
    includedDerivedFields.has('summary') ? `已验摘要：${exactValue(row.summary)}` : '',
    includedDerivedFields.has('continuityHandoff') ? `交接：${exactValue(row.continuityHandoff)}` : '',
    includedDerivedFields.has('planReconciliation') ? `计划对账：${exactValue(row.planReconciliation)}` : '',
    `原文尾部（最多 4000 字符）：\n${tail}`,
  ].filter(Boolean).join('\n')
  return [await makeDescriptor({
    spec,
    row,
    frozenScope,
    resourceKey: `${recordKey(spec, row)}:continuity-tail`,
    title: `${rowTitle(spec, row)} · 直接连续性`,
    shortSummary: tail.slice(-360),
    fullContent: body,
    sourceRefs: refs,
    relations: [{ kind: 'parent', targetResourceKey: recordKey(spec, row), direction: 'outgoing' }, ...relations],
    // The author-written tail is always Canon. Verified derived memory may
    // enrich it, while stale/unverified memory is omitted instead of hiding the
    // entire mandatory continuity resource as an undiscoverable candidate.
    authority: conservativeAuthority(['author-canon', ...derivedFields.map(item => item.authority)]),
    policyField: 'content',
    timeRange: timeRangeForRow(spec.name, row),
  })]
}

/**
 * PROSE-1: expose the deterministic long-term consistency dossier as a real
 * Canon resource.  The previous CONTEXT_SOURCES reader produced useful text,
 * but it could not be frozen in a Gateway inventory or revalidated at
 * adoption.  This aggregate is anchored to the boundary chapter and carries
 * exact refs for every row used by the dossier, including the canonical
 * chapter sequence that decides temporal visibility.
 */
async function nestedConsistencyDossier(
  spec: ResourceSpec,
  row: ResourceRow,
  frozenScope: FrozenResourceScopeV1,
): Promise<ProjectedResourceV1[]> {
  if (spec.name !== 'chapters' || typeof row.id !== 'number'
    || frozenScope.chapterId !== row.id) return []
  const dossier = await buildLongTermConsistencyDossierV1({
    scope: {
      projectId: frozenScope.projectId,
      worldId: frozenScope.worldId!,
      workId: frozenScope.workId!,
    },
    boundaryChapterId: row.id,
    maxTokens: 5_500,
  })
  const refs: ContextSourceRefV1[] = []
  const referenced = new Map<string, Set<number>>()
  for (const ref of dossier.sourceRefs) {
    if (typeof ref.recordId !== 'number') continue
    referenced.set(ref.table, new Set([
      ...(referenced.get(ref.table) ?? []),
      ref.recordId,
    ]))
  }
  // The descriptor content hash is rebuilt from the complete dossier during
  // adoption freshness checks. Source refs remain a bounded exact provenance
  // sample (the Gateway capability contract permits at most 64 per resource).
  const boundaryFields = (await fieldsForRow(spec, row)).filter(field => (
    ['title', 'outlineNodeId', 'order', 'content'].includes(field.key)
  ))
  refs.push(...await Promise.all(boundaryFields.flatMap(field => field.sourceFields)
    .map(field => sourceRef(spec, row, field.key, field.exact))))
  for (const [table, ids] of referenced) {
    const registered = REGISTRY_BY_NAME.get(table)
    if (!registered?.resourceIdentity) continue
    for (const id of [...ids].sort((left, right) => left - right)) {
      const sourceRow = await registered.table.get(id) as ResourceRow | undefined
      if (!sourceRow || sourceRow.projectId !== row.projectId) continue
      if (refs.length >= 64) break
      const field = (await fieldsForRow(registered as ResourceSpec, sourceRow))[0]
      const source = field?.sourceFields[0]
      if (source) refs.push(await sourceRef(registered as ResourceSpec, sourceRow, source.key, source.exact))
    }
    if (refs.length >= 64) break
  }
  const body = formatLongTermConsistencyDossierV1(dossier)
  return [await makeDescriptor({
    spec,
    row,
    frozenScope,
    resourceKey: `${recordKey(spec, row)}:consistency-dossier`,
    title: `${rowTitle(spec, row)} · 长期一致性档案`,
    shortSummary: `边界章节 #${row.id}；${dossier.sourceRefs.length} 条权威来源；${dossier.findings.length} 个待核对项`,
    fullContent: body,
    sourceRefs: refs,
    relations: [{ kind: 'parent', targetResourceKey: recordKey(spec, row), direction: 'outgoing' }],
    authority: 'confirmed-evidence',
    policyField: 'content',
    timeRange: timeRangeForRow(spec.name, row),
  })]
}

async function worldLinkAggregate(
  spec: ResourceSpec,
  row: ResourceRow,
  frozenScope: FrozenResourceScopeV1,
): Promise<ProjectedResourceV1 | null> {
  if (spec.name !== 'worldGroupLinks') return null
  const from = await db.worldGroups.get(row.fromGroupId as number) as ResourceRow | undefined
  const to = await db.worldGroups.get(row.toGroupId as number) as ResourceRow | undefined
  const groupSpec = REGISTRY_BY_NAME.get('worldGroups') as ResourceSpec | undefined
  if (!from || !to || !groupSpec?.resourceIdentity || from.projectId !== row.projectId || to.projectId !== row.projectId) {
    fail('world-link-target', `世界通道 ${row.id ?? '?'} 的端点缺失或越界`)
  }
  const linkFields = await fieldsForRow(spec, row)
  const ruleKeys = ['name', 'entryCondition', 'exitCondition', 'powerRestriction', 'takeawayRules']
  const fromRules = (await fieldsForRow(groupSpec, from)).filter(item => ruleKeys.includes(item.key))
  const toRules = (await fieldsForRow(groupSpec, to)).filter(item => ruleKeys.includes(item.key))
  const refs = [
    ...await Promise.all(linkFields.flatMap(item => item.sourceFields).map(item => sourceRef(spec, row, item.key, item.exact))),
    ...await Promise.all(fromRules.flatMap(item => item.sourceFields).map(item => sourceRef(groupSpec, from, item.key, item.exact))),
    ...await Promise.all(toRules.flatMap(item => item.sourceFields).map(item => sourceRef(groupSpec, to, item.key, item.exact))),
  ]
  const fromName = rowTitle(groupSpec, from)
  const toName = rowTitle(groupSpec, to)
  const body = [
    `【世界通道】${typeof row.name === 'string' && row.name.trim() ? row.name : `${fromName} → ${toName}`}`,
    `方向：${fromName} → ${toName}`,
    `双向：${row.bidirectional === true ? '是' : '否'}`,
    `类型：${exactValue(row.linkType) || '未设置'}`,
    `描述：${exactValue(row.description) || '未设置'}`,
    `源世界离开条件：${exactValue(from.exitCondition) || '未设置'}`,
    `目标世界进入条件：${exactValue(to.entryCondition) || '未设置'}`,
    `目标世界力量限制：${exactValue(to.powerRestriction) || '未设置'}`,
    `目标世界带出规则：${exactValue(to.takeawayRules) || '未设置'}`,
    ...(row.bidirectional === true ? [
      `反向离开条件：${exactValue(to.exitCondition) || '未设置'}`,
      `反向进入条件：${exactValue(from.entryCondition) || '未设置'}`,
      `反向力量限制：${exactValue(from.powerRestriction) || '未设置'}`,
      `反向带出规则：${exactValue(from.takeawayRules) || '未设置'}`,
    ] : []),
  ].join('\n')
  return makeDescriptor({
    spec,
    row,
    frozenScope,
    resourceKey: recordKey(spec, row),
    title: `${fromName} → ${toName}`,
    shortSummary: `${row.bidirectional === true ? '双向' : '单向'} · ${exactValue(row.description) || exactValue(row.linkType)}`,
    fullContent: body,
    sourceRefs: refs,
    relations: [
      { kind: 'world-link', targetResourceKey: recordKey(groupSpec, from), direction: 'outgoing' },
      { kind: 'world-link', targetResourceKey: recordKey(groupSpec, to), direction: row.bidirectional === true ? 'undirected' : 'outgoing' },
    ],
    authority: 'author-canon',
  })
}

async function projectRow(
  spec: ResourceSpec,
  row: ResourceRow,
  frozenScope: FrozenResourceScopeV1,
): Promise<ProjectedResourceV1[]> {
  const generic = await genericResources(spec, row, frozenScope)
  const link = await worldLinkAggregate(spec, row, frozenScope)
  const withoutGenericLinkRecord = link
    ? generic.filter(item => item.descriptor.resourceKey !== recordKey(spec, row))
    : generic
  const nested = [
    ...await nestedStoryStages(spec, row, frozenScope),
    ...await nestedDetailedScenes(spec, row, frozenScope),
    ...await nestedWrittenBoundary(spec, row, frozenScope),
    ...await nestedChapterContinuity(spec, row, frozenScope),
    ...await nestedConsistencyDossier(spec, row, frozenScope),
  ]
  return [...(link ? [link] : []), ...withoutGenericLinkRecord, ...nested]
    .sort((left, right) => left.descriptor.resourceKey.localeCompare(right.descriptor.resourceKey))
}

async function validatedScope(scope: FrozenResourceScopeV1) {
  if (!Number.isInteger(scope.projectId) || !Number.isInteger(scope.worldId) || !Number.isInteger(scope.workId)) {
    fail('scope-incomplete', 'Canon catalog 必须冻结 projectId/worldId/workId')
  }
  const workspace = await resolveScope({ scope: {
    projectId: scope.projectId,
    worldId: scope.worldId!,
    workId: scope.workId!,
  } })
  if (scope.worldGroupId != null) {
    const group = await db.worldGroups.get(scope.worldGroupId)
    if (!group || !await assertRecordInScope(workspace, 'worldGroups', group, { owner: 'world' })) {
      fail('scope-world-group', 'worldGroupId 不属于冻结 World scope')
    }
  }
  if (scope.chapterId != null) {
    const chapter = await db.chapters.get(scope.chapterId)
    if (!chapter || !await assertRecordInScope(workspace, 'chapters', chapter, { owner: 'work' })) {
      fail('scope-chapter', 'chapterId 不属于冻结 Work scope')
    }
  }
  if (scope.characterId != null) {
    const character = await db.characters.get(scope.characterId)
    if (!character || !await assertRecordInScope(workspace, 'characters', character, { owner: 'world' })) {
      fail('scope-character', 'characterId 不属于冻结 World scope')
    }
    if (!(character.isCrossWorld === true
      || (character.homeWorldGroupId ?? null) === (scope.worldGroupId ?? null))) {
      fail('scope-character-world', 'characterId 不属于冻结 worldGroup scope')
    }
  }
  return workspace
}

export async function canonScopeFingerprintV1(scope: FrozenResourceScopeV1): Promise<string> {
  await validatedScope(scope)
  return hashCanonicalValue({ version: 1, scope: {
    projectId: scope.projectId,
    worldId: scope.worldId,
    workId: scope.workId,
    worldGroupId: scope.worldGroupId ?? null,
    chapterId: scope.chapterId ?? null,
    characterId: Object.prototype.hasOwnProperty.call(scope, 'characterId')
      ? scope.characterId ?? null
      : '__all__',
  } })
}

function encodeCursor(cursor: CatalogCursorV1): string {
  return btoa(JSON.stringify(cursor))
}

function decodeCursor(value: string | undefined): CatalogCursorV1 | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(atob(value)) as CatalogCursorV1
    if (parsed.version !== 1 || !Number.isSafeInteger(parsed.tableIndex) || parsed.tableIndex < 0
      || !Number.isSafeInteger(parsed.recordId) || parsed.recordId < 1
      || !Number.isSafeInteger(parsed.itemIndex) || parsed.itemIndex < 0
      || typeof parsed.requestHash !== 'string' || typeof parsed.scopeFingerprint !== 'string') {
      fail('cursor', '目录 cursor 字段非法')
    }
    return parsed
  } catch (error) {
    if (error instanceof CanonResourceProviderError) throw error
    fail('cursor', '目录 cursor 不是合法的 V1 cursor')
  }
}

function normalizedResourceKeys(values: readonly string[] | undefined, label: string): string[] {
  if (!values) return []
  if (values.length > 50 || values.some(value => typeof value !== 'string' || !value.trim())) {
    fail('filter', `${label} 必须是最多 50 个非空 resource key`)
  }
  return [...new Set(values.map(value => value.trim()))].sort()
}

function compareBoundary(left: number | string, right: number | string): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right), 'zh-CN', { numeric: true })
}

function matchesTimeRange(
  descriptor: ContextResourceDescriptorV1,
  requested: ContextTimeRangeV1 | undefined,
): boolean {
  if (!requested) return true
  const actual = descriptor.timeRange
  if (!actual) return false
  if (requested.throughChapterId != null) {
    const actualChapter = actual.throughChapterId ?? descriptor.scope.chapterId
    if (actualChapter == null || actualChapter > requested.throughChapterId) return false
  }
  if (requested.start != null && actual.end != null && compareBoundary(actual.end, requested.start) < 0) return false
  if (requested.end != null && actual.start != null && compareBoundary(actual.start, requested.end) > 0) return false
  return true
}

function assertTimeRangeFilter(value: ContextTimeRangeV1 | undefined): void {
  if (!value) return
  const unknown = Object.keys(value).filter(key => !['start', 'end', 'throughChapterId'].includes(key))
  if (unknown.length) fail('filter', `timeRange 含未知字段: ${unknown.join(',')}`)
  for (const key of ['start', 'end'] as const) {
    const boundary = value[key]
    if (boundary != null && (typeof boundary !== 'string' && typeof boundary !== 'number')) {
      fail('filter', `timeRange.${key} 必须是字符串或数字`)
    }
    if (typeof boundary === 'number' && !Number.isFinite(boundary)) fail('filter', `timeRange.${key} 必须是有限数值`)
    if (typeof boundary === 'string' && !boundary.trim()) fail('filter', `timeRange.${key} 不得为空`)
  }
  if (value.throughChapterId != null
    && (!Number.isSafeInteger(value.throughChapterId) || value.throughChapterId < 1)) {
    fail('filter', 'timeRange.throughChapterId 必须是正整数')
  }
  if (value.start == null && value.end == null && value.throughChapterId == null) {
    fail('filter', 'timeRange 至少需要 start/end/throughChapterId 之一')
  }
}

function matchesResourceKeys(
  descriptor: ContextResourceDescriptorV1,
  requested: readonly string[],
): boolean {
  if (!requested.length) return true
  const available = new Set([
    descriptor.resourceKey,
    ...descriptor.relations.map(relation => relation.targetResourceKey),
  ])
  return requested.some(key => available.has(key))
}

async function primaryKeys(spec: ResourceSpec, projectId: number): Promise<number[]> {
  const keys = await spec.table.where('projectId').equals(projectId).primaryKeys()
  return keys.filter((key): key is number => typeof key === 'number').sort((left, right) => left - right)
}

async function catalogPage(input: ResourceListInputV1 | ResourceSearchInputV1): Promise<ResourcePageV1> {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > MAX_PAGE_SIZE) {
    fail('limit', `目录 limit 必须在 1..${MAX_PAGE_SIZE}`)
  }
  const workspace = await validatedScope(input.scope)
  const scopeFingerprint = await canonScopeFingerprintV1(input.scope)
  const requestedKinds = [...new Set(input.kinds ?? CANON_RESOURCE_KINDS_V1)].sort()
  if (requestedKinds.some(kind => !CANON_RESOURCE_KINDS_V1.includes(kind))) fail('kind', '请求包含 Provider 未登记的 kind')
  const query = 'query' in input ? input.query.trim().toLocaleLowerCase('zh-CN') : ''
  if ('query' in input && !query) fail('query', '搜索 query 不得为空')
  const entityKeys = 'query' in input ? normalizedResourceKeys(input.entityKeys, 'entityKeys') : []
  const storyArcKeys = 'query' in input ? normalizedResourceKeys(input.storyArcKeys, 'storyArcKeys') : []
  const timeRange = 'query' in input ? input.timeRange : undefined
  assertTimeRangeFilter(timeRange)
  const catalogEpoch = contextGatewayCacheEpochV1()
  const requestHash = await hashCanonicalValue({
    version: 1, scopeFingerprint, catalogEpoch, requestedKinds, query, entityKeys, storyArcKeys, timeRange: timeRange ?? null,
  })
  const cursor = decodeCursor(input.cursor)
  if (cursor && (cursor.requestHash !== requestHash || cursor.scopeFingerprint !== scopeFingerprint)) {
    fail('cursor-scope', '目录 cursor 不属于当前 scope/filter/query')
  }
  const narrativePlan = query
    ? await planNarrativeRetrievalV1({ scope: input.scope, query, timeRange })
    : null
  const specs = resourceSpecs()
  const found: LocatedProjectionV1[] = []
  outer: for (let tableIndex = cursor?.tableIndex ?? 0; tableIndex < specs.length; tableIndex++) {
    const spec = specs[tableIndex]
    if (!requestedKinds.includes(spec.resourceIdentity.contextKind)) continue
    const ids = await primaryKeys(spec, input.scope.projectId)
    for (const recordId of ids) {
      if (cursor && tableIndex === cursor.tableIndex && recordId < cursor.recordId) continue
      const row = await spec.table.get(recordId) as ResourceRow | undefined
      if (!row || !await visibleInScope(workspace, input.scope, spec, row)) continue
      const resources = await projectRow(spec, row, input.scope)
      const start = cursor && tableIndex === cursor.tableIndex && recordId === cursor.recordId
        ? cursor.itemIndex
        : 0
      for (let itemIndex = start; itemIndex < resources.length; itemIndex++) {
        const projected = resources[itemIndex]
        rememberResourceLocatorV1({
          scopeFingerprint,
          resourceKey: projected.descriptor.resourceKey,
          tableName: spec.name,
          recordId,
        })
        const searchable = `${projected.descriptor.resourceKey}\n${projected.descriptor.title}\n${projected.descriptor.shortSummary}`
          .toLocaleLowerCase('zh-CN')
        const narrativeMatch = narrativePlan
          ? narrativePlanMatchesSourceRefsV1(narrativePlan, projected.descriptor.sourceRefs)
          : null
        const canonFallbackMatch = narrativeMatch?.canonFallback === true
          && projected.fullContent.toLocaleLowerCase('zh-CN').includes(query)
        if (query && !searchable.includes(query) && !narrativeMatch?.candidate && !canonFallbackMatch) continue
        if (!matchesResourceKeys(projected.descriptor, entityKeys)
          || !matchesResourceKeys(projected.descriptor, storyArcKeys)
          || !matchesTimeRange(projected.descriptor, timeRange)) continue
        found.push({ projected, tableIndex, recordId, itemIndex })
        if (found.length > input.limit) break outer
      }
    }
  }
  const pageItems = found.slice(0, input.limit)
  const last = pageItems[pageItems.length - 1]
  if (catalogEpoch !== contextGatewayCacheEpochV1()) {
    fail('catalog-mutated', '目录读取期间 Canon 已变化，请从第一页重新读取')
  }
  return {
    version: 1,
    items: pageItems.map(item => item.projected.descriptor),
    nextCursor: found.length > input.limit && last
      ? encodeCursor({
        version: 1,
        tableIndex: last.tableIndex,
        recordId: last.recordId,
        itemIndex: last.itemIndex + 1,
        requestHash,
        scopeFingerprint,
      })
      : null,
    scopeFingerprint,
  }
}

async function findProjection(input: {
  scope: FrozenResourceScopeV1
  resourceKey: string
}): Promise<ProjectedResourceV1> {
  const workspace = await validatedScope(input.scope)
  const scopeFingerprint = await canonScopeFingerprintV1(input.scope)
  const locator = RESOURCE_LOCATORS_V1.get(locatorCacheKeyV1(scopeFingerprint, input.resourceKey))
  if (locator) {
    const spec = REGISTRY_BY_NAME.get(locator.tableName)
    const row = spec?.resourceIdentity
      ? await spec.table.get(locator.recordId) as ResourceRow | undefined
      : undefined
    if (spec?.resourceIdentity && row
      && await visibleInScope(workspace, input.scope, spec as ResourceSpec, row)) {
      const found = (await projectRow(spec as ResourceSpec, row, input.scope))
        .find(item => item.descriptor.resourceKey === input.resourceKey)
      if (found) return found
    }
    // A missing/replaced row is expected after damaged imports or unexpected
    // cache state. Discard the disposable hints and use the authoritative scan.
    RESOURCE_LOCATORS_V1 = new Map<string, ResourceLocatorV1>()
  }
  for (const spec of resourceSpecs()) {
    if (!input.resourceKey.startsWith(`${spec.resourceIdentity.contextKind}:`)) continue
    for (const recordId of await primaryKeys(spec, input.scope.projectId)) {
      const row = await spec.table.get(recordId) as ResourceRow | undefined
      if (!row || !await visibleInScope(workspace, input.scope, spec, row)) continue
      const found = (await projectRow(spec, row, input.scope))
        .find(item => item.descriptor.resourceKey === input.resourceKey)
      if (found) return found
    }
  }
  fail('not-found', `资源不存在或不属于当前 scope: ${input.resourceKey}`)
}

async function findProjectionFromDescriptor(input: {
  scope: FrozenResourceScopeV1
  descriptor: ContextResourceDescriptorV1
}): Promise<ProjectedResourceV1> {
  const primary = input.descriptor.sourceRefs[0]
  const spec = primary && REGISTRY_BY_NAME.get(primary.table)
  if (!primary || typeof primary.recordId !== 'number' || !spec?.resourceIdentity) {
    fail('descriptor-source', '资源描述符没有可定位的 PROJECT_TABLES source ref')
  }
  if (!input.descriptor.resourceKey.startsWith(`${spec.resourceIdentity.contextKind}:`)) {
    fail('descriptor-source', '资源描述符 kind 与 source table 登记不一致')
  }
  const workspace = await validatedScope(input.scope)
  const row = await spec.table.get(primary.recordId) as ResourceRow | undefined
  if (!row || !await visibleInScope(workspace, input.scope, spec as ResourceSpec, row)) {
    fail('not-found', `资源不存在或不属于当前 scope: ${input.descriptor.resourceKey}`)
  }
  const current = (await projectRow(spec as ResourceSpec, row, input.scope))
    .find(item => item.descriptor.resourceKey === input.descriptor.resourceKey)
  if (!current) fail('not-found', `资源不存在或不属于当前 scope: ${input.descriptor.resourceKey}`)
  if (current.descriptor.contentHash !== input.descriptor.contentHash
    || current.descriptor.policyHash !== input.descriptor.policyHash) {
    fail('descriptor-stale', `资源描述符已过期: ${input.descriptor.resourceKey}`)
  }
  return current
}

function assertReadBudget(maxTokens: number): void {
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_READ_TOKENS) {
    fail('read-budget', `maxTokens 必须在 1..${MAX_READ_TOKENS}`)
  }
}

function capContent(content: string, maxTokens: number): string {
  if (estimateTokens(content) <= maxTokens) return content
  const marker = '\n…（resource read 已按显式预算截断；可用更大预算或回查原文）'
  let low = 0
  let high = content.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (estimateTokens(`${content.slice(0, middle)}${marker}`) <= maxTokens) low = middle
    else high = middle - 1
  }
  return `${content.slice(0, low)}${marker}`
}

async function buildResourceRead(
  projected: ProjectedResourceV1,
  depth: ResourceReadInputV1['depth'],
  maxTokens: number,
): Promise<ContextResourceReadV1> {
  const source = depth === 'index'
    ? `${projected.descriptor.title}\n${projected.descriptor.shortSummary}`
    : depth === 'summary'
      ? projected.descriptor.shortSummary
      : depth === 'focused'
        ? projected.focusedContent
        : projected.fullContent
  const content = capContent(source, maxTokens)
  return {
    version: 1,
    descriptor: projected.descriptor,
    depth,
    content,
    contentHash: await sha256Text(content),
    tokenCount: estimateTokens(content),
    sourceRefs: projected.descriptor.sourceRefs,
  }
}

async function readResource(input: ResourceReadInputV1): Promise<ContextResourceReadV1> {
  assertReadBudget(input.maxTokens)
  return buildResourceRead(await findProjection(input), input.depth, input.maxTokens)
}

/**
 * 当前资料目录 UI 已持有 descriptor 时的定点读取入口。
 * 它按 source ref 直接定位一行并重新校验当前 hash，避免为每个字段扫描整个目录。
 */
export async function readCanonicalDescriptorV1(input: {
  scope: FrozenResourceScopeV1
  descriptor: ContextResourceDescriptorV1
  depth: Exclude<ResourceReadInputV1['depth'], 'original'>
  maxTokens: number
}): Promise<ContextResourceReadV1> {
  assertReadBudget(input.maxTokens)
  const projected = await findProjectionFromDescriptor(input)
  return buildResourceRead(projected, input.depth, input.maxTokens)
}

export function logicalFieldKeyFromResourceKeyV1(resourceKey: string): string | null {
  const marker = ':field:'
  const offset = resourceKey.lastIndexOf(marker)
  if (offset < 0) return null
  try {
    return decodeURIComponent(resourceKey.slice(offset + marker.length))
  } catch {
    return null
  }
}

function sameSourceRef(left: ContextSourceRefV1, right: ContextSourceRefV1): boolean {
  return left.table === right.table
    && left.recordId === right.recordId
    && left.field === right.field
    && left.revision === right.revision
    && left.contentHash === right.contentHash
    && canonicalStringify(left.anchor ?? null) === canonicalStringify(right.anchor ?? null)
}

async function readOriginal(input: OriginalEvidenceReadInputV1): Promise<OriginalEvidenceReadV1> {
  assertReadBudget(input.maxTokens)
  const projected = await findProjection(input)
  const canonicalRef = projected.descriptor.sourceRefs.find(ref => sameSourceRef(ref, input.sourceRef))
  if (!canonicalRef) fail('source-ref', 'source ref 不属于资源当前版本，可能已 stale 或被伪造')
  const spec = REGISTRY_BY_NAME.get(canonicalRef.table)
  if (!spec) fail('source-table', `source ref 表未登记: ${canonicalRef.table}`)
  const row = await spec.table.get(canonicalRef.recordId as number) as ResourceRow | undefined
  const workspace = await validatedScope(input.scope)
  if (!row || !await assertRecordInScope(workspace, spec.name, row)) fail('source-scope', '原文来源不存在或越过 scope')
  const exact = exactValue(row[canonicalRef.field])
  if (revisionOf(row) !== canonicalRef.revision || await sha256Text(exact) !== canonicalRef.contentHash) {
    fail('source-stale', '原文来源 revision/hash 已变化')
  }
  let original = exact
  if (canonicalRef.anchor) {
    original = exact.slice(canonicalRef.anchor.start, canonicalRef.anchor.end)
    if (await sha256Text(original) !== canonicalRef.anchor.quoteHash) fail('anchor-stale', '原文锚点已失效')
  }
  const content = capContent(original, input.maxTokens)
  return {
    version: 1,
    descriptor: projected.descriptor,
    sourceRef: canonicalRef,
    content,
    contentHash: await sha256Text(content),
    tokenCount: estimateTokens(content),
  }
}

export const UNCACHED_CANON_RESOURCE_PROVIDER_V1: ContextResourceProviderV1 = {
  version: 'context-resource-provider-v1',
  providerId: 'storyforge-canon-resource-provider',
  providerVersion: PROVIDER_VERSION,
  normalizationVersion: NORMALIZATION_VERSION,
  kinds: CANON_RESOURCE_KINDS_V1,
  listMetadata: catalogPage,
  searchMetadata: catalogPage,
  read: readResource,
  readOriginal,
  fingerprint: canonScopeFingerprintV1,
}

export const CANON_RESOURCE_PROVIDER_V1: ContextResourceProviderV1 =
  createCachedContextResourceProviderV1(UNCACHED_CANON_RESOURCE_PROVIDER_V1)

export function contextResourceSpecsV1(): readonly ResourceSpec[] {
  return resourceSpecs()
}
