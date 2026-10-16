import { assembleContext } from '../registry/assemble-context'
import { AUTHORING_NODE_BY_ID } from './catalog'
import { buildRagLibrary, makeRagEntryKey } from '../retrieval/rag-library'
import { createRagSelectionTrace, type RagLibraryEntry } from '../types/rag-library'
import type { AuthoringCandidate, AuthoringNodeGraph, AuthoringNodeInstance } from './contracts'
import type { WorkspaceScope } from '../types/world-ownership'
import { readOwnedRows, resolveScopeLike } from '../workspace/scope'
import { REGISTRY_BY_NAME } from '../registry/project-tables'
import { FIELD_BY_TARGET } from '../registry/field-registry'
import type { AdoptResult } from '../registry/types'
import { isPortableResourceUidV1 } from '../context-gateway/resource-uid'

/**
 * FLOW-3 Canon binding adapter.
 *
 * A node stores only stable RAG keys and a last-observed fingerprint. The current
 * value is always read through the RAG projection and assembleContext, so this
 * module never becomes a second content authority.
 */
export interface AuthoringBindingRead {
  content: string
  sourceHash: string
  sourceKeys: string[]
  included: string[]
  omitted: string[]
  trimmed: string[]
  missing: string[]
}

export interface AuthoringTargetFingerprint {
  hash: string
  key?: string
  ambiguous?: boolean
}

export function hashAuthoringText(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function authoringConnectionsHash(graph: AuthoringNodeGraph, nodeId: string): string {
  return hashAuthoringText(JSON.stringify(graph.edges.filter(edge => edge.targetNodeId === nodeId)))
}

/** Registered, scoped Canon records; numeric ids never enter a portable receipt. */
export async function readAuthoringReceiptRows(scope: WorkspaceScope, target: string) {
  if (!REGISTRY_BY_NAME.get(target)?.resourceIdentity) return []
  return readOwnedRows<Record<string, unknown>>(scope, target)
}

function receiptRecordHash(row: Record<string, unknown>, fields: string[]): string {
  return hashAuthoringText(JSON.stringify(fields.map(field => [field, row[field] ?? null])))
}

export function assertAuthoringCanonReceipt(receipt: NonNullable<AuthoringCandidate['canonReceipt']>): void {
  const identity = receipt && REGISTRY_BY_NAME.get(receipt.target)?.resourceIdentity
  const allowed = new Set((FIELD_BY_TARGET.get(receipt?.target) ?? []).map(field => field.field))
  const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}$/.test(value)
  if (!identity || receipt.version !== 1 || !hash(receipt.outputHash) || !hash(receipt.connectionsHash)
    || !Array.isArray(receipt.records) || !receipt.records.length
    || receipt.records.some(record => !record || !isPortableResourceUidV1(record.documentId, identity.resourceKind)
      || !hash(record.hash) || !Array.isArray(record.fields) || !record.fields.length
      || record.fields.some(field => !allowed.has(field)) || new Set(record.fields).size !== record.fields.length)
    || new Set(receipt.records.map(record => record.documentId)).size !== receipt.records.length) {
    throw new Error('节点正式采纳回执无效。')
  }
}

