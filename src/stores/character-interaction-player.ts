import { create } from 'zustand'
import { db } from '../lib/db/schema'
import {
  adoptInteractionRuntimeCandidateV1,
  cancelInteractionRuntimeRunV1,
  generateInteractionRuntimeCandidateV1,
} from '../lib/character-interaction/harness'
import {
  branchProductRuntimeSession,
  changeInteractionRelationship,
  commitInteractionPlayerMessage,
  commitNarrativeChoice,
  createProductRuntimeCheckpoint,
  deleteProductRuntimeSession,
  endInteractionScene,
  readProductRuntimeState,
  readProductRuntimeStateVersion,
  resolveInteractionMemory,
  startInteractionScene,
} from '../lib/character-interaction/runtime-api'
import {
  assertProductReleaseUnchanged,
  parseAnyProductReleaseManifest,
  parseInteractionProductReleaseManifest,
} from '../lib/product/releases'
import { verifyProductRuntimeSessionSourceV1 } from '../lib/product-production/preview-source'
import {
  assertInstanceBinding,
  createCharacterInteractionInstance,
} from '../lib/product/runtime-instances'
import type {
  AIConfig,
  ProductRelease,
  CharacterInteractionProductRuntimePackageV1,
  ProductRuntimeCheckpoint,
  ProductRuntimeEvent,
  ProductRuntimeState,
  ProductRuntimeSession,
  WorkspaceScope,
} from '../lib/types'
import { EMPTY_PRODUCT_RUNTIME_STATE } from '../lib/types'

export interface CharacterInteractionLibraryItem {
  release: ProductRelease
  manifest: CharacterInteractionProductRuntimePackageV1 | null
  error: string
}

interface CharacterInteractionPlayerState {
  scope: WorkspaceScope | null
  worldGroupId: number | null
  releases: CharacterInteractionLibraryItem[]
  sessions: ProductRuntimeSession[]
  selectedSessionId: number | null
  events: ProductRuntimeEvent[]
  checkpoints: ProductRuntimeCheckpoint[]
  recoverableRunIds: number[]
  runtimeState: ProductRuntimeState
  loading: boolean
  busy: boolean
  generatingRunId: number | null
  error: string
  load(scope: WorkspaceScope, worldGroupId: number | null): Promise<void>
  select(sessionId: number | null): Promise<void>
  start(productReleaseId: number, title?: string): Promise<number>
  startScene(sceneKey: string): Promise<void>
  sendPlayerMessage(text: string, audienceKeys?: string[] | null): Promise<number>
  applyFixedAction(ruleKey: string): Promise<void>
  generateReplies(input: { aiConfig: AIConfig; replyToSequence: number; preferredParticipantKey?: string }): Promise<void>
  retryReply(input: { aiConfig: AIConfig; replySequence: number }): Promise<void>
  cancelGeneration(): Promise<void>
  resumeRun(runId: number): Promise<void>
  resolveMemory(memoryId: string, resolution: 'accepted' | 'rejected'): Promise<void>
  finishScene(reason?: string, aiConfig?: AIConfig): Promise<void>
  chooseNarrative(choiceKey: string): Promise<void>
  saveCheckpoint(name: string): Promise<void>
  forkCurrent(title?: string): Promise<number>
  forkCheckpoint(checkpointId: number, title?: string): Promise<number>
  remove(sessionId: number): Promise<void>
}

let generationAbortController: AbortController | null = null

async function readLibrary(scope: WorkspaceScope): Promise<CharacterInteractionLibraryItem[]> {
  const rows = (await db.productReleases.where('projectId').equals(scope.projectId).toArray())
    .filter(row => row.worldId === scope.worldId && row.workId === scope.workId)
    .sort((a, b) => b.createdAt - a.createdAt)
  const items: CharacterInteractionLibraryItem[] = []
  for (const release of rows) {
    try {
      await assertProductReleaseUnchanged(release.id!)
      if (parseAnyProductReleaseManifest(release.manifestJson).productType !== 'character-interaction') continue
      const manifest = parseInteractionProductReleaseManifest(release.manifestJson)
      items.push({ release, manifest, error: '' })
    } catch (reason) {
      items.push({
        release,
        manifest: null,
        error: reason instanceof Error ? reason.message : String(reason),
      })
    }
  }
  return items
}

