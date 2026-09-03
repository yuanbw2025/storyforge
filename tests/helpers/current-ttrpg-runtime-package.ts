import { buildUpperProductModulesV1 } from '../../src/lib/product-production/product-adapters'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import type { ProductProductionWorldSourceCatalogV2 } from '../../src/lib/product-production/world-source'
import {
  buildProductWorldSourceBundleV1,
  verifyProductWorldSourceBundleV1,
} from '../../src/lib/product/runtime-canon'
import {
  compileTtrpgProductionBriefV2,
  resolveTtrpgProductionRulePackV2,
} from '../../src/lib/ttrpg/production-brief'
import { compileProductionTtrpgCampaignV2 } from '../../src/lib/ttrpg/production-compiler'
import type {
  ProductRuntimePackageV1,
  TtrpgProductionBriefV2,
  TtrpgProductionSeatV2,
  WorkspaceScope,
  WorldRelease,
} from '../../src/lib/types'
import { createCurrentProductBriefFixture, createCurrentNarrativeFixture } from './current-runtime-package'
import { currentProductSelection } from './current-product-world'

/**
 * Builds a TTRPG RuntimePackage through the current neutral WorldReference ->
 * Product Brief -> RulePack/Campaign compiler path. It deliberately does not
 * revive a per-product authoring table, fixture release, or retired workbench.
 */
export async function createCurrentTtrpgRuntimePackageFixture(input: {
  scope: WorkspaceScope
  worldRelease: WorldRelease & { id: number }
  sourceCatalog: ProductProductionWorldSourceCatalogV2
  playerController: 'human' | 'ai'
  gmMode: 'human' | 'ai'
  title?: string
  ruleOrigin?: TtrpgProductionBriefV2['rules']['origin']
  seats?: TtrpgProductionSeatV2[]
}): Promise<ProductRuntimePackageV1> {
  const player = input.sourceCatalog.characters[0]
  if (!player) throw new Error('现行 TTRPG 测试世界缺少玩家角色')
  const selection = currentProductSelection('ttrpg', {
    participants: input.sourceCatalog.characters.map(character => character.resourceKey),
    locations: input.sourceCatalog.locations.map(location => location.resourceKey),
    items: input.sourceCatalog.artifacts.map(artifact => artifact.resourceKey),
    quests: input.sourceCatalog.storyArcs.map(arc => arc.resourceKey),
  }, input.sourceCatalog.worldReference.referenceHash)
  const productBrief = createCurrentProductBriefFixture({
    productType: 'ttrpg',
    worldRelease: input.worldRelease,
    sourceCatalog: input.sourceCatalog,
  })
  productBrief.source.selection = selection
  const ttrpgBrief = await compileTtrpgProductionBriefV2({
    scope: input.scope,
    selection,
    worldContentHash: input.worldRelease.contentHash,
    title: input.title ?? '雾港可信跑团',
    premise: '在潮门关闭前调查求救信号并决定是否公开真相。',
    tone: ['克制', '悬疑', '协作'],
    scale: { scope: 'scene', targetPlayMinutes: 45, targetEndingCount: 4 },
    contentBoundaries: ['不生成未授权露骨内容'],
    confirmDefaultMappings: true,
    draft: {
      rules: { origin: input.ruleOrigin ?? 'builtin-storyforge' },
      gmMode: input.gmMode,
      seats: input.seats ?? [{
        seatKey: 'player.1', label: player.name,
        controller: input.playerController, role: 'player',
        characterMode: 'world-template', sourceCharacterResourceKey: player.resourceKey,
        characterName: player.name, rankTier: null,
        privateGoal: '查明求救信号的来源，同时保护仍在港内的人。',
      }],
    },
  })
  productBrief.ttrpg = ttrpgBrief
  const rulePack = await resolveTtrpgProductionRulePackV2({ scope: input.scope, brief: ttrpgBrief })
  const rulePackContentHash = await hashProductProductionValueV2(rulePack)
  const worldSourceBundle = await buildProductWorldSourceBundleV1({
    world: input.sourceCatalog.world,
    release: input.sourceCatalog.release,
    resources: input.sourceCatalog.resources,
  })
  if (!await verifyProductWorldSourceBundleV1(worldSourceBundle)) {
    throw new Error('现行 TTRPG 测试世界未形成合法 ProductWorldSourceBundle')
  }
  const narrative = createCurrentNarrativeFixture()
  const campaign = compileProductionTtrpgCampaignV2({
    productionKey: `current.ttrpg.${input.playerController}.${input.gmMode}`,
    brief: ttrpgBrief,
    selection,
    narrative,
    sourceCatalog: input.sourceCatalog,
    rulePack,
    worldContentHash: input.worldRelease.contentHash,
    worldSourceBundleHash: worldSourceBundle.bundleHash,
  })
  const ttrpg = {
    rulePack: { content: rulePack, contentHash: rulePackContentHash },
    campaign,
    compatibility: { runtimeProtocol: 1 as const, minimumPlayerVersion: 1 as const },
  }
  const modules = buildUpperProductModulesV1({
    brief: productBrief,
    narrative,
    sourceCatalog: input.sourceCatalog,
    ttrpg,
  })
  return parseProductRuntimePackageV1({
    schema: 'storyforge.product-runtime-package', version: 1, productType: 'ttrpg',
    definition: {
      productKey: `current.ttrpg.${input.playerController}.${input.gmMode}`,
      title: input.title ?? 'Current TTRPG', description: '现行统一 Product Build 跑团运行包。',
      enabledCapabilities: modules.enabledCapabilities,
      rulesetVersion: 1,
      initialVariables: { productAdapterId: modules.adapterId },
    },
    sourceWorld: { contentHash: input.worldRelease.contentHash, selection },
    narrative,
    ttrpg,
    presentation: { version: 1, cues: [], assets: [] },
  })
}
