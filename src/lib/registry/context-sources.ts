/**
 * CONTEXT_SOURCES(Phase 1.3a) · AI 上下文读取源注册表。
 *
 * 本文件只登记读取源和旧适配器桥接。1.3b 再把生成入口迁移到 assembleContext()。
 */
import { db } from '../db/schema'
import { resolveCanonicalChapterSequence } from '../ai/chapter-memory/canonical-chapter-sequence'
import { walkOutlineChaptersInCanonicalOrder } from '../outline/canonical-outline-walk'
import { getFactPredicate } from './fact-predicate-registry'
import { retrieveChunks, embedQuery, readNarrativeSummaryContext } from '../retrieval/retrieval'
import { isEmbeddingReady, embeddingModelTag } from '../ai/adapters/embedding-adapter'
import { useAIConfigStore } from '../../stores/ai-config'
import {
  buildCreativeRulesContext,
  buildHistoricalContext,
  buildLocationContext,
  buildRefAnalysisContext,
  buildCharacterContext,
  buildTargetCharacterContext,
  formatPowerSystemBlock,
  formatStoryCoreBlock,
  formatWorldviewBlock,
  getContextMemo,
} from '../ai/context-builder'
import { buildCodexContext } from '../ai/codex-context'
import { buildCultivationContext } from '../ai/cultivation-context'
import { buildWorldRulesContext } from '../ai/world-rules-manifest'
import { formatHandoff } from '../ai/chapter-memory/handoff-format'
import { getChapterDerivedMemoryStatus, normalizeChapterText } from '../ai/chapter-memory/text-normalization'
import { parseStages } from '../types/story-arc'
import { parseFields } from '../types/state-card'
import { parseBeats } from '../types/emotion-beat'
import { buildForeshadowTaskContext } from '../foreshadow/context'
import { formatHeldItemsContext, readProjectHeldItems } from '../consistency/held-items'
import { formatCharacterKnowledgeContext, readProjectCharacterKnowledge } from '../knowledge-ledger/knowledge-ledger'
import {
  formatCanonAssertionsContext,
  readCanonAssertions,
  readSettingAssertionScanContext,
} from '../fact-ledger/setting-assertions'
import { readStorylineProgressContext } from '../storyline/storyline-progress'
import { readCodexExtractionBaselineContextV1 } from '../codex/extraction'
import { readHistoryAgentBaselineContextV1 } from '../history/agent-baseline'
import { readReferenceDerivedBaselineContextV1 } from '../reference-analysis/derived-agent-baseline'
import { buildEditImpactGraphV1 } from '../consistency/impact-analysis'
import {
  buildLongTermConsistencyDossierV1,
  formatLongTermConsistencyDossierV1,
} from '../memory/consistency-dossier'
import {
  readCultivationProgressContext,
  readCultivationProgressExtractionBaselineContextV1,
} from '../cultivation/progress'
import { readForeshadowSuggestionBaselineContextV1 } from '../foreshadow/suggestions'
import { readStyleLearningBaselineContextV1 } from '../style/learning-agent'
import { CANON_RESOURCE_PROVIDER_V1 } from '../context-gateway/canon-provider'
import {
  WORLD_RELEASE_NORMALIZATION_VERSION_V1,
  WORLD_RELEASE_PROVIDER_ID_V1,
  WORLD_RELEASE_PROVIDER_VERSION_V1,
  WORLD_RELEASE_RESOURCE_KINDS_V1,
} from '../context-gateway/world-release-provider-contract'
import type {
  Chapter,
  Character,
  Geography,
  Location,
  NarrativeModule,
  NarrativeNode,
  OutlineNode,
  PowerSystem,
  Worldview,
} from '../types'
import {
  parseCharacterDrivenPlanArcs,
  parseCharacterDrivenPlotVolumes,
} from '../types/character-driven-plan'
import type { ContextResourceProviderV1 } from './types'
import type { ContextSource } from './types'
import { countWords, htmlToPlainText } from '../utils/html'
import {
  formatStyleCalibrationFeedback,
  formatStyleFewShotPairs,
  parseStyleCalibrationFeedback,
  parseStyleRevisionPairs,
} from '../style/style-learning'
import {
  buildInspirationFusionInput,
  latestInspirationVersion,
  parseInspirationFragments,
  parseInspirationVersions,
} from '../inspiration/workspace'
import {
  readAgentOutlineTree,
  readAgentProjectStatus,
  readAgentSearchResults,
  readAgentWorldGroups,
} from '../agent/read-sources'
import { readRagSelectionContext } from '../retrieval/rag-library'
import { parseSimulationCanonSnapshot, verifySimulationCanonSnapshot } from '../simulation/canon-snapshot'
import type { AssembleContextInput } from './types'
import { readOwnedRows, resolveScope, assertRecordInScope } from '../world-engine/scope'
import type { WorkspaceScope } from '../types/world-ownership'
import type { AdaptationProject } from '../types'

// 改编来源冻结会拉入完整选择、哈希和同步实现。普通首页/小说创作不需要这段代码；
// 只有真正装配改编上下文时再加载，保持统一 CONTEXT_SOURCES 入口而不污染首屏包。
async function loadAdaptationSourceReader() {
  return import('../adaptation/source-manifest')
}

// Runtime package validation imports every product parser. Keep it behind the
// runtime context boundary so ordinary writing routes do not eagerly load the
// complete upper-product runtime into the application entry chunk.
async function verifyPlayableRuntimeSession(
  input: Parameters<typeof import('../game-production/preview-source')['verifyPlayableSessionPackageV2']>[0],
) {
  return (await import('../game-production/preview-source')).verifyPlayableSessionPackageV2(input)
}

const WORLD_RELEASE_RESOURCE_PROVIDER_PROXY_V1: ContextResourceProviderV1 = {
  version: 'context-resource-provider-v1',
  providerId: WORLD_RELEASE_PROVIDER_ID_V1,
  providerVersion: WORLD_RELEASE_PROVIDER_VERSION_V1,
  normalizationVersion: WORLD_RELEASE_NORMALIZATION_VERSION_V1,
  kinds: WORLD_RELEASE_RESOURCE_KINDS_V1,
  listMetadata: async input => (await import('../context-gateway/world-release-provider'))
    .WORLD_RELEASE_RESOURCE_PROVIDER_V1.listMetadata(input),
  searchMetadata: async input => (await import('../context-gateway/world-release-provider'))
    .WORLD_RELEASE_RESOURCE_PROVIDER_V1.searchMetadata(input),
  read: async input => (await import('../context-gateway/world-release-provider'))
    .WORLD_RELEASE_RESOURCE_PROVIDER_V1.read(input),
  readOriginal: async input => (await import('../context-gateway/world-release-provider'))
    .WORLD_RELEASE_RESOURCE_PROVIDER_V1.readOriginal!(input),
  fingerprint: async scope => (await import('../context-gateway/world-release-provider'))
    .WORLD_RELEASE_RESOURCE_PROVIDER_V1.fingerprint(scope),
}

// Upper-product readers are lazy for the same reason as adaptation readers:
// their production Harnesses import the Skill registry, so eager imports here
// would create CONTEXT_SOURCES -> product Harness -> Skill -> CONTEXT_SOURCES.
async function readGameProductionConsultationSource(input: AssembleContextInput): Promise<string> {
  return (await import('../game-production/context')).readGameProductionConsultationSource(input)
}
async function readGameProductionBriefContext(input: AssembleContextInput): Promise<string> {
  return (await import('../game-production/context')).readGameProductionBriefContext(input)
}
async function readGameProductionArtifactInputs(input: AssembleContextInput): Promise<string> {
  return (await import('../game-production/context')).readGameProductionArtifactInputs(input)
}
async function readGameProductionQualityFeedback(input: AssembleContextInput): Promise<string> {
  return (await import('../game-production/context')).readGameProductionQualityFeedback(input)
}
async function readGameProductionEvolutionBase(input: AssembleContextInput): Promise<string> {
  return (await import('../game-production/context')).readGameProductionEvolutionBase(input)
}
async function readTtrpgGmRuntimeContextV1(input: AssembleContextInput): Promise<string> {
  return (await import('../ttrpg/gm-context')).readTtrpgGmRuntimeContextV1(input)
}
async function readTtrpgPlayerRuntimeContextV1(input: AssembleContextInput): Promise<string> {
  return (await import('../ttrpg/player-context')).readTtrpgPlayerRuntimeContextV1(input)
}
async function requireTargetAdaptation(input: AssembleContextInput): Promise<AdaptationProject> {
  if (input.adaptationProjectId == null || !input.scope) throw new Error('[adaptation-context] 缺少目标改编 selector')
  const root = await db.adaptationProjects.get(input.adaptationProjectId)
  if (!root
    || root.projectId !== input.scope.projectId
    || root.worldId !== input.scope.worldId
    || root.workId !== input.scope.workId) {
    throw new Error('[adaptation-context] 改编项目不属于当前目标 Work')
  }
  return root
}

async function readAdaptationSourceManifestContext(input: AssembleContextInput): Promise<string> {
  const root = await requireTargetAdaptation(input)
  const { inspectAdaptationFreshness, listActiveSourceUnits } = await loadAdaptationSourceReader()
  const [units, freshness] = await Promise.all([
    listActiveSourceUnits(root.id!),
    inspectAdaptationFreshness(root.id!),
  ])
  return [
    '【改编来源清单】',
    `媒介：${root.medium}`,
    `清单版本：v${root.activeSourceManifestVersion}`,
    `清单哈希：${root.activeSourceManifestHash}`,
    `来源覆盖：${root.sourceCoverage}`,
    `来源状态：${freshness.status}`,
    ...units.map(unit => `- ${unit.sourceUnitKey}｜${unit.sourceKind}｜${unit.label}｜顺序 ${unit.order}｜${unit.wordCount} 字｜hash ${unit.contentHash}｜摘要：${unit.summary}`),
    ...(freshness.changes.length ? ['变化：', ...freshness.changes.map(change => `- ${change.kind}｜${change.sourceUnitKey}｜${change.label}`)] : []),
  ].join('\n')
}

async function readAdaptationSourceContentContext(input: AssembleContextInput): Promise<string> {
  const root = await requireTargetAdaptation(input)
  const { readAdaptationSourceContent } = await loadAdaptationSourceReader()
  const slice = await readAdaptationSourceContent({
    targetScope: input.scope!,
    adaptationProjectId: root.id!,
    manifestVersion: input.adaptationSourceManifestVersion!,
    sourceUnitKeys: input.adaptationSourceUnitKeys!,
  })
  return [
    `【改编来源正文｜manifest v${slice.manifestVersion}｜${slice.sourceManifestHash}】`,
    ...slice.units.map(unit => [
      `--- ${unit.sourceUnitKey}｜${unit.sourceKind}｜${unit.label}｜hash ${unit.contentHash} ---`,
      unit.content,
    ].join('\n')),
  ].join('\n\n')
}

async function readAdaptationBriefContext(input: AssembleContextInput): Promise<string> {
  const root = await requireTargetAdaptation(input)
  if (!root.brief || root.briefSourceManifestVersion !== root.activeSourceManifestVersion) return ''
  return `【已确认改编 Brief｜manifest v${root.briefSourceManifestVersion}】\n${JSON.stringify(root.brief)}`
}

async function readAdaptationPlanContext(input: AssembleContextInput): Promise<string> {
  const root = await requireTargetAdaptation(input)
  if (!root.plan || root.planSourceManifestVersion !== root.activeSourceManifestVersion) return ''
  return `【已确认改编计划｜manifest v${root.planSourceManifestVersion}】\n${JSON.stringify(root.plan)}`
}

async function readScreenplayCurrentScenesContext(input: AssembleContextInput): Promise<string> {
  const root = await requireTargetAdaptation(input)
  if (root.medium !== 'screenplay' || !input.screenplaySceneIds?.length) return ''
  const scenes = await db.screenplayScenes.bulkGet(input.screenplaySceneIds)
  if (scenes.some(scene => !scene || scene.adaptationProjectId !== root.id || scene.workId !== root.workId)) throw new Error('[screenplay-context] 场景选择越界')
  return ['【当前剧本场景】', ...(scenes as NonNullable<typeof scenes[number]>[]).map(scene => [
    `--- ${scene.stableKey}｜第 ${scene.episodeNumber} 集第 ${scene.sceneNumber} 场｜${scene.intExt} ${scene.location} - ${scene.timeOfDay}｜${scene.status}｜${scene.estimatedSeconds}s ---`,
    `目的：${scene.summary}`,
    ...scene.blocks.map(block => block.type === 'character' ? `${block.type}｜${block.name}${block.extension ? ` (${block.extension})` : ''}` : `${block.type}｜${block.text}`),
  ].join('\n'))].join('\n\n')
}

