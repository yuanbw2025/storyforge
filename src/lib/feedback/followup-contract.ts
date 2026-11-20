import { z } from 'zod'

export const feedbackStages = ['accepted', 'investigating', 'needs-evidence', 'planned', 'merged', 'verifying', 'released', 'closed', 'reopened'] as const
const issueUrl = z.string().regex(/^$|^https:\/\/github\.com\/yuanbw2025\/storyforge\/issues\/\d+$/)
const release = z.object({
  tag: z.string().regex(/^v\d+\.\d+\.\d+$/), sourceSha: z.string().regex(/^[a-f0-9]{40}$/), fixSha: z.string().regex(/^[a-f0-9]{40}$/),
  url: z.string().regex(/^https:\/\/github\.com\/yuanbw2025\/storyforge\/releases\/tag\/v\d+\.\d+\.\d+$/),
  publishedAt: z.string().datetime(), verifiedAt: z.string().datetime(), runId: z.number().int().positive(),
  distributions: z.array(z.enum(['desktop', 'android', 'portable', 'web'])).min(1).max(4),
  platforms: z.array(z.enum(['Windows','macOS','Linux','Android','iOS','Other'])).min(1).max(6),
}).strict().refine(value => value.url.endsWith('/' + value.tag), 'Release URL mismatch')
export const feedbackProgressSchema = z.object({
  revision: z.number().int().nonnegative(), stage: z.enum(feedbackStages), message: z.string().min(1).max(800), issueUrl,
  updatedAt: z.number().finite().nonnegative(), expiresAt: z.number().finite().positive(), release: release.optional(),
}).strict().refine(value => value.stage === 'released' ? !!value.release : value.stage === 'closed' || !value.release, 'Unverified release')
export type FeedbackProgress = z.infer<typeof feedbackProgressSchema>
export const feedbackRecordSchema = z.object({
  id: z.string().uuid(), token: z.string().regex(/^[a-f0-9]{64}$/), title: z.string().max(160),
  createdAt: z.number().finite().nonnegative(), state: z.enum(['pending', 'active', 'revoking', 'unavailable']),
  progress: feedbackProgressSchema.optional(), readRevision: z.number().int().nonnegative(),
  notifiedRevision: z.number().int().nonnegative().default(0),
  failures: z.number().int().nonnegative().max(5), nextCheckAt: z.number().finite().nonnegative(),
}).strict()
export type FeedbackRecord = z.infer<typeof feedbackRecordSchema>
export const feedbackStoreSchema = z.object({ version: z.literal(1), entries: z.array(feedbackRecordSchema).max(50) }).strict()
export const feedbackStageLabels: Record<FeedbackProgress['stage'], string> = {
  accepted: '已收到', investigating: '排查中', 'needs-evidence': '待补充证据', planned: '已计划', merged: '已合并，待发行',
  verifying: '交付核对中', released: '修复已上线', closed: '已关闭', reopened: '重新排查',
}

/** Unknown/local or merely newer source builds are never called repaired. */
export function feedbackBuildMessage(progress: FeedbackProgress, build: string, distribution: string, platform: string): string {
  if (!progress.release) return ''
  if (!progress.release.distributions.includes(distribution as 'desktop') || !progress.release.platforms.includes(platform as 'Windows')) return '本次修复未声明适用于当前运行渠道。'
  const match = /^v\d+\.\d+\.\d+\+([a-f0-9]{7,40})$/.exec(build)
  if (match && progress.release.sourceSha.startsWith(match[1]!)) return '当前运行构建已包含这份经核验的修复。'
  return distribution === 'web'
    ? '修复版本已发布。同步包含修复的源码并重启；当前源码是否包含修复尚未核实。'
    : '修复版本已发布。可查看更新；当前运行构建尚未核实包含此修复。'
}
