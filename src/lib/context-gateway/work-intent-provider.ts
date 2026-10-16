import { estimateTokens } from '../ai/context-budget'
import { buildGenreConstraintContext } from '../ai/genre-metadata'
import { buildStylePromptInjection } from '../ai/writing-styles'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { hashCanonicalValue } from '../agent/run/hash'
import { db } from '../db/schema'
import type { ContextResourceProviderV1, ContextResourceDescriptorV1, ContextSourceRefV1, FrozenResourceScopeV1 } from '../registry/types'
import type { Work } from '../types'
import { canonScopeFingerprintV1 } from './canon-provider'

const SOURCE_KEY = 'workAuthoringIntent'
const PROVIDER_VERSION = 'work-authoring-intent-v2'
const FIELDS = ['title', 'description', 'genres', 'customGenre', 'writingStyleId'] as const
const exact = (value: unknown) => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value)

export function workAuthoringIntentResourceKeyV1(work: Pick<Work, 'code'>): string {
  if (!work.code?.trim()) throw new Error('作品意图缺少稳定 Work code。')
  return `work-intent:${encodeURIComponent(work.code)}`
}

async function projection(scope: FrozenResourceScopeV1) {
  await canonScopeFingerprintV1(scope)
  const work = await db.works.get(scope.workId!)
  if (!work || work.projectId !== scope.projectId || work.worldId !== scope.worldId) throw new Error('作品意图不属于当前 Work。')
  const sourceRefs: ContextSourceRefV1[] = await Promise.all(FIELDS.map(async field => ({
    table: 'works', recordId: work.id!, field, revision: work.updatedAt,
    contentHash: await sha256Text(exact(work[field])),
  })))
  const content = [
    '【作者确认的作品意图与文风】这些是当前作品的写作偏好，不是已发生的故事事实。',
    `作品：${work.title}`,
    ...(work.description ? [`简介与创作方向：${work.description}`] : []),
    `题材：${work.genres.join('、')}${work.customGenre ? `；自定义题材：${work.customGenre}` : ''}`,
    buildGenreConstraintContext(work.genres),
    work.writingStyleId ? buildStylePromptInjection(work.writingStyleId) : '',
    '优先采用本轮作者要求和已确认创作规则；文风画像、题材建议与预设用于辅助表达，不能强制固定情节配比、奖励、冲突或结尾。',
    '文风示例只供句式、节奏和声音参考，不把示例的人物、事件或未来结果搬进本章。',
  ].filter(Boolean).join('\n\n')
  const summary = `作品《${work.title}》；题材 ${work.genres.join('、')}；文风 ${work.writingStyleId || '由创作规则与作者要求决定'}`
  const descriptor: ContextResourceDescriptorV1 = {
    version: 1, sourceKey: SOURCE_KEY, resourceKey: workAuthoringIntentResourceKeyV1(work), kind: 'reference',
    title: `作品意图 · ${work.title}`, shortSummary: summary.slice(0, 300), authority: 'confirmed-evidence',
    contentRevision: work.updatedAt, contentHash: await sha256Text(content),
    policyRevision: 1, policyHash: await hashCanonicalValue({ sourceKey: SOURCE_KEY, providerVersion: PROVIDER_VERSION, fields: FIELDS }),
    scope: { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId },
    relations: [], sourceRefs,
    tokenEstimate: { index: estimateTokens(summary.slice(0, 300)), summary: estimateTokens(summary.slice(0, 300)), focused: estimateTokens(content), full: estimateTokens(content), original: estimateTokens(content) },
    availableDepths: ['index', 'summary', 'focused', 'full', 'original'], priority: 'normal',
  }
  return { work, descriptor, content }
}

async function page(input: Parameters<ContextResourceProviderV1['listMetadata']>[0], query?: string) {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100 || input.cursor != null) throw new Error('作品意图目录参数无效。')
  const { descriptor } = await projection(input.scope)
  const items = (!input.kinds || input.kinds.includes('reference'))
    && (!query || `${descriptor.title}\n${descriptor.shortSummary}`.includes(query)) ? [descriptor] : []
  return { version: 1 as const, items, nextCursor: null, scopeFingerprint: await canonScopeFingerprintV1(input.scope) }
}

function assertBudget(content: string, maxTokens: number): void {
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || estimateTokens(content) > maxTokens) {
    throw new Error('作品意图或文风超出本轮完整读取预算，已拒绝截断。')
  }
}

export const WORK_AUTHORING_INTENT_PROVIDER_V1: ContextResourceProviderV1 = {
  version: 'context-resource-provider-v1', providerId: 'work-authoring-intent', providerVersion: PROVIDER_VERSION,
  normalizationVersion: PROVIDER_VERSION, kinds: ['reference'], fingerprint: canonScopeFingerprintV1,
  listMetadata: input => page(input), searchMetadata: input => page(input, input.query),
  read: async input => {
    const { descriptor, content } = await projection(input.scope)
    if (input.resourceKey !== descriptor.resourceKey) throw new Error('作品意图资源越界或已经失效。')
    // Freshness probes request descriptor metadata with a one-token index budget.
    // Omit index prose when it cannot fit; full and original reads remain exact.
    const text = input.depth === 'index' && estimateTokens(descriptor.shortSummary) > input.maxTokens
      ? '' : ['index', 'summary'].includes(input.depth) ? descriptor.shortSummary : content
    assertBudget(text, input.maxTokens)
    return { version: 1, descriptor, depth: input.depth, content: text, contentHash: await sha256Text(text), tokenCount: estimateTokens(text), sourceRefs: descriptor.sourceRefs }
  },
  readOriginal: async input => {
    const { work, descriptor } = await projection(input.scope)
    const ref = descriptor.sourceRefs.find(ref => ref.table === input.sourceRef.table && ref.recordId === input.sourceRef.recordId && ref.field === input.sourceRef.field)
    if (input.resourceKey !== descriptor.resourceKey || !ref || input.sourceRef.anchor
      || ref.revision !== input.sourceRef.revision || ref.contentHash !== input.sourceRef.contentHash) throw new Error('作品意图原文来源越界或已经失效。')
    const content = exact(work[ref.field as typeof FIELDS[number]])
    assertBudget(content, input.maxTokens)
    return { version: 1, descriptor, sourceRef: ref, content, contentHash: await sha256Text(content), tokenCount: estimateTokens(content) }
  },
}

/** Ordinary registered reads and resource reads use this same Work projection. */
export async function readWorkAuthoringIntentV1(scope: FrozenResourceScopeV1): Promise<string> {
  return (await projection(scope)).content
}
