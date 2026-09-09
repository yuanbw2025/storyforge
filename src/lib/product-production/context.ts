import { db } from '../db/schema'
import { estimateTokens } from '../ai/context-budget'
import {
  findTextAdventurePlayerVisibleLanguageIssuesV1,
  groupTextAdventurePlayerVisibleLanguageIssuesV1,
} from '../adventure/language-quality'
import type { WorkspaceScope } from '../types'
import type { AssembleContextInput } from '../registry/types'
import { assertRecordInScope } from '../workspace/scope'

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
  const { production } = await productionAndBuild(input)
  if (production.currentBriefRevision == null) throw new Error('[product-production-context] Production 尚无当前 Brief')
  const brief = await db.productProductionBriefs
    .where('[productionId+revision]').equals([production.id!, production.currentBriefRevision]).first()
  if (!brief || brief.status !== 'authorized') throw new Error('[product-production-context] 当前 Brief 未授权')
  return JSON.stringify({
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
  const projectSupplemental = (entry: Record<string, unknown>) => ({
    key: entry.key,
    title: entry.title,
    description: contextText(entry.description, 350),
    hook: contextText(entry.hook, 350),
    stages: contextRows(entry.stages).map(stage => ({
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
  const projectSupplementalScript = (script: Record<string, unknown>) => ({
    entryKey: script.entryKey,
    stages: contextRows(script.stages).map(stage => ({
      stageKey: stage.stageKey,
      actionKind: stage.actionKind,
      abilityKey: stage.abilityKey,
      difficulty: stage.difficulty,
      costlySuccessFloor: stage.costlySuccessFloor,
      timeCostMinutes: stage.timeCostMinutes,
      successText: contextText(stage.successText, 300),
      costlySuccessText: contextText(stage.costlySuccessText, 300),
      failureForwardText: contextText(stage.failureForwardText, 300),
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
    sideContent: sideEntries.map(projectSupplemental),
    sideScripts: sideScripts.map(projectSupplementalScript),
    ambientContent: ambientEntries.map(projectSupplemental),
    ambientScripts: ambientScripts.map(projectSupplementalScript),
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
  // The current Plan reserves 18,480 input tokens for each independent
  // Dialogue Editor. Keep the registered source packet below 16,500 so the
  // system contract and provider framing retain roughly 2k tokens of explicit
  // headroom. The former 12,500 ceiling predated that Plan reservation and
  // rejected a valid 60-minute third act even though its role-specific packet
  // stayed inside the durable task budget.
  const maximumDialogueContextTokens = 16_500
  if (estimatedTokens > maximumDialogueContextTokens) {
    throw new Error(`[product-production-context] 第 ${act} 幕对白审校投影超过登记预算:${estimatedTokens}/${maximumDialogueContextTokens}，必须增加更小的有界对白分包计划`)
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
 * Registered, deterministic review projection for the text-adventure quality
 * Agent. The full accepted Artifacts stay authoritative in IndexedDB; this
 * packet keeps every graph edge, target opening and quest location visible
 * inside the bounded model context instead of truncating one large JSON blob.
 */
export async function readTextAdventureQualityInputsV1(input: AssembleContextInput): Promise<string> {
  const { build } = await productionAndBuild(input)
  if (!build) throw new Error('[product-production-context] 文字冒险质量审查需要 productBuildId')
  const requiredKeys = [
    'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
    'content.narrative-arc-plan', 'content.main-quest-plan', 'content.quest-script',
    'content.dialogue-pass.act-1', 'content.dialogue-pass.act-2',
    'content.dialogue-pass.act-3', 'content.narrative', 'content.product-module',
    'content.adventure-side-quests', 'content.adventure-ambient-events',
  ]
  const requested = new Set(input.productArtifactKeys ?? [])
  if (requiredKeys.some(key => !requested.has(key))) {
    throw new Error('[product-production-context] 文字冒险质量审查 Artifact 选择不完整')
  }
  const candidateRows = (await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray())
    .filter(row => requiredKeys.includes(row.artifactKey)
      && (row.status === 'accepted' || row.status === 'carried-forward'))
    .sort((left, right) => left.version - right.version)
  const rowByKey = new Map(candidateRows.map(row => [row.artifactKey, row]))
  const rows = requiredKeys.flatMap(key => {
    const row = rowByKey.get(key)
    return row ? [row] : []
  })
  if (rows.length !== requiredKeys.length) {
    throw new Error('[product-production-context] 文字冒险质量审查 Artifact 缺失或未验收')
  }
  const payloadByKey = new Map(rows.map(row => [row.artifactKey, contextRecord(JSON.parse(row.payloadJson))]))
  const architecture = payloadByKey.get('content.adventure-architecture') ?? {}
  const storyBible = payloadByKey.get('content.story-bible') ?? {}
  const castBible = payloadByKey.get('content.cast-bible') ?? {}
  const arcPlan = payloadByKey.get('content.narrative-arc-plan') ?? {}
  const mainQuestPlan = payloadByKey.get('content.main-quest-plan') ?? {}
  const questScript = payloadByKey.get('content.quest-script') ?? {}
  const dialoguePasses = [1, 2, 3].map(act => payloadByKey.get(`content.dialogue-pass.act-${act}`) ?? {})
  const narrative = payloadByKey.get('content.narrative') ?? {}
  const productModule = payloadByKey.get('content.product-module') ?? {}
  const locations = contextRows(architecture.regions).flatMap(region => (
    contextRows(region.areas).flatMap(area => contextRows(area.locations).map(location => contextText(location.title, 80)))
  )).filter(Boolean)
  const beatsByNode = new Map<string, Record<string, unknown>[]>()
  contextRows(narrative.beats).forEach(beat => {
    const nodeKey = contextText(beat.nodeKey, 200)
    if (!nodeKey) return
    beatsByNode.set(nodeKey, [...(beatsByNode.get(nodeKey) ?? []), beat])
  })
  const nodes = contextRows(narrative.nodes).map(node => {
    const nodeKey = contextText(node.key, 200)
    const beats = (beatsByNode.get(nodeKey) ?? []).sort((left, right) => (
      Number(left.order ?? 0) - Number(right.order ?? 0)
    ))
    return {
      key: nodeKey,
      kind: contextText(node.kind, 40),
      title: contextText(node.title, 80),
      summary: contextText(node.summary, 160),
      openingBeat: contextText(beats[0]?.text, 220),
      beatCount: beats.length,
      beatCharacters: beats.reduce((sum, beat) => sum + (typeof beat.text === 'string' ? beat.text.length : 0), 0),
    }
  })
  const projectQuestBundle = (key: string) => contextRows(payloadByKey.get(key)?.entries).map(entry => ({
    key: contextText(entry.key, 120),
    title: contextText(entry.title, 80),
    description: contextText(entry.description, 180),
    hook: contextText(entry.hook, 140),
    stages: contextRows(entry.stages).map(stage => ({
      key: contextText(stage.key, 120),
      title: contextText(stage.title, 80),
      objective: contextText(stage.objective, 140),
      locationOrdinal: stage.locationOrdinal,
      actionKind: stage.actionKind,
      success: contextText(stage.successText, 120),
      costlySuccess: contextText(stage.costlySuccessText, 120),
      failure: contextText(stage.failureText, 120),
      abilityKey: contextText(stage.abilityKey, 120),
      difficulty: stage.difficulty,
      timeCostMinutes: stage.timeCostMinutes,
    })),
    rewardExperience: entry.rewardExperience,
    rewardCurrency: entry.rewardCurrency,
  }))
  const packet = {
    schema: 'storyforge.text-adventure-quality-inputs', version: 1,
    buildNumber: build.buildNumber,
    sources: rows.map(row => ({ artifactKey: row.artifactKey, contentHash: row.contentHash })).sort((a, b) => (
      a.artifactKey.localeCompare(b.artifactKey)
    )),
    architecture: {
      title: contextText(architecture.title, 120),
      premise: contextText(architecture.premise, 300),
      emotionalPromise: contextText(architecture.emotionalPromise, 240),
      themes: Array.isArray(architecture.themes) ? architecture.themes : [],
      locations,
    },
    storyBible: {
      title: contextText(storyBible.title, 120), premise: contextText(storyBible.premise, 300),
      thematicQuestion: contextText(storyBible.thematicQuestion, 200),
      emotionalPromise: contextText(storyBible.emotionalPromise, 240),
      centralConflict: contextText(storyBible.centralConflict, 300),
      setupPayoffs: contextRows(storyBible.setupPayoffs).map(item => ({
        key: item.key, setup: contextText(item.setup, 160), payoff: contextText(item.payoff, 160),
        introducedAct: item.introducedAct, resolvedAct: item.resolvedAct,
      })),
      endings: contextRows(storyBible.endings).map(item => ({
        key: item.key, title: contextText(item.title, 80),
        dramaticAnswer: contextText(item.dramaticAnswer, 180),
      })),
    },
    cast: contextRows(castBible.characters).map(character => ({
      key: character.key, role: character.role, name: contextText(character.name, 80),
      desire: contextText(character.desire, 140), fear: contextText(character.fear, 140),
      motivation: contextText(character.motivation, 120), voice: contextText(character.voice, 100),
      initialKnowledgeCount: Array.isArray(character.initialKnowledge) ? character.initialKnowledge.length : 0,
      relationshipArc: Array.isArray(character.relationshipArc) ? character.relationshipArc : [],
    })),
    arcPlan: {
      acts: contextRows(arcPlan.acts).map(act => ({
        key: act.key, title: contextText(act.title, 80), targetMinutes: act.targetMinutes,
        goal: contextText(act.goal, 140), irreversibleTurn: contextText(act.irreversibleTurn, 140),
        sceneCards: contextRows(act.sceneCards).map(scene => ({
          key: scene.key, title: contextText(scene.title, 80), locationOrdinal: scene.locationOrdinal,
          castKeys: Array.isArray(scene.castKeys) ? scene.castKeys : [],
          setupKeys: Array.isArray(scene.setupKeys) ? scene.setupKeys : [],
          payoffKeys: Array.isArray(scene.payoffKeys) ? scene.payoffKeys : [],
        })),
      })),
      decisions: contextRows(arcPlan.decisions).map(decision => ({
        key: decision.key, sceneKey: decision.sceneKey, prompt: contextText(decision.prompt, 120),
        options: contextRows(decision.options).map(option => ({
          key: option.key, label: contextText(option.label, 80), cost: contextText(option.cost, 100),
          persistentEffectKey: option.persistentEffectKey,
          echoSceneKeys: Array.isArray(option.echoSceneKeys) ? option.echoSceneKeys : [],
        })),
      })),
    },
    mainQuestPlan: contextRows(mainQuestPlan.quests).map(quest => ({
      key: quest.key, title: contextText(quest.title, 80),
      stages: contextRows(quest.stages).map(stage => ({
        key: stage.key, title: contextText(stage.title, 80),
        objectiveKeys: Array.isArray(stage.objectiveKeys) ? stage.objectiveKeys : [],
      })),
      objectives: contextRows(quest.objectives).map(objective => ({
        key: objective.key, stageKey: objective.stageKey, title: contextText(objective.title, 80),
        sceneKeys: Array.isArray(objective.sceneKeys) ? objective.sceneKeys : [],
        locationOrdinal: objective.locationOrdinal,
        alternatives: contextRows(objective.alternatives).map(alternative => ({
          key: alternative.key, actionKind: alternative.actionKind,
          targetCharacterKey: alternative.targetCharacterKey,
          cost: contextText(alternative.cost, 80),
          success: contextText(alternative.successConsequence, 90),
          failureForward: contextText(alternative.failureForwardConsequence, 90),
        })),
      })),
    })),
    questScript: {
      mainObjectives: contextRows(questScript.mainObjectiveScripts).map(script => ({
        objectiveKey: script.objectiveKey, sceneKey: script.sceneKey,
        alternatives: contextRows(script.alternatives).map(alternative => ({
          alternativeKey: alternative.alternativeKey,
          resolution: alternative.resolution,
          timeCostMinutes: alternative.timeCostMinutes,
          failureForward: contextText(alternative.failureForwardText, 60),
        })),
      })),
      side: contextRows(questScript.sideQuestScripts).map(script => ({
        entryKey: script.entryKey,
        stages: contextRows(script.stages).map(stage => ({
          stageKey: stage.stageKey, actionKind: stage.actionKind, abilityKey: stage.abilityKey,
          difficulty: stage.difficulty, timeCostMinutes: stage.timeCostMinutes,
        })),
      })),
      ambient: contextRows(questScript.ambientEventScripts).map(script => ({
        entryKey: script.entryKey,
        stages: contextRows(script.stages).map(stage => ({
          stageKey: stage.stageKey, actionKind: stage.actionKind, abilityKey: stage.abilityKey,
          difficulty: stage.difficulty, timeCostMinutes: stage.timeCostMinutes,
        })),
      })),
    },
    dialoguePasses: dialoguePasses.map(dialoguePass => ({
      actKey: dialoguePass.actKey,
      summary: contextText(dialoguePass.summary, 300),
      characterAssessments: contextRows(dialoguePass.characterAssessments).map(assessment => ({
        characterKey: assessment.characterKey,
        voiceDistinctness: assessment.voiceDistinctness,
        knowledgeBoundary: assessment.knowledgeBoundary,
        notes: contextText(assessment.notes, 120),
      })),
      dialogueTurnCount: contextRows(dialoguePass.beatReviews).length,
      revisedDialogueCount: contextRows(dialoguePass.beatReviews)
        .filter(review => review.verdict === 'revise').length,
      reviewedChoiceCount: contextRows(dialoguePass.choiceReviews).length,
      revisedChoiceCount: contextRows(dialoguePass.choiceReviews)
        .filter(review => review.verdict === 'revise').length,
    })),
    narrative: {
      entryNodeKey: contextText(narrative.entryNodeKey, 200),
      nodes,
      choices: contextRows(narrative.choices).map(choice => ({
        key: contextText(choice.choiceKey, 120),
        sourceNodeKey: contextText(choice.sourceNodeKey, 120),
        targetNodeKey: contextText(choice.targetNodeKey, 120),
        label: contextText(choice.text ?? choice.label, 140),
        description: contextText(choice.description, 140),
      })),
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
    sideQuests: projectQuestBundle('content.adventure-side-quests'),
    ambientEvents: projectQuestBundle('content.adventure-ambient-events'),
  }
  const serialized = JSON.stringify(packet)
  const estimatedTokens = estimateTokens(serialized)
  if (estimatedTokens > 31_500) {
    throw new Error(`[product-production-context] 文字冒险质量审查投影超过登记预算:${estimatedTokens}/31500，必须拆分审查任务`)
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
  const { build } = await productionAndBuild(input)
  if (!build) throw new Error('[product-production-context] 文字冒险修复反馈需要 productBuildId')
  const pending = [contextRecord(JSON.parse(build.failureJson))]
  let failure: Record<string, unknown> | null = null
  const taskFailures = new Map<string, { taskKey: string; code: string; attempt: number | null; detail: string }>()
  for (let depth = 0; depth < 8 && pending.length > 0; depth++) {
    const current = pending.shift()!
    if (typeof current.taskKey === 'string'
      && (current.taskKey.startsWith('content.') || current.taskKey === 'integration.narrative')
      && typeof current.detail === 'string' && current.detail.trim()) {
      taskFailures.set(current.taskKey, {
        taskKey: contextText(current.taskKey, 120), code: contextText(current.code, 80),
        attempt: Number.isInteger(current.attempt) ? Number(current.attempt) : null,
        detail: contextText(current.detail, 500),
      })
    }
    const recordedFailures = contextRecord(current.taskFailures)
    for (const nested of Object.values(recordedFailures)) {
      const row = contextRecord(nested)
      if (Object.keys(row).length > 0) pending.push(row)
    }
    if (current.taskKey === 'integration.package'
      && typeof current.detail === 'string'
      && current.detail.includes('文字冒险叙事质量审查未通过')) {
      failure = current
      break
    }
    for (const key of ['repairCause', 'previousFailure']) {
      const nested = contextRecord(current[key])
      if (Object.keys(nested).length > 0) pending.push(nested)
    }
  }
  if (!failure && taskFailures.size === 0) return ''
  const reviews = failure ? (await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray())
    .filter(row => row.artifactKey === 'quality.adventure-review'
      && row.controlEpoch < build.controlEpoch)
    .sort((left, right) => right.version - left.version) : []
  const review = reviews.find(row => contextRecord(JSON.parse(row.payloadJson)).passed === false)
  const payload = review ? contextRecord(JSON.parse(review.payloadJson)) : {}
  const reviewBlockingIssues = contextRows(payload.issues)
    .filter(issue => issue.severity === 'blocking')
    .slice(0, 5)
    .map(issue => ({
      artifactKey: contextText(issue.artifactKey, 120),
      detail: contextText(issue.detail, 240),
      recommendation: contextText(issue.recommendation, 240),
    }))
  const latestArtifacts = new Map<string, { artifactKey: string; payload: unknown }>()
  for (const row of (await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray())
    .filter(row => row.controlEpoch < build.controlEpoch
      && (row.status === 'accepted' || row.status === 'carried-forward'))
    .sort((left, right) => left.controlEpoch - right.controlEpoch || left.version - right.version)) {
    latestArtifacts.set(row.artifactKey, { artifactKey: row.artifactKey, payload: JSON.parse(row.payloadJson) })
  }
  const languageBlockingIssues = groupTextAdventurePlayerVisibleLanguageIssuesV1(
    findTextAdventurePlayerVisibleLanguageIssuesV1([...latestArtifacts.values()]),
  )
    .map(issue => ({
      artifactKey: contextText(issue.artifactKey, 120),
      detail: contextText(
        `玩家可见字段混入未本地化词 ${issue.tokens.join('、')}；位置：${issue.examples.map(example => example.path).join('、')}`,
        240,
      ),
      recommendation: '保持稳定 key 和叙事含义，将混入的外语单词改成自然、完整的简体中文。',
    }))
  const blockingIssues = [...reviewBlockingIssues, ...languageBlockingIssues].slice(0, 8)
  if (blockingIssues.length === 0 && taskFailures.size === 0) return ''
  return JSON.stringify({
    schema: 'storyforge.text-adventure-repair-feedback', version: 1,
    targetTaskKey: input.productProductionTaskKey ?? null,
    source: review ? {
      artifactKey: review.artifactKey, artifactVersion: review.version,
      contentHash: review.contentHash, producerReceiptHash: review.producerReceiptHash,
      controlEpoch: review.controlEpoch,
    } : null,
    instruction: '只修复与 targetTaskKey 当前输出相关的 blocking 问题和 lastTaskFailures 中同 taskKey 的精确协议错误；当问题原定位为 content.narrative 时，当前场景/对白任务必须修正其所拥有 scene/choice 的标签、目标节点、地点与开场衔接；保持冻结 Brief、架构、稳定 key 与未受影响内容。',
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
