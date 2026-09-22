/**
 * Browser-local presentation and audio preferences for one text-open-world
 * product. These values are UI state: they never enter a ProductRelease,
 * Session, Event, Checkpoint, prompt, export, or API credential record.
 */

export const TEXT_OPEN_WORLD_PLAYER_PREFERENCES_SCHEMA_V1 =
  'storyforge.text-open-world.player-preferences' as const

export const TEXT_OPEN_WORLD_PLAYER_PREFERENCES_STORAGE_PREFIX_V1 =
  'storyforge:text-open-world:player-preferences:v1' as const

export const TEXT_OPEN_WORLD_PLAYER_PREFERENCE_LIMITS_V1 = Object.freeze({
  fontSizePx: Object.freeze({ minimum: 14, maximum: 32 }),
  lineHeight: Object.freeze({ minimum: 1.25, maximum: 2.5 }),
  volume: Object.freeze({ minimum: 0, maximum: 1 }),
})

export interface TextOpenWorldPlayerPreferenceScopeV1 {
  /** Stable product identity. Preferences intentionally span its Releases and Sessions. */
  productionKey: string
  /** Optional signed-in player identity; omission means this browser's local profile. */
  userId?: string | null
}

export interface TextOpenWorldPlayerPreferencesV1 {
  schema: typeof TEXT_OPEN_WORLD_PLAYER_PREFERENCES_SCHEMA_V1
  version: 1
  fontSizePx: number
  lineHeight: number
  highContrast: boolean
  reducedMotion: boolean
  muted: boolean
  volume: number
}

export type TextOpenWorldPlayerPreferencesPatchV1 = Partial<Pick<
  TextOpenWorldPlayerPreferencesV1,
  'fontSizePx' | 'lineHeight' | 'highContrast' | 'reducedMotion' | 'muted' | 'volume'
>>

export interface TextOpenWorldPlayerPreferencesStorageV1 {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface TextOpenWorldPlayerPreferencesOptionsV1 {
  /** Injected for tests or non-browser hosts. null explicitly disables persistence. */
  storage?: TextOpenWorldPlayerPreferencesStorageV1 | null
}

export type TextOpenWorldPlayerPreferencesListenerV1 = (
  preferences: Readonly<TextOpenWorldPlayerPreferencesV1>,
) => void

export interface TextOpenWorldPlayerPreferencesStoreV1 {
  /** Stable between changes, suitable for React useSyncExternalStore. */
  getSnapshot(): Readonly<TextOpenWorldPlayerPreferencesV1>
  /** Deterministic SSR snapshot; browser persistence is read only after hydration. */
  getServerSnapshot(): Readonly<TextOpenWorldPlayerPreferencesV1>
  subscribe(listener: () => void): () => void
  write(patch: TextOpenWorldPlayerPreferencesPatchV1): Readonly<TextOpenWorldPlayerPreferencesV1>
  reset(): Readonly<TextOpenWorldPlayerPreferencesV1>
  refresh(): Readonly<TextOpenWorldPlayerPreferencesV1>
}

const PERSISTED_KEYS = [
  'schema',
  'version',
  'fontSizePx',
  'lineHeight',
  'highContrast',
  'reducedMotion',
  'muted',
  'volume',
] as const

const PATCH_KEYS = new Set<string>([
  'fontSizePx',
  'lineHeight',
  'highContrast',
  'reducedMotion',
  'muted',
  'volume',
])

const DEFAULT_VALUE: TextOpenWorldPlayerPreferencesV1 = {
  schema: TEXT_OPEN_WORLD_PLAYER_PREFERENCES_SCHEMA_V1,
  version: 1,
  fontSizePx: 18,
  lineHeight: 1.9,
  highContrast: false,
  reducedMotion: false,
  muted: false,
  volume: 1,
}

export const DEFAULT_TEXT_OPEN_WORLD_PLAYER_PREFERENCES_V1: Readonly<TextOpenWorldPlayerPreferencesV1> =
  Object.freeze({ ...DEFAULT_VALUE })

interface PreferenceSubscriptionV1 {
  listener: TextOpenWorldPlayerPreferencesListenerV1
  storage: TextOpenWorldPlayerPreferencesStorageV1 | null
}

const listenersByStorageKey = new Map<string, Set<PreferenceSubscriptionV1>>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index])
}

