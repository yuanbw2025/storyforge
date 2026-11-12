import { db } from '../../src/lib/db/schema'
import type { TextOpenWorldExperienceInputContextV1 } from '../../src/lib/open-world/experience-design'
import { createTextOpenWorldProductionExecutorV1 } from '../../src/lib/open-world/production-executor'
import { createTextOpenWorldSourceCurationExecutorV1 } from '../../src/lib/open-world/source-curation'
import type { TextOpenWorldProductionModelTransportV1 } from '../../src/lib/open-world/production-model-protocol'
import { resolveConfiguredTextCapabilityV1 } from '../../src/lib/product-production/capabilities'
import { runProductProductionSchedulerCycleV1 } from '../../src/lib/product-production/scheduler'
import type { previewTextOpenWorldCreatorProductionStartV1 } from '../../src/lib/product-production/service'
import type { TextOpenWorldGameBriefV1 } from '../../src/lib/types'

/** Public Start is supplied by the caller. Only the network transport is synthetic;
 * P0/P1/P2 dispatch, registered context, validation and receipts run unchanged. */
export async function runSfqa097CreatorPrefixV1(
  preview: Awaited<ReturnType<typeof previewTextOpenWorldCreatorProductionStartV1>>,
) {
  const requirementKey = 'text-open-world.production.text.v1'
  const binding = preview.start.preflight.providerBinding
  const { receipt } = await resolveConfiguredTextCapabilityV1({
    projectId: preview.scope.projectId, category: 'product-production', requirementKey,
    expectedProviderIdentity: {
      provider: binding.provider, model: binding.model, endpointOrigin: binding.endpointOrigin,
      endpointRouteHash: binding.endpointRouteHash, temperature: binding.temperature,
      configuredMaxTokens: binding.maxTokens, contextWindow: binding.contextWindow,
    },
  })
  const modelCategories: string[] = []
  const modelTransport: TextOpenWorldProductionModelTransportV1 = async request => {
    if (request.requirementKey !== requirementKey || request.expectedCapabilityHash !== receipt.capabilityHash) {
      throw new Error('SFQA097 synthetic transport received a different frozen capability')
    }
    modelCategories.push(request.category)
    let draft: unknown
    if (request.category === 'text-open-world.production.source-curation') {
      const context = JSON.parse(request.contextText) as {
        units: Array<{ unitKey: string; content: string }>
      }
      const target = context.units[0]
      if (!target) throw new Error('SFQA097 P1 received no frozen source unit')
      const quote = target.content.slice(0, 20)
      draft = {
        schema: 'storyforge.text-open-world-source-curation-draft', version: 1,
        unitKeys: context.units.map(unit => unit.unitKey),
        claims: [{
          claimKind: 'plot', canonicalName: '雾港调查',
          statement: '调查者从雾港潮门危机出发，在地区探索中成长并守住核心目标。',
          entityKeys: ['story.sfqa097', 'character.sfqa097'],
          coverageTags: ['story-core', 'protagonist', 'core-conflict', 'character', 'faction', 'place', 'timeline'],
          confidence: 90,
          evidence: [{ unitKey: target.unitKey, quote, start: 0, end: quote.length }],
        }], gaps: [],
      }
    } else if (request.category === 'text-open-world.production.experience-design.v1') {
      const context = JSON.parse(request.contextText) as TextOpenWorldExperienceInputContextV1
      const claimKey = context.selectedClaims[0]?.claimKey
      if (!claimKey) throw new Error('SFQA097 P2 received no accepted P1 claim')
      draft = {
        schema: 'storyforge.text-open-world-experience-draft', version: 1,
        experience: {
          pitch: '在持续演化的雾港及周边地区调查危机，通过主线、重要支线与地区冒险逐步成长。',
          playerFantasy: '成为能够旅行、战斗、调查并影响局部关系的来信调查者。',
          narrativePillars: ['受保护的长程主线', '地区化重要故事', '有后果的边界自由'],
          regionalVarietyPromise: '每个地区具有不同人物需求、风险、资源与可抛弃的小故事。',
          growthPromise: '通过任务、战斗与制作稳定获得等级、技能、装备和关系反馈。',
          toneGuide: ['港口悬疑', '克制', '冒险成长'], sourceClaimKeys: [claimKey],
        },
        protagonist: {
          identitySummary: '调查者熟悉雾港规则，必须承担守护居民和潮门的责任。',
          motivations: ['追查危机来源', '保护仍在运行的港口秩序'],
          personalStakes: ['失败会让家园继续失去安全边界'], sourceClaimKeys: [claimKey],
        },
      }
    } else throw new Error(`SFQA097 prefix must stop after P2: ${request.category}`)
    return { output: JSON.stringify(draft), bindingReceipt: receipt,
      usage: { inputTokens: 300, outputTokens: 180 } }
  }
  const executor = createTextOpenWorldProductionExecutorV1({ production: preview.production,
    brief: preview.start.executionBrief, textCapabilityReceipt: receipt, modelTransport,
    taskExecutors: { 'p1.source-curation': createTextOpenWorldSourceCurationExecutorV1({ runModel: modelTransport }) } })
  const stages = []
  for (const taskKey of ['p0.source-lock', 'p1.source-curation', 'p2.experience-design']) {
    const projection = await runProductProductionSchedulerCycleV1({
      scope: preview.scope, productionId: preview.production.id, executor,
      capabilityBindings: [{ requirementKey, adapterId: receipt.adapterId, bindingHash: receipt.capabilityHash }],
    })
    const stage = projection.tasks.find(task => task.taskKey === taskKey)
    if (stage?.status !== 'completed' || !stage.terminalReceiptHash) {
      throw new Error(`SFQA097 ${taskKey} did not complete: ${JSON.stringify(stage)}`)
    }
    stages.push({ taskKey, runId: stage.runId, terminalReceiptHash: stage.terminalReceiptHash })
  }
  const build = await db.productBuilds.where('[productionId+buildNumber]')
    .equals([preview.production.id, preview.buildNumber]).first()
  if (!build?.id) throw new Error('SFQA097 public Start Build is missing')
  const artifacts = await db.productBuildArtifacts.where('buildId').equals(build.id).toArray()
  const gameBriefRow = artifacts.find(row => row.artifactKey === 'text-open-world.game-brief' && row.status === 'accepted')
  if (!gameBriefRow) throw new Error('SFQA097 P2 produced no accepted Game Brief')
  const gameBrief = JSON.parse(gameBriefRow.payloadJson) as TextOpenWorldGameBriefV1
  return { stages, modelCategories, gameBrief, buildId: build.id, briefHash: build.briefHash }
}
