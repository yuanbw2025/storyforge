import captured from './fixtures/sfqa105-creator-source-refs.json'
import JSZip from 'jszip'
import { db } from '../../src/lib/db/schema'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { assertTrustedProjectBackup } from '../../src/lib/export/backup-trust'
import { importProjectJSON, type ProjectExportData } from '../../src/lib/export/json-export'
import { readTextOpenWorldArtifactGovernanceV1 } from '../../src/lib/open-world/creator-artifact-governance'
import { readAcceptedBuildArtifacts } from '../../src/lib/product-production/artifact-store'
import {
  recoverImportedProductProductionProofsV1,
  runProductProductionSchedulerCycleV1,
} from '../../src/lib/product-production/scheduler'
import {
  projectTextOpenWorldNpcRuntimeCatalogAuthorEditableDraftV1,
  rebuildTextOpenWorldNpcRuntimeCatalogFromAuthorEditableDraftV1,
  type TextOpenWorldNpcRuntimeInputContextV1,
} from '../../src/lib/open-world/npc-runtime-catalog-production'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
} from '../../src/lib/product-production/hash'
import { hashTextOpenWorldCreatorEditPatchV1 } from '../../src/lib/open-world/creator-artifact-edit-contract'
import {
  applyTextOpenWorldCreatorEditPatchToAuthorEditableDraftV1,
  projectTextOpenWorldCreatorAuthorEditableDraftV1,
  rebuildTextOpenWorldCreatorArtifactsFromAuthorEditableDraftV1,
} from '../../src/lib/open-world/creator-artifact-edit-dispatch'
import type { TextOpenWorldNpcRuntimeCatalogV1, WorkspaceScope } from '../../src/lib/types'

export const SFQA105_ARTIFACT_KEY = 'text-open-world.npc-runtime-catalog' as const
export const SFQA105_TASK_KEY = 'p8.catalog.npc-runtime' as const
export type Sfqa105Reuse = 'none' | 'once' | 'multiple' | 'vendor-v3'

interface ActorDraft {
  demandNumber: number
  name: string
  biography: string
  portrayal: string
  factionNumber: number
  scheduleActivities: string[]
}

interface FactionDraft {
  demandNumber: number
  description: string
  publicGoal: string
  moralityMultiplier: -1 | 0 | 1
}

interface Draft {
  schema: 'storyforge.text-open-world-npc-runtime-draft'
  version: 1 | 2 | 3
  actors: Array<ActorDraft | { demandNumber: number; reuseActorDemandNumber: number }>
  factions: Array<FactionDraft | { demandNumber: number; reuseFactionDemandNumber: number }>
  attitudeBands: Array<Pick<TextOpenWorldNpcRuntimeCatalogV1['relationshipPolicy']['attitudeBands'][number], 'attitude' | 'label' | 'greetingTone'>>
}

export interface Sfqa105CatalogFixture {
  artifact: TextOpenWorldNpcRuntimeCatalogV1
  context: TextOpenWorldNpcRuntimeInputContextV1
  contextText: string
}

