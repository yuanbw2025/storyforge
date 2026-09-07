import { db } from '../../src/lib/db/schema'
import { buildUpperProductModulesV1 } from '../../src/lib/product-production/product-adapters'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import { createTextOpenWorldInstance } from '../../src/lib/product/runtime-instances'
import type {
  ProductProductionBriefV3,
  ProductRelease,
  ProductRuntimePackageV1,
  ProductRuntimeSession,
  TextOpenWorldRuntimePackageV1,
} from '../../src/lib/types'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import {
  CURRENT_PRODUCT_RESOURCE_KEYS,
  CURRENT_PRODUCT_SOURCE_CATALOG,
  currentProductSelection,
} from './current-product-world'
import { createFixtureProductReleaseManifestV1 } from './product-release-v1'

function narrative(): ProductRuntimePackageV1['narrative'] {
  return {
    moduleKind: 'main',
    moduleTitle: '盐脊断流',
    entryNodeKey: 'opening',
    nodes: [
      {
        key: 'opening', kind: 'entry', title: '港口求援', summary: '调查盐渠断流。',
        conditionJson: '{}', effectsJson: '[]', successorKeys: ['ending.cooperate'],
      },
      {
        key: 'ending.cooperate', kind: 'ending', title: '共管盐渠', summary: '两地共同维护盐渠。',
        conditionJson: '{}', effectsJson: '[]', successorKeys: [],
      },
    ],
    beats: [
      { beatKey: 'beat.opening', nodeKey: 'opening', kind: 'narration', speakerKey: null, text: '盐渠在清晨断流。', order: 0 },
      { beatKey: 'beat.ending', nodeKey: 'ending.cooperate', kind: 'narration', speakerKey: null, text: '盐渠重新流动。', order: 0 },
    ],
    choices: [{
      choiceKey: 'choice.investigate', sourceNodeKey: 'opening', text: '调查盐渠', description: '',
      unavailableReason: '', targetNodeKey: 'ending.cooperate', displayConditionJson: '{}',
      availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 0,
    }],
  }
}

function brief(sourceHash: string): ProductProductionBriefV3 {
  return {
    schema: 'storyforge.product-production-brief', version: 3,
    source: {
      worldReleaseId: 1,
      worldContentHash: sourceHash,
      selection: currentProductSelection('text-open-world', {
        characters: [CURRENT_PRODUCT_RESOURCE_KEYS.character],
        regions: [CURRENT_PRODUCT_RESOURCE_KEYS.location],
        items: [CURRENT_PRODUCT_RESOURCE_KEYS.artifact],
        factions: [CURRENT_PRODUCT_RESOURCE_KEYS.lore],
        quests: [CURRENT_PRODUCT_RESOURCE_KEYS.arc],
      }),
      startingPoint: {
        kind: 'mainline', title: '盐脊断流', summary: '调查盐渠断流。',
        sourceRefs: [CURRENT_PRODUCT_RESOURCE_KEYS.story],
        protagonistRefs: [CURRENT_PRODUCT_RESOURCE_KEYS.character],
        openingConflict: '盐港与断脊争夺最后的供水。',
      },
    },
    intent: {
      productType: 'text-open-world', playerRole: '来客',
      protagonistRefs: [CURRENT_PRODUCT_RESOURCE_KEYS.character],
      openingSituation: '从盐港开始调查断流。',
      coreExperience: ['调查', '成长', '抉择'], requiredFacts: [], forbiddenChanges: [],
      contentBoundaries: [], tone: ['克制', '冒险'],
    },
    scale: { scope: 'scene', targetPlayMinutes: 15, targetWordCount: 2_500, targetEndingCount: 1 },
    media: {
      visualLevel: 'none', audioLevel: 'none', imageCount: 0, musicTrackCount: 0,
      sfxCount: 0, voiceLineCount: 0, requiredMediaKinds: [],
    },
    consultationBudget: {
      maximumModelCalls: 1, maximumInputTokens: 1_000, maximumOutputTokens: 1_000,
      maximumCostUsd: null,
    },
    productionBudget: {
      maximumModelCalls: 1, maximumInputTokens: 1_000, maximumOutputTokens: 1_000,
      maximumCostUsd: null, maximumMediaCalls: 0, maximumDurationMs: 60_000,
      maximumStorageBytes: 1_000_000,
    },
    qualityProfile: 'internal', capabilityRequirements: [],
    externalDataPolicy: {
      allowedDataClasses: ['world-selection'], forbiddenDataClasses: ['api-key'],
      allowReferenceImages: false, allowVoiceScripts: false,
    },
    fallbackPolicy: {
      allowTextOnly: true, allowExistingProjectMedia: false, allowProceduralAudio: false,
      onRequiredCapabilityMissing: 'pause',
    },
    completionContract: {
      requiresPlayablePreview: true,
      requiredGateIds: ['runtime.package.valid', 'runtime.playable', 'narrative.graph.valid', 'rights.complete'],
      minimumMediaCoverage: 0, allowSoftWaivers: true,
    },
    unresolvedDecisionKeys: [],
  }
}

