import { codexContentTemplateVariablesV1 } from '../../creation/world-entry-content-skill'
import type { AIConfig, ChatMessage, LocationTag } from '../../types'
import type { ChatRequestOptions } from '../client'
import type { CodexFieldDef } from '../../types/codex'
import { ALL_LOCATION_TAGS, parseLocationTagsV1 } from '../../types/location'
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
  categoryBuiltInKey?: string | null
  sourceText: string
  fieldSchema: CodexFieldDef[]
  existingNames: string[]
  supplementTags: boolean
}): ChatMessage[] {
  const template = usePromptStore.getState().getActive('codex.extract')
  const rendered = renderPrompt(template, {
    ...codexContentTemplateVariablesV1(input.categoryBuiltInKey),
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
  return rendered
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
  categoryBuiltInKey?: string | null
  discoveredNames: readonly string[]
  supplementTags: boolean
}): ChatMessage[] {
  const template = usePromptStore.getState().getActive('codex.extract')
  const rendered = renderPrompt(template, {
    ...codexContentTemplateVariablesV1(input.categoryBuiltInKey),
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
  categoryBuiltInKey?: string | null
  worldContext: string
  authorRequest: string
  supplementTags: boolean
}): ChatMessage[] {
  const template = usePromptStore.getState().getActive('codex.enrich')
  const rendered = renderPrompt(template, {
    ...codexContentTemplateVariablesV1(input.categoryBuiltInKey),
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
    let tags: LocationTag[]
    try { tags = parseLocationTagsV1(row.tags) }
    catch (error) { throw new Error(`地点候选 ${index + 1} ${error instanceof Error ? error.message : String(error)}`) }
    return {
      name: row.name.trim(),
      tags: [...tags].sort((left, right) => tagOrder.get(left)! - tagOrder.get(right)!),
      description: row.description.trim(),
      significance: row.significance.trim(),
    }
  })
}

export { splitExtractionText }

/** V2 retains field/type/provenance constraints without application content quotas.
 * Only the exact actually sent original range can ground names and quotes. */
function parseCodexEntriesCoreV2(
  raw: string,
  allowedFields: readonly string[] | readonly CodexFieldDef[],
  evidencePolicy: { operation: 'extract' | 'enrich'; sourceText: string; supplementTags?: boolean; verifiedProgressNames?: readonly string[] },
  authorDraft: boolean,
): ExtractedCodexEntry[] {
  const source = wholeJSONContainerTextV1(raw, '词条提取候选')
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error('词条提取输出不是严格 JSON。')
  }
  if (!Array.isArray(parsed)) throw new Error('词条提取输出必须是 JSON 数组。')
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
    const requiredKeys = exactKeys.filter(key => key !== 'evidenceQuotes')
    if (requiredKeys.some(key => !Object.prototype.hasOwnProperty.call(row, key))
      || Object.keys(row).some(key => !exactKeys.includes(key as typeof exactKeys[number]))) {
      throw new Error(`词条候选 ${index + 1} 字段不在允许闭集。`)
    }
    if (
      typeof row.name !== 'string' || !row.name.trim()
      || typeof row.icon !== 'string'
      || typeof row.summary !== 'string' || !row.summary.trim()
      || typeof row.description !== 'string' || !row.description.trim()
      || !row.fields || typeof row.fields !== 'object' || Array.isArray(row.fields)
      || !Array.isArray(row.tags)
      || !Number.isInteger(row.importance) || (row.importance as number) < 0 || (row.importance as number) > CODEX_LIMITS.importance
      || (row.evidenceQuotes !== undefined && (!Array.isArray(row.evidenceQuotes)
        || row.evidenceQuotes.some(quote => typeof quote !== 'string' || !quote.trim())))
      || !['verbatim-extraction', 'ai-created-suggestion'].includes(String(row.provenance))
    ) throw new Error(`词条候选 ${index + 1} 字段类型或范围无效。`)
    const normalizedName = row.name.trim().toLocaleLowerCase()
    if (names.has(normalizedName)) throw new Error(`词条候选 ${index + 1} 名称重复。`)
    names.add(normalizedName)
    const fields: Record<string, string> = {}
    for (const [key, fieldValue] of Object.entries(row.fields as Record<string, unknown>)) {
      const field = fieldDefs.get(key)
      if (!field) throw new Error(`词条候选 ${index + 1} 包含未登记字段 ${key}。`)
      if (typeof fieldValue !== 'string' || !fieldValue.trim()) {
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
      if (typeof tag !== 'string' || !tag.trim()) {
        throw new Error(`词条候选 ${index + 1} 标签 ${tagIndex + 1} 无效。`)
      }
      return tag.trim()
    })
    if (new Set(tags.map(tag => tag.toLocaleLowerCase())).size !== tags.length) {
      throw new Error(`词条候选 ${index + 1} 标签重复。`)
    }
    if (evidencePolicy.supplementTags === false && tags.length) throw new Error('作者未启用补充标签。')
    const evidenceQuotes = ((row.evidenceQuotes ?? []) as string[]).map(quote => quote.trim())
    if (evidencePolicy.operation === 'extract') {
      if (row.provenance !== 'verbatim-extraction') {
        throw new Error(`词条候选 ${index + 1} 缺少逐字抽取来源。`)
      }
      if (evidenceQuotes.some(quote => !evidencePolicy.sourceText.includes(quote))) {
        throw new Error(`词条候选 ${index + 1} 的来源引文不存在于原文。`)
      }
      if (!authorDraft && !evidencePolicy.sourceText.includes(row.name.trim()) && !evidencePolicy.verifiedProgressNames?.includes(row.name.trim())) {
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

export function parseCodexEntriesStrictV2(
  raw: string, fields: readonly string[] | readonly CodexFieldDef[],
  policy: { operation: 'extract' | 'enrich'; sourceText: string; supplementTags?: boolean; verifiedProgressNames?: readonly string[] },
): ExtractedCodexEntry[] { return parseCodexEntriesCoreV2(raw, fields, policy, false) }

/** Author edits are a separate manual draft, never a rewritten model identity.
 * Renames may differ, while supplied quotes must still belong to original text. */
export function parseCodexAuthorDraftV2(
  raw: string, fields: readonly CodexFieldDef[], policy: { sourceText: string; supplementTags: boolean },
): ExtractedCodexEntry[] { return parseCodexEntriesCoreV2(raw, fields, { sourceText: policy.sourceText, operation: 'extract' }, true) }

/** Array-root schema stays on the provider already supporting that protocol.
 * No retry without schema, maxLength/maxItems quota, or json_object coercion. */
export function codexEntryTransportOptionsV2(
  config: Pick<AIConfig, 'provider' | 'model'> | undefined,
  fields: readonly CodexFieldDef[],
  policy: { operation: 'extract' | 'enrich'; supplementTags: boolean },
): ChatRequestOptions | undefined {
  if (config?.provider !== 'agnes' || config.model !== 'agnes-2.5-flash') return undefined
  const text = { type: 'string', minLength: 1 }
  const properties = Object.fromEntries(fields.filter(field => field.type !== 'ref').map(field => [field.key, {
    ...text,
    ...(field.type === 'select' && field.options?.length ? { enum: [...field.options] } : {}),
    ...(field.type === 'number' ? { pattern: '^[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?$' } : {}),
  }]))
  return { thinkingMode: 'disabled', jsonSchema: { name: 'storyforge_codex_entries_v2', strict: true, schema: {
    type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['name', 'icon', 'summary', 'description', 'fields', 'tags', 'importance', 'provenance'],
      properties: {
        name: text, icon: { type: 'string' }, summary: text, description: text,
        fields: { type: 'object', additionalProperties: false, properties },
        tags: { type: 'array', uniqueItems: true, items: text,
          ...(policy.supplementTags ? {} : { maxItems: 0 }) },
        importance: { type: 'integer', minimum: 0, maximum: 5 },
        evidenceQuotes: { type: 'array', items: text,
          ...(policy.operation === 'extract' ? {} : { maxItems: 0 }) },
        provenance: { type: 'string', enum: [policy.operation === 'extract' ? 'verbatim-extraction' : 'ai-created-suggestion'] },
      },
    },
  } } }
}

export function buildCodexExtractPromptFromRegisteredContextV2(input: {
  sourceText: string
  baselineContext: string
  categoryBuiltInKey?: string | null
  supplementTags: boolean
  progressContext?: string
  productionPolicy?: boolean
}): ChatMessage[] {
  const template = usePromptStore.getState().getActive('codex.extract')
  const messages = renderPrompt(template, {
    ...codexContentTemplateVariablesV1(input.categoryBuiltInKey),
    categoryName: input.baselineContext,
    fieldSchema: '按完整登记基线的字段闭集填写；ref字段省略，select取登记选项，number是有限数值字符串。',
    existingEntries: input.progressContext ?? '已有同类名称以完整登记基线为准；不得重复输出。',
    supplementTags: input.supplementTags ? '是' : '否', sourceText: input.sourceText,
  }).messages
  if (input.productionPolicy) {
    const system = messages.filter(message => message.role === 'system').map(message => message.content)
    if (input.progressContext) system.push('【本次实际发送的同Root已验证草稿，非Canon】\n' + input.progressContext)
    system.push('本次新Root原文单元/草稿聚合策略：已有Canon禁止重建或覆盖；同Root已验证草稿不是Canon。summary可一句概括，description按来源完整整理事实、条件、例外和禁例，不以概括代替详细整理，不设默认篇幅或字数配额，不增加来源外内容。后文同名新事实须继续输出，name使用本段逐字名称，或本次实际发送且可追溯到原文的已验证草稿原名；指代不清返回空数组并保留原答供核对。新事实引文仍只能来自本段原文。text/longtext字段保留各段完整表述和条件，不以字符串不同断言语义冲突；number/select单值不同时保原答等待作者处理，禁止覆盖。标签与引文没有软件条数或长度配额。')
    system.push('【当前提取输出合同】每项必须包含 name/icon/summary/description/fields/tags/importance/provenance，可选 evidenceQuotes。provenance 必须是字符串 "verbatim-extraction"，不是引文对象或数组；引文放 evidenceQuotes 字符串数组。不得添加 category 或其它未登记顶层字段。description 完整整理该实体在原文所有位置的事实，逐一保留数值、日期、触发和失效条件、用途、权限、例外及禁例；分类自定义字段容纳不下的事实仍放 description，不用标签、引文或概括代替。fields 的选项不是来源事实，无依据省略该 key，不补默认等级或稀有度。')
    system.push('输出严格JSON数组；字段与类型、provenance和importance约束保持。每条所给引文必须逐字来自当前待拆分原文；名称必须来自当前原文或本次实际发送的同Root已验证草稿。不要借用登记Canon或其它运行名称。tags关闭时必须[]，开启时按内容需要；引文可为空或省略，无软件长度/数量配额。信息不足不编造，不以省略尾部冒充覆盖完成。')
    system.push("【输出数据结构】输出数组元素形状为 {\"name\":\"逐字实体名\",\"icon\":\"\",\"summary\":\"简明概括\",\"description\":\"完整事实与全部条件、例外、禁例\",\"fields\":{},\"tags\":[],\"importance\":0,\"evidenceQuotes\":[],\"provenance\":\"verbatim-extraction\"}。name、summary、description为非空字符串，icon为字符串，fields为仅含登记非ref键的对象且值为有来源依据的字符串，tags及可选evidenceQuotes为字符串数组，importance为0至5整数。示例只说明结构，不是内容，不得照抄示例名称或描述。")
    // Keep the author instructions and complete production contract together
    // in the leading system message; original user material stays unchanged.
    return [{ role: 'system', content: system.join('\n\n') }, ...messages.filter(message => message.role !== 'system')]
  }
  return [...messages, { role: 'system', content: '本次为 task-request-v2 原文提取合同：输出严格JSON数组；每项含name/icon/summary/description/fields/tags/importance/provenance，可选evidenceQuotes字符串数组。名称及提供的每条引文必须逐字位于本次实际发送的待拆分原文。provenance固定verbatim-extraction。fields仅登记非ref字段；importance为0～5整数。tags关闭时为[]，开启时没有应用层最少或最多数量。引文可为空或省略。没有应用层name/描述/字段/标签/引文长度或条数配额；模板中历史软件配额不作为本次上限，作者的内容目标仍须遵守。基线或此前草稿不是原文证据，信息不足返回[]，不编造、不省略原文尾部来冒充覆盖完成。' }]
}
