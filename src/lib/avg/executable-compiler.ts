import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { readAvgSystemPlanForCompilationV1 } from './author-artifacts'
import { compileAvgExecutablePackageV2 } from './executable-package'
import type { AvgExecutableStageV1 } from './executable-module'
export { compileAvgExecutablePackageV2 } from './executable-package'
/** Reads confirmed, current rule/script revisions and an explicit stage draft
 * into an in-memory package candidate. Director/media adoption and actual
 * Preview/Release freezing remain production-integrator responsibilities. */
export async function compileConfirmedAvgBuildV2(input: Parameters<typeof readAvgSystemPlanForCompilationV1>[0] & {
  product: { key: string; title: string; description: string }; stage: AvgExecutableStageV1; aspectRatio: '16:9' | '4:3'; reading?: unknown
}) {
  const source = await readAvgSystemPlanForCompilationV1({ ...input, includeSceneScripts: true })
  if (input.product.key !== source.build.productionKey) throw new Error('[avg] 编译产品身份与当前 Production 不一致')
  const runtimePackage = compileAvgExecutablePackageV2({ ...input, systemPlan: source.plan,
    scripts: source.scripts.map(script => script.payload), scriptRevisions: Object.fromEntries(source.scripts.map(script => [script.payload.sceneKey, script.artifact.version])), sourceWorld: source.sourceWorld })
  if (canonicalProductProductionJsonV2(source.plan) !== canonicalProductProductionJsonV2(runtimePackage.modules[0].version === 2 ? runtimePackage.modules[0].systemPlan : null)) throw new Error('[avg] 编译输入发生漂移')
  return { runtimePackage, source }
}

/** Formal integrators use adopted stage/media and the same actual author receipts.
 * Produces a candidate only; shared production still owns Preview/Release freezing. */
export async function compileAdoptedAvgBuildV2(input: Parameters<typeof readAvgSystemPlanForCompilationV1>[0] & {
  product: { key: string; title: string; description: string }
}) {
  const source = await readAvgSystemPlanForCompilationV1({ ...input, includeAuthorStage: true })
  if (input.product.key !== source.build.productionKey || !source.authorStage) throw new Error('[avg] 正式组装来源不完整或产品身份不符')
  const runtimePackage = compileAvgExecutablePackageV2({ product: input.product, sourceWorld: source.sourceWorld, systemPlan: source.plan,
    scripts: source.scripts.map(row => row.payload), scriptRevisions: Object.fromEntries(source.scripts.map(row => [row.payload.sceneKey, row.artifact.version])),
    ...source.authorStage.payload })
  return { runtimePackage, source }
}

export type { AvgSceneScriptV1 } from './artifact-contract'
