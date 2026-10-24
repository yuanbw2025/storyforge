/** Small process-local cache for deterministic projections, never runtime
 * truth. The entire input is the key; changed visibility, source evidence,
 * reader policy or limits cannot reuse an earlier projection. No hash collision
 * or database identity shortcut. Values are isolated from caller mutation. */
export function createChatHistoryProjectionCacheV1<T>() {
  const entries = new Map<string, {value: T; bytes: number}>()
  let bytes = 0
  const maximumBytes = 4 * 1024 * 1024
  return {
    key(input: unknown): string | null {
      const key = JSON.stringify(input)
      // The retained bound applies to key + value. A large complete input can
      // still have a small projection; save() checks their actual combined size.
      return key.length * 2 <= maximumBytes ? key : null
    },
    read(key: string | null): T | undefined {
      const found = key === null ? undefined : entries.get(key)
      return found === undefined ? undefined : structuredClone(found.value)
    },
    save(key: string | null, value: T): void {
      if (key === null) return
      const size = (key.length + JSON.stringify(value).length) * 2
      if (size > maximumBytes) return
      const prior = entries.get(key)
      if (prior) {bytes -= prior.bytes; entries.delete(key)}
      while (entries.size && (entries.size >= 4 || bytes + size > maximumBytes)) {
        const oldest = entries.keys().next().value!
        bytes -= entries.get(oldest)!.bytes; entries.delete(oldest)
      }
      entries.set(key, {value: structuredClone(value), bytes: size}); bytes += size
    },
  }
}
