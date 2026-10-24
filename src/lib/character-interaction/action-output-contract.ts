import type {ChatRequestOptions} from '../ai/client'
import type {AIProvider} from '../types/ai'
import {supportsChatChoiceContinuationV1} from './action-choice-continuation'
import {CHAT_THREAD_STATUSES_V1} from '../types/chat-narrative'
import {supportsChatInquirySettlementV1} from './inquiry-settlement'
import {requiresChatReviewedDisclosureV1} from './natural-disclosure-output'
import {CHAT_OWN_EVIDENCE_ARRAYS_V1, CHAT_OWN_EVIDENCE_OBJECTS_V1, supportsChatOwnEvidenceBindingV1} from './action-evidence-binding'
import {CHAT_ACTION_EXPRESSION_MODES_V1, supportsChatActionWireV1} from './action-wire'
import {chatNarrativeOutcomeSchemaV1, supportsChatControlHandoffV1} from './control-handoff-wire'
import {CHAT_TURN_COMPLETION_ACTION_RULE_V1, supportsChatTurnCompletionV1} from './turn-completion'

type Schema = Record<string, unknown>
const string: Schema = {type: 'string'}
const number: Schema = {type: 'number'}
const integer: Schema = {type: 'integer'}
const boolean: Schema = {type: 'boolean'}
const enumeration = (...values: readonly string[]): Schema => ({type: 'string', enum: values})
const array = (items: Schema): Schema => ({type: 'array', items})
const object = (properties: Record<string, Schema>): Schema => ({type: 'object', properties, required: Object.keys(properties), additionalProperties: false})
const either = (...anyOf: Schema[]): Schema => ({anyOf})
const nullable = (schema: Schema): Schema => either(schema, {type: 'null'})
const strings = array(string)
const playerRequest = {playerEventSequence: integer, playerExcerpt: string}
const goal = object({goalKey: string, desire: string, concern: string, boundary: string, evidenceFactKeys: strings})
const goalStatus = enumeration('active', 'paused', 'fulfilled', 'abandoned')
const disclosure = {factKey: string, toParticipantKeys: strings, evidenceExcerpt: string}
const situation = {threadKey: string, direction: string, evidenceFactKeys: strings, evidenceExcerpt: string}
const threadFollowup = {threadKey: string, evidenceExcerpt: string, goal}

/** Transport shape only. Runtime parsing, scope/visibility checks and semantic
 * review remain authoritative. Nullable fields are explicit in new outputs;
 * historical candidates are neither filled in nor rewritten. */
export function chatActionOutputSchemaV1(): Schema {
  return structuredClone(object({
    kind: enumeration('speak', 'attempt', 'complete', 'pause'), text: string,
    goalKey: nullable(string), evidenceFactKeys: strings, audienceKeys: strings, waitingForPlayer: boolean,
    newFacts: array(object({factKey: string, kind: enumeration('observation', 'object', 'place', 'temporary-character'), text: string, evidenceFactKeys: strings, evidenceExcerpt: string})),
    disclosures: array(either(object(disclosure), object({...disclosure, wording: enumeration('equivalent')}))),
    threadUpdates: array(object({threadKey: string, status: enumeration(...CHAT_THREAD_STATUSES_V1), evidenceExcerpt: string})),
    goalStatus: nullable(goalStatus),
    goalUpdates: array(object({goalKey: string, status: goalStatus, evidenceFactKeys: strings, evidenceExcerpt: string})),
    commitmentEffects: array(either(object({kind: enumeration('promise'), terms: string, evidenceExcerpt: string}), object({kind: enumeration('fulfill', 'withdraw'), commitmentKey: string, evidenceExcerpt: string}))),
    relationshipUpdates: array(object({dimensionKey: string, delta: number, sourceEventSequence: integer, playerExcerpt: string, evidenceExcerpt: string})),
    nextPossibilities: nullable(array(object({text: string, evidenceFactKeys: strings}))),
    beliefUpdates: array(object({beliefKey: string, text: nullable(string), evidenceFactKeys: strings})),
    situationRequest: nullable(either(object(situation), object({...situation, purpose: enumeration('observation-result')}), object({...situation, threadKey: {type: 'null'}, purpose: enumeration('player-followup'), ...playerRequest}))),
    followupGoal: nullable(object({...playerRequest, evidenceExcerpt: string, goal, thread: object({threadKey: string, title: string, question: string, evidenceFactKeys: strings, closureSignals: strings})})),
    threadFollowupGoal: nullable(either(object(threadFollowup), object({...threadFollowup, pauseRequest: object(playerRequest)}))),
    resumeGoal: nullable(object(playerRequest)), promiseRequest: nullable(object(playerRequest)),
    pauseGoal: nullable(object({...playerRequest, threadKey: string, evidenceExcerpt: string})),
    sceneTransition: nullable(object({...playerRequest, destinationFactKey: string, destinationExcerpt: string, arrivalFactKey: string, evidenceExcerpt: string})),
  }))
}