export async function createSfqa105CatalogFixture(reuse: Sfqa105Reuse): Promise<Sfqa105CatalogFixture> {
  // The public compiler validates the captured JSON before it can become a
  // source for any test variant. No hash or identity authority is mocked.
  const seed: { producer: Omit<Sfqa105CatalogFixture, 'contextText'> } = JSON.parse(JSON.stringify(captured))
  const { artifact: baseArtifact, context } = seed.producer
  await projectTextOpenWorldNpcRuntimeCatalogAuthorEditableDraftV1({ artifact: baseArtifact, context })
  const draft: Draft = {
    schema: 'storyforge.text-open-world-npc-runtime-draft',
    version: reuse === 'none' ? 1 : reuse === 'vendor-v3' ? 3 : 2,
    actors: context.actorDemands.map(demand => ({
      demandNumber: demand.demandNumber,
      name: `角色${demand.demandNumber}`,
      biography: `人物${demand.demandNumber}的独立小传，来源${demand.sourceDemandKey}。`,
      portrayal: `人物${demand.demandNumber}保持其独立的表达和已知边界。`,
      factionNumber: context.factionDemands.length ? 1 : 0,
      scheduleActivities: demand.runtimeMode === 'rule-driven'
        ? ['清晨', '白天', '傍晚', '夜晚'].map(period => `人物${demand.demandNumber}在${period}的独立活动。`) : [],
    })),
    factions: context.factionDemands.map(demand => ({
      demandNumber: demand.demandNumber,
      description: `势力${demand.demandNumber}的独立描述。`,
      publicGoal: `势力${demand.demandNumber}保持独立的公开目标。`,
      moralityMultiplier: 0 as const,
    })),
    attitudeBands: baseArtifact.relationshipPolicy.attitudeBands.map(({ attitude, label, greetingTone }) => ({ attitude, label, greetingTone })),
  }
  const reuseActor = (number: number, target: number) => {
    draft.actors[number - 1] = { demandNumber: number, reuseActorDemandNumber: target }
  }
  const reuseFaction = (number: number, target: number) => {
    draft.factions[number - 1] = { demandNumber: number, reuseFactionDemandNumber: target }
  }
  if (reuse !== 'none') {
    reuseActor(7, 1)
    reuseFaction(3, 1)
  }
  if (reuse === 'multiple' || reuse === 'vendor-v3') {
    reuseActor(8, 4)
    reuseActor(10, 1)
    reuseActor(13, 3)
    reuseFaction(4, 2)
    reuseFaction(5, 1)
  }
  if (reuse === 'vendor-v3') {
    for (const vendor of context.actorDemands.filter(row => row.demandKind === 'vendor-service')) {
      const owner = context.actorDemands.find(row => row.fixedActorKey && row.demandKind === 'content-requirement'
        && row.regionKey === vendor.regionKey && row.homeLocationKey === vendor.homeLocationKey
        && row.runtimeMode === 'rule-driven')
        ?? context.actorDemands.find(row => row.fixedActorKey && row.demandKind === 'content-requirement'
          && row.regionKey === vendor.regionKey && row.homeLocationKey === vendor.homeLocationKey)
      if (!owner) throw new Error('SFQA105 captured fixture has no legitimate vendor owner')
      reuseActor(vendor.demandNumber, owner.demandNumber)
    }
  }
  const artifact = await rebuildTextOpenWorldNpcRuntimeCatalogFromAuthorEditableDraftV1({ baseArtifact, context, draft })
  return { artifact, context, contextText: canonicalProductProductionJsonV2(context) }
}

export function sfqa105Artifacts(fixture: Sfqa105CatalogFixture) {
  return [{ artifactKey: SFQA105_ARTIFACT_KEY, payload: fixture.artifact }]
}

export function projectSfqa105Target(fixture: Sfqa105CatalogFixture, entityIdentity: string | null) {
  return projectTextOpenWorldCreatorAuthorEditableDraftV1({
    taskKey: SFQA105_TASK_KEY, artifacts: sfqa105Artifacts(fixture), context: fixture.contextText,
    target: { artifactKey: SFQA105_ARTIFACT_KEY, entityIdentity },
  })
}

export function readSfqa105Pointer(root: unknown, pointer: string): unknown {
  let current = root
  for (const segment of pointer.slice(1).split('/')) {
    if (Array.isArray(current)) current = current[Number(segment)]
    else if (current != null && typeof current === 'object') current = Reflect.get(current, segment)
    else throw new Error(`SFQA105 invalid pointer:${pointer}`)
  }
  return current
}

