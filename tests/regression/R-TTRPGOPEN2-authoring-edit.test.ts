import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { defaultTtrpgSettingsV2, parseTtrpgAuthoringSettingsV2 } from '../../src/lib/ttrpg/authoring-contract-v2'
import { defaultTtrpgSettings, settingsFromTtrpgDraft } from '../../src/lib/ttrpg/authoring-contract'
import { createTtrpgDraft, readTtrpgDraft, saveTtrpgDraft } from '../../src/lib/ttrpg/authoring-service'
import { parseTtrpgOpenAuthoringEditV1, reviewTtrpgOpenAuthoringEditV1, initializeTtrpgOpenAuthoringPoliciesV1,
  MAX_TTRPG_OPEN_AUTHORING_EDIT_BYTES_V1 } from '../../src/lib/ttrpg/open-authoring-edit'
import { openCampaignFixture } from '../helpers/ttrpg-open-content'
import type { TtrpgOpenAuthoringV1 } from '../../src/lib/ttrpg/open-contract'

export function authoringEditFixtureV1(): TtrpgOpenAuthoringV1 {
  const campaign = openCampaignFixture()
  return { factPolicy: campaign.frozenWorldPredicateIndex.entries.map(fact => ({ fact, authorConfirmed: true })),
    situationTemplates: campaign.situationTemplates, openingSituationKeys: campaign.openingSituationKeys,
    effectPlanTemplates: campaign.effectPlanTemplates, pressure: { clocks: campaign.clocks, fronts: campaign.fronts },
    companionPolicy: campaign.companionPolicy, stageClosurePolicy: campaign.stageClosurePolicy,
    dynamicEntityTemplates: campaign.dynamicEntityTemplates ?? [], runtimePolicy: campaign.runtimePolicy }
}

describe('R-TTRPGOPEN2 normal author open draft input', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('starts an explicit new open draft with two AI companions and no fake scene or ending requirement, retaining legacy defaults and bytes', async () => {
    const legacy = defaultTtrpgSettings(), old = await createTtrpgDraft('旧闭合作品', legacy)
    const before = (await readTtrpgDraft(old.scope)).settingsJson
    const open = defaultTtrpgSettingsV2('open'), fresh = await createTtrpgDraft('新的开放作品', open)
    expect(open.wizard).toMatchObject({ ruleOrigin: 'saved-rule-pack', savedRulePackId: null, targetSceneCount: 0, targetEndingCount: 0, structure: 'sandbox' })
    expect(open.wizard.seats.filter(seat => seat.controller === 'ai')).toHaveLength(2)
    expect(settingsFromTtrpgDraft(await readTtrpgDraft(fresh.scope))).toEqual(open)
    expect((await readTtrpgDraft(old.scope)).settingsJson).toBe(before)
    expect(defaultTtrpgSettings()).toEqual(legacy)
    expect(await db.productProductions.count()).toBe(0); expect(await db.agentRuns.count()).toBe(0)
  })
  it('imports the complete authoring shape while clearing every imported human confirmation until each actual selection', () => {
    const original = authoringEditFixtureV1(), imported = parseTtrpgOpenAuthoringEditV1(JSON.stringify(original))
    expect(imported.factPolicy.length).toBeGreaterThan(0)
    expect(imported.factPolicy.every(item => !item.authorConfirmed)).toBe(true)
    expect(imported).toEqual({ ...original, factPolicy: original.factPolicy.map(item => ({ ...item, authorConfirmed: false })) })
    const selected = [imported.factPolicy[0].fact.factKey], reviewed = reviewTtrpgOpenAuthoringEditV1(imported, selected)
    expect(reviewed.factPolicy.filter(item => item.authorConfirmed).map(item => item.fact.factKey)).toEqual(selected)
    expect(imported.factPolicy.every(item => !item.authorConfirmed)).toBe(true)
    expect(() => reviewTtrpgOpenAuthoringEditV1(imported, [...selected, ...selected])).toThrow(/不一致/)
    expect(() => reviewTtrpgOpenAuthoringEditV1(imported, ['not-a-fact'])).toThrow(/不一致/)
  })
  it('writes only the chosen Work draft through the existing revision owner, preserving old stored settings after an invalid or stale edit', async () => {
    const first = await createTtrpgDraft('开放甲', defaultTtrpgSettingsV2('open')), second = await createTtrpgDraft('开放乙', defaultTtrpgSettingsV2('open'))
    const before = await readTtrpgDraft(second.scope), imported = parseTtrpgOpenAuthoringEditV1(JSON.stringify(authoringEditFixtureV1()))
    const settings = defaultTtrpgSettingsV2('open'); if (settings.runFormat !== 'open') throw Error('format')
    settings.openAuthoring = reviewTtrpgOpenAuthoringEditV1(imported, [])
    const saved = await saveTtrpgDraft(first.scope, 0, settings, '开放甲')
    expect(settingsFromTtrpgDraft(saved)).toEqual(settings)
    expect(await readTtrpgDraft(second.scope)).toEqual(before)
    await expect(saveTtrpgDraft(first.scope, 0, settings, '旧窗口')).rejects.toThrow(/刷新/)
    const invalid = structuredClone(settings); invalid.openAuthoring.runtimePolicy!.maximumCallsPerEpoch = 10
    await expect(saveTtrpgDraft(first.scope, saved.revision, invalid, '越界预算')).rejects.toThrow()
    expect(await readTtrpgDraft(first.scope)).toEqual(saved)
    expect(await db.productBuilds.count()).toBe(0); expect(await db.agentRuns.count()).toBe(0)
  })
  it('fills only missing conservative editable policies, retains all existing scenario/source data and never enables AI or approves an action', () => {
    const initial = defaultTtrpgSettingsV2('open'); if (initial.runFormat !== 'open') throw Error('format')
    const result = initializeTtrpgOpenAuthoringPoliciesV1(initial.openAuthoring)
    expect(result.runtimePolicy).toMatchObject({ enabled: false, maxAiActions: 0, maximumRepairAttempts: 0 })
    expect(result.companionPolicy).toMatchObject({ preauthorizedActionKinds: [], approvalBindings: [] })
    expect(result.situationTemplates).toEqual([]); expect(initial.openAuthoring.runtimePolicy).toBeNull()
    const full = authoringEditFixtureV1(); expect(initializeTtrpgOpenAuthoringPoliciesV1(full)).toEqual(full)
    expect(parseTtrpgAuthoringSettingsV2({ ...initial, openAuthoring: result })).toMatchObject({ runFormat: 'open' })
  })
  it.each(['unknown-field', 'malformed-json', 'oversized', 'false-policy'] as const)('refuses %s without creating or rewriting a draft', async kind => {
    const f = await createTtrpgDraft('保存原文', defaultTtrpgSettingsV2('open')), before = await readTtrpgDraft(f.scope)
    const data: any = authoringEditFixtureV1()
    if (kind === 'unknown-field') data.executionAllowed = true
    if (kind === 'false-policy') data.runtimePolicy.unknownResultPolicy = 'retry'
    const text = kind === 'malformed-json' ? '{' : kind === 'oversized' ? '中'.repeat(Math.ceil(MAX_TTRPG_OPEN_AUTHORING_EDIT_BYTES_V1 / 3) + 1) : JSON.stringify(data)
    expect(() => parseTtrpgOpenAuthoringEditV1(text)).toThrow()
    expect(await readTtrpgDraft(f.scope)).toEqual(before)
  })
})
