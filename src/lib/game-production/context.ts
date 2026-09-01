import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import type { AssembleContextInput } from '../registry/types'
import { assertRecordInScope } from '../world-engine/scope'
import { loadGameProductionWorldSourceCatalogV2 } from './world-source'

function requiredScope(input: AssembleContextInput): WorkspaceScope {
  if (!input.scope) throw new Error('[game-production-context] 缺少已解析 WorkspaceScope')
  return input.scope
}

function requiredId(value: number | undefined, label: string): number {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) throw new Error(`[game-production-context] 缺少 ${label}`)
  return value!
}

export async function readGameProductionConsultationSource(input: AssembleContextInput): Promise<string> {
  const scope = requiredScope(input)
  const releaseId = requiredId(input.gameWorldReleaseId, 'gameWorldReleaseId')
  const gameCatalog = await loadGameProductionWorldSourceCatalogV2({ scope, worldReleaseId: releaseId })
  const option = (value: { resourceKey: string; name: string; description: string }, kind: string) => ({
    resourceKey: value.resourceKey, label: value.name, summary: value.description, kind,
  })
  return JSON.stringify({
    schema: 'storyforge.game-production.consultation-source', version: 1,
    worldReference: gameCatalog.worldReference,
    release: gameCatalog.release,
    world: gameCatalog.world,
    availableResources: gameCatalog.resources.map(resource => ({
      resourceKey: resource.descriptor.resourceKey,
      area: resource.descriptor.worldSemantic.area,
      resourceKind: resource.descriptor.worldSemantic.resourceKind,
    })),
    opportunities: {
      storySources: gameCatalog.storySources.slice(0, 30).map(value => option(value, 'story-source')),
      characters: gameCatalog.characters.slice(0, 30).map(value => option(value, 'character')),
      storyArcs: gameCatalog.storyArcs.slice(0, 30).map(value => option(value, value.type || 'story-arc')),
      locations: gameCatalog.locations.slice(0, 30).map(value => option(value, 'location')),
      historicalTimelineEvents: gameCatalog.resources
        .filter(resource => resource.descriptor.worldSemantic.resourceKind === 'historical-event')
        .slice(0, 30).map(resource => ({
          resourceKey: resource.descriptor.resourceKey,
          label: resource.descriptor.title,
          summary: resource.descriptor.shortSummary,
          kind: 'historical-event',
        })),
    },
    selectionOptions: {
      storySources: gameCatalog.storySources.map(item => option(item, 'story-source')),
      characters: gameCatalog.characters.map(item => option(item, 'character')),
      importantLocations: gameCatalog.locations.map(item => option(item, 'location')),
      artifacts: gameCatalog.artifacts.map(item => option(item, 'artifact')),
      codexEntries: gameCatalog.loreEntries.map(item => option(item, 'lore')),
      storyArcs: gameCatalog.storyArcs.map(item => option(item, item.type || 'story-arc')),
    },
    selectionRelations: gameCatalog.relationships.map(item => ({
      resourceKey: item.resourceKey,
      fromCharacterResourceKey: item.fromCharacterResourceKey,
      toCharacterResourceKey: item.toCharacterResourceKey,
    })),
    selectionCatalog: {
      storyResourceKeys: gameCatalog.storySources.map(item => item.resourceKey),
      characterResourceKeys: gameCatalog.characters.map(item => item.resourceKey),
      importantLocationResourceKeys: gameCatalog.locations.map(item => item.resourceKey),
      // Inventory events are not world assets. Only semantic artifact entries
      // exposed by the neutral gateway may enter a product selection.
      artifactResourceKeys: gameCatalog.artifacts.map(item => item.resourceKey),
      codexEntryResourceKeys: gameCatalog.loreEntries.map(item => item.resourceKey),
      storyArcResourceKeys: gameCatalog.storyArcs.map(item => item.resourceKey),
    },
  })
}

