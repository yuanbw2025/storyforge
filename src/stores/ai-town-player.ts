import { create } from 'zustand'
import { db } from '../lib/db/schema'
import {
  advanceAiTownTimeV1,
  branchProductRuntimeSession,
  createProductRuntimeCheckpoint,
  deleteProductRuntimeSession,
  moveAiTownPlayerV1,
  performAiTownActionV1,
  readProductRuntimeState,
  readProductRuntimeStateVersion,
  recordAiTownConversationV1,
  resolveAiTownEventSeedV1,
  resolveAiTownMajorChangeV1,
  runAiTownOfflineBatchV1,
  startAiTownInitialSceneV1,
  type AiTownPlayerActionKindV1,
} from '../lib/ai-town/runtime-api'
import {
  assertProductReleaseUnchanged,
  parseAiTownProductReleaseManifest,
  parseAnyProductReleaseManifest,
} from '../lib/product/releases'
import { assertInstanceBinding, createAiTownInstance } from '../lib/product/runtime-instances'
import { verifyProductRuntimeSessionSourceV1 } from '../lib/product-production/preview-source'
import { commitInteractionPlayerMessage } from '../lib/character-interaction/runtime-api'
import { adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1 } from '../lib/character-interaction/harness'
import { adoptAiTownDirectorCandidateV1, generateAiTownDirectorCandidateV1 } from '../lib/ai-town/director-harness'
import type {
  AIConfig,
  AiTownProductRuntimePackageV1,
  ProductRelease,
  ProductRuntimeCheckpoint,
  ProductRuntimeEvent,
  ProductRuntimeState,
  ProductRuntimeSession,
  WorkspaceScope,
} from '../lib/types'
import { EMPTY_PRODUCT_RUNTIME_STATE } from '../lib/types'

export interface AiTownLibraryItemV1 {
  release: ProductRelease
  manifest: AiTownProductRuntimePackageV1 | null
  error: string
}

interface AiTownPlayerStoreV1 {
  scope: WorkspaceScope | null
  worldGroupId: number | null
  releases: AiTownLibraryItemV1[]
  sessions: ProductRuntimeSession[]
  selectedSessionId: number | null
  runtimeState: ProductRuntimeState
  events: ProductRuntimeEvent[]
  checkpoints: ProductRuntimeCheckpoint[]
  loading: boolean
  busy: boolean
  generatingRunId: number | null
  directorRunId: number | null
  error: string
  load(scope: WorkspaceScope, worldGroupId: number | null): Promise<void>
  select(sessionId: number | null): Promise<void>
  start(productReleaseId: number): Promise<number>
  move(locationKey: string): Promise<void>
  act(kind: AiTownPlayerActionKindV1, targetResidentKey?: string | null, note?: string): Promise<void>
  sendMessage(text: string, targetResidentKey: string, aiConfig?: AIConfig): Promise<void>
  direct(aiConfig: AIConfig): Promise<void>
  wait(): Promise<void>
  trigger(seedKey: string): Promise<void>
  offline(days: number): Promise<void>
  resolveMajor(candidateKey: string, resolution: 'accepted' | 'rejected'): Promise<void>
  saveCheckpoint(name: string): Promise<void>
  forkCurrent(title: string): Promise<number>
  forkCheckpoint(checkpointId: number): Promise<number>
  remove(sessionId: number): Promise<void>
}

async function readLibrary(scope: WorkspaceScope): Promise<AiTownLibraryItemV1[]> {
  const rows = (await db.productReleases.where('projectId').equals(scope.projectId).toArray())
    .filter(row => row.worldId === scope.worldId && row.workId === scope.workId)
    .sort((left, right) => right.createdAt - left.createdAt)
  const result: AiTownLibraryItemV1[] = []
  for (const release of rows) {
    try {
      await assertProductReleaseUnchanged(release.id!)
      if (parseAnyProductReleaseManifest(release.manifestJson).productType !== 'ai-town') continue
      result.push({ release, manifest: parseAiTownProductReleaseManifest(release.manifestJson), error: '' })
    } catch (reason) {
      if (release.productType === 'ai-town') result.push({ release, manifest: null, error: reason instanceof Error ? reason.message : String(reason) })
    }
  }
  return result
}

