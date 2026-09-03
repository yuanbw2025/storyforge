import {
  isProductionProductKindV1,
  type ProductProductionHandoffV1,
} from '../types'

export function parseProductProductionHandoffV1(value: unknown): ProductProductionHandoffV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('[product-production-handoff] 交接必须是对象')
  }
  const row = value as Record<string, unknown>
  const expected = ['productType', 'schema', 'version', 'worldContentHash', 'worldReleaseId']
  if (Object.keys(row).sort().join(',') !== expected.sort().join(',')) {
    throw new Error('[product-production-handoff] 交接字段不精确')
  }
  if (row.schema !== 'storyforge.product-production-handoff' || row.version !== 1
    || !isProductionProductKindV1(row.productType)
    || !Number.isInteger(row.worldReleaseId) || Number(row.worldReleaseId) < 1
    || typeof row.worldContentHash !== 'string' || !/^[0-9a-f]{64}$/.test(row.worldContentHash)) {
    throw new Error('[product-production-handoff] 交接身份、产品、release ID 或 hash 无效')
  }
  return {
    schema: 'storyforge.product-production-handoff', version: 1,
    productType: row.productType,
    worldReleaseId: Number(row.worldReleaseId), worldContentHash: row.worldContentHash,
  }
}
