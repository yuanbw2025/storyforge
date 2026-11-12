import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEXT_OPEN_WORLD_PLAYER_PREFERENCES_V1 as defaults,
  createTextOpenWorldPlayerPreferencesStoreV1,
  readTextOpenWorldPlayerPreferencesV1,
  textOpenWorldPlayerPreferencesStorageKeyV1,
  type TextOpenWorldPlayerPreferencesStorageV1,
} from '../../src/lib/open-world/player-preferences'

type StorageMode = 'available' | 'disabled' | 'set-fails' | 'all-fail'

function storageFixture(mode: StorageMode): TextOpenWorldPlayerPreferencesStorageV1 | null {
  if (mode === 'disabled') return null
  const rows = new Map<string, string>()
  return {
    getItem(key) {
      if (mode === 'all-fail') throw new DOMException('blocked', 'SecurityError')
      return rows.get(key) ?? (mode === 'set-fails' ? JSON.stringify({ ...defaults, fontSizePx: 20, volume: 0.7 }) : null)
    },
    setItem(key, value) {
      if (mode !== 'available') throw new DOMException('full', 'QuotaExceededError')
      rows.set(key, value)
    },
    removeItem(key) {
      if (mode === 'all-fail') throw new DOMException('blocked', 'SecurityError')
      rows.delete(key)
    },
  }
}

describe('SFQA-070 · player preference partial writes retain the current snapshot', () => {
  it.each<StorageMode>(['available', 'disabled', 'set-fails', 'all-fail'])('%s: controls retain earlier choices and reset together', mode => {
    const scope = { productionKey: `sfqa070.${mode}`, userId: 'player-one' }
    const options = { storage: storageFixture(mode) }
    const store = createTextOpenWorldPlayerPreferencesStoreV1(scope, options)
    const shell = createTextOpenWorldPlayerPreferencesStoreV1(scope, options)
    const unsubscribe = [store.subscribe(() => undefined), shell.subscribe(() => undefined)]
    try {
      store.write({ fontSizePx: 26 })
      store.write({ lineHeight: 2.2 })
      store.write({ highContrast: true })
      store.write({ reducedMotion: true })
      store.write({ volume: 0.35 })
      const result = store.write({ muted: true })
      expect(result).toEqual({ ...defaults, fontSizePx: 26, lineHeight: 2.2, highContrast: true, reducedMotion: true, volume: 0.35, muted: true })
      expect(shell.getSnapshot()).toEqual(result)
      expect(Object.isFrozen(result)).toBe(true)
      if (mode === 'available') expect(readTextOpenWorldPlayerPreferencesV1(scope, options)).toEqual(result)
      else expect(readTextOpenWorldPlayerPreferencesV1(scope, options)).not.toEqual(result)
      expect(store.reset()).toEqual(defaults)
      expect(shell.getSnapshot()).toEqual(defaults)
    } finally {
      unsubscribe.forEach(stop => stop())
    }
  })

  it('rejects unknown fields and non-finite values before changing the current snapshot or persisting', () => {
    let writes = 0
    const store = createTextOpenWorldPlayerPreferencesStoreV1({ productionKey: 'sfqa070.validation' }, {
      storage: { getItem: () => null, setItem: () => { writes += 1 }, removeItem: () => undefined },
    })
    store.write({ fontSizePx: 25 })
    const before = store.getSnapshot()
    for (const patch of [{ apiKey: 'invalid-field' }, { volume: Number.NaN }, { lineHeight: Infinity }, { muted: undefined }]) {
      expect(() => store.write(patch as never)).toThrow(/patch/)
      expect(store.getSnapshot()).toBe(before)
    }
    expect(writes).toBe(1)
  })

  it('retains the snapshot without an active subscriber or persistence', () => {
    const store = createTextOpenWorldPlayerPreferencesStoreV1({ productionKey: 'sfqa070.no-subscriber' }, { storage: null })
    store.write({ fontSizePx: 28 })
    store.write({ volume: 0.25 })
    expect(store.getSnapshot()).toMatchObject({ fontSizePx: 28, volume: 0.25 })
    expect(store.reset()).toEqual(defaults)
  })

  it('keeps the original product and user owner if the caller mutates its scope object', () => {
    const scope = { productionKey: 'sfqa070.original', userId: 'original-user' }
    const original = { ...scope }
    const options = { storage: storageFixture('available') }
    const store = createTextOpenWorldPlayerPreferencesStoreV1(scope, options)
    store.write({ fontSizePx: 27 })
    scope.productionKey = 'sfqa070.other'
    scope.userId = 'other-user'
    store.write({ volume: 0.4 })
    expect(readTextOpenWorldPlayerPreferencesV1(original, options)).toMatchObject({ fontSizePx: 27, volume: 0.4 })
    expect(readTextOpenWorldPlayerPreferencesV1(scope, options)).toEqual(defaults)
    store.reset()
    expect(readTextOpenWorldPlayerPreferencesV1(original, options)).toEqual(defaults)
  })

  it('refreshes from actual same-owner storage events, including another page clearing preferences', () => {
    const scope = { productionKey: 'sfqa070.storage-event' }
    const key = textOpenWorldPlayerPreferencesStorageKeyV1(scope)
    localStorage.removeItem(key)
    const store = createTextOpenWorldPlayerPreferencesStoreV1(scope)
    const stop = store.subscribe(() => undefined)
    try {
      store.write({ fontSizePx: 26 })
      const external = { ...defaults, fontSizePx: 29, highContrast: true, volume: 0.5 }
      localStorage.setItem(key, JSON.stringify(external))
      window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }))
      expect(store.getSnapshot()).toEqual(external)
      window.dispatchEvent(new StorageEvent('storage', { key: `${key}.other`, storageArea: localStorage }))
      expect(store.getSnapshot()).toEqual(external)
      localStorage.removeItem(key)
      window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }))
      expect(store.getSnapshot()).toEqual(defaults)
    } finally {
      stop()
      localStorage.removeItem(key)
    }
  })
})
