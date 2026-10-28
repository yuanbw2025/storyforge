/** One shared, bounded provider JSON-object normalizer. Pure transport parsing
 * stays independent of production dispatchers and product Context readers. */
type JsonRecord = Record<string, unknown>
function fail(message: string): never { throw new Error(`[product-production-executor] ${message}`) }
function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as JsonRecord
}

export function parseProductionModelJsonObjectV1(output: string, label: string): JsonRecord {
  const normalized = output.trim().replace(/^\uFEFF/, '')
  if (!normalized || normalized.length > 2_000_000) fail(`${label} 模型输出为空或过长`)

  try {
    return record(JSON.parse(normalized), label)
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('[product-production-executor]')) throw cause
  }

  // Some OpenAI-compatible providers ignore response_format and wrap the one requested
  // object in prose or a Markdown fence. Recover only one unambiguous, balanced object;
  // the strict artifact parsers below still enforce every field and relationship.
  const spans: Array<{ start: number; end: number }> = []
  let objectStart = -1
  let objectDepth = 0
  let arrayDepth = 0
  let inString = false
  let escaped = false
  let malformedStructure = false
  for (let index = 0; index < normalized.length; index++) {
    const character = normalized[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if ((objectDepth > 0 || arrayDepth > 0) && character === '"') {
      inString = true
      continue
    }
    if (character === '[') {
      arrayDepth++
      continue
    }
    if (character === ']') {
      if (arrayDepth === 0) malformedStructure = true
      else arrayDepth--
      continue
    }
    if (character === '{') {
      if (objectDepth === 0 && arrayDepth === 0) objectStart = index
      objectDepth++
      continue
    }
    if (character === '}') {
      if (objectDepth === 0) {
        malformedStructure = true
        continue
      }
      objectDepth--
      if (objectDepth === 0 && objectStart >= 0) {
        spans.push({ start: objectStart, end: index + 1 })
        objectStart = -1
      }
    }
  }
  if (inString || objectDepth !== 0 || arrayDepth !== 0 || malformedStructure || spans.length !== 1) {
    fail(`${label} 必须只包含一个完整 JSON 对象`)
  }
  try {
    return record(JSON.parse(normalized.slice(spans[0].start, spans[0].end)), label)
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('[product-production-executor]')) throw cause
    fail(`${label} 不是合法 JSON`)
  }
}
