/** Native production lifecycle with explicit synthetic replies; no provider or human acceptance. */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readTtrpgDraft, saveTtrpgDraft, prepareTtrpgBrief, prepareTtrpgOpenProductionBriefV3 } from '../../src/lib/ttrpg/authoring-service'
import { settingsFromTtrpgDraft } from '../../src/lib/ttrpg/authoring-contract'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { beginProductProductionEvolutionV1, publishProductProductionV1 } from '../../src/lib/product-production/service'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { seedOpenBrowserProductionV1, runOpenBrowserProductionV1 } from '../helpers/open-ttrpg-production-browser'
import { createFreshOpenDraftFixtureV1 } from '../helpers/open-ttrpg-fresh-authoring'
import { readTtrpgCompatibleOpeningAuthoringBaseV1 } from '../../src/lib/ttrpg/open-compatible-opening-source'
import { cloneTtrpgCompatibleOpeningTemplateV1 } from '../../src/lib/ttrpg/open-compatible-opening-contract'
import { saveTtrpgRulePackV2 } from '../../src/lib/ttrpg/rule-pack-library'
import { resolveProductRuntimeSource } from '../../src/lib/product-production/preview-source'
import { createProductRuntimeInstanceFromSource } from '../../src/lib/product/runtime-instances'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { isTtrpgRuntimeContentV2 } from '../../src/lib/ttrpg/content-version'
import { reviseTtrpgOpenPendingAuthoringBriefV1 } from '../../src/lib/ttrpg/open-pending-runtime-brief'
import { assertTtrpgOpenReleaseCompatibilityV1 } from '../../src/lib/ttrpg/open-release-compatibility'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import * as consultation from '../../src/lib/product-production/consultation'

