import { db } from '../../src/lib/db/schema'
import { createAvgDraftV1, selectAvgWorldV1 } from '../../src/lib/avg/draft-service'
import { createMistHarborWorld } from '../../src/lib/world-engine/mist-harbor-preset'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { stageAvgAuthorArtifactV1 } from '../../src/lib/avg/author-artifacts'
import { PROFESSIONAL_FIXTURES } from './avg-private-contract-fixture'
import type { AvgProfessionalArtifactV1 } from '../../src/lib/avg/artifact-contract'

export async function seedAvgAuthorArtifacts() {
  const avg = await createAvgDraftV1('AVG 作者工件隔离夹具')
  const source = await createMistHarborWorld()
  const selected = await selectAvgWorldV1(avg.scope, 0, source.worldReleaseId)
  const releaseId = selected.worldReleaseId!
  const suggestions = await suggestProductStartingPoints({ scope: avg.scope, worldReleaseId: releaseId })
  const brief = await draftProductProductionBriefV3({ scope: avg.scope, worldReleaseId: releaseId,
    suggestionKey: suggestions.suggestions[0]!.suggestionKey, productType: 'avg', scale: 'scene',
    visualLevel: 'none', audioLevel: 'none', requiredFacts: [], forbiddenChanges: ['不回写源世界'] })
  const created = await executeProductProductionCommand({ scope: avg.scope, command: { type: 'create-intent',
    commandId: 'avg.author.intent', productionKey: 'avg.author.fixture', productType: 'avg', worldReleaseId: releaseId, userText: '作者提供原创场景' } })
  const saved = await executeProductProductionCommand({ scope: avg.scope, productionId: created.productionId,
    command: { type: 'save-brief-revision', commandId: 'avg.author.brief', expectedStateRevision: created.stateRevision, parentRevision: null, brief } })
  const started = await executeProductProductionCommand({ scope: avg.scope, productionId: created.productionId,
    command: { type: 'authorize-start', commandId: 'avg.author.start', expectedStateRevision: saved.stateRevision,
      briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: 'avg.author.click' } })
  if (!started.ok) throw new Error('fixture start failed')
  const buildId = started.result.buildId as number
  const build = (await db.productBuilds.get(buildId))!
  // The future role planner will compile these exact human-import tasks.
  // This fixture freezes only the bounded adoption seam, without a model,
  // player, semantic quality gate or finished runtime package.
  const plan = parseProductProductionPlanV3({ schema: 'storyforge.product-production-plan', version: 3, productType: 'avg',
    briefHash: build.briefHash, buildNumber: build.buildNumber, controlEpoch: build.controlEpoch,
    concurrency: { maximumCostBearingTasks: 1, maximumTextProviderTasks: 1, maximumMediaProviderTasks: 1 }, terminalTaskKey: 'author.7',
    tasks: PROFESSIONAL_FIXTURES.map(({ key }, index) => ({ taskKey: `author.${index}`, kind: 'avg-author-artifact', lane: 'content',
      skillId: null, executionMode: 'human-import', dependsOn: index ? [`author.${index - 1}`] : [],
      requiredReceipts: index ? [{ taskKey: `author.${index - 1}`, receiptHash: null }] : [],
      inputArtifactKeys: index ? [PROFESSIONAL_FIXTURES[index - 1]!.key,
        ...(index === 7 ? ['avg.content.scene-script.archive'] : [])] : [],
      outputArtifactKeys: [key], requirementKeys: [], capabilityRequirementKeys: [], concurrencyGroup: 'author', subjectLockKeys: [key],
      priority: 1, maxAttempts: 1, timeoutMs: 60000, failurePolicy: 'pause', fallbackTaskKey: null,
      acceptanceGateIds: ['avg.artifact.structure'], reuse: null,
      budgetReservation: { modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0, maximumCostUsd: 0, durationMs: 0, storageBytes: 0 },
    })),
  }, brief, build.briefHash)
  await db.productBuilds.update(buildId, { planJson: canonicalProductProductionJsonV2(plan), planHash: await hashProductProductionValueV2(plan), planRevision: 1 })
  return { ...avg, productionId: created.productionId, buildId, plan, releaseId }
}

export function originalAuthorPayload(index: number): AvgProfessionalArtifactV1 {
  const payload = structuredClone(PROFESSIONAL_FIXTURES[index]!.payload)
  if (payload.schema === 'storyforge.avg.source-audit') { payload.facts = []; payload.proposedSupplements = ['信封情节为作者原创私域补充'] }
  if (payload.schema === 'storyforge.avg.story-bible') payload.sourceFactKeys = []
  if (payload.schema === 'storyforge.avg.cast-bible') {
    payload.characters[0]!.sourceResourceKey = null; payload.characters[0]!.proposedOrigin = '作者原创成年人物'; payload.characters[0]!.knowledgeKeys = []
  }
  if (payload.schema === 'storyforge.avg.route-plan') payload.routes[0]!.revealFactKeys = []
  if (payload.schema === 'storyforge.avg.scene-script') payload.lines[0]!.informationKeys = []
  return payload
}

export async function stageAuthorFixture(s: Awaited<ReturnType<typeof seedAvgAuthorArtifacts>>, index: number, payload = originalAuthorPayload(index)) {
  const build = (await db.productBuilds.get(s.buildId))!
  return stageAvgAuthorArtifactV1({ scope: s.scope, buildId: s.buildId, expectedBuildRevision: build.stateRevision,
    controlEpoch: build.controlEpoch, taskKey: `author.${index}`, artifactKey: PROFESSIONAL_FIXTURES[index]!.key,
    kind: payload.schema === 'storyforge.avg.review-issues' ? 'quality-report' : 'narrative', payload,
    declaration: '测试原创输入，工程夹具，不是商业或人工内容验收' })
}

export async function authorFixtureCommand(s: Awaited<ReturnType<typeof seedAvgAuthorArtifacts>>, candidate: Awaited<ReturnType<typeof stageAuthorFixture>>, commandId = crypto.randomUUID()) {
  const production = (await db.productProductions.get(s.productionId))!
  const build = (await db.productBuilds.get(s.buildId))!
  return { type: 'adopt-avg-artifact' as const, commandId, expectedStateRevision: production.stateRevision,
    expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch, buildNumber: build.buildNumber,
    artifactKey: candidate.artifactKey, candidateVersion: candidate.version, candidateHash: JSON.parse(candidate.metadataJson).candidateHash as string }
}

export async function acceptAuthorPrefix(s: Awaited<ReturnType<typeof seedAvgAuthorArtifacts>>, count = 6) {
  for (let index = 0; index < count; index++) {
    const candidate = await stageAuthorFixture(s, index)
    const receipt = await executeProductProductionCommand({ scope: s.scope, productionId: s.productionId, command: await authorFixtureCommand(s, candidate) })
    if (!receipt.ok) throw new Error(String(receipt.result.message))
  }
}
