import {canonicalStringify} from '../agent/run/hash'
import {isSha256Hash} from '../product-production/hash'
import type {ChatSourceReviewContextV1} from './source-review-context'
import {chatProjectionResourcesV1, parseChatSourceReviewV1, readPreparedChatSourceProjectionViewV1, type ChatSourceProjectionDraftV1, type ChatSourceReviewV1} from './source-projection'

export const CHAT_ROLE_TRAIT_LABELS = {
  identity: '身份理解', value: '价值观', goal: '长期期望（不是已完成的行动）',
  concern: '顾虑', boundary: '行为底线', voice: '语言与举止',
} as const
export interface ChatRoleProfileCandidateV1 {
  traits: Array<{kind: keyof typeof CHAT_ROLE_TRAIT_LABELS; text: string; evidence: Array<{fragmentKey: string; quote: string}>}>
}
/** Product-owned interpretation. Original world prose and permissions remain authoritative. */
export interface ChatRoleProfileV1 {
  actorKey: string
  projectionHash: string
  /** Includes every passage read by the generator, not merely the passages it cites. */
  sourceFragments: Array<{fragmentKey: string; sourceHash: string}>
  /** System-captured author decisions, never sent to the role-profile generator. */
  sourceReview: ChatSourceReviewV1
  candidate: ChatRoleProfileCandidateV1
}
export interface ChatRoleProfileSetV1 {
  schema: 'storyforge.chat-role-profiles'
  version: 1
  profiles: ChatRoleProfileV1[]
}
function fail(message: string): never {throw new Error(`角色整理无效：${message}`)}
function record(value: unknown, keys: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.split(',').sort().join(',')) fail('字段不在允许范围')
}
function text(value: unknown, max: number): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('文本为空或超过容量')
}

export function parseChatRoleProfileCandidateV1(value: unknown): ChatRoleProfileCandidateV1 {
  record(value, 'traits')
  if (!Array.isArray(value.traits) || !value.traits.length || value.traits.length > 12) fail('每位角色需要1至12项有来源的整理')
  let characters = 0
  const unique = new Set<string>()
  for (const trait of value.traits) {
    record(trait, 'kind,text,evidence')
    if (typeof trait.kind !== 'string' || !Object.prototype.hasOwnProperty.call(CHAT_ROLE_TRAIT_LABELS, trait.kind)) fail('人物整理类别无效')
    text(trait.text, 600); characters += trait.text.length
    const key = `${trait.kind}:${trait.text.trim()}`
    if (unique.has(key)) fail('人物整理重复')
    unique.add(key)
    if (!Array.isArray(trait.evidence) || !trait.evidence.length || trait.evidence.length > 4) fail('每项需要1至4条原文依据')
    const evidenceKeys = new Set<string>()
    for (const evidence of trait.evidence) {
      record(evidence, 'fragmentKey,quote'); text(evidence.fragmentKey, 1000); text(evidence.quote, 800)
      const evidenceKey = canonicalStringify(evidence)
      if (evidenceKeys.has(evidenceKey)) fail('原文依据重复')
      evidenceKeys.add(evidenceKey)
    }
  }
  if (characters > 3000) fail('人物整理正文合计最多3000字符，请压缩后再确认')
  return structuredClone(value) as unknown as ChatRoleProfileCandidateV1
}

export function validateChatRoleProfileEvidenceV1(candidate: ChatRoleProfileCandidateV1, context: ChatSourceReviewContextV1): void {
  if (!context.perspective || !context.cast.some(row => row.resourceKey === context.perspective!.actorKey && row.role === 'actor')) fail('须使用指定AI角色已知的资料')
  for (const trait of parseChatRoleProfileCandidateV1(candidate).traits) {
    let ownEvidence = false
    for (const evidence of trait.evidence) {
      const source = context.fragments.find(row => row.fragmentKey === evidence.fragmentKey)
      if (!source || !source.knownPurpose) fail('引用了本次角色未读取的资料')
      const decoded: unknown = JSON.parse(source.valueJson)
      if (!(typeof decoded === 'string' ? decoded : source.valueJson).includes(evidence.quote)) fail('引用必须来自对应原文的连续文字')
      if (source.resourceKey === context.perspective.actorKey) ownEvidence = true
    }
    if (!ownEvidence) fail('角色自身特征须有人物本人的原文依据，不能只据他人或背景推断')
  }
}

/** Preparation is inert: callers must obtain author confirmation and governed adoption. */
export function prepareChatRoleProfileV1(input: {candidate: unknown; context: ChatSourceReviewContextV1; sourceReview: ChatSourceReviewV1}): ChatRoleProfileV1 {
  input = structuredClone(input)
  const candidate = parseChatRoleProfileCandidateV1(input.candidate)
  validateChatRoleProfileEvidenceV1(candidate, input.context)
  const keys = new Set(input.context.fragments.map(row => row.fragmentKey))
  const review = parseChatSourceReviewV1(input.sourceReview)
  if (review.projectionHash !== input.context.projectionHash) fail('资料确认已变化')
  const sourceReview = {projectionHash: review.projectionHash, classifications: review.classifications.filter(row => keys.has(row.fragmentKey))}
  const actorKey = input.context.perspective!.actorKey
  if (sourceReview.classifications.length !== keys.size || sourceReview.classifications.some(row => row.visibility !== 'public' && !(row.visibility === 'participants' && row.audienceKeys.includes(actorKey))
    || row.purpose !== input.context.fragments.find(fragment => fragment.fragmentKey === row.fragmentKey)?.knownPurpose)) fail('所读资料不属于该角色的已确认知情范围')
  return {actorKey, projectionHash: input.context.projectionHash,
    sourceFragments: input.context.fragments.map(({fragmentKey, sourceHash}) => ({fragmentKey, sourceHash})), sourceReview, candidate}
}

