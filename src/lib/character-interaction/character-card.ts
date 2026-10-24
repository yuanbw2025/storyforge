import {createChatPrivateCharacterV1, parseChatPrivateCharactersV1, type ChatCharacterCardOriginV1} from './private-character'

export const CHAT_CARD_FILE_LIMIT = 16 * 1024 * 1024
const JSON_LIMIT = 512 * 1024
const previewIdentities = new WeakMap<object, string>()
export interface ChatCharacterCardPreviewV1 {
  name: string; background: string; personality: string; voice: string
  scenario: string; origin: ChatCharacterCardOriginV1
}
function fail(message: string): never {throw new Error(`角色卡：${message}`)}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('需要 JSON 对象')
  return value as Record<string, unknown>
}
function string(row: Record<string, unknown>, key: string, limit: number) {
  const value = row[key]
  if (typeof value !== 'string' || value.length > limit) fail(`${key} 不是文本或超过 ${limit} 字符；请先在原卡片中修订`)
  return value
}
function decode(bytes: Uint8Array) {
  try {return new TextDecoder('utf-8', {fatal: true}).decode(bytes)} catch {return fail('文本不是有效 UTF-8')}
}
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Read only bounded tEXt metadata; never decode images, execute extensions or fetch URLs. */
function pngCard(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 8, encoded: string | null = null, ended = false, imageData = false
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset), start = offset + 8, end = start + length
    if (end + 4 > bytes.length) fail('PNG 数据不完整')
    const type = String.fromCharCode(...bytes.subarray(offset + 4, start))
    if (crc32(bytes.subarray(offset + 4, end)) !== view.getUint32(end)) fail('PNG 校验失败')
    if (offset === 8 && (type !== 'IHDR' || length !== 13)) fail('PNG 缺少有效图片头')
    if (type === 'IDAT') imageData = true
    if (type === 'tEXt') {
      const content = bytes.subarray(start, end), separator = content.indexOf(0)
      if (separator === 5 && String.fromCharCode(...content.subarray(0, separator)).toLowerCase() === 'chara') {
        if (encoded !== null) fail('PNG 包含多份角色卡，无法确定来源')
        if (length > Math.ceil(JSON_LIMIT / 3) * 4 + 6) fail('嵌入的角色卡过大')
        encoded = decode(content.subarray(separator + 1))
      }
    }
    offset = end + 4
    if (type === 'IEND') {if (length !== 0 || offset !== bytes.length) fail('PNG 结束标记无效'); ended = true; break}
  }
  if (!ended || !imageData || encoded === null) fail('PNG 缺少完整图片或 chara 文本；请从原工具导出 V2 JSON')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) fail('PNG 中的角色卡编码无效')
  return decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)))
}

export async function previewChatCharacterCardV2(input: {bytes: ArrayBuffer; fileName: string}): Promise<ChatCharacterCardPreviewV1> {
  const bytes = new Uint8Array(input.bytes.slice(0))
  if (!bytes.length || bytes.length > CHAT_CARD_FILE_LIMIT || !input.fileName || input.fileName.length > 240) fail('文件为空、名称过长或超过 16 MiB')
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)
  if (!png && bytes.length > JSON_LIMIT) fail('JSON 超过 512 KiB')
  const text = png ? pngCard(bytes) : decode(bytes)
  let value: unknown
  try {value = JSON.parse(text)} catch {fail('无法读取 JSON；支持 V2 JSON 与含 chara 文本的 PNG')}
  const card = object(value), data = object(card.data)
  if (card.spec !== 'chara_card_v2' || card.spec_version !== '2.0') fail('目前只支持 Character Card V2 / 2.0')
  const fields = {
    name: string(data, 'name', 200), background: string(data, 'description', 16000),
    personality: string(data, 'personality', 8000), voice: string(data, 'mes_example', 8000), scenario: string(data, 'scenario', 5000),
  }
  if (!fields.name.trim()) fail('人物姓名为空')
  for (const key of ['first_mes', 'system_prompt', 'post_history_instructions']) string(data, key, JSON_LIMIT)
  for (const key of ['alternate_greetings', 'tags']) {
    if (!Array.isArray(data[key]) || data[key].some(item => typeof item !== 'string')) fail(`${key} 需要文本数组`)
  }
  if (data.extensions !== undefined) object(data.extensions)
  if (data.character_book !== undefined) object(data.character_book)
  const imported = new Set(['name', 'description', 'personality', 'mes_example', 'creator', 'character_version', 'creator_notes'])
  const unsupportedFields = [...Object.keys(card).filter(key => !['spec', 'spec_version', 'data'].includes(key)).map(key => `/${key}`),
    ...Object.keys(data).filter(key => !imported.has(key) && data[key] !== '' && data[key] != null
      && !(Array.isArray(data[key]) && data[key].length === 0)
      && !(typeof data[key] === 'object' && Object.keys(data[key] as object).length === 0)).map(key => `/data/${key}`)].sort()
  const contentHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
  const preview: ChatCharacterCardPreviewV1 = {...fields, origin: {version: 1, format: png ? 'png' : 'json', fileName: input.fileName, contentHash,
    creator: string(data, 'creator', 1000), characterVersion: string(data, 'character_version', 200), creatorNotes: string(data, 'creator_notes', 16000), unsupportedFields}}
  // Validate the same persistent boundary before offering confirmation.
  parseChatPrivateCharactersV1([{...createChatPrivateCharacterV1(), name: fields.name, background: fields.background, personality: fields.personality,
    voice: fields.voice, identity: '外部卡片设定', cardOrigin: preview.origin}])
  previewIdentities.set(preview, JSON.stringify(preview))
  return preview
}

export function confirmChatCharacterCardPreviewV1(preview: ChatCharacterCardPreviewV1, identity: string) {
  if (previewIdentities.get(preview) !== JSON.stringify(preview)) fail('预览已变化，请重新读取原文件')
  const character = {...createChatPrivateCharacterV1(), name: preview.name, background: preview.background, personality: preview.personality,
    voice: preview.voice, identity, cardOrigin: structuredClone(preview.origin)}
  return parseChatPrivateCharactersV1([character])[0]
}
