/** Stable command identity shared by product runtimes. */
export interface ProductRuntimeCommandEnvelopeV1 {
  sessionId: number
  commandId: string
  baseSequence: number
  baseStateHash: string
}

export function normalizeProductRuntimeCommandIdV1(value: string): string {
  const commandId = value.trim()
  if (!commandId || commandId.length > 200 || !/^[a-zA-Z0-9._:-]+$/.test(commandId)) {
    throw new Error('命令 commandId 无效。')
  }
  return commandId
}
