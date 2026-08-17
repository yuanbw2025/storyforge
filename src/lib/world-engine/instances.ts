import { db } from '../db/schema'
import { assertRecordInScope, resolveScope, scopeTransactionTables } from './scope'
import { assertReleaseUnchanged } from './releases'
import {
  applySimulationEvent,
  createReleasedGameSession,
  createSimulationSession,
  withAdventureNarrativeProjection,
  withNarrativeSimulationProjection,
  withOpenWorldNarrativeProjection,
  type CreateSimulationSessionInput,
} from '../simulation/runtime'
import { buildReleaseSimulationCanonSnapshot } from '../simulation/canon-snapshot'
import {
  EMPTY_SIMULATION_STATE,
  type AnyGameReleaseManifestV1,
  type FrozenNarrativeBeat,
  type FrozenNarrativeChoice,
  type NarrativeModule,
  type NarrativeNode,
  type SimulationNarrativeNodeSnapshot,
  type SimulationNarrativeState,
  type SimulationRuntimeState,
  type SimulationSession,
  type SimulationSessionKind,
  type WorkspaceScope,
  type WorldRelease,
  type WorldReleaseManifestV2,
} from '../types'
import { createInitialInteractionState } from '../character-interaction/runtime'
import { createInitialAdventureState } from '../adventure/runtime'
import {
  applyNarrativeEffects,
  evaluateNarrativeCondition,
  parseNarrativeCondition,
  parseNarrativeEffects,
  validateNarrativeModule,
} from '../narrative/blueprint'
import { evaluateNarrativeChoices } from '../text-game/content'
import { assertGameReleaseUnchanged, parseAnyGameReleaseManifest } from '../text-game/releases'
import { createInitialAvgPresentationState } from '../avg/runtime'
import { createInitialNarrativeSimulationState } from '../narrative-simulation/runtime'
import { createInitialOpenWorldState } from '../open-world/runtime'

export interface CreateWorldInstanceInput {
  scope: WorkspaceScope
  kind: SimulationSessionKind
  title: string
  gameReleaseId?: number | null
  releaseId?: number | null
  draftSnapshotHash?: string | null
  narrativeModuleId?: number | null
  releaseNarrativeModuleExportId?: number | null
  canonSnapshot?: unknown
  initialState?: SimulationRuntimeState
  worldGroupId?: number | null
  seed?: string
}

interface FrozenNarrativeDefinition {
  version: 1 | 2
  sourceModuleId: number | null
  sourceModuleExportId: number | null
  moduleKind: NarrativeModule['kind']
  moduleTitle: string
  entryNodeKey: string
  nodes: SimulationNarrativeNodeSnapshot[]
  sourceHash: string
  contentHash?: string
  beats?: FrozenNarrativeBeat[]
  choices?: FrozenNarrativeChoice[]
  initialVariables?: Record<string, unknown>
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

async function sha256(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(value)))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function parseSuccessors(value: unknown, nodeKey: string): string[] {
  let parsed = value
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) } catch { throw new Error(`[instance] ${nodeKey} 的后继不是合法 JSON`) }
  }
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`[instance] ${nodeKey} 的后继必须是字符串数组`)
  }
  return parsed.map(item => item.trim())
}

function freezeNode(row: NarrativeNode | Record<string, unknown>): SimulationNarrativeNodeSnapshot {
  const record = row as unknown as Record<string, unknown>
  const key = String(record.key ?? '').trim()
  const conditionJson = String(record.conditionJson ?? '{}')
  const effectsJson = String(record.effectsJson ?? '[]')
  parseNarrativeCondition(conditionJson)
  parseNarrativeEffects(effectsJson)
  return {
    key,
    kind: record.kind as SimulationNarrativeNodeSnapshot['kind'],
    title: String(record.title ?? '').trim(),
    summary: String(record.summary ?? '').trim(),
    conditionJson,
    effectsJson,
    successorKeys: parseSuccessors(record.successorKeysJson ?? record.successorKeys ?? [], key),
  }
}

async function liveNarrativeBase(
  scope: WorkspaceScope,
  module: NarrativeModule,
): Promise<Omit<FrozenNarrativeDefinition, 'sourceHash'>> {
  const report = await validateNarrativeModule(scope, module.id!)
  if (!report.valid || !report.entryKey) throw new Error(`[instance] 叙事模块不可执行:${report.errors.join('；')}`)
  const nodes = (await db.narrativeNodes.where('moduleId').equals(module.id!).sortBy('order')).map(freezeNode)
  return {
    version: 1,
    sourceModuleId: module.id!,
    sourceModuleExportId: null,
    moduleKind: module.kind,
    moduleTitle: module.title,
    entryNodeKey: report.entryKey,
    nodes,
  }
}

