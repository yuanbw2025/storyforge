import type {CharacterInteractionRuntimeState} from '../types'
import {CHAT_INQUIRY_REVIEW_CHECKS_V1, type ChatInquiryResultV1, type ChatInquiryReviewV1, type ChatNarrativeStateV1} from '../types/chat-narrative'
import {isChatMessageRetrievableV1} from './narrative-retrieval'
import {recordChatFactEvidenceV1} from './fact-evidence'
import {chatInquiryContextForVersionV1, parseChatInquiryEvidenceVersionV1} from './inquiry-evidence'

function fail(message: string): never {throw new Error(`[chat-inquiry] ${message}`)}
function object(value: unknown, fields: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== fields.split(',').sort().join(',')) fail('询问结果字段无效')
}
function text(value: unknown, max = 2000): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('询问文本缺失或超限')
}
function key(value: unknown): asserts value is string {text(value, 160); if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value)) fail('询问标识无效')}
function keys(value: unknown, max = 200): asserts value is string[] {
  if (!Array.isArray(value) || value.length > max || new Set(value).size !== value.length) fail('询问引用重复或超限')
  value.forEach(key)
}
function existedAt(sequence: number, at: number) {return sequence === 0 || sequence <= at}
function sequence(value: unknown): asserts value is number {if (!Number.isSafeInteger(value) || value === 0) fail('询问缺少真实事件')}
const fields = 'actorKey,questionSequence,questionExcerpt,respondentFactKey,respondentExcerpt,respondentName,statementFactKey,answerKind,answerText,audienceKeys,evidenceFactKeys,discoveries'

export function parseChatInquiryResultV1(value: unknown): ChatInquiryResultV1 {
  object(value, fields)
  key(value.actorKey); sequence(value.questionSequence); text(value.questionExcerpt)
  key(value.respondentFactKey); text(value.respondentExcerpt); text(value.respondentName, 200); key(value.statementFactKey)
  text(value.answerText); keys(value.audienceKeys, 33); keys(value.evidenceFactKeys)
  if (!['statement', 'uncertain', 'declined'].includes(String(value.answerKind)) || !value.audienceKeys.includes(value.actorKey)
    || !value.evidenceFactKeys.includes(value.respondentFactKey) || !value.respondentExcerpt.includes(value.respondentName)) fail('答复缺少听众、人物依据或明确结果')
  if (!Array.isArray(value.discoveries) || value.discoveries.length > 3 || value.answerKind === 'declined' && value.discoveries.length) fail('拒答不能释放事实或发现超出上限')
  const seen = new Set<string>()
  for (const discovery of value.discoveries) {
    object(discovery, 'factKey,answerExcerpt,reason'); key(discovery.factKey); text(discovery.answerExcerpt); text(discovery.reason)
    if (seen.has(discovery.factKey) || !value.answerText.includes(discovery.answerExcerpt)) fail('事实发现须对应本次实际答复的唯一原话')
    seen.add(discovery.factKey)
  }
  return structuredClone(value) as unknown as ChatInquiryResultV1
}

export function parseChatInquiryReviewV1(value: unknown, result: ChatInquiryResultV1): ChatInquiryReviewV1 {
  object(value, 'checks,discoveries')
  if (!Array.isArray(value.checks) || value.checks.length !== CHAT_INQUIRY_REVIEW_CHECKS_V1.length || !Array.isArray(value.discoveries) || value.discoveries.length !== result.discoveries.length) fail('询问独立复核须完整覆盖问题、人物、回应、听众和逐项发现')
  const seen = new Set<string>()
  for (const check of value.checks) {
    object(check, 'check,passed,reason'); text(check.reason)
    if (!CHAT_INQUIRY_REVIEW_CHECKS_V1.includes(check.check as typeof CHAT_INQUIRY_REVIEW_CHECKS_V1[number]) || typeof check.passed !== 'boolean' || seen.has(String(check.check))) fail('询问复核项目缺失或重复')
    seen.add(String(check.check))
  }
  seen.clear()
  for (const check of value.discoveries) {
    object(check, 'factKey,passed,reason'); text(check.reason)
    if (!result.discoveries.some(row => row.factKey === check.factKey) || typeof check.passed !== 'boolean' || seen.has(String(check.factKey))) fail('事实发现没有唯一独立复核')
    seen.add(String(check.factKey))
  }
  return structuredClone(value) as unknown as ChatInquiryReviewV1
}
export function chatInquiryReviewPassedV1(review: ChatInquiryReviewV1) {return [...review.checks, ...review.discoveries].every(row => row.passed)}
export function chatInquiryStatementTextV1(result: ChatInquiryResultV1) {
  return `【${result.respondentName}的实际答复；只证明说过这些话，陈述内容仍须独立核实】${result.answerText}`
}

