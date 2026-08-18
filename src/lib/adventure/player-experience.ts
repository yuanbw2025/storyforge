import type {
  AdventureActionDefinition,
  AdventureActionHistoryEntry,
  AdventureGameReleaseManifestV1,
  SimulationEvent,
} from '../types'

export interface AdventureActionAvailability {
  action: AdventureActionDefinition
  available: boolean
  reason: string
}

export type AdventureSystemCommand = 'help' | 'status' | 'inventory' | 'skills' | 'quests' | 'history' | 'saves'

export type AdventurePlayerCommandResult =
  | { kind: 'action'; action: AdventureActionDefinition; available: boolean; reason: string }
  | { kind: 'system'; command: AdventureSystemCommand }
  | { kind: 'unknown'; suggestions: string[] }

export interface AdventureTranscriptEntry {
  eventSequence: number
  actionKey: string
  actionLabel: string
  outcome: AdventureActionHistoryEntry['outcome']
  narrative: string
  blocks: AdventureNarrativeBlock[]
  changes: string[]
}

export interface AdventureNarrativeBlock {
  kind: 'narration' | 'dialogue' | 'action' | 'system'
  speaker: string | null
  text: string
}

const SYSTEM_COMMANDS: Record<AdventureSystemCommand, string[]> = {
  help: ['帮助', '命令', 'help', '?'],
  status: ['状态', '属性', '人物', 'status'],
  inventory: ['背包', '物品', '行囊', 'inventory', 'items'],
  skills: ['技能', '能力', 'skills', 'abilities'],
  quests: ['任务', '任务日志', 'quests', 'quest'],
  history: ['记录', '历史', '日志', 'history', 'log'],
  saves: ['存档', '保存', '时间线', 'save', 'saves'],
}

