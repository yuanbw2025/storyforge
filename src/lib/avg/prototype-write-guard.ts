import type { ProductProductionBriefV3, WorkspaceScope } from '../types'
import { classifyAvgAuthorPrototypeBriefV1, assertAvgVisualPrototypeWriteEnabledV5 } from './prototype-contract'
import { assertAvgSoundBuildWriteEnabledV1 } from './sound-write-guard'

/** Actual write fences only. A visual version may also retain an original
 * sound source, so keep both requirements instead of replacing one with the
 * other. Call again in receipt transactions; final publication checks both. */
export async function assertAvgPrototypeBuildWriteEnabledV1(scope: WorkspaceScope, buildId: number, brief: ProductProductionBriefV3) {
  const prototypeKind = classifyAvgAuthorPrototypeBriefV1(brief)
  const usesOriginalSound = await assertAvgSoundBuildWriteEnabledV1(scope, buildId, brief)
  if (prototypeKind === 'visual-v5') assertAvgVisualPrototypeWriteEnabledV5()
  return { prototypeKind, usesOriginalSound }
}
