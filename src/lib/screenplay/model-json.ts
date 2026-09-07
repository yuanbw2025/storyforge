function escapeJsonStringControls(source: string): string {
  let result = ''
  let inString = false
  let escaped = false
  for (const character of source) {
    if (!inString) {
      result += character
      if (character === '"') inString = true
      continue
    }
    if (escaped) {
      result += character
      escaped = false
      continue
    }
    if (character === '\\') {
      result += character
      escaped = true
      continue
    }
    if (character === '"') {
      result += character
      inString = false
      continue
    }
    if (character === '\n') result += '\\n'
    else if (character === '\r') result += '\\r'
    else if (character === '\t') result += '\\t'
    else if (character.charCodeAt(0) < 0x20) result += `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
    else result += character
  }
  return result
}

function escapeLikelyInnerStringQuotes(source: string): string {
  let result = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (!inString) {
      result += character
      if (character === '"') inString = true
      continue
    }
    if (escaped) {
      result += character
      escaped = false
      continue
    }
    if (character === '\\') {
      result += character
      escaped = true
      continue
    }
    if (character !== '"') {
      result += character
      continue
    }
    let lookahead = index + 1
    while (lookahead < source.length && /\s/.test(source[lookahead])) lookahead += 1
    if (lookahead >= source.length || [':', ',', '}', ']'].includes(source[lookahead])) {
      result += character
      inString = false
    } else {
      result += '\\"'
    }
  }
  return result
}

function singleJsonSpan(source: string): string | null {
  const spans: Array<{ start: number; end: number }> = []
  const stack: string[] = []
  let start = -1
  let inString = false
  let escaped = false
  let malformed = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (stack.length > 0 && character === '"') {
      inString = true
      continue
    }
    if (character === '{' || character === '[') {
      if (stack.length === 0) start = index
      stack.push(character)
      continue
    }
    if (character !== '}' && character !== ']') continue
    if (stack.length === 0) {
      malformed = true
      continue
    }
    const opening = stack.pop()
    if ((opening === '{' && character !== '}') || (opening === '[' && character !== ']')) malformed = true
    if (stack.length === 0 && start >= 0) {
      spans.push({ start, end: index + 1 })
      start = -1
    }
  }
  if (malformed || inString || stack.length !== 0 || spans.length !== 1) return null
  return source.slice(spans[0].start, spans[0].end)
}

/**
 * Accept one unambiguous JSON value while tolerating common provider wrapping and
 * invalid control characters inside strings. Domain parsers still enforce every
 * closed field set and reference after this transport-level normalization.
 */
export function parseScreenplayModelJsonV1(raw: string): unknown {
  const normalized = raw.trim().replace(/^\uFEFF/, '')
  if (!normalized || normalized.length > 2_000_000) throw new Error('[screenplay-run] 模型输出为空或过长')
  const candidates = [normalized]
  const extracted = singleJsonSpan(normalized)
  if (extracted && extracted !== normalized) candidates.push(extracted)
  for (const candidate of candidates) {
    try { return JSON.parse(candidate) } catch { /* try bounded transport repair */ }
    const controlsRepaired = escapeJsonStringControls(candidate)
    const repairedVariants = [controlsRepaired, escapeLikelyInnerStringQuotes(controlsRepaired)]
    for (const repaired of repairedVariants) {
      if (repaired === candidate) continue
      try { return JSON.parse(repaired) } catch { /* reject ambiguous or structurally invalid output */ }
    }
  }
  throw new Error('[screenplay-run] 模型输出无法解析为唯一 JSON')
}
