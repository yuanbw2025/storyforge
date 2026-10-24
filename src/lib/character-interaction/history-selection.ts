import type {CharacterInteractionRuntimeState, InteractionRuntimeMemory, InteractionRuntimeMessage} from '../types'
import type {ChatSituationV1, ChatGoalCommitmentV1} from '../types/chat-narrative'

export type ChatHistoryKindV1 = 'facts' | 'goals' | 'threads' | 'commitments' | 'knowledge' | 'memories' | 'messages' | 'relationships'
export type ChatHistoryScopeV1 = Pick<ChatSituationV1, 'facts' | 'goals' | 'threads' | 'beliefs' | 'possibilities'> & {commitments: ChatGoalCommitmentV1[]}
export const chatHistoryIdV1 = (kind: ChatHistoryKindV1, key: string) => `${kind}:${key}`
export const CHAT_HISTORY_POLICY_V1 = '仅对有来源的历次观察、已结束事项和已处理约定按相关性选择；原事实、状态、权限和存档不变。未选入不表示不存在、已失效或可重复完成。选入条目的已知事实依据和处置原文一起读取；必要依据不足时停止。'

export const CHAT_HISTORY_POLICY_V2 = CHAT_HISTORY_POLICY_V1 + ' 选入运行事实时，一并读取已知且在后续明确引用它的运行记录，按事件顺序理解变化；后续记录不自动抹去或撤销原事实，不能把过去的动作直接当成当前状态。'

/** A projection over an already authorized scope. Canonical metadata supplies
 * dependency edges only; it cannot add another role's private rows or keys. */
