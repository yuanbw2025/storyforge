/** Serialize the already-governed snapshot without one project-sized string.
 * Table rows remain ordinary JSON; neither schema nor record selection changes.
 */
export function createProjectJSONBlob(data: object): Blob {
  const parts: BlobPart[] = ['{']
  let first = true
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    if (!first) parts.push(',')
    first = false
    parts.push(`${JSON.stringify(key)}:`)
    if (Array.isArray(value)) {
      parts.push('[')
      for (let index = 0; index < value.length; index += 32) {
        const rows = value.slice(index, index + 32).map(row => JSON.stringify(row) ?? 'null')
        parts.push(new Blob([`${index ? ',' : ''}${rows.join(',')}`]))
      }
      parts.push(']')
    } else {
      parts.push(new Blob([JSON.stringify(value)]))
    }
  }
  parts.push('}')
  return new Blob(parts, { type: 'application/json' })
}

/** Read table rows separately so a valid large backup never needs File.text().
 * JSON.parse still validates every complete value. The normal backup trust and
 * registry import boundaries remain responsible for schema and data integrity.
 */
export async function readProjectJSONFile(file: Blob): Promise<unknown> {
  const reader = file.stream().getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const result: Record<string, unknown> = {}
  type Phase = 'root' | 'key-or-end' | 'key' | 'colon' | 'value'
    | 'item-or-end' | 'item' | 'after-item' | 'after-value' | 'done'
  let phase: Phase = 'root'
  let key = ''
  let array: unknown[] | null = null
  let tokenKind: 'key' | 'value' | null = null
  let fragments: string[] = []
  let tokenLength = 0
  let depth = 0
  let quoted = false
  let escaped = false
  const fail = (): never => { throw new Error('备份文件不是完整、合法的 JSON 对象。') }
  const append = (text: string) => {
    tokenLength += text.length
    // One record is bounded independently of project size and stays well
    // below the engine's string limit even when other tables are enormous.
    if (tokenLength > 128 * 1024 * 1024) throw new Error('备份单条记录超过 128 MiB 字符限制。')
    fragments.push(text)
  }
  const finish = () => {
    const value: unknown = JSON.parse(fragments.join(''))
    fragments = []
    tokenLength = 0
    if (tokenKind === 'key') {
      if (typeof value !== 'string') return fail()
      if (Object.prototype.hasOwnProperty.call(result, value)) fail()
      key = value
      phase = 'colon'
    } else if (array) {
      array.push(value)
      phase = 'after-item'
    } else {
      Object.defineProperty(result, key, { value, enumerable: true, configurable: true })
      phase = 'after-value'
    }
    tokenKind = null
  }
  const consume = (text: string) => {
    let start = tokenKind ? 0 : -1
    for (let i = 0; i < text.length; i++) {
      const char = text[i]!
      if (tokenKind) {
        if (tokenKind === 'value' && !quoted && depth === 0 && /[\s,}\]]/.test(char)) {
          append(text.slice(start, i))
          finish()
          start = -1
          i--
          continue
        }
        if (quoted) {
          if (escaped) escaped = false
          else if (char === '\\') escaped = true
          else if (char === '"') {
            quoted = false
            if (tokenKind === 'key') {
              append(text.slice(start, i + 1))
              finish()
              start = -1
            }
          }
        } else if (char === '"') quoted = true
        else if (char === '{' || char === '[') depth++
        else if (char === '}' || char === ']') depth--
        continue
      }
      if (/[\t\n\r ]/.test(char)) continue
      if (phase === 'root') {
        if (char !== '{') fail()
        phase = 'key-or-end'
      } else if (phase === 'key' || phase === 'key-or-end') {
        if (char === '}' && phase === 'key-or-end') { phase = 'done'; continue }
        if (char !== '"') fail()
        tokenKind = 'key'; quoted = true; escaped = false; depth = 0; start = i
      } else if (phase === 'colon') {
        if (char !== ':') fail()
        phase = 'value'
      } else if (phase === 'value' || phase === 'item' || phase === 'item-or-end') {
        if (phase === 'value' && char === '[') { array = []; phase = 'item-or-end'; continue }
        if (phase === 'item-or-end' && char === ']') {
          Object.defineProperty(result, key, { value: array, enumerable: true, configurable: true })
          array = null; phase = 'after-value'; continue
        }
        if (char === ']' || char === '}' || char === ',') fail()
        tokenKind = 'value'; quoted = char === '"'; escaped = false
        depth = char === '{' || char === '[' ? 1 : 0
        start = i
      } else if (phase === 'after-item') {
        if (char === ',') phase = 'item'
        else if (char === ']') {
          Object.defineProperty(result, key, { value: array, enumerable: true, configurable: true })
          array = null; phase = 'after-value'
        } else fail()
      } else if (phase === 'after-value') {
        if (char === ',') phase = 'key'
        else if (char === '}') phase = 'done'
        else fail()
      } else fail()
    }
    if (tokenKind && start >= 0) append(text.slice(start))
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      consume(decoder.decode(value, { stream: true }))
    }
    consume(decoder.decode())
    if ((phase as Phase) !== 'done' || tokenKind) fail()
    return result
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
}
