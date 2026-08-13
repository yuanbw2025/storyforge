import type { ChatMessage, LocationTag } from '../../types'
import type { CodexFieldDef } from '../../types/codex'
import { ALL_LOCATION_TAGS } from '../../types/location'
import { usePromptStore } from '../../../stores/prompt'
import { renderPrompt } from '../prompt-engine'
import { parseJsonArray, splitExtractionText } from '../structured-extraction'

export interface ExtractedCodexEntry {
  name: string
  summary: string
  description: string
  fields: Record<string, string>
  tags: string[]
  icon: string
  importance: number
}

export interface ExtractedLocation {
  name: string
  tags: LocationTag[]
  description: string
  significance: string
}

export function buildCodexExtractPrompt(input: {
  categoryName: string
  sourceText: string
  fieldSchema: CodexFieldDef[]
  existingNames: string[]
  supplementTags: boolean
}): ChatMessage[] {
  const template = usePromptStore.getState().getActive('codex.extract')
  return renderPrompt(template, {
    categoryName: input.categoryName,
    fieldSchema: JSON.stringify(input.fieldSchema.map(field => ({
      key: field.key,
      label: field.label,
      type: field.type,
      options: field.options ?? [],
    })), null, 2),
    existingEntries: input.existingNames.join('、') || '无',
    supplementTags: input.supplementTags ? '是' : '否',
    sourceText: input.sourceText,
  }).messages
}

export function parseCodexEntries(raw: string, allowedFieldKeys: string[]): ExtractedCodexEntry[] {
  const allowed = new Set(allowedFieldKeys)
  return parseJsonArray<Record<string, unknown>>(raw).map(item => {
    const sourceFields = item.fields && typeof item.fields === 'object' && !Array.isArray(item.fields)
      ? item.fields as Record<string, unknown>
      : {}
    const fields: Record<string, string> = {}
    for (const [key, value] of Object.entries(sourceFields)) {
      if (allowed.has(key) && value != null && String(value).trim()) fields[key] = String(value).trim()
    }
    return {
      name: String(item.name ?? '').trim(),
      summary: String(item.summary ?? '').trim(),
      description: String(item.description ?? '').trim(),
      fields,
      tags: Array.isArray(item.tags) ? item.tags.map(String).map(s => s.trim()).filter(Boolean).slice(0, 5) : [],
      icon: String(item.icon ?? '').trim(),
      importance: Math.max(0, Math.min(5, Math.round(Number(item.importance) || 0))),
    }
  }).filter(item => item.name)
}

/** HARNESS-62: existing location text must come from the Context Gateway. */
export function buildLocationExtractPromptFromContext(
  chapterText: string,
  existingLocationContext: string,
  discoveredNames: string[],
): ChatMessage[] {
  const template = usePromptStore.getState().getActive('location.extract')
  return renderPrompt(template, {
    sourceText: chapterText,
    existingEntries: [
      existingLocationContext || '【已有重要地点】\n无',
      discoveredNames.length ? `【本轮前置分块已发现】\n${discoveredNames.join('、')}` : '',
    ].filter(Boolean).join('\n\n'),
    allowedTags: ALL_LOCATION_TAGS.join('、'),
  }).messages
}

export function buildLocationExtractPromptTemplateProbeV1(): ChatMessage[] {
  return buildLocationExtractPromptFromContext('__CHAPTER_SOURCE__', '__LOCATION_CONTEXT__', ['__DISCOVERED__'])
}

export function readLocationExtractPromptTemplateSnapshotV1() {
  const template = usePromptStore.getState().getActive('location.extract')
  return {
    moduleKey: template.moduleKey,
    systemPrompt: template.systemPrompt,
    userPromptTemplate: template.userPromptTemplate,
    variables: template.variables,
    modelOverride: template.modelOverride ?? null,
    examples: template.examples ?? null,
    parameters: template.parameters ?? null,
  }
}

export function parseLocations(raw: string): ExtractedLocation[] {
  let source = raw.trim()
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  if (fenced) source = fenced[1]
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error('地点提取输出不是有效 JSON。')
  }
  if (!Array.isArray(parsed)) throw new Error('地点提取输出必须是 JSON 数组。')
  const allowedTags = new Set<string>(ALL_LOCATION_TAGS)
  const tagOrder = new Map<string, number>(ALL_LOCATION_TAGS.map((tag, index) => [tag, index]))
  return parsed.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`地点候选 ${index + 1} 不是对象。`)
    }
    const row = value as Record<string, unknown>
    const keys = ['name', 'tags', 'description', 'significance'] as const
    if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key as typeof keys[number]))) {
      throw new Error(`地点候选 ${index + 1} 字段不在允许闭集。`)
    }
    if (
      typeof row.name !== 'string' || !row.name.trim() || row.name.trim().length > 120
      || typeof row.description !== 'string' || row.description.trim().length > 2_000
      || typeof row.significance !== 'string' || row.significance.trim().length > 2_000
      || (!row.description.trim() && !row.significance.trim())
      || !Array.isArray(row.tags)
    ) throw new Error(`地点候选 ${index + 1} 字段类型、长度或必需内容无效。`)
    const tags = row.tags.map(tag => {
      if (typeof tag !== 'string' || !allowedTags.has(tag)) {
        throw new Error(`地点候选 ${index + 1} 包含未登记标签。`)
      }
      return tag as LocationTag
    })
    if (new Set(tags).size !== tags.length) throw new Error(`地点候选 ${index + 1} 标签重复。`)
    return {
      name: row.name.trim(),
      tags: [...tags].sort((left, right) => tagOrder.get(left)! - tagOrder.get(right)!),
      description: row.description.trim(),
      significance: row.significance.trim(),
    }
  })
}

export { splitExtractionText }
