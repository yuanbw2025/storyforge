import type {
  FrozenInteractionCharacterProfile,
  FrozenInteractionSceneTemplate,
  InteractionRelationshipRule,
  InteractionMemoryKind,
  InteractionRuntimeKnowledge,
  InteractionRuntimeMemory,
  InteractionRuntimeMessage,
  InteractionRuntimeProfile,
  InteractionRuntimeRelationship,
  InteractionRuntimeScene,
  InteractionRuntimeSceneTemplate,
  InteractionRuntimeThread,
  InteractionRelationshipChange,
  RuntimeMemoryStatus,
  ProductRuntimeEvent,
  CharacterInteractionRuntimeState,
} from '../types'

type JsonObject = Record<string, unknown>

const MEMORY_KINDS = new Set<InteractionMemoryKind>([
  'scene-summary',
  'key-memory',
  'commitment',
  'secret',
  'conflict',
  'gift',
])
const MEMORY_STATUSES = new Set(['proposed', 'accepted', 'rejected', 'superseded'])
const KNOWLEDGE_STATUSES = new Set<RuntimeMemoryStatus>(['known', 'mistaken', 'forgotten'])

function isObject(value: unknown): value is JsonObject {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown, label: string, maximum = 20_000): string {
  const result = String(value ?? '').trim()
  if (!result || result.length > maximum) throw new Error(`${label}无效。`)
  return result
}

function nullableText(value: unknown, label: string, maximum = 20_000): string | null {
  if (value == null) return null
  return text(value, label, maximum)
}

function integer(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${label}无效。`)
  }
  return Number(value)
}

function finite(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isFinite(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${label}无效。`)
  }
  return Number(value)
}

function strings(value: unknown, label: string, maximum = 200): string[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组。`)
  const result = value.map(item => text(item, label, maximum))
  if (new Set(result).size !== result.length) throw new Error(`${label}不能重复。`)
  return result
}

function optionalStrings(value: unknown, label: string, maximum = 200): string[] | null {
  return value == null ? null : strings(value, label, maximum)
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label}不能重复。`)
}

function profile(value: unknown): InteractionRuntimeProfile {
  if (!isObject(value)) throw new Error('互动角色快照必须是对象。')
  return {
    participantKey: text(value.participantKey, '互动角色 key', 160),
    characterKey: text(value.characterKey, '互动角色实体 key', 160),
    name: text(value.name, '互动角色名称', 240),
    roleLabel: text(value.roleLabel, '互动角色定位', 500),
    voiceRules: text(value.voiceRules, '互动角色语气规则', 8_000),
    maxMemoryEntries: integer(value.maxMemoryEntries, '互动角色记忆上限', 1, 500),
  }
}

function relationshipRule(value: unknown): InteractionRelationshipRule {
  if (!isObject(value)) throw new Error('互动关系规则必须是对象。')
  const dimensionKey = text(value.dimensionKey, '关系规则维度', 160) as InteractionRelationshipRule['dimensionKey']
  if (!['trust', 'closeness', 'wariness', 'respect'].includes(dimensionKey)) {
    throw new Error('关系规则维度无效。')
  }
  const delta = finite(value.delta, '关系规则变化量', -1_000_000, 1_000_000)
  if (delta === 0) throw new Error('关系规则变化量不能为零。')
  return {
    ruleKey: text(value.ruleKey, '关系规则 key', 160),
    label: text(value.label, '关系规则名称', 240),
    playerText: text(value.playerText, '关系规则玩家选项', 1_000),
    fromParticipantKey: text(value.fromParticipantKey, '关系规则来源角色', 160),
    toParticipantKey: text(value.toParticipantKey, '关系规则目标角色', 160),
    dimensionKey,
    delta,
    reason: text(value.reason, '关系规则理由', 2_000),
    significantEventKey: nullableText(value.significantEventKey, '关系规则重大事件', 160),
  }
}

function sceneTemplate(value: unknown): InteractionRuntimeSceneTemplate {
  if (!isObject(value)) throw new Error('互动场景模板必须是对象。')
  const relationshipRules = Array.isArray(value.relationshipRules)
    ? value.relationshipRules.map(relationshipRule)
    : []
  assertUnique(relationshipRules.map(item => item.ruleKey), '互动关系规则 key')
  return {
    sceneKey: text(value.sceneKey, '互动场景 key', 160),
    title: text(value.title, '互动场景标题', 240),
    purpose: text(value.purpose, '互动场景目的', 4_000),
    location: text(value.location, '互动场景地点', 1_000),
    timeLabel: text(value.timeLabel, '互动场景时间', 1_000),
    participantKeys: strings(value.participantKeys, '互动场景参与者', 160),
    publicKnowledgeKeys: strings(value.publicKnowledgeKeys, '公开知识 key', 160),
    goals: strings(value.goals, '互动场景目标', 2_000),
    endingConditions: strings(value.endingConditions, '互动场景结束条件', 2_000),
    safetyBoundaries: strings(value.safetyBoundaries, '互动场景安全边界', 2_000),
    relationshipRules,
    openingNodeKey: nullableText(value.openingNodeKey, '互动场景开场节点', 160),
    endingNodeKey: nullableText(value.endingNodeKey, '互动场景结束节点', 160),
    maxTurns: integer(value.maxTurns, '互动场景最大回合', 1, 10_000),
    directorBudget: integer(value.directorBudget, '互动场景导演预算', 0, 1_000_000),
  }
}

