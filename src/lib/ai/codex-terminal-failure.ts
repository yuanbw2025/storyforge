import {z} from 'zod'

/** A matched provider turn outcome, not permission to replay or evidence of zero cost. */
export const CodexTerminalFailureV1Schema = z.object({
  version: z.literal(1), provider: z.literal('codex'),
  requestId: z.string().trim().min(1).max(200), model: z.string().trim().min(1).max(200),
  providerTurn: z.object({
    threadId: z.string().trim().min(1).max(200), turnId: z.string().trim().min(1).max(200),
    status: z.enum(['failed', 'interrupted']),
  }).strict(),
}).strict()
export type CodexTerminalFailureV1 = z.infer<typeof CodexTerminalFailureV1Schema>