function gameReleaseNarrativeDefinition(
  contentHash: string,
  manifest: AnyGameReleaseManifestV1,
): FrozenNarrativeDefinition {
  return {
    version: 2,
    sourceModuleId: null,
    sourceModuleExportId: manifest.worldRelease.narrativeModuleExportId,
    moduleKind: manifest.narrative.moduleKind,
    moduleTitle: manifest.narrative.moduleTitle,
    entryNodeKey: manifest.narrative.entryNodeKey,
    nodes: structuredClone(manifest.narrative.nodes),
    sourceHash: contentHash,
    contentHash,
    beats: structuredClone(manifest.narrative.beats),
    choices: structuredClone(manifest.narrative.choices),
    initialVariables: structuredClone(manifest.definition.initialVariables),
  }
}

async function liveNarrativeDefinition(
  scope: WorkspaceScope,
  module: NarrativeModule,
): Promise<FrozenNarrativeDefinition> {
  const base = await liveNarrativeBase(scope, module)
  return { ...base, sourceHash: await sha256(base) }
}

function releaseManifest(release: WorldRelease): WorldReleaseManifestV2 {
  const manifest = JSON.parse(release.manifestJson) as WorldReleaseManifestV2
  if (manifest.schema !== 'storyforge.world-package' || manifest.version !== 2) {
    throw new Error('[instance] 发布版本没有可执行的 v2 清单')
  }
  return manifest
}

function releaseNarrativeDefinition(
  release: WorldRelease,
  manifest: WorldReleaseManifestV2,
  exportId: number,
): FrozenNarrativeDefinition {
  const selected = manifest.selectedNarrativeModules.find(item => item.exportId === exportId)
  if (!selected) throw new Error('[instance] 发布版本不包含所选叙事模块')
  const moduleRow = manifest.records.narrativeModules?.find(raw => (
    !!raw && typeof raw === 'object' && (raw as Record<string, unknown>)._exportId === exportId
  )) as Record<string, unknown> | undefined
  if (!moduleRow) throw new Error('[instance] 发布版本缺少所选叙事模块记录')
  if (moduleRow.kind !== selected.kind || String(moduleRow.title ?? '') !== selected.title) {
    throw new Error('[instance] 发布叙事模块身份与选择清单不一致')
  }
  const nodes = (manifest.records.narrativeNodes ?? [])
    .filter(raw => !!raw && typeof raw === 'object' && (raw as Record<string, unknown>)._moduleExportId === exportId)
    .map(raw => freezeNode(raw as Record<string, unknown>))
  const entryNodeKey = String(moduleRow.entryNodeKey ?? '').trim()
  if (!entryNodeKey || !nodes.some(node => node.key === entryNodeKey)) throw new Error('[instance] 发布叙事缺少有效入口')
  const keys = new Set(nodes.map(node => node.key))
  if (keys.size !== nodes.length) throw new Error('[instance] 发布叙事节点 key 重复')
  if (!nodes.some(node => node.kind === 'ending') || nodes.some(node => node.successorKeys.some(key => !keys.has(key)))) {
    throw new Error('[instance] 发布叙事缺少结局或存在悬空后继')
  }
  const reachable = new Set<string>()
  const queue = [entryNodeKey]
  while (queue.length) {
    const key = queue.shift()!
    if (reachable.has(key)) continue
    reachable.add(key)
    queue.push(...nodes.find(node => node.key === key)!.successorKeys)
  }
  if (reachable.size !== nodes.length) throw new Error('[instance] 发布叙事存在入口不可达节点')
  return {
    version: 1,
    sourceModuleId: null,
    sourceModuleExportId: exportId,
    moduleKind: selected.kind,
    moduleTitle: selected.title,
    entryNodeKey,
    nodes,
    sourceHash: `${release.contentHash}:${exportId}`,
  }
}

