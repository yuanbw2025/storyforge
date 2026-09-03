import { db } from '../db/schema'
import { adopt } from '../registry/adopt'
import {
  parseEntryFields,
  parseFieldSchema,
  type CodexCategory,
  type CodexDomain,
  type CodexEntry,
  type CodexFieldDef,
} from '../types/codex'
import type { CodexImportCandidate } from '../types/import-session-data'
import { useCodexStore } from '../../stores/codex'
import { resolveScope, scopeTransactionTables } from '../workspace/scope'

export interface CodexImportCategoryOption {
  ref: string
  categoryId: number
  domain: CodexDomain
  label: string
  fields: CodexFieldDef[]
}

export interface CodexImportApplyResult {
  imported: number
  updated: number
  skipped: number
  errors: string[]
}

function normalizeName(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
}

/** cyrb53 的确定性 53-bit 文本 token；不含本地数据库 ID。 */
function stableToken(value: string): string {
  let h1 = 0xdeadbeef ^ value.length
  let h2 = 0x41c6ce57 ^ value.length
  for (let i = 0, ch; i < value.length; i++) {
    ch = value.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
    ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
    ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

function categoryPath(category: CodexCategory, byId: ReadonlyMap<number, CodexCategory>): string {
  const parts = [category.name.trim()]
  const visited = new Set<number>()
  let parentId = category.parentId
  while (parentId != null && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    parts.unshift(parent.name.trim())
    parentId = parent.parentId
  }
  return parts.filter(Boolean).join(' / ')
}

export function buildCodexImportCategoryOptions(
  categories: readonly CodexCategory[],
): CodexImportCategoryOption[] {
  const byId = new Map(
    categories
      .filter((category): category is CodexCategory & { id: number } => category.id != null)
      .map(category => [category.id, category]),
  )
  return categories
    .filter((category): category is CodexCategory & { id: number } => category.id != null)
    .filter(category => !category.hidden)
    .map(category => {
      const path = categoryPath(category, byId)
      const ref = category.builtInKey
        ? `builtin:${category.builtInKey}`
        : `custom:${category.domain}:${stableToken(`${category.domain}:${path}`)}`
      return {
        ref,
        categoryId: category.id,
        domain: category.domain,
        label: path,
        fields: parseFieldSchema(category.fieldSchema),
      }
    })
    .sort((left, right) =>
      left.domain.localeCompare(right.domain) || left.label.localeCompare(right.label, 'zh-CN'))
}

export function formatCodexImportCatalog(options: readonly CodexImportCategoryOption[]): string {
  return options.map(option => {
    const fields = option.fields
      .filter(field => field.type !== 'ref')
      .map(field => {
        const choices = field.type === 'select' && field.options?.length
          ? `(${field.options.join('|')})`
          : ''
        return `${field.key}${choices}`
      })
    return `- ${option.ref}｜${option.label}｜fields:${fields.join(',') || '无'}`
  }).join('\n')
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function normalizeCandidateFields(
  raw: unknown,
  option: CodexImportCategoryOption,
): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const source = raw as Record<string, unknown>
  const allowed = new Map(option.fields
    .filter(field => field.type !== 'ref')
    .map(field => [field.key, field]))
  const output: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    const definition = allowed.get(key)
    if (!definition || (typeof value !== 'string' && typeof value !== 'number')) continue
    const text = String(value).trim().slice(0, 4000)
    if (!text) continue
    if (definition.type === 'select' && definition.options?.length
        && !definition.options.includes(text)) continue
    output[key] = text
  }
  return output
}

/**
 * 把单块 AI 输出变成可信候选。没有当前目录分类或没有逐字证据的条目直接拒绝。
 */
export function normalizeCodexImportCandidates(
  raw: unknown,
  sourceText: string,
  chunkIndex: number,
  options: readonly CodexImportCategoryOption[],
): CodexImportCandidate[] {
  if (!Array.isArray(raw)) return []
  const byRef = new Map(options.map(option => [option.ref, option]))
  const output: CodexImportCandidate[] = []

  for (const value of raw) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const item = value as Record<string, unknown>
    const categoryRef = cleanText(item.categoryRef, 160)
    const option = byRef.get(categoryRef)
    const name = cleanText(item.name, 120)
    const rawQuote = cleanText(item.evidenceQuote, 400)
    if (!option || !name || rawQuote.length < 2 || !sourceText.includes(rawQuote)) continue
    const quote = rawQuote.slice(0, 240)
    const rawConfidence = Number(item.confidence)
    const confidence = Number.isFinite(rawConfidence)
      ? Math.min(1, Math.max(0, rawConfidence))
      : 0.5
    const tags = Array.isArray(item.tags)
      ? [...new Set(item.tags
          .filter((tag): tag is string => typeof tag === 'string')
          .map(tag => tag.trim().slice(0, 40))
          .filter(Boolean))]
          .slice(0, 20)
      : []
    output.push({
      categoryRef,
      name,
      summary: cleanText(item.summary, 500),
      description: cleanText(item.description, 5000),
      fields: normalizeCandidateFields(item.fields, option),
      tags,
      confidence,
      evidence: [{ chunkIndex, quote }],
    })
  }
  return mergeCodexImportCandidates([], output)
}

