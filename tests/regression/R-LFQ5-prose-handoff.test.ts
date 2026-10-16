import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { prepareProseGatewayAssemblyV1 } from '../../src/lib/prose/gateway-context'
import { buildChapterContentPrompt } from '../../src/lib/ai/adapters/chapter-adapter'
import { buildCreativeRulesContext } from '../../src/lib/ai/context-builder'
import { createSystemFictionElementsV1 } from '../../src/lib/prose/system-fiction-contract'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { usePromptStore } from '../../src/stores/prompt'
import { adoptRestoredProseCandidate, prepareProseCopilot } from '../../src/lib/agent/prose-copilot'
import { adoptGenerationNodeOutput, runGenerationNode } from '../../src/lib/generation/generation-node'
import { chat } from '../../src/lib/ai/client'
import { beginProseGenerationGatewayStepV1, createProseGenerationDurableRunV1 } from '../../src/lib/agent/run/prose-generation-durable'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'

const originalPrompts = usePromptStore.getState()
const fields = { ...createSystemFictionElementsV1(), enabled: true, protagonistIntent: '保住小店', systemMechanism: '每日第一次签到免费', rewardGrowth: '未来计划：下一章试做新点心，尚未发生', limitsCosts: '无惩罚；现有余额只有12元', oppositionRelations: '协作，不强行加敌人' }

async function seed() {
  const made = await seedCurrentWorkspace('正文资料交接')
  const put = (table: string, data: Record<string, unknown>) => (db as any)[table].add(stampNewRecord(made.scope, table, { projectId: made.scope.projectId, createdAt: 1, updatedAt: 1, ...data }, { owner: 'work' })) as Promise<number>
  const volume = await put('outlineNodes', { type: 'volume', parentId: null, title: '第一卷', summary: '收店与约定', order: 0 })
  // 物理 id 与章序故意相反，不能把自增 id 当故事时间。
  const laterNode = await put('outlineNodes', { type: 'chapter', parentId: volume, title: '第二章', summary: '明日再出发', order: 1 })
  const nodeId = await put('outlineNodes', { type: 'chapter', parentId: volume, title: '第一章', summary: '先清点，再约定；最后一场才签收，签收处停笔。', order: 0 })
  const laterChapter = await put('chapters', { outlineNodeId: laterNode, title: '第二章', content: '', wordCount: 0, status: 'outline', order: 1, notes: '' })
  const chapterId = await put('chapters', { outlineNodeId: nodeId, title: '第一章', content: '', wordCount: 0, status: 'outline', order: 0, notes: '' })
  const notes = '保留安静收店的动作和对白。'.repeat(45) + '【长备注尾部：不加次日剧情】'
  const detailId = await put('detailedOutlines', { outlineNodeId: nodeId, scenes: [{ sceneId: 's1', title: '收店', summary: '清点现有材料', conflict: '', location: '小店', characterIds: [], pace: 'slow', estimatedWords: 800, notes, entryState: '分工未定', goal: '约定明日分工', keyChoice: '先问搭档意愿', outcome: '双方同意', exitState: '明天仍未开工，尚未发生', sceneFunction: '缓冲和关系变化' }], openingHook: '从关火继续', endingCliffhanger: '签收后立即停笔', lastUsedSummary: '原章纲', ragPolicy: { tokenCap: 20_000 } })
  const style = '具体动作承载感受，避免替人物下结论。'.repeat(24) + '【文风尾部：不要统一成冷峻语气】'
  const rulesId = await put('creativeRules', { writingStyle: style, atmosphere: '平静、轻松', narrativePOV: 'third-limited', prohibitions: '["不提前获得新点心"]', consistencyRules: '["余额不能超过12元"]', specialRequirements: '按场景顺序，最后再签收。', systemFictionElements: fields })
  const coreId = await put('storyCores', { theme: '合作建立信任', centralConflict: '争取搭档同意', logline: '两人在收店中约定分工' })
  await put('temporalFacts', { subjectName: '小店', predicate: 'balance', value: '现有余额12元', factKind: 'state', sourceType: 'manual', status: 'confirmed', locked: true, validFromChapterId: null, validToChapterId: null, sourceChapterId: null })
  const futureId = await put('temporalFacts', { subjectName: '金色钥匙', predicate: 'owns', value: '【未来事实不可泄漏：已经拥有金色钥匙】', factKind: 'state', sourceType: 'chapter', status: 'confirmed', locked: true, validFromChapterId: laterChapter, validToChapterId: null, sourceChapterId: laterChapter })
  return { ...made, put, nodeId, chapterId, rulesId, coreId, detailId, futureId, notes, style, laterChapter }
}
const assembly = (f: Awaited<ReturnType<typeof seed>>, extra: object = {}) => prepareProseGatewayAssemblyV1({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, chapterId: f.chapterId, outlineNodeId: f.nodeId, operation: 'generate', authorRequest: '按场景顺序完成分工，最后签收；金色钥匙只能作为未来计划', config: useAIConfigStore.getState().config, ...extra })