/** This mutates only the situation reducer's clone, after an exact independent review. */
export function applyChatInquiryResultV1(state: CharacterInteractionRuntimeState, result: ChatInquiryResultV1, resultSequence: number, factEvidenceVersion?: unknown, inquiryEvidenceVersion?: unknown) {
  const version = parseChatInquiryEvidenceVersionV1(inquiryEvidenceVersion)
  const context = version === undefined ? undefined : chatInquiryContextForVersionV1(state, version)
  const basis = context && 'questions' in context ? context.questions.find(q => q.questionSequence === result.questionSequence) : context
  const story = state.chatNarrative!, scene = state.activeScene!, pending = story.pendingSituation
  if (story.permissions.allowInquiryResults !== true || story.permissions.allowActorSituationExpansion !== true
    || !story.permissions.allowedNewFactKinds.includes('observation') || story.permissions.maxNewFactsPerAction < 1) fail('作品未授权询问结果')
  const completed = pending?.purpose === 'inquiry-result'
  if (!pending || pending.purpose !== undefined && !completed || pending.actorKey !== result.actorKey
    || (version === 2 || version === 3 || version === 4 || version === 5 ? !basis : pending.sourceEventSequence !== result.questionSequence)
    || !scene.activeParticipantKeys.includes(result.actorKey)) fail('答复必须承接当前已审查方向中的实际询问')
  if (completed && (version !== 5 || result.questionSequence !== pending.sourceEventSequence
    || result.questionExcerpt !== pending.evidenceExcerpt || result.respondentFactKey !== pending.respondentFactKey
    || result.respondentExcerpt !== pending.respondentExcerpt || result.respondentName !== pending.respondentName)) fail('答复必须匹配原已完成询问和答复对象，旧合同不能结算新标记')
  if ((story.inquiryHistory?.length ?? 0) >= 1000 || story.inquiryHistory?.some(row => row.questionSequence === result.questionSequence)) fail('询问已经回答或记录已达上限')
  const question = state.messages.find(row => row.role === 'character' && row.speakerKey === result.actorKey && row.eventSequence === result.questionSequence && row.supersededBySequence == null)
  if (!question || !isChatMessageRetrievableV1(state, question) || !question.text.includes(result.questionExcerpt)
    || result.questionSequence < scene.startedAtSequence || result.questionSequence >= resultSequence) fail('问题没有对应本场景的真实角色消息')
  if (state.profiles.some(row => row.name === result.respondentName || row.participantKey === result.respondentName)
    || [state.playerKey, story.persona.name].includes(result.respondentName)) fail('不能代替玩家或可调度主角色作答')
  const respondent = story.situation.facts.find(row => row.factKey === result.respondentFactKey)
  if (!respondent || !respondent.text.includes(result.respondentExcerpt) || !existedAt(respondent.sourceEventSequence, result.questionSequence)) fail('答复对象缺少问题提出前的实际人物依据')
  if (result.audienceKeys.some(key => ![state.playerKey, ...scene.activeParticipantKeys].includes(key)
    || question.audienceKeys != null && !question.audienceKeys.includes(key) || !respondent.audienceKeys.includes(key))) fail('答复听众超出实际对话或人物可知范围')
  const allowedEvidence = new Set(pending.evidenceFactKeys)
  if (version !== undefined) {
    const contactAllowed = version === 4 || version === 5
      ? basis && 'respondentEvidenceFactKeys' in basis && Array.isArray(basis.respondentEvidenceFactKeys)
        && basis.respondentEvidenceFactKeys.includes(result.respondentFactKey)
      : pending.evidenceFactKeys.includes(result.respondentFactKey)
    if (!basis || !contactAllowed) fail('询问前提证据缺少实际提问和人物依据')
    // Admit only the selected contact reference, never the entire candidate list.
    if (version === 4 || version === 5) allowedEvidence.add(result.respondentFactKey)
    for (const discovery of result.discoveries) {
      const target = basis.targets.find(target => target.factKey === discovery.factKey)
      if (!target) fail('询问发现缺少提问时已知的冻结前提')
      for (const key of target.requiredEvidenceFactKeys) allowedEvidence.add(key)
    }
  }
  for (const key of result.evidenceFactKeys) {
    const fact = story.situation.facts.find(row => row.factKey === key)
    if (!fact || !allowedEvidence.has(key) || !fact.audienceKeys.includes(result.actorKey) || !existedAt(fact.sourceEventSequence, result.questionSequence)) fail('询问依据须是提问者当时已知的事实')
  }
  if (story.situation.facts.some(row => row.factKey === result.statementFactKey || row.text === chatInquiryStatementTextV1(result))) fail('答复记录不得覆盖或重复既有事实')
  if (result.discoveries.length > (story.permissions.maxDiscoveriesPerSituation ?? 0)) fail('询问发现超出作品授权')
  for (const discovery of result.discoveries) {
    const fact = story.situation.facts.find(row => row.factKey === discovery.factKey), rule = fact?.discovery
    if (!fact || !rule || fact.audienceKeys.includes(result.actorKey) || rule.sceneKey !== scene.sceneKey || !rule.actorKeys.includes(result.actorKey)
      || rule.prerequisiteFactKeys.some(key => !result.evidenceFactKeys.includes(key))) fail('答复不能释放无冻结发现授权、已知或缺前提的事实')
  }
  story.situation.facts.push({factKey: result.statementFactKey, text: chatInquiryStatementTextV1(result), audienceKeys: [...result.audienceKeys],
    origin: 'runtime-situation', sourceKnowledgeKey: null, sourceEventSequence: resultSequence})
  recordChatFactEvidenceV1(story, factEvidenceVersion, [{factKey: result.statementFactKey, kind: 'observation',
    evidenceFactKeys: result.evidenceFactKeys, actorKey: result.actorKey, goalKey: pending?.goalKey ?? null, source: 'inquiry'}])
  for (const discovery of result.discoveries) {
    const fact = story.situation.facts.find(row => row.factKey === discovery.factKey)!
    fact.audienceKeys = [...new Set([...fact.audienceKeys, ...result.audienceKeys])]
  }
  ;(story.inquiryHistory ??= []).push({...structuredClone(result), resultSequence, sceneKey: scene.sceneKey})
}