function preferLonger(left: string, right: string): string {
  return right.trim().length > left.trim().length ? right : left
}

export function mergeCodexImportCandidates(
  existing: readonly CodexImportCandidate[],
  incoming: readonly CodexImportCandidate[],
): CodexImportCandidate[] {
  const output = existing.map(candidate => ({
    ...candidate,
    fields: { ...candidate.fields },
    tags: [...candidate.tags],
    evidence: [...candidate.evidence],
  }))
  const byKey = new Map(output.map((candidate, index) => [
    `${candidate.categoryRef}\u0000${normalizeName(candidate.name)}`,
    index,
  ]))

  for (const candidate of incoming) {
    const key = `${candidate.categoryRef}\u0000${normalizeName(candidate.name)}`
    const index = byKey.get(key)
    if (index == null) {
      byKey.set(key, output.length)
      output.push({
        ...candidate,
        fields: { ...candidate.fields },
        tags: [...candidate.tags],
        evidence: [...candidate.evidence],
      })
      continue
    }
    const current = output[index]
    current.summary = preferLonger(current.summary, candidate.summary)
    current.description = preferLonger(current.description, candidate.description)
    current.confidence = Math.max(current.confidence, candidate.confidence)
    current.tags = [...new Set([...current.tags, ...candidate.tags])]
    for (const [field, text] of Object.entries(candidate.fields)) {
      current.fields[field] = preferLonger(current.fields[field] || '', text)
    }
    const evidenceKeys = new Set(current.evidence.map(item => `${item.chunkIndex}:${item.quote}`))
    for (const evidence of candidate.evidence) {
      const evidenceKey = `${evidence.chunkIndex}:${evidence.quote}`
      if (!evidenceKeys.has(evidenceKey)) {
        evidenceKeys.add(evidenceKey)
        current.evidence.push(evidence)
      }
    }
  }
  return output
}

function parseStringArray(value: string | undefined): string[] {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []
  } catch {
    return []
  }
}

/**
 * 作者确认后的唯一落库入口。候选仍需重新按当前目录解析、裁剪字段和校验世界作用域。
 */
