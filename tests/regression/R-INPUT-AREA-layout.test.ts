import { describe, expect, it, vi } from 'vitest'
import { clampInputAreaBoxV1, INPUT_AREA_STORAGE_KEY_V1, isInputAreaLayoutKeyV1, loadInputAreaBoxV1, normalizeInputAreaDesiredBoxV1, saveInputAreaBoxV1 } from '../../src/lib/input-area-layout'

function storage(initial: unknown = null) {
  const values = new Map<string, string>(initial === null ? [] : [[INPUT_AREA_STORAGE_KEY_V1, typeof initial === 'string' ? initial : JSON.stringify(initial)]])
  return { getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { values.set(key, value) }), removeItem: vi.fn((key: string) => { values.delete(key) }), values }
}
describe('047 device-only input area preference', () => {
  it('admits only finite UI field/role keys and does not access storage for a session or forged key', () => {
    const target = storage()
    for (const key of ['story.theme/current', 'story.theme/candidate', 'story.theme/raw', 'story.theme/json']) expect(isInputAreaLayoutKeyV1(key)).toBe(true)
    for (const key of ['故事原文', 'work:1/current', 'story.theme/anything', '__proto__']) {
      expect(isInputAreaLayoutKeyV1(key)).toBe(false)
      expect(loadInputAreaBoxV1(key as never, target)).toBeNull()
      saveInputAreaBoxV1(key as never, { width: 300, height: 100 }, target)
    }
    expect(loadInputAreaBoxV1(undefined, target)).toBeNull()
    expect(target.getItem).not.toHaveBeenCalled(); expect(target.setItem).not.toHaveBeenCalled()
  })
  it('serializes only numeric dimensions and separates current/candidate/raw/json roles', () => {
    const target = storage()
    const box = { width: 380, height: 180, text: '绝不进入偏好的稿件', workId: 1, revision: 9, runId: 'secret', stale: true }
    saveInputAreaBoxV1('story.theme/current', box, target)
    saveInputAreaBoxV1('story.theme/candidate', { width: 400, height: 200 }, target)
    saveInputAreaBoxV1('story.theme/raw', { width: 420, height: 220 }, target)
    saveInputAreaBoxV1('story.theme/json', { width: 440, height: 240 }, target)
    const raw = target.values.get(INPUT_AREA_STORAGE_KEY_V1)!
    expect(raw).not.toMatch(/稿件|workId|revision|runId|stale|secret/)
    expect(loadInputAreaBoxV1('story.theme/current', target)).toEqual({ width: 380, height: 180 })
    saveInputAreaBoxV1('story.theme/candidate', null, target)
    expect(loadInputAreaBoxV1('story.theme/candidate', target)).toBeNull()
    expect(loadInputAreaBoxV1('story.theme/raw', target)).toEqual({ width: 420, height: 220 })
    expect(loadInputAreaBoxV1('story.theme/json', target)).toEqual({ width: 440, height: 240 })
  })
  it.each(['{', { version: 2, boxes: { 'story.theme/current': { width: 300, height: 100 } } }, { version: 1, boxes: [] }, { version: 1, boxes: { 'story.theme/current': { width: 0, height: 100 } } }, { version: 1, boxes: { 'story.theme/current': { width: '300', height: 100 } } }, { version: 1, boxes: { 'story.theme/current': { width: 1e9, height: 100 } } }])('ignores corrupt, unknown-version and unbounded records: %j', value => {
    expect(loadInputAreaBoxV1('story.theme/current', storage(value))).toBeNull()
  })
  it('keeps hidden/tiny/zoomed clamps separate from the requested size and never writes from a clamp', () => {
    const box = { width: 800, height: 600 }, target = storage()
    saveInputAreaBoxV1('world.origin/current', box, target)
    for (const width of [0, 12, 159, 390]) {
      const actual = clampInputAreaBoxV1(box, { width, height: 80, minWidth: 160, minHeight: 120 })
      expect(actual).toEqual({ width: Math.min(width, 800), height: 80 })
    }
    expect(clampInputAreaBoxV1(box, { width: 1920, height: 900, minWidth: 160, minHeight: 64 })).toEqual(box)
    expect(loadInputAreaBoxV1('world.origin/current', target)).toEqual(box)
    expect(target.setItem).toHaveBeenCalledOnce()
  })
  it.each([
    ' { "version": 2, "boxes": { "world.origin/current": {"width":800,"height":600}, "world.origin/candidate": {"width":700,"height":500} } } ',
    '{damaged-original',
    '{"version":1,"boxes":{"world.origin/current":{"width":"800","height":600},"world.origin/candidate":{"width":700,"height":500}}}',
  ])('keeps unsupported or damaged storage bytes intact on save/reset: %s', raw => {
    const target = storage(raw)
    expect(loadInputAreaBoxV1('world.origin/current', target)).toBeNull()
    saveInputAreaBoxV1('world.origin/current', { width: 400, height: 200 }, target)
    expect(target.values.get(INPUT_AREA_STORAGE_KEY_V1)).toBe(raw)
    saveInputAreaBoxV1('world.origin/current', null, target)
    expect(target.values.get(INPUT_AREA_STORAGE_KEY_V1)).toBe(raw)
    expect(target.setItem).not.toHaveBeenCalled(); expect(target.removeItem).not.toHaveBeenCalled()
  })
  it('normalizes user actions to finite desired values and makes blocked storage optional', () => {
    expect(normalizeInputAreaDesiredBoxV1({ width: NaN, height: Infinity })).toEqual({ width: 160, height: 64 })
    const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } }
    expect(loadInputAreaBoxV1('world.origin/current', blocked)).toBeNull()
    expect(() => saveInputAreaBoxV1('world.origin/current', { width: 500, height: 200 }, blocked)).not.toThrow()
    expect(() => saveInputAreaBoxV1('world.origin/current', null, blocked)).not.toThrow()
  })
})
