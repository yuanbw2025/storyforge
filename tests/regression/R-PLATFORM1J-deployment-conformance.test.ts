import { describe, expect, it } from 'vitest'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import {
  PRODUCT_PLATFORM_DEPLOYMENT_SCENARIOS_V1,
  ProductPlatformDeploymentScenarioErrorV1,
  runProductPlatformDeploymentConformanceV1,
  verifyProductPlatformDeploymentConformanceReceiptV1,
  type ProductPlatformDeploymentScenarioRunnersV1,
} from '../../src/lib/product-platform/deployment-conformance'

function runners(input: {
  fail?: string
  hang?: string
} = {}): ProductPlatformDeploymentScenarioRunnersV1 {
  return Object.fromEntries(PRODUCT_PLATFORM_DEPLOYMENT_SCENARIOS_V1.map(scenario => [
    scenario,
    async ({ signal }: { signal: AbortSignal }) => {
      if (scenario === input.fail) {
        throw new ProductPlatformDeploymentScenarioErrorV1('staging-assertion-failed')
      }
      if (scenario === input.hang) {
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('provider-secret-must-not-leak')), { once: true })
        })
      }
      return { evidenceHash: await hashCanonicalValue({ scenario, isolated: true }), assertionCount: 3 }
    },
  ])) as ProductPlatformDeploymentScenarioRunnersV1
}

describe('PLATFORM-1J · external deployment conformance receipt', () => {
  it('十项 staging 演练全部通过才签发可晋级 receipt，篡改或缺项均不可验证', async () => {
    let now = 2_000_000
    const receipt = await runProductPlatformDeploymentConformanceV1({
      environment: 'staging',
      deploymentId: 'deploy.staging.cn-east-1.42',
      deploymentTargetHash: 'a'.repeat(64),
      serviceVersion: '2026.08.21-42',
      runners: runners(),
      now: () => now++,
    })
    expect(receipt.readyForPromotion).toBe(true)
    expect(receipt.scenarios.map(row => row.scenario)).toEqual(PRODUCT_PLATFORM_DEPLOYMENT_SCENARIOS_V1)
    expect(receipt.scenarios.every(row => row.status === 'passed' && row.assertionCount === 3)).toBe(true)
    await expect(verifyProductPlatformDeploymentConformanceReceiptV1(receipt)).resolves.toEqual(receipt)

    const tampered = structuredClone(receipt)
    tampered.scenarios[0].assertionCount += 1
    await expect(verifyProductPlatformDeploymentConformanceReceiptV1(tampered)).rejects.toThrow(/hash/)
    const missing = structuredClone(receipt) as unknown as { scenarios: unknown[] }
    missing.scenarios.pop()
    await expect(verifyProductPlatformDeploymentConformanceReceiptV1(missing)).rejects.toThrow('状态无效')
  })

  it('单项失败不中止后续灾备与删除演练，只保留稳定错误码', async () => {
    const receipt = await runProductPlatformDeploymentConformanceV1({
      environment: 'production', deploymentId: 'deploy.production.1',
      deploymentTargetHash: 'b'.repeat(64), serviceVersion: 'production-1',
      runners: runners({ fail: 'webhook-key-rotation' }), now: () => 100,
    })
    expect(receipt.readyForPromotion).toBe(false)
    expect(receipt.scenarios).toHaveLength(10)
    expect(receipt.scenarios.find(row => row.scenario === 'webhook-key-rotation')).toMatchObject({
      status: 'failed', code: 'staging-assertion-failed', evidenceHash: null, assertionCount: 0,
    })
    expect(receipt.scenarios.at(-1)).toMatchObject({ scenario: 'data-export-delete', status: 'passed' })
    await expect(verifyProductPlatformDeploymentConformanceReceiptV1(receipt)).resolves.toEqual(receipt)
  })

  it('超时会取消场景并脱敏为 scenario-timeout，不把供应商异常写入 receipt', async () => {
    const receipt = await runProductPlatformDeploymentConformanceV1({
      environment: 'staging', deploymentId: 'deploy.timeout.1',
      deploymentTargetHash: 'c'.repeat(64), serviceVersion: 'timeout-1',
      runners: runners({ hang: 'realtime-cross-instance' }), scenarioTimeoutMs: 100,
      now: () => 200,
    })
    expect(receipt.scenarios.find(row => row.scenario === 'realtime-cross-instance')).toMatchObject({
      status: 'failed', code: 'scenario-timeout',
    })
    expect(JSON.stringify(receipt)).not.toContain('provider-secret-must-not-leak')
  })
})
