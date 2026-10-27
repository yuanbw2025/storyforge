/** Isolated browser fixture. All model transport is explicit simulation; no real provider/config is read. */
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { createFreshOpenDraftFixtureV1 } from './open-ttrpg-fresh-authoring'
import { openProductionCompilerFixtureV1 } from './open-ttrpg-production-artifacts'
import { prepareTtrpgBrief } from '../../src/lib/ttrpg/authoring-service'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { createProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { createConfiguredProductProductionExecutorV1, type ProductionTextRunnerV1 } from '../../src/lib/product-production/production-executor'
import { runProductProductionUntilBlockedV1 } from '../../src/lib/product-production/scheduler'
import { resolveProductRuntimeSource } from '../../src/lib/product-production/preview-source'
import { createProductRuntimeInstanceFromSource } from '../../src/lib/product/runtime-instances'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { openReservedProductionFixtureV1 } from './ttrpg-open-reserved-production'

export interface OpenBrowserProductionFixtureV1 { scope: WorkspaceScope; productionId: number; cooperative?: boolean; reservedSeatPlan?: boolean; executionProfile?: 2 | 3 }
export async function seedOpenBrowserProductionV1(options: { humanGm?: boolean; runtimeAIEnabled?: boolean; cooperative?: boolean; maximumEpochTokens?: number; executionProfile?: 2 | 3 } = {}): Promise<OpenBrowserProductionFixtureV1> {
  const { executionProfile, ...settingsOptions } = options
  const { scope, draft } = await createFreshOpenDraftFixtureV1(2, true,settingsOptions)
  const productionId = await prepareTtrpgBrief(scope, draft.revision), production = (await db.productProductions.get(productionId))!
  const row = (await db.productProductionBriefs.where('[productionId+revision]').equals([productionId, production.currentBriefRevision!]).first())!
  const receipt = await executeProductProductionCommand({ scope, productionId, command: { type: 'authorize-start',
    commandId: 'browser.open.start', expectedStateRevision: production.stateRevision, briefRevision: row.revision,
    briefHash: row.briefHash, authorizationNonce: 'author.browser.open.confirmed' } })
  if (!receipt.ok) throw new Error(JSON.stringify(receipt))
  return { scope, productionId, ...(options.cooperative ? { cooperative: true } : {}),
    ...(executionProfile == null ? {} : { executionProfile }) }
}

export async function runOpenBrowserProductionV1(input: OpenBrowserProductionFixtureV1, authorReview = false) {
  const { scope, productionId } = input, production = (await db.productProductions.get(productionId))!
  const row = (await db.productProductionBriefs.where('[productionId+revision]').equals([productionId, production.currentBriefRevision!]).first())!
  const brief = parseProductProductionBriefV3(row.briefJson)
  const data = input.reservedSeatPlan ? await openReservedProductionFixtureV1({ brief, productionId, scope })
    : await openProductionCompilerFixtureV1(true, { brief, productionId, scope, preferAuthorSituations: input.cooperative })
  const buildBefore = (await db.productBuilds.where('[productionId+buildNumber]').equals([productionId,production.currentBuildNumber!]).first())!
  if (authorReview) {
    const taskKey = JSON.parse(buildBefore.failureJson).taskKey as string
    const payload = taskKey === 'ttrpg.open.source-facts' ? data.sourceFacts
      : taskKey === 'ttrpg.open.rule-system' ? data.ruleSystem : null
    if (!payload) throw new Error('no current author review task')
    const reviewed = await executeProductProductionCommand({ scope, productionId, command: { type: 'resolve-blocker',
      commandId: `browser.author.review.${buildBefore.buildNumber}.${taskKey}`, expectedStateRevision: production.stateRevision, blockerKey: taskKey,
      resolution: { action: 'author-edit', note: '确认当前持久化事实或角色数值', authorDraftJson: JSON.stringify(payload) } } })
    if (!reviewed.ok) throw new Error(JSON.stringify(reviewed))
  }
  const bindingHash = 'a'.repeat(64), requirementKey = brief.capabilityRequirements.find(requirement => requirement.mediaClass === 'text')!.requirementKey
  const runText: ProductionTextRunnerV1 = async request => {
    const payload = request.system.includes('storyforge.ttrpg-open-source-facts') ? data.sourceFacts
      : request.system.includes('storyforge.ttrpg-open-rule-system') ? data.ruleSystem
        : request.system.includes('storyforge.ttrpg-open-situation-layer') ? data.situationLayer
          : request.system.includes('storyforge.product-media-requirements-artifact')
            ? { schema: 'storyforge.product-media-requirements-artifact', version: 2, visual: [], audio: [] } : null
    if (!payload) throw new Error('unexpected model task')
    return { output: JSON.stringify(payload), usage: { inputTokens: 100, outputTokens: 200 },
      bindingReceipt: { schema: 'storyforge.provider-binding-receipt', version: 1, requirementKey,
        adapterId: 'configured-text.v1', adapterVersion: 1, provider: 'fixture', model: 'fixture-model',
        endpointOrigin: 'https://fixture.invalid', executionLocation: 'browser-direct', credentialSource: 'existing-ai-config',
        credentialPresent: true, capabilityHash: bindingHash, boundAt: 1, receiptHash: bindingHash } }
  }
  // Explicit native compatibility fixtures freeze the whole retained profile
  // on a fresh Build. Existing Plans/epochs are never replaced by this helper.
  const suppliedPlan = input.executionProfile === 2 && buildBefore.planRevision === 0
    ? await createProductProductionPlanV3({ brief, briefHash: row.briefHash, buildNumber: buildBefore.buildNumber,
      controlEpoch: buildBefore.controlEpoch, ttrpgOpenExecutionProfile: 2 }) : undefined
  const projection = await runProductProductionUntilBlockedV1({ scope, productionId, suppliedPlan,
    executor: createConfiguredProductProductionExecutorV1({ production: (await db.productProductions.get(productionId))!, brief, runText }),
    capabilityBindings: [{ requirementKey, adapterId: 'configured-text.v1', bindingHash }] })
  const build = (await db.productBuilds.where('[productionId+buildNumber]').equals([productionId,production.currentBuildNumber!]).first())!
  const ledger = JSON.parse(build.budgetLedgerJson) as { attempts: { usage: { modelCalls: number } | null }[] }
  return { terminal: projection.terminal, status: projection.buildStatus, taskKey: JSON.parse(build.failureJson).taskKey ?? null,
    modelCalls: ledger.attempts.reduce((total, attempt) => total + (attempt.usage?.modelCalls ?? 0), 0),
    previewHash: build.previewHash, rootTerminalReceiptHash: build.rootTerminalReceiptHash, buildId: build.id! }
}

export async function openBrowserProductionPreviewV1(input: OpenBrowserProductionFixtureV1) {
  const production = (await db.productProductions.get(input.productionId))!
  const build = (await db.productBuilds.where('[productionId+buildNumber]').equals([input.productionId,production.currentBuildNumber!]).first())!
  const source = { kind: 'build' as const, productBuildId: build.id!, expectedPreviewHash: build.previewHash }
  const resolved = await resolveProductRuntimeSource({ scope: input.scope, source, ttrpgProtocol: 2 })
  const version = resolved.runtimePackage.ttrpg!.campaign.version
  resolved.mediaResolver.dispose()
  const instance = await createProductRuntimeInstanceFromSource({ scope: input.scope, source, title: '浏览器开放预览', seed: 'open.browser.preview' })
  return { version, sessionId: instance.id!, state: await readProductRuntimeState(instance.id!) }
}