export function validateChatInquiryHistoryV1(story: ChatNarrativeStateV1, boundary: {participantKeys: readonly string[]; sceneKeys: readonly string[]}) {
  if (story.inquiryHistory === undefined) return
  if (!Array.isArray(story.inquiryHistory) || story.inquiryHistory.length > 1000 || story.permissions.allowInquiryResults !== true) fail('询问历史未经作品授权或超限')
  const questions = new Set<number>(), statements = new Set<string>(), discoveredFor = new Set<string>()
  let previous = Number.MIN_SAFE_INTEGER
  for (const record of story.inquiryHistory) {
    object(record, fields + ',resultSequence,sceneKey')
    const {resultSequence, sceneKey, ...value} = record, result = parseChatInquiryResultV1(value)
    sequence(resultSequence); key(sceneKey)
    if (!boundary.sceneKeys.includes(sceneKey) || !boundary.participantKeys.includes(result.actorKey)
      || result.audienceKeys.some(key => key !== 'player' && !boundary.participantKeys.includes(key))
      || resultSequence <= result.questionSequence || resultSequence <= previous || resultSequence > story.lastEventSequence
      || questions.has(result.questionSequence) || statements.has(result.statementFactKey)
      || !story.triggers.some(trigger => trigger.actionSequences.includes(result.questionSequence))) fail('询问历史与角色、场景或真实事件不一致')
    const statement = story.situation.facts.find(row => row.factKey === result.statementFactKey)
    if (!statement || statement.origin !== 'runtime-situation' || statement.sourceEventSequence !== resultSequence || statement.text !== chatInquiryStatementTextV1(result)
      || result.audienceKeys.some(key => !statement.audienceKeys.includes(key))) fail('实际答复与所记录说法不一致')
    const respondent = story.situation.facts.find(row => row.factKey === result.respondentFactKey)
    if (!respondent || !respondent.text.includes(result.respondentExcerpt) || !existedAt(respondent.sourceEventSequence, result.questionSequence)
      || result.audienceKeys.some(key => !respondent.audienceKeys.includes(key))
      || result.evidenceFactKeys.some(key => !story.situation.facts.some(fact => fact.factKey === key && fact.audienceKeys.includes(result.actorKey) && existedAt(fact.sourceEventSequence, result.questionSequence)))) fail('历史答复缺少人物或提问前的已知依据')
    if (result.discoveries.length > (story.permissions.maxDiscoveriesPerSituation ?? 0)) fail('历史答复发现超出授权')
    for (const discovery of result.discoveries) {
      const fact = story.situation.facts.find(row => row.factKey === discovery.factKey), rule = fact?.discovery
      if (discoveredFor.has(`${result.actorKey}:${discovery.factKey}`) || result.evidenceFactKeys.includes(discovery.factKey)) fail('历史答复重复发现提问者已经知道的事实')
      if (!fact || !rule || rule.sceneKey !== sceneKey || !rule.actorKeys.includes(result.actorKey) || result.audienceKeys.some(key => !fact.audienceKeys.includes(key))
        || rule.prerequisiteFactKeys.some(key => !result.evidenceFactKeys.includes(key))) fail('历史答复发现与冻结授权或听众知情不一致')
      for (const audience of result.audienceKeys) discoveredFor.add(`${audience}:${discovery.factKey}`)
    }
    questions.add(result.questionSequence); statements.add(result.statementFactKey); previous = resultSequence
  }
}

