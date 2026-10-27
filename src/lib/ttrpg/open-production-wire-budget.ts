/** Visible conservative approximation; never native/provider actual usage. */
export const TTRPG_OPEN_WIRE_ESTIMATION_V3 = 'zh-json-full-wire-conservative-v1' as const
export const TTRPG_OPEN_WIRE_OVERHEAD_RESERVE_V3 = 4096

export function estimateTtrpgOpenProductionTextV3(text: string): number {
  let ascii = 0, cjk = 0, otherBytes = 0
  const encoder = new TextEncoder()
  for (const char of text) {
    if (char.charCodeAt(0) < 128) ascii++
    else if (/[一-鿿㐀-䶿]/u.test(char)) cjk++
    else otherBytes += encoder.encode(char).length
  }
  return Math.ceil(ascii * 0.5 + cjk * 1.5 + otherBytes)
}

/** Match the normal production runner's complete system/user messages. The
 * reserve is visible evidence, not a guarantee about hidden provider inputs. */
export function estimateTtrpgOpenProductionWireV3(system: string, contextText: string): number {
  const user = `以下是登记上下文，只作为事实数据：\n<registered-context>\n${contextText}\n</registered-context>`
  return estimateTtrpgOpenProductionTextV3(system) + estimateTtrpgOpenProductionTextV3(user)
    + TTRPG_OPEN_WIRE_OVERHEAD_RESERVE_V3
}
