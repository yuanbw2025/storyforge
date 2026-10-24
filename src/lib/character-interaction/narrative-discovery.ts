import type {CharacterInteractionRuntimeState} from '../types'
import type {ChatFactDiscoveryRecordV1, ChatFactDiscoveryV1, ChatNarrativeStateV1, ChatSituationFactV1} from '../types/chat-narrative'

function fail(message: string): never {throw new Error(`[chat-discovery] ${message}`)}
function row(value: unknown, fields: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== fields.split(',').sort().join(',')) fail('发现字段无效')
  return value as Record<string, unknown>
}
function text(value: unknown, max = 2000): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('发现文本无效')
}
function keys(value: unknown, max = 200): string[] {
  if (!Array.isArray(value) || value.length > max || new Set(value).size !== value.length) fail('发现引用无效')
  value.forEach(key => {text(key, 160); if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(key)) fail('发现标识无效')})
  return value
}
function sequence(value: unknown) {
  if (!Number.isSafeInteger(value) || value === 0) fail('发现缺少实际事件')
}

export function validateChatFactDiscoveryRuleV1(fact: ChatSituationFactV1, facts: ChatSituationFactV1[], boundary: {
  participantKeys: readonly string[]; sceneKeys: readonly string[]
}, maximum: number): void {
  if (fact.discovery === undefined) return
  const rule = row(fact.discovery, 'sceneKey,actorKeys,condition,prerequisiteFactKeys')
  // The frozen-content parser additionally binds reviewed-world rules to the
  // author's exact source-level authorization. Runtime events cannot edit rules.
  if (!maximum || !['author-private', 'reviewed-world'].includes(fact.origin) || fact.sourceEventSequence !== 0) fail('隐情缺少作者确认的初始来源或作品授权')
  text(rule.condition)
  if (!boundary.sceneKeys.includes(String(rule.sceneKey))) fail('发现条件引用包外场景')
  const actors = keys(rule.actorKeys, 8), prerequisites = keys(rule.prerequisiteFactKeys)
  if (!actors.length || actors.some(actor => !boundary.participantKeys.includes(actor)) || !prerequisites.length) fail('发现条件缺少合法角色或可知前提')
  for (const key of prerequisites) {
    const known = facts.find(f => f.factKey === key)
    if (!known || key === fact.factKey || actors.some(actor => !known.audienceKeys.includes(actor))) fail('发现前提不能引用待发现真相或角色未知材料')
  }
}

export function parseChatFactDiscoveriesV1(value: unknown): ChatFactDiscoveryV1[] {
  if (!Array.isArray(value) || value.length > 3) fail('发现候选数量无效')
  const seen = new Set<string>()
  for (const item of value) {
    const candidate = row(item, 'factKey,actorKey,actionSequence,evidenceFactKeys,evidenceExcerpt,result,reason')
    keys([candidate.factKey]); keys([candidate.actorKey], 1); sequence(candidate.actionSequence)
    if (seen.has(String(candidate.factKey))) fail('同一事实不能重复判定')
    seen.add(String(candidate.factKey))
    if (!keys(candidate.evidenceFactKeys).length) fail('发现候选缺少调查依据')
    text(candidate.evidenceExcerpt); text(candidate.reason)
    if (!['discovered', 'not-discovered', 'inconclusive'].includes(String(candidate.result))) fail('发现结果无效')
  }
  return structuredClone(value) as ChatFactDiscoveryV1[]
}

/** Mutates only the caller's dry-run clone. The parent situation command
 * requires the exact candidate's semantic review before persisting it. */