export function supportsChatActionOutputContractV1(version: string | undefined): boolean {
  return supportsChatOwnEvidenceBindingV1(version) || ['chat-narrative-action-v38', 'chat-narrative-options-v28', 'chat-action-revision-v17', 'chat-narrative-action-v39', 'chat-narrative-options-v29', 'chat-action-revision-v18'].includes(version ?? '')
}

function usesChangeDescriptions(version: string | undefined): boolean {
  return supportsChatOwnEvidenceBindingV1(version) || ['chat-narrative-action-v39', 'chat-narrative-options-v29', 'chat-action-revision-v18'].includes(version ?? '')
}

/** Explain change fields at the output boundary, where providers read them.
 * The domain preview still rejects no-op or unsupported transitions. */
function chatActionOutputSchemaV2(): Schema {
  const schema = chatActionOutputSchemaV1(), properties = schema.properties as Record<string, Schema>
  properties.goalStatus.description = '本轮对 goalKey 原目标实际执行的状态变更，不是当前状态摘要。目标原本 active 且继续保持 active 时必须填 null；原状态没有改变时一律 null。不能为了填写字段重复原状态。'
  properties.goalUpdates.description = '只登记其他自身原目标的实际状态变更；保持原状态的目标不列入。没有其他目标变化时填 []。'
  properties.threadUpdates.description = '只登记本轮实际改变的原事项状态。原事项 open 且仍在调查时不重复填写 open；没有变化时填 []。暂停自己的目标不自动暂停共同事项，共同暂停仍须按真实范围登记。'
  properties.kind.description = '按正文已经发生的行为选择：speak 只说话；attempt 是当前行动需要玩家选择、许可或参与；complete 是自己已完成有依据的动作；pause 是停止或暂缓自身行动。打算或准备不是完成，自己的实际动作不能因结果未明就写成等待玩家的 attempt。'
  properties.waitingForPlayer.description = '当前下一步是否确实需要玩家决定。角色自己已经选择且不需玩家参与的办法为 false，不把等待环境结果当作玩家决定；接受或维持玩家暂停时，按 pauseGoal/playerPause 合同保留 true，只有真实恢复授权才能解除。'
  return schema
}

function chatActionOutputSchemaV3(): Schema {
  const schema = chatActionOutputSchemaV2(), properties = schema.properties as Record<string, Schema>
  const allowBinding = (node: Schema) => {
    if (Array.isArray(node.anyOf)) node.anyOf.forEach(branch => allowBinding(branch as Schema))
    const fields = node.properties as Record<string, Schema> | undefined
    if (fields?.evidenceExcerpt) fields.evidenceExcerpt = {...nullable(string), description: '引用本次完整 text 时填 null，由系统逐字绑定；正文超过该摘录字段上限时填连续逐字片段，不可省略或改写。仅绑定当前表达，不证明后果成立。'}
  }
  for (const key of CHAT_OWN_EVIDENCE_ARRAYS_V1) allowBinding(properties[key].items as Schema)
  for (const key of CHAT_OWN_EVIDENCE_OBJECTS_V1) allowBinding(properties[key])
  return schema
}