function scene(value: unknown): InteractionRuntimeScene {
  if (!isObject(value)) throw new Error('互动场景状态必须是对象。')
  const template = sceneTemplate(value)
  const status = String(value.status ?? '')
  if (status !== 'active' && status !== 'ended') throw new Error('互动场景状态无效。')
  return {
    ...template,
    sceneId: text(value.sceneId, '互动场景 ID', 200),
    status,
    activeParticipantKeys: strings(value.activeParticipantKeys, '当前参与者', 160),
    startedAtSequence: integer(value.startedAtSequence, '场景开始序号', Number.MIN_SAFE_INTEGER),
    endedAtSequence: value.endedAtSequence == null
      ? null
      : integer(value.endedAtSequence, '场景结束序号', Number.MIN_SAFE_INTEGER),
    playerTurns: integer(value.playerTurns, '场景玩家回合', 0, template.maxTurns),
  }
}

function message(value: unknown): InteractionRuntimeMessage {
  if (!isObject(value)) throw new Error('互动消息必须是对象。')
  const role = String(value.role ?? '')
  if (role !== 'player' && role !== 'character' && role !== 'system') throw new Error('互动消息角色无效。')
  return {
    messageId: text(value.messageId, '互动消息 ID', 200),
    eventSequence: integer(value.eventSequence, '互动消息事件序号', Number.MIN_SAFE_INTEGER),
    role,
    speakerKey: text(value.speakerKey, '互动消息说话者', 160),
    audienceKeys: optionalStrings(value.audienceKeys, '互动消息听众', 160),
    text: text(value.text, '互动消息文本', 20_000),
    replyToSequence: value.replyToSequence == null
      ? null
      : integer(value.replyToSequence, '互动回复目标序号', Number.MIN_SAFE_INTEGER),
    supersededBySequence: value.supersededBySequence == null
      ? null
      : integer(value.supersededBySequence, '互动消息替代序号', Number.MIN_SAFE_INTEGER),
  }
}

function knowledge(value: unknown): InteractionRuntimeKnowledge {
  if (!isObject(value)) throw new Error('互动知识必须是对象。')
  const status = String(value.status ?? '') as RuntimeMemoryStatus
  if (!KNOWLEDGE_STATUSES.has(status)) throw new Error('互动知识状态无效。')
  return {
    knowledgeKey: text(value.knowledgeKey, '互动知识 key', 160),
    participantKey: text(value.participantKey, '互动知识角色', 160),
    content: text(value.content, '互动知识内容', 8_000),
    status,
    importance: integer(value.importance, '互动知识重要度', 0, 100),
    sourceEventSequence: integer(value.sourceEventSequence, '互动知识来源序号', Number.MIN_SAFE_INTEGER),
  }
}

function memory(value: unknown): InteractionRuntimeMemory {
  if (!isObject(value)) throw new Error('互动记忆必须是对象。')
  const kind = String(value.kind ?? '') as InteractionMemoryKind
  const status = String(value.status ?? '') as InteractionRuntimeMemory['status']
  if (!MEMORY_KINDS.has(kind)) throw new Error('互动记忆类型无效。')
  if (!MEMORY_STATUSES.has(status)) throw new Error('互动记忆状态无效。')
  return {
    memoryId: text(value.memoryId, '互动记忆 ID', 200),
    participantKey: text(value.participantKey, '互动记忆角色', 160),
    kind,
    content: text(value.content, '互动记忆内容', 8_000),
    importance: integer(value.importance, '互动记忆重要度', 0, 100),
    sourceEventSequences: strings(value.sourceEventSequences, '互动记忆来源序号')
      .map(item => integer(Number(item), '互动记忆来源序号', Number.MIN_SAFE_INTEGER)),
    evidenceExcerpt: text(value.evidenceExcerpt, '互动记忆证据摘录', 1_000),
    status,
    proposalSequence: integer(value.proposalSequence, '互动记忆提议序号', Number.MIN_SAFE_INTEGER),
    decisionSequence: value.decisionSequence == null
      ? null
      : integer(value.decisionSequence, '互动记忆决定序号', Number.MIN_SAFE_INTEGER),
    supersededByMemoryId: nullableText(value.supersededByMemoryId, '替代记忆 ID', 200),
  }
}

function relationship(value: unknown): InteractionRuntimeRelationship {
  if (!isObject(value)) throw new Error('互动关系必须是对象。')
  const minimum = finite(value.minimum, '关系下限', -1_000_000, 1_000_000)
  const maximum = finite(value.maximum, '关系上限', minimum, 1_000_000)
  return {
    fromParticipantKey: text(value.fromParticipantKey, '关系来源角色', 160),
    toParticipantKey: text(value.toParticipantKey, '关系目标角色', 160),
    dimensionKey: text(value.dimensionKey, '关系维度 key', 160),
    label: text(value.label, '关系维度名称', 240),
    minimum,
    maximum,
    value: finite(value.value, '关系值', minimum, maximum),
    largeChangeThreshold: finite(value.largeChangeThreshold, '关系大幅变化阈值', 0, maximum - minimum),
    lastChangedSequence: integer(value.lastChangedSequence, '关系最后变化序号', Number.MIN_SAFE_INTEGER),
  }
}