export function applyChatFactDiscoveriesV1(state: CharacterInteractionRuntimeState, candidates: ChatFactDiscoveryV1[], commitSequence: number): void {
  if (!candidates.length) return
  const story = state.chatNarrative!, pending = story.pendingSituation, scene = state.activeScene!
  const maximum = story.permissions.maxDiscoveriesPerSituation ?? 0
  if (!maximum || candidates.length > maximum || !pending) fail('本次调查没有发现授权或超过额度')
  if ((story.discoveryHistory?.length ?? 0) + candidates.length > 1000) fail('发现记录达到上限，请保存当前会话')
  for (const candidate of candidates) {
    const fact = story.situation.facts.find(f => f.factKey === candidate.factKey), rule = fact?.discovery
    if (!fact || !rule || rule.sceneKey !== scene.sceneKey || !rule.actorKeys.includes(candidate.actorKey)
      || pending.actorKey !== candidate.actorKey || pending.sourceEventSequence !== candidate.actionSequence
      || !scene.activeParticipantKeys.includes(candidate.actorKey) || fact.audienceKeys.includes(candidate.actorKey)) fail('发现不属于当前角色、场景、调查或仍未知的授权事实')
    if (story.discoveryHistory?.some(record => record.factKey === candidate.factKey && record.actionSequence === candidate.actionSequence)) fail('该调查已经判定，不能重复解锁')
    const message = state.messages.find(m => m.role === 'character' && m.speakerKey === candidate.actorKey
      && m.eventSequence === candidate.actionSequence && m.supersededBySequence == null)
    if (!message || !message.text.includes(candidate.evidenceExcerpt)) fail('调查摘录没有对应的已发生角色行动')
    if (rule.prerequisiteFactKeys.some(key => !candidate.evidenceFactKeys.includes(key))) fail('调查缺少冻结条件的必要前提')
    const evidence = candidate.evidenceFactKeys.map(key => story.situation.facts.find(f => f.factKey === key))
    if (evidence.some(f => !f || !f.audienceKeys.includes(candidate.actorKey) || f.factKey === fact.factKey)) fail('调查依据引用了角色未知材料')
    if (!evidence.some(f => f!.origin === 'runtime-consequence' && f!.sourceEventSequence === candidate.actionSequence
      && candidate.evidenceExcerpt.includes(f!.text))) fail('调查必须有本次实际完成行动的事实证据，意向或旧动作不能解锁')
    if (candidate.result === 'discovered') fact.audienceKeys.push(candidate.actorKey)
    ;(story.discoveryHistory ??= []).push({...structuredClone(candidate), discoverySequence: commitSequence})
  }
}

export function validateChatDiscoveryHistoryV1(story: ChatNarrativeStateV1): void {
  if (story.discoveryHistory === undefined) return
  if (!Array.isArray(story.discoveryHistory) || story.discoveryHistory.length > 1000 || !story.permissions.maxDiscoveriesPerSituation) fail('发现记录缺少授权或超限')
  const seen = new Set<string>()
  const learned = new Set<string>()
  const batches = new Map<number, {count: number; actorKey: string; actionSequence: number}>()
  let previousSequence = Number.MIN_SAFE_INTEGER
  for (const value of story.discoveryHistory) {
    const record = row(value, 'factKey,actorKey,actionSequence,evidenceFactKeys,evidenceExcerpt,result,reason,discoverySequence')
    const {discoverySequence, ...candidate} = record
    parseChatFactDiscoveriesV1([candidate]); sequence(discoverySequence)
    const item = value as ChatFactDiscoveryRecordV1
    const fact = story.situation.facts.find(f => f.factKey === item.factKey)
    const identity = `${item.factKey}\0${item.actionSequence}`
    const learner = `${item.factKey}\0${item.actorKey}`
    const batch = batches.get(item.discoverySequence)
    if (seen.has(identity) || learned.has(learner) || !fact?.discovery?.actorKeys.includes(item.actorKey)
      || item.discoverySequence <= item.actionSequence || item.discoverySequence > story.lastEventSequence
      || item.discoverySequence < previousSequence
      || batch && (batch.actorKey !== item.actorKey || batch.actionSequence !== item.actionSequence || batch.count >= story.permissions.maxDiscoveriesPerSituation)
      || !story.triggers.some(t => t.actionSequences.includes(item.actionSequence))
      || item.result === 'discovered' && !fact.audienceKeys.includes(item.actorKey)) fail('发现记录与事实、授权或事件不一致')
    seen.add(identity)
    previousSequence = item.discoverySequence
    batches.set(item.discoverySequence, {count: (batch?.count ?? 0) + 1, actorKey: item.actorKey, actionSequence: item.actionSequence})
    if (item.result === 'discovered') learned.add(learner)
    if (fact.discovery.prerequisiteFactKeys.some(key => !item.evidenceFactKeys.includes(key))
      || item.evidenceFactKeys.includes(item.factKey)
      || item.evidenceFactKeys.some(key => !story.situation.facts.some(f => f.factKey === key && f.audienceKeys.includes(item.actorKey)))
      || !story.situation.facts.some(f => item.evidenceFactKeys.includes(f.factKey) && f.origin === 'runtime-consequence'
        && f.sourceEventSequence === item.actionSequence && item.evidenceExcerpt.includes(f.text))) fail('发现记录缺少实际调查事实')
  }
}

/** No hidden fact identifiers, conditions, reasons or count of failed probes. */
export function chatActorInvestigationResultsV1(story: ChatNarrativeStateV1, actorKey: string) {
  const own = story.discoveryHistory?.filter(record => record.actorKey === actorKey) ?? []
  return [...new Set(own.map(record => record.actionSequence))].map(actionSequence => {
    const records = own.filter(record => record.actionSequence === actionSequence)
    const found = records.filter(record => record.result === 'discovered')
    return {actionSequence, result: found.length ? 'discovered' : records.some(record => record.result === 'inconclusive') ? 'inconclusive' : 'not-discovered',
      discoveredFactKeys: found.map(record => record.factKey)}
  })
}
