import { vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { avgSoundProductionFixtureV1 } from './avg-sound-production-fixture'
import { resolveConfiguredTextCapabilityV1 } from '../../src/lib/product-production/capabilities'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { readProductProductionDetailsV1 } from '../../src/lib/product-production/service'
import { createConfiguredProductProductionExecutorV1 } from '../../src/lib/product-production/production-executor'
import { runProductProductionSchedulerCycleV1 } from '../../src/lib/product-production/scheduler'
import { stageAvgAuthorArtifactV1 } from '../../src/lib/avg/author-artifacts'
import { AVG_SOUND_TEXT_CAPABILITY_V1 } from '../../src/lib/avg/sound-production-brief'
import type { ProductBuildArtifactRecordV1 } from '../../src/lib/types'
import type { ProductProductionCapabilityBindingV1 } from '../../src/lib/product-production/scheduler'

/** Isolated actual S2, explicit start, author commands, shared scheduler and
 * configured HTTP. Only the feature fence and network are controlled by tests;
 * never seed a Build/Run, adoption/producer receipt or accepted Artifact. */
export async function avgSoundHarnessFixtureV1(options: { malformed?: boolean; onResponse?: () => Promise<void>; output?: string; libraryOnly?: boolean;
  configureSource?: (source: Awaited<ReturnType<typeof avgSoundProductionFixtureV1>>) => Promise<void>;
  audioFetcher?: (target: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  additionalBindings?: ProductProductionCapabilityBindingV1[] } = {}) {
  const source = await avgSoundProductionFixtureV1(options.libraryOnly === true)
  await options.configureSource?.(source)
  const text = await resolveConfiguredTextCapabilityV1({ projectId: source.owner.scope.projectId, category: 'product-production', requirementKey: AVG_SOUND_TEXT_CAPABILITY_V1 })
  source.brief.capabilityRequirements.find(c => c.requirementKey === AVG_SOUND_TEXT_CAPABILITY_V1)!.capabilityHash = text.receipt.capabilityHash
  const brief = parseProductProductionBriefV3(source.brief), owner = source.owner
  const saved = await executeProductProductionCommand({ scope: owner.scope, productionId: owner.productionId, command: { type: 'save-brief-revision',
    commandId: `sound.save.${crypto.randomUUID()}`, expectedStateRevision: owner.details.production.stateRevision, parentRevision: owner.details.brief!.revision, brief } })
  if (!saved.ok) throw new Error(JSON.stringify(saved))
  const prepared = await readProductProductionDetailsV1(owner.scope, owner.productionId, ['avg'])
  const started = await executeProductProductionCommand({ scope: owner.scope, productionId: owner.productionId, command: { type: 'authorize-start',
    commandId: `sound.start.${crypto.randomUUID()}`, expectedStateRevision: prepared.production.stateRevision, briefRevision: prepared.brief!.revision,
    briefHash: prepared.brief!.briefHash, authorizationNonce: 'explicit-isolated-sound-contract-author-start' } })
  if (!started.ok) throw new Error(JSON.stringify(started))
  const details = await readProductProductionDetailsV1(owner.scope, owner.productionId, ['avg']), buildId = details.build!.id!
  const calls: Array<{ body: Record<string, any>; packet: any }> = []
  const output = options.output ?? (options.malformed ? '{broken sound proposal' : JSON.stringify(source.plan))
  const fetcher = vi.fn(async (target: RequestInfo | URL, init?: RequestInit) => {
    if (String(target) !== 'https://sound-proposal.fixture.invalid/v1/chat/completions') {
      if (options.audioFetcher) return options.audioFetcher(target, init)
      throw new Error('Unconfigured sound network route forbidden')
    }
    const body = JSON.parse(String(init?.body)), context = String(body.messages.find((m: { role: string }) => m.role === 'user').content)
    const packet = JSON.parse(context.slice(context.indexOf('{'), context.lastIndexOf('}') + 1)); calls.push({ body, packet })
    await options.onResponse?.()
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: output } }], usage: { prompt_tokens: 200, completion_tokens: 200 } }),
      { headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetcher)
  const executor = createConfiguredProductProductionExecutorV1({ production: details.production, brief })
  const capabilityBindings = [{ requirementKey: text.receipt.requirementKey, adapterId: text.receipt.adapterId,
    bindingHash: text.receipt.capabilityHash, provider: text.receipt.provider, model: text.receipt.model }, ...(options.additionalBindings ?? [])]
  const s = { ...owner, author: source, brief, buildId, executor, capabilityBindings, calls, fetcher, output }
  await runProductProductionSchedulerCycleV1(s)
  const build = (await db.productBuilds.get(buildId))!, plan = parseProductProductionPlanV3(build.planJson, brief, build.briefHash)
  if (build.status !== 'building') throw new Error(`Actual sound start/cycle not building: ${build.status}; ${build.failureJson}`)
  return { ...s, plan }
}
export type AvgSoundHarnessFixtureV1 = Awaited<ReturnType<typeof avgSoundHarnessFixtureV1>>
export const acceptedAvgSoundArtifactV1 = (s: AvgSoundHarnessFixtureV1, artifactKey: string) => db.productBuildArtifacts.where('[buildId+artifactKey]')
  .equals([s.buildId, artifactKey]).filter(r => r.status === 'accepted').first()
