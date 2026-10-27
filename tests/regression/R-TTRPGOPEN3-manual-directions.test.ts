import { afterEach,beforeEach,describe,expect,it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedManualDiscoveryDirectionsV1,firstManualRequestV1 } from '../helpers/open-ttrpg-manual'
import { proposeTtrpgOpenManualActionV1,readTtrpgOpenTableV1 } from '../../src/lib/ttrpg/open-table-service'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { rt } from '../helpers/open-ttrpg-branch-recovery'

describe('R-TTRPGOPEN3 visible manual discovery directions', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete();await db.open() })
  afterEach(() => db.close())
  it('distinguishes identical public hints, disables a legacy foreign clue reference, retains history and keeps private definitions out of human output', async () => {
    const x = await seedManualDiscoveryDirectionsV1(),before = await readProductRuntimeState(x.f.sessionId)
    const paths = x.catalog.discoveries.filter(d => d.route === 'generic-check')
    expect(paths).toHaveLength(2)
    expect(paths.map(d => d.directionNumber)).toEqual([1,2])
    expect(paths.map(d => d.available)).toEqual([false,true])
    expect(paths.map(d => d.label)).toEqual(['方向 1 · 比较公开的两种保管方向','方向 2 · 比较公开的两种保管方向'])
    expect(paths[0].unavailableReason).toBe('这条方向需要作者修订。')
    const projected = JSON.stringify({ catalog: x.catalog,affordances: (await readTtrpgOpenTableV1(x.input)).player!.affordances })
    expect(projected).not.toMatch(/PRIVATE_/)
    expect((await readTtrpgOpenTableV1(x.input)).player!.affordances.map(a => a.label)).toEqual(['方向 1','方向 2'])
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
    expect(x.f.campaign.situationTemplates.some(t => t.templateKey === 'direction.legacy')).toBe(true)
    const make = (path: typeof paths[number]) => { const base = firstManualRequestV1(x.catalog,'generic-check').request
      const policy = x.f.campaign.situationTemplates.flatMap(t => t.evidence).find(e => e.clueRef === path.evidenceRef)!.discoveryPolicy
      const refs = [policy.costEffectPlanRef,policy.failForwardEffectPlanRef].filter((key): key is string => key !== null)
      return { ...base,discovery: { situationKey: path.situationKey,interventionPointKey: path.interventionPointKey,evidenceRef: path.evidenceRef,
        effectBindings: Object.fromEntries(refs.map(key => [key,{}])) } } }
    await expect(proposeTtrpgOpenManualActionV1({ ...x.input,request: make(paths[0]),basisHash: x.catalog.basisHash,submissionKey: 'legacy.forged',rawInput: '旧引用不能因为来自客户端而得到执行权' })).rejects.toThrow(/知识效果必须绑定明确发现路径/)
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
    const proposed = await proposeTtrpgOpenManualActionV1({ ...x.input,request: make(paths[1]),basisHash: x.catalog.basisHash,
      submissionKey: 'current.legal',rawInput: '选择修正版公开方向，保留发现代价与本人风险确认' })
    expect(proposed.operationKey).toBeTruthy()
    const after = await readProductRuntimeState(x.f.sessionId)
    expect(rt(after).openRun!.operations[0].status).toBe('awaiting-approval')
    expect(rt(after).openRun!.coordination.calls).toEqual([])
    expect(after.entities).toEqual(before.entities)
  })
})
