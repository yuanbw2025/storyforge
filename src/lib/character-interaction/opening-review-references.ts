import type {AssembleContextInput} from '../registry/types'
import {readProductProductionArtifactInputs} from '../product-production/context'
import {canonicalProductProductionJsonV2, hashProductProductionValueV2} from '../product-production/hash'
import type {ProductProductionTaskExecutionInputV1} from '../product-production/scheduler'
import {chatOpeningCitationPathsV1, chatOpeningReviewOutputSchemaV3} from './opening-review-output'
import {chatOpeningBackgroundReviewPromptV3} from './opening-continuation'
import {parseChatOpeningReviewDraftV1, type ChatOpeningReviewDraftV1} from './situation-production-review'
import {parseChatSituationCandidatesV1, validateChatNarrativeProductionSourceV1, type ChatNarrativeProductionSourceV1, type ChatSituationCandidatesV1} from './narrative-production'

export const CHAT_OPENING_REVIEW_REFERENCES_SOURCE_V1 = 'product-production.chat-opening-review-inputs'
export const CHAT_OPENING_REVIEW_REFERENCES_PRODUCER_V1 = 'chat-opening-review-v11'
interface Reference {
  refId: string
  target: 'source' | 'option'
  optionKey: string | null
  pointer: string
  quote: string
  start: number
  end: number
}
interface InputArtifact {artifactKey: string; contentHash: string; payload: unknown}
interface ReviewInput {
  schema: 'storyforge.chat-opening-review-inputs'
  version: 1
  buildNumber: number
  artifacts: InputArtifact[]
  references: Omit<Reference, 'quote'>[]
}
function fail(message: string): never {throw new Error(`[chat-opening-references] ${message}`)}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('需要完整对象')
  return value as Record<string, unknown>
}
function sourceText(root: unknown, pointer: string): string {
  let value = root
  for (const token of pointer.slice(1).split('/')) {
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~')
    if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) fail('引用不属于原文')
    value = (value as Record<string, unknown>)[key]
  }
  if (typeof value !== 'string') fail('引用未指向原文')
  return value
}

/** Derived only from the complete frozen source and candidates. Long strings
 * become exact bounded excerpts, never summaries or silent source truncation. */
export function buildChatOpeningReviewReferencesV1(source: ChatNarrativeProductionSourceV1, candidates: ChatSituationCandidatesV1): Reference[] {
  const paths = chatOpeningCitationPathsV1(source, candidates), references: Reference[] = [], counts = new Map<string, number>()
  const append = (root: unknown, pointer: string, target: Reference['target'], optionKey: string | null, prefix: string) => {
    const text = sourceText(root, pointer)
    let offset = 0
    while (offset < text.length) {
      let end = Math.min(text.length, offset + 800)
      // Keep a surrogate pair intact while respecting the original UTF-16 cap.
      if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1])) end--
      const quote = text.slice(offset, end)
      if (quote.trim()) {
        const next = (counts.get(prefix) ?? 0) + 1
        counts.set(prefix, next)
        references.push({refId: `${prefix}.${String(next).padStart(3, '0')}`, target, optionKey, pointer, quote, start: offset, end})
      }
      offset = end
    }
  }
  for (const pointer of paths.source.sort()) append(source, pointer, 'source', null, 's')
  for (const [index, option] of candidates.options.entries()) {
    for (const pointer of paths.options[index].paths.sort()) append(option, pointer, 'option', option.optionKey, `o${index + 1}`)
  }
  return references
}

/** A compact wire reference replaces three model-authored citation fields.
 * Agency, development, five judgments and their original validators remain. */
export function chatOpeningReviewReferenceSchemaV1(source: ChatNarrativeProductionSourceV1, candidates: ChatSituationCandidatesV1) {
  const references = buildChatOpeningReviewReferencesV1(source, candidates)
  const schema = chatOpeningReviewOutputSchemaV3(source, candidates)
  const body = schema.schema as {properties: {options: {items: {properties: {checks: {items: {properties: {evidence: {items: unknown}}}}}}}}}
  body.properties.options.items.properties.checks.items.properties.evidence.items = {
    type: 'object', properties: {refId: {type: 'string', enum: references.map(ref => ref.refId)}}, required: ['refId'], additionalProperties: false,
  }
  return {...schema, name: 'chat_opening_review_references_v1'}
}

function referenceIndex(references: Reference[]): Omit<Reference, 'quote'>[] {
  return references.map(({refId, target, optionKey, pointer, start, end}) => ({refId, target, optionKey, pointer, start, end}))
}

