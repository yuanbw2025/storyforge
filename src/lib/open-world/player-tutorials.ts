/**
 * Browser-local tutorial progress and a disclosure-safe tutorial projection.
 *
 * Progress is presentation state. It never enters a ProductRelease, Session,
 * Event, Checkpoint, project export, prompt, or credential record.
 */

export const TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_SCHEMA_V1 =
  'storyforge.text-open-world.player-tutorial-progress' as const

export const TEXT_OPEN_WORLD_PLAYER_TUTORIAL_STORAGE_PREFIX_V1 =
  'storyforge:text-open-world:player-tutorial-progress:v1' as const

export const TEXT_OPEN_WORLD_PLAYER_TUTORIAL_LIMITS_V1 = Object.freeze({
  maximumTrackedStepKeys: 256,
  maximumStepKeyLength: 160,
  maximumAuthoredTutorials: 128,
  maximumTitleLength: 200,
  maximumBodyLength: 2_000,
})

export type TextOpenWorldPlayerTutorialRuntimeChannelV1 = 'release' | 'build-preview'

export interface TextOpenWorldPlayerTutorialScopeV1 {
  /** Stable product family. Progress intentionally spans Releases and Sessions. */
  productionKey: string
  /** Build Preview is intentionally isolated from formally released play. */
  runtimeChannel: TextOpenWorldPlayerTutorialRuntimeChannelV1
  /** Optional signed-in player identity; omission is this browser's local profile. */
  userId?: string | null
}

export interface TextOpenWorldPlayerTutorialProgressV1 {
  schema: typeof TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_SCHEMA_V1
  version: 1
  completedStepKeys: readonly string[]
  skippedStepKeys: readonly string[]
  suppressAutomatic: boolean
}