function clamp(value: number, minimum: number, maximum: number): number {
  const clipped = Math.min(maximum, Math.max(minimum, value))
  return Object.is(clipped, -0) ? 0 : clipped
}

function normalizedPreferences(input: {
  fontSizePx: number
  lineHeight: number
  highContrast: boolean
  reducedMotion: boolean
  muted: boolean
  volume: number
}): Readonly<TextOpenWorldPlayerPreferencesV1> {
  return Object.freeze({
    schema: TEXT_OPEN_WORLD_PLAYER_PREFERENCES_SCHEMA_V1,
    version: 1 as const,
    fontSizePx: Math.round(clamp(
      input.fontSizePx,
      TEXT_OPEN_WORLD_PLAYER_PREFERENCE_LIMITS_V1.fontSizePx.minimum,
      TEXT_OPEN_WORLD_PLAYER_PREFERENCE_LIMITS_V1.fontSizePx.maximum,
    )),
    lineHeight: clamp(
      input.lineHeight,
      TEXT_OPEN_WORLD_PLAYER_PREFERENCE_LIMITS_V1.lineHeight.minimum,
      TEXT_OPEN_WORLD_PLAYER_PREFERENCE_LIMITS_V1.lineHeight.maximum,
    ),
    highContrast: input.highContrast,
    reducedMotion: input.reducedMotion,
    muted: input.muted,
    volume: clamp(
      input.volume,
      TEXT_OPEN_WORLD_PLAYER_PREFERENCE_LIMITS_V1.volume.minimum,
      TEXT_OPEN_WORLD_PLAYER_PREFERENCE_LIMITS_V1.volume.maximum,
    ),
  })
}

function defaultPreferences(): Readonly<TextOpenWorldPlayerPreferencesV1> {
  return DEFAULT_TEXT_OPEN_WORLD_PLAYER_PREFERENCES_V1
}

/** Strict schema/version/key/type parsing; finite numeric values are clipped to UI-safe limits. */
export function parseTextOpenWorldPlayerPreferencesV1(
  value: unknown,
): Readonly<TextOpenWorldPlayerPreferencesV1> | null {
  if (!isRecord(value) || !hasExactKeys(value, PERSISTED_KEYS)
    || value.schema !== TEXT_OPEN_WORLD_PLAYER_PREFERENCES_SCHEMA_V1
    || value.version !== 1
    || typeof value.fontSizePx !== 'number' || !Number.isFinite(value.fontSizePx)
    || typeof value.lineHeight !== 'number' || !Number.isFinite(value.lineHeight)
    || typeof value.highContrast !== 'boolean'
    || typeof value.reducedMotion !== 'boolean'
    || typeof value.muted !== 'boolean'
    || typeof value.volume !== 'number' || !Number.isFinite(value.volume)) {
    return null
  }
  return normalizedPreferences({
    fontSizePx: value.fontSizePx,
    lineHeight: value.lineHeight,
    highContrast: value.highContrast,
    reducedMotion: value.reducedMotion,
    muted: value.muted,
    volume: value.volume,
  })
}

function validateScopeSegment(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256
    || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`[text-open-world-player-preferences] ${label}无效`)
  }
  return encodeURIComponent(value)
}

/** The key contains product identity, optional user identity, and no Session/Release identity. */
export function textOpenWorldPlayerPreferencesStorageKeyV1(
  scope: TextOpenWorldPlayerPreferenceScopeV1,
): string {
  const productionKey = validateScopeSegment(scope?.productionKey, 'productionKey')
  const userScope = scope?.userId === undefined || scope.userId === null
    ? '0'
    : `1:${validateScopeSegment(scope.userId, 'userId')}`
  return `${TEXT_OPEN_WORLD_PLAYER_PREFERENCES_STORAGE_PREFIX_V1}:product:${productionKey}:user:${userScope}`
}

