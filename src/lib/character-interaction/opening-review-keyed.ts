import type {ChatRequestOptions} from '../ai/client'
import type {ChatNarrativeProductionSourceV1, ChatSituationCandidatesV1} from './narrative-production'
import {CHAT_OPENING_CHECKS} from './situation-production-review'
import {buildChatOpeningReviewReferencesV1, chatOpeningReviewReferencePromptV1, parseChatOpeningReferenceReviewV1} from './opening-review-references'

export const CHAT_OPENING_REVIEW_KEYED_PRODUCER_V1 = 'chat-opening-review-v12'

/** Fixed identities keep each candidate's citations and opportunities in its
 * own decoder scope. Cross-field meaning still belongs to the original gate. */
export function chatOpeningKeyedReviewSchemaV1(source: ChatNarrativeProductionSourceV1, candidates: ChatSituationCandidatesV1): NonNullable<ChatRequestOptions['jsonSchema']> {
  const references = buildChatOpeningReviewReferencesV1(source, candidates)
  const text = (maxLength: number) => ({type: 'string', minLength: 1, maxLength})
  const object = (properties: Record<string, unknown>) => ({type: 'object', properties, required: Object.keys(properties), additionalProperties: false})
  const array = (items: unknown, minItems: number, maxItems: number) => ({type: 'array', items, minItems, maxItems})
  const choice = (values: string[]) => ({type: 'string', enum: [...new Set(values)]})
  const actors = source.participants.map(row => row.participantKey)
  const definitions: Record<string, unknown> = {}
  const shared = new Map<string, string>()
  const reuse = (schema: unknown) => {
    const bytes = JSON.stringify(schema)
    let name = shared.get(bytes)
    if (!name) {name = `value${shared.size + 1}`; shared.set(bytes, name); definitions[name] = schema}
    return {$ref: `#/$defs/${name}`}
  }
  const options = Object.fromEntries(candidates.options.map((option, index) => {
    const facts = option.situation.facts.filter(fact => fact.audienceKeys.some(key => actors.includes(key))).map(fact => fact.factKey)
    const opportunity = {
      possibilityIndex: reuse({type: 'integer', minimum: 0, maximum: option.situation.possibilities.length - 1}),
      basisFactKeys: reuse(array(choice(facts), 1, 3)), expectedChange: reuse(text(600)), unresolved: reuse(text(600)),
    }
    const hasOpportunity = facts.length && option.situation.possibilities.length
    const agency = hasOpportunity ? {...object({
      actorKey: reuse(choice(actors)), goalKey: choice(option.situation.goals.map(goal => goal.goalKey)),
      mode: choice(['act', 'wait']), ...opportunity,
    }), type: ['object', 'null']} : {type: 'null'}
    const development = hasOpportunity ? reuse({...object({mode: choice(['direct', 'adaptive', 'conversation', 'wait']), ...opportunity}), type: ['object', 'null']}) : {type: 'null'}
    const checkName = `check${index + 1}`
    definitions[checkName] = object({passed: {type: 'boolean'}, reason: text(1000),
      evidence: array(object({refId: choice(references.filter(ref => ref.target === 'source' || ref.optionKey === option.optionKey).map(ref => ref.refId))}), 1, 4),
    })
    return [option.optionKey, object({agency, development,
      checks: object(Object.fromEntries(CHAT_OPENING_CHECKS.map(check => [check, {$ref: `#/$defs/${checkName}`}]))),
    })]
  }))
  return {name: 'chat_opening_review_keyed_v1', strict: true, schema: {...object({options: object(options)}), $defs: definitions}}
}

export function chatOpeningKeyedReviewPromptV1(): string {
  return chatOpeningReviewReferencePromptV1().replace(
    '输出 options 数组，每项包含 optionKey、agency、development、checks；每个候选和五项检查各出现一次。检查包含 check、passed、reason、evidence。',
    '输出 options 对象，属性名必须是每个候选的原 optionKey；每个候选包含 agency、development、checks。checks 也是对象，以五项检查名为属性名，每项包含 passed、reason、evidence。不要再次输出 optionKey 或 check 字段。每项 evidence 只选一至四条必要引用，候选只能选自己的 o 编号或共同来源的 s 编号；不同候选的目录不能混用。先核对该候选的首步和发展依据，再逐项作出判断。',
  ).replace('下附 JSON Schema 仅定义输出格式，须返回完整 JSON，不返回 Markdown 围栏、解释或额外字段。',
    'agency/development 的完整字段和规则见上文。checks 的每个值为 {"passed":true,"reason":"实际判断依据","evidence":[{"refId":"目录中的原样编号"}]}，passed 按实际判断填写布尔值。原生 JSON Schema 只约束格式；传输使用普通 JSON 时也须遵守上述完整字段与引用规则。返回完整 JSON，不返回 Markdown 围栏、解释或额外字段。')
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new Error('[chat-opening-keyed] 必须完整且仅包含当前候选和检查字段')
  }
  return value as Record<string, unknown>
}

/** Only removes redundant wire identities. It never edits evidence, fills a
 * judgment, changes a verdict, or repairs a failed agency/development proof. */
export function parseChatOpeningKeyedReviewV1(value: unknown, source: ChatNarrativeProductionSourceV1, candidates: ChatSituationCandidatesV1) {
  const body = exactObject(value, ['options'])
  const options = exactObject(body.options, candidates.options.map(option => option.optionKey))
  return parseChatOpeningReferenceReviewV1({options: candidates.options.map(({optionKey}) => {
    const option = exactObject(options[optionKey], ['agency', 'development', 'checks'])
    const checks = exactObject(option.checks, CHAT_OPENING_CHECKS)
    return {optionKey, agency: option.agency, development: option.development,
      checks: CHAT_OPENING_CHECKS.map(check => ({check, ...exactObject(checks[check], ['passed', 'reason', 'evidence'])})),
    }
  })}, source, candidates)
}
