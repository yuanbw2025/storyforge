/**
 * R-NS4-fact-predicate-registry · 受控谓词注册表（NS-4 地基）
 *
 * 守卫"AI 不得把自由谓词写进权威账本"这条不变量：
 * - 登记的 key / alias 能归一到规范谓词；
 * - 未登记谓词归一返回 null（调用方必须当候选、不得直接落权威账本）；
 * - 关系/事件谓词声明了客体类型与 cardinality/conflictPolicy（采纳时校验依据）。
 */
import { describe, it, expect } from 'vitest'
import {
  FACT_PREDICATE_REGISTRY,
  getFactPredicate,
  normalizeFactPredicate,
  normalizeFactValue,
} from '../../src/lib/registry/fact-predicate-registry'

describe('NS-4 · FACT_PREDICATE_REGISTRY', () => {
  it('预登记了 §14.2 要求的最小谓词集', () => {
    const keys = FACT_PREDICATE_REGISTRY.map(p => p.key)
    for (const k of ['location', 'aliveStatus', 'healthStatus', 'powerStage', 'goal', 'owns', 'knows', 'relation', 'migratedStateCard']) {
      expect(keys, `应登记谓词 ${k}`).toContain(k)
    }
  })

  it('key 与 alias 都能归一到规范谓词', () => {
    expect(normalizeFactPredicate('location')?.key).toBe('location')
    expect(normalizeFactPredicate('位置')?.key).toBe('location')      // alias
    expect(normalizeFactPredicate('境界')?.key).toBe('powerStage')    // alias
    expect(normalizeFactPredicate('  生死  ')?.key).toBe('aliveStatus') // 去空白 + alias
  })

  it('未登记谓词归一返回 null（不得直接写权威账本）', () => {
    expect(normalizeFactPredicate('心情好坏')).toBeNull()
    expect(normalizeFactPredicate('')).toBeNull()
    expect(normalizeFactPredicate('随便编一个')).toBeNull()
  })

  it('单值 state 谓词用 supersede；关系谓词声明客体类型', () => {
    expect(getFactPredicate('location')).toMatchObject({ cardinality: 'single', conflictPolicy: 'supersede', factKind: 'state' })
    expect(getFactPredicate('aliveStatus')?.enums).toContain('dead')
    expect(getFactPredicate('relation')?.objectEntityTypes).toContain('character')
    expect(getFactPredicate('owns')?.objectEntityTypes).toContain('codexEntry')
    expect(getFactPredicate('knows')?.factKind).toBe('event') // event 只增不改
    expect(getFactPredicate('migratedStateCard')).toMatchObject({ cardinality: 'multi', conflictPolicy: 'manual' })
  })

  it('枚举事实值必须归一到登记闭集', () => {
    const aliveStatus = getFactPredicate('aliveStatus')!
    expect(normalizeFactValue(aliveStatus, '身亡')).toBe('dead')
    expect(normalizeFactValue(aliveStatus, 'ALIVE')).toBe('alive')
    expect(normalizeFactValue(aliveStatus, '半死不活')).toBeNull()
  })
})
