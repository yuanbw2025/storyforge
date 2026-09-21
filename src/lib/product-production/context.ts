import { db } from '../db/schema'
import type { TtrpgProductionBriefV2, WorkspaceScope } from '../types'
import type { AssembleContextInput, ContextSourceTransformer } from '../registry/types'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { assertRecordInScope } from '../workspace/scope'
import { readAgentRunV1 } from '../agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { estimateTokens } from '../ai/context-budget'
import {
  findTextAdventurePlayerVisibleLanguageIssuesV1,
  groupTextAdventurePlayerVisibleLanguageIssuesV1,
} from '../adventure/language-quality'
import { TEXT_ADVENTURE_QUALITY_REVIEW_SCORE_KEYS_BY_SCOPE_V1 } from '../adventure/production-artifacts'
import { textAdventureDecisionEchoPresentationV1 } from '../adventure/production-compiler'
import { isSha256Hash } from './hash'
import { textAdventureQualityReviewScopeFromTaskKeyV1 } from './plan'
import {
  textAdventureQualityArcRepairTaskKeysV1,
  textAdventureQualityChoiceCopyOnlyRepairV1,
  textAdventureQualityExecutableRecommendationV1,
  textAdventureQualityIssueOwnerArtifactKeyV1,
  textAdventureQualityIssueSupersededByCompiledEchoV1,
  textAdventureQualityIssueFrozenBeatContradictionV1,
  normalizeTextAdventureQualityStableReferenceV1,
  textAdventureQualityReviewAuthorityViolationsV1,
  textAdventureQualityReviewScopeViolationsV1,
  textAdventurePlayerPerspectiveIssuesV1,
  textAdventureUnauthorizedKinshipIssuesV1,
  textAdventureDialogueAttributionIssuesV1,
  textAdventureSceneSpeakerAuthorityIssuesV1,
  textAdventureQuestLocationAuthorityIssuesV1,
  isTextAdventureRecomputedQualityIssueV1,
} from './text-adventure-quality'

export class ProductProductionContextBudgetErrorV1 extends Error {}

/** Structured production contracts must remain exact JSON, including secrets
 * and late fields. Their registered cap is soft; the task budget is hard. */
export const preserveProductProductionContextV1: ContextSourceTransformer = async input => {
  if (!input.source.key.startsWith('product-production.')) return undefined
  if (input.originalTokens > input.inputBudgetTokens) {
    throw new ProductProductionContextBudgetErrorV1(`[product-production-context] ${input.source.label} 需要 ${input.originalTokens} tokens，超过本任务输入预算 ${input.inputBudgetTokens}；未调用模型，请缩小制作范围。`)
  }
  return {
    content: input.content, delivery: 'full', allowSourceBudgetOverflow: true,
    compression: {
      version: 1, promptVersion: 'agent-context-compression-v1', outcome: 'fallback',
      fallback: 'full-source', sourceHash: await sha256Text(input.content), attempts: 0,
      targetTokens: input.sourceBudgetTokens, requiredAnchorCount: 1, coveredAnchorCount: 0,
      failureCode: 'structured-production-contract-requires-exact-json',
    },
  }
}

function requiredScope(input: AssembleContextInput): WorkspaceScope {
  if (!input.scope) throw new Error('[product-production-context] 缺少已解析 WorkspaceScope')
  return input.scope
}

function requiredId(value: number | undefined, label: string): number {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) throw new Error(`[product-production-context] 缺少 ${label}`)
  return value!
}

async function productionAndBuild(input: AssembleContextInput) {
  const scope = requiredScope(input)
  const productionId = requiredId(input.productProductionId, 'productProductionId')
  const production = await db.productProductions.get(productionId)
  if (!production || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })) {
    throw new Error('[product-production-context] Production 不存在或跨 Work')
  }
  const buildId = input.productBuildId
  const build = buildId == null ? null : await db.productBuilds.get(buildId)
  if (build && (build.productionId !== productionId
    || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' }))) {
    throw new Error('[product-production-context] Build 不属于当前 Production/Work')
  }
  return { scope, production, build }
}

export async function readProductProductionBriefContext(input: AssembleContextInput): Promise<string> {
  const { production, scope } = await productionAndBuild(input)
  if (production.currentBriefRevision == null) throw new Error('[product-production-context] Production 尚无当前 Brief')
  const brief = await db.productProductionBriefs
    .where('[productionId+revision]').equals([production.id!, production.currentBriefRevision]).first()
  if (!brief || brief.status !== 'authorized') throw new Error('[product-production-context] 当前 Brief 未授权')
  const content = JSON.parse(brief.briefJson)
  const ttrpgRules = content.intent?.productType === 'ttrpg' && content.ttrpg
    ? await (await import('../ttrpg/production-brief')).resolveTtrpgProductionRulePackV2({ scope, brief: content.ttrpg as TtrpgProductionBriefV2 })
    : null
  return JSON.stringify({
    ...(ttrpgRules ? { ttrpgRules: { contentHash: content.ttrpg.rules.effectiveContentHash,
      attributes: ttrpgRules.attributes, actions: ttrpgRules.actions.map(action => ({ key: action.key, name: action.name, description: action.description, target: action.target })) } } : {}),
    schema: 'storyforge.product-production.brief-context', version: 1,
    productionKey: production.productionKey, briefRevision: brief.revision, briefHash: brief.briefHash,
    sourceWorldContentHash: brief.sourceWorldContentHash, userIntentSummary: brief.userIntentSummary,
    estimate: JSON.parse(brief.estimateJson), brief: JSON.parse(brief.briefJson),
  })
}

export async function readProductProductionArtifactInputs(input: AssembleContextInput): Promise<string> {
  const { build } = await productionAndBuild(input)
  if (!build) throw new Error('[product-production-context] artifact inputs 需要 productBuildId')
  const requested = new Set(input.productArtifactKeys ?? [])
  if (requested.size === 0) throw new Error('[product-production-context] artifact inputs 必须显式选择 artifact keys')
  const artifacts = (await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray())
    .filter(row => requested.has(row.artifactKey) && (row.status === 'accepted' || row.status === 'carried-forward'))
    .map(row => ({
      artifactKey: row.artifactKey, version: row.version, kind: row.kind, contentHash: row.contentHash,
      producerReceiptHash: row.producerReceiptHash, payload: JSON.parse(row.payloadJson),
      metadata: JSON.parse(row.metadataJson),
    }))
  if (artifacts.length !== requested.size) throw new Error('[product-production-context] 选择的 Artifact 缺失或未验收')
  return JSON.stringify({ schema: 'storyforge.product-production.artifact-inputs', version: 1, buildNumber: build.buildNumber, artifacts })
}

function contextRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function contextRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(contextRecord) : []
}

