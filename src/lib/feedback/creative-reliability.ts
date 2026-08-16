import { APP_BUILD_ID } from '../version'

export const CREATIVE_RELIABILITY_FEEDBACK_STORAGE_KEY_V1 =
  'storyforge:creative-reliability:community-feedback-v1'
export const CREATIVE_RELIABILITY_FEEDBACK_FORMAT_V1 =
  'storyforge-creative-reliability-feedback'
export const CREATIVE_RELIABILITY_FEEDBACK_POLICY_VERSION_V1 = 'crel-v1'
export const CREATIVE_RELIABILITY_FEEDBACK_MAX_RECORDS_V1 = 50

export const CREATIVE_RELIABILITY_FEEDBACK_STAGES_V1 = [
  'story-arc',
  'outline',
  'detailed-outline',
  'prose',
  'long-form',
] as const

export const CREATIVE_RELIABILITY_FEEDBACK_OUTCOMES_V1 = [
  'kept',
  'edited',
  'discarded',
] as const

export const CREATIVE_RELIABILITY_FEEDBACK_TAGS_V1 = [
  'irrelevant',
  'stalled',
  'infodump',
  'structure',
  'continuity',
  'cost',
  'latency',
  'other',
] as const

export type CreativeReliabilityFeedbackStageV1 =
  typeof CREATIVE_RELIABILITY_FEEDBACK_STAGES_V1[number]
export type CreativeReliabilityFeedbackOutcomeV1 =
  typeof CREATIVE_RELIABILITY_FEEDBACK_OUTCOMES_V1[number]
export type CreativeReliabilityFeedbackTagV1 =
  typeof CREATIVE_RELIABILITY_FEEDBACK_TAGS_V1[number]
export type CreativeReliabilityFeedbackRatingV1 = 1 | 2 | 3 | 4 | 5

export interface CreativeReliabilityFeedbackInputV1 {
  stage: CreativeReliabilityFeedbackStageV1
  outcome: CreativeReliabilityFeedbackOutcomeV1
  rating: CreativeReliabilityFeedbackRatingV1
  editMinutes: number
  tags: CreativeReliabilityFeedbackTagV1[]
}

export interface CreativeReliabilityFeedbackRecordV1 extends CreativeReliabilityFeedbackInputV1 {
  id: string
  createdAt: number
  appBuildId: string
  policyVersion: typeof CREATIVE_RELIABILITY_FEEDBACK_POLICY_VERSION_V1
}

export interface CreativeReliabilityFeedbackBundleV1 {
  format: typeof CREATIVE_RELIABILITY_FEEDBACK_FORMAT_V1
  version: 1
  exportedAt: number
  privacy: {
    includesProjectIdentity: false
    includesManuscript: false
    includesPromptOrModelOutput: false
    includesApiKeys: false
    automaticallyUploaded: false
  }
  records: CreativeReliabilityFeedbackRecordV1[]
}

type FeedbackStorageV1 = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

interface FeedbackWriteOptionsV1 {
  storage?: FeedbackStorageV1
  now?: number
  id?: string
  appBuildId?: string
}

const BUNDLE_KEYS = ['exportedAt', 'format', 'privacy', 'records', 'version'] as const
const PRIVACY_KEYS = [
  'automaticallyUploaded',
  'includesApiKeys',
  'includesManuscript',
  'includesProjectIdentity',
  'includesPromptOrModelOutput',
] as const
const RECORD_KEYS = [
  'appBuildId',
  'createdAt',
  'editMinutes',
  'id',
  'outcome',
  'policyVersion',
  'rating',
  'stage',
  'tags',
] as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  return actual.length === expected.length
    && actual.every((key, index) => key === [...expected].sort()[index])
}

function isSafeIntegerBetween(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max
}

function isFeedbackTag(value: unknown): value is CreativeReliabilityFeedbackTagV1 {
  return CREATIVE_RELIABILITY_FEEDBACK_TAGS_V1.includes(value as CreativeReliabilityFeedbackTagV1)
}

function parseRecordV1(value: unknown): CreativeReliabilityFeedbackRecordV1 | null {
  if (!isPlainObject(value) || !hasExactKeys(value, RECORD_KEYS)) return null
  if (typeof value.id !== 'string' || value.id.length < 1 || value.id.length > 160) return null
  if (typeof value.appBuildId !== 'string' || value.appBuildId.length < 1 || value.appBuildId.length > 160) return null
  if (!isSafeIntegerBetween(value.createdAt, 0, Number.MAX_SAFE_INTEGER)) return null
  if (value.policyVersion !== CREATIVE_RELIABILITY_FEEDBACK_POLICY_VERSION_V1) return null
  if (!CREATIVE_RELIABILITY_FEEDBACK_STAGES_V1.includes(value.stage as CreativeReliabilityFeedbackStageV1)) return null
  if (!CREATIVE_RELIABILITY_FEEDBACK_OUTCOMES_V1.includes(value.outcome as CreativeReliabilityFeedbackOutcomeV1)) return null
  if (!isSafeIntegerBetween(value.rating, 1, 5)) return null
  if (!isSafeIntegerBetween(value.editMinutes, 0, 10_080)) return null
  if (!Array.isArray(value.tags) || value.tags.length > CREATIVE_RELIABILITY_FEEDBACK_TAGS_V1.length) return null
  if (!value.tags.every(isFeedbackTag) || new Set(value.tags).size !== value.tags.length) return null

  return value as unknown as CreativeReliabilityFeedbackRecordV1
}

