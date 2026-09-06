import { db } from '../db/schema'
import { estimateTokens } from '../ai/context-budget'
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
    'content.dialogue-pass', 'content.narrative', 'content.product-module',
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
  const dialoguePass = payloadByKey.get('content.dialogue-pass') ?? {}
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
    objective: contextText(entry.objective, 140),
    locationOrdinal: entry.locationOrdinal,
    success: contextText(entry.successText, 120),
    costlySuccess: contextText(entry.costlySuccessText, 120),
    failure: contextText(entry.failureText, 120),
    abilityKey: contextText(entry.abilityKey, 120),
    difficulty: entry.difficulty,
    rewardExperience: entry.rewardExperience,
    rewardCurrency: entry.rewardCurrency,
    timeCostMinutes: entry.timeCostMinutes,
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
        entryKey: script.entryKey, actionKind: script.actionKind, abilityKey: script.abilityKey,
        difficulty: script.difficulty, timeCostMinutes: script.timeCostMinutes,
      })),
      ambient: contextRows(questScript.ambientEventScripts).map(script => ({
        entryKey: script.entryKey, actionKind: script.actionKind, abilityKey: script.abilityKey,
        difficulty: script.difficulty, timeCostMinutes: script.timeCostMinutes,
      })),
    },
    dialoguePass: {
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
    },
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
  if (estimatedTokens > 15_750) {
    throw new Error(`[product-production-context] 文字冒险质量审查投影超过登记预算:${estimatedTokens}/15750，必须拆分生产内容后再审查`)
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
  const blockingIssues = contextRows(payload.issues)
    .filter(issue => issue.severity === 'blocking')
    .slice(0, 5)
    .map(issue => ({
      artifactKey: contextText(issue.artifactKey, 120),
      detail: contextText(issue.detail, 240),
      recommendation: contextText(issue.recommendation, 240),
    }))
  if (blockingIssues.length === 0 && taskFailures.size === 0) return ''
  return JSON.stringify({
    schema: 'storyforge.text-adventure-repair-feedback', version: 1,
    source: review ? {
      artifactKey: review.artifactKey, artifactVersion: review.version,
      contentHash: review.contentHash, producerReceiptHash: review.producerReceiptHash,
      controlEpoch: review.controlEpoch,
    } : null,
    instruction: '只修复与当前任务输出对应的 blocking 问题和 lastTaskFailures 中同 taskKey 的精确协议错误；保持冻结 Brief、架构、稳定 key 与未受影响内容。',
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
