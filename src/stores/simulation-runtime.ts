import { create } from 'zustand'
import { db } from '../lib/db/schema'
import {
  appendSimulationEvent,
  advanceSimulationNarrative,
  appendChatMessage,
  appendChatReply,
  configureChatSession,
  acceptNpcEvolutionProposal,
  appendTtrpgTurn,
  appendNpcEvolutionProposal,
  branchSimulationSession,
  createSimulationCheckpoint,
  createSimulationSession,
  deleteSimulationSession,
  readSimulationState,
  readPendingNpcEvolutionProposals,
  rejectNpcEvolutionProposal,
  openTtrpgScene,
  startTtrpgEncounter,
  resolveTtrpgEncounter,
  resolveTtrpgAttack,
  changeTtrpgResource,
  applyTtrpgCondition,
  removeTtrpgCondition,
  updateTtrpgCampaignSummary,
  upsertTtrpgQuest,
  upsertTtrpgNpcSchedule,
  resolveSimulationDice,
  resolveTtrpgCheck,
  verifySimulationCheckpoint,
} from '../lib/simulation/runtime'
import { buildSimulationCanonSnapshot } from '../lib/simulation/canon-snapshot'
import { createWorldInstance } from '../lib/world-engine/instances'
import {
  EMPTY_SIMULATION_STATE,
  type SimulationCheckpoint,
  type SimulationEvent,
  type SimulationNpcEvolutionCandidate,
  type SimulationNpcEvolutionProposal,
  type SimulationRuntimeState,
  type SimulationSession,
  type SimulationSessionKind,
  type SimulationTtrpgTurnCandidate,
  type SimulationTtrpgEncounterCandidate,
  type SimulationTtrpgCondition,
  type SimulationTtrpgNpcSchedule,
  type SimulationTtrpgQuest,
  type SimulationChatIdentity,
  type SimulationChatScene,
  type WorkspaceScope,
} from '../lib/types'

interface SimulationRuntimeStore {
  projectId: number | null
  worldGroupId: number | null
  sessions: SimulationSession[]
  selectedSessionId: number | null
  events: SimulationEvent[]
  pendingProposals: SimulationNpcEvolutionProposal[]
  checkpoints: SimulationCheckpoint[]
  runtimeState: SimulationRuntimeState
  loading: boolean
  error: string
  load(projectId: number, worldGroupId: number | null): Promise<void>
  select(sessionId: number | null): Promise<void>
  createSession(input: {
    projectId: number
    worldGroupId: number | null
    kind: SimulationSessionKind
    title: string
    seed?: string
    sourceKeys: string[]
    scope?: WorkspaceScope
    chatConfig?: {
      characterKey: string
      identity: SimulationChatIdentity
      scene: SimulationChatScene
    }
  }): Promise<number>
  configureChat(input: { characterKey: string; identity: SimulationChatIdentity; scene: SimulationChatScene }): Promise<void>
  recordChatMessage(text: string): Promise<number>
  recordChatReply(input: { replyToSequence: number; text: string; baseSequence: number; supersedesSequence?: number | null }): Promise<void>
  advanceTime(amount: number): Promise<void>
  recordNarrative(text: string): Promise<void>
  advanceNarrative(targetNodeKey: string): Promise<void>
  proposeNpcEvolution(candidate: SimulationNpcEvolutionCandidate): Promise<void>
  acceptNpcEvolution(proposalSequence: number): Promise<void>
  rejectNpcEvolution(proposalSequence: number, reason?: string): Promise<void>
  openTtrpgScene(input: { title: string; description: string; locationKey: string | null; turnOrder: string[] }): Promise<void>
  startTtrpgEncounter(candidate: SimulationTtrpgEncounterCandidate): Promise<void>
  resolveTtrpgEncounter(reason?: string): Promise<void>
  recordTtrpgTurn(candidate: SimulationTtrpgTurnCandidate): Promise<void>
  resolveTtrpgCheck(input: { actorKey: string; skill: string; expression: string; dc: number }): Promise<void>
  resolveTtrpgAttack(input: { actorKey: string; targetKey: string; attackExpression: string; damageExpression?: string | null; resourceKey?: string; reason?: string }): Promise<void>
  changeTtrpgResource(input: { entityKey: string; resourceKey: string; delta: number; reason?: string }): Promise<void>
  applyTtrpgCondition(input: { entityKey: string; condition: SimulationTtrpgCondition }): Promise<void>
  removeTtrpgCondition(input: { entityKey: string; conditionId: string }): Promise<void>
  updateTtrpgCampaignSummary(summary: string, baseSequence?: number): Promise<void>
  upsertTtrpgQuest(input: Omit<SimulationTtrpgQuest, 'updatedSequence'>): Promise<void>
  upsertTtrpgNpcSchedule(input: Omit<SimulationTtrpgNpcSchedule, 'updatedSequence'>): Promise<void>
  rollDice(expression: string): Promise<void>
  checkpoint(name: string): Promise<void>
  branch(title: string): Promise<number>
  restoreCheckpoint(checkpointId: number): Promise<number>
  remove(sessionId: number): Promise<void>
}

