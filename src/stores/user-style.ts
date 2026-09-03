/**
 * 自适应文风学习 Store(FB-5)
 *
 * 每个 Work 一份文风画像（旧库继续保留 projectId 物理字段）。
 * 本 store 只管作者显式的手改、开关、样本与反馈；AI 学习由
 * prose.style-learn durable Run 确认后经 adopt() 写入。
 */
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import {
  createStyleCalibrationFeedback,
  createStyleRevisionPair,
  parseStyleCalibrationFeedback,
  parseStyleRevisionPairs,
  upsertStyleRevisionPair,
} from '../lib/style/style-learning'
import type {
  StyleCalibrationFeedback,
  StyleCalibrationVerdict,
  StyleRevisionPair,
  UserStyleProfile,
} from '../lib/types/user-style'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveReadScopeLike,
  resolveScopeLike,
  stampNewRecord,
  type WorkspaceScopeLike,
} from '../lib/workspace/scope'
import type { WorkspaceScope } from '../lib/types/world-ownership'

interface CaptureRevisionPairInput {
  sourceChapterId?: number | null
  chapterTitle: string
  beforeText: string
  afterText: string
  authorNote?: string
}

interface AddCalibrationFeedbackInput {
  verdict: StyleCalibrationVerdict
  note: string
  sourceText: string
  resultText: string
}

interface UserStyleState {
  profile: UserStyleProfile | null
  loading: boolean

  /** 加载项目文风画像(无则置 null,不自动建空记录) */
  loadProfile: (scope: WorkspaceScopeLike) => Promise<void>
  /** 手动改写画像文本并保存 */
  updateProfileText: (text: string) => Promise<void>
  /** 开/关下游注入 */
  setEnabled: (enabled: boolean) => Promise<void>
  /** 删除本 Work 的画像、改稿样本和校准反馈。 */
  clearLearnedStyle: () => Promise<void>
  /** 保存一次有实际差异的改前/改后样本；相同样本会去重，最多保留 8 组 */
  captureRevisionPair: (
    projectId: number,
    input: CaptureRevisionPairInput,
  ) => Promise<StyleRevisionPair | null>
  /** 更新样本的人类说明，供后续学习优先使用 */
  updateRevisionPairNote: (pairId: string, note: string) => Promise<void>
  /** 删除不应参与文风学习的样本 */
  removeRevisionPair: (pairId: string) => Promise<void>
  /** 保存一条互动校准判断；只保留最近 12 条 */
  addCalibrationFeedback: (
    projectId: number,
    input: AddCalibrationFeedbackInput,
  ) => Promise<StyleCalibrationFeedback>
}

async function upsertProfileRow(
  scope: WorkspaceScope,
  patch: Partial<UserStyleProfile>,
): Promise<UserStyleProfile> {
  const now = Date.now()
  const existing = (await readOwnedRows<UserStyleProfile>(scope, 'userStyleProfiles', { owner: 'work' }))[0]
  const row = stampNewRecord(scope, 'userStyleProfiles', {
    ...(existing ?? {}),
    projectId: scope.projectId,
    profile: existing?.profile ?? '',
    enabled: existing?.enabled ?? false,
    sourceChapterIds: existing?.sourceChapterIds ?? '[]',
    sampleCount: existing?.sampleCount ?? 0,
    sampleWords: existing?.sampleWords ?? 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...patch,
  } as UserStyleProfile, { owner: 'work' }) as UserStyleProfile
  if (existing?.id != null) {
    await db.userStyleProfiles.update(existing.id, row)
    return { ...row, id: existing.id }
  }
  const id = await db.userStyleProfiles.add(row)
  return { ...row, id: id as number }
}