function relationshipChange(value: unknown): InteractionRelationshipChange {
  if (!isObject(value)) throw new Error('互动关系历史必须是对象。')
  return {
    eventSequence: integer(value.eventSequence, '关系变化序号', Number.MIN_SAFE_INTEGER),
    fromParticipantKey: text(value.fromParticipantKey, '关系变化来源角色', 160),
    toParticipantKey: text(value.toParticipantKey, '关系变化目标角色', 160),
    dimensionKey: text(value.dimensionKey, '关系变化维度', 160),
    before: finite(value.before, '关系变化前值', -1_000_000, 1_000_000),
    after: finite(value.after, '关系变化后值', -1_000_000, 1_000_000),
    delta: finite(value.delta, '关系变化量', -1_000_000, 1_000_000),
    reason: text(value.reason, '关系变化理由', 2_000),
    ruleKey: text(value.ruleKey, '关系变化规则', 160),
    sourceEventSequence: integer(value.sourceEventSequence, '关系变化来源序号', Number.MIN_SAFE_INTEGER),
    significantEventKey: nullableText(value.significantEventKey, '重大事件 key', 160),
  }
}

function thread(value: unknown): InteractionRuntimeThread {
  if (!isObject(value)) throw new Error('互动线索必须是对象。')
  const status = String(value.status ?? '')
  if (status !== 'open' && status !== 'resolved') throw new Error('互动线索状态无效。')
  return {
    threadKey: text(value.threadKey, '互动线索 key', 160),
    title: text(value.title, '互动线索标题', 1_000),
    status,
    openedSequence: integer(value.openedSequence, '互动线索开启序号', Number.MIN_SAFE_INTEGER),
    resolvedSequence: value.resolvedSequence == null
      ? null
      : integer(value.resolvedSequence, '互动线索解决序号', Number.MIN_SAFE_INTEGER),
  }
}

/** Build the only release-entry projection for character interaction. */
export function createInitialInteractionState(input: {
  playerKey?: string
  profiles: readonly FrozenInteractionCharacterProfile[]
  sceneTemplates: readonly FrozenInteractionSceneTemplate[]
}): CharacterInteractionRuntimeState {
  const playerKey = input.playerKey?.trim() || 'player'
  const profiles: InteractionRuntimeProfile[] = input.profiles.map(item => ({
    participantKey: item.participantKey,
    characterKey: item.characterKey,
    name: item.name,
    roleLabel: item.roleLabel,
    voiceRules: item.voiceRules,
    maxMemoryEntries: item.maxMemoryEntries,
  }))
  const participantKeys = new Set(profiles.map(item => item.participantKey))
  if (participantKeys.has(playerKey)) throw new Error('玩家 key 不能与互动角色重复。')
  const sceneTemplates: InteractionRuntimeSceneTemplate[] = input.sceneTemplates.map(item => ({
    ...structuredClone(item),
    relationshipRules: structuredClone(item.relationshipRules ?? []),
  }))
  const knowledgeByParticipant = new Map<string, InteractionRuntimeKnowledge>()
  const contentByKey = new Map<string, string>()
  const remember = (knowledgeKey: string, targetKey: string, content: string, importance: number) => {
    const knownContent = contentByKey.get(knowledgeKey)
    if (knownContent != null && knownContent !== content) {
      throw new Error(`初始知识 ${knowledgeKey} 内容冲突。`)
    }
    contentByKey.set(knowledgeKey, content)
    const mapKey = `${knowledgeKey}\u0000${targetKey}`
    const current = knowledgeByParticipant.get(mapKey)
    knowledgeByParticipant.set(mapKey, {
      knowledgeKey,
      participantKey: targetKey,
      content,
      status: 'known',
      importance: Math.max(current?.importance ?? 0, importance),
      sourceEventSequence: 0,
    })
  }
  for (const source of input.profiles) {
    for (const seed of source.initialKnowledge) {
      const targets = seed.visibility === 'public'
        ? [playerKey, ...participantKeys]
        : [source.participantKey]
      for (const target of targets) remember(seed.key, target, seed.content, seed.importance)
    }
  }
  const state: CharacterInteractionRuntimeState = {
    schema: 'storyforge.character-interaction',
    version: 1,
    playerKey,
    profiles,
    sceneTemplates,
    activeScene: null,
    sceneHistory: [],
    messages: [],
    knowledge: [...knowledgeByParticipant.values()],
    memories: [],
    relationships: input.profiles.flatMap(item => item.relationshipDimensions.map(dimension => ({
      fromParticipantKey: item.participantKey,
      toParticipantKey: playerKey,
      dimensionKey: dimension.key,
      label: dimension.label,
      minimum: dimension.minimum,
      maximum: dimension.maximum,
      value: dimension.initial,
      largeChangeThreshold: dimension.largeChangeThreshold,
      lastChangedSequence: 0,
    }))),
    relationshipHistory: [],
    threads: [],
    totalPlayerTurns: 0,
    remainingDirectorBudget: 0,
  }
  return parseInteractionState(state)!
}