export interface TextOpenWorldPlayerTutorialStorageV1 {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface TextOpenWorldPlayerTutorialStoreOptionsV1 {
  /** Injected for tests or non-browser hosts. null explicitly disables persistence. */
  storage?: TextOpenWorldPlayerTutorialStorageV1 | null
}

export interface TextOpenWorldPlayerTutorialStoreV1 {
  /** Stable between changes; suitable for React useSyncExternalStore. */
  getSnapshot(): Readonly<TextOpenWorldPlayerTutorialProgressV1>
  getServerSnapshot(): Readonly<TextOpenWorldPlayerTutorialProgressV1>
  subscribe(listener: () => void): () => void
  complete(stepKey: string): Readonly<TextOpenWorldPlayerTutorialProgressV1>
  skip(stepKey: string): Readonly<TextOpenWorldPlayerTutorialProgressV1>
  setSuppress(suppressAutomatic: boolean): Readonly<TextOpenWorldPlayerTutorialProgressV1>
  reset(): Readonly<TextOpenWorldPlayerTutorialProgressV1>
  refresh(): Readonly<TextOpenWorldPlayerTutorialProgressV1>
}

export type TextOpenWorldTutorialFeatureV1 =
  | 'scene'
  | 'system-actions'
  | 'fixed-choices'
  | 'natural-input'
  | 'quests'
  | 'map-travel'
  | 'character'
  | 'skills'
  | 'combat'
  | 'inventory-equipment'
  | 'crafting'
  | 'shop'
  | 'relationships'
  | 'world-status'
  | 'formal-save'
  | 'settings-help'

export type TextOpenWorldTutorialTargetUiKeyV1 =
  | 'play.scene'
  | 'play.system-actions'
  | 'play.fixed-choices'
  | 'play.natural-language'
  | 'overlay.map'
  | 'overlay.quest-log'
  | 'overlay.character'
  | 'overlay.skills'
  | 'overlay.inventory'
  | 'overlay.equipment'
  | 'overlay.crafting'
  | 'overlay.shop'
  | 'overlay.combat'
  | 'overlay.relationships'
  | 'overlay.world-status'
  | 'system.save-branches'
  | 'system.settings-help'

export type TextOpenWorldTutorialTargetViewV1 = 'scene' | 'map' | 'quests' | 'character' | 'more'

export interface TextOpenWorldTutorialStepV1 {
  key: string
  source: 'system' | 'authored'
  title: string
  body: string
  /** Caller-provided runtime truth. The projector never infers feature availability. */
  feature: TextOpenWorldTutorialFeatureV1
  targetUiKey: TextOpenWorldTutorialTargetUiKeyV1
  targetView: TextOpenWorldTutorialTargetViewV1
  /** Completion is always an explicit player acknowledgement in v1. */
  completion: Readonly<{ kind: 'acknowledge' }>
  /** Present only for an authored tutorial whose action is currently available. */
  triggerActionKey: string | null
}

export interface TextOpenWorldProjectedTutorialStepV1 extends TextOpenWorldTutorialStepV1 {
  status: 'pending' | 'completed' | 'skipped'
}

export interface TextOpenWorldAuthoredTutorialV1 {
  key: string
  triggerActionKey: string
  targetUiKey: string
  title: string
  body: string
}

export interface TextOpenWorldPlayerTutorialProjectionV1 {
  steps: readonly Readonly<TextOpenWorldProjectedTutorialStepV1>[]
  automaticStep: Readonly<TextOpenWorldProjectedTutorialStepV1> | null
  /** Frozen rows this client cannot safely present; temporarily unavailable Actions are excluded. */
  incompatibleAuthoredTutorialCount: number
}

export interface ProjectTextOpenWorldPlayerTutorialsInputV1 {
  progress: unknown
  /** Product/player capability used to keep help entries available for replay. */
  featureSupport?: Readonly<Partial<Record<TextOpenWorldTutorialFeatureV1, boolean>>>
  /** Current runtime timing only; it gates automatic prompts, not help retention. */
  featureAvailability: Readonly<Partial<Record<TextOpenWorldTutorialFeatureV1, boolean>>>
  /** Must come from the current deterministic Action projection, not the package catalog. */
  availableActionKeys: readonly string[]
  /** Frozen Presentation v2 tutorials. Invalid or unknown targets fail closed by omission. */
  authoredTutorials?: readonly TextOpenWorldAuthoredTutorialV1[]
}

const PROGRESS_KEYS = [
  'schema',
  'version',
  'completedStepKeys',
  'skippedStepKeys',
  'suppressAutomatic',
] as const

const DEFAULT_PROGRESS_VALUE: TextOpenWorldPlayerTutorialProgressV1 = {
  schema: TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_SCHEMA_V1,
  version: 1,
  completedStepKeys: Object.freeze([]),
  skippedStepKeys: Object.freeze([]),
  suppressAutomatic: false,
}

export const DEFAULT_TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_V1:
Readonly<TextOpenWorldPlayerTutorialProgressV1> = Object.freeze(DEFAULT_PROGRESS_VALUE)

const ACKNOWLEDGE = Object.freeze({ kind: 'acknowledge' as const })

interface TutorialTargetDefinitionV1 {
  feature: TextOpenWorldTutorialFeatureV1
  targetView: TextOpenWorldTutorialTargetViewV1
}

const TARGET_DEFINITIONS: Readonly<Record<TextOpenWorldTutorialTargetUiKeyV1, TutorialTargetDefinitionV1>> =
  Object.freeze({
    'play.scene': { feature: 'scene', targetView: 'scene' },
    'play.system-actions': { feature: 'system-actions', targetView: 'scene' },
    'play.fixed-choices': { feature: 'fixed-choices', targetView: 'scene' },
    'play.natural-language': { feature: 'natural-input', targetView: 'scene' },
    'overlay.map': { feature: 'map-travel', targetView: 'map' },
    'overlay.quest-log': { feature: 'quests', targetView: 'quests' },
    'overlay.character': { feature: 'character', targetView: 'character' },
    'overlay.skills': { feature: 'skills', targetView: 'character' },
    'overlay.inventory': { feature: 'inventory-equipment', targetView: 'more' },
    'overlay.equipment': { feature: 'inventory-equipment', targetView: 'more' },
    'overlay.crafting': { feature: 'crafting', targetView: 'more' },
    'overlay.shop': { feature: 'shop', targetView: 'more' },
    'overlay.combat': { feature: 'combat', targetView: 'scene' },
    'overlay.relationships': { feature: 'relationships', targetView: 'more' },
    'overlay.world-status': { feature: 'world-status', targetView: 'more' },
    'system.save-branches': { feature: 'formal-save', targetView: 'more' },
    'system.settings-help': { feature: 'settings-help', targetView: 'more' },
  })

const TARGET_ALIASES: Readonly<Record<string, TextOpenWorldTutorialTargetUiKeyV1>> = Object.freeze({
  'ui.action-panel': 'play.system-actions',
})

function systemStep(input: Omit<TextOpenWorldTutorialStepV1, 'source' | 'completion' | 'triggerActionKey'>):
Readonly<TextOpenWorldTutorialStepV1> {
  return Object.freeze({
    ...input,
    source: 'system' as const,
    completion: ACKNOWLEDGE,
    triggerActionKey: null,
  })
}

export const TEXT_OPEN_WORLD_SYSTEM_TUTORIAL_STEPS_V1:
readonly Readonly<TextOpenWorldTutorialStepV1>[] = Object.freeze([
  systemStep({
    key: 'system.opening', title: '从当前场景开始',
    body: '先阅读场景、地点与当前任务提示；教程只解释已经开放的功能。',
    feature: 'scene', targetUiKey: 'play.scene', targetView: 'scene',
  }),
  systemStep({
    key: 'system.system-actions', title: '使用系统行动',
    body: '系统行动列出此刻能够尝试的确定性操作；点击后仍会由当前状态与规则再次校验。',
    feature: 'system-actions', targetUiKey: 'play.system-actions', targetView: 'scene',
  }),
  systemStep({
    key: 'system.fixed-choices', title: '选择固定选项',
    body: '固定选项是当前场景预先设计的表达入口，与对应系统行动进入同一结算规则。',
    feature: 'fixed-choices', targetUiKey: 'play.fixed-choices', targetView: 'scene',
  }),
  systemStep({
    key: 'system.natural-input', title: '使用自然语言',
    body: '自然语言会映射为当前已开放的确定性行动；无法识别时不会凭空改写世界。',
    feature: 'natural-input', targetUiKey: 'play.natural-language', targetView: 'scene',
  }),
  systemStep({
    key: 'system.quests', title: '查看任务',
    body: '任务页显示主追踪、钉选任务、目标、时限与已知地点。',
    feature: 'quests', targetUiKey: 'overlay.quest-log', targetView: 'quests',
  }),
  systemStep({
    key: 'system.map-travel', title: '地图与旅行',
    body: '在地图中选择已知且可达的地点；旅行结果由当前规则与状态校验。',
    feature: 'map-travel', targetUiKey: 'overlay.map', targetView: 'map',
  }),
  systemStep({
    key: 'system.combat', title: '回合战斗',
    body: '战斗中只执行面板列出的技能、道具、继续战斗或逃跑行动。',
    feature: 'combat', targetUiKey: 'overlay.combat', targetView: 'scene',
  }),
  systemStep({
    key: 'system.inventory-equipment', title: '背包与装备',
    body: '在背包中查看物品，并通过装备位管理武器、防具与饰品。',
    feature: 'inventory-equipment', targetUiKey: 'overlay.inventory', targetView: 'more',
  }),
  systemStep({
    key: 'system.crafting', title: '制作',
    body: '制作页只展示已经学会且当前条件允许使用的配方。',
    feature: 'crafting', targetUiKey: 'overlay.crafting', targetView: 'more',
  }),
  systemStep({
    key: 'system.shop', title: '商店',
    body: '商店库存、价格和可交易数量由当前地点、关系与资源共同决定。',
    feature: 'shop', targetUiKey: 'overlay.shop', targetView: 'more',
  }),
  systemStep({
    key: 'system.formal-save', title: '正式保存与分支',
    body: '手动档、自动档和时间线分支都绑定当前正式游戏版本。',
    feature: 'formal-save', targetUiKey: 'system.save-branches', targetView: 'more',
  }),
])

interface TutorialSubscriptionV1 {
  storage: TextOpenWorldPlayerTutorialStorageV1 | null
  listener(progress: Readonly<TextOpenWorldPlayerTutorialProgressV1>, persisted: boolean): void
}

const subscriptionsByStorageKey = new Map<string, Set<TutorialSubscriptionV1>>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index])
}

