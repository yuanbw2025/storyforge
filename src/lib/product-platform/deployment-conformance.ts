import { hashCanonicalValue } from '../agent/run/hash'

export const PRODUCT_PLATFORM_DEPLOYMENT_SCENARIOS_V1 = [
  'active-dependency-probes',
  'cross-account-authorization',
  'durable-process-restart',
  'webhook-replay-idempotency',
  'webhook-key-rotation',
  'realtime-cross-instance',
  'single-writer-lease-loss',
  'isolated-backup-restore',
  'payment-refund-settlement',
  'data-export-delete',
] as const

export type ProductPlatformDeploymentScenarioV1 = typeof PRODUCT_PLATFORM_DEPLOYMENT_SCENARIOS_V1[number]

export interface ProductPlatformDeploymentScenarioEvidenceV1 {
  evidenceHash: string
  assertionCount: number
}

export interface ProductPlatformDeploymentScenarioResultV1 {
  scenario: ProductPlatformDeploymentScenarioV1
  status: 'passed' | 'failed'
  code: string
  evidenceHash: string | null
  assertionCount: number
  startedAt: number
  completedAt: number
  durationMs: number
}

export interface ProductPlatformDeploymentConformanceReceiptV1 {
  schema: 'storyforge.product-platform-deployment-conformance'
  version: 1
  environment: 'staging' | 'production'
  deploymentId: string
  deploymentTargetHash: string
  serviceVersion: string
  startedAt: number
  completedAt: number
  scenarios: ProductPlatformDeploymentScenarioResultV1[]
  readyForPromotion: boolean
  receiptHash: string
}

export type ProductPlatformDeploymentScenarioRunnersV1 = Record<
  ProductPlatformDeploymentScenarioV1,
  (input: {
    scenario: ProductPlatformDeploymentScenarioV1
    signal: AbortSignal
  }) => Promise<ProductPlatformDeploymentScenarioEvidenceV1>
>

export class ProductPlatformDeploymentScenarioErrorV1 extends Error {
  constructor(public readonly code: string) {
    super(`[product-platform-deployment:${code}] scenario failed`)
    this.name = 'ProductPlatformDeploymentScenarioErrorV1'
  }
}

function stableId(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)
    || value.length < 1 || value.length > maximum) {
    throw new Error(`[product-platform-deployment:protocol] ${label} 无效`)
  }
  return value
}

function sha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`[product-platform-deployment:protocol] ${label} 无效`)
  }
  return value
}

function timestamp(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`[product-platform-deployment:protocol] ${label} 无效`)
  }
  return Number(value)
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(value)
  if (actual.length !== expected.length || actual.some(key => !expected.includes(key))) {
    throw new Error(`[product-platform-deployment:protocol] ${label} 字段不符合协议`)
  }
}

function scenarioCode(error: unknown): string {
  return error instanceof ProductPlatformDeploymentScenarioErrorV1
    && /^[a-z0-9][a-z0-9._:-]{0,99}$/.test(error.code)
    ? error.code
    : error instanceof Error && error.message === 'scenario-timeout'
      ? 'scenario-timeout'
      : 'scenario-failed'
}

/**
 * Runs the complete external/staging evidence matrix. Exceptions are reduced
 * to stable codes so provider responses, credentials and URLs cannot leak into
 * the portable receipt. A failed scenario never prevents the remaining drills
 * from running.
 */
