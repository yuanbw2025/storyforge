/** Shared media production topology; consumers supply their own upstream artifacts and integration. */
import type { ProductProductionBriefV3, ProductProductionPlanTaskV3 } from '../types'

export function createCommonProductMediaBundleTasksV3(input: {
  brief: ProductProductionBriefV3; dependsOn: string[]; inputArtifactKeys: string[]
  visualArtifactKeys: string[]; audioArtifactKeys: string[]
  durationMs: number; storageBytes: number; maximumCostUsd: number | null
  failurePolicy?: ProductProductionPlanTaskV3['failurePolicy']
}): ProductProductionPlanTaskV3[] {
  const tasks: ProductProductionPlanTaskV3[] = [], { brief } = input
  const groups = [
    { taskKey: 'media.visual', lane: 'visual' as const, kind: 'image-bundle', artifactKeys: input.visualArtifactKeys,
      classes: ['image'], kinds: brief.media.requiredMediaKinds.filter(kind => !['bgm', 'sfx', 'voice'].includes(kind)),
      calls: brief.media.imageCount, priority: 70 },
    { taskKey: 'media.audio', lane: 'audio' as const, kind: 'audio-bundle', artifactKeys: input.audioArtifactKeys,
      classes: ['music', 'sfx', 'voice'], kinds: brief.media.requiredMediaKinds.filter(kind => ['bgm', 'sfx', 'voice'].includes(kind)),
      calls: brief.media.musicTrackCount + brief.media.sfxCount + brief.media.voiceLineCount, priority: 65 },
  ]
  for (const group of groups) {
    if (!group.artifactKeys.length) continue
    tasks.push({ taskKey: group.taskKey, lane: group.lane, kind: group.kind,
      skillId: 'product-production.media-request.v1', executionMode: 'media-provider', dependsOn: [...input.dependsOn],
      requiredReceipts: input.dependsOn.map(taskKey => ({ taskKey, receiptHash: null })),
      inputArtifactKeys: [...input.inputArtifactKeys], outputArtifactKeys: [...group.artifactKeys], requirementKeys: group.kinds,
      capabilityRequirementKeys: brief.capabilityRequirements.filter(requirement => group.classes.includes(requirement.mediaClass))
        .map(requirement => requirement.requirementKey), concurrencyGroup: 'media-provider',
      subjectLockKeys: [...group.artifactKeys], priority: group.priority,
      budgetReservation: { modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: group.calls,
        maximumCostUsd: input.maximumCostUsd, durationMs: input.durationMs, storageBytes: input.storageBytes },
      maxAttempts: 2, timeoutMs: 600_000,
      failurePolicy: input.failurePolicy ?? (brief.fallbackPolicy.allowTextOnly ? 'skip-optional' : 'pause'),
      fallbackTaskKey: null, acceptanceGateIds: ['media.integrity', 'media.rights'], reuse: null })
  }
  return tasks
}