async function readSessionDetails(sessionId: number) {
  const [events, checkpoints, runtimeState] = await Promise.all([
    db.simulationEvents.where('sessionId').equals(sessionId).toArray(),
    db.simulationCheckpoints.where('sessionId').equals(sessionId).toArray(),
    readSimulationState(sessionId),
  ])
  events.sort((left, right) => left.sequence - right.sequence)
  checkpoints.sort((left, right) => right.createdAt - left.createdAt)
  return {
    events,
    checkpoints,
    runtimeState,
    pendingProposals: readPendingNpcEvolutionProposals(events),
  }
}

export const useSimulationRuntimeStore = create<SimulationRuntimeStore>((set, get) => {
  const refreshSelected = async () => {
    const sessionId = get().selectedSessionId
    if (sessionId == null) return
    const details = await readSessionDetails(sessionId)
    set(details)
  }

  return {
    projectId: null,
    worldGroupId: null,
    sessions: [],
    selectedSessionId: null,
    events: [],
    pendingProposals: [],
    checkpoints: [],
    runtimeState: structuredClone(EMPTY_SIMULATION_STATE),
    loading: false,
    error: '',

    load: async (projectId, worldGroupId) => {
      set({ loading: true, error: '' })
      try {
        const sessions = (await db.simulationSessions.where('projectId').equals(projectId).toArray())
          .filter(session => (session.worldGroupId ?? null) === worldGroupId)
        sessions.sort((left, right) => right.updatedAt - left.updatedAt)
        const current = get().projectId === projectId && get().worldGroupId === worldGroupId
          ? get().selectedSessionId
          : null
        const selectedSessionId = current != null && sessions.some(row => row.id === current)
          ? current
          : sessions[0]?.id ?? null
        set({ projectId, worldGroupId, sessions, selectedSessionId, loading: false })
        if (selectedSessionId != null) await refreshSelected()
        else set({
          events: [],
          pendingProposals: [],
          checkpoints: [],
          runtimeState: structuredClone(EMPTY_SIMULATION_STATE),
        })
      } catch (error) {
        set({ loading: false, error: error instanceof Error ? error.message : String(error) })
      }
    },

    select: async sessionId => {
      set({ selectedSessionId: sessionId, error: '' })
      if (sessionId == null) {
        set({
          events: [],
          pendingProposals: [],
          checkpoints: [],
          runtimeState: structuredClone(EMPTY_SIMULATION_STATE),
        })
        return
      }
      try {
        set(await readSessionDetails(sessionId))
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
      }
    },

    createSession: async input => {
      const frozen = await buildSimulationCanonSnapshot({
        projectId: input.projectId,
        scope: input.scope,
        worldGroupId: input.worldGroupId,
        sourceKeys: input.sourceKeys,
      })
      const initialState = structuredClone(frozen.initialState)
      if (input.chatConfig) {
        initialState.chat = {
          characterKey: input.chatConfig.characterKey.trim(),
          identity: structuredClone(input.chatConfig.identity),
          scene: structuredClone(input.chatConfig.scene),
          messages: [],
        }
      }
      const activeWork = input.scope ? await db.works.get(input.scope.workId) : null
      const session = input.scope
        ? await createWorldInstance({
          scope: input.scope,
          kind: input.kind,
          title: input.title,
          seed: input.seed,
          draftSnapshotHash: frozen.snapshot.snapshotHash,
          narrativeModuleId: activeWork?.activeNarrativeModuleId ?? null,
          canonSnapshot: frozen.snapshot,
          initialState,
          worldGroupId: input.worldGroupId,
        })
        : await createSimulationSession({
          projectId: input.projectId,
          worldGroupId: input.worldGroupId,
          kind: input.kind,
          title: input.title,
          seed: input.seed,
          canonSnapshot: frozen.snapshot,
          initialState,
        })
      await get().load(input.projectId, input.worldGroupId)
      await get().select(session.id!)
      return session.id!
    },

    configureChat: async input => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择角色聊天会话。')
      await configureChatSession({ sessionId, ...input, baseSequence: get().runtimeState.lastSequence })
      await refreshSelected()
    },

    recordChatMessage: async text => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择角色聊天会话。')
      const event = await appendChatMessage({ sessionId, text })
      await refreshSelected()
      return event.sequence
    },

    recordChatReply: async input => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择角色聊天会话。')
      await appendChatReply({ sessionId, ...input })
      await refreshSelected()
    },

    advanceTime: async amount => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      await appendSimulationEvent({
        sessionId,
        type: 'time.advanced',
        payload: { amount },
      })
      await refreshSelected()
    },

    recordNarrative: async text => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      await appendSimulationEvent({
        sessionId,
        type: 'narrative.recorded',
        payload: { text },
      })
      await refreshSelected()
    },

    advanceNarrative: async targetNodeKey => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      await advanceSimulationNarrative({
        sessionId,
        targetNodeKey,
        baseSequence: get().runtimeState.lastSequence,
      })
      await refreshSelected()
    },

    proposeNpcEvolution: async candidate => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      await appendNpcEvolutionProposal({ sessionId, candidate })
      await refreshSelected()
    },

    acceptNpcEvolution: async proposalSequence => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      await acceptNpcEvolutionProposal({ sessionId, proposalSequence })
      await refreshSelected()
    },

    rejectNpcEvolution: async (proposalSequence, reason) => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      await rejectNpcEvolutionProposal({ sessionId, proposalSequence, reason })
      await refreshSelected()
    },

    openTtrpgScene: async input => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      await openTtrpgScene({ sessionId, ...input })
      await refreshSelected()
    },

    startTtrpgEncounter: async candidate => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      await startTtrpgEncounter({ sessionId, candidate })
      await refreshSelected()
    },

    resolveTtrpgEncounter: async reason => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      await resolveTtrpgEncounter({ sessionId, reason })
      await refreshSelected()
    },

    recordTtrpgTurn: async candidate => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      await appendTtrpgTurn({ sessionId, candidate })
      await refreshSelected()
    },

    resolveTtrpgCheck: async input => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      await resolveTtrpgCheck({ sessionId, ...input })
      await refreshSelected()
    },

    resolveTtrpgAttack: async input => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      await resolveTtrpgAttack({ sessionId, ...input })
      await refreshSelected()
    },

    changeTtrpgResource: async input => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      await changeTtrpgResource({ sessionId, ...input })
      await refreshSelected()
    },

    applyTtrpgCondition: async input => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      await applyTtrpgCondition({ sessionId, ...input })
      await refreshSelected()
    },

    removeTtrpgCondition: async input => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      await removeTtrpgCondition({ sessionId, ...input })
      await refreshSelected()
    },

    updateTtrpgCampaignSummary: async (summary, baseSequence) => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      await updateTtrpgCampaignSummary({ sessionId, summary, baseSequence })
      await refreshSelected()
    },

    upsertTtrpgQuest: async input => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      await upsertTtrpgQuest({ sessionId, ...input })
      await refreshSelected()
    },

    upsertTtrpgNpcSchedule: async input => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      await upsertTtrpgNpcSchedule({ sessionId, ...input })
      await refreshSelected()
    },

    rollDice: async expression => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      await resolveSimulationDice({ sessionId, expression })
      await refreshSelected()
    },

    checkpoint: async name => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      await createSimulationCheckpoint({ sessionId, name })
      await refreshSelected()
    },

    branch: async title => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      const parent = get().sessions.find(row => row.id === sessionId)
      if (!parent) throw new Error('当前运行时会话不存在。')
      const child = await branchSimulationSession({
        parentSessionId: sessionId,
        throughSequence: get().runtimeState.lastSequence,
        title,
      })
      await get().load(parent.projectId, parent.worldGroupId ?? null)
      await get().select(child.id!)
      return child.id!
    },

    restoreCheckpoint: async checkpointId => {
      const checkpoint = get().checkpoints.find(row => row.id === checkpointId)
      const parent = get().sessions.find(row => row.id === checkpoint?.sessionId)
      if (!checkpoint || !parent) throw new Error('要恢复的检查点不存在。')
      if (!await verifySimulationCheckpoint(checkpointId)) {
        throw new Error('检查点内容校验失败，不能用于恢复。')
      }
      const child = await branchSimulationSession({
        parentSessionId: parent.id!,
        throughSequence: checkpoint.throughSequence,
        title: `${parent.title} · ${checkpoint.name}`,
      })
      await get().load(parent.projectId, parent.worldGroupId ?? null)
      await get().select(child.id!)
      return child.id!
    },

    remove: async sessionId => {
      const projectId = get().projectId
      const worldGroupId = get().worldGroupId
      await deleteSimulationSession(sessionId)
      if (projectId != null) await get().load(projectId, worldGroupId)
    },
  }
})
