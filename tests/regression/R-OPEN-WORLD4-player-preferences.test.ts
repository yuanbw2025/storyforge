import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  DEFAULT_TEXT_OPEN_WORLD_PLAYER_PREFERENCES_V1,
  TEXT_OPEN_WORLD_PLAYER_PREFERENCES_SCHEMA_V1,
  TEXT_OPEN_WORLD_PLAYER_PREFERENCES_STORAGE_PREFIX_V1,
  createTextOpenWorldPlayerPreferencesStoreV1,
  parseTextOpenWorldPlayerPreferencesV1,
  readTextOpenWorldPlayerPreferencesV1,
  resetTextOpenWorldPlayerPreferencesV1,
  subscribeTextOpenWorldPlayerPreferencesV1,
  textOpenWorldPlayerPreferencesStorageKeyV1,
  writeTextOpenWorldPlayerPreferencesV1,
  type TextOpenWorldPlayerPreferenceScopeV1,
  type TextOpenWorldPlayerPreferencesStorageV1,
  type TextOpenWorldPlayerPreferencesV1,
} from '../../src/lib/open-world/player-preferences'

const PRODUCT_A: TextOpenWorldPlayerPreferenceScopeV1 = {
  productionKey: 'text-open-world.salt-ridge',
}

function validPreferences(
  overrides: Partial<TextOpenWorldPlayerPreferencesV1> = {},
): TextOpenWorldPlayerPreferencesV1 {
  return {
    ...DEFAULT_TEXT_OPEN_WORLD_PLAYER_PREFERENCES_V1,
    ...overrides,
  }
}

function allLocalStorageText(): string {
  return Array.from({ length: localStorage.length }, (_, index) => {
    const key = localStorage.key(index) ?? ''
    return `${key}=${localStorage.getItem(key) ?? ''}`
  }).join('\n')
}