export function createChatHistoryPlanV1(state: CharacterInteractionRuntimeState, scope: ChatHistoryScopeV1, options: {followupEvidence?: boolean} = {}) {
  const story = state.chatNarrative!
  const entries = new Map<string, {kind: ChatHistoryKindV1; key: string; text: string; required: string[]; dependencies: Set<string>; order: number; importance: number}>()
  const id = chatHistoryIdV1
  const add = (kind: ChatHistoryKindV1, key: string, text: string, reasons: string[] = [], importance = 0) => {
    const identity = id(kind, key)
    if (entries.has(identity)) throw new Error('历史选择条目身份重复')
    entries.set(identity, {kind, key, text, required: [...reasons], dependencies: new Set(), order: entries.size, importance})
  }
  const require = (kind: ChatHistoryKindV1, key: string, reason: string) => {
    const entry = entries.get(id(kind, key))
    if (entry && !entry.required.includes(reason)) entry.required.push(reason)
  }
  const link = (fromKind: ChatHistoryKindV1, from: string, toKind: ChatHistoryKindV1, to: string) => {
    const entry = entries.get(id(fromKind, from)), target = id(toKind, to)
    if (entry && entries.has(target)) entry.dependencies.add(target)
  }
  const factEvidence = new Map(story.factEvidence?.records.map(r => [r.factKey, r]))
  const goalEvidence = new Map(story.resolutionEvidence?.goals.map(r => [r.targetKey, r]))
  const threadEvidence = new Map(story.resolutionEvidence?.threads.map(r => [r.targetKey, r]))
  for (const f of scope.facts) {
    const proof = factEvidence.get(f.factKey)
    add('facts', f.factKey, f.text, !proof ? ['unclassified-fact'] : proof.kind !== 'observation' ? ['durable-fact'] : [])
  }
  for (const g of scope.goals) add('goals', g.goalKey, `${g.desire}\n${g.concern}\n${g.boundary}`, ['active', 'paused'].includes(g.status) ? ['unfinished-goal'] : !goalEvidence.has(g.goalKey) ? ['unclassified-resolution'] : [])
  for (const t of scope.threads) add('threads', t.threadKey, `${t.title}\n${t.question}\n${t.closureSignals.join('\n')}`, ['open', 'blocked', 'paused'].includes(t.status) ? ['unfinished-thread'] : !threadEvidence.has(t.threadKey) ? ['unclassified-resolution'] : [])
  for (const c of scope.commitments) add('commitments', c.commitmentKey, `${c.terms}\n${c.resolution?.excerpt ?? ''}`, !c.resolution ? ['open-commitment'] : [])
  for (const f of scope.facts) for (const key of factEvidence.get(f.factKey)?.evidenceFactKeys ?? []) link('facts', f.factKey, 'facts', key)
  if (options.followupEvidence) {
    const facts = new Map(scope.facts.map(f => [f.factKey, f]))
    // Follow explicit, chronological evidence edges only within the authorized
    // view. Initial facts are shared premises, not a reason to load every event.
    // Both directions make a causal component indivisible during budget trials.
    for (const fact of scope.facts) if (fact.sourceEventSequence !== 0) {
      for (const key of factEvidence.get(fact.factKey)?.evidenceFactKeys ?? []) {
        const source = facts.get(key)
        if (source && source.sourceEventSequence !== 0 && source.sourceEventSequence < fact.sourceEventSequence) {
          link('facts', key, 'facts', fact.factKey)
        }
      }
    }
  }
  for (const kind of ['goals', 'threads'] as const) for (const item of scope[kind]) {
    const key = 'goalKey' in item ? item.goalKey : item.threadKey
    const proof = (kind === 'goals' ? goalEvidence : threadEvidence).get(key)
    for (const fact of [...item.evidenceFactKeys, ...(proof?.evidenceFactKeys ?? [])]) link(kind, key, 'facts', fact)
  }
  for (const g of scope.goals) {
    if (g.playerPause) link('goals', g.goalKey, 'threads', g.playerPause.threadKey)
    const latest = [...(g.commitments ?? [])].reverse().find(c => c.resolution)
    for (const c of g.commitments ?? []) {
      link('commitments', c.commitmentKey, 'goals', g.goalKey)
      if (!c.resolution || c === latest) link('goals', g.goalKey, 'commitments', c.commitmentKey)
    }
  }
  // Shared spoken promises do not grant the listener access to private goals.
  const owned = new Set(scope.goals.flatMap(g => g.commitments?.map(c => c.commitmentKey) ?? []))
  for (const g of story.situation.goals) {
    const latest = [...(g.commitments ?? [])].reverse().find(c => c.resolution)
    if (latest && !owned.has(latest.commitmentKey)) require('commitments', latest.commitmentKey, 'latest-shared-resolution')
  }
  for (const item of [...scope.beliefs, ...scope.possibilities]) for (const key of item.evidenceFactKeys) require('facts', key, 'current-belief-or-plan')
  // Discovery permissions and their prerequisites remain whole, including
  // coordinator-only facts; an actor's scope never contains unknown targets.
  for (const f of story.situation.facts) if (f.discovery) for (const key of [f.factKey, ...f.discovery.prerequisiteFactKeys]) require('facts', key, 'discovery-condition')
  for (const record of story.discoveryHistory ?? []) for (const key of [record.factKey, ...record.evidenceFactKeys]) require('facts', key, 'discovery-result')
  for (const record of story.inquiryHistory ?? []) for (const key of [record.respondentFactKey, record.statementFactKey, ...record.evidenceFactKeys, ...record.discoveries.map(d => d.factKey)]) require('facts', key, 'inquiry-result')
  for (const record of story.sceneTransitions ?? []) for (const key of [record.destinationFactKey, record.arrivalFactKey]) require('facts', key, 'visited-place')
  const latestFact = scope.facts.filter(f => f.sourceEventSequence !== 0).slice(-1)[0]
  for (const f of scope.facts) if (latestFact && f.sourceEventSequence === latestFact.sourceEventSequence) require('facts', f.factKey, 'latest-consequence')
  for (const key of story.pendingSituation?.evidenceFactKeys ?? []) require('facts', key, 'pending-action')
  if (story.pendingSituation?.threadKey) require('threads', story.pendingSituation.threadKey, 'pending-action')
  if (story.pendingSituation?.goalKey) require('goals', story.pendingSituation.goalKey, 'pending-action')
  if (story.situation.seed.sourceThreadKey) require('threads', story.situation.seed.sourceThreadKey, 'current-situation')

  const linkSequence = (kind: ChatHistoryKindV1, key: string, sequence: number) => {
    for (const f of scope.facts) if (f.sourceEventSequence !== 0 && f.sourceEventSequence === sequence) link(kind, key, 'facts', f.factKey)
  }
  for (const c of scope.commitments) for (const source of [c.declared, c.resolution, c.requested]) if (source) linkSequence('commitments', c.commitmentKey, source.sequence)
  const protectSequence = (sequence: number, reason: string) => {
    for (const f of scope.facts) if (f.sourceEventSequence !== 0 && f.sourceEventSequence === sequence) require('facts', f.factKey, reason)
  }
  for (const g of scope.goals) if (g.playerPause) {
    linkSequence('goals', g.goalKey, g.playerPause.requested.sequence); linkSequence('goals', g.goalKey, g.playerPause.acknowledged.sequence)
  }
  if (story.pendingSituation) protectSequence(story.pendingSituation.sourceEventSequence, 'pending-action')
  const linkMessage = (m: InteractionRuntimeMessage) => linkSequence('messages', m.messageId, m.eventSequence)
  const linkMemory = (m: InteractionRuntimeMemory) => {for (const sequence of m.sourceEventSequences) linkSequence('memories', m.memoryId, sequence)}
  const linkKnowledge = (key: string) => {for (const f of scope.facts) if (f.sourceKnowledgeKey === key) link('facts', f.factKey, 'knowledge', key)}
  const protectCandidate = (text: string) => {for (const entry of entries.values()) if (text.includes(JSON.stringify(entry.key))) require(entry.kind, entry.key, 'candidate-reference')}
  const closure = (selected: ReadonlySet<string>, roots: Iterable<string>) => {
    const next = new Set(selected), queue = [...roots]
    while (queue.length) {
      const key = queue.pop()!
      if (next.has(key)) continue
      const entry = entries.get(key)
      if (!entry) throw new Error('历史选择缺少已授权的必要来源')
      next.add(key); queue.push(...entry.dependencies)
    }
    return next
  }
  const required = () => closure(new Set(), [...entries].filter(([, e]) => e.required.length).map(([key]) => key))
  const choose = (fits: (selected: ReadonlySet<string>) => boolean, score: (text: string) => number) => {
    let selected = required()
    if (!fits(selected)) throw new Error('当前事实、未处理事项及必需历史依据超过预算，已停止；不会静默省略必要来源，也不会静默省略固定记忆。')
    const ranked = [...entries].map(([key, e]) => ({key, score: score(e.text), order: e.order, importance: e.importance})).sort((a, b) => b.score - a.score || b.importance - a.importance || a.order - b.order)
    for (const entry of ranked) {
      if (selected.has(entry.key)) continue
      const next = closure(selected, [entry.key])
      if (fits(next)) selected = next
    }
    return selected
  }
  const evidence = (selected: ReadonlySet<string>) => [...entries.values()].map(e => ({kind: e.kind, key: e.key, included: selected.has(id(e.kind, e.key)), required: e.required}))
  const resolutions = (selected: ReadonlySet<string>) => (['goals', 'threads'] as const).flatMap(kind => scope[kind].flatMap(item => {
    const key = 'goalKey' in item ? item.goalKey : item.threadKey, proof = (kind === 'goals' ? goalEvidence : threadEvidence).get(key)
    if (!proof || !selected.has(id(kind, key))) return []
    const message = state.messages.find(m => m.messageId === proof.source.messageId)!
    return [{kind, key, evidenceFactKeys: proof.evidenceFactKeys.filter(f => entries.has(id('facts', f))),
      source: {messageId: message.messageId, sequence: message.eventSequence, excerpt: message.text.slice(proof.source.start, proof.source.end)}}]
  }))
  return {entries, add, require, link, linkMessage, linkMemory, linkKnowledge, protectCandidate, protectSequence, choose, evidence, resolutions, required, closure}
}
export type ChatHistoryPlanV1 = ReturnType<typeof createChatHistoryPlanV1>
