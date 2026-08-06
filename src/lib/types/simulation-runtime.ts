import type { NarrativeModuleKind, NarrativeNodeKind } from './narrative-blueprint'

export const SIMULATION_SESSION_KINDS = [
  'sandbox',
  'npc-evolution',
  'ttrpg',
  'chatgame',
  'storygame',
] as const
export type SimulationSessionKind = typeof SIMULATION_SESSION_KINDS[number]

export const SIMULATION_SESSION_STATUSES = ['active', 'paused', 'archived'] as const
export type SimulationSessionStatus = typeof SIMULATION_SESSION_STATUSES[number]

export const RUNTIME_ENTITY_KINDS = [
  'character',
  'npc',
  'player',
  'location',
  'item',
  'faction',
] as const
export type RuntimeEntityKind = typeof RUNTIME_ENTITY_KINDS[number]

export const RUNTIME_LIFECYCLE_STATUSES = [
  'active',
  'inactive',
  'dead',
  'destroyed',
] as const
export type RuntimeLifecycleStatus = typeof RUNTIME_LIFECYCLE_STATUSES[number]

export type RuntimeScalar = string | number | boolean | null
export type RuntimeAttributes = Record<string, RuntimeScalar>

export const SIMULATION_CANON_SOURCE_KINDS = [
  'world',
  'character',
  'location',
  'item',
  'rule',
] as const
export type SimulationCanonSourceKind = typeof SIMULATION_CANON_SOURCE_KINDS[number]

export interface SimulationCanonSource {
  sourceKey: string
  kind: SimulationCanonSourceKind
  /** 审计用原始记录 ID；冻结后不再作为可变 Canon 外键读取。 */
  recordId: number | null
  name: string
  summary: string
  fields: Record<string, string>
  updatedAt: number
  contentHash: string
}

export interface SimulationCanonSnapshotV1 {
  schema: 'storyforge.simulation-canon'
  version: 1
  createdAt: number
  worldGroupId: number | null
  worldLabel: string
  sources: SimulationCanonSource[]
  snapshotHash: string
}

export interface SimulationCanonCandidate {
  sourceKey: string
  kind: SimulationCanonSourceKind
  recordId: number | null
  name: string
  summary: string
  fields: Record<string, string>
  updatedAt: number
}

export interface RuntimeEntityState {
  entityKey: string
  kind: RuntimeEntityKind
  sourceId?: number | null
  name: string
  locationKey?: string | null
  lifecycleStatus: RuntimeLifecycleStatus
  attributes: RuntimeAttributes
}

export type RuntimeMemoryStatus = 'known' | 'mistaken' | 'forgotten'

export interface RuntimeMemory {
  id: string
  subjectKey: string
  status: RuntimeMemoryStatus
  content: string
  sourceEventSequence: number
}

export interface SimulationNpcEvolutionCandidate {
  /** 生成候选时的运行时序号；确认前若会话已继续追加事件则必须重新生成。 */
  baseSequence: number
  entityKey: string
  locationKey: string | null
  lifecycleStatus: RuntimeLifecycleStatus
  /** 只允许写入运行时实体的标量属性补丁。 */
  attributes: RuntimeAttributes
  narrative: string
  memory: {
    status: RuntimeMemoryStatus
    content: string
  } | null
  rationale: string
}

export interface SimulationNpcEvolutionProposal extends SimulationNpcEvolutionCandidate {
  proposalSequence: number
}

export interface SimulationTtrpgScene {
  sceneId: string
  title: string
  description: string
  locationKey: string | null
  status: 'active' | 'resolved'
}

export interface SimulationTtrpgAction {
  eventSequence: number
  actorKey: string
  text: string
}

export interface SimulationTtrpgCheck {
  eventSequence: number
  actorKey: string
  skill: string
  expression: string
  dice: number[]
  modifier: number
  total: number
  dc: number
  success: boolean
}

export interface SimulationTtrpgState {
  scene: SimulationTtrpgScene | null
  round: number
  activeActorKey: string | null
  turnOrder: string[]
  actions: SimulationTtrpgAction[]
  checks: SimulationTtrpgCheck[]
  attacks: SimulationTtrpgAttackResult[]
  encounter: SimulationTtrpgEncounter | null
  /** 长期战役资料；旧跑团存档缺失时按空状态处理。 */
  campaign?: SimulationTtrpgCampaignState | null
}

export interface SimulationTtrpgResource {
  current: number
  maximum: number
}

export interface SimulationTtrpgCondition {
  conditionId: string
  name: string
  description: string
  duration: number | null
  stacks: number
}

export interface SimulationTtrpgCombatant {
  entityKey: string
  initiative: number
  armorClass: number
  resources: Record<string, SimulationTtrpgResource>
  conditions: SimulationTtrpgCondition[]
}

export interface SimulationTtrpgEncounter {
  encounterId: string
  title: string
  description: string
  status: 'active' | 'resolved'
  round: number
  activeActorKey: string | null
  turnOrder: string[]
  combatants: Record<string, SimulationTtrpgCombatant>
}

export interface SimulationTtrpgEncounterCandidate {
  baseSequence: number
  title: string
  description: string
  participantKeys: string[]
}

export interface SimulationTtrpgAttackResult {
  actorKey: string
  targetKey: string
  attackExpression: string
  attackDice: number[]
  attackModifier: number
  attackTotal: number
  armorClass: number
  hit: boolean
  damageExpression: string | null
  damageDice: number[]
  damageModifier: number
  damageTotal: number
  resourceKey: string
  resourceDelta: number
  reason: string
}

export interface SimulationTtrpgCheckRequest {
  skill: string
  expression: string
  dc: number
  reason: string
}