async function readSessions(scope: WorkspaceScope, worldGroupId: number | null) {
  const rows = await db.productRuntimeSessions.where('projectId').equals(scope.projectId).toArray()
  return rows.filter(row => row.kind === 'ai-town'
    && row.worldId === scope.worldId
    && row.workId === scope.workId
    && (row.worldGroupId ?? null) === worldGroupId
    && (row.productReleaseId != null || row.productBuildId != null))
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

async function assertTownSession(scope: WorkspaceScope, sessionId: number) {
  const session = await assertInstanceBinding(sessionId, scope)
  if (session.kind !== 'ai-town') throw new Error('[ai-town] 该存档不是 AI 小镇')
  const source = await verifyProductRuntimeSessionSourceV1({ scope, session })
  if (source.runtimePackage.productType !== 'ai-town' || !source.runtimePackage.town) throw new Error('[ai-town] 存档没有绑定有效的小镇 Build/Release')
  const state = await readProductRuntimeState(sessionId)
  if (!state.town) throw new Error('[ai-town] 存档状态不符合小镇协议')
  return session
}

async function details(scope: WorkspaceScope, sessionId: number) {
  await assertTownSession(scope, sessionId)
  const [runtimeState, events, checkpoints] = await Promise.all([
    readProductRuntimeState(sessionId),
    db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence'),
    db.productRuntimeCheckpoints.where('sessionId').equals(sessionId).toArray(),
  ])
  checkpoints.sort((left, right) => right.createdAt - left.createdAt)
  return { runtimeState, events, checkpoints }
}

function commandId(prefix: string, sessionId: number): string {
  return `${prefix}:${sessionId}:${crypto.randomUUID()}`
}

export const useAiTownPlayerStore = create<AiTownPlayerStoreV1>((set, get) => {
  const refresh = async () => {
    const scope = get().scope
    const sessionId = get().selectedSessionId
    if (!scope || sessionId == null) return
    set(await details(scope, sessionId))
  }
  const reload = async (requested?: number | null) => {
    const scope = get().scope
    if (!scope) return
    const [releases, sessions] = await Promise.all([readLibrary(scope), readSessions(scope, get().worldGroupId)])
    const current = requested === undefined ? get().selectedSessionId : requested
    const selectedSessionId = current != null && sessions.some(session => session.id === current) ? current : sessions[0]?.id ?? null
    set({ releases, sessions, selectedSessionId })
    if (selectedSessionId != null) await refresh()
    else set({ runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), events: [], checkpoints: [] })
  }
  const withBusy = async <T>(operation: () => Promise<T>): Promise<T> => {
    set({ busy: true, error: '' })
    try { return await operation() }
    catch (reason) {
      set({ error: reason instanceof Error ? reason.message : String(reason) })
      throw reason
    } finally { set({ busy: false, generatingRunId: null, directorRunId: null }) }
  }
  const version = async () => {
    const scope = get().scope
    const sessionId = get().selectedSessionId
    if (!scope || sessionId == null) throw new Error('[ai-town] 请先选择存档')
    await assertTownSession(scope, sessionId)
    return { sessionId, ...await readProductRuntimeStateVersion(sessionId) }
  }
  return {
    scope: null,
    worldGroupId: null,
    releases: [],
    sessions: [],
    selectedSessionId: null,
    runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),
    events: [],
    checkpoints: [],
    loading: false,
    busy: false,
    generatingRunId: null,
    directorRunId: null,
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
        if (selectedSessionId == null) set({ runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), events: [], checkpoints: [] })
        else await refresh()
      } catch (reason) { set({ error: reason instanceof Error ? reason.message : String(reason) }) }
      finally { set({ loading: false }) }
    },
    start: async productReleaseId => withBusy(async () => {
      const scope = get().scope
      const item = get().releases.find(candidate => candidate.release.id === productReleaseId)
      if (!scope || !item?.manifest || item.error) throw new Error('[ai-town] 请选择有效发布')
      const session = await createAiTownInstance({
        scope,
        productReleaseId,
        title: `${item.manifest.definition.title} · 第一次安顿`,
        worldGroupId: get().worldGroupId,
      })
      await startAiTownInitialSceneV1({
        sessionId: session.id!,
        commandId: commandId('town.scene.start', session.id!),
      })
      await reload(session.id!)
      return session.id!
    }),
    move: async locationKey => withBusy(async () => {
      const base = await version()
      await moveAiTownPlayerV1({ sessionId: base.sessionId, commandId: commandId('town.move', base.sessionId), baseSequence: base.sequence, baseStateHash: base.stateHash, locationKey })
      await refresh()
    }),
    direct: async aiConfig => withBusy(async () => {
      const scope = get().scope
      const base = await version()
      if (!scope) throw new Error('[ai-town] 工作区未就绪')
      const generated = await generateAiTownDirectorCandidateV1({
        scope,
        productRuntimeSessionId: base.sessionId,
        objective: '在当前地点、时段、事件冷却和居民生活线约束下，让小镇自然向前发展一步。',
        aiConfig,
        onRunCreated: runId => { set({ directorRunId: runId }) },
      })
      await adoptAiTownDirectorCandidateV1({ scope, runId: generated.snapshot.run.id })
      set({ directorRunId: null })
      await refresh()
    }),
    act: async (kind, targetResidentKey, note) => withBusy(async () => {
      const base = await version()
      await performAiTownActionV1({ sessionId: base.sessionId, commandId: commandId(`town.action.${kind}`, base.sessionId), baseSequence: base.sequence, baseStateHash: base.stateHash, kind, targetResidentKey, note })
      await refresh()
    }),
    sendMessage: async (message, targetResidentKey, aiConfig) => withBusy(async () => {
      const scope = get().scope
      const town = get().runtimeState.town
      const interaction = get().runtimeState.interaction
      const base = await version()
      if (!scope || !town || !interaction?.activeScene) throw new Error('[ai-town] 当前没有可用的交谈场景')
      const residentDefinition = town.content.residents.find(resident => resident.residentKey === targetResidentKey)
      const participantKey = residentDefinition == null ? null : interaction.profiles.find(profile => (
        profile.characterKey === residentDefinition.sourceCharacterResourceKey
      ))?.participantKey
      if (!residentDefinition || !participantKey || town.residents[targetResidentKey]?.residencyStatus !== 'resident'
        || town.residents[targetResidentKey]?.locationKey !== town.player.locationKey) {
        throw new Error('[ai-town] 只能与当前地点的居民交谈')
      }
      if (!interaction.activeScene.activeParticipantKeys.includes(participantKey)) {
        throw new Error('[ai-town] 当前互动场景尚未包含这名居民')
      }
      const playerEvent = await commitInteractionPlayerMessage({
        sessionId: base.sessionId, commandId: commandId('town.message', base.sessionId),
        baseSequence: base.sequence, baseStateHash: base.stateHash,
        messageId: `message:town-player:${crypto.randomUUID()}`, text: message.trim(), audienceKeys: [participantKey],
      })
      const integrateConversation = async (replyEvent: ProductRuntimeEvent | null) => {
        const current = await readProductRuntimeStateVersion(base.sessionId)
        await recordAiTownConversationV1({
          sessionId: base.sessionId,
          commandId: commandId('town.conversation.integrate', base.sessionId),
          baseSequence: current.sequence,
          baseStateHash: current.stateHash,
          residentKey: targetResidentKey,
          participantKey,
          sourceSequences: replyEvent ? [playerEvent.sequence, replyEvent.sequence] : [playerEvent.sequence],
        })
      }
      if (aiConfig) {
        try {
          const generated = await generateInteractionRuntimeCandidateV1({
            scope,
            productRuntimeSessionId: base.sessionId,
            participantKey,
            skillId: 'character.ai-town-reply',
            objective: `在后日谈小镇当下回应玩家消息 #${playerEvent.sequence}；保持自己的日程、知识边界和独立立场。`,
            replyToSequence: playerEvent.sequence,
            replyBudgetCost: 1,
            aiConfig,
            onRunCreated: runId => { set({ generatingRunId: runId }) },
          })
          const adopted = await adoptInteractionRuntimeCandidateV1({ scope, runId: generated.snapshot.run.id })
          await integrateConversation(adopted.event)
        } catch (reason) {
          const committedReply = (await db.productRuntimeEvents.where('sessionId').equals(base.sessionId).toArray())
            .find(event => event.type === 'interaction.character.reply.committed'
              && event.sequence > playerEvent.sequence
              && (() => {
                try {
                  const payload = JSON.parse(event.payloadJson) as { speakerKey?: unknown; replyToSequence?: unknown }
                  return payload.speakerKey === participantKey && payload.replyToSequence === playerEvent.sequence
                } catch { return false }
              })()) ?? null
          try { await integrateConversation(committedReply) } catch { /* preserve the original Harness failure */ }
          await refresh()
          throw reason
        }
      } else await integrateConversation(null)
      set({ generatingRunId: null })
      await refresh()
    }),
    wait: async () => withBusy(async () => {
      const base = await version()
      await advanceAiTownTimeV1({ sessionId: base.sessionId, commandId: commandId('town.wait', base.sessionId), baseSequence: base.sequence, baseStateHash: base.stateHash })
      await refresh()
    }),
    trigger: async seedKey => withBusy(async () => {
      const base = await version()
      await resolveAiTownEventSeedV1({ sessionId: base.sessionId, commandId: commandId('town.event', base.sessionId), baseSequence: base.sequence, baseStateHash: base.stateHash, seedKey })
      await refresh()
    }),
    offline: async days => withBusy(async () => {
      const base = await version()
      await runAiTownOfflineBatchV1({ sessionId: base.sessionId, commandId: commandId('town.offline', base.sessionId), baseSequence: base.sequence, baseStateHash: base.stateHash, days })
      await refresh()
    }),
    resolveMajor: async (candidateKey, resolution) => withBusy(async () => {
      const base = await version()
      await resolveAiTownMajorChangeV1({ sessionId: base.sessionId, commandId: commandId(`town.major.${resolution}`, base.sessionId), baseSequence: base.sequence, baseStateHash: base.stateHash, candidateKey, resolution })
      await refresh()
    }),
    saveCheckpoint: async name => withBusy(async () => {
      const { sessionId } = await version()
      await createProductRuntimeCheckpoint({ sessionId, name })
      await refresh()
    }),
    forkCurrent: async title => withBusy(async () => {
      const base = await version()
      const child = await branchProductRuntimeSession({ parentSessionId: base.sessionId, throughSequence: base.sequence, title: title.trim() || '小镇分支' })
      await reload(child.id!)
      return child.id!
    }),
    forkCheckpoint: async checkpointId => withBusy(async () => {
      const checkpoint = get().checkpoints.find(item => item.id === checkpointId)
      if (!checkpoint) throw new Error('[ai-town] 检查点不存在')
      const child = await branchProductRuntimeSession({ parentSessionId: checkpoint.sessionId, throughSequence: checkpoint.throughSequence, title: `${checkpoint.name} · 分支` })
      await reload(child.id!)
      return child.id!
    }),
    remove: async sessionId => withBusy(async () => {
      await deleteProductRuntimeSession(sessionId)
      await reload(get().selectedSessionId === sessionId ? null : undefined)
    }),
  }
})