const ACTION_VERBS: Record<AdventureActionDefinition['kind'], string[]> = {
  look: ['观察', '查看', '看看', '环顾', 'look'],
  move: ['前往', '返回', '去', '走到', '移动到', '进入', '离开', 'go', 'move'],
  talk: ['询问', '问', '交谈', '对话', '找', 'talk', 'ask'],
  take: ['取得', '拿取', '拿', '拾取', '捡起', 'take', 'get'],
  give: ['交付', '给予', '给', '递给', 'give'],
  use: ['使用', '用', '启动', '装备', 'use'],
  inspect: ['深入调查', '调查', '查阅', '检查', '阅读', 'inspect', 'read'],
  attempt: ['尝试', '冒险', '强行', 'attempt', 'try'],
  rest: ['休整', '休息', '等待', 'rest'],
  'quest-action': ['终止', '放弃', '撤离', '执行', 'quest'],
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[\s，。！？、；：,.!?;:'"“”‘’（）()【】[\]<>《》·\-_]/g, '')
}

function commandTarget(value: string, kind: AdventureActionDefinition['kind']): string {
  let result = compact(value)
  for (const verb of ACTION_VERBS[kind]) result = result.replace(compact(verb), '')
  return result.replace(/^(我想|我要|我去|请|先|再|一下|这个|那个)+/, '')
}

function matchScore(input: string, action: AdventureActionDefinition): number {
  const normalized = compact(input)
  const label = compact(action.label)
  if (normalized === label) return 120
  if (normalized.includes(label)) return 110
  const target = commandTarget(action.label, action.kind)
  const inputTarget = commandTarget(input, action.kind)
  const verbMatched = ACTION_VERBS[action.kind].some(verb => normalized.includes(compact(verb)))
  if (target.length >= 2 && normalized.includes(target)) return verbMatched ? 100 : 82
  if (inputTarget.length >= 2 && target.includes(inputTarget)) return verbMatched ? 94 : 74
  if (normalized.length >= 2 && label.includes(normalized)) return 68
  return 0
}

export function parseAdventurePlayerCommand(
  input: string,
  actions: AdventureActionAvailability[],
): AdventurePlayerCommandResult {
  const normalized = compact(input.trim())
  if (!normalized) return { kind: 'unknown', suggestions: actions.filter(item => item.available).slice(0, 4).map(item => item.action.label) }

  for (const [command, aliases] of Object.entries(SYSTEM_COMMANDS) as Array<[AdventureSystemCommand, string[]]>) {
    if (aliases.some(alias => compact(alias) === normalized)) return { kind: 'system', command }
  }

  if (/^\d+$/.test(normalized)) {
    const available = actions.filter(item => item.available)
    const selected = available[Number(normalized) - 1]
    if (selected) return { kind: 'action', ...selected }
  }

  const ranked = actions.map(item => ({ item, score: matchScore(input, item.action) }))
    .filter(item => item.score >= 68)
    .sort((left, right) => right.score - left.score || Number(right.item.available) - Number(left.item.available))
  const winner = ranked[0]
  if (winner && (ranked.length === 1 || winner.score > ranked[1].score || winner.item.action.key === ranked[1].item.action.key)) {
    return { kind: 'action', ...winner.item }
  }
  return {
    kind: 'unknown',
    suggestions: actions.filter(item => item.available).slice(0, 5).map(item => item.action.label),
  }
}

function payload(event: SimulationEvent): Record<string, unknown> {
  try {
    const value = JSON.parse(event.payloadJson)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch { return {} }
}

function signed(value: unknown): string {
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0 ? `+${amount}` : String(value)
}

export function parseAdventureNarrativeBlocks(value: string): AdventureNarrativeBlock[] {
  return value.split(/\n+/).map(line => line.trim()).filter(Boolean).map(line => {
    const marked = line.match(/^【([^】]+)】\s*(.+)$/)
    if (marked) {
      const label = marked[1].trim()
      const text = marked[2].trim()
      if (label === '系统') return { kind: 'system' as const, speaker: null, text }
      if (label === '行动') return { kind: 'action' as const, speaker: null, text }
      return { kind: 'dialogue' as const, speaker: label, text }
    }
    const quoted = line.match(/^([^：:]{1,16})[：:]\s*[“"](.+)[”"]$/)
    if (quoted) return { kind: 'dialogue' as const, speaker: quoted[1].trim(), text: quoted[2].trim() }
    return { kind: 'narration' as const, speaker: null, text: line }
  })
}

function eventChange(event: SimulationEvent, manifest: AdventureGameReleaseManifestV1): string | null {
  const body = payload(event)
  const adventure = manifest.adventure
  if (event.type === 'adventure.location.entered') {
    const location = adventure.locations.find(item => item.key === body.locationKey)
    return `抵达：${location?.title ?? String(body.locationKey ?? '')}`
  }
  if (event.type === 'adventure.item.gained') {
    const item = adventure.items.find(value => value.key === body.itemKey)
    return `获得：${item?.title ?? String(body.itemKey ?? '')} ×${body.quantity}`
  }
  if (event.type === 'adventure.item.used') {
    const item = adventure.items.find(value => value.key === body.itemKey)
    return `消耗：${item?.title ?? String(body.itemKey ?? '')} ×${body.quantity}`
  }
  if (event.type === 'adventure.item.transferred') {
    const item = adventure.items.find(value => value.key === body.itemKey)
    return `交付：${item?.title ?? String(body.itemKey ?? '')} ×${body.quantity}`
  }
  if (event.type === 'adventure.item.state-changed') {
    const item = adventure.items.find(value => value.key === body.itemKey)
    return `${body.state === 'equipped' ? '装备' : '收起'}：${item?.title ?? String(body.itemKey ?? '')}`
  }
  if (event.type === 'adventure.resource.changed') {
    const definition = adventure.resources.find(item => item.key === body.resourceKey)
    return `${definition?.title ?? String(body.resourceKey ?? '')} ${signed(body.delta)}（${body.after}）`
  }
  if (event.type === 'adventure.ability.changed') {
    const definition = adventure.abilities.find(item => item.key === body.abilityKey)
    return `${definition?.title ?? String(body.abilityKey ?? '')} ${signed(Number(body.after) - Number(body.before))}（${body.after}）`
  }
  if (event.type === 'adventure.condition.applied' || event.type === 'adventure.condition.removed') {
    const definition = adventure.conditions.find(item => item.key === body.conditionKey)
    return `${event.type.endsWith('applied') ? '获得状态' : '解除状态'}：${definition?.title ?? String(body.conditionKey ?? '')}`
  }
  if (event.type === 'adventure.quest.accepted' || event.type === 'adventure.quest.completed' || event.type === 'adventure.quest.failed') {
    const quest = adventure.quests.find(item => item.key === body.questKey)
    const verb = event.type.endsWith('accepted') ? '接受任务' : event.type.endsWith('completed') ? '完成任务' : '任务失败'
    return `${verb}：${quest?.title ?? String(body.questKey ?? '')}`
  }
  if (event.type === 'adventure.quest.objective-updated') {
    const quest = adventure.quests.find(item => item.key === body.questKey)
    const objective = quest?.objectives.find(item => item.key === body.objectiveKey)
    return `目标完成：${objective?.title ?? String(body.objectiveKey ?? '')}`
  }
  if (event.type === 'adventure.check.resolved') {
    const evidence = body.evidence && typeof body.evidence === 'object' ? body.evidence as Record<string, unknown> : {}
    const ability = adventure.abilities.find(item => item.key === evidence.abilityKey)
    const outcome = evidence.outcome === 'success' ? '成功' : evidence.outcome === 'costly-success' ? '付出代价后成功' : evidence.outcome === 'failure' ? '失败' : '条件不足'
    return `${ability?.title ?? '行动'}判定：${evidence.total}/${evidence.difficulty} · ${outcome}`
  }
  if (event.type === 'interaction.relationship.changed') {
    const profile = manifest.interaction.profiles.find(item => item.participantKey === body.fromParticipantKey)
      ?? manifest.interaction.profiles.find(item => item.participantKey === body.toParticipantKey)
    const dimension = profile?.relationshipDimensions.find(item => item.key === body.dimensionKey)
    return `${profile?.name ?? '人物'}${dimension?.label ?? '关系'} ${signed(body.delta)}`
  }
  return null
}

export function projectAdventureTranscript(
  manifest: AdventureGameReleaseManifestV1,
  history: AdventureActionHistoryEntry[],
  events: SimulationEvent[],
): AdventureTranscriptEntry[] {
  let previousActionSequence = 0
  return history.map(action => {
    const changes = events
      .filter(event => event.sequence > previousActionSequence && event.sequence <= action.eventSequence)
      .map(event => eventChange(event, manifest))
      .filter((value): value is string => value != null)
    previousActionSequence = action.eventSequence
    return {
      eventSequence: action.eventSequence,
      actionKey: action.actionKey,
      actionLabel: manifest.adventure.actions.find(item => item.key === action.actionKey)?.label ?? action.actionKey,
      outcome: action.outcome,
      narrative: action.narrative,
      blocks: parseAdventureNarrativeBlocks(action.narrative),
      changes,
    }
  })
}