export async function captureAuthoringCanonReceipt(input: {
  scope: WorkspaceScope
  target: string
  beforeIds: Set<number>
  result: AdoptResult
  output: string
  graph: AuthoringNodeGraph
  nodeId: string
}): Promise<AuthoringCandidate['canonReceipt']> {
  if (!input.result.written.length || input.result.unknown.length || input.result.typeErrors.length
    || input.result.fkErrors.length || input.result.skipped.length) return undefined
  const rows = await readAuthoringReceiptRows(input.scope, input.target)
  const knownIds = new Set(input.result.written.filter(item => item.id > 0).map(item => item.id))
  // The shared outline adapter reports the first id and count. Resolve its other
  // newly created records from the scoped table, without inventing ids or content.
  const written = rows.filter(row => typeof row.id === 'number'
    && (knownIds.has(row.id) || !input.beforeIds.has(row.id)))
  if (written.length !== input.result.written.length) return undefined
  const allowed = new Set((FIELD_BY_TARGET.get(input.target) ?? []).map(field => field.field))
  const commonFields = [...new Set(input.result.written.flatMap(item => item.fields))].filter(field => allowed.has(field)).sort()
  const records: NonNullable<AuthoringCandidate['canonReceipt']>['records'] = []
  for (const row of written) {
    const fields = [...new Set(input.result.written.find(item => item.id === row.id)?.fields ?? commonFields)]
      .filter(field => allowed.has(field)).sort()
    if (!isPortableResourceUidV1(row.ragDocumentId, REGISTRY_BY_NAME.get(input.target)!.resourceIdentity!.resourceKind)
      || !fields.length) return undefined
    records.push({ documentId: row.ragDocumentId, fields, hash: receiptRecordHash(row, fields) })
  }
  return { version: 1, target: input.target, outputHash: hashAuthoringText(input.output),
    connectionsHash: authoringConnectionsHash(input.graph, input.nodeId), records }
}

export async function isAuthoringCanonReceiptCurrent(input: {
  scope: WorkspaceScope
  candidate: AuthoringCandidate
  node: AuthoringNodeInstance
}): Promise<boolean> {
  const receipt = input.candidate.canonReceipt
  if (!receipt) return false
  try { assertAuthoringCanonReceipt(receipt) } catch { return false }
  if (receipt.target !== AUTHORING_NODE_BY_ID.get(input.node.templateId)?.writes?.target
    || receipt.outputHash !== hashAuthoringText(input.candidate.output)
    || !Array.isArray(receipt.records) || !receipt.records.length) return false
  const allowed = new Set((FIELD_BY_TARGET.get(receipt.target) ?? []).map(field => field.field))
  const rows = await readAuthoringReceiptRows(input.scope, receipt.target)
  return receipt.records.every(record => {
    const matches = rows.filter(row => row.ragDocumentId === record.documentId)
    return matches.length === 1 && Array.isArray(record.fields) && record.fields.length > 0
      && record.fields.every(field => allowed.has(field))
      && receiptRecordHash(matches[0], record.fields) === record.hash
  })
}