async function productionAndBuild(input: AssembleContextInput) {
  const scope = requiredScope(input)
  const productionId = requiredId(input.gameProductionId, 'gameProductionId')
  const production = await db.gameProductions.get(productionId)
  if (!production || !await assertRecordInScope(scope, 'gameProductions', production, { owner: 'work' })) {
    throw new Error('[game-production-context] Production 不存在或跨 Work')
  }
  const buildId = input.gameBuildId
  const build = buildId == null ? null : await db.gameBuilds.get(buildId)
  if (build && (build.productionId !== productionId
    || !await assertRecordInScope(scope, 'gameBuilds', build, { owner: 'work' }))) {
    throw new Error('[game-production-context] Build 不属于当前 Production/Work')
  }
  return { scope, production, build }
}

export async function readGameProductionBriefContext(input: AssembleContextInput): Promise<string> {
  const { production } = await productionAndBuild(input)
  if (production.currentBriefRevision == null) throw new Error('[game-production-context] Production 尚无当前 Brief')
  const brief = await db.gameProductionBriefs
    .where('[productionId+revision]').equals([production.id!, production.currentBriefRevision]).first()
  if (!brief || brief.status !== 'authorized') throw new Error('[game-production-context] 当前 Brief 未授权')
  return JSON.stringify({
    schema: 'storyforge.game-production.brief-context', version: 1,
    productionKey: production.productionKey, briefRevision: brief.revision, briefHash: brief.briefHash,
    sourceWorldContentHash: brief.sourceWorldContentHash, userIntentSummary: brief.userIntentSummary,
    estimate: JSON.parse(brief.estimateJson), brief: JSON.parse(brief.briefJson),
  })
}

export async function readGameProductionArtifactInputs(input: AssembleContextInput): Promise<string> {
  const { build } = await productionAndBuild(input)
  if (!build) throw new Error('[game-production-context] artifact inputs 需要 gameBuildId')
  const requested = new Set(input.gameArtifactKeys ?? [])
  if (requested.size === 0) throw new Error('[game-production-context] artifact inputs 必须显式选择 artifact keys')
  const artifacts = (await db.gameBuildArtifacts.where('buildId').equals(build.id!).toArray())
    .filter(row => requested.has(row.artifactKey) && (row.status === 'accepted' || row.status === 'carried-forward'))
    .map(row => ({
      artifactKey: row.artifactKey, version: row.version, kind: row.kind, contentHash: row.contentHash,
      producerReceiptHash: row.producerReceiptHash, payload: JSON.parse(row.payloadJson),
      metadata: JSON.parse(row.metadataJson),
    }))
  if (artifacts.length !== requested.size) throw new Error('[game-production-context] 选择的 Artifact 缺失或未验收')
  return JSON.stringify({ schema: 'storyforge.game-production.artifact-inputs', version: 1, buildNumber: build.buildNumber, artifacts })
}

export async function readGameProductionQualityFeedback(input: AssembleContextInput): Promise<string> {
  const { build } = await productionAndBuild(input)
  if (!build) throw new Error('[game-production-context] quality feedback 需要 gameBuildId')
  const requested = new Set(input.gameArtifactKeys ?? [])
  const artifacts = requested.size === 0 ? [] : (await db.gameBuildArtifacts.where('buildId').equals(build.id!).toArray())
    .filter(row => requested.has(row.artifactKey))
    .map(row => ({ artifactKey: row.artifactKey, contentHash: row.contentHash, quality: JSON.parse(row.qualityJson) }))
  return JSON.stringify({
    schema: 'storyforge.game-production.quality-feedback', version: 1,
    buildNumber: build.buildNumber, qualityReportHash: build.qualityReportHash,
    qualityReport: JSON.parse(build.qualityReportJson), artifacts,
  })
}

export async function readGameProductionEvolutionBase(input: AssembleContextInput): Promise<string> {
  const { production, build } = await productionAndBuild(input)
  if (!build) throw new Error('[game-production-context] evolution base 需要 gameBuildId')
  if (!['preview-ready', 'release-ready', 'released'].includes(build.status)) {
    throw new Error('[game-production-context] evolution base 必须是冻结可玩 Build')
  }
  return JSON.stringify({
    schema: 'storyforge.game-production.evolution-base', version: 1,
    productionKey: production.productionKey, buildNumber: build.buildNumber,
    manifestHash: build.manifestHash, packageHash: build.packageHash, previewHash: build.previewHash,
    manifest: JSON.parse(build.manifestJson), compatibility: JSON.parse(build.compatibilityJson),
  })
}