function resolveStorage(
  options: TextOpenWorldPlayerPreferencesOptionsV1,
): TextOpenWorldPlayerPreferencesStorageV1 | null {
  if (options.storage !== undefined) return options.storage
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function parseStored(raw: string | null): Readonly<TextOpenWorldPlayerPreferencesV1> | null {
  if (raw === null) return null
  try {
    return parseTextOpenWorldPlayerPreferencesV1(JSON.parse(raw))
  } catch {
    return null
  }
}

export function readTextOpenWorldPlayerPreferencesV1(
  scope: TextOpenWorldPlayerPreferenceScopeV1,
  options: TextOpenWorldPlayerPreferencesOptionsV1 = {},
): Readonly<TextOpenWorldPlayerPreferencesV1> {
  const key = textOpenWorldPlayerPreferencesStorageKeyV1(scope)
  const storage = resolveStorage(options)
  if (!storage) return defaultPreferences()
  try {
    return parseStored(storage.getItem(key)) ?? defaultPreferences()
  } catch {
    return defaultPreferences()
  }
}

function parsePatch(
  current: Readonly<TextOpenWorldPlayerPreferencesV1>,
  value: unknown,
): Readonly<TextOpenWorldPlayerPreferencesV1> {
  if (!isRecord(value) || Object.keys(value).some(key => !PATCH_KEYS.has(key))) {
    throw new Error('[text-open-world-player-preferences] patch字段不精确')
  }
  const own = (key: string) => Object.prototype.hasOwnProperty.call(value, key)
  const fontSizePx = own('fontSizePx') ? value.fontSizePx : current.fontSizePx
  const lineHeight = own('lineHeight') ? value.lineHeight : current.lineHeight
  const highContrast = own('highContrast') ? value.highContrast : current.highContrast
  const reducedMotion = own('reducedMotion') ? value.reducedMotion : current.reducedMotion
  const muted = own('muted') ? value.muted : current.muted
  const volume = own('volume') ? value.volume : current.volume
  if (typeof fontSizePx !== 'number' || !Number.isFinite(fontSizePx)
    || typeof lineHeight !== 'number' || !Number.isFinite(lineHeight)
    || typeof highContrast !== 'boolean'
    || typeof reducedMotion !== 'boolean'
    || typeof muted !== 'boolean'
    || typeof volume !== 'number' || !Number.isFinite(volume)) {
    throw new Error('[text-open-world-player-preferences] patch值无效')
  }
  return normalizedPreferences({
    fontSizePx,
    lineHeight,
    highContrast,
    reducedMotion,
    muted,
    volume,
  })
}

function notify(
  key: string,
  storage: TextOpenWorldPlayerPreferencesStorageV1 | null,
  preferences: Readonly<TextOpenWorldPlayerPreferencesV1>,
): void {
  for (const subscription of [...(listenersByStorageKey.get(key) ?? [])]) {
    if (subscription.storage !== storage) continue
    try { subscription.listener(preferences) } catch { /* one consumer cannot block the others */ }
  }
}

/** Writes an allowed partial update. Unknown fields (including apiKey) fail before persistence. */
export function writeTextOpenWorldPlayerPreferencesV1(
  scope: TextOpenWorldPlayerPreferenceScopeV1,
  patch: TextOpenWorldPlayerPreferencesPatchV1,
  options: TextOpenWorldPlayerPreferencesOptionsV1 = {},
): Readonly<TextOpenWorldPlayerPreferencesV1> {
  const key = textOpenWorldPlayerPreferencesStorageKeyV1(scope)
  const storage = resolveStorage(options)
  const preferences = parsePatch(readTextOpenWorldPlayerPreferencesV1(scope, options), patch)
  if (storage) {
    try { storage.setItem(key, JSON.stringify(preferences)) } catch { /* browser-local persistence is best effort */ }
  }
  notify(key, storage, preferences)
  return preferences
}

export function resetTextOpenWorldPlayerPreferencesV1(
  scope: TextOpenWorldPlayerPreferenceScopeV1,
  options: TextOpenWorldPlayerPreferencesOptionsV1 = {},
): Readonly<TextOpenWorldPlayerPreferencesV1> {
  const key = textOpenWorldPlayerPreferencesStorageKeyV1(scope)
  const storage = resolveStorage(options)
  if (storage) {
    try { storage.removeItem(key) } catch { /* reset still returns safe defaults */ }
  }
  const preferences = defaultPreferences()
  notify(key, storage, preferences)
  return preferences
}

function usesBrowserLocalStorage(storage: TextOpenWorldPlayerPreferencesStorageV1 | null): boolean {
  try {
    return storage !== null && typeof window !== 'undefined' && storage === window.localStorage
  } catch {
    return false
  }
}

/** Same-tab writes notify directly; browser storage events also cover other tabs. */
export function subscribeTextOpenWorldPlayerPreferencesV1(
  scope: TextOpenWorldPlayerPreferenceScopeV1,
  listener: TextOpenWorldPlayerPreferencesListenerV1,
  options: TextOpenWorldPlayerPreferencesOptionsV1 = {},
): () => void {
  const key = textOpenWorldPlayerPreferencesStorageKeyV1(scope)
  const storage = resolveStorage(options)
  const listeners = listenersByStorageKey.get(key) ?? new Set<PreferenceSubscriptionV1>()
  const subscription = { listener, storage }
  listeners.add(subscription)
  listenersByStorageKey.set(key, listeners)

  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== key) return
    if (event.storageArea !== null && event.storageArea !== storage) return
    try { listener(readTextOpenWorldPlayerPreferencesV1(scope, options)) } catch { /* isolate consumer */ }
  }
  if (usesBrowserLocalStorage(storage)) window.addEventListener('storage', onStorage)

  return () => {
    listeners.delete(subscription)
    if (!listeners.size) listenersByStorageKey.delete(key)
    if (usesBrowserLocalStorage(storage)) window.removeEventListener('storage', onStorage)
  }
}

