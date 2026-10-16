import type { ProductProductionPlanV3 } from '../types'
import {
  TEXT_OPEN_WORLD_PRODUCTION_ARTIFACT_DEFINITIONS_V1,
  TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1,
  textOpenWorldProductionArtifactKindForKeyV1,
  textOpenWorldProductionTaskDescendantsV1,
} from './production-contract'

/** A derived product semantic, never a replacement for the scheduler lane or
 * a new persisted Plan field. Old Plan/Brief hashes remain unchanged. */
export const TEXT_OPEN_WORLD_RESPONSIBILITY_TRACKS_V1 = [
  'game-content', 'product-system', 'media',
] as const
export type TextOpenWorldResponsibilityTrackV1 =
  typeof TEXT_OPEN_WORLD_RESPONSIBILITY_TRACKS_V1[number]

export const TEXT_OPEN_WORLD_RESPONSIBILITY_LABELS_V1: Record<TextOpenWorldResponsibilityTrackV1, string> = {
  'game-content': '游戏内容制作', 'product-system': '产品系统配置', media: '媒资生产',
}

const TASK_TRACKS: Readonly<Record<string, TextOpenWorldResponsibilityTrackV1>> = {
  'p0.source-lock': 'game-content',
  'p1.source-curation': 'game-content',
  'p2.experience-design': 'game-content',
  'p2.gameplay-ruleset': 'product-system',
  'p2.presentation-profile': 'product-system',
  'p3.story-architecture': 'game-content',
  'p4.region-skeleton': 'game-content',
  'p4.player-build': 'product-system',
  'p5.mainline': 'game-content',
  'p6.significant-threads': 'game-content',
  'p7.region-narrative-packs': 'game-content',
  'p8.quest-skeletons': 'game-content',
  'p8.catalog.progression': 'product-system',
  'p8.catalog.encounters': 'product-system',
  'p8.catalog.items-rewards': 'product-system',
  'p8.catalog.crafting-economy': 'product-system',
  'p8.catalog.npc-runtime': 'product-system',
  'p8.catalog.map-interactions': 'product-system',
  'p8f.quest-finalize': 'game-content',
  'p9.scene-scripts': 'game-content',
  'p10.system-finalize': 'product-system',
  'v1.deterministic-preflight': 'product-system',
  'v2.balance-review': 'product-system',
  'v2.semantic-review': 'game-content',
  'media.visual': 'media',
  'media.audio': 'media',
  'v3.runtime-package': 'product-system',
  'qa.release': 'product-system',
}
const CROSS_TRACK_OUTPUTS: Readonly<Record<string, TextOpenWorldResponsibilityTrackV1>> = {
  'text-open-world.director-decks': 'product-system',
  'text-open-world.action-bindings': 'product-system',
  'text-open-world.media-requirements': 'media',
  'text-open-world.content-budget': 'game-content',
}

function fail(message: string): never {
  throw new Error(`[text-open-world-responsibility] ${message}`)
}

export function textOpenWorldTaskResponsibilityV1(taskKey: string): TextOpenWorldResponsibilityTrackV1 {
  return Object.prototype.hasOwnProperty.call(TASK_TRACKS, taskKey)
    ? TASK_TRACKS[taskKey] : fail(`未登记任务责任:${taskKey}`)
}

export function textOpenWorldArtifactResponsibilityV1(artifactKey: string): {
  responsibilityTrack: TextOpenWorldResponsibilityTrackV1
  ownerTaskKey: string
  productOwner: 'text-open-world'
} {
  const kind = textOpenWorldProductionArtifactKindForKeyV1(artifactKey)
  const ownerTaskKey = kind === 'image' ? 'media.visual' : kind === 'audio' ? 'media.audio'
    : TEXT_OPEN_WORLD_PRODUCTION_ARTIFACT_DEFINITIONS_V1.find(item => item.kind === kind)?.ownerTaskKey
      ?? fail(`未登记产物 owner:${artifactKey}`)
  return {
    responsibilityTrack: CROSS_TRACK_OUTPUTS[artifactKey] ?? textOpenWorldTaskResponsibilityV1(ownerTaskKey),
    ownerTaskKey, productOwner: 'text-open-world',
  }
}