export function chatOpeningReviewReferencePromptV1(): string {
  const semantics = chatOpeningBackgroundReviewPromptV3().split('\n按给定 JSON Schema')[0]
    .replace('使用准确 JSON Pointer 与连续原文摘录', '使用 references 中对应方向及每项事实的 refId')
  return semantics + `\n输出 options 数组，每项包含 optionKey、agency、development、checks；每个候选和五项检查各出现一次。检查包含 check、passed、reason、evidence。
evidence 每项只填写 {"refId":"references 中的原样编号"}。目录由系统从完整来源和当前候选生成，pointer 与 start/end 标明原文路径及 UTF-16 摘录范围；完整原文仍在 artifacts 中；不可自行填写 target、pointer、quote 或编造编号，不能引用其它候选。目录不提供判断，不新增事实或权限；只选择实际支持本项判断的引用。系统还原原文后仍执行原有角色、知情、首步和发展依据检查。
viable-agency/open-development 的 evidence 须分别选中其 direction 和每项 basisFact 的引用。adaptive 必须使用不同于 agency 的已有方向；同一方向换措辞不算另一个办法。不要为避免结构错误改判语义；依据不成立时保留 null 和不通过。不得替候选补写背景或改变来源。
下附 JSON Schema 仅定义输出格式，须返回完整 JSON，不返回 Markdown 围栏、解释或额外字段。`
}

export function parseChatOpeningReferenceReviewV1(value: unknown, source: ChatNarrativeProductionSourceV1, candidates: ChatSituationCandidatesV1): ChatOpeningReviewDraftV1 {
  const body = record(structuredClone(value))
  if (!Array.isArray(body.options) || body.options.length !== candidates.options.length) fail('需要逐项审查当前候选')
  const references = new Map(buildChatOpeningReviewReferencesV1(source, candidates).map(ref => [ref.refId, ref]))
  for (const optionValue of body.options) {
    const option = record(optionValue)
    if (!Array.isArray(option.checks) || option.checks.length !== 5) fail('需要五项完整审查')
    for (const checkValue of option.checks) {
      const check = record(checkValue)
      if (!Array.isArray(check.evidence) || check.evidence.length < 1 || check.evidence.length > 4) fail('每项需要一至四条引用')
      check.evidence = check.evidence.map(value => {
        const ref = record(value)
        if (Object.keys(ref).join(',') !== 'refId' || typeof ref.refId !== 'string') fail('引用只能选择已有编号')
        const original = references.get(ref.refId)
        if (!original || original.target === 'option' && original.optionKey !== option.optionKey) fail('引用不属于当前来源或候选')
        return {target: original.target, pointer: original.pointer, quote: original.quote}
      })
    }
  }
  return parseChatOpeningReviewDraftV1(body, source, candidates, 3)
}

/** Registered source reader, sharing the existing Work/Build/accepted-artifact
 * boundary. No data is collected ad hoc by the executor or prompt. */
export async function readChatOpeningReviewReferenceContextV1(input: AssembleContextInput): Promise<string> {
  if (input.productProductionTaskKey !== 'content.chat-opening-review'
    || [...input.productArtifactKeys ?? []].sort().join(',') !== 'content.chat-candidates,design.game') fail('读取不属于开场审查任务')
  const packet = JSON.parse(await readProductProductionArtifactInputs(input)) as {buildNumber: number; artifacts: InputArtifact[]}
  const sourceArtifact = packet.artifacts.find(row => row.artifactKey === 'design.game')!
  const candidateArtifact = packet.artifacts.find(row => row.artifactKey === 'content.chat-candidates')!
  if (!sourceArtifact || !candidateArtifact) fail('来源或候选缺失')
  const source = sourceArtifact.payload as ChatNarrativeProductionSourceV1
  validateChatNarrativeProductionSourceV1(source)
  const candidates = parseChatSituationCandidatesV1(candidateArtifact.payload, source)
  for (const row of packet.artifacts) if (await hashProductProductionValueV2(row.payload) !== row.contentHash) fail('来源或候选内容与冻结 hash 不一致')
  const result: ReviewInput = {schema: 'storyforge.chat-opening-review-inputs', version: 1, buildNumber: packet.buildNumber,
    artifacts: packet.artifacts, references: referenceIndex(buildChatOpeningReviewReferencesV1(source, candidates))}
  return JSON.stringify(result)
}

/** The same derived catalog must have reached the actual registered input;
 * recompiling from newer DB data cannot repair a stale/missing disclosure. */
export function assertChatOpeningReviewReferencesDeliveredV1(input: ProductProductionTaskExecutionInputV1, source: ChatNarrativeProductionSourceV1, candidates: ChatSituationCandidatesV1): void {
  const packets = input.contextText.split(/\n\s*\n/g).flatMap(segment => {
    try {const row = JSON.parse(segment); return row?.schema === 'storyforge.chat-opening-review-inputs' ? [row as ReviewInput] : []} catch {return []}
  })
  if (packets.length !== 1) fail('缺少本次实际交付的唯一引用目录')
  const packet = packets[0]
  if (packet.version !== 1 || packet.buildNumber !== input.buildNumber
    || canonicalProductProductionJsonV2(packet.references) !== canonicalProductProductionJsonV2(referenceIndex(buildChatOpeningReviewReferencesV1(source, candidates)))
    || canonicalProductProductionJsonV2(packet.artifacts.find(row => row.artifactKey === 'design.game')?.payload) !== canonicalProductProductionJsonV2(source)
    || canonicalProductProductionJsonV2(packet.artifacts.find(row => row.artifactKey === 'content.chat-candidates')?.payload) !== canonicalProductProductionJsonV2(candidates)) fail('实际交付与冻结来源或候选不一致')
}