function samePreferences(
  left: Readonly<TextOpenWorldPlayerPreferencesV1>,
  right: Readonly<TextOpenWorldPlayerPreferencesV1>,
): boolean {
  return left.fontSizePx === right.fontSizePx
    && left.lineHeight === right.lineHeight
    && left.highContrast === right.highContrast
    && left.reducedMotion === right.reducedMotion
    && left.muted === right.muted
    && left.volume === right.volume
}

/**
 * Small external-store facade for React. Instantiate once per product/user
 * scope (for example with useMemo), then pass its three snapshot/subscribe
 * methods to useSyncExternalStore.
 */
export function createTextOpenWorldPlayerPreferencesStoreV1(
  scope: TextOpenWorldPlayerPreferenceScopeV1,
  options: TextOpenWorldPlayerPreferencesOptionsV1 = {},
): TextOpenWorldPlayerPreferencesStoreV1 {
  let snapshot = readTextOpenWorldPlayerPreferencesV1(scope, options)
  const listeners = new Set<() => void>()
  let unsubscribeChannel: (() => void) | null = null

  const accept = (next: Readonly<TextOpenWorldPlayerPreferencesV1>) => {
    if (samePreferences(snapshot, next)) return
    snapshot = next
    for (const listener of [...listeners]) {
      try { listener() } catch { /* isolate React consumers */ }
    }
  }
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    if (!unsubscribeChannel) {
      unsubscribeChannel = subscribeTextOpenWorldPlayerPreferencesV1(scope, accept, options)
      snapshot = readTextOpenWorldPlayerPreferencesV1(scope, options)
    }
    return () => {
      listeners.delete(listener)
      if (!listeners.size && unsubscribeChannel) {
        unsubscribeChannel()
        unsubscribeChannel = null
      }
    }
  }
  const write = (patch: TextOpenWorldPlayerPreferencesPatchV1) => {
    accept(writeTextOpenWorldPlayerPreferencesV1(scope, patch, options))
    return snapshot
  }
  const reset = () => {
    accept(resetTextOpenWorldPlayerPreferencesV1(scope, options))
    return snapshot
  }
  const refresh = () => {
    accept(readTextOpenWorldPlayerPreferencesV1(scope, options))
    return snapshot
  }

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => DEFAULT_TEXT_OPEN_WORLD_PLAYER_PREFERENCES_V1,
    subscribe,
    write,
    reset,
    refresh,
  }
}