async function readComicVisualBibleContext(input: AssembleContextInput): Promise<string> {
  const root = await requireTargetAdaptation(input)
  if (root.medium !== 'comic' || !root.visualBible || root.visualBibleSourceManifestVersion !== root.activeSourceManifestVersion) return ''
  const [subjects, assets] = await Promise.all([
    db.comicVisualSubjects.where('adaptationProjectId').equals(root.id!).toArray(),
    db.comicMediaAssets.where('adaptationProjectId').equals(root.id!).toArray(),
  ])
  const availableKeys = new Set(assets.filter(asset => asset.disposition === 'available').map(asset => asset.stableKey))
  return [
    `【漫画视觉圣经｜manifest v${root.visualBibleSourceManifestVersion}】`,
    JSON.stringify(root.visualBible),
    '【视觉条目】',
    ...subjects.sort((left, right) => left.stableKey.localeCompare(right.stableKey)).map(subject => JSON.stringify({
      stableKey: subject.stableKey,
      kind: subject.kind,
      label: subject.label,
      design: subject.design,
      sourceUnitIds: subject.sourceUnitIds,
      referenceAssetKey: subject.selectedMediaAssetKey && availableKeys.has(subject.selectedMediaAssetKey) ? subject.selectedMediaAssetKey : null,
      status: subject.status,
    })),
  ].join('\n')
}

async function readComicCurrentPagesContext(input: AssembleContextInput): Promise<string> {
  const root = await requireTargetAdaptation(input)
  if (root.medium !== 'comic' || !input.comicPageIds?.length) return ''
  const pages = await db.comicPages.bulkGet(input.comicPageIds)
  if (pages.some(page => !page || page.adaptationProjectId !== root.id || page.workId !== root.workId)) throw new Error('[comic-context] 页面选择越界')
  const pageIds = (pages as NonNullable<typeof pages[number]>[]).map(page => page.id!)
  const panels = await db.comicPanels.where('pageId').anyOf(pageIds).toArray()
  return ['【当前漫画页格】', ...(pages as NonNullable<typeof pages[number]>[]).map(page => [
    `--- ${page.stableKey}｜第 ${page.chapterNumber} 章｜页序 ${page.order + 1}｜${page.status} ---`,
    `摘要：${page.summary}`,
    ...panels.filter(panel => panel.pageId === page.id).sort((left, right) => left.order - right.order).map(panel => JSON.stringify({
      stableKey: panel.stableKey,
      order: panel.order,
      frame: panel.frame,
      shot: panel.shot,
      action: panel.action,
      visualPrompt: panel.visualPrompt,
      negativePrompt: panel.negativePrompt,
      continuityRefs: panel.continuityRefs,
      lettering: panel.lettering,
      selectedMediaAssetKey: panel.selectedMediaAssetKey,
      sourceUnitIds: panel.sourceUnitIds,
      status: panel.status,
    })),
  ].join('\n'))].join('\n\n')
}

async function readSimulationStateForContext(sessionId: number) {
  const { readSimulationState } = await import('../simulation/runtime')
  return readSimulationState(sessionId)
}

async function readActiveNarrativeBlueprint(input: AssembleContextInput): Promise<string> {
  const scope = input.scope ?? await resolveScope({ projectId: input.projectId })
  const work = await db.works.get(scope.workId)
  const moduleId = work?.activeNarrativeModuleId
  if (moduleId == null) return ''
  const module = await db.narrativeModules.get(moduleId) as NarrativeModule | undefined
  if (!module || !await assertRecordInScope(scope, 'narrativeModules', module)) return ''
  const nodes = (await db.narrativeNodes.where('moduleId').equals(moduleId).sortBy('order')) as NarrativeNode[]
  const nodeLines = nodes.map(node => {
    const successors = (() => {
      try {
        const parsed = JSON.parse(node.successorKeysJson)
        return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []
      } catch { return [] }
    })()
    const condition = node.conditionJson !== '{}' ? `｜条件 ${node.conditionJson}` : ''
    const effects = node.effectsJson !== '[]' ? `｜效果 ${node.effectsJson}` : ''
    return `- [${node.key}] ${node.kind}｜${node.title}${node.summary ? `｜${node.summary}` : ''}${condition}${effects}${successors.length ? `｜后继 ${successors.join('、')}` : ''}`
  })
  return [
    '【当前选定叙事蓝图】',
    `类型：${module.kind}`,
    `名称：${module.title}`,
    module.description ? `说明：${module.description}` : '',
    `入口：${module.entryNodeKey ?? '未设置'}`,
    ...nodeLines,
    '后续卷纲、章纲、细纲和正文必须服务该叙事蓝图；若现有材料冲突，应明确指出而不是静默改写蓝图。',
  ].filter(Boolean).join('\n')
}

async function readSimulationRuntimeContext(input: AssembleContextInput): Promise<string> {
  if (input.simulationSessionId == null) return ''
  const session = await db.simulationSessions.get(input.simulationSessionId)
  if (!session || session.projectId !== input.projectId) return ''
  if (input.worldGroupId !== undefined && (session.worldGroupId ?? null) !== (input.worldGroupId ?? null)) return ''
  let sourceLabel: string
  let sourceWorldGroupId: number | null
  let sourceHash: string
  let sourceLines: string[]
  if (session.runtimeSourceHash) {
    if (session.worldId == null || session.workId == null) throw new Error('正式产品实例缺少 Workspace 绑定。')
    const playable = await verifyPlayableRuntimeSession({
      scope: { projectId: session.projectId, worldId: session.worldId, workId: session.workId },
      session,
    })
    if (playable.runtimeSourceHash !== session.runtimeSourceHash) throw new Error('RuntimePackage 校验失败。')
    sourceLabel = playable.runtimePackage.definition.title
    sourceWorldGroupId = session.worldGroupId ?? null
    sourceHash = playable.runtimeSourceHash
    sourceLines = playable.runtimePackage.sourceWorld.selection.resourceKeys.slice(0, 120)
      .map(resourceKey => `- ${resourceKey}｜冻结产品来源`)
  } else {
    const snapshot = parseSimulationCanonSnapshot(session.canonSnapshotJson)
    if (!snapshot || !(await verifySimulationCanonSnapshot(snapshot))) {
      throw new Error('冻结运行时 Canon 快照校验失败。')
    }
    sourceLabel = snapshot.worldLabel
    sourceWorldGroupId = snapshot.worldGroupId ?? null
    sourceHash = snapshot.snapshotHash
    sourceLines = snapshot.sources.slice(0, 120).map(source => (
      `- ${source.sourceKey}｜${source.kind}｜${source.name}${source.summary ? `｜${source.summary}` : ''}`
    ))
  }
  const state = await readSimulationStateForContext(session.id!)
  const entityLines = Object.values(state.entities).slice(0, 120).map(entity => {
    const attributes = Object.entries(entity.attributes)
      .slice(0, 16)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(', ')
    return `- ${entity.entityKey}｜${entity.kind}｜${entity.name}｜地点=${entity.locationKey ?? '无'}｜生命周期=${entity.lifecycleStatus}${attributes ? `｜属性=${attributes}` : ''}`
  })
  const memoryLines = state.memories.slice(-80).map(memory => (
    `- ${memory.subjectKey}｜${memory.status}｜${memory.content}`
  ))
  const narrativeLines = state.narratives.slice(-40).map(item => `- #${item.eventSequence} ${item.text}`)
  const ttrpg = state.ttrpg
  const ttrpgLines = ttrpg ? [
    `- 场景=${ttrpg.scene?.title ?? '未开始'}｜状态=${ttrpg.scene?.status ?? '无'}｜地点=${ttrpg.scene?.locationKey ?? '无'}`,
    `- 回合=${ttrpg.round}｜当前行动者=${ttrpg.activeActorKey ?? '无'}｜顺序=${ttrpg.turnOrder.join(' → ') || '无'}`,
    ...ttrpg.actions.slice(-20).map(action => `- 动作 #${action.eventSequence}｜${action.actorKey}｜${action.text}`),
    ...ttrpg.checks.slice(-20).map(check => (
      `- 检定 #${check.eventSequence}｜${check.actorKey}｜${check.skill}｜${check.expression}=${check.total} vs DC ${check.dc}｜${check.success ? '成功' : '失败'}`
    )),
    ...(ttrpg.attacks ?? []).slice(-20).map(attack => (
      `- 攻击｜${attack.actorKey} → ${attack.targetKey}｜${attack.attackExpression}=${attack.attackTotal} vs AC ${attack.armorClass}｜${attack.hit ? `命中，${attack.resourceKey} ${attack.damageTotal}` : '未命中'}`
    )),
    ...(ttrpg.encounter ? [
      `- 遭遇=${ttrpg.encounter.title}｜状态=${ttrpg.encounter.status}｜战斗回合=${ttrpg.encounter.round}｜当前=${ttrpg.encounter.activeActorKey ?? '无'}`,
      ...ttrpg.encounter.turnOrder.map(key => {
        const combatant = ttrpg.encounter?.combatants[key]
        if (!combatant) return `- 参与者=${key}`
        const resources = Object.entries(combatant.resources).map(([name, resource]) => `${name}=${resource.current}/${resource.maximum}`).join(', ')
        const conditions = combatant.conditions.map(condition => `${condition.name}${condition.stacks > 1 ? `×${condition.stacks}` : ''}`).join('、') || '无'
        return `- 战斗参与者=${key}｜先攻=${combatant.initiative}｜AC=${combatant.armorClass}｜资源=${resources}｜状态=${conditions}`
      }),
    ] : []),
    ...(ttrpg.campaign ? [
      `- 长期战役摘要=${ttrpg.campaign.summary || '暂无'}`,
      ...ttrpg.campaign.quests.slice(-40).map(quest => (
        `- 任务=${quest.questId}｜${quest.title}｜状态=${quest.status}｜优先级=${quest.priority}${quest.dueClock == null ? '' : `｜期限=${quest.dueClock}`}${quest.description ? `｜${quest.description}` : ''}`
      )),
      ...ttrpg.campaign.npcSchedules.slice(-40).map(schedule => (
        `- NPC日程=${schedule.scheduleId}｜${schedule.entityKey}｜${schedule.startClock}-${schedule.endClock ?? '持续'}｜地点=${schedule.locationKey ?? '无'}｜${schedule.activity}｜重复=${schedule.recurrence}`
      )),
    ] : []),
  ] : []
  const interactionLines = state.interaction ? [
    `- 场景=${state.interaction.activeScene?.title ?? '未开始'}｜玩家回合=${state.interaction.totalPlayerTurns}｜导演剩余预算=${state.interaction.remainingDirectorBudget}`,
    `- 当前参与者=${state.interaction.activeScene?.activeParticipantKeys.join('、') || '无'}｜开放线索=${state.interaction.threads.filter(item => item.status === 'open').map(item => item.threadKey).join('、') || '无'}`,
  ] : []
  return [
    `【冻结运行时会话】${session.title}｜类型=${session.kind}｜逻辑时间=${state.clock}｜事件序号=${state.lastSequence}`,
    `【冻结来源】${sourceLabel}｜worldGroupId=${sourceWorldGroupId ?? 'null'}｜hash=${sourceHash.slice(0, 16)}`,
    '【冻结 Canon 来源（只读）】',
    ...(sourceLines.length ? sourceLines : ['- 暂无冻结来源']),
    '【运行时实体（只读）】',
    ...(entityLines.length ? entityLines : ['- 暂无运行时实体']),
    '【运行时记忆（只读）】',
    ...(memoryLines.length ? memoryLines : ['- 暂无记忆']),
    '【最近运行时叙事（只读）】',
    ...(narrativeLines.length ? narrativeLines : ['- 暂无叙事']),
    ...(ttrpgLines.length ? ['【跑团场景与回合（只读）】', ...ttrpgLines] : []),
    ...(interactionLines.length ? ['【角色互动状态（逐角色知识边界，只读）】', ...interactionLines] : []),
  ].join('\n')
}

async function readInteractionRuntimeContext(input: AssembleContextInput): Promise<string> {
  if (input.simulationSessionId == null) return ''
  const participantKey = input.interactionParticipantKey?.trim()
  if (!participantKey) return ''
  const session = await db.simulationSessions.get(input.simulationSessionId)
  if (!session || session.projectId !== input.projectId
    || !['chatgame', 'textadventure', 'textworld'].includes(session.kind)) return ''
  if (input.worldGroupId !== undefined && (session.worldGroupId ?? null) !== (input.worldGroupId ?? null)) return ''
  if (session.worldId == null || session.workId == null || !session.runtimeSourceHash) {
    throw new Error('正式角色互动实例缺少产品运行源。')
  }
  const playable = await verifyPlayableRuntimeSession({
    scope: { projectId: session.projectId, worldId: session.worldId, workId: session.workId },
    session,
  })
  if (playable.runtimeSourceHash !== session.runtimeSourceHash) {
    throw new Error('角色互动 RuntimePackage 校验失败。')
  }
  const state = await readSimulationStateForContext(session.id!)
  if (!state.interaction) return ''
  const profile = state.interaction.profiles.find(item => item.participantKey === participantKey)
  if (!profile) return ''
  const { buildInteractionContextWindow } = await import('../character-interaction/runtime')
  const view = buildInteractionContextWindow(state.interaction, participantKey, {
    maxCharacters: 24_000,
    maxRecentMessages: 32,
  })
  return [
    `【角色互动视角】${profile.name}｜key=${profile.participantKey}｜身份=${profile.roleLabel}`,
    `【说话约束】${profile.voiceRules}`,
    `【当前场景】${view.activeScene?.title ?? '未开始'}｜${view.activeScene?.purpose ?? ''}`,
    '【该角色已知事实】',
    ...(view.knowledge.length ? view.knowledge.map(item => `- ${item.knowledgeKey}｜${item.status}｜${item.content}`) : ['- 无']),
    '【该角色持久记忆】',
    ...(view.memories.length ? view.memories.map(item => `- ${item.kind}｜重要度=${item.importance}｜${item.content}`) : ['- 无']),
    '【该角色关系视图】',
    ...(view.relationships.length ? view.relationships.map(item => `- ${item.toParticipantKey}｜${item.label}=${item.value}`) : ['- 无']),
    '【该角色可见对话】',
    ...(view.messages.length ? view.messages.map(message => `- #${message.eventSequence}｜${message.speakerKey}｜${message.text}`) : ['- 无']),
    `【预算证据】省略早期消息=${view.omittedMessageCount}｜字符=${view.characterCount}`,
  ].join('\n')
}

