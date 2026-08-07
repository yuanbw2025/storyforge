import { sha256Text } from '../../ai/chapter-memory/text-normalization'

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record)
        .filter(key => record[key] !== undefined)
        .sort()
        .map(key => [key, canonicalize(record[key])]),
    )
  }
  return value
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export async function hashCanonicalValue(value: unknown): Promise<string> {
  return sha256Text(canonicalStringify(value))
}