export const useUserStyleStore = create<UserStyleState>((set, get) => ({
  profile: null,
  loading: false,

  loadProfile: async (scopeInput) => {
    set({ loading: true })
    try {
      const profile = (await readOwnedRows<UserStyleProfile>(
        await resolveReadScopeLike(scopeInput),
        'userStyleProfiles',
        { owner: 'work' },
      ))[0]
      set({ profile: profile ?? null })
    } finally {
      set({ loading: false })
    }
  },

  updateProfileText: async (text) => {
    const { profile } = get()
    if (!profile?.id) return
    const scope = await resolveScopeLike(profile.projectId)
    const current = await db.userStyleProfiles.get(profile.id)
    if (!current || !await assertRecordInScope(scope, 'userStyleProfiles', current, { owner: 'work' })) return
    const updatedAt = Date.now()
    await db.userStyleProfiles.update(profile.id, { profile: text, updatedAt })
    set({ profile: { ...profile, profile: text, updatedAt } })
  },

  setEnabled: async (enabled) => {
    const { profile } = get()
    if (!profile?.id) return
    const scope = await resolveScopeLike(profile.projectId)
    const current = await db.userStyleProfiles.get(profile.id)
    if (!current || !await assertRecordInScope(scope, 'userStyleProfiles', current, { owner: 'work' })) return
    const updatedAt = Date.now()
    await db.userStyleProfiles.update(profile.id, { enabled, updatedAt })
    set({ profile: { ...profile, enabled, updatedAt } })
  },

  clearLearnedStyle: async () => {
    const { profile } = get()
    if (profile?.id == null) return
    const scope = await resolveScopeLike(profile.workId != null && profile.worldId != null
      ? { projectId: profile.projectId, worldId: profile.worldId, workId: profile.workId }
      : profile.projectId)
    const current = await db.userStyleProfiles.get(profile.id)
    if (!current || !await assertRecordInScope(scope, 'userStyleProfiles', current, { owner: 'work' })) return
    await db.userStyleProfiles.delete(profile.id)
    set({ profile: null })
  },

  captureRevisionPair: async (projectId, input) => {
    const pair = createStyleRevisionPair(input)
    if (!pair) return null
    const scope = await resolveScopeLike(projectId)
    const existing = (await readOwnedRows<UserStyleProfile>(scope, 'userStyleProfiles', { owner: 'work' }))[0]
    const revisionPairs = upsertStyleRevisionPair(
      parseStyleRevisionPairs(existing?.revisionPairs),
      pair,
    )
    const row = await upsertProfileRow(scope, {
      revisionPairs: JSON.stringify(revisionPairs),
    })
    set({ profile: row })
    return pair
  },

  updateRevisionPairNote: async (pairId, note) => {
    const { profile } = get()
    if (profile?.id == null) return
    const scope = await resolveScopeLike(profile.projectId)
    const current = await db.userStyleProfiles.get(profile.id)
    if (!current || !await assertRecordInScope(scope, 'userStyleProfiles', current, { owner: 'work' })) return
    const revisionPairs = parseStyleRevisionPairs(profile.revisionPairs)
      .map(pair => pair.id === pairId
        ? { ...pair, authorNote: note.trim().slice(0, 240) || undefined }
        : pair)
    const updatedAt = Date.now()
    const serialized = JSON.stringify(revisionPairs)
    await db.userStyleProfiles.update(profile.id, { revisionPairs: serialized, updatedAt })
    set({ profile: { ...profile, revisionPairs: serialized, updatedAt } })
  },

  removeRevisionPair: async (pairId) => {
    const { profile } = get()
    if (profile?.id == null) return
    const scope = await resolveScopeLike(profile.projectId)
    const current = await db.userStyleProfiles.get(profile.id)
    if (!current || !await assertRecordInScope(scope, 'userStyleProfiles', current, { owner: 'work' })) return
    const revisionPairs = parseStyleRevisionPairs(profile.revisionPairs)
      .filter(pair => pair.id !== pairId)
    const updatedAt = Date.now()
    const serialized = JSON.stringify(revisionPairs)
    await db.userStyleProfiles.update(profile.id, { revisionPairs: serialized, updatedAt })
    set({ profile: { ...profile, revisionPairs: serialized, updatedAt } })
  },

  addCalibrationFeedback: async (projectId, input) => {
    const feedback = createStyleCalibrationFeedback(input)
    const scope = await resolveScopeLike(projectId)
    const existing = (await readOwnedRows<UserStyleProfile>(scope, 'userStyleProfiles', { owner: 'work' }))[0]
    const calibrationFeedback = [
      feedback,
      ...parseStyleCalibrationFeedback(existing?.calibrationFeedback)
        .filter(item => item.id !== feedback.id),
    ].slice(0, 12)
    const row = await upsertProfileRow(scope, {
      calibrationFeedback: JSON.stringify(calibrationFeedback),
    })
    set({ profile: row })
    return feedback
  },
}))