describe('LFQ5 · 正文的完整实际资料与预算', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.unstubAllGlobals(); usePromptStore.setState(originalPrompts, true); db.close() })

  it('原文必读覆盖规则、故事核心、任务、长备注与文风尾部，不把规划丢掉', async () => {
    const f = await seed(); const result = await assembly(f)
    for (const text of [f.notes, f.style, fields.systemMechanism, fields.rewardGrowth, '合作建立信任', '先问搭档意愿', '明天仍未开工，尚未发生']) expect(result.text).toContain(text)
    const reads = result.contextGatewayExecution.retrievalTrace.mandatory
    expect(reads.filter(read => read.sourceRefs.some(ref => ['creativeRules', 'storyCores'].includes(ref.table))).every(read => read.depth === 'original')).toBe(true)
    expect(result.contextGatewayExecution.sourceSnapshots.some(snapshot => snapshot.sourceRefs.some(ref => ref.field === 'systemFictionElements'))).toBe(true)
    const rules = await db.creativeRules.get(f.rulesId)
    expect(buildCreativeRulesContext(rules!)).toContain(f.style)
    const messages = buildChapterContentPrompt('第一章', '最后一场才签收', result.text, '', '', '', '签收处停笔', { requiredGatewayContext: result.text })
    expect(messages.some(message => message.content.includes(result.text))).toBe(true)
    expect(messages.map(message => message.content).join('\n')).not.toContain('前 40%')
  })

  it('停用不把保存的草稿偷偷送入其它资源读取，原数据与其它规则仍保留', async () => {
    const f = await seed()
    await db.creativeRules.update(f.rulesId, { systemFictionElements: { ...fields, enabled: false, systemMechanism: '【停用草稿：不得送入请求】' } })
    const result = await assembly(f)
    expect(result.text).not.toContain('【停用草稿：不得送入请求】')
    expect(result.text).toContain(f.style)
    expect(result.contextGatewayExecution.sourceSnapshots.some(snapshot => snapshot.sourceRefs.some(ref => ref.field === 'systemFictionElements'))).toBe(false)
    expect((await db.creativeRules.get(f.rulesId))?.systemFictionElements?.systemMechanism).toBe('【停用草稿：不得送入请求】')
  })

  it('未来事实按规范章序隔离，物理 id 更小也不能成为当前事实；其它 Work 的规则不混入', async () => {
    const f = await seed(); const other = await seedCurrentWorkspace('其它作品')
    await db.creativeRules.add(stampNewRecord(other.scope, 'creativeRules', { projectId: other.scope.projectId, writingStyle: '【其它作品的私有规则】', narrativePOV: 'third-limited', atmosphere: '', prohibitions: '[]', consistencyRules: '[]', specialRequirements: '', createdAt: 1, updatedAt: 1 }, { owner: 'work' }))
    const result = await assembly(f)
    expect(f.laterChapter).toBeLessThan(f.chapterId)
    expect(result.text).not.toContain('【未来事实不可泄漏：已经拥有金色钥匙】')
    expect(result.text).not.toContain('【其它作品的私有规则】')
    expect(result.text).toContain('现有余额12元')
    const future = (await db.temporalFacts.get(f.futureId))!
    expect(result.contextGatewayExecution.retrievalTrace.omitted.some(item => item.resourceKey === `fact:${future.ragDocumentId}` && item.reasonCode === 'adapter-resource-boundary')).toBe(true)
  })

  it('自定义模板没有资料变量时补交同一 packet，模板和全局激活状态都保留', async () => {
    const f = await seed(); const result = await assembly(f)
    const tpl = usePromptStore.getState().getActive('chapter.content')
    usePromptStore.setState({ ...usePromptStore.getState(), loaded: true, templates: [{ ...tpl, id: 909, scope: 'user', isActive: true, continuityMode: 'off', systemPrompt: '作者自己的克制文风', userPromptTemplate: '只按当前任务写作。' }] })
    const before = usePromptStore.getState().templates
    const messages = buildChapterContentPrompt('第一章', '章纲', result.text, '', '', '', undefined, { requiredGatewayContext: result.text })
    expect(messages[0].content).toContain('作者自己的克制文风')
    expect(messages.at(-1)?.content).toContain(result.text)
    expect(usePromptStore.getState().templates).toEqual(before)
  })

  it('规则更新使已有候选过期，正式写入前拒绝；不是通过 UI 看起来正确就采纳', async () => {
    const f = await seed()
    let wire = ''
    const prepared = await prepareProseCopilot({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, authorRequest: '写第一章正文，签收后停止', skillId: 'prose.generate' }, { runAI: async messages => { wire = messages.map(message => message.content).join('\n'); return '两人清点材料，约定了明天的分工，最后签收并停笔。'.repeat(8) } })
    const generated = await runGenerationNode(prepared.node, prepared.prepared)
    expect(generated.gate?.status).toBe('pass')
    expect(wire).toContain(f.notes)
    expect(wire).toContain(f.style)
    await db.creativeRules.update(f.rulesId, { specialRequirements: '改为不签收；停在询问搭档', updatedAt: 2 })
    await expect(adoptGenerationNodeOutput(prepared.node, generated.output)).rejects.toThrow()
    expect((await db.chapters.get(f.chapterId))?.content).toBe('')
  })

  it('完整资料超过真实模型窗口时零 dispatch，展示预算错误；不静默把长备注变短', async () => {
    const f = await seed(); const result = await assembly(f)
    const messages = buildChapterContentPrompt('第一章', '章纲', result.text, '', '', '', undefined, { requiredGatewayContext: result.text })
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)
    await expect(chat(messages, { ...useAIConfigStore.getState().config, provider: 'openai', model: 'window-test', apiKey: 'test-only', baseUrl: 'https://budget.invalid', contextWindow: 1500, maxTokens: 500 }, { contextOverflowPolicy: 'reject' })).rejects.toThrow('上下文窗口不足')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('长备注超过默认发现上限仍完整交付，总预算不足才拒绝', async () => {
    const f = await seed()
    const detail = (await db.detailedOutlines.get(f.detailId))!
    const notes = '安静收店，先问搭档的意愿，不把未来计划写成已经发生。'.repeat(220) + '【长备注最后一句必须交付】'
    await db.detailedOutlines.update(f.detailId, { ragPolicy: undefined, scenes: [{ ...detail.scenes[0], notes }] })
    const result = await assembly(f)
    expect(result.text).toContain(notes)
    await db.detailedOutlines.update(f.detailId, { scenes: [{ ...detail.scenes[0], notes: notes.repeat(20) }] })
    await expect(assembly(f)).rejects.toThrow('hard-sufficiency')
  })

  it('视角认知、已过期和孤立事实、未来正文不能被自动召回；章纲草稿没有正文 id 也守住章序', async () => {
    const f = await seed()
    const character = await db.characters.add(stampNewRecord(f.scope, 'characters', { projectId: f.scope.projectId, name: '店主', roleWeight: 'main', homeWorldGroupId: null, isCrossWorld: false, createdAt: 1, updatedAt: 1 }, { owner: 'world' }))
    for (const [statement, sourceChapterId, characterId, worldGroupId] of [
      ['【当前认知：搭档爱甜食】', null, character, null],
      ['【未来认知：已经收到新点心】', f.laterChapter, character, null],
      ['【其它人的私有认知】', null, character + 100, null],
      ['【错世界认知】', null, character, 100],
    ] as const) await f.put('knowledgeLedger', { characterId, worldGroupId, characterName: '店主', knowledgeKey: statement, statement, sourceChapterId, sourceType: 'manual', action: 'learn', status: 'confirmed' })
    for (const [value, validToChapterId, sourceChapterId] of [
      ['【已过期：余额一百元】', f.chapterId, null],
      ['【孤立事实：不明章的额外奖励】', null, 99999],
    ] as const) await f.put('temporalFacts', { subjectName: '小店', predicate: 'balance', value, validFromChapterId: null, validToChapterId, sourceChapterId, sourceType: 'manual', factKind: 'state', status: 'confirmed' })
    await db.chapters.update(f.laterChapter, { content: '<p>【未来正文：新点心已经送达】</p>', wordCount: 20 })
    await f.put('stateCards', { category: 'character', entityName: '店主', lastChapterId: f.laterChapter, fields: '[{"key":"余额","value":"【未来状态卡：额外余额】"}]' })
    await f.put('itemLedger', { itemName: '【未来物品：金色钥匙】', action: 'gain', quantity: 1, heldByName: '店主', chapterId: f.laterChapter, chapterTitle: '第二章' })
    await f.put('storyTimelineEvents', { title: '【未来年表：点心送达】', storyTime: '明日', chapterId: f.laterChapter, chapterTitle: '第二章', order: 1, importance: 1 })
    const check = (text: string) => {
      expect(text).toContain('【当前认知：搭档爱甜食】')
      for (const marker of ['【未来认知：', '【其它人的私有认知】', '【错世界认知】', '【已过期：', '【孤立事实：', '【未来正文：', '【未来状态卡：', '【未来物品：', '【未来年表：']) expect(text).not.toContain(marker)
    }
    check((await assembly(f, { perspectiveCharacterId: character })).text)
    await db.chapters.delete(f.chapterId)
    check((await assembly(f, { chapterId: null, allowOutlineOnlyAgentDraft: true, perspectiveCharacterId: character })).text)
  })

  it('资料未变的新候选刷新后可以经原采纳链正式写入', async () => {
    const f = await seed()
    const prepared = await prepareProseCopilot({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, authorRequest: '写第一章正文，签收后停止', skillId: 'prose.generate' }, { runAI: async () => '两人清点材料，约定了明天的分工，最后签收并停笔。'.repeat(8) })
    const generated = await runGenerationNode(prepared.node, prepared.prepared)
    const snapshot = JSON.parse(JSON.stringify(prepared.snapshot))
    expect(snapshot.contentRevision.entries.some((entry: { table: string }) => entry.table === 'creativeRules')).toBe(true)
    db.close(); await db.open()
    const receipt = await adoptRestoredProseCandidate({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, operation: 'generate', outlineNodeId: f.nodeId, snapshot, draft: generated.output })
    expect(receipt.chapterId).toBe(f.chapterId)
    expect((await db.chapters.get(f.chapterId))?.content).toContain('约定了明天的分工')
    await expect(adoptRestoredProseCandidate({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, operation: 'generate', outlineNodeId: f.nodeId, snapshot, draft: generated.output })).rejects.toThrow()
  })

  it('最终请求丢掉已声明的必读 packet 时，Run 不记录模型请求', async () => {
    const f = await seed(); const assembled = await assembly(f)
    const snapshot = await createProseGenerationDurableRunV1({ scope: f.scope, worldGroupId: null, chapterId: f.chapterId, operation: 'generate' })
    await expect(beginProseGenerationGatewayStepV1({ scope: f.scope, snapshot, worldGroupId: null, chapterId: f.chapterId, outlineNodeId: f.nodeId, assembled, messages: [{ role: 'user', content: '丢掉必读资料的模板结果' }], binding: { operation: 'generate', sourceTextHash: 'a'.repeat(64), promptHash: 'b'.repeat(64), informationBoundaryHash: 'c'.repeat(64) } })).rejects.toThrow('未完整包含')
    const recorded = await readAgentRunV1(f.scope, snapshot.run.id)
    expect(recorded?.events.some(event => event.type === 'model.requested')).toBe(false)
    expect(recorded?.projection.lastSequence).toBe(snapshot.projection.lastSequence)
  })
})