async function assertInteractionSession(scope: WorkspaceScope, sessionId: number): Promise<ProductRuntimeSession> {
  const session = await assertInstanceBinding(sessionId, scope)
  if (session.kind !== 'character-interaction') throw new Error('该存档不是角色互动存档。')
  const playable = await verifyProductRuntimeSessionSourceV1({ scope, session })
  if (playable.runtimePackage.productType !== 'character-interaction'
    || !playable.runtimePackage.interaction) {
    throw new Error('该存档没有绑定有效的角色互动 Product Build 或 ProductRelease。')
  }
  const state = await readProductRuntimeState(sessionId)
  if (!state.interaction) throw new Error('该存档不符合角色互动运行协议。')
  return session
}

async function readInteractionSessions(
  scope: WorkspaceScope,
  worldGroupId: number | null,
): Promise<ProductRuntimeSession[]> {
  const rows = await db.productRuntimeSessions.where('projectId').equals(scope.projectId).toArray()
  return rows.filter(row => {
    return row.kind === 'character-interaction'
      && (row.productReleaseId != null || row.productBuildId != null)
      && (row.worldGroupId ?? null) === worldGroupId
      && row.worldId === scope.worldId
      && row.workId === scope.workId
  }).sort((a, b) => b.updatedAt - a.updatedAt)
}

async function assertReadableInteractionSession(scope: WorkspaceScope, sessionId: number): Promise<ProductRuntimeSession> {
  return assertInteractionSession(scope, sessionId)
}

async function details(scope: WorkspaceScope, sessionId: number) {
  await assertReadableInteractionSession(scope, sessionId)
  const [events, checkpoints, runtimeState, runRows] = await Promise.all([
    db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence'),
    db.productRuntimeCheckpoints.where('sessionId').equals(sessionId).toArray(),
    readProductRuntimeState(sessionId),
    db.agentRuns.where('productRuntimeSessionId').equals(sessionId).toArray(),
  ])
  checkpoints.sort((a, b) => b.createdAt - a.createdAt)
  const resumableRows = runRows.filter(row => !['completed', 'failed', 'cancelled'].includes(row.status))
  const resumeCheckpoints = resumableRows.length
    ? await db.agentRunCheckpoints.where('runId').anyOf(resumableRows.map(row => row.id!)).toArray()
    : []
  return {
    events,
    checkpoints,
    runtimeState,
    recoverableRunIds: resumableRows
      .filter(row => resumeCheckpoints.some(item => item.runId === row.id && item.resumePayloadJson != null))
      .map(row => row.id!),
  }
}

function commandId(prefix: string, sessionId: number): string {
  return `${prefix}:${sessionId}:${crypto.randomUUID()}`
}

