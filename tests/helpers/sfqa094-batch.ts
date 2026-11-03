import { db } from '../../src/lib/db/schema'
import { runBatchOutlineGeneration } from '../../src/lib/ai/batch-outline-runner'
import { prepareOutlineGatewayAssemblyV1 } from '../../src/lib/outline/gateway-context'
import { parseChapterOutlineOutput } from '../../src/lib/ai/parse-outline-output'
import type { OutlineGenerationCandidateV1, OutlineGenerationAdoptionIntentV1 } from '../../src/lib/outline/candidate-lifecycle'
import type { OutlineNode } from '../../src/lib/types'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { seedCurrentWorkspace } from './current-workspace'

export async function createSfqa094BatchV1(count = 2) {
  const workspace = await seedCurrentWorkspace('SFQA094 批量确认')
  const now = Date.now()
  const volumes: OutlineNode[] = []
  for (let index = 0; index < count; index++) {
    const row = stampNewRecord<OutlineNode>(workspace.scope, 'outlineNodes', {
      projectId: workspace.scope.projectId, parentId: null, worldGroupId: null,
      type: 'volume', title: `第${index + 1}卷`, summary: `第${index + 1}卷的迁徙`,
      order: index, createdAt: now, updatedAt: now,
    }, { owner: 'work' })
    const id = await db.outlineNodes.add(row)
    volumes.push({ ...row, id })
  }
  let modelCalls = 0
  const result = await runBatchOutlineGeneration({
    project: workspace.project, work: workspace.work, nodes: volumes, volumes,
    batchGroupId: `sfqa094-${workspace.scope.projectId}-${count}`,
    runModel: async (_messages, volume) => {
      modelCalls++
      return JSON.stringify([
        { title: `${volume.title}第一章`, summary: `${volume.title}启程` },
        { title: `${volume.title}第二章`, summary: `${volume.title}抵达` },
      ])
    },
    assembleContext: ({ volume, priorOutlineCandidateText }) => prepareOutlineGatewayAssemblyV1({
      projectId: workspace.scope.projectId, scope: workspace.scope, worldGroupId: null,
      request: { kind: 'chapters', volumeId: volume.id! },
      authorRequest: `拆分${volume.title}`, config: useAIConfigStore.getState().config,
      priorOutlineCandidateText,
    }),
  })
  if (result.failures.length || result.candidatesByVolume.size !== count) {
    throw new Error(`SFQA094 fixture generation failed: ${JSON.stringify(result.failures)}`)
  }
  return { ...workspace, volumes, result, modelCalls: () => modelCalls }
}

export function sfqa094IntentV1(candidate: OutlineGenerationCandidateV1, volumeId: number): OutlineGenerationAdoptionIntentV1 {
  return {
    version: 1, kind: 'chapters', destinationVolumeId: volumeId,
    items: parseChapterOutlineOutput(candidate.output), startingOrder: 0, baseExistingTitles: [],
  }
}