export function createTextOpenWorldProductRuntimePackageFixtureV1(
  textOpenWorldVNext: TextOpenWorldRuntimePackageV1,
): ProductRuntimePackageV1 {
  const currentBrief = brief(textOpenWorldVNext.sourceManifest.contentHash)
  const frozenNarrative = narrative()
  const modules = buildUpperProductModulesV1({
    brief: currentBrief,
    narrative: frozenNarrative,
    sourceCatalog: CURRENT_PRODUCT_SOURCE_CATALOG,
  })
  return parseProductRuntimePackageV1({
    schema: 'storyforge.product-runtime-package', version: 1, productType: 'text-open-world',
    definition: {
      productKey: textOpenWorldVNext.metadata.packageKey,
      title: textOpenWorldVNext.metadata.title,
      description: textOpenWorldVNext.metadata.description,
      enabledCapabilities: [...modules.enabledCapabilities, 'textOpenWorldVNext'],
      rulesetVersion: textOpenWorldVNext.metadata.rulesetVersion,
      initialVariables: { productAdapterId: modules.adapterId },
    },
    sourceWorld: {
      contentHash: textOpenWorldVNext.sourceManifest.contentHash,
      selection: currentBrief.source.selection,
    },
    narrative: frozenNarrative,
    interaction: modules.interaction,
    adventure: modules.adventure,
    openWorldEvolution: modules.openWorldEvolution,
    openWorld: modules.openWorld,
    textOpenWorldVNext,
  })
}

export function createTextOpenWorldVNextOnlyProductRuntimePackageFixtureV1(
  textOpenWorldVNext: TextOpenWorldRuntimePackageV1,
): ProductRuntimePackageV1 {
  const hybrid = createTextOpenWorldProductRuntimePackageFixtureV1(textOpenWorldVNext)
  return parseProductRuntimePackageV1({
    schema: hybrid.schema,
    version: hybrid.version,
    productType: hybrid.productType,
    definition: {
      ...hybrid.definition,
      enabledCapabilities: ['narrative', 'textOpenWorldVNext'],
    },
    sourceWorld: hybrid.sourceWorld,
    narrative: hybrid.narrative,
    textOpenWorldVNext,
  })
}

export async function createGovernedTextOpenWorldSessionFixtureV1(input: {
  name: string
  textOpenWorldVNext: TextOpenWorldRuntimePackageV1
  runtimeShape?: 'hybrid' | 'vnext-only'
  title?: string
  seed?: string
  status?: ProductRuntimeSession['status']
  releaseVersion?: number
}) {
  const created = await createWorkspace({
    name: input.name,
    genres: ['open-world'], status: 'drafting', description: '', targetWordCount: 1,
    enableMultiWorld: false,
  }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
  const runtimePackage = input.runtimeShape === 'vnext-only'
    ? createTextOpenWorldVNextOnlyProductRuntimePackageFixtureV1(input.textOpenWorldVNext)
    : createTextOpenWorldProductRuntimePackageFixtureV1(input.textOpenWorldVNext)
  const productionKey = `fixture.text-open-world.${crypto.randomUUID()}`
  const manifest = await createFixtureProductReleaseManifestV1({
    runtimePackage,
    productionKey,
    releaseVersion: input.releaseVersion,
  })
  const now = Date.now()
  const release: ProductRelease = {
    projectId: created.scope.projectId,
    worldId: created.scope.worldId,
    workId: created.scope.workId,
    productionKey: manifest.productionProvenance.productionKey,
    productType: 'text-open-world',
    worldReleaseId: null,
    version: input.releaseVersion ?? 1,
    label: `${input.name} v${input.releaseVersion ?? 1}`,
    manifestJson: JSON.stringify(manifest),
    contentHash: await hashProductProductionValueV2(manifest),
    createdAt: now,
  }
  release.id = await db.productReleases.add(release) as number
  const session = await createTextOpenWorldInstance({
    scope: created.scope,
    productReleaseId: release.id,
    title: input.title ?? input.name,
    seed: input.seed,
  })
  if (input.status && input.status !== session.status) {
    await db.productRuntimeSessions.update(session.id!, { status: input.status, updatedAt: now + 1 })
    session.status = input.status
    session.updatedAt = now + 1
  }
  return { ...created, runtimePackage, manifest, release, session }
}
