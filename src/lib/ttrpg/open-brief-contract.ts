/** Pure recap wire contracts, shared by source readers, candidates and receipt replay. */
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import type { TtrpgOpenSourceRefV1 } from './open-coordination'
import * as p from './open-contract-parse'

export const TTRPG_OPEN_BRIEF_INPUT_SOURCE_V1 = 'ttrpgOpenBriefInput'
export const TTRPG_OPEN_BRIEF_ENTRY_KINDS_V1 = ['release-observation', 'known-evidence', 'confirmed-session-fact', 'published-telegraph', 'retained-narration'] as const
export type TtrpgOpenBriefEntryKindV1 = typeof TTRPG_OPEN_BRIEF_ENTRY_KINDS_V1[number]
export const TTRPG_OPEN_BRIEF_RELIABILITY_V1 = ['release-time', 'confirmed', 'observed', 'hearsay', 'belief', 'narrated'] as const
export type TtrpgOpenBriefReliabilityV1 = typeof TTRPG_OPEN_BRIEF_RELIABILITY_V1[number]

export interface TtrpgOpenBriefV1 { paragraphs: Array<{ text: string; sourceKeys: string[] }> }
export interface TtrpgOpenBriefAttributionV1 {
  citationKey: string; resourceKey: string; contextSourceKey: 'ttrpgOpenBriefInput' | 'ttrpgOpenPartyMemory' | 'ttrpgOpenCommonIdentities'; contentHash: string
  kind: 'stage' | 'release-observation' | 'known-evidence' | 'confirmed-session-fact' | 'published-telegraph' | 'retained-narration' | 'memory' | 'known-identity'
  reliability: 'release-time' | 'confirmed' | 'observed' | 'hearsay' | 'belief' | 'narrated'
  observerKey: string | null
  origin: 'human-authored' | 'model-reviewed' | null
  sourceRef: TtrpgOpenSourceRefV1 | null
  /** Flat original sources, not recursively embedded summaries. Only derived model memories carry these. */
  originalSources?: Array<Omit<TtrpgOpenBriefAttributionV1, 'originalSources'>>
}

export function parseTtrpgOpenBriefV1(value: unknown, sources: readonly TtrpgOpenBriefAttributionV1[]): TtrpgOpenBriefV1 {
  const root = p.record(value, ['paragraphs'], 'stage recap output'), keys = new Set(sources.map(source => source.citationKey))
  const paragraphs = p.list(root.paragraphs, 'recap paragraphs', value => {
    const row = p.record(value, ['text', 'sourceKeys'], 'recap paragraph')
    const sourceKeys = p.list(row.sourceKeys, 'actual recap citations', (value, label) => p.text(value, label, 512), 32, 1)
    p.unique(sourceKeys, 'recap paragraph citations')
    if (sourceKeys.some(key => !keys.has(key))) p.fail('复盘引用了未实际交付的资料，不能杜撰或借用目录项')
    return { text: p.text(row.text, 'recap paragraph text', 4000), sourceKeys }
  }, 8, 1)
  if (paragraphs.reduce((sum, paragraph) => sum + paragraph.text.length, 0) > 16000) p.fail('复盘正文超出完整记忆预算')
  return { paragraphs }
}

export function parseTtrpgOpenBriefAttributionV1(value: unknown): TtrpgOpenBriefAttributionV1 {
  return parseAttribution(value, true)
}
function parseAttribution(value: unknown, allowOriginals: boolean): TtrpgOpenBriefAttributionV1 {
  const hasOriginals = value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'originalSources')
  const r = p.record(value, ['citationKey', 'resourceKey', 'contextSourceKey', 'contentHash', 'kind', 'reliability', 'observerKey', 'origin', 'sourceRef',
    ...(allowOriginals && hasOriginals ? ['originalSources'] : [])], 'recap source attribution')
  const kind = p.oneOf(r.kind, ['stage', ...TTRPG_OPEN_BRIEF_ENTRY_KINDS_V1, 'memory', 'known-identity'], 'attribution kind')
  const reliability = p.oneOf(r.reliability, TTRPG_OPEN_BRIEF_RELIABILITY_V1, 'attribution reliability')
  const observerKey = p.nullable(r.observerKey, p.key, 'attribution observer')
  const contextSourceKey = p.oneOf(r.contextSourceKey, ['ttrpgOpenBriefInput', 'ttrpgOpenPartyMemory', 'ttrpgOpenCommonIdentities'], 'attribution registered source')
  const allowed = { stage: ['confirmed'], 'release-observation': ['release-time'], 'known-evidence': ['observed', 'hearsay', 'belief'],
    'confirmed-session-fact': ['confirmed'], 'published-telegraph': ['observed'], 'retained-narration': ['narrated'], memory: ['observed', 'hearsay', 'belief'], 'known-identity': ['observed', 'hearsay', 'belief'] }
  if (!allowed[kind].includes(reliability) || (contextSourceKey === 'ttrpgOpenPartyMemory') !== (kind === 'memory')
    || (contextSourceKey === 'ttrpgOpenCommonIdentities') !== (kind === 'known-identity')
    || kind === 'memory' && reliability !== 'observed' && observerKey === null) p.fail('引用类别、原可靠性或观察者不闭合')
  const origin = p.nullable(r.origin, (v, l) => p.oneOf(v, ['human-authored', 'model-reviewed'], l), 'attribution origin')
  const sourceRef = p.nullable(r.sourceRef, parseTtrpgOpenSourceRefV1, 'attribution source reference')
  if (kind === 'known-identity' && (observerKey !== null || sourceRef !== null || typeof r.citationKey !== 'string'
    || !/^identity\.[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(r.citationKey) || typeof r.resourceKey !== 'string'
    || !r.resourceKey.endsWith(`:common-${r.citationKey}`))) p.fail('共同身份引用不得捏造个人观察者、私密来源或资源身份')
  if ((['memory', 'retained-narration'].includes(kind) ? origin === null || sourceRef === null : origin !== null)
    || kind === 'retained-narration' && observerKey !== 'gm') p.fail('引用必须保留实际叙述/记忆来源，不能补造作者或观察者')
  const originalSources = hasOriginals ? p.list(r.originalSources, 'flat original recap sources', v => parseAttribution(v, false), 1024, 1) : undefined
  if (originalSources && (kind !== 'memory' || origin !== 'model-reviewed'
    || new Set(originalSources.map(source => `${source.resourceKey}:${source.contentHash}`)).size !== originalSources.length)) p.fail('原始来源只能由模型记忆继承且不得重复或递归嵌套')
  return { citationKey: p.text(r.citationKey, 'attribution citation', 512), resourceKey: p.text(r.resourceKey, 'attribution resource', 2000),
    contextSourceKey, contentHash: p.hash(r.contentHash, 'actual source content hash'), kind, reliability, observerKey,
    origin, sourceRef, ...(originalSources ? { originalSources } : {}) }
}
