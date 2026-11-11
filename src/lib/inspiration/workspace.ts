import type {
  InspirationFragment,
  InspirationResultMode,
  InspirationSourceKind,
  InspirationVersion,
} from '../types/inspiration-workspace'

export const MAX_INSPIRATION_FRAGMENTS = 24
export const MAX_INSPIRATION_VERSIONS = 12
export const MAX_INSPIRATION_FRAGMENT_CHARS = 2000
export const MAX_INSPIRATION_FUSION_CHARS = 9000
export const MAX_INSPIRATION_PREVIOUS_RESULT_CHARS = 5000
export const MAX_INSPIRATION_RESULT_CHARS = 40_000

export interface InspirationResultDiff {
  path: string
  before: string
  after: string
}

function createId(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
  return `${prefix}-${suffix}`
}

function cleanText(value: unknown, maxChars: number): string {
  return typeof value === 'string'
    ? value.replace(/\r\n?/g, '\n').trim().slice(0, maxChars)
    : ''
}

export function parseInspirationFragments(raw: string | undefined): InspirationFragment[] {
  try {
    const values = JSON.parse(raw || '[]')
    if (!Array.isArray(values)) return []
    return values.flatMap((value): InspirationFragment[] => {
      if (!value || typeof value !== 'object') return []
      const item = value as Record<string, unknown>
      const text = cleanText(item.text, MAX_INSPIRATION_FRAGMENT_CHARS)
      if (!text) return []
      const sourceKind: InspirationSourceKind = (
        item.sourceKind === 'reference'
        || item.sourceKind === 'research'
        || item.sourceKind === 'other'
      ) ? item.sourceKind : 'author'
      return [{
        id: cleanText(item.id, 120) || createId('idea'),
        text,
        label: cleanText(item.label, 80),
        sourceKind,
        createdAt: Number.isFinite(item.createdAt) ? Number(item.createdAt) : Date.now(),
      }]
    })
  } catch {
    return []
  }
}

export function parseInspirationVersions(raw: string | undefined): InspirationVersion[] {
  try {
    const values = JSON.parse(raw || '[]')
    if (!Array.isArray(values)) return []
    const versions = values.flatMap((value): InspirationVersion[] => {
      if (!value || typeof value !== 'object') return []
      const item = value as Record<string, unknown>
      if (typeof item.resultJson !== 'string' || item.resultJson.length > MAX_INSPIRATION_RESULT_CHARS) {
        return []
      }
      const resultJson = item.resultJson.trim()
      try {
        JSON.parse(resultJson)
      } catch {
        return []
      }
      const mode: InspirationResultMode = item.mode === 'multiworld' ? 'multiworld' : 'single'
      return [{
        id: cleanText(item.id, 120) || createId('idea-version'),
        parentVersionId: typeof item.parentVersionId === 'string'
          ? cleanText(item.parentVersionId, 120) || null
          : null,
        mode,
        fragmentIds: Array.isArray(item.fragmentIds)
          ? item.fragmentIds.filter(id => typeof id === 'string').slice(0, MAX_INSPIRATION_FRAGMENTS)
          : [],
        resultJson,
        createdAt: Number.isFinite(item.createdAt) ? Number(item.createdAt) : Date.now(),
      }]
    }).slice(-MAX_INSPIRATION_VERSIONS)
    return repairInspirationVersionParents(versions)
  } catch {
    return []
  }
}

export function createInspirationFragment(input: {
  text: string
  label?: string
  sourceKind?: InspirationSourceKind
  now?: number
}): InspirationFragment | null {
  const text = typeof input.text === 'string'
    ? input.text.replace(/\r\n?/g, '\n').trim()
    : ''
  if (!text || text.length > MAX_INSPIRATION_FRAGMENT_CHARS) return null
  return {
    id: createId('idea'),
    text,
    label: cleanText(input.label, 80),
    sourceKind: input.sourceKind ?? 'author',
    createdAt: input.now ?? Date.now(),
  }
}

export function upsertInspirationFragment(
  current: InspirationFragment[],
  next: InspirationFragment,
): InspirationFragment[] {
  const normalized = next.text.replace(/\s+/g, '').toLocaleLowerCase()
  const duplicate = current.find(item =>
    item.text.replace(/\s+/g, '').toLocaleLowerCase() === normalized)
  if (duplicate) return current
  if (current.length >= MAX_INSPIRATION_FRAGMENTS) {
    throw new Error(`素材库已达到 ${MAX_INSPIRATION_FRAGMENTS} 条上限；请先删除未被确认版本引用的片段。新输入和已有来源均已保留`)
  }
  return [...current, next]
}