async function readAdventureRuntimeContext(input: AssembleContextInput): Promise<string> {
  if (input.simulationSessionId == null) return ''
  const session = await db.simulationSessions.get(input.simulationSessionId)
  if (!session || session.projectId !== input.projectId
    || (session.kind !== 'textadventure' && session.kind !== 'textworld')
    || (session.gameReleaseId == null && session.gameBuildId == null)) return ''
  if (input.worldGroupId !== undefined && (session.worldGroupId ?? null) !== (input.worldGroupId ?? null)) return ''
  if (session.worldId == null || session.workId == null) throw new Error('正式文字冒险实例缺少工作区作用域。')
  const [playable, { availableAdventureActions }] = await Promise.all([
    verifyPlayableRuntimeSession({
      scope: { projectId: session.projectId, worldId: session.worldId, workId: session.workId },
      session,
    }),
    import('../adventure/runtime'),
  ])
  const runtimePackage = playable.runtimePackage
  if ((runtimePackage.productType !== 'text-adventure' && runtimePackage.productType !== 'text-open-world')
    || !runtimePackage.adventure || playable.runtimeSourceHash !== session.runtimeSourceHash) {
    throw new Error('文字冒险 RuntimePackage 校验失败。')
  }
  const adventure = runtimePackage.adventure
  const state = await readSimulationStateForContext(session.id!)
  if (!state.adventure) return ''
  const location = adventure.locations.find(item => item.key === state.adventure!.currentLocationKey)
  if (!location) throw new Error('文字冒险当前位置不在冻结发布中。')
  const actions = availableAdventureActions(adventure, state.adventure, state.narrative?.variables)
  const inventory = state.adventure.inventory
    .filter(item => item.ownerKey === 'player' && item.state !== 'transferred')
    .map(item => `${item.itemKey}×${item.quantity}`)
  const quests = state.adventure.quests.map(quest => {
    const definition = adventure.quests.find(item => item.key === quest.questKey)
    const objectives = quest.objectives.map(objective => {
      const title = definition?.objectives.find(item => item.key === objective.objectiveKey)?.title ?? objective.objectiveKey
      return `${objective.completed ? '已完成' : '未完成'}:${title}`
    })
    return `- ${quest.questKey}｜${quest.status}｜${objectives.join('；') || '无目标'}`
  })
  const actionLines = actions.map(item => `- ${item.action.key}｜${item.action.kind}｜${item.action.label}｜${item.available ? '可执行' : `不可执行:${item.reason}`}`)
  const recent = state.adventure.actionHistory.slice(-12).map(item => `- #${item.eventSequence} ${item.actionKey}｜${item.outcome}｜${item.narrative}`)
  return [
    `【文字冒险运行时】${session.title}｜事件序号=${state.lastSequence}｜运行源=${playable.packageHash.slice(0, 16)}`,
    `【当前位置】${location.title}｜key=${location.key}｜${location.description}`,
    `【在场交互物】${adventure.objects.filter(item => item.locationKey === location.key).map(item => `${item.key}:${item.title}`).join('、') || '无'}`,
    `【背包】${inventory.join('、') || '空'}`,
    `【资源】${Object.entries(state.adventure.resources).map(([key, value]) => `${key}=${value}`).join('、') || '无'}`,
    `【能力】${Object.entries(state.adventure.abilities).map(([key, value]) => `${key}=${value}`).join('、') || '无'}`,
    `【状态】${state.adventure.conditions.map(item => `${item.conditionKey}${item.duration == null ? '' : `(${item.duration})`}`).join('、') || '无'}`,
    '【任务】', ...(quests.length ? quests : ['- 无']),
    '【当前位置行动闭集】', ...(actionLines.length ? actionLines : ['- 无']),
    `【Narrative】节点=${state.narrative?.currentNodeKey ?? '无'}｜可用选择=${state.narrative?.availableChoiceKeys?.join('、') || '无'}`,
    '【最近行动结果】', ...(recent.length ? recent : ['- 无']),
    '自由输入只能映射到“可执行”的 action key；不得创造新地点、物品、任务、判定结果或状态变化。',
  ].join('\n')
}

async function readNarrativeSimulationRuntimeContext(input: AssembleContextInput): Promise<string> {
  if (input.simulationSessionId == null) return ''
  const session = await db.simulationSessions.get(input.simulationSessionId)
  if (!session || session.projectId !== input.projectId
    || (session.kind !== 'textsimulation' && session.kind !== 'textworld')
    || (session.gameReleaseId == null && session.gameBuildId == null)) return ''
  if (input.worldGroupId !== undefined && (session.worldGroupId ?? null) !== (input.worldGroupId ?? null)) return ''
  if (session.worldId == null || session.workId == null) throw new Error('正式叙事模拟实例缺少工作区作用域。')
  const [playable, runtimeModule] = await Promise.all([
    verifyPlayableRuntimeSession({
      scope: { projectId: session.projectId, worldId: session.worldId, workId: session.workId },
      session,
    }),
    import('../narrative-simulation/runtime'),
  ])
  const runtimePackage = playable.runtimePackage
  if ((runtimePackage.productType !== 'narrative-simulation' && runtimePackage.productType !== 'text-open-world')
    || !runtimePackage.simulation || playable.runtimeSourceHash !== session.runtimeSourceHash) {
    throw new Error('叙事模拟 RuntimePackage 校验失败。')
  }
  const state = await readSimulationStateForContext(session.id!)
  if (!state.narrativeSimulation) return ''
  const simulation = state.narrativeSimulation
  const actions = runtimeModule.availableNarrativeSimulationActions(runtimePackage.simulation, simulation)
  const reports = runtimeModule.visibleNarrativeSimulationReports(simulation, 'player')
  const issueByKey = new Map(runtimePackage.simulation.issues.map(issue => [issue.key, issue]))
  return [
    `【叙事模拟玩家视角】${session.title}｜回合=${simulation.turn}/${simulation.turnLimit}｜阶段=${simulation.phase}｜事件序号=${state.lastSequence}`,
    `【冻结运行源】${playable.packageHash.slice(0, 16)}｜行动预算=${simulation.actionBudget}`,
    `【资源】${Object.entries(simulation.resources).map(([key, value]) => `${key}=${value}`).join('、') || '无'}`,
    `【指标】${Object.entries(simulation.metrics).map(([key, value]) => `${key}=${value}`).join('、') || '无'}`,
    '【问题与危机】',
    ...simulation.issues.map(issue => {
      const definition = issueByKey.get(issue.issueKey)
      return `- ${issue.issueKey}｜阶段=${issue.stageKey}｜压力=${issue.pressure}｜${definition?.crisis ? '危机' : '问题'}｜${issue.resolved ? '已解决' : '进行中'}`
    }),
    '【当前行动闭集】',
    ...actions.map(item => `- ${item.action.key}｜${item.action.category}｜${item.action.title}｜${item.available ? '可执行' : `不可执行:${item.reason}`}`),
    '【玩家可见报告】',
    ...(reports.length ? reports.slice(-24).map(report => `- ${report.reportId}｜回合=${report.turn}｜置信度=${report.confidence}｜证据=${report.sourceEventSequences.join(',') || '父分支快照'}｜${report.text}`) : ['- 暂无']),
    `【Narrative】节点=${state.narrative?.currentNodeKey ?? '无'}｜可用选择=${state.narrative?.availableChoiceKeys?.join('、') || '无'}｜模拟结局=${simulation.qualifiedEndingKey ?? '未确定'}`,
    '模型只能输出有事件证据的报告、建议或表演候选；不得改变资源、指标、问题、行动、回合或结局，也不得读取 actor/debug 私有报告。',
  ].join('\n')
}

async function readOpenWorldRuntimeContext(input: AssembleContextInput): Promise<string> {
  if (input.simulationSessionId == null) return ''
  const session = await db.simulationSessions.get(input.simulationSessionId)
  if (!session || session.projectId !== input.projectId || session.kind !== 'textworld'
    || (session.gameReleaseId == null && session.gameBuildId == null)) return ''
  if (input.worldGroupId !== undefined && (session.worldGroupId ?? null) !== (input.worldGroupId ?? null)) return ''
  if (session.worldId == null || session.workId == null) throw new Error('正式开放世界实例缺少工作区作用域。')
  const playable = await verifyPlayableRuntimeSession({
    scope: { projectId: session.projectId, worldId: session.worldId, workId: session.workId },
    session,
  })
  const manifest = playable.runtimePackage
  if (manifest.productType !== 'text-open-world' || !manifest.openWorld
    || playable.runtimeSourceHash !== session.runtimeSourceHash) {
    throw new Error('开放世界 RuntimePackage 校验失败。')
  }
  const state = await readSimulationStateForContext(session.id!)
  if (!state.openWorld) return ''
  const world = state.openWorld
  const region = manifest.openWorld.regions.find(item => item.key === world.currentRegionKey)
  const projection = world.regionalProjections.find(item => item.regionKey === world.currentRegionKey)
  if (!region || !projection) return ''
  const recentEvents = (await db.simulationEvents.where('sessionId').equals(session.id!).toArray())
    .filter(event => event.type.startsWith('world.') || event.type.startsWith('adventure.quest.'))
    .sort((left, right) => left.sequence - right.sequence).slice(-32)
  const visibleQuests = world.questInstances.filter(item => ['revealed', 'active', 'resolved', 'failed'].includes(item.status))
  return [
    `【文字开放世界玩家视角】${session.title}｜tick=${world.tick}/${world.tickLimit}｜事件序号=${state.lastSequence}`,
    `【冻结运行源】${playable.packageHash.slice(0, 16)}｜当前区域=${region.key}:${region.title}｜旅行=${world.travel ? `${world.travel.toRegionKey}(${world.travel.remainingTicks})` : '无'}`,
    `【区域认知】${Object.entries(world.regionKnowledge).map(([key, value]) => `${key}=${value}`).join('、')}`,
    `【关注级别】${Object.entries(world.attentionLevels).map(([key, value]) => `${key}=${value}`).join('、')}`,
    `【当前区域资源】${Object.entries(projection.resources).map(([key, value]) => `${key}=${value}`).join('、')}`,
    `【当前区域指标】${Object.entries(projection.metrics).map(([key, value]) => `${key}=${value}`).join('、')}`,
    `【当前区域问题】${Object.entries(projection.issuePressures).map(([key, value]) => `${key}=${value}`).join('、')}`,
    `【在地人物】${region.residentParticipantKeys.join('、') || '无'}｜【组织】${region.organizationKeys.join('、') || '无'}`,
    '【已公开任务实例】',
    ...(visibleQuests.length ? visibleQuests.map(quest => `- ${quest.instanceKey}｜${quest.status}｜${quest.questKey}｜${quest.title}｜区域=${quest.regionKey}｜渠道=${quest.channelKey}｜${quest.description}`) : ['- 无']),
    '【可引用正式事件】',
    ...(recentEvents.length ? recentEvents.map(event => `- #${event.sequence}｜${event.type}｜actor=${event.actorKey ?? '无'}｜target=${event.targetKey ?? '无'}`) : ['- 无']),
    `【Narrative】节点=${state.narrative?.currentNodeKey ?? '无'}｜可用选择=${state.narrative?.availableChoiceKeys?.join('、') || '无'}`,
    '模型只能润色已公开任务或叙述有正式事件证据的场景；不得创造新任务、人物、组织、地点、资源变化、旅行结果或世界事实。',
  ].join('\n')
}

async function readWorldview(projectId: number, worldGroupId?: number | null, scope?: WorkspaceScope): Promise<Worldview | null> {
  const resolved = scope ?? await resolveScope({ projectId })
  const rows = await readOwnedRows<Worldview>(resolved, 'worldviews', { owner: 'world' })
  if (worldGroupId != null) {
    return rows.find(w => w.worldGroupId === worldGroupId) ?? null
  }
  return rows.find(w => (w.worldGroupId ?? null) === null) ?? rows[0] ?? null
}

async function readGeographyContext(projectId: number, worldGroupId?: number | null, scope?: WorkspaceScope): Promise<string> {
  const resolved = scope ?? await resolveScope({ projectId })
  const rows = await readOwnedRows<Geography>(resolved, 'geographies', { owner: 'world' })
  const geography = worldGroupId != null
    ? rows.find(row => row.worldGroupId === worldGroupId)
    : rows.find(row => (row.worldGroupId ?? null) === null) ?? rows[0]
  if (!geography) return ''
  const parts: string[] = []
  if (geography.overview?.trim()) parts.push(`【地理总述】\n${geography.overview.trim()}`)
  try {
    const locations = JSON.parse(geography.locations || '[]') as Location[]
    if (Array.isArray(locations) && locations.length) {
      parts.push(`【旧版地理地点】\n${locations.slice(0, 100).map(location => (
        `- ${String(location.name ?? '').trim()}（${String(location.type ?? 'other')}）：${String(location.description ?? '').trim() || '无描述'}`
      )).join('\n')}`)
    }
  } catch {
    // Corrupt legacy location JSON is omitted; the registered source never
    // guesses a replacement or exposes a component-level parsing bypass.
  }
  return parts.join('\n\n')
}