describe('R-OPEN-WORLD4 · browser-local player preferences', () => {
  beforeEach(() => localStorage.clear())

  it('以版本化默认值启动，并只保存六项显示与音频偏好', () => {
    const initial = readTextOpenWorldPlayerPreferencesV1(PRODUCT_A)
    expect(initial).toEqual({
      schema: TEXT_OPEN_WORLD_PLAYER_PREFERENCES_SCHEMA_V1,
      version: 1,
      fontSizePx: 18,
      lineHeight: 1.9,
      highContrast: false,
      reducedMotion: false,
      muted: false,
      volume: 1,
    })
    expect(Object.isFrozen(initial)).toBe(true)

    const written = writeTextOpenWorldPlayerPreferencesV1(PRODUCT_A, {
      fontSizePx: 100,
      lineHeight: 0.5,
      highContrast: true,
      reducedMotion: true,
      muted: true,
      volume: 9,
    })
    expect(written).toEqual({
      schema: TEXT_OPEN_WORLD_PLAYER_PREFERENCES_SCHEMA_V1,
      version: 1,
      fontSizePx: 32,
      lineHeight: 1.25,
      highContrast: true,
      reducedMotion: true,
      muted: true,
      volume: 1,
    })

    const raw = localStorage.getItem(textOpenWorldPlayerPreferencesStorageKeyV1(PRODUCT_A))
    expect(raw).not.toBeNull()
    expect(Object.keys(JSON.parse(raw!)).sort()).toEqual([
      'fontSizePx',
      'highContrast',
      'lineHeight',
      'muted',
      'reducedMotion',
      'schema',
      'version',
      'volume',
    ])
    expect(readTextOpenWorldPlayerPreferencesV1(PRODUCT_A)).toEqual(written)
  })

  it('严格拒绝坏JSON、错误版本、缺失/额外字段和错误类型，有限数值越界则裁剪', () => {
    const key = textOpenWorldPlayerPreferencesStorageKeyV1(PRODUCT_A)
    const invalidRows = [
      '{broken',
      JSON.stringify({ ...validPreferences(), version: 2 }),
      JSON.stringify({ ...validPreferences(), volume: '0.5' }),
      JSON.stringify({ ...validPreferences(), apiKey: 'sk-should-never-be-read' }),
      JSON.stringify(Object.fromEntries(
        Object.entries(validPreferences()).filter(([field]) => field !== 'muted'),
      )),
    ]
    for (const raw of invalidRows) {
      localStorage.setItem(key, raw)
      expect(readTextOpenWorldPlayerPreferencesV1(PRODUCT_A)).toEqual(
        DEFAULT_TEXT_OPEN_WORLD_PLAYER_PREFERENCES_V1,
      )
    }
    expect(parseTextOpenWorldPlayerPreferencesV1(validPreferences({
      fontSizePx: 13.6,
      lineHeight: 99,
      volume: -4,
    }))).toMatchObject({ fontSizePx: 14, lineHeight: 2.5, volume: 0 })
    expect(parseTextOpenWorldPlayerPreferencesV1(validPreferences({ volume: Number.NaN }))).toBeNull()
  })

  it('按稳定产品身份与可选用户身份隔离，跨Release/Session无需另建偏好副本', () => {
    const productB = { productionKey: 'text-open-world.other-game' }
    const userA = { ...PRODUCT_A, userId: 'player.alpha' }
    const userB = { ...PRODUCT_A, userId: 'player.beta' }
    const keys = [PRODUCT_A, productB, userA, userB].map(textOpenWorldPlayerPreferencesStorageKeyV1)
    expect(new Set(keys).size).toBe(4)
    expect(keys.every(key => key.startsWith(TEXT_OPEN_WORLD_PLAYER_PREFERENCES_STORAGE_PREFIX_V1))).toBe(true)

    writeTextOpenWorldPlayerPreferencesV1(PRODUCT_A, { volume: 0.1 })
    writeTextOpenWorldPlayerPreferencesV1(productB, { volume: 0.2 })
    writeTextOpenWorldPlayerPreferencesV1(userA, { volume: 0.3 })
    writeTextOpenWorldPlayerPreferencesV1(userB, { volume: 0.4 })
    expect(readTextOpenWorldPlayerPreferencesV1(PRODUCT_A).volume).toBe(0.1)
    expect(readTextOpenWorldPlayerPreferencesV1(productB).volume).toBe(0.2)
    expect(readTextOpenWorldPlayerPreferencesV1(userA).volume).toBe(0.3)
    expect(readTextOpenWorldPlayerPreferencesV1(userB).volume).toBe(0.4)

    resetTextOpenWorldPlayerPreferencesV1(userA)
    expect(readTextOpenWorldPlayerPreferencesV1(userA).volume).toBe(1)
    expect(readTextOpenWorldPlayerPreferencesV1(userB).volume).toBe(0.4)
    expect(readTextOpenWorldPlayerPreferencesV1(PRODUCT_A).volume).toBe(0.1)
  })

  it('拒绝不稳定作用域和未知写入字段，API Key绝不进入key或payload', () => {
    for (const productionKey of ['', ' padded ', 'line\nbreak', 'x'.repeat(257)]) {
      expect(() => textOpenWorldPlayerPreferencesStorageKeyV1({ productionKey })).toThrow(/productionKey无效/)
    }
    expect(() => textOpenWorldPlayerPreferencesStorageKeyV1({
      productionKey: PRODUCT_A.productionKey,
      userId: ' bad-user ',
    })).toThrow(/userId无效/)

    const secret = 'sk-SENTINEL-player-preferences'
    expect(() => writeTextOpenWorldPlayerPreferencesV1(PRODUCT_A, {
      volume: 0.4,
      apiKey: secret,
    } as never)).toThrow(/patch字段不精确/)
    expect(localStorage.getItem(textOpenWorldPlayerPreferencesStorageKeyV1(PRODUCT_A))).toBeNull()
    expect(allLocalStorageText()).not.toContain(secret)
  })

  it('localStorage缺失或读写抛错时安全回退，实例Store仍可在当前内存中消费', () => {
    const unavailable: TextOpenWorldPlayerPreferencesStorageV1 = {
      getItem: () => { throw new DOMException('blocked', 'SecurityError') },
      setItem: () => { throw new DOMException('blocked', 'QuotaExceededError') },
      removeItem: () => { throw new DOMException('blocked', 'SecurityError') },
    }
    expect(readTextOpenWorldPlayerPreferencesV1(PRODUCT_A, { storage: unavailable }))
      .toEqual(DEFAULT_TEXT_OPEN_WORLD_PLAYER_PREFERENCES_V1)
    expect(writeTextOpenWorldPlayerPreferencesV1(PRODUCT_A, { muted: true }, { storage: unavailable }))
      .toMatchObject({ muted: true })
    expect(resetTextOpenWorldPlayerPreferencesV1(PRODUCT_A, { storage: unavailable }))
      .toEqual(DEFAULT_TEXT_OPEN_WORLD_PLAYER_PREFERENCES_V1)

    const store = createTextOpenWorldPlayerPreferencesStoreV1(PRODUCT_A, { storage: null })
    let notifications = 0
    const unsubscribe = store.subscribe(() => { notifications += 1 })
    expect(store.getServerSnapshot()).toBe(DEFAULT_TEXT_OPEN_WORLD_PLAYER_PREFERENCES_V1)
    expect(store.write({ muted: true })).toMatchObject({ muted: true })
    expect(store.getSnapshot()).toMatchObject({ muted: true })
    expect(notifications).toBe(1)
    expect(store.reset()).toEqual(DEFAULT_TEXT_OPEN_WORLD_PLAYER_PREFERENCES_V1)
    expect(notifications).toBe(2)
    unsubscribe()
  })

  it('订阅只响应同一产品/用户作用域，取消订阅后不再接收更新', () => {
    const observed: Readonly<TextOpenWorldPlayerPreferencesV1>[] = []
    const unsubscribe = subscribeTextOpenWorldPlayerPreferencesV1(
      PRODUCT_A,
      preferences => { observed.push(preferences) },
    )
    writeTextOpenWorldPlayerPreferencesV1({ productionKey: 'text-open-world.other' }, { volume: 0.2 })
    expect(observed).toHaveLength(0)
    writeTextOpenWorldPlayerPreferencesV1(PRODUCT_A, { volume: 0.35 })
    resetTextOpenWorldPlayerPreferencesV1(PRODUCT_A)
    expect(observed.map(item => item.volume)).toEqual([0.35, 1])
    unsubscribe()
    writeTextOpenWorldPlayerPreferencesV1(PRODUCT_A, { volume: 0.5 })
    expect(observed).toHaveLength(2)
  })

  it('external-store快照保持稳定，并在同作用域Store之间同步', () => {
    const first = createTextOpenWorldPlayerPreferencesStoreV1(PRODUCT_A)
    const second = createTextOpenWorldPlayerPreferencesStoreV1(PRODUCT_A)
    expect(first.getSnapshot()).toBe(first.getSnapshot())
    let firstNotifications = 0
    let secondNotifications = 0
    const unsubscribeFirst = first.subscribe(() => { firstNotifications += 1 })
    const unsubscribeSecond = second.subscribe(() => { secondNotifications += 1 })

    const next = first.write({ fontSizePx: 21, lineHeight: 2.1, volume: 0.45 })
    expect(first.getSnapshot()).toBe(next)
    expect(second.getSnapshot()).toEqual(next)
    expect(firstNotifications).toBe(1)
    expect(secondNotifications).toBe(1)
    expect(first.refresh()).toBe(first.getSnapshot())
    expect(firstNotifications).toBe(1)

    unsubscribeFirst()
    unsubscribeSecond()
  })

  it('读写和重置不创建或改写Session、Event与Checkpoint记录', async () => {
    const before = await Promise.all([
      db.productRuntimeSessions.count(),
      db.productRuntimeEvents.count(),
      db.productRuntimeCheckpoints.count(),
    ])
    writeTextOpenWorldPlayerPreferencesV1(PRODUCT_A, {
      highContrast: true,
      reducedMotion: true,
      muted: false,
      volume: 0.6,
    })
    resetTextOpenWorldPlayerPreferencesV1(PRODUCT_A)
    const after = await Promise.all([
      db.productRuntimeSessions.count(),
      db.productRuntimeEvents.count(),
      db.productRuntimeCheckpoints.count(),
    ])
    expect(after).toEqual(before)
  })
})