export function parseInteractionState(value: unknown): CharacterInteractionRuntimeState | null {
  if (value == null) return null
  if (!isObject(value) || value.schema !== 'storyforge.character-interaction' || value.version !== 1) {
    throw new Error('不支持的角色互动状态。')
  }
  if (!Array.isArray(value.profiles) || !Array.isArray(value.sceneTemplates)
    || !Array.isArray(value.sceneHistory) || !Array.isArray(value.messages)
    || !Array.isArray(value.knowledge) || !Array.isArray(value.memories)
    || !Array.isArray(value.relationships) || !Array.isArray(value.relationshipHistory)
    || !Array.isArray(value.threads)) {
    throw new Error('角色互动状态集合无效。')
  }
  const result: CharacterInteractionRuntimeState = {
    schema: 'storyforge.character-interaction',
    version: 1,
    playerKey: text(value.playerKey, '玩家 key', 160),
    profiles: value.profiles.map(profile),
    sceneTemplates: value.sceneTemplates.map(sceneTemplate),
    activeScene: value.activeScene == null ? null : scene(value.activeScene),
    sceneHistory: value.sceneHistory.map(scene),
    messages: value.messages.map(message),
    knowledge: value.knowledge.map(knowledge),
    memories: value.memories.map(memory),
    relationships: value.relationships.map(relationship),
    relationshipHistory: value.relationshipHistory.map(relationshipChange),
    threads: value.threads.map(thread),
    totalPlayerTurns: integer(value.totalPlayerTurns, '互动总玩家回合', 0),
    remainingDirectorBudget: integer(value.remainingDirectorBudget, '互动导演剩余预算', 0),
  }
  assertUnique(result.profiles.map(item => item.participantKey), '互动角色 key')
  assertUnique(result.sceneTemplates.map(item => item.sceneKey), '互动场景模板 key')
  assertUnique(result.messages.map(item => item.messageId), '互动消息 ID')
  assertUnique(result.memories.map(item => item.memoryId), '互动记忆 ID')
  assertUnique(result.threads.map(item => item.threadKey), '互动线索 key')
  assertUnique(result.relationships.map(relationshipKey), '互动关系维度')
  return result
}

function relationshipKey(value: Pick<InteractionRuntimeRelationship, 'fromParticipantKey' | 'toParticipantKey' | 'dimensionKey'>): string {
  return `${value.fromParticipantKey}\u0000${value.toParticipantKey}\u0000${value.dimensionKey}`
}

function payload(event: ProductRuntimeEvent): JsonObject {
  const parsed: unknown = JSON.parse(event.payloadJson)
  if (!isObject(parsed)) throw new Error(`互动事件 ${event.type} 载荷必须是对象。`)
  return parsed
}

function verifyEnvelope(event: ProductRuntimeEvent, body: JsonObject): void {
  const commandId = text(body.commandId, '互动命令 ID', 200)
  const baseSequence = integer(body.baseSequence, '互动命令基线序号', 0)
  const baseStateHash = text(body.baseStateHash, '互动命令状态哈希', 64)
  if (!/^[a-zA-Z0-9._:-]+$/.test(commandId) || !/^[a-f0-9]{64}$/.test(baseStateHash)) {
    throw new Error('互动命令信封无效。')
  }
  if (event.commandId !== commandId || event.baseSequence !== baseSequence
    || event.baseStateHash !== baseStateHash || baseSequence !== event.sequence - 1) {
    throw new Error('互动命令信封与事件位置不一致。')
  }
}

function requireInteraction(state: CharacterInteractionRuntimeState | null): CharacterInteractionRuntimeState {
  if (!state) throw new Error('当前会话没有角色互动状态。')
  return state
}

function requireScene(state: CharacterInteractionRuntimeState): InteractionRuntimeScene {
  if (!state.activeScene || state.activeScene.status !== 'active') throw new Error('当前没有进行中的互动场景。')
  return state.activeScene
}

function requireParticipant(state: CharacterInteractionRuntimeState, participantKey: string): InteractionRuntimeProfile {
  const result = state.profiles.find(item => item.participantKey === participantKey)
  if (!result) throw new Error(`互动角色不存在: ${participantKey}`)
  return result
}

function visibleTo(message: InteractionRuntimeMessage, participantKey: string): boolean {
  return message.speakerKey === participantKey
    || message.audienceKeys == null
    || message.audienceKeys.includes(participantKey)
}

function requireEvidence(
  state: CharacterInteractionRuntimeState,
  participantKey: string,
  sourceEventSequences: number[],
  evidenceExcerpt: string,
): InteractionRuntimeMessage[] {
  if (sourceEventSequences.length === 0) throw new Error('互动事实必须引用至少一条真实消息。')
  const sources = sourceEventSequences.map(sequence => {
    const source = state.messages.find(item => item.eventSequence === sequence)
    if (!source || source.supersededBySequence != null || !visibleTo(source, participantKey)) {
      throw new Error('互动事实引用了不存在、已替代或角色不可见的消息。')
    }
    return source
  })
  if (!sources.some(source => source.text.includes(evidenceExcerpt))) {
    throw new Error('互动事实证据摘录无法在引用消息中验证。')
  }
  return sources
}

function parseAudience(value: unknown, state: CharacterInteractionRuntimeState): string[] | null {
  const audience = optionalStrings(value, '互动消息听众', 160)
  if (audience == null) return null
  for (const key of audience) {
    if (key !== state.playerKey) requireParticipant(state, key)
  }
  return audience
}

