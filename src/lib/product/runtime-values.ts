export type ProductRuntimeJsonObjectV1 = Record<string, unknown>

export function stableProductRuntimeJsonV1(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableProductRuntimeJsonV1).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableProductRuntimeJsonV1(child)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function isProductRuntimeJsonObjectV1(value: unknown): value is ProductRuntimeJsonObjectV1 {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function assertProductRuntimeIntegerV1(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${label} 必须是 ${minimum}..${maximum} 的整数。`)
  }
  return Number(value)
}