async function readPowerSystem(projectId: number, worldGroupId?: number | null, scope?: WorkspaceScope): Promise<PowerSystem | null> {
  const resolved = scope ?? await resolveScope({ projectId })
  const rows = await readOwnedRows<PowerSystem>(resolved, 'powerSystems', { owner: 'world' })
  if (worldGroupId != null) {
    return rows.find(p => p.worldGroupId === worldGroupId) ?? null
  }
  return rows.find(p => (p.worldGroupId ?? null) === null) ?? rows[0] ?? null
}

async function readCharacters(projectId: number, worldGroupId?: number | null, scope?: WorkspaceScope): Promise<Character[]> {
  const resolved = scope ?? await resolveScope({ projectId })
  const rows = await readOwnedRows<Character>(resolved, 'characters', { owner: 'world' })
  if (worldGroupId === undefined) return rows
  const wg = worldGroupId ?? null
  return rows.filter(c => c.isCrossWorld || (c.homeWorldGroupId ?? null) === wg)
}

async function readTargetCharacter(input: AssembleContextInput): Promise<string> {
  if (input.characterId == null) return ''
  const characters = await readCharacters(input.projectId, input.worldGroupId, input.scope)
  return buildTargetCharacterContext(characters.find(character => character.id === input.characterId) ?? null)
}

async function readForeshadows(projectId: number, chapterId?: number | null, scope?: WorkspaceScope): Promise<string> {
  const resolved = scope ?? await resolveScope({ projectId })
  const [rows, chapters, outlineNodes] = await Promise.all([
    readOwnedRows<any>(resolved, 'foreshadows', { owner: 'work' }),
    readOwnedRows<Chapter>(resolved, 'chapters', { owner: 'work' }),
    readOwnedRows<OutlineNode>(resolved, 'outlineNodes', { owner: 'work' }),
  ])
  return buildForeshadowTaskContext(rows, {
    currentChapterId: chapterId ?? null,
    chapters,
    outlineNodes,
  })
}

/** FB-5:作者文风画像。仅当画像存在且 enabled 时返回,否则空串(不进上下文)。 */
async function readUserStyleProfile(projectId: number, scope?: WorkspaceScope): Promise<string> {
  const resolved = scope ?? await resolveScope({ projectId })
  const profile = (await readOwnedRows<any>(resolved, 'userStyleProfiles', { owner: 'work' }))[0]
  if (!profile || !profile.enabled || !profile.profile.trim()) return ''
  const pairExamples = formatStyleFewShotPairs(parseStyleRevisionPairs(profile.revisionPairs))
  const feedback = formatStyleCalibrationFeedback(
    parseStyleCalibrationFeedback(profile.calibrationFeedback),
  )
  return [
    '【作者文风偏好】',
    '请在本次写作中贴合作者一贯的表达习惯，但不要照搬样本中的剧情、人物名、地点名或专有名词。',
    profile.profile.trim(),
    pairExamples ? `【作者改稿对照（仅学习改写方向）】\n${pairExamples}` : '',
    feedback ? `【最近校准反馈】\n${feedback}` : '',
  ].filter(Boolean).join('\n\n')
}

async function readInspirationWorkspaceContext(
  projectId: number,
  selectedIds: string[] | undefined,
  mode: 'single' | 'multiworld' = 'single',
  scope?: WorkspaceScope,
): Promise<string> {
  if (!selectedIds?.length) return ''
  const resolved = scope ?? await resolveScope({ projectId })
  const workspace = (await readOwnedRows<any>(resolved, 'inspirationWorkspaces', { owner: 'work' }))[0]
  if (!workspace) return ''
  const fragments = parseInspirationFragments(workspace.fragments)
  const versions = parseInspirationVersions(workspace.versions)
  return buildInspirationFusionInput({
    fragments,
    selectedIds: new Set(selectedIds),
    previousVersion: latestInspirationVersion(versions, mode),
  })
}

export async function readActiveCharacterDrivenPlanContext(
  projectId: number,
  scope?: WorkspaceScope,
  explicitPlanId?: number,
): Promise<string> {
  const project = await db.projects.get(projectId)
  const resolved = scope ?? await resolveScope({ projectId })
  const work = resolved.workId > 0 ? await db.works.get(resolved.workId) : null
  const activeId = explicitPlanId
    ?? work?.activeCharacterDrivenPlanId
    ?? project?.activeCharacterDrivenPlanId
  if (activeId == null) return ''

  const plan = await db.characterDrivenPlans.get(activeId)
  if (!plan || !await assertRecordInScope(resolved, 'characterDrivenPlans', plan, { owner: 'work' })) return ''

  const [characters, arcs] = await Promise.all([
    readOwnedRows<Character>(resolved, 'characters', { owner: 'world' }),
    Promise.resolve(parseCharacterDrivenPlanArcs(plan.arcs)),
  ])
  const byId = new Map(characters.flatMap(character =>
    character.id == null ? [] : [[character.id, character] as const],
  ))
  const lines = [
    `【${explicitPlanId == null ? '当前生效的' : '本次选定的'}角色驱动方案】${plan.name}（v${plan.version}，${plan.status}）`,
  ]
  if (plan.userHint.trim()) lines.push(`作者要求：${plan.userHint.trim()}`)
  for (const arc of arcs) {
    const current = arc.characterId == null ? null : byId.get(arc.characterId)
    const identity = current
      ? `${current.name}${current.name !== arc.name ? `（方案快照名：${arc.name}）` : ''}`
      : `${arc.name}（原角色已删除，仅保留方案快照）`
    lines.push(
      `- ${identity}｜${arc.role || '未标注身份'}：${arc.initialState || '未填写'} → ${arc.targetState || '未填写'}`,
    )
  }
  // 显式 planId 用于重新生成：只读取作者输入，避免旧生成结果污染新候选。
  // 下游普通上下文没有显式 ID，继续读取 active 方案的完整已确认规划。
  if (explicitPlanId == null) {
    const volumes = parseCharacterDrivenPlotVolumes(plan.generatedVolumes)
    for (const volume of volumes) {
      lines.push(`卷：${volume.volumeTitle}｜${volume.volumeSummary}`)
      if (volume.characterArcs) lines.push(`  弧光：${volume.characterArcs}`)
      for (const chapter of volume.chapters) {
        lines.push(`  - ${chapter.title}：${chapter.summary}${chapter.arcProgress ? `；弧光推进：${chapter.arcProgress}` : ''}`)
      }
    }
  }
  return lines.join('\n')
}

async function readStoryArcs(projectId: number, scope?: WorkspaceScope): Promise<string> {
  try {
    const resolved = scope ?? await resolveScope({ projectId })
    const arcs = await readOwnedRows<any>(resolved, 'storyArcs', { owner: 'work' })
    if (!arcs.length) return ''

    const parts = ['【全局故事线】\n⚠️ 注意：若与"故事核心"冲突，以"故事核心"为准。']

    for (const arc of arcs.slice(0, 8)) {
      if (!arc || typeof arc !== 'object') continue

      const stages = parseStages(arc.stages || '[]')
      if (stages.length === 0) continue

      const typeLabel = arc.type === 'main' ? '主线' : '支线'
      const arcName = arc.name || '未命名'

      const arcDesc = arc.description
        ? smartTruncate(arc.description, 150)
        : ''
      parts.push(`\n[${typeLabel}] ${arcName}${arcDesc ? `：${arcDesc}` : ''}`)

      const stagesToShow = stages.slice(0, 6)
      for (let i = 0; i < stagesToShow.length; i++) {
        const stage = stagesToShow[i]
        if (!stage) continue

        const stageTitle = stage.title || `阶段 ${i + 1}`
        const stageDesc = stage.description
          ? smartTruncate(stage.description, 100)
          : '(无描述)'

        const events = Array.isArray(stage.keyEvents)
          ? stage.keyEvents.slice(0, 5).filter((e: string) => e && e.trim())
          : []
        const eventsStr = events.length > 0
          ? ` | 关键事件：${events.join(' → ')}`
          : ''

        const tpStr = stage.turningPoint && stage.turningPoint.trim()
          ? ` | ⚡ 转折点：${smartTruncate(stage.turningPoint, 80)}`
          : ''

        parts.push(`  ${i + 1}. ${stageTitle}：${stageDesc}${eventsStr}${tpStr}`)
      }

      if (stages.length > stagesToShow.length) parts.push(`  ...（另有 ${stages.length - stagesToShow.length} 个阶段，可按需读取）`)
    }

    return parts.join('\n')
  } catch (error) {
    console.warn('[readStoryArcs] 读取失败：', error)
    return ''
  }
}

/**
 * 智能截断函数：保留首尾，避免丢失反转信息
 * @param text 原始文本
 * @param maxChars 最大字符数
 * @returns 截断后的文本
 */
function smartTruncate(text: string, maxChars: number): string {
  if (!text || text.length <= maxChars) return text || ''

  // 保留首段（通常是铺垫）
  const headSize = Math.floor(maxChars * 0.6)
  // 保留尾段（通常是反转/结果）
  const tailSize = Math.floor(maxChars * 0.4) - 5

  const head = text.slice(0, headSize)
  const tail = text.slice(-tailSize)

  return `${head}...${tail}`
}

async function readEmotionBeats(projectId: number, chapterId?: number | null, scope?: WorkspaceScope): Promise<string> {
  if (chapterId == null) return ''
  const resolved = scope ?? await resolveScope({ projectId })
  const rows = await readOwnedRows<any>(resolved, 'emotionBeatCards', { owner: 'work' })
  const card = rows.find(c => c.chapterId === chapterId)
  if (!card) return ''
  const beats = parseBeats(String(card.beats || '[]'))
  if (!beats.length) return ''
  return [
    '【本章情感节拍规划】',
    card.overallArc ? `整体弧线:${card.overallArc}` : '',
    ...beats.map(b => `- ${b.label}${b.sceneGoal ? `: ${b.sceneGoal}` : ''}`),
  ].filter(Boolean).join('\n')
}

/** FLOW-3D：只读的一致性影响摘要，供节点图接线查看，不产生任何写回。 */
async function readConsistencyReport(
  projectId: number,
  chapterId?: number | null,
  scope?: WorkspaceScope,
): Promise<string> {
  if (chapterId == null) return ''
  const impact = await buildEditImpactGraphV1(scope ?? projectId, chapterId)
  const staleFacts = impact.nodes.filter(node => node.kind === 'fact' && node.status && ['stale', 'source-missing', 'invalid-range'].includes(node.status))
  const lines = [
    `【一致性影响图】${impact.nodes.length} 个节点、${impact.edges.length} 条边；当前章节来源事实 ${impact.nodes.filter(node => node.kind === 'fact').length} 条；后续可能受影响章节 ${impact.downstreamChapterIds.length} 个。`,
    `【影响图指纹】${impact.graphHash}`,
    staleFacts.length ? `【待复核事实】${staleFacts.map(fact => fact.label ?? `事实#${fact.recordId ?? '?'}`).join('；')}` : '【待复核事实】暂无已标记失效事实。',
  ]
  return lines.join('\n')
}

async function readStateCards(projectId: number, referenceText?: string, extraIds?: number[], scope?: WorkspaceScope): Promise<string> {
  const resolved = scope ?? await resolveScope({ projectId })
  const rows = await readOwnedRows<any>(resolved, 'stateCards', { owner: 'work' })
  if (!rows.length) return ''
  const extra = new Set(extraIds ?? [])
  const text = referenceText || ''
  const selected = text
    ? rows.filter(c => extra.has(c.id!) || text.includes(c.entityName))
    : rows.slice(0, 40)
  if (!selected.length) return ''
  const lines = selected.map(c => {
    const fields = parseFields(c.fields).slice(0, 8).map(f => `${f.key}:${f.value}`).join(' | ')
    return `- ${c.category}/${c.entityName}: ${fields}`
  })
  return `【当前状态表】\n${lines.join('\n')}`
}

