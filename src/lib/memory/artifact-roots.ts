/** Pure extraction of registered owner references. These roots confer retention, never read/write authority. */
import type { ExactArtifactRootSpecV1 } from '../registry/types'
import type { ExactRunArtifactIdentityV1, ExactRunArtifactKindV1 } from '../types'

const KINDS = new Set<ExactRunArtifactKindV1>(['context-manifest', 'selector-result', 'context-packet', 'source-snapshot', 'tool-result', 'rendered-request', 'raw-response'])
const HASH = /^[a-f0-9]{64}$/
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
function fail(): never { throw new Error('已登记拥有者的逐字证据引用损坏，清理已停止。') }

export function extractExactArtifactOwnerRootsV1(row: Readonly<Record<string, unknown>>, specs: readonly ExactArtifactRootSpecV1[]): ExactRunArtifactIdentityV1[] {
  const refs = new Map<string, ExactRunArtifactIdentityV1>()
  function leaf(value: unknown) {
    if (value === null || value === undefined) return
    if (!Array.isArray(value)) fail()
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).sort().join(',') !== 'artifactKind,contentHash'
        || typeof item.artifactKind !== 'string' || !KINDS.has(item.artifactKind as ExactRunArtifactKindV1)
        || typeof item.contentHash !== 'string' || !HASH.test(item.contentHash)) fail()
      const ref = { artifactKind: item.artifactKind as ExactRunArtifactKindV1, contentHash: item.contentHash }
      refs.set(ref.artifactKind + ':' + ref.contentHash, ref)
    }
  }
  function walk(value: unknown, path: readonly string[], at: number): void {
    if (value === null || value === undefined) return
    if (at === path.length) { leaf(value); return }
    const key = path[at]
    if (key === '*') {
      if (!Array.isArray(value)) fail()
      for (const child of value) walk(child, path, at + 1)
    } else {
      if (typeof value !== 'object' || Array.isArray(value)) fail()
      if (own(value, key)) walk((value as Record<string, unknown>)[key], path, at + 1)
    }
  }
  for (const spec of specs) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(spec.field) || spec.path.some(k => k !== '*' && (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(k) || ['__proto__', 'prototype', 'constructor'].includes(k)))) fail()
    if (spec.when) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(spec.when.field) || typeof spec.when.equals !== 'string') fail()
      if (!own(row, spec.when.field) || row[spec.when.field] !== spec.when.equals) continue
    }
    const raw = own(row, spec.field) ? row[spec.field] : undefined
    if (raw === null || raw === undefined) continue
    if (typeof raw !== 'string') fail()
    let value: unknown
    try { value = JSON.parse(raw) } catch { fail() }
    walk(value, spec.path, 0)
  }
  return [...refs.values()].sort((a, b) => { const left = a.artifactKind + ':' + a.contentHash, right = b.artifactKind + ':' + b.contentHash; return left < right ? -1 : left > right ? 1 : 0 })
}
