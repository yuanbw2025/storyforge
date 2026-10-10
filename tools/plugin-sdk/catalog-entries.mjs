/** Rebuilding reference packages must preserve community and previous-version listings. */
export function mergeCatalogEntries(existing, reference) {
  const key = entry => `${entry.id}@${entry.version}`
  const next = new Map(reference.map(entry => [key(entry), entry]))
  if (next.size !== reference.length) throw new Error('Duplicate reference catalog identity')
  const seen = new Set()
  for (const entry of existing) {
    const identity = key(entry)
    if (seen.has(identity)) throw new Error(`Duplicate existing catalog identity: ${identity}`)
    seen.add(identity)
    if (!next.has(identity)) next.set(identity, entry)
  }
  return [...next.values()]
}