function initialNarrativeState(definition: FrozenNarrativeDefinition): SimulationNarrativeState {
  const entry = definition.nodes.find(node => node.key === definition.entryNodeKey)
  if (!entry) throw new Error('[instance] 冻结叙事入口不存在')
  const initialVariables = structuredClone(definition.initialVariables ?? {})
  if (!evaluateNarrativeCondition(parseNarrativeCondition(entry.conditionJson), initialVariables)) {
    throw new Error('[instance] 冻结叙事入口条件在初始状态下不成立')
  }
  const variables = applyNarrativeEffects(parseNarrativeEffects(entry.effectsJson), initialVariables)
  const completed = entry.kind === 'ending'
  const choiceEvaluations = definition.version === 2 && !completed
    ? evaluateNarrativeChoices({
      ...variables,
      __visitedNodeKeys: [entry.key],
      __selectedChoiceKeys: [],
    }, entry.key, definition.choices ?? [])
    : []
  const availableNodeKeys = definition.version === 2
    ? [...new Set(choiceEvaluations.filter(choice => choice.available).map(choice => choice.targetNodeKey))]
    : entry.successorKeys.filter(key => {
      const node = definition.nodes.find(candidate => candidate.key === key)!
      return evaluateNarrativeCondition(parseNarrativeCondition(node.conditionJson), variables)
    })
  return {
    schema: 'storyforge.simulation-narrative',
    version: definition.version,
    sourceModuleId: definition.sourceModuleId,
    sourceModuleExportId: definition.sourceModuleExportId,
    moduleKind: definition.moduleKind,
    moduleTitle: definition.moduleTitle,
    sourceHash: definition.sourceHash,
    nodes: structuredClone(definition.nodes),
    currentNodeKey: entry.key,
    visitedNodeKeys: [entry.key],
    availableNodeKeys,
    variables,
    completed,
    ...(definition.version === 2 ? {
      contentHash: definition.contentHash!,
      beats: structuredClone(definition.beats ?? []),
      choices: structuredClone(definition.choices ?? []),
      visibleChoiceKeys: choiceEvaluations.filter(choice => choice.visible).map(choice => choice.choiceKey),
      availableChoiceKeys: choiceEvaluations.filter(choice => choice.available).map(choice => choice.choiceKey),
      choiceHistory: [],
      endingKey: completed ? entry.key : null,
      completedAtSequence: completed ? 0 : null,
      lastEnteredNodeSequence: null,
    } : {}),
  }
}

