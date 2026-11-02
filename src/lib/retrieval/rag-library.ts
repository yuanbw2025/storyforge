/**
 * RAG-1 · 可见资料库投影与精确选择。
 *
 * 这里不复制 Canon：资料正文实时投影自现有业务表；仅把稳定 ragDocumentId 和作者的
 * 启用/权重/token 策略写回源记录。节点执行仍通过 CONTEXT_SOURCES.ragSelection 读取。
 */
import Dexie from 'dexie'
import { estimateTokens } from '../ai/context-budget'
import { db } from '../db/schema'
import {
  type RagDocumentMetadata,
  type RagDocumentPolicy,
  type RagFieldPolicy,
  type RagLibraryEntry,
  type RagSelectionTraceCollector,
} from '../types'
import type { ContextResourceDescriptorV1 } from '../registry/types'
import type { WorkspaceScope } from '../types/world-ownership'
import type { RagAnnotationTargetSelectionV1, RagAnnotationTargetStateV1 } from '../types/rag-library'
import { deriveNarrativeTargetStateV1 } from './narrative-target-state'
import { isRagSelectionEnabledV1, ragSourceFieldPolicyKeysV1 } from './rag-policy'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveReadScopeLike,
  resolveScope,
  scopeTransactionTables,
  type WorkspaceScopeLike,
} from '../workspace/scope'
import { REGISTRY_BY_NAME } from '../registry/project-tables'
import { FIELD_BY_TARGET } from '../registry/field-registry'
import { hashCanonicalValue } from '../agent/run/hash'
import { canonicalNarrativeJsonV1 } from '../world-engine/narrative-json'
import { ContextResourceIdentityError, isPortableResourceUidV1 } from '../context-gateway/resource-uid'
import {
  CANON_RESOURCE_PROVIDER_V1,
  CanonResourceProviderError,
  logicalFieldKeyFromResourceKeyV1,
  readCanonicalDescriptorV1,
} from '../context-gateway/canon-provider'

type RagRow = RagDocumentMetadata & {
  id?: number
  projectId: number
  updatedAt?: number
  createdAt?: number
}

const DEFAULT_WEIGHT = 1
const DEFAULT_TOKEN_CAP = 4000
const MIN_TOKEN_CAP = 100
const MAX_TOKEN_CAP = 50_000

function stableDocumentId(tableName: string, row: RagRow): string {
  const identity = REGISTRY_BY_NAME.get(tableName)?.resourceIdentity
  if (!identity) {
    throw new ContextResourceIdentityError('unregistered', `${tableName} 未登记 resource identity`)
  }
  if (!isPortableResourceUidV1(row.ragDocumentId, identity.resourceKind)) {
    throw new ContextResourceIdentityError(
      'identity-missing',
      `${tableName}#${row.id ?? '?'} 缺少 portable resource UID；请先执行显式 backfill`,
    )
  }
  return row.ragDocumentId
}

function recordPolicy(row: RagRow): Required<Omit<RagDocumentPolicy, 'fields'>> & {
  fields: Record<string, RagFieldPolicy>
} {
  return {
    enabled: isRagSelectionEnabledV1(row.ragPolicy),
    weight: normalizeWeight(row.ragPolicy?.weight),
    tokenCap: normalizeTokenCap(row.ragPolicy?.tokenCap),
    priority: row.ragPolicy?.priority === 'pinned' || row.ragPolicy?.priority === 'must-read'
      ? row.ragPolicy.priority
      : 'normal',
    fields: row.ragPolicy?.fields ?? {},
  }
}

function normalizeWeight(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(5, Math.max(0.1, value))
    : DEFAULT_WEIGHT
}

function normalizeTokenCap(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(MAX_TOKEN_CAP, Math.max(MIN_TOKEN_CAP, value)))
    : DEFAULT_TOKEN_CAP
}

function effectiveFieldPolicy(row: RagRow, fieldKey: string) {
  const record = recordPolicy(row)
  const own = record.fields[fieldKey] ?? {}
  return {
    enabled: isRagSelectionEnabledV1(row.ragPolicy, [fieldKey]),
    weight: normalizeWeight(own.weight ?? record.weight),
    tokenCap: normalizeTokenCap(own.tokenCap ?? record.tokenCap),
    priority: own.priority === 'pinned' || own.priority === 'must-read' ? own.priority : record.priority,
  }
}

