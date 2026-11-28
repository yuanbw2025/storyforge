import { readString } from './schema-utils'

/** Historical envelope constants remain available to callers that explicitly
 * choose a bounded diagnostic read. Authoring, persistence and portability do
 * not derive a content quota from them. Actual storage failures remain visible. */
export const AGENT_RUN_MAXIMUM_RESUME_PAYLOAD_BYTES_V1 = 32 * 1024 * 1024
export const AGENT_RUN_MAXIMUM_CONTRACT_JSON_BYTES_V1 = 32 * 1024 * 1024

/** The existing nonempty-string normalization is unchanged. Contract structure,
 * authority and hashes are still verified by their original readers. */
export function readAgentRunContractJsonV1(value: unknown, path: string): string {
  return readString(value, path)
}

/** Exact UTF-8 byte count without allocating a second payload-sized buffer. */
export function agentRunUtf8ByteLengthV1(value: string): number {
  if (value.length >= 64 * 1024 && typeof TextEncoder !== 'undefined'
    && typeof TextEncoder.prototype.encodeInto === 'function') {
    const encoder = new TextEncoder()
    const buffer = new Uint8Array(64 * 1024)
    let bytes = 0
    for (let index = 0; index < value.length;) {
      let end = Math.min(index + 16 * 1024, value.length)
      // USVString conversion must see both halves of a pair at a chunk edge.
      if (end < value.length && value.charCodeAt(end - 1) >= 0xd800
        && value.charCodeAt(end - 1) <= 0xdbff
        && value.charCodeAt(end) >= 0xdc00 && value.charCodeAt(end) <= 0xdfff) end += 1
      const chunk = value.slice(index, end)
      const encoded = encoder.encodeInto(chunk, buffer)
      // Each chunk fits even at three bytes per UTF-16 code unit. Preserve
      // the original exact counter if an older polyfill reads only part.
      if (encoded.read !== chunk.length) return countUtf8CodeUnits(value)
      bytes += encoded.written
      index = end
    }
    return bytes
  }
  return countUtf8CodeUnits(value)
}

function countUtf8CodeUnits(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x7f) bytes += 1
    else if (code <= 0x7ff) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff
      && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00
      && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4
      index += 1
    } else bytes += 3
  }
  return bytes
}