export async function editSfqa105Target(input: {
  fixture: Sfqa105CatalogFixture
  entityIdentity: string | null
  suffix: string
  value: string | string[] | number
}) {
  const projection = await projectSfqa105Target(input.fixture, input.entityIdentity)
  const field = projection.editableFields.find(row => row.jsonPointer.endsWith(input.suffix))
  if (!field) throw new Error(`SFQA105 target field missing:${input.entityIdentity}/${input.suffix}`)
  const patch = {
    schema: 'storyforge.text-open-world-creator-edit-patch' as const,
    version: 1 as const,
    baseDraftHash: projection.draftHash,
    operations: [{ op: 'replace' as const, fieldId: field.fieldId, baseValueHash: field.baseValueHash, value: input.value }],
  }
  const applied = await applyTextOpenWorldCreatorEditPatchToAuthorEditableDraftV1({
    draft: projection.draft, draftHash: projection.draftHash, editableFields: projection.editableFields,
    patch: { ...patch, patchHash: await hashTextOpenWorldCreatorEditPatchV1(patch) },
  })
  const rebuilt = await rebuildTextOpenWorldCreatorArtifactsFromAuthorEditableDraftV1({
    taskKey: SFQA105_TASK_KEY, baseArtifacts: sfqa105Artifacts(input.fixture), context: input.fixture.contextText,
    draft: applied.draft, target: { artifactKey: SFQA105_ARTIFACT_KEY, entityIdentity: input.entityIdentity },
  })
  const artifact: TextOpenWorldNpcRuntimeCatalogV1 = JSON.parse(canonicalProductProductionJsonV2(rebuilt.artifacts[0].payload))
  return { projection, field, applied, rebuilt, artifact }
}

export async function rehashSfqa105Catalog(artifact: TextOpenWorldNpcRuntimeCatalogV1) {
  const { npcRuntimeCatalogHash: _hash, ...body } = artifact
  return { ...body, npcRuntimeCatalogHash: await hashProductProductionValueV2(body) }
}

interface GovernedCapture {
  governed?: ProjectExportData
  native?: {
    productionKey: string
    artifactKey: string
    entityIdentity: string
    sourceDemandKey: string
    demandNumber: number
    aliasNumber: number
    name: string
    biography: string
    pointer: string
    capabilityBindings: NonNullable<Parameters<typeof runProductProductionSchedulerCycleV1>[0]['capabilityBindings']>
  }
}

type GovernedCaptureEnvelope = { encoding: string; entry: string; rawBytes: number; sha256: string; data: string }

export async function readSfqa105GovernedCapture(
  version: 'historical' | 'current' = 'historical',
): Promise<GovernedCapture> {
  const data: { governedCapture?: GovernedCaptureEnvelope; currentGovernedCapture?: GovernedCaptureEnvelope } =
    JSON.parse(JSON.stringify(captured))
  const envelope = version === 'current' ? data.currentGovernedCapture : data.governedCapture
  if (!envelope || envelope.encoding !== 'zip-base64') throw new Error('SFQA105 governed fixture envelope is missing')
  const archive = await JSZip.loadAsync(envelope.data, { base64: true, checkCRC32: true })
  const file = archive.file(envelope.entry)
  if (!file) throw new Error('SFQA105 governed fixture entry is missing')
  const raw = await file.async('string')
  const bytes = new TextEncoder().encode(raw)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const hash = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('')
  if (bytes.byteLength !== envelope.rawBytes || hash !== envelope.sha256) throw new Error('SFQA105 governed fixture bytes changed')
  const fixture: GovernedCapture = JSON.parse(raw)
  if (!fixture.governed || !fixture.native) throw new Error('SFQA105 governed fixture generation is still pending')
  assertTrustedProjectBackup(fixture.governed)
  return fixture
}