export const useCharacterInteractionPlayerStore = create<CharacterInteractionPlayerState>((set, get) => {
  const refresh = async () => {
    const scope = get().scope
    const id = get().selectedSessionId
    if (!scope || id == null) return
    set(await details(scope, id))
  }
  const reload = async (requested?: number | null) => {
    const scope = get().scope
    if (!scope) return
    const [releases, sessions] = await Promise.all([
      readLibrary(scope),
      readInteractionSessions(scope, get().worldGroupId),
    ])
    const current = requested === undefined ? get().selectedSessionId : requested
    const selectedSessionId = current != null && sessions.some(row => row.id === current)
      ? current : sessions[0]?.id ?? null
    set({ releases, sessions, selectedSessionId })
    if (selectedSessionId != null) await refresh()
    else set({ events: [], checkpoints: [], recoverableRunIds: [], runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE) })
  }
  const withBusy = async <T>(operation: () => Promise<T>): Promise<T> => {
    set({ busy: true, error: '' })
    try { return await operation() } catch (reason) {
      set({ error: reason instanceof Error ? reason.message : String(reason) })
      throw reason
    } finally { set({ busy: false }) }
  }
  const version = async () => {
    const id = get().selectedSessionId
    if (id == null) throw new Error('请先选择角色互动存档。')
    await assertInteractionSession(get().scope!, id)
    return { id, ...await readProductRuntimeStateVersion(id) }
  }

  return {
    scope: null,
    worldGroupId: null,
    releases: [],
    sessions: [],
    selectedSessionId: null,
    events: [],
    checkpoints: [],
    recoverableRunIds: [],
    runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),
    loading: false,
    busy: false,
    generatingRunId: null,
    error: '',

    load: async (scope, worldGroupId) => {
      const changed = get().scope?.projectId !== scope.projectId || get().scope?.worldId !== scope.worldId
        || get().scope?.workId !== scope.workId || get().worldGroupId !== worldGroupId
      set({ scope, worldGroupId, loading: true, error: '', ...(changed ? { selectedSessionId: null } : {}) })
      try { await reload() } catch (reason) { set({ error: reason instanceof Error ? reason.message : String(reason) }) }
      finally { set({ loading: false }) }
    },

    select: async selectedSessionId => {
      set({ selectedSessionId, loading: true, error: '' })
      try {
        if (selectedSessionId == null) set({ events: [], checkpoints: [], recoverableRunIds: [], runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE) })
        else await refresh()
      } catch (reason) { set({ error: reason instanceof Error ? reason.message : String(reason) }) }
      finally { set({ loading: false }) }
    },

    start: async (productReleaseId, title) => withBusy(async () => {
      const scope = get().scope
      const item = get().releases.find(row => row.release.id === productReleaseId)
      if (!scope || !item?.manifest || item.error) throw new Error('请选择可用的角色互动发布。')
      const session = await createCharacterInteractionInstance({
        scope,
        productReleaseId,
        title: title?.trim() || `${item.manifest.definition.title} · 新会话`,
        worldGroupId: get().worldGroupId,
      })
      const first = item.manifest.interaction.sceneTemplates[0]
      if (first) {
        const base = await readProductRuntimeStateVersion(session.id!)
        await startInteractionScene({
          sessionId: session.id!,
          commandId: commandId('interaction.scene.start', session.id!),
          baseSequence: base.sequence,
          baseStateHash: base.stateHash,
          sceneId: `scene:${first.sceneKey}:${crypto.randomUUID()}`,
          sceneKey: first.sceneKey,
        })
      }
      await reload(session.id!)
      return session.id!
    }),

    startScene: async sceneKey => withBusy(async () => {
      const base = await version()
      await startInteractionScene({
        sessionId: base.id,
        commandId: commandId('interaction.scene.start', base.id),
        baseSequence: base.sequence,
        baseStateHash: base.stateHash,
        sceneId: `scene:${sceneKey}:${crypto.randomUUID()}`,
        sceneKey,
      })
      await refresh()
    }),

    sendPlayerMessage: async (text, audienceKeys) => withBusy(async () => {
      const base = await version()
      const event = await commitInteractionPlayerMessage({
        sessionId: base.id,
        commandId: commandId('interaction.message', base.id),
        baseSequence: base.sequence,
        baseStateHash: base.stateHash,
        messageId: `message:player:${crypto.randomUUID()}`,
        text,
        audienceKeys: audienceKeys ?? null,
      })
      await refresh()
      return event.sequence
    }),

    applyFixedAction: async ruleKey => withBusy(async () => {
      const state = get().runtimeState.interaction
      const rule = state?.activeScene?.relationshipRules.find(item => item.ruleKey === ruleKey)
      if (!state?.activeScene || !rule) throw new Error('固定行动不在当前场景中。')
      const messageBase = await version()
      const message = await commitInteractionPlayerMessage({
        sessionId: messageBase.id,
        commandId: commandId('interaction.fixed-message', messageBase.id),
        baseSequence: messageBase.sequence,
        baseStateHash: messageBase.stateHash,
        messageId: `message:fixed:${rule.ruleKey}:${crypto.randomUUID()}`,
        text: rule.playerText,
        audienceKeys: null,
      })
      const relationshipBase = await readProductRuntimeStateVersion(messageBase.id)
      await changeInteractionRelationship({
        sessionId: messageBase.id,
        commandId: commandId('interaction.fixed-relationship', messageBase.id),
        baseSequence: relationshipBase.sequence,
        baseStateHash: relationshipBase.stateHash,
        fromParticipantKey: rule.fromParticipantKey,
        toParticipantKey: rule.toParticipantKey,
        dimensionKey: rule.dimensionKey,
        delta: rule.delta,
        reason: rule.reason,
        ruleKey: rule.ruleKey,
        sourceEventSequence: message.sequence,
        significantEventKey: rule.significantEventKey,
      })
      await refresh()
    }),

    generateReplies: async input => withBusy(async () => {
      const scope = get().scope
      const sessionId = get().selectedSessionId
      const state = get().runtimeState.interaction
      if (!scope || sessionId == null || !state?.activeScene) throw new Error('当前没有进行中的互动场景。')
      generationAbortController = new AbortController()
      const signal = generationAbortController.signal
      const active = state.activeScene.activeParticipantKeys
      let responders: string[]
      if (input.preferredParticipantKey) {
        responders = [input.preferredParticipantKey]
      } else if (active.length === 1) {
        responders = [...active]
      } else {
        const director = await generateInteractionRuntimeCandidateV1({
          scope,
          productRuntimeSessionId: sessionId,
          participantKey: active[0],
          skillId: 'prose.interaction-scene-director',
          objective: `根据玩家消息 #${input.replyToSequence} 选择有必要回应的角色和顺序。`,
          aiConfig: input.aiConfig,
          signal,
          onRunCreated: id => { set({ generatingRunId: id }) },
        })
        await adoptInteractionRuntimeCandidateV1({ scope, runId: director.snapshot.run.id })
        responders = director.candidate.kind === 'scene-director-candidate'
          ? director.candidate.responders.map(item => item.participantKey) : []
        if (!responders.length) responders = [active[0]]
      }
      responders = [...new Set(responders)].filter(key => active.includes(key))
        .slice(0, state.remainingDirectorBudget)
      if (!responders.length) throw new Error('导演没有返回当前场景中的有效角色。')
      for (const participantKey of responders) {
        const generated = await generateInteractionRuntimeCandidateV1({
          scope,
          productRuntimeSessionId: sessionId,
          participantKey,
          skillId: 'character.interaction-reply',
          objective: `回应玩家消息 #${input.replyToSequence}，budgetCost 设为 1，只披露角色实际知道的信息。`,
          replyToSequence: input.replyToSequence,
          replyBudgetCost: 1,
          aiConfig: input.aiConfig,
          signal,
          onRunCreated: id => { set({ generatingRunId: id }) },
        })
        await adoptInteractionRuntimeCandidateV1({ scope, runId: generated.snapshot.run.id })
      }
      set({ generatingRunId: null })
      generationAbortController = null
      await refresh()
    }),

    retryReply: async input => withBusy(async () => {
      const scope = get().scope
      const sessionId = get().selectedSessionId
      const reply = get().runtimeState.interaction?.messages.find(item => item.eventSequence === input.replySequence)
      if (!scope || sessionId == null || !reply || reply.role !== 'character' || reply.replyToSequence == null
        || reply.supersededBySequence != null) throw new Error('要重试的角色回复已失效。')
      generationAbortController = new AbortController()
      const generated = await generateInteractionRuntimeCandidateV1({
        scope,
        productRuntimeSessionId: sessionId,
        participantKey: reply.speakerKey,
        skillId: 'character.interaction-reply',
        objective: `重新回应玩家消息 #${reply.replyToSequence}，budgetCost 设为 0，不重复提交玩家消息。`,
        replyToSequence: reply.replyToSequence,
        supersedesSequence: reply.eventSequence,
        replyBudgetCost: 0,
        aiConfig: input.aiConfig,
        signal: generationAbortController.signal,
        onRunCreated: id => { set({ generatingRunId: id }) },
      })
      await adoptInteractionRuntimeCandidateV1({ scope, runId: generated.snapshot.run.id })
      set({ generatingRunId: null })
      generationAbortController = null
      await refresh()
    }),

    cancelGeneration: async () => {
      const scope = get().scope
      const runId = get().generatingRunId
      generationAbortController?.abort()
      generationAbortController = null
      if (!scope || runId == null) return
      await cancelInteractionRuntimeRunV1({ scope, runId })
      set({ generatingRunId: null })
    },

    resumeRun: async runId => withBusy(async () => {
      const scope = get().scope
      if (!scope) throw new Error('工作区未加载。')
      await adoptInteractionRuntimeCandidateV1({ scope, runId })
      await refresh()
    }),

    resolveMemory: async (memoryId, resolution) => withBusy(async () => {
      const base = await version()
      await resolveInteractionMemory({
        sessionId: base.id,
        commandId: commandId(`interaction.memory.${resolution}`, base.id),
        baseSequence: base.sequence,
        baseStateHash: base.stateHash,
        memoryId,
        resolution,
      })
      await refresh()
    }),

    finishScene: async (reason, aiConfig) => withBusy(async () => {
      const state = get().runtimeState.interaction
      if (!state?.activeScene) throw new Error('当前没有进行中的场景。')
      const scope = get().scope
      const sessionId = get().selectedSessionId
      let curatorFailure = ''
      if (scope && sessionId != null && aiConfig && state.messages.length) {
        for (const participantKey of state.activeScene.activeParticipantKeys) {
          try {
            const generated = await generateInteractionRuntimeCandidateV1({
              scope,
              productRuntimeSessionId: sessionId,
              participantKey,
              skillId: 'character.interaction-memory-curator',
              objective: `在场景 ${state.activeScene.sceneId} 结束前，仅依据该角色可见的真实消息提出一条可追溯摘要或关键记忆候选。`,
              aiConfig,
              onRunCreated: id => { set({ generatingRunId: id }) },
            })
            await adoptInteractionRuntimeCandidateV1({ scope, runId: generated.snapshot.run.id })
          } catch (cause) {
            curatorFailure = cause instanceof Error ? cause.message : String(cause)
          }
        }
      }
      const base = await version()
      await endInteractionScene({
        sessionId: base.id,
        commandId: commandId('interaction.scene.end', base.id),
        baseSequence: base.sequence,
        baseStateHash: base.stateHash,
        sceneId: state.activeScene.sceneId,
        reason: reason?.trim() || '玩家结束场景',
      })
      set({ generatingRunId: null })
      await refresh()
      if (curatorFailure) set({ error: `场景已结束；记忆整理未完成，原始消息和存档未受影响：${curatorFailure}` })
    }),

    chooseNarrative: async choiceKey => withBusy(async () => {
      const base = await version()
      await commitNarrativeChoice({
        sessionId: base.id,
        commandId: commandId('interaction.narrative-choice', base.id),
        baseSequence: base.sequence,
        baseStateHash: base.stateHash,
        choiceKey,
      })
      await refresh()
    }),

    saveCheckpoint: async name => withBusy(async () => {
      const id = get().selectedSessionId
      if (id == null) throw new Error('请先选择存档。')
      await createProductRuntimeCheckpoint({ sessionId: id, name })
      await refresh()
    }),

    forkCurrent: async title => withBusy(async () => {
      const id = get().selectedSessionId
      const scope = get().scope
      if (id == null || !scope) throw new Error('请先选择存档。')
      const state = await readProductRuntimeState(id)
      const child = await branchProductRuntimeSession({ parentSessionId: id, throughSequence: state.lastSequence, title: title?.trim() || '互动分支' })
      await reload(child.id!)
      return child.id!
    }),

    forkCheckpoint: async (checkpointId, title) => withBusy(async () => {
      const checkpoint = await db.productRuntimeCheckpoints.get(checkpointId)
      if (!checkpoint) throw new Error('检查点不存在。')
      const child = await branchProductRuntimeSession({
        parentSessionId: checkpoint.sessionId,
        throughSequence: checkpoint.throughSequence,
        title: title?.trim() || `${checkpoint.name} · 分支`,
      })
      await reload(child.id!)
      return child.id!
    }),

    remove: async sessionId => withBusy(async () => {
      await deleteProductRuntimeSession(sessionId)
      await reload(get().selectedSessionId === sessionId ? null : undefined)
    }),
  }
})
