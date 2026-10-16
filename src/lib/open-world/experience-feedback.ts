import { db } from '../db/schema'
import { assertInstanceBinding } from '../product/runtime-instances'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import type { ProductRuntimeEvent, ProductRuntimeSession, TextOpenWorldSessionProjectionV1, WorkspaceScope } from '../types'
import { parseTextOpenWorldCommandEventPayloadV1 } from './command-contract'
import { parseTextOpenWorldEffectsAppliedEventPayloadV1, replayTextOpenWorldEventProtocolV1 } from './event-contract'
import { parseTextOpenWorldModulesV1 } from './modules'
import { readProductRuntimeState, readProductRuntimeStateVersion } from './runtime-api'
import { readTextOpenWorldIntentObservationsV1 } from './runtime-intent'
import { parseTextOpenWorldSessionProjectionV1 } from './session-projection'

export const TEXT_OPEN_WORLD_FEEDBACK_CATEGORIES_V1 = {
  narrative: '叙事与节奏', quest: '任务与引导', balance: '战斗与成长',
  map: '地图与旅行', 'free-input': '自由输入', repetition: '重复内容',
  media: '画面与声音', accessibility: '界面与无障碍', 'save-recovery': '存档与恢复', other: '其他',
} as const
export type TextOpenWorldFeedbackCategoryV1 = keyof typeof TEXT_OPEN_WORLD_FEEDBACK_CATEGORIES_V1

/** The current branch only: inherited state is not counted as newly played actions. */
export async function projectTextOpenWorldExperienceV1(input: {
  session: ProductRuntimeSession & { id: number }
  projection: TextOpenWorldSessionProjectionV1
  throughSequence: number
  events: ProductRuntimeEvent[]
  intents: Awaited<ReturnType<typeof readTextOpenWorldIntentObservationsV1>>
}) {
  const projection = parseTextOpenWorldSessionProjectionV1(input.projection)
  const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
  const events = [...input.events].sort((a, b) => a.sequence - b.sequence)
  if (input.session.kind !== 'text-open-world' || events.length !== input.throughSequence || projection.lastEventSequence > input.throughSequence
    || events.some((event, index) => event.sessionId !== input.session.id
      || event.projectId !== input.session.projectId || event.sequence !== index + 1)) {
    throw new Error('体验记录尚未与当前存档同步，请刷新后重试')
  }
  await replayTextOpenWorldEventProtocolV1(events, input.session.seed)
  const commands = new Map(events.filter(event => event.type === 'text-open-world.command.committed')
    .map(event => [event.commandId, parseTextOpenWorldCommandEventPayloadV1(JSON.parse(event.payloadJson)).envelope]))
  const accepted = new Set<string>(), completed = new Set<string>(), mainlineCompleted = new Set<string>()
  const questDefinitions = new Map(modules.quests.quests.map(quest => [quest.key, quest]))
  const fingerprints = new Map<string, number>(), sources = new Map<string, number>()
  let abandoned = 0, expired = 0, defeated = 0, escaped = 0, respawned = 0, fastTravel = 0
  let mappedCommands = 0, mainlineSteps = 0
  const mainlineTimes: number[] = []
  const settledCommands: Array<{ baseSequence: number; mainline: boolean }> = []
  for (const event of events) {
    if (event.type !== 'text-open-world.effects.applied') continue
    const payload = parseTextOpenWorldEffectsAppliedEventPayloadV1(JSON.parse(event.payloadJson))
    const command = commands.get(payload.commandId)
    if (command?.source === 'mapped-intent') mappedCommands++
    const authorization = payload.plan.authorization
    let mainline = false
    if (authorization?.kind === 'quest-transition') {
      const isMainline = questDefinitions.get(authorization.definitionKey)?.type === 'mainline'
      for (const transition of authorization.transitions) {
        if (!isMainline && transition.intent === 'accept') accepted.add(authorization.instanceKey)
        if (!isMainline && transition.intent === 'complete') completed.add(authorization.instanceKey)
        if (transition.intent === 'abandon') abandoned++
        if (transition.intent === 'expire') expired++
        if (isMainline && ['accept', 'activate', 'advance-stage', 'complete'].includes(transition.intent)) {
          mainline = true
          mainlineSteps++
          mainlineTimes.push(event.createdAt)
          if (transition.intent === 'complete') mainlineCompleted.add(authorization.instanceKey)
        }
      }
    }
    if (authorization?.kind === 'quest-objective'
      && questDefinitions.get(authorization.definitionKey)?.type === 'mainline') {
      mainline = true; mainlineSteps++; mainlineTimes.push(event.createdAt)
    }
    if (authorization?.kind === 'combat-transition') {
      if (authorization.intent === 'finish-defeat') defeated++
      if (authorization.intent === 'finish-escaped') escaped++
    }
    if (authorization?.kind === 'fast-travel') fastTravel++
    respawned += payload.plan.effects.filter(effect => effect.operation === 'respawn').length
    if (authorization?.kind === 'director-settlement') {
      const selection = authorization.selection
      if (selection.fingerprint) fingerprints.set(selection.fingerprint, (fingerprints.get(selection.fingerprint) ?? 0) + 1)
      if (selection.sourceKey) sources.set(selection.sourceKey, (sources.get(selection.sourceKey) ?? 0) + 1)
    }
    if (command) settledCommands.push({ baseSequence: command.baseSequence, mainline })
  }
  const boundaries = input.intents.observations.filter(item => item.kind === 'boundary')
  const afterBoundary = boundaries.filter(item => settledCommands.find(command => command.baseSequence >= item.baseSequence)?.mainline).length
  const repeated = (counts: Map<string, number>) => [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0)
  return {
    schema: 'storyforge.text-open-world-experience-summary' as const, version: 1 as const,
    runtimeSourceHash: input.session.runtimeSourceHash,
    scope: 'current-session-branch' as const,
    inheritedFromBranch: input.session.parentSessionId != null,
    throughSequence: input.throughSequence,
    eventEvidenceHash: await hashProductProductionValueV2(events.map(event => ({
      sequence: event.sequence, type: event.type, payloadJson: event.payloadJson, createdAt: event.createdAt,
    }))),
    intentEvidenceHash: await hashProductProductionValueV2(input.intents.observations),
    mainline: { steps: mainlineSteps, completedQuests: mainlineCompleted.size,
      wallClockSpanMinutes: mainlineTimes.length < 2 ? null : Math.max(0, (Math.max(...mainlineTimes) - Math.min(...mainlineTimes)) / 60_000) },
    sideQuests: { accepted: accepted.size, completed: completed.size },
    quests: { abandoned, expired }, combat: { defeated, escaped, respawned },
    map: { knownVisitedLocations: Object.values(projection.state.map.locationKnowledgeByKey)
      .filter(value => value === 'visited' || value === 'familiar').length, fastTravel },
    freeInput: { mappingOffered: input.intents.observations.filter(item => item.kind === 'mapping-offered').length,
      mappedCommands, boundaryResponses: boundaries.length, mainlineAfterBoundary: afterBoundary,
      unavailableRuns: input.intents.unavailable },
    repetition: { sameFingerprint: repeated(fingerprints), sameSource: repeated(sources), semanticSimilarity: 'not-measured' as const },
    acceptance: 'not-a-playtest-receipt' as const,
  }
}