export interface TextOpenWorldResponsibilityMatrixV1 {
  tasks: Array<{
    taskKey: string
    responsibilityTrack: TextOpenWorldResponsibilityTrackV1
    contributingTracks: TextOpenWorldResponsibilityTrackV1[]
    lane: string
    objective: string
    stage: string
    assembly: boolean
    inputArtifactKeys: string[]
    outputArtifactKeys: string[]
    dependsOn: string[]
    downstreamTaskKeys: string[]
  }>
  artifacts: Array<ReturnType<typeof textOpenWorldArtifactResponsibilityV1> & {
    artifactKey: string
    assembly: boolean
    consumerTaskKeys: string[]
  }>
}

/** Membership follows the exact frozen Plan, including expanded P0/media
 * outputs. Missing, unknown and duplicate ownership is never guessed. */
export function createTextOpenWorldResponsibilityMatrixV1(
  plan: ProductProductionPlanV3,
): TextOpenWorldResponsibilityMatrixV1 {
  if (plan.productType !== 'text-open-world') fail('不是文字开放世界计划')
  const keys = new Set(plan.tasks.map(task => task.taskKey))
  if (keys.size !== plan.tasks.length
    || TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1.some(task => !keys.has(task.taskKey))) {
    fail('正式任务集合不完整或重复')
  }
  const artifacts: TextOpenWorldResponsibilityMatrixV1['artifacts'] = []
  const tasks = plan.tasks.map(task => {
    const responsibilityTrack = textOpenWorldTaskResponsibilityV1(task.taskKey)
    const assembly = ['v3.runtime-package', 'qa.release'].includes(task.taskKey)
    const definition = TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1.find(item => item.taskKey === task.taskKey)
    const outputs = task.outputArtifactKeys.map(artifactKey => {
      const owner = textOpenWorldArtifactResponsibilityV1(artifactKey)
      if (owner.ownerTaskKey !== task.taskKey || artifacts.some(item => item.artifactKey === artifactKey)) {
        fail(`产物 owner 错配或重复:${artifactKey}`)
      }
      artifacts.push({
        ...owner, artifactKey, assembly,
        consumerTaskKeys: plan.tasks.filter(item => item.inputArtifactKeys.includes(artifactKey)).map(item => item.taskKey),
      })
      return owner
    })
    if (definition && definition.outputArtifactKeys.some(key => !task.outputArtifactKeys.includes(key))) {
      fail(`缺少正式输出:${task.taskKey}`)
    }
    return {
      taskKey: task.taskKey, responsibilityTrack,
      contributingTracks: TEXT_OPEN_WORLD_RESPONSIBILITY_TRACKS_V1.filter(track => (
        track === responsibilityTrack || outputs.some(item => item.responsibilityTrack === track)
      )),
      lane: task.lane, objective: definition?.objective ?? '按冻结需求生产产品媒资并校验权利与绑定。',
      stage: definition?.stage ?? 'Media', assembly,
      inputArtifactKeys: [...task.inputArtifactKeys], outputArtifactKeys: [...task.outputArtifactKeys],
      dependsOn: [...task.dependsOn],
      downstreamTaskKeys: textOpenWorldProductionTaskDescendantsV1(task.taskKey, plan.tasks).filter(key => key !== task.taskKey),
    }
  })
  for (const task of tasks) {
    if (task.dependsOn.some(key => !keys.has(key))
      || task.inputArtifactKeys.some(key => !artifacts.some(item => item.artifactKey === key))) {
      fail(`输入依赖不闭合:${task.taskKey}`)
    }
  }
  return { tasks, artifacts }
}