export async function confirmAvgSoundCandidateV1(s: AvgSoundHarnessFixtureV1, candidate: ProductBuildArtifactRecordV1) {
  const details = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg']), build = details.build!, meta = JSON.parse(candidate.metadataJson)
  return executeProductProductionCommand({ scope: s.scope, productionId: s.productionId, command: { type: 'adopt-avg-artifact',
    commandId: `sound.author.${crypto.randomUUID()}`, expectedStateRevision: details.production.stateRevision,
    expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch, buildNumber: build.buildNumber,
    artifactKey: candidate.artifactKey, candidateVersion: candidate.version, candidateHash: meta.candidateHash } })
}
export async function stageAvgSoundArtifactV1(s: AvgSoundHarnessFixtureV1, key: string, payload: unknown) {
  const build = (await db.productBuilds.get(s.buildId))!, task = s.plan.tasks.find(t => t.executionMode === 'human-import' && t.outputArtifactKeys.includes(key))!
  return stageAvgAuthorArtifactV1({ scope: s.scope, buildId: s.buildId, expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch,
    taskKey: task.taskKey, artifactKey: key, kind: key === 'avg.system.plan' ? 'product-module' : key.startsWith('avg.review.') ? 'quality-report'
      : key.startsWith('avg.sound.choice.') || key === 'avg.author.stage' ? 'presentation' : 'narrative', payload,
    declaration: '作者明确采用准确工程声音方案；不代表真实音频、审听或商业质量通过' })
}
export async function adoptAvgSoundArtifactV1(s: AvgSoundHarnessFixtureV1, key: string, payload: unknown) {
  const candidate = await stageAvgSoundArtifactV1(s, key, payload), result = await confirmAvgSoundCandidateV1(s, candidate)
  if (!result.ok) throw new Error(JSON.stringify(result))
  return candidate
}
export async function adoptAvgSoundSourcesV1(s: AvgSoundHarnessFixtureV1) {
  await adoptAvgSoundArtifactV1(s, 'avg.system.plan', s.author.workspace.systemPlan)
  for (const script of s.author.workspace.scripts) await adoptAvgSoundArtifactV1(s, `avg.content.scene-script.${script.sceneKey}`, script)
}
export async function cycleAvgSoundUntilV1(s: AvgSoundHarnessFixtureV1, key: string) {
  for (let i = 0; i < 12; i++) { if (await acceptedAvgSoundArtifactV1(s, key)) return; await runProductProductionSchedulerCycleV1(s) }
  throw new Error(`Sound expected artifact not accepted: ${key}; ${JSON.stringify((await db.productBuilds.get(s.buildId))?.failureJson)}`)
}