export async function createWorldInstance(input: CreateWorldInstanceInput): Promise<SimulationSession> {
  const initialScope = await resolveScope({ scope: input.scope })
  const gameRelease = input.gameReleaseId == null
    ? null
    : await assertGameReleaseUnchanged(input.gameReleaseId)
  const gameManifest = gameRelease ? parseAnyGameReleaseManifest(gameRelease.manifestJson) : null
  if ((input.kind === 'storygame' || input.kind === 'textadventure' || input.kind === 'avg'
    || input.kind === 'textsimulation' || input.kind === 'textworld') && !gameRelease) {
    throw new Error('[instance] 新建正式文字游戏必须绑定不可变 GameRelease；旧存档仅保留读取兼容')
  }
  if (gameRelease) {
    const expectedKind: SimulationSessionKind = gameManifest?.productType === 'storygame'
      ? 'storygame' : gameManifest?.productType === 'character-interaction' ? 'chatgame'
        : gameManifest?.productType === 'text-adventure' ? 'textadventure'
          : gameManifest?.productType === 'avg' ? 'avg'
            : gameManifest?.productType === 'narrative-simulation' ? 'textsimulation' : 'textworld'
    if (input.kind !== expectedKind) throw new Error(`[instance] ${gameManifest?.productType} GameRelease 必须创建 ${expectedKind} 会话`)
    if (gameRelease.projectId !== initialScope.projectId || gameRelease.worldId !== initialScope.worldId
      || gameRelease.workId !== initialScope.workId) {
      throw new Error('[instance] GameRelease 不属于当前 World/Work')
    }
    if (input.releaseId != null || input.draftSnapshotHash || input.narrativeModuleId != null
      || input.releaseNarrativeModuleExportId != null) {
      throw new Error('[instance] GameRelease 已完整冻结来源，不能混用其他叙事绑定')
    }
  }
  const boundReleaseId = gameRelease?.worldReleaseId ?? input.releaseId ?? null
  if (boundReleaseId == null && !input.draftSnapshotHash) {
    throw new Error('[instance] 必须绑定不可变发布版本或显式草稿快照哈希')
  }
  let release: WorldRelease | null = null
  let manifest: WorldReleaseManifestV2 | null = null
  if (boundReleaseId != null) {
    release = await db.worldReleases.get(boundReleaseId) ?? null
    if (!release || release.projectId !== initialScope.projectId || release.worldId !== initialScope.worldId) {
      throw new Error('[instance] 发布版本不属于当前 World')
    }
    await assertReleaseUnchanged(boundReleaseId)
    manifest = releaseManifest(release)
  }
  if (release && input.narrativeModuleId != null) {
    throw new Error('[instance] Release 实例必须绑定发布清单中的便携叙事 ID，不能绑定可变草稿模块')
  }
  if (release && !gameRelease && input.releaseNarrativeModuleExportId == null) {
    throw new Error('[instance] Release 实例必须选择发布清单中的便携叙事 ID')
  }
  let module: NarrativeModule | null = null
  if (input.narrativeModuleId != null) {
    module = await db.narrativeModules.get(input.narrativeModuleId) ?? null
    if (!module || !await assertRecordInScope(initialScope, 'narrativeModules', module)) {
      throw new Error('[instance] 叙事模块不属于当前 scope')
    }
  }
  if (input.releaseNarrativeModuleExportId != null && !release) {
    throw new Error('[instance] 便携叙事 ID 只能与不可变发布版本一起使用')
  }
  const releaseModuleExportId = gameManifest?.worldRelease.narrativeModuleExportId
    ?? input.releaseNarrativeModuleExportId ?? null
  const definition = gameRelease && gameManifest
    ? gameReleaseNarrativeDefinition(gameRelease.contentHash, gameManifest)
    : release && manifest && releaseModuleExportId != null
      ? releaseNarrativeDefinition(release, manifest, releaseModuleExportId)
    : module
      ? await liveNarrativeDefinition(initialScope, module)
      : null
  const initialState = structuredClone(input.initialState ?? EMPTY_SIMULATION_STATE)
  initialState.narrative = definition ? initialNarrativeState(definition) : null
  if (gameManifest?.productType === 'character-interaction') {
    if (input.initialState?.interaction != null) {
      throw new Error('[instance] GameRelease 已冻结互动初始状态，不允许外部覆盖')
    }
    initialState.interaction = createInitialInteractionState({
      playerKey: gameManifest.interaction.playerKey,
      profiles: gameManifest.interaction.profiles,
      sceneTemplates: gameManifest.interaction.sceneTemplates,
    })
  }
  if (gameManifest?.productType === 'text-adventure') {
    if (input.initialState?.adventure != null || input.initialState?.interaction != null) {
      throw new Error('[instance] GameRelease 已冻结冒险与互动初始状态，不允许外部覆盖')
    }
    initialState.interaction = createInitialInteractionState({
      playerKey: gameManifest.interaction.playerKey,
      profiles: gameManifest.interaction.profiles,
      sceneTemplates: gameManifest.interaction.sceneTemplates,
    })
    initialState.adventure = createInitialAdventureState(gameManifest.adventure, gameRelease!.contentHash)
    Object.assign(initialState, withAdventureNarrativeProjection(initialState))
  }
  if (gameManifest?.productType === 'avg') {
    if (input.initialState?.presentation != null) throw new Error('[instance] GameRelease 已冻结 AVG 演出，不允许外部覆盖')
    initialState.presentation = createInitialAvgPresentationState({
      contentHash: gameRelease!.contentHash,
      assets: gameManifest.presentation.assets,
      content: gameManifest.presentation,
      entryNodeKey: gameManifest.narrative.entryNodeKey,
    })
  }
  if (gameManifest?.productType === 'narrative-simulation') {
    if (input.initialState?.narrativeSimulation != null) {
      throw new Error('[instance] GameRelease 已冻结叙事模拟初始状态，不允许外部覆盖')
    }
    initialState.narrativeSimulation = createInitialNarrativeSimulationState(
      gameManifest.simulation,
      gameRelease!.contentHash,
    )
    Object.assign(initialState, withNarrativeSimulationProjection(initialState))
  }
  if (gameManifest?.productType === 'text-open-world') {
    if (input.initialState?.interaction != null || input.initialState?.adventure != null
      || input.initialState?.narrativeSimulation != null || input.initialState?.openWorld != null) {
      throw new Error('[instance] GameRelease 已冻结开放世界全部初始状态，不允许外部覆盖')
    }
    initialState.interaction = createInitialInteractionState({
      playerKey: gameManifest.interaction.playerKey,
      profiles: gameManifest.interaction.profiles,
      sceneTemplates: gameManifest.interaction.sceneTemplates,
    })
    initialState.adventure = createInitialAdventureState(gameManifest.adventure, gameRelease!.contentHash)
    initialState.narrativeSimulation = createInitialNarrativeSimulationState(
      gameManifest.simulation,
      gameRelease!.contentHash,
    )
    initialState.openWorld = createInitialOpenWorldState(gameManifest.openWorld, gameRelease!.contentHash)
    Object.assign(initialState, withAdventureNarrativeProjection(initialState))
    Object.assign(initialState, withNarrativeSimulationProjection(initialState))
    Object.assign(initialState, withOpenWorldNarrativeProjection(initialState))
  }
  const sessionInput: CreateSimulationSessionInput = {
    projectId: initialScope.projectId,
    worldGroupId: input.worldGroupId ?? null,
    kind: input.kind,
    title: input.title,
    seed: input.seed,
    canonSnapshot: input.canonSnapshot ?? (release && manifest
      ? await buildReleaseSimulationCanonSnapshot(manifest, release.createdAt)
      : { version: 2, sources: [] }),
    initialState,
  }
  const binding = {
    worldId: initialScope.worldId,
    workId: initialScope.workId,
    worldReleaseId: boundReleaseId,
    gameReleaseId: gameRelease?.id ?? null,
    narrativeModuleId: module?.id ?? null,
    narrativeModuleExportId: releaseModuleExportId,
    draftSnapshotHash: input.draftSnapshotHash ?? null,
  }
  return db.transaction('rw', scopeTransactionTables(
    db.worldGroups,
    db.simulationSessions,
    db.worldReleases,
    db.gameReleases,
    db.simulationEvents,
    db.narrativeModules,
    db.narrativeNodes,
    db.narrativeChoices,
  ), async () => {
    const scope = await resolveScope({ scope: initialScope })
    if (release) {
      const current = await db.worldReleases.get(release.id!)
      if (!current || current.manifestJson !== release.manifestJson || current.contentHash !== release.contentHash) {
        throw new Error('[instance] 发布版本在实例创建过程中发生变化')
      }
    }
    if (gameRelease) {
      const current = await db.gameReleases.get(gameRelease.id!)
      if (!current || current.manifestJson !== gameRelease.manifestJson || current.contentHash !== gameRelease.contentHash) {
        throw new Error('[instance] GameRelease 在实例创建过程中发生变化')
      }
    }
    if (module) {
      const current = await db.narrativeModules.get(module.id!)
      if (!current || !await assertRecordInScope(scope, 'narrativeModules', current)) {
        throw new Error('[instance] 叙事模块在实例创建过程中发生变化')
      }
      if (!release) {
        const currentDefinition = await liveNarrativeBase(scope, current)
        const originalDefinition = definition == null
          ? null
          : { ...definition, sourceHash: undefined }
        if (stableJson(currentDefinition) !== stableJson(originalDefinition)) {
          throw new Error('[instance] 叙事模块在实例创建过程中发生变化')
        }
      }
    }
    const session = gameRelease && release && releaseModuleExportId != null
      ? await createReleasedGameSession({
        ...sessionInput,
        worldId: scope.worldId,
        workId: scope.workId,
        worldReleaseId: release.id!,
        gameReleaseId: gameRelease.id!,
        narrativeModuleExportId: releaseModuleExportId,
        origin: 'release',
      })
      : await createSimulationSession(sessionInput)
    if (definition?.version === 2) {
      let projected = structuredClone(initialState)
      const started = {
        projectId: scope.projectId,
        worldGroupId: input.worldGroupId ?? null,
        sessionId: session.id!,
        sequence: 1,
        type: 'narrative.started' as const,
        actorKey: null,
        targetKey: definition.entryNodeKey,
        payloadJson: JSON.stringify({
          entryNodeKey: definition.entryNodeKey,
          contentHash: definition.contentHash,
        }),
        createdAt: session.createdAt,
      }
      projected = applySimulationEvent(projected, started)
      const entered = {
        projectId: scope.projectId,
        worldGroupId: input.worldGroupId ?? null,
        sessionId: session.id!,
        sequence: 2,
        type: 'narrative.node.entered' as const,
        actorKey: null,
        targetKey: definition.entryNodeKey,
        payloadJson: JSON.stringify({ nodeKey: definition.entryNodeKey, causeSequence: 1 }),
        createdAt: session.createdAt,
      }
      projected = applySimulationEvent(projected, entered)
      await db.simulationEvents.bulkAdd([started, entered])
      if (projected.narrative?.completed) {
        const ending = {
          projectId: scope.projectId,
          worldGroupId: input.worldGroupId ?? null,
          sessionId: session.id!,
          sequence: 3,
          type: 'narrative.ending.reached' as const,
          actorKey: null,
          targetKey: definition.entryNodeKey,
          payloadJson: JSON.stringify({ endingKey: definition.entryNodeKey, enteredSequence: 2 }),
          createdAt: session.createdAt,
        }
        applySimulationEvent(projected, ending)
        await db.simulationEvents.add(ending)
      }
    }
    await db.simulationSessions.update(session.id!, binding)
    return { ...session, ...binding }
  })
}

