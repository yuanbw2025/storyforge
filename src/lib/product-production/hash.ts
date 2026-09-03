import Dexie from 'dexie'

const HASH_PATTERN = /^[0-9a-f]{64}$/

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left)
  const rightPoints = Array.from(right)
  const length = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < length; index += 1) {
    const delta = leftPoints[index].codePointAt(0)! - rightPoints[index].codePointAt(0)!
    if (delta !== 0) return delta
  }
  return leftPoints.length - rightPoints.length
}

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('[product-production] canonical JSON 不接受 NaN 或 Infinity')
  if (Object.is(value, -0)) return '0'
  return JSON.stringify(value)
}

function canonicalJson(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'))
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return canonicalNumber(value)
  if (typeof value === 'undefined') throw new Error('[product-production] canonical JSON 不接受 undefined')
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    throw new Error(`[product-production] canonical JSON 不支持 ${typeof value}`)
  }
  if (!value || typeof value !== 'object') throw new Error('[product-production] canonical JSON 值无效')
  if (ancestors.has(value)) throw new Error('[product-production] canonical JSON 不接受循环引用')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const items: string[] = []
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new Error('[product-production] canonical JSON 不接受稀疏数组')
        }
        items.push(canonicalJson(value[index], ancestors))
      }
      return `[${items.join(',')}]`
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('[product-production] canonical JSON 只接受普通对象')
    }
    const record = value as Record<string, unknown>
    const normalizedEntries = Object.keys(record).map(key => ({ original: key, normalized: key.normalize('NFC') }))
    if (new Set(normalizedEntries.map(entry => entry.normalized)).size !== normalizedEntries.length) {
      throw new Error('[product-production] NFC 规范化后出现重复对象 key')
    }
    return `{${normalizedEntries
      .sort((left, right) => compareCodePoints(left.normalized, right.normalized))
      .map(entry => {
        if (record[entry.original] === undefined) throw new Error('[product-production] canonical JSON 不接受 undefined 字段')
        return `${JSON.stringify(entry.normalized)}:${canonicalJson(record[entry.original], ancestors)}`
      })
      .join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

/** Strict `storyforge-canonical-json-v2` serializer used by all production hashes. */
export function canonicalProductProductionJsonV2(value: unknown): string {
  return canonicalJson(value, new Set())
}

export async function hashProductProductionValueV2(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalProductProductionJsonV2(value))
  const digestPromise = crypto.subtle.digest('SHA-256', bytes)
  const digest = Dexie.currentTransaction ? await Dexie.waitFor(digestPromise) : await digestPromise
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function isSha256Hash(value: unknown): value is string {
  return typeof value === 'string' && HASH_PATTERN.test(value)
}
