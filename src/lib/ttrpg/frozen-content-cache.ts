/** Pure V2 parsing memo: actual closed JSON bytes, never a claimed hash or mutable object identity. */
import type { TtrpgVersionedRuntimeContent } from './content-version'

const MAX_ENTRIES = 8
const MAX_INPUT_CHARACTERS = 512 * 1024
const cache = new Map<string, TtrpgVersionedRuntimeContent>()
// Only values produced and deeply frozen here may take the identity fast path.
// An externally frozen input or a claimed contentHash is never enough.
const frozenViews = new WeakMap<object, { sourceWorldHash: string; playerVersion: 1 | 2 }>()
type Snapshot = { key: string; value: unknown }

function freeze(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
  for (const child of Object.values(value)) freeze(child)
  Object.freeze(value)
}

/** Accessors, symbols, holes, exotic objects and non-JSON values use the original parser. */
function snapshot(value: unknown): Snapshot | undefined {
  const visiting = new Set<object>()
  let nodes = 0, characters = 0
  function visit(value: unknown, depth: number): Snapshot {
    if (++nodes > 50000 || depth > 128) throw new Error('uncached content')
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string') {
      const key = Object.is(value, -0) ? '-0' : JSON.stringify(value)
      characters += key.length
      if (characters > MAX_INPUT_CHARACTERS) throw new Error('uncached content')
      return { key, value }
    }
    if (!value || typeof value !== 'object' || visiting.has(value)) throw new Error('uncached content')
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value)
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new Error('uncached content')
    visiting.add(value)
    const keys = Reflect.ownKeys(value)
    if (array && (keys.length !== value.length + 1 || !keys.includes('length'))) throw new Error('uncached content')
    const result = array ? [] : Object.create(prototype)
    const parts: string[] = []
    for (const name of keys) {
      if (array && name === 'length') continue
      const descriptor = Object.getOwnPropertyDescriptor(value, name)
      if (typeof name !== 'string' || !descriptor?.enumerable || !('value' in descriptor)
        || array && name !== String(parts.length)) throw new Error('uncached content')
      const child = visit(descriptor.value, depth + 1)
      Object.defineProperty(result, name, { value: child.value, enumerable: true, configurable: true, writable: true })
      const key = JSON.stringify(name)
      characters += key.length + 3
      if (characters > MAX_INPUT_CHARACTERS) throw new Error('uncached content')
      parts.push(array ? child.key : `${key}:${child.key}`)
    }
    visiting.delete(value)
    return { key: array ? `[${parts.join(',')}]` : `{${parts.join(',')}}`, value: result }
  }
  try { return visit(value, 0) } catch { return undefined }
}

export function parseTtrpgFrozenContentCachedV1(
  value: unknown, sourceWorldHash: string, playerVersion: 1 | 2,
  parse: (value: unknown, sourceWorldHash: string, playerVersion: 1 | 2) => TtrpgVersionedRuntimeContent,
  immutable = false,
): TtrpgVersionedRuntimeContent {
  const trusted = immutable && value && typeof value === 'object' ? frozenViews.get(value) : undefined
  if (trusted && trusted.sourceWorldHash === sourceWorldHash && trusted.playerVersion === playerVersion) return value as TtrpgVersionedRuntimeContent
  const input = snapshot(value)
  const protocol = input?.value && typeof input.value === 'object' && !Array.isArray(input.value)
    ? (input.value as { compatibility?: { runtimeProtocol?: unknown } }).compatibility?.runtimeProtocol : undefined
  if (!input || protocol !== 2 || typeof sourceWorldHash !== 'string' || playerVersion !== 1 && playerVersion !== 2) {
    const parsed = parse(value, sourceWorldHash, playerVersion)
    if (immutable) { freeze(parsed); frozenViews.set(parsed, { sourceWorldHash, playerVersion }) }
    return parsed
  }
  const key = `${JSON.stringify([sourceWorldHash, playerVersion])}:${input.key}`
  const previous = cache.get(key)
  if (previous) {
    cache.delete(key); cache.set(key, previous)
    return immutable ? previous : structuredClone(previous)
  }
  // Parse the same descriptor snapshot used for the key. A caller mutation or
  // proxy cannot put a differently parsed value behind an earlier signature.
  const parsed = parse(input.value, sourceWorldHash, playerVersion)
  const retained = structuredClone(parsed)
  freeze(retained)
  frozenViews.set(retained, { sourceWorldHash, playerVersion })
  cache.set(key, retained)
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!)
  return immutable ? retained : parsed
}
