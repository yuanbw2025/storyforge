import Dexie from 'dexie'

const HASH_PATTERN = /^[0-9a-f]{64}$/

type CanonicalObjectKey = Readonly<{ original: string; normalized: string; encoded: string }>
const canonicalObjectKeyCache = new Map<string, CanonicalObjectKey>()

function canonicalObjectKey(key: string): CanonicalObjectKey {
  const cached = canonicalObjectKeyCache.get(key)
  if (cached) return cached
  const normalized = key.normalize('NFC')
  const result = { original: key, normalized, encoded: JSON.stringify(normalized) }
  // Only immutable key encodings are reusable. Never retain a caller object,
  // member value or verification result; arbitrary keys cannot grow this map.
  if (key.length <= 128 && canonicalObjectKeyCache.size < 512) {
    canonicalObjectKeyCache.set(key, Object.freeze(result))
  }
  return result
}

function compareCodePoints(left: string, right: string): number {
  // Walk Unicode scalar/standalone-surrogate values exactly as string
  // iteration does, without allocating two whole arrays for every comparison.
  let leftIndex=0,rightIndex=0
  while(leftIndex<left.length&&rightIndex<right.length){
    const a=left.codePointAt(leftIndex)!,b=right.codePointAt(rightIndex)!
    if(a!==b)return a-b
    leftIndex+=a>0xffff?2:1
    rightIndex+=b>0xffff?2:1
  }
  return leftIndex===left.length?(rightIndex===right.length?0:-1):1
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
    const normalizedEntries = Object.keys(record).map(canonicalObjectKey)
    // Object.keys is already unique. A collision is possible only when NFC
    // changes at least one key; all changed-key inputs retain the full check.
    if (normalizedEntries.some(entry => entry.original !== entry.normalized)
      && new Set(normalizedEntries.map(entry => entry.normalized)).size !== normalizedEntries.length) {
      throw new Error('[product-production] NFC 规范化后出现重复对象 key')
    }
    return `{${normalizedEntries
      .sort((left, right) => compareCodePoints(left.normalized, right.normalized))
      .map(entry => {
        if (record[entry.original] === undefined) throw new Error('[product-production] canonical JSON 不接受 undefined 字段')
        return `${entry.encoded}:${canonicalJson(record[entry.original], ancestors)}`
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