function looksLikeCredential(value: string): boolean {
  return /(?:^|[.:_-])(?:bearer[\s:._-]|sk-(?:proj-|live-|test-)?|api[_-]?key(?:$|[\s:._=-])|access[_-]?token(?:$|[\s:._=-]))/i
    .test(value)
}

function isTutorialStepKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 3
    && value.length <= TEXT_OPEN_WORLD_PLAYER_TUTORIAL_LIMITS_V1.maximumStepKeyLength
    && /^(?:system|authored)\.[A-Za-z0-9](?:[A-Za-z0-9._:-]*[A-Za-z0-9])?$/.test(value)
    && !looksLikeCredential(value)
}

function isRuntimeKey(value: unknown, maximum = 200): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= maximum
    && /^[A-Za-z0-9](?:[A-Za-z0-9._:-]*[A-Za-z0-9])?$/.test(value)
    && !looksLikeCredential(value)
}

function frozenProgress(input: {
  completedStepKeys: readonly string[]
  skippedStepKeys: readonly string[]
  suppressAutomatic: boolean
}): Readonly<TextOpenWorldPlayerTutorialProgressV1> {
  return Object.freeze({
    schema: TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_SCHEMA_V1,
    version: 1 as const,
    completedStepKeys: Object.freeze([...input.completedStepKeys].sort()),
    skippedStepKeys: Object.freeze([...input.skippedStepKeys].sort()),
    suppressAutomatic: input.suppressAutomatic,
  })
}