function indexState(tableName: string, recordId: number, chapterChunks: Map<number, { count: number; embedded: number }>): Pick<RagLibraryEntry, 'chunkCount' | 'vectorState'> {
  if (tableName !== 'chapters') return { chunkCount: 0, vectorState: 'keyword' }
  const state = chapterChunks.get(recordId) ?? { count: 0, embedded: 0 }
  if (!state.count) return { chunkCount: 0, vectorState: 'none' }
  if (!state.embedded) return { chunkCount: state.count, vectorState: 'keyword' }
  if (state.embedded < state.count) return { chunkCount: state.count, vectorState: 'partial' }
  return { chunkCount: state.count, vectorState: 'ready' }
}

export function makeRagEntryKey(documentId: string, fieldKey: string): string {
  return `${documentId}::${encodeURIComponent(fieldKey)}`
}

function fieldLabel(tableName: string, fieldKey: string): string {
  const field = FIELD_BY_TARGET.get(tableName)?.find(candidate => candidate.field === fieldKey)
  return field?.label ?? field?.labels?.find(label => /[\u3400-\u9fff]/.test(label)) ?? fieldKey
}

function titleWithoutField(descriptor: ContextResourceDescriptorV1, label: string): string {
  const suffix = ` · ${label}`
  return descriptor.title.endsWith(suffix) ? descriptor.title.slice(0, -suffix.length) : descriptor.title
}

function descriptorFieldLabel(
  descriptor: ContextResourceDescriptorV1,
  tableName: string,
  fieldKey: string,
): string {
  const registered = fieldLabel(tableName, fieldKey)
  const separator = descriptor.title.lastIndexOf(' · ')
  return separator >= 0 ? descriptor.title.slice(separator + 3) : registered
}

async function listAllFieldDescriptors(scope: WorkspaceScope, worldGroupId: number | null,
  onReadRestart?: () => void): Promise<ContextResourceDescriptorV1[]> {
  const frozen = { ...scope, worldGroupId }
  for (let attempt = 0; ; attempt++) {
    const descriptors: ContextResourceDescriptorV1[] = []
    let cursor: string | undefined
    try {
      do {
        const page = await CANON_RESOURCE_PROVIDER_V1.listMetadata({ scope: frozen, limit: 100, cursor })
        descriptors.push(...page.items.filter(item => item.resourceKey.includes(':field:')))
        cursor = page.nextCursor ?? undefined
      } while (cursor)
      return descriptors
    } catch (error) {
      // The original-evidence caller may restart a read once before any model
      // request. Discard every old page; never combine catalog generations.
      if (!onReadRestart || attempt !== 0 || !(error instanceof CanonResourceProviderError)
        || !(error.code === 'catalog-mutated' || (cursor && error.code === 'cursor-scope'))) throw error
      onReadRestart()
    }
  }
}

/** 当前资料目录投影：字段集合由 Canon Provider 派生，不维护第二份表或字段清单。 */
export async function buildRagLibrary(input: {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId?: number | null
}): Promise<RagLibraryEntry[]> {
  const worldGroupId = input.worldGroupId ?? null
  const scope = await resolveScope({ projectId: input.projectId, scope: input.scope })
  const descriptors = await listAllFieldDescriptors(scope, worldGroupId)
  const chunks = await db.retrievalChunks.where('projectId').equals(input.projectId).toArray()
  const chapterChunks = new Map<number, { count: number; embedded: number }>()
  for (const chunk of chunks) {
    const current = chapterChunks.get(chunk.sourceChapterId) ?? { count: 0, embedded: 0 }
    current.count++
    if (chunk.embedding?.length) current.embedded++
    chapterChunks.set(chunk.sourceChapterId, current)
  }
  const entries: RagLibraryEntry[] = []
  for (const descriptor of descriptors) {
    const ref = descriptor.sourceRefs[0]
    if (!ref || typeof ref.recordId !== 'number') continue
    const spec = REGISTRY_BY_NAME.get(ref.table)
    if (!spec?.resourceIdentity) continue
    const row = await spec.table.get(ref.recordId) as RagRow | undefined
    if (!row) continue
    const documentId = stableDocumentId(ref.table, row)
    const fieldKey = logicalFieldKeyFromResourceKeyV1(descriptor.resourceKey)
    if (!fieldKey) continue
    const label = descriptorFieldLabel(descriptor, ref.table, fieldKey)
    const content = (await readCanonicalDescriptorV1({
      scope: { ...scope, worldGroupId },
      descriptor,
      depth: 'full',
      maxTokens: 100_000,
    })).content
    if (!content.trim()) continue
    const documentPolicy = recordPolicy(row)
    const policy = effectiveFieldPolicy(row, fieldKey)
    entries.push({
      key: makeRagEntryKey(documentId, fieldKey),
      documentId,
      tableName: ref.table,
      recordId: ref.recordId,
      sourceKey: descriptor.sourceKey,
      sourceLabel: spec.resourceIdentity.label,
      title: titleWithoutField(descriptor, label),
      fieldKey,
      fieldLabel: label,
      content,
      updatedAt: typeof ref.revision === 'number' ? ref.revision : 0,
      tokenEstimate: estimateTokens(content),
      documentEnabled: documentPolicy.enabled,
      documentWeight: documentPolicy.weight,
      documentTokenCap: documentPolicy.tokenCap,
      enabled: policy.enabled && descriptor.automaticSelectionEnabled !== false,
      weight: policy.weight,
      tokenCap: policy.tokenCap,
      priority: policy.priority,
      ...indexState(ref.table, ref.recordId, chapterChunks),
    })
  }

  return entries.sort((left, right) => (
    left.sourceLabel.localeCompare(right.sourceLabel, 'zh-CN')
    || left.title.localeCompare(right.title, 'zh-CN')
    || left.fieldLabel.localeCompare(right.fieldLabel, 'zh-CN')
  ))
}

