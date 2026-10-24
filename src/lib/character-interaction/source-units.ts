import {canonicalStringify} from '../agent/run/hash'
import type {ChatSourceReviewContextV1} from './source-review-context'

/** S2 interpretation candidates. No audience, discovery permission or runtime writes. */
export interface ChatSourceUnitV1 {key: string; text: string; quotes: string[]}
export interface ChatSourceUnitsCandidateV1 {
  fragments: Array<{fragmentKey: string; facts: ChatSourceUnitV1[]; constraints: ChatSourceUnitV1[]}>
}
export interface ChatSourceUnitsReviewV1 {
  fragments: Array<{
    fragmentKey: string; complete: boolean; reason: string
    facts: Array<{key: string; faithful: boolean; atomic: boolean; standalone: boolean; established: boolean; reason: string}>
    constraints: Array<{key: string; faithful: boolean; reason: string}>
  }>
}
function fail(message: string): never {throw new Error(`事实整理无效：${message}`)}
function record(value: unknown, fields: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== fields.split(',').sort().join(',')) fail('字段不在允许范围')
}
function text(value: unknown, max: number): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('文字为空或超出容量')
}
function items(value: unknown, max: number): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > max) fail('条目数量超出容量')
}
export function parseChatSourceUnitsCandidateV1(value: unknown): ChatSourceUnitsCandidateV1 {
  record(value, 'fragments'); items(value.fragments, 12)
  if (!value.fragments.length) fail('请选择至少一段原文')
  const fragments = new Set<string>(); let total = 0
  for (const fragment of value.fragments) {
    record(fragment, 'fragmentKey,facts,constraints'); text(fragment.fragmentKey, 1000)
    if (fragments.has(fragment.fragmentKey)) fail('原文片段重复')
    fragments.add(fragment.fragmentKey); items(fragment.facts, 16); items(fragment.constraints, 16)
    const keys = new Set<string>()
    if (!fragment.facts.length && !fragment.constraints.length) fail('每段原文须有事实或保留限制，不能静默省略')
    for (const item of [...fragment.facts, ...fragment.constraints]) {
      record(item, 'key,text,quotes'); text(item.key, 80); text(item.text, 600); items(item.quotes, 4)
      if (!/^[a-z][a-z0-9-]*$/.test(item.key) || keys.has(item.key)) fail('同一片段的事实和限制需要不重复的稳定标识')
      keys.add(item.key)
      if (!item.quotes.length || new Set(item.quotes).size !== item.quotes.length) fail('每项须有不重复的原文引用')
      for (const quote of item.quotes) text(quote, 800)
      if (++total > 64) fail('一次最多整理64项事实与限制')
    }
  }
  return structuredClone(value) as unknown as ChatSourceUnitsCandidateV1
}

/** Quote matching is evidence integrity only, never a semantic fidelity/coverage verdict. */
export function validateChatSourceUnitsEvidenceV1(value: unknown, context: ChatSourceReviewContextV1): ChatSourceUnitsCandidateV1 {
  const candidate = parseChatSourceUnitsCandidateV1(value)
  if (context.perspective || context.audience !== 'author-only') fail('须以作者视角读取完整所选资料')
  if (candidate.fragments.length !== context.fragments.length) fail('必须保留全部所选片段')
  for (const fragment of candidate.fragments) {
    const source = context.fragments.find(row => row.fragmentKey === fragment.fragmentKey)
    if (!source) fail('引用了未选择的片段')
    const decoded: unknown = JSON.parse(source.valueJson)
    const original = typeof decoded === 'string' ? decoded : source.valueJson
    for (const item of [...fragment.facts, ...fragment.constraints]) {
      if (item.quotes.some(quote => !original.includes(quote))) fail('引用须为对应原文的连续文字，不得拼接或改写')
    }
  }
  return candidate
}

/** Closed, exhaustive independent verdict: omission cannot become approval. */
export function parseChatSourceUnitsReviewV1(value: unknown, candidate: ChatSourceUnitsCandidateV1): ChatSourceUnitsReviewV1 {
  record(value, 'fragments'); items(value.fragments, 12)
  if (value.fragments.length !== candidate.fragments.length) fail('复核必须覆盖全部原文')
  const seen = new Set<string>()
  for (const fragment of value.fragments) {
    record(fragment, 'fragmentKey,complete,reason,facts,constraints'); text(fragment.fragmentKey, 1000); text(fragment.reason, 1200)
    const source = candidate.fragments.find(row => row.fragmentKey === fragment.fragmentKey)
    if (!source || seen.has(fragment.fragmentKey) || typeof fragment.complete !== 'boolean') fail('复核片段缺失、重复或覆盖结论无效')
    seen.add(fragment.fragmentKey)
    for (const kind of ['facts', 'constraints'] as const) {
      const rows = fragment[kind]; items(rows, 16)
      if (rows.length !== source[kind].length) fail('复核须逐项检查事实与限制')
      const keys = new Set<string>()
      for (const row of rows) {
        record(row, kind === 'facts' ? 'key,faithful,atomic,standalone,established,reason' : 'key,faithful,reason')
        text(row.key, 80); text(row.reason, 1200)
        if (!source[kind].some(item => item.key === row.key) || keys.has(row.key)) fail('复核条目缺失或重复')
        keys.add(row.key)
        for (const flag of kind === 'facts' ? ['faithful', 'atomic', 'standalone', 'established'] : ['faithful'])
          if (typeof row[flag] !== 'boolean') fail('复核结论必须为明确的布尔值')
      }
    }
  }
  return structuredClone(value) as unknown as ChatSourceUnitsReviewV1
}
export function chatSourceUnitsReviewPassedV1(review: ChatSourceUnitsReviewV1): boolean {
  return review.fragments.every(row => row.complete && row.facts.every(fact => fact.faithful && fact.atomic && fact.standalone && fact.established)
    && row.constraints.every(constraint => constraint.faithful))
}
export function sameChatSourceUnitsCandidateV1(left: unknown, right: unknown): boolean {
  try {return canonicalStringify(parseChatSourceUnitsCandidateV1(left)) === canonicalStringify(parseChatSourceUnitsCandidateV1(right))} catch {return false}
}