export interface SimulationTtrpgTurnCandidate {
  baseSequence: number
  actorKey: string
  action: string
  narrative: string
  check: SimulationTtrpgCheckRequest | null
  outcomes: {
    success: string
    failure: string
  } | null
  nextActorKey: string | null
}

export const SIMULATION_TTRPG_QUEST_STATUSES = ['active', 'paused', 'completed', 'failed'] as const
export type SimulationTtrpgQuestStatus = typeof SIMULATION_TTRPG_QUEST_STATUSES[number]

export interface SimulationTtrpgQuest {
  questId: string
  title: string
  description: string
  status: SimulationTtrpgQuestStatus
  priority: number
  /** 运行时时钟截止点；null 表示没有期限。 */
  dueClock: number | null
  updatedSequence: number
}

export interface SimulationTtrpgNpcSchedule {
  scheduleId: string
  entityKey: string
  startClock: number
  endClock: number | null
  locationKey: string | null
  activity: string
  recurrence: 'once' | 'daily' | 'weekly'
  updatedSequence: number
}

export interface SimulationTtrpgCampaignState {
  summary: string
  quests: SimulationTtrpgQuest[]
  npcSchedules: SimulationTtrpgNpcSchedule[]
}

export interface SimulationChatIdentity {
  name: string
  description: string
}

export interface SimulationChatScene {
  title: string
  description: string
}

export interface SimulationChatMessage {
  messageId: string
  eventSequence: number
  role: 'user' | 'character'
  speakerKey: string | null
  text: string
  replyToSequence: number | null
  supersededBySequence: number | null
}

export interface SimulationChatState {
  characterKey: string
  identity: SimulationChatIdentity
  scene: SimulationChatScene
  messages: SimulationChatMessage[]
}

export interface SimulationNarrativeNodeSnapshot {
  key: string
  kind: NarrativeNodeKind
  title: string
  summary: string
  conditionJson: string
  effectsJson: string
  successorKeys: string[]
}

export interface SimulationNarrativeState {
  schema: 'storyforge.simulation-narrative'
  version: 1
  sourceModuleId: number | null
  sourceModuleExportId: number | null
  moduleKind: NarrativeModuleKind
  moduleTitle: string
  sourceHash: string
  nodes: SimulationNarrativeNodeSnapshot[]
  currentNodeKey: string | null
  visitedNodeKeys: string[]
  availableNodeKeys: string[]
  variables: Record<string, unknown>
  completed: boolean
}

export interface SimulationRuntimeState {
  version: 1
  clock: number
  entities: Record<string, RuntimeEntityState>
  memories: RuntimeMemory[]
  narratives: Array<{
    eventSequence: number
    text: string
  }>
  /** 旧存档缺少该字段时按 null 处理。 */
  ttrpg?: SimulationTtrpgState | null
  /** 旧存档缺少该字段时按 null 处理。 */
  chat?: SimulationChatState | null
  /** WORLD-2F: frozen executable narrative; legacy sessions default to null. */
  narrative?: SimulationNarrativeState | null
  lastSequence: number
}

export interface SimulationSession {
  id?: number
  projectId: number
  worldGroupId?: number | null
  /** WORLD-2F immutable release binding; legacy sessions may omit it. */
  worldId?: number | null
  workId?: number | null
  worldReleaseId?: number | null
  narrativeModuleId?: number | null
  /** Portable NarrativeModule identity inside an immutable release manifest. */
  narrativeModuleExportId?: number | null
  draftSnapshotHash?: string | null
  kind: SimulationSessionKind
  title: string
  status: SimulationSessionStatus
  rulesetVersion: number
  seed: string
  canonSnapshotJson: string
  initialStateJson: string
  parentSessionId?: number | null
  parentThroughSequence?: number | null
  createdAt: number
  updatedAt: number
}

export const SIMULATION_EVENT_TYPES = [
  'time.advanced',
  'entity.upserted',
  'entity.patched',
  'entity.removed',
  'memory.recorded',
  'random.resolved',
  'narrative.recorded',
  'narrative.node.advanced',
  'npc.evolution.proposed',
  'npc.evolution.accepted',
  'npc.evolution.rejected',
  'ttrpg.scene.opened',
  'ttrpg.action.recorded',
  'ttrpg.check.resolved',
  'ttrpg.gm.response.recorded',
  'ttrpg.turn.advanced',
  'ttrpg.encounter.started',
  'ttrpg.encounter.resolved',
  'ttrpg.combat.attack.resolved',
  'ttrpg.combat.resource.changed',
  'ttrpg.combat.condition.applied',
  'ttrpg.combat.condition.removed',
  'ttrpg.combat.turn.advanced',
  'ttrpg.campaign.summary.updated',
  'ttrpg.campaign.quest.upserted',
  'ttrpg.campaign.schedule.upserted',
  'chat.session.configured',
  'chat.message.recorded',
  'chat.reply.recorded',
] as const
export type SimulationEventType = typeof SIMULATION_EVENT_TYPES[number]

export interface SimulationEvent {
  id?: number
  projectId: number
  worldGroupId?: number | null
  sessionId: number
  sequence: number
  type: SimulationEventType
  actorKey?: string | null
  targetKey?: string | null
  payloadJson: string
  createdAt: number
}

export interface SimulationCheckpoint {
  id?: number
  projectId: number
  worldGroupId?: number | null
  sessionId: number
  throughSequence: number
  name: string
  stateJson: string
  stateHash: string
  createdAt: number
}

export const EMPTY_SIMULATION_STATE: SimulationRuntimeState = {
  version: 1,
  clock: 0,
  entities: {},
  memories: [],
  narratives: [],
  ttrpg: null,
  chat: null,
  narrative: null,
  lastSequence: 0,
}
