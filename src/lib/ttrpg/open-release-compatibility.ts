import type { TtrpgRuntimeStateV2 } from './open-runtime-contract'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import type { TtrpgRuntimeContentV2 } from './content-version'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import * as p from './open-contract-parse'
import { appendedTtrpgCompatibleOpeningEffectPlanKeysV2 } from './open-compatible-opening-contract'

export function assertTtrpgOpenReleaseCompatibilityV1(parent: TtrpgRuntimeContentV2, target: TtrpgRuntimeContentV2): void {
  const { campaign: before, ...parentRoot } = parent, { campaign: after, ...targetRoot } = target
  const omit = (campaign: typeof before) => {
    const { title: _title, pitch: _pitch, designProvenance: _provenance, situationTemplates: _situations,
      openingSituationKeys: _opening, stageClosurePolicy: _closure, effectPlanTemplates: _effects, ...mechanics } = campaign
    return mechanics
  }
  if (stable(parentRoot) !== stable(targetRoot) || stable(omit(before)) !== stable(omit(after))
    || after.stageClosurePolicy.maximumWorldTurns > before.stageClosurePolicy.maximumWorldTurns
    || before.situationTemplates.some(t => stable(after.situationTemplates.find(candidate => candidate.templateKey === t.templateKey)) !== stable(t))) {
    p.fail('此版本改变了既有规则、世界、角色、事实或局势语义，需要显式迁移；不能作为兼容续团')
  }
  appendedTtrpgCompatibleOpeningEffectPlanKeysV2(before, after)
}


/** Original discovery stays frozen; compatible release reading grants no new knowledge. */
export async function assertTtrpgOpenKnowledgeSourceCompatibleV1(runtime: TtrpgRuntimeStateV2,
  origin: { frozenContent: TtrpgRuntimeContentV2; contentHash: string }, current: TtrpgRuntimeContentV2, expectedHash?: string): Promise<void> {
  const currentHash = expectedHash ?? await hash(current);
  if (origin.contentHash === currentHash && stable(origin.frozenContent) === stable(current)) return;
  const continued = runtime.openRun?.releaseContinuation;
  const known = [continued?.plan.parentContentHash, continued?.plan.targetContentHash,
    ...(runtime.branchLineage?.ancestors.flatMap(a => [a.snapshot.openRun?.releaseContinuation?.plan.parentContentHash, a.snapshot.openRun?.releaseContinuation?.plan.targetContentHash]) ?? [])];
  if (!continued || continued.plan.targetContentHash !== currentHash || !known.includes(origin.contentHash)
    || await hash(origin.frozenContent) !== origin.contentHash) p.fail('知识发现没有准确的冻结来源或兼容续团依据');
  assertTtrpgOpenReleaseCompatibilityV1(origin.frozenContent, current);
}