export async function createStoryGameInstance(input: {
  scope: WorkspaceScope
  gameReleaseId: number
  title: string
  worldGroupId?: number | null
  seed?: string
}): Promise<SimulationSession> {
  return createWorldInstance({ ...input, kind: 'storygame' })
}

export async function createInteractionGameInstance(input: {
  scope: WorkspaceScope
  gameReleaseId: number
  title: string
  worldGroupId?: number | null
  seed?: string
}): Promise<SimulationSession> {
  return createWorldInstance({ ...input, kind: 'chatgame' })
}

export async function createTextAdventureInstance(input: {
  scope: WorkspaceScope
  gameReleaseId: number
  title: string
  worldGroupId?: number | null
  seed?: string
}): Promise<SimulationSession> {
  return createWorldInstance({ ...input, kind: 'textadventure' })
}

export async function createAvgGameInstance(input: {
  scope: WorkspaceScope
  gameReleaseId: number
  title: string
  worldGroupId?: number | null
  seed?: string
}): Promise<SimulationSession> {
  return createWorldInstance({ ...input, kind: 'avg' })
}

export async function createNarrativeSimulationInstance(input: {
  scope: WorkspaceScope
  gameReleaseId: number
  title: string
  worldGroupId?: number | null
  seed?: string
}): Promise<SimulationSession> {
  return createWorldInstance({ ...input, kind: 'textsimulation' })
}

