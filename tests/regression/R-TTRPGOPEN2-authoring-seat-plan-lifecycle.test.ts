import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createSavedOpenDesignFixtureV1, openDesignResponseFixtureV1 } from '../helpers/ttrpg-open-design'
import { createFreshOpenDraftFixtureV1 } from '../helpers/open-ttrpg-fresh-authoring'
import { withOpenAuthoringSeatPlanFixtureV1 } from '../helpers/ttrpg-open-seat-plan'
import { readTtrpgDraft, saveTtrpgDraft, prepareTtrpgBrief } from '../../src/lib/ttrpg/authoring-service'
import { settingsFromTtrpgDraft, isTtrpgAuthoringSettingsV2 } from '../../src/lib/ttrpg/authoring-contract'
import { parseTtrpgOpenRuleSystemArtifactV1 } from '../../src/lib/ttrpg/open-production-artifacts'
import { prepareTtrpgOpenAuthoringDesignSourceV1, generateTtrpgOpenAuthoringDesignCandidateV1,
  adoptTtrpgOpenAuthoringDesignV1 } from '../../src/lib/ttrpg/open-authoring-design'
import { openProductionCompilerFixtureV1 } from '../helpers/open-ttrpg-production-artifacts'
import { compileProductionTtrpgOpenCampaignV2 } from '../../src/lib/ttrpg/open-production-compiler'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { deleteWork } from '../../src/lib/workspace/lifecycle'