export async function runProductPlatformDeploymentConformanceV1(input: {
  environment: 'staging' | 'production'
  deploymentId: string
  deploymentTargetHash: string
  serviceVersion: string
  runners: ProductPlatformDeploymentScenarioRunnersV1
  scenarioTimeoutMs?: number
  now?: () => number
}): Promise<ProductPlatformDeploymentConformanceReceiptV1> {
  if (!['staging', 'production'].includes(String(input.environment))) {
    throw new Error('[product-platform-deployment:protocol] environment 无效')
  }
  const deploymentId = stableId(input.deploymentId, 'deploymentId', 200)
  const deploymentTargetHash = sha(input.deploymentTargetHash, 'deploymentTargetHash')
  const serviceVersion = stableId(input.serviceVersion, 'serviceVersion', 100)
  const scenarioTimeoutMs = input.scenarioTimeoutMs ?? 120_000
  if (!Number.isInteger(scenarioTimeoutMs) || scenarioTimeoutMs < 100 || scenarioTimeoutMs > 10 * 60_000) {
    throw new Error('[product-platform-deployment:configuration] scenarioTimeoutMs 无效')
  }
  const now = input.now ?? (() => Date.now())
  const readNow = (label: string) => timestamp(now(), label)
  const startedAt = readNow('startedAt')
  const scenarios: ProductPlatformDeploymentScenarioResultV1[] = []
  for (const scenario of PRODUCT_PLATFORM_DEPLOYMENT_SCENARIOS_V1) {
    const scenarioStartedAt = readNow(`${scenario}.startedAt`)
    let timer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    const controller = new AbortController()
    try {
      const runner = input.runners[scenario]
      if (typeof runner !== 'function') throw new ProductPlatformDeploymentScenarioErrorV1('runner-missing')
      const evidence = await Promise.race([
        runner({ scenario, signal: controller.signal }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true
            controller.abort()
            reject(new Error('scenario-timeout'))
          }, scenarioTimeoutMs)
        }),
      ])
      if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)
        || Object.keys(evidence).length !== 2
        || !Object.keys(evidence).every(key => ['evidenceHash', 'assertionCount'].includes(key))) {
        throw new ProductPlatformDeploymentScenarioErrorV1('evidence-invalid')
      }
      const evidenceHash = sha(evidence.evidenceHash, `${scenario}.evidenceHash`)
      if (!Number.isInteger(evidence.assertionCount) || evidence.assertionCount < 1 || evidence.assertionCount > 1_000_000) {
        throw new ProductPlatformDeploymentScenarioErrorV1('assertion-count-invalid')
      }
      const completedAt = readNow(`${scenario}.completedAt`)
      if (completedAt < scenarioStartedAt) {
        throw new ProductPlatformDeploymentScenarioErrorV1('clock-regressed')
      }
      scenarios.push({
        scenario, status: 'passed', code: 'ok', evidenceHash,
        assertionCount: evidence.assertionCount,
        startedAt: scenarioStartedAt, completedAt,
        durationMs: Math.max(0, completedAt - scenarioStartedAt),
      })
    } catch (error) {
      const completedAt = Math.max(scenarioStartedAt, readNow(`${scenario}.failedAt`))
      scenarios.push({
        scenario, status: 'failed', code: timedOut ? 'scenario-timeout' : scenarioCode(error), evidenceHash: null,
        assertionCount: 0, startedAt: scenarioStartedAt, completedAt,
        durationMs: Math.max(0, completedAt - scenarioStartedAt),
      })
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  const completedAt = Math.max(
    scenarios[scenarios.length - 1]?.completedAt ?? startedAt,
    readNow('completedAt'),
  )
  const body = {
    schema: 'storyforge.product-platform-deployment-conformance' as const,
    version: 1 as const,
    environment: input.environment,
    deploymentId,
    deploymentTargetHash,
    serviceVersion,
    startedAt,
    completedAt,
    scenarios,
    readyForPromotion: scenarios.every(result => result.status === 'passed'),
  }
  return { ...body, receiptHash: await hashCanonicalValue(body) }
}

