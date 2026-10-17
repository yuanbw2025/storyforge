import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { openContextPolicyFixtureV1 } from '../helpers/open-ttrpg-context'
import { startTtrpgOpenEpochV1 } from '../../src/lib/ttrpg/runtime-commands'
import { prepareTtrpgOpenIntentInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { readTtrpgOpenTableContextTraceV1 } from '../../src/lib/ttrpg/open-table-service'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'

async function setup(large = false) {
  const f = await readyOpenTtrpgSessionV1('context inspection', pkg => {
    pkg.ttrpg!.campaign.runtimePolicy.enabled = true
    pkg.ttrpg!.campaign.characterTemplates[1].controller = 'hybrid'
    const policy = openContextPolicyFixtureV1()
    policy.maximumContextTokens = large ? 3000 : 8000
    policy.triggers[0].trigger = { ...policy.triggers[0].trigger, triggerKey: 'SECRET-AUTHORED-KEY',
      logic: 'always', textPatterns: [], predicate: null, audience: 'private', knownByActorKeys: ['hero'],
      injectText: large ? 'LONG-GUIDANCE '.repeat(1400) : 'SECRET-INJECTION-TEXT' }
    pkg.ttrpg!.campaign.contextPolicy = policy
  })
  const input = { scope: f.scope, sessionId: f.sessionId, viewerKey: OPEN_HUMAN_VIEWER }
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId, 'inspect.epoch'), viewerKey: input.viewerKey, triggerKind: 'submit-action', rawInput: '调查河港' })
  const prepared = await prepareTtrpgOpenIntentInputV1({ ...await openEnvelopeV1(f.sessionId, 'inspect.prepare'), ...input,
    actorKey: 'hero', rawInput: '调查河港', maximumOutputTokens: 800, maximumCostUsd: 0.1, modelIdentity: { provider: 'test-adapter', model: 'injected' } })
  return { ...f, input, prepared }
}
describe('R-TTRPGOPEN7 retained context inspection', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('explains each actual delivered resource and trigger without disclosing authored keys/text or writing runtime', async () => {
    const f = await setup(), before = await readProductRuntimeState(f.sessionId)
    const trace = await readTtrpgOpenTableContextTraceV1(f.input)
    expect(trace?.generation).toBe('p7'); if (trace?.generation !== 'p7') throw new Error('missing modern receipt')
    expect(trace.inspection.resources).toHaveLength(f.prepared.evidence.contextSelection!.selected.length)
    expect(trace.inspection.resources.reduce((sum, row) => sum + row.tokens, 0)).toBe(trace.contextTokens)
    expect(trace.inspection.injections).toEqual([{ label: '情境指引 1', reason: '作者设置的固定指引' }])
    expect(trace.inspection.resources.some(row => row.source === '冻结规则与本人状态')).toBe(true)
    expect(JSON.stringify(trace)).not.toMatch(/SECRET-AUTHORED-KEY|SECRET-INJECTION-TEXT|fact:ttrpg-open:/)
    db.close(); await db.open()
    expect(await readTtrpgOpenTableContextTraceV1(f.input)).toEqual(trace)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
    const other = (await db.ttrpgSessionParticipants.where('sessionId').equals(f.sessionId).toArray()).find(row => row.actorKey === 'companion.1')!
    expect(await readTtrpgOpenTableContextTraceV1({ ...f.input, viewerKey: other.viewerKey })).toBeNull()
  })
  it('distinguishes actual budget omission from delivered triggers without listing omitted secret metadata', async () => {
    const f = await setup(true), trace = await readTtrpgOpenTableContextTraceV1(f.input)
    if (trace?.generation !== 'p7') throw new Error('missing modern receipt')
    expect(trace.inspection.injections).toEqual([])
    expect(trace.inspection.omissions).toContainEqual({ category: '情境指引', reason: '正文预算上限' })
    expect(JSON.stringify(trace)).not.toMatch(/SECRET-AUTHORED-KEY|SECRET-INJECTION-TEXT/)
    expect(trace.inspection.resources.some(row => row.category === '规则')).toBe(true)
  })
  it('reads exact historical evidence after cross-workspace import without granting a new request', async () => {
    const f = await setup(), original = await readTtrpgOpenTableContextTraceV1(f.input)
    const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const scope = await resolveScope({ scope: { projectId, worldId: session.worldId!, workId: session.workId! } })
    const before = await readProductRuntimeState(session.id!)
    const imported = await readTtrpgOpenTableContextTraceV1({ scope, sessionId: session.id!, viewerKey: OPEN_HUMAN_VIEWER })
    expect(imported?.historical).toBe(true)
    if (original?.generation !== 'p7' || imported?.generation !== 'p7') throw new Error('missing receipt')
    expect(imported.inspection).toEqual(original.inspection)
    expect(await readProductRuntimeState(session.id!)).toEqual(before)
  })
  it('refuses an altered original source snapshot before returning inspection labels', async () => {
    const f = await setup()
    const ref = f.prepared.evidence.preflight.artifacts.find(row => row.role === 'source-snapshot')!
    const rows = await db.agentRunArtifacts.where('projectId').equals(f.scope.projectId).toArray()
    const row = rows.find(row => row.artifactKind === ref.artifactKind && row.contentHash === ref.contentHash)!
    await db.agentRunArtifacts.update(row.id!, { content: `${row.content} ` })
    await expect(readTtrpgOpenTableContextTraceV1(f.input)).rejects.toThrow()
  })
})