function applyKnowledgeDisclosure(input: {
  state: CharacterInteractionRuntimeState
  knowledgeKey: string
  fromParticipantKey: string
  toParticipantKeys: string[]
  sourceEventSequence: number
  evidenceExcerpt: string
  sourceMessage: InteractionRuntimeMessage
}): void {
  const source = input.state.knowledge.find(item => item.knowledgeKey === input.knowledgeKey
    && item.participantKey === input.fromParticipantKey && item.status === 'known')
  if (!source) throw new Error('告知者并不知道要共享的知识。')
  if (input.sourceMessage.speakerKey !== input.fromParticipantKey
    || !input.sourceMessage.text.includes(input.evidenceExcerpt)) {
    throw new Error('知识共享必须引用告知者真实说出的内容。')
  }
  for (const targetKey of input.toParticipantKeys) {
    if (targetKey !== input.state.playerKey) requireParticipant(input.state, targetKey)
    if (!visibleTo(input.sourceMessage, targetKey)) throw new Error(`知识共享消息对接收者不可见: ${targetKey}`)
    const existing = input.state.knowledge.find(item => item.knowledgeKey === input.knowledgeKey
      && item.participantKey === targetKey)
    if (existing) {
      existing.content = source.content
      existing.status = 'known'
      existing.importance = source.importance
      existing.sourceEventSequence = input.sourceEventSequence
    } else {
      input.state.knowledge.push({
        ...source,
        participantKey: targetKey,
        sourceEventSequence: input.sourceEventSequence,
      })
    }
  }
}