export async function verifyProductPlatformDeploymentConformanceReceiptV1(
  input: unknown,
): Promise<ProductPlatformDeploymentConformanceReceiptV1> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('[product-platform-deployment:protocol] receipt 必须是对象')
  }
  const receipt = input as Record<string, unknown>
  exactKeys(receipt, [
    'schema', 'version', 'environment', 'deploymentId', 'deploymentTargetHash', 'serviceVersion',
    'startedAt', 'completedAt', 'scenarios', 'readyForPromotion', 'receiptHash',
  ], 'receipt')
  if (receipt.schema !== 'storyforge.product-platform-deployment-conformance' || receipt.version !== 1
    || !['staging', 'production'].includes(String(receipt.environment))) {
    throw new Error('[product-platform-deployment:protocol] receipt 版本无效')
  }
  stableId(receipt.deploymentId, 'deploymentId', 200)
  stableId(receipt.serviceVersion, 'serviceVersion', 100)
  sha(receipt.deploymentTargetHash, 'deploymentTargetHash')
  sha(receipt.receiptHash, 'receiptHash')
  if (!Number.isInteger(receipt.startedAt) || !Number.isInteger(receipt.completedAt)
    || Number(receipt.startedAt) < 0 || Number(receipt.completedAt) < Number(receipt.startedAt)
    || typeof receipt.readyForPromotion !== 'boolean' || !Array.isArray(receipt.scenarios)
    || receipt.scenarios.length !== PRODUCT_PLATFORM_DEPLOYMENT_SCENARIOS_V1.length) {
    throw new Error('[product-platform-deployment:protocol] receipt 状态无效')
  }
  const scenarios = receipt.scenarios.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('[product-platform-deployment:protocol] scenario 无效')
    }
    const row = value as Record<string, unknown>
    exactKeys(row, [
      'scenario', 'status', 'code', 'evidenceHash', 'assertionCount',
      'startedAt', 'completedAt', 'durationMs',
    ], 'scenario')
    if (row.scenario !== PRODUCT_PLATFORM_DEPLOYMENT_SCENARIOS_V1[index]
      || !['passed', 'failed'].includes(String(row.status))
      || typeof row.code !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,99}$/.test(row.code)
      || !Number.isInteger(row.assertionCount) || Number(row.assertionCount) < 0
      || Number(row.assertionCount) > 1_000_000
      || !Number.isInteger(row.startedAt) || !Number.isInteger(row.completedAt)
      || !Number.isInteger(row.durationMs) || Number(row.durationMs) < 0
      || Number(row.startedAt) < Number(receipt.startedAt)
      || Number(row.completedAt) < Number(row.startedAt)
      || Number(row.completedAt) > Number(receipt.completedAt)
      || Number(row.durationMs) !== Number(row.completedAt) - Number(row.startedAt)) {
      throw new Error('[product-platform-deployment:protocol] scenario 状态无效')
    }
    if (row.status === 'passed') {
      if (row.code !== 'ok' || Number(row.assertionCount) < 1) {
        throw new Error('[product-platform-deployment:protocol] passed scenario 证据无效')
      }
      sha(row.evidenceHash, 'scenario.evidenceHash')
    } else if (row.evidenceHash !== null || row.assertionCount !== 0 || row.code === 'ok') {
      throw new Error('[product-platform-deployment:protocol] failed scenario 证据无效')
    }
    return row
  })
  const ready = scenarios.every(row => row.status === 'passed')
  for (let index = 1; index < scenarios.length; index += 1) {
    if (Number(scenarios[index].startedAt) < Number(scenarios[index - 1].completedAt)) {
      throw new Error('[product-platform-deployment:protocol] scenario 时间顺序无效')
    }
  }
  const evidenceHashes = scenarios
    .filter(row => row.status === 'passed')
    .map(row => String(row.evidenceHash))
  if (new Set(evidenceHashes).size !== evidenceHashes.length) {
    throw new Error('[product-platform-deployment:protocol] scenario 证据不得重用')
  }
  if (receipt.readyForPromotion !== ready) {
    throw new Error('[product-platform-deployment:protocol] promotion 裁决与 scenario 不一致')
  }
  const { receiptHash, ...body } = receipt
  if (await hashCanonicalValue(body) !== receiptHash) {
    throw new Error('[product-platform-deployment:integrity] receipt hash 不匹配')
  }
  return structuredClone(input) as ProductPlatformDeploymentConformanceReceiptV1
}