describe('R-TTRPGOPEN17 explicit complete author revision before start', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  async function current(f: { productionId: number }) {
    const production = (await db.productProductions.get(f.productionId))!
    const row = (await db.productProductionBriefs.where('[productionId+revision]').equals([f.productionId, production.currentBriefRevision!]).first())!
    return { production, row, brief: parseProductProductionBriefV3(row.briefJson) }
  }
  async function finish(f: Awaited<ReturnType<typeof seedOpenBrowserProductionV1>>) {
    let result = await runOpenBrowserProductionV1(f)
    for (let i = 0; i < 2 && !result.terminal; i++) result = await runOpenBrowserProductionV1(f, true)
    expect(result.terminal).toBe(true); return result
  }
  async function pending(compatibleBase = false) {
    const f = await seedOpenBrowserProductionV1({ runtimeAIEnabled: true })
    await finish(f); await publishProductProductionV1(f)
    await beginProductProductionEvolutionV1({ ...f, userText: '作者明确修订下一版本的合作队伍、规则和开场，原发布与存档保留。', affectedLanes: ['runtime'] })
    if (compatibleBase) {
      const base = await readTtrpgCompatibleOpeningAuthoringBaseV1(f), draft = await readTtrpgDraft(f.scope), settings = settingsFromTtrpgDraft(draft)
      if (settings.runFormat !== 'open') throw Error('open fixture required')
      settings.openAuthoring = structuredClone(base.authoring)
      const copy = cloneTtrpgCompatibleOpeningTemplateV1(base.authoring.situationTemplates[0], 'author.compatible.new', '原兼容开局')
      settings.openAuthoring.situationTemplates.push(copy); settings.openAuthoring.openingSituationKeys = [copy.templateKey]
      const saved = await saveTtrpgDraft(f.scope, draft.revision, settings, '确认免文本兼容开局')
      await prepareTtrpgOpenProductionBriefV3({ scope: f.scope, revision: saved.revision, openingRevision: 'revise-pending-compatible-opening' })
      await authorize(f); await finish(f); await publishProductProductionV1(f)
      await beginProductProductionEvolutionV1({ ...f, userText: '现在明确更新完整作者方案，恢复普通制作能力要求。', affectedLanes: ['runtime'] })
    }
    return { ...f, ...await current(f) }
  }
  async function edited(f: Awaited<ReturnType<typeof pending>>, newRule = false) {
    const draft = await readTtrpgDraft(f.scope), settings = settingsFromTtrpgDraft(draft)
    if (settings.runFormat !== 'open') throw Error('open fixture required')
    settings.openingSituation = '三名调查员在同一公开集合点讨论独立核对，先协商再行动。'
    settings.wizard.instruction = '明确队伍公开身份与初始集合安排，私密目标和世界秘密仍按原各自范围保存。'
    if (newRule) {
      const rulePack = structuredClone(f.brief.ttrpgOpen!.rulePack)
      rulePack.ruleSystemVersion = '3.0.1'; rulePack.description += ' 作者已明确修订本版本规则说明。'
      const record = await saveTtrpgRulePackV2({ scope: f.scope, rulePack, status: 'validated', immutable: true })
      settings.wizard.savedRulePackId = record.id!
    }
    return saveTtrpgDraft(f.scope, draft.revision, settings, '完整方案明确修订')
  }
  async function authorize(f: { productionId: number; scope: Awaited<ReturnType<typeof seedOpenBrowserProductionV1>>['scope'] }) {
    const c = await current(f)
    const r = await executeProductProductionCommand({ ...f, command: { type: 'authorize-start', commandId: `full.author.start.${c.row.revision}`,
      expectedStateRevision: c.production.stateRevision, briefRevision: c.row.revision, briefHash: c.row.briefHash, authorizationNonce: `explicit.author.${c.row.revision}` } })
    expect(r.ok).toBe(true)
  }
  it('requires a separate full choice, preserves the narrow operations and old data, and saves no start or model request', async () => {
    const f = await pending(), draft = await edited(f), oldRows = await db.productProductionBriefs.toArray()
    const before = { builds: await db.productBuilds.toArray(), releases: await db.productReleases.toArray(), runs: await db.agentRuns.toArray(), worlds: await db.worldReleases.toArray() }
    await expect(prepareTtrpgBrief(f.scope, draft.revision)).rejects.toThrow(/只支持调整/)
    await expect(prepareTtrpgOpenProductionBriefV3({ scope: f.scope, revision: draft.revision, stagePolicyRevision: 'revise-pending-stage-policy' })).rejects.toThrow()
    await expect(prepareTtrpgOpenProductionBriefV3({ scope: f.scope, revision: draft.revision, openingRevision: 'revise-pending-compatible-opening' })).rejects.toThrow()
    expect(await current(f)).toEqual({ production: f.production, row: f.row, brief: f.brief })
    expect(await prepareTtrpgOpenProductionBriefV3({ scope: f.scope, revision: draft.revision, authoringRevision: 'revise-pending-authoring' })).toBe(f.productionId)
    const after = await current(f)
    expect(after.brief.ttrpgOpen!.settings.openingSituation).toContain('公开集合点')
    expect(after.brief.productionBudget).toEqual(f.brief.productionBudget)
    expect(after.brief.ttrpgOpen!.sourcePlan).toEqual(f.brief.ttrpgOpen!.sourcePlan)
    expect(after.brief.evolution!.base).toEqual(f.brief.evolution!.base); expect(after.brief.evolution!.userGoal).toEqual(f.brief.evolution!.userGoal)
    expect(new Set(after.brief.evolution!.affectedLanes)).toEqual(new Set(['content', 'product', 'visual', 'audio', 'runtime']))
    expect(after.row.status).toBe('draft'); expect(after.row.authorizedAt).toBeNull(); expect(after.row.parentRevision).toBe(f.row.revision)
    expect(await db.productBuilds.toArray()).toEqual(before.builds); expect(await db.productReleases.toArray()).toEqual(before.releases)
    expect(await db.agentRuns.toArray()).toEqual(before.runs); expect(await db.worldReleases.toArray()).toEqual(before.worlds)
    for (const old of oldRows) expect(await db.productProductionBriefs.get(old.id!)).toEqual(old)
  })
  it('uses a new scoped immutable RulePack only after a separate start and retains the old release and save', async () => {
    const f = await pending(), publishedId = f.production.currentProductReleaseId!
    const session = await createProductRuntimeInstanceFromSource({ scope: f.scope, source: { kind: 'release', productReleaseId: publishedId }, title: '原始存档', seed: 'original.full.author' })
    const originalState = await readProductRuntimeState(session.id!), releases = await db.productReleases.toArray(), artifacts = await db.productBuildArtifacts.toArray()
    const oldSource = await resolveProductRuntimeSource({ scope: f.scope, source: { kind: 'release', productReleaseId: publishedId }, ttrpgProtocol: 2 })
    const draft = await edited(f, true)
    await expect(prepareTtrpgBrief(f.scope, draft.revision)).rejects.toThrow(/只支持调整/)
    await prepareTtrpgOpenProductionBriefV3({ scope: f.scope, revision: draft.revision, authoringRevision: 'revise-pending-authoring' })
    expect((await current(f)).brief.ttrpgOpen!.rulePack.ruleSystemVersion).toBe('3.0.1')
    await authorize(f); const result = await finish(f)
    const source = await resolveProductRuntimeSource({ scope: f.scope, source: { kind: 'build', productBuildId: result.buildId!, expectedPreviewHash: result.previewHash }, ttrpgProtocol: 2 })
    try {
      expect(source.runtimePackage.ttrpg!.rulePack.content.ruleSystemVersion).toBe('3.0.1')
      const old = oldSource.runtimePackage.ttrpg!, next = source.runtimePackage.ttrpg!
      if (!isTtrpgRuntimeContentV2(old) || !isTtrpgRuntimeContentV2(next)) throw Error('open source required')
      expect(() => assertTtrpgOpenReleaseCompatibilityV1(old, next)).toThrow(/显式迁移|兼容续团/)
    } finally { oldSource.mediaResolver.dispose(); source.mediaResolver.dispose() }
    expect(await readProductRuntimeState(session.id!)).toEqual(originalState)
    expect(await db.productReleases.toArray()).toEqual(releases)
    for (const artifact of artifacts) expect(await db.productBuildArtifacts.get(artifact.id!)).toEqual(artifact)
  })
  it('restores normal text capability requirements when a text-free compatible version is followed by a full revision', async () => {
    const f = await pending(true)
    expect(f.brief.capabilityRequirements.filter(r => r.mediaClass === 'text').every(r => !r.required)).toBe(true)
    const draft = await edited(f)
    await prepareTtrpgOpenProductionBriefV3({ scope: f.scope, revision: draft.revision, authoringRevision: 'revise-pending-authoring' })
    const next = await current(f)
    expect(next.brief.ttrpgOpen!.compatibleOpeningRevision).toBeUndefined()
    expect(next.brief.capabilityRequirements.some(r => r.mediaClass === 'text' && r.required)).toBe(true)
    expect(next.brief.productionBudget).toEqual(f.brief.productionBudget)
    expect(await db.productBuilds.count()).toBe(2)
  })
  it('rejects no-op, initial work, unknown or combined choices and cross-work scope without a new Brief', async () => {
    const f = await pending(), draft = await readTtrpgDraft(f.scope), before = await current(f), rows = await db.productProductionBriefs.toArray()
    await expect(prepareTtrpgOpenProductionBriefV3({ scope: f.scope, revision: draft.revision, authoringRevision: 'revise-pending-authoring' })).rejects.toThrow(/未变化/)
    await expect(prepareTtrpgOpenProductionBriefV3({ scope: f.scope, revision: draft.revision, authoringRevision: 'automatic' as never })).rejects.toThrow(/明确选择/)
    await expect(prepareTtrpgOpenProductionBriefV3({ scope: f.scope, revision: draft.revision, authoringRevision: 'revise-pending-authoring', stagePolicyRevision: 'revise-pending-stage-policy' })).rejects.toThrow(/明确选择/)
    await expect(prepareTtrpgOpenProductionBriefV3({ scope: { ...f.scope, workId: f.scope.workId + 900 }, revision: draft.revision, authoringRevision: 'revise-pending-authoring' })).rejects.toThrow()
    expect(await current(f)).toEqual(before); expect(await db.productProductionBriefs.toArray()).toEqual(rows)
    const fresh = await createFreshOpenDraftFixtureV1()
    await expect(prepareTtrpgOpenProductionBriefV3({ scope: fresh.scope, revision: fresh.draft.revision, authoringRevision: 'revise-pending-authoring' })).rejects.toThrow(/发布后新版本/)
    expect(await db.productProductionBriefs.toArray()).toEqual(rows)
  })
  it('rejects a changed frozen world or source selection in the separate full operation', async () => {
    const f = await pending(), draft = await edited(f), settings = settingsFromTtrpgDraft(draft)
    if (settings.runFormat !== 'open') throw Error('open fixture required')
    const { ttrpgOpen: original, ...common } = f.brief
    const input = { scope: f.scope, production: f.production, row: f.row,
      build: (await db.productBuilds.where('[productionId+buildNumber]').equals([f.productionId, f.production.currentBuildNumber]).first())!,
      release: (await db.productReleases.get(f.production.currentProductReleaseId!))!,
      settingsRevision: draft.revision, settings, rulePack: original!.rulePack, worldReference: original!.worldReference,
      common: { ...common, source: { ...common.source, worldContentHash: 'f'.repeat(64) } }, decision: 'revise-pending-authoring' as const }
    await expect(reviseTtrpgOpenPendingAuthoringBriefV1(input)).rejects.toThrow(/冻结世界|读取范围/)
    expect(await current(f)).toEqual({ production: f.production, row: f.row, brief: f.brief })
  })
  it('retains the original CAS if author-start races the full revision', async () => {
    const f = await pending(), draft = await edited(f), original = consultation.draftTtrpgOpenProductionCommonBriefV3
    vi.spyOn(consultation, 'draftTtrpgOpenProductionCommonBriefV3').mockImplementationOnce(async input => {
      const output = await original(input); await authorize(f); return output
    })
    await expect(prepareTtrpgOpenProductionBriefV3({ scope: f.scope, revision: draft.revision, authoringRevision: 'revise-pending-authoring' })).rejects.toThrow(/state|revision|过期|冲突|变化/i)
    expect((await db.productProductions.get(f.productionId))!.status).toBe('producing')
    expect(await db.productProductionBriefs.where('productionId').equals(f.productionId).count()).toBe(f.row.revision)
  })
  it('keeps the revised rule content and owner through a backup import without authorizing a new Build', async () => {
    const f = await pending(), draft = await edited(f, true)
    await prepareTtrpgOpenProductionBriefV3({ scope: f.scope, revision: draft.revision, authoringRevision: 'revise-pending-authoring' })
    const original = await current(f), projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    const imported = (await db.productProductions.where('projectId').equals(projectId).toArray()).find(p => p.productionKey === original.production.productionKey)!
    const next = await current({ productionId: imported.id! }), scope = { projectId, worldId: imported.worldId, workId: imported.workId }
    expect(next.row.status).toBe('draft'); expect(next.row.authorizedAt).toBeNull(); expect(next.brief.ttrpgOpen!.rulePack.ruleSystemVersion).toBe('3.0.1')
    expect(next.brief.ttrpgOpen!.sourcePlan.productInstanceKey).toBe(imported.productionKey)
    const savedDraft = await readTtrpgDraft(scope), settings = settingsFromTtrpgDraft(savedDraft)
    if (settings.runFormat !== 'open') throw Error('open fixture required')
    expect(settings.wizard.savedRulePackId).not.toBe(draft.savedRulePackId)
    expect(await db.productBuilds.where('productionId').equals(imported.id!).count()).toBe(1)
  })
})