export function applyInteractionEvent(
  stateValue: CharacterInteractionRuntimeState | null,
  event: ProductRuntimeEvent,
): CharacterInteractionRuntimeState | null {
  if (!event.type.startsWith('interaction.')) return stateValue
  const state = requireInteraction(stateValue)
  const body = payload(event)
  verifyEnvelope(event, body)

  switch (event.type) {
    case 'interaction.scene.started': {
      if (state.activeScene) throw new Error('结束当前互动场景后才能开始新场景。')
      const sceneId = text(body.sceneId, '互动场景 ID', 200)
      const sceneKey = text(body.sceneKey, '互动场景 key', 160)
      if (state.sceneHistory.some(item => item.sceneId === sceneId)) throw new Error('互动场景 ID 已使用。')
      const template = state.sceneTemplates.find(item => item.sceneKey === sceneKey)
      if (!template) throw new Error(`互动场景模板不存在: ${sceneKey}`)
      for (const participantKey of template.participantKeys) requireParticipant(state, participantKey)
      state.activeScene = {
        ...structuredClone(template),
        sceneId,
        status: 'active',
        activeParticipantKeys: [...template.participantKeys],
        startedAtSequence: event.sequence,
        endedAtSequence: null,
        playerTurns: 0,
      }
      for (const knowledgeKey of template.publicKnowledgeKeys) {
        const sources = state.knowledge.filter(item => item.knowledgeKey === knowledgeKey && item.status === 'known')
        if (!sources.length || new Set(sources.map(item => item.content)).size !== 1) {
          throw new Error(`场景公开知识缺失或内容冲突: ${knowledgeKey}`)
        }
        const source = sources[0]
        for (const participantKey of [state.playerKey, ...template.participantKeys]) {
          const current = state.knowledge.find(item => item.knowledgeKey === knowledgeKey
            && item.participantKey === participantKey)
          if (current) {
            current.content = source.content
            current.status = 'known'
            current.importance = Math.max(current.importance, source.importance)
            current.sourceEventSequence = event.sequence
          } else {
            state.knowledge.push({ ...source, participantKey, sourceEventSequence: event.sequence })
          }
        }
      }
      state.remainingDirectorBudget = template.directorBudget
      break
    }
    case 'interaction.scene.ended': {
      const active = requireScene(state)
      if (text(body.sceneId, '互动场景 ID', 200) !== active.sceneId) throw new Error('互动场景已经变化。')
      text(body.reason, '互动场景结束理由', 2_000)
      active.status = 'ended'
      active.endedAtSequence = event.sequence
      state.sceneHistory.push(structuredClone(active))
      state.activeScene = null
      state.remainingDirectorBudget = 0
      break
    }
    case 'interaction.participant.joined': {
      const active = requireScene(state)
      const participantKey = text(body.participantKey, '加入角色 key', 160)
      requireParticipant(state, participantKey)
      if (active.activeParticipantKeys.includes(participantKey)) throw new Error('角色已经在当前场景中。')
      active.activeParticipantKeys.push(participantKey)
      break
    }
    case 'interaction.participant.left': {
      const active = requireScene(state)
      const participantKey = text(body.participantKey, '离场角色 key', 160)
      if (!active.activeParticipantKeys.includes(participantKey)) throw new Error('角色不在当前场景中。')
      active.activeParticipantKeys = active.activeParticipantKeys.filter(key => key !== participantKey)
      break
    }
    case 'interaction.player.message.committed': {
      const active = requireScene(state)
      if (active.playerTurns >= active.maxTurns) throw new Error('当前互动场景已达到最大玩家回合数。')
      const messageId = text(body.messageId, '互动消息 ID', 200)
      if (state.messages.some(item => item.messageId === messageId)) throw new Error('互动消息 ID 已使用。')
      state.messages.push({
        messageId,
        eventSequence: event.sequence,
        role: 'player',
        speakerKey: state.playerKey,
        audienceKeys: parseAudience(body.audienceKeys, state),
        text: text(body.text, '玩家互动消息', 12_000),
        replyToSequence: null,
        supersededBySequence: null,
      })
      active.playerTurns += 1
      state.totalPlayerTurns += 1
      break
    }
    case 'interaction.character.reply.committed': {
      const active = requireScene(state)
      const speakerKey = text(body.speakerKey, '回复角色 key', 160)
      if (!active.activeParticipantKeys.includes(speakerKey)) throw new Error('回复角色不在当前场景中。')
      const replyToSequence = integer(body.replyToSequence, '回复目标序号', Number.MIN_SAFE_INTEGER, event.sequence - 1)
      const target = state.messages.find(item => item.eventSequence === replyToSequence)
      if (!target || target.supersededBySequence != null || !visibleTo(target, speakerKey)) {
        throw new Error('角色回复目标不存在、已替代或对角色不可见。')
      }
      const messageId = text(body.messageId, '互动消息 ID', 200)
      if (state.messages.some(item => item.messageId === messageId)) throw new Error('互动消息 ID 已使用。')
      const supersedesSequence = body.supersedesSequence == null
        ? null
        : integer(body.supersedesSequence, '替代回复序号', Number.MIN_SAFE_INTEGER, event.sequence - 1)
      const activeReplies = state.messages.filter(item => item.role === 'character'
        && item.speakerKey === speakerKey && item.replyToSequence === replyToSequence
        && item.supersededBySequence == null)
      if (activeReplies.length > 0 && !activeReplies.some(item => item.eventSequence === supersedesSequence)) {
        throw new Error('该角色已有当前回复；重试必须明确替代原回复。')
      }
      if (supersedesSequence != null) {
        const superseded = activeReplies.find(item => item.eventSequence === supersedesSequence)
        if (!superseded) throw new Error('待替代的角色回复无效。')
        superseded.supersededBySequence = event.sequence
      }
      const budgetCost = integer(body.budgetCost ?? 0, '互动回复预算消耗', 0, 1_000_000)
      if (budgetCost > state.remainingDirectorBudget) throw new Error('互动场景导演预算不足。')
      state.remainingDirectorBudget -= budgetCost
      const committed: InteractionRuntimeMessage = {
        messageId,
        eventSequence: event.sequence,
        role: 'character',
        speakerKey,
        audienceKeys: parseAudience(body.audienceKeys, state),
        text: text(body.text, '角色互动回复', 20_000),
        replyToSequence,
        supersededBySequence: null,
      }
      state.messages.push(committed)
      if (body.disclosures != null) {
        if (!Array.isArray(body.disclosures)) throw new Error('角色回复知识披露必须是数组。')
        for (const raw of body.disclosures) {
          if (!isObject(raw)) throw new Error('角色回复知识披露必须是对象。')
          const knowledgeKey = text(raw.knowledgeKey, '披露知识 key', 160)
          const toParticipantKeys = strings(raw.toParticipantKeys, '披露知识接收者', 160)
          if (toParticipantKeys.length === 0) throw new Error('知识披露至少需要一名接收者。')
          applyKnowledgeDisclosure({
            state,
            knowledgeKey,
            fromParticipantKey: speakerKey,
            toParticipantKeys,
            sourceEventSequence: event.sequence,
            evidenceExcerpt: text(raw.evidenceExcerpt, '披露知识证据摘录', 1_000),
            sourceMessage: committed,
          })
        }
      }
      break
    }
    case 'interaction.memory.proposed': {
      const participantKey = text(body.participantKey, '记忆角色 key', 160)
      requireParticipant(state, participantKey)
      const memoryId = text(body.memoryId, '互动记忆 ID', 200)
      if (state.memories.some(item => item.memoryId === memoryId)) throw new Error('互动记忆 ID 已使用。')
      const kind = text(body.kind, '互动记忆类型', 40) as InteractionMemoryKind
      if (!MEMORY_KINDS.has(kind)) throw new Error('互动记忆类型无效。')
      const sourceEventSequences = strings(body.sourceEventSequences, '互动记忆来源序号')
        .map(item => integer(Number(item), '互动记忆来源序号', Number.MIN_SAFE_INTEGER, event.sequence - 1))
      const evidenceExcerpt = text(body.evidenceExcerpt, '互动记忆证据摘录', 1_000)
      requireEvidence(state, participantKey, sourceEventSequences, evidenceExcerpt)
      state.memories.push({
        memoryId,
        participantKey,
        kind,
        content: text(body.content, '互动记忆内容', 8_000),
        importance: integer(body.importance, '互动记忆重要度', 0, 100),
        sourceEventSequences,
        evidenceExcerpt,
        status: 'proposed',
        proposalSequence: event.sequence,
        decisionSequence: null,
        supersededByMemoryId: null,
      })
      break
    }
    case 'interaction.memory.accepted':
    case 'interaction.memory.rejected': {
      const memoryId = text(body.memoryId, '互动记忆 ID', 200)
      const target = state.memories.find(item => item.memoryId === memoryId)
      if (!target || target.status !== 'proposed') throw new Error('待处理的互动记忆提议不存在。')
      if (event.type === 'interaction.memory.accepted') {
        const maxEntries = requireParticipant(state, target.participantKey).maxMemoryEntries
        const activeCount = state.memories.filter(item => item.participantKey === target.participantKey
          && item.status === 'accepted').length
        if (activeCount >= maxEntries) throw new Error('角色持久记忆已达上限，请先替代旧记忆。')
        target.status = 'accepted'
      } else {
        target.status = 'rejected'
      }
      target.decisionSequence = event.sequence
      break
    }
    case 'interaction.memory.superseded': {
      const memoryId = text(body.memoryId, '旧互动记忆 ID', 200)
      const supersededByMemoryId = text(body.supersededByMemoryId, '新互动记忆 ID', 200)
      const target = state.memories.find(item => item.memoryId === memoryId)
      const replacement = state.memories.find(item => item.memoryId === supersededByMemoryId)
      if (!target || target.status !== 'accepted' || !replacement || replacement.status !== 'accepted'
        || target.participantKey !== replacement.participantKey || memoryId === supersededByMemoryId) {
        throw new Error('互动记忆替代关系无效。')
      }
      target.status = 'superseded'
      target.decisionSequence = event.sequence
      target.supersededByMemoryId = supersededByMemoryId
      break
    }
    case 'interaction.knowledge.shared': {
      const knowledgeKey = text(body.knowledgeKey, '共享知识 key', 160)
      const fromParticipantKey = text(body.fromParticipantKey, '知识告知者', 160)
      const toParticipantKeys = strings(body.toParticipantKeys, '知识接收者', 160)
      if (toParticipantKeys.length === 0) throw new Error('知识共享至少需要一名接收者。')
      const sourceEventSequence = integer(body.sourceEventSequence, '知识共享来源序号', Number.MIN_SAFE_INTEGER, event.sequence - 1)
      const evidenceExcerpt = text(body.evidenceExcerpt, '知识共享证据摘录', 1_000)
      const sourceMessages = requireEvidence(state, fromParticipantKey, [sourceEventSequence], evidenceExcerpt)
      const sourceMessage = sourceMessages[0]
      applyKnowledgeDisclosure({
        state,
        knowledgeKey,
        fromParticipantKey,
        toParticipantKeys,
        sourceEventSequence: event.sequence,
        evidenceExcerpt,
        sourceMessage,
      })
      break
    }
    case 'interaction.relationship.changed': {
      const fromParticipantKey = text(body.fromParticipantKey, '关系来源角色', 160)
      const toParticipantKey = text(body.toParticipantKey, '关系目标角色', 160)
      const dimensionKey = text(body.dimensionKey, '关系维度 key', 160)
      requireParticipant(state, fromParticipantKey)
      if (toParticipantKey !== state.playerKey) requireParticipant(state, toParticipantKey)
      const target = state.relationships.find(item => relationshipKey(item)
        === relationshipKey({ fromParticipantKey, toParticipantKey, dimensionKey }))
      if (!target) throw new Error('待变化的关系维度不存在。')
      const delta = finite(body.delta, '关系变化量', -1_000_000, 1_000_000)
      if (delta === 0) throw new Error('关系变化量不能为零。')
      const sourceEventSequence = integer(body.sourceEventSequence, '关系变化来源序号', Number.MIN_SAFE_INTEGER, event.sequence - 1)
      const source = state.messages.find(item => item.eventSequence === sourceEventSequence)
      if (!source || source.supersededBySequence != null || !visibleTo(source, fromParticipantKey)) {
        throw new Error('关系变化缺少该角色可见的真实互动依据。')
      }
      const significantEventKey = nullableText(body.significantEventKey, '重大事件 key', 160)
      if (Math.abs(delta) > target.largeChangeThreshold && !significantEventKey) {
        throw new Error('大幅关系变化必须绑定明确的重大事件。')
      }
      const before = target.value
      const after = Math.min(target.maximum, Math.max(target.minimum, before + delta))
      const actualDelta = after - before
      if (actualDelta === 0) throw new Error('关系值已在边界，当前变化不会产生状态差异。')
      target.value = after
      target.lastChangedSequence = event.sequence
      state.relationshipHistory.push({
        eventSequence: event.sequence,
        fromParticipantKey,
        toParticipantKey,
        dimensionKey,
        before,
        after,
        delta: actualDelta,
        reason: text(body.reason, '关系变化理由', 2_000),
        ruleKey: text(body.ruleKey, '关系变化规则', 160),
        sourceEventSequence,
        significantEventKey,
      })
      break
    }
    case 'interaction.thread.opened': {
      const threadKey = text(body.threadKey, '互动线索 key', 160)
      if (state.threads.some(item => item.threadKey === threadKey)) throw new Error('互动线索 key 已使用。')
      state.threads.push({
        threadKey,
        title: text(body.title, '互动线索标题', 1_000),
        status: 'open',
        openedSequence: event.sequence,
        resolvedSequence: null,
      })
      break
    }
    case 'interaction.thread.resolved': {
      const threadKey = text(body.threadKey, '互动线索 key', 160)
      const target = state.threads.find(item => item.threadKey === threadKey)
      if (!target || target.status !== 'open') throw new Error('待解决的互动线索不存在。')
      text(body.resolution, '互动线索解决说明', 2_000)
      target.status = 'resolved'
      target.resolvedSequence = event.sequence
      break
    }
    default:
      throw new Error(`未知角色互动事件: ${event.type}`)
  }
  return state
}