function arrayConfig(node: AuthoringNodeInstance, key: string): string[] {
  const value = node.config[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : []
}

function sourceKeysFor(node: AuthoringNodeInstance): string[] {
  const configured = arrayConfig(node, 'sourceKeys')
  return configured.length ? configured : AUTHORING_NODE_BY_ID.get(node.templateId)?.reads?.sourceKeys ?? []
}

function exactEntryKeysFor(node: AuthoringNodeInstance): string[] {
  const configured = arrayConfig(node, 'ragEntryKeys')
  if (configured.length) return configured
  const ref = node.binding?.ref
  if (!ref?.documentId || !ref.fieldKey) return []
  return [makeRagEntryKey(ref.documentId, ref.fieldKey)]
}

function fingerprintEntries(entries: RagLibraryEntry[], keys: string[]): string {
  return hashAuthoringText(keys.map(key => {
    const entry = entries.find(item => item.key === key)
    return `${key}:${entry?.content ?? ''}`
  }).join('\n'))
}

async function resolveChapterScope(node: AuthoringNodeInstance, scope: WorkspaceScope, worldGroupId: number | null) {
  const title = typeof node.config.chapterTitle === 'string' ? node.config.chapterTitle.trim() : ''
  if (!title) return {}
  const [chapters, outlines] = await Promise.all([
    readOwnedRows<any>(scope, 'chapters', { owner: 'work' }),
    readOwnedRows<any>(scope, 'outlineNodes', { owner: 'work' }),
  ])
  const outlineById = new Map(outlines.flatMap(item => item.id == null ? [] : [[item.id, item] as const]))
  const match = chapters.find(chapter => {
    const outline = outlineById.get(chapter.outlineNodeId)
    return chapter.title === title
      && (outline?.worldGroupId ?? null) === worldGroupId
  })
  return match?.id == null ? {} : { chapterId: match.id, outlineNodeId: match.outlineNodeId }
}

/** Read the current Canon value for a node's registered sources or exact fields. */
export async function readAuthoringCanonBinding(input: {
  node: AuthoringNodeInstance
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  contextBudget?: number
}): Promise<AuthoringBindingRead> {
  const scope = input.scope ?? await resolveScopeLike(input.projectId)
  const exactKeys = exactEntryKeysFor(input.node)
  const sourceKeys = sourceKeysFor(input.node)
  if (exactKeys.length) {
    const entries = await buildRagLibrary({ projectId: input.projectId, scope, worldGroupId: input.worldGroupId })
    const byKey = new Map(entries.map(entry => [entry.key, entry]))
    const missing = exactKeys.filter(key => !byKey.has(key))
    const trace = createRagSelectionTrace()
    const assembled = await assembleContext({
      projectId: input.projectId,
      scope,
      worldGroupId: input.worldGroupId,
      sourceKeys: ['ragSelection'],
      ragEntryKeys: exactKeys,
      ragSelectionTrace: trace,
      inputBudgetTokens: input.contextBudget,
    })
    return {
      content: assembled.text,
      sourceHash: fingerprintEntries(entries, exactKeys),
      sourceKeys: ['ragSelection'],
      included: trace.included,
      omitted: [...trace.omitted, ...missing],
      trimmed: trace.trimmed,
      missing,
    }
  }

  const assembled = await assembleContext({
    projectId: input.projectId,
    scope,
    worldGroupId: input.worldGroupId,
    ...(await resolveChapterScope(input.node, scope, input.worldGroupId)),
    sourceKeys: sourceKeys.length ? sourceKeys : undefined,
    inputBudgetTokens: input.contextBudget,
  })
  return {
    content: assembled.text,
    sourceHash: hashAuthoringText(`${sourceKeys.join(',')}:${assembled.text}`),
    sourceKeys,
    included: assembled.included,
    omitted: assembled.omitted,
    trimmed: assembled.trimmed,
    missing: [],
  }
}

/**
 * Resolve a single-field target before adoption. Collection targets are left
 * ambiguous unless the node has an explicit stable document binding.
 */
export async function readAuthoringTargetFingerprint(input: {
  node: AuthoringNodeInstance
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
}): Promise<AuthoringTargetFingerprint | null> {
  const scope = input.scope ?? await resolveScopeLike(input.projectId)
  const template = AUTHORING_NODE_BY_ID.get(input.node.templateId)
  const field = template?.writes?.fields?.length === 1 ? template.writes.fields[0] : undefined
  const target = template?.writes?.target
  if (!field || !target) return null

  const entries = await buildRagLibrary({ projectId: input.projectId, scope, worldGroupId: input.worldGroupId })
  const boundDocumentId = input.node.binding?.ref?.documentId
  const matching = entries.filter(entry => (
    entry.tableName === target
    && entry.fieldKey === field
    && (!boundDocumentId || entry.documentId === boundDocumentId)
  ))
  if (matching.length > 1 && !boundDocumentId) return { hash: '', ambiguous: true }
  const entry = matching[0]
  const key = entry?.key ?? `${target}::${field}`
  return { hash: hashAuthoringText(`${key}:${entry?.content ?? ''}`), key }
}

/**
 * Resolve a portable binding back to the current Dexie record only at the
 * write boundary. Node graphs never store this numeric id; imports therefore
 * continue to use the stable RAG document id while adoption targets exactly
 * the author's selected record.
 */
export async function resolveAuthoringBoundRecordId(input: {
  node: AuthoringNodeInstance
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  target: string
}): Promise<number | null> {
  const ref = input.node.binding?.ref
  if (!ref?.documentId) return null
  const scope = input.scope ?? await resolveScopeLike(input.projectId)
  const entries = await buildRagLibrary({ projectId: input.projectId, scope, worldGroupId: input.worldGroupId })
  // The portable document identifies the record. The target field may still be
  // empty and therefore absent from the retrieval library.
  const matches = entries.filter(entry => (
    entry.tableName === input.target
    && entry.documentId === ref.documentId
  ))
  const recordIds = [...new Set(matches.map(entry => entry.recordId))]
  return recordIds.length === 1 ? recordIds[0]! : null
}
