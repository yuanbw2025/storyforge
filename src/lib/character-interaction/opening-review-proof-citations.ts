import type {ChatNarrativeProductionSourceV1, ChatSituationCandidatesV1} from './narrative-production'
import {chatOpeningKeyedReviewPromptV1, chatOpeningKeyedReviewSchemaV1, parseChatOpeningKeyedReviewV1} from './opening-review-keyed'
import {buildChatOpeningReviewReferencesV1} from './opening-review-references'
import {parseChatOpeningAgencyV2} from './opening-agency'
import {parseChatOpeningDevelopmentV3} from './opening-development'

export const CHAT_OPENING_REVIEW_PROOF_PRODUCER_V1 = 'chat-opening-review-v13'
const proofChecks = {'viable-agency': 'agency', 'open-development': 'development'} as const
function fail(message: string): never {throw new Error(`[chat-opening-proof-citation] ${message}`)}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('需要完整对象')
  return value as Record<string, unknown>
}
const object = (properties: Record<string, unknown>) => ({type: 'object', properties, required: Object.keys(properties), additionalProperties: false})
const choice = (values: string[]) => ({type: 'string', enum: [...new Set(values)]})

/** This is a new wire contract. The frozen v12 schema remains byte-for-byte
 * available; shared old definitions are cloned before candidate-local edits. */
export function chatOpeningProofReviewSchemaV1(source: ChatNarrativeProductionSourceV1, candidates: ChatSituationCandidatesV1) {
  const schema = chatOpeningKeyedReviewSchemaV1(source, candidates)
  const body = record(schema.schema), definitions = record(body.$defs)
  const options = record(record(record(body.properties).options).properties)
  for (const [index, option] of candidates.options.entries()) {
    const properties = record(record(options[option.optionKey]).properties)
    const directions = option.situation.possibilities.map((direction, possibilityIndex) => ({direction, possibilityIndex,
      facts: option.situation.facts.filter(fact => direction.evidenceFactKeys.includes(fact.factKey) && fact.audienceKeys.includes(direction.actorKey)),
    })).filter(row => row.facts.length && option.situation.goals.some(goal => goal.actorKey === row.direction.actorKey))
    const facts = [...new Set(directions.flatMap(row => row.facts.map(fact => fact.factKey)))]
    if (!directions.length) {properties.agency = {type: 'null'}; properties.development = {type: 'null'}}
    else {
      const opportunity = {
        possibilityIndex: {type: 'integer', enum: directions.map(row => row.possibilityIndex)},
        basisFactKeys: {type: 'array', items: choice(facts), minItems: 1, maxItems: Math.min(3, facts.length)},
      }
      const agency = record(properties.agency)
      const actors = directions.map(row => row.direction.actorKey)
      properties.agency = {...agency, properties: {...record(agency.properties), ...opportunity,
        actorKey: choice(actors), goalKey: choice(option.situation.goals.filter(goal => actors.includes(goal.actorKey)).map(goal => goal.goalKey)),
      }}
      const development = record(properties.development)
      const resolved = structuredClone(development.$ref ? record(definitions[String(development.$ref).slice('#/$defs/'.length)]) : development)
      const modes = new Set(directions.map(row => row.direction.text.trim())).size > 1
        ? ['direct', 'adaptive', 'conversation', 'wait'] : ['direct', 'conversation', 'wait']
      properties.development = {...resolved, properties: {...record(resolved.properties), ...opportunity, mode: choice(modes)}}
    }
    const check = record(definitions[`check${index + 1}`]), checkProperties = record(check.properties)
    const referencesName = `references${index + 1}`, references = {$ref: `#/$defs/${referencesName}`}
    definitions[referencesName] = checkProperties.evidence
    checkProperties.evidence = references
    const checks = record(record(properties.checks).properties)
    for (const [checkKey, proof] of Object.entries(proofChecks)) checks[checkKey] = {
      ...check, properties: {...checkProperties, evidence: {anyOf: [object({proof: choice([proof])}), object({refs: references})]}},
    }
  }
  // Candidate-local constraints supersede several v12 shared definitions.
  // Remove only unreachable schema nodes, never source/candidate content.
  const used = new Set<string>()
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    const reference = (value as Record<string, unknown>).$ref
    if (typeof reference === 'string' && reference.startsWith('#/$defs/')) {
      const key = reference.slice('#/$defs/'.length)
      if (!used.has(key)) {used.add(key); visit(definitions[key])}
    }
    for (const child of Object.values(value)) visit(child)
  }
  visit(body.properties)
  for (const key of Object.keys(definitions)) if (!used.has(key)) delete definitions[key]
  return {...schema, name: 'chat_opening_review_proof_citations_v1'}
}