describe('R-TTRPGOPEN2 reserved identity existing draft/source/adopt/production lifecycle', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  async function saved() {
    const f = await createSavedOpenDesignFixtureV1(), settings = withOpenAuthoringSeatPlanFixtureV1(f.settings)
    const draft = await saveTtrpgDraft(f.scope, f.revision, settings, '本人明确的角色预留')
    return { ...f, settings, draft, revision: draft.revision }
  }
  it('saves/reloads only the existing Work draft, retains logical keys through backup remapping and deletes with its owner', async () => {
    const f = await saved(), other = await createSavedOpenDesignFixtureV1(), before = await readTtrpgDraft(other.scope)
    expect(settingsFromTtrpgDraft(await readTtrpgDraft(f.scope))).toEqual(f.settings)
    const backup = await exportProjectJSON(f.scope.projectId), importedId = await importProjectJSON(backup)
    const copied = (await db.ttrpgAuthoringDrafts.where('projectId').equals(importedId).first())!, settings = settingsFromTtrpgDraft(copied)
    expect(isTtrpgAuthoringSettingsV2(settings) && settings.runFormat === 'open' && settings.authoringSeatPlan).toEqual(f.settings.authoringSeatPlan)
    expect(copied.workId).not.toBe(f.scope.workId); expect(copied.savedRulePackId).not.toBe(f.draft.savedRulePackId)
    expect(await readTtrpgDraft(other.scope)).toEqual(before)
    await deleteWork(f.scope.workId)
    expect(await db.ttrpgAuthoringDrafts.where('workId').equals(f.scope.workId).count()).toBe(0)
    expect((await db.ttrpgAuthoringDrafts.get(copied.id!))!.settingsJson).toBe(copied.settingsJson)
    expect(await readTtrpgDraft(other.scope)).toEqual(before)
  })
  it('freezes the actual saved plan and protects it across a pressure-only model candidate and explicit governed adoption', async () => {
    const f = await saved(), prepared = await prepareTtrpgOpenAuthoringDesignSourceV1(f)
    expect(prepared.source.settings.authoringSeatPlan).toEqual(f.settings.authoringSeatPlan)
    const candidate = await generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, runAI: async messages => openDesignResponseFixtureV1(messages) })
    await adoptTtrpgOpenAuthoringDesignV1({ scope: f.scope, runId: candidate.runId, candidateHash: candidate.candidateHash,
      selection: { pressure: 'design.1' }, confirmedFactKeys: [], confirmation: 'confirm-design-selection-v1' })
    const draft = await readTtrpgDraft(f.scope), settings = settingsFromTtrpgDraft(draft)
    expect(isTtrpgAuthoringSettingsV2(settings) && settings.runFormat === 'open' && settings.authoringSeatPlan).toEqual(f.settings.authoringSeatPlan)
    expect(draft.revision).toBe(f.revision + 1); expect(await db.productProductions.count()).toBe(0)
    expect(await db.productBuilds.count()).toBe(0)
  })
  it('preserves stale human seat edits but rejects new source/production before any Run or production records exist', async () => {
    const f = await saved(); f.settings.wizard.seats[1].controller = 'human'
    const draft = await saveTtrpgDraft(f.scope, f.revision, f.settings, '尚待本人核对新的席位')
    await expect(prepareTtrpgOpenAuthoringDesignSourceV1({ scope: f.scope, revision: draft.revision })).rejects.toThrow(/席位或控制者已变化/)
    expect(await db.agentRuns.count()).toBe(0); expect(await db.productProductions.count()).toBe(0)
    // Supply a complete existing scenario so the old incomplete-draft gate is
    // not the reason the new frozen Brief rejects this identity drift.
    const data = await openProductionCompilerFixtureV1()
    const settings = withOpenAuthoringSeatPlanFixtureV1(data.input.brief.ttrpgOpen!.settings, data.ruleSystem.characterTemplates)
    settings.wizard.seats[1].controller = 'human'; data.input.brief.ttrpgOpen!.settings = settings
    expect(() => parseProductProductionBriefV3(data.input.brief)).toThrow(/席位或控制者已变化/)
    expect((await readTtrpgDraft(f.scope)).settingsJson).toBe(draft.settingsJson); expect(await db.agentRuns.count()).toBe(0)
  })
  it('validates the real templates at candidate parsing and final compiler, while old absent-field artifacts retain their original path', async () => {
    const data = await openProductionCompilerFixtureV1(), oldBrief = JSON.stringify(data.input.brief)
    const before = await compileProductionTtrpgOpenCampaignV2(data.input)
    const settings = withOpenAuthoringSeatPlanFixtureV1(data.input.brief.ttrpgOpen!.settings, data.ruleSystem.characterTemplates)
    data.input.brief.ttrpgOpen!.settings = settings; data.input.briefHash = await hashProductProductionValueV2(data.input.brief)
    expect(parseTtrpgOpenRuleSystemArtifactV1(data.ruleSystem, data.input.brief.ttrpgOpen!.rulePack, settings)).toEqual(data.ruleSystem)
    const compiled = await compileProductionTtrpgOpenCampaignV2(data.input)
    expect(compiled.characterTemplates).toEqual(before.characterTemplates)
    const wrong = structuredClone(data.ruleSystem), companions = wrong.characterTemplates.filter(item => item.controller === 'ai')
    ;[companions[0].seatKey, companions[1].seatKey] = [companions[1].seatKey, companions[0].seatKey]
    expect(() => parseTtrpgOpenRuleSystemArtifactV1(wrong, data.input.brief.ttrpgOpen!.rulePack, settings)).toThrow(/预留不一致/)
    await expect(compileProductionTtrpgOpenCampaignV2({ ...data.input, ruleSystem: await data.wrap(wrong) })).rejects.toThrow(/预留不一致/)
    const old = JSON.parse(oldBrief)
    expect(Object.hasOwn(old.ttrpgOpen.settings, 'authoringSeatPlan')).toBe(false)
    expect(parseTtrpgOpenRuleSystemArtifactV1(wrong, old.ttrpgOpen.rulePack, old.ttrpgOpen.settings)).toEqual(wrong)
  })
  it('keeps an unstarted frozen old Brief byte-identical when a later author draft explicitly enables a new seat plan', async () => {
    const f = await createFreshOpenDraftFixtureV1()
    await prepareTtrpgBrief(f.scope, f.draft.revision)
    const rowsBefore = await db.productProductionBriefs.toArray()
    const row = await readTtrpgDraft(f.scope), settings = settingsFromTtrpgDraft(row)
    if (!isTtrpgAuthoringSettingsV2(settings) || settings.runFormat !== 'open') throw Error('format')
    const next = withOpenAuthoringSeatPlanFixtureV1(settings)
    await saveTtrpgDraft(f.scope, row.revision, next, '显式新草稿')
    expect(await db.productProductionBriefs.toArray()).toEqual(rowsBefore)
    expect(await db.productBuilds.count()).toBe(0)
    const revised = await readTtrpgDraft(f.scope)
    // The exact current normal preparation may create a later Brief; it cannot
    // modify the old immutable row. Any remaining old scenario gate is retained.
    await prepareTtrpgBrief(f.scope, revised.revision)
    for (const old of rowsBefore) expect(await db.productProductionBriefs.get(old.id!)).toEqual(old)
  })
})