export async function readTextOpenWorldExperienceV1(input: { scope: WorkspaceScope; sessionId: number }) {
  const session = await assertInstanceBinding(input.sessionId, input.scope)
  const state = await readProductRuntimeState(input.sessionId)
  if (!state.textOpenWorld) throw new Error('此存档没有可核验的开放世界体验记录')
  const [events, intents] = await Promise.all([
    db.productRuntimeEvents.where('sessionId').equals(input.sessionId).sortBy('sequence'),
    readTextOpenWorldIntentObservationsV1({ ...input, throughSequence: state.lastSequence }),
  ])
  const result = await projectTextOpenWorldExperienceV1({
    session: { ...session, id: input.sessionId }, projection: state.textOpenWorld, throughSequence: state.lastSequence, events, intents,
  })
  const [current, version] = await Promise.all([
    assertInstanceBinding(input.sessionId, input.scope), readProductRuntimeStateVersion(input.sessionId),
  ])
  if (canonicalProductProductionJsonV2(session) !== canonicalProductProductionJsonV2(current)
    || version.sequence !== state.lastSequence) throw new Error('读取期间存档已变化，请重新读取体验记录')
  return result
}

export async function createTextOpenWorldExperienceFeedbackV1(input: {
  summary: Awaited<ReturnType<typeof readTextOpenWorldExperienceV1>>
  category: TextOpenWorldFeedbackCategoryV1; note: string; sourceTextExcluded: true
}) {
  if (!Object.prototype.hasOwnProperty.call(TEXT_OPEN_WORLD_FEEDBACK_CATEGORIES_V1, input.category)
    || input.sourceTextExcluded !== true || input.note.trim().length < 5 || input.note.length > 2000) {
    throw new Error('请选择问题分类，填写至少五字描述，并确认未包含原文或敏感信息')
  }
  const body = { schema: 'storyforge.text-open-world-player-feedback' as const, version: 1 as const,
    summary: input.summary, category: input.category, note: input.note.trim(),
    sourceTextExcluded: true as const, formalAcceptance: false as const, createdAt: Date.now() }
  return { ...body, feedbackHash: await hashProductProductionValueV2(body) }
}
