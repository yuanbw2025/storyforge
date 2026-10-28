import { describe, expect, it, vi } from 'vitest'
import { buildChapterOrganizationPrompt, runChapterOrganization } from '../../src/lib/agent/chapter-organization'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import type { Character, StoryArc } from '../../src/lib/types'
import { chapterOrganizationRequestOptionsV1 } from '../../src/lib/agent/chapter-organization-model'

const text = '林舟抵达云港。\n林舟拾起潮汐钥匙。'
const characters = [{ id: 11, name: '林舟' }] as Character[]
const arcs = [{ id: 41, name: '寻门', type: 'main', description: '先完成交接', stages: JSON.stringify([{ id: 'hand-over', title: '交接', description: '', keyEvents: [] }]) }] as StoryArc[]
function root() { return { stateDiffs: [], facts: [], inventoryEvents: [], storyEvents: [], relations: [], foreshadowUpdates: [], storyline: { progress: [], crossings: [], newArcs: [] } } as Record<string, unknown> }
async function run(value: unknown) {
  const call = vi.fn(async () => JSON.stringify(value))
  const input = { projectId: 1, chapterId: 7, chapterTitle: '交接', worldGroupId: null, chapterContent: text, stateContext: '', characters, knownItemNames: [], existingRelations: [], foreshadows: [], storyArcs: arcs, budget: new AgentTeamBudgetTracker('balanced'), call, strictModelOutput: true }
  return { promise: runChapterOrganization(input), call }
}
describe('new seven-domain model protocol retains every proposed row or rejects visibly', () => {
  it('does not silently discard an unauthorized state target', async () => {
    const value = { ...root(), stateDiffs: [{ entityName: '未登记角色', category: 'character', field: '位置', oldValue: null, newValue: '云港', sourceQuote: '林舟抵达云港。' }] }
    const result = await run(value)
    await expect(result.promise).rejects.toThrow(/状态.*校验/u)
    expect(result.call).toHaveBeenCalledTimes(1)
  })
  it('does not silently discard a nonliteral timeline quotation', async () => {
    const result = await run({ ...root(), storyEvents: [{ title: '抵达', storyTime: '', importance: 2, description: '抵达云港', sourceQuote: '林舟终于抵达云港。' }] })
    await expect(result.promise).rejects.toThrow(/年表.*校验/u)
    expect(result.call).toHaveBeenCalledTimes(1)
  })
  it('does not silently discard an out-of-scope story/stage target', async () => {
    const result = await run({ ...root(), storyline: { progress: [{ arcId: 999, currentStageId: null, status: 'active', progressNote: '抵达', involvedEntities: [], quote: '林舟抵达云港。' }], crossings: [], newArcs: [] } })
    await expect(result.promise).rejects.toThrow(/故事线.*校验/u)
  })
  it('rejects malformed classifications and primitive rows before filtering', async () => {
    await expect((await run({ ...root(), stateDiffs: {} })).promise).rejects.toThrow(/数组/u)
    await expect((await run({ ...root(), storyEvents: ['invalid'] })).promise).rejects.toThrow(/对象/u)
  })
  it('resolves a frozen anchor to an exact quotation for every supported domain', async () => {
    const result = await run({ ...root(),
      stateDiffs: [{ entityName: '林舟', category: 'character', field: '位置', oldValue: null, newValue: '云港', anchorId: 'p1' }],
      facts: [{ subject: '林舟', predicate: 'location', value: '云港', anchorId: 'p1' }],
      inventoryEvents: [{ itemName: '潮汐钥匙', heldByName: '林舟', action: 'gain', quantity: 1, note: '拾起', anchorId: 'p2' }],
      storyEvents: [{ title: '抵达云港', storyTime: '', importance: 2, description: '抵达云港', anchorId: 'p1' }],
      storyline: { progress: [{ arcId: 41, currentStageId: 'hand-over', status: 'active', progressNote: '抵达交接地点', involvedEntities: ['林舟'], anchorId: 'p1' }], crossings: [], newArcs: [] },
    })
    const candidate = await result.promise
    expect(candidate.stateDiffs).toHaveLength(1); expect(candidate.stateDiffs[0].sourceQuote).toBe('林舟抵达云港。')
    expect(candidate.facts).toHaveLength(1); expect(candidate.inventoryEvents).toHaveLength(1)
    expect(candidate.storyEvents).toHaveLength(1); expect(candidate.storyline?.progress).toHaveLength(1)
  })
  it('rejects unknown or ambiguous quote/anchor pairs without guessing', async () => {
    for (const evidence of [{ anchorId: 'unknown' }, { anchorId: 'p1', sourceQuote: '林舟抵达云港。' }]) {
      await expect((await run({ ...root(), storyEvents: [{ title: '抵达', storyTime: '', importance: 2, description: '抵达云港', ...evidence }] })).promise).rejects.toThrow(/定位|引文/u)
    }
  })
  it('retains valid historical literal output under strict row accounting', async () => {
    const candidate = await (await run({ ...root(), storyEvents: [{ title: '抵达', storyTime: '', importance: 2, description: '抵达云港', sourceQuote: '林舟抵达云港。' }] })).promise
    expect(candidate.storyEvents[0].sourceQuote).toBe('林舟抵达云港。')
  })
  it('normalizes HTML once and preserves literal author angle brackets in evidence', async () => {
    const input = { projectId: 1, chapterId: 7, chapterTitle: '交接', worldGroupId: null, chapterContent: '<p>林舟写下 &lt;未验证路线&gt;，等待核验。</p>', stateContext: '', characters, knownItemNames: [], existingRelations: [], foreshadows: [], storyArcs: arcs, budget: new AgentTeamBudgetTracker('balanced'), strictModelOutput: true, call: async () => JSON.stringify({ ...root(), storyEvents: [{ title: '留下路线', storyTime: '', importance: 2, description: '等待核验', anchorId: 'p1' }] }) }
    expect((await runChapterOrganization(input)).storyEvents[0].sourceQuote).toBe('林舟写下 <未验证路线>，等待核验。')
  })
  it.each([
    ['agnes', 'agnes-2.5-flash', { responseFormat: 'json_object', thinkingMode: 'disabled' }],
    ['agnes', 'agnes-3.0-flash', {}],
    ['openai', 'gpt-4o-mini', { responseFormat: 'json_object' }],
    ['custom', 'unknown-model', {}],
  ] as const)('keeps model options inside the verified %s/%s boundary', (provider, model, options) => {
    expect(chapterOrganizationRequestOptionsV1({ provider, model })).toEqual(options)
  })
  it('provides the complete target directory and state content without prefix caps', () => {
    const prompt = buildChapterOrganizationPrompt({ chapterTitle: '交接', chapterText: text, strictModelOutput: true, stateContext: '已确认状态'.repeat(2500) + '状态末尾必须保留', characters: Array.from({ length: 125 }, (_, i) => ({ id: i + 1, name: `角色${i + 1}` })) as Character[], knownItemNames: [], existingRelations: [], foreshadows: [], storyArcs: arcs })
    const body = prompt.map(row => row.content).join('\n')
    expect(body).toContain('#125 角色125')
    expect(body).toContain('状态末尾必须保留')
    expect(body).toContain('anchorId')
    expect(body).toContain('p1')
    expect(body).toContain('hand-over')
  })
})
