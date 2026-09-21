import { describe, expect, it } from 'vitest'
import {
  productProductionRecoveryCheckDelayV1,
  shouldAutoContinueProductProductionV1,
} from '../../src/components/product/ProductProductionStudio'

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

  it('刷新后遇到其他执行者的 running task 会按 durable 截止时间自动复验', () => {
    const progress = {
      buildStatus: 'building',
      tasks: [{ status: 'running', recoveryCheckAt: 10_000 }],
    } as Parameters<typeof productProductionRecoveryCheckDelayV1>[0]
    expect(productProductionRecoveryCheckDelayV1(progress, 7_000)).toBe(3_050)
    expect(productProductionRecoveryCheckDelayV1(progress, 11_000)).toBe(250)
    expect(productProductionRecoveryCheckDelayV1({
      ...progress, buildStatus: 'recovery-required',
    }, 7_000)).toBeNull()
  })
})
