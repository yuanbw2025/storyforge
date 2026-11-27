export const WORLDVIEW_TEXT_COMPARISON_VERSION_V1 = 'worldview-text-block-compare-v1'

export type WorldviewTextBlockStatusV1 =
  | 'unchanged'
  | 'possibly-rewritten'
  | 'removed'
  | 'added'

export interface WorldviewTextComparisonRowV1 {
  id: string
  status: WorldviewTextBlockStatusV1
  original: string
  candidate: string
  similarity: number | null
}

export interface WorldviewTextComparisonV1 {
  version: typeof WORLDVIEW_TEXT_COMPARISON_VERSION_V1
  rows: WorldviewTextComparisonRowV1[]
  counts: Record<WorldviewTextBlockStatusV1, number>
}

function normalize(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('zh-CN')
}

function blocks(value: string): string[] {
  return value
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n+/)
    .map(block => block.trim())
    .filter(Boolean)
}

function headingKey(value: string): string | null {
  const first = value.split('\n', 1)[0]?.trim() ?? ''
  const match = /^(?:#{1,6}\s*|【|第?\d+[、.．)）]\s*)(.+?)(?:】)?$/.exec(first)
  return match ? normalize(match[1]) : null
}

function tokens(value: string): Set<string> {
  const normalized = normalize(value)
  const result = new Set<string>()
  const words = normalized.match(/[a-z0-9]+/g) ?? []
  words.forEach(word => result.add(`w:${word}`))
  const cjk = [...normalized].filter(char => /[一-鿿㐀-䶿]/.test(char))
  if (cjk.length === 1) result.add(`c:${cjk[0]}`)
  for (let index = 0; index < cjk.length - 1; index += 1) {
    result.add(`c:${cjk[index]}${cjk[index + 1]}`)
  }
  return result
}

function similarity(left: string, right: string): number {
  const a = tokens(left)
  const b = tokens(right)
  if (!a.size && !b.size) return 1
  let intersection = 0
  a.forEach(token => { if (b.has(token)) intersection += 1 })
  return intersection / Math.max(1, a.size + b.size - intersection)
}

function shortId(index: number, status: WorldviewTextBlockStatusV1, left: string, right: string): string {
  const value = `${index}\u0000${status}\u0000${normalize(left)}\u0000${normalize(right)}`
  let hash = 0x811c9dc5
  for (let offset = 0; offset < value.length; offset += 1) {
    hash ^= value.charCodeAt(offset)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${index}-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function compareWorldviewTextBlocksV1(
  originalText: string,
  candidateText: string,
): WorldviewTextComparisonV1 {
  const original = blocks(originalText)
  const candidate = blocks(candidateText)
  const usedOriginal = new Set<number>()
  const usedCandidate = new Set<number>()
  const pairs: Array<{ originalIndex: number; candidateIndex: number; status: 'unchanged' | 'possibly-rewritten'; similarity: number }> = []

  // Pass 1: stable order + normalized paragraph identity.
  let candidateFloor = 0
  original.forEach((block, originalIndex) => {
    const normalized = normalize(block)
    const candidateIndex = candidate.findIndex((other, index) => (
      index >= candidateFloor && !usedCandidate.has(index) && normalize(other) === normalized
    ))
    if (candidateIndex < 0) return
    usedOriginal.add(originalIndex)
    usedCandidate.add(candidateIndex)
    candidateFloor = candidateIndex + 1
    pairs.push({ originalIndex, candidateIndex, status: 'unchanged', similarity: 1 })
  })

  // Pass 2: same heading first, then conservative shingle similarity.
  original.forEach((block, originalIndex) => {
    if (usedOriginal.has(originalIndex)) return
    const heading = headingKey(block)
    let best: { candidateIndex: number; score: number } | null = null
    for (let candidateIndex = 0; candidateIndex < candidate.length; candidateIndex += 1) {
      if (usedCandidate.has(candidateIndex)) continue
      const other = candidate[candidateIndex]
      const score = similarity(block, other)
      const headingMatch = heading != null && heading === headingKey(other)
      const qualified = headingMatch ? score >= 0.2 : score >= 0.45
      if (qualified && (!best || score > best.score || (score === best.score && candidateIndex < best.candidateIndex))) {
        best = { candidateIndex, score }
      }
    }
    if (!best) return
    usedOriginal.add(originalIndex)
    usedCandidate.add(best.candidateIndex)
    pairs.push({
      originalIndex,
      candidateIndex: best.candidateIndex,
      status: 'possibly-rewritten',
      similarity: Number(best.score.toFixed(3)),
    })
  })

  const rows: WorldviewTextComparisonRowV1[] = []
  const pairedOriginal = new Map(pairs.map(pair => [pair.originalIndex, pair]))
  const pairedCandidate = new Map(pairs.map(pair => [pair.candidateIndex, pair]))
  let originalIndex = 0
  let candidateIndex = 0
  while (originalIndex < original.length || candidateIndex < candidate.length) {
    if (originalIndex >= original.length) {
      rows.push({ id: '', status: 'added', original: '', candidate: candidate[candidateIndex], similarity: null })
      candidateIndex += 1
      continue
    }
    if (candidateIndex >= candidate.length) {
      rows.push({ id: '', status: 'removed', original: original[originalIndex], candidate: '', similarity: null })
      originalIndex += 1
      continue
    }
    const pairFromOriginal = pairedOriginal.get(originalIndex)
    const pairFromCandidate = pairedCandidate.get(candidateIndex)
    if (pairFromOriginal && pairFromOriginal.candidateIndex === candidateIndex) {
      rows.push({
        id: '',
        status: pairFromOriginal.status,
        original: original[originalIndex],
        candidate: candidate[candidateIndex],
        similarity: pairFromOriginal.similarity,
      })
      originalIndex += 1
      candidateIndex += 1
      continue
    }
    if (!pairFromOriginal) {
      rows.push({ id: '', status: 'removed', original: original[originalIndex], candidate: '', similarity: null })
      originalIndex += 1
      continue
    }
    if (!pairFromCandidate) {
      rows.push({ id: '', status: 'added', original: '', candidate: candidate[candidateIndex], similarity: null })
      candidateIndex += 1
      continue
    }
    // Crossed matches are deliberately not forced together; preserving visible
    // order is safer than presenting a misleading semantic alignment.
    if (pairFromOriginal.candidateIndex > candidateIndex) {
      rows.push({ id: '', status: 'added', original: '', candidate: candidate[candidateIndex], similarity: null })
      candidateIndex += 1
    } else {
      rows.push({ id: '', status: 'removed', original: original[originalIndex], candidate: '', similarity: null })
      originalIndex += 1
    }
  }
  const withIds = rows.map((row, index) => ({
    ...row,
    id: shortId(index, row.status, row.original, row.candidate),
  }))
  const counts: WorldviewTextComparisonV1['counts'] = {
    unchanged: 0,
    'possibly-rewritten': 0,
    removed: 0,
    added: 0,
  }
  withIds.forEach(row => { counts[row.status] += 1 })
  return { version: WORLDVIEW_TEXT_COMPARISON_VERSION_V1, rows: withIds, counts }
}