export interface InteractionVisibilityView {
  participantKey: string
  activeScene: InteractionRuntimeScene | null
  messages: InteractionRuntimeMessage[]
  knowledge: InteractionRuntimeKnowledge[]
  memories: InteractionRuntimeMemory[]
  relationships: InteractionRuntimeRelationship[]
  threads: InteractionRuntimeThread[]
}

export function interactionVisibilityView(
  stateValue: CharacterInteractionRuntimeState,
  participantKey: string,
): InteractionVisibilityView {
  const state = requireInteraction(parseInteractionState(stateValue))
  if (participantKey !== state.playerKey) requireParticipant(state, participantKey)
  return {
    participantKey,
    activeScene: state.activeScene ? structuredClone(state.activeScene) : null,
    messages: state.messages.filter(item => item.supersededBySequence == null && visibleTo(item, participantKey)),
    knowledge: state.knowledge.filter(item => item.participantKey === participantKey && item.status !== 'forgotten'),
    memories: state.memories.filter(item => item.participantKey === participantKey && item.status === 'accepted'),
    relationships: state.relationships.filter(item => item.fromParticipantKey === participantKey),
    threads: state.threads.filter(item => item.status === 'open'),
  }
}

export interface InteractionContextWindow extends InteractionVisibilityView {
  omittedMessageCount: number
  characterCount: number
}