export async function createTextOpenWorldInstance(input: {
  scope: WorkspaceScope
  gameReleaseId: number
  title: string
  worldGroupId?: number | null
  seed?: string
}): Promise<SimulationSession> {
  return createWorldInstance({ ...input, kind: 'textworld' })
}

export async function readBoundInstances(scope: WorkspaceScope): Promise<SimulationSession[]> {
  const resolved = await resolveScope({ scope })
  const rows = await db.simulationSessions.where('projectId').equals(resolved.projectId).toArray()
  return rows.filter(row => row.worldId === resolved.worldId && row.workId === resolved.workId)
}

export async function assertInstanceBinding(instanceId: number, scope: WorkspaceScope): Promise<SimulationSession> {
  const resolved = await resolveScope({ scope })
  const session = await db.simulationSessions.get(instanceId)
  if (!session || session.projectId !== resolved.projectId || session.worldId !== resolved.worldId || session.workId !== resolved.workId) {
    throw new Error('[instance] 实例不属于当前 World/Work')
  }
  const initialState = JSON.parse(session.initialStateJson) as SimulationRuntimeState
  if (initialState.narrative?.version === 2) {
    if (session.gameReleaseId == null) {
      throw new Error('[instance] GameRelease 绑定缺失；请从完整项目备份恢复发布记录后再启动存档')
    }
  }
  if (session.worldReleaseId != null) {
    await assertReleaseUnchanged(session.worldReleaseId)
    if (session.narrativeModuleExportId != null) {
      const release = await db.worldReleases.get(session.worldReleaseId)
      if (!release || !releaseManifest(release).selectedNarrativeModules.some(item => item.exportId === session.narrativeModuleExportId)) {
        throw new Error('[instance] 实例发布叙事来源越界')
      }
    }
  }
  if (session.gameReleaseId != null) {
    const gameRelease = await assertGameReleaseUnchanged(session.gameReleaseId)
    if (gameRelease.projectId !== resolved.projectId || gameRelease.worldId !== resolved.worldId
      || gameRelease.workId !== resolved.workId || gameRelease.worldReleaseId !== session.worldReleaseId) {
      throw new Error('[instance] 实例 GameRelease 来源越界')
    }
  }
  if (session.narrativeModuleId != null) {
    const module = await db.narrativeModules.get(session.narrativeModuleId)
    if (!module || !await assertRecordInScope(resolved, 'narrativeModules', module)) throw new Error('[instance] 实例叙事来源越界')
  }
  return session
}