/** Strict schema/version/key/type parser. Invalid or credential-shaped rows return null. */
export function parseTextOpenWorldPlayerTutorialProgressV1(
  value: unknown,
): Readonly<TextOpenWorldPlayerTutorialProgressV1> | null {
  if (!isRecord(value) || !hasExactKeys(value, PROGRESS_KEYS)
    || value.schema !== TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_SCHEMA_V1
    || value.version !== 1
    || !Array.isArray(value.completedStepKeys)
    || !Array.isArray(value.skippedStepKeys)
    || typeof value.suppressAutomatic !== 'boolean') return null
  const completed = value.completedStepKeys
  const skipped = value.skippedStepKeys
  if (completed.length + skipped.length
      > TEXT_OPEN_WORLD_PLAYER_TUTORIAL_LIMITS_V1.maximumTrackedStepKeys
    || !completed.every(isTutorialStepKey)
    || !skipped.every(isTutorialStepKey)
    || new Set(completed).size !== completed.length
    || new Set(skipped).size !== skipped.length) return null
  const completedSet = new Set(completed)
  if (skipped.some(key => completedSet.has(key))) return null
  return frozenProgress({
    completedStepKeys: completed,
    skippedStepKeys: skipped,
    suppressAutomatic: value.suppressAutomatic,
  })
}

function validateScopeSegment(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256
    || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`[text-open-world-player-tutorials] ${label}无效`)
  }
  return encodeURIComponent(value)
}

/** Key excludes Release and Session identity so one product family shares progress. */
export function textOpenWorldPlayerTutorialStorageKeyV1(
  scope: TextOpenWorldPlayerTutorialScopeV1,
): string {
  const productionKey = validateScopeSegment(scope?.productionKey, 'productionKey')
  if (scope?.runtimeChannel !== 'release' && scope?.runtimeChannel !== 'build-preview') {
    throw new Error('[text-open-world-player-tutorials] runtimeChannel无效')
  }
  const userScope = scope.userId === undefined || scope.userId === null
    ? '0'
    : `1:${validateScopeSegment(scope.userId, 'userId')}`
  return `${TEXT_OPEN_WORLD_PLAYER_TUTORIAL_STORAGE_PREFIX_V1}:product:${productionKey}:channel:${scope.runtimeChannel}:user:${userScope}`
}

function resolveStorage(
  options: TextOpenWorldPlayerTutorialStoreOptionsV1,
): TextOpenWorldPlayerTutorialStorageV1 | null {
  if (options.storage !== undefined) return options.storage
  if (typeof globalThis === 'undefined') return null
  try {
    return globalThis.localStorage ?? null
  } catch { return null }
}

type StorageReadV1 =
  | { status: 'value'; progress: Readonly<TextOpenWorldPlayerTutorialProgressV1> }
  | { status: 'missing' | 'invalid' | 'unavailable' }

