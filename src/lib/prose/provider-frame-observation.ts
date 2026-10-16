type FrameRange = { separatorStart: number; afterSeparator: number }
type ProseFrameObservationV1 = FrameRange & { version: 1; kind: 'duplicated-answer-frame' | 'separated-answer-frame'; message: string }

/** Literal markers inside fenced examples are ordinary manuscript text. */
function frameRanges(text: string): FrameRange[] {
  const ranges: FrameRange[] = []
  let fence: { character: string; length: number } | null = null
  for (const match of text.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)) {
    if (!match[0].length) continue
    const line = match[1]
    const marker = /^[\t ]*(`{3,}|~{3,})(.*)$/.exec(line)
    if (marker) {
      if (!fence) fence = { character: marker[1][0], length: marker[1].length }
      else if (marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = null
      continue
    }
    if (!fence && /^[\t ]*<\/think>[\t ]*$/.test(line)) ranges.push({ separatorStart: match.index!, afterSeparator: match.index! + match[0].length })
  }
  return ranges
}

function frameBody(value: string): string {
  const lines = value.trim().split(/\r\n?|\n/)
  if (lines[0]?.trim() === '<think>') lines.shift()
  if (/^\s*(?:#{1,6}\s+|第[一二三四五六七八九十百零〇0-9]+章)/.test(lines[0] ?? '')) lines.shift()
  return lines.join('\n').replace(/\s/g, '')
}

/** Observations never strip tags or select a manuscript. */
export function observeDuplicatedProseFrameV1(text: string): ProseFrameObservationV1 | null {
  for (const range of frameRanges(text)) {
    const before = frameBody(text.slice(0, range.separatorStart)), after = frameBody(text.slice(range.afterSeparator))
    if (before.length < 300 || after.length < 300 || Math.min(before.length, after.length) / Math.max(before.length, after.length) < .35) continue
    if (before.slice(0, 48) !== after.slice(0, 48)) continue
    return { version: 1, kind: 'duplicated-answer-frame', ...range, message: '回复在推理分隔符前后重复了正文，疑似混入草稿。原响应保留；请核对并编辑候选后再采纳，没有自动重发。' }
  }
  return null
}

/** Different openings can still be separate answers. Give the author an
 * advisory review action; keep literal text editable and never guess quality. */
export function observeSeparatedProseFrameV1(text: string): ProseFrameObservationV1 | null {
  const ranges = frameRanges(text).filter(value => frameBody(text.slice(value.afterSeparator)).length >= 300)
  const range = ranges[ranges.length - 1]
  if (!range) return null
  const duplicate = observeDuplicatedProseFrameV1(text)
  if (duplicate) return { ...duplicate, ...range }
  return { version: 1, kind: 'separated-answer-frame', ...range, message: '回复中出现独立分隔符，可能包含多份草稿。请核对并编辑候选；原响应保留，没有自动重发。可以保留全文，或选择最后一个分隔符后的内容再核对。' }
}