async function updatePolicy(input: {
  projectId: number
  scope?: WorkspaceScope
  tableName: string
  recordId: number
  transform: (policy: RagDocumentPolicy) => RagDocumentPolicy
}): Promise<void> {
  const scope = await resolveScope({ projectId: input.projectId, scope: input.scope })
  const spec = REGISTRY_BY_NAME.get(input.tableName)
  if (!spec?.resourceIdentity) throw new Error(`不支持的 RAG 资料表：${input.tableName}`)
  await db.transaction('rw', scopeTransactionTables(spec.table), async () => {
    const row = await spec.table.get(input.recordId) as RagRow | undefined
    if (!row || !await assertRecordInScope(scope, input.tableName, row)) {
      throw new Error('资料记录不存在或不属于当前 World/Work。')
    }
    stableDocumentId(input.tableName, row)
    const next = input.transform(row.ragPolicy ?? {})
    const nextRevision = (row.ragPolicyRevision ?? 0) + 1
    const nextHash = await Dexie.waitFor(hashCanonicalValue({ version: 1, policy: next }))
    await spec.table.update(input.recordId, {
      ragPolicy: next,
      ragPolicyRevision: nextRevision,
      ragPolicyHash: nextHash,
    } as Partial<RagRow>)
  })
}

export async function updateRagDocumentPolicy(input: {
  projectId: number
  scope?: WorkspaceScope
  tableName: string
  recordId: number
  patch: RagFieldPolicy
}): Promise<void> {
  await updatePolicy({
    ...input,
    transform: policy => ({
      ...policy,
      ...input.patch,
      weight: input.patch.weight == null ? policy.weight : normalizeWeight(input.patch.weight),
      tokenCap: input.patch.tokenCap == null ? policy.tokenCap : normalizeTokenCap(input.patch.tokenCap),
    }),
  })
}

export async function updateRagFieldPolicy(input: {
  projectId: number
  scope?: WorkspaceScope
  tableName: string
  recordId: number
  fieldKey: string
  patch: RagFieldPolicy
}): Promise<void> {
  await updatePolicy({
    ...input,
    transform: policy => {
      const previous = policy.fields?.[input.fieldKey] ?? {}
      return {
        ...policy,
        fields: {
          ...policy.fields,
          [input.fieldKey]: {
            ...previous,
            ...input.patch,
            weight: input.patch.weight == null ? previous.weight : normalizeWeight(input.patch.weight),
            tokenCap: input.patch.tokenCap == null ? previous.tokenCap : normalizeTokenCap(input.patch.tokenCap),
          },
        },
      }
    },
  })
}

function capByTokens(content: string, budget: number): { content: string; trimmed: boolean } {
  if (estimateTokens(content) <= budget) return { content, trimmed: false }
  const marker = '\n…（该资料字段已按预算截断）'
  let low = 0
  let high = content.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (estimateTokens(`${content.slice(0, middle)}${marker}`) <= budget) low = middle
    else high = middle - 1
  }
  return { content: `${content.slice(0, low)}${marker}`, trimmed: true }
}