export function createInspirationVersion(input: {
  mode: InspirationResultMode
  parentVersionId?: string | null
  fragmentIds: string[]
  result: unknown
  now?: number
}): InspirationVersion {
  const fragmentIds = [...new Set(input.fragmentIds)]
  if (fragmentIds.length > MAX_INSPIRATION_FRAGMENTS) {
    throw new Error(`每个确认版本最多引用 ${MAX_INSPIRATION_FRAGMENTS} 个片段，请明确选择来源后重试`)
  }
  const resultJson = JSON.stringify(input.result)
  if (resultJson.length > MAX_INSPIRATION_RESULT_CHARS) {
    throw new Error(`融合结果超过 ${MAX_INSPIRATION_RESULT_CHARS} 字符，未写入版本历史`)
  }
  return {
    id: createId('idea-version'),
    parentVersionId: input.parentVersionId ?? null,
    mode: input.mode,
    fragmentIds,
    resultJson,
    createdAt: input.now ?? Date.now(),
  }
}

export function repairInspirationVersionParents(
  versions: InspirationVersion[],
): InspirationVersion[] {
  const retainedIds = new Set(versions.map(version => version.id))
  return versions.map(version => (
    version.parentVersionId && !retainedIds.has(version.parentVersionId)
      ? { ...version, parentVersionId: null }
      : version
  ))
}

export function latestInspirationVersion(
  versions: InspirationVersion[],
  mode: InspirationResultMode,
): InspirationVersion | null {
  // versions 按作者确认顺序追加；同一毫秒内连续确认时 createdAt 可能相同，
  // 不能只靠时间排序，否则会误取较早版本。
  for (let index = versions.length - 1; index >= 0; index--) {
    if (versions[index].mode === mode) return versions[index]
  }
  return null
}

export function buildInspirationFusionInput(input: {
  fragments: InspirationFragment[]
  selectedIds: ReadonlySet<string>
  previousVersion?: InspirationVersion | null
}): string {
  const selected = input.fragments
    .filter(fragment => input.selectedIds.has(fragment.id))
    .sort((a, b) => a.createdAt - b.createdAt)

  const parts: string[] = ['【本次参与融合的灵感碎片】']
  let used = parts[0].length
  for (const [index, fragment] of selected.entries()) {
    const label = fragment.label || `碎片 ${index + 1}`
    const block = `\n[I-${index + 1}｜${fragment.sourceKind}｜${label}]\n${fragment.text}`
    if (used + block.length > MAX_INSPIRATION_FUSION_CHARS) break
    parts.push(block)
    used += block.length
  }
  if (parts.length === 1) return ''

  if (input.previousVersion) {
    const previous = input.previousVersion.resultJson.slice(0, MAX_INSPIRATION_PREVIOUS_RESULT_CHARS)
    parts.push(
      '\n【上一版已确认框架】',
      previous,
      '\n【增量融合要求】保留未被新碎片否定的有效内容；明确吸收新增内容并解决冲突。不要简单覆盖，也不要重复堆砌。输出仍须严格遵守原 JSON 结构。',
    )
  }
  return parts.join('\n')
}

function flattenResult(
  value: unknown,
  prefix = '',
  output = new Map<string, string>(),
): Map<string, string> {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const named = item && typeof item === 'object' && typeof (item as Record<string, unknown>).name === 'string'
        ? String((item as Record<string, unknown>).name)
        : String(index + 1)
      flattenResult(item, `${prefix}[${named}]`, output)
    })
    return output
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      flattenResult(child, prefix ? `${prefix}.${key}` : key, output)
    }
    return output
  }
  output.set(prefix, String(value ?? '').slice(0, 220))
  return output
}

export function diffInspirationResults(
  before: unknown,
  after: unknown,
  maxItems = 24,
): InspirationResultDiff[] {
  const left = flattenResult(before)
  const right = flattenResult(after)
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort()
  return keys.flatMap((path): InspirationResultDiff[] => {
    const previous = left.get(path) ?? ''
    const next = right.get(path) ?? ''
    return previous === next ? [] : [{ path, before: previous, after: next }]
  }).slice(0, maxItems)
}