export function buildInteractionContextWindow(
  state: CharacterInteractionRuntimeState,
  participantKey: string,
  options: { maxCharacters?: number; maxRecentMessages?: number } = {},
): InteractionContextWindow {
  const maxCharacters = Math.max(2_000, Math.min(options.maxCharacters ?? 24_000, 100_000))
  const maxRecentMessages = Math.max(4, Math.min(options.maxRecentMessages ?? 32, 200))
  const visible = interactionVisibilityView(state, participantKey)
  const allMessages = visible.messages
  visible.messages = allMessages.slice(-maxRecentMessages)
  visible.memories.sort((left, right) => right.importance - left.importance || left.proposalSequence - right.proposalSequence)
  visible.knowledge.sort((left, right) => right.importance - left.importance || left.knowledgeKey.localeCompare(right.knowledgeKey))
  const result: InteractionContextWindow = {
    ...visible,
    omittedMessageCount: allMessages.length - visible.messages.length,
    characterCount: 0,
  }
  const size = () => JSON.stringify({ ...result, characterCount: 0 }).length
  while (size() > maxCharacters && result.messages.length > 4) {
    result.messages.shift()
    result.omittedMessageCount += 1
  }
  while (size() > maxCharacters && result.knowledge.length > 1) result.knowledge.pop()
  while (size() > maxCharacters && result.relationships.length > 1) result.relationships.pop()
  if (size() > maxCharacters) throw new Error('角色关键记忆与安全上下文超过预算，请调整作者配置。')
  result.characterCount = size()
  return result
}

/**
 * A child SIM starts its own event sequence at 1. Pre-branch references therefore
 * move into a negative, immutable prehistory range so new events cannot collide.
 */
export function rebaseInteractionStateForBranch(
  stateValue: CharacterInteractionRuntimeState,
  parentThroughSequence: number,
): CharacterInteractionRuntimeState {
  const state = requireInteraction(parseInteractionState(stateValue))
  const rebase = (sequence: number | null): number | null => {
    if (sequence == null || sequence <= 0) return sequence
    if (sequence > parentThroughSequence) throw new Error('互动分支状态包含目标序号之后的引用。')
    return sequence - parentThroughSequence - 1
  }
  for (const item of state.messages) {
    item.eventSequence = rebase(item.eventSequence)!
    item.replyToSequence = rebase(item.replyToSequence)
    item.supersededBySequence = rebase(item.supersededBySequence)
  }
  for (const item of state.knowledge) item.sourceEventSequence = rebase(item.sourceEventSequence)!
  for (const item of state.memories) {
    item.sourceEventSequences = item.sourceEventSequences.map(sequence => rebase(sequence)!)
    item.proposalSequence = rebase(item.proposalSequence)!
    item.decisionSequence = rebase(item.decisionSequence)
  }
  for (const item of state.relationships) item.lastChangedSequence = rebase(item.lastChangedSequence)!
  for (const item of state.relationshipHistory) {
    item.eventSequence = rebase(item.eventSequence)!
    item.sourceEventSequence = rebase(item.sourceEventSequence)!
  }
  for (const item of state.threads) {
    item.openedSequence = rebase(item.openedSequence)!
    item.resolvedSequence = rebase(item.resolvedSequence)
  }
  const scenes = [...state.sceneHistory, ...(state.activeScene ? [state.activeScene] : [])]
  for (const item of scenes) {
    item.startedAtSequence = rebase(item.startedAtSequence)!
    item.endedAtSequence = rebase(item.endedAtSequence)
  }
  return state
}