/**
 * CONTEXT_SOURCES.ragSelection 的读取实现。
 * 只读取节点明确选择且仍启用的字段，按权重排序并记录实际纳入/省略/裁剪原因。
 */
export async function readRagSelectionContext(input: {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId?: number | null
  entryKeys?: string[]
  originalEvidence?: boolean
  annotationTarget?: RagAnnotationTargetSelectionV1
  inputBudgetTokens?: number
  trace?: RagSelectionTraceCollector
}): Promise<string> {
  input.trace?.clear()
  if (input.annotationTarget && !input.originalEvidence) throw new Error('目标注释状态只允许通过精确原文模式读取')
  const requested = input.entryKeys ?? []
  if (input.annotationTarget && !requested.length) throw new Error('注释目标必须包含在已选原文中')
  if (!requested.length) return ''
  if (input.originalEvidence) return readRagOriginalSelectionV1(input)
  const library = await buildRagLibrary(input)
  const byKey = new Map(library.map(entry => [entry.key, entry]))
  const order = new Map(requested.map((key, index) => [key, index]))
  const selected = requested
    .map(key => byKey.get(key))
    .filter((entry): entry is RagLibraryEntry => !!entry)
    .sort((left, right) => right.weight - left.weight || order.get(left.key)! - order.get(right.key)!)

  for (const missing of requested.filter(key => !byKey.has(key))) {
    input.trace?.omitted.push(`${missing}（源记录或字段已不存在）`)
  }

  const totalBudget = normalizeTokenCap(input.inputBudgetTokens ?? 12_000)
  let remaining = totalBudget
  const blocks: string[] = []
  for (const entry of selected) {
    const label = `${entry.sourceLabel} / ${entry.title} / ${entry.fieldLabel}`
    if (!entry.enabled) {
      input.trace?.omitted.push(`${label}（资料库已停用）`)
      continue
    }
    if (remaining < MIN_TOKEN_CAP) {
      input.trace?.omitted.push(`${label}（节点总预算不足）`)
      continue
    }
    const budget = Math.min(entry.tokenCap, remaining)
    const heading = `【${label}｜权重 ${entry.weight.toFixed(1)}】\n`
    const capped = capByTokens(entry.content, Math.max(MIN_TOKEN_CAP, budget - estimateTokens(heading)))
    const block = `${heading}${capped.content}`
    const used = estimateTokens(block)
    blocks.push(block)
    remaining = Math.max(0, remaining - used)
    input.trace?.included.push(`${label}（${used} tokens，权重 ${entry.weight.toFixed(1)}）`)
    if (capped.trimmed) input.trace?.trimmed.push(`${label}（字段 token 上限）`)
  }
  return blocks.join('\n\n')
}

export interface RagOriginalFieldV1 {
  key: string
  table: string
  sourceUid: string
  fieldPointer: string
  text: string
  contentHash: string
  policyHash: string
}

/** Exact selection uses the existing resource permissions and original reader.
 * The returned transport has stable identities only, so a restored candidate
 * never points at another record merely because its local number was reused. */
