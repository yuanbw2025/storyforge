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

/** HARNESS-70: durable Codex extraction rejects repairable/ambiguous model output. */
export function parseCodexEntriesStrictV1(
  raw: string,
  allowedFields: readonly string[] | readonly CodexFieldDef[],
): ExtractedCodexEntry[] {
  const source = raw.trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error('词条提取输出不是严格 JSON。')
  }
  if (!Array.isArray(parsed)) throw new Error('词条提取输出必须是 JSON 数组。')
  if (parsed.length > 200) throw new Error('词条候选超过单次协议上限 200。')
  const fieldDefs = new Map<string, CodexFieldDef>()
  for (const value of allowedFields) {
    const field = typeof value === 'string' ? { key: value, label: value, type: 'text' as const } : value
    fieldDefs.set(field.key, field)
  }
  const exactKeys = ['name', 'icon', 'summary', 'description', 'fields', 'tags', 'importance'] as const
  const names = new Set<string>()
  return parsed.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`词条候选 ${index + 1} 不是对象。`)
    }
    const row = value as Record<string, unknown>
    if (Object.keys(row).length !== exactKeys.length || Object.keys(row).some(key => !exactKeys.includes(key as typeof exactKeys[number]))) {
      throw new Error(`词条候选 ${index + 1} 字段不在允许闭集。`)
    }
    if (
      typeof row.name !== 'string' || !row.name.trim() || row.name.trim().length > 120
      || typeof row.icon !== 'string' || row.icon.trim().length > 16
      || typeof row.summary !== 'string' || !row.summary.trim() || row.summary.trim().length > 1_000
      || typeof row.description !== 'string' || !row.description.trim() || row.description.trim().length > 8_000
      || !row.fields || typeof row.fields !== 'object' || Array.isArray(row.fields)
      || !Array.isArray(row.tags) || row.tags.length > 5
      || !Number.isInteger(row.importance) || (row.importance as number) < 0 || (row.importance as number) > 5
    ) throw new Error(`词条候选 ${index + 1} 字段类型、长度或范围无效。`)
    const normalizedName = row.name.trim().toLocaleLowerCase()
    if (names.has(normalizedName)) throw new Error(`词条候选 ${index + 1} 名称重复。`)
    names.add(normalizedName)
    const fields: Record<string, string> = {}
    for (const [key, fieldValue] of Object.entries(row.fields as Record<string, unknown>)) {
      const field = fieldDefs.get(key)
      if (!field) throw new Error(`词条候选 ${index + 1} 包含未登记字段 ${key}。`)
      if (typeof fieldValue !== 'string' || !fieldValue.trim() || fieldValue.trim().length > 2_000) {
        throw new Error(`词条候选 ${index + 1} 字段 ${key} 的值无效。`)
      }
      const normalized = fieldValue.trim()
      if (field.type === 'ref') throw new Error(`词条候选 ${index + 1} 不得伪造引用字段 ${key}。`)
      if (field.type === 'number' && !Number.isFinite(Number(normalized))) {
        throw new Error(`词条候选 ${index + 1} 数值字段 ${key} 无效。`)
      }
      if (field.type === 'select' && field.options?.length && !field.options.includes(normalized)) {
        throw new Error(`词条候选 ${index + 1} 枚举字段 ${key} 不在登记选项内。`)
      }
      fields[key] = normalized
    }
    const tags = row.tags.map((tag, tagIndex) => {
      if (typeof tag !== 'string' || !tag.trim() || tag.trim().length > 60) {
        throw new Error(`词条候选 ${index + 1} 标签 ${tagIndex + 1} 无效。`)
      }
      return tag.trim()
    })
    if (new Set(tags.map(tag => tag.toLocaleLowerCase())).size !== tags.length) {
      throw new Error(`词条候选 ${index + 1} 标签重复。`)
    }
    return {
      name: row.name.trim(),
      icon: row.icon.trim(),
      summary: row.summary.trim(),
      description: row.description.trim(),
      fields,
      tags,
      importance: row.importance as number,
    }
  })
}

export function buildCodexExtractPromptFromRegisteredContextV1(input: {
  sourceText: string
  baselineContext: string
  discoveredNames: readonly string[]
  supplementTags: boolean
}): ChatMessage[] {
  const template = usePromptStore.getState().getActive('codex.extract')
  return renderPrompt(template, {
    categoryName: input.baselineContext,
    fieldSchema: '严格使用上述登记基线中的字段 schema；select 必须取登记选项，number 必须是有限数值字符串，ref 必须留空并由作者之后关联，不得添加其它 key。',
    existingEntries: input.discoveredNames.join('、') || '登记基线之外，本轮前置分块尚无新候选。',
    supplementTags: input.supplementTags ? '是' : '否',
    sourceText: input.sourceText,
  }).messages
}

export function readCodexExtractPromptTemplateSnapshotV1() {
  const template = usePromptStore.getState().getActive('codex.extract')
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