const CHAT_TURN_COMPLETION_OUTPUT_RULE_V1 = '先区分目标变化与本轮结束：本次完成、暂停、放弃或新建目标（包括 threadFollowupGoal）时，turnCompletion 必须为 null。只有继续保留行动前已有的自身 active 目标、goalStatus=null、goalUpdates=[]，且没有新目标、暂停/恢复、情境请求或转场时，才可按原规则填写 turnCompletion；表达方式仅限 speech 或 self-action-performed。不要为使用结束标记而撤销实际目标变化，也不要为了填新目标而虚构后续任务。目标或事项已达到原关闭条件时，如实记录该结果，无需穷尽所有未知。'

/** The union constrains only combinations the domain already rejects. Shared
 * property definitions avoid duplicating the entire request and its budget.
 * State-dependent eligibility and independent review remain authoritative. */
function chatCompletionActionSchemaV1(action: Schema): {action: Schema; definitions: Record<string, Schema>} {
  const original = action.properties as Record<string, Schema>, definitions: Record<string, Schema> = {}
  const shared = Object.fromEntries(Object.entries(original).map(([key, value]) => {
    if (key === 'turnCompletion' || JSON.stringify(value).length < 100) return [key, value]
    definitions[key] = value
    return [key, {$ref: `#/$defs/${key}`}]
  }))
  const completion = (original.turnCompletion.anyOf as Schema[])[0]
  return {
    action: either(
      object({...shared, turnCompletion: {type: 'null'}}),
      object({...shared, goalKey: string, goalStatus: {type: 'null'}, goalUpdates: {...original.goalUpdates, maxItems: 0},
        followupGoal: {type: 'null'}, threadFollowupGoal: {type: 'null'}, pauseGoal: {type: 'null'}, resumeGoal: {type: 'null'},
        situationRequest: {type: 'null'}, sceneTransition: {type: 'null'}, expressionMode: enumeration('speech', 'self-action-performed'), turnCompletion: completion}),
    ),
    definitions,
  }
}

/** V60 factors identical explicit current-expression evidence instructions.
 * Only exact schema equality permits a reference: historical/player/source
 * quotations retain their different schemas, and no request text is trimmed. */
function compactChatCompletionSchemaV1(schema: Schema): Schema {
  const compact = structuredClone(schema)
  const original = (chatActionOutputSchemaV3().properties as Record<string, Schema>).newFacts.items as Schema
  const excerpt = (original.properties as Record<string, Schema>).evidenceExcerpt
  const exact = JSON.stringify(excerpt)
  const visit = (node: Schema) => {
    const fields = node.properties as Record<string, Schema> | undefined
    if (fields) for (const [key, child] of Object.entries(fields)) {
      if (key === 'evidenceExcerpt' && JSON.stringify(child) === exact) fields[key] = {$ref: '#/$defs/ownEvidenceExcerpt'}
      else visit(child)
    }
    if (node.items) visit(node.items as Schema)
    if (Array.isArray(node.anyOf)) node.anyOf.forEach(child => visit(child as Schema))
    if (node.$defs) Object.values(node.$defs as Record<string, Schema>).forEach(visit)
  }
  visit(compact)
  ;(compact.$defs as Record<string, Schema>).ownEvidenceExcerpt = excerpt
  return compact
}

/** V67 shares only byte-identical schema subtrees. Expanded validation, field
 * descriptions and quote requirements stay unchanged; old versions keep bytes.
 * Each replacement must reduce the complete schema including its definition. */
