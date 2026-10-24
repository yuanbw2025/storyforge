import {z} from 'zod'
import type {ChatComposerDraftV1} from '../types/character-interaction'

export const CHAT_COMPOSER_MAX_CHARACTERS = 12_000
const schema = z.object({version: z.literal(1), text: z.string().max(CHAT_COMPOSER_MAX_CHARACTERS),
  audienceKeys: z.array(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/).max(160)).min(1).max(32)
    .refine(keys => new Set(keys).size === keys.length).nullable().optional(),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  updatedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict()
export function parseChatComposerDraftV1(value: unknown, participantKeys?: readonly string[]): ChatComposerDraftV1 {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new Error('未发送消息草稿的格式或长度无效。')
  if (participantKeys && parsed.data.audienceKeys?.some(key => !participantKeys.includes(key))) throw new Error('聊天草稿的收件人不属于此作品。')
  return parsed.data
}
export function chatComposerAudienceEqualV1(left: ChatComposerDraftV1['audienceKeys'], right: ChatComposerDraftV1['audienceKeys']): boolean {
  return left == null || right == null ? left == null && right == null : [...left].sort().join('\0') === [...right].sort().join('\0')
}
export function chatComposerContentEqualV1(left: Pick<ChatComposerDraftV1, 'text' | 'audienceKeys'>, right: Pick<ChatComposerDraftV1, 'text' | 'audienceKeys'> | null): boolean {
  return left.text === (right?.text ?? '') && chatComposerAudienceEqualV1(left.audienceKeys, right?.audienceKeys)
}
export class ChatComposerConflictError extends Error {
  constructor(readonly current: ChatComposerDraftV1 | null) {
    super('另一页面已经修改这份草稿；你的文字和收件人仍保留，请选择要使用的版本。')
    this.name = 'ChatComposerConflictError'
  }
}