export function parseChatRoleProfileSetV1(value: unknown): ChatRoleProfileSetV1 {
  record(value, 'schema,version,profiles')
  if (value.schema !== 'storyforge.chat-role-profiles' || value.version !== 1 || !Array.isArray(value.profiles) || value.profiles.length > 8) fail('人物整理版本或数量无效')
  const actors = new Set<string>()
  for (const profile of value.profiles) {
    record(profile, 'actorKey,projectionHash,sourceFragments,sourceReview,candidate')
    text(profile.actorKey, 500)
    if (actors.has(profile.actorKey) || !isSha256Hash(profile.projectionHash)) fail('角色或来源证据无效')
    actors.add(profile.actorKey)
    if (!Array.isArray(profile.sourceFragments) || !profile.sourceFragments.length || profile.sourceFragments.length > 12) fail('须保留本次全部输入片段')
    const keys = new Set<string>()
    for (const source of profile.sourceFragments) {
      record(source, 'fragmentKey,sourceHash'); text(source.fragmentKey, 1000)
      if (keys.has(source.fragmentKey) || !isSha256Hash(source.sourceHash)) fail('输入片段证据重复或无效')
      keys.add(source.fragmentKey)
    }
    const review = parseChatSourceReviewV1(profile.sourceReview)
    if (review.projectionHash !== profile.projectionHash || review.classifications.length !== keys.size || review.classifications.some(row => !keys.has(row.fragmentKey))) fail('资料确认与输入片段不一致')
    const candidate = parseChatRoleProfileCandidateV1(profile.candidate)
    if (candidate.traits.some(trait => trait.evidence.some(evidence => !keys.has(evidence.fragmentKey)))
      || review.classifications.some(row => row.visibility !== 'public' && !(row.visibility === 'participants' && row.audienceKeys.includes(profile.actorKey as string)))) fail('人物整理包含未获准的引用或知情范围')
  }
  return structuredClone(value) as unknown as ChatRoleProfileSetV1
}

/** Synchronous compiler gate: requires a freshly verified Gateway projection. */
export function validateChatRoleProfilesForSourceV1(value: unknown, draft: ChatSourceProjectionDraftV1, review: ChatSourceReviewV1): ChatRoleProfileSetV1 {
  const set = parseChatRoleProfileSetV1(value)
  for (const profile of set.profiles) {
    if (profile.projectionHash !== draft.projectionHash || !draft.characters.some(row => row.resourceKey === profile.actorKey)) fail('人物或来源已变化，请重新确认人物整理')
    const visible = readPreparedChatSourceProjectionViewV1({draft, review, viewerKey: profile.actorKey})
    const fragments = profile.sourceFragments.map(source => {
      const fragment = visible.find(row => row.fragmentKey === source.fragmentKey)
      const resource = fragment && chatProjectionResourcesV1(draft).find(row => row.resourceKey === fragment.resourceKey)
      const before = profile.sourceReview.classifications.find(row => row.fragmentKey === source.fragmentKey)
      const now = review.classifications.find(row => row.fragmentKey === source.fragmentKey)
      if (!fragment || !resource || source.sourceHash !== resource.sourceHash || canonicalStringify(before) !== canonicalStringify(now)) fail('人物整理的来源或知情范围已变化，请重新确认')
      return {...fragment, sourceHash: resource.sourceHash, resourceKind: 'resourceKind' in resource ? String(resource.resourceKind) : 'character', confirmedClassification: null, knownPurpose: fragment.purpose}
    })
    validateChatRoleProfileEvidenceV1(profile.candidate, {schema: 'storyforge.chat-source-review-context', version: 1, draftRevision: 0,
      projectionHash: draft.projectionHash, worldReferenceHash: draft.worldReferenceHash, worldReleaseHash: draft.worldReleaseHash,
      audience: 'author-only', perspective: {actorKey: profile.actorKey}, cast: [{resourceKey: profile.actorKey, role: 'actor'}], fragments})
  }
  return set
}

export function formatChatRoleProfileV1(profile: ChatRoleProfileV1): string {
  return `作者审定的原文解读（产品私域整理，不是世界新增事实；不表示目标已经实现）：\n${profile.candidate.traits.map(row => `${CHAT_ROLE_TRAIT_LABELS[row.kind]}：${row.text}`).join('\n')}`
}

/** Keep complete source passages in the knowledge projection when voice text exceeds its budget. */
export function composeChatRoleVoiceRulesV1(sourceVoice: string, authorVoice: string, interpretation = ''): string {
  const instruction = '遵守已确认的身份、知识和动机；动机是意愿，不代表行动已经完成。不替玩家决定行动。'
  const interpreted = interpretation ? `\n${interpretation}` : ''
  const authored = `\n作者补充：${authorVoice}`
  const full = `${instruction}${sourceVoice}${interpreted}${authored}`
  if (full.length <= 8000) return full
  const bounded = `${instruction}完整语言样本保存在本角色获准读取的来源知识中，按各片段演绎。${interpreted}${authored}`
  if (bounded.length > 8000) fail('人物整理与作者口吻补充合计过长，请精简后重新制作')
  return bounded
}