function readStorage(
  storage: TextOpenWorldPlayerTutorialStorageV1 | null,
  key: string,
): StorageReadV1 {
  if (!storage) return { status: 'unavailable' }
  let raw: string | null
  try { raw = storage.getItem(key) } catch { return { status: 'unavailable' } }
  if (raw === null) return { status: 'missing' }
  try {
    const progress = parseTextOpenWorldPlayerTutorialProgressV1(JSON.parse(raw))
    return progress ? { status: 'value', progress } : { status: 'invalid' }
  } catch { return { status: 'invalid' } }
}

export function readTextOpenWorldPlayerTutorialProgressV1(
  scope: TextOpenWorldPlayerTutorialScopeV1,
  options: TextOpenWorldPlayerTutorialStoreOptionsV1 = {},
): Readonly<TextOpenWorldPlayerTutorialProgressV1> {
  const result = readStorage(resolveStorage(options), textOpenWorldPlayerTutorialStorageKeyV1(scope))
  return result.status === 'value' ? result.progress : DEFAULT_TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_V1
}

function sameProgress(
  left: Readonly<TextOpenWorldPlayerTutorialProgressV1>,
  right: Readonly<TextOpenWorldPlayerTutorialProgressV1>,
): boolean {
  return left.suppressAutomatic === right.suppressAutomatic
    && left.completedStepKeys.length === right.completedStepKeys.length
    && left.skippedStepKeys.length === right.skippedStepKeys.length
    && left.completedStepKeys.every((key, index) => key === right.completedStepKeys[index])
    && left.skippedStepKeys.every((key, index) => key === right.skippedStepKeys[index])
}

function usesBrowserLocalStorage(storage: TextOpenWorldPlayerTutorialStorageV1 | null): boolean {
  try {
    return storage !== null && typeof window !== 'undefined' && storage === window.localStorage
  } catch { return false }
}

function broadcast(
  key: string,
  storage: TextOpenWorldPlayerTutorialStorageV1 | null,
  progress: Readonly<TextOpenWorldPlayerTutorialProgressV1>,
  persisted: boolean,
): void {
  for (const subscription of [...(subscriptionsByStorageKey.get(key) ?? [])]) {
    if (subscription.storage !== storage) continue
    try { subscription.listener(progress, persisted) } catch { /* isolate consumers */ }
  }
}

function nextStepState(
  current: Readonly<TextOpenWorldPlayerTutorialProgressV1>,
  stepKey: string,
  destination: 'completed' | 'skipped',
): Readonly<TextOpenWorldPlayerTutorialProgressV1> {
  if (!isTutorialStepKey(stepKey)) {
    throw new Error('[text-open-world-player-tutorials] stepKey无效')
  }
  const completed = new Set(current.completedStepKeys)
  const skipped = new Set(current.skippedStepKeys)
  if (destination === 'completed') {
    completed.add(stepKey)
    skipped.delete(stepKey)
  } else {
    skipped.add(stepKey)
    completed.delete(stepKey)
  }
  if (completed.size + skipped.size > TEXT_OPEN_WORLD_PLAYER_TUTORIAL_LIMITS_V1.maximumTrackedStepKeys) {
    throw new Error('[text-open-world-player-tutorials] 教程进度键数量超限')
  }
  return frozenProgress({
    completedStepKeys: [...completed],
    skippedStepKeys: [...skipped],
    suppressAutomatic: current.suppressAutomatic,
  })
}

/**
 * External-store facade. Failed browser persistence never discards progress
 * already accepted by this mounted instance; a later successful mutation can
 * restore persistence.
 */
