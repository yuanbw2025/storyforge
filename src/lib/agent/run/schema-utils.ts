export class AgentRunSchemaError extends Error {
  readonly code: string
  readonly path: string

  constructor(code: string, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'AgentRunSchemaError'
    this.code = code
    this.path = path
  }
}

export function failSchema(code: string, path: string, message: string): never {
  throw new AgentRunSchemaError(code, path, message)
}

export function readRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    failSchema('invalid_type', path, '必须是对象')
  }
  return value as Record<string, unknown>
}

export function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) failSchema('unknown_field', `${path}.${key}`, '未知字段')
  }
  for (const key of required) {
    if (!(key in value)) failSchema('missing_field', `${path}.${key}`, '缺少必填字段')
  }
}

export function readString(value: unknown, path: string, options: { max?: number } = {}): string {
  if (typeof value !== 'string' || !value.trim()) failSchema('invalid_value', path, '必须是非空字符串')
  const result = value.trim()
  if (options.max != null && result.length > options.max) {
    failSchema('invalid_value', path, `长度不得超过 ${options.max}`)
  }
  return result
}

export function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') failSchema('invalid_type', path, '必须是布尔值')
  return value
}

export function readInteger(
  value: unknown,
  path: string,
  options: { min?: number } = {},
): number {
  const min = options.min ?? 0
  if (!Number.isInteger(value) || (value as number) < min) {
    failSchema('invalid_value', path, `必须是大于等于 ${min} 的整数`)
  }
  return value as number
}

export function readNonNegativeNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    failSchema('invalid_value', path, '必须是非负有限数字')
  }
  return value
}

export function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    failSchema('invalid_value', path, `必须是 ${allowed.join('、')} 之一`)
  }
  return value as T
}

export function readArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) failSchema('invalid_type', path, '必须是数组')
  return value
}

export function assertUnique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) failSchema('duplicate_value', path, '不得包含重复值')
}

export function readHash(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    failSchema('invalid_hash', path, '必须是 64 位小写 SHA-256')
  }
  return value
}