export async function applyCodexImportCandidates(args: {
  projectId: number
  worldGroupId: number | null
  candidates: readonly CodexImportCandidate[]
}): Promise<CodexImportApplyResult> {
  await useCodexStore.getState().ensureBuiltIns(args.projectId)
  const workspaceScope = await resolveScope({ projectId: args.projectId })
  const categories = await db.codexCategories.where('projectId').equals(args.projectId).toArray()
  const options = buildCodexImportCategoryOptions(categories)
  const byRef = new Map(options.map(option => [option.ref, option]))
  const result: CodexImportApplyResult = { imported: 0, updated: 0, skipped: 0, errors: [] }

  await db.transaction('rw', scopeTransactionTables(db.codexCategories, db.codexEntries), async () => {
    const existingEntries = await db.codexEntries.where('projectId').equals(args.projectId).toArray()
    for (const candidate of mergeCodexImportCandidates([], args.candidates)) {
      const option = byRef.get(candidate.categoryRef)
      if (!option) {
        result.skipped++
        result.errors.push(`「${candidate.name}」的分类已不存在`)
        continue
      }
      const name = candidate.name.trim()
      if (!name || candidate.evidence.length === 0) {
        result.skipped++
        result.errors.push('存在空名称或无证据候选')
        continue
      }
      const fields = normalizeCandidateFields(candidate.fields, option)
      const existing = existingEntries.find(entry =>
          entry.categoryId === option.categoryId
          && (entry.worldGroupId ?? null) === args.worldGroupId
          && normalizeName(entry.name) === normalizeName(name))

      if (existing?.id != null) {
        const currentFields = parseEntryFields(existing.fields)
        const mergedFields = { ...currentFields }
        for (const [key, text] of Object.entries(fields)) {
          if (!mergedFields[key]?.trim()) mergedFields[key] = text
        }
        const mergedTags = [...new Set([...parseStringArray(existing.tags), ...candidate.tags])]
        const patch: Record<string, unknown> = {}
        if (!String(existing.summary || '').trim() && candidate.summary) patch.summary = candidate.summary
        if (!String(existing.description || '').trim() && candidate.description) patch.description = candidate.description
        if (JSON.stringify(mergedFields) !== JSON.stringify(currentFields)) {
          patch.fields = JSON.stringify(mergedFields)
        }
        if (JSON.stringify(mergedTags) !== JSON.stringify(parseStringArray(existing.tags))) {
          patch.tags = JSON.stringify(mergedTags)
        }
        if (Object.keys(patch).length === 0) {
          result.skipped++
          continue
        }
        const adopted = await adopt({
          projectId: args.projectId,
          scope: workspaceScope,
          worldGroupId: args.worldGroupId,
          target: 'codexEntries',
          recordId: existing.id,
          mode: 'replace',
          data: patch,
        })
        if (adopted.written.length) {
          result.updated++
          Object.assign(existing, patch)
        }
        else {
          result.skipped++
          result.errors.push(`「${name}」未通过写回校验`)
        }
        continue
      }

      const order = existingEntries
        .filter(entry =>
          entry.categoryId === option.categoryId
          && (entry.worldGroupId ?? null) === args.worldGroupId)
        .reduce((max, entry) => Math.max(max, entry.order), -1) + 1
      const adopted = await adopt({
        projectId: args.projectId,
        scope: workspaceScope,
        worldGroupId: args.worldGroupId,
        target: 'codexEntries',
        mode: 'add',
        data: {
          categoryId: option.categoryId,
          name,
          summary: candidate.summary,
          description: candidate.description,
          fields: JSON.stringify(fields),
          refs: '{}',
          tags: JSON.stringify(candidate.tags),
          order,
          worldGroupId: args.worldGroupId,
        },
      })
      if (adopted.written.length) {
        result.imported++
        existingEntries.push({
          id: adopted.written[0].id,
          projectId: args.projectId,
          worldGroupId: args.worldGroupId,
          categoryId: option.categoryId,
          name,
          summary: candidate.summary,
          description: candidate.description,
          fields: JSON.stringify(fields),
          refs: '{}',
          tags: JSON.stringify(candidate.tags),
          order,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } satisfies CodexEntry)
      }
      else {
        result.skipped++
        result.errors.push(`「${name}」未通过写回校验`)
      }
    }
  })
  await useCodexStore.getState().loadAll(args.projectId)
  return result
}

export async function loadCodexImportCategoryOptions(
  projectId: number,
): Promise<CodexImportCategoryOption[]> {
  await useCodexStore.getState().ensureBuiltIns(projectId)
  return buildCodexImportCategoryOptions(
    await db.codexCategories.where('projectId').equals(projectId).toArray(),
  )
}