export function createTextOpenWorldPlayerTutorialStoreV1(
  scope: TextOpenWorldPlayerTutorialScopeV1,
  options: TextOpenWorldPlayerTutorialStoreOptionsV1 = {},
): TextOpenWorldPlayerTutorialStoreV1 {
  const key = textOpenWorldPlayerTutorialStorageKeyV1(scope)
  const storage = resolveStorage(options)
  const initial = readStorage(storage, key)
  let snapshot = initial.status === 'value'
    ? initial.progress
    : DEFAULT_TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_V1
  let hasUnpersistedMemory = false
  const listeners = new Set<() => void>()
  let channelSubscription: TutorialSubscriptionV1 | null = null
  let onStorage: ((event: StorageEvent) => void) | null = null

  const accept = (next: Readonly<TextOpenWorldPlayerTutorialProgressV1>) => {
    if (sameProgress(snapshot, next)) return
    snapshot = next
    for (const listener of [...listeners]) {
      try { listener() } catch { /* isolate React consumers */ }
    }
  }
  const persist = (next: Readonly<TextOpenWorldPlayerTutorialProgressV1>): boolean => {
    if (!storage) return false
    try {
      storage.setItem(key, JSON.stringify(next))
      return true
    } catch { return false }
  }
  const commit = (next: Readonly<TextOpenWorldPlayerTutorialProgressV1>) => {
    if (sameProgress(snapshot, next)) return snapshot
    const persisted = persist(next)
    hasUnpersistedMemory = !persisted
    accept(next)
    broadcast(key, storage, next, persisted)
    return snapshot
  }
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    if (!channelSubscription) {
      channelSubscription = {
        storage,
        listener: (next, persisted) => {
          hasUnpersistedMemory = !persisted
          accept(next)
        },
      }
      const channel = subscriptionsByStorageKey.get(key) ?? new Set<TutorialSubscriptionV1>()
      channel.add(channelSubscription)
      subscriptionsByStorageKey.set(key, channel)
      if (usesBrowserLocalStorage(storage)) {
        onStorage = event => {
          if (event.key !== null && event.key !== key) return
          if (event.storageArea !== null && event.storageArea !== storage) return
          if (hasUnpersistedMemory) return
          if (event.key === null || event.newValue === null) {
            accept(DEFAULT_TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_V1)
            return
          }
          try {
            const parsed = parseTextOpenWorldPlayerTutorialProgressV1(JSON.parse(event.newValue))
            accept(parsed ?? DEFAULT_TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_V1)
          } catch { accept(DEFAULT_TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_V1) }
        }
        window.addEventListener('storage', onStorage)
      }
    }
    return () => {
      listeners.delete(listener)
      if (listeners.size || !channelSubscription) return
      const channel = subscriptionsByStorageKey.get(key)
      channel?.delete(channelSubscription)
      if (!channel?.size) subscriptionsByStorageKey.delete(key)
      channelSubscription = null
      if (onStorage && usesBrowserLocalStorage(storage)) window.removeEventListener('storage', onStorage)
      onStorage = null
    }
  }
  const complete = (stepKey: string) => commit(nextStepState(snapshot, stepKey, 'completed'))
  const skip = (stepKey: string) => commit(nextStepState(snapshot, stepKey, 'skipped'))
  const setSuppress = (suppressAutomatic: boolean) => {
    if (typeof suppressAutomatic !== 'boolean') {
      throw new Error('[text-open-world-player-tutorials] suppressAutomatic无效')
    }
    return commit(frozenProgress({
      completedStepKeys: snapshot.completedStepKeys,
      skippedStepKeys: snapshot.skippedStepKeys,
      suppressAutomatic,
    }))
  }
  const reset = () => {
    let persisted = storage !== null
    if (storage) {
      try { storage.removeItem(key) } catch { persisted = false }
    }
    hasUnpersistedMemory = !persisted
    accept(DEFAULT_TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_V1)
    broadcast(key, storage, DEFAULT_TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_V1, persisted)
    return snapshot
  }
  const refresh = () => {
    if (hasUnpersistedMemory) return snapshot
    const result = readStorage(storage, key)
    if (result.status === 'value') accept(result.progress)
    else if (result.status === 'missing' || result.status === 'invalid') {
      accept(DEFAULT_TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_V1)
    }
    return snapshot
  }

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => DEFAULT_TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_V1,
    subscribe,
    complete,
    skip,
    setSuppress,
    reset,
    refresh,
  }
}

function normalizeTargetUiKey(value: unknown): TextOpenWorldTutorialTargetUiKeyV1 | null {
  if (typeof value !== 'string') return null
  const normalized = TARGET_ALIASES[value] ?? value
  return Object.prototype.hasOwnProperty.call(TARGET_DEFINITIONS, normalized)
    ? normalized as TextOpenWorldTutorialTargetUiKeyV1
    : null
}

