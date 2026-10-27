import Dexie from 'dexie'
import type { ProductProductionBriefV3 } from '../types'
import type { AvgAssemblyBriefV2 } from './assembly-contract'
import { AVG_IMAGE_CAPABILITY_REQUIREMENT_KEY_V1 } from './assembly-plan'
import { assertAvgVisualProductionPolicyV2, type AvgVisualProductionPolicyInputV2 } from './media-production-policy'
import { assertAvgStoredAssemblyBriefV3, parseAvgStoredAssemblyBriefV3 } from './voice-assembly-storage'
import { assertAvgVoiceProductionPolicyV3 } from './voice-production-policy'

/** Image metadata only. This view must never replace the original stored
 * Brief when checking a Build, SourcePlan, producer, lineage or author receipt.
 * In particular, voice-first capability order is valid in a combined Brief.
 */
export function readAvgImageDefinitionV3(brief: Pick<ProductProductionBriefV3, 'avgAssembly'>): AvgAssemblyBriefV2 {
  const stored = brief.avgAssembly
  if (stored?.version === 2) return stored
  if (stored?.version === 3) {
    const { assembly } = parseAvgStoredAssemblyBriefV3(stored)
    if (assembly.image) return { schema: assembly.schema, version: 2, title: assembly.title,
      sceneKeys: assembly.sceneKeys, mediaAssetKeys: assembly.mediaAssetKeys,
      basePackageHash: assembly.basePackageHash, ...assembly.image }
  }
  throw new Error('[avg-media] 当前冻结 Brief 没有图片生产定义')
}

export function readAvgOptionalImageDefinitionV3(brief: Pick<ProductProductionBriefV3, 'avgAssembly'>) {
  const a = brief.avgAssembly
  return !a || a.version === 1 || a.version === 3 && !a.image ? null : readAvgImageDefinitionV3(brief)
}

/** Validate the whole actual policy before selecting image metadata. A
 * combined Brief cannot borrow voice consent, budget, route or capability.
 * The exact stored voice packet is checked even for an image operation.
 */
export async function assertAvgImageProductionDefinitionV3(
  brief: AvgVisualProductionPolicyInputV2 & Pick<ProductProductionBriefV3, 'media'>,
) {
  if (brief.avgAssembly?.version === 3) {
    const stored = brief.avgAssembly
    const verify = () => assertAvgStoredAssemblyBriefV3(stored)
    const { assembly } = Dexie.currentTransaction
      ? await Dexie.waitFor(Dexie.ignoreTransaction(verify), 20_000) : await verify()
    assertAvgVoiceProductionPolicyV3({ ...brief, avgAssembly: assembly })
  } else {
    assertAvgVisualProductionPolicyV2(brief)
  }
  const assembly = readAvgImageDefinitionV3(brief)
  const capability = brief.capabilityRequirements.find(c => c.requirementKey === AVG_IMAGE_CAPABILITY_REQUIREMENT_KEY_V1)
  if (!capability) throw new Error('[avg-media] 缺少准确的图片能力声明')
  return { assembly, capability }
}