async function readRagOriginalSelectionV1(input: {
  projectId: number; scope?: WorkspaceScope; worldGroupId?: number | null
  entryKeys?: string[]; inputBudgetTokens?: number
  annotationTarget?: RagAnnotationTargetSelectionV1
}): Promise<string> {
  const requested = input.entryKeys ?? []
  if (requested.length > 64 || new Set(requested).size !== requested.length) throw new Error('原文选择必须唯一且不超过 64 个字段')
  const scope = await resolveScope({ projectId: input.projectId, scope: input.scope })
  const frozenScope = { ...scope, worldGroupId: input.worldGroupId ?? null }
  let catalogReadRestarts = 0
  const descriptors = await listAllFieldDescriptors(scope, frozenScope.worldGroupId, () => { catalogReadRestarts++ })
  const fields: RagOriginalFieldV1[] = []
  let targetState: RagAnnotationTargetStateV1 | undefined
  for (const key of requested) {
    const matches = descriptors.filter(descriptor => {
      const field = logicalFieldKeyFromResourceKeyV1(descriptor.resourceKey)
      return field != null && descriptor.resourceKey.includes(`${key.split('::')[0]}:field:`)
        && makeRagEntryKey(key.split('::')[0], field) === key
    })
    if (matches.length !== 1) throw new Error(`选定原文不存在、不可读或身份不唯一：${key}`)
    const descriptor = matches[0]
    if (descriptor.sourceRefs.length !== 1) throw new Error('抽取需要未切片的单一原文字段')
    const ref = descriptor.sourceRefs[0]
    const row = await REGISTRY_BY_NAME.get(ref.table)?.table.get(ref.recordId as number) as RagRow | undefined
    if (!row || descriptor.automaticSelectionEnabled === false
      || !effectiveFieldPolicy(row, logicalFieldKeyFromResourceKeyV1(descriptor.resourceKey)!).enabled
      || !isRagSelectionEnabledV1(row.ragPolicy, ragSourceFieldPolicyKeysV1(ref.table, ref.field, (row as RagRow & { fields?: unknown }).fields))) {
      throw new Error('选定资料字段已停用；未调用模型')
    }
    const original = await CANON_RESOURCE_PROVIDER_V1.readOriginal({ scope: frozenScope,
      resourceKey: descriptor.resourceKey, sourceRef: ref, maxTokens: 100_000 })
    if (original.contentHash !== ref.contentHash || original.descriptor.policyHash !== descriptor.policyHash
      || (ref.anchor && (ref.anchor.start !== 0 || ref.anchor.end !== original.content.length))
      || ref.field !== logicalFieldKeyFromResourceKeyV1(descriptor.resourceKey)) {
      throw new Error('选定原文被裁剪或读取期间权限变化；请缩小选择后重试')
    }
    fields.push({ key, table: ref.table, sourceUid: key.split('::')[0],
      fieldPointer: `/${ref.field.replace(/~/g, '~0').replace(/\//g, '~1')}`,
      text: original.content, contentHash: original.contentHash, policyHash: descriptor.policyHash })
    if (input.annotationTarget?.table === ref.table && input.annotationTarget.sourceUid === key.split('::')[0]) {
      targetState = deriveNarrativeTargetStateV1(input.annotationTarget, row as unknown as Record<string, unknown>)
    }
  }
  if (input.annotationTarget && !targetState) throw new Error('注释目标必须包含在已选原文中')
  const text = canonicalNarrativeJsonV1({ version: 1, fields, catalogReadRestarts, ...(targetState ? { targetState } : {}) })
  if (estimateTokens(text) > (input.inputBudgetTokens ?? 12_000)) throw new Error('选定原文超过输入预算；未裁剪，请缩小选择')
  return text
}

export interface RecentRagRecall {
  runId: number
  startedAt: number
  nodeTitle: string
  included: string[]
  omitted: string[]
  trimmed: string[]
}

/** 读取最近节点运行中冻结的精确资料召回证据，不重新执行也不改写快照。 */
export async function readRecentRagRecalls(
  scopeInput: WorkspaceScopeLike,
  limit = 8,
): Promise<RecentRagRecall[]> {
  const scope = await resolveReadScopeLike(scopeInput)
  const runs = (await readOwnedRows<any>(scope, 'nodeRuns', { owner: 'work' }))
    .sort((left, right) => right.updatedAt - left.updatedAt)
  const recalls: RecentRagRecall[] = []
  for (const run of runs) {
    if (run.id == null) continue
    try {
      const snapshots = JSON.parse(run.inputSnapshotsJson || '{}') as Record<string, {
        nodeTitle?: string
        config?: { ragEntryKeys?: unknown }
        sourceEvidence?: {
          included?: string[]
          omitted?: string[]
          trimmed?: string[]
        }
      }>
      for (const snapshot of Object.values(snapshots)) {
        if (!Array.isArray(snapshot.config?.ragEntryKeys) || !snapshot.config?.ragEntryKeys.length) continue
        recalls.push({
          runId: run.id,
          startedAt: run.startedAt,
          nodeTitle: snapshot.nodeTitle || '项目元素节点',
          included: snapshot.sourceEvidence?.included ?? [],
          omitted: snapshot.sourceEvidence?.omitted ?? [],
          trimmed: snapshot.sourceEvidence?.trimmed ?? [],
        })
        if (recalls.length >= limit) return recalls
      }
    } catch {
      // 历史损坏运行不阻塞资料库；节点运行页仍会按原行为显示空快照。
    }
  }
  return recalls
}
