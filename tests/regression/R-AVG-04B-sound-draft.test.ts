import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { avgSoundPlanningFixtureV1 } from '../helpers/avg-sound-planning-fixture'
import { prepareNativeAvgAssembly, startNativeAvgAssembly } from '../helpers/avg-production-assembly-fixture'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { saveAvgSoundProductionDraftV1, clearAvgSoundProductionDraftV1, validateAvgSoundDraftSourcesV1 } from '../../src/lib/avg/sound-draft-service'
import { parseAvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import { canonicalProductProductionJsonV2 } from '../../src/lib/product-production/hash'
import { saveAvgAuthorWorkspaceV1 } from '../../src/lib/avg/editor-service'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { avgSoundPreparationEnabledV1, avgSoundProductionExecutionReadyV1 } from '../../src/lib/avg/sound-production-brief'

beforeEach(async () => { await db.delete(); await db.open(); vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Draft save cannot perform HTTP') })) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); db.close() })
const inputOf = (s: Awaited<ReturnType<typeof avgSoundPlanningFixtureV1>>) => {
  const { sourceInputHash: _hash, ...planning } = s.scope
  return planning
}

describe('AVG typed saved sound requirements in the existing author workspace', () => {
  it('keeps the default-hidden draft editor separate from formal execution authority', () => {
    vi.stubEnv('VITE_STORYFORGE_AVG_SOUND_PREPARATION', '')
    expect(avgSoundPreparationEnabledV1()).toBe(false)
    vi.stubEnv('VITE_STORYFORGE_AVG_SOUND_PREPARATION', '1')
    expect(avgSoundPreparationEnabledV1()).toBe(true)
    expect(avgSoundProductionExecutionReadyV1()).toBe(false)
  })
  it('keeps old workspace JSON identical and saves/reopens/remaps/deletes the new draft without a provider, Build or adoption', async () => {
    const source = await avgSoundPlanningFixtureV1(), s = await prepareNativeAvgAssembly(source.workspace)
    const original = await readAvgDraftV1(s.scope), old = parseAvgAuthorWorkspaceV1(original.editorJson)
    expect(canonicalProductProductionJsonV2(parseAvgAuthorWorkspaceV1(old))).toBe(canonicalProductProductionJsonV2(old))
    expect(Object.hasOwn(old, 'soundProduction')).toBe(false)
    const saved = await saveAvgSoundProductionDraftV1({ scope: s.scope, expectedDraftRevision: original.revision, planning: inputOf(source) })
    const workspace = parseAvgAuthorWorkspaceV1(saved.editorJson)
    expect(workspace.systemPlan).toEqual(old.systemPlan); expect(workspace.scripts).toEqual(old.scripts); expect(workspace.presentation).toEqual(old.presentation)
    expect(workspace.soundProduction!.scope).toEqual(source.scope)
    expect((await saveAvgSoundProductionDraftV1({ scope: s.scope, expectedDraftRevision: saved.revision, planning: inputOf(source) })).revision).toBe(saved.revision)
    db.close(); await db.open(); expect((await readAvgDraftV1(s.scope)).editorJson).toBe(saved.editorJson)
    const backup = await exportProjectJSON(s.scope.projectId), copyId = await importProjectJSON(backup)
    const copy = (await db.avgAuthoringDrafts.where('projectId').equals(copyId).first())!
    const scope = { projectId: copyId, workId: copy.workId!, worldId: copy.worldId! }
    expect(parseAvgAuthorWorkspaceV1(copy.editorJson).soundProduction).toEqual(workspace.soundProduction)
    await deleteWork(scope.workId)
    expect({ ...await exportProjectJSON(s.scope.projectId), exportedAt: 0 }).toEqual({ ...backup, exportedAt: 0 })
    expect((await clearAvgSoundProductionDraftV1({ scope: s.scope, expectedDraftRevision: saved.revision })).editorJson).toBe(original.editorJson)
    expect(await db.productBuilds.count()).toBe(0); expect(await db.agentRuns.count()).toBe(0); expect(await db.mediaBlobObjects.count()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects stale facts, wrong consumers, unauthorized fields and a late revision without replacing the saved author draft', async () => {
    const source = await avgSoundPlanningFixtureV1(), s = await prepareNativeAvgAssembly(source.workspace), draft = await readAvgDraftV1(s.scope)
    const saved = await saveAvgSoundProductionDraftV1({ scope: s.scope, expectedDraftRevision: draft.revision, planning: inputOf(source) })
    const workspace = parseAvgAuthorWorkspaceV1(saved.editorJson), changed = structuredClone(workspace); changed.scripts[0].lines[0].text += '作者改字'
    await expect(validateAvgSoundDraftSourcesV1(workspace.soundProduction, changed)).rejects.toThrow(/已变化/)
    const bad = structuredClone(inputOf(source)); bad.templates[0].cue.beatKey = 'missing.beat'
    await expect(saveAvgSoundProductionDraftV1({ scope: s.scope, expectedDraftRevision: saved.revision, planning: bad })).rejects.toThrow()
    expect(() => parseAvgAuthorWorkspaceV1({ ...workspace, soundProduction: { ...workspace.soundProduction, apiKey: 'not-an-allowed-field' } })).toThrow()
    await expect(clearAvgSoundProductionDraftV1({ scope: s.scope, expectedDraftRevision: draft.revision })).rejects.toThrow(/已变化/)
    expect((await readAvgDraftV1(s.scope)).editorJson).toBe(saved.editorJson); expect(fetch).not.toHaveBeenCalled()
  })
  it('does not save or clear requirements after an actual start or clear them after their audio is consumed by the saved Stage', async () => {
    const source = await avgSoundPlanningFixtureV1(), s = await prepareNativeAvgAssembly(source.workspace), draft = await readAvgDraftV1(s.scope)
    await startNativeAvgAssembly(s)
    await expect(saveAvgSoundProductionDraftV1({ scope: s.scope, expectedDraftRevision: draft.revision, planning: inputOf(source) })).rejects.toThrow(/批次已开始/)
    await expect(clearAvgSoundProductionDraftV1({ scope: s.scope, expectedDraftRevision: draft.revision })).rejects.toThrow(/批次已开始/)
    expect((await readAvgDraftV1(s.scope)).editorJson).toBe(draft.editorJson)
    const other = await prepareNativeAvgAssembly(source.workspace), od = await readAvgDraftV1(other.scope)
    const sd = await saveAvgSoundProductionDraftV1({ scope: other.scope, expectedDraftRevision: od.revision, planning: inputOf(source) })
    const consumed = parseAvgAuthorWorkspaceV1(sd.editorJson)
    // Existing pure metadata fixture only: no Blob, Run or adoption is seeded.
    consumed.presentation.stage.assets.push(structuredClone(source.choices[0].asset))
    const used = await saveAvgAuthorWorkspaceV1(other.scope, sd.revision, consumed)
    await expect(clearAvgSoundProductionDraftV1({ scope: other.scope, expectedDraftRevision: used.revision })).rejects.toThrow(/已进入演出/)
    expect(fetch).not.toHaveBeenCalled()
  })
})
