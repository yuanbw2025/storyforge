/**
 * 自适应文风学习 Store(FB-5)
 *
 * 每项目一份文风画像(userStyleProfiles,按 projectId 单例)。
 * 本 store 只管持久化(加载/保存/手改/开关);AI 学习(取样 + 调 style.learn)由
 * StyleLearningPanel 编排后调 saveProfile 落库,以便 store 可脱离 AI 单测。
 */
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { UserStyleProfile } from '../lib/types/user-style'

interface SaveProfileInput {
  profile: string
  sourceChapterIds: number[]
  sampleCount: number
  sampleWords: number
}

interface UserStyleState {
  profile: UserStyleProfile | null
  loading: boolean

  /** 加载项目文风画像(无则置 null,不自动建空记录) */
  loadProfile: (projectId: number) => Promise<void>
  /** 保存/覆盖画像(AI 学习完成后调;upsert,默认开启注入) */
  saveProfile: (projectId: number, input: SaveProfileInput) => Promise<void>
  /** 手动改写画像文本并保存 */
  updateProfileText: (text: string) => Promise<void>
  /** 开/关下游注入 */
  setEnabled: (enabled: boolean) => Promise<void>
}

export const useUserStyleStore = create<UserStyleState>((set, get) => ({
  profile: null,
  loading: false,

  loadProfile: async (projectId: number) => {
    set({ loading: true })
    try {
      const profile = await db.userStyleProfiles.where('projectId').equals(projectId).first()
      set({ profile: profile ?? null })
    } finally {
      set({ loading: false })
    }
  },

  saveProfile: async (projectId, input) => {
    const now = Date.now()
    const existing = await db.userStyleProfiles.where('projectId').equals(projectId).first()
    const row: UserStyleProfile = {
      ...(existing ?? {}),
      projectId,
      profile: input.profile,
      enabled: existing?.enabled ?? true,
      sourceChapterIds: JSON.stringify(input.sourceChapterIds),
      sampleCount: input.sampleCount,
      sampleWords: input.sampleWords,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    if (existing?.id != null) {
      await db.userStyleProfiles.update(existing.id, row)
      set({ profile: { ...row, id: existing.id } })
    } else {
      const id = await db.userStyleProfiles.add(row)
      set({ profile: { ...row, id: id as number } })
    }
  },

  updateProfileText: async (text) => {
    const { profile } = get()
    if (!profile?.id) return
    const updatedAt = Date.now()
    await db.userStyleProfiles.update(profile.id, { profile: text, updatedAt })
    set({ profile: { ...profile, profile: text, updatedAt } })
  },

  setEnabled: async (enabled) => {
    const { profile } = get()
    if (!profile?.id) return
    const updatedAt = Date.now()
    await db.userStyleProfiles.update(profile.id, { enabled, updatedAt })
    set({ profile: { ...profile, enabled, updatedAt } })
  },
}))
