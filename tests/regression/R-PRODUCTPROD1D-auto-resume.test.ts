import { describe, expect, it } from 'vitest'
import { shouldAutoContinueProductProductionV1 } from '../../src/components/product/ProductProductionStudio'

describe('R-PRODUCTPROD-1D · durable author start command', () => {
  it('刷新或切页后仍会从 authorized/building checkpoint 自动续跑', () => {
    expect(shouldAutoContinueProductProductionV1({
      productionStatus: 'producing', buildStatus: 'authorized', running: false,
    })).toBe(true)
    expect(shouldAutoContinueProductProductionV1({
      productionStatus: 'producing', buildStatus: 'building', running: false,
    })).toBe(true)
  })

  it('暂停、停止、恢复门与已有执行者都不会被重复启动', () => {
    expect(shouldAutoContinueProductProductionV1({
      productionStatus: 'paused', buildStatus: 'paused', running: false,
    })).toBe(false)
    expect(shouldAutoContinueProductProductionV1({
      productionStatus: 'stopped', buildStatus: 'cancelled', running: false,
    })).toBe(false)
    expect(shouldAutoContinueProductProductionV1({
      productionStatus: 'producing', buildStatus: 'recovery-required', running: false,
    })).toBe(false)
    expect(shouldAutoContinueProductProductionV1({
      productionStatus: 'producing', buildStatus: 'building', running: true,
    })).toBe(false)
  })
})
