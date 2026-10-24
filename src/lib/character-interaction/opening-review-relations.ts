import type {ChatNarrativeProductionSourceV1, ChatSituationCandidatesV1} from './narrative-production'
import {chatOpeningProofReviewPromptV1, chatOpeningProofReviewSchemaV1} from './opening-review-proof-citations'

export const CHAT_OPENING_REVIEW_RELATIONS_PRODUCER_V1 = 'chat-opening-review-v14'
const record = (value: unknown) => value as Record<string, unknown>
const object = (properties: Record<string, unknown>) => ({type: 'object', properties, required: Object.keys(properties), additionalProperties: false})
const choice = (values: string[]) => ({type: 'string', enum: [...new Set(values)]})

/** Select complete, structurally consistent proof pairs. This constrains only
 * existing identities and relations; no judgment or narrative is supplied. */
export function chatOpeningRelationalReviewSchemaV1(source: ChatNarrativeProductionSourceV1, candidates: ChatSituationCandidatesV1) {
  const schema = chatOpeningProofReviewSchemaV1(source, candidates)
  const body = record(schema.schema), definitions = record(body.$defs)
  const options = record(record(record(body.properties).options).properties)
  const shared = new Map<string, string>()
  const reuse = (value: unknown) => {
    const bytes = JSON.stringify(value)
    let name = shared.get(bytes)
    if (!name) {name = `r${shared.size + 1}`; shared.set(bytes, name); definitions[name] = value}
    return {$ref: `#/$defs/${name}`}
  }
  const noProof = reuse({type: 'null'})
  for (const candidate of candidates.options) {
    const properties = record(record(options[candidate.optionKey]).properties)
    const checks = reuse(properties.checks)
    const pair = (agency: unknown, development: unknown) => object({agency, development, checks})
    const branches = [pair(noProof, noProof)]
    const directions = candidate.situation.possibilities.map((direction, index) => ({direction, index,
      facts: candidate.situation.facts.filter(fact => direction.evidenceFactKeys.includes(fact.factKey) && fact.audienceKeys.includes(direction.actorKey)).map(fact => fact.factKey),
      goals: candidate.situation.goals.filter(goal => goal.actorKey === direction.actorKey).map(goal => goal.goalKey),
    })).filter(row => row.facts.length && row.goals.length)
    const scope = (row: typeof directions[number]) => ({possibilityIndex: reuse({type: 'integer', enum: [row.index]}),
      basisFactKeys: reuse({type: 'array', items: choice(row.facts), minItems: 1, maxItems: Math.min(3, row.facts.length)}),
    })
    for (const first of directions) for (const mode of ['act', 'wait']) {
      const agency = reuse(object({...record(record(properties.agency).properties), ...scope(first),
        actorKey: reuse(choice([first.direction.actorKey])), goalKey: reuse(choice(first.goals)), mode: reuse(choice([mode])),
      }))
      const development = directions.filter(next => next.direction.actorKey === first.direction.actorKey).map(next => {
        const different = next.index !== first.index && next.direction.text.trim() !== first.direction.text.trim()
        const modes = mode === 'wait' ? ['wait'] : ['direct', 'conversation', ...(different ? ['adaptive'] : [])]
        return reuse(object({...record(record(properties.development).properties), ...scope(next), mode: reuse(choice(modes))}))
      })
      branches.push(pair(agency, {anyOf: [noProof, ...development]}))
    }
    options[candidate.optionKey] = {anyOf: branches}
  }
  // Only definitions superseded by the joint schema are removed; the complete
  // registered source and all candidates are still delivered unchanged.
  const used = new Set<string>()
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    const reference = record(value).$ref
    if (typeof reference === 'string' && reference.startsWith('#/$defs/')) {
      const key = reference.slice('#/$defs/'.length)
      if (!used.has(key)) {used.add(key); visit(definitions[key])}
    }
    for (const child of Object.values(value)) visit(child)
  }
  visit(body.properties)
  for (const key of Object.keys(definitions)) if (!used.has(key)) delete definitions[key]
  return {...schema, name: 'chat_opening_review_relations_v1'}
}

export function chatOpeningRelationalReviewPromptV1(): string {
  return chatOpeningProofReviewPromptV1().replace(
    'viable-agency：按下述 agency 规则核验第一步，不把玩家协助当作唯一出路。',
    'viable-agency：先按 participants 核对执行者和对话对象，玩家能做的事不能算角色自主行动，角色无缘由向自己询问也不成立。再按 agency 规则核验第一步，不把玩家协助当作唯一出路。',
  ) + `\n顶层必须且只能是 {"options":{...}}；不要回显输入的 schema、version、buildNumber，也不要添加 summary。`
}
