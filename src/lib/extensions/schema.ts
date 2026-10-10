import type { DataSchema, Json } from './types'

const keywords = new Set(['type', 'description', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength', 'maxItems'])
const unsafe = new Set(['__proto__', 'prototype', 'constructor'])
export function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}
export function assertJson(value: unknown, depth = 0): asserts value is Json {
  if (depth > 32) throw new Error('JSON 嵌套超过 32 层')
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (Array.isArray(value)) { value.forEach(item => assertJson(item, depth + 1)); return }
  if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (unsafe.has(key)) throw new Error(`禁止的 JSON 属性：${key}`)
      assertJson(item, depth + 1)
    }
    return
  }
  throw new Error('只接受有限数值和纯 JSON 数据')
}
export function checkSchema(schema: unknown, depth = 0): asserts schema is DataSchema {
  if (!isObject(schema) || depth > 12) throw new Error('数据 schema 无效或嵌套过深')
  for (const key of Object.keys(schema)) if (!keywords.has(key)) throw new Error(`不支持的 schema 关键字：${key}`)
  if (!['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(String(schema.type))) throw new Error('schema 必须声明受支持的 type')
  if (schema.description !== undefined && typeof schema.description !== 'string') throw new Error('schema description 无效')
  if (schema.properties !== undefined) {
    if (schema.type !== 'object' || !isObject(schema.properties)) throw new Error('properties 只适用于 object')
    for (const [key, child] of Object.entries(schema.properties)) { if (unsafe.has(key)) throw new Error('非法 schema 字段'); checkSchema(child, depth + 1) }
  }
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some(k => typeof k !== 'string' || !isObject(schema.properties) || !Object.prototype.hasOwnProperty.call(schema.properties, k)))) throw new Error('required 必须指向已声明字段')
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') throw new Error('additionalProperties 必须为布尔值')
  if (schema.type === 'array') checkSchema(schema.items, depth + 1)
  else if (schema.items !== undefined) throw new Error('items 只适用于 array')
  if (schema.required !== undefined && schema.type !== 'object') throw new Error('required 只适用于 object')
  if (schema.enum !== undefined) { if (!Array.isArray(schema.enum) || !schema.enum.length) throw new Error('enum 无效'); assertJson(schema.enum) }
  for (const key of ['minLength', 'maxLength', 'maxItems']) if (schema[key] !== undefined && (!Number.isInteger(schema[key]) || Number(schema[key]) < 0)) throw new Error(`${key} 必须为非负整数`)
  for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', 'maxItems']) if (schema[key] !== undefined && (typeof schema[key] !== 'number' || !Number.isFinite(schema[key]))) throw new Error(`${key} 必须为有限数字`)
}
/** Deliberately bounded JSON Schema profile: no eval, network refs, regex or dynamic compilation. */
export function validateData(schema: DataSchema, value: unknown, path = '$'): asserts value is Json {
  assertJson(value)
  if (JSON.stringify(value).length > 1_000_000) throw new Error('单条插件数据超过 1 MB')
  const fail = (message: string): never => { throw new Error(`${path}：${message}`) }
  if (schema.enum && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) fail('值不在 enum 内')
  if (schema.type === 'object') {
    if (!isObject(value)) fail('需要对象')
    const row = value as Record<string, unknown>
    for (const key of schema.required ?? []) if (!Object.prototype.hasOwnProperty.call(row, key)) fail(`缺少 ${key}`)
    for (const [key, item] of Object.entries(row)) {
      const child = schema.properties && Object.prototype.hasOwnProperty.call(schema.properties, key) ? schema.properties[key] : undefined
      if (child) validateData(child, item, `${path}.${key}`)
      else if (schema.additionalProperties !== true) fail(`未知字段 ${key}`)
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) fail('需要数组')
    const items = value as unknown[]
    if (items.length > (schema.maxItems ?? 10000)) fail('数组过长')
    items.forEach((item, i) => validateData(schema.items!, item, `${path}[${i}]`))
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') fail('需要字符串')
    if ((value as string).length < (schema.minLength ?? 0) || (value as string).length > (schema.maxLength ?? 1_000_000)) fail('字符串长度越界')
  } else if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value))) fail('需要有效数值')
    if ((value as number) < (schema.minimum ?? -Infinity) || (value as number) > (schema.maximum ?? Infinity)) fail('数值越界')
  } else if (schema.type === 'null' ? value !== null : typeof value !== 'boolean') fail(`需要 ${schema.type}`)
}