function compactChatRepeatedSchemasV2(schema: Schema): Schema {
  let compact = structuredClone(schema)
  const definitions = compact.$defs as Record<string, Schema>
  const candidates: Array<[string, Schema]> = [
    ['goal', goal], ['playerRequest', object(playerRequest)],
    ['controlSource', object({messageId: string, sequence: integer, excerpt: string})],
    ['goalUpdate', (definitions.goalUpdates as Schema).items as Schema],
    ['stringList', strings], ['goalState', goalStatus],
  ]
  for (const [name, target] of candidates) {
    const next = structuredClone(compact), exact = JSON.stringify(target)
    const defs = next.$defs as Record<string, Schema>
    if (Object.prototype.hasOwnProperty.call(defs, name)) throw new Error('[chat-output] 重复的输出结构定义')
    let references = 0
    const replace = (node: Schema): Schema => {
      if (JSON.stringify(node) === exact) {references += 1; return {$ref: `#/$defs/${name}`}}
      const fields = node.properties as Record<string, Schema> | undefined
      if (fields) for (const [key, child] of Object.entries(fields)) fields[key] = replace(child)
      if (node.items) node.items = replace(node.items as Schema)
      if (Array.isArray(node.anyOf)) node.anyOf = node.anyOf.map(child => replace(child as Schema))
      if (node.$defs) for (const [key, child] of Object.entries(node.$defs as Record<string, Schema>))
        (node.$defs as Record<string, Schema>)[key] = replace(child)
      return node
    }
    replace(next)
    if (references < 2) continue
    defs[name] = structuredClone(target)
    if (JSON.stringify(next).length < JSON.stringify(compact).length) compact = next
  }
  return compact
}

/** Both transports have verified schema support. Other providers retain their
 * existing request contract; a rejected schema request is never auto-retried. */
