import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readAgentRunV1 } from '../../src/lib/agent/run'
import { adoptOutlineGenerationCandidateV1, beginOutlineGenerationBatchAdoptionV1, restoreLatestOutlineGenerationBatchV1, verifyOutlineGenerationAdoptionV1 } from '../../src/lib/outline/candidate-lifecycle'
import { adoptGeneratedOutlineItems } from '../../src/lib/outline/adopt-generation'
import { captureWorkspaceContentRevisionV1, OUTLINE_BATCH_APPEND_PAYLOAD_TYPE_V1 } from '../../src/lib/authoring/content-revision'
import { createSfqa094BatchV1, sfqa094IntentV1 } from '../helpers/sfqa094-batch'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())

describe.sequential('SFQA094 · 同批已采纳增量不冒充作者新改', () => {
  it('缺少批次身份或重复卷的整批确认在任何写入前拒绝', async () => {
    const fixture = await createSfqa094BatchV1()
    const [first, second] = fixture.result.candidatesByVolume.values()
    const entries = [
      { candidate: first, intent: sfqa094IntentV1(first, fixture.volumes[0].id!) },
      { candidate: { ...second, batch: undefined }, intent: sfqa094IntentV1(second, fixture.volumes[1].id!) },
    ]
    await expect(beginOutlineGenerationBatchAdoptionV1(entries)).rejects.toThrow(/批次|重复/)
    await expect(beginOutlineGenerationBatchAdoptionV1([entries[0], entries[0]])).rejects.toThrow(/批次|重复/)
    for (const candidate of [first, second]) expect((await readAgentRunV1(fixture.scope, candidate.runId)).projection.state).toBe('awaiting_confirmation')
    expect(await db.outlineNodes.where('type').equals('chapter').count()).toBe(0)
    expect(fixture.modelCalls()).toBe(2)
  })

  it('同世界两卷经同一正式adopter各成功一次并各留终态回执', async () => {
    const fixture = await createSfqa094BatchV1()
    const candidates = [...fixture.result.candidatesByVolume.values()]
    const originalHashes = candidates.map(candidate => candidate.contentRevision?.vectorHash)
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index]
      const adoption = await adoptOutlineGenerationCandidateV1({
        candidate, intent: sfqa094IntentV1(candidate, fixture.volumes[index].id!),
      })
      expect(adoption.receiptHash).toMatch(/^[a-f0-9]{64}$/)
      expect((await readAgentRunV1(fixture.scope, candidate.runId)).projection.state).toBe('completed')
    }
    expect(candidates.map(candidate => candidate.contentRevision?.vectorHash)).toEqual(originalHashes)
    expect(await db.outlineNodes.where('type').equals('chapter').count()).toBe(4)
    expect(fixture.modelCalls()).toBe(2)
    expect(await restoreLatestOutlineGenerationBatchV1(fixture.scope)).toBeNull()
  })

  it('冷态恢复只提供未完成卷，继续确认不重发模型', async () => {
    const fixture = await createSfqa094BatchV1(3)
    const first = [...fixture.result.candidatesByVolume.values()][0]
    await adoptOutlineGenerationCandidateV1({ candidate: first, intent: sfqa094IntentV1(first, fixture.volumes[0].id!) })
    db.close(); await db.open()
    const restored = await restoreLatestOutlineGenerationBatchV1(fixture.scope)
    expect(restored?.candidates).toHaveLength(2)
    for (const candidate of restored!.candidates) {
      const index = candidate.batch!.batchIndex
      await adoptOutlineGenerationCandidateV1({ candidate, intent: sfqa094IntentV1(candidate, fixture.volumes[index].id!) })
    }
    expect(await db.outlineNodes.where('type').equals('chapter').count()).toBe(6)
    expect(fixture.modelCalls()).toBe(3)
    for (const candidate of fixture.result.candidatesByVolume.values()) {
      expect((await readAgentRunV1(fixture.scope, candidate.runId)).projection.state).toBe('completed')
    }
  })

  it.each(['summary', 'ragPolicy'] as const)('已采纳本批行的%s变化仍阻断下一卷，不以本批身份掩盖', async field => {
    const fixture = await createSfqa094BatchV1()
    const [first, second] = fixture.result.candidatesByVolume.values()
    await adoptOutlineGenerationCandidateV1({ candidate: first, intent: sfqa094IntentV1(first, fixture.volumes[0].id!) })
    const chapter = await db.outlineNodes.where('parentId').equals(fixture.volumes[0].id!).first()
    if (!chapter?.id) throw new Error('missing adopted row')
    if (field === 'summary') await db.outlineNodes.update(chapter.id, { summary: '作者新改' })
    else await db.outlineNodes.update(chapter.id, { ragPolicy: { enabled: false } })
    await expect(adoptOutlineGenerationCandidateV1({ candidate: second, intent: sfqa094IntentV1(second, fixture.volumes[1].id!) })).rejects.toThrow(/过期|变化|来源|证据/)
    expect(await db.outlineNodes.where('parentId').equals(fixture.volumes[1].id!).count()).toBe(0)
    expect(fixture.modelCalls()).toBe(2)
  })

  it('生成后和采纳循环中的真实作者卷纲修改均保留并阻断写入', async () => {
    const fixture = await createSfqa094BatchV1()
    const [first, second] = fixture.result.candidatesByVolume.values()
    await adoptOutlineGenerationCandidateV1({ candidate: first, intent: sfqa094IntentV1(first, fixture.volumes[0].id!) })
    await expect(adoptOutlineGenerationCandidateV1({ candidate: second,
      intent: sfqa094IntentV1(second, fixture.volumes[1].id!),
      faultInjector: async boundary => {
        if (boundary === 'before-cas') await db.outlineNodes.update(fixture.volumes[1].id!, { summary: '采纳循环中的作者新稿' })
      },
    })).rejects.toThrow(/变化|过期/)
    expect((await db.outlineNodes.get(fixture.volumes[1].id!))?.summary).toBe('采纳循环中的作者新稿')
    expect(await db.outlineNodes.where('parentId').equals(fixture.volumes[1].id!).count()).toBe(0)
    expect(fixture.modelCalls()).toBe(2)
  })

  it('未知的额外写入不能与本批已确认追加混为一谈', async () => {
    const fixture = await createSfqa094BatchV1()
    const [first, second] = fixture.result.candidatesByVolume.values()
    await adoptOutlineGenerationCandidateV1({ candidate: first, intent: sfqa094IntentV1(first, fixture.volumes[0].id!) })
    await adoptGeneratedOutlineItems({ projectId: fixture.scope.projectId, workspaceScope: fixture.scope,
      worldGroupId: null, parentId: fixture.volumes[0].id!, type: 'chapter',
      items: [{ title: '作者额外插入', summary: '不属于任何本批回执' }], startingOrder: 2 })
    await expect(adoptOutlineGenerationCandidateV1({ candidate: second, intent: sfqa094IntentV1(second, fixture.volumes[1].id!) })).rejects.toThrow(/变化|过期/)
    expect((await db.outlineNodes.toArray()).filter(row => row.title === '作者额外插入')).toHaveLength(1)
  })

  it.each(['missing', 'forged', 'resourceUID', 'owner'] as const)('不接受%s的本批来源证明', async corruption => {
    const fixture = await createSfqa094BatchV1()
    const [first, second] = fixture.result.candidatesByVolume.values()
    await adoptOutlineGenerationCandidateV1({ candidate: first, intent: sfqa094IntentV1(first, fixture.volumes[0].id!) })
    const event = (await db.agentEvents.toArray()).find(row => row.durableRunId === first.runId && JSON.parse(row.payload).type === OUTLINE_BATCH_APPEND_PAYLOAD_TYPE_V1)
    if (!event?.id) throw new Error('missing committed append evidence')
    if (corruption === 'missing') await db.agentEvents.delete(event.id)
    else if (corruption === 'forged') {
      const payload: { evidence: { adoptionEvidence: unknown } } = JSON.parse(event.payload)
      payload.evidence.adoptionEvidence = { forged: true }
      await db.agentEvents.update(event.id, { payload: JSON.stringify(payload) })
    } else {
      const row = await db.outlineNodes.where('parentId').equals(fixture.volumes[0].id!).first()
      if (!row?.id) throw new Error('missing committed chapter')
      if (corruption === 'resourceUID') await db.outlineNodes.update(row.id, { ragDocumentId: 'sfres-v1:outline-node:00000000-0000-4000-8000-000000000099' })
      else await db.outlineNodes.update(row.id, { workId: fixture.scope.workId + 100 })
    }
    await expect(adoptOutlineGenerationCandidateV1({ candidate: second, intent: sfqa094IntentV1(second, fixture.volumes[1].id!) })).rejects.toThrow(/证据|证明|身份|意图|来源|过期/)
    expect(await db.outlineNodes.where('parentId').equals(fixture.volumes[1].id!).count()).toBe(0)
  })

  it('调用方不能用重新捕获的当前向量替换原候选读取历史', async () => {
    const fixture = await createSfqa094BatchV1()
    const candidate = [...fixture.result.candidatesByVolume.values()][0]
    await db.outlineNodes.update(fixture.volumes[0].id!, { summary: '作者已改' })
    const current = await captureWorkspaceContentRevisionV1({ scope: fixture.scope, worldGroupId: null })
    await expect(adoptOutlineGenerationCandidateV1({ candidate: { ...candidate, contentRevision: current },
      intent: sfqa094IntentV1(candidate, fixture.volumes[0].id!) })).rejects.toThrow(/来源|证据/)
    expect(await db.outlineNodes.where('type').equals('chapter').count()).toBe(0)
  })

  it('真实业务回读验证失败仍拒绝，不把所有验证错误都当作回执存储问题', async () => {
    const fixture = await createSfqa094BatchV1()
    const candidate = [...fixture.result.candidatesByVolume.values()][0]
    const intent = sfqa094IntentV1(candidate, fixture.volumes[0].id!)
    await expect(adoptOutlineGenerationCandidateV1({ candidate, intent,
      faultInjector: boundary => { if (boundary === 'after-adoption-event') throw new Error('pause-before-verification') },
    })).rejects.toThrow('pause-before-verification')
    const row = await db.outlineNodes.where('parentId').equals(fixture.volumes[0].id!).first()
    if (row?.id == null) throw new Error('missing actual business row')
    await db.outlineNodes.update(row.id, { summary: '与已确认计划不符的真实变化' })
    await expect(verifyOutlineGenerationAdoptionV1(candidate, intent)).rejects.toThrow(/缺少|不一致/)
    const snapshot = await readAgentRunV1(fixture.scope, candidate.runId)
    expect(snapshot.projection.state).toBe('failed')
    expect(snapshot.projection.terminalReceiptHash).toBeUndefined()
    expect(snapshot.events.filter(event => event.type === 'verification.rejected')).toHaveLength(1)
    expect(fixture.modelCalls()).toBe(2)
  })

  it.each([
    'business-write-in-progress', 'after-business-write', 'after-adoption-event', 'verification-in-progress', 'after-terminal-receipt',
  ] as const)('第二卷在%s失败后明确恢复一次，首卷不重写', async boundary => {
    const fixture = await createSfqa094BatchV1()
    const [first, second] = fixture.result.candidatesByVolume.values()
    await adoptOutlineGenerationCandidateV1({ candidate: first, intent: sfqa094IntentV1(first, fixture.volumes[0].id!) })
    const intent = sfqa094IntentV1(second, fixture.volumes[1].id!)
    await expect(adoptOutlineGenerationCandidateV1({ candidate: second, intent,
      faultInjector: actual => { if (actual === boundary) throw new Error(`fault:${boundary}`) },
    })).rejects.toThrow(`fault:${boundary}`)
    expect(await db.outlineNodes.where('parentId').equals(fixture.volumes[1].id!).count()).toBe(boundary === 'business-write-in-progress' ? 0 : 2)
    db.close(); await db.open()
    await adoptOutlineGenerationCandidateV1({ candidate: second, intent })
    expect(await db.outlineNodes.where('type').equals('chapter').count()).toBe(4)
    for (const candidate of [first, second]) {
      const snapshot = await readAgentRunV1(fixture.scope, candidate.runId)
      expect(snapshot.projection.state).toBe('completed')
      expect(snapshot.events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
      expect(snapshot.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
    }
    expect(fixture.modelCalls()).toBe(2)
  })
})