function authoredStep(value: unknown): Readonly<TextOpenWorldTutorialStepV1> | null {
  if (!isRecord(value)
    || !hasExactKeys(value, ['key', 'triggerActionKey', 'targetUiKey', 'title', 'body'])) return null
  if (!isRuntimeKey(value.key, TEXT_OPEN_WORLD_PLAYER_TUTORIAL_LIMITS_V1.maximumStepKeyLength - 9)
    || !isRuntimeKey(value.triggerActionKey)) return null
  const targetUiKey = normalizeTargetUiKey(value.targetUiKey)
  if (!targetUiKey) return null
  const target = TARGET_DEFINITIONS[targetUiKey]
  if (typeof value.title !== 'string' || typeof value.body !== 'string') return null
  const title = value.title.trim().normalize('NFC')
  const body = value.body.trim().normalize('NFC')
  if (!title || title.length > TEXT_OPEN_WORLD_PLAYER_TUTORIAL_LIMITS_V1.maximumTitleLength
    || !body || body.length > TEXT_OPEN_WORLD_PLAYER_TUTORIAL_LIMITS_V1.maximumBodyLength) return null
  const key = `authored.${value.key}`
  if (!isTutorialStepKey(key)) return null
  return Object.freeze({
    key,
    source: 'authored' as const,
    title,
    body,
    feature: target.feature,
    targetUiKey,
    targetView: target.targetView,
    completion: ACKNOWLEDGE,
    triggerActionKey: value.triggerActionKey,
  })
}

/**
 * Pure, fail-closed player projection. Only caller-confirmed features and
 * currently available authored Action triggers can enter the result.
 */
export function projectTextOpenWorldPlayerTutorialsV1(
  input: ProjectTextOpenWorldPlayerTutorialsInputV1,
): Readonly<TextOpenWorldPlayerTutorialProjectionV1> {
  const progress = parseTextOpenWorldPlayerTutorialProgressV1(input.progress)
    ?? DEFAULT_TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_V1
  const availableActionKeys = new Set(
    (Array.isArray(input.availableActionKeys) ? input.availableActionKeys : [])
      .filter(key => isRuntimeKey(key)),
  )
  const isFeatureSupported = (feature: TextOpenWorldTutorialFeatureV1) => (
    input.featureSupport?.[feature] === true || input.featureAvailability?.[feature] === true
  )
  const systemDefinitions = TEXT_OPEN_WORLD_SYSTEM_TUTORIAL_STEPS_V1
    .filter(step => isFeatureSupported(step.feature))
  const introductionKeys = new Set([
    'system.opening',
    'system.system-actions',
    'system.fixed-choices',
  ])
  const introduction = systemDefinitions.filter(step => introductionKeys.has(step.key))
  const remainingSystem = systemDefinitions.filter(step => !introductionKeys.has(step.key))
  const definitions: Readonly<TextOpenWorldTutorialStepV1>[] = [...introduction]
  const seen = new Set(definitions.map(step => step.key))
  const authoredInput = Array.isArray(input.authoredTutorials) ? input.authoredTutorials : []
  let incompatibleAuthoredTutorialCount = Math.max(
    0,
    authoredInput.length - TEXT_OPEN_WORLD_PLAYER_TUTORIAL_LIMITS_V1.maximumAuthoredTutorials,
  )
  const authored = authoredInput
    .slice(0, TEXT_OPEN_WORLD_PLAYER_TUTORIAL_LIMITS_V1.maximumAuthoredTutorials)
  for (const value of authored) {
    const step = authoredStep(value)
    if (!step || seen.has(step.key)) {
      incompatibleAuthoredTutorialCount += 1
      continue
    }
    // A valid frozen tutorial is merely dormant until both its product feature
    // and trigger Action are disclosed. That is not a compatibility failure.
    if (!isFeatureSupported(step.feature)
      || !step.triggerActionKey
      || !availableActionKeys.has(step.triggerActionKey)) continue
    seen.add(step.key)
    definitions.push(step)
  }
  definitions.push(...remainingSystem)
  const completed = new Set(progress.completedStepKeys)
  const skipped = new Set(progress.skippedStepKeys)
  const steps = Object.freeze(definitions.map(step => Object.freeze({
    ...step,
    status: completed.has(step.key)
      ? 'completed' as const
      : skipped.has(step.key) ? 'skipped' as const : 'pending' as const,
  })))
  const automaticStep = progress.suppressAutomatic
    ? null
    : steps.find(step => step.status === 'pending'
      && input.featureAvailability?.[step.feature] === true) ?? null
  return Object.freeze({ steps, automaticStep, incompatibleAuthoredTutorialCount })
}
