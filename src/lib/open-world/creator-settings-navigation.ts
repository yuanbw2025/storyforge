import type { TextOpenWorldCreatorSourceBindingV1 } from '../types'
import type { TextOpenWorldCreatorBriefResumeTargetV1 } from './creator-brief'
import { parseTextOpenWorldCreatorSourceBindingV1 } from './creator-brief-persistence'

const HASH = /^[a-f0-9]{64}$/
const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

export type TextOpenWorldEntrySourceV1 = 'world-release' | 'novel'

/** Browser-history-only return capability. It contains no API credential,
 * source text, or mutable ProductProduction payload. */
export interface TextOpenWorldSettingsReturnV1 extends TextOpenWorldCreatorBriefResumeTargetV1 {
  schema: 'storyforge.text-open-world-settings-return'
  version: 1
  activeWorkProjectId: number | null
  activeWorldProjectId: number | null
  sourceKind: TextOpenWorldEntrySourceV1
}

function exactKeys(row: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(row).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function positiveIdOrNull(value: unknown): value is number | null {
  return value == null || (Number.isSafeInteger(value) && Number(value) > 0)
}

export function parseTextOpenWorldSettingsReturnV1(value: unknown): TextOpenWorldSettingsReturnV1 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const outer = value as Record<string, unknown>
  if (!exactKeys(outer, ['storyforgeProductHubReturn'])
    || !outer.storyforgeProductHubReturn || typeof outer.storyforgeProductHubReturn !== 'object'
    || Array.isArray(outer.storyforgeProductHubReturn)) return null
  const row = outer.storyforgeProductHubReturn as Record<string, unknown>
  if (!exactKeys(row, [
    'schema', 'version', 'activeWorkProjectId', 'activeWorldProjectId', 'sourceKind',
    'conversationId', 'productInstanceKey', 'sourceBindingHash', 'sourceBinding',
  ])
    || row.schema !== 'storyforge.text-open-world-settings-return' || row.version !== 1
    || !positiveIdOrNull(row.activeWorkProjectId) || !positiveIdOrNull(row.activeWorldProjectId)
    || !Number.isSafeInteger(row.conversationId) || Number(row.conversationId) < 1
    || typeof row.productInstanceKey !== 'string' || !STABLE_KEY.test(row.productInstanceKey)
    || typeof row.sourceBindingHash !== 'string' || !HASH.test(row.sourceBindingHash)
    || (row.sourceKind !== 'world-release' && row.sourceKind !== 'novel')) return null
  let sourceBinding: TextOpenWorldCreatorSourceBindingV1
  try { sourceBinding = parseTextOpenWorldCreatorSourceBindingV1(row.sourceBinding) }
  catch { return null }
  if (sourceBinding.kind !== row.sourceKind) return null
  return {
    schema: row.schema,
    version: row.version,
    activeWorkProjectId: row.activeWorkProjectId as number | null,
    activeWorldProjectId: row.activeWorldProjectId as number | null,
    sourceKind: row.sourceKind,
    conversationId: Number(row.conversationId),
    productInstanceKey: row.productInstanceKey,
    sourceBindingHash: row.sourceBindingHash,
    sourceBinding,
  }
}

/** Keep the history-bound selection intact until the initial IndexedDB load
 * has completed. An empty initial Zustand snapshot is not evidence that the
 * project was deleted. */
export function resolveProjectSelectionAfterInitialLoadV1(input: {
  currentProjectId: number | null
  projectsInitialized: boolean
  authoritativeProjectIds: readonly number[]
  fallbackProjectIds?: readonly number[]
}): number | null {
  if (!input.projectsInitialized) return input.currentProjectId
  if (input.currentProjectId != null
    && input.authoritativeProjectIds.includes(input.currentProjectId)) return input.currentProjectId
  return input.fallbackProjectIds?.[0] ?? input.authoritativeProjectIds[0] ?? null
}
