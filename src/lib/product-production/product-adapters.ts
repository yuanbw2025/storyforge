import {
  compileAdventureModuleV1,
  compileInteractionModulesV1,
  compileOpenWorldModulesV1,
} from './product-module-compilers'
import { compileTextAdventureModuleV2 } from '../adventure/production-compiler'
import type {
  TextAdventureArchitectureArtifactV1,
  TextAdventureQuestBundleArtifactV1,
  TextAdventureSystemsArtifactV1,
} from '../adventure/production-artifacts'
import type {
  AdventureContent,
  ProductionProductKindV1,
  ProductProductionBriefV3,
  ProductRuntimePackageV1,
  TtrpgRuntimeContentV1,
} from '../types'
import type { ProductProductionWorldSourceCatalogV2 as ProductWorldSourceCatalog } from './world-source'

export interface UpperProductProductionAdapterV1 {
  id: string
  version: 1
  productType: ProductionProductKindV1
  enabledCapabilities: string[]
  commercialReady: boolean
  buildModules(input: ProductAdapterBuildInputV1): ProductAdapterBuildResultV1
}

export interface ProductAdapterBuildInputV1 {
  brief: ProductProductionBriefV3
  narrative: ProductRuntimePackageV1['narrative']
  /** Frozen, verified labels/details for the portable IDs in Brief.selection. */
  sourceCatalog?: Pick<ProductWorldSourceCatalog,
    'characters' | 'locations' | 'artifacts' | 'loreEntries' | 'storyArcs'>
  ttrpg?: TtrpgRuntimeContentV1
  textAdventureProduction?: {
    architecture: TextAdventureArchitectureArtifactV1
    systems: TextAdventureSystemsArtifactV1
    sideQuests: TextAdventureQuestBundleArtifactV1
    ambientEvents: TextAdventureQuestBundleArtifactV1
  }
}

export interface ProductAdapterBuildResultV1 {
  adapterId: string
  commercialReady: boolean
  enabledCapabilities: string[]
  interaction?: NonNullable<ProductRuntimePackageV1['interaction']>
  adventure?: NonNullable<ProductRuntimePackageV1['adventure']>
  openWorldEvolution?: NonNullable<ProductRuntimePackageV1['openWorldEvolution']>
  openWorld?: NonNullable<ProductRuntimePackageV1['openWorld']>
  ttrpg?: NonNullable<ProductRuntimePackageV1['ttrpg']>
}

function fail(message: string): never {
  throw new Error(`[product-production-adapter] ${message}`)
}

function interactionModules(input: ProductAdapterBuildInputV1) {
  return compileInteractionModulesV1(input)
}

function adventureModule(
  input: ProductAdapterBuildInputV1,
  interaction: NonNullable<ProductRuntimePackageV1['interaction']>,
): AdventureContent {
  if (input.textAdventureProduction) return compileTextAdventureModuleV2({
    ...input,
    interaction,
    architecture: input.textAdventureProduction.architecture,
    systems: input.textAdventureProduction.systems,
    sideQuests: input.textAdventureProduction.sideQuests,
    ambientEvents: input.textAdventureProduction.ambientEvents,
  })
  return compileAdventureModuleV1(input)
}

function textOpenWorldModules(input: ProductAdapterBuildInputV1) {
  return compileOpenWorldModulesV1(input)
}

function adapter(input: Omit<UpperProductProductionAdapterV1, 'version'>): UpperProductProductionAdapterV1 {
  return { ...input, version: 1 }
}

const ADAPTERS = new Map<ProductionProductKindV1, UpperProductProductionAdapterV1>([
  adapter({
    id: 'storyforge.product.character-interaction.v1', productType: 'character-interaction',
    enabledCapabilities: ['narrative', 'interaction'], commercialReady: true,
    buildModules: input => ({
      adapterId: 'storyforge.product.character-interaction.v1',
      commercialReady: input.brief.qualityProfile === 'commercial-candidate',
      enabledCapabilities: ['narrative', 'interaction'], interaction: interactionModules(input),
    }),
  }),
  adapter({
    id: 'storyforge.product.text-adventure.v2', productType: 'text-adventure',
    enabledCapabilities: ['narrative', 'interaction', 'adventure'], commercialReady: true,
    buildModules: input => ({
      adapterId: 'storyforge.product.text-adventure.v2',
      commercialReady: input.brief.qualityProfile === 'commercial-candidate',
      enabledCapabilities: ['narrative', 'interaction', 'adventure'],
      ...(() => {
        const interaction = interactionModules(input)
        return { interaction, adventure: adventureModule(input, interaction) }
      })(),
    }),
  }),
  adapter({
    id: 'storyforge.product.avg.v1', productType: 'avg',
    enabledCapabilities: ['narrative', 'presentation'], commercialReady: true,
    buildModules: input => ({
      adapterId: 'storyforge.product.avg.v1',
      commercialReady: input.brief.qualityProfile === 'commercial-candidate',
      enabledCapabilities: ['narrative', 'presentation'],
    }),
  }),
  adapter({
    id: 'storyforge.product.text-open-world.v1', productType: 'text-open-world',
    enabledCapabilities: ['narrative', 'interaction', 'adventure', 'openWorldEvolution', 'open-world'],
    commercialReady: true,
    buildModules: input => ({
      adapterId: 'storyforge.product.text-open-world.v1',
      commercialReady: input.brief.qualityProfile === 'commercial-candidate',
      enabledCapabilities: ['narrative', 'interaction', 'adventure', 'openWorldEvolution', 'open-world'],
      ...textOpenWorldModules(input),
    }),
  }),
  adapter({
    id: 'storyforge.product.ttrpg.v1', productType: 'ttrpg',
    // TTRPG remains fail-closed until the product-level Golden A/B/C and
    // non-fixture browser evidence are verified. A commercial-candidate Brief
    // is an author intent, not proof that the adapter is commercially ready.
    enabledCapabilities: ['narrative', 'ttrpg', 'presentation'], commercialReady: false,
    buildModules: input => {
      if (!input.ttrpg) fail('TTRPG adapter 缺少已验证 RulePack/Campaign compiler 输出')
      return {
        adapterId: 'storyforge.product.ttrpg.v1',
        commercialReady: false,
        enabledCapabilities: ['narrative', 'ttrpg', 'presentation'], ttrpg: structuredClone(input.ttrpg),
      }
    },
  }),
].map(item => [item.productType, item]))

export function listUpperProductProductionAdaptersV1(): UpperProductProductionAdapterV1[] {
  return [...ADAPTERS.values()].map(item => ({ ...item, enabledCapabilities: [...item.enabledCapabilities] }))
}

export function resolveUpperProductProductionAdapterV1(
  productType: ProductionProductKindV1,
): UpperProductProductionAdapterV1 {
  const resolved = ADAPTERS.get(productType)
  if (!resolved) fail(`未知产品:${productType}`)
  return resolved
}

export function buildUpperProductModulesV1(input: ProductAdapterBuildInputV1): ProductAdapterBuildResultV1 {
  const resolved = resolveUpperProductProductionAdapterV1(input.brief.intent.productType)
  const result = resolved.buildModules(input)
  if (result.adapterId !== resolved.id
    || result.commercialReady !== (resolved.commercialReady && input.brief.qualityProfile === 'commercial-candidate')
    || result.enabledCapabilities.join(',') !== resolved.enabledCapabilities.join(',')) {
    fail(`产品 adapter 返回合同不一致:${resolved.id}`)
  }
  return structuredClone(result)
}
