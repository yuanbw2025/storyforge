import type {
  ScreenplayBeatCandidateV1,
  ScreenplayReviewCategoryV1,
  ScreenplayReviewIssueCandidateV1,
  ScreenplayRewritePatchCandidateV1,
  ScreenplaySceneCardCandidateV1,
} from '../types'
import { validateScreenplayBlocksV1 } from './contracts'

const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/
const BEAT_SCOPES = new Set(['act', 'sequence', 'episode'])
const REVIEW_CATEGORIES = new Set(['grounding', 'continuity', 'dramaturgy', 'format'])
const REVIEW_SEVERITIES = new Set(['critical', 'major', 'minor'])

function exactObject(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`[screenplay-production] ${label} 必须是对象`)
  const actual = Object.keys(value)
  const unknown = actual.filter(key => !keys.includes(key))
  const missing = keys.filter(key => !actual.includes(key))
  if (unknown.length || missing.length) throw new Error(`[screenplay-production] ${label} 字段不在闭集：${[...unknown, ...missing].join('、')}`)
}

function text(value: unknown, label: string, max = 8_000): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`[screenplay-production] ${label} 必须为 1～${max} 字符`)
}

function key(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !KEY.test(value)) throw new Error(`[screenplay-production] ${label} stable key 非法`)
}

function positive(value: unknown, label: string, max = 86_400): asserts value is number {
  if (!Number.isInteger(value) || Number(value) <= 0 || Number(value) > max) throw new Error(`[screenplay-production] ${label} 必须为有效正整数`)
}

function nonNegative(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`[screenplay-production] ${label} 必须为非负整数`)
}

function keyArray(value: unknown, label: string, allowEmpty = false): asserts value is string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > 500
    || value.some(item => typeof item !== 'string' || !KEY.test(item)) || new Set(value).size !== value.length) {
    throw new Error(`[screenplay-production] ${label} 必须为${allowEmpty ? '可空' : '非空'}、无重复的 stable key 数组`)
  }
}

export const SCREENPLAY_BEAT_CANDIDATE_KEYS_V1 = [
  'stableKey', 'sectionKey', 'sectionTitle', 'scope', 'episodeNumber', 'order', 'objective',
  'conflict', 'turn', 'outcome', 'causalFactKeys', 'decisionKeys', 'sourceUnitKeys', 'estimatedSeconds',
] as const

export function assertScreenplayBeatCandidateV1(value: unknown): asserts value is ScreenplayBeatCandidateV1 {
  exactObject(value, SCREENPLAY_BEAT_CANDIDATE_KEYS_V1, 'Beat')
  key(value.stableKey, 'Beat.stableKey'); key(value.sectionKey, 'Beat.sectionKey')
  text(value.sectionTitle, 'Beat.sectionTitle', 500)
  if (!BEAT_SCOPES.has(String(value.scope))) throw new Error('[screenplay-production] Beat.scope 非法')
  positive(value.episodeNumber, 'Beat.episodeNumber', 1_000); nonNegative(value.order, 'Beat.order')
  text(value.objective, 'Beat.objective'); text(value.conflict, 'Beat.conflict'); text(value.turn, 'Beat.turn'); text(value.outcome, 'Beat.outcome')
  keyArray(value.causalFactKeys, 'Beat.causalFactKeys', true); keyArray(value.decisionKeys, 'Beat.decisionKeys')
  keyArray(value.sourceUnitKeys, 'Beat.sourceUnitKeys'); positive(value.estimatedSeconds, 'Beat.estimatedSeconds')
}

export const SCREENPLAY_SCENE_CARD_CANDIDATE_KEYS_V1 = [
  'stableKey', 'beatKey', 'episodeNumber', 'sceneNumber', 'order', 'purpose', 'conflict',
  'entryState', 'exitState', 'visibleAction', 'informationReveal', 'sourceUnitKeys', 'estimatedSeconds',
] as const

