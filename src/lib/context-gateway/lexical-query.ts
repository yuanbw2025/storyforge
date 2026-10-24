interface ContextQueryTermV1 {
  value: string
  weight: number
}

const MAX_CONTEXT_QUERY_TERMS = 192

function evenlySampleTerms(terms: readonly ContextQueryTermV1[], limit: number): ContextQueryTermV1[] {
  if (terms.length <= limit) return [...terms]
  if (limit <= 1) return [terms[0]!]
  const sampled: ContextQueryTermV1[] = []
  const indexes = new Set<number>()
  for (let index = 0; index < limit; index++) {
    indexes.add(Math.round(index * (terms.length - 1) / (limit - 1)))
  }
  for (const index of [...indexes].sort((left, right) => left - right)) sampled.push(terms[index]!)
  return sampled
}

/**
 * Builds a bounded, language-agnostic lexical query plan. Whitespace-only
 * tokenization makes an ordinary Chinese question one opaque token, so a
 * relevant late catalog resource can never outrank generic entries. CJK
 * n-grams preserve phrase evidence without adding a model call; uniform
 * sampling keeps both the beginning and end of long requests represented.
 */
function contextQueryTerms(query: string): ContextQueryTermV1[] {
  const normalized = query.normalize('NFC').toLocaleLowerCase('zh-CN')
  const runs = normalized.match(/[\p{Script=Han}]+|[\p{L}\p{N}]+/gu) ?? []
  const weighted = new Map<string, number>()
  const add = (value: string, weight: number): void => {
    if (value.length < 2) return
    weighted.set(value, Math.max(weighted.get(value) ?? 0, weight))
  }
  for (const run of runs) {
    const characters = [...run]
    if (/^\p{Script=Han}+$/u.test(run)) {
      if (characters.length <= 48) add(run, Math.min(12, characters.length + 2))
      for (const size of [4, 3, 2]) {
        if (characters.length < size) continue
        for (let index = 0; index <= characters.length - size; index++) {
          add(characters.slice(index, index + size).join(''), size)
        }
      }
    } else {
      add(run, Math.min(8, characters.length))
    }
  }
  const terms = [...weighted].map(([value, weight]) => ({ value, weight }))
  return evenlySampleTerms(terms, MAX_CONTEXT_QUERY_TERMS)
}


/** Compile the existing Gateway lexical query once for a bounded candidate set. */
export function createContextTextScorerV1(query: string): (text: string) => number {
  const terms = contextQueryTerms(query)
  const availableWeight = terms.reduce((sum, term) => sum + term.weight, 0)
  return text => {
    if (!availableWeight) return 0
    const normalized = text.toLocaleLowerCase('zh-CN')
    return terms.reduce((sum, term) => sum + (normalized.includes(term.value) ? term.weight : 0), 0) / availableWeight
  }
}
