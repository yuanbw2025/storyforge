/**
 * NS-4 · 事实账本 store（事实库 UI 的数据层）。
 * 所有事实变更走 lib/fact-ledger 单一入口（adopt/confirm/reject），store 不裸散写业务逻辑。
 */
import { create } from 'zustand'
import type { TemporalFact } from '../lib/types/temporal-fact'
import type { ExtractedFactCandidate } from '../lib/ai/adapters/fact-extract-adapter'
import {
  adoptFactCandidates,
  confirmFactCandidate,
  replaceConstitutionFactCandidate,
  rejectFactCandidate,
  listFacts,
  type ConfirmFactResult,
  type ReplaceConstitutionFactResult,
} from '../lib/fact-ledger/fact-ledger'
import {
  adoptSettingAssertionCandidates,
  type ExtractedSettingAssertion,
  type SettingAssertionSource,
} from '../lib/fact-ledger/setting-assertions'
import { importFactCandidateDiff, type ImportFactCandidateDiffResult } from '../lib/fact-ledger/human-readable-io'
import type { WorkspaceScope } from '../lib/types/world-ownership'

interface FactLedgerStore {
  facts: TemporalFact[]
  loading: boolean
  load: (projectId: number) => Promise<void>
  adopt: (args: { projectId: number; scope?: WorkspaceScope; sourceChapterId: number; worldGroupId?: number | null; candidates: ExtractedFactCandidate[] }) => Promise<number>
  adoptSetting: (args: {
    projectId: number
    worldGroupId?: number | null
    candidates: readonly ExtractedSettingAssertion[]
    sources: readonly SettingAssertionSource[]
    subjects: {
      worldGroups: readonly { id: number | null; name: string }[]
      characters: readonly { id: number; name: string; worldGroupId?: number | null }[]
    }
  }) => Promise<{ written: number; skipped: number }>
  confirmFact: (projectId: number, factId: number) => Promise<ConfirmFactResult>
  replaceConstitutionFact: (projectId: number, factId: number) => Promise<ReplaceConstitutionFactResult>
  rejectFact: (projectId: number, factId: number) => Promise<void>
  importCandidateDiff: (projectId: number, raw: unknown) => Promise<ImportFactCandidateDiffResult>
}

export const useFactLedgerStore = create<FactLedgerStore>((set, get) => ({
  facts: [],
  loading: false,

  load: async (projectId) => {
    set({ loading: true })
    try {
      set({ facts: await listFacts(projectId) })
    } finally {
      set({ loading: false })
    }
  },

  adopt: async ({ projectId, scope, sourceChapterId, worldGroupId, candidates }) => {
    const result = await adoptFactCandidates({ projectId, scope, sourceChapterId, worldGroupId, candidates })
    await get().load(projectId)
    return result.written
  },

  adoptSetting: async (args) => {
    const result = await adoptSettingAssertionCandidates(args)
    await get().load(args.projectId)
    return result
  },

  confirmFact: async (projectId, factId) => {
    const result = await confirmFactCandidate(factId)
    await get().load(projectId)
    return result
  },

  replaceConstitutionFact: async (projectId, factId) => {
    const result = await replaceConstitutionFactCandidate(factId)
    await get().load(projectId)
    return result
  },

  rejectFact: async (projectId, factId) => {
    await rejectFactCandidate(factId)
    await get().load(projectId)
  },

  importCandidateDiff: async (projectId, raw) => {
    const result = await importFactCandidateDiff(projectId, raw)
    await get().load(projectId)
    return result
  },
}))