export function chatActionRequestOptionsV1(version: string | undefined, provider: AIProvider | undefined, silentWait = false): ChatRequestOptions | undefined {
  if (silentWait && supportsChatChoiceContinuationV1(version) && ['codex', 'agnes'].includes(provider ?? '')) {
    return {jsonSchema: {name: 'chat_wait_outcome_v1', strict: true, schema: chatNarrativeOutcomeSchemaV1({}, version, true)}}
  }
  if (!supportsChatActionOutputContractV1(version) || !['codex', 'agnes'].includes(provider ?? '')) return undefined
  const ownEvidence = supportsChatOwnEvidenceBindingV1(version)
  const action = ownEvidence ? chatActionOutputSchemaV3() : usesChangeDescriptions(version) ? chatActionOutputSchemaV2() : chatActionOutputSchemaV1()
  if (supportsChatTurnCompletionV1(version)) {
    const properties = action.properties as Record<string, Schema>
    properties.turnCompletion = nullable(object({version: {type: 'integer', enum: [1]}, purpose: string, evidenceExcerpt: string}))
    properties.turnCompletion.description = CHAT_TURN_COMPLETION_ACTION_RULE_V1
    action.required = Object.keys(properties)
  }
  if (supportsChatInquirySettlementV1(version)) {
    const properties = action.properties as Record<string, Schema>
    const branch = object({...situation, purpose: enumeration('inquiry-result'), respondentFactKey: string, respondentExcerpt: string, respondentName: string})
    properties.situationRequest = either(properties.situationRequest, branch)
  }
  if (requiresChatReviewedDisclosureV1(version)) {
    const properties = action.properties as Record<string, Schema>
    const choices = (properties.disclosures.items as Schema).anyOf as Schema[]
    const reviewed = choices.find(choice => (choice.properties as Record<string, Schema>).wording)
    if (!reviewed) throw new Error('[chat-output] 缺少既有等义披露结构')
    properties.disclosures = {...properties.disclosures, items: reviewed}
  }
  const wire = supportsChatActionWireV1(version)
  if (wire) {
    const properties = action.properties as Record<string, Schema>
    delete properties.kind; delete properties.waitingForPlayer
    properties.expressionMode = {...enumeration(...Object.keys(CHAT_ACTION_EXPRESSION_MODES_V1)), description: '一次选择表达方式及是否依赖玩家决定，系统映射为 kind/waitingForPlayer。self-action-performed 是本次已做的自身动作，不代表所有调查已成功；结果仍须有依据。player-dependent-attempt 只用于真正需要玩家许可或参与的下一步。'}
    properties.audienceKeys = {...nullable({...array(string), minItems: 2, maxItems: 33}), description: 'null 表示使用提示中冻结的本轮对话听众；有意缩小时显式列出玩家、行动者及实际听众。不能填空数组，不能加对话之外的人。'}
    action.required = Object.keys(properties)
  }
  const completionVersions = ['chat-narrative-action-v59', 'chat-narrative-action-v60', 'chat-narrative-action-v61',
    'chat-narrative-action-v62', 'chat-narrative-action-v63', 'chat-narrative-action-v64', 'chat-narrative-action-v65',
    'chat-narrative-action-v66', 'chat-narrative-action-v67', 'chat-narrative-action-v68', 'chat-narrative-action-v69', 'chat-narrative-action-v70', 'chat-narrative-action-v71', 'chat-narrative-action-v72']
  if (completionVersions.includes(version ?? '')) {
    const constrained = chatCompletionActionSchemaV1(action)
    const schema = {...chatNarrativeOutcomeSchemaV1(constrained.action, version), $defs: constrained.definitions}
    const compact = version !== 'chat-narrative-action-v59'
    const result = compact ? compactChatCompletionSchemaV1(schema) : schema
    return {jsonSchema: {name: ['chat-narrative-action-v67', 'chat-narrative-action-v68', 'chat-narrative-action-v69', 'chat-narrative-action-v70', 'chat-narrative-action-v71', 'chat-narrative-action-v72'].includes(version ?? '') ? 'chat_narrative_outcome_v4'
      : compact ? 'chat_narrative_outcome_v3' : 'chat_narrative_outcome_v2', strict: true,
    schema: ['chat-narrative-action-v67', 'chat-narrative-action-v68', 'chat-narrative-action-v69', 'chat-narrative-action-v70', 'chat-narrative-action-v71', 'chat-narrative-action-v72'].includes(version ?? '') ? compactChatRepeatedSchemasV2(result) : result}}
  }
  const schema = ['chat-narrative-options-v28', 'chat-narrative-options-v29', 'chat-narrative-options-v30', 'chat-narrative-options-v31', 'chat-narrative-options-v32', 'chat-narrative-options-v33', 'chat-narrative-options-v34', 'chat-narrative-options-v35', 'chat-narrative-options-v36', 'chat-narrative-options-v37', 'chat-narrative-options-v38', 'chat-narrative-options-v39', 'chat-narrative-options-v40', 'chat-narrative-options-v41', 'chat-narrative-options-v42'].includes(version ?? '')
    ? object({options: {...array(action), minItems: 2, maxItems: 2}}) : action
  if (supportsChatControlHandoffV1(version)) return {jsonSchema: {name: 'chat_narrative_outcome_v1', strict: true, schema: chatNarrativeOutcomeSchemaV1(schema, version)}}
  return {jsonSchema: {name: wire ? 'chat_action_shape_v4' : ownEvidence ? 'chat_action_shape_v3' : usesChangeDescriptions(version) ? 'chat_action_shape_v2' : 'chat_action_shape_v1', strict: true, schema}}
}

/** A user's zero means "no user cap", never removal of the durable run cap. */
export function boundedChatOutputTokensV1(userLimit: number | undefined, frozenLimit: number): number {
  if (!Number.isSafeInteger(frozenLimit) || frozenLimit < 1
    || userLimit !== undefined && (!Number.isSafeInteger(userLimit) || userLimit < 0)) throw new Error('[chat-output] 输出预算无效')
  return userLimit === undefined || userLimit === 0 ? frozenLimit : Math.min(userLimit, frozenLimit)
}

