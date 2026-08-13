import type { CodexCategory, CodexEntry, CodexFieldDef } from '../types/codex'
import { filterCodexEntriesByWorld, parseFieldSchema } from '../types/codex'
import type { WorkspaceScope } from '../types/world-ownership'
import { readOwnedRows } from '../world-engine/scope'

export interface CodexExtractionCategoryV1 {
  id: number
  name: string
  icon: string
  domain: CodexCategory['domain']
  builtInKey: string | null
  fieldSchema: string
  fields: CodexFieldDef[]
  updatedAt: number
}

export interface CodexExtractionEntryV1 {
  id: number
  categoryId: number
  name: string
  icon: string
  summary: string
  description: string
  fields: string
  refs: string
  tags: string
  importance: number
  cultivationSystemId: number | null
  cultivationStageId: string | null
  importantLocationId: number | null
  order: number
  worldGroupId: number | null
  worldId: number
  createdAt: number
  updatedAt: number
}

export interface CodexExtractionBaselineV1 {
  category: CodexExtractionCategoryV1
  entries: CodexExtractionEntryV1[]
}

function assertFieldSchema(fields: CodexFieldDef[]): void {
  const keys = new Set<string>()
  for (const [index, field] of fields.entries()) {
    if (
      !field || typeof field !== 'object'
      || typeof field.key !== 'string' || !field.key.trim() || field.key.length > 80
      || typeof field.label !== 'string' || !field.label.trim() || field.label.length > 120
      || !['text', 'longtext', 'select', 'number', 'ref'].includes(field.type)
      || keys.has(field.key)
      || (field.options != null && (!Array.isArray(field.options) || field.options.some(option => typeof option !== 'string')))
    ) throw new Error(`Codex 分类字段 schema 第 ${index + 1} 项无效。`)
    keys.add(field.key)
  }
}

function categorySnapshot(row: CodexCategory & { id: number }): CodexExtractionCategoryV1 {
  const fields = parseFieldSchema(row.fieldSchema)
  assertFieldSchema(fields)
  return {
    id: row.id,
    name: row.name,
    icon: row.icon ?? '',
    domain: row.domain,
    builtInKey: row.builtInKey ?? null,
    fieldSchema: row.fieldSchema,
    fields,
    updatedAt: row.updatedAt,
  }
}

function entrySnapshot(row: CodexEntry & { id: number }): CodexExtractionEntryV1 {
  return {
    id: row.id,
    categoryId: row.categoryId,
    name: row.name,
    icon: row.icon ?? '',
    summary: row.summary ?? '',
    description: row.description ?? '',
    fields: row.fields ?? '{}',
    refs: row.refs ?? '{}',
    tags: row.tags ?? '[]',
    importance: row.importance ?? 0,
    cultivationSystemId: row.cultivationSystemId ?? null,
    cultivationStageId: row.cultivationStageId ?? null,
    importantLocationId: row.importantLocationId ?? null,
    order: row.order,
    worldGroupId: row.worldGroupId ?? null,
    worldId: Number((row as unknown as Record<string, unknown>).worldId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function readCodexExtractionBaselineV1(input: {
  scope: WorkspaceScope
  categoryId: number
  worldGroupId: number | null
}): Promise<CodexExtractionBaselineV1> {
  const [categories, entries] = await Promise.all([
    readOwnedRows<CodexCategory>(input.scope, 'codexCategories', { owner: 'world' }),
    readOwnedRows<CodexEntry>(input.scope, 'codexEntries', { owner: 'world' }),
  ])
  const category = categories.find(row => row.id === input.categoryId)
  if (!category?.id) throw new Error('目标 Codex 分类不存在或不属于当前 World。')
  const scoped = filterCodexEntriesByWorld(entries, input.worldGroupId)
    .filter(row => row.id != null && row.categoryId === input.categoryId)
    .map(row => entrySnapshot(row as CodexEntry & { id: number }))
    .sort((left, right) => left.order - right.order || left.id - right.id)
  return { category: categorySnapshot(category as CodexCategory & { id: number }), entries: scoped }
}

export function formatCodexExtractionBaselineV1(baseline: CodexExtractionBaselineV1): string {
  const schema = baseline.category.fields.map(field => ({
    key: field.key,
    label: field.label,
    type: field.type,
    options: field.options ?? [],
  }))
  return [
    '【Codex 词条抽取登记基线】',
    `目标分类：${baseline.category.name}`,
    `允许字段 schema：${JSON.stringify(schema)}`,
    `已有同类词条：${baseline.entries.length ? baseline.entries.map(entry => entry.name).join('、') : '无'}`,
  ].join('\n')
}

export async function readCodexExtractionBaselineContextV1(input: {
  scope: WorkspaceScope
  categoryId: number
  worldGroupId: number | null
}): Promise<string> {
  return formatCodexExtractionBaselineV1(await readCodexExtractionBaselineV1(input))
}
