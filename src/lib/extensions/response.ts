/** Bound bytes while streaming, before materializing untrusted remote bodies. */
export async function readBoundedResponse(response: Response, limit: number): Promise<ArrayBuffer> {
  if (!response.body) throw new Error('响应缺少内容')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw new Error('下载或连接响应超过大小限制')
      chunks.push(value)
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error } finally { reader.releaseLock() }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result.buffer
}
