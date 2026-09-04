import { create } from 'zustand'
import type { Chapter, Character, KnowledgeLedgerEntry } from '../lib/types'
import {
  adoptKnowledgeCandidates,
  confirmKnowledgeCandidate,
  listKnowledgeEvents,
  rejectKnowledgeCandidate,
  type KnowledgeCandidateInput,
} from '../lib/knowledge-ledger/knowledge-ledger'
import {
  readOwnedRows,
  resolveReadScopeLike,
  resolveScopeLike,
  type WorkspaceScopeLike,
} from '../lib/workspace/scope'

interface KnowledgeLedgerStore {
  events: KnowledgeLedgerEntry[]
  characters: Character[]
  chapters: Chapter[]
  loading: boolean
  load: (scope: WorkspaceScopeLike) => Promise<void>
  adopt: (scope: WorkspaceScopeLike, candidates: KnowledgeCandidateInput[]) => Promise<{ written: number; skipped: number }>
  confirmEvent: (scope: WorkspaceScopeLike, eventId: number) => Promise<boolean>
  rejectEvent: (scope: WorkspaceScopeLike, eventId: number) => Promise<boolean>
}

export const useKnowledgeLedgerStore = create<KnowledgeLedgerStore>((set, get) => ({
  events: [],
  characters: [],
  chapters: [],
  loading: false,
  load: async scopeInput => {
    set({ loading: true })
    try {
      const scope = await resolveReadScopeLike(scopeInput)
      const [events, characters, chapters] = await Promise.all([
        listKnowledgeEvents(scope),
        readOwnedRows<Character>(scope, 'characters', { owner: 'world' }),
        readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
      ])
      set({
        events,
        characters: characters.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')),
        chapters: chapters.sort((a, b) => a.order - b.order || (a.id ?? 0) - (b.id ?? 0)),
      })
    } finally {
      set({ loading: false })
    }
  },
  adopt: async (scopeInput, candidates) => {
    const scope = await resolveScopeLike(scopeInput)
    const result = await adoptKnowledgeCandidates({ projectId: scope.projectId, scope, candidates })
    await get().load(scope)
    return result
  },
  confirmEvent: async (scopeInput, eventId) => {
    const scope = await resolveScopeLike(scopeInput)
    const confirmed = await confirmKnowledgeCandidate(eventId, scope)
    await get().load(scope)
    return confirmed
  },
  rejectEvent: async (scopeInput, eventId) => {
    const scope = await resolveScopeLike(scopeInput)
    const rejected = await rejectKnowledgeCandidate(eventId, scope)
    await get().load(scope)
    return rejected
  },
}))
