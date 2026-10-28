import { canonicalProductProductionJsonV2, isSha256Hash } from '../product-production/hash'

/** AVG codecs are strict and inert. They do not infer capability or authorization. */
export function avgRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`[avg] ${label} 必须是普通对象`)
  const row = value as Record<string, unknown>
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))) {
    throw new Error(`[avg] ${label} 字段不完整或含未知字段`)
  }
  return row
}
export function avgText(value: unknown, label: string, max = 5000, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) {
    throw new Error(`[avg] ${label} 文本无效`)
  }
  return value
}
export function avgKey(value: unknown, label: string): string {
  const key = avgText(value, label, 200)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(key)) throw new Error(`[avg] ${label} key 无效`)
  return key
}
export function avgHash(value: unknown, label: string): string {
  if (!isSha256Hash(value)) throw new Error(`[avg] ${label} hash 无效`)
  return value
}
export function avgEnum<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new Error(`[avg] ${label} 无效`)
  return value as T
}
export function avgNumber(value: unknown, label: string, min: number, max: number, integer = true): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max
    || (integer && !Number.isSafeInteger(value))) throw new Error(`[avg] ${label} 数值无效`)
  return value
}
export function avgBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`[avg] ${label} 必须为 boolean`)
  return value
}
export function avgList<T>(value: unknown, label: string, parse: (value: unknown, label: string) => T, max = 1000): T[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`[avg] ${label} 必须为有界数组`)
  for (let index = 0; index < value.length; index++) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) throw new Error(`[avg] ${label} 不接受稀疏数组`)
  }
  return value.map((entry, index) => parse(entry, `${label}[${index}]`))
}
export function avgUnique<T>(rows: T[], key: (row: T) => string, label: string): T[] {
  if (new Set(rows.map(key)).size !== rows.length) throw new Error(`[avg] ${label} key 重复`)
  return rows
}
export function avgKeys(value: unknown, label: string): string[] {
  return avgUnique(avgList(value, label, avgKey), row => row, label)
}
export function avgProtocolBody(value: unknown): unknown {
  const raw = typeof value === 'string' ? JSON.parse(value) : value
  if (canonicalProductProductionJsonV2(raw).length > 2_000_000) throw new Error('[avg] 协议超过 2MB')
  return raw
}
