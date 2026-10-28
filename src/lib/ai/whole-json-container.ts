/** Accept only the entire JSON text or one whole JSON code block. The model's
 * raw response remains in the durable run; this never repairs the JSON body. */
export function wholeJSONContainerTextV1(output: string, label = '候选'): string {
  if (typeof output !== 'string') throw new Error(`${label}必须是文本。`)
  const input = output.trim()
  if (!input.startsWith('```') && !input.endsWith('```')) return input
  const block = /^```(?:json)?[ \t]*\r?\n([\s\S]*)\r?\n```$/i.exec(input)
  if (!block) throw new Error(`${label}需要完整的 JSON 内容；代码块外不能附带说明。`)
  return block[1].trim()
}