export const CHAT_ACTION_OUTPUT_CHECK_V1 = '输出完整候选对象，不能省略 goalKey、goalStatus 或示例中的数组/可空字段；无变化用 [] 或 null，不能重复原状态的 threadUpdates。kind 与实际行为一致：已经移动、查看或完成其他自身动作不能标成纯 speak，实际变化按原合同登记。pauseGoal 只保存自己的目标暂停及恢复条件，不自动暂停共同行动：若正文接受双方/整个事项暂停，且该原事项的全部知情者均在本次听众中，必须同时在 threadUpdates 中将对应的 open/blocked 原事项设为 paused，并以同一段确认原话为 evidenceExcerpt；只暂停自己时不能借此暂停他人或整条共同事项。已是 paused 的原事项不重复更新。保留原文字、事实、权限、玩家决定和独立审查；不能为凑字段虚构行动或后果。'

export function chatActionOutputRulesV1(version: string | undefined, audience?: readonly string[]): string[] {
  if (!supportsChatActionOutputContractV1(version)) return []
  return [...(supportsChatTurnCompletionV1(version) ? [CHAT_TURN_COMPLETION_ACTION_RULE_V1] : []), ...(['chat-narrative-action-v59', 'chat-narrative-action-v60', 'chat-narrative-action-v61', 'chat-narrative-action-v62', 'chat-narrative-action-v63', 'chat-narrative-action-v64', 'chat-narrative-action-v65', 'chat-narrative-action-v66', 'chat-narrative-action-v67', 'chat-narrative-action-v68', 'chat-narrative-action-v69', 'chat-narrative-action-v70', 'chat-narrative-action-v71', 'chat-narrative-action-v72'].includes(version ?? '') ? [CHAT_TURN_COMPLETION_OUTPUT_RULE_V1] : []), CHAT_ACTION_OUTPUT_CHECK_V1 + (usesChangeDescriptions(version)
    ? '最后逐项对照行动前状态：goalStatus 是变更指令，不是状态描述；目标继续保持 active 必须填 null，不能填 active。goalUpdates 和 threadUpdates 仅列实际变化，无变化填 []；不能因正在处理事项就重复 open。不得删除原约束、自动补后果或改写原文来规避校验。'
    : '') + (supportsChatOwnEvidenceBindingV1(version)
    ? '本次表达的 evidenceExcerpt 可填 null，由系统逐字绑定完整 text。正文超过对应摘录上限时必须填写连续逐字片段，不能省略或改写：承诺1000字、情境请求1200字、目标/关系/后续目标/暂停/转场2000字、事实/披露/事项8000字。playerExcerpt、destinationExcerpt、历史与来源事实仍必须按各自合同提供原文，不能用 null 代替。绑定原文不代表事实、授权或后果已成立，仍需原校验和独立审查。'
    : '') + (supportsChatActionWireV1(version)
    ? `本次输出用 expressionMode 代替 kind 和 waitingForPlayer，不同时输出两套字段。映射为：speech=speak/false，speech-awaiting-player=speak/true，player-dependent-attempt=attempt/true，self-action-performed=complete/false，self-action-awaiting-player=complete/true，self-pause=pause/false，self-pause-awaiting-player=pause/true。前述领域约束仍按映射后的值执行；接受或维持玩家暂停用 speech-awaiting-player，不能借改名解除等待恢复授权。没有结果不等于依赖玩家；只写打算不等于已经行动。audienceKeys=null 明确使用本轮冻结听众 ${JSON.stringify(audience ?? [])}，不是没有听众。需缩小时填写真实数组，保留玩家和自身，不能扩至本轮对话外；后果修订及待处理改写仍须保留原听众。系统不根据正文猜测行动类型或替玩家同意。`
    : '')]
}
