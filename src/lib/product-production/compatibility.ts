import type { ProductBuildCompatibilityReportV1, ProductRuntimePackageV1 } from '../types'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2, isSha256Hash } from './hash'

interface RuntimePackageBuildRefV1 {
  buildNumber: number
  packageHash: string
  runtimePackage: ProductRuntimePackageV1
}

function fail(message: string): never {
  throw new Error(`[product-production-compatibility] ${message}`)
}

function stableValues(pkg: ProductRuntimePackageV1): Map<string, string> {
  const values = new Map<string, string>()
  const add = (prefix: string, key: string, value: unknown) => {
    const stableKey = `${prefix}:${key}`
    if (values.has(stableKey)) fail(`重复 stable key:${stableKey}`)
    values.set(stableKey, canonicalProductProductionJsonV2(value))
  }
  add('runtime', 'contract', {
    schema: pkg.schema, version: pkg.version, productType: pkg.productType,
    capabilities: pkg.definition.enabledCapabilities, rulesetVersion: pkg.definition.rulesetVersion,
  })
  for (const node of pkg.narrative.nodes) add('narrative.node', node.key, {
    kind: node.kind, conditionJson: node.conditionJson, effectsJson: node.effectsJson,
    successorKeys: [...node.successorKeys],
  })
  for (const choice of pkg.narrative.choices) add('narrative.choice', choice.choiceKey, {
    sourceNodeKey: choice.sourceNodeKey, targetNodeKey: choice.targetNodeKey,
    displayConditionJson: choice.displayConditionJson, availableConditionJson: choice.availableConditionJson,
    effectsJson: choice.effectsJson,
  })
  for (const profile of pkg.interaction?.profiles ?? []) add('interaction.profile', profile.participantKey, {
    characterKey: profile.characterKey, relationshipDimensions: profile.relationshipDimensions,
  })
  for (const scene of pkg.interaction?.sceneTemplates ?? []) add('interaction.scene', scene.sceneKey, {
    participantKeys: scene.participantKeys, relationshipRules: scene.relationshipRules,
    openingNodeKey: scene.openingNodeKey, endingNodeKey: scene.endingNodeKey, maxTurns: scene.maxTurns,
  })
  for (const location of pkg.adventure?.locations ?? []) add('adventure.location', location.key, location)
  for (const object of pkg.adventure?.objects ?? []) add('adventure.object', object.key, object)
  for (const item of pkg.adventure?.items ?? []) add('adventure.item', item.key, item)
  for (const quest of pkg.adventure?.quests ?? []) add('adventure.quest', quest.key, quest)
  for (const action of pkg.adventure?.actions ?? []) add('adventure.action', action.key, action)
  for (const resource of pkg.openWorldEvolution?.resources ?? []) add('open-world-evolution.resource', resource.key, resource)
  for (const metric of pkg.openWorldEvolution?.metrics ?? []) add('open-world-evolution.metric', metric.key, metric)
  for (const actor of pkg.openWorldEvolution?.actors ?? []) add('open-world-evolution.actor', actor.key, actor)
  for (const issue of pkg.openWorldEvolution?.issues ?? []) add('open-world-evolution.issue', issue.key, issue)
  for (const action of pkg.openWorldEvolution?.actions ?? []) add('open-world-evolution.action', action.key, action)
  for (const ending of pkg.openWorldEvolution?.endings ?? []) add('open-world-evolution.ending', ending.key, ending)
  for (const region of pkg.openWorld?.regions ?? []) add('open-world.region', region.key, region)
  for (const edge of pkg.openWorld?.travelEdges ?? []) add('open-world.edge', edge.key, edge)
  for (const channel of pkg.openWorld?.discoveryChannels ?? []) add('open-world.channel', channel.key, channel)
  for (const card of pkg.openWorld?.fixedTaskCards ?? []) add('open-world.card', card.key, card)
  for (const template of pkg.openWorld?.taskTemplates ?? []) add('open-world.template', template.key, template)
  return values
}

function validateRef(ref: RuntimePackageBuildRefV1, label: string): void {
  if (!Number.isInteger(ref.buildNumber) || ref.buildNumber < 1 || !isSha256Hash(ref.packageHash)) {
    fail(`${label} Build ref 无效`)
  }
}

export async function createProductBuildCompatibilityReportV1(input: {
  previous: RuntimePackageBuildRefV1 | null
  current: RuntimePackageBuildRefV1
}): Promise<ProductBuildCompatibilityReportV1> {
  validateRef(input.current, 'current')
  if (input.previous) validateRef(input.previous, 'previous')
  if (!input.previous) {
    const core = {
      schema: 'storyforge.product-build-compatibility' as const, version: 1 as const,
      level: 'compatible' as const, fromBuildNumber: null, fromPackageHash: null,
      toBuildNumber: input.current.buildNumber, toPackageHash: input.current.packageHash,
      addedStableKeys: [...stableValues(input.current.runtimePackage).keys()].sort(),
      removedStableKeys: [], changedStableKeys: [], unchangedStableKeyCount: 0,
      migrationPolicy: 'initial-session' as const, reasons: ['首个 Build 没有需要迁移的旧存档。'],
    }
    return { ...core, reportHash: await hashProductProductionValueV2(core) }
  }
  const previousValues = stableValues(input.previous.runtimePackage)
  const currentValues = stableValues(input.current.runtimePackage)
  const addedStableKeys = [...currentValues.keys()].filter(key => !previousValues.has(key)).sort()
  const removedStableKeys = [...previousValues.keys()].filter(key => !currentValues.has(key)).sort()
  const changedStableKeys = [...currentValues.keys()]
    .filter(key => previousValues.has(key) && previousValues.get(key) !== currentValues.get(key)).sort()
  const unchangedStableKeyCount = [...currentValues.keys()]
    .filter(key => previousValues.get(key) === currentValues.get(key)).length
  const exactPackage = input.previous.packageHash === input.current.packageHash
  const breaking = removedStableKeys.length > 0 || changedStableKeys.length > 0
  const level = breaking ? 'breaking' as const : 'compatible' as const
  const migrationPolicy = breaking ? 'pin-old-save' as const
    : exactPackage ? 'identity' as const : addedStableKeys.length ? 'additive' as const : 'identity' as const
  const reasons = breaking
    ? [
        removedStableKeys.length ? `删除了 ${removedStableKeys.length} 个存档稳定键。` : '',
        changedStableKeys.length ? `改变了 ${changedStableKeys.length} 个既有规则/状态稳定键。` : '',
        '旧存档必须继续固定在旧 packageHash，不能静默迁移。',
      ].filter(Boolean)
    : exactPackage
      ? ['RuntimePackage 未变化，旧存档可继续使用同一 packageHash。']
      : addedStableKeys.length
        ? [`仅新增 ${addedStableKeys.length} 个稳定键，既有规则/状态语义未变化。`]
        : ['变化只涉及不进入存档语义的表现内容。']
  const core = {
    schema: 'storyforge.product-build-compatibility' as const, version: 1 as const, level,
    fromBuildNumber: input.previous.buildNumber, fromPackageHash: input.previous.packageHash,
    toBuildNumber: input.current.buildNumber, toPackageHash: input.current.packageHash,
    addedStableKeys, removedStableKeys, changedStableKeys, unchangedStableKeyCount,
    migrationPolicy, reasons,
  }
  return { ...core, reportHash: await hashProductProductionValueV2(core) }
}