function privacyDeclarationV1(): CreativeReliabilityFeedbackBundleV1['privacy'] {
  return {
    includesProjectIdentity: false,
    includesManuscript: false,
    includesPromptOrModelOutput: false,
    includesApiKeys: false,
    automaticallyUploaded: false,
  }
}

function resolveStorage(storage?: FeedbackStorageV1): FeedbackStorageV1 {
  if (storage) return storage
  if (typeof localStorage === 'undefined') throw new Error('当前环境不支持本地反馈存储')
  return localStorage
}

function createIdV1(now: number): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `crel-feedback-${now}-${Math.random().toString(36).slice(2, 12)}`
}

export function createCreativeReliabilityFeedbackBundleV1(
  records: CreativeReliabilityFeedbackRecordV1[],
  exportedAt = Date.now(),
): CreativeReliabilityFeedbackBundleV1 {
  return {
    format: CREATIVE_RELIABILITY_FEEDBACK_FORMAT_V1,
    version: 1,
    exportedAt,
    privacy: privacyDeclarationV1(),
    records: records.slice(0, CREATIVE_RELIABILITY_FEEDBACK_MAX_RECORDS_V1),
  }
}

export function parseCreativeReliabilityFeedbackBundleV1(
  value: unknown,
): CreativeReliabilityFeedbackBundleV1 | null {
  if (!isPlainObject(value) || !hasExactKeys(value, BUNDLE_KEYS)) return null
  if (value.format !== CREATIVE_RELIABILITY_FEEDBACK_FORMAT_V1 || value.version !== 1) return null
  if (!isSafeIntegerBetween(value.exportedAt, 0, Number.MAX_SAFE_INTEGER)) return null
  if (!isPlainObject(value.privacy) || !hasExactKeys(value.privacy, PRIVACY_KEYS)) return null
  if (
    value.privacy.includesProjectIdentity !== false
    || value.privacy.includesManuscript !== false
    || value.privacy.includesPromptOrModelOutput !== false
    || value.privacy.includesApiKeys !== false
    || value.privacy.automaticallyUploaded !== false
  ) return null
  if (!Array.isArray(value.records) || value.records.length > CREATIVE_RELIABILITY_FEEDBACK_MAX_RECORDS_V1) return null
  const records = value.records.map(parseRecordV1)
  if (records.some(record => record === null)) return null
  const typedRecords = records as CreativeReliabilityFeedbackRecordV1[]
  if (new Set(typedRecords.map(record => record.id)).size !== typedRecords.length) return null

  return {
    format: CREATIVE_RELIABILITY_FEEDBACK_FORMAT_V1,
    version: 1,
    exportedAt: value.exportedAt,
    privacy: privacyDeclarationV1(),
    records: typedRecords,
  }
}

export function loadCreativeReliabilityFeedbackV1(
  storage?: FeedbackStorageV1,
): CreativeReliabilityFeedbackRecordV1[] {
  try {
    const raw = resolveStorage(storage).getItem(CREATIVE_RELIABILITY_FEEDBACK_STORAGE_KEY_V1)
    if (!raw) return []
    const bundle = parseCreativeReliabilityFeedbackBundleV1(JSON.parse(raw))
    return bundle?.records ?? []
  } catch {
    return []
  }
}

export function saveCreativeReliabilityFeedbackV1(
  input: CreativeReliabilityFeedbackInputV1,
  options: FeedbackWriteOptionsV1 = {},
): CreativeReliabilityFeedbackBundleV1 {
  const now = options.now ?? Date.now()
  const candidate = parseRecordV1({
    ...input,
    id: options.id ?? createIdV1(now),
    createdAt: now,
    appBuildId: options.appBuildId ?? APP_BUILD_ID,
    policyVersion: CREATIVE_RELIABILITY_FEEDBACK_POLICY_VERSION_V1,
  })
  if (!candidate) throw new Error('反馈字段不合法')

  const storage = resolveStorage(options.storage)
  const existing = loadCreativeReliabilityFeedbackV1(storage)
  const bundle = createCreativeReliabilityFeedbackBundleV1(
    [candidate, ...existing.filter(record => record.id !== candidate.id)],
    now,
  )
  storage.setItem(CREATIVE_RELIABILITY_FEEDBACK_STORAGE_KEY_V1, JSON.stringify(bundle))
  return bundle
}

export function serializeCreativeReliabilityFeedbackV1(
  storage?: FeedbackStorageV1,
  exportedAt = Date.now(),
): string {
  return JSON.stringify(
    createCreativeReliabilityFeedbackBundleV1(loadCreativeReliabilityFeedbackV1(storage), exportedAt),
    null,
    2,
  )
}

export function clearCreativeReliabilityFeedbackV1(storage?: FeedbackStorageV1): void {
  resolveStorage(storage).removeItem(CREATIVE_RELIABILITY_FEEDBACK_STORAGE_KEY_V1)
}
