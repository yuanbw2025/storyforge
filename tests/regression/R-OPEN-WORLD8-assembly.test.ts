import { describe, expect, it } from 'vitest'
import { TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1 } from '../../src/lib/open-world/production-contract'
import { assertTextOpenWorldAssemblyInputsV1, freezeTextOpenWorldResponsibilitySnapshotV1, validateTextOpenWorldResponsibilitySnapshotV1 } from '../../src/lib/open-world/responsibility-assembly'
import type { ProductProductionTaskExecutionInputV1 } from '../../src/lib/product-production/scheduler'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
const hash = 'a'.repeat(64)
function execution() {
  const task = TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1.find(row => row.taskKey === 'v3.runtime-package')!
  return {
    scope: { projectId: 1, worldId: 2, workId: 3 }, buildId: 4, controlEpoch: 2, planHash: hash,
    task: structuredClone(task),
    inputArtifacts: task.inputArtifactKeys.map(artifactKey => ({
      projectId: 1, worldId: 2, workId: 3, buildId: 4, controlEpoch: 2, artifactKey,
      status: 'accepted', version: 1, contentHash: hash, inputHash: hash,
    })),
  } as unknown as ProductProductionTaskExecutionInputV1
}
describe('W5 assembly responsibility snapshot', () => {
  it('freezes all three input tracks without changing historical input rows', async () => {
    const input = execution(), before = structuredClone(input)
    const snapshot = await freezeTextOpenWorldResponsibilitySnapshotV1(input, hash)
    expect(snapshot.tracks.map(track => track.state)).toEqual(['ready', 'ready', 'ready'])
    await expect(validateTextOpenWorldResponsibilitySnapshotV1(snapshot, { sourcePinHash: hash, generatedMediaArtifactKeys: [] })).resolves.toBeUndefined()
    expect(input).toEqual(before)
  })
  it('fails closed for missing, duplicate, stale, cross-build or cross-owner inputs', () => {
    for (const change of [
      (row: ProductProductionTaskExecutionInputV1) => row.inputArtifacts.pop(),
      (row: ProductProductionTaskExecutionInputV1) => { row.inputArtifacts[0] = row.inputArtifacts[1] },
      (row: ProductProductionTaskExecutionInputV1) => { row.inputArtifacts[0].controlEpoch-- },
      (row: ProductProductionTaskExecutionInputV1) => { row.inputArtifacts[0].buildId++ },
      (row: ProductProductionTaskExecutionInputV1) => { row.inputArtifacts[0].workId++ },
      (row: ProductProductionTaskExecutionInputV1) => { row.inputArtifacts[0].status = 'stale' },
    ]) {
      const input = execution(); change(input)
      expect(() => assertTextOpenWorldAssemblyInputsV1(input)).toThrow()
    }
  })
  it('rejects a rehashed snapshot with a moved owner or absent track', async () => {
    for (const change of [
      (snapshot: Awaited<ReturnType<typeof freezeTextOpenWorldResponsibilitySnapshotV1>>) => { snapshot.tracks.pop() },
      (snapshot: Awaited<ReturnType<typeof freezeTextOpenWorldResponsibilitySnapshotV1>>) => { snapshot.tracks[0].inputs[0].ownerTaskKey = 'media.visual' },
    ]) {
      const snapshot = await freezeTextOpenWorldResponsibilitySnapshotV1(execution(), hash)
      change(snapshot)
      const { snapshotHash: _hash, ...body } = snapshot
      snapshot.snapshotHash = await hashProductProductionValueV2(body)
      await expect(validateTextOpenWorldResponsibilitySnapshotV1(snapshot, { sourcePinHash: hash, generatedMediaArtifactKeys: [] })).rejects.toThrow()
    }
  })
})
