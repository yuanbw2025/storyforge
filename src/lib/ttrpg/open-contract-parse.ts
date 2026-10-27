/** Pure, closed JSON readers. No parser returns an unchecked domain cast. */
export { parseTtrpgOpenAuthoringV1 } from './open-content-authoring'
export function fail(label: string): never { throw new Error(`[ttrpg-open] ${label}`) }
export function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(`${label}: 必须是对象`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return fail(`${label}: 必须是 JSON 对象`)
  const result: Record<string, unknown> = {}
  for (const name of Reflect.ownKeys(value)) {
    if (typeof name !== 'string') return fail(`${label}: 非 JSON 字段`)
    const descriptor = Object.getOwnPropertyDescriptor(value, name)
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return fail(`${label}: 非 JSON 字段`)
    Object.defineProperty(result, name, { value: descriptor.value, enumerable: true })
  }
  return result
}
export function exact(row: Record<string, unknown>, fields: readonly string[], label: string): void {
  if (Object.keys(row).length !== fields.length || fields.some(k => !Object.prototype.hasOwnProperty.call(row, k))) fail(`${label}: 字段不精确`)
}
export function record(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  const row = object(value, label); exact(row, fields, label); return row
}
export function json(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { const parsed: unknown = JSON.parse(value); return parsed } catch { return fail('不是合法 JSON') }
}
export function text(value: unknown, label: string, maximum = 20_000): string {
  if (typeof value !== 'string') return fail(`${label}: 必须是字符串`)
  const result = value.trim().normalize('NFC')
  if (!result || result.length > maximum) return fail(`${label}: 为空或过长`)
  return result
}
export function key(value: unknown, label: string): string {
  const result = text(value, label, 200)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(result)) fail(`${label}: 非稳定 key`)
  return result
}
export function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return fail(`${label}: hash 无效`)
  return value
}
export function number(value: unknown, label: string, min = -1_000_000, max = 1_000_000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return fail(`${label}: 数值越界`)
  return value
}
export function integer(value: unknown, label: string, min = 0, max = 1_000_000): number {
  const n = number(value, label, min, max)
  if (!Number.isSafeInteger(n)) fail(`${label}: 必须是整数`)
  return n
}
export function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') return fail(`${label}: 必须是 boolean`)
  return value
}
export function literal<T extends string | number | boolean | null>(value: unknown, expected: T, label: string): T {
  if (value !== expected) fail(`${label}: 必须为 ${expected}`)
  return expected
}
export function oneOf<const T extends string>(value: unknown, values: readonly T[], label: string): T {
  for (const allowed of values) if (value === allowed) return allowed
  return fail(`${label}: 枚举无效`)
}
export function nullable<T>(value: unknown, parse: (v: unknown, l: string) => T, label: string): T | null {
  return value === null ? null : parse(value, label)
}
export function list<T>(value: unknown, label: string, parse: (v: unknown, l: string) => T, max = 1000, min = 0): T[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) return fail(`${label}: 数组长度越界`)
  return Array.from(value, (v: unknown, i) => parse(v, `${label}[${i}]`))
}
export function unique<T>(values: T[], label: string): T[] {
  if (new Set(values).size !== values.length) fail(`${label}: key 重复`)
  return values
}
export function keys(value: unknown, label: string, max = 1000, min = 0): string[] {
  return unique(list(value, label, key, max, min), label)
}
export function texts(value: unknown, label: string, max = 1000, min = 0): string[] {
  return unique(list(value, label, (v, l) => text(v, l, 2000), max, min), label)
}
export function known(ref: string | null, values: Iterable<string>, label: string): void {
  const set = values instanceof Set ? values : new Set(values)
  if (ref !== null && !set.has(ref)) fail(`${label}: 未知引用 ${ref}`)
}
export function scalar(value: unknown, label: string): string | number | boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return number(value, label)
  return text(value, label)
}
export function numericRecord(value: unknown, label: string): Record<string, number> {
  const row = object(value, label)
  if (Object.keys(row).length > 256) fail(`${label}: 字段过多`)
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [key(k, label), number(v, `${label}.${k}`)]))
}
export const DEGREES = ['critical-success', 'extreme-success', 'hard-success', 'success', 'partial-success', 'failure', 'critical-failure'] as const
export const AUDIENCES = ['gm-only', 'party', 'private', 'public'] as const
export function effectAudience(value: unknown, label: string): 'public' | 'party' | 'gm' | `actor:${string}` {
  if (value === 'public' || value === 'party' || value === 'gm') return value
  if (typeof value === 'string' && value.startsWith('actor:')) return `actor:${key(value.slice(6), label)}`
  return fail(`${label}: 效果受众无效`)
}
export function recipients(audience: string, values: string[], label: string): void {
  if (audience === 'private' && values.length === 0) fail(`${label}: private 必须有明确接收角色`)
}
