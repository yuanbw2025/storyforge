import { parseAvgProfessionalArtifactV1 } from './artifact-contract'
import type { ProductRuntimePackageV2 } from '../types'
import { parseProductRuntimePackageV2 } from '../product-production/runtime-package'
import { avgKey, avgList, avgUnique, avgNumber, avgRecord } from './protocol-validation'
import { buildAvgSystemGraphV1 } from './system-graph'
import { avgModuleNarrativeV2, avgExecutableCapabilities, parseAvgRuntimeModuleV2, type AvgExecutableStageV1 } from './executable-module'

/** Deterministic assembly only. Rules own outcomes; scripts supply canonical
 * display text. Stable action/line identity is checked before a package exists. */
export function compileAvgExecutablePackageV2(input: {
  product: { key: string; title: string; description: string }
  sourceWorld: ProductRuntimePackageV2['sourceWorld']
  systemPlan: unknown
  scripts: unknown
  stage: AvgExecutableStageV1
  aspectRatio: '16:9' | '4:3'
  reading?: unknown
  scriptRevisions?: Record<string, number>
}): ProductRuntimePackageV2 {
  const compiled = buildAvgSystemGraphV1(input.systemPlan)
  const scripts = avgUnique(avgList(input.scripts, 'scripts', value => {
    const script = parseAvgProfessionalArtifactV1(value)
    if (script.schema !== 'storyforge.avg.scene-script') throw new Error('[avg] 不是规范场景脚本')
    return script
  }, 1000), script => script.sceneKey, 'scripts')
  if (scripts.length !== compiled.plan.scenes.length || scripts.some(script => !compiled.plan.scenes.some(scene => scene.key === script.sceneKey))) throw new Error('[avg] 规则与脚本场景未闭合')
  const ordered = compiled.plan.scenes.map(scene => scripts.find(script => script.sceneKey === scene.key)!)
  const revisions = avgRecord(input.scriptRevisions ?? Object.fromEntries(ordered.map(script => [script.sceneKey, 1])), ordered.map(script => script.sceneKey), 'script revisions')
  for (const script of ordered) {
    const actions = compiled.plan.actions.filter(action => action.fromSceneKey === script.sceneKey)
    if (script.choices.length !== actions.length || script.choices.some(choice => choice.choiceKey !== choice.actionKey || !actions.some(action => action.key === choice.actionKey))) throw new Error('[avg] 脚本选择与正式规则行动不一致')
    for (const line of script.lines) {
      if (line.actionKeys.some(key => !actions.some(action => action.key === key))
        || line.informationKeys.some(key => !compiled.plan.knowledge.some(fact => fact.factKey === key))) throw new Error('[avg] 规范句引用未知知识/行动')
    }
  }
  const module = parseAvgRuntimeModuleV2({ schema: 'storyforge.avg.runtime-module', version: 2,
    systemPlan: compiled.plan, aspectRatio: input.aspectRatio, stage: input.stage, ...(input.reading === undefined ? {} : { reading: input.reading }), choices: ordered.flatMap(script => script.choices.map(choice => ({ choiceKey: choice.choiceKey, text: choice.text }))),
    lines: ordered.flatMap(script => script.lines.map(line => ({ lineKey: line.lineKey, sceneKey: script.sceneKey,
      speakerKey: line.speakerKey, text: line.text, textRevision: avgNumber(revisions[script.sceneKey], 'script revision', 1, 1_000_000), locale: 'zh-CN' }))) })
  return parseProductRuntimePackageV2({ schema: 'storyforge.product-runtime-package', version: 2, productType: 'avg',
    definition: { productKey: avgKey(input.product.key, 'productKey'), title: input.product.title, description: input.product.description,
      enabledCapabilities: avgExecutableCapabilities(module), rulesetVersion: compiled.plan.version, initialVariables: compiled.initialVariables },
    sourceWorld: input.sourceWorld, narrative: avgModuleNarrativeV2(module), modules: [module] })
}