export function assertScreenplaySceneCardCandidateV1(value: unknown): asserts value is ScreenplaySceneCardCandidateV1 {
  exactObject(value, SCREENPLAY_SCENE_CARD_CANDIDATE_KEYS_V1, 'SceneCard')
  key(value.stableKey, 'SceneCard.stableKey'); key(value.beatKey, 'SceneCard.beatKey')
  positive(value.episodeNumber, 'SceneCard.episodeNumber', 1_000); positive(value.sceneNumber, 'SceneCard.sceneNumber', 10_000); nonNegative(value.order, 'SceneCard.order')
  text(value.purpose, 'SceneCard.purpose'); text(value.conflict, 'SceneCard.conflict')
  text(value.entryState, 'SceneCard.entryState'); text(value.exitState, 'SceneCard.exitState')
  text(value.visibleAction, 'SceneCard.visibleAction'); text(value.informationReveal, 'SceneCard.informationReveal')
  keyArray(value.sourceUnitKeys, 'SceneCard.sourceUnitKeys'); positive(value.estimatedSeconds, 'SceneCard.estimatedSeconds')
}

export const SCREENPLAY_REVIEW_ISSUE_CANDIDATE_KEYS_V1 = [
  'stableKey', 'category', 'severity', 'sceneKey', 'blockId', 'evidence', 'problem', 'suggestion', 'sourceUnitKeys',
] as const

export function assertScreenplayReviewIssueCandidateV1(value: unknown, expectedCategory?: ScreenplayReviewCategoryV1): asserts value is ScreenplayReviewIssueCandidateV1 {
  exactObject(value, SCREENPLAY_REVIEW_ISSUE_CANDIDATE_KEYS_V1, 'ReviewIssue')
  key(value.stableKey, 'ReviewIssue.stableKey'); key(value.sceneKey, 'ReviewIssue.sceneKey')
  if (!REVIEW_CATEGORIES.has(String(value.category)) || (expectedCategory && value.category !== expectedCategory)) throw new Error('[screenplay-production] ReviewIssue.category 非法或与审查阶段不一致')
  if (!REVIEW_SEVERITIES.has(String(value.severity))) throw new Error('[screenplay-production] ReviewIssue.severity 非法')
  if (value.blockId !== null) key(value.blockId, 'ReviewIssue.blockId')
  text(value.evidence, 'ReviewIssue.evidence'); text(value.problem, 'ReviewIssue.problem'); text(value.suggestion, 'ReviewIssue.suggestion')
  keyArray(value.sourceUnitKeys, 'ReviewIssue.sourceUnitKeys', value.category !== 'grounding')
}

export const SCREENPLAY_REWRITE_PATCH_KEYS_V1 = ['sceneKey', 'expectedSceneRevision', 'issueKeys', 'summary', 'blocks'] as const

export function assertScreenplayRewritePatchCandidateV1(value: unknown): asserts value is ScreenplayRewritePatchCandidateV1 {
  exactObject(value, SCREENPLAY_REWRITE_PATCH_KEYS_V1, 'RewritePatch')
  key(value.sceneKey, 'RewritePatch.sceneKey'); positive(value.expectedSceneRevision, 'RewritePatch.expectedSceneRevision', Number.MAX_SAFE_INTEGER)
  keyArray(value.issueKeys, 'RewritePatch.issueKeys'); text(value.summary, 'RewritePatch.summary', 20_000)
  if (!Array.isArray(value.blocks)) throw new Error('[screenplay-production] RewritePatch.blocks 必须是数组')
  const report = validateScreenplayBlocksV1(value.blocks as ScreenplayRewritePatchCandidateV1['blocks'])
  if (!report.valid) throw new Error(`[screenplay-production] RewritePatch blocks 非法：${report.issues.filter(item => item.level === 'error').map(item => item.message).join('；')}`)
}

export function assertCandidateBatchV1<T>(values: unknown, validate: (value: unknown) => asserts value is T, label: string, allowEmpty = false, max = 500): asserts values is T[] {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0) || values.length > max) throw new Error(`[screenplay-production] ${label} 批次数量非法`)
  values.forEach(validate)
  const keys = values.map(value => (value as { stableKey?: string }).stableKey).filter(Boolean)
  if (keys.length && new Set(keys).size !== keys.length) throw new Error(`[screenplay-production] ${label} stableKey 重复`)
}