export async function seedSfqa105GovernedBuild(options: { includeComparisonHashes?: boolean } = {}) {
  const fixture = await readSfqa105GovernedCapture('current')
  if (!fixture.governed || !fixture.native) throw new Error('SFQA105 governed fixture metadata is missing')
  const projectId = await importProjectJSON(structuredClone(fixture.governed))
  const production = await db.productProductions.where('projectId').equals(projectId)
    .filter(row => row.productionKey === fixture.native!.productionKey).first()
  if (!production?.id || !production.worldId || !production.workId || !production.currentBuildNumber) {
    throw new Error('SFQA105 imported product ownership is incomplete')
  }
  const scope: WorkspaceScope = { projectId, worldId: production.worldId, workId: production.workId }
  await recoverImportedProductProductionProofsV1({ scope, productionId: production.id })
  const governance = await readTextOpenWorldArtifactGovernanceV1({ scope, productionId: production.id })
  if (governance.summary.currentProblemArtifactCount) throw new Error('SFQA105 imported DAG proof is not valid')
  const build = await db.productBuilds.where('[productionId+buildNumber]')
    .equals([production.id, production.currentBuildNumber]).first()
  if (!build?.id || build.status !== 'release-ready') throw new Error('SFQA105 parent is not a governed complete Build')
  const artifacts = await readAcceptedBuildArtifacts({ scope, buildId: build.id })
  const npc = artifacts.find(row => row.artifactKey === SFQA105_ARTIFACT_KEY)
  if (!npc) throw new Error('SFQA105 parent NPC catalog is missing')
  const catalog: TextOpenWorldNpcRuntimeCatalogV1 = JSON.parse(npc.payloadJson)
  const actor = catalog.actors.find(row => `character:${row.key}` === fixture.native!.entityIdentity)
  if (!actor || actor.sourceDemandKey !== fixture.native.sourceDemandKey || actor.biography !== fixture.native.biography) {
    throw new Error('SFQA105 native target differs from its real producer fixture')
  }
  return {
    ...fixture.native, scope, productionId: production.id, buildId: build.id, buildNumber: build.buildNumber,
    // This snapshot was actually verified above after imported proof recovery.
    // Consumers preparing an edit still perform their own current-state checks.
    governanceSnapshotHash: governance.snapshotHash,
    // SFQA105 uses these comparison-only digests for parent immutability;
    // admission-only consumers do not use them. Never cache DB state between cases.
    buildHash: options.includeComparisonHashes === false ? null : await hashProductProductionValueV2(build),
    artifactsHash: options.includeComparisonHashes === false ? null
      : await hashProductProductionValueV2(await db.productBuildArtifacts.where('buildId').equals(build.id).toArray()),
    catalog,
    modelResponses: await db.agentRunEvents.where('projectId').equals(projectId).filter(row => row.type === 'model.responded').count(),
  }
}

export async function adoptSfqa105RepairTarget(input: Awaited<ReturnType<typeof seedSfqa105GovernedBuild>>) {
  let transportCalls = 0
  const stop = 'SFQA105-target-accepted-stop-before-downstream'
  try {
    await runProductProductionSchedulerCycleV1({
      scope: input.scope, productionId: input.productionId,
      capabilityBindings: input.capabilityBindings,
      executor: async () => { transportCalls += 1; throw new Error('SFQA105 unexpected unrelated executor') },
      onDurableBoundary: (boundary, snapshot) => {
        // The public boundary follows terminal receipt and Artifact acceptance.
        // End the test before unrelated descendants can request new production.
        if (boundary === 'artifact.accepted' && snapshot.contract.scope.productProduction?.taskKey === SFQA105_TASK_KEY) {
          throw new Error(stop)
        }
      },
    })
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes(stop)) throw error
  }
  const child = await db.productBuilds.where('[productionId+buildNumber]')
    .equals([input.productionId, input.buildNumber + 1]).first()
  if (!child?.id) throw new Error('SFQA105 UI did not create the direct child Build')
  const artifacts = await readAcceptedBuildArtifacts({ scope: input.scope, buildId: child.id })
  const npc = artifacts.find(row => row.artifactKey === SFQA105_ARTIFACT_KEY)
  if (!npc) throw new Error('SFQA105 scheduler did not adopt the staged NPC target')
  if (!npc.producerRunId) throw new Error('SFQA105 target has no real producer Run')
  const targetRun = await readAgentRunV1(input.scope, npc.producerRunId)
  const catalog: TextOpenWorldNpcRuntimeCatalogV1 = JSON.parse(npc.payloadJson)
  return {
    childId: child.id, childNumber: child.buildNumber,
    transportCalls, catalog,
    targetState: targetRun.projection.state,
    targetReceiptMatches: targetRun.projection.terminalReceiptHash === npc.producerReceiptHash,
    parentBuildHash: await hashProductProductionValueV2(await db.productBuilds.get(input.buildId)),
    parentArtifactsHash: await hashProductProductionValueV2(await db.productBuildArtifacts.where('buildId').equals(input.buildId).toArray()),
    modelResponses: await db.agentRunEvents.where('projectId').equals(input.scope.projectId).filter(row => row.type === 'model.responded').count(),
  }
}
