import type { AIConfig, ChatMessage, LocationTag } from '../../types'
import type { ChatRequestOptions } from '../client'
import type { CodexFieldDef } from '../../types/codex'
import { ALL_LOCATION_TAGS } from '../../types/location'
import { usePromptStore } from '../../../stores/prompt'
import { renderPrompt } from '../prompt-engine'
import { parseJsonArray, splitExtractionText } from '../structured-extraction'
import { wholeJSONContainerTextV1 } from '../whole-json-container'

export interface ExtractedCodexEntry {
  name: string
  summary: string
  description: string
  fields: Record<string, string>
  tags: string[]
  icon: string
  importance: number
  /** Exact source excerpts for grounded extraction; empty for AI-created enrichment. */
  evidenceQuotes?: string[]
  /** Keeps extraction and enrichment provenance visibly and mechanically distinct. */
  provenance?: 'verbatim-extraction' | 'ai-created-suggestion'
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
const CODEX_LIMITS = Object.freeze({ entries: 200, name: 120, icon: 16, summary: 1000, description: 8000, tags: 5, evidenceQuotes: 5, quote: 500, importance: 5, fieldValue: 2000, tag: 60 })
const codexLimitContract = `长度合同（字符数按 JavaScript string.length）：单次最多 ${CODEX_LIMITS.entries} 项；name 非空且最多 ${CODEX_LIMITS.name}，icon 最多 ${CODEX_LIMITS.icon}，summary 非空且最多 ${CODEX_LIMITS.summary}，description 非空且最多 ${CODEX_LIMITS.description}；tags 必须是字符串数组且最多 ${CODEX_LIMITS.tags} 项，每项非空且最多 ${CODEX_LIMITS.tag}，忽略大小写后不可重复；importance 必须是 0～${CODEX_LIMITS.importance} 的整数；evidenceQuotes 最多 ${CODEX_LIMITS.evidenceQuotes} 项，每条非空且最多 ${CODEX_LIMITS.quote}。fields 是对象，可为 {}；只填写已有依据的登记 key，值为非空且最多 ${CODEX_LIMITS.fieldValue} 字符的字符串；select 必须逐字取登记选项，number 必须是有限数字字符串。词条 name 忽略大小写后不可重复。输出须为 JSON 数组，不带解释文字。`

/** Array-root schema support is verified for this specific provider/model.
 * Other providers keep their existing transport; never retry a rejected schema
 * request without the schema or weaken the local semantic/evidence checks. */
export function codexEntryTransportOptionsV1(
  config: Pick<AIConfig, 'provider' | 'model'> | undefined,
  fields: readonly CodexFieldDef[],
  policy: { operation: 'extract' | 'enrich'; supplementTags: boolean },
): ChatRequestOptions | undefined {
  if (config?.provider !== 'agnes' || config.model !== 'agnes-2.5-flash') return undefined
  const text = (maxLength: number, minLength = 1) => ({ type: 'string', minLength, maxLength })
  const properties = Object.fromEntries(fields.filter(field => field.type !== 'ref').map(field => [field.key, {
    ...text(CODEX_LIMITS.fieldValue),
    ...(field.type === 'select' && field.options?.length ? { enum: [...field.options] } : {}),
    ...(field.type === 'number' ? { pattern: '^[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?$' } : {}),
  }]))
  return { thinkingMode: 'disabled', jsonSchema: { name: 'storyforge_codex_entries_v1', strict: true, schema: {
    type: 'array', maxItems: CODEX_LIMITS.entries,
    items: { type: 'object', additionalProperties: false,
      required: ['name', 'icon', 'summary', 'description', 'fields', 'tags', 'importance', 'evidenceQuotes', 'provenance'],
      properties: {
        name: text(CODEX_LIMITS.name), icon: text(CODEX_LIMITS.icon, 0),
        summary: text(CODEX_LIMITS.summary), description: text(CODEX_LIMITS.description),
        fields: { type: 'object', additionalProperties: false, properties },
        tags: { type: 'array', minItems: policy.supplementTags ? 2 : 0, maxItems: policy.supplementTags ? CODEX_LIMITS.tags : 0, uniqueItems: true, items: text(CODEX_LIMITS.tag) },
        importance: { type: 'integer', minimum: 0, maximum: CODEX_LIMITS.importance },
        evidenceQuotes: { type: 'array', minItems: policy.operation === 'extract' ? 1 : 0, maxItems: policy.operation === 'extract' ? CODEX_LIMITS.evidenceQuotes : 0, items: text(CODEX_LIMITS.quote) },
        provenance: { type: 'string', enum: [policy.operation === 'extract' ? 'verbatim-extraction' : 'ai-created-suggestion'] },
      },
    },
  } } }
}

export function parseCodexEntriesStrictV1(
  raw: string,
  allowedFields: readonly string[] | readonly CodexFieldDef[],
  evidencePolicy: { operation: 'extract' | 'enrich'; sourceText: string },
): ExtractedCodexEntry[] {
  const source = wholeJSONContainerTextV1(raw, '词条提取候选')
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error('词条提取输出不是严格 JSON。')
  }
  if (!Array.isArray(parsed)) throw new Error('词条提取输出必须是 JSON 数组。')
  if (parsed.length > CODEX_LIMITS.entries) throw new Error(`词条候选超过单次协议上限 ${CODEX_LIMITS.entries}。`)
  const fieldDefs = new Map<string, CodexFieldDef>()
  for (const value of allowedFields) {
    const field = typeof value === 'string' ? { key: value, label: value, type: 'text' as const } : value
    fieldDefs.set(field.key, field)
  }
  const exactKeys = [
    'name', 'icon', 'summary', 'description', 'fields', 'tags', 'importance',
    'evidenceQuotes', 'provenance',
  ] as const
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
      typeof row.name !== 'string' || !row.name.trim() || row.name.trim().length > CODEX_LIMITS.name
      || typeof row.icon !== 'string' || row.icon.trim().length > CODEX_LIMITS.icon
      || typeof row.summary !== 'string' || !row.summary.trim() || row.summary.trim().length > CODEX_LIMITS.summary
      || typeof row.description !== 'string' || !row.description.trim() || row.description.trim().length > CODEX_LIMITS.description
      || !row.fields || typeof row.fields !== 'object' || Array.isArray(row.fields)
      || !Array.isArray(row.tags) || row.tags.length > CODEX_LIMITS.tags
      || !Number.isInteger(row.importance) || (row.importance as number) < 0 || (row.importance as number) > CODEX_LIMITS.importance
      || !Array.isArray(row.evidenceQuotes) || row.evidenceQuotes.length > CODEX_LIMITS.evidenceQuotes
      || row.evidenceQuotes.some(quote => typeof quote !== 'string' || !quote.trim() || quote.trim().length > CODEX_LIMITS.quote)
      || !['verbatim-extraction', 'ai-created-suggestion'].includes(String(row.provenance))
    ) throw new Error(`词条候选 ${index + 1} 字段类型、长度或范围无效。${Array.isArray(row.tags) && row.tags.length > CODEX_LIMITS.tags ? `tags 最多 ${CODEX_LIMITS.tags} 项，实际 ${row.tags.length} 项。` : ''}`)
    const normalizedName = row.name.trim().toLocaleLowerCase()
    if (names.has(normalizedName)) throw new Error(`词条候选 ${index + 1} 名称重复。`)
    names.add(normalizedName)
    const fields: Record<string, string> = {}
    for (const [key, fieldValue] of Object.entries(row.fields as Record<string, unknown>)) {
      const field = fieldDefs.get(key)
      if (!field) throw new Error(`词条候选 ${index + 1} 包含未登记字段 ${key}。`)
      if (typeof fieldValue !== 'string' || !fieldValue.trim() || fieldValue.trim().length > CODEX_LIMITS.fieldValue) {
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
      if (typeof tag !== 'string' || !tag.trim() || tag.trim().length > CODEX_LIMITS.tag) {
        throw new Error(`词条候选 ${index + 1} 标签 ${tagIndex + 1} 无效。`)
      }
      return tag.trim()
    })
    if (new Set(tags.map(tag => tag.toLocaleLowerCase())).size !== tags.length) {
      throw new Error(`词条候选 ${index + 1} 标签重复。`)
    }
    const evidenceQuotes = (row.evidenceQuotes as string[]).map(quote => quote.trim())
    if (evidencePolicy.operation === 'extract') {
      if (row.provenance !== 'verbatim-extraction' || evidenceQuotes.length < 1) {
        throw new Error(`词条候选 ${index + 1} 缺少逐字抽取来源。`)
      }
      if (evidenceQuotes.some(quote => !evidencePolicy.sourceText.includes(quote))) {
        throw new Error(`词条候选 ${index + 1} 的来源引文不存在于原文。`)
      }
      if (!evidencePolicy.sourceText.includes(row.name.trim())) {
        throw new Error(`词条候选 ${index + 1} 的名称未在原文中出现。`)
      }
    } else if (row.provenance !== 'ai-created-suggestion' || evidenceQuotes.length !== 0) {
      throw new Error(`词条候选 ${index + 1} 的 AI 新建 provenance 无效。`)
    }
    return {
      name: row.name.trim(),
      icon: row.icon.trim(),
      summary: row.summary.trim(),
      description: row.description.trim(),
      fields,
      tags,
      importance: row.importance as number,
      evidenceQuotes,
      provenance: row.provenance as ExtractedCodexEntry['provenance'],
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
  const rendered = renderPrompt(template, {
    categoryName: input.baselineContext,
    fieldSchema: '严格使用上述登记基线中的字段 schema；select 必须取登记选项，number 必须是有限数值字符串，ref 字段的 key 必须从输出 fields 对象完全省略，不得填空字符串、null 或 []；关联由作者采纳后设置。不得添加其它 key。',
    existingEntries: input.discoveredNames.join('、') || '登记基线之外，本轮前置分块尚无新候选。',
    supplementTags: input.supplementTags ? '是' : '否',
    sourceText: input.sourceText,
  }).messages
  return [{
    role: 'system',
    content: '不可覆盖的 Harness 输出合同：每项必须且只能包含 name/icon/summary/description/fields/tags/importance/evidenceQuotes/provenance；evidenceQuotes 须为原文逐字引文，provenance="verbatim-extraction"。fields 只允许登记为 AI 可填写的字段；ref 字段 key 必须完全省略。信息不足时返回 []，不得创造。' + codexLimitContract,
  }, ...rendered]
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

export function buildCodexEnrichPromptFromRegisteredContextV1(input: {
  baselineContext: string
  worldContext: string
  authorRequest: string
  supplementTags: boolean
}): ChatMessage[] {
  const template = usePromptStore.getState().getActive('codex.enrich')
  const rendered = renderPrompt(template, {
    baselineContext: input.baselineContext,
    worldContext: input.worldContext,
    authorRequest: input.authorRequest,
    supplementTags: input.supplementTags ? '是' : '否',
  }).messages
  return [{
    role: 'system',
    content: '不可覆盖的 Harness 输出合同：每项必须且只能包含 name/icon/summary/description/fields/tags/importance/evidenceQuotes/provenance；evidenceQuotes=[]，provenance="ai-created-suggestion"。fields 只允许登记为 AI 可填写的字段，ref 字段 key 必须完全省略，不得输出空字符串、null 或数组。' + codexLimitContract,
  }, ...rendered]
}

export function readCodexEnrichPromptTemplateSnapshotV1() {
  const template = usePromptStore.getState().getActive('codex.enrich')
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