export function assertChatInquirySourcesV1(state: CharacterInteractionRuntimeState) {
  for (const result of state.chatNarrative?.inquiryHistory ?? []) {
    const question = state.messages.find(row => row.role === 'character' && row.speakerKey === result.actorKey && row.eventSequence === result.questionSequence)
    if (!question || !question.text.includes(result.questionExcerpt) || result.audienceKeys.some(key => question.audienceKeys != null && !question.audienceKeys.includes(key))
      || state.profiles.some(row => row.name === result.respondentName || row.participantKey === result.respondentName)
      || [state.playerKey, state.chatNarrative!.persona.name].includes(result.respondentName)) fail('询问历史缺少真实问题或冒用了主角色身份')
  }
}

/** Never expose discovery conditions, hidden fact identifiers or reviewer reasons. */
export function chatInquiryRepliesV1(story: ChatNarrativeStateV1, viewerKey: string) {
  return (story.inquiryHistory ?? []).filter(row => row.audienceKeys.includes(viewerKey)).map(row => ({
    sequence: row.resultSequence, questionSequence: row.questionSequence, respondentName: row.respondentName,
    answerKind: row.answerKind, answerText: row.answerText, statementFactKey: row.statementFactKey,
    confirmedFactKeys: row.discoveries.map(discovery => discovery.factKey),
  }))
}

export function assertChatInquiryBindingV1(result: ChatInquiryResultV1 | undefined, producerVersion: string | undefined, reviewerVersion: string | undefined) {
  const supportedPair = (producerVersion === 'chat-situation-construction-v8' && reviewerVersion === 'chat-situation-review-v7')
    || (producerVersion === 'chat-situation-construction-v9' && reviewerVersion === 'chat-situation-review-v8')
    || (producerVersion === 'chat-situation-construction-v10' && reviewerVersion === 'chat-situation-review-v9')
    || (producerVersion === 'chat-situation-construction-v11' && reviewerVersion === 'chat-situation-review-v10')
    || (producerVersion === 'chat-situation-construction-v12' && reviewerVersion === 'chat-situation-review-v11')
    || (producerVersion === 'chat-situation-construction-v13' && reviewerVersion === 'chat-situation-review-v12')
    || (producerVersion === 'chat-situation-construction-v14' && reviewerVersion === 'chat-situation-review-v13')
    || (producerVersion === 'chat-situation-construction-v15' && reviewerVersion === 'chat-situation-review-v14')
    || (producerVersion === 'chat-situation-construction-v16' && reviewerVersion === 'chat-situation-review-v15')
    || (producerVersion === 'chat-situation-construction-v17' && reviewerVersion === 'chat-situation-review-v16')
    || (producerVersion === 'chat-situation-construction-v18' && reviewerVersion === 'chat-situation-review-v17')
    || (producerVersion === 'chat-situation-construction-v19' && reviewerVersion === 'chat-situation-review-v18')
    || (producerVersion === 'chat-situation-construction-v20' && reviewerVersion === 'chat-situation-review-v19')
    || (producerVersion === 'chat-situation-construction-v21' && reviewerVersion === 'chat-situation-review-v19')
  if (result && !supportedPair) fail('旧情境合同不能取得询问结果权限，请保留原记录并明确发起新请求')
}
