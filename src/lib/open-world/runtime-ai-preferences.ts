/**
 * Browser-local consent for optional runtime model calls. It is scoped to one
 * product family and never enters Release, Session, Event, prompt or exports.
 */

export const TEXT_OPEN_WORLD_RUNTIME_AI_PREFERENCES_SCHEMA_V1 =
  'storyforge.text-open-world.runtime-ai-preferences' as const
export const TEXT_OPEN_WORLD_RUNTIME_AI_PREFERENCES_STORAGE_PREFIX_V1 =
  'storyforge:text-open-world:runtime-ai-preferences:v1' as const

export interface TextOpenWorldRuntimeAIPreferencesV1 {
  schema: typeof TEXT_OPEN_WORLD_RUNTIME_AI_PREFERENCES_SCHEMA_V1
  version: 1
  directionEnabled: boolean
}

export interface TextOpenWorldRuntimeAIPreferencesStorageV1 {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface TextOpenWorldRuntimeAIPreferencesStoreV1 {
  getSnapshot(): Readonly<TextOpenWorldRuntimeAIPreferencesV1>
  getServerSnapshot(): Readonly<TextOpenWorldRuntimeAIPreferencesV1>
  subscribe(listener: () => void): () => void
  write(patch: Partial<Pick<TextOpenWorldRuntimeAIPreferencesV1, 'directionEnabled'>>): Readonly<TextOpenWorldRuntimeAIPreferencesV1>
  reset(): Readonly<TextOpenWorldRuntimeAIPreferencesV1>
}

const DEFAULT_VALUE = Object.freeze<TextOpenWorldRuntimeAIPreferencesV1>({
  schema: TEXT_OPEN_WORLD_RUNTIME_AI_PREFERENCES_SCHEMA_V1,
  version: 1,
  directionEnabled: false,
})
const listeners = new Map<string, Set<(value: Readonly<TextOpenWorldRuntimeAIPreferencesV1>) => void>>()

function storageOrNull(
  storage?: TextOpenWorldRuntimeAIPreferencesStorageV1 | null,
): TextOpenWorldRuntimeAIPreferencesStorageV1 | null {
  if (storage !== undefined) return storage
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

function productionSegment(productionKey: string): string {
  if (!productionKey || productionKey !== productionKey.trim() || productionKey.length > 256
    || /[\u0000-\u001f\u007f]/.test(productionKey)) throw new Error('[text-open-world-runtime-ai-preferences] productionKey无效')
  return encodeURIComponent(productionKey)
}

export function textOpenWorldRuntimeAIPreferencesStorageKeyV1(productionKey: string): string {
  return `${TEXT_OPEN_WORLD_RUNTIME_AI_PREFERENCES_STORAGE_PREFIX_V1}:product:${productionSegment(productionKey)}`
}

export function parseTextOpenWorldRuntimeAIPreferencesV1(
  value: unknown,
): Readonly<TextOpenWorldRuntimeAIPreferencesV1> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const keys = Object.keys(source).sort()
  if (keys.length !== 3 || keys.join('|') !== ['directionEnabled', 'schema', 'version'].join('|')
    || source.schema !== TEXT_OPEN_WORLD_RUNTIME_AI_PREFERENCES_SCHEMA_V1
    || source.version !== 1 || typeof source.directionEnabled !== 'boolean') return null
  return Object.freeze({
    schema: TEXT_OPEN_WORLD_RUNTIME_AI_PREFERENCES_SCHEMA_V1,
    version: 1,
    directionEnabled: source.directionEnabled,
  })
}

export function createTextOpenWorldRuntimeAIPreferencesStoreV1(
  productionKey: string,
  options: { storage?: TextOpenWorldRuntimeAIPreferencesStorageV1 | null } = {},
): TextOpenWorldRuntimeAIPreferencesStoreV1 {
  const key = textOpenWorldRuntimeAIPreferencesStorageKeyV1(productionKey)
  const storage = storageOrNull(options.storage)
  const read = () => {
    if (!storage) return DEFAULT_VALUE
    try {
      const raw = storage.getItem(key)
      return raw ? parseTextOpenWorldRuntimeAIPreferencesV1(JSON.parse(raw)) ?? DEFAULT_VALUE : DEFAULT_VALUE
    } catch { return DEFAULT_VALUE }
  }
  let snapshot = read()
  const notify = (next: Readonly<TextOpenWorldRuntimeAIPreferencesV1>) => {
    for (const listener of listeners.get(key) ?? []) listener(next)
  }
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => DEFAULT_VALUE,
    subscribe: listener => {
      const bridge = (value: Readonly<TextOpenWorldRuntimeAIPreferencesV1>) => {
        if (snapshot.directionEnabled === value.directionEnabled) return
        snapshot = value
        listener()
      }
      const bucket = listeners.get(key) ?? new Set()
      bucket.add(bridge)
      listeners.set(key, bucket)
      const refreshed = read()
      if (snapshot.directionEnabled !== refreshed.directionEnabled) {
        snapshot = refreshed
        queueMicrotask(listener)
      }
      return () => {
        bucket.delete(bridge)
        if (!bucket.size) listeners.delete(key)
      }
    },
    write: patch => {
      const next = Object.freeze<TextOpenWorldRuntimeAIPreferencesV1>({
        schema: TEXT_OPEN_WORLD_RUNTIME_AI_PREFERENCES_SCHEMA_V1,
        version: 1,
        directionEnabled: patch.directionEnabled ?? snapshot.directionEnabled,
      })
      try { storage?.setItem(key, JSON.stringify(next)) } catch { /* memory snapshot still updates */ }
      notify(next)
      snapshot = next
      return next
    },
    reset: () => {
      try { storage?.removeItem(key) } catch { /* memory snapshot still resets */ }
      notify(DEFAULT_VALUE)
      snapshot = DEFAULT_VALUE
      return DEFAULT_VALUE
    },
  }
}