export function chatOpeningProofReviewPromptV1(): string {
  const semantics = chatOpeningKeyedReviewPromptV1().split('\n输出 options 对象')[0]
  return semantics + `\n本版输出 options 对象，以各候选原 optionKey 为键；值包含 agency、development、checks，两个证明的字段及含义见上文。checks 以五项检查名为键，值包含布尔 passed、具体 reason 和 evidence；不得另填 optionKey/check/hash/version。
seed-purpose、role-motivation、knowledge-and-player-boundaries 的 evidence 为 [{"refId":"目录编号"}]，选一至四条实际依据，只能引用共同来源或本候选。完整原文在 artifacts；references 的 pointer/start/end 定位 UTF-16 原文摘录，目录不提供判断或新增事实。
viable-agency.evidence 可选 {"proof":"agency"}，open-development.evidence 可选 {"proof":"development"}，明确引用已填写的证明。系统先验证角色、目标、方向、知情及发展关系，再定位对应方向和各 basisFact 的首个有内容的有界原文摘录；不修正证明、不改变结论。basisFactKeys 须属于该方向的 evidenceFactKeys 且该角色已知，其它相关背景不能冒充已声明依据。
证明为 null 时，相应检查不通过，evidence 必须用 {"refs":[{"refId":"支持拒绝的原文编号"}]}。也可明确用 refs 引用非 null 证明，但须覆盖方向及全部依据事实；漏项不补齐。两种形状不可混用。不可为结构合规改判、补背景或改来源。原生 Schema 只约束格式；普通 JSON 传输同样遵守上述完整字段。只返回完整 JSON，无围栏、解释或额外字段。`
}

/** Explicit proof citation is an identity reference, never automatic repair of
 * an omitted/invalid citation. Every proof is validated before any expansion. */
export function parseChatOpeningProofReviewV1(value: unknown, source: ChatNarrativeProductionSourceV1, candidates: ChatSituationCandidatesV1) {
  const body = record(structuredClone(value)), options = record(body.options)
  const references = buildChatOpeningReviewReferencesV1(source, candidates)
  for (const candidate of candidates.options) {
    const option = record(options[candidate.optionKey]), checks = record(option.checks)
    for (const [checkKey, proofKey] of Object.entries(proofChecks)) {
      const check = record(checks[checkKey]), evidence = record(check.evidence)
      if (Object.keys(evidence).join(',') === 'refs') {check.evidence = evidence.refs; continue}
      if (Object.keys(evidence).join(',') !== 'proof' || evidence.proof !== proofKey) fail('必须明确引用本项证明或原文目录，不能补齐缺失证据')
      const agency = parseChatOpeningAgencyV2(option.agency, candidate)
      const proof = proofKey === 'agency' ? agency : parseChatOpeningDevelopmentV3(option.development, candidate, agency)
      const pointers = [`/situation/possibilities/${proof.possibilityIndex}/text`,
        ...proof.basisFactKeys.map(key => `/situation/facts/${candidate.situation.facts.findIndex(fact => fact.factKey === key)}/text`)]
      check.evidence = pointers.map(pointer => {
        const reference = references.find(ref => ref.optionKey === candidate.optionKey && ref.pointer === pointer)
        if (!reference) fail('证明未绑定已交付的完整原文目录')
        return {refId: reference.refId}
      })
    }
  }
  return parseChatOpeningKeyedReviewV1(body, source, candidates)
}
