import { describe, expect, it } from 'vitest'
import { isCanonFactV1 } from '../../src/lib/fact-ledger/canon-eligibility'
import type { FactStatus } from '../../src/lib/types/temporal-fact'

describe('SFQA-124 · 共享 Canon 区间资格合同', () => {
  it.each([undefined, null, 12])('已确认事实允许进入区间校验，截止章界=%s', validToChapterId => {
    expect(isCanonFactV1({ status: 'confirmed', validToChapterId })).toBe(true)
  })

  it.each([undefined, null])('缺少截止章界的已取代记录只保留审计资格，截止=%s', validToChapterId => {
    expect(isCanonFactV1({ status: 'superseded', validToChapterId })).toBe(false)
  })

  it('有界历史保留投影资格；函数不把资格等同于章界存在或当前时点', () => {
    const fact = Object.freeze({ status: 'superseded' as const, validToChapterId: 999999 })
    expect(isCanonFactV1(fact)).toBe(true)
    expect(fact).toEqual({ status: 'superseded', validToChapterId: 999999 })
    // The consuming entry must resolve this id and reject an unknown/end-before-target range.
    // Integration controls in R-SFQA124-fact-confirmation and CONSISTENCY4 verify that boundary.
  })

  it.each<FactStatus>(['candidate', 'rejected', 'stale', 'source-missing', 'invalid-range'])(
    '%s 即使带截止章界也不是可投影的 Canon', status => {
      expect(isCanonFactV1({ status, validToChapterId: 12 })).toBe(false)
    },
  )
})