async function readChapterOutline(projectId: number, outlineNodeId?: number | null, chapterId?: number | null, scope?: WorkspaceScope): Promise<string> {
  let nodeId = outlineNodeId ?? null
  if (nodeId == null && chapterId != null) {
    const chapter = await db.chapters.get(chapterId)
    if (scope && (!chapter || !await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' }))) return ''
    nodeId = chapter?.outlineNodeId ?? null
  }
  if (nodeId == null) return ''
  const node = await db.outlineNodes.get(nodeId)
  if (scope && (!node || !await assertRecordInScope(scope, 'outlineNodes', node, { owner: 'work' }))) return ''
  if (!node || node.projectId !== projectId) return ''
  return `【当前章节大纲】\n${node.title}${node.summary ? `\n${node.summary}` : ''}`
}

async function readAdjacentChapterOutlines(
  projectId: number,
  outlineNodeId?: number | null,
  scope?: WorkspaceScope,
): Promise<string> {
  if (outlineNodeId == null) return ''
  const resolved = scope ?? await resolveScope({ projectId })
  const rows = await readOwnedRows<OutlineNode>(resolved, 'outlineNodes', { owner: 'work' })
  const ordered = walkOutlineChaptersInCanonicalOrder(rows).chapters
  const currentIndex = ordered.findIndex(item => item.outlineNode.id === outlineNodeId)
  if (currentIndex < 0) return ''
  const worldGroupId = ordered[currentIndex].worldGroupId
  const previous = ordered.slice(0, currentIndex).reverse().find(item => item.worldGroupId === worldGroupId)
  const next = ordered.slice(currentIndex + 1).find(item => item.worldGroupId === worldGroupId)
  if (!previous && !next) return ''
  return [
    '【相邻章纲】',
    previous ? `上一章《${previous.outlineNode.title}》：${previous.outlineNode.summary || '（无摘要）'}` : '',
    next ? `下一章《${next.outlineNode.title}》：${next.outlineNode.summary || '（无摘要）'}` : '',
  ].filter(Boolean).join('\n')
}

async function readExistingVolumeOutlines(projectId: number, scope?: WorkspaceScope): Promise<string> {
  const resolved = scope ?? await resolveScope({ projectId })
  const rows = await readOwnedRows<OutlineNode>(resolved, 'outlineNodes', { owner: 'work' })
  const volumes = rows
    .filter(node => node.type === 'volume' && node.parentId == null)
    .sort((a, b) => a.order - b.order)
  if (!volumes.length) return ''
  return [
    '【已有卷大纲（必须接续，禁止重复）】',
    ...volumes.map((volume, index) => (
      `${index + 1}. ${volume.title}${volume.summary ? `\n   ${volume.summary}` : '\n   （尚未填写卷纲）'}`
    )),
  ].join('\n')
}

async function readOutlineSummariesForAnalysis(
  projectId: number,
  worldGroupId: number | null,
  scope?: WorkspaceScope,
): Promise<string> {
  const resolved = scope ?? await resolveScope({ projectId })
  const rows = (await readOwnedRows<OutlineNode>(resolved, 'outlineNodes', { owner: 'work' }))
    .filter(node => (node.worldGroupId ?? null) === worldGroupId)
    .filter(node => node.title || node.summary)
    .sort((left, right) => left.order - right.order || (left.id ?? 0) - (right.id ?? 0))
  return rows.map(node => `[${node.type}] ${node.title}${node.summary ? `：${node.summary}` : ''}`).join('\n')
}

async function readWrittenChaptersForAnalysis(
  projectId: number,
  worldGroupId: number | null,
  scope?: WorkspaceScope,
): Promise<string> {
  const resolved = scope ?? await resolveScope({ projectId })
  const [allChapters, outlineNodes] = await Promise.all([
    readOwnedRows<Chapter>(resolved, 'chapters', { owner: 'work' }),
    readOwnedRows<OutlineNode>(resolved, 'outlineNodes', { owner: 'work' }),
  ])
  const visibleOutlineIds = new Set(outlineNodes
    .filter(node => (node.worldGroupId ?? null) === worldGroupId)
    .flatMap(node => node.id == null ? [] : [node.id]))
  const chapters = allChapters
    .filter(chapter => visibleOutlineIds.has(chapter.outlineNodeId))
    .filter(chapter => htmlToPlainText(chapter.content || '').trim())
    .sort((left, right) => left.order - right.order || (left.id ?? 0) - (right.id ?? 0))
  let remaining = 24_000
  const parts: string[] = []
  for (const chapter of chapters) {
    if (remaining <= 0) break
    const text = htmlToPlainText(chapter.content || '').trim()
    const excerpt = text.slice(0, Math.min(3_000, remaining))
    if (excerpt) parts.push(`【${chapter.title}】\n${excerpt}`)
    remaining -= excerpt.length
  }
  return parts.join('\n\n')
}

function findVolumeAncestor(nodeId: number, nodesById: Map<number, OutlineNode>): OutlineNode | null {
  let current = nodesById.get(nodeId) ?? null
  const visited = new Set<number>()
  while (current) {
    if (current.type === 'volume') return current
    if (current.parentId == null || visited.has(current.id ?? -1)) return null
    if (current.id != null) visited.add(current.id)
    current = nodesById.get(current.parentId) ?? null
  }
  return null
}

function excerptChapterText(chapter: Chapter, maxChars = 360): string {
  const text = normalizeChapterText(chapter.content || '')
  if (!text) return ''
  if (text.length <= maxChars) return text
  const edge = Math.max(100, Math.floor(maxChars / 2))
  return `${text.slice(0, edge)}\n...\n${text.slice(-edge)}`
}

async function summarizeWrittenChapterForOutline(entry: {
  ordinal: number
  chapter: Chapter
  outlineNode: OutlineNode | null
}): Promise<string> {
  const title = entry.outlineNode?.title ?? entry.chapter.title
  const plain = normalizeChapterText(entry.chapter.content || '')
  const words = Math.max(entry.chapter.wordCount || 0, countWords(htmlToPlainText(entry.chapter.content || '').trim()))
  const lines = [`第 ${entry.ordinal} 章 ${title}（已写正文，约 ${words} 字）`]

  const memory = await getChapterDerivedMemoryStatus(entry.chapter)
  if (entry.chapter.summary?.trim() && memory.summary === 'verified') {
    lines.push(`章节记忆:${entry.chapter.summary.trim()}`)
  } else if (entry.outlineNode?.summary?.trim()) {
    lines.push(`原章纲:${entry.outlineNode.summary.trim()}`)
  }

  if (entry.chapter.continuityHandoff && memory.handoff === 'verified') {
    const handoffLines = formatHandoff(entry.chapter.continuityHandoff).slice(0, 8)
    if (handoffLines.length) lines.push(`结尾交接:${handoffLines.join('；')}`)
  }

  const reconciliation = entry.chapter.planReconciliation
  if (reconciliation?.confirmedActualProgress?.trim()) {
    lines.push(`作者确认实际进展:${reconciliation.confirmedActualProgress.trim()}`)
  } else if (reconciliation) {
    const deltas = [
      ...reconciliation.deviations.map(item => `实际偏移:${item.text}`),
      ...reconciliation.newConstraints.map(item => `新增约束:${item.text}`),
      ...reconciliation.nextChapterImpacts.map(item => `后续影响:${item.text}`),
    ].slice(0, 6)
    if (deltas.length) lines.push(`计划-正文对账:${deltas.join('；')}`)
  }

  if (plain && !entry.chapter.summary?.trim()) {
    lines.push(`正文短摘:${excerptChapterText(entry.chapter)}`)
  }

  return `- ${lines.join('\n  ')}`
}

async function readWrittenChapterProgress(
  projectId: number,
  outlineNodeId?: number | null,
  worldGroupId?: number | null,
  scope?: WorkspaceScope,
): Promise<string> {
  if (outlineNodeId == null) return ''
  const resolved = scope ?? await resolveScope({ projectId })
  const [outlineNodes, chapters] = await Promise.all([
    readOwnedRows<OutlineNode>(resolved, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<Chapter>(resolved, 'chapters', { owner: 'work' }),
  ])
  const nodesById = new Map(outlineNodes.filter(node => node.id != null).map(node => [node.id!, node]))
  const target = nodesById.get(outlineNodeId)
  if (!target) return ''
  const targetVolume = target.type === 'volume' ? target : findVolumeAncestor(outlineNodeId, nodesById)
  if (!targetVolume?.id) return ''

  const { sequence } = resolveCanonicalChapterSequence(outlineNodes, chapters)
  const written = sequence
    .filter(entry => entry.outlineNode && findVolumeAncestor(entry.outlineNode.id!, nodesById)?.id === targetVolume.id)
    .filter(entry => worldGroupId === undefined || entry.worldGroupId === (worldGroupId ?? null))
    .filter(entry => normalizeChapterText(entry.chapter.content || '').length > 0)
    .slice(0, 40)

  if (!written.length) return ''

  const lines = await Promise.all(written.map((entry, index) => summarizeWrittenChapterForOutline({
    ordinal: sequence.findIndex(item => item.chapter === entry.chapter) + 1 || index + 1,
    chapter: entry.chapter,
    outlineNode: entry.outlineNode,
  })))

  return [
    `【本卷已写正文进度 · ${targetVolume.title}】`,
    '以下内容来自已保存章节正文/章节记忆，是补卷纲或章纲时必须尊重的事实边界；不要改写、否认、重排这些已写内容。',
    ...lines,
  ].join('\n')
}

/**
 * FB-9 修复:读取本章「场景细纲」(detailedOutlines)。
 * 细纲此前只是 DB 表(写得进、删得掉),但从未登记成上下文源 → AI 生成读不到它。
 * 这里按当前章节节点读出场景拆解(开头衔接/逐场景:标题·概要·冲突·地点/结尾悬念),
 * 供正文等下游生成时注入,实现"用细纲指导正文",小上下文也能写出贴合的文字。
 */
async function readDetailedOutline(projectId: number, outlineNodeId?: number | null, chapterId?: number | null, scope?: WorkspaceScope): Promise<string> {
  let nodeId = outlineNodeId ?? null
  if (nodeId == null && chapterId != null) {
    const chapter = await db.chapters.get(chapterId)
    if (scope && (!chapter || !await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' }))) return ''
    nodeId = chapter?.outlineNodeId ?? null
  }
  if (nodeId == null) return ''
  const resolved = scope ?? await resolveScope({ projectId })
  const rows = await readOwnedRows<any>(resolved, 'detailedOutlines', { owner: 'work' })
  const detail = rows.find(d => d.outlineNodeId === nodeId)
  if (!detail || !Array.isArray(detail.scenes) || detail.scenes.length === 0) return ''
  const parts: string[] = ['【本章细纲(场景拆解)】']
  if (detail.openingHook) parts.push(`开头衔接:${detail.openingHook}`)
  detail.scenes.forEach((s: any, i: number) => {
    const bits = [s.summary, s.conflict ? `冲突:${s.conflict}` : '', s.location ? `地点:${s.location}` : '']
      .filter(Boolean).join(' / ')
    parts.push(`场景${i + 1} ${s.title || ''}: ${bits}`)
  })
  if (detail.prohibitions?.length) {
    parts.push(`不可写清单:${detail.prohibitions.join('；')}`)
  }
  if (detail.endingCliffhanger) parts.push(`结尾悬念:${detail.endingCliffhanger}`)
  return parts.join('\n')
}

async function readItemLedger(projectId: number, characterId?: number | null, scope?: WorkspaceScope): Promise<string> {
  const resolved = scope ?? await resolveScope({ projectId })
  const rows = await readOwnedRows<any>(resolved, 'itemLedger', { owner: 'work' })
  const filtered = characterId != null
    ? rows.filter(r => (r.characterId ?? null) === (characterId ?? null))
    : rows
  if (!filtered.length) return ''
  return [
    '【物品流水证据】',
    ...filtered.slice(-120).map(row =>
      `#${row.id ?? 0} ${row.chapterTitle ?? `章节#${row.chapterId ?? '?'}`}：${row.action === 'gain' ? '获得' : '消耗'} ${row.itemName} ×${row.quantity}${row.heldByName ? `（${row.heldByName}）` : ''}${row.note ? ` ${row.note}` : ''}`),
  ].join('\n')
}

async function readHeldItems(
  projectId: number,
  chapterId?: number | null,
  worldGroupId?: number | null,
  characterId?: number | null,
  outlineNodeId?: number | null,
  scope?: WorkspaceScope,
): Promise<string> {
  if (chapterId == null && outlineNodeId == null) return ''
  return formatHeldItemsContext(await readProjectHeldItems(
    projectId,
    chapterId,
    worldGroupId,
    characterId,
    outlineNodeId,
    scope,
  ))
}

async function readStoryTimeline(projectId: number, scope?: WorkspaceScope): Promise<string> {
  const resolved = scope ?? await resolveScope({ projectId })
  const rows = (await readOwnedRows<any>(resolved, 'storyTimelineEvents', { owner: 'work' }))
    .sort((a, b) => a.order - b.order)
  if (!rows.length) return ''
  return [
    '【故事年表证据】',
    ...rows.slice(-120).map(row =>
      `#${row.id ?? 0} ${row.storyTime ? `${row.storyTime} · ` : ''}${row.title}${row.description ? `：${row.description}` : ''}（${row.chapterTitle ?? `章节#${row.chapterId ?? '?'}`}）`),
  ].join('\n')
}

async function readStoryTimelineTarget(
  projectId: number,
  eventId?: number,
  scope?: WorkspaceScope,
): Promise<string> {
  if (!Number.isInteger(eventId) || (eventId ?? 0) < 1) return ''
  const resolved = scope ?? await resolveScope({ projectId })
  const row = await db.storyTimelineEvents.get(eventId!)
  if (!row || !await assertRecordInScope(resolved, 'storyTimelineEvents', row, { owner: 'work' })) return ''
  return [
    '【目标故事年表事件】',
    `#${row.id} ${row.title}`,
    `故事时间：${row.storyTime ?? ''}`,
    `重要度：${row.importance}`,
    `描述：${row.description ?? ''}`,
    `章节：#${row.chapterId ?? '?'} ${row.chapterTitle ?? ''}`,
    `章内顺序：${row.order}`,
  ].join('\n')
}

async function readCharacterRelations(projectId: number, worldGroupId?: number | null, scope?: WorkspaceScope): Promise<string> {
  const resolved = scope ?? await resolveScope({ projectId })
  const [rows, characters] = await Promise.all([
    readOwnedRows<any>(resolved, 'characterRelations', { owner: 'world' }),
    readOwnedRows<Character>(resolved, 'characters', { owner: 'world' }),
  ])
  const visibleCharacters = worldGroupId === undefined
    ? characters
    : characters.filter(character => (
        character.isCrossWorld || (character.homeWorldGroupId ?? null) === (worldGroupId ?? null)
      ))
  const names = new Map(visibleCharacters.filter(item => item.id != null).map(item => [item.id!, item.name]))
  const visibleRows = worldGroupId === undefined
    ? rows
    : rows.filter(row => names.has(row.fromCharacterId) && names.has(row.toCharacterId))
  if (!visibleRows.length) return ''
  return [
    '【角色关系证据】',
    ...visibleRows.slice(0, 160).map(row =>
      `#${row.id ?? 0} ${names.get(row.fromCharacterId) ?? `角色#${row.fromCharacterId}`} → ${names.get(row.toCharacterId) ?? `角色#${row.toCharacterId}`}：${row.label}${row.description ? `（${row.description}）` : ''}`),
  ].join('\n')
}

/**
 * NS-4 · 当前有效事实投影（事实账本 → 生成上下文）。
 * 注入当前有效的 confirmed，以及在目标时点仍有效的 superseded 历史 Canon。
 * 按【规范章序】实时解析 validFrom/To（绝不缓存 order）判定"截止本章是否有效"，
 * 并按当前世界（∪ 默认 null 世界）过滤。这是事实账本改善长期一致性的回报通道。
 */
async function readCurrentFacts(projectId: number, chapterId?: number | null, worldGroupId?: number | null, scope?: WorkspaceScope): Promise<string> {
  if (chapterId == null) return ''
  const resolved = scope ?? await resolveScope({ projectId })
  const [facts, outlineNodes, chapters] = await Promise.all([
    readOwnedRows<any>(resolved, 'temporalFacts', { owner: 'work' }).then(rows => rows.filter(f => f.status === 'confirmed' || f.status === 'superseded')),
    readOwnedRows<OutlineNode>(resolved, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<Chapter>(resolved, 'chapters', { owner: 'work' }),
  ])
  if (!facts.length) return ''
  const { sequence } = resolveCanonicalChapterSequence(outlineNodes, chapters)
  const orderOf = new Map<number, number>()
  sequence.forEach((entry, i) => { if (entry.chapter.id != null) orderOf.set(entry.chapter.id, i) })
  const currentOrder = orderOf.get(chapterId)
  if (currentOrder == null) return ''

  const validNow = facts.filter(fact => {
    if (fact.worldGroupId != null && fact.worldGroupId !== (worldGroupId ?? null)) return false // 世界隔离
    const from = fact.validFromChapterId != null ? orderOf.get(fact.validFromChapterId) : -1
    if (from == null || from > currentOrder) return false   // 引用不存在的章 / 尚未生效
    if (fact.validToChapterId != null) {
      const to = orderOf.get(fact.validToChapterId)
      if (to != null && to <= currentOrder) return false     // 已失效
    }
    return true
  })
  if (!validNow.length) return ''
  const lines = validNow.slice(0, 80).map(fact => {
    const spec = getFactPredicate(fact.predicate)
    return `- ${fact.subjectName}｜${spec?.label ?? fact.predicate}：${fact.value}`
  })
  return ['【当前有效事实（截止本章·已确认，请勿与之矛盾）】', ...lines].join('\n')
}

/**
 * NS-5 · 相关前文召回（叙事感知混合检索的回报通道）。
 * 按本章涉及的实体召回历史块（关键词通道，未来章硬过滤、世界隔离、按时间重组），
 * 解决"几百章前的远距离细节/伏笔"被遗忘导致的矛盾。
 */
async function readRetrievedPassages(projectId: number, chapterId?: number | null, outlineNodeId?: number | null, worldGroupId?: number | null, scope?: WorkspaceScope): Promise<string> {
  if (chapterId == null) return ''
  const resolved = scope ?? await resolveScope({ projectId })
  const [characters, node] = await Promise.all([
    readOwnedRows<Character>(resolved, 'characters', { owner: 'world' }),
    outlineNodeId != null ? db.outlineNodes.get(outlineNodeId) : Promise.resolve(undefined),
  ])
  const charNames = characters.map(c => c.name).filter(n => n && n.length >= 2)
  const summary = node?.summary || ''
  const mentioned = charNames.filter(n => summary.includes(n))
  const queryTerms = mentioned.length ? mentioned : charNames // 摘要没提具体角色 → 用全部角色作宽召回
  if (!queryTerms.length) {
    return await readNarrativeSummaryContext({ projectId, currentChapterId: chapterId, worldGroupId, scope: resolved })
  }

  // NS-5：若启用 embedding，按"章纲摘要 + 涉及角色"嵌一次查询向量 → 混合检索（失败自动退回关键词）
  const embCfg = useAIConfigStore.getState().embedding
  const queryEmbedding = isEmbeddingReady(embCfg)
    ? await embedQuery([summary, ...queryTerms].filter(Boolean).join(' ').slice(0, 1000), embCfg, projectId)
    : null

  const got = await retrieveChunks({
    projectId, currentChapterId: chapterId, worldGroupId, queryTerms, queryEmbedding,
    queryEmbeddingModel: queryEmbedding ? embeddingModelTag(embCfg) : null, topK: 6, scope: resolved,
  })
  const hierarchy = await readNarrativeSummaryContext({ projectId, currentChapterId: chapterId, worldGroupId, scope: resolved })
  if (!got.length) return hierarchy
  const chapters = await readOwnedRows<Chapter>(resolved, 'chapters', { owner: 'work' })
  const titleOf = new Map(chapters.filter(c => c.id != null).map(c => [c.id!, c.title]))
  const lines = got.map(r => `〖${titleOf.get(r.chunk.sourceChapterId) ?? '前文'}〗${r.chunk.text}`)
  return [hierarchy, '【相关前文召回（防止远距离细节/伏笔矛盾，仅供参考）】', ...lines].filter(Boolean).join('\n\n')
}

/**
 * C2 反向哺喂 · 某角色的「已确认事实」证据。
 * 取事实账本里 subjectName == 该角色名 的 confirmed 事实（按当前世界 ∪ null 过滤），
 * 不依赖章节——补全角色设定时要的是 TA 在全书已被确认的客观事实。
 */
async function readCharacterFacts(projectId: number, name?: string, worldGroupId?: number | null, scope?: WorkspaceScope): Promise<string> {
  const subject = name?.trim()
  if (!subject) return ''
  const resolved = scope ?? await resolveScope({ projectId })
  const facts = (await readOwnedRows<any>(resolved, 'temporalFacts', { owner: 'work' }))
    .filter(f => f.status === 'confirmed' && f.subjectName === subject)
  const scoped = facts.filter(f => f.worldGroupId == null || f.worldGroupId === (worldGroupId ?? null))
  if (!scoped.length) return ''
  const lines = scoped.slice(0, 60).map(fact => {
    const spec = getFactPredicate(fact.predicate)
    return `- ${spec?.label ?? fact.predicate}：${fact.value}`
  })
  return [`【「${subject}」在剧情中已确认的事实（补全须与之一致，勿矛盾）】`, ...lines].join('\n')
}

/**
 * C2 反向哺喂 · 某角色的「正文表现」证据。
 * 关键词扫描全书 retrievalChunks（提到该角色名的块，当前世界 ∪ null），按章序取靠后的若干段，
 * 让补全贴合 TA 真正写出来的样子。不依赖 currentChapterId（要全书证据，不做未来章过滤）。
 */
async function readCharacterPassages(projectId: number, name?: string, worldGroupId?: number | null, scope?: WorkspaceScope): Promise<string> {
  const subject = name?.trim()
  if (!subject || subject.length < 2) return ''
  const resolved = scope ?? await resolveScope({ projectId })
  const [chunks, chapters] = await Promise.all([
    readOwnedRows<any>(resolved, 'retrievalChunks', { owner: 'work' }),
    readOwnedRows<Chapter>(resolved, 'chapters', { owner: 'work' }),
  ])
  const hits = chunks
    .filter(c => (c.worldGroupId == null || c.worldGroupId === (worldGroupId ?? null)) && c.text.includes(subject))
    .sort((a, b) => (b.sourceChapterId ?? 0) - (a.sourceChapterId ?? 0))
    .slice(0, 6)
  if (!hits.length) return ''
  const titleOf = new Map(chapters.filter(c => c.id != null).map(c => [c.id!, c.title]))
  const lines = hits.map(c => `〖${titleOf.get(c.sourceChapterId) ?? '正文'}〗${c.text}`)
  return [`【「${subject}」在正文中的真实表现（补全须符合，勿编造与正文矛盾的设定）】`, ...lines].join('\n\n')
}

export const CONTEXT_SOURCES: ContextSource[] = [
  {
    // ARCH-05: immutable WorldReference resource provider. Ordinary
    // assembleContext readers never activate it implicitly; upper-product
    // adapters open a frozen Context Gateway session with release id + hash.
    key: 'worldRelease',
    label: '冻结世界版本资源',
    scope: 'manual',
    layer: 'L0',
    ownerFrom: 'world',
    budgetTokens: 100_000,
    protectedFromTrim: true,
    enabled: () => false,
    resources: WORLD_RELEASE_RESOURCE_PROVIDER_PROXY_V1,
    read: async () => '',
  },
  {
    key: 'ttrpgRuntime',
    label: '正式 TTRPG 主持人运行视角',
    scope: 'runtime',
    layer: 'L0',
    ownerFrom: 'work',
    budgetTokens: 10_000,
    protectedFromTrim: true,
    requiresSimulationSessionId: true,
    read: readTtrpgGmRuntimeContextV1,
  },
  {
    key: 'ttrpgPlayerRuntime',
    label: '正式 TTRPG 单角色玩家运行视角',
    scope: 'runtime',
    layer: 'L0',
    ownerFrom: 'work',
    budgetTokens: 10_000,
    protectedFromTrim: true,
    requiresSimulationSessionId: true,
    enabled: input => !!input.ttrpgPlayerActorKey?.trim(),
    read: readTtrpgPlayerRuntimeContextV1,
  },
  {
    key: 'game-production.consultation-source',
    label: '游戏生产会谈来源',
    scope: 'project',
    layer: 'L0',
    ownerFrom: 'world',
    budgetTokens: 6000,
    protectedFromTrim: true,
    enabled: input => Number.isInteger(input.gameWorldReleaseId),
    read: readGameProductionConsultationSource,
  },
  {
    key: 'game-production.brief',
    label: '已授权游戏生产 Brief',
    scope: 'project',
    layer: 'L0',
    ownerFrom: 'work',
    budgetTokens: 8000,
    protectedFromTrim: true,
    enabled: input => Number.isInteger(input.gameProductionId),
    read: readGameProductionBriefContext,
  },
  {
    key: 'game-production.artifact-inputs',
    label: '游戏生产任务依赖',
    scope: 'project',
    layer: 'L1',
    ownerFrom: 'work',
    budgetTokens: 10_000,
    enabled: input => Number.isInteger(input.gameBuildId) && !!input.gameArtifactKeys?.length,
    read: readGameProductionArtifactInputs,
  },
  {
    key: 'game-production.quality-feedback',
    label: '游戏生产质量反馈',
    scope: 'project',
    layer: 'L1',
    ownerFrom: 'work',
    budgetTokens: 6000,
    enabled: input => Number.isInteger(input.gameBuildId),
    read: readGameProductionQualityFeedback,
  },
  {
    key: 'game-production.evolution-base',
    label: '游戏持续演化基线',
    scope: 'project',
    layer: 'L0',
    ownerFrom: 'work',
    budgetTokens: 12_000,
    protectedFromTrim: true,
    enabled: input => Number.isInteger(input.gameBuildId),
    read: readGameProductionEvolutionBase,
  },
  {
    key: 'adaptation.sourceManifest',
    label: '改编来源清单',
    scope: 'project',
    layer: 'L0',
    ownerFrom: 'work',
    budgetTokens: 6000,
    protectedFromTrim: true,
    requiresAdaptationProjectId: true,
    read: readAdaptationSourceManifestContext,
  },
  {
    key: 'adaptation.sourceContent',
    label: '改编来源正文',
    scope: 'project',
    layer: 'L0',
    ownerFrom: 'work',
    budgetTokens: 24_000,
    protectedFromTrim: true,
    requiresAdaptationProjectId: true,
    requiresAdaptationSourceUnits: true,
    read: readAdaptationSourceContentContext,
  },
  {
    key: 'adaptation.currentBrief',
    label: '已确认改编 Brief',
    scope: 'project',
    layer: 'L0',
    ownerFrom: 'work',
    budgetTokens: 4000,
    protectedFromTrim: true,
    requiresAdaptationProjectId: true,
    read: readAdaptationBriefContext,
  },
  {
    key: 'adaptation.currentPlan',
    label: '已确认改编计划',
    scope: 'project',
    layer: 'L0',
    ownerFrom: 'work',
    budgetTokens: 6000,
    protectedFromTrim: true,
    requiresAdaptationProjectId: true,
    read: readAdaptationPlanContext,
  },
  {
    key: 'screenplay.currentScenes',
    label: '当前剧本场景',
    scope: 'project',
    layer: 'L0',
    ownerFrom: 'work',
    budgetTokens: 16_000,
    protectedFromTrim: true,
    requiresAdaptationProjectId: true,
    requiresScreenplayScenes: true,
    read: readScreenplayCurrentScenesContext,
  },
  {
    key: 'comic.visualBible',
    label: '漫画视觉圣经与视觉条目',
    scope: 'project',
    layer: 'L0',
    ownerFrom: 'work',
    budgetTokens: 12_000,
    protectedFromTrim: true,
    requiresAdaptationProjectId: true,
    read: readComicVisualBibleContext,
  },
  {
    key: 'comic.currentPages',
    label: '当前漫画页格',
    scope: 'project',
    layer: 'L0',
    ownerFrom: 'work',
    budgetTokens: 20_000,
    protectedFromTrim: true,
    requiresAdaptationProjectId: true,
    requiresComicPages: true,
    read: readComicCurrentPagesContext,
  },
  {
    key: 'adventureRuntime',
    label: '文字冒险玩家视角',
    scope: 'runtime',
    layer: 'L0',
    budgetTokens: 8000,
    protectedFromTrim: true,
    requiresSimulationSessionId: true,
    read: readAdventureRuntimeContext,
  },
  {
    key: 'narrativeSimulationRuntime',
    label: '叙事模拟玩家视角',
    scope: 'runtime',
    layer: 'L0',
    budgetTokens: 8000,
    protectedFromTrim: true,
    requiresSimulationSessionId: true,
    read: readNarrativeSimulationRuntimeContext,
  },
  {
    key: 'openWorldRuntime',
    label: '文字开放世界玩家视角',
    scope: 'runtime',
    layer: 'L0',
    budgetTokens: 8000,
    protectedFromTrim: true,
    requiresSimulationSessionId: true,
    read: readOpenWorldRuntimeContext,
  },
  {
    key: 'interactionRuntime',
    label: '角色互动单一视角',
    scope: 'runtime',
    layer: 'L0',
    budgetTokens: 8000,
    protectedFromTrim: true,
    requiresSimulationSessionId: true,
    enabled: input => !!input.interactionParticipantKey?.trim(),
    read: readInteractionRuntimeContext,
  },
  {
    // SIM-1C: NPC 演进只读冻结快照与事件回放，不读取可变 Canon 表。
    key: 'simulationRuntime',
    label: '冻结运行时状态',
    scope: 'runtime',
    layer: 'L0',
    budgetTokens: 8000,
    protectedFromTrim: true,
    requiresSimulationSessionId: true,
    read: readSimulationRuntimeContext,
  },
  {
    // AGENT-1: 对话副驾只读工具使用的紧凑项目摘要，不返回整表原始数据。
    key: 'projectStatus',
    label: '项目概况',
    scope: 'project',
    layer: 'L2',
    budgetTokens: 1200,
    read: readAgentProjectStatus,
  },
  {
    // AGENT-1: 世界组与连接关系的有界目录。
    key: 'worldGroups',
    label: '世界组目录',
    scope: 'project',
    layer: 'L2',
    budgetTokens: 1500,
    read: readAgentWorldGroups,
  },
  {
    // AGENT-1: 按当前执行世界过滤的有界大纲树。
    key: 'outlineTree',
    label: '大纲树',
    scope: 'world',
    layer: 'L2',
    budgetTokens: 6000,
    requiresWorldGroupId: true,
    read: readAgentOutlineTree,
  },
  {
    // AGENT-1: 零网络、零 embedding 的本地包含匹配，仅返回短摘。
    key: 'searchResults',
    label: '项目内搜索结果',
    scope: 'world',
    layer: 'L2',
    budgetTokens: 2200,
    requiresWorldGroupId: true,
    enabled: input => !!input.searchQuery?.trim(),
    read: readAgentSearchResults,
  },
  {
    // RAG-1: 作者在可见资料库/节点中精确选择的记录字段。正文仍实时读取 Canon，
    // 稳定选择键和实际纳入证据分别由源记录元数据与节点运行快照保存。
    key: 'ragSelection',
    label: '作者选择的资料字段',
    scope: 'manual',
    layer: 'L0',
    budgetTokens: 100_000,
    enabled: input => !!input.ragEntryKeys?.length,
    resources: CANON_RESOURCE_PROVIDER_V1,
    read: input => readRagSelectionContext({
      projectId: input.projectId,
      scope: input.scope,
      worldGroupId: input.worldGroupId,
      entryKeys: input.ragEntryKeys,
      inputBudgetTokens: input.inputBudgetTokens,
      trace: input.ragSelectionTrace,
    }),
  },
  {
    key: 'manualText',
    label: '用户指定内容',
    scope: 'manual',
    layer: 'L0',
    budgetTokens: 100_000,
    read: async input => input.manualSourceText || '',
  },
  {
    key: 'codexExtractionBaseline',
    label: 'Codex 目标分类与既有词条闭集',
    scope: 'world',
    layer: 'L0',
    budgetTokens: 8_000,
    protectedFromTrim: true,
    ownerFrom: 'world',
    requiresWorldGroupId: true,
    enabled: input => Number.isInteger(input.codexCategoryId),
    read: input => readCodexExtractionBaselineContextV1({
      scope: input.scope!,
      categoryId: input.codexCategoryId!,
      worldGroupId: input.worldGroupId ?? null,
    }),
  },
  {
    key: 'historyAgentBaseline',
    label: '历史 Agent 正式输入基线',
    scope: 'world',
    layer: 'L0',
    budgetTokens: 12_000,
    protectedFromTrim: true,
    ownerFrom: 'world',
    requiresWorldGroupId: true,
    enabled: input => (
      (input.historyAgentMode === 'consult' || input.historyAgentMode === 'storm')
      && (input.historyAgentTargetKind === 'event' || input.historyAgentTargetKind === 'keyword')
      && Number.isInteger(input.historyAgentTargetId)
    ),
    read: input => readHistoryAgentBaselineContextV1({
      scope: input.scope!,
      worldGroupId: input.worldGroupId ?? null,
      mode: input.historyAgentMode!,
      targetKind: input.historyAgentTargetKind!,
      targetId: input.historyAgentTargetId!,
    }),
  },
  {
    key: 'referenceDerivedBaseline',
    label: '参考分析派生 Agent 正式输入基线',
    scope: 'project',
    layer: 'L0',
    budgetTokens: 36_000,
    protectedFromTrim: true,
    ownerFrom: 'work',
    enabled: input => (
      (input.referenceDerivedMode === 'summary' || input.referenceDerivedMode === 'characters')
      && Number.isInteger(input.referenceAnalysisRunId)
    ),
    read: input => readReferenceDerivedBaselineContextV1({
      scope: input.scope!,
      mode: input.referenceDerivedMode!,
      runId: input.referenceAnalysisRunId!,
    }),
  },
  {
    key: 'styleLearningBaseline',
    label: '文风学习正式输入基线',
    scope: 'project',
    layer: 'L0',
    budgetTokens: 28_000,
    protectedFromTrim: true,
    ownerFrom: 'work',
    enabled: input => Array.isArray(input.styleLearningChapterIds),
    read: input => readStyleLearningBaselineContextV1({
      scope: input.scope!,
      chapterIds: input.styleLearningChapterIds!,
    }),
  },
  {
    key: 'priorOutlineCandidate',
    label: '同批次上一卷章纲候选',
    scope: 'runtime',
    layer: 'L1',
    budgetTokens: 2400,
    protectedFromTrim: true,
    enabled: input => !!input.priorOutlineCandidateText?.trim(),
    read: async input => input.priorOutlineCandidateText || '',
  },
  {
    key: 'chapterContent',
    label: '章节正文',
    scope: 'chapter',
    layer: 'L0',
    budgetTokens: 100_000,
    requiresChapterId: true,
    read: async input => {
      const chapter = await db.chapters.get(input.chapterId!)
      if (!chapter || !input.scope || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) return ''
      return htmlToPlainText(chapter.content || '')
    },
  },
  {
    key: 'cultivationProgressExtractionBaseline',
    label: '修炼进度角色、体系 DAG 与既有事件闭集',
    scope: 'chapter',
    layer: 'L0',
    budgetTokens: 30_000,
    protectedFromTrim: true,
    ownerFrom: 'work',
    requiresChapterId: true,
    requiresWorldGroupId: true,
    read: input => readCultivationProgressExtractionBaselineContextV1({
      scope: input.scope!,
      chapterId: input.chapterId!,
      worldGroupId: input.worldGroupId ?? null,
    }),
  },
  {
    key: 'contextMemo',
    label: '上下文快照',
    scope: 'project',
    layer: 'L3',
    budgetTokens: 1500,
    read: async input => getContextMemo(input.projectId),
  },
  {
    key: 'chapterOutline',
    label: '当前章节大纲',
    scope: 'node',
    layer: 'L1',
    budgetTokens: 800,
    protectedFromTrim: true,
    requiresOutlineNodeId: true,
    read: input => readChapterOutline(input.projectId, input.outlineNodeId, input.chapterId, input.scope),
  },
  {
    key: 'adjacentChapterOutlines',
    label: '相邻章纲',
    scope: 'node',
    layer: 'L1',
    budgetTokens: 1000,
    protectedFromTrim: true,
    requiresOutlineNodeId: true,
    read: input => readAdjacentChapterOutlines(input.projectId, input.outlineNodeId, input.scope),
  },
  {
    key: 'existingVolumeOutlines',
    label: '已有卷大纲',
    scope: 'project',
    layer: 'L1',
    budgetTokens: 2400,
    read: input => readExistingVolumeOutlines(input.projectId, input.scope),
  },
  {
    key: 'outlineSummaries',
    label: '大纲标题与摘要（分析）',
    scope: 'project',
    layer: 'L2',
    budgetTokens: 6_000,
    requiresWorldGroupId: true,
    read: input => readOutlineSummariesForAnalysis(input.projectId, input.worldGroupId ?? null, input.scope),
  },
  {
    key: 'writtenChapters',
    label: '已写章节正文（分析摘录）',
    scope: 'project',
    layer: 'L2',
    budgetTokens: 8_000,
    requiresWorldGroupId: true,
    read: input => readWrittenChaptersForAnalysis(input.projectId, input.worldGroupId ?? null, input.scope),
  },
  {
    key: 'writtenChapterProgress',
    label: '本卷已写正文进度',
    scope: 'node',
    layer: 'L1',
    budgetTokens: 3000,
    protectedFromTrim: true,
    requiresOutlineNodeId: true,
    read: input => readWrittenChapterProgress(input.projectId, input.outlineNodeId, input.worldGroupId, input.scope),
  },
  {
    key: 'currentFacts',
    label: '当前有效事实(事实账本投影)',
    scope: 'chapter',
    layer: 'L1',
    budgetTokens: 2000,
    requiresChapterId: true,
    read: input => readCurrentFacts(input.projectId, input.chapterId, input.worldGroupId, input.scope),
  },
  {
    key: 'canonAssertions',
    label: '世界宪法(已确认设定断言)',
    scope: 'world',
    layer: 'L1',
    budgetTokens: 1800,
    protectedFromTrim: true,
    requiresWorldGroupId: true,
    read: async input => formatCanonAssertionsContext(
      await readCanonAssertions(input.projectId, input.worldGroupId),
    ),
  },
  {
    key: 'constitutionScanSources',
    label: '世界宪法扫描来源闭集',
    scope: 'project',
    layer: 'L0',
    budgetTokens: 30_000,
    protectedFromTrim: true,
    ownerFrom: 'work',
    read: input => readSettingAssertionScanContext(input.scope!),
  },
  {
    key: 'characterKnowledge',
    label: '角色认知边界(认知账本投影)',
    scope: 'chapter',
    layer: 'L1',
    budgetTokens: 1600,
    protectedFromTrim: true,
    requiresChapterId: true,
    acceptsOutlineNodeAsChapterBoundary: true,
    read: async input => formatCharacterKnowledgeContext(await readProjectCharacterKnowledge(
      input.projectId,
      input.chapterId,
      input.worldGroupId,
      input.characterId,
      input.outlineNodeId,
      input.scope,
    )),
  },
  {
    key: 'retrievedPassages',
    label: '相关前文召回(NS-5 混合检索)',
    scope: 'chapter',
    layer: 'L2',
    budgetTokens: 2500,
    requiresChapterId: true,
    read: input => readRetrievedPassages(input.projectId, input.chapterId, input.outlineNodeId, input.worldGroupId, input.scope),
  },
  {
    key: 'consistencyReport',
    label: '一致性报告',
    scope: 'chapter',
    layer: 'L1',
    budgetTokens: 1800,
    protectedFromTrim: true,
    requiresChapterId: true,
    acceptsOutlineNodeAsChapterBoundary: true,
    read: input => readConsistencyReport(input.projectId, input.chapterId, input.scope),
  },
  {
    // MEMORY-9: authoritative rows are read exactly; local keyword evidence is
    // supplementary. Embeddings are deliberately disabled in this product.
    key: 'consistencyDossier',
    label: '长期一致性档案',
    scope: 'chapter',
    layer: 'L1',
    budgetTokens: 6_000,
    protectedFromTrim: true,
    ownerFrom: 'work',
    requiresChapterId: true,
    read: async input => formatLongTermConsistencyDossierV1(
      await buildLongTermConsistencyDossierV1({
        scope: input.scope!,
        boundaryChapterId: input.chapterId!,
        query: input.stateReferenceText,
        maxTokens: 5_500,
      }),
    ),
  },
  {
    key: 'detailedOutline',
    label: '本章细纲(场景拆解)',
    scope: 'node',
    layer: 'L1',
    budgetTokens: 1500,
    requiresOutlineNodeId: true,
    read: input => readDetailedOutline(input.projectId, input.outlineNodeId, input.chapterId, input.scope),
  },
  {
    key: 'previousChapterEnding',
    label: '全局直接前驱原文尾部',
    scope: 'manual',
    layer: 'L1',
    budgetTokens: 1800,
    protectedFromTrim: true,
    acceptsDetachedContinuitySnapshot: true,
    enabled: input => !!(input.continuitySnapshot?.previousTailText || input.previousChapterEnding),
    read: async input => input.continuitySnapshot?.previousTailText
      || (input.previousChapterEnding ? `【上一章结尾】\n${input.previousChapterEnding}` : ''),
  },
  {
    key: 'chapterContinuityHandoff',
    label: '全局直接前驱连续性交接',
    scope: 'chapter',
    layer: 'L1',
    budgetTokens: 1600,
    protectedFromTrim: true,
    requiresChapterId: true,
    acceptsDetachedContinuitySnapshot: true,
    read: async input => input.continuitySnapshot?.handoffText || '',
  },
  {
    key: 'previousPlanReconciliation',
    label: '前章计划正文对账',
    scope: 'chapter',
    layer: 'L1',
    budgetTokens: 1400,
    protectedFromTrim: true,
    requiresChapterId: true,
    acceptsDetachedContinuitySnapshot: true,
    read: async input => input.continuitySnapshot?.planReconciliationText || '',
  },
  {
    key: 'recentChapterSummaries',
    label: '当前世界最近已验证摘要',
    scope: 'chapter',
    layer: 'L1',
    budgetTokens: 2200,
    requiresChapterId: true,
    acceptsDetachedContinuitySnapshot: true,
    read: async input => input.continuitySnapshot?.recentSummariesText || '',
  },
  {
    key: 'worldview',
    label: '世界观',
    scope: 'world',
    layer: 'L2',
    budgetTokens: 8000, // 放宽:容下完整世界观设定,超大才软截断(并配合总窗口软裁)
    requiresWorldGroupId: true,
    ownerFrom: 'world',
    read: async input => formatWorldviewBlock(await readWorldview(input.projectId, input.worldGroupId, input.scope)),
  },
  {
    key: 'geography',
    label: '地理环境',
    scope: 'world',
    layer: 'L2',
    budgetTokens: 3_000,
    requiresWorldGroupId: true,
    ownerFrom: 'world',
    read: input => readGeographyContext(input.projectId, input.worldGroupId, input.scope),
  },
  {
    key: 'storyCore',
    label: '故事核心',
    scope: 'project',
    layer: 'L1',
    budgetTokens: 4000, // 放宽:容下完整故事核心(主线/复线)
    ownerFrom: 'work',
    read: async input => formatStoryCoreBlock((await readOwnedRows<any>(input.scope!, 'storyCores', { owner: 'work' }))[0] ?? null),
  },
  {
    key: 'activeNarrativeBlueprint',
    label: '当前选定叙事蓝图',
    scope: 'project',
    layer: 'L1',
    budgetTokens: 5000,
    protectedFromTrim: true,
    ownerFrom: 'work',
    read: readActiveNarrativeBlueprint,
  },
  {
    key: 'characterDrivenPlan',
    label: '角色驱动方案',
    scope: 'project',
    layer: 'L1',
    budgetTokens: 5000,
    protectedFromTrim: true,
    ownerFrom: 'work',
    read: input => readActiveCharacterDrivenPlanContext(
      input.projectId,
      input.scope,
      input.characterDrivenPlanId,
    ),
  },
  {
    key: 'powerSystem',
    label: '力量体系',
    scope: 'world',
    layer: 'L2',
    budgetTokens: 4000, // 放宽:容下完整力量体系(描述/等级/规则)
    requiresWorldGroupId: true,
    read: async input => {
      const [foundation, cultivation] = await Promise.all([
        readPowerSystem(input.projectId, input.worldGroupId, input.scope)
          .then(formatPowerSystemBlock),
        buildCultivationContext(input.projectId, input.worldGroupId, input.scope),
      ])
      return [foundation, cultivation].filter(Boolean).join('\n')
    },
  },
  {
    key: 'codex',
    label: '设定词条',
    scope: 'world',
    layer: 'L2',
    budgetTokens: 6000, // 放宽:容下更多设定词条
    requiresWorldGroupId: true,
    read: input => buildCodexContext(input.projectId, input.worldGroupId, {}, input.scope),
  },
  {
    key: 'characters',
    label: '角色档案',
    scope: 'world',
    layer: 'L2',
    budgetTokens: 8000, // 放宽:容下完整角色档案(核心角色不再被砍残)
    requiresWorldGroupId: true,
    ownerFrom: 'world',
    read: async input => buildCharacterContext(await readCharacters(input.projectId, input.worldGroupId, input.scope)),
  },
  {
    key: 'targetCharacter',
    label: '本次目标角色完整设定',
    scope: 'world',
    layer: 'L0',
    budgetTokens: 8_000,
    protectedFromTrim: true,
    requiresWorldGroupId: true,
    ownerFrom: 'world',
    enabled: input => input.characterId != null,
    read: readTargetCharacter,
  },
  {
    key: 'creativeRules',
    label: '创作规则',
    scope: 'project',
    layer: 'L1',
    budgetTokens: 1000,
    ownerFrom: 'work',
    read: async input => buildCreativeRulesContext((await readOwnedRows<any>(input.scope!, 'creativeRules', { owner: 'work' }))[0] ?? null),
  },
  {
    key: 'worldRules',
    label: '真实与幻想规则',
    scope: 'world',
    layer: 'L1',
    budgetTokens: 1200,
    requiresWorldGroupId: true,
    read: input => buildWorldRulesContext(input.projectId, input.worldGroupId, input.scope),
  },
  {
    key: 'historical',
    label: '历史时间线',
    scope: 'world',
    layer: 'L2',
    budgetTokens: 1800,
    requiresWorldGroupId: true,
    read: input => buildHistoricalContext(input.projectId, input.worldGroupId, input.scope),
  },
  {
    key: 'locations',
    label: '重要地点',
    scope: 'project',
    layer: 'L2',
    budgetTokens: 1200,
    read: input => buildLocationContext(input.projectId, input.scope),
  },
  {
    key: 'foreshadows',
    label: '伏笔状态',
    scope: 'chapter',
    layer: 'L2',
    budgetTokens: 1200,
    read: input => readForeshadows(input.projectId, input.chapterId, input.scope),
  },
  {
    key: 'foreshadowSuggestionBaseline',
    label: '伏笔建议正式基线',
    scope: 'project',
    layer: 'L0',
    budgetTokens: 8_000,
    protectedFromTrim: true,
    ownerFrom: 'work',
    read: input => readForeshadowSuggestionBaselineContextV1({
      scope: input.scope!,
      worldGroupId: input.worldGroupId,
    }),
  },
  {
    key: 'storyArcs',
    label: '故事线',
    scope: 'project',
    layer: 'L2',
    budgetTokens: 1500,
    ownerFrom: 'work',
    read: input => readStoryArcs(input.projectId, input.scope),
  },
  {
    key: 'storylineProgress',
    label: '作者确认的故事线进度与交汇',
    scope: 'project',
    layer: 'L1',
    budgetTokens: 1400,
    protectedFromTrim: true,
    read: input => readStorylineProgressContext(input.projectId, input.chapterId, input.scope),
  },
  {
    key: 'cultivationProgress',
    label: '作者确认的正文修炼进度',
    scope: 'world',
    layer: 'L1',
    budgetTokens: 1000,
    protectedFromTrim: true,
    ownerFrom: 'work',
    requiresWorldGroupId: true,
    read: input => readCultivationProgressContext(
      input.projectId,
      input.worldGroupId,
      input.chapterId,
      input.outlineNodeId,
      input.scope,
    ),
  },
  {
    key: 'emotionBeats',
    label: '情感节拍',
    scope: 'chapter',
    layer: 'L1',
    budgetTokens: 1000,
    requiresChapterId: true,
    read: input => readEmotionBeats(input.projectId, input.chapterId, input.scope),
  },
  {
    key: 'stateCards',
    label: '状态卡',
    scope: 'project',
    layer: 'L2',
    budgetTokens: 1800,
    ownerFrom: 'work',
    read: input => readStateCards(input.projectId, input.stateReferenceText, input.extraStateIds, input.scope),
  },
  {
    key: 'itemLedger',
    label: '物品流水',
    scope: 'project',
    layer: 'L2',
    budgetTokens: 2400,
    read: input => readItemLedger(input.projectId, input.characterId, input.scope),
  },
  {
    key: 'heldItems',
    label: '当前已持有物品',
    scope: 'chapter',
    layer: 'L1',
    budgetTokens: 1000,
    protectedFromTrim: true,
    requiresChapterId: true,
    acceptsOutlineNodeAsChapterBoundary: true,
    read: input => readHeldItems(
      input.projectId,
      input.chapterId,
      input.worldGroupId,
      input.characterId,
      input.outlineNodeId,
      input.scope,
    ),
  },
  {
    key: 'storyTimeline',
    label: '故事年表',
    scope: 'project',
    layer: 'L2',
    budgetTokens: 2600,
    read: input => readStoryTimeline(input.projectId, input.scope),
  },
  {
    key: 'storyTimelineTarget',
    label: '目标故事年表事件',
    scope: 'project',
    layer: 'L1',
    budgetTokens: 600,
    protectedFromTrim: true,
    ownerFrom: 'work',
    enabled: input => Number.isInteger(input.storyTimelineEventId) && (input.storyTimelineEventId ?? 0) > 0,
    read: input => readStoryTimelineTarget(input.projectId, input.storyTimelineEventId, input.scope),
  },
  {
    key: 'characterRelations',
    label: '角色关系',
    scope: 'project',
    layer: 'L2',
    budgetTokens: 2200,
    read: input => readCharacterRelations(input.projectId, input.worldGroupId, input.scope),
  },
  {
    key: 'references',
    label: '引用手法',
    scope: 'project',
    layer: 'L3',
    budgetTokens: 2000,
    enabled: input => !!input.citedReferenceIds?.length,
    read: input => buildRefAnalysisContext(input.citedReferenceIds ?? []),
  },
  {
    // FB-5 自适应文风学习:作者文风画像(enabled=true 才注入)。
    key: 'userStyleProfile',
    label: '我的文风',
    scope: 'project',
    layer: 'L2',
    budgetTokens: 1800,
    read: input => readUserStyleProfile(input.projectId, input.scope),
  },
  {
    // CM-1:只读取作者本次明确勾选的短灵感和同模式最近确认版本。
    key: 'inspirationWorkspace',
    label: '增量灵感工作区',
    scope: 'project',
    layer: 'L0',
    budgetTokens: 11_000,
    enabled: input => !!input.inspirationFragmentIds?.length,
    read: input => readInspirationWorkspaceContext(
      input.projectId,
      input.inspirationFragmentIds,
      input.inspirationMode,
      input.scope,
    ),
  },
  {
    // C2 反向哺喂：某角色在剧情里已确认的事实（需 subjectCharacterName）。
    key: 'characterFacts',
    label: '该角色的剧情事实',
    scope: 'project',
    layer: 'L1',
    budgetTokens: 1500,
    enabled: input => !!input.subjectCharacterName?.trim(),
    read: input => readCharacterFacts(input.projectId, input.subjectCharacterName, input.worldGroupId, input.scope),
  },
  {
    // C2 反向哺喂：某角色在正文里的真实表现（需 subjectCharacterName）。
    key: 'characterPassages',
    label: '该角色的正文表现',
    scope: 'project',
    layer: 'L1',
    budgetTokens: 2500,
    enabled: input => !!input.subjectCharacterName?.trim(),
    read: input => readCharacterPassages(input.projectId, input.subjectCharacterName, input.worldGroupId, input.scope),
  },
]

// Transitional C3 defaulting keeps legacy source declarations readable while making
// the logical owner explicit at runtime. New sources should set ownerFrom directly.
for (const source of CONTEXT_SOURCES) {
  if (source.ownerFrom) continue
  if (source.scope === 'world') source.ownerFrom = 'world'
  else if (source.scope === 'node' || source.scope === 'chapter' || source.scope === 'project') source.ownerFrom = 'work'
  else if (source.scope === 'runtime') source.ownerFrom = 'instance'
}

export const CONTEXT_SOURCE_BY_KEY: ReadonlyMap<string, ContextSource> = new Map(
  CONTEXT_SOURCES.map(source => [source.key, source] as const),
)
