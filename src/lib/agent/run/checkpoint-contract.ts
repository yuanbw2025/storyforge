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
