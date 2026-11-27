import { describe, expect, it } from 'vitest'
import { assertWorldMapContextCompleteV1 } from '../../src/lib/agent/run/world-map-config-durable'

const KEYS = ['worldview', 'geography', 'codex', 'locations'] as const

function assembled(patch: {
  included?: string[]
  trimmed?: string[]
  sourceEvidence?: Array<{ key: string; delivery?: string }>
} = {}) {
  return {
    included: [...KEYS],
    trimmed: [],
    sourceEvidence: KEYS.map(key => ({ key, delivery: 'full' })),
    ...patch,
  }
}

describe('B34 · 世界地图登记来源完整性门（不静默截断）', () => {
  it('四类登记来源完整进入时通过', () => {
    expect(() => assertWorldMapContextCompleteV1(assembled())).not.toThrow()
  })

  it('来源被裁剪时明确失败', () => {
    expect(() => assertWorldMapContextCompleteV1(assembled({ trimmed: ['geography'] })))
      .toThrow(/未完整进入上下文预算/)
  })

  it('来源未进入时明确失败', () => {
    expect(() => assertWorldMapContextCompleteV1(assembled({ included: ['worldview', 'codex', 'locations'] })))
      .toThrow(/未完整进入上下文预算/)
  })

  it('独立长篇未建地理或地点时，接受登记装配器明确记录的空来源', () => {
    expect(() => assertWorldMapContextCompleteV1({ included: ['worldview'], trimmed: [], sourceEvidence: [
      { key: 'worldview', status: 'included', delivery: 'full', originalCharacters: 100 },
      ...KEYS.slice(1).map(key => ({ key, status: 'omitted', delivery: 'none', originalCharacters: 0 })),
    ] })).not.toThrow()
  })

  it('有正文的遗漏或没有空来源证据的遗漏仍须停止', () => {
    for (const originalCharacters of [undefined, 1]) {
      expect(() => assertWorldMapContextCompleteV1({ included: ['worldview', 'codex', 'locations'], trimmed: [],
        sourceEvidence: [{ key: 'geography', status: 'omitted', delivery: 'none', originalCharacters }],
      })).toThrow(/未完整进入上下文预算/)
    }
  })

  it('来源被截断交付时明确失败', () => {
    const value = assembled({
      sourceEvidence: [
        { key: 'worldview', delivery: 'truncated' },
        { key: 'geography', delivery: 'full' },
        { key: 'codex', delivery: 'full' },
        { key: 'locations', delivery: 'full' },
      ],
    })
    expect(() => assertWorldMapContextCompleteV1(value)).toThrow(/未完整进入上下文预算/)
  })
})