function contextText(value: unknown, maximum: number): string {
  if (typeof value !== 'string') return ''
  const normalized = value.trim().normalize('NFC')
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum)}…`
}

function contextFailureDetail(value: unknown, maximum = 800): string {
  if (typeof value !== 'string') return ''
  const normalized = value.trim().normalize('NFC')
  if (normalized.length <= maximum) return normalized
  const headLength = Math.floor((maximum - 1) / 2)
  const tailLength = maximum - 1 - headLength
  return `${normalized.slice(0, headLength)}…${normalized.slice(-tailLength)}`
}

async function requiredContextArtifactsV1(input: AssembleContextInput, options: {
  label: string
  requiredKeys: readonly string[]
}) {
  const { build } = await productionAndBuild(input)
  if (!build) throw new Error(`[product-production-context] ${options.label} 需要 productBuildId`)
  const requested = new Set(input.productArtifactKeys ?? [])
  if (options.requiredKeys.some(key => !requested.has(key))) {
    throw new Error(`[product-production-context] ${options.label} Artifact 选择不完整`)
  }
  const candidateRows = (await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray())
    .filter(row => options.requiredKeys.includes(row.artifactKey)
      && (row.status === 'accepted' || row.status === 'carried-forward'))
    .sort((left, right) => left.version - right.version)
  const rowByKey = new Map(candidateRows.map(row => [row.artifactKey, row]))
  const rows = options.requiredKeys.flatMap(key => {
    const row = rowByKey.get(key)
    return row ? [row] : []
  })
  if (rows.length !== options.requiredKeys.length) {
    throw new Error(`[product-production-context] ${options.label} Artifact 缺失或未验收`)
  }
  return {
    build,
    rows,
    payloadByKey: new Map(rows.map(row => [row.artifactKey, contextRecord(JSON.parse(row.payloadJson))])),
  }
}

/**
 * One-act work packet for the Scene Writer. It intentionally projects the
 * accepted source closure instead of dumping every upstream Artifact into all
 * three Runs. Exact task identity is supplied by the durable scheduler.
 */
export async function readTextAdventureSceneScriptInputsV1(input: AssembleContextInput): Promise<string> {
  const match = /^content\.scene-script\.act-([123])\.part-([12])$/.exec(input.productProductionTaskKey ?? '')
  if (!match) throw new Error('[product-production-context] 分场投影缺少精确 act/part taskKey')
  const actIndex = Number(match[1]) - 1
  const partIndex = Number(match[2]) - 1
  const requiredKeys = [
    'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
    'content.product-module', 'content.narrative-arc-plan', 'content.main-quest-plan',
    'content.adventure-side-quests', 'content.adventure-ambient-events', 'content.quest-script',
  ]
  const { build, payloadByKey } = await requiredContextArtifactsV1(input, {
    label: `第 ${actIndex + 1} 幕分场投影`, requiredKeys,
  })
  const story = payloadByKey.get('content.story-bible') ?? {}
  const cast = payloadByKey.get('content.cast-bible') ?? {}
  const architecture = payloadByKey.get('content.adventure-architecture') ?? {}
  const systems = payloadByKey.get('content.product-module') ?? {}
  const arc = payloadByKey.get('content.narrative-arc-plan') ?? {}
  const mainPlan = payloadByKey.get('content.main-quest-plan') ?? {}
  const questScript = payloadByKey.get('content.quest-script') ?? {}
  const acts = contextRows(arc.acts)
  const currentAct = acts[actIndex]
  if (!currentAct) throw new Error(`[product-production-context] 第 ${actIndex + 1} 幕叙事弧缺失`)
  const fullActSceneCards = contextRows(currentAct.sceneCards)
  const firstPartCount = Math.ceil(fullActSceneCards.length / 2)
  const sceneParts = fullActSceneCards.length <= 1
    ? [fullActSceneCards]
    : [fullActSceneCards.slice(0, firstPartCount), fullActSceneCards.slice(firstPartCount)]
  const sceneCards = sceneParts[partIndex]
  if (!sceneCards?.length) {
    throw new Error(`[product-production-context] 第 ${actIndex + 1} 幕不存在正文分包 ${partIndex + 1}`)
  }
  const sceneKeys = new Set(sceneCards.map(scene => contextText(scene.key, 200)).filter(Boolean))
  const castKeys = new Set(sceneCards.flatMap(scene => (
    Array.isArray(scene.castKeys) ? scene.castKeys.filter((value): value is string => typeof value === 'string') : []
  )))
  const locationOrdinals = new Set(sceneCards.flatMap(scene => (
    Number.isSafeInteger(scene.locationOrdinal) ? [Number(scene.locationOrdinal)] : []
  )))
  const locationCatalog = contextRows(architecture.regions).flatMap((region, regionIndex) => (
    contextRows(region.areas).flatMap((area, areaIndex) => (
      contextRows(area.locations).map(location => ({
        regionIndex, areaIndex,
        regionTitle: contextText(region.title, 120),
        areaTitle: contextText(area.title, 120),
        title: contextText(location.title, 120),
        description: contextText(location.description, 500),
        tags: Array.isArray(location.tags) ? location.tags : [],
      }))
    ))
  )).map((location, index) => ({ ordinal: index + 1, ...location }))
  const relevantLocations = locationCatalog.filter(location => locationOrdinals.has(location.ordinal))
  const mainQuest = contextRows(mainPlan.quests)[0] ?? {}
  const objectives = contextRows(mainQuest.objectives).filter(objective => (
    Array.isArray(objective.sceneKeys)
      && objective.sceneKeys.some(sceneKey => typeof sceneKey === 'string' && sceneKeys.has(sceneKey))
  ))
  const objectiveKeys = new Set(objectives.map(objective => contextText(objective.key, 200)).filter(Boolean))
  const supplemental = (artifactKey: string) => contextRows(payloadByKey.get(artifactKey)?.entries)
    .filter(entry => contextRows(entry.stages).some(stage => (
      Number.isSafeInteger(stage.locationOrdinal) && locationOrdinals.has(Number(stage.locationOrdinal))
    )))
  const sideEntries = supplemental('content.adventure-side-quests')
  const ambientEntries = supplemental('content.adventure-ambient-events')
  const sideKeys = new Set(sideEntries.map(entry => contextText(entry.key, 200)).filter(Boolean))
  const ambientKeys = new Set(ambientEntries.map(entry => contextText(entry.key, 200)).filter(Boolean))
  const relevantStageKeysByEntry = (entries: Record<string, unknown>[]) => new Map(
    entries.map(entry => {
      const entryKey = contextText(entry.key, 200)
      const stageKeys = new Set(contextRows(entry.stages).flatMap(stage => (
        Number.isSafeInteger(stage.locationOrdinal)
          && locationOrdinals.has(Number(stage.locationOrdinal))
          && typeof stage.key === 'string'
          ? [stage.key] : []
      )))
      return [entryKey, stageKeys] as const
    }),
  )
  const sideStageKeysByEntry = relevantStageKeysByEntry(sideEntries)
  const ambientStageKeysByEntry = relevantStageKeysByEntry(ambientEntries)
  const mainScripts = contextRows(questScript.mainObjectiveScripts)
    .filter(script => objectiveKeys.has(contextText(script.objectiveKey, 200)))
  const sideScripts = contextRows(questScript.sideQuestScripts)
    .filter(script => sideKeys.has(contextText(script.entryKey, 200)))
  const ambientScripts = contextRows(questScript.ambientEventScripts)
    .filter(script => ambientKeys.has(contextText(script.entryKey, 200)))
  const usedAbilityKeys = new Set([
    ...mainScripts.flatMap(script => contextRows(script.alternatives).flatMap(alternative => {
      const resolution = alternative.resolution && typeof alternative.resolution === 'object'
        && !Array.isArray(alternative.resolution)
        ? alternative.resolution as Record<string, unknown> : {}
      return typeof resolution.abilityKey === 'string' ? [resolution.abilityKey] : []
    })),
    ...sideScripts.flatMap(script => contextRows(script.stages)
      .flatMap(stage => typeof stage.abilityKey === 'string' ? [stage.abilityKey] : [])),
    ...ambientScripts.flatMap(script => contextRows(script.stages)
      .flatMap(stage => typeof stage.abilityKey === 'string' ? [stage.abilityKey] : [])),
  ])
  const currentDecisions = contextRows(arc.decisions).filter(decision => sceneKeys.has(contextText(decision.sceneKey, 200)))
  const previousCards = partIndex > 0
    ? sceneParts[partIndex - 1]
    : contextRows(acts[actIndex - 1]?.sceneCards)
  const nextCards = partIndex + 1 < sceneParts.length
    ? sceneParts[partIndex + 1]
    : contextRows(acts[actIndex + 1]?.sceneCards)
  const projectCharacter = (character: Record<string, unknown>) => ({
    key: character.key,
    role: character.role,
    name: character.name,
    publicIdentity: contextText(character.publicIdentity, 200),
    desire: contextText(character.desire, 240),
    fear: contextText(character.fear, 240),
    secret: contextText(character.secret, 240),
    motivation: contextText(character.motivation, 240),
    voice: contextText(character.voice, 300),
    initialKnowledge: Array.isArray(character.initialKnowledge)
      ? character.initialKnowledge.map(value => contextText(value, 180)) : [],
    forbiddenKnowledge: Array.isArray(character.forbiddenKnowledge)
      ? character.forbiddenKnowledge.map(value => contextText(value, 180)) : [],
    relationshipArc: Array.isArray(character.relationshipArc)
      ? character.relationshipArc.map(value => contextText(value, 200)) : [],
  })
  const projectSceneCard = (scene: Record<string, unknown>) => ({
    key: scene.key,
    title: scene.title,
    locationOrdinal: scene.locationOrdinal,
    purpose: contextText(scene.purpose, 450),
    conflict: contextText(scene.conflict, 450),
    entryState: contextText(scene.entryState, 360),
    exitState: contextText(scene.exitState, 360),
    castKeys: scene.castKeys,
    setupKeys: scene.setupKeys,
    payoffKeys: scene.payoffKeys,
  })
  const projectObjective = (objective: Record<string, unknown>) => ({
    key: objective.key,
    stageKey: objective.stageKey,
    title: objective.title,
    narrativePurpose: contextText(objective.narrativePurpose, 420),
    sceneKeys: objective.sceneKeys,
    locationOrdinal: objective.locationOrdinal,
  })
  const projectSupplemental = (
    entry: Record<string, unknown>,
    stageKeysByEntry: ReadonlyMap<string, ReadonlySet<string>>,
  ) => ({
    key: entry.key,
    title: entry.title,
    description: contextText(entry.description, 350),
    hook: contextText(entry.hook, 350),
    stages: contextRows(entry.stages).filter(stage => (
      typeof stage.key === 'string'
        && stageKeysByEntry.get(contextText(entry.key, 200))?.has(stage.key)
    )).map(stage => ({
      key: stage.key,
      title: contextText(stage.title, 160),
      objective: contextText(stage.objective, 350),
      locationOrdinal: stage.locationOrdinal,
      actionKind: stage.actionKind,
    })),
  })
  const projectMainScript = (script: Record<string, unknown>) => ({
    objectiveKey: script.objectiveKey,
    sceneKey: script.sceneKey,
    alternatives: contextRows(script.alternatives).map(alternative => ({
      alternativeKey: alternative.alternativeKey,
      resolution: alternative.resolution,
      timeCostMinutes: alternative.timeCostMinutes,
      successText: contextText(alternative.successText, 360),
      costlySuccessText: contextText(alternative.costlySuccessText, 360),
      failureForwardText: contextText(alternative.failureForwardText, 360),
    })),
  })
  const projectSupplementalScript = (
    script: Record<string, unknown>,
    stageKeysByEntry: ReadonlyMap<string, ReadonlySet<string>>,
  ) => ({
    entryKey: script.entryKey,
    stages: contextRows(script.stages).filter(stage => (
      typeof stage.stageKey === 'string'
        && stageKeysByEntry.get(contextText(script.entryKey, 200))?.has(stage.stageKey)
    )).map(stage => ({
      stageKey: stage.stageKey,
      actionKind: stage.actionKind,
      abilityKey: stage.abilityKey,
      difficulty: stage.difficulty,
      costlySuccessFloor: stage.costlySuccessFloor,
      timeCostMinutes: stage.timeCostMinutes,
      // Scene writers need the outcome semantics, not the complete runtime
      // settlement copy already frozen in the Quest Script artifact. Keep the
      // three branches distinct while preventing a multi-stage regional side
      // quest from consuming the entire bounded prose packet.
      successText: contextText(stage.successText, 220),
      costlySuccessText: contextText(stage.costlySuccessText, 220),
      failureForwardText: contextText(stage.failureForwardText, 220),
    })),
  })
  const packet = {
    schema: 'storyforge.text-adventure-scene-script-inputs', version: 1,
    buildNumber: build.buildNumber,
    taskKey: input.productProductionTaskKey,
    story: {
      title: story.title,
      premise: contextText(story.premise, 450),
      playerFantasy: contextText(story.playerFantasy, 320),
      thematicQuestion: contextText(story.thematicQuestion, 320),
      emotionalPromise: contextText(story.emotionalPromise, 320),
      centralConflict: contextText(story.centralConflict, 450),
      canonFacts: Array.isArray(story.canonFacts) ? story.canonFacts.map(value => contextText(value, 200)) : [],
      productPrivateFacts: Array.isArray(story.productPrivateFacts)
        ? story.productPrivateFacts.map(value => contextText(value, 200)) : [],
      prohibitions: Array.isArray(story.prohibitions) ? story.prohibitions.map(value => contextText(value, 200)) : [],
      setupPayoffs: contextRows(story.setupPayoffs).filter(item => (
        item.introducedAct === actIndex + 1 || item.resolvedAct === actIndex + 1
      )).map(item => ({
        key: item.key,
        setup: contextText(item.setup, 260),
        payoff: contextText(item.payoff, 260),
        introducedAct: item.introducedAct,
        resolvedAct: item.resolvedAct,
      })),
      endings: actIndex === 2 && partIndex === sceneParts.length - 1
        ? contextRows(story.endings).map(ending => ({
            key: ending.key,
            title: ending.title,
            dramaticAnswer: contextText(ending.dramaticAnswer, 450),
            requiredConsequences: Array.isArray(ending.requiredConsequences)
              ? ending.requiredConsequences.map(value => contextText(value, 250)) : [],
          }))
        : [],
    },
    act: {
      key: currentAct.key,
      title: currentAct.title,
      targetMinutes: currentAct.targetMinutes,
      goal: contextText(currentAct.goal, 500),
      irreversibleTurn: contextText(currentAct.irreversibleTurn, 500),
      sceneCards: sceneCards.map(projectSceneCard),
    },
    handoff: {
      previousExit: previousCards.length ? previousCards[previousCards.length - 1].exitState : null,
      nextEntry: nextCards.length ? nextCards[0].entryState : null,
    },
    decisions: currentDecisions.map(decision => ({
      key: decision.key,
      sceneKey: decision.sceneKey,
      prompt: contextText(decision.prompt, 450),
      options: contextRows(decision.options).map(option => ({
        key: option.key,
        label: contextText(option.label, 300),
        cost: contextText(option.cost, 300),
        persistentEffectKey: option.persistentEffectKey,
        echoSceneKeys: option.echoSceneKeys,
      })),
    })),
    cast: contextRows(cast.characters)
      .filter(character => castKeys.has(contextText(character.key, 200)))
      .map(projectCharacter),
    locations: relevantLocations,
    systems: {
      abilities: contextRows(systems.abilities)
        .filter(ability => usedAbilityKeys.size === 0 || usedAbilityKeys.has(contextText(ability.key, 200)))
        .map(ability => ({
        key: ability.key, title: ability.title, description: contextText(ability.description, 260), role: ability.role,
        })),
      resources: contextRows(systems.resources).map(resource => ({
        key: resource.key, title: resource.title, description: contextText(resource.description, 260), role: resource.role,
      })),
      starterEquipment: contextRows(systems.starterEquipment).map(item => ({
        key: item.key, title: item.title, description: contextText(item.description, 260),
        modifierAbilityKey: item.modifierAbilityKey, modifierDelta: item.modifierDelta,
      })),
    },
    mainQuest: {
      key: mainQuest.key, title: mainQuest.title,
      objectives: objectives.map(projectObjective),
      scripts: mainScripts.map(projectMainScript),
    },
    sideContent: sideEntries.map(entry => projectSupplemental(entry, sideStageKeysByEntry)),
    sideScripts: sideScripts.map(script => projectSupplementalScript(script, sideStageKeysByEntry)),
    ambientContent: ambientEntries.map(entry => projectSupplemental(entry, ambientStageKeysByEntry)),
    ambientScripts: ambientScripts.map(script => projectSupplementalScript(script, ambientStageKeysByEntry)),
  }
  const serialized = JSON.stringify(packet)
  const estimatedTokens = estimateTokens(serialized)
  if (estimatedTokens > 15_000) {
    const sectionTokens = Object.fromEntries(Object.entries(packet).map(([key, value]) => (
      [key, estimateTokens(JSON.stringify(value))]
    )))
    throw new Error(
      `[product-production-context] 第 ${actIndex + 1} 幕分场投影超过登记预算:${estimatedTokens}/15000 sections=${JSON.stringify(sectionTokens)}`,
    )
  }
  return serialized
}

/** Full-text but role-specific packet for the independent Dialogue Editor. */
export async function readTextAdventureDialogueInputsV1(input: AssembleContextInput): Promise<string> {
  const match = /^content\.dialogue-pass\.act-([123])$/.exec(input.productProductionTaskKey ?? '')
  if (!match) throw new Error('[product-production-context] 对白投影缺少精确 act taskKey')
  const act = Number(match[1])
  const requiredKeys = [
    'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
    'content.narrative-arc-plan',
    `content.scene-script.act-${act}`,
  ]
  const { build, rows, payloadByKey } = await requiredContextArtifactsV1(input, {
    label: '对白审校投影', requiredKeys,
  })
  const story = payloadByKey.get('content.story-bible') ?? {}
  const cast = payloadByKey.get('content.cast-bible') ?? {}
  const arc = payloadByKey.get('content.narrative-arc-plan') ?? {}
  const sceneScript = payloadByKey.get(`content.scene-script.act-${act}`) ?? {}
  const scenes = contextRows(sceneScript.scenes)
  const endings = contextRows(sceneScript.endings)
  const dialogueBeats = [
    ...scenes.flatMap(scene => contextRows(scene.beats)
      .filter(beat => beat.kind === 'dialogue')
      .map(beat => ({
        beatKey: beat.beatKey, speakerKey: beat.speakerKey, text: beat.text, order: beat.order,
        sceneKey: scene.sceneKey, endingKey: null,
      }))),
    ...endings.flatMap(ending => contextRows(ending.beats)
      .filter(beat => beat.kind === 'dialogue')
      .map(beat => ({
        beatKey: beat.beatKey, speakerKey: beat.speakerKey, text: beat.text, order: beat.order,
        sceneKey: null, endingKey: ending.endingKey,
      }))),
  ]
  const usedSpeakerKeys = [...new Set(dialogueBeats.map(beat => String(beat.speakerKey)))].sort()
  const speakerOrdinalByKey = new Map(usedSpeakerKeys.map((characterKey, index) => [characterKey, index + 1]))
  const packet = {
    schema: 'storyforge.text-adventure-dialogue-inputs', version: 1,
    buildNumber: build.buildNumber,
    taskKey: input.productProductionTaskKey,
    reviewContract: {
      reviewedCharacterCount: usedSpeakerKeys.length,
      reviewedBeatCount: dialogueBeats.length,
      reviewedChoiceCount: contextRows(sceneScript.choices).length,
      rule: '输出必须逐字复制这三个冻结计数；不得使用样例数值或自行计数。',
    },
    sources: rows.map(row => ({ artifactKey: row.artifactKey, contentHash: row.contentHash }))
      .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey)),
    storyBoundary: {
      title: story.title, thematicQuestion: story.thematicQuestion,
      centralConflict: story.centralConflict, prohibitions: story.prohibitions,
    },
    speakingCharacters: contextRows(cast.characters)
      .filter(character => usedSpeakerKeys.includes(String(character.key)))
      .sort((left, right) => String(left.key).localeCompare(String(right.key)))
      .map(character => ({
      characterOrdinal: speakerOrdinalByKey.get(String(character.key)),
      key: character.key, role: character.role, name: character.name,
      publicIdentity: character.publicIdentity, desire: character.desire,
      fear: character.fear, secret: character.secret, motivation: character.motivation,
      voice: character.voice, initialKnowledge: character.initialKnowledge,
      forbiddenKnowledge: character.forbiddenKnowledge, relationshipArc: character.relationshipArc,
    })),
    sceneKnowledgeBoundaries: contextRows(contextRows(arc.acts)[act - 1]?.sceneCards).map(scene => ({
      sceneKey: scene.key, title: scene.title, entryState: scene.entryState, exitState: scene.exitState,
      castKeys: scene.castKeys, setupKeys: scene.setupKeys, payoffKeys: scene.payoffKeys,
    })),
    act: {
      actKey: sceneScript.actKey, moduleTitle: sceneScript.moduleTitle,
      scenes: scenes.map(scene => ({
        sceneKey: scene.sceneKey, title: scene.title, summary: contextText(scene.summary, 320),
      })),
      dialogueBeats: dialogueBeats.map((beat, index) => ({
        beatOrdinal: index + 1, beatKey: beat.beatKey,
        sceneKey: beat.sceneKey, endingKey: beat.endingKey,
        speakerOrdinal: speakerOrdinalByKey.get(String(beat.speakerKey)),
        speakerKey: beat.speakerKey, text: beat.text, order: beat.order,
      })),
      choices: contextRows(sceneScript.choices).map((choice, index) => ({
        ...choice, choiceOrdinal: index + 1,
      })),
      endings: endings.map(ending => ({
        endingKey: ending.endingKey, title: ending.title, summary: ending.summary,
      })),
    },
  }
  const serialized = JSON.stringify(packet)
  const estimatedTokens = estimateTokens(serialized)
  // The current Plan reserves 26,400 input tokens for each independent
  // Dialogue Editor. Keep the registered source packet below 20k so the
  // system contract, schema and provider framing retain about 6.4k tokens of
  // explicit headroom. A live complete 60-minute third act measured 17,425
  // tokens here; keeping the act whole preserves voice and knowledge
  // continuity and remains far below the configured 512K model context.
  const maximumDialogueContextTokens = 20_000
  if (estimatedTokens > maximumDialogueContextTokens) {
    throw new Error(`[product-production-context] 第 ${act} 幕对白审校投影超过登记预算:${estimatedTokens}/${maximumDialogueContextTokens}，必须升级执行计划容量或增加更小的有界对白分包计划`)
  }
  return serialized
}

/**
 * Text-only companion packet for the independent visual QA request. Actual
 * image bytes are attached by the governed vision capability after this
 * registered projection and the Build Artifact hashes have been frozen.
 */
export async function readTextAdventureVisualQualityInputsV1(input: AssembleContextInput): Promise<string> {
  if (!/^media\.visual-quality-review\.batch-[1-9]\d*$/.test(input.productProductionTaskKey ?? '')) {
    throw new Error('[product-production-context] 视觉审查投影缺少有界批次 taskKey')
  }
  const requested = [...new Set(input.productArtifactKeys ?? [])]
  const visualKeys = requested.filter(key => /^media\.visual\.\d{3}$/.test(key)).sort()
  if (!visualKeys.length) throw new Error('[product-production-context] 视觉审查缺少图片 Artifact')
  const requiredKeys = [
    'content.cast-bible', 'media.requirements', 'media.visual-bible', 'media.audit', ...visualKeys,
  ]
  const { build, rows, payloadByKey } = await requiredContextArtifactsV1(input, {
    label: '文字冒险视觉质量审查投影', requiredKeys,
  })
  const rowByKey = new Map(rows.map(row => [row.artifactKey, row]))
  const mediaRequirements = payloadByKey.get('media.requirements') ?? {}
  const visualBible = payloadByKey.get('media.visual-bible') ?? {}
  const cast = payloadByKey.get('content.cast-bible') ?? {}
  const audit = payloadByKey.get('media.audit') ?? {}
  const packet = {
    schema: 'storyforge.text-adventure-visual-quality-inputs', version: 1,
    buildNumber: build.buildNumber,
    sources: rows.map(row => ({ artifactKey: row.artifactKey, contentHash: row.contentHash }))
      .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey)),
    visualBible: {
      style: visualBible.style, palette: visualBible.palette,
      compositionRules: visualBible.compositionRules, continuityRules: visualBible.continuityRules,
      characterAnchors: visualBible.characterAnchors,
    },
    cast: contextRows(cast.characters).map(character => ({
      key: character.key, name: character.name, role: character.role,
      publicIdentity: character.publicIdentity, visualAnchor: character.visualAnchor,
    })),
    requirements: contextRows(mediaRequirements.visual),
    audit: {
      requirementsHash: audit.requirementsHash, visualBibleHash: audit.visualBibleHash,
      assets: audit.assets,
    },
    images: visualKeys.map(artifactKey => {
      const row = rowByKey.get(artifactKey)!
      const metadata = contextRecord(JSON.parse(row.metadataJson))
      return {
        artifactKey, contentHash: row.contentHash, kind: row.kind, mediaKind: row.mediaKind,
        mimeType: row.mimeType, byteSize: row.byteSize, width: metadata.width, height: metadata.height,
        source: metadata.source, license: metadata.license, altText: metadata.altText,
      }
    }),
    authorityBoundary: {
      modelMay: ['identify visual issues', 'recommend accept revise replace or human review'],
      modelMayNot: ['change blob bytes', 'change world facts', 'change visual bible', 'approve rights', 'publish build'],
    },
  }
  const serialized = JSON.stringify(packet)
  const estimatedTokens = estimateTokens(serialized)
  if (estimatedTokens > 12_000) {
    throw new Error(`[product-production-context] 视觉审查投影超过登记预算:${estimatedTokens}/12000`)
  }
  return serialized
}

/**
 * Registered deterministic projection for one of four independent narrative
 * review Runs. Every packet carries the same global story spine and
 * setup/payoff map. The structure Run owns cross-act architecture, while an
 * act Run owns the player-visible prose, dialogue and choices for one act.
 * Full accepted Artifacts remain authoritative in IndexedDB and are supplied
 * again to the deterministic aggregate for reference/language validation.
 */
export async function readTextAdventureQualityInputsV1(input: AssembleContextInput): Promise<string> {
  const scope = textAdventureQualityReviewScopeFromTaskKeyV1(input.productProductionTaskKey ?? '')
  if (!scope) {
    throw new Error('[product-production-context] 旧版整包文字冒险质量审查不可继续执行；必须升级冻结生产计划后按 structure/act scope 重跑')
  }
  const requiredKeys = [
    'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
    'content.narrative-arc-plan', 'content.ending-route-plan',
    'content.main-quest-plan', 'content.quest-script',
    'content.dialogue-pass.act-1', 'content.dialogue-pass.act-2',
    'content.dialogue-pass.act-3', 'content.narrative', 'content.product-module',
    'content.adventure-side-quests', 'content.adventure-ambient-events',
  ]
  const { build, rows, payloadByKey } = await requiredContextArtifactsV1(input, {
    label: `文字冒险叙事质量审查 ${scope}`, requiredKeys,
  })
  const architecture = payloadByKey.get('content.adventure-architecture') ?? {}
  const storyBible = payloadByKey.get('content.story-bible') ?? {}
  const castBible = payloadByKey.get('content.cast-bible') ?? {}
  const arcPlan = payloadByKey.get('content.narrative-arc-plan') ?? {}
  const endingRoutePlan = payloadByKey.get('content.ending-route-plan') ?? {}
  const mainQuestPlan = payloadByKey.get('content.main-quest-plan') ?? {}
  const questScript = payloadByKey.get('content.quest-script') ?? {}
  const narrative = payloadByKey.get('content.narrative') ?? {}
  const productModule = payloadByKey.get('content.product-module') ?? {}
  const acts = contextRows(arcPlan.acts)
  const actIndex = scope === 'structure' ? null : Number(scope.slice('act-'.length)) - 1
  const activeAct = actIndex == null ? null : acts[actIndex]
  if (actIndex != null && !activeAct) {
    throw new Error(`[product-production-context] 文字冒险质量审查缺少第 ${actIndex + 1} 幕`)
  }
  const activeSceneKeys = new Set(contextRows(activeAct?.sceneCards).map(scene => (
    contextText(scene.key, 200)
  )).filter(Boolean))
  const endingNodeKeys = new Set(contextRows(arcPlan.endings).map(ending => (
    contextText(ending.endingKey, 200)
  )).filter(Boolean))
  const ownedEndingNodeKeys = scope === 'structure' || actIndex === 2
    ? endingNodeKeys : new Set<string>()
  const locations = contextRows(architecture.regions).flatMap(region => (
    contextRows(region.areas).flatMap(area => contextRows(area.locations).map(location => ({
      title: contextText(location.title, 80),
      description: contextText(location.description, 100),
    })))
  )).filter(location => location.title)
  const projectSceneCard = (scene: Record<string, unknown>) => ({
    key: scene.key,
    title: contextText(scene.title, 80),
    locationOrdinal: scene.locationOrdinal,
    purpose: contextText(scene.purpose, 100),
    conflict: contextText(scene.conflict, scope === 'structure' ? 80 : 100),
    entryState: contextText(scene.entryState, scope === 'structure' ? 60 : 80),
    exitState: contextText(scene.exitState, scope === 'structure' ? 60 : 80),
    castKeys: Array.isArray(scene.castKeys) ? scene.castKeys : [],
    setupKeys: Array.isArray(scene.setupKeys) ? scene.setupKeys : [],
    payoffKeys: Array.isArray(scene.payoffKeys) ? scene.payoffKeys : [],
  })
  const projectDecision = (decision: Record<string, unknown>) => ({
    key: decision.key,
    sceneKey: decision.sceneKey,
    prompt: contextText(decision.prompt, 100),
    options: contextRows(decision.options).map(option => ({
      key: option.key,
      label: contextText(option.label, 90),
      cost: contextText(option.cost, 90),
      persistentEffectKey: option.persistentEffectKey,
      echoSceneKeys: Array.isArray(option.echoSceneKeys) ? option.echoSceneKeys : [],
    })),
  })
  const projectedActs = (scope === 'structure' ? acts : activeAct ? [activeAct] : []).map(act => ({
    key: act.key,
    title: contextText(act.title, 80),
    targetMinutes: act.targetMinutes,
    goal: contextText(act.goal, 160),
    irreversibleTurn: contextText(act.irreversibleTurn, 160),
    sceneCards: contextRows(act.sceneCards).map(projectSceneCard),
  }))
  const decisions = contextRows(arcPlan.decisions)
    .filter(decision => scope === 'structure' || activeSceneKeys.has(contextText(decision.sceneKey, 200)))
    .map(projectDecision)
  const beatsByNode = new Map<string, Record<string, unknown>[]>()
  contextRows(narrative.beats).forEach(beat => {
    const nodeKey = contextText(beat.nodeKey, 200)
    if (!nodeKey) return
    beatsByNode.set(nodeKey, [...(beatsByNode.get(nodeKey) ?? []), beat])
  })
  const allChoices = contextRows(narrative.choices)
  const graphChoiceEdges = allChoices.flatMap(choice => {
    const choiceKey = contextText(choice.choiceKey, 200)
    const sourceNodeKey = contextText(choice.sourceNodeKey, 200)
    const targetNodeKey = contextText(choice.targetNodeKey, 200)
    return choiceKey && sourceNodeKey && targetNodeKey
      ? [{ choiceKey, sourceNodeKey, targetNodeKey }] : []
  })
  const outgoingChoiceKeysByNodeKey: Record<string, string[]> = {}
  const incomingChoiceKeysByNodeKey: Record<string, string[]> = {}
  graphChoiceEdges.forEach(edge => {
    ;(outgoingChoiceKeysByNodeKey[edge.sourceNodeKey] ??= []).push(edge.choiceKey)
    ;(incomingChoiceKeysByNodeKey[edge.targetNodeKey] ??= []).push(edge.choiceKey)
  })
  const graphTargetByChoiceKey = new Map(graphChoiceEdges.map(edge => [edge.choiceKey, edge.targetNodeKey]))
  const entryNodeKey = contextText(narrative.entryNodeKey, 200)
  const reachableNodeKeys = new Set<string>()
  const pendingNodeKeys = entryNodeKey ? [entryNodeKey] : []
  while (pendingNodeKeys.length > 0) {
    const current = pendingNodeKeys.shift()!
    if (reachableNodeKeys.has(current)) continue
    reachableNodeKeys.add(current)
    for (const choiceKey of outgoingChoiceKeysByNodeKey[current] ?? []) {
      const targetNodeKey = graphTargetByChoiceKey.get(choiceKey)
      if (targetNodeKey && !reachableNodeKeys.has(targetNodeKey)) pendingNodeKeys.push(targetNodeKey)
    }
  }
  const sceneCardByKey = new Map(acts.flatMap(act => contextRows(act.sceneCards)).flatMap(scene => {
    const sceneKey = contextText(scene.key, 200)
    return sceneKey ? [[sceneKey, scene] as const] : []
  }))
  const decisionChoiceBindings = decisions.map(decision => {
    const choiceKeys = outgoingChoiceKeysByNodeKey[contextText(decision.sceneKey, 200)] ?? []
    return {
      decisionKey: decision.key,
      sceneKey: decision.sceneKey,
      options: decision.options.map((option, optionIndex) => ({
        optionKey: option.key,
        choiceKey: choiceKeys[optionIndex] ?? null,
        persistentEffectKey: option.persistentEffectKey,
        cost: option.cost,
        echoes: (Array.isArray(option.echoSceneKeys) ? option.echoSceneKeys : []).flatMap(value => {
          if (typeof value !== 'string') return []
          const sceneCard = sceneCardByKey.get(value)
          if (!sceneCard) return []
          const presentation = textAdventureDecisionEchoPresentationV1({
            decisionPrompt: contextText(decision.prompt, 100),
            optionLabel: contextText(option.label, 90),
            optionCost: contextText(option.cost, 90),
            sceneTitle: contextText(sceneCard.title, 80),
            sceneConflict: contextText(sceneCard.conflict, 100),
          })
          return [{
            sceneKey: value,
            actionKey: `action.echo.${decision.key}.${option.key}.${value}`,
            requiredConditionKey: option.persistentEffectKey,
            label: presentation.label,
            // One exact primary success echo is the authored route evidence.
            // description/costly/failure/unavailable are fixed compiler
            // templates derived from the same option, not independent story
            // content; repeating them across every scope obscures the prose
            // the act reviewer actually owns.
            // The structure reviewer needs the authored route echo, but not the
            // same full local prose that the owning act reviewer receives. A
            // real 60-minute flagship packet reached 31,962 estimated tokens
            // against this registered source's 32k ceiling when every echo
            // kept 180 characters. Keep a meaningful 120-character causal
            // sample here; the act packet and accepted narrative retain the
            // complete player-visible text under their own authority.
            successText: contextText(presentation.successText, scope === 'structure' ? 120 : 260),
          }]
        }),
      })),
    }
  })
  const endingRouteRequirements = contextRows(endingRoutePlan.routes).map(route => ({
    endingKey: contextText(route.endingKey, 200),
    requiredEffectKeys: Array.isArray(route.requiredEffectKeys)
      ? route.requiredEffectKeys.filter((value): value is string => typeof value === 'string') : [],
    rationale: contextText(route.rationale, 280),
  }))
  const activeChoices = allChoices.filter(choice => (
    activeSceneKeys.has(contextText(choice.sourceNodeKey, 200))
  ))
  const projectedChoiceKeys = new Set((scope === 'structure' ? allChoices : activeChoices)
    .map(choice => contextText(choice.choiceKey, 200)).filter(Boolean))
  const boundaryNodeKeys = new Set(activeChoices.map(choice => contextText(choice.targetNodeKey, 200)).filter(Boolean))
  decisions.flatMap(decision => decision.options).forEach(option => {
    ;(Array.isArray(option.echoSceneKeys) ? option.echoSceneKeys : []).forEach(sceneKey => {
      if (typeof sceneKey === 'string' && sceneKey) boundaryNodeKeys.add(sceneKey)
    })
  })
  contextRows(arcPlan.endings).forEach(ending => {
    const sceneKey = contextText(ending.sceneKey, 200)
    if (sceneKey && activeSceneKeys.has(sceneKey)) boundaryNodeKeys.add(sceneKey)
  })
  const projectNarrativeNode = (node: Record<string, unknown>, mode: 'structure' | 'full' | 'boundary') => {
    const nodeKey = contextText(node.key, 200)
    const beats = [...(beatsByNode.get(nodeKey) ?? [])].sort((left, right) => (
      Number(left.order ?? 0) - Number(right.order ?? 0)
    ))
    const selectedBeats = mode === 'full' ? beats : beats.slice(0, 1)
    return {
      key: nodeKey,
      kind: contextText(node.kind, 40),
      title: contextText(node.title, 100),
      // In an act review every accepted beat is present below. Repeating the
      // generated node summary spends scarce review context without adding
      // player-visible evidence; structure/boundary nodes still need it.
      // The structure packet already carries the authoritative scene-card
      // purpose/conflict/states plus one identified beat. Keep the runtime
      // node summary as a short corroborating label instead of duplicating a
      // second synopsis for every scene.
      summary: mode === 'full' ? '' : contextText(node.summary, mode === 'structure' ? 40 : 140),
      // Repeated JSON field names cost more than a thousand tokens in a long
      // act. The columns are declared once beside narrative.nodes below; the
      // stable beat identity and complete reviewed text remain present.
      beats: selectedBeats.map(beat => ([
        beat.beatKey,
        beat.order,
        beat.kind,
        beat.speakerKey,
        // Structure review needs one representative beat per node to audit
        // setup/payoff and route causality, not the full local prose. A 180
        // character sample keeps a commercial 60-minute graph inside the
        // registered 31.5k-token source envelope while preserving stable beat
        // identity, order, kind and speaker for every node.
        contextText(beat.text, mode === 'full' ? 1_200 : mode === 'structure' ? 80 : 180),
      ])),
      ...(mode === 'full' ? {} : {
        beatCount: beats.length,
        beatCharacters: beats.reduce((sum, beat) => (
          sum + (typeof beat.text === 'string' ? beat.text.length : 0)
        ), 0),
      }),
      projection: mode,
    }
  }
  const narrativeNodes = contextRows(narrative.nodes).flatMap(node => {
    const nodeKey = contextText(node.key, 200)
    if (scope === 'structure') return [projectNarrativeNode(node, 'structure')]
    if (activeSceneKeys.has(nodeKey) || ownedEndingNodeKeys.has(nodeKey)) {
      return [projectNarrativeNode(node, 'full')]
    }
    if (boundaryNodeKeys.has(nodeKey)) return [projectNarrativeNode(node, 'boundary')]
    return []
  })
  const activeCastKeys = new Set([
    ...contextRows(activeAct?.sceneCards).flatMap(scene => (
      Array.isArray(scene.castKeys)
        ? scene.castKeys.filter((key): key is string => typeof key === 'string') : []
    )),
    ...contextRows(narrative.beats).flatMap(beat => (
      (activeSceneKeys.has(contextText(beat.nodeKey, 200))
        || ownedEndingNodeKeys.has(contextText(beat.nodeKey, 200)))
        && typeof beat.speakerKey === 'string'
        ? [beat.speakerKey] : []
    )),
  ])
  const projectChoice = (choice: Record<string, unknown>) => {
    const edge = {
      key: contextText(choice.choiceKey, 120),
      sourceNodeKey: contextText(choice.sourceNodeKey, 120),
      targetNodeKey: contextText(choice.targetNodeKey, 120),
    }
    if (scope === 'structure') return edge
    return {
      ...edge,
      label: contextText(choice.text ?? choice.label, 140),
      description: contextText(choice.description, 140),
      unavailableReason: contextText(choice.unavailableReason, 120),
      // These are the deterministic runtime authority for whether a choice is
      // shown, can be selected and what it changes. unavailableReason is only
      // fallback copy and cannot establish current availability by itself.
      displayConditionJson: contextText(choice.displayConditionJson, 64_000),
      availableConditionJson: contextText(choice.availableConditionJson, 64_000),
      effectsJson: contextText(choice.effectsJson, 64_000),
    }
  }
  const questRows = contextRows(mainQuestPlan.quests)
  const activeObjectives = questRows.flatMap(quest => contextRows(quest.objectives)).filter(objective => (
    scope === 'structure'
      || (Array.isArray(objective.sceneKeys)
        && objective.sceneKeys.some(sceneKey => typeof sceneKey === 'string' && activeSceneKeys.has(sceneKey)))
  ))
  const activeObjectiveKeys = new Set(activeObjectives.map(objective => contextText(objective.key, 200)))
  const projectObjective = (objective: Record<string, unknown>) => ({
    key: objective.key,
    stageKey: objective.stageKey,
    title: contextText(objective.title, 100),
    narrativePurpose: contextText(objective.narrativePurpose, 130),
    sceneKeys: Array.isArray(objective.sceneKeys) ? objective.sceneKeys : [],
    locationOrdinal: objective.locationOrdinal,
    alternatives: contextRows(objective.alternatives).map(alternative => ({
      key: alternative.key,
      actionKind: alternative.actionKind,
      targetCharacterKey: alternative.targetCharacterKey,
      cost: contextText(alternative.cost, 80),
      success: contextText(alternative.successConsequence, 110),
      failureForward: contextText(alternative.failureForwardConsequence, 110),
      persistentEffectKeys: Array.isArray(alternative.persistentEffectKeys)
        ? alternative.persistentEffectKeys : [],
    })),
  })
  const projectMainQuest = (quest: Record<string, unknown>) => {
    const objectives = contextRows(quest.objectives).filter(objective => (
      activeObjectiveKeys.has(contextText(objective.key, 200))
    ))
    const objectiveKeys = new Set(objectives.map(objective => contextText(objective.key, 200)))
    return {
      key: quest.key,
      title: contextText(quest.title, 100),
      ...(scope === 'structure' ? { description: contextText(quest.description, 160) } : {}),
      stages: contextRows(quest.stages).flatMap(stage => {
        const stageObjectiveKeys = (Array.isArray(stage.objectiveKeys) ? stage.objectiveKeys : [])
          .filter(objectiveKey => typeof objectiveKey === 'string' && objectiveKeys.has(objectiveKey))
        return stageObjectiveKeys.length ? [{
          key: stage.key,
          title: contextText(stage.title, 100),
          objectiveKeys: stageObjectiveKeys,
        }] : []
      }),
      objectives: objectives.map(objective => scope === 'structure'
        ? projectObjective(objective)
        : {
            key: objective.key,
            stageKey: objective.stageKey,
            title: contextText(objective.title, 80),
            sceneKeys: Array.isArray(objective.sceneKeys) ? objective.sceneKeys : [],
            locationOrdinal: objective.locationOrdinal,
            alternatives: contextRows(objective.alternatives).map(alternative => ({
              key: alternative.key,
              actionKind: alternative.actionKind,
              targetCharacterKey: alternative.targetCharacterKey,
              persistentEffectKeys: Array.isArray(alternative.persistentEffectKeys)
                ? alternative.persistentEffectKeys : [],
            })),
          }),
    }
  }
  const projectMainScript = (script: Record<string, unknown>) => ({
    objectiveKey: script.objectiveKey,
    sceneKey: script.sceneKey,
    alternatives: contextRows(script.alternatives).map(alternative => ({
      alternativeKey: alternative.alternativeKey,
      resolution: alternative.resolution,
      timeCostMinutes: alternative.timeCostMinutes,
    })),
  })
  const supplementalEntries = (artifactKey: string) => contextRows(payloadByKey.get(artifactKey)?.entries)
  const allSideEntries = supplementalEntries('content.adventure-side-quests')
  const allAmbientEntries = supplementalEntries('content.adventure-ambient-events')
  const assignedSupplementalEntries = (entries: readonly Record<string, unknown>[]) => entries
    .filter((_, index) => actIndex != null && index % 3 === actIndex)
  const projectSupplementalEntry = (entry: Record<string, unknown>) => ({
    key: contextText(entry.key, 120),
    title: contextText(entry.title, 100),
    hook: contextText(entry.hook, 120),
    stages: contextRows(entry.stages).map(stage => ({
      key: contextText(stage.key, 120),
      title: contextText(stage.title, 100),
      locationOrdinal: stage.locationOrdinal,
      actionKind: stage.actionKind,
      abilityKey: stage.abilityKey,
      difficulty: stage.difficulty,
      timeCostMinutes: stage.timeCostMinutes,
    })),
    rewardExperience: entry.rewardExperience,
    rewardCurrency: entry.rewardCurrency,
  })
  const sideEntries = assignedSupplementalEntries(allSideEntries)
  const ambientEntries = assignedSupplementalEntries(allAmbientEntries)
  const sideEntryKeys = new Set(sideEntries.map(entry => contextText(entry.key, 200)))
  const ambientEntryKeys = new Set(ambientEntries.map(entry => contextText(entry.key, 200)))
  const supplementalStageKeys = [...sideEntries, ...ambientEntries].flatMap(entry => (
    contextRows(entry.stages).map(stage => contextText(stage.key, 200)).filter(Boolean)
  ))
  const structureSideEntryKeys = allSideEntries
    .map(entry => contextText(entry.key, 200)).filter(Boolean)
  const structureAmbientEntryKeys = allAmbientEntries
    .map(entry => contextText(entry.key, 200)).filter(Boolean)
  const structureSupplementalStageKeys = [...allSideEntries, ...allAmbientEntries]
    .flatMap(entry => contextRows(entry.stages))
    .map(stage => contextText(stage.key, 200)).filter(Boolean)
  const projectSupplementalScript = (script: Record<string, unknown>) => ({
    entryKey: script.entryKey,
    stages: contextRows(script.stages).map(stage => ({
      stageKey: stage.stageKey,
      actionKind: stage.actionKind,
      abilityKey: stage.abilityKey,
      difficulty: stage.difficulty,
      timeCostMinutes: stage.timeCostMinutes,
      success: contextText(stage.successText, 100),
      costlySuccess: contextText(stage.costlySuccessText, 100),
      failureForward: contextText(stage.failureForwardText, 100),
    })),
  })
  const dialoguePass = actIndex == null
    ? null
    : payloadByKey.get(`content.dialogue-pass.act-${actIndex + 1}`) ?? {}
  const dialogueBeatReviews = contextRows(dialoguePass?.beatReviews)
  const dialogueChoiceReviews = contextRows(dialoguePass?.choiceReviews).filter(review => (
    projectedChoiceKeys.has(contextText(review.choiceKey, 200))
  ))
  const revisedDialogueBeatReviews = dialogueBeatReviews.filter(review => review.verdict === 'revise')
  const revisedDialogueChoiceReviews = dialogueChoiceReviews.filter(review => review.verdict === 'revise')
  const packet = {
    schema: 'storyforge.text-adventure-quality-inputs',
    version: 3,
    buildNumber: build.buildNumber,
    reviewScope: {
      scope,
      applicableScoreKeys: [...TEXT_ADVENTURE_QUALITY_REVIEW_SCORE_KEYS_BY_SCOPE_V1[scope]],
      sceneKeys: scope === 'structure'
        ? acts.flatMap(act => contextRows(act.sceneCards).map(scene => contextText(scene.key, 200))).filter(Boolean)
        : [...activeSceneKeys],
      endingKeys: [...ownedEndingNodeKeys],
      boundaryNodeKeys: scope === 'structure'
        ? [] : [...boundaryNodeKeys].filter(key => !activeSceneKeys.has(key) && !ownedEndingNodeKeys.has(key)),
      objectiveKeys: [...activeObjectiveKeys],
      choiceKeys: (scope === 'structure' ? allChoices : activeChoices)
        .map(choice => contextText(choice.choiceKey, 200)).filter(Boolean),
      decisionKeys: decisions.map(decision => contextText(decision.key, 200)).filter(Boolean),
      optionKeys: decisions.flatMap(decision => decision.options)
        .map(option => contextText(option.key, 200)).filter(Boolean),
      alternativeKeys: activeObjectives.flatMap(objective => contextRows(objective.alternatives))
        .map(alternative => contextText(alternative.key, 200)).filter(Boolean),
      sideQuestKeys: scope === 'structure' ? structureSideEntryKeys : [...sideEntryKeys],
      ambientEventKeys: scope === 'structure' ? structureAmbientEntryKeys : [...ambientEntryKeys],
      supplementalStageKeys: scope === 'structure'
        ? structureSupplementalStageKeys : supplementalStageKeys,
      supplementalAssignmentRule: 'bundle-entry-index-modulo-three',
      coverageRule: scope === 'structure'
        ? '全局故事脊柱、三幕因果、路线差异、人物动机与铺垫回收；不审逐句文风。'
        : '本幕玩家可见正文、对白、选择、主线脚本与按稳定序号分配的补充内容；跨幕判断以全局故事脊柱为锚。',
    },
    sources: rows.map(row => ({
      artifactKey: row.artifactKey,
      contentHash: row.contentHash,
    })).sort((left, right) => left.artifactKey.localeCompare(right.artifactKey)),
    globalStorySpine: {
      title: contextText(storyBible.title, 120),
      premise: contextText(storyBible.premise, 280),
      thematicQuestion: contextText(storyBible.thematicQuestion, 180),
      emotionalPromise: contextText(storyBible.emotionalPromise, 200),
      centralConflict: contextText(storyBible.centralConflict, 280),
      setupPayoffs: contextRows(storyBible.setupPayoffs).map(item => scope === 'structure'
        ? {
            key: item.key,
            setup: contextText(item.setup, 150),
            payoff: contextText(item.payoff, 150),
            introducedAct: item.introducedAct,
            resolvedAct: item.resolvedAct,
          }
        : {
            key: item.key,
            introducedAct: item.introducedAct,
            resolvedAct: item.resolvedAct,
          }),
      endings: contextRows(storyBible.endings).map(item => scope === 'structure' || scope === 'act-3'
        ? {
            key: item.key,
            title: contextText(item.title, 100),
            dramaticAnswer: contextText(item.dramaticAnswer, 170),
            requiredConsequences: (Array.isArray(item.requiredConsequences) ? item.requiredConsequences : [])
              .map(value => contextText(value, 130)),
          }
        : {
            title: contextText(item.title, 100),
            dramaticAnswer: contextText(item.dramaticAnswer, 140),
          }),
    },
    architecture: {
      title: contextText(architecture.title, 120),
      premise: scope === 'structure' ? contextText(architecture.premise, 220) : '',
      emotionalPromise: scope === 'structure' ? contextText(architecture.emotionalPromise, 180) : '',
      themes: Array.isArray(architecture.themes) ? architecture.themes : [],
      locations: scope === 'structure' ? locations : locations.map(location => ({ title: location.title })),
    },
    locationAuthority: {
      ownerArtifactKey: 'content.narrative-arc-plan',
      sceneBindingPath: 'arcPlan.acts[].sceneCards[].locationOrdinal',
      runtimeJoinKey: 'sceneKey',
      narrativeNodeOwnsLocationOrdinal: false,
      repeatedLocationOrdinalAllowed: true,
      maximumLocationOrdinal: locations.length,
      rule: '同一登记地点允许承载多个连续场景；locationOrdinal 是地点引用，不是场景唯一编号。content.narrative.nodes 不复制该字段。',
    },
    graphFacts: {
      authority: 'accepted-content.narrative-deterministic-projection',
      entryNodeKey,
      reachableNodeKeys: [...reachableNodeKeys],
      incomingChoiceKeysByNodeKey,
      outgoingChoiceKeysByNodeKey,
      decisionChoiceBindings,
      endingRouteRequirements,
      rule: '此处是冻结图事实。不得把已列出的入边、出边或 reachable node 误报为缺失；decisionChoiceBindings 是运行编译器按冻结顺序应用的 option→choice 精确绑定，options[].echoes 是将进入运行包的条件化玩家可见回响精确投影，不得自行猜测、交换、解绑或声称已列回响不存在。endingRouteRequirements 是已经过互斥、完备与可达性穷举验证的结局运行条件，最终场景 choice.availableConditionJson 不是结局资格 owner；不得要求用最终菜单覆盖或重复这些条件。只可评价实际玩家可见措辞、代价、差异和回响质量。',
    },
    cast: contextRows(castBible.characters)
      .filter(character => scope === 'structure'
        || activeCastKeys.has(contextText(character.key, 200)))
      .map(character => ({
        key: character.key,
        role: character.role,
        name: contextText(character.name, 80),
        ...(scope === 'structure' ? {
          desire: contextText(character.desire, 120),
          fear: contextText(character.fear, 120),
          initialKnowledge: (Array.isArray(character.initialKnowledge) ? character.initialKnowledge : [])
            .map(value => contextText(value, 90)),
        } : {}),
        motivation: contextText(character.motivation, scope === 'structure' ? 120 : 80),
        voice: contextText(character.voice, scope === 'structure' ? 100 : 70),
        relationshipArc: (Array.isArray(character.relationshipArc) ? character.relationshipArc : [])
          .map(value => contextText(value, scope === 'structure' ? 100 : 60)),
      })),
    arcPlan: {
      acts: projectedActs,
      decisions,
      endings: scope === 'structure' || scope === 'act-3'
        ? contextRows(arcPlan.endings) : [],
    },
    mainQuestPlan: questRows.map(projectMainQuest).filter(quest => quest.objectives.length > 0),
    questScript: {
      mainObjectives: contextRows(questScript.mainObjectiveScripts)
        .filter(script => activeObjectiveKeys.has(contextText(script.objectiveKey, 200)))
        .map(projectMainScript),
      side: contextRows(questScript.sideQuestScripts)
        .filter(script => sideEntryKeys.has(contextText(script.entryKey, 200)))
        .map(projectSupplementalScript),
      ambient: contextRows(questScript.ambientEventScripts)
        .filter(script => ambientEntryKeys.has(contextText(script.entryKey, 200)))
        .map(projectSupplementalScript),
    },
    dialoguePass: dialoguePass == null ? null : {
      actKey: dialoguePass.actKey,
      summary: contextText(dialoguePass.summary, 240),
      reviewCoverage: {
        reviewedBeatCount: dialogueBeatReviews.length,
        revisedBeatCount: revisedDialogueBeatReviews.length,
        reviewedChoiceCount: dialogueChoiceReviews.length,
        revisedChoiceCount: revisedDialogueChoiceReviews.length,
      },
      characterAssessments: contextRows(dialoguePass.characterAssessments).map(assessment => ({
        characterKey: assessment.characterKey,
        voiceDistinctness: assessment.voiceDistinctness,
        knowledgeBoundary: assessment.knowledgeBoundary,
        notes: contextText(assessment.notes, 120),
      })),
      // The accepted narrative already contains every keep/revise result. Repeating
      // one synthetic "keep" receipt per beat can consume thousands of tokens in
      // a commercial-length act without adding review evidence. Preserve exact
      // coverage counts and only project the independently evidenced revisions.
      flaggedBeatReviews: revisedDialogueBeatReviews.map(review => ({
        beatKey: review.beatKey,
        speakerKey: review.speakerKey,
        issueTags: review.issueTags,
        rationale: contextText(review.rationale, 120),
      })),
      flaggedChoiceReviews: revisedDialogueChoiceReviews.map(review => ({
        choiceKey: review.choiceKey,
        issueTags: review.issueTags,
        rationale: contextText(review.rationale, 120),
      })),
    },
    projectionPolicy: {
      referenceDetail: 'bounded-contract-projection',
      playerVisibleBeatText: scope === 'structure'
        ? 'one-beat-sample-per-node'
        : 'all-accepted-beats-without-node-summary-duplication',
      routeEchoProjection: 'edge-authority-plus-primary-compiled-success-echo',
      castProjection: scope === 'structure'
        ? 'all-cast'
        : 'active-scene-ending-speakers',
      runtimeChoiceAuthority: 'displayConditionJson+availableConditionJson+effectsJson',
    },
    narrative: {
      entryNodeKey,
      beatColumns: ['beatKey', 'order', 'kind', 'speakerKey', 'text'],
      nodes: narrativeNodes,
      choices: (scope === 'structure' ? allChoices : activeChoices).map(projectChoice),
    },
    systems: {
      abilities: contextRows(productModule.abilities).map(item => ({
        key: item.key, title: item.title, role: item.role,
        initial: item.initial, minimum: item.minimum, maximum: item.maximum,
      })),
      resources: contextRows(productModule.resources).map(item => ({
        key: item.key, title: item.title, role: item.role,
        initial: item.initial, minimum: item.minimum, maximum: item.maximum,
      })),
    },
    supplementalContent: scope === 'structure' ? {
      sideQuestCount: allSideEntries.length,
      ambientEventCount: allAmbientEntries.length,
      sideQuestKeys: structureSideEntryKeys,
      ambientEventKeys: structureAmbientEntryKeys,
      stageKeys: structureSupplementalStageKeys,
    } : {
      sideQuests: sideEntries.map(projectSupplementalEntry),
      ambientEvents: ambientEntries.map(projectSupplementalEntry),
    },
    authorityBoundary: {
      modelMay: ['score only the fixed applicable dimensions', 'identify evidenced issues', 'recommend repairs'],
      modelMayNot: [
        'change story or runtime state', 'invent stable keys or field ownership',
        'perform prompt-security classification', 'approve or publish the Build',
      ],
    },
  }
  const serialized = JSON.stringify(packet)
  const estimatedTokens = estimateTokens(serialized)
  if (estimatedTokens > 31_500) {
    const sectionTokens: Record<string, number> = Object.fromEntries(Object.entries(packet).map(([key, value]) => [
      key,
      estimateTokens(JSON.stringify(value)),
    ]))
    sectionTokens['narrative.nodes'] = estimateTokens(JSON.stringify(packet.narrative.nodes))
    sectionTokens['narrative.choices'] = estimateTokens(JSON.stringify(packet.narrative.choices))
    sectionTokens['questScript.mainObjectives'] = estimateTokens(JSON.stringify(packet.questScript.mainObjectives))
    sectionTokens['questScript.side'] = estimateTokens(JSON.stringify(packet.questScript.side))
    sectionTokens['questScript.ambient'] = estimateTokens(JSON.stringify(packet.questScript.ambient))
    throw new Error(
      `[product-production-context] 文字冒险质量审查 ${scope} 投影超过登记预算:${estimatedTokens}/31500 sections=${JSON.stringify(sectionTokens)}`,
    )
  }
  return serialized
}

/**
 * Evidence packet for the independent Playtest Director. Runtime content is
 * projected to measurable surfaces; the full package remains authoritative in
 * the accepted Artifact and is never copied into the model prompt wholesale.
 */
export async function readTextAdventurePlaytestInputsV1(input: AssembleContextInput): Promise<string> {
  if (input.productProductionTaskKey !== 'qa.playtest-strategy') {
    throw new Error('[product-production-context] 试玩策略投影缺少精确 taskKey')
  }
  const requiredKeys = ['runtime.package', 'quality.autoplay', 'quality.report']
  const { build, rows, payloadByKey } = await requiredContextArtifactsV1(input, {
    label: '文字冒险试玩策略投影', requiredKeys,
  })
  const runtimePackage = payloadByKey.get('runtime.package') ?? {}
  const narrative = contextRecord(runtimePackage.narrative)
  const adventure = contextRecord(runtimePackage.adventure)
  const interaction = contextRecord(runtimePackage.interaction)
  const presentation = contextRecord(runtimePackage.presentation)
  const autoplay = payloadByKey.get('quality.autoplay') ?? {}
  const quality = payloadByKey.get('quality.report') ?? {}
  const packet = {
    schema: 'storyforge.text-adventure-playtest-inputs', version: 1,
    buildNumber: build.buildNumber,
    sources: rows.map(row => ({ artifactKey: row.artifactKey, contentHash: row.contentHash }))
      .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey)),
    package: {
      productType: runtimePackage.productType,
      title: contextRecord(runtimePackage.definition).title,
      nodeCount: contextRows(narrative.nodes).length,
      beatCount: contextRows(narrative.beats).length,
      dialogueTurnCount: contextRows(narrative.beats).filter(beat => beat.kind === 'dialogue').length,
      choiceCount: contextRows(narrative.choices).length,
      locationCount: contextRows(adventure.locations).length,
      actionCount: contextRows(adventure.actions).length,
      questCount: contextRows(adventure.quests).length,
      endingCount: contextRows(adventure.endings).length,
      npcCount: contextRows(interaction.profiles).filter(profile => profile.participantKey !== 'player').length,
      mediaAssetCount: contextRows(presentation.assets).length,
      textFallback: contextRecord(adventure.media).fallback,
    },
    autoplay,
    quality,
    authorityBoundary: {
      deterministicEvidence: ['quality.autoplay', 'quality.report'],
      stillRequired: [
        'real browser performance receipt', 'author-confirmed main route playthrough receipt',
        'media runtime receipt when media exists', 'independent player timed playthrough',
        'export/import/delete lifecycle E2E',
      ],
      prohibition: 'Playtest Director 不得把模型意见写成 release-ready，也不得伪造尚未执行的回执。',
    },
  }
  const serialized = JSON.stringify(packet)
  const estimatedTokens = estimateTokens(serialized)
  if (estimatedTokens > 8_000) {
    throw new Error(`[product-production-context] 试玩策略投影超过登记预算:${estimatedTokens}/8000`)
  }
  return serialized
}

/**
 * Exact, bounded feedback from the previous failed quality gate. It is exposed
 * only while resolving that blocker and remains a read-only historical input;
 * the repaired Artifact must still pass its normal parser and quality gate.
 */
export async function readTextAdventureRepairFeedbackV1(input: AssembleContextInput): Promise<string> {
  const { production, build } = await productionAndBuild(input)
  if (!build) throw new Error('[product-production-context] 文字冒险修复反馈需要 productBuildId')
  const pending = [contextRecord(JSON.parse(build.failureJson))]
  const visitedFailures = new Set<Record<string, unknown>>()
  let failure: Record<string, unknown> | null = null
  const taskFailures = new Map<string, {
    taskKey: string
    code: string
    attempt: number | null
    detail: string
    controlEpoch?: number
  }>()
  // `taskFailures` can contain one entry per professional task. Count visited
  // nodes, not tree depth, and prioritize the causal chain so a large sibling
  // map cannot starve the quality-review failure that authorized this repair.
  for (let visited = 0; visited < 128 && pending.length > 0; visited += 1) {
    const current = pending.shift()!
    if (visitedFailures.has(current)) continue
    visitedFailures.add(current)
    if (typeof current.taskKey === 'string'
      && (current.taskKey.startsWith('content.') || current.taskKey === 'integration.narrative')
      && typeof current.detail === 'string' && current.detail.trim()
      && !taskFailures.has(current.taskKey)) {
      // The queue visits the direct/current causal chain before the older
      // sibling history. Keep the first failure for a task so a deeper epoch
      // cannot overwrite the blocker that actually authorized this repair.
      taskFailures.set(current.taskKey, {
        taskKey: contextText(current.taskKey, 120), code: contextText(current.code, 80),
        attempt: Number.isInteger(current.attempt) ? Number(current.attempt) : null,
        detail: contextFailureDetail(current.detail),
      })
    }
    if (current.taskKey === 'integration.package'
      && typeof current.detail === 'string'
      && current.detail.includes('文字冒险叙事质量审查未通过')) {
      if (!failure) failure = current
    }
    for (const key of ['repairCause', 'previousFailure']) {
      const nested = contextRecord(current[key])
      if (Object.keys(nested).length > 0) pending.unshift(nested)
    }
    const recordedFailures = contextRecord(current.taskFailures)
    for (const nested of Object.values(recordedFailures)) {
      const row = contextRecord(nested)
      if (Object.keys(row).length > 0) pending.push(row)
    }
  }
  const reviews = (failure || ['producing', 'paused'].includes(production.status))
    ? (await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray())
    .filter(row => row.artifactKey === 'quality.adventure-review'
      && row.controlEpoch < build.controlEpoch)
    .sort((left, right) => right.controlEpoch - left.controlEpoch || right.version - left.version)
    : []
  // Pause/resume intentionally wraps build.failureJson in a durable
  // user-paused/user-resumed receipt. The latest signed aggregate review in
  // the same Build remains the
  // durable cause for already-invalidated repair tasks; recover it instead of
  // silently reverting to an unscoped full rewrite. Only the newest review is
  // eligible, so an older failure can never override a later passing review.
  const latestReview = reviews[0]
  const review = latestReview
    && contextRecord(JSON.parse(latestReview.payloadJson)).passed === false
    ? latestReview : undefined
  if (!failure && taskFailures.size === 0 && !review) return ''
  const payload = review ? contextRecord(JSON.parse(review.payloadJson)) : {}
  const reviewEvidenceInvalid = textAdventureQualityReviewAuthorityViolationsV1(payload.issues).length > 0
    || textAdventureQualityReviewScopeViolationsV1(payload.issues).length > 0
  const latestArtifacts = new Map<string, {
    artifactKey: string
    version: number
    controlEpoch: number
    contentHash: string
    payload: unknown
  }>()
  const reviewedControlEpoch = review?.controlEpoch ?? Math.max(0, build.controlEpoch - 1)
  for (const row of (await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray())
    .filter(row => row.controlEpoch <= reviewedControlEpoch
      // `ensurePlan` invalidates stale descendants before the first repair
      // Agent assembles context. Historical status therefore cannot tell us
      // whether the signed review actually consumed this row; the frozen
      // epoch + hashes are the durable provenance boundary.
      && (row.status === 'accepted' || row.status === 'carried-forward' || row.status === 'invalid')
      && isSha256Hash(row.contentHash) && isSha256Hash(row.producerReceiptHash))
    .sort((left, right) => left.controlEpoch - right.controlEpoch || left.version - right.version)) {
    latestArtifacts.set(row.artifactKey, {
      artifactKey: row.artifactKey,
      version: row.version,
      controlEpoch: row.controlEpoch,
      contentHash: row.contentHash,
      payload: JSON.parse(row.payloadJson),
    })
  }
  if (taskFailures.size > 0) {
    const runEvidence = (await db.agentRuns.where('productBuildId').equals(build.id!).toArray())
      .flatMap(row => {
        if (!row.id || !row.parentRelation?.startsWith('task:')) return []
        let controlEpoch: number | null = null
        let contractTaskKey: string | null = null
        let attempt: number | null = null
        let errors: string[] = []
        try {
          const contract = contextRecord(JSON.parse(row.contractJson))
          const scope = contextRecord(contextRecord(contract.scope).productProduction)
          controlEpoch = Number.isInteger(scope.controlEpoch) ? Number(scope.controlEpoch) : null
          contractTaskKey = typeof scope.taskKey === 'string' ? scope.taskKey : null
          const projection = contextRecord(JSON.parse(row.projectionJson))
          errors = Array.isArray(projection.errors)
            ? projection.errors.filter((value): value is string => typeof value === 'string')
            : []
          const step = contextRecord(contextRecord(projection.steps)[contractTaskKey ?? ''])
          attempt = Number.isInteger(step.attempt) ? Number(step.attempt) : null
        } catch {
          return []
        }
        const taskKey = row.parentRelation.slice('task:'.length)
        if (contractTaskKey !== taskKey || controlEpoch == null) return []
        return [{ runId: row.id, taskKey, controlEpoch, attempt, errors, updatedAt: row.updatedAt }]
      })
    const runById = new Map(runEvidence.map(row => [row.runId, row]))
    const failedAttempts = (() => {
      try {
        const ledger = contextRecord(JSON.parse(build.budgetLedgerJson))
        return contextRows(ledger.attempts).flatMap(row => (
          row.outcome === 'failed'
          && typeof row.taskKey === 'string'
          && Number.isInteger(row.controlEpoch)
          && Number.isInteger(row.attempt)
          && Number.isInteger(row.runId)
            ? [{
                taskKey: row.taskKey,
                controlEpoch: Number(row.controlEpoch),
                attempt: Number(row.attempt),
                runId: Number(row.runId),
                errorCode: typeof row.errorCode === 'string' ? row.errorCode : null,
              }]
            : []
        ))
      } catch {
        return []
      }
    })()
    for (const failure of taskFailures.values()) {
      const attempts = failedAttempts.filter(attempt => (
        attempt.taskKey === failure.taskKey
        && (failure.attempt == null || attempt.attempt === failure.attempt)
        && (!failure.code || attempt.errorCode === failure.code)
      ))
      const exactAttempts = attempts.map(attempt => {
        const run = runById.get(attempt.runId)
        const detailMatch = run?.errors.some(error => (
            error.includes(failure.detail) || failure.detail.includes(error)
        )) ?? false
        return { ...attempt, detailMatch }
      }).sort((left, right) => Number(right.detailMatch) - Number(left.detailMatch)
        || right.controlEpoch - left.controlEpoch)
      const matchedAttempt = exactAttempts.find(candidate => candidate.detailMatch)
        ?? (exactAttempts.length === 1 ? exactAttempts[0] : undefined)
      if (matchedAttempt) {
        failure.controlEpoch = matchedAttempt.controlEpoch
        continue
      }
      const runCandidates = runEvidence.filter(run => run.taskKey === failure.taskKey)
        .map(run => ({
          ...run,
          detailMatch: run.errors.some(error => (
            error.includes(failure.detail) || failure.detail.includes(error)
          )),
          attemptMatch: failure.attempt != null && run.attempt === failure.attempt,
        }))
        .sort((left, right) => Number(right.detailMatch) - Number(left.detailMatch)
          || Number(right.attemptMatch) - Number(left.attemptMatch)
          || right.updatedAt - left.updatedAt)
      const matchedRun = runCandidates.find(candidate => candidate.detailMatch)
      if (matchedRun) failure.controlEpoch = matchedRun.controlEpoch
    }
  }
  const scenePartArtifacts = [...latestArtifacts.values()].filter(row => (
    /^content\.scene-script\.act-[1-3]\.part-\d+$/.test(row.artifactKey)
  ))
  const scenePartTaskKeys = scenePartArtifacts.map(row => row.artifactKey)
  const dialoguePassTaskKeys = [
    'content.dialogue-pass.act-1', 'content.dialogue-pass.act-2', 'content.dialogue-pass.act-3',
  ]
  const questScriptPartTaskKeys = [...latestArtifacts.keys()].filter(key => (
    /^content\.quest-script\.(?:main\.act-[1-3]\.(?:single|multi)|supplemental)$/.test(key)
  ))
  const knownScenePartChoiceKeys = new Set(scenePartArtifacts.flatMap(row => (
    contextRows(contextRecord(row.payload).choices)
      .flatMap(choice => typeof choice.choiceKey === 'string' ? [choice.choiceKey] : [])
  )))
  const knownScenePartSceneKeys = new Set(scenePartArtifacts.flatMap(row => (
    contextRows(contextRecord(row.payload).scenes)
      .flatMap(scene => typeof scene.sceneKey === 'string' ? [scene.sceneKey] : [])
  )))
  const knownScenePartEndingKeys = new Set(scenePartArtifacts.flatMap(row => (
    contextRows(contextRecord(row.payload).endings)
      .flatMap(ending => typeof ending.endingKey === 'string' ? [ending.endingKey] : [])
  )))
  const knownQuestScriptStableKeys = new Set(questScriptPartTaskKeys.flatMap(taskKey => {
    const row = latestArtifacts.get(taskKey)
    return row ? [...JSON.stringify(row.payload).matchAll(
      /"(?:objectiveKey|alternativeKey|entryKey|stageKey)":"((?:objective|alternative|entry|stage)\.[A-Za-z0-9._:-]+)"/g,
    )].map(match => match[1]) : []
  }))
  const narrativeRepairTaskKeys = (issue: Record<string, unknown>): string[] => {
    const detail = contextText(issue.detail, 1_000)
    const recommendation = contextText(issue.recommendation, 1_000)
    const evidence = `${detail}\n${recommendation}`
    const choiceKeys = new Set((evidence.match(/choice\.[A-Za-z0-9._:-]+/g) ?? [])
      .map(key => normalizeTextAdventureQualityStableReferenceV1(key, knownScenePartChoiceKeys)))
    const sourceSceneKeys = new Set([...evidence.matchAll(
      /sourceNodeKey\s*(?:=|:)?\s*["']?(scene\.[A-Za-z0-9._:-]+)/g,
    )].map(match => normalizeTextAdventureQualityStableReferenceV1(match[1], knownScenePartSceneKeys)))
    const sceneKeys = new Set((evidence.match(/scene\.[A-Za-z0-9._:-]+/g) ?? [])
      .map(key => normalizeTextAdventureQualityStableReferenceV1(key, knownScenePartSceneKeys)))
    const endingKeys = new Set((evidence.match(/ending\.[A-Za-z0-9._:-]+/g) ?? [])
      .map(key => normalizeTextAdventureQualityStableReferenceV1(key, knownScenePartEndingKeys)))
    const hasChoiceOrEndingIdentity = choiceKeys.size > 0
      || sourceSceneKeys.size > 0 || endingKeys.size > 0
    const matchedParts = scenePartArtifacts.flatMap(row => {
      const part = contextRecord(row.payload)
      const ownsChoice = contextRows(part.choices).some(choice => (
        (typeof choice.choiceKey === 'string' && choiceKeys.has(choice.choiceKey))
        || (typeof choice.sourceNodeKey === 'string' && sourceSceneKeys.has(choice.sourceNodeKey))
      ))
      const ownsScene = contextRows(part.scenes).some(scene => (
        typeof scene.sceneKey === 'string' && sceneKeys.has(scene.sceneKey)
      ))
      const ownsEnding = contextRows(part.endings).some(ending => (
        typeof ending.endingKey === 'string' && endingKeys.has(ending.endingKey)
      ))
      return (hasChoiceOrEndingIdentity ? (ownsChoice || ownsEnding) : ownsScene)
        ? [row.artifactKey] : []
    })
    if (matchedParts.length === 0) {
      if (hasChoiceOrEndingIdentity || sceneKeys.size > 0) return []
      return textAdventureQualityChoiceCopyOnlyRepairV1(issue)
        ? dialoguePassTaskKeys
        : scenePartTaskKeys
    }
    if (!textAdventureQualityChoiceCopyOnlyRepairV1(issue)) return matchedParts
    return [...new Set(matchedParts.flatMap(taskKey => {
      const match = /^content\.scene-script\.act-([1-3])\.part-\d+$/.exec(taskKey)
      return match ? [`content.dialogue-pass.act-${match[1]}`] : []
    }))]
  }
  const repairTaskKeysForIssue = (issue: Record<string, unknown>): string[] => {
    const ownerArtifactKey = textAdventureQualityIssueOwnerArtifactKeyV1(issue)
    if (ownerArtifactKey === 'content.narrative-arc-plan') {
      return textAdventureQualityArcRepairTaskKeysV1(issue)
    }
    if (ownerArtifactKey === 'content.narrative') return narrativeRepairTaskKeys(issue)
    const actMatch = /^content\.scene-script\.act-([1-3])$/.exec(ownerArtifactKey)
    if (actMatch) {
      const exact = narrativeRepairTaskKeys(issue).filter(key => key.startsWith(`${ownerArtifactKey}.part-`))
      return exact.length > 0 ? exact : scenePartTaskKeys.filter(key => key.startsWith(`${ownerArtifactKey}.part-`))
    }
    if (ownerArtifactKey === 'content.quest-script') {
      const evidence = `${contextText(issue.detail, 1_000)}\n${contextText(issue.recommendation, 1_000)}`
      const stableKeys = new Set((evidence.match(
        /(?:objective|alternative|entry|stage)\.[A-Za-z0-9._:-]+/g,
      ) ?? []).map(key => normalizeTextAdventureQualityStableReferenceV1(
        key, knownQuestScriptStableKeys,
      )))
      const exact = stableKeys.size === 0 ? [] : [...latestArtifacts.values()].flatMap(row => {
        if (!questScriptPartTaskKeys.includes(row.artifactKey)) return []
        const serialized = JSON.stringify(row.payload)
        return [...stableKeys].some(key => serialized.includes(`"${key}"`)) ? [row.artifactKey] : []
      })
      return exact.length > 0 ? exact : questScriptPartTaskKeys
    }
    return ownerArtifactKey ? [ownerArtifactKey] : []
  }
  const targetTaskKey = input.productProductionTaskKey ?? null
  const reviewScores = contextRecord(payload.scores)
  const failedByScore = Object.values(reviewScores).some(score => (
    typeof score === 'number' && Number.isFinite(score) && score < 3
  ))
  // A batch can fail deterministically because a score is below three even
  // when the reviewer classified its concrete evidence as warning. In that
  // case, forwarding only blocking issues creates an impossible repair loop:
  // the owning Agent never sees the evidence that explains the failing score.
  // Preserve the existing `blockingIssues` wire name for compatibility, but
  // include all actionable review evidence whenever the aggregate failed by
  // score.
  const reviewedArcPlan = latestArtifacts.get('content.narrative-arc-plan')?.payload
  const reviewedNarrative = latestArtifacts.get('content.narrative')?.payload
  const providerReviewBlockingIssues = (reviewEvidenceInvalid ? [] : contextRows(payload.issues))
    .filter(issue => issue.severity === 'blocking' || failedByScore)
    .filter(issue => !isTextAdventureRecomputedQualityIssueV1(issue))
    // Older reviews could see authored echoSceneKeys but not the exact
    // condition-gated action text because RuntimePackage is assembled later.
    // The compiler and v3 quality projection now share one pure echo builder;
    // when both routes are provably gated into the complained-of scene, rerun
    // the reviewer against that new evidence instead of rewriting the story or
    // decision plan from a stale “echo absent” claim.
    .filter(issue => !textAdventureQualityIssueSupersededByCompiledEchoV1(issue, reviewedArcPlan))
    .filter(issue => textAdventureQualityIssueFrozenBeatContradictionV1(issue, reviewedNarrative) == null)
    .slice(0, 40)
    .map(issue => {
      const ownerArtifactKey = contextText(textAdventureQualityIssueOwnerArtifactKeyV1(issue), 120)
      return {
        artifactKey: ownerArtifactKey,
        ownerArtifactKey,
        severity: contextText(issue.severity, 16),
        repairTaskKeys: repairTaskKeysForIssue(issue),
        detail: contextText(issue.detail, 240),
        recommendation: contextText(textAdventureQualityExecutableRecommendationV1(issue), 360),
      }
    })
    .filter(issue => targetTaskKey == null || issue.repairTaskKeys.includes(targetTaskKey))
  const perspectiveBlockingIssues = textAdventurePlayerPerspectiveIssuesV1(
    reviewedNarrative,
    latestArtifacts.get('content.cast-bible')?.payload,
    latestArtifacts.get('content.adventure-architecture')?.payload,
  ).map(issue => {
    const ownerArtifactKey = contextText(textAdventureQualityIssueOwnerArtifactKeyV1(issue), 120)
    return {
      artifactKey: ownerArtifactKey,
      ownerArtifactKey,
      severity: issue.severity,
      repairTaskKeys: repairTaskKeysForIssue(issue),
      detail: contextText(issue.detail, 2_000),
      recommendation: contextText(issue.recommendation, 500),
    }
  }).filter(issue => targetTaskKey == null || issue.repairTaskKeys.includes(targetTaskKey))
  const kinshipBlockingIssues = textAdventureUnauthorizedKinshipIssuesV1(
    reviewedNarrative,
    latestArtifacts.get('content.cast-bible')?.payload,
  ).map(issue => {
    const ownerArtifactKey = contextText(textAdventureQualityIssueOwnerArtifactKeyV1(issue), 120)
    return {
      artifactKey: ownerArtifactKey,
      ownerArtifactKey,
      severity: issue.severity,
      repairTaskKeys: repairTaskKeysForIssue(issue),
      detail: contextText(issue.detail, 2_000),
      recommendation: contextText(issue.recommendation, 500),
    }
  }).filter(issue => targetTaskKey == null || issue.repairTaskKeys.includes(targetTaskKey))
  const dialogueAttributionBlockingIssues = textAdventureDialogueAttributionIssuesV1(
    reviewedNarrative,
    latestArtifacts.get('content.cast-bible')?.payload,
  ).map(issue => {
    const ownerArtifactKey = contextText(textAdventureQualityIssueOwnerArtifactKeyV1(issue), 120)
    return {
      artifactKey: ownerArtifactKey,
      ownerArtifactKey,
      severity: issue.severity,
      repairTaskKeys: repairTaskKeysForIssue(issue),
      detail: contextText(issue.detail, 2_000),
      recommendation: contextText(issue.recommendation, 800),
    }
  }).filter(issue => targetTaskKey == null || issue.repairTaskKeys.includes(targetTaskKey))
  const sceneSpeakerAuthorityBlockingIssues = textAdventureSceneSpeakerAuthorityIssuesV1(
    reviewedNarrative,
    reviewedArcPlan,
    latestArtifacts.get('content.cast-bible')?.payload,
  ).map(issue => {
    const ownerArtifactKey = contextText(textAdventureQualityIssueOwnerArtifactKeyV1(issue), 120)
    return {
      artifactKey: ownerArtifactKey,
      ownerArtifactKey,
      severity: issue.severity,
      repairTaskKeys: repairTaskKeysForIssue(issue),
      detail: contextText(issue.detail, 2_000),
      recommendation: contextText(issue.recommendation, 1_000),
    }
  }).filter(issue => targetTaskKey == null || issue.repairTaskKeys.includes(targetTaskKey))
  const reviewedArchitecture = contextRecord(
    latestArtifacts.get('content.adventure-architecture')?.payload,
  )
  const reviewedLocationTitles = contextRows(reviewedArchitecture.regions).flatMap(region => (
    contextRows(region.areas).flatMap(area => contextRows(area.locations).flatMap(location => (
      typeof location.title === 'string' ? [location.title] : []
    )))
  ))
  const questLocationAuthorityBlockingIssues = textAdventureQuestLocationAuthorityIssuesV1(
    latestArtifacts.get('content.main-quest-plan')?.payload,
    reviewedLocationTitles,
  ).map(issue => {
    const ownerArtifactKey = contextText(textAdventureQualityIssueOwnerArtifactKeyV1(issue), 120)
    return {
      artifactKey: ownerArtifactKey,
      ownerArtifactKey,
      severity: issue.severity,
      repairTaskKeys: repairTaskKeysForIssue(issue),
      detail: contextText(issue.detail, 2_000),
      recommendation: contextText(issue.recommendation, 1_000),
    }
  }).filter(issue => targetTaskKey == null || issue.repairTaskKeys.includes(targetTaskKey))
  const languageBlockingIssues = groupTextAdventurePlayerVisibleLanguageIssuesV1(
    findTextAdventurePlayerVisibleLanguageIssuesV1([...latestArtifacts.values()]),
  )
    .map(issue => {
      const repairIssue = {
        artifactKey: contextText(issue.artifactKey, 120),
        detail: contextText(
        `玩家可见字段混入未本地化词 ${issue.tokens.join('、')}；位置：${issue.examples.map(example => example.path).join('、')}`,
        240,
        ),
        recommendation: '保持稳定 key 和叙事含义，将混入的外语单词改成自然、完整的简体中文。',
      }
      const ownerArtifactKey = contextText(textAdventureQualityIssueOwnerArtifactKeyV1(repairIssue), 120)
      return {
        ...repairIssue, ownerArtifactKey,
        repairTaskKeys: repairTaskKeysForIssue(repairIssue),
      }
    })
    .filter(issue => targetTaskKey == null || issue.repairTaskKeys.includes(targetTaskKey))
  const blockingIssues = [...new Map([
    ...providerReviewBlockingIssues,
    ...perspectiveBlockingIssues,
    ...kinshipBlockingIssues,
    ...dialogueAttributionBlockingIssues,
    ...sceneSpeakerAuthorityBlockingIssues,
    ...questLocationAuthorityBlockingIssues,
    ...languageBlockingIssues,
  ].map(issue => [
    `${issue.ownerArtifactKey}\n${issue.detail}\n${issue.recommendation}`, issue,
  ] as const)).values()].slice(0, 40)
  if (blockingIssues.length === 0 && taskFailures.size === 0) return ''
  const baselineArtifact = targetTaskKey == null ? null : latestArtifacts.get(targetTaskKey) ?? null
  return JSON.stringify({
    schema: 'storyforge.text-adventure-repair-feedback', version: 1,
    targetTaskKey,
    source: review ? {
      artifactKey: review.artifactKey, artifactVersion: review.version,
      contentHash: review.contentHash, producerReceiptHash: review.producerReceiptHash,
      controlEpoch: review.controlEpoch,
    } : null,
    instruction: 'blockingIssues 已按 repairTaskKeys 精确投影给 targetTaskKey；只修复当前任务实际拥有的字段和 lastTaskFailures 中同 taskKey 的协议错误。ownerArtifactKey 是对外聚合工件，repairTaskKeys 才是专业返修职责。baselineArtifact 是上一轮已验收的完整本任务工件。分场质量返修使用执行器声明的精确字段补丁协议，由规则层合并底稿；补丁协议错误仍继续提交补丁，只有正文体量、图结构、身份或结局覆盖等底稿结构错误才提交完整工件。两种模式都必须保持冻结 Brief、架构、稳定 key 与未受影响内容。',
    baselineArtifact: baselineArtifact == null ? null : {
      artifactKey: baselineArtifact.artifactKey,
      artifactVersion: baselineArtifact.version,
      controlEpoch: baselineArtifact.controlEpoch,
      contentHash: baselineArtifact.contentHash,
      payload: baselineArtifact.payload,
    },
    scores: payload.scores,
    blockingIssues,
    lastTaskFailures: [...taskFailures.values()].sort((left, right) => left.taskKey.localeCompare(right.taskKey)),
  })
}

export async function readProductProductionQualityFeedback(input: AssembleContextInput): Promise<string> {
  const { build } = await productionAndBuild(input)
  if (!build) throw new Error('[product-production-context] quality feedback 需要 productBuildId')
  const requested = new Set(input.productArtifactKeys ?? [])
  const artifacts = requested.size === 0 ? [] : (await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray())
    .filter(row => requested.has(row.artifactKey))
    .map(row => ({ artifactKey: row.artifactKey, contentHash: row.contentHash, quality: JSON.parse(row.qualityJson) }))
  return JSON.stringify({
    schema: 'storyforge.product-production.quality-feedback', version: 1,
    buildNumber: build.buildNumber, qualityReportHash: build.qualityReportHash,
    qualityReport: JSON.parse(build.qualityReportJson), artifacts,
  })
}

/** Last rejected draft for this exact Build/task, never another product or a live world read. */
export async function readProductProductionRepairFeedback(input: AssembleContextInput): Promise<string> {
  const { scope, build } = await productionAndBuild(input)
  if (!build || !input.productProductionTaskKey) throw new Error('[product-production-context] 修复反馈需要 Build 与 task key')
  const resolution = JSON.parse(build.failureJson).resolution
  const authorRepairNote = typeof resolution?.note === 'string' ? resolution.note : null
  const authorDraftJson = resolution?.action === 'author-edit' && typeof resolution.authorDraftJson === 'string' ? resolution.authorDraftJson : null
  const runs = (await db.agentRuns.where('productBuildId').equals(build.id!).toArray())
    .filter(run => run.status === 'failed' && run.parentRelation === `task:${input.productProductionTaskKey}`)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  if (!runs.length) return JSON.stringify({ schema: 'storyforge.product-production.repair-feedback', version: 1, authorRepairNote, authorDraftJson, previous: null })
  const snapshot = await readAgentRunV1(scope, runs[0].id!)
  const boundary = snapshot.contract.scope.productProduction
  if (!boundary || boundary.productBuildId !== build.id || boundary.taskKey !== input.productProductionTaskKey)
    throw new Error('[product-production-context] 修复草稿与 Build/task 不一致')
  const events = snapshot.events.filter(event => event.type === 'evidence.artifact.recorded'
    && event.payload.stepId === input.productProductionTaskKey
    && ['raw-response', 'tool-result'].includes(event.payload.artifactKind))
  const latestAttempt = Math.max(0, ...events.map(event => event.type === 'evidence.artifact.recorded' ? event.payload.attempt ?? 0 : 0))
  const evidence = []
  for (const event of events) {
    if (event.type !== 'evidence.artifact.recorded' || event.payload.attempt !== latestAttempt) continue
    evidence.push({ kind: event.payload.artifactKind, contentHash: event.payload.contentHash,
      content: await readAgentRunArtifactExactV1({ projectId: scope.projectId,
        artifactKind: event.payload.artifactKind, contentHash: event.payload.contentHash }) })
  }
  return JSON.stringify({ schema: 'storyforge.product-production.repair-feedback', version: 1,
    taskKey: input.productProductionTaskKey, authorRepairNote, authorDraftJson, previous: { runId: snapshot.run.id,
      contractHash: snapshot.run.contractHash, controlEpoch: boundary.controlEpoch, attempt: latestAttempt, evidence } })
}

export async function readProductProductionEvolutionBase(input: AssembleContextInput): Promise<string> {
  const { production, build } = await productionAndBuild(input)
  if (!build) throw new Error('[product-production-context] evolution base 需要 productBuildId')
  if (!['preview-ready', 'release-ready', 'released'].includes(build.status)) {
    throw new Error('[product-production-context] evolution base 必须是冻结可玩 Build')
  }
  return JSON.stringify({
    schema: 'storyforge.product-production.evolution-base', version: 1,
    productionKey: production.productionKey, buildNumber: build.buildNumber,
    manifestHash: build.manifestHash, packageHash: build.packageHash, previewHash: build.previewHash,
    manifest: JSON.parse(build.manifestJson), compatibility: JSON.parse(build.compatibilityJson),
  })
}
